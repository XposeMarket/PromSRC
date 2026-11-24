/** Session category-state normalization and warm-list updates. No persistence or session creation. */
import { AUTOMATION_WORKFLOW_PACK_IDS, normalizeManifestToolCategory } from '../runtime/tool-category-manifest';
import { canKeepToolCategoryWarm, normalizeWarmToolCategories, touchWarmToolCategory, type WarmToolCategory } from './tool-category-retention';

export type ToolCategoryActivationScope = 'session' | 'turn' | 'next_turn' | 'ttl';

export interface ScopedToolCategoryActivation {
  category: string;
  scope: Exclude<ToolCategoryActivationScope, 'session'>;
  activatedAtTurn: number;
  expiresAfterTurn: number;
  turns?: number;
  activatedAt: number;
}

/**
 * Transaction snapshot for a single tool-category activation. Provisioning
 * may temporarily add a turn-scoped activation, but a failed provider-surface
 * rebuild must restore the category exactly as it was before that attempt.
 */
export interface ToolCategoryActivationSnapshot {
  category: string;
  persistent: boolean;
  scoped: ScopedToolCategoryActivation[];
  /** The whole warm list before the attempt: activating can evict another category at the cap. */
  warm?: WarmToolCategory[];
}

export function normalizeToolCategoryActivationScope(input: any): ToolCategoryActivationScope {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'session' || value === 'turn' || value === 'next_turn' || value === 'ttl') return value;
  return 'session';
}

export function normalizeSessionToolCategory(input: unknown): string {
  const raw = String(input || '').trim();
  return normalizeManifestToolCategory(raw) || raw;
}

/** Read the legacy Anthropic string list as loaded and in use for the normal grace period. */
export function loadWarmToolCategories(data: any): WarmToolCategory[] {
  const source = Array.isArray(data?.warmToolCategories)
    ? data.warmToolCategories
    : data?.anthropicCachedToolCategories;
  return normalizeWarmToolCategories(source, normalizeSessionToolCategory, Number(data?.userTurnCounter));
}

export function normalizeScopedToolCategoryActivations(input: any, fallbackTurn?: number): ScopedToolCategoryActivation[] {
  if (!Array.isArray(input)) return [];
  const fallback = Number.isFinite(Number(fallbackTurn)) ? Math.max(0, Math.floor(Number(fallbackTurn))) : 0;
  const seen = new Set<string>();
  const normalized: ScopedToolCategoryActivation[] = [];
  for (const raw of input) {
    const category = normalizeSessionToolCategory(raw?.category);
    if (!category) continue;
    const scope = normalizeToolCategoryActivationScope(raw?.scope);
    if (scope === 'session') continue;
    const activatedAtTurn = Number.isFinite(Number(raw?.activatedAtTurn))
      ? Math.max(0, Math.floor(Number(raw.activatedAtTurn)))
      : fallback;
    const expiresAfterTurn = Number.isFinite(Number(raw?.expiresAfterTurn))
      ? Math.max(activatedAtTurn, Math.floor(Number(raw.expiresAfterTurn)))
      : activatedAtTurn;
    const key = `${category}:${scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      category,
      scope,
      activatedAtTurn,
      expiresAfterTurn,
      turns: Number.isFinite(Number(raw?.turns)) ? Math.max(1, Math.floor(Number(raw.turns))) : undefined,
      activatedAt: Number.isFinite(Number(raw?.activatedAt)) ? Number(raw.activatedAt) : Date.now(),
    });
  }
  return normalized.slice(0, 64);
}

export function refreshLoadedWarmToolCategories(
  warm: WarmToolCategory[], scoped: ScopedToolCategoryActivation[], cleanCategory: string, turn: number,
): WarmToolCategory[] {
  // The automations category is the union of the four workflow packs.
  const candidates = (AUTOMATION_WORKFLOW_PACK_IDS as readonly string[]).includes(cleanCategory)
    ? [cleanCategory, 'automations']
    : [cleanCategory];
  for (const candidate of candidates) {
    if (!canKeepToolCategoryWarm(candidate)) continue;
    // Expired scopes are not loaded; a late call must not bring them back.
    const loaded = warm.some((entry) => entry.category === candidate)
      || scoped.some((entry) => entry.category === candidate && entry.expiresAfterTurn >= turn);
    if (loaded) warm = touchWarmToolCategory(warm, candidate, turn, true);
  }
  return warm;
}

export function restoreWarmToolCategories(
  warm: WarmToolCategory[], snapshot: ToolCategoryActivationSnapshot, cleanCategory: string,
): WarmToolCategory[] {
  const currentWarm = warm.filter((entry) => entry.category !== cleanCategory);
  if (!Array.isArray(snapshot.warm)) return currentWarm;
  // Restore entries evicted by the failed activation, preserving newer surviving state and order.
  const current = new Map(currentWarm.map((entry) => [entry.category, entry]));
  const restored = snapshot.warm
    .filter((entry) => entry.category !== cleanCategory)
    .map((entry) => current.get(entry.category) || { ...entry });
  for (const entry of currentWarm) {
    if (!restored.some((kept) => kept.category === entry.category)) restored.push(entry);
  }
  return restored;
}

/**
 * A new main chat starts with the file tools already loaded. In 30 days of real
 * use 53% of new chats needed them in the first turn and 70% within three, and
 * each of those cost a full extra model round to request. A chat that never
 * touches them loses them again through the normal warm-retention rule.
 */
export const DEFAULT_WARM_TOOL_CATEGORIES: readonly string[] = ['workspace_write'];

/** Prune only scoped state; the caller owns persistence and the session turn counter. */
export function pruneScopedToolCategoryActivations(
  session: { scopedToolCategoryActivations?: ScopedToolCategoryActivation[] }, currentTurn: number,
): boolean {
  const before = Array.isArray(session.scopedToolCategoryActivations)
    ? session.scopedToolCategoryActivations.length
    : 0;
  const next = normalizeScopedToolCategoryActivations(session.scopedToolCategoryActivations, currentTurn)
    .filter((entry) => entry.expiresAfterTurn >= currentTurn);
  session.scopedToolCategoryActivations = next;
  return next.length !== before;
}
