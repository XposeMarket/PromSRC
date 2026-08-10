import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { desktopAbortableDelay, isDesktopCancellationError, throwIfDesktopCancelled } from './desktop-cancellation.js';
import {
  createDesktopTargetLeaseManager,
  type DesktopTargetAdapter,
  type DesktopTargetLeaseManager,
  type DesktopTargetProbe,
  type DesktopTargetStartResult,
} from './desktop-target-lease.js';
import { createHyperVDesktopTargetAdapter } from './desktop-hyperv-target.js';

const execFileAsync = promisify(execFile);

export type DesktopBackgroundAction =
  | 'screenshot'
  | 'list_windows'
  | 'get_window_state'
  | 'accessibility_tree'
  | 'click'
  | 'window_click'
  | 'type'
  | 'window_type'
  | 'key'
  | 'window_key'
  | 'run'
  | 'wait';

export interface DesktopBackgroundCommandArgs {
  action: DesktopBackgroundAction;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  command?: string;
  ms?: number;
  timeout_ms?: number;
  window_id?: string;
  title?: string;
  include_screenshot?: boolean;
  include_text?: boolean;
  max_depth?: number;
  max_nodes?: number;
  /** Internal session identity used by the target lease manager. */
  session_id?: string;
  signal?: AbortSignal;
}

export interface DesktopBackgroundPrepareOptions {
  launch?: boolean;
  networking?: 'enable' | 'disable' | 'default';
  vgpu?: 'enable' | 'disable' | 'default';
  memory_mb?: number;
  /** Internal session identity used by the target lease manager. */
  session_id?: string;
}

const BACKGROUND_ROOT = path.resolve(process.cwd(), '.prometheus', 'desktop-background');
const BRIDGE_DIR = path.join(BACKGROUND_ROOT, 'bridge');
const INBOX_DIR = path.join(BRIDGE_DIR, 'inbox');
const OUTBOX_DIR = path.join(BRIDGE_DIR, 'outbox');
const PROCESSED_DIR = path.join(BRIDGE_DIR, 'processed');
const SCREENSHOTS_DIR = path.join(BRIDGE_DIR, 'screenshots');
const WORKER_PATH = path.join(BRIDGE_DIR, 'worker.ps1');
const SANDBOX_CONFIG_PATH = path.join(BACKGROUND_ROOT, 'prometheus-background-desktop.wsb');
const READY_PATH = path.join(BRIDGE_DIR, 'ready.json');
const OWNER_PATH = path.join(BRIDGE_DIR, 'owner.json');
const RUNTIME_STATE_PATH = path.join(BACKGROUND_ROOT, 'desktop-target-runtime.json');
const READY_STALE_MS = Math.max(5_000, Number(process.env.PROMETHEUS_DESKTOP_READY_STALE_MS || 15_000));
const TARGET_MODE = String(process.env.PROMETHEUS_DESKTOP_TARGET_MODE || 'sandbox').trim().toLowerCase();

let lastSandboxOptions: DesktopBackgroundPrepareOptions = {};
let sandboxLaunchPid: number | undefined;
let backgroundRuntime: DesktopTargetLeaseManager | undefined;

function ensureBridgeDirs(): void {
  for (const dir of [BACKGROUND_ROOT, BRIDGE_DIR, INBOX_DIR, OUTBOX_DIR, PROCESSED_DIR, SCREENSHOTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function runPowerShell(script: string, timeoutMs = 5000): Promise<string> {
  if (process.platform !== 'win32') return 'unavailable: not running on Windows';
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    return String(stdout || stderr || '').trim();
  } catch (err: any) {
    return `unavailable: ${String(err?.message || err)}`;
  }
}

async function getWindowsFeatureState(featureName: string): Promise<string> {
  const script = [
    `$f = Get-WindowsOptionalFeature -Online -FeatureName ${JSON.stringify(featureName)} -ErrorAction SilentlyContinue`,
    'if ($null -eq $f) { "not_found" } else { $f.State }',
  ].join('; ');
  return runPowerShell(script, 8000);
}

async function getServiceState(serviceName: string): Promise<string> {
  const script = [
    `$s = Get-Service -Name ${JSON.stringify(serviceName)} -ErrorAction SilentlyContinue`,
    'if ($null -eq $s) { "not_found" } else { $s.Status }',
  ].join('; ');
  return runPowerShell(script, 4000);
}

export function buildDesktopBackgroundWorkerScript(instanceId = 'manual'): string {
  const safeInstanceId = String(instanceId || 'manual').replace(/'/g, "''");
  return String.raw`$ErrorActionPreference = "Continue"

$Bridge = Split-Path -Parent $MyInvocation.MyCommand.Path
$Inbox = Join-Path $Bridge "inbox"
$Outbox = Join-Path $Bridge "outbox"
$Processed = Join-Path $Bridge "processed"
$Screenshots = Join-Path $Bridge "screenshots"
$Ready = Join-Path $Bridge "ready.json"
$InstanceId = '${safeInstanceId}'
$LastHeartbeatAt = 0
New-Item -ItemType Directory -Force -Path $Inbox,$Outbox,$Processed,$Screenshots | Out-Null

function Write-Ready {
  $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $started = if ($LastHeartbeatAt -gt 0) { $LastHeartbeatAt } else { $now }
  @{ worker = "windows-sandbox-powershell"; instanceId = $InstanceId; startedAt = $started; heartbeatAt = $now } |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -Path $Ready
  $script:LastHeartbeatAt = $now
}

Write-Ready

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PrometheusInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

function Write-Result($Id, $Payload) {
  $Payload.worker = "windows-sandbox-powershell"
  $Payload.completedAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $Payload | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -Path (Join-Path $Outbox "$Id.json")
}

function Capture-Screenshot($Id) {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $left = ($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum
  $top = ($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum
  $right = ($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum
  $bottom = ($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum
  $width = [int]($right - $left)
  $height = [int]($bottom - $top)
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.CopyFromScreen([int]$left, [int]$top, 0, 0, $bmp.Size)
  $file = Join-Path $Screenshots "$Id.png"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $gfx.Dispose()
  $bmp.Dispose()
  return @{ ok = $true; action = "screenshot"; screenshotPath = $file; screenshotFile = "$Id.png"; width = $width; height = $height; left = $left; top = $top }
}

function Get-WindowRows {
  $rows = New-Object System.Collections.ArrayList
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
    $rect = New-Object PrometheusInput+RECT
    $h = [IntPtr]::new([Int64]$_.MainWindowHandle)
    $hasRect = [PrometheusInput]::GetWindowRect($h, [ref]$rect)
    $started = 0
    try { $started = [DateTimeOffset]::new($_.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } catch { }
    [void]$rows.Add([ordered]@{
      windowId = "bgwin_$($_.MainWindowHandle)_$($_.Id)_$started"
      handle = [int64]$_.MainWindowHandle
      pid = [int]$_.Id
      processStartTime = [int64]$started
      processName = [string]$_.ProcessName
      title = [string]$_.MainWindowTitle
      bounds = [ordered]@{
        left = if ($hasRect) { [int]$rect.Left } else { 0 }
        top = if ($hasRect) { [int]$rect.Top } else { 0 }
        width = if ($hasRect) { [int]($rect.Right - $rect.Left) } else { 0 }
        height = if ($hasRect) { [int]($rect.Bottom - $rect.Top) } else { 0 }
      }
    })
  }
  return @($rows.ToArray())
}

function Resolve-Window($Command) {
  $windows = Get-WindowRows
  $id = [string]$Command.window_id
  if ($id -and $id -match '^bgwin_(\d+)_(\d+)_(\d+)$') {
    $handle = [int64]$Matches[1]
    $pid = [int]$Matches[2]
    $started = [int64]$Matches[3]
    return $windows | Where-Object { $_.handle -eq $handle -and $_.pid -eq $pid -and $_.processStartTime -eq $started } | Select-Object -First 1
  }
  $title = [string]$Command.title
  if ($title) {
    return $windows | Where-Object { $_.title -like "*$title*" -or $_.processName -like "*$title*" } | Select-Object -First 1
  }
  return $null
}

function Focus-Window($Window) {
  if (-not $Window) { throw 'Background window was not found. Call list_windows again.' }
  $h = [IntPtr]::new([Int64]$Window.handle)
  if (-not [PrometheusInput]::IsWindow($h)) { throw 'Background window is stale.' }
  [void][PrometheusInput]::ShowWindowAsync($h, 9)
  if (-not [PrometheusInput]::SetForegroundWindow($h)) { throw 'Could not focus the background window.' }
}

function Get-AccessibilityNodes($Window, [int]$MaxDepth = 6, [int]$MaxNodes = 400) {
  if ($MaxDepth -lt 1) { $MaxDepth = 6 }
  if ($MaxNodes -lt 10) { $MaxNodes = 400 }
  $MaxDepth = [Math]::Min($MaxDepth, 12)
  $MaxNodes = [Math]::Min($MaxNodes, 1500)
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $nodes = New-Object System.Collections.ArrayList
  function Add-Node($Element, [int]$ParentIndex, [int]$Depth) {
    if ($Depth -gt $MaxDepth -or $nodes.Count -ge $MaxNodes) { return }
    try {
      $index = [int]$nodes.Count
      $c = $Element.Current
      $rect = $c.BoundingRectangle
      [void]$nodes.Add([ordered]@{
        index = $index
        parentIndex = if ($ParentIndex -ge 0) { $ParentIndex } else { $null }
        depth = $Depth
        role = if ($c.ControlType) { $c.ControlType.ProgrammaticName.Replace('ControlType.','') } else { 'Unknown' }
        name = [string]$c.Name
        automationId = [string]$c.AutomationId
        enabled = [bool]$c.IsEnabled
        focused = [bool]$c.HasKeyboardFocus
        bounds = [ordered]@{ x=[int]$rect.X; y=[int]$rect.Y; width=[int]$rect.Width; height=[int]$rect.Height }
      })
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $child = $walker.GetFirstChild($Element)
      while ($child -ne $null -and $nodes.Count -lt $MaxNodes) {
        Add-Node $child $index ($Depth + 1)
        $child = $walker.GetNextSibling($child)
      }
    } catch { }
  }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([Int64]$Window.handle))
  if (-not $root) { throw 'Could not resolve the background window accessibility root.' }
  Add-Node $root -1 0
  return @($nodes.ToArray())
}

while ($true) {
  Get-ChildItem -Path $Inbox -Filter *.json -File | Sort-Object LastWriteTime | ForEach-Object {
    $file = $_.FullName
    try {
      $cmd = Get-Content -Raw -Path $file | ConvertFrom-Json
      $id = [string]$cmd.id
      if (-not $id) { $id = [IO.Path]::GetFileNameWithoutExtension($file) }
      $action = ([string]$cmd.action).ToLowerInvariant()
      $result = @{ ok = $true; action = $action }
      if ($action -eq "screenshot") {
        $result = Capture-Screenshot $id
      } elseif ($action -eq "list_windows") {
        $result.windows = @(Get-WindowRows)
      } elseif ($action -eq "get_window_state") {
        $window = Resolve-Window $cmd
        if (-not $window) { throw 'Background window was not found. Call list_windows first.' }
        $result.window = $window
        $result.stateId = "bgstate_$id"
        if ($cmd.include_screenshot -ne $false) { $result.screenshot = Capture-Screenshot $id }
        if ($cmd.include_text -eq $true) { $result.accessibility = @(Get-AccessibilityNodes $window ([int]$cmd.max_depth) ([int]$cmd.max_nodes)) }
      } elseif ($action -eq "accessibility_tree") {
        $window = Resolve-Window $cmd
        if (-not $window) { throw 'Background window was not found. Call list_windows first.' }
        $result.window = $window
        $result.nodes = @(Get-AccessibilityNodes $window ([int]$cmd.max_depth) ([int]$cmd.max_nodes))
      } elseif ($action -eq "click") {
        [PrometheusInput]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
        [PrometheusInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [PrometheusInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        $result.x = [int]$cmd.x
        $result.y = [int]$cmd.y
      } elseif ($action -eq "window_click") {
        $window = Resolve-Window $cmd
        Focus-Window $window
        $targetX = [int]$window.bounds.left + [int]$cmd.x
        $targetY = [int]$window.bounds.top + [int]$cmd.y
        [PrometheusInput]::SetCursorPos($targetX, $targetY) | Out-Null
        [PrometheusInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [PrometheusInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        $result.window = $window
        $result.x = [int]$cmd.x
        $result.y = [int]$cmd.y
      } elseif ($action -eq "type") {
        Set-Clipboard -Value ([string]$cmd.text)
        [System.Windows.Forms.SendKeys]::SendWait("^v")
      } elseif ($action -eq "window_type") {
        $window = Resolve-Window $cmd
        Focus-Window $window
        Set-Clipboard -Value ([string]$cmd.text)
        [System.Windows.Forms.SendKeys]::SendWait("^v")
        $result.window = $window
      } elseif ($action -eq "key") {
        [System.Windows.Forms.SendKeys]::SendWait([string]$cmd.key)
      } elseif ($action -eq "window_key") {
        $window = Resolve-Window $cmd
        Focus-Window $window
        [System.Windows.Forms.SendKeys]::SendWait([string]$cmd.key)
        $result.window = $window
      } elseif ($action -eq "run") {
        $output = & cmd.exe /c ([string]$cmd.command) 2>&1 | Out-String
        $result.output = $output
      } elseif ($action -eq "wait") {
        Start-Sleep -Milliseconds ([int]$cmd.ms)
        $result.ms = [int]$cmd.ms
      } else {
        $result = @{ ok = $false; action = $action; error = "Unknown action: $action" }
      }
      Write-Result $id $result
      Move-Item -Force -Path $file -Destination (Join-Path $Processed ([IO.Path]::GetFileName($file)))
    } catch {
      $fallbackId = [IO.Path]::GetFileNameWithoutExtension($file)
      Write-Result $fallbackId @{ ok = $false; action = "error"; error = $_.Exception.Message }
      Move-Item -Force -Path $file -Destination (Join-Path $Processed ([IO.Path]::GetFileName($file)))
    }
  }
  if (([DateTimeOffset]::Now.ToUnixTimeMilliseconds() - $LastHeartbeatAt) -ge 5000) { Write-Ready }
  Start-Sleep -Milliseconds 250
}`;
}

function sandboxConfigXml(options: DesktopBackgroundPrepareOptions = {}): string {
  const networking = options.networking || 'default';
  const vgpu = options.vgpu || 'default';
  const memory = Number.isFinite(Number(options.memory_mb)) ? Math.max(1024, Math.floor(Number(options.memory_mb))) : 4096;
  const lines = [
    '<Configuration>',
    `  <vGPU>${vgpu === 'disable' ? 'Disable' : vgpu === 'enable' ? 'Enable' : 'Default'}</vGPU>`,
    `  <Networking>${networking === 'disable' ? 'Disable' : networking === 'enable' ? 'Enable' : 'Default'}</Networking>`,
    `  <MemoryInMB>${memory}</MemoryInMB>`,
    '  <MappedFolders>',
    '    <MappedFolder>',
    `      <HostFolder>${xmlEscape(BRIDGE_DIR)}</HostFolder>`,
    '      <ReadOnly>false</ReadOnly>',
    '    </MappedFolder>',
    '  </MappedFolders>',
    '  <LogonCommand>',
    '    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\Desktop\\bridge\\worker.ps1"</Command>',
    '  </LogonCommand>',
    '</Configuration>',
  ];
  return lines.join(os.EOL);
}

function prepareSandboxFiles(options: DesktopBackgroundPrepareOptions = {}, instanceId = 'manual'): void {
  ensureBridgeDirs();
  fs.writeFileSync(WORKER_PATH, buildDesktopBackgroundWorkerScript(instanceId), 'utf-8');
  fs.writeFileSync(SANDBOX_CONFIG_PATH, sandboxConfigXml(options), 'utf-8');
  fs.writeFileSync(
    path.join(BRIDGE_DIR, 'README.txt'),
    [
      'Prometheus background desktop bridge',
      '',
      'The gateway manages this sandbox with a session lease when configured for on-demand mode.',
      'The sandbox logon command runs worker.ps1 from this mapped folder.',
      'Prometheus writes command JSON files to inbox and reads results from outbox.',
    ].join(os.EOL),
    'utf-8',
  );
}

function readJsonFile(filePath: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, any>;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: Record<string, any>): void {
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf-8');
}

function readyRecord(instanceId?: string): Record<string, any> | null {
  const ready = readJsonFile(READY_PATH);
  if (!ready) return null;
  const heartbeatAt = Number(ready.heartbeatAt || 0);
  if (!Number.isFinite(heartbeatAt) || heartbeatAt <= 0 || Date.now() - heartbeatAt > READY_STALE_MS) return null;
  if (instanceId && String(ready.instanceId || '') !== instanceId) return null;
  return ready;
}

function ownerRecord(): Record<string, any> | null {
  const owner = readJsonFile(OWNER_PATH);
  const pid = Number(owner?.pid || 0);
  return Number.isInteger(pid) && pid > 0 ? owner : null;
}

async function sandboxProcessCommandLine(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  const output = await runPowerShell(
    `$p = Get-CimInstance Win32_Process -Filter ${JSON.stringify(`ProcessId=${pid}`)} -ErrorAction SilentlyContinue; if ($null -eq $p) { "" } else { [string]$p.CommandLine }`,
    3000,
  );
  return output.startsWith('unavailable:') ? '' : output;
}

async function sandboxProcessIsOwned(pid: number): Promise<boolean> {
  const commandLine = await sandboxProcessCommandLine(pid);
  if (!commandLine) return false;
  return commandLine.toLowerCase().includes(SANDBOX_CONFIG_PATH.toLowerCase())
    || commandLine.toLowerCase().includes(path.basename(SANDBOX_CONFIG_PATH).toLowerCase());
}

async function sandboxProcessExists(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const output = await runPowerShell(
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $p) { "no" } else { "yes" }`,
    3000,
  );
  return output.trim().toLowerCase() === 'yes';
}

async function waitForSandboxProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() <= deadline) {
    if (!(await sandboxProcessExists(pid))) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return !(await sandboxProcessExists(pid));
}

async function stopSandboxProcess(reason: string, graceMs: number, forceAfterMs: number): Promise<void> {
  const owner = ownerRecord();
  const pid = Number(owner?.pid || sandboxLaunchPid || 0);
  if (pid > 0 && await sandboxProcessIsOwned(pid)) {
    await runPowerShell(
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $null = $p.CloseMainWindow() }`,
      3000,
    );
    if (!(await waitForSandboxProcessExit(pid, graceMs))) {
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T'], { timeout: Math.max(1000, forceAfterMs), windowsHide: true });
      } catch { /* the process may have exited between the probe and taskkill */ }
    }
    if (!(await waitForSandboxProcessExit(pid, forceAfterMs))) {
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: Math.max(1000, forceAfterMs), windowsHide: true });
      } catch { /* bounded force cleanup is best effort */ }
    }
  }
  sandboxLaunchPid = undefined;
  try { fs.unlinkSync(READY_PATH); } catch { /* stale marker is harmless */ }
  try { fs.unlinkSync(OWNER_PATH); } catch { /* stale marker is harmless */ }
  void reason;
}

function createSandboxTargetAdapter(): DesktopTargetAdapter {
  return {
    targetId: 'prometheus-local-windows-sandbox',
    kind: 'windows_sandbox',
    async start({ instanceId }): Promise<DesktopTargetStartResult> {
      if (process.platform !== 'win32') throw new Error('Windows Sandbox is only available on Windows.');
      ensureBridgeDirs();
      const previousOwner = ownerRecord();
      if (previousOwner?.pid && await sandboxProcessIsOwned(Number(previousOwner.pid))) {
        await stopSandboxProcess('replace_stale_sandbox', 2000, 3000);
      }
      try { fs.unlinkSync(READY_PATH); } catch { /* no prior ready marker */ }
      prepareSandboxFiles(lastSandboxOptions, instanceId);
      const child = spawn('WindowsSandbox.exe', [SANDBOX_CONFIG_PATH], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        child.once('spawn', () => {
          settled = true;
          resolve();
        });
        child.once('error', error => {
          if (!settled) reject(error);
        });
      });
      sandboxLaunchPid = child.pid || undefined;
      if (sandboxLaunchPid) {
        writeJsonFile(OWNER_PATH, {
          targetId: 'prometheus-local-windows-sandbox',
          instanceId,
          pid: sandboxLaunchPid,
          config: path.basename(SANDBOX_CONFIG_PATH),
          startedAt: Date.now(),
        });
      }
      child.unref();
      return { ownership: 'owned' };
    },
    async probe({ instanceId }): Promise<DesktopTargetProbe> {
      const ready = readyRecord(instanceId);
      if (!ready) return { ready: false };
      const owner = ownerRecord();
      const ownerPid = Number(owner?.pid || 0);
      const owned = String(owner?.instanceId || '') === String(ready.instanceId || '')
        && ownerPid > 0
        && await sandboxProcessExists(ownerPid)
        && await sandboxProcessIsOwned(ownerPid);
      return { ready: true, ownership: owned ? 'owned' : 'external' };
    },
    async waitUntilReady({ instanceId, timeoutMs }): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        if (readyRecord(instanceId)) return;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error(`Windows Sandbox readiness timed out after ${timeoutMs}ms.`);
    },
    async stop({ graceMs, forceAfterMs, reason }): Promise<void> {
      await stopSandboxProcess(reason, graceMs, forceAfterMs);
    },
  };
}

function envPositiveInt(name: string, fallback: number, minimum = 1): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

function getBackgroundRuntime(): DesktopTargetLeaseManager {
  if (!backgroundRuntime) {
    const adapter = TARGET_MODE === 'hyperv'
      ? createHyperVDesktopTargetAdapter()
      : TARGET_MODE === 'sandbox'
        ? createSandboxTargetAdapter()
        : null;
    if (!adapter) {
      throw new Error(
        `Desktop target mode '${TARGET_MODE}' is not wired to a supported lifecycle adapter. Configure the target transport before enabling it.`,
      );
    }
    backgroundRuntime = createDesktopTargetLeaseManager(adapter, {
      idleTimeoutMs: envPositiveInt('PROMETHEUS_DESKTOP_IDLE_TIMEOUT_MS', 10 * 60_000, 0),
      startTimeoutMs: envPositiveInt('PROMETHEUS_DESKTOP_START_TIMEOUT_MS', 120_000),
      stopGraceMs: envPositiveInt('PROMETHEUS_DESKTOP_STOP_GRACE_MS', 8_000, 0),
      stopForceAfterMs: envPositiveInt('PROMETHEUS_DESKTOP_STOP_FORCE_MS', 8_000, 0),
      warmMode: /^(1|true|yes)$/i.test(String(process.env.PROMETHEUS_DESKTOP_WARM_MODE || '')),
      statePath: RUNTIME_STATE_PATH,
      eventsPath: path.join(BACKGROUND_ROOT, 'desktop-target-events.ndjson'),
    });
  }
  return backgroundRuntime;
}

export async function desktopBackgroundStatus(): Promise<string> {
  ensureBridgeDirs();
  const sandboxFeature = await getWindowsFeatureState('Containers-DisposableClientVM');
  const hyperVFeature = await getWindowsFeatureState('Microsoft-Hyper-V-All');
  const vmms = await getServiceState('vmms');
  const termsrv = await getServiceState('TermService');
  const workerUrl = String(process.env.PROMETHEUS_DESKTOP_WORKER_URL || '').trim();
  const staleAfterMs = Math.max(60_000, Number(process.env.PROMETHEUS_DESKTOP_BACKGROUND_STALE_MS || 15 * 60_000));
  const now = Date.now();
  const pendingFiles = fs.readdirSync(INBOX_DIR).filter((f) => f.endsWith('.json'));
  let staleCleaned = 0;
  for (const file of pendingFiles) {
    const source = path.join(INBOX_DIR, file);
    try {
      if (now - fs.statSync(source).mtimeMs > staleAfterMs) {
        fs.renameSync(source, path.join(PROCESSED_DIR, `stale-${file}`));
        staleCleaned++;
      }
    } catch { /* queue item may be concurrently claimed */ }
  }
  const pending = fs.readdirSync(INBOX_DIR).filter((f) => f.endsWith('.json')).length;
  const completed = fs.readdirSync(OUTBOX_DIR).filter((f) => f.endsWith('.json')).length;
  const sandboxReady = /enabled/i.test(sandboxFeature);
  const externalReady = /^https?:\/\//i.test(workerUrl);
  const readiness = externalReady || sandboxReady ? 'background_available' : 'foreground_only';
  let lifecycle = 'unavailable';
  try {
    lifecycle = JSON.stringify(getBackgroundRuntime().status());
  } catch (error: any) {
    lifecycle = `unavailable: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 240)}`;
  }

  return [
    'Desktop background automation status',
    `- Readiness: ${readiness}`,
    `- Host desktop tools: foreground-only. They use the active Windows input desktop, so clicks/keys can interrupt the user.`,
    `- Bridge directory: ${BRIDGE_DIR}`,
    `- Bridge queue: ${pending} pending, ${completed} completed result file(s).`,
    `- Stale queue cleanup: ${staleCleaned} item(s) moved to processed; threshold=${staleAfterMs}ms.`,
    `- Windows Sandbox feature: ${sandboxFeature || 'unknown'}`,
    `- Hyper-V feature: ${hyperVFeature || 'unknown'}; vmms service: ${vmms || 'unknown'}`,
    `- Remote Desktop service: ${termsrv || 'unknown'}`,
    `- External desktop worker URL: ${workerUrl || '(not configured)'}`,
    `- Target lifecycle: mode=${TARGET_MODE}; ${lifecycle}`,
    `- Lifecycle telemetry: ${RUNTIME_STATE_PATH}`,
    `- Lifecycle event telemetry: ${path.join(BACKGROUND_ROOT, 'desktop-target-events.ndjson')}`,
    '',
    readiness === 'foreground_only' ? 'Setup: enable Windows Sandbox or configure PROMETHEUS_DESKTOP_WORKER_URL. Until then, background commands are unavailable and host automation may interrupt the user.' : 'A background execution target is configured.',
    'The sandbox worker supports window discovery/state/accessibility plus global and window-scoped input. Host and worker identities are separate; always call background list_windows before targeting a worker window.',
  ].join('\n');
}

export async function desktopBackgroundPrepareSandbox(options: DesktopBackgroundPrepareOptions = {}): Promise<string> {
  if (process.platform !== 'win32') {
    return 'ERROR: Windows Sandbox background desktop target is only available on Windows hosts.';
  }
  if (TARGET_MODE !== 'sandbox') {
    return `ERROR: [BACKGROUND_TARGET_MODE] desktop_background_prepare_sandbox cannot run while PROMETHEUS_DESKTOP_TARGET_MODE=${TARGET_MODE}.`;
  }
  lastSandboxOptions = { ...options, session_id: undefined, launch: undefined };
  prepareSandboxFiles(lastSandboxOptions, 'manual');

  if (options.launch === true) {
    let lease: Awaited<ReturnType<DesktopTargetLeaseManager['acquire']>> | undefined;
    try {
      lease = await getBackgroundRuntime().acquire(options.session_id);
      lease.renew();
    } catch (error: any) {
      return `ERROR: [BACKGROUND_TARGET_START_FAILED] ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 400)}`;
    } finally {
      lease?.release();
    }
  }

  return [
    'Background desktop sandbox prepared.',
    `Config: ${SANDBOX_CONFIG_PATH}`,
    `Worker: ${WORKER_PATH}`,
    `Bridge: ${BRIDGE_DIR}`,
    options.launch === true ? 'Launch requested through the session lease. The target remains warm until the configured idle timeout.' : 'Launch not requested. The target will start automatically when the first background command acquires a lease.',
  ].join('\n');
}

function commandId(): string {
  return `bd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function waitForFile(filePath: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfDesktopCancelled(signal);
    if (fs.existsSync(filePath)) return true;
    await desktopAbortableDelay(200, signal);
  }
  return fs.existsSync(filePath);
}

export async function desktopBackgroundCommand(args: DesktopBackgroundCommandArgs): Promise<string> {
  ensureBridgeDirs();
  const action = String(args?.action || '').toLowerCase() as DesktopBackgroundAction;
  const supportedActions: DesktopBackgroundAction[] = ['screenshot', 'list_windows', 'get_window_state', 'accessibility_tree', 'click', 'window_click', 'type', 'window_type', 'key', 'window_key', 'run', 'wait'];
  if (!supportedActions.includes(action)) {
    return `ERROR: [INVALID_ARGUMENT] desktop_background command action must be one of ${supportedActions.join(', ')}.`;
  }
  if ((action === 'click' || action === 'window_click') && (!Number.isFinite(Number(args.x)) || !Number.isFinite(Number(args.y)))) {
    return `ERROR: [INVALID_ARGUMENT] ${action} requires numeric x and y.`;
  }
  if ((action === 'type' || action === 'window_type') && args.text == null) return `ERROR: [INVALID_ARGUMENT] ${action} requires text.`;
  if ((action === 'key' || action === 'window_key') && !String(args.key || '').trim()) return `ERROR: [INVALID_ARGUMENT] ${action} requires key.`;
  if (action === 'run' && !String(args.command || '').trim()) return 'ERROR: desktop_background_command run requires command.';
  if (['get_window_state', 'accessibility_tree', 'window_click', 'window_type', 'window_key'].includes(action) && !String(args.window_id || args.title || '').trim()) {
    return `ERROR: [INVALID_ARGUMENT] ${action} requires window_id or title from background list_windows.`;
  }
  throwIfDesktopCancelled(args.signal);
  if (TARGET_MODE !== 'sandbox') {
    return `ERROR: [BACKGROUND_TRANSPORT_UNAVAILABLE] Target mode '${TARGET_MODE}' has lifecycle control but no command transport in this repository. Configure the external worker protocol before enabling background commands.`;
  }

  let lease: Awaited<ReturnType<DesktopTargetLeaseManager['acquire']>> | undefined;
  try {
    lease = await getBackgroundRuntime().acquire(args.session_id, args.signal);
    lease.renew();
  } catch (error: any) {
    if (isDesktopCancellationError(error) || error?.name === 'AbortError') {
      return 'ERROR: [DESKTOP_CANCELLED] Background desktop target acquisition was interrupted.';
    }
    return `ERROR: [BACKGROUND_TARGET_START_FAILED] ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 400)}`;
  }

  try {
    const id = commandId();
    const commandPath = path.join(INBOX_DIR, `${id}.json`);
    const resultPath = path.join(OUTBOX_DIR, `${id}.json`);
    const { signal, session_id: _sessionId, ...serializableArgs } = args;
    const payload = { ...serializableArgs, action, id, createdAt: Date.now() };
    fs.writeFileSync(commandPath, JSON.stringify(payload, null, 2), 'utf-8');

    const timeoutMs = Math.max(1000, Math.min(120000, Number(args.timeout_ms || 15000)));
    let ready = false;
    try {
      ready = await waitForFile(resultPath, timeoutMs, signal);
    } catch (error) {
      if (isDesktopCancellationError(error)) {
        try { fs.unlinkSync(commandPath); } catch { /* worker may already own it */ }
        return 'ERROR: [DESKTOP_CANCELLED] Background desktop command was interrupted.';
      }
      throw error;
    }
    lease.renew();
    if (!ready) {
      return [
        `ERROR: [BACKGROUND_TIMEOUT] Background desktop worker did not respond within ${timeoutMs}ms.`,
        `Command queued at: ${commandPath}`,
        'The target lease remains protected from immediate shutdown and will be reclaimed after the configured idle timeout.',
      ].join('\n');
    }

    const raw = fs.readFileSync(resultPath, 'utf-8');
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch {}
    if (!parsed) return raw;

    const lines = [
      parsed.ok === false ? 'ERROR: [BACKGROUND_FAILED] Background desktop command failed.' : 'Background desktop command complete.',
      `Action: ${parsed.action || action}`,
    ];
    const directScreenshotFile = String(parsed.screenshotFile || (parsed.screenshotPath ? path.basename(String(parsed.screenshotPath)) : '')).trim();
    const nestedScreenshotFile = String(parsed.screenshot?.screenshotFile || (parsed.screenshot?.screenshotPath ? path.basename(String(parsed.screenshot.screenshotPath)) : '')).trim();
    if (directScreenshotFile) lines.push(`Screenshot: ${path.join(SCREENSHOTS_DIR, directScreenshotFile)}`, `Size: ${parsed.width}x${parsed.height}`);
    if (nestedScreenshotFile) lines.push(`Screenshot: ${path.join(SCREENSHOTS_DIR, nestedScreenshotFile)}`, `Size: ${parsed.screenshot.width}x${parsed.screenshot.height}`);
    if (parsed.output) lines.push(`Output:\n${String(parsed.output).slice(0, 4000)}`);
    if (parsed.error) lines.push(`Error: ${parsed.error}`);
    const structured = { ...parsed };
    delete structured.output;
    if (Object.keys(structured).some((key) => !['ok', 'action', 'worker', 'completedAt', 'screenshotPath', 'width', 'height', 'left', 'top', 'error'].includes(key))) {
      lines.push(`Data:\n${JSON.stringify(structured, null, 2).slice(0, 30_000)}`);
    }
    return lines.join('\n');
  } finally {
    lease.release();
  }
}

export function desktopBackgroundReleaseSession(sessionId?: string): void {
  try { backgroundRuntime?.releaseSession(sessionId); } catch { /* lifecycle cleanup is best effort */ }
}

export async function desktopBackgroundShutdown(): Promise<void> {
  // Rehydrate persisted ownership on a clean gateway restart so an owned
  // target is not stranded merely because this process has not served a
  // desktop command yet. Recovery only probes the configured exact target; it
  // never starts a target during shutdown.
  const runtime = backgroundRuntime || getBackgroundRuntime();
  await runtime.shutdown();
}

export function desktopBackgroundRuntimeStatus(): ReturnType<DesktopTargetLeaseManager['status']> | null {
  try { return getBackgroundRuntime().status(); } catch { return null; }
}
