/** Provider/model that produced a chat's latest assistant reply (sidebar logo source). */
export interface SessionModelRef {
  providerId: string;
  model: string;
}

/**
 * undefined = not computed yet (older index rows), null = computed, no model on record.
 * Keeping the two apart lets the index hydrate old rows exactly once.
 */
export function normalizeSessionModelRef(input: unknown): SessionModelRef | null | undefined {
  if (input === undefined) return undefined;
  const raw = input as any;
  const providerId = String(raw?.providerId || raw?.provider || '').trim().slice(0, 64);
  const model = String(raw?.model || '').trim().slice(0, 120);
  return providerId || model ? { providerId, model } : null;
}

/** Newest assistant message with provider usage wins. */
export function getLastAssistantModel(history: unknown): SessionModelRef | null {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i] as any;
    if (msg?.role !== 'assistant') continue;
    const usage = msg.turnProviderUsage;
    const ref = normalizeSessionModelRef(usage?.lastCall || usage);
    if (ref) return ref;
  }
  return null;
}
