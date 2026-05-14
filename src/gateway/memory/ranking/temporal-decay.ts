export type TemporalDecayConfig = {
  enabled: boolean;
  halfLifeDays: number;
};

export const DEFAULT_TEMPORAL_DECAY_CONFIG: TemporalDecayConfig = {
  enabled: true,
  halfLifeDays: 60,
};

const EVERGREEN_SOURCE_TYPES = new Set(['memory_root', 'project_state', 'obsidian_note']);
const EVERGREEN_RECORD_TYPES = new Set(['preference', 'user_correction', 'decision', 'project_fact', 'workflow_rule', 'rule', 'entity_fact']);
const FAST_DECAY_SOURCE_TYPES = new Set(['chat_session', 'chat_transcript', 'cron_run', 'audit_misc']);

export function isEvergreenMemory(input: {
  sourceType?: string;
  sourcePath?: string;
  recordType?: string;
  authority?: string;
  status?: string;
}): boolean {
  const sourcePath = String(input.sourcePath || '').replace(/\\/g, '/');
  if (/^(USER|SOUL|MEMORY)\.md$/i.test(sourcePath) || /memory\/root\/(USER|SOUL|MEMORY)\.md$/i.test(sourcePath)) return true;
  if (String(input.authority || '') === 'explicit_user_instruction' || String(input.authority || '') === 'user_correction') return true;
  if (EVERGREEN_RECORD_TYPES.has(String(input.recordType || '').toLowerCase())) return true;
  if (EVERGREEN_SOURCE_TYPES.has(String(input.sourceType || ''))) return true;
  return false;
}

export function temporalDecayMultiplier(input: {
  timestampMs: number;
  nowMs?: number;
  sourceType?: string;
  sourcePath?: string;
  recordType?: string;
  authority?: string;
  status?: string;
  config?: Partial<TemporalDecayConfig>;
}): number {
  const config = { ...DEFAULT_TEMPORAL_DECAY_CONFIG, ...(input.config || {}) };
  if (!config.enabled) return 1;
  if (isEvergreenMemory(input)) return 1;
  const ts = Number(input.timestampMs || 0);
  if (!Number.isFinite(ts) || ts <= 0) return 0.72;
  const now = Number(input.nowMs || Date.now());
  const ageDays = Math.max(0, (now - ts) / 86400000);
  const halfLife = FAST_DECAY_SOURCE_TYPES.has(String(input.sourceType || ''))
    ? Math.max(14, config.halfLifeDays * 0.5)
    : config.halfLifeDays;
  return Math.max(0.08, Math.pow(0.5, ageDays / Math.max(1, halfLife)));
}
