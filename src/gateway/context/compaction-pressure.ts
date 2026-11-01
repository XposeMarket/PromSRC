// Last assembled request, not just the persisted transcript. Volatile and bounded:
// never reuse across a history/summary revision, route change, or old idle session.
interface PressureSession {
  history: unknown[];
  contextStartIndex?: number;
  contextTokenEstimate?: number;
  latestContextSummary?: string;
}
interface PressureRoute {
  providerId: string;
  model: string;
  contextWindowTokens: number;
  inputBudgetTokens: number;
  compactionTriggerTokens: number;
}
interface RequestPressure {
  tokens: number;
  recordedAt: number;
  historyLength: number;
  startIndex?: number;
  transcriptEstimate?: number;
  summary?: string;
  routeKey: string;
}
const requests = new Map<string, RequestPressure>();
const MAX_ENTRIES = 256;
const MAX_AGE_MS = 30 * 60_000;
const routeKey = (route: PressureRoute): string => JSON.stringify(route);

export function recordCompactionRequestPressure(sessionId: string, session: PressureSession, route: PressureRoute, tokens: number, now = Date.now()): void {
  if (!Number.isFinite(tokens) || tokens < 0) return;
  requests.delete(sessionId);
  requests.set(sessionId, {
    tokens: Math.round(tokens), recordedAt: now, historyLength: session.history.length,
    startIndex: session.contextStartIndex, transcriptEstimate: session.contextTokenEstimate,
    summary: session.latestContextSummary, routeKey: routeKey(route),
  });
  while (requests.size > MAX_ENTRIES) requests.delete(requests.keys().next().value!);
}

export function getCompactionRequestPressure(sessionId: string, session: PressureSession, route: PressureRoute, now = Date.now()): number | undefined {
  const value = requests.get(sessionId);
  if (!value) return undefined;
  if (now - value.recordedAt > MAX_AGE_MS || value.routeKey !== routeKey(route)
    || value.historyLength !== session.history.length || value.startIndex !== session.contextStartIndex
    || value.transcriptEstimate !== session.contextTokenEstimate || value.summary !== session.latestContextSummary) {
    requests.delete(sessionId);
    return undefined;
  }
  return value.tokens;
}
