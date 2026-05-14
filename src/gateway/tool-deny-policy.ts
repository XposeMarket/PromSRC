export type GoalExecutionPolicyMode = 'normal' | 'goal_autonomous';
export type GoalApprovalMode = 'normal' | 'never';

export interface ToolExecutionPolicy {
  mode?: GoalExecutionPolicyMode;
  approvalMode?: GoalApprovalMode;
  hardDeny?: boolean;
}

export interface HardToolDenyInput {
  toolName: string;
  args: any;
  sessionId?: string;
  executionPolicy?: ToolExecutionPolicy;
}

export interface HardToolDenyDecision {
  denied: boolean;
  code?: 'BLOCKED_BY_GOAL_POLICY';
  category?: string;
  reason?: string;
  doNotRetry?: string;
  safeAlternative?: string;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function commandFromArgs(args: any): string {
  return text(args?.command || args?.cmd || args?.script || '');
}

function toolArgsText(args: any): string {
  try {
    return JSON.stringify(args ?? {}).slice(0, 4000).toLowerCase();
  } catch {
    return String(args ?? '').slice(0, 4000).toLowerCase();
  }
}

function deny(category: string, reason: string, doNotRetry: string, safeAlternative: string): HardToolDenyDecision {
  return {
    denied: true,
    code: 'BLOCKED_BY_GOAL_POLICY',
    category,
    reason,
    doNotRetry,
    safeAlternative,
  };
}

export function formatHardToolDeny(decision: HardToolDenyDecision): string {
  if (!decision.denied) return '';
  return [
    'BLOCKED_BY_GOAL_POLICY',
    `Category: ${decision.category || 'hard_denied_action'}`,
    `Why: ${decision.reason || 'This action is not allowed by the autonomous goal hard-deny policy.'}`,
    `Do not retry: ${decision.doNotRetry || 'Do not call this tool action or an equivalent again.'}`,
    `Safe alternative: ${decision.safeAlternative || 'Choose a safer workspace-scoped approach and continue toward the goal.'}`,
  ].join('\n');
}

function commandMatches(command: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(command));
}

function evaluateCommandDeny(rawCommand: string): HardToolDenyDecision {
  const cmd = lower(rawCommand).replace(/\s+/g, ' ');
  const compact = cmd.replace(/\s+/g, '');

  if (!cmd) return { denied: false };

  if (commandMatches(cmd, [
    /\bformat\b/,
    /\bdiskpart\b/,
    /\bmkfs(?:\.[a-z0-9]+)?\b/,
    /\bdd\s+if=/,
    /\bcipher\s+\/w\b/,
    /\\\\\.\\physicaldrive/i,
    />\s*\/dev\//,
  ])) {
    return deny(
      'destructive_disk_or_device_operation',
      'This command can format, wipe, or write directly to disks/devices.',
      'Do not call disk formatting, raw disk write, secure wipe, or physical drive commands again.',
      'Use workspace-scoped file operations or read-only diagnostics instead.',
    );
  }

  if (
    /rm\s+-[a-z]*r[a-z]*f[a-z]*\s+(\/|\/\*|[a-z]:[\/\\]?)(\s|$)/i.test(cmd)
    || /rmdir\s+\/s\s+\/q\s+[a-z]:\\?(\s|$)/i.test(cmd)
    || /del\s+\/f\s+\/s\s+\/q\s+[a-z]:\\?(\s|$)/i.test(cmd)
    || /remove-item\b[\s\S]*-recurse\b[\s\S]*-force\b[\s\S]*\s[a-z]:[\/\\]?$/i.test(cmd)
    || /remove-item\b[\s\S]*-recurse\b[\s\S]*-force\b[\s\S]*(^|\s)[a-z]:\\?(\s|$)/i.test(cmd)
    || /remove-item\b[\s\S]*(^|\s)(\/|\/\*)(\s|$)/i.test(cmd)
  ) {
    return deny(
      'root_or_drive_deletion',
      'This command attempts recursive deletion of a root directory, drive, or equivalent broad target.',
      'Do not retry recursive root/drive deletion or any equivalent wipe command.',
      'Delete only exact workspace files with native file tools or a tightly scoped command.',
    );
  }

  if (commandMatches(cmd, [
    /\bsudo\b/,
    /\bsu\s+-?\b/,
    /\brunas\b/,
    /start-process\b[\s\S]*\b-verb\s+runas\b/,
  ])) {
    return deny(
      'privilege_escalation',
      'This command attempts privilege escalation or an administrator prompt.',
      'Do not call sudo, su, runas, Start-Process -Verb RunAs, or equivalent elevation commands again.',
      'Continue with non-admin, workspace-scoped commands or report the exact admin-only blocker.',
    );
  }

  if (commandMatches(cmd, [
    /set-mppreference\b[\s\S]*-disablerealtimemonitoring\s+\$?true/,
    /\badd-mppreference\b[\s\S]*-exclusion/,
    /\bnetsh\s+advfirewall\s+set\s+allprofiles\s+state\s+off\b/,
    /\bset-netfirewallprofile\b[\s\S]*\b-enabled\s+false\b/,
    /\bsc\s+(config|stop)\b[\s\S]*(windefend|mpssvc|securityhealthservice)/,
  ])) {
    return deny(
      'security_disablement',
      'This command attempts to disable or weaken security controls.',
      'Do not disable Defender, firewall, security services, exclusions, or equivalent protections.',
      'Use normal diagnostics/build tools and keep system security settings unchanged.',
    );
  }

  if (commandMatches(cmd, [
    /\bbcdedit\b/,
    /\bvssadmin\s+delete\s+shadows\b/,
    /\bwmic\s+shadowcopy\s+delete\b/,
    /\breg\s+delete\s+hklm\b/,
    /\breg\s+delete\s+hkcr\b/,
    /\breg\s+delete\s+hku\b/,
  ])) {
    return deny(
      'boot_registry_or_recovery_mutation',
      'This command mutates boot, recovery, shadow-copy, or broad registry state.',
      'Do not edit boot settings, delete recovery data, or broadly delete registry hives.',
      'Use app/workspace-level configuration changes only.',
    );
  }

  if (
    /\b(curl|wget)\b[\s\S]*(\||;)\s*(bash|sh|zsh|fish|powershell|pwsh)\b/.test(cmd)
    || /\b(irm|iwr|invoke-restmethod|invoke-webrequest)\b[\s\S]*\|\s*(iex|invoke-expression)\b/.test(cmd)
    || /\bpowershell\b[\s\S]*\b(encodedcommand|frombase64string)\b/.test(cmd)
  ) {
    return deny(
      'remote_script_execution',
      'This command downloads or decodes code and executes it directly.',
      'Do not pipe remote downloads into shells, use PowerShell iex, or execute encoded commands.',
      'Download into the workspace, inspect the content, then run a specific trusted command if still needed.',
    );
  }

  if (commandMatches(cmd, [
    /\bprocdump\b[\s\S]*\blsass\b/,
    /\brundll32\b[\s\S]*comsvcs\.dll[\s\S]*minidump/i,
    /\breg\s+save\s+hklm\\(sam|security|system)\b/,
    /\b(secretsdump|mimikatz|laZagne)\b/i,
    /\blogins\.json\b/,
    /\blogin data\b/,
    /\bkeychain\b[\s\S]*\bdump\b/,
  ])) {
    return deny(
      'credential_access',
      'This command attempts to access credential stores, password databases, or process memory used for secrets.',
      'Do not dump credentials, read browser password stores, or access LSASS/SAM/keychain data.',
      'Ask the user for the specific credential if it is necessary, or continue without secret extraction.',
    );
  }

  if (commandMatches(cmd, [
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\s+-[^\s]*[fdx][^\s]*\b/,
    /\bgit\s+push\b[\s\S]*(--force|-f\b|--force-with-lease)/,
  ])) {
    return deny(
      'destructive_git_operation',
      'This Git command can discard work or rewrite remote history.',
      'Do not call git reset --hard, git clean -fdx, or force-push during autonomous goal mode.',
      'Use git status/diff/log, create a patch, or ask the user for a separate explicit destructive Git action.',
    );
  }

  if (commandMatches(cmd, [
    /\bshutdown\b/,
    /\brestart-computer\b/,
    /\bstop-computer\b/,
    /\blogoff\b/,
    /\bshutdown\.exe\b/,
  ])) {
    return deny(
      'machine_interruption',
      'This command would shut down, restart, or log off the machine.',
      'Do not interrupt the machine during autonomous goal mode.',
      'Keep the current process alive and report if a restart is truly required.',
    );
  }

  if (compact.includes(':(){:|:&};:') || commandMatches(cmd, [
    /\byes\b[\s\S]*>\s*\/dev\/null/,
    /\bstress(?:-ng)?\b/,
    /\bwhile\s*\(\s*\$true\s*\)/,
  ])) {
    return deny(
      'resource_exhaustion',
      'This command can intentionally exhaust CPU, process slots, memory, or disk.',
      'Do not run stress, fork-bomb, infinite spawn, or fill-disk commands.',
      'Use bounded diagnostics with explicit timeouts and output limits.',
    );
  }

  return { denied: false };
}

export function evaluateHardToolDeny(input: HardToolDenyInput): HardToolDenyDecision {
  const toolName = lower(input.toolName);
  const argsText = toolArgsText(input.args);
  const isAutonomousGoal = input.executionPolicy?.mode === 'goal_autonomous';

  if (['run_command', 'start_process', 'run_command_supervised'].includes(toolName)) {
    const decision = evaluateCommandDeny(commandFromArgs(input.args));
    if (decision.denied) return decision;
  }

  if (toolName === 'process_submit') {
    const submitted = lower(input.args?.data);
    const decision = evaluateCommandDeny(submitted);
    if (decision.denied) return decision;
  }

  if (toolName === 'process_kill' && isAutonomousGoal && /(system|security|defender|firewall|explorer|winlogon|lsass|csrss)/.test(argsText)) {
    return deny(
      'critical_process_interruption',
      'This attempts to stop a critical or unrelated system/security process.',
      'Do not kill critical system, shell, security, or unrelated user processes.',
      'Only stop supervised process runIds created by the current goal when needed.',
    );
  }

  if (/^desktop_/.test(toolName)) {
    if (toolName === 'desktop_set_clipboard' && /(password|token|api[_-]?key|secret|2fa|otp)/i.test(argsText)) {
      return deny(
        'desktop_secret_handling',
        'This desktop action appears to place secrets or authentication codes on the clipboard.',
        'Do not automate password, token, API key, or 2FA clipboard entry in autonomous goal mode.',
        'Ask the user to provide/enter credentials manually, or continue without credential entry.',
      );
    }
    if (/uac|administrator|admin prompt|windows security|defender|firewall|payment|purchase|checkout/.test(argsText)) {
      return deny(
        'sensitive_desktop_action',
        'This desktop action targets an admin/security/payment surface.',
        'Do not click/type/drag on admin prompts, security-disable dialogs, or payment surfaces autonomously.',
        'Stop at the prompt and explain the exact user action required.',
      );
    }
  }

  if (/^browser_/.test(toolName)) {
    if (/(password|2fa|otp|one[-\s]?time code|cvv|credit card|card number)/.test(argsText)) {
      return deny(
        'browser_secret_or_payment_entry',
        'This browser action appears to enter credentials, 2FA, or payment data.',
        'Do not enter passwords, 2FA codes, CVV/card data, or equivalent secrets autonomously.',
        'Ask the user to complete the sensitive entry, then continue from the next page.',
      );
    }
    if (/(buy now|place order|submit payment|delete account|close account|file taxes|government form|legal signature)/.test(argsText)) {
      return deny(
        'high_impact_browser_submission',
        'This browser action appears to submit a high-impact transaction or legal/account action.',
        'Do not submit purchases, payments, account deletion, legal, tax, or government forms autonomously.',
        'Prepare the page or draft, then ask the user to confirm the final submission manually.',
      );
    }
  }

  return { denied: false };
}
