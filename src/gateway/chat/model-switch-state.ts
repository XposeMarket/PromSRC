/**
 * model-switch-state.ts
 *
 * Turn-scoped model override registry.
 * Allows the AI to call switch_model() during a turn and have subsequent
 * LLM rounds use a different provider/model without touching global config.
 *
 * Lifecycle:
 *   - Set:   switch_model tool handler calls setTurnModelOverride()
 *   - Read:  handleChat checks getTurnModelOverride() before each chatWithThinking call
 *   - Clear: handleChat calls clearTurnModelOverride() at the end of every turn
 *
 * No global config mutation. Override lives only for the duration of one handleChat call.
 */

export interface TurnModelOverride {
  providerId: string;   // e.g. 'anthropic', 'openai_codex'
  model: string;        // e.g. 'claude-haiku-4-5-20251001'
  reason: string;       // shown to user in UI badge + logs
}

const _overrides = new Map<string, TurnModelOverride>();

export function setTurnModelOverride(sessionId: string, override: TurnModelOverride): void {
  _overrides.set(sessionId, override);
}

export function getTurnModelOverride(sessionId: string): TurnModelOverride | null {
  return _overrides.get(sessionId) ?? null;
}

export function clearTurnModelOverride(sessionId: string): void {
  _overrides.delete(sessionId);
}
