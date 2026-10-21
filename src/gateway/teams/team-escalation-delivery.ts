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
  saveManagedTeam,
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

function buildEscalationReviewPrompt(team: any, msg: MainAgentThreadMessage, view: EscalationView, attempt: number, now: number): string {
  const others = escalationViewsFromTeam(team, now).filter(v => v.id !== msg.id);
  const recentChat = (team.teamChat || []).slice(-10)
    .map((m: any) => `- [${m.fromName || m.from}] ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n') || '(no recent team chat)';
  const otherLines = others.length
    ? others.map(v => `- [${v.id}] type=${v.type} age=${formatAge(v.ageMs)}: ${v.preview}`).join('\n')
    : '(none)';
  return [
    'You are Prometheus main agent. A managed team manager escalated to you and needs a decision.',
    '',
    `Team: ${team.name} (${team.id})`,
    `Purpose: ${team.purpose || team.mission || team.teamContext || ''}`,
    `Current focus: ${team.currentFocus || ''}`,
    '',
    `Escalation ${msg.id} (type=${msg.type}, level=${view.level}, age=${formatAge(view.ageMs)}, attempt ${attempt} of ${MAX_ESCALATION_DELIVERIES}):`,
    String(msg.content || ''),
    '',
    'Other open escalations for this team:',
    otherLines,
    '',
    'Recent team chat:',
    recentChat,
    '',
    'Pick exactly one outcome:',
    `1) Reply/decide: reply_to_team(team_id="${team.id}", message="...") with the decision or missing context. The manager resumes and this escalation is answered.`,
    `2) Escalate to the user (credentials, payments, accounts, destructive or irreversible actions, or anything only the user can do): team_ops_wrapper(action="escalation", escalation_action="escalate_to_user", team_id="${team.id}", message_id="${msg.id}", note="...").`,
    `3) Dismiss (stale or duplicate): team_ops_wrapper(action="escalation", escalation_action="dismiss", team_id="${team.id}", message_id="${msg.id}", note="...").`,
    '',
    'Do not reply with only "noted". Choose one outcome.',
  ].join('\n');
}

/**
 * Deliver one open escalation to main. Dedup: skipped if delivered within ESCALATION_REDELIVER_MS
 * (unless opts.force). On the MAX_ESCALATION_DELIVERIES-th delivery the message becomes escalated_to_user.
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

  const count = (msg.deliveryCount || 0) + 1;
  msg.deliveredAt = now;
  msg.deliveryCount = count;
  msg.deliverySessionId = `team_escalation_${teamId}_${messageId}_${count}`;
  if (count >= MAX_ESCALATION_DELIVERIES) {
    msg.status = 'escalated_to_user';
    msg.read = false;
  }
  saveManagedTeam(team);

  const job: EscalationReviewJob = {
    teamId,
    teamName: team.name || teamId,
    sessionId: msg.deliverySessionId,
    title: `Team Escalation: ${team.name || teamId} (${msg.type})`,
    prompt: buildEscalationReviewPrompt(team, msg, { ...view, deliveryCount: count }, count, now),
    source: 'team_escalation',
    plan: [
      { index: 0, description: 'Read the escalation and team state.', status: 'pending' },
      { index: 1, description: 'Decide: reply to the team, escalate to the user, or dismiss.', status: 'pending' },
    ],
  };
  try {
    await reviewRunner(job);
  } catch (err: any) {
    console.warn(`[TeamEscalation] review task failed to start for ${teamId}: ${err?.message || err}`);
  }
  return { delivered: true, reason: 'delivered', status: msg.status || 'open', deliveryCount: count };
}

/**
 * Lazy redelivery sweep for one team. Called at coordinator turn start.
 * Delivers every open escalation whose last delivery is older than ESCALATION_REDELIVER_MS
 * (or that was never delivered, which backfills legacy records). Paused teams are skipped.
 */
export async function sweepTeamEscalations(teamId: string, now: number = Date.now()): Promise<number> {
  const team: any = getManagedTeam(teamId);
  if (!team || team.manager?.paused === true) return 0;
  let delivered = 0;
  for (const v of escalationViewsFromTeam(team, now)) {
    if (v.status !== 'open') continue;
    const result = await deliverTeamEscalation(teamId, v.id, { now });
    if (result.delivered) delivered++;
  }
  return delivered;
}
