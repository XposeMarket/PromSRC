/**
 * Browser copy of the team-reply payload rule (mirrors src/gateway/needs-you-team-reply.ts).
 * Kept dependency-free so the Tasks page and tests share one shape.
 */
export const TEAM_REPLY_MAX_CHARS = 8000;

export function buildTeamReplyPayload({ text, memberId, memberLabel } = {}) {
  const message = String(text ?? '').trim();
  if (!message) throw new Error('Reply text is required.');
  if (message.length > TEAM_REPLY_MAX_CHARS) throw new Error(`Reply is too long (max ${TEAM_REPLY_MAX_CHARS} characters).`);
  const payload = { message, role: 'user' };
  const id = String(memberId ?? '').trim();
  if (id) {
    payload.targetId = id;
    const label = String(memberLabel ?? '').trim();
    if (label) payload.targetLabel = label;
  }
  return payload;
}
