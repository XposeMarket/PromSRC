import { handleDefaultTool } from './handlers/default-tools';
import { getOperationLedger, isExternalSideEffect } from '../operation-ledger';
import { createWorkspaceHelpers } from './workspace-helpers';
import { normalizeDevSourceWrapperTool, isWorkspacePrometheusSourceCopyPath, normalizeWorkspaceWrapperTool, normalizeBrowserWrapperTool, normalizeExternalAppWrapperTool, normalizeAgentTeamWrapperTool, isPlainObjectArg, normalizeCreativeWrapperTool, normalizeMediaGenerateWrapperTool, normalizePromRepoOpsWrapperTool, normalizeBackgroundOpsWrapperTool, normalizeSkillOpsWrapperTool } from './wrapper-normalizers';
export { normalizeTypeScriptModule, validateSourceSyntaxBeforeWrite, rejectInvalidSourceEdit, inferDevSourceSurface, normalizeDevSourceFileArg, normalizeDevSourcePathArg, normalizeDevSourceWrapperTool, normalizeWorkspacePatchOp, positiveNumberArg, hasNonEmptyValue, copyIfPresent, compactWorkspaceReadArgs, compactWorkspaceGrepArgs, compactWorkspaceBatchReadArgs, compactWorkspaceEditArgs, inferWorkspacePatchOp, coerceBatchFileList, normalizeWorkspacePatchsetArgs, isWorkspacePrometheusSourceCopyPath, normalizeWorkspaceWrapperTool, normalizeBrowserWrapperTool, copyVercelWrapperAlias, normalizeVercelWrapperRecord, normalizeVercelWrapperArgs, normalizeExternalAppWrapperTool, TEAM_GOAL_SUBACTIONS, normalizeAgentTeamWrapperTool, isPlainObjectArg, firstNonEmptyString, normalizeCreativeImageSourceCandidate, normalizeCreativeAssetIdCandidate, normalizeCreativeWrapperArgs, resolveCreativeToolSource, normalizeCreativeWrapperTool, normalizeMediaGenerateWrapperTool, normalizePromRepoOpsWrapperTool, normalizeBackgroundOpsWrapperTool, normalizeSkillOpsWrapperTool, collectDeliveryFilePaths } from './wrapper-normalizers';
import { handleSchedulingTool } from './handlers/scheduling';
import { handleWebTool } from './handlers/web';
import { handleMemoryTool } from './handlers/memory';
import { handleExistingTool } from './handlers/creative-controls';
import { handleDeliveryTool } from './handlers/delivery';
import { handleWorkspaceTool } from './handlers/workspace';
import { handleAgentsTool } from './handlers/agents';
import { handleMiscTool } from './handlers/misc';
import '../tool-result-model-context';
import { handleCreativeTool } from './handlers/creative';
import { handleBrowserDesktopTool } from './handlers/browser-desktop';
// src/gateway/subagent-executor.ts
// Tool execution engine — extracted from server-v2.ts (Step 14.1, Phase 3).
// Restored and adapted for dep-injected execution.

import fs from 'fs';
import 'os';
import path from 'path';
import 'child_process';
import { looksLikeNativeFileToolBypass } from './native-file-tool-bypass';
import '../terminal-service';
import 'crypto';
import { resolveRuntimeBinary } from '../../runtime/dependencies';
import '../../runtime/supervisor-restart-request';
import { getConfig, getAgentById } from '../../config/config';
import '../../config/main-chat-route.js';
import '../../agents/model-routing.js';
import '../../providers/factory.js';
import { getPolicyEngine } from '../policy';
import { shouldBypassGenericToolApproval } from '../tool-approval-mode';
import '../tool-category-request';
import './capabilities/skills-executor';
import { appendAuditEntry } from '../audit-log';
import '../../tools/web';
import { enrichProductArtifactItems, enrichSourceArtifactItems, executeShoppingSearchProducts } from '../../tools/web';
import { isUsableProductArtifactItem, normalizeProductArtifactItems, normalizeSourceArtifactItems } from '../rich-artifacts';
import { executeMarketLookup } from '../../tools/market';
import { executeWeatherLookup } from '../../tools/weather';
import { executeMapLookup } from '../../tools/mapcard';
import { executeStockLookup } from '../../tools/stocks';
import { executePolymarketLookup } from '../../tools/polymarket';
import '../../tools/agent-control';
import '../../tools/download-tools';
import '../../tools/media-analysis';
import '../../tools/generate-image';
import '../../tools/generate-video';
import '../../tools/workspace-context';
import '../../tools/workspace-boundary';
import '../../tools/json-edit-guard';
import '../../workspace-history';
import '../../tools/file-intelligence';
import '../workspace-search';
import '../mcp-manager';
import '../process/supervisor';
import '../process/elevated-command';
import '../coding/terminal-change-tracker';
import '../prom-repo-sync';
import '../tool-observations';
import '../generated-image-preview';
import '../dev-source-patchset';
import './agent-builder-integration';
import { validateDirectSubagentAssignment } from './subagent-manager';
import './subagent-chat-store';
import '../intraday-note-source';
import { getResourceStore, redactResourceText } from '../resources/resource-store';
import '../creative/generative-pipeline';
import { addSocialCutReceipt, applyCreativeSequenceOperations, createCreativeSequence, createCreativeSequenceVariant, inspectCreativeSequence, loadCreativeSequence, saveCreativeSequence, selectCreativeSequenceComposition, type CreativeSequenceDoc, type CreativeSequenceOperation } from '../creative/sequence';
import { qaCreativeSequenceExport } from '../creative/sequence-qa';
import { renderComposition } from '../creative/renderers/composition_renderer';
import '../scheduled-output-guard';
import { listManagedTeams, getManagedTeam, appendTeamChat, queueAgentMessage } from '../teams/managed-teams';
import './entity-delete';
import '../teams/team-manager-runner';
import { parseTeamMemberDirectSessionId, parseTeamMemberRoomSessionId, runTeamMemberRoomTurn } from '../teams/team-member-room';
import '../teams/team-event-router';
import '../teams/team-workspace';
import '../teams/notify-bridge';
import '../../scheduler';
import '../scheduling/schedule-pattern';
import { getSessionChannelHint } from '../comms/broadcaster';
import '../session';

const getTeamDispatchRuntime = () => require('../teams/team-dispatch-runtime') as typeof import('../teams/team-dispatch-runtime');
export const getBgAgentResults = () => getTeamDispatchRuntime()._bgAgentResults;
export const buildTeamDispatchTaskLazy: typeof import('../teams/team-dispatch-runtime')['buildTeamDispatchTask'] = (...args) => {
  const { buildTeamDispatchTask } = getTeamDispatchRuntime();
  return buildTeamDispatchTask(...args);
};

export function normalizeScheduleToolSkillIds(value: any): string[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((id: any) => String(id || '').trim())
      .filter(Boolean)
  ));
}

export function normalizeScheduleToolContextRefs(value: any, existing: any[] = []): any[] {
  if (!Array.isArray(value)) return [];
  const existingById = new Map((Array.isArray(existing) ? existing : []).map((ref: any) => [String(ref?.id || ''), ref]));
  const now = Date.now();
  return value.map((raw: any) => {
    const title = String(raw?.title || '').trim().slice(0, 160);
    const content = String(raw?.content || '').trim().slice(0, 12000);
    if (!title || !content) return null;
    const id = String(raw?.id || `ref_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`).trim();
    const prior = existingById.get(id) || {};
    return {
      id,
      title,
      content,
      createdAt: Number(raw?.createdAt || raw?.created_at || prior?.createdAt || now) || now,
      updatedAt: Number(raw?.updatedAt || raw?.updated_at || now) || now,
    };
  }).filter(Boolean);
}
import { browserVisionScreenshot, getBrowserSessionInfo, getBrowserSessionMetadata, waitForBrowserControlRelease } from '../browser-tools';
import '../desktop-tools';
import { normalizeDesktopWrapperTool } from '../desktop-wrappers';
import { isDesktopCancellationError } from '../desktop-cancellation';
import '../delivery-router';
import '../delivery-screenshot.js';
import '../memory-index/index';
import '../memory-index/search-worker-client';
// import { runDesktopTask } from '../tasks/desktop-task-runner'; // removed — module deleted
import '../tasks/task-runner';
import '../tasks/spawn-tool-categories-arg';
import './background-work-dir';
import '../site-shortcuts';
import '../../tools/deploy-analysis-team.js';
import '../../tools/social-scraper.js';
import { type ToolResult, type TaskControlResponse } from '../tool-builder';
import { addCreativeReferences, getCanvasProjectRoot, getCreativeReferences } from '../session';
import { sendCreativeCommand } from '../creative/command-bus';
import type { HyperframesPatchOp } from '../creative/hyperframes-bridge';
import '../creative/html-motion-templates';
import '../creative/html-motion-spec';
import '../creative/pretext-measure';
import '../creative/html-motion-blocks';
import '../creative/custom-registries';
import '../tool-builder';
import '../tool-result-envelope';
import { attachCodeEvidenceToToolResult } from '../code-evidence';
import { finalizeDevEditMutation, prepareDevEditMutation, type PreparedDevEditMutation } from '../dev-edit-ledger';
import { ensurePrometheusExtensionRuntimeLoaded } from '../../extensions/extension-bootstrap';
import '../process/command-outcome';
import { getExtensionRuntimeRegistry, resolveConnectorWrapperCall } from '../../extensions/runtime-registry';
import { appendJournal, createTask, findTaskBySessionId, getEvidenceBusSnapshot, loadTask, setTaskStepRunning, updateTaskStatus, type TaskRecord, type TaskStatus, type TaskSummary } from '../tasks/task-store';
import '../scheduling/schedule-agent';
import { bindTaskRunToSession, getTaskRunBinding } from '../tasks/task-run-mirror';
import type { SkillWindow } from '../prompt-context';
import { isToolHiddenInPublicBuild, resolvePrometheusRoot } from '../../runtime/distribution.js';
import { isTerminalFirstWorkspaceMode } from '../../runtime/workspace-tool-mode.js';
import { getApprovalQueue, serializeApprovalForClient } from '../verification-flow.js';
// Registers durable dev-apply timeout/rejection handling even in lean gateway
// startup paths that have not loaded the HTTP approval routes yet.
import '../approval-actions.js';
import '../prometheus-questions.js';
import { findCommandPermissionGrant, type ToolPermissionCandidate } from '../command-permissions';
import '../path-permissions';
import { evaluateHardToolDeny, formatHardToolDeny, type HardToolDenyDecision, type ToolExecutionPolicy } from '../tool-deny-policy';
import { DEV_SRC_SELF_EDIT_MODE, DEV_SRC_SELF_EDIT_REPAIR_MODE } from '../proposals/dev-src-self-edit.js';
import { getDevSourceEditGrant } from '../dev-source-approvals.js';
import '../dev-edit-coordinator.js';
import '../dev-verification.js';
import '../final-action-approvals.js';
import '../timers/timer-store';
import '../internal-watch/internal-watch-store';
import '../internal-watch/internal-watch-runner';
import '../scheduling/schedule-admin-tools';
import { executeRegisteredCapabilityTool } from './capabilities/registry';
import '../business/entity-store';
import '../brain/brain-proposal-policy.js';
import { normalizeChartSeriesArgs } from '../tools/core-tool-normalizers.js';

export const getCreativeMotionRuntime = () => require('../creative/motion-runtime') as typeof import('../creative/motion-runtime');
export const getCreativeAssets = () => require('../creative/assets') as typeof import('../creative/assets');
export const getCreativeLayerExtraction = () => require('../creative/layer-extraction') as typeof import('../creative/layer-extraction');
export const getCreativeModelPaths = () => require('../creative/onnx/model-paths') as typeof import('../creative/onnx/model-paths');
export const getCreativeAsciiRenderRuntime = () => require('../creative/ascii-render-runtime') as typeof import('../creative/ascii-render-runtime');
export const getHyperframesCatalog = () => require('../creative/hyperframes-catalog') as typeof import('../creative/hyperframes-catalog');
export const getHyperframesBridge = () => require('../creative/hyperframes-bridge') as typeof import('../creative/hyperframes-bridge');
export const getHyperframesExportAdapter = () => require('../creative/hyperframes-export-adapter') as typeof import('../creative/hyperframes-export-adapter');
export const getHyperframesQa = () => require('../creative/hyperframes-qa') as typeof import('../creative/hyperframes-qa');
export const getHyperframesProducer = () => require('../creative/hyperframes-producer') as typeof import('../creative/hyperframes-producer');

export const FILE_TOOL_DEFAULT_READ_LINES = 180;
export const FILE_TOOL_DEFAULT_BATCH_FILES = 2;
export const FILE_TOOL_MAX_BATCH_FILES = 8;
export const FILE_TOOL_DEFAULT_BATCH_LINES = 80;
export const FILE_TOOL_MAX_BATCH_LINES = 240;
export const FILE_TOOL_DEFAULT_TREE_DEPTH = 2;
export const FILE_TOOL_DEFAULT_TREE_ENTRIES = 180;
const FILE_TOOL_MAX_LINE_CHARS = 700;
export const FILE_TOOL_BATCH_INLINE_LIMIT_CHARS = 6000;
export const FILE_TOOL_READ_INLINE_LIMIT_CHARS = 12000;
export const FILE_TOOL_TREE_INLINE_LIMIT_CHARS = 8000;

export function hasProvidedArg(args: Record<string, any>, key: string): boolean {
  return args[key] !== undefined && args[key] !== null && args[key] !== '';
}

export function trimReturnedFileLine(line: string, maxChars = FILE_TOOL_MAX_LINE_CHARS): string {
  const value = String(line ?? '').replace(/\r$/, '');
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...[line truncated]`;
}

export const VIDEO_MODE_REMOVED_SCENE_TOOL_NAMES = new Set([
  'creative_apply_ops',
  'creative_add_element',
  'creative_add_asset',
  'creative_add_effect',
  'creative_set_blend_mode',
  'creative_add_mask',
  'creative_trim_clip',
  'creative_set_canvas',
  'creative_apply_brand_kit',
  'creative_search_animations',
  'creative_update_element',
  'creative_delete_element',
  'creative_apply_animation',
  'creative_arrange',
  'creative_apply_style',
  'creative_fit_asset',
  'creative_apply_template',
]);

export function videoModeHtmlMotionOnlyError(name: string, args: any = {}): ToolResult {
  return {
    name,
    args,
    result:
      `${name}: scene-graph/shape animation tools have been removed from Video mode. ` +
      'Use HTML Motion, HyperFrames, Remotion motion templates, and Pretext QA tools instead.',
    error: true,
  };
}

export function isLegacySceneGraphCompositionPayload(args: any): boolean {
  const lane = String(args?.lane || '').trim().toLowerCase();
  const sourceKind = String(args?.source?.kind || '').trim().toLowerCase();
  return lane === 'scene-graph' || sourceKind === 'scene-graph' || (!lane && !sourceKind);
}

export interface ExecuteToolDeps {
  cronScheduler: any;
  broadcastWS: (data: any) => void;
  sendSSE?: (event: string, data: any) => void;
  /** The caller attaches media visuals after the tool result, before model continuation. */
  supportsDirectMediaObservation?: boolean;
  handleChat: (...args: any[]) => Promise<any>;
  runInteractiveTurn?: (...args: any[]) => Promise<any>;
  /** Used only by the hidden persistent thread-supervision runtime. */
  threadOpsOwnerSessionId?: string;
  /** Used only by the hidden persistent thread-supervision runtime. */
  threadOpsSupervisionId?: string;
  telegramChannel: any;
  dispatchToAgent: (agentId: string, message: string, context: string | undefined, parentSessionId: string) => Promise<{ task_id: string; agent_id: string; status: string }>;
  sanitizeAgentId: (value: any) => string;
  normalizeAgentsForSave: (agents: any[]) => any[];
  buildTeamDispatchContext: (teamId: string, agentId: string, baseTask: string, extraContext?: string) => string;
  runTeamAgentViaChat: (agentId: string, task: string, teamId: string) => Promise<any>;
  broadcastTeamEvent: (data: any) => void;
  bindTeamNotificationTargetFromSession: (teamId: string, sessionId: string, source: string) => void;
  pauseManagedTeamInternal: (teamId: string, reason?: string) => any;
  resumeManagedTeamInternal: (teamId: string) => any;
  handleTaskControlAction: (sessionId: string, args: any) => Promise<TaskControlResponse>;
  isWindows: boolean;
  SAFE_COMMANDS: Record<string, string>;
  BLOCKED_PATTERNS: string[];
  hasUriScheme: (input: string) => boolean;
  buildUrlOpenCommand: (url: string) => string;
  buildBrowserLaunchCommand: (app: string, url: string) => string;
  normalizeWorkspacePathAliases: (rawCmd: string, workspacePath: string) => string;
  isAllowedShellCommand: (command: string) => boolean;
  runCommandCaptured: (command: string, cwd: string, timeoutMs?: number, options?: { shell?: string; pty?: boolean; approvalId?: string; sessionId?: string; toolCallId?: string; workspacePath?: string; trackWorkspaceChanges?: boolean; yieldTimeMs?: number; onOutput?: (event: { runId: string; stream: 'stdout' | 'stderr' | 'combined'; chunk: string; sequence: number }) => void }) => Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean; reason?: string; signal?: NodeJS.Signals | number | null; noOutputTimedOut?: boolean; runId?: string; yielded?: boolean; workspacePath?: string; workspaceChanges?: Array<Record<string, unknown>>; workspaceSnapshots?: Array<Record<string, unknown>>; workspaceChangeSource?: 'terminal'; workspaceChangesTruncated?: boolean }>;
  toolCallId?: string;
  skillsManager: any;
  getSessionSkillWindows: (sessionId: string) => Map<string, SkillWindow>;
  sessionCurrentTurn: Map<string, number>;
  executionPolicy?: ToolExecutionPolicy;
  onHardToolDeny?: (event: { sessionId: string; toolName: string; args: any; decision: HardToolDenyDecision }) => void;
  /** Set only for a private internal-watch delivery; enforced by automation tools. */
  internalWatchContext?: {
    watchId: string;
    actionPolicy: 'review_only' | 'recover_same_run' | 'full_rerun_allowed';
    targetTaskId?: string;
    delivery: 'follow_up' | 'live_steer';
  };
  /** Cooperative interruption for long-running desktop waits, macros, capture,
   * and background-worker commands. */
  abortSignal?: { aborted: boolean; signal?: AbortSignal };
  /** Numeric/category-only runtime timing hook owned by the enclosing turn. */
  onPerformanceStage?: (
    stage: string,
    fields?: Record<string, number | string | boolean>,
  ) => void;
}


/**
 * Match a blocked command invocation, not a vocabulary word.
 *
 * Patterns previously had their whitespace stripped, so a multi-token entry
 * could never match and the list had to use bare words like "format". That
 * rejected legitimate work whenever the word appeared in a commit message,
 * a -Pattern argument, or ordinary prose. A multi-word entry is now matched as
 * an ordered token sequence, so "format c:" blocks `format c:` and
 * `format /fs:ntfs c:` while leaving "output format" alone.
 */
export function commandContainsBlockedPattern(command: string, blockedPatterns: string[] | undefined): string | null {
  const cmd = String(command || '').toLowerCase();
  const boundary = '(?:^|[\\s;&|()])';
  const endBoundary = '(?:$|[\\s;&|()])';
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const rawBlocked of blockedPatterns || []) {
    const blocked = String(rawBlocked || '').trim().toLowerCase();
    if (!blocked) continue;
    const parts = blocked.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    // Allow intervening flags between tokens: "format /fs:ntfs c:" still hits
    // the "format c:" entry, while unrelated prose does not.
    const sequence = parts.map(escape).join('(?:[\\s]+[^\\s;&|()]+){0,3}?[\\s]+');
    const pattern = parts.length === 1
      ? `${boundary}${sequence}${endBoundary}`
      : `${boundary}${sequence}`;
    if (new RegExp(pattern, 'i').test(cmd)) {
      return blocked;
    }
  }
  return null;
}

export async function maybeSendCreativeExportToTelegram(sessionId: string, creativeResult: any, telegramChannel: any): Promise<void> {
  if (!telegramChannel) return;
  const hint = getSessionChannelHint(sessionId);
  if (hint?.channel !== 'telegram' || !hint.chatId) return;
  const exportInfo = creativeResult?.export && typeof creativeResult.export === 'object'
    ? creativeResult.export
    : creativeResult;
  const rawExportPath = String(exportInfo?.absPath || exportInfo?.workspacePath || exportInfo?.path || '').trim();
  const exportPath = rawExportPath && path.isAbsolute(rawExportPath)
    ? rawExportPath
    : rawExportPath
      ? path.resolve(getConfig().getWorkspacePath(), rawExportPath)
      : '';
  if (!exportPath || !fs.existsSync(exportPath) || !fs.statSync(exportPath).isFile()) return;
  const format = String(creativeResult?.format || exportInfo?.format || path.extname(exportPath).replace(/^\./, '') || 'export').toUpperCase();
  const caption = `Prometheus creative export (${format})`;
  if (typeof telegramChannel.sendFileToChat === 'function') {
    try {
      await telegramChannel.sendFileToChat(Number(hint.chatId), exportPath, caption, { forceDocument: true });
      return;
    } catch (err: any) {
      console.warn(`[Telegram] Creative export upload failed; sending path fallback: ${err?.message || err}`);
    }
  }
  if (typeof telegramChannel.sendMessage === 'function') {
    await telegramChannel.sendMessage(Number(hint.chatId), `${caption}\n${exportPath}`);
  }
}

// Track last-used filename per session for when model forgets to pass it.
export const lastFilenameUsed = new Map<string, string>();

export const devServerProcesses = new Map<string, {
  child: any;
  name: string;
  command: string;
  cwd: string;
  startedAt: number;
  output: string[];
  exitCode?: number | null;
}>();

const BROWSER_CONTROL_GATED_TOOLS = new Set([
  'browser_open',
  'browser_click',
  'browser_fill',
  'browser_upload_file',
  'browser_press_key',
  'browser_key',
  'browser_type',
  'browser_wait',
  'browser_scroll',
  'browser_drag',
  'browser_click_and_download',
  'browser_close',
  'browser_vision_click',
  'browser_vision_type',
  'browser_scroll_collect',
  'browser_scroll_collect_v2',
  'browser_run_js',
  'browser_element_watch',
]);

export function loadBusinessContextSnapshot(workspacePath: string, maxChars: number = 4000): string {
  try {
    const businessPath = path.join(workspacePath, 'BUSINESS.md');
    if (!fs.existsSync(businessPath)) return '';
    const content = fs.readFileSync(businessPath, 'utf-8').trim();
    if (content.length <= maxChars) return content;
    return `${content.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...[truncated]`;
  } catch {
    return '';
  }
}

export function sanitizeCreativeStorageSegment(raw: string, fallback = 'default'): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

export function buildCreativeStorageForTool(workspacePath: string, sessionId: string): {
  workspacePath: string;
  rootAbsPath: string;
  rootRelPath: string;
  creativeDir: string;
} {
  const configuredWorkspace = getConfig().getWorkspacePath() || workspacePath;
  const rootAbsPath = getCanvasProjectRoot(sessionId)
    || path.join(configuredWorkspace, 'creative-projects', sanitizeCreativeStorageSegment(sessionId, 'default'));
  const creativeDir = path.join(rootAbsPath, 'prometheus-creative');
  fs.mkdirSync(creativeDir, { recursive: true });
  const rootRelPath = (() => {
    const rel = path.relative(configuredWorkspace, rootAbsPath).replace(/\\/g, '/');
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : rootAbsPath.replace(/\\/g, '/');
  })();
  return { workspacePath: configuredWorkspace, rootAbsPath, rootRelPath, creativeDir };
}

export function buildCreativeWorkspaceRelativePath(workspacePath: string, absPath: string): string {
  const rel = path.relative(workspacePath, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : absPath.replace(/\\/g, '/');
}

export function resolveWorkspaceFilePath(workspacePath: string, rawPath: string): string {
  const requested = String(rawPath || '').trim();
  if (!requested) throw new Error('path is required');
  const absPath = path.resolve(path.isAbsolute(requested) ? requested : path.join(workspacePath, requested));
  const rel = path.relative(workspacePath, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path must stay inside the workspace.');
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`file not found: ${requested}`);
  }
  return absPath;
}

export function mergeHyperframesInputs(args: any = {}): Record<string, any> {
  const reserved = new Set([
    'catalogId',
    'catalog_id',
    'componentId',
    'component_id',
    'id',
    'html',
    'inputs',
    'input',
    'clipId',
    'clip_id',
    'elementId',
    'element_id',
    'layerId',
    'layer_id',
    'x',
    'y',
    'width',
    'height',
    'startMs',
    'start_ms',
    'durationMs',
    'duration_ms',
    'zIndex',
    'z_index',
    'advanced',
    'advancedBlock',
    'replaceScene',
    'force',
    'filename',
    'format',
    'samplePoints',
    'sample_points',
    'timeoutMs',
    'timeout_ms',
  ]);
  const topLevel = Object.fromEntries(Object.entries(args || {})
    .filter(([key, value]) => !reserved.has(key) && ['string', 'number', 'boolean'].includes(typeof value)));
  const explicit = args?.input && typeof args.input === 'object' && !Array.isArray(args.input) ? args.input : {};
  const plural = args?.inputs && typeof args.inputs === 'object' && !Array.isArray(args.inputs) ? args.inputs : {};
  return { ...topLevel, ...explicit, ...plural };
}

export function wrapHyperframesBlockAsDocument(rendered: any, options: any = {}) {
  const width = Math.max(1, Number(options?.width) || 1080);
  const height = Math.max(1, Number(options?.height) || 1920);
  const durationMs = Math.max(100, Number(options?.durationMs ?? options?.duration_ms) || 6000);
  const frameRate = Math.max(1, Number(options?.frameRate) || 60);
  const compositionId = sanitizeCreativeStorageSegment(
    options?.compositionId || rendered?.block?.id || 'hyperframes-block',
    'hyperframes-block',
  );
  return `<!doctype html>
<html data-composition-id="${compositionId}" data-composition-duration="${durationMs / 1000}" data-width="${width}" data-height="${height}">
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}
#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:transparent}
${String(rendered?.css || '')}
</style>
</head>
<body>
<main id="stage" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}" data-duration="${durationMs}ms" data-frame-rate="${frameRate}" data-role="stage" data-start="0ms" data-track-index="0">
${String(rendered?.html || '')}
</main>
${String(rendered?.js || '').trim() ? `<script>\n${String(rendered.js)}\n</script>` : ''}
</body>
</html>`;
}

export async function readSelectedHyperframesClipFromEditor(
  deps: ExecuteToolDeps,
  sessionId: string,
  creativeMode: string,
  clipId: string,
  toolName: string,
): Promise<{ clip: any; state: any }> {
  if (clipId) {
    await sendCreativeCommand(deps.broadcastWS, {
      sessionId,
      mode: creativeMode,
      command: 'select_element',
      payload: { id: clipId },
      timeoutMs: resolveCreativeEditorTimeoutMs('creative_select_element'),
    }).catch(() => undefined);
  }
  const state = await sendCreativeCommand(deps.broadcastWS, {
    sessionId,
    mode: creativeMode,
    command: 'get_state',
    payload: {},
    timeoutMs: resolveCreativeEditorTimeoutMs('creative_get_state'),
  });
  if (!state.success) {
    throw new Error(state.error || 'could not read creative editor state.');
  }
  let clip = (state as any).data?.selectedElement || (state as any).selectedElement || null;
  if (!clip || String(clip.type || '').toLowerCase() !== 'hyperframes') {
    const sceneElements = Array.isArray((state as any).data?.scene?.elements)
      ? (state as any).data.scene.elements
      : [];
    const hyperframesElements = sceneElements.filter((element: any) => String(element?.type || '').toLowerCase() === 'hyperframes');
    const fallbackId = clipId || (hyperframesElements.length === 1 ? String(hyperframesElements[0]?.id || '').trim() : '');
    if (fallbackId) {
      await sendCreativeCommand(deps.broadcastWS, {
        sessionId,
        mode: creativeMode,
        command: 'select_element',
        payload: { id: fallbackId },
        timeoutMs: resolveCreativeEditorTimeoutMs('creative_select_element'),
      }).catch(() => undefined);
      const refreshed = await sendCreativeCommand(deps.broadcastWS, {
        sessionId,
        mode: creativeMode,
        command: 'get_state',
        payload: {},
        timeoutMs: resolveCreativeEditorTimeoutMs('creative_get_state'),
      });
      if (refreshed.success) {
        const refreshedClip = (refreshed as any).data?.selectedElement || (refreshed as any).selectedElement || null;
        if (refreshedClip && String(refreshedClip.type || '').toLowerCase() === 'hyperframes') {
          clip = refreshedClip;
          (state as any).data = { ...((state as any).data || {}), recoveredSelectionId: fallbackId };
        }
      }
    }
    if ((!clip || String(clip.type || '').toLowerCase() !== 'hyperframes') && hyperframesElements.length > 1 && !clipId) {
      const ids = hyperframesElements.map((element: any) => element?.id).filter(Boolean).join(', ');
      throw new Error(`${toolName} found multiple HyperFrames clips; pass clipId. Available clip ids: ${ids}`);
    }
  }
  if (!clip || String(clip.type || '').toLowerCase() !== 'hyperframes') {
    throw new Error(`${toolName} requires a selected HyperFrames clip${clipId ? ` (${clipId})` : ''}.`);
  }
  if (!String(clip?.meta?.html || '').trim()) {
    throw new Error(`${toolName}: selected HyperFrames clip has no source HTML.`);
  }
  return { clip, state };
}

export async function patchHyperframesClipInEditor(input: {
  deps: ExecuteToolDeps;
  sessionId: string;
  creativeMode: string;
  clip: any;
  ops: HyperframesPatchOp[];
}) {
  const html = String(input.clip?.meta?.html || '');
  const patched = getHyperframesBridge().applyHyperframesPatch(html, input.ops);
  const extraction = getHyperframesBridge().extractHyperframesLayers(patched.html);
  const meta = {
    html: patched.html,
    layers: extraction.layers,
    variables: extraction.variables,
    slots: extraction.slots,
    variableBindings: extraction.variableBindings,
    advancedBlock: extraction.advancedBlock,
    durationMs: extraction.durationMs || Number(input.clip?.meta?.durationMs) || 6000,
    compositionId: extraction.compositionId || input.clip?.meta?.compositionId || '',
    dirty: true,
  };
  const updated = await sendCreativeCommand(input.deps.broadcastWS, {
    sessionId: input.sessionId,
    mode: input.creativeMode,
    command: 'update_element',
    payload: { id: input.clip.id, meta },
    timeoutMs: resolveCreativeEditorTimeoutMs('creative_update_element'),
  });
  if (!updated.success) {
    throw new Error(updated.error || 'could not update HyperFrames clip in the creative editor.');
  }
  return { patched, extraction, updated };
}

function extractXStatusId(raw: any): string | null {
  const text = String(raw || '').trim();
  const match = text.match(/\/status\/(\d+)/i);
  return match?.[1] || (/^\d{8,}$/.test(text) ? text : null);
}

export function registerCreativeReferencesFromXPayload(sessionId: string, payload: any): number {
  const report = payload?.x_media;
  const files = Array.isArray(report?.downloaded_files) ? report.downloaded_files : [];
  if (!files.length) return 0;
  const analyses = new Map<string, any>(
    (Array.isArray(report?.analyses) ? report.analyses : [])
      .map((item: any) => [String(item?.rel_path || ''), item])
      .filter((entry: any[]) => !!entry[0]),
  );
  const tweets = Array.isArray(payload?.tweets) ? payload.tweets : [];
  const primaryTweetId = extractXStatusId(payload?.url);
  const primaryTweet = tweets.find((tweet: any) => String(tweet?.id || '') === primaryTweetId) || tweets[0] || null;
  const primaryHandle = String(primaryTweet?.handle || '').replace(/^@/, '').toLowerCase();
  const tweetById = new Map<string, any>(tweets.map((tweet: any) => [String(tweet?.id || ''), tweet]));

  const references = files.map((file: any) => {
    const relPath = String(file?.rel_path || '').trim();
    const analysis = analyses.get(relPath);
    const sourceTweetId = String(file?.source_tweet_id || extractXStatusId(file?.source_tweet_link) || '').trim();
    const sourceTweet = tweetById.get(sourceTweetId);
    const sourceHandle = String(sourceTweet?.handle || '').replace(/^@/, '').toLowerCase();
    const authority = sourceTweetId && primaryTweetId && sourceTweetId === primaryTweetId
      ? 'primary'
      : (primaryHandle && sourceHandle && primaryHandle === sourceHandle ? 'supporting' : 'low');
    const kind = ['image', 'video', 'audio'].includes(String(file?.kind || '').toLowerCase())
      ? String(file.kind).toLowerCase()
      : 'other';
    return {
      sourceUrl: String(file?.url || payload?.url || '').trim() || null,
      sourceType: 'x_post' as const,
      sourceTweetId: sourceTweetId || null,
      sourceTweetLink: String(file?.source_tweet_link || '').trim() || null,
      authority: authority as any,
      intent: 'mixed' as const,
      kind: kind as any,
      path: relPath || null,
      absPath: file?.path ? String(file.path) : null,
      selectedFrames: Array.isArray(analysis?.sample_frames)
        ? analysis.sample_frames.map((frame: any) => String(frame || '').trim()).filter(Boolean)
        : (kind === 'image' && relPath ? [relPath] : []),
      analysis: analysis?.analysis ? String(analysis.analysis) : null,
      transcript: analysis?.transcript ? String(analysis.transcript) : null,
      note: `Auto-saved from web_fetch media extraction for ${payload?.url || file?.url || 'X media'}.`,
    };
  });
  const before = getCreativeReferences(sessionId).length;
  addCreativeReferences(sessionId, references);
  return Math.max(0, getCreativeReferences(sessionId).length - before);
}

export function firstDownloadedMediaFile(toolResult: any): any | null {
  const files = Array.isArray((toolResult as any)?.data?.files) ? (toolResult as any).data.files : [];
  return files.find((file: any) => file?.path || file?.rel_path) || null;
}

export function normalizeCreativeAudioTags(input: any): string[] {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const tags = raw.map((tag) => String(tag || '').trim()).filter(Boolean);
  return [...new Set(['audio', 'background-music', ...tags])];
}

export function ensureCreativeLocalWorkspacePath(workspacePath: string, rawSource: string): string {
  const source = String(rawSource || '').trim();
  if (!source) throw new Error('source is required');
  const absPath = path.resolve(path.isAbsolute(source) ? source : path.join(workspacePath, source));
  const rel = path.relative(workspacePath, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('source must stay inside the workspace.');
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`source file not found: ${source}`);
  }
  return absPath;
}

export function inferCreativeLocalMediaKind(absPath: string): 'audio' | 'video' | 'unknown' {
  const ext = path.extname(absPath).toLowerCase();
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) return 'audio';
  if (['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm'].includes(ext)) return 'video';
  return 'unknown';
}

export async function extractCreativeAudioFromVideo(sourceAbsPath: string, outputDir: string): Promise<string> {
  fs.mkdirSync(outputDir, { recursive: true });
  const stem = path.basename(sourceAbsPath, path.extname(sourceAbsPath))
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'extracted-audio';
  let outputPath = path.join(outputDir, `${stem}.mp3`);
  let suffix = 2;
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(outputDir, `${stem}-${suffix}.mp3`);
    suffix += 1;
  }
  await new Promise<void>((resolve, reject) => {
    const { execFile } = require('child_process');
    execFile(resolveRuntimeBinary('ffmpeg', { allowPathFallback: true }), [
      '-y',
      '-i', sourceAbsPath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-q:a', '2',
      outputPath,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 * 8 }, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
  if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).isFile()) {
    throw new Error('FFmpeg completed but no extracted audio file was produced.');
  }
  return outputPath;
}

export function resolveCreativeEditorTimeoutMs(toolName: string, args?: any): number {
  if (toolName === 'creative_export' || toolName === 'creative_export_html_motion_clip') return 720000;
  if (toolName === 'creative_attach_audio_from_url' || toolName === 'creative_attach_audio_from_file') return 120000;
  if (['creative_download_audio', 'creative_generate_voiceover', 'creative_transcribe_audio', 'creative_mix_audio_tracks', 'creative_extract_audio_from_video'].includes(toolName)) return 180000;
  if (toolName === 'creative_create_html_motion_clip') return 60000;
  // State is also the bridge readiness probe. Do not make callers wait the old
  // generic 30 seconds merely to learn that a connected websocket is not an
  // active Creative editor.
  if (toolName === 'creative_get_state') return 4000;
  if (toolName === 'creative_set_canvas' || toolName === 'creative_apply_motion_template') return 45000;
  if (toolName === 'creative_render_snapshot' || toolName === 'creative_render_html_motion_snapshot') {
    const sampleCount = Array.isArray(args?.sampleTimesMs) && args.sampleTimesMs.length
      ? Math.min(12, args.sampleTimesMs.length)
      : (args?.sampleEveryFrame === true || Number(args?.frameStepMs) > 0 ? 12 : 3);
    return Math.max(90000, Math.min(240000, 30000 + sampleCount * 20000));
  }
  if (toolName === 'creative_search_icons' || toolName === 'creative_search_animations') return 30000;
  return 30000;
}

export function resolveBoundedToolTimeoutMs(args: any, fallbackMs: number, maxMs: number): number {
  const raw = Number(args?.timeout_ms ?? args?.timeoutMs ?? args?.timeout);
  if (!Number.isFinite(raw) || raw <= 0) return fallbackMs;
  return Math.max(5000, Math.min(maxMs, Math.round(raw)));
}

export async function withBoundedToolTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    (timer as any)?.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function inferAgentIdFromSession(sessionId: string, args: any): string | undefined {
  const sid = String(sessionId || '');
  if (!sid) return undefined;
  if (sid.startsWith('team_dispatch_')) {
    const stripped = sid.replace(/^team_dispatch_/, '');
    const idx = stripped.lastIndexOf('_');
    return idx > 0 ? stripped.slice(0, idx) : stripped;
  }
  if (sid.startsWith('proposal_')) return 'proposal_executor';
  if (sid.startsWith('code_exec')) return 'code_executor';
  if (sid.startsWith('cron_job_') || sid.startsWith('schedule_')) return 'scheduled_task';
  if (sid.startsWith('task_') || sid.startsWith('bg_')) return 'background_task';
  if (sid.startsWith('meta_coordinator_')) return 'meta_coordinator';
  if (sid.startsWith('team_coord_')) return 'team_coordinator';
  const argAgentId = String(args?.agent_id || args?.agentId || '').trim();
  if (argAgentId) return argAgentId;
  return sid === 'default' ? undefined : sid;
}

export function inferApprovalOrigin(sessionId: string, task: any, args: any): {
  originType: 'main_chat' | 'subagent' | 'background_task' | 'scheduled_task' | 'proposal' | 'unknown';
  originLabel: string;
} {
  const sid = String(sessionId || '');
  const argAgentId = String(args?.agent_id || args?.agentId || '').trim();
  if (sid.startsWith('proposal_') || sid.startsWith('code_exec') || isProposalExecutionSession(sid)) {
    return { originType: 'proposal', originLabel: 'Proposal' };
  }
  if (sid.startsWith('cron_job_') || sid.startsWith('schedule_') || task?.taskKind === 'scheduled' || task?.scheduleId) {
    const title = String(task?.title || task?.scheduleId || '').trim();
    return {
      originType: 'scheduled_task',
      originLabel: title ? `Scheduled Task (${title})` : 'Scheduled Task',
    };
  }
  const teamAgentName = String(task?.teamSubagent?.agentName || task?.teamSubagent?.agentId || '').trim();
  const subagentName = teamAgentName || String(task?.subagentProfile || argAgentId || '').trim();
  if (sid.startsWith('team_dispatch_') || task?.teamSubagent || task?.subagentProfile || task?.parentTaskId || sid.startsWith('subagent_')) {
    return {
      originType: 'subagent',
      originLabel: subagentName ? `Subagent (${subagentName})` : 'Subagent',
    };
  }
  if (sid.startsWith('task_') || sid.startsWith('bg_') || sid.startsWith('background_') || task?.taskKind === 'run_once') {
    const title = String(task?.title || '').trim();
    return {
      originType: 'background_task',
      originLabel: title ? `Background Task (${title})` : 'Background Task',
    };
  }
  if (sid === 'default' || sid.startsWith('telegram_') || sid.startsWith('chat_') || sid) {
    return { originType: 'main_chat', originLabel: 'Main Chat' };
  }
  return { originType: 'unknown', originLabel: 'Unknown' };
}

export function inferTeamNoteContext(sessionId: string): {
  teamId: string;
  authorType: 'manager' | 'subagent';
  authorId: string;
  conversationMode: 'manager' | 'member_room' | 'member_direct' | 'dispatch';
} | null {
  const sid = String(sessionId || '');
  if (sid.startsWith('team_coord_')) {
    const teamId = sid.replace(/^team_coord_/, '').trim();
    return teamId ? { teamId, authorType: 'manager', authorId: 'manager', conversationMode: 'manager' } : null;
  }
  if (sid.startsWith('team_dm_manager_')) {
    const match = sid.match(/^team_dm_manager_(.+?)___THREAD___(.+)$/);
    const teamId = String(match?.[1] || '').trim();
    return teamId ? { teamId, authorType: 'manager', authorId: 'manager', conversationMode: 'manager' } : null;
  }
  const roomSession = parseTeamMemberRoomSessionId(sid);
  if (roomSession) {
    return {
      teamId: roomSession.teamId,
      authorType: 'subagent',
      authorId: roomSession.agentId,
      conversationMode: 'member_room',
    };
  }
  const directSession = parseTeamMemberDirectSessionId(sid);
  if (directSession) {
    return {
      teamId: directSession.teamId,
      authorType: 'subagent',
      authorId: directSession.agentId,
      conversationMode: 'member_direct',
    };
  }
  if (sid.startsWith('team_dispatch_')) {
    const stripped = sid.replace(/^team_dispatch_/, '');
    const idx = stripped.lastIndexOf('_');
    const agentId = idx > 0 ? stripped.slice(0, idx) : stripped;
    const team = listManagedTeams().find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(agentId));
    if (team) return { teamId: team.id, authorType: 'subagent', authorId: agentId, conversationMode: 'dispatch' };
  }
  // Fallback: dispatched members can run under task/background session ids that
  // do not carry the team_dispatch_ prefix. The dispatch runtime always binds a
  // runtime actor with teamId + agentId, so use it. Without this, talk_to_manager,
  // talk_to_teammate and share_artifact failed with "only works inside a team
  // subagent session" for dispatched members (Teams Gauntlet 2026-10-06).
  try {
    const { getRuntimeActorContext } = require('../runtime-actor');
    const actor = getRuntimeActorContext(sid);
    const actorTeamId = String(actor?.teamId || '').trim();
    const actorAgentId = String(actor?.agentId || '').trim();
    if (actorTeamId && actorAgentId) {
      if (actor?.kind === 'manager') return { teamId: actorTeamId, authorType: 'manager', authorId: 'manager', conversationMode: 'manager' };
      const team = getManagedTeam(actorTeamId) as any;
      if (team && Array.isArray(team.subagentIds) && team.subagentIds.includes(actorAgentId)) {
        return { teamId: actorTeamId, authorType: 'subagent', authorId: actorAgentId, conversationMode: 'dispatch' };
      }
    }
  } catch { /* runtime actor lookup is best-effort */ }
  return null;
}

type MainAgentTeamRoute = {
  route: 'team' | 'member' | 'manager';
  targetLabel?: string;
  targetAgentId?: string;
  text: string;
};

function normalizeTeamRouteKey(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9]+/g, '');
}

function parseMainAgentTeamRoute(message: string): MainAgentTeamRoute {
  const raw = String(message || '').trim();
  const managerMatch = raw.match(/^\s*\[TO_MANAGER\]\s*/i);
  if (managerMatch) {
    return { route: 'manager', text: raw.slice(managerMatch[0].length).trim() || raw };
  }

  const askMatch = raw.match(/^\s*\[ASK_AGENT:([^\]]+)\]\s*/i);
  if (askMatch) {
    const targetLabel = String(askMatch[1] || '').trim();
    return {
      route: 'member',
      targetLabel,
      text: raw.slice(askMatch[0].length).trim() || raw,
    };
  }

  const broadcastMatch = raw.match(/^\s*\[BROADCAST_TO_TEAM\]\s*/i);
  if (broadcastMatch) {
    return { route: 'team', targetLabel: 'team', text: raw.slice(broadcastMatch[0].length).trim() || raw };
  }

  return { route: 'team', targetLabel: 'team', text: raw };
}

function resolveMainAgentTeamMemberId(team: any, label: string): string | null {
  const wanted = normalizeTeamRouteKey(label);
  if (!wanted) return null;
  for (const memberAgentId of Array.isArray(team?.subagentIds) ? team.subagentIds : []) {
    const agent = getAgentById(memberAgentId) as any;
    const candidates = [
      memberAgentId,
      agent?.id,
      agent?.name,
      agent?.teamRole,
      agent?.role,
      agent?.description,
    ];
    if (candidates.some((candidate) => normalizeTeamRouteKey(candidate) === wanted)) {
      return memberAgentId;
    }
  }
  return null;
}

function buildMainAgentTeamBroadcastPrompt(message: string): string {
  return [
    `[TEAM BROADCAST FROM MAIN AGENT]`,
    `The main Prometheus agent addressed @team:`,
    message,
    ``,
    `Reply once in the shared room. Be conversational and useful.`,
    `Do not start execution work unless the message explicitly asks for work to begin.`,
  ].join('\n');
}

function buildMainAgentDirectMemberPrompt(message: string, targetLabel: string): string {
  return [
    `[DIRECT TEAM MESSAGE FROM MAIN AGENT]`,
    `The main Prometheus agent addressed you (${targetLabel || 'this team member'}):`,
    message,
    ``,
    `Reply once in the shared room so the rest of the team can follow the exchange.`,
  ].join('\n');
}

async function deliverMainAgentMessageToTeamMembers(
  teamId: string,
  team: any,
  message: string,
  targetAgentId?: string,
  targetLabel?: string,
): Promise<{ deliveredCount: number; completedCount: number }> {
  const memberAgentIds = targetAgentId
    ? [targetAgentId]
    : (Array.isArray(team?.subagentIds) ? team.subagentIds : []).filter((memberAgentId: string) =>
        memberAgentId && team?.agentPauseStates?.[memberAgentId]?.paused !== true
      );

  for (const memberAgentId of memberAgentIds) {
    queueAgentMessage(
      teamId,
      memberAgentId,
      targetAgentId
        ? `[From Main Agent to ${targetLabel || memberAgentId}] ${message}`
        : `[From Main Agent to @team] ${message}`,
    );
  }

  const results = await Promise.allSettled(
    memberAgentIds.map((memberAgentId: string) =>
      runTeamMemberRoomTurn(
        teamId,
        memberAgentId,
        targetAgentId
          ? buildMainAgentDirectMemberPrompt(message, targetLabel || memberAgentId)
          : buildMainAgentTeamBroadcastPrompt(message),
        {
          autoWakeReason: targetAgentId
            ? 'The main agent addressed this member in the team room.'
            : 'The main agent addressed the whole team in the room.',
          autoWakeSource: 'manager_message',
        },
      )
    ),
  );

  return {
    deliveredCount: memberAgentIds.length,
    completedCount: results.filter((result) => result.status === 'fulfilled').length,
  };
}

function buildMainAgentMembersRespondedPrompt(
  message: string,
  deliveredCount: number,
  completedCount: number,
  targetLabel?: string,
): string {
  const audience = targetLabel ? `member "${targetLabel}"` : '@team';
  return [
    `[TEAM BROADCAST MEMBERS RESPONDED]`,
    `The main Prometheus agent addressed ${audience}. The system delivered the message to ${deliveredCount} unpaused member(s), and ${completedCount} member room turn(s) have settled.`,
    `Review the current team room messages before replying. The addressed members have already had their chance to answer, so do not call request_team_member_turn for this message and do not re-ask members to weigh in.`,
    `Reply last as the manager with a concise synthesis or acknowledgement if useful.`,
    ``,
    `[MAIN AGENT MESSAGE]`,
    message,
  ].join('\n');
}

export function appendAndBroadcastTeamChat(
  deps: ExecuteToolDeps,
  team: any,
  message: {
    from: 'manager' | 'subagent' | 'user';
    fromName: string;
    fromAgentId?: string;
    content: string;
    metadata?: Record<string, any>;
  },
) {
  const chatMsg = appendTeamChat(String(team?.id || ''), message);
  try {
    deps.broadcastTeamEvent?.({
      type: 'team_chat_message',
      teamId: team?.id,
      teamName: team?.name,
      chatMessage: chatMsg,
      text: String(chatMsg?.content || message.content || ''),
      message: String(chatMsg?.content || message.content || ''),
    });
  } catch {}
  return chatMsg;
}

export function getTeamChatTargetMetadata(targetAgentId: string) {
  const target = String(targetAgentId || '').trim();
  if (target === 'all') {
    return { targetType: 'team', targetId: 'all', targetLabel: 'team' };
  }
  if (target === 'manager') {
    return { targetType: 'manager', targetId: 'manager', targetLabel: 'manager' };
  }
  const targetAgent = getAgentById(target) as any;
  return {
    targetType: 'member',
    targetId: target,
    targetLabel: String(targetAgent?.name || target).trim(),
  };
}

export function clampAgentChatTimeoutMs(value: any, fallback = 300000): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1000, Math.min(1800000, Math.floor(n)));
}

export function getStandaloneSubagentChatSessionId(agentId: string): string {
  return `subagent_chat_${String(agentId || '').trim()}`;
}

export function getStandaloneSubagentForChat(agentId: string): { agent?: any; error?: string } {
  const cleanAgentId = String(agentId || '').trim();
  if (!cleanAgentId) return { error: 'agent_id is required' };
  const agent = getAgentById(cleanAgentId) as any;
  if (!agent) return { error: `Unknown subagent: ${cleanAgentId}. Call agent_list first.` };
  if (agent.default === true || cleanAgentId === 'main') {
    return { error: 'This tool is for standalone subagents, not the main/default agent.' };
  }
  const team = listManagedTeams().find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(cleanAgentId));
  if (team) {
    return { error: `Agent "${cleanAgentId}" belongs to team "${team.name}" (${team.id}). Use agent_message_send (or agent_chat_ops action "send") with target_type="team_member", team_id="${team.id}" and request_turn=true, or team dispatch.` };
  }
  return { agent };
}

const AGENT_RUN_VALID_STATUSES: TaskStatus[] = [
  'queued',
  'running',
  'paused',
  'stalled',
  'needs_assistance',
  'awaiting_user_input',
  'complete',
  'failed',
  'waiting_subagent',
];

const AGENT_RUN_RECOVERY_STATUSES: TaskStatus[] = [
  'needs_assistance',
  'stalled',
  'paused',
  'awaiting_user_input',
  'failed',
];

export function parseAgentRunStatusFilter(raw: any): TaskStatus[] | undefined {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === 'all' || text === '*') return undefined;
  if (/\b(recoverable|blocked|paused_or_failed)\b/.test(text)) return AGENT_RUN_RECOVERY_STATUSES;
  const valid = new Set<TaskStatus>(AGENT_RUN_VALID_STATUSES);
  const parsed = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part): part is TaskStatus => valid.has(part as TaskStatus));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : undefined;
}

export function inferAgentRunOwner(task: TaskRecord | TaskSummary | null | undefined): { agentId: string; ownerKind: 'standalone' | 'team_member' | 'team_manager'; teamId?: string; agentName?: string } | null {
  if (!task) return null;
  const standalone = String(task.subagentProfile || '').trim();
  if (standalone) {
    const agent = getAgentById(standalone) as any;
    return {
      agentId: standalone,
      ownerKind: 'standalone',
      agentName: String(agent?.name || standalone).trim(),
    };
  }
  const teamMember = String(task.teamSubagent?.agentId || '').trim();
  if (teamMember) {
    const agent = getAgentById(teamMember) as any;
    return {
      agentId: teamMember,
      ownerKind: 'team_member',
      teamId: String(task.teamSubagent?.teamId || '').trim() || undefined,
      agentName: String(task.teamSubagent?.agentName || agent?.name || teamMember).trim(),
    };
  }
  const proposalExecution = (task as any).proposalExecution?.teamExecution;
  const proposalExecutor = String((task as any).proposalExecutorAgentId || proposalExecution?.executorAgentId || '').trim();
  if (proposalExecutor) {
    const agent = getAgentById(proposalExecutor) as any;
    return {
      agentId: proposalExecutor,
      ownerKind: 'team_manager',
      teamId: String((task as any).proposalTeamId || proposalExecution?.teamId || '').trim() || undefined,
      agentName: String((task as any).proposalExecutorAgentName || proposalExecution?.executorAgentName || agent?.name || proposalExecutor).trim(),
    };
  }
  return null;
}

export function agentOwnsRunTask(agentId: string, task: TaskRecord | TaskSummary | null | undefined): boolean {
  const owner = inferAgentRunOwner(task);
  return !!owner && String(owner.agentId || '').trim() === String(agentId || '').trim();
}

export function agentRunCanRecover(task: TaskRecord | TaskSummary): boolean {
  const status = String(task.status || '').trim();
  if (!['needs_assistance', 'stalled', 'paused', 'awaiting_user_input', 'failed'].includes(status)) return false;
  return status !== 'paused' || task.pauseReason !== 'user_pause';
}

function normalizeAgentRunStep(step: any): Record<string, any> | null {
  if (!step || typeof step !== 'object') return null;
  return {
    index: Number.isFinite(Number(step.index)) ? Number(step.index) : undefined,
    description: String(step.description || '').slice(0, 500),
    status: step.status || null,
    completed_at: step.completedAt || null,
    completed_at_iso: step.completedAt ? new Date(step.completedAt).toISOString() : null,
    notes: step.notes ? String(step.notes).slice(0, 500) : undefined,
  };
}

function isTaskRunnerLive(taskId: string): boolean {
  try {
    const { BackgroundTaskRunner } = require('../tasks/background-task-runner') as typeof import('../tasks/background-task-runner');
    return BackgroundTaskRunner.isRunning(taskId);
  } catch {
    return false;
  }
}

function inferAgentRunRunnerState(task: TaskRecord | TaskSummary, liveRunnerActive: boolean): string {
  const status = String(task.status || '').trim();
  if (liveRunnerActive) return 'live_runner_active';
  if (status === 'running') return 'stale_running_no_live_runner';
  if (status === 'queued') return 'queued_waiting_for_runner';
  if (status === 'waiting_subagent') return 'waiting_on_child_subagent';
  if (agentRunCanRecover(task)) return 'blocked_recovery_available';
  if (status === 'complete') return 'complete';
  if (status === 'failed') return 'failed';
  return status || 'unknown';
}

export function summarizeAgentRunForTool(task: TaskRecord, agentIdHint?: string): Record<string, any> {
  const owner = inferAgentRunOwner(task);
  const agentId = String(agentIdHint || owner?.agentId || '').trim();
  const plan = Array.isArray(task.plan) ? task.plan : [];
  const done = plan.filter((step: any) => step?.status === 'done' || step?.status === 'skipped').length;
  const pendingSteps = plan.filter((step: any) => step?.status !== 'done' && step?.status !== 'skipped');
  const failedSteps = plan.filter((step: any) => step?.status === 'failed');
  const runningSteps = plan.filter((step: any) => step?.status === 'running');
  const currentStepIndex = Number.isFinite(Number(task.currentStepIndex)) ? Number(task.currentStepIndex) : 0;
  const activeStep = plan.find((step: any) => Number(step?.index) === currentStepIndex) || plan[currentStepIndex] || pendingSteps[0] || null;
  const latestJournal = Array.isArray(task.journal) ? task.journal[task.journal.length - 1] : null;
  const recoveryConversation = Array.isArray(task.recoveryConversation) ? task.recoveryConversation : [];
  const liveRunnerActive = isTaskRunnerLive(task.id);
  const lastToolCallAt = Number.isFinite(Number(task.lastToolCallAt)) ? Number(task.lastToolCallAt) : null;
  const now = Date.now();
  return {
    id: task.id,
    task_id: task.id,
    taskId: task.id,
    agent_id: agentId || owner?.agentId || null,
    agent_name: owner?.agentName || agentId || null,
    owner_kind: owner?.ownerKind || null,
    team_id: owner?.teamId || null,
    title: task.title || task.prompt || 'Task',
    prompt_preview: String(task.prompt || '').slice(0, 800),
    status: task.status,
    pause_reason: task.pauseReason || null,
    started_at: task.startedAt,
    started_at_iso: new Date(task.startedAt).toISOString(),
    completed_at: task.completedAt || null,
    completed_at_iso: task.completedAt ? new Date(task.completedAt).toISOString() : null,
    last_progress_at: task.lastProgressAt,
    last_progress_iso: new Date(task.lastProgressAt).toISOString(),
    last_progress_age_ms: Number.isFinite(Number(task.lastProgressAt)) ? Math.max(0, now - Number(task.lastProgressAt)) : null,
    current_step_index: currentStepIndex,
    step: Math.min(currentStepIndex + 1, Math.max(1, plan.length)),
    total_steps: Math.max(1, plan.length),
    completed_steps: done,
    pending_step_count: pendingSteps.length,
    failed_step_count: failedSteps.length,
    running_step_count: runningSteps.length,
    active_step: normalizeAgentRunStep(activeStep),
    unfinished_steps: pendingSteps.slice(0, 20).map(normalizeAgentRunStep).filter(Boolean),
    failed_steps: failedSteps.slice(0, 10).map(normalizeAgentRunStep).filter(Boolean),
    plan: plan.slice(0, 20),
    runtime_progress: task.runtimeProgress || null,
    last_tool_call: typeof task.lastToolCall === 'string' && task.lastToolCall.trim() ? task.lastToolCall : null,
    last_tool_call_at: lastToolCallAt,
    last_tool_call_at_iso: lastToolCallAt ? new Date(lastToolCallAt).toISOString() : null,
    last_tool_call_age_ms: lastToolCallAt ? Math.max(0, now - lastToolCallAt) : null,
    last_journal_event: latestJournal || null,
    live_runner_active: liveRunnerActive,
    runner_state: inferAgentRunRunnerState(task, liveRunnerActive),
    final_summary: task.finalSummary || '',
    result_preview: task.finalSummary || task.pauseAnalysis?.message || latestJournal?.content || '',
    pending_clarification_question: task.pendingClarificationQuestion || '',
    pause_analysis: task.pauseAnalysis || null,
    recovery_conversation_count: recoveryConversation.length,
    latest_recovery_at: recoveryConversation[recoveryConversation.length - 1]?.timestamp || null,
    can_recover: agentRunCanRecover(task),
    in_progress: ['queued', 'running', 'waiting_subagent'].includes(String(task.status || '')),
    source: task.taskKind || task.scheduleId ? 'schedule' : task.originatingSessionId ? 'handoff' : 'manual',
    session_id: task.sessionId,
    originating_session_id: task.originatingSessionId || null,
    executor_provider: task.executorProvider || null,
    executor_reasoning_effort: task.executorReasoningEffort || null,
    manager_enabled: task.managerEnabled === true,
  };
}

export function summarizeAgentRunCompact(task: TaskRecord, agentIdHint?: string): Record<string, any> {
  const full = summarizeAgentRunForTool(task, agentIdHint);
  const started = Number(task.startedAt || 0);
  const ended = Number(task.completedAt || Date.now());
  return {
    id: task.id,
    agent_id: full.agent_id,
    agent_name: full.agent_name,
    title: task.title || 'Task',
    status: task.status,
    elapsed_ms: started ? Math.max(0, ended - started) : null,
    current_step: full.active_step ? { index: full.current_step_index, title: full.active_step.title || full.active_step.description || String(full.active_step).slice(0, 160) } : null,
    progress: { completed: full.completed_steps, total: full.total_steps },
    last_issue: String(task.pauseAnalysis?.message || full.last_journal_event?.content || task.pauseReason || '').replace(/\s+/g, ' ').trim().slice(0, 240) || null,
    runner_state: full.runner_state,
    executor_provider: task.executorProvider || null,
    executor_reasoning_effort: task.executorReasoningEffort || null,
    can_recover: full.can_recover,
  };
}

export function buildAgentRunToolSnapshot(task: TaskRecord, agentIdHint?: string, opts?: { includeTask?: boolean; includeEvidence?: boolean }): Record<string, any> {
  const recoveryConversation = Array.isArray(task.recoveryConversation) ? task.recoveryConversation.slice(-20) : [];
  const journalTail = Array.isArray(task.journal) ? task.journal.slice(-20) : [];
  const evidence = opts?.includeEvidence === false ? null : getEvidenceBusSnapshot(task.id);
  const evidenceEntries = Array.isArray(evidence?.entries) ? evidence!.entries.slice(-40) : [];
  return {
    run: summarizeAgentRunForTool(task, agentIdHint),
    recovery_conversation: recoveryConversation,
    journal_tail: journalTail,
    evidence_bus: evidence
      ? {
          taskId: evidence.taskId,
          createdAt: evidence.createdAt,
          updatedAt: evidence.updatedAt,
          total_entries: Array.isArray(evidence.entries) ? evidence.entries.length : 0,
          entries: evidenceEntries,
        }
      : null,
    task: opts?.includeTask === true ? task : undefined,
  };
}

export function resolveAgentRunTaskForTool(agentIdRaw: any, taskIdRaw: any): { task?: TaskRecord; agentId?: string; error?: string; code?: string } {
  const agentId = String(agentIdRaw || '').trim();
  const taskId = String(taskIdRaw || '').trim();
  if (!taskId) return { error: 'task_id is required for this agent_run_ops action.', code: 'missing_task_id' };
  const task = loadTask(taskId);
  if (!task) return { error: `Task not found: ${taskId}`, code: 'not_found' };
  const owner = inferAgentRunOwner(task);
  if (!owner) {
    return {
      error: `Task "${taskId}" is not assigned to an agent. Use task_control for non-agent background tasks.`,
      code: 'not_agent_run',
    };
  }
  if (agentId && !agentOwnsRunTask(agentId, task)) {
    return {
      error: `Task "${taskId}" belongs to agent "${owner.agentId}", not "${agentId}".`,
      code: 'wrong_agent',
    };
  }
  return { task, agentId: agentId || owner.agentId };
}

export async function runStandaloneSubagentChatFromTool(params: {
  agentId: string;
  message: string;
  source: string;
  parentSessionId: string;
  timeoutMs?: number;
  userLabel?: string;
}): Promise<{ result: { type: string; text: string; thinking?: string }; historyEntry: any; messages: any[] }> {
  const { runSubagentChatTurnFromChannel } = require('../routes/channels.router') as typeof import('../routes/channels.router');
  return runSubagentChatTurnFromChannel({
    agentId: params.agentId,
    message: params.message,
    source: params.source,
    accountId: 'prometheus',
    peerId: params.parentSessionId,
    userLabel: params.userLabel || 'Main Agent',
    timeoutMs: params.timeoutMs,
    sessionId: getStandaloneSubagentChatSessionId(params.agentId),
    seedFromSharedChatStore: true,
  });
}

function normalizeAgentConversationBackgroundResult(result: any, agentId?: string, teamId?: string): any {
  if (result && typeof result === 'object' && typeof result.durationMs === 'number' && typeof result.agentName === 'string') {
    return result;
  }
  const text = String(
    result?.reply
    || result?.result
    || result?.message
    || (result ? JSON.stringify(result) : '')
  );
  return {
    success: result?.success !== false,
    result: text,
    error: result?.error,
    thinking: result?.thinking,
    durationMs: Number(result?.duration_ms || result?.durationMs || 0) || 0,
    stepCount: Number(result?.step_count || result?.stepCount || 0) || undefined,
    agentName: String(result?.agent_name || result?.agent_id || agentId || teamId || 'agent'),
    taskId: result?.task_id || result?.taskId,
    warning: result?.warning,
    admissionCode: result?.admissionCode || result?.admission_code,
  };
}

export function startAgentConversationBackground(params: {
  prefix: string;
  agentId?: string;
  teamId?: string;
  promiseFactory: () => Promise<any>;
}): string {
  const taskId = `${params.prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const promise = params.promiseFactory()
    .then((result) => {
      const normalized = normalizeAgentConversationBackgroundResult(result, params.agentId, params.teamId);
      const entry = getBgAgentResults().get(taskId);
      if (entry) {
        entry.status = normalized?.admissionCode
          ? 'capacity_limited'
          : normalized?.success === false ? 'failed' : 'complete';
        entry.result = normalized;
      }
      return normalized;
    })
    .catch((err: any) => {
      const result = {
        success: false,
        result: '',
        error: String(err?.message || err),
        durationMs: 0,
        agentName: String(params.agentId || params.teamId || 'agent'),
      };
      const entry = getBgAgentResults().get(taskId);
      if (entry) {
        entry.status = 'failed';
        entry.result = result;
      }
      return result;
    });
  getBgAgentResults().set(taskId, {
    status: 'running',
    agentId: String(params.agentId || params.teamId || 'agent'),
    teamId: String(params.teamId || params.agentId || 'standalone'),
    startedAt: Date.now(),
    promise,
  });
  return taskId;
}

/**
 * Resolve a teammate reference (id, display name, or a sloppy variant such as
 * "rhea", "tt_ reviewer", or a truncated id) to a real member id. Agents
 * naturally address teammates by display name; exact-id-only matching made
 * every such call fail (Teams Gauntlet 2026-10-06).
 */
export function resolveTeammateReference(team: any, raw: string): { ok: true; agentId: string } | { ok: false; error: string } {
  const ref = String(raw || '').trim();
  if (!ref) return { ok: false, error: 'talk_to_teammate requires agent_id (teammate id or display name) and message.' };
  const lower = ref.toLowerCase();
  if (lower === 'manager' || lower === 'all') return { ok: true, agentId: lower };
  const ids: string[] = Array.isArray(team?.subagentIds) ? team.subagentIds.map(String) : [];
  if (ids.includes(ref)) return { ok: true, agentId: ref };
  const squash = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = squash(ref);
  const candidates = ids.map((id) => {
    const agent = getAgentById(id) as any;
    return { id, name: String(agent?.name || '').trim() };
  });
  const exact = candidates.filter((c) => c.id.toLowerCase() === lower || (c.name && c.name.toLowerCase() === lower) || squash(c.id) === want || (c.name && squash(c.name) === want));
  if (exact.length === 1) return { ok: true, agentId: exact[0].id };
  const fuzzy = want.length >= 3
    ? candidates.filter((c) => squash(c.id).startsWith(want) || want.startsWith(squash(c.id).slice(0, Math.max(6, want.length - 8))) || (c.name && squash(c.name).startsWith(want)))
    : [];
  if (exact.length === 0 && fuzzy.length === 1) return { ok: true, agentId: fuzzy[0].id };
  const roster = candidates.map((c) => `${c.name || c.id} (${c.id})`).join(', ');
  return {
    ok: false,
    error: `${ref} ${exact.length + fuzzy.length > 1 ? 'matches more than one member' : 'is not a member'} of team "${team?.name || team?.id}". Members: ${roster}. Use "manager" or "all" for the manager or a broadcast.`,
  };
}

/** Accept share_artifact args flat or nested under artifact:{...}; derive name from path. */
export function normalizeShareArtifactArgs(args: any): { name: string; type: string; description: string; content?: string; path?: string } {
  const nested = args && typeof args.artifact === 'object' && args.artifact && !Array.isArray(args.artifact) ? args.artifact : {};
  const pick = (key: string) => (args?.[key] ?? nested?.[key]);
  const p = pick('path') ?? pick('file') ?? pick('filename');
  const pathStr = p != null ? String(p).trim() : '';
  let artifactName = String(pick('name') ?? pick('title') ?? '').trim();
  if (!artifactName && pathStr) artifactName = path.basename(pathStr.replace(/[\\/]+$/, '')) || pathStr;
  const content = pick('content') ?? pick('summary');
  return {
    name: artifactName,
    type: String(pick('type') || (pathStr ? 'file' : 'data')).trim(),
    description: String(pick('description') ?? '').trim(),
    content: content != null ? (typeof content === 'string' ? content : JSON.stringify(content)) : undefined,
    path: pathStr || undefined,
  };
}

/**
 * Team members cannot create proposals directly (the manager owns caps and
 * approval). Previously the call just returned BLOCKED; now the full proposal
 * payload is queued to the manager inbox and the manager is woken to submit it.
 */
export function routeMemberProposalToManager(deps: any, teamId: string, fromAgentId: string, args: any): { ok: boolean; message: string } {
  try {
    const title = String(args?.title || '').trim();
    const summary = String(args?.summary || '').trim();
    if (!title || !summary) {
      return { ok: false, message: 'ERROR: write_proposal from a team member still needs title and summary; it is forwarded to the manager for submission.' };
    }
    const payload: Record<string, any> = {};
    for (const key of ['type', 'execution_mode', 'priority', 'title', 'summary', 'details', 'affected_files', 'execution_steps', 'estimated_impact', 'risk_tier', 'requires_build', 'executor_prompt']) {
      if (args?.[key] !== undefined) payload[key] = args[key];
    }
    payload.executor_agent_id = String(args?.executor_agent_id || fromAgentId);
    const fromName = String((getAgentById(fromAgentId) as any)?.name || fromAgentId);
    const body = [
      `[PROPOSAL REQUEST from ${fromName}] Review this and, if sound, submit it with write_proposal (executor_agent_id is pre-filled).`,
      '```json',
      JSON.stringify(payload, null, 2).slice(0, 12000),
      '```',
    ].join('\n');
    const { queueManagerMessage } = require('../teams/managed-teams');
    const ok = queueManagerMessage(teamId, fromAgentId, body);
    if (!ok) return { ok: false, message: 'ERROR: Could not queue the proposal for the manager.' };
    try {
      const { scheduleTeamManagerAutoWake } = require('../teams/team-manager-autowake');
      scheduleTeamManagerAutoWake(teamId, `${fromName} submitted a proposal request.`);
    } catch { /* manager wake is best-effort */ }
    try {
      const chatMsg = appendTeamChat(teamId, { from: 'subagent', fromName, fromAgentId, content: `Proposal request sent to manager: ${title}` } as any);
      deps?.broadcastTeamEvent?.({ type: 'team_chat_message', teamId, chatMessage: chatMsg, text: chatMsg?.content || '' });
    } catch { /* non-fatal */ }
    return { ok: true, message: `Proposal "${title}" forwarded to the team manager, who submits proposals for this team. The manager has been woken; you do not need to resend it.` };
  } catch (err: any) {
    return { ok: false, message: `ERROR: proposal routing failed: ${err?.message || err}` };
  }
}

export function isProposalLikeSourceSessionId(sessionId: string): boolean {
  const sid = String(sessionId || '');
  return sid.startsWith('proposal_') || sid.startsWith('code_exec');
}

export function isProposalExecutionSession(sessionId: string): boolean {
  const sid = String(sessionId || '');
  if (!sid) return false;
  if (isProposalLikeSourceSessionId(sid)) return true;
  if (!sid.startsWith('task_')) return false;
  try {
    const taskId = sid.replace(/^task_/, '');
    const t = loadTask(taskId);
    return isProposalLikeSourceSessionId(String(t?.sessionId || ''));
  } catch {
    return false;
  }
}

const GENERIC_WORKSPACE_MUTATION_TOOLS = new Set([
  'create_file',
  'write_file',
  'append_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'delete_file',
  'rename_file',
  'copy_file',
  'move_file',
  'copy_directory',
  'move_directory',
  'apply_patch',
  'apply_patchset',
  'restore_snapshot',
  'revert_last_tool_change',
  'revert_own_patch',
  'git_branch',
  'git_commit',
  'git_push',
  'open_pr',
  'run_formatter',
  'format_changed_files',
  'mkdir',
]);

const SCOPED_WORKSPACE_FILE_MUTATION_TOOLS = new Set([
  'create_file',
  'write_file',
  'append_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'delete_file',
  'rename_file',
  'copy_file',
  'move_file',
  'copy_directory',
  'move_directory',
  'mkdir',
]);

export function resolveTaskForSession(sessionId: string) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  if (sid.startsWith('task_')) {
    try {
      return loadTask(sid.replace(/^task_/, ''));
    } catch {
      return null;
    }
  }
  try {
    return findTaskBySessionId(sid);
  } catch {
    return null;
  }
}

function shouldStartTeamStatusTaskMirror(phase: string, currentTask: string, blockedReason: string): boolean {
  const normalizedPhase = String(phase || '').trim().toLowerCase();
  const taskText = String(currentTask || '').trim();
  const blockedText = String(blockedReason || '').trim();
  if (!taskText && !blockedText) return false;
  if (['ready', 'idle', 'done', 'complete', 'completed', 'standby', 'standing_by'].includes(normalizedPhase)) {
    return false;
  }
  return [
    'executing',
    'running',
    'planning',
    'reviewing',
    'verifying',
    'checking',
    'working',
    'blocked',
    'waiting_for_context',
  ].includes(normalizedPhase) || !!taskText;
}

export function maybeStartTeamStatusTaskMirror(
  sessionId: string,
  deps: ExecuteToolDeps,
  noteContext: {
    teamId: string;
    authorId: string;
    conversationMode: 'manager' | 'member_room' | 'member_direct' | 'dispatch';
  },
  agentName: string,
  phase: string,
  currentTask: string,
  blockedReason: string,
): string | undefined {
  if (getTaskRunBinding(sessionId)?.taskId) return undefined;
  if (!shouldStartTeamStatusTaskMirror(phase, currentTask, blockedReason)) return undefined;

  const taskText = String(currentTask || blockedReason || 'Team member work').trim();
  const title = `${agentName || noteContext.authorId}: ${taskText.slice(0, 80)}`;
  const task = createTask({
    title,
    prompt: taskText,
    sessionId,
    channel: 'web',
    plan: [{
      index: 0,
      description: taskText.slice(0, 160) || title,
      status: 'pending',
    }],
    teamSubagent: {
      teamId: noteContext.teamId,
      agentId: noteContext.authorId,
      agentName,
    },
  });
  updateTaskStatus(task.id, 'running');
  setTaskStepRunning(task.id, 0);
  appendJournal(task.id, {
    type: 'status_push',
    content: `Task mirror started from update_my_status: ${String(phase || 'running')}${taskText ? ` | ${taskText}` : ''}`,
  });
  bindTaskRunToSession(sessionId, {
    taskId: task.id,
    source: 'team_status',
    teamId: noteContext.teamId,
    agentId: noteContext.authorId,
  });
  try {
    deps.broadcastWS?.({
      type: 'task_running',
      taskId: task.id,
      title,
      source: 'team_status',
      sessionId,
      teamId: noteContext.teamId,
      agentId: noteContext.authorId,
      agentName,
    });
    deps.broadcastWS?.({ type: 'task_panel_update', taskId: task.id, teamId: noteContext.teamId, agentId: noteContext.authorId });
    deps.broadcastTeamEvent?.({
      type: 'task_running',
      taskId: task.id,
      teamId: noteContext.teamId,
      agentId: noteContext.authorId,
      agentName,
      taskSummary: taskText,
      source: 'team_status',
      startedAt: task.startedAt,
    });
  } catch {}
  return task.id;
}

function getSourceVerificationCommandForSession(sessionId: string): string {
  const task = resolveTaskForSession(sessionId);
  const explicit = String(
    task?.proposalExecution?.canonicalBuildCommand
    || task?.proposalExecution?.repairContext?.canonicalBuildCommand
    || '',
  ).trim();
  if (explicit) return explicit;
  const mode = task?.proposalExecution?.mode;
  return mode === DEV_SRC_SELF_EDIT_MODE || mode === DEV_SRC_SELF_EDIT_REPAIR_MODE
    ? 'npm run build:backend'
    : 'npm run build';
}

export function getPromApplySurfacesForFiles(files: string[]): string[] {
  const surfaces = new Set<string>();
  for (const raw of files || []) {
    const file = String(raw || '').replace(/\\/g, '/').trim();
    if (file.startsWith('src/')) surfaces.add('backend');
    if (file.startsWith('web-ui/src/mobile/')) surfaces.add('mobile');
    else if (file.startsWith('web-ui/')) surfaces.add('web-ui');
  }
  return Array.from(surfaces);
}

export function formatPromApplyDevChangesInstruction(files: string[], reason: string, mode: 'verify_only' | 'apply_live' = 'apply_live', devEditId?: string): string {
  const surfaces = getPromApplySurfacesForFiles(files);
  const safeReason = String(reason || 'Approved Prometheus dev source edits').replace(/"/g, '\\"');
  const idPart = devEditId ? `, dev_edit_id:"${String(devEditId).replace(/"/g, '\\"')}"` : '';
  const filesPart = files.length ? `, affected_files:${JSON.stringify(files)}` : '';
  return `prom_apply_dev_changes({changed_surfaces:${JSON.stringify(surfaces.length ? surfaces : ['backend'])}, mode:"${mode}", reason:"${safeReason}"${idPart}${filesPart}})`;
}

export function getPostSourceEditInstructionForSession(sessionId: string, files: string[]): string {
  const task = resolveTaskForSession(sessionId);
  const mode = task?.proposalExecution?.mode;
  if (mode === DEV_SRC_SELF_EDIT_MODE || mode === DEV_SRC_SELF_EDIT_REPAIR_MODE) {
    return `Pending: run sandbox verification "${getSourceVerificationCommandForSession(sessionId)}" before finalizing.`;
  }
  const grant = getDevSourceEditGrant(sessionId);
  const scopedFiles = files.length ? files : (grant?.allowedFiles || []);
  const surfaces = getPromApplySurfacesForFiles(scopedFiles);
  const surfaceText = (surfaces.length ? surfaces : ['backend']).join(',');
  const idText = grant?.devEditId ? ` dev_edit_id=${grant.devEditId}` : '';
  const tagText = grant?.plan?.completionNoteTag || 'dev_edit_complete';
  return `Pending: prom_apply_dev_changes verify_only then apply_live readiness; surfaces=${surfaceText}; write_note tag=${tagText} only after the coordinator reports the shared batch live.${idText} If an approved file is queued behind another edit, use dev_source_edit action=await_files and reread it after handoff.`;
}

export function buildPresentedFileArtifact(absPath: string, relPath: string, title?: string): Record<string, any> {
  const ext = path.extname(absPath).replace(/^\./, '').toLowerCase();
  return {
    type: 'file',
    title: String(title || path.basename(absPath) || relPath || 'Presented file'),
    path: relPath,
    status: 'ready',
    summary: ext ? `${ext.toUpperCase()} file ready to view or download.` : 'File ready to view or download.',
  };
}

function devEditMutationFiles(name: string, args: any, projectRoot: string): Array<{ file: string; absPath: string }> {
  const tool = String(name || '').toLowerCase();
  const action = String(args?.action || args?.operation || '').toLowerCase();
  // Patchsets dispatch individual native source mutations through executeTool;
  // record those individual before/after boundaries rather than one duplicate
  // aggregate record around the dispatcher.
  const directMutation = (tool !== 'apply_dev_source_patchset' && /(?:write|find_replace|replace_lines|insert_after|delete)/.test(tool))
    || (tool === 'dev_source_edit' && action !== 'patchset' && /(?:write|find_replace|replace_lines|insert_after|delete)/.test(action));
  if (!directMutation) return [];
  const raw = Array.isArray(args?.edits)
    ? args.edits.map((item: any) => item?.file ?? item?.path)
    : [args?.file ?? args?.filename ?? args?.path];
  const result: Array<{ file: string; absPath: string }> = [];
  for (const value of raw) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized) continue;
    const isWebUi = normalized.startsWith('web-ui/') || /webui/.test(tool);
    const file = isWebUi
      ? `web-ui/${normalized.replace(/^web-ui\//, '')}`
      : `src/${normalized.replace(/^src\//, '')}`;
    const root = path.join(projectRoot, isWebUi ? 'web-ui' : 'src');
    const absPath = path.resolve(root, file.replace(/^(?:src|web-ui)\//, ''));
    if (absPath.startsWith(root)) result.push({ file, absPath });
  }
  return Array.from(new Map(result.map(item => [item.file, item])).values());
}

export function persistSearchResultSources(workspacePath: string, sessionId: string, result: string): void {
  const items: Array<Record<string, unknown>> = [];
  const labeled = /\[\d+\]\s+([^\r\n]+)\r?\n\s*(https?:\/\/[^\s<>'"\)\]]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = labeled.exec(String(result || ''))) !== null) {
    items.push({ title: match[1], url: match[2].replace(/[.,;:!?]+$/, '') });
  }
  if (items.length === 0) {
    const urls = String(result || '').match(/https?:\/\/[^\s<>'"\)\]]+/gi) || [];
    for (const url of urls) items.push({ url: url.replace(/[.,;:!?]+$/, '') });
  }
  if (items.length > 0) {
    try { getResourceStore(workspacePath).registerSourceItems(sessionId, items, { actor: 'web_search', origin: 'tool_observation' }); } catch (error: any) {
      console.warn('[Resources] Search source registration skipped:', redactResourceText(error?.message || error));
    }
  }
}

export function persistFetchedSource(workspacePath: string, sessionId: string, item: Record<string, unknown>): void {
  try {
    getResourceStore(workspacePath).registerSourceItems(sessionId, [item], { actor: 'web_fetch', fetched: true });
  } catch (error: any) {
    console.warn('[Resources] Fetched source registration skipped:', redactResourceText(error?.message || error));
  }
}

// These tools can add or promote resources after the tool-call event has
// already reached the client. Emit one explicit post-registration signal so
// source panels do not have to guess when the resource store is ready.
const RESOURCE_REFRESH_TOOLS = new Set([
  'show_sources',
  'web_search',
  'web_search_single',
  'web_search_multi',
  'web_search_snippets',
  'web_fetch',
  'web_fetch_batch',
  'download_url',
]);

function preflightSpawnSubagentCreateSchema(args: any): ToolResult | null {
  if (!args?.create_if_missing) return null;
  const createIfMissing = args.create_if_missing && typeof args.create_if_missing === 'object'
    ? { ...args.create_if_missing }
    : {};
  const fieldErrors: string[] = [];
  if (!String(createIfMissing.description || '').trim()) fieldErrors.push('create_if_missing.description is required');
  if (!String(createIfMissing.system_instructions || '').trim()) fieldErrors.push('create_if_missing.system_instructions is required');
  if (!Array.isArray(createIfMissing.constraints)) fieldErrors.push('create_if_missing.constraints must be an array (use [] when none)');
  if (!String(createIfMissing.success_criteria || '').trim()) fieldErrors.push('create_if_missing.success_criteria is required');
  for (const field of ['allowed_tools', 'forbidden_tools', 'mcp_servers', 'skillIds', 'context_refs']) {
    if (createIfMissing[field] != null && !Array.isArray(createIfMissing[field])) fieldErrors.push(`create_if_missing.${field} must be an array`);
  }
  if (!fieldErrors.length) return null;

  let subagentId = String(args?.subagent_id || '').trim();
  if (!subagentId) {
    const seed = String(createIfMissing.name || createIfMissing.description || 'disposable_agent')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'disposable_agent';
    subagentId = `${seed}_${Date.now().toString(36)}`;
  }
  return {
    name: 'spawn_subagent',
    args,
    result: JSON.stringify({ ok: false, code: 'INVALID_CREATE_SCHEMA', generated_subagent_id: subagentId, errors: fieldErrors }, null, 2),
    error: true,
  };
}

function preflightDirectSubagentDelegation(name: string, args: any): ToolResult | null {
  const isDirectDelegate = name === 'message_subagent'
    || (name === 'agent_chat_ops' && String(args?.action || '').trim().toLowerCase() === 'delegate');
  if (!isDirectDelegate) return null;
  const validation = validateDirectSubagentAssignment(args?.assignment);
  if (validation.ok) return null;
  return {
    name,
    args,
    result: JSON.stringify({ ok: false, code: validation.code, error: validation.message }, null, 2),
    error: true,
  };
}

/**
 * Test-only tool interception used by the replay harness (src/testing/replay/).
 * The override runs before policy/approval and real execution. Returning a
 * ToolResult short-circuits the call; returning null/undefined falls through to
 * the normal path. Refuses to arm in production unless explicitly allowed.
 */
export type ToolExecutionOverride = (
  name: string,
  args: any,
  sessionId: string,
) => ToolResult | null | undefined | Promise<ToolResult | null | undefined>;

let toolExecutionOverrideForTesting: ToolExecutionOverride | null = null;

export function setToolExecutionOverrideForTesting(override: ToolExecutionOverride | null): void {
  if (override && process.env.NODE_ENV === 'production' && process.env.PROMETHEUS_ALLOW_PROVIDER_OVERRIDE !== '1') {
    throw new Error('setToolExecutionOverrideForTesting is disabled in production.');
  }
  toolExecutionOverrideForTesting = override;
}

export async function executeTool(name: string, args: any, workspacePath: string, deps: ExecuteToolDeps, sessionId: string = 'default'): Promise<ToolResult> {
  // Trace span on the current turn (no-op outside a traced turn).
  const { withSpan } = require('../observability/turn-trace') as typeof import('../observability/turn-trace');
  return withSpan(
    'tool',
    String(name || ''),
    { action: typeof args?.action === 'string' ? args.action : undefined },
    () => executeToolUntraced(name, args, workspacePath, deps, sessionId),
    (result) => (result?.error ? 'error' : 'ok'),
  );
}

async function executeToolUntraced(name: string, args: any, workspacePath: string, deps: ExecuteToolDeps, sessionId: string = 'default'): Promise<ToolResult> {
  if (toolExecutionOverrideForTesting) {
    const overridden = await toolExecutionOverrideForTesting(name, args, sessionId);
    if (overridden) return overridden;
  }
  // Reject deterministic malformed delegation inputs before generic policy approval.
  // Valid spawn/delegate operations remain approval-gated exactly as before.
  if (name === 'spawn_subagent') {
    const invalidCreateSchema = preflightSpawnSubagentCreateSchema(args);
    if (invalidCreateSchema) return invalidCreateSchema;
  }
  const invalidDelegation = preflightDirectSubagentDelegation(name, args);
  if (invalidDelegation) return invalidDelegation;
  const executionStartedAt = Date.now();
  const grant = getDevSourceEditGrant(sessionId);
  let prepared: PreparedDevEditMutation[] = [];
  if (grant) {
    try {
      const projectRoot = resolvePrometheusRoot();
      const targets = devEditMutationFiles(name, args, projectRoot)
        .filter(target => grant.allowedFiles.includes(target.file));
      // Persisting a before-image is part of the commit boundary: if this
      // cannot be written, do not touch source. This makes reconstruction
      // dependable even if the gateway dies between write and apply_live.
      prepared = targets.map(target => prepareDevEditMutation({
        devEditId: grant.devEditId,
        toolName: name,
        file: target.file,
        absPath: target.absPath,
      }));
    } catch (err: any) {
      return { name, args, result: `Blocked source mutation: durable dev-edit ledger preparation failed: ${err?.message || err}`, error: true };
    }
  }
  // Imported plugin hooks (Claude/Codex hooks.json protocol). Only hooks the
  // user explicitly approved run; with none approved this is one cached check.
  const pluginHooks = await import('../../extensions/plugin-import/plugin-hooks.js').catch(() => null);
  const hooksActive = !!pluginHooks?.hasActivePluginHooks();
  if (hooksActive && pluginHooks) {
    const pre = await pluginHooks.dispatchPluginHooks({ event: 'PreToolUse', sessionId, cwd: workspacePath, toolName: name, toolInput: args });
    if (pre.blocked) {
      for (const item of prepared) finalizeDevEditMutation(item, new Error('blocked by plugin hook'));
      return { name, args, result: `Blocked by plugin hook: ${pre.blocked}`, error: true };
    }
  }
  let result: ToolResult;
  try {
    result = await executeToolRaw(name, args, workspacePath, deps, sessionId);
  } catch (err: any) {
    for (const item of prepared) finalizeDevEditMutation(item, err);
    throw err;
  }
  if (hooksActive && pluginHooks) {
    const post = await pluginHooks.dispatchPluginHooks({
      event: result.error ? 'PostToolUseFailure' : 'PostToolUse',
      sessionId, cwd: workspacePath, toolName: name, toolInput: args,
      toolResponse: String(result.result ?? '').slice(0, 8000),
    });
    const context = post.results.map((r) => r.additionalContext).filter(Boolean).join('\n');
    if (context) result = { ...result, result: `${result.result}\n[plugin hook context]\n${context}` };
  }
  const completedToolName = String(result.name || name || '').trim().toLowerCase();
  if (!result.error && RESOURCE_REFRESH_TOOLS.has(completedToolName)) {
    deps.sendSSE?.('resources_changed', {
      sessionId,
      action: completedToolName,
      reason: 'tool_resource_registration_complete',
    });
  }
  for (const item of prepared) {
    try { finalizeDevEditMutation(item, result.error ? result.result : undefined); } catch (err: any) {
      // The source write succeeded but its immutable forensic record did not.
      // Surface this loudly; apply_live remains blocked by the pending mutation.
      result = { ...result, error: true, result: `${result.result}\nDEV-EDIT LEDGER FINALIZATION FAILED: ${err?.message || err}` };
    }
  }
  const evidenceStartedAt = Date.now();
  // Approved source edits already have a durable before-image, after-image,
  // hashes, and unified patch in the dev-edit ledger. Reopening and hashing
  // the same source file for generic code evidence is redundant hot-path I/O.
  const ledgerBackedSourceMutation = prepared.length > 0 || (
    !!grant && (
      name === 'apply_dev_source_patchset'
      || (name === 'dev_source_edit' && String(args?.action || args?.operation || '').toLowerCase() === 'patchset')
    )
  );
  const evidenced = ledgerBackedSourceMutation
    ? {
        ...result,
        extra: {
          ...(result.extra || {}),
          devEditLedger: {
            devEditId: grant?.devEditId,
            mutationSequences: prepared.map((item) => item.sequence),
          },
        },
      }
    : attachCodeEvidenceToToolResult(result, {
        workspacePath,
        toolName: result.name || name,
        args: result.args || args,
      });
  return {
    ...evidenced,
    extra: {
      ...(evidenced.extra || {}),
      executionTiming: {
        rawExecutionMs: Math.max(0, evidenceStartedAt - executionStartedAt),
        codeEvidenceMs: Math.max(0, Date.now() - evidenceStartedAt),
        totalExecutorMs: Math.max(0, Date.now() - executionStartedAt),
      },
    },
  };
}

async function executeToolRaw(name: string, args: any, workspacePath: string, deps: ExecuteToolDeps, sessionId: string = 'default'): Promise<ToolResult> {
  let approvalDisplayToolName = name;
  const allowWorkspaceSourceCopy = args?.allow_source_copy === true;
  const mediaGenerateWrapper = normalizeMediaGenerateWrapperTool(name, args);
  if (mediaGenerateWrapper) {
    if (mediaGenerateWrapper.error) return { name, args, result: mediaGenerateWrapper.error, error: true };
    name = mediaGenerateWrapper.name;
    args = mediaGenerateWrapper.args;
  }
  const promRepoOpsWrapper = normalizePromRepoOpsWrapperTool(name, args);
  if (promRepoOpsWrapper) {
    if (promRepoOpsWrapper.error) return { name, args, result: promRepoOpsWrapper.error, error: true };
    name = promRepoOpsWrapper.name;
    args = promRepoOpsWrapper.args;
  }
  const backgroundOpsWrapper = normalizeBackgroundOpsWrapperTool(name, args);
  if (backgroundOpsWrapper) {
    if (backgroundOpsWrapper.error) return { name, args, result: backgroundOpsWrapper.error, error: true };
    name = backgroundOpsWrapper.name;
    args = backgroundOpsWrapper.args;
  }
  const skillOpsWrapper = normalizeSkillOpsWrapperTool(name, args);
  if (skillOpsWrapper) {
    if (skillOpsWrapper.error) return { name, args, result: skillOpsWrapper.error, error: true };
    name = skillOpsWrapper.name;
    args = skillOpsWrapper.args;
  }
  const devSourceWrapper = normalizeDevSourceWrapperTool(name, args);
  if (devSourceWrapper) {
    if (devSourceWrapper.error) return { name, args, result: devSourceWrapper.error, error: true };
    name = devSourceWrapper.name;
    args = devSourceWrapper.args;
  }
  const workspaceWrapper = normalizeWorkspaceWrapperTool(name, args, workspacePath);
  if (workspaceWrapper) {
    if (workspaceWrapper.error) return { name, args, result: workspaceWrapper.error, error: true };
    name = workspaceWrapper.name;
    args = workspaceWrapper.args;
  }
  if (
    ['read_file', 'read_files_batch', 'file_stats', 'grep_file', 'search_files', 'list_directory', 'file_tree'].includes(name)
    && !allowWorkspaceSourceCopy
  ) {
    const candidates = [
      args?.filename,
      args?.path,
      args?.directory,
      ...(Array.isArray(args?.files) ? args.files.map((entry: any) => entry?.filename ?? entry?.path ?? entry) : []),
      ...(Array.isArray(args?.paths) ? args.paths : []),
    ];
    if (candidates.some(isWorkspacePrometheusSourceCopyPath)) {
      return {
        name,
        args,
        result: 'This path is a workspace copy of Prometheus source, not the live product tree. Use dev_source_read for current src/web-ui files. Set allow_source_copy=true only when the user explicitly asked to inspect or compare that copy.',
        error: true,
      };
    }
  }
  const browserWrapper = normalizeBrowserWrapperTool(name, args);
  if (browserWrapper) {
    if (browserWrapper.error) return { name, args, result: browserWrapper.error, error: true };
    name = browserWrapper.name;
    args = browserWrapper.args;
  }
  const desktopWrapper = normalizeDesktopWrapperTool(name, args);
  if (desktopWrapper) {
    if (desktopWrapper.error) return { name, args, result: desktopWrapper.error, error: true };
    name = desktopWrapper.name;
    args = desktopWrapper.args;
  }
  if (name.startsWith('desktop_') && (deps.abortSignal?.aborted || deps.abortSignal?.signal?.aborted)) {
    return {
      name,
      args,
      result: 'ERROR: [DESKTOP_CANCELLED] Desktop operation was interrupted before execution.',
      error: true,
      data: { ok: false, code: 'DESKTOP_CANCELLED', retryable: true },
    };
  }
  const externalAppWrapper = normalizeExternalAppWrapperTool(name, args);
  if (externalAppWrapper) {
    if (externalAppWrapper.error) return { name, args, result: externalAppWrapper.error, error: true };
    name = externalAppWrapper.name;
    args = externalAppWrapper.args;
  }
  // Generated per-connector wrappers (connector_github, connector_gmail, ...)
  // resolve to the direct connector tool BEFORE policy evaluation, so the
  // existing approval rules for writes (connector_github_create*, sends) apply
  // to the real tool name.
  if (/^connector_[a-z0-9_]+$/.test(name)) {
    try {
      // The registry is populated lazily by ensure-loaded. When a wrapper was
      // the first connector call since startup, the registry was still empty
      // (0 connectors), no spec matched, and the raw wrapper name fell through
      // to the platform executor: "not enabled for this connection"
      // (2026-09-25, connector_github / connector_gmail).
      ensurePrometheusExtensionRuntimeLoaded();
      const spec = getExtensionRuntimeRegistry().getConnectorWrapperSpec(name);
      if (spec) {
        const resolved = resolveConnectorWrapperCall(spec, args);
        if (resolved.error) return { name, args, result: resolved.error, error: true };
        name = resolved.name;
        args = resolved.args;
      }
    } catch (err: any) {
      // Never silent: a swallowed error here surfaced as the misleading
      // "not enabled for this connection" from the platform executor.
      console.warn(`[connector-wrapper] resolve failed for ${name}: ${err?.stack || err}`);
    }
  }
  // Tool Search bridge: tool_search/tool_describe are read-only catalog
  // lookups; tool_call re-enters executeTool with the real tool name, so the
  // policy/approval gates below run for the actual connector/MCP tool.
  if (name === 'tool_search' || name === 'tool_describe' || name === 'tool_call') {
    const { handleToolSearchTool } = await import('../tool-search');
    const bridged = await handleToolSearchTool(name, args, (innerName, innerArgs) => (
      executeTool(innerName, innerArgs, workspacePath, deps, sessionId)
    ));
    if (bridged) return bridged;
  }
  const agentTeamWrapper = normalizeAgentTeamWrapperTool(name, args);
  if (agentTeamWrapper) {
    if (agentTeamWrapper.error) return { name, args, result: agentTeamWrapper.error, error: true };
    name = agentTeamWrapper.name;
    args = agentTeamWrapper.args;
  }
  if (name === 'video_compose') {
    const storage = buildCreativeStorageForTool(workspacePath, sessionId);
    const action = String(args?.action || '').trim().toLowerCase();
    try {
      let saved: { sequence: CreativeSequenceDoc; path: string } | null = null;
      let data: any = null;
      if (action === 'create') {
        saved = saveCreativeSequence(storage, createCreativeSequence({ title: args?.title, sources: args?.sources, width: args?.width, height: args?.height, frameRate: args?.frameRate, fit: args?.fit, captions: args?.captions, audio: args?.audio }, storage));
        data = { sequence: inspectCreativeSequence(saved.sequence), sequencePath: buildCreativeWorkspaceRelativePath(storage.workspacePath, saved.path) };
      } else {
        const sequenceId = String(args?.sequenceId || '').trim();
        if (!sequenceId) throw new Error(`video_compose ${action || 'action'} requires sequenceId.`);
        let sequence = loadCreativeSequence(storage, sequenceId);
        if (action === 'inspect') data = inspectCreativeSequence(sequence);
        else if (action === 'apply_edit') {
          sequence = applyCreativeSequenceOperations(sequence, (Array.isArray(args?.operations) ? args.operations : []) as CreativeSequenceOperation[], String(args?.instruction || ''));
          saved = saveCreativeSequence(storage, sequence);
          data = { sequence: inspectCreativeSequence(saved.sequence), sequencePath: buildCreativeWorkspaceRelativePath(storage.workspacePath, saved.path) };
        } else if (action === 'add_social_cut_result') {
          sequence = addSocialCutReceipt(sequence, storage, String(args?.receiptPath || ''), args?.atMs);
          saved = saveCreativeSequence(storage, sequence);
          data = { sequence: inspectCreativeSequence(saved.sequence), sequencePath: buildCreativeWorkspaceRelativePath(storage.workspacePath, saved.path) };
        } else if (action === 'create_variant') {
          sequence = createCreativeSequenceVariant(sequence, { format: args?.format, width: args?.width, height: args?.height, reframe: args?.reframe });
          saved = saveCreativeSequence(storage, sequence);
          data = { sequence: inspectCreativeSequence(saved.sequence), sequencePath: buildCreativeWorkspaceRelativePath(storage.workspacePath, saved.path) };
        } else if (action === 'set_captions') {
          sequence.captions = { ...sequence.captions, ...(isPlainObjectArg(args?.captions) ? args.captions : {}) };
          saved = saveCreativeSequence(storage, sequence);
          data = { sequence: inspectCreativeSequence(saved.sequence), sequencePath: buildCreativeWorkspaceRelativePath(storage.workspacePath, saved.path) };
        } else if (action === 'set_audio_policy') {
          const audio = isPlainObjectArg(args?.audio) ? args.audio : {};
          sequence.audio = { dialogueNormalization: { ...sequence.audio.dialogueNormalization, ...(isPlainObjectArg(audio.dialogueNormalization) ? audio.dialogueNormalization : {}) }, musicDucking: { ...sequence.audio.musicDucking, ...(isPlainObjectArg(audio.musicDucking) ? audio.musicDucking : {}) } };
          saved = saveCreativeSequence(storage, sequence);
          data = { sequence: inspectCreativeSequence(saved.sequence), sequencePath: buildCreativeWorkspaceRelativePath(storage.workspacePath, saved.path) };
        } else if (action === 'render') {
          const selected = selectCreativeSequenceComposition(sequence, args?.variantId || null);
          const outputFormat = String(args?.outputFormat || 'mp4').toLowerCase() === 'webm' ? 'webm' : 'mp4';
          const exportsDir = path.join(storage.creativeDir, 'exports');
          fs.mkdirSync(exportsDir, { recursive: true });
          const safeName = String(args?.filename || `${sequence.id}-${selected.variant?.id || 'master'}.${outputFormat}`).trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
          const fileName = safeName.toLowerCase().endsWith(`.${outputFormat}`) ? safeName : `${safeName}.${outputFormat}`;
          const outputPath = path.join(exportsDir, fileName);
          const render = await renderComposition({ composition: selected.composition, workspacePath: storage.workspacePath, outputPath, format: outputFormat });
          const relativeOutput = buildCreativeWorkspaceRelativePath(storage.workspacePath, outputPath);
          if (selected.variant) {
            selected.variant.exportPath = relativeOutput;
            selected.variant.status = 'rendered';
          } else {
            sequence.masterRender.exportPath = relativeOutput;
            sequence.masterRender.status = 'rendered';
            sequence.masterRender.renderedAt = new Date().toISOString();
          }
          saveCreativeSequence(storage, sequence);
          const qa = args?.autoQa === false ? null : qaCreativeSequenceExport(storage, { sequenceId, artifactPath: relativeOutput, variantId: selected.variant?.id || null });
          data = { render: { ...render, outputPath: relativeOutput }, qa: qa ? { receipt: qa.receipt, receiptPath: buildCreativeWorkspaceRelativePath(storage.workspacePath, qa.receiptPath) } : null, sequence: inspectCreativeSequence(qa?.sequence || sequence) };
        } else if (action === 'qa') {
          const result = qaCreativeSequenceExport(storage, { sequenceId, artifactPath: String(args?.artifactPath || ''), variantId: args?.variantId || null });
          data = { receipt: result.receipt, receiptPath: buildCreativeWorkspaceRelativePath(storage.workspacePath, result.receiptPath), sequence: inspectCreativeSequence(result.sequence) };
        } else throw new Error(`Unsupported video_compose action: ${action || '(missing)'}`);
      }
      return { name, args, result: JSON.stringify(data, null, 2), error: false, data };
    } catch (error: any) {
      return { name, args, result: `video_compose: ${error?.message || String(error)}`, error: true };
    }
  }
  const creativeWrapper = normalizeCreativeWrapperTool(name, args);
  if (creativeWrapper) {
    if (creativeWrapper.error) return { name, args, result: creativeWrapper.error, error: true };
    name = creativeWrapper.name;
    args = creativeWrapper.args;
  }
  if (name === 'terminal') {
    const action = String(args?.action || '').trim().toLowerCase();
    const background = args?.background === true || args?.mode === 'background' || action === 'start';
    args = { ...args };
    delete args.mode;
    if (!args.action) args.action = background ? 'start' : 'run';
    if (action === 'status') name = 'process_status';
    else if (action === 'log') name = 'process_log';
    else if (action === 'wait') name = 'process_wait';
    else if (action === 'kill') name = 'process_kill';
    else if (action === 'submit') name = 'process_submit';
    else name = background ? 'start_process' : 'run_command';
  }
  if (name === 'show_ui_card') {
    const cardType = String(args?.type || '').trim().toLowerCase();
    const cardToolByType: Record<string, string> = {
      sources: 'show_sources',
      product_carousel: 'show_product_carousel',
      products: 'show_product_carousel',
      agent_work: 'show_agent_work',
      market: 'show_market',
      stocks: 'show_stocks',
      weather: 'show_weather',
      comparison: 'show_comparison',
      chart: 'show_chart',
      run_result: 'show_run_result',
      prediction_market: 'show_prediction_market',
      map: 'show_map',
    };
    const targetTool = cardToolByType[cardType];
    const payload = args?.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
      ? { ...args.payload }
      : {};
    if (args?.title != null && payload.title == null) payload.title = String(args.title);
    const { UI_CARD_BUILDERS, buildProductCard } = await import('../../tools/ui-cards.js');
    const builder = cardType === 'product'
      ? (p: any) => buildProductCard(
        p,
        (items) => enrichProductArtifactItems(items as any, { downloadImages: true, metadataTimeoutMs: 3000 }),
        async (query) => {
          const tr: any = await executeShoppingSearchProducts({ query, max_results: 4, merchant: p?.merchant ? String(p.merchant) : undefined });
          return tr?.extra?.richArtifacts?.[0]?.items || tr?.data?.items || [];
        },
      )
      : UI_CARD_BUILDERS[cardType];
    // Every card gets a short ref the model can drop into its reply as
    // {{card:REF}} so the card renders inline instead of after the text.
    const withCardRef = (r: any) => {
      const arts = [
        ...(Array.isArray(r?.extra?.richArtifacts) ? r.extra.richArtifacts : []),
        ...(r?.extra?.productCarousel && typeof r.extra.productCarousel === 'object' ? [r.extra.productCarousel] : []),
      ];
      if (r?.error || !arts.length) return r;
      const refs = arts.map((a: any) => {
        if (!a.ref) a.ref = `${String(cardType || a.type || 'card').replace(/[^a-z]/gi, '').slice(0, 10) || 'card'}${Math.random().toString(36).slice(2, 6)}`;
        return a.ref;
      });
      return { ...r, result: `${String(r.result || '')}\nPlace inline: put {{card:${refs[0]}}} on its own line in your reply where the card belongs (omit it to show the card after the reply).` };
    };
    if (builder) {
      const tr = await builder(payload);
      return withCardRef({ name, args, result: tr.stdout || tr.error || 'Card unavailable.', error: !tr.success, data: tr.data, extra: tr.extra });
    }
    if (!targetTool) {
      return {
        name,
        args,
        result: `Unknown UI card type "${cardType}". Valid: ${[...Object.keys(cardToolByType), 'product', ...Object.keys(UI_CARD_BUILDERS)].join(', ')}`,
        error: true,
      };
    }
    return withCardRef(await executeTool(targetTool, payload, workspacePath, deps, sessionId));
  }
  // Filename inference: if the model forgot to pass filename, use the last one
  const needsFilename = ['read_file', 'validate_file', 'create_file', 'replace_lines', 'insert_after', 'delete_lines', 'find_replace', 'delete_file'];
  if (needsFilename.includes(name)) {
    // Normalize: secondary AI sometimes returns "path" or "file" instead of "filename"
    if (!args.filename && !args.name) {
      if (args.path) { args.filename = args.path; }
      else if (args.file) { args.filename = args.file; }
    }
    const fn = args.filename || args.name;
    if (fn) {
      lastFilenameUsed.set(sessionId, fn);
    } else if (lastFilenameUsed.has(sessionId)) {
      args.filename = lastFilenameUsed.get(sessionId);
      console.log(`[v2] AUTO-FIX: Injected missing filename "${args.filename}" for ${name}`);
    }
  }

  if (isToolHiddenInPublicBuild(name)) {
    return {
      name,
      args,
      result: `ERROR: ${name} is not available in the public distribution build.`,
      error: true,
    };
  }

  // ── Helper: resolve file paths for proposal sessions ──────────────────────
	  // In proposal/code_exec sessions, src/ paths should resolve to PROJECT_ROOT/src/
	  // (one level up from workspace) so edits land in the actual source tree.
	  // All other paths resolve to workspace as normal.
  const hardDeny = evaluateHardToolDeny({
    toolName: name,
    args,
    sessionId,
    executionPolicy: deps.executionPolicy,
  });
  if (hardDeny.denied) {
    try {
      deps.onHardToolDeny?.({ sessionId, toolName: name, args, decision: hardDeny });
    } catch {}
    try {
      appendAuditEntry({
        timestamp: new Date().toISOString(),
        sessionId,
        agentId: inferAgentIdFromSession(sessionId, args),
        actionType: 'approval_resolved',
        toolName: name,
        toolArgs: args,
        policyTier: 'commit',
        approvalStatus: 'rejected',
        resultSummary: `Blocked by hard goal policy: ${hardDeny.category || 'hard_denied_action'}`,
      });
    } catch {}
    return {
      name,
      args,
      result: formatHardToolDeny(hardDeny),
      error: true,
    };
  }
  const workspaceHelpers = createWorkspaceHelpers({ name, args, workspacePath, deps, sessionId, allowWorkspaceSourceCopy, __dirname, updateArgs: (value) => { args = value; } });
  const { _isProposalSession, hasPrometheusSourceShape, candidateProjectRootsFromAllowedWorkspaces, resolveProjectRootForSourceAccess, PROM_ROOT_ALLOWED_ROOT_FILES, PROM_ROOT_ALLOWED_DIRECTORIES, PROM_ROOT_DENIED_TOP_LEVEL, normalizePromPath, isPromDeniedPath, isPromAllowedPath, promAllowlistSummary, resolvePromAllowedPath, resolvePromAllowedFilePath, ensureProposalPromWriteTool, writeToolResultOverflow, maybeSpoolToolOutput, renderNumberedRead, validateSyntaxFileResult, normalizeFindTextForRecovery, tokenSetForRecovery, countCommonTokensForRecovery, renderCandidateSnippetForRecovery, applyTolerantFindReplace, lineNumberAtOffset, formatPostEditContext, buildTextNotFoundRecovery, scorePathSuggestion, buildPathNotFoundRecovery, buildLineOutOfRangeRecovery, recoverWorkspacePathError, renderDirectoryEntries, normalizePathForPermissionCompare, isPathInsideForPermissions, getRuntimeDiagnosticsReadRoots, resolveAllowedWorkspacePath, resolveFilePath, resolveWorkspacePath, snapshotPreMutation, withWorkspaceSnapshots, resolveWorkspaceDirectory, quoteArg, truncateText, isSkippableWorkspaceEntry, walkFiles, countDirectoryFiles, extractPatchTargetPaths, validatePatchTargetPaths, runCapturedToolCommand, readPackageScripts, snapshotRoot, listSnapshots, isCodeFile, getLineAndCharacterFromPos, buildCodeOutlineForFile, collectCodeSymbols, mutationScope, normalizeScopePath, isWithinAllowedDir, enforceMutationScope, resolveProposalExecutionTask, isDevSrcSelfEditProposalSession, isDevSourceWriteApprovedSession, ensureDevSrcSelfEditWriteSession, enforceProposalWriteAccess, resolveRunCommandCwd, getRunCommandAllowedRoots, extractAbsolutePathsFromCommand, boundaryRank, uniqueStrings, mergeCommandBoundary, envPath, userProfileRoots, isInsideUserProfile, commandBoundaryFromPatterns, applyCommandPathBoundary, analyzeRunCommandBoundary, stableToolArgsForPermission, getShellApprovalMode, maybeBlockShellTokenPolicy, normalizeUrlOrigin, buildScopedToolPermissionCandidate } = workspaceHelpers;

      if (GENERIC_WORKSPACE_MUTATION_TOOLS.has(name) && isDevSourceWriteApprovedSession() && !SCOPED_WORKSPACE_FILE_MUTATION_TOOLS.has(name)) {
        return {
          name,
          args,
          result: `BLOCKED: ${name} is disabled in code_change/dev-source edit sessions. Use approved source tools for src/web-ui changes, or scoped workspace file tools for approved self docs.`,
          error: true,
        };
      }

  // [A4] Policy evaluation + audit trail — log every tool call, non-blocking
  let evaluation = {
    tier: 'commit' as 'read' | 'propose' | 'commit',
    riskScore: 10,
    reason: 'policy engine unavailable — failing closed',
    affectedSystems: [] as string[],
    matchedRule: null as any,
    capabilities: null as any,
  };

  try {
    evaluation = getPolicyEngine().evaluateAction(sessionId, name, args);
    const inferredAgentId = inferAgentIdFromSession(sessionId, args);
    appendAuditEntry({
      timestamp: new Date().toISOString(),
      sessionId,
      agentId: inferredAgentId,
      actionType: 'tool_call',
      toolName: name,
      toolArgs: args,
      policyTier: evaluation.tier,
      approvalStatus: evaluation.tier === 'read' ? 'auto' : 'pending',
      resultSummary: evaluation.reason,
    });
  } catch { /* retain the fail-closed COMMIT evaluation */ }

  const isGoalAutonomousApprovalBypass =
    deps.executionPolicy?.mode === 'goal_autonomous'
    && deps.executionPolicy?.approvalMode === 'never';

	  let approvedCommandApprovalId = '';
    const isElevatedCommand = args?.elevated === true;
    const bypassGenericToolApproval = shouldBypassGenericToolApproval(getShellApprovalMode(), name, args);
    if (isElevatedCommand && name === 'start_process') {
      return { name, args, result: 'Elevated commands must be bounded foreground runs. Administrator background processes and interactive PTYs are not supported.', error: true };
    }
    if (isElevatedCommand && process.platform !== 'win32') {
      return { name, args, result: 'Administrator command execution is currently supported on Windows only.', error: true };
    }
	  if ((name === 'run_command' || name === 'start_process') && !bypassGenericToolApproval) {
	    const rawCmd = String(args?.command || '').trim();
	    if (!rawCmd) return { name, args, result: 'command is required', error: true };
    if (!isTerminalFirstWorkspaceMode(getConfig().getConfig()) && looksLikeNativeFileToolBypass(rawCmd)) {
      return {
        name,
        args,
        result: 'Blocked: this looks like an ad hoc shell/Python/Node/PowerShell file edit. Use native workspace wrappers instead: workspace_read(action:"stats"/"read"/"grep") first, then workspace_edit(action:"find_replace"/"replace_lines"/"insert_after"/"delete_lines"/"write"/"create"/"append") or workspace_edit(action:"patchset"). Use workspace_run for tests, builds, git/status, package installs, diagnostics, or transformations the file tools cannot perform.',
        error: true,
      };
    }

    let commandCwdForApproval: { cwd: string; displayCwd: string };
    try {
      commandCwdForApproval = resolveRunCommandCwd(args?.cwd);
    } catch (err: any) {
      return { name, args, result: `Invalid cwd for ${name}: ${err.message || err}`, error: true };
    }
    const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
    const commandBoundary = analyzeRunCommandBoundary(normalizedCmd, commandCwdForApproval.cwd);
    if (commandBoundary.blocked) return commandBoundary.blocked;
    const shellTokenPolicyBlock = maybeBlockShellTokenPolicy(rawCmd, normalizedCmd);
    if (shellTokenPolicyBlock) return shellTokenPolicyBlock;

    const permissionCandidate: ToolPermissionCandidate = {
      sessionId,
      toolName: name,
      action: normalizedCmd,
      targetKind: 'command_cwd' as const,
      target: commandCwdForApproval.cwd,
      targetDisplay: commandCwdForApproval.displayCwd,
      command: normalizedCmd,
      cwd: commandCwdForApproval.cwd,
      cwdDisplay: commandCwdForApproval.displayCwd,
      workspaceRoot: path.resolve(workspacePath),
      riskScore: Math.max(Number(evaluation.riskScore || 0), isElevatedCommand ? 10 : commandBoundary.requiresExplicitApproval ? 7 : 0),
      boundaryScope: isElevatedCommand ? 'admin_required' : commandBoundary.scope,
      boundaryReason: isElevatedCommand
        ? 'This command will run through the installed Windows administrator broker after explicit one-shot approval. Broker setup may require UAC once.'
        : commandBoundary.reason,
      externalPaths: commandBoundary.externalPaths,
      environmentChanges: commandBoundary.environmentChanges,
      packageManager: commandBoundary.packageManager,
      requiresExplicitApproval: isElevatedCommand || commandBoundary.requiresExplicitApproval,
      requiresAdmin: isElevatedCommand || commandBoundary.requiresAdmin,
      oneShot: isElevatedCommand || undefined,
    };
    const shellApprovalMode = getShellApprovalMode();
    const needsCommandApproval = isElevatedCommand || evaluation.tier === 'commit' || (shellApprovalMode !== 'lite' && commandBoundary.requiresExplicitApproval);
    const isLiteCommandApprovalBypass = !isElevatedCommand && shellApprovalMode === 'lite';
    const existingCommandGrant = isElevatedCommand ? null : findCommandPermissionGrant(permissionCandidate);
    const isAutonomousCommandApprovalBypass = !isElevatedCommand && isGoalAutonomousApprovalBypass && !commandBoundary.requiresExplicitApproval;
    if (!needsCommandApproval || existingCommandGrant || isAutonomousCommandApprovalBypass || isLiteCommandApprovalBypass) {
      try {
        appendAuditEntry({
          timestamp: new Date().toISOString(),
          sessionId,
          agentId: inferAgentIdFromSession(sessionId, args),
          actionType: 'approval_resolved',
          toolName: approvalDisplayToolName,
          toolArgs: args,
          policyTier: evaluation.tier,
          approvalStatus: 'auto_allowed',
          resultSummary: existingCommandGrant
            ? `Allowed by ${existingCommandGrant.scope} command permission ${existingCommandGrant.id}`
            : isLiteCommandApprovalBypass
            ? 'Auto-allowed by Lite terminal permissions.'
            : !needsCommandApproval
            ? 'Auto-allowed workspace terminal command.'
            : bypassGenericToolApproval
            ? 'Auto-allowed by Lite permissions.'
            : 'Auto-allowed by main-chat goal autonomous policy.',
        });
      } catch {}
    } else {

	    const approvalQueue = getApprovalQueue();
	    const activeTask = resolveTaskForSession(sessionId);
	    const activeTaskId = String(activeTask?.id || '').trim() || undefined;
	    const approvalOrigin = inferApprovalOrigin(sessionId, activeTask, args);
	    if (activeTaskId) {
	      updateTaskStatus(activeTaskId, 'needs_assistance', { pauseReason: 'awaiting_command_approval' });
	      appendJournal(activeTaskId, {
	        type: 'pause',
	        content: `Waiting for command approval: ${rawCmd.slice(0, 220)}`,
	      });
	      try {
	        deps.broadcastWS({
	          type: 'task_needs_assistance',
	          taskId: activeTaskId,
	          title: activeTask?.title,
	          reason: 'Command approval required',
	          detail: rawCmd,
	        });
	        deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
	      } catch {}
	    }
      const approvalCwd = commandCwdForApproval.displayCwd;
      const boundaryDetails = commandBoundary.requiresExplicitApproval
        ? [
            `This command crosses the workspace boundary (${commandBoundary.scope}).`,
            commandBoundary.reason,
            commandBoundary.externalPaths.length ? `Likely external paths: ${commandBoundary.externalPaths.join(', ')}` : '',
            commandBoundary.environmentChanges.length ? `Environment changes: ${commandBoundary.environmentChanges.join(', ')}` : '',
          ].filter(Boolean).join(' ')
        : '';
      const pathAccessPaths = uniqueStrings(commandBoundary.pathAccessPaths || []);
	    const approval = approvalQueue.create({
	      sessionId,
	      taskId: activeTaskId,
	      agentId: inferAgentIdFromSession(sessionId, args),
	      originType: approvalOrigin.originType,
	      originLabel: approvalOrigin.originLabel,
	      toolName: approvalDisplayToolName,
      approvalKind: isElevatedCommand ? 'elevated_command' : 'command',
      toolArgs: { ...args, command: rawCmd },
      pathAccess: pathAccessPaths.length
        ? { requestedPath: pathAccessPaths[0], requestedPaths: pathAccessPaths }
        : undefined,
      commandPermissionCandidate: isElevatedCommand ? undefined : permissionCandidate,
      action: isElevatedCommand
        ? `Run as administrator in ${approvalCwd}: ${rawCmd}`
        : commandBoundary.requiresExplicitApproval
        ? `Run terminal command outside workspace in ${approvalCwd}: ${rawCmd}`
        : `Run terminal command in ${approvalCwd}: ${rawCmd}`,
      reason: [evaluation.reason, boundaryDetails].filter(Boolean).join('\n\n'),
      policyTier: 'commit',
      riskScore: permissionCandidate.riskScore,
      affectedSystems: uniqueStrings([
        ...(Array.isArray(evaluation.affectedSystems) ? evaluation.affectedSystems : []),
        ...(isElevatedCommand ? ['windows_administrator', 'uac'] : []),
        ...(commandBoundary.requiresExplicitApproval ? ['outside_workspace', commandBoundary.scope] : []),
      ]),
    });

    try {
      appendAuditEntry({
        timestamp: new Date().toISOString(),
        sessionId,
        agentId: inferAgentIdFromSession(sessionId, args),
        actionType: 'approval_requested',
        toolName: approvalDisplayToolName,
        toolArgs: args,
        policyTier: evaluation.tier,
        approvalStatus: 'pending',
        resultSummary: `Queued command approval ${approval.id}`,
      });
    } catch {}

	    try {
	      deps.broadcastWS({
	        type: 'approval_created',
	        sessionId,
	        taskId: activeTaskId,
	        approvalId: approval.id,
	        summary: approval.action,
	        toolName: approvalDisplayToolName,
          approval: serializeApprovalForClient(approval),
      });
    } catch {}

    try {
      if (deps.telegramChannel?.sendCommandApproval) {
        await deps.telegramChannel.sendCommandApproval(approval);
      }
    } catch (err: any) {
      console.warn('[run_command] Could not send Telegram approval:', err?.message || err);
    }

    const approved = await new Promise<boolean>((resolve) => {
      approvalQueue.onResolve(approval.id, resolve);
    });

	    try {
	      if (activeTaskId) {
	        updateTaskStatus(activeTaskId, 'running', { pauseReason: undefined });
	        appendJournal(activeTaskId, {
	          type: approved ? 'resume' : 'status_push',
	          content: approved
	            ? `Command approved: ${rawCmd.slice(0, 220)}`
	            : `Command rejected: ${rawCmd.slice(0, 220)}`,
	        });
	        deps.broadcastWS({
	          type: 'task_running',
	          taskId: activeTaskId,
	          title: activeTask?.title,
	        });
	        deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
	      }
	      deps.broadcastWS({
	        type: approved ? 'approval_approved' : 'approval_denied',
	        sessionId,
	        taskId: activeTaskId,
	        approvalId: approval.id,
	        summary: approval.action,
          approval: serializeApprovalForClient(approval),
	      });
    } catch {}

	    if (!approved) {
	      return {
	        name,
	        args,
	        result: `Command approval denied for "${rawCmd}"`,
	        error: true,
	      };
	    }
      approvedCommandApprovalId = approval.id;
    }
	  }

  if (name !== 'run_command' && name !== 'start_process' && evaluation.tier !== 'read' && !bypassGenericToolApproval) {
    const approvalQueue = getApprovalQueue();
    const activeTask = resolveTaskForSession(sessionId);
    const activeTaskId = String(activeTask?.id || '').trim() || undefined;
    const approvalOrigin = inferApprovalOrigin(sessionId, activeTask, args);
    const summaryArgs = (() => {
      try {
        return JSON.stringify(args ?? {}).slice(0, 500);
      } catch {
        return '[unserializable args]';
      }
    })();
    const action = `Run ${approvalDisplayToolName}${summaryArgs && summaryArgs !== '{}' ? ` with ${summaryArgs}` : ''}`;
    const permissionCandidate = await buildScopedToolPermissionCandidate(name, args, Number(evaluation.riskScore || 0));
    const existingToolGrant = permissionCandidate ? findCommandPermissionGrant(permissionCandidate) : null;

    if (existingToolGrant || isGoalAutonomousApprovalBypass || bypassGenericToolApproval) {
      try {
        appendAuditEntry({
          timestamp: new Date().toISOString(),
          sessionId,
          agentId: inferAgentIdFromSession(sessionId, args),
          actionType: 'approval_resolved',
          toolName: approvalDisplayToolName,
          toolArgs: args,
          policyTier: evaluation.tier,
          approvalStatus: 'auto_allowed',
          resultSummary: existingToolGrant
            ? `Allowed by ${existingToolGrant.scope} scoped tool permission ${existingToolGrant.id}`
            : 'Auto-allowed by main-chat goal autonomous policy.',
        });
      } catch {}
    } else {
    if (activeTaskId) {
      updateTaskStatus(activeTaskId, 'needs_assistance', { pauseReason: 'awaiting_command_approval' });
      appendJournal(activeTaskId, {
        type: 'pause',
        content: `Waiting for approval: ${action.slice(0, 220)}`,
      });
      try {
        deps.broadcastWS({
          type: 'task_needs_assistance',
          taskId: activeTaskId,
          title: activeTask?.title,
          reason: 'Tool approval required',
          detail: action,
        });
        deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
      } catch {}
    }

    const approval = approvalQueue.create({
      sessionId,
      taskId: activeTaskId,
      agentId: inferAgentIdFromSession(sessionId, args),
      originType: approvalOrigin.originType,
      originLabel: approvalOrigin.originLabel,
      toolName: approvalDisplayToolName,
      toolArgs: args,
      commandPermissionCandidate: permissionCandidate || undefined,
      action,
      reason: evaluation.reason,
      policyTier: 'commit',
      riskScore: Number(evaluation.riskScore || 0),
      affectedSystems: Array.isArray(evaluation.affectedSystems) ? evaluation.affectedSystems : [],
    });

    try {
      appendAuditEntry({
        timestamp: new Date().toISOString(),
        sessionId,
        agentId: inferAgentIdFromSession(sessionId, args),
        actionType: 'approval_requested',
        toolName: approvalDisplayToolName,
        toolArgs: args,
        policyTier: evaluation.tier,
        approvalStatus: 'pending',
        resultSummary: `Queued tool approval ${approval.id}`,
      });
    } catch {}

    try {
      deps.broadcastWS({
        type: 'approval_created',
        sessionId,
        taskId: activeTaskId,
        approvalId: approval.id,
        summary: approval.action,
        toolName: approvalDisplayToolName,
        approval: serializeApprovalForClient(approval),
      });
    } catch {}

    try {
      if (deps.telegramChannel?.sendCommandApproval) {
        await deps.telegramChannel.sendCommandApproval(approval);
      }
    } catch (err: any) {
      console.warn('[tool_approval] Could not send Telegram approval:', err?.message || err);
    }

    const approved = await new Promise<boolean>((resolve) => {
      approvalQueue.onResolve(approval.id, resolve);
    });

    try {
      if (activeTaskId) {
        updateTaskStatus(activeTaskId, 'running', { pauseReason: undefined });
        appendJournal(activeTaskId, {
          type: approved ? 'resume' : 'status_push',
          content: approved
            ? `Tool approved: ${action.slice(0, 220)}`
            : `Tool rejected: ${action.slice(0, 220)}`,
        });
        deps.broadcastWS({
          type: 'task_running',
          taskId: activeTaskId,
          title: activeTask?.title,
        });
        deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
      }
      deps.broadcastWS({
        type: approved ? 'approval_approved' : 'approval_denied',
        sessionId,
        taskId: activeTaskId,
        approvalId: approval.id,
        summary: approval.action,
        approval: serializeApprovalForClient(approval),
      });
    } catch {}

    if (!approved) {
      return {
        name,
        args,
        result: `Tool approval denied for ${name}`,
        error: true,
      };
    }
    }
  }

  // Policy/approval and wrapper normalization above remain authoritative.
  // Ledger owns the entire dispatch continuation so every return is committed before delivery.
  const externalSideEffect = isExternalSideEffect(name, args);
  const forceReexecute = args?.force_reexecute === true;
  if (externalSideEffect && args && typeof args === 'object') {
    args = { ...args };
    delete args.force_reexecute; // gateway-only control, never sent to an external API
  }
  const dispatch = async (): Promise<ToolResult> => {
  if (name === 'show_product_carousel') {
    const normalizedItems = normalizeProductArtifactItems(Array.isArray(args?.items) ? args.items : []);
    const enrichedItems = await enrichProductArtifactItems(normalizedItems.map((item, index) => ({
      id: `artifact_product_${index + 1}`,
      ...item,
    })));
    const items = enrichedItems.filter(isUsableProductArtifactItem);
    if (!items.length) return { name, args, result: 'show_product_carousel requires at least one carousel-ready item with a title, product URL, image, and product metadata.', error: true };
    const title = String(args?.title || '');
    const source = String(args?.source || '');
    args = { ...args, items };
    return {
      name,
      args,
      result: `Product carousel ready: "${title}" — ${items.length} item(s) will be displayed.`,
      error: false,
      extra: { productCarousel: { title, source, items } },
    };
  }

  if (name === 'show_agent_work') {
    // Models often send a flat items[]/prs[]/tasks[] list; without this the card
    // rendered only its title.
    const flat = [args?.items, args?.rows, args?.prs, args?.tasks].find((v) => Array.isArray(v) && v.length);
    if (flat && !args?.summaryRows && !args?.priorities && !args?.activeWork && !args?.teams) {
      args = { ...args, priorities: flat.filter((it: any) => it).map((it: any) => (typeof it === 'string' ? { title: it } : {
        ...it,
        title: String(it.title || it.name || it.label || it.id || ''),
        subtitle: String(it.subtitle || it.status || it.detail || it.description || it.summary || ''),
      })) };
    }
    const artifact = {
      id: `agent_work-${Date.now()}`,
      type: 'agent_work' as const,
      mode: (args?.mode as string) || 'snapshot',
      greeting: args?.greeting ? String(args.greeting) : undefined,
      title: args?.title ? String(args.title) : undefined,
      subtitle: args?.subtitle ? String(args.subtitle) : undefined,
      summaryRows: Array.isArray(args?.summaryRows) ? args.summaryRows : undefined,
      priorities: Array.isArray(args?.priorities) ? args.priorities : undefined,
      teams: Array.isArray(args?.teams) ? args.teams : undefined,
      activeWork: Array.isArray(args?.activeWork) ? args.activeWork : undefined,
    };
    const counts = [
      artifact.summaryRows?.length ? `${artifact.summaryRows.length} summary` : '',
      artifact.priorities?.length ? `${artifact.priorities.length} priorities` : '',
      artifact.teams?.length ? `${artifact.teams.length} teams` : '',
      artifact.activeWork?.length ? `${artifact.activeWork.length} active` : '',
    ].filter(Boolean).join(', ');
    return {
      name,
      args,
      result: `Agent work snapshot ready${counts ? ` — ${counts}` : ''}.`,
      error: false,
      extra: { richArtifacts: [artifact] },
    };
  }

  if (name === 'show_sources') {
    const normalizedItems = normalizeSourceArtifactItems(Array.isArray(args?.items) ? args.items : []);
    // Items the model already wrote out need no page fetch (was 1.7 s for 3
    // links); only bare URLs are enriched, with a short budget.
    const complete = (i: any) => !!String(i?.title || '').trim() && !!String(i?.url || '').trim();
    const items = normalizedItems.every(complete)
      ? normalizedItems
      : await enrichSourceArtifactItems(normalizedItems, { metadataTimeoutMs: 1200, imageTimeoutMs: 1000 });
    if (!items.length) return { name, args, result: 'show_sources requires at least one item with a title or url.', error: true };
    args = { ...args, items };
    try {
      getResourceStore(workspacePath).registerSourceItems(sessionId, items as Array<Record<string, unknown>>, {
        actor: 'show_sources',
        origin: 'tool_observation',
      });
    } catch (error: any) {
      console.warn('[Resources] Source-card registration skipped:', redactResourceText(error?.message || error));
    }
    const artifact = {
      id: `sources-${Date.now()}`,
      type: 'sources' as const,
      title: args?.title ? String(args.title) : undefined,
      layout: args?.layout === 'list' ? 'list' : 'cards',
      items,
    };
    return {
      name,
      args,
      result: `Sources card ready — ${items.length} source(s).`,
      error: false,
      extra: { richArtifacts: [artifact] },
    };
  }

  if (name === 'show_market') {
    const tr = await executeMarketLookup({
      coins: args?.coins ?? args?.symbols ?? args?.query,
      vs_currency: args?.vs_currency != null ? String(args.vs_currency) : undefined,
      sparkline: typeof args?.sparkline === 'boolean' ? args.sparkline : undefined,
    });
    return {
      name,
      args,
      result: tr?.stdout || tr?.error || JSON.stringify(tr || {}),
      error: tr?.success === false,
      data: tr?.data,
      extra: tr?.extra,
    };
  }

  if (name === 'show_stocks') {
    const tr = await executeStockLookup({
      symbols: args?.symbols ?? args?.tickers ?? args?.query,
      range: args?.range != null ? String(args.range) : undefined,
    });
    return {
      name,
      args,
      result: tr?.stdout || tr?.error || JSON.stringify(tr || {}),
      error: tr?.success === false,
      data: tr?.data,
      extra: tr?.extra,
    };
  }

  if (name === 'show_weather') {
    const tr = await executeWeatherLookup({
      location: args?.location != null ? String(args.location) : undefined,
      latitude: args?.latitude != null ? Number(args.latitude) : undefined,
      longitude: args?.longitude != null ? Number(args.longitude) : undefined,
      unit: args?.unit != null ? String(args.unit) : undefined,
      days: args?.days != null ? Number(args.days) : undefined,
    });
    return {
      name,
      args,
      result: tr?.stdout || tr?.error || JSON.stringify(tr || {}),
      error: tr?.success === false,
      data: tr?.data,
      extra: tr?.extra,
    };
  }

  if (name === 'show_comparison' && Array.isArray(args?.products) && args.products.length >= 2) {
    // Product-column mode: each product is a column (image, price, link), each
    // spec is a row. Rendered by the shared cards/ runtime on every surface.
    const products = args.products.filter((p: any) => p && typeof p === 'object').slice(0, 5).map((p: any) => ({
      title: String(p.title || p.name || '').trim(),
      imageUrl: p.imageUrl ? String(p.imageUrl) : (p.image ? String(p.image) : ''),
      url: String(p.url || p.productUrl || ''),
      price: p.price != null ? String(p.price) : '',
      rating: Number.isFinite(Number(p.rating)) ? Number(p.rating) : undefined,
      badge: p.badge ? String(p.badge) : '',
      specs: p.specs && typeof p.specs === 'object' && !Array.isArray(p.specs) ? p.specs : {},
    })).filter((p: any) => p.title);
    if (products.length < 2) return { name, args, result: 'show_comparison products mode needs at least 2 products with a title.', error: true };
    const specKeys = Array.isArray(args?.specs) && args.specs.length
      ? args.specs.map(String)
      : [...new Set(products.flatMap((p: any) => Object.keys(p.specs)))];
    const artifact = { id: `product-comparison-${Date.now()}`, type: 'product_comparison' as const, title: args?.title ? String(args.title) : undefined, products, specs: specKeys.slice(0, 20) };
    return { name, args, result: `Product comparison ready: ${products.length} products x ${artifact.specs.length} specs.`, error: false, extra: { richArtifacts: [artifact] } };
  }
  if (name === 'show_comparison') {
    const columns = (Array.isArray(args?.columns) ? args.columns : [])
      .map((c: any) => (typeof c === 'string' ? { key: c, label: c } : { key: String(c?.key || c?.label || ''), label: String(c?.label || c?.key || '') }))
      .filter((c: any) => c.key);
    // Accept rows as objects keyed by column (any case), arrays of cells, or
    // {label, values[]}; a row label becomes the first column.
    let labelKey = args?.labelKey ? String(args.labelKey) : '';
    let hasRowLabel = false;
    const rows = (Array.isArray(args?.rows) ? args.rows : []).filter((r: any) => r && typeof r === 'object').map((r: any) => {
      const cells = Array.isArray(r) ? r : (Array.isArray(r.values) ? r.values : Array.isArray(r.cells) ? r.cells : null);
      const out: Record<string, any> = Array.isArray(r) ? {} : { ...r };
      let label = Array.isArray(r) ? '' : String(r.label ?? r.name ?? r.title ?? r.metric ?? '');
      if (cells) {
        let vals = cells;
        if (!label && vals.length === columns.length + 1) { label = String(vals[0] ?? ''); vals = vals.slice(1); }
        columns.forEach((c: any, i: number) => { if (out[c.key] === undefined) out[c.key] = vals[i]; });
      }
      for (const c of columns) {
        if (out[c.key] !== undefined) continue;
        const k = Object.keys(out).find((key) => key.toLowerCase() === c.key.toLowerCase() || key.toLowerCase() === String(c.label).toLowerCase());
        if (k) out[c.key] = out[k];
      }
      if (label && !columns.some((c: any) => out[c.key] === label)) { out.__label = label; hasRowLabel = true; }
      return out;
    });
    if (hasRowLabel && !columns.some((c: any) => c.key === labelKey)) {
      columns.unshift({ key: '__label', label: String(args?.labelHeader || '') });
      labelKey = '__label';
    }
    if (!columns.length || !rows.length) return { name, args, result: 'show_comparison requires columns[] and rows[].', error: true };
    const artifact = {
      id: `comparison-${Date.now()}`,
      type: 'comparison' as const,
      title: args?.title ? String(args.title) : undefined,
      columns,
      rows,
      labelKey: labelKey || undefined,
      highlightColumn: args?.highlightColumn ? String(args.highlightColumn) : undefined,
    };
    return { name, args, result: `Comparison table ready — ${rows.length} row(s) × ${columns.length} column(s).`, error: false, extra: { richArtifacts: [artifact] } };
  }

  if (name === 'show_chart') {
    const series = normalizeChartSeriesArgs(args)
      .map((s: any) => ({
        label: (s?.label ?? s?.name) ? String(s.label ?? s.name) : undefined,
        color: s?.color ? String(s.color) : undefined,
        // `points` is the canonical contract. Accept `data` from older model
        // responses so an otherwise valid visual never fails to render.
        points: (Array.isArray(s?.points) ? s.points : (Array.isArray(s?.data) ? s.data : []))
          .map((p: any, index: number) => ({ x: p?.x ?? p?.label ?? p?.date ?? p?.time ?? index + 1, y: Number(p?.y ?? p?.value) }))
          .filter((p: any) => Number.isFinite(p.y)),
      }))
      .filter((s: any) => s.points.length);
    if (!series.length) return { name, args, result: 'show_chart requires series[] with points[] (or legacy data[]) containing numeric y/value fields.', error: true };
    const artifact = {
      id: `chart-${Date.now()}`,
      type: 'chart' as const,
      title: args?.title ? String(args.title) : undefined,
      chartType: (() => {
        const kinds = ['line', 'bar', 'area', 'scatter', 'pie', 'doughnut'];
        const want = [args?.chartType, args?.kind, args?.type].map((v) => String(v || '').toLowerCase()).find((v) => kinds.includes(v));
        return want || 'line';
      })(),
      series,
      xLabel: args?.xLabel ? String(args.xLabel) : undefined,
      yLabel: args?.yLabel ? String(args.yLabel) : undefined,
      unit: args?.unit ? String(args.unit) : undefined,
      stacked: args?.stacked === true,
      source: args?.source ? String(args.source) : undefined,
      updatedAt: args?.updatedAt ? String(args.updatedAt) : undefined,
    };
    return { name, args, result: `Chart ready — ${series.length} series.`, error: false, extra: { richArtifacts: [artifact] } };
  }

  if (name === 'show_run_result') {
    const files = (Array.isArray(args?.files) ? args.files : [])
      .map((f: any) => (typeof f === 'string' ? { path: f } : { path: String(f?.path || ''), label: f?.label ? String(f.label) : undefined }))
      .filter((f: any) => f.path);
    const links = (Array.isArray(args?.links) ? args.links : [])
      .map((l: any) => ({ label: String(l?.label || l?.href || 'Link'), href: String(l?.href || '') }))
      .filter((l: any) => l.href);
    const artifact = {
      id: `run_result-${Date.now()}`,
      type: 'run_result' as const,
      title: String(args?.title || 'Task complete'),
      taskId: args?.taskId ? String(args.taskId) : undefined,
      status: args?.status ? String(args.status) : undefined,
      summary: args?.summary ? String(args.summary) : undefined,
      files: files.length ? files : undefined,
      links: links.length ? links : undefined,
    };
    return { name, args, result: `Run result card ready: "${artifact.title}".`, error: false, extra: { richArtifacts: [artifact] } };
  }

  if (name === 'show_prediction_market') {
    const tr = await executePolymarketLookup({
      query: args?.query != null ? String(args.query) : undefined,
      slug: args?.slug != null ? String(args.slug) : undefined,
      limit: args?.limit != null ? Number(args.limit) : undefined,
    });
    return {
      name,
      args,
      result: tr?.stdout || tr?.error || JSON.stringify(tr || {}),
      error: tr?.success === false,
      data: tr?.data,
      extra: tr?.extra,
    };
  }

  if (name === 'show_map') {
    const tr = await executeMapLookup({
      markers: Array.isArray(args?.markers) ? args.markers : [],
      center: args?.center,
      zoom: args?.zoom != null ? Number(args.zoom) : undefined,
      title: args?.title != null ? String(args.title) : undefined,
    });
    return {
      name,
      args,
      result: tr?.stdout || tr?.error || JSON.stringify(tr || {}),
      error: tr?.success === false,
      data: tr?.data,
      extra: tr?.extra,
    };
  }

  const capabilityDispatch = await executeRegisteredCapabilityTool({
    name,
    args,
    workspacePath,
    deps,
    sessionId,
  });
  if (capabilityDispatch.handled) {
    return capabilityDispatch.result;
  }

	  const broadcastBrowserStatus = async (toolName: string, options?: { includeFrame?: boolean }) => {
    try {
      if (!deps.broadcastWS) return;
      const info = getBrowserSessionInfo(sessionId);
      const browserMeta = getBrowserSessionMetadata(sessionId);
      const defaultIncludeFrame = toolName === 'browser_snapshot' || toolName === 'browser_vision_screenshot';
      const shouldIncludeFrame = info.active === true && (options?.includeFrame ?? defaultIncludeFrame);
      const frame = shouldIncludeFrame
        ? await browserVisionScreenshot(sessionId).catch(() => null)
        : null;
      const payload = {
        type: 'browser:status',
        sessionId,
        tool: toolName,
        active: info.active === true,
        url: info.url || '',
        title: info.title || '',
        mode: info.mode || 'agent',
        captured: info.captured === true,
        controlOwner: info.controlOwner || 'agent',
        streamActive: info.streamActive === true,
        streamTransport: info.streamTransport || '',
        streamFocus: info.streamFocus || 'passive',
        browserTarget: info.browserTarget || '',
        profileKind: info.profileKind || '',
        profileLabel: info.profileLabel || '',
        profileDir: info.profileDir || '',
        debugPort: info.debugPort || 0,
        frameBase64: frame?.base64 || '',
        frameWidth: Number(frame?.width || 0),
        frameHeight: Number(frame?.height || 0),
        frameFormat: frame?.base64 ? 'png' : '',
        browserOwnerType: browserMeta.ownerType,
        browserOwnerId: browserMeta.ownerId || '',
        browserLabel: browserMeta.label || '',
        browserTaskPrompt: browserMeta.taskPrompt || '',
        browserSpawnerSessionId: browserMeta.spawnerSessionId || '',
        timestamp: Date.now(),
      };
      deps.broadcastWS(payload);
      if (info.active === true && (toolName === 'browser_open' || toolName === 'browser_snapshot')) {
        deps.broadcastWS({ ...payload, type: 'browser:open' });
      }
    } catch {}
  };
  const maybeBroadcastBrowserStatus = async (toolName: string, observe?: unknown, options?: { includeFrame?: boolean }) => {
    if (String(observe || '').trim().toLowerCase() === 'none') {
      void broadcastBrowserStatus(toolName, options).catch(() => {});
      return;
    }
    await broadcastBrowserStatus(toolName, options);
  };

  try {
    if (BROWSER_CONTROL_GATED_TOOLS.has(name)) {
      try {
        await waitForBrowserControlRelease(sessionId, name);
      } catch (err: any) {
        return {
          name,
          args,
          result: String(err?.message || err || `Browser tool "${name}" paused for Co-pilot control.`),
          error: true,
        };
      }
    }
    switch (name) {
      case 'declare_plan':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'agent_run_ops':
        case 'chat_with_subagent':
        case 'agent_message_send':
        case 'agent_turn_request':
        case 'agent_reply_wait':
        case 'agent_thread_watch':
        case 'dispatch_team_agent':
        return await handleAgentsTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'list_files':
        case 'list_directory':
        case 'read_files_batch':
        case 'read_file':
        case 'mkdir':
        case 'create_file':
        case 'write_file':
        case 'append_file':
        case 'replace_lines':
        case 'insert_after':
        case 'delete_lines':
        case 'find_replace':
        case 'rename_file':
        case 'delete_file':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'copy_file':
      case 'move_file':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'copy_directory':
      case 'move_directory':
        case 'path_exists':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'show_diff':
      case 'git_diff':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'preview_patch':
      case 'apply_patch':
        case 'validate_file':
        case 'validate_source':
        case 'validate_prom_file':
        case 'validate_webui_source':
        case 'file_stats':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'source_stats_batch':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'source_stats':
      case 'src_stats':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'prom_file_stats':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'webui_source_stats':
      case 'webui_stats':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'grep_file':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'search_files':
      case 'grep_files':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'apply_workspace_patchset':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'file_tree':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'grep_webui_source':
      case 'grep_source':
        case 'grep_prom':
        case 'read_dev_sources':
        case 'apply_dev_source_patchset':
        case 'read_source':
        case 'delete_source':
        case 'list_source':
        case 'list_prom':
        case 'read_prom_file':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'find_replace_prom':
        case 'replace_lines_prom':
        case 'insert_after_prom':
        case 'delete_lines_prom':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'write_prom_file':
        case 'delete_prom_file':
        case 'list_webui_source':
        case 'read_webui_source':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'find_replace_source':
        case 'replace_lines_source':
        case 'insert_after_source':
        case 'delete_lines_source':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'write_source':
        case 'list_source':
        case 'list_webui_source':
        case 'read_webui_source':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'find_replace_webui_source':
        case 'replace_lines_webui_source':
        case 'insert_after_webui_source':
        case 'delete_lines_webui_source':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'write_webui_source':
        case 'delete_webui_source':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'delivery_send':
        case 'delivery_send_screenshot':
        case 'send_telegram':
        return await handleDeliveryTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'deploy_analysis_team':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'present_file':
        return await handleDeliveryTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'enter_creative_mode':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'switch_creative_mode':
        case 'get_creative_mode':
        case 'creative_list_references':
        return await handleExistingTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'exit_creative_mode':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      // Creative, video and HyperFrames handlers live in handlers/creative.ts.
      case 'creative_list_motion_templates':
      case 'creative_preview_motion_template':
      case 'creative_generate_motion_variants':
      case 'creative_import_asset':
      case 'creative_attach_audio_from_url':
      case 'creative_attach_audio_from_file':
      case 'creative_analyze_asset':
      case 'creative_search_assets':
      case 'creative_generate_asset':
      case 'creative_create_project':
      case 'creative_project_history':
      case 'creative_create_storyboard':
      case 'creative_storyboard_history':
      case 'creative_write_shot_prompt':
      case 'creative_render_ascii_asset':
      case 'creative_extract_video_frame':
      case 'creative_extract_video_frames':
      case 'creative_register_generation':
      case 'creative_generation_history':
      case 'creative_generate_image_shot':
      case 'creative_generate_video_shot':
      case 'creative_analyze_generated_video':
      case 'creative_compare_shots':
      case 'creative_select_best_take':
      case 'creative_retry_shot_until_pass':
      case 'creative_refine_video_shot':
      case 'creative_generate_sequence':
      case 'creative_extract_layers_for_generation':
      case 'creative_pick_continuity_frame':
      case 'creative_chain_scene':
      case 'creative_wrap_video_as_html_motion_clip':
      case 'creative_add_generated_clip_to_composition':
      case 'creative_render_generated_sequence':
      case 'creative_stitch_clips':
      case 'creative_auto_assemble_rough_cut':
      case 'creative_normalize_layer_specs':
      case 'creative_validate_composition_layers':
      case 'creative_preflight_overlay':
      case 'creative_sample_composite_frames':
      case 'creative_generate_motion_graphics_layer':
      case 'creative_overlay_hyperframes_on_video':
      case 'creative_composite_video_layers':
      case 'creative_import_audio':
      case 'creative_download_audio':
      case 'creative_extract_audio_from_video':
      case 'creative_generate_voiceover':
      case 'creative_transcribe_audio':
      case 'creative_sync_captions_to_audio':
      case 'creative_add_audio_track':
      case 'creative_mix_audio_tracks':
      case 'creative_add_music_bed':
      case 'creative_add_sound_effects':
      case 'creative_model_status':
      case 'creative_extract_layers':
      case 'creative_list_html_motion_templates':
      case 'creative_list_hyperframes_components':
      case 'creative_import_hyperframes_component':
      case 'creative_sync_hyperframes_catalog':
      case 'creative_list_library_packs':
      case 'creative_create_library_pack':
      case 'creative_toggle_library_pack':
      case 'creative_save_html_motion_template':
      case 'creative_save_html_motion_block':
      case 'creative_promote_scene_to_template':
      case 'creative_lint_html_motion_clip':
      case 'creative_measure_text':
      case 'creative_text_fit_report':
      case 'creative_list_html_motion_blocks':
      case 'creative_render_html_motion_block':
      case 'hyperframes_browse_catalog':
      case 'hyperframes_insert_clip':
      case 'hyperframes_apply_patch':
      case 'hyperframes_set_text':
      case 'hyperframes_set_color':
      case 'hyperframes_set_timing':
      case 'hyperframes_set_variable':
      case 'hyperframes_set_asset':
      case 'hyperframes_add_animation':
      case 'hyperframes_lint':
      case 'hyperframes_qa':
      case 'hyperframes_materialize':
      case 'hyperframes_export':
      case 'creative_apply_hyperframes_component':
      case 'creative_apply_html_motion_template':
      case 'creative_get_state':
      case 'creative_reset_scene':
      case 'creative_purge_scene':
      case 'creative_element_inventory':
      case 'creative_frame_trace':
      case 'creative_frame_diff':
      case 'creative_history_status':
      case 'creative_undo':
      case 'creative_redo':
      case 'creative_checkpoint':
      case 'creative_export_trace':
      case 'video_render_frame':
      case 'video_render_contact_sheet':
      case 'video_analyze_frame':
      case 'video_analyze_timeline':
      case 'video_check_keyframes':
      case 'video_check_caption_timing':
      case 'video_check_audio_sync':
      case 'video_extract_clip_frames':
      case 'image_get_element_at_point':
      case 'image_get_overlaps':
      case 'image_get_bounds_summary':
      case 'image_check_text_overflow':
      case 'image_check_contrast':
      case 'image_detect_empty_regions':
      case 'creative_apply_ops':
      case 'creative_select_element':
      case 'creative_set_canvas':
      case 'creative_add_element':
      case 'creative_add_asset':
      case 'creative_add_effect':
      case 'creative_set_blend_mode':
      case 'creative_add_mask':
      case 'creative_trim_clip':
      case 'creative_apply_brand_kit':
      case 'creative_search_icons':
      case 'creative_search_animations':
      case 'creative_update_element':
      case 'creative_delete_element':
      case 'creative_apply_animation':
      case 'creative_arrange':
      case 'creative_apply_style':
      case 'creative_fit_asset':
      case 'creative_apply_template':
      case 'creative_validate_layout':
      case 'creative_quality_report':
      case 'creative_create_html_motion_clip':
      case 'creative_read_html_motion_clip':
      case 'creative_patch_html_motion_clip':
      case 'creative_restore_html_motion_revision':
      case 'creative_render_html_motion_snapshot':
      case 'creative_export_html_motion_clip':
      case 'creative_apply_motion_template':
      case 'creative_timeline':
      case 'creative_render_snapshot':
      case 'creative_export':
      case 'creative_save_scene':
      case 'creative_composition_get':
      case 'creative_composition_add_track':
      case 'creative_composition_add_clip':
      case 'creative_composition_move_clip':
      case 'creative_composition_trim_clip':
      case 'creative_composition_split_at':
      case 'creative_composition_delete_clip':
      case 'creative_composition_set_transition':
      case 'creative_composition_select_clip':
      case 'creative_composition_lint':
      case 'creative_composition_save':
      case 'creative_composition_render':
        return await handleCreativeTool({ name, args, workspacePath, deps, sessionId });
      case 'business_context_mode':
        return await handleMemoryTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'list_entities':
        case 'read_entity':
        case 'write_entity':
        case 'append_entity_event':
        case 'social_intel':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'web_search':
        case 'web_search_single':
        case 'web_search_multi':
        case 'shopping_search_products':
        case 'web_fetch':
        case 'download_url':
        return await handleWebTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'clone_repo':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'download_media':
        case 'generate_image':
        case 'generate_video':
        case 'analyze_image':
        case 'analyze_video':
        return await handleWebTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'video_analyze_imported_video':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'git_status':
        case 'git_log':
        case 'git_branch':
        case 'git_commit':
        case 'git_push':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'open_pr':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'run_tests':
      case 'run_linter':
      case 'run_formatter':
      case 'run_typecheck':
        case 'format_changed_files':
        case 'start_dev_server':
        case 'read_process_output':
        case 'stop_process':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'snapshot_workspace':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'restore_snapshot':
      case 'revert_last_tool_change':
      case 'revert_own_patch':
        case 'scan_large_files':
        case 'scan_secrets':
        case 'operation_plan':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'code_outline':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'get_symbols':
        case 'go_to_definition':
        case 'find_references':
        case 'start_process':
        case 'process_status':
        case 'process_log':
        case 'process_wait':
        case 'process_kill':
        case 'process_submit':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'run_command':
        return await handleWorkspaceTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, approvedCommandApprovalId });

      case 'background_spawn':
        return await handleAgentsTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'background_status':
      case 'background_progress':
        case 'background_steer':
        case 'background_wait':
        case 'background_join':
        return await handleAgentsTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'task_control':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'timer':
        return await handleSchedulingTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'internal_watch':
        return await handleAgentsTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'schedule_job':
        case 'schedule_job_history':
        case 'schedule_job_detail':
        case 'schedule_job_log_search':
        case 'schedule_job_patch':
        case 'schedule_job_outputs':
        case 'schedule_job_stuck_control':
        case 'automation_dashboard':
        return await handleSchedulingTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'team_manage':
        return await handleAgentsTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'switch_model':
        case 'parse_schedule_pattern':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      // Browser + desktop automation handlers live in handlers/browser-desktop.ts.
      case 'browser_doctor':
      case 'browser_set_profile_target':
      case 'browser_open':
      case 'browser_snapshot':
      case 'browser_list_tabs':
      case 'browser_select_tab':
      case 'browser_new_tab':
      case 'browser_close_tab':
      case 'browser_click':
      case 'browser_fill':
      case 'browser_upload_file':
      case 'browser_press_key':
      case 'browser_key':
      case 'browser_type':
      case 'browser_wait':
      case 'browser_scroll':
      case 'browser_drag':
      case 'browser_click_and_download':
      case 'browser_close':
      case 'browser_get_focused_item':
      case 'browser_get_page_text':
      case 'browser_send_to_telegram':
      case 'browser_vision_screenshot':
      case 'browser_vision_click':
      case 'browser_vision_type':
      case 'browser_scroll_collect':
      case 'browser_scroll_collect_v2':
      case 'browser_run_js':
      case 'browser_intercept_network':
      case 'tool_benchmark_summary':
      case 'inspect_console':
      case 'run_accessibility_check':
      case 'browser_smoke_test':
      case 'browser_element_watch':
      case 'browser_snapshot_delta':
      case 'browser_extract_structured':
      case 'browser_teach_verify':
      case 'desktop_doctor':
      case 'desktop_screenshot':
      case 'desktop_get_monitors':
      case 'desktop_window_screenshot':
      case 'desktop_find_window':
      case 'desktop_focus_window':
      case 'desktop_window_control':
      case 'desktop_click':
      case 'desktop_drag':
      case 'desktop_wait':
      case 'desktop_type':
      case 'desktop_press_key':
      case 'desktop_get_clipboard':
      case 'desktop_set_clipboard':
      case 'desktop_list_installed_apps':
      case 'desktop_find_installed_app':
      case 'desktop_launch_app':
      case 'desktop_close_app':
      case 'desktop_get_process_list':
      case 'desktop_wait_for_change':
      case 'desktop_diff_screenshot':
      case 'desktop_list_apps':
      case 'desktop_list_windows':
      case 'desktop_get_window_state':
      case 'desktop_locate_text':
      case 'desktop_click_text':
      case 'desktop_get_accessibility_state':
      case 'desktop_accessibility_action':
      case 'desktop_window_click':
      case 'desktop_window_type':
      case 'desktop_window_press_key':
      case 'desktop_window_scroll':
      case 'desktop_window_drag':
      case 'desktop_get_window_text':
      case 'desktop_get_accessibility_tree':
      case 'desktop_pixel_watch':
      case 'desktop_record_macro':
      case 'desktop_stop_macro':
      case 'desktop_replay_macro':
      case 'desktop_list_macros':
      case 'desktop_background_status':
      case 'desktop_background_prepare_sandbox':
      case 'desktop_background_command':
      case 'desktop_scroll':
      case 'desktop_type_raw':
      case 'desktop_send_to_telegram':
      case 'desktop_task':
        return await handleBrowserDesktopTool({ name, args, workspacePath, deps, sessionId, broadcastBrowserStatus, maybeBroadcastBrowserStatus });
      case 'memory_browse':
        case 'memory_write':
        case 'memory_read':
        case 'memory_search':
        case 'memory_read_record':
        case 'memory_search_project':
        case 'memory_search_timeline':
        case 'memory_get_related':
        case 'memory_graph_snapshot':
        case 'memory_index_refresh':
        case 'write_note':
        return await handleMemoryTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'save_site_shortcut':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'architect_workflow':
      case 'verify_workflow_credentials':
      case 'test_workflow':
      case 'deploy_workflow':
      case 'get_workflow_status':
      case 'search_workflow_templates':
      case 'execute_workflow_template':
      case 'create_node_subagent':
        return await handleMiscTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });

      case 'skill_list':
        case 'skill_read':
        case 'skill_resource_list':
        case 'skill_resource_read':
        case 'skill_import_bundle':
        case 'skill_inspect':
        case 'skill_manifest_write':
        case 'skill_create_bundle':
        case 'skill_resource_write':
        case 'skill_resource_delete':
        case 'skill_export_bundle':
        case 'skill_update_from_source':
        case 'skill_create':
        case 'skill_audit_all':
        case 'skill_update_metadata':
        case 'skill_repair_metadata':
        return await handleMemoryTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname });
 default: return await handleDefaultTool({ ...workspaceHelpers, name, args, workspacePath, deps, sessionId, __dirname, resolveProposalExecutionTask, isDevSourceWriteApprovedSession, isGoalAutonomousApprovalBypass });

    }
  } catch (err: any) {
    if (name.startsWith('desktop_') && isDesktopCancellationError(err)) {
      return { name, args, result: 'ERROR: [DESKTOP_CANCELLED] Desktop operation was interrupted.', error: true, data: { ok: false, code: 'DESKTOP_CANCELLED', retryable: true } };
    }
    return { name, args, result: `Error: ${err.message}`, error: true };
  }
  };
  if (!externalSideEffect) return dispatch();
  const result = await getOperationLedger().execute({ sessionId, toolName: name, args }, dispatch, forceReexecute);
  return { name, args, ...result };
}
