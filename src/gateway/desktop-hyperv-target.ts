import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  DesktopTargetAdapter,
  DesktopTargetProbe,
  DesktopTargetStartResult,
} from './desktop-target-lease.js';

const execFileAsync = promisify(execFile);
const OWNER_FILE = path.resolve(process.cwd(), '.prometheus', 'desktop-hyperv-owner.json');

function psQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runPowerShell(script: string, timeoutMs = 10_000): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return String(stdout || stderr || '').trim();
}

type HyperVSnapshot = {
  state: string;
  status: string;
  ipAddresses: string[];
};

async function readSnapshot(vmName: string): Promise<HyperVSnapshot | null> {
  const quoted = psQuote(vmName);
  const script = [
    `$vm = Get-VM -Name ${quoted} -ErrorAction SilentlyContinue`,
    'if ($null -eq $vm) { exit 3 }',
    `$ips = @(Get-VMNetworkAdapter -VMName ${quoted} -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddresses } | Where-Object { $_ })`,
    '[pscustomobject]@{ state = [string]$vm.State; status = [string]$vm.Status; ipAddresses = @($ips) } | ConvertTo-Json -Compress',
  ].join('; ');
  try {
    const raw = await runPowerShell(script, 5000);
    const parsed = JSON.parse(raw) as any;
    return {
      state: String(parsed?.state || ''),
      status: String(parsed?.status || ''),
      ipAddresses: Array.isArray(parsed?.ipAddresses)
        ? parsed.ipAddresses.map((value: any) => String(value)).filter(Boolean)
        : parsed?.ipAddresses ? [String(parsed.ipAddresses)] : [],
    };
  } catch {
    return null;
  }
}

function readOwner(vmName: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8')) as Record<string, any>;
    return String(parsed.vmName || '') === vmName ? parsed : null;
  } catch {
    return null;
  }
}

function writeOwner(vmName: string, instanceId: string): void {
  fs.mkdirSync(path.dirname(OWNER_FILE), { recursive: true });
  fs.writeFileSync(OWNER_FILE, JSON.stringify({
    vmName,
    instanceId,
    ownerPid: process.pid,
    startedAt: Date.now(),
  }), 'utf8');
}

function clearOwner(vmName: string): void {
  const owner = readOwner(vmName);
  if (!owner) return;
  try { fs.unlinkSync(OWNER_FILE); } catch { /* diagnostics cleanup is best effort */ }
}

async function readyForUse(snapshot: HyperVSnapshot, readyUrl: string, requireIp: boolean): Promise<boolean> {
  if (!/^running$/i.test(snapshot.state)) return false;
  if (requireIp && snapshot.ipAddresses.length === 0) return false;
  if (!readyUrl) return true;
  try {
    const response = await fetch(readyUrl, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

export interface HyperVDesktopTargetOptions {
  vmName?: string;
  readyUrl?: string;
  requireIp?: boolean;
}

export function createHyperVDesktopTargetAdapter(options: HyperVDesktopTargetOptions = {}): DesktopTargetAdapter {
  const vmName = String(options.vmName || process.env.PROMETHEUS_DESKTOP_VM_NAME || 'Prometheus-Desktop').trim();
  if (!vmName) throw new Error('PROMETHEUS_DESKTOP_VM_NAME must not be empty.');
  const readyUrl = String(options.readyUrl || process.env.PROMETHEUS_DESKTOP_VM_READY_URL || '').trim();
  const requireIp = options.requireIp ?? !/^(0|false|no)$/i.test(String(process.env.PROMETHEUS_DESKTOP_VM_REQUIRE_IP || '1'));

  return {
    targetId: `hyperv:${vmName}`,
    kind: 'hyperv_vm',
    async start({ instanceId }): Promise<DesktopTargetStartResult> {
      if (process.platform !== 'win32') throw new Error('Hyper-V desktop targets are only available on Windows.');
      const current = await readSnapshot(vmName);
      if (!current) throw new Error(`Hyper-V VM '${vmName}' was not found or could not be inspected.`);
      if (/^running$/i.test(current.state)) {
        const owner = readOwner(vmName);
        if (owner) writeOwner(vmName, instanceId);
        return { ownership: owner ? 'owned' : 'external', detail: 'already_running' };
      }
      const quoted = psQuote(vmName);
      await runPowerShell(`Start-VM -Name ${quoted} -ErrorAction Stop | Out-Null`, 30_000);
      writeOwner(vmName, instanceId);
      return { ownership: 'owned', detail: 'started' };
    },
    async probe({ instanceId }): Promise<DesktopTargetProbe> {
      const snapshot = await readSnapshot(vmName);
      if (!snapshot || !(await readyForUse(snapshot, readyUrl, requireIp))) return { ready: false };
      const owner = readOwner(vmName);
      const owned = !!owner && (!instanceId || String(owner.instanceId || '') === instanceId);
      return { ready: true, ownership: owned ? 'owned' : 'external', detail: snapshot.status };
    },
    async waitUntilReady({ timeoutMs }): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const snapshot = await readSnapshot(vmName);
        if (snapshot && await readyForUse(snapshot, readyUrl, requireIp)) return;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error(`Hyper-V VM '${vmName}' did not become ready within ${timeoutMs}ms.`);
    },
    async stop({ graceMs, forceAfterMs }): Promise<void> {
      const owner = readOwner(vmName);
      if (!owner) return;
      const quoted = psQuote(vmName);
      try {
        // On Windows PowerShell's Hyper-V module, Stop-VM without -TurnOff or
        // -Save requests the guest integration-service shutdown. The newer
        // -Shutdown switch is not present on all supported hosts.
        await runPowerShell(`Stop-VM -Name ${quoted} -ErrorAction SilentlyContinue | Out-Null`, Math.max(5000, graceMs));
      } catch { /* the guest may already be rebooting or unreachable */ }
      const gracefulDeadline = Date.now() + Math.max(0, graceMs);
      while (Date.now() <= gracefulDeadline) {
        const snapshot = await readSnapshot(vmName);
        if (!snapshot || /^off$/i.test(snapshot.state)) {
          clearOwner(vmName);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      try {
        await runPowerShell(`Stop-VM -Name ${quoted} -TurnOff -ErrorAction SilentlyContinue`, Math.max(5000, forceAfterMs));
      } finally {
        clearOwner(vmName);
      }
    },
  };
}
