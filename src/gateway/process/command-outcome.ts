import type { ProcessTerminationReason } from './types';

export interface CommandTerminationInput {
  code?: number | null;
  timedOut?: boolean;
  reason?: ProcessTerminationReason | string | null;
  signal?: NodeJS.Signals | number | string | null;
}

export interface CommandTerminationOutcome {
  ok: boolean;
  reason: ProcessTerminationReason | 'unknown';
  label: string;
}

export function classifyCommandTermination(input: CommandTerminationInput): CommandTerminationOutcome {
  const code = typeof input.code === 'number' ? input.code : null;
  const signal = input.signal === undefined || input.signal === null || input.signal === '' ? null : String(input.signal);
  const rawReason = String(input.reason || '').trim();
  const timedOut = input.timedOut === true || rawReason === 'overall_timeout' || rawReason === 'no_output_timeout';

  if (timedOut) {
    const reason = rawReason === 'no_output_timeout' ? 'no_output_timeout' : 'overall_timeout';
    return { ok: false, reason, label: reason === 'no_output_timeout' ? 'NO OUTPUT TIMEOUT' : 'TIMED OUT' };
  }
  if (rawReason === 'spawn_error') return { ok: false, reason: 'spawn_error', label: 'SPAWN ERROR' };
  if (rawReason === 'manual_cancel') return { ok: false, reason: 'manual_cancel', label: 'CANCELLED' };
  if (rawReason === 'signal' || signal !== null) {
    return { ok: false, reason: 'signal', label: `SIGNAL ${signal || 'unknown'}` };
  }
  if (rawReason && rawReason !== 'exit') {
    return { ok: false, reason: 'unknown', label: rawReason.replace(/_/g, ' ').toUpperCase() };
  }
  if (code === 0) return { ok: true, reason: 'exit', label: 'exit 0' };
  if (code !== null) return { ok: false, reason: 'exit', label: `exit ${code}` };
  return { ok: false, reason: 'unknown', label: 'UNKNOWN TERMINATION' };
}
