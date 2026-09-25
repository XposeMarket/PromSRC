/**
 * chatgpt-web-models.ts
 *
 * The "ChatGPT" model exposed under the OpenAI Codex provider. It talks to
 * ChatGPT itself (chatgpt.com/backend-api/conversation) with the same Codex
 * OAuth login, so no second connection is needed.
 *
 * ChatGPT does not have reasoning levels in the Codex sense; it has modes
 * (Instant, Thinking Light/Standard/Extended/Heavy, Pro). Those modes are
 * carried on the existing reasoning-effort field so every selector, route
 * snapshot, and persisted setting keeps working unchanged:
 *
 *   low    -> Instant            (gpt-5-6-instant)
 *   medium -> Thinking Light     (gpt-5-6-thinking, thinking_effort=min)
 *   high   -> Thinking Standard  (gpt-5-6-thinking, thinking_effort=standard)
 *   xhigh  -> Thinking Extended  (gpt-5-6-thinking, thinking_effort=extended)
 *   max    -> Thinking Heavy     (gpt-5-6-thinking, thinking_effort=max)
 *   ultra  -> Pro                (gpt-6-pro, thinking_effort=standard)
 *
 * Backend slugs were read from GET /backend-api/models on a Pro account
 * (2026-09-25): default_model_slug=gpt-5-6, categories gpt_5_6_instant,
 * gpt_5_6_reasoning (efforts min/standard/extended/max = Light/Standard/
 * Extended/Heavy) and gpt_6_pro (standard).
 */

export const CHATGPT_WEB_MODEL = 'chatgpt';

export type ChatGPTWebEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export const CHATGPT_WEB_EFFORTS: ChatGPTWebEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const CHATGPT_WEB_DEFAULT_EFFORT: ChatGPTWebEffort = 'high';

export interface ChatGPTWebMode {
  effort: ChatGPTWebEffort;
  label: string;
  slug: string;
  thinkingEffort?: 'min' | 'standard' | 'extended' | 'max';
}

export const CHATGPT_WEB_MODES: Record<ChatGPTWebEffort, ChatGPTWebMode> = {
  low: { effort: 'low', label: 'Instant', slug: 'gpt-5-6-instant' },
  medium: { effort: 'medium', label: 'Thinking Light', slug: 'gpt-5-6-thinking', thinkingEffort: 'min' },
  high: { effort: 'high', label: 'Thinking', slug: 'gpt-5-6-thinking', thinkingEffort: 'standard' },
  xhigh: { effort: 'xhigh', label: 'Thinking Extended', slug: 'gpt-5-6-thinking', thinkingEffort: 'extended' },
  max: { effort: 'max', label: 'Thinking Heavy', slug: 'gpt-5-6-thinking', thinkingEffort: 'max' },
  ultra: { effort: 'ultra', label: 'Pro', slug: 'gpt-6-pro', thinkingEffort: 'standard' },
};

export function isChatGPTWebModel(model: unknown): boolean {
  const raw = String(model || '').trim().toLowerCase();
  const name = raw.includes('/') ? raw.split('/').filter(Boolean).pop() || raw : raw;
  return name === CHATGPT_WEB_MODEL;
}

/** Resolve a Prometheus effort/think hint to a ChatGPT mode. Unknown values fall back to the default. */
export function resolveChatGPTWebMode(effort: unknown): ChatGPTWebMode {
  const raw = String(effort ?? '').trim().toLowerCase();
  const normalized = raw === 'extra_high' ? 'xhigh'
    : raw === 'none' || raw === 'minimal' || raw === 'fast' || raw === 'instant' ? 'low'
    : raw;
  if (normalized in CHATGPT_WEB_MODES) return CHATGPT_WEB_MODES[normalized as ChatGPTWebEffort];
  return CHATGPT_WEB_MODES[CHATGPT_WEB_DEFAULT_EFFORT];
}
