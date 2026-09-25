/**
 * chatgpt-bridge-sessions.ts
 *
 * Tracks which Prometheus chat turn is currently being answered by ChatGPT.
 * The MCP bridge only EXECUTES tools while at least one such turn is active,
 * and routes each call to that turn's session (for tool UI, approvals, and the
 * session's workspace). Outside an active ChatGPT turn the bridge rejects
 * every tools/call, so a leaked URL cannot drive the machine on its own.
 *
 * Tool LISTING is different: ChatGPT snapshots a connector's tools when it
 * registers/refreshes the connector, which happens outside a turn. The last
 * tool surface a ChatGPT turn exposed is therefore kept as the catalog so
 * tools/list is stable; the static fallback catalog covers the very first
 * registration.
 */

export interface BridgeToolSpec {
  name: string;
  description: string;
  parameters: any;
}

export interface ChatGPTBridgeTurn {
  sessionId: string;
  turnId: string;
  startedAt: number;
  /** Execute a Prometheus tool inside this turn (approvals + telemetry included). */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<{ result: string; error: boolean }>;
  /** Tool names this turn may call. */
  allowedTools: () => BridgeToolSpec[];
}

/** Hard ceiling so an abandoned turn never keeps the bridge open. */
const MAX_TURN_MS = 30 * 60_000;
const turns = new Map<string, ChatGPTBridgeTurn>();
let lastCatalog: BridgeToolSpec[] = [];

export function beginChatGPTBridgeTurn(turn: ChatGPTBridgeTurn): () => void {
  const key = `${turn.sessionId}:${turn.turnId}`;
  turns.set(key, turn);
  try {
    const tools = turn.allowedTools();
    if (tools.length) lastCatalog = tools;
  } catch { /* catalog refresh is best-effort */ }
  return () => {
    if (turns.get(key) === turn) turns.delete(key);
  };
}

/** Most recent live ChatGPT turn, if any. */
export function getActiveChatGPTBridgeTurn(now = Date.now()): ChatGPTBridgeTurn | null {
  let newest: ChatGPTBridgeTurn | null = null;
  for (const [key, turn] of turns) {
    if (now - turn.startedAt > MAX_TURN_MS) {
      turns.delete(key);
      continue;
    }
    if (!newest || turn.startedAt > newest.startedAt) newest = turn;
  }
  return newest;
}

/**
 * Tools to advertise on tools/list: the active turn's surface, else the last
 * surface a ChatGPT turn exposed, else the provided fallback.
 */
export function getChatGPTBridgeCatalog(fallback: () => BridgeToolSpec[] = () => []): BridgeToolSpec[] {
  const active = getActiveChatGPTBridgeTurn();
  if (active) {
    try {
      const tools = active.allowedTools();
      if (tools.length) return tools;
    } catch { /* fall through */ }
  }
  if (lastCatalog.length) return lastCatalog;
  try { return fallback(); } catch { return []; }
}

/** Stable fingerprint of a tool catalog (names only; order-insensitive). */
export function chatGPTBridgeCatalogSignature(tools: BridgeToolSpec[]): string {
  const names = tools.map((t) => t.name).filter(Boolean).sort();
  let hash = 0;
  for (const ch of names.join('|')) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return `${names.length}:${(hash >>> 0).toString(36)}`;
}

/** Signature of the catalog tools/list serves right now. */
export function currentChatGPTBridgeCatalogSignature(): string {
  return chatGPTBridgeCatalogSignature(getChatGPTBridgeCatalog());
}

export function hasActiveChatGPTBridgeTurn(): boolean {
  return !!getActiveChatGPTBridgeTurn();
}

/** Test hook. */
export function clearChatGPTBridgeTurns(): void {
  turns.clear();
  lastCatalog = [];
}
