/**
 * Keep only the newest tool/screen images in a model request.
 *
 * Nov 16 2026: once a scheduled vision task looked at one flyer, that 2-3 MB
 * image was re-sent on every later model call of the run (38 calls, ~90 MB of
 * request bodies in 13 minutes) and the gateway heap climbed 1.5 -> 2.5 GB.
 * Nothing ever removed an old image from history.
 *
 * Rule (provider-agnostic, applied by each adapter before building its body):
 *   - images in the latest REAL user message (a user turn that is not a
 *     runtime-injected "[SYSTEM: ...]" vision message) are always kept, so a
 *     user's own attachments stay visible for the whole turn;
 *   - of the remaining images, the newest `keep` are kept;
 *   - older ones become a short text note, so the model knows an image was
 *     there and can re-capture it if needed.
 * Messages are copied, never mutated. Deterministic, so the cached prompt
 * prefix only changes when a new image actually arrives.
 */
import type { ChatMessage } from './LLMProvider';

export const DEFAULT_HISTORY_IMAGE_KEEP = 2;
export const PRUNED_IMAGE_TEXT = '[earlier image removed from this request to save context; re-capture it if you need to see it again]';

export function historyImageKeepFromEnv(): number {
  const raw = String(process.env.PROMETHEUS_HISTORY_IMAGE_KEEP ?? '').trim();
  if (!raw) return DEFAULT_HISTORY_IMAGE_KEEP;
  const n = Number(raw);
  // 0 disables pruning entirely (escape hatch); otherwise at least 1.
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_HISTORY_IMAGE_KEEP;
}

function isImagePart(part: any): boolean {
  return !!part && typeof part === 'object' && (part.type === 'image_url' || part.type === 'image' || part.type === 'input_image');
}

function isInjectedSystemUserMessage(message: ChatMessage): boolean {
  if (!Array.isArray(message.content)) return false;
  return message.content.some((part: any) => part?.type === 'text' && /^\s*\[SYSTEM:/.test(String(part.text || '')));
}

/** Count images inside a content array, including nested tool_result content. */
function countImages(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const part of content as any[]) {
    if (isImagePart(part)) n += 1;
    else if (part?.type === 'tool_result' && Array.isArray(part.content)) n += countImages(part.content);
  }
  return n;
}

/**
 * Rewrite a content array, replacing image parts whose running index (counted
 * newest-first via `nextIndex`) is >= keep with a text note.
 */
function pruneContent(content: any[], shouldPrune: () => boolean): { content: any[]; changed: boolean } {
  let changed = false;
  // Walk backwards so indices count newest-first, then restore order.
  const out: any[] = new Array(content.length);
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const part = content[i];
    if (isImagePart(part)) {
      if (shouldPrune()) {
        out[i] = { type: 'text', text: PRUNED_IMAGE_TEXT };
        changed = true;
      } else {
        out[i] = part;
      }
    } else if (part?.type === 'tool_result' && Array.isArray(part.content)) {
      const nested = pruneContent(part.content, shouldPrune);
      out[i] = nested.changed ? { ...part, content: nested.content } : part;
      changed = changed || nested.changed;
    } else {
      out[i] = part;
    }
  }
  return { content: out, changed };
}

export interface HistoryImagePruneResult {
  messages: ChatMessage[];
  totalImages: number;
  prunedImages: number;
}

export function pruneHistoryImages(messages: ChatMessage[], keep = historyImageKeepFromEnv()): HistoryImagePruneResult {
  const list = Array.isArray(messages) ? messages : [];
  let totalImages = 0;
  for (const m of list) totalImages += countImages(m?.content);
  if (keep <= 0 || totalImages <= keep) return { messages: list, totalImages, prunedImages: 0 };

  // Latest real user turn: its own attachments are protected.
  let protectedIndex = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m?.role === 'user' && !isInjectedSystemUserMessage(m)) { protectedIndex = i; break; }
  }

  let keptUnprotected = 0;
  let prunedImages = 0;
  const shouldPrune = () => {
    if (keptUnprotected < keep) { keptUnprotected += 1; return false; }
    prunedImages += 1;
    return true;
  };
  const out = list.slice();
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (i === protectedIndex || !Array.isArray(m?.content) || countImages(m.content) === 0) continue;
    const pruned = pruneContent(m.content as any[], shouldPrune);
    if (pruned.changed) out[i] = { ...m, content: pruned.content as any };
  }
  return { messages: prunedImages ? out : list, totalImages, prunedImages };
}
