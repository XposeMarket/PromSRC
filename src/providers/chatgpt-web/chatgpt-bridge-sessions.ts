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
/** ChatGPT conversation id -> bridge turn key (set once the SSE stream names it). */
const conversationTurns = new Map<string, string>();
let lastCatalog: BridgeToolSpec[] = [];

export function chatGPTBridgeTurnKey(turn: Pick<ChatGPTBridgeTurn, 'sessionId' | 'turnId'>): string {
  return `${turn.sessionId}:${turn.turnId}`;
}

export function beginChatGPTBridgeTurn(turn: ChatGPTBridgeTurn): () => void {
  const key = chatGPTBridgeTurnKey(turn);
  turns.set(key, turn);
  try {
    const tools = turn.allowedTools();
    if (tools.length) lastCatalog = tools;
  } catch { /* catalog refresh is best-effort */ }
  return () => {
    if (turns.get(key) === turn) turns.delete(key);
    for (const [conversationId, turnKey] of conversationTurns) {
      if (turnKey === key) conversationTurns.delete(conversationId);
    }
  };
}

/**
 * Bind the ChatGPT conversation this turn is streaming from. Tool calls that
 * carry that conversation id (in _meta or headers) route to exactly this turn.
 */
export function bindChatGPTBridgeConversation(turnKey: string, conversationId: string): void {
  const id = String(conversationId || '').trim();
  if (!id || !turns.has(turnKey)) return;
  conversationTurns.set(id, turnKey);
}

function liveTurns(now = Date.now()): ChatGPTBridgeTurn[] {
  const out: ChatGPTBridgeTurn[] = [];
  for (const [key, turn] of turns) {
    if (now - turn.startedAt > MAX_TURN_MS) {
      turns.delete(key);
      continue;
    }
    out.push(turn);
  }
  return out;
}

/** Most recent live ChatGPT turn, if any. */
export function getActiveChatGPTBridgeTurn(now = Date.now()): ChatGPTBridgeTurn | null {
  let newest: ChatGPTBridgeTurn | null = null;
  for (const turn of liveTurns(now)) {
    if (!newest || turn.startedAt > newest.startedAt) newest = turn;
  }
  return newest;
}

export interface ChatGPTBridgeRouteHints {
  /** Every string ChatGPT sent alongside the call (_meta values, headers). */
  candidateIds?: string[];
  toolName?: string;
}

export type ChatGPTBridgeRouteResult =
  | { turn: ChatGPTBridgeTurn; via: 'conversation' | 'only_turn' | 'only_tool_owner' }
  | { turn: null; reason: 'idle' | 'ambiguous' | 'tool_not_allowed' };

/**
 * Pick the turn a tools/call belongs to. The bridge has one URL shared by every
 * ChatGPT chat, so "newest turn" routing let a concurrent chat's calls execute
 * in the wrong session (2026-09-26 probe). Order: exact conversation match,
 * the single live turn, the single turn that allows this tool. With several
 * candidates and no conversation match the call is refused, never guessed.
 */
export function routeChatGPTBridgeCall(hints: ChatGPTBridgeRouteHints = {}, now = Date.now()): ChatGPTBridgeRouteResult {
  const live = liveTurns(now);
  if (!live.length) return { turn: null, reason: 'idle' };
  for (const candidate of hints.candidateIds || []) {
    const key = conversationTurns.get(String(candidate || '').trim());
    const turn = key ? turns.get(key) : undefined;
    if (turn && live.includes(turn)) return { turn, via: 'conversation' };
  }
  const allows = (turn: ChatGPTBridgeTurn) => {
    if (!hints.toolName) return true;
    try { return turn.allowedTools().some((tool) => tool.name === hints.toolName); } catch { return false; }
  };
  if (live.length === 1) {
    return allows(live[0]) ? { turn: live[0], via: 'only_turn' } : { turn: null, reason: 'tool_not_allowed' };
  }
  const owners = live.filter(allows);
  if (owners.length === 1) return { turn: owners[0], via: 'only_tool_owner' };
  if (!owners.length) return { turn: null, reason: 'tool_not_allowed' };
  return { turn: null, reason: 'ambiguous' };
}

export function activeChatGPTBridgeTurnCount(now = Date.now()): number {
  return liveTurns(now).length;
}

/**
 * Tools to advertise on tools/list: the union of every live turn's surface
 * (so one chat's refresh cannot shrink another chat's catalog), else the last
 * surface a ChatGPT turn exposed, else the provided fallback.
 */
export function getChatGPTBridgeCatalog(fallback: () => BridgeToolSpec[] = () => []): BridgeToolSpec[] {
  const union = new Map<string, BridgeToolSpec>();
  for (const turn of liveTurns()) {
    try {
      for (const tool of turn.allowedTools()) if (tool?.name && !union.has(tool.name)) union.set(tool.name, tool);
    } catch { /* skip a broken turn */ }
  }
  if (union.size) return [...union.values()];
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
  conversationTurns.clear();
  lastCatalog = [];
}
