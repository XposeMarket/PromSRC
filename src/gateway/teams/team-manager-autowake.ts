import { appendTeamRoomMessage, getManagedTeam } from './managed-teams';

type BroadcastFn = (data: object) => void;
type HandleManagerConversationFn = (
  teamId: string,
  userMessage: string,
  broadcastFn?: BroadcastFn,
  autoContinue?: boolean,
) => Promise<void>;

interface TeamManagerAutoWakeDeps {
  handleManagerConversation: HandleManagerConversationFn;
  broadcastTeamEvent: BroadcastFn;
}

interface PendingManagerWake {
  reasons: string[];
  firstQueuedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
}

const TEAM_MANAGER_AUTO_WAKE_DELAY_MS = 1600;
const TEAM_MANAGER_AUTO_WAKE_MAX_REASONS = 8;
const pendingWakes = new Map<string, PendingManagerWake>();
let _deps: TeamManagerAutoWakeDeps | null = null;

export function setTeamManagerAutoWakeDeps(deps: TeamManagerAutoWakeDeps): void {
  _deps = deps;
}

function compact(value: unknown, max = 500): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function buildWakePrompt(teamId: string, reasons: string[]): string {
  const reasonLines = reasons.slice(-TEAM_MANAGER_AUTO_WAKE_MAX_REASONS)
    .map((reason, index) => `${index + 1}. ${compact(reason, 650)}`);
  return [
    `[TEAM EVENT AUTO-WAKE]`,
    `Important team-room events occurred while the team was working.`,
    ``,
    `Events:`,
    ...reasonLines,
    ``,
    `Review the current team room state, dispatch records, member states, and any manager inbox messages.`,
    `Decide the next useful action: accept the result, ask a member to weigh in, dispatch follow-up work, update the plan, or ask the team owner for input.`,
    `Be concise. If no action is needed, post a short status update. If follow-up work is needed, act now.`,
    `Team ID: ${teamId}`,
  ].join('\n');
}

async function flushTeamManagerWake(teamId: string): Promise<void> {
  const entry = pendingWakes.get(teamId);
  if (!entry || entry.running) return;
  const deps = _deps;
  if (!deps) return;

  const team = getManagedTeam(teamId);
  if (!team || team.manager?.paused === true) {
    pendingWakes.delete(teamId);
    return;
  }

  entry.running = true;
  entry.timer = undefined;
  const reasons = [...entry.reasons];
  entry.reasons = [];
  try {
    appendTeamRoomMessage(teamId, {
      actorType: 'system',
      actorName: 'Team Manager Auto-Wake',
      content: `Manager auto-wake queued from ${reasons.length} event${reasons.length === 1 ? '' : 's'}:\n${reasons.map((reason, index) => `${index + 1}. ${compact(reason, 260)}`).join('\n')}`,
      category: 'status',
      target: 'manager',
      metadata: {
        source: 'team_manager_auto_wake',
      },
    }, { mirrorToChat: false });
    deps.broadcastTeamEvent({
      type: 'team_manager_auto_wake',
      teamId,
      teamName: team.name,
      reasonCount: reasons.length,
      reasons,
    });
    await deps.handleManagerConversation(
      teamId,
      buildWakePrompt(teamId, reasons),
      deps.broadcastTeamEvent,
      true,
    );
  } catch (err: any) {
    console.warn(`[TeamManagerAutoWake] Manager wake failed for ${teamId}:`, err?.message || err);
  } finally {
    entry.running = false;
    if (entry.reasons.length > 0) {
      entry.timer = setTimeout(() => {
        void flushTeamManagerWake(teamId);
      }, TEAM_MANAGER_AUTO_WAKE_DELAY_MS);
    } else {
      pendingWakes.delete(teamId);
    }
  }
}

export function scheduleTeamManagerAutoWake(teamId: string, reason: string): boolean {
  const deps = _deps;
  if (!deps) return false;
  const team = getManagedTeam(teamId);
  if (!team || team.manager?.paused === true) return false;

  const cleanReason = compact(reason, 900);
  if (!cleanReason) return false;
  let entry = pendingWakes.get(teamId);
  if (!entry) {
    entry = {
      reasons: [],
      firstQueuedAt: Date.now(),
      running: false,
    };
    pendingWakes.set(teamId, entry);
  }
  entry.reasons = [...entry.reasons, cleanReason].slice(-TEAM_MANAGER_AUTO_WAKE_MAX_REASONS);
  if (!entry.timer && !entry.running) {
    entry.timer = setTimeout(() => {
      void flushTeamManagerWake(teamId);
    }, TEAM_MANAGER_AUTO_WAKE_DELAY_MS);
  }
  return true;
}
