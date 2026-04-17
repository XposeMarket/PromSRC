import { getAgentById, ensureAgentWorkspace, getConfig } from '../config/config.js';
import { ensureTeamAgentIdentity } from '../gateway/teams/team-workspace.js';
import { getOllamaClient } from './ollama-client.js';
import { buildProviderById } from '../providers/factory.js';
import { parseAgentModelString, ProviderReactorClient } from './provider-reactor.js';
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
    const typeDefaults = cfg.agent_model_defaults || {};
    // Use the supplied agentType, or fall back to 'subagent' as the sensible default
    const typeKey = agentType || 'subagent';
    // Check role-specific key first (e.g. subagent_researcher), then generic subagent
    const roleTypeKey = (agent as any).roleType ? `subagent_${(agent as any).roleType}` : null;
    const defaultModel: string | undefined =
      (roleTypeKey && typeDefaults[roleTypeKey]) || typeDefaults[typeKey] || typeDefaults['subagent'];

    if (defaultModel && defaultModel.trim()) {
      const defaultParsed = parseAgentModelString(defaultModel.trim());
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
  // Team dispatches pass the team workspace here. Standalone one-off subagents
  // run with the full main workspace so they can read/edit normal project files;
  // their private subagent workspace is guidance for their own artifacts only.
  const workspacePath = options.workspacePath || mainWorkspacePath;
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
    : `\n\n[Workspace rules]\nYou have full main-chat-equivalent runtime and tool access. You may read, edit, and modify files anywhere in the main workspace when the task requires it.\n\nYou are also assigned as a one-off subagent with a private artifact workspace. Put your own outputs, notes, logs, scratch files, and memory updates in that subagent workspace by default so your work stays separated from main chat and other agents. Do not treat this as a restriction on editing project files.\nMain workspace: ${workspacePath}\nSubagent artifact workspace: ${agentOwnWorkspace}`;
  const taskMessageBase = options.context
    ? `${options.task}\n\n[Context from orchestrator]\n${options.context}${workspaceGuidance}`
    : `${options.task}${workspaceGuidance}`;
  const taskMessage = selfLearnSuffix ? `${taskMessageBase}${selfLearnSuffix}` : taskMessageBase;

  const resolved = resolveAgentProvider(agent, options.agentType);
  const label = `[agent:${agent.id}@${resolved.providerId}]`;

  console.log(`${label} Spawning — provider=${resolved.providerId} isOllama=${resolved.isOllama} model=${resolved.model || '(global)'} agentType=${options.agentType || 'subagent'}`);

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
    const resultText = await runWithWorkspace(workspacePath, runAgent);

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
