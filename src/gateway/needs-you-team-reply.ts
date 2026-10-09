/**
 * needs-you-team-reply.ts
 *
 * Pure payload builder for the inline "Reply" on a team_escalation card in the
 * Needs-you inbox. The Tasks page posts this body to the team chat endpoint
 * (POST /api/teams/:id/chat) and then refreshes /api/needs-you.
 */

export interface TeamReplyPayloadInput {
  text: unknown;
  memberId?: unknown;
  memberLabel?: unknown;
}

export interface TeamReplyPayload {
  message: string;
  role: 'user';
  /** Present only when the escalation names a member; otherwise the reply goes to the manager. */
  targetId?: string;
  targetLabel?: string;
}

export const TEAM_REPLY_MAX_CHARS = 8000;

export function buildTeamReplyPayload(input: TeamReplyPayloadInput): TeamReplyPayload {
  const message = String(input.text ?? '').trim();
  if (!message) throw new Error('Reply text is required.');
  if (message.length > TEAM_REPLY_MAX_CHARS) throw new Error(`Reply is too long (max ${TEAM_REPLY_MAX_CHARS} characters).`);
  const payload: TeamReplyPayload = { message, role: 'user' };
  const memberId = String(input.memberId ?? '').trim();
  if (memberId) {
    payload.targetId = memberId;
    const label = String(input.memberLabel ?? '').trim();
    if (label) payload.targetLabel = label;
  }
  return payload;
}
