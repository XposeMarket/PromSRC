import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import net from 'net';
import { getConfig } from '../../config/config';
import { resolveWin32DesktopHelperPath } from '../desktop-platform-win32-helper';
import type { ProcessShell } from './types';

export interface ElevatedCommandInput {
  command: string;
  cwd: string;
  shell?: ProcessShell;
  timeoutMs?: number;
}

export interface ElevatedCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  elevated: true;
}

function psLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsQuotedArg(value: string): string {
  const text = String(value);
  if (text.includes('"')) throw new Error('Elevated helper paths cannot contain quotation marks.');
  return `"${text}"`;
}

function readOutputFile(filePath: string, maxBytes = 4 * 1024 * 1024): string {
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const size = Math.max(0, stat.size - start);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, start);
    return `${start > 0 ? `[output truncated to last ${maxBytes} bytes]\n` : ''}${buffer.toString('utf8')}`;
  } finally {
    fs.closeSync(fd);
  }
}

async function runLauncher(script: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Windows administrator broker setup timed out.'));
    }, Math.max(30_000, timeoutMs + 30_000));
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

interface BrokerIdentity {
  protocol: 2;
  sid: string;
  sidHash: string;
  pipeName: string;
  taskName: string;
  gatewayPort: number;
  allowedClient: string;
  installedHelper: string;
  queueDir: string;
}

function getBrokerIdentity(queueDir: string): BrokerIdentity {
  const sid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  }).trim();
  if (!/^S-1-\d+(?:-\d+)+$/i.test(sid)) throw new Error('Could not resolve the current Windows user SID for the administrator broker.');
  const sidHash = crypto.createHash('sha256').update(sid).digest('hex').slice(0, 16);
  const gatewayPort = Number((getConfig().getConfig() as any)?.gateway?.port || process.env.GATEWAY_PORT || 18789);
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error('Prometheus gateway port is invalid for the administrator broker.');
  const programData = String(process.env.ProgramData || 'C:\\ProgramData');
  return {
    protocol: 2,
    sid,
    sidHash,
    pipeName: `\\\\.\\pipe\\PrometheusElevatedBroker-${sidHash}`,
    taskName: `Prometheus Elevated Broker ${sidHash}`,
    gatewayPort,
    allowedClient: path.resolve(process.execPath),
    installedHelper: path.join(programData, 'Prometheus', 'ElevatedBroker', sidHash, 'prometheus-elevated-helper.exe'),
    queueDir,
  };
}

function taskExists(taskName: string): boolean {
  try {
    execFileSync('schtasks.exe', ['/Query', '/TN', taskName], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function brokerMetadataMatches(identity: BrokerIdentity): boolean {
  const metadataPath = path.join(identity.queueDir, 'broker-install.json');
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return metadata.protocol === identity.protocol
      && String(metadata.sid) === identity.sid
      && path.resolve(String(metadata.allowedClient || '')) === identity.allowedClient
      && Number(metadata.gatewayPort) === identity.gatewayPort
      && taskExists(identity.taskName);
  } catch {
    return false;
  }
}

async function installBroker(identity: BrokerIdentity, sourceHelper: string): Promise<void> {
  const taskArgs = [
    '--elevated-broker',
    identity.pipeName,
    identity.queueDir,
    identity.allowedClient,
    identity.sid,
    String(identity.gatewayPort),
  ].map(windowsQuotedArg).join(' ');
  const installDir = path.dirname(identity.installedHelper);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$sid = ${psLiteral(identity.sid)}`,
    `$installDir = ${psLiteral(installDir)}`,
    `$taskName = ${psLiteral(identity.taskName)}`,
    `if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }`,
    `Get-CimInstance Win32_Process -Filter "Name='prometheus-elevated-helper.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq ${psLiteral(identity.installedHelper)} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    `Start-Sleep -Milliseconds 250`,
    `New-Item -ItemType Directory -Force -Path $installDir | Out-Null`,
    `Copy-Item -LiteralPath ${psLiteral(sourceHelper)} -Destination ${psLiteral(identity.installedHelper)} -Force`,
    `& icacls.exe $installDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ('*' + $sid + ':(OI)(CI)RX') | Out-Null`,
    `$action = New-ScheduledTaskAction -Execute ${psLiteral(identity.installedHelper)} -Argument ${psLiteral(taskArgs)}`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid`,
    `$principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Highest`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew`,
    `Register-ScheduledTask -TaskName ${psLiteral(identity.taskName)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${psLiteral(identity.taskName)}`,
  ].join('\n');
  const encodedSetup = Buffer.from(script, 'utf16le').toString('base64');
  const elevationScript = [
    "$ErrorActionPreference = 'Stop'",
    `$setupArgs = ${psLiteral(`-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedSetup}`)}`,
    `$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $setupArgs -WindowStyle Hidden -Wait -PassThru`,
    'exit $p.ExitCode',
  ].join('\n');
  const setup = await runLauncher(elevationScript, 120_000);
  if (setup.code !== 0) {
    const detail = [setup.stderr, setup.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Administrator broker setup was cancelled or failed${detail ? `: ${detail.slice(0, 1200)}` : '.'}`);
  }
  fs.writeFileSync(path.join(identity.queueDir, 'broker-install.json'), JSON.stringify({
    protocol: identity.protocol,
    sid: identity.sid,
    allowedClient: identity.allowedClient,
    gatewayPort: identity.gatewayPort,
    installedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
}

function triggerBroker(identity: BrokerIdentity): void {
  try {
    execFileSync('schtasks.exe', ['/Run', '/TN', identity.taskName], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
  } catch {}
}

async function sendBrokerRequest(identity: BrokerIdentity, payload: Record<string, string>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + 12_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(identity.pipeName);
        let response = '';
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          socket.destroy();
          reject(new Error('Administrator broker command timed out.'));
        }, Math.max(30_000, timeoutMs + 15_000));
        const settleFromResponse = (): boolean => {
          if (settled || !response) return settled;
          try {
            const parsed = JSON.parse(response);
            settled = true;
            clearTimeout(timer);
            // Windows message-mode named pipes can emit read EPIPE after the
            // server has delivered its complete response and disconnects.
            // Close locally as soon as the JSON response is complete so that
            // trailing transport signal cannot overwrite the broker result.
            socket.destroy();
            if (parsed.ok === true) resolve();
            else reject(new Error(String(parsed.error || 'Administrator broker rejected the command.')));
            return true;
          } catch {
            return false;
          }
        };
        const fail = (error: Error): void => {
          if (settled || settleFromResponse()) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        };
        socket.once('connect', () => socket.write(JSON.stringify(payload)));
        socket.on('data', (chunk) => {
          response += chunk.toString('utf8');
          settleFromResponse();
        });
        socket.once('error', fail);
        socket.once('close', () => {
          if (!settleFromResponse()) fail(new Error('Administrator broker closed without a response.'));
        });
      });
      return;
    } catch (error: any) {
      lastError = String(error?.message || error);
      triggerBroker(identity);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new Error(`Could not connect to the installed administrator broker: ${lastError || 'unknown error'}`);
}

/**
 * Run one bounded command through the installed Windows administrator broker.
 * The immutable command-line SHA-256 binds the elevated helper to the exact
 * request reviewed by the user and detects any request-file tampering.
 */
export async function runElevatedCommand(input: ElevatedCommandInput): Promise<ElevatedCommandResult> {
  if (process.platform !== 'win32') throw new Error('Administrator command execution is currently supported on Windows only.');
  const command = String(input.command || '').trim();
  if (!command) throw new Error('Elevated command is required.');
  const cwd = path.resolve(String(input.cwd || getConfig().getWorkspacePath() || process.cwd()));
  const helperPath = resolveWin32DesktopHelperPath();
  if (!fs.existsSync(helperPath)) {
    throw new Error(`Windows elevated helper was not found at ${helperPath}. Reinstall Prometheus or rebuild the desktop helper.`);
  }

  const timeoutMs = Math.max(1_000, Math.min(24 * 60 * 60 * 1000, Number(input.timeoutMs || 120_000)));
  const root = path.join(getConfig().getConfigDir(), 'elevated-runs');
  fs.mkdirSync(root, { recursive: true });
  const broker = getBrokerIdentity(root);
  const runId = `admin_${Date.now()}_${crypto.randomBytes(12).toString('hex')}`;
  const requestPath = path.join(root, `${runId}.request.json`);
  const resultPath = path.join(root, `${runId}.result.json`);
  const stdoutPath = `${resultPath}.stdout`;
  const stderrPath = `${resultPath}.stderr`;
  const request = JSON.stringify({
    version: 1,
    commandBase64: Buffer.from(command, 'utf8').toString('base64'),
    cwdBase64: Buffer.from(cwd, 'utf8').toString('base64'),
    shell: input.shell || 'auto',
    timeoutMs,
  });
  fs.writeFileSync(requestPath, request, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const requestHash = crypto.createHash('sha256').update(request, 'utf8').digest('hex');

  try {
    if (!brokerMetadataMatches(broker)) await installBroker(broker, helperPath);
    await sendBrokerRequest(broker, {
      requestPathBase64: Buffer.from(requestPath, 'utf8').toString('base64'),
      resultPathBase64: Buffer.from(resultPath, 'utf8').toString('base64'),
      requestHash,
    }, timeoutMs);
    if (!fs.existsSync(resultPath)) {
      throw new Error('The administrator broker completed without a command result.');
    }
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (result.ok !== true && typeof result.exitCode !== 'number') {
      throw new Error(String(result.error || 'The elevated helper failed.'));
    }
    return {
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : null,
      stdout: readOutputFile(stdoutPath),
      stderr: readOutputFile(stderrPath),
      timedOut: result.timedOut === true,
      elevated: true,
    };
  } finally {
    for (const filePath of [requestPath, resultPath, stdoutPath, stderrPath]) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}
