import { refreshProjectContextForSession } from '../../../projects/project-learning.js';
import { snapshotMainChatGoal } from '../../../main-chat-goals';
import { broadcastWS } from '../../../comms/broadcaster';
import { normalizeForDedup, isGreetingLikeMessage } from '../../../comms/reply-processor';
import { isResumeIntent, isRerunIntent, isCancelIntent, parseTaskIdFromText } from '../../../tasks/task-router';



// â”€â”€â”€ SSE + Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function maybeRefreshProjectLearning(
  sessionId: string,
  extraTextBlocks?: string[],
): Promise<void> {
  try {
    await refreshProjectContextForSession(sessionId, { extraTextBlocks });
  } catch (err: any) {
    console.warn(`[ProjectLearning] Refresh failed for session ${sessionId}:`, err?.message || err);
  }
}

export const activeMainChatGoalRuns = new Set<string>();

export function broadcastMainChatGoalState(sessionId: string, event: string, extra: Record<string, any> = {}): void {
  try {
    broadcastWS({
      type: 'main_chat_goal_updated',
      sessionId,
      event,
      goal: snapshotMainChatGoal(sessionId),
      ...extra,
    });
  } catch {}
}

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isGrokGenerationOverride(generationOverride: any): boolean {
  const provider = String(generationOverride?.provider || generationOverride?.providerId || '').trim().toLowerCase();
  const model = String(generationOverride?.model || '').trim().toLowerCase();
  return provider === 'xai' || model.startsWith('grok-') || model.includes('/grok-');
}

export function isGrokGreetingLikeMessage(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 120) return false;
  if (/\b(search|open|read|write|file|code|task|build|fix|debug|run|install|http|www\.|\\.com|please|could you|can you)\b/i.test(raw)) return false;
  if (isGreetingLikeMessage(raw)) return true;
  return /^(?:hi|hello|hey|yo|sup|howdy)(?:[!.?\s,]+(?:hi|hello|hey|yo|sup|howdy)){0,3}(?:[!.?\s,]+(?:prom|prometheus|claw))?[!.?\s]*$/i.test(raw);
}

// Invisible filler: whitespace (other than a few newlines), zero-width chars,
// BOM, NBSP. A model that keeps emitting these after its answer produces
// huge "blank" replies. 400+ consecutive filler chars is never real output.
export const INVISIBLE_FILLER_RUN = /[\s\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]{400,}$/;
export function hasRunawayInvisibleTail(text: string): boolean {
  if (String(text || '').length < 400) return false;
  const tail = String(text).slice(-600);
  if (!INVISIBLE_FILLER_RUN.test(tail)) return false;
  // Allow long runs of plain newlines/indentation in code-ish output only if
  // they contain visible text somewhere in the window.
  return tail.replace(/[\s\u00a0\u200b-\u200f\u2060\ufeff]/g, '').length === 0;
}

export function stripInvisibleFillerRuns(text: string): string {
  return String(text || '')
    .replace(/[\u200b-\u200f\u2060-\u2064\ufeff]{2,}/g, '')
    .replace(/[ \t\u00a0\u2000-\u200a\u202f\u205f\u3000]{200,}/g, ' ')
    .replace(/\n{6,}/g, '\n\n')
    .trimEnd();
}

export function trimGrokRunawayRepetition(text: string): string {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';

  const inlineLoopTrimmed = trimGrokInlineLoop(raw);
  if (inlineLoopTrimmed && inlineLoopTrimmed.length < raw.length) return inlineLoopTrimmed;

  const paragraphs = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  // Short-phrase affirmation loop: find where substantive content gives way to tiny fragments.
  // Grok often produces good content then devolves into "Yes.", "Done.", "(End.)", "ðŸ‘" etc.
  if (paragraphs.length >= 4) {
    let consecutiveShort = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].length < 40) {
        consecutiveShort++;
        if (consecutiveShort >= 3 && i - consecutiveShort + 1 > 0) {
          const trimmed = paragraphs.slice(0, i - consecutiveShort + 1).join('\n\n').trim();
          if (trimmed) return trimmed;
        }
      } else {
        consecutiveShort = 0;
      }
    }
  }

  const kept: string[] = [];
  const seen = new Map<string, number>();
  for (const paragraph of paragraphs) {
    const norm = normalizeForDedup(paragraph);
    if (!norm) continue;
    const count = (seen.get(norm) || 0) + 1;
    seen.set(norm, count);
    if (count > 2) break;
    kept.push(paragraph);
  }

  const joined = kept.join('\n\n') || raw;
  const sentences = joined.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 8) return joined.trim();

  const out: string[] = [];
  const sentenceSeen = new Map<string, number>();
  for (const sentence of sentences) {
    const norm = normalizeForDedup(sentence);
    if (!norm) continue;
    const count = (sentenceSeen.get(norm) || 0) + 1;
    sentenceSeen.set(norm, count);
    if (count > 2) break;
    out.push(sentence);
  }
  return (out.length ? out.join(' ') : joined).trim();
}

export function getParentheticalRuns(text: string): string[] {
  const matches = String(text || '').matchAll(/\(([^()\n]{1,60})\)/g);
  return [...matches]
    .map((match) => normalizeForDedup(match[1] || ''))
    .filter(Boolean);
}

export function isLikelyGrokInlineLoop(text: string): boolean {
  const tail = String(text || '').slice(-1800);
  const parentheticalRuns = getParentheticalRuns(tail);
  if (parentheticalRuns.length >= 24) {
    const unique = new Set(parentheticalRuns);
    if (unique.size <= 16 || unique.size / parentheticalRuns.length <= 0.65) return true;
  }

  const words = tail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1);
  if (words.length < 80) return false;
  const grams: string[] = [];
  for (let i = 0; i <= words.length - 3; i++) grams.push(words.slice(i, i + 3).join(' '));
  if (grams.length < 50) return false;
  const uniqueGrams = new Set(grams);
  return uniqueGrams.size / grams.length <= 0.42;
}

export function trimGrokInlineLoop(text: string): string {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw || !isLikelyGrokInlineLoop(raw)) return raw;

  const matches = [...raw.matchAll(/\(([^()\n]{1,60})\)/g)];
  if (matches.length < 24) return raw.slice(0, 1800).trim();

  const seen = new Map<string, number>();
  for (const match of matches) {
    const norm = normalizeForDedup(match[1] || '');
    if (!norm) continue;
    const count = (seen.get(norm) || 0) + 1;
    seen.set(norm, count);
    if (count >= 3) {
      const cutAt = typeof match.index === 'number' ? match.index : raw.length;
      const trimmed = raw.slice(0, cutAt).trim();
      return trimmed || raw.slice(0, 1800).trim();
    }
  }

  return raw.slice(0, 1800).trim();
}

export function shouldCheckBlockedTaskFollowup(message: string): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  if (parseTaskIdFromText(text)) return true;
  if (isResumeIntent(text) || isRerunIntent(text) || isCancelIntent(text)) return true;
  if (/^\s*(proceed|go ahead|ok|okay|continue|yes|yep|sure|do it|keep going|try again|move on|sounds good|ready|done|fixed|logged in|i logged in|all good)\.?\s*$/i.test(text)) return true;
  if (/\b(logged in|fixed it|done now|all set|ready now|answered|clarification|the answer is|use this|try again)\b/i.test(text)) return true;
  return false;
}
