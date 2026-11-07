/** Provider/model that produced a chat's latest assistant reply (sidebar logo source). */
export interface SessionModelRef {
  providerId: string;
  model: string;
}

/**
 * Bump when getLastAssistantModel learns a new evidence source so persisted
 * index rows computed by the older derivation are rehydrated exactly once.
 * v2: assistant rows rewritten by mobile history sync lost turnProviderUsage;
 * their process trace still carries extra.modelEvent {provider, model}.
 */
export const SESSION_LAST_MODEL_VERSION = 2;

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

/** Newest model stream event recorded in an assistant row's process trace. */
function modelFromProcessEntries(entries: unknown): SessionModelRef | null {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const event = (entries[i] as any)?.extra?.modelEvent;
    if (!event || typeof event !== 'object') continue;
    const ref = normalizeSessionModelRef({ provider: event.provider || event.providerId, model: event.model });
    if (ref) return ref;
  }
  return null;
}

/**
 * Newest assistant message with model evidence wins. Server-authored rows carry
 * turnProviderUsage; rows the mobile client re-saved through history sync only
 * keep the process trace, whose model_stream_event entries name the model.
 */
export function getLastAssistantModel(history: unknown): SessionModelRef | null {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i] as any;
    if (msg?.role !== 'assistant' && msg?.role !== 'ai') continue;
    const usage = msg.turnProviderUsage;
    const ref = normalizeSessionModelRef(usage?.lastCall || usage) || modelFromProcessEntries(msg.processEntries);
    if (ref) return ref;
  }
  return null;
}
