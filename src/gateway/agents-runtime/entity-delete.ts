import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { normalizeAgentsForSave, sanitizeAgentId } from '../agents/agent-normalize';
import {
  deleteManagedTeam,
  getManagedTeam,
  listManagedTeams,
  saveManagedTeam,
} from '../teams/managed-teams';
import { getTeamWorkspacePath } from '../teams/team-workspace';
import { getHeartbeatRunnerInstance } from '../scheduling/heartbeat-runner';

export interface DeleteAgentResult {
  success: boolean;
  agentId: string;
  removedPaths: string[];
  deletedScheduledJobs: number;
  affectedTeams: Array<{ id: string; name: string; removedFromMembers: boolean; removedTeam: boolean; deletedManagerAgentId?: string }>;
  error?: string;
}

export interface DeleteTeamResult {
  success: boolean;
  teamId: string;
  teamName?: string;
  deletedAgents: string[];
  /** The team's own manager agent, removed with the team. Absent when there was no manager record to remove. */
  deletedManagerAgentId?: string;
  removedAgentPaths: string[];
  removedWorkspacePaths: string[];
  deletedScheduledJobs: number;
  error?: string;
}

function safeRemoveDir(resolvedDir: string, allowedSuffixes: string[], rootHints: string[]): boolean {
  const resolved = path.resolve(resolvedDir);
  const normalized = resolved.replace(/\\/g, '/').toLowerCase();
  const allowed = allowedSuffixes.some((suffix) => normalized.endsWith(suffix.toLowerCase()));
  const underKnownRoot = rootHints.some((root) => {
    const normalizedRoot = path.resolve(root).replace(/\\/g, '/').toLowerCase();
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
  if (!allowed || !underKnownRoot || !fs.existsSync(resolved)) return false;
  fs.rmSync(resolved, { recursive: true, force: true });
  return true;
}

function deleteBoundSubagentJobs(cronScheduler: any, agentId: string): number {
  if (!cronScheduler?.getJobs || !cronScheduler?.deleteJob) return 0;
  let deleted = 0;
  for (const job of cronScheduler.getJobs()) {
    if (sanitizeAgentId((job as any).subagent_id || '') !== agentId) continue;
    if (cronScheduler.deleteJob(job.id)) deleted++;
  }
  return deleted;
}

function subagentCandidateDirs(agentId: string, agentEntry?: any): Set<string> {
  const cfgWorkspace = getConfig().getWorkspacePath() || process.cwd();
  const configDir = (getConfig() as any).getConfigDir?.() || path.join(cfgWorkspace, '.prometheus');
  const dirs = new Set<string>([
    path.join(cfgWorkspace, '.prometheus', 'subagents', agentId),
    path.join(configDir, 'subagents', agentId),
    path.join(process.cwd(), '.prometheus', 'subagents', agentId),
    path.join(configDir, 'agent-chats', `${agentId}.json`),
    path.join(cfgWorkspace, '.prometheus', 'agent-chats', `${agentId}.json`),
  ]);
  if (agentEntry?.workspace) dirs.add(String(agentEntry.workspace));
  return dirs;
}

function removeSubagentFiles(agentId: string, agentEntry?: any): string[] {
  const cfgWorkspace = getConfig().getWorkspacePath() || process.cwd();
  const configDir = (getConfig() as any).getConfigDir?.() || path.join(cfgWorkspace, '.prometheus');
  const rootHints = [cfgWorkspace, configDir, process.cwd()];
  const safeSuffixes = [
    `/.prometheus/subagents/${agentId}`,
    `/subagents/${agentId}`,
    `/agent-chats/${agentId}.json`,
  ];
  const removed: string[] = [];
  for (const dir of subagentCandidateDirs(agentId, agentEntry)) {
    try {
      const resolved = path.resolve(dir);
      if (safeRemoveDir(resolved, safeSuffixes, rootHints)) removed.push(resolved);
    } catch {}
  }
  return removed;
}

/**
 * Remove the manager agent that belongs to a team being deleted.
 *
 * The manager is team infrastructure (`<teamId>_manager`, identity under
 * teams/<teamId>/manager), not a member, so it was never in `subagentIds` and
 * team delete left its agent record behind: an agent nobody can route to, shown
 * in every agent list, whose identity directory the same delete had just removed.
 *
 * This deletes an agent record, so it only acts on a record that is provably
 * this team's manager. A team record that merely points `managerAgentId` at
 * some other agent (a member, a standalone agent, another team's manager) must
 * never cause that agent to be deleted.
 */
function deleteTeamManagerAgent(
  team: { id: string; managerAgentId?: string; subagentIds?: string[] },
  cronScheduler?: any,
): { agentId?: string; removedPaths: string[]; deletedScheduledJobs: number } {
  const none = { removedPaths: [] as string[], deletedScheduledJobs: 0 };
  const teamId = String(team.id || '').trim();
  const managerId = sanitizeAgentId(team.managerAgentId || `${teamId}_manager`);
  if (!teamId || !managerId || managerId === 'main') return none;
  if ((team.subagentIds || []).some((id) => sanitizeAgentId(id) === managerId)) return none;

  const agents = (getConfig().getConfig() as any).agents;
  const record = (Array.isArray(agents) ? agents : []).find((agent: any) => sanitizeAgentId(agent?.id) === managerId);
  if (!record) return none;

  // ensureManagedTeamManagerAgent() stamps both fields on every manager record.
  // A record without that link back to this team is left for a human to judge.
  if (record.isTeamManager !== true || String(record.teamId || '').trim() !== teamId) return none;

  // Belt and braces: never take an agent another live team still uses.
  const usedElsewhere = listManagedTeams().some((other) => other.id !== teamId && (
    sanitizeAgentId(other.managerAgentId || '') === managerId
    || (other.subagentIds || []).some((id) => sanitizeAgentId(id) === managerId)
  ));
  if (usedElsewhere) return none;

  const result = deleteAgentCompletely({ agentId: managerId, cronScheduler, updateTeamMembership: false });
  if (!result.success) return none;
  return { agentId: managerId, removedPaths: result.removedPaths, deletedScheduledJobs: result.deletedScheduledJobs };
}

function removeAgentFromTeams(
  agentId: string,
  broadcastTeamEvent?: (data: any) => void,
  cronScheduler?: any,
): { affectedTeams: DeleteAgentResult['affectedTeams']; removedPaths: string[]; deletedScheduledJobs: number } {
  const removedPaths: string[] = [];
  let deletedScheduledJobs = 0;
  const affectedTeams: DeleteAgentResult['affectedTeams'] = [];
  for (const team of listManagedTeams()) {
    let touched = false;
    const beforeCount = (team.subagentIds || []).length;
    team.subagentIds = (team.subagentIds || []).filter((id) => sanitizeAgentId(id) !== agentId);
    if (team.subagentIds.length !== beforeCount) touched = true;

    const pendingBefore = (team.pendingChanges || []).length;
    team.pendingChanges = (team.pendingChanges || []).filter((change) => sanitizeAgentId(change.targetSubagentId || '') !== agentId);
    if (team.pendingChanges.length !== pendingBefore) touched = true;

    const historyBefore = (team.changeHistory || []).length;
    team.changeHistory = (team.changeHistory || []).filter((change) => sanitizeAgentId(change.targetSubagentId || '') !== agentId);
    if (team.changeHistory.length !== historyBefore) touched = true;

    if (team.manager?.savedSchedules && Object.prototype.hasOwnProperty.call(team.manager.savedSchedules, agentId)) {
      const savedSchedules = { ...(team.manager.savedSchedules || {}) };
      delete savedSchedules[agentId];
      team.manager = { ...team.manager, savedSchedules };
      touched = true;
    }

    if (!touched) continue;
    if ((team.subagentIds || []).length === 0) {
      // Last member gone: the team is deleted, so its manager goes with it
      // (same rule as deleteTeamCompletely). The team workspace is left on disk here, as before.
      const manager = deleteTeamManagerAgent(team, cronScheduler);
      removedPaths.push(...manager.removedPaths);
      deletedScheduledJobs += manager.deletedScheduledJobs;
      deleteManagedTeam(team.id);
      affectedTeams.push({ id: team.id, name: team.name, removedFromMembers: true, removedTeam: true, ...(manager.agentId ? { deletedManagerAgentId: manager.agentId } : {}) });
      broadcastTeamEvent?.({ type: 'team_deleted', teamId: team.id, teamName: team.name });
    } else {
      saveManagedTeam(team);
      affectedTeams.push({ id: team.id, name: team.name, removedFromMembers: true, removedTeam: false });
      broadcastTeamEvent?.({ type: 'team_updated', teamId: team.id, teamName: team.name });
    }
  }
  return { affectedTeams, removedPaths, deletedScheduledJobs };
}

export function deleteAgentCompletely(input: {
  agentId: string;
  cronScheduler?: any;
  broadcastTeamEvent?: (data: any) => void;
  updateTeamMembership?: boolean;
}): DeleteAgentResult {
  const agentId = sanitizeAgentId(input.agentId);
  if (!agentId) return { success: false, agentId, removedPaths: [], deletedScheduledJobs: 0, affectedTeams: [], error: 'agent_id is required' };
  if (agentId === 'main') return { success: false, agentId, removedPaths: [], deletedScheduledJobs: 0, affectedTeams: [], error: 'Cannot delete the main agent.' };

  const cm = getConfig();
  const current = cm.getConfig() as any;
  const explicitAgents = Array.isArray(current.agents) ? current.agents : [];
  const target = explicitAgents.find((agent: any) => sanitizeAgentId(agent.id) === agentId);
  if (!target) {
    return { success: false, agentId, removedPaths: [], deletedScheduledJobs: 0, affectedTeams: [], error: `Agent "${agentId}" not found` };
  }

  const nextAgents = explicitAgents.filter((agent: any) => sanitizeAgentId(agent.id) !== agentId);
  cm.updateConfig({ agents: normalizeAgentsForSave(nextAgents) } as any);
  const membership = input.updateTeamMembership === false
    ? { affectedTeams: [] as DeleteAgentResult['affectedTeams'], removedPaths: [] as string[], deletedScheduledJobs: 0 }
    : removeAgentFromTeams(agentId, input.broadcastTeamEvent, input.cronScheduler);
  const affectedTeams = membership.affectedTeams;
  const deletedScheduledJobs = deleteBoundSubagentJobs(input.cronScheduler, agentId) + membership.deletedScheduledJobs;
  const removedPaths = [...removeSubagentFiles(agentId, target), ...membership.removedPaths];
  // Remove the live timer and persisted heartbeat override as part of deleting
  // the agent, rather than leaving a stale Settings > Heartbeat card behind.
  getHeartbeatRunnerInstance()?.unregisterAgent(agentId);

  return { success: true, agentId, removedPaths, deletedScheduledJobs, affectedTeams };
}

function removeTeamWorkspace(teamId: string): string[] {
  const removed: string[] = [];
  try {
    const workspacePath = getTeamWorkspacePath(teamId);
    const teamDir = path.dirname(workspacePath);
    const teamsRoot = path.dirname(teamDir);
    const resolvedTeamDir = path.resolve(teamDir);
    const resolvedTeamsRoot = path.resolve(teamsRoot);
    if (
      resolvedTeamDir.startsWith(resolvedTeamsRoot + path.sep) &&
      resolvedTeamDir !== resolvedTeamsRoot &&
      fs.existsSync(resolvedTeamDir)
    ) {
      fs.rmSync(resolvedTeamDir, { recursive: true, force: true });
      removed.push(resolvedTeamDir);
    }
  } catch {}
  return removed;
}

export function deleteTeamCompletely(input: {
  teamId: string;
  cronScheduler?: any;
  broadcastTeamEvent?: (data: any) => void;
  deleteAgents?: boolean;
}): DeleteTeamResult {
  const teamId = String(input.teamId || '').trim();
  if (!teamId) return { success: false, teamId, deletedAgents: [], removedAgentPaths: [], removedWorkspacePaths: [], deletedScheduledJobs: 0, error: 'team_id is required' };
  const team = getManagedTeam(teamId);
  if (!team) return { success: false, teamId, deletedAgents: [], removedAgentPaths: [], removedWorkspacePaths: [], deletedScheduledJobs: 0, error: 'Team not found' };

  const deleteAgents = input.deleteAgents !== false;
  const subagentIds = [...(team.subagentIds || [])].map((id) => sanitizeAgentId(id)).filter(Boolean);
  const deletedAgents: string[] = [];
  const removedAgentPaths: string[] = [];
  let deletedScheduledJobs = 0;

  if (deleteAgents) {
    for (const agentId of subagentIds) {
      const result = deleteAgentCompletely({
        agentId,
        cronScheduler: input.cronScheduler,
        broadcastTeamEvent: input.broadcastTeamEvent,
        updateTeamMembership: false,
      });
      if (result.success) deletedAgents.push(agentId);
      removedAgentPaths.push(...result.removedPaths);
      deletedScheduledJobs += result.deletedScheduledJobs;
    }
  }

  // The manager belongs to the team itself, so it goes even when member agents
  // are kept (delete_agents:false): its identity lives in the team directory
  // removed just below, and a manager without a team cannot run.
  const manager = deleteTeamManagerAgent(team, input.cronScheduler);
  removedAgentPaths.push(...manager.removedPaths);
  deletedScheduledJobs += manager.deletedScheduledJobs;

  const removedWorkspacePaths = removeTeamWorkspace(teamId);
  const ok = deleteManagedTeam(teamId);
  if (ok) input.broadcastTeamEvent?.({ type: 'team_deleted', teamId, teamName: team.name });

  return {
    success: ok,
    teamId,
    teamName: team.name,
    deletedAgents,
    ...(manager.agentId ? { deletedManagerAgentId: manager.agentId } : {}),
    removedAgentPaths,
    removedWorkspacePaths,
    deletedScheduledJobs,
    error: ok ? undefined : 'Team not found',
  };
}
