/**
 * tool-ceiling.ts — a spawned worker can never hold more tool authority than the
 * session that spawned it (audit 2026-10-14: "subagent privilege expansion").
 *
 * handleChat records the effective tool allowlist of every restricted session.
 * background_spawn looks up the spawner's ceiling and runs the child under it;
 * the child's own turns re-record it, so the ceiling propagates down any chain
 * of spawns. Unrestricted sessions (normal main chat) record nothing and their
 * workers keep the full main-chat surface, matching prior behaviour.
 */

const ceilings = new Map<string, string[]>();
const MAX_TRACKED_SESSIONS = 2000;

/** Sentinel allowlist meaning "no tools". handleChat treats [] as unrestricted, so never return []. */
export const DENY_ALL_TOOLS = '__deny_all_tools__';

function clean(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.map((entry) => String(entry || '').trim()).filter(Boolean)));
}

export function toolPatternMatches(name: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
  return name === pattern;
}

export function recordSessionToolCeiling(sessionId: string, filter: unknown): void {
  const id = String(sessionId || '').trim();
  const list = clean(filter);
  if (!id || list.length === 0) return;
  if (!ceilings.has(id) && ceilings.size >= MAX_TRACKED_SESSIONS) {
    const oldest = ceilings.keys().next().value;
    if (oldest !== undefined) ceilings.delete(oldest);
  }
  ceilings.set(id, list);
}

export function getSessionToolCeiling(sessionId: string | undefined | null): string[] | undefined {
  const list = ceilings.get(String(sessionId || '').trim());
  return list ? list.slice() : undefined;
}

export function clearSessionToolCeiling(sessionId: string): void {
  ceilings.delete(String(sessionId || '').trim());
}

/**
 * Intersect a child's requested allowlist with the parent's ceiling.
 * undefined = unrestricted. Result is never [] (that would mean unrestricted).
 */
export function intersectToolCeiling(child: unknown, parent: unknown): string[] | undefined {
  const parentList = clean(parent);
  const childList = clean(child);
  if (parentList.length === 0) return childList.length ? childList : undefined;
  if (childList.length === 0) return parentList;
  const out = new Set<string>();
  for (const c of childList) if (parentList.some((p) => toolPatternMatches(c, p))) out.add(c);
  for (const p of parentList) if (childList.some((c) => toolPatternMatches(p, c))) out.add(p);
  return out.size ? Array.from(out) : [DENY_ALL_TOOLS];
}
