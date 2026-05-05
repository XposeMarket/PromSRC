// src/gateway/subagent-executor.ts
// Tool execution engine — extracted from server-v2.ts (Step 14.1, Phase 3).
// Restored and adapted for dep-injected execution.

import fs from 'fs';
import path from 'path';
import { getConfig, getAgents, getAgentById } from '../../config/config';
import { getPolicyEngine } from '../policy';
import { appendAuditEntry } from '../audit-log';
import { webSearch } from '../../tools/web';
import { executeWebFetch } from '../../tools/web';
import { executeAgentList, executeAgentInfo } from '../../tools/agent-control';
import { executeDownloadMedia, executeDownloadUrl } from '../../tools/download-tools';
import { executeAnalyzeImage, executeAnalyzeVideo } from '../../tools/media-analysis';
import { executeGenerateImage } from '../../tools/generate-image';
import { getActiveAllowedWorkspaces, hasActiveWorkspaceScope } from '../../tools/workspace-context';
import { getMCPManager } from '../mcp-manager';
import { executeAgentBuilderTool } from './agent-builder-integration';
import { SubagentManager } from './subagent-manager';
import { appendSubagentChatMessage } from './subagent-chat-store';
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
} from '../teams/managed-teams';
import { triggerManagerReview, handleManagerConversation, verifySubagentResult } from '../teams/team-manager-runner';
import { buildTeamDispatchTask, _bgAgentResults } from '../teams/team-dispatch-runtime';
import { parseTeamMemberDirectSessionId, parseTeamMemberRoomSessionId, runTeamMemberRoomTurn, scheduleTeamMemberAutoWake } from '../teams/team-member-room';
import { routeTeamEvent } from '../teams/team-event-router';
import { appendTeamMemoryEvent, claimAgentForTeamWorkspace } from '../teams/team-workspace';
import { notifyMainAgent } from '../teams/notify-bridge';
import { recordAgentRun, reloadAgentSchedules } from '../../scheduler';
import { getSessionChannelHint, linkTelegramSession } from '../comms/broadcaster';
import {
  browserOpen,
  browserSnapshot,
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
  resolveBrowserObserveMode,
  getBrowserSessionInfo,
  getBrowserSessionMetadata,
  waitForBrowserControlRelease,
} from '../browser-tools';
import {
  desktopScreenshot,
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
  desktopDiffScreenshot,
  desktopWindowScreenshot,
  desktopWindowControl,
  desktopScroll,
  desktopSendToTelegram,
} from '../desktop-tools';
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
import { activateToolCategory, addCreativeReferences, formatCreativeReferencesForPrompt, getCanvasProjectRoot, getCreativeMode, getCreativeReferences, getSessionMutationScope, isBusinessContextEnabled, normalizeCreativeMode, setBusinessContextEnabled, setCreativeMode } from '../session';
import { sendCreativeCommand } from '../creative/command-bus';
import { getCreativeMotionCatalog, prepareCreativeMotionTemplate } from '../creative/motion-runtime';
import {
  analyzeCreativeAsset,
  generateCreativeAssetPlaceholder,
  importCreativeAsset,
  readCreativeAssetIndex,
  searchCreativeAssets,
} from '../creative/assets';
import { extractCreativeLayers } from '../creative/layer-extraction';
import { renderCreativeAsciiAsset } from '../creative/ascii-render-runtime';
import { listCreativePremiumTemplates } from '../creative/templates';
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
import { handleConnectorTool } from '../tools/handlers/connector-handlers';
import { appendJournal, createTask, listTasks, loadTask, saveTask, setTaskStepRunning, updateTaskStatus } from '../tasks/task-store';
import { bindTaskRunToSession } from '../tasks/task-run-mirror';
import type { SkillWindow } from '../prompt-context';
import { isToolHiddenInPublicBuild } from '../../runtime/distribution.js';
import { getApprovalQueue } from '../verification-flow.js';
import { DEV_SRC_SELF_EDIT_MODE, DEV_SRC_SELF_EDIT_REPAIR_MODE } from '../proposals/dev-src-self-edit.js';
import {
  cancelMainChatTimer,
  createMainChatTimer,
  listMainChatTimers,
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
  runTeamAgentViaChat: (agentId: string, task: string, teamId: string, timeout?: number) => Promise<any>;
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
  runCommandCaptured: (command: string, cwd: string, timeoutMs?: number) => Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>;
  skillsManager: any;
  getSessionSkillWindows: (sessionId: string) => Map<string, SkillWindow>;
  sessionCurrentTurn: Map<string, number>;
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
      await telegramChannel.sendFileToChat(Number(hint.chatId), exportPath, caption);
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
    execFile('ffmpeg', [
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

function resolveCreativeEditorTimeoutMs(toolName: string): number {
  if (toolName === 'creative_export' || toolName === 'creative_export_html_motion_clip') return 720000;
  if (toolName === 'creative_attach_audio_from_url' || toolName === 'creative_attach_audio_from_file') return 120000;
  if (toolName === 'creative_create_from_template' || toolName === 'creative_create_html_motion_clip') return 60000;
  if (toolName === 'creative_set_canvas' || toolName === 'creative_apply_motion_template') return 45000;
  if (toolName === 'creative_render_snapshot' || toolName === 'creative_render_html_motion_snapshot') return 45000;
  if (toolName === 'creative_search_icons' || toolName === 'creative_search_animations') return 30000;
  return 30000;
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

function getSourceVerificationCommandForSession(sessionId: string): string {
  const task = resolveTaskForSession(sessionId);
  const explicit = String(task?.proposalExecution?.repairContext?.canonicalBuildCommand || '').trim();
  if (explicit) return explicit;
  const mode = task?.proposalExecution?.mode;
  return mode === DEV_SRC_SELF_EDIT_MODE || mode === DEV_SRC_SELF_EDIT_REPAIR_MODE
    ? 'npm run build:backend'
    : 'npm run build';
}

export async function executeTool(name: string, args: any, workspacePath: string, deps: ExecuteToolDeps, sessionId: string = 'default'): Promise<ToolResult> {
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
	  const _isProposalSession = isProposalExecutionSession(sessionId);
	  function resolveProjectRootForSourceAccess(): string {
      const proposalTask = resolveProposalExecutionTask();
      const explicitProjectRoot = String(proposalTask?.proposalExecution?.projectRoot || '').trim();
      if (explicitProjectRoot) {
        return path.resolve(explicitProjectRoot);
      }
	    if (String(sessionId || '').startsWith('team_dispatch_')) {
	      return getConfig().getWorkspacePath() || path.resolve(workspacePath, '..');
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
	      function ensureDevSrcSelfEditWriteSession(toolName: string, target: 'src' | 'web-ui' | 'prom-root'): ToolResult | null {
	        const proposalTask = resolveProposalExecutionTask();
        if (!proposalTask) {
          return {
            name: toolName,
            args,
            result: target === 'src'
              ? `ERROR: ${toolName} is only available for approved dev src self-edit proposal tasks. Use write_proposal to request src/ changes from regular sessions.`
              : `ERROR: ${toolName} is only available for approved internal-code proposal tasks.`,
            error: true,
          };
        }
	        if (!isDevSrcSelfEditProposalSession()) {
	          const targetLabel = target === 'src' ? 'src/' : target === 'web-ui' ? 'web-ui/' : 'prom-root';
	          return {
	            name: toolName,
	            args,
	            result: `BLOCKED: ${toolName} is not enabled for this proposal task. Automatic self-edit execution is restricted to approved dev src/ proposal tasks, so ${targetLabel} write access is unavailable here.`,
	            error: true,
	          };
	        }
        if (target !== 'src') {
          return {
            name: toolName,
            args,
            result: `BLOCKED: ${toolName} is disabled in dev src self-edit mode. Only approved src/ files may be written in this proposal lane.`,
            error: true,
          };
        }
        return null;
      }
		  function enforceProposalWriteAccess(relPath: string, kind: 'file' | 'dir', toolName: string): ToolResult | null {
		    const proposalTask = resolveProposalExecutionTask();
        if (!proposalTask) {
          return {
            name,
            args,
            result: `BLOCKED: ${toolName} requires an approved proposal execution task.`,
            error: true,
          };
        }
	        if (!isDevSrcSelfEditProposalSession()) {
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

      if (GENERIC_WORKSPACE_MUTATION_TOOLS.has(name) && isDevSrcSelfEditProposalSession()) {
        return {
          name,
          args,
          result: `BLOCKED: ${name} is disabled in dev src proposal tasks. Use the src-specific source tools against approved src/ files only.`,
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
  } catch { /* policy evaluation is non-blocking — never fail a tool call because of it */ }

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

  function validateRunCommandPathScope(command: string): ToolResult | null {
    const allowedRoots = getRunCommandAllowedRoots();
    const blockedRoots = ((getConfig().getConfig() as any)?.tools?.permissions?.files?.blocked_paths || [])
      .map((p: any) => String(p || '').trim())
      .filter(Boolean)
      .map((p: string) => path.resolve(p));
    for (const candidate of extractAbsolutePathsFromCommand(command)) {
      const resolved = path.resolve(candidate);
      if (blockedRoots.some((blocked: string) => isPathInsideForPermissions(blocked, resolved))) {
        return { name, args, result: `Blocked: command references blocked path "${candidate}".`, error: true };
      }
      if (!allowedRoots.some((allowed) => isPathInsideForPermissions(allowed, resolved))) {
        return { name, args, result: `Blocked: command references absolute path outside this workspace: "${candidate}". Allowed roots: ${allowedRoots.join(', ')}`, error: true };
      }
    }
    return null;
  }

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
    for (const blocked of deps.BLOCKED_PATTERNS) {
      if (cmd.includes(String(blocked || '').toLowerCase())) {
        return { name, args, result: `Blocked: "${cmd}" contains unsafe pattern "${blocked}"`, error: true };
      }
    }

    const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
    const pathScopeBlock = validateRunCommandPathScope(normalizedCmd);
    if (pathScopeBlock) return pathScopeBlock;
    if (!deps.isAllowedShellCommand(normalizedCmd)) {
      return {
        name,
        args,
        result: `Blocked: shell command is not allowed by policy: "${rawCmd}"`,
        error: true,
      };
	    }

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
      let approvalCwd = '.';
      try {
        approvalCwd = resolveRunCommandCwd(args?.cwd).displayCwd;
      } catch {
        approvalCwd = String(args?.cwd || '.');
      }
	    const approval = approvalQueue.create({
	      sessionId,
	      taskId: activeTaskId,
	      agentId: inferAgentIdFromSession(sessionId, args),
	      originType: approvalOrigin.originType,
	      originLabel: approvalOrigin.originLabel,
	      toolName: name,
	      toolArgs: { ...args, command: rawCmd },
      action: `Run command in ${approvalCwd}: ${rawCmd}`,
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
          appendTeamChat(team.id, {
            from: 'manager',
            fromName: 'Manager',
            content: message,
            metadata: { agentId: targetAgentId },
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
          appendTeamChat(team.id, {
            from: 'subagent',
            fromName: String(fromAgent?.name || fromAgentId).trim(),
            fromAgentId,
            content: `${waitForReply ? 'Question for manager' : 'Message to manager'}: ${message}`,
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
              const entry = _bgAgentResults.get(taskId);
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
              const entry = _bgAgentResults.get(taskId);
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
          _bgAgentResults.set(taskId, {
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
        const timeoutMs = Math.max(5000, Math.min(1800000, Number(args?.timeout_ms) || 300000));
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
        const dispatchPrompt = buildTeamDispatchTask({ agentId, task, teamId, context });
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
          const result = await deps.runTeamAgentViaChat(agentId, dispatchPrompt.effectiveTask, teamId, timeoutMs);
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
              const entry = _bgAgentResults.get(taskId);
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
              const entry = _bgAgentResults.get(taskId);
              if (entry) {
                entry.status = 'failed';
                entry.result = result;
              }
              return result;
            });
          _bgAgentResults.set(taskId, {
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
        const entry = _bgAgentResults.get(taskId);
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
        const chatMsg = appendTeamChat(teamId, {
          from: isSubagentSpeaker ? 'subagent' : 'manager',
          fromName: isSubagentSpeaker
            ? String(speakerAgent?.name || speakerAgentId || 'Subagent')
            : 'Manager',
          fromAgentId: speakerAgentId,
          content: message,
        });
        deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, message });
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
        appendMainAgentThread(teamId, { from: 'main_agent', content: message, read: true, type: 'reply' });
        const chatMsg = appendTeamChat(teamId, { from: 'user', fromName: 'Main Agent', content: message });
        deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg, message });
        handleManagerConversation(teamId, `[MAIN AGENT REPLY]\n${message}`, deps.broadcastTeamEvent, true).catch((err: any) =>
          console.error('[reply_to_team] Coordinator resume failed:', err?.message || err)
        );
        return { name, args, result: JSON.stringify({ success: true, team_id: teamId, resumed: true }, null, 2), error: false };
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
        if (action === 'set_focus') {
          const value = String(args?.value || args?.focus || '').trim();
          if (!value) return { name, args, result: 'ERROR: set_focus requires value', error: true };
          ok = updateTeamFocus(teamId, value);
          data.focus = value;
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
          const chatMsg = appendTeamChat(teamId, { from: 'manager', fromName: 'Manager', content: `Goal update (${action}): ${JSON.stringify(data).slice(0, 500)}` });
          deps.broadcastTeamEvent({ type: 'team_goal_updated', teamId, teamName: team.name, action, data });
          deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name, chatMessage: chatMsg });
        }
        return { name, args, result: JSON.stringify({ success: ok, ...data }, null, 2), error: !ok };
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
          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
            return { name, args, result: `Line ${startLine} past end (${allLines.length} lines)`, error: true };
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
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
	          if (start > lines.length) return { name, args, result: `ERROR: start_line ${start} past end (${lines.length} lines)`, error: true };
	          const endClamped = Math.min(end, lines.length);
	          const newLines = String(args.new_content ?? '').split('\n');
	          lines.splice(start - 1, endClamped - start + 1, ...newLines);
	          fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	          return { name, args, result: `OK ${resolved.normalizedRel}: replaced lines ${start}-${endClamped}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
	          if (afterLine > lines.length) return { name, args, result: `ERROR: after_line ${afterLine} past end (${lines.length} lines)`, error: true };
	          const newLines = String(args.content ?? '').split('\n');
	          lines.splice(afterLine, 0, ...newLines);
	          fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	          return { name, args, result: `OK ${resolved.normalizedRel}: inserted after line ${afterLine}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
	          if (start > lines.length) return { name, args, result: `ERROR: start_line ${start} past end (${lines.length} lines)`, error: true };
	          const endClamped = Math.min(end, lines.length);
	          lines.splice(start - 1, endClamped - start + 1);
	          fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	          return { name, args, result: `OK ${resolved.normalizedRel}: deleted lines ${start}-${endClamped}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
	          if (!content.includes(find)) return { name, args, result: `ERROR: Text not found in ${resolved.normalizedRel}`, error: true };
	          const updated = args.replace_all === true ? content.split(find).join(replace) : content.replace(find, replace);
	          fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	          return { name, args, result: `OK ${resolved.normalizedRel}: replaced ${args.replace_all === true ? 'all occurrences' : 'first occurrence'}.`, error: false };
	        } catch (err: any) {
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
	          return { name, args, result: `ERROR: ${err?.message || String(err)}`, error: true };
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
          return { name, args, result: `File not found: src/${normalizedRel}. Use list_source to browse available files.`, error: true };
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
          return { name, args, result: `Path not found: ${promDisplay}. Use list_prom to browse allowed prom-root surfaces.`, error: true };
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
          return { name, args, result: `File not found: web-ui/${normalizedRel}. Use list_webui_source to browse available files.`, error: true };
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
          if (!fs.existsSync(gs_srcSubdir)) return { name, args, result: `Directory not found: src/${gs_rawPath}`, error: true };
          gs_walkDir(gs_srcSubdir, gs_srcRoot, 'src');
        }
        if (gs_useWebUi) {
          const gs_webUiSubdir = gs_rawPath ? path.resolve(gs_webUiRoot, gs_rawPath) : gs_webUiRoot;
          if (!gs_webUiSubdir.startsWith(gs_webUiRoot)) return { name, args, result: `ERROR: path "${gs_rawPath}" is outside web-ui/`, error: true };
          if (!fs.existsSync(gs_webUiSubdir)) return { name, args, result: `Directory not found: web-ui/${gs_rawPath}`, error: true };
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
          return { name, args, result: `Path not found: ${gp_resolved.normalizedRel || '.'}. Use list_prom to browse allowed prom-root surfaces.`, error: true };
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
          return { name, args, result: `File not found: src/${normalizedRel}. Use list_source to browse available files.`, error: true };
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
	          return { name, args, result: `File not found: src/${ds_rel.replace(/^\.?\/?src\//, '')}. Use list_source to verify path.`, error: true };
	        }
	        const ds_stat = fs.statSync(ds_absPath);
	        if (!ds_stat.isFile()) return { name, args, result: `"src/${ds_rel.replace(/^\.?\/?src\//, '')}" is not a file`, error: true };
	        fs.unlinkSync(ds_absPath);
	        const ds_display = 'src/' + ds_absPath.slice(ds_srcRoot.length + 1).replace(/\\/g, '/');
	        console.log(`[edit_source] delete_source: ${ds_display} (session: ${ds_sid})`);
	        return { name, args, result: `OK ${ds_display} deleted. Call run_command({command:"${getSourceVerificationCommandForSession(sessionId)}", shell:true}) to compile and verify.`, error: false };
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
          return { name, args, result: `Directory not found: src/${rel}`, error: true };
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
          return { name, args, result: `Path not found: ${resolved.normalizedRel || '.'}. Use list_prom with another allowlisted path.`, error: true };
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
          return { name, args, result: `Path not found: ${resolved.normalizedRel || '.'}. Use list_prom to browse allowed prom-root surfaces.`, error: true };
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
	          return { name, args, result: `File not found: ${resolved.normalizedRel}. Use list_prom to verify path.`, error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const content = fs.readFileSync(resolved.absPath, 'utf-8');
	        if (!content.includes(findText)) {
	          return { name, args, result: `Text not found in ${resolved.normalizedRel}. Use read_prom_file to confirm exact text including whitespace.`, error: true };
	        }
	        const replaceAll = args.replace_all === true;
	        const occurrences = replaceAll ? (content.split(findText).length - 1) : 1;
	        const updated = replaceAll ? content.split(findText).join(replaceText) : content.replace(findText, replaceText);
	        fs.writeFileSync(resolved.absPath, updated, 'utf-8');
	        console.log(`[edit_prom] find_replace_prom: ${resolved.normalizedRel} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel} updated (${occurrences} occurrence${occurrences !== 1 ? 's' : ''} replaced). Run npm run build if the change affects runtime code.`, error: false };
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
	          return { name, args, result: `File not found: ${resolved.normalizedRel}. Use list_prom to verify path.`, error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        if (start > lines.length) {
	          return { name, args, result: `Line ${start} past end of file (${lines.length} lines). Use read_prom_file to check line numbers.`, error: true };
	        }
	        const endClamped = Math.min(end, lines.length);
	        lines.splice(start - 1, endClamped - start + 1, ...newContent.split('\n'));
	        fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	        console.log(`[edit_prom] replace_lines_prom: ${resolved.normalizedRel} lines ${start}-${endClamped} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel}: replaced lines ${start}-${endClamped} (now ${lines.length} lines). Run npm run build if the change affects runtime code.`, error: false };
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
	          return { name, args, result: `File not found: ${resolved.normalizedRel}. Use list_prom to verify path.`, error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        const insertAt = Math.min(afterLine, lines.length);
	        lines.splice(insertAt, 0, ...content.split('\n'));
	        fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	        console.log(`[edit_prom] insert_after_prom: ${resolved.normalizedRel} after line ${afterLine} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel}: inserted after line ${afterLine} (now ${lines.length} lines). Run npm run build if the change affects runtime code.`, error: false };
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
	          return { name, args, result: `File not found: ${resolved.normalizedRel}. Use list_prom to verify path.`, error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        const lines = fs.readFileSync(resolved.absPath, 'utf-8').split('\n');
	        if (start > lines.length) {
	          return { name, args, result: `Line ${start} past end of file (${lines.length} lines). Use read_prom_file to check line numbers.`, error: true };
	        }
	        const endClamped = Math.min(end, lines.length);
	        lines.splice(start - 1, endClamped - start + 1);
	        fs.writeFileSync(resolved.absPath, lines.join('\n'), 'utf-8');
	        console.log(`[edit_prom] delete_lines_prom: ${resolved.normalizedRel} lines ${start}-${endClamped} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel}: deleted lines ${start}-${endClamped} (now ${lines.length} lines). Run npm run build if the change affects runtime code.`, error: false };
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
	        return { name, args, result: `OK ${resolved.normalizedRel} written (${lineCount} lines). Run npm run build if the change affects runtime code.`, error: false };
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
	          return { name, args, result: `File not found: ${resolved.normalizedRel}. Use list_prom to verify path.`, error: true };
	        }
	        const stat = fs.statSync(resolved.absPath);
	        if (!stat.isFile()) return { name, args, result: `"${resolved.normalizedRel}" is not a file`, error: true };
	        fs.unlinkSync(resolved.absPath);
	        console.log(`[edit_prom] delete_prom_file: ${resolved.normalizedRel} (session: ${sessionId})`);
	        return { name, args, result: `OK ${resolved.normalizedRel} deleted. Run npm run build if the change affects runtime code.`, error: false };
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
          return { name, args, result: `Directory not found: web-ui/${lwu_rel}`, error: true };
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
          return { name, args, result: `File not found: web-ui/${rwu_rel}. Use list_webui_source to browse available files.`, error: true };
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
          return { name, args, result: `File not found: src/${frs_rel}. Use list_source to verify path.`, error: true };
        }
        const frs_content = fs.readFileSync(frs_absPath, 'utf-8');
        if (!frs_content.includes(frs_find)) {
          return { name, args, result: `Text not found in src/${frs_rel}. Use read_source to confirm exact text including whitespace.`, error: true };
        }
        const frs_replaceAll = args.replace_all === true;
        const frs_occurrences = frs_replaceAll ? (frs_content.split(frs_find).length - 1) : 1;
        const frs_updated = frs_replaceAll
          ? frs_content.split(frs_find).join(frs_replace)
          : frs_content.replace(frs_find, frs_replace);
        fs.writeFileSync(frs_absPath, frs_updated, 'utf-8');
        const frs_display = 'src/' + frs_absPath.slice(frs_srcRoot.length + 1).replace(/\\/g, '/');
        const frs_buildCommand = getSourceVerificationCommandForSession(sessionId);
        console.log(`[edit_source] find_replace_source: ${frs_display} (session: ${frs_sid})`);
        return { name, args, result: `✅ ${frs_display} updated (${frs_occurrences} occurrence${frs_occurrences !== 1 ? 's' : ''} replaced). Call run_command({command:"${frs_buildCommand}", shell:true}) to compile and verify.`, error: false };
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
          return { name, args, result: `File not found: src/${rls_rel.replace(/^\.?\/?src\//, '')}. Use list_source to verify path.`, error: true };
        }
        const rls_lines = fs.readFileSync(rls_absPath, 'utf-8').split('\n');
        if (rls_start > rls_lines.length) {
          return { name, args, result: `Line ${rls_start} past end of file (${rls_lines.length} lines). Use read_source to check line numbers.`, error: true };
        }
        const rls_endClamped = Math.min(rls_end, rls_lines.length);
        rls_lines.splice(rls_start - 1, rls_endClamped - rls_start + 1, ...rls_newContent.split('\n'));
        fs.writeFileSync(rls_absPath, rls_lines.join('\n'), 'utf-8');
        const rls_display = 'src/' + rls_absPath.slice(rls_srcRoot.length + 1).replace(/\\/g, '/');
        const rls_buildCommand = getSourceVerificationCommandForSession(sessionId);
        console.log(`[edit_source] replace_lines_source: ${rls_display} lines ${rls_start}-${rls_endClamped} (verify with ${rls_buildCommand}, session: ${rls_sid})`);
        return { name, args, result: `✅ ${rls_display}: replaced lines ${rls_start}-${rls_endClamped} (now ${rls_lines.length} lines). Call run_command({command:"${rls_buildCommand}", shell:true}) to compile and verify.`, error: false };
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
          return { name, args, result: `File not found: src/${ias_rel.replace(/^\.?\/?src\//, '')}. Use list_source to verify path.`, error: true };
        }
        const ias_lines = fs.readFileSync(ias_absPath, 'utf-8').split('\n');
        const ias_insertAt = Math.min(ias_afterLine, ias_lines.length);
        ias_lines.splice(ias_insertAt, 0, ...ias_content.split('\n'));
        fs.writeFileSync(ias_absPath, ias_lines.join('\n'), 'utf-8');
        const ias_display = 'src/' + ias_absPath.slice(ias_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] insert_after_source: ${ias_display} after line ${ias_afterLine} (session: ${ias_sid})`);
        return { name, args, result: `✅ ${ias_display}: inserted after line ${ias_afterLine} (now ${ias_lines.length} lines). Call run_command({command:"${getSourceVerificationCommandForSession(sessionId)}", shell:true}) to compile and verify.`, error: false };
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
          return { name, args, result: `File not found: src/${dls_rel.replace(/^\.?\/?src\//, '')}. Use list_source to verify path.`, error: true };
        }
        const dls_lines = fs.readFileSync(dls_absPath, 'utf-8').split('\n');
        if (dls_start > dls_lines.length) {
          return { name, args, result: `Line ${dls_start} past end of file (${dls_lines.length} lines). Use read_source to check line numbers.`, error: true };
        }
        const dls_endClamped = Math.min(dls_end, dls_lines.length);
        dls_lines.splice(dls_start - 1, dls_endClamped - dls_start + 1);
        fs.writeFileSync(dls_absPath, dls_lines.join('\n'), 'utf-8');
        const dls_display = 'src/' + dls_absPath.slice(dls_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] delete_lines_source: ${dls_display} lines ${dls_start}-${dls_endClamped} (session: ${dls_sid})`);
        return { name, args, result: `✅ ${dls_display}: deleted lines ${dls_start}-${dls_endClamped} (now ${dls_lines.length} lines). Call run_command({command:"${getSourceVerificationCommandForSession(sessionId)}", shell:true}) to compile and verify.`, error: false };
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
        fs.mkdirSync(path.dirname(ws_absPath), { recursive: true });
        fs.writeFileSync(ws_absPath, ws_content, 'utf-8');
        const ws_display = 'src/' + ws_absPath.slice(ws_srcRoot.length + 1).replace(/\\/g, '/');
        const ws_lineCount = ws_content.split('\n').length;
        console.log(`[edit_source] write_source: ${ws_display} (${ws_lineCount} lines, session: ${ws_sid})`);
        return { name, args, result: `✅ ${ws_display} written (${ws_lineCount} lines). Call run_command({command:"${getSourceVerificationCommandForSession(sessionId)}", shell:true}) to compile and verify.`, error: false };
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
          return { name, args, result: `Directory not found: src/${rel}`, error: true };
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
          return { name, args, result: `Directory not found: web-ui/${lwu_rel}`, error: true };
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
          return { name, args, result: `File not found: web-ui/${rwu_rel}. Use list_webui_source to browse available files.`, error: true };
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
          return { name, args, result: `File not found: web-ui/${frwu_rel}. Use list_webui_source to verify path.`, error: true };
        }
        const frwu_content = fs.readFileSync(frwu_absPath, 'utf-8');
        if (!frwu_content.includes(frwu_find)) {
          return { name, args, result: `Text not found in web-ui/${frwu_rel}. Use read_webui_source to confirm exact text including whitespace.`, error: true };
        }
        const frwu_replaceAll = args.replace_all === true;
        const frwu_occurrences = frwu_replaceAll ? (frwu_content.split(frwu_find).length - 1) : 1;
        const frwu_updated = frwu_replaceAll
          ? frwu_content.split(frwu_find).join(frwu_replace)
          : frwu_content.replace(frwu_find, frwu_replace);
        fs.writeFileSync(frwu_absPath, frwu_updated, 'utf-8');
        const frwu_display = 'web-ui/' + frwu_absPath.slice(frwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] find_replace_webui_source: ${frwu_display} (session: ${frwu_sid})`);
        return { name, args, result: `✅ ${frwu_display} updated (${frwu_occurrences} occurrence${frwu_occurrences !== 1 ? 's' : ''} replaced). No build step needed for web-ui changes.`, error: false };
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
          return { name, args, result: `File not found: web-ui/${rlwu_rel}. Use list_webui_source to verify path.`, error: true };
        }
        const rlwu_lines = fs.readFileSync(rlwu_absPath, 'utf-8').split('\n');
        if (rlwu_start > rlwu_lines.length) {
          return { name, args, result: `Line ${rlwu_start} past end of file (${rlwu_lines.length} lines). Use read_webui_source to check line numbers.`, error: true };
        }
        const rlwu_endClamped = Math.min(rlwu_end, rlwu_lines.length);
        rlwu_lines.splice(rlwu_start - 1, rlwu_endClamped - rlwu_start + 1, ...rlwu_newContent.split('\n'));
        fs.writeFileSync(rlwu_absPath, rlwu_lines.join('\n'), 'utf-8');
        const rlwu_display = 'web-ui/' + rlwu_absPath.slice(rlwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] replace_lines_webui_source: ${rlwu_display} lines ${rlwu_start}-${rlwu_endClamped} (session: ${rlwu_sid})`);
        return { name, args, result: `✅ ${rlwu_display}: replaced lines ${rlwu_start}-${rlwu_endClamped} (now ${rlwu_lines.length} lines). No build step needed for web-ui changes.`, error: false };
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
          return { name, args, result: `File not found: web-ui/${iawu_rel}. Use list_webui_source to verify path.`, error: true };
        }
        const iawu_lines = fs.readFileSync(iawu_absPath, 'utf-8').split('\n');
        const iawu_insertAt = Math.min(iawu_afterLine, iawu_lines.length);
        iawu_lines.splice(iawu_insertAt, 0, ...iawu_content.split('\n'));
        fs.writeFileSync(iawu_absPath, iawu_lines.join('\n'), 'utf-8');
        const iawu_display = 'web-ui/' + iawu_absPath.slice(iawu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] insert_after_webui_source: ${iawu_display} after line ${iawu_afterLine} (session: ${iawu_sid})`);
        return { name, args, result: `✅ ${iawu_display}: inserted after line ${iawu_afterLine} (now ${iawu_lines.length} lines). No build step needed for web-ui changes.`, error: false };
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
          return { name, args, result: `File not found: web-ui/${dlwu_rel}. Use list_webui_source to verify path.`, error: true };
        }
        const dlwu_lines = fs.readFileSync(dlwu_absPath, 'utf-8').split('\n');
        if (dlwu_start > dlwu_lines.length) {
          return { name, args, result: `Line ${dlwu_start} past end of file (${dlwu_lines.length} lines). Use read_webui_source to check line numbers.`, error: true };
        }
        const dlwu_endClamped = Math.min(dlwu_end, dlwu_lines.length);
        dlwu_lines.splice(dlwu_start - 1, dlwu_endClamped - dlwu_start + 1);
        fs.writeFileSync(dlwu_absPath, dlwu_lines.join('\n'), 'utf-8');
        const dlwu_display = 'web-ui/' + dlwu_absPath.slice(dlwu_webUiRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_webui] delete_lines_webui_source: ${dlwu_display} lines ${dlwu_start}-${dlwu_endClamped} (session: ${dlwu_sid})`);
        return { name, args, result: `✅ ${dlwu_display}: deleted lines ${dlwu_start}-${dlwu_endClamped} (now ${dlwu_lines.length} lines). No build step needed for web-ui changes.`, error: false };
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
        fs.mkdirSync(path.dirname(wwu_absPath), { recursive: true });
        fs.writeFileSync(wwu_absPath, wwu_content, 'utf-8');
        const wwu_display = 'web-ui/' + wwu_absPath.slice(wwu_webUiRoot.length + 1).replace(/\\/g, '/');
        const wwu_lineCount = wwu_content.split('\n').length;
        console.log(`[edit_webui] write_webui_source: ${wwu_display} (${wwu_lineCount} lines, session: ${wwu_sid})`);
        return { name, args, result: `✅ ${wwu_display} written (${wwu_lineCount} lines). No build step needed for web-ui changes.`, error: false };
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
	          return { name, args, result: `File not found: web-ui/${dwu_rel}. Use list_webui_source to verify path.`, error: true };
	        }
	        const dwu_stat = fs.statSync(dwu_absPath);
	        if (!dwu_stat.isFile()) return { name, args, result: `"web-ui/${dwu_rel}" is not a file`, error: true };
	        fs.unlinkSync(dwu_absPath);
	        const dwu_display = 'web-ui/' + dwu_absPath.slice(dwu_webUiRoot.length + 1).replace(/\\/g, '/');
	        console.log(`[edit_webui] delete_webui_source: ${dwu_display} (session: ${dwu_sid})`);
	        return { name, args, result: `OK ${dwu_display} deleted. Run npm run build if the change affects packaged frontend output.`, error: false };
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
        const creativeMode = setCreativeMode(sessionId, mode);
        deps.sendSSE?.('creative_mode', { sessionId, creativeMode, resetScene: true });
        deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode, resetScene: true });
        return { name, args, result: `Creative mode "${creativeMode}" activated for this session with a blank canvas. Canvas should stay open and this mode now persists across turns until exited.`, error: false, data: { creativeMode, previousMode: null, resetScene: true } };
      }

      case 'switch_creative_mode': {
        const mode = normalizeCreativeMode(args?.mode);
        if (!mode) {
          return { name, args, result: 'switch_creative_mode: mode must be "design", "image", "canvas", or "video"', error: true };
        }
        const previousMode = getCreativeMode(sessionId);
        const creativeMode = setCreativeMode(sessionId, mode);
        deps.sendSSE?.('creative_mode', { sessionId, creativeMode, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '', resetScene: true });
        deps.broadcastWS?.({ type: 'creative_mode_changed', sessionId, creativeMode, previousMode, reason: args?.reason || '', initialIntent: args?.initialIntent || '', resetScene: true });
        return { name, args, result: `Creative mode switched from "${previousMode || 'none'}" to "${creativeMode}" with a blank canvas.`, error: false, data: { creativeMode, previousMode, resetScene: true } };
      }

      case 'get_creative_mode': {
        const creativeMode = getCreativeMode(sessionId);
        return {
          name,
          args,
          result: creativeMode ? `Active creative mode: ${creativeMode}` : 'No creative mode is active.',
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
          result: previousMode ? `Creative mode "${previousMode}" exited. Session returned to normal chat mode.` : 'No creative mode was active for this session.',
          error: false,
          data: { creativeMode: null, previousMode },
        };
      }

      case 'creative_list_motion_templates': {
        const catalog = getCreativeMotionCatalog();
        return {
          name,
          args,
          result: `Found ${catalog.templates.length} Creative Motion templates and ${catalog.socialPresets.length} social presets.`,
          error: false,
          data: catalog,
        };
      }

      case 'creative_list_templates': {
        const templates = listCreativePremiumTemplates();
        return {
          name,
          args,
          result: `Found ${templates.length} premium Creative video templates.`,
          error: false,
          data: { templates },
        };
      }

      case 'creative_preview_motion_template':
      case 'creative_generate_motion_variants': {
        const catalog = getCreativeMotionCatalog();
        if (name === 'creative_generate_motion_variants') {
          const templateId = String(args?.templateId || 'caption-reel').trim().toLowerCase();
          const template = catalog.templates.find((candidate: any) => candidate.id === templateId) || catalog.templates[0];
          const count = Math.max(1, Math.min(8, Number(args?.count) || Math.min(3, template?.presets?.length || 3)));
          const variants = (template?.presets || []).slice(0, count).map((preset: any, index: number) => {
            const prepared = prepareCreativeMotionTemplate({
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
        const prepared = prepareCreativeMotionTemplate(args || {});
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
        const asset = await importCreativeAsset(storage, {
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
        const creativeMode = getCreativeMode(sessionId);
        if (creativeMode !== 'video') {
          return { name, args, result: 'creative_attach_audio_from_url: Video creative mode must be active first. Call switch_creative_mode with mode="video".', error: true };
        }
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
        const asset = await importCreativeAsset(storage, {
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
        const creativeMode = getCreativeMode(sessionId);
        if (creativeMode !== 'video') {
          return { name, args, result: 'creative_attach_audio_from_file: Video creative mode must be active first. Call switch_creative_mode with mode="video".', error: true };
        }
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
        const asset = await importCreativeAsset(storage, {
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
        const asset = await analyzeCreativeAsset(storage, {
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
        const assets = searchCreativeAssets(storage, {
          query: String(args?.query || '').trim(),
          kinds: Array.isArray(args?.kinds) ? args.kinds : [],
          tags: args?.tags,
          brandId: args?.brandId ? String(args.brandId) : null,
          limit: Math.max(1, Math.min(200, Number(args?.limit) || 50)),
        });
        const index = readCreativeAssetIndex(storage);
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
        const asset = await generateCreativeAssetPlaceholder(storage, {
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

      case 'creative_render_ascii_asset': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        const render = await renderCreativeAsciiAsset(storage, {
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

      case 'creative_extract_layers': {
        const storage = buildCreativeStorageForTool(workspacePath, sessionId);
        let extraction;
        try {
          extraction = await extractCreativeLayers(storage, {
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
              : 'Scene was extracted but not applied because Image creative mode is not active.';
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
          const creativeMode = getCreativeMode(sessionId);
          if (creativeMode !== 'video') {
            return { name, args, result: `${name}: provide html, or activate Video creative mode with an HTML motion clip to save.`, error: true };
          }
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
        const creativeMode = getCreativeMode(sessionId);
        if (!creativeMode || creativeMode === 'design') {
          return { name, args, result: `${name}: Image or Video creative mode must be active first.`, error: true };
        }
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

      case 'creative_apply_html_motion_template': {
        const creativeMode = getCreativeMode(sessionId);
        if (creativeMode !== 'video') {
          return { name, args, result: `${name}: Video creative mode must be active first. Call switch_creative_mode with mode="video".`, error: true };
        }
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
        case 'creative_create_from_template':
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
      case 'creative_save_scene': {
        const creativeMode = getCreativeMode(sessionId);
        if (!creativeMode || creativeMode === 'design') {
          return { name, args, result: `${name}: Image or Video creative mode must be active first. Call switch_creative_mode with mode="image" or mode="video".`, error: true };
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
          creative_create_from_template: 'create_from_template',
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
        const result = await sendCreativeCommand(deps.broadcastWS, {
          sessionId,
          mode: creativeMode,
          command: commandByTool[name] || name,
          payload: renderAliasPayload || (name === 'creative_render_snapshot'
            ? { ...(args || {}), includeDataUrl: true }
            : (args || {})),
          timeoutMs: resolveCreativeEditorTimeoutMs(name),
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

      case 'social_intel': {
        const tr = await socialIntelTool.execute(args) as any;
        const resultStr = tr?.stdout ?? tr?.error ?? JSON.stringify(tr);
        return { name, args, result: resultStr, error: tr?.success === false };
      }

      case 'web_search': {
        const result = await webSearch(args.query || '');
        return { name, args, result, error: false };
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
        for (const blocked of deps.BLOCKED_PATTERNS) {
          if (cmd.includes(blocked.toLowerCase())) {
            return { name, args, result: `Blocked: "${cmd}" contains unsafe pattern "${blocked}"`, error: true };
          }
        }

        const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
        const pathScopeBlock = validateRunCommandPathScope(normalizedCmd);
        if (pathScopeBlock) return pathScopeBlock;
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
        else if (/^(git|npm|node|npx|yarn|pnpm|python|python3|pip|pip3|tsc|ts-node|cargo|rustc|go|java|javac|mvn|gradle|dotnet|docker|kubectl|az|aws)\b/.test(cmd)) {
          if (!wantVisible) {
            // Captured mode (DEFAULT) — wait for completion and return output
            try {
              const captured = await deps.runCommandCaptured(normalizedCmd, commandCwd.cwd, 120_000);
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
              const exitLabel = captured.timedOut ? 'TIMED OUT' : `exit ${captured.code ?? '?'}`;
              return {
                name, args,
                result: `${normalizedCmd} [${exitLabel}] cwd=${commandCwd.displayCwd}\n${output.slice(0, 4000) || '(no output)'}`,
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
              const captured = await deps.runCommandCaptured(normalizedCmd, commandCwd.cwd, 120_000);
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
              const exitLabel = captured.timedOut ? 'TIMED OUT' : `exit ${captured.code ?? '?'}`;
              return {
                name, args,
                result: `${normalizedCmd} [${exitLabel}] cwd=${commandCwd.displayCwd}\n${output.slice(0, 4000) || '(no output)'}`,
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
	          const timers = listMainChatTimers({
	            sessionId,
	            includeDone: args.include_done === true,
	          });
	          return {
	            name,
	            args,
	            result: JSON.stringify({ success: true, count: timers.length, timers }, null, 2),
	            error: false,
	          };
	        }

	        if (action === 'cancel') {
	          const timerId = String(args.timer_id || args.timerId || '').trim();
	          if (!timerId) return { name, args, result: 'timer(cancel) requires timer_id', error: true };
	          const existing = listMainChatTimers({ sessionId, includeDone: true }).find((timer) => timer.id === timerId);
	          if (!existing) {
	            return { name, args, result: `Timer not found in this chat: ${timerId}`, error: true };
	          }
	          const cancelled = cancelMainChatTimer(timerId);
	          if (!cancelled) return { name, args, result: `Timer not found: ${timerId}`, error: true };
	          deps.broadcastWS?.({ type: 'timer_cancelled', timer: cancelled, sessionId });
	          return {
	            name,
	            args,
	            result: JSON.stringify({ success: true, action: 'cancel', timer: cancelled }, null, 2),
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
	          result: 'timer requires action: create, list, or cancel',
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
          const rawKind = String(schedule.kind || args.kind || 'recurring').trim().toLowerCase();
          const kind: 'recurring' | 'one-shot' = (rawKind === 'one_shot' || rawKind === 'one-shot') ? 'one-shot' : 'recurring';
          const cron = String(schedule.cron || args.cron || '').trim();
          const runAtRaw = String(schedule.run_at || args.run_at || '').trim();
          const timezone = String(args.timezone || args.tz || '').trim() || undefined;
          const delivery = (args.delivery && typeof args.delivery === 'object') ? args.delivery : {};
          const channel = normalizeDeliveryChannel(delivery.channel || args.channel);
          const sessionTarget = String(delivery.session_target || args.session_target || 'isolated').toLowerCase() === 'main'
            ? 'main'
            : 'isolated';
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

          if (kind === 'one-shot') {
            if (!runAtRaw) return { name, args, result: 'schedule.kind=one_shot requires schedule.run_at (ISO datetime)', error: true };
            const parsed = new Date(runAtRaw);
            if (!Number.isFinite(parsed.getTime())) {
              return { name, args, result: `Invalid run_at value: "${runAtRaw}"`, error: true };
            }
          } else if (!cron) {
            return { name, args, result: 'schedule.kind=recurring requires schedule.cron', error: true };
          }

          const subagentId = String(args.subagent_id || '').trim() || undefined;

          const created = deps.cronScheduler.createJob({
            name: nameValue,
            prompt: instructionPrompt,
            type: kind,
            schedule: kind === 'recurring' ? cron : undefined,
            runAt: kind === 'one-shot' ? new Date(runAtRaw).toISOString() : undefined,
            tz: timezone,
            sessionTarget,
            model: modelOverride,
            subagent_id: subagentId,
          } as any);

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'create',
              job: summarizeCronJob(created),
              message: `Scheduled job "${created.name}" created.`,
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
          }

          const rawKind = String(schedule.kind || args.kind || '').trim().toLowerCase();
          if (rawKind === 'one_shot' || rawKind === 'one-shot') patch.type = 'one-shot';
          if (rawKind === 'recurring') patch.type = 'recurring';
          if (schedule.cron !== undefined || args.cron !== undefined) patch.schedule = String(schedule.cron || args.cron || '').trim();
          if (schedule.run_at !== undefined || args.run_at !== undefined) patch.runAt = String(schedule.run_at || args.run_at || '').trim();

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

          const updated = deps.cronScheduler.updateJob(jobId, patch as any);
          if (!updated) return { name, args, result: `Job not found: ${jobId}`, error: true };
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              action: 'update',
              job: summarizeCronJob(updated),
              message: `Scheduled job "${updated.name}" updated.`,
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
            return { name, args, result: 'team_manage requires action: list|create|start|trigger_review|dispatch|pause|resume', error: true };
          }

          if (action === 'list') {
            const teams = listManagedTeams().map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              emoji: t.emoji,
              subagentIds: t.subagentIds,
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
                const dispatchPrompt = buildTeamDispatchTask({
                  agentId,
                  task,
                  teamId,
                  context,
                });
                const startedAt = Date.now();
                const result = await deps.runTeamAgentViaChat(agentId, dispatchPrompt.effectiveTask, teamId, 300000);
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
            `   - specialization: a concrete team-specific assignment, not a generic role. Examples: "Prospect Researcher: finds local small-business leads for Xpose Market from maps/directories/search"; "Website/SEO Qualifier: reviews each lead's site quality, trust signals, UX, and basic SEO gaps"; "Lead Enricher: gathers contact info, socials, owner names, and outreach angle when available".`,
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

          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
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
        setTurnModelOverride(sessionId, { providerId, model, reason });
        return { name, args, result: `Switched to ${tier} tier: ${configuredModel}. Reverts automatically at end of turn.`, error: false };
      }

      case 'parse_schedule_pattern': {
        const text = String(args.text || '').trim();
        if (!text) {
          return { name, args, result: 'parse_schedule_pattern requires text parameter', error: true };
        }
        
        try {
          let cron = '';
          let preview = '';
          const t = text.toLowerCase().trim();
          
          // Helper: extract time from text and handle AM/PM
	          function extractTime(text: string): { hour: number; minute: number } | null {
            const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
            if (!timeMatch) return null;
            
            let hour = parseInt(timeMatch[1], 10);
            const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
            const period = timeMatch[3]?.toLowerCase();
            
            if (period === 'pm' && hour !== 12) {
              hour += 12;
            } else if (period === 'am' && hour === 12) {
              hour = 0;
            }
            
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
	            const hits = days.filter(([day]) => new RegExp(`\\b${day}\\b`).test(text));
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
            return {
              name,
              args,
              result: JSON.stringify({
                success: false,
                error: 'Could not parse pattern. Try: "daily at 3:13pm", "daily at 15:13", "weekly", or cron like "0 9 * * *"',
              }, null, 2),
              error: true,
            };
          }
          
          return {
            name,
            args,
            result: JSON.stringify({
              success: true,
              cron,
              preview,
              timezone: args.timezone || 'UTC',
            }, null, 2),
            error: false,
          };
        } catch (err: any) {
          return { name, args, result: `parse_schedule_pattern error: ${err.message}`, error: true };
        }
      }

      // Browser automation tools
      case 'browser_open': {
        const result = await browserOpen(sessionId, args.url || '', {
          observe: resolveBrowserObserveMode('browser_open', args.observe),
        });
        await broadcastBrowserStatus('browser_open');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_snapshot': {
        const result = await browserSnapshot(sessionId);
        await broadcastBrowserStatus('browser_snapshot');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_click': {
        const result = await browserClick(sessionId, {
          ref: args.ref != null ? Number(args.ref) : undefined,
          element: args.element != null ? String(args.element) : (args.element_name != null ? String(args.element_name) : undefined),
          selector: args.selector != null ? String(args.selector) : undefined,
        }, {
          observe: resolveBrowserObserveMode('browser_click', args.observe),
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
          observe: resolveBrowserObserveMode('browser_fill', args.observe),
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
        const result = await browserPressKey(sessionId, String(args.key || 'Enter'), {
          observe: resolveBrowserObserveMode(keyToolName, args.observe),
        });
        await broadcastBrowserStatus('browser_press_key');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_type': {
        const result = await browserType(sessionId, String(args.text || ''));
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
          observe: resolveBrowserObserveMode('browser_scroll', args.observe),
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
          observe: resolveBrowserObserveMode('browser_drag', args.observe),
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
        const result = await browserSendToTelegram(sessionId, caption, deps.telegramChannel);
        await broadcastBrowserStatus('browser_send_to_telegram');
        return { name, args, result, error: result.startsWith('ERROR') };
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
        const result = await browserRunJs(sessionId, String(args.code || ''));
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
        const resolved = await resolveDesktopActionPoint(sessionId, {
          x: Number(args.x),
          y: Number(args.y),
          coordinate_space: args.coordinate_space as any,
          screenshot_id: args.screenshot_id == null ? undefined : String(args.screenshot_id),
          window_name: args.window_name == null ? undefined : String(args.window_name),
          window_handle: args.window_handle == null ? undefined : Number(args.window_handle),
          ...parseDesktopPointerMonitorArgs(args),
        }, 'desktop_click');
        const result = !resolved.ok
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
        const result = !fromPoint.ok
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
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_wait': {
        const result = await desktopWait(Number(args.ms || 500));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_type': {
        const result = await desktopType(String(args.text || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_press_key': {
        const result = await desktopPressKey(String(args.key || 'Enter'));
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
        const result = await desktopSendToTelegram(sessionId, caption, deps.telegramChannel);
        return { name, args, result, error: result.startsWith('ERROR') };
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
          let entry = `\n### [${noteTag.toUpperCase()}] ${timestamp}\n${noteContent}`;
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
              const currentStep = Number.isInteger(stepIndex) ? task?.plan?.[stepIndex] : undefined;
              if (task && currentStep?.notes === 'write_note_completion') {
                mutatePlan(taskId, [{
                  op: 'complete',
                  step_index: stepIndex,
                  notes: 'auto-complete: task_complete logged by write_note',
                }]);
                const advancedTask = loadTask(taskId);
                if (advancedTask && advancedTask.currentStepIndex === stepIndex) {
                  advancedTask.currentStepIndex = Math.min(stepIndex + 1, advancedTask.plan.length);
                  advancedTask.lastProgressAt = Date.now();
                  saveTask(advancedTask);
                }
                appendJournal(taskId, {
                  type: 'status_push',
                  content: `Auto-advanced final step ${stepIndex + 1}: task_complete note logged by write_note.`,
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

        return { name, args, result: `Note saved [${noteTag}] (${noteContent.length} chars) â†’ intraday-notes`, error: false };
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
          const bits = [
            `${s.emoji} ${s.id}`,
            s.kind === 'bundle' ? `v${s.version} [bundle: ${(s.resources || []).length} resources]` : '[simple]',
            Array.isArray(s.requiredTools) && s.requiredTools.length ? `[tools: ${s.requiredTools.join(',')}]` : '',
            Array.isArray(s.triggers) && s.triggers.length ? `[triggers: ${s.triggers.join(',')}]` : '',
            `- ${s.description || '(no description)'}`,
          ].filter(Boolean);
          return bits.join(' ');
        }).join('\n');
        return {
          name, args,
          result: `${all.length} skill${all.length !== 1 ? 's' : ''} available:\n${slLines}\n\nTo read a skill: skill_read("<id>")\nFor bundled resources: skill_resource_list("<id>") then skill_resource_read(id, path)\nFor metadata/provenance: skill_inspect("<id>")\nTo install a downloaded bundle: skill_import_bundle(source)\nTo enrich imported bundle metadata: skill_manifest_write(id, manifest)\nTo maintain bundle resources: skill_resource_write(id, path, content) or skill_resource_delete(id, path)\nTo export/update bundles: skill_export_bundle(id), skill_update_from_source(id)\nTo save a bundle skill: skill_create_bundle(...)\nTo save a simple one-file skill: skill_create(id, name, instructions, ...)`,
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
        try {
          const content = fs.readFileSync(skill.filePath, 'utf-8');
          const resourceLines = Array.isArray(skill.resources) && skill.resources.length
            ? [
              '',
              'Resources:',
              ...skill.resources.map((r: any) => `- ${r.path} (${r.type})${r.description ? ` - ${r.description}` : ''}`),
              '',
              `Use skill_resource_read({"id":"${skill.id}","path":"<resource path>"}) to load a resource.`,
            ].join('\n')
            : '';
          const manifestLines = [
            `${skill.emoji} ${skill.name} (${skill.id}) ${skill.kind === 'bundle' ? `v${skill.version} bundle` : 'simple skill'}`,
            skill.description ? `Description: ${skill.description}` : '',
            Array.isArray(skill.requiredTools) && skill.requiredTools.length ? `Required tools: ${skill.requiredTools.join(', ')}` : '',
            skill.status && skill.status !== 'ready' ? `Status: ${skill.status}` : '',
            skill.validation && !skill.validation.ok ? `Validation errors: ${skill.validation.errors.join('; ')}` : '',
            resourceLines,
          ].filter(Boolean).join('\n');
          return { name, args, result: `${manifestLines}\n\nInstructions:\n${content}`, error: false };
        } catch {
          // Fallback to stored instructions if file read fails
          return { name, args, result: `${skill.emoji} ${skill.name} (${skillId})\n\n${skill.instructions}`, error: false };
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
          result: `Resources for ${skill.emoji} ${skill.name} (${skill.id}):\n${lines}\n\nRead one with skill_resource_read({"id":"${skill.id}","path":"<resource path>"}).`,
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
            `- ${skill.emoji} ${skill.id} (${skill.kind}, ${skill.resources.length} resources) - ${skill.description || skill.name}`
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
          const updated = deps.skillsManager.writeManifestOverlay(skillId, manifest);
          return {
            name, args,
            result: `Wrote manifest overlay for ${updated.emoji} ${updated.name} (${updated.id}) at ${updated.overlayPath || '(overlay path unavailable)'}. Manifest source: ${updated.manifestSource}.`,
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
            emoji: args.emoji ? String(args.emoji) : undefined,
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
            emoji: args.emoji ? String(args.emoji) : undefined,
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
          // Only agents with can_propose: true in config.json bypass this.
          const isTeamSession = String(sessionId || '').startsWith('team_dispatch_');
          if (isTeamSession) {
            const sessionSuffix = String(sessionId).replace('team_dispatch_', '');
            const agentIdFromSession = sessionSuffix.replace(/_\d+$/, '');
            try {
              const { agentCanPropose } = require('../teams/team-dispatch-runtime');
              if (!agentCanPropose(agentIdFromSession)) {
                return {
                  name, args,
                  result: 'BLOCKED: Subagents cannot submit proposals directly. Use talk_to_manager to send your complete plan to the manager. Include: title, summary, full details, affected files, diff preview, and executor_prompt. The manager will review and submit the proposal.',
                  error: true,
                };
              }
            } catch { /* fail-safe: allow through if check errors */ }
          }
		          try {
		            const { createProposal } = require('../proposals/proposal-store');
                const teamManagerMatch = String(sessionId || '').match(/^team_coord_(.+)$/);
                let teamExecution: any = undefined;
                let sourceTeamId: string | undefined = undefined;
                if (teamManagerMatch) {
                  const teamId = String(teamManagerMatch[1] || '').trim();
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
	              priority: args.priority || 'medium',
              title: String(args.title || '').slice(0, 120),
              summary: String(args.summary || '').slice(0, 500),
	              details: String(args.details || ''),
	              sourceAgentId: sessionId || 'unknown',
	              sourceSessionId: String(sessionId || '') || undefined,
                sourceTeamId,
		              sourcePipeline: args.source_pipeline || (allowRepairProposal ? 'proposal_build_failure_recovery' : undefined),
              affectedFiles: Array.isArray(args.affected_files) ? args.affected_files : [],
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

          try {
            // Call the per-agent config update via the tasks router API
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

            // Optionally update HEARTBEAT.md content
            if (typeof args.instructions === 'string' && args.instructions.trim()) {
              const { getConfig, getAgentById, ensureAgentWorkspace } = require('../../config/config');
              const agent = getAgentById(targetAgentId);
              let workspacePath: string;
              const fs = require('fs');
              const path = require('path');
              const subagentPath = path.join(getConfig().getWorkspacePath(), '.prometheus', 'subagents', targetAgentId);
              if (fs.existsSync(subagentPath)) {
                workspacePath = subagentPath;
              } else if (agent) {
                workspacePath = ensureAgentWorkspace(agent);
              } else {
                workspacePath = getConfig().getWorkspacePath();
              }
              const heartbeatPath = path.join(workspacePath, 'HEARTBEAT.md');
              fs.mkdirSync(workspacePath, { recursive: true });
              fs.writeFileSync(heartbeatPath, args.instructions.trim(), 'utf-8');
              resultMsg += `\nHEARTBEAT.md updated at ${heartbeatPath}`;
            }

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

            appendTeamRoomMessage(noteContext.teamId, {
              actorType: 'member',
              actorName: fromName,
              actorId: fromAgentId,
              content: message,
              category: messageType,
              target: targetAgentId,
              metadata: {
                agentId: fromAgentId,
                source: 'talk_to_teammate',
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
            const status = updateTeamMemberState(noteContext.teamId, fromAgentId, {
              status: args.phase || 'running',
              currentTask: args.current_task,
              blockedReason: args.blocked_reason,
              lastResult: args.result,
            });
            if (!status) return { name, args, result: `ERROR: Could not update status for ${fromAgentId}.`, error: true };
            const summaryParts = [String(status.status)];
            if (status.currentTask) summaryParts.push(String(status.currentTask));
            if (status.blockedReason) summaryParts.push(`blocked: ${String(status.blockedReason)}`);
            if (status.lastResult) summaryParts.push(`result: ${String(status.lastResult).slice(0, 120)}`);
            appendTeamRoomMessage(noteContext.teamId, {
              actorType: 'member',
              actorName: String(fromAgent?.name || fromAgentId).trim(),
              actorId: fromAgentId,
              content: `Status update: ${summaryParts.join(' | ')}`,
              category: 'status',
              target: 'all',
              metadata: {
                agentId: fromAgentId,
                source: 'update_my_status',
              },
            }, {
              mirrorToChat: noteContext.conversationMode !== 'member_direct',
            });
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
            const primaryModel = cfg2.llm?.providers?.[cfg2.llm?.provider]?.model || cfg2.models?.primary || null;
            const agents = (cfg2.agents || []).map((a: any) => ({
              id:    a.id,
              name:  a.name,
              model: a.model || null,
            }));
            const result = {
              global_primary: primaryModel,
              agent_model_defaults: defaults,
              individual_agent_overrides: agents,
            };
            return { name, args, result: JSON.stringify(result, null, 2), error: false };
          } catch (err: any) {
            return { name, args, result: `get_agent_models error: ${err.message}`, error: true };
          }
        }

        // ── gateway_restart: build + graceful restart ───────────────────────
        if (name === 'gateway_restart') {
          const reason = String(args.reason || 'manual restart').trim();
          try {
            const { buildAndRestart } = require('../lifecycle');
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
            // buildAndRestart runs npm run build, then if successful, restarts.
            // It's async and will kill the process, so we await it.
            const buildResult = await buildAndRestart(ctx);
            if (!buildResult.success) {
              return {
                name, args,
                result: `❌ Build FAILED — gateway NOT restarting.\n\n${buildResult.output.slice(-1000)}`,
                error: true,
              };
            }
            // If we get here, the restart is in progress (process will exit shortly)
            return {
              name, args,
              result: `✅ Build succeeded (${buildResult.durationMs}ms). Gateway is restarting now...`,
              error: false,
            };
          } catch (err: any) {
            return { name, args, result: `gateway_restart error: ${err.message}`, error: true };
          }
        }

        // ── connector_list: always-available connector discovery ──────────────
        if (name === 'connector_list') {
          return { name, args, result: buildConnectorStatus(), error: false };
        }

        // ── connector_* tools: dispatch to connector handlers ─────────────
        if (name.startsWith('connector_') && name !== 'connector_list') {
          const connResult = await handleConnectorTool(name, args);
          return { name, args, ...connResult };
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
	          if (requestedCategory === 'prometheus_source_write' && !isDevSrcSelfEditProposalSession()) {
	            return {
	              name,
	              args,
	              result: 'BLOCKED: prometheus_source_write can only be activated for approved dev src proposal tasks.',
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

        // ── Composite management tools ─────────────────────────────────────
        const { loadComposites, saveComposite, deleteComposite, executeComposite } = await import('../tools/composite-tools');

        if (name === 'create_composite') {
          const cName = String(args.name || '').trim().replace(/\s+/g, '_');
          if (!cName) return { name, args, result: 'name is required', error: true };
          if (!Array.isArray(args.steps) || !args.steps.length) return { name, args, result: 'steps array is required', error: true };
          saveComposite({
            name: cName,
            description: String(args.description || ''),
            parameters: args.parameters && typeof args.parameters === 'object' ? args.parameters : {},
            steps: args.steps,
          });
          return { name, args, result: `Composite "${cName}" saved with ${args.steps.length} step(s). It will appear as a callable tool next message.`, error: false };
        }

        if (name === 'get_composite') {
          const cName = String(args.name || '').trim();
          if (!cName) return { name, args, result: 'name is required', error: true };
          const composites = loadComposites();
          const existing = composites.get(cName);
          if (!existing) return { name, args, result: `Composite "${cName}" not found.`, error: true };
          return { name, args, result: JSON.stringify(existing, null, 2), error: false };
        }

        if (name === 'edit_composite') {
          const cName = String(args.name || '').trim();
          if (!cName) return { name, args, result: 'name is required', error: true };
          const composites = loadComposites();
          const existing = composites.get(cName);
          if (!existing) return { name, args, result: `Composite "${cName}" not found.`, error: true };
          const newName = args.new_name ? String(args.new_name).trim() : cName;
          const updated = {
            name: newName,
            description: args.description !== undefined ? String(args.description) : existing.description,
            parameters: args.parameters !== undefined ? args.parameters : existing.parameters,
            steps: Array.isArray(args.steps) ? args.steps : existing.steps,
          };
          if (newName !== cName) deleteComposite(cName);
          saveComposite(updated);
          const renamed = newName !== cName ? ` (renamed from "${cName}")` : '';
          return { name, args, result: `Composite "${newName}" updated${renamed}.`, error: false };
        }

        if (name === 'delete_composite') {
          const cName = String(args.name || '').trim();
          if (!cName) return { name, args, result: 'name is required', error: true };
          const removed = deleteComposite(cName);
          return { name, args, result: removed ? `Composite "${cName}" deleted.` : `Composite "${cName}" not found.`, error: !removed };
        }

        if (name === 'list_composites') {
          const composites = loadComposites();
          if (!composites.size) return { name, args, result: 'No composites defined yet.', error: false };
          const lines = Array.from(composites.values()).map(
            c => `• ${c.name} (${c.steps.length} steps) — ${c.description}`
          );
          return { name, args, result: lines.join('\n'), error: false };
        }

        // ── Dynamic composite dispatch ─────────────────────────────────────
        const composites = loadComposites();
        if (composites.has(name)) {
          const result = await executeComposite(name, args, executeTool, workspacePath, deps, sessionId);
          return { name, args, result, error: false };
        }

        return { name, args, result: `Unknown tool: ${name}`, error: true };
      }
    }
  } catch (err: any) {
    return { name, args, result: `Error: ${err.message}`, error: true };
  }
}
