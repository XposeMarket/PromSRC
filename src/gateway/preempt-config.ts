/** Preempt watchdog bounds — shared by chat router and skill settings (no orchestration dependency). */

export function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function clampPreemptConfig(raw: any): {
  stall_threshold_seconds: number;
  max_preempts_per_turn: number;
  max_preempts_per_session: number;
  restart_mode: 'inherit_console' | 'detached_hidden';
  enabled: boolean;
} {
  const p = raw || {};
  const restartModeRaw = String(p.restart_mode || '').trim();
  const restartMode: 'inherit_console' | 'detached_hidden' =
    restartModeRaw === 'inherit_console' || restartModeRaw === 'detached_hidden'
      ? restartModeRaw
      : (typeof process !== 'undefined' && process.platform === 'win32' ? 'inherit_console' : 'detached_hidden');
  return {
    enabled: p.enabled === true,
    stall_threshold_seconds: clampInt(p.stall_threshold_seconds, 10, 300, 45),
    max_preempts_per_turn: clampInt(p.max_preempts_per_turn, 1, 3, 1),
    max_preempts_per_session: clampInt(p.max_preempts_per_session, 1, 10, 3),
    restart_mode: restartMode,
  };
}
