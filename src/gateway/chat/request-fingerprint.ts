import {
  hashTurnJsonValueCanonicalAsync,
  toTurnJsonValueAsync,
} from '../turn-jobs/execution-context.js';

/**
 * Hash only request fields that define chat idempotency. Large attachment
 * strings are normalized and hashed cooperatively, so computing the key does
 * not create one giant JSON.stringify pause on the gateway event loop.
 */
export async function fingerprintMainChatRequest(input: Record<string, any>): Promise<string> {
  const normalized = await toTurnJsonValueAsync({
    message: input.message,
    pinnedMessages: input.pinnedMessages,
    attachments: input.attachments,
    attachmentPreviews: input.attachmentPreviews,
    reasoning: input.reasoning,
    callerContext: input.callerContext,
    excludedSkillIds: input.excludedSkillIds || input.excludedMatchingSkillIds,
    selectedSkillIds: input.selectedSkillIds || input.forcedSkillIds || input.matchedSkillIds,
  });
  return hashTurnJsonValueCanonicalAsync(normalized);
}
