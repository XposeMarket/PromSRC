import { getAgentById, ensureAgentWorkspace, getConfig } from '../config/config.js';
import { ensureTeamAgentIdentity } from '../gateway/teams/team-workspace.js';
import { getOllamaClient } from './ollama-client.js';
import path from 'path';
import { buildProviderById } from '../providers/factory.js';
import { parseAgentModelString, ProviderReactorClient } from './provider-reactor.js';
import { resolveConfiguredAgentModel } from './model-routing.js';
import { Reactor } from './reactor.js';
import { createTask, updateTaskStatus, appendJournal, mutatePlan } from '../gateway/tasks/task-store.js';
import { runWithWorkspace } from '../tools/workspace-context.js';
import { getToolRegistry } from '../tools/registry.js';
import { buildSelfReflectionInstruction } from '../config/self-reflection.js';
import { selectSkillSlugsForMessage } from '../config/soul-loader.js';

export interface SpawnOptions {
  /** ID of the agent to run */
  agentId: string;
  /** The task/mission to give the agent */
  task: string;
  /** Timeout in ms. Default: 120000 (2 min) */
  timeoutMs?: number;
  /** Max reactor steps. Overrides agent.maxSteps */
  maxSteps?: number;
  /** Extra context injected into the task prompt */
  context?: string;
  /** Called on each reactor step (for streaming to UI) */
  onStep?: (step: any) => void;
  /**
   * Override the workspace path for this agent run.
   * For team dispatches: pass the team workspace so file tools operate on
   * the shared team workspace, while system_prompt.md is read from the
   * team-scoped subagent identity directory.
   */
  workspacePath?: string;
  /**
   * Team ID for this dispatch. When set, the agent's identity (system_prompt.md,
   * AGENTS.md, etc.) is loaded from a per-team isolated directory. This makes
   * the same agent act as completely
   * separate entities in different teams — no context bleed between teams.
   */
  teamId?: string;
  /**
   * Agent type hint used to look up agent_model_defaults when the agent has no
   * explicit model override. Valid values match the agent_model_defaults keys:
   * 'main_chat' | 'proposal_executor_high_risk' | 'proposal_executor_low_risk' |
   * 'manager' | 'subagent' | 'background_task'
   * Defaults to 'subagent' if not provided.
   */
  agentType?: string;
}

export interface SpawnResult {
  agentId: string;
  agentName: string;
  success: boolean;
  result: string;
  error?: string;
  durationMs: number;
  stepCount?: number;
  /** Which provider actually ran this agent */
  providerUsed?: string;
}

// ─── Ollama Concurrency Guard ─────────────────────────────────────────────────
// Ollama can only run one model at a time. When multiple sub-agents all resolve
// to the Ollama provider we serialize them automatically so they don't stomp
// each other. Cloud providers (openai, openai_codex, etc.) are fully parallel
// and bypass this queue entirely.

let ollamaMutexBusy = false;
const ollamaQueue: Array<() => void> = [];

function acquireOllamaMutex(): Promise<void> {
  return new Promise((resolve) => {
    if (!ollamaMutexBusy) {
      ollamaMutexBusy = true;
      resolve();
    } else {
      ollamaQueue.push(resolve);
    }
  });
}

function releaseOllamaMutex(): void {
  const next = ollamaQueue.shift();
  if (next) {
    next();
  } else {
    ollamaMutexBusy = false;
  }
}

// ─── Provider Resolution ───────────────────────────────────────────────────────

interface ResolvedProvider {
  client: any; // OllamaClient or ProviderReactorClient — both satisfy Reactor's needs
  providerId: string;
  model: string;
  isOllama: boolean;
}

function inferSpawnAgentType(agent: any, explicitAgentType?: string): string {
  const provided = String(explicitAgentType || '').trim();
  if (provided) return provided;
  if (String(agent?.id || '').trim() === 'main') return 'main_chat';
  try {
    const { listManagedTeams } = require('../gateway/teams/managed-teams.js');
    const teams = listManagedTeams();
    const agentId = String(agent?.id || '').trim();
    if (agent?.isTeamManager === true || teams.some((team: any) => String(team?.managerAgentId || '').trim() === agentId)) {
      return 'team_manager';
    }
    if (teams.some((team: any) => Array.isArray(team?.subagentIds) && team.subagentIds.includes(agentId))) {
      return 'team_subagent';
    }
  } catch {
    // Non-fatal — fall back to the generic standalone subagent default.
  }
  return 'subagent';
}

/**
 * Resolves which provider + model to use for a given agent.
 *
 * Priority:
 *   1. agent.model = "provider/model" string  → parse + build that provider directly
 *   2. agent.model = bare model name          → use global primary provider, override model
 *   3. agent_model_defaults[agentType]        → use the configured type default
 *   4. no model field                         → use global primary provider + global model
 *
 * For Ollama providers the caller MUST acquire the Ollama mutex before
 * running the Reactor, and release it when done.
 */
function resolveAgentProvider(agent: any, agentType?: string): ResolvedProvider {
  // Step 1: explicit "provider/model" on the agent definition
  const parsed = parseAgentModelString(agent.model);

  if (parsed) {
    // Explicit "provider/model" format — build that provider directly
    const provider = buildProviderById(parsed.provider);
    const isOllama = parsed.provider === 'ollama';
    const client = isOllama
      ? getOllamaClient() // Ollama still uses the global client (single connection)
      : new ProviderReactorClient(provider, parsed.model);
    return { client, providerId: parsed.provider, model: parsed.model, isOllama };
  }

  // Step 2: bare model name (no provider prefix) on agent — keep existing behaviour
  if (agent.model) {
    const globalClient = getOllamaClient();
    const globalProviderId = (globalClient as any).provider?.id ?? 'ollama';
    const isOllama = globalProviderId === 'ollama';
    return { client: globalClient, providerId: globalProviderId, model: agent.model, isOllama };
  }

  // Step 3: check agent_model_defaults for this agent type
  try {
    const { getConfig } = require('../config/config');
    const cfg = getConfig().getConfig() as any;
    const inferredType = inferSpawnAgentType(agent, agentType);
    const resolvedDefault = resolveConfiguredAgentModel(cfg, agent, {
      agentType: inferredType,
      fallbackToPrimary: false,
    });
    const defaultModel = String(resolvedDefault.model || '').trim();

    if (defaultModel) {
      const defaultParsed = parseAgentModelString(defaultModel);
      if (defaultParsed) {
        const provider = buildProviderById(defaultParsed.provider);
        const isOllama = defaultParsed.provider === 'ollama';
        const client = isOllama
          ? getOllamaClient()
          : new ProviderReactorClient(provider, defaultParsed.model);
        return { client, providerId: defaultParsed.provider, model: defaultParsed.model, isOllama };
      }
    }
  } catch {
    // getConfig unavailable at this call site — fall through to global primary
  }

  // Step 4: global primary provider + global model (original fallback)
  const globalClient = getOllamaClient();
  const globalProviderId = (globalClient as any).provider?.id ?? 'ollama';
  const isOllama = globalProviderId === 'ollama';
  return {
    client: globalClient,
    providerId: globalProviderId,
    model: '', // will be resolved by getModelForRole inside OllamaClient
    isOllama,
  };
}

function normalizePathForCompare(p: string): string {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = normalizePathForCompare(basePath);
  const target = normalizePathForCompare(targetPath);
  if (!base || !target) return false;
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveAgentExecutionWorkspace(agent: any, mainWorkspacePath: string): string {
  const configured = String(agent?.executionWorkspace || agent?.execution_workspace || agent?.workspaceRoot || '').trim();
  if (!configured) return mainWorkspacePath;
  const resolved = path.resolve(configured);
  const allowedWorkPaths = resolveAgentAllowedWorkPaths(agent, mainWorkspacePath);
  if (!allowedWorkPaths.some((allowed) => isPathInside(allowed, resolved))) {
    console.warn(`[agent:${agent?.id || 'unknown'}] Ignoring executionWorkspace outside allowed work paths: ${resolved}`);
    return mainWorkspacePath;
  }
  return resolved;
}

function resolveAgentAllowedWorkPaths(agent: any, mainWorkspacePath: string): string[] {
  const rawValues = [
    ...(Array.isArray(agent?.allowedWorkPaths) ? agent.allowedWorkPaths : []),
    ...(Array.isArray(agent?.allowed_work_paths) ? agent.allowed_work_paths : []),
  ];
  const roots = [mainWorkspacePath];
  for (const raw of rawValues) {
    const value = String(raw || '').trim();
    if (!value) continue;
    roots.push(path.isAbsolute(value) ? value : path.join(mainWorkspacePath, value));
  }
  const seen = new Set<string>();
  return roots.map((p) => path.resolve(p)).filter((resolved) => {
    const key = normalizePathForCompare(resolved);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Core Spawn ───────────────────────────────────────────────────────────────

/**
 * Spawns a sub-agent run in isolation.
 *
 * - Loads the agent definition from config
 * - Resolves the correct provider (cloud API or Ollama) from agent.model,
 *   then agent_model_defaults[agentType], then global primary
 * - Cloud providers (openai, openai_codex, etc.) run as fully independent
 *   concurrent API calls — no shared state with the user's active session
 * - Ollama agents are serialized via mutex (one model at a time)
 * - The parent session history is NOT shared with the sub-agent
 * - Sub-agent writes any outputs to its own workspace
 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
  const startMs = Date.now();
  const agent = getAgentById(options.agentId);

  if (!agent) {
    return {
      agentId: options.agentId,
      agentName: options.agentId,
      success: false,
      result: '',
      error: `Agent "${options.agentId}" not found in config. Check your agents array.`,
      durationMs: Date.now() - startMs,
    };
  }

  // The agent's own subagent workspace. Standalone one-off agents use this as
  // their identity/artifact root; team agents use a team identity root plus the
  // shared team workspace passed in options.workspacePath.
  const agentOwnWorkspace = options.teamId
    ? ensureTeamAgentIdentity(options.teamId, options.agentId, (agent as any).workspace || undefined)
    : ensureAgentWorkspace(agent);
  // If a teamId is provided, use a per-team isolated identity directory so the
  // same agent can serve multiple teams as completely separate entities.
  // This prevents any cross-team context bleed via shared system_prompt.md.
  const identityWorkspace = options.teamId
    ? ensureTeamAgentIdentity(options.teamId, options.agentId, agentOwnWorkspace)
    : agentOwnWorkspace;
  const mainWorkspacePath = getConfig().getWorkspacePath() || process.cwd();
  const agentExecutionWorkspace = resolveAgentExecutionWorkspace(agent, mainWorkspacePath);
  const agentAllowedWorkPaths = resolveAgentAllowedWorkPaths(agent, mainWorkspacePath);
  // Team dispatches pass the team workspace here. Standalone one-off subagents
  // can declare an executionWorkspace so file tools and run_command are confined
  // to a specific project directory while identity/artifacts stay separate.
  const workspacePath = options.workspacePath || agentExecutionWorkspace;
  const maxSteps = options.maxSteps ?? agent.maxSteps ?? 8;
  // Subagents use the same full runtime context as main chat, with their
  // identity layered in from system_prompt.md / HEARTBEAT.md.
  const promptMode = 'full';
  // Sub-agents run with full tool access.
  const agentToolProfile = 'full';
  const toolRegistry = getToolRegistry();
  const resolvedToolProfile = toolRegistry.resolveToolProfile(agentToolProfile);
  const availableToolNames = toolRegistry
    .getToolDefinitionsForChat(resolvedToolProfile)
    .map((t: any) => String(t?.function?.name || '').trim())
    .filter(Boolean);

  // Resolve skills for this agent: prefer explicit agent.skills array,
  // then fall back to relevance-based selection from the task message.
  // This is what makes skills available to team subagents.
  const agentSkills: string[] = Array.isArray((agent as any).skills) && (agent as any).skills.length
    ? (agent as any).skills as string[]
    : selectSkillSlugsForMessage(options.task, 3);

  const selfLearnSuffix = buildSelfReflectionInstruction({
    availableTools: availableToolNames,
    mode: 'general',
  });

  const workspaceGuidance = options.teamId
    ? `\n\n[Workspace rules]\nYou have full subagent runtime and tool access. Work inside the assigned team workspace by default so team artifacts stay together.\nTeam workspace: ${workspacePath}`
    : `\n\n[Workspace rules]\nYou have full subagent runtime and tool access. File tools and run_command are scoped to your allowed work paths.\nDefault execution workspace: ${workspacePath}\nAllowed work paths:\n${agentAllowedWorkPaths.map((p) => `- ${p}`).join('\n')}\nSubagent identity/artifact workspace: ${agentOwnWorkspace}`;
  const taskMessageBase = options.context
    ? `${options.task}\n\n[Context from orchestrator]\n${options.context}${workspaceGuidance}`
    : `${options.task}${workspaceGuidance}`;
  const taskMessage = selfLearnSuffix ? `${taskMessageBase}${selfLearnSuffix}` : taskMessageBase;

  const resolvedAgentType = inferSpawnAgentType(agent, options.agentType);
  const resolved = resolveAgentProvider(agent, resolvedAgentType);
  const label = `[agent:${agent.id}@${resolved.providerId}]`;

  console.log(`${label} Spawning — provider=${resolved.providerId} isOllama=${resolved.isOllama} model=${resolved.model || '(global)'} agentType=${resolvedAgentType}`);

  // Cloud providers: no serialization needed — each is an independent HTTP call
  // Ollama: must acquire the mutex before running
  if (resolved.isOllama) {
    await acquireOllamaMutex();
    console.log(`${label} Acquired Ollama mutex`);
  }

  let stepCount = 0;
  const timeoutMs = options.timeoutMs ?? 120000;

  // Create a task record so this run shows up on the Tasks page
  const agentTask = createTask({
    title: `${agent.name}: ${options.task.slice(0, 80)}`,
    prompt: options.task,
    sessionId: `agent_${agent.id}_${Date.now()}`,
    channel: 'web',
    plan: [{ index: 0, description: options.task.slice(0, 120), status: 'pending' }],
  });
  updateTaskStatus(agentTask.id, 'running');

  // ── Workspace isolation ───────────────────────────────────────────────────
  // Wrap the entire reactor run in a workspace context. Team agents are scoped
  // to the team workspace. Standalone one-off agents are scoped to the main
  // workspace, with prompt guidance to keep their own artifacts under their
  // private subagent workspace.
  console.log(`${label} Workspace scoped to: ${workspacePath}`);

  const runAgent = async (): Promise<string> => {
    const reactor = new Reactor(resolved.client as any, maxSteps);

    return Promise.race<string>([
      reactor.run(taskMessage, {
        role: 'executor',
        promptMode,
        includeAgentSystemPrompt: true,
        subagentSystemPromptOnly: false,
        workspacePath,
        skillSlugs: agentSkills,
        // When dispatched to a team, load identity from the per-team isolated dir
        // so this agent is a completely separate entity in each team context.
        // Falls back to agentOwnWorkspace if no team override is active.
        systemPromptWorkspacePath: identityWorkspace,
        maxSteps,
        toolProfile: agentToolProfile,
        onStep: (step) => {
          stepCount++;
          options.onStep?.(step);
        },
      }),
      new Promise<string>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Sub-agent timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  };

  try {
    // runWithWorkspace sets AsyncLocalStorage for the entire async chain,
    // ensuring all file tool calls inside this agent run are workspace-scoped.
    const resultText = await runWithWorkspace(workspacePath, runAgent, agentAllowedWorkPaths);

    console.log(`${label} Completed in ${Date.now() - startMs}ms (${stepCount} steps)`);

    // Mark task complete
    mutatePlan(agentTask.id, [{ op: 'complete', step_index: 0, notes: resultText.slice(0, 200) }]);
    updateTaskStatus(agentTask.id, 'complete', { finalSummary: resultText.slice(0, 500) });
    appendJournal(agentTask.id, { type: 'status_push', content: `Done: ${resultText.slice(0, 200)}` });

    return {
      agentId: agent.id,
      agentName: agent.name,
      success: true,
      result: resultText,
      durationMs: Date.now() - startMs,
      stepCount,
      providerUsed: resolved.providerId,
    };
  } catch (err: any) {
    console.error(`${label} Failed: ${err?.message}`);
    updateTaskStatus(agentTask.id, 'failed', { finalSummary: String(err?.message ?? err).slice(0, 500) });
    appendJournal(agentTask.id, { type: 'status_push', content: `Failed: ${String(err?.message ?? err).slice(0, 200)}` });
    return {
      agentId: agent.id,
      agentName: agent.name,
      success: false,
      result: '',
      error: String(err?.message ?? err),
      durationMs: Date.now() - startMs,
      stepCount,
      providerUsed: resolved.providerId,
    };
  } finally {
    if (resolved.isOllama) {
      releaseOllamaMutex();
      console.log(`${label} Released Ollama mutex`);
    }
  }
}

// ─── Parallel Spawn ───────────────────────────────────────────────────────────

/**
 * Spawns multiple agents and waits for all results.
 *
 * Cloud agents (openai, openai_codex, etc.) run as truly parallel concurrent
 * API calls — each is a completely independent HTTP request with its own
 * context, prompt, and response. They do NOT block each other or the user's
 * active chat session.
 *
 * Ollama agents are serialized automatically via the mutex even when called
 * through this parallel API — they will queue behind each other.
 */
export async function spawnAgentsParallel(
  tasks: Array<Omit<SpawnOptions, 'onStep'>>,
  onResult?: (result: SpawnResult) => void,
): Promise<SpawnResult[]> {
  const results = await Promise.allSettled(
    tasks.map(t =>
      spawnAgent(t).then((r) => {
        onResult?.(r);
        return r;
      }),
    ),
  );
  return results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : {
          agentId: 'unknown',
          agentName: 'unknown',
          success: false,
          result: '',
          error: String((r as any).reason?.message ?? r),
          durationMs: 0,
        },
  );
}

// ─── Pipeline Spawn ───────────────────────────────────────────────────────────

/**
 * Spawns multiple agents sequentially, passing each result to the next.
 * Use this for pipeline workflows: research → write → review.
 */
export async function spawnAgentsPipeline(
  stages: Array<{
    agentId: string;
    taskBuilder: (previousResult: string) => string;
    maxSteps?: number;
    agentType?: string;
  }>,
): Promise<SpawnResult[]> {
  const results: SpawnResult[] = [];
  let lastResult = '';

  for (const stage of stages) {
    const task = stage.taskBuilder(lastResult);
    const result = await spawnAgent({
      agentId: stage.agentId,
      task,
      maxSteps: stage.maxSteps,
      agentType: stage.agentType,
      context: lastResult ? `Previous stage output:\n${lastResult}` : undefined,
    });
    results.push(result);
    lastResult = result.result;
    if (!result.success) break; // stop pipeline on failure
  }

  return results;
}
