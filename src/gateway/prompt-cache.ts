import { PROMPT_CACHE_MARKER } from '../providers/LLMProvider';
import { splitOnCacheMarker } from '../providers/content-utils';

/**
 * Compose a system prompt with one deterministic provider-cache prefix.
 *
 * `buildPersonalityContext` already separates its stable profile/tool material
 * from per-turn material. The chat route also has per-turn state (clock,
 * browser state, tool observations, caller context), which must not precede
 * that large reusable prefix. This helper keeps the system prompt as one
 * message while placing all of that state after the cache marker.
 */
export function assembleCacheAwareSystemPrompt(input: {
  stableParts?: Array<string | undefined | null | false>;
  personalityContext?: string | null;
  /** Dynamic route context that historically appeared before personality context. */
  volatileBeforePersonality?: Array<string | undefined | null | false>;
  /** Dynamic route context that historically appeared after personality context. */
  volatileAfterPersonality?: Array<string | undefined | null | false>;
  /** Compatibility shorthand for volatile context that precedes personality context. */
  volatileParts?: Array<string | undefined | null | false>;
}): string {
  const join = (parts: Array<string | undefined | null | false>): string => parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n\n');
  const personality = splitOnCacheMarker(String(input.personalityContext || ''));
  const stable = join([...(input.stableParts || []), personality.stable]);
  const volatile = join([
    ...(input.volatileBeforePersonality || input.volatileParts || []),
    personality.volatile,
    ...(input.volatileAfterPersonality || []),
  ]);

  if (!stable) return volatile;
  if (!volatile) return stable;
  return `${stable}${PROMPT_CACHE_MARKER}${volatile}`;
}

/** Promote only exact invariant guidance emitted inside a tool-menu block.
 * Never inspect arbitrary notes/user content or cache the dynamic menu itself.
 */
export function partitionInvariantToolGuidance(parts: string[], guidance: string[]): { stable: string[]; volatile: string[] } {
  const stable: string[] = [];
  const volatile = parts.map(part => {
    if (!part.startsWith('[TOOLS]')) return part;
    let remaining = part;
    for (const block of guidance) {
      if (!block) continue;
      // Match complete emitted sections, not substrings in other instructions.
      const needle = `\n\n${block}`;
      const index = remaining.indexOf(needle);
      const end = index + needle.length;
      if (index < 0 || (end < remaining.length && !remaining.startsWith('\n\n', end))) continue;
      if (!stable.includes(block)) stable.push(block);
      remaining = remaining.slice(0, index) + remaining.slice(end);
    }
    return remaining;
  });
  return { stable, volatile };
}
