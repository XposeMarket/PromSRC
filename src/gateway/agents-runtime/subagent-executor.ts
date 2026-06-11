// src/gateway/subagent-executor.ts
// Tool execution engine — extracted from server-v2.ts (Step 14.1, Phase 3).
// Restored and adapted for dep-injected execution.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveRuntimeBinary } from '../../runtime/dependencies';
import { getConfig, getAgents, getAgentById } from '../../config/config';
import { parseProviderModelRef } from '../../agents/model-routing.js';
import { resetProvider } from '../../providers/factory.js';
import { getPolicyEngine } from '../policy';
import { appendAuditEntry } from '../audit-log';
import { webSearch } from '../../tools/web';
import { executeWebFetch, executeShoppingSearchProducts } from '../../tools/web';
import { executeMarketLookup } from '../../tools/market';
import { executeWeatherLookup } from '../../tools/weather';
import { executeMapLookup } from '../../tools/mapcard';
import { executeStockLookup } from '../../tools/stocks';
import { executePolymarketLookup } from '../../tools/polymarket';
import { executeAgentList, executeAgentInfo } from '../../tools/agent-control';
import { executeDownloadMedia, executeDownloadUrl } from '../../tools/download-tools';
import { executeAnalyzeImage, executeAnalyzeVideo } from '../../tools/media-analysis';
import { executeGenerateImage } from '../../tools/generate-image';
import { executeGenerateVideo } from '../../tools/generate-video';
import { getActiveAllowedWorkspaces, hasActiveWorkspaceScope } from '../../tools/workspace-context';
import { getMCPManager } from '../mcp-manager';
import { getProcessSupervisor } from '../process/supervisor';
import { executeAgentBuilderTool } from './agent-builder-integration';
import { SubagentManager } from './subagent-manager';
import { appendSubagentChatMessage } from './subagent-chat-store';
import { formatIntradayNoteSourceLine, inferIntradayNoteSource } from '../intraday-note-source';
import {
  creativeAnalyzeGeneratedVideo,
  creativeAddAudioTrack,
  creativeAddMusicBed,
  creativeAddSoundEffects,
  creativeAutoAssembleRoughCut,
  creativeChainScene,
  creativeCompareShots,
  creativeCompositeVideoLayers,
  creativeCreateProject,
  creativeCreateStoryboard,
  creativeExtractVideoFrame,
  creativeExtractVideoFrames,
  creativeExtractLayersForGeneration,
  creativeGenerateImageShot,
  creativeGenerateMotionGraphicsLayer,
  creativeGenerateSequence,
  creativeGenerateVideoShot,
  creativeGetProject,
  creativeGetStoryboard,
  creativeDownloadAudio,
  creativeExtractAudioFromVideo,
  creativeListGenerations,
  creativeListProjects,
  creativeListStoryboards,
  creativeGenerateVoiceover,
  creativeImportAudio,
  creativeMixAudioTracks,
  creativeNormalizeLayerSpecs,
  creativeOverlayHyperframesOnVideo,
  creativePickContinuityFrame,
  creativePreflightOverlay,
  creativeRegisterGeneration,
  creativeRenderGeneratedSequence,
  creativeRefineVideoShot,
  creativeRetryShotUntilPass,
  creativeSampleCompositeFrames,
  creativeSelectBestTake,
  creativeStitchClips,
  creativeSyncCaptionsToAudio,
  creativeTranscribeAudio,
  creativeWrapVideoAsHtmlMotionClip,
  creativeWriteShotPrompt,
  creativeValidateCompositionLayers,
} from '../creative/generative-pipeline';
import { buildObsoleteBrandBlockMessage, containsObsoleteProductBrand, normalizeWorkspaceAliasPath } from '../scheduled-output-guard';
import {
  listManagedTeams,
  createManagedTeam,
  getManagedTeam,
  saveManagedTeam,
  deleteManagedTeam,
  appendTeamChat,
  appendTeamRoomMessage,
  appendMainAgentThread,
  queueAgentMessage,
  updateTeamFocus,
  updateTeamMission,
  logCompletedWork,
  addTeamMilestone,
  updateTeamMilestone,
  pauseTeamAgent,
  unpauseTeamAgent,
  updateTeamMemberState,
  upsertTeamPlanItem,
  shareTeamArtifact,
  createTeamDispatchRecord,
  updateTeamDispatchRecord,
  listTeamContextReferences,
  addTeamContextReference,
  updateTeamContextReference,
  deleteTeamContextReference,
} from '../teams/managed-teams';
import { triggerManagerReview, handleManagerConversation, verifySubagentResult } from '../teams/team-manager-runner';
import { parseTeamMemberDirectSessionId, parseTeamMemberRoomSessionId, runTeamMemberRoomTurn, scheduleTeamMemberAutoWake } from '../teams/team-member-room';
import { routeTeamEvent } from '../teams/team-event-router';
import { appendTeamMemoryEvent, claimAgentForTeamWorkspace } from '../teams/team-workspace';
import { notifyMainAgent } from '../teams/notify-bridge';
import { recordAgentRun, reloadAgentSchedules } from '../../scheduler';
import { normalizeScheduleSpec, parseSchedulePattern } from '../scheduling/schedule-pattern';
import { getSessionChannelHint, linkTelegramSession } from '../comms/broadcaster';

const getTeamDispatchRuntime = () => require('../teams/team-dispatch-runtime') as typeof import('../teams/team-dispatch-runtime');
const getBgAgentResults = () => getTeamDispatchRuntime()._bgAgentResults;
const buildTeamDispatchTaskLazy: typeof import('../teams/team-dispatch-runtime')['buildTeamDispatchTask'] = (...args) => {
  const { buildTeamDispatchTask } = getTeamDispatchRuntime();
  return buildTeamDispatchTask(...args);
};
import {
  browserOpen,
  browserSetProfileTarget,
  browserSnapshot,
  browserListTabs,
  browserSelectTab,
  browserNewTab,
  browserCloseTab,
  browserClick,
  browserFill,
  browserUploadFile,
  browserPressKey,
  browserType,
  browserWait,
  browserScroll,
  browserDrag,
  browserClickAndDownload,
  browserClose,
  browserGetFocusedItem,
  browserGetPageText,
  browserVisionScreenshot,
  browserVisionClick,
  browserVisionType,
  browserSendToTelegram,
  browserScrollCollect,
  browserScrollCollectV2,
  browserRunJs,
  browserInterceptNetwork,
  browserElementWatch,
  browserSnapshotDelta,
  browserExtractStructured,
  browserTeachVerify,
  browserDoctor,
  resolveBrowserObserveMode,
  getBrowserSessionInfo,
  getBrowserSessionMetadata,
  waitForBrowserControlRelease,
} from '../browser-tools';
import {
  desktopScreenshotWithHistory,
  parseDesktopScreenshotToolArgs,
  parseDesktopPointerMonitorArgs,
  resolveDesktopActionPoint,
  desktopFindWindow,
  desktopFocusWindow,
  desktopClick,
  desktopDrag,
  desktopWait,
  desktopType,
  desktopTypeRaw,
  desktopPressKey,
  desktopGetClipboard,
  desktopSetClipboard,
  desktopListInstalledApps,
  desktopFindInstalledApp,
  desktopLaunchApp,
  desktopCloseApp,
  desktopGetProcessList,
  desktopGetMonitorsSummary,
  desktopWaitForChange,
  getDesktopActiveWindowInfo,
  desktopDiffScreenshot,
  desktopWindowScreenshot,
  desktopWindowControl,
  desktopScroll,
  desktopSendToTelegram,
  getDesktopAdvisorPacket,
  getDesktopAdvisorPacketById,
  desktopBackgroundStatus,
  desktopBackgroundPrepareSandbox,
  desktopBackgroundCommand,
  desktopDoctor,
  desktopGetWindowText,
  desktopGetAccessibilityTree,
  desktopPixelWatch,
  desktopRecordMacro,
  desktopStopMacro,
  desktopReplayMacro,
  desktopListMacros,
  desktopListApps,
  desktopListWindowsCanonical,
  desktopGetWindowState,
  desktopWindowClick,
  desktopWindowType,
  desktopWindowPressKey,
  desktopWindowScroll,
  desktopWindowDrag,
} from '../desktop-tools';
import { deliverToTargets, readAttachmentBuffer } from '../delivery-router';
import { executeDeliverySendScreenshot } from '../delivery-screenshot.js';
import {
  refreshMemoryIndexFromAudit,
  searchMemoryIndex,
  readMemoryRecord,
  searchProjectMemory,
  searchMemoryTimeline,
  getMemoryGraphSnapshot,
  getRelatedMemory,
} from '../memory-index/index';
// import { runDesktopTask } from '../tasks/desktop-task-runner'; // removed — module deleted
import { backgroundSpawn, backgroundStatus, backgroundJoin, backgroundProgress, backgroundWait } from '../tasks/task-runner';
import { saveSiteShortcut } from '../site-shortcuts';
import { deployAnalysisTeamTool } from '../../tools/deploy-analysis-team.js';
import { socialIntelTool } from '../../tools/social-scraper.js';
import {
  ALL_TOOL_CATEGORIES,
  getRuntimeToolCategories,
  normalizeScheduleJobAction,
  summarizeCronJob,
  normalizeDeliveryChannel,
  normalizeToolCategory,
  normalizeToolArgsForTool,
  parseJsonLike,
  parseLooseMap,
  toStringRecord,
  type ToolCategory,
  type ToolResult,
  type TaskControlResponse,
} from '../tool-builder';
import { activateSkillForSession, activateSkillResourceForSession, activateToolCategory, addCreativeReferences, formatCreativeReferencesForPrompt, getCanvasProjectRoot, getCreativeMode, getCreativeReferences, getSessionMutationScope, isBusinessContextEnabled, normalizeCreativeMode, setBusinessContextEnabled, setCreativeMode } from '../session';
import { sendCreativeCommand } from '../creative/command-bus';
import type { HyperframesPatchOp } from '../creative/hyperframes-bridge';
import { summarizeHtmlMotionTemplates, applyHtmlMotionTemplate } from '../creative/html-motion-templates';
import { lintHtmlMotionComposition } from '../creative/html-motion-spec';
import { checkTextFit, reportHtmlTextFit } from '../creative/pretext-measure';
import { listHtmlMotionBlocks, renderHtmlMotionBlock } from '../creative/html-motion-blocks';
import {
  buildCreativeLibraryPayload,
  createCreativeLibraryPack,
  saveCustomHtmlMotionBlock,
  saveCustomHtmlMotionTemplate,
  saveCustomSceneTemplate,
  toggleCreativeLibraryPack,
} from '../creative/custom-registries';
import { buildConnectorStatus } from '../tool-builder';
import { ensurePrometheusExtensionRuntimeLoaded } from '../../extensions/legacy-connector-adapter';
import { getExtensionRuntimeRegistry } from '../../extensions/runtime-registry';
import { appendJournal, createTask, listTasks, loadTask, saveTask, setTaskStepRunning, updateTaskStatus } from '../tasks/task-store';
import { ensureScheduleRuntimeForAgent } from '../scheduling/schedule-agent';
import { bindTaskRunToSession, getTaskRunBinding } from '../tasks/task-run-mirror';
import type { SkillWindow } from '../prompt-context';
import { isToolHiddenInPublicBuild, resolvePrometheusRoot } from '../../runtime/distribution.js';
import { getApprovalQueue, serializeApprovalForClient } from '../verification-flow.js';
import {
  createPrometheusQuestionPayload,
  getPrometheusQuestionQueue,
  serializePrometheusQuestionForClient,
  type PrometheusQuestionAnswer,
} from '../prometheus-questions.js';
import { findCommandPermissionGrant, type ToolPermissionCandidate } from '../command-permissions';
import {
  evaluateHardToolDeny,
  formatHardToolDeny,
  type HardToolDenyDecision,
  type ToolExecutionPolicy,
} from '../tool-deny-policy';
import { DEV_SRC_SELF_EDIT_MODE, DEV_SRC_SELF_EDIT_REPAIR_MODE } from '../proposals/dev-src-self-edit.js';
import {
  createDevSourceEditApprovalScope,
  type DevSourceEditScope,
  getDevSourceEditContinuation,
  grantDevSourceEditApproval,
  getLatestPendingDevSourceEditContinuation,
  getDevSourceEditGrant,
  hasDevSourceEditGrant,
  markDevSourceEditContinuationComplete,
  upsertDevSourceEditContinuation,
} from '../dev-source-approvals.js';
import {
  formatDevVerificationSummary,
  resolveDevVerificationPlan,
  runDevVerificationPlan,
} from '../dev-verification.js';
import {
  consumeFinalActionApproval,
  createFinalActionApprovalScope,
  grantFinalActionApproval,
} from '../final-action-approvals.js';
import {
  cancelMainChatTimer,
  createMainChatTimer,
  listMainChatTimers,
  updateMainChatTimer,
} from '../timers/timer-store';
import {
  cancelInternalWatch,
  createInternalWatch,
  listInternalWatches,
} from '../internal-watch/internal-watch-store';
import { observeInternalWatchTarget } from '../internal-watch/internal-watch-runner';
import {
  automationDashboardTool,
  scheduleJobDetailTool,
  scheduleJobHistoryTool,
  scheduleJobLogSearchTool,
  scheduleJobOutputsTool,
  scheduleJobPatchTool,
  scheduleJobStuckControlTool,
} from '../scheduling/schedule-admin-tools';
import { executeRegisteredCapabilityTool } from './capabilities/registry';
import { appendEntityEvent, listEntities, readEntity, writeEntity } from '../business/entity-store';

const getCreativeMotionRuntime = () => require('../creative/motion-runtime') as typeof import('../creative/motion-runtime');
const getCreativeAssets = () => require('../creative/assets') as typeof import('../creative/assets');
const getCreativeLayerExtraction = () => require('../creative/layer-extraction') as typeof import('../creative/layer-extraction');
const getCreativeAsciiRenderRuntime = () => require('../creative/ascii-render-runtime') as typeof import('../creative/ascii-render-runtime');
const getHyperframesCatalog = () => require('../creative/hyperframes-catalog') as typeof import('../creative/hyperframes-catalog');
const getHyperframesBridge = () => require('../creative/hyperframes-bridge') as typeof import('../creative/hyperframes-bridge');
const getHyperframesExportAdapter = () => require('../creative/hyperframes-export-adapter') as typeof import('../creative/hyperframes-export-adapter');
const getHyperframesQa = () => require('../creative/hyperframes-qa') as typeof import('../creative/hyperframes-qa');
const getHyperframesProducer = () => require('../creative/hyperframes-producer') as typeof import('../creative/hyperframes-producer');

const VIDEO_MODE_REMOVED_SCENE_TOOL_NAMES = new Set([
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

function videoModeHtmlMotionOnlyError(name: string, args: any = {}): ToolResult {
  return {
    name,
    args,
    result:
      `${name}: scene-graph/shape animation tools have been removed from Video mode. ` +
      'Use HTML Motion, HyperFrames, Remotion motion templates, and Pretext QA tools instead.',
    error: true,
  };
}

function isLegacySceneGraphCompositionPayload(args: any): boolean {
  const lane = String(args?.lane || '').trim().toLowerCase();
  const sourceKind = String(args?.source?.kind || '').trim().toLowerCase();
  return lane === 'scene-graph' || sourceKind === 'scene-graph' || (!lane && !sourceKind);
}

export interface ExecuteToolDeps {
  cronScheduler: any;
  broadcastWS: (data: any) => void;
  sendSSE?: (event: string, data: any) => void;
  handleChat: (...args: any[]) => Promise<any>;
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
  runCommandCaptured: (command: string, cwd: string, timeoutMs?: number, options?: { shell?: string; pty?: boolean; approvalId?: string }) => Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean; runId?: string }>;
  skillsManager: any;
  getSessionSkillWindows: (sessionId: string) => Map<string, SkillWindow>;
  sessionCurrentTurn: Map<string, number>;
  executionPolicy?: ToolExecutionPolicy;
  onHardToolDeny?: (event: { sessionId: string; toolName: string; args: any; decision: HardToolDenyDecision }) => void;
}


function looksLikeNativeFileToolBypass(command: string): boolean {
  const raw = String(command || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const isInlineInterpreter =
    /^(python|python3|py|node)\s+(-c|-e|<<|@')\b/.test(lower)
    || /^(powershell|pwsh)\b.*\b(command|encodedcommand|set-content|add-content|out-file|new-item|remove-item|move-item|copy-item)\b/.test(lower);
  const hasWriteApi =
    /\b(writefile|writefilesync|appendfile|appendfilesync|set-content|add-content|out-file|new-item|remove-item|move-item|copy-item)\b/.test(lower);
  const hasShellRedirect =
    /(^|\s)(echo|printf|type|copy|set-content|add-content|out-file)\b[\s\S]*(>|>>|\|\s*(set-content|add-content|out-file)\b)/.test(lower);

  return (isInlineInterpreter && hasWriteApi) || hasShellRedirect;
}

function commandContainsBlockedPattern(command: string, blockedPatterns: string[] | undefined): string | null {
  const cmd = String(command || '').toLowerCase();
  for (const rawBlocked of blockedPatterns || []) {
    const blocked = String(rawBlocked || '').trim().toLowerCase();
    const token = blocked.replace(/\s+/g, '');
    if (!token) continue;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[\\s;&|()])${escaped}($|[\\s;&|()])`, 'i').test(cmd)) {
      return blocked;
    }
  }
  return null;
}

async function maybeSendCreativeExportToTelegram(sessionId: string, creativeResult: any, telegramChannel: any): Promise<void> {
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

const devServerProcesses = new Map<string, {
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

function loadBusinessContextSnapshot(workspacePath: string, maxChars: number = 4000): string {
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

function sanitizeCreativeStorageSegment(raw: string, fallback = 'default'): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

function buildCreativeStorageForTool(workspacePath: string, sessionId: string): {
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

function buildCreativeWorkspaceRelativePath(workspacePath: string, absPath: string): string {
  const rel = path.relative(workspacePath, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : absPath.replace(/\\/g, '/');
}

function resolveWorkspaceFilePath(workspacePath: string, rawPath: string): string {
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

function mergeHyperframesInputs(args: any = {}): Record<string, any> {
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

function wrapHyperframesBlockAsDocument(rendered: any, options: any = {}) {
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

async function readSelectedHyperframesClipFromEditor(
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

async function patchHyperframesClipInEditor(input: {
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

function registerCreativeReferencesFromXPayload(sessionId: string, payload: any): number {
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

function firstDownloadedMediaFile(toolResult: any): any | null {
  const files = Array.isArray((toolResult as any)?.data?.files) ? (toolResult as any).data.files : [];
  return files.find((file: any) => file?.path || file?.rel_path) || null;
}

function normalizeCreativeAudioTags(input: any): string[] {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const tags = raw.map((tag) => String(tag || '').trim()).filter(Boolean);
  return [...new Set(['audio', 'background-music', ...tags])];
}

function ensureCreativeLocalWorkspacePath(workspacePath: string, rawSource: string): string {
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

function inferCreativeLocalMediaKind(absPath: string): 'audio' | 'video' | 'unknown' {
  const ext = path.extname(absPath).toLowerCase();
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) return 'audio';
  if (['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm'].includes(ext)) return 'video';
  return 'unknown';
}

async function extractCreativeAudioFromVideo(sourceAbsPath: string, outputDir: string): Promise<string> {
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

function resolveCreativeEditorTimeoutMs(toolName: string, args?: any): number {
  if (toolName === 'creative_export' || toolName === 'creative_export_html_motion_clip') return 720000;
  if (toolName === 'creative_attach_audio_from_url' || toolName === 'creative_attach_audio_from_file') return 120000;
  if (['creative_download_audio', 'creative_generate_voiceover', 'creative_transcribe_audio', 'creative_mix_audio_tracks', 'creative_extract_audio_from_video'].includes(toolName)) return 180000;
  if (toolName === 'creative_create_html_motion_clip') return 60000;
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

function resolveBoundedToolTimeoutMs(args: any, fallbackMs: number, maxMs: number): number {
  const raw = Number(args?.timeout_ms ?? args?.timeoutMs ?? args?.timeout);
  if (!Number.isFinite(raw) || raw <= 0) return fallbackMs;
  return Math.max(5000, Math.min(maxMs, Math.round(raw)));
}

async function withBoundedToolTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
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

function inferAgentIdFromSession(sessionId: string, args: any): string | undefined {
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

function inferApprovalOrigin(sessionId: string, task: any, args: any): {
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

function inferTeamNoteContext(sessionId: string): {
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
    return team ? { teamId: team.id, authorType: 'subagent', authorId: agentId, conversationMode: 'dispatch' } : null;
  }
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

function appendAndBroadcastTeamChat(
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

function getTeamChatTargetMetadata(targetAgentId: string) {
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

function isProposalLikeSourceSessionId(sessionId: string): boolean {
  const sid = String(sessionId || '');
  return sid.startsWith('proposal_') || sid.startsWith('code_exec');
}

function isProposalExecutionSession(sessionId: string): boolean {
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

function resolveTaskForSession(sessionId: string) {
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
    return listTasks().find((task) => String(task?.sessionId || '') === sid) || null;
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

function maybeStartTeamStatusTaskMirror(
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

function getPromApplySurfacesForFiles(files: string[]): string[] {
  const surfaces = new Set<string>();
  for (const raw of files || []) {
    const file = String(raw || '').replace(/\\/g, '/').trim();
    if (file.startsWith('src/')) surfaces.add('backend');
    if (file.startsWith('web-ui/src/mobile/')) surfaces.add('mobile');
    else if (file.startsWith('web-ui/')) surfaces.add('web-ui');
  }
  return Array.from(surfaces);
}

function formatPromApplyDevChangesInstruction(files: string[], reason: string, mode: 'verify_only' | 'apply_live' = 'apply_live', devEditId?: string): string {
  const surfaces = getPromApplySurfacesForFiles(files);
  const safeReason = String(reason || 'Approved Prometheus dev source edits').replace(/"/g, '\\"');
  const idPart = devEditId ? `, dev_edit_id:"${String(devEditId).replace(/"/g, '\\"')}"` : '';
  const filesPart = files.length ? `, affected_files:${JSON.stringify(files)}` : '';
  return `prom_apply_dev_changes({changed_surfaces:${JSON.stringify(surfaces.length ? surfaces : ['backend'])}, mode:"${mode}", reason:"${safeReason}"${idPart}${filesPart}})`;
}

function getPostSourceEditInstructionForSession(sessionId: string, files: string[]): string {
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
  return `Pending: prom_apply_dev_changes verify_only then apply_live; surfaces=${surfaceText}; write_note tag=${tagText}.${idText}`;
}

function validateSourceSyntaxBeforeWrite(absPath: string, content: string): string | null {
  const ext = path.extname(absPath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'].includes(ext)) return null;
  try {
    const ts = require('typescript') as typeof import('typescript');
    const scriptKind = ext === '.tsx'
      ? ts.ScriptKind.TSX
      : ext === '.jsx'
        ? ts.ScriptKind.JSX
        : ext === '.js'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const diagnostics = (sf as any).parseDiagnostics || [];
    if (diagnostics.length === 0) return null;
    return diagnostics.slice(0, 3).map((diag: any) => {
      const pos = typeof diag.start === 'number'
        ? sf.getLineAndCharacterOfPosition(diag.start)
        : { line: 0, character: 0 };
      const message = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
      return `${path.basename(absPath)}:${pos.line + 1}:${pos.character + 1} TS${diag.code}: ${message}`;
    }).join('\n');
  } catch {
    return null;
  }
}

function rejectInvalidSourceEdit(toolName: string, args: any, absPath: string, content: string): ToolResult | null {
  const syntaxError = validateSourceSyntaxBeforeWrite(absPath, content);
  if (!syntaxError) return null;
  return {
    name: toolName,
    args,
    result:
      `EDIT REJECTED: proposed edit would make ${path.basename(absPath)} syntactically invalid.\n` +
      `${syntaxError}\n` +
      'No file was written. Re-read the surrounding lines and retry with a structurally complete edit, preferably find_replace_source with a larger exact anchor or write_source with full file content.',
    error: true,
  };
}

export async function executeTool(name: string, args: any, workspacePath: string, deps: ExecuteToolDeps, sessionId: string = 'default'): Promise<ToolResult> {
  if (name === 'terminal') {
    const background = args?.background === true || args?.mode === 'background';
    args = { ...args };
    delete args.mode;
    name = background ? 'start_process' : 'run_command';
  }
  // Filename inference: if the model forgot to pass filename, use the last one
  const needsFilename = ['read_file', 'create_file', 'replace_lines', 'insert_after', 'delete_lines', 'find_replace', 'delete_file'];
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

	  const _isProposalSession = isProposalExecutionSession(sessionId);
  function hasPrometheusSourceShape(candidateRoot: string): boolean {
    const root = path.resolve(String(candidateRoot || ''));
    return fs.existsSync(path.join(root, 'package.json'))
      && fs.existsSync(path.join(root, 'src'))
      && fs.existsSync(path.join(root, 'web-ui'));
  }
  function candidateProjectRootsFromAllowedWorkspaces(configuredWorkspace: string): string[] {
    if (!hasActiveWorkspaceScope()) return [];
    const roots = getActiveAllowedWorkspaces(configuredWorkspace, []);
    const candidates: string[] = [];
    for (const rawRoot of roots) {
      const allowedRoot = path.resolve(String(rawRoot || ''));
      if (!allowedRoot) continue;
      candidates.push(allowedRoot);
      const base = path.basename(allowedRoot).toLowerCase();
      if (base === 'src' || base === 'web-ui') {
        candidates.push(path.dirname(allowedRoot));
      }
    }
    return candidates;
  }
	  function resolveProjectRootForSourceAccess(): string {
      const proposalTask = resolveProposalExecutionTask();
      const explicitProjectRoot = String(proposalTask?.proposalExecution?.projectRoot || '').trim();
      if (explicitProjectRoot) {
        return path.resolve(explicitProjectRoot);
      }
      const configuredWorkspace = path.resolve(getConfig().getWorkspacePath() || workspacePath);
      const workspaceRoot = path.resolve(workspacePath);
      const scopedCandidates = candidateProjectRootsFromAllowedWorkspaces(configuredWorkspace);
      const candidates = hasActiveWorkspaceScope()
        ? scopedCandidates
        : [
            resolvePrometheusRoot(),
            path.dirname(configuredWorkspace),
            configuredWorkspace,
            path.dirname(workspaceRoot),
          ];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        if (seen.has(key)) continue;
        seen.add(key);
        if (hasPrometheusSourceShape(resolved)) return resolved;
      }
	    return path.resolve(workspacePath, '..');
	  }
  const PROM_ROOT_ALLOWED_ROOT_FILES = new Set([
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'README.md',
    'CHANGELOG.md',
    'SELF.md',
    'AGENTS.md',
  ]);
  const PROM_ROOT_ALLOWED_DIRECTORIES = new Set([
    '.prometheus',
    'scripts',
    'electron',
    'build',
    'dist',
    'src',
    'web-ui',
  ]);
  const PROM_ROOT_DENIED_TOP_LEVEL = new Set([
    '.git',
    'node_modules',
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.env.test',
    '.npm',
    '.cache',
    '.turbo',
    '.next',
    '.pnpm-store',
  ]);
  function normalizePromPath(input: unknown): string {
    const normalized = String(input || '').replace(/\\/g, '/').trim();
    if (!normalized || normalized === '.' || normalized === './') return '';
    return normalized.replace(/^\.?\//, '').replace(/\/+$|^\/$/g, '');
  }
  function isPromDeniedPath(normalizedRel: string): boolean {
    if (!normalizedRel) return false;
    const topLevel = normalizedRel.split('/')[0]?.toLowerCase() || '';
    if (!topLevel) return false;
    if (PROM_ROOT_DENIED_TOP_LEVEL.has(topLevel)) return true;
    return topLevel.includes('secret') || topLevel.includes('credential');
  }
  function isPromAllowedPath(normalizedRel: string): boolean {
    if (!normalizedRel) return true;
    if (isPromDeniedPath(normalizedRel)) return false;
    if (PROM_ROOT_ALLOWED_ROOT_FILES.has(normalizedRel)) return true;
    const topLevel = normalizedRel.split('/')[0] || '';
    return PROM_ROOT_ALLOWED_DIRECTORIES.has(topLevel);
  }
  function promAllowlistSummary(): string {
    return `${Array.from(PROM_ROOT_ALLOWED_ROOT_FILES).join(', ')} and directories ${Array.from(PROM_ROOT_ALLOWED_DIRECTORIES).join(', ')}/`;
  }
	  function resolvePromAllowedPath(projectRoot: string, rel: string): { absPath: string; normalizedRel: string } {
	    const normalizedRel = normalizePromPath(rel);
	    if (!isPromAllowedPath(normalizedRel)) {
	      throw new Error(`Path "${normalizedRel || '.'}" is outside the prom-root allowlist. Allowed surfaces: ${promAllowlistSummary()}.`);
	    }
    const absPath = normalizedRel ? path.resolve(projectRoot, normalizedRel) : projectRoot;
    if (!absPath.startsWith(projectRoot)) {
      throw new Error('Path escapes the Prometheus project root.');
	    }
	    return { absPath, normalizedRel };
	  }
	  function resolvePromAllowedFilePath(projectRoot: string, rel: string): { absPath: string; normalizedRel: string } {
	    const resolved = resolvePromAllowedPath(projectRoot, rel);
	    if (!resolved.normalizedRel) {
	      throw new Error('A file path is required; refusing to edit the Prometheus project root directory.');
	    }
	    return resolved;
	  }
		  function ensureProposalPromWriteTool(toolName: string): ToolResult | null {
        return ensureDevSrcSelfEditWriteSession(toolName, 'prom-root');
		  }
	  function renderNumberedRead(displayPath: string, allLines: string[], argsObj: any): string {
    const head = argsObj.head ? Number(argsObj.head) : 0;
    const tail = argsObj.tail ? Number(argsObj.tail) : 0;
    const startLine = argsObj.start_line ? Math.max(1, Math.floor(Number(argsObj.start_line))) : 0;
    const numLines = argsObj.num_lines ? Math.max(1, Math.floor(Number(argsObj.num_lines))) : 0;
    let sliced: string[];
    let firstLineNum: number;
    if (startLine > 0) {
      const from = startLine - 1;
      const to = numLines > 0 ? from + numLines : allLines.length;
      sliced = allLines.slice(from, to);
      firstLineNum = startLine;
    } else if (head > 0) {
      sliced = allLines.slice(0, head);
      firstLineNum = 1;
    } else if (tail > 0) {
      sliced = allLines.slice(-tail);
      firstLineNum = allLines.length - sliced.length + 1;
    } else {
      sliced = allLines;
      firstLineNum = 1;
    }
    const numbered = sliced.map((line, i) => `${firstLineNum + i}: ${line}`).join('\n');
    return `${displayPath} (${allLines.length} lines):\n${numbered}`;
  }
  function normalizeFindTextForRecovery(text: string): string {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }
  function tokenSetForRecovery(text: string): Set<string> {
    return new Set(
      normalizeFindTextForRecovery(text)
        .toLowerCase()
        .split(/[^a-z0-9_$]+/i)
        .filter((token) => token.length >= 2)
    );
  }
  function countCommonTokensForRecovery(left: Set<string>, right: Set<string>): number {
    let common = 0;
    for (const token of left) {
      if (right.has(token)) common += 1;
    }
    return common;
  }
  function renderCandidateSnippetForRecovery(allLines: string[], startLine: number, endLine: number): string {
    const clampedStart = Math.max(1, Math.min(startLine, allLines.length || 1));
    const clampedEnd = Math.max(clampedStart, Math.min(endLine, allLines.length || clampedStart));
    const snippet = allLines
      .slice(clampedStart - 1, clampedEnd)
      .map((line, index) => `${clampedStart + index}: ${line}`)
      .join('\n');
    return snippet || `${clampedStart}:`;
  }
  function buildTextNotFoundRecovery(displayPath: string, content: string, findText: string, readToolName: string): string {
    const allLines = content.split('\n');
    const findLines = String(findText || '').split('\n');
    const normalizedFind = normalizeFindTextForRecovery(findText);
    const targetWindow = Math.max(1, Math.min(40, findLines.length || 1));
    const candidates: Array<{ reason: string; startLine: number; endLine: number; score: number }> = [];
    const seen = new Set<string>();
    const addCandidate = (reason: string, startLine: number, endLine: number, score: number) => {
      if (!Number.isFinite(startLine) || startLine < 1) return;
      const clampedStart = Math.max(1, Math.min(startLine, allLines.length || 1));
      const clampedEnd = Math.max(clampedStart, Math.min(endLine, allLines.length || clampedStart));
      const key = `${clampedStart}:${clampedEnd}:${reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ reason, startLine: clampedStart, endLine: clampedEnd, score });
    };

    if (normalizedFind) {
      const minWindow = Math.max(1, targetWindow - 2);
      const maxWindow = Math.min(Math.max(targetWindow + 4, minWindow), 48);
      for (let size = minWindow; size <= maxWindow; size += 1) {
        for (let index = 0; index <= Math.max(0, allLines.length - size); index += 1) {
          const block = allLines.slice(index, index + size).join('\n');
          const normalizedBlock = normalizeFindTextForRecovery(block);
          if (normalizedBlock && (normalizedBlock === normalizedFind || normalizedBlock.includes(normalizedFind) || normalizedFind.includes(normalizedBlock))) {
            addCandidate('same text with normalized whitespace', index + 1, index + size, 1000 - Math.abs(size - targetWindow));
          }
        }
      }
    }

    const trimmedFindLines = findLines.map((line) => line.trim()).filter(Boolean);
    const prefixAnchor = trimmedFindLines[0] || '';
    const suffixAnchor = trimmedFindLines[trimmedFindLines.length - 1] || '';
    if (prefixAnchor.length >= 8) {
      allLines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (trimmedLine && (trimmedLine.includes(prefixAnchor) || prefixAnchor.includes(trimmedLine))) {
          addCandidate('matching prefix anchor', index + 1, index + targetWindow, 800);
        }
      });
    }
    if (suffixAnchor.length >= 8 && suffixAnchor !== prefixAnchor) {
      allLines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (trimmedLine && (trimmedLine.includes(suffixAnchor) || suffixAnchor.includes(trimmedLine))) {
          addCandidate('matching suffix anchor', index + 2 - targetWindow, index + 1, 780);
        }
      });
    }

    const findTokens = tokenSetForRecovery(findText);
    if (findTokens.size > 0) {
      const closestWindow = Math.min(Math.max(targetWindow, 4), 30);
      for (let index = 0; index <= Math.max(0, allLines.length - closestWindow); index += 1) {
        const block = allLines.slice(index, index + closestWindow).join('\n');
        const blockTokens = tokenSetForRecovery(block);
        const common = countCommonTokensForRecovery(findTokens, blockTokens);
        const union = new Set([...findTokens, ...blockTokens]).size || 1;
        const score = common / union;
        if (common >= 2 || score >= 0.25) {
          addCandidate('closest token block', index + 1, index + closestWindow, Math.round(score * 500));
        }
      }
    }

    const top = candidates
      .sort((a, b) => b.score - a.score || a.startLine - b.startLine)
      .filter((candidate, index, list) => list.findIndex((other) => Math.abs(other.startLine - candidate.startLine) <= 2) === index)
      .slice(0, 3);
    if (!top.length) {
      return `ERROR: Text not found in ${displayPath}. No close candidate found. Use ${readToolName} to confirm exact text including whitespace.`;
    }
    const rendered = top.map((candidate, index) => {
      const snippetStart = Math.max(1, candidate.startLine - 2);
      const snippetEnd = Math.min(allLines.length, candidate.endLine + 2);
      return `${index + 1}) ${candidate.reason}, lines ${candidate.startLine}-${candidate.endLine}:\n${renderCandidateSnippetForRecovery(allLines, snippetStart, snippetEnd)}`;
    }).join('\n\n');
    return `ERROR: Text not found in ${displayPath}. Likely intended locations:\n${rendered}\n\nNext: retry with an exact snippet from one candidate, or call ${readToolName} around the candidate lines.`;
  }
  function scorePathSuggestion(requestedRel: string, candidateRel: string): number {
    const requested = String(requestedRel || '').toLowerCase().replace(/\\/g, '/');
    const candidate = String(candidateRel || '').toLowerCase().replace(/\\/g, '/');
    const requestedBase = path.basename(requested);
    const candidateBase = path.basename(candidate);
    let score = 0;
    if (candidate === requested) score += 1000;
    if (candidate.endsWith(requested)) score += 600;
    if (candidateBase === requestedBase) score += 500;
    if (candidate.includes(requestedBase) && requestedBase) score += 220;
    if (requested.includes(candidateBase) && candidateBase) score += 120;
    const requestedParts = requested.split(/[\/._-]+/).filter(Boolean);
    const candidateParts = new Set(candidate.split(/[\/._-]+/).filter(Boolean));
    for (const part of requestedParts) {
      if (candidateParts.has(part)) score += 40;
      else if (part.length >= 3 && candidate.includes(part)) score += 15;
    }
    score -= Math.abs(candidate.length - requested.length) / 8;
    return score;
  }
  function buildPathNotFoundRecovery(
    displayPath: string,
    rootDir: string,
    requestedRel: string,
    browseToolName: string,
    options: { displayPrefix?: string; directoriesOnly?: boolean; include?: (rel: string, isDirectory: boolean) => boolean } = {}
  ): string {
    const suggestions: Array<{ rel: string; isDirectory: boolean; score: number }> = [];
    const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.vite', '.turbo', '.pnpm-store']);
    const maxVisited = 4000;
    let visited = 0;
    const walk = (dir: string) => {
      if (visited >= maxVisited) return;
      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of dirents) {
        if (visited >= maxVisited) return;
        if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
        const isDirectory = entry.isDirectory();
        if ((isDirectory || entry.isFile()) && (!options.directoriesOnly || isDirectory) && (!options.include || options.include(rel, isDirectory))) {
          visited += 1;
          const score = scorePathSuggestion(requestedRel, rel);
          if (score > 0) suggestions.push({ rel, isDirectory, score });
        }
        if (isDirectory) walk(abs);
      }
    };
    walk(rootDir);
    const top = suggestions
      .sort((a, b) => b.score - a.score || a.rel.length - b.rel.length)
      .slice(0, 3);
    if (!top.length) {
      return `ERROR: ${displayPath} not found. No close path candidate found. Use ${browseToolName} to browse nearby files.`;
    }
    const prefix = options.displayPrefix || '';
    const rendered = top
      .map((item, index) => `${index + 1}) ${prefix}${item.rel}${item.isDirectory ? '/' : ''}`)
      .join('\n');
    return `ERROR: ${displayPath} not found. Likely intended paths:\n${rendered}\n\nNext: retry with one candidate, or use ${browseToolName} to browse nearby files.`;
  }
  function buildLineOutOfRangeRecovery(displayPath: string, allLines: string[], requestedLine: number, readToolName: string, lineLabel = 'line'): string {
    const lineCount = allLines.length;
    const tailStart = Math.max(1, lineCount - 7);
    const tail = renderCandidateSnippetForRecovery(allLines, tailStart, lineCount);
    return `ERROR: ${lineLabel} ${requestedLine} past end of ${displayPath} (${lineCount} lines).\nLast lines:\n${tail}\n\nNext: use ${readToolName} with start_line near ${tailStart}, or retry with a line <= ${lineCount}.`;
  }
  function recoverWorkspacePathError(err: any, requested: unknown, browseToolName = 'list_dir'): string {
    const message = String(err?.message || err);
    if (/not found/i.test(message)) {
      const requestedRel = String(requested || '').replace(/\\/g, '/');
      return buildPathNotFoundRecovery(requestedRel, workspacePath, requestedRel, browseToolName);
    }
    return `ERROR: ${message}`;
  }
	  function renderDirectoryEntries(absPath: string): string[] {
    return fs.readdirSync(absPath).map((entry) => {
      try {
        const stat = fs.statSync(path.join(absPath, entry));
        return stat.isDirectory() ? `[DIR]  ${entry}/` : `[FILE] ${entry}`;
      } catch {
        return `[??]   ${entry}`;
      }
    });
  }
  function normalizePathForPermissionCompare(p: string): string {
    const resolved = path.resolve(String(p || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
  function isPathInsideForPermissions(basePath: string, targetPath: string): boolean {
    const base = normalizePathForPermissionCompare(basePath);
    const target = normalizePathForPermissionCompare(targetPath);
    if (!base || !target) return false;
    const rel = path.relative(base, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }
  function resolveAllowedWorkspacePath(relPath: string, opts: { requireFile?: boolean; requireDirectory?: boolean; allowEmpty?: boolean } = {}): { absPath: string; normalizedRel: string; displayPath: string } {
    const raw = String(relPath ?? '').trim();
    if (!raw && !opts.allowEmpty) throw new Error('path is required');
    const root = path.resolve(workspacePath);
    const normalizedInput = normalizeWorkspaceAliasPath(raw, root);
    const cfg = getConfig().getConfig() as any;
    const configuredWorkspace = path.resolve(String(cfg?.workspace?.path || workspacePath));
    const isPrimaryWorkspaceRun = normalizePathForPermissionCompare(root) === normalizePathForPermissionCompare(configuredWorkspace);
    const permissions = cfg?.tools?.permissions?.files || {};
    const configuredAllowed = Array.isArray(permissions.allowed_paths) ? permissions.allowed_paths : [];
    const allowedRoots = hasActiveWorkspaceScope()
      ? getActiveAllowedWorkspaces(configuredWorkspace, configuredAllowed)
      : isPrimaryWorkspaceRun
      ? Array.from(new Set([root, ...configuredAllowed.map((p: any) => String(p || '').trim()).filter(Boolean)].map((p) => path.resolve(p))))
      : [root];
    const blockedRoots = Array.isArray(permissions.blocked_paths)
      ? permissions.blocked_paths.map((p: any) => String(p || '').trim()).filter(Boolean).map((p: string) => path.resolve(p))
      : [];
    const requested = raw || '.';
    const absPath = path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(path.join(root, normalizedInput || '.'));

    for (const blocked of blockedRoots) {
      if (isPathInsideForPermissions(blocked, absPath)) {
        throw new Error(`Path is in blocked directory: ${blocked}`);
      }
    }
    if (!allowedRoots.some((allowed) => isPathInsideForPermissions(allowed, absPath))) {
      throw new Error(`Path "${requested}" is outside allowed directories. Allowed: ${allowedRoots.join(', ')}`);
    }
    if (opts.requireFile) {
      if (!fs.existsSync(absPath)) throw new Error(`File "${requested}" not found`);
      if (!fs.statSync(absPath).isFile()) throw new Error(`"${requested}" is not a file`);
    }
    if (opts.requireDirectory) {
      if (!fs.existsSync(absPath)) throw new Error(`"${requested}" not found`);
      if (!fs.statSync(absPath).isDirectory()) throw new Error(`"${requested}" is not a directory`);
    }
    const insideWorkspace = isPathInsideForPermissions(root, absPath);
    const normalizedRel = insideWorkspace ? (path.relative(root, absPath).replace(/\\/g, '/') || '.') : absPath;
    const displayPath = insideWorkspace ? normalizedRel : absPath;
    return { absPath, normalizedRel, displayPath };
  }
	  function resolveFilePath(filename: string): string {
	    const normalized = String(filename || '').replace(/\\/g, '/');
	    if (_isProposalSession && normalized.startsWith('src/')) {
	      return path.join(resolveProjectRootForSourceAccess(), normalized);
	    }
	    return path.join(workspacePath, filename);
	  }
	  function resolveWorkspacePath(relPath: string, opts: { requireFile?: boolean } = {}): { absPath: string; normalizedRel: string } {
	    const resolved = resolveAllowedWorkspacePath(relPath, opts);
	    return { absPath: resolved.absPath, normalizedRel: resolved.normalizedRel };
	  }
  function resolveWorkspaceDirectory(relPath: string, opts: { allowEmpty?: boolean } = {}): { absPath: string; normalizedRel: string; displayPath: string } {
    return resolveAllowedWorkspacePath(relPath, { requireDirectory: true, allowEmpty: opts.allowEmpty === true });
  }
  function quoteArg(value: string): string {
    const raw = String(value || '');
    return `"${raw.replace(/"/g, '\\"')}"`;
  }
  function truncateText(value: string, maxChars = 12000): string {
    const text = String(value || '');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]` : text;
  }
  function isSkippableWorkspaceEntry(entry: string): boolean {
    return new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', '.turbo', '.prometheus/snapshots']).has(entry.replace(/\\/g, '/'));
  }
  function walkFiles(rootDir: string, options: { maxFiles?: number; maxBytes?: number; includeHidden?: boolean } = {}): Array<{ absPath: string; relPath: string; size: number }> {
    const maxFiles = Math.max(1, Math.min(20000, Number(options.maxFiles || 5000)));
    const maxBytes = Math.max(1, Number(options.maxBytes || Number.MAX_SAFE_INTEGER));
    const root = path.resolve(rootDir);
    const out: Array<{ absPath: string; relPath: string; size: number }> = [];
    let totalBytes = 0;
    const walk = (dir: string) => {
      if (out.length >= maxFiles || totalBytes >= maxBytes) return;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (out.length >= maxFiles || totalBytes >= maxBytes) break;
        const abs = path.join(dir, entry.name);
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        if (!options.includeHidden && (entry.name.startsWith('.') || isSkippableWorkspaceEntry(rel) || rel.split('/').some(part => isSkippableWorkspaceEntry(part)))) {
          if (entry.isDirectory()) continue;
        }
        if (entry.isDirectory()) {
          if (isSkippableWorkspaceEntry(rel) || ['.git', 'node_modules', 'dist', 'build', '.next', '.cache', '.turbo'].includes(entry.name)) continue;
          walk(abs);
        } else if (entry.isFile()) {
          let stat: fs.Stats;
          try { stat = fs.statSync(abs); } catch { continue; }
          if (totalBytes + stat.size > maxBytes) break;
          totalBytes += stat.size;
          out.push({ absPath: abs, relPath: rel, size: stat.size });
        }
      }
    };
    walk(root);
    return out;
  }
  function countDirectoryFiles(absDir: string, maxEntries = 2000): { files: number; directories: number; bytes: number; truncated: boolean } {
    let files = 0;
    let directories = 0;
    let bytes = 0;
    let truncated = false;
    const walk = (dir: string) => {
      if (files + directories >= maxEntries) {
        truncated = true;
        return;
      }
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files + directories >= maxEntries) {
          truncated = true;
          return;
        }
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          directories += 1;
          walk(abs);
        } else if (entry.isFile()) {
          files += 1;
          try { bytes += fs.statSync(abs).size; } catch {}
        }
      }
    };
    walk(absDir);
    return { files, directories, bytes, truncated };
  }
  function extractPatchTargetPaths(patchText: string): string[] {
    const paths = new Set<string>();
    const normalize = (raw: string) => {
      let p = String(raw || '').trim().replace(/^"|"$/g, '');
      if (!p || p === '/dev/null') return '';
      if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
      return p;
    };
    for (const line of String(patchText || '').split(/\r?\n/)) {
      if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        const token = line.slice(4).trim().split(/\s+/)[0] || '';
        const p = normalize(token);
        if (p) paths.add(p);
      } else if (line.startsWith('rename from ')) {
        const p = normalize(line.slice('rename from '.length));
        if (p) paths.add(p);
      } else if (line.startsWith('rename to ')) {
        const p = normalize(line.slice('rename to '.length));
        if (p) paths.add(p);
      }
    }
    return Array.from(paths);
  }
  function validatePatchTargetPaths(patchText: string): string[] {
    const targets = extractPatchTargetPaths(patchText);
    if (!targets.length) throw new Error('No target paths found in patch. Include standard unified diff headers.');
    for (const target of targets) {
      if (path.isAbsolute(target)) throw new Error(`Patch path must be relative: ${target}`);
      resolveAllowedWorkspacePath(target, { allowEmpty: false });
    }
    return targets;
  }
  async function runCapturedToolCommand(command: string, cwd: string, timeoutMs = 120000): Promise<ToolResult> {
    const captured = await deps.runCommandCaptured(command, cwd, timeoutMs);
    const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
    const exitLabel = captured.timedOut ? 'TIMED OUT' : `exit ${captured.code ?? '?'}`;
    return {
      name,
      args,
      result: `${command} [${exitLabel}]\n${truncateText(output || '(no output)', 12000)}`,
      error: (captured.code !== 0 && !captured.timedOut),
    };
  }
  function readPackageScripts(cwd: string): Record<string, string> {
    try {
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return parsed?.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
    } catch {
      return {};
    }
  }
  function snapshotRoot(): string {
    return path.join(getConfig().getConfigDir(), 'snapshots');
  }
  function listSnapshots(): any[] {
    const root = snapshotRoot();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
      .map(id => {
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(root, id, 'manifest.json'), 'utf-8'));
          return { id, ...manifest };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }
  function isCodeFile(rel: string): boolean {
    return /\.(tsx?|jsx?|mjs|cjs)$/i.test(rel) && !rel.includes('/node_modules/') && !rel.includes('/dist/');
  }
  function getLineAndCharacterFromPos(text: string, pos: number): { line: number; character: number } {
    const prefix = text.slice(0, Math.max(0, pos));
    const lines = prefix.split(/\r?\n/);
    return { line: lines.length, character: (lines[lines.length - 1] || '').length + 1 };
  }
  async function buildCodeOutlineForFile(filePath: string, maxSymbols = 300): Promise<any> {
    const ts = await import('typescript');
    const content = fs.readFileSync(filePath, 'utf-8');
    const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : filePath.endsWith('.jsx') ? ts.ScriptKind.JSX : filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
    const symbols: any[] = [];
    const push = (node: any, type: string, nameValue: string) => {
      if (!nameValue || symbols.length >= maxSymbols) return;
      const start = getLineAndCharacterFromPos(content, node.getStart(sf));
      const end = getLineAndCharacterFromPos(content, node.getEnd());
      symbols.push({ type, name: nameValue, line: start.line, character: start.character, end_line: end.line });
    };
    const visit = (node: any) => {
      if (symbols.length >= maxSymbols) return;
      if (ts.isImportDeclaration(node)) push(node, 'import', (node.moduleSpecifier as any)?.text || '');
      else if (ts.isClassDeclaration(node)) push(node, 'class', node.name?.text || '<anonymous>');
      else if (ts.isFunctionDeclaration(node)) push(node, 'function', node.name?.text || '<anonymous>');
      else if (ts.isMethodDeclaration(node)) push(node, 'method', node.name?.getText(sf) || '');
      else if (ts.isInterfaceDeclaration(node)) push(node, 'interface', node.name?.text || '');
      else if (ts.isTypeAliasDeclaration(node)) push(node, 'type', node.name?.text || '');
      else if (ts.isEnumDeclaration(node)) push(node, 'enum', node.name?.text || '');
      else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations || []) push(decl, 'variable', decl.name?.getText(sf) || '');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return { file: path.relative(workspacePath, filePath).replace(/\\/g, '/'), symbols, count: symbols.length };
  }
  async function collectCodeSymbols(rootDir: string, query = '', maxResults = 100): Promise<any[]> {
    const files = walkFiles(rootDir, { maxFiles: 3000, maxBytes: 80_000_000 }).filter(f => isCodeFile(f.relPath));
    const q = query.trim().toLowerCase();
    const results: any[] = [];
    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const outline = await buildCodeOutlineForFile(file.absPath, 500);
        for (const sym of outline.symbols) {
          if (results.length >= maxResults) break;
          if (!q || String(sym.name || '').toLowerCase().includes(q)) results.push({ ...sym, file: outline.file });
        }
      } catch {}
    }
    return results;
  }
	  const mutationScope = getSessionMutationScope(sessionId);
	  const normalizeScopePath = (value: string): string =>
	    String(value || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
	  const isWithinAllowedDir = (normalizedRel: string, allowedDir: string): boolean =>
	    normalizedRel === allowedDir || normalizedRel.startsWith(`${allowedDir}/`);
	  function enforceMutationScope(relPath: string, kind: 'file' | 'dir', toolName: string): ToolResult | null {
	    if (!mutationScope) return null;
	    const normalizedRel = normalizeScopePath(relPath);
	    const allowedFiles = (mutationScope.allowedFiles || []).map(normalizeScopePath).filter(Boolean);
	    const allowedDirs = (mutationScope.allowedDirs || []).map(normalizeScopePath).filter(Boolean);
	    const allowed = kind === 'dir'
	      ? allowedDirs.some((dir) => isWithinAllowedDir(normalizedRel, dir))
	      : allowedFiles.some((file) => normalizedRel === file) || allowedDirs.some((dir) => isWithinAllowedDir(normalizedRel, dir));
	    if (allowed) return null;
	    const scopeSummary = [
	      allowedFiles.length ? `files: ${allowedFiles.join(', ')}` : '',
	      allowedDirs.length ? `dirs: ${allowedDirs.join(', ')}` : '',
	    ].filter(Boolean).join(' | ');
	    return {
	      name,
	      args,
	      result: `BLOCKED: ${toolName} cannot modify "${normalizedRel}" because it is outside the approved proposal scope. Allowed mutation scope: ${scopeSummary || 'none'}. If the proposal plan missed a required file, stop and request a revised proposal instead of editing unapproved files.`,
	      error: true,
	    };
	  }
		  function resolveProposalExecutionTask() {
		    const task = resolveTaskForSession(sessionId);
		    if (!task) return null;
		    return isProposalLikeSourceSessionId(String(task.sessionId || '')) ? task : null;
		  }
      function isDevSrcSelfEditProposalSession(): boolean {
	        const mode = resolveProposalExecutionTask()?.proposalExecution?.mode;
	        return mode === DEV_SRC_SELF_EDIT_MODE || mode === DEV_SRC_SELF_EDIT_REPAIR_MODE;
	      }
      function isDevSourceWriteApprovedSession(): boolean {
        return isDevSrcSelfEditProposalSession() || hasDevSourceEditGrant(sessionId);
      }
	      function ensureDevSrcSelfEditWriteSession(toolName: string, target: 'src' | 'web-ui' | 'prom-root'): ToolResult | null {
	        const proposalTask = resolveProposalExecutionTask();
        if (!proposalTask && !hasDevSourceEditGrant(sessionId)) {
          return {
            name: toolName,
            args,
            result: target === 'src'
              ? `ERROR: ${toolName} requires approval before editing Prometheus source. Use request_dev_source_edit for a dev-only fast approval, or write_proposal with execution_mode="code_change" for the full proposal lane.`
              : `ERROR: ${toolName} is only available for approved internal-code edit sessions.`,
            error: true,
          };
        }
	        if (proposalTask && !isDevSrcSelfEditProposalSession()) {
	          const targetLabel = target === 'src' ? 'src/' : target === 'web-ui' ? 'web-ui/' : 'prom-root';
	          return {
	            name: toolName,
	            args,
	            result: `BLOCKED: ${toolName} is not enabled for this proposal task. Automatic self-edit execution is restricted to approved code_change proposal tasks, so ${targetLabel} write access is unavailable here.`,
	            error: true,
	          };
	        }
        if (target === 'prom-root') {
          return {
            name: toolName,
            args,
            result: `BLOCKED: ${toolName} is disabled in code_change self-edit mode. Only approved src/ and web-ui/ files may be written in this proposal lane.`,
            error: true,
          };
        }
        return null;
      }
		  function enforceProposalWriteAccess(relPath: string, kind: 'file' | 'dir', toolName: string): ToolResult | null {
		    const proposalTask = resolveProposalExecutionTask();
        if (!proposalTask && hasDevSourceEditGrant(sessionId)) {
          return enforceMutationScope(relPath, kind, toolName);
        }
        if (!proposalTask) {
          return {
            name,
            args,
            result: `BLOCKED: ${toolName} requires an approved proposal execution task.`,
            error: true,
          };
        }
        if (!isDevSourceWriteApprovedSession()) {
	          return {
	            name,
	            args,
	            result: `BLOCKED: ${toolName} is only enabled for approved dev src proposal tasks.`,
	            error: true,
	          };
	        }
		    const buildFailure = proposalTask?.proposalExecution?.buildFailure;
		    if (buildFailure && buildFailure.status !== 'resolved') {
		      const repairMessage = buildFailure.repairProposalId
	        ? `Repair proposal ${buildFailure.repairProposalId} is already waiting for review.`
	        : buildFailure.allowWriteProposal
	          ? 'Source edits are frozen; file exactly one repair proposal with write_proposal and then stop.'
	          : 'Source edits are frozen until a repair proposal is approved.';
	      return {
	        name,
	        args,
	        result: `BLOCKED: ${toolName} cannot modify files after this proposal run hit a build failure. ${repairMessage}`,
	        error: true,
	      };
		    }
		    return enforceMutationScope(relPath, kind, toolName);
		  }

      if (GENERIC_WORKSPACE_MUTATION_TOOLS.has(name) && isDevSourceWriteApprovedSession()) {
        return {
          name,
          args,
          result: `BLOCKED: ${name} is disabled in code_change proposal tasks. Use the src/web-ui-specific source tools against approved files only.`,
          error: true,
        };
      }

  // [A4] Policy evaluation + audit trail — log every tool call, non-blocking
  let evaluation = {
    tier: 'read' as 'read' | 'propose' | 'commit',
    riskScore: 0,
    reason: 'policy engine unavailable',
    affectedSystems: [] as string[],
    matchedRule: null as any,
  };

  const isRoutineDesktopApprovalFreeTool = (toolName: string): boolean =>
    /^desktop_(doctor|screenshot|get_monitors|window_screenshot|find_window|focus_window|window_control|click|drag|wait|type|type_raw|press_key|get_clipboard|set_clipboard|list_installed_apps|find_installed_app|launch_app|close_app|get_process_list|wait_for_change|diff_screenshot|background_status|scroll)$/i.test(String(toolName || ''));

  try {
    evaluation = getPolicyEngine().evaluateAction(sessionId, name, args);
    if (evaluation.tier === 'commit' && isRoutineDesktopApprovalFreeTool(name)) {
      evaluation = {
        ...evaluation,
        tier: 'read',
        riskScore: Math.min(Number(evaluation.riskScore || 0), 3),
        reason: 'Routine desktop automation is allowed without approval; final high-impact submissions should use explicit final-action approval.',
      };
    }
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
  } catch { /* policy evaluation is non-blocking — never fail a tool call because of it */ }

  const isGoalAutonomousApprovalBypass =
    deps.executionPolicy?.mode === 'goal_autonomous'
    && deps.executionPolicy?.approvalMode === 'never';

  function resolveRunCommandCwd(rawCwd?: unknown): { cwd: string; displayCwd: string } {
    const requested = String(rawCwd || '').trim();
    if (requested) {
      const resolved = resolveAllowedWorkspacePath(requested, { requireDirectory: true, allowEmpty: true });
      return { cwd: resolved.absPath, displayCwd: resolved.displayPath };
    }

    const root = path.resolve(workspacePath);
    const configuredWorkspace = path.resolve(String((getConfig().getConfig() as any)?.workspace?.path || workspacePath));
    const isPrimaryWorkspaceRun = normalizePathForPermissionCompare(root) === normalizePathForPermissionCompare(configuredWorkspace);
    if (isPrimaryWorkspaceRun) {
      const projectRoot = path.resolve(root, '..');
      if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
        return { cwd: projectRoot, displayCwd: projectRoot };
      }
    }
    return { cwd: root, displayCwd: '.' };
  }

  function getRunCommandAllowedRoots(): string[] {
    const root = path.resolve(workspacePath);
    const cfg = getConfig().getConfig() as any;
    const configuredWorkspace = path.resolve(String(cfg?.workspace?.path || workspacePath));
    const isPrimaryWorkspaceRun = normalizePathForPermissionCompare(root) === normalizePathForPermissionCompare(configuredWorkspace);
    const permissions = cfg?.tools?.permissions?.files || {};
    const configuredAllowed = Array.isArray(permissions.allowed_paths) ? permissions.allowed_paths : [];
    return hasActiveWorkspaceScope()
      ? getActiveAllowedWorkspaces(configuredWorkspace, configuredAllowed)
      : isPrimaryWorkspaceRun
      ? Array.from(new Set([root, ...configuredAllowed.map((p: any) => String(p || '').trim()).filter(Boolean)].map((p) => path.resolve(p))))
      : [root];
  }

  function extractAbsolutePathsFromCommand(command: string): string[] {
    const paths = new Set<string>();
    let text = String(command || '');
    const quotedWin = /["']([A-Za-z]:[\\/][^"']+)["']/g;
    const bareWin = /[A-Za-z]:[\\/][^\s"']+/g;
    const quotedPosix = /["'](\/[^"']+)["']/g;
    const barePosix = /(?<![\w:])\/[^\s"']{3,}/g;
    const quotedRe = process.platform === 'win32' ? quotedWin : quotedPosix;
    const bareRe = process.platform === 'win32' ? bareWin : barePosix;
    text = text.replace(quotedRe, (whole, inner) => {
      paths.add(String(inner || '').trim());
      return ' '.repeat(String(whole || '').length);
    });
    let match: RegExpExecArray | null;
    while ((match = bareRe.exec(text))) {
      paths.add(String(match[1] || match[0] || '').trim());
    }
    return Array.from(paths).filter(Boolean);
  }

  type CommandBoundaryScope = NonNullable<ToolPermissionCandidate['boundaryScope']>;
  type CommandBoundaryAnalysis = {
    scope: CommandBoundaryScope;
    reason: string;
    externalPaths: string[];
    environmentChanges: string[];
    packageManager?: string;
    requiresExplicitApproval: boolean;
    requiresAdmin: boolean;
    blocked?: ToolResult;
  };

  const boundaryRank: Record<CommandBoundaryScope, number> = {
    workspace: 0,
    user_profile: 1,
    global_tooling: 2,
    unknown_external: 3,
    system: 4,
    admin_required: 5,
  };

  function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  }

  function mergeCommandBoundary(base: CommandBoundaryAnalysis, next: Partial<CommandBoundaryAnalysis>): CommandBoundaryAnalysis {
    const nextScope = next.scope || base.scope;
    return {
      scope: boundaryRank[nextScope] > boundaryRank[base.scope] ? nextScope : base.scope,
      reason: uniqueStrings([base.reason, next.reason || '']).join(' '),
      externalPaths: uniqueStrings([...(base.externalPaths || []), ...(next.externalPaths || [])]),
      environmentChanges: uniqueStrings([...(base.environmentChanges || []), ...(next.environmentChanges || [])]),
      packageManager: next.packageManager || base.packageManager,
      requiresExplicitApproval: base.requiresExplicitApproval || next.requiresExplicitApproval === true,
      requiresAdmin: base.requiresAdmin || next.requiresAdmin === true,
      blocked: base.blocked || next.blocked,
    };
  }

  function envPath(name: string, fallback = ''): string {
    return String(process.env[name] || fallback || '').trim();
  }

  function userProfileRoots(): string[] {
    return uniqueStrings([
      os.homedir(),
      envPath('USERPROFILE'),
      envPath('APPDATA'),
      envPath('LOCALAPPDATA'),
    ]).map((p) => path.resolve(p));
  }

  function isInsideUserProfile(target: string): boolean {
    return userProfileRoots().some((root) => isPathInsideForPermissions(root, target));
  }

  function commandBoundaryFromPatterns(command: string): CommandBoundaryAnalysis {
    const cmd = String(command || '');
    const lower = cmd.toLowerCase().replace(/\s+/g, ' ');
    let boundary: CommandBoundaryAnalysis = {
      scope: 'workspace',
      reason: '',
      externalPaths: [],
      environmentChanges: [],
      requiresExplicitApproval: false,
      requiresAdmin: false,
    };
    const appData = envPath('APPDATA', path.join(os.homedir(), 'AppData', 'Roaming'));
    const localAppData = envPath('LOCALAPPDATA', path.join(os.homedir(), 'AppData', 'Local'));
    const npmGlobalRe = /\bnpm(?:\.cmd)?\s+(?:install|i|add)\b[\s\S]*(?:^|\s)(?:-g|--global)(?:\s|$)/i;
    if (npmGlobalRe.test(cmd) || /\bnpm(?:\.cmd)?\s+link\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'global_tooling',
        reason: 'This is an npm global tooling operation and may install executables outside the workspace.',
        externalPaths: [
          path.join(appData, 'npm'),
          path.join(appData, 'npm', 'node_modules'),
          path.join(localAppData, 'npm-cache'),
        ],
        packageManager: 'npm',
        requiresExplicitApproval: true,
      });
    }
    if (/\bnpm(?:\.cmd)?\s+config\s+set\s+prefix\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'global_tooling',
        reason: 'This changes npm global install configuration.',
        externalPaths: [path.join(os.homedir(), '.npmrc')],
        environmentChanges: ['npm prefix'],
        packageManager: 'npm',
        requiresExplicitApproval: true,
      });
    }
    if (/\b(?:pip|pip3|python(?:3)?\s+-m\s+pip)\s+install\b[\s\S]*\s--user\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'user_profile',
        reason: 'This installs Python packages into the user profile outside the workspace.',
        externalPaths: [path.join(os.homedir(), 'AppData', 'Roaming', 'Python')],
        packageManager: 'pip',
        requiresExplicitApproval: true,
      });
    }
    if (/\b(?:winget|choco|chocolatey)\s+(?:install|upgrade|uninstall)\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'system',
        reason: 'This uses a Windows package manager and may change installed applications outside the workspace.',
        externalPaths: ['Windows installed applications'],
        packageManager: /\bwinget\b/i.test(cmd) ? 'winget' : 'chocolatey',
        requiresExplicitApproval: true,
        requiresAdmin: /\bchoco(?:latey)?\b/i.test(cmd),
      });
    }
    if (/\bscoop\s+(?:install|update|uninstall)\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'global_tooling',
        reason: 'This uses Scoop and may install user-level tools outside the workspace.',
        externalPaths: [path.join(os.homedir(), 'scoop')],
        packageManager: 'scoop',
        requiresExplicitApproval: true,
      });
    }
    if (/\bgit\s+config\s+--global\b/i.test(cmd)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'user_profile',
        reason: 'This changes global Git configuration in the user profile.',
        externalPaths: [path.join(os.homedir(), '.gitconfig')],
        environmentChanges: ['global git config'],
        packageManager: 'git',
        requiresExplicitApproval: true,
      });
    }
    if (/\bsetx\b|\[environment\]::setenvironmentvariable/i.test(lower)) {
      boundary = mergeCommandBoundary(boundary, {
        scope: 'user_profile',
        reason: 'This changes user or machine environment variables outside the workspace.',
        environmentChanges: ['environment variables'],
        requiresExplicitApproval: true,
      });
    }
    return boundary;
  }

  function analyzeRunCommandBoundary(command: string): CommandBoundaryAnalysis {
    const allowedRoots = getRunCommandAllowedRoots();
    const blockedRoots = ((getConfig().getConfig() as any)?.tools?.permissions?.files?.blocked_paths || [])
      .map((p: any) => String(p || '').trim())
      .filter(Boolean)
      .map((p: string) => path.resolve(p));
    let boundary = commandBoundaryFromPatterns(command);
    for (const candidate of extractAbsolutePathsFromCommand(command)) {
      const resolved = path.resolve(candidate);
      if (blockedRoots.some((blocked: string) => isPathInsideForPermissions(blocked, resolved))) {
        return mergeCommandBoundary(boundary, {
          scope: 'admin_required',
          reason: `Command references blocked path "${candidate}".`,
          externalPaths: [candidate],
          requiresExplicitApproval: true,
          requiresAdmin: true,
          blocked: { name, args, result: `Blocked: command references blocked path "${candidate}".`, error: true },
        });
      }
      if (!allowedRoots.some((allowed) => isPathInsideForPermissions(allowed, resolved))) {
        const userProfile = isInsideUserProfile(resolved);
        boundary = mergeCommandBoundary(boundary, {
          scope: userProfile ? 'user_profile' : 'unknown_external',
          reason: userProfile
            ? `Command references a user-profile path outside the workspace: "${candidate}".`
            : `Command references an external path outside the workspace: "${candidate}".`,
          externalPaths: [candidate],
          requiresExplicitApproval: true,
        });
      }
    }
    return boundary;
  }

  function stableToolArgsForPermission(toolName: string, toolArgs: any): string {
    const clean = (value: any): any => {
      if (value == null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(clean);
      const out: Record<string, any> = {};
      for (const key of Object.keys(value).sort()) {
        if (/screenshot|image|base64|blob|dataurl|password|token|secret/i.test(key)) continue;
        out[key] = clean(value[key]);
      }
      return out;
    };
    try {
      return `${toolName}:${JSON.stringify(clean(toolArgs || {}))}`;
    } catch {
      return `${toolName}:[unserializable args]`;
    }
  }

  function normalizeUrlOrigin(rawUrl: string): string {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      return `${parsed.protocol}//${parsed.host}`.toLowerCase();
    } catch {
      return value.toLowerCase();
    }
  }

  async function buildScopedToolPermissionCandidate(toolName: string, toolArgs: any, riskScore: number): Promise<ToolPermissionCandidate | null> {
    const action = stableToolArgsForPermission(toolName, toolArgs);
    if (/^desktop_(press_key|type|type_raw|click|drag|scroll)$/i.test(toolName)) {
      const activeWindow = await getDesktopActiveWindowInfo().catch(() => null);
      if (!activeWindow) return null;
      const processName = String(activeWindow.processName || '').trim().toLowerCase();
      const title = String(activeWindow.title || '').trim().replace(/\s+/g, ' ');
      if (!processName && !title) return null;
      return {
        sessionId,
        toolName,
        action,
        targetKind: 'desktop_window',
        target: `${processName}|${title.toLowerCase()}`,
        targetDisplay: `${title || '(untitled)'} (${processName || 'unknown process'})`,
        workspaceRoot: path.resolve(workspacePath),
        riskScore,
      } satisfies ToolPermissionCandidate;
    }
    if (/^browser_(click|fill|press_key|type|scroll|drag|upload_file|click_and_download|run_js)$/i.test(toolName)) {
      const info = getBrowserSessionInfo(sessionId);
      if (!info.active) return null;
      const origin = normalizeUrlOrigin(String(info.url || ''));
      const title = String(info.title || '').trim().replace(/\s+/g, ' ');
      return {
        sessionId,
        toolName,
        action,
        targetKind: 'browser_page',
        target: `${info.sessionId || sessionId}|${origin}|${title.toLowerCase()}`,
        targetDisplay: `${title || '(untitled page)'}${origin ? ` (${origin})` : ''}`,
        workspaceRoot: path.resolve(workspacePath),
        riskScore,
      } satisfies ToolPermissionCandidate;
    }
    return null;
  }

	  let approvedCommandApprovalId = '';
	  if (name === 'run_command' && evaluation.tier === 'commit') {
	    const rawCmd = String(args?.command || '').trim();
	    if (!rawCmd) return { name, args, result: 'command is required', error: true };
    if (looksLikeNativeFileToolBypass(rawCmd)) {
      return {
        name,
        args,
        result: 'Blocked: this looks like an ad hoc shell/Python/Node/PowerShell file edit. Use native file tools instead: file_stats/read_file or grep_file first, then find_replace/replace_lines/insert_after/delete_lines/write_file/create_file. Use run_command for tests, builds, git/status, package installs, diagnostics, or transformations the file tools cannot perform.',
        error: true,
      };
    }

    const cmd = rawCmd.toLowerCase();
    const blockedPattern = commandContainsBlockedPattern(cmd, deps.BLOCKED_PATTERNS);
    if (blockedPattern) {
      return { name, args, result: `Blocked: "${cmd}" contains unsafe pattern "${blockedPattern}"`, error: true };
    }

    const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
    const commandBoundary = analyzeRunCommandBoundary(normalizedCmd);
    if (commandBoundary.blocked) return commandBoundary.blocked;
    if (!deps.isAllowedShellCommand(normalizedCmd)) {
      return {
        name,
        args,
        result: `Blocked: shell command is not allowed by policy: "${rawCmd}"`,
        error: true,
      };
	    }

    let commandCwdForApproval: { cwd: string; displayCwd: string };
    try {
      commandCwdForApproval = resolveRunCommandCwd(args?.cwd);
    } catch (err: any) {
      return { name, args, result: `Invalid cwd for run_command: ${err.message || err}`, error: true };
    }

    const permissionCandidate: ToolPermissionCandidate = {
      sessionId,
      toolName: 'run_command' as const,
      action: normalizedCmd,
      targetKind: 'command_cwd' as const,
      target: commandCwdForApproval.cwd,
      targetDisplay: commandCwdForApproval.displayCwd,
      command: normalizedCmd,
      cwd: commandCwdForApproval.cwd,
      cwdDisplay: commandCwdForApproval.displayCwd,
      workspaceRoot: path.resolve(workspacePath),
      riskScore: Math.max(Number(evaluation.riskScore || 0), commandBoundary.requiresExplicitApproval ? 7 : 0),
      boundaryScope: commandBoundary.scope,
      boundaryReason: commandBoundary.reason,
      externalPaths: commandBoundary.externalPaths,
      environmentChanges: commandBoundary.environmentChanges,
      packageManager: commandBoundary.packageManager,
      requiresExplicitApproval: commandBoundary.requiresExplicitApproval,
      requiresAdmin: commandBoundary.requiresAdmin,
    };
    const shellApprovalMode = String((getConfig().getConfig() as any)?.tools?.permissions?.shell?.approval_mode || 'default');
    const isLiteCommandApprovalBypass = shellApprovalMode === 'lite' && !commandBoundary.requiresExplicitApproval;
    const existingCommandGrant = findCommandPermissionGrant(permissionCandidate);
    const isAutonomousCommandApprovalBypass = isGoalAutonomousApprovalBypass && !commandBoundary.requiresExplicitApproval;
    if (existingCommandGrant || isAutonomousCommandApprovalBypass || isLiteCommandApprovalBypass) {
      try {
        appendAuditEntry({
          timestamp: new Date().toISOString(),
          sessionId,
          agentId: inferAgentIdFromSession(sessionId, args),
          actionType: 'approval_resolved',
          toolName: name,
          toolArgs: args,
          policyTier: evaluation.tier,
          approvalStatus: 'auto_allowed',
          resultSummary: existingCommandGrant
            ? `Allowed by ${existingCommandGrant.scope} command permission ${existingCommandGrant.id}`
            : isLiteCommandApprovalBypass
            ? 'Auto-allowed by Lite terminal permissions.'
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
	    const approval = approvalQueue.create({
	      sessionId,
	      taskId: activeTaskId,
	      agentId: inferAgentIdFromSession(sessionId, args),
	      originType: approvalOrigin.originType,
	      originLabel: approvalOrigin.originLabel,
	      toolName: name,
      toolArgs: { ...args, command: rawCmd },
      commandPermissionCandidate: permissionCandidate,
      action: commandBoundary.requiresExplicitApproval
        ? `Run outside-workspace command in ${approvalCwd}: ${rawCmd}`
        : `Run command in ${approvalCwd}: ${rawCmd}`,
      reason: [evaluation.reason, boundaryDetails].filter(Boolean).join('\n\n'),
      policyTier: 'commit',
      riskScore: permissionCandidate.riskScore,
      affectedSystems: uniqueStrings([
        ...(Array.isArray(evaluation.affectedSystems) ? evaluation.affectedSystems : []),
        ...(commandBoundary.requiresExplicitApproval ? ['outside_workspace', commandBoundary.scope] : []),
      ]),
    });

    try {
      appendAuditEntry({
        timestamp: new Date().toISOString(),
        sessionId,
        agentId: inferAgentIdFromSession(sessionId, args),
        actionType: 'approval_requested',
        toolName: name,
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
	        toolName: name,
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

  if (name !== 'run_command' && evaluation.tier === 'commit') {
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
    const action = `Run ${name}${summaryArgs && summaryArgs !== '{}' ? ` with ${summaryArgs}` : ''}`;
    const permissionCandidate = await buildScopedToolPermissionCandidate(name, args, Number(evaluation.riskScore || 0));
    const existingToolGrant = permissionCandidate ? findCommandPermissionGrant(permissionCandidate) : null;

    if (existingToolGrant || isGoalAutonomousApprovalBypass) {
      try {
        appendAuditEntry({
          timestamp: new Date().toISOString(),
          sessionId,
          agentId: inferAgentIdFromSession(sessionId, args),
          actionType: 'approval_resolved',
          toolName: name,
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
      toolName: name,
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
        toolName: name,
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
        toolName: name,
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

  if (name === 'show_product_carousel') {
    const items = Array.isArray(args?.items) ? args.items : [];
    const title = String(args?.title || '');
    const source = String(args?.source || '');
    return {
      name,
      args,
      result: `Product carousel ready: "${title}" — ${items.length} item(s) will be displayed.`,
      error: false,
      extra: { productCarousel: { title, source, items } },
    };
  }

  if (name === 'show_agent_work') {
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
    const items = (Array.isArray(args?.items) ? args.items : [])
      .filter((it: any) => it && (it.title || it.url))
      .map((it: any) => ({
        title: String(it.title || it.url || 'Source'),
        publisher: it.publisher ? String(it.publisher) : undefined,
        url: it.url ? String(it.url) : undefined,
        imageUrl: it.imageUrl ? String(it.imageUrl) : undefined,
        snippet: it.snippet ? String(it.snippet) : undefined,
        publishedAt: it.publishedAt ? String(it.publishedAt) : undefined,
        badge: it.badge ? String(it.badge) : undefined,
      }));
    if (!items.length) return { name, args, result: 'show_sources requires at least one item with a title or url.', error: true };
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

  if (name === 'show_comparison') {
    const columns = (Array.isArray(args?.columns) ? args.columns : [])
      .map((c: any) => (typeof c === 'string' ? { key: c, label: c } : { key: String(c?.key || c?.label || ''), label: String(c?.label || c?.key || '') }))
      .filter((c: any) => c.key);
    const rows = Array.isArray(args?.rows) ? args.rows.filter((r: any) => r && typeof r === 'object') : [];
    if (!columns.length || !rows.length) return { name, args, result: 'show_comparison requires columns[] and rows[].', error: true };
    const artifact = {
      id: `comparison-${Date.now()}`,
      type: 'comparison' as const,
      title: args?.title ? String(args.title) : undefined,
      columns,
      rows,
      labelKey: args?.labelKey ? String(args.labelKey) : undefined,
      highlightColumn: args?.highlightColumn ? String(args.highlightColumn) : undefined,
    };
    return { name, args, result: `Comparison table ready — ${rows.length} row(s) × ${columns.length} column(s).`, error: false, extra: { richArtifacts: [artifact] } };
  }

  if (name === 'show_chart') {
    const series = (Array.isArray(args?.series) ? args.series : [])
      .map((s: any) => ({
        label: s?.label ? String(s.label) : undefined,
        color: s?.color ? String(s.color) : undefined,
        points: (Array.isArray(s?.points) ? s.points : [])
          .map((p: any) => ({ x: p?.x, y: Number(p?.y) }))
          .filter((p: any) => Number.isFinite(p.y)),
      }))
      .filter((s: any) => s.points.length);
    if (!series.length) return { name, args, result: 'show_chart requires series[] with points[].', error: true };
    const artifact = {
      id: `chart-${Date.now()}`,
      type: 'chart' as const,
      title: args?.title ? String(args.title) : undefined,
      chartType: ['line', 'bar', 'area'].includes(String(args?.chartType)) ? String(args.chartType) : 'line',
      series,
      xLabel: args?.xLabel ? String(args.xLabel) : undefined,
      yLabel: args?.yLabel ? String(args.yLabel) : undefined,
      unit: args?.unit ? String(args.unit) : undefined,
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

	  const broadcastBrowserStatus = async (toolName: string) => {
    try {
      if (!deps.broadcastWS) return;
      const info = getBrowserSessionInfo(sessionId);
      const browserMeta = getBrowserSessionMetadata(sessionId);
      const frame = info.active === true && toolName !== 'browser_close'
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
      case 'declare_plan': {
        // Handled upstream in server-v2 before executeTool is called.
        // This passthrough prevents "unknown tool" errors if it reaches the executor.
        return { name, args, result: 'Plan acknowledged.', error: false };
      }

      case 'talk_to_subagent': {
        const targetAgentId = String(args?.agent_id || '').trim();
        const message = String(args?.message || '').trim();
        if (!targetAgentId) return { name, args, result: 'ERROR: agent_id is required', error: true };
        if (!message) return { name, args, result: 'ERROR: message is required', error: true };
        try {
          const { listManagedTeams: lmt, queueAgentMessage } = require('../teams/managed-teams');
          const teams = lmt();
          const team = teams.find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(targetAgentId));
          if (!team) return { name, args, result: `ERROR: Could not find a team containing agent "${targetAgentId}". Check the agent ID.`, error: true };
          queueAgentMessage(team.id, targetAgentId, message);
          appendAndBroadcastTeamChat(deps, team, {
            from: 'manager',
            fromName: 'Manager',
            content: message,
            metadata: {
              source: 'talk_to_subagent',
              agentId: targetAgentId,
              ...getTeamChatTargetMetadata(targetAgentId),
            },
          });
          try {
            const subagentChatMsg = appendSubagentChatMessage(targetAgentId, {
              role: 'user',
              content: message,
              metadata: {
                source: 'talk_to_subagent',
                teamId: team.id,
                from: 'manager',
              },
            });
            deps.broadcastWS?.({ type: 'subagent_chat_message', agentId: targetAgentId, message: subagentChatMsg });
          } catch {}
          const pausedTask = listTasks({ status: ['awaiting_user_input'] })
            .filter((t: any) => t.teamSubagent?.teamId === team.id && t.teamSubagent?.agentId === targetAgentId)
            .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
          if (pausedTask) {
            pausedTask.status = 'queued';
            pausedTask.pauseReason = undefined;
            pausedTask.pendingClarificationQuestion = undefined;
            pausedTask.resumeContext = pausedTask.resumeContext || { messages: [], browserSessionActive: false, round: 0 };
            pausedTask.resumeContext.messages = [
              ...(Array.isArray(pausedTask.resumeContext.messages) ? pausedTask.resumeContext.messages : []),
              {
                role: 'user',
                content: `[MANAGER RESPONSE]\n${message}`,
                timestamp: Date.now(),
              },
            ].slice(-10);
            pausedTask.resumeContext.onResumeInstruction = `[MANAGER RESPONSE]\n${message}\n\nResume the paused team task using this manager response.`;
            pausedTask.lastProgressAt = Date.now();
            saveTask(pausedTask);
            appendJournal(pausedTask.id, { type: 'resume', content: `Manager answered and resumed ${targetAgentId}.` });
            try {
              const { BackgroundTaskRunner } = require('../tasks/background-task-runner');
              const runner = new BackgroundTaskRunner(
                pausedTask.id,
                deps.handleChat,
                deps.broadcastWS || (() => {}),
                deps.telegramChannel || null,
              );
              runner.start().catch((e: any) => console.warn('[talk_to_subagent] Resume failed:', e?.message || e));
            } catch (resumeErr: any) {
              console.warn('[talk_to_subagent] Could not resume paused subagent:', resumeErr?.message || resumeErr);
            }
          }
          console.log(`[talk_to_subagent] Queued message for "${targetAgentId}" in team "${team.name}"`);
          return { name, args, result: pausedTask ? `Message delivered to ${targetAgentId} (team: ${team.name}) and their paused task is resuming.` : `Message queued for ${targetAgentId} (team: ${team.name}). They will receive it on their next run.`, error: false };
        } catch (e: any) {
          return { name, args, result: `ERROR: ${e.message}`, error: true };
        }
      }

      case 'talk_to_manager': {
        const message = String(args?.message || '').trim();
        const waitForReply = args?.wait_for_reply === true;
        if (!message) return { name, args, result: 'ERROR: message is required', error: true };
        try {
          const { queueManagerMessage } = require('../teams/managed-teams');
          const noteContext = inferTeamNoteContext(sessionId);
          if (!noteContext || noteContext.authorType !== 'subagent') {
            return { name, args, result: 'ERROR: talk_to_manager only works inside a team subagent session. Could not identify team.', error: true };
          }
          const team = getManagedTeam(noteContext.teamId);
          const fromAgentId = noteContext.authorId;
          if (!team) return { name, args, result: `ERROR: Team not found: ${noteContext.teamId}`, error: true };
          const fromAgent = getAgentById(fromAgentId) as any;
          queueManagerMessage(team.id, fromAgentId, message);
          appendAndBroadcastTeamChat(deps, team, {
            from: 'subagent',
            fromName: String(fromAgent?.name || fromAgentId).trim(),
            fromAgentId,
            content: message,
            metadata: {
              source: 'talk_to_manager',
              agentId: fromAgentId,
              waitForReply,
              messageType: waitForReply ? 'blocker' : 'chat',
              ...getTeamChatTargetMetadata('manager'),
            },
          });
          try {
            const subagentChatMsg = appendSubagentChatMessage(fromAgentId, {
              role: 'agent',
              content: `${waitForReply ? 'Question for manager' : 'Message to manager'}: ${message}`,
              metadata: {
                source: 'talk_to_manager',
                teamId: team.id,
                waitForReply,
              },
            });
            deps.broadcastWS?.({ type: 'subagent_chat_message', agentId: fromAgentId, message: subagentChatMsg });
          } catch {}
          if (waitForReply) {
            const pausedTask = listTasks({ status: ['running', 'queued'] })
              .filter((t: any) => t.sessionId === sessionId)
              .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
            if (pausedTask) {
              pausedTask.status = 'awaiting_user_input';
              pausedTask.pauseReason = 'awaiting_user_input';
              pausedTask.pendingClarificationQuestion = message;
              pausedTask.lastProgressAt = Date.now();
              saveTask(pausedTask);
              appendJournal(pausedTask.id, { type: 'pause', content: `Paused waiting for manager response: ${message.slice(0, 200)}` });
              try { deps.broadcastWS({ type: 'task_awaiting_input', taskId: pausedTask.id, question: message, teamId: team.id, agentId: fromAgentId }); } catch {}
            } else {
              updateTeamMemberState(team.id, fromAgentId, {
                status: 'waiting_for_context',
                currentTask: message,
                blockedReason: message,
              });
            }
          }
          console.log(`[talk_to_manager] Agent "${fromAgentId}" queued message to manager in team "${team.name}"`);
          return {
            name,
            args,
            result: waitForReply
              ? `Message sent to manager of team "${team.name}". ${sessionId.startsWith('team_dispatch_') ? 'This task is paused waiting for their reply.' : 'They can answer in the team room.'}`
              : `Message sent to manager of team "${team.name}". They will see it on their next review cycle.`,
            error: false,
          };
        } catch (e: any) {
          return { name, args, result: `ERROR: ${e.message}`, error: true };
        }
      }

      case 'request_context':
      case 'request_manager_help': {
        const rawMessage = name === 'request_context'
          ? String(args?.question || args?.message || '').trim()
          : String(args?.message || args?.question || '').trim();
        const waitForReply = args?.wait_for_reply !== false;
        if (!rawMessage) {
          return {
            name,
            args,
            result: `ERROR: ${name === 'request_context' ? 'question' : 'message'} is required`,
            error: true,
          };
        }
        const noteContext = inferTeamNoteContext(sessionId);
        if (!noteContext || noteContext.authorType !== 'subagent') {
          return { name, args, result: `ERROR: ${name} only works inside a team subagent session.`, error: true };
        }
        const team = getManagedTeam(noteContext.teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${noteContext.teamId}`, error: true };
        const fromAgentId = noteContext.authorId;
        const fromAgent = getAgentById(fromAgentId) as any;
        const prefix = name === 'request_context' ? 'Context request' : 'Manager help request';
        const message = `${prefix}: ${rawMessage}`;
        try {
          const subagentChatMsg = appendSubagentChatMessage(fromAgentId, {
            role: 'agent',
            content: message,
            metadata: {
              source: name,
              teamId: team.id,
              waitForReply,
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId: fromAgentId, message: subagentChatMsg });
        } catch {}

        appendAndBroadcastTeamChat(deps, team, {
          from: 'subagent',
          fromName: String(fromAgent?.name || fromAgentId).trim(),
          fromAgentId,
          content: message,
          metadata: {
            source: name,
            agentId: fromAgentId,
            waitForReply,
            messageType: 'blocker',
            ...getTeamChatTargetMetadata('manager'),
          },
        });

        routeTeamEvent({
          type: 'member_blocked',
          teamId: team.id,
          agentId: fromAgentId,
          agentName: String(fromAgent?.name || fromAgentId).trim(),
          task: String(args?.current_task || '').trim(),
          resultSummary: rawMessage,
          source: name,
        });
        updateTeamMemberState(team.id, fromAgentId, {
          status: 'waiting_for_context',
          currentTask: String(args?.current_task || rawMessage).slice(0, 500),
          blockedReason: rawMessage,
        });

        if (waitForReply) {
          const pausedTask = listTasks({ status: ['running', 'queued'] })
            .filter((t: any) => t.sessionId === sessionId)
            .sort((a: any, b: any) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
          if (pausedTask) {
            pausedTask.status = 'awaiting_user_input';
            pausedTask.pauseReason = 'awaiting_user_input';
            pausedTask.pendingClarificationQuestion = message;
            pausedTask.lastProgressAt = Date.now();
            saveTask(pausedTask);
            appendJournal(pausedTask.id, { type: 'pause', content: `Paused waiting for manager response: ${message.slice(0, 200)}` });
            try { deps.broadcastWS({ type: 'task_awaiting_input', taskId: pausedTask.id, question: message, teamId: team.id, agentId: fromAgentId }); } catch {}
          }
        }

        return {
          name,
          args,
          result: waitForReply
            ? `${prefix} sent to manager of team "${team.name}". This session is waiting for a manager reply.`
            : `${prefix} sent to manager of team "${team.name}".`,
          error: false,
        };
      }

      case 'request_team_member_turn': {
        const teamId = String(args?.team_id || '').trim();
        const agentId = String(args?.agent_id || '').trim();
        const prompt = String(args?.prompt || args?.message || '').trim();
        const background = args?.background === true;
        if (!teamId || !agentId || !prompt) {
          return { name, args, result: 'ERROR: request_team_member_turn requires team_id, agent_id, and prompt', error: true };
        }
        const noteContext = inferTeamNoteContext(sessionId);
        if (!noteContext || noteContext.authorType !== 'manager' || noteContext.teamId !== teamId) {
          return { name, args, result: 'ERROR: request_team_member_turn only works from the team manager session for the same team.', error: true };
        }
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        if (team.manager?.paused === true) return { name, args, result: `ERROR: Team "${team.name}" is paused.`, error: true };
        if (!team.subagentIds.includes(agentId)) {
          return { name, args, result: `ERROR: Agent "${agentId}" is not a member of team "${team.name}".`, error: true };
        }
        if (team.agentPauseStates?.[agentId]?.paused === true) {
          return { name, args, result: `ERROR: Agent "${agentId}" is paused on team "${team.name}".`, error: true };
        }

        deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'request_team_member_turn');
        const agentName = String((getAgentById(agentId) as any)?.name || agentId).trim();
        const inviteChatMsg = appendTeamChat(teamId, {
          from: 'manager',
          fromName: 'Manager',
          content: `Asked ${agentName} to weigh in: ${prompt}`,
          metadata: { agentId },
        });
        try {
          const subagentChatMsg = appendSubagentChatMessage(agentId, {
            role: 'user',
            content: prompt,
            metadata: {
              source: background ? 'request_team_member_turn_background' : 'request_team_member_turn',
              teamId,
              from: 'manager',
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
        } catch {}
        deps.broadcastTeamEvent({
          type: 'team_chat_message',
          teamId,
          teamName: team.name,
          chatMessage: inviteChatMsg,
          text: String(inviteChatMsg?.content || ''),
        });

        const run = async () => {
          const result = await runTeamMemberRoomTurn(teamId, agentId, prompt);
          return result;
        };

        if (background) {
          const taskId = `team_room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          const promise = run()
            .then((result) => {
              const entry = getBgAgentResults().get(taskId);
              if (entry) {
                entry.status = result.success ? 'complete' : 'failed';
                entry.result = result;
              }
              try {
                const subagentChatMsg = appendSubagentChatMessage(agentId, {
                  role: 'agent',
                  content: result.success
                    ? String(result.result || '').trim() || 'Turn complete.'
                    : `Turn failed: ${result.error || result.result || 'unknown error'}`,
                  metadata: {
                    source: 'request_team_member_turn_background',
                    teamId,
                    taskId,
                    success: result.success,
                    durationMs: result.durationMs,
                    stepCount: result.stepCount,
                  },
                });
                deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
              } catch {}
              return result;
            })
            .catch((err: any) => {
              const result = {
                success: false,
                result: '',
                error: String(err?.message || err),
                durationMs: 0,
                agentName,
              };
              const entry = getBgAgentResults().get(taskId);
              if (entry) {
                entry.status = 'failed';
                entry.result = result;
              }
              try {
                const subagentChatMsg = appendSubagentChatMessage(agentId, {
                  role: 'agent',
                  content: `Turn failed: ${result.error}`,
                  metadata: {
                    source: 'request_team_member_turn_background',
                    teamId,
                    taskId,
                    success: false,
                  },
                });
                deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
              } catch {}
              return result;
            });
          getBgAgentResults().set(taskId, {
            status: 'running',
            agentId,
            teamId,
            startedAt: Date.now(),
            promise,
          });
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              status: 'running',
              task_id: taskId,
              team_id: teamId,
              agent_id: agentId,
              mode: 'room_turn',
            }, null, 2),
            error: false,
          };
        }

        const result = await run();
        try {
          const subagentChatMsg = appendSubagentChatMessage(agentId, {
            role: 'agent',
            content: result.success
              ? String(result.result || '').trim() || 'Turn complete.'
              : `Turn failed: ${result.error || result.result || 'unknown error'}`,
            metadata: {
              source: 'request_team_member_turn',
              teamId,
              taskId: result.taskId,
              success: result.success,
              durationMs: result.durationMs,
              stepCount: result.stepCount,
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
        } catch {}
        return {
          name,
          args,
          result: JSON.stringify({
            success: result.success,
            team_id: teamId,
            agent_id: agentId,
            agent_name: result.agentName,
            run_id: result.taskId,
            duration_ms: result.durationMs,
            step_count: result.stepCount,
            mode: 'room_turn',
            result: result.result,
            error: result.error,
          }, null, 2),
          error: result.success !== true,
        };
      }

      case 'dispatch_team_agent': {
        const teamId = String(args?.team_id || '').trim();
        const agentId = String(args?.agent_id || '').trim();
        const task = String(args?.task || '').trim();
        const context = args?.context ? String(args.context) : undefined;
        const background = args?.background === true;
        if (!teamId || !agentId || !task) {
          return { name, args, result: 'ERROR: dispatch_team_agent requires team_id, agent_id, and task', error: true };
        }
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        if (team.manager?.paused === true) return { name, args, result: `ERROR: Team "${team.name}" is paused.`, error: true };
        if (!team.subagentIds.includes(agentId)) {
          return { name, args, result: `ERROR: Agent "${agentId}" is not a member of team "${team.name}".`, error: true };
        }
        if (team.agentPauseStates?.[agentId]?.paused === true) {
          return { name, args, result: `ERROR: Agent "${agentId}" is paused on team "${team.name}".`, error: true };
        }

        deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'dispatch_team_agent');
        const dispatchPrompt = buildTeamDispatchTaskLazy({ agentId, task, teamId, context });
        const dispatchRecord = createTeamDispatchRecord(teamId, {
          agentId,
          agentName: String((getAgentById(agentId) as any)?.name || agentId),
          taskSummary: task,
          requestedBy: inferTeamNoteContext(sessionId)?.authorId || 'manager',
        });
        updateTeamMemberState(teamId, agentId, {
          status: 'running',
          currentTask: task,
          blockedReason: undefined,
        });
        const dispatchChatMsg = appendTeamChat(teamId, {
          from: 'manager',
          fromName: 'Manager',
          content: `Dispatched ${agentId}: ${task}`,
        });
        try {
          const subagentChatMsg = appendSubagentChatMessage(agentId, {
            role: 'user',
            content: context ? `${task}\n\nContext:\n${context}` : task,
            metadata: {
              source: background ? 'dispatch_team_agent_background' : 'dispatch_team_agent',
              teamId,
              requestedBy: dispatchRecord?.requestedBy || inferTeamNoteContext(sessionId)?.authorId || 'manager',
              dispatchId: dispatchRecord?.id,
            },
          });
          deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
        } catch {}
        deps.broadcastTeamEvent({
          type: 'team_chat_message',
          teamId,
          teamName: team.name,
          chatMessage: dispatchChatMsg,
          text: dispatchChatMsg?.content || '',
        });
        deps.broadcastTeamEvent({ type: 'team_dispatch', teamId, teamName: team.name, agentId, task });

        const run = async () => {
          if (dispatchRecord) {
            updateTeamDispatchRecord(teamId, dispatchRecord.id, {
              status: 'running',
              startedAt: Date.now(),
            });
          }
          const result = await deps.runTeamAgentViaChat(agentId, dispatchPrompt.effectiveTask, teamId);
          if (dispatchRecord) {
            updateTeamDispatchRecord(teamId, dispatchRecord.id, {
              status: result.success ? 'completed' : 'failed',
              finishedAt: Date.now(),
              taskId: result.taskId,
              resultPreview: String(result.result || result.error || ''),
            });
          }
          updateTeamMemberState(teamId, agentId, {
            status: result.success ? 'ready' : 'blocked',
            currentTask: result.success ? '' : task,
            blockedReason: result.success ? '' : String(result.error || result.result || 'Task failed').slice(0, 500),
            lastResult: String(result.result || result.error || '').slice(0, 1000),
          });
          const resultChatMsg = appendTeamChat(teamId, {
            from: 'subagent',
            fromName: String(result.agentName || (getAgentById(agentId) as any)?.name || agentId),
            fromAgentId: agentId,
            content: result.success
              ? `Task complete: ${String(result.result || '')}`
              : `Task failed: ${result.error || result.result || 'unknown error'}`,
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
          try {
            const subagentChatMsg = appendSubagentChatMessage(agentId, {
              role: 'agent',
              content: result.success
                ? String(result.result || '').trim() || 'Task complete.'
                : `Task failed: ${result.error || result.result || 'unknown error'}`,
              metadata: {
                source: background ? 'dispatch_team_agent_background' : 'dispatch_team_agent',
                teamId,
                taskId: result.taskId,
                dispatchId: dispatchRecord?.id,
                success: result.success,
                stepCount: result.stepCount,
                durationMs: result.durationMs,
                thinking: result.thinking,
                processEntries: result.processEntries,
              },
            });
            deps.broadcastWS?.({ type: 'subagent_chat_message', agentId, message: subagentChatMsg });
          } catch {}
          deps.broadcastTeamEvent({
            type: 'team_chat_message',
            teamId,
            teamName: team.name,
            chatMessage: resultChatMsg,
            text: resultChatMsg?.content || '',
          });
          routeTeamEvent({
            type: result.success ? 'member_completed_task' : 'member_failed_task',
            teamId,
            agentId,
            agentName: result.agentName,
            task,
            resultSummary: String(result.result || '').trim(),
            error: result.error,
            warning: result.warning,
            taskId: result.taskId,
            dispatchId: dispatchRecord?.id,
            stepCount: result.stepCount,
            durationMs: result.durationMs,
            source: background ? 'dispatch_team_agent_background' : 'dispatch_team_agent',
          });
          deps.broadcastTeamEvent({
            type: 'team_dispatch_complete',
            teamId,
            teamName: team.name,
            agentId,
            agentName: result.agentName,
            taskId: result.taskId,
            success: result.success,
            durationMs: result.durationMs,
            stepCount: result.stepCount,
            resultPreview: String(result.result || result.error || ''),
          });
          return result;
        };

        if (background) {
          const taskId = `team_bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          const promise = run()
            .then((result) => {
              const entry = getBgAgentResults().get(taskId);
              if (entry) {
                entry.status = result.success ? 'complete' : 'failed';
                entry.result = result;
              }
              return result;
            })
            .catch((err: any) => {
              const result = {
                success: false,
                result: '',
                error: String(err?.message || err),
                durationMs: 0,
                agentName: agentId,
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
            agentId,
            teamId,
            startedAt: Date.now(),
            promise,
          });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, status: 'running', task_id: taskId, team_id: teamId, agent_id: agentId }, null, 2),
            error: false,
          };
        }

        const result = await run();
        return {
          name,
          args,
          result: JSON.stringify({
            success: result.success,
            team_id: teamId,
            agent_id: agentId,
            agent_name: result.agentName,
            task_id: result.taskId,
            duration_ms: result.durationMs,
            step_count: result.stepCount,
            result: result.result,
            error: result.error,
            warning: result.warning,
          }, null, 2),
          error: result.success !== true,
        };
      }

      case 'get_agent_result': {
        const taskId = String(args?.task_id || '').trim();
        const block = args?.block !== false;
        const timeoutMs = Math.max(1000, Math.min(1800000, Number(args?.timeout_ms) || 300000));
        if (!taskId) return { name, args, result: 'ERROR: get_agent_result requires task_id', error: true };
        const entry = getBgAgentResults().get(taskId);
        if (!entry) return { name, args, result: `ERROR: Unknown background team task_id: ${taskId}`, error: true };
        if (!block || entry.status !== 'running') {
          return { name, args, result: JSON.stringify({ success: entry.status === 'complete', status: entry.status, task_id: taskId, result: entry.result || null }, null, 2), error: entry.status === 'failed' };
        }
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
        const completed = await Promise.race([entry.promise, timeout]);
        if (!completed) {
          return { name, args, result: JSON.stringify({ success: true, status: 'running', task_id: taskId, message: 'Still running.' }, null, 2), error: false };
        }
        return { name, args, result: JSON.stringify({ success: completed.success, status: completed.success ? 'complete' : 'failed', task_id: taskId, result: completed }, null, 2), error: completed.success !== true };
      }

      case 'post_to_team_chat': {
        const teamId = String(args?.team_id || '').trim();
        const message = String(args?.message || '').trim();
        if (!teamId || !message) return { name, args, result: 'ERROR: post_to_team_chat requires team_id and message', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        const teamContext = inferTeamNoteContext(sessionId);
        const isSubagentSpeaker = teamContext?.teamId === teamId && teamContext.authorType === 'subagent';
        const speakerAgentId = isSubagentSpeaker ? teamContext?.authorId : undefined;
        const speakerAgent = speakerAgentId ? getAgentById(speakerAgentId) as any : null;
        const chatMsg = appendAndBroadcastTeamChat(deps, team, {
          from: isSubagentSpeaker ? 'subagent' : 'manager',
          fromName: isSubagentSpeaker
            ? String(speakerAgent?.name || speakerAgentId || 'Subagent')
            : 'Manager',
          fromAgentId: speakerAgentId,
          content: message,
          metadata: {
            source: 'post_to_team_chat',
            agentId: speakerAgentId,
            ...getTeamChatTargetMetadata('all'),
          },
        });
        return { name, args, result: JSON.stringify({ success: true, team_id: teamId, message_id: chatMsg?.id || null }, null, 2), error: false };
      }

      case 'message_main_agent': {
        const teamId = String(args?.team_id || '').trim();
        const message = String(args?.message || '').trim();
        const waitForReply = args?.wait_for_reply !== false;
        const messageType = String(args?.message_type || 'planning').trim().toLowerCase();
        if (!teamId || !message) return { name, args, result: 'ERROR: message_main_agent requires team_id and message', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        const type = (['planning', 'error', 'status'].includes(messageType) ? messageType : 'planning') as 'planning' | 'error' | 'status';
        const threadMsg = appendMainAgentThread(teamId, { from: 'coordinator', content: message, read: false, type });
        const chatMsg = appendTeamChat(teamId, { from: 'manager', fromName: 'Manager', content: `Message to main agent (${type}): ${message}` });
        try {
          const mainWorkspacePath = getConfig().getWorkspacePath() || workspacePath;
          notifyMainAgent(mainWorkspacePath, teamId, type === 'error' ? 'team_error' : 'team_task_complete', {
            task: 'Coordinator message',
            result: message,
            messageType: type,
            waitForReply,
            threadMessageId: threadMsg?.id,
          }, team.name, team.originatingSessionId);
        } catch { /* non-fatal */ }
        deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, message });
        return { name, args, result: JSON.stringify({ success: true, team_id: teamId, waiting_for_reply: waitForReply, thread_message_id: threadMsg?.id || null }, null, 2), error: false };
      }

      case 'reply_to_team': {
        const teamId = String(args?.team_id || '').trim();
        const message = String(args?.message || '').trim();
        if (!teamId || !message) return { name, args, result: 'ERROR: reply_to_team requires team_id and message', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        const route = parseMainAgentTeamRoute(message);
        const visibleMessage = route.text || message;
        if (route.route === 'member') {
          const targetAgentId = resolveMainAgentTeamMemberId(team, route.targetLabel || '');
          if (!targetAgentId) {
            return {
              name,
              args,
              result: `ERROR: Could not find team member "${route.targetLabel || ''}" on team "${team.name}".`,
              error: true,
            };
          }
          route.targetAgentId = targetAgentId;
        }

        appendMainAgentThread(teamId, {
          from: 'main_agent',
          content: visibleMessage,
          read: true,
          type: 'reply',
        });
        const chatMsg = appendTeamChat(teamId, {
          from: 'user',
          fromName: 'Main Agent',
          content: visibleMessage,
          metadata: {
            source: 'reply_to_team',
            targetType: route.route,
            targetLabel: route.targetLabel,
            targetId: route.targetAgentId,
          },
        });
        deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, message: visibleMessage });

        if (route.route === 'manager') {
          handleManagerConversation(teamId, `[MAIN AGENT REPLY]\n${visibleMessage}`, deps.broadcastTeamEvent, true).catch((err: any) =>
            console.error('[reply_to_team] Coordinator resume failed:', err?.message || err)
          );
          return { name, args, result: JSON.stringify({ success: true, team_id: teamId, routed_to: 'manager', resumed: true }, null, 2), error: false };
        }

        (async () => {
          const delivery = await deliverMainAgentMessageToTeamMembers(
            teamId,
            team,
            visibleMessage,
            route.targetAgentId,
            route.route === 'member' ? route.targetLabel : undefined,
          );
          const managerPrompt = buildMainAgentMembersRespondedPrompt(
            visibleMessage,
            delivery.deliveredCount,
            delivery.completedCount,
            route.route === 'member' ? route.targetLabel : undefined,
          );
          await handleManagerConversation(teamId, managerPrompt, deps.broadcastTeamEvent, false);
        })().catch((err: any) =>
          console.error('[reply_to_team] Team broadcast delivery failed:', err?.message || err)
        );

        return {
          name,
          args,
          result: JSON.stringify({
            success: true,
            team_id: teamId,
            routed_to: route.route,
            target_agent_id: route.targetAgentId || null,
            team_delivery_started: true,
            manager_resumes_after_member_responses: true,
          }, null, 2),
          error: false,
        };
      }

      case 'manage_team_goal': {
        const teamId = String(args?.team_id || '').trim();
        const actionRaw = String(args?.action || '').trim().toLowerCase();
        const action = actionRaw === 'update_focus' ? 'set_focus' : actionRaw;
        if (!teamId || !action) return { name, args, result: 'ERROR: manage_team_goal requires team_id and action', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
        let ok = false;
        let data: any = { team_id: teamId, action };
        let shouldMirrorGoalUpdateToChat = action !== 'set_focus';
        if (action === 'set_focus') {
          const value = String(args?.value || args?.focus || '').trim();
          if (!value) return { name, args, result: 'ERROR: set_focus requires value', error: true };
          const currentFocus = String((team as any)?.currentFocus || (team as any)?.roomState?.runGoal || '').trim();
          if (currentFocus && currentFocus === value) {
            return { name, args, result: JSON.stringify({ success: true, unchanged: true, ...data, focus: value }, null, 2), error: false };
          }
          ok = updateTeamFocus(teamId, value);
          data.focus = value;
          shouldMirrorGoalUpdateToChat = args?.announce === true || args?.mirror_to_chat === true;
        } else if (action === 'set_mission') {
          const value = String(args?.value || args?.mission || '').trim();
          if (!value) return { name, args, result: 'ERROR: set_mission requires value', error: true };
          ok = updateTeamMission(teamId, value);
          data.mission = value;
        } else if (action === 'log_completed') {
          const value = String(args?.value || args?.entry || '').trim();
          if (!value) return { name, args, result: 'ERROR: log_completed requires value', error: true };
          ok = logCompletedWork(teamId, value);
          data.entry = value;
        } else if (action === 'add_milestone') {
          const description = String(args?.milestone_description || args?.value || '').trim();
          if (!description) return { name, args, result: 'ERROR: add_milestone requires milestone_description', error: true };
          const status = ['pending', 'active', 'complete', 'blocked'].includes(String(args?.milestone_status || 'pending'))
            ? String(args?.milestone_status || 'pending') as 'pending' | 'active' | 'complete' | 'blocked'
            : 'pending';
          const milestone = addTeamMilestone(teamId, {
            description,
            status,
            relevantAgentIds: Array.isArray(args?.relevant_agent_ids) ? args.relevant_agent_ids.map((v: any) => String(v)).filter(Boolean) : [],
          });
          ok = !!milestone;
          data.milestone = milestone;
        } else if (action === 'update_milestone') {
          const milestoneId = String(args?.milestone_id || '').trim();
          if (!milestoneId) return { name, args, result: 'ERROR: update_milestone requires milestone_id', error: true };
          const updates: any = {};
          if (args?.milestone_description !== undefined) updates.description = String(args.milestone_description);
          if (['pending', 'active', 'complete', 'blocked'].includes(String(args?.milestone_status || ''))) updates.status = String(args.milestone_status);
          if (Array.isArray(args?.relevant_agent_ids)) updates.relevantAgentIds = args.relevant_agent_ids.map((v: any) => String(v)).filter(Boolean);
          const milestone = updateTeamMilestone(teamId, milestoneId, updates);
          ok = !!milestone;
          data.milestone = milestone;
        } else if (action === 'pause_agent') {
          const agentId = String(args?.agent_id || '').trim();
          if (!agentId) return { name, args, result: 'ERROR: pause_agent requires agent_id', error: true };
          ok = pauseTeamAgent(teamId, agentId, String(args?.reason || '').trim() || undefined);
          data.agent_id = agentId;
        } else if (action === 'unpause_agent') {
          const agentId = String(args?.agent_id || '').trim();
          if (!agentId) return { name, args, result: 'ERROR: unpause_agent requires agent_id', error: true };
          ok = unpauseTeamAgent(teamId, agentId);
          data.agent_id = agentId;
        } else {
          return { name, args, result: `ERROR: Unknown manage_team_goal action "${actionRaw}".`, error: true };
        }
        if (ok) {
          deps.broadcastTeamEvent({ type: 'team_goal_updated', teamId, teamName: team.name, action, data });
          if (shouldMirrorGoalUpdateToChat) {
            const chatMsg = appendTeamChat(teamId, { from: 'manager', fromName: 'Manager', content: `Goal update (${action}): ${JSON.stringify(data).slice(0, 500)}` });
            deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg });
          }
        }
        return { name, args, result: JSON.stringify({ success: ok, ...data }, null, 2), error: !ok };
      }

      case 'manage_team_context_ref': {
        const action = String(args?.action || '').trim().toLowerCase();
        const teamId = String(args?.team_id || '').trim();
        if (!action) return { name, args, result: 'ERROR: manage_team_context_ref requires action', error: true };

        if (action === 'list') {
          if (teamId) {
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };
            const references = listTeamContextReferences(teamId);
            return {
              name,
              args,
              result: JSON.stringify({ success: true, team_id: teamId, team_name: team.name, references }, null, 2),
              error: false,
            };
          }
          const teams = listManagedTeams().map((team: any) => ({
            id: team.id,
            name: team.name,
            reference_count: listTeamContextReferences(team.id).length,
          }));
          return { name, args, result: JSON.stringify({ success: true, teams }, null, 2), error: false };
        }

        if (!teamId) return { name, args, result: 'ERROR: team_id is required for add/update/delete', error: true };
        const team = getManagedTeam(teamId);
        if (!team) return { name, args, result: `ERROR: Team not found: ${teamId}`, error: true };

        if (action === 'add') {
          const title = String(args?.title || '').trim();
          const content = String(args?.content || '').trim();
          if (!title || !content) return { name, args, result: 'ERROR: title and content are required for add', error: true };
          const reference = addTeamContextReference(teamId, {
            title,
            content,
            actor: 'tool:manage_team_context_ref',
          });
          if (!reference) return { name, args, result: 'ERROR: Could not create context reference', error: true };
          deps.broadcastTeamEvent({ type: 'team_updated', teamId, teamName: team.name });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action, team_id: teamId, reference }, null, 2),
            error: false,
          };
        }

        if (action === 'update') {
          const refId = String(args?.ref_id || '').trim();
          if (!refId) return { name, args, result: 'ERROR: ref_id is required for update', error: true };
          const patch: { title?: string; content?: string; actor?: string } = { actor: 'tool:manage_team_context_ref' };
          if (args?.title !== undefined) patch.title = String(args.title);
          if (args?.content !== undefined) patch.content = String(args.content);
          if (patch.title === undefined && patch.content === undefined) {
            return { name, args, result: 'ERROR: update requires title or content', error: true };
          }
          const reference = updateTeamContextReference(teamId, refId, patch);
          if (!reference) return { name, args, result: `ERROR: Context reference not found or invalid update: ${refId}`, error: true };
          deps.broadcastTeamEvent({ type: 'team_updated', teamId, teamName: team.name });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action, team_id: teamId, reference }, null, 2),
            error: false,
          };
        }

        if (action === 'delete') {
          const refId = String(args?.ref_id || '').trim();
          if (!refId) return { name, args, result: 'ERROR: ref_id is required for delete', error: true };
          const success = deleteTeamContextReference(teamId, refId);
          if (!success) return { name, args, result: `ERROR: Context reference not found: ${refId}`, error: true };
          deps.broadcastTeamEvent({ type: 'team_updated', teamId, teamName: team.name });
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action, team_id: teamId, ref_id: refId }, null, 2),
            error: false,
          };
        }

        return { name, args, result: `ERROR: Unknown manage_team_context_ref action "${action}". Valid: list, add, update, delete`, error: true };
      }

      case 'list_files': {
        try {
          const listArgs = args || {};
          const resolved = resolveAllowedWorkspacePath(String(listArgs.path ?? listArgs.directory ?? '.'), { requireDirectory: true, allowEmpty: true });
          const files = fs.readdirSync(resolved.absPath).filter(f => {
            try { return fs.statSync(path.join(resolved.absPath, f)).isFile(); } catch { return false; }
          });
          return { name, args, result: JSON.stringify({ path: resolved.displayPath, files }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'list_directory': {
        const listArgs = args || {};
        let resolvedDir: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          const rawPath = listArgs.path ?? listArgs.directory ?? '.';
          const directoryArg = String(rawPath || '.').trim() || '.';
          resolvedDir = resolveAllowedWorkspacePath(directoryArg, { requireDirectory: true, allowEmpty: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const targetDir = resolvedDir.absPath;

        const maxEntries = Math.max(1, Math.min(1000, Math.floor(Number(listArgs.max_entries) || 500)));
        const maxDepth = Math.max(0, Math.min(8, Math.floor(Number(listArgs.max_depth ?? listArgs.depth) || 2)));
        const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache']);
        const entries: string[] = [];
        let truncated = false;

        const walk = (dir: string, depth: number): void => {
          if (entries.length >= maxEntries) {
            truncated = true;
            return;
          }

          let dirents: fs.Dirent[] = [];
          try {
            dirents = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }

          dirents.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

          for (const entry of dirents) {
            if (entries.length >= maxEntries) {
              truncated = true;
              return;
            }
            const abs = path.join(dir, entry.name);
            const rel = path.join(resolvedDir.displayPath === '.' ? '' : resolvedDir.displayPath, path.relative(targetDir, abs)).replace(/\\/g, '/');
            if (entry.isDirectory()) {
              entries.push(`[DIR]  ${rel}/`);
              if (depth < maxDepth && !skipDirs.has(entry.name)) {
                walk(abs, depth + 1);
              }
            } else if (entry.isFile()) {
              entries.push(`[FILE] ${rel}`);
            }
          }
        };

        walk(targetDir, 0);
        const listedPath = resolvedDir.displayPath;
        const header = `Directory ${listedPath} (max_depth=${maxDepth}, entries=${entries.length}${truncated ? `/${maxEntries}+` : ''}):`;
        const footer = truncated ? `\n...[truncated; pass max_depth or max_entries to narrow/expand]` : '';
        return { name, args, result: `${header}\n${entries.join('\n') || '(empty directory)'}${footer}`, error: false };
      }

	      case 'read_file': {
	        const filename = args.filename || args.name;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
        const normalizedFn = String(filename || '').replace(/\\/g, '/');
        const ROOT_READ_ALLOWLIST = ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'CHANGELOG.md'];
        if (normalizedFn.startsWith('src/') || ROOT_READ_ALLOWLIST.includes(normalizedFn)) {
          return executeTool('read_source', { ...args, file: filename }, workspacePath, deps, sessionId);
        }
        if (normalizedFn.startsWith('web-ui/')) {
          return executeTool('read_webui_source', { ...args, file: normalizedFn.slice('web-ui/'.length) }, workspacePath, deps, sessionId);
        }
        let resolvedFile: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedFile = resolveAllowedWorkspacePath(String(filename), { requireFile: true });
        } catch (err: any) {
          const requested = String(filename || '').replace(/\\/g, '/');
          return { name, args, result: recoverWorkspacePathError(err, requested, 'list_dir'), error: true };
        }
        const filePath = resolvedFile.absPath;
        const content = fs.readFileSync(filePath, 'utf-8');
        const allLines = content.split('\n');
        const hasWindowArgs = args.start_line !== undefined || args.num_lines !== undefined;
        if (hasWindowArgs) {
          const startLine = Math.max(1, Math.floor(Number(args.start_line) || 1));
          const numLines = Math.max(1, Math.floor(Number(args.num_lines) || 240));
          const startIdx = startLine - 1;
          if (startIdx >= allLines.length) {
            return { name, args, result: buildLineOutOfRangeRecovery(resolvedFile.displayPath, allLines, startLine, 'read_file', 'start_line'), error: true };
          }
          const windowLines = allLines.slice(startIdx, startIdx + numLines);
          const numberedWindow = windowLines.map((line, i) => `${startLine + i}: ${line}`).join('\n');
          const endLine = startLine + windowLines.length - 1;
          return { name, args, result: `${resolvedFile.displayPath} (${allLines.length} lines) [window ${startLine}-${endLine}]:\n${numberedWindow}`, error: false };
        }
	        const numbered = allLines.map((line, i) => `${i + 1}: ${line}`).join('\n');
	        return { name, args, result: `${resolvedFile.displayPath} (${allLines.length} lines):\n${numbered}`, error: false };
	      }

	      case 'mkdir': {
	        const requestedPath = args.path || args.directory || args.name;
	        if (!requestedPath) return { name, args, result: 'path is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(requestedPath));
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'dir', 'mkdir');
	          if (blocked) return blocked;
	          fs.mkdirSync(resolved.absPath, { recursive: true });
	          return { name, args, result: `OK directory created: ${resolved.normalizedRel}`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, requestedPath, 'list_dir'), error: true };
	        }
	      }

	      case 'create_file': {
	        const filename = args.filename || args.name || args.path;
	        const content = String(args.content ?? '');
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename));
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'create_file');
	          if (blocked) return blocked;
	          if (fs.existsSync(resolved.absPath)) {
	            return { name, args, result: `ERROR: File "${resolved.normalizedRel}" already exists. Use write_file, replace_lines, or find_replace to edit it.`, error: true };
	          }
	          fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
	          fs.writeFileSync(resolved.absPath, content, 'utf-8');
	          return { name, args, result: `OK created ${resolved.normalizedRel} (${content.split('\n').length} lines).`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'write_file': {
	        const filename = args.filename || args.name || args.path;
	        const content = String(args.content ?? '');
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename));
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'write_file');
	          if (blocked) return blocked;
	          fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
	          fs.writeFileSync(resolved.absPath, content, 'utf-8');
	          return { name, args, result: `OK wrote ${resolved.normalizedRel} (${content.split('\n').length} lines).`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'replace_lines': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        const start = Math.max(1, Math.floor(Number(args.start_line) || 0));
	        const end = Math.max(start, Math.floor(Number(args.end_line) || start));
	        if (!start || !end) return { name, args, result: 'start_line and end_line are required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'replace_lines');
	          if (blocked) return blocked;
	          const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	          if (start > lines.length) return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, lines, start, 'read_file', 'start_line'), error: true };
	          const endClamped = Math.min(end, lines.length);
	          const newLines = String(args.new_content ?? '').split('\n');
	          lines.splice(start - 1, endClamped - start + 1, ...newLines);
	          fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	          return { name, args, result: `OK ${resolved.normalizedRel}: replaced lines ${start}-${endClamped}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'insert_after': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        const afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'insert_after');
	          if (blocked) return blocked;
	          const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	          if (afterLine > lines.length) return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, lines, afterLine, 'read_file', 'after_line'), error: true };
	          const newLines = String(args.content ?? '').split('\n');
	          lines.splice(afterLine, 0, ...newLines);
	          fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	          return { name, args, result: `OK ${resolved.normalizedRel}: inserted after line ${afterLine}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'delete_lines': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        const start = Math.max(1, Math.floor(Number(args.start_line) || 0));
	        const end = Math.max(start, Math.floor(Number(args.end_line) || start));
	        if (!start || !end) return { name, args, result: 'start_line and end_line are required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'delete_lines');
	          if (blocked) return blocked;
	          const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	          if (start > lines.length) return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, lines, start, 'read_file', 'start_line'), error: true };
	          const endClamped = Math.min(end, lines.length);
	          lines.splice(start - 1, endClamped - start + 1);
	          fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	          return { name, args, result: `OK ${resolved.normalizedRel}: deleted lines ${start}-${endClamped}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'find_replace': {
	        const filename = args.filename || args.name || args.path || args.file;
	        const find = String(args.find ?? '');
	        const replace = String(args.replace ?? '');
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        if (!find) return { name, args, result: 'find is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'find_replace');
	          if (blocked) return blocked;
	          const content = fs.readFileSync(resolved.absPath, 'utf-8');
	          if (!content.includes(find)) return { name, args, result: buildTextNotFoundRecovery(resolved.normalizedRel, content, find, 'read_file'), error: true };
	          const updated = args.replace_all === true ? content.split(find).join(replace) : content.replace(find, replace);
	          fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	          return { name, args, result: `OK ${resolved.normalizedRel}: replaced ${args.replace_all === true ? 'all occurrences' : 'first occurrence'}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

	      case 'rename_file': {
	        const oldPath = args.old_path || args.oldPath || args.filename || args.name;
	        const newPath = args.new_path || args.newPath || args.to || args.path;
	        if (!oldPath || !newPath) return { name, args, result: 'old_path and new_path are required', error: true };
	        try {
	          const oldResolved = resolveWorkspacePath(String(oldPath), { requireFile: true });
	          const newResolved = resolveWorkspacePath(String(newPath));
	          const oldBlocked = enforceMutationScope(oldResolved.normalizedRel, 'file', 'rename_file');
	          if (oldBlocked) return oldBlocked;
	          const newBlocked = enforceMutationScope(newResolved.normalizedRel, 'file', 'rename_file');
	          if (newBlocked) return newBlocked;
	          fs.mkdirSync(path.dirname(newResolved.absPath), { recursive: true });
	          fs.renameSync(oldResolved.absPath, newResolved.absPath);
	          return { name, args, result: `OK renamed ${oldResolved.normalizedRel} to ${newResolved.normalizedRel}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, oldPath, 'list_dir'), error: true };
	        }
	      }

	      case 'delete_file': {
	        const filename = args.filename || args.name || args.path || args.file;
	        if (!filename) return { name, args, result: 'filename is required', error: true };
	        try {
	          const resolved = resolveWorkspacePath(String(filename), { requireFile: true });
	          const blocked = enforceMutationScope(resolved.normalizedRel, 'file', 'delete_file');
	          if (blocked) return blocked;
	          fs.unlinkSync(resolved.absPath);
	          return { name, args, result: `OK deleted ${resolved.normalizedRel}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: recoverWorkspacePathError(err, filename, 'list_dir'), error: true };
	        }
	      }

      case 'copy_file':
      case 'move_file': {
        const source = args.source || args.from || args.old_path || args.filename || args.path;
        const destination = args.destination || args.dest || args.to || args.new_path;
        if (!source || !destination) return { name, args, result: 'source and destination are required', error: true };
        try {
          const src = resolveAllowedWorkspacePath(String(source), { requireFile: true });
          const dest = resolveAllowedWorkspacePath(String(destination));
          const srcBlocked = enforceMutationScope(src.normalizedRel, 'file', name);
          if (srcBlocked) return srcBlocked;
          const destBlocked = enforceMutationScope(dest.normalizedRel, 'file', name);
          if (destBlocked) return destBlocked;
          const overwrite = args.overwrite === true;
          if (fs.existsSync(dest.absPath) && !overwrite) {
            return { name, args, result: `ERROR: destination exists: ${dest.displayPath}. Pass overwrite=true to replace it.`, error: true };
          }
          const plan = { operation: name, from: src.displayPath, to: dest.displayPath, overwrite, will_overwrite: fs.existsSync(dest.absPath) };
          if (args.dry_run === true) return { name, args, result: JSON.stringify(plan, null, 2), error: false };
          if (args.create_dirs !== false) fs.mkdirSync(path.dirname(dest.absPath), { recursive: true });
          if (fs.existsSync(dest.absPath) && overwrite) fs.rmSync(dest.absPath, { force: true });
          if (name === 'copy_file') fs.copyFileSync(src.absPath, dest.absPath);
          else fs.renameSync(src.absPath, dest.absPath);
          return { name, args, result: `OK ${name === 'copy_file' ? 'copied' : 'moved'} ${src.displayPath} to ${dest.displayPath}.`, error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'copy_directory':
      case 'move_directory': {
        const source = args.source || args.from || args.old_path || args.path;
        const destination = args.destination || args.dest || args.to || args.new_path;
        if (!source || !destination) return { name, args, result: 'source and destination are required', error: true };
        try {
          const src = resolveAllowedWorkspacePath(String(source), { requireDirectory: true });
          const dest = resolveAllowedWorkspacePath(String(destination));
          const srcBlocked = enforceMutationScope(src.normalizedRel, 'dir', name);
          if (srcBlocked) return srcBlocked;
          const destBlocked = enforceMutationScope(dest.normalizedRel, 'dir', name);
          if (destBlocked) return destBlocked;
          const maxEntries = Math.max(1, Math.min(20000, Number(args.max_entries || 2000)));
          const counts = countDirectoryFiles(src.absPath, maxEntries);
          if (counts.truncated) return { name, args, result: `ERROR: source exceeds max_entries=${maxEntries}. Increase max_entries intentionally or narrow the operation.`, error: true };
          const overwrite = args.overwrite === true;
          if (fs.existsSync(dest.absPath) && !overwrite) {
            return { name, args, result: `ERROR: destination exists: ${dest.displayPath}. Pass overwrite=true to replace it.`, error: true };
          }
          const plan = { operation: name, from: src.displayPath, to: dest.displayPath, overwrite, will_overwrite: fs.existsSync(dest.absPath), ...counts };
          if (args.dry_run === true) return { name, args, result: JSON.stringify(plan, null, 2), error: false };
          if (fs.existsSync(dest.absPath) && overwrite) fs.rmSync(dest.absPath, { recursive: true, force: true });
          fs.mkdirSync(path.dirname(dest.absPath), { recursive: true });
          if (name === 'copy_directory') fs.cpSync(src.absPath, dest.absPath, { recursive: true, force: overwrite, errorOnExist: !overwrite });
          else fs.renameSync(src.absPath, dest.absPath);
          return { name, args, result: `OK ${name === 'copy_directory' ? 'copied' : 'moved'} directory ${src.displayPath} to ${dest.displayPath} (${counts.files} files).`, error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'path_exists': {
        const requested = args.path || args.filename || args.file;
        if (!requested) return { name, args, result: 'path is required', error: true };
        try {
          const resolved = resolveAllowedWorkspacePath(String(requested));
          if (!fs.existsSync(resolved.absPath)) return { name, args, result: JSON.stringify({ path: resolved.displayPath, exists: false }, null, 2), error: false };
          const stat = fs.statSync(resolved.absPath);
          return {
            name,
            args,
            result: JSON.stringify({
              path: resolved.displayPath,
              exists: true,
              is_file: stat.isFile(),
              is_directory: stat.isDirectory(),
              bytes: stat.size,
              modified: stat.mtime.toISOString(),
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'show_diff':
      case 'git_diff': {
        try {
          const maxChars = Math.max(1000, Math.min(100000, Number(args.max_chars || 12000)));
          const parts = ['git diff'];
          if (args.staged === true) parts.push('--cached');
          if (args.stat === true) parts.push('--stat');
          if (args.path) {
            const resolved = resolveAllowedWorkspacePath(String(args.path));
            parts.push('--', quoteArg(resolved.displayPath));
          }
          const result = await runCapturedToolCommand(parts.join(' '), workspacePath, 120000);
          result.result = truncateText(result.result, maxChars);
          return result;
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'preview_patch':
      case 'apply_patch': {
        const patchText = String(args.patch || '');
        if (!patchText.trim()) return { name, args, result: 'patch is required', error: true };
        try {
          const targets = validatePatchTargetPaths(patchText);
          const tmpPath = path.join(getConfig().getConfigDir(), `patch-${Date.now()}-${Math.random().toString(36).slice(2)}.diff`);
          fs.writeFileSync(tmpPath, patchText, 'utf-8');
          try {
            const check = await deps.runCommandCaptured(`git apply --check --whitespace=nowarn ${quoteArg(tmpPath)}`, workspacePath, 120000);
            const checkOutput = [check.stdout, check.stderr].filter(Boolean).join('\n').trim();
            if (check.code !== 0 || check.timedOut) {
              return { name, args, result: `Patch check failed:\n${truncateText(checkOutput || `exit ${check.code}`, 8000)}`, error: true };
            }
            if (name === 'preview_patch' || args.check === true) {
              return { name, args, result: JSON.stringify({ checked_only: true, files: targets, file_count: targets.length }, null, 2), error: false };
            }
            const applied = await deps.runCommandCaptured(`git apply --whitespace=nowarn ${quoteArg(tmpPath)}`, workspacePath, 120000);
            const appliedOutput = [applied.stdout, applied.stderr].filter(Boolean).join('\n').trim();
            return { name, args, result: applied.code === 0 ? `Patch applied to ${targets.length} file(s).` : `Patch apply failed:\n${truncateText(appliedOutput, 8000)}`, error: applied.code !== 0 };
          } finally {
            try { fs.unlinkSync(tmpPath); } catch {}
          }
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

	      case 'file_stats': {
        const filename = args.filename || args.name || args.path;
        if (!filename) return { name, args, result: 'filename is required', error: true };
        const normalizedFilename = String(filename).replace(/\\/g, '/');
        if (normalizedFilename.startsWith('src/')) {
          return executeTool('source_stats', { ...args, file: normalizedFilename }, workspacePath, deps, sessionId);
        }
        if (normalizedFilename.startsWith('web-ui/')) {
          return executeTool('webui_source_stats', { ...args, file: normalizedFilename }, workspacePath, deps, sessionId);
        }
        let resolvedFile: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedFile = resolveAllowedWorkspacePath(String(filename), { requireFile: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const filePath = resolvedFile.absPath;
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lineCount = content.split('\n').length;
        const readCap = 240;
        const payload = {
          file: resolvedFile.displayPath,
          line_count: lineCount,
          bytes: stat.size,
          last_modified: stat.mtime.toISOString(),
          is_large: lineCount > readCap,
          read_hint: lineCount > readCap
            ? `File has ${lineCount} lines (cap=${readCap}). Use read_file with start_line/num_lines for chunked reads.`
            : `File fits in one read_file call (${lineCount} lines).`,
        };
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'source_stats':
      case 'src_stats': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'file path is required', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const normalizedRel = rel.replace(/^\.?\//, '').replace(/^src\//, '');
        const absPath = path.resolve(srcRoot, normalizedRel);
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: source_stats only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${normalizedRel}`, srcRoot, normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) return { name, args, result: `"src/${normalizedRel}" is not a file`, error: true };
        const content = fs.readFileSync(absPath, 'utf-8');
        const lineCount = content.split('\n').length;
        const readCap = 300;
        const payload = {
          file: `src/${normalizedRel}`,
          line_count: lineCount,
          bytes: stat.size,
          last_modified: stat.mtime.toISOString(),
          is_large: lineCount > readCap,
          read_hint: lineCount > readCap
            ? `File has ${lineCount} lines (cap=${readCap}). Use read_source with start_line+num_lines for chunked reads.`
            : `File fits in one read_source call (${lineCount} lines).`,
        };
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'prom_file_stats': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        const projectRoot = resolveProjectRootForSourceAccess();
        let resolved: { absPath: string; normalizedRel: string };
        try {
          resolved = resolvePromAllowedPath(projectRoot, rel);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const promDisplay = resolved.normalizedRel || '.';
        if (!fs.existsSync(resolved.absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(promDisplay, projectRoot, resolved.normalizedRel || '', 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
        }
        const stat = fs.statSync(resolved.absPath);
        if (!stat.isFile()) return { name, args, result: `"${promDisplay}" is not a file`, error: true };
        const content = fs.readFileSync(resolved.absPath, 'utf-8');
        const lineCount = content.split('\n').length;
        const readCap = 300;
        const payload = {
          file: promDisplay,
          line_count: lineCount,
          bytes: stat.size,
          last_modified: stat.mtime.toISOString(),
          is_large: lineCount > readCap,
          read_hint: lineCount > readCap
            ? `File has ${lineCount} lines (cap=${readCap}). Use read_prom_file with start_line+num_lines for chunked reads.`
            : `File fits in one read_prom_file call (${lineCount} lines).`,
        };
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'webui_source_stats':
      case 'webui_stats': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'file path is required', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const webUiRoot = path.join(projectRoot, 'web-ui');
        const normalizedRel = rel.replace(/^\.?\//, '').replace(/^web-ui\//, '');
        const absPath = path.resolve(webUiRoot, normalizedRel);
        if (!absPath.startsWith(webUiRoot)) {
          return { name, args, result: 'ERROR: webui_source_stats only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${normalizedRel}`, webUiRoot, normalizedRel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) return { name, args, result: `"web-ui/${normalizedRel}" is not a file`, error: true };
        const content = fs.readFileSync(absPath, 'utf-8');
        const lineCount = content.split('\n').length;
        const readCap = 300;
        const payload = {
          file: `web-ui/${normalizedRel}`,
          line_count: lineCount,
          bytes: stat.size,
          last_modified: stat.mtime.toISOString(),
          is_large: lineCount > readCap,
          read_hint: lineCount > readCap
            ? `File has ${lineCount} lines (cap=${readCap}). Use read_webui_source with start_line+num_lines for chunked reads.`
            : `File fits in one read_webui_source call (${lineCount} lines).`,
        };
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'grep_file': {
        const filename = args.filename || args.name || args.path;
        const pattern = String(args.pattern || '');
        if (!filename) return { name, args, result: 'filename is required', error: true };
        if (!pattern) return { name, args, result: 'pattern is required', error: true };
        let resolvedFile: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedFile = resolveAllowedWorkspacePath(String(filename), { requireFile: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const filePath = resolvedFile.absPath;
        const stat = fs.statSync(filePath);
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, args.case_insensitive ? 'gi' : 'g');
        } catch {
          return { name, args, result: `Invalid regex pattern: ${pattern}`, error: true };
        }
        const contextLines = Math.max(0, Math.min(10, Math.floor(Number(args.context ?? args.context_lines) || 0)));
        const maxResults = Math.max(1, Math.min(200, Math.floor(Number(args.max_results) || 100)));
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        const matches: Array<{
          line_number: number;
          line: string;
          context_before?: string[];
          context_after?: string[];
        }> = [];
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          regex.lastIndex = 0;
          if (!regex.test(lines[i])) continue;
          const item: {
            line_number: number;
            line: string;
            context_before?: string[];
            context_after?: string[];
          } = {
            line_number: i + 1,
            line: lines[i],
          };
          if (contextLines > 0) {
            item.context_before = lines.slice(Math.max(0, i - contextLines), i);
            item.context_after = lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines));
          }
          matches.push(item);
        }
        const payload = {
          file: resolvedFile.displayPath,
          pattern,
          match_count: matches.length,
          matches,
        };
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'search_files':
      case 'grep_files': {
        const pattern = String(args.pattern || '');
        if (!pattern) return { name, args, result: 'pattern is required', error: true };
        const directoryArg = name === 'grep_files'
          ? (args.path || args.directory || '.')
          : (args.directory || args.path || '.');
        let resolvedDir: { absPath: string; normalizedRel: string; displayPath: string };
        try {
          resolvedDir = resolveAllowedWorkspacePath(String(directoryArg), { requireDirectory: true, allowEmpty: true });
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        const searchDir = resolvedDir.absPath;
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, args.case_insensitive ? 'gi' : 'g');
        } catch {
          return { name, args, result: `Invalid regex pattern: ${pattern}`, error: true };
        }
        const rawGlob = String((name === 'grep_files' ? args.glob : args.file_glob) || args.file_glob || args.glob || '').trim().toLowerCase();
        const globs = rawGlob ? rawGlob.split(',').map((g: string) => g.trim()).filter(Boolean) : [];
        const contextLines = Math.max(0, Math.min(5, Math.floor(Number(args.context ?? args.context_lines) || 0)));
        const maxResults = Math.max(1, Math.min(500, Math.floor(Number(args.max_results) || 100)));
        const matches: Array<{ file: string; line_number: number; line: string; context_before?: string[]; context_after?: string[] }> = [];
        const matchesGlob = (filename: string): boolean => {
          if (!globs.length) return true;
          const lower = filename.toLowerCase();
          return globs.some((g: string) => {
            if (g.startsWith('*.')) return lower.endsWith(g.slice(1));
            return lower.includes(g.replace(/\*/g, ''));
          });
        };
        const walk = (dir: string): void => {
          if (matches.length >= maxResults) return;
          let entries: fs.Dirent[] = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (matches.length >= maxResults) break;
            const abs = path.join(dir, entry.name);
            const rel = path.join(resolvedDir.displayPath === '.' ? '' : resolvedDir.displayPath, path.relative(searchDir, abs)).replace(/\\/g, '/');
            if (entry.isDirectory()) {
              if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
              walk(abs);
              continue;
            }
            if (!entry.isFile()) continue;
            if (!matchesGlob(entry.name)) continue;
            let content = '';
            try { content = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
              regex.lastIndex = 0;
              if (!regex.test(lines[i])) continue;
              const item = { file: rel, line_number: i + 1, line: lines[i], context_before: undefined as string[] | undefined, context_after: undefined as string[] | undefined };
              if (contextLines > 0) {
                item.context_before = lines.slice(Math.max(0, i - contextLines), i);
                item.context_after = lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines));
              }
              matches.push(item);
            }
          }
        };
        walk(searchDir);
        const payload = {
          directory: resolvedDir.displayPath,
          pattern,
          match_count: matches.length,
          matches,
        };
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'grep_webui_source':
      case 'grep_source': {
        const gs_pattern = String(args.pattern || '');
        if (!gs_pattern) return { name, args, result: 'pattern is required', error: true };
        const gs_projectRoot = resolveProjectRootForSourceAccess();
        const gs_srcRoot = path.join(gs_projectRoot, 'src');
        const gs_webUiRoot = path.join(gs_projectRoot, 'web-ui');
        const gs_defaultRoot = name === 'grep_webui_source' ? 'web-ui' : 'src';
        const gs_rootParam = String(args.root || gs_defaultRoot).toLowerCase();
        const gs_searchBoth = gs_rootParam === 'both';
        const gs_useSrc = gs_searchBoth || gs_rootParam === 'src';
        const gs_useWebUi = gs_searchBoth || gs_rootParam === 'web-ui';
        const gs_rawGlob = String(args.glob || '').trim().toLowerCase();
        const gs_globs = gs_rawGlob ? gs_rawGlob.split(',').map((g: string) => g.trim()).filter(Boolean) : [];
        let gs_regex: RegExp;
        try {
          gs_regex = new RegExp(gs_pattern, args.case_insensitive ? 'gi' : 'g');
        } catch {
          return { name, args, result: `Invalid regex pattern: ${gs_pattern}`, error: true };
        }
        const gs_contextLines = Math.max(0, Math.min(10, Math.floor(Number(args.context || 0))));
        const gs_maxResults = Math.max(1, Math.min(500, Math.floor(Number(args.max_results) || 100)));
        const gs_matchesGlob = (filename: string): boolean => {
          if (!gs_globs.length) return true;
          const lower = filename.toLowerCase();
          return gs_globs.some((g: string) => {
            if (g.startsWith('*.')) return lower.endsWith(g.slice(1));
            return lower.includes(g.replace(/\*/g, ''));
          });
        };
        type GrepMatch = { file: string; line_number: number; line: string; context_before?: string[]; context_after?: string[] };
        const gs_matches: GrepMatch[] = [];
        const gs_walkDir = (dir: string, rootDir: string, label: string): void => {
          if (gs_matches.length >= gs_maxResults) return;
          let entries: fs.Dirent[] = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (gs_matches.length >= gs_maxResults) break;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
              gs_walkDir(abs, rootDir, label);
              continue;
            }
            if (!entry.isFile()) continue;
            if (!gs_matchesGlob(entry.name)) continue;
            let content = '';
            try { content = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
            const lines = content.split('\n');
            const relPath = label + '/' + path.relative(rootDir, abs).replace(/\\/g, '/');
            for (let i = 0; i < lines.length && gs_matches.length < gs_maxResults; i++) {
              gs_regex.lastIndex = 0;
              if (!gs_regex.test(lines[i])) continue;
              const item: GrepMatch = { file: relPath, line_number: i + 1, line: lines[i] };
              if (gs_contextLines > 0) {
                item.context_before = lines.slice(Math.max(0, i - gs_contextLines), i);
                item.context_after = lines.slice(i + 1, Math.min(lines.length, i + 1 + gs_contextLines));
              }
              gs_matches.push(item);
            }
          }
        };
        const gs_rawPath = gs_searchBoth ? '' : String(args.path || '').trim();
        if (gs_useSrc) {
          const gs_srcSubdir = gs_rawPath ? path.resolve(gs_srcRoot, gs_rawPath) : gs_srcRoot;
          if (!gs_srcSubdir.startsWith(gs_srcRoot)) return { name, args, result: `ERROR: path "${gs_rawPath}" is outside src/`, error: true };
          if (!fs.existsSync(gs_srcSubdir)) return { name, args, result: buildPathNotFoundRecovery(`src/${gs_rawPath}`, gs_srcRoot, gs_rawPath, 'list_source', { displayPrefix: 'src/', directoriesOnly: true }), error: true };
          gs_walkDir(gs_srcSubdir, gs_srcRoot, 'src');
        }
        if (gs_useWebUi) {
          const gs_webUiSubdir = gs_rawPath ? path.resolve(gs_webUiRoot, gs_rawPath) : gs_webUiRoot;
          if (!gs_webUiSubdir.startsWith(gs_webUiRoot)) return { name, args, result: `ERROR: path "${gs_rawPath}" is outside web-ui/`, error: true };
          if (!fs.existsSync(gs_webUiSubdir)) return { name, args, result: buildPathNotFoundRecovery(`web-ui/${gs_rawPath}`, gs_webUiRoot, gs_rawPath, 'list_webui_source', { displayPrefix: 'web-ui/', directoriesOnly: true }), error: true };
          gs_walkDir(gs_webUiSubdir, gs_webUiRoot, 'web-ui');
        }
        const gs_searchedLabel = gs_searchBoth ? 'src/ + web-ui/' : (gs_useSrc ? 'src/' + (gs_rawPath ? gs_rawPath : '') : 'web-ui/' + (gs_rawPath ? gs_rawPath : ''));
        const gs_payload = { searched: gs_searchedLabel, pattern: gs_pattern, match_count: gs_matches.length, matches: gs_matches };
        return { name, args, result: JSON.stringify(gs_payload, null, 2), error: false };
      }

      case 'grep_prom': {
        const gp_pattern = String(args.pattern || '');
        if (!gp_pattern) return { name, args, result: 'pattern is required', error: true };
        let gp_regex: RegExp;
        try {
          gp_regex = new RegExp(gp_pattern, args.case_insensitive ? 'gi' : 'g');
        } catch {
          return { name, args, result: `Invalid regex pattern: ${gp_pattern}`, error: true };
        }
        const gp_projectRoot = resolveProjectRootForSourceAccess();
        const gp_requestedPath = String(args.path || '').replace(/\\/g, '/');
        let gp_resolved: { absPath: string; normalizedRel: string };
        try {
          gp_resolved = resolvePromAllowedPath(gp_projectRoot, gp_requestedPath);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        if (!fs.existsSync(gp_resolved.absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(gp_resolved.normalizedRel || '.', gp_projectRoot, gp_resolved.normalizedRel || '', 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
        }
        const gp_rootStat = fs.statSync(gp_resolved.absPath);
        if (!gp_rootStat.isDirectory()) {
          return { name, args, result: `"${gp_resolved.normalizedRel || '.'}" is not a directory`, error: true };
        }
        const gp_contextLines = Math.max(0, Math.min(10, Math.floor(Number(args.context || 0))));
        const gp_maxResults = Math.max(1, Math.min(500, Math.floor(Number(args.max_results) || 100)));
        const gp_rawGlob = String(args.glob || '').trim().toLowerCase();
        const gp_globs = gp_rawGlob ? gp_rawGlob.split(',').map((g: string) => g.trim()).filter(Boolean) : [];
        const gp_matchesGlob = (filename: string): boolean => {
          if (!gp_globs.length) return true;
          const lower = filename.toLowerCase();
          return gp_globs.some((g: string) => {
            if (g.startsWith('*.')) return lower.endsWith(g.slice(1));
            return lower.includes(g.replace(/\*/g, ''));
          });
        };
        type PromGrepMatch = { file: string; line_number: number; line: string; context_before?: string[]; context_after?: string[] };
        const gp_matches: PromGrepMatch[] = [];
        const gp_walkDir = (dir: string): void => {
          if (gp_matches.length >= gp_maxResults) return;
          let entries: fs.Dirent[] = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (gp_matches.length >= gp_maxResults) break;
            const abs = path.join(dir, entry.name);
            const relFromRoot = path.relative(gp_projectRoot, abs).replace(/\\/g, '/');
            if (entry.isDirectory()) {
              if (!isPromAllowedPath(relFromRoot)) continue;
              gp_walkDir(abs);
              continue;
            }
            if (!entry.isFile()) continue;
            if (!isPromAllowedPath(relFromRoot)) continue;
            if (!gp_matchesGlob(entry.name)) continue;
            let content = '';
            try { content = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && gp_matches.length < gp_maxResults; i++) {
              gp_regex.lastIndex = 0;
              if (!gp_regex.test(lines[i])) continue;
              const item: PromGrepMatch = { file: relFromRoot || '.', line_number: i + 1, line: lines[i] };
              if (gp_contextLines > 0) {
                item.context_before = lines.slice(Math.max(0, i - gp_contextLines), i);
                item.context_after = lines.slice(i + 1, Math.min(lines.length, i + 1 + gp_contextLines));
              }
              gp_matches.push(item);
            }
          }
        };
        gp_walkDir(gp_resolved.absPath);
        const gp_payload = { searched: gp_resolved.normalizedRel || '.', pattern: gp_pattern, match_count: gp_matches.length, matches: gp_matches };
        return { name, args, result: JSON.stringify(gp_payload, null, 2), error: false };
      }
      // ── read_source: read a file from src/ only ───────────────────────────────
      case 'read_source': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'ERROR: file path required.', error: true };
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const normalizedRel = rel.replace(/^\.?\//, '').replace(/^src\//, '');
        const absPath = path.resolve(srcRoot, normalizedRel);
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: read_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${normalizedRel}`, srcRoot, normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          const entries = renderDirectoryEntries(absPath);
          return { name, args, result: `${normalizedRel ? `src/${normalizedRel}` : 'src'}/:\n${entries.join('\n') || '(empty)'}`, error: false };
        }
        const content = fs.readFileSync(absPath, 'utf-8');
        const relDisplay = 'src/' + absPath.slice(srcRoot.length + 1).replace(/\\/g, '/');
        const allLines = content.split('\n');
        return { name, args, result: renderNumberedRead(relDisplay, allLines, args), error: false };
      }

      // ── list_source: list files/dirs inside src/ ──────────────────────────────
	      case 'delete_source': {
	        const ds_sid = String(sessionId || '');
        const dsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (dsSessionGate) return dsSessionGate;
	        const ds_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
	        if (!ds_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const ds_projectRel = `src/${ds_rel.replace(/^\.?\/?src\//, '')}`;
	        const ds_scopeBlocked = enforceProposalWriteAccess(ds_projectRel, 'file', name);
	        if (ds_scopeBlocked) return ds_scopeBlocked;
	        const ds_projectRoot = resolveProjectRootForSourceAccess();
	        const ds_srcRoot = path.join(ds_projectRoot, 'src');
	        const ds_absPath = path.resolve(ds_srcRoot, ds_rel.replace(/^\.?\/?src\//, ''));
	        if (!ds_absPath.startsWith(ds_srcRoot)) {
	          return { name, args, result: 'ERROR: delete_source only allows access to src/ directory.', error: true };
	        }
	        if (!fs.existsSync(ds_absPath)) {
	          const ds_normalizedRel = ds_rel.replace(/^\.?\/?src\//, '');
	          return { name, args, result: buildPathNotFoundRecovery(`src/${ds_normalizedRel}`, ds_srcRoot, ds_normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
	        }
	        const ds_stat = fs.statSync(ds_absPath);
	        if (!ds_stat.isFile()) return { name, args, result: `"src/${ds_rel.replace(/^\.?\/?src\//, '')}" is not a file`, error: true };
	        fs.unlinkSync(ds_absPath);
	        const ds_display = 'src/' + ds_absPath.slice(ds_srcRoot.length + 1).replace(/\\/g, '/');
	        console.log(`[edit_source] delete_source: ${ds_display} (session: ${ds_sid})`);
	        return { name, args, result: `OK ${ds_display} deleted. ${getPostSourceEditInstructionForSession(sessionId, [ds_display])}`, error: false };
	      }

	      case 'list_source': {
        const rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?src\/?/, '') || '';
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const absPath = rel ? path.resolve(srcRoot, rel) : srcRoot;
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: list_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${rel}`, srcRoot, rel, 'list_source', { displayPrefix: 'src/', directoriesOnly: true }), error: true };
        }
        const entries = renderDirectoryEntries(absPath);
        const displayPath = rel ? `src/${rel}` : 'src';
        return { name, args, result: `${displayPath}/:\n${entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── list_prom: list files/dirs inside allowlisted Prometheus project-root surfaces ──
      case 'list_prom': {
        const projectRoot = resolveProjectRootForSourceAccess();
        let resolved: { absPath: string; normalizedRel: string };
        try {
          resolved = resolvePromAllowedPath(projectRoot, args.path || args.dir || '');
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        if (!fs.existsSync(resolved.absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel || '.', projectRoot, resolved.normalizedRel || '', 'list_prom', { include: (rel) => isPromAllowedPath(rel) }), error: true };
        }
        const stat = fs.statSync(resolved.absPath);
        if (!stat.isDirectory()) {
          return { name, args, result: `"${resolved.normalizedRel || '.'}" is not a directory`, error: true };
        }
        const entries = renderDirectoryEntries(resolved.absPath).filter((entry) => {
          const entryName = entry.replace(/^\[(?:DIR|FILE|\?\?)\]\s+/, '').replace(/\/$/, '');
          const relCandidate = resolved.normalizedRel ? `${resolved.normalizedRel}/${entryName}` : entryName;
          return isPromAllowedPath(relCandidate);
        });
        const displayPath = resolved.normalizedRel || '.';
        return { name, args, result: `${displayPath}/:\n${entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── read_prom_file: read a file or directory from allowlisted Prometheus root surfaces ──
      case 'read_prom_file': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        const projectRoot = resolveProjectRootForSourceAccess();
        let resolved: { absPath: string; normalizedRel: string };
        try {
          resolved = resolvePromAllowedPath(projectRoot, rel);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
        if (!fs.existsSync(resolved.absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel || '.', projectRoot, resolved.normalizedRel || '', 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
        }
        const stat = fs.statSync(resolved.absPath);
        if (stat.isDirectory()) {
          const entries = renderDirectoryEntries(resolved.absPath).filter((entry) => {
            const entryName = entry.replace(/^\[(?:DIR|FILE|\?\?)\]\s+/, '').replace(/\/$/, '');
            const relCandidate = resolved.normalizedRel ? `${resolved.normalizedRel}/${entryName}` : entryName;
            return isPromAllowedPath(relCandidate);
          });
          const displayPath = resolved.normalizedRel || '.';
          return { name, args, result: `${displayPath}/:\n${entries.join('\n') || '(empty)'}`, error: false };
        }
        const content = fs.readFileSync(resolved.absPath, 'utf-8');
        const allLines = content.split('\n');
	        return { name, args, result: renderNumberedRead(resolved.normalizedRel || path.basename(resolved.absPath), allLines, args), error: false };
	      }

	      case 'find_replace_prom': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const findText = String(args.find || '');
	        const replaceText = String(args.replace ?? '');
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        if (!findText) return { name, args, result: 'ERROR: find text required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const content = fs.readFileSync(resolved.absPath, 'utf-8');
	        if (!content.includes(findText)) {
	          return { name, args, result: buildTextNotFoundRecovery(resolved.normalizedRel, content, findText, 'read_prom_file'), error: true };
	        }
	        const replaceAll = args.replace_all === true;
	        const occurrences = replaceAll ? (content.split(findText).length - 1) : 1;
	        const updated = replaceAll ? content.split(findText).join(replaceText) : content.replace(findText, replaceText);
	        fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	        console.log(`[edit_prom] find_replace_prom: ${resolved.normalizedRel} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel} updated (${occurrences} occurrence${occurrences !== 1 ? 's' : ''} replaced). ${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`, error: false };
	      }

	      case 'replace_lines_prom': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const end = Math.max(start, Math.floor(Number(args.end_line) || start));
	        const newContent = String(args.new_content || '');
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        if (start > lines.length) {
	          return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, lines, start, 'read_prom_file', 'start_line'), error: true };
	        }
	        const endClamped = Math.min(end, lines.length);
	        lines.splice(start - 1, endClamped - start + 1, ...newContent.split('\n'));
	        fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	        console.log(`[edit_prom] replace_lines_prom: ${resolved.normalizedRel} lines ${start}-${endClamped} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel}: replaced lines ${start}-${endClamped} (now ${lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`, error: false };
	      }

	      case 'insert_after_prom': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
	        const content = String(args.content || '');
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        const insertAt = Math.min(afterLine, lines.length);
	        lines.splice(insertAt, 0, ...content.split('\n'));
	        fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	        console.log(`[edit_prom] insert_after_prom: ${resolved.normalizedRel} after line ${afterLine} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel}: inserted after line ${afterLine} (now ${lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`, error: false };
	      }

	      case 'delete_lines_prom': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const end = Math.max(start, Math.floor(Number(args.end_line) || start));
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        if (start > lines.length) {
	          return { name, args, result: buildLineOutOfRangeRecovery(resolved.normalizedRel, lines, start, 'read_prom_file', 'start_line'), error: true };
	        }
	        const endClamped = Math.min(end, lines.length);
	        lines.splice(start - 1, endClamped - start + 1);
	        fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	        console.log(`[edit_prom] delete_lines_prom: ${resolved.normalizedRel} lines ${start}-${endClamped} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel}: deleted lines ${start}-${endClamped} (now ${lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`, error: false };
	      }

	      case 'write_prom_file': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        const content = String(args.content || '');
	        const overwrite = args.overwrite !== false;
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!overwrite && fs.existsSync(resolved.absPath)) {
	          return { name, args, result: `File already exists: ${resolved.normalizedRel}. Set overwrite:true to replace it.`, error: true };
	        }
	        if (fs.existsSync(resolved.absPath) && fs.statSync(resolved.absPath).isDirectory()) {
	          return { name, args, result: `"${resolved.normalizedRel}" is a directory`, error: true };
	        }
	        fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
	        fs.writeFileSync(resolved.absPath, content, 'utf-8');
	        const lineCount = content.split('\n').length;
	        console.log(`[edit_prom] write_prom_file: ${resolved.normalizedRel} (${lineCount} lines, session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel} written (${lineCount} lines). ${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`, error: false };
	      }

	      case 'delete_prom_file': {
	        const gated = ensureProposalPromWriteTool(name);
	        if (gated) return gated;
	        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
	        if (!rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const projectRoot = resolveProjectRootForSourceAccess();
	        let resolved: { absPath: string; normalizedRel: string };
	        try {
	          resolved = resolvePromAllowedFilePath(projectRoot, rel);
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
	        }
	        const scopeBlocked = enforceProposalWriteAccess(resolved.normalizedRel, 'file', name);
	        if (scopeBlocked) return scopeBlocked;
	        if (!fs.existsSync(resolved.absPath)) {
	          return { name, args, result: buildPathNotFoundRecovery(resolved.normalizedRel, projectRoot, resolved.normalizedRel, 'list_prom', { include: (candidateRel) => isPromAllowedPath(candidateRel) }), error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        fs.unlinkSync(resolved.absPath);
	        console.log(`[edit_prom] delete_prom_file: ${resolved.normalizedRel} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel} deleted. ${getPostSourceEditInstructionForSession(sessionId, [resolved.normalizedRel])}`, error: false };
	      }

      // ── list_webui_source: list files/dirs inside web-ui/ ────────────────────
      case 'list_webui_source': {
        const lwu_rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\/?/, '') || '';
        const lwu_projectRoot = resolveProjectRootForSourceAccess();
        const lwu_webUiRoot = path.join(lwu_projectRoot, 'web-ui');
        const lwu_absPath = lwu_rel ? path.resolve(lwu_webUiRoot, lwu_rel) : lwu_webUiRoot;
        if (!lwu_absPath.startsWith(lwu_webUiRoot)) {
          return { name, args, result: 'ERROR: list_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(lwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${lwu_rel}`, lwu_webUiRoot, lwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/', directoriesOnly: true }), error: true };
        }
        const lwu_entries = renderDirectoryEntries(lwu_absPath);
        const lwu_displayPath = lwu_rel ? `web-ui/${lwu_rel}` : 'web-ui';
        return { name, args, result: `${lwu_displayPath}/:\n${lwu_entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── read_webui_source: read a file from web-ui/ ───────────────────────────
      case 'read_webui_source': {
        const rwu_rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        if (!rwu_rel) return { name, args, result: 'ERROR: file path required.', error: true };
        const rwu_projectRoot = resolveProjectRootForSourceAccess();
        const rwu_webUiRoot = path.join(rwu_projectRoot, 'web-ui');
        const rwu_absPath = path.resolve(rwu_webUiRoot, rwu_rel);
        if (!rwu_absPath.startsWith(rwu_webUiRoot)) {
          return { name, args, result: 'ERROR: read_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(rwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${rwu_rel}`, rwu_webUiRoot, rwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const rwu_stat = fs.statSync(rwu_absPath);
        if (rwu_stat.isDirectory()) {
          const rwu_entries = renderDirectoryEntries(rwu_absPath);
          return { name, args, result: `web-ui/${rwu_rel}/:\n${rwu_entries.join('\n') || '(empty)'}`, error: false };
        }
        const rwu_content = fs.readFileSync(rwu_absPath, 'utf-8');
        const rwu_display = 'web-ui/' + rwu_absPath.slice(rwu_webUiRoot.length + 1).replace(/\\/g, '/');
        const rwu_allLines = rwu_content.split('\n');
        return { name, args, result: renderNumberedRead(rwu_display, rwu_allLines, args), error: false };
      }

      // ── web-ui/ write tools (proposal sessions only) ─────────────────────────

      case 'find_replace_source': {
        const frs_sid = String(sessionId || '');
        const frsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (frsSessionGate) return frsSessionGate;
        const frs_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?src\//, '');
        const frs_find = String(args.find || '');
        const frs_replace = String(args.replace ?? '');
        if (!frs_rel) return { name, args, result: 'ERROR: file path required', error: true };
        if (!frs_find) return { name, args, result: 'ERROR: find text required', error: true };
        const frs_projectRel = `src/${frs_rel}`;
        const frs_scopeBlocked = enforceProposalWriteAccess(frs_projectRel, 'file', name);
        if (frs_scopeBlocked) return frs_scopeBlocked;
        const frs_projectRoot = resolveProjectRootForSourceAccess();
        const frs_srcRoot = path.join(frs_projectRoot, 'src');
        const frs_absPath = path.resolve(frs_srcRoot, frs_rel);
        if (!frs_absPath.startsWith(frs_srcRoot)) {
          return { name, args, result: 'ERROR: find_replace_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(frs_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${frs_rel}`, frs_srcRoot, frs_rel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const frs_content = fs.readFileSync(frs_absPath, 'utf-8');
        if (!frs_content.includes(frs_find)) {
          return { name, args, result: buildTextNotFoundRecovery(`src/${frs_rel}`, frs_content, frs_find, 'read_source'), error: true };
        }
        const frs_replaceAll = args.replace_all === true;
        const frs_occurrences = frs_replaceAll ? (frs_content.split(frs_find).length - 1) : 1;
        const frs_updated = frs_replaceAll
          ? frs_content.split(frs_find).join(frs_replace)
          : frs_content.replace(frs_find, frs_replace);
        const frs_invalidEdit = rejectInvalidSourceEdit(name, args, frs_absPath, frs_updated);
        if (frs_invalidEdit) return frs_invalidEdit;
        fs.writeFileSync(frs_absPath, frs_updated, 'utf-8');
        const frs_display = 'src/' + frs_absPath.slice(frs_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] find_replace_source: ${frs_display} (session: ${frs_sid})`);
        return { name, args, result: `✅ ${frs_display} updated (${frs_occurrences} occurrence${frs_occurrences !== 1 ? 's' : ''} replaced). ${getPostSourceEditInstructionForSession(sessionId, [frs_display])}`, error: false };
      }

	      case 'replace_lines_source': {
	        const rls_sid = String(sessionId || '');
        const rlsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (rlsSessionGate) return rlsSessionGate;
	        const rls_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
        const rls_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
        const rls_end = Math.max(rls_start, Math.floor(Number(args.end_line) || rls_start));
	        const rls_newContent = String(args.new_content || '');
	        if (!rls_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const rls_projectRel = `src/${rls_rel.replace(/^\.?\/?src\//, '')}`;
	        const rls_scopeBlocked = enforceProposalWriteAccess(rls_projectRel, 'file', name);
	        if (rls_scopeBlocked) return rls_scopeBlocked;
	        const rls_projectRoot = resolveProjectRootForSourceAccess();
	        const rls_srcRoot = path.join(rls_projectRoot, 'src');
        const rls_absPath = path.resolve(rls_srcRoot, rls_rel.replace(/^\.?\/?src\//, ''));
        if (!rls_absPath.startsWith(rls_srcRoot)) {
          return { name, args, result: 'ERROR: replace_lines_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(rls_absPath)) {
          const rls_normalizedRel = rls_rel.replace(/^\.?\/?src\//, '');
          return { name, args, result: buildPathNotFoundRecovery(`src/${rls_normalizedRel}`, rls_srcRoot, rls_normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const rls_lines = fs.readFileSync(rls_absPath, 'utf-8').split('\n');
        if (rls_start > rls_lines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(`src/${rls_rel.replace(/^\.?\/?src\//, '')}`, rls_lines, rls_start, 'read_source', 'start_line'), error: true };
        }
        const rls_endClamped = Math.min(rls_end, rls_lines.length);
        rls_lines.splice(rls_start - 1, rls_endClamped - rls_start + 1, ...rls_newContent.split('\n'));
        const rls_updated = rls_lines.join('\n');
        const rls_invalidEdit = rejectInvalidSourceEdit(name, args, rls_absPath, rls_updated);
        if (rls_invalidEdit) return rls_invalidEdit;
        fs.writeFileSync(rls_absPath, rls_updated, 'utf-8');
        const rls_display = 'src/' + rls_absPath.slice(rls_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] replace_lines_source: ${rls_display} lines ${rls_start}-${rls_endClamped} (session: ${rls_sid})`);
        return { name, args, result: `✅ ${rls_display}: replaced lines ${rls_start}-${rls_endClamped} (now ${rls_lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [rls_display])}`, error: false };
      }

      // ── insert_after_source: insert lines after a given line in src/ ─────────
	      case 'insert_after_source': {
	        const ias_sid = String(sessionId || '');
        const iasSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (iasSessionGate) return iasSessionGate;
	        const ias_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
	        const ias_afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
	        const ias_content = String(args.content || '');
	        if (!ias_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const ias_projectRel = `src/${ias_rel.replace(/^\.?\/?src\//, '')}`;
	        const ias_scopeBlocked = enforceProposalWriteAccess(ias_projectRel, 'file', name);
	        if (ias_scopeBlocked) return ias_scopeBlocked;
	        const ias_projectRoot = resolveProjectRootForSourceAccess();
	        const ias_srcRoot = path.join(ias_projectRoot, 'src');
        const ias_absPath = path.resolve(ias_srcRoot, ias_rel.replace(/^\.?\/?src\//, ''));
        if (!ias_absPath.startsWith(ias_srcRoot)) {
          return { name, args, result: 'ERROR: insert_after_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(ias_absPath)) {
          const ias_normalizedRel = ias_rel.replace(/^\.?\/?src\//, '');
          return { name, args, result: buildPathNotFoundRecovery(`src/${ias_normalizedRel}`, ias_srcRoot, ias_normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const ias_lines = fs.readFileSync(ias_absPath, 'utf-8').split('\n');
        const ias_insertAt = Math.min(ias_afterLine, ias_lines.length);
        ias_lines.splice(ias_insertAt, 0, ...ias_content.split('\n'));
        const ias_updated = ias_lines.join('\n');
        const ias_invalidEdit = rejectInvalidSourceEdit(name, args, ias_absPath, ias_updated);
        if (ias_invalidEdit) return ias_invalidEdit;
        fs.writeFileSync(ias_absPath, ias_updated, 'utf-8');
        const ias_display = 'src/' + ias_absPath.slice(ias_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] insert_after_source: ${ias_display} after line ${ias_afterLine} (session: ${ias_sid})`);
        return { name, args, result: `✅ ${ias_display}: inserted after line ${ias_afterLine} (now ${ias_lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [ias_display])}`, error: false };
      }

      // ── delete_lines_source: delete a range of lines from a src/ file ─────────
	      case 'delete_lines_source': {
	        const dls_sid = String(sessionId || '');
        const dlsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (dlsSessionGate) return dlsSessionGate;
	        const dls_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
	        const dls_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const dls_end = Math.max(dls_start, Math.floor(Number(args.end_line) || dls_start));
	        if (!dls_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const dls_projectRel = `src/${dls_rel.replace(/^\.?\/?src\//, '')}`;
	        const dls_scopeBlocked = enforceProposalWriteAccess(dls_projectRel, 'file', name);
	        if (dls_scopeBlocked) return dls_scopeBlocked;
	        const dls_projectRoot = resolveProjectRootForSourceAccess();
	        const dls_srcRoot = path.join(dls_projectRoot, 'src');
        const dls_absPath = path.resolve(dls_srcRoot, dls_rel.replace(/^\.?\/?src\//, ''));
        if (!dls_absPath.startsWith(dls_srcRoot)) {
          return { name, args, result: 'ERROR: delete_lines_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(dls_absPath)) {
          const dls_normalizedRel = dls_rel.replace(/^\.?\/?src\//, '');
          return { name, args, result: buildPathNotFoundRecovery(`src/${dls_normalizedRel}`, dls_srcRoot, dls_normalizedRel, 'list_source', { displayPrefix: 'src/' }), error: true };
        }
        const dls_lines = fs.readFileSync(dls_absPath, 'utf-8').split('\n');
        if (dls_start > dls_lines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(`src/${dls_rel.replace(/^\.?\/?src\//, '')}`, dls_lines, dls_start, 'read_source', 'start_line'), error: true };
        }
        const dls_endClamped = Math.min(dls_end, dls_lines.length);
        dls_lines.splice(dls_start - 1, dls_endClamped - dls_start + 1);
        const dls_updated = dls_lines.join('\n');
        const dls_invalidEdit = rejectInvalidSourceEdit(name, args, dls_absPath, dls_updated);
        if (dls_invalidEdit) return dls_invalidEdit;
        fs.writeFileSync(dls_absPath, dls_updated, 'utf-8');
        const dls_display = 'src/' + dls_absPath.slice(dls_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] delete_lines_source: ${dls_display} lines ${dls_start}-${dls_endClamped} (session: ${dls_sid})`);
        return { name, args, result: `✅ ${dls_display}: deleted lines ${dls_start}-${dls_endClamped} (now ${dls_lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [dls_display])}`, error: false };
      }

      // ── write_source: create or overwrite a file in src/ ─────────────────────
	      case 'write_source': {
	        const ws_sid = String(sessionId || '');
        const wsSessionGate = ensureDevSrcSelfEditWriteSession(name, 'src');
        if (wsSessionGate) return wsSessionGate;
	        const ws_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
	        const ws_content = String(args.content || '');
	        const ws_overwrite = args.overwrite !== false;
	        if (!ws_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const ws_projectRel = `src/${ws_rel.replace(/^\.?\/?src\//, '')}`;
	        const ws_scopeBlocked = enforceProposalWriteAccess(ws_projectRel, 'file', name);
	        if (ws_scopeBlocked) return ws_scopeBlocked;
	        const ws_projectRoot = resolveProjectRootForSourceAccess();
	        const ws_srcRoot = path.join(ws_projectRoot, 'src');
        const ws_absPath = path.resolve(ws_srcRoot, ws_rel.replace(/^\.?\/?src\//, ''));
        if (!ws_absPath.startsWith(ws_srcRoot)) {
          return { name, args, result: 'ERROR: write_source only allows access to src/ directory.', error: true };
        }
        if (!ws_overwrite && fs.existsSync(ws_absPath)) {
          return { name, args, result: `File already exists: src/${ws_rel.replace(/^\.?\/?src\//, '')}. Set overwrite:true to replace it.`, error: true };
        }
        const ws_invalidEdit = rejectInvalidSourceEdit(name, args, ws_absPath, ws_content);
        if (ws_invalidEdit) return ws_invalidEdit;
        fs.mkdirSync(path.dirname(ws_absPath), { recursive: true });
        fs.writeFileSync(ws_absPath, ws_content, 'utf-8');
        const ws_display = 'src/' + ws_absPath.slice(ws_srcRoot.length + 1).replace(/\\/g, '/');
        const ws_lineCount = ws_content.split('\n').length;
        console.log(`[edit_source] write_source: ${ws_display} (${ws_lineCount} lines, session: ${ws_sid})`);
        return { name, args, result: `✅ ${ws_display} written (${ws_lineCount} lines). ${getPostSourceEditInstructionForSession(sessionId, [ws_display])}`, error: false };
      }

      // ── list_source: list files/dirs inside src/ ──────────────────────────────
      case 'list_source': {
        const rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?src\/?/, '') || '';
        const projectRoot = resolveProjectRootForSourceAccess();
        const srcRoot = path.join(projectRoot, 'src');
        const absPath = rel ? path.resolve(srcRoot, rel) : srcRoot;
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: 'ERROR: list_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`src/${rel}`, srcRoot, rel, 'list_source', { displayPrefix: 'src/', directoriesOnly: true }), error: true };
        }
        const entries = fs.readdirSync(absPath).map(e => {
          try {
            const s = fs.statSync(path.join(absPath, e));
            return s.isDirectory() ? `[DIR]  ${e}/` : `[FILE] ${e}`;
          } catch { return `[??]   ${e}`; }
        });
        const displayPath = rel ? `src/${rel}` : 'src';
        return { name, args, result: `${displayPath}/:\n${entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── list_webui_source: list files/dirs inside web-ui/ ────────────────────
      case 'list_webui_source': {
        const lwu_rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\/?/, '') || '';
        const lwu_projectRoot = resolveProjectRootForSourceAccess();
        const lwu_webUiRoot = path.join(lwu_projectRoot, 'web-ui');
        const lwu_absPath = lwu_rel ? path.resolve(lwu_webUiRoot, lwu_rel) : lwu_webUiRoot;
        if (!lwu_absPath.startsWith(lwu_webUiRoot)) {
          return { name, args, result: 'ERROR: list_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(lwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${lwu_rel}`, lwu_webUiRoot, lwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/', directoriesOnly: true }), error: true };
        }
        const lwu_entries = fs.readdirSync(lwu_absPath).map(e => {
          try {
            const s = fs.statSync(path.join(lwu_absPath, e));
            return s.isDirectory() ? `[DIR]  ${e}/` : `[FILE] ${e}`;
          } catch { return `[??]   ${e}`; }
        });
        const lwu_displayPath = lwu_rel ? `web-ui/${lwu_rel}` : 'web-ui';
        return { name, args, result: `${lwu_displayPath}/:\n${lwu_entries.join('\n') || '(empty)'}`, error: false };
      }

      // ── read_webui_source: read a file from web-ui/ ───────────────────────────
      case 'read_webui_source': {
        const rwu_rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        if (!rwu_rel) return { name, args, result: 'ERROR: file path required.', error: true };
        const rwu_projectRoot = resolveProjectRootForSourceAccess();
        const rwu_webUiRoot = path.join(rwu_projectRoot, 'web-ui');
        const rwu_absPath = path.resolve(rwu_webUiRoot, rwu_rel);
        if (!rwu_absPath.startsWith(rwu_webUiRoot)) {
          return { name, args, result: 'ERROR: read_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(rwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${rwu_rel}`, rwu_webUiRoot, rwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const rwu_stat = fs.statSync(rwu_absPath);
        if (rwu_stat.isDirectory()) {
          const rwu_entries = fs.readdirSync(rwu_absPath).map(e => {
            const s = fs.statSync(path.join(rwu_absPath, e));
            return s.isDirectory() ? `[DIR]  ${e}/` : `[FILE] ${e}`;
          });
          return { name, args, result: rwu_entries.join('\n') || '(empty directory)', error: false };
        }
        const rwu_content = fs.readFileSync(rwu_absPath, 'utf-8');
        const rwu_display = 'web-ui/' + rwu_absPath.slice(rwu_webUiRoot.length + 1).replace(/\\/g, '/');
        const rwu_allLines = rwu_content.split('\n');
        const rwu_head = args.head ? Number(args.head) : 0;
        const rwu_tail = args.tail ? Number(args.tail) : 0;
        const rwu_startLine = args.start_line ? Math.max(1, Math.floor(Number(args.start_line))) : 0;
        const rwu_numLines = args.num_lines ? Math.max(1, Math.floor(Number(args.num_lines))) : 0;
        let rwu_sliced: string[];
        let rwu_firstLineNum: number;
        if (rwu_startLine > 0) {
          const from = rwu_startLine - 1;
          const to = rwu_numLines > 0 ? from + rwu_numLines : rwu_allLines.length;
          rwu_sliced = rwu_allLines.slice(from, to);
          rwu_firstLineNum = rwu_startLine;
        } else if (rwu_head > 0) {
          rwu_sliced = rwu_allLines.slice(0, rwu_head);
          rwu_firstLineNum = 1;
        } else if (rwu_tail > 0) {
          rwu_sliced = rwu_allLines.slice(-rwu_tail);
          rwu_firstLineNum = rwu_allLines.length - rwu_sliced.length + 1;
        } else {
          rwu_sliced = rwu_allLines;
          rwu_firstLineNum = 1;
        }
        const rwu_numbered = rwu_sliced.map((line, i) => `${rwu_firstLineNum + i}: ${line}`).join('\n');
        return { name, args, result: `${rwu_display} (${rwu_allLines.length} lines):\n${rwu_numbered}`, error: false };
      }

      // ── web-ui/ write tools (proposal sessions only) ─────────────────────────

      // ── find_replace_webui_source ─────────────────────────────────────────────
	      case 'find_replace_webui_source': {
	        const frwu_sid = String(sessionId || '');
        const frwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (frwuSessionGate) return frwuSessionGate;
	        const frwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const frwu_find = String(args.find || '');
	        const frwu_replace = String(args.replace ?? '');
	        if (!frwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        if (!frwu_find) return { name, args, result: 'ERROR: find text required', error: true };
	        const frwu_projectRel = `web-ui/${frwu_rel}`;
	        const frwu_scopeBlocked = enforceProposalWriteAccess(frwu_projectRel, 'file', name);
	        if (frwu_scopeBlocked) return frwu_scopeBlocked;
	        const frwu_projectRoot = resolveProjectRootForSourceAccess();
	        const frwu_webUiRoot = path.join(frwu_projectRoot, 'web-ui');
        const frwu_absPath = path.resolve(frwu_webUiRoot, frwu_rel);
        if (!frwu_absPath.startsWith(frwu_webUiRoot)) {
          return { name, args, result: 'ERROR: find_replace_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(frwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${frwu_rel}`, frwu_webUiRoot, frwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const frwu_content = fs.readFileSync(frwu_absPath, 'utf-8');
        if (!frwu_content.includes(frwu_find)) {
          return { name, args, result: buildTextNotFoundRecovery(`web-ui/${frwu_rel}`, frwu_content, frwu_find, 'read_webui_source'), error: true };
        }
        const frwu_replaceAll = args.replace_all === true;
        const frwu_occurrences = frwu_replaceAll ? (frwu_content.split(frwu_find).length - 1) : 1;
        const frwu_updated = frwu_replaceAll
          ? frwu_content.split(frwu_find).join(frwu_replace)
          : frwu_content.replace(frwu_find, frwu_replace);
        const frwu_invalidEdit = rejectInvalidSourceEdit(name, args, frwu_absPath, frwu_updated);
        if (frwu_invalidEdit) return frwu_invalidEdit;
        fs.writeFileSync(frwu_absPath, frwu_updated, 'utf-8');
        const frwu_display = 'web-ui/' + frwu_absPath.slice(frwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] find_replace_webui_source: ${frwu_display} (session: ${frwu_sid})`);
        return { name, args, result: `OK ${frwu_display} updated (${frwu_occurrences} occurrence${frwu_occurrences !== 1 ? 's' : ''} replaced). ${getPostSourceEditInstructionForSession(sessionId, [frwu_display])}`, error: false };
      }

      // ── replace_lines_webui_source ────────────────────────────────────────────
	      case 'replace_lines_webui_source': {
	        const rlwu_sid = String(sessionId || '');
        const rlwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (rlwuSessionGate) return rlwuSessionGate;
	        const rlwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const rlwu_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const rlwu_end = Math.max(rlwu_start, Math.floor(Number(args.end_line) || rlwu_start));
	        const rlwu_newContent = String(args.new_content || '');
	        if (!rlwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const rlwu_projectRel = `web-ui/${rlwu_rel}`;
	        const rlwu_scopeBlocked = enforceProposalWriteAccess(rlwu_projectRel, 'file', name);
	        if (rlwu_scopeBlocked) return rlwu_scopeBlocked;
	        const rlwu_projectRoot = resolveProjectRootForSourceAccess();
	        const rlwu_webUiRoot = path.join(rlwu_projectRoot, 'web-ui');
        const rlwu_absPath = path.resolve(rlwu_webUiRoot, rlwu_rel);
        if (!rlwu_absPath.startsWith(rlwu_webUiRoot)) {
          return { name, args, result: 'ERROR: replace_lines_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(rlwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${rlwu_rel}`, rlwu_webUiRoot, rlwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const rlwu_lines = fs.readFileSync(rlwu_absPath, 'utf-8').split('\n');
        if (rlwu_start > rlwu_lines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(`web-ui/${rlwu_rel}`, rlwu_lines, rlwu_start, 'read_webui_source', 'start_line'), error: true };
        }
        const rlwu_endClamped = Math.min(rlwu_end, rlwu_lines.length);
        rlwu_lines.splice(rlwu_start - 1, rlwu_endClamped - rlwu_start + 1, ...rlwu_newContent.split('\n'));
        const rlwu_updated = rlwu_lines.join('\n');
        const rlwu_invalidEdit = rejectInvalidSourceEdit(name, args, rlwu_absPath, rlwu_updated);
        if (rlwu_invalidEdit) return rlwu_invalidEdit;
        fs.writeFileSync(rlwu_absPath, rlwu_updated, 'utf-8');
        const rlwu_display = 'web-ui/' + rlwu_absPath.slice(rlwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] replace_lines_webui_source: ${rlwu_display} lines ${rlwu_start}-${rlwu_endClamped} (session: ${rlwu_sid})`);
        return { name, args, result: `OK ${rlwu_display}: replaced lines ${rlwu_start}-${rlwu_endClamped} (now ${rlwu_lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [rlwu_display])}`, error: false };
      }

      // ── insert_after_webui_source ─────────────────────────────────────────────
	      case 'insert_after_webui_source': {
	        const iawu_sid = String(sessionId || '');
        const iawuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (iawuSessionGate) return iawuSessionGate;
	        const iawu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
	        const iawu_afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
	        const iawu_content = String(args.content || '');
	        if (!iawu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const iawu_projectRel = `web-ui/${iawu_rel}`;
	        const iawu_scopeBlocked = enforceProposalWriteAccess(iawu_projectRel, 'file', name);
	        if (iawu_scopeBlocked) return iawu_scopeBlocked;
	        const iawu_projectRoot = resolveProjectRootForSourceAccess();
	        const iawu_webUiRoot = path.join(iawu_projectRoot, 'web-ui');
        const iawu_absPath = path.resolve(iawu_webUiRoot, iawu_rel);
        if (!iawu_absPath.startsWith(iawu_webUiRoot)) {
          return { name, args, result: 'ERROR: insert_after_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(iawu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${iawu_rel}`, iawu_webUiRoot, iawu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const iawu_lines = fs.readFileSync(iawu_absPath, 'utf-8').split('\n');
        const iawu_insertAt = Math.min(iawu_afterLine, iawu_lines.length);
        iawu_lines.splice(iawu_insertAt, 0, ...iawu_content.split('\n'));
        const iawu_updated = iawu_lines.join('\n');
        const iawu_invalidEdit = rejectInvalidSourceEdit(name, args, iawu_absPath, iawu_updated);
        if (iawu_invalidEdit) return iawu_invalidEdit;
        fs.writeFileSync(iawu_absPath, iawu_updated, 'utf-8');
        const iawu_display = 'web-ui/' + iawu_absPath.slice(iawu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] insert_after_webui_source: ${iawu_display} after line ${iawu_afterLine} (session: ${iawu_sid})`);
        return { name, args, result: `OK ${iawu_display}: inserted after line ${iawu_afterLine} (now ${iawu_lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [iawu_display])}`, error: false };
      }

      // ── delete_lines_webui_source ─────────────────────────────────────────────
	      case 'delete_lines_webui_source': {
	        const dlwu_sid = String(sessionId || '');
        const dlwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (dlwuSessionGate) return dlwuSessionGate;
	        const dlwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
	        const dlwu_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
	        const dlwu_end = Math.max(dlwu_start, Math.floor(Number(args.end_line) || dlwu_start));
	        if (!dlwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const dlwu_projectRel = `web-ui/${dlwu_rel}`;
	        const dlwu_scopeBlocked = enforceProposalWriteAccess(dlwu_projectRel, 'file', name);
	        if (dlwu_scopeBlocked) return dlwu_scopeBlocked;
	        const dlwu_projectRoot = resolveProjectRootForSourceAccess();
	        const dlwu_webUiRoot = path.join(dlwu_projectRoot, 'web-ui');
        const dlwu_absPath = path.resolve(dlwu_webUiRoot, dlwu_rel);
        if (!dlwu_absPath.startsWith(dlwu_webUiRoot)) {
          return { name, args, result: 'ERROR: delete_lines_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!fs.existsSync(dlwu_absPath)) {
          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${dlwu_rel}`, dlwu_webUiRoot, dlwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
        }
        const dlwu_lines = fs.readFileSync(dlwu_absPath, 'utf-8').split('\n');
        if (dlwu_start > dlwu_lines.length) {
          return { name, args, result: buildLineOutOfRangeRecovery(`web-ui/${dlwu_rel}`, dlwu_lines, dlwu_start, 'read_webui_source', 'start_line'), error: true };
        }
        const dlwu_endClamped = Math.min(dlwu_end, dlwu_lines.length);
        dlwu_lines.splice(dlwu_start - 1, dlwu_endClamped - dlwu_start + 1);
        const dlwu_updated = dlwu_lines.join('\n');
        const dlwu_invalidEdit = rejectInvalidSourceEdit(name, args, dlwu_absPath, dlwu_updated);
        if (dlwu_invalidEdit) return dlwu_invalidEdit;
        fs.writeFileSync(dlwu_absPath, dlwu_updated, 'utf-8');
        const dlwu_display = 'web-ui/' + dlwu_absPath.slice(dlwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] delete_lines_webui_source: ${dlwu_display} lines ${dlwu_start}-${dlwu_endClamped} (session: ${dlwu_sid})`);
        return { name, args, result: `OK ${dlwu_display}: deleted lines ${dlwu_start}-${dlwu_endClamped} (now ${dlwu_lines.length} lines). ${getPostSourceEditInstructionForSession(sessionId, [dlwu_display])}`, error: false };
      }

      // ── write_webui_source: create or overwrite a file in web-ui/ ────────────
	      case 'write_webui_source': {
	        const wwu_sid = String(sessionId || '');
        const wwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (wwuSessionGate) return wwuSessionGate;
	        const wwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
	        const wwu_content = String(args.content || '');
	        const wwu_overwrite = args.overwrite !== false;
	        if (!wwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const wwu_projectRel = `web-ui/${wwu_rel}`;
	        const wwu_scopeBlocked = enforceProposalWriteAccess(wwu_projectRel, 'file', name);
	        if (wwu_scopeBlocked) return wwu_scopeBlocked;
	        const wwu_projectRoot = resolveProjectRootForSourceAccess();
	        const wwu_webUiRoot = path.join(wwu_projectRoot, 'web-ui');
        const wwu_absPath = path.resolve(wwu_webUiRoot, wwu_rel);
        if (!wwu_absPath.startsWith(wwu_webUiRoot)) {
          return { name, args, result: 'ERROR: write_webui_source only allows access to web-ui/ directory.', error: true };
        }
        if (!wwu_overwrite && fs.existsSync(wwu_absPath)) {
          return { name, args, result: `File already exists: web-ui/${wwu_rel}. Set overwrite:true to replace it.`, error: true };
        }
        const wwu_invalidEdit = rejectInvalidSourceEdit(name, args, wwu_absPath, wwu_content);
        if (wwu_invalidEdit) return wwu_invalidEdit;
        fs.mkdirSync(path.dirname(wwu_absPath), { recursive: true });
        fs.writeFileSync(wwu_absPath, wwu_content, 'utf-8');
        const wwu_display = 'web-ui/' + wwu_absPath.slice(wwu_webUiRoot.length + 1).replace(/\\/g, '/');
        const wwu_lineCount = wwu_content.split('\n').length;
        console.log(`[edit_webui] write_webui_source: ${wwu_display} (${wwu_lineCount} lines, session: ${wwu_sid})`);
        return { name, args, result: `OK ${wwu_display} written (${wwu_lineCount} lines). ${getPostSourceEditInstructionForSession(sessionId, [wwu_display])}`, error: false };
      }

      // ── send_telegram: proactively push text or screenshot to Telegram ────────
      // Works from ANY session (web UI, cron, background task) — not just Telegram-originated ones.
	      case 'delete_webui_source': {
	        const dwu_sid = String(sessionId || '');
        const dwuSessionGate = ensureDevSrcSelfEditWriteSession(name, 'web-ui');
        if (dwuSessionGate) return dwuSessionGate;
	        const dwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
	        if (!dwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
	        const dwu_projectRel = `web-ui/${dwu_rel}`;
	        const dwu_scopeBlocked = enforceProposalWriteAccess(dwu_projectRel, 'file', name);
	        if (dwu_scopeBlocked) return dwu_scopeBlocked;
	        const dwu_projectRoot = resolveProjectRootForSourceAccess();
	        const dwu_webUiRoot = path.join(dwu_projectRoot, 'web-ui');
	        const dwu_absPath = path.resolve(dwu_webUiRoot, dwu_rel);
	        if (!dwu_absPath.startsWith(dwu_webUiRoot)) {
	          return { name, args, result: 'ERROR: delete_webui_source only allows access to web-ui/ directory.', error: true };
	        }
	        if (!fs.existsSync(dwu_absPath)) {
	          return { name, args, result: buildPathNotFoundRecovery(`web-ui/${dwu_rel}`, dwu_webUiRoot, dwu_rel, 'list_webui_source', { displayPrefix: 'web-ui/' }), error: true };
	        }
	        const dwu_stat = fs.statSync(dwu_absPath);
	        if (!dwu_stat.isFile()) return { name, args, result: `"web-ui/${dwu_rel}" is not a file`, error: true };
	        fs.unlinkSync(dwu_absPath);
	        const dwu_display = 'web-ui/' + dwu_absPath.slice(dwu_webUiRoot.length + 1).replace(/\\/g, '/');
	        console.log(`[edit_webui] delete_webui_source: ${dwu_display} (session: ${dwu_sid})`);
	        return { name, args, result: `OK ${dwu_display} deleted. ${getPostSourceEditInstructionForSession(sessionId, [dwu_display])}`, error: false };
	      }

      case 'delivery_send': {
        const msgText = String(args.text || args.message || '').trim();
        if (msgText && containsObsoleteProductBrand(msgText)) {
          return { name, args, result: `ERROR: ${buildObsoleteBrandBlockMessage('delivery payload')}`, error: true };
        }
        try {
          let imageBuffer: Buffer | undefined;
          let attachmentPath: string | undefined;
          let mimeType = args.mimeType ? String(args.mimeType) : undefined;
          let fileName: string | undefined;
          if (args.imageBase64) {
            imageBuffer = Buffer.from(String(args.imageBase64), 'base64');
            mimeType = mimeType || 'image/png';
          }
          if (args.attachmentPath) {
            const file = readAttachmentBuffer(String(args.attachmentPath), workspacePath);
            attachmentPath = file.absPath;
            fileName = file.fileName;
            mimeType = mimeType || file.mimeType;
            if (file.mimeType.startsWith('image/') && !imageBuffer) imageBuffer = file.buffer;
          }
          if (!msgText && !imageBuffer && !attachmentPath) return { name, args, result: 'ERROR: text, imageBase64, or attachmentPath is required.', error: true };
          const delivered = await deliverToTargets({
            sessionId,
            target: args.target || 'origin',
            text: msgText,
            caption: String(args.caption || msgText || '').trim(),
            attachmentPath,
            imageBuffer,
            mimeType,
            fileName,
            source: 'delivery_send',
          }, { telegramChannel: deps.telegramChannel, broadcastWS: deps.broadcastWS });
          const suffix = delivered.errors.length ? ` Errors: ${delivered.errors.join('; ')}` : '';
          return {
            name,
            args,
            result: delivered.delivered.length ? `Delivered via ${delivered.delivered.join(', ')}.${suffix}` : `ERROR: Delivery failed.${suffix}`,
            error: delivered.delivered.length === 0,
          };
        } catch (err: any) {
          return { name, args, result: `ERROR: Delivery failed: ${err?.message || err}`, error: true };
        }
      }

      case 'delivery_send_screenshot': {
        const delivered = await executeDeliverySendScreenshot(args, workspacePath, deps, sessionId);
        return { name, args, result: delivered.result, error: delivered.error };
      }

	      case 'send_telegram': {
        if (!deps.telegramChannel) {
          return { name, args, result: 'ERROR: Telegram channel not configured.', error: true };
        }
        // ── Bridge: link this session to the Telegram user so replies route back here ──
        try {
          const allowedIds: number[] = (deps.telegramChannel as any).getAllowedUserIds?.() || [];
          for (const uid of allowedIds) {
            linkTelegramSession(uid, sessionId);
          }
        } catch {}
        const msgText = String(args.text || args.message || '').trim();
        const sendPhoto = args.screenshot === true;
        if (msgText && containsObsoleteProductBrand(msgText)) {
          return { name, args, result: `ERROR: ${buildObsoleteBrandBlockMessage('Telegram payload')}`, error: true };
        }
        try {
          if (sendPhoto) {
            // Grab latest desktop screenshot from session
            const { getDesktopAdvisorPacket } = require('../desktop-tools');
            const packet = getDesktopAdvisorPacket(sessionId);
            if (!packet?.screenshotBase64) {
              return { name, args, result: 'ERROR: No screenshot available. Call desktop_screenshot first, then send_telegram with screenshot:true.', error: true };
            }
            const caption = msgText || 'Screenshot from Prometheus';
            // Take a fresh screenshot before sending so user sees current state
            try { await (require('../desktop-tools') as any).desktopScreenshot(sessionId); } catch {}
            const freshPacket = (require('../desktop-tools') as any).getDesktopAdvisorPacket(sessionId) || packet;
            await deps.telegramChannel.sendPhotoToAllowed(
              Buffer.from(freshPacket.screenshotBase64, 'base64'),
              caption,
            );
            return { name, args, result: `Screenshot sent to Telegram with caption: "${caption.slice(0, 80)}".`, error: false };
          } else {
            if (!msgText) return { name, args, result: 'ERROR: text or message is required.', error: true };
            await deps.telegramChannel.sendToAllowed(msgText);
            return { name, args, result: `Message sent to Telegram: "${msgText.slice(0, 80)}${msgText.length > 80 ? '...' : ''}".`, error: false };
          }
        } catch (err: any) {
          return { name, args, result: `ERROR: Telegram send failed: ${err?.message || err}`, error: true };
        }
      }

      case 'deploy_analysis_team': {
        const tr = await deployAnalysisTeamTool.execute(args) as any;
        const resultStr = tr?.stdout ?? tr?.error ?? JSON.stringify(tr?.data ?? tr);
        return {
          name,
          args,
          result: resultStr,
          error: tr?.success === false,
          data: tr?.data,
          artifacts: Array.isArray(tr?.artifacts) ? tr.artifacts : undefined,
        };
      }

      case 'present_file': {
        const filePath = String(args?.path || args?.filename || '').trim();
        if (!filePath) return { name, args, result: 'ERROR: path is required', error: true };
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
        if (!fs.existsSync(absPath)) return { name, args, result: `File not found: ${filePath}`, error: true };
        const relPath = path.isAbsolute(filePath) ? path.relative(workspacePath, absPath) : filePath;
        return { name, args, result: `File presented in canvas: ${relPath}`, error: false };
      }

      case 'enter_creative_mode': {
        const mode = normalizeCreativeMode(args?.mode);
        if (!mode) {
          return { name, args, result: 'enter_creative_mode: mode must be "design", "image", "canvas", or "video"', error: true };
        }
        const previousMode = getCreativeMode(sessionId);
        const creativeMode = setCreativeMode(sessionId, mode);
        deps.sendSSE?.('creative_mode', { sessionId, creativeMode, previousMode, resetScene: true });
        deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode, previousMode, resetScene: true });
        return { name, args, result: `Creative workspace "${creativeMode}" opened with a blank canvas.`, error: false, data: { creativeMode, previousMode, resetScene: true } };
      }

      case 'switch_creative_mode': {
        const hasMode = !!args && typeof args === 'object' && Object.prototype.hasOwnProperty.call(args, 'mode');
        const rawMode = hasMode ? args?.mode : undefined;
        const rawModeText = String(rawMode ?? '').trim().toLowerCase();
        const shouldExit = hasMode && (
          rawMode == null
          || rawModeText === 'null'
          || rawModeText === 'none'
          || rawModeText === 'off'
          || rawModeText === 'normal'
          || rawModeText === 'default'
          || rawModeText === 'chat'
        );
        const previousMode = getCreativeMode(sessionId);
        if (shouldExit) {
          setCreativeMode(sessionId, null);
          deps.sendSSE?.('creative_mode', { sessionId, creativeMode: null, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '' });
          deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode: null, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '' });
          return {
            name,
            args,
            result: previousMode ? `Creative workspace "${previousMode}" cleared.` : 'No Creative workspace was selected for this session.',
            error: false,
            data: { creativeMode: null, previousMode },
          };
        }
        const mode = normalizeCreativeMode(rawMode);
        if (!mode) {
          return { name, args, result: 'switch_creative_mode: mode must be "design", "image", "canvas", "video", or null to exit', error: true };
        }
        const creativeMode = setCreativeMode(sessionId, mode);
        deps.sendSSE?.('creative_mode', { sessionId, creativeMode, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '', resetScene: true });
        deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '', resetScene: true });
        return { name, args, result: `Creative workspace changed from "${previousMode || 'none'}" to "${creativeMode}" with a blank canvas.`, error: false, data: { creativeMode, previousMode, resetScene: true } };
      }

      case 'get_creative_mode': {
        const creativeMode = getCreativeMode(sessionId);
        return {
          name,
          args,
          result: creativeMode ? `Selected Creative workspace: ${creativeMode}` : 'No Creative workspace is selected.',
          error: false,
          data: { creativeMode },
        };
      }

      case 'creative_list_references': {
        const references = getCreativeReferences(sessionId);
        const promptBlock = formatCreativeReferencesForPrompt(sessionId, Number(args?.limit) || 20);
        return {
          name,
          args,
          result: references.length > 0
            ? promptBlock
            : 'No Creative References are saved for this session yet. Use web_fetch on media/reference URLs first, or import assets manually.',
          error: false,
          data: { references },
        };
      }

      case 'exit_creative_mode': {
        const previousMode = getCreativeMode(sessionId);
        setCreativeMode(sessionId, null);
        deps.sendSSE?.('creative_mode', { sessionId, creativeMode: null });
        deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode: null });
        return {
          name,
          args,
          result: previousMode ? `Creative workspace "${previousMode}" cleared.` : 'No Creative workspace was selected for this session.',
          error: false,
          data: { creativeMode: null, previousMode },
        };
      }

      case 'creative_list_motion_templates': {
        const catalog = getCreativeMotionRuntime().getCreativeMotionCatalog();
        return {
          name,
          args,
          result: `Found ${catalog.templates.length} Creative Motion templates and ${catalog.socialPresets.length} social presets.`,
          error: false,
          data: catalog,
        };
      }

      case 'creative_preview_motion_template':
      case 'creative_generate_motion_variants': {
        const catalog = getCreativeMotionRuntime().getCreativeMotionCatalog();
        if (name === 'creative_generate_motion_variants') {
          const templateId = String(args?.templateId || 'caption-reel').trim().toLowerCase();
          const template = catalog.templates.find((candidate: any) => candidate.id === templateId) || catalog.templates[0];
          const count = Math.max(1, Math.min(8, Number(args?.count) || Math.min(3, template?.presets?.length || 3)));
          const variants = (template?.presets || []).slice(0, count).map((preset: any, index: number) => {
            const prepared = getCreativeMotionRuntime().prepareCreativeMotionTemplate({
              ...(args || {}),
              templateId: template.id,
              presetId: preset.id,
              style: {
                ...(preset.style || {}),
                ...(args?.style && typeof args.style === 'object' ? args.style : {}),
              },
            });
            return {
              id: `variant_${index + 1}_${preset.id}`,
              preset,
              input: prepared.input,
              instance: prepared.instance,
              validation: prepared.validation,
            };
          });
          return {
            name,
            args,
            result: `Generated ${variants.length} motion template variants for ${template?.name || templateId}.`,
            error: false,
            data: { template, variants },
          };
        }
        const prepared = getCreativeMotionRuntime().prepareCreativeMotionTemplate(args || {});
        return {
          name,
          args,
          result: prepared.validation.ok
            ? `Prepared ${prepared.template?.name || prepared.input.templateId} motion template preview input.`
            : `Motion template preview has blockers: ${prepared.validation.blockers.join('; ')}`,
          error: !prepared.validation.ok,
          data: prepared,
        };
      }

      case 'creative_import_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const asset = await getCreativeAssets().importCreativeAsset(storage, {
          source: String(args?.source || '').trim(),
          filename: args?.filename ? String(args.filename) : undefined,
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          license: args?.license && typeof args.license === 'object' && !Array.isArray(args.license) ? args.license : null,
          copy: args?.copy !== false,
        });
        return {
          name,
          args,
          result: `Imported creative asset ${asset.name} (${asset.kind}${asset.width && asset.height ? `, ${asset.width}x${asset.height}` : ''}${asset.durationMs ? `, ${asset.durationMs}ms` : ''}).`,
          error: false,
          data: { asset, storageRoot: storage.rootAbsPath, storageRootRelative: storage.rootRelPath },
        };
      }

      case 'creative_attach_audio_from_url': {
        const url = String(args?.url || '').trim();
        if (!url) {
          return { name, args, result: 'creative_attach_audio_from_url: url is required', error: true };
        }
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const downloadsDir = path.join(storage.creativeDir, 'source-audio');
        fs.mkdirSync(downloadsDir, { recursive: true });
        const downloadResult = await executeDownloadMedia({
          url,
          output_dir: buildCreativeWorkspaceRelativePath(storage.workspacePath, downloadsDir),
          audio_only: true,
        });
        if (downloadResult.success !== true) {
          return {
            name,
            args,
            result: `ERROR: ${downloadResult.error || 'Could not download audio from URL.'}`,
            error: true,
            data: { download: downloadResult.data || null },
          };
        }
        const downloaded = firstDownloadedMediaFile(downloadResult);
        const downloadedPath = String(downloaded?.path || downloaded?.rel_path || '').trim();
        if (!downloadedPath) {
          return {
            name,
            args,
            result: 'ERROR: Audio download completed, but no output file was detected.',
            error: true,
            data: { download: downloadResult.data || null },
          };
        }
        const asset = await getCreativeAssets().importCreativeAsset(storage, {
          source: downloadedPath,
          tags: normalizeCreativeAudioTags(args?.tags),
          copy: true,
        });
        if (asset.kind !== 'audio') {
          return {
            name,
            args,
            result: `ERROR: Downloaded media was imported as ${asset.kind}, not audio.`,
            error: true,
            data: { asset, download: downloadResult.data || null },
          };
        }
        const audioSource = asset.path || asset.relativePath || asset.absPath || asset.source;
        const audioTrack = {
          source: audioSource,
          label: String(args?.label || asset.name || 'Background audio').trim() || 'Background audio',
          startMs: Math.max(0, Number(args?.startMs) || 0),
          durationMs: Math.max(0, Number(args?.durationMs) || Number(asset.durationMs) || 0),
          trimStartMs: Math.max(0, Number(args?.trimStartMs) || 0),
          trimEndMs: Math.max(0, Number(args?.trimEndMs) || 0),
          volume: Math.max(0, Math.min(1, Number.isFinite(Number(args?.volume)) ? Number(args.volume) : 1)),
          muted: false,
          fadeInMs: Math.max(0, Number(args?.fadeInMs) || 0),
          fadeOutMs: Math.max(0, Number(args?.fadeOutMs) || 0),
        };
        const placement = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: 'video',
          command: 'attach_audio',
          payload: { audioTrack, sourceUrl: url, asset },
          timeoutMs: resolveCreativeEditorTimeoutMs(name),
        });
        return {
          name,
          args,
          result: placement.success
            ? `Attached downloaded audio "${audioTrack.label}" to the Video timeline${asset.durationMs ? ` (${asset.durationMs}ms)` : ''}.`
            : `Downloaded and imported audio, but the creative editor did not attach it: ${placement.error || 'unknown editor error'}`,
          error: !placement.success,
          data: {
            url,
            asset,
            audioTrack,
            download: downloadResult.data || null,
            placement,
            storageRoot: storage.rootAbsPath,
            storageRootRelative: storage.rootRelPath,
          },
        };
      }

      case 'creative_attach_audio_from_file': {
        const source = String(args?.source || '').trim();
        if (!source) {
          return { name, args, result: 'creative_attach_audio_from_file: source is required', error: true };
        }
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let sourceAbsPath = '';
        try {
          sourceAbsPath = ensureCreativeLocalWorkspacePath(storage.workspacePath, source);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${String(err?.message || err)}`, error: true };
        }
        const sourceKind = inferCreativeLocalMediaKind(sourceAbsPath);
        let audioInputPath = sourceAbsPath;
        let extractedFromVideo = false;
        if (sourceKind !== 'audio') {
          try {
            audioInputPath = await extractCreativeAudioFromVideo(sourceAbsPath, path.join(storage.creativeDir, 'extracted-audio'));
            extractedFromVideo = true;
          } catch (err: any) {
            return {
              name,
              args,
              result: `ERROR: Could not extract audio from ${path.basename(sourceAbsPath)} (${String(err?.message || err)}).`,
              error: true,
            };
          }
        }
        const asset = await getCreativeAssets().importCreativeAsset(storage, {
          source: audioInputPath,
          tags: normalizeCreativeAudioTags([...(Array.isArray(args?.tags) ? args.tags : String(args?.tags || '').split(',')), extractedFromVideo ? 'extracted-audio' : 'source-audio']),
          copy: true,
        });
        if (asset.kind !== 'audio') {
          return {
            name,
            args,
            result: `ERROR: Imported source was classified as ${asset.kind}, not audio.`,
            error: true,
            data: { asset },
          };
        }
        const audioSource = asset.path || asset.relativePath || asset.absPath || asset.source;
        const audioTrack = {
          source: audioSource,
          label: String(args?.label || asset.name || (extractedFromVideo ? 'Extracted audio' : 'Audio')).trim() || 'Audio',
          startMs: Math.max(0, Number(args?.startMs) || 0),
          durationMs: Math.max(0, Number(args?.durationMs) || Number(asset.durationMs) || 0),
          trimStartMs: Math.max(0, Number(args?.trimStartMs) || 0),
          trimEndMs: Math.max(0, Number(args?.trimEndMs) || 0),
          volume: Math.max(0, Math.min(1, Number.isFinite(Number(args?.volume)) ? Number(args.volume) : 1)),
          muted: false,
          fadeInMs: Math.max(0, Number(args?.fadeInMs) || 0),
          fadeOutMs: Math.max(0, Number(args?.fadeOutMs) || 0),
        };
        const placement = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: 'video',
          command: 'attach_audio',
          payload: { audioTrack, sourceFile: buildCreativeWorkspaceRelativePath(storage.workspacePath, sourceAbsPath), extractedFromVideo, asset },
          timeoutMs: resolveCreativeEditorTimeoutMs(name),
        });
        return {
          name,
          args,
          result: placement.success
            ? `Attached ${extractedFromVideo ? 'extracted ' : ''}audio "${audioTrack.label}" to the Video timeline${asset.durationMs ? ` (${asset.durationMs}ms)` : ''}.`
            : `Imported audio, but the creative editor did not attach it: ${placement.error || 'unknown editor error'}`,
          error: !placement.success,
          data: {
            source,
            extractedFromVideo,
            extractedAudioPath: extractedFromVideo ? buildCreativeWorkspaceRelativePath(storage.workspacePath, audioInputPath) : null,
            asset,
            audioTrack,
            placement,
            storageRoot: storage.rootAbsPath,
            storageRootRelative: storage.rootRelPath,
          },
        };
      }

      case 'creative_analyze_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const asset = await getCreativeAssets().analyzeCreativeAsset(storage, {
          source: String(args?.source || '').trim(),
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          license: args?.license && typeof args.license === 'object' && !Array.isArray(args.license) ? args.license : null,
          force: args?.force === true,
          upsert: args?.upsert !== false,
        });
        return {
          name,
          args,
          result: `Analyzed creative asset ${asset.name} (${asset.kind}${asset.width && asset.height ? `, ${asset.width}x${asset.height}` : ''}${asset.durationMs ? `, ${asset.durationMs}ms` : ''}).`,
          error: false,
          data: { asset, storageRoot: storage.rootAbsPath, storageRootRelative: storage.rootRelPath },
        };
      }

      case 'creative_search_assets': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const assets = getCreativeAssets().searchCreativeAssets(storage, {
          query: String(args?.query || '').trim(),
          kinds: Array.isArray(args?.kinds) ? args.kinds : [],
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          limit: Math.max(1, Math.min(200, Number(args?.limit) || 50)),
        });
        const index = getCreativeAssets().readCreativeAssetIndex(storage);
        return {
          name,
          args,
          result: assets.length
            ? `Found ${assets.length} creative assets (${index.assets.length} indexed total).`
            : `No creative assets matched. ${index.assets.length} assets are indexed.`,
          error: false,
          data: { assets, total: index.assets.length, storageRoot: storage.rootAbsPath, storageRootRelative: storage.rootRelPath },
        };
      }

      case 'creative_generate_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const asset = await getCreativeAssets().generateCreativeAssetPlaceholder(storage, {
          prompt: String(args?.prompt || '').trim(),
          width: Number(args?.width) || undefined,
          height: Number(args?.height) || undefined,
          kind: args?.kind === 'image' ? 'image' : 'svg',
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
        });
        return {
          name,
          args,
          result: `Generated creative asset ${asset.name} (${asset.width}x${asset.height}) and added it to the asset index.`,
          error: false,
          data: { asset, storageRoot: storage.rootAbsPath, storageRootRelative: storage.rootRelPath },
        };
      }

      case 'creative_create_project': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const created = creativeCreateProject(storage, {
            title: args?.title ? String(args.title) : undefined,
            brief: args?.brief ? String(args.brief) : undefined,
            targetFormat: args?.targetFormat || args?.target_format ? String(args.targetFormat || args.target_format) : undefined,
            targetDurationSec: Number.isFinite(Number(args?.targetDurationSec ?? args?.target_duration_sec)) ? Number(args?.targetDurationSec ?? args?.target_duration_sec) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            storyboardId: args?.storyboardId || args?.storyboard_id ? String(args.storyboardId || args.storyboard_id) : undefined,
            storyboardPath: args?.storyboardPath || args?.storyboard_path ? String(args.storyboardPath || args.storyboard_path) : undefined,
            storyboard: args?.storyboard && typeof args.storyboard === 'object' ? args.storyboard : undefined,
            sourceAssets: Array.isArray(args?.sourceAssets || args?.source_assets)
              ? (args.sourceAssets || args.source_assets).map((item: any) => String(item)).filter(Boolean)
              : (args?.sourceAssets || args?.source_assets ? String(args.sourceAssets || args.source_assets) : undefined),
            notes: args?.notes && typeof args.notes === 'object' ? args.notes : {},
          });
          return {
            name,
            args,
            result: `Created Creative project ${created.project.id} at ${created.path}${created.storyboard ? ` with storyboard ${created.storyboard.id}` : ''}.`,
            error: false,
            data: created,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_project_history': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const projectId = args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : '';
          if (projectId || args?.path) {
            const project = creativeGetProject(storage, { projectId, path: args?.path ? String(args.path) : undefined });
            return {
              name,
              args,
              result: `Loaded Creative project ${project.id}: ${project.title}.\n${JSON.stringify(project).slice(0, 10000)}`,
              error: false,
              data: { project },
            };
          }
          const projects = creativeListProjects(storage, { limit: Number.isFinite(Number(args?.limit)) ? Number(args.limit) : undefined });
          return {
            name,
            args,
            result: `${name}: ${projects.length} project record${projects.length === 1 ? '' : 's'}.\n${JSON.stringify({ projects }).slice(0, 8000)}`,
            error: false,
            data: { projects },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_create_storyboard': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const created = creativeCreateStoryboard(storage, {
            title: args?.title ? String(args.title) : undefined,
            brief: args?.brief ? String(args.brief) : undefined,
            styleGuide: args?.styleGuide || args?.style_guide ? String(args.styleGuide || args.style_guide) : undefined,
            characterBible: args?.characterBible || args?.character_bible ? String(args.characterBible || args.character_bible) : undefined,
            shots: Array.isArray(args?.shots) ? args.shots : [],
            metadata: args?.metadata && typeof args.metadata === 'object' ? args.metadata : {},
          });
          return {
            name,
            args,
            result: `Created storyboard ${created.storyboard.id} with ${created.storyboard.shots.length} shot${created.storyboard.shots.length === 1 ? '' : 's'} at ${created.path}.`,
            error: false,
            data: created,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_storyboard_history': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const storyboardId = args?.storyboardId || args?.storyboard_id ? String(args.storyboardId || args.storyboard_id) : '';
          if (storyboardId || args?.path) {
            const storyboard = creativeGetStoryboard(storage, { storyboardId, path: args?.path ? String(args.path) : undefined });
            return {
              name,
              args,
              result: `Loaded storyboard ${storyboard.id} with ${storyboard.shots.length} shot${storyboard.shots.length === 1 ? '' : 's'}.\n${JSON.stringify(storyboard).slice(0, 9000)}`,
              error: false,
              data: { storyboard },
            };
          }
          const storyboards = creativeListStoryboards(storage, { limit: Number.isFinite(Number(args?.limit)) ? Number(args.limit) : undefined });
          return {
            name,
            args,
            result: `${name}: ${storyboards.length} storyboard record${storyboards.length === 1 ? '' : 's'}.\n${JSON.stringify({ storyboards }).slice(0, 7000)}`,
            error: false,
            data: { storyboards },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_write_shot_prompt': {
        try {
          const prompt = creativeWriteShotPrompt({
            subject: args?.subject ? String(args.subject) : undefined,
            action: args?.action ? String(args.action) : undefined,
            setting: args?.setting ? String(args.setting) : undefined,
            camera: args?.camera ? String(args.camera) : undefined,
            lighting: args?.lighting ? String(args.lighting) : undefined,
            style: args?.style ? String(args.style) : undefined,
            continuity: args?.continuity ? String(args.continuity) : undefined,
            endingFrameGoal: args?.endingFrameGoal || args?.ending_frame_goal ? String(args.endingFrameGoal || args.ending_frame_goal) : undefined,
            negatives: Array.isArray(args?.negatives) ? args.negatives : (args?.negatives ? String(args.negatives) : undefined),
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
          });
          return {
            name,
            args,
            result: `Wrote shot prompt.\n${JSON.stringify(prompt, null, 2)}`,
            error: false,
            data: prompt,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_render_ascii_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const render = await getCreativeAsciiRenderRuntime().renderCreativeAsciiAsset(storage, {
          source: args?.source ? String(args.source).trim() : undefined,
          mode: args?.mode,
          width: Number(args?.width) || undefined,
          height: Number(args?.height) || undefined,
          durationMs: Number(args?.durationMs) || undefined,
          frameRate: Number(args?.frameRate) || undefined,
          quality: args?.quality,
          glyphSet: args?.glyphSet ? String(args.glyphSet) : undefined,
          palette: Array.isArray(args?.palette) ? args.palette : (args?.palette ? String(args.palette) : undefined),
          style: args?.style ? String(args.style) : undefined,
          motion: args?.motion ? String(args.motion) : undefined,
          fit: args?.fit ? String(args.fit) : undefined,
          background: args?.background ? String(args.background) : undefined,
          glitch: Number.isFinite(Number(args?.glitch)) ? Number(args.glitch) : undefined,
          glow: Number.isFinite(Number(args?.glow)) ? Number(args.glow) : undefined,
          seed: Number.isFinite(Number(args?.seed)) ? Number(args.seed) : undefined,
          filename: args?.filename ? String(args.filename) : undefined,
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          license: args?.license && typeof args.license === 'object' && !Array.isArray(args.license) ? args.license : null,
          importToCreative: args?.importToCreative !== false,
          keepFrames: args?.keepFrames === true,
          timeoutMs: Number(args?.timeoutMs) || undefined,
        });
        let placement: any = null;
        const placeInScene = args?.placeInScene === true;
        const creativeMode = getCreativeMode(sessionId);
        const sourceForPlacement = render.asset?.path || render.asset?.absPath || render.outputWorkspacePath || render.outputPath;
        if (placeInScene && sourceForPlacement && creativeMode && creativeMode !== 'design') {
          placement = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'add_asset',
            payload: {
              source: sourceForPlacement,
              assetType: 'video',
              x: Number(args?.x) || 0,
              y: Number(args?.y) || 0,
              width: Number(args?.layerWidth) || Number(args?.width) || render.asset?.width || undefined,
              height: Number(args?.layerHeight) || Number(args?.height) || render.asset?.height || undefined,
              fit: args?.layerFit || args?.fit || 'cover',
              startMs: Number(args?.startMs) || 0,
              durationMs: Number(args?.layerDurationMs) || Number(args?.durationMs) || render.asset?.durationMs || undefined,
              muted: args?.muted !== false,
              meta: {
                sourceTool: 'creative_render_ascii_asset',
                assetId: render.asset?.id || null,
                asciiJobId: render.job.id,
              },
            },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
          });
        }
        return {
          name,
          args,
          result: `Rendered Python ASCII asset${render.asset ? ` ${render.asset.name}` : ''} (${render.renderer.width}x${render.renderer.height}, ${render.renderer.durationMs}ms, ${render.renderer.frameRate}fps)${placement ? '; placement attempted in the active Creative workspace.' : '.'}`,
          error: false,
          data: {
            ...render,
            placement,
            storageRoot: storage.rootAbsPath,
            storageRootRelative: storage.rootRelPath,
          },
        };
      }

      case 'creative_extract_video_frame': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const extracted = await creativeExtractVideoFrame(storage, {
            source: String(args?.source || args?.video || '').trim(),
            frame: args?.frame,
            timestamp: Number.isFinite(Number(args?.timestamp)) ? Number(args.timestamp) : undefined,
            timestampMs: Number.isFinite(Number(args?.timestampMs ?? args?.timestamp_ms)) ? Number(args?.timestampMs ?? args?.timestamp_ms) : undefined,
            percent: Number.isFinite(Number(args?.percent)) ? Number(args.percent) : undefined,
            outputName: args?.outputName || args?.output_name ? String(args.outputName || args.output_name) : undefined,
            registerAsAsset: args?.registerAsAsset !== false && args?.register_as_asset !== false,
            tags: args?.tags,
          });
          return {
            name,
            args,
            result: `Extracted video frame to ${extracted.frame.path}${extracted.asset ? ` and imported asset ${extracted.asset.id}.` : '.'}\n${JSON.stringify({
              frame: extracted.frame,
              asset: extracted.asset,
              durationMs: extracted.durationMs,
            }).slice(0, 5000)}`,
            error: false,
            data: extracted,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_extract_video_frames': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const extracted = await creativeExtractVideoFrames(storage, {
            source: String(args?.source || args?.video || '').trim(),
            frames: Array.isArray(args?.frames) ? args.frames : undefined,
            timestamps: Array.isArray(args?.timestamps) ? args.timestamps.map((item: any) => Number(item)).filter(Number.isFinite) : undefined,
            percents: Array.isArray(args?.percents) ? args.percents.map((item: any) => Number(item)).filter(Number.isFinite) : undefined,
            count: Number.isFinite(Number(args?.count)) ? Number(args.count) : undefined,
            rangeStartPercent: Number.isFinite(Number(args?.rangeStartPercent ?? args?.range_start_percent)) ? Number(args?.rangeStartPercent ?? args?.range_start_percent) : undefined,
            rangeEndPercent: Number.isFinite(Number(args?.rangeEndPercent ?? args?.range_end_percent)) ? Number(args?.rangeEndPercent ?? args?.range_end_percent) : undefined,
            outputNamePrefix: args?.outputNamePrefix || args?.output_name_prefix ? String(args.outputNamePrefix || args.output_name_prefix) : undefined,
            registerAsAssets: args?.registerAsAssets !== false && args?.register_as_assets !== false,
            contactSheet: args?.contactSheet !== false && args?.contact_sheet !== false,
            tags: args?.tags,
          });
          return {
            name,
            args,
            result: `Extracted ${extracted.frames.length} video frame${extracted.frames.length === 1 ? '' : 's'}${extracted.contactSheet ? ` with contact sheet ${extracted.contactSheet.path}` : ''}.\n${JSON.stringify({
              frames: extracted.frames,
              assetCount: extracted.assets.length,
              contactSheet: extracted.contactSheet,
              durationMs: extracted.durationMs,
            }).slice(0, 7000)}`,
            error: false,
            data: extracted,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_register_generation': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const registered = await creativeRegisterGeneration(storage, {
            kind: args?.kind,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : null,
            attempt: Number.isFinite(Number(args?.attempt)) ? Number(args.attempt) : undefined,
            prompt: args?.prompt ? String(args.prompt) : null,
            provider: args?.provider ? String(args.provider) : null,
            model: args?.model ? String(args.model) : null,
            mode: args?.mode ? String(args.mode) : null,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : null,
            parentAssetId: args?.parentAssetId || args?.parent_asset_id ? String(args.parentAssetId || args.parent_asset_id) : null,
            sourceImage: args?.sourceImage || args?.source_image ? String(args.sourceImage || args.source_image) : null,
            sourceVideo: args?.sourceVideo || args?.source_video ? String(args.sourceVideo || args.source_video) : null,
            referenceImages: Array.isArray(args?.referenceImages || args?.reference_images)
              ? (args.referenceImages || args.reference_images).map((item: any) => String(item)).filter(Boolean)
              : [],
            outputPath: args?.outputPath || args?.output_path ? String(args.outputPath || args.output_path) : null,
            metadata: args?.metadata && typeof args.metadata === 'object' ? args.metadata : {},
            tags: args?.tags,
          });
          return {
            name,
            args,
            result: `Registered generation ${registered.generation.id}${registered.asset ? ` for asset ${registered.asset.id}` : ''}.\n${JSON.stringify(registered).slice(0, 5000)}`,
            error: false,
            data: registered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generation_history': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const generations = creativeListGenerations(storage, {
          shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
          limit: Number.isFinite(Number(args?.limit)) ? Number(args.limit) : undefined,
        });
        return {
          name,
          args,
          result: `${name}: ${generations.length} generation record${generations.length === 1 ? '' : 's'}.\n${JSON.stringify({ generations }).slice(0, 8000)}`,
          error: false,
          data: { generations },
        };
      }

      case 'creative_generate_image_shot': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateImageShot(storage, {
            prompt: String(args?.prompt || ''),
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            styleGuide: args?.styleGuide || args?.style_guide ? String(args.styleGuide || args.style_guide) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            referenceImages: Array.isArray(args?.referenceImages || args?.reference_images)
              ? (args.referenceImages || args.reference_images).map((item: any) => String(item))
              : (args?.referenceImages || args?.reference_images ? String(args.referenceImages || args.reference_images) : undefined),
            characterReferences: Array.isArray(args?.characterReferences || args?.character_references)
              ? (args.characterReferences || args.character_references).map((item: any) => String(item))
              : (args?.characterReferences || args?.character_references ? String(args.characterReferences || args.character_references) : undefined),
            locationReferences: Array.isArray(args?.locationReferences || args?.location_references)
              ? (args.locationReferences || args.location_references).map((item: any) => String(item))
              : (args?.locationReferences || args?.location_references ? String(args.locationReferences || args.location_references) : undefined),
            negativePrompt: args?.negativePrompt || args?.negative_prompt ? String(args.negativePrompt || args.negative_prompt) : undefined,
            seed: args?.seed,
            continuityId: args?.continuityId || args?.continuity_id ? String(args.continuityId || args.continuity_id) : undefined,
            outputRole: args?.outputRole || args?.output_role,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            count: Number.isFinite(Number(args?.count)) ? Number(args.count) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            parentAssetId: args?.parentAssetId || args?.parent_asset_id ? String(args.parentAssetId || args.parent_asset_id) : undefined,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
          });
          if (generated.toolResult.success && args?.addToEditor !== false && args?.add_to_editor !== false) {
            const primaryAsset = generated.assets?.[0] || generated.primary?.asset || null;
            const source = primaryAsset?.path || primaryAsset?.relativePath || generated.primary?.path || generated.primary?.file || '';
            if (source) {
              await sendCreativeCommand(deps.broadcastWS, {
                sessionId,
                mode: 'video',
                command: 'add_asset',
                payload: {
                  source,
                  type: 'image',
                  assetType: 'image',
                  fit: 'cover',
                  meta: {
                    shotId: args?.shotId || args?.shot_id || null,
                    generationId: generated.generations?.[0]?.id || null,
                  },
                },
                timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
              }).catch(() => undefined);
            }
          }
          return {
            name,
            args,
            result: generated.toolResult.success
              ? `Generated ${generated.images.length} image shot${generated.images.length === 1 ? '' : 's'} and registered ${generated.generations.length} generation record${generated.generations.length === 1 ? '' : 's'}.\n${JSON.stringify({
                primary: generated.primary,
                assets: generated.assets,
                generations: generated.generations,
              }).slice(0, 9000)}`
              : `ERROR: ${generated.toolResult.error || 'image shot generation failed'}`,
            error: generated.toolResult.success !== true,
            data: generated,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generate_video_shot': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateVideoShot(storage, {
            prompt: String(args?.prompt || ''),
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            image: args?.image ? String(args.image) : undefined,
            referenceImages: Array.isArray(args?.referenceImages || args?.reference_images)
              ? (args.referenceImages || args.reference_images).map((item: any) => String(item))
              : (args?.referenceImages || args?.reference_images ? String(args.referenceImages || args.reference_images) : undefined),
            video: args?.video ? String(args.video) : undefined,
            mode: args?.mode ? String(args.mode) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            parentAssetId: args?.parentAssetId || args?.parent_asset_id ? String(args.parentAssetId || args.parent_asset_id) : undefined,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
            pollIntervalMs: Number.isFinite(Number(args?.pollIntervalMs ?? args?.poll_interval_ms)) ? Number(args?.pollIntervalMs ?? args?.poll_interval_ms) : undefined,
            timeoutMs: Number.isFinite(Number(args?.timeoutMs ?? args?.timeout_ms)) ? Number(args?.timeoutMs ?? args?.timeout_ms) : undefined,
          });
          if (generated.toolResult.success && args?.addToEditor !== false && args?.add_to_editor !== false) {
            const source = generated.asset?.path || generated.asset?.relativePath || generated.video?.path || generated.video?.file || '';
            if (source) {
              await sendCreativeCommand(deps.broadcastWS, {
                sessionId,
                mode: 'video',
                command: 'add_asset',
                payload: {
                  source,
                  type: 'video',
                  assetType: 'video',
                  fit: 'cover',
                  durationMs: Number(generated.asset?.durationMs || args?.duration || 0) || undefined,
                  meta: {
                    shotId: args?.shotId || args?.shot_id || null,
                    generationId: generated.generation?.id || null,
                  },
                },
                timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
              }).catch(() => undefined);
            }
          }
          return {
            name,
            args,
            result: generated.toolResult.success
              ? `Generated video shot${generated.generation ? ` ${generated.generation.id}` : ''}${generated.asset ? ` and imported asset ${generated.asset.id}` : ''}.\n${JSON.stringify({
                video: generated.video,
                asset: generated.asset,
                generation: generated.generation,
              }).slice(0, 7000)}`
              : `ERROR: ${generated.toolResult.error || 'video shot generation failed'}`,
            error: generated.toolResult.success !== true,
            data: generated,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_analyze_generated_video': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const analyzed = await creativeAnalyzeGeneratedVideo(storage, {
            source: String(args?.source || args?.video || '').trim(),
            intendedPrompt: args?.intendedPrompt || args?.intended_prompt ? String(args.intendedPrompt || args.intended_prompt) : undefined,
            continuityTarget: args?.continuityTarget || args?.continuity_target ? String(args.continuityTarget || args.continuity_target) : undefined,
            qaCriteria: Array.isArray(args?.qaCriteria || args?.qa_criteria)
              ? (args.qaCriteria || args.qa_criteria).map((item: any) => String(item)).filter(Boolean)
              : (args?.qaCriteria || args?.qa_criteria ? String(args.qaCriteria || args.qa_criteria) : undefined),
            frameCount: Number.isFinite(Number(args?.frameCount ?? args?.frame_count)) ? Number(args?.frameCount ?? args?.frame_count) : undefined,
            useVision: args?.useVision !== false && args?.use_vision !== false,
          });
          return {
            name,
            args,
            result: `Analyzed generated video ${analyzed.asset.name}: score ${analyzed.score}/100 (${analyzed.passed ? 'passed' : 'needs review'}).${analyzed.contactSheet ? ` Contact sheet: ${analyzed.contactSheet.path}` : ''}\n${JSON.stringify({
              score: analyzed.score,
              passed: analyzed.passed,
              warnings: analyzed.warnings,
              recommendations: analyzed.recommendations,
              contactSheet: analyzed.contactSheet,
              bestFrames: analyzed.frames.slice(0, 3),
            }).slice(0, 8000)}`,
            error: false,
            data: analyzed,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_compare_shots': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const compared = await creativeCompareShots(storage, {
            videos: Array.isArray(args?.videos)
              ? args.videos.map((item: any) => String(item)).filter(Boolean)
              : String(args?.videos || '').split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean),
            intendedPrompt: args?.intendedPrompt || args?.intended_prompt ? String(args.intendedPrompt || args.intended_prompt) : undefined,
            continuityTarget: args?.continuityTarget || args?.continuity_target ? String(args.continuityTarget || args.continuity_target) : undefined,
            qaCriteria: Array.isArray(args?.qaCriteria || args?.qa_criteria)
              ? (args.qaCriteria || args.qa_criteria).map((item: any) => String(item)).filter(Boolean)
              : (args?.qaCriteria || args?.qa_criteria ? String(args.qaCriteria || args.qa_criteria) : undefined),
            frameCount: Number.isFinite(Number(args?.frameCount ?? args?.frame_count)) ? Number(args?.frameCount ?? args?.frame_count) : undefined,
          });
          return {
            name,
            args,
            result: `Compared ${compared.analyses.length} shot takes. ${compared.recommendation}\n${JSON.stringify({
              winner: compared.winner ? { source: compared.winner.source, score: compared.winner.score, passed: compared.winner.passed } : null,
              analyses: compared.analyses.map((item) => ({ source: item.source, score: item.score, passed: item.passed, warnings: item.warnings })),
            }).slice(0, 9000)}`,
            error: false,
            data: compared,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_select_best_take': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const selected = await creativeSelectBestTake(storage, {
            shotId: String(args?.shotId || args?.shot_id || '').trim(),
            intendedPrompt: args?.intendedPrompt || args?.intended_prompt ? String(args.intendedPrompt || args.intended_prompt) : undefined,
            continuityTarget: args?.continuityTarget || args?.continuity_target ? String(args.continuityTarget || args.continuity_target) : undefined,
            qaCriteria: Array.isArray(args?.qaCriteria || args?.qa_criteria)
              ? (args.qaCriteria || args.qa_criteria).map((item: any) => String(item)).filter(Boolean)
              : (args?.qaCriteria || args?.qa_criteria ? String(args.qaCriteria || args.qa_criteria) : undefined),
            limit: Number.isFinite(Number(args?.limit)) ? Number(args.limit) : undefined,
            useVision: args?.useVision !== false && args?.use_vision !== false,
          });
          return {
            name,
            args,
            result: `${selected.recommendation}\n${JSON.stringify({
              selected: selected.selected ? { generation: selected.selected.generation, score: selected.selected.score, passed: selected.selected.passed, outputPath: selected.selected.source } : null,
              analyses: selected.analyses.map((item) => ({ generationId: item.generation?.id, score: item.score, passed: item.passed, outputPath: item.source, error: item.error || null })),
            }).slice(0, 10000)}`,
            error: false,
            data: selected,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_retry_shot_until_pass': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const retried = await creativeRetryShotUntilPass(storage, {
            prompt: String(args?.prompt || ''),
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            image: args?.image ? String(args.image) : undefined,
            referenceImages: Array.isArray(args?.referenceImages || args?.reference_images)
              ? (args.referenceImages || args.reference_images).map((item: any) => String(item))
              : (args?.referenceImages || args?.reference_images ? String(args.referenceImages || args.reference_images) : undefined),
            video: args?.video ? String(args.video) : undefined,
            mode: args?.mode ? String(args.mode) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            parentAssetId: args?.parentAssetId || args?.parent_asset_id ? String(args.parentAssetId || args.parent_asset_id) : undefined,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
            pollIntervalMs: Number.isFinite(Number(args?.pollIntervalMs ?? args?.poll_interval_ms)) ? Number(args?.pollIntervalMs ?? args?.poll_interval_ms) : undefined,
            timeoutMs: Number.isFinite(Number(args?.timeoutMs ?? args?.timeout_ms)) ? Number(args?.timeoutMs ?? args?.timeout_ms) : undefined,
            maxRetries: Number.isFinite(Number(args?.maxRetries ?? args?.max_retries)) ? Number(args?.maxRetries ?? args?.max_retries) : undefined,
            passScore: Number.isFinite(Number(args?.passScore ?? args?.pass_score)) ? Number(args?.passScore ?? args?.pass_score) : undefined,
            qaCriteria: Array.isArray(args?.qaCriteria || args?.qa_criteria)
              ? (args.qaCriteria || args.qa_criteria).map((item: any) => String(item)).filter(Boolean)
              : (args?.qaCriteria || args?.qa_criteria ? String(args.qaCriteria || args.qa_criteria) : undefined),
            continuityTarget: args?.continuityTarget || args?.continuity_target ? String(args.continuityTarget || args.continuity_target) : undefined,
          });
          return {
            name,
            args,
            result: `Retried video shot ${retried.attempts.length} time${retried.attempts.length === 1 ? '' : 's'}; ${retried.passed ? 'passed' : 'needs review'}. ${retried.recommendation}\n${JSON.stringify({
              selectedScore: retried.selected?.analysis?.score || null,
              selectedVideo: retried.selected?.generated?.video || null,
              attempts: retried.attempts.map((item) => ({ attempt: item.attempt, score: item.analysis?.score || null, passed: item.analysis?.passed || false, video: item.generated?.video })),
            }).slice(0, 9000)}`,
            error: retried.attempts.length === 0,
            data: retried,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_refine_video_shot': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const refined = await creativeRefineVideoShot(storage, {
            sourceVideo: String(args?.sourceVideo || args?.source_video || args?.video || '').trim(),
            issueMode: args?.issueMode || args?.issue_mode,
            issueDescription: args?.issueDescription || args?.issue_description ? String(args.issueDescription || args.issue_description) : undefined,
            desiredCorrection: args?.desiredCorrection || args?.desired_correction ? String(args.desiredCorrection || args.desired_correction) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            keyframe: args?.keyframe ? String(args.keyframe) : undefined,
            frameStrategy: args?.frameStrategy || args?.frame_strategy,
            timestamp: Number.isFinite(Number(args?.timestamp)) ? Number(args.timestamp) : undefined,
            percent: Number.isFinite(Number(args?.percent)) ? Number(args.percent) : undefined,
            preserveStyle: args?.preserveStyle !== false && args?.preserve_style !== false,
            preserveCharacter: args?.preserveCharacter !== false && args?.preserve_character !== false,
            preserveLocation: args?.preserveLocation !== false && args?.preserve_location !== false,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            maxRetries: Number.isFinite(Number(args?.maxRetries ?? args?.max_retries)) ? Number(args?.maxRetries ?? args?.max_retries) : undefined,
            passScore: Number.isFinite(Number(args?.passScore ?? args?.pass_score)) ? Number(args?.passScore ?? args?.pass_score) : undefined,
          });
          return {
            name,
            args,
            result: `Refined video shot from keyframe${refined.keyframeAsset ? ` asset ${refined.keyframeAsset.id}` : ''}; ${refined.result.passed ? 'passed QA' : 'needs review'}.\n${JSON.stringify({
              prompt: refined.prompt,
              keyframe: refined.keyframe,
              keyframeAsset: refined.keyframeAsset,
              selected: refined.result.selected,
              recommendation: refined.result.recommendation,
            }).slice(0, 10000)}`,
            error: false,
            data: refined,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generate_sequence': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateSequence(storage, {
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            storyboardId: args?.storyboardId || args?.storyboard_id ? String(args.storyboardId || args.storyboard_id) : undefined,
            storyboardPath: args?.storyboardPath || args?.storyboard_path ? String(args.storyboardPath || args.storyboard_path) : undefined,
            generationMode: args?.generationMode || args?.generation_mode,
            maxRetriesPerShot: Number.isFinite(Number(args?.maxRetriesPerShot ?? args?.max_retries_per_shot)) ? Number(args?.maxRetriesPerShot ?? args?.max_retries_per_shot) : undefined,
            qaThreshold: Number.isFinite(Number(args?.qaThreshold ?? args?.qa_threshold)) ? Number(args?.qaThreshold ?? args?.qa_threshold) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
            dryRun: args?.dryRun === true || args?.dry_run === true,
            useVision: args?.useVision !== false && args?.use_vision !== false,
          });
          return {
            name,
            args,
            result: `${generated.dryRun ? 'Planned' : 'Generated'} sequence for ${generated.storyboard.shots.length} storyboard shot${generated.storyboard.shots.length === 1 ? '' : 's'} with ${generated.failures.length} failure${generated.failures.length === 1 ? '' : 's'}.\n${JSON.stringify({
              projectId: generated.project?.id || null,
              storyboardId: generated.storyboard.id,
              results: generated.shotResults.map((item) => ({ shotId: item.shotId || item.shot?.shotId, videoPath: item.videoPath || null, passed: item.passed ?? null, error: item.error || null, plan: item.plan })),
              failures: generated.failures,
            }).slice(0, 12000)}`,
            error: false,
            data: generated,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_extract_layers_for_generation': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const extracted = await creativeExtractLayersForGeneration(storage, {
            source: String(args?.source || '').trim(),
            prompt: args?.prompt ? String(args.prompt) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            mode: args?.mode,
            textEditable: args?.textEditable === true,
            extractObjects: args?.extractObjects !== false,
            maxTextLayers: Number(args?.maxTextLayers) || undefined,
            maxShapeLayers: Number(args?.maxShapeLayers) || undefined,
            useVision: args?.useVision !== false,
            useOcr: args?.useOcr === true,
            useSam: args?.useSam !== false,
            inpaintBackground: args?.inpaintBackground !== false,
            vectorTraceShapes: args?.vectorTraceShapes !== false,
          });
          return {
            name,
            args,
            result: `Extracted ${extracted.extraction.layers.length} layer${extracted.extraction.layers.length === 1 ? '' : 's'} and registered ${extracted.registeredLayers.length} reusable layer generation record${extracted.registeredLayers.length === 1 ? '' : 's'}.\n${JSON.stringify({
              generation: extracted.generation,
              scenePath: extracted.extraction.scenePath,
              registeredLayers: extracted.registeredLayers,
              diagnostics: extracted.extraction.diagnostics,
            }).slice(0, 9000)}`,
            error: false,
            data: extracted,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_pick_continuity_frame': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const picked = await creativePickContinuityFrame(storage, {
            source: String(args?.source || args?.video || '').trim(),
            strategy: args?.strategy,
            candidatePercents: Array.isArray(args?.candidatePercents || args?.candidate_percents)
              ? (args.candidatePercents || args.candidate_percents).map((item: any) => Number(item)).filter(Number.isFinite)
              : undefined,
            registerAsAsset: args?.registerAsAsset !== false && args?.register_as_asset !== false,
            continuityPrompt: args?.continuityPrompt || args?.continuity_prompt ? String(args.continuityPrompt || args.continuity_prompt) : undefined,
            useVision: args?.useVision !== false && args?.use_vision !== false,
          });
          return {
            name,
            args,
            result: `Selected continuity frame ${picked.selected?.path || picked.selected?.outputPath || ''}${picked.asset ? ` and imported asset ${picked.asset.id}` : ''}.\n${JSON.stringify({
              selected: picked.selected,
              asset: picked.asset,
              contactSheet: picked.contactSheet,
              candidateCount: picked.candidates.length,
              vision: picked.vision,
            }).slice(0, 7000)}`,
            error: false,
            data: picked,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_chain_scene': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const chained = await creativeChainScene(storage, {
            previousVideo: String(args?.previousVideo || args?.previous_video || args?.source || '').trim(),
            nextPrompt: String(args?.nextPrompt || args?.next_prompt || args?.prompt || '').trim(),
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            frameStrategy: args?.frameStrategy || args?.frame_strategy,
            timestamp: Number.isFinite(Number(args?.timestamp)) ? Number(args.timestamp) : undefined,
            percent: Number.isFinite(Number(args?.percent)) ? Number(args.percent) : undefined,
            duration: Number.isFinite(Number(args?.duration)) ? Number(args.duration) : undefined,
            resolution: args?.resolution ? String(args.resolution) : undefined,
            aspectRatio: args?.aspectRatio || args?.aspect_ratio ? String(args.aspectRatio || args.aspect_ratio) : undefined,
            provider: args?.provider ? String(args.provider) : undefined,
            model: args?.model ? String(args.model) : undefined,
            parentGenerationId: args?.parentGenerationId || args?.parent_generation_id ? String(args.parentGenerationId || args.parent_generation_id) : undefined,
            stitch: args?.stitch === true,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
          });
          return {
            name,
            args,
            result: `Chained scene${chained.shot?.generation ? ` ${chained.shot.generation.id}` : ''} from continuity frame${chained.continuityAsset ? ` ${chained.continuityAsset.id}` : ''}.\n${JSON.stringify({
              continuityFrame: chained.continuityFrame,
              continuityAsset: chained.continuityAsset,
              video: chained.shot?.video,
              asset: chained.shot?.asset,
              generation: chained.shot?.generation,
              stitched: chained.stitched,
            }).slice(0, 9000)}`,
            error: false,
            data: chained,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_wrap_video_as_html_motion_clip': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const wrapped = await creativeWrapVideoAsHtmlMotionClip(storage, {
            source: String(args?.source || args?.video || '').trim(),
            title: args?.title ? String(args.title) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            fit: args?.fit,
            filename: args?.filename ? String(args.filename) : undefined,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
          });
          return {
            name,
            args,
            result: `Wrapped video as HTML Motion clip ${wrapped.clipPath}.\n${JSON.stringify({
              clipPath: wrapped.clipPath,
              asset: wrapped.asset,
              durationMs: wrapped.durationMs,
              width: wrapped.width,
              height: wrapped.height,
            }).slice(0, 5000)}`,
            error: false,
            data: wrapped,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_add_generated_clip_to_composition': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const wrapped = await creativeWrapVideoAsHtmlMotionClip(storage, {
            source: String(args?.source || args?.video || '').trim(),
            title: args?.title ? String(args.title) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            fit: args?.fit,
            importToCreative: args?.importToCreative !== false && args?.import_to_creative !== false,
          });
          const placement = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'composition_add_clip',
            payload: {
              trackId: args?.trackId || args?.track_id ? String(args.trackId || args.track_id) : undefined,
              lane: 'html-motion',
              source: { kind: 'html-motion', clipPath: wrapped.clipPath, compositionId: wrapped.asset.id },
              atMs: Number.isFinite(Number(args?.atMs ?? args?.at_ms)) ? Number(args?.atMs ?? args?.at_ms) : undefined,
              durationMs: wrapped.durationMs,
              label: args?.label ? String(args.label) : (wrapped.asset.name || 'Generated video clip'),
              ripple: args?.ripple === true,
            },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_composition_add_clip'),
          });
          return {
            name,
            args,
            result: placement.success
              ? `Added generated video clip to composition via ${wrapped.clipPath}.`
              : `Wrapped clip, but composition placement failed: ${placement.error || 'unknown editor error'}`,
            error: !placement.success,
            data: { wrapped, placement },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_render_generated_sequence': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rawVideos = Array.isArray(args?.videos)
            ? args.videos
            : String(args?.videos || args?.source || '').split(/[\r\n,]+/).map((part) => part.trim()).filter(Boolean);
          const rendered = await creativeRenderGeneratedSequence(storage, {
            videos: rawVideos.map((item: any) => typeof item === 'string' ? item : {
              source: String(item?.source || ''),
              trimStartMs: Number.isFinite(Number(item?.trimStartMs ?? item?.trim_start_ms)) ? Number(item?.trimStartMs ?? item?.trim_start_ms) : undefined,
              trimEndMs: Number.isFinite(Number(item?.trimEndMs ?? item?.trim_end_ms)) ? Number(item?.trimEndMs ?? item?.trim_end_ms) : undefined,
              durationMs: Number.isFinite(Number(item?.durationMs ?? item?.duration_ms)) ? Number(item?.durationMs ?? item?.duration_ms) : undefined,
              label: item?.label ? String(item.label) : undefined,
            }),
            filename: args?.filename ? String(args.filename) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            fit: args?.fit,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
            transition: args?.transition,
            transitionDurationMs: Number.isFinite(Number(args?.transitionDurationMs ?? args?.transition_duration_ms)) ? Number(args?.transitionDurationMs ?? args?.transition_duration_ms) : undefined,
            audioHandling: args?.audioHandling || args?.audio_handling,
            renderMode: args?.renderMode || args?.render_mode,
          });
          if (args?.addToEditor !== false && args?.add_to_editor !== false && rendered.outputRelPath) {
            await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'add_asset',
              payload: {
                source: rendered.outputRelPath,
                type: 'video',
                assetType: 'video',
                fit: 'cover',
                durationMs: rendered.composition?.durationMs || undefined,
                meta: { generatedSequence: true },
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
            }).catch(() => undefined);
          }
          return {
            name,
            args,
            result: `Rendered generated sequence to ${rendered.outputRelPath}.\n${JSON.stringify({
              outputPath: rendered.outputRelPath,
              clipCount: rendered.clips.length,
              render: rendered.render,
            }).slice(0, 6000)}`,
            error: false,
            data: rendered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_stitch_clips': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rawClips = Array.isArray(args?.clips)
            ? args.clips
            : String(args?.clips || args?.videos || '').split(/[\r\n,]+/).map((part) => part.trim()).filter(Boolean);
          const stitched = await creativeStitchClips(storage, {
            clips: rawClips.map((item: any) => typeof item === 'string' ? item : {
              source: String(item?.source || ''),
              trimStartMs: Number.isFinite(Number(item?.trimStartMs ?? item?.trim_start_ms)) ? Number(item?.trimStartMs ?? item?.trim_start_ms) : undefined,
              trimEndMs: Number.isFinite(Number(item?.trimEndMs ?? item?.trim_end_ms)) ? Number(item?.trimEndMs ?? item?.trim_end_ms) : undefined,
              durationMs: Number.isFinite(Number(item?.durationMs ?? item?.duration_ms)) ? Number(item?.durationMs ?? item?.duration_ms) : undefined,
              label: item?.label ? String(item.label) : undefined,
            }),
            filename: args?.filename ? String(args.filename) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            transition: args?.transition,
            transitionDurationMs: Number.isFinite(Number(args?.transitionDurationMs ?? args?.transition_duration_ms)) ? Number(args?.transitionDurationMs ?? args?.transition_duration_ms) : undefined,
            audioHandling: args?.audioHandling || args?.audio_handling,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
          });
          if (args?.addToEditor !== false && args?.add_to_editor !== false && stitched.outputRelPath) {
            await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'add_asset',
              payload: {
                source: stitched.outputRelPath,
                type: 'video',
                assetType: 'video',
                fit: 'cover',
                durationMs: Number(stitched.asset?.durationMs || 0) || undefined,
                meta: { stitched: true },
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
            }).catch(() => undefined);
          }
          return {
            name,
            args,
            result: `Stitched ${stitched.clipPlan.length} clip${stitched.clipPlan.length === 1 ? '' : 's'} to ${stitched.outputRelPath}.\n${JSON.stringify(stitched).slice(0, 9000)}`,
            error: false,
            data: stitched,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_auto_assemble_rough_cut': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rawVideos = Array.isArray(args?.videos) ? args.videos : [];
          const assembled = await creativeAutoAssembleRoughCut(storage, {
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            storyboardId: args?.storyboardId || args?.storyboard_id ? String(args.storyboardId || args.storyboard_id) : undefined,
            storyboardPath: args?.storyboardPath || args?.storyboard_path ? String(args.storyboardPath || args.storyboard_path) : undefined,
            selectedTakes: args?.selectedTakes || args?.selected_takes,
            videos: rawVideos.map((item: any) => typeof item === 'string' ? item : {
              source: String(item?.source || ''),
              shotId: item?.shotId || item?.shot_id ? String(item.shotId || item.shot_id) : undefined,
              trimStartMs: Number.isFinite(Number(item?.trimStartMs ?? item?.trim_start_ms)) ? Number(item?.trimStartMs ?? item?.trim_start_ms) : undefined,
              trimEndMs: Number.isFinite(Number(item?.trimEndMs ?? item?.trim_end_ms)) ? Number(item?.trimEndMs ?? item?.trim_end_ms) : undefined,
              durationMs: Number.isFinite(Number(item?.durationMs ?? item?.duration_ms)) ? Number(item?.durationMs ?? item?.duration_ms) : undefined,
              label: item?.label ? String(item.label) : undefined,
            }),
            filename: args?.filename ? String(args.filename) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            transition: args?.transition,
            transitionDurationMs: Number.isFinite(Number(args?.transitionDurationMs ?? args?.transition_duration_ms)) ? Number(args?.transitionDurationMs ?? args?.transition_duration_ms) : undefined,
            defaultTrimStartMs: Number.isFinite(Number(args?.defaultTrimStartMs ?? args?.default_trim_start_ms)) ? Number(args?.defaultTrimStartMs ?? args?.default_trim_start_ms) : undefined,
            defaultTrimEndMs: Number.isFinite(Number(args?.defaultTrimEndMs ?? args?.default_trim_end_ms)) ? Number(args?.defaultTrimEndMs ?? args?.default_trim_end_ms) : undefined,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
            audioHandling: args?.audioHandling || args?.audio_handling,
          });
          if (args?.addToEditor !== false && args?.add_to_editor !== false && assembled.stitched?.outputRelPath) {
            await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'add_asset',
              payload: {
                source: assembled.stitched.outputRelPath,
                type: 'video',
                assetType: 'video',
                fit: 'cover',
                durationMs: Number(assembled.stitched.asset?.durationMs || 0) || undefined,
                meta: { roughCut: true, timelinePath: assembled.timeline?.path || null },
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
            }).catch(() => undefined);
          }
          return {
            name,
            args,
            result: `Assembled rough cut ${assembled.stitched.outputRelPath} with ${assembled.timeline.clips.length} clip${assembled.timeline.clips.length === 1 ? '' : 's'}; timeline ${assembled.timeline.path}.\n${JSON.stringify({
              outputPath: assembled.stitched.outputRelPath,
              timelinePath: assembled.timeline.path,
              transition: assembled.stitched.ffmpeg,
              projectId: assembled.project?.id || null,
            }).slice(0, 9000)}`,
            error: false,
            data: assembled,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_normalize_layer_specs': {
        try {
          const normalized = creativeNormalizeLayerSpecs({
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
          });
          return {
            name,
            args,
            result: `Normalized ${normalized.layers.length} layer spec${normalized.layers.length === 1 ? '' : 's'} for ${normalized.width}x${normalized.height}, ${normalized.durationMs}ms.`,
            error: false,
            data: normalized,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_validate_composition_layers': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const validation = creativeValidateCompositionLayers(storage, {
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            strict: args?.strict === true,
          });
          return {
            name,
            args,
            result: `${validation.ok ? 'Layer validation passed' : 'Layer validation failed'} with ${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}; complexity ${validation.complexityScore}.\n${JSON.stringify({ issues: validation.issues, normalized: validation.normalized }).slice(0, 12000)}`,
            error: !validation.ok,
            data: validation,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_preflight_overlay': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const preflight = await creativePreflightOverlay(storage, {
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            strict: args?.strict === true,
            writePreview: args?.writePreview !== false && args?.write_preview !== false,
          });
          return {
            name,
            args,
            result: `${preflight.ok ? 'Overlay preflight passed' : 'Overlay preflight failed'} with ${preflight.issues.length} issue${preflight.issues.length === 1 ? '' : 's'}${preflight.previewPath ? `; preview ${preflight.previewPath}` : ''}.\n${JSON.stringify({ issues: preflight.issues, previewPath: preflight.previewPath, complexityScore: preflight.complexityScore }).slice(0, 9000)}`,
            error: !preflight.ok,
            data: preflight,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_sample_composite_frames': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const sampled = await creativeSampleCompositeFrames(storage, {
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            timestampsMs: Array.isArray(args?.timestampsMs || args?.timestamps_ms)
              ? (args.timestampsMs || args.timestamps_ms).map((item: any) => Number(item)).filter(Number.isFinite)
              : undefined,
            count: Number.isFinite(Number(args?.count)) ? Number(args.count) : undefined,
          });
          return {
            name,
            args,
            result: `Sampled ${sampled.frames.length} composite frame${sampled.frames.length === 1 ? '' : 's'}${sampled.contactSheet ? ` with contact sheet ${sampled.contactSheet.path}` : ''}.\n${JSON.stringify({ ok: sampled.ok, issues: sampled.issues, frames: sampled.frames, previewPath: sampled.previewPath, contactSheet: sampled.contactSheet }).slice(0, 10000)}`,
            error: !sampled.ok,
            data: sampled,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generate_motion_graphics_layer': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateMotionGraphicsLayer(storage, {
            mode: args?.mode,
            text: args?.text ? String(args.text) : undefined,
            secondaryText: args?.secondaryText || args?.secondary_text ? String(args.secondaryText || args.secondary_text) : undefined,
            accentColor: args?.accentColor || args?.accent_color ? String(args.accentColor || args.accent_color) : undefined,
            startMs: Number.isFinite(Number(args?.startMs ?? args?.start_ms)) ? Number(args?.startMs ?? args?.start_ms) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            targetRegion: args?.targetRegion || args?.target_region,
            data: args?.data && typeof args.data === 'object' ? args.data : undefined,
            asset: args?.asset ? String(args.asset) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
            sample: args?.sample !== false,
          });
          return {
            name,
            args,
            result: `Generated editable motion graphics layer ${generated.htmlPath}${generated.samples?.contactSheet ? `; contact sheet ${generated.samples.contactSheet.path}` : ''}.\n${JSON.stringify({ layer: generated.layer, htmlPath: generated.htmlPath, slots: generated.slots, issues: generated.preflight.issues, samples: generated.samples }).slice(0, 10000)}`,
            error: false,
            data: generated,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_overlay_hyperframes_on_video': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rendered = await creativeOverlayHyperframesOnVideo(storage, {
            baseVideo: String(args?.baseVideo || args?.base_video || args?.video || '').trim(),
            overlayHtml: args?.overlayHtml || args?.overlay_html ? String(args.overlayHtml || args.overlay_html) : undefined,
            overlayPath: args?.overlayPath || args?.overlay_path ? String(args.overlayPath || args.overlay_path) : undefined,
            startMs: Number.isFinite(Number(args?.startMs ?? args?.start_ms)) ? Number(args?.startMs ?? args?.start_ms) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            position: args?.position,
            bounds: args?.bounds,
            blendMode: args?.blendMode || args?.blend_mode,
            opacity: Number.isFinite(Number(args?.opacity)) ? Number(args.opacity) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            outputFilename: args?.outputFilename || args?.output_filename || args?.filename ? String(args.outputFilename || args.output_filename || args.filename) : undefined,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
            sampleBeforeRender: args?.sampleBeforeRender !== false && args?.sample_before_render !== false,
          });
          return {
            name,
            args,
            result: `Rendered overlay video to ${rendered.outputRelPath}; manifest ${rendered.compositionPath}.\n${JSON.stringify({ outputPath: rendered.outputRelPath, compositionPath: rendered.compositionPath, asset: rendered.asset, issues: rendered.preflight.issues, samples: rendered.samples }).slice(0, 10000)}`,
            error: false,
            data: rendered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_composite_video_layers': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const rendered = await creativeCompositeVideoLayers(storage, {
            layers: Array.isArray(args?.layers) ? args.layers : [],
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
            frameRate: Number.isFinite(Number(args?.frameRate ?? args?.frame_rate)) ? Number(args?.frameRate ?? args?.frame_rate) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
            format: args?.format === 'webm' ? 'webm' : 'mp4',
            sampleBeforeRender: args?.sampleBeforeRender !== false && args?.sample_before_render !== false,
            strict: args?.strict !== false,
            audioLayer: args?.audioLayer || args?.audio_layer,
          });
          return {
            name,
            args,
            result: `Rendered composite video to ${rendered.outputRelPath}; manifest ${rendered.compositionPath}.\n${JSON.stringify({ outputPath: rendered.outputRelPath, compositionPath: rendered.compositionPath, asset: rendered.asset, issues: rendered.preflight.issues, samples: rendered.samples }).slice(0, 10000)}`,
            error: false,
            data: rendered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_import_audio': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const imported = await creativeImportAudio(storage, {
            source: String(args?.source || '').trim(),
            label: args?.label ? String(args.label) : undefined,
            tags: args?.tags,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            copy: args?.copy !== false,
          });
          return { name, args, result: `Imported audio ${imported.audioTrack.source}; generation ${imported.generation.id}.\n${JSON.stringify({ asset: imported.asset, audioTrack: imported.audioTrack, analysis: imported.analysis, projectId: imported.project?.id || null }).slice(0, 10000)}`, error: false, data: imported };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_download_audio': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const downloaded = await creativeDownloadAudio(storage, {
            url: String(args?.url || '').trim(),
            label: args?.label ? String(args.label) : undefined,
            tags: args?.tags,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            outputDir: args?.outputDir || args?.output_dir ? String(args.outputDir || args.output_dir) : undefined,
          });
          return { name, args, result: `Downloaded audio to ${downloaded.audioTrack.source}; generation ${downloaded.generation.id}.\n${JSON.stringify({ download: downloaded.download, asset: downloaded.asset, audioTrack: downloaded.audioTrack, projectId: downloaded.project?.id || null }).slice(0, 10000)}`, error: false, data: downloaded };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_extract_audio_from_video': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const extracted = await creativeExtractAudioFromVideo(storage, {
            source: String(args?.source || args?.video || '').trim(),
            filename: args?.filename ? String(args.filename) : undefined,
            format: args?.format === 'wav' ? 'wav' : args?.format === 'm4a' ? 'm4a' : 'mp3',
            label: args?.label ? String(args.label) : undefined,
            tags: args?.tags,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
          });
          return { name, args, result: `Extracted audio to ${extracted.outputPath}; generation ${extracted.generation.id}.\n${JSON.stringify({ asset: extracted.asset, audioTrack: extracted.audioTrack, analysis: extracted.analysis, projectId: extracted.project?.id || null }).slice(0, 10000)}`, error: false, data: extracted };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_generate_voiceover': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const generated = await creativeGenerateVoiceover(storage, {
            text: String(args?.text || args?.script || '').trim(),
            provider: args?.provider === 'xai'
              ? 'xai'
              : args?.provider === 'openai_realtime'
                ? 'openai_realtime'
                : args?.provider === 'openai'
                  ? 'openai'
                  : 'auto',
            voice: args?.voice || args?.voiceId || args?.voice_id ? String(args.voice || args.voiceId || args.voice_id) : undefined,
            language: args?.language ? String(args.language) : undefined,
            speed: Number.isFinite(Number(args?.speed)) ? Number(args.speed) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            shotId: args?.shotId || args?.shot_id ? String(args.shotId || args.shot_id) : undefined,
            tags: args?.tags,
          });
          if (args?.addToEditor !== false && args?.add_to_editor !== false && generated.outputPath) {
            await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'add_asset',
              payload: {
                source: generated.outputPath,
                type: 'audio',
                assetType: 'audio',
                durationMs: Number(generated.asset?.durationMs || generated.audioTrack?.durationMs || 0) || undefined,
                volume: Number.isFinite(Number(args?.volume)) ? Number(args.volume) : 1,
                meta: {
                  voiceover: true,
                  generationId: generated.generation?.id || null,
                  shotId: args?.shotId || args?.shot_id || null,
                },
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_add_asset'),
            }).catch(() => undefined);
          }
          return { name, args, result: `Generated voiceover ${generated.outputPath}; generation ${generated.generation.id}.\n${JSON.stringify({ asset: generated.asset, audioTrack: generated.audioTrack, analysis: generated.analysis, projectId: generated.project?.id || null }).slice(0, 10000)}`, error: false, data: generated };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_transcribe_audio': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const transcribed = await creativeTranscribeAudio(storage, {
            source: String(args?.source || '').trim(),
            provider: args?.provider === 'xai' ? 'xai' : 'openai',
            language: args?.language ? String(args.language) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
          });
          return { name, args, result: `Transcribed audio with ${transcribed.provider}; text length ${transcribed.text.length}.\n${JSON.stringify({ provider: transcribed.provider, text: transcribed.text, analysis: transcribed.analysis }).slice(0, 10000)}`, error: false, data: transcribed };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_sync_captions_to_audio': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const captions = await creativeSyncCaptionsToAudio(storage, {
            transcript: args?.transcript || args?.text ? String(args.transcript || args.text) : undefined,
            segments: Array.isArray(args?.segments) ? args.segments : undefined,
            audioSource: args?.audioSource || args?.audio_source ? String(args.audioSource || args.audio_source) : undefined,
            width: Number.isFinite(Number(args?.width)) ? Number(args.width) : undefined,
            height: Number.isFinite(Number(args?.height)) ? Number(args.height) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args.durationMs ?? args.duration_ms) : undefined,
            style: args?.style ? String(args.style) : undefined,
            filename: args?.filename ? String(args.filename) : undefined,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
          });
          return { name, args, result: `Created synced caption layer ${captions.htmlPath} with ${captions.segments.length} segment${captions.segments.length === 1 ? '' : 's'}.\n${JSON.stringify({ layer: captions.layer, htmlPath: captions.htmlPath, segments: captions.segments, projectId: captions.project?.id || null, samples: captions.samples }).slice(0, 10000)}`, error: false, data: captions };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_add_audio_track': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const added = await creativeAddAudioTrack(storage, {
            source: String(args?.source || '').trim(),
            label: args?.label ? String(args.label) : undefined,
            startMs: Number.isFinite(Number(args?.startMs ?? args?.start_ms)) ? Number(args.startMs ?? args.start_ms) : undefined,
            durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args.durationMs ?? args.duration_ms) : undefined,
            trimStartMs: Number.isFinite(Number(args?.trimStartMs ?? args?.trim_start_ms)) ? Number(args.trimStartMs ?? args.trim_start_ms) : undefined,
            trimEndMs: Number.isFinite(Number(args?.trimEndMs ?? args?.trim_end_ms)) ? Number(args.trimEndMs ?? args.trim_end_ms) : undefined,
            volume: Number.isFinite(Number(args?.volume)) ? Number(args.volume) : undefined,
            muted: args?.muted === true,
            fadeInMs: Number.isFinite(Number(args?.fadeInMs ?? args?.fade_in_ms)) ? Number(args.fadeInMs ?? args.fade_in_ms) : undefined,
            fadeOutMs: Number.isFinite(Number(args?.fadeOutMs ?? args?.fade_out_ms)) ? Number(args.fadeOutMs ?? args.fade_out_ms) : undefined,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
          });
          return { name, args, result: `Prepared audio track ${added.audioTrack.source}${added.project ? ` for project ${added.project.id}` : ''}.\n${JSON.stringify({ audioTrack: added.audioTrack, projectId: added.project?.id || null }).slice(0, 10000)}`, error: false, data: added };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_mix_audio_tracks': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const mixed = await creativeMixAudioTracks(storage, {
            tracks: Array.isArray(args?.tracks) ? args.tracks : [],
            filename: args?.filename ? String(args.filename) : undefined,
            format: args?.format === 'wav' ? 'wav' : args?.format === 'm4a' ? 'm4a' : 'mp3',
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
          });
          return { name, args, result: `Mixed audio to ${mixed.outputPath}.\n${JSON.stringify({ outputPath: mixed.outputPath, audioTrack: mixed.audioTrack, asset: mixed.asset, projectId: mixed.project?.id || null }).slice(0, 10000)}`, error: false, data: mixed };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_add_music_bed': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const music = await creativeAddMusicBed(storage, {
            source: args?.source ? String(args.source) : undefined,
            url: args?.url ? String(args.url) : undefined,
            volume: Number.isFinite(Number(args?.volume)) ? Number(args.volume) : undefined,
            fadeInMs: Number.isFinite(Number(args?.fadeInMs ?? args?.fade_in_ms)) ? Number(args.fadeInMs ?? args.fade_in_ms) : undefined,
            fadeOutMs: Number.isFinite(Number(args?.fadeOutMs ?? args?.fade_out_ms)) ? Number(args.fadeOutMs ?? args.fade_out_ms) : undefined,
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            label: args?.label ? String(args.label) : undefined,
          });
          return { name, args, result: `Added music bed ${music.audioTrack.source}.\n${JSON.stringify({ audioTrack: music.audioTrack, asset: music.asset, projectId: music.project?.id || null }).slice(0, 10000)}`, error: false, data: music };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_add_sound_effects': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const sfx = await creativeAddSoundEffects(storage, {
            effects: Array.isArray(args?.effects) ? args.effects : [],
            projectId: args?.projectId || args?.project_id ? String(args.projectId || args.project_id) : undefined,
            mix: args?.mix !== false,
            filename: args?.filename ? String(args.filename) : undefined,
          });
          return { name, args, result: `Added ${sfx.tracks.length} sound effect track${sfx.tracks.length === 1 ? '' : 's'}${sfx.mix ? ` and mixed to ${sfx.mix.outputPath}` : ''}.\n${JSON.stringify({ tracks: sfx.tracks, mix: sfx.mix, projectId: sfx.project?.id || null }).slice(0, 10000)}`, error: false, data: sfx };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_extract_layers': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let extraction;
        try {
          extraction = await getCreativeLayerExtraction().extractCreativeLayers(storage, {
            source: String(args?.source || '').trim(),
            mode: args?.mode,
            prompt: args?.prompt ? String(args.prompt) : undefined,
            textEditable: args?.textEditable === true,
            extractObjects: args?.extractObjects !== false,
            preserveOriginal: args?.preserveOriginal !== false,
            copySource: args?.copySource !== false,
            maxTextLayers: Number(args?.maxTextLayers) || undefined,
            maxShapeLayers: Number(args?.maxShapeLayers) || undefined,
            useVision: args?.useVision !== false,
            useOcr: args?.useOcr === true,
            useSam: args?.useSam !== false,
            inpaintBackground: args?.inpaintBackground !== false,
            vectorTraceShapes: args?.vectorTraceShapes !== false,
          });
        } catch (err: any) {
          return {
            name,
            args,
            result: `creative_extract_layers: ${String(err?.message || err || 'layer extraction failed')}`,
            error: true,
          };
        }

        const applyToScene = args?.applyToScene !== false;
        const replaceScene = args?.replaceScene !== false;
        const creativeMode = getCreativeMode(sessionId);
        let applyResult: any = null;
        let resetResult: any = null;
        if (applyToScene && (creativeMode === 'image' || creativeMode === 'canvas')) {
          if (replaceScene) {
            resetResult = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'reset_scene',
              payload: { force: true },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_reset_scene'),
            });
          }
          if (!replaceScene || resetResult?.success) {
            applyResult = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'apply_ops',
              payload: {
                ops: extraction.ops,
                reason: 'Apply extracted editable layers from a flat raster image.',
              },
              timeoutMs: 60000,
            });
          }
        }

        const applied = !!applyResult?.success;
        const layerCounts = {
          total: extraction.scene.elements.length,
          text: extraction.scene.elements.filter((element: any) => element?.type === 'text').length,
          shape: extraction.scene.elements.filter((element: any) => element?.type === 'shape').length,
          image: extraction.scene.elements.filter((element: any) => element?.type === 'image').length,
        };
        const applyNote = !applyToScene
          ? 'Scene application skipped by applyToScene=false.'
          : applied
            ? 'Extracted scene was applied to the active Image workspace.'
            : creativeMode === 'image' || creativeMode === 'canvas'
              ? `Scene was extracted but not applied: ${applyResult?.error || resetResult?.error || 'creative editor did not accept the command.'}`
          : 'Scene was extracted but not applied because an image workspace is not selected.';
        return {
          name,
          args,
          result: [
            `Extracted ${layerCounts.total} editable layer${layerCounts.total === 1 ? '' : 's'} from ${extraction.source.name}.`,
            `Saved scene: ${extraction.scenePath}`,
            applyNote,
            extraction.diagnostics.warnings.length ? `Warnings: ${extraction.diagnostics.warnings.join(' | ')}` : '',
          ].filter(Boolean).join('\n'),
          error: false,
          data: {
            ...extraction,
            applied,
            applyResult,
            resetResult,
            storageRoot: storage.rootAbsPath,
            storageRootRelative: storage.rootRelPath,
            layerCounts,
          },
        };
      }

      case 'creative_list_html_motion_templates': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const templates = summarizeHtmlMotionTemplates(storage);
        return {
          name,
          args,
          result: `${name}: ${templates.length} HTML motion templates available.\n${JSON.stringify({ templates }).slice(0, 4000)}`,
          error: false,
          data: { templates },
        };
      }

      case 'creative_list_hyperframes_components': {
        const components = getHyperframesCatalog().listHyperframesCatalogItems({
          query: args?.query,
          kind: args?.kind,
          tag: args?.tag,
        });
        return {
          name,
          args,
          result: `${name}: ${components.length} HyperFrames catalog component${components.length === 1 ? '' : 's'} available.\n${JSON.stringify({ components }).slice(0, 5000)}`,
          error: false,
          data: { components },
        };
      }

      case 'creative_import_hyperframes_component': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const componentId = String(args?.componentId || args?.id || '').trim();
        if (!componentId) {
          return { name, args, result: `${name}: componentId is required.`, error: true };
        }
        try {
          const imported = await getHyperframesCatalog().importHyperframesComponent(storage, componentId);
          const saved = imported.template || imported.block;
          return {
            name,
            args,
            result: `${name}: imported HyperFrames ${imported.item.name} as ${imported.importedAs} ${saved?.id || ''} with ${imported.assets.length} asset reference${imported.assets.length === 1 ? '' : 's'}.\n${JSON.stringify({
              importedAs: imported.importedAs,
              template: imported.template,
              block: imported.block,
              assets: imported.assets,
              warnings: imported.warnings,
            }).slice(0, 5000)}`,
            error: false,
            data: imported,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_sync_hyperframes_catalog': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const rawIds = Array.isArray(args?.ids)
          ? args.ids
          : typeof args?.ids === 'string'
            ? String(args.ids).split(',').map((part) => part.trim()).filter(Boolean)
            : [];
        try {
          const synced = await getHyperframesCatalog().importHyperframesCatalog(storage, {
            ids: rawIds,
            query: args?.query,
            limit: Number(args?.limit) || undefined,
            live: args?.live === true,
          });
          const templates = synced.imported.filter((entry) => entry.importedAs === 'template').length;
          const blocks = synced.imported.filter((entry) => entry.importedAs === 'block').length;
          return {
            name,
            args,
            result: `${name}: imported ${synced.imported.length}/${synced.selectedCount} HyperFrames component${synced.selectedCount === 1 ? '' : 's'} (${templates} templates, ${blocks} blocks). ${synced.failed.length ? `${synced.failed.length} failed.` : 'No failures.'}\n${JSON.stringify({
              catalogCount: synced.catalogCount,
              selectedCount: synced.selectedCount,
              imported: synced.imported.map((entry) => ({
                id: entry.item.id,
                name: entry.item.name,
                importedAs: entry.importedAs,
                savedId: entry.template?.id || entry.block?.id,
                assetCount: entry.assets.length,
                warnings: entry.warnings,
              })),
              failed: synced.failed,
            }).slice(0, 7000)}`,
            error: synced.imported.length === 0 && synced.failed.length > 0,
            data: synced,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_list_library_packs': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const payload = buildCreativeLibraryPayload(storage);
        const includeElements = args?.includeElements === true;
        const libraries = includeElements
          ? payload.libraries
          : payload.libraries.map(({ elements, animationPresets, ...library }) => ({
              ...library,
              elementCount: Object.values(elements || {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0),
              animationPresetCount: Array.isArray(animationPresets) ? animationPresets.length : 0,
            }));
        return {
          name,
          args,
          result: `${name}: ${libraries.length} creative library packs available (${payload.enabledLibraryIds.length} enabled).\n${JSON.stringify({ libraries, enabledLibraryIds: payload.enabledLibraryIds }).slice(0, 5000)}`,
          error: false,
          data: { ...payload, libraries },
        };
      }

      case 'creative_create_library_pack': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const manifest = args?.pack && typeof args.pack === 'object' && !Array.isArray(args.pack)
            ? args.pack
            : args;
          const created = createCreativeLibraryPack(storage, manifest, args?.enabled !== false);
          return {
            name,
            args,
            result: `${name}: saved custom creative library pack ${created.pack.label} (${created.pack.id}) and ${created.pack.enabled ? 'enabled' : 'disabled'} it.\n${JSON.stringify({ pack: created.pack, enabledLibraryIds: created.payload.enabledLibraryIds }).slice(0, 4000)}`,
            error: false,
            data: created,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_toggle_library_pack': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const libraryId = String(args?.libraryId || args?.id || '').trim();
          const enabled = args?.enabled !== false;
          const toggled = toggleCreativeLibraryPack(storage, libraryId, enabled);
          return {
            name,
            args,
            result: `${name}: ${enabled ? 'enabled' : 'disabled'} creative library pack ${toggled.libraryId}.\n${JSON.stringify({ enabledLibraryIds: toggled.payload.enabledLibraryIds }).slice(0, 3000)}`,
            error: false,
            data: toggled,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_save_html_motion_template': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let html = typeof args?.html === 'string' ? String(args.html) : '';
        let activeClip: any = null;
        if (!html.trim() && args?.useActiveClip !== false) {
          const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
          const read = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'read_html_motion_clip',
            payload: { includeHtml: true },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_read_html_motion_clip'),
          });
          const readAny: any = read;
          if (read.success) {
            activeClip = readAny.data?.clip || readAny.clip || null;
            html = String(readAny.data?.clip?.html || readAny.clip?.html || readAny.data?.html || '');
          }
        }
        if (!html.trim()) {
          return { name, args, result: `${name}: html is required unless an active HTML motion clip can be read.`, error: true };
        }
        try {
          const template = saveCustomHtmlMotionTemplate(storage, {
            ...args,
            html,
            name: args?.name || args?.title || activeClip?.title,
            width: args?.width || activeClip?.width,
            height: args?.height || activeClip?.height,
            durationMs: args?.durationMs || activeClip?.durationMs,
            frameRate: args?.frameRate || activeClip?.frameRate,
          });
          return {
            name,
            args,
            result: `${name}: saved custom HTML motion template ${template.name} (${template.id}).\n${JSON.stringify({ template }).slice(0, 4000)}`,
            error: false,
            data: { template },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_save_html_motion_block': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        try {
          const block = saveCustomHtmlMotionBlock(storage, args?.block && typeof args.block === 'object' && !Array.isArray(args.block) ? args.block : args);
          return {
            name,
            args,
            result: `${name}: saved custom HTML motion block ${block.name} (${block.id}).\n${JSON.stringify({ block }).slice(0, 4000)}`,
            error: false,
            data: { block },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_promote_scene_to_template': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const currentCreativeMode = getCreativeMode(sessionId);
        const creativeMode = currentCreativeMode && currentCreativeMode !== 'design'
          ? currentCreativeMode
          : (setCreativeMode(sessionId, 'image') || 'image');
        try {
          const save = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'save_scene',
            payload: { filename: `${String(args?.id || args?.name || 'promoted-scene').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'promoted-scene'}.json` },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_save_scene'),
          });
          if (!save.success) {
            return { name, args, result: `${name}: ${save.error || 'could not save the active scene before promoting it.'}`, error: true };
          }
          const saveAny: any = save;
          const savedPath = String(saveAny.data?.path || saveAny.path || '');
          if (!savedPath) {
            return { name, args, result: `${name}: editor saved the scene but did not return a workspace path.`, error: true, data: save };
          }
          const savedAbsPath = resolveWorkspaceFilePath(storage.workspacePath, savedPath);
          const parsed = JSON.parse(fs.readFileSync(savedAbsPath, 'utf-8'));
          const scene = parsed?.doc || parsed?.scene || parsed;
          const template = saveCustomSceneTemplate(storage, {
            ...args,
            scene,
            category: args?.category || creativeMode,
          });
          let htmlTemplate: any = null;
          if (creativeMode === 'video' && args?.saveHtmlTemplate === true) {
            const read = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'read_html_motion_clip',
              payload: { includeHtml: true },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_read_html_motion_clip'),
            });
            const readAny: any = read;
            const html = read.success ? String(readAny.data?.clip?.html || readAny.clip?.html || readAny.data?.html || '') : '';
            if (html.trim()) {
              htmlTemplate = saveCustomHtmlMotionTemplate(storage, {
                id: `${template.id}-html-motion`,
                name: `${template.name} HTML Motion`,
                description: args?.description || template.description,
                bestFor: args?.bestFor || template.bestFor,
                html,
                width: template.width,
                height: template.height,
                durationMs: template.durationMs,
                frameRate: template.frameRate,
              });
            }
          }
          return {
            name,
            args,
            result: `${name}: promoted active ${creativeMode} scene to custom template ${template.name} (${template.id}).\n${JSON.stringify({ template, htmlTemplate }).slice(0, 5000)}`,
            error: false,
            data: { template, htmlTemplate, sourceScenePath: savedPath },
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_lint_html_motion_clip': {
        const html = typeof args?.html === 'string' ? String(args.html) : '';
        if (!html.trim()) {
          const creativeMode = getCreativeMode(sessionId);
          if (creativeMode && creativeMode !== 'design') {
            const result = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'read_html_motion_clip',
              payload: {
                ...(args || {}),
                includeHtml: false,
              },
              timeoutMs: resolveCreativeEditorTimeoutMs(name),
            });
            if (result.success) {
              const resultAny: any = result;
              const lint = resultAny.data?.clip?.lint || resultAny.clip?.lint || resultAny.data?.lint || resultAny.lint;
              return {
                name,
                args,
                result: `${name}: ${lint?.ok === false ? 'blocked' : 'ok'} (${Number(lint?.errorCount || 0)} errors, ${Number(lint?.warningCount || 0)} warnings).\n${JSON.stringify(lint || result.data || result).slice(0, 5000)}`,
                error: false,
                data: lint || result.data || result,
              };
            }
          }
          return {
            name,
            args,
            result: `${name}: provide html/path to lint directly, or keep an active HTML motion clip selected before linting.`,
            error: true,
          };
        }
        const lint = lintHtmlMotionComposition(html, args?.manifest && typeof args.manifest === 'object' ? args.manifest : args);
        return {
          name,
          args,
          result: `${name}: ${lint.ok ? 'ok' : 'blocked'} (${lint.errorCount} errors, ${lint.warningCount} warnings).\n${JSON.stringify(lint).slice(0, 5000)}`,
          error: false,
          data: lint,
        };
      }

      case 'creative_measure_text': {
        const text = String(args?.text ?? '');
        const width = Number(args?.width);
        if (!Number.isFinite(width) || width <= 0) {
          return { name, args, result: `${name}: width (px) is required.`, error: true };
        }
        try {
          const fit = checkTextFit(text, {
            width,
            maxHeight: Number.isFinite(Number(args?.maxHeight)) ? Number(args.maxHeight) : undefined,
            fontSize: Number(args?.fontSize) || undefined,
            fontFamily: typeof args?.fontFamily === 'string' ? args.fontFamily : undefined,
            fontWeight: typeof args?.fontWeight === 'number' || typeof args?.fontWeight === 'string' ? args.fontWeight : undefined,
            fontStyle: typeof args?.fontStyle === 'string' ? args.fontStyle : undefined,
            lineHeight: Number.isFinite(Number(args?.lineHeight)) ? Number(args.lineHeight) : undefined,
          });
          const status = fit.overflowsHeight || fit.overflowsWidth ? 'overflow' : 'fits';
          return {
            name,
            args,
            result: `${name}: ${status} (${fit.lineCount} line${fit.lineCount === 1 ? '' : 's'}, ${fit.height}px tall @ ${fit.fontSize}px${fit.suggestedFontSize ? `, try ${fit.suggestedFontSize}px to fit` : ''}).\n${JSON.stringify(fit).slice(0, 2000)}`,
            error: false,
            data: fit,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_text_fit_report': {
        let html = typeof args?.html === 'string' ? String(args.html) : '';
        if (!html.trim()) {
          const creativeMode = getCreativeMode(sessionId);
          if (creativeMode && creativeMode !== 'design') {
            const result = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'read_html_motion_clip',
              payload: { includeHtml: true },
              timeoutMs: resolveCreativeEditorTimeoutMs(name),
            });
            const resultAny: any = result;
            if (result.success) {
              html = String(resultAny.data?.clip?.html || resultAny.clip?.html || resultAny.data?.html || '');
            }
          }
          if (!html.trim()) {
            return { name, args, result: `${name}: provide html or keep an active HTML motion clip selected before reporting text fit.`, error: true };
          }
        }
        try {
          const report = reportHtmlTextFit(html, {
            stageWidth: Number(args?.stageWidth) || undefined,
            stageHeight: Number(args?.stageHeight) || undefined,
          });
          return {
            name,
            args,
            result: `${name}: ${report.ok ? 'ok' : `${report.overflowCount} overflow finding(s)`} across ${report.measuredNodes} measured node(s).\n${JSON.stringify(report).slice(0, 6000)}`,
            error: false,
            data: report,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_list_html_motion_blocks': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const blocks = listHtmlMotionBlocks({
          category: args?.category,
          query: args?.query,
          packId: args?.packId,
        }, storage);
        return {
          name,
          args,
          result: `${name}: ${blocks.length} HTML motion blocks available.\n${JSON.stringify({ blocks }).slice(0, 5000)}`,
          error: false,
          data: { blocks },
        };
      }

      case 'creative_render_html_motion_block': {
        try {
          const storage = buildCreativeStorageForTool(workspacePath, sessionId);
          const rendered = renderHtmlMotionBlock(String(args?.blockId || '').trim(), args?.inputs && typeof args.inputs === 'object' ? args.inputs : {}, storage);
          return {
            name,
            args,
            result: `${name}: rendered ${rendered.block.name} (${rendered.block.id}).\n${JSON.stringify(rendered).slice(0, 5000)}`,
            error: false,
            data: rendered,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'hyperframes_browse_catalog': {
        const items = getHyperframesCatalog().listHyperframesCatalogItems({
          query: args?.query,
          kind: args?.kind,
          tag: args?.tag,
        });
        const limit = Math.max(1, Math.min(100, Number(args?.limit) || 40));
        const payload = { items: items.slice(0, limit), total: items.length };
        return {
          name,
          args,
          result: `${name}: ${payload.total} catalog item(s) matched.\n${JSON.stringify(payload).slice(0, 6000)}`,
          error: false,
          data: payload,
        };
      }

      case 'hyperframes_insert_clip': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const catalogId = String(args?.catalogId || args?.catalog_id || args?.componentId || args?.component_id || args?.id || '').trim();
        const inputs = mergeHyperframesInputs(args);
        let html = typeof args?.html === 'string' ? String(args.html) : '';
        let imported: any = null;
        let rendered: any = null;
        try {
          if (catalogId) {
            imported = await getHyperframesCatalog().importHyperframesComponentWithIngest(storage, storage, catalogId).catch(async () => getHyperframesCatalog().importHyperframesComponent(storage, catalogId) as any);
            if (imported.importedAs === 'block') {
              rendered = renderHtmlMotionBlock(imported.block.id, inputs, storage);
              html = wrapHyperframesBlockAsDocument(rendered, {
                ...args,
                durationMs: Number(args?.durationMs ?? args?.duration_ms) || rendered?.block?.defaultDurationMs || 6000,
                compositionId: `hyperframes-${imported.item.id}`,
              });
            } else {
              rendered = applyHtmlMotionTemplate(imported.template.id, inputs, storage);
              html = rendered.html;
            }
          }
          if (!html.trim()) {
            return { name, args, result: `${name}: provide catalogId/componentId or raw html.`, error: true };
          }
          const extraction = getHyperframesBridge().extractHyperframesLayers(html);
          const metadata = (() => {
            try { return getHyperframesBridge().parseHyperframesHtml(html).metadata; } catch { return null; }
          })();
          const width = Math.max(120, Number(args?.width) || Number(rendered?.width) || Number((metadata as any)?.resolution?.width) || 1080);
          const height = Math.max(120, Number(args?.height) || Number(rendered?.height) || Number((metadata as any)?.resolution?.height) || 1920);
          const durationMs = Math.max(100, Number(args?.durationMs ?? args?.duration_ms) || Number(rendered?.durationMs) || Number(extraction.durationMs) || 6000);
          const compositionId = extraction.compositionId || catalogId || `hyperframes-${Date.now().toString(36)}`;
          const projectSlug = sanitizeCreativeStorageSegment(compositionId, 'hyperframes-project');
          const projectDir = path.join(storage.rootAbsPath, '.prometheus', 'creative', 'hyperframes-projects', projectSlug);
          fs.mkdirSync(projectDir, { recursive: true });
          const entryFile = 'index.html';
          const entryPath = path.join(projectDir, entryFile);
          fs.writeFileSync(entryPath, getHyperframesBridge().normalizeForHyperframes(html), 'utf8');
          const projectPath = buildCreativeWorkspaceRelativePath(storage.rootAbsPath, projectDir);
          const element = {
            type: 'hyperframes',
            x: Number.isFinite(Number(args?.x)) ? Number(args.x) : 80,
            y: Number.isFinite(Number(args?.y)) ? Number(args.y) : 80,
            width,
            height,
            opacity: 1,
            zIndex: Number.isFinite(Number(args?.zIndex ?? args?.z_index)) ? Number(args?.zIndex ?? args?.z_index) : 10,
            meta: {
              html,
              compositionId,
              projectPath,
              entryFile,
              sourceFormat: 'hyperframes',
              catalogId: catalogId || null,
              advancedBlock: args?.advanced === true || args?.advancedBlock === true || extraction.advancedBlock === true,
              durationMs,
              startMs: Math.max(0, Number(args?.startMs ?? args?.start_ms) || 0),
              layers: extraction.layers,
              slots: extraction.slots,
              variables: extraction.variables,
              variableBindings: extraction.variableBindings,
              assets: Array.isArray(imported?.assets) ? imported.assets : [],
              ingest: imported?.ingest || null,
            },
          };
          const applied = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: 'video',
            command: 'apply_ops',
            payload: {
              ops: [
                ...(args?.replaceScene === true ? [{ op: 'set_canvas', width, height, durationMs }] : []),
                { op: 'add', element },
              ],
            },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_apply_ops'),
          });
          if (!applied.success) {
            return { name, args, result: `${name}: ${applied.error || 'creative editor command failed.'}`, error: true, data: applied };
          }
          const selected = (applied as any).selectedElement || applied.data?.selectedElement || null;
          const payload = {
            clipId: selected?.id || null,
            catalogId: catalogId || null,
            item: imported?.item || null,
            importedAs: imported?.importedAs || (catalogId ? 'unknown' : 'raw-html'),
            width,
            height,
            durationMs,
            layerCount: extraction.layers.length,
            slotCount: extraction.slots.length,
            variableCount: Array.isArray(extraction.variables) ? extraction.variables.length : 0,
            warnings: imported?.warnings || [],
            editor: applied.data || applied,
          };
          return {
            name,
            args,
            result: `${name}: inserted HyperFrames clip${payload.clipId ? ` ${payload.clipId}` : ''} (${payload.layerCount} layers, ${payload.slotCount} slots).\n${JSON.stringify(payload).slice(0, 5000)}`,
            error: false,
            data: payload,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'hyperframes_apply_patch':
      case 'hyperframes_set_text':
      case 'hyperframes_set_color':
      case 'hyperframes_set_timing':
      case 'hyperframes_set_variable':
      case 'hyperframes_set_asset':
      case 'hyperframes_add_animation': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const clipId = String(args?.clipId || args?.clip_id || args?.elementId || args?.element_id || '').trim();
        const layerId = String(args?.layerId || args?.layer_id || args?.hfElementId || args?.hf_element_id || '').trim();
        try {
          const { clip } = await readSelectedHyperframesClipFromEditor(deps, sessionId, creativeMode, clipId, name);
          let ops: HyperframesPatchOp[] = Array.isArray(args?.ops) ? args.ops as HyperframesPatchOp[] : [];
          if (name === 'hyperframes_set_text') {
            if (!layerId) throw new Error('layerId is required.');
            ops = [{ op: 'set-text', elementId: layerId, text: String(args?.text ?? args?.value ?? '') }];
          } else if (name === 'hyperframes_set_color') {
            if (!layerId) throw new Error('layerId is required.');
            ops = [{ op: 'set-color', elementId: layerId, color: String(args?.color || args?.value || '') }];
          } else if (name === 'hyperframes_set_timing') {
            if (!layerId) throw new Error('layerId is required.');
            ops = [{
              op: 'set-timing',
              elementId: layerId,
              startMs: Number.isFinite(Number(args?.startMs ?? args?.start_ms)) ? Number(args?.startMs ?? args?.start_ms) : undefined,
              durationMs: Number.isFinite(Number(args?.durationMs ?? args?.duration_ms)) ? Number(args?.durationMs ?? args?.duration_ms) : undefined,
              zIndex: Number.isFinite(Number(args?.zIndex ?? args?.z_index)) ? Number(args?.zIndex ?? args?.z_index) : undefined,
            }];
          } else if (name === 'hyperframes_set_variable') {
            const variableName = String(args?.name || args?.variable || args?.variableName || '').trim();
            if (!variableName) throw new Error('name/variable is required.');
            ops = [{ op: 'set-variable', name: variableName, value: args?.value }];
          } else if (name === 'hyperframes_set_asset') {
            if (!layerId) throw new Error('layerId is required.');
            const assetId = String(args?.assetId || args?.asset_id || args?.value || '').trim();
            if (!assetId) throw new Error('assetId is required.');
            ops = [{ op: 'set-asset', elementId: layerId, assetPlaceholderId: assetId }];
          } else if (name === 'hyperframes_add_animation') {
            const animation = args?.animation && typeof args.animation === 'object' ? args.animation : args;
            ops = [{ op: 'add-animation', animation } as HyperframesPatchOp];
          }
          if (!ops.length) throw new Error('ops are required.');
          const patched = await patchHyperframesClipInEditor({ deps, sessionId, creativeMode, clip, ops });
          const payload = {
            clipId: clip.id,
            warnings: patched.patched.warnings,
            layerCount: patched.extraction.layers.length,
            slotCount: patched.extraction.slots.length,
            variableCount: Array.isArray(patched.extraction.variables) ? patched.extraction.variables.length : 0,
            layers: patched.extraction.layers.slice(0, 40),
            slots: patched.extraction.slots,
            variables: patched.extraction.variables,
          };
          return {
            name,
            args,
            result: `${name}: patched HyperFrames clip ${clip.id} (${ops.length} op${ops.length === 1 ? '' : 's'}).\n${JSON.stringify(payload).slice(0, 5000)}`,
            error: false,
            data: payload,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'hyperframes_lint':
      case 'hyperframes_qa':
      case 'hyperframes_materialize':
      case 'hyperframes_export': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        try {
          if (name === 'hyperframes_export') {
            let html = typeof args?.html === 'string' ? String(args.html) : '';
            let clip: any = null;
            if (!html.trim()) {
              const clipId = String(args?.clipId || args?.clip_id || args?.elementId || args?.element_id || '').trim();
              try {
                const read = await readSelectedHyperframesClipFromEditor(deps, sessionId, creativeMode, clipId, name);
                clip = read.clip;
                html = String(clip?.meta?.html || '');
              } catch (selectionErr: any) {
                const activeRead = await sendCreativeCommand(deps.broadcastWS, {
                  sessionId,
                  mode: creativeMode,
                  command: 'read_html_motion_clip',
                  payload: { includeHtml: true },
                  timeoutMs: resolveCreativeEditorTimeoutMs('creative_read_html_motion_clip'),
                });
                const activeAny: any = activeRead;
                const activeClip = activeAny?.data?.clip || activeAny?.clip || null;
                const activeHtml = String(activeAny?.data?.clip?.html || activeAny?.clip?.html || activeAny?.data?.html || '');
                const looksMaterializedHyperframes = /data-runtime-source=["']hyperframes-core["']|data-prometheus-hyperframes-runtime|HyperFrames Materialized|data-hf-authored-duration/i
                  .test(`${activeHtml}\n${activeClip?.title || ''}\n${activeClip?.path || ''}`);
                if (activeRead.success && activeHtml.trim() && looksMaterializedHyperframes) {
                  clip = {
                    id: String(activeClip?.id || args?.clipId || args?.clip_id || 'active-html-motion-hyperframes'),
                    width: Number(activeClip?.width) || Number(args?.width) || 1080,
                    height: Number(activeClip?.height) || Number(args?.height) || 1920,
                    timing: { durationMs: Number(activeClip?.durationMs) || Number(args?.durationMs ?? args?.duration_ms) || 6000 },
                    meta: {
                      html: activeHtml,
                      compositionId: String(activeClip?.composition?.compositionId || args?.compositionId || args?.composition_id || '').trim(),
                      durationMs: Number(activeClip?.durationMs) || Number(args?.durationMs ?? args?.duration_ms) || 6000,
                      variableBindings: [],
                    },
                  };
                  html = activeHtml;
                } else {
                  throw selectionErr;
                }
              }
            }
            if (!html.trim()) {
              return { name, args, result: `${name}: selected HyperFrames clip has no HTML source to export.`, error: true };
            }
            const storage = buildCreativeStorageForTool(workspacePath, sessionId);
            const durationMs = Math.max(1000, Number(args?.durationMs ?? args?.duration_ms) || Number(clip?.meta?.durationMs) || Number(clip?.timing?.durationMs) || 6000);
            const width = Math.max(320, Number(args?.width) || Number(clip?.width) || 1080);
            const height = Math.max(320, Number(args?.height) || Number(clip?.height) || 1920);
            const htmlCompositionId = /\bdata-composition-id\s*=\s*(["'])(.*?)\1/i.exec(html)?.[2] || '';
            const compositionId = String(clip?.meta?.compositionId || args?.compositionId || args?.composition_id || htmlCompositionId || 'hyperframes-clip').trim() || 'hyperframes-clip';
            const clipId = String(clip?.id || args?.clipId || args?.clip_id || args?.elementId || args?.element_id || 'hyperframes-clip').trim();
            const formatRaw = String(args?.format || 'mp4').toLowerCase();
            const format = (['mp4', 'webm', 'mov', 'png-sequence'].includes(formatRaw) ? formatRaw : 'mp4') as any;
            const fpsRaw = Number(args?.fps ?? args?.frameRate ?? args?.frame_rate) || 30;
            const fps = ([24, 30, 60].includes(fpsRaw) ? fpsRaw : 30) as any;
            const qualityRaw = String(args?.quality || 'standard').toLowerCase();
            const quality = (['draft', 'standard', 'high'].includes(qualityRaw) ? qualityRaw : 'standard') as any;
            const requestedEngine = String(args?.renderer || args?.engine || '').toLowerCase();
            const useHtmlMotionFallback = requestedEngine === 'html-motion'
              || requestedEngine === 'html_motion'
              || args?.producer === false;
            let producerFailure: { name: string; message: string } | null = null;
            if (!useHtmlMotionFallback) {
              const safeBase = sanitizeCreativeStorageSegment(compositionId, 'hyperframes-clip');
              const extension = format === 'png-sequence' ? '' : `.${format}`;
              const filename = sanitizeCreativeStorageSegment(String(args?.filename || `${safeBase}-hyperframes${extension}`), `${safeBase}-hyperframes${extension}`);
              const outputPath = path.join(storage.rootAbsPath, '.prometheus', 'creative', 'exports', filename);
              const variables = args?.variables && typeof args.variables === 'object' && !Array.isArray(args.variables)
                ? args.variables
                : {};
              if (!Object.keys(variables).length) {
                for (const binding of Array.isArray(clip?.meta?.variableBindings) ? clip.meta.variableBindings : []) {
                  const id = String(binding?.variable?.id || '').trim();
                  if (id) (variables as any)[id] = binding.currentValue;
                }
              }
              try {
                const rendered = await getHyperframesProducer().renderHyperframesWithProducer({
                  html,
                  workspacePath: storage.rootAbsPath,
                  outputPath,
                  compositionId,
                  fps,
                  quality,
                  format,
                  workers: Math.max(1, Math.min(4, Math.round(Number(args?.workers) || 1))),
                  timeoutMs: Math.max(
                    30_000,
                    Math.min(
                      15 * 60_000,
                      Math.round(Number(args?.producerTimeoutMs ?? args?.producer_timeout_ms ?? args?.timeoutMs ?? args?.timeout_ms) || 120_000),
                    ),
                  ),
                  variables,
                  debug: args?.debug === true,
                });
                return {
                  name,
                  args,
                  result: `${name}: exported HyperFrames with @hyperframes/producer to ${buildCreativeWorkspaceRelativePath(storage.rootAbsPath, rendered.outputPath)}.\n${JSON.stringify({ outputPath: rendered.outputPath, projectDir: rendered.projectDir, job: rendered.job }).slice(0, 5000)}`,
                  error: false,
                  data: {
                    engine: '@hyperframes/producer',
                    outputPath: rendered.outputPath,
                    outputRelPath: buildCreativeWorkspaceRelativePath(storage.rootAbsPath, rendered.outputPath),
                    projectDir: rendered.projectDir,
                    entryFile: rendered.entryFile,
                    job: rendered.job,
                  },
                };
              } catch (err: any) {
                producerFailure = {
                  name: err?.name || 'HyperframesProducerError',
                  message: err?.message || String(err || 'producer render failed'),
                };
                const fallbackDisabled = args?.fallback === false
                  || args?.fallbackToHtmlMotion === false
                  || args?.fallback_to_html_motion === false;
                if (fallbackDisabled) {
                  return {
                    name,
                    args,
                    result: `${name}: @hyperframes/producer export failed: ${producerFailure.message}`,
                    error: true,
                    data: { engine: '@hyperframes/producer', producerFailure },
                  };
                }
              }
            }
            const built = getHyperframesExportAdapter().buildHyperframesRenderClip(
              { id: clipId, type: 'hyperframes', meta: { html, compositionId } },
              storage.rootAbsPath,
              {
                startMs: 0,
                endMs: durationMs,
                trimStartMs: Number(args?.trimStartMs ?? args?.trim_start_ms) || 0,
              },
            );
            const materializedHtml = fs.readFileSync(built.materialized.absClipPath, 'utf-8');
            const safeBase = compositionId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'hyperframes-clip';
            const created = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'create_html_motion_clip',
              payload: {
                title: `${compositionId} HyperFrames Export`,
                filename: `${safeBase}-hyperframes-materialized.html`,
                html: materializedHtml,
                width,
                height,
                durationMs,
                frameRate: fps,
                assets: [],
                updateScene: false,
                render: false,
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_create_html_motion_clip'),
            });
            if (!created.success) {
              return {
                name,
                args,
                result: `${name}: materialized HyperFrames clip, but could not create exportable HTML Motion clip: ${created.error || 'unknown error'}`,
                error: true,
                data: { materialized: built, created },
              };
            }
            const createdClip = created.data?.clip || created.data?.data?.clip || created.data?.source?.clip || null;
            const exportPath = String(createdClip?.path || createdClip?.htmlPath || `${storage.rootRelPath}/prometheus-creative/html-motion/${safeBase}-hyperframes-materialized.html`);
            const exported = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'export_html_motion_clip',
              payload: {
                path: exportPath,
                format: args?.format || 'mp4',
                filename: args?.filename || `${safeBase}-hyperframes.mp4`,
                width,
                height,
                durationMs,
                frameRate: fps,
                perFrameTimeoutMs: Number(args?.perFrameTimeoutMs ?? args?.per_frame_timeout_ms) || 45_000,
                maxFrames: Number(args?.maxFrames ?? args?.max_frames) || undefined,
                forceHighFps: args?.forceHighFps === true || args?.force_high_fps === true,
                workspaceOnly: args?.workspaceOnly !== false,
                download: args?.download === true,
                force: args?.force === true,
                skipSpatialQa: args?.skipSpatialQa === true,
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_export_html_motion_clip'),
            });
            return {
              name,
              args,
              result: exported.success
                ? `${name}: ${producerFailure ? `@hyperframes/producer failed (${producerFailure.message}); ` : ''}materialized and exported HyperFrames through the HTML Motion renderer.\n${JSON.stringify({ producerFailure, materialized: built, created: created.data, exported: exported.data || exported }).slice(0, 5000)}`
                : `${name}: ${producerFailure ? `@hyperframes/producer failed (${producerFailure.message}); ` : ''}materialized HyperFrames, but HTML Motion export failed: ${exported.error || 'export failed.'}`,
              error: !exported.success,
              data: { producerFailure, materialized: built, created, exported },
            };
          }
          let html = typeof args?.html === 'string' ? String(args.html) : '';
          let clip: any = null;
          if (!html.trim()) {
            const clipId = String(args?.clipId || args?.clip_id || args?.elementId || args?.element_id || '').trim();
            const read = await readSelectedHyperframesClipFromEditor(deps, sessionId, creativeMode, clipId, name);
            clip = read.clip;
            html = String(clip?.meta?.html || '');
          }
          if (name === 'hyperframes_lint') {
            const lint = getHyperframesBridge().lintHyperframes(html);
            return {
              name,
              args,
              result: `${name}: ${((lint as any).valid === false || (lint as any).ok === false) ? 'blocked' : 'ok'}.\n${JSON.stringify(lint).slice(0, 5000)}`,
              error: false,
              data: lint,
            };
          }
          if (name === 'hyperframes_qa') {
            const report = await getHyperframesQa().runHyperframesQa(html, {
              width: Number(args?.width) || Number(clip?.width) || undefined,
              height: Number(args?.height) || Number(clip?.height) || undefined,
              durationMs: Number(args?.durationMs ?? args?.duration_ms) || Number(clip?.meta?.durationMs) || undefined,
              samplePoints: Array.isArray(args?.samplePoints) ? args.samplePoints.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : undefined,
              timeoutMs: Number(args?.timeoutMs ?? args?.timeout_ms) || undefined,
            });
            return {
              name,
              args,
              result: `${name}: ${report.ok ? 'ok' : 'needs fixes'} (${report.samples.length} sample frames, ${report.networkErrors.length} network errors, ${report.consoleErrors.length} console errors).\n${JSON.stringify(report).slice(0, 5000)}`,
              error: false,
              data: report,
            };
          }
          const clipId = String(clip?.id || args?.clipId || args?.clip_id || args?.elementId || args?.element_id || 'hyperframes-clip').trim();
          const built = getHyperframesExportAdapter().buildHyperframesRenderClip(
            { id: clipId, type: 'hyperframes', meta: { html, compositionId: clip?.meta?.compositionId || args?.compositionId } },
            workspacePath,
            {
              startMs: Number(args?.startMs ?? args?.start_ms) || 0,
              endMs: Number(args?.endMs ?? args?.end_ms) || Number(args?.durationMs ?? args?.duration_ms) || Number(clip?.meta?.durationMs) || 6000,
              trimStartMs: Number(args?.trimStartMs ?? args?.trim_start_ms) || 0,
            },
          );
          let activated: any = null;
          const shouldActivateMaterialized = args?.activate === true
            || args?.activateHtmlMotion === true
            || args?.activate_html_motion === true;
          const shouldReplaceCanvasWithMaterialized = args?.replaceCanvas === true
            || args?.replace_canvas === true
            || args?.updateScene === true
            || args?.update_scene === true;
          if (name === 'hyperframes_materialize' && shouldActivateMaterialized) {
            const materializedHtml = fs.readFileSync(built.materialized.absClipPath, 'utf-8');
            const safeBase = sanitizeCreativeStorageSegment(built.materialized.compositionId, 'hyperframes-clip');
            activated = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: 'video',
              command: 'create_html_motion_clip',
              payload: {
                title: `${built.materialized.compositionId} HyperFrames Materialized`,
                filename: `${safeBase}-hyperframes-materialized.html`,
                html: materializedHtml,
                width: Number(args?.width) || Number(clip?.width) || 1080,
                height: Number(args?.height) || Number(clip?.height) || 1920,
                durationMs: Number(args?.durationMs ?? args?.duration_ms) || Number(clip?.meta?.durationMs) || 6000,
                frameRate: Number(args?.frameRate ?? args?.frame_rate) || 60,
                assets: [],
                updateScene: shouldReplaceCanvasWithMaterialized,
                activate: shouldReplaceCanvasWithMaterialized,
                render: false,
              },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_create_html_motion_clip'),
            });
          }
          return {
            name,
            args,
            result: `${name}: materialized HyperFrames clip ${built.id} at ${built.materialized.clipPath}${activated ? (shouldReplaceCanvasWithMaterialized ? ' and replaced the current canvas with an HTML Motion clip' : ' and saved an HTML Motion copy without replacing the current canvas') : ''}.\n${JSON.stringify({ ...built, activated }).slice(0, 4000)}`,
            error: activated ? !activated.success : false,
            data: activated ? { ...built, activated } : built,
          };
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'creative_apply_hyperframes_component': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const componentId = String(args?.componentId || args?.id || '').trim();
        if (!componentId) {
          return { name, args, result: `${name}: componentId is required.`, error: true };
        }
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let imported;
        try {
          imported = await getHyperframesCatalog().importHyperframesComponent(storage, componentId);
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
        if (imported.importedAs === 'block') {
          try {
            const rendered = renderHtmlMotionBlock(imported.block.id, args?.inputs && typeof args.inputs === 'object' ? args.inputs : {}, storage);
            return {
              name,
              args,
              result: `${name}: imported and rendered HyperFrames block ${imported.item.name} (${imported.block.id}). Use creative_patch_html_motion_clip to insert the returned snippets into an active HTML motion clip.\n${JSON.stringify({ rendered, assets: imported.assets, warnings: imported.warnings }).slice(0, 5000)}`,
              error: false,
              data: { imported, rendered },
            };
          } catch (err: any) {
            return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true, data: imported };
          }
        }
        let rendered;
        try {
          rendered = applyHtmlMotionTemplate(imported.template.id, args?.inputs && typeof args.inputs === 'object' ? args.inputs : {}, storage);
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true, data: imported };
        }
        const payload = {
          html: rendered.html,
          title: String(args?.title || rendered.title || imported.item.name || ''),
          filename: String(args?.filename || ''),
          width: Number(args?.width) || rendered.width,
          height: Number(args?.height) || rendered.height,
          durationMs: Number(args?.durationMs) || rendered.durationMs,
          frameRate: Number(args?.frameRate) || rendered.frameRate,
          assets: [
            ...imported.assets,
            ...(Array.isArray(args?.assets) ? args.assets : []),
          ],
        };
        const result = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: 'video',
          command: 'create_html_motion_clip',
          payload,
          timeoutMs: resolveCreativeEditorTimeoutMs('creative_create_html_motion_clip'),
        });
        const summary = result.success
          ? `${name}: applied HyperFrames component ${imported.item.name} (${imported.template.id}) as an HTML motion clip.`
          : `${name}: ${result.error || 'creative editor command failed.'}`;
        return {
          name,
          args,
          result: result.success && result.data
            ? `${summary}\n${JSON.stringify({ template: rendered.template, assets: imported.assets, warnings: imported.warnings, ...result.data }).slice(0, 5000)}`
            : summary,
          error: !result.success,
          data: { imported, template: rendered.template, ...result },
        };
      }

      case 'creative_apply_html_motion_template': {
        const creativeMode = getCreativeMode(sessionId) === 'video' ? 'video' : (setCreativeMode(sessionId, 'video') || 'video');
        const templateId = String(args?.templateId || '').trim();
        if (!templateId) {
          return { name, args, result: `${name}: templateId is required.`, error: true };
        }
        let rendered;
        try {
          const reservedInputKeys = new Set([
            'templateId',
            'input',
            'inputs',
            'filename',
            'width',
            'height',
            'durationMs',
            'frameRate',
            'assets',
          ]);
          const topLevelInputs = Object.fromEntries(Object.entries(args || {})
            .filter(([key, value]) => !reservedInputKeys.has(key)
              && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
            .map(([key, value]) => [key, String(value)]));
          const explicitInputs = (args?.input && typeof args.input === 'object' && !Array.isArray(args.input)) ? args.input : {};
          const pluralInputs = (args?.inputs && typeof args.inputs === 'object' && !Array.isArray(args.inputs)) ? args.inputs : {};
          const inputs = {
            ...topLevelInputs,
            ...explicitInputs,
            ...pluralInputs,
          } as Record<string, string>;
          if (!inputs.durationSec && Number.isFinite(Number(args?.durationMs)) && Number(args.durationMs) > 0) {
            inputs.durationSec = String(Math.max(0.1, Number(args.durationMs) / 1000));
          }
          const storage = buildCreativeStorageForTool(workspacePath, sessionId);
          rendered = applyHtmlMotionTemplate(templateId, inputs, storage);
        } catch (err: any) {
          return { name, args, result: `${name}: ${err?.message || String(err)}`, error: true };
        }
        const payload = {
          html: rendered.html,
          title: String(args?.title || rendered.title || ''),
          filename: String(args?.filename || ''),
          width: Number(args?.width) || rendered.width,
          height: Number(args?.height) || rendered.height,
          durationMs: Number(args?.durationMs) || rendered.durationMs,
          frameRate: Number(args?.frameRate) || rendered.frameRate,
          assets: Array.isArray(args?.assets) ? args.assets : [],
        };
        const result = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: 'video',
          command: 'create_html_motion_clip',
          payload,
          timeoutMs: resolveCreativeEditorTimeoutMs('creative_create_html_motion_clip'),
        });
        let textFit: any = null;
        try {
          textFit = reportHtmlTextFit(rendered.html, {
            stageWidth: payload.width || undefined,
            stageHeight: payload.height || undefined,
          });
        } catch { /* heuristic best-effort */ }
        const overflowSummary = textFit && !textFit.ok
          ? ` Pretext flagged ${textFit.overflowCount} text-fit warning(s) — run creative_text_fit_report for details.`
          : '';
        const summary = result.success
          ? `${name}: applied template ${rendered.template.name} (${templateId}) as HTML motion clip.${overflowSummary}`
          : `${name}: ${result.error || 'creative editor command failed.'}`;
        return {
          name,
          args,
          result: result.success && result.data
            ? `${summary}\n${JSON.stringify({ template: rendered.template, textFit, ...result.data }).slice(0, 4000)}`
            : summary,
          error: !result.success,
          data: { template: rendered.template, textFit, ...result },
        };
      }

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
      case 'creative_composition_render': {
        const currentCreativeMode = getCreativeMode(sessionId);
        const creativeMode = currentCreativeMode && currentCreativeMode !== 'design'
          ? currentCreativeMode
          : (setCreativeMode(sessionId, 'video') || 'video');
        if (creativeMode === 'video') {
          if (VIDEO_MODE_REMOVED_SCENE_TOOL_NAMES.has(name)) {
            return videoModeHtmlMotionOnlyError(name, args);
          }
          if (name === 'creative_composition_add_clip' && isLegacySceneGraphCompositionPayload(args)) {
            return videoModeHtmlMotionOnlyError(name, args);
          }
        }
          const commandByTool: Record<string, string> = {
          creative_get_state: 'get_state',
          creative_reset_scene: 'reset_scene',
          creative_purge_scene: 'purge_scene',
          creative_element_inventory: 'element_inventory',
          creative_frame_trace: 'frame_trace',
          creative_frame_diff: 'frame_diff',
          creative_history_status: 'history_status',
          creative_undo: 'undo',
          creative_redo: 'redo',
          creative_checkpoint: 'checkpoint',
          creative_export_trace: 'export_trace',
          video_render_frame: 'render_snapshot',
          video_render_contact_sheet: 'render_snapshot',
          video_analyze_frame: 'render_snapshot',
          video_analyze_timeline: 'video_analyze_timeline',
          video_check_keyframes: 'video_check_keyframes',
          video_check_caption_timing: 'video_check_caption_timing',
          video_check_audio_sync: 'video_check_audio_sync',
          video_extract_clip_frames: 'render_snapshot',
          image_get_element_at_point: 'image_get_element_at_point',
          image_get_overlaps: 'image_get_overlaps',
          image_get_bounds_summary: 'image_get_bounds_summary',
          image_check_text_overflow: 'image_check_text_overflow',
          image_check_contrast: 'image_check_contrast',
          image_detect_empty_regions: 'image_detect_empty_regions',
          creative_apply_ops: 'apply_ops',
          creative_select_element: 'select_element',
          creative_set_canvas: 'set_canvas',
          creative_add_element: 'add_element',
          creative_add_asset: 'add_asset',
          creative_add_effect: 'apply_ops',
          creative_set_blend_mode: 'apply_ops',
          creative_add_mask: 'apply_ops',
          creative_trim_clip: 'apply_ops',
          creative_apply_brand_kit: 'apply_ops',
          creative_search_icons: 'search_icons',
          creative_search_animations: 'search_animations',
        creative_update_element: 'update_element',
          creative_delete_element: 'delete_element',
          creative_apply_animation: 'apply_animation',
          creative_arrange: 'arrange',
          creative_apply_style: 'apply_style',
          creative_fit_asset: 'fit_asset',
          creative_apply_template: 'apply_template',
          creative_validate_layout: 'validate_layout',
          creative_quality_report: 'quality_report',
          creative_create_html_motion_clip: 'create_html_motion_clip',
          creative_read_html_motion_clip: 'read_html_motion_clip',
          creative_patch_html_motion_clip: 'patch_html_motion_clip',
          creative_restore_html_motion_revision: 'restore_html_motion_revision',
          creative_render_html_motion_snapshot: 'render_html_motion_snapshot',
          creative_export_html_motion_clip: 'export_html_motion_clip',
          creative_apply_motion_template: 'apply_motion_template',
          creative_timeline: 'timeline',
          creative_render_snapshot: 'render_snapshot',
          creative_export: 'export',
          creative_save_scene: 'save_scene',
          creative_composition_get: 'composition_get',
          creative_composition_add_track: 'composition_add_track',
          creative_composition_add_clip: 'composition_add_clip',
          creative_composition_move_clip: 'composition_move_clip',
          creative_composition_trim_clip: 'composition_trim_clip',
          creative_composition_split_at: 'composition_split_at',
          creative_composition_delete_clip: 'composition_delete_clip',
          creative_composition_set_transition: 'composition_set_transition',
          creative_composition_select_clip: 'composition_select_clip',
          creative_composition_lint: 'composition_lint',
          creative_composition_save: 'composition_save',
          creative_composition_render: 'composition_render',
        };
        const renderAliasPayload = (() => {
          if (name === 'video_render_contact_sheet') {
            return {
              ...(args || {}),
              includeDataUrl: true,
              contactSheet: true,
              sampleTimesMs: Array.isArray(args?.sampleTimesMs) && args.sampleTimesMs.length
                ? args.sampleTimesMs
                : undefined,
            };
          }
          if (name === 'video_extract_clip_frames') {
            return {
              ...(args || {}),
              includeDataUrl: true,
              sampleEveryFrame: args?.sampleEveryFrame === true,
              frameStepMs: args?.sampleEveryFrame === true ? undefined : (args?.frameStepMs ?? 250),
            };
          }
          if (name === 'video_render_frame' || name === 'video_analyze_frame') {
            return { ...(args || {}), includeDataUrl: true };
          }
          if (name === 'creative_add_effect') {
            return {
              ops: [{
                op: 'add-effect',
                id: String(args?.id || '').trim(),
                effect: {
                  type: args?.type,
                  startMs: args?.startMs,
                  durationMs: args?.durationMs,
                  params: args?.params || {},
                  enabled: args?.enabled !== false,
                },
              }],
            };
          }
          if (name === 'creative_set_blend_mode') {
            return {
              ops: [{
                op: 'set-blend-mode',
                id: String(args?.id || '').trim(),
                blendMode: args?.blendMode,
              }],
            };
          }
          if (name === 'creative_add_mask') {
            return {
              ops: [{
                op: 'set-mask',
                id: String(args?.id || '').trim(),
                mask: args?.mask || {},
              }],
            };
          }
          if (name === 'creative_trim_clip') {
            return {
              ops: [{
                op: 'set-clip',
                id: String(args?.id || '').trim(),
                patch: {
                  startMs: args?.startMs,
                  endMs: args?.endMs,
                  durationMs: args?.durationMs,
                  trimStartMs: args?.trimStartMs,
                  trimEndMs: args?.trimEndMs,
                  speed: args?.speed,
                  loop: args?.loop,
                },
              }],
            };
          }
          if (name === 'creative_apply_brand_kit') {
            return {
              ops: [{
                op: args?.applyToScene === false ? 'set-brand-kit' : 'apply-brand-kit',
                brandKit: args?.brandKit || {},
              }],
            };
          }
          return null;
        })();
        if (creativeMode === 'video' && name === 'creative_export') {
          const quality = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'quality_report',
            payload: {},
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_quality_report'),
          });
          const qualityData: any = (quality as any)?.data || quality || {};
          const ship = qualityData?.ship;
          const ok = qualityData?.ok;
          if ((quality as any)?.success && (ship === false || ok === false)) {
            const findings = Array.isArray(qualityData?.findings)
              ? qualityData.findings.slice(0, 6).map((f: any) => `- ${String(f?.message || f?.title || f || '').trim()}`).join('\n')
              : '';
            return {
              name,
              args,
              result: [
                'Blocked export: creative_quality_report returned no-ship.',
                `score: ${qualityData?.score ?? 'unknown'}`,
                findings ? `findings:\n${findings}` : 'Run render/quality tools, fix the clip, then export again.',
              ].join('\n'),
              error: true,
              data: { quality: qualityData },
            };
          }
        }
        const result = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: creativeMode,
          command: commandByTool[name] || name,
          payload: renderAliasPayload || (name === 'creative_render_snapshot'
            ? { ...(args || {}), includeDataUrl: true }
            : (args || {})),
          timeoutMs: resolveCreativeEditorTimeoutMs(name, renderAliasPayload || args),
        });
        if (result.success && name === 'creative_get_state') {
          let renderResult = result;
          const durationMs = Number(result.data?.scene?.durationMs || result.sceneSummary?.durationMs || 0);
          const sampleTimesMs = creativeMode === 'video'
            ? [0, Math.round(Math.max(1000, durationMs || 8000) / 2), Math.max(0, Math.round((durationMs || 8000) - 250))]
            : undefined;
          renderResult = await sendCreativeCommand(deps.broadcastWS, {
            sessionId,
            mode: creativeMode,
            command: 'render_snapshot',
            payload: {
              includeDataUrl: true,
              ...(sampleTimesMs ? { sampleTimesMs } : { atMs: 0 }),
            },
            timeoutMs: resolveCreativeEditorTimeoutMs('creative_render_snapshot'),
          });
          if (renderResult?.success) {
            result.data = {
              ...(result.data || {}),
              creativeVisionFrames: renderResult.data?.frames || [],
              visualReviewSource: 'direct_frame_injection',
            };
            if (Array.isArray(renderResult?.snapshots)) result.snapshots = renderResult.snapshots;
            if (renderResult?.snapshot) result.snapshot = renderResult.snapshot;
          }
        }
        if (result.success && name === 'creative_quality_report' && creativeMode === 'video') {
          try {
            const clipRead = await sendCreativeCommand(deps.broadcastWS, {
              sessionId,
              mode: creativeMode,
              command: 'read_html_motion_clip',
              payload: { includeHtml: true },
              timeoutMs: resolveCreativeEditorTimeoutMs('creative_read_html_motion_clip'),
            });
            const clipAny: any = clipRead;
            const html = String(clipAny?.data?.clip?.html || clipAny?.clip?.html || clipAny?.data?.html || '');
            if (html) {
              const stage = result.data?.scene || result.sceneSummary || {};
              const textFit = reportHtmlTextFit(html, {
                stageWidth: Number(stage?.width) || undefined,
                stageHeight: Number(stage?.height) || undefined,
              });
              result.data = { ...(result.data || {}), textFit };
            }
          } catch { /* best-effort */ }
        }
        const summary = result.success
          ? `${name}: creative editor command succeeded.${result.data?.textFit && !result.data.textFit.ok ? ` Pretext flagged ${result.data.textFit.overflowCount} text-fit warning(s).` : ''}`
          : `${name}: ${result.error || 'creative editor command failed.'}`;
        if ((name === 'creative_export' || name === 'creative_export_html_motion_clip') && result.success) {
          await maybeSendCreativeExportToTelegram(sessionId, result.data?.data || result.data, deps.telegramChannel).catch(() => undefined);
          if (creativeMode === 'video') {
            result.data = {
              ...(result.data || {}),
              videoReviewSource: 'direct_frame_review_required',
              nextSelfReview:
                'Use creative_render_snapshot with sampleEveryFrame or sampleTimesMs to inject rendered video frames directly into the next model step.',
            };
          }
        }
        return {
          name,
          args,
          result: result.success && result.data
            ? `${summary}\n${JSON.stringify(result.data).slice(0, 4000)}`
            : summary,
          error: !result.success,
          data: result,
        };
      }

      case 'business_context_mode': {
        const action = String(args?.action || '').trim().toLowerCase();
        if (action !== 'enable' && action !== 'disable' && action !== 'status') {
          return { name, args, result: 'business_context_mode: action must be "enable", "disable", or "status"', error: true };
        }

        const fileExists = fs.existsSync(path.join(workspacePath, 'BUSINESS.md'));
        if (action === 'status') {
          const enabled = isBusinessContextEnabled(sessionId);
          return {
            name,
            args,
            result: [
              `BUSINESS.md auto-injection is currently ${enabled ? 'ENABLED' : 'DISABLED'} for session ${sessionId}.`,
              `BUSINESS.md ${fileExists ? 'is present in the workspace.' : 'is not present in the workspace.'}`,
              enabled
                ? 'BUSINESS.md will continue to be injected on later turns until you disable it.'
                : 'Use business_context_mode({"action":"enable"}) if you need persistent business context.',
            ].join('\n'),
            error: false,
          };
        }

        const enabled = setBusinessContextEnabled(sessionId, action === 'enable');
        if (!enabled) {
          return {
            name,
            args,
            result: `BUSINESS.md auto-injection disabled for session ${sessionId}. Future turns will not receive [BUSINESS] unless you enable it again.`,
            error: false,
          };
        }

        const snapshot = loadBusinessContextSnapshot(workspacePath);
        const snapshotBlock = snapshot
          ? `\n\n[BUSINESS]\n${snapshot}`
          : '\n\nBUSINESS.md was not found in the workspace, so nothing can be injected yet.';
        return {
          name,
          args,
          result: `BUSINESS.md auto-injection enabled for session ${sessionId}. Future turns in this session will receive [BUSINESS] context.${snapshotBlock}`,
          error: false,
        };
      }

      case 'list_entities': {
        try {
          const rows = listEntities(workspacePath, args?.type);
          return { name, args, result: JSON.stringify({ count: rows.length, entities: rows }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `list_entities failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'read_entity': {
        try {
          const entity = readEntity(workspacePath, args?.type, args?.id);
          return { name, args, result: JSON.stringify(entity.summary, null, 2) + `\n\n${entity.content}`, error: false };
        } catch (err: any) {
          return { name, args, result: `read_entity failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'write_entity': {
        try {
          const out = writeEntity(workspacePath, args?.type, args?.id, args?.content);
          return {
            name,
            args,
            result: `${out.created ? 'Created' : 'Updated'} entity ${out.summary.type}/${out.summary.id} at ${out.summary.path}`,
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `write_entity failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'append_entity_event': {
        try {
          const out = appendEntityEvent(workspacePath, args?.type, args?.id, args?.event, {
            displayName: args?.display_name || args?.displayName,
            source: args?.source,
            confidence: args?.confidence,
          });
          return {
            name,
            args,
            result: `${out.created ? 'Created' : 'Updated'} entity ${out.summary.type}/${out.summary.id} at ${out.summary.path}\n${out.appended}`,
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `append_entity_event failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'social_intel': {
        const tr = await socialIntelTool.execute(args) as any;
        const resultStr = tr?.stdout ?? tr?.error ?? JSON.stringify(tr);
        return { name, args, result: resultStr, error: tr?.success === false };
      }

      case 'web_search': {
        const result = await webSearch(args.query || '', {
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          multi_engine: typeof args.multi_engine === 'boolean' ? args.multi_engine : undefined,
          provider: args.provider != null ? String(args.provider).toLowerCase() as any : undefined,
        });
        return { name, args, result, error: false };
      }

      case 'web_search_single': {
        const result = await webSearch(args.query || '', {
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          multi_engine: false,
          provider: args.provider != null ? String(args.provider).toLowerCase() as any : undefined,
        });
        return { name, args, result, error: false };
      }

      case 'web_search_multi': {
        const result = await webSearch(args.query || '', {
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          provider: 'multi' as any,
        });
        return { name, args, result, error: false };
      }

      case 'shopping_search_products': {
        const tr = await executeShoppingSearchProducts({
          query: args.query || '',
          merchant: args.merchant != null ? String(args.merchant) : undefined,
          max_results: args.max_results != null ? Number(args.max_results) : undefined,
          provider: args.provider != null ? String(args.provider).toLowerCase() as any : undefined,
          include_metadata: typeof args.include_metadata === 'boolean' ? args.include_metadata : undefined,
          include_images: typeof args.include_images === 'boolean' ? args.include_images : undefined,
          metadata_timeout_ms: args.metadata_timeout_ms != null ? Number(args.metadata_timeout_ms) : undefined,
          image_timeout_ms: args.image_timeout_ms != null ? Number(args.image_timeout_ms) : undefined,
        }) as any;
        return {
          name,
          args,
          result: tr?.stdout || tr?.error || JSON.stringify(tr || {}),
          error: tr?.success === false,
          data: tr?.data,
          extra: tr?.extra,
        };
      }

		      case 'web_fetch': {
		        const url = args.url || '';
		        {
		          let extractionAction = 'Extracting Media';
		          let analysisAction = 'Analyzing Media';
		          const normalizePhaseAction = (message: string, fallback: string): string => {
		            const cleaned = String(message || '').trim().replace(/[.]{3}\s*$/, '');
		            return cleaned || fallback;
		          };
		          const emitSyntheticToolCall = (action: string) => {
		            deps.sendSSE?.('tool_call', {
		              action,
		              synthetic: true,
		              actor: 'web_fetch',
		            });
		          };
		          const emitSyntheticToolResult = (action: string, resultText: string, error = false) => {
		            deps.sendSSE?.('tool_result', {
		              action,
		              result: resultText,
		              error,
		              synthetic: true,
		              actor: 'web_fetch',
		              show_result: true,
		            });
		          };
		          const webFetchResult = await executeWebFetch({ url, max_chars: args.max_chars }, (event) => {
		            switch (event.phase) {
		              case 'fetch_complete':
		                emitSyntheticToolResult('web_fetch', event.message);
		                break;
		              case 'extracting_media':
		                extractionAction = normalizePhaseAction(event.message, extractionAction);
		                emitSyntheticToolCall(extractionAction);
		                break;
		              case 'extraction_complete':
		                emitSyntheticToolResult(extractionAction, event.message);
		                break;
		              case 'analyzing_media':
		                analysisAction = normalizePhaseAction(event.message, analysisAction);
		                emitSyntheticToolCall(analysisAction);
		                break;
		              case 'analysis_complete':
		              case 'analysis_skipped':
		                emitSyntheticToolResult(analysisAction, event.message);
		                break;
		              default:
		                deps.sendSSE?.('info', { message: event.message });
		                break;
		            }
		          });
		          let result = webFetchResult.success
		            ? (webFetchResult.stdout || `Fetched ${url} but no content extracted.`)
		            : (webFetchResult.stdout || webFetchResult.error || `Fetch failed for ${url}.`);
		          const addedReferenceCount = webFetchResult.success
		            ? registerCreativeReferencesFromXPayload(sessionId, webFetchResult.data)
		            : 0;
		          if (addedReferenceCount > 0) {
		            const referenceSummary = `Added ${addedReferenceCount} media item${addedReferenceCount === 1 ? '' : 's'} to this session's Creative References bucket.`;
		            deps.sendSSE?.('info', { message: referenceSummary });
		            result = `${result}\n\n${referenceSummary}`;
		          }
		          const looksLikeFailure = result.startsWith('Fetch failed')
		            || result.startsWith('Fetch error')
		            || result.startsWith('Fetch timed')
		            || /"success"\s*:\s*false/.test(result);
		          return { name, args, result, error: looksLikeFailure, data: webFetchResult.data };
		        }

          // X/Twitter URL — use specialized scraper with snapshots + deltas

	      }

	      case 'download_url': {
	        const toolResult = await executeDownloadUrl({
	          url: String(args.url || ''),
	          filename: args.filename != null ? String(args.filename) : undefined,
	          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
	        });
	        return {
	          name,
	          args,
	          result: toolResult.success
	            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'download_url complete' }, null, 2)
	            : `ERROR: ${toolResult.error || 'download_url failed'}`,
	          error: toolResult.success !== true,
	        };
	      }

	      case 'download_media': {
	        const toolResult = await executeDownloadMedia({
	          url: String(args.url || ''),
	          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
	          audio_only: args.audio_only === true,
	        });
	        return {
	          name,
	          args,
	          result: toolResult.success
	            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'download_media complete' }, null, 2)
	            : `ERROR: ${toolResult.error || 'download_media failed'}`,
	          error: toolResult.success !== true,
	        };
	      }

		      case 'generate_image': {
		        const toolResult = await executeGenerateImage({
		          prompt: String(args.prompt || ''),
		          reference_images: Array.isArray(args.reference_images)
		            ? args.reference_images.map((item: any) => String(item))
		            : (args.reference_images != null ? [String(args.reference_images)] : undefined),
		          aspect_ratio: args.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
		          count: args.count != null ? Number(args.count) : undefined,
		          provider: args.provider != null ? String(args.provider) : undefined,
		          model: args.model != null ? String(args.model) : undefined,
		          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
	          save_to_workspace: args.save_to_workspace != null ? args.save_to_workspace === true : undefined,
	        });
		        return {
		          name,
		          args,
		          result: toolResult.success
		            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'generate_image complete' }, null, 2)
		            : `ERROR: ${toolResult.error || 'generate_image failed'}`,
		          error: toolResult.success !== true,
		          extra: toolResult.success && toolResult.data
		            ? {
		                generated_image: Array.isArray(toolResult.data?.images) && toolResult.data.images.length
		                  ? toolResult.data.images[0]
		                  : toolResult.data,
		                generated_images: Array.isArray(toolResult.data?.images)
		                  ? toolResult.data.images
		                  : [toolResult.data],
		              }
		            : undefined,
		        };
		      }

		      case 'generate_video': {
		        const toolResult = await executeGenerateVideo({
		          prompt: String(args.prompt || ''),
		          image: args.image != null ? String(args.image) : undefined,
		          reference_images: Array.isArray(args.reference_images)
		            ? args.reference_images.map((item: any) => String(item))
		            : (args.reference_images != null ? [String(args.reference_images)] : undefined),
		          video: args.video != null ? String(args.video) : undefined,
		          mode: args.mode != null ? String(args.mode) : undefined,
		          aspect_ratio: args.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
		          duration: args.duration != null ? Number(args.duration) : undefined,
		          resolution: args.resolution != null ? String(args.resolution) : undefined,
		          provider: args.provider != null ? String(args.provider) : undefined,
		          model: args.model != null ? String(args.model) : undefined,
		          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
		          save_to_workspace: args.save_to_workspace != null ? args.save_to_workspace === true : undefined,
		          poll_interval_ms: args.poll_interval_ms != null ? Number(args.poll_interval_ms) : undefined,
		          timeout_ms: args.timeout_ms != null ? Number(args.timeout_ms) : undefined,
		        });
		        return {
		          name,
		          args,
		          result: toolResult.success
		            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'generate_video complete' }, null, 2)
		            : `ERROR: ${toolResult.error || 'generate_video failed'}`,
		          error: toolResult.success !== true,
		          extra: toolResult.success && toolResult.data
		            ? {
		                generated_video: toolResult.data?.video || toolResult.data,
		                generated_videos: [toolResult.data?.video || toolResult.data],
		              }
		            : undefined,
		        };
		      }

	      case 'analyze_image': {
	        const toolResult = await executeAnalyzeImage({
	          file_path: String(args.file_path || ''),
	          prompt: args.prompt != null ? String(args.prompt) : undefined,
	        });
	        return {
	          name,
	          args,
	          result: toolResult.success
	            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'analyze_image complete' }, null, 2)
	            : `ERROR: ${toolResult.error || 'analyze_image failed'}`,
	          error: toolResult.success !== true,
	        };
	      }

      case 'analyze_video': {
        const toolResult = await executeAnalyzeVideo({
          file_path: String(args.file_path || ''),
          prompt: args.prompt != null ? String(args.prompt) : undefined,
          sample_count: args.sample_count != null ? Number(args.sample_count) : undefined,
	          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
	          extract_audio: args.extract_audio !== false,
	          transcribe: args.transcribe !== false,
	        });
	        return {
	          name,
	          args,
	          result: toolResult.success
	            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'analyze_video complete' }, null, 2)
	            : `ERROR: ${toolResult.error || 'analyze_video failed'}`,
          error: toolResult.success !== true,
        };
      }

      case 'video_analyze_imported_video': {
        const toolResult = await executeAnalyzeVideo({
          file_path: String(args.file_path || ''),
          prompt: args.prompt != null ? String(args.prompt) : undefined,
          sample_count: args.sample_count != null ? Number(args.sample_count) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
          extract_audio: args.extract_audio !== false,
          transcribe: args.transcribe !== false,
        });
        return {
          name,
          args,
          result: toolResult.success
            ? JSON.stringify(toolResult.data || { message: toolResult.stdout || 'video_analyze_imported_video complete' }, null, 2)
            : `ERROR: ${toolResult.error || 'video_analyze_imported_video failed'}`,
          error: toolResult.success !== true,
        };
      }

      case 'git_status': {
        try {
          const cwd = args.cwd ? resolveAllowedWorkspacePath(String(args.cwd), { requireDirectory: true }).absPath : workspacePath;
          return runCapturedToolCommand('git status --short --branch', cwd, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'git_log': {
        try {
          const limit = Math.max(1, Math.min(50, Number(args.limit || 10)));
          const parts = [`git log --oneline --decorate -n ${limit}`];
          if (args.path) {
            const resolved = resolveAllowedWorkspacePath(String(args.path));
            parts.push('--', quoteArg(resolved.displayPath));
          }
          return runCapturedToolCommand(parts.join(' '), workspacePath, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'git_branch': {
        try {
          const action = String(args.action || 'list').trim().toLowerCase();
          if (action === 'list') return runCapturedToolCommand('git branch --all --verbose', workspacePath, 120000);
          const branch = String(args.branch || '').trim();
          if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) return { name, args, result: 'ERROR: branch is required and must be a safe branch name.', error: true };
          if (action === 'create') {
            const startPoint = String(args.start_point || '').trim();
            return runCapturedToolCommand(`git branch ${quoteArg(branch)}${startPoint ? ` ${quoteArg(startPoint)}` : ''}`, workspacePath, 120000);
          }
          if (action === 'switch' || action === 'checkout') {
            return runCapturedToolCommand(`git switch ${quoteArg(branch)}`, workspacePath, 120000);
          }
          return { name, args, result: 'ERROR: action must be list, create, or switch.', error: true };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'git_commit': {
        const message = String(args.message || '').trim();
        if (!message) return { name, args, result: 'message is required', error: true };
        try {
          if (Array.isArray(args.paths) && args.paths.length) {
            const pathspecs = args.paths.map((p: any) => quoteArg(resolveAllowedWorkspacePath(String(p)).displayPath)).join(' ');
            const add = await deps.runCommandCaptured(`git add -- ${pathspecs}`, workspacePath, 120000);
            if (add.code !== 0) return { name, args, result: `git add failed:\n${add.stderr || add.stdout}`, error: true };
          } else if (args.all === true) {
            const add = await deps.runCommandCaptured('git add -A', workspacePath, 120000);
            if (add.code !== 0) return { name, args, result: `git add -A failed:\n${add.stderr || add.stdout}`, error: true };
          }
          return runCapturedToolCommand(`git commit -m ${quoteArg(message)}`, workspacePath, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'git_push': {
        try {
          const remote = String(args.remote || 'origin').trim();
          let branch = String(args.branch || '').trim();
          if (!branch) {
            const current = await deps.runCommandCaptured('git branch --show-current', workspacePath, 120000);
            branch = String(current.stdout || '').trim();
          }
          if (!/^[A-Za-z0-9._\/-]+$/.test(remote) || !/^[A-Za-z0-9._\/-]+$/.test(branch)) {
            return { name, args, result: 'ERROR: remote/branch must be safe names.', error: true };
          }
          const upstream = args.set_upstream === true ? '--set-upstream ' : '';
          return runCapturedToolCommand(`git push ${upstream}${quoteArg(remote)} ${quoteArg(branch)}`, workspacePath, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'open_pr': {
        try {
          const cmd = [
            'gh pr create',
            args.title ? `--title ${quoteArg(String(args.title))}` : '',
            args.body ? `--body ${quoteArg(String(args.body))}` : '--fill',
            args.base ? `--base ${quoteArg(String(args.base))}` : '',
            args.draft === true ? '--draft' : '',
          ].filter(Boolean).join(' ');
          return runCapturedToolCommand(cmd, workspacePath, 120000);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'run_tests':
      case 'run_linter':
      case 'run_formatter':
      case 'run_typecheck': {
        try {
          const cwd = args.cwd ? resolveAllowedWorkspacePath(String(args.cwd), { requireDirectory: true }).absPath : workspacePath;
          const scripts = readPackageScripts(cwd);
          let command = String(args.command || '').trim();
          if (!command) {
            if (name === 'run_tests') command = scripts.test ? 'npm test' : '';
            if (name === 'run_linter') command = scripts.lint ? 'npm run lint' : '';
            if (name === 'run_formatter') command = scripts.format ? 'npm run format' : (scripts['format:check'] ? 'npm run format:check' : '');
            if (name === 'run_typecheck') command = scripts.typecheck ? 'npm run typecheck' : (scripts['build:backend'] ? 'npm run build:backend' : 'npx tsc --noEmit');
          }
          if (!command) return { name, args, result: `ERROR: no suitable script found for ${name}; pass command explicitly.`, error: true };
          const timeoutMs = Math.max(1000, Math.min(20 * 60 * 1000, Number(args.timeout_ms || 120000)));
          return runCapturedToolCommand(command, cwd, timeoutMs);
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'format_changed_files': {
        const scripts = readPackageScripts(workspacePath);
        const script = String(args.script || '').trim() || (scripts.format ? 'format' : (scripts['format:check'] ? 'format:check' : ''));
        if (script) return runCapturedToolCommand(`npm run ${script}`, workspacePath, 120000);
        return runCapturedToolCommand(args.check_only === true ? 'npx prettier --check .' : 'npx prettier --write .', workspacePath, 120000);
      }

      case 'start_dev_server': {
        try {
          const cwd = args.cwd ? resolveAllowedWorkspacePath(String(args.cwd), { requireDirectory: true }).absPath : workspacePath;
          const scripts = readPackageScripts(cwd);
          const command = String(args.command || '').trim() || (scripts.dev ? 'npm run dev' : (scripts.start ? 'npm start' : 'npm run dev'));
          const commandBoundary = analyzeRunCommandBoundary(command);
          if (commandBoundary.blocked) return commandBoundary.blocked;
          if (commandBoundary.requiresExplicitApproval) {
            return { name, args, result: `start_dev_server command requires outside-workspace approval (${commandBoundary.scope}): ${commandBoundary.reason}`, error: true };
          }
          const { spawn } = await import('child_process');
          const child = spawn(command, { cwd, shell: true, windowsHide: true, env: process.env });
          const processId = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const proc = { child, name: String(args.name || processId), command, cwd, startedAt: Date.now(), output: [] as string[], exitCode: undefined as number | null | undefined };
          const append = (chunk: any) => {
            proc.output.push(String(chunk));
            const joined = proc.output.join('');
            if (joined.length > 200000) proc.output = [joined.slice(-200000)];
          };
          child.stdout?.on('data', append);
          child.stderr?.on('data', append);
          child.on('close', (code: number | null) => { proc.exitCode = code; append(`\n[process exited ${code}]\n`); });
          devServerProcesses.set(processId, proc);
          return { name, args, result: JSON.stringify({ process_id: processId, command, cwd, pid: child.pid, name: proc.name }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'read_process_output': {
        const processId = String(args.process_id || '').trim();
        const proc = devServerProcesses.get(processId);
        if (!proc) return { name, args, result: `ERROR: process not found: ${processId}`, error: true };
        const maxChars = Math.max(1000, Math.min(100000, Number(args.max_chars || 8000)));
        return { name, args, result: truncateText(proc.output.join('') || '(no output yet)', maxChars), error: false };
      }

      case 'stop_process': {
        const processId = String(args.process_id || '').trim();
        const proc = devServerProcesses.get(processId);
        if (!proc) return { name, args, result: `ERROR: process not found: ${processId}`, error: true };
        try { proc.child.kill(); } catch {}
        devServerProcesses.delete(processId);
        return { name, args, result: `Stopped ${processId} (${proc.command}).`, error: false };
      }

      case 'snapshot_workspace': {
        try {
          const id = `snap_${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`;
          const root = snapshotRoot();
          const snapDir = path.join(root, id);
          const filesDir = path.join(snapDir, 'files');
          fs.mkdirSync(filesDir, { recursive: true });
          const files = walkFiles(workspacePath, {
            maxFiles: Math.max(1, Math.min(20000, Number(args.max_files || 2000))),
            maxBytes: Math.max(1, Number(args.max_bytes || 50_000_000)),
          });
          for (const file of files) {
            const dest = path.join(filesDir, file.relPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(file.absPath, dest);
          }
          const manifest = {
            id,
            label: String(args.label || '').trim(),
            workspacePath,
            createdAt: Date.now(),
            fileCount: files.length,
            totalBytes: files.reduce((sum, f) => sum + f.size, 0),
            files: files.map(f => ({ path: f.relPath, size: f.size })),
          };
          fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
          return { name, args, result: JSON.stringify(manifest, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'restore_snapshot':
      case 'revert_last_tool_change':
      case 'revert_own_patch': {
        try {
          const snapshots = listSnapshots();
          const snapshotId = String(args.snapshot_id || snapshots[0]?.id || '').trim();
          if (!snapshotId) return { name, args, result: 'ERROR: no snapshots available.', error: true };
          const snapDir = path.join(snapshotRoot(), snapshotId);
          const manifestPath = path.join(snapDir, 'manifest.json');
          if (!fs.existsSync(manifestPath)) return { name, args, result: `ERROR: snapshot not found: ${snapshotId}`, error: true };
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const files = Array.isArray(manifest.files) ? manifest.files : [];
          const preview = { snapshot_id: snapshotId, file_count: files.length, files: files.slice(0, 200).map((f: any) => f.path), truncated: files.length > 200 };
          if (args.dry_run === true) return { name, args, result: JSON.stringify(preview, null, 2), error: false };
          if (args.confirm !== true) return { name, args, result: `ERROR: confirm=true is required to restore snapshot. Preview:\n${JSON.stringify(preview, null, 2)}`, error: true };
          for (const file of files) {
            const rel = String(file.path || '');
            const dest = resolveAllowedWorkspacePath(rel).absPath;
            const src = path.join(snapDir, 'files', rel);
            if (!fs.existsSync(src)) continue;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
          }
          return { name, args, result: `Restored ${files.length} file(s) from ${snapshotId}.`, error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'scan_large_files': {
        try {
          const dir = args.path ? resolveAllowedWorkspacePath(String(args.path), { requireDirectory: true }).absPath : workspacePath;
          const minBytes = Math.max(1, Number(args.min_bytes || 5_000_000));
          const maxResults = Math.max(1, Math.min(1000, Number(args.max_results || 100)));
          const files = walkFiles(dir, { maxFiles: 20000, maxBytes: Number.MAX_SAFE_INTEGER })
            .filter(f => f.size >= minBytes)
            .sort((a, b) => b.size - a.size)
            .slice(0, maxResults);
          return { name, args, result: JSON.stringify(files.map(f => ({ path: f.relPath, bytes: f.size })), null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'scan_secrets': {
        try {
          const target = args.path ? resolveAllowedWorkspacePath(String(args.path)) : resolveAllowedWorkspacePath('.', { requireDirectory: true, allowEmpty: true });
          const stat = fs.existsSync(target.absPath) ? fs.statSync(target.absPath) : null;
          const files = stat?.isFile()
            ? [{ absPath: target.absPath, relPath: target.displayPath, size: stat.size }]
            : walkFiles(target.absPath, { maxFiles: 10000, maxBytes: 80_000_000 });
          const maxResults = Math.max(1, Math.min(1000, Number(args.max_results || 100)));
          const patterns = [
            { type: 'openai_key', re: /sk-[A-Za-z0-9_-]{20,}/g },
            { type: 'github_token', re: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
            { type: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/g },
            { type: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
            { type: 'env_secret_assignment', re: /\b[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD)[A-Z0-9_]*\s*=\s*['"]?[^'"\s]{12,}/g },
          ];
          const findings: any[] = [];
          for (const file of files) {
            if (findings.length >= maxResults || file.size > 2_000_000) continue;
            let content = '';
            try { content = fs.readFileSync(file.absPath, 'utf-8'); } catch { continue; }
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length && findings.length < maxResults; i++) {
              for (const pattern of patterns) {
                pattern.re.lastIndex = 0;
                if (pattern.re.test(lines[i])) {
                  findings.push({ file: file.relPath, line: i + 1, type: pattern.type, preview: lines[i].replace(/=.*/, '= [REDACTED]').slice(0, 160) });
                  break;
                }
              }
            }
          }
          return { name, args, result: JSON.stringify({ findings, count: findings.length }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'operation_plan': {
        const operations = Array.isArray(args.operations) ? args.operations : [];
        const plans: any[] = [];
        for (const op of operations) {
          const type = String(op?.type || op?.operation || '').trim();
          try {
            const source = op?.source || op?.from || op?.path;
            const destination = op?.destination || op?.to || op?.new_path;
            const sourceInfo = source ? resolveAllowedWorkspacePath(String(source)) : null;
            const destInfo = destination ? resolveAllowedWorkspacePath(String(destination)) : null;
            plans.push({
              type,
              source: sourceInfo?.displayPath || null,
              destination: destInfo?.displayPath || null,
              source_exists: sourceInfo ? fs.existsSync(sourceInfo.absPath) : null,
              destination_exists: destInfo ? fs.existsSync(destInfo.absPath) : null,
              would_overwrite: destInfo ? fs.existsSync(destInfo.absPath) : false,
            });
          } catch (err: any) {
            plans.push({ type, error: err?.message || String(err) });
          }
        }
        return { name, args, result: JSON.stringify({ operations: plans, mutates: false }, null, 2), error: false };
      }

      case 'code_outline': {
        try {
          const requested = args.file || args.filename || args.path;
          if (!requested) return { name, args, result: 'file is required', error: true };
          const resolved = resolveAllowedWorkspacePath(String(requested), { requireFile: true });
          const outline = await buildCodeOutlineForFile(resolved.absPath, Math.max(1, Math.min(1000, Number(args.max_symbols || 300))));
          return { name, args, result: JSON.stringify(outline, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'get_symbols': {
        try {
          const dir = args.path ? resolveAllowedWorkspacePath(String(args.path), { requireDirectory: true }).absPath : workspacePath;
          const symbols = await collectCodeSymbols(dir, String(args.query || ''), Math.max(1, Math.min(1000, Number(args.max_results || 100))));
          return { name, args, result: JSON.stringify({ symbols, count: symbols.length }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'go_to_definition': {
        try {
          const symbol = String(args.symbol || '').trim();
          if (!symbol) return { name, args, result: 'symbol is required', error: true };
          const dir = args.path ? resolveAllowedWorkspacePath(String(args.path), { requireDirectory: true }).absPath : workspacePath;
          const symbols = await collectCodeSymbols(dir, symbol, Math.max(1, Math.min(100, Number(args.max_results || 20))));
          const exact = symbols.filter(s => String(s.name) === symbol);
          return { name, args, result: JSON.stringify({ definitions: exact.length ? exact : symbols, count: (exact.length ? exact : symbols).length }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'find_references': {
        try {
          const symbol = String(args.symbol || '').trim();
          if (!symbol) return { name, args, result: 'symbol is required', error: true };
          const dir = args.path ? resolveAllowedWorkspacePath(String(args.path), { requireDirectory: true }).absPath : workspacePath;
          const maxResults = Math.max(1, Math.min(2000, Number(args.max_results || 200)));
          const word = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          const refs: any[] = [];
          for (const file of walkFiles(dir, { maxFiles: 5000, maxBytes: 100_000_000 }).filter(f => isCodeFile(f.relPath))) {
            if (refs.length >= maxResults) break;
            let content = '';
            try { content = fs.readFileSync(file.absPath, 'utf-8'); } catch { continue; }
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length && refs.length < maxResults; i++) {
              if (word.test(lines[i])) refs.push({ file: file.relPath, line: i + 1, text: lines[i].trim().slice(0, 240) });
            }
          }
          return { name, args, result: JSON.stringify({ references: refs, count: refs.length }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
        }
      }

      case 'start_process': {
        const rawCmd = String(args.command || '').trim();
        if (!rawCmd) return { name, args, result: 'command is required', error: true };
        if (looksLikeNativeFileToolBypass(rawCmd)) {
          return {
            name,
            args,
            result: 'Blocked: this looks like an ad hoc shell/Python/Node/PowerShell file edit. Use native file tools instead. Use start_process for dev servers, watchers, long builds, and interactive CLIs.',
            error: true,
          };
        }
        const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
        const commandBoundary = analyzeRunCommandBoundary(normalizedCmd);
        if (commandBoundary.blocked) return commandBoundary.blocked;
        if (commandBoundary.requiresExplicitApproval) {
          return {
            name,
            args,
            result: `start_process requires an explicit outside-workspace approval for this command (${commandBoundary.scope}): ${commandBoundary.reason || rawCmd}`,
            error: true,
          };
        }
        if (!deps.isAllowedShellCommand(normalizedCmd)) {
          return { name, args, result: `Blocked: shell command is not allowed by policy: "${rawCmd}"`, error: true };
        }
        let commandCwd: { cwd: string; displayCwd: string };
        try {
          commandCwd = resolveRunCommandCwd(args.cwd);
        } catch (err: any) {
          return { name, args, result: `Invalid cwd for start_process: ${err.message || err}`, error: true };
        }
        try {
          const run = await getProcessSupervisor().spawn({
            command: normalizedCmd,
            cwd: commandCwd.cwd,
            mode: 'background',
            shell: args.shell || 'auto',
            pty: args.pty === true,
            title: args.title ? String(args.title) : undefined,
            stdinMode: args.stdin === true ? 'pipe' : 'ignore',
            noOutputTimeoutMs: args.noOutputTimeoutMs == null ? undefined : Number(args.noOutputTimeoutMs),
            sessionId,
          });
          return {
            name,
            args,
            result: `Started supervised process ${run.runId} cwd=${commandCwd.displayCwd}\n${normalizedCmd}`,
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `start_process failed: ${err.message || err}`, error: true };
        }
      }

      case 'process_status': {
        const runId = String(args.runId || args.run_id || '').trim();
        const supervisor = getProcessSupervisor();
        if (runId) {
          const run = supervisor.get(runId);
          return { name, args, result: run ? JSON.stringify(run, null, 2) : `No process found for ${runId}`, error: !run };
        }
        return { name, args, result: JSON.stringify({ runs: supervisor.list(Number(args.limit || 20)) }, null, 2), error: false };
      }

      case 'process_log': {
        const runId = String(args.runId || args.run_id || '').trim();
        if (!runId) return { name, args, result: 'runId is required', error: true };
        const log = getProcessSupervisor().log(runId, Number(args.maxChars || args.max_chars || 120000));
        return { name, args, result: log.combined || '(no output)', error: false };
      }

      case 'process_wait': {
        const runId = String(args.runId || args.run_id || '').trim();
        if (!runId) return { name, args, result: 'runId is required', error: true };
        const exit = await getProcessSupervisor().wait(runId);
        if (!exit) return { name, args, result: `No active process found for ${runId}`, error: true };
        const output = [exit.stdout, exit.stderr].filter(Boolean).join('\n').trim();
        return {
          name,
          args,
          result: `${runId} [${exit.timedOut ? 'TIMED OUT' : `exit ${exit.exitCode ?? '?'}`}]\n${output.slice(0, 4000) || '(no output)'}`,
          error: exit.exitCode !== 0,
        };
      }

      case 'process_kill': {
        const runId = String(args.runId || args.run_id || '').trim();
        if (!runId) return { name, args, result: 'runId is required', error: true };
        const killed = getProcessSupervisor().cancel(runId);
        return { name, args, result: killed ? `Killed ${runId}` : `No active process found for ${runId}`, error: !killed };
      }

      case 'process_submit': {
        const runId = String(args.runId || args.run_id || '').trim();
        if (!runId) return { name, args, result: 'runId is required', error: true };
        const ok = getProcessSupervisor().write(runId, String(args.data || ''), true);
        return { name, args, result: ok ? `Submitted input to ${runId}` : `Could not write to ${runId}`, error: !ok };
      }

	      case 'run_command': {
        const rawCmd = (args.command || '').trim();
        if (!rawCmd) return { name, args, result: 'command is required', error: true };
        if (looksLikeNativeFileToolBypass(rawCmd)) {
          return {
            name,
            args,
            result: 'Blocked: this looks like an ad hoc shell/Python/Node/PowerShell file edit. Use native file tools instead: file_stats/read_file or grep_file first, then find_replace/replace_lines/insert_after/delete_lines/write_file/create_file. Use run_command for tests, builds, git/status, package installs, diagnostics, or transformations the file tools cannot perform.',
            error: true,
          };
        }
        const cmd = rawCmd.toLowerCase();
        if (/\b(playwright|npx\s+playwright|npm\s+exec\s+playwright|pnpm\s+exec\s+playwright|yarn\s+playwright)\b[\s\S]*\binstall\b/.test(cmd)) {
          return {
            name,
            args,
            result: 'Blocked: agents must not install Playwright browser binaries during task execution. Browser runtime setup belongs to the app/bootstrap layer, not background-agent work.',
            error: true,
          };
        }
        // Check blocked patterns
        const blockedPattern = commandContainsBlockedPattern(cmd, deps.BLOCKED_PATTERNS);
        if (blockedPattern) {
          return { name, args, result: `Blocked: "${cmd}" contains unsafe pattern "${blockedPattern}"`, error: true };
        }

        const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
        const commandBoundary = analyzeRunCommandBoundary(normalizedCmd);
        if (commandBoundary.blocked) return commandBoundary.blocked;
        const wantVisible = args.visible === true || args.window === true;
        let commandCwd: { cwd: string; displayCwd: string };
        try {
          commandCwd = resolveRunCommandCwd(args.cwd);
        } catch (err: any) {
          return { name, args, result: `Invalid cwd for run_command: ${err.message || err}`, error: true };
        }
        let execCmd = '';

        // 1. Check allowlist (exact match)
        if (deps.SAFE_COMMANDS[cmd]) {
          execCmd = deps.SAFE_COMMANDS[cmd];
        }
        // 2. "chrome <url>" or "browser <url>" â†’ open browser with URL
        else if (/^(chrome|browser|firefox|edge)\s+/.test(cmd)) {
          const parts = rawCmd.split(/\s+/);
          const app = parts[0].toLowerCase();
          let url = parts.slice(1).join(' ');
          // Add https:// only when no URI scheme is present.
          // This preserves file://, chrome://, about:, etc.
          if (url && !deps.hasUriScheme(url)) url = 'https://' + url;
          execCmd = deps.buildBrowserLaunchCommand(app, url);
        }
        // 3. URL/URI â†’ open in default browser
        else if (/^(https?:\/\/|file:\/\/|chrome:\/\/|about:|www\.)/.test(cmd)) {
          const url = cmd.startsWith('www.') ? 'https://' + rawCmd : rawCmd;
          execCmd = deps.buildUrlOpenCommand(url);
        }
        // 4. Bare domain like "youtube.com" â†’ open in browser
        else if (/^[a-z0-9-]+\.[a-z]{2,}/.test(cmd) && !cmd.includes(' ')) {
          execCmd = deps.buildUrlOpenCommand(`https://${rawCmd}`);
        }
        // 5. "code <path>" â†’ VS Code
        else if (cmd.startsWith('code ')) {
          execCmd = rawCmd;
        }
        // 6. Windows-only: "start <url>" â†’ pass through
        else if (deps.isWindows && (cmd.startsWith('start http') || cmd.startsWith('start https'))) {
          execCmd = rawCmd;
        }
        // 7. Windows-only: "explorer <path>"
        else if (deps.isWindows && cmd.startsWith('explorer ')) {
          execCmd = rawCmd;
        }
        // 8. Dev CLI tools: git, npm, node, npx, python, pip, tsc, cargo, etc.
        //    DEFAULT: captured mode (returns stdout/stderr). Pass visible:true to open a window.
        else if (/^(git|npm|node|npx|yarn|pnpm|python|python3|pip|pip3|tsc|ts-node|cargo|rustc|go|java|javac|mvn|gradle|dotnet|docker|kubectl|az|aws|xurl)\b/.test(cmd)) {
          if (!wantVisible) {
            // Captured mode (DEFAULT) — wait for completion and return output
            try {
              const captured = await deps.runCommandCaptured(normalizedCmd, commandCwd.cwd, Number(args.timeoutMs || args.timeout_ms || 120_000), {
                shell: args.shell,
                pty: args.pty === true,
                approvalId: approvedCommandApprovalId || undefined,
              });
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
              const exitLabel = captured.timedOut ? 'TIMED OUT' : `exit ${captured.code ?? '?'}`;
              return {
                name, args,
                result: `${normalizedCmd} [${exitLabel}] run=${captured.runId || 'n/a'} cwd=${commandCwd.displayCwd}\n${output.slice(0, 4000) || '(no output)'}`,
                error: (captured.code !== 0 && !captured.timedOut),
              };
            } catch (capErr: any) {
              return { name, args, result: `run_command capture failed: ${capErr.message}`, error: true };
            }
          }
          // Windowed mode (only when explicitly requested) — open visible cmd
          if (deps.isWindows) {
            const escaped = normalizedCmd.replace(/"/g, '""');
            execCmd = `start cmd /k "${escaped}"`;
          } else {
            execCmd = normalizedCmd;
          }
        }
        // 9. Fallback: allow broader shell commands when they pass shell allowlist checks.
        else {
          if (!deps.isAllowedShellCommand(normalizedCmd)) {
            return {
              name,
              args,
              result: `Blocked: shell command is not allowed by policy: "${rawCmd}"`,
              error: true,
            };
          }
          if (!wantVisible) {
            try {
              const captured = await deps.runCommandCaptured(normalizedCmd, commandCwd.cwd, Number(args.timeoutMs || args.timeout_ms || 120_000), {
                shell: args.shell,
                pty: args.pty === true,
                approvalId: approvedCommandApprovalId || undefined,
              });
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
              const exitLabel = captured.timedOut ? 'TIMED OUT' : `exit ${captured.code ?? '?'}`;
              return {
                name, args,
                result: `${normalizedCmd} [${exitLabel}] run=${captured.runId || 'n/a'} cwd=${commandCwd.displayCwd}\n${output.slice(0, 4000) || '(no output)'}`,
                error: (captured.code !== 0 && !captured.timedOut),
              };
            } catch (capErr: any) {
              return { name, args, result: `run_command capture failed: ${capErr.message}`, error: true };
            }
          }
          if (deps.isWindows) {
            const escaped = normalizedCmd.replace(/"/g, '""');
            execCmd = `start cmd /k "${escaped}"`;
          } else {
            execCmd = normalizedCmd;
          }
        }

        if (!execCmd) {
          return {
            name,
            args,
            result: `Command "${rawCmd}" was not executable.`,
            error: true,
          };
        }
        try {
          const { exec } = await import('child_process');
          exec(execCmd, { cwd: commandCwd.cwd });
          return { name, args, result: `Executed: ${execCmd}`, error: false };
        } catch (err: any) {
          return { name, args, result: `Failed: ${err.message}`, error: true };
        }
      }

      case 'start_task': {
        // This is handled specially in deps.handleChat — shouldn't reach here
        return { name, args, result: 'Task system ready. Use the task endpoint.', error: false };
      }

      case 'background_spawn': {
        try {
          const prompt = String(args.task_prompt || args.prompt || '').trim();
          if (!prompt) return { name, args, result: 'background_spawn requires task_prompt', error: true };
          const modelOverride = String(args.model_override || args.model || '').trim() || undefined;
          const providerOverride = String(args.provider_override || args.provider || '').trim() || undefined;
          const status = backgroundSpawn({
            prompt,
            spawnerSessionId: sessionId,
            joinPolicy: args.join_policy || 'wait_all',
            timeoutMs: args.timeout_ms,
            tags: args.tags,
            modelOverride,
            providerOverride,
          });
          return { name, args, result: JSON.stringify(status), error: false };
        } catch (err: any) {
          return { name, args, result: `background_spawn error: ${err.message}`, error: true };
        }
      }

      case 'background_status':
      case 'background_progress': {
        const bgId = String(args.background_id || '').trim();
        if (!bgId) return { name, args, result: 'background_id is required', error: true };
        const status = backgroundProgress(bgId);
        if (!status) return { name, args, result: `No background agent found with id: ${bgId}`, error: true };
        return { name, args, result: JSON.stringify(status), error: false };
      }

      case 'background_wait': {
        try {
          const bgId = String(args.background_id || '').trim();
          const bgIds = Array.isArray(args.background_ids)
            ? args.background_ids.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          const result = await backgroundWait({
            backgroundId: bgId || undefined,
            backgroundIds: bgIds,
            spawnerSessionId: sessionId,
            timeoutMs: args.timeout_ms ?? args.wait_ms,
          });
          return { name, args, result: JSON.stringify(result), error: false };
        } catch (err: any) {
          return { name, args, result: `background_wait error: ${err.message}`, error: true };
        }
      }

      case 'background_join': {
        try {
          const bgId = String(args.background_id || '').trim();
          if (!bgId) return { name, args, result: 'background_id is required', error: true };
          const result = await backgroundJoin({
            backgroundId: bgId,
            joinPolicy: args.join_policy,
            timeoutMs: args.timeout_ms,
          });
          if (!result) return { name, args, result: `No background agent found with id: ${bgId}`, error: true };
          return { name, args, result: JSON.stringify(result), error: result.state === 'failed' };
        } catch (err: any) {
          return { name, args, result: `background_join error: ${err.message}`, error: true };
        }
      }

	  case 'task_control': {
	        const out = await deps.handleTaskControlAction(sessionId, args);
	        return {
	          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: out.success !== true,
	        };
	      }

	      case 'timer': {
	        const action = String(args.action || '').trim().toLowerCase();
	        const mainChatOnly = !/^(cron_|task_|background_|dispatch_|self_repair_|team_|agent_|auto_)/i.test(String(sessionId || ''));
	        if (!mainChatOnly) {
	          return {
	            name,
	            args,
	            result: 'Timers are main-chat only. They cannot be created from cron, background, task, team, or automated sessions.',
	            error: true,
	          };
	        }

	        if (action === 'list') {
	          const requestedSessionId = String(args.session_id || args.sessionId || '').trim();
	          const allSessions = args.all_sessions === true || String(args.scope || '').trim().toLowerCase() === 'all';
	          const timers = listMainChatTimers({
	            sessionId: allSessions ? undefined : (requestedSessionId || sessionId),
	            includeDone: args.include_done === true,
	          });
	          return {
	            name,
	            args,
	            result: JSON.stringify({
	              success: true,
	              action: 'list',
	              scope: allSessions ? 'all_sessions' : 'session',
	              sessionId: allSessions ? null : (requestedSessionId || sessionId),
	              count: timers.length,
	              timers,
	            }, null, 2),
	            error: false,
	          };
	        }

	        if (action === 'cancel') {
	          const timerId = String(args.timer_id || args.timerId || '').trim();
	          if (!timerId) return { name, args, result: 'timer(cancel) requires timer_id', error: true };
	          const requestedSessionId = String(args.session_id || args.sessionId || '').trim();
	          const allSessions = args.all_sessions === true || String(args.scope || '').trim().toLowerCase() === 'all';
	          const existing = listMainChatTimers({
	            sessionId: allSessions ? undefined : (requestedSessionId || sessionId),
	            includeDone: true,
	          }).find((timer) => timer.id === timerId);
	          if (!existing) {
	            return {
	              name,
	              args,
	              result: allSessions
	                ? `Timer not found: ${timerId}`
	                : `Timer not found in session ${(requestedSessionId || sessionId)}: ${timerId}`,
	              error: true,
	            };
	          }
	          const cancelled = cancelMainChatTimer(timerId);
	          if (!cancelled) return { name, args, result: `Timer not found: ${timerId}`, error: true };
	          deps.broadcastWS?.({ type: 'timer_cancelled', timer: cancelled, sessionId: cancelled.sessionId });
	          return {
	            name,
	            args,
	            result: JSON.stringify({ success: true, action: 'cancel', timer: cancelled }, null, 2),
	            error: false,
	          };
	        }

	        if (action === 'update' || action === 'modify' || action === 'reschedule') {
	          const timerId = String(args.timer_id || args.timerId || '').trim();
	          if (!timerId) return { name, args, result: `timer(${action}) requires timer_id`, error: true };
	          const requestedSessionId = String(args.session_id || args.sessionId || '').trim();
	          const allSessions = args.all_sessions === true || String(args.scope || '').trim().toLowerCase() === 'all';
	          const existing = listMainChatTimers({
	            sessionId: allSessions ? undefined : (requestedSessionId || sessionId),
	            includeDone: true,
	          }).find((timer) => timer.id === timerId);
	          if (!existing) {
	            return {
	              name,
	              args,
	              result: allSessions
	                ? `Timer not found: ${timerId}`
	                : `Timer not found in session ${(requestedSessionId || sessionId)}: ${timerId}`,
	              error: true,
	            };
	          }
	          if (existing.status === 'running') {
	            return { name, args, result: `Timer "${timerId}" is already running and cannot be modified.`, error: true };
	          }
	          if (existing.status === 'completed' || existing.status === 'cancelled') {
	            return { name, args, result: `Timer "${timerId}" is ${existing.status} and cannot be modified. Create a new timer instead.`, error: true };
	          }

	          const patch: any = {};
	          if (args.instruction !== undefined || args.prompt !== undefined) {
	            const instruction = String(args.instruction ?? args.prompt ?? '').trim();
	            if (!instruction) return { name, args, result: `timer(${action}) instruction/prompt cannot be empty`, error: true };
	            patch.instruction = instruction;
	            if (args.label === undefined && existing.label === existing.instruction.slice(0, 60)) {
	              patch.label = instruction.slice(0, 60) || 'Timer';
	            }
	          }
	          if (args.label !== undefined) {
	            const label = String(args.label || '').trim();
	            patch.label = label || (patch.instruction || existing.instruction).slice(0, 60) || 'Timer';
	          }

	          const hasDelay = args.delay_seconds !== undefined || args.delaySeconds !== undefined;
	          const hasDueAt = args.due_at !== undefined || args.dueAt !== undefined;
	          if (hasDelay || hasDueAt) {
	            const now = Date.now();
	            const delaySecondsRaw = Number(args.delay_seconds ?? args.delaySeconds);
	            const dueAtRaw = String(args.due_at || args.dueAt || '').trim();
	            let dueAt: Date | null = null;
	            if (Number.isFinite(delaySecondsRaw) && delaySecondsRaw > 0) {
	              dueAt = new Date(now + Math.max(5, Math.floor(delaySecondsRaw)) * 1000);
	            } else if (dueAtRaw) {
	              const parsed = new Date(dueAtRaw);
	              if (Number.isFinite(parsed.getTime())) dueAt = parsed;
	            }
	            if (!dueAt || !Number.isFinite(dueAt.getTime())) {
	              return { name, args, result: `timer(${action}) requires a positive delay_seconds or a valid due_at ISO timestamp when changing time`, error: true };
	            }
	            if (dueAt.getTime() < now + 5000) {
	              dueAt = new Date(now + 5000);
	            }
	            const maxDueAt = now + 30 * 24 * 60 * 60 * 1000;
	            if (dueAt.getTime() > maxDueAt) {
	              return { name, args, result: 'Timers can be scheduled up to 30 days in the future.', error: true };
	            }
	            patch.dueAt = dueAt.toISOString();
	            patch.status = 'pending';
	            patch.firedAt = undefined;
	            patch.completedAt = undefined;
	            patch.error = undefined;
	          }

	          if (Object.keys(patch).length === 0) {
	            return { name, args, result: `timer(${action}) needs at least one of instruction/prompt, label, delay_seconds, or due_at`, error: true };
	          }
	          const updated = updateMainChatTimer(timerId, patch);
	          if (!updated) return { name, args, result: `Timer not found: ${timerId}`, error: true };
	          deps.broadcastWS?.({ type: 'timer_updated', timer: updated, sessionId: updated.sessionId });
	          return {
	            name,
	            args,
	            result: JSON.stringify({
	              success: true,
	              action: 'update',
	              timer: updated,
	              message: `Timer updated for ${new Date(updated.dueAt).toLocaleString()}.`,
	            }, null, 2),
	            error: false,
	          };
	        }

	        if (action === 'create') {
	          const instruction = String(args.instruction || args.prompt || '').trim();
	          if (!instruction) return { name, args, result: 'timer(create) requires instruction', error: true };

	          const now = Date.now();
	          const delaySecondsRaw = Number(args.delay_seconds ?? args.delaySeconds);
	          const dueAtRaw = String(args.due_at || args.dueAt || '').trim();
	          let dueAt: Date | null = null;
	          if (Number.isFinite(delaySecondsRaw) && delaySecondsRaw > 0) {
	            dueAt = new Date(now + Math.max(5, Math.floor(delaySecondsRaw)) * 1000);
	          } else if (dueAtRaw) {
	            const parsed = new Date(dueAtRaw);
	            if (Number.isFinite(parsed.getTime())) dueAt = parsed;
	          }
	          if (!dueAt || !Number.isFinite(dueAt.getTime())) {
	            return { name, args, result: 'timer(create) requires either delay_seconds or a valid due_at ISO timestamp', error: true };
	          }
	          if (dueAt.getTime() < now + 5000) {
	            dueAt = new Date(now + 5000);
	          }
	          const maxDueAt = now + 30 * 24 * 60 * 60 * 1000;
	          if (dueAt.getTime() > maxDueAt) {
	            return { name, args, result: 'Timers can be scheduled up to 30 days in the future.', error: true };
	          }

	          const timer = createMainChatTimer({
	            sessionId,
	            instruction,
	            dueAt,
	            label: String(args.label || '').trim() || undefined,
	          });
	          deps.broadcastWS?.({ type: 'timer_created', timer, sessionId });
	          return {
	            name,
	            args,
	            result: JSON.stringify({
	              success: true,
	              action: 'create',
	              timer,
	              message: `Timer created for ${new Date(timer.dueAt).toLocaleString()}.`,
	            }, null, 2),
	            error: false,
	          };
	        }

	        return {
	          name,
	          args,
	          result: 'timer requires action: create, list, update, modify, reschedule, or cancel',
	          error: true,
	        };
	      }

	      case 'internal_watch': {
	        const action = String(args.action || '').trim().toLowerCase();

	        if (action === 'list') {
	          const watches = listInternalWatches({
	            sessionId,
	            includeDone: args.include_done === true || args.includeDone === true,
	          });
	          return {
	            name,
	            args,
	            result: JSON.stringify({ success: true, count: watches.length, watches }, null, 2),
	            error: false,
	          };
	        }

	        if (action === 'cancel') {
	          const watchId = String(args.watch_id || args.watchId || args.id || '').trim();
	          if (!watchId) return { name, args, result: 'internal_watch(cancel) requires watch_id', error: true };
	          const existing = listInternalWatches({ sessionId, includeDone: true }).find((watch) => watch.id === watchId);
	          if (!existing) {
	            return { name, args, result: `Internal watch not found in this chat: ${watchId}`, error: true };
	          }
	          const cancelled = cancelInternalWatch(watchId);
	          if (!cancelled) return { name, args, result: `Internal watch not found: ${watchId}`, error: true };
	          deps.broadcastWS?.({ type: 'internal_watch_cancelled', watch: cancelled, sessionId });
	          return {
	            name,
	            args,
	            result: JSON.stringify({ success: true, action: 'cancel', watch: cancelled }, null, 2),
	            error: false,
	          };
	        }

	        if (action === 'create') {
	          const targetRaw = args.target && typeof args.target === 'object' ? args.target : {};
	          const targetType = String(targetRaw.type || args.target_type || args.targetType || '').trim();
	          if (!['file', 'task', 'scheduled_job', 'event_queue'].includes(targetType)) {
	            return { name, args, result: 'internal_watch(create) requires target.type: file, task, scheduled_job, or event_queue', error: true };
	          }
	          const targetConfig: Record<string, any> = { ...targetRaw };
	          delete targetConfig.type;
	          if (targetType === 'file') {
	            targetConfig.path = String(targetConfig.path || args.path || '').trim();
	            if (!targetConfig.path) return { name, args, result: 'internal_watch(create file) requires target.path', error: true };
	          } else if (targetType === 'task') {
	            targetConfig.taskId = String(targetConfig.taskId || targetConfig.task_id || args.task_id || args.taskId || '').trim();
	            if (!targetConfig.taskId) return { name, args, result: 'internal_watch(create task) requires target.task_id', error: true };
	          } else if (targetType === 'scheduled_job') {
	            targetConfig.jobId = String(targetConfig.jobId || targetConfig.job_id || args.job_id || args.jobId || '').trim();
	            if (!targetConfig.jobId) return { name, args, result: 'internal_watch(create scheduled_job) requires target.job_id', error: true };
	          } else if (targetType === 'event_queue') {
	            targetConfig.match = targetConfig.match || args.match || undefined;
	          }

	          const onMatch = String(args.on_match || args.onMatch || args.instruction || '').trim();
	          if (!onMatch) return { name, args, result: 'internal_watch(create) requires on_match', error: true };
	          const ttlMsRaw = Number(args.ttl_ms ?? args.ttlMs);
	          const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? Math.floor(ttlMsRaw) : undefined;
	          const condition = args.condition && typeof args.condition === 'object' ? args.condition : {};
	          const sessionHint = getSessionChannelHint(sessionId);

	          let initialObservation: any = undefined;
	          try {
	            initialObservation = observeInternalWatchTarget({
	              id: 'preview',
	              label: String(args.label || 'preview'),
	              createdAt: new Date().toISOString(),
	              updatedAt: new Date().toISOString(),
	              expiresAt: new Date(Date.now() + (ttlMs || 20 * 60 * 1000)).toISOString(),
	              ttlMs: ttlMs || 20 * 60 * 1000,
	              origin: { sessionId },
	              target: { type: targetType as any, config: targetConfig },
	              condition,
	              onMatch,
	              maxFirings: 1,
	              firedCount: 0,
	              status: 'active',
	            }, deps.cronScheduler);
	            if (initialObservation?.text) initialObservation.text = `[${String(initialObservation.text).length} chars]`;
	          } catch (err: any) {
	            return { name, args, result: `internal_watch(create) target validation failed: ${err?.message || err}`, error: true };
	          }

	          const watch = createInternalWatch({
	            id: String(args.id || '').trim() || undefined,
	            label: String(args.label || '').trim() || undefined,
	            ttlMs,
	            origin: {
	              sessionId,
	              channel: sessionHint?.channel === 'telegram' ? 'telegram' : 'web',
	              telegramChatId: Number.isFinite(Number(sessionHint?.chatId)) ? Number(sessionHint?.chatId) : undefined,
	              telegramUserId: Number.isFinite(Number(sessionHint?.userId)) ? Number(sessionHint?.userId) : undefined,
	            },
	            target: { type: targetType as any, config: targetConfig },
	            condition,
	            onMatch,
	            onTimeout: String(args.on_timeout || args.onTimeout || '').trim() || undefined,
	            maxFirings: Number(args.max_firings ?? args.maxFirings) || undefined,
	            initialObservation,
	          });
	          deps.broadcastWS?.({ type: 'internal_watch_created', watch, sessionId });
	          return {
	            name,
	            args,
	            result: JSON.stringify({
	              success: true,
	              action: 'create',
	              watch,
	              message: `Internal watch created: ${watch.label} (${watch.id}), expires ${watch.expiresAt}.`,
	            }, null, 2),
	            error: false,
	          };
	        }

	        return {
	          name,
	          args,
	          result: 'internal_watch requires action: create, list, or cancel',
	          error: true,
	        };
	      }

	      case 'schedule_job': {
        const action = normalizeScheduleJobAction(args.action);
        if (!action) {
          return {
            name,
            args,
            result: 'schedule_job requires a valid action: list, create, update, pause, resume, delete, run_now',
            error: true,
          };
        }

        const requiresConfirm = action === 'create' || action === 'update' || action === 'delete';
        if (requiresConfirm && args.confirm !== true) {
          return {
            name,
            args,
            result: JSON.stringify({
              success: false,
              needs_confirmation: true,
              action,
              message: `Action "${action}" requires explicit confirmation. Re-run with confirm=true after user says yes.`,
            }, null, 2),
            error: true,
          };
        }

        if (action === 'list') {
          const limitRaw = Number(args.limit);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 50;
          const jobs = deps.cronScheduler.getJobs().map(summarizeCronJob).slice(0, limit);
          return {
            name,
            args,
            result: JSON.stringify({ success: true, count: jobs.length, jobs }, null, 2),
            error: false,
          };
        }

        const jobId = String(args.job_id || args.jobId || '').trim();

        if (action === 'create') {
          const instructionPrompt = String(args.instruction_prompt || args.prompt || '').trim();
          if (!instructionPrompt) {
            return { name, args, result: 'schedule_job(create) requires instruction_prompt', error: true };
          }

          const schedule = (args.schedule && typeof args.schedule === 'object') ? args.schedule : {};
          const timezone = String(args.timezone || args.tz || '').trim() || undefined;
          let normalizedSchedule;
          try {
            normalizedSchedule = normalizeScheduleSpec({
              ...schedule,
              kind: schedule.kind || args.kind || 'recurring',
              cron: schedule.cron || args.cron,
              run_at: schedule.run_at || args.run_at,
            }, timezone);
          } catch (err: any) {
            return { name, args, result: err.message, error: true };
          }
          const delivery = (args.delivery && typeof args.delivery === 'object') ? args.delivery : {};
          const channel = normalizeDeliveryChannel(delivery.channel || args.channel);
          const modelOverride = String(args.model_override || args.model || '').trim() || undefined;
          const nameValue = String(args.name || '').trim() || `Scheduled task ${new Date().toLocaleString()}`;

          if (channel !== 'web') {
            return {
              name,
              args,
              result: `Delivery channel "${channel}" is not enabled for scheduler jobs yet. Use channel "web" for now.`,
              error: true,
            };
          }

          const requestedTeamId = String(args.team_id || args.teamId || '').trim() || undefined;
          if (requestedTeamId && !getManagedTeam(requestedTeamId)) {
            return { name, args, result: `Team not found: ${requestedTeamId}`, error: true };
          }
          const requestedSubagentId = requestedTeamId ? undefined : (String(args.subagent_id || '').trim() || undefined);
          const assignmentTarget = requestedTeamId ? 'team' : (requestedSubagentId ? 'subagent' : 'main');

          let created = deps.cronScheduler.createJob({
            name: nameValue,
            prompt: instructionPrompt,
            type: normalizedSchedule.kind === 'one-shot' ? 'one-shot' : 'recurring',
            schedule: normalizedSchedule.kind === 'recurring' ? normalizedSchedule.cron : undefined,
            runAt: normalizedSchedule.kind === 'one-shot' ? normalizedSchedule.runAt : undefined,
            tz: timezone,
            sessionTarget: assignmentTarget === 'main' ? 'main' : 'isolated',
            model: modelOverride,
            subagent_id: requestedSubagentId,
            team_id: requestedTeamId,
            assignmentTarget,
            deliverToMainChannel: assignmentTarget === 'main',
          } as any);
          if (requestedSubagentId) {
            ensureScheduleRuntimeForAgent(requestedSubagentId, {
              scheduleId: created.id,
              scheduleName: created.name,
              prompt: instructionPrompt,
              model: modelOverride,
            });
          }

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'create',
              job: summarizeCronJob(created),
              assigned_team: requestedTeamId || undefined,
              assigned_owner: requestedSubagentId ? { subagent_id: requestedSubagentId, created: false } : { agent_id: 'main', created: false },
              message: requestedTeamId
                ? `Scheduled team job "${created.name}" created for team "${requestedTeamId}".`
                : requestedSubagentId
                ? `Scheduled job "${created.name}" created and assigned to subagent "${requestedSubagentId}".`
                : `Scheduled job "${created.name}" created and assigned to Prometheus itself.`,
            }, null, 2),
            error: false,
          };
        }

        if (!jobId) {
          return { name, args, result: `schedule_job(${action}) requires job_id`, error: true };
        }

        if (action === 'pause') {
          const updated = deps.cronScheduler.updateJob(jobId, { status: 'paused', enabled: false } as any);
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return { name, args, result: JSON.stringify({ success: true, action: 'pause', job: summarizeCronJob(updated) }, null, 2), error: false };
        }

        if (action === 'resume') {
          const updated = deps.cronScheduler.updateJob(jobId, { status: 'scheduled', enabled: true } as any);
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return { name, args, result: JSON.stringify({ success: true, action: 'resume', job: summarizeCronJob(updated) }, null, 2), error: false };
        }

        if (action === 'run_now') {
          const exists = deps.cronScheduler.getJobs().some((j: any) => j.id === jobId);
          if (!exists) return { name, args, result: `Job not found: ${jobId}`, error: true };
          deps.cronScheduler.runJobNow(jobId, { respectActiveHours: false }).catch((err: any) =>
            console.error(`[schedule_job] run_now failed for ${jobId}:`, err?.message || err)
          );
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action: 'run_now', job_id: jobId, message: 'Job queued for immediate run.' }, null, 2),
            error: false,
          };
        }

        if (action === 'delete') {
          const ok = deps.cronScheduler.deleteJob(jobId);
          if (!ok) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return {
            name,
            args,
            result: JSON.stringify({ success: true, action: 'delete', job_id: jobId, message: 'Job deleted.' }, null, 2),
            error: false,
          };
        }

        if (action === 'update') {
          const schedule = (args.schedule && typeof args.schedule === 'object') ? args.schedule : {};
          const patch: Record<string, any> = {};

          if (args.name !== undefined) patch.name = String(args.name || '').trim();
          if (args.instruction_prompt !== undefined || args.prompt !== undefined) {
            patch.prompt = String(args.instruction_prompt || args.prompt || '').trim();
          }
          if (args.timezone !== undefined || args.tz !== undefined) {
            patch.tz = String(args.timezone || args.tz || '').trim();
          }
          if (args.model_override !== undefined || args.model !== undefined) {
            const mv = String(args.model_override || args.model || '').trim();
            patch.model = mv || undefined;
          }
          if (args.delivery !== undefined || args.channel !== undefined) {
            const delivery = (args.delivery && typeof args.delivery === 'object') ? args.delivery : {};
            const channel = normalizeDeliveryChannel(delivery.channel || args.channel);
            if (channel !== 'web') {
              return {
                name,
                args,
                result: `Delivery channel "${channel}" is not enabled for scheduler jobs yet. Use channel "web" for now.`,
                error: true,
              };
            }
            const sessionTarget = String(delivery.session_target || args.session_target || '').toLowerCase();
            if (sessionTarget === 'main' || sessionTarget === 'isolated') patch.sessionTarget = sessionTarget;
            if (sessionTarget === 'main') {
              patch.assignmentTarget = 'main';
              patch.deliverToMainChannel = true;
              patch.subagent_id = undefined;
              patch.team_id = undefined;
            }
          }
          if (args.subagent_id !== undefined) {
            const subagentId = String(args.subagent_id || '').trim();
            if (subagentId) {
              patch.subagent_id = subagentId;
              patch.team_id = undefined;
              patch.assignmentTarget = 'subagent';
              patch.deliverToMainChannel = false;
              patch.sessionTarget = 'isolated';
            } else {
              patch.subagent_id = undefined;
              patch.team_id = undefined;
              patch.assignmentTarget = 'main';
              patch.deliverToMainChannel = true;
              patch.sessionTarget = 'main';
            }
          }
          if (args.team_id !== undefined || args.teamId !== undefined) {
            const teamId = String(args.team_id || args.teamId || '').trim();
            if (teamId && !getManagedTeam(teamId)) {
              return { name, args, result: `Team not found: ${teamId}`, error: true };
            }
            patch.team_id = teamId || undefined;
            if (teamId) {
              patch.subagent_id = undefined;
              patch.assignmentTarget = 'team';
              patch.deliverToMainChannel = false;
              patch.sessionTarget = 'isolated';
            }
          }

          const rawKind = String(schedule.kind || args.kind || '').trim().toLowerCase();
          const hasScheduleUpdate = rawKind || schedule.cron !== undefined || args.cron !== undefined || schedule.run_at !== undefined || args.run_at !== undefined || schedule.text !== undefined || schedule.time !== undefined || schedule.days_of_week !== undefined || schedule.daysOfWeek !== undefined || schedule.repeat !== undefined || schedule.every_hours !== undefined || schedule.everyHours !== undefined || schedule.every_days !== undefined || schedule.everyDays !== undefined;
          if (hasScheduleUpdate) {
            try {
              const normalizedSchedule = normalizeScheduleSpec({
                ...schedule,
                kind: schedule.kind || args.kind || undefined,
                cron: schedule.cron ?? args.cron,
                run_at: schedule.run_at ?? args.run_at,
              }, String(args.timezone || args.tz || '').trim() || undefined);
              patch.type = normalizedSchedule.kind === 'one-shot' ? 'one-shot' : 'recurring';
              if (normalizedSchedule.kind === 'recurring') {
                patch.schedule = normalizedSchedule.cron;
                patch.runAt = null;
              } else {
                patch.runAt = normalizedSchedule.runAt;
                patch.schedule = null;
              }
            } catch (err: any) {
              return { name, args, result: err.message, error: true };
            }
          }

          if (Object.keys(patch).length === 0) {
            return { name, args, result: 'No update fields provided for schedule_job(update).', error: true };
          }

          if (patch.type === 'one-shot' && !patch.runAt) {
            return { name, args, result: 'Updating to one_shot requires schedule.run_at', error: true };
          }
          if (patch.type === 'recurring' && patch.schedule === '') {
            return { name, args, result: 'Updating to recurring requires schedule.cron', error: true };
          }
          if (patch.runAt) {
            const parsed = new Date(String(patch.runAt));
            if (!Number.isFinite(parsed.getTime())) {
              return { name, args, result: `Invalid run_at value: "${patch.runAt}"`, error: true };
            }
            patch.runAt = parsed.toISOString();
          }

          let updated = deps.cronScheduler.updateJob(jobId, patch as any);
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          if (String(updated.team_id || '').trim()) {
            return {
              name,
              args,
              result: JSON.stringify({
                success: true,
                action: 'update',
                job: summarizeCronJob(updated),
                assigned_team: updated.team_id,
                message: `Scheduled team job "${updated.name}" updated for team "${updated.team_id}".`,
              }, null, 2),
              error: false,
            };
          }
          const ownerId = String(updated.subagent_id || '').trim();
          if (ownerId) {
            ensureScheduleRuntimeForAgent(ownerId, {
              scheduleId: updated.id,
              scheduleName: updated.name,
              prompt: updated.prompt,
              model: updated.model,
            });
          } else if (updated.assignmentTarget !== 'main' || updated.sessionTarget !== 'main' || updated.deliverToMainChannel !== true) {
            updated = deps.cronScheduler.updateJob(updated.id, {
              assignmentTarget: 'main',
              sessionTarget: 'main',
              deliverToMainChannel: true,
            } as any) || updated;
          }
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'update',
              job: summarizeCronJob(updated),
              assigned_owner: ownerId ? { subagent_id: ownerId, created: false } : { agent_id: 'main', created: false },
              message: ownerId
                ? `Scheduled job "${updated.name}" updated and assigned to subagent "${ownerId}".`
                : `Scheduled job "${updated.name}" updated and assigned to Prometheus itself.`,
            }, null, 2),
            error: false,
          };
        }

        return { name, args, result: `Unsupported schedule_job action: ${action}`, error: true };
      }

      case 'schedule_job_history': {
        const out = scheduleJobHistoryTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_detail': {
        const out = scheduleJobDetailTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_log_search': {
        const out = scheduleJobLogSearchTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_patch': {
        const out = scheduleJobPatchTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_outputs': {
        const out = scheduleJobOutputsTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'schedule_job_stuck_control': {
        const out = await scheduleJobStuckControlTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'automation_dashboard': {
        const out = automationDashboardTool(deps.cronScheduler, args);
        return {
          name,
          args,
          result: JSON.stringify(out, null, 2),
          error: !out.success,
        };
      }

      case 'spawn_subagent': {
        // Spawn a specialized sub-agent with restricted tool set
        // This is used by primary agents to delegate work to secondary specialists
        try {
          const subagentId = String(args.subagent_id || '').trim();
          const taskPrompt = String(args.task_prompt || '').trim();
          const runNow = args.run_now !== false;
          const contextData = args.context_data && typeof args.context_data === 'object' ? args.context_data : undefined;
          let createIfMissing = args.create_if_missing && typeof args.create_if_missing === 'object' ? { ...args.create_if_missing } : undefined;

          // from_role: hydrate create_if_missing from the role registry
          const fromRole = args.from_role ? String(args.from_role).trim().toLowerCase() : null;
          if (fromRole) {
            try {
              const configDir = getConfig().getConfigDir ? getConfig().getConfigDir() : path.join(process.cwd(), '.prometheus');
              const registryPath = path.join(configDir, 'agents', `${fromRole}.json`);
              if (fs.existsSync(registryPath)) {
                const roleDef = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
                const specialization = String(args.specialization || createIfMissing?.teamAssignment || createIfMissing?.teamRole || '').trim();
                const roleName = String(roleDef.name || fromRole.charAt(0).toUpperCase() + fromRole.slice(1)).trim();
                const derivedTeamRole = String(createIfMissing?.teamRole || '').trim()
                  || (specialization
                    ? specialization.split(/[.!?\n]/)[0].replace(/^focus on\s+/i, '').slice(0, 80)
                    : roleName);
                const derivedDescription = String(createIfMissing?.description || '').trim()
                  || (specialization || roleDef.description || '');
                const combinedSystemInstructions = [
                  `[BASE PRESET ROLE - ${roleName}]`,
                  String(roleDef.system_prompt || '').trim(),
                  ``,
                  `[SUBAGENT SPECIALIZATION - ${derivedTeamRole}]`,
                  specialization || 'No specialization was provided. Infer the assignment from the direct task message.',
                  ``,
                  `When the specialization conflicts with the generic preset, follow the specialization while preserving the preset's quality bar and deliverable discipline.`,
                ].filter(Boolean).join('\n');
                // Merge registry definition into create_if_missing (caller fields take priority)
                createIfMissing = {
                  name: createIfMissing?.name,
                  description: derivedDescription,
                  system_instructions: createIfMissing?.system_instructions || combinedSystemInstructions,
	                  forbidden_tools: createIfMissing?.forbidden_tools || [],
                  constraints: createIfMissing?.constraints || [],
                  success_criteria: createIfMissing?.success_criteria || `Complete the assigned task and post the done signal.`,
                  max_steps: createIfMissing?.max_steps || 20,
                  model: createIfMissing?.model || roleDef.model || undefined,
                  roleType: fromRole,
                  teamRole: derivedTeamRole,
                  teamAssignment: String(createIfMissing?.teamAssignment || specialization || '').trim(),
                  baseRolePrompt: String(roleDef.system_prompt || '').trim(),
                };
              } else {
                console.warn(`[spawn_subagent] Role registry file not found: ${registryPath}`);
              }
            } catch (roleErr: any) {
              console.warn(`[spawn_subagent] Failed to load role "${fromRole}": ${roleErr.message}`);
            }
          }

          if (createIfMissing) {
            if (args.personality_style !== undefined && createIfMissing.personality_style === undefined) {
              createIfMissing.personality_style = String(args.personality_style || '').trim();
            }
            if (args.name_style !== undefined && createIfMissing.name_style === undefined) {
              createIfMissing.name_style = String(args.name_style || '').trim();
            }
          }

          if (!subagentId) {
            return { name, args, result: 'spawn_subagent requires subagent_id', error: true };
          }
          if (runNow && !taskPrompt) {
            return { name, args, result: 'spawn_subagent requires task_prompt when run_now=true', error: true };
          }

          // Get workspace path from config
          const workspacePath = getConfig().getConfig().workspace?.path || process.cwd();

          // Create SubagentManager with broadcast + deps.handleChat (Piece 3)
          const subagentMgr = new SubagentManager(workspacePath, deps.broadcastWS, deps.handleChat, deps.telegramChannel);

          // Call the subagent (creates if missing)
          const result = await subagentMgr.callSubagent(
            {
              subagent_id: subagentId,
              task_prompt: taskPrompt,
              run_now: runNow,
              context_data: contextData,
              create_if_missing: createIfMissing,
            },
            sessionId // parent task ID (session context)
          );

          return {
            name,
            args,
            result: JSON.stringify(result, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `spawn_subagent error: ${err.message}`, error: true };
        }
      }

      case 'team_manage': {
        try {
          const action = String(args.action || '').trim().toLowerCase();
          if (!action) {
            return { name, args, result: 'team_manage requires action: list|create|set_allowed_work_paths|start|trigger_review|dispatch|pause|resume', error: true };
          }

          if (action === 'list') {
            const teams = listManagedTeams().map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              emoji: t.emoji,
              subagentIds: t.subagentIds,
              allowedWorkPaths: Array.isArray((t as any).allowedWorkPaths) ? (t as any).allowedWorkPaths : [],
              teamContext: String(t.teamContext || '').slice(0, 220),
              reviewTrigger: t.manager.reviewTrigger,
              paused: t.manager?.paused === true,
              lastReviewAt: t.manager.lastReviewAt || null,
              totalRuns: t.totalRuns || 0,
            }));
            return {
              name,
              args,
              result: JSON.stringify({ success: true, action: 'list', count: teams.length, teams }, null, 2),
              error: false,
            };
          }

          if (action === 'create') {
            const teamName = String(args.name || '').trim();
            const teamContext = String(args.team_context || args.teamContext || args.purpose || '').trim();
            if (!teamName || !teamContext) {
              return { name, args, result: 'team_manage(create) requires name and team_context (or purpose)', error: true };
            }

            const requestedIds = Array.isArray(args.subagent_ids)
              ? args.subagent_ids.map((v: any) => deps.sanitizeAgentId(v)).filter(Boolean)
              : [];
            const memberIds = new Set<string>(requestedIds);
            const createdSubagents: Array<{ subagent_id: string; status: string }> = [];

            // create_subagents path is disabled — agents must be pre-created via spawn_subagent(run_now:false)
            if (Array.isArray(args.create_subagents) && args.create_subagents.length > 0) {
              return {
                name, args,
                result: 'ERROR: create_subagents is not supported. CORRECT WORKFLOW:\n  STEP 1: Call spawn_subagent(subagent_id, run_now:false, create_if_missing:{...}) for each agent.\n  STEP 2: Then call team_manage(action:"create", subagent_ids:[...those IDs...]).\nRetry from STEP 1.',
                error: true,
              };
            }

            const finalIds = Array.from(memberIds);
            if (finalIds.length === 0) {
              return { name, args, result: 'team_manage(create) requires at least one subagent_id. WORKFLOW: create agents first with spawn_subagent(run_now:false), then pass their IDs here.', error: true };
            }
            const missing = finalIds.filter((id) => !getAgentById(id));
            if (missing.length > 0) {
              return { name, args, result: `Unknown subagent_ids: ${missing.join(', ')}`, error: true };
            }

            const rawTrigger = String(args.review_trigger || '').trim().toLowerCase();
            const reviewTrigger = (['after_each_run', 'after_all_runs', 'daily', 'manual'].includes(rawTrigger)
              ? rawTrigger
              : 'after_each_run') as 'after_each_run' | 'after_all_runs' | 'daily' | 'manual';

            const purposeStr = args.purpose ? String(args.purpose).slice(0, 1000) : undefined;
            const allowedWorkPaths = Array.isArray(args.allowed_work_paths)
              ? args.allowed_work_paths.map((v: any) => String(v).trim()).filter(Boolean)
              : Array.isArray(args.allowedWorkPaths)
                ? args.allowedWorkPaths.map((v: any) => String(v).trim()).filter(Boolean)
                : [];
	            const team = createManagedTeam({
              name: teamName.slice(0, 80),
              description: String(args.description || '').slice(0, 300),
              emoji: String(args.emoji || '🏠').slice(0, 4),
              subagentIds: finalIds,
              purpose: purposeStr,
              teamContext: teamContext.slice(0, 1000),
              managerSystemPrompt: String(
                args.manager_system_prompt || `You are the manager of the "${teamName}" team. Your purpose is: ${purposeStr || teamContext}`
              ).slice(0, 2000),
              managerModel: args.manager_model ? String(args.manager_model) : undefined,
              allowedWorkPaths,
              reviewTrigger,
	              originatingSessionId: args.originating_session_id ? String(args.originating_session_id) : undefined,
	            });
            const claimedSubagents = finalIds
              .map((id) => ({ subagent_id: id, ...(claimAgentForTeamWorkspace(team.id, id) || {}) }))
              .filter((entry) => !!entry.identityPath);
	            deps.bindTeamNotificationTargetFromSession(team.id, sessionId, 'team_manage:create');

            // Default false — team must be explicitly started via trigger_review or the Start button.
            // Auto-kickoff was removed: teams should wait for the user to assign a first task.
            const kickoffInitial = args.kickoff_initial_review === true;
            const kickoffSecondsRaw = Number(args.kickoff_after_seconds);
            const kickoffSeconds = Number.isFinite(kickoffSecondsRaw)
              ? Math.max(5, Math.min(300, Math.floor(kickoffSecondsRaw)))
              : 30;
            const kickoffAt = kickoffInitial ? Date.now() + (kickoffSeconds * 1000) : null;
            if (kickoffInitial) {
              setTimeout(() => {
                triggerManagerReview(team.id, deps.broadcastTeamEvent).catch(err =>
                  console.error('[Teams] Initial manager review failed:', err?.message || err)
                );
              }, kickoffSeconds * 1000);
            }

            deps.broadcastTeamEvent({
              type: 'team_created',
              teamId: team.id,
              teamName: team.name,
              teamEmoji: team.emoji,
              subagentIds: team.subagentIds,
              kickoffAt,
            });

            return {
              name,
              args,
              result: JSON.stringify({
                success: true,
                action: 'create',
                team: {
                  id: team.id,
                  name: team.name,
                  description: team.description,
                  emoji: team.emoji,
                  subagentIds: team.subagentIds,
                  reviewTrigger: team.manager.reviewTrigger,
	                },
	                createdSubagents,
	                claimedSubagents,
	                kickoffScheduled: kickoffInitial,
                kickoffAfterSeconds: kickoffInitial ? kickoffSeconds : null,
                kickoffAt,
              }, null, 2),
              error: false,
            };
          }

          if (action === 'set_allowed_work_paths' || action === 'set_allowed_paths' || action === 'update_allowed_work_paths') {
            const teamId = String(args.team_id || args.teamId || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(set_allowed_work_paths) requires team_id', error: true };
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            const rawPaths = Array.isArray(args.allowed_work_paths)
              ? args.allowed_work_paths
              : Array.isArray(args.allowedWorkPaths)
                ? args.allowedWorkPaths
                : Array.isArray(args.paths)
                  ? args.paths
                  : [];
            team.allowedWorkPaths = rawPaths.map((v: any) => String(v).trim()).filter(Boolean);
            team.updatedAt = Date.now();
            saveManagedTeam(team);
            deps.broadcastTeamEvent({
              type: 'team_updated',
              teamId: team.id,
              teamName: team.name,
              allowedWorkPaths: team.allowedWorkPaths,
            });
            return {
              name,
              args,
              result: JSON.stringify({ success: true, action, team_id: team.id, allowedWorkPaths: team.allowedWorkPaths }, null, 2),
              error: false,
            };
          }

          if (action === 'trigger_review') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(trigger_review) requires team_id', error: true };
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:trigger_review');
            if (team.manager?.paused === true) {
              return { name, args, result: `Team "${team.name}" is paused. Resume it before triggering review.`, error: true };
            }
            const result = await triggerManagerReview(teamId, deps.broadcastTeamEvent);
            return {
              name,
              args,
              result: JSON.stringify({ success: true, action: 'trigger_review', teamId, result }, null, 2),
              error: false,
            };
          }

          if (action === 'start') {
            const teamId = String(args.team_id || '').trim();
            const kickoffTaskRaw = String(args.task || '').trim().slice(0, 2000);
            const kickoffTask = (!kickoffTaskRaw || /^n\/?a$/i.test(kickoffTaskRaw)) ? 'N/A' : kickoffTaskRaw;
            if (!teamId) return { name, args, result: 'team_manage(start) requires team_id', error: true };
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:start');
            if (team.manager?.paused === true) {
              deps.resumeManagedTeamInternal(teamId);
            }

            const chatMsg = appendTeamChat(teamId, {
              from: 'user',
              fromName: 'Team Owner',
              content: `Session started (task: ${kickoffTask})`,
            });
            deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, text: chatMsg?.content || '' });

            const purpose = String(
              (team as any)?.purpose
              || team?.mission
              || team?.teamContext
              || team?.description
              || '(no purpose set)',
            ).trim();
            const startPrompt = [
              `[TEAM SESSION STARTED by team owner]`,
              ``,
              `Read the team purpose and current task, then decide which subagents should run now and with what instructions.`,
              `Do NOT launch every subagent by default. Dispatch only the right agents for this run.`,
              ``,
              `Team purpose: ${purpose}`,
              `Current task: ${kickoffTask}`,
              ``,
              `Review what has already been done (team chat + memory files), identify next steps,`,
              `and begin dispatching agents to make concrete progress.`,
              `Work autonomously - dispatch agents, review results, and continue until progress is made`,
              `or you need to ask the team owner a question.`,
            ].join('\n');

            handleManagerConversation(teamId, startPrompt, deps.broadcastTeamEvent, true).catch((err: any) =>
              console.error('[team_manage:start] Coordinator start failed:', err?.message || err)
            );

            return {
              name,
              args,
              result: JSON.stringify({ success: true, action: 'start', teamId, started: true }, null, 2),
              error: false,
            };
          }

          if (action === 'dispatch') {
            const teamId = String(args.team_id || '').trim();
            const agentId = String(args.agent_id || '').trim();
            const task = String(args.task || '').trim();
            const context = args.context ? String(args.context) : undefined;
            if (!teamId || !agentId || !task) {
              return { name, args, result: 'team_manage(dispatch) requires team_id, agent_id, and task', error: true };
            }
            const team = getManagedTeam(teamId);
            if (!team) return { name, args, result: `Team not found: ${teamId}`, error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:dispatch');
            if (team.manager?.paused === true) {
              return { name, args, result: `Team "${team.name}" is paused. Resume it before dispatching tasks.`, error: true };
            }
            if (!team.subagentIds.includes(agentId)) {
              return { name, args, result: `Agent "${agentId}" is not a member of team "${team.name}"`, error: true };
            }

            const dispatchChatMsg = appendTeamChat(teamId, {
              from: 'manager',
              fromName: 'Manager',
              content: `Dispatched one-off task to ${agentId}: ${task}`,
            });
            deps.broadcastTeamEvent({
              type: 'team_chat_message',
              teamId,
              teamName: team.name,
              chatMessage: dispatchChatMsg,
              text: dispatchChatMsg?.content || '',
            });
            deps.broadcastTeamEvent({ type: 'team_dispatch', teamId, teamName: team.name, agentId, task });

            (async () => {
              try {
                const dispatchPrompt = buildTeamDispatchTaskLazy({
                  agentId,
                  task,
                  teamId,
                  context,
                });
                const startedAt = Date.now();
                const result = await deps.runTeamAgentViaChat(agentId, dispatchPrompt.effectiveTask, teamId);
                const finishedAt = Date.now();
                recordAgentRun({
                  agentId,
                  agentName: result.agentName,
                  trigger: 'team_dispatch',
                  success: result.success,
                  startedAt,
                  finishedAt,
                  durationMs: result.durationMs,
                  stepCount: result.stepCount,
                  error: result.error,
                  resultPreview: result.success ? String(result.result || '') : undefined,
                });
                const resultChatMsg = appendTeamChat(teamId, {
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
                deps.broadcastTeamEvent({
                  type: 'team_chat_message',
                  teamId,
                  teamName: team.name,
                  chatMessage: resultChatMsg,
                  text: resultChatMsg?.content || '',
                });
                deps.broadcastTeamEvent({
                  type: 'team_dispatch_complete',
                  teamId,
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
                  teamId,
                  agentId,
                  task,
                  result.success ? String(result.result || '') : `Task failed: ${result.error || 'unknown error'}`,
                  deps.broadcastTeamEvent,
                );
              } catch (err: any) {
                const failedChatMsg = appendTeamChat(teamId, {
                  from: 'subagent',
                  fromName: agentId,
                  fromAgentId: agentId,
                  content: `Dispatch failed: ${err.message}`,
                });
                deps.broadcastTeamEvent({
                  type: 'team_chat_message',
                  teamId,
                  teamName: team.name,
                  chatMessage: failedChatMsg,
                  text: failedChatMsg?.content || '',
                });
              }
            })();

            return {
              name,
              args,
              result: JSON.stringify({ success: true, action: 'dispatch', teamId, agentId, message: 'Dispatch queued' }, null, 2),
              error: false,
            };
          }

          if (action === 'pause') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(pause) requires team_id', error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:pause');
            const out = deps.pauseManagedTeamInternal(teamId, args.reason ? String(args.reason) : undefined);
            return { name, args, result: JSON.stringify(out, null, 2), error: out.success !== true };
          }

          if (action === 'resume') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(resume) requires team_id', error: true };
            deps.bindTeamNotificationTargetFromSession(teamId, sessionId, 'team_manage:resume');
            const out = deps.resumeManagedTeamInternal(teamId);
            return { name, args, result: JSON.stringify(out, null, 2), error: out.success !== true };
          }

          // ── run_round: trigger a collaborative round (Phase B teams) ───────
          if (action === 'run_round') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(run_round) requires team_id', error: true };
            const objective = String(args.objective || args.task || '').trim();
            if (!objective) return { name, args, result: 'team_manage(run_round) requires objective', error: true };
            try {
              const { runCollaborativeRound } = require('../teams/team-round-runner');
              const result = await runCollaborativeRound(
                teamId,
                { description: objective, agentDirectives: args.agent_directives },
                deps.broadcastWS || (() => {}),
              );
              const summary = [
                `Round ${result.roundNumber} complete (${Math.round(result.durationMs / 1000)}s)`,
                `Agents: ${result.agentResults.map((r: any) => `${r.agentName}: ${r.phase}`).join(', ')}`,
                `Manager: ${result.managerSummary.slice(0, 200)}`,
                `Continue: ${result.shouldContinue}`,
              ].join('\n');
              return { name, args, result: summary, error: false };
            } catch (err: any) {
              return { name, args, result: `run_round error: ${err.message}`, error: true };
            }
          }

          // ── run_session: run multiple collaborative rounds until done ─────
          if (action === 'run_session') {
            const teamId = String(args.team_id || '').trim();
            if (!teamId) return { name, args, result: 'team_manage(run_session) requires team_id', error: true };
            const objective = String(args.objective || args.task || '').trim();
            if (!objective) return { name, args, result: 'team_manage(run_session) requires objective', error: true };
            const maxRounds = Number(args.max_rounds) || 5;
            try {
              const { runCollaborativeSession } = require('../teams/team-round-runner');
              const results = await runCollaborativeSession(
                teamId, objective, deps.broadcastWS || (() => {}), maxRounds,
              );
              const summary = [
                `Collaborative session complete: ${results.length} round(s)`,
                ...results.map((r: any) => `  Round ${r.roundNumber}: ${r.managerSummary.slice(0, 100)}`),
              ].join('\n');
              return { name, args, result: summary, error: false };
            } catch (err: any) {
              return { name, args, result: `run_session error: ${err.message}`, error: true };
            }
          }

          return { name, args, result: `Unsupported team_manage action: ${action}`, error: true };
        } catch (err: any) {
          return { name, args, result: `team_manage error: ${err.message}`, error: true };
        }
      }

      case 'ask_team_coordinator': {
        // One-shot meta-coordinator: compose and launch a team from the role registry.
        // Returns immediately once the team is created and running — does not monitor it.
        // The team manager loop takes over; results route back via originatingSessionId.
        try {
          const goal = String(args.goal || '').trim();
          const extraContext = String(args.context || '').trim();
          if (!goal) {
            return { name, args, result: 'ask_team_coordinator requires goal', error: true };
          }

          const coordSessionId = `meta_coordinator_${Date.now().toString(36)}`;
          const originatingSessionId = sessionId;
          const configDir = (getConfig() as any).getConfigDir
            ? (getConfig() as any).getConfigDir()
            : path.join(process.cwd(), '.prometheus');
          const registryPath = path.join(configDir, 'agents');

          // Read available roles from registry
          let rolesBlock = '(no role registry found — use spawn_subagent with full create_if_missing)';
          try {
            if (fs.existsSync(registryPath)) {
              const roleFiles = fs.readdirSync(registryPath).filter((f: string) => f.endsWith('.json'));
              const roleLines = roleFiles.map((f: string) => {
                try {
                  const r = JSON.parse(fs.readFileSync(path.join(registryPath, f), 'utf-8'));
                  return `- ${r.role}: ${r.description}`;
                } catch { return null; }
              }).filter(Boolean);
              if (roleLines.length > 0) rolesBlock = roleLines.join('\n');
            }
          } catch {}

          const coordinatorCallerContext = [
            `=== META-COORDINATOR MODE ===`,
            `You are the Team Coordinator for Prometheus. Your ONLY job is to compose and launch ONE team for the given purpose, then return a summary. You do nothing else.`,
            ``,
            `ORIGINATING_SESSION_ID: ${originatingSessionId}`,
            ``,
            `AVAILABLE ROLE TYPES (role registry):`,
            rolesBlock,
            ``,
            `YOUR WORKFLOW (execute immediately, no clarifying questions):`,
            `0. Run memory_search for the goal and additional context before creating anything. Use relevant business/user/project memory to enrich the team purpose, role specializations, and context references.`,
            `1. Analyze the purpose — pick 2-4 roles that cover the ongoing work`,
            `2. For each role, call spawn_subagent with:`,
            `   - subagent_id: "<role>_<shortname>_v1" (e.g. "researcher_growth_v1")`,
            `   - from_role: "<role>" (e.g. "researcher")`,
            `   - specialization: a concrete team-specific assignment, not a generic role. Examples: "Prospect Researcher: finds local small-business leads from maps/directories/search"; "Website/SEO Qualifier: reviews each lead's site quality, trust signals, UX, and basic SEO gaps"; "Lead Enricher: gathers contact info, socials, owner names, and outreach angle when available".`,
            `   - optional create_if_missing.teamRole: a short title like "Website/SEO Qualifier"`,
            `   - optional create_if_missing.teamAssignment: the full concrete assignment if it needs more detail than specialization`,
            `   - run_now: false`,
            `3. Call team_manage(action="create") with:`,
            `   - name, purpose (the static team purpose — NOT a one-time task), subagent_ids (all created agents)`,
            `   - originating_session_id: "${originatingSessionId}"`,
            `   PURPOSE NOTE: The team's purpose is static ("why this team exists"). Each run, the coordinator reads memory files and generates a fresh task from accumulated context. Do NOT set purpose to a one-time task — it should be an enduring mandate.`,
            `4. Respond with a brief summary: team name, team_id, agents created, purpose, status "ready (not started)".`,
            `5. End with this exact follow-up question to the main agent:`,
            `   "Team is ready. Would you like to start it now? If yes, what should the first task be?"`,
            `   Mention that team_info.md was created automatically in the team workspace and that context reference cards should be used for relevant memory/context found during preflight.`,
            ``,
            `STRICT RULES:`,
            `- Maximum 5 agents`,
            `- Do NOT ask questions — make decisions and act`,
            `- Do NOT use browser, desktop, scheduling, or memory tools`,
            `- Exception: do use memory_search before creating agents or the team`,
            `- Do NOT create nested teams`,
            `- NEVER start the team from this meta-coordinator flow. "Create now" means create the team now, not run it. The main chat agent or user must explicitly call team_manage(action="start") later with a first task.`,
            `- Do NOT call team_manage(action="start"), team_manage(action="dispatch"), dispatch_team_agent, schedule_job(action="run_now"), or kickoff_initial_review:true in this flow.`,
            `- Do NOT inspect random workspace files, pending tasks, or agent_info on the team ID after setup`,
            `- team_ops tools are available in this coordinator session. Do NOT claim tooling limitations or say a team_ops tool is unavailable unless you actually called it and received an explicit tool error in this turn`,
            `- Your session ends after the summary — the team manager takes over`,
            `=== END META-COORDINATOR MODE ===`,
          ].join('\n');

          // Pre-activate team_ops so spawn_subagent/team_manage/manage_team_goal
          // are available from turn 1 — don't rely on intent detection.
          // request_tool_category remains available as core tool for any other
          // categories the coordinator might need as a last resort.
          activateToolCategory(coordSessionId, 'team_ops');

          // Resolve coordinator model from settings (agent_model_defaults.coordinator)
          const coordModelStr: string | undefined = (getConfig().getConfig() as any)?.agent_model_defaults?.coordinator;

          // Forward coordinator tool activity to the originating chat session's process log via WS.
          // The main chat is blocked waiting for this tool result — broadcasting via WS lets
          // the frontend show coordinator progress in the process log without hanging silently.
          const coordForwardSse = (event: string, data: any) => {
            if (!data || typeof data !== 'object') return;
            let msg: string | null = null;
            if (event === 'tool_call' && data.action) {
              const argsPreview = data.args ? ' ' + JSON.stringify(data.args).slice(0, 100) : '';
              msg = `${data.action}${argsPreview}`;
            } else if (event === 'tool_result' && data.action) {
              const ok = !data.error;
              const preview = String(data.result || '').slice(0, 120);
              msg = `${data.action} ${ok ? '✓' : '✗'}${preview ? ' — ' + preview : ''}`;
            } else if (event === 'info' && data.message) {
              msg = String(data.message).slice(0, 150);
            }
            if (msg) {
              deps.broadcastWS({
                type: 'coordinator_progress',
                sessionId: originatingSessionId,
                message: msg,
              });
            }
          };

          // Snapshot existing teams so we can verify the coordinator actually
          // created one. The coordinator is a sub-session that can hallucinate a
          // "team created" summary without ever calling team_manage(create); if we
          // return success unconditionally the main agent reports a phantom team
          // that never appears in the UI.
          const beforeTeamIds = new Set(listManagedTeams().map((t: any) => String(t.id)));
          const coordStartedAt = Date.now();

          const result = await deps.handleChat(
            goal + (extraContext ? `\n\nAdditional context: ${extraContext}` : ''),
            coordSessionId,
            coordForwardSse,
            undefined,
            undefined,
            coordinatorCallerContext,
            coordModelStr || undefined,
            'background_task',
          );

          const createdTeams = listManagedTeams().filter((t: any) => {
            if (beforeTeamIds.has(String(t.id))) return false;
            return t.originatingSessionId === originatingSessionId
              || Number(t.createdAt || 0) >= coordStartedAt;
          });

          if (createdTeams.length === 0) {
            return {
              name,
              args,
              result: JSON.stringify({
                success: false,
                error: 'Coordinator finished but no team was actually created (no team_manage(action="create") persisted). Do NOT tell the user a team was created. Retry ask_team_coordinator, or create the team directly with spawn_subagent + team_manage(action="create").',
                coordinator_summary: String(result?.text || '').slice(0, 1200),
                originating_session: originatingSessionId,
              }, null, 2),
              error: true,
            };
          }

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              teams_created: createdTeams.map((t: any) => ({
                team_id: String(t.id),
                name: String(t.name || ''),
                purpose: String(t.purpose || '').slice(0, 300),
                agent_count: Array.isArray(t.subagentIds) ? t.subagentIds.length : 0,
              })),
              coordinator_summary: String(result?.text || '').slice(0, 1200),
              originating_session: originatingSessionId,
              next_step: 'ask_user_for_first_task_before_starting_team',
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `ask_team_coordinator error: ${err.message}`, error: true };
        }
      }

      case 'switch_model': {
        const tier = String(args.tier || '').trim().toLowerCase();
        const reason = String(args.reason || tier + ' tier switch').trim();
        if (tier !== 'low' && tier !== 'medium') {
          return { name, args, result: 'switch_model: tier must be "low" or "medium"', error: true };
        }
        const cfg = (getConfig().getConfig() as any);
        const defaults = cfg?.agent_model_defaults || {};
        const configKey = tier === 'low' ? 'switch_model_low' : 'switch_model_medium';
        const configuredModel: string | undefined = defaults[configKey];
        if (!configuredModel) {
          return { name, args, result: `switch_model: no model configured for tier "${tier}" — set agent_model_defaults.${configKey} in Settings → Agent Model Defaults`, error: true };
        }
        const slashIdx = configuredModel.indexOf('/');
        if (slashIdx < 1) {
          return { name, args, result: `switch_model: invalid config for "${configKey}" — expected "provider/model" format, got "${configuredModel}"`, error: true };
        }
        const providerId = configuredModel.slice(0, slashIdx);
        const model = configuredModel.slice(slashIdx + 1);
        const { setTurnModelOverride } = require('../chat/model-switch-state');
        setTurnModelOverride(sessionId, { providerId, model, reason, tier });
        return { name, args, result: `Switched to ${tier} tier: ${configuredModel}. Reverts automatically at end of turn.`, error: false };
      }

      case 'parse_schedule_pattern': {
        const text = String(args.text || '').trim();
        if (!text) {
          return { name, args, result: 'parse_schedule_pattern requires text parameter', error: true };
        }

        try {
          const normalized = parseSchedulePattern(text, args.timezone || 'UTC');
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              kind: normalized.kind,
              cron: normalized.kind === 'recurring' ? normalized.cron : undefined,
              run_at: normalized.kind === 'one-shot' ? normalized.runAt : undefined,
              preview: normalized.preview,
              timezone: args.timezone || 'UTC',
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `parse_schedule_pattern error: ${err.message}`, error: true };
        }
      }

      // Browser automation tools
      case 'browser_doctor': {
        const result = await browserDoctor(sessionId);
        await broadcastBrowserStatus('browser_doctor');
        return { name, args, result, error: /\bFAIL\b/.test(result) };
      }
      case 'browser_set_profile_target': {
        const result = await browserSetProfileTarget(sessionId, args.target || 'prometheus', {
          closeExisting: args.close_existing !== false,
          profileDirectory: args.profile_directory ?? args.profileDirectory,
        });
        await broadcastBrowserStatus('browser_set_profile_target');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_open': {
        const timeoutMs = resolveBoundedToolTimeoutMs(args, 60000, 120000);
        let result: string;
        try {
          result = await withBoundedToolTimeout(browserOpen(sessionId, args.url || '', {
            observe: resolveBrowserObserveMode('browser_open', args.observe),
            target: args.target != null ? String(args.target) : (args.profile != null ? String(args.profile) : undefined),
            inhouseProfile: args.inhouse_profile ?? args.inhouseProfile,
            profileDirectory: args.profile_directory ?? args.profileDirectory,
          }), timeoutMs, 'browser_open');
        } catch (err: any) {
          result = `ERROR: browser_open did not finish in time: ${err?.message || err}`;
        }
        await broadcastBrowserStatus('browser_open');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_snapshot': {
        const result = await browserSnapshot(sessionId);
        await broadcastBrowserStatus('browser_snapshot');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_list_tabs': {
        const result = await browserListTabs(sessionId);
        await broadcastBrowserStatus('browser_list_tabs');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_select_tab': {
        const result = await browserSelectTab(sessionId, Number(args.index || 0));
        await broadcastBrowserStatus('browser_select_tab');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_new_tab': {
        const result = await browserNewTab(sessionId, args.url != null ? String(args.url) : undefined);
        await broadcastBrowserStatus('browser_new_tab');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_close_tab': {
        const result = await browserCloseTab(sessionId, args.index != null ? Number(args.index) : undefined);
        await broadcastBrowserStatus('browser_close_tab');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_click': {
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        const hasFinalActionApproval = !!finalActionApprovalId;
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const result = await browserClick(sessionId, {
          ref: args.ref != null ? Number(args.ref) : undefined,
          element: args.element != null ? String(args.element) : (args.element_name != null ? String(args.element_name) : undefined),
          selector: args.selector != null ? String(args.selector) : undefined,
        }, {
          observe: resolveBrowserObserveMode('browser_click', hasFinalActionApproval ? 'snapshot' : (args.capture_after === true ? 'snapshot' : args.observe)),
        });
        await broadcastBrowserStatus('browser_click');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_fill': {
        const result = await browserFill(sessionId, {
          ref: args.ref != null ? Number(args.ref) : undefined,
          element: args.element != null ? String(args.element) : (args.element_name != null ? String(args.element_name) : undefined),
          selector: args.selector != null ? String(args.selector) : undefined,
        }, String(args.text || ''), {
          observe: resolveBrowserObserveMode('browser_fill', args.capture_after === true ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_fill');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_upload_file': {
        const result = await browserUploadFile(sessionId, {
          ref: args.ref != null ? Number(args.ref) : undefined,
          selector: args.selector != null ? String(args.selector) : undefined,
          file_path: args.file_path != null ? String(args.file_path) : undefined,
          file_paths: Array.isArray(args.file_paths) ? args.file_paths.map((value: any) => String(value)) : undefined,
          observe: resolveBrowserObserveMode('browser_upload_file', args.observe),
        });
        await broadcastBrowserStatus('browser_upload_file');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_press_key':
      case 'browser_key': {
        const keyToolName = name === 'browser_key' ? 'browser_key' : 'browser_press_key';
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        const hasFinalActionApproval = !!finalActionApprovalId;
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: keyToolName, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const result = await browserPressKey(sessionId, String(args.key || 'Enter'), {
          observe: resolveBrowserObserveMode(keyToolName, hasFinalActionApproval ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_press_key');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_type': {
        const result = await browserType(sessionId, String(args.text || ''), {
          observe: resolveBrowserObserveMode('browser_type', args.capture_after === true ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_type');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_wait': {
        const result = await browserWait(sessionId, Number(args.ms || 2000), {
          observe: resolveBrowserObserveMode('browser_wait', args.observe),
        });
        await broadcastBrowserStatus('browser_wait');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_scroll': {
        const dir = String(args.direction || 'down').toLowerCase() === 'up' ? 'up' : 'down';
        const result = await browserScroll(sessionId, dir, Number(args.multiplier || 1), {
          observe: resolveBrowserObserveMode('browser_scroll', args.capture_after === true ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_scroll');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_drag': {
        const result = await browserDrag(sessionId, {
          from_ref: args.from_ref != null ? Number(args.from_ref) : undefined,
          to_ref: args.to_ref != null ? Number(args.to_ref) : undefined,
          from_x: args.from_x != null ? Number(args.from_x) : undefined,
          from_y: args.from_y != null ? Number(args.from_y) : undefined,
          to_x: args.to_x != null ? Number(args.to_x) : undefined,
          to_y: args.to_y != null ? Number(args.to_y) : undefined,
          steps: args.steps != null ? Number(args.steps) : undefined,
          observe: resolveBrowserObserveMode('browser_drag', args.capture_after === true ? 'snapshot' : args.observe),
        });
        await broadcastBrowserStatus('browser_drag');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_click_and_download': {
        const result = await browserClickAndDownload(sessionId, Number(args.ref || 0), {
          timeout_ms: args.timeout_ms != null ? Number(args.timeout_ms) : undefined,
          filename_hint: args.filename_hint != null ? String(args.filename_hint) : undefined,
          output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
          observe: resolveBrowserObserveMode('browser_click_and_download', args.observe),
        });
        await broadcastBrowserStatus('browser_click_and_download');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_close': {
        const result = await browserClose(sessionId);
        await broadcastBrowserStatus('browser_close');
        return { name, args, result, error: false };
      }
      case 'browser_get_focused_item': {
        const result = await browserGetFocusedItem(sessionId);
        await broadcastBrowserStatus('browser_get_focused_item');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_get_page_text': {
        const result = await browserGetPageText(sessionId, {
          element: args.element != null ? String(args.element) : (args.element_name != null ? String(args.element_name) : ''),
        });
        await broadcastBrowserStatus('browser_get_page_text');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_send_to_telegram': {
        const caption = String(args.caption || 'Browser screenshot');
        const delivered = await executeDeliverySendScreenshot({ source: 'browser_new', target: 'telegram', caption }, workspacePath, deps, sessionId);
        await broadcastBrowserStatus('browser_send_to_telegram');
        return { name, args, result: delivered.result, error: delivered.error };
      }

      // Vision fallback tools (Component 3)
      case 'browser_vision_screenshot': {
        const vshot = await browserVisionScreenshot(sessionId);
        if (!vshot) return { name, args, result: 'ERROR: No browser session. Use browser_open first.', error: true };
        await broadcastBrowserStatus('browser_vision_screenshot');
        // Return metadata text; chat.router injects the cached PNG as a user image
        // for vision-capable primaries right after this tool result.
        return {
          name, args,
          result: `Viewport screenshot captured (${vshot.width}x${vshot.height}). Vision advisor will use this to identify coordinates. Call browser_vision_click(x, y) with the coordinates returned by the advisor.`,
          error: false,
        };
      }
      case 'browser_vision_click': {
        const result = await browserVisionClick(
          sessionId,
          Number(args.x),
          Number(args.y),
          String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          { observe: resolveBrowserObserveMode('browser_vision_click', args.observe) },
        );
        await broadcastBrowserStatus('browser_vision_click');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_vision_type': {
        const result = await browserVisionType(
          sessionId,
          Number(args.x),
          Number(args.y),
          String(args.text || ''),
          { observe: resolveBrowserObserveMode('browser_vision_type', args.observe) },
        );
        await broadcastBrowserStatus('browser_vision_type');
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Browser power tools
      case 'browser_scroll_collect': {
        const shouldUseStructuredCollect =
          !!(args.schema
          || args.schema_name
          || args.use_schema
          || args.item_root
          || args.root_name
          || args.container_name
          || args.fields
          || args.save_as);
        const result = shouldUseStructuredCollect
          ? await browserScrollCollectV2(sessionId, args || {})
          : await browserScrollCollect(sessionId, {
              scrolls: args.scrolls != null ? Number(args.scrolls) : undefined,
              direction: args.direction === 'up' ? 'up' : 'down',
              multiplier: args.multiplier != null ? Number(args.multiplier) : undefined,
              delay_ms: args.delay_ms != null ? Number(args.delay_ms) : undefined,
              stop_text: args.stop_text != null ? String(args.stop_text) : undefined,
              max_chars: args.max_chars != null ? Number(args.max_chars) : undefined,
              include_initial: args.include_initial != null ? !['false', '0', 'no'].includes(String(args.include_initial).trim().toLowerCase()) : undefined,
              max_seconds: args.max_seconds != null ? Number(args.max_seconds) : undefined,
              stop_after_no_new: args.stop_after_no_new != null ? Number(args.stop_after_no_new) : undefined,
              include_snapshots: args.include_snapshots != null ? !['false', '0', 'no'].includes(String(args.include_snapshots).trim().toLowerCase()) : undefined,
              include_structured: args.include_structured != null ? !['false', '0', 'no'].includes(String(args.include_structured).trim().toLowerCase()) : undefined,
            });
        await broadcastBrowserStatus('browser_scroll_collect');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_scroll_collect_v2': {
        const result = await browserScrollCollectV2(sessionId, args || {});
        await broadcastBrowserStatus('browser_scroll_collect_v2');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_run_js': {
        const result = await browserRunJs(sessionId, String(args.code || ''), {
          observe: resolveBrowserObserveMode('browser_run_js', args.observe),
        });
        await broadcastBrowserStatus('browser_run_js');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_intercept_network': {
        const action = String(args.action || 'read') as 'start' | 'stop' | 'read' | 'clear';
        const result = await browserInterceptNetwork(
          sessionId,
          action,
          args.url_filter != null ? String(args.url_filter) : undefined,
          args.max_entries != null ? Number(args.max_entries) : undefined,
        );
        await broadcastBrowserStatus('browser_intercept_network');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'inspect_console': {
        const maxEntries = Math.max(1, Math.min(500, Number(args.max_entries || 100)));
        const action = String(args.action || 'read').toLowerCase();
        const result = await browserRunJs(sessionId, `
          const g = globalThis;
          if (!g.__promConsoleLog) {
            g.__promConsoleLog = [];
            const push = (entry) => {
              try {
                g.__promConsoleLog.push({ ...entry, ts: Date.now(), url: location.href });
                if (g.__promConsoleLog.length > 1000) g.__promConsoleLog.splice(0, g.__promConsoleLog.length - 1000);
              } catch {}
            };
            for (const level of ['log', 'info', 'warn', 'error']) {
              const original = console[level]?.bind(console);
              console[level] = (...items) => {
                push({ level, message: items.map(item => {
                  try { return typeof item === 'string' ? item : JSON.stringify(item); } catch { return String(item); }
                }).join(' ') });
                return original?.(...items);
              };
            }
            g.addEventListener('error', event => push({ level: 'error', message: event.message || 'window error', source: event.filename, line: event.lineno, column: event.colno }));
            g.addEventListener('unhandledrejection', event => push({ level: 'error', message: 'unhandledrejection: ' + (event.reason?.message || event.reason || '') }));
          }
          if (${JSON.stringify(action)} === 'clear') {
            g.__promConsoleLog = [];
            return { cleared: true, url: location.href, title: document.title };
          }
          return {
            url: location.href,
            title: document.title,
            count: g.__promConsoleLog.length,
            entries: g.__promConsoleLog.slice(-${maxEntries})
          };
        `);
        await broadcastBrowserStatus('inspect_console');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'run_accessibility_check': {
        const maxResults = Math.max(1, Math.min(500, Number(args.max_results || 100)));
        const result = await browserRunJs(sessionId, `
          const findings = [];
          const add = (rule, message, selector, impact = 'moderate') => {
            if (findings.length < ${maxResults}) findings.push({ rule, impact, message, selector });
          };
          const selectorFor = (el) => {
            if (!el) return '';
            if (el.id) return '#' + CSS.escape(el.id);
            const tag = el.tagName ? el.tagName.toLowerCase() : 'element';
            const label = el.getAttribute?.('aria-label') || el.getAttribute?.('name') || el.getAttribute?.('placeholder') || '';
            return label ? tag + '[' + label.slice(0, 40) + ']' : tag;
          };
          if (!document.title || document.title.trim().length < 2) add('document-title', 'Page is missing a useful title.', 'head title', 'serious');
          if (!document.documentElement.lang) add('html-lang', 'html element is missing lang.', 'html', 'serious');
          document.querySelectorAll('img').forEach(img => {
            if (!img.hasAttribute('alt')) add('image-alt', 'Image missing alt attribute.', selectorFor(img));
          });
          document.querySelectorAll('button,input,select,textarea,[role="button"],[role="textbox"],[role="combobox"]').forEach(el => {
            const id = el.id;
            const hasLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) || el.closest('label');
            if (!hasLabel) add('control-label', 'Interactive control may be unlabeled.', selectorFor(el), 'serious');
          });
          const ids = new Map();
          document.querySelectorAll('[id]').forEach(el => {
            const id = el.id;
            if (ids.has(id)) add('duplicate-id', 'Duplicate id: ' + id, selectorFor(el));
            ids.set(id, true);
          });
          document.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (href === '#' || href.toLowerCase().startsWith('javascript:')) add('link-target', 'Link has weak or JavaScript href.', selectorFor(a));
            if (!a.textContent?.trim() && !a.getAttribute('aria-label')) add('link-name', 'Link has no accessible text.', selectorFor(a));
          });
          let previousLevel = 0;
          document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
            const level = Number(h.tagName.slice(1));
            if (previousLevel && level > previousLevel + 1) add('heading-order', 'Heading level jumps from h' + previousLevel + ' to h' + level + '.', selectorFor(h));
            previousLevel = level;
          });
          if (!document.querySelector('main,[role="main"]')) add('landmark-main', 'Page has no main landmark.', 'main');
          return { url: location.href, title: document.title, finding_count: findings.length, findings };
        `);
        await broadcastBrowserStatus('run_accessibility_check');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_smoke_test': {
        const url = String(args.url || '').trim();
        if (!url) return { name, args, result: 'url is required', error: true };
        const openResult = await browserOpen(sessionId, url, { observe: 'compact' });
        await browserWait(sessionId, Math.max(250, Math.min(10000, Number(args.wait_ms || 1500))), { observe: 'none' });
        const snapshot = await browserSnapshot(sessionId);
        const consoleResult = await executeTool('inspect_console', { max_entries: args.max_console_entries || 50 }, workspacePath, deps, sessionId);
        const a11yResult = await executeTool('run_accessibility_check', { max_results: args.max_a11y_results || 50 }, workspacePath, deps, sessionId);
        await broadcastBrowserStatus('browser_smoke_test');
        return {
          name,
          args,
          result: JSON.stringify({
            url,
            open: openResult,
            snapshot: snapshot.slice(0, 5000),
            console: consoleResult.result,
            accessibility: a11yResult.result,
          }, null, 2),
          error: openResult.startsWith('ERROR') || snapshot.startsWith('ERROR') || consoleResult.error || a11yResult.error,
        };
      }
      case 'browser_element_watch': {
        const waitFor = String(args.wait_for || 'appear') as 'appear' | 'disappear' | 'text_contains';
        const result = await browserElementWatch(
          sessionId,
          String(args.selector || ''),
          waitFor,
          args.text != null ? String(args.text) : undefined,
          args.timeout_ms != null ? Number(args.timeout_ms) : undefined,
        );
        await broadcastBrowserStatus('browser_element_watch');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_snapshot_delta': {
        const result = await browserSnapshotDelta(sessionId);
        await broadcastBrowserStatus('browser_snapshot_delta');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_extract_structured': {
        const result = await browserExtractStructured(sessionId, args.schema || args || {});
        await broadcastBrowserStatus('browser_extract_structured');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_teach_verify': {
        const result = await browserTeachVerify(sessionId, args || {});
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Desktop automation tools
      case 'desktop_doctor': {
        const result = await desktopDoctor(sessionId);
        return { name, args, result, error: /\bFAIL\b/.test(result) };
      }
      case 'desktop_screenshot': {
        // Use history-aware wrapper so desktop_diff_screenshot always has a prev packet
        const options = parseDesktopScreenshotToolArgs((args && typeof args === 'object') ? args as any : undefined);
        const result = await desktopScreenshotWithHistory(sessionId, options);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_monitors': {
        const result = await desktopGetMonitorsSummary();
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_screenshot': {
        const result = await desktopWindowScreenshot(sessionId, {
          name: args.name == null ? undefined : String(args.name),
          handle: args.handle == null ? undefined : Number(args.handle),
          active: args.active === true,
          focus_first: args.focus_first == null ? undefined : args.focus_first !== false,
          padding: args.padding == null ? undefined : Number(args.padding),
          mode: String(args.mode || '').toLowerCase() === 'som' || args.som === true ? 'som' : 'normal',
          som: args.som === true || String(args.mode || '').toLowerCase() === 'som',
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_find_window': {
        const result = await desktopFindWindow(String(args.name || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_focus_window': {
        const result = await desktopFocusWindow(String(args.name || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_control': {
        const actionRaw = String(args.action || '').toLowerCase();
        const action =
          actionRaw === 'minimize' || actionRaw === 'maximize' || actionRaw === 'restore' || actionRaw === 'close'
            ? actionRaw
            : 'restore';
        const result = await desktopWindowControl(action, {
          name: args.name == null ? undefined : String(args.name),
          handle: args.handle == null ? undefined : Number(args.handle),
          active: args.active === true,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_click': {
        const clickTarget = {
          x: Number(args.x),
          y: Number(args.y),
          element: args.element == null ? undefined : Number(args.element),
          coordinate_space: args.coordinate_space as any,
          screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          window_name: args.window_name == null ? undefined : String(args.window_name),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          ...parseDesktopPointerMonitorArgs(args),
        };
        let resolved = await resolveDesktopActionPoint(sessionId, clickTarget, 'desktop_click');

        // Auto-retry once when the failure is a stale screenshot_id: recapture the same
        // window (or full screen) and re-resolve with the fresh screenshot_id.
        if (!resolved.ok && clickTarget.screenshot_id) {
          const msg = resolved.message;
          const isStale =
            msg.includes('is stale') ||
            msg.includes('predates desktop action tracking') ||
            /is \d+s old/.test(msg);
          if (isStale) {
            const oldPacket = getDesktopAdvisorPacketById(sessionId, clickTarget.screenshot_id);
            const freshCapture = oldPacket?.targetWindow
              ? await desktopWindowScreenshot(sessionId, {
                  handle: oldPacket.targetWindow.handle,
                  name: oldPacket.targetWindow.title,
                  focus_first: true,
                }).catch(() => null)
              : await desktopScreenshotWithHistory(sessionId).catch(() => null);
            const freshIdMatch = freshCapture?.match(/Screenshot ID:\s*(ds_[^\s.]+)/);
            const freshId = freshIdMatch ? freshIdMatch[1] : null;
            if (freshId) {
              const retryResolved = await resolveDesktopActionPoint(
                sessionId,
                { ...clickTarget, screenshot_id: freshId },
                'desktop_click',
              );
              if (retryResolved.ok) {
                resolved = retryResolved;
              }
            }
          }
        }

        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        if (resolved.ok && finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const hasFinalActionApproval = !!finalActionApprovalId;
        let result = !resolved.ok
          ? `ERROR: ${resolved.message}`
          : await desktopClick(
              resolved.point.x,
              resolved.point.y,
              String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
              args.double_click === true,
              undefined,
              args.modifier === 'shift' || args.modifier === 'ctrl' || args.modifier === 'alt'
                ? args.modifier
                : undefined,
              resolved.point.sourceNote,
              {
                mode: args.verify,
                coordinateSpace: resolved.point.coordinateSpace,
                allowRetryOnLikelyNoop: args.verify === 'strict',
              },
            );
        if (!result.startsWith('ERROR') && (args.capture_after === true || hasFinalActionApproval)) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_drag': {
        const sharedTarget = {
          coordinate_space: args.coordinate_space as any,
          screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          window_name: args.window_name == null ? undefined : String(args.window_name),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          ...parseDesktopPointerMonitorArgs(args),
        };
        const fromPoint = await resolveDesktopActionPoint(sessionId, {
          x: Number(args.from_x),
          y: Number(args.from_y),
          ...sharedTarget,
        }, 'desktop_drag.from');
        const toPoint = fromPoint.ok
          ? await resolveDesktopActionPoint(sessionId, {
              x: Number(args.to_x),
              y: Number(args.to_y),
              ...sharedTarget,
            }, 'desktop_drag.to')
          : fromPoint;
        let result = !fromPoint.ok
          ? `ERROR: ${fromPoint.message}`
          : !toPoint.ok
            ? `ERROR: ${toPoint.message}`
            : await desktopDrag(
                fromPoint.point.x,
                fromPoint.point.y,
                toPoint.point.x,
                toPoint.point.y,
                Number(args.steps || 20),
                undefined,
                `${fromPoint.point.sourceNote} -> ${toPoint.point.sourceNote}`,
                {
                  mode: args.verify,
                  coordinateSpace: fromPoint.point.coordinateSpace,
                },
              );
        if (!result.startsWith('ERROR') && args.capture_after === true) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_wait': {
        const result = await desktopWait(Number(args.ms || 500));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_type': {
        let result = await desktopType(String(args.text || ''));
        if (!result.startsWith('ERROR') && args.capture_after === true) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_press_key': {
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        const hasFinalActionApproval = !!finalActionApprovalId;
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        let result = await desktopPressKey(String(args.key || 'Enter'));
        if (!result.startsWith('ERROR') && hasFinalActionApproval) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_clipboard': {
        const result = await desktopGetClipboard();
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_set_clipboard': {
        const result = await desktopSetClipboard(args || {});
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Phase 4: App launch / process control
      case 'desktop_list_installed_apps': {
        const result = await desktopListInstalledApps(
          String(args.filter || ''),
          Number(args.limit || 40),
          args.refresh === true,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_find_installed_app': {
        const result = await desktopFindInstalledApp(
          String(args.query || ''),
          Number(args.limit || 10),
          args.refresh === true,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_launch_app': {
        const result = await desktopLaunchApp(
          String(args.app || ''),
          String(args.args || ''),
          Number(args.wait_ms || 6000),
          String(args.app_id || ''),
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_close_app': {
        const result = await desktopCloseApp(String(args.name || ''), args.force === true);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_process_list': {
        const result = await desktopGetProcessList(String(args.filter || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Phase 3: Screenshot diffing
      case 'desktop_wait_for_change': {
        const result = await desktopWaitForChange(
          sessionId,
          Number(args.timeout_ms || 10000),
          Number(args.poll_ms || 800),
        );
        return { name, args, result, error: false };
      }
      case 'desktop_diff_screenshot': {
        const result = await desktopDiffScreenshot(sessionId);
        return { name, args, result, error: false };
      }

      // Canonical app / window / state model (Phase 1)
      case 'desktop_list_apps': {
        const result = await desktopListApps(String(args.filter || ''), args.include_windows !== false);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_list_windows': {
        const result = await desktopListWindowsCanonical({
          app_id: args.app_id == null ? undefined : String(args.app_id),
          process_name: args.process_name == null ? undefined : String(args.process_name),
          title: args.title == null ? undefined : String(args.title),
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_window_state': {
        const result = await desktopGetWindowState(sessionId, {
          window_id: args.window_id == null ? undefined : String(args.window_id),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          app_id: args.app_id == null ? undefined : String(args.app_id),
          title: args.title == null ? undefined : String(args.title),
          include_screenshot: args.include_screenshot !== false,
          include_text: args.include_text === true,
          focus_first: args.focus_first === true,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Window-scoped input (Phase 2)
      case 'desktop_window_click': {
        const selector = {
          window_id: args.window_id == null ? undefined : String(args.window_id),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          app_id: args.app_id == null ? undefined : String(args.app_id),
          title: args.title == null ? undefined : String(args.title),
        };
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const result = await desktopWindowClick(
          selector,
          {
            x: Number(args.x),
            y: Number(args.y),
            coordinate_space: args.coordinate_space as any,
            screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          },
          {
            button: String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
            double_click: args.double_click === true,
            modifier: args.modifier === 'shift' || args.modifier === 'ctrl' || args.modifier === 'alt' ? args.modifier : undefined,
            verify: args.verify,
          },
          sessionId,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_type': {
        const result = await desktopWindowType(
          {
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          },
          String(args.text || ''),
          args.raw === true,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_press_key': {
        const finalActionApprovalId = String(args.final_action_approval_id || args.finalActionApprovalId || '').trim();
        if (finalActionApprovalId) {
          const gate = consumeFinalActionApproval({ sessionId, approvalId: finalActionApprovalId, toolName: name, toolArgs: args });
          if (!gate.ok) return { name, args, result: `ERROR: ${gate.message}`, error: true };
        }
        const result = await desktopWindowPressKey(
          {
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          },
          String(args.key || 'Enter'),
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_scroll': {
        const dir = String(args.direction || 'down').toLowerCase();
        const result = await desktopWindowScroll(
          {
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          },
          {
            direction: (dir === 'up' || dir === 'left' || dir === 'right' ? dir : 'down') as 'up' | 'down' | 'left' | 'right',
            amount: args.amount == null ? undefined : Number(args.amount),
            x: args.x == null ? undefined : Number(args.x),
            y: args.y == null ? undefined : Number(args.y),
            coordinate_space: args.coordinate_space as any,
            screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          },
          sessionId,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_window_drag': {
        const result = await desktopWindowDrag(
          {
            window_id: args.window_id == null ? undefined : String(args.window_id),
            window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
            app_id: args.app_id == null ? undefined : String(args.app_id),
            title: args.title == null ? undefined : String(args.title),
          },
          {
            from_x: Number(args.from_x),
            from_y: Number(args.from_y),
            to_x: Number(args.to_x),
            to_y: Number(args.to_y),
            steps: args.steps == null ? undefined : Number(args.steps),
            coordinate_space: args.coordinate_space as any,
            screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          },
          sessionId,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Previously-orphaned tools now wired into the chat/subagent dispatch
      case 'desktop_get_window_text': {
        const result = await desktopGetWindowText(args.window_name == null ? undefined : String(args.window_name));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_get_accessibility_tree': {
        const result = await desktopGetAccessibilityTree(
          args.window_name == null ? undefined : String(args.window_name),
          args.max_depth == null ? undefined : Number(args.max_depth),
          args.max_nodes == null ? undefined : Number(args.max_nodes),
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_pixel_watch': {
        const result = await desktopPixelWatch(
          Number(args.x),
          Number(args.y),
          args.target_color == null ? undefined : String(args.target_color),
          args.timeout_ms == null ? undefined : Number(args.timeout_ms),
          args.poll_ms == null ? undefined : Number(args.poll_ms),
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_record_macro': {
        const result = desktopRecordMacro(String(args.name || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_stop_macro': {
        const result = desktopStopMacro(args.name == null ? undefined : String(args.name));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_replay_macro': {
        const result = await desktopReplayMacro(
          String(args.name || ''),
          args.speed_multiplier == null ? undefined : Number(args.speed_multiplier),
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_list_macros': {
        const result = desktopListMacros();
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_background_status': {
        const result = await desktopBackgroundStatus();
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_background_prepare_sandbox': {
        const result = await desktopBackgroundPrepareSandbox({
          launch: args.launch === true,
          networking: args.networking,
          vgpu: args.vgpu,
          memory_mb: args.memory_mb == null ? undefined : Number(args.memory_mb),
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_background_command': {
        const result = await desktopBackgroundCommand({
          action: args.action,
          x: args.x == null ? undefined : Number(args.x),
          y: args.y == null ? undefined : Number(args.y),
          text: args.text == null ? undefined : String(args.text),
          key: args.key == null ? undefined : String(args.key),
          command: args.command == null ? undefined : String(args.command),
          ms: args.ms == null ? undefined : Number(args.ms),
          timeout_ms: args.timeout_ms == null ? undefined : Number(args.timeout_ms),
        } as any);
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Mouse wheel scroll
      case 'desktop_scroll': {
        const dir = String(args.direction || 'down').toLowerCase();
        const horizontal = String(args.axis || '').toLowerCase() === 'horizontal' || dir === 'left' || dir === 'right';
        const hasTargetingArgs =
          args.x !== undefined ||
          args.y !== undefined ||
          args.coordinate_space !== undefined ||
          args.screenshot_id !== undefined ||
          args.window_name !== undefined ||
          args.window_handle !== undefined ||
          args.monitor_relative === true ||
          args.monitor_relative === 'true';
        let result: string;
        if (hasTargetingArgs) {
          if (args.x === undefined || args.y === undefined) {
            result = 'ERROR: desktop_scroll coordinate targeting requires both x and y.';
          } else {
            const resolved = await resolveDesktopActionPoint(sessionId, {
              x: Number(args.x),
              y: Number(args.y),
              coordinate_space: args.coordinate_space as any,
              screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
              window_name: args.window_name == null ? undefined : String(args.window_name),
              window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
              ...parseDesktopPointerMonitorArgs(args),
            }, 'desktop_scroll');
            result = !resolved.ok
              ? `ERROR: ${resolved.message}`
              : await desktopScroll(
                  dir === 'up' || dir === 'left' ? (dir as 'up' | 'left') : (dir === 'right' ? 'right' : 'down'),
                  Number(args.amount || 3),
                  resolved.point.x,
                  resolved.point.y,
                  horizontal,
                  undefined,
                  resolved.point.sourceNote,
                  {
                    mode: args.verify,
                    coordinateSpace: resolved.point.coordinateSpace,
                  },
                );
          }
        } else {
          result = await desktopScroll(
            dir === 'up' || dir === 'left' ? (dir as 'up' | 'left') : (dir === 'right' ? 'right' : 'down'),
            Number(args.amount || 3),
            undefined,
            undefined,
            horizontal,
            undefined,
            undefined,
            {
              mode: args.verify,
            },
          );
        }
        if (!result.startsWith('ERROR') && args.capture_after === true) {
          const after = await desktopScreenshotWithHistory(sessionId, { capture: 'all' });
          result += `\n\nCapture after action:\n${after}`;
        }
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Raw key-by-key typing fallback (for apps that block clipboard paste)
      case 'desktop_type_raw': {
        const result = await desktopTypeRaw(String(args.text || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Send last screenshot to Telegram
      case 'desktop_send_to_telegram': {
        const caption = String(args.caption || 'Desktop screenshot');
        const delivered = await executeDeliverySendScreenshot({ source: 'desktop_new', target: 'telegram', caption }, workspacePath, deps, sessionId);
        return { name, args, result: delivered.result, error: delivered.error };
      }

      // Phase 5: Structured desktop task runner (removed — module deleted)
      case 'desktop_task': {
        return { name, args, result: 'ERROR: desktop_task is not available (desktop-task-runner module was removed).', error: true };
      }

      case 'agent_list': {
        try {
          const configuredAgents = getAgents();
          if (!configuredAgents || configuredAgents.length === 0) {
            return { name, args, result: 'No agents configured. You can create one via the Agents UI or by defining one in .prometheus/config.json under the "agents" array.', error: false };
          }
          const agentSummaries = configuredAgents.map((a: any) => ({
            id: a.id,
            name: a.name || a.id,
            description: a.description || '(no description)',
            default: a.default === true,
            executionWorkspace: a.executionWorkspace || null,
            allowedWorkPaths: Array.isArray(a.allowedWorkPaths) ? a.allowedWorkPaths : [],
            schedule: a.schedule || null,
          }));
          const lines = agentSummaries.map((a: any) =>
            `- ${a.id}${a.default ? ' (default)' : ''}: ${a.description}${a.executionWorkspace ? ` [cwd: ${a.executionWorkspace}]` : ''}${a.allowedWorkPaths?.length ? ` [allowed: ${a.allowedWorkPaths.join(', ')}]` : ''}${a.schedule ? ` [scheduled: ${a.schedule}]` : ''}`
          );
          return { name, args, result: `${agentSummaries.length} agent(s) configured:\n${lines.join('\n')}`, error: false };
        } catch (err: any) {
          return { name, args, result: `agent_list error: ${err.message}`, error: true };
        }
      }

	      case 'agent_info': {
	        try {
	          const agentId = String(args.agent_id || '').trim();
	          if (!agentId) {
	            return { name, args, result: 'agent_info requires agent_id. Call agent_list first to get IDs.', error: true };
          }
          const agent = getAgentById(agentId);
          if (!agent) {
            const allAgents = getAgents();
            const ids = allAgents.map((a: any) => a.id).join(', ') || 'none';
            return { name, args, result: `Agent "${agentId}" not found. Available IDs: ${ids}`, error: true };
          }
          return { name, args, result: JSON.stringify(agent, null, 2), error: false };
        } catch (err: any) {
	          return { name, args, result: `agent_info error: ${err.message}`, error: true };
	        }
	      }

	      case 'agent_update': {
	        try {
	          const agentId = String(args.agent_id || '').trim();
	          if (!agentId) {
	            return { name, args, result: 'agent_update requires agent_id. Call agent_list first to get IDs.', error: true };
	          }
	          if (agentId === 'main') {
	            return { name, args, result: 'ERROR: agent_update cannot modify the synthetic main agent. Use settings/config for main-agent changes.', error: true };
	          }
	          const workspacePath = getConfig().getConfig().workspace?.path || process.cwd();
	          const subagentMgr = new SubagentManager(workspacePath, deps.broadcastWS, deps.handleChat, deps.telegramChannel);
	          const patch = { ...args };
	          delete (patch as any).agent_id;
	          const updated = subagentMgr.updateSubagent(agentId, patch);
	          return {
	            name,
	            args,
	            result: JSON.stringify({
	              success: true,
	              agent: {
	                id: updated.id,
	                name: updated.name,
	                description: updated.description,
	                model: updated.model || null,
	                executionWorkspace: updated.executionWorkspace || null,
	                allowedWorkPaths: updated.allowedWorkPaths || [],
	                max_steps: updated.max_steps,
	                timeout_ms: updated.timeout_ms,
	                identity: updated.identity || null,
		                allowed_tools: updated.allowed_tools || [],
	                forbidden_tools: updated.forbidden_tools || [],
	                modified_at: updated.modified_at,
	              },
	            }, null, 2),
	            error: false,
	          };
	        } catch (err: any) {
	          return { name, args, result: `agent_update error: ${err.message}`, error: true };
	        }
	      }

	      case 'memory_browse': {
        const mbFileRaw = String(args.file || 'user').toLowerCase().trim();
        const mbFile = mbFileRaw === 'memory' ? 'memory' : (mbFileRaw === 'soul' ? 'soul' : 'user');
        const mbFilename = mbFile === 'soul' ? 'SOUL.md' : (mbFile === 'memory' ? 'MEMORY.md' : 'USER.md');
        const mbPath = path.join(workspacePath, mbFilename);
        console.log(`[memory_browse] workspacePath: ${workspacePath}`);
        console.log(`[memory_browse] mbPath: ${mbPath}`);
        console.log(`[memory_browse] exists: ${fs.existsSync(mbPath)}`);
        if (!fs.existsSync(mbPath)) {
          // Try absolute path fallback
          const configWorkspace = getConfig().getWorkspacePath();
          const fallbackPath = path.join(configWorkspace, mbFilename);
          console.log(`[memory_browse] fallback configWorkspace: ${configWorkspace}`);
          console.log(`[memory_browse] fallback path: ${fallbackPath}`);
          console.log(`[memory_browse] fallback exists: ${fs.existsSync(fallbackPath)}`);
          if (!fs.existsSync(fallbackPath)) {
            return { name, args, result: `${mbFilename} not found at ${mbPath} or ${fallbackPath}. Create it first.`, error: true };
          }
          // Use fallback
          const mbContent = fs.readFileSync(fallbackPath, 'utf-8');
          const mbMatches = mbContent.match(/^## (.+)/gm) || [];
          const mbCategories = mbMatches.map((m: string) => m.replace(/^## /, '').trim());
          if (mbCategories.length === 0) {
            return { name, args, result: `${mbFilename} has no categories yet. Use memory_write to create the first one.`, error: false };
          }
          return { name, args, result: `${mbFilename} categories:\n${mbCategories.map((c: string) => `- ${c}`).join('\n')}\n\nUse memory_write(file="${mbFile}", category="<name>", content="...") to add a fact.`, error: false };
        }
        const mbContent = fs.readFileSync(mbPath, 'utf-8');
        const mbMatches = mbContent.match(/^## (.+)/gm) || [];
        const mbCategories = mbMatches.map((m: string) => m.replace(/^## /, '').trim());
        if (mbCategories.length === 0) {
          return { name, args, result: `${mbFilename} has no categories yet. Use memory_write to create the first one.`, error: false };
        }
        return { name, args, result: `${mbFilename} categories:\n${mbCategories.map((c: string) => `- ${c}`).join('\n')}\n\nUse memory_write(file="${mbFile}", category="<name>", content="...") to add a fact.`, error: false };
      }

      case 'memory_write': {
        const mwFileRaw = String(args.file || 'user').toLowerCase().trim();
        const mwFile = mwFileRaw === 'memory' ? 'memory' : (mwFileRaw === 'soul' ? 'soul' : 'user');
        const mwCategory = String(args.category || '').trim().toLowerCase().replace(/\s+/g, '_');
        const mwContent = String(args.content || '').trim();
        if (!mwCategory) return { name, args, result: 'memory_write: category is required', error: true };
        if (!mwContent) return { name, args, result: 'memory_write: content is required', error: true };
        const mwFilename = mwFile === 'soul' ? 'SOUL.md' : (mwFile === 'memory' ? 'MEMORY.md' : 'USER.md');
        let mwPath = path.join(workspacePath, mwFilename);
        if (!fs.existsSync(mwPath)) {
          // Try config workspace as fallback
          const configWorkspace = getConfig().getWorkspacePath();
          mwPath = path.join(configWorkspace, mwFilename);
          console.log(`[memory_write] fallback workspace: ${configWorkspace}, path: ${mwPath}`);
        }
        if (!fs.existsSync(mwPath)) {
          const initial = `# ${mwFilename}\n\n---\n`;
          fs.mkdirSync(path.dirname(mwPath), { recursive: true });
          fs.writeFileSync(mwPath, initial, 'utf-8');
        }
        let mwFileContent = fs.readFileSync(mwPath, 'utf-8');
        const mwDate = new Date().toISOString().split('T')[0];
        const mwEntry = `- ${mwContent} [${mwDate}]`;
        const mwSectionHeader = `## ${mwCategory}`;
        const mwSectionIdx = mwFileContent.indexOf(`\n${mwSectionHeader}`);
        if (mwSectionIdx !== -1) {
          // Section exists â€” find end of section, insert before next ## or EOF
          const afterHeader = mwSectionIdx + mwSectionHeader.length + 1;
          const nextSection = mwFileContent.indexOf('\n## ', afterHeader);
          const insertAt = nextSection !== -1 ? nextSection : mwFileContent.length;
          mwFileContent = mwFileContent.slice(0, insertAt) + '\n' + mwEntry + mwFileContent.slice(insertAt);
        } else {
          // New category â€” append before closing --- or at end
          const closingComment = mwFileContent.lastIndexOf('\n---');
          const insertAt = closingComment !== -1 ? closingComment : mwFileContent.length;
          mwFileContent = mwFileContent.slice(0, insertAt) + '\n\n' + mwSectionHeader + '\n' + mwEntry + mwFileContent.slice(insertAt);
        }
        fs.writeFileSync(mwPath, mwFileContent, 'utf-8');
        return { name, args, result: `Written to ${mwFilename} [${mwCategory}]: ${mwContent}`, error: false };
      }

      case 'memory_read': {
        const mrFileRaw = String(args.file || 'user').toLowerCase().trim();
        const mrFile = mrFileRaw === 'memory' ? 'memory' : (mrFileRaw === 'soul' ? 'soul' : 'user');
        const mrFilename = mrFile === 'soul' ? 'SOUL.md' : (mrFile === 'memory' ? 'MEMORY.md' : 'USER.md');
        let mrPath = path.join(workspacePath, mrFilename);
        if (!fs.existsSync(mrPath)) {
          // Try config workspace as fallback
          const configWorkspace = getConfig().getWorkspacePath();
          mrPath = path.join(configWorkspace, mrFilename);
          console.log(`[memory_read] fallback workspace: ${configWorkspace}, path: ${mrPath}`);
        }
        if (!fs.existsSync(mrPath)) return { name, args, result: `${mrFilename} not found at ${mrPath}`, error: true };
        const mrContent = fs.readFileSync(mrPath, 'utf-8');
        return { name, args, result: mrContent, error: false };
      }

      case 'memory_search': {
        try {
          const query = String(args.query || '').trim();
          if (!query) return { name, args, result: 'memory_search: query is required', error: true };
          const modeRaw = String(args.mode || 'quick').trim().toLowerCase();
          const mode = (modeRaw === 'deep' || modeRaw === 'project' || modeRaw === 'timeline')
            ? modeRaw
            : 'quick';
          const sourceTypes = Array.isArray(args.source_types)
            ? args.source_types.map((v: any) => String(v || '').trim()).filter(Boolean)
            : undefined;
          const out = searchMemoryIndex(workspacePath, {
            query,
            mode: mode as any,
            limit: Number(args.limit || 8),
            projectId: args.project_id ? String(args.project_id) : undefined,
            dateFrom: args.date_from ? String(args.date_from) : undefined,
            dateTo: args.date_to ? String(args.date_to) : undefined,
            sourceTypes: sourceTypes as any,
            minDurability: args.min_durability !== undefined ? Number(args.min_durability) : undefined,
          });
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_search failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_read_record': {
        try {
          const recordId = String(args.record_id || '').trim();
          if (!recordId) return { name, args, result: 'memory_read_record: record_id is required', error: true };
          const out = readMemoryRecord(workspacePath, recordId);
          if (out.record) return { name, args, result: JSON.stringify(out, null, 2), error: false };
          return { name, args, result: `Record not found: ${recordId}`, error: true };
        } catch (err: any) {
          return { name, args, result: `memory_read_record failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_search_project': {
        try {
          const projectId = String(args.project_id || '').trim();
          const query = String(args.query || '').trim();
          if (!projectId) return { name, args, result: 'memory_search_project: project_id is required', error: true };
          if (!query) return { name, args, result: 'memory_search_project: query is required', error: true };
          const out = searchProjectMemory(workspacePath, projectId, query, Number(args.limit || 10));
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_search_project failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_search_timeline': {
        try {
          const query = String(args.query || '').trim();
          if (!query) return { name, args, result: 'memory_search_timeline: query is required', error: true };
          const out = searchMemoryTimeline(
            workspacePath,
            query,
            args.date_from ? String(args.date_from) : undefined,
            args.date_to ? String(args.date_to) : undefined,
            Number(args.limit || 20),
          );
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_search_timeline failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_get_related': {
        try {
          const recordId = String(args.record_id || '').trim();
          if (!recordId) return { name, args, result: 'memory_get_related: record_id is required', error: true };
          const related = getRelatedMemory(workspacePath, recordId, Number(args.limit || 8));
          return { name, args, result: JSON.stringify({ record_id: recordId, hits: related }, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_get_related failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_graph_snapshot': {
        try {
          const graph = getMemoryGraphSnapshot(workspacePath);
          return { name, args, result: JSON.stringify(graph, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_graph_snapshot failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'memory_index_refresh': {
        try {
          const out = refreshMemoryIndexFromAudit(workspacePath, { force: true, maxChangedFiles: 500, minIntervalMs: 0 });
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
        } catch (err: any) {
          return { name, args, result: `memory_index_refresh failed: ${String(err?.message || err)}`, error: true };
        }
      }

      case 'write_note': {
        const noteContent = String(args.content || '').trim();
        if (!noteContent) {
          return { name, args, result: 'write_note: empty content', error: true };
        }
        const noteTag = String(args.tag || args.step || 'general').trim();
        const noteTaskId = args.task_id ? String(args.task_id) : null;

        // Always write to intraday notes file (works in all sessions)
        try {
          const noteDate = new Date().toISOString().split('T')[0];
          const memDir = path.join(workspacePath, 'memory');
          if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
          const intradayFile = path.join(memDir, `${noteDate}-intraday-notes.md`);
          const timestamp = new Date().toISOString();
          const sourceLine = formatIntradayNoteSourceLine(inferIntradayNoteSource(sessionId, args));
          let entry = `\n### [${noteTag.toUpperCase()}] ${timestamp}\n${sourceLine}\n${noteContent}`;
          if (noteTaskId) entry += `\n_Related task: ${noteTaskId}_`;
          fs.appendFileSync(intradayFile, entry + '\n');
        } catch (err: any) {
          return { name, args, result: `write_note: failed to write intraday note: ${err.message}`, error: true };
        }

        // Also append to task journal if in a task session
        const isTaskSession = String(sessionId || '').startsWith('task_');
        if (isTaskSession) {
          try {
            const taskId = sessionId.replace(/^task_/, '');
            const { appendJournal, loadTask, mutatePlan, saveTask } = require('../tasks/task-store');
            appendJournal(taskId, {
              type: 'write_note',
              content: `[${noteTag}] ${noteContent.slice(0, 300)}`,
              detail: noteContent.slice(0, 2000),
            });
            if (noteTag.toLowerCase() === 'task_complete') {
              const task = loadTask(taskId);
              const stepIndex = Number(task?.currentStepIndex);
              if (task && Number.isInteger(stepIndex)) {
                const startIndex = Math.max(0, Math.min(stepIndex, task.plan.length));
                const completions = task.plan
                  .map((step: any, index: number) => ({ step, index }))
                  .filter(({ step, index }: any) => index >= startIndex && step?.status !== 'done')
                  .map(({ index }: any) => ({
                    op: 'complete' as const,
                    step_index: index,
                    notes: 'auto-complete: task_complete logged by write_note',
                  }));

                if (completions.length > 0) {
                  mutatePlan(taskId, completions);
                }

                const advancedTask = loadTask(taskId);
                if (advancedTask) {
                  advancedTask.currentStepIndex = advancedTask.plan.length;
                  advancedTask.lastProgressAt = Date.now();
                  saveTask(advancedTask);
                }
                appendJournal(taskId, {
                  type: 'status_push',
                  content: `Auto-completed task plan from step ${startIndex + 1}: task_complete note logged by write_note.`,
                });
              }
            }
          } catch {}
        }

        const teamNote = inferTeamNoteContext(sessionId);
        if (teamNote) {
          appendTeamMemoryEvent(teamNote.teamId, {
            authorType: teamNote.authorType,
            authorId: teamNote.authorId,
            taskId: noteTaskId,
            tag: noteTag,
            content: noteContent,
          });
        }

        const completedDevEdit = markDevSourceEditContinuationComplete({
          id: args.dev_edit_id || args.devEditId,
          sessionId,
          tag: noteTag,
          note: noteContent,
        });
        const devEditSuffix = completedDevEdit
          ? ` Dev edit continuation ${completedDevEdit.id} marked complete.`
          : '';

        return {
          name,
          args,
          result: `Note saved [${noteTag}] (${noteContent.length} chars) -> intraday-notes.${devEditSuffix}`,
          data: completedDevEdit ? { dev_edit_complete: true, dev_edit_id: completedDevEdit.id, tag: noteTag } : undefined,
          extra: completedDevEdit ? { dev_edit_complete: true, dev_edit_id: completedDevEdit.id, tag: noteTag } : undefined,
          error: false,
        };
      }

      case 'save_site_shortcut': {
        const shortcutHostname = String(args.hostname || '').trim();
        const shortcutKey = String(args.key || '').trim();
        const shortcutAction = String(args.action || '').trim();
        if (!shortcutHostname || !shortcutKey || !shortcutAction) {
          return { name, args, result: 'save_site_shortcut: hostname, key, and action are required', error: true };
        }
        try {
          saveSiteShortcut(
            shortcutHostname,
            {
              key: shortcutKey,
              action: shortcutAction,
              context: args.context ? String(args.context) : undefined,
              preferred_for_compose: args.preferred_for_compose === true,
            },
            undefined,
            args.notes ? String(args.notes) : undefined,
          );
          return { name, args, result: `Shortcut saved: ${shortcutHostname} â€” "${shortcutKey}" â†’ ${shortcutAction}`, error: false };
        } catch (err: any) {
          return { name, args, result: `save_site_shortcut failed: ${err.message}`, error: true };
        }
      }

      // â”€â”€ Agent Builder Integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case 'architect_workflow':
      case 'verify_workflow_credentials':
      case 'test_workflow':
      case 'deploy_workflow':
      case 'get_workflow_status':
      case 'search_workflow_templates':
      case 'execute_workflow_template':
      case 'create_node_subagent': {
        const result = await executeAgentBuilderTool(name, args);
        return { name, args, result, error: false };
      }

      // -- Skill Tools -------------------------------------------------------
      // New architecture: no trigger-matching, no session windows.
      // Flow: skill_list() -> skill_read("<id>"). Pinned skills auto-injected by buildTurnContext.

      case 'skill_list': {
        deps.skillsManager.scanSkills();
        const all = deps.skillsManager.getAll();
        if (all.length === 0) {
          return { name, args, result: 'No skills installed yet. Use skill_create to save a new one.', error: false };
        }
        const slLines = all.map((s: any) => {
          const status = s.eligibility?.status && s.eligibility.status !== 'ready' ? ` [${s.eligibility.status}]` : '';
          return `${s.id}${status} - ${s.description || '(no description)'}`;
        }).join('\n');
        return {
          name, args,
          result: `${all.length} skill${all.length !== 1 ? 's' : ''} available. Call skill_read(id) to load one.\n\n${slLines}`,
          error: false,
        };
      }

      // skill_read: read a skill's full SKILL.md content by ID.
      // Resolves via skillsManager so it always works regardless of workspacePath
      // (critical for team agents whose workspace is inside teams/<id>/workspace).
      case 'skill_read': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) {
          return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        }
        activateSkillForSession(sessionId, skill.id);
        try {
          const content = fs.readFileSync(skill.filePath, 'utf-8').replace(/^\s*emoji\s*:.*\r?\n/gm, '');
          const header = [
            `${skill.name} (${skill.id}) ${skill.kind === 'bundle' ? `v${skill.version} bundle` : 'simple skill'}`,
            skill.description ? `Description: ${skill.description}` : '',
            Array.isArray(skill.requiredTools) && skill.requiredTools.length ? `Required tools: ${skill.requiredTools.join(', ')}` : '',
            skill.status && skill.status !== 'ready' ? `Status: ${skill.status}` : '',
            skill.validation && !skill.validation.ok ? `Validation errors: ${skill.validation.errors.join('; ')}` : '',
          ].filter(Boolean).join('\n');
          let resourceBlock = '';
          if (skill.kind === 'bundle' && Array.isArray(skill.resources) && skill.resources.length) {
            const menuLines = skill.resources.map((r: any) =>
              `- ${r.path}${r.description ? ` — ${r.description}` : ''}`
            );
            const firstResource = skill.resources[0];
            const suggested = `skill_resource_read({ id: "${skillId}", path: "${firstResource.path}" })`;
            resourceBlock = [
              '',
              '',
              'Relevant resources:',
              ...menuLines,
              '',
              `Suggested next call if you need a resource:\n${suggested}`,
            ].join('\n');
          }
          return { name, args, result: `${header}\n\nInstructions:\n${content}${resourceBlock}`, error: false };
        } catch {
          return { name, args, result: `${skill.name} (${skillId})\n\n${skill.instructions}`, error: false };
        }
      }

      case 'skill_resource_list': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        const resources = deps.skillsManager.listResources(skillId);
        if (!resources.length) return { name, args, result: `Skill "${skill.id}" has no declared or discovered resources.`, error: false };
        const lines = resources.map((r: any) => {
          const size = Number.isFinite(Number(r.sizeBytes)) ? `, ${r.sizeBytes} bytes` : '';
          return `- ${r.path} (${r.type}${size})${r.description ? ` - ${r.description}` : ''}`;
        }).join('\n');
        return {
          name, args,
          result: `Resources for ${skill.name} (${skill.id}):\n${lines}\n\nRead one with skill_resource_read({"id":"${skill.id}","path":"<resource path>"}).`,
          error: false,
        };
      }

      case 'skill_resource_read': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required.', error: true };
        if (!resourcePath) return { name, args, result: 'ERROR: path is required.', error: true };
        const maxChars = args.max_chars ? Number(args.max_chars) : undefined;
        const result = deps.skillsManager.readResource(skillId, resourcePath, Number.isFinite(maxChars) ? maxChars : undefined);
        if (!result.ok) return { name, args, result: `skill_resource_read failed: ${result.error}`, error: true };
        const skill = deps.skillsManager.get(skillId);
        activateSkillForSession(sessionId, skill?.id || skillId);
        activateSkillResourceForSession(sessionId, skill?.id || skillId, result.path);
        return {
          name, args,
          result: `Resource ${skillId}/${result.path}${result.truncated ? ' (truncated)' : ''}:\n\n${result.content}`,
          error: false,
        };
      }

      case 'skill_import_bundle': {
        const source = String(args.source || args.url || args.path || '').trim();
        if (!source) return { name, args, result: 'skill_import_bundle: source is required (directory, .zip path, GitHub tree URL, or https URL to a .zip).', error: true };
        try {
          const imported = await deps.skillsManager.importBundles(source, {
            id: args.id ? String(args.id) : undefined,
            overwrite: args.overwrite === true,
          });
          const lines = imported.map((skill: any) =>
            `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources) - ${skill.description || skill.name}`
          ).join('\n');
          return {
            name, args,
            result: `Imported ${imported.length} skill${imported.length !== 1 ? 's' : ''}:\n${lines}\n\nUse skill_read("<id>") to inspect one.`,
            error: false,
          };
        } catch (importErr: any) {
          return { name, args, result: `skill_import_bundle failed: ${importErr.message}`, error: true };
        }
      }

      case 'skill_inspect': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const inspection = deps.skillsManager.inspect(skillId);
        if (!inspection) return { name, args, result: `Skill "${skillId}" not found.`, error: true };
        return {
          name, args,
          result: JSON.stringify(inspection, null, 2),
          error: false,
        };
      }

      case 'skill_manifest_write': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required.', error: true };
        const manifestArg = args.manifest;
        const manifest = typeof manifestArg === 'string' ? parseJsonLike(manifestArg) : manifestArg;
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
          return { name, args, result: 'ERROR: manifest must be an object or JSON object string.', error: true };
        }
        try {
          const updated = deps.skillsManager.writeManifestOverlay(skillId, manifest, {
            changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : undefined,
            evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
            appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          });
          return {
            name, args,
            result: `Wrote manifest overlay for ${updated.name} (${updated.id}) at ${updated.overlayPath || '(overlay path unavailable)'}. Manifest source: ${updated.manifestSource}.`,
            error: false,
          };
        } catch (manifestErr: any) {
          return { name, args, result: `skill_manifest_write failed: ${manifestErr.message}`, error: true };
        }
      }

      case 'skill_create_bundle': {
        const scId = String(args.id || '').trim();
        const scName = String(args.name || '').trim();
        const scInstructions = String(args.instructions || '').trim();
        if (!scId) return { name, args, result: 'skill_create_bundle: id is required', error: true };
        if (!scName) return { name, args, result: 'skill_create_bundle: name is required', error: true };
        if (!scInstructions) return { name, args, result: 'skill_create_bundle: instructions is required', error: true };
        const splitCsv = (value: any) => Array.isArray(value)
          ? value.map((v: any) => String(v || '').trim()).filter(Boolean)
          : String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
        try {
          const skill = deps.skillsManager.createBundle({
            id: scId,
            name: scName,
            description: args.description ? String(args.description).trim() : '',
            instructions: scInstructions,
            version: args.version ? String(args.version) : undefined,
            triggers: splitCsv(args.triggers),
            categories: splitCsv(args.categories),
            requiredTools: splitCsv(args.requiredTools || args.required_tools),
            permissions: args.permissions && typeof args.permissions === 'object' ? args.permissions : undefined,
            resources: Array.isArray(args.resources) ? args.resources : [],
            overwrite: args.overwrite === true,
          });
          return {
            name, args,
            result: `Bundle skill "${skill.name}" created at ${skill.rootDir}. Resources: ${skill.resources.length}. Use skill_read("${skill.id}") to inspect it.`,
            error: false,
          };
        } catch (bundleErr: any) {
          return { name, args, result: `skill_create_bundle failed: ${bundleErr.message}`, error: true };
        }
      }

      case 'skill_resource_write': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        const content = String(args.content ?? '');
        if (!skillId) return { name, args, result: 'skill_resource_write: id is required', error: true };
        if (!resourcePath) return { name, args, result: 'skill_resource_write: path is required', error: true };
        try {
          const updated = deps.skillsManager.writeResource(skillId, resourcePath, content, {
            type: args.type ? String(args.type) : undefined,
            description: args.description ? String(args.description) : undefined,
            addToManifest: args.addToManifest !== false,
            change: {
              changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : undefined,
              evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
              appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
              reason: args.reason ? String(args.reason) : undefined,
            },
          });
          return {
            name, args,
            result: `Wrote ${resourcePath} in skill "${updated.id}". Resources now: ${updated.resources.length}.`,
            error: false,
          };
        } catch (resourceErr: any) {
          return { name, args, result: `skill_resource_write failed: ${resourceErr.message}`, error: true };
        }
      }

      case 'skill_resource_delete': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        if (!skillId) return { name, args, result: 'skill_resource_delete: id is required', error: true };
        if (!resourcePath) return { name, args, result: 'skill_resource_delete: path is required', error: true };
        try {
          const updated = deps.skillsManager.deleteResource(skillId, resourcePath, {
            removeFromManifest: args.removeFromManifest !== false,
          });
          return {
            name, args,
            result: `Deleted ${resourcePath} from skill "${updated.id}". Resources now: ${updated.resources.length}.`,
            error: false,
          };
        } catch (deleteErr: any) {
          return { name, args, result: `skill_resource_delete failed: ${deleteErr.message}`, error: true };
        }
      }

      case 'skill_export_bundle': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_export_bundle: id is required', error: true };
        try {
          const exported = await deps.skillsManager.exportBundle(skillId, args.outputPath ? String(args.outputPath) : undefined);
          return {
            name, args,
            result: `Exported skill "${skillId}" to ${exported.path} (${exported.bytes} bytes).`,
            error: false,
          };
        } catch (exportErr: any) {
          return { name, args, result: `skill_export_bundle failed: ${exportErr.message}`, error: true };
        }
      }

      case 'skill_update_from_source': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_update_from_source: id is required', error: true };
        try {
          const updated = await deps.skillsManager.updateFromSource(skillId, { overwrite: args.overwrite !== false });
          const lines = updated.map((skill: any) => `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources)`).join('\n');
          return {
            name, args,
            result: `Updated ${updated.length} skill${updated.length !== 1 ? 's' : ''} from stored source:\n${lines}`,
            error: false,
          };
        } catch (updateErr: any) {
          return { name, args, result: `skill_update_from_source failed: ${updateErr.message}`, error: true };
        }
      }

      case 'skill_create': {
        const scId = String(args.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const scName = String(args.name || '').trim();
        const scInstructions = String(args.instructions || '').trim();
        if (!scId) return { name, args, result: 'skill_create: id is required', error: true };
        if (!scName) return { name, args, result: 'skill_create: name is required', error: true };
        if (!scInstructions) return { name, args, result: 'skill_create: instructions is required', error: true };
        try {
          const scSkill = deps.skillsManager.createSkill({
            id: scId,
            name: scName,
            description: args.description ? String(args.description).trim() : '',
            instructions: scInstructions,
          });
          return {
            name, args,
            result: `Skill "${scSkill.name}" created at ${scSkill.filePath}.\nUse skill_read("${scSkill.id}") to verify it, or skill_list() to see all skills.`,
            error: false,
          };
        } catch (scErr: any) {
          return { name, args, result: `skill_create failed: ${scErr.message}`, error: true };
        }
      }

      // â”€â”€ Piece 1: MCP Tool Dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      default: {
        // Handle mcp__serverId__toolName calls
        if (name.startsWith('mcp__')) {
          const parts = name.split('__');
          if (parts.length >= 3) {
            const serverId = parts[1];
            const toolName = parts.slice(2).join('__');
            try {
              const mcpResult = await getMCPManager().callTool(serverId, toolName, args ?? {});
              const text = mcpResult.content
                .map((c: any) => c.text || c.data || '')
                .join('\n')
                .trim();
              return { name, args, result: text || '(empty result)', error: !!mcpResult.isError };
            } catch (mcpErr: any) {
              return { name, args, result: `MCP error (${serverId}/${toolName}): ${mcpErr.message}`, error: true };
            }
          }
        }

        // â”€â”€ Piece 5: dispatch_to_agent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (name === 'dispatch_to_agent') {
          const agentId = String(args.agent_id || '').trim();
          const agentMessage = String(args.message || '').trim();
          const agentContext = args.context ? String(args.context) : undefined;

          if (!agentId) return { name, args, result: 'dispatch_to_agent requires agent_id', error: true };
          if (!agentMessage) return { name, args, result: 'dispatch_to_agent requires message', error: true };

          try {
            const dispatchResult = await deps.dispatchToAgent(agentId, agentMessage, agentContext, sessionId);
            return { name, args, result: JSON.stringify(dispatchResult), error: false };
          } catch (err: any) {
            return { name, args, result: `dispatch_to_agent error: ${err.message}`, error: true };
          }
        }

        // ── run_task_now ──────────────────────────────────────
        if (name === 'message_subagent') {
          const agentId = String(args.agent_id || '').trim();
          const message = String(args.message || '').trim();
          const context = args.context ? String(args.context).trim() : '';

          if (!agentId) return { name, args, result: 'message_subagent requires agent_id', error: true };
          if (!message) return { name, args, result: 'message_subagent requires message', error: true };

          const agent = getAgentById(agentId) as any;
          if (!agent) return { name, args, result: `Unknown subagent: ${agentId}. Call agent_list first.`, error: true };
          if (agent.default === true || agentId === 'main') {
            return { name, args, result: 'message_subagent is for standalone subagents, not the main/default agent.', error: true };
          }

          const team = listManagedTeams().find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(agentId));
          if (team) {
            return {
              name,
              args,
              result: `Agent "${agentId}" belongs to team "${team.name}" (${team.id}). Use team messaging/dispatch tools for team agents; message_subagent is only for standalone one-off subagents.`,
              error: true,
            };
          }

          try {
            const workspacePath = getConfig().getConfig().workspace?.path || process.cwd();
            const subagentMgr = new SubagentManager(workspacePath, deps.broadcastWS, deps.handleChat, deps.telegramChannel);
            const result = await subagentMgr.callSubagent(
              {
                subagent_id: agentId,
                task_prompt: [
                  `Direct background message from main chat to standalone subagent "${agentId}".`,
                  ``,
                  `Message:`,
                  message,
                  ``,
                  `Work in your subagent task thread. Keep intermediate collaboration in the subagent chat/task UI, not the main chat. If you need user input, ask clearly in the task so it can pause for assistance there.`,
                ].join('\n'),
                context_data: context ? { main_chat_context: context } : undefined,
                run_now: true,
                delivery_mode: 'task_panel_only',
              },
              sessionId
            );
            return {
              name,
              args,
              result: JSON.stringify({
                success: true,
                agent_id: result.subagent_id,
                task_id: result.task_id,
                status: result.status,
                response:
                  `Message sent to subagent "${agentId}" in the background. ` +
                  `The working conversation and final result will stay in the subagent task panel, so main chat can continue uninterrupted.`,
              }, null, 2),
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `message_subagent error: ${err.message}`, error: true };
          }
        }

        if (name === 'run_task_now') {
          const title = String(args.title || '').trim();
          const prompt = String(args.prompt || '').trim();
          if (!title) return { name, args, result: 'run_task_now requires title', error: true };
          if (!prompt) return { name, args, result: 'run_task_now requires prompt', error: true };

          const subagentId = args.subagent_id ? String(args.subagent_id).trim() : undefined;

          try {
            const existingBinding = resolveTaskForSession(sessionId);
            if (existingBinding?.status === 'running' || existingBinding?.status === 'queued') {
              return {
                name,
                args,
                result: JSON.stringify({
                  task_id: existingBinding.id,
                  status: existingBinding.status,
                  message: `This chat turn is already tracking task "${existingBinding.title}" (${existingBinding.id}). Continue executing the current tracked work here.`,
                }),
                error: false,
              };
            }

            const task = createTask({
              title,
              prompt,
              sessionId,
              channel: String(sessionId || '').startsWith('telegram_') ? 'telegram' : 'web',
              taskKind: 'run_once',
              originatingSessionId: sessionId,
              subagentProfile: subagentId,
              plan: [{
                index: 0,
                description: prompt.slice(0, 160) || title,
                status: 'pending',
              }],
            });
            updateTaskStatus(task.id, 'running');
            setTaskStepRunning(task.id, 0);
            appendJournal(task.id, {
              type: 'status_push',
              content: `Live tracked task started from chat: ${title}`,
            });
            bindTaskRunToSession(sessionId, {
              taskId: task.id,
              source: 'run_task_now',
              agentId: subagentId,
            });
            try {
              deps.broadcastWS({ type: 'task_running', taskId: task.id, title, source: 'run_task_now', sessionId });
              deps.broadcastWS({ type: 'task_panel_update', taskId: task.id });
            } catch {}
            try {
              deps.sendSSE?.('info', { message: `Task card "${title}" started. Continuing this work live in chat.` });
            } catch {}
            return {
              name,
              args,
              result: JSON.stringify({
                task_id: task.id,
                status: 'running',
                message:
                  `Task card "${title}" started (${task.id}) and is now tracking this live chat turn. ` +
                  `Do not wait for a background runner. Continue executing the prompt now in this same conversation, using tools as needed. ` +
                  `Task prompt: ${prompt}`,
              }),
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `run_task_now error: ${err?.message || err}`, error: true };
          }
        }

        // ── write_proposal ──────────────────────────────────────
	        if (name === 'write_proposal') {
	          const proposalTask = resolveProposalExecutionTask();
	          const buildFailure = proposalTask?.proposalExecution?.buildFailure;
	          const allowRepairProposal = !!(
	            buildFailure
	            && buildFailure.status !== 'resolved'
	            && buildFailure.allowWriteProposal
	            && !buildFailure.repairProposalId
	          );
	          if (isProposalExecutionSession(sessionId) && !allowRepairProposal) {
	            const repairMessage = buildFailure?.repairProposalId
	              ? `Repair proposal ${buildFailure.repairProposalId} is already queued for review.`
	              : buildFailure?.status === 'resolved'
	                ? 'The previous build failure was already repaired and handed back; continue the approved task instead of creating another repair proposal.'
	              : 'Execute the approved edits directly and complete the task; do not create a new proposal from inside proposal execution.';
	            return {
	              name,
	              args,
	              result: `BLOCKED: write_proposal is disabled during approved proposal execution. ${repairMessage}`,
	              error: true,
	            };
	          }
          // Gate: team subagents cannot propose directly — must use talk_to_manager.
          // The manager owns proposal submission so team artifacts, proposal caps, and approval state stay coherent.
          const teamNoteForProposal = inferTeamNoteContext(sessionId);
          const isTeamSession = String(sessionId || '').startsWith('team_dispatch_') || teamNoteForProposal?.authorType === 'subagent';
          if (isTeamSession) {
            return {
              name, args,
              result: 'BLOCKED: Team subagents cannot submit proposals directly. Send the proposal-ready request to the manager instead. For task_trigger/action proposals, include: title, summary, the exact approved action, execution_steps, expected identifiers/artifacts, and any relevant resource paths. For src/code proposals only, include the full implementation plan, affected files, execution_steps, diff preview, executor_prompt, evidence/artifact paths, and risk notes. The manager will review and submit the proposal.',
              error: true,
            };
          }
		          try {
		            const { createProposal } = require('../proposals/proposal-store');
                let teamExecution: any = undefined;
                let sourceTeamId: string | undefined = undefined;
                if (teamNoteForProposal?.authorType === 'manager') {
                  const teamId = String(teamNoteForProposal.teamId || '').trim();
                  const executorAgentId = String(args.executor_agent_id || '').trim();
                  if (!executorAgentId) {
                    return {
                      name,
                      args,
                      result: 'BLOCKED: Team manager proposals must assign executor_agent_id to a subagent on this team.',
                      error: true,
                    };
                  }
                  try {
                    const { getManagedTeam } = require('../teams/managed-teams');
                    const { getAgentById } = require('../../config/config');
                    const team = getManagedTeam(teamId);
                    if (!team) {
                      return { name, args, result: `write_proposal error: team not found: ${teamId}`, error: true };
                    }
                    if (!Array.isArray(team.subagentIds) || !team.subagentIds.includes(executorAgentId)) {
                      return {
                        name,
                        args,
                        result: `BLOCKED: executor_agent_id "${executorAgentId}" is not a member of team "${team.name || teamId}".`,
                        error: true,
                      };
                    }
                    const executorAgent = getAgentById(executorAgentId);
                    sourceTeamId = teamId;
                    teamExecution = {
                      teamId,
                      managerSessionId: String(sessionId || ''),
                      executorAgentId,
                      executorAgentName: String(executorAgent?.name || executorAgentId),
                      returnTarget: 'team_chat',
                      originatingSessionId: String((team as any)?.originatingSessionId || ''),
                      notifyMainAgentOnError: true,
                    };
                  } catch (teamErr: any) {
                    return { name, args, result: `write_proposal team validation error: ${teamErr?.message || teamErr}`, error: true };
                  }
                }
		            const currentProposalId = String(proposalTask?.proposalExecution?.proposalId || '')
	              || (String(proposalTask?.sessionId || '').startsWith('proposal_')
	                ? String(proposalTask?.sessionId || '').replace(/^proposal_/, '')
	                : '');
	            const repairContext = allowRepairProposal
	              ? {
	                  repairOnly: true,
	                  rootProposalId: String(
	                    proposalTask?.proposalExecution?.repairContext?.rootProposalId
	                    || currentProposalId
	                    || '',
	                  ).trim() || undefined,
	                  rootTaskId: String(
	                    proposalTask?.proposalExecution?.repairContext?.rootTaskId
	                    || proposalTask?.id
	                    || '',
	                  ).trim() || undefined,
	                  parentProposalId: currentProposalId || undefined,
	                  parentTaskId: proposalTask?.id,
	                  resumeOriginalTaskId: String(
	                    proposalTask?.proposalExecution?.repairContext?.resumeOriginalTaskId
	                    || proposalTask?.id
	                    || '',
	                  ).trim() || undefined,
	                  failedAtStepIndex: Number.isFinite(Number(buildFailure?.blockedAtStepIndex))
	                    ? Number(buildFailure?.blockedAtStepIndex)
	                    : proposalTask?.currentStepIndex,
	                  failedStepDescription: String(
	                    buildFailure?.blockedStepDescription
	                    || proposalTask?.plan?.[proposalTask?.currentStepIndex || 0]?.description
	                    || '',
	                  ).trim() || undefined,
	                  failedWorkspaceRoot: String(
	                    proposalTask?.proposalExecution?.projectRoot
	                    || proposalTask?.agentWorkspace
	                    || '',
	                  ).trim() || undefined,
	                  canonicalBuildCommand: String(
	                    buildFailure?.command
	                    || proposalTask?.proposalExecution?.repairContext?.canonicalBuildCommand
	                    || 'npm run build',
	                  ).trim() || 'npm run build',
	                  capturedFailureCommand: String(
	                    proposalTask?.proposalExecution?.repairContext?.capturedFailureCommand
	                    || buildFailure?.command
	                    || '',
	                  ).trim() || undefined,
	                  repairDepth: Math.max(1, Number(proposalTask?.proposalExecution?.repairContext?.repairDepth || 0) + 1),
	                }
	              : undefined;
	            const proposal = createProposal({
	              type: args.type || 'general',
                executionMode: ['code_change', 'action', 'general', 'review'].includes(String(args.execution_mode || args.executionMode || '').trim())
                  ? (String(args.execution_mode || args.executionMode).trim() === 'review' ? 'general' : String(args.execution_mode || args.executionMode).trim()) as any
                  : undefined,
	              priority: args.priority || 'medium',
              title: String(args.title || '').slice(0, 120),
              summary: String(args.summary || '').slice(0, 500),
	              details: String(args.details || ''),
	              sourceAgentId: sessionId || 'unknown',
	              sourceSessionId: String(sessionId || '') || undefined,
                sourceTeamId,
		              sourcePipeline: args.source_pipeline || (allowRepairProposal ? 'proposal_build_failure_recovery' : undefined),
              affectedFiles: Array.isArray(args.affected_files) ? args.affected_files : [],
              executionSteps: Array.isArray(args.execution_steps) ? args.execution_steps : undefined,
              diffPreview: args.diff_preview,
              estimatedImpact: args.estimated_impact,
              requiresBuild: args.requires_build === true,
              executorAgentId: args.executor_agent_id,
              executorPrompt: args.executor_prompt,
	              riskTier: args.risk_tier === 'low' || args.risk_tier === 'high' ? args.risk_tier : undefined,
		              executorProviderId: args.executor_provider_id,
		              executorModel: args.executor_model,
                  teamExecution,
		              repairContext,
		            });
            // Broadcast to UI
            try {
              const { broadcastWS } = require('../comms/broadcaster');
              broadcastWS({ type: 'proposal_created', proposalId: proposal.id, title: proposal.title, priority: proposal.priority, summary: proposal.summary, sessionId: proposal.sourceSessionId });
            } catch { /* non-fatal */ }
            // Send proposal notification to Telegram (if enabled)
	            try {
	              if (deps.telegramChannel && typeof deps.telegramChannel.sendProposalToAllowed === 'function') {
	                deps.telegramChannel.sendProposalToAllowed(proposal).catch(() => {});
	              }
	            } catch { /* non-fatal */ }
	            const existingBuildFailure = proposalTask?.proposalExecution?.buildFailure;
	            if (allowRepairProposal && proposalTask && existingBuildFailure) {
	              proposalTask.proposalExecution = {
	                ...(proposalTask.proposalExecution || {}),
	                buildFailure: {
	                  ...existingBuildFailure,
	                  status: 'blocked',
	                  repairProposalId: proposal.id,
	                  allowWriteProposal: false,
	                },
	              };
	              saveTask(proposalTask);
	              appendJournal(proposalTask.id, {
	                type: 'write_note',
	                content: `[build_failure] Manual repair proposal ${proposal.id} created after build failure.`,
	              });
	              try {
	                deps.broadcastWS({ type: 'task_panel_update', taskId: proposalTask.id });
	              } catch {}
	            }
	            return {
              name, args,
              result: `Proposal created: ${proposal.id}\nTitle: ${proposal.title}\nStatus: pending human approval\nView in Prometheus → Proposals panel.`,
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `write_proposal error: ${err.message}`, error: true };
          }
        }

        // ── update_heartbeat ──────────────────────────────────────
	        // Lets agents/managers modify their own (or another agent's) heartbeat
	        // config and HEARTBEAT.md at runtime without a human touching the UI.
	        if (name === 'update_heartbeat') {
	          const targetAgentId = String(args.agent_id || 'main').trim();
	          const partial: Record<string, any> = {};
          if (typeof args.enabled === 'boolean') partial.enabled = args.enabled;
          const rawInterval = Number(args.interval_minutes);
          if (Number.isFinite(rawInterval) && rawInterval > 0) {
            partial.intervalMinutes = Math.max(1, Math.min(1440, Math.floor(rawInterval)));
          }
          if (typeof args.model === 'string') partial.model = args.model.trim();
          if (typeof args.instructions === 'string') partial.instructions = args.instructions;

          try {
            // Call the per-agent heartbeat API so config, timer, and
            // HEARTBEAT.md updates are applied through the same path as the UI.
            // (avoids a direct coupling to heartbeatRunner singleton here)
            const runtimeCfg: any = getConfig().getConfig();
            const gatewayPort = Number(runtimeCfg?.gateway?.port) || (process.env.GATEWAY_PORT ? Number(process.env.GATEWAY_PORT) : 18789);
            const configuredHost = String(runtimeCfg?.gateway?.host || process.env.GATEWAY_HOST || '127.0.0.1').trim();
            // Self-calls must use a loopback host when server is bound to wildcard interfaces.
            const gatewayHost = (configuredHost === '0.0.0.0' || configuredHost === '::') ? '127.0.0.1' : configuredHost;
            const apiUrl = `http://${gatewayHost}:${gatewayPort}/api/heartbeat/agents/${encodeURIComponent(targetAgentId)}`;
            const resp = await fetch(apiUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(partial),
            });
            const data = await resp.json() as any;
            if (!data?.success) throw new Error(data?.error || 'Failed to update heartbeat config');

            let resultMsg = `Heartbeat config updated for "${targetAgentId}": ${JSON.stringify(data.config)}`;
            if (data.path) resultMsg += `\nHEARTBEAT.md updated at ${data.path}`;

            return { name, args, result: resultMsg, error: false };
          } catch (err: any) {
            return { name, args, result: `update_heartbeat error: ${err.message}`, error: true };
          }
        }

        // ── mcp_server_manage ─────────────────────────────────────
        // Full lifecycle management for MCP servers.
        // Returns ALL saved servers (connected or not) with live status.
        // Actions: list, status, connect, disconnect, delete, upsert, import,
        //          list_tools, start_enabled
        if (name === 'mcp_server_manage') {
          try {
            const mcpMgr = getMCPManager();
            const action = String(args.action || 'list').trim().toLowerCase();
            const port = process.env.PORT || 3333;
            const baseUrl = `http://localhost:${port}`;

            // ── list / status ────────────────────────────────────────
            // Returns all saved server configs + their live connection status.
            // Servers that are saved but not currently connected show as
            // status:"disconnected" — the AI can see them all.
            if (action === 'list' || action === 'status') {
              const allStatuses = mcpMgr.getStatus();
              const configs = mcpMgr.getConfigs();
              // Merge full config info with live status
              const servers = allStatuses.map(s => {
                const cfg = configs.find(c => c.id === s.id);
                return {
                  id: s.id,
                  name: s.name,
                  enabled: s.enabled,
                  transport: cfg?.transport || 'unknown',
                  url: cfg?.url,
                  command: cfg?.command,
                  status: s.status,
                  tools: s.tools,
                  toolNames: s.toolNames || [],
                  error: s.error,
                  description: cfg?.description,
                };
              });
              const connected = servers.filter(s => s.status === 'connected').length;
              const disconnected = servers.filter(s => s.status === 'disconnected' || s.status === 'error').length;
              const lines = [
                `MCP Servers: ${servers.length} total | ${connected} connected | ${disconnected} not connected`,
                '',
                ...servers.map(s => {
                  const statusIcon = s.status === 'connected' ? '✅' : s.status === 'error' ? '❌' : '⚪';
                  const toolStr = s.tools > 0 ? ` [${s.tools} tools: ${s.toolNames.slice(0, 5).join(', ')}${s.tools > 5 ? '...' : ''}]` : ' [no tools]';
                  const errorStr = s.error ? ` — Error: ${s.error}` : '';
                  const endpointStr = s.url ? ` (${s.url})` : s.command ? ` (${s.command})` : '';
                  return `${statusIcon} ${s.id} (${s.name})${endpointStr} — ${s.status}${toolStr}${errorStr}`;
                }),
              ];
              return { name, args, result: lines.join('\n'), error: false };
            }

            // ── connect ──────────────────────────────────────────────
            // Reinitializes a saved server. Works for disconnected/error servers.
            if (action === 'connect') {
              const id = String(args.id || '').trim();
              if (!id) return { name, args, result: 'connect requires id', error: true };
              const configs = mcpMgr.getConfigs();
              const cfg = configs.find(c => c.id === id);
              if (!cfg) return { name, args, result: `No saved config for server "${id}". Use mcp_server_manage(action:"list") to see available servers.`, error: true };
              const result = await mcpMgr.connect(id);
              if (result.success) {
                const toolNames = (result.tools || []).map((t: any) => t.name);
                return {
                  name, args,
                  result: `✅ Connected to "${id}" — ${toolNames.length} tool(s) available: ${toolNames.join(', ') || '(none)'}`,
                  error: false,
                };
              } else {
                return { name, args, result: `❌ Failed to connect "${id}": ${result.error}`, error: true };
              }
            }

            // ── disconnect ───────────────────────────────────────────
            if (action === 'disconnect') {
              const id = String(args.id || '').trim();
              if (!id) return { name, args, result: 'disconnect requires id', error: true };
              await mcpMgr.disconnect(id);
              return { name, args, result: `Disconnected "${id}"`, error: false };
            }

            // ── list_tools ───────────────────────────────────────────
            // Show tools for a specific connected server, or all connected servers.
            if (action === 'list_tools') {
              const id = String(args.id || '').trim();
              if (id) {
                const statuses = mcpMgr.getStatus();
                const s = statuses.find(st => st.id === id);
                if (!s) return { name, args, result: `Server "${id}" not found`, error: true };
                if (s.status !== 'connected') return { name, args, result: `Server "${id}" is ${s.status} — connect it first`, error: true };
                return { name, args, result: `Tools for "${id}" (${s.tools}):\n${(s.toolNames || []).join('\n')}`, error: false };
              }
              const allTools = mcpMgr.getAllTools();
              if (!allTools.length) return { name, args, result: 'No MCP tools available — no servers connected.', error: false };
              const lines = allTools.map((t: any) => `mcp__${t.serverId}__${t.name}: ${t.description || '(no description)'}`);
              return { name, args, result: `All MCP tools (${allTools.length}):\n${lines.join('\n')}`, error: false };
            }

            // ── delete ───────────────────────────────────────────────
            if (action === 'delete') {
              const id = String(args.id || '').trim();
              if (!id) return { name, args, result: 'delete requires id', error: true };
              if (!args.confirm) return { name, args, result: `Set confirm:true to delete server "${id}"`, error: true };
              const ok = mcpMgr.deleteConfig(id);
              return { name, args, result: ok ? `Deleted server config "${id}"` : `Server "${id}" not found`, error: !ok };
            }

            // ── upsert ───────────────────────────────────────────────
            // Save or update a server config. Pass connect:true to connect immediately.
            if (action === 'upsert') {
              const id = String(args.id || args.config?.id || '').trim();
              if (!id) return { name, args, result: 'upsert requires id', error: true };
              const cfg = args.config || {
                id,
                name: args.name || id,
                enabled: args.enabled !== false,
                transport: args.transport || args.type || 'stdio',
                command: args.command,
                args: args.args,
                env: args.env,
                url: args.url,
                headers: args.headers,
                description: args.description,
              };
              mcpMgr.upsertConfig(cfg);
              let msg = `Saved MCP server config "${id}"`;
              if (args.connect) {
                const r = await mcpMgr.connect(id);
                msg += r.success
                  ? ` and connected (${(r.tools || []).length} tools)`
                  : ` but connection failed: ${r.error}`;
              }
              return { name, args, result: msg, error: false };
            }

            // ── import ───────────────────────────────────────────────
            // Import servers from a JSON object or string ({mcpServers:{...}} format).
            if (action === 'import') {
              const raw = args.json;
              if (!raw) return { name, args, result: 'import requires json', error: true };
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const servers = parsed?.mcpServers || parsed;
              if (typeof servers !== 'object' || Array.isArray(servers)) {
                return { name, args, result: 'import: expected {mcpServers:{...}} or object of server configs', error: true };
              }
              const imported: string[] = [];
              for (const [id, cfg] of Object.entries(servers)) {
                try {
                  mcpMgr.upsertConfig({ id, ...(cfg as any) });
                  imported.push(id);
                } catch (e: any) { /* skip invalid */ }
              }
              if (args.connect) {
                await mcpMgr.startEnabledServers();
              }
              return { name, args, result: `Imported ${imported.length} server(s): ${imported.join(', ')}`, error: false };
            }

            // ── start_enabled ─────────────────────────────────────────
            // Connect all enabled servers that aren't already connected.
            if (action === 'start_enabled') {
              await mcpMgr.startEnabledServers();
              const statuses = mcpMgr.getStatus();
              const connected = statuses.filter(s => s.status === 'connected');
              return {
                name, args,
                result: `start_enabled complete — ${connected.length}/${statuses.length} servers now connected:\n` +
                  connected.map(s => `  ✅ ${s.id}: ${s.tools} tools`).join('\n'),
                error: false,
              };
            }

            return { name, args, result: `Unknown mcp_server_manage action: "${action}". Valid: list, status, connect, disconnect, delete, upsert, import, list_tools, start_enabled`, error: true };
          } catch (err: any) {
            return { name, args, result: `mcp_server_manage error: ${err.message}`, error: true };
          }
        }

        // ── Team collaboration tools ────────────────────────────────────
        if (name === 'talk_to_teammate') {
          try {
            const targetAgentId = String(args?.agent_id || '').trim();
            const message = String(args?.message || '').trim();
            const messageTypeRaw = String(args?.type || 'chat').trim().toLowerCase();
            const messageType = ['chat', 'feedback', 'blocker', 'plan', 'result'].includes(messageTypeRaw)
              ? messageTypeRaw as 'chat' | 'feedback' | 'blocker' | 'plan' | 'result'
              : 'chat';
            const noteContext = inferTeamNoteContext(sessionId);
            if (!noteContext || noteContext.authorType !== 'subagent') {
              return { name, args, result: 'ERROR: talk_to_teammate only works inside a team subagent session.', error: true };
            }
            if (!targetAgentId || !message) {
              return { name, args, result: 'ERROR: talk_to_teammate requires agent_id and message.', error: true };
            }
            const team = getManagedTeam(noteContext.teamId);
            if (!team) return { name, args, result: `ERROR: Team not found: ${noteContext.teamId}`, error: true };
            const fromAgentId = noteContext.authorId;
            const fromAgent = getAgentById(fromAgentId) as any;
            const fromName = String(fromAgent?.name || fromAgentId).trim();
            const { queueAgentMessage, queueManagerMessage } = require('../teams/managed-teams');
            const targetMetadata = getTeamChatTargetMetadata(targetAgentId);

            if (targetAgentId === 'manager') {
              const ok = queueManagerMessage(noteContext.teamId, fromAgentId, message);
              if (!ok) return { name, args, result: 'ERROR: Could not queue manager message.', error: true };
            } else if (targetAgentId === 'all') {
              for (const teammateId of team.subagentIds) {
                if (teammateId === fromAgentId) continue;
                queueAgentMessage(noteContext.teamId, teammateId, `[Broadcast from ${fromName}] ${message}`);
                scheduleTeamMemberAutoWake(noteContext.teamId, teammateId, {
                  reason: `${fromName} broadcast a new room message for the team.`,
                  source: 'teammate_message',
                });
              }
              queueManagerMessage(noteContext.teamId, fromAgentId, `[Broadcast to team] ${message}`);
            } else {
              if (!team.subagentIds.includes(targetAgentId)) {
                return { name, args, result: `ERROR: ${targetAgentId} is not a member of team "${team.name}".`, error: true };
              }
              if (targetAgentId === fromAgentId) {
                return { name, args, result: 'ERROR: talk_to_teammate cannot target the same agent.', error: true };
              }
              const ok = queueAgentMessage(noteContext.teamId, targetAgentId, `[From ${fromName}] ${message}`);
              if (!ok) return { name, args, result: `ERROR: Could not queue message for ${targetAgentId}.`, error: true };
              scheduleTeamMemberAutoWake(noteContext.teamId, targetAgentId, {
                reason: `${fromName} sent you a direct teammate message.`,
                source: 'teammate_message',
              });
            }

            appendAndBroadcastTeamChat(deps, team, {
              from: 'subagent',
              fromName,
              fromAgentId,
              content: message,
              metadata: {
                agentId: fromAgentId,
                source: 'talk_to_teammate',
                messageType,
                ...targetMetadata,
              },
            });
            return { name, args, result: `Message sent to ${targetAgentId}: "${message.slice(0, 80)}"`, error: false };
          } catch (err: any) {
            return { name, args, result: `talk_to_teammate error: ${err.message}`, error: true };
          }
        }

        if (name === 'update_my_status') {
          try {
            const noteContext = inferTeamNoteContext(sessionId);
            if (!noteContext || noteContext.authorType !== 'subagent') {
              return { name, args, result: 'ERROR: update_my_status only works inside a team subagent session.', error: true };
            }
            const fromAgentId = noteContext.authorId;
            const fromAgent = getAgentById(fromAgentId) as any;
            const phase = String(args.phase || 'running').trim() || 'running';
            const currentTask = String(args.current_task || '').trim();
            const blockedReason = String(args.blocked_reason || '').trim();
            const agentName = String(fromAgent?.name || fromAgentId).trim();
            const status = updateTeamMemberState(noteContext.teamId, fromAgentId, {
              status: phase,
              currentTask,
              blockedReason,
              lastResult: args.result,
            });
            if (!status) return { name, args, result: `ERROR: Could not update status for ${fromAgentId}.`, error: true };
            const mirroredTaskId = maybeStartTeamStatusTaskMirror(
              sessionId,
              deps,
              noteContext,
              agentName,
              phase,
              currentTask,
              blockedReason,
            );
            const summaryParts = [String(status.status)];
            if (status.currentTask) summaryParts.push(String(status.currentTask));
            if (status.blockedReason) summaryParts.push(`blocked: ${String(status.blockedReason)}`);
            if (status.lastResult) summaryParts.push(`result: ${String(status.lastResult).slice(0, 120)}`);
            const normalizedStatus = String(status.status || '').toLowerCase();
            const isAttentionStatus = normalizedStatus === 'blocked' || normalizedStatus === 'waiting_for_context';
            const shouldMirrorStatusToChat = args?.announce === true || args?.mirror_to_chat === true || isAttentionStatus;
            appendTeamRoomMessage(noteContext.teamId, {
              actorType: 'member',
              actorName: agentName,
              actorId: fromAgentId,
              content: `Status update: ${summaryParts.join(' | ')}`,
              category: 'status',
              target: 'all',
              metadata: {
                agentId: fromAgentId,
                source: 'update_my_status',
              },
            }, {
              mirrorToChat: noteContext.conversationMode !== 'member_direct' && shouldMirrorStatusToChat,
            });
            if (mirroredTaskId) {
              return {
                name,
                args,
                result: `Status updated: ${status.status}${status.currentTask ? ' - ' + status.currentTask.slice(0, 60) : ''} | task mirror: ${mirroredTaskId}`,
                error: false,
              };
            }
            return { name, args, result: `Status updated: ${status.status}${status.currentTask ? ' — ' + status.currentTask.slice(0, 60) : ''}`, error: false };
          } catch (err: any) {
            return { name, args, result: `update_my_status error: ${err.message}`, error: true };
          }
        }

        if (name === 'update_team_goal') {
          try {
            const noteContext = inferTeamNoteContext(sessionId);
            if (!noteContext || noteContext.authorType !== 'subagent') {
              return { name, args, result: 'ERROR: update_team_goal only works inside a team subagent session.', error: true };
            }
            const fromAgentId = noteContext.authorId;
            const fromAgent = getAgentById(fromAgentId) as any;
            const goal = upsertTeamPlanItem(noteContext.teamId, {
              goalId: String(args.goal_id || '').trim() || undefined,
              description: String(args.description || '').trim(),
              priority: args.priority,
              status: args.status,
              reason: String(args.reason || '').trim(),
              createdBy: fromAgentId,
            });
            if (!goal) {
              return { name, args, result: 'ERROR: Could not create or update the team plan item.', error: true };
            }
            appendTeamRoomMessage(noteContext.teamId, {
              actorType: 'member',
              actorName: String(fromAgent?.name || fromAgentId).trim(),
              actorId: fromAgentId,
              content: `${String(args.goal_id || '').trim() ? 'Updated plan item' : 'Proposed new plan item'}: ${goal.description}${goal.reason ? ` (reason: ${goal.reason})` : ''}`,
              category: 'goal_update',
              target: 'all',
              metadata: {
                agentId: fromAgentId,
                source: 'update_team_goal',
              },
            });
            return { name, args, result: `${String(args.goal_id || '').trim() ? 'Goal updated' : 'Goal created'}: ${goal.id} — ${goal.description}`, error: false };
          } catch (err: any) {
            return { name, args, result: `update_team_goal error: ${err.message}`, error: true };
          }
        }

        if (name === 'share_artifact') {
          try {
            const noteContext = inferTeamNoteContext(sessionId);
            if (!noteContext || noteContext.authorType !== 'subagent') {
              return { name, args, result: 'ERROR: share_artifact only works inside a team subagent session.', error: true };
            }
            const fromAgentId = noteContext.authorId;
            const fromAgent = getAgentById(fromAgentId) as any;
            const artifact = shareTeamArtifact(noteContext.teamId, {
              name: String(args.name || '').trim(),
              type: String(args.type || 'data').trim(),
              description: String(args.description || '').trim(),
              content: args.content,
              path: args.path,
              createdBy: fromAgentId,
            });
            if (!artifact) return { name, args, result: 'ERROR: Could not share artifact.', error: true };
            routeTeamEvent({
              type: 'member_shared_artifact',
              teamId: noteContext.teamId,
              agentId: fromAgentId,
              agentName: String(fromAgent?.name || fromAgentId).trim(),
              artifactName: artifact.name,
              artifactPath: artifact.path,
              resultSummary: artifact.description || artifact.content,
              source: 'share_artifact',
            });
            return { name, args, result: `Artifact shared: ${artifact.name} (${artifact.type})`, error: false };
          } catch (err: any) {
            return { name, args, result: `share_artifact error: ${err.message}`, error: true };
          }
        }

        // ── set_agent_model: update a specific agent's model or a type-level default ─
        if (name === 'set_current_model') {
          const modelRef = String(args?.model || '').trim();
          const reason = String(args?.reason || '').trim();
          if (!modelRef) {
            return { name, args, result: 'ERROR: model is required. Format: "provider/model" e.g. "xai/grok-4.3" or "openai_codex/gpt-5.5"', error: true };
          }

          const parsed = parseProviderModelRef(modelRef);
          if (!parsed) {
            return { name, args, result: `ERROR: Invalid model "${modelRef}". Expected a known provider/model route such as "xai/grok-4.3" or "openai_codex/gpt-5.5".`, error: true };
          }

          try {
            const cm = getConfig();
            const current = cm.getConfig() as any;
            const currentLlm = current.llm || {};
            const currentProviders = currentLlm.providers || {};
            cm.updateConfig({
              llm: {
                ...currentLlm,
                provider: parsed.providerId,
                providers: {
                  ...currentProviders,
                  [parsed.providerId]: {
                    ...(currentProviders[parsed.providerId] || {}),
                    model: parsed.model,
                  },
                },
              },
              models: {
                ...(current.models || {}),
                primary: parsed.model,
                roles: {
                  ...(current.models?.roles || {}),
                  manager: parsed.model,
                  executor: parsed.model,
                  verifier: parsed.model,
                },
              },
            } as any);
            resetProvider();
            return {
              name,
              args,
              result: JSON.stringify({
                success: true,
                current_model: `${parsed.providerId}/${parsed.model}`,
                provider: parsed.providerId,
                model: parsed.model,
                reason: reason || null,
                note: 'Current primary model updated. This is not an agent_model_defaults change; the next model call in this live chat will use this route.',
              }, null, 2),
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `set_current_model error: ${err.message}`, error: true };
          }
        }

        if (name === 'set_agent_model') {
          const targetAgentId = String(args?.agent_id || '').trim();
          const model         = String(args?.model      || '').trim();
          const agentType     = String(args?.agent_type || '').trim();

          if (!model) {
            return { name, args, result: 'ERROR: model is required. Format: "provider/model" e.g. "anthropic/claude-haiku-4-5-20251001" or "openai/gpt-4o"', error: true };
          }

          const { getConfig: _gc } = require('../../config/config');
          const _cfg = _gc().getConfig() as any;
          const gatewayPort = Number(_cfg?.gateway?.port) || 18789;
          const configuredHost = String(_cfg?.gateway?.host || '127.0.0.1');
          const gatewayHost = (configuredHost === '0.0.0.0' || configuredHost === '::') ? '127.0.0.1' : configuredHost;

          try {
            if (targetAgentId) {
              // Path 1: update a specific agent definition's model field
              const resp = await fetch(`http://${gatewayHost}:${gatewayPort}/api/agents/${encodeURIComponent(targetAgentId)}/model`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model }),
              });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to update agent model'}`, error: true };
              return { name, args, result: `✅ Agent "${targetAgentId}" model set to "${model}". Takes effect on next spawn.`, error: false };
            }

            if (agentType) {
              // Path 2: update a type-level default
              const VALID_TYPES = [
                'main_chat',
                'proposal_executor_high_risk',
                'proposal_executor_low_risk',
                'manager',
                'team_manager',
                'subagent',
                'team_subagent',
                'subagent_planner',
                'subagent_orchestrator',
                'subagent_researcher',
                'subagent_analyst',
                'subagent_builder',
                'subagent_operator',
                'subagent_verifier',
                'switch_model_low',
                'switch_model_medium',
                'coordinator',
                'background_task',
                'background_agent',
              ];
              if (!VALID_TYPES.includes(agentType)) {
                return { name, args, result: `ERROR: Invalid agent_type "${agentType}". Valid values: ${VALID_TYPES.join(', ')}`, error: true };
              }
              const resp = await fetch(`http://${gatewayHost}:${gatewayPort}/api/settings/agent-model-defaults`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [agentType]: model }),
              });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: Failed to update type default`, error: true };
              return { name, args, result: `✅ Default model for "${agentType}" agents set to "${model}". New agents of this type will use this model.`, error: false };
            }

            return { name, args, result: 'ERROR: Provide either agent_id (to update a specific agent) or agent_type (to set a type-level default).', error: true };
          } catch (err: any) {
            return { name, args, result: `set_agent_model error: ${err.message}`, error: true };
          }
        }

        // ── get_agent_models: read current model config for all agent types ─────
        if (name === 'get_agent_models') {
          try {
            const { getConfig: _gc2 } = require('../../config/config');
            const cfg2 = _gc2().getConfig() as any;
            const defaults = cfg2.agent_model_defaults || {};
            const activeProvider = String(cfg2.llm?.provider || '').trim() || null;
            const primaryModel = cfg2.llm?.providers?.[cfg2.llm?.provider]?.model || cfg2.models?.primary || null;
            const agents = (cfg2.agents || []).map((a: any) => ({
              id:    a.id,
              name:  a.name,
              model: a.model || null,
            }));
            const result = {
              current_primary: activeProvider && primaryModel ? `${activeProvider}/${primaryModel}` : primaryModel,
              current_provider: activeProvider,
              global_primary: primaryModel,
              agent_model_defaults: defaults,
              active_agent_model_default_template: cfg2.active_agent_model_default_template || null,
              agent_model_default_templates: cfg2.agent_model_default_templates || [],
              individual_agent_overrides: agents,
            };
            return { name, args, result: JSON.stringify(result, null, 2), error: false };
          } catch (err: any) {
            return { name, args, result: `get_agent_models error: ${err.message}`, error: true };
          }
        }

        // ── gateway_restart: quick graceful restart ─────────────────────────
        if (
          name === 'list_agent_model_templates' ||
          name === 'save_agent_model_template' ||
          name === 'update_agent_model_template' ||
          name === 'apply_agent_model_template' ||
          name === 'select_agent_model_template' ||
          name === 'delete_agent_model_template'
        ) {
          const { getConfig: _gc3 } = require('../../config/config');
          const _cfg3 = _gc3().getConfig() as any;
          const gatewayPort = Number(_cfg3?.gateway?.port) || 18789;
          const configuredHost = String(_cfg3?.gateway?.host || '127.0.0.1');
          const gatewayHost = (configuredHost === '0.0.0.0' || configuredHost === '::') ? '127.0.0.1' : configuredHost;
          const baseUrl = `http://${gatewayHost}:${gatewayPort}/api/settings/agent-model-default-templates`;

          try {
            if (name === 'list_agent_model_templates') {
              const resp = await fetch(baseUrl);
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to list templates'}`, error: true };
              return { name, args, result: JSON.stringify(data, null, 2), error: false };
            }

            if (name === 'save_agent_model_template') {
              const templateName = String(args?.name || '').trim();
              if (!templateName) return { name, args, result: 'ERROR: name is required.', error: true };
              const body: any = { name: templateName };
              if (args?.id) body.id = String(args.id).trim();
              if (args?.defaults && typeof args.defaults === 'object') body.defaults = args.defaults;
              const resp = await fetch(baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to save template'}`, error: true };
              return { name, args, result: `Saved agent model template "${data.template?.name || templateName}" (${data.template?.id || 'new'}).`, error: false };
            }

            const id = String(args?.id || args?.name || '').trim();
            if (!id) return { name, args, result: 'ERROR: id or name is required.', error: true };

            if (name === 'update_agent_model_template') {
              const body: any = {};
              if (typeof args?.name === 'string' && args.name.trim()) body.name = args.name.trim();
              if (args?.defaults && typeof args.defaults === 'object') body.defaults = args.defaults;
              if (!Object.keys(body).length) return { name, args, result: 'ERROR: provide name and/or defaults to update.', error: true };
              const resp = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to update template'}`, error: true };
              return { name, args, result: `Updated agent model template "${data.template?.name || id}" (${data.template?.id || id}).`, error: false };
            }

            if (name === 'apply_agent_model_template' || name === 'select_agent_model_template') {
              const resp = await fetch(`${baseUrl}/${encodeURIComponent(id)}/apply`, { method: 'POST' });
              const data = await resp.json() as any;
              if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to apply template'}`, error: true };
              return { name, args, result: `Selected and applied agent model template "${data.template?.name || id}". Current defaults: ${JSON.stringify(data.defaults || {}, null, 2)}`, error: false };
            }

            const resp = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const data = await resp.json() as any;
            if (!data?.success) return { name, args, result: `ERROR: ${data?.error || 'Failed to delete template'}`, error: true };
            return { name, args, result: `Deleted agent model template "${data.removed?.name || id}".`, error: false };
          } catch (err: any) {
            return { name, args, result: `${name} error: ${err.message}`, error: true };
          }
        }

        if (name === 'prom_apply_dev_changes') {
          const requestedDevEditId = String(args.dev_edit_id || args.devEditId || '').trim();
          const activeDevEdit = requestedDevEditId
            ? getDevSourceEditContinuation(requestedDevEditId)
            : getLatestPendingDevSourceEditContinuation(sessionId);
          const explicitAffectedFiles = Array.isArray(args.affected_files)
            ? args.affected_files.map((f: any) => String(f || '').trim()).filter(Boolean)
            : [];
          const affectedFiles = explicitAffectedFiles.length
            ? explicitAffectedFiles
            : Array.isArray(activeDevEdit?.affectedFiles) && activeDevEdit.affectedFiles.length
              ? activeDevEdit.affectedFiles
              : activeDevEdit?.allowedFiles || [];
          const surfaces = Array.isArray(args.changed_surfaces)
            ? args.changed_surfaces.map((s: any) => String(s || '').trim().toLowerCase()).filter(Boolean)
            : [];
          const inferredSurfaces = getPromApplySurfacesForFiles(affectedFiles);
          const normalizedSurfaces: string[] = Array.from(new Set<string>([...surfaces, ...inferredSurfaces].map((surface: string) => {
            if (surface === 'src' || surface === 'gateway') return 'backend';
            return surface;
          })));
          const hasBackend = normalizedSurfaces.some((surface: string) => surface === 'backend' || surface === 'config');
          const hasWeb = normalizedSurfaces.some((surface: string) => surface === 'web-ui' || surface === 'mobile' || surface === 'static');
          const refreshDesktop = args.refresh_desktop !== false;
          const mode = String(args.mode || 'apply_live').trim().toLowerCase();
          const verifyOnly = mode === 'verify_only';
          const reason = String(args.reason || 'Prometheus dev changes applied').trim();
          if (!normalizedSurfaces.length) {
            return { name, args, result: 'prom_apply_dev_changes requires changed_surfaces or affected_files that map to src/ or web-ui/.', error: true };
          }
          if (!['apply_live', 'verify_only'].includes(mode)) {
            return { name, args, result: 'prom_apply_dev_changes mode must be apply_live or verify_only.', error: true };
          }
          const completionNoteTag = String(
            args.completion_note_tag
            || args.completionNoteTag
            || activeDevEdit?.completionNoteTag
            || activeDevEdit?.plan?.completionNoteTag
            || 'dev_edit_complete',
          ).trim().replace(/\s+/g, '_').toLowerCase();

          const runCommand = (command: string, timeoutMs: number) => {
            const { execSync } = require('child_process');
            const root = path.resolve(__dirname, '..', '..', '..');
            const start = Date.now();
            try {
              const output = execSync(command, {
                cwd: root,
                encoding: 'utf-8',
                timeout: timeoutMs,
                stdio: 'pipe',
                windowsHide: true,
              });
              return { success: true, command, output: String(output || '').slice(-2500), durationMs: Date.now() - start };
            } catch (err: any) {
              const output = [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n');
              return { success: false, command, output: String(output || '').slice(-2500), durationMs: Date.now() - start };
            }
          };

          const steps: any[] = [];
          if (verifyOnly) {
            const plan = resolveDevVerificationPlan({
              mode: 'verify_only',
              changedFiles: affectedFiles,
              changedSurfaces: normalizedSurfaces,
              approvedProfiles: activeDevEdit?.verificationProfiles || activeDevEdit?.verificationProfile,
              requestedProfiles: args.verification_profiles || args.verificationProfiles || args.verification_profile || args.verificationProfile,
              rootDir: path.resolve(__dirname, '..', '..', '..'),
            });
            const results = await runDevVerificationPlan(plan, path.resolve(__dirname, '..', '..', '..'));
            const failed = results.find((result) => !result.success);
            if (activeDevEdit) {
              upsertDevSourceEditContinuation({
                ...activeDevEdit,
                affectedFiles,
                changedSurfaces: normalizedSurfaces,
                verificationProfiles: plan.profileIds,
                verificationProfile: plan.profileIds[0],
                lastVerification: {
                  profileIds: plan.profileIds,
                  changedFiles: plan.changedFiles,
                  success: !failed,
                  summary: formatDevVerificationSummary(plan, results),
                  completedAt: Date.now(),
                },
                updatedAt: Date.now(),
              });
            }
            if (failed) {
              const completed = results.filter((result) => result.success);
              return {
                name,
                args,
                result:
                  `prom_apply_dev_changes verify_only failed during ${failed.label} (${failed.durationMs}ms).\n\n` +
                  `${formatDevVerificationSummary(plan, results)}` +
                  (completed.length ? `\n\nCompleted first:\n${completed.map((s) => `- ${s.label}: ok (${s.durationMs}ms)`).join('\n')}` : '') +
                  `\n\n${failed.output || ''}`,
                error: true,
              };
            }
            return {
              name,
              args,
              result:
                `prom_apply_dev_changes verify_only succeeded.\n` +
                `${formatDevVerificationSummary(plan, results)}\n` +
                `Gateway was not restarted${hasWeb && refreshDesktop ? ', and no desktop reload was requested' : ''}.`,
              error: false,
            };
          }

          if (hasWeb) {
            const sync = runCommand('npm run sync:web-ui', 120_000);
            steps.push(sync);
            if (!sync.success) {
              return {
                name,
                args,
                result: `prom_apply_dev_changes failed during ${sync.command} (${sync.durationMs}ms).\n\n${sync.output}`,
                error: true,
              };
            }
          }

          const buildDevEditContinuation = (status: 'applying_live') => activeDevEdit ? {
            ...activeDevEdit,
            status,
            completionNoteTag,
            affectedFiles,
            changedSurfaces: normalizedSurfaces,
            summary: String(args.summary || reason || activeDevEdit.summary || '').trim() || undefined,
            verification: Array.isArray(activeDevEdit.verification) ? activeDevEdit.verification : activeDevEdit.plan?.verification,
            verificationProfile: activeDevEdit.verificationProfile,
            verificationProfiles: activeDevEdit.verificationProfiles,
            updatedAt: Date.now(),
          } : undefined;

          const devEditContinuation = buildDevEditContinuation('applying_live');
          if (devEditContinuation) {
            upsertDevSourceEditContinuation(devEditContinuation);
          }

          if (hasBackend) {
            try {
              const { buildAndRestart } = require('../lifecycle');
              const sessionHint = getSessionChannelHint(sessionId);
              const isTelegramSession = String(sessionId || '').startsWith('telegram_') || sessionHint?.channel === 'telegram';
              const ctx = {
                reason: (args.proposal_id ? 'proposal' : 'build_deploy') as any,
                timestamp: Date.now(),
                proposalId: args.proposal_id || undefined,
                title: args.title || reason,
                summary: args.summary || reason,
                affectedFiles: affectedFiles.length ? affectedFiles : undefined,
                testInstructions: args.test_instructions || undefined,
                previousSessionId: sessionId,
                originChannel: isTelegramSession ? 'telegram' : undefined,
                respondToTelegram: isTelegramSession ? true : undefined,
                previousTelegramChatId: Number.isFinite(Number(sessionHint?.chatId)) ? String(sessionHint?.chatId) : undefined,
                previousTelegramUserId: Number.isFinite(Number(sessionHint?.userId)) ? Number(sessionHint?.userId) : undefined,
                devReload: refreshDesktop
                  ? { enabled: true, reason, surfaces: normalizedSurfaces, delayMs: 1200 }
                  : undefined,
                devEditContinuation,
              };
              const buildResult = await buildAndRestart(ctx);
              if (!buildResult.success) {
                return {
                  name,
                  args,
                  result:
                    `prom_apply_dev_changes failed during npm run build (${buildResult.durationMs}ms). Gateway was not restarted.` +
                    (steps.length ? `\n\nCompleted first:\n${steps.map((s) => `- ${s.command}: ok (${s.durationMs}ms)`).join('\n')}` : '') +
                    `\n\n${buildResult.output}`,
                  error: true,
                };
              }
              return {
                name,
                args,
                result:
                  `prom_apply_dev_changes succeeded. ` +
                  `${hasWeb ? 'Synced web UI, ' : ''}build passed (${buildResult.durationMs}ms), gateway is restarting` +
                  `${refreshDesktop ? ', and desktop web UI reload will be requested after reconnect.' : '.'}` +
                  (devEditContinuation ? ` After restart, write_note with tag "${completionNoteTag}" will complete dev edit ${devEditContinuation.id}.` : ''),
                error: false,
              };
            } catch (err: any) {
              return { name, args, result: `prom_apply_dev_changes restart error: ${err.message}`, error: true };
            }
          }

          if (refreshDesktop) {
            try {
              deps.broadcastWS?.({
                type: 'dev_reload_requested',
                target: 'all',
                source: 'prom_apply_dev_changes',
                reason,
                surfaces: normalizedSurfaces,
                timestamp: Date.now(),
              });
            } catch {}
          }
          return {
            name,
            args,
            result:
              `prom_apply_dev_changes succeeded. ` +
              `${steps.map((s) => `${s.command} ok (${s.durationMs}ms)`).join('; ') || 'No build step required'}` +
              `${refreshDesktop ? '; desktop web UI reload requested.' : '.'}` +
              (devEditContinuation ? ` Next, call write_note with tag "${completionNoteTag}" to complete dev edit ${devEditContinuation.id}.` : ''),
            data: devEditContinuation ? { dev_edit_id: devEditContinuation.id, completion_note_tag: completionNoteTag } : undefined,
            extra: devEditContinuation ? { dev_edit_id: devEditContinuation.id, completion_note_tag: completionNoteTag } : undefined,
            error: false,
          };
        }

        if (name === 'gateway_restart') {
          const reason = String(args.reason || 'manual restart').trim();
          try {
            const { gracefulRestart } = require('../lifecycle');
            const sessionHint = getSessionChannelHint(sessionId);
            const isTelegramSession = String(sessionId || '').startsWith('telegram_') || sessionHint?.channel === 'telegram';
            const resolvedTelegramChatId = Number.isFinite(Number(args.telegram_chat_id))
              ? Number(args.telegram_chat_id)
              : Number.isFinite(Number(sessionHint?.chatId))
                ? Number(sessionHint?.chatId)
                : undefined;
            const resolvedTelegramUserId = Number.isFinite(Number(args.telegram_user_id))
              ? Number(args.telegram_user_id)
              : Number.isFinite(Number(sessionHint?.userId))
                ? Number(sessionHint?.userId)
                : undefined;
            const ctx = {
              reason: (args.proposal_id ? 'proposal' : args.repair_id ? 'repair' : 'manual') as any,
              timestamp: Date.now(),
              proposalId: args.proposal_id || undefined,
              repairId: args.repair_id || undefined,
              title: args.title || reason,
              summary: args.summary || reason,
              affectedFiles: Array.isArray(args.affected_files) ? args.affected_files : undefined,
              testInstructions: args.test_instructions || undefined,
              previousSessionId: sessionId,
              originChannel: isTelegramSession ? 'telegram' : undefined,
              respondToTelegram: isTelegramSession ? true : undefined,
              previousTelegramChatId: Number.isFinite(resolvedTelegramChatId as number) ? String(resolvedTelegramChatId) : undefined,
              previousTelegramUserId: Number.isFinite(resolvedTelegramUserId as number) ? Number(resolvedTelegramUserId) : undefined,
            };
            // Same quick restart path used by Telegram/mobile/terminal /restart.
            // This is async and will kill the process, so it should remain a final action.
            await gracefulRestart(ctx);
            return {
              name, args,
              result: `✅ Quick gateway restart initiated. No npm build was run.`,
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `gateway_restart error: ${err.message}`, error: true };
          }
        }

        // ── prom_repo_push / prom_repo_pull: git sync of the Prometheus repo ───
        if (name === 'prom_repo_push' || name === 'prom_repo_pull' || name === 'prom_repo_sync') {
          const { execSync } = require('child_process');
          const fsmod = require('fs');
          const osmod = require('os');
          const repoRoot = path.resolve(__dirname, '..', '..', '..');
          const run = (command: string, timeoutMs = 120_000) => {
            const start = Date.now();
            try {
              const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: timeoutMs,
                stdio: 'pipe',
                windowsHide: true,
              });
              return { success: true, command, output: String(output || '').trim(), durationMs: Date.now() - start };
            } catch (err: any) {
              const output = [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n');
              return { success: false, command, output: String(output || '').trim(), durationMs: Date.now() - start };
            }
          };

          // Resolve the local PAT store (config dir, never the repo).
          let configDir = path.join(osmod.homedir(), '.prometheus');
          try { configDir = require('../../config/config').getConfig().getConfigDir() || configDir; } catch {}
          const patFile = path.join(configDir, 'github-pat');
          const readSavedPat = (): string => {
            try { return fsmod.existsSync(patFile) ? String(fsmod.readFileSync(patFile, 'utf-8')).trim() : ''; } catch { return ''; }
          };

          // Optionally persist a PAT handed over by the user, then use it immediately.
          let patSaveNote = '';
          const incomingPat = String(args?.set_pat || args?.pat || '').trim();
          if (incomingPat) {
            try {
              if (!fsmod.existsSync(configDir)) fsmod.mkdirSync(configDir, { recursive: true });
              fsmod.writeFileSync(patFile, incomingPat, 'utf-8');
              try { fsmod.chmodSync(patFile, 0o600); } catch {}
              patSaveNote = `Saved GitHub PAT to ${patFile} (local only, not committed).`;
            } catch (err: any) {
              return { name, args, result: `Failed to save PAT to ${patFile}: ${err?.message || err}`, error: true };
            }
          }

          // Resolve current branch
          const branchRes = run('git rev-parse --abbrev-ref HEAD', 15_000);
          if (!branchRes.success) {
            return { name, args, result: `${name} failed to resolve the current branch:\n${branchRes.output || '(no output)'}`, error: true };
          }
          const branch = (branchRes.output.split(/\r?\n/).pop() || 'main').trim() || 'main';

          // PAT resolution order: env → freshly-handed → saved file.
          const pat = String(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || incomingPat || readSavedPat() || '').trim();
          const remoteRes = run('git remote get-url origin', 15_000);
          const remoteUrl = remoteRes.success ? (remoteRes.output.split(/\r?\n/)[0] || '').trim() : '';
          let authRemote = '';
          if (pat && /^https:\/\/([^@/]*@)?github\.com\//i.test(remoteUrl)) {
            // PAT is only passed inline to pull/push — never persisted into the git remote via set-url.
            authRemote = remoteUrl.replace(/^https:\/\/([^@/]*@)?github\.com\//i, `https://x-access-token:${pat}@github.com/`);
          }
          const remoteArg = authRemote ? `"${authRemote}"` : 'origin';
          const sanitize = (s: string) => (pat ? String(s || '').split(pat).join('***') : String(s || ''));

          // Detect auth failures so we can ask the user for a PAT instead of returning a raw error.
          const isAuthFailure = (out: string): boolean =>
            /(authentication failed|could not read username|could not read password|terminal prompts disabled|invalid username or password|permission denied|fatal: could not read|remote: (invalid|permission|repository not found)|403 forbidden|401 unauthorized|support for password authentication was removed)/i.test(String(out || ''));
          const patHelp = (action: string): string => [
            `⚠️ ACTION REQUIRED — git ${action} failed because this machine has no working GitHub credentials and no PAT is saved.`,
            '',
            'Do this:',
            `1. Ask the user for a GitHub Personal Access Token (PAT) with "repo" scope (a classic token like ghp_… or a fine-grained token with read/write contents on XposeMarket/PromSRC).`,
            `2. Once they hand it to you, call prom_repo_push again with set_pat:"<the token>" ${action === 'push' ? '(plus the commit message if you have one)' : '— this saves it'}. It is stored locally at ${patFile} (NOT committed to the repo) and reused automatically afterward.`,
            `3. Then retry the ${action}. No gateway restart is needed — the PAT is read live from disk on each call.`,
          ].join('\n');

          const prefix = patSaveNote ? patSaveNote + '\n\n' : '';

          if (name === 'prom_repo_pull') {
            const pull = run(`git pull ${remoteArg} ${branch} --no-edit`, 180_000);
            if (!pull.success && isAuthFailure(pull.output)) {
              return { name, args, result: `${prefix}${patHelp('pull')}\n\nGit output:\n${sanitize(pull.output) || '(no output)'}`, error: true };
            }
            if (!pull.success) {
              const conflicts = (run('git diff --name-only --diff-filter=U', 30_000).output || '').trim();
              if (conflicts) {
                run('git merge --abort', 30_000);
                return {
                  name,
                  args,
                  result:
                    `${prefix}❌ prom_repo_pull hit merge conflicts in:\n${conflicts}\n\n` +
                    'Merge was aborted — your working tree is unchanged. These files were changed on BOTH machines in overlapping lines. ' +
                    'Resolve by editing them on one machine only, or commit your local work and use prom_repo_sync to merge deliberately.\n\n' +
                    `${sanitize(pull.output) || '(no output)'}`,
                  error: true,
                };
              }
              if (/local changes|overwritten|commit your changes|stash/i.test(pull.output)) {
                return {
                  name,
                  args,
                  result:
                    `${prefix}❌ prom_repo_pull blocked: you have uncommitted local changes that overlap incoming changes. ` +
                    'Use prom_repo_sync — it commits your changes and merges in one safe step.\n\n' +
                    `${sanitize(pull.output) || '(no output)'}`,
                  error: true,
                };
              }
              return { name, args, result: `${prefix}❌ prom_repo_pull failed:\n${sanitize(pull.output) || '(no output)'}`, error: true };
            }
            return {
              name,
              args,
              result:
                `${prefix}✅ prom_repo_pull (${branch}) succeeded (${pull.durationMs}ms).\n\n` +
                `${sanitize(pull.output) || '(no output)'}`,
              error: false,
            };
          }

          // prom_repo_push — stage everything first so the diff/auto-message reflects untracked files too.
          const add = run('git add -A', 60_000);
          if (!add.success) {
            return { name, args, result: `prom_repo_push failed during git add -A:\n${sanitize(add.output) || '(no output)'}`, error: true };
          }

          // git diff --cached --quiet exits 0 (success) when there is nothing staged.
          const stagedCheck = run('git diff --cached --quiet', 30_000);
          const hasStaged = !stagedCheck.success;
          const message = String(args?.message || args?.commit_message || '').trim();

          // No explicit message but there ARE staged changes → return the diff so the model can author a real message.
          if (hasStaged && !message) {
            const stat = run('git diff --cached --stat', 30_000);
            const nameStatus = run('git diff --cached --name-status', 30_000);
            const fullDiff = run('git diff --cached --no-color', 60_000);
            const cappedDiff = (() => {
              const d = fullDiff.output || '';
              return d.length > 9000 ? d.slice(0, 9000) + '\n… [diff truncated]' : d;
            })();
            return {
              name,
              args,
              result: [
                `${patSaveNote ? patSaveNote + '\n\n' : ''}📋 No commit message provided. Staged all changes — here is what changed. Read it, then call prom_repo_push AGAIN with a concise, accurate message that reflects these specific changes (e.g. "Fix: …", "Features added: …; Bug fixes: …"). Do not use a generic placeholder.`,
                '',
                '── Files changed (name-status) ──',
                nameStatus.output || '(none)',
                '',
                '── Stat ──',
                stat.output || '(none)',
                '',
                '── Diff ──',
                cappedDiff || '(empty)',
              ].join('\n'),
              error: false,
            };
          }

          let committed = false;
          let commitOut = '';
          if (hasStaged) {
            const tmp = path.join(osmod.tmpdir(), `prom-commit-${Date.now()}.txt`);
            fsmod.writeFileSync(tmp, message, 'utf-8');
            const commit = run(`git commit -F "${tmp}"`, 60_000);
            try { fsmod.unlinkSync(tmp); } catch {}
            commitOut = sanitize(commit.output);
            if (!commit.success) {
              return { name, args, result: `prom_repo_push failed during git commit:\n${commitOut || '(no output)'}`, error: true };
            }
            committed = true;
          }

          // ── prom_repo_sync: commit (done above) → pull/merge → push ──────────
          if (name === 'prom_repo_sync') {
            const beforeMerge = (run('git rev-parse HEAD', 15_000).output || '').trim();
            const pull = run(`git pull ${remoteArg} ${branch} --no-edit`, 180_000);
            const commitSafeNote = committed
              ? `Your local commit "${message.split(/\r?\n/)[0]}" is safe locally; nothing was pushed.\n\n`
              : '';
            if (!pull.success) {
              if (isAuthFailure(pull.output)) {
                return { name, args, result: `${prefix}${commitSafeNote}${patHelp('pull')}\n\nGit output:\n${sanitize(pull.output) || '(no output)'}`, error: true };
              }
              const conflicts = (run('git diff --name-only --diff-filter=U', 30_000).output || '').trim();
              if (conflicts) {
                run('git merge --abort', 30_000);
                return {
                  name,
                  args,
                  result:
                    `${prefix}❌ prom_repo_sync: merge conflict — these files were changed on BOTH machines in overlapping lines:\n${conflicts}\n\n` +
                    `Merge aborted. ${commitSafeNote}` +
                    'Resolve manually: open those files, keep the intended combined content, then run prom_repo_sync again. ' +
                    '(Editing a given file on only one machine at a time avoids this entirely.)\n\n' +
                    `${sanitize(pull.output) || '(no output)'}`,
                  error: true,
                };
              }
              return { name, args, result: `${prefix}❌ prom_repo_sync: pull/merge failed.\n${commitSafeNote}${sanitize(pull.output) || '(no output)'}`, error: true };
            }

            // Push the merged result; retry once if origin advanced between our pull and push.
            let push = run(`git push ${remoteArg} ${branch}`, 180_000);
            if (!push.success && !isAuthFailure(push.output) && /non-fast-forward|fetch first|\[rejected\]|tip of your current branch is behind|updates were rejected/i.test(push.output)) {
              const pull2 = run(`git pull ${remoteArg} ${branch} --no-edit`, 180_000);
              if (pull2.success) {
                push = run(`git push ${remoteArg} ${branch}`, 180_000);
              } else {
                const conflicts2 = (run('git diff --name-only --diff-filter=U', 30_000).output || '').trim();
                if (conflicts2) run('git merge --abort', 30_000);
              }
            }
            if (!push.success && isAuthFailure(push.output)) {
              return { name, args, result: `${prefix}(Merge succeeded locally; your work is committed and safe.)\n\n${patHelp('push')}\n\nGit output:\n${sanitize(push.output) || '(no output)'}`, error: true };
            }

            const mergedIn = beforeMerge ? (run(`git diff --name-only ${beforeMerge} HEAD`, 30_000).output || '').trim() : '';
            const lines: string[] = [];
            if (patSaveNote) { lines.push(patSaveNote); lines.push(''); }
            lines.push(committed ? `Committed locally: ${message.split(/\r?\n/)[0]}` : 'No local changes to commit.');
            lines.push('');
            lines.push(mergedIn ? `Merged in from origin/${branch} (no overwrite):\n${mergedIn}` : `Nothing new on origin/${branch} to merge.`);
            lines.push('');
            lines.push(`${push.success ? '✅' : '❌'} push to origin/${branch} ${push.success ? 'succeeded' : 'failed'} (${push.durationMs}ms).`);
            lines.push(sanitize(push.output) || '(no output)');
            if (push.success) {
              lines.push('');
              lines.push(`Done — local and origin/${branch} now hold the combined history. Run prom_repo_sync (or prom_repo_pull) on the OTHER machine to bring these changes down there too.`);
            }
            return { name, args, result: lines.join('\n'), error: !push.success };
          }

          const push = run(`git push ${remoteArg} ${branch}`, 180_000);
          if (!push.success && !isAuthFailure(push.output) && /non-fast-forward|fetch first|\[rejected\]|tip of your current branch is behind|updates were rejected/i.test(push.output)) {
            return {
              name,
              args,
              result:
                `${prefix}❌ prom_repo_push rejected: origin/${branch} has commits you don't have locally (likely pushed from the other machine). ` +
                'Git blocked the push so nothing gets overwritten. Use prom_repo_sync instead — it merges those in and pushes the combined result safely.\n\n' +
                `${sanitize(push.output) || '(no output)'}`,
              error: true,
            };
          }
          if (!push.success && isAuthFailure(push.output)) {
            return {
              name,
              args,
              result:
                `${patSaveNote ? patSaveNote + '\n\n' : ''}` +
                `${committed ? `(Local commit "${message.split(/\r?\n/)[0]}" was created and is waiting to be pushed.)\n\n` : ''}` +
                `${patHelp('push')}\n\nGit output:\n${sanitize(push.output) || '(no output)'}`,
              error: true,
            };
          }
          const lines: string[] = [];
          if (patSaveNote) { lines.push(patSaveNote); lines.push(''); }
          lines.push(
            committed
              ? `Committed: ${message.split(/\r?\n/)[0]}`
              : 'No local changes to commit — pushing any unpushed commits.',
          );
          if (commitOut) lines.push(commitOut);
          lines.push('');
          lines.push(`${push.success ? '✅' : '❌'} push to origin/${branch} ${push.success ? 'succeeded' : 'failed'} (${push.durationMs}ms).`);
          lines.push(sanitize(push.output) || '(no output)');
          if (!pat) {
            lines.push('');
            lines.push('Note: no PAT in use — relied on the OS git credential helper.');
          }
          return { name, args, result: lines.join('\n'), error: !push.success };
        }

        // ── connector_list: always-available connector discovery ──────────────
        if (name === 'connector_list') {
          return { name, args, result: buildConnectorStatus(), error: false };
        }

        // ── connector_* tools: dispatch to connector handlers ─────────────
        if (name.startsWith('connector_') && name !== 'connector_list') {
          ensurePrometheusExtensionRuntimeLoaded();
          const connResult = await getExtensionRuntimeRegistry().executeTool(name, args);
          return { name, args, ...connResult };
        }

        // Extension tools that are not connector-prefixed, such as x_search and
        // xai_live_search, are advertised by the runtime registry and should
        // execute through the same extension boundary.
        ensurePrometheusExtensionRuntimeLoaded();
        if (getExtensionRuntimeRegistry().getTool(name)) {
          const extensionResult = await getExtensionRuntimeRegistry().executeTool(name, args);
          return { name, args, ...extensionResult };
        }

        if (name === 'ask_prometheus_questions' || name === 'await_prometheus_question_response') {
          const questionQueue = getPrometheusQuestionQueue();
          const activeTask = resolveTaskForSession(sessionId);
          const activeTaskId = String(activeTask?.id || '').trim() || undefined;

          if (name === 'await_prometheus_question_response') {
            const questionId = String(args?.question_id || args?.questionId || '').trim();
            if (!questionId) {
              return { name, args, result: 'await_prometheus_question_response requires question_id.', error: true };
            }
            const existing = questionQueue.get(questionId);
            if (!existing) {
              return { name, args, result: `Prometheus question ${questionId} not found.`, error: true };
            }
            if (existing.sessionId !== sessionId) {
              return { name, args, result: 'Cannot await a Prometheus question from a different session.', error: true };
            }
            if (existing.status !== 'pending') {
              if (existing.status === 'answered') {
                return {
                  name,
                  args,
                  result: `Prometheus question ${questionId} was already answered.\n${JSON.stringify({ answers: existing.answers || [], generalOther: existing.generalOther || '' }, null, 2)}`,
                  data: { question_id: questionId, answers: existing.answers || [], generalOther: existing.generalOther || '' },
                  error: false,
                };
              }
              return { name, args, result: `Prometheus question ${questionId} is ${existing.status}.`, error: true };
            }

            const waitResult = await new Promise<{ answers: PrometheusQuestionAnswer[]; generalOther?: string } | { steerInterrupt: string }>((resolve) => {
              let settled = false;
              const safeResolve = (value: { answers: PrometheusQuestionAnswer[]; generalOther?: string } | { steerInterrupt: string }) => {
                if (settled) return;
                settled = true;
                questionQueue.clearSteerCallback(questionId);
                resolve(value);
              };
              questionQueue.onResolve(questionId, (answerPayload) => safeResolve(answerPayload));
              questionQueue.onSteer(questionId, (steerMessage) => safeResolve({ steerInterrupt: steerMessage }));
            });

            if ('steerInterrupt' in waitResult) {
              try {
                deps.broadcastWS({ type: 'question_steer_interrupt', sessionId, questionId, steerMessage: waitResult.steerInterrupt.slice(0, 500) });
              } catch {}
              return {
                name,
                args,
                result:
                  `[STEER RECEIVED WHILE WAITING FOR PROMETHEUS QUESTION]\n` +
                  `Steer message: "${waitResult.steerInterrupt}"\n\n` +
                  `Question ${questionId} is still pending. Address the steer, then call await_prometheus_question_response(question_id: "${questionId}") to resume waiting.`,
                error: false,
              };
            }

            return {
              name,
              args,
              result: `Prometheus question ${questionId} answered.\n${JSON.stringify(waitResult, null, 2)}`,
              data: { question_id: questionId, ...waitResult },
              error: false,
            };
          }

          let payload;
          try {
            const origin = inferApprovalOrigin(sessionId, activeTask, args);
            payload = createPrometheusQuestionPayload({
              sessionId,
              taskId: activeTaskId,
              agentId: inferAgentIdFromSession(sessionId, args),
              originType: origin.originType === 'proposal' ? 'unknown' : origin.originType,
              originLabel: origin.originLabel,
              title: args?.title,
              prompt: args?.prompt || args?.message || args?.question,
              context: args?.context || args?.reason,
              questions: args?.questions,
              allowGeneralOther: args?.allow_general_other ?? args?.allowGeneralOther,
              ttlMs: args?.ttl_ms || args?.ttlMs,
            });
          } catch (err: any) {
            return { name, args, result: `ask_prometheus_questions error: ${err.message || err}`, error: true };
          }

          if (activeTaskId) {
            updateTaskStatus(activeTaskId, 'needs_assistance', { pauseReason: 'awaiting_prometheus_question_response' });
            appendJournal(activeTaskId, {
              type: 'pause',
              content: `Waiting for Prometheus question response: ${payload.title.slice(0, 220)}`,
            });
          }

          const question = questionQueue.create(payload);
          try {
            appendAuditEntry({
              timestamp: new Date().toISOString(),
              sessionId,
              agentId: inferAgentIdFromSession(sessionId, args),
              actionType: 'tool_executed' as any,
              toolName: name,
              toolArgs: { question_id: question.id, title: question.title, prompt: question.prompt, questions: question.questions },
              policyTier: 'propose',
              approvalStatus: 'auto_allowed' as any,
              resultSummary: `Queued Prometheus question ${question.id}`,
            });
          } catch {}

          try {
            deps.broadcastWS({
              type: 'question_created',
              sessionId,
              taskId: activeTaskId,
              questionId: question.id,
              summary: question.prompt,
              question: serializePrometheusQuestionForClient(question),
            });
            if (activeTaskId) {
              deps.broadcastWS({
                type: 'task_needs_assistance',
                taskId: activeTaskId,
                title: activeTask?.title,
                reason: 'Prometheus question response required',
                detail: question.prompt,
              });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            }
          } catch {}

          try {
            if (deps.telegramChannel?.sendPrometheusQuestion) {
              await deps.telegramChannel.sendPrometheusQuestion(question);
            }
          } catch (err: any) {
            console.warn('[prometheus_questions] Could not send Telegram question:', err?.message || err);
          }

          const waitResult = await new Promise<{ answers: PrometheusQuestionAnswer[]; generalOther?: string } | { steerInterrupt: string }>((resolve) => {
            let settled = false;
            const safeResolve = (value: { answers: PrometheusQuestionAnswer[]; generalOther?: string } | { steerInterrupt: string }) => {
              if (settled) return;
              settled = true;
              questionQueue.clearSteerCallback(question.id);
              resolve(value);
            };
            questionQueue.onResolve(question.id, (answerPayload) => safeResolve(answerPayload));
            questionQueue.onSteer(question.id, (steerMessage) => safeResolve({ steerInterrupt: steerMessage }));
          });

          if ('steerInterrupt' in waitResult) {
            try {
              deps.broadcastWS({ type: 'question_steer_interrupt', sessionId, questionId: question.id, steerMessage: waitResult.steerInterrupt.slice(0, 500) });
            } catch {}
            return {
              name,
              args,
              result:
                `[STEER RECEIVED WHILE WAITING FOR PROMETHEUS QUESTION]\n` +
                `Steer message: "${waitResult.steerInterrupt}"\n\n` +
                `Question ${question.id} is still pending. Address the steer, then call await_prometheus_question_response(question_id: "${question.id}") to resume waiting.`,
              error: false,
            };
          }

          try {
            if (activeTaskId) {
              updateTaskStatus(activeTaskId, 'running', { pauseReason: undefined });
              appendJournal(activeTaskId, {
                type: 'resume',
                content: `Prometheus question answered: ${question.title.slice(0, 220)}`,
              });
              deps.broadcastWS({ type: 'task_running', taskId: activeTaskId, title: activeTask?.title });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            }
            deps.broadcastWS({
              type: 'question_answered',
              sessionId,
              taskId: activeTaskId,
              questionId: question.id,
              question: serializePrometheusQuestionForClient(questionQueue.get(question.id) || question),
            });
          } catch {}

          return {
            name,
            args,
            result: `Prometheus question ${question.id} answered.\n${JSON.stringify(waitResult, null, 2)}`,
            data: { question_id: question.id, ...waitResult },
            error: false,
          };
        }

        if (name === 'request_final_action_approval') {
          const scope = createFinalActionApprovalScope({
            actionKind: args?.action_kind || args?.actionKind,
            targetLabel: args?.target_label || args?.targetLabel || args?.button_label || args?.buttonLabel,
            summary: args?.summary || args?.reason,
            surface: args?.surface || args?.app || args?.site,
            nextToolName: args?.next_tool_name || args?.nextToolName,
            nextToolArgs: args?.next_tool_args || args?.nextToolArgs,
            screenshotId: args?.screenshot_id || args?.screenshotId,
            ttlMs: args?.ttl_ms || args?.ttlMs,
          });

          const approvalQueue = getApprovalQueue();
          const activeTask = resolveTaskForSession(sessionId);
          const activeTaskId = String(activeTask?.id || '').trim() || undefined;
          const approvalOrigin = inferApprovalOrigin(sessionId, activeTask, args);
          const action = `Approve final ${scope.actionKind} action: ${scope.targetLabel}`;

          if (activeTaskId) {
            updateTaskStatus(activeTaskId, 'needs_assistance', { pauseReason: 'awaiting_final_action_approval' });
            appendJournal(activeTaskId, {
              type: 'pause',
              content: `Waiting for final-action approval: ${action.slice(0, 220)}`,
            });
          }

          const approval = approvalQueue.create({
            sessionId,
            taskId: activeTaskId,
            agentId: inferAgentIdFromSession(sessionId, args),
            originType: approvalOrigin.originType,
            originLabel: approvalOrigin.originLabel,
            toolName: name,
            toolArgs: {
              action_kind: scope.actionKind,
              target_label: scope.targetLabel,
              summary: scope.summary,
              surface: scope.surface,
              next_tool_name: scope.nextToolName,
              next_tool_args: scope.nextToolArgs,
              screenshot_id: scope.screenshotId,
            },
            approvalKind: 'final_action',
            action,
            reason: scope.summary,
            policyTier: 'commit',
            riskScore: scope.actionKind === 'purchase' || scope.actionKind === 'transfer' || scope.actionKind === 'delete' ? 9 : 7,
            affectedSystems: [scope.surface || 'external UI'],
            finalAction: scope,
          });

          try {
            appendAuditEntry({
              timestamp: new Date().toISOString(),
              sessionId,
              agentId: inferAgentIdFromSession(sessionId, args),
              actionType: 'approval_requested',
              toolName: name,
              toolArgs: approval.toolArgs,
              policyTier: 'commit',
              approvalStatus: 'pending',
              resultSummary: `Queued final-action approval ${approval.id}`,
            });
          } catch {}

          try {
            deps.broadcastWS({
              type: 'approval_created',
              sessionId,
              taskId: activeTaskId,
              approvalId: approval.id,
              summary: approval.action,
              toolName: name,
              approval: serializeApprovalForClient(approval),
            });
            if (activeTaskId) {
              deps.broadcastWS({
                type: 'task_needs_assistance',
                taskId: activeTaskId,
                title: activeTask?.title,
                reason: 'Final action approval required',
                detail: action,
              });
              deps.broadcastWS({ type: 'task_panel_update', taskId: activeTaskId });
            }
          } catch {}

          try {
            if (deps.telegramChannel?.sendCommandApproval) {
              await deps.telegramChannel.sendCommandApproval(approval);
            }
          } catch (err: any) {
            console.warn('[final_action_approval] Could not send Telegram approval:', err?.message || err);
          }

          const approved = await new Promise<boolean>((resolve) => {
            approvalQueue.onResolve(approval.id, (isApproved) => {
              if (isApproved) {
                grantFinalActionApproval(sessionId, approval.id, scope, 'approval');
              }
              resolve(isApproved);
            });
          });

          try {
            if (activeTaskId) {
              updateTaskStatus(activeTaskId, 'running', { pauseReason: undefined });
              appendJournal(activeTaskId, {
                type: approved ? 'resume' : 'status_push',
                content: approved
                  ? `Final action approved: ${action.slice(0, 220)}`
                  : `Final action rejected: ${action.slice(0, 220)}`,
              });
              deps.broadcastWS({ type: 'task_running', taskId: activeTaskId, title: activeTask?.title });
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
            return { name, args, result: 'Final action approval was rejected.', error: true };
          }

          return {
            name,
            args,
            result:
              `Approved final ${scope.actionKind} action "${scope.targetLabel}". ` +
              `Use final_action_approval_id="${approval.id}" on the exact next ${scope.nextToolName || 'desktop/browser action'} call. This approval is one-shot.`,
            data: { final_action_approval_id: approval.id, next_tool_name: scope.nextToolName || '' },
            error: false,
          };
        }

        if (name === 'request_dev_source_edit') {
          let scope: DevSourceEditScope;
          try {
            scope = createDevSourceEditApprovalScope({
              sessionId,
              files: args?.files || args?.allowed_files || args?.affected_files,
              verificationCommand: args?.verification_command || args?.verificationCommand,
              verificationProfile: args?.verification_profile || args?.verificationProfile,
              verificationProfiles: args?.verification_profiles || args?.verificationProfiles,
              reason: args?.reason || args?.summary,
              plan: args?.plan || args?.dev_plan || args?.devPlan,
              userRequest: args?.user_request || args?.userRequest,
              reasoning: args?.reasoning,
              evidence: args?.evidence,
              currentState: args?.current_state || args?.currentState,
              fix: args?.fix,
              steps: args?.steps || args?.plan_steps || args?.planSteps,
              verification: args?.verification,
              expectedWorkflow: args?.expected_workflow || args?.expectedWorkflow || args?.after_edit_workflow || args?.afterEditWorkflow,
              completionNoteTag: args?.completion_note_tag || args?.completionNoteTag,
            });
          } catch (err: any) {
            return { name, args, result: `request_dev_source_edit error: ${err.message || err}`, error: true };
          }

          const existingGrant = getDevSourceEditGrant(sessionId);
          const alreadyAllowed = existingGrant
            && scope.allowedFiles.every((file) => existingGrant.allowedFiles.includes(file));
          if (alreadyAllowed) {
            return {
              name,
              args,
              result: `Dev source edit scope is already approved for this session: ${scope.allowedFiles.join(', ')}`,
              error: false,
            };
          }

          const approvalQueue = getApprovalQueue();
          const activeTask = resolveTaskForSession(sessionId);
          const activeTaskId = String(activeTask?.id || '').trim() || undefined;
          const approvalOrigin = inferApprovalOrigin(sessionId, activeTask, args);
          const action = `Allow Prometheus dev source edits to: ${scope.allowedFiles.join(', ')}`;
          const approval = approvalQueue.create({
            sessionId,
            taskId: activeTaskId,
            agentId: inferAgentIdFromSession(sessionId, args),
            originType: approvalOrigin.originType,
            originLabel: approvalOrigin.originLabel,
            toolName: name,
            toolArgs: {
              dev_edit_id: scope.devEditId,
              files: scope.allowedFiles,
              reason: scope.reason,
              verification_command: scope.verificationCommand,
              verification_profile: scope.verificationProfile,
              verification_profiles: scope.verificationProfiles,
              plan: scope.plan,
              plan_hash: scope.planHash,
            },
            approvalKind: 'dev_source_edit',
            action,
            reason: scope.reason || 'Prometheus requested dev-only source edit access for the listed files.',
            policyTier: 'commit',
            riskScore: 8,
            affectedSystems: ['Prometheus source code'],
            devSourceEdit: {
              devEditId: scope.devEditId,
              allowedFiles: scope.allowedFiles,
              verificationCommand: scope.verificationCommand,
              verificationProfile: scope.verificationProfile,
              verificationProfiles: scope.verificationProfiles,
              reason: scope.reason,
              plan: scope.plan,
              planHash: scope.planHash,
              expiresAt: scope.expiresAt,
            },
          });
          scope.approvalId = approval.id;

          try {
            appendAuditEntry({
              timestamp: new Date().toISOString(),
              sessionId,
              agentId: inferAgentIdFromSession(sessionId, args),
              actionType: 'approval_requested',
              toolName: name,
              toolArgs: approval.toolArgs,
              policyTier: 'commit',
              approvalStatus: 'pending',
              resultSummary: `Queued dev source edit approval ${approval.id}`,
            });
          } catch {}

          try {
            deps.broadcastWS({
              type: 'approval_created',
              sessionId,
              taskId: activeTaskId,
              approvalId: approval.id,
              summary: approval.action,
              toolName: name,
              approval: serializeApprovalForClient(approval),
            });
          } catch {}

          try {
            if (deps.telegramChannel?.sendCommandApproval) {
              await deps.telegramChannel.sendCommandApproval(approval);
            }
          } catch (err: any) {
            console.warn('[dev_source_approval] Could not send Telegram approval:', err?.message || err);
          }

          // Wait for approval, but allow a live steer to interrupt so Prometheus can
          // react (e.g. call update_dev_source_edit) before the user approves.
          const waitResult = await new Promise<boolean | { steerInterrupt: string }>((resolve) => {
            let settled = false;
            const safeResolve = (val: boolean | { steerInterrupt: string }) => {
              if (settled) return;
              settled = true;
              approvalQueue.clearSteerCallback(approval.id);
              resolve(val);
            };

            approvalQueue.onResolve(approval.id, (isApproved) => {
              if (isApproved) {
                try {
                  grantDevSourceEditApproval(sessionId, scope, 'approval');
                } catch (err: any) {
                  console.warn('[dev_source_approval] Could not grant source edit scope:', err?.message || err);
                  safeResolve(false);
                  return;
                }
              }
              safeResolve(isApproved);
            });

            // Register steer wakeup: if the user sends a steer while we're waiting,
            // interrupt immediately so the LLM can react to it.
            approvalQueue.onSteer(approval.id, (steerMessage) => {
              safeResolve({ steerInterrupt: steerMessage });
            });
          });

          // Steer arrived while waiting — return early so the model can act on it
          if (typeof waitResult === 'object' && 'steerInterrupt' in waitResult) {
            const steerMsg = waitResult.steerInterrupt;
            console.log(`[dev_source_approval] Steer interrupted approval wait for ${approval.id}: ${steerMsg.slice(0, 120)}`);
            try {
              deps.broadcastWS({
                type: 'approval_steer_interrupt',
                sessionId,
                approvalId: approval.id,
                steerMessage: steerMsg.slice(0, 500),
              });
            } catch {}
            return {
              name,
              args,
              result:
                `[STEER RECEIVED WHILE WAITING FOR DEV EDIT APPROVAL]\n` +
                `Steer message: "${steerMsg}"\n\n` +
                `The dev source edit approval (approval_id: "${approval.id}", dev_edit_id: "${scope.devEditId}") is still pending — the user has not yet approved or denied it.\n\n` +
                `You can:\n` +
                `1. Call update_dev_source_edit(approval_id: "${approval.id}", ...) to modify the pending plan, reason, or files before the user approves.\n` +
                `2. Call await_dev_source_edit_approval(approval_id: "${approval.id}") to resume waiting for the same approval.\n` +
                `3. Call request_dev_source_edit again with a fresh plan to replace this approval.\n\n` +
                `Address the steer first — update the plan if needed, then resume waiting.`,
              error: false,
            };
          }

          const approved = waitResult as boolean;
          try {
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
            return { name, args, result: 'Dev source edit approval was rejected.', error: true };
          }
          return {
            name,
            args,
            result:
              `Approved dev source edit scope for this session: ${scope.allowedFiles.join(', ')}.\n` +
              `Approved plan hash: ${scope.planHash || 'none'}; dev_edit_id: ${scope.devEditId}.\n` +
              `Use source-specific tools only. When edits are complete, finalize through ${formatPromApplyDevChangesInstruction(scope.allowedFiles, scope.reason || 'Approved Prometheus dev source edits', 'apply_live', scope.devEditId)}. ` +
              `For a no-restart preflight, call the same tool with mode:"verify_only". After apply_live/reload succeeds, write_note with tag "${scope.plan?.completionNoteTag || 'dev_edit_complete'}" to complete the dev edit plan.`,
            data: {
              devSourceEdit: {
                devEditId: scope.devEditId,
                allowedFiles: scope.allowedFiles,
                plan: scope.plan,
                planHash: scope.planHash,
                verificationProfiles: scope.verificationProfiles,
                completionNoteTag: scope.plan?.completionNoteTag || 'dev_edit_complete',
              },
            },
            extra: {
              devSourceEdit: {
                devEditId: scope.devEditId,
                allowedFiles: scope.allowedFiles,
                plan: scope.plan,
                planHash: scope.planHash,
                verificationProfiles: scope.verificationProfiles,
                completionNoteTag: scope.plan?.completionNoteTag || 'dev_edit_complete',
              },
            },
            error: false,
          };
        }

	        // ── update_dev_source_edit ─────────────────────────────────────────
        if (name === 'update_dev_source_edit') {
          const approvalId = String(args?.approval_id || '').trim();
          if (!approvalId) {
            return { name, args, result: 'update_dev_source_edit requires approval_id.', error: true };
          }
          const approvalQueue = getApprovalQueue();
          const existing = approvalQueue.get(approvalId);
          if (!existing) {
            return { name, args, result: `Approval ${approvalId} not found.`, error: true };
          }
          if (existing.status !== 'pending') {
            return { name, args, result: `Approval ${approvalId} is already ${existing.status} and cannot be updated.`, error: true };
          }
          if (existing.sessionId !== sessionId) {
            return { name, args, result: 'Cannot update an approval that belongs to a different session.', error: true };
          }

          const updatedFields: Parameters<typeof approvalQueue.update>[1] = {};
          if (args?.reason) updatedFields.reason = String(args.reason);
          if (args?.action) updatedFields.action = String(args.action);

          // Merge plan fields into devSourceEdit.plan
          const planPatch: Record<string, any> = {};
          if (args?.plan) {
            const p = args.plan;
            if (p.user_request) planPatch.userRequest = String(p.user_request);
            if (p.reasoning) planPatch.reasoning = String(p.reasoning);
            if (p.current_state) planPatch.currentState = String(p.current_state);
            if (p.fix) planPatch.fix = String(p.fix);
            if (Array.isArray(p.steps)) planPatch.steps = p.steps.map(String);
            if (Array.isArray(p.verification)) planPatch.verification = p.verification.map(String);
            if (Array.isArray(p.evidence)) planPatch.evidence = p.evidence;
            if (p.completion_note_tag) planPatch.completionNoteTag = String(p.completion_note_tag);
          }
          if (Object.keys(planPatch).length || args?.files) {
            updatedFields.devSourceEdit = {} as any;
            if (Array.isArray(args?.files)) {
              (updatedFields.devSourceEdit as any).allowedFiles = args.files.map(String);
              updatedFields.toolArgs = { ...(existing.toolArgs || {}), files: args.files.map(String) };
            }
            if (Object.keys(planPatch).length) {
              (updatedFields.devSourceEdit as any).plan = planPatch;
            }
          }

          const updated = approvalQueue.update(approvalId, updatedFields);
          if (!updated) {
            return { name, args, result: `Failed to update approval ${approvalId}.`, error: true };
          }

          try {
            deps.broadcastWS({
              type: 'approval_updated',
              sessionId,
              approvalId,
              approval: serializeApprovalForClient(updated),
            });
          } catch {}

          return {
            name,
            args,
            result:
              `Pending approval ${approvalId} updated successfully.\n` +
              `The user will see the revised plan in the approval card.\n` +
              `Call await_dev_source_edit_approval(approval_id: "${approvalId}") to resume waiting for the user to approve or deny.`,
            error: false,
          };
        }

        // ── await_dev_source_edit_approval ────────────────────────────────────
        if (name === 'await_dev_source_edit_approval') {
          const approvalId = String(args?.approval_id || '').trim();
          if (!approvalId) {
            return { name, args, result: 'await_dev_source_edit_approval requires approval_id.', error: true };
          }
          const approvalQueue = getApprovalQueue();
          const existing = approvalQueue.get(approvalId);
          if (!existing) {
            return { name, args, result: `Approval ${approvalId} not found.`, error: true };
          }
          if (existing.sessionId !== sessionId) {
            return { name, args, result: 'Cannot await an approval that belongs to a different session.', error: true };
          }
          if (existing.status !== 'pending') {
            const isApproved = existing.status === 'approved';
            if (isApproved) {
              const existingGrant = getDevSourceEditGrant(sessionId);
              if (!existingGrant) {
                try {
                  const existingScope = existing.devSourceEdit
                    ? createDevSourceEditApprovalScope({
                        sessionId,
                        files: existing.devSourceEdit.allowedFiles,
                        verificationProfile: existing.devSourceEdit.verificationProfile,
                        verificationProfiles: (existing.devSourceEdit as any).verificationProfiles,
                        reason: existing.devSourceEdit.reason,
                        plan: existing.devSourceEdit.plan,
                      })
                    : null;
                  if (existingScope) grantDevSourceEditApproval(sessionId, existingScope, 'approval');
                } catch { /* best effort */ }
              }
              return {
                name, args,
                result: `Approval ${approvalId} was already approved. Dev source edit scope is active. Proceed with edits.`,
                error: false,
              };
            }
            return { name, args, result: `Approval ${approvalId} was already ${existing.status}.`, error: true };
          }

          // Re-enter the steer-interruptible wait
          const waitResult2 = await new Promise<boolean | { steerInterrupt: string }>((resolve) => {
            let settled2 = false;
            const safeResolve2 = (val: boolean | { steerInterrupt: string }) => {
              if (settled2) return;
              settled2 = true;
              approvalQueue.clearSteerCallback(approvalId);
              resolve(val);
            };

            approvalQueue.onResolve(approvalId, (isApproved2) => {
              if (isApproved2) {
                try {
                  const existingScope2 = existing.devSourceEdit
                    ? createDevSourceEditApprovalScope({
                        sessionId,
                        files: existing.devSourceEdit.allowedFiles,
                        verificationProfile: existing.devSourceEdit.verificationProfile,
                        verificationProfiles: (existing.devSourceEdit as any).verificationProfiles,
                        reason: existing.devSourceEdit.reason,
                        plan: existing.devSourceEdit.plan,
                      })
                    : null;
                  if (existingScope2) grantDevSourceEditApproval(sessionId, existingScope2, 'approval');
                } catch (err: any) {
                  console.warn('[await_dev_source_approval] Could not grant source edit scope:', err?.message || err);
                  safeResolve2(false);
                  return;
                }
              }
              safeResolve2(isApproved2);
            });

            approvalQueue.onSteer(approvalId, (steerMsg2) => {
              safeResolve2({ steerInterrupt: steerMsg2 });
            });
          });

          if (typeof waitResult2 === 'object' && 'steerInterrupt' in waitResult2) {
            const steerMsg2 = waitResult2.steerInterrupt;
            try {
              deps.broadcastWS({ type: 'approval_steer_interrupt', sessionId, approvalId, steerMessage: steerMsg2.slice(0, 500) });
            } catch {}
            return {
              name,
              args,
              result:
                `[STEER RECEIVED WHILE WAITING FOR APPROVAL]\n` +
                `Steer message: "${steerMsg2}"\n\n` +
                `Approval ${approvalId} is still pending. Address the steer, update the plan with update_dev_source_edit if needed, then call await_dev_source_edit_approval again.`,
              error: false,
            };
          }

          const approved2 = waitResult2 as boolean;
          try {
            deps.broadcastWS({
              type: approved2 ? 'approval_approved' : 'approval_denied',
              sessionId,
              approvalId,
              approval: serializeApprovalForClient(existing),
            });
          } catch {}

          if (!approved2) {
            return { name, args, result: 'Dev source edit approval was rejected.', error: true };
          }
          return {
            name, args,
            result: `Approval ${approvalId} approved. Dev source edit scope is now active. Proceed with edits.`,
            error: false,
          };
        }

        if (name === 'request_tool_category') {
	          const categoryArgs = normalizeToolArgsForTool(name, args);
	          const rawCategory = String(categoryArgs?.category || '').trim().toLowerCase();
	          const requestedCategory = normalizeToolCategory(rawCategory);
	          const runtimeCategories = getRuntimeToolCategories();
          if (!rawCategory) {
            return { name, args, result: `request_tool_category requires category. Valid: ${runtimeCategories.join(', ')}`, error: true };
          }
	          if (!requestedCategory || !runtimeCategories.includes(requestedCategory as ToolCategory)) {
	            return { name, args, result: `Invalid category "${rawCategory}". Valid: ${runtimeCategories.join(', ')}`, error: true };
	          }
	          if (requestedCategory === 'prometheus_source_write' && !isDevSourceWriteApprovedSession()) {
	            return {
	              name,
	              args,
	              result: 'BLOCKED: prometheus_source_write requires an approved dev source edit request or an approved dev src proposal task.',
	              error: true,
	            };
	          }
	          activateToolCategory(sessionId, requestedCategory);
          // For connectors category: also return connected connector status
          if (requestedCategory === 'external_apps') {
            const status = buildConnectorStatus();
            return { name, args, result: `Tool category "external_apps" activated for session ${sessionId}.\n\n${status}`, error: false };
          }
          return { name, args, result: `Tool category "${requestedCategory}" activated for session ${sessionId}.`, error: false };
        }

        // ── Composite management and dynamic dispatch ─────────────────────
        const { handleCompositeTool } = await import('../tools/composite-tools');
        const compositeResult = await handleCompositeTool(name, args, executeTool, workspacePath, deps, sessionId);
        if (compositeResult) return compositeResult;

        return { name, args, result: `Unknown tool: ${name}`, error: true };
      }
    }
  } catch (err: any) {
    return { name, args, result: `Error: ${err.message}`, error: true };
  }
}
