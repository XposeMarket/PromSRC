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
  return String(value || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function exactPromptSignalMatch(term: string, rawText: string): boolean {
  const normalizedTerm = normalizePromptSignalText(term);
  const normalizedText = normalizePromptSignalText(rawText);
  if (!normalizedTerm || !normalizedText) return false;
  const escaped = escapeRegExp(normalizedTerm).replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i').test(normalizedText);
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

  const matchedPhrases = (signals.phrases || [])
    .filter((phrase) => exactPromptSignalMatch(String(phrase), rawText))
    .map(String);
  const matchedAllOf = (signals.allOf || [])
    .filter((group) => Array.isArray(group) && group.length > 0 && group.every((term) => exactPromptSignalMatch(String(term), rawText)))
    .map((group) => group.map(String));
  const matchedAnyOf = (signals.anyOf || [])
    .filter((term) => exactPromptSignalMatch(String(term), rawText))
    .map(String);
  const matchedNoneOf = (signals.noneOf || [])
    .filter((term) => exactPromptSignalMatch(String(term), rawText))
    .map(String);
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
