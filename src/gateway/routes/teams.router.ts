// src/gateway/routes/teams.router.ts
// Teams, Schedules, Team Workspace routes
import { Router } from 'express';
import { getBrainRunnerInstance } from '../brain/brain-runner';
import { getConfig, getAgentById } from '../../config/config';
import { broadcastTeamEvent, addTeamSseClient, removeTeamSseClient } from '../comms/broadcaster';
import {
  listManagedTeams, getManagedTeam, saveManagedTeam, deleteManagedTeam, createManagedTeam,
  appendTeamChat, applyTeamChange, rejectTeamChange, addTeamNotificationTarget, enqueueTeamDirectThreadUserMessage, getOrCreateTeamDirectThread, queueAgentMessage,
  listTeamContextReferences, addTeamContextReference, updateTeamContextReference,
  deleteTeamContextReference, buildTeamContextRuntimeBlock,
  computeTeamHealth, getTeamRunHistory, getTeamRoomState,
} from '../teams/managed-teams';
import { createTask, listTaskSummaries, updateTaskStatus, mutatePlan, appendJournal } from '../tasks/task-store';
import { reloadAgentSchedules, recordAgentRun, getAgentRunHistory } from '../../scheduler';
import {
  triggerManagerReview,
  handleManagerConversation,
  handleManagerConversationDetailed,
  verifySubagentResult,
} from '../teams/team-manager-runner';
import { routeTeamEvent } from '../teams/team-event-router';
import { runTeamMemberRoomTurn, scheduleTeamMemberAutoWake, scheduleTeamMemberDirectWake } from '../teams/team-member-room';
import { dismissTeamSuggestion } from '../teams/team-detector';
import { buildTeamDispatchTask, runTeamAgentViaChat } from '../teams/team-dispatch-runtime';
import { claimAgentForTeamWorkspace } from '../teams/team-workspace';
import { ensureScheduleOwnerAgent, ensureScheduleRuntimeForAgent } from '../scheduling/schedule-agent';
import * as fs from 'fs';
import * as path from 'path';
import { appendManagerNote, getTeamMemberAgentIds } from '../teams/managed-teams';
import { type TaskStatus } from '../tasks/task-store';

export const router = Router();

let _cronScheduler: any;
let _handleChat: (...args: any[]) => Promise<any>;
let _telegramChannel: any;
let _sanitizeAgentId: (v: any) => string;
let _normalizeAgentsForSave: (a: any[]) => any[];
let _bindTeamNotificationTargetFromSession: (teamId: string, sessionId: string, source?: string) => void;

export function initTeamsRouter(deps: {
  cronScheduler: any;
  handleChat: (...args: any[]) => Promise<any>;
  telegramChannel: any;
  sanitizeAgentId: (v: any) => string;
  normalizeAgentsForSave: (a: any[]) => any[];
  bindTeamNotificationTargetFromSession: (teamId: string, sessionId: string, source?: string) => void;
}): void {
  _cronScheduler = deps.cronScheduler;
  _handleChat = deps.handleChat;
  _telegramChannel = deps.telegramChannel;
  _sanitizeAgentId = deps.sanitizeAgentId;
  _normalizeAgentsForSave = deps.normalizeAgentsForSave;
  _bindTeamNotificationTargetFromSession = deps.bindTeamNotificationTargetFromSession;
}

function createSSESender(res: any): (event: string, data: any) => void {
  return (type: string, data: any) => {
    try {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch {
      // Ignore writes after client disconnect.
    }
  };
}

type TeamChatRouteTarget = {
  type: 'room' | 'team' | 'manager' | 'member';
  targetId?: string;
  targetLabel?: string;
  routedMessage: string;
};

function normalizeTeamMentionKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .trim();
}

function buildTeamMentionParticipants(team: any): Array<{
  type: 'team' | 'manager' | 'member';
  id: string;
  label: string;
  aliases: string[];
}> {
  const participants: Array<{ type: 'team' | 'manager' | 'member'; id: string; label: string; aliases: string[] }> = [
    { type: 'team', id: team.id, label: 'team', aliases: ['team'] },
    { type: 'manager', id: 'manager', label: 'manager', aliases: ['manager'] },
  ];
  for (const agentId of Array.isArray(team?.subagentIds) ? team.subagentIds : []) {
    const agent = getAgentById(agentId) as any;
    const label = String(agent?.name || agentId).trim() || String(agentId || '').trim();
    const aliases = Array.from(new Set([
      normalizeTeamMentionKey(label),
      normalizeTeamMentionKey(agentId),
      normalizeTeamMentionKey(label.replace(/\s+/g, '-')),
    ].filter(Boolean)));
    participants.push({ type: 'member', id: agentId, label, aliases });
  }
  return participants;
}

function resolveTeamChatRouteTarget(team: any, rawMessage: string, body: any): TeamChatRouteTarget {
  const original = String(rawMessage || '').trim();
  const explicitType = String(body?.targetType || '').trim().toLowerCase();
  const explicitTargetId = String(body?.targetId || '').trim();
  const explicitTargetLabel = String(body?.targetLabel || '').trim();
  const routedMessage = String(body?.routedMessage || '').trim() || original;

  if (explicitType === 'room') {
    return { type: 'room', routedMessage };
  }
  if ((explicitType === 'team' || explicitType === 'manager') && !explicitTargetId) {
    return { type: explicitType, targetLabel: explicitTargetLabel || explicitType, routedMessage };
  }
  if (explicitType === 'member' && explicitTargetId && Array.isArray(team?.subagentIds) && team.subagentIds.includes(explicitTargetId)) {
    return {
      type: 'member',
      targetId: explicitTargetId,
      targetLabel: explicitTargetLabel || (getAgentById(explicitTargetId) as any)?.name || explicitTargetId,
      routedMessage,
    };
  }

  const leading = String(rawMessage || '').trimStart();
  if (!leading.startsWith('@')) {
    return { type: 'team', targetLabel: 'team', routedMessage: original };
  }

  const afterAt = leading.slice(1);
  const participants = buildTeamMentionParticipants(team);
  const aliasEntries = participants
    .flatMap((participant) => participant.aliases.map((alias) => ({ participant, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const lowerAfter = afterAt.toLowerCase();

  for (const entry of aliasEntries) {
    if (!entry.alias) continue;
    if (!lowerAfter.startsWith(entry.alias)) continue;
    const boundaryChar = afterAt.charAt(entry.alias.length);
    if (boundaryChar && !/[\s.,!?;:)\]}]/.test(boundaryChar)) continue;
    const rest = afterAt.slice(entry.alias.length).trimStart();
    return {
      type: entry.participant.type,
      targetId: entry.participant.type === 'member' ? entry.participant.id : undefined,
      targetLabel: entry.participant.label,
      routedMessage: rest || original,
    };
  }

  return { type: 'team', targetLabel: 'team', routedMessage: original };
}

// ─── Teams API ───────────────────────────────────────────────────────────────────

function buildTeamBroadcastMemberPrompt(broadcastText: string): string {
  return [
    `[TEAM BROADCAST FROM OWNER]`,
    `The team owner addressed @team:`,
    broadcastText,
    ``,
    `Reply once in the shared room. Be conversational and useful.`,
    `Do not start execution work unless the owner explicitly asked for work to begin.`,
  ].join('\n');
}

async function deliverTeamBroadcastToMembers(
  teamId: string,
  team: any,
  broadcastText: string,
): Promise<{ deliveredCount: number; completedCount: number }> {
  const memberAgentIds: string[] = [];
  for (const memberAgentId of Array.isArray(team?.subagentIds) ? team.subagentIds : []) {
    if (!memberAgentId) continue;
    if (team.agentPauseStates?.[memberAgentId]?.paused === true) continue;
    queueAgentMessage(
      teamId,
      memberAgentId,
      `[From Team Owner to @team] ${broadcastText}`,
    );
    memberAgentIds.push(memberAgentId);
  }

  const prompt = buildTeamBroadcastMemberPrompt(broadcastText);
  const results = await Promise.allSettled(
    memberAgentIds.map((memberAgentId) =>
      runTeamMemberRoomTurn(teamId, memberAgentId, prompt, {
        autoWakeReason: 'The team owner addressed the whole team in the room.',
        autoWakeSource: 'manager_message',
      })
    ),
  );

  return {
    deliveredCount: memberAgentIds.length,
    completedCount: results.filter((result) => result.status === 'fulfilled').length,
  };
}

function buildPostTeamBroadcastManagerPrompt(broadcastText: string, deliveredCount: number, completedCount: number): string {
  return [
    `[TEAM BROADCAST MEMBERS RESPONDED]`,
    `The team owner addressed @team. The system delivered the message to ${deliveredCount} unpaused member(s), and ${completedCount} member room turn(s) have settled.`,
    `Review the current team room messages before replying. The members have already had their chance to answer, so do not call request_team_member_turn for this broadcast and do not re-ask members to weigh in.`,
    `Reply last as the manager with a concise synthesis or acknowledgement if useful.`,
    ``,
    `[OWNER MESSAGE]`,
    broadcastText,
  ].join('\n');
}

export function pauseManagedTeamInternal(teamId: string, reason?: string) { return _pauseManagedTeamInternal(teamId, reason); }
export function resumeManagedTeamInternal(teamId: string) { return _resumeManagedTeamInternal(teamId); }
export function buildTeamDispatchContext(team: any, ctx?: string) { return _buildTeamDispatchContext(team, ctx); }
export { runTeamAgentViaChat };

function _pauseManagedTeamInternal(teamId: string, reason?: string): { success: boolean; team?: any; error?: string } {
  const team = getManagedTeam(teamId);
  if (!team) return { success: false, error: 'Team not found' };
  if (team.manager?.paused === true) return { success: true, team };

  const cm = getConfig();
  const current = cm.getConfig() as any;
  const explicitAgents = Array.isArray(current.agents) ? [...current.agents] : [];
  const savedSchedules: Record<string, string | null> = {};
  let changed = false;

  for (const agentId of team.subagentIds || []) {
    const idx = explicitAgents.findIndex((a: any) => _sanitizeAgentId(a.id) === _sanitizeAgentId(agentId));
    if (idx < 0) continue;
    const agent = { ...explicitAgents[idx] };
    const cron = String(agent.cronSchedule || '').trim();
    savedSchedules[agent.id] = cron || null;
    if (cron) {
      agent.cronSchedule = undefined;
      explicitAgents[idx] = agent;
      changed = true;
    }
  }

  if (changed) {
    cm.updateConfig({ agents: explicitAgents } as any);
    reloadAgentSchedules();
  }

  team.manager = {
    ...team.manager,
    paused: true,
    pausedAt: Date.now(),
    pauseReason: reason ? String(reason).slice(0, 300) : undefined,
    savedSchedules,
  };
  saveManagedTeam(team);

  appendTeamChat(team.id, {
    from: 'manager',
    fromName: 'Manager',
    content: `Team paused${reason ? `: ${String(reason).slice(0, 220)}` : ''}`,
  });

  broadcastTeamEvent({
    type: 'team_paused',
    teamId: team.id,
    teamName: team.name,
    reason: team.manager.pauseReason,
  });

  return { success: true, team };
}

function _resumeManagedTeamInternal(teamId: string): { success: boolean; team?: any; error?: string } {
  const team = getManagedTeam(teamId);
  if (!team) return { success: false, error: 'Team not found' };
  if (team.manager?.paused !== true) return { success: true, team };

  const cm = getConfig();
  const current = cm.getConfig() as any;
  const explicitAgents = Array.isArray(current.agents) ? [...current.agents] : [];
  const saved = (team.manager?.savedSchedules || {}) as Record<string, string | null | undefined>;
  let changed = false;

  for (const agentId of team.subagentIds || []) {
    const idx = explicitAgents.findIndex((a: any) => _sanitizeAgentId(a.id) === _sanitizeAgentId(agentId));
    if (idx < 0) continue;
    const agent = { ...explicitAgents[idx] };
    if (Object.prototype.hasOwnProperty.call(saved, agent.id)) {
      const cron = String(saved[agent.id] || '').trim();
      agent.cronSchedule = cron || undefined;
      explicitAgents[idx] = agent;
      changed = true;
    }
  }

  if (changed) {
    cm.updateConfig({ agents: explicitAgents } as any);
    reloadAgentSchedules();
  }

  team.manager = {
    ...team.manager,
    paused: false,
    pausedAt: undefined,
    pauseReason: undefined,
    savedSchedules: {},
  };
  saveManagedTeam(team);

  appendTeamChat(team.id, {
    from: 'manager',
    fromName: 'Manager',
    content: 'Team resumed.',
  });

  broadcastTeamEvent({
    type: 'team_resumed',
    teamId: team.id,
    teamName: team.name,
  });

  return { success: true, team };
}

router.get('/api/teams', (_req, res) => {
  try {
    const teams = listManagedTeams();
    const teamMemberIds = getTeamMemberAgentIds();
    res.json({ success: true, teams, teamMemberIds: Array.from(teamMemberIds) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams', (req, res) => {
  try {
    const {
      name,
      description,
      emoji,
      subagentIds,
      teamContext,
      managerSystemPrompt,
      managerModel,
      reviewTrigger,
      kickoffInitialReview,
      kickoffAfterSeconds,
      allowedWorkPaths,
    } = req.body;
    if (!name || !subagentIds || !teamContext) {
      return res.status(400).json({ success: false, error: 'name, subagentIds, and teamContext are required' });
    }
	    const team = createManagedTeam({
      name: String(name).slice(0, 80),
      description: String(description || '').slice(0, 300),
      emoji: String(emoji || '🏠').slice(0, 4),
      subagentIds: Array.isArray(subagentIds) ? subagentIds.map(String) : [],
      teamContext: String(teamContext).slice(0, 1000),
      managerSystemPrompt: String(managerSystemPrompt || `You are the manager of the "${name}" team. Your goal is: ${teamContext}`).slice(0, 2000),
      managerModel: managerModel ? String(managerModel) : undefined,
      allowedWorkPaths: Array.isArray(allowedWorkPaths) ? allowedWorkPaths.map(String).filter(Boolean) : [],
	      reviewTrigger: reviewTrigger || 'after_each_run',
	    });
	    for (const agentId of team.subagentIds || []) {
	      claimAgentForTeamWorkspace(team.id, agentId);
	    }
    const telegramChatIdRaw = Number(req.body?.telegramChatId || req.body?.notificationChatId || 0);
    if (Number.isFinite(telegramChatIdRaw) && telegramChatIdRaw > 0) {
      addTeamNotificationTarget(team.id, {
        channel: 'telegram',
        peerId: String(Math.floor(telegramChatIdRaw)),
        source: 'api_create_team',
      });
    }
    const kickoff = kickoffInitialReview === true;
    const kickoffSecondsRaw = Number(kickoffAfterSeconds);
    const kickoffSeconds = Number.isFinite(kickoffSecondsRaw)
      ? Math.max(5, Math.min(300, Math.floor(kickoffSecondsRaw)))
      : 30;
    const kickoffAt = kickoff ? Date.now() + (kickoffSeconds * 1000) : null;

    if (kickoff) {
      setTimeout(() => {
        triggerManagerReview(team.id, broadcastTeamEvent).catch(err =>
          console.error('[Teams] Initial manager review failed:', err?.message || err)
        );
      }, kickoffSeconds * 1000);
    }

    broadcastTeamEvent({
      type: 'team_created',
      teamId: team.id,
      teamName: team.name,
      teamEmoji: team.emoji,
      subagentIds: team.subagentIds,
      kickoffAt,
    });

    res.json({ success: true, team, kickoffScheduled: kickoff, kickoffAt });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/teams/suggestions/dismiss
// Called by the UI when the user dismisses a team suggestion ("No thanks").
// Registers the candidate group in the in-process dismissal Set so the same
// suggestion won't fire again for the rest of this gateway session.
router.post('/api/teams/suggestions/dismiss', (req, res) => {
  try {
    const ids = req.body?.candidateAgentIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'candidateAgentIds array is required' });
    }
    dismissTeamSuggestion(ids.map(String));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/api/teams/:id', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    if (req.body?.sessionId) {
      _bindTeamNotificationTargetFromSession(team.id, String(req.body.sessionId), 'api_team_chat');
    }
    const allowed = ['name', 'description', 'emoji', 'teamContext', 'contextNotes', 'contextReferences', 'subagentIds', 'allowedWorkPaths'];
	    for (const key of allowed) {
	      if (req.body[key] !== undefined) (team as any)[key] = req.body[key];
	    }
    if (req.body?.allowedWorkPaths !== undefined) {
      team.allowedWorkPaths = Array.isArray(req.body.allowedWorkPaths)
        ? req.body.allowedWorkPaths.map(String).filter(Boolean)
        : [];
    }
	    if (Array.isArray(req.body?.subagentIds)) {
	      for (const agentId of team.subagentIds || []) {
	        claimAgentForTeamWorkspace(team.id, agentId);
	      }
	    }
    if (req.body.manager) {
      team.manager = { ...team.manager, ...req.body.manager };
    }
    saveManagedTeam(team);
    res.json({ success: true, team });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/teams/:id/context-references', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const references = listTeamContextReferences(team.id);
    res.json({ success: true, references });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams/:id/context-references', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    const actor = String(req.body?.actor || '').trim() || 'ui';
    if (!title || !content) {
      return res.status(400).json({ success: false, error: 'title and content are required' });
    }
    const created = addTeamContextReference(team.id, { title, content, actor });
    if (!created) return res.status(400).json({ success: false, error: 'Could not create context reference' });
    const refreshed = getManagedTeam(team.id);
    if (refreshed) broadcastTeamEvent({ type: 'team_updated', teamId: refreshed.id, teamName: refreshed.name });
    res.json({ success: true, reference: created });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/api/teams/:id/context-references/:refId', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const patch: any = {};
    if (req.body?.title !== undefined) patch.title = String(req.body.title);
    if (req.body?.content !== undefined) patch.content = String(req.body.content);
    patch.actor = String(req.body?.actor || '').trim() || 'ui';
    const updated = updateTeamContextReference(team.id, req.params.refId, patch);
    if (!updated) return res.status(404).json({ success: false, error: 'Context reference not found or invalid update' });
    const refreshed = getManagedTeam(team.id);
    if (refreshed) broadcastTeamEvent({ type: 'team_updated', teamId: refreshed.id, teamName: refreshed.name });
    res.json({ success: true, reference: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/teams/:id/context-references/:refId', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const ok = deleteTeamContextReference(team.id, req.params.refId);
    if (!ok) return res.status(404).json({ success: false, error: 'Context reference not found' });
    const refreshed = getManagedTeam(team.id);
    if (refreshed) broadcastTeamEvent({ type: 'team_updated', teamId: refreshed.id, teamName: refreshed.name });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/teams/:id', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });

    const subagentIds = [...(team.subagentIds || [])];

    // --- Delete all subagents: config entries, cron jobs, workspace dirs ---
    const cm = getConfig();
    const current = cm.getConfig() as any;
    let explicitAgents: any[] = Array.isArray(current.agents) ? [...current.agents] : [];
    const cfgWorkspace = getConfig().getWorkspacePath() || process.cwd();
    const removedAgentPaths: string[] = [];
    let deletedScheduledJobs = 0;

    for (const agentId of subagentIds) {
      const sanitized = _sanitizeAgentId(agentId);
      const agentEntry = explicitAgents.find((a: any) => _sanitizeAgentId(a.id) === sanitized);

      explicitAgents = explicitAgents.filter((a: any) => _sanitizeAgentId(a.id) !== sanitized);

      for (const job of _cronScheduler.getJobs()) {
        if (_sanitizeAgentId((job as any).subagent_id || '') !== sanitized) continue;
        if (_cronScheduler.deleteJob(job.id)) deletedScheduledJobs++;
      }

      const candidateDirs = new Set<string>([
        path.join(cfgWorkspace, '.prometheus', 'subagents', sanitized),
        path.join(process.cwd(), '.prometheus', 'subagents', sanitized),
      ]);
      if (agentEntry?.workspace) candidateDirs.add(String(agentEntry.workspace));

      const safeSuffixes = [
        `/.prometheus/subagents/${sanitized}`.toLowerCase(),
        `/subagents/${sanitized}`.toLowerCase(),
      ];

      for (const dir of candidateDirs) {
        try {
          const resolved = path.resolve(dir);
          const normalized = resolved.replace(/\\/g, '/').toLowerCase();
          const underWorkspace = normalized.startsWith(path.resolve(cfgWorkspace).replace(/\\/g, '/').toLowerCase() + '/');
          if (!underWorkspace || !safeSuffixes.some(suffix => normalized.endsWith(suffix))) continue;
          if (!fs.existsSync(resolved)) continue;
          fs.rmSync(resolved, { recursive: true, force: true });
          removedAgentPaths.push(resolved);
        } catch {}
      }
    }

    if (subagentIds.length > 0) {
      cm.updateConfig({ agents: _normalizeAgentsForSave(explicitAgents) } as any);
      reloadAgentSchedules();
    }

    // --- Delete team workspace directory ---
    const removedWorkspacePaths: string[] = [];
    try {
      const { getTeamWorkspacePath: getWsPath } = require('../teams/team-workspace') as typeof import('../teams/team-workspace');
      // getTeamWorkspacePath returns {root}/teams/{teamId}/workspace — parent is the team dir
      const teamDir = path.dirname(getWsPath(req.params.id));
      const teamsRoot = path.dirname(teamDir);
      const resolvedTeamDir = path.resolve(teamDir);
      const resolvedTeamsRoot = path.resolve(teamsRoot);
      // Safety: only delete if directly inside the teams root
      if (
        resolvedTeamDir.startsWith(resolvedTeamsRoot + path.sep) &&
        resolvedTeamDir !== resolvedTeamsRoot &&
        fs.existsSync(resolvedTeamDir)
      ) {
        fs.rmSync(resolvedTeamDir, { recursive: true, force: true });
        removedWorkspacePaths.push(resolvedTeamDir);
      }
    } catch {}

    // --- Delete the team record ---
    const ok = deleteManagedTeam(req.params.id);
    if (ok) {
      broadcastTeamEvent({ type: 'team_deleted', teamId: req.params.id });
    }

    res.json({
      success: ok,
      error: ok ? undefined : 'Team not found',
      deletedAgents: subagentIds,
      removedAgentPaths,
      removedWorkspacePaths,
      deletedScheduledJobs,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams/:id/pause', (req, res) => {
  try {
    const reason = req.body?.reason ? String(req.body.reason) : undefined;
    const out = _pauseManagedTeamInternal(req.params.id, reason);
    if (!out.success) return res.status(404).json(out);
    res.json(out);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams/:id/resume', (req, res) => {
  try {
    const out = _resumeManagedTeamInternal(req.params.id);
    if (!out.success) return res.status(404).json(out);
    res.json(out);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/teams/:id/runs', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    if (req.body?.sessionId) {
      _bindTeamNotificationTargetFromSession(team.id, String(req.body.sessionId), 'api_team_dispatch');
    }
    const limit = Math.min(200, Number(req.query.limit) || 50);
    // Collect run history from team-scoped storage (written by runTeamAgentViaChat)
    const allRuns: any[] = getTeamRunHistory(team.id, limit).map(r => ({ ...r }));
    // Include currently-running dispatched/cron team tasks so the Teams panel
    // can show live in-progress rows with expandable progress.
    const seenTaskIds = new Set(
      allRuns
        .map((r: any) => String(r?.taskId || '').trim())
        .filter(Boolean),
    );
    const activeTasks = listTaskSummaries({
      status: ['queued', 'running', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'waiting_subagent'] as TaskStatus[],
    });
    for (const task of activeTasks) {
      const sessionId = String(task?.sessionId || '');
      if (!sessionId.startsWith('team_dispatch_')) continue;
      const suffix = sessionId.slice('team_dispatch_'.length);
      const splitAt = suffix.lastIndexOf('_');
      if (splitAt <= 0) continue;
      const agentId = suffix.slice(0, splitAt).trim();
      if (!agentId || !team.subagentIds.includes(agentId)) continue;
      if (seenTaskIds.has(task.id)) continue;
      seenTaskIds.add(task.id);
      const progressItems = Array.isArray(task.runtimeProgress?.items) ? task.runtimeProgress.items : [];
      allRuns.push({
        id: `live_${task.id}`,
        agentId,
        agentName: getAgentById(agentId)?.name || agentId,
        trigger: task.scheduleId ? 'cron' : 'team_dispatch',
        taskId: task.id,
        taskStatus: task.status,
        inProgress: task.status === 'running' || task.status === 'queued' || task.status === 'waiting_subagent',
        success: false,
        startedAt: Number(task.startedAt || Date.now()),
        finishedAt: null,
        durationMs: Math.max(0, Date.now() - Number(task.startedAt || Date.now())),
        stepCount: progressItems.length,
        taskSummary: progressItems.find((it: any) => String(it?.status || '') === 'in_progress')?.text
          || progressItems[0]?.text
          || String(task.title || task.prompt || ''),
      });
    }
    allRuns.sort((a, b) => b.startedAt - a.startedAt);
    const roomState = getTeamRoomState(team.id);
    res.json({ success: true, runs: allRuns.slice(0, limit), roomState: buildTeamRoomStateView(roomState) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function buildTeamRoomStateView(roomState: any): any {
  const messages = Array.isArray(roomState?.roomMessages) ? roomState.roomMessages : [];
  const dispatches = Array.isArray(roomState?.dispatches) ? roomState.dispatches : [];
  const blockers = Array.isArray(roomState?.blockers) ? roomState.blockers : [];
  return {
    memberStates: roomState?.memberStates || {},
    activeDispatches: dispatches.filter((entry: any) => ['queued', 'running'].includes(String(entry?.status || '').toLowerCase())).slice(-30),
    recentDispatches: dispatches.slice(-30),
    managerAutoWakeEvents: messages.filter((entry: any) => entry?.metadata?.source === 'team_manager_auto_wake').slice(-20),
    memberWakeEvents: messages.filter((entry: any) => entry?.metadata?.source === 'team_member_auto_wake_scheduled').slice(-20),
    artifacts: Array.isArray(roomState?.sharedArtifacts) ? roomState.sharedArtifacts.slice(-30) : [],
    blockers: blockers.filter((entry: any) => !entry?.resolvedAt).slice(-30),
    plan: Array.isArray(roomState?.plan) ? roomState.plan.slice(-80) : [],
    recentEvents: messages.slice(-80),
  };
}

router.get('/api/teams/:id/room-state', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    res.json({ success: true, roomState: buildTeamRoomStateView(getTeamRoomState(team.id)) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/teams/:id/chat', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    if (req.body?.sessionId) {
      _bindTeamNotificationTargetFromSession(team.id, String(req.body.sessionId), 'api_team_trigger_review');
    }
    const limit = Math.min(500, Number(req.query.limit) || 100);
    res.json({ success: true, messages: (team.teamChat || []).slice(-limit) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams/:id/chat', async (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const content = String(req.body?.message || '').trim();
    if (!content) return res.status(400).json({ success: false, error: 'message is required' });
    const routeTarget = resolveTeamChatRouteTarget(team, content, req.body || {});
    if (routeTarget.type === 'member') {
      if (!routeTarget.targetId || !team.subagentIds.includes(routeTarget.targetId)) {
        return res.status(400).json({ success: false, error: 'Target subagent is not a member of this team' });
      }
      if (team.agentPauseStates?.[routeTarget.targetId]?.paused === true) {
        return res.status(409).json({ success: false, error: `${routeTarget.targetLabel || routeTarget.targetId} is paused.` });
      }
    }
    const directThread = routeTarget.type === 'manager'
      ? getOrCreateTeamDirectThread(req.params.id, 'manager', 'manager', routeTarget.targetLabel || 'manager')
      : routeTarget.type === 'member' && routeTarget.targetId
        ? getOrCreateTeamDirectThread(req.params.id, 'member', routeTarget.targetId, routeTarget.targetLabel || routeTarget.targetId)
        : null;

    // Post user message to chat
    const userMsg = appendTeamChat(req.params.id, {
      from: 'user',
      fromName: 'You',
      content,
      threadId: String(directThread?.id || '').trim() || undefined,
      metadata: {
        targetType: routeTarget.type,
        targetId: routeTarget.targetId,
        targetLabel: routeTarget.targetLabel,
      },
    });

    broadcastTeamEvent({ type: 'team_chat_message', teamId: req.params.id, teamName: team.name, chatMessage: userMsg, text: userMsg?.content || '' });
    res.json({ success: true, message: userMsg, target: routeTarget });

    if (routeTarget.type === 'team') {
      const broadcastText = routeTarget.routedMessage || content;
      void (async () => {
        const delivery = await deliverTeamBroadcastToMembers(req.params.id, team, broadcastText);
        const managerPrompt = buildPostTeamBroadcastManagerPrompt(
          broadcastText,
          delivery.deliveredCount,
          delivery.completedCount,
        );
        await handleManagerConversation(req.params.id, managerPrompt, broadcastTeamEvent);
      })().catch(err =>
        console.error('[Teams] Team broadcast flow failed:', err.message)
      );
      return;
    }

    if (routeTarget.type === 'manager') {
      handleManagerConversation(
        req.params.id,
        routeTarget.routedMessage || content,
        broadcastTeamEvent,
        false,
        {
          sessionIdOverride: String(directThread?.sessionId || '').trim() || undefined,
          threadId: String(directThread?.id || '').trim() || undefined,
          replyTargetType: 'user',
          replyTargetId: 'user',
          replyTargetLabel: 'You',
        },
      ).catch(err =>
        console.error('[Teams] Manager direct conversation failed:', err.message)
      );
      return;
    }

    if (routeTarget.type === 'member' && routeTarget.targetId) {
      if (directThread) {
        enqueueTeamDirectThreadUserMessage(
          req.params.id,
          'member',
          routeTarget.targetId,
          routeTarget.targetLabel || routeTarget.targetId,
          routeTarget.routedMessage || content,
          userMsg?.id,
        );
        scheduleTeamMemberDirectWake(req.params.id, routeTarget.targetId, String(directThread.id || '').trim(), {
          reason: 'The team owner sent you a direct message in the team chat.',
        });
      } else {
        queueAgentMessage(
          req.params.id,
          routeTarget.targetId,
          `[From Team Owner${routeTarget.targetLabel ? ` via @${routeTarget.targetLabel}` : ''}] ${routeTarget.routedMessage || content}`,
        );
        scheduleTeamMemberAutoWake(req.params.id, routeTarget.targetId, {
          reason: 'The team owner addressed you directly in the room.',
          source: 'manager_message',
        });
      }
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function _buildTeamDispatchContext(team: any, extraContext?: string): string {
  const parts: string[] = [];
  const extra = String(extraContext || '').trim();
  if (extra) parts.push(extra);
  const shared = team ? buildTeamContextRuntimeBlock(team) : '';
  if (shared) parts.push(shared);
  return parts.join('\n\n').trim();
}

function _buildTeamStartKickoffPrompt(team: any, requestedTask?: string): string {
  const purpose = String(
    team?.purpose
    || team?.mission
    || team?.teamContext
    || team?.description
    || '(no purpose set)',
  ).trim();
  const requested = String(requestedTask || '').trim();
  const runTask = (!requested || /^n\/?a$/i.test(requested)) ? 'N/A' : requested;

  return [
    `[TEAM SESSION STARTED by team owner]`,
    ``,
    `Read the team purpose and current task, then decide which subagents should run now and with what instructions.`,
    `Do NOT launch every subagent by default. Dispatch only the right agents for this run.`,
    ``,
    `Team purpose: ${purpose}`,
    `Current task: ${runTask}`,
    ``,
    `Review what has already been done (team chat + memory files), identify next steps,`,
    `and begin dispatching agents to make concrete progress.`,
    `Work autonomously - dispatch agents, review results, and continue until progress is made`,
    `or you need to ask the team owner a question.`,
  ].join('\n');
}

router.post('/api/teams/:id/dispatch', async (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    if (team.manager?.paused === true) {
      return res.status(409).json({ success: false, error: 'Team is paused. Resume the team before dispatching tasks.' });
    }
    const { agentId, task, context } = req.body;
    if (!agentId || !task) return res.status(400).json({ success: false, error: 'agentId and task are required' });
    if (!team.subagentIds.includes(agentId)) return res.status(403).json({ success: false, error: 'Agent is not a member of this team' });

    // Log it in team chat
    const dispatchChatMsg = appendTeamChat(req.params.id, {
      from: 'manager',
      fromName: 'Manager',
      content: `Dispatched one-off task to ${agentId}: ${String(task)}`,
    });
    broadcastTeamEvent({
      type: 'team_chat_message',
      teamId: req.params.id,
      teamName: team.name,
      chatMessage: dispatchChatMsg,
      text: dispatchChatMsg?.content || '',
    });

    broadcastTeamEvent({ type: 'team_dispatch', teamId: req.params.id, teamName: team.name, agentId, task: String(task) });

    // Run the agent via handleChat — same pipeline as scheduled tasks (full context, all tools)
    (async () => {
      try {
        const mergedContext = _buildTeamDispatchContext(team, context ? String(context) : undefined);
        const dispatchPrompt = buildTeamDispatchTask({
          agentId: String(agentId),
          task: String(task),
          teamId: req.params.id,
          context: mergedContext || undefined,
        });
        const startedAt = Date.now();
        const result = await runTeamAgentViaChat(agentId, dispatchPrompt.effectiveTask, req.params.id);
        const finishedAt = Date.now();
        recordAgentRun({
          agentId, agentName: result.agentName, trigger: 'team_dispatch', taskId: result.taskId,
          success: result.success, startedAt, finishedAt,
          durationMs: result.durationMs, stepCount: result.stepCount,
          error: result.error, resultPreview: result.success ? String(result.result || '') : undefined,
        });
        const resultChatMsg = appendTeamChat(req.params.id, {
          from: 'subagent',
          fromName: result.agentName || agentId,
          fromAgentId: agentId,
          content: result.success
            ? `Task complete: ${String(result.result || '')}`
            : `Task failed: ${result.error || 'unknown error'}`,
          metadata: {
            agentId,
            runSuccess: result.success,
            taskId: result.taskId,
            stepCount: result.stepCount,
            durationMs: result.durationMs,
            thinking: result.thinking,
            processEntries: result.processEntries,
          },
        });
        broadcastTeamEvent({
          type: 'team_chat_message',
          teamId: req.params.id,
          teamName: team.name,
          chatMessage: resultChatMsg,
          text: resultChatMsg?.content || '',
        });
        routeTeamEvent({
          type: result.success ? 'member_completed_task' : 'member_failed_task',
          teamId: req.params.id,
          agentId,
          agentName: result.agentName,
          task: String(task),
          resultSummary: String(result.result || '').trim(),
          error: result.error,
          warning: result.warning,
          taskId: result.taskId,
          stepCount: result.stepCount,
          durationMs: result.durationMs,
          source: 'api_team_dispatch_background',
        });
        broadcastTeamEvent({
          type: 'team_dispatch_complete', teamId: req.params.id,
          teamName: team.name,
          agentId,
          agentName: result.agentName,
          taskId: result.taskId,
          success: result.success,
          durationMs: result.durationMs,
          stepCount: result.stepCount,
          resultPreview: String(result.result || result.error || ''),
        });
        await verifySubagentResult(
          req.params.id,
          String(agentId),
          String(task),
          result.success ? String(result.result || '') : `Task failed: ${result.error || 'unknown error'}`,
          broadcastTeamEvent,
        );
      } catch (err: any) {
        const failedChatMsg = appendTeamChat(req.params.id, {
          from: 'subagent', fromName: agentId, fromAgentId: agentId,
          content: `Dispatch failed: ${err.message}`,
        });
        broadcastTeamEvent({
          type: 'team_chat_message',
          teamId: req.params.id,
          teamName: team.name,
          chatMessage: failedChatMsg,
          text: failedChatMsg?.content || '',
        });
      }
    })();

    res.json({ success: true, message: 'Task dispatched - results will appear in team chat' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams/:id/manager/trigger', async (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    if (team.manager?.paused === true) {
      return res.status(409).json({ success: false, error: 'Team is paused. Resume the team before triggering review.' });
    }
    const result = await triggerManagerReview(req.params.id, broadcastTeamEvent);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/teams/:id/start
// Kicks off the coordinator for a team session. Auto-resumes if paused.
// The coordinator reviews team state and begins dispatching agents toward the goal.
router.post('/api/teams/:id/start', async (req, res) => {
  try {
    const teamId = req.params.id;
    const team = getManagedTeam(teamId);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const requestedTaskRaw = String(req.body?.task || '').trim().slice(0, 2000);
    const requestedTask = (!requestedTaskRaw || /^n\/?a$/i.test(requestedTaskRaw)) ? 'N/A' : requestedTaskRaw;

    // Auto-resume if paused
    if (team.manager?.paused === true) {
      _resumeManagedTeamInternal(teamId);
    }

    res.json({ success: true });

    // Post session-start notice to team chat
    const chatMsg = appendTeamChat(teamId, {
      from: 'user',
      fromName: 'Team Owner',
      content: `Session started (task: ${requestedTask})`,
    });
    broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, text: chatMsg?.content || '' });

    // Build kickoff prompt for coordinator (purpose + optional task aware)
    const kickoffPrompt = _buildTeamStartKickoffPrompt(team, requestedTask);

    // Fire coordinator (async after response sent) - autoContinue=true for autonomous loop
    handleManagerConversation(teamId, kickoffPrompt, broadcastTeamEvent, true).catch((err: any) =>
      console.error('[Teams] Start coordinator failed:', err.message)
    );
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/teams/:id/run-all
// Legacy alias: preserved for older UI callers.
// Runs now go through manager/coordinator orchestration (purpose/task-aware), not fan-out.
router.post('/api/teams/:id/run-all', async (req, res) => {
  try {
    const teamId = req.params.id;
    const team = getManagedTeam(teamId);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const requestedTaskRaw = String(req.body?.task || '').trim().slice(0, 2000);
    const requestedTask = (!requestedTaskRaw || /^n\/?a$/i.test(requestedTaskRaw)) ? 'N/A' : requestedTaskRaw;

    // Auto-resume if paused (same behavior as /start)
    if (team.manager?.paused === true) {
      _resumeManagedTeamInternal(teamId);
    }

    res.json({ success: true, message: 'Manager-coordinated run started' });

    const chatMsg = appendTeamChat(teamId, {
      from: 'user',
      fromName: 'Team Owner',
      content: `Run requested (task: ${requestedTask})`,
    });
    broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, text: chatMsg?.content || '' });

    const kickoffPrompt = _buildTeamStartKickoffPrompt(team, requestedTask);
    handleManagerConversation(teamId, kickoffPrompt, broadcastTeamEvent, true).catch((err: any) =>
      console.error('[Teams] Legacy run-all -> coordinator start failed:', err.message)
    );
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/teams/:id/events  — live SSE stream for a single team
// GET /api/teams/events       — global stream for all teams (teamId='*')
router.get('/api/teams/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  const heartbeat = setInterval(() => { try { res.write(':ping\n\n'); } catch {} }, 15000);
  const send = (data: object) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };
  addTeamSseClient('*', send);
  req.on('close', () => { clearInterval(heartbeat); removeTeamSseClient('*', send); });
});

router.get('/api/teams/:id/events', (req, res) => {
  const team = getManagedTeam(req.params.id);
  if (!team) { res.status(404).json({ success: false, error: 'Team not found' }); return; }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  // Send initial state snapshot so the UI doesn't need a separate fetch
  res.write(`data: ${JSON.stringify({ type: 'team_snapshot', teamId: team.id, team })}\n\n`);
  const heartbeat = setInterval(() => { try { res.write(':ping\n\n'); } catch {} }, 15000);
  const send = (data: object) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };
  addTeamSseClient(req.params.id, send);
  req.on('close', () => { clearInterval(heartbeat); removeTeamSseClient(req.params.id, send); });
});

router.post('/api/teams/:id/changes/:changeId/apply', async (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const pending = team.pendingChanges.find(c => c.id === req.params.changeId);
    if (!pending) return res.status(404).json({ success: false, error: 'Change not found' });
    if (pending.type === 'schedule_one_off') {
      const targetAgentId = String(pending.targetSubagentId || '').trim();
      if (!targetAgentId) {
        return res.status(400).json({ success: false, error: 'schedule_one_off requires targetSubagentId' });
      }
      if (!team.subagentIds.includes(targetAgentId)) {
        return res.status(403).json({ success: false, error: 'Target agent is not a member of this team' });
      }
      const after = pending?.diff?.after;
      const runAtRaw = typeof after === 'object' && after
        ? String((after as any).runAt || (after as any).run_at || '').trim()
        : String(after || '').trim();
      const taskText = typeof after === 'object' && after
        ? String((after as any).task || (after as any).prompt || pending.description || '').trim()
        : String(pending.description || '').trim();
      if (!runAtRaw) {
        return res.status(400).json({ success: false, error: 'schedule_one_off requires diff.after.runAt (ISO datetime)' });
      }
      if (!taskText) {
        return res.status(400).json({ success: false, error: 'schedule_one_off requires diff.after.task' });
      }
      const parsed = new Date(runAtRaw);
      if (!Number.isFinite(parsed.getTime())) {
        return res.status(400).json({ success: false, error: `Invalid runAt value: "${runAtRaw}"` });
      }
      if (parsed.getTime() <= Date.now()) {
        return res.status(400).json({ success: false, error: 'runAt must be in the future' });
      }
      const job = _cronScheduler.createJob({
        name: `Team one-off: ${targetAgentId}`,
        prompt: taskText,
        type: 'one-shot',
        runAt: parsed.toISOString(),
        sessionTarget: 'isolated',
        subagent_id: targetAgentId,
      } as any);
      appendTeamChat(req.params.id, {
        from: 'manager',
        fromName: 'Manager',
        content: `One-off run scheduled for ${targetAgentId} at ${new Date(job.runAt || parsed.toISOString()).toLocaleString()}.`,
      });
    } else {
      const targetAgentId = String(pending.targetSubagentId || '').trim();
      if (pending.type !== 'modify_context') {
        if (!targetAgentId) {
          return res.status(400).json({ success: false, error: 'Change requires targetSubagentId' });
        }
        if (!team.subagentIds.includes(targetAgentId)) {
          return res.status(403).json({ success: false, error: 'Target agent is not a member of this team' });
        }
      }
      const { applyChangeToAgent } = require('../team-manager-runner');
      const applied = await applyChangeToAgent(pending, req.params.id);
      if (!applied) {
        return res.status(400).json({ success: false, error: 'Change could not be applied (invalid or unsafe)' });
      }
    }
    const change = applyTeamChange(req.params.id, req.params.changeId);
    if (change) {
      const targetAgentId = String(change.targetSubagentId || '').trim();
      const targetName = targetAgentId ? (getAgentById(targetAgentId)?.name || targetAgentId) : 'team';
      appendTeamChat(req.params.id, {
        from: 'user',
        fromName: 'Owner',
        content: `Approved and applied: ${change.description} (target: ${targetName})`,
      });
      appendManagerNote(req.params.id, {
        type: 'decision',
        content: `Owner approved and applied change ${change.id} (${change.type}) for ${targetName}: ${change.description}`,
      });
    }
    res.json({ success: true, change });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams/:id/changes/:changeId/reject', (req, res) => {
  try {
    const change = rejectTeamChange(req.params.id, req.params.changeId);
    if (!change) return res.status(404).json({ success: false, error: 'Change not found' });
    const targetAgentId = String(change.targetSubagentId || '').trim();
    const targetName = targetAgentId ? (getAgentById(targetAgentId)?.name || targetAgentId) : 'team';
    appendTeamChat(req.params.id, {
      from: 'user',
      fromName: 'Owner',
      content: `Rejected: ${change.description} (target: ${targetName})`,
    });
    appendManagerNote(req.params.id, {
      type: 'decision',
      content: `Owner rejected change ${change.id} (${change.type}) for ${targetName}: ${change.description}`,
    });
    res.json({ success: true, change });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Scheduler API ────────────────────────────────────────────────────────────────

// ─── Team Workspace API ─────────────────────────────────────────────────────
// GET  /api/teams/:id/workspace         - list workspace files
// GET  /api/teams/:id/workspace/:file   - read a single file
// POST /api/teams/:id/workspace/:file   - write/create a file
// DELETE /api/teams/:id/workspace/:file - delete a file

router.get('/api/teams/:id/workspace', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const {
      listWorkspaceFiles,
      listWorkspaceTree,
      ensureTeamWorkspace,
      getTeamWorkspacePath,
    } = require('../teams/team-workspace');
    ensureTeamWorkspace(req.params.id);
    const files = listWorkspaceFiles(req.params.id);
    const tree = listWorkspaceTree(req.params.id);
    res.json({
      success: true,
      files,
      tree,
      workspacePath: getTeamWorkspacePath(req.params.id),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Resolve a workspace-relative path safely, rejecting traversal outside the
// team workspace root. Returns { wsPath, target, filePath } on success or
// throws an Error.
function _resolveWorkspaceTarget(teamId: string, filenameParam: string, relpathQuery: unknown) {
  const { getTeamWorkspacePath } = require('../teams/team-workspace') as typeof import('../teams/team-workspace');
  const wsPath = getTeamWorkspacePath(teamId);
  const wsResolved = path.resolve(wsPath);
  const relpath = String(relpathQuery || '').trim();
  const target = relpath || path.basename(filenameParam);
  if (!target) throw new Error('Empty path');
  const filePath = path.resolve(wsPath, target);
  if (filePath !== wsResolved && !filePath.startsWith(wsResolved + path.sep)) {
    throw new Error('Path escapes workspace');
  }
  return { wsPath, target: target.replace(/\\/g, '/'), filePath };
}

router.get('/api/teams/:id/workspace/:filename', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const { recordFileRead } = require('../teams/team-workspace') as typeof import('../teams/team-workspace');
    const { target, filePath } = _resolveWorkspaceTarget(req.params.id, req.params.filename, req.query.relpath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found' });
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return res.status(400).json({ success: false, error: 'Target is a directory' });
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'File too large to serve via API (>2MB)' });
    }
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const agentId = String(req.query.agentId || '').trim();
    if (agentId) recordFileRead(req.params.id, target, agentId);
    res.json({ success: true, filename: target, content: fileContent, size: stat.size, modifiedAt: stat.mtimeMs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams/:id/workspace/:filename', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const fileContent = req.body?.content;
    if (fileContent === undefined || fileContent === null) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    const { recordFileWrite, ensureTeamWorkspace } = require('../teams/team-workspace') as typeof import('../teams/team-workspace');
    ensureTeamWorkspace(req.params.id);
    const { target, filePath } = _resolveWorkspaceTarget(req.params.id, req.params.filename, req.body?.relpath || req.query.relpath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(fileContent), 'utf-8');
    const agentId = String(req.body?.agentId || req.query.agentId || '').trim() || undefined;
    if (agentId) recordFileWrite(req.params.id, target, agentId);
    broadcastTeamEvent({
      type: 'team_workspace_updated',
      teamId: req.params.id,
      teamName: team.name,
      filename: target,
      agentId,
    });
    res.json({ success: true, filename: target, path: filePath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/teams/:id/workspace/:filename', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const { target, filePath } = _resolveWorkspaceTarget(req.params.id, req.params.filename, req.query.relpath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found' });
    fs.unlinkSync(filePath);
    const safe = target;
    const deleted = true;
    if (!deleted) return res.status(404).json({ success: false, error: 'File not found' });
    broadcastTeamEvent({
      type: 'team_workspace_updated',
      teamId: req.params.id,
      teamName: team.name,
      filename: safe,
      deleted: true,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/teams/:id/workspace/:filename/record-read', (req, res) => {
  try {
    const agentId = String(req.body?.agentId || '').trim();
    if (!agentId) return res.status(400).json({ success: false, error: 'agentId is required' });
    const { recordFileRead } = require('../teams/team-workspace');
    const safe = path.basename(req.params.filename);
    recordFileRead(req.params.id, safe, agentId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Team Workspace API (duplicate block — kept in sync) ────────────────────
router.get('/api/schedules', (_req, res) => {
  const jobs = _cronScheduler.getJobs();
  res.json({
    success: true,
    schedules: jobs.map((job: any) => {
      const isEnabled = job.enabled !== false;
      const isPaused  = job.status === 'paused';
      return {
        id: job.id,
        name: job.name,
        prompt: job.prompt,
        cron: job.schedule,
        run_at: job.runAt,
        timezone: job.tz,
        enabled: isEnabled,
        status: !isEnabled ? 'disabled' : isPaused ? 'paused' : (job.status || 'scheduled'),
        next_run: job.nextRun,
        last_run: job.lastRun,
        last_result: (job.lastResult || '').slice(0, 200),
        last_duration: job.lastDuration,
        delivery_channel: job.delivery || 'web',
        subagent_id: job.subagent_id || '',
      };
    }),
  });
});

router.post('/api/schedules', (req: any, res: any) => {
  const { name, pattern, prompt, timezone, delivery_channel, confirm, subagent_id, reference_links } = req.body;
  
  // Require confirmation for create
  if (confirm !== true) {
    return res.json({
      success: false,
      needs_confirmation: true,
      error: 'This action requires explicit confirmation. Set confirm: true to proceed.',
    });
  }
  
  if (!name || !pattern || !prompt) {
    return res.json({ success: false, error: 'name, pattern, and prompt are required' });
  }
  
  try {
    // Piece 6: append reference links block to prompt if provided
    const refLinks: string[] = Array.isArray(reference_links)
      ? reference_links.map((u: any) => String(u).trim()).filter(Boolean)
      : [];
    const promptWithRefs = refLinks.length > 0
      ? `${String(prompt).slice(0, 2000)}\n\n[REFERENCE LINKS]\n${refLinks.map(u => `- ${u}`).join('\n')}`
      : String(prompt).slice(0, 2000);

    const scheduleName = String(name).slice(0, 100);
    const promptText = promptWithRefs;
    const selectedSubagentId = String(subagent_id || '').trim();

    const job = _cronScheduler.createJob({
      name: scheduleName,
      prompt: promptText,
      schedule: /^\d/.test(pattern) ? pattern : null,
      runAt: !/^\d/.test(pattern) ? pattern : null,
      tz: timezone || 'UTC',
      delivery: 'web',
      ...(selectedSubagentId ? { subagent_id: selectedSubagentId } : {}),
    } as any);

    const ownerAgent = selectedSubagentId
      ? { agentId: selectedSubagentId, created: false }
      : ensureScheduleOwnerAgent({
          scheduleId: job.id,
          scheduleName,
          prompt: promptText,
        });
    if (selectedSubagentId) {
      ensureScheduleRuntimeForAgent(selectedSubagentId, {
        scheduleId: job.id,
        scheduleName,
        prompt: promptText,
      });
    }
    if (!selectedSubagentId) {
      _cronScheduler.updateJob(job.id, { subagent_id: ownerAgent.agentId } as any);
      job.subagent_id = ownerAgent.agentId;
    }
    
    res.json({
      success: true,
      job: {
        id: job.id,
        name: job.name,
        status: 'active',
        next_run: job.nextRun,
        subagent_id: job.subagent_id || '',
        schedule_owner_created: ownerAgent.created,
      },
    });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

router.put('/api/schedules/:id', (req: any, res: any) => {
  const { name, pattern, prompt, timezone, delivery_channel, confirm, subagent_id } = req.body;
  
  if (confirm !== true) {
    return res.json({
      success: false,
      needs_confirmation: true,
      error: 'This action requires explicit confirmation. Set confirm: true to proceed.',
    });
  }
  
	  try {
      const existing = _cronScheduler.getJobStatus(req.params.id)?.job;
      const incomingSubagentId = Object.prototype.hasOwnProperty.call(req.body || {}, 'subagent_id')
        ? String(subagent_id || '').trim()
        : String(existing?.subagent_id || '').trim();
      const effectivePrompt = prompt ? String(prompt).slice(0, 2000) : String(existing?.prompt || '');
      const effectiveName = name ? String(name).slice(0, 100) : String(existing?.name || 'Scheduled Job');
      const ownerAgent = incomingSubagentId
        ? { agentId: incomingSubagentId, created: false }
        : ensureScheduleOwnerAgent({
            scheduleId: req.params.id,
            scheduleName: effectiveName,
            prompt: effectivePrompt,
          });
      if (incomingSubagentId) {
        ensureScheduleRuntimeForAgent(incomingSubagentId, {
          scheduleId: req.params.id,
          scheduleName: effectiveName,
          prompt: effectivePrompt,
        });
      }

	    const updates: any = {
	      name: name ? String(name).slice(0, 100) : undefined,
	      prompt: prompt ? String(prompt).slice(0, 2000) : undefined,
	      schedule: pattern && /^\d/.test(pattern) ? pattern : undefined,
	      runAt: pattern && !/^\d/.test(pattern) ? pattern : undefined,
	      tz: timezone || undefined,
        subagent_id: ownerAgent.agentId,
	    };
	    const job = _cronScheduler.updateJob(req.params.id, updates);
    
    res.json({ success: true, job });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

router.delete('/api/schedules/:id', (req: any, res: any) => {
  const { confirm } = req.body;
  
  if (confirm !== true) {
    return res.json({
      success: false,
      needs_confirmation: true,
      error: 'This action requires explicit confirmation. Set confirm: true to proceed.',
    });
  }
  
  try {
    _cronScheduler.deleteJob(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

router.patch('/api/schedules/:id', (req: any, res: any) => {
  const { status, enabled } = req.body;
  try {
    const updates: Record<string, any> = {};
    if (status   !== undefined) updates.status  = status;
    if (enabled  !== undefined) {
      updates.enabled = !!enabled;
      // When re-enabling, reset status to scheduled so it fires again
      if (enabled && status === undefined) updates.status = 'scheduled';
    }
    const job = _cronScheduler.updateJob(req.params.id, updates);
    res.json({ success: true, job });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/api/schedules/:id/run', (req: any, res: any) => {
  try {
    const status = _cronScheduler.getJobStatus(req.params.id);
    const job = status?.job;
    if (!job) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }
    if (job.type === 'heartbeat') {
      return res.status(400).json({ success: false, error: 'Legacy heartbeat schedules cannot be run manually.' });
    }
    if (job.status === 'running') {
      return res.status(409).json({ success: false, error: 'Schedule is already running.' });
    }

    const runPromise = _cronScheduler.runJobNow(req.params.id);
    runPromise.catch((err: any) => {
      console.error(`[Schedules] Run-now failed for ${req.params.id}:`, err?.message || err);
    });
    res.json({ success: true, message: 'Schedule triggered', jobId: job.id, jobName: job.name });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Brain API ─────────────────────────────────────────────────────────────────

router.get('/api/brain/status', (_req: any, res: any) => {
  const runner = getBrainRunnerInstance();
  if (!runner) return res.json({ success: false, error: 'Brain runner not initialized' });
  const status = runner.getBrainStatus();
  res.json({
    success: true,
    ...status,
    thoughtModel: status.thoughtModel || '',
    dreamModel: status.dreamModel || '',
  });
});

router.patch('/api/brain/config', (req: any, res: any) => {
  const runner = getBrainRunnerInstance();
  if (!runner) return res.json({ success: false, error: 'Brain runner not initialized' });
  try {
    const { thoughtEnabled, dreamEnabled, thoughtModel, dreamModel } = req.body;
    runner.setConfig({ thoughtEnabled, dreamEnabled, thoughtModel, dreamModel });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Invalid brain config' });
  }
});

router.post('/api/teams/:id/chat/stream', async (req, res) => {
  const team = getManagedTeam(req.params.id);
  if (!team) return res.status(404).json({ success: false, error: 'Team not found' });

  const content = String(req.body?.message || '').trim();
  if (!content) return res.status(400).json({ success: false, error: 'message is required' });
  const routeTarget = resolveTeamChatRouteTarget(team, content, req.body || {});
  if (routeTarget.type === 'member') {
    if (!routeTarget.targetId || !team.subagentIds.includes(routeTarget.targetId)) {
      return res.status(400).json({ success: false, error: 'Target subagent is not a member of this team' });
    }
    if (team.agentPauseStates?.[routeTarget.targetId]?.paused === true) {
      return res.status(409).json({ success: false, error: `${routeTarget.targetLabel || routeTarget.targetId} is paused.` });
    }
  }
  const directThread = routeTarget.type === 'manager'
    ? getOrCreateTeamDirectThread(req.params.id, 'manager', 'manager', routeTarget.targetLabel || 'manager')
    : routeTarget.type === 'member' && routeTarget.targetId
      ? getOrCreateTeamDirectThread(req.params.id, 'member', routeTarget.targetId, routeTarget.targetLabel || routeTarget.targetId)
      : null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const sendSSE = createSSESender(res);
  sendSSE('progress_state', { source: 'none', reason: 'request_start', activeIndex: -1, total: 0, items: [] });
  const heartbeat = setInterval(() => sendSSE('heartbeat', { state: 'processing' }), 5000);
  const abortSignal = { aborted: false };
  const closeStream = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      try { res.end(); } catch {}
    }
  };

  req.on('aborted', () => {
    abortSignal.aborted = true;
    clearInterval(heartbeat);
  });
  res.on('close', () => {
    if (!res.writableEnded) abortSignal.aborted = true;
    clearInterval(heartbeat);
  });

  try {
    const userMsg = appendTeamChat(req.params.id, {
      from: 'user',
      fromName: 'You',
      content,
      threadId: String(directThread?.id || '').trim() || undefined,
      metadata: {
        targetType: routeTarget.type,
        targetId: routeTarget.targetId,
        targetLabel: routeTarget.targetLabel,
      },
    });
    broadcastTeamEvent({
      type: 'team_chat_message',
      teamId: req.params.id,
      teamName: team.name,
      chatMessage: userMsg,
      text: userMsg?.content || '',
    });

    if (routeTarget.type === 'member' && routeTarget.targetId) {
      if (directThread) {
        enqueueTeamDirectThreadUserMessage(
          req.params.id,
          'member',
          routeTarget.targetId,
          routeTarget.targetLabel || routeTarget.targetId,
          routeTarget.routedMessage || content,
          userMsg?.id,
        );
        scheduleTeamMemberDirectWake(req.params.id, routeTarget.targetId, String(directThread.id || '').trim(), {
          reason: 'The team owner sent you a direct message in the team chat.',
        });
      } else {
        queueAgentMessage(
          req.params.id,
          routeTarget.targetId,
          `[From Team Owner${routeTarget.targetLabel ? ` via @${routeTarget.targetLabel}` : ''}] ${routeTarget.routedMessage || content}`,
        );
        scheduleTeamMemberAutoWake(req.params.id, routeTarget.targetId, {
          reason: 'The team owner addressed you directly in the room.',
          source: 'manager_message',
        });
      }
      sendSSE('final', { text: `Message queued for ${routeTarget.targetLabel || routeTarget.targetId}.` });
      sendSSE('done', {
        reply: `Message queued for ${routeTarget.targetLabel || routeTarget.targetId}.`,
        reason: 'member_message_queued',
        turns: 0,
      });
      return;
    }

    let teamBroadcastDelivery: { deliveredCount: number; completedCount: number } | null = null;
    if (routeTarget.type === 'team') {
      const broadcastText = routeTarget.routedMessage || content;
      sendSSE('info', { message: 'Broadcasting to team members before manager reply...' });
      teamBroadcastDelivery = await deliverTeamBroadcastToMembers(req.params.id, team, broadcastText);
    }

    const managerInput = routeTarget.type === 'team'
      ? buildPostTeamBroadcastManagerPrompt(
          routeTarget.routedMessage || content,
          teamBroadcastDelivery?.deliveredCount || 0,
          teamBroadcastDelivery?.completedCount || 0,
        )
      : routeTarget.routedMessage || content;

    const result = await handleManagerConversationDetailed(
      req.params.id,
      managerInput,
      broadcastTeamEvent,
      false,
      {
        sendSSE,
        abortSignal,
        sessionIdOverride: String(directThread?.sessionId || '').trim() || undefined,
        threadId: String(directThread?.id || '').trim() || undefined,
        replyTargetType: routeTarget.type === 'manager' ? 'user' : undefined,
        replyTargetId: routeTarget.type === 'manager' ? 'user' : undefined,
        replyTargetLabel: routeTarget.type === 'manager' ? 'You' : undefined,
      },
    );

    if (!abortSignal.aborted) {
      sendSSE('final', { text: result?.managerMessage || '' });
      sendSSE('done', {
        reply: result?.managerMessage || '',
        reason: result?.reason || 'single_turn',
        turns: result?.turns || 0,
      });
    }
  } catch (err: any) {
    if (!abortSignal.aborted) {
      sendSSE('error', { message: err.message || 'Unknown error' });
    }
  } finally {
    closeStream();
  }
});

router.post('/api/brain/run', async (req: any, res: any) => {
  const runner = getBrainRunnerInstance();
  if (!runner) return res.json({ success: false, error: 'Brain runner not initialized' });
  const type = req.body?.type === 'dream' ? 'dream' : 'thought';
  try {
    await runner.runNow(type);
    res.json({ success: true, message: `Brain ${type} completed` });
  } catch (err: any) {
    console.error(`[BrainRunner] Manual ${type} run error:`, err?.message);
    res.json({ success: false, error: err?.message || `Brain ${type} failed` });
  }
});

// ─── Schedule pattern parser ────────────────────────────────────────────────────

// POST /api/teams/:id/context-files — upload a file to the team workspace
// Saves the file and adds a context reference entry so agents know it exists.
// Body: { filename, content (text or base64), encoding?: 'base64'|'text', title? }
router.post('/api/teams/:id/context-files', (req, res) => {
  try {
    const team = getManagedTeam(req.params.id);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const rawFilename = String(req.body?.filename || '').trim();
    if (!rawFilename) return res.status(400).json({ success: false, error: 'filename is required' });
    const safeFilename = path.basename(rawFilename).replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 120);
    const content = String(req.body?.content || '');
    const encoding = String(req.body?.encoding || 'text');
    const title = String(req.body?.title || safeFilename).trim().slice(0, 120);

    const { getTeamWorkspacePath, ensureTeamWorkspace } = require('../teams/team-workspace') as typeof import('../teams/team-workspace');
    ensureTeamWorkspace(req.params.id);
    const wsPath = getTeamWorkspacePath(req.params.id);
    const filePath = path.join(wsPath, safeFilename);

    if (encoding === 'base64') {
      fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
    } else {
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    // Add a context reference so agents are notified
    const refContent = `File uploaded for context: ${safeFilename}\nThis file is in the team workspace. Read it before performing tasks that may relate to its content.`;
    const created = addTeamContextReference(req.params.id, { title, content: refContent, actor: 'upload' });

    broadcastTeamEvent({ type: 'team_workspace_updated', teamId: req.params.id, teamName: team.name, filename: safeFilename });
    res.json({ success: true, ref: created, filePath: safeFilename });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/schedules/parse', (req: any, res: any) => {
  const { text, timezone } = req.body;
  
  if (!text) {
    return res.json({ success: false, error: 'text is required' });
  }
  
  try {
    let cron = '';
    let preview = '';
    const t = text.toLowerCase().trim();
    
    // Helper: extract time from text and handle AM/PM
	    function extractTime(text: string): { hour: number; minute: number } | null {
      // Match: "3:13pm", "15:13", "3:13", "11am", etc.
      const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
      if (!timeMatch) return null;
      
      let hour = parseInt(timeMatch[1], 10);
      const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const period = timeMatch[3]?.toLowerCase();
      
      // Convert 12-hour to 24-hour format if AM/PM specified
      if (period === 'pm' && hour !== 12) {
        hour += 12;
      } else if (period === 'am' && hour === 12) {
        hour = 0;
      }
      
      // Validate ranges
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      
	      return { hour, minute };
	    }

	    function extractDays(text: string): { cron: string; label: string } | null {
	      if (/\bweekdays?\b|\bmon\s*(?:-|to)\s*fri\b/.test(text)) {
	        return { cron: '1-5', label: 'weekdays' };
	      }
	      if (/\bweekends?\b/.test(text)) {
	        return { cron: '0,6', label: 'weekends' };
	      }
	      const days = [
	        ['sunday', '0', 'Sunday'],
	        ['monday', '1', 'Monday'],
	        ['tuesday', '2', 'Tuesday'],
	        ['wednesday', '3', 'Wednesday'],
	        ['thursday', '4', 'Thursday'],
	        ['friday', '5', 'Friday'],
	        ['saturday', '6', 'Saturday'],
	      ];
	      const hits = days.filter(([name]) => new RegExp(`\\b${name}\\b`).test(text));
	      if (!hits.length) return null;
	      return {
	        cron: hits.map(([, n]) => n).join(','),
	        label: hits.map(([, , label]) => label).join(', '),
	      };
	    }
	    
	    const dayInfo = extractDays(t);
	    if (dayInfo) {
	      const timeInfo = extractTime(t) || { hour: 9, minute: 0 };
	      cron = `${timeInfo.minute} ${timeInfo.hour} * * ${dayInfo.cron}`;
	      preview = `${dayInfo.label.charAt(0).toUpperCase()}${dayInfo.label.slice(1)} at ${String(timeInfo.hour).padStart(2, '0')}:${String(timeInfo.minute).padStart(2, '0')}`;
	    } else if (t.includes('daily') || t.includes('every day')) {
	      const timeInfo = extractTime(t);
      if (timeInfo) {
        const hourStr = String(timeInfo.hour).padStart(2, '0');
        const minStr = String(timeInfo.minute).padStart(2, '0');
        cron = `${timeInfo.minute} ${timeInfo.hour} * * *`;
        preview = `Daily at ${hourStr}:${minStr}`;
      } else {
        cron = '0 9 * * *';
        preview = 'Daily at 09:00';
      }
	    } else if (t.includes('weekly')) {
	      const timeInfo = extractTime(t);
      if (timeInfo) {
        cron = `${timeInfo.minute} ${timeInfo.hour} * * 1`;
        preview = `Weekly on Monday at ${String(timeInfo.hour).padStart(2, '0')}:${String(timeInfo.minute).padStart(2, '0')}`;
      } else {
        cron = '0 9 * * 1';
        preview = 'Weekly on Monday at 09:00';
      }
	    } else if (/^\d{1,2} \d{1,2} \d|\d \d \*/.test(t)) {
      cron = t;
      preview = 'Custom cron pattern';
    } else {
      return res.json({
        success: false,
        error: 'Could not parse pattern. Try: "daily at 3:13pm", "daily at 15:13", "weekly", or cron like "0 9 * * *"',
        confidence: 0,
      });
    }
    
    res.json({
      success: true,
      kind: 'cron',
      cron,
      human_text: preview,
      preview,
      timezone: timezone || 'UTC',
      confidence: 0.8,
    });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});
