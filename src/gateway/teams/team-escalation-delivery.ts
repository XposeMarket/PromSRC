/**
 * team-escalation-delivery.ts — main-agent review turns for coordinator escalations.
 *
 * Ladder: member -> manager -> main -> user. This module owns manager -> main delivery.
 *  - Dedup: a message is delivered at most once per ESCALATION_REDELIVER_MS.
 *  - Each delivery queues one main-agent review task (same mechanics as the goal-complete review).
 *  - After MAX_ESCALATION_DELIVERIES the message becomes escalated_to_user (stays unread, shows in Needs-You).
 *  - Redelivery is lazy: sweepTeamEscalations runs at each coordinator turn start for that team.
 */
import {
  getManagedTeam,
  updateMainAgentThreadMessages,
  escalationViewsFromTeam,
  type EscalationView,
  type MainAgentThreadMessage,
} from './managed-teams';

export const ESCALATION_REDELIVER_MS = 6 * 60 * 60 * 1000;
export const MAX_ESCALATION_DELIVERIES = 3;

export interface EscalationReviewJob {
  teamId: string;
  teamName: string;
  sessionId: string;
  title: string;
  prompt: string;
  source: 'team_escalation';
  plan: Array<{ index: number; description: string; status: 'pending' }>;
}

export type EscalationReviewRunner = (job: EscalationReviewJob) => void | Promise<void>;

let reviewRunner: EscalationReviewRunner | null = null;

/** Injected at boot (startup.ts) so this module does not import startup. */
export function setEscalationReviewRunner(fn: EscalationReviewRunner | null): void {
  reviewRunner = fn;
}

export interface EscalationDeliveryResult {
  delivered: boolean;
  reason: 'delivered' | 'team_not_found' | 'message_not_found' | 'not_open' | 'deduped' | 'no_runner';
  status?: string;
  deliveryCount?: number;
}

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Prompt-ready block. Returns '' when nothing is open, so callers can drop it in. */
export function buildOpenEscalationsSection(team: any, now: number = Date.now()): string {
  const open = escalationViewsFromTeam(team, now);
  if (!open.length) return '';
  const lines = open.map((v: EscalationView) =>
    `- [${v.id}] level=${v.level} type=${v.type} status=${v.status} age=${formatAge(v.ageMs)} deliveries=${v.deliveryCount}\n  ${v.content.slice(0, 1500)}`,
  );
  return [
    '[OPEN ESCALATIONS]',
    `${open.length} unanswered. Answer with reply_to_team, or team_ops_wrapper(action:"escalation", escalation_action:"escalate_to_user"|"dismiss", team_id, message_id).`,
    ...lines,
    '',
  ].join('\n');
}

/** One review task per batch: every escalation in items gets its id, type, and exact tool calls. */
function buildEscalationReviewPrompt(
  team: any,
  items: Array<{ msg: MainAgentThreadMessage; view: EscalationView }>,
  now: number,
): string {
  const batchIds = new Set(items.map(i => i.msg.id));
  const others = escalationViewsFromTeam(team, now).filter(v => !batchIds.has(v.id));
  const recentChat = (team.teamChat || []).slice(-10)
    .map((m: any) => `- [${m.fromName || m.from}] ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n') || '(no recent team chat)';
  const otherLines = others.length
    ? others.map(v => `- [${v.id}] type=${v.type} age=${formatAge(v.ageMs)}: ${v.preview}`).join('\n')
    : '(none)';
  const blocks = items.flatMap(({ msg, view }, i) => [
    `Escalation ${i + 1} of ${items.length}: id ${msg.id} (type=${msg.type}, level=${view.level}, age=${formatAge(view.ageMs)}, attempt ${msg.deliveryCount || 1} of ${MAX_ESCALATION_DELIVERIES})`,
    String(msg.content || ''),
    `  Escalate to user: team_ops_wrapper(action="escalation", escalation_action="escalate_to_user", team_id="${team.id}", message_id="${msg.id}", note="...")`,
    `  Dismiss (stale or duplicate): team_ops_wrapper(action="escalation", escalation_action="dismiss", team_id="${team.id}", message_id="${msg.id}", note="...")`,
    '',
  ]);
  return [
    'You are Prometheus main agent. A managed team manager escalated to you and needs a decision.',
    '',
    `Team: ${team.name} (${team.id})`,
    `Purpose: ${team.purpose || team.mission || team.teamContext || ''}`,
    `Current focus: ${team.currentFocus || ''}`,
    '',
    `${items.length} escalation(s) need a decision in this review:`,
    '',
    ...blocks,
    'Other open escalations for this team:',
    otherLines,
    '',
    'Recent team chat:',
    recentChat,
    '',
    'Decide every escalation above. Pick one outcome for each:',
    `1) Reply/decide for the team: reply_to_team(team_id="${team.id}", message="...") answers EVERY open escalation for this team, so one reply can cover the whole batch. The manager resumes.`,
    '2) Or handle one message with the escalate or dismiss calls listed under it (escalate to user for credentials, payments, accounts, destructive or irreversible actions; dismiss for stale or duplicate items).',
    '',
    'Do not reply with only "noted". Choose an outcome for every escalation.',
  ].join('\n');
}


/** True when a message has never been delivered, or its last delivery is at least ESCALATION_REDELIVER_MS old. */
function isDueForDelivery(team: any, messageId: string, now: number): boolean {
  const msg = (team.mainAgentThread || []).find((m: MainAgentThreadMessage) => m.id === messageId);
  return !msg?.deliveredAt || now - msg.deliveredAt >= ESCALATION_REDELIVER_MS;
}

/**
 * Stamp every escalation in the batch (one shared session id, per-message 3-strike rule) on a
 * freshly loaded team, then queue ONE review task that covers the whole batch.
 * Returns the stamped messages (empty when there is no runner or nothing matched).
 */
async function queueEscalationBatch(teamId: string, batch: EscalationView[], now: number): Promise<MainAgentThreadMessage[]> {
  const runner = reviewRunner;
  if (!runner || !batch.length) return [];
  const sessionId = `team_escalation_${teamId}_${now.toString(36)}`;
  const ids = new Set(batch.map(v => v.id));
  const stamped = updateMainAgentThreadMessages(
    teamId,
    m => ids.has(m.id),
    m => {
      const count = (m.deliveryCount || 0) + 1;
      return count >= MAX_ESCALATION_DELIVERIES
        ? { deliveredAt: now, deliveryCount: count, deliverySessionId: sessionId, status: 'escalated_to_user', read: false }
        : { deliveredAt: now, deliveryCount: count, deliverySessionId: sessionId };
    },
  );
  if (!stamped.length) return [];

  const team: any = getManagedTeam(teamId);
  const teamName = team?.name || teamId;
  const items = stamped.map(msg => ({ msg, view: batch.find(v => v.id === msg.id)! }));
  const job: EscalationReviewJob = {
    teamId,
    teamName,
    sessionId,
    title: stamped.length === 1
      ? `Team Escalation: ${teamName} (${stamped[0].type})`
      : `Team Escalation: ${teamName} (${stamped.length} messages)`,
    prompt: buildEscalationReviewPrompt(team, items, now),
    source: 'team_escalation',
    plan: [
      { index: 0, description: 'Read the escalations and team state.', status: 'pending' },
      { index: 1, description: 'Decide each escalation: reply to the team, escalate to the user, or dismiss.', status: 'pending' },
    ],
  };
  try {
    await runner(job);
  } catch (err: any) {
    console.warn(`[TeamEscalation] review task failed to start for ${teamId}: ${err?.message || err}`);
  }
  return stamped;
}

/**
 * Deliver one open escalation to main (a single message_main_agent call delivers just that message).
 * Dedup: skipped if delivered within ESCALATION_REDELIVER_MS (unless opts.force).
 * On the MAX_ESCALATION_DELIVERIES-th delivery the message becomes escalated_to_user.
 */
export async function deliverTeamEscalation(
  teamId: string,
  messageId: string,
  opts: { now?: number; force?: boolean } = {},
): Promise<EscalationDeliveryResult> {
  const team: any = getManagedTeam(teamId);
  if (!team) return { delivered: false, reason: 'team_not_found' };
  const now = opts.now ?? Date.now();
  const msg = (team.mainAgentThread || []).find((m: MainAgentThreadMessage) => m.id === messageId);
  if (!msg || msg.from !== 'coordinator') return { delivered: false, reason: 'message_not_found' };
  const view = escalationViewsFromTeam(team, now).find(v => v.id === messageId);
  if (!view || view.status !== 'open') return { delivered: false, reason: 'not_open', status: view?.status };
  if (!opts.force && msg.deliveredAt && now - msg.deliveredAt < ESCALATION_REDELIVER_MS) {
    return { delivered: false, reason: 'deduped', status: 'open', deliveryCount: msg.deliveryCount || 0 };
  }
  if (!reviewRunner) return { delivered: false, reason: 'no_runner' };

  const [stamped] = await queueEscalationBatch(teamId, [view], now);
  if (!stamped) return { delivered: false, reason: 'message_not_found' };
  return { delivered: true, reason: 'delivered', status: stamped.status || 'open', deliveryCount: stamped.deliveryCount };
}

/**
 * Lazy redelivery sweep for one team, called at coordinator turn start.
 * Batches per team: every due open escalation goes into ONE review task. Due means never delivered
 * or last delivered at least ESCALATION_REDELIVER_MS ago. Paused teams are skipped.
 * Returns the number of escalations delivered in the batch (0 means no task was queued).
 */
export async function sweepTeamEscalations(teamId: string, now: number = Date.now()): Promise<number> {
  const team: any = getManagedTeam(teamId);
  if (!team || team.manager?.paused === true) return 0;
  const due = escalationViewsFromTeam(team, now)
    .filter(v => v.status === 'open' && isDueForDelivery(team, v.id, now));
  if (!due.length) return 0;
  const stamped = await queueEscalationBatch(teamId, due, now);
  return stamped.length;
}

