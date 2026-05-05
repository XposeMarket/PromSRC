/**
 * team-tools.ts — Team management tools for the main agent
 *
 * Exposes:
 *   - talk_to_manager(team_id, message) — send a message to a team manager and get a reply
 *   - get_team_logs(team_id?, agent_id?, limit?) — pull recent run logs for any team/agent
 *   - schedule_job(action, ...) — manage cron jobs / run agents now
 *   - manage_team_context_ref(action, ...) — CRUD for shared team context cards
 */

import fs from 'fs';
import path from 'path';
import type { ToolResult } from '../types.js';

// ─── Dependency injection (set from server-v2 at boot) ─────────────────────────

let _handleManagerConversation: ((teamId: string, userMessage: string, broadcastFn?: (data: object) => void) => Promise<void>) | null = null;
let _getManagedTeam: ((id: string) => any) | null = null;
let _listManagedTeams: (() => any[]) | null = null;
let _broadcastFn: ((data: object) => void) | null = null;
let _cronScheduler: any = null;
let _spawnAgent: ((params: { agentId: string; task: string; context?: string }) => Promise<any>) | null = null;
let _listTeamContextReferences: ((teamId: string) => any[]) | null = null;
let _addTeamContextReference: ((teamId: string, input: { title: string; content: string; actor?: string }) => any) | null = null;
let _updateTeamContextReference: ((teamId: string, refId: string, patch: { title?: string; content?: string; actor?: string }) => any) | null = null;
let _deleteTeamContextReference: ((teamId: string, refId: string) => boolean) | null = null;

export function injectTeamToolDeps(deps: {
  handleManagerConversation: typeof _handleManagerConversation;
  getManagedTeam: typeof _getManagedTeam;
  listManagedTeams: typeof _listManagedTeams;
  broadcast: typeof _broadcastFn;
  cronScheduler?: any;
  spawnAgent?: typeof _spawnAgent;
  listTeamContextReferences?: typeof _listTeamContextReferences;
  addTeamContextReference?: typeof _addTeamContextReference;
  updateTeamContextReference?: typeof _updateTeamContextReference;
  deleteTeamContextReference?: typeof _deleteTeamContextReference;
}): void {
  _handleManagerConversation = deps.handleManagerConversation;
  _getManagedTeam = deps.getManagedTeam;
  _listManagedTeams = deps.listManagedTeams;
  _broadcastFn = deps.broadcast;
  _cronScheduler = deps.cronScheduler ?? null;
  _spawnAgent = deps.spawnAgent ?? null;
  _listTeamContextReferences = deps.listTeamContextReferences ?? null;
  _addTeamContextReference = deps.addTeamContextReference ?? null;
  _updateTeamContextReference = deps.updateTeamContextReference ?? null;
  _deleteTeamContextReference = deps.deleteTeamContextReference ?? null;
}

// ─── talk_to_manager ──────────────────────────────────────────────────────────

export const talkToManagerTool = {
  name: 'talk_to_manager',
  description:
    'Send a message to a team manager agent and receive their reply. ' +
    'Use this to delegate tasks to a team, check team status, or instruct the manager ' +
    'to run a specific agent right now. Returns the manager\'s reply and any agent results.',
  schema: {
    team_id: 'ID of the team whose manager to talk to',
    message: 'Your message to the manager',
  },
  jsonSchema: {
    type: 'object',
    required: ['team_id', 'message'],
    properties: {
      team_id: { type: 'string', description: 'Team ID (e.g. "team_abc123_xyz")' },
      message: { type: 'string', description: 'Message to send to the manager' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const teamId = String(args?.team_id || '').trim();
    const message = String(args?.message || '').trim();

    if (!teamId) return { success: false, error: 'team_id is required' };
    if (!message) return { success: false, error: 'message is required' };
    if (!_handleManagerConversation || !_getManagedTeam) {
      return { success: false, error: 'Team tools not initialized — server-side injection missing.' };
    }

    const team = _getManagedTeam(teamId);
    if (!team) {
      const teams = _listManagedTeams?.() ?? [];
      const ids = teams.map((t: any) => `${t.id} (${t.name})`).join(', ');
      return { success: false, error: `Team "${teamId}" not found. Available teams: ${ids || 'none'}` };
    }

    // Capture index of last chat message before we post ours
    const chatBefore = (team.teamChat || []).length;

    // Run the conversation (this appends to teamChat internally)
    await _handleManagerConversation(teamId, message, _broadcastFn ?? undefined);

    // Read fresh team state to get the manager's reply
    const freshTeam = _getManagedTeam(teamId);
    const newMessages = (freshTeam?.teamChat || []).slice(chatBefore);

    const managerReplies = newMessages
      .filter((m: any) => m.from === 'manager')
      .map((m: any) => m.content)
      .join('\n\n');

    const agentResults = newMessages
      .filter((m: any) => m.from === 'subagent')
      .map((m: any) => `[${m.fromName}]: ${m.content}`)
      .join('\n\n');

    const fullReply = [
      managerReplies || '(Manager processed request — no chat message posted)',
      agentResults ? `\nAgent results:\n${agentResults}` : '',
    ].filter(Boolean).join('\n');

    return {
      success: true,
      stdout: fullReply,
      data: {
        teamId,
        teamName: team.name,
        newMessages: newMessages.length,
        managerReply: managerReplies,
      },
    };
  },
};

// ─── get_team_logs ────────────────────────────────────────────────────────────

export const getTeamLogsTool = {
  name: 'get_team_logs',
  description:
    'Retrieve recent run logs for a team or specific agent. ' +
    'Use this to diagnose failures, see what an agent produced on its last run, ' +
    'or check team health — without needing to open the web UI.',
  schema: {
    team_id: 'Optional: filter to agents in this team',
    agent_id: 'Optional: filter to this specific agent ID',
    limit: 'Max log entries to return (default 10, max 50)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      team_id: { type: 'string', description: 'Filter to agents in this team' },
      agent_id: { type: 'string', description: 'Filter to this specific agent' },
      limit: { type: 'number', description: 'Max entries (default 10)' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const teamId = String(args?.team_id || '').trim() || null;
    const agentId = String(args?.agent_id || '').trim() || null;
    const limit = Math.min(Math.max(1, Number(args?.limit) || 10), 50);

    try {
      let agentIds: string[] = [];

      if (agentId) {
        agentIds = [agentId];
      } else if (teamId && _getManagedTeam) {
        const team = _getManagedTeam(teamId);
        if (!team) return { success: false, error: `Team "${teamId}" not found` };
        agentIds = team.subagentIds || [];
      } else if (_listManagedTeams) {
        const teams = _listManagedTeams();
        for (const t of teams) agentIds.push(...(t.subagentIds || []));
      }

      const { getAgentRunHistory } = await import('../scheduler.js');
      const lines: string[] = [];
      const perAgent = agentIds.length > 0 ? Math.ceil(limit / agentIds.length) + 2 : limit;

      for (const id of agentIds.slice(0, 20)) {
        const runs = getAgentRunHistory(id, perAgent);
        if (!runs || runs.length === 0) {
          lines.push(`[${id}] — no run history`);
          continue;
        }
        for (const run of runs.slice(0, perAgent)) {
          const ts = new Date(run.startedAt).toLocaleString();
          const icon = run.success ? '✅' : '❌';
          const dur = `${(run.durationMs / 1000).toFixed(1)}s`;
          const preview = (run.resultPreview || run.error || '(no output)').slice(0, 300);
          lines.push(`${icon} [${id}] ${ts} (${run.trigger}, ${dur})\n   ${preview}`);
        }
      }

      // Also read cron job run history JSONL files
      const runsDir = path.join(
        process.env.PROMETHEUS_DATA_DIR ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus') : path.join(process.cwd(), '.prometheus'),
        'jobs', 'runs'
      );
      if (fs.existsSync(runsDir)) {
        const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.jsonl'));
        for (const file of files.slice(0, 15)) {
          const jobId = file.replace('.jsonl', '');
          if (agentId && !jobId.includes(agentId)) continue;
          if (teamId && agentIds.length > 0 && !agentIds.includes(jobId)) continue;
          try {
            const content = fs.readFileSync(path.join(runsDir, file), 'utf-8').trim();
            const entries = content.split('\n').filter(Boolean).slice(-3);
            for (const entry of entries) {
              try {
                const e = JSON.parse(entry);
                const icon = e.status === 'success' ? '✅' : e.status === 'error' ? '❌' : '⚪';
                lines.push(`${icon} [cron:${jobId}] ${e.t} (${(e.duration / 1000).toFixed(1)}s)\n   ${String(e.result_excerpt || '').slice(0, 200)}`);
              } catch {}
            }
          } catch {}
        }
      }

      if (lines.length === 0) {
        return { success: true, stdout: 'No run logs found for the specified filter.', data: { logs: [] } };
      }

      return {
        success: true,
        stdout: lines.slice(0, limit).join('\n\n'),
        data: { count: Math.min(lines.length, limit), truncated: lines.length > limit },
      };
    } catch (err: any) {
      return { success: false, error: `get_team_logs error: ${err.message}` };
    }
  },
};

// ─── schedule_job ─────────────────────────────────────────────────────────────

export const scheduleJobTool = {
  name: 'schedule_job',
  description:
    'Manage scheduled cron jobs and run agents immediately. ' +
    'IMPORTANT: For agents in the Agents panel (like "news_harvester_v1"), use action="run_now" ' +
    'with agent_id — NOT job_id. Cron jobs on the Tasks page have job IDs like "job_xxxxx". ' +
    'Actions: run_now, list, create, update, delete.',
  schema: {
    action: 'Action: run_now | list | create | update | delete',
    job_id: 'Cron job ID (for run_now with a Tasks-page job, or update/delete)',
    agent_id: 'Agent ID to dispatch NOW (for run_now — use this for agents in Agents panel)',
    task: 'Task prompt when dispatching an agent with run_now + agent_id',
    name: 'Job name (for create)',
    prompt: 'Job prompt (for create)',
    schedule: 'Cron expression e.g. "0 9 * * *" (for create/update)',
    enabled: 'true/false (for update)',
  },
  jsonSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['run_now', 'list', 'create', 'update', 'delete'],
      },
      job_id: { type: 'string' },
      agent_id: { type: 'string' },
      task: { type: 'string' },
      name: { type: 'string' },
      prompt: { type: 'string' },
      schedule: { type: 'string' },
      enabled: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const action = String(args?.action || '').trim().toLowerCase();
    if (!action) return { success: false, error: 'action is required' };

    // ── run_now ──────────────────────────────────────────────────────────────
    if (action === 'run_now') {
      const jobId = String(args?.job_id || '').trim() || null;
      const agentId = String(args?.agent_id || '').trim() || null;
      const task = String(args?.task || '').trim() || null;

      // Direct agent dispatch (agents in Agents panel)
      if (agentId) {
        if (!_spawnAgent) return { success: false, error: 'Agent spawner not initialized' };
        const effectiveTask = task || 'Execute your configured instructions and goals now.';
        try {
          const result = await _spawnAgent({ agentId, task: effectiveTask });
          return {
            success: result.success,
            stdout: result.success
              ? `[${result.agentName}] ${result.result}`
              : `[${result.agentName}] FAILED: ${result.error}`,
            data: result,
          };
        } catch (err: any) {
          return { success: false, error: `Agent dispatch failed: ${err.message}` };
        }
      }

      // Run a scheduled cron job by job_id
      if (jobId) {
        if (!_cronScheduler) return { success: false, error: 'Scheduler not initialized. Use agent_id instead.' };
        const jobs: any[] = _cronScheduler.getJobs?.() ?? [];
        const job = jobs.find((j: any) => j.id === jobId || j.name === jobId);
        if (!job) {
          // Smart fallback: maybe they passed an agent ID as job_id
          if (_spawnAgent) {
            const { getAgentById } = await import('../config/config.js');
            const agent = getAgentById(jobId);
            if (agent) {
              const result = await _spawnAgent({ agentId: jobId, task: task || 'Execute your configured instructions now.' });
              return {
                success: result.success,
                stdout: result.success
                  ? `[${result.agentName}] ${result.result}\n\n💡 Tip: Next time use agent_id="${jobId}" instead of job_id for agents.`
                  : `[${result.agentName}] FAILED: ${result.error}`,
                data: result,
              };
            }
          }
          const jobNames = jobs.map((j: any) => `${j.id} (${j.name})`).slice(0, 8).join(', ');
          return { success: false, error: `"${jobId}" not found as a job or agent. Available jobs: ${jobNames || 'none'}. Use agent_id for agents in the Agents panel.` };
        }
        await _cronScheduler.runJobNow(job.id);
        return { success: true, stdout: `Job "${job.name}" triggered. Check the Tasks page for progress.` };
      }

      return { success: false, error: 'Provide agent_id (for agents panel) or job_id (for scheduled jobs)' };
    }

    // ── list ─────────────────────────────────────────────────────────────────
    if (action === 'list') {
      if (!_cronScheduler) return { success: false, error: 'Scheduler not initialized' };
      const jobs: any[] = _cronScheduler.getJobs?.() ?? [];
      if (jobs.length === 0) return { success: true, stdout: 'No scheduled jobs.', data: { jobs: [] } };
      const lines = jobs.map((j: any) => {
        const status = j.enabled ? '✅' : '⏸';
        const next = j.nextRun ? `next: ${new Date(j.nextRun).toLocaleString()}` : 'no schedule';
        const last = j.lastRun ? `last: ${new Date(j.lastRun).toLocaleString()}` : 'never run';
        return `${status} ${j.name} (id: ${j.id})\n   ${j.schedule || 'one-shot'} | ${next} | ${last}`;
      });
      return { success: true, stdout: lines.join('\n\n'), data: { jobs } };
    }

    // ── create ───────────────────────────────────────────────────────────────
    if (action === 'create') {
      if (!_cronScheduler) return { success: false, error: 'Scheduler not initialized' };
      const name = String(args?.name || '').trim();
      const prompt = String(args?.prompt || '').trim();
      if (!name || !prompt) return { success: false, error: 'name and prompt are required for create' };
      const job = _cronScheduler.createJob({
        name,
        prompt,
        schedule: args?.schedule || '0 9 * * *',
        enabled: args?.enabled !== false,
        type: 'recurring',
      });
      return { success: true, stdout: `Created job "${job.name}" (${job.id}). Next run: ${job.nextRun}`, data: job };
    }

    // ── update ───────────────────────────────────────────────────────────────
    if (action === 'update') {
      if (!_cronScheduler) return { success: false, error: 'Scheduler not initialized' };
      const jobId = String(args?.job_id || '').trim();
      if (!jobId) return { success: false, error: 'job_id is required for update' };
      const updates: any = {};
      if (args?.schedule !== undefined) updates.schedule = args.schedule;
      if (args?.prompt !== undefined) updates.prompt = args.prompt;
      if (args?.enabled !== undefined) updates.enabled = Boolean(args.enabled);
      if (args?.name !== undefined) updates.name = args.name;
      const updated = _cronScheduler.updateJob(jobId, updates);
      if (!updated) return { success: false, error: `Job "${jobId}" not found` };
      return { success: true, stdout: `Updated job "${updated.name}" (${updated.id})`, data: updated };
    }

    // ── delete ───────────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (!_cronScheduler) return { success: false, error: 'Scheduler not initialized' };
      const jobId = String(args?.job_id || '').trim();
      if (!jobId) return { success: false, error: 'job_id is required for delete' };
      const deleted = _cronScheduler.deleteJob(jobId);
      return deleted
        ? { success: true, stdout: `Deleted job "${jobId}"` }
        : { success: false, error: `Job "${jobId}" not found` };
    }

    return { success: false, error: `Unknown action "${action}". Valid: run_now, list, create, update, delete` };
  },
};

// ─── manage_team_goal ────────────────────────────────────────────────────────

export const manageTeamGoalTool = {
  name: 'manage_team_goal',
  description:
    'Read or update the overall goal (teamContext) of a managed team. ' +
    'Use action=get to read the current goal, action=set to replace it entirely, ' +
    'action=append to add to it. ' +
    'A goal change is applied immediately — no approval required. ' +
    'The updated goal is injected into every future manager review and subagent run.',
  schema: {
    action: 'Action: get | set | append',
    team_id: 'Team ID (required)',
    goal: 'New goal text (required for set/append)',
    reason: 'Optional: why this goal change is being made (logged to team chat)',
  },
  jsonSchema: {
    type: 'object',
    required: ['action', 'team_id'],
    properties: {
      action: { type: 'string', enum: ['get', 'set', 'append'] },
      team_id: { type: 'string', description: 'Team ID' },
      goal: { type: 'string', description: 'New goal text (required for set/append)' },
      reason: { type: 'string', description: 'Why this goal is changing (optional, logged to team chat)' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const action = String(args?.action || '').trim().toLowerCase();
    const teamId = String(args?.team_id || '').trim();
    const goalInput = String(args?.goal || '').trim();
    const reason = String(args?.reason || '').trim();

    if (!action) return { success: false, error: 'action is required' };
    if (!teamId) return { success: false, error: 'team_id is required' };
    if (!_getManagedTeam) return { success: false, error: 'Team tools not initialized.' };

    const team = _getManagedTeam(teamId);
    if (!team) {
      const teams = _listManagedTeams?.() ?? [];
      const ids = teams.map((t: any) => `${t.id} (${t.name})`).join(', ');
      return { success: false, error: `Team "${teamId}" not found. Available: ${ids || 'none'}` };
    }

    if (action === 'get') {
      return {
        success: true,
        stdout: `Team "${team.name}" goal:\n\n${team.teamContext || '(no goal set)'}`,
        data: { teamId, teamName: team.name, goal: team.teamContext },
      };
    }

    if (action === 'set' || action === 'append') {
      if (!goalInput) return { success: false, error: 'goal is required for set/append' };

      const prevGoal = String(team.teamContext || '');
      const newGoal = action === 'append'
        ? (prevGoal ? `${prevGoal}\n\n${goalInput}` : goalInput).slice(0, 2000)
        : goalInput.slice(0, 2000);

      team.teamContext = newGoal;

      // Update manager system prompt if it contained the old goal verbatim
      if (prevGoal && team.manager.systemPrompt?.includes(prevGoal)) {
        team.manager.systemPrompt = team.manager.systemPrompt.replace(prevGoal, newGoal);
      }

      // Dynamically import saveManagedTeam at runtime (avoids circular dep at module load)
      const { saveManagedTeam: save, appendTeamChat } = await import('../gateway/teams/managed-teams.js');
      save(team);

      const changeVerb = action === 'append' ? 'appended to' : 'updated';
      const reasonStr = reason ? ` Reason: ${reason}` : '';
      const chatMsg = `[Goal ${changeVerb}]${reasonStr}\n\nNew goal: ${newGoal.slice(0, 300)}${newGoal.length > 300 ? '...' : ''}`;
      const chatMessage = appendTeamChat(teamId, { from: 'manager', fromName: 'Manager', content: chatMsg });

      if (_broadcastFn) {
        _broadcastFn({ type: 'team_goal_updated', teamId, teamName: team.name, newGoal });
        _broadcastFn({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage, text: chatMsg });
      }

      return {
        success: true,
        stdout: `Team "${team.name}" goal ${changeVerb} successfully.\n\nNew goal:\n${newGoal}`,
        data: { teamId, teamName: team.name, previousGoal: prevGoal, newGoal },
      };
    }

    return { success: false, error: `Unknown action "${action}". Valid: get, set, append` };
  },
};

export const manageTeamContextRefTool = {
  name: 'manage_team_context_ref',
  description:
    'Manage team context/reference cards used by managers and subagents at runtime. ' +
    'Use action=list|add|update|delete. Preserve existing references unless explicitly asked to remove one.',
  schema: {
    action: 'Action: list | add | update | delete',
    team_id: 'Team ID. Optional for list; required for add/update/delete.',
    ref_id: 'Reference card ID (required for update/delete)',
    title: 'Reference title (required for add, optional for update)',
    content: 'Reference body/content (required for add, optional for update)',
  },
  jsonSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'add', 'update', 'delete'] },
      team_id: { type: 'string' },
      ref_id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    const action = String(args?.action || '').trim().toLowerCase();
    const teamId = String(args?.team_id || '').trim();
    if (!action) return { success: false, error: 'action is required' };
    if (!_listTeamContextReferences || !_addTeamContextReference || !_updateTeamContextReference || !_deleteTeamContextReference) {
      return { success: false, error: 'Team context tools not initialized.' };
    }

    if (action === 'list') {
      if (teamId) {
        const team = _getManagedTeam?.(teamId);
        if (!team) return { success: false, error: `Team "${teamId}" not found` };
        const refs = _listTeamContextReferences(teamId);
        if (!refs.length) return { success: true, stdout: `No context references for team "${team.name}".`, data: { teamId, references: [] } };
        const lines = refs.map((r: any) => `- [${r.id}] ${r.title}: ${String(r.content || '').slice(0, 180)}`);
        return { success: true, stdout: `Team "${team.name}" references:\n${lines.join('\n')}`, data: { teamId, references: refs } };
      }
      const teams = _listManagedTeams?.() || [];
      if (teams.length === 0) return { success: true, stdout: 'No teams found.', data: { teams: [] } };
      const lines = teams.map((t: any) => {
        const refs = _listTeamContextReferences!(t.id);
        return `- ${t.id} (${t.name}): ${refs.length} reference card(s)`;
      });
      return { success: true, stdout: lines.join('\n'), data: { teams: teams.map((t: any) => ({ id: t.id, name: t.name })) } };
    }

    if (!teamId) return { success: false, error: 'team_id is required for add/update/delete' };
    const team = _getManagedTeam?.(teamId);
    if (!team) return { success: false, error: `Team "${teamId}" not found` };

    if (action === 'add') {
      const title = String(args?.title || '').trim();
      const content = String(args?.content || '').trim();
      if (!title || !content) return { success: false, error: 'title and content are required for add' };
      const created = _addTeamContextReference(teamId, { title, content, actor: 'tool:manage_team_context_ref' });
      if (!created) return { success: false, error: 'Could not create context reference' };
      return {
        success: true,
        stdout: `Added context reference [${created.id}] "${created.title}" to team "${team.name}".`,
        data: { teamId, reference: created },
      };
    }

    if (action === 'update') {
      const refId = String(args?.ref_id || '').trim();
      if (!refId) return { success: false, error: 'ref_id is required for update' };
      const patch: any = { actor: 'tool:manage_team_context_ref' };
      if (args?.title !== undefined) patch.title = String(args.title);
      if (args?.content !== undefined) patch.content = String(args.content);
      const updated = _updateTeamContextReference(teamId, refId, patch);
      if (!updated) return { success: false, error: `Could not update reference "${refId}"` };
      return {
        success: true,
        stdout: `Updated context reference [${updated.id}] "${updated.title}" for team "${team.name}".`,
        data: { teamId, reference: updated },
      };
    }

    if (action === 'delete') {
      const refId = String(args?.ref_id || '').trim();
      if (!refId) return { success: false, error: 'ref_id is required for delete' };
      const deleted = _deleteTeamContextReference(teamId, refId);
      if (!deleted) return { success: false, error: `Reference "${refId}" not found` };
      return {
        success: true,
        stdout: `Deleted context reference "${refId}" from team "${team.name}".`,
        data: { teamId, refId },
      };
    }

    return { success: false, error: `Unknown action "${action}". Valid: list, add, update, delete` };
  },
};
