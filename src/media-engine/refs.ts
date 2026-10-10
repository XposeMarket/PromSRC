/**
 * Character reference resolution: every generation that uses a character sends its FULL
 * identity pack (anchor + turnarounds + body refs + expressions + looks), not just anchor[0].
 *
 * A project character linked to a library cast member (castId) always reads the cast's
 * live pack, so updating the cast (e.g. a new asset pack) reaches every project at once.
 * Order is priority order: anchors first, then cast refs as saved (packs are numbered by
 * importance), then project-only refs. The per-model cap trims from the end.
 */
import fs from 'fs';
import { getCast } from './library.js';
import { fromWorkspaceRel, type Character } from './project.js';
import type { MediaModelManifest } from './catalog.js';

/** GPT Image edits accept 16 references; xAI image/video and fal ref endpoints are kept at 5. */
export const OPENAI_REF_LIMIT = 16;
export const DEFAULT_REF_LIMIT = 5;

export function refLimitFor(model: Pick<MediaModelManifest, 'provider' | 'id'> & { limits?: MediaModelManifest['limits'] } | undefined): number {
  if (!model) return DEFAULT_REF_LIMIT;
  if (model.limits?.maxRefs && model.limits.maxRefs > 0) return model.limits.maxRefs;
  return model.provider === 'openai' || /^openai\//.test(model.id) ? OPENAI_REF_LIMIT : DEFAULT_REF_LIMIT;
}

function exists(ws: string, rel: string): boolean {
  if (/^(https?:|data:)/i.test(rel)) return true;
  try { return fs.existsSync(fromWorkspaceRel(ws, rel)); } catch { return false; }
}

/** Workspace-relative identity references for a character, deduped, missing files dropped. */
export function characterRefs(ws: string, c: Pick<Character, 'anchors' | 'refs'> & { castId?: string }, limit = Infinity): string[] {
  const cast = c.castId ? getCast(ws, c.castId) : null;
  // Project characters hold imported copies of the cast's files; mixing both would spend
  // reference slots on duplicate images, so a non-empty linked cast is the single source.
  const ordered = cast && cast.anchors.length + cast.refs.length > 0
    ? [...cast.anchors, ...cast.refs]
    : [...(c.anchors || []), ...(c.refs || [])];
  const out: string[] = [];
  for (const r of ordered) {
    if (!r || out.includes(r) || !exists(ws, r)) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
