/**
 * Idempotency identity for background follow-up admission.
 *
 * Identity = stable parent turn + tool-call id + normalized message digest.
 * - A genuine retry (same turn, same tool call, same message) yields the same key.
 * - A distinct question never aliases, even with a reused id such as
 *   `local_text_0` (which is per model round, not globally unique).
 * - A missing tool-call id falls back to turn + digest.
 * - No parent turn means no stable identity: null (admission rejected).
 */
import crypto from 'node:crypto';

export function normalizeFollowUpMessage(message: string): string {
  return String(message || '').replace(/\s+/g, ' ').trim();
}

export function followUpAdmissionKey(input: { parentTurnId: string; toolCallId?: string; message: string }): string | null {
  const parentTurnId = String(input.parentTurnId || '').trim();
  if (!parentTurnId) return null;
  const toolCallId = String(input.toolCallId || '').trim();
  const digest = crypto.createHash('sha256').update(normalizeFollowUpMessage(input.message), 'utf8').digest('hex');
  return crypto.createHash('sha256')
    .update(JSON.stringify([parentTurnId, toolCallId, digest]), 'utf8')
    .digest('hex');
}
