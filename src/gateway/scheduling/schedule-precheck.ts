/** Optional deterministic gates. Commands still go through the normal tool policy. */
export interface SchedulePrecheck {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  skipWhen: 'exit_nonzero' | 'stdout_match';
  pattern?: string;
}
export const schedulePrecheckSchema = {
  type: ['object', 'null'],
  description: 'Optional agent-only command gate before any model call. Null removes it. Policy denial/crash/timeout fails visibly; it never counts as noop. stdout_match tests only stdout. exit_nonzero treats normal nonzero exit as noop (use only with an intentional exit-code contract).',
  required: ['command', 'skipWhen'],
  properties: {
    command: { type: 'string', description: 'Read-only deterministic poll command, subject to normal command policy.' },
    cwd: { type: 'string', description: 'Optional working directory; defaults to workspace.' },
    timeoutMs: { type: 'integer', minimum: 100, maximum: 60000, description: 'Bounded precheck timeout, default 10000ms.' },
    skipWhen: { type: 'string', enum: ['exit_nonzero', 'stdout_match'] },
    pattern: { type: 'string', description: 'Required for stdout_match: simple regex, max 256 chars; groups, alternation, backreferences and braces are not supported.' },
  },
};
export function normalizeSchedulePrecheck(value: unknown, kind = 'agent'): SchedulePrecheck | undefined {
  if (value == null) return undefined;
  if (kind !== 'agent') throw new Error('precheck is supported only on agent jobs');
  const v = value as SchedulePrecheck;
  if (typeof v !== 'object' || typeof v.command !== 'string' || !v.command.trim()) throw new Error('precheck.command must be nonempty');
  if (v.command.length > 16000 || /[\r\n]/.test(v.command)) throw new Error('precheck.command must be a single bounded command line');
  if (v.cwd !== undefined && (typeof v.cwd !== 'string' || !v.cwd.trim())) throw new Error('precheck.cwd must be a nonempty directory');
  if (v.timeoutMs !== undefined && (!Number.isInteger(v.timeoutMs) || v.timeoutMs < 100 || v.timeoutMs > 60000)) throw new Error('precheck.timeoutMs must be 100..60000');
  if (v.skipWhen !== 'exit_nonzero' && v.skipWhen !== 'stdout_match') throw new Error('Invalid precheck.skipWhen');
  if (v.skipWhen === 'stdout_match') {
    if (typeof v.pattern !== 'string' || !v.pattern || v.pattern.length > 256 || /[()|{}]|\\[1-9]/.test(v.pattern)) throw new Error('precheck.pattern must be a simple bounded regex (no groups/alternation/backreferences/braces)');
    new RegExp(v.pattern);
  }
  return { command: v.command.trim(), ...(v.cwd ? { cwd: v.cwd } : {}), timeoutMs: v.timeoutMs ?? 10000, skipWhen: v.skipWhen, ...(v.pattern ? { pattern: v.pattern } : {}) };
}
export interface PrecheckCommandResult { stdout: string; exitCode: number | null; reason: string; error?: string }
export interface PrecheckOutcome { status: 'go' | 'skipped' | 'failed'; stdout: string; error?: string }
export async function evaluateSchedulePrecheck(precheck: SchedulePrecheck, execute: () => Promise<PrecheckCommandResult>): Promise<PrecheckOutcome> {
  try {
    const config = normalizeSchedulePrecheck(precheck)!;
    const result = await execute();
    const stdout = String(result.stdout || '').slice(-4000);
    if (result.reason !== 'exit' || result.exitCode === null) return { status: 'failed', stdout, error: result.error || `Precheck failed: ${result.reason}` };
    if (config.skipWhen === 'exit_nonzero' && result.exitCode !== 0) return { status: 'skipped', stdout };
    if (result.exitCode !== 0) return { status: 'failed', stdout, error: result.error || `Precheck exited ${result.exitCode}` };
    const skip = config.skipWhen === 'stdout_match' && new RegExp(config.pattern!, 'm').test(stdout);
    return { status: skip ? 'skipped' : 'go', stdout };
  } catch (error: any) { return { status: 'failed', stdout: '', error: String(error?.message || error).slice(0, 2000) }; }
}
export async function executeSchedulePrecheck(precheck: SchedulePrecheck, workspace: string, sessionId: string): Promise<PrecheckOutcome> {
  return evaluateSchedulePrecheck(precheck, async () => {
    const { executeTool } = await import('../chat/chat-helpers');
    const timeoutMs = precheck.timeoutMs ?? 10000;
    // run_command clamps yield to >= 1s and may return [still running] for slower
    // commands; the supervisor owns the real timeout, so always wait for the exit.
    const result = await executeTool('run_command', { command: precheck.command, cwd: precheck.cwd || workspace, timeoutMs, yield_time_ms: Math.min(timeoutMs, 30000) }, workspace, {}, sessionId);
    // Structured supervisor evidence: never match echoed command, stderr or tool prose.
    const runId = (result as any).extra?.runId;
    if (!runId) return { stdout: '', exitCode: null, reason: 'policy_or_execution_error', error: String(result.result || 'No process receipt') };
    const { getProcessSupervisor } = await import('../process/supervisor');
    const supervisor = getProcessSupervisor();
    let guard: NodeJS.Timeout | undefined;
    const exit = await Promise.race([
      supervisor.wait(runId),
      new Promise<null>(resolve => { guard = setTimeout(() => resolve(null), timeoutMs + 5000); }),
    ]).finally(() => clearTimeout(guard));
    if (!exit) {
      supervisor.cancel(runId, 'overall_timeout');
      return { stdout: supervisor.log(runId).stdout, exitCode: null, reason: 'timeout', error: `Precheck did not exit within ${timeoutMs}ms` };
    }
    const record = supervisor.get(runId);
    const stdout = supervisor.log(runId).stdout || exit.stdout || '';
    return { stdout, exitCode: exit.exitCode ?? record?.exitCode ?? null, reason: exit.reason || record?.terminationReason || 'unknown', error: result.error ? String(result.result) : undefined };
  });
}
