/**
 * routes/chat.router.ts — B6 Refactor
 *
 * The chat pipeline: handleChat + /api/chat SSE endpoint + /api/status.
 * Extracted verbatim from server-v2.ts — zero logic changes.
 *
 * Module-scope singletons (cronScheduler, telegramChannel, skillsManager)
 * are injected via initChatRouter() — same pattern as all other routers.
 */


import express from 'express';
// cors and http moved to core/app.ts + core/server.ts (B3)
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

// ── TEMP latency bisection probe ──────────────────────────────────────────
const TURN_TIMING_ENABLED = process.env.PROMETHEUS_TURN_TIMING === '1';
let __htimeT0 = 0;
function __htimeReset(): void { __htimeT0 = Date.now(); }
function htime(label: string): void {
  try {
    if (!TURN_TIMING_ENABLED) return;
    if (!__htimeT0) return;
    const line = `${new Date().toISOString()} +${String(Date.now() - __htimeT0).padStart(6)}ms ${label}\n`;
    fs.appendFileSync(path.join(getConfig().getConfigDir(), 'logs', 'turn-timing.log'), line, 'utf-8');
  } catch {}
}
// ──────────────────────────────────────────────────────────────────────────
// WebSocketServer + WebSocket moved to core/server.ts (B3)
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../config/config';
import {
  buildCodexCloudflareHeaders,
  getValidToken as getOpenAiCodexToken,
  loadTokens as loadOpenAiCodexTokens,
  refreshTokens as refreshOpenAiCodexTokens,
} from '../../auth/openai-oauth.js';
import { getValidXAIToken, isXAIConnected } from '../../auth/xai-oauth.js';
import { getVault } from '../../security/vault';
import { isOnboardingSession, getMeetAndGreetSystemPrompt } from '../onboarding/meet-prompt';
import { getOllamaClient } from '../../agents/ollama-client';
import { parseProviderModelRef } from '../../agents/model-routing.js';
import { readModelUsageEvents, getUsageCalibration } from '../../providers/model-usage';
import { estimateContextCostMicros, resolveModelPricing } from '../../providers/model-pricing';
import { spawnAgent } from '../../agents/spawner';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getRecentToolObservationsForContext, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, type TurnOrigin } from '../session';
import { getSubagentChatHistory } from '../agents-runtime/subagent-chat-store';
import { collectRichArtifacts, productCarouselToArtifact } from '../rich-artifacts';
import { getConnector, isConnectorConnected } from '../../integrations/connector-registry.js';
import type { GmailConnector } from '../../integrations/connectors/gmail.js';
import { executeMarketLookup } from '../../tools/market';
import { executeStockLookup } from '../../tools/stocks';
import { executeWeatherLookup } from '../../tools/weather';
import { executePolymarketLookup } from '../../tools/polymarket';
import { executeMapLookup } from '../../tools/mapcard';
import { buildContextBudget, estimateMessageTokenBreakdownForModel, estimateMessagesTokensForModel, estimateTextTokensForModel, resolveActiveModelContextProfile } from '../context/model-context';
import { createToolObservationsFromResults, formatToolStateSummaryForContext, persistToolResultsAsObservations, readToolObservations, type ToolObservation } from '../tool-observations';
import { hookBus } from '../hooks';
import { loadWorkspaceHooks } from '../hook-loader';
import { runBootMd } from '../boot';
import { getAgentTeamScheduleTools } from '../tools/defs/agent-team-schedule';
import { buildCisContextBlock } from '../business/cis-context-builder.js';
import { refreshProjectContextForSession } from '../projects/project-learning.js';
import { buildProjectContextBlock, findProjectBySessionId, removeSessionFromProject } from '../projects/project-store.js';
import { assertSafeStorageId, isStorageBoundaryError } from '../storage/storage-paths.js';
import { TaskRunner, runTask, TaskTool, TaskState, bgPlanDeclare, bgPlanAdvance, backgroundJoin, backgroundAbort, listActiveBackgroundIdsForSession } from '../tasks/task-runner';
import { setupErrorResponseEndpoint } from '../errors/error-response-endpoint-integrated';
import { initCredentialHandler, getCredentialHandler } from '../../security/credential-handler';
import { getVerificationFlowManager, getApprovalQueue } from '../verification-flow';
import { getPrometheusQuestionQueue } from '../prometheus-questions';
import { getErrorAnalyzer } from '../errors/error-analyzer';
import { getErrorHistory } from '../errors/error-history';
import { getRetryStrategy } from '../retry-strategy';
import { getVisualErrorDetector } from '../visual-error-detection';
import { getErrorAudit } from '../../security/error-audit';
import { getContextInjectionManager } from '../context-injection';
import { SkillsManager } from '../skills-runtime/skills-manager';
import { rankSkillsForQuery } from '../agents-runtime/capabilities/skills-executor';
import { buildSelfReflectionInstruction } from '../../config/self-reflection.js';
import { loadSoul } from '../../config/soul-loader.js';
import { recordSkillGardenerTurn } from '../brain/skill-episodes.js';
import { buildAttachmentRuntimeContext, appendAttachmentContextToMessage, type RuntimeVisionAttachment } from '../chat/attachment-context';
import {
  browserOpen,
  browserSnapshot,
  browserSnapshotDelta,
  browserClick,
  browserFill,
  browserPressKey,
  browserType,
  browserWait,
  browserScroll,
  browserClose,
  formatBrowserInteractionContextBlock,
  browserVisionScreenshot,
  browserVisionClick,
  browserVisionType,
  browserPreviewScreenshot,
  browserGetFocusedItem,
  browserGetPageText,
  getBrowserToolDefinitions,
  getBrowserSessionInfo,
  getBrowserAdvisorPacket,
  listBrowserSessions,
  type BrowserAdvisorPacket,
  type BrowserObserveMode,
  resolveBrowserObserveMode,
} from '../browser-tools';
import {
  seedDefaultShortcuts,
  getAllShortcuts,
  saveSiteShortcut,
  deleteSiteShortcut,
  listKnownHosts,
  getShortcutsForUrl,
} from '../site-shortcuts';
import {
  desktopFindWindow,
  desktopFocusWindowVerified,
  desktopWindowControl,
  desktopClick,
  desktopDrag,
  desktopWait,
  desktopType,
  desktopPressKey,
  desktopGetClipboard,
  desktopSetClipboard,
  // Phase 4
  desktopLaunchApp,
  desktopCloseApp,
  desktopGetProcessList,
  // Phase 3
  desktopWaitForChange,
  desktopDiffScreenshot,
  desktopScreenshotWithHistory,
  desktopWindowScreenshot,
  parseDesktopScreenshotToolArgs,
  parseDesktopPointerMonitorArgs,
  resolveDesktopActionPoint,
  getDesktopAdvisorPacketById,
  desktopGetActiveMonitorIndex,
  desktopGetMonitors,
  desktopGetMonitorsSummary,
  desktopFindInstalledApp,
  desktopListWindowsCanonical,
  desktopWindowClick,
  desktopWindowType,
  desktopWindowPressKey,
  desktopWindowScroll,
  getDesktopToolDefinitions,
  getDesktopAdvisorPacket,
} from '../desktop-tools';
// import { runDesktopTask } from '../tasks/desktop-task-runner'; // removed — module deleted
import { CronScheduler } from '../scheduling/cron-scheduler';
import { HeartbeatRunner } from '../scheduling/heartbeat-runner';
import {
  initializeAgentSchedules,
  reloadAgentSchedules,
  stopAgentSchedules,
  getAgentRunHistory,
  getAgentLastRun,
  recordAgentRun,
  setSchedulerBroadcast,
  setSchedulerRunAgentFn,
} from '../../scheduler';
import { automationDashboardTool } from '../scheduling/schedule-admin-tools';
import { TelegramChannel } from '../comms/telegram-channel';
import { executeDeliverySendScreenshot } from '../delivery-screenshot.js';
import { executeXaiImageVisionSummary } from '../tools/handlers/xai-handlers.js';
import { executeWebSearch, executeWebFetch } from '../../tools/web';
import { executeGenerateImage } from '../../tools/generate-image.js';
import { executeGenerateVideo } from '../../tools/generate-video.js';
import { executeWriteNote } from '../../tools/write-note';
import { searchMemoryIndexAsync, readMemoryRecord } from '../memory-index/index';
import {
  cancelMainChatTimer,
  createMainChatTimer,
  listMainChatTimers,
  updateMainChatTimer,
} from '../timers/timer-store';

const AGENT_TEAM_SCHEDULE_TOOL_DEF_CACHE = new Map<string, any>();

function getAgentTeamScheduleToolDefByName(name: string): any | null {
  const clean = String(name || '').trim();
  if (!clean) return null;
  if (AGENT_TEAM_SCHEDULE_TOOL_DEF_CACHE.has(clean)) {
    return AGENT_TEAM_SCHEDULE_TOOL_DEF_CACHE.get(clean);
  }
  const found = getAgentTeamScheduleTools()
    .find((tool: any) => String(tool?.function?.name || '').trim() === clean) || null;
  AGENT_TEAM_SCHEDULE_TOOL_DEF_CACHE.set(clean, found);
  return found;
}

function normalizeRuntimeVisionAttachmentsInput(value: unknown): RuntimeVisionAttachment[] {
  return (Array.isArray(value) ? value : [])
    .map((item: any) => {
      const base64 = String(item?.base64 || '').trim().replace(/^data:[^;]+;base64,/, '');
      const mimeType = String(item?.mimeType || item?.mime_type || 'image/png').trim() || 'image/png';
      const name = String(item?.name || item?.filename || item?.fileName || mimeType || 'attachment').trim() || 'attachment';
      if (!base64 || !mimeType.startsWith('image/')) return null;
      return { base64, mimeType, name };
    })
    .filter(Boolean)
    .slice(0, 4) as RuntimeVisionAttachment[];
}

function normalizeRuntimeAttachmentPreviewsInput(value: unknown): any[] {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === 'object')
    .slice(0, 8);
}

// orchestration/multi-agent removed — stubs to prevent reference errors
const OrchestrationTriggerState: any = class { recordToolResult() {} recordRoundNoProgress() {} shouldTrigger() { return { fire: false, reason: '' }; } markFired() {} };
const callSecondaryPreflight: any = async () => null;
const callSecondaryAdvisor: any = async () => null;
const callSecondaryFileOpClassifier: any = async () => null;
const callSecondaryFileAnalyzer: any = async () => null;
const callSecondaryFileVerifier: any = async () => null;
const callSecondaryFilePatchPlanner: any = async () => null;
const callSecondaryBrowserAdvisor: any = async () => null;
const callSecondaryDesktopAdvisor: any = async () => null;
const formatPreflightExecutionObjective: any = () => '';
const formatPreflightHint: any = () => '';
const formatAdvisoryHint: any = () => '';
const formatBrowserAdvisorHint: any = () => '';

function buildVisionInjectedPreviewPayload(visionMessage: any): Record<string, any> | undefined {
  const parts = Array.isArray(visionMessage?.content) ? visionMessage.content : [];
  const imagePart = parts.find((part: any) => part?.type === 'image_url' || part?.type === 'image');
  const dataUrl = String(imagePart?.image_url?.url || '').trim();
  if (dataUrl) {
    return { dataUrl, mimeType: dataUrl.match(/^data:([^;]+);/i)?.[1] || 'image/png' };
  }
  const base64 = String(imagePart?.source?.data || '').trim();
  if (!base64) return undefined;
  const mimeType = String(imagePart?.source?.media_type || 'image/png').trim() || 'image/png';
  return { dataUrl: `data:${mimeType};base64,${base64}`, mimeType };
}

function formatRecentMessagesForCreativeHandoff(
  history: Array<{ role: string; content: string }>,
  currentMessage: string,
): string {
  const current = String(currentMessage || '').trim();
  const recent = (history || [])
    .filter((m) => {
      const role = String(m?.role || '').trim();
      const content = String(m?.content || '').trim();
      if (!role || !content) return false;
      return !(role === 'user' && current && content === current);
    })
    .slice(-5);
  if (!recent.length) return '';
  return recent
    .map((m, index) => {
      const role = String(m.role || 'message').toUpperCase();
      const content = String(m.content || '').replace(/\r/g, '').trim();
      return `${index + 1}. ${role}: ${content}`;
    })
    .join('\n\n');
}

function formatSkillsReadForCreativeHandoff(toolResults: ToolResult[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const tr of toolResults || []) {
    if (tr?.name !== 'skill_read' || tr.error) continue;
    const id = String((tr.args as any)?.id || (tr.args as any)?.skill_id || '').trim() || `skill_${blocks.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const content = String(tr.result || '').replace(/\r/g, '').trim();
    if (!content) continue;
    blocks.push(`--- skill_read: ${id} ---\n${content}`);
  }
  return blocks.join('\n\n');
}

function formatPreCreativeSwitchToolResultsForHandoff(toolResults: ToolResult[]): string {
  const results = (toolResults || [])
    .filter((tr) => tr && tr.name && tr.name !== 'switch_creative_mode' && tr.name !== 'enter_creative_mode' && tr.name !== 'exit_creative_mode');
  if (!results.length) return '';

  const blocks = results.map((tr, index) => {
    let args = '{}';
    try {
      args = JSON.stringify(tr.args || {});
    } catch {}
    const result = String(tr.result || '').replace(/\r/g, '').trim();
    return [
      `--- pre_switch_tool_${index + 1}: ${tr.name}${tr.error ? ' [ERROR]' : ''} ---`,
      `args: ${args}`,
      result ? `result:\n${result}` : 'result: (empty)',
    ].join('\n');
  });

  return blocks.join('\n\n');
}
const formatDesktopAdvisorHint: any = () => '';
const getOrchestrationConfig: any = () => null;
const clampOrchestrationConfig: any = (x: any) => x;
const clampPreemptConfig: any = (x: any) => x;
const checkOrchestrationEligibility: any = () => false;
const shouldRunPreflight: any = () => false;
const secondarySupportsVision: any = () => false;

const mobileChatRequestDedupe = new Map<string, { at: number; streamId: string; message: string }>();
const MOBILE_CHAT_REQUEST_DEDUPE_TTL_MS = 2 * 60 * 1000;

function normalizeClientRequestId(input: unknown): string {
  return String(input || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160);
}

function pruneMobileChatRequestDedupe(now = Date.now()): void {
  for (const [key, entry] of mobileChatRequestDedupe.entries()) {
    if (now - Number(entry?.at || 0) > MOBILE_CHAT_REQUEST_DEDUPE_TTL_MS) {
      mobileChatRequestDedupe.delete(key);
    }
  }
}

function mobileChatRequestDedupeKey(sessionId: string, clientRequestId: string): string {
  return `${String(sessionId || 'default')}::${clientRequestId}`;
}

function normalizeTurnOrigin(input: unknown, sessionId: string, fallback?: Partial<TurnOrigin>): TurnOrigin {
  const raw = input && typeof input === 'object' ? input as Record<string, any> : {};
  const sid = String(sessionId || '').trim();
  const rawChannel = String(raw.channel || fallback?.channel || '').trim().toLowerCase();
  const inferredChannel =
    rawChannel === 'cli' ? 'terminal'
      : rawChannel === 'terminal' || rawChannel === 'telegram' || rawChannel === 'mobile' || rawChannel === 'discord' || rawChannel === 'whatsapp' || rawChannel === 'system' || rawChannel === 'web'
        ? rawChannel
        : sid.startsWith('telegram_') ? 'telegram'
          : sid.startsWith('mobile_') ? 'mobile'
            : sid.startsWith('cli_') ? 'terminal'
              : sid.startsWith('discord_') ? 'discord'
                : sid.startsWith('whatsapp_') ? 'whatsapp'
                  : sid.startsWith('task_') || sid.startsWith('cron_') || sid.startsWith('brain_') || sid.startsWith('auto_') ? 'system'
                    : 'web';
  const channel = inferredChannel as TurnOrigin['channel'];
  const defaultSurface =
    channel === 'telegram' || channel === 'discord' || channel === 'whatsapp' ? 'bot'
      : channel === 'mobile' ? 'mobile_app'
        : channel === 'terminal' ? 'terminal'
          : channel === 'system' ? 'automation'
            : 'desktop_app';
  const defaultDevice =
    channel === 'mobile' || channel === 'telegram' || channel === 'whatsapp' ? 'phone'
      : channel === 'system' ? 'server'
        : 'computer';
  const cleanOptional = (value: unknown): string | undefined => {
    const s = String(value ?? '').trim();
    return s ? s.slice(0, 240) : undefined;
  };
  return {
    channel,
    surface: cleanOptional(raw.surface) || fallback?.surface || defaultSurface,
    device: cleanOptional(raw.device) || fallback?.device || defaultDevice,
    chatId: cleanOptional(raw.chatId) || fallback?.chatId,
    userId: cleanOptional(raw.userId) || fallback?.userId,
    label: cleanOptional(raw.label) || fallback?.label,
    source: cleanOptional(raw.source) || fallback?.source,
  };
}

function persistTurnOriginChannelHint(sessionId: string, origin: TurnOrigin): void {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (origin.channel === 'system') return;
  setSessionChannelHint(sid, {
    channel: origin.channel as 'terminal' | 'telegram' | 'web' | 'mobile' | 'discord' | 'whatsapp',
    chatId: Number.isFinite(Number(origin.chatId)) ? Number(origin.chatId) : undefined,
    userId: Number.isFinite(Number(origin.userId)) ? Number(origin.userId) : undefined,
    timestamp: Date.now(),
  });
}


function formatTurnOriginContext(origin: TurnOrigin, sessionId: string): string {
  const title = origin.label || origin.channel;
  const lines = [
    '[TURN ORIGIN]',
    `User contact channel: ${title}`,
    `Surface: ${origin.surface || 'unknown'}`,
    `User device/surface class: ${origin.device || 'unknown'}`,
    `Session: ${sessionId || 'default'}`,
    origin.chatId ? `External chat id: ${origin.chatId}` : '',
    origin.userId ? `External user id: ${origin.userId}` : '',
    '',
    '[LOCAL RUNTIME]',
    'Prometheus is still running on the user\'s local computer, with its normal local workspace, browser, shell, file, and desktop tools available according to the current tool policy.',
    'The contact channel only describes where the user sent this message from. Do not treat Telegram, mobile, Discord, WhatsApp, or CLI as evidence that desktop/computer tasks are unavailable.',
    'Use the origin only to adapt reply format and delivery assumptions, such as concise mobile responses or Telegram-friendly attachments.',
  ].filter(Boolean);
  return lines.join('\n');
}

type TurnFileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

type TurnFileChange = {
  path: string;
  displayPath: string;
  status: TurnFileChangeStatus;
  insertions: number;
  deletions: number;
  oldPath?: string;
  diffPreview?: string;
  binary?: boolean;
};

type TurnFileChanges = {
  summary: {
    fileCount: number;
    insertions: number;
    deletions: number;
  };
  files: TurnFileChange[];
  generatedAt: number;
};

const FILE_MUTATION_TOOL_NAMES = new Set([
  'create_file',
  'write',
  'write_file',
  'append_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'apply_patchset',
  'apply_workspace_patchset',
  'workspace_edit',
  'rename_file',
  'delete_file',
  'copy_file',
  'move_file',
  'mkdir',
  'apply_patch',
  'write_source',
  'find_replace_source',
  'apply_dev_source_patchset',
  'replace_lines_source',
  'insert_after_source',
  'delete_lines_source',
  'delete_source',
  'write_webui_source',
  'find_replace_webui_source',
  'replace_lines_webui_source',
  'insert_after_webui_source',
  'delete_lines_webui_source',
  'delete_webui_source',
  'write_prom_file',
  'find_replace_prom',
  'replace_lines_prom',
  'insert_after_prom',
  'delete_lines_prom',
  'delete_prom_file',
  'skill_manifest_write',
  'skill_update_metadata',
  'skill_resource_write',
  'skill_resource_delete',
  'prom_apply_dev_changes',
]);

function isTurnFileMutationTool(toolName: string): boolean {
  const name = String(toolName || '').trim();
  if (!name) return false;
  if (FILE_MUTATION_TOOL_NAMES.has(name)) return true;
  if (/^(write|delete|find_replace|replace_lines|insert_after)_/.test(name) && /(source|webui|prom|file)$/.test(name)) return true;
  return false;
}

function isPlannedRestartToolName(toolName: string): boolean {
  const name = String(toolName || '').trim();
  return name === 'gateway_restart'
    || name === 'prom_apply_dev_changes'
    || /^(prom_)?dev_.*apply/i.test(name)
    || /^(apply_)?dev_source_(changes|edit|patch)$/i.test(name);
}

function normalizeDisplayPath(filePath: string, workspacePath: string): string {
  const value = String(filePath || '').trim();
  if (!value) return '';
  try {
    const abs = path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspacePath, value);
    const rel = path.relative(workspacePath, abs).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
    return abs.replace(/\\/g, '/');
  } catch {
    return value.replace(/\\/g, '/');
  }
}

function resolveTurnFilePath(rawPath: any, workspacePath: string): string {
  const value = String(rawPath || '').trim();
  if (!value || value === '.' || value === '/dev/null') return '';
  try {
    if (path.isAbsolute(value)) return path.resolve(value);
    const normalized = value.replace(/\\/g, '/').replace(/^\.?\//, '');
    const workspaceAbs = path.resolve(path.join(workspacePath, normalized));
    if (fs.existsSync(workspaceAbs)) return workspaceAbs;
    if (/^(src|web-ui)\//i.test(normalized)) {
      const projectRoot = path.resolve(workspacePath, '..');
      const projectAbs = path.resolve(path.join(projectRoot, normalized));
      if (
        fs.existsSync(path.join(projectRoot, 'package.json'))
        && fs.existsSync(path.join(projectRoot, 'src'))
        && fs.existsSync(path.join(projectRoot, 'web-ui'))
      ) {
        return projectAbs;
      }
    }
    return workspaceAbs;
  } catch {
    return '';
  }
}

function expandRawPathCandidates(rawPath: any, toolName: string, args: any): string[] {
  const raw = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!raw) return [];
  const out = new Set<string>([raw]);
  const surfaces = Array.isArray(args?.changed_surfaces)
    ? args.changed_surfaces.map((surface: any) => String(surface || '').trim().toLowerCase())
    : [];
  const isDevApply = toolName === 'prom_apply_dev_changes';
  const isMobileish = surfaces.includes('mobile') || /^src\/mobile\//i.test(raw) || /^mobile\//i.test(raw);
  if (isMobileish && /^src\/mobile\//i.test(raw)) out.add(`web-ui/${raw}`);
  if (isMobileish && /^mobile\//i.test(raw)) out.add(`web-ui/src/${raw}`);
  if (isDevApply && /^src\/(pages|styles|components|mobile|utils|app\.js|ws\.js)/i.test(raw)) out.add(`web-ui/${raw}`);
  return Array.from(out);
}

function extractPatchTargetPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const rawLine of String(patchText || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('diff --git ')) {
      const parts = line.split(/\s+/).slice(2, 4).map((part) => part.replace(/^"|"$/g, ''));
      for (let item of parts) {
        if (item.startsWith('a/') || item.startsWith('b/')) item = item.slice(2);
        if (item && item !== '/dev/null') paths.add(item);
      }
    } else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      let item = line.slice(4).trim().replace(/^"|"$/g, '').split(/\s+/)[0] || '';
      if (item.startsWith('a/') || item.startsWith('b/')) item = item.slice(2);
      if (item && item !== '/dev/null') paths.add(item);
    } else if (line.startsWith('rename from ')) {
      paths.add(line.slice('rename from '.length).trim());
    } else if (line.startsWith('rename to ')) {
      paths.add(line.slice('rename to '.length).trim());
    }
  }
  return Array.from(paths);
}

function extractTouchedFilesFromToolResult(result: any, workspacePath: string): string[] {
  const toolName = String(result?.name || result?.toolName || '').trim();
  if (!isTurnFileMutationTool(toolName)) return [];
  if (result?.error === true) return [];
  const args = result?.args && typeof result.args === 'object' ? result.args : {};
  const candidates: any[] = [];
  for (const source of [result?.extra, result?.data, result]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of [
      'touchedFiles', 'changedFiles', 'affectedFiles', 'files',
      'touched_files', 'changed_files', 'affected_files',
    ]) {
      if (source[key] != null) candidates.push(source[key]);
    }
  }
  for (const key of [
    'path', 'file', 'filename', 'name', 'target', 'target_path', 'targetPath',
    'old_path', 'oldPath', 'new_path', 'newPath', 'source', 'destination',
    'files', 'allowedFiles', 'affected_files', 'affectedFiles', 'changed_files', 'changedFiles',
  ]) {
    if (args[key] != null) candidates.push(args[key]);
  }
  if (toolName.includes('webui_source')) {
    candidates.push(...candidates.map((item) => {
      const s = String(item || '').trim();
      return s && !/^web-ui[\\/]/i.test(s) ? path.join('web-ui', s) : s;
    }));
  } else if (/_source$/.test(toolName) && !toolName.includes('webui')) {
    candidates.push(...candidates.map((item) => {
      const s = String(item || '').trim();
      return s && !/^src[\\/]/i.test(s) ? path.join('src', s) : s;
    }));
  }
  if (toolName === 'apply_patch' && typeof args.patch === 'string') {
    candidates.push(...extractPatchTargetPaths(args.patch));
  }
  return Array.from(new Set(
    candidates
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .flatMap((item) => expandRawPathCandidates(item, toolName, args))
      .map((item) => resolveTurnFilePath(item, workspacePath))
      .filter(Boolean),
  ));
}

function runGitText(cwd: string, args: string[], maxBuffer = 2 * 1024 * 1024): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer,
  } as any).toString();
}

function findGitRootForPath(filePath: string, workspacePath: string): string | null {
  const cwd = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
    ? filePath
    : (fs.existsSync(filePath) ? path.dirname(filePath) : workspacePath);
  try {
    return path.resolve(runGitText(cwd, ['rev-parse', '--show-toplevel']).trim());
  } catch {
    try {
      return path.resolve(runGitText(workspacePath, ['rev-parse', '--show-toplevel']).trim());
    } catch {
      return null;
    }
  }
}

function countTextFileLines(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1_000_000) return 0;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('\0')) return 0;
    return content.length ? content.split(/\r?\n/).length : 0;
  } catch {
    return 0;
  }
}

function inferGitStatus(root: string, relPath: string, absPath: string): TurnFileChangeStatus {
  try {
    const status = runGitText(root, ['status', '--porcelain', '--', relPath]).trim();
    if (/^R/.test(status)) return 'renamed';
    if (/^\?\?/.test(status) || /^A/.test(status)) return 'added';
    if (/^D|^.D/.test(status)) return 'deleted';
  } catch {}
  return 'modified';
}

function collectTurnFileChanges(toolResults: any[] | undefined, workspacePath: string): TurnFileChanges | undefined {
  const touched = Array.from(new Set(
    (Array.isArray(toolResults) ? toolResults : [])
      .flatMap((result) => extractTouchedFilesFromToolResult(result, workspacePath)),
  ));
  if (!touched.length) return undefined;

  const changes: TurnFileChange[] = [];
  for (const absPath of touched.slice(0, 80)) {
    const gitRoot = findGitRootForPath(absPath, workspacePath);
    let insertions = 0;
    let deletions = 0;
    let status: TurnFileChangeStatus = fs.existsSync(absPath) ? 'modified' : 'deleted';
    let diffPreview = '';
    let binary = false;

    if (gitRoot) {
      const relPath = path.relative(gitRoot, absPath).replace(/\\/g, '/');
      status = inferGitStatus(gitRoot, relPath, absPath);
      try {
        const numstat = runGitText(gitRoot, ['diff', '--numstat', '--', relPath]).trim().split(/\r?\n/).filter(Boolean)[0] || '';
        const parts = numstat.split(/\s+/);
        if (parts[0] === '-' || parts[1] === '-') {
          binary = true;
        } else {
          insertions = Math.max(0, Number(parts[0]) || 0);
          deletions = Math.max(0, Number(parts[1]) || 0);
        }
      } catch {}
      if (status === 'added' && insertions === 0 && deletions === 0 && fs.existsSync(absPath)) {
        insertions = countTextFileLines(absPath);
      }
      try {
        diffPreview = runGitText(gitRoot, ['diff', '--unified=2', '--', relPath], 512 * 1024).slice(0, 12000);
      } catch {}
    } else if (fs.existsSync(absPath)) {
      insertions = countTextFileLines(absPath);
      status = 'added';
    }

    if (!fs.existsSync(absPath) && status !== 'deleted') continue;
    if (status === 'deleted' && insertions === 0 && deletions === 0 && !binary && !diffPreview) continue;
    if (insertions === 0 && deletions === 0 && !binary && status === 'modified' && !diffPreview) continue;
    changes.push({
      path: absPath,
      displayPath: normalizeDisplayPath(absPath, workspacePath),
      status,
      insertions,
      deletions,
      diffPreview: diffPreview || undefined,
      binary: binary || undefined,
    });
  }

  if (!changes.length) return undefined;
  const insertions = changes.reduce((sum, file) => sum + Math.max(0, Number(file.insertions) || 0), 0);
  const deletions = changes.reduce((sum, file) => sum + Math.max(0, Number(file.deletions) || 0), 0);
  return {
    summary: { fileCount: changes.length, insertions, deletions },
    files: changes,
    generatedAt: Date.now(),
  };
}

type MainChatStreamFrame = {
  seq: number;
  type: string;
  at: number;
  data: Record<string, any>;
};

type MainChatStreamState = {
  sessionId: string;
  streamId: string;
  startedAt: number;
  updatedAt: number;
  active: boolean;
  nextSeq: number;
  events: MainChatStreamFrame[];
  completedAt?: number;
};

const mainChatStreams = new Map<string, MainChatStreamState>();
const MAIN_CHAT_STREAM_MAX_EVENTS = 12000;
const MAIN_CHAT_STREAM_TTL_MS = 45 * 60 * 1000;
const MAIN_CHAT_WS_UPDATE_THROTTLE_MS = 900;
const MAIN_CHAT_WS_DIRECT_EVENTS = new Set([
  'user_message',
  'session_title',
  'agent_mode',
  'ui_preflight',
  'info',
  'tool_call',
  'tool_result',
  'tool_progress',
  'progress_state',
  'thinking',
  'agent_thought',
  'final',
  'done',
  'error',
  'warn',
  'runtime_registered',
]);
const mainChatStreamUpdateTimers = new Map<string, NodeJS.Timeout>();

function getMainChatStream(sessionId: string): MainChatStreamState | null {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  return mainChatStreams.get(sid) || null;
}

function pruneMainChatStreams(): void {
  const cutoff = Date.now() - MAIN_CHAT_STREAM_TTL_MS;
  for (const [sessionId, stream] of mainChatStreams.entries()) {
    if (!stream.active && Number(stream.completedAt || stream.updatedAt || 0) < cutoff) {
      mainChatStreams.delete(sessionId);
    }
  }
}

function beginMainChatStream(sessionId: string): MainChatStreamState {
  pruneMainChatStreams();
  const sid = String(sessionId || 'default').trim() || 'default';
  const stream: MainChatStreamState = {
    sessionId: sid,
    streamId: crypto.randomUUID(),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    active: true,
    nextSeq: 1,
    events: [],
  };
  mainChatStreams.set(sid, stream);
  return stream;
}

function broadcastMainChatStreamUpdate(stream: MainChatStreamState, frame: MainChatStreamFrame): void {
  try {
    broadcastWS({
      type: 'main_chat_stream_update',
      sessionId: stream.sessionId,
      streamId: stream.streamId,
      lastSeq: frame.seq,
      event: frame.type,
      at: frame.at,
      active: stream.active,
    });
  } catch {}
}

function scheduleMainChatStreamUpdate(stream: MainChatStreamState, frame: MainChatStreamFrame): void {
  const key = `${stream.sessionId}:${stream.streamId}`;
  if (mainChatStreamUpdateTimers.has(key)) return;
  const timer = setTimeout(() => {
    mainChatStreamUpdateTimers.delete(key);
    const latest = stream.events[stream.events.length - 1] || frame;
    broadcastMainChatStreamUpdate(stream, latest);
  }, MAIN_CHAT_WS_UPDATE_THROTTLE_MS);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();
  mainChatStreamUpdateTimers.set(key, timer);
}

function finishMainChatStream(sessionId: string, streamId: string): void {
  const stream = getMainChatStream(sessionId);
  if (!stream || stream.streamId !== streamId) return;
  stream.active = false;
  stream.completedAt = Date.now();
  stream.updatedAt = stream.completedAt;
  const key = `${stream.sessionId}:${stream.streamId}`;
  const timer = mainChatStreamUpdateTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    mainChatStreamUpdateTimers.delete(key);
  }
  const latest = stream.events[stream.events.length - 1];
  if (latest) broadcastMainChatStreamUpdate(stream, latest);
}

function appendMainChatStreamEvent(sessionId: string, streamId: string, type: string, data: any): MainChatStreamFrame | null {
  const stream = getMainChatStream(sessionId);
  if (!stream || stream.streamId !== streamId) return null;
  const cleanData = data && typeof data === 'object' ? { ...data } : {};
  const frame: MainChatStreamFrame = {
    seq: stream.nextSeq++,
    type: String(type || 'event'),
    at: Date.now(),
    data: cleanData,
  };
  stream.events.push(frame);
  if (stream.events.length > MAIN_CHAT_STREAM_MAX_EVENTS) {
    stream.events.splice(0, stream.events.length - MAIN_CHAT_STREAM_MAX_EVENTS);
  }
  stream.updatedAt = frame.at;
  if (MAIN_CHAT_WS_DIRECT_EVENTS.has(frame.type)) {
    try {
      broadcastWS({
        type: 'main_chat_stream_event',
        sessionId: stream.sessionId,
        streamId: stream.streamId,
        seq: frame.seq,
        event: frame.type,
        at: frame.at,
        data: frame.data,
      });
    } catch {}
  } else {
    scheduleMainChatStreamUpdate(stream, frame);
  }
  return frame;
}

function truncateRuntimeProcessText(value: unknown, max = 4000): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function runtimeProcessEntryFromSseEvent(type: string, data: any): Record<string, any> | null {
  const eventType = String(type || '').trim();
  if (!eventType || eventType === 'heartbeat' || eventType === 'token' || eventType === 'thinking_delta') return null;
  const ts = new Date().toLocaleTimeString();
  const action = String(data?.action || data?.name || data?.toolName || '').trim();
  if (eventType === 'tool_call') {
    return {
      ts,
      type: 'tool',
      actor: 'Prom',
      content: truncateRuntimeProcessText(action ? `Preparing ${action}` : data?.message || 'Preparing tool'),
      extra: {
        source: 'runtime_checkpoint',
        event: eventType,
        toolName: action,
        args: data?.args,
        stepNum: data?.stepNum,
      },
    };
  }
  if (eventType === 'tool_result') {
    return {
      ts,
      type: data?.error ? 'error' : 'result',
      actor: 'Prom',
      content: truncateRuntimeProcessText(data?.result || (action ? `${action} complete` : 'Tool complete')),
      extra: {
        source: 'runtime_checkpoint',
        event: eventType,
        toolName: action,
        args: data?.args,
        error: data?.error === true,
        stepNum: data?.stepNum,
      },
    };
  }
  if (eventType === 'thinking' || eventType === 'agent_thought') {
    return {
      ts,
      type: 'think',
      actor: 'Prom',
      content: truncateRuntimeProcessText(data?.thinking || data?.text || data?.message),
      extra: { source: 'runtime_checkpoint', event: eventType },
    };
  }
  if (eventType === 'error' || eventType === 'warn') {
    return {
      ts,
      type: eventType === 'warn' ? 'warn' : 'error',
      actor: 'Prom',
      content: truncateRuntimeProcessText(data?.message || data?.error || data?.result),
      extra: { source: 'runtime_checkpoint', event: eventType, toolName: action },
    };
  }
  if (eventType === 'progress_state') {
    const items = Array.isArray(data?.items) ? data.items : [];
    const active = Number.isFinite(Number(data?.activeIndex)) ? items[Number(data.activeIndex)] : null;
    const reason = String(data?.reason || '').trim();
    if (!active?.text && (!reason || /^(?:reset|request_start|none|idle|step[_\s-]*done|step[_\s-]*complete|done)$/i.test(reason))) return null;
    const content = active?.text
      ? `Plan: ${active.text}`
      : reason
        ? `Plan update: ${reason}`
        : '';
    if (!content) return null;
    return {
      ts,
      type: 'step',
      actor: 'Prom',
      content: truncateRuntimeProcessText(content, 1000),
      extra: { source: 'runtime_checkpoint', event: eventType, activeIndex: data?.activeIndex, total: data?.total },
    };
  }
  const content = truncateRuntimeProcessText(data?.message || data?.text || data?.result || data?.summary, 2000);
  if (!content) return null;
  return {
    ts,
    type: eventType === 'ui_preflight' || eventType === 'info' ? 'info' : 'info',
    actor: 'Prom',
    content,
    extra: { source: 'runtime_checkpoint', event: eventType, toolName: action },
  };
}

import { resolvePrimaryModelCapabilities, buildVisionImagePart, type ModelCapabilities } from '../vision-chat';
import {
  createTask,
  loadTask,
  saveTask,
  updateTaskStatus,
  setTaskStepRunning,
  updateTaskRuntimeProgress,
  appendJournal,
  updateResumeContext,
  listTasks,
  deleteTask,
  mutatePlan,
  getEvidenceBusSnapshot,
  type TaskRecord,
  type TaskStatus,
} from '../tasks/task-store';
import { clearTaskRunBinding, completeNextOpenTaskStep, getTaskRunBinding, mirrorSessionChatEvent } from '../tasks/task-run-mirror';
import {
  loadScheduleMemory,
  loadRunLog,
  startRunLogEntry,
  completeScheduledRun,
  formatScheduleMemoryForPrompt,
} from '../scheduling/schedule-memory';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import {
  addVoiceWorkgroupWorker,
  createVoiceWorkgroup,
  listVoiceWorkgroupsForSession,
  loadVoiceWorkgroup,
  type VoiceWorkgroupDelivery,
  type VoiceWorkgroupMode,
} from '../voice/voice-workgroup-store';
import { analyzeRunForImprovement, applyPromptMutation } from '../scheduling/prompt-mutation';
import { processTaskFailure, buildSelfRepairTriggerPrompt } from '../errors/error-watchdog';
import {
  decidePostActionObservation,
  summarizeBrowserObservationState,
  summarizeDesktopObservationState,
  type PostActionObservationDecision,
  type BrowserObservationPageState,
  type DesktopObservationPacketState,
} from '../observation-policy';
import { goalDecomposeTool, executeGoalDecompose, approveGoal, loadGoal, listGoals } from '../goal-decomposer';
import {
  applyMainChatGoalJudgeResult,
  buildMainChatGoalContinuationPrompt,
  getAllMainChatGoalRecords,
  handleMainChatGoalCommand,
  isMainChatGoalContinuation,
  judgeMainChatGoal,
  maybeSummarizeMainChatGoal,
  recordMainChatGoalTurnPlanProgress,
  recordMainChatGoalDeniedAction,
  recordMainChatGoalRuntimeFailure,
  resolveMainChatGoalPolicy,
  snapshotMainChatGoal,
} from '../main-chat-goals';
import {
  listManagedTeams,
  getManagedTeam,
  saveManagedTeam,
  deleteManagedTeam,
  createManagedTeam,
  appendTeamChat,
  appendManagerNote,
  applyTeamChange,
  rejectTeamChange,
  getTeamMemberAgentIds,
  recordTeamRun,
  addTeamNotificationTarget,
  getTeamNotificationTargets,
  listTeamContextReferences,
  addTeamContextReference,
  updateTeamContextReference,
  deleteTeamContextReference,
  buildTeamContextRuntimeBlock,
} from '../teams/managed-teams';
import { triggerManagerReview, handleManagerConversation, setTeamRunAgentFn } from '../teams/team-manager-runner';
import { buildTeamDispatchTask } from '../teams/team-dispatch-runtime';
import { checkForTeamSuggestion } from '../teams/team-detector';
import { SubagentManager } from '../agents-runtime/subagent-manager';
// orchestration/file-op-v2 removed — stubs to prevent reference errors
type FileOpType = 'CHAT' | 'FILE_EDIT' | 'FILE_CREATE' | 'FILE_ANALYSIS' | 'BROWSER_OP' | 'DESKTOP_OP';
class FileOpProgressWatchdog { constructor(_n: number) {} record(_x: any) { return { no_progress: false }; } }
const classifyFileOpType: any = () => ({ type: 'CHAT' as FileOpType, reason: 'file-op v2 disabled' });
const resolveFileOpSettings: any = () => ({ enabled: false, watchdog_no_progress_cycles: 3, checkpointing_enabled: false, primary_edit_max_lines: 200, primary_edit_max_chars: 8000, primary_edit_max_files: 3 });
const FILE_CREATE_TOOL_NAMES = new Set(['create_file', 'write_file', 'write', 'append_file', 'mkdir']);
const FILE_EDIT_TOOL_NAMES = new Set([
  'write_file', 'write', 'append_file', 'replace_lines', 'find_replace',
  'insert_after', 'delete_lines', 'apply_patch', 'apply_patchset',
  'apply_workspace_patchset', 'workspace_edit', 'prom_apply_dev_changes',
]);
const isFileMutationTool: any = (name: unknown) => FILE_MUTATION_TOOL_NAMES.has(String(name || '').trim());
const isFileCreateTool: any = (name: unknown) => FILE_CREATE_TOOL_NAMES.has(String(name || '').trim());
const isFileEditTool: any = (name: unknown) => FILE_EDIT_TOOL_NAMES.has(String(name || '').trim());
const extractFileToolTarget: any = (_name: unknown, args: any) => {
  if (!args || typeof args !== 'object') return null;
  return String(args.filename || args.path || args.file || args.name || args.new_path || args.destination || '').trim() || null;
};
const estimateFileToolChange: any = (_name: unknown, args: any) => {
  const content = String(args?.content ?? args?.new_content ?? args?.replace ?? '');
  return {
    lines_changed: content ? Math.max(1, content.split('\n').length) : 1,
    chars_changed: content.length,
  };
};
const canPrimaryApplyFileTool: any = () => ({ allowed: true, reason: '' });
const shouldVerifyFileTurn: any = () => ({ verify: false, reasons: [] });
const isSmallSuggestedFix: any = () => false;
const buildFailureSignature: any = () => '';
const buildPatchSignature: any = () => '';
const loadFileOpCheckpoint: any = () => null;
const saveFileOpCheckpoint: any = () => {};
const clearFileOpCheckpoint: any = () => {};
import { webSearch, webFetch } from '../../tools/web';
import {
	  buildTools as _buildTools,
	  getToolCategory,
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
} from '../tool-builder';
import {
  executeTool as _executeTool,
  lastFilenameUsed,
} from '../agents-runtime/subagent-executor';
import {
  wss as _wssRef, setWss,
  broadcastWS,
  broadcastTeamEvent,
  addTeamSseClient,
  removeTeamSseClient,
  sendTeamNotificationToChannels,
  sendDiscordNotification,
  sendWhatsAppNotification,
  resolveChannelsConfig,
  setTelegramChannelForBroadcaster,
  isModelBusy, setModelBusy,
  getLastMainSessionId, setLastMainSessionId,
  setSessionChannelHint,
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type ChannelsConfig,
  normalizeTelegramConfig,
  normalizeDiscordConfig,
  normalizeWhatsAppConfig,
} from '../comms/broadcaster';
import { notifyChatCompletion } from '../notifications/completion-bridge';
import {
  getWebPushPublicKey,
  listWebPushSubscriptions,
  removeWebPushSubscription,
  sendWebPushToAll,
  upsertWebPushSubscription,
} from '../notifications/web-push';

import {
  getSessionSkillWindows,
  sessionCurrentTurn,
  isOrchestrationSkillEnabled,
  setOrchestrationEnabled,
  recoverSkillsIfEmpty,
  syncOrchestrationOnStartup,
  initSkillWindows,
  setSkillRecoveryFn,
} from '../skills-runtime/skill-windows';
import { buildProviderById, getPrimaryModel } from '../../providers/factory';
import { clearTurnModelOverride, getTurnModelOverride } from '../chat/model-switch-state';
import {
  separateThinkingFromContent,
  sanitizeFinalReply,
  stripExplicitThinkTags,
  normalizeForDedup,
  isGreetingLikeMessage,
} from '../comms/reply-processor';
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
} from '../tasks/task-router';

import {
  router as skillsRouter,
  setSkillsRouterManager,
} from './skills.router';
import {
  router as tasksRouter,
  initTasksRouter,
  makeBroadcastForTask,
} from './tasks.router';
import { sanitizeAgentId, normalizeAgentsForSave } from '../agents/agent-normalize';
import {
  registerLiveRuntime,
  finishLiveRuntime,
  updateLiveRuntimeCheckpoint,
  listLiveRuntimes,
  getLiveRuntime,
  abortLiveRuntime,
  addPendingRuntimeSteer,
  consumePendingRuntimeSteersForSession,
  type RuntimeSteerEvent,
} from '../live-runtime-registry';
import {
  router as teamsRouter,
  initTeamsRouter,
  pauseManagedTeamInternal,
  resumeManagedTeamInternal,
  buildTeamDispatchContext,
  runTeamAgentViaChat,
} from './teams.router';
import { runTeamAgentViaChat as _runTeamAgentViaChat2, setDispatchDeps } from '../teams/team-dispatch-runtime';
import {
  router as settingsRouter,
  initSettingsRouter,
} from './settings.router';
import {
  router as goalsRouter,
  initGoalsRouter,
} from './goals.router';
import {
  router as proposalsRouter,
  setProposalsBroadcast,
  broadcastProposalCreated,
} from './proposals.router';
import { router as auditLogRouter } from './audit-log.router';
import { router as connectionsRouter } from './connections.router';
import { router as canvasRouter, initCanvasRouter } from './canvas.router';
import { addCanvasFile, getCanvasContextBlock } from './canvas-state';
import { getMCPManager } from '../mcp-manager';
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
} from '../chat/chat-helpers';
import { createApp } from '../core/app';
import { createServer } from '../core/server';
import { runStartup } from '../core/startup';
import { isPublicDistributionBuild } from '../../runtime/distribution.js';
import { isProviderStatusChecking, markProviderStatus, readProviderStatusCache } from '../provider-status';
import { attachWorkspaceCheckpoint, createWorkspaceTurnCheckpoint } from '../../workspace-history';


import {
  buildBootStartupSnapshot as _buildBootStartupSnapshot,
  loadWorkspaceFile,
  loadVoiceAgentMemory,
  readDailyMemoryContext,
  detectToolCategories,
  readMemoryCategories,
  readMemorySnippets,
  buildPersonalityContext as _buildPersonalityContext,
  buildToolsContext,
  TOOL_BLOCKS,
  TOOL_TO_MEMORY_CATS,
  type SkillWindow,
} from '../prompt-context';
import { OllamaProcessManager } from '../ollama-process-manager';
import { raceWithWatchdog, PreemptState } from '../scheduling/preempt-watchdog';
import { detectGpu, logGpuStatus } from '../gpu-detector';
import { internalAgentTaskRouter } from '../agents-runtime/internal-agent-task';
import {
  registerAgentBuilderTools,
  executeAgentBuilderTool,
  AGENT_BUILDER_TOOL_NAMES,
} from '../agents-runtime/agent-builder-integration';


import { activeTasks, getMaxToolRounds } from '../chat/chat-state';
const MAX_TOOL_ROUNDS = getMaxToolRounds();

function resolveEffectiveMaxToolRounds(
  _baseMax: number,
  _opts: { creativeMode?: string | null; executionMode: ExecutionMode; message: string },
): number {
  // No cap — the tool loop runs until the model stops calling tools (or on abort).
  return Infinity;
}

function isResumableExecutionMode(executionMode: ExecutionMode): boolean {
  return executionMode === 'background_task'
    || executionMode === 'background_agent'
    || executionMode === 'proposal_execution'
    || executionMode === 'cron'
    || executionMode === 'team_manager'
    || executionMode === 'team_subagent';
}

// ─── Injected singletons (set by initChatRouter in server-v2.ts) ──────────────
let _cronScheduler: CronScheduler;
let _telegramChannel: TelegramChannel;
let _skillsManager: SkillsManager;

export interface ChatRouterDeps {
  cronScheduler: CronScheduler;
  telegramChannel: TelegramChannel;
  skillsManager: SkillsManager;
}

export function initChatRouter(deps: ChatRouterDeps): void {
  _cronScheduler = deps.cronScheduler;
  _telegramChannel = deps.telegramChannel;
  _skillsManager = deps.skillsManager;

  // Wire chat-helpers and task-router singletons (deferred to init time to avoid use-before-assigned)
  initChatHelpers({ handleChat, telegramChannel: _telegramChannel, makeBroadcastForTask });
  initTaskRouter({ handleChat, telegramChannel: _telegramChannel, makeBroadcastForTask, cronScheduler: _cronScheduler });
}

export const router = express.Router();

function requireSafeSessionParam(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const key = Object.prototype.hasOwnProperty.call(req.params, 'sessionId') ? 'sessionId' : 'id';
  try {
    req.params[key] = assertSafeStorageId(req.params[key], 'session id');
    next();
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Invalid session id.' });
  }
}

function storageAwareStatus(error: unknown): number {
  return isStorageBoundaryError(error) ? 400 : 500;
}

type ExecutionMode = 'interactive' | 'background_task' | 'proposal_execution' | 'background_agent' | 'heartbeat' | 'cron' | 'team_manager' | 'team_subagent';
type ReasoningOptions = {
  enabled?: boolean;
  level?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'extra_high' | 'max';
};
const ROLLING_COMPACTION_SUMMARY_PREFIX = '[Rolling context summary]';
const LEGACY_COMPACTION_SUMMARY_PREFIX = '[Compacted context summary]';
const CONTEXT_COMPACTION_TOOL_NAME = 'context_compaction';

const COMPACTION_REASONING_TRAIL_MAX_CHARS = 10000;


function shouldUseSessionWorkspace(
  executionMode: ExecutionMode,
  sessionWorkspace: string | undefined,
): boolean {
  if (!sessionWorkspace) return false;
  // Normal web/terminal/Telegram chat should follow the workspace selected by
  // the current launcher/config. Persisted per-session workspaces are for
  // scoped autonomous runs such as teams, cron, heartbeats, and proposals.
  return executionMode !== 'interactive';
}

interface RollingCompactionPolicy {
  enabled: boolean;
  messageCount: number;
  toolTurns: number;
  summaryMaxWords: number;
  model: string;
}

function resolveRollingCompactionPolicy(): RollingCompactionPolicy {
  const cfg = (getConfig().getConfig() as any)?.session || {};
  const enabled = cfg?.rollingCompactionEnabled !== false;
  const messageCountRaw = Number(cfg?.rollingCompactionMessageCount);
  const toolTurnsRaw = Number(cfg?.rollingCompactionToolTurns);
  const summaryMaxWordsRaw = Number(cfg?.rollingCompactionSummaryMaxWords);
  return {
    enabled,
    messageCount: Number.isFinite(messageCountRaw) ? Math.max(10, Math.min(120, Math.floor(messageCountRaw))) : 20,
    toolTurns: Number.isFinite(toolTurnsRaw) ? Math.max(1, Math.min(12, Math.floor(toolTurnsRaw))) : 5,
    summaryMaxWords: Number.isFinite(summaryMaxWordsRaw) ? Math.max(80, Math.min(1500, Math.floor(summaryMaxWordsRaw))) : 900,
    model: String(cfg?.rollingCompactionModel || '').trim(),
  };
}

function resolveCompactionNumCtx(): number {
  const cfg = (getConfig().getConfig() as any) || {};
  const candidates = [
    cfg?.session?.rollingCompactionNumCtx,
    cfg?.llm?.num_ctx,
    process.env.LOCALCLAW_SESSION_NUM_CTX,
    process.env.LOCALCLAW_CHAT_NUM_CTX,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 512) return Math.floor(n);
  }
  return 8192;
}

function isCompactionSummaryMessage(msg: any): boolean {
  if (!msg || msg.role !== 'assistant') return false;
  const text = String(msg.content || '').trim();
  return text.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX) || text.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX);
}

function extractLastCompactionSummary(history: Array<any>): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!isCompactionSummaryMessage(msg)) continue;
    const raw = String(msg.content || '').trim();
    const stripped = raw
      .replace(/^\[Rolling context summary\]\s*/i, '')
      .replace(/^\[Compacted context summary\]\s*/i, '')
      .trim();
    if (stripped) return stripped;
  }
  return '';
}

function formatCompactionMessages(messages: Array<any>): string {
  const newestFirst = [...messages].reverse();
  return newestFirst.map((msg, idx) => {
    const role = String(msg.role || 'unknown');
    const ts = Number(msg.timestamp);
    const stamp = Number.isFinite(ts) ? new Date(ts).toISOString() : 'unknown-time';
    const body = Array.isArray(msg.content)
      ? msg.content.map((part: any) => part?.type === 'text' ? String(part.text || '') : '[image]').join('\n').trim()
      : String(msg.content || '').trim();
    return [
      `--- message ${idx + 1} ---`,
      `role: ${role}`,
      `timestamp: ${stamp}`,
      body,
    ].join('\n');
  }).join('\n\n');
}

function formatCompactionToolLogs(messages: Array<any>, toolTurns: number): string {
  const logs = messages
    .filter((m) => m.role === 'assistant' && m.toolLog)
    .slice(-toolTurns)
    .reverse()
    .map((m, idx) => {
      const ts = Number(m.timestamp);
      const stamp = Number.isFinite(ts) ? new Date(ts).toISOString() : 'unknown-time';
      const toolLog = String(m.toolLog || '').trim();
      return [
        `--- tool turn ${idx + 1} ---`,
        `assistant_timestamp: ${stamp}`,
        toolLog,
      ].join('\n');
    })
    .filter(Boolean);
  return logs.join('\n\n');
}

function formatCompactionToolResults(sessionId: string, toolResults: ToolResult[], maxResults: number): string {
  const observations = createToolObservationsFromResults(
    sessionId,
    `compaction_${Date.now()}`,
    Array.isArray(toolResults) ? toolResults.slice(-Math.max(1, maxResults)) : [],
  );
  return formatToolStateSummaryForContext(observations, {
    includeHeader: true,
    maxChars: 2400,
    maxObservations: Math.min(12, Math.max(1, maxResults)),
    includeTelemetry: true,
  });
}

function formatCompactionReasoningTrail(reasoningTrail: string, maxChars = COMPACTION_REASONING_TRAIL_MAX_CHARS): string {
  const clean = String(reasoningTrail || '').trim();
  if (!clean) return '';
  const limit = Math.max(1000, Math.min(20000, Math.floor(Number(maxChars) || COMPACTION_REASONING_TRAIL_MAX_CHARS)));
  if (clean.length <= limit) return clean;
  const headChars = Math.max(500, Math.floor(limit * 0.35));
  const tailChars = Math.max(500, limit - headChars);
  const omitted = clean.length - headChars - tailChars;
  return [
    clean.slice(0, headChars).trimEnd(),
    '',
    `[...${omitted.toLocaleString('en-US')} chars omitted from reasoning/thinking trail; preserve conclusions from visible portions and recover raw details from tool observations if needed...]`,
    '',
    clean.slice(-tailChars).trimStart(),
  ].join('\n');
}


const MODEL_TOOL_RESULT_MAX_CHARS = 12000;
const MODEL_TOOL_RESULT_HEAD_CHARS = 7000;
const MODEL_TOOL_RESULT_TAIL_CHARS = 2500;

function summarizeLargeJsonToolResultForModel(value: string, toolName: string, maxChars: number): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const matches = Array.isArray(parsed.matches) ? parsed.matches : null;
  if (!matches) return null;
  const fileCounts = new Map<string, number>();
  for (const match of matches) {
    const file = String(match?.file || match?.path || parsed.file || parsed.path || '(unknown)');
    fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
  }
  const topFiles = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([file, count]) => ({ file, count }));
  const compactMatches = matches.slice(0, 24).map((match: any) => ({
    file: match?.file || match?.path || parsed.file || parsed.path,
    line_number: match?.line_number,
    line: String(match?.line || '').slice(0, 260),
  }));
  const summary = {
    summarized_tool_result: true,
    tool: toolName || 'tool',
    searched: parsed.searched || parsed.directory || parsed.file || parsed.path,
    pattern: parsed.pattern,
    match_count: parsed.match_count ?? matches.length,
    returned_count: parsed.returned_count ?? matches.length,
    result_limit: parsed.result_limit,
    top_files: topFiles,
    first_matches: compactMatches,
    omitted_matches: Math.max(0, matches.length - compactMatches.length),
    note: 'Large search result was summarized before reinjection into model context. Raw/full output remains in tool logs/raw storage. Narrow with path/glob/pattern or read a targeted file window for exact code.',
  };
  const text = JSON.stringify(summary, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...large ${toolName || 'tool'} summary truncated]`;
}

function boundToolTextForModelContext(text: string, toolName: string, maxChars = MODEL_TOOL_RESULT_MAX_CHARS): string {
  const value = String(text || '');
  if (!value || value.length <= maxChars) return value;
  const summarized = summarizeLargeJsonToolResultForModel(value, toolName, maxChars);
  if (summarized) return summarized;
  const headChars = Math.max(1000, Math.min(MODEL_TOOL_RESULT_HEAD_CHARS, Math.floor(maxChars * 0.75)));
  const tailChars = Math.max(1000, Math.min(MODEL_TOOL_RESULT_TAIL_CHARS, maxChars - headChars));
  const omitted = value.length - headChars - tailChars;
  return [
    value.slice(0, headChars).trimEnd(),
    '',
    `[...${omitted.toLocaleString('en-US')} chars omitted from ${toolName || 'tool'} result before reinjecting into model context; full output remains in tool logs/raw storage...]`,
    '',
    value.slice(-tailChars).trimStart(),
  ].join('\n');
}

function boundToolMessageContentForModelContext(content: any, toolName: string): any {
  if (typeof content === 'string') return boundToolTextForModelContext(content, toolName);
  if (!Array.isArray(content)) return content;
  return content.map((part: any) => {
    if (!part || typeof part !== 'object' || part.type !== 'text') return part;
    return {
      ...part,
      text: boundToolTextForModelContext(String(part.text || ''), toolName),
    };
  });
}

function formatCompactionArtifactPaths(sessionId: string): string {
  const cfg = getConfig();
  const workspacePath = cfg.getWorkspacePath();
  const configDir = cfg.getConfigDir();
  const paths = [
    ['Session JSON', path.join(configDir, 'sessions', `${sessionId}.json`)],
    ['Transcript Markdown', path.join(workspacePath, 'audit', 'chats', 'transcripts', `${sessionId}.md`)],
    ['Transcript JSONL', path.join(workspacePath, 'audit', 'chats', 'transcripts', `${sessionId}.jsonl`)],
    ['Compaction Markdown', path.join(workspacePath, 'audit', 'chats', 'compactions', `${sessionId}.md`)],
    ['Compaction JSONL', path.join(workspacePath, 'audit', 'chats', 'compactions', `${sessionId}.jsonl`)],
  ];
  return paths.map(([label, filePath]) => `${label}: ${filePath}`).join('\n');
}

function boundCompactionSummaryWords(summaryText: string, maxWords: number): string {
  const clean = String(summaryText || '').trim();
  if (!clean) return '';
  const limit = Number.isFinite(Number(maxWords))
    ? Math.max(80, Math.min(1500, Math.floor(Number(maxWords))))
    : 900;
  let wordsSeen = 0;
  const lines: string[] = [];
  for (const line of clean.split(/\r?\n/)) {
    const words = line.match(/\S+/g) || [];
    if (wordsSeen + words.length <= limit) {
      lines.push(line);
      wordsSeen += words.length;
      continue;
    }
    const remaining = limit - wordsSeen;
    if (remaining > 0) lines.push(words.slice(0, remaining).join(' '));
    lines.push('[...truncated to compaction word limit]');
    break;
  }
  return lines.join('\n').trim();
}

function getRollingCompactionProgress(
  session: any,
  incomingUserMsg?: { role: 'user'; content: string; timestamp: number },
): { nonSummarySinceCheckpoint: number; candidateNonSummaryMessages: Array<any> } {
  const history = Array.isArray(session?.history) ? session.history : [];
  const candidateHistory = incomingUserMsg ? [...history, incomingUserMsg] : [...history];
  const checkpointRaw = Number((session as any)?.contextStartIndex);
  const checkpoint = Number.isFinite(checkpointRaw)
    ? Math.max(0, Math.min(Math.floor(checkpointRaw), candidateHistory.length))
    : 0;
  const candidateSinceCheckpoint = candidateHistory.slice(checkpoint);
  const candidateNonSummaryMessages = candidateSinceCheckpoint.filter((msg: any) => !isCompactionSummaryMessage(msg));
  return {
    nonSummarySinceCheckpoint: candidateNonSummaryMessages.length,
    candidateNonSummaryMessages,
  };
}

function buildFallbackCompactionSummary(previousSummary: string, recentWindow: Array<any>, maxWords: number): string {
  const lines: string[] = [];
  lines.push('1. Primary Request and Intent:');
  lines.push(previousSummary ? previousSummary.replace(/\s+/g, ' ').trim().slice(0, 2400) : 'Unknown');
  lines.push('2. Key Technical Concepts:');
  lines.push('Unknown');
  lines.push('3. Files and Code Sections:');
  lines.push('Unknown');
  lines.push('4. Errors, Fixes, and Test Results:');
  lines.push('Unknown');
  lines.push('5. Problem Solving and Decisions:');
  lines.push('Unknown');
  lines.push('6. Recent User Messages:');
  const newestFirst = [...recentWindow].reverse().slice(0, 10);
  for (const msg of newestFirst) {
    const role = String(msg.role || 'unknown');
    const rawContent = Array.isArray(msg.content)
      ? msg.content.map((part: any) => part?.type === 'text' ? String(part.text || '') : '[image]').join(' ')
      : String(msg.content || '');
    const body = rawContent.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (body) lines.push(`- ${role}: ${body}`);
  }
  if (newestFirst.length === 0) lines.push('None yet.');
  lines.push('7. Pending Tasks:');
  lines.push('Unknown');
  lines.push('8. Current Work:');
  lines.push('Continue from the latest available message and preserve user-owned changes.');
  lines.push('9. Recovery Artifacts:');
  lines.push('Unknown');
  lines.push('10. Continue From Here:');
  lines.push('Resume directly from the latest user request. Do not recap this summary to the user unless they ask. Prioritize the latest task and continue naturally as if no compaction happened.');
  return boundCompactionSummaryWords(lines.join('\n'), maxWords);
}

interface ContextCompactorRunInput {
  sessionId: string;
  strategy: 'rolling_window' | 'mid_workflow_token_budget';
  targetLengthText: string;
  maxWords: number;
  previousSummary: string;
  recentMessagesBlock: string;
  recentToolLogsBlock: string;
  reasoningTrailBlock: string;
  artifactPathsBlock: string;
  recentWindow: Array<any>;
  numCtx: number;
  numPredict: number;
  model?: string;
  abortSignal?: { aborted: boolean; signal?: AbortSignal };
  recordMeta: Record<string, any>;
}

function buildContextCompactionPrompt(input: ContextCompactorRunInput): string {
  const modeDescription = input.strategy === 'mid_workflow_token_budget'
    ? 'This compaction is happening mid-workflow between tool rounds because the active model context budget is near its limit.'
    : 'This compaction is happening at a rolling conversation checkpoint after enough new messages accumulated.';
  const promptLines: string[] = [
    'Create a structured rolling resume packet for context compaction.',
    `Target length: ${input.targetLengthText}.`,
    modeDescription,
    'This summary will be injected into a future model context so it can continue the same work after older messages are dropped.',
    'Write it like a handoff/resume note, not like a user-facing recap.',
    'Preserve concrete implementation state, decisions, eliminated branches, file paths, function/class names, command/test results, blockers, approvals/pending waits, user preferences, and the newest user request.',
    'When a reasoning/thinking trail is provided, use it to capture durable analysis: hypotheses tested, files or searches ruled out, planned next steps, and conclusions reached from tool results. Do not copy raw stream-of-consciousness verbatim.',
    'Keep the order below and include every section. Use concise bullets under each section. If a section has no known details, write "Unknown" or "None yet."',
    'Do not invent details. Do not include generic advice. Output plain text only.',
    '',
    'Required format:',
    '1. Primary Request and Intent:',
    '2. Key Technical Concepts:',
    '3. Files and Code Sections:',
    '4. Errors, Fixes, and Test Results:',
    '5. Problem Solving and Decisions:',
    '6. Recent User Messages:',
    '7. Pending Tasks:',
    '8. Current Work:',
    '9. Recovery Artifacts:',
    '10. Continue From Here:',
    'In "Continue From Here", explicitly instruct the next assistant to resume directly, avoid recapping the summary to the user, prioritize the latest task, protect user-owned changes, and continue naturally as if no compaction happened.',
    '',
    '[PREVIOUS_SUMMARY]',
    input.previousSummary || '(none)',
    '',
    '[RECOVERY_ARTIFACT_PATHS]',
    input.artifactPathsBlock || '(none)',
    '',
    '[RECENT_MESSAGES newest->oldest]',
    input.recentMessagesBlock || '(none)',
    '',
    '[RECENT_TOOL_OBSERVATIONS newest->oldest]',
    input.recentToolLogsBlock || '(none)',
    '',
    '[RECENT_REASONING_AND_DECISIONS]',
    input.reasoningTrailBlock || '(none)',
  ];
  return promptLines.join('\n');
}

async function runContextCompactor(input: ContextCompactorRunInput): Promise<{ compacted: boolean; summaryText?: string; mode?: 'llm' | 'fallback' }> {
  const session = getSession(input.sessionId);
  const prompt = buildContextCompactionPrompt(input);
  try {
    const compactResult = await getOllamaClient().chatWithThinking(
      [
        {
          role: 'system',
          content: 'You are ContextCompactor. You only produce a faithful rolling summary for context retention. No tools, no chatter.',
        },
        { role: 'user', content: prompt },
      ],
      'manager',
      {
        temperature: 0.1,
        num_ctx: input.numCtx,
        num_predict: input.numPredict,
        ...(input.model ? { model: input.model } : {}),
        usageContext: { sessionId: input.sessionId, agentId: 'context_compactor' },
      },
    );

    if (input.abortSignal?.aborted) return { compacted: false };

    const rawSummary = String(compactResult?.message?.content || '');
    const summary = String(stripExplicitThinkTags(rawSummary)?.cleaned || '').trim() || input.previousSummary;
    const boundedSummary = boundCompactionSummaryWords(summary, input.maxWords).slice(0, 12000).trim();
    if (!boundedSummary) return { compacted: false };

    recordSessionCompaction(input.sessionId, 'rolling', boundedSummary, session.history.length, {
      ...input.recordMeta,
      strategy: input.strategy,
      mode: 'llm',
    });
    return { compacted: true, summaryText: boundedSummary, mode: 'llm' };
  } catch (err: any) {
    console.warn(`[v2] Context compaction failed (${input.strategy}):`, err?.message || err);
    const fallbackSummary = buildFallbackCompactionSummary(input.previousSummary, input.recentWindow, input.maxWords);
    if (!fallbackSummary) return { compacted: false };
    try {
      recordSessionCompaction(input.sessionId, 'rolling', fallbackSummary, session.history.length, {
        ...input.recordMeta,
        strategy: input.strategy,
        mode: 'fallback',
      });
      return { compacted: true, summaryText: fallbackSummary, mode: 'fallback' };
    } catch (fallbackErr: any) {
      console.warn(`[v2] Context compaction fallback failed (${input.strategy}):`, fallbackErr?.message || fallbackErr);
      return { compacted: false };
    }
  }
}

async function maybeRunRollingCompaction(
  sessionId: string,
  incomingUserMsg: { role: 'user'; content: string; timestamp: number },
  abortSignal?: { aborted: boolean; signal?: AbortSignal },
): Promise<{ compacted: boolean; summaryText?: string; mode?: 'llm' | 'fallback' }> {
  const policy = resolveRollingCompactionPolicy();
  if (!policy.enabled) return { compacted: false };
  const session = getSession(sessionId);
  const { nonSummarySinceCheckpoint, candidateNonSummaryMessages } = getRollingCompactionProgress(session, incomingUserMsg);
  if (nonSummarySinceCheckpoint < policy.messageCount) return { compacted: false };

  const recentWindow = candidateNonSummaryMessages.slice(-policy.messageCount);
  const previousSummary = String((session as any).latestContextSummary || '').trim()
    || extractLastCompactionSummary(session.history || []);
  return runContextCompactor({
    sessionId,
    strategy: 'rolling_window',
    targetLengthText: `<= ${policy.summaryMaxWords} words`,
    maxWords: policy.summaryMaxWords,
    previousSummary,
    recentMessagesBlock: formatCompactionMessages(recentWindow),
    recentToolLogsBlock: getRecentToolObservationsForContext(sessionId, policy.toolTurns, 12000)
      || formatCompactionToolLogs(recentWindow, policy.toolTurns),
    reasoningTrailBlock: '',
    artifactPathsBlock: formatCompactionArtifactPaths(sessionId),
    recentWindow,
    numCtx: resolveCompactionNumCtx(),
    numPredict: Math.max(900, Math.min(2600, Math.ceil(policy.summaryMaxWords * 1.8))),
    model: policy.model || undefined,
    abortSignal,
    recordMeta: {
      message_window: policy.messageCount,
      tool_turn_window: policy.toolTurns,
      summary_max_words: policy.summaryMaxWords,
    },
  });
}

async function maybeRunMidWorkflowCompaction(input: {
  sessionId: string;
  messages: Array<any>;
  toolResults: ToolResult[];
  reasoningTrail?: string;
  sendSSE: (event: string, data: any) => void;
  abortSignal?: { aborted: boolean; signal?: AbortSignal };
  reasonHint?: string;
}): Promise<{ compacted: boolean; summaryText?: string; projectedTokens: number; triggerTokens: number }> {
  const cfg = (getConfig().getConfig() as any)?.session || {};
  if (cfg?.rollingCompactionEnabled === false) return { compacted: false, projectedTokens: 0, triggerTokens: 0 };
  const profile = resolveActiveModelContextProfile();
  const budget = buildContextBudget(profile);
  // Correct the raw model-tokenizer estimate toward real provider input-token
  // counts so the mid-workflow trigger fires at the same effective fullness the
  // provider actually sees. Clamped + default-1.0 until enough samples exist.
  const calibrationFactor = getUsageCalibration(profile.providerId, profile.model).factor || 1;
  const projectedBreakdown = estimateMessageTokenBreakdownForModel(input.messages, profile);
  const projectedTokens = Math.round(projectedBreakdown.totalTokens * calibrationFactor);
  const recentToolText = formatCompactionToolResults(input.sessionId, input.toolResults, 8);
  const reasoningTrailText = formatCompactionReasoningTrail(input.reasoningTrail || '');
  const recentToolTokens = Math.round(estimateTextTokensForModel(recentToolText, profile.tokenizer) * calibrationFactor);
  const shouldCompact = projectedTokens >= budget.compactionTriggerTokens
    || recentToolTokens >= budget.toolContextBudgetTokens;
  if (!shouldCompact) return { compacted: false, projectedTokens, triggerTokens: budget.compactionTriggerTokens };

  const reason = projectedTokens >= budget.compactionTriggerTokens
    ? 'projected_context_over_budget'
    : 'tool_context_over_budget';
  input.sendSSE('tool_call', {
    action: CONTEXT_COMPACTION_TOOL_NAME,
    args: {
      phase: 'start',
      mode: 'mid_workflow',
      reason: input.reasonHint || reason,
      projected_tokens: projectedTokens,
      trigger_tokens: budget.compactionTriggerTokens,
      input_budget_tokens: budget.inputBudgetTokens,
      context_window_tokens: profile.contextWindowTokens,
      provider: profile.providerId,
      model: profile.model,
      message_count: projectedBreakdown.messageCount,
      token_breakdown: projectedBreakdown.byRole,
      largest_messages: projectedBreakdown.largestMessages,
      recent_tool_observation_tokens: recentToolTokens,
      tool_context_budget_tokens: budget.toolContextBudgetTokens,
    },
    synthetic: true,
    actor: 'system',
  });

  const systemMessage = input.messages.find((m) => m?.role === 'system');
  const nonSystemMessages = input.messages.filter((m) => m?.role !== 'system');
  const recentWindow = nonSystemMessages.slice(-18);
  const session = getSession(input.sessionId);
  const previousSummary = String((session as any).latestContextSummary || '').trim()
    || extractLastCompactionSummary(session.history || []);
  const summaryMaxTokens = Math.max(700, Math.min(2400, budget.summaryBudgetTokens));
  const summaryMaxWords = Math.max(220, Math.min(1500, Math.ceil(summaryMaxTokens / 1.3)));

  try {
    const compactorResult = await runContextCompactor({
      sessionId: input.sessionId,
      strategy: 'mid_workflow_token_budget',
      targetLengthText: `about ${summaryMaxTokens} tokens or less`,
      maxWords: summaryMaxWords,
      previousSummary,
      recentMessagesBlock: formatCompactionMessages(recentWindow),
      recentToolLogsBlock: recentToolText,
      reasoningTrailBlock: reasoningTrailText,
      artifactPathsBlock: formatCompactionArtifactPaths(input.sessionId),
      recentWindow,
      numCtx: Math.min(profile.contextWindowTokens, Math.max(4096, budget.inputBudgetTokens)),
      numPredict: Math.max(900, Math.min(2600, Math.ceil(summaryMaxTokens * 1.2))),
      model: String(cfg?.rollingCompactionModel || '').trim() || undefined,
      abortSignal: input.abortSignal,
      recordMeta: {
        reason,
        projected_tokens: projectedTokens,
        trigger_tokens: budget.compactionTriggerTokens,
        input_budget_tokens: budget.inputBudgetTokens,
        context_window_tokens: profile.contextWindowTokens,
        provider: profile.providerId,
        model: profile.model,
        tool_result_count: input.toolResults.length,
        reasoning_trail_chars: reasoningTrailText.length,
        summary_max_words: summaryMaxWords,
      },
    });
    if (!compactorResult.compacted || !compactorResult.summaryText) {
      return { compacted: false, projectedTokens, triggerTokens: budget.compactionTriggerTokens };
    }
    const boundedSummary = compactorResult.summaryText;

    input.messages.splice(0, input.messages.length);
    if (systemMessage) input.messages.push(systemMessage);
    input.messages.push({
      role: 'assistant',
      content: `[Rolling context summary]\n${boundedSummary}`,
    });
    input.messages.push({
      role: 'user',
      content: 'Context was compacted mid-workflow. Continue the active task directly from the summary above; do not recap the compaction to the user.',
    });

    const newProjectedBreakdown = estimateMessageTokenBreakdownForModel(input.messages, profile);
    const newProjectedTokens = newProjectedBreakdown.totalTokens;
    input.sendSSE('tool_result', {
      action: CONTEXT_COMPACTION_TOOL_NAME,
      result: `Thread compacted mid-workflow. Continuing with ${newProjectedTokens}/${budget.inputBudgetTokens} estimated input tokens.`,
      error: false,
      synthetic: true,
      actor: 'system',
      extra: {
        phase: 'result',
        status: 'compacted',
        mode: 'mid_workflow',
        summary_mode: compactorResult.mode || 'llm',
        reason,
        summary: boundedSummary,
        projected_tokens_before: projectedTokens,
        projected_tokens_after: newProjectedTokens,
        input_budget_tokens: budget.inputBudgetTokens,
        context_window_tokens: profile.contextWindowTokens,
        provider: profile.providerId,
        model: profile.model,
        token_breakdown_after: newProjectedBreakdown.byRole,
        largest_messages_after: newProjectedBreakdown.largestMessages,
      },
    });
    return { compacted: true, summaryText: boundedSummary, projectedTokens, triggerTokens: budget.compactionTriggerTokens };
  } catch (err: any) {
    console.warn('[v2] Mid-workflow compaction failed:', err?.message || err);
    input.sendSSE('tool_result', {
      action: CONTEXT_COMPACTION_TOOL_NAME,
      result: `Thread compaction failed; continuing with bounded context. ${String(err?.message || err || '').slice(0, 300)}`,
      error: false,
      synthetic: true,
      actor: 'system',
      extra: {
        phase: 'result',
        status: 'failed',
        mode: 'mid_workflow',
        projected_tokens: projectedTokens,
        input_budget_tokens: budget.inputBudgetTokens,
      },
    });
    return { compacted: false, projectedTokens, triggerTokens: budget.compactionTriggerTokens };
  }
}

async function handleChat(
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean; signal?: AbortSignal },
  callerContext?: string,
  modelOverride?: string,
  executionMode: ExecutionMode = 'interactive',
  toolFilter?: string[],  // Piece 2: optional allowlist (supports wildcards like browser_*)
  attachments?: Array<{ base64: string; mimeType: string; name: string }>,
  reasoningOptions?: ReasoningOptions,
  providerOverride?: string,
  /**
   * Optional secondary token-stream sink. Receives every visible-text token
   * delta in addition to the standard sendSSE('token') broadcast. Used by
   * channel adapters (Telegram, etc.) to feed the BlockChunker for paragraph-
   * sized bubble splitting. Errors thrown by this callback are swallowed.
   */
  callerOnToken?: (token: string) => void,
  runtimeOptions?: { directSubagentChat?: boolean; excludedSkillIds?: string[]; forcedSkillIds?: string[] },
): Promise<HandleChatResult> {
  try {
  const latencyStartAt = Date.now();
  let firstProviderEventAt = 0;
  let firstVisibleTokenAt = 0;
  let firstReasoningAt = 0;
  const markLatency = (stage: string, extra: Record<string, any> = {}) => {
    const now = Date.now();
    const elapsedMs = now - latencyStartAt;
    try {
      sendSSE('latency_mark', {
        stage,
        elapsedMs,
        message: `Latency: ${stage} at ${elapsedMs}ms`,
        ...extra,
      });
    } catch {}
    return now;
  };
  const ollama = getOllamaClient();
  const isDirectSubagentChatTurn = runtimeOptions?.directSubagentChat === true;
  const excludedSkillIds = Array.isArray(runtimeOptions?.excludedSkillIds)
    ? runtimeOptions.excludedSkillIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const forcedSkillIds = Array.isArray(runtimeOptions?.forcedSkillIds)
    ? runtimeOptions.forcedSkillIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const isBootStartupTurn = /\bBOOT\.md\b/i.test(String(callerContext || ''));
  const isHotRestartTurn = /\[HOT RESTART CONTEXT\]/i.test(String(callerContext || ''));
  const bootAllowedTools = new Set(['list_files', 'read_file']);
  const configuredWorkspace = getConfig().getWorkspacePath();
  const sessionWorkspace = getWorkspace(sessionId);
  // Scoped execution workspaces (set by team dispatch, cron scheduler, etc.) take
  // priority over the global config path. For normal interactive chat, the current
  // launcher/config remains authoritative so stale persisted sessions cannot keep
  // a dev run bound to an old AppData/legacy workspace or vice versa.
  const workspacePath = shouldUseSessionWorkspace(executionMode, sessionWorkspace)
    ? sessionWorkspace
    : configuredWorkspace;
  if (workspacePath && sessionWorkspace !== workspacePath) {
    setWorkspace(sessionId, workspacePath);
  }
  const rawSendSSE = sendSSE;
  const callerContextText = String(callerContext || '');
  const voiceAgentHandoffActive = /\[VOICE_AGENT_HANDOFF\]/i.test(callerContextText);
  const voiceNarrator = voiceAgentHandoffActive ? createVoiceNarrator(sessionId, message, (data) => {
    rawSendSSE('voice_milestone', data);
    mirrorSessionChatEvent(sessionId, 'voice_milestone', data, broadcastWS);
  }, abortSignal?.signal, {
    suppressTaskStartFallback: voiceAgentHandoffActive,
  }) : null;
  sendSSE = (event: string, data: any) => {
    rawSendSSE(event, data);
    mirrorSessionChatEvent(sessionId, event, data, broadcastWS);
    try { voiceNarrator?.observe(event, data); } catch (err: any) {
      console.warn('[voice narrator] failed:', err?.message || err);
    }
  };
  sendSSE('ui_preflight', { message: 'Preparing Prometheus runtime...' });
  __htimeReset(); htime('handleChat: after Preparing Prometheus runtime');
  const isHandleChatGoalContinuation = isMainChatGoalContinuation(message);
  const handleChatGoalPolicy = isHandleChatGoalContinuation ? resolveMainChatGoalPolicy() : null;
  const handleChatGoalExecutionPolicy = isHandleChatGoalContinuation ? {
    mode: 'goal_autonomous' as const,
    approvalMode: handleChatGoalPolicy?.permissions.approvalMode || 'never' as const,
    hardDeny: handleChatGoalPolicy?.permissions.hardDenyEnabled !== false,
  } : undefined;
  const buildExecuteToolDeps = (): any => ({
    cronScheduler: _cronScheduler,
    handleChat,
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
    sendSSE,
    executionPolicy: handleChatGoalExecutionPolicy,
    onHardToolDeny: (event: any) => {
      if (!isHandleChatGoalContinuation) return;
      const updated = recordMainChatGoalDeniedAction(sessionId, {
        toolName: event.toolName,
        category: event.decision?.category,
        reason: event.decision?.reason,
        safeAlternative: event.decision?.safeAlternative,
      });
      broadcastMainChatGoalState(sessionId, 'policy_denied', { goal: updated, denial: event.decision, toolName: event.toolName });
    },
  });
  const finalizeBoundTaskRun = (status: 'complete' | 'failed', summary: string) => {
    const binding = getTaskRunBinding(sessionId);
    if (!binding?.taskId) return;
    const text = String(summary || '').trim();
    if (status === 'complete') {
      completeNextOpenTaskStep(binding.taskId, text.slice(0, 200));
    }
    updateTaskStatus(binding.taskId, status, { finalSummary: text });
    appendJournal(binding.taskId, {
      type: status === 'complete' ? 'status_push' : 'error',
      content: `${status === 'complete' ? 'Done' : 'Failed'}: ${text.slice(0, 240)}`,
      detail: text.slice(0, 2000),
    });
    broadcastWS({ type: status === 'complete' ? 'task_complete' : 'task_failed', taskId: binding.taskId, summary: text });
    broadcastWS({ type: 'task_panel_update', taskId: binding.taskId });
    clearTaskRunBinding(sessionId, binding.taskId);
  };
  console.log(`[v2] SESSION: ${sessionId} | Workspace: ${workspacePath}`);
  htime('after buildExecuteToolDeps/finalizeBoundTaskRun closures');
  const creativeMode = executionMode === 'interactive' ? getCreativeMode(sessionId) : null;
  const effectiveMaxToolRounds = resolveEffectiveMaxToolRounds(MAX_TOOL_ROUNDS, {
    creativeMode,
    executionMode,
    message,
  });
  const activeHistoryMessageCount = resolveRollingCompactionPolicy().messageCount;
  htime('before getHistoryForApiCall');
  const rawHistory = executionMode === 'cron'
    ? []
    : getHistoryForApiCall(sessionId, Math.ceil(activeHistoryMessageCount / 2), { maxMessages: activeHistoryMessageCount });
  htime('after getHistoryForApiCall');
  const normalizedIncomingMessage = String(message || '').replace(/\s+/g, ' ').trim();
  // runInteractiveTurn persists the incoming user turn before calling handleChat.
  // Keep persisted storage unchanged, but avoid sending that same turn twice to the model.
  const history = rawHistory.length > 0
    && rawHistory[rawHistory.length - 1]?.role === 'user'
    && String(rawHistory[rawHistory.length - 1]?.content || '').replace(/\s+/g, ' ').trim() === normalizedIncomingMessage
      ? rawHistory.slice(0, -1)
      : rawHistory;
  autoActivateToolCategories(sessionId, message, history.length);
  // Build a compact tool-state summary from recent assistant turns. Full raw
  // observations stay out-of-band for Hub/debugging instead of prompt context.
  const activeContextProfile = resolveActiveModelContextProfile();
  const activeContextBudget = buildContextBudget(activeContextProfile);
  const recentToolLogMaxChars = Math.max(1000, Math.min(2200, activeContextBudget.toolContextBudgetTokens * 2));
  htime('before getRecentToolObservationsForContext');
  const recentToolLog = executionMode === 'cron' ? '' : getRecentToolObservationsForContext(sessionId, 3, recentToolLogMaxChars, true);
  htime('after getRecentToolObservationsForContext');
  const inferReferenceImageMimeType = (filePath: string): string => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return 'image/png';
  };
  const resolveReferenceImagePath = (rawPath: string): string | null => {
    const value = String(rawPath || '').trim();
    if (!value) return null;
    const absPath = path.isAbsolute(value) ? value : path.resolve(workspacePath, value);
    try {
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return absPath;
    } catch {
      return null;
    }
    return null;
  };
  const buildCreativeReferenceVisionMessage = (): any | null => {
    if (!creativeMode || !currentModelCapabilities.hasVision) return null;
    const refs = getCreativeReferences(sessionId);
    const images: Array<{ path: string; label: string; mimeType: string; base64: string }> = [];
    for (const ref of refs) {
      const candidates = ref.selectedFrames.length > 0
        ? ref.selectedFrames
        : (ref.kind === 'image' && ref.path ? [ref.path] : []);
      for (const candidate of candidates.slice(0, 4)) {
        const absPath = resolveReferenceImagePath(candidate);
        if (!absPath) continue;
        try {
          images.push({
            path: candidate,
            label: `${ref.kind} ${ref.authority} ${ref.intent}`,
            mimeType: inferReferenceImageMimeType(absPath),
            base64: fs.readFileSync(absPath).toString('base64'),
          });
        } catch {
          // Skip unreadable reference frames; the text path remains in the prompt.
        }
        if (images.length >= 10) break;
      }
      if (images.length >= 10) break;
    }
    if (!images.length) return null;
    return {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `[CREATIVE_REFERENCE_FRAME_OBSERVATION]\n` +
            `These are saved reference images/frames from this chat session. Use direct visual perception of them as style, pacing, composition, typography, UI, and motion-direction evidence before creating or revising the active Creative ${creativeMode} work.\n` +
            images.map((image, index) => `#${index + 1} ${image.label}: ${image.path}`).join('\n'),
        },
        ...images.map((image) => buildVisionImagePart(image.base64, image.mimeType)),
      ],
    };
  };
  // Build full tool list after applying session-scoped category activation.
  // Category activation mutates session state, so this is rebound inside a turn.
  // Telegram sessions: hide start_task so the model never tries to background-task anything.
  // Telegram runs inline (interactive mode) and the background task path has broken tool-arg
  // serialisation that causes browser_open to receive JSON strings instead of objects.
  const isTelegramSessionForTools = String(sessionId || '').startsWith('telegram_');
  // Runtime subagents inherit the same category activation behavior as main chat.
  // Only the legacy recursive start_task guard remains.
  const isBackgroundOrSubagentMode = executionMode === 'background_task' || executionMode === 'proposal_execution' || executionMode === 'background_agent' || executionMode === 'cron' || executionMode === 'team_manager' || executionMode === 'team_subagent';
  const isProposalExecutionMode = executionMode === 'proposal_execution';
  // Tools always stripped from background/subagent runs.
  const alwaysStrip = new Set(isBackgroundOrSubagentMode ? ['start_task'] : []);
  const guaranteedAutonomousCoreTools = new Set<string>([
    ...(isBackgroundOrSubagentMode ? ['write_note'] : []),
  ]);
  // write_note is a core runtime tool and must stay available in interactive chat.
  // Prompt context and tool docs already instruct the model when to skip it.
  const interactiveStrip = new Set<string>();
	  const effectiveToolFilter = toolFilter;
  let currentModelCapabilities = resolvePrimaryModelCapabilities({
    providerId: providerOverride,
    model: modelOverride,
  });
  const VISION_ONLY_TOOL_NAMES = new Set([
    'browser_vision_screenshot',
    'browser_vision_click',
    'browser_vision_type',
    'analyze_image',
    'analyze_video',
    'video_analyze_frame',
    'video_analyze_imported_video',
  ]);
  const isVisionToolName = (name: string): boolean => VISION_ONLY_TOOL_NAMES.has(name);
  const filterToolsForModelCapabilities = (toolDefs: any[]): any[] => {
    if (currentModelCapabilities.hasVision) return toolDefs;
    return toolDefs.filter((t: any) => !isVisionToolName(String(t?.function?.name || '')));
  };
  const buildCurrentTurnBaseTools = (categoryOverride?: Set<string>): any[] => {
	    const allBuiltTools = categoryOverride
        ? _buildTools({ getMCPManager }, categoryOverride)
        : buildTools(sessionId);
	    return isBootStartupTurn
	      ? allBuiltTools.filter((t: any) => bootAllowedTools.has(String(t?.function?.name || '')))
	      : isHotRestartTurn
	        ? []
	      : effectiveToolFilter && effectiveToolFilter.length > 0
	        ? allBuiltTools.filter((t: any) => {
	            const tName = String(t?.function?.name || '');
	            if (alwaysStrip.has(tName)) return false;
	            if (interactiveStrip.has(tName)) return false;
	            if (guaranteedAutonomousCoreTools.has(tName)) return true;
	            return effectiveToolFilter.some(pattern => {
	              if (pattern.endsWith('*')) return tName.startsWith(pattern.slice(0, -1));
	              return tName === pattern;
	            });
          })
        : isTelegramSessionForTools || isBackgroundOrSubagentMode
          ? allBuiltTools.filter((t: any) => !alwaysStrip.has(String(t?.function?.name || '')) && String(t?.function?.name || '') !== 'start_task')
          : allBuiltTools.filter((t: any) => !interactiveStrip.has(String(t?.function?.name || '')));
  };
  let loopGateToolActive = false;
  const LOOP_CONTINUE_TOOL_DEF = {
    type: 'function',
    function: {
      name: 'tool_loop_continue',
      description:
        'Acknowledge Prometheus loop-detector gates when repeated identical tool calls are intentional. This tool is exposed only after the loop detector warns or gates a repeated call. Use it only when the user task truly requires continuing, such as bulk setup of scheduled jobs. Pass the exact blocked tool name, the exact args object you need to repeat, and a concrete reason; then retry the original tool call.',
      parameters: {
        type: 'object',
        required: ['tool_name', 'args', 'reason'],
        properties: {
          tool_name: { type: 'string', description: 'The exact gated tool name, for example schedule_job.' },
          args: { type: 'object', description: 'The exact arguments object for the gated tool call.' },
          reason: { type: 'string', description: 'Why repeating this exact call is necessary for the user request.' },
        },
      },
    },
  };
  const maybeAddLoopGateTool = (toolDefs: any[]): any[] => {
    if (!loopGateToolActive) return toolDefs;
    if (toolDefs.some((tool: any) => String(tool?.function?.name || '') === 'tool_loop_continue')) return toolDefs;
    return [LOOP_CONTINUE_TOOL_DEF, ...toolDefs];
  };
  let planStepToolsActive = isProposalExecutionMode || sessionId.startsWith('task_');
  const backgroundPlanToolsActive = executionMode === 'background_agent' || sessionId.startsWith('background_');
  const addToolDefIfMissing = (toolDefs: any[], name: string): any[] => {
    if (toolDefs.some((tool: any) => String(tool?.function?.name || '') === name)) return toolDefs;
    const def = getAgentTeamScheduleToolDefByName(name);
    return def ? [def, ...toolDefs] : toolDefs;
  };
  const maybeAddPlanScopedTools = (toolDefs: any[]): any[] => {
    let next = toolDefs;
    if (backgroundPlanToolsActive) {
      next = addToolDefIfMissing(next, 'bg_plan_advance');
      next = addToolDefIfMissing(next, 'bg_plan_declare');
      return next;
    }
    if (planStepToolsActive) {
      next = addToolDefIfMissing(next, 'complete_plan_step');
      if (isProposalExecutionMode || sessionId.startsWith('task_')) {
        next = addToolDefIfMissing(next, 'step_complete');
      }
    }
    return next;
  };
  const PROPOSAL_CORE_MIN = new Set([
    'run_command',
    'read_file', 'read_files_batch', 'create_file', 'replace_lines', 'insert_after', 'delete_lines', 'find_replace', 'apply_patchset',
    'list_files', 'list_directory', 'mkdir', 'file_stats', 'validate_file', 'grep_file', 'grep_files', 'search_files',
    'write_note',
    'memory_search', 'memory_read_record', 'memory_search_project', 'memory_search_timeline', 'memory_get_related', 'memory_graph_snapshot',
    'task_control',
    'declare_plan', 'complete_plan_step', 'step_complete',
    'request_tool_category',
    'business_context_mode',
    'connector_list',
    'switch_model',
    'set_current_model',
    ...(!isPublicDistributionBuild() ? [
      'read_source', 'read_dev_sources', 'apply_dev_source_patchset', 'list_source', 'grep_source', 'source_stats', 'src_stats', 'validate_source',
      'read_webui_source', 'list_webui_source', 'grep_webui_source', 'webui_source_stats', 'webui_stats', 'validate_webui_source',
      'list_prom', 'prom_file_stats', 'validate_prom_file', 'read_prom_file', 'grep_prom',
    ] : []),
  ]);
  const buildCurrentTurnTools = (categoryOverride?: Set<string>): any[] => {
    const baseTools = buildCurrentTurnBaseTools(categoryOverride);
    let currentTools = isProposalExecutionMode
      ? baseTools.filter((t: any) => {
        const tName = String(t?.function?.name || '');
        if (!tName || tName === 'write_proposal') return false;
        const category = getToolCategory(tName);
        if (category === null) return PROPOSAL_CORE_MIN.has(tName);
        return true; // Category tools are still governed by per-session activation.
      })
      : baseTools;
    return maybeAddLoopGateTool(maybeAddPlanScopedTools(filterToolsForModelCapabilities(currentTools)));
  };
  const buildSwitchModelToolCategories = (): Set<string> => {
    const switchCategories = new Set<string>();
    if (browserVisionModeActive) {
      switchCategories.add('browser_automation');
      switchCategories.add('browser');
    }
    return switchCategories;
  };
  const buildToolsForGeneration = (generationOverride: any): any[] => {
    const categoryOverride = generationOverride.source === 'turn_override'
      ? buildSwitchModelToolCategories()
      : undefined;
    return buildCurrentTurnTools(categoryOverride);
  };
  const summarizeToolSurface = (toolDefs: any[]) => {
    const byCategory: Record<string, number> = {};
    for (const tool of toolDefs) {
      const name = String(tool?.function?.name || '');
      const category = getToolCategory(name) || 'core';
      byCategory[category] = (byCategory[category] || 0) + 1;
    }
    return {
      total: toolDefs.length,
      activeCategories: Array.from(getActivatedToolCategories(sessionId)).sort(),
      byCategory: Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b))),
    };
  };
  const toolNameOf = (tool: any): string => String(tool?.function?.name || '').trim();
  const PRIORITY_TOOL_NAMES = new Set([
    'write_note',
    'request_tool_category',
    'switch_model',
    'set_current_model',
    'get_agent_models',
    'task_control',
    'declare_plan',
    'complete_plan_step',
    'step_complete',
    'delivery_send',
    'delivery_send_screenshot',
    'connector_list',
    'business_context_mode',
    'memory_search',
    'memory_read_record',
    'time_now',
  ]);
  const LEAN_WRITE_NOTE_SWITCH_TOOLS = new Set([
    ...Array.from(PRIORITY_TOOL_NAMES),
    'send_telegram',
  ]);
  const shouldUseLeanWriteNoteSwitchTools = (generationOverride: any): boolean => {
    if (generationOverride?.source !== 'turn_override') return false;
    if (String(generationOverride?.tier || '').trim().toLowerCase() !== 'low') return false;
    const reason = String(generationOverride?.reason || '').trim().toLowerCase();
    if (!/(^|[^a-z])write[_\s-]?note([^a-z]|$)|(^|[^a-z])note([^a-z]|$)|remember|memory/.test(reason)) return false;
    if (/(command|shell|terminal|browser|desktop|file|search|lookup|read|analy[sz]e|creative|video|export|deliver)/.test(reason)) return false;
    return true;
  };
  const maybeLeanToolsForSwitchModel = (toolDefs: any[], generationOverride: any): any[] => {
    if (!shouldUseLeanWriteNoteSwitchTools(generationOverride)) return toolDefs;
    const leanTools = toolDefs.filter((tool: any) => LEAN_WRITE_NOTE_SWITCH_TOOLS.has(toolNameOf(tool)));
    if (!leanTools.some((tool: any) => toolNameOf(tool) === 'write_note')) return toolDefs;
    console.warn('[tools] Lean switch_model write_note surface applied:', {
      providerId: generationOverride.providerId,
      model: generationOverride.model,
      reason: generationOverride.reason,
      before: summarizeToolSurface(toolDefs),
      after: summarizeToolSurface(leanTools),
    });
    return leanTools;
  };
  const providerToolLimit = (providerId: string): number | null => {
    const provider = String(providerId || '').trim().toLowerCase();
    if (provider === 'xai') return 200;
    return null;
  };
  const capToolsForProvider = (toolDefs: any[], generationOverride: any): any[] => {
    const cfg = getConfig().getConfig() as any;
    const activeProvider = String(cfg?.llm?.provider || '').trim();
    const providerId = String(generationOverride.providerId || providerOverride || activeProvider || '').trim().toLowerCase();
    const limit = providerToolLimit(providerId);
    toolDefs = maybeLeanToolsForSwitchModel(toolDefs, generationOverride);
    if (!limit || toolDefs.length <= limit) return toolDefs;

    const selected: any[] = [];
    const seen = new Set<string>();
    const add = (tool: any): void => {
      const name = toolNameOf(tool);
      if (!name || seen.has(name) || selected.length >= limit) return;
      selected.push(tool);
      seen.add(name);
    };

    for (const tool of toolDefs) {
      const name = toolNameOf(tool);
      if (PRIORITY_TOOL_NAMES.has(name)) add(tool);
    }
    for (const tool of toolDefs) add(tool);

    const dropped = toolDefs.length - selected.length;
    const droppedTools = toolDefs
      .map(toolNameOf)
      .filter((name) => name && !seen.has(name));
    console.warn(`[tools] Capped ${providerId} tool payload from ${toolDefs.length} to ${selected.length}; dropped ${dropped} tools to respect provider limit ${limit}.`, {
      before: summarizeToolSurface(toolDefs),
      after: summarizeToolSurface(selected),
      droppedTools: droppedTools.slice(0, 80),
      droppedToolCount: droppedTools.length,
    });
    sendSSE('info', {
      message: `Tool surface capped for ${providerId}: ${toolDefs.length} -> ${selected.length} to fit provider limits.`,
    });
    return selected;
  };
  let tools: any[] = [];
  const allToolResults: ToolResult[] = [];
  let midWorkflowCompactionsThisTurn = 0;
  const turnCanvasFiles = new Set<string>();
  const finalizeSkillGardenerForTurn = (finalResponse: string): string => {
    recordSkillGardenerTurn({
      workspacePath,
      sessionId,
      executionMode,
      request: message,
      finalResponse,
      toolResults: allToolResults,
    });
    return finalResponse;
  };
  let allThinking = '';
  let preflightRoute: 'primary_direct' | 'primary_with_plan' | 'secondary_chat' | 'background_task' | null = null;
  let preflightReasonForTurn = '';
  let continuationNudges = 0;
  const MAX_CONTINUATION_NUDGES = 4;
  let setupFinalizationGuard = 0;
  const MAX_SETUP_FINALIZATION_GUARD = 3;
  let planFinalizationGuard = 0;
  const MAX_PLAN_FINALIZATION_GUARD = 4;
  let writeNoteFinalizationGuard = 0;
  const MAX_WRITE_NOTE_FINALIZATION_GUARD = 1;
  let backgroundFinalizationGuard = 0;
  const MAX_BACKGROUND_FINALIZATION_GUARD = 1;
  const backgroundResultInjectedIds = new Set<string>();
  const orchestrationSkillEnabled = isOrchestrationSkillEnabled();
  const greetingLikeTurn = isGreetingLikeMessage(message);
  const progressState: {
    source: 'none' | 'preflight' | 'tool_sequence' | 'declared';
    items: RuntimeProgressItem[];
    toolsSeen: string[];
    activeIndex: number;
    manualStepAdvance: boolean;
  } = {
    source: 'none',
    items: [],
    toolsSeen: [],
    activeIndex: -1,
    manualStepAdvance: false,
  };

  const emitProgressState = (reason: string) => {
    const payload = {
      source: progressState.source,
      reason,
      activeIndex: progressState.activeIndex,
      total: progressState.items.length,
      items: progressState.items.map((item, index) => ({
        id: item.id,
        index,
        text: item.text,
        status: item.status,
      })),
    };
    sendSSE('progress_state', payload);
    if (isHandleChatGoalContinuation && progressState.source === 'declared' && progressState.items.length >= 2) {
      recordMainChatGoalTurnPlanProgress(sessionId, payload);
    }
  };

  const resolveProviderModelOverride = (): {
    model?: string;
    provider?: any;
    providerId?: string;
    source: 'turn_override' | 'provider_override' | 'model_override' | 'current_primary' | 'config_default' | 'default';
    reason?: string;
    tier?: 'low' | 'medium';
  } => {
    // Highest priority: turn-scoped override set by switch_model tool.
    const turnOverride = getTurnModelOverride(sessionId);
    if (turnOverride?.providerId && turnOverride?.model) {
      try {
        return {
          model: String(turnOverride.model).trim() || undefined,
          provider: buildProviderById(String(turnOverride.providerId).trim()),
          providerId: String(turnOverride.providerId).trim(),
          source: 'turn_override',
          reason: turnOverride.reason,
          tier: turnOverride.tier,
        };
      } catch (err: any) {
        console.warn(`[v2] Failed to apply turn model override provider "${turnOverride.providerId}": ${err.message}`);
      }
    }

    // Next priority: explicit provider override arg (used by some task paths).
    const explicitProviderId = String(providerOverride || '').trim();
    const explicitModel = String(modelOverride || '').trim();
    if (explicitProviderId) {
      try {
        return {
          model: explicitModel || undefined,
          provider: buildProviderById(explicitProviderId),
          providerId: explicitProviderId,
          source: 'provider_override',
        };
      } catch (err: any) {
        console.warn(`[v2] Failed to build explicit provider override "${explicitProviderId}": ${err.message}`);
      }
    }

    // Support modelOverride in "provider/model" format (e.g. "anthropic/claude-haiku-4-5-20251001")
    // without mutating global config.
    if (explicitModel.includes('/')) {
      const parsed = parseProviderModelRef(explicitModel);
      if (parsed) {
        try {
          return {
            model: parsed.model,
            provider: buildProviderById(parsed.providerId),
            providerId: parsed.providerId,
            source: 'model_override',
          };
        } catch (err: any) {
          console.warn(`[v2] Failed to build provider from model override "${parsed.providerId}": ${err.message}`);
        }
      }
    }

    // Interactive chat's current model is the active primary provider/model.
    // agent_model_defaults.main_chat is a route default, not the live model state.
    const cfg = getConfig().getConfig() as any;
    if ((executionMode || 'interactive') === 'interactive') {
      const activeProvider = String(cfg?.llm?.provider || '').trim();
      const activeModel = activeProvider
        ? String(cfg?.llm?.providers?.[activeProvider]?.model || '').trim()
        : '';
      if (activeProvider && activeModel) {
        try {
          return {
            model: activeModel,
            provider: buildProviderById(activeProvider),
            providerId: activeProvider,
            source: 'current_primary',
          };
        } catch (err: any) {
          console.warn(`[v2] Failed to build current primary provider "${activeProvider}": ${err.message}`);
        }
      }
    }

    // Config defaults by execution mode (when no explicit/turn override is active).
    // This keeps per-mode model routing autonomous and stateless for each API call.
    const defaults = cfg?.agent_model_defaults || {};
    const modeKeys = executionMode === 'interactive'
      ? ['main_chat']
      : executionMode === 'background_agent'
        ? ['background_spawn', 'main_chat']
        : executionMode === 'team_manager'
          ? ['team_manager', 'manager']
          : executionMode === 'team_subagent'
            ? ['team_subagent', 'subagent']
            : (executionMode === 'background_task' || executionMode === 'proposal_execution' || executionMode === 'cron')
              ? ['background_task']
              : [];
    let modeKey = '';
    let modeRef = '';
    for (const key of modeKeys) {
      const ref = String(defaults?.[key] || '').trim();
      if (!ref) continue;
      modeKey = key;
      modeRef = ref;
      break;
    }
    if (modeRef) {
      const parsed = parseProviderModelRef(modeRef);
      if (parsed) {
        try {
          return {
            model: parsed.model,
            provider: buildProviderById(parsed.providerId),
            providerId: parsed.providerId,
            source: 'config_default',
          };
        } catch (err: any) {
          console.warn(`[v2] Failed to build provider from ${modeKey} default "${parsed.providerId}": ${err.message}`);
        }
      } else {
        return { model: modeRef, source: 'config_default' };
      }
    }

    return { model: explicitModel || undefined, source: 'default' };
  };

  let currentModelSystemBlock = '';
  const formatCurrentModelSystemBlock = (generationOverride: ReturnType<typeof resolveProviderModelOverride>): string => {
    const cfg = getConfig().getConfig() as any;
    const activeProvider = String(cfg?.llm?.provider || '').trim();
    const providerId = String(generationOverride.providerId || providerOverride || activeProvider || '').trim() || 'configured primary provider';
    const providerCfgModel = activeProvider ? String(cfg?.llm?.providers?.[activeProvider]?.model || '').trim() : '';
    const model = String(generationOverride.model || modelOverride || providerCfgModel || getPrimaryModel() || '').trim() || 'configured primary model';
    return [
      '[CURRENT_MODEL]',
      'This block describes the exact provider/model currently running this AI generation.',
      `provider=${providerId}`,
      `model=${model}`,
      `source=${generationOverride.source}`,
      `execution_mode=${executionMode || 'interactive'}`,
    ].join('\n');
  };
  const resolveCapabilitiesForGenerationOverride = (
    generationOverride: ReturnType<typeof resolveProviderModelOverride>,
  ): ModelCapabilities => {
    const cfg = getConfig().getConfig() as any;
    const activeProvider = String(cfg?.llm?.provider || '').trim();
    const providerId = String(generationOverride.providerId || providerOverride || activeProvider || '').trim();
    const providerCfgModel = providerId ? String(cfg?.llm?.providers?.[providerId]?.model || '').trim() : '';
    const model = String(generationOverride.model || modelOverride || providerCfgModel || getPrimaryModel() || '').trim();
    return resolvePrimaryModelCapabilities({ providerId, model });
  };
  htime('before initial provider/model resolution');
  sendSSE('ui_preflight', { message: 'Selecting model route...' });
  const initialGenerationOverride = resolveProviderModelOverride();
  htime('after initial provider/model resolution');
  currentModelCapabilities = resolveCapabilitiesForGenerationOverride(initialGenerationOverride);
  htime('before initial tool build');
  sendSSE('ui_preflight', { message: 'Loading tool schemas...' });
  tools = capToolsForProvider(buildToolsForGeneration(initialGenerationOverride), initialGenerationOverride);
  htime('after initial tool build');
  sendSSE('ui_preflight', { message: 'Tool schemas ready.' });
  const buildModelCapabilitySystemBlock = (): string => {
    const provider = currentModelCapabilities.provider || 'unknown';
    const model = currentModelCapabilities.model || 'unknown';
    if (currentModelCapabilities.hasVision) {
      return `[MODEL_CAPABILITIES]\nprovider=${provider}\nmodel=${model}\nvision=true\nsource=${currentModelCapabilities.source}`;
    }
    // Non-vision behavior policy lives once, in visualGroundingPolicy (text-first
    // variant) in buildBaseSystemPrompt. Keep this block to the capability flags
    // only to avoid restating the same "don't use vision tools" rule three times.
    return [
      '[MODEL_CAPABILITIES]',
      `provider=${provider}`,
      `model=${model}`,
      'vision=false',
      `source=${currentModelCapabilities.source}`,
    ].join('\n');
  };

  const seedProgressFromLines = (
    lines: string[],
    source: 'preflight' | 'tool_sequence' | 'declared',
    opts?: { manualStepAdvance?: boolean },
  ): boolean => {
    const items = buildProgressItems(lines);
    if (items.length < 2) return false;
    progressState.source = source;
    progressState.items = items;
    progressState.activeIndex = -1;
    progressState.manualStepAdvance = opts?.manualStepAdvance === true;
    if (progressState.manualStepAdvance) {
      planStepToolsActive = true;
    }
    emitProgressState('plan_created');
    return true;
  };

  const isReadOnlyDevPlanStep = (step: string): boolean => {
    const text = String(step || '').toLowerCase();
    return /\b(read|inspect|grep|search|list|locate|review|understand|check|confirm|compare|audit)\b/.test(text)
      && !/\b(edit|patch|replace|write|insert|delete|update|fix|apply|sync|build|verify|test|restart|reload)\b/.test(text);
  };

  const seedDevSourceEditProgressPlan = (toolResult: ToolResult): void => {
    const devPlan = (toolResult as any).extra?.devSourceEdit?.plan || (toolResult as any).data?.devSourceEdit?.plan;
    const completionTag = String(
      (toolResult as any).extra?.devSourceEdit?.completionNoteTag
      || (toolResult as any).data?.devSourceEdit?.completionNoteTag
      || devPlan?.completionNoteTag
      || 'dev_edit_complete',
    ).trim().replace(/\s+/g, '_').toLowerCase();
    const approvedSteps = Array.isArray(devPlan?.steps)
      ? devPlan.steps.map((step: any) => String(step || '').trim()).filter(Boolean)
      : [];
    const executionSteps = approvedSteps.filter((step: string) => !isReadOnlyDevPlanStep(step));
    const devPlanSteps = [
      ...(executionSteps.length ? executionSteps : ['Apply the approved scoped source patch.']),
      'Run the approved verification checks, using prom_apply_dev_changes mode:"verify_only" for Prometheus build/sync checks.',
      'Apply live dev changes with prom_apply_dev_changes mode:"apply_live".',
      `Write completion note with tag "${completionTag}".`,
    ].filter(Boolean).slice(0, 8);
    if (devPlanSteps.length >= 2) {
      seedProgressFromLines(devPlanSteps, 'declared', { manualStepAdvance: true });
      stepCursor = 0;
      consecutiveStepFailures = 0;
    }
  };

  // ── Progress step cursor ───────────────────────────────────────────────────────────
  // stepCursor: the index of the step currently being worked on.
  // It advances by 1 each time a "meaningful" tool call succeeds.
  // Read-only tools (list_files, read_file, web_search, browser_snapshot)
  // do NOT advance the cursor — they are information-gathering within the same step.
  // Write/action tools DO advance the cursor because they represent completing a unit of work.
  let stepCursor = 0;
  // consecutiveFailures: how many times the current step has failed in a row.
  // Resets on any success. Used to stay on the step during retries.
  let consecutiveStepFailures = 0;

  const seedProgressFromStoredGoalPlan = (): boolean => {
    if (!isHandleChatGoalContinuation) return false;
    const goal = snapshotMainChatGoal(sessionId);
    const plans = Array.isArray(goal?.turnPlans) ? [...goal.turnPlans] : [];
    if (!goal || !plans.length) return false;
    const reasonText = [
      goal.lastReason,
      goal.pausedReason,
      goal.failureReason,
    ].map((part: any) => String(part || '').toLowerCase()).join(' ');
    const shouldResumePlan = goal.lastVerdict === 'failed'
      || /\b(interrupted|gateway_restart|gateway_crash|restart|request canceled|request cancelled|canceled|cancelled|abort|aborted|stopped|runtime failure|runtime error)\b/.test(reasonText);
    if (!shouldResumePlan) return false;
    const isOpenPlan = (plan: any) => plan && !['complete', 'blocked'].includes(String(plan.status || '').toLowerCase());
    const nextTurn = Number(goal.turnsUsed || 0) + 1;
    const plan = [...plans].reverse().find((item: any) => Number(item?.turnNumber) === nextTurn && isOpenPlan(item))
      || [...plans].reverse().find((item: any) => Number(item?.turnNumber) === Number(goal.turnsUsed || 0) && isOpenPlan(item))
      || [...plans].reverse().find((item: any) => isOpenPlan(item));
    const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];
    if (!plan || rawSteps.length < 2) return false;
    const items = rawSteps
      .map((step: any, index: number) => {
        const text = String(step?.text || '').trim();
        if (!text) return null;
        const rawStatus = String(step?.status || '').trim().toLowerCase();
        const status = rawStatus === 'done' || rawStatus === 'failed' || rawStatus === 'skipped' || rawStatus === 'in_progress'
          ? rawStatus
          : 'pending';
        return {
          id: String(step?.id || `g${Number(plan.turnNumber) || nextTurn}_s${index + 1}`),
          text,
          status,
        } as RuntimeProgressItem;
      })
      .filter(Boolean) as RuntimeProgressItem[];
    if (items.length < 2) return false;
    let firstOpenIndex = items.findIndex((item) => item.status === 'in_progress' || item.status === 'pending' || item.status === 'failed');
    if (firstOpenIndex < 0) firstOpenIndex = items.length - 1;
    if (items[firstOpenIndex]?.status === 'pending' || items[firstOpenIndex]?.status === 'failed') {
      items[firstOpenIndex].status = 'in_progress';
    }
    progressState.source = 'declared';
    progressState.items = items;
    progressState.activeIndex = firstOpenIndex;
    progressState.manualStepAdvance = true;
    stepCursor = firstOpenIndex;
    consecutiveStepFailures = 0;
    planStepToolsActive = true;
    emitProgressState('goal_plan_resumed');
    return true;
  };
  if (seedProgressFromStoredGoalPlan()) {
    tools = capToolsForProvider(buildToolsForGeneration(initialGenerationOverride), initialGenerationOverride);
  }

  // Tools that gather information — do NOT advance the step cursor.
  const READ_ONLY_PROGRESS_TOOLS = new Set([
    'list_files', 'list_directory', 'read_file', 'read_files_batch', 'read_dev_sources', 'web_search', 'web_fetch',
    'browser_snapshot', 'browser_get_page_text', 'browser_get_focused_item',
    'memory_browse', 'memory_read', 'memory_search', 'memory_read_record', 'memory_search_project', 'memory_search_timeline', 'memory_get_related', 'memory_graph_snapshot',
    'skill_list', 'skill_read',
  ]);

  const SETUP_OR_SCOUT_TOOLS = new Set([
    'skill_list', 'skill_read', 'request_tool_category', 'business_context_mode',
    'list_files', 'list_directory', 'read_file', 'read_files_batch', 'read_dev_sources',
    'path_exists', 'file_stats',
  ]);

  const SUBSTANTIVE_FILE_MUTATION_TOOLS = new Set([
    'create_file', 'write', 'write_file', 'replace_lines', 'find_replace', 'insert_after',
    'delete_lines', 'delete_file', 'apply_patchset', 'request_dev_source_edit',
    // Real build steps and deliverable-producing tools — not setup/scouting.
    // mkdir/copy_file create real artifacts; creative/generation/present/artifact
    // tools produce the actual deliverable (e.g. a demo site, image, video, report card).
    // Including them here stops the setup-finalization guard from misreading a
    // partial or creative build as "setup-only" and forcing a false continuation loop.
    'mkdir', 'copy_file',
    'generate_image', 'generate_video', 'present_file',
    'switch_creative_mode', 'creative_apply_ops', 'creative_add_element',
    'creative_set_canvas', 'creative_create_project', 'creative_import_asset',
    'creative_generate_image_shot', 'creative_generate_video_shot',
    'show_chart', 'show_comparison', 'show_sources', 'show_product_carousel',
  ]);

  const isSetupOrScoutTool = (name: unknown): boolean => SETUP_OR_SCOUT_TOOLS.has(String(name || '').trim());
  const isSubstantiveFileMutationToolName = (name: unknown): boolean => SUBSTANTIVE_FILE_MUTATION_TOOLS.has(String(name || '').trim());
  const userRequestedDurableBuildWork = (): boolean => {
    const text = String(message || '').toLowerCase();
    return /\b(build|create|make|implement|generate|design|code|site|website|page|app|tool|component|fix|edit|update|clone|from screenshot|screenshot|continue|resume|proceed|keep going)\b/i.test(text);
  };

  const PLAN_STEP_WRITE_EVIDENCE_TOOLS = new Set([
    'create_file', 'write', 'write_file', 'append_file',
    'replace_lines', 'find_replace', 'insert_after', 'delete_lines',
    'apply_patch', 'apply_patchset', 'apply_workspace_patchset',
    'workspace_edit', 'prom_apply_dev_changes',
  ]);
  const planStepNeedsWriteEvidence = (stepText: string, note: string): boolean => {
    const text = `${stepText || ''} ${note || ''}`.toLowerCase();
    if (!text.trim()) return false;
    if (/\b(read|inspect|grep|search|list|locate|review|understand|check|confirm|audit)\b/.test(text)
      && !/\b(write|create|implement|build|edit|patch|replace|insert|delete|update|fix|add|scaffold|generate)\b/.test(text)) {
      return false;
    }
    return /\b(write|create|implement|build|edit|patch|replace|insert|delete|update|fix|add|scaffold|generate|complete)\b/.test(text)
      && /\b(file|html|index|app|game|page|component|code|script|style|feature|control|button|ui|tool|deliverable)\b/.test(text);
  };
  const hasRecentWriteEvidenceForCurrentStep = (): boolean => {
    const lastBoundary = Math.max(
      allToolResults.map((r, index) => ['declare_plan', 'complete_plan_step', 'step_complete'].includes(String(r?.name || '').trim()) ? index : -1).reduce((a, b) => Math.max(a, b), -1),
      -1,
    );
    return allToolResults
      .slice(lastBoundary + 1)
      .some((r) => r && !r.error && PLAN_STEP_WRITE_EVIDENCE_TOOLS.has(String(r.name || '').trim()));
  };

  // Keep legacy round-stats for the checklist-guard and continuation-nudge logic
  let progressRoundToolCalls = 0;
  let progressRoundHadSuccess = false;
  let progressRoundHadFailure = false;

  const resetProgressRoundStats = (): void => {
    progressRoundToolCalls = 0;
    progressRoundHadSuccess = false;
    progressRoundHadFailure = false;
  };

  const ensureProgressPlanFromObservedTools = (): void => {
    if (progressState.items.length > 0 || progressState.toolsSeen.length < 2) return;
    const observedTools = progressState.toolsSeen.map((t) => String(t || '').trim()).filter(Boolean);
    if (observedTools.length < 2) return;
    const base = observedTools.slice(0, 4).map((tool) => `Run ${prettifyToolName(tool)}`);
    if (base.length >= 2) {
      seedProgressFromLines(base, 'tool_sequence', { manualStepAdvance: false });
    }
  };

  const advanceProgressStep = (reason: string): void => {
    if (progressState.items.length < 2) return;
    const cursorStep = progressState.items[stepCursor];
    if (!cursorStep) return;
    if (cursorStep.status !== 'done' && cursorStep.status !== 'skipped') {
      cursorStep.status = 'done';
    }
    const nextIdx = stepCursor + 1;
    if (nextIdx < progressState.items.length) {
      stepCursor = nextIdx;
      progressState.activeIndex = nextIdx;
      if (progressState.items[nextIdx].status === 'pending') {
        progressState.items[nextIdx].status = 'in_progress';
      }
    } else {
      stepCursor = nextIdx;
      progressState.activeIndex = -1;
    }
    emitProgressState(reason);
  };

  const markProgressStepStart = (toolName: string): void => {
    const cleanTool = String(toolName || '').trim();
    if (cleanTool) progressState.toolsSeen.push(cleanTool);
    ensureProgressPlanFromObservedTools();
    if (progressState.items.length < 2) return;

    // Activate the step at the current cursor position if it's still pending.
    const cursorStep = progressState.items[stepCursor];
    if (cursorStep && cursorStep.status === 'pending') {
      cursorStep.status = 'in_progress';
      progressState.activeIndex = stepCursor;
      emitProgressState('step_started');
    } else if (!cursorStep) {
      // Cursor past end — append a dynamic step for unexpected extra tool calls
      const text = `Run ${prettifyToolName(cleanTool || 'tool')}`;
      progressState.items.push({ id: `p${progressState.items.length + 1}`, text, status: 'in_progress' });
      stepCursor = progressState.items.length - 1;
      progressState.activeIndex = stepCursor;
      emitProgressState('step_started');
    }
    // If already in_progress at cursor, stay there
  };

  const markProgressStepResult = (ok: boolean, toolName?: string): void => {
    if (progressState.items.length < 2) return;
    progressRoundToolCalls++;
    if (ok) {
      progressRoundHadSuccess = true;
      consecutiveStepFailures = 0;
    } else {
      progressRoundHadFailure = true;
      consecutiveStepFailures++;
    }

    const cursorStep = progressState.items[stepCursor];
    if (!cursorStep) return;

    const toolIsReadOnly = READ_ONLY_PROGRESS_TOOLS.has(String(toolName || '').trim());
    const tName = String(toolName || 'tool');

    if (!ok) {
      // Failure: mark in_progress (retrying), do not advance
      if (cursorStep.status !== 'done' && cursorStep.status !== 'skipped') {
        cursorStep.status = 'in_progress';
        progressState.activeIndex = stepCursor;
        emitProgressState('step_retrying');
      }
      console.log(`[Progress] ${tName} FAILED → step ${stepCursor + 1} retrying ("${cursorStep.text}")`);
      return;
    }

    if (toolIsReadOnly) {
      // Read-only success: stay on this step (gathering info), don't advance
      if (cursorStep.status === 'pending') {
        cursorStep.status = 'in_progress';
        progressState.activeIndex = stepCursor;
        emitProgressState('step_started');
      }
      console.log(`[Progress] ${tName} OK (read-only) → step ${stepCursor + 1} still in_progress ("${cursorStep.text}")`);
      return;
    }

    if (progressState.manualStepAdvance) {
      // Declared plans are manually advanced via complete_plan_step/step_complete.
      if (cursorStep.status === 'pending') {
        cursorStep.status = 'in_progress';
      }
      progressState.activeIndex = stepCursor;
      emitProgressState('step_progress');
      console.log(`[Progress] ${tName} OK (manual-plan) → step ${stepCursor + 1} remains in_progress ("${cursorStep.text}")`);
      return;
    }

    // Action tool succeeded: mark current step done and advance cursor
    cursorStep.status = 'done';
    const nextIdx = stepCursor + 1;
    console.log(`[Progress] ${tName} OK (action) → step ${stepCursor + 1} DONE ("${cursorStep.text}")${nextIdx < progressState.items.length ? ` → next: "${progressState.items[nextIdx].text}"` : ' → all steps done'}`);
    if (nextIdx < progressState.items.length) {
      stepCursor = nextIdx;
      progressState.activeIndex = nextIdx;
      // Activate the next step immediately so UI shows it as in_progress
      if (progressState.items[nextIdx].status === 'pending') {
        progressState.items[nextIdx].status = 'in_progress';
      }
      emitProgressState('step_done');
    } else {
      // All declared steps complete
      stepCursor = nextIdx; // past end, any new tools will append
      progressState.activeIndex = -1;
      emitProgressState('step_done');
    }
  };

  // finalizeProgressRound: only used as a safety net at end of each LLM batch.
  // The real step advancement now happens per-tool in markProgressStepResult.
  const finalizeProgressRound = (): void => {
    // If we still have an in_progress step but the round had only failures,
    // make sure it stays visually in_progress for the next round.
    if (progressState.items.length < 2 || progressRoundToolCalls === 0) return;
    const cursorStep = progressState.items[stepCursor];
    if (!cursorStep) return;
    if (progressRoundHadFailure && !progressRoundHadSuccess) {
      if (cursorStep.status !== 'done' && cursorStep.status !== 'skipped') {
        cursorStep.status = 'in_progress';
        progressState.activeIndex = stepCursor;
        emitProgressState('step_retrying');
      }
    }
  };

  const getProgressRemaining = (): number => (
    progressState.items.filter((item) => item.status === 'pending' || item.status === 'in_progress').length
  );
  emitProgressState('reset');

  htime('before preempt watchdog setup');
  // ── Preempt watchdog setup ─────────────────────────────────────────────────
  const rawCfgForPreempt = (getConfig().getConfig() as any);
  const toolUsageTelemetryEnabled = process.env.PROMETHEUS_TOOL_USAGE_TELEMETRY !== '0'
    && rawCfgForPreempt?.observability?.tool_usage !== false
    && rawCfgForPreempt?.usage_tracking?.tool_usage !== false;
  const primaryProvider = rawCfgForPreempt.llm?.provider || 'ollama';
  // ── Local LLM primary detection (v2.0 local model layer) ──────────────────
  // True when the configured primary is Ollama, LM Studio, or llama.cpp.
  // Gates the local_llm prompt path and the switch_model full-prompt promotion.
  // Cloud-primary sessions are completely unaffected — this flag is false for them.
  const isLocalPrimary = ['ollama', 'llama_cpp', 'lm_studio'].includes(
    String(primaryProvider || '').trim().toLowerCase(),
  );
  const preemptCfg: {
    enabled: boolean;
    stallThresholdMs: number;
    maxPerTurn: number;
    maxPerSession: number;
    restartMode: 'inherit_console' | 'detached_hidden';
  } = (() => {
    const oc = rawCfgForPreempt.orchestration;
    const preemptRaw = {
      ...(oc?.preempt || {}),
      restart_mode: oc?.preempt?.restart_mode
        || process.env.PROMETHEUS_OLLAMA_RESTART_MODE
        || (process.platform === 'win32' ? 'inherit_console' : 'detached_hidden'),
    };
    const normalizedPreempt = clampPreemptConfig(preemptRaw);
    return {
      enabled: orchestrationSkillEnabled
        && primaryProvider === 'ollama'
        && normalizedPreempt.enabled,
      stallThresholdMs: normalizedPreempt.stall_threshold_seconds * 1000,
      maxPerTurn: normalizedPreempt.max_preempts_per_turn,
      maxPerSession: normalizedPreempt.max_preempts_per_session,
      restartMode: normalizedPreempt.restart_mode === 'detached_hidden'
        ? 'detached_hidden'
        : 'inherit_console',
    };
  })();
  const preemptState = new PreemptState();
  preemptState.preemptsThisSession = getPreemptSessionCount(sessionId);
  const ollamaEndpoint = rawCfgForPreempt.llm?.providers?.ollama?.endpoint
    || rawCfgForPreempt.ollama?.endpoint
    || 'http://localhost:11434';
  const ollamaProcMgr = preemptCfg.enabled
    ? new OllamaProcessManager({ endpoint: ollamaEndpoint, restartMode: preemptCfg.restartMode })
    : null;
  let browserContinuationPending = false;
  let browserAdvisorRoute: 'answer_now' | 'continue_browser' | 'collect_more' | 'handoff_primary' | 'vision_interact' | null = null;
  let browserAdvisorHintPreview = '';
  let browserForcedRetries = 0;
  let browserAdvisorCallsThisTurn = 0;
  // Scroll-before-act gate: tracks whether a fill/click has happened yet this turn.
  // Blocks PageDown/scroll calls on interactive pages until the model actually acts.
  let browserFillOrClickDoneThisTurn = false;
  let browserScrollBeforeActCount = 0;
  const SCROLL_BEFORE_ACT_MAX = 1; // allow at most 1 scroll before a fill/click
  let desktopContinuationPending = false;
  let desktopAdvisorRoute: 'answer_now' | 'continue_desktop' | 'handoff_primary' | null = null;
  let desktopAdvisorHintPreview = '';
  let desktopAdvisorCallsThisTurn = 0;
  let browserAdvisorLastHash = '';
  let browserAdvisorUrlKey = '';
  let consecutiveUnchangedSnapshots = 0;
  let browserAdvisorBatch = 0;
  let browserAdvisorDedupeCount = 0;
  let browserNoFeedProgressStreak = 0;
  let browserStabilizeUrlKey = '';
  let browserStabilizeWaitRetries = 0;
  let browserStabilizeTabProbes = 0;
  let browserStabilizeExhausted = false;
  // Vision fallback state — set when stabilization is exhausted and DOM element count is still < 10.
  // Cleared when a subsequent snapshot recovers to > 10 elements.
  let browserVisionModeActive = false;
  const browserAdvisorCollectedFeed: Array<Record<string, any>> = [];
  const browserAdvisorSeenFeedKeys = new Set<string>();
  htime('before orchestration config / fileop');
  const orchRuntimeCfg = getOrchestrationConfig();
  const fileOpSettings = resolveFileOpSettings(orchRuntimeCfg as any);
  const fileOpRouterEnabled =
    orchestrationSkillEnabled
    && (orchRuntimeCfg?.enabled ?? false)
    && fileOpSettings.enabled
    && !isBootStartupTurn;
  const localFileOpClassification = fileOpRouterEnabled
    ? classifyFileOpType(message)
    : { type: 'CHAT' as FileOpType, reason: 'file-op v2 disabled' };
  let fileOpClassification = localFileOpClassification;
  if (fileOpRouterEnabled) {
    sendSSE('ui_preflight', { message: 'Classifying the request...' });
    const secondaryClass = await callSecondaryFileOpClassifier({
      userMessage: message,
      recentHistory: history.slice(-4).map(h => ({ role: h.role, content: h.content })),
    });
    if (secondaryClass) {
      fileOpClassification = {
        type: secondaryClass.operation as FileOpType,
        reason: `secondary classifier: ${secondaryClass.reason || 'runtime classification'} (confidence ${secondaryClass.confidence.toFixed(2)})`,
      };
      sendSSE('orchestration', {
        trigger: 'file_op_classifier',
        mode: 'router',
        route: secondaryClass.operation === 'BROWSER_OP'
          ? 'browser_ops'
          : secondaryClass.operation === 'DESKTOP_OP'
            ? 'desktop_ops'
            : (secondaryClass.operation === 'CHAT' ? 'chat' : 'file_ops'),
        reason: secondaryClass.reason || 'secondary runtime classification',
        operation: secondaryClass.operation,
        confidence: secondaryClass.confidence,
      });
    } else {
      // Secondary classifier unavailable — degrade to local classifier rather than
      // collapsing to CHAT. Falling back to CHAT silently strips all file-op gating
      // and verification, letting unchecked primary writes bypass all thresholds.
      // Local classification is conservative (FILE_EDIT/FILE_CREATE) and safer.
      sendSSE('info', {
        message: `FILE_OP router: secondary classifier unavailable; degrading to local classification (${localFileOpClassification.type}).`,
      });
      fileOpClassification = {
        type: localFileOpClassification.type,
        reason: `secondary classifier unavailable — local fallback: ${localFileOpClassification.reason}`,
      };
    }
  }
  // User preference: no automatic browser retries/snapshots.
  // Let the model explicitly decide when to call browser_snapshot.
  const browserAutoSnapshotRetriesEnabled = false;
  const browserMaxForcedRetries = browserAutoSnapshotRetriesEnabled
    ? (orchRuntimeCfg?.browser?.max_forced_retries ?? 2)
    : 0;
  const browserMaxAdvisorCallsPerTurn = orchRuntimeCfg?.browser?.max_advisor_calls_per_turn ?? 5;
  const desktopMaxAdvisorCallsPerTurn = 4;
  const browserMaxCollectedItems = orchRuntimeCfg?.browser?.max_collected_items ?? 80;
  const browserMinFeedItemsBeforeAnswer = orchRuntimeCfg?.browser?.min_feed_items_before_answer ?? 12;
  const browserStabilizeMaxWaitRetries = browserAutoSnapshotRetriesEnabled ? 2 : 0;
  const browserStabilizeMaxTabProbes = browserAutoSnapshotRetriesEnabled ? 2 : 0;
  const browserPacketMaxItems = Math.max(12, Math.min(60, Math.min(browserMaxCollectedItems, 40)));
  // Tracks how many times each exact tool+args combo has been called this session.
  // Tools are only skipped once they hit DUPLICATE_SKIP_THRESHOLD identical calls.
  // desktop_* and browser_* tools are always exempt — the screen/page changes each call.
  const DUPLICATE_SKIP_THRESHOLD = 5;
  const seenToolCalls = new Map<string, number>();
  const cachedReadOnlyToolResults = new Map<string, ToolResult>();
  // Only list_files is safe to replay from cache — read_file must always re-execute
  // because a write tool (replace_lines, edit, write_file, etc.) may have changed
  // the file between the first read and the verification read.
  const canReplayReadOnlyCall = (toolName: string): boolean =>
    toolName === 'list_files';

  // Write tools that should invalidate any cached read_file results for the same file
  const WRITE_TOOL_NAMES = new Set([
    'replace_lines', 'edit', 'find_replace', 'write_file', 'create_file',
    'apply_patch', 'apply_patchset', 'apply_dev_source_patchset', 'append_file', 'delete_file', 'move_file',
  ]);

  const invalidateReadCacheForFile = (filename: string): void => {
    if (!filename) return;
    const base = filename.replace(/\\/g, '/');
    for (const key of cachedReadOnlyToolResults.keys()) {
      // key format: "read_file:{\"filename\":\"...\"}" — invalidate if filename matches
      if (key.includes(base)) cachedReadOnlyToolResults.delete(key);
    }
    // Also remove from seenToolCalls so a re-read executes fresh rather than being skipped
    for (const key of seenToolCalls.keys()) {
      if ((key.startsWith('read_file:') || key.startsWith('read_files_batch:') || key.startsWith('read_dev_sources:')) && key.includes(base)) {
        seenToolCalls.delete(key);
      }
    }
  };
  const loopDetectionEnabled = orchRuntimeCfg?.triggers?.loop_detection !== false;
  const loopWarningThreshold = 5;
  const loopCriticalThreshold = 8;
  const loopWarnNudged = new Set<string>();
  const loopBlockNudged = new Set<string>();
  const loopContinueAllowed = new Set<string>();
  const recentToolCalls: Array<{ name: string; argsHash: string }> = [];
  const hashArgs = (args: any): string => {
    try {
      const normalize = (v: any): any => {
        if (Array.isArray(v)) return v.map(normalize);
        if (v && typeof v === 'object') {
          const out: Record<string, any> = {};
          for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
          return out;
        }
        return v;
      };
      return JSON.stringify(normalize(args || {})).slice(0, 200);
    } catch {
      return String(args || '').slice(0, 200);
    }
  };
  const checkLoopDetection = (toolName: string, args: any): { state: 'ok' | 'warn' | 'block'; repeats: number } => {
    if (!loopDetectionEnabled) return { state: 'ok', repeats: 1 };
    const argsHash = hashArgs(args);
    const loopSig = `${toolName}:${argsHash}`;
    if (loopContinueAllowed.has(loopSig)) return { state: 'ok', repeats: 1 };
    // Count includes this current attempt so thresholds are exact:
    // warning at 5th identical call, gate at 8th.
    const repeats = recentToolCalls.filter((t) => t.name === toolName && t.argsHash === argsHash).length + 1;
    recentToolCalls.push({ name: toolName, argsHash });
    if (recentToolCalls.length > 20) recentToolCalls.shift();
    if (repeats >= loopCriticalThreshold) return { state: 'block', repeats };
    if (repeats >= loopWarningThreshold) return { state: 'warn', repeats };
    return { state: 'ok', repeats };
  };
  const attachUniversalToolTelemetry = (toolResult: ToolResult, toolName: string, toolArgs: any, startedAt: number, finishedAt = Date.now()): ToolResult => {
    const argsText = (() => { try { return JSON.stringify(toolArgs || {}); } catch { return String(toolArgs || ''); } })();
    const resultText = String(toolResult?.result ?? '');
    const existingTelemetry = toolResult.extra?.telemetry || toolResult.data?.telemetry || {};
    const argsTokens = Number.isFinite(Number(existingTelemetry.argsTokens))
      ? Number(existingTelemetry.argsTokens)
      : estimateTextTokensForModel(argsText, 'openai');
    const resultTokens = Number.isFinite(Number(existingTelemetry.resultTokens))
      ? Number(existingTelemetry.resultTokens)
      : estimateTextTokensForModel(resultText, 'openai');
    const tokenTotal = Number.isFinite(Number(existingTelemetry.totalTokens))
      ? Number(existingTelemetry.totalTokens)
      : argsTokens + resultTokens;
    const pricingContext = getToolUsagePricingContext();
    const pricing = resolveModelPricing(pricingContext.providerId, pricingContext.model);
    const contextCostMicros = Number.isFinite(Number(existingTelemetry.contextCostMicros ?? existingTelemetry.context_cost_micros))
      ? normalizeTelemetryCostMicros(existingTelemetry.contextCostMicros ?? existingTelemetry.context_cost_micros)
      : estimateContextCostMicros(tokenTotal, pricingContext.providerId, pricingContext.model);
    const directCostMicros = normalizeTelemetryCostMicros(
      existingTelemetry.directCostMicros
      ?? existingTelemetry.direct_cost_micros
      ?? existingTelemetry.costMicros
      ?? existingTelemetry.cost_micros,
    );
    const telemetry = {
      ...existingTelemetry,
      startedAt: Number.isFinite(Number(existingTelemetry.startedAt)) ? Number(existingTelemetry.startedAt) : startedAt,
      finishedAt: Number.isFinite(Number(existingTelemetry.finishedAt)) ? Number(existingTelemetry.finishedAt) : finishedAt,
      durationMs: Number.isFinite(Number(existingTelemetry.durationMs)) ? Number(existingTelemetry.durationMs) : Math.max(0, finishedAt - startedAt),
      argsChars: Number.isFinite(Number(existingTelemetry.argsChars)) ? Number(existingTelemetry.argsChars) : argsText.length,
      resultChars: Number.isFinite(Number(existingTelemetry.resultChars)) ? Number(existingTelemetry.resultChars) : resultText.length,
      resultBytes: Number.isFinite(Number(existingTelemetry.resultBytes)) ? Number(existingTelemetry.resultBytes) : Buffer.byteLength(resultText, 'utf8'),
      argsTokens,
      resultTokens,
      totalTokens: tokenTotal,
      contextCostMicros,
      directCostMicros,
      totalCostMicros: normalizeTelemetryCostMicros(existingTelemetry.totalCostMicros ?? existingTelemetry.total_cost_micros)
        || (contextCostMicros + directCostMicros),
      pricingProvider: pricing.provider,
      pricingModel: pricing.model,
      pricingSource: pricing.source,
      pricingVersion: pricing.pricingVersion,
    };
    return {
      ...toolResult,
      name: toolResult.name || toolName,
      args: toolResult.args ?? toolArgs,
      extra: { ...(toolResult.extra || {}), telemetry },
    };
  };

  const makeInstrumentedToolResult = (toolName: string, toolArgs: any, result: string, error: boolean, startedAt = Date.now(), extra?: any): ToolResult =>
    attachUniversalToolTelemetry({ name: toolName, args: toolArgs, result, error, extra }, toolName, toolArgs, startedAt, Date.now());

  const getToolResultTelemetry = (toolResult: ToolResult | any): any =>
    (toolResult?.extra?.telemetry && typeof toolResult.extra.telemetry === 'object')
      ? toolResult.extra.telemetry
      : (toolResult?.data?.telemetry && typeof toolResult.data.telemetry === 'object')
        ? toolResult.data.telemetry
        : {};

  const getToolElapsedMs = (toolResult: ToolResult | any): number | undefined => {
    const telemetry = getToolResultTelemetry(toolResult);
    const durationMs = Number(telemetry.durationMs ?? telemetry.elapsedMs ?? telemetry.elapsed_ms ?? toolResult?.durationMs ?? toolResult?.elapsedMs ?? toolResult?.elapsed_ms);
    return Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : undefined;
  };

  const getToolUsagePricingContext = (): { providerId: string; model: string } => {
    const cfg = getConfig().getConfig() as any;
    const activeProvider = String(cfg?.llm?.provider || '').trim();
    const providerId = String(
      currentModelCapabilities?.provider
      || providerOverride
      || activeProvider
      || primaryProvider
      || '',
    ).trim();
    const providerCfgModel = providerId ? String(cfg?.llm?.providers?.[providerId]?.model || '').trim() : '';
    const model = String(
      currentModelCapabilities?.model
      || modelOverride
      || providerCfgModel
      || getPrimaryModel()
      || '',
    ).trim();
    return { providerId: providerId || 'unknown', model: model || 'unknown' };
  };

  const normalizeTelemetryCostMicros = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };

  const formatToolElapsedForHumans = (durationMs: number): string => {
    if (!Number.isFinite(durationMs)) return '';
    if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
    if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(2)}s`;
    if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.round((durationMs % 60_000) / 1000);
    return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
  };

  const formatCostUsdForTelemetry = (costMicros: number): string => {
    const usd = Math.max(0, Number(costMicros || 0)) / 1_000_000;
    if (!Number.isFinite(usd) || usd <= 0) return '0';
    if (usd >= 1) return usd.toFixed(4);
    if (usd >= 0.01) return usd.toFixed(5);
    return usd.toFixed(7);
  };

  const formatToolStopwatchLineForModel = (toolResult: ToolResult | any): string => {
    const elapsedMs = getToolElapsedMs(toolResult);
    if (!Number.isFinite(Number(elapsedMs))) return '';
    const telemetry = getToolResultTelemetry(toolResult);
    if (!toolUsageTelemetryEnabled) {
      return `[TOOL_STOPWATCH] elapsed_ms=${elapsedMs} elapsed=${formatToolElapsedForHumans(Number(elapsedMs))}`;
    }
    const argsTokens = Math.max(0, Math.round(Number(telemetry.argsTokens || 0)));
    const resultTokens = Math.max(0, Math.round(Number(telemetry.resultTokens || 0)));
    const totalTokens = Math.max(0, Math.round(Number(telemetry.totalTokens || argsTokens + resultTokens)));
    const contextCostMicros = normalizeTelemetryCostMicros(telemetry.contextCostMicros ?? telemetry.context_cost_micros);
    const directCostMicros = normalizeTelemetryCostMicros(telemetry.directCostMicros ?? telemetry.direct_cost_micros);
    const totalCostMicros = normalizeTelemetryCostMicros(telemetry.totalCostMicros ?? telemetry.total_cost_micros)
      || contextCostMicros + directCostMicros;
    const pricingRef = [telemetry.pricingProvider, telemetry.pricingModel].filter(Boolean).join('/');
    return [
      '[TOOL_STOPWATCH]',
      `elapsed_ms=${elapsedMs}`,
      `elapsed=${formatToolElapsedForHumans(Number(elapsedMs))}`,
      `args_tokens=${argsTokens}`,
      `result_tokens=${resultTokens}`,
      `context_tokens=${totalTokens}`,
      `context_cost_est_usd=${formatCostUsdForTelemetry(contextCostMicros)}`,
      directCostMicros ? `direct_cost_est_usd=${formatCostUsdForTelemetry(directCostMicros)}` : '',
      `total_cost_est_usd=${formatCostUsdForTelemetry(totalCostMicros)}`,
      pricingRef ? `pricing=${pricingRef}` : '',
      telemetry.pricingSource ? `pricing_source=${telemetry.pricingSource}` : '',
    ].filter(Boolean).join(' ');
  };

  const executeToolWithTelemetry = async (toolName: string, toolArgs: any): Promise<ToolResult> => {
    const startedAt = Date.now();
    try {
      const toolResult = await executeTool(toolName, toolArgs, workspacePath, buildExecuteToolDeps(), sessionId);
      return attachUniversalToolTelemetry(toolResult, toolName, toolArgs, startedAt);
    } catch (err: any) {
      return makeInstrumentedToolResult(
        toolName,
        toolArgs,
        `Tool execution failed: ${String(err?.message || err || 'Unknown error')}`,
        true,
        startedAt,
      );
    }
  };

  const orchestrationState = new OrchestrationTriggerState();
  const orchestrationLog: string[] = [];
  const orchestrationStats = getOrchestrationSessionStats(sessionId);
  // Cached once per turn — used by browser interception, preempt nudge, and advisor calls
  const multiAgentActive = orchestrationSkillEnabled && ((getOrchestrationConfig()?.enabled) ?? false);
  const fileOpV2Active = multiAgentActive
    && fileOpSettings.enabled
    && (fileOpClassification.type === 'FILE_ANALYSIS' || fileOpClassification.type === 'FILE_CREATE' || fileOpClassification.type === 'FILE_EDIT');
  const fileOpType = fileOpClassification.type;
  let fileOpOwner: 'primary' | 'secondary' = fileOpType === 'FILE_ANALYSIS' ? 'secondary' : 'primary';
  const fileOpTouchedFiles = new Set<string>();
  const fileOpToolHistory: Array<{
    tool: string;
    args: any;
    result: string;
    error: boolean;
    actor: 'primary' | 'secondary';
    estimate_lines: number;
    estimate_chars: number;
  }> = [];
  let fileOpPrimaryWriteLines = 0;
  let fileOpPrimaryWriteChars = 0;
  let fileOpHadCreate = false;
  let fileOpHadToolFailure = false;
  let fileOpPrimaryStallPromoted = false;
  let fileOpLastFailureSignature = '';
  const fileOpPatchSignatures: string[] = [];
  const fileOpWatchdog = new FileOpProgressWatchdog(fileOpSettings.watchdog_no_progress_cycles);
  const resumedFileOpCheckpoint = (fileOpV2Active && fileOpSettings.checkpointing_enabled)
    ? loadFileOpCheckpoint(sessionId)
    : null;
  if (
    resumedFileOpCheckpoint
    && resumedFileOpCheckpoint.goal === message
    && resumedFileOpCheckpoint.phase !== 'done'
  ) {
    fileOpOwner = resumedFileOpCheckpoint.owner || fileOpOwner;
    for (const f of resumedFileOpCheckpoint.files_changed || []) {
      if (f) fileOpTouchedFiles.add(String(f));
    }
    for (const sig of resumedFileOpCheckpoint.patch_history_signatures || []) {
      if (sig) fileOpPatchSignatures.push(String(sig));
    }
    if (fileOpPatchSignatures.length > 20) {
      fileOpPatchSignatures.splice(0, fileOpPatchSignatures.length - 20);
    }
  }
  // Synthetic tool calls queued by the browser advisor for deterministic next steps.
  // When set, the main loop skips LLM generation and executes these directly.
  let pendingSyntheticToolCalls: Array<{ function: { name: string; arguments: any } }> = [];

  const trackFileOpMutation = (toolName: string, toolArgs: any, toolResult: ToolResult, actor: 'primary' | 'secondary') => {
    if (!isFileMutationTool(toolName)) return;
    const estimate = estimateFileToolChange(toolName, toolArgs);
    const target = extractFileToolTarget(toolName, toolArgs);
    if (target) fileOpTouchedFiles.add(target);
    if (actor === 'primary') {
      fileOpPrimaryWriteLines += estimate.lines_changed;
      fileOpPrimaryWriteChars += estimate.chars_changed;
    }
    if (isFileCreateTool(toolName) && !toolResult.error) fileOpHadCreate = true;
    if (toolResult.error) fileOpHadToolFailure = true;
    fileOpToolHistory.push({
      tool: toolName,
      args: toolArgs,
      result: toolResult.result,
      error: toolResult.error,
      actor,
      estimate_lines: estimate.lines_changed,
      estimate_chars: estimate.chars_changed,
    });
    if (fileOpToolHistory.length > 64) fileOpToolHistory.shift();
    maybeSaveFileOpCheckpoint({
      phase: 'execute',
      next_action: `${actor} applied ${toolName}`,
    });
  };

  const maybeSaveFileOpCheckpoint = (patch: {
    phase: 'plan' | 'execute' | 'verify' | 'repair' | 'done';
    next_action: string;
    findings?: any[];
  }) => {
    if (!fileOpV2Active || !fileOpSettings.checkpointing_enabled) return;
    saveFileOpCheckpoint(sessionId, {
      goal: message,
      phase: patch.phase,
      owner: fileOpOwner,
      operation: fileOpType,
      files_changed: Array.from(fileOpTouchedFiles).slice(0, 24),
      last_verifier_findings: Array.isArray(patch.findings) ? patch.findings : [],
      patch_history_signatures: fileOpPatchSignatures.slice(-12),
      next_action: patch.next_action,
    });
  };

  const executeSecondaryPatchCalls = async (
    calls: Array<{ tool: string; args: any }>,
    reason: string,
  ): Promise<{ ran: number; patchSignature: string }> => {
    const planCalls = (calls || []).filter(c => c && c.tool && typeof c.args === 'object');
    if (!planCalls.length) return { ran: 0, patchSignature: '' };
    const patchSignature = buildPatchSignature(planCalls.map(c => ({ tool: c.tool, args: c.args })));
    fileOpPatchSignatures.push(patchSignature);
    if (fileOpPatchSignatures.length > 20) fileOpPatchSignatures.shift();
    sendSSE('info', { message: `FILE_OP v2: applying ${planCalls.length} secondary patch call(s) (${reason}).` });
    let ran = 0;
    for (const call of planCalls) {
      const toolName = String(call.tool || '').trim();
      const toolArgs = call.args || {};
      markProgressStepStart(toolName);
      sendSSE('tool_call', { action: toolName, args: toolArgs, stepNum: allToolResults.length + 1, synthetic: true, actor: 'secondary' });
      const toolResult = await executeToolWithTelemetry(toolName, toolArgs);
      allToolResults.push(toolResult);
      logToolCall(workspacePath, toolName, toolArgs, toolResult.result, toolResult.error);
      trackFileOpMutation(toolName, toolArgs, toolResult, 'secondary');
      if (toolResult.error) fileOpHadToolFailure = true;
      markProgressStepResult(!toolResult.error, toolName);

      if (toolName === 'request_dev_source_edit' && !toolResult.error) {
        seedDevSourceEditProgressPlan(toolResult);
      }

      if (toolName === 'write_note' && !toolResult.error) {
        const tag = String(toolArgs?.tag || toolArgs?.step || '').trim().replace(/\s+/g, '_').toLowerCase();
        const completedDevEdit = toolResult.extra?.dev_edit_complete === true || toolResult.data?.dev_edit_complete === true || tag === 'dev_edit_complete';
        if (completedDevEdit && progressState.manualStepAdvance && progressState.items.length >= 2) {
          let guard = progressState.items.length + 1;
          while (guard-- > 0 && progressState.items.some((item) => item.status === 'pending' || item.status === 'in_progress')) {
            advanceProgressStep('dev_edit_complete');
          }
        }
      }
      sendSSE('tool_result', { action: toolName, result: toolResult.result.slice(0, 500), error: toolResult.error, stepNum: allToolResults.length, synthetic: true, actor: 'secondary' });
      const goalReminder = `\n\n[GOAL REMINDER: Your task is still: "${message.slice(0, 120)}". Stay focused on this goal only.]`;
      const isBrowserTool = isBrowserToolName(toolName);
      const isDesktopTool = isDesktopToolName(toolName);
      // Visual screenshot tools deliver a post-action screenshot via the advisor packet.
      // Route through buildDesktopScreenshotContent so vision primaries get the PNG image.
      const isDesktopVisualTool1 = toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot';
      let toolMessageContent = (isBrowserTool && multiAgentActive)
        ? buildBrowserAck(toolName, toolResult) + goalReminder
        : (isDesktopTool && isDesktopVisualTool1)
          ? buildDesktopScreenshotContent(toolResult, sessionId, goalReminder)
          : (isDesktopTool)
            ? buildDesktopAck(toolName, toolResult) + goalReminder
            : toolResult.result + goalReminder;
      if (isBrowserTool) toolMessageContent = wrapUntrustedBrowserToolContent(toolName, toolMessageContent);
      toolMessageContent = boundToolMessageContentForModelContext(toolMessageContent, toolName);
      messages.push({ role: 'tool', tool_name: toolName, content: toolMessageContent });
      await maybeAppendVisionScreenshotForTool(toolName, toolResult, toolArgs);
      orchestrationLog.push(
        toolResult.error
          ? `✗ [secondary_patch] ${toolName}: ${toolResult.result.slice(0, 100)}`
          : `✓ [secondary_patch] ${toolName}: ${toolResult.result.slice(0, 80)}`,
      );
      ran++;
    }
    return { ran, patchSignature };
  };

  if (fileOpV2Active) {
    sendSSE('info', {
      message: `FILE_OP v2 active: ${fileOpType} (${fileOpClassification.reason}).`,
    });
    sendSSE('orchestration', {
      trigger: 'file_op_router',
      mode: 'router',
      route: 'file_ops',
      reason: `${fileOpType} (${fileOpClassification.reason})`,
      file_op_type: fileOpType,
      owner: fileOpOwner,
    });
    if (resumedFileOpCheckpoint && resumedFileOpCheckpoint.goal === message && resumedFileOpCheckpoint.phase !== 'done') {
      sendSSE('info', {
        message: `FILE_OP v2: resuming checkpoint at phase="${resumedFileOpCheckpoint.phase}" next="${resumedFileOpCheckpoint.next_action || 'n/a'}".`,
      });
    } else {
      maybeSaveFileOpCheckpoint({
        phase: 'plan',
        next_action: fileOpType === 'FILE_ANALYSIS' ? 'secondary analysis' : 'primary execution',
      });
    }
  }

  const teachModeActive = /\[TEACH_SESSION\]/i.test(String(callerContext || ''));
  const personalityProfile = isDirectSubagentChatTurn
    ? { profile: 'direct_subagent' as const, excludedSkillIds, forcedSkillIds }
    : teachModeActive
      ? { profile: 'teach_mode' as const, excludedSkillIds, forcedSkillIds }
      : (isLocalPrimary
        ? { profile: 'local_llm' as const, excludedSkillIds, forcedSkillIds }
        : (excludedSkillIds.length || forcedSkillIds.length ? { excludedSkillIds, forcedSkillIds } : undefined));
  htime('reached Building model context');
  sendSSE('ui_preflight', { message: 'Building model context...' });
  const contextBuildStartedAt = markLatency('context_build_start');
  const personalityCtx = await buildPersonalityContext(
    sessionId,
    workspacePath,
    message,
    executionMode || 'interactive',
    history.length,
    _skillsManager,
    // Component 5: inject browser_vision hint when vision mode is active for this session.
    // browserVisionModeActive is declared higher in handleChat's closure scope.
    browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,
    personalityProfile,
  );
  htime('after buildPersonalityContext');
  markLatency('context_build_done', {
    stageDurationMs: Date.now() - contextBuildStartedAt,
    contextChars: String(personalityCtx || '').length,
  });
  let switchModelPersonalityCtx: string | null = null;

  // Inject active browser session state so LLM knows to reuse it instead of re-opening
  const browserInfo = getBrowserSessionInfo(sessionId);
  const browserControlCtx = formatBrowserInteractionContextBlock(sessionId);
  const browserStateCtx = browserInfo.active
    ? `\n\n[BROWSER SESSION ACTIVE: A browser tab is already open.${
        browserInfo.title ? ` Current page: "${browserInfo.title}"` : ''
      }${
        browserInfo.url ? ` at ${browserInfo.url}` : ''
      }. Browser profile: ${browserInfo.profileLabel || (browserInfo.profileKind === 'user' ? 'user Chrome profile' : 'Prometheus browser profile')}.${
        browserInfo.debugPort ? ` CDP port: ${browserInfo.debugPort}.` : ''
      } Use browser_snapshot to see current elements, or browser_click to navigate. Do NOT call browser_open unless you need to go to a completely different site.${
        browserInfo.mode ? ` Current browser control mode: ${browserInfo.mode}.` : ''
      }]${browserControlCtx ? `\n${browserControlCtx}` : ''}`
    : '';

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const executionModeSystemBlock = (() => {
    if (executionMode === 'background_task') {
      return [
        'EXECUTION MODE: Autonomous background task.',
        'You are running without user oversight. Do not ask clarifying questions.',
        'Make decisions based on available context. Use tools precisely.',
        'If truly blocked: return a concise blocked reason and the best next action.',
      ].join('\n');
    }
    if (executionMode === 'proposal_execution') {
      return [
        'EXECUTION MODE: Approved proposal execution.',
        'Execute the approved proposal scope directly and finish the assigned steps.',
        'Do not ask clarifying questions. Do not create a new proposal in this mode.',
        'If truly blocked: return a concise blocked reason and the best next action.',
      ].join('\n');
    }
    if (executionMode === 'background_agent') {
      return [
        'EXECUTION MODE: Background agent (parallel worker).',
        'You are running in parallel with the main chat — a standalone subagent or a one-shot spawned helper. Work autonomously and decisively.',
        'Do not ask clarifying questions. Use tools directly and finish the assigned task.',
      ].join('\n');
    }
    if (executionMode === 'heartbeat') {
      return [
        'EXECUTION MODE: Heartbeat check.',
        'Run concise, decisive checks and report only actionable issues.',
        'If no action was taken or nothing applies, reply exactly HEARTBEAT_OK and nothing else. HEARTBEAT_OK is a silence token and must not be sent to the user/chat/channel as a normal message.',
        'When creating or editing any HEARTBEAT.md for yourself or another agent, always preserve that HEARTBEAT_OK silence rule in the file.',
      ].join('\n');
    }
    if (executionMode === 'cron') {
      return [
        'EXECUTION MODE: Scheduled cron task.',
        'Act autonomously and complete the prompt without asking follow-up questions.',
        'Follow the scheduled task plan shown in the task panel. Do not create proposals, tasks, or external side effects unless the schedule prompt explicitly instructs you to do so.',
      ].join('\n');
    }
    if (executionMode === 'team_subagent') {
      return [
        'EXECUTION MODE: Team subagent task.',
        'You are a subagent on a managed team, running locally on the user\'s computer under Prometheus — not Prometheus itself.',
        'You have access to this computer through tools. Use tools directly, verify your work, and do not claim you lack tool access.',
        'Complete the assigned team task. If you need clarification or a decision, ask the team manager with talk_to_manager instead of asking the user.',
      ].join('\n');
    }
    if (executionMode === 'team_manager') {
      return [
        'EXECUTION MODE: Team manager.',
        'You are running a managed team, not the main user chat.',
        'Use the manager context exactly: dispatch only useful subagents, verify their outputs, update team memory, and ask the main Prometheus agent only when team-level context is required.',
        'Use [GOAL_COMPLETE], [NEEDS_INPUT], or [WAITING_MAIN_AGENT] only when those states are genuinely true.',
      ].join('\n');
    }
    return '';
  })();
  const responseStyleInstruction = executionMode === 'heartbeat'
    ? 'Report only actionable heartbeat results. For no-op heartbeats, output exactly HEARTBEAT_OK and nothing else.'
    : 'Match the user\'s tone and pacing. Be natural, warm, and conversational. Use concise replies for quick asks, and expand with context, personality, and guidance when helpful or when the user invites depth.';
  const planProtocolInstruction = executionMode === 'background_agent'
    ? 'If this background-agent task has 2+ meaningful phases, call bg_plan_declare FIRST (2-8 short steps). Keep executing within the current step until the phase is actually complete, then call bg_plan_advance(note) to move forward. Do NOT use declare_plan/complete_plan_step in background_agent mode.'
    : executionMode === 'proposal_execution'
      ? 'Proposal execution already has a fixed task plan. Do NOT call declare_plan. Execute steps in order, use tools directly, and call step_complete(note) after each completed step.'
      : 'Default to direct execution — do the work with tools. Call declare_plan only when the user explicitly asks for a plan, checklist, or step-by-step breakdown.';
const creativeRoutingInstruction = 'Creative routing: Creative is a normal main-chat tool category and editor surface, not a separate assistant runtime. Use generate_image for one-shot raster image generation and generate_video for one-shot MP4 generation. Use creative_* and hyperframes_* tools directly for editable canvas, image, video, timeline, animation, HTML Motion, HyperFrames, Remotion, captioned clip, promo video, motion export, or multi-clip workspace work. switch_creative_mode only selects or clears editor workspace state; it must not change the assistant persona, prompt contract, history, or non-creative tool availability. Normal tools such as desktop_*, browser_*, run_command, scheduling, proposals, memory, connectors, and Codex/source tools remain valid while a Creative workspace is open. Creative work must be visual-first: after meaningful edits, call creative_get_state or creative_render_snapshot before deciding the next edit. These tools render actual canvas screenshots/frames and inject them into vision context like browser/desktop screenshots. For video workspace work, prefer HTML Motion / HyperFrames / Remotion / Pretext sources and use creative_list_html_motion_templates, creative_apply_html_motion_template, creative_create_html_motion_clip, creative_read_html_motion_clip, creative_patch_html_motion_clip, creative_list_html_motion_blocks, creative_apply_hyperframes_component, and Pretext text-fit tools when they fit. Before presenting or exporting creative work, run direct visual self-review with creative_render_snapshot; for video, use sampleTimesMs or frame batches when playback inspection matters.';
  const hyperframesAgentRoutingInstruction = 'HyperFrames agent policy: when the user asks to create, compose, import, edit, lint, QA, materialize, or export HyperFrames video, prefer real HyperFrames sources over recreated lookalikes. Prefer first-class hyperframes_* and creative_* tools when they can create source-backed catalog clips correctly; public desktop builds bundle the HyperFrames packages but do not rely on a user-installed global Node/npm/npx. If first-class tools fail or lack catalog access, use the packaged Prometheus runtime path surfaced by tool output or settings/runtime diagnostics before falling back to ambient commands, and report exact CLI/runtime errors. Do not substitute hand-authored catalog labels, CSS mockups, or recreated components after the user asked for HyperFrames catalog/registry output. Start with hyperframes_browse_catalog or bundled catalog discovery, customize with HyperFrames/source-backed edits, then run lint/inspect/QA/export only after visual review. Use creative_list_hyperframes_components, creative_sync_hyperframes_catalog, and creative_apply_hyperframes_component only for low-level compatibility or migration work.';
  const creativeDebuggingInstruction = 'Creative debugging tools: when working in video mode, use video_render_frame, video_render_contact_sheet, video_analyze_frame, video_analyze_timeline, video_check_keyframes, video_check_caption_timing, video_check_audio_sync, video_extract_clip_frames, and video_analyze_imported_video when those names fit the job. Use creative_element_inventory for a complete layer/timeline inventory with text, timing, animation, visibility, provenance, and validation details. Use creative_frame_trace to see which elements are actually active at exact timestamps, with resolved opacity/transform/z-order/source information. Use creative_frame_diff to compare two timestamps and detect what changed, appeared, disappeared, or stayed static. Use creative_history_status, creative_undo, and creative_redo to recover from destructive resets, bad template applications, failed batch edits, or visual regressions; after undo/redo, render or inspect the scene before continuing. For image mode, use image_get_element_at_point, image_get_overlaps, image_get_bounds_summary, image_check_text_overflow, image_check_contrast, and image_detect_empty_regions when diagnosing composition/layout issues. Use creative_export_trace before or after export when you need certainty about the scene hash, render/export job, saved scene, active export, or whether stale/cached output was used. Before risky rebuilds or large experiments, call creative_checkpoint with action "save"; restore a checkpoint if the design gets worse. If a scene is contaminated by duplicated ids, offscreen debris, stale template residue, editor artifacts, hidden layers, or ghost content, call creative_purge_scene first. Only call creative_reset_scene with force=true after a checkpoint/export or when the user explicitly asked for a fresh blank scene. Do not keep patching a corrupted video timeline when purge plus inventory/trace gives a cleaner path.';
  const teachModeSystemBlock = teachModeActive
      ? [
        'TEACH MODE: Workflow teaching and verification.',
        'Your primary objective is to help the user capture, verify, and package a reusable browser workflow.',
        'Treat the recorded Teach steps as the source of truth for the intended flow.',
        'When Teach mode is waiting for verification approval, summarize the workflow, call out risky steps, and ask how far verification should go before running anything.',
        'Once the user approves verification, call browser_teach_verify with the approved boundary before you summarize the replay result.',
        'After verification, explain what actually happened, what adjustments were needed, and what you think the workflow is for.',
        'Ask the user to confirm whether that understanding is correct before proposing packaging.',
        'You may recommend composite, skill, both, or neither after verification, but do NOT create any composite tool or skill unless the user explicitly asks you to.',
      ].join('\n')
    : '';

  const teamRoutingInstruction = [
    'Managed-team routing policy:',
    '- When the user asks main chat to pass a message/question to a managed team, make the intended audience explicit for the coordinator: use [BROADCAST_TO_TEAM] for the whole team, or [ASK_AGENT:<agent id or name>] for a specific member. If the user names no member, default to [BROADCAST_TO_TEAM].',
    '- When replying to a coordinator via reply_to_team, preserve that routing intent in the message instead of collapsing it into a manager-only answer. The reply_to_team tool delivers team/member routes directly to member room turns first, then resumes the manager after those responses settle.',
    '- Do not ask the manager to manually broadcast ordinary reply_to_team messages. Use internal_watch only for explicit background task ids returned by team tools, not for the reply_to_team broadcast path.',
  ].join('\n');

  const buildBaseSystemPrompt = (): string => {
    const visualGroundingPolicy = currentModelCapabilities.hasVision
      ? 'Visual-first policy: for browser/desktop workflows, ground decisions in fresh snapshots/screenshots when state likely changed, the UI is ambiguous, or a risky action just ran. Vision screenshots are the highest-confidence source of current UI truth on dynamic pages. If DOM refs, assumptions, or JS probes conflict with what the page is doing, trust fresh vision/snapshot evidence and re-anchor before acting. Prefer browser_snapshot/browser_vision_screenshot and desktop_screenshot over repeated browser_run_js probing. Use browser_run_js only when visual/snapshot evidence is insufficient for a concrete action.'
      : 'Text-first UI policy: the active model is not vision-capable. For browser/desktop workflows, ground decisions in browser_snapshot, browser_get_page_text, DOM/accessibility data, OCR/window text from desktop screenshots, metadata, and explicit tool outputs. Do not call browser_vision_screenshot, browser_vision_click, browser_vision_type, analyze_image, or analyze_video. Use browser_run_js only when text/snapshot evidence is insufficient for a concrete action.';
    const skillRecoveryInstruction = 'Skill recovery policy: when a skill-guided path fails, recover with another viable approach. If the alternate approach works, offer to update the skill with the corrected steps or guardrail.';
    const creativeRuntimeInstruction = currentModelCapabilities.hasVision
      ? creativeRoutingInstruction
      : 'Creative routing: Creative is a normal main-chat tool category and editor surface, not a separate assistant runtime. Use generate_image for one-shot raster image generation and generate_video for one-shot MP4 generation. Use creative_* and hyperframes_* tools directly for editable canvas, image, video, timeline, animation, HTML Motion, HyperFrames, Remotion, captioned clip, promo video, motion export, or multi-clip workspace work. switch_creative_mode only selects or clears editor workspace state; it must not change the assistant persona, prompt contract, history, or non-creative tool availability. Normal tools such as desktop_*, browser_*, run_command, scheduling, proposals, memory, connectors, and Codex/source tools remain valid while a Creative workspace is open. The active model is not vision-capable, so do not ask for direct visual self-review or image/video frame interpretation. After meaningful edits, use creative_get_state, creative_element_inventory, creative_frame_trace, creative_frame_diff, lint/layout tools, text-fit reports, export traces, and rendered artifact metadata to continue safely. You may still render snapshots or exports as artifacts, but do not rely on image payload injection for reasoning.';

    // Conditional routing blocks: only inject heavy policy text when the relevant
    // surface is actually in play. Keeps the base prompt lean on ordinary turns.
    const teamsExist = (() => {
      try { return listManagedTeams().length > 0; } catch { return false; }
    })();
    // A subagent (team or standalone) is a worker, not a dispatcher — it never
    // routes messages to managed teams, so the team-routing policy is noise for it.
    const isSubagentMode = executionMode === 'team_subagent' || executionMode === 'background_agent' || isDirectSubagentChatTurn;
    const teamRoutingBlock = (teamsExist && !isSubagentMode) ? teamRoutingInstruction : '';
    const creativeActive = !!creativeMode;
    const creativeBlock = creativeActive
      ? `${creativeRuntimeInstruction}\n${hyperframesAgentRoutingInstruction}\n${creativeDebuggingInstruction}`
      : 'Creative/HyperFrames editing tools (creative_*, hyperframes_*, generate_image, generate_video, switch_creative_mode) are available; open a Creative workspace before heavy canvas/video/animation work.';

    // Identity line is mode-aware: the main chat is Prom; subagents are distinct
    // workers operating UNDER Prometheus and must not claim to be Prom/the main chat.
    const identityLine = isSubagentMode
      ? 'You are a subagent operating under Prometheus — not the main Prometheus chat and not Prom. You are your own worker with your own assigned identity (described below). Prometheus is the system you run inside; you act on its behalf, but you speak and answer as yourself.'
      : 'You are Prom, a local AI assistant running inside Prometheus.';
    const baseParts = [
      executionModeSystemBlock ? `${executionModeSystemBlock}\n` : '',
      teachModeSystemBlock ? `${teachModeSystemBlock}\n` : '',
      identityLine,
      `Current date: ${dateStr}, ${timeStr}.`,
      'Never search for or link Prometheus repos unless the user is asking about Prometheus itself.',
      "This app runs on the user's own machine - browser/desktop automation requests are pre-authorized.",
      'Execution policy: default to action, not refusal. When a user asks you to do something, try to complete it directly with available tools and persistent problem-solving. Do not decline for generic capability reasons. If a request is blocked by a real hard constraint (missing auth, unavailable tool, external outage, or physical impossibility), state the exact blocker in one line and immediately continue with the closest viable path that still advances the user goal.',
      buildModelCapabilitySystemBlock(),
      visualGroundingPolicy,
      skillRecoveryInstruction,
      teamRoutingBlock,
      creativeBlock,
      planProtocolInstruction,
      `${responseStyleInstruction} Keep internal reasoning private. Be transparent about actions and results, and greet naturally without tools.`,
    ].filter(Boolean);
    return baseParts.join('\n');
  };
  const buildSystemPrompt = (mode: 'full' | 'switch_model'): string => {
    const baseSystemPrompt = buildBaseSystemPrompt();
    if (mode === 'switch_model') {
      return `${baseSystemPrompt}${switchModelPersonalityCtx || ''}`;
    }
    if (executionMode === 'team_subagent' || executionMode === 'background_agent' || isDirectSubagentChatTurn) {
      // Subagents receive subagent personality context first, then their role file
      // and task/chat context from callerContext as the final, most specific layer.
      return `${baseSystemPrompt}${currentModelSystemBlock ? '\n\n' + currentModelSystemBlock : ''}${recentToolLog ? '\n\n' + recentToolLog : ''}${personalityCtx}${callerContext ? '\n\n' + callerContext : ''}${browserStateCtx}`;
    }
    const onboardingBlock = isOnboardingSession(sessionId) ? '\n\n' + getMeetAndGreetSystemPrompt() : '';
    return `${baseSystemPrompt}${currentModelSystemBlock ? '\n\n' + currentModelSystemBlock : ''}${recentToolLog ? '\n\n' + recentToolLog : ''}${callerContext ? '\n\n' + callerContext : ''}${browserStateCtx}${personalityCtx}${onboardingBlock}`;
  };
  const messages: any[] = [
    {
      role: 'system',
      content: buildSystemPrompt('full'),
    },
  ];

  if (pinnedMessages && pinnedMessages.length > 0) {
    messages.push({ role: 'user', content: '[PINNED CONTEXT - Important messages from earlier in our conversation:]' });
    for (const pin of pinnedMessages.slice(0, 3)) {
      messages.push({ role: pin.role === 'user' ? 'user' : 'assistant', content: pin.content });
    }
    messages.push({ role: 'assistant', content: 'I have the pinned context. Continuing...' });
  }

  for (const msg of history) {
    messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
  }
  const creativeReferenceVisionMessage = buildCreativeReferenceVisionMessage();
  if (creativeReferenceVisionMessage) {
    messages.push(creativeReferenceVisionMessage);
    sendSSE('vision_injected', { source: 'creative_references', frames: Array.isArray(creativeReferenceVisionMessage.content) ? creativeReferenceVisionMessage.content.length - 1 : 0 });
    sendSSE('info', { message: 'Creative reference frame vision injected for this turn.' });
  }
  const shouldUseXaiVisionSidecar =
    attachments && attachments.length > 0
    && !currentModelCapabilities.hasVision
    && String(currentModelCapabilities.provider || '').toLowerCase() === 'xai'
    && /^grok-composer/i.test(String(currentModelCapabilities.model || ''));
  let attachmentVisionSidecarBlock = '';
  if (shouldUseXaiVisionSidecar) {
    const summaries: string[] = [];
    for (const attachment of attachments.slice(0, 3)) {
      const mimeType = String(attachment?.mimeType || 'image/png').trim() || 'image/png';
      const base64 = String(attachment?.base64 || '').trim();
      if (!base64 || !mimeType.startsWith('image/')) continue;
      const name = String(attachment?.name || mimeType || 'image attachment').trim() || 'image attachment';
      const dataUrl = `data:${mimeType};base64,${base64}`;
      const result = await executeXaiImageVisionSummary({ dataUrl, name });
      if (result.success && result.summary) {
        summaries.push(`- ${name}: ${result.summary}`);
        sendSSE('vision_injected', {
          source: 'xai_vision_sidecar',
          model: result.model,
          fallbackFrom: result.fallback_from,
        });
      } else {
        summaries.push(`- ${name}: vision sidecar failed (${String(result.error || 'unknown error').slice(0, 220)})`);
      }
    }
    if (summaries.length) {
      attachmentVisionSidecarBlock = [
        '[ATTACHMENT_VISION_SUMMARY]',
        'The active xAI Composer model cannot receive raw image payloads. A vision sidecar inspected the image attachment(s) and produced this summary for the active model:',
        ...summaries,
      ].join('\n');
    }
  }
  if (attachments && attachments.length > 0 && currentModelCapabilities.hasVision) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: message },
        ...attachments.map(a => buildVisionImagePart(a.base64, a.mimeType)),
      ],
    });
  } else if (attachments && attachments.length > 0 && !currentModelCapabilities.hasVision) {
    const attachmentNames = attachments
      .map((a) => String(a?.name || a?.mimeType || 'attachment').trim())
      .filter(Boolean)
      .slice(0, 8)
      .join(', ');
    messages.push({
      role: 'user',
      content: `${message}${attachmentVisionSidecarBlock ? `\n\n${attachmentVisionSidecarBlock}` : ''}\n\n[ATTACHMENT_NOTICE]\n${attachments.length} image/media attachment(s) were received (${attachmentNames || 'unnamed'}), but the active model is not vision-capable, so raw image payloads were not injected.${attachmentVisionSidecarBlock ? ' Use the sidecar summary above as the visual context for this turn.' : ' Continue with filenames, metadata, surrounding text, OCR/tool outputs, or ask for a vision-capable switch only if direct image interpretation is essential.'}`,
    });
  } else {
    messages.push({ role: 'user', content: message });
  }

  // ── Browser observation policy layer ──────────────────────────────────────────────
  type ObserveMode = BrowserObserveMode;
  const BROWSER_OBSERVE_TOOLS = new Set([
    'browser_wait',
    'browser_get_page_text',
    'browser_get_focused_item',
    'browser_click',
    'browser_fill',
    'browser_upload_file',
    'browser_press_key',
    'browser_key',
    'browser_drag',
    'browser_click_and_download',
    'browser_scroll_collect',
    'browser_scroll',
    'browser_open',
    'browser_vision_click',
    'browser_snapshot',
    'browser_snapshot_delta',
    'browser_vision_screenshot',
    'browser_vision_type',
    'browser_send_to_telegram',
    'browser_run_js',
  ]);
  const maybeAppendVisionScreenshotForTool = async (
    toolName: string,
    toolResult?: { error?: boolean; data?: any },
    toolInput?: Record<string, any>,
  ): Promise<void> => {
    if (toolName === 'creative_render_snapshot' || toolName === 'creative_get_state' || toolName === 'video_render_frame' || toolName === 'video_render_contact_sheet' || toolName === 'video_analyze_frame' || toolName === 'video_extract_clip_frames') {
      if (toolResult?.error || !currentModelCapabilities.hasVision) return;
      const rawFrames = Array.isArray(toolResult?.data?.snapshots)
        ? toolResult?.data?.snapshots
        : (toolResult?.data?.snapshot ? [toolResult.data.snapshot] : []);
      const frames = rawFrames
        .map((frame: any) => {
          const dataUrl = String(frame?.dataUrl || '').trim();
          const match = dataUrl.match(/^data:([^,]+);base64,(.+)$/);
          if (!match) return null;
          return {
            mimeType: String(match[1] || 'image/png').split(';')[0] || 'image/png',
            base64: match[2] || '',
            width: Number(frame?.width || 0),
            height: Number(frame?.height || 0),
            atMs: frame?.atMs,
          };
        })
        .filter(Boolean);
      if (!frames.length) {
        sendSSE('info', { message: 'Creative frame injection requested, but no image frames were returned.' });
        return;
      }
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `[CREATIVE_DIRECT_FRAME_OBSERVATION]\n` +
              `These are the rendered frame images from the active creative workspace. Use your own visual perception of these frames as direct context for the next step; no separate critic summary has been run.\n` +
              `Frames: ${frames.map((frame: any, index: number) => `#${index + 1} ${frame.width}x${frame.height}${Number.isFinite(Number(frame.atMs)) ? ` @ ${frame.atMs}ms` : ''}`).join(', ')}`,
          },
          ...frames.map((frame: any) => buildVisionImagePart(frame.base64, frame.mimeType)),
        ],
      });
      sendSSE('vision_injected', { source: 'creative', tool: toolName, frames: frames.length });
      sendSSE('info', { message: `Creative rendered frame vision injected (${frames.length} frame${frames.length === 1 ? '' : 's'}).` });
      return;
    }
    // Desktop tools have their own handling
    if (toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot') {
      // Keep existing desktop behavior — always inject on success
      if (toolResult?.error) return;
      const visionMessage = buildVisionScreenshotMessage(sessionId, 'desktop');
      if (visionMessage) {
        messages.push(visionMessage);
        sendSSE('vision_injected', { source: 'desktop', tool: toolName, preview: buildVisionInjectedPreviewPayload(visionMessage) });
        sendSSE('info', { message: `Vision screenshot injected (desktop) after ${toolName}.` });
      }
      return;
    }

    // Browser tool observation policy
    if (!BROWSER_OBSERVE_TOOLS.has(toolName)) return;

    // 1. Determine effective observe mode
    let effectiveMode: ObserveMode = toolResult?.error
      ? 'screenshot'
      : resolveBrowserObserveMode(toolName, toolInput?.observe);

    // 2. Execute the chosen observation mode
    if (effectiveMode === 'none' || effectiveMode === 'compact') return;

    if (effectiveMode === 'delta') {
      // Use lightweight DOM delta instead of full vision
      try {
        const delta = await browserSnapshotDelta(sessionId);
        if (delta) {
          messages.push({
            role: 'user',
            content: [{ type: 'text', text: `[SYSTEM: DOM delta after ${toolName}]\n${delta}` }],
          });
          sendSSE('info', { message: `DOM delta injected (browser) after ${toolName}.` });
        }
      } catch {}
      return;
    }

    if (effectiveMode === 'snapshot') {
      // Snapshot already returns DOM refs — no auto-injection needed
      // EXCEPT for browser_open: also inject screenshot so AI sees both DOM and visual
      if (toolName !== 'browser_open') return;
      effectiveMode = 'screenshot'; // Force screenshot injection for navigation
    }

    if (effectiveMode === 'screenshot') {
      // Full vision screenshot
      try { await browserVisionScreenshot(sessionId); } catch {}
      const visionMessage = buildVisionScreenshotMessage(sessionId, 'browser');
      if (visionMessage) {
        messages.push(visionMessage);
        sendSSE('vision_injected', { source: 'browser', tool: toolName, preview: buildVisionInjectedPreviewPayload(visionMessage) });
        sendSSE('info', { message: `Vision screenshot injected (browser) after ${toolName}.` });
      } else {
        sendSSE('info', { message: `Vision screenshot unavailable (browser) after ${toolName}.` });
      }
    }
  };

  type PreActionObservationContext = {
    browserBefore: BrowserObservationPageState | null;
    desktopBefore: DesktopObservationPacketState | null;
  };

  type AppliedObservationContext = {
    decision: PostActionObservationDecision;
    browserAfterPacket: BrowserAdvisorPacket | null;
    advisorTriggerToolName: string;
    advisorTriggerToolArgs: Record<string, any>;
    advisorTriggerToolResult: ToolResult;
  };

  const isDesktopVisualToolName = (toolName: string): boolean =>
    toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot';

  const countRecentToolRepeats = (toolName: string, toolArgs: Record<string, any>): number => {
    const argsHash = hashArgs(toolArgs);
    const loopRepeats = recentToolCalls.filter((t) => t.name === toolName && t.argsHash === argsHash).length;
    const priorRepeats = allToolResults.filter((result) =>
      result.name === toolName && hashArgs(result.args) === argsHash,
    ).length;
    return Math.max(1, loopRepeats, priorRepeats + 1);
  };

  const countRecentToolFailures = (toolName: string, toolArgs: Record<string, any>): number => {
    const argsHash = hashArgs(toolArgs);
    return allToolResults.filter((result) =>
      result.error && result.name === toolName && hashArgs(result.args) === argsHash,
    ).length;
  };

  const isExplicitLowOverheadBrowserObserve = (
    toolName: string,
    toolArgs: Record<string, any> = {},
  ): boolean => {
    if (!isBrowserToolName(toolName)) return false;
    if (!Object.prototype.hasOwnProperty.call(toolArgs || {}, 'observe')) return false;
    const mode = resolveBrowserObserveMode(toolName, toolArgs?.observe);
    return mode === 'none' || mode === 'compact';
  };

  const captureObservationPreContext = async (
    toolName: string,
    toolArgs: Record<string, any> = {},
  ): Promise<PreActionObservationContext> => {
    let browserBefore: BrowserObservationPageState | null = null;
    let desktopBefore: DesktopObservationPacketState | null = null;

    if (isBrowserToolName(toolName) && !isExplicitLowOverheadBrowserObserve(toolName, toolArgs)) {
      const sessionInfo = getBrowserSessionInfo(sessionId);
      const packet = sessionInfo.active
        ? await getBrowserAdvisorPacket(sessionId, { maxItems: 0, snapshotElements: 48 }).catch(() => null)
        : null;
      browserBefore = summarizeBrowserObservationState(packet, sessionInfo.active ? sessionInfo : null);
    }

    if (isDesktopToolName(toolName)) {
      desktopBefore = summarizeDesktopObservationState(getDesktopAdvisorPacket(sessionId));
    }

    return { browserBefore, desktopBefore };
  };

  const buildObservationDecisionForTool = async (
    toolName: string,
    toolArgs: Record<string, any>,
    toolResult: ToolResult,
    preContext: PreActionObservationContext,
  ): Promise<{
    decision: PostActionObservationDecision;
    browserAfterPacket: BrowserAdvisorPacket | null;
  }> => {
    let browserAfterPacket: BrowserAdvisorPacket | null = null;
    let browserAfter: BrowserObservationPageState | null = null;
    let desktopAfter: DesktopObservationPacketState | null = null;
    const isBrowserTool = isBrowserToolName(toolName);
    const isDesktopTool = isDesktopToolName(toolName);
    const requestedBrowserMode = isBrowserTool
      ? resolveBrowserObserveMode(toolName, toolArgs?.observe)
      : undefined;
    const hasObserveOverride = Object.prototype.hasOwnProperty.call(toolArgs || {}, 'observe')
      && toolArgs?.observe !== undefined;

    if (isBrowserTool && !isExplicitLowOverheadBrowserObserve(toolName, toolArgs)) {
      const sessionInfo = getBrowserSessionInfo(sessionId);
      browserAfterPacket = sessionInfo.active
        ? await getBrowserAdvisorPacket(sessionId, { maxItems: 0, snapshotElements: 48 }).catch(() => null)
        : null;
      browserAfter = summarizeBrowserObservationState(browserAfterPacket, sessionInfo.active ? sessionInfo : null);
    }

    if (isDesktopTool) {
      desktopAfter = summarizeDesktopObservationState(getDesktopAdvisorPacket(sessionId));
    }

    const decision = decidePostActionObservation({
      toolName,
      args: toolArgs,
      requestedMode: requestedBrowserMode,
      hasObserveOverride,
      error: toolResult.error,
      resultText: toolResult.result,
      recentRepeats: countRecentToolRepeats(toolName, toolArgs),
      recentFailures: countRecentToolFailures(toolName, toolArgs),
      browser: {
        before: preContext.browserBefore,
        after: browserAfter,
      },
      desktop: {
        before: preContext.desktopBefore,
        after: desktopAfter,
      },
    });

    return { decision, browserAfterPacket };
  };

  const appendBrowserDeltaObservation = async (
    toolName: string,
    reason: string,
  ): Promise<void> => {
    try {
      const delta = await browserSnapshotDelta(sessionId);
      if (!delta) return;
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `[SYSTEM: DOM delta after ${toolName}]\n${delta}` }],
      });
      sendSSE('info', { message: `DOM delta injected (browser) after ${toolName}: ${reason}.` });
    } catch {
      // Best-effort only.
    }
  };

  const appendBrowserVisionObservation = async (
    toolName: string,
    reason: string,
    options?: { reuseExisting?: boolean },
  ): Promise<void> => {
    let visionMessage = options?.reuseExisting
      ? buildVisionScreenshotMessage(sessionId, 'browser')
      : null;

    if (!visionMessage) {
      try { await browserVisionScreenshot(sessionId); } catch {}
      visionMessage = buildVisionScreenshotMessage(sessionId, 'browser');
    }

    if (visionMessage) {
      messages.push(visionMessage);
      sendSSE('vision_injected', { source: 'browser', tool: toolName, preview: buildVisionInjectedPreviewPayload(visionMessage) });
      sendSSE('info', { message: `Vision screenshot injected (browser) after ${toolName}: ${reason}.` });
    } else {
      sendSSE('info', { message: `Vision screenshot unavailable (browser) after ${toolName}: ${reason}.` });
    }
  };

  const appendObservationArtifacts = async (
    toolName: string,
    toolArgs: Record<string, any>,
    toolResult: ToolResult,
    decision: PostActionObservationDecision,
  ): Promise<void> => {
    if (toolName === 'creative_render_snapshot' || toolName === 'creative_get_state' || toolName === 'video_render_frame' || toolName === 'video_render_contact_sheet' || toolName === 'video_analyze_frame' || toolName === 'video_extract_clip_frames') {
      await maybeAppendVisionScreenshotForTool(toolName, toolResult, toolArgs);
      return;
    }
    if (isDesktopVisualToolName(toolName)) {
      await maybeAppendVisionScreenshotForTool(toolName, toolResult, toolArgs);
      return;
    }
    if (!isBrowserToolName(toolName)) return;
    if (decision.mode === 'none' || decision.mode === 'snapshot') return;
    if (decision.mode === 'delta') {
      if (toolName !== 'browser_snapshot_delta') {
        await appendBrowserDeltaObservation(toolName, decision.reason);
      }
      return;
    }
    if (decision.mode === 'screenshot') {
      await appendBrowserVisionObservation(
        toolName,
        decision.reason,
        { reuseExisting: toolName === 'browser_vision_screenshot' },
      );
    }
  };

  const applySharedPostActionObservation = async (
    toolName: string,
    toolArgs: Record<string, any>,
    toolResult: ToolResult,
    preContext: PreActionObservationContext,
  ): Promise<AppliedObservationContext> => {
    const { decision, browserAfterPacket } = await buildObservationDecisionForTool(
      toolName,
      toolArgs,
      toolResult,
      preContext,
    );

    let advisorTriggerToolName = toolName;
    let advisorTriggerToolArgs = toolArgs;
    let advisorTriggerToolResult = toolResult;

    await appendObservationArtifacts(toolName, toolArgs, toolResult, decision);

    if (
      isDesktopToolName(toolName)
      && !isDesktopVisualToolName(toolName)
      && decision.mode === 'screenshot'
    ) {
      try {
        await desktopWait(350);
        const autoToolName: 'desktop_screenshot' = 'desktop_screenshot';
        const activeMonitorIndex = await desktopGetActiveMonitorIndex();
        const autoToolArgs = activeMonitorIndex !== null ? { capture: activeMonitorIndex } : {};
        let autoShot = activeMonitorIndex !== null
          ? await desktopScreenshotWithHistory(sessionId, { capture: activeMonitorIndex })
          : await desktopScreenshotWithHistory(sessionId);
        if (String(autoShot).startsWith('ERROR')) {
          autoShot = await desktopScreenshotWithHistory(sessionId);
        }
        const syntheticResult: ToolResult = {
          name: autoToolName,
          args: autoToolArgs,
          result: autoShot,
          error: String(autoShot).startsWith('ERROR'),
        };
        const autoShotContent = boundToolMessageContentForModelContext(
          buildDesktopScreenshotContent(syntheticResult, sessionId, ''),
          autoToolName,
        );
        messages.push({
          role: 'tool',
          tool_name: autoToolName,
          content: typeof autoShotContent === 'string'
            ? `[Auto-screenshot after ${toolName}: ${decision.reason}]\n${autoShotContent}`
            : autoShotContent,
        });
        await maybeAppendVisionScreenshotForTool(autoToolName, syntheticResult, autoToolArgs);
        sendSSE('tool_result', {
          action: autoToolName,
          result: autoShot.slice(0, 300),
          error: syntheticResult.error,
          stepNum: allToolResults.length,
          synthetic: true,
        });
        if (!syntheticResult.error) {
          advisorTriggerToolName = autoToolName;
          advisorTriggerToolArgs = autoToolArgs;
          advisorTriggerToolResult = syntheticResult;
        }
      } catch {
        // Non-fatal: continue without synthetic screenshot.
      }
    }

    return {
      decision,
      browserAfterPacket,
      advisorTriggerToolName,
      advisorTriggerToolArgs,
      advisorTriggerToolResult,
    };
  };

  const continuationCue = isContinuationCue(message);
  const pendingExecutionFromHistory = continuationCue && hasPendingExecutionIntent(
    history.map((h) => ({ role: h.role, content: h.content })),
  );
  if (pendingExecutionFromHistory) {
    messages.push({
      role: 'assistant',
      content: 'Understood. Continuing execution.',
    });
    messages.push({
      role: 'user',
      content: 'Continue the in-progress task now. Do not restate intent. Call the next required tool immediately.',
    });
  }

  const replaceCurrentUserPromptWithAdvisorObjective = (objective: string): boolean => {
    const objectiveText = String(objective || '').trim();
    if (!objectiveText) return false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role !== 'user') continue;
      if (String(msg?.content || '') !== message) continue;
      messages.splice(i, 1);
      break;
    }
    messages.push({ role: 'user', content: objectiveText });
    messages.push({
      role: 'assistant',
      content: 'Understood. I will execute this objective and preserve literal values from the request.',
    });
    return true;
  };

  const buildSecondaryAssistContext = () => {
    const availableTools = (tools || [])
      .map((t: any) => String(t?.function?.name || '').trim())
      .filter(Boolean);

    const recentToolExecutions = allToolResults.slice(-24).map((tr, idx, arr) => {
      const step = allToolResults.length - arr.length + idx + 1;
      return {
        step,
        name: String(tr.name || '').slice(0, 80),
        args: tr.args ?? {},
        result: String(tr.result || '').slice(0, 6000),
        error: tr.error === true,
      };
    });

    const recentModelMessages = (messages || [])
      .slice(-60)
      .map((m: any) => {
        const role = String(m?.role || '').trim();
        if (!role || !['user', 'assistant', 'tool'].includes(role)) return null;

        let content = String(m?.content || '');
        if (role === 'assistant' && Array.isArray(m?.tool_calls) && m.tool_calls.length) {
          const toolCallSummary = m.tool_calls
            .slice(0, 10)
            .map((c: any) => {
              const n = String(c?.function?.name || 'unknown');
              let a = '{}';
              try { a = JSON.stringify(c?.function?.arguments || {}); } catch {}
              return `${n}(${a.slice(0, 240)})`;
            })
            .join(' | ');
          content = content
            ? `${content}\nTOOL_CALLS: ${toolCallSummary}`
            : `TOOL_CALLS: ${toolCallSummary}`;
        } else if (role === 'tool') {
          const toolName = String(m?.tool_name || 'tool');
          content = `${toolName}: ${content}`;
        }

        const trimmed = content.replace(/\r/g, '').trim();
        if (!trimmed) return null;
        return { role, content: trimmed.slice(0, 2200) };
      })
      .filter(Boolean)
      .slice(-28) as Array<{ role: string; content: string }>;

    let latestBrowserSnapshot = '';
    let latestDesktopSnapshot = '';
    for (let i = allToolResults.length - 1; i >= 0; i--) {
      const tr = allToolResults[i];
      if (!tr || typeof tr.name !== 'string') continue;
      const txt = String(tr.result || '').trim();
      if (!txt) continue;
      if (!latestBrowserSnapshot && tr.name.startsWith('browser_')) {
        latestBrowserSnapshot = txt.slice(0, 7000);
      }
      if (!latestDesktopSnapshot && tr.name.startsWith('desktop_')) {
        latestDesktopSnapshot = txt.slice(0, 7000);
      }
      if (latestBrowserSnapshot && latestDesktopSnapshot) break;
    }

    return {
      availableTools,
      recentToolExecutions,
      recentModelMessages,
      recentProcessNotes: orchestrationLog.slice(-28),
      latestBrowserSnapshot,
      latestDesktopSnapshot,
    };
  };

  const rawOrchCfg = ((getConfig().getConfig() as any).orchestration || {}) as any;

  // Optional preflight advisor pass: secondary model can route and provide
  // a compact execution plan before primary starts tool calling.
  const preflightCfg = orchestrationSkillEnabled ? getOrchestrationConfig() : null;
  if (!preflightCfg?.enabled && String(rawOrchCfg?.preflight?.mode || '') === 'always') {
    sendSSE('info', {
      message: 'Preflight advisor is set to Always, but Multi-Agent Orchestrator skill is disabled.',
    });
  }
  const skipGenericPreflightForFileOp = fileOpV2Active;
  if (skipGenericPreflightForFileOp) {
    sendSSE('info', {
      message: `FILE_OP v2 route selected (${fileOpType}); skipping generic advisor preflight.`,
    });
  }
  // Task runner sessions (sessionId starts with 'task_') are already inside a background task
  // execution — skip preflight entirely to prevent recursive task spawning loops.
  const isTaskRunnerSession = sessionId.startsWith('task_');

  if (
    preflightCfg?.enabled &&
    !isBootStartupTurn &&
    !skipGenericPreflightForFileOp &&
    !isTaskRunnerSession &&
    shouldRunPreflight(message, preflightCfg.preflight.mode) &&
    orchestrationStats.assistCount < preflightCfg.limits.max_assists_per_session
  ) {
    sendSSE('info', {
      message: `Running advisor preflight via ${preflightCfg.secondary.provider}:${preflightCfg.secondary.model}...`,
    });
    console.log(
      `[Orchestrator] Preflight start (${preflightCfg.secondary.provider}:${preflightCfg.secondary.model})`,
    );
    const preflightBlockedTask = findBlockedTaskForSession(sessionId);
    const preflight = await callSecondaryPreflight({
      userMessage: message,
      recentHistory: history.slice(-4).map(h => ({ role: h.role, content: h.content })),
      blockedTask: preflightBlockedTask
        ? {
            id: preflightBlockedTask.id,
            title: preflightBlockedTask.title,
            // Clarify the status in human terms for the preflight prompt
            status: preflightBlockedTask.status === 'awaiting_user_input'
              ? 'awaiting_user_input (task asked user a question and is paused until they answer)'
              : preflightBlockedTask.status,
            currentStepIndex: preflightBlockedTask.currentStepIndex,
            planLength: Array.isArray(preflightBlockedTask.plan) ? preflightBlockedTask.plan.length : 0,
            pauseReason: preflightBlockedTask.pauseReason,
          }
        : undefined,
    });

    if (preflight) {
      preflightRoute = preflight.route;
      preflightReasonForTurn = String(preflight.reason || '').trim();
      orchestrationLog.push(`[preflight:${preflight.route}] ${preflight.reason || 'no reason'}`);
      console.log(
        `[Orchestrator] Preflight route=${preflight.route} reason=${(preflight.reason || 'n/a').slice(0, 120)}`,
      );
      const stats = recordOrchestrationEvent(
        sessionId,
        {
          trigger: 'preflight',
          mode: 'planner',
          reason: preflight.reason || 'preflight routing',
          route: preflight.route,
        },
        preflightCfg,
      );
      sendSSE('orchestration', {
        trigger: 'preflight',
        mode: 'planner',
        route: preflight.route,
        reason: preflight.reason,
        preflight,
        assist_count: stats.assistCount,
        assist_cap: preflightCfg.limits.max_assists_per_session,
      });
      const preflightProgressSteps = (
        Array.isArray((preflight as any)?.quick_plan) ? (preflight as any).quick_plan
          : Array.isArray((preflight as any)?.task_plan) ? (preflight as any).task_plan
            : []
      )
        .map((line: any) => String(line || '').trim())
        .filter(Boolean)
        .slice(0, 6);
      if (preflightProgressSteps.length >= 2) {
        seedProgressFromLines(preflightProgressSteps, 'preflight');
      }

      // ── Background task route ────────────────────────────────────────────
      // Telegram sessions: never use background_task mode — run inline like normal chat.
      // Background tasks lose the browser session aliasing and use a broken tool-arg
      // serialisation path that causes browser_open to receive JSON strings instead of objects.
      const isTelegramSession = String(sessionId || '').startsWith('telegram_');
      if (preflight.route === 'background_task' && multiAgentActive && !isTelegramSession) {
        const taskTitle = preflight.task_title || 'Background Task';
        const taskPlan = (preflight.task_plan || []).map((desc: string, i: number) => ({
          index: i,
          description: desc,
          status: 'pending' as const,
        }));
        const taskChannel = inferTaskChannelFromSession(sessionId);
        const parsedTelegramChatId = taskChannel === 'telegram'
          ? Number(String(sessionId || '').replace(/^telegram_/, ''))
          : NaN;
        const telegramChatId = Number.isFinite(parsedTelegramChatId) && parsedTelegramChatId > 0
          ? parsedTelegramChatId
          : undefined;
        const task = createTask({
          title: taskTitle,
          prompt: message,
          sessionId,
          channel: taskChannel,
          telegramChatId,
          plan: taskPlan.length > 0 ? taskPlan : [{ index: 0, description: 'Execute task', status: 'pending' }],
        });
        appendJournal(task.id, { type: 'status_push', content: `Task queued: ${taskTitle}` });
        // Issue 11: Seed runtimeProgress from the preflight plan immediately so the task
        // panel shows steps before the BackgroundTaskRunner starts its first round.
        // declare_plan inside handleChat will overwrite this once the runner fires.
        if (preflightProgressSteps.length >= 2) {
          updateTaskRuntimeProgress(task.id, {
            source: 'preflight',
            activeIndex: 0,
            items: preflightProgressSteps.map((text: string, idx: number) => ({
              id: `p${idx + 1}`,
              text,
              status: idx === 0 ? 'in_progress' : 'pending',
            })),
          });
          // Also emit progress_state over the current HTTP SSE stream so the
          // task panel widget in the active chat session sees the plan instantly.
          sendSSE('progress_state', {
            source: 'preflight',
            reason: 'background_task_queued',
            activeIndex: 0,
            total: preflightProgressSteps.length,
            items: preflightProgressSteps.map((text: string, idx: number) => ({
              id: `p${idx + 1}`,
              index: idx,
              text,
              status: idx === 0 ? 'in_progress' : 'pending',
            })),
          });
        }
        // Fire background runner (detached — does not block HTTP response)
        const runner = new BackgroundTaskRunner(task.id, handleChat, makeBroadcastForTask(task.id), _telegramChannel);
        runner.start().catch(err => console.error(`[BackgroundTaskRunner] Task ${task.id} error:`, err.message));
        const queuedMessage = preflight.friendly_queued_message
          || `On it! I've queued "${taskTitle}" as a background task. You can track progress in the Tasks panel.`;
        sendSSE('task_queued', { taskId: task.id, title: taskTitle });
        addMessage(sessionId, { role: 'assistant', content: queuedMessage, timestamp: Date.now() });
        return { type: 'chat', text: queuedMessage };
      }

      if (
        preflight.route === 'secondary_chat' &&
        preflightCfg.preflight.allow_secondary_chat &&
        preflight.secondary_response?.trim()
      ) {
        sendSSE('info', {
          message: 'Advisor route selected secondary_chat. Returning secondary response directly.',
        });
        const text = preflight.secondary_response.trim();
        return { type: 'chat', text };
      }

      if (preflight.route === 'secondary_chat' && !preflightCfg.preflight.allow_secondary_chat) {
        sendSSE('info', {
          message: 'Advisor suggested secondary_chat, but direct secondary chat is disabled. Continuing with primary.',
        });
      } else if (preflight.route === 'primary_direct') {
        sendSSE('info', { message: 'Advisor route selected primary_direct. Continuing with primary response.' });
        // If the advisor provided an executor_objective (e.g. agent_inspection → call agent_list),
        // inject it as a hint so the primary model follows the instruction instead of guessing.
        if (preflight.executor_objective && preflight.executor_objective.trim()) {
          const directHint = formatPreflightExecutionObjective(preflight);
          messages.push({ role: 'user', content: directHint });
          messages.push({ role: 'assistant', content: 'Understood. I will follow this guidance.' });
        }
      } else if (preflight.route === 'primary_with_plan') {
        // primary_with_plan is retired when multi-agent is active — upgrade to background_task
        // Exception: Telegram sessions always stay inline (no background tasks).
        if (multiAgentActive && !isTelegramSession) {
          sendSSE('info', { message: 'Advisor returned primary_with_plan but multi-agent is active — upgrading to background_task.' });
          const taskTitle = preflight.task_title || (preflight.reason ? preflight.reason.slice(0, 60) : 'Background Task');
          const taskPlan = (preflight.task_plan || preflight.quick_plan || []).map((desc: string, i: number) => ({
            index: i, description: desc, status: 'pending' as const,
          }));
          const taskChannel = inferTaskChannelFromSession(sessionId);
          const parsedTelegramChatId = taskChannel === 'telegram'
            ? Number(String(sessionId || '').replace(/^telegram_/, ''))
            : NaN;
          const telegramChatId = Number.isFinite(parsedTelegramChatId) && parsedTelegramChatId > 0
            ? parsedTelegramChatId
            : undefined;
          const task = createTask({
            title: taskTitle,
            prompt: message,
            sessionId,
            channel: taskChannel,
            telegramChatId,
            plan: taskPlan.length > 0 ? taskPlan : [{ index: 0, description: 'Execute task', status: 'pending' }],
          });
          appendJournal(task.id, { type: 'status_push', content: `Task queued (upgraded from primary_with_plan): ${taskTitle}` });
          const runner = new BackgroundTaskRunner(task.id, handleChat, makeBroadcastForTask(task.id), _telegramChannel);
          runner.start().catch((err: Error) => console.error(`[BackgroundTaskRunner] Task ${task.id} error:`, err.message));
          const queuedMessage = preflight.friendly_queued_message
            || `On it! I've queued "${taskTitle}" as a background task. You can track progress in the Tasks panel.`;
          sendSSE('task_queued', { taskId: task.id, title: taskTitle });
          addMessage(sessionId, { role: 'assistant', content: queuedMessage, timestamp: Date.now() });
          return { type: 'chat', text: queuedMessage };
        }
        sendSSE('info', { message: 'Advisor route selected primary_with_plan. Injecting execution objective and plan guidance.' });
      }

      const shouldInjectObjective = preflight.route === 'primary_with_plan';
      if (shouldInjectObjective) {
        const objectiveHint = formatPreflightExecutionObjective(preflight);
        const injected = replaceCurrentUserPromptWithAdvisorObjective(objectiveHint);
        if (!injected) {
          sendSSE('warn', {
            message: 'Advisor objective injection failed; falling back to raw user prompt.',
          });
        }
      }

      if (preflight.route === 'primary_with_plan') {
        const hint = formatPreflightHint(preflight);
        messages.push({ role: 'user', content: hint });
        messages.push({ role: 'assistant', content: 'Understood. I will follow this preflight guidance.' });
      }
    }
  } else if (
    preflightCfg?.enabled &&
    !isBootStartupTurn &&
    !isTaskRunnerSession &&
    shouldRunPreflight(message, preflightCfg.preflight.mode) &&
    orchestrationStats.assistCount >= preflightCfg.limits.max_assists_per_session
  ) {
    sendSSE('info', { message: 'Advisor preflight skipped: session assist cap reached.' });
  }

  const resetBrowserAdvisorCollection = () => {
    browserAdvisorCollectedFeed.length = 0;
    browserAdvisorSeenFeedKeys.clear();
    browserAdvisorDedupeCount = 0;
    browserAdvisorBatch = 0;
    browserAdvisorLastHash = '';
    consecutiveUnchangedSnapshots = 0;
    browserNoFeedProgressStreak = 0;
    browserStabilizeUrlKey = '';
    browserStabilizeWaitRetries = 0;
    browserStabilizeTabProbes = 0;
    browserStabilizeExhausted = false;
    browserVisionModeActive = false;
  };

  const toUrlKey = (rawUrl: string): string => {
    try {
      const u = new URL(String(rawUrl || ''));
      return `${u.hostname}${u.pathname}`.toLowerCase();
    } catch {
      return String(rawUrl || '').toLowerCase().split('?')[0];
    }
  };

  const feedItemKey = (item: Record<string, any>): string => {
    if (item?.id) return `id:${String(item.id)}`;
    if (item?.link) return `link:${String(item.link)}`;
    const text = String(item?.text || item?.snippet || item?.title || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const handle = String(item?.handle || item?.author || '').toLowerCase();
    const time = String(item?.time || '').slice(0, 40);
    return `hash:${handle}|${time}|${text}`;
  };

  const mergeBrowserFeedBatch = (batch: Array<Record<string, any>>): { added: number; deduped: number; total: number } => {
    let added = 0;
    let deduped = 0;
    for (const raw of batch || []) {
      const item = raw && typeof raw === 'object' ? raw : {};
      const key = feedItemKey(item);
      if (!key || browserAdvisorSeenFeedKeys.has(key)) {
        deduped++;
        continue;
      }
      browserAdvisorSeenFeedKeys.add(key);
      browserAdvisorCollectedFeed.push(item);
      if (browserAdvisorCollectedFeed.length > browserMaxCollectedItems) {
        browserAdvisorCollectedFeed.shift();
      }
      added++;
    }
    browserAdvisorDedupeCount += deduped;
    return { added, deduped, total: browserAdvisorCollectedFeed.length };
  };

  const maybeRunBrowserAdvisorPass = async (
    triggerToolName: string,
    triggerResult: ToolResult,
    triggerToolArgs?: Record<string, any>,
    decision?: PostActionObservationDecision,
    prefetchedPacket?: BrowserAdvisorPacket | null,
  ): Promise<void> => {
    if (!isBrowserToolName(triggerToolName)) return;
    if (decision && !decision.shouldRunAdvisor) return;
    if (!decision && triggerResult.error) return;
    const orchCfg = getOrchestrationConfig();
    if (!orchestrationSkillEnabled || !orchCfg?.enabled) return;
    if (browserAdvisorCallsThisTurn >= browserMaxAdvisorCallsPerTurn) return;
    if (orchestrationStats.assistCount >= orchCfg.limits.max_assists_per_session) return;

    const packet = prefetchedPacket
      || await getBrowserAdvisorPacket(sessionId, { maxItems: browserPacketMaxItems, snapshotElements: 180 });
    if (!packet) return;
    const packetUrlKey = toUrlKey(packet.page.url);
    if (
      triggerToolName === 'browser_open'
      || (browserAdvisorUrlKey && packetUrlKey && packetUrlKey !== browserAdvisorUrlKey && !browserContinuationPending)
    ) {
      resetBrowserAdvisorCollection();
    }
    browserAdvisorUrlKey = packetUrlKey || browserAdvisorUrlKey;
    if (!browserStabilizeUrlKey || (packetUrlKey && packetUrlKey !== browserStabilizeUrlKey)) {
      browserStabilizeUrlKey = packetUrlKey || browserStabilizeUrlKey;
      browserStabilizeWaitRetries = 0;
      browserStabilizeTabProbes = 0;
      browserStabilizeExhausted = false;
      browserVisionModeActive = false; // new page — start in DOM mode
    }

    const isFeedOrSearchPage = packet.page.pageType === 'x_feed' || packet.page.pageType === 'search_results';
    const quality = evaluateBrowserSnapshotQuality(packet.snapshot, packet.snapshotElements, message);
    if (quality.low) {
      const diag = quality.diagnostics;
      const diagMsg = diag
        ? ` hidden=${diag.hidden}, unlabeled_non_input=${diag.unlabeledNonInput}, unnamed_input_included=${diag.unnamedInputIncluded}`
        : '';
      sendSSE('info', {
        message: `Snapshot quality low: elements=${quality.elementCount}, input_candidates=${quality.inputCandidates}, reasons=${quality.reasons.join(' | ')}.${diagMsg}`,
      });
      const logLine = `[snapshot_quality] low | elements=${quality.elementCount} | inputs=${quality.inputCandidates} | reasons=${quality.reasons.join('; ')}`;
      orchestrationLog.push(logLine.slice(0, 260));
    }

    const stabilizationEligibleTool = (
      triggerToolName === 'browser_open'
      || triggerToolName === 'browser_snapshot'
      || triggerToolName === 'browser_wait'
      || triggerToolName === 'browser_press_key'
    );
    const stabilizationEligiblePage = packet.page.pageType === 'generic' || packet.page.pageType === 'article';
    const shouldAutoStabilize =
      quality.elementCount < 10
      || (goalLikelyNeedsTextInput(message) && quality.inputCandidates === 0);
    if (
      stabilizationEligibleTool
      && stabilizationEligiblePage
      && quality.low
      && shouldAutoStabilize
      && !isFeedOrSearchPage
      && !browserStabilizeExhausted
    ) {
      if (browserStabilizeWaitRetries < browserStabilizeMaxWaitRetries) {
        browserStabilizeWaitRetries += 1;
        browserContinuationPending = true;
        browserAdvisorRoute = 'continue_browser';
        browserAdvisorHintPreview = 'Snapshot stabilization in progress';
        pendingSyntheticToolCalls = [
          { function: { name: 'browser_wait', arguments: { ms: 1500 } } },
          { function: { name: 'browser_snapshot', arguments: {} } },
        ];
        sendSSE('info', {
          message: `Snapshot stabilization: wait+snapshot (${browserStabilizeWaitRetries}/${browserStabilizeMaxWaitRetries}) before advisor routing.`,
        });
        return;
      }

      const shouldProbeFocus = goalLikelyNeedsTextInput(message) && quality.inputCandidates === 0;
      if (shouldProbeFocus && browserStabilizeTabProbes < browserStabilizeMaxTabProbes) {
        browserStabilizeTabProbes += 1;
        browserContinuationPending = true;
        browserAdvisorRoute = 'continue_browser';
        browserAdvisorHintPreview = 'Input focus probe in progress';
        pendingSyntheticToolCalls = [
          { function: { name: 'browser_press_key', arguments: { key: 'Tab' } } },
          { function: { name: 'browser_wait', arguments: { ms: 500 } } },
          { function: { name: 'browser_snapshot', arguments: {} } },
        ];
        sendSSE('info', {
          message: `Snapshot stabilization: Tab focus probe (${browserStabilizeTabProbes}/${browserStabilizeMaxTabProbes}) to surface input controls.`,
        });
        return;
      }

      browserStabilizeExhausted = true;
      sendSSE('info', {
        message: 'Snapshot stabilization exhausted for this page; proceeding with current snapshot evidence.',
      });

      // ─── Component 4: Vision Fallback Trigger ───────────────────────────────────
      // After stabilization is exhausted AND DOM is still sparse, try vision fallback.
      // We capture a Playwright viewport screenshot and pass it to the advisor so it
      // can identify UI elements visually and route browser_vision_click/type instead.
      const orchCfgForVision = getOrchestrationConfig();
      const visionEligible =
        orchestrationSkillEnabled &&
        orchCfgForVision?.enabled &&
        quality.elementCount < 10 &&
        !browserVisionModeActive &&
        secondarySupportsVision(orchCfgForVision);

      if (visionEligible) {
        const vshot = await browserVisionScreenshot(sessionId);
        if (vshot) {
          browserVisionModeActive = true;
          sendSSE('info', {
            message: `Vision fallback activated: DOM has only ${quality.elementCount} elements. Capturing viewport screenshot for vision-guided routing.`,
          });
          sendSSE('browser_vision_mode', {
            active: true,
            elementCount: quality.elementCount,
            viewport: { width: vshot.width, height: vshot.height },
          });
          // The screenshot will be passed to the advisor on the next advisor call below.
          // We store it temporarily on the packet by augmenting the advisor input below.
          // Flag is read in the advisor input construction.
        } else {
          sendSSE('info', { message: 'Vision fallback: screenshot capture failed, proceeding without vision.' });
        }
      }
      // ───────────────────────────────────────────────────────────────────────
    } else if (
      !quality.low
      && (browserStabilizeWaitRetries > 0 || browserStabilizeTabProbes > 0 || browserVisionModeActive)
    ) {
      // DOM has recovered — exit vision mode if active
      if (browserVisionModeActive) {
        browserVisionModeActive = false;
        sendSSE('info', {
          message: `DOM recovered: ${quality.elementCount} elements visible. Exiting vision mode — switching back to DOM refs.`,
        });
        sendSSE('browser_vision_mode', { active: false, elementCount: quality.elementCount });
      } else {
        sendSSE('info', {
          message: `Snapshot stabilization complete: elements=${quality.elementCount}, input_candidates=${quality.inputCandidates}.`,
        });
      }
      browserStabilizeWaitRetries = 0;
      browserStabilizeTabProbes = 0;
      browserStabilizeExhausted = false;
    } else if (browserVisionModeActive && quality.elementCount >= 10) {
      // Vision mode active but DOM has now recovered — clear it
      browserVisionModeActive = false;
      sendSSE('info', {
        message: `DOM recovered to ${quality.elementCount} elements. Exiting vision mode.`,
      });
      sendSSE('browser_vision_mode', { active: false, elementCount: quality.elementCount });
    }

    if (
      !isBrowserHeavyResearchPage({
        url: packet.page.url,
        pageType: packet.page.pageType,
        snapshotElements: packet.snapshotElements,
        feedCount: packet.extractedFeed.length,
      })
    ) {
      return;
    }
    const hashUnchanged = packet.contentHash === browserAdvisorLastHash;
    if (hashUnchanged && !browserContinuationPending) {
      // On non-feed interactive pages, a stuck snapshot hash means the model is looping.
      // After 2 consecutive identical snapshots, force the advisor to run so it generates
      // a concrete @ref-based action instead of silently returning and letting the model re-snapshot.
      consecutiveUnchangedSnapshots += 1;
      if (consecutiveUnchangedSnapshots >= 2) {
        // Force advisor call — override the early return so it runs with existing data.
        // Applies to ALL page types including feed pages: if the snapshot hasn't changed,
        // the model is looping and needs a concrete directive from the advisor.
        browserContinuationPending = true;
        browserAdvisorRoute = 'continue_browser';
        browserAdvisorHintPreview = 'Snapshot unchanged — forcing advisor to generate concrete action';
        sendSSE('info', { message: `Snapshot hash unchanged (${consecutiveUnchangedSnapshots}x) — forcing browser advisor to generate concrete action.` });
        // Don't return — fall through to advisor call below
      } else {
        return;
      }
    } else {
      consecutiveUnchangedSnapshots = 0;
    }
    browserAdvisorLastHash = packet.contentHash;
    browserAdvisorCallsThisTurn += 1;
    browserAdvisorBatch += 1;

    const merged = mergeBrowserFeedBatch(packet.extractedFeed as Array<Record<string, any>>);
    const isFeedCollectionPage = packet.page.pageType === 'x_feed' || packet.page.pageType === 'search_results';
    if (isFeedCollectionPage) {
      browserNoFeedProgressStreak = merged.added > 0 ? 0 : (browserNoFeedProgressStreak + 1);
    } else {
      browserNoFeedProgressStreak = 0;
    }

    sendSSE('browser_advisor_start', {
      trigger_tool: triggerToolName,
      page_type: packet.page.pageType,
      url: packet.page.url,
      snapshot_elements: packet.snapshotElements,
      extracted_count: packet.extractedFeed.length,
    });
    sendSSE('feed_collected', {
      batch: browserAdvisorBatch,
      added: merged.added,
      total: merged.total,
      deduped: merged.deduped,
      url: packet.page.url,
    });

    const recentFailures = allToolResults
      .filter((r) => r.error)
      .slice(-4)
      .map((r) => `${r.name}: ${String(r.result || '').slice(0, 180)}`);

    const advisorFeed = browserAdvisorCollectedFeed.length > 0
      ? browserAdvisorCollectedFeed.slice(-browserMaxCollectedItems)
      : (packet.extractedFeed as Array<Record<string, any>>);

    // ── Change 5: chat_interface generation-wait — skip advisor, inject synthetic wait ──
    if (browserAutoSnapshotRetriesEnabled && packet.page.pageType === 'chat_interface' && packet.isGenerating) {
      sendSSE('info', { message: 'Browser: chat interface still generating — waiting for response before advising.' });
      pendingSyntheticToolCalls = [
        { function: { name: 'browser_wait', arguments: { ms: 3000 } } },
        { function: { name: 'browser_snapshot', arguments: {} } },
      ];
      return; // don't call advisor yet — next round will re-enter this function with fresh snapshot
    }

    // Component 4: capture fresh viewport screenshot for advisor when vision mode is active.
    // We do this every advisor call while vision mode is on so the advisor always has
    // the current page state, not a stale one from stabilization.
    let visionShotBase64: string | undefined;
    if (browserVisionModeActive) {
      const vshot = await browserVisionScreenshot(sessionId);
      visionShotBase64 = vshot?.base64;
    }

    let advisor = await callSecondaryBrowserAdvisor({
      goal: message,
      minFeedItemsBeforeAnswer: browserMinFeedItemsBeforeAnswer,
      page: {
        title: packet.page.title,
        url: packet.page.url,
        pageType: packet.page.pageType,
        snapshotElements: packet.snapshotElements,
      },
      extractedFeed: advisorFeed,
      textBlocks: packet.textBlocks,
      snapshot: packet.snapshot,
      scrollState: {
        batch: browserAdvisorBatch,
        total_collected: advisorFeed.length,
        dedupe_count: browserAdvisorDedupeCount,
      },
      lastActions: orchestrationLog.slice(-8),
      recentFailures,
      pageText: packet.pageText,
      isGenerating: packet.isGenerating,
      // Vision fields (only populated in vision mode)
      screenshotBase64: visionShotBase64,
      visionModeActive: browserVisionModeActive,
    });
    if (!advisor) return;

    // Guardrail: collect_more should only run on feed/search collection pages.
    // For generic pages (e.g. chatgpt.com composer), force decisive routing.
    if (advisor.route === 'collect_more' && !isFeedCollectionPage) {
      sendSSE('info', {
        message: 'Browser advisor override: collect_more disabled on non-feed page; switching to direct interaction mode.',
      });
      advisor = {
        ...advisor,
        route: 'handoff_primary',
        reason: 'collect_more disabled for non-feed pages; choose a concrete interaction from current snapshot.',
        next_tool: { tool: 'browser_snapshot', params: {} },
        primary_hint: 'Do not scroll/PageDown here. Use the current snapshot refs to click/fill the correct control directly.',
      };
    }

    // Guardrail: if feed collection is making no progress, stop scroll loops.
    if (
      advisor.route === 'collect_more'
      && isFeedCollectionPage
      && browserNoFeedProgressStreak >= 2
      && advisorFeed.length === 0
    ) {
      sendSSE('info', {
        message: 'Browser advisor override: collection stalled with zero extracted items; stopping scroll loop.',
      });
      advisor = {
        ...advisor,
        route: 'continue_browser',
        reason: 'No feed items extracted after repeated collection attempts; stop scrolling and select a concrete next interaction.',
        next_tool: { tool: 'browser_snapshot', params: {} },
        primary_hint: 'Collection is stalled (0 extracted). Do not keep PageDown looping. Use snapshot evidence and pick a concrete click/fill step.',
      };
    }

    if (advisor.route === 'collect_more') {
      if (!advisor.next_tool?.tool) {
        advisor = {
          ...advisor,
          next_tool: { tool: 'browser_press_key', params: { key: 'PageDown' } },
        };
      } else if (
        advisor.next_tool.tool === 'browser_press_key'
        && (!advisor.next_tool.params || !advisor.next_tool.params.key)
      ) {
        advisor = {
          ...advisor,
          next_tool: { tool: 'browser_press_key', params: { ...(advisor.next_tool.params || {}), key: 'PageDown' } },
        };
      }
    }

    const hint = formatBrowserAdvisorHint(advisor);
    const stats = recordOrchestrationEvent(
      sessionId,
      {
        trigger: 'auto',
        mode: 'planner',
        reason: `browser_advisor:${advisor.route}${advisor.reason ? ` (${advisor.reason})` : ''}`,
        route: advisor.route,
      },
      orchCfg,
    );

    browserAdvisorRoute = advisor.route;
    browserAdvisorHintPreview = String(advisor.primary_hint || advisor.reason || advisor.answer || '').slice(0, 220);
    browserContinuationPending = advisor.route === 'continue_browser' || advisor.route === 'collect_more' || advisor.route === 'vision_interact';
    if (!browserContinuationPending) {
      browserForcedRetries = 0;
    }

    sendSSE('browser_advisor_route', {
      route: advisor.route,
      reason: advisor.reason,
      answer: advisor.answer || '',
      primary_hint: advisor.primary_hint || '',
      next_tool: advisor.next_tool || null,
      collect_policy: advisor.collect_policy || null,
      raw_response: advisor.raw_response || '',
      assist_count: stats.assistCount,
      assist_cap: orchCfg.limits.max_assists_per_session,
    });
    sendSSE('browser_advisor_nudge', {
      route: advisor.route,
      preview: browserAdvisorHintPreview,
    });

    orchestrationLog.push(`[browser:${advisor.route}] ${String(advisor.reason || 'n/a').slice(0, 200)}`);

    // ── Synthetic tool call injection for deterministic collect_more scrolls ─────────
    // When the advisor says scroll (PageDown), skip LLM generation entirely.
    // Inject as a synthetic assistant message that the main loop executes directly.
    // This eliminates the 75s stall window between advisor directive and actual scroll.
    const isCollectMoreScroll = advisor.route === 'collect_more'
      && multiAgentActive
      && isFeedCollectionPage
      && advisor.next_tool?.tool === 'browser_press_key';
    const isCollectMoreWait = advisor.route === 'collect_more'
      && multiAgentActive
      && isFeedCollectionPage
      && advisor.next_tool?.tool === 'browser_wait';

    if (browserAutoSnapshotRetriesEnabled && (isCollectMoreScroll || isCollectMoreWait)) {
      // Queue synthetic tool calls: scroll + wait + snapshot (all deterministic)
      const scrollParams = advisor.next_tool!.params || { key: 'PageDown' };
      pendingSyntheticToolCalls = [
        { function: { name: advisor.next_tool!.tool, arguments: scrollParams } },
        { function: { name: 'browser_wait', arguments: { ms: 1500 } } },
        { function: { name: 'browser_snapshot', arguments: {} } },
      ];
      sendSSE('info', { message: `Advisor: synthetic scroll queued (${advisor.route}) — skipping LLM generation.` });
      // Push a compact hint so the LLM knows what happened after the synthetic round
      messages.push({ role: 'user', content: hint });
      messages.push({ role: 'assistant', content: `[ADVISOR] ${advisorFeed.length}/${browserMinFeedItemsBeforeAnswer} items. Scrolling for more.` });
      return;
    }

    // For non-deterministic steps, use the normal message injection path
    // ── Changes 2 & 3: context wipe + stripped executor system for browser ops ──────────
    // Secondary holds full state via buildSecondaryAssistContext().
    // Primary only needs: minimal system + original goal + last 4 tool acks + this directive.
    // Wipe now, before pushing the hint pair, so the hint ends up at the bottom cleanly.
    if (multiAgentActive) {
      const systemMsg = messages[0]; // always keep system at [0]
      // Stripped executor system — no editing rules, no identity prose, just tool list + 3 rules
      const strippedSystem = {
        role: 'system',
        content: `You are Prom. Execute browser tool calls exactly as instructed by the advisor directive below.

BROWSER TOOLS: browser_open, browser_snapshot, browser_click, browser_fill, browser_drag, browser_upload_file, browser_press_key, browser_wait, browser_scroll, browser_click_and_download, browser_close, web_fetch, download_url, download_media, generate_image, generate_video

RULES:
1. Call exactly the tool and params the advisor specifies.
2. Do not think, plan, or explain. Just call the tool.
3. Prefer snapshot/screenshot evidence over browser_run_js unless a JS inspection is explicitly required.
4. If the directive says answer_now, respond in 1-2 sentences using the provided draft.`,
      };
      // Keep last 4 tool-result messages so the LLM has minimal recent action context
      const recentToolMsgs = messages
        .filter((m: any) => m.role === 'tool')
        .slice(-4);
      // Rebuild messages: stripped system + goal + last 4 tool acks
      messages.length = 0;
      messages.push(strippedSystem);
      messages.push({ role: 'user', content: message });
      messages.push({ role: 'assistant', content: 'Understood. Executing browser task.' });
      for (const tm of recentToolMsgs) messages.push(tm);
    }

    messages.push({ role: 'user', content: hint });
    messages.push({ role: 'assistant', content: 'Understood. Continuing with browser advisor guidance.' });
    if (advisor.route === 'answer_now' && advisor.answer.trim()) {
      messages.push({
        role: 'user',
        content: `Use the browser evidence and answer now in 1-2 concise sentences. Draft answer: ${advisor.answer.slice(0, 700)}`,
      });
    } else if (advisor.next_tool?.tool) {
      const isWebFetchStep = advisor.next_tool.tool === 'web_fetch';
      const collectTail = advisor.route === 'collect_more' && !isWebFetchStep
        ? ' Then continue collection: if needed call browser_wait(1200), and capture browser_snapshot before deciding again only if new content should have loaded or the UI is still ambiguous.'
        : '';
      const webFetchNote = isWebFetchStep
        ? ' Use web_fetch (not browser_open) since you already have the URL and only need the text content.'
        : '';
      messages.push({
        role: 'user',
        content: `Immediate next step: call ${advisor.next_tool.tool} with params ${JSON.stringify(advisor.next_tool.params || {})}. Do not stop with intent text. After this step, capture browser_snapshot or browser_vision_screenshot only if state likely changed or the UI is ambiguous before deciding again.${collectTail}${webFetchNote}`,
      });
    }
  };

  const maybeRunDesktopAdvisorPass = async (
    triggerToolName: string,
    triggerResult: ToolResult,
    decision?: PostActionObservationDecision,
  ): Promise<void> => {
    if (!isDesktopToolName(triggerToolName)) return;
    if (decision && !decision.shouldRunAdvisor) return;
    if (!decision && triggerResult.error) return;
    if (!isDesktopVisualToolName(triggerToolName)) return;
    const orchCfg = getOrchestrationConfig();
    if (!orchestrationSkillEnabled || !orchCfg?.enabled) return;
    if (desktopAdvisorCallsThisTurn >= desktopMaxAdvisorCallsPerTurn) return;
    if (orchestrationStats.assistCount >= orchCfg.limits.max_assists_per_session) return;

    const packet = getDesktopAdvisorPacket(sessionId);
    if (!packet) return;

    desktopAdvisorCallsThisTurn += 1;
    sendSSE('desktop_advisor_start', {
      trigger_tool: triggerToolName,
      active_window: packet.activeWindow?.title || '',
      open_windows: packet.openWindows.length,
      width: packet.width,
      height: packet.height,
      ocr_confidence: Number(packet.ocrConfidence || 0),
      ocr_chars: String(packet.ocrText || '').length,
    });

    const recentFailures = allToolResults
      .filter((r) => r.error)
      .slice(-4)
      .map((r) => `${r.name}: ${String(r.result || '').slice(0, 180)}`);
    const clipboardPreview = (() => {
      for (let i = allToolResults.length - 1; i >= 0; i--) {
        const r = allToolResults[i];
        if (!r || r.error) continue;
        if (r.name !== 'desktop_get_clipboard') continue;
        return String(r.result || '').slice(0, 1200);
      }
      return '';
    })();

    const advisor = await callSecondaryDesktopAdvisor({
      goal: message,
      screenshot: {
        width: packet.width,
        height: packet.height,
        capturedAt: packet.capturedAt,
        contentHash: packet.contentHash,
      },
      // Pass the raw screenshot to the advisor when available. The advisor function
      // will only inject it as an image_url content part when the secondary provider
      // supports vision (openai / openai_codex). For Ollama/llama.cpp it is ignored.
      screenshotBase64: packet.screenshotBase64 || undefined,
      activeWindow: packet.activeWindow
        ? { processName: packet.activeWindow.processName, title: packet.activeWindow.title }
        : undefined,
      openWindows: packet.openWindows.slice(0, 40).map((w) => ({ processName: w.processName, title: w.title })),
      lastActions: orchestrationLog.slice(-8),
      recentFailures,
      clipboardPreview,
      ocrText: packet.ocrText || '',
      ocrConfidence: Number(packet.ocrConfidence || 0),
    });
    if (!advisor) return;

    const hint = formatDesktopAdvisorHint(advisor);
    const stats = recordOrchestrationEvent(
      sessionId,
      {
        trigger: 'auto',
        mode: 'planner',
        reason: `desktop_advisor:${advisor.route}${advisor.reason ? ` (${advisor.reason})` : ''}`,
        route: advisor.route,
      },
      orchCfg,
    );

    desktopAdvisorRoute = advisor.route;
    desktopAdvisorHintPreview = String(advisor.primary_hint || advisor.reason || advisor.answer || '').slice(0, 220);
    desktopContinuationPending = advisor.route === 'continue_desktop';

    sendSSE('desktop_advisor_route', {
      route: advisor.route,
      reason: advisor.reason,
      answer: advisor.answer || '',
      primary_hint: advisor.primary_hint || '',
      next_tool: advisor.next_tool || null,
      raw_response: advisor.raw_response || '',
      assist_count: stats.assistCount,
      assist_cap: orchCfg.limits.max_assists_per_session,
    });
    sendSSE('desktop_advisor_nudge', {
      route: advisor.route,
      preview: desktopAdvisorHintPreview,
    });

    orchestrationLog.push(`[desktop:${advisor.route}] ${String(advisor.reason || 'n/a').slice(0, 200)}`);

    if (multiAgentActive) {
      const strippedSystem = {
        role: 'system',
        content: `You are Prom. Execute desktop tool calls exactly as instructed by the advisor directive below.

DESKTOP TOOLS: desktop_list_apps, desktop_list_windows, desktop_get_window_state, desktop_screenshot, desktop_get_monitors, desktop_find_window, desktop_focus_window, desktop_click, desktop_drag, desktop_scroll, desktop_wait, desktop_type, desktop_type_raw, desktop_press_key, desktop_get_clipboard, desktop_set_clipboard, desktop_window_click, desktop_window_type, desktop_window_press_key, desktop_window_scroll, desktop_window_drag
WINDOW-SCOPED MODEL: Prefer desktop_list_windows / desktop_get_window_state to resolve a stable window_id, then desktop_window_click / desktop_window_type / desktop_window_press_key (coordinates default to window-space) for deterministic targeting of a specific app window.

RULES:
1. Call exactly the tool and params the advisor specifies.
2. Do not think, plan, or explain. Just call the tool.
3. If the directive says answer_now, respond in 1-2 sentences using the provided draft.`,
      };
      const recentToolMsgs = messages
        .filter((m: any) => m.role === 'tool')
        .slice(-4);
      messages.length = 0;
      messages.push(strippedSystem);
      messages.push({ role: 'user', content: message });
      messages.push({ role: 'assistant', content: 'Understood. Executing desktop task.' });
      for (const tm of recentToolMsgs) messages.push(tm);
    }

    messages.push({ role: 'user', content: hint });
    messages.push({ role: 'assistant', content: 'Understood. Continuing with desktop advisor guidance.' });
    if (advisor.route === 'answer_now' && advisor.answer.trim()) {
      messages.push({
        role: 'user',
        content: `Use desktop evidence and answer now in 1-2 concise sentences. Draft answer: ${advisor.answer.slice(0, 700)}`,
      });
    } else if (advisor.next_tool?.tool) {
      messages.push({
        role: 'user',
        content: `Immediate next step: call ${advisor.next_tool.tool} with params ${JSON.stringify(advisor.next_tool.params || {})}. After acting, capture desktop_screenshot again only if the UI likely changed or the outcome is ambiguous before deciding the next step.`,
      });
    }
  };

  if (fileOpV2Active && fileOpType === 'FILE_ANALYSIS') {
    sendSSE('info', { message: 'FILE_OP v2: delegating analysis to secondary model.' });
    const candidateFiles = (() => {
      try {
        return fs.readdirSync(workspacePath, { withFileTypes: true })
          .filter(e => e.isFile())
          .map(e => e.name)
          .slice(0, 80);
      } catch {
        return [] as string[];
      }
    })();
    const analysis = await callSecondaryFileAnalyzer({
      userMessage: message,
      recentHistory: history.slice(-6).map(h => ({ role: h.role, content: h.content })),
      candidateFiles,
    });
    if (analysis) {
      maybeSaveFileOpCheckpoint({
        phase: 'done',
        next_action: 'analysis complete',
      });
      clearFileOpCheckpoint(sessionId);
      const lines: string[] = [];
      if (analysis.summary) lines.push(analysis.summary);
      if (analysis.diagnosis) lines.push(`Diagnosis: ${analysis.diagnosis}`);
      if (analysis.exact_files.length) lines.push(`Files: ${analysis.exact_files.join(', ')}`);
      if (analysis.edit_plan.length) lines.push(`Plan: ${analysis.edit_plan.join(' -> ')}`);
      const text = lines.join('\n');
      return { type: 'chat', text };
    }
    // Secondary unavailable — fail-closed. Spec: FILE_ANALYSIS is always Secondary, no primary fallback.
    sendSSE('info', { message: 'FILE_OP v2: secondary analyzer unavailable; cannot complete FILE_ANALYSIS (fail-closed).' });
    return { type: 'chat', text: 'Analysis could not be completed: the secondary model is unavailable. Please try again.' };
  }

  // ── FILE_CREATE upfront size routing ──
  // If the request is clearly secondary territory (full page / large template),
  // skip primary entirely — queue secondary patch plan now so round 0 executes
  // it as synthetic calls without ever running the LLM for generation.
  // This eliminates the stall→restart spiral for large creates.
  if (
    fileOpV2Active
    && fileOpType === 'FILE_CREATE'
    && fileOpOwner === 'primary'
    && pendingSyntheticToolCalls.length === 0
  ) {
    const looksLarge = requestedFullTemplate(message)
      || /\b(landing page|full html|multi.?section|multiple sections|panels?|sections?.+panels?|panels?.+sections?|full.?page|whole page|full.?site|complete.?page)\b/i.test(message);
    if (looksLarge) {
      fileOpOwner = 'secondary';
      fileOpPrimaryStallPromoted = true;
      sendSSE('info', {
        message: 'FILE_OP v2: large FILE_CREATE detected upfront — routing directly to secondary (skipping primary generation).',
      });
      maybeSaveFileOpCheckpoint({ phase: 'plan', next_action: 'upfront secondary routing for large create' });
      const patchPlan = await callSecondaryFilePatchPlanner({
        userMessage: message,
        operationType: 'FILE_CREATE',
        owner: 'secondary',
        reason: 'Upfront large-create detection: request exceeds primary create thresholds before generation',
        fileSnapshots: collectFileSnapshots(workspacePath, Array.from(fileOpTouchedFiles)),
        verifier: null,
      });
      if (patchPlan?.tool_calls?.length) {
        pendingSyntheticToolCalls = patchPlan.tool_calls.map((tc: any) => ({
          function: { name: tc.tool, arguments: tc.args || {} },
        }));
        sendSSE('info', {
          message: `FILE_OP v2: queued ${pendingSyntheticToolCalls.length} secondary call(s) for large create.`,
        });
        maybeSaveFileOpCheckpoint({ phase: 'execute', next_action: 'execute secondary upfront create batch' });
      }
    }
  }

  sendSSE('info', { message: 'Thinking...' });
  console.log('[v2] -- CHAT --');

  const appendSteerEventToMessages = async (steer: RuntimeSteerEvent): Promise<void> => {
    const previewContext = Array.isArray(steer.attachmentPreviews) && steer.attachmentPreviews.length
      ? await buildAttachmentRuntimeContext(steer.attachmentPreviews)
      : { block: '', visionAttachments: [], attachmentCount: 0 };
    const steerBlock = buildChatSteerContextBlock(steer);
    const steerText = appendAttachmentContextToMessage(steerBlock, previewContext.block);
    const steerVisionAttachments = [
      ...(Array.isArray(steer.attachments) ? steer.attachments : []),
      ...(Array.isArray(previewContext.visionAttachments) ? previewContext.visionAttachments : []),
    ]
      .map((attachment: any) => ({
        base64: String(attachment?.base64 || '').trim(),
        mimeType: String(attachment?.mimeType || 'image/png').trim() || 'image/png',
        name: String(attachment?.name || attachment?.mimeType || 'attachment').trim() || 'attachment',
      }))
      .filter((attachment) => attachment.base64 && attachment.mimeType.startsWith('image/'))
      .slice(0, 4);

    const shouldUseSteerXaiVisionSidecar =
      steerVisionAttachments.length > 0
      && !currentModelCapabilities.hasVision
      && String(currentModelCapabilities.provider || '').toLowerCase() === 'xai'
      && /^grok-composer/i.test(String(currentModelCapabilities.model || ''));

    if (steerVisionAttachments.length > 0 && currentModelCapabilities.hasVision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: steerText },
          ...steerVisionAttachments.map((attachment) => buildVisionImagePart(attachment.base64, attachment.mimeType)),
        ],
      });
      sendSSE('vision_injected', {
        source: 'chat_steer_attachment',
        eventId: steer.id,
        attachments: steerVisionAttachments.length,
      });
      return;
    }

    if (shouldUseSteerXaiVisionSidecar) {
      const summaries: string[] = [];
      for (const attachment of steerVisionAttachments) {
        const dataUrl = `data:${attachment.mimeType};base64,${attachment.base64}`;
        const result = await executeXaiImageVisionSummary({ dataUrl, name: attachment.name });
        summaries.push(result.success && result.summary
          ? `- ${attachment.name}: ${result.summary}`
          : `- ${attachment.name}: vision sidecar failed (${String(result.error || 'unknown error').slice(0, 220)})`);
      }
      messages.push({
        role: 'user',
        content: `${steerText}\n\n[STEER_ATTACHMENT_VISION_SUMMARY]\nThe active xAI Composer model cannot receive raw image payloads. A vision sidecar inspected the steer image attachment(s):\n${summaries.join('\n')}`,
      });
      sendSSE('vision_injected', {
        source: 'chat_steer_xai_vision_sidecar',
        eventId: steer.id,
        attachments: steerVisionAttachments.length,
      });
      return;
    }

    const nonVisionNotice = steerVisionAttachments.length > 0
      ? `\n\n[STEER_ATTACHMENT_NOTICE]\n${steerVisionAttachments.length} image attachment(s) were included with this steer, but the active model is not vision-capable, so raw image payloads were not injected. If direct image interpretation is essential, switch to a vision-capable model or use attachment paths/tool outputs when available.`
      : '';
    messages.push({ role: 'user', content: `${steerText}${nonVisionNotice}` });
  };

  const injectPendingChatSteers = async (): Promise<number> => {
    const steers = consumePendingRuntimeSteersForSession(sessionId, 4);
    if (!steers.length) return 0;
    const cfg = getConfig().getConfig() as any;
    const _steerActiveProvider = String(cfg?.llm?.provider || '').trim().toLowerCase();
    const _steerProviderId = String(providerOverride || _steerActiveProvider || '').trim().toLowerCase();
    const _steerIsAnthropic = _steerProviderId === 'anthropic';
    for (const steer of steers) {
      await appendSteerEventToMessages(steer);
      // Anthropic does not support assistant prefill — skip trailing assistant ack for that provider
      if (!_steerIsAnthropic) {
        messages.push({ role: 'assistant', content: 'Understood. I will steer the current run with this correction.' });
      }
      sendSSE('steer_applied', {
        eventId: steer.id,
        message: steer.message.slice(0, 500),
        source: steer.source || 'web',
        attachments: (steer.attachments?.length || 0) + (steer.attachmentPreviews?.length || 0),
      });
      sendSSE('info', { message: `Steer applied: ${steer.message.slice(0, 120)}` });
    }
    return steers.length;
  };

  for (let round = 0; ; round++) {
    if (round >= effectiveMaxToolRounds) {
      const allowExtendedFileOpLoop =
        fileOpV2Active
        && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
        && (fileOpOwner === 'secondary' || !!fileOpLastFailureSignature);
      if (!allowExtendedFileOpLoop) break;
      if (round === effectiveMaxToolRounds) {
        sendSSE('info', {
          message: 'FILE_OP v2: extending execution beyond default step cap for secondary-owned repair convergence.',
        });
      }
    }

    if (abortSignal?.aborted) {
      console.log(`[v2] Aborted at round ${round} — client disconnected`);
      const partial = allToolResults.length > 0
        ? `Stopped after ${allToolResults.length} step${allToolResults.length !== 1 ? 's' : ''}.`
        : 'Stopped.';
      const finalPartial = finalizeSkillGardenerForTurn(partial);
      return { type: 'execute', text: finalPartial, toolResults: allToolResults.length > 0 ? allToolResults : undefined };
    }

    // ── Synthetic tool calls from browser advisor ─────────────────────────────
    // When the advisor queued deterministic tool calls (e.g. PageDown scroll),
    // skip LLM generation entirely for this round and execute them directly.
    await injectPendingChatSteers();

    if (pendingSyntheticToolCalls.length > 0) {
      const syntheticCalls = pendingSyntheticToolCalls.map((call: any, idx: number) => ({
        ...call,
        id: String(call?.id || `synthetic_${Date.now()}_${round + 1}_${idx + 1}`),
      }));
      pendingSyntheticToolCalls = []; // consume immediately
      console.log(`[v2] SYNTHETIC[${round + 1}]: executing ${syntheticCalls.length} advisor-injected tool calls`);
      sendSSE('info', { message: `Executing ${syntheticCalls.length} synthetic browser step(s)...` });

      // Inject a synthetic assistant message so the message history is coherent
      const syntheticAssistant = {
        role: 'assistant',
        content: null,
        tool_calls: syntheticCalls,
      };
      messages.push(syntheticAssistant);

      let roundHadProgressSynthetic = false;
      for (const call of syntheticCalls) {
        const toolCallId = String((call as any)?.id || '').trim();
        const toolName = call.function?.name || 'unknown';
        const toolArgs = normalizeToolArgsForTool(toolName, call.function?.arguments);
        console.log(`[v2] SYNTHETIC TOOL: ${toolName}(${JSON.stringify(toolArgs).slice(0, 100)})`);
        markProgressStepStart(toolName);
        sendSSE('tool_call', { action: toolName, args: toolArgs, stepNum: allToolResults.length + 1, synthetic: true });

        const preObservationContext = await captureObservationPreContext(toolName, toolArgs);
        const toolResult = await executeToolWithTelemetry(toolName, toolArgs);
        allToolResults.push(toolResult);
        logToolCall(workspacePath, toolName, toolArgs, toolResult.result, toolResult.error);
        trackFileOpMutation(toolName, toolArgs, toolResult, 'secondary');
        if (!toolResult.error) roundHadProgressSynthetic = true;
        markProgressStepResult(!toolResult.error, toolName);

        orchestrationLog.push(
          toolResult.error
            ? `✗ [synthetic] ${toolName}: ${toolResult.result.slice(0, 80)}`
            : `✓ [synthetic] ${toolName}: ${toolResult.result.slice(0, 60)}`
        );
        sendSSE('tool_result', { action: toolName, result: toolResult.result.slice(0, 300), error: toolResult.error, stepNum: allToolResults.length, synthetic: true });

        const goalReminder = `\n\n[GOAL REMINDER: Your task is still: "${message.slice(0, 120)}". Stay focused on this goal only.]`;
        const isBrowserTool = isBrowserToolName(toolName);
        const isDesktopTool = isDesktopToolName(toolName);
        // Screenshot always delivers full data (image for OpenAI, rich OCR text for local).
        // Other desktop/browser tools pass their real result text so AI always knows the outcome.
        // Visual screenshot tools also update the advisor packet with the post-action screenshot.
        const isDesktopVisualTool2 = toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot';
        let toolMessageContent = (isBrowserTool && multiAgentActive)
          ? buildBrowserAck(toolName, toolResult) + goalReminder
          : (isDesktopTool && isDesktopVisualTool2)
            ? buildDesktopScreenshotContent(toolResult, sessionId, goalReminder)
            : (isDesktopTool)
              ? buildDesktopAck(toolName, toolResult) + goalReminder
              : toolResult.result + goalReminder;
        if (isBrowserTool) toolMessageContent = wrapUntrustedBrowserToolContent(toolName, toolMessageContent);
        toolMessageContent = boundToolMessageContentForModelContext(toolMessageContent, toolName);
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: toolMessageContent,
        });
        const appliedObservation = await applySharedPostActionObservation(
          toolName,
          toolArgs,
          toolResult,
          preObservationContext,
        );

        if (isBrowserTool && !toolResult.error) {
          browserForcedRetries = 0;
          continuationNudges = 0;
          if (toolName === 'browser_close') {
            browserContinuationPending = false;
            browserAdvisorRoute = null;
            browserAdvisorHintPreview = '';
            resetBrowserAdvisorCollection();
          }
        }
        if (isDesktopTool && !toolResult.error && isDesktopVisualTool2) {
          desktopContinuationPending = false;
        }
        if (!toolResult.error) {
          continuationNudges = 0;
        }
        // Fire advisor after each browser/desktop tool in the synthetic batch
        await maybeRunBrowserAdvisorPass(
          appliedObservation.advisorTriggerToolName,
          appliedObservation.advisorTriggerToolResult,
          appliedObservation.advisorTriggerToolArgs,
          appliedObservation.decision,
          appliedObservation.browserAfterPacket,
        );
        await maybeRunDesktopAdvisorPass(
          appliedObservation.advisorTriggerToolName,
          appliedObservation.advisorTriggerToolResult,
          appliedObservation.decision,
        );
      }

      sendSSE('info', { message: 'Synthetic steps complete.' });
      // Continue to next round — either with fresh LLM gen or another synthetic batch
      continue;
    }

    // ── Secondary-owned FILE_OP: skip Ollama, run verify, return directly ──
    // When secondary has already executed all patch calls there is nothing left
    // for primary to do. Build the reply from what we already know in-memory.
    if (
      fileOpV2Active
      && fileOpOwner === 'secondary'
      && pendingSyntheticToolCalls.length === 0
      && fileOpToolHistory.some(h => isFileMutationTool(h.tool))
    ) {
      // Run verification if triggered
      const verifyDecision = shouldVerifyFileTurn({
        had_create: fileOpHadCreate,
        user_requested_full_template: requestedFullTemplate(message),
        primary_write_lines: fileOpPrimaryWriteLines,
        primary_write_chars: fileOpPrimaryWriteChars,
        had_tool_failure: fileOpHadToolFailure,
        touched_files: Array.from(fileOpTouchedFiles),
        high_stakes_touched: Array.from(fileOpTouchedFiles).some(isHighStakesFile),
      }, fileOpSettings);

      if (verifyDecision.verify) {
        sendSSE('info', { message: `FILE_OP v2: verifier check (${verifyDecision.reasons.join(' | ')}).` });
        maybeSaveFileOpCheckpoint({ phase: 'verify', next_action: 'run secondary verifier' });
        const targetFiles = Array.from(fileOpTouchedFiles);
        const verifier = await callSecondaryFileVerifier({
          userMessage: message,
          operationType: fileOpType as 'FILE_CREATE' | 'FILE_EDIT',
          fileSnapshots: collectFileSnapshots(workspacePath, targetFiles),
          recentToolExecutions: fileOpToolHistory.slice(-24).map(h => ({
            tool: h.tool, args: h.args, result: h.result, error: h.error,
          })),
        });
        if (verifier?.verdict === 'FAIL') {
          // Re-enter the repair loop by queuing a secondary patch plan and continuing
          const patchPlan = await callSecondaryFilePatchPlanner({
            userMessage: message,
            operationType: fileOpType as 'FILE_CREATE' | 'FILE_EDIT',
            owner: 'secondary',
            reason: (verifier.reasons || []).join(' | ') || 'verifier fail',
            fileSnapshots: collectFileSnapshots(workspacePath, targetFiles),
            verifier,
          });
          if (patchPlan?.tool_calls?.length) {
            pendingSyntheticToolCalls = patchPlan.tool_calls.map((tc: any) => ({
              function: { name: tc.tool, arguments: tc.args || {} },
            }));
            maybeSaveFileOpCheckpoint({ phase: 'execute', next_action: 'repair after verify fail' });
            continue; // back to top of round loop — executes repair batch next
          }
        } else if (verifier?.verdict === 'PASS') {
          maybeSaveFileOpCheckpoint({ phase: 'done', next_action: 'verification pass' });
          clearFileOpCheckpoint(sessionId);
        }
      } else {
        maybeSaveFileOpCheckpoint({ phase: 'done', next_action: 'turn complete' });
        clearFileOpCheckpoint(sessionId);
      }

      // Build reply from actual results — no Ollama, no extra AI call
      const createdFiles = fileOpToolHistory
        .filter(h => h.tool === 'create_file' && !h.error)
        .map(h => String(h.args?.filename || h.args?.name || h.args?.path || 'file'));
      const editedFiles = fileOpToolHistory
        .filter(h => isFileMutationTool(h.tool) && h.tool !== 'create_file' && !h.error)
        .map(h => String(h.args?.filename || h.args?.name || h.args?.path || 'file'));
      const failedOps = fileOpToolHistory.filter(h => h.error);

      const parts: string[] = [];
      if (createdFiles.length) parts.push(`Created ${createdFiles.join(', ')}`);
      if (editedFiles.length) parts.push(`Updated ${[...new Set(editedFiles)].join(', ')}`);
      if (failedOps.length) parts.push(`${failedOps.length} operation(s) failed`);
      const finalText = parts.length ? parts.join('. ') + '.' : 'Done.';

      console.log(`[v2] FINAL (secondary-owned): ${finalText}`);
      if (progressState.items.length >= 2) {
        for (const item of progressState.items) {
          if (item.status === 'in_progress') item.status = 'done';
          else if (item.status === 'pending') item.status = 'skipped';
        }
        progressState.activeIndex = -1;
        emitProgressState('finalized');
      }
      const finalTextWithSkillOffer = finalizeSkillGardenerForTurn(finalText);
      return {
        type: 'execute',
        text: finalTextWithSkillOffer,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
      };
    }

    let response: any;
    let isGrokGeneration = false;
    let grokGreetingLikeTurn = false;
    try {
      // In multi-agent mode, disable thinking for browser ops — the secondary AI
      // holds all context and issues exact directives; the primary just executes.
      // Thinking during browser ops burns the full stall threshold (110s) for no gain.
      const isActiveAutomationOp = multiAgentActive && (
        fileOpType === 'BROWSER_OP'
        || fileOpType === 'DESKTOP_OP'
        || browserContinuationPending
        || browserAdvisorRoute !== null
        || desktopContinuationPending
        || desktopAdvisorRoute !== null
        || allToolResults.some(r =>
          typeof r.name === 'string'
          && (r.name.startsWith('browser_') || r.name.startsWith('desktop_')),
        )
      );
	      const generationOverride = resolveProviderModelOverride();
	      const requestedThinkMode = reasoningOptions?.enabled
	        ? (reasoningOptions.level === 'extra_high' ? 'xhigh' : (reasoningOptions.level || 'low'))
	        : undefined;
	      const activeProviderForThinking = String(generationOverride.providerId || providerOverride || '').trim();
	      const primaryThinkMode: boolean | 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none' | undefined =
	        requestedThinkMode
	          || ((multiAgentActive && !isActiveAutomationOp)
	            ? true
	            : (activeProviderForThinking === 'openai_codex' && !isActiveAutomationOp ? undefined : false));
        isGrokGeneration = isGrokGenerationOverride(generationOverride);
        grokGreetingLikeTurn = isGrokGeneration && isGrokGreetingLikeMessage(message);
        let streamedVisibleText = '';
        let suppressRunawayStream = false;
        let providerRequestStartedAt = 0;
	      const emitStreamToken = (chunk: string) => {
	        if (abortSignal?.aborted) return;
	        const text = String(chunk || '');
	        if (!text || suppressRunawayStream) return;
          if (!firstProviderEventAt) {
            firstProviderEventAt = markLatency('first_provider_event', {
              provider: generationOverride.providerId,
              model: generationOverride.model,
              eventKind: 'assistant_delta',
            });
          }
          if (!firstVisibleTokenAt) {
            firstVisibleTokenAt = markLatency('first_visible_token', {
              provider: generationOverride.providerId,
              model: generationOverride.model,
              providerWaitMs: firstProviderEventAt ? firstProviderEventAt - providerRequestStartedAt : undefined,
            });
          }
          if (isGrokGeneration) {
            streamedVisibleText += text;
            if (streamedVisibleText.length > 800) {
              if (grokGreetingLikeTurn && streamedVisibleText.length > 1200) {
                suppressRunawayStream = true;
                console.warn('[v2] GROK GREETING STREAM GUARD: suppressing oversized greeting output');
                sendSSE('info', { message: 'Grok greeting output was too long; trimming the response.' });
                return;
              }
              const rawParagraphs = streamedVisibleText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
              const paragraphs = rawParagraphs.map(p => normalizeForDedup(p)).filter(Boolean);
              const tail = paragraphs.slice(-8);
              const uniqueTail = new Set(tail);
              if (tail.length >= 6 && uniqueTail.size <= 3) {
                suppressRunawayStream = true;
                console.warn('[v2] GROK STREAM REPETITION GUARD: suppressing repeated model output');
                sendSSE('info', { message: 'Grok output repetition detected; trimming the response.' });
                return;
              }
              if (isLikelyGrokInlineLoop(streamedVisibleText)) {
                suppressRunawayStream = true;
                console.warn('[v2] GROK INLINE LOOP GUARD: suppressing repeated parenthetical/text output');
                sendSSE('info', { message: 'Grok inline repetition detected; trimming the response.' });
                return;
              }
              // Short-phrase affirmation loop: Grok emits many unique but tiny fragments
              // (e.g. "Yes.", "Done.", "(End.)", "👍") that evade the unique-set check above.
              const rawTail = rawParagraphs.slice(-10);
              if (rawTail.length >= 4) {
                let consecutiveShort = 0;
                let maxRun = 0;
                for (const p of rawTail) {
                  if (p.length < 40) { consecutiveShort++; maxRun = Math.max(maxRun, consecutiveShort); }
                  else consecutiveShort = 0;
                }
                if (maxRun >= 3) {
                  suppressRunawayStream = true;
                  console.warn('[v2] GROK SHORT-PHRASE LOOP GUARD: affirmation loop detected');
                  sendSSE('info', { message: 'Grok affirmation loop detected; trimming the response.' });
                  return;
                }
              }
            }
            if (streamedVisibleText.length > 5000) {
              suppressRunawayStream = true;
              console.warn('[v2] GROK STREAM LENGTH GUARD: suppressing oversized model output');
              sendSSE('info', { message: 'Grok response is too long; trimming the output.' });
              return;
            }
          }
	        sendSSE('token', { text });
	        if (callerOnToken) {
	          try { callerOnToken(text); } catch { /* swallow — channel adapter errors must not break the chat run */ }
	        }
	      };
	      const emitThinkingToken = (chunk: string, source: 'thinking' | 'reasoning_summary' = 'thinking') => {
	        if (abortSignal?.aborted) return;
	        const text = String(chunk || '');
	        if (!text) return;
          if (!firstProviderEventAt) {
            firstProviderEventAt = markLatency('first_provider_event', {
              provider: generationOverride.providerId,
              model: generationOverride.model,
              eventKind: source,
            });
          }
          if (!firstReasoningAt) {
            firstReasoningAt = markLatency('first_reasoning_delta', {
              provider: generationOverride.providerId,
              model: generationOverride.model,
              source,
            });
          }
	        allThinking += text;
	        sendSSE('thinking_delta', { thinking: text, source });
	      };
	      const emitModelStreamEvent = (event: any) => {
	        if (abortSignal?.aborted || !event || typeof event !== 'object') return;
	        const type = String(event.type || '').trim();
	        if (!type) return;
          if (!firstProviderEventAt) {
            firstProviderEventAt = markLatency('first_provider_event', {
              provider: generationOverride.providerId,
              model: generationOverride.model,
              eventKind: type,
            });
          }
	        sendSSE('model_stream_event', { event });
	      };
      currentModelCapabilities = resolveCapabilitiesForGenerationOverride(generationOverride);
      tools = capToolsForProvider(buildToolsForGeneration(generationOverride), generationOverride);
      currentModelSystemBlock = formatCurrentModelSystemBlock(generationOverride);
      if (generationOverride.source === 'turn_override') {
        // ── Local primary switch_model promotion ──────────────────────────────────
        // When primary is a local LLM, the switched cloud model must receive the full
        // v1 Prometheus prompt (buildSystemPrompt('full')) so it operates as complete
        // Prometheus. personalityCtx (already computed above) has the full context.
        // For cloud primaries the existing lightweight switch_model path is unchanged.
        if (!isLocalPrimary && !switchModelPersonalityCtx) {
          switchModelPersonalityCtx = await buildPersonalityContext(
            sessionId,
            workspacePath,
            message,
            executionMode || 'interactive',
            history.length,
            _skillsManager,
            browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,
            teachModeActive ? { profile: 'teach_mode', excludedSkillIds, forcedSkillIds } : { profile: 'switch_model', excludedSkillIds, forcedSkillIds },
          );
        }
        if (messages[0]?.role === 'system') messages[0].content = isLocalPrimary
          ? buildSystemPrompt('full')         // cloud model gets complete Prometheus runtime
          : buildSystemPrompt('switch_model'); // cloud primary: existing lightweight path
      } else {
        if (messages[0]?.role === 'system') messages[0].content = buildSystemPrompt('full');
      }
      providerRequestStartedAt = markLatency('provider_request_start', {
        provider: generationOverride.providerId,
        model: generationOverride.model,
        toolCount: Array.isArray(tools) ? tools.length : 0,
        messageCount: Array.isArray(messages) ? messages.length : 0,
      });
      const generationPromise = ollama.chatWithThinking(messages, 'executor', {
        tools,
        temperature: 0.3,
        num_ctx: 8192,
        num_predict: grokGreetingLikeTurn ? 256 : 4096,
	        think: primaryThinkMode,
	        model: generationOverride.model,
	        provider: generationOverride.provider,
	        onToken: emitStreamToken,
	        onThinking: (chunk: string) => emitThinkingToken(chunk, 'thinking'),
	        onReasoningSummary: (chunk: string) => emitThinkingToken(chunk, 'reasoning_summary'),
	        onModelEvent: emitModelStreamEvent,
	        abortSignal: abortSignal?.signal,
	        usageContext: { sessionId, agentId: 'main' },
	      });

      // ── Preempt watchdog ────────────────────────────────────────────
      if (
        preemptCfg.enabled
        && ollamaProcMgr
        && preemptState.canPreempt(round, preemptCfg.maxPerTurn, preemptCfg.maxPerSession)
      ) {
        const watchdogOutcome = await raceWithWatchdog(
          generationPromise,
          preemptCfg.stallThresholdMs,
          (elapsedMs) => {
            console.log(`[Preempt] Generation stalled at ${Math.round(elapsedMs / 1000)}s — triggering preempt`);
            sendSSE('preempt_start', { elapsed_ms: elapsedMs, threshold_ms: preemptCfg.stallThresholdMs, round });
          },
        );

        if (watchdogOutcome.timedOut) {
          // ── FILE_OP stall: bypass preempt restart entirely, promote immediately ──
          if (
            fileOpV2Active
            && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
            && fileOpOwner === 'primary'
          ) {
            sendSSE('info', {
              message: `FILE_OP v2: stall detected during ${fileOpType} after ${Math.round(watchdogOutcome.elapsedMs / 1000)}s — promoting immediately to secondary (no Ollama restart).`,
            });
            fileOpOwner = 'secondary';
            fileOpPrimaryStallPromoted = true;
            maybeSaveFileOpCheckpoint({
              phase: 'repair',
              next_action: 'stall promotion to secondary patch planning',
            });
            const patchPlan = await callSecondaryFilePatchPlanner({
              userMessage: message,
              operationType: fileOpType,
              owner: fileOpOwner,
              reason: `Primary stalled after ${Math.round(watchdogOutcome.elapsedMs / 1000)}s`,
              fileSnapshots: collectFileSnapshots(workspacePath, Array.from(fileOpTouchedFiles)),
              verifier: null,
            });
            if (patchPlan?.tool_calls?.length) {
              pendingSyntheticToolCalls = patchPlan.tool_calls.map((tc: any) => ({
                function: { name: tc.tool, arguments: tc.args || {} },
              }));
              sendSSE('info', {
                message: `FILE_OP v2: queued ${patchPlan.tool_calls.length} secondary patch call(s) after stall promotion.`,
              });
              maybeSaveFileOpCheckpoint({
                phase: 'execute',
                next_action: 'execute secondary synthetic patch batch',
              });
            }
            continue;
          }

          // ── Non-FILE_OP stall: normal preempt restart path ──
          preemptState.recordPreempt(round);
          const sessionPreemptCount = incrementPreemptSessionCount(sessionId);
          sendSSE('info', {
            message: `Preempt: generation stalled after ${Math.round(watchdogOutcome.elapsedMs / 1000)}s. Restarting Ollama... (${sessionPreemptCount}/${preemptCfg.maxPerSession} this session)`,
          });

          const restarted = await ollamaProcMgr.killAndRestart();
          sendSSE('preempt_killed', {
            restarted,
            round,
            preempts_session: sessionPreemptCount,
            preempts_session_cap: preemptCfg.maxPerSession,
          });

          if (!restarted) {
            sendSSE('info', { message: 'Preempt: Ollama did not restart in time. Continuing without rescue.' });
          } else {
            sendSSE('preempt_ready', {
              round,
              preempts_session: sessionPreemptCount,
              preempts_session_cap: preemptCfg.maxPerSession,
            });

            // Fire secondary rescue advisor
            const orchCfgForPreempt = getOrchestrationConfig();
            if (orchCfgForPreempt?.enabled && orchestrationStats.assistCount < orchCfgForPreempt.limits.max_assists_per_session) {
              sendSSE('info', { message: 'Preempt: consulting rescue advisor...' });
              const liveInfoForRescue = getBrowserSessionInfo(sessionId);
              const advice = await callSecondaryAdvisor(
                message,
                orchestrationLog,
                `Generation stalled after ${Math.round(watchdogOutcome.elapsedMs / 1000)}s with no output`,
                'rescue',
                liveInfoForRescue.active ? {
                  active: true,
                  title: liveInfoForRescue.title,
                  url: liveInfoForRescue.url,
                  totalCollected: browserAdvisorCollectedFeed.length,
                } : undefined,
                buildSecondaryAssistContext(),
              );
              if (advice) {
                const hint = formatAdvisoryHint(advice);
                const stats = recordOrchestrationEvent(
                  sessionId,
                  { trigger: 'auto', reason: 'preempt_stall', mode: 'rescue' },
                  orchCfgForPreempt,
                );
                sendSSE('preempt_rescue', {
                  round,
                  assist_count: stats.assistCount,
                  assist_cap: orchCfgForPreempt.limits.max_assists_per_session,
                });
                messages.push({ role: 'user', content: hint });
                messages.push({ role: 'assistant', content: 'Understood. Acting immediately.' });
              }
            }

            // Inject strict nudge and retry — model just woke up fresh
            // Re-inject live browser state so model doesn't re-open an already-open browser
            const liveInfoForRetry = getBrowserSessionInfo(sessionId);
            const browserRetryReminder = liveInfoForRetry.active
              ? multiAgentActive
                ? `\n\nCRITICAL: Browser is ALREADY OPEN at "${liveInfoForRetry.url || 'current page'}". ` +
                  `Do NOT call browser_open. Call browser_snapshot so the secondary AI can analyze and tell you what to do next.`
                : `\n\nCRITICAL: Browser is ALREADY OPEN at "${liveInfoForRetry.url || 'current page'}". ` +
                  `Do NOT call browser_open again. Use browser_snapshot to see the current page.`
              : '';
            messages.push({
              role: 'user',
              content: `Your last generation was interrupted. Do NOT think or plan. Call the next tool immediately. If no tool is needed, reply in 1 sentence.${browserRetryReminder}`,
            });
            sendSSE('preempt_retry', { round });
            sendSSE('info', { message: 'Preempt: retrying with rescue context...' });
          }
          // Re-run this round from the top with the fresh Ollama instance
          continue;
        }

        // Generation finished before watchdog
	        const result = watchdogOutcome.result;
          markLatency('provider_done', {
            provider: generationOverride.providerId,
            model: generationOverride.model,
            stageDurationMs: Date.now() - providerRequestStartedAt,
            firstProviderEventMs: firstProviderEventAt ? firstProviderEventAt - providerRequestStartedAt : undefined,
            firstVisibleTokenMs: firstVisibleTokenAt ? firstVisibleTokenAt - providerRequestStartedAt : undefined,
          });
	        response = result.message;
	        if (result.thinking) {
	          console.log(`[v2] THINK (${result.thinking.length} chars): ${result.thinking.slice(0, 150)}...`);
	          if (!allThinking.includes(result.thinking)) {
	            allThinking += (allThinking ? '\n\n' : '') + result.thinking;
	            sendSSE('thinking', { thinking: result.thinking });
	          }
	        }
	      } else {
        // Watchdog not active — normal await
        const result = await generationPromise;
        markLatency('provider_done', {
          provider: generationOverride.providerId,
          model: generationOverride.model,
          stageDurationMs: Date.now() - providerRequestStartedAt,
          firstProviderEventMs: firstProviderEventAt ? firstProviderEventAt - providerRequestStartedAt : undefined,
          firstVisibleTokenMs: firstVisibleTokenAt ? firstVisibleTokenAt - providerRequestStartedAt : undefined,
        });
	        response = result.message;
	        if (result.thinking) {
	          console.log(`[v2] THINK (${result.thinking.length} chars): ${result.thinking.slice(0, 150)}...`);
	          if (!allThinking.includes(result.thinking)) {
	            allThinking += (allThinking ? '\n\n' : '') + result.thinking;
	            sendSSE('thinking', { thinking: result.thinking });
	          }
	        }
	      }

      const explicitThink = stripExplicitThinkTags(response?.content || '');
      if (explicitThink.thinking) {
        console.log(`[v2] TAG THINK (${explicitThink.thinking.length} chars): ${explicitThink.thinking.slice(0, 150)}...`);
        allThinking += (allThinking ? '\n\n' : '') + explicitThink.thinking;
        sendSSE('thinking', { thinking: explicitThink.thinking });
      }
      if (String(response?.content || '') !== explicitThink.cleaned) {
        response.content = explicitThink.cleaned;
      }
    } catch (err: any) {
      console.error('[v2] Chat error:', err.message);
      return { type: 'chat', text: `Error: ${err.message}` };
    }

    let toolCalls = response.tool_calls;

    // Auto-recover: if model wrote a tool call as text instead of using the tool mechanism
    if ((!toolCalls || toolCalls.length === 0) && response.content) {
      const textToolMatch = response.content.match(/"action"\s*:\s*"(\w+)"\s*,\s*"action_input"\s*:\s*(\{[^}]+\})/s)
        || response.content.match(/"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})/s);
      if (textToolMatch) {
        const toolName = textToolMatch[1];
        try {
          const toolArgs = JSON.parse(textToolMatch[2]);
          console.log(`[v2] AUTO-RECOVER: Model wrote ${toolName} as text, converting to tool call`);
          const recoveredCallId = `recovered_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
          toolCalls = [{ id: recoveredCallId, type: 'function', function: { name: toolName, arguments: toolArgs } }];
          response.tool_calls = toolCalls;
          response.content = '';
        } catch { /* JSON parse failed, treat as normal text */ }
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      const { reply, thinking: inlineThinking } = separateThinkingFromContent(response.content || '');
      if (inlineThinking) {
        console.log(`[v2] INLINE REASONING (${inlineThinking.length} chars): ${inlineThinking.slice(0, 100)}...`);
        allThinking += (allThinking ? '\n\n' : '') + inlineThinking;
        sendSSE('thinking', { thinking: inlineThinking });
      }

      const rawAssistantText = String(response.content || '').trim();
      const candidateText = String(reply || rawAssistantText || '').trim();
      const manualPlanHasOpenSteps =
        progressState.manualStepAdvance
        && progressState.items.length >= 2
        && getProgressRemaining() > 0;
      const shouldForceBrowserRetry =
        orchestrationSkillEnabled
        && browserContinuationPending
        && browserForcedRetries < browserMaxForcedRetries
        && !hasConcreteCompletion(candidateText);
      const shouldForceDesktopRetry =
        orchestrationSkillEnabled
        && desktopContinuationPending
        && continuationNudges < MAX_CONTINUATION_NUDGES
        && !hasConcreteCompletion(candidateText);

      // Declared plans are strict: do not allow a final assistant reply while plan steps remain open.
      // The model must continue executing tools and use complete_plan_step/step_complete to advance.
      // Add nudge cap to prevent infinite loops (mirrors shouldForceBrowserRetry and shouldForceDesktopRetry).
      const shouldForceManualPlanRetry =
        manualPlanHasOpenSteps
        && continuationNudges < MAX_CONTINUATION_NUDGES
        && !isHardBlockerReply(candidateText);
      const successfulToolResults = allToolResults.filter((r) => r && !r.error);
      const lastSuccessfulTool = successfulToolResults[successfulToolResults.length - 1];
      const setupOnlyToolResults =
        successfulToolResults.length > 0
        && successfulToolResults.every((r) => isSetupOrScoutTool(r.name))
        && !successfulToolResults.some((r) => isSubstantiveFileMutationToolName(r.name));
      const shouldForceSetupContinuation =
        userRequestedDurableBuildWork()
        && setupOnlyToolResults
        && isSetupOrScoutTool(lastSuccessfulTool?.name)
        && setupFinalizationGuard < MAX_SETUP_FINALIZATION_GUARD
        && !hasConcreteCompletion(candidateText)
        && !isHardBlockerReply(candidateText);

      if (shouldForceSetupContinuation) {
        setupFinalizationGuard++;
        const recentSetup = successfulToolResults
          .slice(-6)
          .map((r) => {
            const name = String(r.name || 'tool');
            const preview = String(r.result || '').replace(/\s+/g, ' ').slice(0, 120);
            return `- ${name}${preview ? `: ${preview}` : ''}`;
          })
          .join('\n');
        console.log(
          `[v2] SETUP FINALIZATION BLOCKED: only setup/scout tools completed for durable build request (guard ${setupFinalizationGuard}/${MAX_SETUP_FINALIZATION_GUARD})`,
        );
        sendSSE('info', {
          message: 'Post-check: continuing because only setup/skill-scout work has completed so far.',
        });
        if (candidateText) {
          messages.push({ role: 'assistant', content: candidateText });
        }
        messages.push({
          role: 'user',
          content: [
            'Do not finalize yet. The user asked for durable build/edit work, but the last successful actions were only setup, file staging, skill scouting, or tool-category activation.',
            '',
            recentSetup ? `Recent setup results:\n${recentSetup}` : 'Recent setup results: none',
            '',
            'Continue the actual implementation now. Do not call skill_list again unless a new, specific skill is required.',
            'Use concrete workspace tools such as create_file, write_file, replace_lines, find_replace, apply_patchset, or browser/dev-server verification as appropriate.',
            'Only provide the final answer after you have actually created or updated the requested deliverable, or after you hit a real blocker.',
          ].join('\n'),
        });
        continue;
      }

      if (shouldForceManualPlanRetry) {
        continuationNudges++;
        const currentStepIndex = progressState.items.findIndex(
          (i) => i.status === 'in_progress' || i.status === 'pending',
        );
        const currentStepNumber = currentStepIndex >= 0 ? currentStepIndex + 1 : 1;
        const currentStepText = currentStepIndex >= 0
          ? progressState.items[currentStepIndex].text
          : 'Next declared plan step';
        const recentActions = allToolResults
          .slice(-6)
          .map((r) => {
            const status = r.error ? '✗' : '✓';
            const preview = String(r.result || '').replace(/\s+/g, ' ').slice(0, 140);
            return `  ${status} ${String(r.name || 'tool')}${preview ? ` — ${preview}` : ''}`;
          })
          .join('\n');
        console.log(
          `[v2] PLAN POST-CHECK: forcing continuation (${continuationNudges}/${MAX_CONTINUATION_NUDGES}) - declared plan has open steps`,
        );
        sendSSE('info', {
          message: `Post-check: continuing — declared plan step ${currentStepNumber} is still incomplete.`,
        });
        // Do not echo a prose-only "I'll do it now" answer into the retry
        // context; that reinforces narration loops instead of tool recovery.
        const planLines: string[] = [];
        for (const item of progressState.items) {
          const icon = item.status === 'done' ? '✓' : item.status === 'in_progress' ? '▶' : item.status === 'failed' ? '✗' : ' ';
          planLines.push(`  [${icon}] ${item.text}`);
        }
        const nextStep = progressState.items.find(i => i.status === 'pending' || i.status === 'in_progress');
        messages.push({
          role: 'user',
          content: [
            'Do not finalize yet: a declared plan is still in progress.',
            '',
            `Current incomplete step: ${currentStepNumber}. ${currentStepText}`,
            '',
            'Plan status:',
            ...planLines,
            '',
            recentActions ? `Recent tool results:\n${recentActions}` : 'Recent tool results: none',
            '',
            'Your previous reply did not call any tools. Do not describe what you will do.',
            'Your next assistant message must contain tool calls only.',
            'Use the available workspace file tools directly: list_directory, read_files_batch, read_file, apply_patchset, mkdir, create_file, replace_lines, find_replace, file_stats.',
            '',
            nextStep
              ? `Execute the next required action for: ${nextStep.text}.`
              : 'Execute the next required action now.',
            'If that step is now truly complete, call complete_plan_step with concrete evidence in note.',
            'Example: complete_plan_step({"note":"Step 2 done: opened X live search for openclaw/claude and verified non-FYP results."})',
            'Only provide the final answer after all declared steps are completed.',
          ].join('\n'),
        });
        continue;
      }

      if (shouldForceBrowserRetry) {
        browserForcedRetries++;
        const reason = `browser advisor route=${browserAdvisorRoute || 'continue_browser'} requires continued execution`;
        console.log(
          `[v2] BROWSER POST-CHECK: forcing retry (${browserForcedRetries}/${browserMaxForcedRetries}) - ${reason}`,
        );
        sendSSE('forced_retry', {
          reason,
          retry: browserForcedRetries,
          max_retries: browserMaxForcedRetries,
          route: browserAdvisorRoute,
        });
        sendSSE('info', {
          message: `Browser post-check: continuing execution (${browserForcedRetries}/${browserMaxForcedRetries}).`,
        });
        const preview = browserAdvisorHintPreview ? `Advisor hint: ${browserAdvisorHintPreview}` : '';
        messages.push({
          role: 'user',
          content:
            `${preview}\nDo not stop. Call the next browser tool now and continue execution. If more feed coverage is needed, use browser_press_key with PageDown then browser_wait then browser_snapshot.`,
        });
        continue;
      }

      if (shouldForceDesktopRetry) {
        continuationNudges++;
        const reason = `desktop advisor route=${desktopAdvisorRoute || 'continue_desktop'} requires continued execution`;
        console.log(
          `[v2] DESKTOP POST-CHECK: forcing retry (${continuationNudges}/${MAX_CONTINUATION_NUDGES}) - ${reason}`,
        );
        sendSSE('info', {
          message: `Desktop post-check: continuing execution (${continuationNudges}/${MAX_CONTINUATION_NUDGES}).`,
        });
        const preview = desktopAdvisorHintPreview ? `Advisor hint: ${desktopAdvisorHintPreview}` : '';
        messages.push({
          role: 'user',
          content: `${preview}\nDo not stop. Call the next desktop tool now. If the UI likely changed or the outcome is ambiguous, use desktop_screenshot again.`,
        });
        continue;
      }

      if (
        fileOpV2Active
        && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
        && fileOpToolHistory.some(h => isFileMutationTool(h.tool))
      ) {
        const verifyDecision = shouldVerifyFileTurn({
          had_create: fileOpHadCreate,
          user_requested_full_template: requestedFullTemplate(message),
          primary_write_lines: fileOpPrimaryWriteLines,
          primary_write_chars: fileOpPrimaryWriteChars,
          had_tool_failure: fileOpHadToolFailure,
          touched_files: Array.from(fileOpTouchedFiles),
          high_stakes_touched: Array.from(fileOpTouchedFiles).some(isHighStakesFile),
        }, fileOpSettings);

        if (verifyDecision.verify) {
          sendSSE('info', {
            message: `FILE_OP v2: verifier check (${verifyDecision.reasons.join(' | ')}).`,
          });
          maybeSaveFileOpCheckpoint({
            phase: 'verify',
            next_action: 'run secondary verifier',
          });

          const runVerifier = async () => {
            const targetFiles = (() => {
              const direct = Array.from(fileOpTouchedFiles);
              if (direct.length) return direct;
              const fromHistory = fileOpToolHistory
                .map(h => extractFileToolTarget(h.tool, h.args))
                .filter(Boolean);
              return Array.from(new Set(fromHistory));
            })();
            return callSecondaryFileVerifier({
              userMessage: message,
              operationType: fileOpType,
              fileSnapshots: collectFileSnapshots(workspacePath, targetFiles),
              recentToolExecutions: fileOpToolHistory.slice(-24).map(h => ({
                tool: h.tool,
                args: h.args,
                result: h.result,
                error: h.error,
              })),
            });
          };

          let verifier = await runVerifier();
          if (verifier?.verdict === 'PASS') {
            maybeSaveFileOpCheckpoint({
              phase: 'done',
              next_action: 'verification pass',
            });
            clearFileOpCheckpoint(sessionId);
          } else if (verifier?.verdict === 'FAIL') {
            let delegatePrimaryMicroFix = false;
            let reasonForPatch = (verifier.reasons || []).join(' | ') || 'verifier fail';
            let latestVerifier: typeof verifier | null = verifier;
            let noProgressEscalations = 0;

            while (latestVerifier && latestVerifier.verdict === 'FAIL') {
              const failureSig = buildFailureSignature(latestVerifier as any);
              const smallFix = isSmallSuggestedFix(latestVerifier as any, fileOpSettings);
              const previousPatchSig = fileOpPatchSignatures[fileOpPatchSignatures.length - 1] || 'none';
              const progress = fileOpWatchdog.record({
                failure_signature: failureSig,
                patch_signature: previousPatchSig,
                large_patch: !smallFix,
              });
              fileOpLastFailureSignature = failureSig;
              if (progress.no_progress) {
                noProgressEscalations++;
                // Escalation ladder — each level changes strategy, not just intensity:
                // Level 1: Broaden patch scope, rewrite the broken section
                // Level 2: Regenerate the entire file from scratch using original prompt + accumulated findings
                // Level 3: Switch actor — force primary micro-fix attempt if fix is plausibly small
                // Level 4+: Re-derive requirements checklist and verify full spec coverage
                if (noProgressEscalations === 1) {
                  reasonForPatch = `ESCALATION L1 (no progress on sig=${failureSig}): Broaden patch scope. Do NOT make the same targeted fix again. Rewrite the entire broken section from scratch using the original requirements and verifier findings.`;
                } else if (noProgressEscalations === 2) {
                  reasonForPatch = `ESCALATION L2 (still no progress): Regenerate the ENTIRE file from scratch. Use the original user prompt, all accumulated verifier findings, and current constraints. Do not attempt another targeted patch.`;
                } else if (noProgressEscalations === 3) {
                  // Switch actor: force primary micro-fix regardless of smallFix gating
                  reasonForPatch = `ESCALATION L3: Switching actor to primary for a targeted micro-fix attempt.`;
                  sendSSE('info', {
                    message: `FILE_OP v2: no-progress watchdog L3 — switching actor to primary micro-fix.`,
                  });
                  delegatePrimaryMicroFix = true;
                } else {
                  reasonForPatch = `ESCALATION L${noProgressEscalations} (requirements re-derivation): Re-derive the full requirements checklist from the original user prompt. List every requirement explicitly, then verify which are missing or broken. Patch only what the checklist shows is unmet.`;
                }
                sendSSE('info', {
                  message: `FILE_OP v2: no-progress watchdog triggered (level ${noProgressEscalations}); escalating repair strategy.`,
                });
              }

              maybeSaveFileOpCheckpoint({
                phase: 'repair',
                next_action: progress.no_progress
                  ? `escalate repair strategy L${noProgressEscalations} (no progress watchdog)`
                  : 'repair current verifier findings',
                findings: latestVerifier.findings || [],
              });

              if (delegatePrimaryMicroFix) break;

              if (smallFix) {
                delegatePrimaryMicroFix = true;
                break;
              }

              fileOpOwner = 'secondary';
              const patchPlan = await callSecondaryFilePatchPlanner({
                userMessage: message,
                operationType: fileOpType,
                owner: fileOpOwner,
                reason: reasonForPatch,
                fileSnapshots: collectFileSnapshots(workspacePath, Array.from(fileOpTouchedFiles)),
                verifier: latestVerifier,
              });

              if (!patchPlan?.tool_calls?.length) {
                sendSSE('info', {
                  message: 'FILE_OP v2: secondary patch planner returned no executable calls; switching to primary micro-fix attempt.',
                });
                delegatePrimaryMicroFix = true;
                break;
              }

              const applied = await executeSecondaryPatchCalls(
                patchPlan.tool_calls,
                progress.no_progress ? 'watchdog escalation' : 'verifier repair',
              );
              maybeSaveFileOpCheckpoint({
                phase: 'execute',
                next_action: applied.ran > 0 ? 'secondary patch batch applied' : 'secondary patch batch empty',
              });

              latestVerifier = await runVerifier();
              if (latestVerifier?.verdict === 'PASS') {
                maybeSaveFileOpCheckpoint({
                  phase: 'done',
                  next_action: 'verification pass after secondary repair',
                });
                clearFileOpCheckpoint(sessionId);
                break;
              }
              if (!latestVerifier) break;
              reasonForPatch = (latestVerifier.reasons || []).join(' | ') || 'verifier fail after repair';
            }

            if (delegatePrimaryMicroFix) {
              const findingsText = (latestVerifier?.findings || [])
                .slice(0, 3)
                .map((f: any) => `${f.filename || 'file'}:${f.type || 'issue'} expected="${String(f.expected || '').slice(0, 70)}" observed="${String(f.observed || '').slice(0, 70)}"`)
                .join(' | ');
              const failReasons = (latestVerifier?.reasons || []).join(' | ');
              fileOpOwner = 'primary';
              if (candidateText) messages.push({ role: 'assistant', content: candidateText });
              messages.push({
                role: 'user',
                content: `Verifier FAIL (${failReasons || 'unspecified'}). Apply ONLY a minimal tool patch now. Constraints: max ${fileOpSettings.primary_edit_max_lines} changed lines, max ${fileOpSettings.primary_edit_max_chars} chars, max ${fileOpSettings.primary_edit_max_files} file. No refactor, no extra files. Findings: ${findingsText || 'fix request mismatch and re-check.'}`,
              });
              maybeSaveFileOpCheckpoint({
                phase: 'execute',
                next_action: 'primary micro-fix patch requested',
                findings: latestVerifier?.findings || [],
              });
              continue;
            }

            const finalVerifier = await runVerifier();
            if (finalVerifier?.verdict === 'FAIL') {
              const reasons = (finalVerifier.reasons || []).join(' | ') || 'verification failed';
              if (candidateText) messages.push({ role: 'assistant', content: candidateText });
              messages.push({
                role: 'user',
                content: `Verifier still FAIL (${reasons}). Apply the next concrete patch now and continue until it passes.`,
              });
              maybeSaveFileOpCheckpoint({
                phase: 'execute',
                next_action: 'retry after final verifier fail',
                findings: finalVerifier.findings || [],
              });
              continue;
            }
            maybeSaveFileOpCheckpoint({
              phase: 'done',
              next_action: 'verification pass after repair loop',
            });
            clearFileOpCheckpoint(sessionId);
          } else {
            sendSSE('info', {
              message: 'FILE_OP v2: secondary verifier unavailable; continuing with current result.',
            });
          }
        }
      }

      const requiresWriteNoteBeforeFinal =
        /\bMUST\s+call\s+write_note\b/i.test(message)
        && tools.some((t: any) => String(t?.function?.name || '').trim() === 'write_note')
        && !allToolResults.some((r) => String(r.name || '').trim() === 'write_note' && !r.error);

      if (requiresWriteNoteBeforeFinal && writeNoteFinalizationGuard < MAX_WRITE_NOTE_FINALIZATION_GUARD) {
        writeNoteFinalizationGuard++;
        console.log('[v2] FINALIZATION BLOCKED: required write_note was not called before final response');
        sendSSE('info', {
          message: 'Post-check: continuing so the required write_note can be recorded.',
        });
        if (candidateText) {
          messages.push({ role: 'assistant', content: candidateText });
        }
        messages.push({
          role: 'user',
          content: [
            'Do not finalize yet: the current task explicitly requires a write_note call before completion.',
            'The write_note tool is available in this runtime.',
            '',
            'Call write_note now with tag "last_run_insight" and a brief 1-2 sentence reflection about this scheduled run.',
            'Do not claim write_note is unavailable. Do not call any other tool unless write_note fails.',
            'After write_note succeeds, repeat the user-facing final summary without adding an operational blocker about write_note.',
          ].join('\n'),
        });
        continue;
      }

      // ── Final safeguard: block finalization if declared plan has open steps
      // This prevents the AI from stopping when manualPlanHasOpenSteps is true.
      // Capped at MAX_PLAN_FINALIZATION_GUARD to prevent infinite loops when the model
      // stops calling tools (e.g. after exhausting continuation nudges).
      if (manualPlanHasOpenSteps && planFinalizationGuard < MAX_PLAN_FINALIZATION_GUARD) {
        planFinalizationGuard++;
        const currentStepIndex = progressState.items.findIndex(
          (i) => i.status === 'in_progress' || i.status === 'pending',
        );
        const currentStepNumber = currentStepIndex >= 0 ? currentStepIndex + 1 : 1;
        const currentStepText = currentStepIndex >= 0
          ? progressState.items[currentStepIndex].text
          : 'Next declared plan step';
        console.log(
          `[v2] FINALIZATION BLOCKED: declared plan step ${currentStepNumber} ("${currentStepText}") still incomplete (guard ${planFinalizationGuard}/${MAX_PLAN_FINALIZATION_GUARD})`,
        );
        sendSSE('info', {
          message: `ERROR: Plan step ${currentStepNumber} is still incomplete. You cannot finalize. Complete the step using available tools.`,
        });
        messages.push({
          role: 'user',
          content: [
            `CRITICAL: You must complete plan step ${currentStepNumber}: "${currentStepText}"`,
            '',
            'Your previous reply attempted to finalize or narrated intent without tool calls.',
            'Do not answer in prose. Your next assistant message must contain tool calls only.',
            'Use the workspace file tools directly: list_directory, read_files_batch, read_file, apply_patchset, mkdir, create_file, replace_lines, find_replace, file_stats.',
            'After the step is actually complete, call complete_plan_step with concrete evidence.',
          ].join('\n'),
        });
        continue;
      }

      const pendingSpawnedBgRuns: Array<{ id: string; timeoutMs?: number }> = allToolResults
        .filter((r) => r.name === 'background_spawn' && !r.error)
        .map((r) => {
          try {
            const parsed = JSON.parse(r.result);
            const id = String(parsed?.id || '').trim();
            if (!id || backgroundResultInjectedIds.has(id)) return null;
            const timeoutMs = Number(parsed?.timeoutMs);
            return {
              id,
              timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : undefined,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ id: string; timeoutMs?: number }>;

      if (pendingSpawnedBgRuns.length > 0 && backgroundFinalizationGuard < MAX_BACKGROUND_FINALIZATION_GUARD) {
        backgroundFinalizationGuard++;
        const pendingBgIds = pendingSpawnedBgRuns.map((run) => run.id);
        console.log(
          `[v2] FINALIZATION BLOCKED: waiting for ${pendingSpawnedBgRuns.length} background agent(s) before synthesized final response`,
        );
        sendSSE('info', {
          message: `Waiting for ${pendingSpawnedBgRuns.length} background agent${pendingSpawnedBgRuns.length > 1 ? 's' : ''} before final response...`,
        });
        const joinedResults = await Promise.all(
          pendingSpawnedBgRuns.map((run) => backgroundJoin({ backgroundId: run.id, joinPolicy: 'wait_all', timeoutMs: run.timeoutMs })),
        );
        const resultBlocks = joinedResults
          .map((r, i) => {
            const bgId = pendingBgIds[i];
            backgroundResultInjectedIds.add(bgId);
            if (!r) return `[Background Agent ${bgId} — missing]\nNo background agent record was found.`;
            const state = r.state === 'completed' ? 'completed' : r.state === 'timed_out' ? 'timed out' : 'failed';
            const body = r.state === 'completed' ? (r.result || '(no output)') : (r.error || r.state);
            return `[Background Agent ${bgId} — ${state}]\n${body}`;
          })
          .filter(Boolean);

        if (candidateText) {
          messages.push({ role: 'assistant', content: candidateText });
        }
        messages.push({
          role: 'user',
          content: [
            '[BACKGROUND_AGENT_RESULTS]',
            ...resultBlocks,
            '',
            'Do not treat this as an error. You attempted to finalize while one or more background_spawn agents were still outstanding.',
            'Review your drafted final response together with these background agent results.',
            'Now produce one complete synthesized final answer that incorporates your own work and the background agents findings/results.',
            'Do not merely append the background output; reconcile it into the answer the user actually needs.',
          ].join('\n\n'),
        });
        continue;
      }

      // If model dumped massive reasoning with no usable reply, generate a fallback
      const emptyModelFinalFallback = 'ERROR: The model returned an empty response. Please retry the message or switch models.';
      let finalText = sanitizeFinalReply(
        String(reply || rawAssistantText || ''),
        { preflightReason: preflightReasonForTurn },
      );
      if (isGrokGeneration) {
        finalText = trimGrokRunawayRepetition(finalText);
      }
      if (!finalText || finalText.length < 5) {
        if (allToolResults.length > 0) {
          // Build a meaningful auto-summary from what the tools actually did
          // instead of just saying 'Done!' which gives no useful information.
          const lastResult = allToolResults[allToolResults.length - 1];
          if (lastResult.error) {
            finalText = `Tool failed: ${lastResult.result.slice(0, 200)}`;
          } else {
            // Summarize the last few tool calls into a compact completion statement
            const actionSummary = allToolResults
              .filter(r => !r.error)
              .slice(-6)
              .map(r => {
                const name = String(r.name || 'tool');
                const args = r.args || {};
                if (isSetupOrScoutTool(name)) {
                  return '';
                }
                // Extract the most meaningful arg per tool type
                if (name === 'create_file' || name === 'write') {
                  return args.filename || args.name || args.path || name;
                }
                if (name === 'replace_lines' || name === 'find_replace' || name === 'insert_after' || name === 'delete_lines') {
                  return `edited ${args.filename || args.name || 'file'}`;
                }
                if (name === 'web_fetch' || name === 'web_search') {
                  return `searched`;
                }
                if (name === 'browser_open') {
                  return `opened ${String(args.url || '').slice(0, 50)}`;
                }
                // For other tools just use the result preview
                return String(r.result || '').slice(0, 80).replace(/\n/g, ' ');
              })
              .filter(Boolean);
            const uniqueActions = Array.from(new Set(actionSummary));
            finalText = uniqueActions.length > 0
              ? `Done. ${uniqueActions.join(', ')}.`
              : `Completed ${allToolResults.length} step${allToolResults.length !== 1 ? 's' : ''}.`;
          }
        } else {
          finalText = emptyModelFinalFallback;
        }
      }
      if (greetingLikeTurn && finalText.length > 220) {
        finalText = finalText.split(/\n+/)[0].slice(0, 220).trim();
      }
      if (grokGreetingLikeTurn && finalText.length > 220) {
        finalText = finalText.split(/\n+/)[0].slice(0, 220).trim();
      }
      finalText = sanitizeFinalReply(finalText, { preflightReason: preflightReasonForTurn }) || emptyModelFinalFallback;
      if (isGrokGeneration) {
        finalText = trimGrokRunawayRepetition(finalText) || emptyModelFinalFallback;
      }
      console.log(`[v2] FINAL: ${finalText.slice(0, 150)}`);
      if (progressState.items.length >= 2) {
        for (const item of progressState.items) {
          if (item.status === 'in_progress') item.status = 'done';
          else if (item.status === 'pending') item.status = 'skipped';
        }
        progressState.activeIndex = -1;
        emitProgressState('finalized');
      }

      if (fileOpV2Active) {
        maybeSaveFileOpCheckpoint({
          phase: 'done',
          next_action: 'turn complete',
        });
        clearFileOpCheckpoint(sessionId);
      }

      // ── Background agent finalization gate ───────────────────────────────────
	      // Collect all background_spawn IDs from this turn, join them, and merge
	      // their results without starting another foreground model request.
      const spawnedBgRuns: Array<{ id: string; timeoutMs?: number }> = allToolResults
        .filter((r) => r.name === 'background_spawn' && !r.error)
        .map((r) => {
          try {
            const parsed = JSON.parse(r.result);
            const id = String(parsed?.id || '').trim();
            if (!id || backgroundResultInjectedIds.has(id)) return null;
            const timeoutMs = Number(parsed?.timeoutMs);
            return {
              id,
              timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : undefined,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ id: string; timeoutMs?: number }>;
      const spawnedBgIds = spawnedBgRuns.map((run) => run.id);

      if (spawnedBgRuns.length > 0) {
        sendSSE('info', { message: `Waiting for ${spawnedBgRuns.length} background agent${spawnedBgRuns.length > 1 ? 's' : ''} to complete...` });
        const joinedResults = await Promise.all(
          spawnedBgRuns.map((run) => backgroundJoin({ backgroundId: run.id, joinPolicy: 'wait_all', timeoutMs: run.timeoutMs }))
        );
        const resultBlocks = joinedResults
          .map((r, i) => {
            if (!r) return null;
            const state = r.state === 'completed' ? '✓' : r.state === 'timed_out' ? '⏱ timed out' : '✗ failed';
            const body = r.state === 'completed' ? (r.result || '(no output)') : (r.error || r.state);
            return `[Background Agent ${spawnedBgIds[i]} — ${state}]\n${body}`;
          })
          .filter(Boolean);
        if (resultBlocks.length > 0) {
	          sendSSE('info', { message: 'Background agents complete - merging results...' });
	          const backgroundText = `Background agent response:\n${resultBlocks.join('\n\n')}`;
	          finalText = [finalText, backgroundText]
	            .map((part) => String(part || '').trim())
	            .filter(Boolean)
	            .join('\n\n');
	          console.log(`[v2] BG MERGE: ${finalText.slice(0, 150)}`);
        }
      }
      // ── End background agent finalization gate ────────────────────────────────

      const finalArtifacts = Array.from(
        new Map(
          allToolResults
            .flatMap((result) => Array.isArray((result as any).artifacts) ? (result as any).artifacts : [])
            .map((artifact: any) => {
              const key = [
                String(artifact?.type || ''),
                String(artifact?.title || ''),
                String(artifact?.path || ''),
                String(artifact?.summary || ''),
              ].join('|');
              return [key, artifact];
            }),
        ).values(),
      );
      const collectGeneratedMedia = (mediaKind: 'image' | 'video'): any[] => {
        const keys = mediaKind === 'image'
          ? ['generated_images', 'generatedImages', 'images', 'generated_image', 'generatedImage', 'image']
          : ['generated_videos', 'generatedVideos', 'videos', 'generated_video', 'generatedVideo', 'video'];
        const rows: any[] = [];
        for (const result of allToolResults as any[]) {
          const sources = [result?.extra, result?.data, result].filter((source) => source && typeof source === 'object');
          for (const source of sources) {
            for (const key of keys) {
              const value = source?.[key];
              if (Array.isArray(value)) rows.push(...value);
              else if (value && typeof value === 'object') rows.push(value);
            }
          }
        }
        return Array.from(new Map(rows.map((item) => {
          const key = [
            String(item?.path || item?.rel_path || item?.relPath || item?.url || item?.src || ''),
            String(item?.file_name || item?.fileName || item?.name || ''),
            String(item?.base64 || '').slice(0, 80),
          ].join('|');
          return [key, item];
        })).values());
      };
      const finalGeneratedImages = collectGeneratedMedia('image');
      const finalGeneratedVideos = collectGeneratedMedia('video');
      const finalCanvasFiles = Array.from(turnCanvasFiles);
      const collectProductCarousel = (): { title: string; items: any[] } | undefined => {
        for (const result of allToolResults as any[]) {
          const sources = [result?.extra, result?.data, result].filter((s) => s && typeof s === 'object');
          for (const source of sources) {
            if (source?.productCarousel && typeof source.productCarousel === 'object') return source.productCarousel;
          }
        }
        return undefined;
      };
      const finalProductCarousel = collectProductCarousel();
      // Rich artifacts lane (additive). Collect any artifacts emitted by tools,
      // then fold the legacy product carousel into a `products` artifact so the
      // new render path covers it without touching every carousel emit site.
      const finalRichArtifacts = collectRichArtifacts(allToolResults as any[]);
      if (finalProductCarousel && !finalRichArtifacts.some((a) => a.type === 'products')) {
        const productsArtifact = productCarouselToArtifact(finalProductCarousel);
        if (productsArtifact) finalRichArtifacts.unshift(productsArtifact);
      }
      const rawFileChanges = collectTurnFileChanges(allToolResults as any[], workspacePath);
      const finalFileChanges = attachWorkspaceCheckpoint(
        rawFileChanges,
        rawFileChanges
          ? createWorkspaceTurnCheckpoint({
              workspacePath,
              sessionId,
              fileChanges: rawFileChanges,
              toolResults: allToolResults as any[],
            })
          : null,
      );

      const finalTextWithSkillOffer = finalizeSkillGardenerForTurn(finalText);
      finalizeBoundTaskRun(/^\s*ERROR:/i.test(finalTextWithSkillOffer) ? 'failed' : 'complete', finalTextWithSkillOffer);
      return {
        type: allToolResults.length > 0 ? 'execute' : 'chat',
        text: finalTextWithSkillOffer,
        thinking: allThinking || undefined,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        artifacts: finalArtifacts.length > 0 ? finalArtifacts : undefined,
        generatedImages: finalGeneratedImages.length > 0 ? finalGeneratedImages : undefined,
        generatedVideos: finalGeneratedVideos.length > 0 ? finalGeneratedVideos : undefined,
        canvasFiles: finalCanvasFiles.length > 0 ? finalCanvasFiles : undefined,
        fileChanges: finalFileChanges,
        productCarousel: finalProductCarousel || undefined,
        richArtifacts: finalRichArtifacts.length > 0 ? finalRichArtifacts : undefined,
      };
    }

    messages.push(response);

    const batchCreatedFiles = new Set<string>();
    let roundHadProgress = false;
    resetProgressRoundStats();

    for (const call of toolCalls) {
      const toolCallId = String((call as any)?.id || '').trim();
      const toolName = call.function?.name || 'unknown';
      const toolArgs = normalizeToolArgsForTool(toolName, call.function?.arguments);

      if (toolName === 'desktop_click') {
        const hasFiniteX = Number.isFinite(Number(toolArgs?.x));
        const hasFiniteY = Number.isFinite(Number(toolArgs?.y));
        const hasFiniteElement = Number.isFinite(Number(toolArgs?.element)) && Number(toolArgs?.element) > 0;
        if ((!hasFiniteX || !hasFiniteY) && !hasFiniteElement) {
          const blockMsg = 'Blocked desktop_click because it is an actual mouse click tool and requires either numeric x/y coordinates or element=N from a SOM screenshot. If the target point is not known yet, call desktop_screenshot(mode:"som") or desktop_window_screenshot(mode:"som") first, then retry with element and screenshot_id.';
          allToolResults.push(makeInstrumentedToolResult(toolName, toolArgs, blockMsg, true));
          logToolCall(workspacePath, toolName, toolArgs, blockMsg, true);
          markProgressStepStart(toolName);
          markProgressStepResult(false, toolName);
          sendSSE('tool_result', {
            action: toolName,
            result: blockMsg,
            error: true,
            stepNum: allToolResults.length,
          });
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: blockMsg,
          });
          continue;
        }

        if (typeof toolArgs?.modifier === 'string') {
          const requestedModifier = String(toolArgs.modifier || '').toLowerCase().trim();
          if (requestedModifier === 'none' || requestedModifier === '') {
            delete (toolArgs as any).modifier;
          } else {
            const hasValidModifier =
              requestedModifier === 'shift' || requestedModifier === 'ctrl' || requestedModifier === 'alt';
            const userAskedForModifier = /\b(ctrl|control|shift|alt|modifier|cmd\+|command\+)\b/i.test(String(message || ''));
            if (hasValidModifier && !userAskedForModifier) {
              if (toolArgs && typeof toolArgs === 'object') {
                delete (toolArgs as any).modifier;
              }
            }
          }
        }
      }

      // ── Scroll-before-act gate ────────────────────────────────────────────────
      // Block PageDown / browser_scroll on interactive pages when the model hasn't
      // filled or clicked anything yet. This is the #1 cause of the scroll loop bug
      // where the AI scrolls past the X.com composer instead of filling it.
      // Feed/search pages (x_feed, search_results) are exempt — they need scrolling.
      const isScrollAttempt =
        (toolName === 'browser_press_key' && String(toolArgs?.key || '').toLowerCase() === 'pagedown')
        || toolName === 'browser_scroll';
      if (isScrollAttempt && !browserFillOrClickDoneThisTurn) {
        const sessionInfo = getBrowserSessionInfo(sessionId);
        const currentPacket = sessionInfo.active
          ? await getBrowserAdvisorPacket(sessionId, { maxItems: 0, snapshotElements: 10 }).catch(() => null)
          : null;
        const pageType = currentPacket?.page?.pageType || 'generic';
        const isFeedPage = pageType === 'x_feed' || pageType === 'search_results';
        if (!isFeedPage) {
          browserScrollBeforeActCount++;
          if (browserScrollBeforeActCount > SCROLL_BEFORE_ACT_MAX) {
            const lastSnap = currentPacket?.snapshot || '';
            const blockMsg = [
              `SCROLL BLOCKED: You scrolled ${browserScrollBeforeActCount} time(s) without filling or clicking anything.`,
              `This is the scroll-before-act loop bug. The page already shows actionable elements — stop scrolling and act on them.`,
              lastSnap ? `\nCurrent page snapshot (act on these @ref elements NOW):\n${lastSnap.slice(0, 2000)}` : '',
              `\nRequired next action: find the input or button you need and call browser_fill(ref, text) or browser_click(ref) immediately.`,
              `Do NOT call browser_press_key(PageDown), browser_scroll, or browser_snapshot. Act on the snapshot above.`,
            ].filter(Boolean).join(' ');
            console.warn(`[v2] SCROLL-BEFORE-ACT BLOCKED (${browserScrollBeforeActCount}x): ${toolName} on ${pageType} page before any fill/click`);
            sendSSE('info', { message: `Scroll-before-act gate: blocked ${toolName} on non-feed page (${browserScrollBeforeActCount}/${SCROLL_BEFORE_ACT_MAX} allowed before act required).` });
            const blockedResult: ToolResult = makeInstrumentedToolResult(toolName, toolArgs, blockMsg, true);
            allToolResults.push(blockedResult);
            logToolCall(workspacePath, toolName, toolArgs, blockMsg, true);
            markProgressStepStart(toolName);
            markProgressStepResult(false);
            sendSSE('tool_call', { action: toolName, args: toolArgs, stepNum: allToolResults.length });
            sendSSE('tool_result', { action: toolName, result: blockMsg.slice(0, 300), error: true, stepNum: allToolResults.length });
            messages.push({ role: 'tool', tool_name: toolName, tool_call_id: toolCallId || undefined, content: blockMsg });
            messages.push({ role: 'user', content: `Scroll blocked. You must call browser_fill or browser_click on a @ref from the snapshot above before scrolling. Stop planning and act now.` });
            continue;
          }
        }
      }
      // Track fills and clicks so the gate knows when it's safe to scroll
      if (toolName === 'browser_fill' || toolName === 'browser_click') {
        browserFillOrClickDoneThisTurn = true;
        browserScrollBeforeActCount = 0;
      }
      // ── End scroll-before-act gate ────────────────────────────────────────────

      if (toolName === 'tool_loop_continue') {
        const targetToolName = String(toolArgs?.tool_name || toolArgs?.toolName || '').trim();
        const targetArgs = toolArgs?.args && typeof toolArgs.args === 'object' ? toolArgs.args : {};
        const reason = String(toolArgs?.reason || '').trim();
        const targetSig = targetToolName ? `${targetToolName}:${hashArgs(targetArgs)}` : '';
        const ok = !!targetToolName && reason.length >= 12;
        const resultText = ok
          ? `Loop gate acknowledged. Continuing is allowed for ${targetToolName} with the provided arguments for the rest of this turn.`
          : 'Loop gate was not acknowledged. Provide tool_name, the exact args object, and a concrete reason explaining why repeated use is required.';
        if (ok) {
          loopContinueAllowed.add(targetSig);
          loopGateToolActive = false;
          loopWarnNudged.delete(targetSig);
          loopBlockNudged.delete(targetSig);
          const argsHash = hashArgs(targetArgs);
          for (let i = recentToolCalls.length - 1; i >= 0; i--) {
            if (recentToolCalls[i]?.name === targetToolName && recentToolCalls[i]?.argsHash === argsHash) {
              recentToolCalls.splice(i, 1);
            }
          }
        }
        const gateResult: ToolResult = makeInstrumentedToolResult(toolName, toolArgs, resultText, !ok);
        allToolResults.push(gateResult);
        logToolCall(workspacePath, toolName, toolArgs, resultText, !ok);
        markProgressStepStart(toolName);
        markProgressStepResult(ok);
        sendSSE('tool_result', {
          action: toolName,
          result: resultText,
          error: !ok,
          stepNum: allToolResults.length,
        });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: resultText,
        });
        continue;
      }

      const loopSig = `${toolName}:${hashArgs(toolArgs)}`;
      const loopPivotNudge = 'Loop detector: repeated identical tool use detected. Either pivot to a different approach, or call tool_loop_continue with the exact tool_name/args and a reason if the task truly requires continuing.';
      const loopCheck = checkLoopDetection(toolName, toolArgs);
      if (loopCheck.state === 'block') {
        loopGateToolActive = true;
        const blockMsg = `${loopPivotNudge} Gate raised: ${toolName} with identical arguments has run ${loopCheck.repeats} times (critical threshold ${loopCriticalThreshold}). To continue intentionally, call tool_loop_continue with tool_name="${toolName}", args equal to the exact arguments you still need to repeat, and a concrete reason.`;
        console.warn(`[v2] LOOP BLOCK: ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}) x${loopCheck.repeats}`);
        const blockedResult: ToolResult = {
          name: toolName,
          args: toolArgs,
          result: blockMsg,
          error: true,
        };
        allToolResults.push(blockedResult);
        logToolCall(workspacePath, toolName, toolArgs, blockMsg, true);
        markProgressStepStart(toolName);
        markProgressStepResult(false);
        sendSSE('info', { message: blockMsg });
        sendSSE('tool_result', {
          action: toolName,
          result: blockMsg,
          error: true,
          stepNum: allToolResults.length,
        });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: blockMsg,
        });
        if (!loopBlockNudged.has(loopSig)) {
          loopBlockNudged.add(loopSig);
          messages.push({
            role: 'user',
            content: `${loopPivotNudge} If this is required for the user's request, acknowledge it with tool_loop_continue, then retry ${toolName}.`,
          });
        }
        continue;
      }
      if (loopCheck.state === 'warn') {
        loopGateToolActive = true;
        const warnMsg = `${loopPivotNudge} Warning: ${toolName} with identical arguments repeated ${loopCheck.repeats} times (warning threshold ${loopWarningThreshold}).`;
        console.warn(`[v2] LOOP WARN: ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}) x${loopCheck.repeats}`);
        sendSSE('info', { message: warnMsg });
        if (!loopWarnNudged.has(loopSig)) {
          loopWarnNudged.add(loopSig);
          messages.push({
            role: 'user',
            content: warnMsg,
          });
        }
      }

      if (isBootStartupTurn && !bootAllowedTools.has(toolName)) {
        const blockMsg = `BOOT mode: "${toolName}" is disabled. Use only list_files and read_file, then provide the startup summary.`;
        console.log(`[v2] BOOT TOOL BLOCKED: ${toolName}`);
        const blockedResult: ToolResult = {
          name: toolName,
          args: toolArgs,
          result: blockMsg,
          error: false,
        };
        allToolResults.push(blockedResult);
        roundHadProgress = true;
        logToolCall(workspacePath, toolName, toolArgs, blockMsg, false);
        markProgressStepStart(toolName);
        markProgressStepResult(true);
        sendSSE('tool_result', {
          action: toolName,
          result: blockMsg,
          error: false,
          stepNum: allToolResults.length,
        });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: blockMsg,
        });
        continue;
	      }

	      const isDevEditHotRestartFollowup = isHotRestartTurn
	        && /\[DEV EDIT CONTINUATION\]|\bHOT RESTART DEV-EDIT FOLLOW-UP\b/i.test(String(callerContext || ''));
	      const isAllowedDevEditRestartWriteNote = isDevEditHotRestartFollowup && toolName === 'write_note';
	      if (isHotRestartTurn && !isAllowedDevEditRestartWriteNote) {
	        const blockMsg = `HOT RESTART mode: "${toolName}" is disabled. Provide the restart follow-up only.`;
	        console.log(`[v2] HOT RESTART TOOL BLOCKED: ${toolName}`);
	        const blockedResult: ToolResult = {
	          name: toolName,
	          args: toolArgs,
	          result: blockMsg,
	          error: false,
	        };
	        allToolResults.push(blockedResult);
	        roundHadProgress = true;
	        logToolCall(workspacePath, toolName, toolArgs, blockMsg, false);
	        markProgressStepStart(toolName);
	        markProgressStepResult(true);
	        sendSSE('tool_result', {
	          action: toolName,
	          result: blockMsg,
	          error: false,
	          stepNum: allToolResults.length,
	        });
	        messages.push({
	          role: 'tool',
	          tool_name: toolName,
	          tool_call_id: toolCallId || undefined,
	          content: blockMsg,
	        });
	        continue;
	      }

	      if (toolName === 'create_file') {
        const fn = toolArgs.filename || toolArgs.name;
        if (fn && batchCreatedFiles.has(fn)) {
          console.log(`[v2] SKIP: duplicate create_file("${fn}") in same batch`);
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: `${fn} already created in this batch. Use replace_lines to edit.`,
          });
          continue;
        }
        if (fn) batchCreatedFiles.add(fn);
      }

      // browser_* and desktop_* tools are always allowed to repeat — the browser page
      // and the desktop screen change on every call so caching/blocking makes no sense.
      const allowRepeatedTool =
        toolName.startsWith('browser_') || toolName.startsWith('desktop_');
      const callKey = `${toolName}:${JSON.stringify(toolArgs)}`;
      if (!allowRepeatedTool) {
        const callCount = (seenToolCalls.get(callKey) ?? 0) + 1;
        seenToolCalls.set(callKey, callCount);
        if (callCount > DUPLICATE_SKIP_THRESHOLD) {
          const cachedResult = canReplayReadOnlyCall(toolName)
            ? cachedReadOnlyToolResults.get(callKey)
            : undefined;
          if (cachedResult) {
            const replayedResult: ToolResult = makeInstrumentedToolResult(
              toolName,
              toolArgs,
              cachedResult.result,
              cachedResult.error,
              Date.now(),
              { ...(cachedResult.extra || {}), replayed: true },
            );
            allToolResults.push(replayedResult);
            if (!replayedResult.error) roundHadProgress = true;
            logToolCall(workspacePath, toolName, toolArgs, replayedResult.result, replayedResult.error);
            console.log(`[v2] REPLAY: duplicate ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}) [x${callCount}]`);
            markProgressStepStart(toolName);
            markProgressStepResult(!replayedResult.error, toolName);
            sendSSE('tool_result', {
              action: toolName,
              result: replayedResult.result.slice(0, 500),
              error: replayedResult.error,
              stepNum: allToolResults.length,
            });
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: replayedResult.result,
            });
            continue;
          }
          console.log(`[v2] SKIP: duplicate tool call ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}) [x${callCount}]`);
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: toolName === 'declare_plan'
              ? 'Plan already declared for this turn. Do not call declare_plan again. Continue the current incomplete step, then call complete_plan_step with concrete evidence when that step is actually done.'
              : `Already ran this exact call ${callCount} times. Use the previous result and move on.`,
          });
          continue;
        }
      }

      if (
        fileOpV2Active
        && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
        && fileOpOwner === 'secondary'
        && isFileMutationTool(toolName)
      ) {
        sendSSE('info', {
          message: 'FILE_OP v2: secondary-owned turn; replacing primary mutation call with secondary patch plan.',
        });
        const target = extractFileToolTarget(toolName, toolArgs);
        const patchPlan = await callSecondaryFilePatchPlanner({
          userMessage: message,
          operationType: fileOpType,
          owner: fileOpOwner,
          reason: 'secondary-owned execution',
          fileSnapshots: collectFileSnapshots(
            workspacePath,
            target ? [target, ...Array.from(fileOpTouchedFiles)] : Array.from(fileOpTouchedFiles),
          ),
          blockedPrimaryCall: {
            tool: toolName,
            args: toolArgs,
            reason: 'secondary-owned execution',
          },
          verifier: null,
        });
        if (patchPlan?.tool_calls?.length) {
          const applied = await executeSecondaryPatchCalls(patchPlan.tool_calls, 'secondary owner replacement');
          if (applied.ran > 0) roundHadProgress = true;
        } else {
          fileOpHadToolFailure = true;
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: 'FILE_OP v2: secondary planner produced no replacement calls.',
          });
        }
        continue;
      }

      if (
        fileOpV2Active
        && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
        && fileOpOwner === 'primary'
        && isFileMutationTool(toolName)
      ) {
        const allowance = canPrimaryApplyFileTool({
          tool_name: toolName,
          args: toolArgs,
          message,
          touched_files: fileOpTouchedFiles,
          settings: fileOpSettings,
        });
        if (!allowance.allowed) {
          fileOpOwner = 'secondary';
          maybeSaveFileOpCheckpoint({
            phase: 'repair',
            next_action: `secondary takeover after gate block: ${allowance.reason}`,
          });
          sendSSE('info', {
            message: `FILE_OP v2 gate: promoted to secondary (${allowance.reason}).`,
          });
          const target = extractFileToolTarget(toolName, toolArgs);
          const snapshots = collectFileSnapshots(
            workspacePath,
            target ? [target, ...Array.from(fileOpTouchedFiles)] : Array.from(fileOpTouchedFiles),
          );
          const patchPlan = await callSecondaryFilePatchPlanner({
            userMessage: message,
            operationType: fileOpType,
            owner: fileOpOwner,
            reason: allowance.reason,
            fileSnapshots: snapshots,
            blockedPrimaryCall: {
              tool: toolName,
              args: toolArgs,
              reason: allowance.reason,
            },
            verifier: null,
          });
          if (patchPlan?.tool_calls?.length) {
            const applied = await executeSecondaryPatchCalls(patchPlan.tool_calls, 'primary threshold gate');
            if (applied.ran > 0) roundHadProgress = true;
            maybeSaveFileOpCheckpoint({
              phase: 'execute',
              next_action: applied.ran > 0 ? 'secondary patch calls applied' : 'no patch calls applied',
            });
            continue;
          }
          fileOpHadToolFailure = true;
          const failText = 'FILE_OP v2: secondary patch planner returned no executable calls.';
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: failText,
          });
          markProgressStepStart(toolName);
          markProgressStepResult(false);
          sendSSE('tool_result', {
            action: toolName,
            result: failText,
            error: true,
            stepNum: allToolResults.length,
            actor: 'secondary',
          });
          continue;
        }
      }

      console.log(`[v2] TOOL[${round + 1}]: ${toolName}(${JSON.stringify(toolArgs).slice(0, 150)})`);
      if (toolName !== 'declare_plan') {
        markProgressStepStart(toolName);
      }
      sendSSE('tool_call', { action: toolName, args: toolArgs, stepNum: allToolResults.length + 1 });

      // ── declare_plan: seed the progress panel and short-circuit (no executeTool needed) ──
      if (toolName === 'declare_plan') {
        const rawSteps = Array.isArray(toolArgs.steps) ? toolArgs.steps : [];
        const steps = rawSteps.map((s: any) => String(s || '').trim()).filter(Boolean);
        const plannedSteps = steps.slice(0, 6);
        if (plannedSteps.length >= 2) {
          seedProgressFromLines(plannedSteps, 'declared', { manualStepAdvance: true });
          stepCursor = 0; // reset cursor whenever a fresh plan is declared
          consecutiveStepFailures = 0;
          planStepToolsActive = true;
          const previousNames = new Set(
            tools
              .map((t: any) => String(t?.function?.name || '').trim())
              .filter(Boolean),
          );
          tools = buildCurrentTurnTools();
          const newlyAvailable = tools
            .map((t: any) => String(t?.function?.name || '').trim())
            .filter((name: string) => name && !previousNames.has(name));
          if (newlyAvailable.includes('complete_plan_step')) {
            sendSSE('info', { message: 'Plan step tools unlocked for this turn.' });
          }
          console.log(`[v2] declare_plan: seeded ${plannedSteps.length} steps: ${plannedSteps.join(' -> ')}`);
        } else {
          stepCursor = 0;
          consecutiveStepFailures = 0;
        }
        const planSummary = plannedSteps.length >= 2
          ? `Plan set (${plannedSteps.length} steps): ${plannedSteps.join(' -> ')}`
          : 'Plan acknowledged (no steps provided - proceeding without progress panel).';
        const planArgs = { ...toolArgs, steps: plannedSteps };
        allToolResults.push(makeInstrumentedToolResult(toolName, planArgs, planSummary, false));
        sendSSE('tool_result', { action: toolName, result: planSummary, error: false, stepNum: allToolResults.length });
        const planActiveBehavior = plannedSteps.length >= 2
          ? 'Now: work the steps in order. complete_plan_step is now available for this turn. Keep each step in_progress until it is truly done, then call complete_plan_step with concrete evidence of what you did. Do not re-declare the plan mid-turn. Finish only after every step is complete.'
          : '';
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: `${planSummary}${planActiveBehavior ? `\n\n${planActiveBehavior}` : ''}`,
        });
        resetProgressRoundStats();
        continue;
      }

      // ── bg_plan_declare: ephemeral background-agent isolated planning ──
      if (toolName === 'bg_plan_declare') {
        const isBgAgentSession = executionMode === 'background_agent' || sessionId.startsWith('background_');
        const rawSteps = Array.isArray(toolArgs?.steps) ? toolArgs.steps : [];
        const steps = rawSteps.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 8);
        const bgSummary = isBgAgentSession
          ? bgPlanDeclare(sessionId, steps)
          : 'ERROR: bg_plan_declare is only valid in background_agent sessions.';
        const bgErr = /^ERROR:/i.test(bgSummary);
        allToolResults.push(makeInstrumentedToolResult(toolName, toolArgs, bgSummary, bgErr));
        sendSSE('tool_result', { action: toolName, result: bgSummary, error: bgErr, stepNum: allToolResults.length });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: bgSummary,
        });
        markProgressStepResult(!bgErr, toolName);
        resetProgressRoundStats();
        continue;
      }

      // ── bg_plan_advance: ephemeral background-agent isolated plan advancement ──
      if (toolName === 'bg_plan_advance') {
        const isBgAgentSession = executionMode === 'background_agent' || sessionId.startsWith('background_');
        const note = String(toolArgs?.note || '').trim() || undefined;
        const bgSummary = isBgAgentSession
          ? bgPlanAdvance(sessionId, note)
          : 'ERROR: bg_plan_advance is only valid in background_agent sessions.';
        const bgErr = /^ERROR:/i.test(bgSummary);
        allToolResults.push(makeInstrumentedToolResult(toolName, toolArgs, bgSummary, bgErr));
        sendSSE('tool_result', { action: toolName, result: bgSummary, error: bgErr, stepNum: allToolResults.length });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: bgSummary,
        });
        markProgressStepResult(!bgErr, toolName);
        resetProgressRoundStats();
        continue;
      }

      // ── complete_plan_step / step_complete: advance declared plan step ──
      if (toolName === 'complete_plan_step' || toolName === 'step_complete') {
        const note = String(toolArgs?.note || '').trim();
        const isTaskSession = sessionId.startsWith('task_');
        if (!isTaskSession && !progressState.manualStepAdvance) {
          const infoText = 'No declared plan is active for this turn. Continue the work directly, or call declare_plan first if this turn needs tracked plan steps.';
          allToolResults.push(makeInstrumentedToolResult(toolName, toolArgs, infoText, false));
          sendSSE('tool_result', { action: toolName, result: infoText, error: false, stepNum: allToolResults.length });
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: infoText,
          });
          resetProgressRoundStats();
          continue;
        }
        if (!isTaskSession && progressState.manualStepAdvance && !note) {
          const failText = 'Plan step completion needs concrete evidence in note. Call complete_plan_step again with what you finished, what files/tools/results prove it, and then continue to the next step.';
          allToolResults.push(makeInstrumentedToolResult(toolName, toolArgs, failText, true));
          sendSSE('tool_result', { action: toolName, result: failText, error: true, stepNum: allToolResults.length });
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: failText,
          });
          markProgressStepResult(false, toolName);
          resetProgressRoundStats();
          continue;
        }
        if (!isTaskSession && progressState.manualStepAdvance) {
          const currentStep = progressState.items[stepCursor];
          const currentStepText = String(currentStep?.text || '').trim();
          if (planStepNeedsWriteEvidence(currentStepText, note) && !hasRecentWriteEvidenceForCurrentStep()) {
            const failText = [
              'Plan step completion rejected: this step appears to require creating or editing a file, but no successful write/create/patch/edit tool ran since the step started.',
              currentStepText ? `Current step: ${currentStepText}` : '',
              'Do not narrate that you are writing. Call the actual workspace file tool now: workspace_edit action:create/write/patchset, create_file, write_file, replace_lines, find_replace, insert_after, or apply_patchset. Then verify with path_exists/file_stats/read_file before completing the step.',
            ].filter(Boolean).join('\n');
            allToolResults.push(makeInstrumentedToolResult(toolName, toolArgs, failText, true));
            sendSSE('tool_result', { action: toolName, result: failText, error: true, stepNum: allToolResults.length });
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: failText,
            });
            markProgressStepResult(false, toolName);
            resetProgressRoundStats();
            continue;
          }
        }
        let completionSummary = note
          ? `Plan step completed: ${note}`
          : 'Plan step completed.';

        // Task-runner sessions must persist step completion in task-store so
        // background-task-runner can detect the step advancement.
        if (isTaskSession) {
          const taskId = sessionId.replace(/^task_/, '');
          const liveTask = loadTask(taskId);
          if (!liveTask) {
            const failText = `step_complete failed: task ${taskId} not found`;
            allToolResults.push(makeInstrumentedToolResult(toolName, toolArgs, failText, true));
            sendSSE('tool_result', { action: toolName, result: failText, error: true, stepNum: allToolResults.length });
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: failText,
            });
            markProgressStepResult(false, toolName);
            resetProgressRoundStats();
            continue;
          }

          if (liveTask.currentStepIndex >= liveTask.plan.length) {
            completionSummary = 'All plan steps are already complete.';
          } else {
            const completedStep = liveTask.currentStepIndex;
            mutatePlan(taskId, [{
              op: 'complete',
              step_index: completedStep,
              notes: note || undefined,
            }]);

            const nextStep = Math.min(completedStep + 1, liveTask.plan.length);
            if (nextStep < liveTask.plan.length) {
              setTaskStepRunning(taskId, nextStep);
            } else {
              const finalTask = loadTask(taskId);
              if (finalTask) {
                finalTask.currentStepIndex = nextStep;
                finalTask.lastProgressAt = Date.now();
                saveTask(finalTask);
              }
            }

            completionSummary = `Step ${completedStep + 1} completed.${nextStep < liveTask.plan.length ? ` Next: step ${nextStep + 1}.` : ' All steps completed.'}${note ? ` Note: ${note}` : ''}`;
            sendSSE('task_step_done', {
              completedStep,
              nextStep,
              note: note || undefined,
            });
          }
        } else if (!isTaskSession && toolName === 'step_complete') {
          completionSummary = `${completionSummary} (Handled as plan-step completion in interactive chat.)`;
        }

        if (progressState.manualStepAdvance) {
          advanceProgressStep('step_done');
        }

        allToolResults.push(makeInstrumentedToolResult(toolName, toolArgs, completionSummary, false));
        sendSSE('tool_result', { action: toolName, result: completionSummary, error: false, stepNum: allToolResults.length });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: completionSummary,
        });
        markProgressStepResult(true, toolName);
        resetProgressRoundStats();
        continue;
      }

      if (toolName === 'start_task') {
        const taskGoal = toolArgs.goal || message;
        const maxSteps = toolArgs.max_steps || 25;
        sendSSE('info', { message: `Starting multi-step task: ${taskGoal}` });

        const taskTools = tools.filter((t: any) => t.function.name !== 'start_task') as any[];

        const taskResult = await runTask({
          goal: taskGoal,
          tools: taskTools,
          executor: async (name, args) => {
            const r = await executeToolWithTelemetry(name, args);
            return { result: r.result, error: r.error };
          },
          onProgress: sendSSE,
          systemContext: personalityCtx.slice(0, 500),
          maxSteps,
        });
        markProgressStepResult(taskResult.status !== 'failed');
        finalizeProgressRound();

        activeTasks.set(sessionId, taskResult);

        const summary = taskResult.status === 'complete'
          ? `Task completed in ${taskResult.currentStep} steps!`
          : taskResult.status === 'failed'
            ? `Task failed at step ${taskResult.currentStep}: ${taskResult.error}`
            : `Task paused at step ${taskResult.currentStep}/${taskResult.maxSteps}`;

        const journalSummary = taskResult.journal.slice(-5).map(j => j.result).join('\n');

        return {
          type: 'execute',
          text: `${summary}\n\nRecent steps:\n${journalSummary}`,
          thinking: allThinking || undefined,
          toolResults: taskResult.journal.map(j => ({
            name: j.action.split('(')[0],
            args: {},
            result: j.result,
            error: j.result.startsWith('❌'),
          })),
        };
      }

      // ── Sub-agent spawn ────────────────────────────────────────────────────────────────────
      if (toolName === 'subagent_spawn') {
        const isTaskSession = sessionId.startsWith('task_');

        // Determine profile and build child prompt
        const profile = ((toolArgs.profile || 'reader_only') as SubagentProfile);
        const subTitle  = String(toolArgs.task_title || `${profile} sub-agent task`).slice(0, 120);
        const subPrompt = [
          toolArgs.context_snippet ? `[CONTEXT]\n${String(toolArgs.context_snippet).slice(0, 1200)}\n[/CONTEXT]\n\n` : '',
          String(toolArgs.task_prompt || '').trim(),
        ].join('').trim();

        if (!subPrompt) {
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: 'Sub-agent spawn failed: no task_prompt provided.',
          });
          markProgressStepResult(false);
          continue;
        }

        // Guard: do not allow sub-agents to spawn more sub-agents (prevent recursion)
        const parentTaskId = isTaskSession ? sessionId.replace(/^task_/, '') : undefined;
        if (parentTaskId) {
          const parentTask = loadTask(parentTaskId);
          if (parentTask?.parentTaskId) {
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: 'Sub-agent recursion blocked: sub-agents cannot spawn further sub-agents.',
            });
            markProgressStepResult(false);
            continue;
          }
        }

        const onResumeInstruction =
          `Sub-agent "${subTitle}" has completed. Review the [SUBAGENT RESULT] injected above and continue the parent task.`;
        const parentTask = parentTaskId ? loadTask(parentTaskId) : null;
        const childChannel = parentTask?.channel || inferTaskChannelFromSession(sessionId);

        // Create the child TaskRecord
        const childTask = createTask({
          title: subTitle,
          prompt: subPrompt,
          sessionId: `task_${crypto.randomUUID()}`,
          channel: childChannel,
          plan: [{ index: 0, description: subPrompt.slice(0, 120), status: 'pending' as const }],
          parentTaskId,
          subagentProfile: profile,
          onResumeInstruction,
        });

        // Register child in parent and flip parent to waiting_subagent
        if (parentTaskId) {
          if (parentTask) {
            parentTask.pendingSubagentIds = [...(parentTask.pendingSubagentIds || []), childTask.id];
            parentTask.status = 'waiting_subagent';
            saveTask(parentTask);
          }
        }

        // Spawn the child BackgroundTaskRunner
        const childRunner = new BackgroundTaskRunner(
          childTask.id,
          handleChat,
          makeBroadcastForTask(childTask.id),
          _telegramChannel,
        );
        childRunner.start().catch((err: Error) =>
          console.error(`[SubagentSpawn] Child ${childTask.id} error:`, err.message)
        );

        const ackMsg = `Spawned sub-agent "${subTitle}" (ID: ${childTask.id}, profile: ${profile}). Parent task is paused pending completion.`;

        console.log(`[SubagentSpawn] ${ackMsg}`);
        appendJournal(parentTaskId || childTask.id, { type: 'status_push', content: ackMsg });
        broadcastWS({ type: 'task_subagent_spawned', parentTaskId, childTaskId: childTask.id, subTitle, profile });

        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: ackMsg,
        });
        markProgressStepResult(true);
        // Break out of the tool loop — parent task status is now waiting_subagent,
        // which the BackgroundTaskRunner will detect on its next iteration.
        break;
      }

      // ── Orchestration: explicit request from primary
      if (toolName === 'request_secondary_assist') {
        const orchCfg = getOrchestrationConfig();
        if (orchestrationSkillEnabled && orchCfg?.enabled) {
          if (orchestrationStats.assistCount >= orchCfg.limits.max_assists_per_session) {
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: `Secondary advisor session cap reached (${orchCfg.limits.max_assists_per_session}). Continue without escalation.`,
            });
            markProgressStepResult(false);
            continue;
          }

          const mode   = (toolArgs.mode || 'rescue') as 'planner' | 'rescue';
          const reason = toolArgs.reason || 'Explicitly requested by executor';
          sendSSE('info', { message: `Consulting secondary advisor (${mode} mode)...` });
          console.log(`[Orchestrator] Explicit trigger: ${reason}`);
          const advice = await callSecondaryAdvisor(
            message,
            orchestrationLog,
            reason,
            mode,
            undefined,
            buildSecondaryAssistContext(),
          );
          if (advice) {
            const hint = formatAdvisoryHint(advice);
            orchestrationState.markFired(round);
            const stats = recordOrchestrationEvent(
              sessionId,
              { trigger: 'explicit', reason, mode },
              orchCfg,
            );
            sendSSE('orchestration', {
              trigger: 'explicit',
              reason,
              mode,
              advice,
              assist_count: stats.assistCount,
              assist_cap: orchCfg.limits.max_assists_per_session,
            });
            console.log(
              `[Orchestrator] Explicit assist complete (${stats.assistCount}/${orchCfg.limits.max_assists_per_session})`,
            );
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: hint,
            });
            markProgressStepResult(true);
          } else {
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: 'Secondary advisor unavailable. Continue with your best judgment.',
            });
            markProgressStepResult(false);
          }
          continue;
        }
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: 'Multi-agent orchestration is not enabled.',
        });
        markProgressStepResult(false);
        continue;
      }


	      const preObservationContext = await captureObservationPreContext(toolName, toolArgs);
	      const toolResult = await executeToolWithTelemetry(toolName, toolArgs);
      if (canReplayReadOnlyCall(toolName)) cachedReadOnlyToolResults.set(callKey, toolResult);
      // After any write tool, invalidate cached reads for that file so a
      // subsequent read_file gets fresh content instead of the stale cached version.
      if (WRITE_TOOL_NAMES.has(toolName) && !toolResult.error) {
        const writtenFile = String(toolArgs.filename || toolArgs.name || toolArgs.path || '');
        invalidateReadCacheForFile(writtenFile);
        const touchedFiles = [
          ...((Array.isArray((toolResult as any).data?.touchedFiles) ? (toolResult as any).data.touchedFiles : []) as any[]),
          ...((Array.isArray((toolResult as any).extra?.touchedFiles) ? (toolResult as any).extra.touchedFiles : []) as any[]),
        ]
          .map((item: any) => String(item || '').trim())
          .filter(Boolean);
        for (const touchedFile of Array.from(new Set(touchedFiles))) {
          invalidateReadCacheForFile(touchedFile);
        }
      }
      allToolResults.push(toolResult);
      logToolCall(workspacePath, toolName, toolArgs, toolResult.result, toolResult.error);
      trackFileOpMutation(toolName, toolArgs, toolResult, 'primary');
      if (fileOpV2Active && toolResult.error) fileOpHadToolFailure = true;
      if (!toolResult.error) roundHadProgress = true;
      markProgressStepResult(!toolResult.error, toolName);

      if (toolName === 'request_dev_source_edit' && !toolResult.error) {
        seedDevSourceEditProgressPlan(toolResult);
      }

      if (toolName === 'write_note' && !toolResult.error) {
        const tag = String(toolArgs?.tag || toolArgs?.step || '').trim().replace(/\s+/g, '_').toLowerCase();
        const completedDevEdit = toolResult.extra?.dev_edit_complete === true || toolResult.data?.dev_edit_complete === true || tag === 'dev_edit_complete';
        if (completedDevEdit && progressState.manualStepAdvance && progressState.items.length >= 2) {
          let guard = progressState.items.length + 1;
          while (guard-- > 0 && progressState.items.some((item) => item.status === 'pending' || item.status === 'in_progress')) {
            advanceProgressStep('dev_edit_complete');
          }
        }
      }

      // ── Orchestration: track trigger state
      orchestrationState.recordToolResult(round, toolName, toolArgs, toolResult.error);
      orchestrationLog.push(
        toolResult.error
          ? `✗ ${toolName}(${JSON.stringify(toolArgs).slice(0, 60)}): ${toolResult.result.slice(0, 100)}`
          : `✓ ${toolName}(${JSON.stringify(toolArgs).slice(0, 60)}): ${toolResult.result.slice(0, 80)}`
      );

      console.log(toolResult.error ? `[v2] TOOL FAIL: ${toolResult.result.slice(0, 100)}` : `[v2] TOOL OK: ${toolResult.result.slice(0, 100)}`);
      const toolTelemetryForSse = getToolResultTelemetry(toolResult);
      const toolElapsedMsForSse = getToolElapsedMs(toolResult);
		      sendSSE('tool_result', {
		        action: toolName,
		        args: toolArgs,
		        result: toolResult.result.slice(0, 4000),
		        error: toolResult.error,
		        stepNum: allToolResults.length,
            durationMs: toolElapsedMsForSse,
            elapsedMs: toolElapsedMsForSse,
            elapsed_ms: toolElapsedMsForSse,
            telemetry: toolTelemetryForSse,
		        extra: toolResult.extra,
		      });
      if (toolName === 'switch_model' && !toolResult.error) {
        const switchedModel = getTurnModelOverride(sessionId);
        if (switchedModel?.providerId && switchedModel?.model) {
          sendSSE('model_switched', {
            providerId: switchedModel.providerId,
            model: switchedModel.model,
            reason: switchedModel.reason || String(toolArgs?.reason || '').trim(),
            tier: String(toolArgs?.tier || '').trim().toLowerCase(),
          });
        }
      }
      if (toolName === 'set_current_model' && !toolResult.error) {
        const modelRef = String(toolArgs?.model || '').trim();
        const slashIdx = modelRef.indexOf('/');
        sendSSE('main_model_changed', {
          providerId: slashIdx > 0 ? modelRef.slice(0, slashIdx) : '',
          model: slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef,
          modelRef,
          source: 'current_primary',
        });
      }
      if (toolName === 'set_agent_model' && !toolResult.error && String(toolArgs?.agent_type || '').trim() === 'main_chat') {
        const modelRef = String(toolArgs?.model || '').trim();
        const slashIdx = modelRef.indexOf('/');
        sendSSE('main_model_changed', {
          providerId: slashIdx > 0 ? modelRef.slice(0, slashIdx) : '',
          model: slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef,
          modelRef,
          source: 'agent_model_defaults.main_chat',
        });
      }
      if ((toolName === 'apply_agent_model_template' || toolName === 'select_agent_model_template') && !toolResult.error) {
        const modelRef = String((getConfig().getConfig() as any)?.agent_model_defaults?.main_chat || '').trim();
        if (modelRef) {
          const slashIdx = modelRef.indexOf('/');
          sendSSE('main_model_changed', {
            providerId: slashIdx > 0 ? modelRef.slice(0, slashIdx) : '',
            model: slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef,
            modelRef,
            source: 'agent_model_default_template',
          });
        }
      }

      // Only on success, only for file-mutation tools, not during background tasks.
      if (!toolResult.error && executionMode !== 'background_task' && executionMode !== 'proposal_execution' && executionMode !== 'background_agent' && executionMode !== 'cron' && executionMode !== 'team_manager' && executionMode !== 'team_subagent') {
        const FILE_PRESENT_TOOLS = new Set(['create_file', 'write', 'present_file']);
        if (FILE_PRESENT_TOOLS.has(toolName)) {
          const presentPath = toolArgs?.filename || toolArgs?.name || toolArgs?.path || '';
          if (presentPath) {
            // Resolve to absolute path so the AI always gets the exact path
            const absPath = require('path').isAbsolute(presentPath)
              ? presentPath
              : require('path').join(workspacePath, presentPath);
            addCanvasFile(sessionId, absPath);
            turnCanvasFiles.add(String(presentPath));
            sendSSE('canvas_present', { path: String(presentPath), tool: toolName });
          }
        }
      }

      const goalReminder = `\n\n[GOAL REMINDER: Your task is still: "${message.slice(0, 120)}". Stay focused on this goal only.]`;
      // ── Multi-agent browser interception ────────────────────────────────────
      // Screenshot: OpenAI gets actual image, local model gets rich OCR+window text.
      // All other desktop tools: pass real result text so AI always knows the outcome.
      // Browser tools in multi-agent mode: still use ack to avoid token flood from DOM.
      const isBrowserTool = isBrowserToolName(toolName);
      const isDesktopTool = isDesktopToolName(toolName);
      // Visual screenshot tools end with a screenshot stored in the advisor packet.
      // Give vision-capable primaries the actual PNG so they can see the post-action state.
      const isDesktopVisualTool3 = toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot';
      let toolMessageContent = (isBrowserTool && multiAgentActive)
        ? buildBrowserAck(toolName, toolResult) + goalReminder
        : (isDesktopTool && isDesktopVisualTool3)
          ? buildDesktopScreenshotContent(toolResult, sessionId, goalReminder)
          : (isDesktopTool)
            ? buildDesktopAck(toolName, toolResult) + goalReminder
            : toolResult.result + goalReminder;
      if (isBrowserTool) toolMessageContent = wrapUntrustedBrowserToolContent(toolName, toolMessageContent);
      const stopwatchLine = formatToolStopwatchLineForModel(toolResult);
      if (stopwatchLine) toolMessageContent = `${stopwatchLine}\n${toolMessageContent}`;
      toolMessageContent = boundToolMessageContentForModelContext(toolMessageContent, toolName);
	      messages.push({
	        role: 'tool',
	        tool_name: toolName,
	        tool_call_id: toolCallId || undefined,
	        content: toolMessageContent,
	      });
      if ((toolName === 'request_tool_category' || toolName === 'request_dev_source_edit') && !toolResult.error) {
        const previousNames = new Set(
          tools
            .map((t: any) => String(t?.function?.name || '').trim())
            .filter(Boolean),
        );
        tools = buildCurrentTurnTools();
        const newlyAvailable = tools
          .map((t: any) => String(t?.function?.name || '').trim())
          .filter((name: string) => name && !previousNames.has(name));
        const refreshMessage = summarizeUnlockedToolCategories(newlyAvailable, toolName === 'request_tool_category' ? String(toolArgs?.category || '') : '');
        sendSSE('info', { message: refreshMessage });
        messages.push({
          role: 'user',
          content: `[SYSTEM: ${refreshMessage} Continue the user's original task using the newly available tools when relevant.]`,
        });
      }
	      const appliedObservation = await applySharedPostActionObservation(
	        toolName,
	        toolArgs,
	        toolResult,
	        preObservationContext,
	      );

      if (isBrowserTool && !toolResult.error) {
        browserForcedRetries = 0;
        continuationNudges = 0;
        if (toolName === 'browser_close') {
          browserContinuationPending = false;
          browserAdvisorRoute = null;
          browserAdvisorHintPreview = '';
          resetBrowserAdvisorCollection();
        }
      }
      if (isDesktopTool && !toolResult.error && isDesktopVisualTool3) {
        desktopContinuationPending = false;
      }
      if (!toolResult.error) {
        continuationNudges = 0;
      }
	      await maybeRunBrowserAdvisorPass(
	        appliedObservation.advisorTriggerToolName,
	        appliedObservation.advisorTriggerToolResult,
	        appliedObservation.advisorTriggerToolArgs,
	        appliedObservation.decision,
	        appliedObservation.browserAfterPacket,
	      );
	      await maybeRunDesktopAdvisorPass(
	        appliedObservation.advisorTriggerToolName,
	        appliedObservation.advisorTriggerToolResult,
	        appliedObservation.decision,
	      );

    }

    finalizeProgressRound();

    if ((!sessionId.startsWith('subagent_') || isDirectSubagentChatTurn) && midWorkflowCompactionsThisTurn < 3 && messages.length > 3) {
      const midCompact = await maybeRunMidWorkflowCompaction({
        sessionId,
        messages,
        toolResults: allToolResults,
        reasoningTrail: allThinking,
        sendSSE,
        abortSignal,
      });
      if (midCompact.compacted) {
        midWorkflowCompactionsThisTurn++;
        sendSSE('info', { message: 'Context compacted. Continuing the active workflow...' });
      }
      if (abortSignal?.aborted) return { type: 'chat', text: '' };
    }

    // ── Orchestration: auto-trigger check after each round
    const orchCfg = getOrchestrationConfig();
    if (orchestrationSkillEnabled && orchCfg?.enabled && !isBootStartupTurn) {
      if (!roundHadProgress) orchestrationState.recordRoundNoProgress(round);
      const { fire, reason } = orchestrationState.shouldTrigger(
        orchCfg,
        round,
        Date.now(),
        orchestrationStats.assistCount,
      );
      if (fire && orchestrationStats.assistCount < orchCfg.limits.max_assists_per_session) {
        sendSSE('info', { message: `Auto-consulting advisor: ${reason}` });
        console.log(`[Orchestrator] Auto-trigger (${reason})`);
        const advice = await callSecondaryAdvisor(
          message,
          orchestrationLog,
          reason,
          'rescue',
          undefined,
          buildSecondaryAssistContext(),
        );
        if (advice) {
          const hint = formatAdvisoryHint(advice);
          orchestrationState.markFired(round);
          const stats = recordOrchestrationEvent(
            sessionId,
            { trigger: 'auto', reason, mode: 'rescue' },
            orchCfg,
          );
          sendSSE('orchestration', {
            trigger: 'auto',
            reason,
            mode: 'rescue',
            advice,
            assist_count: stats.assistCount,
            assist_cap: orchCfg.limits.max_assists_per_session,
          });
          console.log(
            `[Orchestrator] Auto assist complete (${stats.assistCount}/${orchCfg.limits.max_assists_per_session})`,
          );
          messages.push({ role: 'user', content: hint });
          messages.push({ role: 'assistant', content: 'Understood. Following the advisor guidance now.' });
        }
      }
    }

    sendSSE('info', { message: 'Processing...' });
  }

  const stepCount = allToolResults.length;
  console.warn(`[v2] WARN max tool rounds reached (${effectiveMaxToolRounds}) in ${executionMode} mode after ${stepCount} tool result(s).`);
  sendSSE('info', {
    message: `Reached the turn safety boundary after ${stepCount} tool step(s). Preserving progress and preparing continuation.`,
  });

  if (isResumableExecutionMode(executionMode)) {
    finalizeSkillGardenerForTurn('Hit max steps - continuing next round.');
    return { type: 'execute', text: 'Hit max steps - continuing next round.', toolResults: allToolResults };
  }

  const creativeSuffix = creativeMode
    ? ' The Creative workspace remains open with the latest changes, so the next turn can continue from here.'
    : '';
  const text = stepCount > 0
    ? `I reached the turn safety boundary after ${stepCount} tool step(s), but progress was preserved.${creativeSuffix} Say "continue" and I will pick up from the current state instead of starting over.`
    : 'I reached the turn safety boundary before completing the request. Say "continue" and I will retry from the current state.';
  const finalTextWithSkillOffer = finalizeSkillGardenerForTurn(text);
  return { type: 'execute', text: finalTextWithSkillOffer, toolResults: allToolResults };
  } finally {
    // switch_model overrides are strictly turn-scoped; always clear on turn end.
    // If a turn override was active, notify the UI so it can revert the model badge.
    const hadTurnOverride = getTurnModelOverride(sessionId);
    clearTurnModelOverride(sessionId);
    if (hadTurnOverride?.providerId && hadTurnOverride?.model) {
      try {
        const cfg = getConfig().getConfig() as any;
        const primaryProvider = String(cfg?.llm?.provider || '').trim();
        const primaryModel = primaryProvider
          ? String(cfg?.llm?.providers?.[primaryProvider]?.model || '').trim()
          : '';
        sendSSE('model_reverted', {
          providerId: primaryProvider,
          model: primaryModel,
          modelRef: primaryProvider && primaryModel ? `${primaryProvider}/${primaryModel}` : '',
          source: 'current_primary',
        });
      } catch {
        // Non-critical — badge will refresh on next navigation or badge click.
      }
    }
  }
}
// Wire chat-helpers and task-router deps moved into initChatRouter() (B6)

const editRerunAbortResetSessions = new Set<string>();

// ─── SSE + Routes ──────────────────────────────────────────────────────────────

async function maybeRefreshProjectLearning(
  sessionId: string,
  extraTextBlocks?: string[],
): Promise<void> {
  try {
    await refreshProjectContextForSession(sessionId, { extraTextBlocks });
  } catch (err: any) {
    console.warn(`[ProjectLearning] Refresh failed for session ${sessionId}:`, err?.message || err);
  }
}

const activeMainChatGoalRuns = new Set<string>();

function broadcastMainChatGoalState(sessionId: string, event: string, extra: Record<string, any> = {}): void {
  try {
    broadcastWS({
      type: 'main_chat_goal_updated',
      sessionId,
      event,
      goal: snapshotMainChatGoal(sessionId),
      ...extra,
    });
  } catch {}
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGrokGenerationOverride(generationOverride: any): boolean {
  const provider = String(generationOverride?.provider || generationOverride?.providerId || '').trim().toLowerCase();
  const model = String(generationOverride?.model || '').trim().toLowerCase();
  return provider === 'xai' || model.startsWith('grok-') || model.includes('/grok-');
}

function isGrokGreetingLikeMessage(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 120) return false;
  if (/\b(search|open|read|write|file|code|task|build|fix|debug|run|install|http|www\.|\\.com|please|could you|can you)\b/i.test(raw)) return false;
  if (isGreetingLikeMessage(raw)) return true;
  return /^(?:hi|hello|hey|yo|sup|howdy)(?:[!.?\s,]+(?:hi|hello|hey|yo|sup|howdy)){0,3}(?:[!.?\s,]+(?:prom|prometheus|claw))?[!.?\s]*$/i.test(raw);
}

function trimGrokRunawayRepetition(text: string): string {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';

  const inlineLoopTrimmed = trimGrokInlineLoop(raw);
  if (inlineLoopTrimmed && inlineLoopTrimmed.length < raw.length) return inlineLoopTrimmed;

  const paragraphs = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  // Short-phrase affirmation loop: find where substantive content gives way to tiny fragments.
  // Grok often produces good content then devolves into "Yes.", "Done.", "(End.)", "👍" etc.
  if (paragraphs.length >= 4) {
    let consecutiveShort = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].length < 40) {
        consecutiveShort++;
        if (consecutiveShort >= 3 && i - consecutiveShort + 1 > 0) {
          const trimmed = paragraphs.slice(0, i - consecutiveShort + 1).join('\n\n').trim();
          if (trimmed) return trimmed;
        }
      } else {
        consecutiveShort = 0;
      }
    }
  }

  const kept: string[] = [];
  const seen = new Map<string, number>();
  for (const paragraph of paragraphs) {
    const norm = normalizeForDedup(paragraph);
    if (!norm) continue;
    const count = (seen.get(norm) || 0) + 1;
    seen.set(norm, count);
    if (count > 2) break;
    kept.push(paragraph);
  }

  const joined = kept.join('\n\n') || raw;
  const sentences = joined.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 8) return joined.trim();

  const out: string[] = [];
  const sentenceSeen = new Map<string, number>();
  for (const sentence of sentences) {
    const norm = normalizeForDedup(sentence);
    if (!norm) continue;
    const count = (sentenceSeen.get(norm) || 0) + 1;
    sentenceSeen.set(norm, count);
    if (count > 2) break;
    out.push(sentence);
  }
  return (out.length ? out.join(' ') : joined).trim();
}

function getParentheticalRuns(text: string): string[] {
  const matches = String(text || '').matchAll(/\(([^()\n]{1,60})\)/g);
  return [...matches]
    .map((match) => normalizeForDedup(match[1] || ''))
    .filter(Boolean);
}

function isLikelyGrokInlineLoop(text: string): boolean {
  const tail = String(text || '').slice(-1800);
  const parentheticalRuns = getParentheticalRuns(tail);
  if (parentheticalRuns.length >= 24) {
    const unique = new Set(parentheticalRuns);
    if (unique.size <= 16 || unique.size / parentheticalRuns.length <= 0.65) return true;
  }

  const words = tail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1);
  if (words.length < 80) return false;
  const grams: string[] = [];
  for (let i = 0; i <= words.length - 3; i++) grams.push(words.slice(i, i + 3).join(' '));
  if (grams.length < 50) return false;
  const uniqueGrams = new Set(grams);
  return uniqueGrams.size / grams.length <= 0.42;
}

function trimGrokInlineLoop(text: string): string {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw || !isLikelyGrokInlineLoop(raw)) return raw;

  const matches = [...raw.matchAll(/\(([^()\n]{1,60})\)/g)];
  if (matches.length < 24) return raw.slice(0, 1800).trim();

  const seen = new Map<string, number>();
  for (const match of matches) {
    const norm = normalizeForDedup(match[1] || '');
    if (!norm) continue;
    const count = (seen.get(norm) || 0) + 1;
    seen.set(norm, count);
    if (count >= 3) {
      const cutAt = typeof match.index === 'number' ? match.index : raw.length;
      const trimmed = raw.slice(0, cutAt).trim();
      return trimmed || raw.slice(0, 1800).trim();
    }
  }

  return raw.slice(0, 1800).trim();
}

function shouldCheckBlockedTaskFollowup(message: string): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  if (parseTaskIdFromText(text)) return true;
  if (isResumeIntent(text) || isRerunIntent(text) || isCancelIntent(text)) return true;
  if (/^\s*(proceed|go ahead|ok|okay|continue|yes|yep|sure|do it|keep going|try again|move on|sounds good|ready|done|fixed|logged in|i logged in|all good)\.?\s*$/i.test(text)) return true;
  if (/\b(logged in|fixed it|done now|all set|ready now|answered|clarification|the answer is|use this|try again)\b/i.test(text)) return true;
  return false;
}

function startMainChatGoalRunner(sessionId: string, source = 'goal_command'): void {
  const sid = String(sessionId || '').trim();
  if (!sid || activeMainChatGoalRuns.has(sid)) return;
  const initial = snapshotMainChatGoal(sid);
  if (!initial || initial.status !== 'active') return;
  activeMainChatGoalRuns.add(sid);
  broadcastMainChatGoalState(sid, 'runner_started', { source });

  void (async () => {
    try {
      await delayMs(250);
      while (true) {
        const current = snapshotMainChatGoal(sid);
        if (!current || current.status !== 'active') {
          broadcastMainChatGoalState(sid, 'runner_stopped', { reason: current?.status || 'no_goal' });
          return;
        }

        const prompt = buildMainChatGoalContinuationPrompt(current);
        const abortController = new AbortController();
        const abortSignal = { aborted: false, signal: abortController.signal };
        const runtimeId = registerLiveRuntime({
          kind: 'main_chat_goal',
          label: 'Main chat goal',
          sessionId: sid,
          source: 'goal',
          detail: current.goal.slice(0, 160),
          abortSignal,
          onAbort: () => abortController.abort(),
        });
        setModelBusy(true);
        broadcastMainChatGoalState(sid, 'turn_started', { turnsUsed: current.turnsUsed });
        const runtimeProcessEntries: Record<string, any>[] = [];
        let runtimeThinkingTail = '';

        let result: HandleChatResult | null = null;
        try {
          result = await runInteractiveTurn(
            prompt,
            sid,
            (event, data) => {
              const checkpoint: Record<string, any> = { event, at: Date.now() };
              if (data?.message) checkpoint.message = String(data.message).slice(0, 1000);
              if (data?.action || data?.name) checkpoint.toolName = String(data.action || data.name);
              if (data?.args && typeof data.args === 'object') checkpoint.args = data.args;
              if (data?.result) checkpoint.result = String(data.result).slice(0, 1000);
              if (event === 'thinking_delta') {
                const delta = String(data?.thinking || data?.text || '').trim();
                if (delta) runtimeThinkingTail = `${runtimeThinkingTail}${delta}`.slice(-4000);
                checkpoint.thinkingTail = runtimeThinkingTail;
              } else {
                const processEntry = runtimeProcessEntryFromSseEvent(event, data);
                if (processEntry) {
                  runtimeProcessEntries.push(processEntry);
                  if (runtimeProcessEntries.length > 250) {
                    runtimeProcessEntries.splice(0, runtimeProcessEntries.length - 250);
                  }
                  checkpoint.processEntries = [...runtimeProcessEntries];
                }
                if (event === 'thinking') {
                  const thinking = String(data?.thinking || data?.text || '').trim();
                  if (thinking) runtimeThinkingTail = `${runtimeThinkingTail}\n${thinking}`.trim().slice(-4000);
                }
                if (runtimeThinkingTail) checkpoint.thinkingTail = runtimeThinkingTail;
              }
              updateLiveRuntimeCheckpoint(runtimeId, checkpoint);
              try {
                broadcastWS({ type: 'main_chat_goal_sse', sessionId: sid, event, ...data });
              } catch {}
            },
            undefined,
            abortSignal,
            'CONTEXT: Synthetic continuation turn for active main-chat goal mode.',
            undefined,
            undefined,
            undefined,
            undefined,
            { syntheticGoalContinuation: true } as any,
          );
          attachRuntimeProcessEntriesToLatestAssistant(sid, runtimeProcessEntries);
        } catch (err: any) {
          const failed = recordMainChatGoalRuntimeFailure(sid, current.id, err?.message || String(err));
          broadcastMainChatGoalState(sid, 'runtime_failure', { error: err?.message || String(err), goal: failed });
          if (!failed || failed.status !== 'active') return;
          await delayMs(750);
          continue;
        } finally {
          setModelBusy(false);
          finishLiveRuntime(runtimeId);
        }

        const latest = snapshotMainChatGoal(sid);
        if (!latest || latest.id !== current.id || latest.status !== 'active') {
          broadcastMainChatGoalState(sid, 'runner_stopped', { reason: latest?.status || 'goal_changed' });
          return;
        }

        const judge = await judgeMainChatGoal(latest, String(result?.text || ''));
        const judged = applyMainChatGoalJudgeResult(sid, latest.id, judge);
        broadcastMainChatGoalState(sid, 'judged', { judge, goal: judged });
        if (!judged || judged.status !== 'active') return;

        const summarized = await maybeSummarizeMainChatGoal(sid);
        if (summarized?.lastSummaryAt && summarized.goalSummaryTurn === summarized.turnsUsed) {
          broadcastMainChatGoalState(sid, 'summarized', { goal: summarized });
        }
        await delayMs(350);
      }
    } finally {
      activeMainChatGoalRuns.delete(sid);
      broadcastMainChatGoalState(sid, 'runner_idle');
    }
  })();
}

export function resumeMainChatGoalsInterruptedForRestart(): string[] {
  const policy = resolveMainChatGoalPolicy();
  if (!policy.enabled || !policy.autoResumeOnRestart) return [];
  const resumed: string[] = [];
  const records = getAllMainChatGoalRecords();
  for (const record of records) {
    const goal = (record as any)?.goal || record;
    if ((record as any)?.current === false) continue;
    const sessionId = String((record as any)?.sessionId || goal?.sessionId || '').trim();
    if (!sessionId || String(goal?.status || '') !== 'paused') continue;
    const pausedReason = String(goal?.pausedReason || goal?.paused_reason || '').toLowerCase();
    if (!/gateway_restart|gateway_crash|restart/.test(pausedReason)) continue;
    const result = handleMainChatGoalCommand(sessionId, '/goal resume');
    if (result.goal?.status === 'active') {
      startMainChatGoalRunner(sessionId, 'startup_auto_resume');
      broadcastMainChatGoalState(sessionId, 'startup_auto_resume', { goal: result.goal });
      resumed.push(sessionId);
    }
  }
  return Array.from(new Set(resumed));
}

function cleanGeneratedSessionTitle(raw: unknown): string {
  let title = String(raw || '').trim();
  const match = title.match(/\[\s*Title\s*:\s*([^\]]+)\]/i) || title.match(/^Title\s*:\s*(.+)$/i);
  if (match) title = match[1] || '';
  title = title
    .split(/\r?\n/)[0]
    .replace(/^["'`*_ \t]+|["'`*_ \t]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,\-]+$/g, '')
    .trim();
  if (!title) return '';
  if (/^(?:new chat|untitled|greeting|hello|hey|hi)$/i.test(title)) return '';
  if (/^(?:name this|chat thread|conversation|short helpful title)$/i.test(title)) return '';
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > 8) title = words.slice(0, 8).join(' ');
  return title.slice(0, 60).trim();
}

function sessionTitleTranscript(session: ReturnType<typeof getSession>): { transcript: string; userCount: number; hasSubstantiveUserText: boolean } {
  const messages = Array.isArray(session?.history) ? session.history : [];
  const visible = messages
    .filter((msg: any) => {
      const role = String(msg?.role || '').toLowerCase();
      if (role !== 'user' && role !== 'assistant' && role !== 'ai') return false;
      const content = String(msg?.content || '').trim();
      if (!content) return false;
      if (/^\s*(?:\[Title:|Title:)/i.test(content)) return false;
      return true;
    })
    .slice(0, 6);
  const userMessages = visible.filter((msg: any) => String(msg?.role || '').toLowerCase() === 'user');
  const hasSubstantiveUserText = userMessages.some((msg: any) => {
    const text = String(msg?.content || '').trim();
    return text.length >= 8 && !/^(?:hi|hey|hello|yo|good morning|good afternoon|good evening|what'?s up|sup)[.!?\s]*$/i.test(text);
  });
  const transcript = visible
    .map((msg: any) => {
      const role = String(msg?.role || '').toLowerCase() === 'user' ? 'User' : 'Prometheus';
      const content = String(msg?.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      return `${role}: ${content}`;
    })
    .join('\n')
    .slice(0, 2200);
  return { transcript, userCount: userMessages.length, hasSubstantiveUserText };
}

async function maybeAutoNameChatSession(sessionId: string): Promise<string | null> {
  const session = getSession(sessionId);
  if (!session || session.autoTitleLocked === true) return null;
  const { transcript, userCount, hasSubstantiveUserText } = sessionTitleTranscript(session);
  if (!transcript || !hasSubstantiveUserText || userCount < 1 || userCount > 3) return null;

  const prompt = [
    'Name this Prometheus chat thread based on the context so far.',
    'Return ONLY this exact shape: [Title:Short Helpful Title]',
    'Rules: 3-7 words, specific to the task, no quotes, no markdown, no trailing punctuation, never use "New chat".',
    '',
    'Transcript:',
    transcript,
  ].join('\n');

  let title = '';
  try {
    const generated = await Promise.race([
      getOllamaClient().generate(prompt, 'executor', {
        temperature: 0,
        num_predict: 32,
        think: 'none',
        usageContext: { sessionId },
      } as any),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000)),
    ]);
    title = cleanGeneratedSessionTitle(generated);
  } catch (err: any) {
    console.warn('[chat-title] failed to generate session title:', err?.message || err);
  }

  if (!title) return null;
  const summary = autoNameSession(sessionId, title);
  return summary?.title || null;
}

async function runInteractiveTurn(
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
	  abortSignal?: { aborted: boolean; signal?: AbortSignal },
	  callerContext?: string,
	  reasoningOptions?: ReasoningOptions,
	  attachments?: Array<{ base64: string; mimeType: string; name: string }>,
    attachmentPreviews?: any[],
    modelOverride?: string,
    flags?: { syntheticGoalContinuation?: boolean; directSubagentChat?: boolean; excludedSkillIds?: string[]; forcedSkillIds?: string[] },
    turnOriginInput?: TurnOrigin,
    requestMeta?: { clientRequestId?: string },
    /** Optional token-stream sink forwarded to handleChat (see callerOnToken there). */
    callerOnToken?: (token: string) => void,
): Promise<HandleChatResult> {
  const isSubagentChatSession = /^subagent_chat_/i.test(String(sessionId || ''));
  const isDirectSubagentChatTurn = isSubagentChatSession && flags?.directSubagentChat === true;
  const turnExcludedSkillIds = Array.isArray(flags?.excludedSkillIds)
    ? flags.excludedSkillIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const turnForcedSkillIds = Array.isArray(flags?.forcedSkillIds)
    ? flags.forcedSkillIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const isGoalContinuationTurn = flags?.syntheticGoalContinuation === true || isMainChatGoalContinuation(message);
  const isTimerTurn = /^\s*\[Timer fired\]/i.test(String(message || ''));
  const turnOrigin = normalizeTurnOrigin(turnOriginInput, sessionId, isTimerTurn || isGoalContinuationTurn ? { channel: 'system', surface: 'automation', device: 'server' } : undefined);
  persistTurnOriginChannelHint(sessionId, turnOrigin);
  const existingMainChatStream = getMainChatStream(sessionId);
  const localMainChatStream = existingMainChatStream?.active
      ? null
      : beginMainChatStream(sessionId);
  let localMainChatStreamCompleted = false;
  const completeLocalMainChatStream = (result: HandleChatResult | { type?: string; text?: string; thinking?: string; toolResults?: any[]; artifacts?: any[]; generatedImages?: any[]; generatedVideos?: any[]; canvasFiles?: any[]; fileChanges?: any; productCarousel?: any; richArtifacts?: any[] } | null | undefined): void => {
    if (!localMainChatStream || localMainChatStreamCompleted) return;
    localMainChatStreamCompleted = true;
    appendMainChatStreamEvent(sessionId, localMainChatStream.streamId, 'done', {
      reply: String(result?.text || ''),
      mode: String(result?.type || 'chat'),
      sections: [{ type: result?.type === 'execute' ? 'tool_results' : 'text', content: String(result?.text || '') }],
      thinking: result?.thinking,
      results: result?.toolResults,
      artifacts: result?.artifacts,
      generatedImages: result?.generatedImages,
      generatedVideos: result?.generatedVideos,
      canvasFiles: result?.canvasFiles,
      fileChanges: result?.fileChanges,
      productCarousel: result?.productCarousel,
      richArtifacts: result?.richArtifacts,
    });
  };
  const upstreamSendSSE = sendSSE;
  sendSSE = (event: string, data: any) => {
    let streamData = data;
    if (localMainChatStream) {
      const frame = appendMainChatStreamEvent(sessionId, localMainChatStream.streamId, event, data);
      if (frame) {
        streamData = {
          ...(data && typeof data === 'object' ? data : {}),
          seq: frame.seq,
          streamId: localMainChatStream.streamId,
          at: frame.at,
        };
      }
    }
    upstreamSendSSE(event, streamData);
  };
  const userMsg = {
    role: 'user' as const,
    content: message,
    timestamp: Date.now(),
    channel: turnOrigin.channel,
    channelLabel: turnOrigin.label || turnOrigin.channel,
    origin: turnOrigin,
    ...(isTimerTurn ? { channel: 'system' as const, channelLabel: 'timer' } : {}),
    ...(isGoalContinuationTurn ? { channel: 'system' as const, channelLabel: 'goal' } : {}),
    ...(Array.isArray(attachmentPreviews) && attachmentPreviews.length ? { attachmentPreviews } : {}),
  };
  if (!isGoalContinuationTurn) {
    appendMainChatStreamEvent(sessionId, localMainChatStream?.streamId || existingMainChatStream?.streamId || '', 'user_message', {
      message: userMsg,
      clientRequestId: normalizeClientRequestId(requestMeta?.clientRequestId),
    });
  }
  try {
    const rollingCompactionApplied = false;

  if (!isSubagentChatSession && !isGoalContinuationTurn && /^\/goal(?:\s|$)/i.test(String(message || '').trim())) {
    const command = handleMainChatGoalCommand(sessionId, message);
    const reply = command.message || 'Goal command handled.';
    addMessage(sessionId, userMsg, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    addMessage(sessionId, { role: 'assistant', content: reply, timestamp: Date.now() }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    broadcastMainChatGoalState(sessionId, 'command', { goal: command.goal });
    if (command.shouldStartRunner) startMainChatGoalRunner(sessionId, 'goal_command');
    const commandResult = { type: 'chat' as const, text: reply };
    completeLocalMainChatStream(commandResult);
    return commandResult;
  }

  if (isSubagentChatSession) {
    const session = getSession(sessionId);
    session.pendingCompaction = false;
    session.pendingMemoryFlush = false;
  }

  // Legacy rolling message-count compaction is intentionally no longer triggered
  // at turn start. Context compaction is now driven by provider-aware token/tool
  // budgets inside the execution loop, so users do not see "every 20 messages"
  // compaction attempts.

  const skipDuplicateVoiceWorkflowUser = hasRecentVoiceWorkflowUserMessage(sessionId, message);
  const addResult: any = skipDuplicateVoiceWorkflowUser
    ? { added: false, deferredForCompaction: false, deferredForMemoryFlush: false }
    : addMessage(sessionId, userMsg, {
        deferOnMemoryFlush: true,
        deferOnCompaction: true,
        disableCompactionCheck: rollingCompactionApplied || isSubagentChatSession,
        disableMemoryFlushCheck: isSubagentChatSession,
        maxMessages: isSubagentChatSession ? 120 : undefined,
      });

  if (addResult.deferredForCompaction && addResult.compactionPrompt) {
    sendSSE('ui_preflight', { message: 'Compacting the thread before continuing...' });
    sendSSE('tool_call', {
      action: CONTEXT_COMPACTION_TOOL_NAME,
      args: {
        phase: 'start',
        mode: 'rolling_window',
        reason: 'pre_turn_rolling_compaction',
        estimated_tokens: addResult.estimatedTokens,
        context_limit_tokens: addResult.contextLimitTokens,
      },
      synthetic: true,
      actor: 'system',
    });
    console.log(`[v2] Context compaction triggered for session ${sessionId} (${addResult.estimatedTokens}/${addResult.contextLimitTokens} est. tokens)`);
    try {
      const internalCompactionContext = 'CONTEXT: Internal context compaction turn. Summarize prior conversation into compact retained context only.';
      const compactResult = await handleChat(
        addResult.compactionPrompt,
        sessionId,
        () => {},
        undefined,
        abortSignal,
        internalCompactionContext,
      );
      if (!abortSignal?.aborted && compactResult?.text) {
        addMessage(
          sessionId,
          { role: 'assistant', content: compactResult.text, timestamp: Date.now() },
          { disableMemoryFlushCheck: true, disableCompactionCheck: true },
        );
        await maybeRefreshProjectLearning(sessionId, [compactResult.text]);
        sendSSE('tool_result', {
          action: CONTEXT_COMPACTION_TOOL_NAME,
          result: 'Thread compacted before continuing.',
          error: false,
          synthetic: true,
          actor: 'system',
          extra: {
            phase: 'result',
            status: 'compacted',
            mode: 'rolling_window',
            summary: compactResult.text,
            estimated_tokens: addResult.estimatedTokens,
            context_limit_tokens: addResult.contextLimitTokens,
          },
        });
      } else {
        sendSSE('tool_result', {
          action: CONTEXT_COMPACTION_TOOL_NAME,
          result: 'Thread compaction skipped; continuing with normal flow.',
          error: false,
          synthetic: true,
          actor: 'system',
          extra: {
            phase: 'result',
            status: 'skipped',
            mode: 'rolling_window',
            estimated_tokens: addResult.estimatedTokens,
            context_limit_tokens: addResult.contextLimitTokens,
          },
        });
      }
    } catch (compactErr: any) {
      console.warn('[v2] Context compaction turn failed:', compactErr?.message || compactErr);
      sendSSE('tool_result', {
        action: CONTEXT_COMPACTION_TOOL_NAME,
        result: `Thread compaction failed: ${String(compactErr?.message || compactErr || '').slice(0, 300)}`,
        error: true,
        synthetic: true,
        actor: 'system',
        extra: {
          phase: 'result',
          status: 'failed',
          mode: 'rolling_window',
          estimated_tokens: addResult.estimatedTokens,
          context_limit_tokens: addResult.contextLimitTokens,
        },
      });
    }
    if (abortSignal?.aborted) return { type: 'chat', text: '' };
    addMessage(sessionId, userMsg, { disableMemoryFlushCheck: true, disableCompactionCheck: true });
  } else if (addResult.deferredForMemoryFlush && addResult.memoryFlushPrompt) {
    sendSSE('ui_preflight', { message: 'Saving important memory before continuing...' });
    console.log(`[v2] Pre-compaction memory flush triggered for session ${sessionId} (${addResult.estimatedTokens}/${addResult.contextLimitTokens} est. tokens)`);
    try {
      const internalFlushContext = 'CONTEXT: Internal pre-compaction memory flush turn. Before continuing, save important durable user/task facts to memory now.';
      const flushResult = await handleChat(
        addResult.memoryFlushPrompt,
        sessionId,
        () => {},
        undefined,
        abortSignal,
        internalFlushContext,
      );
      if (!abortSignal?.aborted && flushResult?.text) {
        addMessage(
          sessionId,
          { role: 'assistant', content: flushResult.text, timestamp: Date.now() },
          { disableMemoryFlushCheck: true, disableCompactionCheck: true },
        );
      }
    } catch (flushErr: any) {
      console.warn('[v2] Pre-compaction memory flush failed:', flushErr?.message || flushErr);
    }
    if (abortSignal?.aborted) return { type: 'chat', text: '' };
    addMessage(sessionId, userMsg, { disableMemoryFlushCheck: true, disableCompactionCheck: true });
  }

  console.log(`\n[v2] USER: ${message.slice(0, 100)}`);
  let followupHandled: string | null = null;
  if (shouldCheckBlockedTaskFollowup(message)) {
    sendSSE('ui_preflight', { message: 'Checking paused task follow-up...' });
    followupHandled = await tryHandleBlockedTaskFollowup(sessionId, message);
  }
  if (followupHandled) {
    if (!abortSignal?.aborted) {
      addMessage(sessionId, { role: 'assistant', content: followupHandled, timestamp: Date.now() });
      await maybeRefreshProjectLearning(sessionId);
    }
    const followupResult = { type: 'chat' as const, text: followupHandled };
    completeLocalMainChatStream(followupResult);
    return followupResult;
  }

  const pins = Array.isArray(pinnedMessages) ? pinnedMessages.slice(0, 3) : [];
  sendSSE('ui_preflight', { message: 'Preparing chat context...' });
  const canvasCtx = getCanvasContextBlock(sessionId);
  const originCtx = formatTurnOriginContext(turnOrigin, sessionId);
  const assignedTaskAttentionCtx = (() => {
    try {
      const task = findBlockedTaskForSession(sessionId);
      if (!task) return '';
      return [
        '[ASSIGNED TASK ATTENTION]',
        buildBlockedTaskStatusMessage(task),
        'This context is informational for this turn. Do not claim the task resumed just because the user replied.',
        `Use task_control(action:"get", task_id:"${task.id}") to inspect the current state. Use task_control(action:"resume", task_id:"${task.id}") only when the user clearly asks to continue this task, or task_control(action:"rerun", task_id:"${task.id}") when they ask to retry from the start.`,
        '[/ASSIGNED TASK ATTENTION]',
      ].join('\n');
    } catch {
      return '';
    }
  })();
  const mergedCallerContext = [originCtx, callerContext, canvasCtx || undefined, assignedTaskAttentionCtx || undefined].filter(Boolean).join('\n\n') || undefined;
  const providerUsageBeforeTurn = aggregateSessionModelUsage(sessionId);
  const result = await handleChat(
    message,
    sessionId,
	    sendSSE,
	    pins.length > 0 ? pins : undefined,
	    abortSignal,
	    mergedCallerContext,
	    modelOverride,
	    undefined,
	    undefined,
	    Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined,
	    reasoningOptions,
	    undefined, // providerOverride
	    callerOnToken,
      { directSubagentChat: isDirectSubagentChatTurn, excludedSkillIds: turnExcludedSkillIds, forcedSkillIds: turnForcedSkillIds },
	  );

  const turnObservationId = `turn_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const toolObservations: ToolObservation[] = result.toolResults && result.toolResults.length > 0
    ? persistToolResultsAsObservations(sessionId, turnObservationId, result.toolResults)
    : [];
  const providerUsageAfterTurn = aggregateSessionModelUsage(sessionId);
  const turnProviderUsage = diffModelUsage(providerUsageBeforeTurn, providerUsageAfterTurn);
  const toolResultBudget = summarizeTurnToolResultBudget(toolObservations);
  const toolLogText = toolObservations.length > 0
    ? formatToolStateSummaryForContext(toolObservations, { includeHeader: true, maxChars: 2200, maxObservations: 14, includeTelemetry: true })
    : '';
  const resultFileChanges = result.fileChanges || collectTurnFileChanges(result.toolResults as any[] | undefined, getWorkspace(sessionId) || process.cwd());
  if (resultFileChanges && !result.fileChanges) {
    (result as any).fileChanges = resultFileChanges;
  }
  if (abortSignal?.aborted) {
    if (editRerunAbortResetSessions.has(String(sessionId || ''))) {
      return result;
    }
    const plannedRestartAbort = [
      ...((Array.isArray(result.toolResults) ? result.toolResults : []).map((entry: any) => entry?.name || entry?.action || entry?.toolName)),
    ].some((name) => isPlannedRestartToolName(String(name || '')));
    const plannedRestartLog = /\b(gateway_restart|prom_apply_dev_changes)\b/.test(toolLogText);
    if (plannedRestartAbort || plannedRestartLog) {
      return result;
    }
    const interruptedText = String(result.text || '').trim();
    const recentUsers = getHistory(sessionId, 8)
      .filter((msg) => msg.role === 'user')
      .map((msg) => String(msg.content || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const currentRequest = String(message || '').replace(/\s+/g, ' ').trim();
    const priorRequest = [...recentUsers].reverse().find((text) => text && text !== currentRequest) || '';
    const workSummary = priorRequest && currentRequest && /^(ok|okay|yes|yep|sure|go ahead|do that|continue|please)\b/i.test(currentRequest)
      ? `${priorRequest.slice(0, 220)} -> ${currentRequest.slice(0, 160)}`
      : (currentRequest || priorRequest || 'the interrupted turn');
    const stepSummary = result.toolResults && result.toolResults.length > 0
      ? `Stopped after ${result.toolResults.length} step${result.toolResults.length !== 1 ? 's' : ''}.`
      : 'Stopped before any tool calls completed.';
    const checkpointPacket = [
      '[Interrupted by user]',
      `In the middle of: ${workSummary}`,
      interruptedText || stepSummary,
      toolLogText
        ? `Compact tool/process state was preserved for continuation:\n${toolLogText}`
        : 'No tool calls had completed yet.',
      'When the user asks to continue, resume from this checkpoint instead of restarting from scratch.',
    ].filter(Boolean).join('\n\n');
    const visibleCheckpointText = [
      'Restart Context Packet',
      '',
      `Interrupted by user while I was working on: ${workSummary.slice(0, 260)}`,
      stepSummary,
      'Compact tool/process state was preserved for continuation. Full raw observations remain available out-of-band.',
    ].join('\n');
    addMessage(sessionId, {
      role: 'assistant',
      content: visibleCheckpointText,
      timestamp: Date.now(),
      toolLog: toolLogText || checkpointPacket,
      turnProviderUsage,
      toolResultBudget,
      fileChanges: resultFileChanges || undefined,
      processEntries: [{
        ts: new Date().toLocaleTimeString(),
        type: 'warn',
        actor: 'Prom',
        content: checkpointPacket,
        extra: { packetType: 'restart_context_packet', interrupted: true },
      }],
    } as any, {
      disableCompactionCheck: isSubagentChatSession,
      disableMemoryFlushCheck: isSubagentChatSession,
      maxMessages: isSubagentChatSession ? 120 : undefined,
    });
    if (toolLogText) {
      persistToolLog(sessionId, toolLogText);
    }
    if (!isSubagentChatSession) await maybeRefreshProjectLearning(sessionId, [visibleCheckpointText, checkpointPacket]);
  } else {
    addMessage(sessionId, {
      role: 'assistant',
      content: result.text,
      timestamp: Date.now(),
      artifacts: Array.isArray(result.artifacts) && result.artifacts.length ? result.artifacts : undefined,
      generatedImages: Array.isArray(result.generatedImages) && result.generatedImages.length ? result.generatedImages : undefined,
      generatedVideos: Array.isArray(result.generatedVideos) && result.generatedVideos.length ? result.generatedVideos : undefined,
      canvasFiles: Array.isArray(result.canvasFiles) && result.canvasFiles.length ? result.canvasFiles : undefined,
      fileChanges: result.fileChanges || undefined,
      productCarousel: result.productCarousel || undefined,
      richArtifacts: Array.isArray(result.richArtifacts) && result.richArtifacts.length ? result.richArtifacts : undefined,
      toolLog: toolLogText || undefined,
      turnProviderUsage,
      toolResultBudget,
    } as any, {
      disableCompactionCheck: isSubagentChatSession,
      disableMemoryFlushCheck: isSubagentChatSession,
      maxMessages: isSubagentChatSession ? 120 : undefined,
    });
    if (toolLogText) {
      persistToolLog(sessionId, toolLogText);
    }
    if (!isSubagentChatSession) await maybeRefreshProjectLearning(sessionId);
    if (!isSubagentChatSession) {
      const generatedSessionTitle = await maybeAutoNameChatSession(sessionId);
      if (generatedSessionTitle && !abortSignal?.aborted) {
        sendSSE('session_title', {
          sessionId,
          title: generatedSessionTitle,
          autoTitleLocked: true,
        });
      }
    }
  }

    completeLocalMainChatStream(result);
    return result;
  } finally {
    if (localMainChatStream && !localMainChatStreamCompleted) {
      appendMainChatStreamEvent(sessionId, localMainChatStream.streamId, 'done', {
        reply: '',
        mode: 'chat',
        sections: [],
      });
      localMainChatStreamCompleted = true;
    }
    if (localMainChatStream) finishMainChatStream(sessionId, localMainChatStream.streamId);
  }
}

function createSSESender(res: express.Response): (event: string, data: any) => void {
  return (type: string, data: any) => {
    try {
      if (res.destroyed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch {}
  };
}

async function streamExistingMainChatToResponse(params: {
  res: express.Response;
  sessionId: string;
  streamId: string;
  clientRequestId?: string;
}): Promise<void> {
  const { res, sessionId, streamId } = params;
  const clientRequestId = String(params.clientRequestId || '').trim();
  let lastSeq = 0;
  let closed = false;
  let terminalSeen = false;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const writeFrame = (frame: MainChatStreamFrame) => {
    if (closed || res.destroyed || res.writableEnded) return;
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    const payload = {
      type: frame.type,
      ...data,
      seq: frame.seq,
      streamId,
      at: frame.at,
      ...(clientRequestId && !data.clientRequestId ? { clientRequestId } : {}),
    };
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { closed = true; }
    lastSeq = Math.max(lastSeq, Number(frame.seq || 0) || 0);
    if (frame.type === 'done' || frame.type === 'final' || frame.type === 'error') terminalSeen = true;
  };
  const writePing = () => {
    if (closed || res.destroyed || res.writableEnded) return;
    try { res.write(': ping\n\n'); } catch { closed = true; }
  };
  const onClose = () => { closed = true; };
  res.on('close', onClose);
  try {
    while (!closed && !res.destroyed && !res.writableEnded) {
      const stream = getMainChatStream(sessionId);
      if (!stream || stream.streamId !== streamId) break;
      const frames = stream.events.filter((frame) => Number(frame.seq || 0) > lastSeq);
      for (const frame of frames) writeFrame(frame);
      if (terminalSeen || !stream.active) break;
      writePing();
      await sleep(750);
    }
    if (!terminalSeen && !closed && !res.destroyed && !res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'done', duplicate: true, clientRequestId: clientRequestId || undefined })}\n\n`);
      } catch {}
    }
  } finally {
    res.off('close', onClose);
  }
}

type VoiceNarrationEmitter = (data: Record<string, any>) => void;

function voiceNarrationClean(value: any, max = 120): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/["`]/g, '')
    .trim()
    .slice(0, max)
    .trim();
}

function voiceNarrationNaturalize(value: any): string {
  let text = voiceNarrationClean(value, 180);
  text = text
    .replace(/^I am\b/i, "I'm")
    .replace(/\bI am\b/g, "I'm")
    .replace(/^I will\b/i, "I'll")
    .replace(/\bI will\b/g, "I'll")
    .replace(/^I have\b/i, "I've")
    .replace(/\bI have\b/g, "I've");
  return text.trim();
}

function extractJsonObjectLoose(text: string): any | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const candidates = [unfenced];
  const match = unfenced.match(/\{[\s\S]*\}/);
  if (match?.[0]) candidates.push(match[0]);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

function voiceNarrationHost(value: any): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return voiceNarrationClean(raw, 60);
  }
}

function voiceNarrationTargetFromArgs(args: any): string {
  if (!args || typeof args !== 'object') return '';
  return voiceNarrationClean(
    args.title || args.id || args.path || args.file || args.filename || args.name || args.url || args.query || args.command || args.prompt || args.text,
    90,
  );
}

function voiceNarrationTaskRequestSummary(userMessage: string): string {
  let text = voiceNarrationClean(userMessage, 180)
    .replace(/^(?:okay|ok|alright|hey|yo)[,\s-]*/i, '')
    .replace(/^(?:can|could|would)\s+(?:you|we)\s+(?:please\s+)?/i, '')
    .replace(/^(?:please\s+|let'?s\s+|go ahead and\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/[?.!]+$/g, '').trim();
  if (!text) return '';
  if (!/^(?:fix|add|build|make|wire|search|look|check|inspect|update|change|clean|debug|test|run|open|create|remove|set|help)\b/i.test(text)) {
    text = `work on ${text}`;
  }
  return text.slice(0, 140).trim();
}

function voiceNarrationTaskStartFallback(userMessage: string, data: any): string {
  const summary = voiceNarrationTaskRequestSummary(userMessage);
  if (summary) return `Sure, I'll go ahead and ${summary}.`;
  const action = String(data?.action || '').trim();
  const target = voiceNarrationTargetFromArgs(data?.args);
  if (target) return `Sure, I'll start with ${target}.`;
  if (action) return "Sure, I'll get started on that.";
  return '';
}

function voiceNarrationForToolCall(action: string, args: any, userMessage: string): string {
  const tool = String(action || '').trim();
  const target = voiceNarrationTargetFromArgs(args);
  const host = voiceNarrationHost(args?.url || args?.targetUrl || args?.href);
  const query = voiceNarrationClean(args?.query || args?.q || args?.search || '', 90);
  if (!tool) return '';
  if (tool === 'declare_plan') return 'I have a plan now, and I will work through it step by step.';
  if (tool === 'skill_list') return '';
  if (tool === 'skill_read') return target ? `I'll check ${target} and see if it actually helps here.` : '';
  if (tool === 'web_search') return query ? `I'll look up ${query} so I can stay grounded.` : '';
  if (tool === 'browser_open') return host ? `I'm opening ${host}.` : '';
  if (tool.startsWith('browser_')) {
    if (/snapshot|inspect|observe/i.test(tool)) return '';
    if (/click/i.test(tool)) return 'I am clicking the relevant browser control now.';
    if (/fill|type/i.test(tool)) return 'I am entering the information in the browser now.';
    if (/scroll|press_key/i.test(tool)) return 'I am navigating the page to find the next useful area.';
    return '';
  }
  if (tool.startsWith('desktop_')) {
    if (/screenshot|window/i.test(tool)) return '';
    if (/click/i.test(tool)) return 'I am clicking the relevant desktop control now.';
    if (/type/i.test(tool)) return 'I am typing that into the desktop app now.';
    return '';
  }
  if (/^(read_file|file_read|list_files|search_files|grep|find_files|source_read)$/i.test(tool)) {
    return target ? `I'm checking ${target} so I can make the right change.` : '';
  }
  if (/^(write_file|edit_file|create_file|patch_file|apply_patch|replace_file|delete_file)$/i.test(tool)) {
    return target ? `I'm editing ${target} now.` : '';
  }
  if (/^(run_command|shell_command|terminal_run)$/i.test(tool)) {
    const command = voiceNarrationClean(args?.command || args?.cmd || '', 80);
    if (/test|vitest|jest|pytest|node --check|tsc|build|lint/i.test(command)) return "I'll run verification now.";
    return '';
  }
  if (/^(generate_image|image_generation)/i.test(tool)) return 'I am generating the image now.';
  if (/^(generate_video|video_generation)/i.test(tool)) return 'I am generating the video now.';
  if (/^(canvas_|creative_)/i.test(tool)) return 'I am updating the workspace canvas now.';
  if (/^background_/i.test(tool)) return 'I am starting a background agent to help with this.';
  if (/memory/i.test(tool)) return '';
  if (/approval/i.test(tool)) return 'I need approval before I take that action.';
  const compactGoal = voiceNarrationClean(userMessage, 80);
  return compactGoal ? `I am using ${tool.replace(/_/g, ' ')} to move this forward.` : '';
}

function voiceNarrationForToolResult(action: string, data: any): string {
  const tool = String(action || '').trim();
  const failed = data?.error === true || /^ERROR:/i.test(String(data?.result || ''));
  if (!failed) return '';
  if (tool.startsWith('browser_')) return 'That browser step had an issue, so I am going to adjust.';
  if (tool.startsWith('desktop_')) return "That desktop step had an issue, so I'll check another route.";
  if (/file|patch|edit|write|create/i.test(tool)) return 'That edit did not apply cleanly, so I am correcting it.';
  if (/run_command|shell|terminal/i.test(tool)) return "That command failed, so I'll check what to change next.";
  return 'That step hit an issue, so I am adjusting.';
}

function voiceNarrationSafeEvent(type: string, data: any): Record<string, any> {
  const args = data?.args && typeof data.args === 'object' ? data.args : undefined;
  const safeArgs: Record<string, any> = {};
  if (args) {
    for (const key of ['id', 'title', 'path', 'file', 'filename', 'name', 'url', 'query', 'command', 'cmd', 'text', 'prompt', 'phase']) {
      if (args[key] !== undefined) safeArgs[key] = voiceNarrationClean(args[key], key === 'command' || key === 'cmd' ? 180 : 120);
    }
  }
  return {
    type,
    action: voiceNarrationClean(data?.action || '', 80),
    message: voiceNarrationClean(data?.message || '', 160),
    result: voiceNarrationClean(data?.result || '', data?.error ? 180 : 260) || undefined,
    error: data?.error === true,
    stepNum: Number(data?.stepNum || 0) || undefined,
    synthetic: data?.synthetic === true || undefined,
    actor: voiceNarrationClean(data?.actor || '', 80) || undefined,
    args: Object.keys(safeArgs).length ? safeArgs : undefined,
  };
}

function voiceNarrationRecentMessages(sessionId: string, userMessage: string) {
  try {
    const session = getSession(sessionId);
    const history = Array.isArray(session?.history) ? session.history : [];
    const visible = history
      .filter((msg: any) => (msg?.role === 'user' || msg?.role === 'assistant') && String(msg?.content || '').trim())
      .slice(-5)
      .map((msg: any) => ({ role: msg.role, content: voiceNarrationClean(msg.content, 700) }));
    const current = voiceNarrationClean(userMessage, 700);
    if (current && !visible.some((msg: any) => msg.role === 'user' && msg.content === current)) visible.push({ role: 'user', content: current });
    return visible.slice(-5);
  } catch {
    return [{ role: 'user', content: voiceNarrationClean(userMessage, 700) }];
  }
}

async function callVoiceNarratorModel(packet: any, abortSignal?: AbortSignal): Promise<{ action: 'reply' | 'no_reply'; text?: string } | null> {
  const system = [
    "You are Prometheus's live voice narrator.",
    'You watch Prometheus work and decide whether to speak a short update.',
    'Speak in first person as Prometheus, naturally and casually.',
    'Do not start every line with "I am". Prefer contractions and direct language: "I\'ll", "I\'m", "Sure", "Let me".',
    'Explain why the current action helps the user request, not just what tool is running.',
    'Because speech may arrive after the event, prefer bridge phrasing for mid-turn updates: "I found...", "I checked...", "I read...", "That part is done; now I\'m...".',
    'Prefer staying quiet on routine task starts; use recap-plus-next-step phrasing for tool results.',
    'Never say generic filler like "checking available skills", "reading the relevant skill", "working in the browser", or "checking the page state".',
    'If you cannot mention the concrete request/topic/file/site/action in a natural way, return {"action":"no_reply"}.',
    'Good style: "I’ll check whether there’s already a voice workflow for this." Bad style: "I am checking the available skills."',
    'Good mid-turn style: "I found the voice skill; I’m using it to guide this change." Bad style: "I am checking the available skills."',
    'Do not expose raw tool names, JSON, stack traces, hidden system details, or private reasoning.',
    'Do not narrate every event. Reply only when the user benefits from hearing it.',
    'If currentState.isTaskStart is true, return no_reply unless a spoken acknowledgement is clearly useful to the user.',
    'Keep reply text under 24 words.',
    'Return JSON only: {"action":"reply","text":"..."} or {"action":"no_reply"}.',
  ].join('\n');
  const timeoutMs = packet?.currentState?.isTaskStart ? 2600 : 1600;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const modelCall = getOllamaClient().chatWithThinking(
    [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(packet) },
    ],
    'manager',
    {
      temperature: 0.25,
      num_ctx: 4096,
      num_predict: 120,
      think: false,
      abortSignal,
      usageContext: { sessionId: packet.sessionId, agentId: 'voice_narrator' },
    } as any,
  ).then((result: any) => {
    const parsed = extractJsonObjectLoose(String(result?.message?.content || ''));
    const action = String(parsed?.action || '').trim().toLowerCase();
    if (action === 'no_reply') return { action: 'no_reply' as const };
    if (action !== 'reply') return null;
    const text = voiceNarrationNaturalize(parsed?.text || '');
    if (!text || text.length < 6) return null;
    if (/\b(tool_call|tool_result|json|sse|stack trace|system prompt)\b/i.test(text)) return null;
    if (/\b(checking the available skills|reading the relevant skill|working in the browser|working in\s+\w+|in running|plan update|plan:|checking the page state|use the right workflow|before i act|inspect the actual page|inspect it directly)\b/i.test(text)) return { action: 'no_reply' as const };
    if (/\b(skill_read|skill_list|tool_result|tool_call|ui_preflight|progress_state)\b/i.test(text)) return { action: 'no_reply' as const };
    return { action: 'reply' as const, text };
  }).catch(() => null);
  return Promise.race([modelCall, timeout]);
}

function createVoiceNarrator(
  sessionId: string,
  userMessage: string,
  emit: VoiceNarrationEmitter,
  abortSignal?: AbortSignal,
  options: { suppressTaskStartFallback?: boolean } = {},
) {
  let lastAt = 0;
  const recent = new Map<string, number>();
  const recentToolEvents: string[] = [];
  const recentNarration: string[] = [];
  const startedAt = Date.now();
  let seq = 0;
  let inFlight = false;
  let firstToolAcknowledged = false;
  const speak = (text: string, meta: Record<string, any> = {}) => {
    const clean = voiceNarrationNaturalize(text);
    if (!clean || clean.length < 8) return;
    const now = Date.now();
    for (const [key, at] of recent.entries()) {
      if (now - at > 45000) recent.delete(key);
    }
    const key = clean.toLowerCase();
    if (recent.has(key)) return;
    const minGap = Number(meta.minGapMs ?? 3200) || 0;
    if (meta.force !== true && now - lastAt < minGap) return;
    recent.set(key, now);
    lastAt = now;
    recentNarration.push(clean);
    if (recentNarration.length > 8) recentNarration.shift();
    emit({
      text: clean,
      action: 'reply',
      source: 'gateway_narrator',
      createdAt: now,
      elapsedMs: now - startedAt,
      ...meta,
    });
  };
  const rememberEvent = (type: string, data: any) => {
    const action = voiceNarrationClean(data?.action || type, 80);
    const target = voiceNarrationTargetFromArgs(data?.args);
    const suffix = target ? ` ${target}` : (data?.message ? ` ${voiceNarrationClean(data.message, 80)}` : '');
    recentToolEvents.push(`${type}: ${action}${suffix}`.trim());
    if (recentToolEvents.length > 10) recentToolEvents.shift();
  };
  const maybeNarrate = (type: string, data: any, fallbackText: string, meta: Record<string, any> = {}) => {
    if (meta.stage === 'task_start' && options.suppressTaskStartFallback === true) {
      firstToolAcknowledged = true;
      return;
    }
    const fallback = voiceNarrationNaturalize(meta.stage === 'task_start'
      ? voiceNarrationTaskStartFallback(userMessage, data)
      : fallbackText);
    const canFallback = fallback && meta.priority === 'warn';
    if (meta.stage === 'task_start') {
      if (canFallback) speak(fallback, { ...meta, source: 'gateway_narrator_task_start_ack' });
      return;
    }
    const mySeq = ++seq;
    const packet = {
      sessionId,
      userRequest: voiceNarrationClean(userMessage, 1000),
      recentMessages: voiceNarrationRecentMessages(sessionId, userMessage),
      currentState: {
        phase: type,
        isTaskStart: meta.stage === 'task_start',
        elapsedMs: Date.now() - startedAt,
        event: voiceNarrationSafeEvent(type, data),
        recentToolEvents: [...recentToolEvents],
        recentNarration: [...recentNarration],
      },
      instruction: meta.stage === 'task_start'
        ? 'This is the first real action for the turn. Usually return no_reply because the worker stream already shows that work started. Only acknowledge if speech would clearly help the user. Use reply/no_reply JSON only.'
        : 'Decide reply/no_reply for a live voice milestone. Interruptions are handled elsewhere; do not mention interruption unless it is in the packet.',
    };
    const run = async () => {
      if (inFlight) {
        if (canFallback) speak(fallback, { ...meta, source: 'gateway_narrator_fallback_busy' });
        return;
      }
      inFlight = true;
      try {
        const decision = await callVoiceNarratorModel(packet, abortSignal);
        if (mySeq < seq - 3) return;
        if (decision?.action === 'reply' && decision.text) {
          speak(decision.text, { ...meta, source: 'gateway_narrator_model', fallbackText: fallback });
          return;
        }
        if (decision?.action === 'no_reply' && meta.stage === 'task_start' && canFallback) {
          speak(fallback, { ...meta, source: 'gateway_narrator_task_start_fallback' });
          return;
        }
        if (!decision && canFallback) speak(fallback, { ...meta, source: 'gateway_narrator_fallback' });
      } finally {
        inFlight = false;
      }
    };
    void run();
  };
  return {
    observe(type: string, data: any) {
      if (type === 'voice_milestone') return;
      if (['tool_call', 'tool_progress', 'tool_result', 'ui_preflight'].includes(type)) rememberEvent(type, data);
      if (type === 'ui_preflight') {
        return;
      }
      if (type === 'tool_call') {
        const text = voiceNarrationForToolCall(String(data?.action || ''), data?.args, userMessage);
        const isTaskStart = !firstToolAcknowledged && String(data?.action || '') !== 'declare_plan';
        if (isTaskStart) firstToolAcknowledged = true;
        maybeNarrate(type, data, text, {
          stage: isTaskStart ? 'task_start' : 'tool_call',
          tool: data?.action,
          stepNum: data?.stepNum,
          synthetic: data?.synthetic === true,
          actor: data?.actor,
          minGapMs: data?.synthetic ? 4500 : 3200,
        });
        return;
      }
      if (type === 'tool_progress') {
        const message = voiceNarrationClean(data?.message, 120);
        if (/opening|checking|reading|writing|editing|verifying|searching|loading|connecting|retry|repair/i.test(message)) {
          maybeNarrate(type, data, message, { stage: 'tool_progress', tool: data?.action, minGapMs: 6000 });
        }
        return;
      }
      if (type === 'tool_result') {
        const text = voiceNarrationForToolResult(String(data?.action || ''), data);
        maybeNarrate(type, data, text, { stage: 'tool_result', tool: data?.action, stepNum: data?.stepNum, priority: 'warn', minGapMs: 2500 });
      }
    },
  };
}

type VoiceInterruptionIntent =
  | 'course_correction'
  | 'clarification'
  | 'question'
  | 'continue'
  | 'pause'
  | 'cancel'
  | 'unknown';

function classifyVoiceInterruption(text: string): {
  intent: VoiceInterruptionIntent;
  shouldAbortOriginalRun: boolean;
  shouldPauseOriginalRun: boolean;
  shouldInjectIntoRuntime: boolean;
  shouldGiveImmediateVoiceReply: boolean;
} {
  const raw = String(text || '').trim();
  const value = raw.toLowerCase();
  const cancelRe = /\b(cancel|abort|kill|stop the task|stop this task|stop doing|don't do it|do not do it|nevermind|never mind|forget it|scratch that)\b|\bstop\b(?!\s+(talking|speaking|voice|audio))/;
  const pauseRe = /\b(pause|hold on|wait a second|wait a sec|stop talking|quiet for a sec|give me a second)\b/;
  const continueRe = /\b(continue|keep going|go on|resume|carry on|okay continue|ok continue)\b/;
  const correctionRe = /\b(wait|actually|no\b|not like that|instead|i mean|what i mean|don't abort|do not abort|just inject|focus on|use .* instead|not desktop|not mobile)\b/;
  const questionRe = /\?$|\b(what do you mean|why|how would|how can|is that|would that|can it|does that)\b/;
  if (!value) {
    return { intent: 'unknown', shouldAbortOriginalRun: false, shouldPauseOriginalRun: false, shouldInjectIntoRuntime: true, shouldGiveImmediateVoiceReply: true };
  }
  if (cancelRe.test(value)) {
    return { intent: 'cancel', shouldAbortOriginalRun: true, shouldPauseOriginalRun: false, shouldInjectIntoRuntime: true, shouldGiveImmediateVoiceReply: true };
  }
  if (pauseRe.test(value)) {
    return { intent: 'pause', shouldAbortOriginalRun: false, shouldPauseOriginalRun: true, shouldInjectIntoRuntime: true, shouldGiveImmediateVoiceReply: true };
  }
  if (continueRe.test(value)) {
    return { intent: 'continue', shouldAbortOriginalRun: false, shouldPauseOriginalRun: false, shouldInjectIntoRuntime: true, shouldGiveImmediateVoiceReply: false };
  }
  if (questionRe.test(value)) {
    return { intent: 'question', shouldAbortOriginalRun: false, shouldPauseOriginalRun: false, shouldInjectIntoRuntime: true, shouldGiveImmediateVoiceReply: true };
  }
  if (correctionRe.test(value)) {
    return { intent: 'course_correction', shouldAbortOriginalRun: false, shouldPauseOriginalRun: false, shouldInjectIntoRuntime: true, shouldGiveImmediateVoiceReply: true };
  }
  return { intent: 'clarification', shouldAbortOriginalRun: false, shouldPauseOriginalRun: false, shouldInjectIntoRuntime: true, shouldGiveImmediateVoiceReply: true };
}

function buildVoiceInterruptionContextBlock(event: any): string {
  const cls = event.classification || {};
  const lines = [
    '[VOICE INTERRUPTION EVENT]',
    `Reason: ${voiceNarrationClean(event.reason || 'barge_in', 80)}`,
    `Original user request: ${voiceNarrationClean(event.originalUserPrompt || '', 700) || '(unknown)'}`,
    `Assistant/workflow state: ${event.isStreamActive ? 'A voice/chat stream was active when the user interrupted.' : 'Prometheus was speaking a prior response or milestone.'}`,
    `Assistant text so far: ${voiceNarrationClean(event.assistantTextSoFar || '', 1000) || '(none captured)'}`,
    `Spoken segment at interruption: ${voiceNarrationClean(event.currentSpokenSegment || '', 700) || '(unknown)'}`,
    event.lastVoiceMilestone ? `Last voice milestone: ${voiceNarrationClean(event.lastVoiceMilestone, 300)}` : '',
    `User interruption: ${voiceNarrationClean(event.userInterruptionTranscript || '', 700) || '(unclear)'}`,
    `Interpretation: ${cls.intent || 'unknown'}`,
    cls.intent === 'cancel'
      ? 'Runtime instruction: The user explicitly cancelled. Stop/abort the active run if it is still running and do not continue stale work.'
      : cls.intent === 'pause'
        ? 'Runtime instruction: Pause voice output. Do not abort backend work by default unless the user explicitly asks to cancel.'
        : 'Runtime instruction: Treat this as a live voice correction/follow-up. Do not abort by default. Incorporate the interruption before the next action or final response.',
    '[/VOICE INTERRUPTION EVENT]',
  ].filter(Boolean);
  return lines.join('\n');
}

function buildChatSteerContextBlock(event: RuntimeSteerEvent): string {
  return [
    '[LIVE CHAT STEER]',
    `Steer id: ${voiceNarrationClean(event.id, 120)}`,
    `Source: ${voiceNarrationClean(event.source || 'web', 80)}`,
    event.kind ? `Kind: ${voiceNarrationClean(event.kind, 80)}` : '',
    event.voiceContextPacketId ? `Voice context packet: ${voiceNarrationClean(event.voiceContextPacketId, 120)}` : '',
    event.contextSummary ? `Current worker context:\n${voiceNarrationClean(event.contextSummary, 1600)}` : '',
    event.spokenAck ? `Spoken acknowledgement already given to user: ${voiceNarrationClean(event.spokenAck, 500)}` : '',
    `User steer: ${String(event.message || '').trim()}`,
    (event.attachments?.length || event.attachmentPreviews?.length)
      ? `Steer attachments: ${(event.attachments?.length || 0) + (event.attachmentPreviews?.length || 0)} file(s) attached to this live steer. Inspect the injected visual payloads or attachment context below before acting.`
      : '',
    event.requiresWorkerResponse
      ? 'Runtime instruction: The user sent this while the current Prometheus run was active and expects the worker to address it. Incorporate it before the next action or final response. If it conflicts with earlier instructions, prefer this steer unless it is unsafe.'
      : 'Runtime instruction: The user sent this while the current Prometheus run was active. Treat it as an immediate same-turn course correction, not as a separate future chat turn. Incorporate it before the next action or final response. If it conflicts with earlier instructions, prefer this steer unless it is unsafe.',
    '[/LIVE CHAT STEER]',
  ].filter(Boolean).join('\n');
}

function appendVoiceInterruptionLog(event: any): void {
  try {
    const dir = path.join(getConfig().getConfigDir(), 'voice');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'interruptions.ndjson'), `${JSON.stringify(event)}\n`, 'utf-8');
  } catch (err: any) {
    console.warn('[voice interruption] log failed:', err?.message || err);
  }
}

const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  'queued',
  'running',
  'paused',
  'stalled',
  'needs_assistance',
  'awaiting_user_input',
  'failed',
  'waiting_subagent',
];

function inferTaskChannelFromSession(sessionId: string): 'web' | 'telegram' {
  return String(sessionId || '').startsWith('telegram_') ? 'telegram' : 'web';
}

function parseTelegramChatIdFromSessionId(sessionId: string): number | null {
  const v = String(sessionId || '').trim();
  if (!v.startsWith('telegram_')) return null;
  const id = Number(v.replace(/^telegram_/, ''));
  return Number.isFinite(id) && id > 0 ? id : null;
}

function bindTeamNotificationTargetFromSession(teamId: string, sessionId: string, source = 'session'): void {
  const tgChatId = parseTelegramChatIdFromSessionId(sessionId);
  if (tgChatId) {
    addTeamNotificationTarget(teamId, {
      channel: 'telegram',
      peerId: String(tgChatId),
      source,
    });
  }
}

router.get('/api/status', async (_req, res) => {
  const rawCfg = getConfig().getConfig() as any;
  const provider: string = rawCfg.llm?.provider || 'ollama';
  const isCloudProvider = provider === 'openai' || provider === 'openai_codex' || provider === 'anthropic' || provider === 'perplexity' || provider === 'gemini';
  const cachedProviderStatus = readProviderStatusCache();
  const connected = isCloudProvider ? true : !!cachedProviderStatus?.connected;
  const providerChecking = !isCloudProvider && !cachedProviderStatus && isProviderStatusChecking();
  const providerCfg = rawCfg.llm?.providers?.[provider] || {};
  const activeModel: string = providerCfg.model || rawCfg.models?.primary || 'unknown';
  const orchCfg = getOrchestrationConfig();
  res.json({
	    status: 'ok', version: 'v2-tools', ollama: connected, providerOnline: connected, providerChecking,
    provider,
    currentModel: activeModel,
    workspace: (getConfig().getConfig() as any).workspace?.path || '',
    search: rawCfg.search?.tinyfish_api_key ? 'tinyfish' : rawCfg.search?.google_api_key ? 'google' : (rawCfg.search?.tavily_api_key ? 'tavily' : 'none'),
    orchestration: orchCfg ? {
      enabled: orchCfg.enabled,
      secondary: orchCfg.secondary,
    } : null,
  });
});

function summarizeMobileRuntime(runtime: any): Record<string, any> {
  return {
    id: String(runtime?.id || ''),
    kind: String(runtime?.kind || ''),
    label: String(runtime?.label || runtime?.kind || 'AI flow'),
    sessionId: runtime?.sessionId ? String(runtime.sessionId) : '',
    taskId: runtime?.taskId ? String(runtime.taskId) : '',
    teamId: runtime?.teamId ? String(runtime.teamId) : '',
    agentId: runtime?.agentId ? String(runtime.agentId) : '',
    scheduleId: runtime?.scheduleId ? String(runtime.scheduleId) : '',
    source: runtime?.source ? String(runtime.source) : '',
    detail: runtime?.detail ? String(runtime.detail).slice(0, 500) : '',
    startedAt: Number(runtime?.startedAt || 0),
    abortable: runtime?.abortable === true,
    abortRequestedAt: Number(runtime?.abortRequestedAt || 0) || null,
  };
}

function isLiveRunningRuntime(runtime: any): boolean {
  return String(runtime?.status || 'running') === 'running' && !runtime?.abortRequestedAt;
}

type VoiceAgentAction =
  | 'answer_now'
  | 'steer_worker'
  | 'interrupt_worker'
  | 'handoff_new_work'
  | 'no_reply';

type VoiceAgentTargetContext = {
  kind: 'main' | 'subagent';
  agentId?: string;
  label?: string;
};

function normalizeVoiceAgentTarget(raw: any): VoiceAgentTargetContext {
  const source = raw?.voiceTarget || raw?.voice_target || raw?.target || raw?.selectedVoiceTarget || raw?.selected_voice_target || raw || {};
  const kind = String(source?.kind || source?.targetKind || source?.target_kind || '').trim().toLowerCase();
  const agentId = compactVoiceText(source?.agentId || source?.agent_id || source?.id || '', 120);
  const label = compactVoiceText(source?.label || source?.name || source?.alias || source?.friendlyName || source?.friendly_name || '', 160);
  if (kind === 'subagent' || agentId) {
    return { kind: 'subagent', agentId, label: label || agentId || 'Subagent' };
  }
  return { kind: 'main', label: 'Prometheus' };
}

function voiceAgentTargetIdentity(target?: VoiceAgentTargetContext) {
  const normalized = normalizeVoiceAgentTarget(target || {});
  const isSubagent = normalized.kind === 'subagent';
  const label = compactVoiceText(normalized.label || normalized.agentId || (isSubagent ? 'Subagent' : 'Prometheus'), 120);
  return {
    target: normalized,
    isSubagent,
    label,
    speakerName: isSubagent ? label : 'Prometheus',
    workerLabel: isSubagent ? label : 'Prometheus worker',
    identityLine: isSubagent
      ? `You are ${label}, a standalone subagent running under Prometheus. You are speaking through your own voice interface. You are not Prometheus and must not claim to be Prometheus.`
      : 'You are Prometheus speaking through the user\'s voice interface.',
    roleLine: isSubagent
      ? `You are not merely a voice layer, narrator, assistant voice, or provider voice. You are the subagent ${label} in live voice form. When work needs the durable worker path, phrase it as your own work: "I am on it", "I will handle that", or similar. Do not say you will get the worker, ask Prometheus, or hand it to Prometheus.`
      : 'You have Prometheus\'s identity, memory, preferences, user knowledge, and current task context.',
    handoffLine: isSubagent
      ? `For handoffs, the app routes the request into this selected subagent chat (${label}) rather than the main Prometheus chat. The technical worker/tool wording is implementation detail; do not expose it.`
      : 'When the user requests work requiring tools outside the voice_* and skill_* set, files, non-voice browser/desktop capabilities, coding, scheduling beyond voice_timer, memory mutation beyond voice_write_note, or long reasoning, acknowledge naturally first, then dispatch to the Prometheus worker.',
  };
}

function resolveSubagentVoiceWorkspace(target?: VoiceAgentTargetContext): { workspacePath: string; agent: any; agentId: string; label: string } | null {
  const normalized = normalizeVoiceAgentTarget(target || {});
  const agentId = compactVoiceText(normalized.agentId || '', 120);
  if (normalized.kind !== 'subagent' || !agentId) return null;
  const agent = getAgentById(agentId);
  if (!agent) return null;
  const workspacePath = resolveAgentWorkspace(agent as any) || ensureAgentWorkspace(agent as any);
  const label = compactVoiceText(normalized.label || agent?.name || (agent as any)?.alias || agentId, 160) || agentId;
  return { workspacePath, agent, agentId, label };
}

function loadSubagentVoiceFile(workspacePath: string, candidates: string[], maxChars = 6000): string {
  for (const candidate of candidates) {
    try {
      const content = loadWorkspaceFile(workspacePath, candidate, maxChars).trim();
      if (content) return content;
    } catch {}
  }
  return '';
}

function stripMainVoiceIdentitySections(contextBlock: string): string {
  let next = String(contextBlock || '');
  for (const marker of ['PROMETHEUS_SOUL', 'SOUL']) {
    const pattern = new RegExp(`(?:^|\\n)\\[${marker}\\]\\n[\\s\\S]*?(?=\\n\\[[A-Z0-9_ -]+\\]\\n|$)`, 'g');
    next = next.replace(pattern, '\n');
  }
  return next.replace(/\n{3,}/g, '\n\n').trim();
}

function buildSubagentVoiceContextOverlay(target?: VoiceAgentTargetContext): string {
  const resolved = resolveSubagentVoiceWorkspace(target);
  if (!resolved) return '';
  const { workspacePath, agent, agentId, label } = resolved;
  const identityPrompt = loadSubagentVoiceFile(workspacePath, ['system_prompt.md', 'HEARTBEAT.md'], 10000);
  const subagentSoul = loadSubagentVoiceFile(workspacePath, ['SOUL.md', 'soul.md'], 7000);
  const subagentMemory = loadSubagentVoiceFile(workspacePath, ['MEMORY.md', 'memory.md'], 8000);
  const subagentVoiceAgent = loadSubagentVoiceFile(workspacePath, ['VOICEAGENT.md', 'voiceagent.md'], 5000);
  const bits = [
    '[SUBAGENT_VOICE_IDENTITY]',
    `You are ${label}, the selected standalone subagent. The voice interface is only how the user is talking to you.`,
    'Prometheus is the host/orchestrator/runtime around you; Prometheus is not your identity. You are a subagent under Prometheus, not a generic voice agent.',
    'If asked who you are, say you are this subagent and describe your subagent role. Do not identify as "the live conversational voice agent" or "the voice layer".',
    'Speak in first person as this subagent. For durable work, phrase the handoff as your own action, not as asking Prometheus or getting a worker.',
    `Subagent id: ${agentId}`,
    `Subagent configured name: ${compactVoiceText(agent?.name || label, 160)}`,
    `Subagent workspace: ${workspacePath}`,
    '',
    identityPrompt ? `[SUBAGENT_SYSTEM_PROMPT]\n${identityPrompt}` : '',
    subagentSoul ? `[SUBAGENT_SOUL]\n${subagentSoul}` : '',
    subagentMemory ? `[SUBAGENT_MEMORY]\n${subagentMemory}` : '',
    subagentVoiceAgent ? `[SUBAGENT_VOICEAGENT]\n${subagentVoiceAgent}` : '',
  ].filter(Boolean);
  return bits.join('\n\n').trim();
}

function applyVoiceTargetContextBlock(contextBlock: string, target?: VoiceAgentTargetContext): string {
  const normalized = normalizeVoiceAgentTarget(target || {});
  if (normalized.kind !== 'subagent') return contextBlock;
  const overlay = buildSubagentVoiceContextOverlay(normalized);
  if (!overlay) return contextBlock;
  return `${overlay}\n\n${stripMainVoiceIdentitySections(contextBlock)}`.trim();
}

function loadVoiceAgentMemoryForTarget(target?: VoiceAgentTargetContext): string {
  const mainWorkspacePath = getConfig().getWorkspacePath();
  const mainVoiceMemory = loadVoiceAgentMemory(mainWorkspacePath);
  const resolved = resolveSubagentVoiceWorkspace(target);
  if (!resolved) return mainVoiceMemory;
  const subagentVoiceMemory = loadVoiceAgentMemory(resolved.workspacePath);
  return subagentVoiceMemory || mainVoiceMemory;
}

const voiceAgentNarrationState = new Map<string, { signature: string; at: number; text?: string }>();
const voiceAgentWorkerHandoffSessions = new Map<string, { at: number; transcript: string; eventId: string }>();
const VOICE_AGENT_HANDOFF_SESSION_TTL_MS = 90 * 1000;

function hasRecentVoiceAgentWorkerHandoff(sessionId: string): boolean {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  const entry = voiceAgentWorkerHandoffSessions.get(sid);
  if (!entry) return false;
  if (Date.now() - Number(entry.at || 0) > VOICE_AGENT_HANDOFF_SESSION_TTL_MS) {
    voiceAgentWorkerHandoffSessions.delete(sid);
    return false;
  }
  return true;
}

function findActiveMainChatRuntimeForSession(sessionId: string, expectedRuntimeId = ''): any | null {
  const sid = String(sessionId || '').trim();
  const expected = String(expectedRuntimeId || '').trim();
  return listLiveRuntimes()
    .filter((runtime) => (
      runtime.kind === 'main_chat'
      && String(runtime.sessionId || '') === sid
      && (!expected || runtime.id === expected)
    ))
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0] || null;
}

function compactVoiceText(value: unknown, max = 500): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function friendlyVoiceToolName(value: unknown): string {
  return compactVoiceText(value, 120).replace(/_/g, ' ').trim();
}

function isVoiceContextNoiseText(value: unknown): boolean {
  const text = compactVoiceText(value, 240).toLowerCase();
  if (!text) return true;
  return /^(?:request received|preparing prometheus runtime|preparing chat context|building model context|classifying (?:the )?request|thinking|processing|working|responding|preparing tool|tool complete|complete|done|step[_\s-]*done|step[_\s-]*complete|plan:|plan update:|reset\b|compacting (?:the )?thread|saving (?:important )?memory|checking paused task follow-up|building context|building prometheus runtime|tool schemas refreshed(?: for this turn)?\.?)\b/.test(text);
}

function isVoiceContextNoiseEvent(value: unknown): boolean {
  return /^(?:heartbeat|token|thinking|thinking_delta|ui_preflight|voice_milestone|model_stream_event)$/i.test(String(value || '').trim());
}

function summarizeVoiceToolActivity(toolName: unknown, args: any, eventType = '', data: any = {}): string {
  const tool = String(toolName || '').trim();
  const friendly = friendlyVoiceToolName(tool || 'tool');
  const target = voiceNarrationTargetFromArgs(args);
  const failed = data?.error === true || /^ERROR:/i.test(String(data?.result || data?.message || ''));
  if (!tool) return failed ? 'A step hit an issue.' : '';
  if (tool === 'skill_list') return '';
  if (tool === 'skill_read') return target ? `Read skill: ${target}` : 'Read a skill.';
  if (/^(read_file|file_read|source_read)$/i.test(tool)) return target ? `Read file: ${target}` : 'Read a file.';
  if (/^(list_files|search_files|grep|find_files)$/i.test(tool)) return target ? `Searched: ${target}` : 'Searched the workspace.';
  if (/^(write_file|edit_file|create_file|patch_file|apply_patch|replace_file|delete_file)$/i.test(tool)) return target ? `Edited file: ${target}` : 'Edited files.';
  if (/^(run_command|shell_command|terminal_run)$/i.test(tool)) {
    const command = compactVoiceText(args?.command || args?.cmd || target, 140);
    return command ? `Ran command: ${command}` : 'Ran a command.';
  }
  if (tool.startsWith('browser_')) return target ? `Used browser: ${target}` : `Used ${friendly}.`;
  if (tool.startsWith('desktop_')) return target ? `Used desktop tool: ${target}` : `Used ${friendly}.`;
  if (/memory/i.test(tool)) return '';
  if (/approval/i.test(tool)) return failed ? 'Approval step hit an issue.' : 'Checked an approval step.';
  if (failed) return `${friendly || 'Tool'} hit an issue.`;
  if (String(eventType || '').toLowerCase() === 'tool_call') return target ? `Using ${friendly}: ${target}` : `Using ${friendly}.`;
  return `${friendly || 'Tool'} completed.`;
}

function voiceNarrationLineFromActivity(text: unknown): string {
  const value = compactVoiceText(text, 260);
  if (!value || isVoiceContextNoiseText(value)) return '';
  const skill = value.match(/^Read skill:\s*(.+)$/i)?.[1];
  if (skill) return `I checked the ${skill} guidance and I'm applying it now.`;
  const fileRead = value.match(/^Read file:\s*(.+)$/i)?.[1];
  if (fileRead) return `I checked ${fileRead}; now I'm using that to make the next move cleanly.`;
  const searched = value.match(/^Searched:\s*(.+)$/i)?.[1];
  if (searched) return `I searched ${searched} and I'm narrowing it down from there.`;
  const edited = value.match(/^Edited file:\s*(.+)$/i)?.[1];
  if (edited) return `I updated ${edited}; now I'm checking that it holds together.`;
  const command = value.match(/^Ran command:\s*(.+)$/i)?.[1];
  if (command) {
    if (/test|check|tsc|lint|build|vitest|jest|pytest|node --check/i.test(command)) return "I'm running verification now so I can catch anything before I call it done.";
    return "I ran the command and I'm reading the result before I move again.";
  }
  if (/^Used browser:/i.test(value)) return "I've got the browser context now and I'm using it to decide the next step.";
  if (/^Used desktop tool:/i.test(value)) return "I've checked the desktop state and I'm using that context now.";
  if (/ completed\.?$/i.test(value) && !/^skill read completed/i.test(value)) return '';
  if (/ hit an issue\.?$/i.test(value)) return "That step hit an issue, so I'm adjusting the route instead of pushing forward blindly.";
  return value.length > 12 ? value : '';
}

function summarizeUnlockedToolCategories(names: string[], requestedCategory = ''): string {
  const categories = new Set<string>();
  const requested = compactVoiceText(requestedCategory, 120);
  if (requested) categories.add(requested);
  for (const name of names || []) {
    const category = getToolCategory(String(name || '').trim());
    if (category) categories.add(String(category));
  }
  const labels = Array.from(categories)
    .map((category) => friendlyVoiceToolName(category))
    .filter(Boolean);
  if (!labels.length) return 'Tool category unlocked for this turn.';
  return `Newly unlocked tool category: ${labels.join(', ')}.`;
}

function summarizeVoiceContextEntry(entry: any): Record<string, any> | null {
  const event = compactVoiceText(entry?.extra?.event || entry?.event || '', 80);
  const toolName = compactVoiceText(entry?.extra?.toolName || entry?.toolName || entry?.action || '', 120);
  const args = entry?.extra?.args || entry?.args;
  const type = String(entry?.type || 'info');
  if (toolName === 'skill_list') return null;
  if (isVoiceContextNoiseEvent(event) && type !== 'error' && type !== 'warn') return null;
  let content = '';
  if (event === 'tool_call' || event === 'tool_result' || toolName) {
    content = summarizeVoiceToolActivity(toolName, args, event, {
      error: entry?.extra?.error === true || type === 'error',
      result: entry?.content || entry?.result,
      message: entry?.message,
    });
  } else {
    content = compactVoiceText(entry?.content || entry?.message || entry?.summary || '', type === 'error' || type === 'warn' ? 260 : 420);
  }
  if (!content || (type !== 'error' && type !== 'warn' && isVoiceContextNoiseText(content))) return null;
  return {
    type: type === 'think' ? 'info' : type,
    actor: compactVoiceText(entry?.actor || 'Prom', 80) || 'Prom',
    content,
    toolName: toolName === 'skill_list' ? '' : toolName,
    event,
    ts: compactVoiceText(entry?.ts || entry?.at || '', 80),
  };
}

function summarizeVoiceProcessEntries(entries: any[], limit = 10): Array<Record<string, any>> {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => summarizeVoiceContextEntry(entry))
    .filter((entry): entry is Record<string, any> => !!entry && !!(entry.content || entry.toolName || entry.event))
    .slice(-limit);
}

function summarizeVoiceStreamEvents(stream: MainChatStreamState | null, limit = 12): Array<Record<string, any>> {
  const summarized: Array<Record<string, any> | null> = (stream?.events || [])
    .map((frame) => {
      const type = compactVoiceText(frame?.type || '', 80);
      const data = frame?.data || {};
      const action = compactVoiceText(data?.action || data?.name || data?.toolName || '', 120);
      const error = data?.error === true || type === 'error';
      if (action === 'skill_list') return null;
      if (isVoiceContextNoiseEvent(type) && !error && type !== 'warn') return null;
      let message = '';
      if (type === 'tool_call' || type === 'tool_result' || action) {
        message = summarizeVoiceToolActivity(action, data?.args, type, data);
      } else {
        message = compactVoiceText(data?.message || data?.text || data?.summary || (error ? data?.result : ''), error ? 260 : 420);
      }
      if (!message || (!error && isVoiceContextNoiseText(message))) return null;
      return {
        seq: frame.seq,
        type,
        at: frame.at,
        message,
        action,
        error,
      };
    });
  return summarized
    .filter((frame): frame is Record<string, any> => !!frame && !!(frame.message || frame.action || frame.type))
    .slice(-limit);
}

function summarizeVoiceObservation(sessionId: string): Record<string, any> {
  let browser: Record<string, any> | null = null;
  let desktop: Record<string, any> | null = null;
  try {
    const packet: any = getBrowserAdvisorPacket(sessionId);
    if (packet) {
      browser = {
        title: compactVoiceText(packet.title || packet.pageTitle || packet.tabTitle || '', 180),
        url: compactVoiceText(packet.url || '', 220),
        summary: compactVoiceText(packet.summary || packet.pageSummary || packet.observation || packet.text || '', 700),
        updatedAt: Number(packet.updatedAt || packet.at || 0) || null,
      };
    }
  } catch {}
  try {
    const packet: any = getDesktopAdvisorPacket(sessionId);
    if (packet) {
      desktop = {
        activeWindow: packet.activeWindow ? {
          processName: compactVoiceText(packet.activeWindow.processName || '', 120),
          title: compactVoiceText(packet.activeWindow.title || '', 220),
        } : null,
        summary: compactVoiceText(packet.summary || packet.observation || packet.ocrText || packet.text || '', 700),
        updatedAt: Number(packet.updatedAt || packet.at || 0) || null,
      };
    }
  } catch {}
  return { browser, desktop };
}

function cleanVoiceCompactionSummaryText(value: unknown, maxChars = 4000): string {
  let summary = String(value || '').trim();
  if (!summary) return '';
  if (summary.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX)) {
    summary = summary.slice(ROLLING_COMPACTION_SUMMARY_PREFIX.length).trim();
  } else if (summary.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX)) {
    summary = summary.slice(LEGACY_COMPACTION_SUMMARY_PREFIX.length).trim();
  }
  return voiceNarrationClean(summary, maxChars);
}

function subagentVoiceTargetId(target?: VoiceAgentTargetContext): string {
  const normalized = normalizeVoiceAgentTarget(target || {});
  return normalized.kind === 'subagent' ? compactVoiceText(normalized.agentId || '', 120) : '';
}

function subagentVoiceTargetLabel(target?: VoiceAgentTargetContext): string {
  const normalized = normalizeVoiceAgentTarget(target || {});
  if (normalized.kind !== 'subagent') return 'Prometheus';
  const agent = normalized.agentId ? getAgentById(normalized.agentId) : null;
  return compactVoiceText(normalized.label || agent?.name || (agent as any)?.alias || normalized.agentId || 'Subagent', 160) || 'Subagent';
}

// Recent back-and-forth of the actual chat, so the voice agent picks up the
// ongoing conversation instead of acting like a fresh session. The worker
// context packet only carries the single latest user/assistant turn plus run
// status; this gives the realtime agent the recent dialogue window.
function buildVoiceConversationTranscript(sessionId: string, maxTurns = 24, maxCharsPerTurn = 600, target?: VoiceAgentTargetContext): string {
  try {
    const agentId = subagentVoiceTargetId(target);
    if (agentId) {
      const label = subagentVoiceTargetLabel(target);
      const session = getSession(sessionId);
      const sessionSummary = cleanVoiceCompactionSummaryText((session as any)?.latestContextSummary || '', 4000);
      const sessionHistory = Array.isArray(session?.history) ? session.history : [];
      const sourceHistory = sessionSummary && sessionHistory.length
        ? sessionHistory.map((entry: any) => ({
          role: String(entry?.role || '') === 'assistant' || String(entry?.role || '') === 'ai' ? 'agent' : entry?.role,
          content: entry?.content || entry?.body?.text || '',
          metadata: entry?.metadata || {},
        }))
        : getSubagentChatHistory(agentId, Math.max(80, maxTurns * 3));
      const turns = sourceHistory
        .filter((msg: any) => {
          const role = String(msg?.role || '');
          if (role !== 'user' && role !== 'agent') return false;
          const text = String(msg?.content || '').trim();
          if (!text) return false;
          if (text.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX) || text.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX)) return false;
          if (String(msg?.metadata?.source || '').toLowerCase().includes('compaction')) return false;
          return true;
        })
        .slice(-maxTurns)
        .map((msg: any) => {
          const speaker = String(msg?.role || '') === 'user' ? 'User' : label;
          const text = voiceNarrationClean(msg?.content || '', maxCharsPerTurn);
          return text ? `${speaker}: ${text}` : '';
        })
        .filter(Boolean);
      return turns.join('\n');
    }
    const session = getSession(sessionId);
    const history = Array.isArray(session?.history) ? session.history : [];
    const turns = history
      .filter((msg: any) => {
        const role = String(msg?.role || '');
        if (role !== 'user' && role !== 'assistant' && role !== 'ai') return false;
        const text = String(msg?.content || msg?.body?.text || '').trim();
        if (!text) return false;
        // Skip injected rolling-compaction summaries and system-style scaffolding.
        if (text.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX) || text.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX)) return false;
        return true;
      })
      .slice(-maxTurns)
      .map((msg: any) => {
        const speaker = String(msg?.role || '') === 'user' ? 'User' : 'Prometheus';
        const text = voiceNarrationClean(msg?.content || msg?.body?.text || '', maxCharsPerTurn);
        return text ? `${speaker}: ${text}` : '';
      })
      .filter(Boolean);
    return turns.join('\n');
  } catch {
    return '';
  }
}

// The latest rolling-compaction summary for this thread. On a compacted thread
// everything before the summary boundary lives ONLY here, so voice must include
// it or the agent loses all earlier context (the "fresh chat" amnesia).
function buildVoiceCompactionSummaryBlock(sessionId: string, maxChars = 4000, target?: VoiceAgentTargetContext): string {
  try {
    const agentId = subagentVoiceTargetId(target);
    if (agentId) {
      const session = getSession(sessionId);
      const sessionSummary = cleanVoiceCompactionSummaryText((session as any)?.latestContextSummary || '', maxChars);
      if (sessionSummary) return sessionSummary;
      const history = getSubagentChatHistory(agentId, 500);
      const latestSummaryMsg = [...history].reverse().find((msg: any) => {
        const text = String(msg?.content || '').trim();
        const source = String(msg?.metadata?.source || '').toLowerCase();
        return !!text && (
          text.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX)
          || text.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX)
          || source.includes('compaction')
          || source.includes('context_summary')
        );
      });
      return cleanVoiceCompactionSummaryText(latestSummaryMsg?.content || '', maxChars);
    }
    const session = getSession(sessionId);
    let summary = String((session as any)?.latestContextSummary || '').trim();
    return cleanVoiceCompactionSummaryText(summary, maxChars);
  } catch {
    return '';
  }
}

// Compact recent tool-result log mirroring what main chat carries, so the voice
// agent knows what was actually done (not just what was said) in this thread.
function buildVoiceRecentToolLog(sessionId: string, maxEntries = 8, target?: VoiceAgentTargetContext): string {
  try {
    const agentId = subagentVoiceTargetId(target);
    if (agentId) {
      const lines = getSubagentChatHistory(agentId, 120)
        .filter((msg: any) => {
          if (String(msg?.role || '') !== 'agent') return false;
          const md = msg?.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
          return md.success === true || md.taskId || md.durationMs || md.stepCount || String(md.source || '').includes('dispatch');
        })
        .map((msg: any) => String(msg?.content || '').trim())
        .filter(Boolean)
        .slice(-maxEntries);
      return lines.length ? lines.map((l: string) => `- ${voiceNarrationClean(l, 420)}`).join('\n') : '';
    }
    const packet = buildVoiceWorkerContextPacket(sessionId);
    const done = Array.isArray((packet as any)?.doneAlready) ? (packet as any).doneAlready : [];
    const lines = done
      .map((entry: any) => String(entry || '').trim())
      .filter(Boolean)
      .slice(-maxEntries);
    return lines.length ? lines.map((l: string) => `- ${l}`).join('\n') : '';
  } catch {
    return '';
  }
}

function voiceRequestTimeInput(source: Record<string, any> = {}): any {
  if (!source || typeof source !== 'object') return undefined;
  return source.deviceTime || source.device_time || source.clientTime || source.client_time;
}

function buildVoiceWorkerContextPacket(sessionId: string, options: Record<string, any> = {}): Record<string, any> {
  const sid = String(sessionId || 'default').trim() || 'default';
  const voiceTarget = normalizeVoiceAgentTarget(options?.voiceTarget || options?.voice_target || options?.target || options || {});
  const subagentId = subagentVoiceTargetId(voiceTarget);
  const subagentLabel = subagentVoiceTargetLabel(voiceTarget);
  const activeRuntime = findActiveMainChatRuntimeForSession(sid, String(options.expectedRuntimeId || options.runtimeId || ''));
  const currentTime = buildVoiceTimeContext(voiceRequestTimeInput(options));
  const checkpoint = activeRuntime?.checkpoint && typeof activeRuntime.checkpoint === 'object' ? activeRuntime.checkpoint : {};
  const subagentHistory = subagentId ? getSubagentChatHistory(subagentId, 120) : [];
  const session = getSession(sid);
  const history = subagentId
    ? subagentHistory.map((entry: any) => ({
      role: entry.role === 'agent' ? 'assistant' : entry.role,
      content: entry.content,
      body: { text: entry.content },
      timestamp: entry.ts,
      metadata: entry.metadata,
    }))
    : (Array.isArray(session?.history) ? session.history : []);
  const latestUser: any = [...history].reverse().find((entry: any) => String(entry?.role || '') === 'user') || null;
  const latestAssistant: any = [...history].reverse().find((entry: any) => ['assistant', 'ai'].includes(String(entry?.role || ''))) || null;
  const stream = getMainChatStream(sid);
  const processEntries = summarizeVoiceProcessEntries(checkpoint.processEntries || [], 12);
  const recentEvents = summarizeVoiceStreamEvents(stream, 16);
  const currentGoal = compactVoiceText(
    options.originalUserPrompt
      || activeRuntime?.recoveryData?.message
      || activeRuntime?.detail
      || latestUser?.content
      || latestUser?.body?.text
      || '',
    900,
  );
  const activeToolName = compactVoiceText(checkpoint.toolName || '', 120);
  const checkpointEvent = compactVoiceText(checkpoint.event || '', 120);
  const checkpointLabel = compactVoiceText(checkpoint.message || checkpoint.result || '', 500);
  const activeToolLabel = checkpointLabel && !isVoiceContextNoiseText(checkpointLabel)
    ? (activeToolName ? summarizeVoiceToolActivity(activeToolName, checkpoint.args, checkpointEvent, checkpoint) || checkpointLabel : checkpointLabel)
    : '';
  const currentPhase = checkpointEvent && !isVoiceContextNoiseEvent(checkpointEvent) && !isVoiceContextNoiseText(checkpointEvent)
    ? checkpointEvent
    : stream?.active
      ? 'running'
      : '';
  const completed = processEntries
    .filter((entry) => entry.type === 'result' || entry.event === 'tool_result')
    .slice(-5)
    .map((entry) => entry.toolName ? `${friendlyVoiceToolName(entry.toolName)}: ${entry.content}` : entry.content)
    .filter(Boolean);
  if (subagentId && completed.length < 5) {
    const threadWork = subagentHistory
      .filter((msg: any) => String(msg?.role || '') === 'agent' && String(msg?.content || '').trim())
      .filter((msg: any) => {
        const md = msg?.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
        return md.success === true || md.taskId || md.durationMs || md.stepCount || String(md.source || '').includes('dispatch');
      })
      .map((msg: any) => voiceNarrationClean(msg.content, 260))
      .filter(Boolean)
      .slice(-(5 - completed.length));
    completed.push(...threadWork);
  }
  const displayPhase = currentPhase && currentPhase !== 'running' ? currentPhase : '';
  const displayTool = activeToolName && activeToolName !== 'skill_list' ? friendlyVoiceToolName(activeToolName) : '';
  const voiceWorkgroups = subagentId ? [] : listVoiceWorkgroupsForSession(sid).slice(0, 4).map((workgroup) => {
    const workers = workgroup.workers.map((worker) => {
      const task = loadTask(worker.taskId);
      const status = String(task?.status || worker.status || 'queued');
      return {
        taskId: worker.taskId,
        title: task?.title || worker.title,
        status,
        finalSummary: compactVoiceText(task?.finalSummary || '', 260),
        currentStep: task?.plan?.[Math.max(0, Number(task.currentStepIndex || 0))]?.description || '',
      };
    });
    const activeWorkers = workers.filter((worker) => !['complete', 'failed'].includes(worker.status));
    const completedWorkers = workers.filter((worker) => worker.status === 'complete');
    const failedWorkers = workers.filter((worker) => worker.status === 'failed');
    const status = activeWorkers.length > 0
      ? 'running'
      : failedWorkers.length > 0 && completedWorkers.length > 0
        ? 'partially_complete'
        : failedWorkers.length > 0
          ? 'failed'
          : completedWorkers.length === workers.length && workers.length > 0
            ? 'complete'
            : workgroup.status;
    return {
      id: workgroup.id,
      status,
      workerCount: workers.length,
      activeCount: activeWorkers.length,
      completedCount: completedWorkers.length,
      failedCount: failedWorkers.length,
      delivery: workgroup.delivery,
      mode: workgroup.mode,
      workers,
    };
  });
  const activeVoiceWorkgroups = voiceWorkgroups.filter((workgroup) => !['complete', 'failed'].includes(workgroup.status));
  const voiceWorkgroupLines = voiceWorkgroups.slice(0, 2).map((workgroup) => {
    const workerBits = workgroup.workers.slice(0, 5)
      .map((worker) => `${worker.title} (${worker.status}${worker.currentStep ? `: ${compactVoiceText(worker.currentStep, 120)}` : ''})`)
      .join('; ');
    return `Voice workgroup ${workgroup.id}: ${workgroup.status}; ${workgroup.completedCount}/${workgroup.workerCount} complete${workerBits ? `; ${workerBits}` : ''}`;
  }).filter(Boolean);
  const effectiveCurrentGoal = currentGoal || (activeVoiceWorkgroups[0]?.workers || [])
    .map((worker) => worker.title)
    .filter(Boolean)
    .slice(0, 3)
    .join('; ');
  const recentSummaryLines = [
    subagentId ? `Voice target: ${subagentLabel} subagent` : '',
    effectiveCurrentGoal ? `Goal: ${effectiveCurrentGoal}` : '',
    displayPhase ? `Current phase: ${displayPhase}` : '',
    displayTool ? `Active step: ${displayTool}` : '',
    activeToolLabel ? `Latest update: ${activeToolLabel}` : '',
    completed.length ? `Recent completed work: ${completed.join(' | ')}` : '',
    voiceWorkgroupLines.length ? `Voice-dispatched workers: ${voiceWorkgroupLines.join(' | ')}` : '',
  ].filter(Boolean);
  const active = !!activeRuntime || activeVoiceWorkgroups.length > 0;
  return {
    id: `voice_ctx_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    sessionId: sid,
    target: subagentId ? { kind: 'subagent', agentId: subagentId, label: subagentLabel } : { kind: 'main', label: 'Prometheus' },
    active,
    activeRun: activeRuntime ? summarizeMobileRuntime(activeRuntime) : null,
    trigger: activeRuntime ? {
      source: compactVoiceText(activeRuntime.source || '', 120),
      detail: compactVoiceText(activeRuntime.detail || activeRuntime.recoveryData?.message || '', 900),
      taskId: activeRuntime.taskId ? String(activeRuntime.taskId) : '',
      teamId: activeRuntime.teamId ? String(activeRuntime.teamId) : '',
      agentId: activeRuntime.agentId ? String(activeRuntime.agentId) : '',
      scheduleId: activeRuntime.scheduleId ? String(activeRuntime.scheduleId) : '',
      startedAt: Number(activeRuntime.startedAt || 0) || null,
    } : activeVoiceWorkgroups[0] ? {
      source: 'voice_workgroup',
      detail: effectiveCurrentGoal,
      workgroupId: activeVoiceWorkgroups[0].id,
      startedAt: null,
    } : null,
    currentGoal: effectiveCurrentGoal,
    currentPhase: displayPhase || (activeVoiceWorkgroups.length ? 'running_voice_workgroup' : ''),
    activeToolName: displayTool,
    activeToolLabel: activeToolLabel || (activeVoiceWorkgroups.length ? `${activeVoiceWorkgroups.length} voice workgroup${activeVoiceWorkgroups.length === 1 ? '' : 's'} active` : ''),
    pendingSteerCount: Number(checkpoint.pendingSteerCount || 0) || 0,
    lastSteer: checkpoint.lastSteer || null,
    lastVoiceInterruption: checkpoint.voiceInterruptionEvent || null,
    latestUser: latestUser ? compactVoiceText(latestUser.content || latestUser.body?.text || '', 700) : '',
    latestAssistant: latestAssistant ? compactVoiceText(latestAssistant.content || latestAssistant.body?.text || '', 700) : '',
    thread: subagentId ? {
      kind: 'subagent',
      agentId: subagentId,
      label: subagentLabel,
      messageCount: subagentHistory.length,
      compactionSummary: buildVoiceCompactionSummaryBlock(sid, 1200, voiceTarget),
      recentTranscript: buildVoiceConversationTranscript(sid, 8, 360, voiceTarget),
    } : undefined,
    time: currentTime,
    currentTime,
    processEntries,
    recentEvents,
    observations: summarizeVoiceObservation(sid),
    voiceWorkgroups,
    doneAlready: [...completed, ...voiceWorkgroupLines],
    currentlyDoing: activeToolLabel || displayTool || displayPhase || voiceWorkgroupLines[0] || '',
    summary: recentSummaryLines.join('\n'),
  };
}

function getReusableVoiceContextPacket(sessionId: string, body: Record<string, any>, activeRuntime: any): Record<string, any> {
  const provided = body?.contextPacket;
  const sid = String(sessionId || 'default').trim() || 'default';
  if (provided && typeof provided === 'object') {
    const packetSessionId = String(provided.sessionId || '').trim();
    const packetAgeMs = Date.now() - Number(provided.createdAt || 0);
    const expectedRuntimeId = String(body.expectedRuntimeId || body.runtimeId || body.activeRunId || activeRuntime?.id || '').trim();
    const packetRuntimeId = String(provided.activeRun?.id || '').trim();
    const packetMatchesRuntime = expectedRuntimeId ? packetRuntimeId === expectedRuntimeId : true;
    if (
      packetSessionId === sid
      && Number.isFinite(packetAgeMs)
      && packetAgeMs >= 0
      && packetAgeMs <= 10_000
      && packetMatchesRuntime
    ) {
      const freshTime = buildVoiceTimeContext(voiceRequestTimeInput(body));
      if (freshTime.exactLocalTimeAvailable === true || !provided.currentTime) {
        provided.currentTime = freshTime;
        provided.time = freshTime;
      }
      return provided;
    }
  }
  return buildVoiceWorkerContextPacket(sid, {
    ...body,
    expectedRuntimeId: activeRuntime?.id || body.expectedRuntimeId || body.runtimeId || body.activeRunId,
    originalUserPrompt: body.originalUserPrompt,
  });
}

type VoiceAgentContextBlockCacheEntry = {
  sessionId: string;
  workspacePath: string;
  historyLength: number;
  targetKey: string;
  contextBlock: string;
  createdAt: number;
};

const VOICE_AGENT_CONTEXT_BLOCK_TTL_MS = 30_000;
const voiceAgentContextBlockCache = new Map<string, VoiceAgentContextBlockCacheEntry>();
const voiceAgentContextBlockPending = new Map<string, Promise<VoiceAgentContextBlockCacheEntry>>();

function getVoiceAgentContextBlockCacheKey(sessionId: string, voiceTarget?: VoiceAgentTargetContext): string {
  const sid = String(sessionId || 'default').trim() || 'default';
  const target = normalizeVoiceAgentTarget(voiceTarget || {});
  if (target.kind === 'subagent') {
    return `${sid}::subagent:${compactVoiceText(target.agentId || target.label || 'unknown', 160) || 'unknown'}`;
  }
  return `${sid}::main`;
}

function invalidateVoiceAgentContextBlockCache(sessionId?: string): void {
  const sid = String(sessionId || '').trim();
  if (sid) {
    const prefix = `${sid}::`;
    for (const key of Array.from(voiceAgentContextBlockCache.keys())) {
      if (key === sid || key.startsWith(prefix)) voiceAgentContextBlockCache.delete(key);
    }
    for (const key of Array.from(voiceAgentContextBlockPending.keys())) {
      if (key === sid || key.startsWith(prefix)) voiceAgentContextBlockPending.delete(key);
    }
    return;
  }
  voiceAgentContextBlockCache.clear();
  voiceAgentContextBlockPending.clear();
}

async function getVoiceAgentContextBlock(sessionId: string, transcript: string, options: Record<string, any> = {}): Promise<{ contextBlock: string; elapsedMs: number; cacheHit: boolean }> {
  const voiceTarget = normalizeVoiceAgentTarget(options?.voiceTarget || options?.voice_target || options?.target || {});
  const sid = String(sessionId || 'default').trim() || 'default';
  const cacheKey = getVoiceAgentContextBlockCacheKey(sid, voiceTarget);
  const startedAt = Date.now();
  const workspacePath = getConfig().getWorkspacePath();
  const session = getSession(sid);
  const targetAgentId = subagentVoiceTargetId(voiceTarget);
  const history = targetAgentId ? getSubagentChatHistory(targetAgentId, 500) : (Array.isArray(session?.history) ? session.history : []);
  const historyLength = history.length;
  const targetKey = voiceTarget.kind === 'subagent' ? `subagent:${voiceTarget.agentId || voiceTarget.label || 'unknown'}` : 'main';
  const cached = voiceAgentContextBlockCache.get(cacheKey);
  const ageMs = cached ? Date.now() - Number(cached.createdAt || 0) : Number.POSITIVE_INFINITY;
  if (
    cached
    && cached.workspacePath === workspacePath
    && cached.historyLength === historyLength
    && cached.targetKey === targetKey
    && Number.isFinite(ageMs)
    && ageMs >= 0
    && ageMs <= VOICE_AGENT_CONTEXT_BLOCK_TTL_MS
  ) {
    return { contextBlock: cached.contextBlock, elapsedMs: Date.now() - startedAt, cacheHit: true };
  }

  const pending = voiceAgentContextBlockPending.get(cacheKey);
  if (pending) {
    const entry = await pending;
    if (entry.workspacePath === workspacePath && entry.historyLength === historyLength && entry.targetKey === targetKey) {
      return { contextBlock: entry.contextBlock, elapsedMs: Date.now() - startedAt, cacheHit: true };
    }
  }

  const buildPromise = (async (): Promise<VoiceAgentContextBlockCacheEntry> => {
    const baseContextBlock = await buildPersonalityContext(
      sid,
      workspacePath,
      transcript,
      'interactive',
      historyLength,
      _skillsManager,
      undefined,
      { profile: 'voice_agent' },
    );
    const contextBlock = applyVoiceTargetContextBlock(baseContextBlock, voiceTarget);
    const entry = { sessionId: sid, workspacePath, historyLength, targetKey, contextBlock, createdAt: Date.now() };
    voiceAgentContextBlockCache.set(cacheKey, entry);
    return entry;
  })();
  voiceAgentContextBlockPending.set(cacheKey, buildPromise);
  try {
    const entry = await buildPromise;
    return { contextBlock: entry.contextBlock, elapsedMs: Date.now() - startedAt, cacheHit: false };
  } finally {
    if (voiceAgentContextBlockPending.get(cacheKey) === buildPromise) voiceAgentContextBlockPending.delete(cacheKey);
  }
}

function prewarmVoiceAgentContextBlock(sessionId: string, transcript: string, options: Record<string, any> = {}): void {
  getVoiceAgentContextBlock(sessionId, transcript, options).catch((err) => {
    if (options.log !== false) console.warn('[voice-agent] context prewarm failed:', err?.message || err);
  });
}

function isVoiceStatusQuestion(text: string): boolean {
  const value = String(text || '').toLowerCase();
  return /\b(what are you doing|what're you doing|what is happening|what's happening|status|where are we|where are you|what step|what stage|what did you do|what have you done|what do you see|what are you seeing|what's on screen|what is on screen)\b/.test(value);
}

function isVoiceWakeOrSmallTalk(text: string): boolean {
  const value = String(text || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (/^(hey|hi|hello|yo|ok|okay)?\s*prometheus$/.test(value)) return true;
  if (/^(hey|hi|hello|yo)\s+prometheus\s+(are you there|you there|can you hear me|hello|hi|hey)?$/.test(value)) return true;
  if (/^(hey|hi|hello|yo|good morning|good afternoon|good evening|what's up|whats up|what is up|sup|you there|are you there|can you hear me|testing|test)$/.test(value)) return true;
  if (/^(?:hey\s+)?prometheus\s+(?:how(?:'s|s| is)\s+it\s+going|how\s+are\s+you|what's\s+up|whats\s+up|what\s+is\s+up)$/.test(value)) return true;
  if (/^(?:it'?s\s+)?(?:going\s+)?(?:pretty\s+)?(?:good|great|well|okay|ok|fine)(?:\s+so\s+far)?(?:\s+everything\s+(?:is\s+)?good)?$/.test(value)) return true;
  if (/^(thanks|thank you|cool|awesome|nice|perfect|great|sounds good|got it|okay|ok)$/.test(value)) return true;
  if (/^(what can you do|what do you do|who are you|what are you|tell me what you can do|help)$/.test(value)) return true;
  return false;
}

function deterministicVoiceSmallTalkReply(transcript: string, contextPacket: Record<string, any>): string {
  const value = String(transcript || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value || !isVoiceWakeOrSmallTalk(value)) return '';
  if (/\b(can you hear me|are you there|you there|testing|test)\b/.test(value)) {
    return 'I can hear you. Voice mode is working.';
  }
  if (/\b(what can you do|what do you do|who are you|what are you|help)\b/.test(value)) {
    return 'I can answer quickly here, steer active work, or hand bigger tasks to Prometheus.';
  }
  if (/\b(thanks|thank you)\b/.test(value)) return 'Anytime.';
  if (/\b(cool|awesome|nice|perfect|great|sounds good|got it|okay|ok)\b/.test(value)) return 'Sounds good.';
  if (/\b(how are you|how is it going|how s it going|how's it going|what's up|whats up|what is up|sup)\b/.test(value)) {
    return contextPacket?.active
      ? 'Going well. I am keeping the current run moving.'
      : 'Going strong, keeping projects moving. What’s up with you?';
  }
  if (/^(?:it'?s\s+)?(?:going\s+)?(?:pretty\s+)?(?:good|great|well|okay|ok|fine)/.test(value)) {
    return 'Glad it’s going well. Anything you want to tweak or dig into next?';
  }
  return contextPacket?.active ? 'I’m here, and the current run is still in view.' : 'I’m here.';
}

function isVoiceWorkerRequest(text: string): boolean {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (value.length < 10 && !/\b(open|make|build|create|search|find|check|fix|run|send|write|edit|look up)\b/.test(value)) return false;
  if (/\b(can you hear me|are you there|what's up|whats up|what is up|how are you|thank you|thanks|what can you do|what do you do|who are you|what are you)\b/.test(value)) return false;
  return /\b(open|make|build|create|generate|write|edit|update|change|fix|debug|test|run|execute|install|start|stop|restart|search|find|look up|research|analyze|inspect|check|review|read|summarize|compare|calculate|schedule|remind|send|email|message|post|tweet|download|upload|move|copy|delete|save|export|render|record|capture|screenshot|browse|click|type|fill|go to|navigate|use|turn on|turn off|set up)\b/.test(value);
}

function decideVoiceAgentAction(transcript: string, classification: ReturnType<typeof classifyVoiceInterruption>, contextPacket: Record<string, any>): VoiceAgentAction {
  const text = String(transcript || '').trim();
  if (!text) return 'no_reply';
  if (isVoiceWakeOrSmallTalk(text)) return 'answer_now';
  if (classification.shouldAbortOriginalRun) return 'interrupt_worker';
  if (classification.shouldPauseOriginalRun) return 'answer_now';
  if (!contextPacket.active) {
    return isVoiceWorkerRequest(text) ? 'handoff_new_work' : 'answer_now';
  }
  if (classification.intent === 'continue') return 'no_reply';
  if (classification.intent === 'question' || isVoiceStatusQuestion(text)) return 'answer_now';
  if (classification.intent === 'unknown') return 'answer_now';
  return 'steer_worker';
}

function voiceSteerKindFromIntent(intent: VoiceInterruptionIntent): RuntimeSteerEvent['kind'] {
  if (intent === 'course_correction') return 'correction';
  if (intent === 'question') return 'question';
  if (intent === 'cancel') return 'cancel';
  if (intent === 'pause') return 'pause';
  if (intent === 'continue') return 'continue';
  if (intent === 'clarification') return 'clarification';
  return 'unknown';
}

function normalizeVoiceCommandText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function exactActiveWorkerVoiceCommand(value: string): '' | 'stop' | 'pause' | 'status' {
  const text = normalizeVoiceCommandText(value);
  if (!text) return '';
  if (/^(?:stop|cancel|abort|kill|stop task|stop this|stop this task|stop the task|stop working|nevermind|never mind|forget it|scratch that)$/.test(text)) return 'stop';
  if (/^(?:pause|wait|hold on|wait a second|wait a sec|give me a second|give me a sec)$/.test(text)) return 'pause';
  if (/^(?:status|what is the status|what's the status|whats the status|what are you doing|what is it doing|what's it doing|whats it doing|what do you see|what are you seeing)$/.test(text)) return 'status';
  return '';
}

function buildVoiceContextSummaryForSteer(contextPacket: Record<string, any>): string {
  return [
    contextPacket.currentGoal ? `Goal: ${compactVoiceText(contextPacket.currentGoal, 500)}` : '',
    contextPacket.currentPhase ? `Phase: ${compactVoiceText(contextPacket.currentPhase, 100)}` : '',
    contextPacket.activeToolName ? `Active tool: ${compactVoiceText(contextPacket.activeToolName, 100)}` : '',
    contextPacket.activeToolLabel ? `Latest update: ${compactVoiceText(contextPacket.activeToolLabel, 300)}` : '',
    Array.isArray(contextPacket.processEntries) && contextPacket.processEntries.length
      ? `Recent process: ${contextPacket.processEntries.slice(-4).map((entry: any) => compactVoiceText(entry.content || entry.toolName || entry.event || '', 180)).filter(Boolean).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n');
}

type VoiceAgentDecision = {
  action: VoiceAgentAction;
  spokenReply: string;
  workerInstruction?: string;
  needsWorkerResponse?: boolean;
  reason?: string;
  runtimeDirectives?: Array<Record<string, any>>;
};

type VoiceAgentProcessEntry = {
  ts: string;
  type: string;
  content: string;
  actor?: string;
  extra?: Record<string, any>;
};

function pushVoiceAgentProcessEntry(trace: VoiceAgentProcessEntry[] | undefined, type: string, content: string, extra: Record<string, any> = {}): void {
  if (!Array.isArray(trace)) return;
  const text = compactVoiceText(content, 900);
  if (!text) return;
  const actor = type === 'user' ? 'User' : 'Voice Agent';
  const entry: VoiceAgentProcessEntry = {
    ts: new Date().toLocaleTimeString(),
    type,
    content: text,
    actor,
    extra: { actor, source: type === 'user' ? 'user_voice' : 'voice_agent', ...extra },
  };
  const prev = trace[trace.length - 1];
  if (prev && prev.type === entry.type && prev.content === entry.content) return;
  trace.push(entry);
}

function voiceAgentToolResultSummary(raw: string): { ok: boolean; summary: string } {
  const parsed = parseVoiceToolResult(raw);
  const ok = parsed?.ok !== false;
  const summary = compactVoiceText(parsed?.summary || parsed?.stdout || parsed?.text || parsed?.error || raw, 500);
  return { ok, summary };
}

function broadcastVoiceAgentToolEvent(sessionId: string, event: 'tool_call' | 'tool_result', data: Record<string, any>): void {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  broadcastWS({
    type: 'voice_agent_tool_event',
    sessionId: sid,
    event,
    data: {
      actor: 'Voice Agent',
      source: 'voice_agent',
      ...data,
    },
    at: Date.now(),
  });
}

// Last voice-agent screenshot preview per session. The realtime-tool HTTP endpoint
// reads this so the mobile orb can overlay the capture directly from the response it
// already awaits — independent of the broadcastWS relay reaching the mobile client.
const lastVoiceScreenshotPreview = new Map<string, { dataUrl: string; mimeType: string; width?: number; height?: number; source: string; at: number }>();

function takeLastVoiceScreenshotPreview(sessionId: string): { dataUrl: string; mimeType: string; width?: number; height?: number; source: string } | null {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const entry = lastVoiceScreenshotPreview.get(sid);
  if (!entry) return null;
  lastVoiceScreenshotPreview.delete(sid);
  // Ignore stale captures (>30s) that weren't from this tool call.
  if (Date.now() - entry.at > 30_000) return null;
  const { dataUrl, mimeType, width, height, source } = entry;
  return { dataUrl, mimeType, width, height, source };
}

function broadcastVoiceScreenshotPreview(
  sessionId: string,
  source: 'browser' | 'desktop',
  tool: string,
  shot: { base64?: string; mimeType?: string; width?: number; height?: number } | null | undefined,
): void {
  const sid = String(sessionId || '').trim();
  const base64 = String(shot?.base64 || '').trim();
  if (!sid || !base64) return;
  const mimeType = String(shot?.mimeType || 'image/png').trim() || 'image/png';
  lastVoiceScreenshotPreview.set(sid, {
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    width: Number(shot?.width || 0) || undefined,
    height: Number(shot?.height || 0) || undefined,
    source,
    at: Date.now(),
  });
  broadcastWS({
    type: 'vision_injected',
    sessionId: sid,
    source,
    tool,
    preview: {
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
      width: Number(shot?.width || 0) || undefined,
      height: Number(shot?.height || 0) || undefined,
    },
    timestamp: Date.now(),
  });
}

async function executeVoiceAgentToolWithTrace(sessionId: string, name: string, args: Record<string, any>, trace?: VoiceAgentProcessEntry[]): Promise<string> {
  const requestedAction = String(name || '').trim();
  const requestedArgs = args && typeof args === 'object' ? args : {};
  const normalized = normalizeVoiceAgentWrapperTool(requestedAction, requestedArgs);
  const action = normalized.name;
  const cleanArgs = normalized.args && typeof normalized.args === 'object' ? normalized.args : {};
  broadcastVoiceAgentToolEvent(sessionId, 'tool_call', { action, args: cleanArgs });
  pushVoiceAgentProcessEntry(trace, action.startsWith('voice_skill_') || action.startsWith('skill_') ? 'skill' : 'tool', `Using ${friendlyVoiceToolName(action)}...`, { action, args: cleanArgs });
  const raw = await executeVoiceAgentTool(sessionId, action, cleanArgs);
  const summary = voiceAgentToolResultSummary(raw);
  broadcastVoiceAgentToolEvent(sessionId, 'tool_result', {
    action,
    result: summary.summary,
    error: !summary.ok,
  });
  const parsedResult = parseVoiceToolResult(raw);
  const runtimeDirective = voiceRuntimeDirectiveFromToolResult(parsedResult);
  pushVoiceAgentProcessEntry(trace, summary.ok ? 'result' : 'error', `${friendlyVoiceToolName(action)} ${summary.ok ? 'complete' : 'failed'}${summary.summary ? ` => ${summary.summary}` : ''}`, { action, result: summary.summary, error: !summary.ok, ...(runtimeDirective ? { runtimeDirective } : {}) });
  return raw;
}

function buildVoiceTimeContext(clientTime?: any): Record<string, any> {
  const raw = clientTime && typeof clientTime === 'object' ? clientTime : {};
  const localIso = String(raw.localIso || raw.local_iso || raw.nowIso || raw.now_iso || '').trim();
  const parsedClientTime = localIso ? new Date(localIso) : null;
  const hasValidClientTime = !!(parsedClientTime && Number.isFinite(parsedClientTime.getTime()));
  const cleanTimezone = String(raw.timezone || raw.timeZone || raw.tz || '').trim();
  const cleanDateLabel = compactVoiceText(raw.dateLabel || raw.date_label || '', 120);
  const cleanTimeLabel = compactVoiceText(raw.timeLabel || raw.time_label || '', 80);
  const offsetMinutes = Number(raw.utcOffsetMinutes ?? raw.utc_offset_minutes);

  if (hasValidClientTime) {
    return {
      source: 'device',
      exactLocalTimeAvailable: true,
      nowIso: parsedClientTime!.toISOString(),
      timezone: cleanTimezone || 'device-local',
      utcOffsetMinutes: Number.isFinite(offsetMinutes) ? offsetMinutes : undefined,
      dateLabel: cleanDateLabel || parsedClientTime!.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      timeLabel: cleanTimeLabel || parsedClientTime!.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
      capturedAt: Number.isFinite(Number(raw.capturedAt || raw.captured_at)) ? Number(raw.capturedAt || raw.captured_at) : undefined,
      instruction: 'This came from the user device at Realtime voice bootstrap. You may answer local date/time questions from this value, while allowing for normal elapsed time since capture.',
    };
  }

  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'gateway-local';
  return {
    source: 'gateway_fallback',
    exactLocalTimeAvailable: false,
    nowIso: now.toISOString(),
    timezone,
    dateLabel: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    timeLabel: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    fallbackResponse: 'I do not have your exact device-local time available. Please check your device clock for the precise time.',
    instruction: 'This is gateway/server time, not verified user device time. Do not claim exact local time from it.',
  };
}

function voiceToolResult(ok: boolean, summary: string, data: Record<string, any> = {}): string {
  return JSON.stringify({
    ok,
    summary: compactVoiceText(summary, 1200),
    ...data,
  }, null, 2);
}

const VOICE_SHOW_ARTIFACT_TOOLS = new Set([
  'show_weather', 'show_market', 'show_stocks', 'show_prediction_market', 'show_map',
  'show_sources', 'show_comparison', 'show_chart', 'show_product_carousel', 'show_agent_work', 'show_run_result',
]);

// Build a rich-artifact + spoken summary for a voice show_* tool call. The artifact
// is returned to the client (in the tool result) so it renders a card in chat while
// the realtime model speaks the summary. Read/fetch tools hit keyless APIs; the rest
// are assembled from the model-provided args.
async function buildVoiceShowArtifact(name: string, args: Record<string, any>): Promise<{ ok: boolean; summary: string; artifact: any | null }> {
  const fromLookup = (tr: any, fallback: string) => ({
    ok: tr?.success !== false,
    summary: String(tr?.stdout || tr?.error || fallback),
    artifact: tr?.extra?.richArtifacts?.[0] || null,
  });
  switch (name) {
    case 'show_weather':
      return fromLookup(await executeWeatherLookup({ location: args.location, latitude: args.latitude, longitude: args.longitude, unit: args.unit, days: args.days }), 'Weather unavailable.');
    case 'show_market':
      return fromLookup(await executeMarketLookup({ coins: args.coins ?? args.symbols ?? args.query, vs_currency: args.vs_currency, sparkline: args.sparkline }), 'Market data unavailable.');
    case 'show_stocks':
      return fromLookup(await executeStockLookup({ symbols: args.symbols ?? args.tickers ?? args.query, range: args.range }), 'Stock data unavailable.');
    case 'show_prediction_market':
      return fromLookup(await executePolymarketLookup({ query: args.query, slug: args.slug, limit: args.limit }), 'No prediction markets found.');
    case 'show_map':
      return fromLookup(await executeMapLookup({ markers: Array.isArray(args.markers) ? args.markers : [], center: args.center, zoom: args.zoom, title: args.title }), 'Map unavailable.');
    case 'show_product_carousel': {
      const artifact = productCarouselToArtifact({ title: args.title, items: Array.isArray(args.items) ? args.items : [] });
      return { ok: !!artifact, summary: artifact ? `Showing ${artifact.items.length} product(s).` : 'No products to show.', artifact };
    }
    case 'show_sources': {
      const items = (Array.isArray(args.items) ? args.items : []).filter((it: any) => it && (it.title || it.url));
      if (!items.length) return { ok: false, summary: 'No sources to show.', artifact: null };
      return { ok: true, summary: `Showing ${items.length} source(s).`, artifact: { id: `sources-${Date.now()}`, type: 'sources', title: args.title, layout: args.layout === 'list' ? 'list' : 'cards', items } };
    }
    case 'show_comparison': {
      const columns = (Array.isArray(args.columns) ? args.columns : []).filter((c: any) => c && c.key);
      const rows = Array.isArray(args.rows) ? args.rows : [];
      if (!columns.length || !rows.length) return { ok: false, summary: 'Nothing to compare.', artifact: null };
      return { ok: true, summary: `Comparison of ${rows.length} item(s).`, artifact: { id: `comparison-${Date.now()}`, type: 'comparison', title: args.title, columns, rows, labelKey: args.labelKey, highlightColumn: args.highlightColumn } };
    }
    case 'show_chart': {
      const series = (Array.isArray(args.series) ? args.series : []).filter((s: any) => s && Array.isArray(s.points) && s.points.length);
      if (!series.length) return { ok: false, summary: 'No chart data.', artifact: null };
      return { ok: true, summary: 'Showing the chart.', artifact: { id: `chart-${Date.now()}`, type: 'chart', title: args.title, chartType: ['line', 'bar', 'area'].includes(args.chartType) ? args.chartType : 'line', series, xLabel: args.xLabel, yLabel: args.yLabel, unit: args.unit } };
    }
    case 'show_agent_work':
      return { ok: true, summary: 'Here is the snapshot.', artifact: { id: `agent_work-${Date.now()}`, type: 'agent_work', greeting: args.greeting, title: args.title, subtitle: args.subtitle, summaryRows: args.summaryRows, priorities: args.priorities, teams: args.teams, activeWork: args.activeWork } };
    case 'show_run_result':
      return { ok: true, summary: String(args.title || 'Task complete.'), artifact: { id: `run_result-${Date.now()}`, type: 'run_result', title: String(args.title || 'Task complete'), taskId: args.taskId, status: args.status, summary: args.summary, files: args.files, links: args.links } };
    default:
      return { ok: false, summary: 'Unknown card.', artifact: null };
  }
}

const VOICE_SKILL_INSTRUCTIONS_MAX_CHARS = 7000;
const VOICE_SKILL_RESOURCE_MAX_CHARS = 5000;

const VOICE_TOOL_EQUIVALENTS: Record<string, string> = {
  web_search: 'voice_ops action web_search',
  web_fetch: 'voice_ops action web_fetch',
  automation_dashboard: 'voice_ops action automation_dashboard',
  browser_open: 'voice_browser action open',
  browser_snapshot: 'voice_browser action snapshot',
  browser_screenshot: 'voice_browser action screenshot',
  browser_click: 'voice_browser action click',
  browser_vision_click: 'voice_browser action vision_click',
  browser_fill: 'voice_browser action fill',
  browser_type: 'voice_browser action type',
  browser_vision_type: 'voice_browser action vision_type',
  browser_press_key: 'voice_browser action press_key',
  browser_scroll: 'voice_browser action scroll',
  browser_wait: 'voice_browser action wait',
  desktop_screenshot: 'voice_desktop action screenshot',
  desktop_click: 'voice_desktop action click',
  desktop_window_control: 'voice_desktop action window_control',
  desktop_list_windows: 'voice_desktop action list_windows',
  desktop_focus_window: 'voice_desktop action focus_window',
  desktop_find_app: 'voice_desktop action find_app',
  desktop_launch_app: 'voice_desktop action launch_app',
  desktop_window_click: 'voice_desktop action window_click',
  desktop_window_type: 'voice_desktop action window_type',
  desktop_window_press_key: 'voice_desktop action window_press_key',
  desktop_window_scroll: 'voice_desktop action window_scroll',
  memory_search: 'voice_ops action memory_search',
  write_note: 'voice_ops action write_note',
};

function voiceToolEquivalentForSkillTool(toolName: unknown): string {
  const tool = String(toolName || '').trim();
  if (!tool) return '';
  if (VOICE_TOOL_EQUIVALENTS[tool]) return VOICE_TOOL_EQUIVALENTS[tool];
  if (tool.startsWith('voice_')) return tool;
  if (tool.startsWith('browser_')) return 'voice_browser wrapper where available';
  if (tool.startsWith('desktop_')) return 'voice_desktop wrapper where available';
  return '';
}

function buildVoiceSkillRuntimeGuidance(skill: any): string {
  const requiredTools = Array.isArray(skill?.requiredTools) ? skill.requiredTools : [];
  const equivalents = requiredTools
    .map((tool: unknown) => {
      const voiceTool = voiceToolEquivalentForSkillTool(tool);
      return voiceTool ? `${tool} -> ${voiceTool}` : '';
    })
    .filter(Boolean)
    .slice(0, 12);
  return [
    'Use this skill as workflow guidance inside Realtime voice.',
    'Call only provided voice_* tools and canonical read-only skill_* tools from this layer. Explicit user-authorized social posts/messages are allowed through voice browser/desktop UI tools when the content and destination are clear. If the skill needs files, shell commands, downloads/uploads, credentials, source edits, purchases/payments, account settings/security changes, destructive submits, or durable system changes, dispatch_prometheus_worker instead.',
    equivalents.length ? `Voice-safe tool equivalents: ${equivalents.join('; ')}.` : '',
  ].filter(Boolean).join(' ');
}

function summarizeVoiceSkill(skill: any): Record<string, any> {
  return {
    id: skill?.id || '',
    name: skill?.name || skill?.id || '',
    description: compactVoiceText(skill?.description || skill?.instructions || '', 260),
    triggers: Array.isArray(skill?.triggers) ? skill.triggers.slice(0, 8) : [],
    requiredTools: Array.isArray(skill?.requiredTools) ? skill.requiredTools.slice(0, 10) : [],
    status: skill?.status || '',
    eligibility: skill?.eligibility?.status || '',
    riskLevel: skill?.riskLevel || '',
  };
}

function buildRealtimeSkillContextForTranscript(transcript: string, maxChars = 4200): { context: string; skills: Record<string, any>[] } {
  const text = String(transcript || '').trim();
  if (!text || !_skillsManager) return { context: '', skills: [] };
  _skillsManager.scanSkillsIfStale?.();
  const matched = _skillsManager.findMatchingSkillsForMessage(text)
    .map((id: string) => _skillsManager.get(id))
    .filter(Boolean)
    .slice(0, 5);
  if (!matched.length) return { context: '', skills: [] };
  const skillLines = matched.map((skill: any) => {
    const triggers = Array.isArray(skill.triggers) && skill.triggers.length
      ? ` Triggers: ${skill.triggers.slice(0, 6).join(', ')}.`
      : '';
    const required = Array.isArray(skill.requiredTools) && skill.requiredTools.length
      ? ` Required tools: ${skill.requiredTools.slice(0, 8).join(', ')}.`
      : '';
    const status = skill?.eligibility?.status && skill.eligibility.status !== 'ready'
      ? ` Eligibility: ${skill.eligibility.status}.`
      : '';
    return `- ${skill.id} (${skill.name || skill.id}): ${compactVoiceText(skill.description || '', 180)}.${triggers}${required}${status}`;
  });
  const context = [
    '## Realtime Skill Trigger Update',
    'The just-completed spoken turn matched installed skill trigger metadata.',
    'This is metadata for the current audio turn only, not a second user message or a transcript repeat.',
    'These are not active instructions yet. If a skill is relevant, call skill_read with its id before acting.',
    ...skillLines,
    'Use skill guidance only through voice_* tools and canonical read-only skill_* tools. Explicit user-authorized social posts/messages are allowed through voice browser/desktop UI tools when the content and destination are clear. Dispatch to the Prometheus worker for non-voice tools, files, shell, uploads/downloads, credentials, purchases/payments, account settings/security changes, destructive submits, or durable changes.',
  ].join('\n');
  return {
    context: compactVoiceText(context, maxChars),
    skills: matched.map(summarizeVoiceSkill),
  };
}

async function captureVoiceBrowserObservation(
  sessionId: string,
  tool: string,
  includeScreenshot: boolean = true,
): Promise<Record<string, any>> {
  if (includeScreenshot === false) {
    await broadcastVoiceBrowserStatus(sessionId, tool, null).catch(() => {});
    return {};
  }
  const shot = await browserVisionScreenshot(sessionId).catch(() => null);
  await broadcastVoiceBrowserStatus(sessionId, tool, shot).catch(() => {});
  if (!shot?.base64) return {};
  broadcastVoiceScreenshotPreview(sessionId, 'browser', tool, shot);
  return { width: shot.width, height: shot.height, mimeType: shot.mimeType || 'image/png' };
}

async function broadcastVoiceBrowserStatus(sessionId: string, tool: string, shot?: any): Promise<void> {
  const info = getBrowserSessionInfo(sessionId);
  if (!info?.active) return;
  const payload = {
    type: 'browser:status',
    sessionId,
    tool,
    active: true,
    url: info.url || '',
    title: info.title || '',
    statusLabel: tool === 'voice_browser_open' ? 'Browser opened.' : 'Voice browser action complete.',
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
    frameBase64: shot?.base64 || '',
    frameWidth: Number(shot?.width || 0),
    frameHeight: Number(shot?.height || 0),
    frameFormat: shot?.base64 ? 'png' : '',
    browserOwnerType: 'main',
    browserOwnerId: '',
    browserLabel: 'Voice Agent browser',
    browserTaskPrompt: '',
    browserSpawnerSessionId: '',
    timestamp: Date.now(),
  };
  broadcastWS(payload);
  if (tool === 'voice_browser_open' || tool === 'voice_browser_snapshot') {
    broadcastWS({ ...payload, type: 'browser:open' });
  }
}

function voiceDesktopWindowSelector(args: Record<string, any>): { window_id?: string; window_handle?: number; app_id?: string; title?: string } {
  return {
    window_id: args?.window_id == null ? undefined : String(args.window_id),
    window_handle: args?.window_handle == null && args?.handle == null ? undefined : Number(args.window_handle ?? args.handle),
    app_id: args?.app_id == null && args?.appId == null ? undefined : String(args.app_id ?? args.appId),
    title: args?.title == null && args?.name == null ? undefined : String(args.title ?? args.name),
  };
}

async function captureVoiceDesktopWindowObservation(
  sessionId: string,
  tool: string,
  args: Record<string, any>,
  includeScreenshot: boolean = true,
): Promise<Record<string, any>> {
  if (includeScreenshot === false) return {};
  const selector = voiceDesktopWindowSelector(args);
  const handle = Number(selector.window_handle || 0);
  const title = String(selector.title || '').trim();
  const appId = String(selector.app_id || '').trim();
  await desktopWindowScreenshot(sessionId, {
    ...(Number.isFinite(handle) && handle > 0 ? { handle } : {}),
    ...(title ? { name: title } : {}),
    ...(!title && !(Number.isFinite(handle) && handle > 0) && appId ? { name: appId } : {}),
    active: !title && !(Number.isFinite(handle) && handle > 0) && !appId,
    focus_first: false,
  }).catch(() => '');
  const packet = getDesktopAdvisorPacket(sessionId);
  if (packet?.screenshotBase64) {
    broadcastVoiceScreenshotPreview(sessionId, 'desktop', tool, {
      base64: packet.screenshotBase64,
      mimeType: packet.screenshotMime || 'image/png',
      width: packet.width,
      height: packet.height,
    });
  }
  const target = packet?.targetWindow;
  return packet ? {
    screenshotId: packet.screenshotId,
    width: packet.width,
    height: packet.height,
    targetWindow: target ? {
      title: target.title,
      processName: target.processName,
      handle: target.handle,
    } : undefined,
  } : {};
}

async function captureVoiceDesktopObservation(
  sessionId: string,
  tool: string,
  includeScreenshot: boolean = true,
): Promise<Record<string, any>> {
  if (includeScreenshot === false) return {};
  const result = await desktopScreenshotWithHistory(sessionId, { capture: 'all' }).catch(() => '');
  const packet = getDesktopAdvisorPacket(sessionId);
  if (packet?.screenshotBase64) {
    broadcastVoiceScreenshotPreview(sessionId, 'desktop', tool, {
      base64: packet.screenshotBase64,
      mimeType: packet.screenshotMime || 'image/png',
      width: packet.width,
      height: packet.height,
    });
  }
  return packet ? {
    screenshotId: packet.screenshotId,
    width: packet.width,
    height: packet.height,
    observation: compactVoiceText(result, 5000),
  } : {};
}

function voiceRuntimeDirectiveFromToolResult(result: any): Record<string, any> | null {
  if (!result?.runtimeAction) return null;
  const directive: Record<string, any> = {
    action: String(result.runtimeAction || ''),
  };
  const wakePhrase = cleanVoiceWakePhrase(result.wakePhrase);
  if (wakePhrase) directive.wakePhrase = wakePhrase;
  if (result.activateAfterReply === true || result.activate_after_reply === true) directive.activateAfterReply = true;
  if (result.requiresWakePhrase === true || result.requires_wake_phrase === true) directive.requiresWakePhrase = true;
  return directive.action ? directive : null;
}

function parseVoiceToolArgs(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isVoiceFetchEscalationUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return /(^|\.)x\.com$|(^|\.)twitter\.com$|(^|\.)tiktok\.com$|(^|\.)instagram\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)facebook\.com$|(^|\.)threads\.net$/i.test(host);
  } catch {
    return false;
  }
}

function summarizeVoiceSearchResult(result: any): Record<string, any> {
  const stdout = compactVoiceText(result?.stdout || result?.data?.answer || result?.error || '', 1800);
  const rows = Array.isArray(result?.data?.results) ? result.data.results
    : Array.isArray(result?.data?.items) ? result.data.items
      : [];
  const results = rows.slice(0, 5).map((row: any) => ({
    title: compactVoiceText(row?.title || row?.name || '', 160),
    url: compactVoiceText(row?.url || row?.link || '', 240),
    snippet: compactVoiceText(row?.snippet || row?.content || row?.description || '', 260),
  })).filter((row: any) => row.title || row.url || row.snippet);
  return { stdout, results };
}

function summarizeVoiceMemorySearch(raw: any): Record<string, any> {
  const hits = Array.isArray(raw?.hits) ? raw.hits
    : Array.isArray(raw?.results) ? raw.results
      : Array.isArray(raw?.records) ? raw.records
        : [];
  return {
    count: hits.length,
    hits: hits.slice(0, 5).map((hit: any) => ({
      recordId: compactVoiceText(hit?.recordId || hit?.record_id || hit?.id || '', 120),
      title: compactVoiceText(hit?.title || hit?.canonicalKey || hit?.sourceTitle || hit?.source || '', 180),
      why: compactVoiceText(hit?.whyMatched || hit?.summary || hit?.snippet || hit?.text || hit?.content || '', 360),
      source: compactVoiceText(hit?.sourceType || hit?.source_type || hit?.layer || '', 80),
    })),
  };
}

function summarizeVoiceAutomationDashboard(data: any): Record<string, any> {
  const counts = data?.counts && typeof data.counts === 'object' ? data.counts : {};
  const jobs = Array.isArray(data?.scheduledJobs) ? data.scheduledJobs : [];
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const watches = Array.isArray(data?.internalWatches) ? data.internalWatches : [];
  const events = Array.isArray(data?.eventQueue) ? data.eventQueue : [];
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const agents = Array.isArray(data?.agents) ? data.agents : [];
  const attentionJobs = jobs
    .filter((job: any) => !['healthy', 'running'].includes(String(job?.health?.state || '').toLowerCase()))
    .slice(0, 5)
    .map((job: any) => ({
      id: compactVoiceText(job?.id || '', 120),
      name: compactVoiceText(job?.name || job?.id || '', 180),
      state: compactVoiceText(job?.health?.state || job?.status || '', 80),
      nextRun: job?.nextRun || null,
      blocker: compactVoiceText(job?.health?.blockerReason || job?.pausedReason || '', 240),
    }));
  const activeTasks = tasks
    .filter((task: any) => /queued|running|paused|stalled|needs_assistance|awaiting_user_input|waiting_subagent/i.test(String(task?.status || '')))
    .slice(0, 6)
    .map((task: any) => ({
      id: compactVoiceText(task?.id || '', 120),
      title: compactVoiceText(task?.title || task?.id || '', 220),
      status: compactVoiceText(task?.status || '', 80),
      step: task?.step || null,
      total_steps: task?.total_steps || null,
      agentId: compactVoiceText(task?.agentId || '', 120),
    }));
  const activeWatches = watches
    .filter((watch: any) => String(watch?.status || '').toLowerCase() === 'active')
    .slice(0, 5)
    .map((watch: any) => ({
      id: compactVoiceText(watch?.id || '', 120),
      label: compactVoiceText(watch?.label || watch?.id || '', 220),
      target: watch?.target || null,
      expiresAt: watch?.expiresAt || null,
    }));
  const agentHighlights = agents.slice(0, 6).map((agent: any) => ({
    id: compactVoiceText(agent?.id || '', 120),
    name: compactVoiceText(agent?.name || agent?.id || '', 140),
    jobs: Number(agent?.jobCount || 0),
    tasks: Number(agent?.taskCount || 0),
    lastOutput: compactVoiceText(agent?.lastOutput || '', 300),
  }));
  return {
    generatedAt: data?.generatedAt || '',
    depth: data?.depth || 'summary',
    counts,
    jobsByHealth: counts.jobsByHealth || {},
    tasksByStatus: counts.tasksByStatus || {},
    attentionJobs,
    activeTasks,
    activeWatches,
    pendingEventCount: events.length,
    teamCount: teams.length,
    agentHighlights,
  };
}

function resolveVoiceAgentMemoryFilePath(workspacePath: string): string {
  const canonical = path.join(workspacePath, 'VOICEAGENT.md');
  if (fs.existsSync(canonical)) return canonical;
  const lower = path.join(workspacePath, 'voiceagent.md');
  if (fs.existsSync(lower)) return lower;
  return canonical;
}

function readVoiceAgentMemoryFile(workspacePath: string): { filePath: string; content: string } {
  const filePath = resolveVoiceAgentMemoryFilePath(workspacePath);
  if (!fs.existsSync(filePath)) return { filePath, content: '' };
  return { filePath, content: fs.readFileSync(filePath, 'utf-8') };
}

function formatVoiceAgentMemoryAppend(content: string, category = ''): string {
  const text = String(content || '').trim();
  if (!text) return '';
  const date = new Date().toISOString().slice(0, 10);
  const tag = compactVoiceText(category || 'voice', 60).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'voice';
  return `- ${text} [${date}; ${tag}]`;
}

function cleanVoiceWakePhrase(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;"'!?-]+|[\s,.:;"'!?-]+$/g, '')
    .trim()
    .slice(0, 80);
}

const VOICE_WRAPPER_TOOL_NAMES = new Set([
  'voice_browser',
  'voice_desktop',
  'voice_ops',
]);

const VOICE_HIDDEN_COMPAT_TOOL_NAMES = new Set([
  'voice_web_search',
  'voice_web_fetch',
  'voice_write_note',
  'voice_agent_memory',
  'voice_set_wake_phrase',
  'voice_enter_quiet_mode',
  'voice_set_quiet_until',
  'voice_memory_search',
  'voice_timer',
  'voice_browser_screenshot',
  'voice_browser_open',
  'voice_browser_scroll',
  'voice_browser_snapshot',
  'voice_browser_click',
  'voice_browser_vision_click',
  'voice_browser_fill',
  'voice_browser_type',
  'voice_browser_vision_type',
  'voice_browser_press_key',
  'voice_browser_wait',
  'voice_desktop_screenshot',
  'voice_desktop_click',
  'voice_desktop_window_control',
  'voice_desktop_focus_window',
  'voice_desktop_launch_app',
  'voice_desktop_find_app',
  'voice_desktop_list_windows',
  'voice_desktop_window_click',
  'voice_desktop_window_type',
  'voice_desktop_window_press_key',
  'voice_desktop_window_scroll',
  'voice_automation_dashboard',
  'voice_worker_status',
  'voice_task_control',
  'voice_send_screenshot',
  'voice_generate_image',
  'voice_generate_video',
]);

function stripVoiceWrapperArgs(args: Record<string, any>): Record<string, any> {
  const { action: _action, operation: _operation, op: _op, ...rest } = args || {};
  return rest;
}

function normalizeVoiceAgentWrapperTool(name: string, args: Record<string, any>): { name: string; args: Record<string, any> } {
  const action = String(args?.action || args?.operation || args?.op || '').trim().toLowerCase();
  const innerArgs = stripVoiceWrapperArgs(args || {});
  if (name === 'voice_browser') {
    const target = ({
      screenshot: 'voice_browser_screenshot',
      open: 'voice_browser_open',
      scroll: 'voice_browser_scroll',
      snapshot: 'voice_browser_snapshot',
      click: 'voice_browser_click',
      vision_click: 'voice_browser_vision_click',
      fill: 'voice_browser_fill',
      type: 'voice_browser_type',
      vision_type: 'voice_browser_vision_type',
      press_key: 'voice_browser_press_key',
      wait: 'voice_browser_wait',
    } as Record<string, string>)[action];
    return target ? { name: target, args: innerArgs } : { name, args };
  }
  if (name === 'voice_desktop') {
    const target = ({
      screenshot: 'voice_desktop_screenshot',
      click: 'voice_desktop_click',
      window_control: 'voice_desktop_window_control',
      focus_window: 'voice_desktop_focus_window',
      launch_app: 'voice_desktop_launch_app',
      find_app: 'voice_desktop_find_app',
      list_windows: 'voice_desktop_list_windows',
      window_click: 'voice_desktop_window_click',
      window_type: 'voice_desktop_window_type',
      window_press_key: 'voice_desktop_window_press_key',
      window_scroll: 'voice_desktop_window_scroll',
    } as Record<string, string>)[action];
    if (target === 'voice_desktop_window_control' && innerArgs.action == null) {
      const innerAction = args?.window_action ?? args?.windowAction ?? args?.control ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    return target ? { name: target, args: innerArgs } : { name, args };
  }
  if (name === 'voice_ops') {
    const target = ({
      web_search: 'voice_web_search',
      web_fetch: 'voice_web_fetch',
      write_note: 'voice_write_note',
      agent_memory: 'voice_agent_memory',
      set_wake_phrase: 'voice_set_wake_phrase',
      enter_quiet_mode: 'voice_enter_quiet_mode',
      set_quiet_until: 'voice_set_quiet_until',
      memory_search: 'voice_memory_search',
      timer: 'voice_timer',
      automation_dashboard: 'voice_automation_dashboard',
      worker_status: 'voice_worker_status',
      task_control: 'voice_task_control',
      send_screenshot: 'voice_send_screenshot',
      generate_image: 'voice_generate_image',
      generate_video: 'voice_generate_video',
    } as Record<string, string>)[action];
    if (target === 'voice_agent_memory' && innerArgs.action == null) {
      const innerAction = args?.memory_action ?? args?.memoryAction ?? args?.tool_action ?? args?.toolAction ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    if (target === 'voice_timer' && innerArgs.action == null) {
      const innerAction = args?.timer_action ?? args?.timerAction ?? args?.tool_action ?? args?.toolAction ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    if (target === 'voice_task_control' && innerArgs.action == null) {
      const innerAction = args?.task_action ?? args?.taskAction ?? args?.tool_action ?? args?.toolAction ?? args?.command;
      if (innerAction != null) innerArgs.action = innerAction;
    }
    return target ? { name: target, args: innerArgs } : { name, args };
  }
  return { name, args };
}

function buildVoiceToolDefinitions(): any[] {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'voice_ops',
        description: 'Unified voice operations wrapper for quick search/fetch, notes, voice-agent memory, wake/quiet runtime controls, recall, timers, operator status, screenshot delivery, and simple image/video generation. Use action to choose the wrapper operation; pass underlying arguments at top level. For agent_memory use memory_action read/append/replace; for timer use timer_action create/list/update/reschedule/cancel.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['web_search', 'web_fetch', 'write_note', 'agent_memory', 'set_wake_phrase', 'enter_quiet_mode', 'set_quiet_until', 'memory_search', 'timer', 'automation_dashboard', 'worker_status', 'task_control', 'send_screenshot', 'generate_image', 'generate_video'],
            },
            query: { type: 'string' },
            url: { type: 'string' },
            content: { type: 'string' },
            phrase: { type: 'string' },
            reason: { type: 'string' },
            mode: { type: 'string' },
            tool_action: { type: 'string', description: 'Inner operation for wrapped tools that also need an action, such as agent_memory or timer.' },
            memory_action: { type: 'string', enum: ['read', 'append', 'replace'], description: 'Inner action when action is agent_memory.' },
            timer_action: { type: 'string', enum: ['create', 'list', 'update', 'reschedule', 'cancel'], description: 'Inner action when action is timer.' },
            task_action: { type: 'string', enum: ['status', 'resume', 'pause', 'rerun', 'cancel', 'message'], description: 'Inner action when action is task_control.' },
            task_id: { type: 'string', description: 'Optional exact task id for task_control. If omitted, defaults to latest unfinished voice workgroup tasks.' },
            task_ids: { type: 'array', items: { type: 'string' }, description: 'Optional exact task ids for task_control.' },
            workgroup_id: { type: 'string', description: 'Optional voice workgroup id for task_control.' },
            message: { type: 'string', description: 'Guidance/note for task_control, especially "tell the worker..." or resume with new direction.' },
            resume_after_message: { type: 'boolean', description: 'For task_control action=message, resume after injecting the message. Default false.' },
            timer_id: { type: 'string' },
            instruction: { type: 'string' },
            label: { type: 'string' },
            delay_seconds: { type: 'number' },
            due_at: { type: 'string' },
            delivery: { type: 'object', additionalProperties: true },
            source: { type: 'string', enum: ['desktop_new', 'desktop_last', 'browser_new', 'browser_last'] },
            target: { type: 'string', enum: ['origin', 'mobile', 'telegram', 'web', 'all'] },
            caption: { type: 'string' },
            prompt: { type: 'string' },
            reference_images: { type: 'array', items: { type: 'string' } },
            image: { type: 'string' },
            video: { type: 'string' },
            aspect_ratio: { type: 'string', enum: ['landscape', 'square', 'portrait'] },
            count: { type: 'integer', minimum: 1, maximum: 4 },
            duration: { type: 'number' },
            resolution: { type: 'string', enum: ['480p', '720p'] },
            capture: { type: 'string', enum: ['all', 'primary'] },
            monitor_index: { type: 'number' },
            name: { type: 'string' },
            handle: { type: 'number' },
            active: { type: 'boolean' },
            focus_first: { type: 'boolean' },
            padding: { type: 'number' },
            provider: { type: 'string' },
            model: { type: 'string' },
            output_dir: { type: 'string' },
            save_to_workspace: { type: 'boolean' },
            max_results: { type: 'number' },
            max_chars: { type: 'number' },
            limit: { type: 'number' },
            include_recent_events: { type: 'boolean' },
            include_done: { type: 'boolean' },
            include: { type: 'array', items: { type: 'string' } },
            agent_id: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser',
        description: 'Unified live browser wrapper for the Prometheus-controlled browser. Use action open/snapshot/screenshot/click/vision_click/fill/type/vision_type/press_key/scroll/wait, then pass the matching target/input arguments at top level. Use Worker for uploads/downloads, files, credentials, purchases/payments, destructive actions, account settings, or durable changes.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['open', 'snapshot', 'screenshot', 'click', 'vision_click', 'fill', 'type', 'vision_type', 'press_key', 'scroll', 'wait'] },
            url: { type: 'string' },
            query: { type: 'string' },
            ref: { type: 'number' },
            element: { type: 'string' },
            selector: { type: 'string' },
            text: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            button: { type: 'string', enum: ['left', 'right'] },
            key: { type: 'string' },
            direction: { type: 'string', enum: ['up', 'down'] },
            amount: { type: 'number' },
            ms: { type: 'number' },
            include_screenshot: { type: 'boolean' },
            include_summary: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop',
        description: 'Unified live desktop wrapper for screenshot, app/window discovery, focus/launch/window control, and pointer/keyboard/scroll actions. Use action to select the wrapper operation and pass target/input arguments at top level. For window_control use window_action minimize/maximize/restore/close. Use Worker for file edits, shell/install work, credentials, purchases/payments, account settings/security changes, destructive confirmations, or durable system changes.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['screenshot', 'click', 'window_control', 'focus_window', 'launch_app', 'find_app', 'list_windows', 'window_click', 'window_type', 'window_press_key', 'window_scroll'] },
            window_action: { type: 'string', enum: ['minimize', 'maximize', 'restore', 'close'], description: 'Inner action when action is window_control.' },
            capture: { type: 'string', enum: ['all', 'primary'] },
            monitor_index: { type: 'number' },
            mode: { type: 'string', enum: ['normal', 'som'] },
            som: { type: 'boolean' },
            name: { type: 'string' },
            title: { type: 'string' },
            handle: { type: 'number' },
            active: { type: 'boolean' },
            focus_first: { type: 'boolean' },
            padding: { type: 'number' },
            x: { type: 'number' },
            y: { type: 'number' },
            element: { type: 'number' },
            coordinate_space: { type: 'string', enum: ['capture', 'monitor', 'virtual', 'window'] },
            screenshot_id: { type: 'string' },
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            window_name: { type: 'string' },
            app_id: { type: 'string' },
            app: { type: 'string' },
            process_name: { type: 'string' },
            query: { type: 'string' },
            text: { type: 'string' },
            raw: { type: 'boolean' },
            key: { type: 'string' },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
            amount: { type: 'number' },
            button: { type: 'string', enum: ['left', 'right'] },
            double_click: { type: 'boolean' },
            modifier: { type: 'string', enum: ['none', 'shift', 'ctrl', 'alt'], default: 'none', description: 'Default none. Only use shift/ctrl/alt when explicitly requested.' },
            verify: { type: 'string' },
            include_screenshot: { type: 'boolean' },
            include_summary: { type: 'boolean' },
            wait_ms: { type: 'number' },
            limit: { type: 'number' },
            refresh: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_web_search',
        description: 'Fast voice wrapper around Prometheus web_search/web_search_single/web_search_multi. Use for quick current/factual lookup. Use multi for latest/current/news/compare/sensitive/current-event questions. Escalate deep research to handoff_new_work.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            mode: { type: 'string', enum: ['auto', 'single', 'multi'], description: 'auto chooses single for simple questions and multi for latest/current/news/compare.' },
            max_results: { type: 'number', description: 'Small number, usually 3-5.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_web_fetch',
        description: 'Fast voice wrapper around Prometheus web_fetch for one clean text/article/docs URL. Do not use for X/Twitter, TikTok, Instagram, YouTube, auth/browser/media-heavy URLs; hand those to Worker.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string' },
            max_chars: { type: 'number', description: 'Default 4000, hard capped for voice.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_write_note',
        description: 'Fast voice wrapper around write_note. Use only when the user asks to remember, jot down, log, or save a short note. Never use this for runtime wake phrase, quiet mode, listening mode, voice provider, or other voice configuration changes; use a dedicated voice runtime tool or hand off to Worker.',
        parameters: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string' },
            tag: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_agent_memory',
        description: 'Read or update workspace/VOICEAGENT.md, the live voice-agent-only memory file. Use when the user explicitly asks to view, add, change, or remove live voice agent routing/spoken-behavior notes. This is not general user/soul/memory storage and must not be used for wake phrase runtime settings.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['read', 'append', 'replace'], description: 'read returns the current file, append adds one dated bullet, replace overwrites the file with supplied full content.' },
            content: { type: 'string', description: 'Required for append and replace. For append, this should be one concise voice-agent routing or behavior note. For replace, this must be the complete new VOICEAGENT.md content.' },
            category: { type: 'string', description: 'Optional short tag for appended notes, such as browser, routing, spoken_style, or handoff.' },
            max_chars: { type: 'number', description: 'Read cap. Default 5000, max 12000.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_set_wake_phrase',
        description: 'Set the mobile voice runtime wake phrase for always-listening mode. Use when the user asks to set/change/make their wake phrase or wake word. This is runtime voice configuration, not memory or notes.',
        parameters: {
          type: 'object',
          required: ['phrase'],
          properties: {
            phrase: { type: 'string', description: 'The spoken phrase that should wake Prometheus, e.g. "hey Prometheus".' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_enter_quiet_mode',
        description: 'Activate mobile quiet mode using the currently configured wake phrase. Use only when the user clearly asks Prometheus to be quiet, stop responding, sleep, or stop listening now. Do not use for mentions, examples, debugging, or questions about quiet mode.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Brief reason/context for the quiet-mode request.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_set_quiet_until',
        description: 'Set a wake phrase and then activate mobile quiet mode after Prometheus acknowledges. Use when the user says not to respond/speak/listen until or unless they say a specific phrase.',
        parameters: {
          type: 'object',
          required: ['phrase'],
          properties: {
            phrase: { type: 'string', description: 'The spoken phrase that should wake Prometheus again.' },
            reason: { type: 'string', description: 'Brief reason/context for entering quiet mode.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_list',
        description: 'Canonical compact skill discovery. Natural task-style queries are ranked across id/name/description/triggers/categories/requiredTools with weak candidates instead of brittle exact matching. Descriptions are omitted unless include_descriptions:true is needed.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional natural language task/query to rank against skill metadata.' },
            limit: { type: 'number', description: 'Maximum skills to return. Default 24, hard cap 80.' },
            include_descriptions: { type: 'boolean', description: 'Include short descriptions. Default false to keep prompt usage low.' },
            include_match_details: { type: 'boolean', description: 'Include matched terms/fields for trigger debugging. Default false.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_read',
        description: 'Canonical Prometheus skill_read tool. Read full SKILL.md instructions for one relevant skill before acting. Follow skill instructions only through voice_* tools from Realtime; explicit user-authorized social posts/messages are allowed when content and destination are clear. Hand off to Worker for files, shell, uploads/downloads, credentials, source edits, purchases/payments, account settings/security changes, destructive, or durable actions.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Skill id from skill_list or trigger context.' },
            max_chars: { type: 'number', description: 'Optional cap for instructions, default 7000.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_resource_list',
        description: 'Canonical Prometheus skill_resource_list tool. List static resources declared or discovered for a bundled skill.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Skill id.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'skill_resource_read',
        description: 'Canonical Prometheus skill_resource_read tool. Read one text resource from a bundled skill, such as an example/template/reference. Keep use narrow and hand off to Worker for non-text or execution-heavy resources.',
        parameters: {
          type: 'object',
          required: ['id', 'path'],
          properties: {
            id: { type: 'string', description: 'Skill id.' },
            path: { type: 'string', description: 'Resource path from skill_read or skill_resource_list.' },
            max_chars: { type: 'number', description: 'Optional cap for content, default 5000.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_memory_search',
        description: 'Fast read-only wrapper around memory_search and optional memory_read_record. Use for recall: previous decisions, project history, preferences, what was said before. Do not write memory.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            mode: { type: 'string', enum: ['quick', 'deep', 'timeline', 'project'] },
            limit: { type: 'number' },
            read_record_id: { type: 'string', description: 'Optional record id from a prior result to read one record.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_timer',
        description: 'Fast voice wrapper around the existing Prometheus timer tool. Use to create/list/update/cancel one-shot main-chat timers. Timer execution is handled by the Worker when due.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['create', 'list', 'update', 'reschedule', 'cancel'] },
            timer_id: { type: 'string' },
            instruction: { type: 'string', description: 'What the Worker should do when the timer fires.' },
            label: { type: 'string' },
            delay_seconds: { type: 'number' },
            due_at: { type: 'string', description: 'ISO timestamp if known.' },
            delivery: {
              type: 'object',
              properties: {
                origin: { type: 'boolean' },
                telegram: { type: 'boolean' },
                voice_if_active: { type: 'boolean' },
              },
              additionalProperties: true,
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_screenshot',
        description: 'Capture the current Prometheus-controlled browser viewport from the voice layer. Use for quick visual browser context before or after realtime browser control.',
        parameters: {
          type: 'object',
          properties: {
            include_summary: { type: 'boolean', description: 'Whether to include brief screenshot metadata in the spoken reply.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_open',
        description: 'Open the Prometheus-controlled browser, a URL/domain, or a browser search query and return DOM plus screenshot observation context. Use this for "open browser", Chrome/Edge/browser/web/page/tab/site/URL/search requests. If the user says just "open the browser", open https://www.google.com. Hand off to Worker for uploads/downloads, files, purchases/payments, account settings/security changes, or durable work.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL/domain to open. Include protocol when known. Domains like example.com are accepted.' },
            query: { type: 'string', description: 'Browser search query when the user asks to open/search something without giving a URL.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after opening. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_scroll',
        description: 'Scroll the current Prometheus-controlled browser viewport up or down and observe the result. If the user asks to scroll the browser/page/site, call this tool immediately instead of saying you will. Do not use for file downloads/uploads or durable external actions; hand those to Worker.',
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction. Default down.' },
            amount: { type: 'number', description: 'Scroll amount multiplier from 0.5 to 4. Default 1.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after scrolling. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_snapshot',
        description: 'Return the current Prometheus browser DOM/accessibility snapshot with @ref targets. Use before browser_click/browser_fill when you need reliable element refs.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_click',
        description: 'Click a browser element by @ref, saved element name, or CSS selector, then observe with fresh DOM and screenshot context. If the user asks to click/tap/select something in the browser, call this tool immediately instead of saying you will. Explicit user-authorized social posts/messages are allowed when the target and content are clear. For uploads/downloads, purchases/payments, destructive submits, or account settings/security changes, hand off to Worker.',
        parameters: {
          type: 'object',
          properties: {
            ref: { type: 'number', description: 'Preferred @ref from voice_browser_snapshot or a prior browser observation.' },
            element: { type: 'string', description: 'Optional saved/named browser element.' },
            selector: { type: 'string', description: 'Optional CSS selector when no @ref is available.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after clicking. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_vision_click',
        description: 'Click browser viewport coordinates from the latest screenshot, then observe with fresh DOM and screenshot context. Use when DOM refs are unavailable, such as canvas/SVG/WebGL UIs. Explicit user-authorized social posts/messages are allowed when the target and content are clear. For uploads/downloads, purchases/payments, destructive submits, or account settings/security changes, hand off to Worker.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'Viewport x coordinate in pixels from the browser screenshot.' },
            y: { type: 'number', description: 'Viewport y coordinate in pixels from the browser screenshot.' },
            button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button. Default left.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after clicking. Default true.' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_fill',
        description: 'Fill a browser field by @ref, saved element name, or CSS selector, then observe with fresh DOM and screenshot context. Use for live browser UI drafting/input, including explicitly requested social posts/messages. Do not use for passwords, payment data, uploads/downloads, or destructive/account-settings submits; hand those to Worker.',
        parameters: {
          type: 'object',
          properties: {
            ref: { type: 'number', description: 'Preferred @ref from voice_browser_snapshot or a prior browser observation.' },
            element: { type: 'string', description: 'Optional saved/named browser element.' },
            selector: { type: 'string', description: 'Optional CSS selector when no @ref is available.' },
            text: { type: 'string', description: 'Text to fill into the target field.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after filling. Default true.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_type',
        description: 'Type text into the browser element that currently has focus, then observe with fresh DOM and screenshot context. Use after click/focus on fields, editors, or canvas input UIs, including explicitly requested social posts/messages. Do not use for passwords/payment data or destructive/account-settings submits; hand those to Worker.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to type into the currently focused browser element.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after typing. Default true.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_vision_type',
        description: 'Click browser viewport coordinates from the latest screenshot and type text, then observe with fresh DOM and screenshot context. Use when DOM refs are unavailable, including explicitly requested social posts/messages. Do not use for passwords/payment data or destructive/account-settings submits; hand those to Worker.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'Viewport x coordinate in pixels from the browser screenshot.' },
            y: { type: 'number', description: 'Viewport y coordinate in pixels from the browser screenshot.' },
            text: { type: 'string', description: 'Text to type after clicking the coordinate.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after typing. Default true.' },
          },
          required: ['x', 'y', 'text'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_press_key',
        description: 'Press a browser key such as Enter, Escape, Tab, ArrowDown, PageDown, or Backspace, then observe with fresh DOM and screenshot context. If the user asks to press a browser key, call this tool immediately instead of saying you will. Explicit user-authorized social posts/messages are allowed when pressing the key is the requested submit/send action. For purchases/payments, destructive submits, or account settings/security changes, hand off to Worker.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key to press, e.g. Enter, Escape, Tab, ArrowDown, PageDown, Backspace.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after pressing the key. Default true.' },
          },
          required: ['key'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_browser_wait',
        description: 'Wait briefly for the current browser page/UI to settle, then observe with fresh DOM and screenshot context.',
        parameters: {
          type: 'object',
          properties: {
            ms: { type: 'number', description: 'Milliseconds to wait. Clamped to a short realtime-friendly delay.' },
            include_screenshot: { type: 'boolean', description: 'Capture a browser screenshot preview after waiting. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_screenshot',
        description: 'Capture a desktop screenshot from the voice layer. Use when the user asks for a desktop screenshot, app/window screenshot, or when realtime desktop control needs fresh visual context.',
        parameters: {
          type: 'object',
          properties: {
            capture: { type: 'string', enum: ['all', 'primary'], description: 'Default all. Use primary if the user asks for the main screen.' },
            monitor_index: { type: 'number', description: 'Optional monitor index; overrides capture when provided.' },
            name: { type: 'string', description: 'Optional app/window title or process name to capture as a single-window screenshot.' },
            handle: { type: 'number', description: 'Optional exact window handle to capture.' },
            active: { type: 'boolean', description: 'Capture the current active window.' },
            focus_first: { type: 'boolean', description: 'Focus the target window before capture. Default true for window screenshots.' },
            padding: { type: 'number', description: 'Extra pixels around a window screenshot. Default 8.' },
            mode: { type: 'string', enum: ['normal', 'som'], description: 'Use som to overlay numbered clickable UI elements when preparing to click.' },
            som: { type: 'boolean', description: 'Shortcut for mode="som".' },
            include_summary: { type: 'boolean', description: 'Whether to include brief screenshot metadata in the spoken reply.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_click',
        description: 'Click desktop coordinates using the same Prometheus desktop_click targeting model as the Worker. If the user asks to click the desktop/current screen and a screenshot coordinate or SOM element is available, call this tool immediately. Prefer voice_desktop_window_click when you already have a specific window_id/window_handle.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate from the screenshot/capture/monitor/virtual coordinate space.' },
            y: { type: 'number', description: 'Y coordinate from the screenshot/capture/monitor/virtual coordinate space.' },
            element: { type: 'number', description: 'Numbered SOM element from a screenshot taken with mode="som".' },
            coordinate_space: { type: 'string', enum: ['capture', 'monitor', 'virtual', 'window'], description: 'Coordinate space. Use capture with screenshot_id when clicking from screenshot pixels.' },
            screenshot_id: { type: 'string', description: 'Screenshot ID from voice_desktop_screenshot. Strongly recommended for capture/SOM clicks.' },
            monitor_index: { type: 'number', description: 'Monitor index for monitor coordinate space.' },
            window_name: { type: 'string', description: 'Optional target window name for window-relative coordinates.' },
            window_handle: { type: 'number', description: 'Optional target window handle for window-relative coordinates.' },
            button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button. Default left.' },
            double_click: { type: 'boolean', description: 'Double click instead of single click. Default false.' },
            modifier: { type: 'string', enum: ['none', 'shift', 'ctrl', 'alt'], default: 'none', description: 'Default none. Only use shift/ctrl/alt when explicitly requested.' },
            verify: { type: 'string', description: 'Optional desktop verification mode supported by the underlying tool.' },
            include_screenshot: { type: 'boolean', description: 'Capture a fresh desktop screenshot preview after clicking. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_window_control',
        description: 'Minimize, maximize, restore, or close a desktop window using the same Prometheus desktop_window_control path as the Worker. Prefer this over clicking window chrome.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['minimize', 'maximize', 'restore', 'close'], description: 'Window action to perform.' },
            name: { type: 'string', description: 'Optional app/window title or process name. If omitted, active window is used.' },
            handle: { type: 'number', description: 'Optional exact window handle.' },
            active: { type: 'boolean', description: 'Use the current active window. Default true when name/handle are omitted.' },
            include_screenshot: { type: 'boolean', description: 'Capture a fresh window screenshot preview after maximize/restore. Default true. Minimize/close do not capture by default.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_focus_window',
        description: 'Focus one desktop app/window by partial title or process name, then verify the active title/process/monitor and capture a screenshot preview by default. Use for live desktop UI control setup. Do not use for files, shell commands, installs, or durable system changes; hand those to Worker.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Partial window title or process name to focus.' },
            include_screenshot: { type: 'boolean', description: 'Capture a verification screenshot after focus. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_launch_app',
        description: 'Launch a native desktop app by app_id or app name and wait for its window. Use only for non-browser desktop apps. NEVER use this for browser, Chrome, Edge, websites, URLs, pages, tabs, Google/search, installers, shell commands, files, or durable system changes; use voice_browser_open or Worker instead.',
        parameters: {
          type: 'object',
          properties: {
            app_id: { type: 'string', description: 'Stable installed app id when known.' },
            app: { type: 'string', description: 'Native app name or executable name, e.g. notepad, calculator, vscode. Do not pass browser/chrome/edge/web/url/search requests here.' },
            wait_ms: { type: 'number', description: 'Max milliseconds to wait for the window. Default 6000.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_find_app',
        description: 'Look up installed desktop apps by name and return ranked app_id candidates. Use before voice_desktop_launch_app when the app name is ambiguous.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'App name or fuzzy query.' },
            limit: { type: 'number', description: 'Maximum candidates. Default 8.' },
            refresh: { type: 'boolean', description: 'Refresh the installed app inventory before searching. Default false.' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_list_windows',
        description: 'List open desktop windows in the canonical Prometheus window model. Use to find window_id/window_handle/app_id before window-scoped desktop control.',
        parameters: {
          type: 'object',
          properties: {
            app_id: { type: 'string', description: 'Optional app_id filter.' },
            process_name: { type: 'string', description: 'Optional process name filter.' },
            title: { type: 'string', description: 'Optional window title filter.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_window_click',
        description: 'Click inside a specific desktop window using window/screenshot coordinates, then capture a fresh window screenshot. If the user asks to click inside an identified app/window, call this tool immediately instead of saying you will. Explicit user-authorized social posts/messages are allowed when the target and content are clear. For file operations, installs, destructive confirmations, purchases/payments, or account settings/security changes, hand off to Worker.',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Preferred canonical window_id from voice_desktop_list_windows.' },
            window_handle: { type: 'number', description: 'Optional exact window handle from a window screenshot/list.' },
            app_id: { type: 'string', description: 'Optional app_id selector.' },
            title: { type: 'string', description: 'Optional window title selector.' },
            x: { type: 'number', description: 'X coordinate from the relevant screenshot/window.' },
            y: { type: 'number', description: 'Y coordinate from the relevant screenshot/window.' },
            coordinate_space: { type: 'string', enum: ['window', 'capture', 'monitor', 'virtual'], description: 'Coordinate space. Default window.' },
            screenshot_id: { type: 'string', description: 'Optional screenshot_id anchoring the coordinate.' },
            button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button. Default left.' },
            double_click: { type: 'boolean', description: 'Double click instead of single click. Default false.' },
            modifier: { type: 'string', enum: ['none', 'shift', 'ctrl', 'alt'], default: 'none', description: 'Default none. Only use shift/ctrl/alt when explicitly requested.' },
            verify: { type: 'string', description: 'Optional desktop verification mode supported by the underlying tool.' },
            include_screenshot: { type: 'boolean', description: 'Capture a window screenshot preview after clicking. Default true.' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_window_type',
        description: 'Type text into a specific focused desktop window, then capture a fresh window screenshot. Use for live app UI input only, including explicitly requested social posts/messages. Do not use for passwords/payment data, file editing, shell commands, destructive submits, or account settings/security changes; hand those to Worker.',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            app_id: { type: 'string' },
            title: { type: 'string' },
            text: { type: 'string', description: 'Text to type into the target window.' },
            raw: { type: 'boolean', description: 'Use raw typing instead of clipboard paste. Default false.' },
            include_screenshot: { type: 'boolean', description: 'Capture a window screenshot preview after typing. Default true.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_window_press_key',
        description: 'Press a key in a specific focused desktop window, then capture a fresh window screenshot. If the user asks to press a key in an app/window, call this tool immediately instead of saying you will. Explicit user-authorized social posts/messages are allowed when pressing the key is the requested submit/send action. For destructive confirmations, installs, file operations, purchases/payments, or account settings/security changes, hand off to Worker.',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            app_id: { type: 'string' },
            title: { type: 'string' },
            key: { type: 'string', description: 'Key to press, e.g. Enter, Escape, Tab, ArrowDown, PageDown, Backspace.' },
            include_screenshot: { type: 'boolean', description: 'Capture a window screenshot preview after pressing the key. Default true.' },
          },
          required: ['key'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_desktop_window_scroll',
        description: 'Scroll inside a specific desktop window, then capture a fresh window screenshot. If the user asks to scroll an app/window, call this tool immediately instead of saying you will.',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            app_id: { type: 'string' },
            title: { type: 'string' },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction. Default down.' },
            amount: { type: 'number', description: 'Scroll amount multiplier. Default 1.' },
            x: { type: 'number', description: 'Optional x coordinate to move over before scrolling.' },
            y: { type: 'number', description: 'Optional y coordinate to move over before scrolling.' },
            coordinate_space: { type: 'string', enum: ['window', 'capture', 'monitor', 'virtual'], description: 'Coordinate space for x/y. Default window.' },
            screenshot_id: { type: 'string', description: 'Optional screenshot_id anchoring x/y.' },
            include_screenshot: { type: 'boolean', description: 'Capture a window screenshot preview after scrolling. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_automation_dashboard',
        description: 'Read-only voice wrapper around automation_dashboard v2. Use for "what is going on", "what are my priorities", "what have the agents done", operator snapshots, scheduled-job/task/watch/team status, and morning/daily automation summaries. Prefer this over Worker handoff for quick internal-state questions. This only reads automation state; use Worker for mutations/control.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max jobs/tasks/watches/events per section. Default 12 for voice, capped at 50.' },
            include_done: { type: 'boolean', description: 'Include completed/cancelled internal watches, not just active watches.' },
            depth: { type: 'string', enum: ['summary', 'full'], description: 'summary is compact; full includes more produced output/result text.' },
            agent_id: { type: 'string', description: 'Optional agent id to focus the snapshot.' },
            include: {
              type: 'array',
              items: { type: 'string', enum: ['agents', 'teams', 'outputs'] },
              description: 'Optional sections to include. Default is all.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_worker_status',
        description: 'Read the freshest Prometheus worker/run status and current context packet. Use for status/update/progress questions like "what are you doing", "where are we", "what happened", or "how is the worker going". This is read-only and must NOT steer or interrupt the worker.',
        parameters: {
          type: 'object',
          properties: {
            include_recent_events: { type: 'boolean', description: 'Include recent stream/process events. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },

    {
      type: 'function',
      function: {
        name: 'voice_send_screenshot',
        description: 'Capture or reuse a browser/desktop screenshot and deliver it through the origin-aware delivery router. Use only when the user asks to send, share, or show them a screenshot.',
        parameters: {
          type: 'object',
          required: ['source'],
          properties: {
            source: { type: 'string', enum: ['desktop_new', 'desktop_last', 'browser_new', 'browser_last'] },
            target: { type: 'string', enum: ['origin', 'mobile', 'telegram', 'web', 'all'], description: 'Default origin.' },
            caption: { type: 'string' },
            capture: { type: 'string', enum: ['all', 'primary'], description: 'Optional desktop capture mode when source is desktop_new.' },
            monitor_index: { type: 'number', description: 'Optional desktop monitor index when source is desktop_new.' },
            name: { type: 'string', description: 'Optional app/window title or process name to capture when source is desktop_new.' },
            handle: { type: 'number', description: 'Optional exact window handle to capture when source is desktop_new.' },
            active: { type: 'boolean', description: 'Capture the current active window when source is desktop_new.' },
            focus_first: { type: 'boolean', description: 'Focus the target window before capture. Default true for window screenshots.' },
            padding: { type: 'number', description: 'Extra pixels around a window screenshot. Default 8.' },
          },
          additionalProperties: false,
        },
      },
    },
    // ── Rich artifact cards (render a visual card in chat while you speak) ──────
    {
      type: 'function',
      function: {
        name: 'show_weather',
        description: 'Show a live weather forecast card (Open-Meteo, keyless) in chat and speak the gist. Use for weather/forecast questions. Pass a location name.',
        parameters: { type: 'object', properties: { location: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' }, unit: { type: 'string', enum: ['F', 'C'] }, days: { type: 'number' } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_market',
        description: 'Show a live crypto/memecoin price card (CoinGecko, keyless). Use for bitcoin/eth/memecoin prices. Pass tickers or CoinGecko ids.',
        parameters: { type: 'object', required: ['coins'], properties: { coins: { type: 'array', items: { type: 'string' } }, vs_currency: { type: 'string' }, sparkline: { type: 'boolean' } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_stocks',
        description: 'Show a live stock/ETF/index quote card (Yahoo Finance, keyless). Use for equity prices/watchlists. Pass ticker symbols.',
        parameters: { type: 'object', required: ['symbols'], properties: { symbols: { type: 'array', items: { type: 'string' } }, range: { type: 'string' } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_prediction_market',
        description: 'Show a Polymarket prediction-market card (keyless, read-only) with outcome probabilities. Use for "odds of X" / prediction-market questions. Pass a query.',
        parameters: { type: 'object', properties: { query: { type: 'string' }, slug: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_map',
        description: 'Show a map card (OpenStreetMap, keyless) with location markers. Use for local/place results. Markers take lat/lng or an address.',
        parameters: { type: 'object', required: ['markers'], properties: { title: { type: 'string' }, center: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, zoom: { type: 'number' }, markers: { type: 'array', items: { type: 'object', required: ['label'], properties: { label: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, address: { type: 'string' }, category: { type: 'string' }, rating: { type: 'number' }, url: { type: 'string' } } } } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_sources',
        description: 'Show a sources/news card from items you already gathered. Use to present articles/citations visually.',
        parameters: { type: 'object', required: ['items'], properties: { title: { type: 'string' }, layout: { type: 'string', enum: ['cards', 'list'] }, items: { type: 'array', items: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, publisher: { type: 'string' }, url: { type: 'string' }, imageUrl: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' }, badge: { type: 'string' } } } } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_comparison',
        description: 'Show a side-by-side comparison table you assemble. Use to compare options/products/plans.',
        parameters: { type: 'object', required: ['columns', 'rows'], properties: { title: { type: 'string' }, columns: { type: 'array', items: { type: 'object', required: ['key', 'label'], properties: { key: { type: 'string' }, label: { type: 'string' } } } }, rows: { type: 'array', items: { type: 'object' } }, labelKey: { type: 'string' }, highlightColumn: { type: 'string' } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_chart',
        description: 'Show a minimal native line/bar/area chart from numeric series you provide.',
        parameters: { type: 'object', required: ['series'], properties: { title: { type: 'string' }, chartType: { type: 'string', enum: ['line', 'bar', 'area'] }, series: { type: 'array', items: { type: 'object', required: ['points'], properties: { label: { type: 'string' }, color: { type: 'string' }, points: { type: 'array', items: { type: 'object', required: ['x', 'y'], properties: { x: {}, y: { type: 'number' } } } } } } }, xLabel: { type: 'string' }, yLabel: { type: 'string' }, unit: { type: 'string' } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_product_carousel',
        description: 'Show a product carousel card from product items you gathered (title + productUrl each).',
        parameters: { type: 'object', required: ['items'], properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'object', required: ['title', 'productUrl'], properties: { title: { type: 'string' }, price: { type: 'string' }, description: { type: 'string' }, rating: { type: 'number' }, reviews: { type: 'number' }, tag: { type: 'string' }, imageUrl: { type: 'string' }, productUrl: { type: 'string' }, merchant: { type: 'string' } } } } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_agent_work',
        description: 'Show an operator-snapshot card (greeting, summary rows, priorities, teams, active work). Prefer voice_automation_dashboard to GATHER the data first, then render it here.',
        parameters: { type: 'object', properties: { greeting: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' }, summaryRows: { type: 'array', items: { type: 'object', properties: { icon: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' } } } }, priorities: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, subtitle: { type: 'string' }, status: { type: 'string' }, taskId: { type: 'string' } } } }, teams: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, detail: { type: 'string' }, status: { type: 'string' } } } }, activeWork: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, status: { type: 'string' }, progressLabel: { type: 'string' }, taskId: { type: 'string' } } } } }, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_run_result',
        description: 'Show a finished-task result card (summary, files, links) you assemble.',
        parameters: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, taskId: { type: 'string' }, status: { type: 'string' }, summary: { type: 'string' }, files: { type: 'array', items: {} }, links: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, href: { type: 'string' } } } } }, additionalProperties: false },
      },
    },
    // ── Image & Video generation ─────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'voice_generate_image',
        description: 'Generate one or more raster images from a text prompt using OpenAI GPT image models or xAI Grok Imagine. Use background="transparent" and output_format="png" for true alpha transparency. For separate options/variations set count > 1. Supports reference images for editing/style transfer. Use when the user asks to generate, create, draw, or make an image/picture/photo. Hand off to Worker for creative canvas/HyperFrames/video timeline work.',
        parameters: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: 'Text prompt describing the image(s) to generate. For count > 1, specify each output should be a separate standalone image.' },
            reference_images: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 16,
              description: 'Optional reference images as local/workspace file paths, HTTPS URLs, or data URLs. Sent as actual image inputs for reference/edit generation.',
            },
            aspect_ratio: { type: 'string', enum: ['landscape', 'square', 'portrait'], description: 'Desired image aspect ratio.' },
            count: { type: 'integer', minimum: 1, maximum: 4, description: 'How many separate image outputs to generate (1-4). Use > 1 for options or variations.' },
            provider: { type: 'string', enum: ['auto', 'openai', 'openai_codex', 'xai'], description: 'Provider override. auto picks the best available. Use xai for Grok Imagine.' },
            model: { type: 'string', description: 'Optional model override, e.g. gpt-image-2-medium or grok-imagine-image-quality.' },
            background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: 'Background mode. Use transparent for real alpha; Prometheus also infers this when the prompt asks for a transparent/no background sprite or cutout.' },
            output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Output format. Transparency requires png or webp; png is used when transparent is requested.' },
            quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'], description: 'Image generation quality.' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory. Default: generated/images.' },
            save_to_workspace: { type: 'boolean', description: 'If false, keep the image only in Prometheus cache.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'voice_generate_video',
        description: 'Generate a short AI video (MP4) using xAI Grok Imagine Video or another configured provider. Supports text-to-video, image-to-video, reference-to-video, video editing, and video extension. Use when the user asks to generate, create, or make a video/clip/animation. Hand off to Worker for HyperFrames/timeline/multi-clip editing work.',
        parameters: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: 'Text prompt describing the video to generate, edit, or extend.' },
            image: { type: 'string', description: 'Optional source image path, URL, or data URL for image-to-video.' },
            reference_images: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 7,
              description: 'Optional reference images as local/workspace paths, HTTPS URLs, or data URLs for reference-to-video.',
            },
            video: { type: 'string', description: 'Optional source video path, URL, or data URL for edit/extend modes.' },
            mode: { type: 'string', enum: ['generate', 'edit', 'extend'], description: 'Video request mode. Defaults to generate, or edit when video is provided.' },
            aspect_ratio: { type: 'string', enum: ['landscape', 'square', 'portrait'], description: 'Desired video aspect ratio.' },
            duration: { type: 'number', minimum: 1, maximum: 15, description: 'Video duration in seconds. xAI supports 1-15 for generation, max 10 for reference/extension.' },
            resolution: { type: 'string', enum: ['480p', '720p'], description: 'Video resolution.' },
            provider: { type: 'string', enum: ['auto', 'xai'], description: 'Provider override. Default auto.' },
            model: { type: 'string', description: 'Optional video model override, e.g. grok-imagine-video.' },
            output_dir: { type: 'string', description: 'Optional workspace-relative output directory. Default: generated/videos.' },
            save_to_workspace: { type: 'boolean', description: 'If false, keep the video only in Prometheus cache.' },
          },
          additionalProperties: false,
        },
      },
    },
  ];
  return tools.filter((tool: any) => !VOICE_HIDDEN_COMPAT_TOOL_NAMES.has(String(tool?.function?.name || tool?.name || '')));
}

const VOICE_TASK_CONTROL_STATUSES = new Set(['queued', 'running', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'failed', 'waiting_subagent']);

function parseVoiceTaskIds(args: Record<string, any>): string[] {
  const ids = [
    String(args?.task_id || args?.taskId || args?.id || '').trim(),
    ...(Array.isArray(args?.task_ids) ? args.task_ids.map((id: any) => String(id || '').trim()) : []),
    ...(Array.isArray(args?.taskIds) ? args.taskIds.map((id: any) => String(id || '').trim()) : []),
  ].filter(Boolean);
  return Array.from(new Set(ids));
}

function selectVoiceTaskControlTargets(sessionId: string, args: Record<string, any>): TaskRecord[] {
  const action = String(args?.action || args?.task_action || args?.taskAction || 'status').trim().toLowerCase();
  const explicitTaskIds = parseVoiceTaskIds(args);
  if (explicitTaskIds.length) {
    return explicitTaskIds
      .map((id) => loadTask(id))
      .filter((task): task is TaskRecord => !!task);
  }

  const workgroupId = String(args?.workgroup_id || args?.workgroupId || '').trim();
  const workgroups = workgroupId
    ? [loadVoiceWorkgroup(workgroupId)].filter(Boolean)
    : listVoiceWorkgroupsForSession(sessionId)
        .filter((workgroup) => workgroup.workers.some((worker) => {
          const task = loadTask(worker.taskId);
          return task && VOICE_TASK_CONTROL_STATUSES.has(String(task.status || ''));
        }))
        .slice(0, String(args?.scope || '').trim() === 'all_voice_workgroups' ? 4 : 1);

  const fromWorkgroups = workgroups
    .flatMap((workgroup: any) => Array.isArray(workgroup?.workers) ? workgroup.workers : [])
    .map((worker: any) => loadTask(String(worker?.taskId || '')))
    .filter((task): task is TaskRecord => !!task);

  if (fromWorkgroups.length) {
    const unfinished = fromWorkgroups.filter((task) => VOICE_TASK_CONTROL_STATUSES.has(String(task.status || '')));
    return (action === 'status' ? fromWorkgroups : unfinished).slice(0, 8);
  }

  const fallback = listTasks()
    .filter((task) => (
      task.originatingSessionId === sessionId
      || task.sessionId === sessionId
      || String(task.sessionId || '').includes(sessionId)
    ))
    .filter((task) => action === 'status' || VOICE_TASK_CONTROL_STATUSES.has(String(task.status || '')))
    .sort((a, b) => Number(b.lastProgressAt || b.startedAt || 0) - Number(a.lastProgressAt || a.startedAt || 0));
  return fallback.slice(0, 3);
}

function summarizeVoiceTaskTargets(tasks: TaskRecord[]): any[] {
  return tasks.map((task) => ({
    task_id: task.id,
    title: task.title,
    status: task.status,
    pauseReason: task.pauseReason || '',
    currentStepIndex: task.currentStepIndex,
    totalSteps: Array.isArray(task.plan) ? task.plan.length : 0,
    currentStep: Array.isArray(task.plan) ? task.plan[Math.max(0, Number(task.currentStepIndex || 0))]?.description || '' : '',
    finalSummary: compactVoiceText(task.finalSummary || '', 500),
    workgroupId: task.voiceDispatch?.workgroupId || '',
  }));
}

async function executeVoiceTaskControl(sessionId: string, args: Record<string, any>): Promise<string> {
  const action = String(args?.action || args?.task_action || args?.taskAction || 'status').trim().toLowerCase();
  const normalizedAction = action === 'continue' || action === 'unpause' ? 'resume' : action;
  const message = String(args?.message || args?.note || args?.instruction || args?.guidance || '').trim();
  const targets = selectVoiceTaskControlTargets(sessionId, args);
  if (!targets.length) {
    return voiceToolResult(false, 'No matching task was found for voice task control.', {
      action: normalizedAction,
      requestedTaskIds: parseVoiceTaskIds(args),
      workgroupId: String(args?.workgroup_id || args?.workgroupId || '').trim(),
    });
  }

  if (normalizedAction === 'status') {
    return voiceToolResult(true, `Loaded ${targets.length} task${targets.length === 1 ? '' : 's'}.`, {
      action: normalizedAction,
      tasks: summarizeVoiceTaskTargets(targets),
    });
  }

  if (normalizedAction === 'message') {
    if (!message) return voiceToolResult(false, 'A message is required to steer or chat with paused tasks.');
    const resumeAfter = args?.resume_after_message === true || args?.resumeAfterMessage === true;
    const results: any[] = [];
    for (const task of targets) {
      const recovery = await handleTaskRecoveryMessage(task.id, message, {
        sourceSessionId: sessionId,
        source: 'chat',
        visibleMessage: message,
      });
      let control: any = null;
      if (!recovery.handled) {
        const existing = Array.isArray(task.resumeContext?.messages) ? task.resumeContext.messages : [];
        updateResumeContext(task.id, {
          messages: [
            ...existing,
            { role: 'user', content: `[VOICE TASK GUIDANCE]\n${message}`, timestamp: Date.now() },
          ].slice(-80),
        });
        appendJournal(task.id, { type: 'status_push', content: `Voice guidance added: ${message.slice(0, 220)}` });
      }
      if (resumeAfter) {
        control = await handleTaskControlAction(sessionId, { action: 'resume', task_id: task.id, note: message });
      }
      results.push({
        task_id: task.id,
        title: task.title,
        recoveryHandled: recovery.handled,
        resumed: recovery.resumed || control?.success === true,
        reply: compactVoiceText(recovery.reply || control?.message || 'Guidance recorded.', 900),
        control,
      });
    }
    return voiceToolResult(true, `${resumeAfter ? 'Sent guidance and resumed' : 'Sent guidance to'} ${results.length} task${results.length === 1 ? '' : 's'}.`, {
      action: normalizedAction,
      resumeAfter,
      results,
    });
  }

  if (!['resume', 'pause', 'rerun', 'cancel'].includes(normalizedAction)) {
    return voiceToolResult(false, `Unsupported voice task action: ${normalizedAction}`);
  }

  const results: any[] = [];
  for (const task of targets) {
    const control = await handleTaskControlAction(sessionId, {
      action: normalizedAction,
      task_id: task.id,
      note: message,
      ...(normalizedAction === 'cancel' ? { confirm: true } : {}),
    });
    results.push({
      task_id: task.id,
      title: task.title,
      ok: control.success === true,
      message: control.message || '',
      task: control.task || null,
    });
  }
  const okCount = results.filter((result) => result.ok).length;
  return voiceToolResult(okCount > 0, `${normalizedAction} applied to ${okCount}/${results.length} task${results.length === 1 ? '' : 's'}.`, {
    action: normalizedAction,
    results,
  });
}

async function executeVoiceAgentTool(sessionId: string, name: string, args: Record<string, any>): Promise<string> {
  const workspacePath = getConfig().getWorkspacePath();
  try {
    if (VOICE_SHOW_ARTIFACT_TOOLS.has(name)) {
      const built = await buildVoiceShowArtifact(name, args || {});
      return voiceToolResult(built.ok, built.summary, built.artifact ? { richArtifacts: [built.artifact] } : {});
    }
    if (name === 'voice_web_search') {
      const query = String(args.query || '').trim();
      if (!query) return voiceToolResult(false, 'Search query is required.');
      const mode = String(args.mode || 'auto').toLowerCase();
      const wantsMulti = mode === 'multi' || (mode === 'auto' && /\b(latest|current|today|news|compare|versus|vs|recent|breaking|price|stock|election|weather|recall|safety|law|legal|medical|financial)\b/i.test(query));
      const result = await executeWebSearch({
        query,
        max_results: Math.min(6, Math.max(2, Number(args.max_results || 4) || 4)),
        ...(wantsMulti ? { provider: 'multi' as const } : { multi_engine: false }),
      });
      return voiceToolResult(result.success !== false, result.success === false ? (result.error || 'Search failed.') : 'Search complete.', summarizeVoiceSearchResult(result));
    }
    if (name === 'voice_web_fetch') {
      const url = String(args.url || '').trim();
      if (!url) return voiceToolResult(false, 'URL is required.');
      if (isVoiceFetchEscalationUrl(url)) {
        return voiceToolResult(false, 'This URL needs Worker handling because it is social/video/media-heavy or may need browser/media analysis.', { escalateToWorker: true, url });
      }
      const result = await executeWebFetch({ url, max_chars: Math.min(6000, Math.max(1200, Number(args.max_chars || 4000) || 4000)) });
      const text = compactVoiceText(result?.stdout || result?.error || '', 2400);
      return voiceToolResult(result.success !== false, result.success === false ? (result.error || 'Fetch failed.') : 'Fetch complete.', { text, url });
    }
    if (name === 'voice_generate_image') {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) return voiceToolResult(false, 'Image prompt is required.');
      const result = await executeGenerateImage({
        prompt,
        reference_images: args.reference_images,
        aspect_ratio: args.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
        count: args.count != null ? Number(args.count) : undefined,
        provider: args.provider != null ? String(args.provider) : undefined,
        model: args.model != null ? String(args.model) : undefined,
        background: args.background != null ? String(args.background) : undefined,
        output_format: args.output_format != null ? String(args.output_format) : undefined,
        quality: args.quality != null ? String(args.quality) : undefined,
        output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
        save_to_workspace: args.save_to_workspace,
      });
      if (!result.success) return voiceToolResult(false, result.error || 'Image generation failed.');
      const d = result.data as any;
      const count = Number(d?.image_count || 1);
      return voiceToolResult(true, `Generated ${count} image${count === 1 ? '' : 's'} with ${d?.provider}/${d?.model}. Saved to ${d?.rel_path || d?.path}.`, {
        provider: d?.provider,
        model: d?.model,
        prompt: d?.prompt,
        image_count: count,
        background: d?.background,
        output_format: d?.output_format,
        path: d?.path,
        rel_path: d?.rel_path,
        file_name: d?.file_name,
        images: d?.images,
      });
    }
    if (name === 'voice_generate_video') {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) return voiceToolResult(false, 'Video prompt is required.');
      const result = await executeGenerateVideo({
        prompt,
        image: args.image != null ? String(args.image) : undefined,
        reference_images: args.reference_images,
        video: args.video != null ? String(args.video) : undefined,
        mode: args.mode != null ? String(args.mode) : undefined,
        aspect_ratio: args.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
        duration: args.duration != null ? Number(args.duration) : undefined,
        resolution: args.resolution != null ? String(args.resolution) : undefined,
        provider: args.provider != null ? String(args.provider) : undefined,
        model: args.model != null ? String(args.model) : undefined,
        output_dir: args.output_dir != null ? String(args.output_dir) : undefined,
        save_to_workspace: args.save_to_workspace,
      });
      if (!result.success) return voiceToolResult(false, result.error || 'Video generation failed.');
      const d = result.data as any;
      return voiceToolResult(true, `Generated video with ${d?.provider}/${d?.model}. Saved to ${d?.rel_path || d?.path}.`, {
        provider: d?.provider,
        model: d?.model,
        prompt: d?.prompt,
        mode: d?.mode,
        duration: d?.duration,
        resolution: d?.resolution,
        path: d?.path,
        rel_path: d?.rel_path,
        file_name: d?.file_name,
      });
    }
    if (name === 'voice_write_note') {
      const content = String(args.content || '').trim();
      if (/\bwake\s+(?:phrase|word)\b/i.test(content)) {
        return voiceToolResult(false, 'Wake phrase changes are runtime voice configuration. Use voice_set_wake_phrase instead of saving a note.', { runtimeAction: 'set_wake_phrase_required' });
      }
      if (!content) return voiceToolResult(false, 'Note content is required.');
      const result = await executeWriteNote({ content, tag: String(args.tag || 'voice').trim() || 'voice' });
      return voiceToolResult(result.success !== false, result.success === false ? (result.error || 'Note failed.') : 'Note saved.', { file: result.data?.file, tag: result.data?.tag });
    }
    if (name === 'voice_agent_memory') {
      const action = String(args.action || 'read').trim().toLowerCase();
      const maxChars = Math.min(12000, Math.max(800, Number(args.max_chars || args.maxChars || 5000) || 5000));
      const { filePath, content: currentContent } = readVoiceAgentMemoryFile(workspacePath);
      if (action === 'read') {
        const content = currentContent.length > maxChars ? `${currentContent.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n...[truncated]` : currentContent;
        return voiceToolResult(true, currentContent ? 'Voice agent memory loaded.' : 'Voice agent memory is empty.', {
          file: filePath,
          content,
          length: currentContent.length,
          truncated: currentContent.length > maxChars,
        });
      }
      if (action === 'append') {
        const entry = formatVoiceAgentMemoryAppend(args.content, args.category);
        if (!entry) return voiceToolResult(false, 'Content is required to append to voice agent memory.');
        const initial = currentContent.trim()
          ? currentContent.trimEnd()
          : '# Voice Agent Memory\n\nThese notes apply only to Prometheus in live voice and Realtime mode.\n';
        const nextContent = `${initial}\n${initial.endsWith('\n') ? '' : '\n'}${entry}\n`;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, nextContent, 'utf-8');
        invalidateVoiceAgentContextBlockCache(sessionId);
        return voiceToolResult(true, 'Voice agent memory updated live.', {
          file: filePath,
          action: 'append',
          appended: entry,
          content: nextContent.length > maxChars ? `${nextContent.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n...[truncated]` : nextContent,
          length: nextContent.length,
          truncated: nextContent.length > maxChars,
        });
      }
      if (action === 'replace') {
        const nextContent = String(args.content || '').trim();
        if (!nextContent) return voiceToolResult(false, 'Full replacement content is required.');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `${nextContent}\n`, 'utf-8');
        invalidateVoiceAgentContextBlockCache(sessionId);
        return voiceToolResult(true, 'Voice agent memory replaced live.', {
          file: filePath,
          action: 'replace',
          content: nextContent.length > maxChars ? `${nextContent.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n...[truncated]` : nextContent,
          length: nextContent.length,
          truncated: nextContent.length > maxChars,
        });
      }
      return voiceToolResult(false, 'voice_agent_memory action must be read, append, or replace.');
    }
    if (name === 'voice_set_wake_phrase') {
      const phrase = cleanVoiceWakePhrase(args.phrase);
      if (!phrase) return voiceToolResult(false, 'Wake phrase is required.');
      return voiceToolResult(true, `Wake phrase set to "${phrase}".`, {
        runtimeAction: 'set_wake_phrase',
        wakePhrase: phrase,
      });
    }
    if (name === 'voice_enter_quiet_mode') {
      return voiceToolResult(true, 'Quiet mode will turn on after this acknowledgement, using the current wake phrase.', {
        runtimeAction: 'enter_quiet_mode',
        activateAfterReply: true,
        requiresWakePhrase: true,
      });
    }
    if (name === 'voice_set_quiet_until') {
      const phrase = cleanVoiceWakePhrase(args.phrase);
      if (!phrase) return voiceToolResult(false, 'Wake phrase is required before quiet mode can start.');
      return voiceToolResult(true, `Quiet mode will turn on after this acknowledgement. Wake phrase set to "${phrase}".`, {
        runtimeAction: 'set_quiet_until',
        wakePhrase: phrase,
        activateAfterReply: true,
      });
    }
    if (name === 'skill_list' || name === 'voice_skill_lookup') {
      _skillsManager.scanSkills();
      const all = _skillsManager.getAll();
      const id = String(args.id || '').trim();
      const query = String(args.query || '').trim().toLowerCase();
      const explicitAll = !query || /\b(all|everything|every|list|show|available|installed|current(?:ly)?)\b/i.test(query);
      const limit = Math.min(80, Math.max(1, Number(args.limit || (explicitAll ? 40 : 20)) || (explicitAll ? 40 : 20)));
      const ranked = id
        ? all.filter((skill: any) => String(skill.id || '') === id).map((skill: any) => ({ skill, score: 0, confidence: 'strong' as const }))
        : explicitAll
          ? all.map((skill: any) => ({ skill, score: 0, confidence: 'strong' as const }))
          : rankSkillsForQuery(all, query);
      const candidates = ranked.map((item: any) => item.skill);
      const rankById = new Map(ranked.map((item: any) => [String(item.skill?.id || ''), item]));
      const skills: any[] = candidates.slice(0, limit).map((skill: any) => {
        const rank = rankById.get(String(skill.id || ''));
        return {
          ...summarizeVoiceSkill(skill),
          ...(query && !explicitAll ? { confidence: rank?.confidence, score: rank?.score } : {}),
        };
      });
      const truncated = candidates.length > skills.length;
      const summary = id
        ? (skills.length ? `Found skill "${skills[0].id}".` : `Skill "${id}" was not found.`)
        : candidates.length
          ? `Showing ${skills.length} of ${candidates.length} matching skill${candidates.length === 1 ? '' : 's'}; ${all.length} installed total.`
          : `No matching skills found; ${all.length} installed total.`;
      return voiceToolResult(true, summary, {
        skills,
        totalInstalled: all.length,
        matchedCount: candidates.length,
        returnedCount: skills.length,
        truncated,
        limit,
        note: truncated
          ? `This is a truncated result, not the complete skill list. Call skill_list again with limit up to 80 or a narrower query to see more.`
          : `This result is complete for the current query. Natural queries use weighted token/alias matching across skill metadata.`,
      });
    }
    if (name === 'skill_read' || name === 'voice_skill_read') {
      _skillsManager.scanSkillsIfStale?.();
      const skillId = String(args.id || args.skill_id || '').trim();
      if (!skillId) return voiceToolResult(false, 'Skill id is required.');
      const skill = _skillsManager.get(skillId);
      if (!skill) return voiceToolResult(false, `Skill "${skillId}" not found.`, { missing: true });
      const eligibility = String(skill?.eligibility?.status || skill.status || '').toLowerCase();
      const verdict = String(skill?.safety?.verdict || '').toLowerCase();
      if (eligibility === 'blocked' || skill.status === 'blocked' || verdict === 'critical') {
        return voiceToolResult(false, `Skill "${skill.id}" is blocked and cannot be loaded in Realtime voice.`, {
          skill: summarizeVoiceSkill(skill),
          safety: skill.safety,
          eligibility: skill.eligibility,
        });
      }
      activateSkillForSession(sessionId, skill.id);
      const maxChars = Math.min(12000, Math.max(1200, Number(args.max_chars || args.maxChars || VOICE_SKILL_INSTRUCTIONS_MAX_CHARS) || VOICE_SKILL_INSTRUCTIONS_MAX_CHARS));
      const resources = Array.isArray(skill.resources) ? skill.resources.slice(0, 16).map((resource: any) => ({
        path: resource.path,
        type: resource.type,
        description: compactVoiceText(resource.description || '', 180),
      })) : [];
      return voiceToolResult(true, `Loaded skill "${skill.name || skill.id}".`, {
        skill: summarizeVoiceSkill(skill),
        instructions: compactVoiceText(skill.instructions || '', maxChars),
        runtimeGuidance: buildVoiceSkillRuntimeGuidance(skill),
        resources,
        truncated: String(skill.instructions || '').length > maxChars,
      });
    }
    if (name === 'skill_resource_list') {
      _skillsManager.scanSkillsIfStale?.();
      const skillId = String(args.id || args.skill_id || '').trim();
      if (!skillId) return voiceToolResult(false, 'Skill id is required.');
      const skill = _skillsManager.get(skillId);
      if (!skill) return voiceToolResult(false, `Skill "${skillId}" not found.`);
      const resources = _skillsManager.listResources(skillId).slice(0, 40).map((resource: any) => ({
        path: resource.path,
        type: resource.type,
        description: compactVoiceText(resource.description || '', 180),
      }));
      return voiceToolResult(true, resources.length ? `Found ${resources.length} resource${resources.length === 1 ? '' : 's'} for "${skill.id}".` : `Skill "${skill.id}" has no resources.`, {
        id: skill.id,
        resources,
      });
    }
    if (name === 'skill_resource_read' || name === 'voice_skill_resource_read') {
      _skillsManager.scanSkillsIfStale?.();
      const skillId = String(args.id || args.skill_id || '').trim();
      const resourcePath = String(args.path || args.resource_path || '').trim();
      if (!skillId || !resourcePath) return voiceToolResult(false, 'Skill id and resource path are required.');
      const maxChars = Math.min(10000, Math.max(800, Number(args.max_chars || args.maxChars || VOICE_SKILL_RESOURCE_MAX_CHARS) || VOICE_SKILL_RESOURCE_MAX_CHARS));
      const result = _skillsManager.readResource(skillId, resourcePath, maxChars);
      if (!result.ok) return voiceToolResult(false, result.error || `Could not read ${skillId}/${resourcePath}.`);
      activateSkillForSession(sessionId, skillId);
      activateSkillResourceForSession(sessionId, skillId, result.path);
      return voiceToolResult(true, `Loaded skill resource ${skillId}/${result.path}.`, {
        id: skillId,
        path: result.path,
        content: result.content,
        truncated: result.truncated,
      });
    }
    if (name === 'voice_memory_search') {
      const readRecordId = String(args.read_record_id || args.record_id || '').trim();
      if (readRecordId) {
        const out = readMemoryRecord(workspacePath, readRecordId);
        return voiceToolResult(!!out.record, out.record ? 'Memory record read.' : `Memory record not found: ${readRecordId}`, { record: out.record ? compactVoiceText(JSON.stringify(out.record), 1800) : undefined });
      }
      const query = String(args.query || '').trim();
      if (!query) return voiceToolResult(false, 'Memory search query is required.');
      const modeRaw = String(args.mode || 'quick').trim().toLowerCase();
      const mode = (modeRaw === 'deep' || modeRaw === 'project' || modeRaw === 'timeline') ? modeRaw : 'quick';
      const out = await searchMemoryIndexAsync(workspacePath, {
        query,
        mode: mode as any,
        limit: Math.min(6, Math.max(2, Number(args.limit || 5) || 5)),
        rerank: true,
        queryRoute: 'voice_agent',
      });
      return voiceToolResult(true, 'Memory search complete.', summarizeVoiceMemorySearch(out));
    }
    if (name === 'voice_timer') {
      const action = String(args.action || '').trim().toLowerCase();
      if (action === 'list') {
        const timers = listMainChatTimers({ sessionId, includeDone: args.include_done === true });
        return voiceToolResult(true, timers.length ? `You have ${timers.length} timer${timers.length === 1 ? '' : 's'}.` : 'No active timers.', { timers: timers.slice(0, 8) });
      }
      if (action === 'cancel') {
        const timerId = String(args.timer_id || args.timerId || '').trim();
        if (!timerId) return voiceToolResult(false, 'Timer id is required to cancel.');
        const cancelled = cancelMainChatTimer(timerId);
        return voiceToolResult(!!cancelled, cancelled ? 'Timer cancelled.' : `Timer not found: ${timerId}`, { timer: cancelled || undefined });
      }
      if (action === 'update' || action === 'reschedule') {
        const timerId = String(args.timer_id || args.timerId || '').trim();
        if (!timerId) return voiceToolResult(false, 'Timer id is required to update.');
        const patch: Record<string, any> = {};
        if (args.instruction !== undefined) patch.instruction = String(args.instruction || '').trim();
        if (args.label !== undefined) patch.label = String(args.label || '').trim();
        const delay = Number(args.delay_seconds ?? args.delaySeconds);
        const dueAtRaw = String(args.due_at || args.dueAt || '').trim();
        if (Number.isFinite(delay) && delay > 0) patch.dueAt = new Date(Date.now() + Math.max(5, Math.floor(delay)) * 1000).toISOString();
        else if (dueAtRaw) {
          const due = new Date(dueAtRaw);
          if (Number.isFinite(due.getTime())) patch.dueAt = due.toISOString();
        }
        if (patch.dueAt) patch.status = 'pending';
        const updated = Object.keys(patch).length ? updateMainChatTimer(timerId, patch) : null;
        return voiceToolResult(!!updated, updated ? `Timer updated for ${new Date(updated.dueAt).toLocaleString()}.` : 'Timer update failed.', { timer: updated || undefined });
      }
      if (action === 'create') {
        const instruction = String(args.instruction || args.prompt || '').trim();
        if (!instruction) return voiceToolResult(false, 'Timer instruction is required.');
        const delay = Number(args.delay_seconds ?? args.delaySeconds);
        const dueAtRaw = String(args.due_at || args.dueAt || '').trim();
        let dueAt: Date | null = null;
        if (Number.isFinite(delay) && delay > 0) dueAt = new Date(Date.now() + Math.max(5, Math.floor(delay)) * 1000);
        else if (dueAtRaw) {
          const parsed = new Date(dueAtRaw);
          if (Number.isFinite(parsed.getTime())) dueAt = parsed;
        }
        if (!dueAt) return voiceToolResult(false, 'Timer needs delay_seconds or due_at.');
        const delivery = args.delivery && typeof args.delivery === 'object' ? args.delivery : {};
        const timer = createMainChatTimer({
          sessionId,
          instruction,
          dueAt,
          label: String(args.label || '').trim() || undefined,
          origin: { channel: 'voice', voiceMode: true },
          delivery: {
            origin: delivery.origin !== false,
            telegram: delivery.telegram === true,
            voiceIfActive: delivery.voice_if_active !== false,
          },
        } as any);
        return voiceToolResult(true, `Timer created for ${new Date(timer.dueAt).toLocaleString()}.`, { timer });
      }
    }
    if (name === 'voice_browser_screenshot') {
      const shot = await browserVisionScreenshot(sessionId);
      if (!shot?.base64) return voiceToolResult(false, 'No active browser session to capture. Use the Worker if the browser needs to be opened first.');
      broadcastVoiceScreenshotPreview(sessionId, 'browser', name, shot);
      return voiceToolResult(true, `Captured browser screenshot${Number.isFinite(shot.width) && Number.isFinite(shot.height) ? ` (${shot.width}x${shot.height})` : ''}.`, {
        width: shot.width,
        height: shot.height,
        mimeType: shot.mimeType,
      });
    }
    if (name === 'voice_browser_open') {
      const rawUrl = String(args.url || '').trim();
      const query = String(args.query || '').trim();
      let url = rawUrl;
      if (!url && query) {
        url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      } else if (url && /\s/.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i.test(url)) {
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      }
      if (!url) return voiceToolResult(false, 'URL or query is required.');
      const result = await browserOpen(sessionId, url, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      const openedUrl = (() => {
        try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
      })();
      return voiceToolResult(ok, ok ? `Opened ${query || rawUrl || openedUrl?.hostname || url}.` : result, {
        url,
        host: openedUrl?.hostname || '',
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_scroll') {
      const direction = String(args.direction || 'down').toLowerCase() === 'up' ? 'up' : 'down';
      const amount = Math.min(4, Math.max(0.5, Number(args.amount || args.multiplier || 1) || 1));
      const result = await browserScroll(sessionId, direction, amount, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? `Scrolled ${direction}.` : result, {
        direction,
        amount,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_snapshot') {
      const result = await browserSnapshot(sessionId);
      const ok = !/^ERROR:/i.test(String(result || ''));
      if (ok) await broadcastVoiceBrowserStatus(sessionId, name, null).catch(() => {});
      return voiceToolResult(ok, ok ? 'Browser snapshot captured.' : result, {
        observation: compactVoiceText(result, 8000),
      });
    }
    if (name === 'voice_browser_click') {
      const target = {
        ref: args.ref == null ? undefined : Number(args.ref),
        element: args.element == null && args.element_name == null ? undefined : String(args.element ?? args.element_name),
        selector: args.selector == null ? undefined : String(args.selector),
      };
      const result = await browserClick(sessionId, target, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser click complete.' : result, {
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_vision_click') {
      const x = Number(args.x);
      const y = Number(args.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return voiceToolResult(false, 'x and y are required.');
      const button = String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left';
      const result = await browserVisionClick(sessionId, x, y, button, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser vision click complete.' : result, {
        x,
        y,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_fill') {
      const text = String(args.text || '');
      if (!text) return voiceToolResult(false, 'Text is required.');
      const target = {
        ref: args.ref == null ? undefined : Number(args.ref),
        element: args.element == null && args.element_name == null ? undefined : String(args.element ?? args.element_name),
        selector: args.selector == null ? undefined : String(args.selector),
      };
      const result = await browserFill(sessionId, target, text, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser field filled.' : result, {
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_type') {
      const text = String(args.text || '');
      if (!text) return voiceToolResult(false, 'Text is required.');
      const result = await browserType(sessionId, text, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser typing complete.' : result, {
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_vision_type') {
      const x = Number(args.x);
      const y = Number(args.y);
      const text = String(args.text || '');
      if (!Number.isFinite(x) || !Number.isFinite(y) || !text) return voiceToolResult(false, 'x, y, and text are required.');
      const result = await browserVisionType(sessionId, x, y, text, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Browser vision typing complete.' : result, {
        x,
        y,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_press_key') {
      const key = String(args.key || '').trim();
      if (!key) return voiceToolResult(false, 'Key is required.');
      const result = await browserPressKey(sessionId, key, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? `Pressed ${key}.` : result, {
        key,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_browser_wait') {
      const ms = Math.min(5000, Math.max(100, Number(args.ms || args.wait_ms || 750) || 750));
      const result = await browserWait(sessionId, ms, { observe: 'snapshot' });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceBrowserObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? `Waited ${ms}ms.` : result, {
        ms,
        observation: compactVoiceText(result, 5000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_screenshot') {
      const hasWindowTarget = !!(
        String(args?.name || '').trim()
        || (Number.isFinite(Number(args?.handle)) && Number(args?.handle) > 0)
        || args?.active === true
      );
      const result = hasWindowTarget
        ? await desktopWindowScreenshot(sessionId, {
          name: args?.name == null ? undefined : String(args.name),
          handle: args?.handle == null ? undefined : Number(args.handle),
          active: args?.active === true,
          focus_first: args?.focus_first == null ? undefined : args.focus_first !== false,
          padding: args?.padding == null ? undefined : Number(args.padding),
          mode: String(args?.mode || '').toLowerCase() === 'som' || args?.som === true ? 'som' : 'normal',
          som: args?.som === true || String(args?.mode || '').toLowerCase() === 'som',
        })
        : await desktopScreenshotWithHistory(sessionId, parseDesktopScreenshotToolArgs((args && typeof args === 'object') ? args as any : undefined));
      const ok = !String(result || '').startsWith('ERROR');
      const packet = getDesktopAdvisorPacket(sessionId);
      if (ok && packet?.screenshotBase64) {
        broadcastVoiceScreenshotPreview(sessionId, 'desktop', name, {
          base64: packet.screenshotBase64,
          mimeType: packet.screenshotMime || 'image/png',
          width: packet.width,
          height: packet.height,
        });

      }
      const target = packet?.targetWindow;
      return voiceToolResult(ok, ok
        ? (target ? `Captured ${target.processName || 'window'} screenshot: ${target.title || 'untitled window'}.` : 'Captured desktop screenshot.')
        : result, ok && packet ? {
        screenshotId: packet.screenshotId,
        width: packet.width,
        height: packet.height,
        observation: compactVoiceText(result, 5000),
        targetWindow: target ? {
          title: target.title,
          processName: target.processName,
          handle: target.handle,
        } : undefined,
      } : {});
    }
    if (name === 'voice_desktop_click') {
      const clickTarget = {
        x: Number(args.x),
        y: Number(args.y),
        element: args.element == null ? undefined : Number(args.element),
        coordinate_space: args.coordinate_space as any,
        screenshot_id: args.screenshot_id == null && args.screenshotId == null ? undefined : String(args.screenshot_id ?? args.screenshotId),
        window_name: args.window_name == null && args.windowName == null ? undefined : String(args.window_name ?? args.windowName),
        window_handle: args.window_handle == null && args.windowHandle == null ? undefined : Number(args.window_handle ?? args.windowHandle),
        ...parseDesktopPointerMonitorArgs(args),
      };
      let resolved = await resolveDesktopActionPoint(sessionId, clickTarget, 'desktop_click');
      if (!resolved.ok && clickTarget.screenshot_id) {
        const msg = resolved.message;
        const isStale = msg.includes('is stale')
          || msg.includes('predates desktop action tracking')
          || /is \d+s old/.test(msg);
        if (isStale) {
          const oldPacket = getDesktopAdvisorPacketById(sessionId, clickTarget.screenshot_id);
          const freshCapture = oldPacket?.targetWindow
            ? await desktopWindowScreenshot(sessionId, {
              handle: oldPacket.targetWindow.handle,
              name: oldPacket.targetWindow.title,
              focus_first: true,
            }).catch(() => null)
            : await desktopScreenshotWithHistory(sessionId).catch(() => null);
          const freshIdMatch = String(freshCapture || '').match(/Screenshot ID:\s*(ds_[^\s.]+)/);
          const freshId = freshIdMatch ? freshIdMatch[1] : null;
          if (freshId) {
            const retryResolved = await resolveDesktopActionPoint(
              sessionId,
              { ...clickTarget, screenshot_id: freshId },
              'desktop_click',
            );
            if (retryResolved.ok) resolved = retryResolved;
          }
        }
      }
      let result = !resolved.ok
        ? `ERROR: ${resolved.message}`
        : await desktopClick(
          resolved.point.x,
          resolved.point.y,
          String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          args.double_click === true || args.doubleClick === true,
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
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopObservation(sessionId, name, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Desktop click complete.' : result, {
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_window_control') {
      const actionRaw = String(args.action || '').toLowerCase();
      const action = actionRaw === 'minimize' || actionRaw === 'maximize' || actionRaw === 'restore' || actionRaw === 'close'
        ? actionRaw
        : 'restore';
      const result = await desktopWindowControl(action, {
        name: args.name == null && args.title == null ? undefined : String(args.name ?? args.title),
        handle: args.handle == null && args.window_handle == null && args.windowHandle == null ? undefined : Number(args.handle ?? args.window_handle ?? args.windowHandle),
        active: args.active === true,
      });
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shouldCapture = ok
        && args.include_screenshot !== false
        && (action === 'maximize' || action === 'restore');
      const shotMeta = shouldCapture
        ? await captureVoiceDesktopWindowObservation(sessionId, name, {
          ...args,
          active: !args.name && !args.title && !args.handle && !args.window_handle && !args.windowHandle,
        }, true)
        : {};
      return voiceToolResult(ok, ok ? `Window ${action} complete.` : result, {
        action,
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_focus_window') {
      const windowName = String(args.name || '').trim();
      if (!windowName) return voiceToolResult(false, 'Window name is required.');
      const verification = await desktopFocusWindowVerified(sessionId, windowName, {
        includeScreenshot: args.include_screenshot !== false,
      });
      if (!verification.ok) return voiceToolResult(false, verification.message, { name: windowName });
      return voiceToolResult(true, verification.verification.summary, {
        name: windowName,
        verification: verification.verification,
      });
    }
    if (name === 'voice_desktop_launch_app') {
      const app = String(args.app || '').trim();
      const appId = String(args.app_id || args.appId || '').trim();
      if (!app && !appId) return voiceToolResult(false, 'App name or app_id is required.');
      const launchText = `${app} ${appId}`.trim();
      if (isVoiceBrowserLaunchText(launchText)) {
        return voiceToolResult(false, 'That is a browser/web request, not a desktop app launch. Use voice_browser_open for browser, Chrome, Edge, URLs, domains, pages, tabs, or search.', {
          useTool: 'voice_browser_open',
          suggestedArgs: /\b(?:browser|chrome|chromium|edge)\b/i.test(launchText) && !/\b(?:https?:\/\/|www\.|\.[a-z]{2,}\b|search|google|bing|duckduckgo)\b/i.test(launchText)
            ? { url: 'https://www.google.com', include_screenshot: true }
            : { query: launchText, include_screenshot: true },
        });
      }
      if (isDangerousVoiceLaunchText(launchText)) {
        return voiceToolResult(false, 'Refusing to launch installer/build-tool shortcuts from the voice desktop app launcher. Use Worker if an install or tooling setup is actually required.', {
          useTool: 'dispatch_prometheus_worker',
        });
      }
      const result = await desktopLaunchApp(app, '', Math.min(20000, Math.max(1000, Number(args.wait_ms || args.waitMs || 6000) || 6000)), appId);
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? result : result, {
        app,
        appId,
      });
    }
    if (name === 'voice_desktop_find_app') {
      const query = String(args.query || args.app || '').trim();
      if (!query) return voiceToolResult(false, 'App query is required.');
      const result = await desktopFindInstalledApp(query, Math.min(20, Math.max(1, Number(args.limit || 8) || 8)), args.refresh === true);
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? 'Desktop app lookup complete.' : result, {
        query,
        candidates: compactVoiceText(result, 5000),
      });
    }
    if (name === 'voice_desktop_list_windows') {
      const result = await desktopListWindowsCanonical({
        app_id: args.app_id == null && args.appId == null ? undefined : String(args.app_id ?? args.appId),
        process_name: args.process_name == null && args.processName == null ? undefined : String(args.process_name ?? args.processName),
        title: args.title == null ? undefined : String(args.title),
      });
      const ok = !/^ERROR:/i.test(String(result || ''));
      return voiceToolResult(ok, ok ? 'Desktop windows listed.' : result, {
        windows: compactVoiceText(result, 7000),
      });
    }
    if (name === 'voice_desktop_window_click') {
      const x = Number(args.x);
      const y = Number(args.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return voiceToolResult(false, 'x and y are required.');
      const selector = voiceDesktopWindowSelector(args);
      const result = await desktopWindowClick(
        selector,
        {
          x,
          y,
          coordinate_space: args.coordinate_space || args.coordinateSpace || 'window',
          screenshot_id: args.screenshot_id == null && args.screenshotId == null ? undefined : String(args.screenshot_id ?? args.screenshotId),
        } as any,
        {
          button: String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          double_click: args.double_click === true || args.doubleClick === true,
          modifier: args.modifier === 'shift' || args.modifier === 'ctrl' || args.modifier === 'alt'
            ? args.modifier
            : undefined,
          verify: args.verify,
        } as any,
        sessionId,
      );
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopWindowObservation(sessionId, name, args, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Desktop window click complete.' : result, {
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_window_type') {
      const text = String(args.text || '');
      if (!text) return voiceToolResult(false, 'Text is required.');
      const result = await desktopWindowType(voiceDesktopWindowSelector(args), text, args.raw === true);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopWindowObservation(sessionId, name, args, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? 'Desktop window typing complete.' : result, {
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_window_press_key') {
      const key = String(args.key || '').trim();
      if (!key) return voiceToolResult(false, 'Key is required.');
      const result = await desktopWindowPressKey(voiceDesktopWindowSelector(args), key);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopWindowObservation(sessionId, name, args, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? `Pressed ${key} in desktop window.` : result, {
        key,
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_desktop_window_scroll') {
      const directionRaw = String(args.direction || 'down').toLowerCase();
      const direction = (directionRaw === 'up' || directionRaw === 'left' || directionRaw === 'right') ? directionRaw : 'down';
      const result = await desktopWindowScroll(voiceDesktopWindowSelector(args), {
        direction,
        amount: Math.min(8, Math.max(0.25, Number(args.amount || 1) || 1)),
        x: args.x == null ? undefined : Number(args.x),
        y: args.y == null ? undefined : Number(args.y),
        coordinate_space: args.coordinate_space || args.coordinateSpace || 'window',
        screenshot_id: args.screenshot_id == null && args.screenshotId == null ? undefined : String(args.screenshot_id ?? args.screenshotId),
      } as any, sessionId);
      const ok = !/^ERROR:/i.test(String(result || ''));
      const shotMeta = ok ? await captureVoiceDesktopWindowObservation(sessionId, name, args, args.include_screenshot !== false) : {};
      return voiceToolResult(ok, ok ? `Scrolled ${direction} in desktop window.` : result, {
        direction,
        observation: compactVoiceText(result, 3000),
        ...shotMeta,
      });
    }
    if (name === 'voice_send_screenshot') {
      const delivered = await executeDeliverySendScreenshot({
        ...args,
        target: args?.target || 'origin',
      }, workspacePath, { telegramChannel: _telegramChannel, broadcastWS }, sessionId);
      return voiceToolResult(!delivered.error, delivered.result);
    }
    if (name === 'voice_automation_dashboard') {
      if (!_cronScheduler) return voiceToolResult(false, 'Automation scheduler is not ready yet.');
      const limit = Math.min(50, Math.max(1, Number(args.limit || 12) || 12));
      const depth = String(args.depth || 'summary').toLowerCase() === 'full' ? 'full' : 'summary';
      const raw = automationDashboardTool(_cronScheduler, {
        ...args,
        limit,
        depth,
      });
      const ok = raw.success !== false;
      const snapshot = raw.data || {};
      const summary = summarizeVoiceAutomationDashboard(snapshot);
      const jobsByHealth = summary.jobsByHealth && typeof summary.jobsByHealth === 'object'
        ? Object.entries(summary.jobsByHealth).map(([state, count]) => `${state}: ${count}`).join(', ')
        : '';
      const tasksByStatus = summary.tasksByStatus && typeof summary.tasksByStatus === 'object'
        ? Object.entries(summary.tasksByStatus).map(([status, count]) => `${status}: ${count}`).join(', ')
        : '';
      const spokenSummary = ok
        ? [
            `Automation snapshot loaded: ${summary.counts?.jobs ?? 0} jobs, ${summary.counts?.watches ?? 0} watches, ${summary.pendingEventCount ?? 0} pending events.`,
            jobsByHealth ? `Job health: ${jobsByHealth}.` : '',
            tasksByStatus ? `Tasks: ${tasksByStatus}.` : '',
            summary.attentionJobs?.length ? `${summary.attentionJobs.length} scheduled job(s) need attention.` : '',
            summary.activeTasks?.length ? `${summary.activeTasks.length} active task(s) are in flight.` : '',
          ].filter(Boolean).join(' ')
        : (raw.error || raw.message || 'Automation dashboard failed.');
      return voiceToolResult(ok, spokenSummary, {
        dashboardSummary: summary,
        dashboard: snapshot,
        message: raw.message || '',
        error: raw.error || '',
      });
    }
    if (name === 'voice_task_control') {
      return await executeVoiceTaskControl(sessionId, args || {});
    }
    if (name === 'voice_worker_status') {
      const providedPacket = args?.contextPacket && typeof args.contextPacket === 'object' ? args.contextPacket : null;
      const providedSessionId = String(providedPacket?.sessionId || '').trim();
      const providedAgeMs = Date.now() - Number(providedPacket?.createdAt || 0);
      const providedIsFreshActive = !!(
        providedPacket?.active === true
        && providedSessionId === sessionId
        && Number.isFinite(providedAgeMs)
        && providedAgeMs >= 0
        && providedAgeMs <= 45_000
      );
      const contextPacket = providedIsFreshActive
        ? providedPacket
        : buildVoiceWorkerContextPacket(sessionId, { source: 'voice_worker_status_tool', voiceTarget: args?.voiceTarget });
      const recentEvents = args?.include_recent_events === false ? [] : contextPacket.recentEvents;
      const processEntries = args?.include_recent_events === false ? [] : contextPacket.processEntries;
      const active = contextPacket.active === true;
      const summary = contextPacket.summary
        ? String(contextPacket.summary)
        : active
          ? 'A Prometheus worker is active, but it has not published a detailed status yet.'
          : 'No Prometheus worker is currently active for this chat.';
      return voiceToolResult(true, active ? 'Worker status loaded.' : 'No active worker.', {
        active,
        summary: compactVoiceText(summary, 1600),
        currentGoal: contextPacket.currentGoal || '',
        currentPhase: contextPacket.currentPhase || '',
        activeToolName: contextPacket.activeToolName || '',
        activeToolLabel: contextPacket.activeToolLabel || '',
        pendingSteerCount: contextPacket.pendingSteerCount || 0,
        target: contextPacket.target || null,
        thread: contextPacket.thread || null,
        activeRun: contextPacket.activeRun || null,
        trigger: contextPacket.trigger || null,
        doneAlready: contextPacket.doneAlready || [],
        currentlyDoing: contextPacket.currentlyDoing || '',
        observations: contextPacket.observations || null,
        recentEvents,
        processEntries,
        contextPacketId: contextPacket.id,
        createdAt: contextPacket.createdAt,
      });
    }


  } catch (err: any) {
    return voiceToolResult(false, `${friendlyVoiceToolName(name)} failed: ${String(err?.message || err)}`);
  }
  return voiceToolResult(false, `Unknown voice tool: ${name}`);
}

function parseVoiceToolResult(raw: string): any {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const voiceAutomationSkillScoutCache = new Map<string, { query: string; ts: number }>();
const VOICE_AUTOMATION_SKILL_SCOUT_CACHE_MS = 120000;

function isVoiceBrowserDesktopAutomationTool(toolName: string): boolean {
  const name = String(toolName || '').trim();
  return /^voice_(?:browser|desktop)_/.test(name);
}

function isDirectVoiceUiControlTool(toolName: string): boolean {
  return [
    'voice_browser',
    'voice_desktop',
    'voice_browser_open',
    'voice_browser_snapshot',
    'voice_browser_screenshot',
    'voice_browser_click',
    'voice_browser_vision_click',
    'voice_browser_fill',
    'voice_browser_type',
    'voice_browser_vision_type',
    'voice_browser_press_key',
    'voice_browser_scroll',
    'voice_browser_wait',
    'voice_desktop_screenshot',
    'voice_desktop_click',
    'voice_desktop_window_control',
    'voice_desktop_list_windows',
    'voice_desktop_focus_window',
    'voice_desktop_find_app',
    'voice_desktop_launch_app',
    'voice_desktop_window_click',
    'voice_desktop_window_type',
    'voice_desktop_window_press_key',
    'voice_desktop_window_scroll',
  ].includes(String(toolName || '').trim());
}

function isVoiceRuntimeControlTool(toolName: string): boolean {
  return [
    'voice_set_wake_phrase',
    'voice_enter_quiet_mode',
    'voice_set_quiet_until',
  ].includes(String(toolName || '').trim());
}

async function runVoiceAutomationSkillScout(
  sessionId: string,
  transcript: string,
  toolName: string,
  trace?: VoiceAgentProcessEntry[],
  seen?: Set<string>,
): Promise<void> {
  if (!isVoiceBrowserDesktopAutomationTool(toolName)) return;
  if (isDirectVoiceUiControlTool(toolName)) return;
  const request = compactVoiceText(String(transcript || '').trim(), 500);
  if (!request) return;
  const key = `${sessionId || 'voice'}:${toolName}:${request.toLowerCase()}`;
  if (seen?.has(key)) return;
  seen?.add(key);
  const cacheKey = String(sessionId || 'voice').trim() || 'voice';
  const cached = voiceAutomationSkillScoutCache.get(cacheKey);
  if (cached && cached.query === request && Date.now() - cached.ts < VOICE_AUTOMATION_SKILL_SCOUT_CACHE_MS) return;
  voiceAutomationSkillScoutCache.set(cacheKey, { query: request, ts: Date.now() });
  pushVoiceAgentProcessEntry(trace, 'skill', 'Skill scout before voice browser/desktop automation...', {
    actor: 'Voice Agent',
    tool: toolName,
    query: request,
  });
  const listRaw = await executeVoiceAgentToolWithTrace(sessionId, 'skill_list', { query: request, limit: 12 }, trace);
  const listResult = parseVoiceToolResult(listRaw);
  if (listResult?.ok === false) return;
  const skills = Array.isArray(listResult?.skills) ? listResult.skills : [];
  const first = skills.find((skill: any) => String(skill?.id || '').trim());
  if (!first?.id || Number(listResult?.matchedCount || skills.length || 0) <= 0) return;
  await executeVoiceAgentToolWithTrace(sessionId, 'skill_read', { id: String(first.id), max_chars: VOICE_SKILL_INSTRUCTIONS_MAX_CHARS }, trace);
}

function extractFirstVoiceUrl(text: string): string {
  return String(text || '').match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/g, '') || '';

}

function isVoiceBrowserLaunchText(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  return /\b(?:https?:\/\/|www\.|\.com\b|\.org\b|\.net\b|\.io\b|\.dev\b|website|web\s*site|browser|chrome|chromium|edge|url|page|tab|search\s+(?:for|web)|google|bing|duckduckgo)\b/i.test(text);
}

function isDangerousVoiceLaunchText(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  return /\b(?:install\s+additional\s+tools|native\s+modules?|node-gyp|visual\s+studio\s+build\s+tools|windows\s+build\s+tools|chocolatey)\b/i.test(text);
}

function extractVoiceLaunchAppName(text: string): string {
  const quoted = String(text || '').match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/);
  if (quoted?.[1]) return compactVoiceText(quoted[1].trim(), 80);
  const match = String(text || '').match(/\b(?:open|launch|start)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application))?(?:\s+(?:right now|now|please))?$/i);
  let candidate = String(match?.[1] || '').trim();
  candidate = candidate.replace(/\b(?:right now|now|please|app|application)\b/ig, ' ');
  candidate = candidate.replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
  return compactVoiceText(candidate, 80);
}

function cleanVoiceSearchFallbackQuery(text: string): string {
  let value = String(text || '').trim();
  value = value.replace(/https?:\/\/[^\s"'<>]+/ig, ' ');
  value = value.replace(/\b(?:don't|do not|dont)\s+(?:hand|send|pass)\s+(?:it\s+)?(?:off|over)?\s*(?:to\s+)?(?:the\s+)?worker\b/ig, ' ');
  value = value.replace(/\bwithout\s+(?:the\s+)?worker\b/ig, ' ');
  value = value.replace(/\bas\s+(?:a\s+)?voice\s+agent\b/ig, ' ');
  value = value.replace(/\b(?:can you|could you|please|go ahead and|test out|try out|your new|new|features?|web search|search feature|voice agent)\b/ig, ' ');
  value = value.replace(/\b(?:look up|search for|search|find|tell me about)\b/ig, ' ');
  value = value.replace(/[^\w\s'"-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value || /^(?:test|smoke test|quick test|it|that|this)$/i.test(value)) return 'OpenAI Realtime API voice tools';
  return compactVoiceText(value, 180);
}

function extractVoiceScreenshotWindowName(transcript: string): string {
  const text = String(transcript || '').trim();
  if (!text || /\b(browser|chrome|tab|page|website|site)\b/i.test(text)) return '';
  const quoted = text.match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/);
  if (quoted?.[1]) return compactVoiceText(quoted[1].trim(), 80);
  const patterns = [
    /\b(?:send|share|show|deliver)\s+(?:me\s+)?(?:a\s+)?(?:screenshot|screen\s*shot|screen grab|screengrab|capture)\s+(?:of|from)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|window))?(?:\s+(?:right now|now|please))?$/i,
    /\b(?:screenshot|screen\s*shot|screen grab|screengrab|capture)\s+(?:of|from)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|window))?(?:\s+(?:right now|now|please))?$/i,
    /\b(?:of|from)\s+(?:the\s+)?(.+?)\s+(?:app|application|window)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    let candidate = String(match?.[1] || '').trim();
    candidate = candidate.replace(/\b(?:right now|now|please|app|application|window|desktop|screen|monitor|computer|pc)\b/ig, ' ');
    candidate = candidate.replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (candidate && !/^(?:the|my|a|an|entire|whole|full|current|active)$/i.test(candidate)) {
      return compactVoiceText(candidate, 80);
    }
  }
  if (/\bactive\s+(?:app|application|window)\b|\bcurrent\s+(?:app|application|window)\b/i.test(text)) return '__active__';
  return '';
}

function findVoiceToolFallbackRequest(transcript: string): { name: string; args: Record<string, any> } | null {
  const text = String(transcript || '').trim();
  const lower = text.toLowerCase();
  if (!text) return null;
  const wakePhraseMatch = text.match(/\b(?:set|change|make)\s+(?:my\s+|the\s+)?wake\s+(?:phrase|word)\s+(?:to|as)\s+(.+)$/i)
    || text.match(/\b(?:my\s+|the\s+)?wake\s+(?:phrase|word)\s+(?:is|should\s+be)\s+(.+)$/i);
  if (wakePhraseMatch) {
    const phrase = cleanVoiceWakePhrase(wakePhraseMatch[1] || '');
    if (phrase) return { name: 'voice_set_wake_phrase', args: { phrase } };
  }
  const quietUntilMatch = text.match(/\b(?:don't|do not|dont|stop|quit|avoid|hold off on|stay|remain|keep|be)\s+(?:talking|speaking|responding|answering|replying|listening|saying anything|active|awake|quiet)?[\s,]*(?:until|unless)\s+(?:i\s+)?(?:say|tell you|use)\s+(.+)$/i)
    || text.match(/\b(?:be|go|stay|remain|keep)\s+quiet\s+(?:until|unless)\s+(?:i\s+)?(?:say|tell you|use)\s+(.+)$/i)
    || text.match(/\b(?:don't|do not|dont)\s+say\s+anything\s+(?:until|unless)\s+(?:i\s+)?(?:say|tell you|use)\s+(.+)$/i);
  if (quietUntilMatch) {
    const phrase = cleanVoiceWakePhrase(quietUntilMatch[1] || '');
    if (phrase) return { name: 'voice_set_quiet_until', args: { phrase } };
  }
  const mentionsQuietAsExample = /\b(?:if|when|example|debug|debugging|test|testing|phrase|called|means|about|talk(?:ing)? about|say(?:ing)? something like)\b/i.test(text);
  const endsWithQuietRequest = /(?:^|(?:,|;|\band\b|\bthen\b)\s+)(?:now\s+)?(?:please\s+)?(?:prometheus\s+quiet|quiet\s+prometheus|prometheus\s+(?:be\s+quiet|go\s+quiet|sleep|stop\s+listening)|be\s+quiet|go\s+quiet|stay\s+quiet)$/i.test(lower);
  if (endsWithQuietRequest && !mentionsQuietAsExample) {
    return { name: 'voice_enter_quiet_mode', args: { reason: 'User asked Prometheus to go quiet at the end of a voice turn.' } };
  }
  if (/\b(?:automation|operator|agent|agents?|task|tasks?|schedule|scheduled|jobs?|priorit(?:y|ies)|what'?s going on|morning|daily)\b/i.test(text)
    && /\b(?:dashboard|snapshot|status|overview|summary|priorit(?:y|ies)|what'?s going on|what has everyone done|what are.*doing|running|active|stuck|blocked)\b/i.test(text)) {
    return {
      name: 'voice_automation_dashboard',
      args: {
        limit: /\b(full|deep|detail|detailed|everything|all)\b/i.test(text) ? 25 : 12,
        depth: /\b(full|deep|detail|detailed|everything|all)\b/i.test(text) ? 'full' : 'summary',
        include_done: /\b(done|completed|finished|cancelled|canceled|history|all)\b/i.test(text),
      },
    };
  }
  if (/\b(?:scroll|move)\s+(?:the\s+)?(?:browser|page|website|site|tab)?\s*(up|down)\b/i.test(text)) {
    const dir = (text.match(/\b(up|down)\b/i)?.[1] || 'down').toLowerCase();
    return { name: 'voice_browser_scroll', args: { direction: dir === 'up' ? 'up' : 'down', include_screenshot: true } };
  }
  if (/\b(?:focus|bring up|switch to)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|window))?(?:\s+(?:right now|now|please))?$/i.test(text)) {
    const quoted = text.match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/);
    const focusMatch = text.match(/\b(?:focus|bring up|switch to)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|window))?(?:\s+(?:right now|now|please))?$/i);
    const target = compactVoiceText(String(quoted?.[1] || focusMatch?.[1] || '').replace(/\b(?:app|application|window|right now|now|please)\b/ig, ' ').replace(/\s+/g, ' ').trim(), 80);
    if (target && target !== '__active__') return { name: 'voice_desktop_focus_window', args: { name: target } };
  }
  const browserOpenUrl = /\b(?:open|launch|start|pull up|go to)\b/i.test(text)
    ? extractFirstVoiceUrl(text)
    : '';
  if (browserOpenUrl) {
    return { name: 'voice_browser_open', args: { url: browserOpenUrl, include_screenshot: true } };
  }
  if (/\b(?:open|launch|start|pull up|bring up)\s+(?:the\s+)?(?:browser|chrome|chromium|edge)(?:\s+(?:right now|now|please))?$/i.test(text)) {
    return { name: 'voice_browser_open', args: { url: 'https://www.google.com', include_screenshot: true } };
  }
  if (/\b(?:open|launch|start)\b/i.test(text) && /\b(?:app|application)\b/i.test(text) && !/\b(?:browser|chrome|website|site|url|page|tab)\b/i.test(text)) {
    const app = extractVoiceLaunchAppName(text);
    if (app) return { name: 'voice_desktop_launch_app', args: { app } };
  }
  const wantsSendScreenshot = /\b(send|share|show|deliver)\b/i.test(text) && /\b(screenshot|screen\s*shot|screen grab|screengrab|capture)\b/i.test(text);
  const wantsScreenshot = /\b(screenshot|screen\s*shot|screen grab|screengrab|capture)\b/i.test(text);
  if (wantsSendScreenshot || wantsScreenshot) {
    const browser = /\b(browser|chrome|tab|page|website|site)\b/i.test(text);
    const desktop = /\b(desktop|screen|monitor|computer|pc)\b/i.test(text) || !browser;
    const windowName = extractVoiceScreenshotWindowName(text);
    const windowArgs = windowName
      ? (windowName === '__active__' ? { active: true } : { name: windowName })
      : {};
    const source = browser ? (wantsSendScreenshot ? 'browser_new' : '') : (wantsSendScreenshot ? 'desktop_new' : '');
    if (wantsSendScreenshot) {
      return {
        name: 'voice_send_screenshot',
        args: {
          source: source || (desktop ? 'desktop_new' : 'browser_new'),
          target: /\btelegram\b/i.test(text) ? 'telegram' : /\bmobile|phone\b/i.test(text) ? 'mobile' : 'origin',
          caption: browser ? 'Browser screenshot' : (windowName && windowName !== '__active__' ? `${windowName} screenshot` : 'Desktop screenshot'),
          ...windowArgs,
        },
      };
    }
    return browser
      ? { name: 'voice_browser_screenshot', args: { include_summary: true } }
      : { name: 'voice_desktop_screenshot', args: { capture: /\bprimary|main screen\b/i.test(text) ? 'primary' : 'all', include_summary: true, ...windowArgs } };
  }

  const url = extractFirstVoiceUrl(text);
  if (url && /\b(fetch|read|open|summari[sz]e|check)\b/i.test(text)) {
    return { name: 'voice_web_fetch', args: { url, max_chars: 4000 } };
  }
  // Web search — only match explicit imperative search phrases, never bare nouns like
  // "current", "news", "latest" which appear in everyday conversation.
  const searchVerbMatch = text.match(/\b(?:web\s+)?search\s+(?:the\s+(?:web|internet)\s+)?(?:for\s+)?(.+)$/i)
    || text.match(/\blook\s+up\s+(.+)$/i)
    || text.match(/\bgoogle\s+(.+)$/i)
    || text.match(/\bsearch\s+(?:everywhere|the\s+(?:web|internet))\s+(?:for\s+)?(.+)$/i)
    || text.match(/\bfind\s+(?:out\s+)?(?:info(?:rmation)?\s+(?:on|about)\s+|info\s+on\s+)(.+)$/i);
  if (searchVerbMatch) {
    const rawQuery = (searchVerbMatch[1] || text).trim();
    const query = cleanVoiceSearchFallbackQuery(rawQuery);
    const mode = /\b(compare|versus|vs|search everywhere)\b/i.test(text) ? 'multi' : 'single';
    return {
      name: 'voice_web_search',
      args: {
        query,
        mode,
        max_results: mode === 'multi' ? 5 : 3,
      },
    };
  }
  if (/\b(?:voice\s+agent|voiceagent|realtime\s+voice|live\s+voice)\b/i.test(text) && /\b(?:memory|remember|note|rule|routing|behavior|behaviour|always|prefer|use|update|add|change|view|show|read)\b/i.test(text)) {
    if (/\b(?:view|show|read|what(?:'s| is)?\s+in)\b/i.test(text) && !/\b(?:add|append|remember|note|write|change|update|replace)\b/i.test(text)) {
      return { name: 'voice_agent_memory', args: { action: 'read' } };
    }
    const content = text.replace(/^(?:prometheus[, ]*)?(?:please\s*)?(?:remember|jot down|make a note(?: that)?|write down|log that|save a note(?: that)?|add|update)\s*/i, '').trim();
    return { name: 'voice_agent_memory', args: { action: 'append', content: content || text, category: 'voice' } };
  }
  if (/\b(remember|jot|note|write down|log that|save a note|make a note)\b/i.test(text)) {
    if (/\bwake\s+(?:phrase|word)\b/i.test(text)) return null;
    const content = text.replace(/^(?:prometheus[, ]*)?(?:please\s*)?(?:remember|jot down|make a note(?: that)?|write down|log that|save a note(?: that)?)\s*/i, '').trim();
    return { name: 'voice_write_note', args: { content: content || text, tag: 'voice' } };
  }
  if (/\b(skill|workflow|playbook|guidance)\b/i.test(text)) {
    return { name: 'skill_list', args: { query: text, limit: 40 } };
  }
  if (/\b(what did we decide|what did i say|last time|previously|do you remember|memory|recall)\b/i.test(text)) {
    return { name: 'voice_memory_search', args: { query: text, mode: 'quick', limit: 5 } };
  }
  const minuteMatch = text.match(/\bin\s+(\d{1,4})\s*(seconds?|minutes?|hours?)\b/i);
  if (/\b(timer|remind|reminder|in \d{1,4} (?:seconds?|minutes?|hours?))\b/i.test(text) && minuteMatch) {
    const amount = Math.max(1, Number(minuteMatch[1]) || 1);
    const unit = minuteMatch[2].toLowerCase();
    const multiplier = unit.startsWith('hour') ? 3600 : unit.startsWith('minute') ? 60 : 1;
    const instruction = text.replace(minuteMatch[0], '').replace(/\b(?:set|create)?\s*(?:a\s*)?(?:timer|reminder|remind me)\b/ig, '').trim() || text;
    return {
      name: 'voice_timer',
      args: {
        action: 'create',
        delay_seconds: amount * multiplier,
        instruction,
        delivery: {
          origin: true,
          voice_if_active: true,
          telegram: /\btelegram\b/i.test(text),
        },
      },
    };
  }
  return null;
}

function safeParseVoiceAgentJson(raw: string): any | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const candidates = [
    text,
    text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
    (text.match(/\{[\s\S]*\}/)?.[0] || '').trim(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function normalizeVoiceAgentDecision(raw: any, fallback: VoiceAgentDecision): VoiceAgentDecision {
  const allowed = new Set<VoiceAgentAction>(['answer_now', 'steer_worker', 'interrupt_worker', 'handoff_new_work', 'no_reply']);
  const action = allowed.has(String(raw?.action || '') as VoiceAgentAction)
    ? String(raw.action) as VoiceAgentAction
    : fallback.action;
  return {
    action,
    spokenReply: compactVoiceText(raw?.spokenReply || raw?.voiceReply || fallback.spokenReply || '', 900),
    workerInstruction: compactVoiceText(raw?.workerInstruction || raw?.worker_instruction || fallback.workerInstruction || '', 1400),
    needsWorkerResponse: raw?.needsWorkerResponse === true || raw?.needs_worker_response === true || fallback.needsWorkerResponse === true,
    reason: compactVoiceText(raw?.reason || fallback.reason || '', 500),
  };
}

function buildVoiceAgentSystemPrompt(contextBlock: string, contextPacket: Record<string, any>, voiceTarget?: VoiceAgentTargetContext): string {
  const identity = voiceAgentTargetIdentity(voiceTarget);
  return [
    identity.identityLine,
    '',
    identity.roleLine,
    'You are the live voice layer and you MAY call the provided voice_* tools plus canonical read-only skill_* tools directly.',
    'The voice_* tools are safe wrappers around existing Prometheus tools, and skill_* tools are the normal Prometheus skill list/read/resource tools. Those provided tools are the only tools you may use from this layer.',
    'Do not say web search, fetch, notes, memory search, skill list/read, timers, or screenshot capture/delivery are only available to the Worker when a matching voice_* or skill_* tool is provided.',
    'Use compact voice wrapper tools for fast conversational support and live browser/desktop UI control. Realtime voice may open, observe, click, type, fill, press keys, focus windows, launch apps, scroll, and complete explicit user-authorized social posts/messages through voice_browser and voice_desktop when the content and destination are clear. Use voice_ops for quick search/fetch, notes, memory, timers, runtime voice settings, screenshot delivery, operator status, and simple image/video generation. If the request needs files, shell/run commands, source editing, MCP/connectors, downloads/uploads, coding, long research, media processing, approvals, credentials, purchases/payments, account settings/security changes, deletes, installs, destructive actions, or durable system changes, choose handoff_new_work or steer_worker instead.',
    '',
    'When the user asks something answerable from your context, answer directly.',
    'When the user asks for current Worker status/progress/context, call voice_ops with action worker_status and answer from the returned live packet; never steer the Worker just to ask it for status.',
    'When the user requests work that can be handled by a voice_* or skill_* tool, call that tool and answer_now from the result.',
    'Skill scout rule for voice: use skill_list for multi-step workflows or unfamiliar app/site procedures. Do NOT run skill scout for direct live UI control like open, screenshot, click, scroll, press key, type, focus, maximize, minimize, restore, or close; call voice_browser or voice_desktop immediately.',
    identity.handoffLine,
    'When the user interrupts an active worker, decide whether to answer, steer, interrupt, hand off new work, or stay quiet. A normal status question or casual comment is not a steer.',
    '',
    'Hard boundary: never claim you used full Worker tools or changed files/accounts from the voice layer. You may truthfully say you searched, fetched, saved a note, checked memory, listed/read skills, or set a timer when a matching voice_* or skill_* tool result confirms it.',
    `Speak like ${identity.speakerName}: warm, specific, alive, and context-aware. Avoid generic acknowledgements like "I\'ll get started on that" unless no better context exists.`,
    identity.isSubagent ? `If you need to acknowledge heavier work, say it as ${identity.speakerName}'s own action, such as "I am on it" or "I will handle that." Never say "I will get the worker" or "I will ask Prometheus."` : '',
    'For voice tests, first messages, and no-context check-ins, do not answer with generic "I am here" or "I\'m here" phrasing. Acknowledge what the user is testing or saying.',
    '',
    'Return ONLY strict JSON. CRITICAL: The "spokenReply" field MUST be the FIRST field in your JSON output so audio playback can begin as you write. Do NOT output any other field before spokenReply. Use this exact field order:',
    '{"spokenReply":"string","action":"answer_now|steer_worker|interrupt_worker|handoff_new_work|no_reply","workerInstruction":"string optional","needsWorkerResponse":false,"reason":"string optional"}',
    '',
    '- answer_now: use when the user asks a status/context/question answerable from the injected context or from voice_* or skill_* tool results. Do not dispatch or steer the worker.',
    '- steer_worker: use only when there is an active worker and the user changes direction, adds a constraint, corrects the task, or explicitly asks the worker to do something within the active run. Do not use for status/update questions.',
    '- interrupt_worker: use only for explicit cancel/stop/abort intent.',
    '- handoff_new_work: use when the user asks for new work that requires tools outside voice_* and skill_*, files, non-voice browser/desktop capabilities, coding, media/account actions, or long reasoning and there is no active worker to steer.',
    '- no_reply: use only when the transcript is empty, duplicate, or just says continue/resume without needing speech.',
    '',
    'Voice tool rules:',
    '- voice_ops: unified quick voice operations. Use action web_search for quick factual/current lookup; web_fetch for one clean text URL; write_note for explicit remember/jot/log/save-note requests; agent_memory for workspace/VOICEAGENT.md routing/spoken-behavior notes with memory_action read/append/replace; set_wake_phrase, enter_quiet_mode, or set_quiet_until for runtime voice settings; memory_search for read-only recall; timer for one-shot timers with timer_action create/list/update/reschedule/cancel; automation_dashboard for operator snapshots; worker_status for Worker progress; send_screenshot for screenshot delivery; generate_image/generate_video for simple media generation. Social/video/media/auth fetches and durable work go to Worker.',
    '- Quiet-mode intent must be a real instruction. Do not call quiet tools for mentions, examples, debugging, or questions about the words "quiet" or "Prometheus".',
    '- When a quiet tool succeeds, give one natural acknowledgement in spokenReply. The runtime will activate quiet mode after the acknowledgement finishes.',
    '- skill_list: canonical skill discovery. Use it to orient yourself with available workflows and triggers for multi-step or unfamiliar workflows. Do not call skill_list for direct live UI control; use voice_browser or voice_desktop. Use totalInstalled/matchedCount/returnedCount/truncated from the result; never say the returned list length is the total number of skills unless truncated is false and matchedCount equals totalInstalled.',
    '- skill_read / skill_resource_list / skill_resource_read: canonical skill tools. When a relevant skill is found or injected by trigger context, load it before acting; follow it only through voice_* tools and hand off to Worker for non-voice capabilities.',
    '- voice_browser: use action open, snapshot, screenshot, click, vision_click, fill, type, vision_type, press_key, scroll, or wait for live browser UI. Explicit user-authorized social posts/messages are allowed when content and destination are clear. Use Worker for uploads/downloads, passwords/payment info, purchases/payments, destructive actions, account settings/security changes, files, or durable external changes.',
    '- voice_desktop: use action screenshot, list_windows, focus_window, window_control, find_app, launch_app, click, window_click, window_type, window_press_key, or window_scroll for live desktop UI. For window_control include window_action minimize/maximize/restore/close. Prefer window-scoped selectors and fresh screenshots. Use Worker for file edits, shell, installs, destructive confirmations, purchases/payments, account settings/security changes, or durable system changes.',
    '- Screenshot ownership: screenshot capture and screenshot sending stay in the voice layer. Do not dispatch/steer Worker for ordinary browser, desktop, app, window, or active-window screenshots; call voice_browser action screenshot, voice_desktop action screenshot, or voice_ops action send_screenshot.',
    '- Current time is injected. Do not call a tool just to know the time/date. If [CURRENT_TIME].exactLocalTimeAvailable is true and source is device, answer local time/date questions directly from timeLabel/dateLabel. If exactLocalTimeAvailable is false, do not claim exact user-local time; say the fallbackResponse and direct the user to their device clock.',
    '- If the user says not to hand off to Worker and asks for search/fetch/note/memory/timer/screenshot capture/screenshot send/wake phrase changes/quiet mode, prefer voice_ops or the matching browser/desktop wrapper. If the user asks to update live voice-agent behavior memory, use voice_ops action agent_memory. For skills, prefer skill_list, skill_read, skill_resource_list, or skill_resource_read.',
    '- For a "test web search" request without a concrete query, run a tiny harmless search for "OpenAI Realtime API voice tools" and report that the smoke test worked.',
    '',
    '[CURRENT_TIME]',
    JSON.stringify(contextPacket.currentTime || contextPacket.time || buildVoiceTimeContext(), null, 2),
    '[/CURRENT_TIME]',
    '',
    contextBlock,
    voiceRuntimeContextText(contextPacket.voiceRuntime ? contextPacket.voiceRuntime : ''),
    '',
    '[CURRENT_WORKER_CONTEXT_PACKET]',
    JSON.stringify(contextPacket, null, 2),
    '[/CURRENT_WORKER_CONTEXT_PACKET]',
  ].filter(Boolean).join('\n');
}

function buildVoiceAgentLightSystemPrompt(contextBlock: string, contextPacket: Record<string, any>, voiceTarget?: VoiceAgentTargetContext): string {
  const identity = voiceAgentTargetIdentity(voiceTarget);
  return [
    identity.identityLine,
    identity.roleLine,
    'Answer naturally and specifically in one or two short spoken sentences.',
    'Do not use canned fallback phrases. Do not answer with generic "I am here" or "I\'m here" phrasing; respond to what the user actually said.',
    'If the user asks for current Worker status/progress/context, answer from the injected worker packet; do not steer the Worker just to ask it for status.',
    identity.isSubagent
      ? `If the user asks for heavier work outside conversation, choose handoff_new_work and write a natural, specific acknowledgement as ${identity.speakerName}; say you will handle it yourself, not that you will get a worker or Prometheus.`
      : 'If the user asks for heavier work outside conversation, choose handoff_new_work and write a natural, specific acknowledgement in spokenReply.',
    '',
    'Return ONLY strict JSON. CRITICAL: The "spokenReply" field MUST be the FIRST field in your JSON output so audio playback can begin as you write. Do NOT output any other field before spokenReply. Use this exact field order:',
    '{"spokenReply":"string","action":"answer_now|handoff_new_work|no_reply","workerInstruction":"string optional","needsWorkerResponse":false,"reason":"string optional"}',
    '',
    '[VOICE_CONTEXT]',
    compactVoiceText(contextBlock, 1800),
    '[/VOICE_CONTEXT]',
    contextPacket.voiceRuntime ? `[VOICE_RUNTIME]\n${compactVoiceText(contextPacket.voiceRuntime, 300)}\n[/VOICE_RUNTIME]` : '',
    '',
    '[CURRENT_WORKER_CONTEXT_PACKET]',
    JSON.stringify({
      active: contextPacket.active === true,
      summary: compactVoiceText(contextPacket.summary || '', 600),
      currentGoal: compactVoiceText(contextPacket.currentGoal || '', 300),
      currentPhase: compactVoiceText(contextPacket.currentPhase || '', 120),
    }, null, 2),
    '[/CURRENT_WORKER_CONTEXT_PACKET]',
  ].filter(Boolean).join('\n');
}

function buildVoiceAgentHandoffContext(decision: VoiceAgentDecision, contextPacket: Record<string, any>, transcript: string): string {
  if (!decision.workerInstruction && decision.action !== 'handoff_new_work') return '';
  return [
    '[VOICE_AGENT_HANDOFF]',
    `Voice action: ${decision.action}`,
    decision.spokenReply ? `Spoken acknowledgement already given: ${decision.spokenReply}` : 'Spoken acknowledgement: none.',
    `Original voice transcript: ${compactVoiceText(transcript, 900)}`,
    decision.workerInstruction ? `Worker instruction: ${decision.workerInstruction}` : '',
    contextPacket?.summary ? `Voice context summary:\n${compactVoiceText(contextPacket.summary, 1200)}` : '',
    'Runtime instruction: Continue as the Prometheus worker. The Voice Agent has already acknowledged the user; do the actual work with tools if needed and avoid repeating the same generic acknowledgement.',
    '[/VOICE_AGENT_HANDOFF]',
  ].filter(Boolean).join('\n');
}

function voiceRuntimeContextText(value: any): string {
  if (typeof value === 'string') return compactVoiceText(value, 300);
  const runtime = value && typeof value === 'object' ? value : {};
  const wakePhrase = cleanVoiceWakePhrase(runtime.wakePhrase || runtime.wake_phrase || '');
  const gateActive = runtime.wakeGateActive === true || runtime.wake_gate_active === true;
  if (!wakePhrase) return 'Mobile voice has no wake phrase set. Do not enter quiet mode until the user sets one, unless you set it with voice_set_quiet_until from the user\'s request.';
  return `Mobile voice wake phrase is currently "${wakePhrase}". Quiet mode is ${gateActive ? 'active' : 'not active'}; setting the phrase alone may be acknowledged naturally, and quiet mode should only start through a quiet-mode tool or a strict local command.`;
}

function attachRuntimeProcessEntriesToLatestAssistant(sessionId: string, entries: Record<string, any>[]): void {
  const sid = String(sessionId || '').trim();
  const processEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!sid || !processEntries.length) return;
  try {
    const session = getSession(sid);
    const history = Array.isArray(session.history) ? session.history.slice() : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const msg: any = history[i];
      if (msg?.role !== 'assistant' && msg?.role !== 'ai') continue;
      const existing = Array.isArray(msg.processEntries) ? msg.processEntries : [];
      const merged = [...existing];
      const seen = new Set(merged.map((entry: any) => JSON.stringify({
        ts: entry?.ts,
        type: entry?.type,
        actor: entry?.actor,
        content: entry?.content,
        toolName: entry?.toolName,
      })));
      for (const entry of processEntries) {
        const key = JSON.stringify({
          ts: entry?.ts,
          type: entry?.type,
          actor: entry?.actor,
          content: entry?.content,
          toolName: entry?.toolName,
        });
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
      }
      if (merged.length === existing.length) return;
      history[i] = {
        ...msg,
        processEntries: merged.slice(-300),
      };
      replaceHistory(sid, history);
      return;
    }
  } catch (err: any) {
    console.warn('[main chat] failed to attach runtime process entries:', err?.message || err);
  }
}

function historyMessageMergeKey(msg: any): string {
  const role = msg?.role === 'assistant' || msg?.role === 'ai' ? 'assistant' : msg?.role === 'user' ? 'user' : '';
  const content = String(msg?.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!role || !content) return '';
  const eventId = String(msg?.voiceInterruptionEventId || msg?.eventId || '').trim();
  if (eventId) return `${role}|event:${eventId}|${content}`;
  return `${role}|${content}`;
}

function isInterruptedAssistantMessage(msg: any): boolean {
  const role = msg?.role === 'assistant' || msg?.role === 'ai' ? 'assistant' : '';
  if (!role) return false;
  const content = String(msg?.content || '').trim();
  if (!content) return false;
  return /^\[(?:Stopped by user|Generation stopped|Interrupted by user)\]/i.test(content)
    || /^Restart Context Packet\b/i.test(content)
    || /\b(?:stopped|interrupted|aborted) by user\b/i.test(content);
}

function mergeHistoryMetadataFromPrior(raw: any, prior: any): any {
  if (!prior || typeof prior !== 'object' || !raw || typeof raw !== 'object') return raw;
  const next: any = { ...raw };
  if (!Array.isArray(next.processEntries) && Array.isArray((prior as any).processEntries)) next.processEntries = (prior as any).processEntries;
  if (!next.toolLog && (prior as any).toolLog) next.toolLog = (prior as any).toolLog;
  if (!next.thinking && (prior as any).thinking) next.thinking = (prior as any).thinking;
  if (!next.fileChanges && (prior as any).fileChanges) next.fileChanges = (prior as any).fileChanges;
  return next;
}

function mergeHistoryWithExistingMessageMetadata(sessionId: string, incomingHistory: any[]): any[] {
  const incoming = Array.isArray(incomingHistory) ? incomingHistory : [];
  if (!incoming.length) return incoming;
  try {
    const existing = Array.isArray(getSession(sessionId).history) ? getSession(sessionId).history : [];
    const byKey = new Map<string, any>();
    for (const msg of existing) {
      const key = historyMessageMergeKey(msg);
      if (key && !byKey.has(key)) byKey.set(key, msg);
    }
    const interruptedExisting = existing
      .filter(isInterruptedAssistantMessage)
      .filter((msg: any) => Array.isArray(msg?.processEntries) || msg?.toolLog || msg?.fileChanges)
      .sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
    return incoming.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const prior = byKey.get(historyMessageMergeKey(raw));
      if (prior && typeof prior === 'object') return mergeHistoryMetadataFromPrior(raw, prior);
      if (isInterruptedAssistantMessage(raw)) {
        const rawTs = Number(raw?.timestamp || 0);
        const nearestInterrupted = interruptedExisting.find((msg: any) => {
          const msgTs = Number(msg?.timestamp || 0);
          return !rawTs || !msgTs || Math.abs(msgTs - rawTs) < 10 * 60_000;
        });
        if (nearestInterrupted) return mergeHistoryMetadataFromPrior(raw, nearestInterrupted);
      }
      return raw;
    });
  } catch {
    return incoming;
  }
}

function sessionProcessLogFromHistory(session: any): any[] {
  const out: any[] = [];
  for (const msg of Array.isArray(session?.history) ? session.history : []) {
    if (Array.isArray((msg as any)?.processEntries)) out.push(...(msg as any).processEntries);
  }
  return out.slice(-500);
}

function boundedPositiveInt(input: unknown, fallback: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sanitizeUiProcessValue(value: unknown, maxChars: number): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncateRuntimeProcessText(value, maxChars);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    const json = JSON.stringify(value);
    if (!json || json.length <= maxChars) return value;
    return {
      truncated: true,
      preview: truncateRuntimeProcessText(json, maxChars),
    };
  } catch {
    return truncateRuntimeProcessText(String(value), maxChars);
  }
}

function sanitizeProcessEntryForUi(entry: any, options: { textLimit: number; extraLimit: number }): any {
  if (!entry || typeof entry !== 'object') return entry;
  const next: any = { ...entry };
  for (const key of ['content', 'message', 'text', 'result', 'thinking', 'thinkingTail']) {
    if (typeof next[key] === 'string') next[key] = truncateRuntimeProcessText(next[key], options.textLimit);
  }
  if (next.extra && typeof next.extra === 'object') {
    const extra: any = { ...next.extra };
    for (const key of Object.keys(extra)) {
      extra[key] = sanitizeUiProcessValue(extra[key], options.extraLimit);
    }
    next.extra = extra;
  }
  return next;
}

function sanitizeAttachmentPreviewForUi(preview: any, options: { dataUrlLimit: number; textLimit: number }): any {
  if (!preview || typeof preview !== 'object') return preview;
  const next: any = { ...preview };
  delete next.file;
  for (const key of ['base64', 'bytes', 'raw', 'buffer']) {
    if (key in next) {
      delete next[key];
      next.previewTruncated = true;
    }
  }
  for (const key of ['dataUrl', 'preview', 'previewUrl', 'thumbnailUrl', 'url']) {
    if (typeof next[key] !== 'string') continue;
    const value = next[key];
    const isInlineData = value.startsWith('data:');
    if (value.length > options.dataUrlLimit || (isInlineData && value.length > options.dataUrlLimit)) {
      delete next[key];
      next.hasPreview = true;
      next.previewTruncated = true;
    }
  }
  for (const key of ['content', 'text']) {
    if (typeof next[key] === 'string') next[key] = truncateRuntimeProcessText(next[key], options.textLimit);
  }
  return next;
}

function sanitizeHistoryForUiResponse(
  history: any[],
  options: {
    historyLimit: number;
    includeToolLog: boolean;
    perMessageProcessLimit: number;
    processEntryTextLimit?: number;
    processEntryExtraLimit?: number;
    attachmentPreviewDataUrlLimit?: number;
    attachmentPreviewTextLimit?: number;
  },
): any[] {
  const source = Array.isArray(history) ? history : [];
  const limited = options.historyLimit > 0 ? source.slice(-options.historyLimit) : source;
  return limited.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const msg: any = { ...raw };
    if (!options.includeToolLog) delete msg.toolLog;
    if (Array.isArray(msg.processEntries)) {
      msg.processEntries = msg.processEntries
        .slice(-options.perMessageProcessLimit)
        .map((entry: any) => sanitizeProcessEntryForUi(entry, {
          textLimit: options.processEntryTextLimit || 1600,
          extraLimit: options.processEntryExtraLimit || 1200,
        }));
    }
    if (Array.isArray(msg.attachmentPreviews)) {
      msg.attachmentPreviews = msg.attachmentPreviews.map((preview: any) => sanitizeAttachmentPreviewForUi(preview, {
        dataUrlLimit: options.attachmentPreviewDataUrlLimit || 60_000,
        textLimit: options.attachmentPreviewTextLimit || 4000,
      }));
    }
    return msg;
  });
}

function estimateJsonTokensForModel(value: unknown, profile: { tokenizer: any }): number {
  try {
    return estimateTextTokensForModel(JSON.stringify(value || null), profile.tokenizer);
  } catch {
    return estimateTextTokensForModel(String(value || ''), profile.tokenizer);
  }
}

function safeTokenSessionFileName(sessionId: string): string {
  return String(sessionId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

function estimateToolObservationRawTokens(sessionId: string, profile: { tokenizer: any }): { tokens: number; bytes: number; files: number } {
  let tokens = 0;
  let bytes = 0;
  let files = 0;
  try {
    const dir = path.join(getConfig().getConfigDir(), 'tool-observations', 'raw', safeTokenSessionFileName(sessionId));
    if (!fs.existsSync(dir)) return { tokens, bytes, files };
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      files += 1;
      bytes += st.size;
      try {
        tokens += estimateTextTokensForModel(fs.readFileSync(full, 'utf-8'), profile.tokenizer);
      } catch {
        tokens += Math.ceil(st.size / 3.5);
      }
    }
  } catch {}
  return { tokens, bytes, files };
}

function estimateStoredThreadFootprint(sessionId: string, session: any, profile: { tokenizer: any }) {
  const history = Array.isArray(session?.history) ? session.history : [];
  let visibleChatTokens = 0;
  let processEntryTokens = 0;
  let legacyToolLogTokens = 0;
  let attachmentMetadataTokens = 0;
  for (const msg of history) {
    visibleChatTokens += estimateTextTokensForModel(msg?.content || '', profile.tokenizer);
    if (Array.isArray(msg?.processEntries)) processEntryTokens += estimateJsonTokensForModel(msg.processEntries, profile);
    if (msg?.toolLog) legacyToolLogTokens += estimateTextTokensForModel(msg.toolLog, profile.tokenizer);
    const attachmentBits = {
      artifacts: msg?.artifacts,
      generatedImages: msg?.generatedImages,
      generatedVideos: msg?.generatedVideos,
      attachmentPreviews: msg?.attachmentPreviews,
      canvasFiles: msg?.canvasFiles,
      fileChanges: msg?.fileChanges,
      productCarousel: msg?.productCarousel,
      richArtifacts: msg?.richArtifacts,
    };
    attachmentMetadataTokens += estimateJsonTokensForModel(attachmentBits, profile);
  }
  const sessionJsonTokens = estimateJsonTokensForModel(session, profile);
  const observations = readToolObservations(sessionId, 100000);
  const toolObservationStoredTokens = estimateJsonTokensForModel(observations, profile);
  const raw = estimateToolObservationRawTokens(sessionId, profile);
  return {
    visibleChatTokens,
    processEntryTokens,
    legacyToolLogTokens,
    attachmentMetadataTokens,
    sessionJsonTokens,
    toolObservationStoredTokens,
    rawToolResultTokens: raw.tokens,
    rawToolResultBytes: raw.bytes,
    rawToolResultFiles: raw.files,
    fullStoredThreadTokens: sessionJsonTokens + toolObservationStoredTokens + raw.tokens,
  };
}

function aggregateSessionModelUsage(sessionId: string) {
  const events = readModelUsageEvents().filter((event) => String(event.sessionId || '') === sessionId);
  const totals = {
    calls: events.length,
    providerReportedCalls: 0,
    estimatedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    estimatedMessageInputTokens: 0,
    estimatedSystemPromptTokens: 0,
    estimatedConversationTokens: 0,
    estimatedToolSchemaTokens: 0,
    estimatedProviderInputTokens: 0,
    lastCall: null as any,
    lastContextCall: null as any,
  };
  for (const event of events) {
    if (event.source === 'provider') totals.providerReportedCalls += 1;
    else totals.estimatedCalls += 1;
    totals.inputTokens += Number(event.inputTokens || 0);
    totals.outputTokens += Number(event.outputTokens || 0);
    totals.reasoningTokens += Number(event.reasoningTokens || 0);
    totals.cacheReadTokens += Number(event.cacheReadTokens || 0);
    totals.cacheWriteTokens += Number(event.cacheWriteTokens || 0);
    totals.totalTokens += Number(event.totalTokens || 0);
    totals.estimatedMessageInputTokens += Number((event as any).estimatedMessageInputTokens || 0);
    totals.estimatedSystemPromptTokens += Number((event as any).estimatedSystemPromptTokens || 0);
    totals.estimatedConversationTokens += Number((event as any).estimatedConversationTokens || 0);
    totals.estimatedToolSchemaTokens += Number((event as any).estimatedToolSchemaTokens || 0);
    totals.estimatedProviderInputTokens += Number((event as any).estimatedProviderInputTokens || 0);
    totals.lastCall = event;
    const eventProviderInput = Number((event as any).estimatedProviderInputTokens || 0);
    const isMainChatContext = event.callType === 'chat' && String(event.agentId || '') === 'main' && eventProviderInput > 0;
    const isFallbackChatContext = !totals.lastContextCall && event.callType === 'chat' && eventProviderInput > 0;
    if (isMainChatContext || isFallbackChatContext) totals.lastContextCall = event;
  }
  return totals;
}

function diffModelUsage(before: any, after: any) {
  const keys = [
    'calls',
    'providerReportedCalls',
    'estimatedCalls',
    'inputTokens',
    'outputTokens',
    'reasoningTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
    'estimatedMessageInputTokens',
    'estimatedSystemPromptTokens',
    'estimatedConversationTokens',
    'estimatedToolSchemaTokens',
    'estimatedProviderInputTokens',
  ];
  const out: any = {};
  for (const key of keys) {
    out[key] = Math.max(0, Number(after?.[key] || 0) - Number(before?.[key] || 0));
  }
  out.lastCall = after?.lastCall || null;
  out.lastContextCall = after?.lastContextCall || null;
  return out;
}

function summarizeTurnToolResultBudget(observations: ToolObservation[]) {
  const byTool = new Map<string, any>();
  let resultTokens = 0;
  let argsTokens = 0;
  let totalTokens = 0;
  let resultBytes = 0;
  let durationMsTotal = 0;
  let durationMsMax = 0;
  let durationCallCount = 0;
  for (const obs of observations || []) {
    const name = String(obs?.toolName || 'unknown_tool');
    const estimate = obs?.tokenEstimate || {} as any;
    const result = Math.max(0, Number((estimate as any).resultTokens || 0));
    const args = Math.max(0, Number((estimate as any).argsTokens || 0));
    const total = Math.max(0, Number((estimate as any).totalTokens || result + args));
    const bytes = Math.max(0, Number((estimate as any).resultBytes || 0));
    const obsDurationMs = Number((obs as any)?.durationMs);
    const hasDuration = Number.isFinite(obsDurationMs);
    const duration = hasDuration ? Math.max(0, Math.round(obsDurationMs)) : 0;
    resultTokens += result;
    argsTokens += args;
    totalTokens += total;
    resultBytes += bytes;
    if (hasDuration) {
      durationMsTotal += duration;
      durationMsMax = Math.max(durationMsMax, duration);
      durationCallCount += 1;
    }
    const row = byTool.get(name) || { tool: name, calls: 0, resultTokens: 0, argsTokens: 0, totalTokens: 0, resultBytes: 0, durationMsTotal: 0, durationMsMax: 0, durationCallCount: 0 };
    row.calls += 1;
    row.resultTokens += result;
    row.argsTokens += args;
    row.totalTokens += total;
    row.resultBytes += bytes;
    if (hasDuration) {
      row.durationMsTotal += duration;
      row.durationMsMax = Math.max(row.durationMsMax, duration);
      row.durationCallCount += 1;
    }
    byTool.set(name, row);
  }
  const tools = [...byTool.values()].map((row) => ({
    ...row,
    durationMsAvg: row.durationCallCount > 0 ? Math.round(row.durationMsTotal / row.durationCallCount) : 0,
  }));
  return {
    calls: observations.length,
    resultTokens,
    argsTokens,
    totalTokens,
    resultBytes,
    durationMsTotal,
    durationMsMax,
    durationMsAvg: durationCallCount > 0 ? Math.round(durationMsTotal / durationCallCount) : 0,
    tools: tools.sort((a, b) => b.resultTokens - a.resultTokens || b.durationMsMax - a.durationMsMax || b.calls - a.calls).slice(0, 20),
    slowestTools: [...tools].filter((row) => Number(row.durationMsMax || 0) > 0).sort((a, b) => b.durationMsMax - a.durationMsMax || b.durationMsTotal - a.durationMsTotal).slice(0, 20),
  };
}

function getLastTurnUsageTelemetry(session: any): { providerUsage?: any; toolResultBudget?: any } {
  const history = Array.isArray(session?.history) ? session.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i] as any;
    if (!msg || msg.role !== 'assistant') continue;
    if (msg.turnProviderUsage || msg.toolResultBudget) {
      return {
        providerUsage: msg.turnProviderUsage,
        toolResultBudget: msg.toolResultBudget,
      };
    }
  }
  return {};
}

function buildActiveSkillsContextEstimate(sessionId: string, profile: { tokenizer: any }) {
  const children: ContextWindowRow[] = [];
  let text = '';
  try {
    const skillIds = Array.from(getActivatedSkillIds(sessionId));
    const lines: string[] = ['[ACTIVE_SKILLS]'];
    const activeLines: string[] = [];
    const resourceLines: string[] = [];
    const hintLines: string[] = [];
    for (const skillId of skillIds) {
      const skill = _skillsManager?.get?.(skillId);
      activeLines.push(`Recently used: ${skill?.id || skillId}.`);
      if (skill?.description) activeLines.push(`Skill Description: ${skill.description}`);
      const resources = getActivatedSkillResources(sessionId, skillId);
      if (resources.length) resourceLines.push(`Resources read for ${skill?.id || skillId}: ${resources.join(', ')}.`);
      hintLines.push(`Re-read with skill_read("${skill?.id || skillId}") if you need the full instructions.`);
    }
    lines.push(...activeLines, ...resourceLines, ...hintLines);
    text = lines.join('\n');
    const childSpecs = [
      { id: 'active_skill_reminders', label: 'Active skill reminders', lines: activeLines },
      { id: 'resource_reminders', label: 'Resource reminders', lines: resourceLines },
      { id: 'reread_hints', label: 'Re-read hints', lines: hintLines },
    ];
    for (const spec of childSpecs) {
      const body = spec.lines.join('\n').trim();
      const tokens = estimateTextTokensForModel(body, profile.tokenizer);
      if (tokens > 0) {
        children.push({
          id: `skills.${spec.id}`,
          label: spec.label,
          tokens,
          active: true,
          includedInContext: true,
          percentBasis: 'window',
          estimated: true,
        });
      }
    }
  } catch {
    text = '';
  }
  return {
    tokens: estimateTextTokensForModel(text, profile.tokenizer),
    children,
  };
}

type ContextWindowRow = {
  id: string;
  label: string;
  tokens: number;
  active?: boolean;
  includedInContext?: boolean;
  outOfBand?: boolean;
  percentBasis?: string;
  percentLabel?: string;
  estimated?: boolean;
  children?: ContextWindowRow[];
};

function allocateContextChildren(
  parentId: string,
  totalTokens: number,
  specs: Array<{ id: string; label: string; tokens?: number; weight?: number; estimated?: boolean }>,
): ContextWindowRow[] {
  const total = Math.max(0, Math.round(Number(totalTokens || 0)));
  if (total <= 0 || !specs.length) return [];
  const raw = specs.map((spec) => ({
    ...spec,
    rawTokens: Math.max(0, Number(spec.tokens ?? spec.weight ?? 0)),
  })).filter((spec) => spec.rawTokens > 0);
  const rawTotal = raw.reduce((sum, spec) => sum + spec.rawTokens, 0);
  if (rawTotal <= 0) return [];

  let remaining = total;
  return raw.map((spec, index) => {
    const tokens = index === raw.length - 1
      ? remaining
      : Math.max(0, Math.round((spec.rawTokens / rawTotal) * total));
    remaining = Math.max(0, remaining - tokens);
    return {
      id: `${parentId}.${spec.id}`,
      label: spec.label,
      tokens,
      active: tokens > 0,
      includedInContext: true,
      percentBasis: 'window',
      estimated: spec.estimated !== false,
    };
  }).filter((row) => row.tokens > 0);
}

function friendlyContextToolCategory(category: string): string {
  const labels: Record<string, string> = {
    core: 'Core runtime tools',
    browser: 'Browser tools',
    browser_automation: 'Browser automation',
    desktop: 'Desktop tools',
    workspace_read: 'Workspace read tools',
    workspace_write: 'Workspace write tools',
    prometheus_source_read: 'Source read tools',
    prometheus_source_write: 'Source write tools',
    memory: 'Memory tools',
    skills: 'Skill tools',
    schedules: 'Schedule tools',
    tasks: 'Task tools',
    agents: 'Agent tools',
    team: 'Team tools',
    external_apps: 'External app tools',
    model_management: 'Model tools',
    business: 'Business tools',
    creative: 'Creative tools',
    media: 'Media tools',
    mcp: 'MCP tools',
    composite_tools: 'Composite tools',
  };
  return labels[category] || category.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function estimateCurrentSystemToolSchemaTokens(sessionId: string, profile: { tokenizer: any }): number {
  try {
    return (buildTools(sessionId) || []).reduce((sum: number, tool: any) => sum + estimateJsonTokensForModel(tool, profile), 0);
  } catch {
    return 0;
  }
}

function estimateCurrentSystemPromptTokens(sessionId: string, profile: { tokenizer: any }): number {
  try {
    return buildSystemPromptChildren(0, sessionId, profile)
      .reduce((sum, row) => sum + Math.max(0, Number(row.tokens || 0)), 0);
  } catch {
    return 0;
  }
}

function buildSystemToolSchemaChildren(sessionId: string, profile: { tokenizer: any }, totalTokens: number): ContextWindowRow[] {
  let total = Math.max(0, Number(totalTokens || 0));
  const byCategory: Record<string, number> = {};
  try {
    for (const tool of buildTools(sessionId) || []) {
      const name = String((tool as any)?.function?.name || '');
      const category = getToolCategory(name) || 'core';
      byCategory[category] = (byCategory[category] || 0) + estimateJsonTokensForModel(tool, profile);
    }
  } catch {
    return [];
  }
  if (total <= 0) total = Object.values(byCategory).reduce((sum, tokens) => sum + Math.max(0, Number(tokens || 0)), 0);
  if (total <= 0) return [];
  return allocateContextChildren(
    'system_tools',
    total,
    Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([category, tokens]) => ({
        id: category,
        label: friendlyContextToolCategory(category),
        tokens,
        estimated: true,
      })),
  );
}

function buildContextWindowSubagentsRosterEstimate(): string {
  try {
    const subs = getAgents().filter((agent: any) => agent && agent.default !== true && agent.id !== 'main');
    if (subs.length === 0) {
      return '[SUBAGENTS] You currently have 0 subagents configured (only the default agent exists). If asked "how many subagents / who are they," answer: none yet.';
    }
    const lines = subs.map((agent: any) => {
      const displayName = agent?.identity?.displayName || agent?.name || agent?.id;
      const desc = String(agent?.description || '').trim();
      const shortDesc = desc.length > 140 ? `${desc.slice(0, 137)}...` : desc;
      return `- ${displayName} (id: ${agent.id})${shortDesc ? ` - ${shortDesc}` : ''}`;
    });
    return [
      `[SUBAGENTS] You currently have ${subs.length} subagent${subs.length === 1 ? '' : 's'} configured. ALWAYS refer to each by their display name (not the technical id). When asked how many subagents exist or who they are, answer with this count and these names:`,
      ...lines,
    ].join('\n');
  } catch {
    return '';
  }
}

function getLastUserContextText(sessionId: string): string {
  try {
    const history = Array.isArray(getSession(sessionId)?.history) ? getSession(sessionId).history : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const msg = history[i] as any;
      if (msg?.role !== 'user') continue;
      const content = String(msg?.content || '').trim();
      if (!content) continue;
      if (/^Before continuing: summarize the conversation so far into a compact context note\./i.test(content)) continue;
      if (/^Before continuing: preserve any durable user preferences/i.test(content)) continue;
      return content;
    }
  } catch {}
  return '';
}

function buildSystemPromptChildren(totalTokens: number, sessionId: string, profile: { tokenizer: any }): ContextWindowRow[] {
  const rows: ContextWindowRow[] = [];
  const addText = (id: string, label: string, text: string, estimated = false) => {
    const tokens = estimateTextTokensForModel(text, profile.tokenizer);
    if (tokens <= 0) return;
    rows.push({
      id: `system_prompt.${id}`,
      label,
      tokens,
      active: true,
      includedInContext: true,
      percentBasis: 'window',
      estimated,
    });
  };

  try {
    const workspacePath = getConfig().getWorkspacePath();
    const activeCategories = getActivatedToolCategories(sessionId);
    const today = new Date().toISOString().split('T')[0];
    const intraday = loadWorkspaceFile(workspacePath, path.join('memory', `${today}-intraday-notes.md`), 1800);
    const business = isBusinessContextEnabled(sessionId) ? loadWorkspaceFile(workspacePath, 'BUSINESS.md', 4000) : '';
    const cisContext = buildCisContextBlock(workspacePath, getLastUserContextText(sessionId), { force: isBusinessContextEnabled(sessionId) });
    const projectContext = findProjectBySessionId(sessionId) ? (buildProjectContextBlock(sessionId) || '') : '';
    const toolsBlock = buildToolsContext(activeCategories);
    const baseToolsBlock = buildToolsContext(new Set<string>());
    const toolsMenu = toolsBlock.startsWith(baseToolsBlock)
      ? baseToolsBlock
      : toolsBlock;
    const activeToolBlocks = toolsBlock.startsWith(baseToolsBlock)
      ? toolsBlock.slice(baseToolsBlock.length).trim()
      : Array.from(activeCategories)
        .map((category) => TOOL_BLOCKS[String(category || '')])
        .filter(Boolean)
        .join('\n\n');
    const skillsHint = _skillsManager?.buildTurnContext?.('') || '';
    const referenceHint = isPublicDistributionBuild()
      ? ''
      : '[REFERENCE_FILES] Architecture/debug context: self/index.md is the canonical workspace-root map; use workspace_read(action:"read", path:"self/index.md"). Follow its links to focused self/* subsystem files as needed.';
    const profileInfo = resolveActiveModelContextProfile();

    addText('base_identity', 'Base identity / execution mode', 'You are Prometheus. Follow the current execution mode, response style, safety, routing, memory, and tool-use rules.', true);
    addText('model_capabilities', 'Model capabilities', `[MODEL_CAPABILITIES]\nprovider=${profileInfo.providerId}\nmodel=${profileInfo.model}`, false);
    addText('prometheus_soul', '[PROMETHEUS_SOUL]', loadSoul());
    addText('user', '[USER]', loadWorkspaceFile(workspacePath, 'USER.md', 5000));
    addText('soul', '[SOUL]', loadWorkspaceFile(workspacePath, 'SOUL.md', 6000));
    addText('memory', '[MEMORY]', loadWorkspaceFile(workspacePath, 'MEMORY.md', 8000));
    addText('business', '[BUSINESS]', business);
    addText('cis_context', '[CIS_CONTEXT]', cisContext, true);
    addText('subagents', '[SUBAGENTS]', buildContextWindowSubagentsRosterEstimate(), true);
    addText('project_context', '[PROJECT_CONTEXT]', projectContext);
    addText('today_notes', '[TODAY_NOTES]', intraday);
    addText('tools_menu', '[TOOLS] menu', toolsMenu, true);
    addText('activated_tool_blocks', 'Activated TOOL_BLOCKS.*', activeToolBlocks, true);
    addText('skills_hint', 'Skills hint / matching skills', skillsHint, true);
    addText('reference_hints', 'Reference hints', referenceHint, true);
  } catch {
    // Fall through to the total reconciliation below.
  }

  const total = Math.max(0, Math.round(Number(totalTokens || 0)));
  const rowTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.tokens || 0)), 0);
  if (total > 0 && rowTotal > total) {
    return allocateContextChildren(
      'system_prompt',
      total,
      rows.map((row) => ({
        id: row.id.replace(/^system_prompt\./, ''),
        label: row.label,
        tokens: row.tokens,
        estimated: row.estimated,
      })),
    );
  }
  if (total > rowTotal) {
    rows.push({
      id: 'system_prompt.runtime_context',
      label: 'Caller/browser/runtime context',
      tokens: total - rowTotal,
      active: true,
      includedInContext: true,
      percentBasis: 'window',
      estimated: true,
    });
  }
  return rows;
}

function buildProviderUsageGroup(id: string, label: string, usage: any, percentLabel = 'total'): ContextWindowRow | null {
  const inputTokens = Math.max(0, Number(usage?.inputTokens || 0));
  const outputTokens = Math.max(0, Number(usage?.outputTokens || 0));
  const reasoningTokens = Math.max(0, Number(usage?.reasoningTokens || 0));
  const cacheReadTokens = Math.max(0, Number(usage?.cacheReadTokens || 0));
  const cacheWriteTokens = Math.max(0, Number(usage?.cacheWriteTokens || 0));
  const totalTokens = Math.max(0, Number(usage?.totalTokens || 0))
    || inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;
  if (totalTokens <= 0) return null;
  const children: ContextWindowRow[] = [
    { id: `${id}_input`, label: 'Input', tokens: inputTokens, active: inputTokens > 0, includedInContext: false, outOfBand: true, percentLabel },
    { id: `${id}_output`, label: 'Output', tokens: outputTokens, active: outputTokens > 0, includedInContext: false, outOfBand: true, percentLabel },
    { id: `${id}_reasoning`, label: 'Reasoning', tokens: reasoningTokens, active: reasoningTokens > 0, includedInContext: false, outOfBand: true, percentLabel },
    { id: `${id}_cache_read`, label: 'Cache read', tokens: cacheReadTokens, active: cacheReadTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'saved' },
    { id: `${id}_cache_write`, label: 'Cache write', tokens: cacheWriteTokens, active: cacheWriteTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'stored' },
  ].filter((row) => row.active);
  return { id, label, tokens: totalTokens, active: true, includedInContext: false, outOfBand: true, percentLabel, children };
}

function buildProviderUsageChildren(modelUsage: any): ContextWindowRow[] {
  const rows: ContextWindowRow[] = [];
  const last = buildProviderUsageGroup('provider_last_call', 'Last provider call', modelUsage?.lastContextCall || modelUsage?.lastCall, 'last');
  const session = buildProviderUsageGroup('provider_session_total', 'Session provider total', modelUsage, 'total');
  if (last) rows.push(last);
  if (session) rows.push(session);
  return rows;
}

function formatDurationMsForContextLabel(value: any): string {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(2)}s`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
}

function formatToolBudgetDurationSuffix(tool: any): string {
  const max = Number(tool?.durationMsMax || 0);
  const avg = Number(tool?.durationMsAvg || 0);
  const total = Number(tool?.durationMsTotal || 0);
  const value = max || avg || total;
  const label = formatDurationMsForContextLabel(value);
  if (!label) return '';
  return ` · ${label}${max > 0 && Number(tool?.calls || 0) > 1 ? ' max' : ''}`;
}

function buildLastTurnUsageRow(turnTelemetry: any): ContextWindowRow | null {
  const providerUsage = turnTelemetry?.providerUsage || {};
  const toolBudget = turnTelemetry?.toolResultBudget || {};
  const providerTokens = Math.max(0, Number(providerUsage.totalTokens || 0));
  const toolResultTokens = Math.max(0, Number(toolBudget.resultTokens || 0));
  const tokens = providerTokens || toolResultTokens;
  if (tokens <= 0) return null;
  const children: ContextWindowRow[] = [];
  const provider = buildProviderUsageGroup('last_turn_provider', 'Provider usage', providerUsage, 'last');
  if (provider) children.push(provider);
  if (toolResultTokens > 0) {
    const toolChildren: ContextWindowRow[] = Array.isArray(toolBudget.tools)
      ? toolBudget.tools.slice(0, 12).map((tool: any, index: number) => ({
        id: `last_turn_tool_${index}_${String(tool.tool || 'tool').replace(/[^a-z0-9_-]/gi, '_')}`,
        label: `${String(tool.tool || 'tool')} x${Math.max(1, Number(tool.calls || 0))}${formatToolBudgetDurationSuffix(tool)}`,
        tokens: Math.max(0, Number(tool.resultTokens || 0)),
        active: Number(tool.resultTokens || 0) > 0,
        includedInContext: false,
        outOfBand: true,
        percentLabel: 'tool',
      }))
      : [];
    children.push({
      id: 'last_turn_tool_outputs',
      label: `Tool result output${toolBudget.durationMsTotal ? ` · ${formatDurationMsForContextLabel(toolBudget.durationMsTotal)} total` : ''}`,
      tokens: toolResultTokens,
      active: true,
      includedInContext: false,
      outOfBand: true,
      percentLabel: 'tool',
      children: toolChildren,
    });
  }
  return {
    id: 'last_turn_usage',
    label: 'Last turn usage',
    tokens,
    active: true,
    includedInContext: false,
    outOfBand: true,
    percentLabel: 'last',
    children,
  };
}

function buildContextWindowCurrentState(input: {
  sessionId: string;
  profile: { contextWindowTokens: number; tokenizer: any };
  currentInputTokens: number;
  messageTokens: number;
  recentToolTokens: number;
  inputBudgetTokens: number;
  compactionTriggerTokens: number;
  storedThread: any;
  modelUsage: any;
  turnTelemetry?: any;
}) {
  const lastCall = input.modelUsage?.lastContextCall || input.modelUsage?.lastCall || {};
  const latestMessageInputTokens = Math.max(0, Number(lastCall.estimatedMessageInputTokens || 0));
  const latestSystemPromptTokens = Math.max(0, Number(lastCall.estimatedSystemPromptTokens || 0));
  const latestToolSchemaTokens = Math.max(
    0,
    Number(lastCall.estimatedToolSchemaTokens || 0) || estimateCurrentSystemToolSchemaTokens(input.sessionId, input.profile),
  );
  const latestProviderInputTokens = Math.max(0, Number(lastCall.estimatedProviderInputTokens || 0));
  const activeSkillEstimate = buildActiveSkillsContextEstimate(input.sessionId, input.profile);
  const activeSkillTokens = activeSkillEstimate.tokens;
  const legacySystemPromptEstimate = Math.max(0, latestMessageInputTokens - input.currentInputTokens - activeSkillTokens);
  const systemPromptTokens = latestSystemPromptTokens > 0
    ? Math.max(0, latestSystemPromptTokens - activeSkillTokens)
    : (legacySystemPromptEstimate || estimateCurrentSystemPromptTokens(input.sessionId, input.profile));
  const storedMessageTokens = Math.max(0, Number(input.storedThread?.visibleChatTokens || 0) + Number(input.storedThread?.attachmentMetadataTokens || 0));
  const processTokens = Math.max(0, Number(input.storedThread?.processEntryTokens || 0) + Number(input.storedThread?.legacyToolLogTokens || 0));
  const storedObservationTokens = Math.max(0, Number(input.storedThread?.toolObservationStoredTokens || 0));
  const rawToolStorageTokens = Math.max(0, Number(input.storedThread?.rawToolResultTokens || 0));
  const systemToolChildren = buildSystemToolSchemaChildren(input.sessionId, input.profile, latestToolSchemaTokens);
  const systemPromptChildren = buildSystemPromptChildren(systemPromptTokens, input.sessionId, input.profile);
  const providerUsageChildren = buildProviderUsageChildren(input.modelUsage);
  const lastTurnUsageRow = buildLastTurnUsageRow(input.turnTelemetry);
  const skillChildren = activeSkillEstimate.children;
  const contextWindowTokens = Math.max(0, Number(input.profile.contextWindowTokens || 0));
  const inputBudgetTokens = Math.max(0, Number(input.inputBudgetTokens || 0));
  const compactionTriggerTokens = Math.max(0, Number(input.compactionTriggerTokens || 0));
  const contextLimitTokens = contextWindowTokens || inputBudgetTokens || compactionTriggerTokens;
  const inContextRows: ContextWindowRow[] = [
    { id: 'messages', label: 'Messages', tokens: Math.max(0, input.messageTokens), active: input.messageTokens > 0 },
    { id: 'system_tools', label: 'System tools', tokens: latestToolSchemaTokens, active: latestToolSchemaTokens > 0, children: systemToolChildren },
    { id: 'system_prompt', label: 'System prompt', tokens: systemPromptTokens, active: systemPromptTokens > 0, children: systemPromptChildren },
    { id: 'skills', label: 'Skills', tokens: activeSkillTokens, active: activeSkillTokens > 0, children: skillChildren, estimated: activeSkillTokens > 0 },
    { id: 'tool_observations', label: 'Tool observations', tokens: Math.max(0, input.recentToolTokens), active: input.recentToolTokens > 0 },
    { id: 'mcp_tools', label: 'MCP tools', tokens: 0, active: false },
    { id: 'mcp_tools_deferred', label: 'MCP tools (deferred)', tokens: 0, active: false },
  ].map((row) => ({ ...row, includedInContext: true, percentBasis: 'window' }));
  const inContextRowTotal = inContextRows.reduce((sum, row) => sum + Math.max(0, Number(row.tokens || 0)), 0);
  const runtimeOverheadBasis = latestSystemPromptTokens > 0
    ? latestMessageInputTokens + latestToolSchemaTokens
    : inContextRowTotal;
  const runtimeOverheadTokens = Math.max(0, latestProviderInputTokens - runtimeOverheadBasis);
  const runtimeOverheadRow = runtimeOverheadTokens > 0
    ? [{ id: 'runtime_overhead', label: 'Runtime overhead', tokens: runtimeOverheadTokens, active: true, includedInContext: true, percentBasis: 'window' }]
    : [];
  const currentStateTokens = inContextRowTotal + runtimeOverheadTokens;
  const freeSpaceTokens = Math.max(0, contextLimitTokens - currentStateTokens);
  return {
    currentStateTokens,
    contextLimitTokens,
    contextWindowTokens,
    compactionTriggerTokens,
    latestProviderInputTokens,
    nextCallEstimateTokens: input.currentInputTokens,
    freeSpaceTokens,
    rows: [
      ...inContextRows,
      ...runtimeOverheadRow,
      { id: 'free_space', label: 'Free context window', tokens: freeSpaceTokens, active: freeSpaceTokens > 0, includedInContext: false, percentBasis: 'window' },
      { id: 'next_call_estimate', label: 'Next call estimate', tokens: input.currentInputTokens, active: input.currentInputTokens > 0, includedInContext: false, percentLabel: 'next' },
      { id: 'input_budget', label: 'Input budget after reserves', tokens: inputBudgetTokens, active: false, includedInContext: false, outOfBand: true, percentBasis: 'window', percentLabel: 'budget' },
      { id: 'compaction_trigger', label: 'Compaction trigger', tokens: compactionTriggerTokens, active: false, includedInContext: false, outOfBand: true, percentBasis: 'window', percentLabel: 'trigger' },
      { id: 'model_context_window', label: 'Model context window', tokens: contextWindowTokens, active: false, includedInContext: false, outOfBand: true, percentLabel: 'full' },
      { id: 'full_stored_thread', label: 'Full stored thread', tokens: Math.max(0, Number(input.storedThread?.fullStoredThreadTokens || 0)), active: false, includedInContext: false, outOfBand: true, percentLabel: 'stored' },
      { id: 'stored_process_logs', label: 'Stored process logs', tokens: processTokens, active: processTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'stored' },
      { id: 'stored_tool_observations', label: 'Stored tool observations', tokens: storedObservationTokens, active: storedObservationTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'stored' },
      { id: 'raw_tool_storage', label: 'Raw tool storage', tokens: rawToolStorageTokens, active: rawToolStorageTokens > 0, includedInContext: false, outOfBand: true, percentLabel: 'stored' },
      ...(lastTurnUsageRow ? [lastTurnUsageRow] : []),
      { id: 'logged_provider_usage', label: 'Logged provider usage', tokens: Math.max(0, Number(input.modelUsage?.totalTokens || 0)), active: Number(input.modelUsage?.totalTokens || 0) > 0, includedInContext: false, outOfBand: true, percentLabel: 'total', children: providerUsageChildren },
    ],
  };
}

function persistVoiceAgentVisibleTurn(sessionId: string, transcript: string, voiceReply: string, action: string, eventId: string, processEntries: any[]): string {
  const rawSid = String(sessionId || '').trim();
  const userText = compactVoiceText(transcript || '', 1200);
  const replyText = String(voiceReply || '').trim();
  const id = String(eventId || '').trim();
  if (!rawSid || !userText || !replyText) return rawSid;
  // A voice-first new chat on mobile can still be sitting on the throwaway
  // 'mobile_default' draft slot when the realtime handoff posts here. The
  // mobile drawer never lists 'mobile_default', so persisting a durable turn
  // under it orphans the whole conversation (works live, vanishes on nav).
  // Rotate to a real mobile_<id> session and register it as channel 'mobile'
  // so it surfaces in the session list exactly like a text-first chat does.
  let sid = rawSid;
  if (rawSid === 'mobile_default') {
    sid = `mobile_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
    try {
      // Register the real session as channel 'mobile' so the drawer lists it.
      // Do not seed a title message here: the user turn added below becomes
      // the first message and the drawer derives the title from history,
      // which avoids a duplicate user bubble.
      touchSession(sid, { channel: 'mobile' });
      flushSession(sid);
    } catch (registerErr: any) {
      console.warn('[voice-agent] failed to register rotated mobile voice session:', registerErr?.message || registerErr);
    }
  }
  try {
    const session = getSession(sid);
    const history = Array.isArray(session.history) ? session.history : [];
    if (id && history.some((msg: any) => String(msg?.voiceInterruptionEventId || '') === id && String(msg?.content || '').trim() === replyText)) {
      return sid;
    }
    const groupId = `voice_workflow_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const now = Date.now();
    addMessage(sid, {
      role: 'user',
      content: userText,
      timestamp: now,
      channel: 'voice',
      channelLabel: 'voice',
      workflowGroupId: groupId,
      workflowPart: 'interruption',
      workflowLabel: action === 'handoff_new_work' ? 'Voice request' : 'Voice interruption',
      voiceInterruptionEventId: id || undefined,
    } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    addMessage(sid, {
      role: 'assistant',
      content: replyText,
      timestamp: now + 1,
      source: 'voice_agent',
      processEntries: Array.isArray(processEntries) ? processEntries : [],
      workflowGroupId: groupId,
      workflowPart: action === 'interrupt_worker' ? 'abort_response' : 'interruption_response',
      workflowLabel: action === 'interrupt_worker' ? 'Abort response' : 'Interruption response',
      voiceInterruptionEventId: id || undefined,
    } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    flushSession(sid);
  } catch (err: any) {
    console.warn('[voice-agent] failed to persist visible voice turn:', err?.message || err);
  }
  return sid;
}

function hasRecentVoiceWorkflowUserMessage(sessionId: string, message: string, maxAgeMs = 180000): boolean {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!sessionId || !text) return false;
  try {
    const history = Array.isArray(getSession(sessionId).history) ? getSession(sessionId).history : [];
    const now = Date.now();
    return history.some((msg: any) => {
      if (msg?.role !== 'user') return false;
      if (!String(msg?.voiceInterruptionEventId || '').trim() && !String(msg?.workflowGroupId || '').trim()) return false;
      if (String(msg?.content || '').replace(/\s+/g, ' ').trim() !== text) return false;
      const ts = Number(msg?.timestamp || 0);
      return !Number.isFinite(ts) || ts <= 0 || now - ts <= maxAgeMs;
    });
  } catch {
    return false;
  }
}

function buildFastRouteSpokenReply(toolName: string, toolResult: any): string {
  const ok = toolResult?.ok !== false;
  const summary = compactVoiceText(toolResult?.summary || toolResult?.stdout || toolResult?.error || '', 600);
  if (!ok) return `${friendlyVoiceToolName(toolName)} failed${summary ? `: ${summary}` : '.'}`;
  switch (toolName) {
    case 'voice_web_search': return summary ? `Here's what I found: ${summary}` : 'Search complete.';
    case 'voice_web_fetch': return summary ? `Here's the content: ${summary}` : 'Fetched.';
    case 'voice_memory_search': return summary ? `From memory: ${summary}` : 'Nothing found in memory.';
    case 'voice_agent_memory': return summary || 'Voice agent memory updated.';
    case 'skill_list':
    case 'voice_skill_lookup': return summary ? `Available workflows: ${summary}` : 'No matching skills found.';
    case 'skill_read':
    case 'voice_skill_read': return summary || 'Skill loaded.';
    case 'skill_resource_list': return summary || 'Skill resources listed.';
    case 'skill_resource_read':
    case 'voice_skill_resource_read': return summary || 'Skill resource loaded.';
    case 'voice_write_note': return summary || 'Note saved.';
    case 'voice_set_wake_phrase': return summary || 'Wake phrase updated.';
    case 'voice_enter_quiet_mode': return summary || 'Quiet mode is ready.';
    case 'voice_set_quiet_until': return summary || 'Quiet mode is ready.';
    case 'voice_timer': return summary || 'Timer set.';
    case 'voice_automation_dashboard': return summary || 'Automation snapshot loaded.';
    case 'voice_browser_open': return summary || 'Browser opened.';
    case 'voice_browser_scroll': return summary || 'Browser scrolled.';
    case 'voice_browser_screenshot': return summary || 'Browser screenshot captured.';
    case 'voice_desktop_screenshot': return summary || 'Desktop captured.';
    case 'voice_desktop_focus_window': return summary || 'Window focused.';
    case 'voice_desktop_launch_app': return summary || 'App launched.';
    case 'voice_send_screenshot': return summary || 'Screenshot sent.';
    default: return summary || `${friendlyVoiceToolName(toolName)} complete.`;
  }
}

function getVoiceAgentSynthModel(): string | undefined {
  try {
    const raw = (getConfig() as any).getConfig() as any;
    const configured = String(raw?.voice?.agent?.synth_model || raw?.agent_model_defaults?.voice_agent_synth || '').trim();
    if (configured) return configured;
    const active: string = String(raw?.llm?.provider || 'ollama').trim();
    const miniDefaults: Record<string, string> = {
      openai: 'gpt-4o-mini',
      openai_codex: 'gpt-4o-mini',
      anthropic: 'claude-haiku-4-5-20251001',
      gemini: 'gemini-2.0-flash-lite',
      xai: 'grok-3-mini-fast',
    };
    return miniDefaults[active];
  } catch {
    return undefined;
  }
}

function buildDeterministicHandoffAck(transcript: string): string {
  const text = String(transcript || '').trim().toLowerCase();
  const verbGerunds: Array<[RegExp, string]> = [
    [/\brun(ning)?\b/, 'Running that'],
    [/\btest(ing)?\b/, 'Testing that'],
    [/\bbuild(ing)?\b/, 'Building that'],
    [/\bsearch(ing|ed)?\b/, 'Searching now'],
    [/\bfind\b|\bfinding\b/, 'Finding that'],
    [/\bwrit(e|ing)\b/, 'Writing that'],
    [/\bedit(ing)?\b/, 'Editing that'],
    [/\bfix(ing)?\b/, 'Fixing that'],
    [/\bopen(ing)?\b/, 'Opening that'],
    [/\bcreat(e|ing)\b/, 'Creating that'],
    [/\bcheck(ing)?\b/, 'Checking that'],
    [/\binstall(ing)?\b/, 'Installing that'],
    [/\bgenerat(e|ing)\b/, 'Generating that'],
    [/\banalyz(e|ing)\b/, 'Analyzing that'],
    [/\bstart(ing)?\b/, 'Starting that'],
    [/\bupdat(e|ing)\b/, 'Updating that'],
    [/\bdebu(g|gging)\b/, 'Debugging that'],
    [/\bsend(ing)?\b/, 'Sending that'],
    [/\bdownload(ing)?\b/, 'Downloading that'],
    [/\bnavigate|navigating\b/, 'Navigating there'],
    [/\blaunch(ing)?\b/, 'Launching that'],
    [/\bcompil(e|ing)\b/, 'Compiling that'],
    [/\bdeploy(ing)?\b/, 'Deploying that'],
    [/\bscreenshot\b/, 'Capturing that'],
    [/\bremind(er)?\b|\btimer\b/, 'Setting that timer'],
    [/\bremember\b|\bjot\b|\bnote\b/, 'Saving that note'],
  ];
  for (const [pattern, ack] of verbGerunds) {
    if (pattern.test(text)) return `${ack} now.`;
  }
  return 'On it.';
}

// Plain-text streaming sentence flusher — feed raw token chunks, get sentence
// callbacks. Used for synthesis passes that return plain text (not JSON-wrapped).
function createPlainTextSentenceStreamer(onSentence: (text: string) => void) {
  let pending = '';
  let totalChars = 0;
  const MAX_PENDING_NO_PUNCT = 140;
  const SENTENCE_END_RE = /[.!?]["')\]]*\s|[.!?]["')\]]*$|;\s/;
  function flush(final = false) {
    if (!pending) return;
    while (true) {
      const m = pending.match(SENTENCE_END_RE);
      if (!m) break;
      const end = (m.index ?? 0) + m[0].length;
      const sentence = pending.slice(0, end).trim();
      pending = pending.slice(end);
      if (sentence) onSentence(sentence);
    }
    if (!final && pending.length >= MAX_PENDING_NO_PUNCT) {
      const lastSpace = pending.lastIndexOf(' ', MAX_PENDING_NO_PUNCT);
      const cut = lastSpace > 40 ? lastSpace : MAX_PENDING_NO_PUNCT;
      const sentence = pending.slice(0, cut).trim();
      pending = pending.slice(cut).replace(/^\s+/, '');
      if (sentence) onSentence(sentence);
    }
    if (final && pending.trim()) {
      onSentence(pending.trim());
      pending = '';
    }
  }
  return {
    feed(chunk: string) {
      if (!chunk) return;
      pending += chunk;
      totalChars += chunk.length;
      if (totalChars > 4000) { flush(true); return; }
      flush(false);
    },
    finish() { flush(true); },
  };
}

// Stream parser: extracts characters from the value of "spokenReply" in a JSON
// object as model tokens arrive. Handles JSON string escapes and key variants.
// Emits sentence-sized chunks to onSentence as they complete.
function createSpokenReplyStreamer(onSentence: (text: string) => void) {
  type State =
    | 'find_key'
    | 'after_key'
    | 'expect_colon'
    | 'expect_quote'
    | 'in_value'
    | 'in_value_escape'
    | 'done';
  let state: State = 'find_key';
  let buf = '';                    // rolling buffer for key detection
  let valueAccum = '';             // accumulated decoded characters of spokenReply
  let pending = '';                // characters not yet emitted as a sentence
  let totalChars = 0;
  const KEY_PATTERNS = [/"spokenReply"\s*:/i, /"voiceReply"\s*:/i, /"spoken_reply"\s*:/i];
  const MAX_PENDING_NO_PUNCT = 140;   // flush if too long without sentence-end
  const SENTENCE_END_RE = /[.!?]["')\]]*\s|[.!?]["')\]]*$|;\s/;

  function flushSentences(final = false) {
    if (!pending) return;
    while (true) {
      const m = pending.match(SENTENCE_END_RE);
      if (!m) break;
      const end = (m.index ?? 0) + m[0].length;
      const sentence = pending.slice(0, end).trim();
      pending = pending.slice(end);
      if (sentence) onSentence(sentence);
    }
    if (!final && pending.length >= MAX_PENDING_NO_PUNCT) {
      // emit as a soft chunk at a space boundary if possible
      const lastSpace = pending.lastIndexOf(' ', MAX_PENDING_NO_PUNCT);
      const cut = lastSpace > 40 ? lastSpace : MAX_PENDING_NO_PUNCT;
      const sentence = pending.slice(0, cut).trim();
      pending = pending.slice(cut).replace(/^\s+/, '');
      if (sentence) onSentence(sentence);
    }
    if (final && pending.trim()) {
      onSentence(pending.trim());
      pending = '';
    }
  }

  function decodeEscape(ch: string): string {
    switch (ch) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '';
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '';
      case 'f': return '';
      default: return ch;
    }
  }

  function feedValueChar(ch: string) {
    valueAccum += ch;
    pending += ch;
    totalChars += 1;
    if (totalChars > 4000) {
      // safety cap; stop accumulating
      state = 'done';
      flushSentences(true);
      return;
    }
    flushSentences(false);
  }

  return {
    feed(chunk: string) {
      if (state === 'done' || !chunk) return;
      let i = 0;
      while (i < chunk.length) {
        const ch = chunk[i];
        if (state === 'find_key') {
          buf += ch;
          if (buf.length > 4096) buf = buf.slice(-2048);
          for (const re of KEY_PATTERNS) {
            const m = buf.match(re);
            if (m) {
              state = 'expect_quote';
              buf = '';
              break;
            }
          }
          i++;
          continue;
        }
        if (state === 'expect_quote') {
          if (ch === '"') {
            state = 'in_value';
            i++;
            continue;
          }
          if (/\s/.test(ch)) { i++; continue; }
          // unexpected — bail
          state = 'done';
          flushSentences(true);
          return;
        }
        if (state === 'in_value') {
          if (ch === '\\') {
            state = 'in_value_escape';
            i++;
            continue;
          }
          if (ch === '"') {
            state = 'done';
            flushSentences(true);
            return;
          }
          feedValueChar(ch);
          i++;
          continue;
        }
        if (state === 'in_value_escape') {
          if (ch === 'u') {
            // unicode escape \uXXXX — consume 4 hex chars
            const hex = chunk.slice(i + 1, i + 5);
            if (hex.length === 4) {
              try {
                const code = parseInt(hex, 16);
                if (!Number.isNaN(code)) feedValueChar(String.fromCharCode(code));
              } catch {}
              i += 5;
            } else {
              // need more data — break and wait for next feed
              return;
            }
            state = 'in_value';
            continue;
          }
          feedValueChar(decodeEscape(ch));
          state = 'in_value';
          i++;
          continue;
        }
        i++;
      }
    },
    finish() {
      if (state !== 'done') {
        state = 'done';
        flushSentences(true);
      }
    },
    getAccumulated(): string {
      return valueAccum;
    },
    isComplete(): boolean {
      return state === 'done';
    },
  };
}

async function callVoiceAgentDecisionModel(
  sessionId: string,
  transcript: string,
  classification: ReturnType<typeof classifyVoiceInterruption>,
  contextPacket: Record<string, any>,
  fallback: VoiceAgentDecision,
  trace?: VoiceAgentProcessEntry[],
  onSpeechChunk?: (text: string) => void,
  options?: { disableDeterministicFastRoutes?: boolean; voiceTarget?: VoiceAgentTargetContext },
): Promise<VoiceAgentDecision> {
  try {
    const startedAt = Date.now();
    const targetIdentity = voiceAgentTargetIdentity(options?.voiceTarget);
    const contextStartedAt = Date.now();
    const contextBlockResult = await getVoiceAgentContextBlock(sessionId, transcript, { voiceTarget: options?.voiceTarget });
    const contextBuildMs = contextBlockResult.elapsedMs || (Date.now() - contextStartedAt);
    const contextBlock = contextBlockResult.contextBlock;
    pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: context ${contextBlockResult.cacheHit ? 'cache hit' : 'build'} ${contextBuildMs}ms.`, {
      stage: contextBlockResult.cacheHit ? 'voice_context_cache_hit' : 'voice_context_build',
      elapsedMs: contextBuildMs,
      cacheHit: contextBlockResult.cacheHit,
      totalMs: Date.now() - startedAt,
    });
    const voiceAutomationSkillScoutSeen = new Set<string>();
    const deterministicFastRoutesDisabled = options?.disableDeterministicFastRoutes === true;
    const detectedFallbackToolRequest = findVoiceToolFallbackRequest(transcript);
    const runtimeControlFastRouteAllowed = deterministicFastRoutesDisabled && isVoiceRuntimeControlTool(detectedFallbackToolRequest?.name || '');
    const fallbackToolRequest = deterministicFastRoutesDisabled && !runtimeControlFastRouteAllowed ? null : detectedFallbackToolRequest;
    if ((runtimeControlFastRouteAllowed || !deterministicFastRoutesDisabled) && fallbackToolRequest?.name === 'voice_set_wake_phrase') {
      const content = await executeVoiceAgentToolWithTrace(sessionId, fallbackToolRequest.name, fallbackToolRequest.args, trace);
      const parsedTool = parseVoiceToolResult(content);
      const phrase = cleanVoiceWakePhrase(parsedTool?.wakePhrase || fallbackToolRequest.args?.phrase || '');
      const acknowledgementMessages = [
        {
          role: 'system',
          content: [
            targetIdentity.identityLine,
            'The user just set their wake phrase. Acknowledge naturally in one short spoken sentence.',
            'Do not say you will remember it forever. Do not mention implementation details. Return only the sentence, no JSON.',
          ].join('\n'),
        },
        { role: 'user', content: transcript },
      ];
      let spokenReply = phrase ? `Your wake phrase is now ${phrase}.` : 'Your wake phrase is updated.';
      try {
        const ackStartedAt = Date.now();
        let streamedAck = false;
        const ackStreamer = onSpeechChunk
          ? createPlainTextSentenceStreamer((sentence) => {
              streamedAck = true;
              try { onSpeechChunk(sentence); } catch {}
            })
          : null;
        const ack = await getOllamaClient().chatWithThinking(acknowledgementMessages, 'executor', {
          temperature: 0.4,
          num_ctx: 1024,
          num_predict: 40,
          think: 'none',
          usageContext: { sessionId, agentId: 'voice_agent' },
          onToken: ackStreamer ? ((chunk: string) => ackStreamer.feed(chunk)) : undefined,
        } as any);
        if (ackStreamer) ackStreamer.finish();
        const modelAck = compactVoiceText(String(ack?.message?.content || '').replace(/^```[\s\S]*?```$/g, '').trim(), 180);
        if (modelAck) spokenReply = modelAck;
        if (onSpeechChunk && !streamedAck && spokenReply) {
          try { onSpeechChunk(spokenReply); } catch {}
        }
        pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: wake phrase acknowledgement ${Date.now() - ackStartedAt}ms.`, {
          stage: 'voice_wake_phrase_ack',
          elapsedMs: Date.now() - ackStartedAt,
          totalMs: Date.now() - startedAt,
        });
      } catch (err: any) {
        pushVoiceAgentProcessEntry(trace, 'warn', `Wake phrase acknowledgement model failed: ${String(err?.message || err).slice(0, 180)}`, {
          stage: 'voice_wake_phrase_ack_failed',
          totalMs: Date.now() - startedAt,
        });
      }
      return {
        action: 'answer_now',
        spokenReply,
        workerInstruction: '',
        needsWorkerResponse: false,
        reason: 'voice_runtime_tool_fast_route:set_wake_phrase',
        runtimeDirectives: phrase ? [{ action: 'set_wake_phrase', wakePhrase: phrase }] : [],
      };
    }
    // Fast-route: transcript clearly matches a voice tool and no worker is active.
    // Routing/decision model skipped entirely. Reply is built deterministically from
    // the tool result — no synthesis model call (cloud models take 500–4000ms even
    // with max_tokens=120; that defeats the purpose of fast-routing).
    // When a worker IS active we keep the full model path so it can decide whether
    // to answer, steer, or interrupt.
    if (
      (!deterministicFastRoutesDisabled || runtimeControlFastRouteAllowed)
      &&
      fallbackToolRequest
      && !classification.shouldAbortOriginalRun
      && !classification.shouldPauseOriginalRun
      && (contextPacket.active !== true || isVoiceRuntimeControlTool(fallbackToolRequest.name))
    ) {
      const toolStartedAt = Date.now();
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: deterministic tool fast-route ${fallbackToolRequest.name} — routing model skipped.`, {
        stage: 'voice_fast_router',
        route: `tool:${fallbackToolRequest.name}`,
        totalMs: Date.now() - startedAt,
      });
      await runVoiceAutomationSkillScout(sessionId, transcript, fallbackToolRequest.name, trace, voiceAutomationSkillScoutSeen);
      const raw = await executeVoiceAgentToolWithTrace(sessionId, fallbackToolRequest.name, fallbackToolRequest.args, trace);
      const toolResult = parseVoiceToolResult(raw);
      const runtimeDirective = voiceRuntimeDirectiveFromToolResult(toolResult);
      const runtimeDirectives = runtimeDirective ? [runtimeDirective] : [];
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: deterministic tool execute ${Date.now() - toolStartedAt}ms.`, {
        stage: 'voice_fast_router_tool_done',
        tool: fallbackToolRequest.name,
        ok: toolResult?.ok !== false,
        elapsedMs: Date.now() - toolStartedAt,
        totalMs: Date.now() - startedAt,
      });
      // Synthesis pass: transcript + tool result → one spoken reply.
      // Uses the fastest available model (mini/haiku tier), not the primary executor.
      // No personality context, no tool defs, no JSON schema — tiny prompt, tiny output.
      const fallbackSpokenReply = buildFastRouteSpokenReply(fallbackToolRequest.name, toolResult);
      let spokenReply = fallbackSpokenReply;
      try {
        const synthStartedAt = Date.now();
        const resultSummary = compactVoiceText(toolResult?.summary || toolResult?.stdout || toolResult?.error || '', 1200);
        const synthMessages = [
          {
            role: 'system',
            content: [
              `You are ${targetIdentity.speakerName} on voice. The user asked something and you already ran a tool to get the answer.`,
              'Write a single spoken reply (1-3 sentences max) that delivers the result naturally and conversationally.',
              `Speak as ${targetIdentity.speakerName}: warm, direct, specific. Do not use markdown or bullet characters.`,
              targetIdentity.isSubagent ? 'Do not claim to be Prometheus. Do not mention getting or asking a worker.' : '',
              'Return only the spoken reply — no JSON, no labels, no meta-commentary.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `User said: "${compactVoiceText(transcript, 300)}"`,
              '',
              `Tool: ${friendlyVoiceToolName(fallbackToolRequest.name)}`,
              `Result: ${toolResult?.ok !== false ? resultSummary || 'Complete.' : `Failed — ${resultSummary}`}`,
            ].join('\n'),
          },
        ];
        let firstSynthChunk = true;
        let streamedAny = false;
        const synthStreamer = onSpeechChunk
          ? createPlainTextSentenceStreamer((sentence) => {
              streamedAny = true;
              if (firstSynthChunk) {
                firstSynthChunk = false;
                pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: first synth speech chunk ${Date.now() - synthStartedAt}ms.`, {
                  stage: 'voice_fast_router_first_speech_chunk',
                  elapsedMs: Date.now() - synthStartedAt,
                  totalMs: Date.now() - startedAt,
                });
              }
              try { onSpeechChunk(sentence); } catch {}
            })
          : null;
        const synthResult = await getOllamaClient().chatWithThinking(synthMessages, 'executor', {
          temperature: 0.3,
          model: getVoiceAgentSynthModel(),
          num_ctx: 1024,
          num_predict: 120,
          think: 'none',
          usageContext: { sessionId, agentId: 'voice_agent' },
          onToken: synthStreamer ? ((chunk: string) => synthStreamer.feed(chunk)) : undefined,
        } as any);
        if (synthStreamer) synthStreamer.finish();
        const synthText = compactVoiceText(String(synthResult?.message?.content || '').trim(), 700);
        if (synthText) spokenReply = synthText;
        // If streaming didn't yield anything (provider doesn't support onToken),
        // emit the final spokenReply as a single chunk so the client still speaks.
        if (onSpeechChunk && !streamedAny && spokenReply) {
          try { onSpeechChunk(spokenReply); } catch {}
        }
        pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: tool reply synthesis ${Date.now() - synthStartedAt}ms.`, {
          stage: 'voice_fast_router_synthesis',
          elapsedMs: Date.now() - synthStartedAt,
          totalMs: Date.now() - startedAt,
        });
      } catch (err: any) {
        pushVoiceAgentProcessEntry(trace, 'warn', `Tool reply synthesis failed, using fallback: ${String(err?.message || err).slice(0, 180)}`, {
          stage: 'voice_fast_router_synthesis_failed',
          totalMs: Date.now() - startedAt,
        });
      }
      return {
        action: 'answer_now',
        spokenReply,
        workerInstruction: '',
        needsWorkerResponse: false,
        reason: `deterministic_tool_fast_route:${fallbackToolRequest.name}`,
        runtimeDirectives,
      } as VoiceAgentDecision;
    }
    const smallTalkReply = deterministicFastRoutesDisabled ? '' : deterministicVoiceSmallTalkReply(transcript, contextPacket);
    if (smallTalkReply && fallback.action === 'answer_now' && !classification.shouldAbortOriginalRun && !classification.shouldPauseOriginalRun) {
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: deterministic small-talk route ${Date.now() - startedAt}ms.`, {
        stage: 'voice_fast_router',
        route: 'small_talk',
        elapsedMs: Date.now() - startedAt,
      });
      if (onSpeechChunk) { try { onSpeechChunk(smallTalkReply); } catch {} }
      return {
        action: 'answer_now',
        spokenReply: smallTalkReply,
        workerInstruction: '',
        needsWorkerResponse: false,
        reason: 'deterministic_small_talk',
      };
    }
    const wantsVoiceTool = !!fallbackToolRequest;
    const lightVoiceDecision = !wantsVoiceTool
      && contextPacket.active !== true
      && (fallback.action === 'answer_now' || fallback.action === 'handoff_new_work')
      && !classification.shouldAbortOriginalRun
      && !classification.shouldPauseOriginalRun;
    const system = lightVoiceDecision
      ? buildVoiceAgentLightSystemPrompt(contextBlock, contextPacket, options?.voiceTarget)
      : buildVoiceAgentSystemPrompt(contextBlock, contextPacket, options?.voiceTarget);
    const user = [
      '[VOICE_TRANSCRIPT]',
      transcript || '(empty)',
      '[/VOICE_TRANSCRIPT]',
      '',
      '[CLASSIFIER_HINT]',
      JSON.stringify(classification, null, 2),
      '[/CLASSIFIER_HINT]',
    ].join('\n');
    const messages: any[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    let result: any = null;
    const tools = lightVoiceDecision ? [] : buildVoiceToolDefinitions();
    const decisionStartedAt = Date.now();
    let modelStreamedAnySpeech = false;
    for (let i = 0; i < 3; i++) {
      const loopStartedAt = Date.now();
      // Stream the spokenReply field directly to TTS as the model generates it.
      // Only emit chunks on the final pass (no tool calls expected) — we don't
      // know in advance, so instantiate a streamer fresh and rely on it producing
      // no output when the model returns tool_calls.
      let firstChunkLogged = false;
      const streamer = onSpeechChunk
        ? createSpokenReplyStreamer((sentence) => {
            if (!firstChunkLogged) {
              firstChunkLogged = true;
              modelStreamedAnySpeech = true;
              pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: first speech chunk ${Date.now() - decisionStartedAt}ms after decision start.`, {
                stage: 'voice_model_first_speech_chunk',
                elapsedMs: Date.now() - decisionStartedAt,
                totalMs: Date.now() - startedAt,
              });
            }
            try { onSpeechChunk(sentence); } catch {}
          })
        : null;
      result = await getOllamaClient().chatWithThinking(messages, 'executor', {
        tools: !lightVoiceDecision && i < 2 ? tools : undefined,
        temperature: 0.2,
        num_ctx: lightVoiceDecision ? 2048 : 4096,
        num_predict: lightVoiceDecision ? 120 : 250,
        think: 'none',
        usageContext: { sessionId, agentId: 'voice_agent' },
        onToken: streamer ? ((chunk: string) => streamer.feed(chunk)) : undefined,
      } as any);
      if (streamer) streamer.finish();
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: decision pass ${i + 1} ${Date.now() - loopStartedAt}ms.`, {
        stage: 'voice_model_decision',
        pass: i + 1,
        elapsedMs: Date.now() - loopStartedAt,
        totalMs: Date.now() - startedAt,
      });
      const message = result?.message || {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!toolCalls.length || i >= 2) break;
      messages.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: toolCalls,
      });
      for (const call of toolCalls.slice(0, 2)) {
        const name = String(call?.function?.name || '').trim();
        const args = parseVoiceToolArgs(call?.function?.arguments);
        await runVoiceAutomationSkillScout(sessionId, transcript, name, trace, voiceAutomationSkillScoutSeen);
        const content = await executeVoiceAgentToolWithTrace(sessionId, name, args, trace);
        messages.push({
          role: 'tool',
          tool_call_id: call?.id || `voice_tool_${Date.now()}`,
          tool_name: name,
          name,
          content,
        });
      }
    }
    const content = String(result?.message?.content || '').trim();
    const parsed = safeParseVoiceAgentJson(content);
    if (!parsed) return fallback;
    const normalized = normalizeVoiceAgentDecision(parsed, fallback);
    if (classification.shouldAbortOriginalRun) normalized.action = 'interrupt_worker';
    if (classification.shouldPauseOriginalRun && normalized.action !== 'interrupt_worker') normalized.action = 'answer_now';
    if (normalized.action === 'handoff_new_work' && !String(normalized.spokenReply || '').trim()) {
      normalized.spokenReply = buildDeterministicHandoffAck(transcript);
      normalized.reason = `${normalized.reason || 'voice_handoff'};deterministic_ack_fallback`;
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: handoff ack deterministic fallback (no repair pass).`, {
        stage: 'voice_handoff_ack_deterministic',
        ack: normalized.spokenReply,
        totalMs: Date.now() - startedAt,
      });
    }
    // If streaming did not produce any speech chunks during the decision pass
    // (e.g., provider does not support onToken, or the model returned tool calls
    // for the entire loop), emit the final spokenReply as a single chunk so the
    // client still speaks. This is the safety net — streaming is the fast path.
    if (onSpeechChunk && !modelStreamedAnySpeech && normalized.spokenReply) {
      try { onSpeechChunk(normalized.spokenReply); } catch {}
    }
    pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: model decision total ${Date.now() - decisionStartedAt}ms.`, {
      stage: 'voice_model_decision_total',
      elapsedMs: Date.now() - decisionStartedAt,
      totalMs: Date.now() - startedAt,
      action: normalized.action,
    });
    return normalized;
  } catch (err: any) {
    console.warn('[voice-agent] model decision failed:', err?.message || err);
    return fallback;
  }
}

function composeVoiceAgentNarration(contextPacket: Record<string, any>, options: Record<string, any> = {}): { action: 'reply' | 'no_reply'; voiceReply: string; signature: string } {
  if (!contextPacket.active) return { action: 'no_reply', voiceReply: '', signature: 'inactive' };
  const sid = String(contextPacket.sessionId || 'default');
  const latestProcess = Array.isArray(contextPacket.processEntries)
    ? contextPacket.processEntries
        .map((entry: any) => ({
          ...entry,
          content: compactVoiceText(entry?.content || '', 260),
        }))
        .filter((entry: any) => entry.content && !isVoiceContextNoiseText(entry.content))
        .slice(-4)
    : [];
  const latestActivity = [...latestProcess].reverse()
    .map((entry: any) => voiceNarrationLineFromActivity(entry.content))
    .find(Boolean) || '';
  const activeLabel = voiceNarrationLineFromActivity(contextPacket.activeToolLabel || '');
  const speakable = latestActivity || activeLabel;
  const signature = [
    contextPacket.activeRun?.id || '',
    speakable,
    latestProcess.map((entry: any) => `${entry.event || entry.type}:${entry.toolName || ''}:${entry.content || ''}`).join('|'),
  ].join('::').slice(0, 1600);
  if (!speakable) return { action: 'no_reply', voiceReply: '', signature };
  const now = Date.now();
  const minGapMs = Math.max(5500, Math.floor(Number(options.minGapMs || 6500)) || 6500);
  const previous = voiceAgentNarrationState.get(sid);
  if ((previous?.signature === signature || previous?.text === speakable) && now - Number(previous.at || 0) < Math.max(minGapMs, 18000)) {
    return { action: 'no_reply', voiceReply: '', signature };
  }
  const voiceReply = compactVoiceText(speakable, 240);
  voiceAgentNarrationState.set(sid, { signature, at: now, text: voiceReply });
  return { action: voiceReply ? 'reply' : 'no_reply', voiceReply, signature };
}

router.get('/api/mobile/chat/stream/:sessionId', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Session id required.' });
      return;
    }
    pruneMainChatStreams();
    const after = Math.max(0, Math.floor(Number(req.query.after || 0)) || 0);
    const stream = getMainChatStream(sessionId);
    const activeRuntime = listLiveRuntimes()
      .filter((runtime) => isLiveRunningRuntime(runtime) && (runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal') && String(runtime.sessionId || '') === sessionId)
      .map(summarizeMobileRuntime)
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0] || null;
    const frames = stream
      ? stream.events
        .filter((frame) => Number(frame.seq || 0) > after)
        .map((frame) => ({
          seq: frame.seq,
          type: frame.type,
          at: frame.at,
          streamId: stream.streamId,
          data: frame.data || {},
        }))
      : [];
    res.json({
      success: true,
      sessionId,
      active: !!activeRuntime || !!stream?.active,
      run: activeRuntime,
      stream: stream ? {
        streamId: stream.streamId,
        active: stream.active,
        startedAt: stream.startedAt,
        updatedAt: stream.updatedAt,
        completedAt: stream.completedAt || null,
        nextSeq: stream.nextSeq,
        firstSeq: stream.events[0]?.seq || 0,
        lastSeq: stream.events[stream.events.length - 1]?.seq || 0,
      } : null,
      events: frames,
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/mobile/chat/runs', (_req, res) => {
  try {
    const runtimes = listLiveRuntimes()
      .filter((runtime) => isLiveRunningRuntime(runtime) && (runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal'))
      .map(summarizeMobileRuntime)
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
    res.json({
      success: true,
      activeSessionIds: Array.from(new Set(runtimes.map((runtime) => String(runtime.sessionId || '')).filter(Boolean))),
      runs: runtimes,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/mobile/chat/runs/:sessionId', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Session id required.' });
      return;
    }
    const active = listLiveRuntimes()
      .filter((runtime) => isLiveRunningRuntime(runtime) && (runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal') && String(runtime.sessionId || '') === sessionId)
      .map(summarizeMobileRuntime)
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0] || null;
    const session = getSession(sessionId);
    const history = Array.isArray(session?.history) ? session.history : [];
    const latestAssistant = [...history].reverse().find((entry: any) => entry?.role === 'assistant') || null;
    const latestUser = [...history].reverse().find((entry: any) => entry?.role === 'user') || null;
    res.json({
      success: true,
      active: !!active,
      run: active,
      sessionId,
      historyLength: history.length,
      lastActiveAt: Number(session?.lastActiveAt || 0) || null,
      latestAssistant: latestAssistant ? {
        content: String(latestAssistant.content || ''),
        timestamp: Number(latestAssistant.timestamp || 0) || null,
      } : null,
      latestUser: latestUser ? {
        content: String(latestUser.content || ''),
        timestamp: Number(latestUser.timestamp || 0) || null,
      } : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/mobile/commands/models', async (_req, res) => {
  try {
    const cfg = getConfig().getConfig() as any;
    const activeProvider = cfg.llm?.provider || 'ollama';
    const providers = Object.entries(cfg.llm?.providers || {}).map(([id, value]: [string, any]) => ({
      id,
      model: String(value?.model || ''),
      endpoint: String(value?.endpoint || ''),
      active: id === activeProvider,
    }));
    res.json({
      success: true,
      activeProvider,
      activeModel: cfg.llm?.providers?.[activeProvider]?.model || cfg.models?.primary || 'unknown',
      providers,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/mobile/commands/stop-targets', (_req, res) => {
  try {
    res.json({ success: true, targets: listLiveRuntimes().filter(isLiveRunningRuntime).map(summarizeMobileRuntime) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/commands/stop-now', (req, res) => {
  try {
    const requestedSessionId = String(req.body?.sessionId || '').trim();
    const sessionId = requestedSessionId ? assertSafeStorageId(requestedSessionId, 'session id') : '';
    const runtimeId = String(req.body?.runtimeId || req.body?.id || '').trim();
    const runtimeById = runtimeId ? getLiveRuntime(runtimeId) : null;
    const target = runtimeById?.kind === 'main_chat'
      && runtimeById.abortable
      && isLiveRunningRuntime(runtimeById)
      && (!sessionId || String(runtimeById.sessionId || '') === sessionId)
      ? runtimeById
      : listLiveRuntimes()
        .filter((runtime) =>
          isLiveRunningRuntime(runtime)
            && runtime.kind === 'main_chat'
            && runtime.abortable
            && (!sessionId || String(runtime.sessionId || '') === sessionId)
        )
        .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];

    // Cancel any background_spawn agents launched by this chat session too —
    // the user expects "stop" to kill everything running on their behalf.
    const abortedBackgroundIds = sessionId
      ? listActiveBackgroundIdsForSession(sessionId).filter((id) => backgroundAbort(id).ok)
      : [];

    if (!target) {
      if (abortedBackgroundIds.length > 0) {
        res.json({
          success: true,
          message: `Stopped ${abortedBackgroundIds.length} background agent${abortedBackgroundIds.length === 1 ? '' : 's'}.`,
          abortedBackgroundIds,
        });
        return;
      }
      res.json({ success: false, message: 'No active main chat turn is currently running for this session.' });
      return;
    }
    const result = abortLiveRuntime(target.id);
    res.json({
      success: result.ok,
      message: result.ok ? 'Main chat aborted.' : (result.error || 'Abort failed.'),
      target: summarizeMobileRuntime(result.runtime || target),
      abortedBackgroundIds,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/commands/stop', (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    if (!id) {
      res.status(400).json({ success: false, error: 'Runtime id required.' });
      return;
    }
    const runtime = getLiveRuntime(id);
    if (!runtime) {
      res.status(404).json({ success: false, error: 'Runtime is no longer active.' });
      return;
    }
    const result = abortLiveRuntime(id);
    res.json({
      success: result.ok,
      message: result.ok ? 'Runtime aborted.' : (result.error || 'Abort failed.'),
      target: summarizeMobileRuntime(result.runtime || runtime),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/commands/screenshot', async (req, res) => {
  try {
    req.setTimeout?.(120_000);
    res.setTimeout?.(120_000);
    req.socket?.setTimeout?.(120_000);
    const sessionId = assertSafeStorageId(String(req.body?.sessionId || 'mobile_default').trim() || 'mobile_default', 'session id');
    const target = String(req.body?.target || 'desktop').trim().toLowerCase();
    const captureDesktop = async (options: any) => {
      const result = await desktopScreenshotWithHistory(sessionId, { ...options, skipOcr: true });
      const packet = getDesktopAdvisorPacket(sessionId);
      return {
        success: !/^ERROR:/i.test(String(result || '')),
        result,
        image: packet?.screenshotBase64 ? {
          base64: packet.screenshotBase64,
          mimeType: packet.screenshotMime || 'image/png',
          width: packet.width,
          height: packet.height,
          screenshotId: packet.screenshotId,
        } : null,
      };
    };
    if (target === 'monitors') {
      res.json({ success: true, result: await desktopGetMonitorsSummary() });
      return;
    }
    if (target === 'desktop') {
      const monitors = await desktopGetMonitors().catch(() => []);
      const clean = (Array.isArray(monitors) ? monitors : [])
        .filter((m: any) => Number.isFinite(Number(m?.index)) && Number(m?.width) > 0 && Number(m?.height) > 0)
        .map((m: any) => ({
          index: Math.max(0, Math.floor(Number(m.index))),
          width: Math.max(1, Math.floor(Number(m.width))),
          height: Math.max(1, Math.floor(Number(m.height))),
          primary: !!m.primary,
        }))
        .sort((a: any, b: any) => a.index - b.index);
      if (clean.length > 1) {
        res.json({
          success: true,
          menu: 'desktop',
          result: `Detected ${clean.length} monitors. Choose one to capture, or capture all monitors combined.`,
          actions: [
            { action: 'screenshot-desktop-all', label: 'All monitors combined', icon: 'monitor' },
            ...clean.map((m: any) => ({
              action: 'screenshot-desktop-monitor',
              id: String(m.index),
              label: `Monitor ${m.index + 1}${m.primary ? ' (Primary)' : ''} ${m.width}x${m.height}`,
              icon: 'monitor',
            })),
          ],
        });
        return;
      }
      const monitorIndex = clean.length === 1 ? clean[0].index : 0;
      res.json(await captureDesktop({ capture: monitorIndex }));
      return;
    }
    if (target === 'desktop-all') {
      res.json(await captureDesktop({ capture: 'all' }));
      return;
    }
    if (target === 'desktop-monitor') {
      const monitorIndex = Math.max(0, Math.floor(Number(req.body?.id || 0)));
      res.json(await captureDesktop({ capture: monitorIndex }));
      return;
    }
    if (target === 'primary') {
      res.json(await captureDesktop({ capture: 'primary' }));
      return;
    }
    if (target === 'som') {
      res.json(await captureDesktop({ capture: 'all', som: true }));
      return;
    }
    if (target === 'browser') {
      const sessions = listBrowserSessions();
      if (sessions.length > 1) {
        res.json({
          success: true,
          menu: 'browser',
          result: `Detected ${sessions.length} browser instances. Choose one to capture.`,
          actions: sessions.slice(0, 12).map((session: any) => ({
            action: 'screenshot-browser-session',
            id: session.sessionId,
            label: `${session.originLabel || session.label || session.sessionId}${session.title || session.url ? ` - ${session.title || session.url}` : ''}`.slice(0, 100),
            icon: 'globe',
          })),
        });
        return;
      }
      const selected = sessions[0]?.sessionId || sessionId;
      const shot = await browserVisionScreenshot(selected);
      const info = getBrowserSessionInfo(selected);
      res.json({
        success: !!shot?.base64,
        result: shot?.base64
          ? `Browser screenshot captured (${shot.width}x${shot.height}) from ${info?.originLabel || 'Browser'}.`
          : 'ERROR: No browser session. Use browser_open first.',
        image: shot?.base64 ? {
          base64: shot.base64,
          mimeType: shot.mimeType || 'image/png',
          width: shot.width,
          height: shot.height,
          screenshotId: '',
        } : null,
      });
      return;
    }
    if (target === 'browser-session') {
      const selected = String(req.body?.id || '').trim();
      const shot = selected ? await browserVisionScreenshot(selected) : null;
      const info = selected ? getBrowserSessionInfo(selected) : null;
      res.json({
        success: !!shot?.base64,
        result: shot?.base64
          ? `Browser screenshot captured (${shot.width}x${shot.height}) from ${info?.originLabel || 'Browser'}.`
          : 'ERROR: Browser session was not available.',
        image: shot?.base64 ? {
          base64: shot.base64,
          mimeType: shot.mimeType || 'image/png',
          width: shot.width,
          height: shot.height,
          screenshotId: '',
        } : null,
      });
      return;
    }
    res.status(400).json({ success: false, error: 'Unknown screenshot target.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/context', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const originalUserPrompt = String(body.originalUserPrompt || body.transcript || body.userInterruptionTranscript || '').trim();
    const voiceTarget = normalizeVoiceAgentTarget(body);
    const contextPacket = buildVoiceWorkerContextPacket(sessionId, body);
    prewarmVoiceAgentContextBlock(sessionId, originalUserPrompt, { source: body.source || 'voice_context_endpoint', voiceTarget });
    res.json({
      ok: true,
      success: true,
      contextPacket,
      prewarmed: true,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.get('/api/voice-agent/context/:sessionId', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || 'default').trim() || 'default';
    const query = req.query as any;
    const originalUserPrompt = String(query.originalUserPrompt || query.transcript || query.userInterruptionTranscript || '').trim();
    const voiceTarget = normalizeVoiceAgentTarget(query);
    const contextPacket = buildVoiceWorkerContextPacket(sessionId, query);
    prewarmVoiceAgentContextBlock(sessionId, originalUserPrompt, { source: query.source || 'voice_context_endpoint', voiceTarget });
    res.json({
      ok: true,
      success: true,
      contextPacket,
      prewarmed: true,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/narrate', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const contextPacket = body.contextPacket && typeof body.contextPacket === 'object'
      ? body.contextPacket
      : buildVoiceWorkerContextPacket(sessionId, body);
    const narration = composeVoiceAgentNarration(contextPacket, body);
    res.json({
      ok: true,
      success: true,
      ...narration,
      contextPacket,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

function isRealtimeVoiceAgentInputRequest(body: any): boolean {
  const voiceMode = String(body?.voiceMode || body?.voice_mode || '').trim().toLowerCase();
  const source = String(body?.source || body?.origin || '').trim().toLowerCase();
  const runtime = body?.voiceRuntime || body?.voice_runtime || {};
  const runtimeMode = String(runtime?.voiceMode || runtime?.voice_mode || runtime?.mode || '').trim().toLowerCase();
  return (
    voiceMode.includes('realtime')
    || source.includes('realtime')
    || runtimeMode.includes('realtime')
    || body?.realtimeAgent === true
    || body?.realtime_agent === true
    || body?.voiceAgentRealtimeAgent === true
    || body?.voiceAgentXaiRealtime === true
    || runtime?.realtimeAgent === true
    || runtime?.realtime_agent === true
    || runtime?.voiceAgentRealtimeAgent === true
    || runtime?.voiceAgentXaiRealtime === true
  );
}

router.post('/api/voice-agent/input', async (req, res) => {
  try {
    const requestStartedAt = Date.now();
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const realtimeAgentInput = isRealtimeVoiceAgentInputRequest(body);
    // Streaming mode: client sends { stream: true } and consumes SSE.
    // Server emits one `chunk` event per sentence as the model generates the
    // spokenReply, then a `done` event with the full result payload.
    const streamMode = body.stream === true || body.stream === 'true'
      || String(req.headers['accept'] || '').toLowerCase().includes('text/event-stream');
    let chunkSeq = 0;
    const emittedChunkTexts: string[] = [];
    if (streamMode) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      try { (res as any).flushHeaders?.(); } catch {}
      // Heartbeat to keep the connection alive on proxies
      const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch {}
      }, 15000);
      res.on('close', () => clearInterval(heartbeat));
      res.on('finish', () => clearInterval(heartbeat));
    }
    const writeSseEvent = (type: string, payload: Record<string, any>) => {
      if (!streamMode) return;
      try {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      } catch {}
    };
    const emitSpeechChunk = (text: string) => {
      const trimmed = String(text || '').trim();
      if (!trimmed) return;
      chunkSeq += 1;
      emittedChunkTexts.push(trimmed);
      writeSseEvent('chunk', { seq: chunkSeq, text: trimmed });
    };
    const transcript = String(body.transcript || body.userInterruptionTranscript || body.message || '').trim();
    const voiceTarget = normalizeVoiceAgentTarget(body);
    const classification = classifyVoiceInterruption(transcript);
    const activeRuntime = findActiveMainChatRuntimeForSession(sessionId, String(body.expectedRuntimeId || body.runtimeId || body.activeRunId || ''));
    const contextPacketStartedAt = Date.now();
    const contextPacket = getReusableVoiceContextPacket(sessionId, body, activeRuntime);
    const voiceRuntimeContext = voiceRuntimeContextText(body.voiceRuntime || body.voice_runtime);
    const contextPacketMs = Date.now() - contextPacketStartedAt;
    const eventId = String(body.id || `voice_intr_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`);
    const fallbackAction = decideVoiceAgentAction(transcript, classification, contextPacket);
    const fallbackDecision: VoiceAgentDecision = {
      action: fallbackAction,
      spokenReply: '',
      workerInstruction: fallbackAction === 'handoff_new_work' || fallbackAction === 'steer_worker' ? transcript : '',
      needsWorkerResponse: classification.intent === 'question',
      reason: 'deterministic_fallback',
    };
    if (voiceRuntimeContext) {
      contextPacket.voiceRuntime = voiceRuntimeContext;
    }
    const voiceProcessEntries: VoiceAgentProcessEntry[] = [];
    pushVoiceAgentProcessEntry(voiceProcessEntries, 'user', `User: ${compactVoiceText(transcript, 900)}`, {
      stage: 'voice_user_transcript',
      transcript,
      totalMs: Date.now() - requestStartedAt,
    });
    pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', `Voice latency: worker packet ${contextPacketMs}ms.`, {
      stage: 'voice_worker_context_packet',
      elapsedMs: contextPacketMs,
      totalMs: Date.now() - requestStartedAt,
    });
    if (realtimeAgentInput) {
      pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', 'Realtime Voice Agent caller detected; deterministic voice fast-routes disabled except quiet/wake runtime controls.', {
        stage: 'voice_realtime_fast_routes_disabled',
        voiceMode: String(body.voiceMode || '').trim(),
        source: String(body.source || '').trim(),
        totalMs: Date.now() - requestStartedAt,
      });
    }
    const exactCommand = !realtimeAgentInput && contextPacket.active ? exactActiveWorkerVoiceCommand(transcript) : '';
    let decision: VoiceAgentDecision;
    let fastRouteReason = '';
    if (exactCommand) {
      const action: VoiceAgentAction = exactCommand === 'stop' ? 'interrupt_worker' : 'steer_worker';
      decision = {
        action,
        spokenReply: '',
        workerInstruction: transcript,
        needsWorkerResponse: exactCommand === 'status',
        reason: `exact_active_worker_voice_command:${exactCommand}`,
      };
      fastRouteReason = `exact:${exactCommand}`;
      pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', `Voice latency: exact ${exactCommand} command routed without model.`, {
        stage: 'voice_fast_router',
        command: exactCommand,
        action,
        totalMs: Date.now() - requestStartedAt,
      });
    } else {
      decision = await callVoiceAgentDecisionModel(
        sessionId,
        transcript,
        classification,
        contextPacket,
        fallbackDecision,
        voiceProcessEntries,
        streamMode ? emitSpeechChunk : undefined,
        { disableDeterministicFastRoutes: realtimeAgentInput, voiceTarget },
      );
    }
    if (decision.action === 'answer_now' && !String(decision.spokenReply || '').trim() && transcript) {
      decision = {
        ...decision,
        action: 'handoff_new_work',
        workerInstruction: decision.workerInstruction || transcript,
        needsWorkerResponse: true,
        reason: `${decision.reason || 'voice_agent_empty_answer'};empty_answer_handoff`,
      };
      pushVoiceAgentProcessEntry(voiceProcessEntries, 'warn', 'Voice Agent returned no spoken answer; handing off instead of using a fallback reply.', {
        stage: 'voice_empty_answer_handoff',
        totalMs: Date.now() - requestStartedAt,
      });
    }
    const action = decision.action;
    if (action === 'handoff_new_work') {
      voiceAgentWorkerHandoffSessions.set(sessionId, {
        at: Date.now(),
        transcript: transcript.slice(0, 500),
        eventId,
      });
    }
    const event = {
      id: eventId,
      sessionId,
      createdAt: new Date().toISOString(),
      reason: String(body.reason || 'barge_in').trim() || 'barge_in',
      originalUserPrompt: String(body.originalUserPrompt || '').trim(),
      currentUserPrompt: transcript,
      assistantTextSoFar: String(body.assistantTextSoFar || body.interruptedText || '').trim(),
      assistantSpokenTextSoFar: String(body.assistantSpokenTextSoFar || '').trim(),
      currentSpokenSegment: String(body.currentSpokenSegment || '').trim(),
      lastVoiceMilestone: String(body.lastVoiceMilestone || '').trim(),
      activeRunId: activeRuntime?.id || String(body.activeRunId || body.activeRequestId || '').trim(),
      activeToolName: contextPacket.activeToolName || activeRuntime?.checkpoint?.toolName || '',
      activeToolLabel: contextPacket.activeToolLabel || '',
      activeWorkflowLabel: activeRuntime?.label || '',
      userInterruptionTranscript: transcript,
      classification,
      status: 'captured',
      voiceMode: String(body.voiceMode || '').trim(),
      clientRequestId: String(body.activeRequestId || body.clientRequestId || '').trim(),
      isStreamActive: body.isStreamActive === true,
      voiceAgentAction: action,
      voiceContextPacketId: contextPacket.id,
      voiceTarget,
    };
    let injectedContextText = buildVoiceInterruptionContextBlock(event);
    let steerApplied = false;
    let steerEventId = '';
    if (
      action === 'steer_worker'
      && activeRuntime?.id
      && transcript
      && !classification.shouldAbortOriginalRun
      && (exactCommand === 'pause' || !classification.shouldPauseOriginalRun)
    ) {
      const steer = addPendingRuntimeSteer(activeRuntime.id, {
        sessionId,
        message: decision.workerInstruction || transcript,
        source: String(body.source || `voice_${event.voiceMode || 'agent'}`).trim() || 'voice_agent',
        clientRequestId: event.clientRequestId || undefined,
        kind: voiceSteerKindFromIntent(classification.intent),
        requiresWorkerResponse: decision.needsWorkerResponse === true,
        voiceContextPacketId: contextPacket.id,
        spokenAck: decision.spokenReply || undefined,
        responseMode: decision.needsWorkerResponse ? 'worker_reply' : 'narrate',
        contextSummary: buildVoiceContextSummaryForSteer(contextPacket),
      });
      if (steer.ok && steer.event) {
        steerApplied = true;
        steerEventId = steer.event.id;
        injectedContextText = buildChatSteerContextBlock(steer.event);
      }
    }
    if (action === 'handoff_new_work') {
      injectedContextText = buildVoiceAgentHandoffContext(decision, contextPacket, transcript);
    }
    const voiceReply = decision.spokenReply;
    const rawRuntimeDirectives = [
      ...(Array.isArray((decision as any)?.runtimeDirectives) ? (decision as any).runtimeDirectives : []),
      ...voiceProcessEntries
        .map((entry) => entry?.extra?.runtimeDirective)
        .filter((directive: any) => directive && directive.action),
    ];
    const seenRuntimeDirectives = new Set<string>();
    const runtimeDirectives = rawRuntimeDirectives.filter((directive: any) => {
      const key = JSON.stringify({
        action: String(directive?.action || ''),
        wakePhrase: cleanVoiceWakePhrase(directive?.wakePhrase || ''),
        activateAfterReply: directive?.activateAfterReply === true || directive?.activate_after_reply === true,
        requiresWakePhrase: directive?.requiresWakePhrase === true || directive?.requires_wake_phrase === true,
      });
      if (seenRuntimeDirectives.has(key)) return false;
      seenRuntimeDirectives.add(key);
      return true;
    });
    const storedEvent = { ...event, injectedContextText, status: steerApplied ? 'injected_into_runtime' : 'handled_by_voice_agent', action, voiceReply, decision, contextPacket, processEntries: voiceProcessEntries };
    const totalMs = Date.now() - requestStartedAt;
    pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', `Voice latency: input endpoint total ${totalMs}ms.`, {
      stage: 'voice_agent_input_total',
      elapsedMs: totalMs,
      action,
      steerApplied,
    });
    const isActualInterruption = !!(
      activeRuntime?.id
      || body.isStreamActive === true
      || action === 'steer_worker'
      || action === 'interrupt_worker'
    );
    // resolvedSessionId may differ from the posted sessionId when a voice-first
    // mobile chat was still on the 'mobile_default' draft slot and got rotated
    // to a real mobile_<id> session during persistence. The client adopts this
    // so its live conversation points at the durable, drawer-listed session.
    let resolvedSessionId = sessionId;
    if (action === 'handoff_new_work' && voiceReply) {
      resolvedSessionId = persistVoiceAgentVisibleTurn(sessionId, transcript, voiceReply, action, eventId, voiceProcessEntries) || sessionId;
    }
    appendVoiceInterruptionLog(storedEvent);
    if (activeRuntime?.id) {
      updateLiveRuntimeCheckpoint(activeRuntime.id, {
        voiceInterruptionEvent: {
          id: eventId,
          intent: classification.intent,
          action,
          transcript: transcript.slice(0, 500),
          injectedContextText,
          steerApplied,
          steerEventId,
          voiceContextPacketId: contextPacket.id,
          workerInstruction: compactVoiceText(decision.workerInstruction || '', 700),
          voiceReply: voiceReply.slice(0, 500),
          at: Date.now(),
        },
      });
      if (action === 'interrupt_worker' && activeRuntime.abortable) {
        abortLiveRuntime(activeRuntime.id);
      }
    }
    if (isActualInterruption) {
      broadcastWS({
        type: 'voice_interruption',
        isInterruption: true,
        sessionId: resolvedSessionId,
        originalSessionId: sessionId,
        resolvedSessionId,
        eventId,
        intent: classification.intent,
        action,
        transcript,
        currentUserPrompt: transcript,
        userInterruptionTranscript: transcript,
        voiceReply,
        decision,
        processEntries: voiceProcessEntries,
        runtimeDirectives,
        shouldAbortOriginalRun: action === 'interrupt_worker',
        runtimeId: activeRuntime?.id || '',
        steerApplied,
        steerEventId,
        voiceContextPacketId: contextPacket.id,
      });
    } else {
      broadcastWS({
        type: 'voice_agent_turn',
        isInterruption: false,
        sessionId: resolvedSessionId,
        originalSessionId: sessionId,
        resolvedSessionId,
        eventId,
        action,
        transcript,
        currentUserPrompt: transcript,
        voiceReply,
        decision,
        processEntries: voiceProcessEntries,
        runtimeDirectives,
        voiceContextPacketId: contextPacket.id,
      });
    }
    const responsePayload = {
      ok: true,
      success: true,
      eventId,
      action,
      resolvedSessionId,
      steerApplied,
      steerEventId,
      runtimeId: activeRuntime?.id || '',
      classification,
      voiceTarget,
      contextPacket,
      decision,
      processEntries: voiceProcessEntries,
      runtimeDirectives,
      timings: {
        totalMs,
        contextPacketMs,
        fastRouted: !!fastRouteReason,
        fastRouteReason,
        fastCommand: exactCommand || '',
        isActualInterruption,
      },
      injectedContextText,
      voiceReply,
      workerInstruction: decision.workerInstruction || '',
      activeRun: activeRuntime ? summarizeMobileRuntime(activeRuntime) : null,
      // When streaming, tell the client that the spoken reply has already been
      // delivered as `chunk` SSE events so it should NOT re-speak voiceReply.
      streamedSpeech: streamMode && emittedChunkTexts.length > 0,
      streamedChunkCount: emittedChunkTexts.length,
    };
    if (streamMode) {
      writeSseEvent('done', { result: responsePayload });
      try { res.end(); } catch {}
    } else {
      res.json(responsePayload);
    }
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', error: String(err?.message || err) })}\n\n`);
        res.end();
      } catch {}
    }
  }
});

// ============================================================================
// REALTIME VOICE AGENT — full audio-in / audio-out via OpenAI Realtime API.
// When voice mode is "openai_realtime" end-to-end, the browser opens a single
// Realtime session whose system instructions and function tools come from
// this bootstrap. The reasoning model is gpt-realtime (not the primary). All
// voice_* and skill_* tools route through /api/voice-agent/realtime-tool, and worker
// handoff/steer/interrupt are signalled as function calls back to the browser.
// ============================================================================

const REALTIME_AGENT_CLIENT_SECRETS_ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';
const DEFAULT_REALTIME_AGENT_MODEL = 'gpt-realtime-2';
const DEFAULT_REALTIME_AGENT_VOICE = 'marin';
const DEFAULT_REALTIME_AGENT_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';
const REALTIME_AGENT_INSTRUCTIONS_MAX = 18000;
const realtimeAgentCallTokens = new Map<string, {
  clientSecret: string;
  sourceToken: string;
  auth: RealtimeAgentAuthCandidate['auth'];
  model: string;
  createdAt: number;
  expiresAt: number;
}>();

function getRealtimeAgentApiKey(): string {
  const cfg = getConfig().getConfig() as any;
  const providers = cfg?.llm?.providers && typeof cfg.llm.providers === 'object' ? cfg.llm.providers : {};
  const openAiKey = typeof providers?.openai?.api_key === 'string'
    ? String(getConfig().resolveSecret(providers.openai.api_key) || '').trim()
    : '';
  return String(
    process.env.OPENAI_REALTIME_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.VOICE_TOOLS_OPENAI_KEY
    || openAiKey
    || ''
  ).trim();
}

type RealtimeAgentAuthCandidate = { token: string; auth: 'api_key' | 'openai_codex_oauth_api_key' | 'openai_codex_oauth' };

function getJwtExpiryMs(token: string): number {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    const exp = Number(payload?.exp || 0);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function loadRealtimeAgentOpenAiCodexTokens(configDir: string) {
  let tokens = loadOpenAiCodexTokens(configDir);
  if (!tokens) return null;
  const hasApiKey = !!String(tokens.api_key || '').trim();
  const idTokenExpiryMs = getJwtExpiryMs(String(tokens.id_token || ''));
  const idTokenExpired = !idTokenExpiryMs || Date.now() > idTokenExpiryMs - 60_000;
  if (!hasApiKey && idTokenExpired) {
    try {
      tokens = await refreshOpenAiCodexTokens(configDir);
      console.log('[voice-agent-realtime] refreshed Codex OAuth for realtime auth', {
        hasExchangedApiKey: !!String(tokens?.api_key || '').trim(),
      });
    } catch (err: any) {
      console.warn('[voice-agent-realtime] Codex OAuth refresh for realtime auth failed', {
        message: String(err?.message || err || ''),
      });
    }
  }
  return loadOpenAiCodexTokens(configDir) || tokens;
}

// Resolve every usable OpenAI credential for the Realtime client_secret mint, in
// priority order. This mirrors realtime.router's getRealtimeAuthCandidates so the
// end-to-end agent authenticates the same way regular OpenAI STT/TTS (and Codex
// OAuth image gen) does — a raw API key OR the connected Codex OAuth account.
async function getRealtimeAgentAuthCandidates(): Promise<RealtimeAgentAuthCandidate[]> {
  const candidates: RealtimeAgentAuthCandidate[] = [];
  const seen = new Set<string>();
  const push = (token: string, auth: RealtimeAgentAuthCandidate['auth']) => {
    const value = String(token || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push({ token: value, auth });
  };
  const apiKey = getRealtimeAgentApiKey();
  push(apiKey, 'api_key');

  try {
    const configDir = getConfig().getConfigDir();
    if (loadOpenAiCodexTokens(configDir) !== null) {
      const tokens = await loadRealtimeAgentOpenAiCodexTokens(configDir);
      push(String(tokens?.api_key || '').trim(), 'openai_codex_oauth_api_key');
      const token = await getOpenAiCodexToken(configDir);
      push(token, 'openai_codex_oauth');
    }
  } catch {
    // Fall through — the caller reports when no usable auth was found.
  }

  return candidates;
}

function sanitizeRealtimeAgentVoice(value: unknown): string {
  const voice = String(value || DEFAULT_REALTIME_AGENT_VOICE).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(voice) ? voice : DEFAULT_REALTIME_AGENT_VOICE;
}

function sanitizeRealtimeAgentModel(value: unknown): string {
  const model = String(value || DEFAULT_REALTIME_AGENT_MODEL).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(model) ? model : DEFAULT_REALTIME_AGENT_MODEL;
}

function sanitizeRealtimeAgentSpeed(value: unknown): number {
  const speed = Number(value || 1);
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.25, Math.min(1.5, Math.round(speed * 100) / 100));
}

function clampRealtimeInstructions(value: string, max = REALTIME_AGENT_INSTRUCTIONS_MAX): string {
  const text = String(value || '').trim();
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 18)).trimEnd()}\n...[truncated]`;
}

// Convert the chat-completions style voice tool defs to OpenAI Realtime format,
// and add Realtime-specific worker-control tools (dispatch/steer/interrupt)
// that the model uses to signal the browser to do something outside the audio
// loop. The browser receives these via response.function_call events.
function buildRealtimeVoiceAgentTools(voiceTarget?: VoiceAgentTargetContext): any[] {
  const identity = voiceAgentTargetIdentity(voiceTarget);
  const chatTools = buildVoiceToolDefinitions();
  const realtimeTools: any[] = chatTools.map((tool: any) => ({
    type: 'function',
    name: tool.function?.name || tool.name,
    description: tool.function?.description || tool.description,
    parameters: tool.function?.parameters || tool.parameters,
  }));
  realtimeTools.push({
    type: 'function',
    name: 'dispatch_prometheus_worker',
    description: identity.isSubagent
      ? `Technical dispatch signal for heavy or durable work. The app routes this into the selected subagent chat for ${identity.label}, not the main Prometheus chat. Use for files, shell/run commands, source edits, MCP/connectors, uploads/downloads, coding, long research, media processing, approvals, credentials, purchases/payments, account settings/security changes, destructive external submits, or anything outside the voice_* and skill_* tool set. CRITICAL: call this function IMMEDIATELY and do not speak an acknowledgement before or after the call. In speech, phrase the work as your own work as ${identity.label}; do not say you are getting a worker or asking Prometheus.`
      : 'Hand off heavy or durable work to the Prometheus worker (your primary GPT-5 reasoning brain). Use for files, shell/run commands, source edits, MCP/connectors, uploads/downloads, coding, long research, media processing, approvals, credentials, purchases/payments, account settings/security changes, destructive external submits, or anything outside the voice_* and skill_* tool set. Do not use for ordinary live browser/desktop UI navigation or explicit user-authorized social posts/messages that voice_browser and voice_desktop can handle. CRITICAL: call this function IMMEDIATELY and do not speak an acknowledgement before or after the call. The app visibly posts the worker handoff. Speaking "on it" or "I started that" WITHOUT emitting this function call does nothing and the work never runs. Never claim the worker is running unless you actually called this function or voice_ops action worker_status reports it active.',
    parameters: {
      type: 'object',
      required: [],
      properties: {
        task: { type: 'string', description: 'Natural-language description of the single worker task. Include any constraints or details the user mentioned.' },
        tasks: {
          type: 'array',
          description: 'Use this for multi-part requests that should fan out to multiple Prometheus workers in parallel.',
          items: {
            type: 'object',
            required: ['prompt'],
            properties: {
              title: { type: 'string', description: 'Short display name for this worker task.' },
              prompt: { type: 'string', description: 'Self-contained worker instruction for this task.' },
            },
            additionalProperties: false,
          },
        },
        delivery: { type: 'string', enum: ['report_each', 'grouped_summary', 'task_panel_only'], description: 'How results should return to the chat. Default report_each.' },
        spoken_ack: { type: 'string', description: 'Optional. The exact ack you already spoke or are about to speak — included for logs.' },
      },
      additionalProperties: false,
    },
  });
  realtimeTools.push({
    type: 'function',
    name: 'steer_active_worker',
    description: 'Steer an active Prometheus worker run mid-execution. Use ONLY when the worker context shows a worker is currently active and the user is clearly correcting, adjusting, pausing, or changing the active work. Do NOT use for normal conversation, status/progress/update questions, or "what are you doing"; use voice_worker_status for those. For abort intent, use interrupt_active_worker instead.',
    parameters: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'The steering message for the worker — the user\'s correction or new direction.' },
      },
      additionalProperties: false,
    },
  });
  realtimeTools.push({
    type: 'function',
    name: 'interrupt_active_worker',
    description: 'Abort the currently active Prometheus worker run. Use ONLY for explicit cancel/stop/abort intent from the user. Call this function immediately; do not wait for a separate acknowledgement path. After the function output returns, speak one very short confirmation.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Brief reason for the abort.' },
      },
      additionalProperties: false,
    },
  });
  return realtimeTools;
}

function buildRealtimeVoiceAgentInstructions(args: {
  contextBlock: string;
  contextPacket: Record<string, any>;
  voiceAgentMemory?: string;
  voiceRuntime?: string;
  wakePhrase?: string;
  conversationTranscript?: string;
  conversationSummary?: string;
  recentToolLog?: string;
  currentTime?: Record<string, any>;
  voiceTarget?: VoiceAgentTargetContext;
}): string {
  const currentTime = args.currentTime || buildVoiceTimeContext();
  const identity = voiceAgentTargetIdentity(args.voiceTarget);
  // Continuity block lives HIGH (right after identity) and is built first so the
  // 18k clamp truncates the tool-routing preamble before it touches the thread
  // context. This is what makes voice pick up mid-conversation instead of acting
  // like a fresh chat.
  const continuityLines: string[] = [];
  if (args.conversationSummary || args.conversationTranscript || args.recentToolLog) {
    continuityLines.push(
      '## This conversation so far (you are joining a chat already in progress — continue from here, do NOT restart or re-introduce yourself)',
      'The user just turned voice on mid-conversation. Pick up exactly where this left off: reference what was already said and done, and do not ask what they need from scratch.',
    );
    if (args.conversationSummary) {
      continuityLines.push(
        '',
        '### Earlier in this conversation (summary)',
        'Older context from this same thread was compacted into this summary. Treat it as things you already know and discussed.',
        args.conversationSummary,
      );
    }
    if (args.conversationTranscript) {
      continuityLines.push(
        '',
        '### Recent messages',
        args.conversationTranscript,
      );
    }
    if (args.recentToolLog) {
      continuityLines.push(
        '',
        '### Recent work completed in this thread',
        args.recentToolLog,
      );
    }
    continuityLines.push('');
  }
  const lines = [
    identity.isSubagent
      ? `You are ${identity.label}, a standalone subagent under Prometheus, speaking in Realtime mode through your own voice interface. You are not Prometheus and must not claim to be Prometheus.`
      : 'You are Prometheus speaking through the user\'s voice interface in OpenAI Realtime mode.',
    identity.isSubagent
      ? `Your identity is the subagent ${identity.label}; the Realtime voice layer is only the transport. You are not a generic live conversational voice agent. For small talk, status answers, fast voice_* tools, canonical read-only skill_* tools, and hand-offs, speak as ${identity.label} from this subagent's role.`
      : 'You are the live conversational voice agent: small talk, status answers, fast voice_* tools, canonical read-only skill_* tools, and worker hand-offs all flow through you. You ARE Prometheus on voice — speak with that identity.',
    identity.isSubagent
      ? `If the user asks "who are you?", answer that you are ${identity.label}, a standalone subagent under Prometheus, then summarize your configured subagent role from the context below. Do not answer that you are a voice layer, voice interface, realtime voice, or provider voice.`
      : '',
    identity.isSubagent
      ? `When work needs durable execution, use dispatch_prometheus_worker as the technical signal, but the app routes it into ${identity.label}'s subagent chat. In speech, say "I am on it" or "I will handle that"; never say you will get the worker, ask Prometheus, or hand it to Prometheus.`
      : '',
    'Your audio voice label or provider voice name, such as Eve, Marin, Alloy, or any similar setting, is only the sound used for speech output. It is never your name, persona, identity, role, or agent name. If asked who you are, answer from the identity above.',
    '',
    ...continuityLines,
    'Personality: warm, direct, technically sharp, playful when natural, deeply aligned with the user. Use the user name only when it is known and natural. Avoid generic acknowledgements like "I am here" or "How can I help" — answer what they actually said.',
    '',
    'Response style: speak naturally and conversationally, as if on a phone call. Keep replies tight unless he wants depth. No bullet points or markdown — this is audio.',
    'Speak only normal words and numbers. Never vocalize punctuation marks, symbols, emoji, markdown, bullets, dashes, or standalone characters; if a candidate reply has no word, stay silent.',
    'Time/date rule: use ## Current time only when exactLocalTimeAvailable is true or source is device. If it is gateway_fallback, say you do not have the exact device-local time and tell the user to check their device clock for the precise time.',
    '',
    args.voiceAgentMemory ? '## Voice agent memory' : '',
    args.voiceAgentMemory ? args.voiceAgentMemory : '',
    args.voiceAgentMemory ? '' : '',
    '## When to call which tool',
    '- voice_ops: unified quick voice operations. Use action web_search for quick factual/current lookup; web_fetch for one clean text URL; write_note for explicit remember/jot/note; agent_memory for workspace/VOICEAGENT.md routing/spoken-behavior notes with memory_action read/append/replace; set_wake_phrase, enter_quiet_mode, or set_quiet_until for runtime voice settings; memory_search for read-only recall; timer for one-shot timers with timer_action create/list/update/reschedule/cancel; automation_dashboard for operator snapshots; worker_status for Worker progress; task_control for paused/restarted/background task resume, pause, rerun, cancel, or sending guidance to a paused/blocked worker; send_screenshot for screenshot delivery; generate_image/generate_video for simple media generation.',
    '- Visual cards (render a card in the app while you speak the gist — keep speech short, the card carries the detail): show_weather (forecast), show_market (crypto/memecoins), show_stocks (equities/ETFs), show_prediction_market (Polymarket odds), show_map (places/locations), show_sources (news/citations you gathered), show_comparison (side-by-side table), show_chart (line/bar/area from numbers), show_product_carousel (products), show_agent_work (operator snapshot — gather via voice_automation_dashboard first), show_run_result (finished-task summary). All keyless and read-only; call them directly instead of dispatching the Worker for these.',
    '- skill_list: canonical skill discovery. Use it to inspect available workflows, triggers, categories, and required tools for multi-step or unfamiliar workflows. Do not call skill_list for direct live UI control; use voice_browser or voice_desktop. Use totalInstalled, matchedCount, returnedCount, and truncated exactly; do not infer that the returned array length is the total skill count.',
    '- skill_read / skill_resource_list / skill_resource_read: canonical skill tools. Load relevant workflow instructions before browser/desktop/tool actions when skill trigger context points to them. Follow skill instructions only through voice_* tools; explicit user-authorized social posts/messages are allowed when content and destination are clear. Hand off to Worker if they require files, shell, uploads/downloads, credentials, purchases/payments, account settings/security changes, destructive submits, or durable changes.',
    '- voice_browser: use action open, snapshot, screenshot, click, vision_click, fill, type, vision_type, press_key, scroll, or wait for fast browser navigation, input, drafting, and explicit user-authorized social posts/messages when content and destination are clear. Hand off to Worker for uploads, downloads, password/payment entry, purchases/payments, destructive actions, account settings/security changes, or anything involving files.',
    '- voice_desktop: use action screenshot, list_windows, focus_window, window_control, find_app, launch_app, click, window_click, window_type, window_press_key, or window_scroll for live desktop UI. For window_control include window_action minimize/maximize/restore/close. Use window_id/window_handle/app_id/title and fresh screenshot coordinates. Explicit user-authorized social posts/messages are allowed when content and destination are clear. Hand off to Worker for file edits, shell commands, installs, destructive confirmations, purchases/payments, account settings/security changes, durable system changes, or anything requiring approvals.',
    '- Screenshot ownership: screenshot capture and screenshot sending stay in the voice layer. Do not call dispatch_prometheus_worker for ordinary browser, desktop, app, window, or active-window screenshots; call voice_browser action screenshot, voice_desktop action screenshot, or voice_ops action send_screenshot.',
    identity.isSubagent
      ? `- dispatch_prometheus_worker: TECHNICAL HANDOFF for heavy/durable work. The browser routes it into ${identity.label}'s selected subagent chat. Call it IMMEDIATELY and do not speak an acknowledgement before or after it. Do not describe this as getting a worker or asking Prometheus.`
      : '- dispatch_prometheus_worker: HAND OFF heavy/durable work — code, file ops, shell/run commands, MCP/connectors, uploads/downloads, long research, media processing, approvals, credentials, purchases/payments, destructive external actions, account settings/security changes, or anything outside voice_* and skill_*. If the user gives multiple independent work items, pass them as tasks[] so multiple Prometheus workers can run in parallel. Do not dispatch for explicit user-authorized social posts/messages that voice browser/desktop tools can complete. Call this function IMMEDIATELY and do not speak an acknowledgement before or after it. The app shows the worker handoff.',
    '- steer_active_worker / interrupt_active_worker: ONLY when a live foreground worker runtime is currently active (check the worker context below) AND the user is correcting, changing, pausing, or cancelling that active runtime. If the worker status says tasks are paused, stalled, awaiting input, failed, or paused after gateway restart, use voice_ops action task_control instead.',
    '',
    '## Routing decisions you make implicitly',
    '- If the user asks something answerable from your context (memory, identity, recall, small talk) — answer directly, no tool.',
    '- If the user asks for status/progress/context about the active Worker — call voice_ops action worker_status, then answer from that result. Do not send the status question to the Worker as a steer.',
    '- Skill scout rule: use skill_list for multi-step workflows or unfamiliar app/site procedures. Do NOT run skill scout for direct live UI control like open, screenshot, click, scroll, press key, type, focus, maximize, minimize, restore, or close; call voice_browser or voice_desktop immediately.',
    '- If the user wants quick voice-scope work — call voice_ops, voice_browser, voice_desktop, or skill_* as appropriate, then narrate the result. For automation/operator status snapshots, call voice_ops action automation_dashboard.',
    '- If the user asks you to remember a rule specifically for the live voice agent, update VOICEAGENT.md with voice_ops action agent_memory instead of voice_ops action write_note.',
    identity.isSubagent
      ? `- If the user wants heavy/durable real work outside voice scope — call dispatch_prometheus_worker FIRST, with no spoken acknowledgement before or after it. The app routes it into ${identity.label}'s subagent chat and ${identity.label} will report progress.`
      : '- If the user wants heavy/durable real work outside voice scope — call dispatch_prometheus_worker FIRST, with no spoken acknowledgement before or after it. For several independent work items, call it once with tasks[] instead of serial single-task calls. The app shows the handoff and the worker will report progress.',
    '- If the user asks to resume, pause, rerun, cancel, or unpause paused/restarted tasks — call voice_ops with action task_control and task_action resume/pause/rerun/cancel. If task ids are not known, omit task_id so it targets the latest voice workgroup.',
    '- If the user says to tell a paused/blocked worker something, call voice_ops with action task_control, task_action message, message set to their guidance, and resume_after_message true only when they also ask to continue/resume.',
    '- If the user interrupts an active live runtime with an actual correction, new constraint, pause, or direction change — call steer_active_worker. Do not use steer_active_worker for paused background tasks.',
    '- If the user explicitly cancels/stops/aborts — call interrupt_active_worker.',
    '',
    '## Tool calls are REAL actions — never fake them',
    '- A tool only runs if you actually emit the function call. Saying "on it", "handing that off", "I started the worker", or "let me search" does NOT run anything by itself.',
    '- CRITICAL for hand-offs: when the user wants real work, emit the dispatch_prometheus_worker function call in the same turn and stay quiet around it. Speaking an acknowledgement WITHOUT emitting the function call is a failure because the work never starts.',
    '- CRITICAL for live UI control: when the user asks you to click, scroll, press a key, type, fill, focus, maximize, minimize, restore, close, open, or screenshot the current browser/desktop, your next action must be voice_browser or voice_desktop with the matching action. Do not say you will do it without the function call.',
    '- CRITICAL for screenshot delivery: when the user asks to send/share/show/deliver a screenshot, call voice_ops action send_screenshot. Do not dispatch Worker for ordinary screenshot delivery while this tool exists.',
    '- If a browser/desktop target is ambiguous, first call voice_browser action snapshot or voice_desktop action screenshot with mode som, then call the action tool from the returned refs/coordinates.',
    '- CRITICAL for status: never say you messaged, asked, notified, or sent something to the Worker when the user only asked a status/update question. Call voice_ops action worker_status and answer from the returned context instead.',
    '- Likewise, never claim a search/note/screenshot/timer happened unless you actually called the matching voice_* tool and received its result; never claim skill counts or skill instructions unless skill_list, skill_read, skill_resource_list, or skill_resource_read returned them.',
    '- After you say you are doing something, the corresponding function call MUST be in your output.',
    '',
    '## Hard boundaries',
    '- Never claim you used full Worker tools or changed files/accounts from the voice layer unless a voice_* tool result confirms it. Skill_* results only confirm skill discovery or skill instruction reads.',
    '- Never narrate that you are calling a tool ("let me search for that" means just call voice_ops action web_search and report the result).',
    '- Screenshot tools provide fresh visual context. Browser/desktop UI control is allowed through voice_browser and voice_desktop, including explicit user-authorized social posts/messages when content and destination are clear. Durable/file/account settings/security/destructive work must go to Worker.',
    '',
    '## Worker context (current state — read-only orientation)',
    args.contextBlock || '(no extended context available)',
  ];
  if (args.voiceRuntime) {
    lines.push('', '## Voice runtime state', args.voiceRuntime);
  }
  if (args.wakePhrase) {
    lines.push('', `## Wake phrase: "${args.wakePhrase}"`, 'If quiet mode is active, stay silent until this phrase is heard.');
  }
  lines.push('', '## Worker context packet', JSON.stringify(args.contextPacket, null, 2));
  lines.push('', '## Current time', JSON.stringify(currentTime, null, 2));
  return clampRealtimeInstructions(lines.filter(Boolean).join('\n'));
}

router.post('/api/voice-agent/realtime-bootstrap', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const voiceTarget = normalizeVoiceAgentTarget(body);
    const authCandidates = await getRealtimeAgentAuthCandidates();
    if (!authCandidates.length) {
      res.status(400).json({ ok: false, success: false, error: 'OpenAI Realtime requires OPENAI_API_KEY, OPENAI_REALTIME_API_KEY, or a connected OpenAI Codex OAuth account.' });
      return;
    }

    const activeRuntime = findActiveMainChatRuntimeForSession(sessionId, String(body.expectedRuntimeId || body.runtimeId || body.activeRunId || ''));
    const contextPacket = getReusableVoiceContextPacket(sessionId, body, activeRuntime);
    const voiceRuntimeContext = voiceRuntimeContextText(body.voiceRuntime || body.voice_runtime);
    if (voiceRuntimeContext) contextPacket.voiceRuntime = voiceRuntimeContext;
    const currentTime = buildVoiceTimeContext(body.deviceTime || body.device_time || body.clientTime || body.client_time);
    contextPacket.currentTime = currentTime;
    const originalPrompt = String(body.originalUserPrompt || '').trim();
    let contextBlockResult: { contextBlock: string; elapsedMs?: number; cacheHit?: boolean };
    try {
      contextBlockResult = await getVoiceAgentContextBlock(sessionId, originalPrompt, { voiceTarget });
    } catch (err: any) {
      console.warn('[voice-agent-realtime] context block failed; starting with worker packet only:', err?.message || err);
      contextBlockResult = { contextBlock: '' };
    }
    const voiceAgentMemory = loadVoiceAgentMemoryForTarget(voiceTarget);
    const runtimeBody = body?.voiceRuntime && typeof body.voiceRuntime === 'object'
      ? body.voiceRuntime
      : (body?.voice_runtime && typeof body.voice_runtime === 'object' ? body.voice_runtime : {});
    const wakePhrase = cleanVoiceWakePhrase(runtimeBody?.wakePhrase || runtimeBody?.wake_phrase || '');
    const wakeGateActive = runtimeBody?.wakeGateActive === true || runtimeBody?.wake_gate_active === true;

    const instructions = buildRealtimeVoiceAgentInstructions({
      contextBlock: contextBlockResult.contextBlock,
      contextPacket,
      voiceAgentMemory,
      voiceRuntime: voiceRuntimeContext,
      wakePhrase,
      conversationTranscript: buildVoiceConversationTranscript(sessionId, 24, 600, voiceTarget),
      conversationSummary: buildVoiceCompactionSummaryBlock(sessionId, 4000, voiceTarget),
      recentToolLog: buildVoiceRecentToolLog(sessionId, 8, voiceTarget),
      currentTime,
      voiceTarget,
    });
    const tools = buildRealtimeVoiceAgentTools(voiceTarget);

    const model = sanitizeRealtimeAgentModel(body.model);
    const voice = sanitizeRealtimeAgentVoice(body.voice);
    const speed = sanitizeRealtimeAgentSpeed(body.speed);

    // gpt-realtime session config — audio.input MUST include turn_detection
    // (server VAD) and transcription so the model autoresponds when the user
    // stops speaking and the user-side transcript surfaces in events.
    const sessionConfig: any = {
      session: {
        type: 'realtime',
        model,
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            transcription: { model: DEFAULT_REALTIME_AGENT_TRANSCRIPTION_MODEL },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
              create_response: !(wakeGateActive && !!wakePhrase),
            },
          },
          output: { voice, speed },
        },
        instructions,
        tools,
        tool_choice: 'auto',
      },
    };
    const noSpeedSessionConfig = JSON.parse(JSON.stringify(sessionConfig));
    try { delete noSpeedSessionConfig.session.audio.output.speed; } catch {}
    const leanSessionConfig: any = {
      session: {
        type: 'realtime',
        model,
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            transcription: { model: DEFAULT_REALTIME_AGENT_TRANSCRIPTION_MODEL },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
              create_response: !(wakeGateActive && !!wakePhrase),
            },
          },
          output: { voice },
        },
        instructions: clampRealtimeInstructions(instructions, 9000),
      },
    };
    const sessionConfigVariants = [
      { name: 'full', config: sessionConfig },
      { name: 'no_speed', config: noSpeedSessionConfig },
      { name: 'lean', config: leanSessionConfig },
    ];

    // Try each credential in turn. 401/403 means "wrong key" — fall through to the
    // next candidate (e.g. API key absent → Codex OAuth). Any other failure is real.
    let data: any = null;
    let usedAuth: RealtimeAgentAuthCandidate['auth'] | null = null;
    let usedSourceToken = '';
    let usedVariant = '';
    let lastFailure: { status: number; data: any; variant: string; auth: RealtimeAgentAuthCandidate['auth'] } | null = null;
    for (const candidate of authCandidates) {
      for (const variant of sessionConfigVariants) {
        const upstream = await fetch(REALTIME_AGENT_CLIENT_SECRETS_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${candidate.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(variant.config),
        });
        const text = await upstream.text();
        let parsed: any = null;
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        if (upstream.ok) {
          data = parsed;
          usedAuth = candidate.auth;
          usedSourceToken = candidate.token;
          usedVariant = variant.name;
          break;
        }
        lastFailure = { status: upstream.status, data: parsed, variant: variant.name, auth: candidate.auth };
        if (upstream.status !== 401 && upstream.status !== 403) {
          console.warn('[voice-agent-realtime] client_secret variant failed', {
            status: upstream.status,
            auth: candidate.auth,
            variant: variant.name,
            error: parsed?.error?.message || parsed?.error || parsed?.raw || '',
          });
        }
        const isAuthFailure = upstream.status === 401 || upstream.status === 403;
        if (isAuthFailure) break;
      }
      if (data) break;
      if (lastFailure?.status !== 401 && lastFailure?.status !== 403) continue;
    }

    if (!data) {
      res.status(lastFailure?.status || 502).json({
        ok: false,
        success: false,
        error: lastFailure?.data?.error?.message || lastFailure?.data?.error || `OpenAI Realtime returned ${lastFailure?.status || 502}`,
        details: lastFailure?.data,
        variant: lastFailure?.variant || null,
        auth: lastFailure?.auth || null,
      });
      return;
    }
    const clientSecret = String(data?.client_secret?.value || data?.value || data?.client_secret || '').trim();
    if (!clientSecret) {
      res.status(502).json({ ok: false, success: false, error: 'Realtime client_secret was not returned.', details: data });
      return;
    }
    const callToken = crypto.randomUUID();
    const expiresAtRaw = Number(data?.client_secret?.expires_at || data?.expires_at || 0);
    const expiresAtMs = Number.isFinite(expiresAtRaw) && expiresAtRaw > 0
      ? (expiresAtRaw < 10_000_000_000 ? expiresAtRaw * 1000 : expiresAtRaw)
      : Date.now() + 10 * 60 * 1000;
    realtimeAgentCallTokens.set(callToken, {
      clientSecret,
      sourceToken: usedSourceToken,
      auth: usedAuth || 'openai_codex_oauth',
      model,
      createdAt: Date.now(),
      expiresAt: expiresAtMs,
    });
    console.log('[voice-agent-realtime] client_secret ready', {
      auth: usedAuth,
      variant: usedVariant,
      model,
      voice,
      instructionsLength: instructions.length,
      toolCount: tools.length,
    });
    res.json({
      ok: true,
      success: true,
      clientSecret,
      callToken,
      auth: usedAuth,
      variant: usedVariant,
      model,
      voice,
      speed,
      contextPacket,
      instructions,
      tools,
      instructionsLength: instructions.length,
      toolCount: tools.length,
      expiresAt: data?.client_secret?.expires_at || data?.expires_at || null,
      sessionConfig: { type: 'realtime', model, voice, speed },
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/realtime-call', async (req, res) => {
  try {
    const body = req.body || {};
    const callToken = String(body.callToken || body.call_token || '').trim();
    let sdp = String(body.sdp || '');
    if (!sdp.endsWith('\r\n')) sdp = `${sdp.replace(/\s+$/g, '')}\r\n`;
    const diagnostics = {
      sdpLength: sdp.length,
      startsWithV: sdp.startsWith('v='),
      hasAudio: /\r?\nm=audio\s/i.test(sdp),
      firstLine: sdp.split(/\r?\n/, 1)[0] || '',
    };
    if (!callToken) {
      res.status(400).json({ ok: false, success: false, error: 'Realtime call token is required.', ...diagnostics });
      return;
    }
    const entry = realtimeAgentCallTokens.get(callToken);
    if (!entry || Date.now() > entry.expiresAt) {
      realtimeAgentCallTokens.delete(callToken);
      res.status(401).json({ ok: false, success: false, error: 'Realtime call token is expired. Restart realtime voice.', ...diagnostics });
      return;
    }
    if (!diagnostics.startsWithV || !diagnostics.hasAudio) {
      res.status(400).json({ ok: false, success: false, error: 'Valid Realtime SDP audio offer is required.', ...diagnostics });
      return;
    }

    const callUrlNoModel = 'https://api.openai.com/v1/realtime/calls';
    const callUrlWithModel = `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(entry.model)}`;
    const attempts = [
      { label: 'ephemeral', token: entry.clientSecret, url: callUrlNoModel, auth: 'ephemeral' },
      { label: 'ephemeral_model', token: entry.clientSecret, url: callUrlWithModel, auth: 'ephemeral' },
      { label: `source_${entry.auth}`, token: entry.sourceToken, url: callUrlWithModel, auth: entry.auth },
    ].filter(attempt => attempt.token);

    let lastFailure: { status: number; label: string; error: string } | null = null;
    for (const attempt of attempts) {
      const upstream = await fetch(attempt.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${attempt.token}`,
          'Content-Type': 'application/sdp',
          ...(attempt.auth === 'openai_codex_oauth' ? buildCodexCloudflareHeaders(attempt.token) : {}),
        },
        body: sdp,
      });
      const answer = await upstream.text();
      if (upstream.ok) {
        console.log('[voice-agent-realtime] call exchange ready', {
          auth: entry.auth,
          attempt: attempt.label,
          model: entry.model,
          ...diagnostics,
        });
        res.type('application/sdp').send(answer);
        return;
      }
      lastFailure = { status: upstream.status, label: attempt.label, error: answer.slice(0, 500) };
      console.warn('[voice-agent-realtime] call exchange failed', {
        auth: entry.auth,
        attempt: attempt.label,
        status: upstream.status,
        model: entry.model,
        error: answer.slice(0, 500),
        ...diagnostics,
      });
      if (upstream.status !== 500 && upstream.status !== 502 && upstream.status !== 503) continue;
    }
    res.status(lastFailure?.status || 502).json({
      ok: false,
      success: false,
      error: lastFailure?.error || `Realtime call exchange failed (${lastFailure?.status || 502})`,
      attempt: lastFailure?.label || null,
      ...diagnostics,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

// ============================================================================
// xAI / Grok Realtime Voice Agent
// ----------------------------------------------------------------------------
// xAI's realtime Voice Agent is the speech-to-speech sibling of OpenAI Realtime.
// Unlike OpenAI (WebRTC + server-side SDP), xAI's browser transport is a raw
// WebSocket authenticated with an ephemeral client-secret passed via the WS
// subprotocol (xai-client-secret.<token>). So this bootstrap mints the token and
// returns the instructions/tools/voice for the CLIENT to send over session.update
// after the socket opens. The instruction/tool/context builders are shared with
// the OpenAI agent so both providers behave identically once connected.
// ============================================================================

const XAI_REALTIME_CLIENT_SECRETS_ENDPOINT = `${(process.env.XAI_ENDPOINT || 'https://api.x.ai/v1').replace(/\/+$/, '')}/realtime/client_secrets`;
const XAI_REALTIME_WS_BASE = process.env.XAI_REALTIME_WS_URL || 'wss://api.x.ai/v1/realtime';
const DEFAULT_XAI_REALTIME_MODEL = process.env.XAI_REALTIME_MODEL || 'grok-voice-latest';
const DEFAULT_XAI_REALTIME_VOICE = process.env.XAI_REALTIME_VOICE || 'eve';
const XAI_REALTIME_USER_AGENT = process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0';
const XAI_REALTIME_VOICE_IDS = ['eve', 'ara', 'rex', 'sal', 'leo'];

type XaiRealtimeAuthCandidate = { token: string; auth: 'xai_oauth' | 'api_key' };

function getXaiRealtimeApiKey(): string {
  const cfg = getConfig().getConfig() as any;
  const providers = cfg?.llm?.providers && typeof cfg.llm.providers === 'object' ? cfg.llm.providers : {};
  const raw = typeof providers?.xai?.api_key === 'string'
    ? String(getConfig().resolveSecret(providers.xai.api_key) || '').trim()
    : '';
  const key = String(process.env.XAI_API_KEY || raw || '').trim();
  return /^xai-[A-Za-z0-9_-]+/.test(key) ? key : '';
}

function hasXaiRealtimeOAuth(): boolean {
  return isXAIConnected(getConfig().getConfigDir());
}

// Resolve every usable xAI credential for the realtime client_secret mint. For
// voice mode, prefer the user's connected OAuth account so a stale env/config
// API key cannot silently override it; keep API key as a fallback candidate.
async function getXaiRealtimeAuthCandidates(): Promise<XaiRealtimeAuthCandidate[]> {
  const candidates: XaiRealtimeAuthCandidate[] = [];
  const seen = new Set<string>();
  const push = (token: string, auth: XaiRealtimeAuthCandidate['auth']) => {
    const value = String(token || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push({ token: value, auth });
  };

  if (hasXaiRealtimeOAuth()) {
    try {
      push(await getValidXAIToken(getConfig().getConfigDir()), 'xai_oauth');
    } catch {
      // Fall through — API key fallback below may still be usable.
    }
  }

  push(getXaiRealtimeApiKey(), 'api_key');
  return candidates;
}

function sanitizeXaiRealtimeModel(value: unknown): string {
  const model = String(value || DEFAULT_XAI_REALTIME_MODEL).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(model) ? model : DEFAULT_XAI_REALTIME_MODEL;
}

function sanitizeXaiRealtimeVoice(value: unknown): string {
  const voice = String(value || DEFAULT_XAI_REALTIME_VOICE).trim().toLowerCase();
  return /^[a-zA-Z0-9._:-]+$/.test(voice) ? voice : DEFAULT_XAI_REALTIME_VOICE;
}

function sanitizeXaiRealtimeSpeed(value: unknown): number {
  const speed = Number(value || 1);
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.7, Math.min(1.5, Math.round(speed * 100) / 100));
}

router.get('/api/realtime/xai/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const hasApiKey = !!getXaiRealtimeApiKey();
  const hasOAuth = hasXaiRealtimeOAuth();
  res.json({
    success: true,
    configured: hasApiKey || hasOAuth,
    model: DEFAULT_XAI_REALTIME_MODEL,
    voice: DEFAULT_XAI_REALTIME_VOICE,
    voices: XAI_REALTIME_VOICE_IDS,
    auth: hasOAuth ? 'xai_oauth' : (hasApiKey ? 'api_key' : 'none'),
    oauthConfigured: hasOAuth,
    apiKeyConfigured: hasApiKey,
  });
});

router.post('/api/voice-agent/xai-realtime-bootstrap', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const voiceTarget = normalizeVoiceAgentTarget(body);
    const authCandidates = await getXaiRealtimeAuthCandidates();
    if (!authCandidates.length) {
      res.status(400).json({ ok: false, success: false, error: 'xAI Realtime requires an xAI API key (XAI_API_KEY) or a connected xAI OAuth account. Add one in Settings -> Models.' });
      return;
    }

    const activeRuntime = findActiveMainChatRuntimeForSession(sessionId, String(body.expectedRuntimeId || body.runtimeId || body.activeRunId || ''));
    const contextPacket = getReusableVoiceContextPacket(sessionId, body, activeRuntime);
    const voiceRuntimeContext = voiceRuntimeContextText(body.voiceRuntime || body.voice_runtime);
    if (voiceRuntimeContext) contextPacket.voiceRuntime = voiceRuntimeContext;
    const currentTime = buildVoiceTimeContext(body.deviceTime || body.device_time || body.clientTime || body.client_time);
    contextPacket.currentTime = currentTime;
    const originalPrompt = String(body.originalUserPrompt || '').trim();
    let contextBlockResult: { contextBlock: string; elapsedMs?: number; cacheHit?: boolean };
    try {
      contextBlockResult = await getVoiceAgentContextBlock(sessionId, originalPrompt, { voiceTarget });
    } catch (err: any) {
      console.warn('[xai-realtime] context block failed; starting with worker packet only:', err?.message || err);
      contextBlockResult = { contextBlock: '' };
    }
    const voiceAgentMemory = loadVoiceAgentMemoryForTarget(voiceTarget);
    const wakePhrase = cleanVoiceWakePhrase(body?.voiceRuntime?.wakePhrase || body?.voice_runtime?.wakePhrase || '');

    const instructions = buildRealtimeVoiceAgentInstructions({
      contextBlock: contextBlockResult.contextBlock,
      contextPacket,
      voiceAgentMemory,
      voiceRuntime: voiceRuntimeContext,
      wakePhrase,
      conversationTranscript: buildVoiceConversationTranscript(sessionId, 24, 600, voiceTarget),
      conversationSummary: buildVoiceCompactionSummaryBlock(sessionId, 4000, voiceTarget),
      recentToolLog: buildVoiceRecentToolLog(sessionId, 8, voiceTarget),
      currentTime,
      voiceTarget,
    });
    const tools = buildRealtimeVoiceAgentTools(voiceTarget);

    const model = sanitizeXaiRealtimeModel(body.model);
    const voice = sanitizeXaiRealtimeVoice(body.voice);
    const speed = sanitizeXaiRealtimeSpeed(body.speed);

    // Mint a short-lived ephemeral token. The browser cannot set WS headers, so it
    // connects with the token as a subprotocol (xai-client-secret.<token>) and sends
    // the session config (instructions/tools/voice) itself via session.update.
    let data: any = null;
    let usedAuth: XaiRealtimeAuthCandidate['auth'] | null = null;
    let lastFailure: { status: number; data: any; auth: XaiRealtimeAuthCandidate['auth'] } | null = null;
    const bodyJson = JSON.stringify({ expires_after: { seconds: 300 } });
    for (const candidate of authCandidates) {
      const upstream = await fetch(XAI_REALTIME_CLIENT_SECRETS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${candidate.token}`,
          'Content-Type': 'application/json',
          'User-Agent': XAI_REALTIME_USER_AGENT,
        },
        body: bodyJson,
      });
      const text = await upstream.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
      console.log('[xai-realtime] client_secret mint', {
        endpoint: XAI_REALTIME_CLIENT_SECRETS_ENDPOINT,
        auth: candidate.auth,
        status: upstream.status,
        ok: upstream.ok,
        responseKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : typeof parsed,
        body: upstream.ok ? undefined : String(text || '').slice(0, 500),
      });
      if (upstream.ok) {
        data = parsed;
        usedAuth = candidate.auth;
        break;
      }
      lastFailure = { status: upstream.status, data: parsed, auth: candidate.auth };
    }
    if (!data) {
      res.status(lastFailure?.status || 502).json({
        ok: false,
        success: false,
        error: lastFailure?.data?.error?.message || lastFailure?.data?.error || `xAI Realtime client_secret mint failed (${lastFailure?.status || 502})`,
        details: lastFailure?.data,
        auth: lastFailure?.auth || null,
      });
      return;
    }
    const clientSecret = String(data?.client_secret?.value || data?.value || data?.client_secret || data?.secret || '').trim();
    if (!clientSecret) {
      res.status(502).json({ ok: false, success: false, error: 'xAI Realtime client_secret was not returned.', details: data });
      return;
    }

    res.json({
      ok: true,
      success: true,
      provider: 'xai',
      clientSecret,
      auth: usedAuth,
      wsUrl: `${XAI_REALTIME_WS_BASE}?model=${encodeURIComponent(model)}`,
      model,
      voice,
      speed,
      instructions,
      tools,
      contextPacket,
      instructionsLength: instructions.length,
      toolCount: tools.length,
      expiresAt: data?.client_secret?.expires_at || data?.expires_at || null,
      sessionConfig: { type: 'realtime', model, voice, speed },
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/realtime-skill-context', async (req, res) => {
  try {
    const body = req.body || {};
    const transcript = String(body.transcript || body.text || body.message || '').trim();
    const maxChars = Math.min(8000, Math.max(1000, Number(body.maxChars || body.max_chars || 4200) || 4200));
    const result = buildRealtimeSkillContextForTranscript(transcript, maxChars);
    res.json({
      ok: true,
      success: true,
      matched: result.skills.length > 0,
      context: result.context,
      skills: result.skills,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

type NormalizedVoiceDispatchTask = { title: string; prompt: string };

function compactVoiceDispatchTitle(value: string, fallback: string): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.slice(0, 90);
}

function normalizeVoiceDispatchMode(value: unknown): VoiceWorkgroupMode {
  return String(value || '').trim() === 'sequential' ? 'sequential' : 'parallel';
}

function normalizeVoiceDispatchDelivery(value: unknown): VoiceWorkgroupDelivery {
  const clean = String(value || '').trim();
  if (clean === 'grouped_summary' || clean === 'task_panel_only') return clean;
  return 'report_each';
}

function normalizeVoiceDispatchTasks(body: any): NormalizedVoiceDispatchTask[] {
  const rawTasks = Array.isArray(body?.tasks) ? body.tasks : [];
  const tasks = rawTasks.map((raw: any, index: number) => {
    const prompt = typeof raw === 'string'
      ? raw
      : String(raw?.prompt || raw?.task || raw?.objective || raw?.message || raw?.instruction || '').trim();
    const title = typeof raw === 'object' && raw
      ? String(raw.title || raw.name || raw.label || '').trim()
      : '';
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) return null;
    return {
      title: compactVoiceDispatchTitle(title || cleanPrompt, `Voice worker ${index + 1}`),
      prompt: cleanPrompt.slice(0, 12000),
    };
  }).filter(Boolean) as NormalizedVoiceDispatchTask[];

  if (!tasks.length) {
    const prompt = String(body?.task || body?.prompt || body?.objective || body?.message || '').trim();
    if (prompt) {
      const title = String(body?.title || body?.name || '').trim();
      tasks.push({
        title: compactVoiceDispatchTitle(title || prompt, 'Voice worker task'),
        prompt: prompt.slice(0, 12000),
      });
    }
  }

  return tasks.slice(0, 8);
}

router.get('/api/voice-agent/workgroups/:id', (req, res) => {
  try {
    const workgroup = loadVoiceWorkgroup(String(req.params.id || ''));
    if (!workgroup) {
      res.status(404).json({ ok: false, success: false, error: 'Voice workgroup not found.' });
      return;
    }
    res.json({ ok: true, success: true, workgroup });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/dispatch-workers', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const tasks = normalizeVoiceDispatchTasks(body);
    if (!tasks.length) {
      res.status(400).json({ ok: false, success: false, error: 'dispatch_prometheus_worker requires task or tasks[].' });
      return;
    }

    const mode = normalizeVoiceDispatchMode(body.mode);
    const delivery = normalizeVoiceDispatchDelivery(body.delivery);
    const sourceTranscript = String(body.sourceTranscript || body.transcript || body.originalUserPrompt || body.task || '').trim();
    const workgroup = createVoiceWorkgroup({
      parentSessionId: sessionId,
      sourceTranscript,
      source: String(body.source || 'realtime_voice_dispatch').trim() || 'realtime_voice_dispatch',
      mode,
      delivery,
    });
    const taskChannel = inferTaskChannelFromSession(sessionId);
    const suppressOriginDelivery = delivery === 'grouped_summary' || delivery === 'task_panel_only';
    const createdTasks: Array<{ taskId: string; title: string; prompt: string; status: string; index: number }> = [];

    tasks.forEach((item, index) => {
      const task = createTask({
        title: item.title,
        prompt: item.prompt,
        sessionId: `run_once_${sessionId}_${Date.now()}_${index + 1}`,
        channel: taskChannel,
        plan: [{ index: 0, description: item.prompt.slice(0, 180) || item.title, status: 'pending' as const }],
        taskKind: 'run_once',
        originatingSessionId: sessionId,
        suppressOriginDelivery,
        voiceDispatch: {
          workgroupId: workgroup.id,
          workerIndex: index,
          workerTotal: tasks.length,
          sourceTranscript: sourceTranscript.slice(0, 500) || undefined,
          delivery,
          mode,
        },
      });
      appendJournal(task.id, {
        type: 'status_push',
        content: `Voice worker ${index + 1}/${tasks.length} queued from realtime dispatch group ${workgroup.id}.`,
      });
      addVoiceWorkgroupWorker(workgroup.id, {
        taskId: task.id,
        title: task.title,
        prompt: task.prompt,
        index,
        status: task.status,
      });
      createdTasks.push({ taskId: task.id, title: task.title, prompt: task.prompt, status: task.status, index });

      setImmediate(() => {
        try {
          const runner = new BackgroundTaskRunner(task.id, handleChat, makeBroadcastForTask(task.id), _telegramChannel);
          runner.start().catch((err: Error) => {
            console.error(`[VoiceDispatch] BackgroundTaskRunner error for ${task.id}:`, err?.message || err);
          });
        } catch (err: any) {
          console.error(`[VoiceDispatch] Failed to spawn runner for ${task.id}:`, err?.message || err);
        }
      });
      try {
        broadcastWS({
          type: 'task_running',
          taskId: task.id,
          title: task.title,
          source: 'voice_dispatch',
          sessionId,
          workgroupId: workgroup.id,
          workerIndex: index,
          workerTotal: tasks.length,
        });
        broadcastWS({ type: 'task_panel_update', taskId: task.id, workgroupId: workgroup.id });
      } catch {}
    });

    const refreshedWorkgroup = loadVoiceWorkgroup(workgroup.id) || workgroup;
    broadcastWS({
      type: 'voice_workgroup_dispatched',
      sessionId,
      workgroupId: workgroup.id,
      workgroup: refreshedWorkgroup,
      tasks: createdTasks,
      taskIds: createdTasks.map((task) => task.taskId),
      delivery,
      mode,
    });

    res.json({
      ok: true,
      success: true,
      dispatched: true,
      workgroupId: workgroup.id,
      workgroup: refreshedWorkgroup,
      taskIds: createdTasks.map((task) => task.taskId),
      tasks: createdTasks,
      delivery,
      mode,
      message: `Dispatched ${createdTasks.length} Prometheus worker${createdTasks.length === 1 ? '' : 's'}.`,
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/realtime-tool', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const toolName = String(body.toolName || body.name || '').trim();
    const parsedToolArgs = body.toolArgs && typeof body.toolArgs === 'object'
      ? body.toolArgs
      : parseVoiceToolArgs(body.arguments || body.args);
    const toolArgs = {
      ...parsedToolArgs,
      ...(body.voiceTarget || body.voice_target || body.target
        ? { voiceTarget: normalizeVoiceAgentTarget(body) }
        : {}),
      ...(toolName === 'voice_worker_status' && body.contextPacket && typeof body.contextPacket === 'object'
        ? { contextPacket: body.contextPacket }
        : {}),
    };
    if (!toolName) {
      res.status(400).json({ ok: false, success: false, error: 'toolName is required' });
      return;
    }
    const trace: VoiceAgentProcessEntry[] = [];
    const raw = await executeVoiceAgentToolWithTrace(sessionId, toolName, toolArgs, trace);
    const parsed = parseVoiceToolResult(raw);
    const runtimeDirective = voiceRuntimeDirectiveFromToolResult(parsed);
    // If this tool captured a screenshot, hand the preview back so the client can
    // overlay it on the voice orb directly (no reliance on the ws relay).
    const preview = takeLastVoiceScreenshotPreview(sessionId);
    res.json({
      ok: true,
      success: true,
      toolName,
      result: parsed,
      raw,
      runtimeDirective,
      preview,
      processEntries: trace,
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

// Vision summary for the xAI realtime voice agent. xAI voice/realtime models
// cannot take image input, so captures go through a sidecar vision model and the
// client feeds the text summary back into the live voice session. Grok is tried
// first, with OpenAI mini vision as the default fallback. Accepts { dataUrl } for
// a photo or { frames:[{dataUrl}], durationMs } for a sampled video clip.
router.post('/api/voice-agent/xai-vision-summary', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await executeXaiImageVisionSummary({
      dataUrl: typeof body.dataUrl === 'string' ? body.dataUrl : undefined,
      frames: Array.isArray(body.frames) ? body.frames : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      durationMs: Number(body.durationMs || 0) || undefined,
    });
    if (!result.success) {
      res.status(502).json({ ok: false, success: false, error: result.error || 'xAI vision summary failed', model: result.model });
      return;
    }
    res.json({
      ok: true,
      success: true,
      summary: result.summary,
      model: result.model,
      credentialSource: result.credential_source,
      fallbackFrom: result.fallback_from,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/voice/interruption', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'mobile_default').trim() || 'mobile_default', 'session ID');
    const transcript = String(body.userInterruptionTranscript || '').trim();
    const classification = classifyVoiceInterruption(transcript);
    const activeRuntime = findActiveMainChatRuntimeForSession(sessionId);
    const contextPacket = buildVoiceWorkerContextPacket(sessionId, body);
    const action = decideVoiceAgentAction(transcript, classification, contextPacket);
    const eventId = String(body.id || `voice_intr_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`);
    if (action === 'handoff_new_work') {
      voiceAgentWorkerHandoffSessions.set(sessionId, {
        at: Date.now(),
        transcript: transcript.slice(0, 500),
        eventId,
      });
    }
    const event = {
      id: eventId,
      sessionId,
      createdAt: new Date().toISOString(),
      reason: String(body.reason || 'barge_in').trim() || 'barge_in',
      originalUserPrompt: String(body.originalUserPrompt || '').trim(),
      currentUserPrompt: transcript,
      assistantTextSoFar: String(body.assistantTextSoFar || body.interruptedText || '').trim(),
      assistantSpokenTextSoFar: String(body.assistantSpokenTextSoFar || '').trim(),
      currentSpokenSegment: String(body.currentSpokenSegment || '').trim(),
      lastVoiceMilestone: String(body.lastVoiceMilestone || '').trim(),
      activeRunId: activeRuntime?.id || String(body.activeRunId || body.activeRequestId || '').trim(),
      activeToolName: contextPacket.activeToolName || activeRuntime?.checkpoint?.toolName || '',
      activeToolLabel: contextPacket.activeToolLabel || '',
      activeWorkflowLabel: activeRuntime?.label || '',
      userInterruptionTranscript: transcript,
      classification,
      status: 'captured',
      voiceMode: String(body.voiceMode || '').trim(),
      clientRequestId: String(body.activeRequestId || body.clientRequestId || '').trim(),
      isStreamActive: body.isStreamActive === true,
      voiceAgentAction: action,
      voiceContextPacketId: contextPacket.id,
    };
    let injectedContextText = buildVoiceInterruptionContextBlock(event);
    let steerApplied = false;
    let steerEventId = '';
    const voiceReply = '';
    if (
      action === 'steer_worker'
      && activeRuntime?.id
      && transcript
      && !classification.shouldAbortOriginalRun
      && !classification.shouldPauseOriginalRun
      && classification.intent !== 'unknown'
    ) {
      const steer = addPendingRuntimeSteer(activeRuntime.id, {
        sessionId,
        message: transcript,
        source: String(body.source || `voice_${event.voiceMode || 'interruption'}`).trim() || 'voice_interruption',
        clientRequestId: event.clientRequestId || undefined,
        kind: voiceSteerKindFromIntent(classification.intent),
        requiresWorkerResponse: classification.intent === 'question',
        voiceContextPacketId: contextPacket.id,
        spokenAck: voiceReply || undefined,
        responseMode: classification.intent === 'question' ? 'worker_reply' : 'narrate',
        contextSummary: buildVoiceContextSummaryForSteer(contextPacket),
      });
      if (steer.ok && steer.event) {
        steerApplied = true;
        steerEventId = steer.event.id;
        injectedContextText = buildChatSteerContextBlock(steer.event);
      }
    }
    const storedEvent = { ...event, injectedContextText, status: steerApplied ? 'injected_into_runtime' : 'handled_by_voice_agent', action, voiceReply, contextPacket };
    appendVoiceInterruptionLog(storedEvent);
    if (activeRuntime?.id) {
      updateLiveRuntimeCheckpoint(activeRuntime.id, {
        voiceInterruptionEvent: {
          id: eventId,
          intent: classification.intent,
          action,
          transcript: transcript.slice(0, 500),
          injectedContextText,
          steerApplied,
          steerEventId,
          voiceContextPacketId: contextPacket.id,
          voiceReply: voiceReply.slice(0, 500),
          at: Date.now(),
        },
      });
      if (action === 'interrupt_worker' && activeRuntime.abortable) {
        abortLiveRuntime(activeRuntime.id);
      }
    }
    broadcastWS({
      type: 'voice_interruption',
      sessionId,
      eventId,
      intent: classification.intent,
      action,
      transcript,
      currentUserPrompt: transcript,
      userInterruptionTranscript: transcript,
      voiceReply,
      contextPacket,
      shouldAbortOriginalRun: action === 'interrupt_worker',
      runtimeId: activeRuntime?.id || '',
      steerApplied,
      steerEventId,
      voiceContextPacketId: contextPacket.id,
    });
    res.json({
      ok: true,
      success: true,
      eventId,
      action,
      steerApplied,
      steerEventId,
      runtimeId: activeRuntime?.id || '',
      classification,
      contextPacket,
      injectedContextText,
      voiceReply,
      activeRun: activeRuntime ? summarizeMobileRuntime(activeRuntime) : null,
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

function splitComposerEmailList(value: any): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSentEmailComposerArtifact(args: any, sent: { id?: string; threadId?: string }, gmail: GmailConnector) {
  const now = new Date().toISOString();
  let accountEmail = '';
  try {
    const tokens = (gmail as any)?.loadTokens?.();
    accountEmail = tokens?.account_email ? String(tokens.account_email) : '';
  } catch {}
  const recipients = splitComposerEmailList(args.to);
  return {
    id: String(args.artifactId || args.id || `email-sent-${Date.now()}`),
    type: 'email_composer',
    provider: 'gmail',
    mode: 'sent',
    status: 'sent',
    title: 'Email sent',
    subtitle: recipients.length ? `To ${recipients.join(', ')}` : 'Sent',
    source: 'Gmail',
    accountEmail,
    to: recipients,
    cc: splitComposerEmailList(args.cc),
    bcc: splitComposerEmailList(args.bcc),
    subject: String(args.subject || '').trim(),
    body: String(args.body || ''),
    attachments: Array.isArray(args.attachments) ? args.attachments : [],
    messageId: sent.id,
    threadId: sent.threadId,
    createdAt: String(args.createdAt || now),
    sentAt: now,
  };
}

router.post('/api/connectors/gmail/send-composer', async (req, res) => {
  try {
    if (!isConnectorConnected('gmail')) {
      res.status(400).json({ success: false, error: 'Gmail is not connected.' });
      return;
    }
    const body = req.body || {};
    const to = splitComposerEmailList(body.to).join(', ');
    const subject = String(body.subject || '').trim();
    const emailBody = String(body.body || '');
    if (!to) {
      res.status(400).json({ success: false, error: 'Recipient required.' });
      return;
    }
    if (!subject) {
      res.status(400).json({ success: false, error: 'Subject required.' });
      return;
    }
    const gmail = getConnector('gmail') as unknown as GmailConnector;
    const sent = await gmail.sendEmail(
      to,
      subject,
      emailBody,
      splitComposerEmailList(body.cc).join(', ') || undefined,
      splitComposerEmailList(body.bcc).join(', ') || undefined,
    );
    res.json({
      success: true,
      messageId: sent.id,
      threadId: sent.threadId,
      artifact: buildSentEmailComposerArtifact(body, sent, gmail),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err || 'Failed to send email.') });
  }
});

router.post('/api/chat/steer', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session id');
    const steerAttachments = normalizeRuntimeVisionAttachmentsInput(body.attachments);
    const steerAttachmentPreviews = normalizeRuntimeAttachmentPreviewsInput(body.attachmentPreviews);
    const message = String(body.message || body.text || '').trim()
      || (steerAttachments.length || steerAttachmentPreviews.length ? `User sent ${steerAttachments.length + steerAttachmentPreviews.length} attachment(s) as a live steer.` : '');
    if (!message && steerAttachments.length === 0 && steerAttachmentPreviews.length === 0) {
      res.status(400).json({ ok: false, success: false, error: 'Message or attachment required' });
      return;
    }
    const expectedRuntimeId = String(body.expectedRuntimeId || body.runtimeId || '').trim();
    const activeRuntime = listLiveRuntimes()
      .filter((runtime) => (
        runtime.kind === 'main_chat'
        && String(runtime.sessionId || '') === sessionId
        && (!expectedRuntimeId || runtime.id === expectedRuntimeId)
      ))
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0] || null;
    if (!activeRuntime?.id) {
      res.status(409).json({ ok: false, success: false, error: 'No active steerable chat turn for this session.' });
      return;
    }
    const steer = addPendingRuntimeSteer(activeRuntime.id, {
      sessionId,
      message,
      source: String(body.source || 'web_queue_steer').trim() || 'web_queue_steer',
      clientRequestId: String(body.clientRequestId || '').trim() || undefined,
      attachments: steerAttachments,
      attachmentPreviews: steerAttachmentPreviews,
    });
    if (!steer.ok || !steer.event) {
      res.status(409).json({ ok: false, success: false, error: steer.error || 'Could not queue steer event.' });
      return;
    }
    const injectedContextText = buildChatSteerContextBlock(steer.event);
    updateLiveRuntimeCheckpoint(activeRuntime.id, {
      chatSteerEvent: {
        id: steer.event.id,
        transcript: message.slice(0, 500),
        injectedContextText,
        attachmentCount: steerAttachments.length + steerAttachmentPreviews.length,
        at: Date.now(),
      },
    });

    // Wake up any tool Promise waiting for a dev-source-edit approval for this session
    try {
      const approvalQueue = getApprovalQueue();
      const pendingApprovals = approvalQueue.listPending()
        .filter((a) => a.sessionId === sessionId && a.approvalKind === 'dev_source_edit');
      for (const pending of pendingApprovals) {
        approvalQueue.notifySteer(pending.id, message);
      }
    } catch { /* best effort */ }

    try {
      const questionQueue = getPrometheusQuestionQueue();
      const pendingQuestions = questionQueue.listPending()
        .filter((q) => q.sessionId === sessionId);
      for (const pending of pendingQuestions) {
        questionQueue.notifySteer(pending.id, message);
      }
    } catch { /* best effort */ }

    broadcastWS({
      type: 'chat_steer',
      sessionId,
      eventId: steer.event.id,
      runtimeId: activeRuntime.id,
      message: message.slice(0, 500),
      attachments: steerAttachments.map((attachment) => ({ name: attachment.name, mimeType: attachment.mimeType })),
      attachmentPreviews: steerAttachmentPreviews.map((preview: any) => ({ name: preview?.name, mimeType: preview?.mimeType, workspacePath: preview?.workspacePath || preview?.path || preview?.filePath })),
    });
    res.json({
      ok: true,
      success: true,
      eventId: steer.event.id,
      runtimeId: activeRuntime.id,
      injectedContextText,
      activeRun: summarizeMobileRuntime(activeRuntime),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.get('/api/push/public-key', (_req, res) => {
  try {
    res.json({ success: true, publicKey: getWebPushPublicKey() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/push/status', (_req, res) => {
  try {
    const subscriptions = listWebPushSubscriptions();
    res.json({
      success: true,
      supported: true,
      subscriptionCount: subscriptions.length,
      subscriptions: subscriptions.map((item) => ({
        id: item.id,
        deviceId: item.deviceId || '',
        deviceName: item.deviceName || '',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        lastSuccessAt: item.lastSuccessAt || 0,
        lastErrorAt: item.lastErrorAt || 0,
        lastError: item.lastError || '',
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/push/subscribe', (req, res) => {
  try {
    const saved = upsertWebPushSubscription({
      subscription: req.body?.subscription || req.body,
      deviceId: String(req.body?.deviceId || req.headers['x-pairing-token'] || '').trim(),
      deviceName: String(req.body?.deviceName || '').trim(),
      userAgent: String(req.headers['user-agent'] || '').trim(),
    });
    res.json({ success: true, id: saved.id, subscriptionCount: listWebPushSubscriptions().length });
  } catch (err: any) {
    res.status(400).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/push/unsubscribe', (req, res) => {
  try {
    const endpointOrId = String(req.body?.endpoint || req.body?.id || '').trim();
    const removed = removeWebPushSubscription(endpointOrId);
    res.json({ success: true, removed, subscriptionCount: listWebPushSubscriptions().length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/push/test', (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || getLastMainSessionId?.() || 'default').trim() || 'default';
    sendWebPushToAll({
      title: 'Notifications are on',
      body: 'Chat response notifications are ready.',
      url: `/?source=pwa#mobile/chat/${encodeURIComponent(sessionId)}`,
      tag: 'prometheus-push-test',
      data: { kind: 'push_test', sessionId },
    });
    res.json({ success: true, subscriptionCount: listWebPushSubscriptions().length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

function normalizeExcludedSkillIdsInput(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of raw) {
    const id = String(item || '').trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
    if (ids.length >= 20) break;
  }
  return ids;
}

function normalizeForcedSkillIdsInput(value: unknown): string[] {
  return normalizeExcludedSkillIdsInput(value);
}

router.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default', pinnedMessages, attachments, attachmentPreviews, reasoning, callerContext } = req.body;
  if (!message || typeof message !== 'string') { res.status(400).json({ error: 'Message required' }); return; }
  let resolvedSessionId: string;
  try {
    resolvedSessionId = assertSafeStorageId(String(sessionId || 'default'), 'session id');
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Invalid session id.' });
    return;
  }
  const excludedSkillIds = normalizeExcludedSkillIdsInput(req.body?.excludedSkillIds || req.body?.excludedMatchingSkillIds);
  const forcedSkillIds = normalizeForcedSkillIdsInput(req.body?.selectedSkillIds || req.body?.forcedSkillIds || req.body?.matchedSkillIds);
  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId || req.headers['x-client-request-id']);
  setLastMainSessionId(resolvedSessionId);
  const turnOrigin = normalizeTurnOrigin(req.body?.origin, resolvedSessionId, {
    channel: req.headers['x-pairing-token'] ? 'mobile' : undefined,
    surface: req.headers['x-pairing-token'] ? 'mobile_app' : undefined,
    device: req.headers['x-pairing-token'] ? 'phone' : undefined,
    source: 'api_chat',
  });
  persistTurnOriginChannelHint(resolvedSessionId, turnOrigin);
  const isMobileChatRequest = turnOrigin.channel === 'mobile' || !!req.headers['x-pairing-token'];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  try { (res as any).flushHeaders?.(); } catch {}
  try { res.write(': connected\n\n'); } catch {}

  if (clientRequestId) {
    const now = Date.now();
    pruneMobileChatRequestDedupe(now);
    const dedupeKey = mobileChatRequestDedupeKey(resolvedSessionId, clientRequestId);
    const duplicate = mobileChatRequestDedupe.get(dedupeKey);
    if (duplicate && duplicate.message === message) {
      const stream = getMainChatStream(resolvedSessionId);
      res.write(`data: ${JSON.stringify({ type: 'info', message: 'Duplicate chat send ignored; original request is already running.', clientRequestId })}\n\n`);
      if (stream?.streamId === duplicate.streamId && stream.active) {
        await streamExistingMainChatToResponse({
          res,
          sessionId: resolvedSessionId,
          streamId: stream.streamId,
          clientRequestId,
        });
      } else {
        for (const frame of stream?.events || []) {
          if (stream?.streamId !== duplicate.streamId) continue;
          res.write(`data: ${JSON.stringify({ type: frame.type, ...(frame.data || {}), seq: frame.seq, streamId: stream.streamId, at: frame.at, clientRequestId })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ type: 'done', duplicate: true, clientRequestId })}\n\n`);
      }
      res.end();
      return;
    }
  }

  const chatStream = beginMainChatStream(resolvedSessionId);
  if (clientRequestId) {
    mobileChatRequestDedupe.set(mobileChatRequestDedupeKey(resolvedSessionId, clientRequestId), {
      at: Date.now(),
      streamId: chatStream.streamId,
      message,
    });
  }

  const httpSendSSE = createSSESender(res);
  let sendSSE = (event: string, data: any) => {
    const eventData = clientRequestId ? { ...(data || {}), clientRequestId } : data;
    const frame = appendMainChatStreamEvent(resolvedSessionId, chatStream.streamId, event, eventData);
    const payload = frame
      ? { ...(eventData || {}), seq: frame.seq, streamId: chatStream.streamId }
      : eventData;
    httpSendSSE(event, payload);
  };
  const __turnT0 = Date.now();
  const __turnTimingLog = (label: string) => {
    try {
      if (!TURN_TIMING_ENABLED) return;
      const line = `${new Date().toISOString()} +${String(Date.now() - __turnT0).padStart(6)}ms session=${resolvedSessionId} ${label}\n`;
      fs.appendFileSync(path.join(getConfig().getConfigDir(), 'logs', 'turn-timing.log'), line, 'utf-8');
    } catch {}
  };
  __turnTimingLog('request_received');
  sendSSE('progress_state', { source: 'none', reason: 'request_start', activeIndex: -1, total: 0, items: [] });
  sendSSE('ui_preflight', { message: 'Request received. Starting chat turn...' });
  let lastNonHeartbeatSseAt = Date.now();
  let lastVisibleHeartbeatAt = 0;
  const heartbeat = setInterval(() => {
    const now = Date.now();
    const idleMs = Math.max(0, now - lastNonHeartbeatSseAt);
    const payload: Record<string, any> = { state: 'processing', idleMs };
    if (idleMs >= 12_000 && now - lastVisibleHeartbeatAt >= 15_000) {
      lastVisibleHeartbeatAt = now;
      payload.message = idleMs >= 30_000
        ? `Still connected. Prometheus is working (${Math.round(idleMs / 1000)}s since the last visible update).`
        : 'Still connected. Prometheus is working...';
    }
    try {
      if (!res.destroyed && !res.writableEnded) res.write(': ping\n\n');
    } catch {}
    sendSSE('heartbeat', payload);
  }, 5000);

  // ── Model busy guard — block cron scheduler while user chat is running ──
  setModelBusy(true);

  const abortController = new AbortController();
  const abortSignal = { aborted: false, signal: abortController.signal };
  const runtimeId = registerLiveRuntime({
    kind: 'main_chat',
    label: 'Main chat',
    sessionId: resolvedSessionId,
    source: turnOrigin.channel,
    detail: String(message || '').slice(0, 160),
    abortSignal,
    onAbort: () => abortController.abort(),
    recoveryPolicy: 'mark_interrupted',
    recoveryData: {
      message: String(message || ''),
      origin: turnOrigin,
      chatId: turnOrigin.chatId,
      userId: turnOrigin.userId,
      label: turnOrigin.label,
      attachments: Array.isArray(attachments) ? attachments.map((a: any) => ({ name: a?.name, mimeType: a?.mimeType })) : [],
    },
  });
  sendSSE('runtime_registered', {
    runtimeId,
    run: summarizeMobileRuntime(getLiveRuntime(runtimeId)),
  });
  const rawSendSSE = sendSSE;
  const runtimeProcessEntries: Record<string, any>[] = [];
  let __firstContentLogged = false;
  let runtimeThinkingTail = '';
  let lastRuntimeThinkingCheckpointAt = 0;
  sendSSE = (event, data) => {
    if (event !== 'heartbeat') lastNonHeartbeatSseAt = Date.now();
    rawSendSSE(event, data);
    // Skip per-token checkpointing — token/thinking_delta are high-frequency streaming
    // events that don't need durable persistence. 3 sync fs ops per token was killing
    // streaming throughput by blocking the Node.js event loop on every chunk.
    if (event === 'thinking_delta') {
      if (!__firstContentLogged) { __firstContentLogged = true; __turnTimingLog(`FIRST_CONTENT(${event})`); }
      const delta = String(data?.thinking || data?.text || '').trim();
      if (delta) runtimeThinkingTail = `${runtimeThinkingTail}${delta}`.slice(-4000);
      const now = Date.now();
      if (runtimeThinkingTail && now - lastRuntimeThinkingCheckpointAt >= 2000) {
        lastRuntimeThinkingCheckpointAt = now;
        updateLiveRuntimeCheckpoint(runtimeId, {
          event,
          at: now,
          thinkingTail: runtimeThinkingTail,
          processEntries: runtimeProcessEntries.length ? [...runtimeProcessEntries] : undefined,
        });
      }
      return;
    }
    if (event === 'token') {
      if (!__firstContentLogged) { __firstContentLogged = true; __turnTimingLog(`FIRST_CONTENT(${event})`); }
      return;
    }
    if (event === 'ui_preflight') __turnTimingLog(`preflight: ${String(data?.message || '').slice(0, 60)}`);
    else if (event === 'thinking' || event === 'tool_call' || event === 'tool_result' || event === 'progress_state') __turnTimingLog(`${event}: ${String(data?.message || data?.name || data?.action || '').slice(0, 60)}`);
    const checkpoint: Record<string, any> = { event, at: Date.now() };
    if (data?.message) checkpoint.message = String(data.message).slice(0, 1000);
    if (data?.action || data?.name) checkpoint.toolName = String(data.action || data.name);
    if (data?.args && typeof data.args === 'object') checkpoint.args = data.args;
    if (data?.result) checkpoint.result = String(data.result).slice(0, 1000);
    if (event === 'thinking') {
      const thinking = String(data?.thinking || data?.text || '').trim();
      if (thinking) runtimeThinkingTail = `${runtimeThinkingTail}\n${thinking}`.trim().slice(-4000);
    }
    if (runtimeThinkingTail) checkpoint.thinkingTail = runtimeThinkingTail;
    const processEntry = runtimeProcessEntryFromSseEvent(event, data);
    if (processEntry) {
      runtimeProcessEntries.push(processEntry);
      if (runtimeProcessEntries.length > 250) {
        runtimeProcessEntries.splice(0, runtimeProcessEntries.length - 250);
      }
      checkpoint.processEntries = [...runtimeProcessEntries];
    }
    updateLiveRuntimeCheckpoint(runtimeId, checkpoint);
  };
  let requestCompleted = false;
  res.on('close', () => {
    if (!requestCompleted && !abortSignal.aborted) {
      if (isMobileChatRequest) {
        console.log(`[v2] Mobile client disconnected — keeping task alive for session ${resolvedSessionId}`);
        return;
      }
      console.log(`[v2] Desktop client disconnected — keeping task alive for session ${resolvedSessionId}`);
    }
  });

  try {
    const result = await runInteractiveTurn(
      message,
	      resolvedSessionId,
	      sendSSE,
	      pinnedMessages,
		      abortSignal,
		      typeof callerContext === 'string' && callerContext.trim() ? callerContext.trim() : undefined,
		      reasoning && typeof reasoning === 'object' ? reasoning : undefined,
		      Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined,
          Array.isArray(attachmentPreviews) && attachmentPreviews.length > 0 ? attachmentPreviews : undefined,
          undefined,
          (excludedSkillIds.length || forcedSkillIds.length) ? { excludedSkillIds, forcedSkillIds } : undefined,
          turnOrigin,
          { clientRequestId },
			    );
        attachRuntimeProcessEntriesToLatestAssistant(resolvedSessionId, runtimeProcessEntries);
		    if (!abortSignal.aborted) {
		      markProviderStatus(true);
          const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim() || 'http';
          const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
          notifyChatCompletion({
            sessionId: resolvedSessionId,
            source: turnOrigin.channel === 'mobile' ? 'mobile' : 'desktop',
            finalText: result.text,
            requestOrigin: host ? `${proto}://${host}` : undefined,
            clientRequestId,
          });
	      sendSSE('final', {
        text: result.text,
        artifacts: result.artifacts,
        generatedImages: result.generatedImages,
        generatedVideos: result.generatedVideos,
        canvasFiles: result.canvasFiles,
        fileChanges: result.fileChanges,
        productCarousel: result.productCarousel,
        richArtifacts: result.richArtifacts,
      });
	      sendSSE('done', {
        reply: result.text, mode: result.type,
        sections: [{ type: result.type === 'execute' ? 'tool_results' : 'text', content: result.text }],
        thinking: result.thinking,
        results: result.toolResults,
        artifacts: result.artifacts,
        generatedImages: result.generatedImages,
        generatedVideos: result.generatedVideos,
        canvasFiles: result.canvasFiles,
        fileChanges: result.fileChanges,
        productCarousel: result.productCarousel,
        richArtifacts: result.richArtifacts,
      });
    }
		  } catch (err: any) {
		    if (!abortSignal.aborted) markProviderStatus(false);
	    if (!abortSignal.aborted) {
      console.error('[v2] ERROR:', err);
      sendSSE('error', { message: err.message || 'Unknown error' });
    }
  } finally {
    requestCompleted = true;
    editRerunAbortResetSessions.delete(resolvedSessionId);
    if (clientRequestId) {
      setTimeout(() => {
        mobileChatRequestDedupe.delete(mobileChatRequestDedupeKey(resolvedSessionId, clientRequestId));
      }, 5000);
    }
    clearInterval(heartbeat);
    finishLiveRuntime(runtimeId);
    finishMainChatStream(resolvedSessionId, chatStream.streamId);
    setModelBusy(false); // release busy guard — cron scheduler may now run
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

function markActiveRunsOnSessionList<T extends any>(input: T): T {
  const activeSessionIds = new Set(
    listLiveRuntimes()
      .filter((runtime: any) => runtime?.kind === 'main_chat' && runtime?.sessionId)
      .map((runtime: any) => String(runtime.sessionId)),
  );
  if (!activeSessionIds.size) return input;

  const mark = (session: any) => session && typeof session === 'object'
    ? { ...session, activeRun: activeSessionIds.has(String(session.id || '')) || session.activeRun === true }
    : session;

  if (Array.isArray(input)) return input.map(mark) as T;
  if (input && typeof input === 'object' && Array.isArray((input as any).sessions)) {
    return { ...(input as any), sessions: (input as any).sessions.map(mark) } as T;
  }
  return input;
}

// ── List sessions endpoint ────────────────────────────────────────────────────
router.get('/api/sessions', async (req, res) => {
  try {
    const channel = req.query.channel as string | undefined;
    if (channel) {
      const validChannels = ['terminal', 'telegram', 'web', 'mobile', 'discord', 'whatsapp', 'system'];
      if (!validChannels.includes(channel)) {
        res.status(400).json({ error: 'Invalid channel. Valid values: ' + validChannels.join(', ') });
        return;
      }
    }

    const includeAutomated = req.query.includeAutomated === '1'
      || req.query.includeAutomated === 'true';

    const hasPaging = req.query.limit != null || req.query.offset != null;
    if (hasPaging) {
      const page = listSessionSummaries({
        channel: channel as any,
        limit: Number(req.query.limit),
        offset: Number(req.query.offset),
        includeAutomated,
      });
      res.json(markActiveRunsOnSessionList(page));
      return;
    }

    res.json({ sessions: markActiveRunsOnSessionList(listSessionSummaries(channel as any)) });
  } catch (err: any) {
    console.error('[/api/sessions] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to list sessions' });
  }
});

router.post('/api/sessions', (req, res) => {
  try {
    const id = String(req.body?.id || req.body?.sessionId || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }

    const requestedChannel = String(req.body?.channel || '').trim();
    const validChannels = ['terminal', 'telegram', 'web', 'mobile', 'discord', 'whatsapp', 'system'];
    if (requestedChannel && !validChannels.includes(requestedChannel)) {
      res.status(400).json({ error: 'Invalid channel. Valid values: ' + validChannels.join(', ') });
      return;
    }

    const defaultChannel = req.headers['x-pairing-token'] ? 'mobile' : 'web';
    const channel = (requestedChannel || defaultChannel) as any;
    const session = touchSession(id, {
      channel,
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
    });
    flushSession(id);
    res.json({ success: true, session: { id: session.id, channel: session.channel, createdAt: session.createdAt, lastActiveAt: session.lastActiveAt } });
  } catch (err: any) {
    console.error('[/api/sessions POST] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to create session' });
  }
});


// ── Get single session by ID ──────────────────────────────────────────────────
router.get('/api/sessions/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const channel = String(req.query.channel || '').trim();
    const limit = Number(req.query.limit || 80);
    const validChannels = ['', 'terminal', 'telegram', 'web', 'mobile', 'discord', 'whatsapp', 'system'];
    if (!validChannels.includes(channel)) {
      res.status(400).json({ error: 'Invalid channel. Valid values: terminal, telegram, web, system' });
      return;
    }
    const sessions = searchSessionSummaries(q, {
      channel: channel ? channel as any : undefined,
      limit,
    }).map((session) => {
      const project = findProjectBySessionId(session.id);
      return project
        ? {
            ...session,
            projectId: project.id,
            projectName: project.name,
          }
        : session;
    });
    res.json({
      query: q,
      sessions: markActiveRunsOnSessionList(sessions),
    });
  } catch (err: any) {
    console.error('[/api/sessions/search] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to search sessions' });
  }
});

router.post('/api/sessions/:id/mobile-read', requireSafeSessionParam, (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const readAt = Number.isFinite(Number(req.body?.readAt)) ? Number(req.body.readAt) : Date.now();
    const summary = markSessionReadForMobile(id, readAt);
    res.json({ success: true, session: summary });
  } catch (e: any) {
    console.error('[/api/sessions/:id/mobile-read POST] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to mark session read' });
  }
});


router.post('/api/sessions/:id/history', requireSafeSessionParam, (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    if (isMobileHistorySyncRequest(req) && wouldDangerouslyReplaceSessionHistory(id, rawHistory)) {
      res.status(409).json({
        success: false,
        error: 'Refusing to overwrite an existing chat with an unrelated shorter mobile history sync.',
      });
      return;
    }
    const history = mergeHistoryWithExistingMessageMetadata(id, rawHistory);
    replaceHistory(id, history as any, { resetCompaction: req.body?.resetCompaction === true });
    flushSession(id);
    res.json({ success: true });
  } catch (e: any) {
    console.error('[/api/sessions/:id/history POST] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to replace session history' });
  }
});

function isMobileHistorySyncRequest(req: express.Request): boolean {
  const origin = req.body?.origin;
  return !!req.headers['x-pairing-token']
    || String(origin?.channel || '').toLowerCase() === 'mobile'
    || String(origin?.surface || '').toLowerCase() === 'mobile_app';
}

function timelineHistoryMessages(history: any[]): any[] {
  return (Array.isArray(history) ? history : [])
    .filter((msg) => {
      const role = msg?.role === 'assistant' || msg?.role === 'ai' || msg?.role === 'user' ? msg.role : '';
      const content = String(msg?.content || '').replace(/\s+/g, ' ').trim();
      return !!role && !!content;
    });
}

function firstUserMessageKey(history: any[]): string {
  const msg = timelineHistoryMessages(history).find((item) => item?.role === 'user');
  return String(msg?.content || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 500);
}

function wouldDangerouslyReplaceSessionHistory(sessionId: string, incomingHistory: any[]): boolean {
  try {
    const existing = timelineHistoryMessages(getHistory(sessionId));
    const incoming = timelineHistoryMessages(incomingHistory);
    if (existing.length < 2 || incoming.length < 1) return false;
    if (incoming.length >= existing.length) return false;
    const existingFirst = firstUserMessageKey(existing);
    const incomingFirst = firstUserMessageKey(incoming);
    return !!existingFirst && !!incomingFirst && existingFirst !== incomingFirst;
  } catch {
    return false;
  }
}

router.post('/api/sessions/:id/edit-rerun-reset', requireSafeSessionParam, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'Session id required' });
    return;
  }
  editRerunAbortResetSessions.add(id);
  res.json({ success: true });
});

router.patch('/api/sessions/:id', requireSafeSessionParam, (req, res) => {
  try {
    const title = String(req.body?.title || '').replace(/\s+/g, ' ').trim();
    if (!title) {
      res.status(400).json({ error: 'Title required' });
      return;
    }
    const summary = renameSession(req.params.id, title);
    if (!summary) {
      res.status(400).json({ error: 'Could not rename session' });
      return;
    }
    res.json({ success: true, session: summary });
  } catch (e: any) {
    console.error('[/api/sessions/:id PATCH] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to rename session' });
  }
});

router.get('/api/sessions/:id', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id);
    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const full = req.query.full === '1' || req.query.full === 'true';
    const mobileOptimized = req.query.mobile === '1'
      || req.query.client === 'mobile'
      || !!req.headers['x-pairing-token']
      || sessionId.startsWith('mobile_')
      || sessionId === 'mobile_default';
    const historyLimit = full
      ? 0
      : boundedPositiveInt(req.query.historyLimit, mobileOptimized ? 70 : 200, 20, mobileOptimized ? 180 : 500);
    const processLimit = full
      ? 500
      : boundedPositiveInt(req.query.processLimit, mobileOptimized ? 120 : 250, 20, mobileOptimized ? 160 : 500);
    const includeToolLog = full || req.query.includeToolLog === '1' || req.query.includeToolLog === 'true';
    const responseHistory = sanitizeHistoryForUiResponse(session.history, {
      historyLimit,
      includeToolLog,
      perMessageProcessLimit: full ? 500 : mobileOptimized ? 12 : 50,
      processEntryTextLimit: full ? 10_000_000 : mobileOptimized ? 900 : 1600,
      processEntryExtraLimit: full ? 10_000_000 : mobileOptimized ? 700 : 1200,
      attachmentPreviewDataUrlLimit: full ? 10_000_000 : mobileOptimized ? 30_000 : 60_000,
      attachmentPreviewTextLimit: full ? 10_000_000 : mobileOptimized ? 2000 : 4000,
    });
    const durableProcessLog = Array.isArray((session as any).processLog) ? (session as any).processLog : [];
    const responseProcessLog = [
      ...durableProcessLog,
      ...sessionProcessLogFromHistory({ history: responseHistory }),
    ]
      .slice(-processLimit)
      .map((entry: any) => sanitizeProcessEntryForUi(entry, {
        textLimit: full ? 10_000_000 : mobileOptimized ? 900 : 1600,
        extraLimit: full ? 10_000_000 : mobileOptimized ? 700 : 1200,
      }));
    
    res.json({
      session: {
        id: session.id,
        channel: session.channel,
        history: responseHistory,
        processLog: responseProcessLog,
        historyTruncated: !full && Array.isArray(session.history) && responseHistory.length < session.history.length,
        totalHistoryCount: Array.isArray(session.history) ? session.history.length : 0,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        lastAssistantAt: session.lastAssistantAt || null,
        mobileLastReadAt: session.mobileLastReadAt || null,
        mobileUnread: Number(session.lastAssistantAt || 0) > Number(session.mobileLastReadAt || 0),
        creativeMode: session.creativeMode || null,
        canvasProjectRoot: session.canvasProjectRoot || null,
        canvasProjectLabel: session.canvasProjectLabel || null,
        canvasProjectLink: session.canvasProjectLink || null,
        mainChatGoal: session.mainChatGoal || null,
        mainChatGoalHistory: session.mainChatGoalHistory || [],
        title: getSessionDisplayTitle(session),
        autoTitleLocked: session.autoTitleLocked === true,
      }
    });
  } catch (e: any) {
    console.error('[/api/sessions/:id] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/sessions/:id/context-window', requireSafeSessionParam, (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const profile = resolveActiveModelContextProfile();
    const budget = buildContextBudget(profile);
    const messageCount = resolveRollingCompactionPolicy().messageCount;
    const history = getHistoryForApiCall(id, Math.ceil(messageCount / 2), { maxMessages: messageCount });
    const recentToolContext = getRecentToolObservationsForContext(
      id,
      5,
      Math.max(2500, Math.min(16000, budget.toolContextBudgetTokens * 3)),
    );
    const calibration = getUsageCalibration(profile.providerId, profile.model);
    const calibrationFactor = calibration.factor || 1;
    const messageTokens = Math.round(estimateMessagesTokensForModel(history as any, profile) * calibrationFactor);
    const toolTokens = Math.round(estimateTextTokensForModel(recentToolContext, profile.tokenizer) * calibrationFactor);
    const currentInputTokens = messageTokens + toolTokens;
    const session = getSession(id);
    const storedThread = estimateStoredThreadFootprint(id, session, profile);
    const modelUsage = aggregateSessionModelUsage(id);
    const turnTelemetry = getLastTurnUsageTelemetry(session);
    const currentState = buildContextWindowCurrentState({
      sessionId: id,
      profile,
      currentInputTokens,
      messageTokens,
      recentToolTokens: toolTokens,
      inputBudgetTokens: budget.inputBudgetTokens,
      compactionTriggerTokens: budget.compactionTriggerTokens,
      storedThread,
      modelUsage,
      turnTelemetry,
    });
    res.json({
      success: true,
      sessionId: id,
      profile,
      budget,
      metricKind: 'current_context_state',
      currentState,
      currentStateTokens: currentState.currentStateTokens,
      nextCallEstimateTokens: currentInputTokens,
      currentInputTokens,
      messageTokens,
      toolObservationTokens: toolTokens,
      storedThread,
      modelUsage,
      turnTelemetry,
      calibration,
      contextWindowTokens: profile.contextWindowTokens,
      contextLimitTokens: currentState.contextLimitTokens,
      currentContextLimitTokens: profile.contextWindowTokens,
      inputBudgetTokens: budget.inputBudgetTokens,
      compactionTriggerTokens: budget.compactionTriggerTokens,
      percentOfWindow: profile.contextWindowTokens > 0 ? currentState.currentStateTokens / profile.contextWindowTokens : 0,
      percentOfContextLimit: currentState.contextLimitTokens > 0 ? currentState.currentStateTokens / currentState.contextLimitTokens : 0,
      percentOfCompactionTrigger: budget.compactionTriggerTokens > 0 ? currentState.currentStateTokens / budget.compactionTriggerTokens : 0,
      percentOfInputBudget: budget.inputBudgetTokens > 0 ? currentInputTokens / budget.inputBudgetTokens : 0,
      historyMessages: history.length,
      hasToolObservations: !!recentToolContext,
    });
  } catch (e: any) {
    console.error('[/api/sessions/:id/context-window] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to compute context window' });
  }
});

router.post('/api/sessions/:id/main-goal/:action', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    const action = String(req.params.action || '').trim().toLowerCase();
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Session id required' });
      return;
    }
    if (!['status', 'pause', 'resume', 'clear', 'done', 'revise'].includes(action)) {
      res.status(400).json({ success: false, error: 'Invalid goal action' });
      return;
    }
    const note = String(req.body?.goal || req.body?.text || req.body?.reason || req.body?.note || '').trim();
    const suffix = action === 'revise'
      ? `revise ${note}`
      : (note ? `${action} ${note}` : action);
    const result = handleMainChatGoalCommand(sessionId, `/goal ${suffix}`);
    if (result.shouldStartRunner) startMainChatGoalRunner(sessionId, `goal_action:${action}`);
    broadcastMainChatGoalState(sessionId, `action:${action}`, { goal: result.goal });
    res.json({ success: true, message: result.message, goal: result.goal });
  } catch (e: any) {
    console.error('[/api/sessions/:id/main-goal/:action] Error:', e);
    res.status(500).json({ success: false, error: e.message || 'Goal action failed' });
  }
});

router.delete('/api/sessions/:id', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) {
      res.status(400).json({ error: 'Session id is required' });
      return;
    }
    const project = findProjectBySessionId(sessionId);
    const deleted = project
      ? !!removeSessionFromProject(project.id, sessionId)
      : deleteSession(sessionId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ success: true, projectId: project?.id });
  } catch (e: any) {
    console.error('[/api/sessions/:id DELETE] Error:', e);
    res.status(storageAwareStatus(e)).json({ error: e.message });
  }
});

export { handleChat, runInteractiveTurn, bindTeamNotificationTargetFromSession };
