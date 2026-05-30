import type { ContentPart } from './LLMProvider';
import { PROMPT_CACHE_MARKER } from './LLMProvider';

/**
 * Remove the prompt-cache breakpoint sentinel, collapsing it back to the
 * blank-line separator it replaced. Use in every adapter that does NOT place
 * explicit cache breakpoints (everything except Anthropic) so the marker never
 * leaks into the text sent to a model.
 */
export function stripCacheMarker(text: string): string {
  if (!text || text.indexOf('␞') === -1) return text;
  return text.split(PROMPT_CACHE_MARKER).join('\n\n');
}

/**
 * Split a system prompt into its STABLE prefix and VOLATILE tail at the cache
 * marker. Returns the whole string as `stable` (and empty `volatile`) when no
 * marker is present, so callers can safely cache the full prefix. The marker
 * itself is consumed and never appears in either half.
 */
export function splitOnCacheMarker(text: string): { stable: string; volatile: string } {
  if (!text) return { stable: '', volatile: '' };
  const idx = text.indexOf(PROMPT_CACHE_MARKER);
  if (idx === -1) return { stable: text, volatile: '' };
  return {
    stable: text.slice(0, idx),
    volatile: text.slice(idx + PROMPT_CACHE_MARKER.length),
  };
}

/**
 * Coerce provider message content to plain text.
 * Preserves text parts when content is multimodal.
 */
export function contentToString(content: string | ContentPart[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}
