import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type DesktopBackgroundAction = 'screenshot' | 'click' | 'type' | 'key' | 'run' | 'wait';

export interface DesktopBackgroundCommandArgs {
  action: DesktopBackgroundAction;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  command?: string;
  ms?: number;
  timeout_ms?: number;
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

function workerScript(): string {
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
  return @{ ok = $true; action = "screenshot"; screenshotPath = $file; width = $width; height = $height; left = $left; top = $top }
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
      } elseif ($action -eq "click") {
        [PrometheusInput]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
        [PrometheusInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [PrometheusInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        $result.x = [int]$cmd.x
        $result.y = [int]$cmd.y
      } elseif ($action -eq "type") {
        Set-Clipboard -Value ([string]$cmd.text)
        [System.Windows.Forms.SendKeys]::SendWait("^v")
      } elseif ($action -eq "key") {
        [System.Windows.Forms.SendKeys]::SendWait([string]$cmd.key)
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
  const pending = fs.readdirSync(INBOX_DIR).filter((f) => f.endsWith('.json')).length;
  const completed = fs.readdirSync(OUTBOX_DIR).filter((f) => f.endsWith('.json')).length;

  return [
    'Desktop background automation status',
    `- Host desktop tools: foreground-only. They use the active Windows input desktop, so clicks/keys can interrupt the user.`,
    `- Bridge directory: ${BRIDGE_DIR}`,
    `- Bridge queue: ${pending} pending, ${completed} completed result file(s).`,
    `- Windows Sandbox feature: ${sandboxFeature || 'unknown'}`,
    `- Hyper-V feature: ${hyperVFeature || 'unknown'}; vmms service: ${vmms || 'unknown'}`,
    `- Remote Desktop service: ${termsrv || 'unknown'}`,
    `- External desktop worker URL: ${workerUrl || '(not configured)'}`,
    '',
    'Recommended implementation path: run a Prometheus desktop worker inside Windows Sandbox, Hyper-V, or a remote VM and route background desktop_* actions to that worker. The host remains usable because Prometheus communicates through the bridge instead of injecting input into the host desktop.',
  ].join('\n');
}

export async function desktopBackgroundPrepareSandbox(options: DesktopBackgroundPrepareOptions = {}): Promise<string> {
  if (process.platform !== 'win32') {
    return 'ERROR: Windows Sandbox background desktop target is only available on Windows hosts.';
  }
  ensureBridgeDirs();
  fs.writeFileSync(WORKER_PATH, workerScript(), 'utf-8');
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

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return fs.existsSync(filePath);
}

export async function desktopBackgroundCommand(args: DesktopBackgroundCommandArgs): Promise<string> {
  ensureBridgeDirs();
  const action = String(args?.action || '').toLowerCase() as DesktopBackgroundAction;
  if (!['screenshot', 'click', 'type', 'key', 'run', 'wait'].includes(action)) {
    return 'ERROR: desktop_background_command action must be one of screenshot, click, type, key, run, wait.';
  }
  if (action === 'click' && (!Number.isFinite(Number(args.x)) || !Number.isFinite(Number(args.y)))) {
    return 'ERROR: desktop_background_command click requires numeric x and y.';
  }
  if (action === 'type' && args.text == null) return 'ERROR: desktop_background_command type requires text.';
  if (action === 'key' && !String(args.key || '').trim()) return 'ERROR: desktop_background_command key requires key.';
  if (action === 'run' && !String(args.command || '').trim()) return 'ERROR: desktop_background_command run requires command.';

  const id = commandId();
  const commandPath = path.join(INBOX_DIR, `${id}.json`);
  const resultPath = path.join(OUTBOX_DIR, `${id}.json`);
  const payload = { ...args, action, id, createdAt: Date.now() };
  fs.writeFileSync(commandPath, JSON.stringify(payload, null, 2), 'utf-8');

  const timeoutMs = Math.max(1000, Math.min(120000, Number(args.timeout_ms || 15000)));
  const ready = await waitForFile(resultPath, timeoutMs);
  if (!ready) {
    return [
      `ERROR: background desktop worker did not respond within ${timeoutMs}ms.`,
      `Command queued at: ${commandPath}`,
      'Start the sandbox/VM worker with desktop_background_prepare_sandbox({ launch:true }) or check the bridge folder.',
    ].join('\n');
  }

  const raw = fs.readFileSync(resultPath, 'utf-8');
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!parsed) return raw;

  const lines = [
    parsed.ok === false ? 'ERROR: background desktop command failed.' : 'Background desktop command complete.',
    `Action: ${parsed.action || action}`,
  ];
  if (parsed.screenshotPath) lines.push(`Screenshot: ${parsed.screenshotPath}`, `Size: ${parsed.width}x${parsed.height}`);
  if (parsed.output) lines.push(`Output:\n${String(parsed.output).slice(0, 4000)}`);
  if (parsed.error) lines.push(`Error: ${parsed.error}`);
  return lines.join('\n');
}
