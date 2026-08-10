import os from 'os';

export interface RuntimeHostContextOptions {
  workspacePath?: string;
  gpu?: string;
}

function platformLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin': return 'macOS';
    case 'win32': return 'Windows';
    case 'linux': return 'Linux';
    case 'freebsd': return 'FreeBSD';
    case 'openbsd': return 'OpenBSD';
    case 'android': return 'Android';
    case 'aix': return 'AIX';
    default: return platform;
  }
}

function executableName(value: string): string {
  const normalized = String(value || '').trim().replace(/[\\/]+$/, '');
  if (!normalized) return '';
  return normalized.split(/[\\/]/).pop() || normalized;
}

function singleLine(value: unknown, fallback = 'unknown'): string {
  const normalized = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function shellDetails(platform: NodeJS.Platform): { name: string; commandShell: string; guidance: string } {
  if (platform === 'win32') {
    const configured = executableName(process.env.PROMETHEUS_POWERSHELL_PATH || 'powershell.exe');
    return {
      name: configured || 'powershell.exe',
      commandShell: 'powershell',
      guidance: 'Use PowerShell syntax for Windows commands. Use shell:"powershell" when syntax is PowerShell-specific; use shell:"cmd" only for cmd.exe syntax.',
    };
  }

  const configured = executableName(process.env.SHELL || '/bin/bash');
  return {
    name: configured || 'bash',
    commandShell: 'bash',
    guidance: 'Use POSIX shell syntax. Use shell:"bash" for commands that depend on shell syntax; do not emit Windows cmd.exe or PowerShell syntax.',
  };
}

function formatGiB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
  return `${(bytes / (1024 ** 3)).toFixed(1)} GiB`;
}

/**
 * Builds the small machine-context block included in every Prometheus turn.
 *
 * These are execution-host facts, not an attempt to identify the user. Do not
 * add hostnames, usernames, home directories, network addresses, or hardware
 * serials here: they are not needed to choose a command and are unnecessarily
 * identifying. The workspace path is included because it is the command/file
 * execution root already in scope for the agent.
 */
export function buildRuntimeHostContext(options: RuntimeHostContextOptions = {}): string {
  const platform = process.platform;
  const shell = shellDetails(platform);
  const cpus = os.cpus();
  const firstCpu = cpus.find((cpu) => String(cpu?.model || '').trim());
  const logicalCores = cpus.length || 'unknown';
  const availableParallelism = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : logicalCores;
  const workspacePath = String(options.workspacePath || '').trim();
  const gpu = String(options.gpu || '').trim();

  return [
    '[RUNTIME_HOST_CONTEXT]',
    'These facts describe the host where Prometheus runtime tools execute. They are authoritative for command syntax; do not infer a different OS from the user message.',
    `platform: ${platformLabel(platform)} (${platform})`,
    `os_release: ${singleLine(os.release())}`,
    `architecture: ${singleLine(process.arch)}`,
    `cpu: ${singleLine(firstCpu?.model)}`,
    `logical_cpu_cores: ${logicalCores}`,
    `available_parallelism: ${availableParallelism}`,
    `memory_total: ${formatGiB(os.totalmem())}`,
    `node_runtime: ${singleLine(process.version)}`,
    `configured_shell: ${singleLine(shell.name)}`,
    `Prometheus shell selector: ${shell.commandShell}`,
    workspacePath ? `workspace_root: ${singleLine(workspacePath)}` : '',
    gpu ? `gpu_backend: ${singleLine(gpu)}` : '',
    `command_guidance: ${shell.guidance}`,
    'If Prometheus is running in a container, VM, or remote gateway, these facts describe that execution environment rather than the physical client device.',
  ].filter(Boolean).join('\n');
}
