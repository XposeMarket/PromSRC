/**
 * Small, dependency-free prompt signal matcher shared by runtime activation
 * surfaces. The skill router uses the same signal vocabulary (`phrases`,
 * `allOf`, `anyOf`, and `noneOf`); keeping the matcher here lets extensions
 * opt into that style without importing the gateway skill runtime.
 */

export interface PromptSignalConfig {
  phrases?: readonly string[];
  allOf?: readonly (readonly string[])[];
  anyOf?: readonly string[];
  noneOf?: readonly string[];
  minScore?: number;
}

export interface PromptSignalMatch {
  configured: boolean;
  matched: boolean;
  excluded: boolean;
  score: number;
  minScore: number;
  matchedPhrases: string[];
  matchedAllOf: string[][];
  matchedAnyOf: string[];
  matchedNoneOf: string[];
}

// Terms are short and stable; message text is long and was re-normalized once
// per term (and per extension). Memoize so a long paste costs one pass.
// Declared before ACTION_TERM_REGEX, which normalizes at module init.
const termCache = new Map<string, string>();
const longTextCache = new Map<string, string>();
const termRegexCache = new Map<string, RegExp>();

export const DEFAULT_ACTION_TERMS = [
  'open', 'read', 'inspect', 'check', 'search', 'find', 'look', 'look into',
  'take a look', 'check out', 'review', 'show', 'list', 'use', 'work with',
  'run', 'start', 'stop', 'create', 'make', 'build', 'edit', 'change',
  'modify', 'update', 'delete', 'remove', 'rename', 'copy', 'move', 'save',
  'download', 'upload', 'fetch', 'retrieve', 'pull', 'click', 'fill', 'type',
  'drag', 'send', 'post', 'publish', 'push', 'connect', 'configure', 'authorize',
  'approve', 'recover', 'resume', 'retry', 'debug', 'fix', 'set', 'apply',
  'manage', 'activate', 'deploy', 'redeploy', 'trigger', 'preview', 'query',
  'comment', 'merge', 'archive', 'status', 'logs', 'tail',
] as const;

const ACTION_TERM_REGEX = new RegExp(
  `\\b(?:${DEFAULT_ACTION_TERMS
    .slice()
    .sort((left, right) => right.length - left.length)
    .map((term) => escapeRegExp(normalizePromptSignalText(term)).replace(/\s+/g, '\\s+'))
    .join('|')})\\b`,
  'i',
);

const MEANING_QUESTION_REGEX = /^(?:what|who|why|how)\b/i;
const OPERATIONAL_QUESTION_REGEX = /^(?:what|which)\b[\s\S]*\b(?:status|state|latest|current|open|closed|running|available|pr|prs|pull request|pull requests|issue|issues|commit|commits|deployment|deployments|project|projects|environment|environments)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizePromptSignalText(value: unknown): string {
  const key = String(value || '');
  const long = key.length > 512;
  const cache = long ? longTextCache : termCache;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const out = key
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (long) {
    if (cache.size >= 16) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  } else if (cache.size >= 8000) {
    cache.clear();
  }
  cache.set(key, out);
  return out;
}

function normalizedTermMatch(normalizedTerm: string, normalizedText: string): boolean {
  if (!normalizedTerm || !normalizedText) return false;
  // Normalized text has single spaces, so a substring miss proves a miss.
  if (!normalizedText.includes(normalizedTerm)) return false;
  let pattern = termRegexCache.get(normalizedTerm);
  if (!pattern) {
    const escaped = escapeRegExp(normalizedTerm).replace(/\s+/g, '\\s+');
    pattern = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i');
    if (termRegexCache.size >= 4000) termRegexCache.clear();
    termRegexCache.set(normalizedTerm, pattern);
  }
  return pattern.test(normalizedText);
}

export function exactPromptSignalMatch(term: string, rawText: string): boolean {
  return normalizedTermMatch(normalizePromptSignalText(term), normalizePromptSignalText(rawText));
}

export function evaluatePromptSignals(
  signals: PromptSignalConfig | undefined,
  rawText: string,
): PromptSignalMatch {
  const empty: PromptSignalMatch = {
    configured: false,
    matched: false,
    excluded: false,
    score: 0,
    minScore: 4,
    matchedPhrases: [],
    matchedAllOf: [],
    matchedAnyOf: [],
    matchedNoneOf: [],
  };
  if (!signals) return empty;

  const text = normalizePromptSignalText(rawText);
  const hit = (term: unknown) => normalizedTermMatch(normalizePromptSignalText(String(term)), text);
  const matchedPhrases = (signals.phrases || []).filter(hit).map(String);
  const matchedAllOf = (signals.allOf || [])
    .filter((group) => Array.isArray(group) && group.length > 0 && group.every(hit))
    .map((group) => group.map(String));
  const matchedAnyOf = (signals.anyOf || []).filter(hit).map(String);
  const matchedNoneOf = (signals.noneOf || []).filter(hit).map(String);
  const rawMinScore = Number(signals.minScore ?? 4);
  const minScore = Number.isFinite(rawMinScore) ? Math.max(1, Math.min(100, Math.round(rawMinScore))) : 4;
  const score = matchedPhrases.length * 4
    + matchedAllOf.reduce((sum, group) => sum + group.length * 2, 0)
    + matchedAnyOf.length;
  const excluded = matchedNoneOf.length > 0;
  return {
    configured: true,
    matched: !excluded && score >= minScore,
    excluded,
    score,
    minScore,
    matchedPhrases,
    matchedAllOf,
    matchedAnyOf,
    matchedNoneOf,
  };
}

export function isMeaningQuestion(rawText: string): boolean {
  const text = normalizePromptSignalText(rawText);
  return MEANING_QUESTION_REGEX.test(text) && !OPERATIONAL_QUESTION_REGEX.test(text)
    && !/^(?:how do i|how can i|how should i|what should i do|what can you do with)\b/i.test(text);
}

export function hasActionablePromptIntent(rawText: string): boolean {
  return ACTION_TERM_REGEX.test(normalizePromptSignalText(rawText));
}

export function matchesActionableMention(
  rawText: string,
  aliases: readonly string[],
  options: { explicitToolNames?: readonly string[]; allowTaskNouns?: boolean } = {},
): { matched: boolean; aliases: string[]; explicitTool: boolean } {
  const text = normalizePromptSignalText(rawText);
  if (!text) return { matched: false, aliases: [], explicitTool: false };

  const explicitTool = (options.explicitToolNames || [])
    .some((name) => exactPromptSignalMatch(name, text));
  if (explicitTool) return { matched: true, aliases: [], explicitTool: true };
  if (isMeaningQuestion(text)) return { matched: false, aliases: [], explicitTool: false };

  const matchedAliases = aliases
    .map(String)
    .filter((alias) => exactPromptSignalMatch(alias, text));
  if (!matchedAliases.length) return { matched: false, aliases: [], explicitTool: false };

  const taskNoun = options.allowTaskNouns !== false
    && /\b(?:connector|plugin|tool|tools|api|account|deployment|deployments|project|projects|repository|repo|pull request|pull requests|pr|prs|issue|issues|commit|commits|push|message|email|inbox|file|files|page|record|channel|workspace|environment|logs?)\b/i.test(text);
  return {
    matched: hasActionablePromptIntent(text) || taskNoun,
    aliases: matchedAliases,
    explicitTool: false,
  };
}
