/**
 * Warm tool-category retention (all providers).
 *
 * A category that a chat is actually using stays loaded between turns, so the
 * model does not spend a full extra round on request_tool_category every turn.
 * A category that stops being used is unloaded again, but only at a cold start.
 *
 * Why only at a cold start: tool definitions sit at the front of the provider's
 * cached prefix (tools -> system -> messages). Changing the tool list while the
 * cache is warm forces the whole conversation to be re-written at the cache-write
 * price, which costs far more than carrying a few idle schemas at the cache-read
 * price. When the user comes back after the cache has expired, the prefix is
 * being re-written anyway, so dropping idle categories then is free.
 *
 * Replay of 30 days of real turns (audits/tool-audit-2026-11-19/retention-sim.cjs):
 * keep=2 cuts category-request rounds by 72% against per-turn expiry, and carries
 * 45% less idle schema than the old "first 8 categories stay forever" rule. The
 * curve flattens after 2 kept turns.
 */

export interface WarmToolCategory {
  category: string;
  /** User-turn counter of the most recent turn that called one of its tools (or activated it). */
  lastUsedTurn: number;
  /** False until one of its tools has actually been called. */
  used: boolean;
}

/** A used category survives this many further user turns without a call. */
export const WARM_CATEGORY_KEEP_TURNS = 2;
/** Most-recently-used cap, so a long chat cannot accumulate every category. */
export const WARM_CATEGORY_LIMIT = 8;
/** Shortest provider prompt-cache lifetime (Anthropic 5m default, OpenAI 5-10m). */
export const PROMPT_CACHE_COLD_MS = 5 * 60_000;

/**
 * Never kept implicitly. Connector/MCP registries have unbounded, revocable
 * schemas, and Prometheus source access is tied to an explicit approval.
 */
const NEVER_WARM_CATEGORIES = new Set<string>([
  'external_apps',
  'mcp_server_tools',
  'prometheus_source_read',
  'prometheus_source_write',
]);

export function canKeepToolCategoryWarm(category: string): boolean {
  const clean = String(category || '').trim();
  return !!clean && !NEVER_WARM_CATEGORIES.has(clean);
}

function cleanTurn(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function capMostRecent(list: WarmToolCategory[]): WarmToolCategory[] {
  if (list.length <= WARM_CATEGORY_LIMIT) return list;
  // Keep insertion order (it is part of the model-facing tool order) and evict
  // the least recently used entries.
  const evict = new Set(
    [...list]
      .sort((a, b) => a.lastUsedTurn - b.lastUsedTurn)
      .slice(0, list.length - WARM_CATEGORY_LIMIT)
      .map((entry) => entry.category),
  );
  return list.filter((entry) => !evict.has(entry.category));
}

export function normalizeWarmToolCategories(
  input: unknown,
  normalizeCategory: (raw: unknown) => string,
  fallbackTurn = 0,
): WarmToolCategory[] {
  if (!Array.isArray(input)) return [];
  const fallback = cleanTurn(fallbackTurn, 0);
  const seen = new Set<string>();
  const out: WarmToolCategory[] = [];
  for (const raw of input) {
    const category = normalizeCategory(typeof raw === 'string' ? raw : (raw as any)?.category);
    if (!category || seen.has(category) || !canKeepToolCategoryWarm(category)) continue;
    seen.add(category);
    out.push({
      category,
      lastUsedTurn: cleanTurn((raw as any)?.lastUsedTurn, fallback),
      // A bare string is the pre-retention Anthropic list: those were loaded and in use.
      used: typeof raw === 'string' ? true : (raw as any)?.used === true,
    });
  }
  return capMostRecent(out);
}

/** Record an activation (used=false) or a real tool call (used=true) in the given turn. */
export function touchWarmToolCategory(
  list: WarmToolCategory[] | undefined,
  category: string,
  turn: number,
  used: boolean,
): WarmToolCategory[] {
  const current = Array.isArray(list) ? list : [];
  if (!canKeepToolCategoryWarm(category)) return current;
  const at = cleanTurn(turn, 0);
  const existing = current.find((entry) => entry.category === category);
  if (existing) {
    const nextUsed = existing.used || used;
    const nextTurn = Math.max(existing.lastUsedTurn, at);
    if (nextUsed === existing.used && nextTurn === existing.lastUsedTurn) return current;
    return current.map((entry) => (entry === existing
      ? { category, lastUsedTurn: nextTurn, used: nextUsed }
      : entry));
  }
  return capMostRecent([...current, { category, lastUsedTurn: at, used }]);
}

export function isWarmToolCategoryStale(entry: WarmToolCategory, turn: number): boolean {
  const idleTurns = cleanTurn(turn, 0) - entry.lastUsedTurn;
  // Loaded but never called: one full turn of grace, then it goes.
  return entry.used ? idleTurns > WARM_CATEGORY_KEEP_TURNS : idleTurns >= 1;
}

/**
 * Run at the start of a user turn. With a warm cache nothing is removed; with a
 * cold cache every stale category is dropped in one go.
 */
export function pruneWarmToolCategories(
  list: WarmToolCategory[] | undefined,
  turn: number,
  cacheCold: boolean,
): WarmToolCategory[] {
  const current = Array.isArray(list) ? list : [];
  if (!cacheCold || current.length === 0) return current;
  const kept = current.filter((entry) => !isWarmToolCategoryStale(entry, turn));
  return kept.length === current.length ? current : kept;
}

export function isPromptCacheCold(lastModelActivityAt: unknown, now = Date.now()): boolean {
  const last = Number(lastModelActivityAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  return now - last > PROMPT_CACHE_COLD_MS;
}
