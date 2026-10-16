import { buildRealtimeVoiceAgentTools } from './realtime';
import { getMCPManager } from '../../../mcp-manager';
import {
  router as tasksRouter,
  initTasksRouter,
  makeBroadcastForTask,
} from '../.././tasks.router';
import {
  initTaskRouter,
  latestTaskForSession,
  findBlockedTaskForSession,
  findClarificationWaitingTask,
  isResumeIntent, isRerunIntent, isCancelIntent,
  isStatusQuestion, isTaskListIntent, isAdjustmentIntent,
  getLatestPauseContext, summarizeTaskRecord, buildBlockedTaskStatusMessage,
  parseTaskStatusFilter, getTaskScopeBuckets, parseTaskIdFromText,
  launchBackgroundTaskRunner, handleTaskControlAction,
  handleTaskRecoveryMessage,
  renderTaskCandidatesForHuman, tryHandleBlockedTaskFollowup,
} from '../../../tasks/task-router';
import {
  router as teamsRouter,
  initTeamsRouter,
  pauseManagedTeamInternal,
  resumeManagedTeamInternal,
  buildTeamDispatchContext,
  runTeamAgentViaChat,
} from '../.././teams.router';
import { bindTeamNotificationTargetFromSession } from './dependencies';
import { sanitizeAgentId, normalizeAgentsForSave } from '../../../agents/agent-normalize';
import { runInteractiveTurn } from './dependencies';
import { handleChat } from './dependencies';
import {
  // Core exports
  buildTools,
  executeTool,
  _dispatchToAgent,
  initChatHelpers,
  buildPersonalityContext,
  // Stats / maps
  getOrchestrationSessionStats,
  orchestrationSessionStats,
  recordOrchestrationEvent,
  ensureMultiAgentSkill,
  getPreemptSessionCount,
  incrementPreemptSessionCount,
  // Types
  type SubagentProfile,
  type HandleChatResult,
  type RuntimeProgressItem,
  // Skills
  resolveSkillsDir,
  configuredSkillsDir,
  fallbackSkillsDir,
  syncMissingSkills,
  migrateSkillsStateIfMissing,
  // Progress
  prettifyToolName,
  buildProgressItems,
  // Tool call helpers
  logToolCall,
  isBrowserToolName,
  isDesktopToolName,
  isDesktopVisualToolName,
  buildBrowserAck,
  wrapUntrustedBrowserToolContent,
  buildDesktopAck,
  buildDesktopScreenshotContent,
  buildVisionScreenshotMessage,
  // Chat intent classifiers
  isExecutionLikeRequest,
  isContinuationCue,
  hasPendingExecutionIntent,
  isHardBlockerReply,
  hasConcreteCompletion,
  autoActivateToolCategories,
  // File helpers
  isHighStakesFile,
  requestedFullTemplate,
  resolveWorkspaceFilePath,
  collectFileSnapshots,
  // Browser quality
  goalIsInteractiveAction,
  isBrowserHeavyResearchPage,
  goalLikelyNeedsTextInput,
  parseSnapshotDiagnostics,
  evaluateBrowserSnapshotQuality,
} from '../../../chat/chat-helpers';
import {
	  buildTools as _buildTools,
	  getToolCategory,
	  isSchemaHiddenCompatToolName,
	  type BuildToolsDeps,
  type ToolResult,
  type TaskControlResponse,
  type ScheduleJobAction,
  normalizeScheduleJobAction,
  summarizeCronJob,
  normalizeDeliveryChannel,
  normalizeToolArgsForTool,
  parseJsonLike,
  toStringRecord,
  parseLooseMap,
} from '../../../tool-builder';
import { evaluateToolDispatch, resolveIdleRoundLimit, resolveToolSurfaceEnforcementMode, toolNameSetOf, type ToolDispatchDecision } from '../../../chat/tool-dispatch-policy';
import { getRuntimeToolCategoryIds } from '../../../../runtime/tool-category-manifest';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../../config/config';
import { isPublicDistributionBuild } from '../../../../runtime/distribution.js';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import { getRuntimeToolCategories as getVoiceRuntimeToolCategories } from '../../../tool-builder';
import { voiceToolResult } from './tool-helpers';
import { buildVoiceToolDefinitions } from './tool-definitions';
import { _cronScheduler, _telegramChannel, _skillsManager } from './dependencies';


// ─── Unified Prometheus tools for voice ─────────────────────────────────────
// The realtime model (gpt-realtime / Grok / Codex AVAS) gets ONE gateway
// function instead of the full schema set, so the realtime session stays small
// and fast. It lists/describes/calls the exact same tool surface main chat has
// for this session (same activated categories, same executeTool, same approval
// queue and policy engine), so voice and chat never drift apart.
export const VOICE_PROMETHEUS_TOOL_BLOCKLIST = new Set([
  // Need an interactive chat turn/plan state that voice does not have.
  'declare_plan', 'complete_plan_step', 'ask_prometheus_questions', 'await_prometheus_question_response',
  'switch_model', 'set_current_model', 'request_browser_login', 'request_final_action_approval',
  // Voice already owns these with dedicated realtime-safe tools.
  'prometheus_tools',
]);
export const VOICE_PROMETHEUS_TOOL_TIMEOUT_MS = 45_000;
export const VOICE_PROMETHEUS_RESULT_MAX_CHARS = 6000;

export function voicePrometheusToolName(tool: any): string {
  return String(tool?.function?.name || tool?.name || '').trim();
}

export function voicePrometheusToolSurface(sessionId: string): any[] {
  let tools: any[] = [];
  try { tools = buildTools(sessionId) as any[]; } catch { tools = []; }
  return tools.filter((tool) => {
    const name = voicePrometheusToolName(tool);
    return name && !VOICE_PROMETHEUS_TOOL_BLOCKLIST.has(name);
  });
}

export function voicePrometheusToolSummary(tool: any): string {
  const description = String(tool?.function?.description || tool?.description || '').replace(/\s+/g, ' ').trim();
  const firstSentence = description.split(/(?<=[.!?])\s/)[0] || description;
  return `${voicePrometheusToolName(tool)}: ${firstSentence.slice(0, 180)}`;
}

export function buildVoicePrometheusToolsDefinition(): any {
  return {
    type: 'function',
    name: 'prometheus_tools',
    description: [
      'Use the full Prometheus tool set (the same tools main chat has): files, shell, git, web, memory, connectors (GitHub, Gmail, Drive, Vercel, X), agents/background spawns, automations, media generation, and more.',
      'action=list shows the currently active tools and the inactive categories; action=describe returns exact parameter schemas for named tools; action=call runs one tool; action=activate_category unlocks a category (e.g. workspace_write, browser_automation, agents_and_teams, media_generation, external_apps).',
      'Prefer your dedicated voice_* / show_* tools for quick voice actions and voice_thread_ops for long multi-step work; use this for any single concrete Prometheus action they do not cover.',
      'Always describe a tool once before the first call if you are unsure of its arguments. Risky actions still go through the normal Prometheus approval queue.',
    ].join(' '),
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'describe', 'call', 'activate_category'] },
        tool: { type: 'string', description: 'For call: exact tool name from list.' },
        tools: { type: 'array', items: { type: 'string' }, description: 'For describe: tool names to fetch schemas for (max 6).' },
        args: { type: 'object', description: 'For call: the tool arguments, matching the described schema.', additionalProperties: true },
        category: { type: 'string', description: 'For activate_category: category id.' },
        query: { type: 'string', description: 'For list: optional filter text.' },
      },
      additionalProperties: false,
    },
  };
}

export function buildVoicePrometheusExecuteDeps(sessionId: string, trace: string[]): any {
  return {
    cronScheduler: _cronScheduler,
    handleChat,
    runInteractiveTurn,
    telegramChannel: _telegramChannel,
    skillsManager: _skillsManager,
    sanitizeAgentId,
    normalizeAgentsForSave,
    buildTeamDispatchContext,
    runTeamAgentViaChat,
    bindTeamNotificationTargetFromSession,
    pauseManagedTeamInternal,
    resumeManagedTeamInternal,
    handleTaskControlAction,
    makeBroadcastForTask,
    sendSSE: (event: string, data: any) => {
      if (trace.length >= 40) return;
      const text = typeof data?.message === 'string' ? data.message : '';
      if (text) trace.push(`${event}: ${text.slice(0, 200)}`);
    },
    toolCallId: `voice_${sessionId}_${Date.now().toString(36)}`,
    supportsDirectMediaObservation: false,
  };
}

export let voiceKnownToolNames: { at: number; names: Set<string> } | null = null;
export function isKnownVoiceRuntimeTool(name: string): boolean {
  if (!name) return false;
  if (isSchemaHiddenCompatToolName(name) || name.startsWith('mcp__')) return true;
  if (!voiceKnownToolNames || Date.now() - voiceKnownToolNames.at > 60_000) {
    let names = new Set<string>();
    try {
      names = toolNameSetOf(_buildTools({ getMCPManager }, new Set<string>(getRuntimeToolCategoryIds().map(String)), { allowNativeWorkspaceTools: true }));
    } catch { /* fall through to the catalog */ }
    voiceKnownToolNames = { at: Date.now(), names };
  }
  if (voiceKnownToolNames.names.has(name)) return true;
  try {
    const { buildToolCatalog } = require('../../../tool-search');
    return (buildToolCatalog() as Array<{ name: string }>).some((entry) => entry?.name === name);
  } catch {
    return false;
  }
}

/** Dispatch policy for voice tool calls: same rules as handleChat's evaluateTurnToolDispatch. */
export function evaluateVoiceToolDispatch(sessionId: string, toolName: string, rawArguments: unknown, offered: ReadonlySet<string>): ToolDispatchDecision {
  const runtimeCategoryIds = new Set<string>(getRuntimeToolCategoryIds().map(String));
  return evaluateToolDispatch({
    name: toolName,
    rawArguments,
    offered,
    mode: resolveToolSurfaceEnforcementMode(getConfig().getConfig(), { publicBuild: isPublicDistributionBuild() }),
    restricted: false,
    isKnownTool: isKnownVoiceRuntimeTool,
    categoryOf: (name) => {
      const category = getToolCategory(name);
      return category && runtimeCategoryIds.has(String(category)) ? String(category) : null;
    },
    isCategoryActive: (category) => getActivatedToolCategories(sessionId).has(category),
  });
}

/** Test seam: voice tool entry points, used by the replay mediation scenarios. */
export const __voiceToolEntryForTesting = {
  call: (sessionId: string, tool: string, args: Record<string, any> = {}) => executeVoiceCoreTool(sessionId, tool, args),
  prometheusTools: (sessionId: string, args: Record<string, any>) => executeVoicePrometheusTools(sessionId, args),
};

export async function executeVoicePrometheusTools(sessionId: string, args: Record<string, any>): Promise<string> {
  const action = String(args?.action || '').trim().toLowerCase();
  const workspacePath = getConfig().getWorkspacePath();
  const surface = voicePrometheusToolSurface(sessionId);
  const byName = new Map(surface.map((tool) => [voicePrometheusToolName(tool), tool]));
  const activeCategories = Array.from(getActivatedToolCategories(sessionId)).sort();
  const allCategories = (() => { try { return getVoiceRuntimeToolCategories().map(String); } catch { return [] as string[]; } })();
  const inactiveCategories = allCategories.filter((category) => !activeCategories.includes(category));

  if (action === 'list' || !action) {
    const query = String(args?.query || '').trim().toLowerCase();
    const rows = surface
      .filter((tool) => !query || JSON.stringify(tool).toLowerCase().includes(query))
      .map(voicePrometheusToolSummary);
    return voiceToolResult(true, `${rows.length} Prometheus tools active.`, {
      tools: rows,
      activeCategories,
      inactiveCategories,
      hint: 'describe a tool before calling it; activate_category to unlock more tools.',
    });
  }

  if (action === 'describe') {
    const names = (Array.isArray(args?.tools) ? args.tools : [args?.tool]).map((n: any) => String(n || '').trim()).filter(Boolean).slice(0, 6);
    if (!names.length) return voiceToolResult(false, 'describe needs tools: [names].');
    const described = names.map((name: string) => {
      const tool = byName.get(name);
      if (!tool) return { name, available: false };
      return {
        name,
        available: true,
        description: String(tool?.function?.description || tool?.description || '').slice(0, 1200),
        parameters: tool?.function?.parameters || tool?.parameters || {},
      };
    });
    const missing = described.filter((d: any) => !d.available).map((d: any) => d.name);
    return voiceToolResult(true, missing.length ? `Not active: ${missing.join(', ')}. Use list or activate_category.` : 'Schemas loaded.', { tools: described });
  }

  if (action === 'activate_category') {
    const category = String(args?.category || '').trim();
    if (!category) return voiceToolResult(false, 'activate_category needs category.', { inactiveCategories });
    const result = await executeTool('request_tool_category', { category, scope: 'ttl', turns: 6 }, workspacePath, buildVoicePrometheusExecuteDeps(sessionId, []), sessionId);
    const after = voicePrometheusToolSurface(sessionId).map(voicePrometheusToolName);
    const added = after.filter((name) => !byName.has(name));
    return voiceToolResult(!result.error, String(result.result || '').slice(0, 600), { newTools: added.slice(0, 60) });
  }

  if (action === 'call') {
    const toolName = String(args?.tool || '').trim();
    if (!toolName) return voiceToolResult(false, 'call needs tool.');
    if (VOICE_PROMETHEUS_TOOL_BLOCKLIST.has(toolName)) return voiceToolResult(false, `${toolName} is not available from voice.`);
    if (!byName.has(toolName) && args?.bypassSurfaceCheck !== true) {
      return voiceToolResult(false, `${toolName} is not in the active tool surface. Call list, or activate_category first.`, { inactiveCategories });
    }
    // Same dispatch policy as the turn loop. The direct voice path skips the
    // list check above (Codex voice keeps a fixed function list), so this is the
    // gate that stops unknown tools and tools from inactive categories.
    const voiceDecision = evaluateVoiceToolDispatch(sessionId, toolName, args?.args, new Set(byName.keys()));
    if (!voiceDecision.ok) {
      console.warn(`[voice] DISPATCH REFUSED (${voiceDecision.code}): ${toolName}`);
      return voiceToolResult(false, voiceDecision.message, { inactiveCategories, dispatchRefused: voiceDecision.code });
    }
    const toolArgs = args?.args && typeof args.args === 'object' ? args.args : {};
    const trace: string[] = [];
    const run = executeTool(toolName, toolArgs, workspacePath, buildVoicePrometheusExecuteDeps(sessionId, trace), sessionId);
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), VOICE_PROMETHEUS_TOOL_TIMEOUT_MS); });
    const outcome = await Promise.race([run, timeout]);
    if (timer) clearTimeout(timer);
    if (outcome === 'timeout') {
      run.catch(() => {});
      return voiceToolResult(true, `${toolName} is still running (it may be waiting for approval in the Prometheus app). It will keep going in the background.`, { pending: true });
    }
    const resultText = typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result ?? '');
    return voiceToolResult(!outcome.error, outcome.error ? `${toolName} failed.` : `${toolName} done.`, {
      tool: toolName,
      result: resultText.length > VOICE_PROMETHEUS_RESULT_MAX_CHARS
        ? `${resultText.slice(0, VOICE_PROMETHEUS_RESULT_MAX_CHARS)}\n[truncated ${resultText.length - VOICE_PROMETHEUS_RESULT_MAX_CHARS} chars]`
        : resultText,
      ...(trace.length ? { progress: trace.slice(-8) } : {}),
    });
  }

  return voiceToolResult(false, `Unknown prometheus_tools action: ${action}. Use list, describe, call, or activate_category.`);
}

// ─── Voice = Prometheus core tools ───────────────────────────────────────────
// The main realtime voice agent gets the SAME core tool set main chat has
// (buildTools for this session, incl. request_tool_category / tool_search /
// tool_call and any activated categories). Voice-only tools stay for things
// core has no equivalent for (threads, live browser/desktop wrappers, quiet
// mode, cards). Voice aliases that duplicate a core tool are dropped.
export const VOICE_TOOLS_SUPERSEDED_BY_CORE = new Set([
  'voice_web_search', 'voice_web_fetch', 'voice_write_note', 'voice_memory_search', 'voice_send_screenshot',
  'voice_browser_screenshot', 'voice_browser_open', 'voice_browser_scroll', 'voice_browser_snapshot', 'voice_browser_click',
  'voice_browser_vision_click', 'voice_browser_fill', 'voice_browser_type', 'voice_browser_vision_type', 'voice_browser_press_key',
  'voice_browser_wait', 'voice_desktop_screenshot', 'voice_desktop_click', 'voice_desktop_window_control', 'voice_desktop_focus_window',
  'voice_desktop_launch_app', 'voice_desktop_find_app', 'voice_desktop_list_windows', 'voice_desktop_window_click',
  'voice_desktop_window_type', 'voice_desktop_window_press_key', 'voice_desktop_window_scroll',
  'show_weather', 'show_market', 'show_stocks', 'show_prediction_market', 'show_map', 'show_sources', 'show_comparison',
  'show_chart', 'show_product_carousel', 'show_agent_work', 'show_run_result',
  'show_card_currency', 'show_card_clock', 'show_card_news', 'show_card_gallery', 'show_card_video', 'show_card_sports',
  'show_card_places', 'show_card_product',
]);
// Core tools voice already covers with a voice-aware version.
export const VOICE_CORE_TOOLS_SHADOWED = new Set(['skill_list', 'skill_read', 'timer', 'show_ui_card']);
export const VOICE_EXTRA_TOOL_NAMES = ['voice_thread_ops', 'restart_gateway_quick', 'steer_active_worker', 'interrupt_active_worker', 'voice_room_handoff', 'prometheus_tools'];
export let voiceOwnToolNamesCache: Set<string> | null = null;
export function voiceOwnToolNames(): Set<string> {
  if (!voiceOwnToolNamesCache) {
    voiceOwnToolNamesCache = new Set([
      ...buildVoiceToolDefinitions().map((tool: any) => String(tool?.function?.name || tool?.name || '')),
      ...VOICE_EXTRA_TOOL_NAMES,
    ].filter(Boolean));
  }
  return voiceOwnToolNamesCache;
}

export function voiceCoreToolSurface(sessionId: string): any[] {
  return voicePrometheusToolSurface(sessionId).filter((tool) => !VOICE_CORE_TOOLS_SHADOWED.has(voicePrometheusToolName(tool)));
}

export function toRealtimeFunctionTool(tool: any): any {
  return {
    type: 'function',
    name: voicePrometheusToolName(tool),
    description: String(tool?.function?.description || tool?.description || '').slice(0, 1800),
    parameters: tool?.function?.parameters || tool?.parameters || { type: 'object', properties: {} },
  };
}

export function voiceCoreSurfaceSignature(sessionId: string): string {
  return voiceCoreToolSurface(sessionId).map(voicePrometheusToolName).sort().join(',');
}

export async function executeVoiceCoreTool(sessionId: string, name: string, rawArgs: Record<string, any>): Promise<string> {
  const { voiceTarget: _vt, contextPacket: _cp, ...args } = rawArgs || {};
  // Voice has no turn boundary of its own, while main-chat turns on the same
  // session clear turn-scoped categories. Keep voice activations alive for a
  // bounded number of turns unless the model explicitly asked for session.
  if (name === 'request_tool_category' && String((args as any).scope || 'turn') === 'turn') {
    (args as any).scope = 'ttl';
    (args as any).turns = Math.max(6, Number((args as any).turns || 0) || 0);
  }
  const before = voiceCoreSurfaceSignature(sessionId);
  const raw = await executeVoicePrometheusTools(sessionId, { action: 'call', tool: name, args, bypassSurfaceCheck: true });
  const after = voiceCoreSurfaceSignature(sessionId);
  if (before === after) return raw;
  // The tool changed the active surface (request_tool_category, auto
  // activation...). Hand the client a refreshed list to hot-swap into the
  // live realtime session so the new tools are callable on the next step.
  try {
    const parsed = JSON.parse(raw);
    parsed.runtimeAction = 'refresh_tools';
    parsed.realtimeTools = buildRealtimeVoiceAgentTools(undefined, null, sessionId);
    parsed.newTools = parsed.realtimeTools
      .map((tool: any) => String(tool?.name || ''))
      .filter((toolName: string) => toolName && !before.split(',').includes(toolName) && voiceCoreToolSurface(sessionId).some((t) => voicePrometheusToolName(t) === toolName))
      .slice(0, 60);
    parsed.note = 'New tools are active now. If they appear in your function list, call them directly. If they do not (Codex voice keeps a fixed list for the call), call them right away with prometheus_tools action=call, tool=<name>, args={...}; use action=describe first if unsure of arguments.';
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}
