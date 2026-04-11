import fs from 'fs';
import path from 'path';
import { ensureAgentWorkspace, getAgentById, getConfig } from '../../config/config';
import { getManagedTeam, drainAgentMessages, recordTeamRun } from './managed-teams';
import { getTeamWorkspacePath, buildWorkspaceContextBlock, ensureTeamWorkspace, ensureTeamAgentIdentity } from './team-workspace';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import { loadTask, saveTask } from '../tasks/task-store';

// ─── Injected dependencies (set by server-v2 at startup) ───────────────────────────────────────────
// These are injected at runtime to avoid circular imports with server-v2.ts

type HandleChatFn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  modelOverride?: string,
  executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron' | 'team_subagent',
  toolFilter?: string[],
  attachments?: undefined,
  reasoningOptions?: undefined,
  providerOverride?: string,
) => Promise<{ type: string; text: string; thinking?: string }>;

type BroadcastFn = (data: object) => void;

interface DispatchDeps {
  handleChat: HandleChatFn;
  broadcastTeamEvent: BroadcastFn;
  getMCPManager: () => any;
  buildTools: () => any[];
  createTask: (input: any) => any;
  updateTaskStatus: (id: string, status: string, opts?: any) => void;
  setTaskStepRunning: (id: string, idx: number) => void;
  updateTaskRuntimeProgress: (id: string, progress: any) => void;
  mutatePlan: (id: string, ops: any[]) => void;
  appendJournal: (id: string, entry: any) => void;
  setWorkspace: (sessionId: string, path: string) => void;
  recordAgentRun: (entry: any) => void;
  recordFileWrite: (teamId: string, filename: string, agentId: string) => void;
  listWorkspaceFiles: (teamId: string) => any[];
}

let _dispatchDeps: DispatchDeps | null = null;

export function setDispatchDeps(deps: DispatchDeps): void {
  _dispatchDeps = deps;
}

/** Session IDs of agents currently running — used for loop-guard in dispatch_team_agent handler */
export const _activeAgentSessions = new Set<string>();

/** Background agent result registry — keyed by task_id returned to callers */
export interface BgAgentEntry {
  status: 'running' | 'complete' | 'failed';
  agentId: string;
  teamId: string;
  startedAt: number;
  promise: Promise<RunAgentResult>;
  result?: RunAgentResult;
}
export const _bgAgentResults = new Map<string, BgAgentEntry>();

export interface RunAgentResult {
  success: boolean;
  result: string;
  error?: string;
  processLog?: string;
  durationMs: number;
  stepCount?: number;
  agentName: string;
  taskId?: string;
  warning?: string;
}

/**
 * Run a team agent through the full handleChat pipeline.
 * This is the canonical dispatch function for ALL team agent runs.
 * Previously lived in teams.router.ts — moved here so it can be imported
 * by team-manager-runner.ts without a circular dependency through the router.
 */
export async function runTeamAgentViaChat(
  agentId: string,
  task: string,
  teamId: string,
  timeoutMs = 300000,
): Promise<RunAgentResult> {
  if (!_dispatchDeps) {
    return { success: false, result: '', error: 'Dispatch deps not initialized', durationMs: 0, agentName: agentId };
  }
  const deps = _dispatchDeps;
  const agent = getAgentById(agentId);
  const agentName = agent?.name ?? agentId;
  const startedAt = Date.now();
  const team = teamId ? getManagedTeam(teamId) : null;
  const sessionId = `team_dispatch_${agentId}_${Date.now()}`;
  const knownProviders = new Set(['ollama', 'llama_cpp', 'lm_studio', 'openai', 'openai_codex', 'anthropic']);
  const parseProviderModel = (raw: string): { providerOverride?: string; modelOverride?: string } => {
    const v = String(raw || '').trim();
    if (!v) return {};
    const idx = v.indexOf('/');
    if (idx > 0) {
      const providerId = v.slice(0, idx).trim();
      const model = v.slice(idx + 1).trim();
      if (providerId && model && knownProviders.has(providerId)) {
        return { providerOverride: providerId, modelOverride: model };
      }
    }
    return { modelOverride: v };
  };
  const resolveAgentModelRouting = (): { providerOverride?: string; modelOverride?: string } => {
    const explicitModel = String((agent as any)?.model || '').trim();
    if (explicitModel) return parseProviderModel(explicitModel);

    const cfg = getConfig().getConfig() as any;
    const defaults = cfg?.agent_model_defaults || {};
    const roleType = String((agent as any)?.roleType || '').trim().toLowerCase();
    const roleKey = roleType ? `subagent_${roleType}` : '';
    const fallbackRef =
      String((roleKey && defaults?.[roleKey]) || defaults?.subagent || '').trim();
    if (!fallbackRef) return {};
    return parseProviderModel(fallbackRef);
  };
  const agentRouting = resolveAgentModelRouting();

  // Team subagents run with their file tools scoped to the team workspace.
  // Source-read tools still resolve against the main Prometheus workspace, but normal
  // file writes land inside this team workspace only.
  let teamWorkspacePath: string | null = null;
  if (teamId) {
    try { teamWorkspacePath = ensureTeamWorkspace(teamId); } catch {}
  }

  // Load agent role from the team-scoped identity directory.
  // ensureTeamAgentIdentity bootstraps system_prompt.md from the global agent workspace
  // on first use, then keeps it isolated — so the same agent ID on two different teams
  // can have independent roles without any context bleed.
  let agentRoleBlock = '';
  let agentIdentityPath = '';
  if (agent) {
    try {
      const globalAgentWs = ensureAgentWorkspace(agent as any);
      const identityWs = teamId
        ? ensureTeamAgentIdentity(teamId, agentId, globalAgentWs)
        : globalAgentWs;
      agentIdentityPath = identityWs;
      const spFile = [path.join(identityWs, 'system_prompt.md'), path.join(identityWs, 'HEARTBEAT.md')]
        .find(f => fs.existsSync(f));
      if (spFile) {
        const raw = fs.readFileSync(spFile, 'utf-8').trim();
        if (raw) agentRoleBlock = `[YOUR ROLE ON THIS TEAM — ${agentName}]\n${raw}`;
      }
    } catch {}
  }

  // Build MCP server summary
  let mcpServerSummary = '';
  try {
    const mcpTools = deps.getMCPManager().getAllTools();
    const byServer = new Map<string, string[]>();
    for (const t of mcpTools) {
      const key = `${t.serverName} (mcp__${t.serverId}__*)`;
      if (!byServer.has(key)) byServer.set(key, []);
      byServer.get(key)!.push(t.name);
    }
    if (byServer.size > 0) {
      const lines = [...byServer.entries()].map(([srv, tools]) =>
        `  - ${srv}: ${tools.slice(0, 8).join(', ')}${tools.length > 8 ? ` (+${tools.length - 8} more)` : ''}`
      );
      mcpServerSummary = `[CONNECTED MCP SERVERS]\n${lines.join('\n')}`;
    }
  } catch {}

  // Pre-activate tool categories from agent config (browser, desktop, etc.).
  // background_spawn is a core tool and needs no category activation.
  const agentAllowedCategories: string[] = Array.isArray((agent as any)?.allowed_categories)
    ? (agent as any).allowed_categories
    : [];
  if (agentAllowedCategories.length > 0) {
    try {
      const { activateToolCategory } = require('../session');
      for (const cat of agentAllowedCategories) {
        activateToolCategory(sessionId, cat);
      }
    } catch { /* non-fatal */ }
  }

  // Create task record
  const cronTask = deps.createTask({
    title: `${agentName}: ${task.slice(0, 80)}`,
    prompt: task,
    sessionId,
    channel: 'web',
    plan: [{ index: 0, description: task.slice(0, 120), status: 'pending' }],
  });
  deps.updateTaskStatus(cronTask.id, 'running');
  deps.setTaskStepRunning(cronTask.id, 0);
  deps.broadcastTeamEvent({ type: 'task_running', taskId: cronTask.id, teamId, agentId });

  // Drain any queued messages for this agent
  const pendingMessages = teamId ? drainAgentMessages(teamId, agentId) : [];

  // Detect complex multi-step tasks that should use declare_plan
  const taskLower = task.toLowerCase();
  const isComplexTask = /research|gather|analyze|investigate|compile|summarize|identify.*\d+|interview|survey|collect|evaluate/i.test(task);
  const planRequirementBlock = isComplexTask
    ? `\n[COMPLEX TASK PLANNING]\nThis is a multi-phase task. Call declare_plan with 2-4 meaningful steps IMMEDIATELY:\n  1. First step for initial research/setup\n  2. Execution/gathering phase\n  3. Compilation/analysis phase\n  4. Formatting/output phase (if needed)\nDeclare these steps now, then execute them in order. Do NOT skip planning for a complex task like this.`
    : '';

  // Lean callerContext — subagents get role + workspace + comms only.
  // Chat history and team members list are intentionally omitted: the manager holds
  // that context, not subagents. Task specifics come through in the dispatch message.
  const callerContext = [
    `[TEAM DISPATCH — ${team?.name || teamId} | agent: ${agentId}]`,
    `You are Prometheus. You have been assigned a specific role on this team for this session.`,
    ``,
    teamWorkspacePath
      ? [
          `[YOUR WORKING DIRECTORY]`,
          `${teamWorkspacePath}`,
          ``,
          `This is the team workspace for "${team?.name || teamId}". Write ALL task outputs and shared`,
          `files here. Do NOT write to your own agent workspace or any other path.`,
          `  → Check existing files here before creating new ones.`,
          `  → Prior run context: memory.json, last_run.json, pending.json are in this directory.`,
        ].join('\n')
      : '',
    agentRoleBlock ? `\n${agentRoleBlock}` : '',
    pendingMessages.length > 0
      ? `\n[MESSAGES FOR YOU]\n${pendingMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')}\nAcknowledge and act on these as part of your task.`
      : '',
    `\n[PARALLEL EXECUTION]`,
    `Use background_spawn to run independent subtasks in parallel while you continue your main work.`,
    `background_spawn(prompt) — spawns a full LLM agent; result is auto-merged at turn-end.`,
    `  PROMPT MUST BE FULLY SELF-CONTAINED — include all file paths, context, and exact instructions.`,
    `  The bg agent has no session history. Write outputs to the team workspace: ${teamWorkspacePath ?? '<workspace>'}`,
    mcpServerSummary ? `\n${mcpServerSummary}` : '',
    planRequirementBlock,
    ``,
    `[ESCALATION]`,
    `Post blockers or errors to the team workspace (pending.json) so the coordinator can act on them.`,
  ].filter(Boolean).join('\n');

  if (pendingMessages.length > 0) {
    console.log(`[TeamDispatch] Injected ${pendingMessages.length} queued message(s) for agent "${agentId}"`);
  }

  if (teamWorkspacePath) {
    deps.setWorkspace(sessionId, teamWorkspacePath);
    cronTask.agentWorkspace = teamWorkspacePath;
  }
  if (agentRouting.modelOverride) {
    cronTask.executorProvider = agentRouting.providerOverride
      ? `${agentRouting.providerOverride}/${agentRouting.modelOverride}`
      : agentRouting.modelOverride;
  }
  cronTask.teamSubagent = {
    teamId,
    agentId,
    agentName,
    callerContext,
  };
  saveTask(cronTask);

  let stepCount = 0;
  const processLogLines: string[] = [];

  const sendSSE = (event: string, data: any) => {
    if (event === 'tool_call') {
      stepCount++;
      const toolName = data?.action || data?.tool || data?.name || '?';
      const argsStr = JSON.stringify(data?.args || data?.input || {}).slice(0, 200);
      processLogLines.push(`[tool_call] ${toolName}(${argsStr})`);
    } else if (event === 'tool_result') {
      const resultStr = String(data?.result ?? data?.output ?? data?.content ?? '').slice(0, 400);
      if (resultStr) processLogLines.push(`[tool_result] ${resultStr}`);
    } else if (event === 'thinking' && data?.text) {
      processLogLines.push(`[thinking] ${String(data.text).slice(0, 200)}`);
    } else if (event === 'progress_state') {
      deps.updateTaskRuntimeProgress(cronTask.id, {
        source: data?.source,
        activeIndex: Number(data?.activeIndex ?? -1),
        items: Array.isArray(data?.items)
          ? data.items.map((item: any, idx: number) => ({
            id: String(item?.id || `p${idx + 1}`),
            text: String(item?.text || ''),
            status: String(item?.status || 'pending') as any,
          }))
          : [],
      });
    }
    deps.broadcastTeamEvent({ type: 'task_tool_call', taskId: cronTask.id, tool: data?.action, args: data?.args });
  };

  _activeAgentSessions.add(sessionId);
  try {
    const runner = new BackgroundTaskRunner(
      cronTask.id,
      deps.handleChat as any,
      (data: object) => deps.broadcastTeamEvent({ ...data, teamId, agentId }),
      null,
    );
    await Promise.race<any>([
      runner.start(),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error(`Team agent timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    const finalTask = loadTask(cronTask.id);
    const finalStatus = finalTask?.status || 'failed';
    const resultText = String(finalTask?.finalSummary || finalTask?.pendingClarificationQuestion || '');
    const waitingForManager = finalStatus === 'awaiting_user_input' || finalStatus === 'needs_assistance' || finalStatus === 'paused';
    const success = finalStatus === 'complete' && !resultText.startsWith('ERROR:');
    const zeroToolCalls = stepCount === 0;

    // ── Validate result substantiveness for complex tasks ─────────────────────
    let resultWarning = '';
    if (isComplexTask && success) {
      // Check if result is suspiciously empty or just file listings
      const isSuspiciouslyEmpty = /^\s*\[\s*(?:DIR|FILE)\s*\]|^Done\.|^Task complete\.?$/i.test(resultText)
        || resultText.length < 100;
      const isMainlyFileList = /^\s*\[\s*(?:DIR|FILE)\s*\]/m.test(resultText) && resultText.split('\n').filter(l => /\[\s*(?:DIR|FILE)\s*\]/.test(l)).length > resultText.split('\n').length * 0.5;

      // Check for hollow work: claimed research but returned categories/assumptions instead of specific data
      const hasGenericCategories = /^(restaurants|contractors|salons|businesses|companies|services|types|categories|categories of)/im.test(resultText.slice(0, 500));
      const lacksSpecificNames = !/[A-Z][a-z]+\s+(?:[A-Z][a-z]+)?[\s,].*?(?:website|url|phone|contact|email|address)/i.test(resultText);
      const allVariesOrAssumed = (resultText.match(/varies|assumed|likely|probably|may have|could be|not specified/gi) || []).length > 5;
      const isHollowWork = (hasGenericCategories || lacksSpecificNames || allVariesOrAssumed) && resultText.length > 200;

      if (isSuspiciouslyEmpty || isMainlyFileList) {
        resultWarning = `⚠️ INCOMPLETE: Result appears to be mostly file listings or placeholder text for a complex task. The agent may not have executed the research/gathering properly.`;
        console.warn(`[TeamDispatch] Suspicious result for complex task "${agentId}": ${resultText.slice(0, 200)}`);
      } else if (isHollowWork) {
        resultWarning = `⚠️ HOLLOW WORK: Result contains generic categories/assumptions instead of specific extracted data (actual company names, websites, contact info). Agent reported research done but did not deliver substantive lead data.`;
        console.warn(`[TeamDispatch] Hollow work detected for complex task "${agentId}": result has categories/assumptions but no specific extracted data`);
      }
    }

    // ── Issue 9: Record run in team-scoped history ────────────────────────────
    const finishedAt = Date.now();
    if (teamId) {
      recordTeamRun(teamId, {
        agentId,
        agentName,
        trigger: 'team_dispatch',
        taskId: cronTask.id,
        success,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        stepCount,
        zeroToolCalls,
        error: success ? (resultWarning || undefined) : (waitingForManager ? `Waiting: ${resultText.slice(0, 260)}` : resultText.slice(0, 300)),
        resultPreview: success ? resultText : undefined,
      });
    }

    deps.appendJournal(cronTask.id, { type: 'status_push', content: `${waitingForManager ? 'Waiting' : success ? 'Done' : 'Stopped'}: ${resultText.slice(0, 200)}` });
    deps.broadcastTeamEvent({
      type: waitingForManager ? 'task_paused' : success ? 'task_complete' : 'task_failed',
      taskId: cronTask.id,
      teamId,
      agentId,
      summary: resultText.slice(0, 200),
    });

    return {
      success,
      result: waitingForManager
        ? `WAITING_FOR_MANAGER: ${resultText || 'The subagent paused for manager input.'}`
        : resultWarning ? `${resultWarning}\n\n${resultText}` : resultText,
      processLog: processLogLines.length > 0 ? processLogLines.join('\n') : undefined,
      durationMs: finishedAt - startedAt,
      stepCount,
      agentName,
      taskId: cronTask.id,
      warning: resultWarning || undefined,
    };
  } catch (err: any) {
    const finishedAt = Date.now();

    // ── Issue 9: Record failed run in team history ────────────────────────────
    if (teamId) {
      recordTeamRun(teamId, {
        agentId,
        agentName,
        trigger: 'team_dispatch',
        taskId: cronTask.id,
        success: false,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        stepCount,
        zeroToolCalls: stepCount === 0,
        error: String(err?.message ?? err).slice(0, 300),
      });
    }

    deps.updateTaskStatus(cronTask.id, 'failed', { finalSummary: String(err?.message ?? err).slice(0, 500) });
    deps.appendJournal(cronTask.id, { type: 'status_push', content: `Failed: ${String(err?.message ?? err).slice(0, 200)}` });
    return {
      success: false,
      result: '',
      error: String(err?.message ?? err),
      durationMs: finishedAt - startedAt,
      stepCount,
      agentName,
      taskId: cronTask.id,
    };
  } finally {
    _activeAgentSessions.delete(sessionId);
  }
}

export interface TeamDispatchBuildInput {
  agentId: string;
  task: string;
  /** Optional team ID — when provided, team context and workspace info are injected */
  teamId?: string;
  context?: string;
}

export interface TeamDispatchBuildResult {
  effectiveTask: string;
  usedSystemPrompt: boolean;
}

function normalizeList(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean);
}

function unique(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = String(item || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(item).trim());
  }
  return out;
}

function tryReadText(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return String(fs.readFileSync(filePath, 'utf-8') || '').trim();
  } catch {
    return '';
  }
}

function readSubagentConfig(agentId: string, workspace: string): any | null {
  const cfg = getConfig().getConfig() as any;
  const roots = new Set<string>([
    path.join(workspace, 'config.json'),
    path.join(String(cfg?.workspace?.path || process.cwd()), '.prometheus', 'subagents', agentId, 'config.json'),
    path.join(process.cwd(), '.prometheus', 'subagents', agentId, 'config.json'),
  ]);

  for (const p of roots) {
    try {
      if (!fs.existsSync(p)) continue;
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {}
  }
  return null;
}

export function buildTeamDispatchTask(input: TeamDispatchBuildInput): TeamDispatchBuildResult {
  const agent = getAgentById(input.agentId);
  if (!agent) {
    return { effectiveTask: String(input.task || ''), usedSystemPrompt: false };
  }

  const workspace = ensureAgentWorkspace(agent as any);
  const dynamicConfig = readSubagentConfig(input.agentId, workspace);

  const systemPromptPath = path.join(workspace, 'system_prompt.md');
  const agentsMdPath = path.join(workspace, 'AGENTS.md');
  const systemPrompt = tryReadText(systemPromptPath)
    || String(dynamicConfig?.system_instructions || (agent as any).system_instructions || '').trim()
    || tryReadText(agentsMdPath);

  const constraints = normalizeList(dynamicConfig?.constraints ?? (agent as any).constraints);
  const successCriteria = String(
    dynamicConfig?.success_criteria
      ?? (agent as any).success_criteria
      ?? '',
  ).trim();

  // ── Team context injection (generic — works for any team) ──────────────────
  const teamContextBlock = buildGenericTeamContext(input.agentId, input.teamId);

  const sections: string[] = [
    `[TEAM DISPATCH]`,
    '',
    'YOUR TASK:',
    String(input.task || '').trim(),
  ];

  if (input.context && String(input.context).trim()) {
    sections.push('', 'ADDITIONAL CONTEXT:', String(input.context).trim());
  }

  if (teamContextBlock) {
    sections.push('', teamContextBlock);
  }

  if (constraints.length > 0) {
    sections.push('', 'CONSTRAINTS:', ...constraints.map((c) => `- ${c}`));
  }
  if (successCriteria) {
    sections.push('', `SUCCESS CRITERIA: ${successCriteria}`);
  }

  const focusedPaths: string[] = [];
  if (input.teamId) {
    // On a team: working directory is the team workspace. Point to team paths only —
    // global agent workspace files are not relevant to this dispatched run.
    try {
      const twp: string = getTeamWorkspacePath(input.teamId);
      if (twp) {
        focusedPaths.push(`  - Team workspace (your working directory): ${twp}`);
        const pipelineFile = path.join(twp, 'PIPELINE_STATUS.md');
        if (fs.existsSync(pipelineFile)) focusedPaths.push(`  - Pipeline status:   ${pipelineFile}`);
        const memFile = path.join(twp, 'memory.json');
        if (fs.existsSync(memFile)) focusedPaths.push(`  - Prior run memory:  ${memFile}`);
      }
    } catch { /* non-fatal */ }
  } else {
    // No team — use global agent workspace paths as usual
    const agMdFile = path.join(workspace, 'AGENTS.md');
    if (fs.existsSync(agMdFile)) focusedPaths.push(`  - Your role prompt:  ${agMdFile}`);
    const userFile = path.join(workspace, 'USER.md');
    if (fs.existsSync(userFile)) focusedPaths.push(`  - User profile:      ${userFile}`);
    const soulFile = path.join(workspace, 'SOUL.md');
    if (fs.existsSync(soulFile)) focusedPaths.push(`  - Core identity:     ${soulFile}`);
    const memoryFile = path.join(workspace, 'MEMORY.md');
    if (fs.existsSync(memoryFile)) focusedPaths.push(`  - Long-term memory:  ${memoryFile}`);
  }

  sections.push(
    '',
    'TOOL RULES — follow exactly:',
    '1. You have FULL tool access. NEVER claim you cannot use tools — call them directly.',
    '2. For web/browser automation call browser_open directly.',
    '3. For workspace listing use list_directory with path="." — never path="". Skip .git/ entirely.',
    '4. Do NOT blindly scan directories at startup. Read only what you need, starting from:',
    ...(focusedPaths.length > 0 ? focusedPaths : ['  - Your task instructions above.']),
    '',
    'Execute the task above now. Use your tools, verify results, and report what actually happened.',
  );

  return {
    effectiveTask: sections.join('\n'),
    usedSystemPrompt: !!systemPrompt,
  };
}

/**
 * Builds a generic team context block for any agent dispatched to any team.
 */
function buildGenericTeamContext(agentId: string, teamId?: string): string {
  if (!teamId) {
    const { listManagedTeams } = require('./managed-teams');
    const teams = listManagedTeams();
    const team = teams.find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(agentId));
    if (!team) return '';
    return buildGenericTeamContext(agentId, team.id);
  }

  try {
    const team = getManagedTeam(teamId);
    if (!team) return '';

    const wsPath = getTeamWorkspacePath(teamId);
    const lines: string[] = [
      `[TEAM CONTEXT — ${team.name}]`,
      `Team workspace (your working directory): ${wsPath}`,
      `Write all task outputs and shared files to this path.`,
    ];

    const purposeStr = String((team as any).purpose || team.mission || team.teamContext || '').trim();
    if (purposeStr) {
      lines.push('', 'Team purpose:', purposeStr);
    }
    const focusStr = String(team.currentFocus || '').trim();
    if (focusStr) {
      lines.push('Current task this run:', focusStr);
    }

    const refs = Array.isArray(team.contextReferences) ? team.contextReferences : [];
    if (refs.length > 0) {
      lines.push('', 'Reference docs:');
      for (const ref of refs.slice(0, 5)) {
        lines.push(`  [${ref.title}]: ${String(ref.content || '').slice(0, 300)}`);
      }
    }

    try {
      const workspaceBlock = buildWorkspaceContextBlock(teamId, agentId);
      if (workspaceBlock) lines.push('', workspaceBlock);
    } catch { /* non-fatal */ }

    try {
      const pipelineStatusPath = path.join(wsPath, 'PIPELINE_STATUS.md');
      if (fs.existsSync(pipelineStatusPath)) {
        const content = fs.readFileSync(pipelineStatusPath, 'utf-8').trim();
        if (content) {
          lines.push('', '[PIPELINE_STATUS.md]:', content.slice(0, 2000));
        }
      }
    } catch { /* non-fatal */ }

    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Build enforced tool filter for team-dispatched runs.
 */
export function buildTeamToolFilter(agentId: string): string[] | null {
  const agent = getAgentById(agentId);
  if (!agent) return null;

  const workspace = ensureAgentWorkspace(agent as any);
  const dynamicConfig = readSubagentConfig(agentId, workspace);

  const allowedTools = normalizeList(dynamicConfig?.allowed_tools ?? (agent as any).allowed_tools);
  const mcpServers = normalizeList(dynamicConfig?.mcp_servers ?? (agent as any).mcp_servers);

  const filter: string[] = [...allowedTools];
  for (const serverId of mcpServers) {
    filter.push(`mcp__${serverId}__*`);
  }

  const normalized = unique(filter);
  return normalized.length > 0 ? normalized : null;
}

// ── Src read access ─────────────────────────────────────────────────────────

/**
 * Returns true if this agent has been granted src read access.
 * Checked from config.json: { "src_read_access": true }
 * When true, read_source and list_source are added to the agent’s tool filter.
 */
export function agentHasSrcReadAccess(agentId: string): boolean {
  const agent = getAgentById(agentId);
  if (!agent) return false;
  const workspace = ensureAgentWorkspace(agent as any);
  const dynamicConfig = readSubagentConfig(agentId, workspace);
  return dynamicConfig?.src_read_access === true || (agent as any).src_read_access === true;
}

/**
 * Returns true if this agent is allowed to submit proposals directly.
 * Default: false for all subagents. Set { "can_propose": true } in config.json
 * to allow (intended only for manager agents).
 */
export function agentCanPropose(agentId: string): boolean {
  const agent = getAgentById(agentId);
  if (!agent) return false;
  const workspace = ensureAgentWorkspace(agent as any);
  const dynamicConfig = readSubagentConfig(agentId, workspace);
  return dynamicConfig?.can_propose === true || (agent as any).can_propose === true;
}
