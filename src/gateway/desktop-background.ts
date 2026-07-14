import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { desktopAbortableDelay, isDesktopCancellationError, throwIfDesktopCancelled } from './desktop-cancellation.js';

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
  signal?: AbortSignal;
}

export interface DesktopBackgroundPrepareOptions {
  launch?: boolean;
  networking?: 'enable' | 'disable' | 'default';
  vgpu?: 'enable' | 'disable' | 'default';
  memory_mb?: number;
}

const BACKGROUND_ROOT = path.resolve(process.cwd(), '.prometheus', 'desktop-background');
const BRIDGE_DIR = path.join(BACKGROUND_ROOT, 'bridge');
const INBOX_DIR = path.join(BRIDGE_DIR, 'inbox');
const OUTBOX_DIR = path.join(BRIDGE_DIR, 'outbox');
const PROCESSED_DIR = path.join(BRIDGE_DIR, 'processed');
const SCREENSHOTS_DIR = path.join(BRIDGE_DIR, 'screenshots');
const WORKER_PATH = path.join(BRIDGE_DIR, 'worker.ps1');
const SANDBOX_CONFIG_PATH = path.join(BACKGROUND_ROOT, 'prometheus-background-desktop.wsb');

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

export function buildDesktopBackgroundWorkerScript(): string {
  return String.raw`$ErrorActionPreference = "Continue"

$Bridge = Split-Path -Parent $MyInvocation.MyCommand.Path
$Inbox = Join-Path $Bridge "inbox"
$Outbox = Join-Path $Bridge "outbox"
$Processed = Join-Path $Bridge "processed"
$Screenshots = Join-Path $Bridge "screenshots"
New-Item -ItemType Directory -Force -Path $Inbox,$Outbox,$Processed,$Screenshots | Out-Null

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
    '',
    readiness === 'foreground_only' ? 'Setup: enable Windows Sandbox or configure PROMETHEUS_DESKTOP_WORKER_URL. Until then, background commands are unavailable and host automation may interrupt the user.' : 'A background execution target is configured.',
    'The sandbox worker supports window discovery/state/accessibility plus global and window-scoped input. Host and worker identities are separate; always call background list_windows before targeting a worker window.',
  ].join('\n');
}

export async function desktopBackgroundPrepareSandbox(options: DesktopBackgroundPrepareOptions = {}): Promise<string> {
  if (process.platform !== 'win32') {
    return 'ERROR: Windows Sandbox background desktop target is only available on Windows hosts.';
  }
  ensureBridgeDirs();
  fs.writeFileSync(WORKER_PATH, buildDesktopBackgroundWorkerScript(), 'utf-8');
  fs.writeFileSync(SANDBOX_CONFIG_PATH, sandboxConfigXml(options), 'utf-8');
  fs.writeFileSync(
    path.join(BRIDGE_DIR, 'README.txt'),
    [
      'Prometheus background desktop bridge',
      '',
      'Open the .wsb file to start an isolated Windows Sandbox desktop.',
      'The sandbox logon command runs worker.ps1 from this mapped folder.',
      'Prometheus writes command JSON files to inbox and reads results from outbox.',
    ].join(os.EOL),
    'utf-8',
  );

  if (options.launch === true) {
    spawn('cmd.exe', ['/c', 'start', '', SANDBOX_CONFIG_PATH], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  }

  return [
    'Background desktop sandbox prepared.',
    `Config: ${SANDBOX_CONFIG_PATH}`,
    `Worker: ${WORKER_PATH}`,
    `Bridge: ${BRIDGE_DIR}`,
    options.launch === true ? 'Launch requested. Wait for Windows Sandbox to finish logging in before sending commands.' : 'Launch not requested. Open the .wsb config when you want the isolated desktop worker.',
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

  const id = commandId();
  const commandPath = path.join(INBOX_DIR, `${id}.json`);
  const resultPath = path.join(OUTBOX_DIR, `${id}.json`);
  const { signal, ...serializableArgs } = args;
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
  if (!ready) {
    return [
      `ERROR: [BACKGROUND_TIMEOUT] Background desktop worker did not respond within ${timeoutMs}ms.`,
      `Command queued at: ${commandPath}`,
      'Start the sandbox/VM worker with desktop_background_prepare_sandbox({ launch:true }) or check the bridge folder.',
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
}
