import type { ModelContextProfile } from './model-context';

export type ContextSelection = { mode: 'standard' | 'maximum' | 'custom'; tokens?: number; extendedAcknowledged?: boolean };

/** Shared admission rule for all UI/tool settings writes; no implicit premium opt-in. */
export function validateContextSelection(value: any, profile: ModelContextProfile): ContextSelection {
  if (!['standard', 'maximum', 'custom'].includes(value?.mode)) throw new Error('Choose standard, maximum or custom context.');
  const maximum = profile.maxContextWindowTokens || profile.contextWindowTokens;
  const standard = profile.standardContextWindowTokens || maximum;
  const tokens = value.mode === 'maximum' ? maximum : value.mode === 'standard' ? standard : Number(value.tokens);
  if (!Number.isSafeInteger(tokens) || tokens < 1024 || tokens > maximum) throw new Error(`Context must be between 1024 and ${maximum} tokens for this model.`);
  if (tokens > standard && value.extendedAcknowledged !== true) throw new Error('Acknowledge the extended-context usage warning before enabling it.');
  return { mode: value.mode, tokens: value.mode === 'custom' ? tokens : undefined, extendedAcknowledged: tokens > standard && value.extendedAcknowledged === true };
}
