/**
 * telegram-channel.ts — Telegram Bot for Prometheus
 *
 * Uses raw Telegram Bot API via fetch() — no external dependencies.
 * Long polling loop: zero port forwarding, works from anywhere.
 *
 * Flow:
 *   1. User configures bot token + their Telegram user ID in settings
 *   2. Gateway starts long polling loop on boot (if enabled)
 *   3. Incoming messages → check allowlist → route to handleChat()
 *   4. Response → send back via Telegram sendMessage API
 *   5. Cron/heartbeat results can also push to Telegram
 *
 * File Browser:
 *   /browse [path]   — Opens inline keyboard file browser at workspace root (or given path)
 *   /download <path> — Downloads a file directly as a Telegram attachment
 *   Inline button callback_data drives all navigation in-place (edits existing message).
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getConfig } from '../../config/config';
import { isPublicDistributionBuild } from '../../runtime/distribution.js';
import { resolveGatewayAuthToken } from '../gateway-auth';
import { getLinkedSession, unlinkTelegramSession, getLastMainSessionId, linkTelegramSession, setSessionChannelHint, getSessionChannelHint } from './broadcaster';
import { getCreativeMode, getSession, sessionExists, type Session } from '../session';
import { getProject, listProjects, type Project } from '../projects/project-store.js';
import {
  registerLiveRuntime,
  finishLiveRuntime,
  listLiveRuntimes,
  getLiveRuntime,
  abortLiveRuntime,
  type LiveRuntimeSnapshot,
} from '../live-runtime-registry';
import {
	  formatTelegramAiTextFromMarkdown,
			  formatTelegramProgressState,
		  formatTelegramToolCall,
		  formatTelegramToolError,
	  formatTelegramToolResult,
	} from './telegram-tool-log';
import { sanitizeFinalReply, stripInternalToolNotes } from './reply-processor';

const CREATIVE_TELEGRAM_PROGRESS_INTERVAL = 10;
const CREATIVE_TELEGRAM_PROGRESS_MIN_INTERVAL_MS = 1500;
const CREATIVE_TELEGRAM_PROGRESS_MESSAGES = [
  'Working...',
  'Still working...',
  'Editing text...',
  'Analyzing image...',
  'Adding elements...',
  'Adjusting layout...',
  'Rendering preview...',
  'Checking frames...',
  'Polishing details...',
  'Compositing scene...',
  'Reviewing snapshot...',
  'Exporting result...',
];

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowedUserIds: number[];
  streamMode: 'full' | 'partial';
}

interface UpdateCheckResult {
  ok: boolean;
  available: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  commits?: Array<{ hash: string; subject: string }>;
  message: string;
  error?: string;
}

// Team management deps injected after boot
interface TeamDeps {
  getManagedTeam: (id: string) => any | null;
  listManagedTeams: () => any[];
  handleManagerConversation: (teamId: string, message: string, broadcast?: (data: object) => void) => Promise<void>;
  applyTeamChange?: (teamId: string, changeId: string) => Promise<{ success: boolean; error?: string }>;
  rejectTeamChange?: (teamId: string, changeId: string) => { success: boolean; error?: string };
  getCronJobs?: () => any[];
  runCronJobNow?: (jobId: string) => Promise<void>;
  updateCronJob?: (jobId: string, partial: any) => any | null;
  deleteCronJob?: (jobId: string) => boolean;
}

// Pending chat context — when user taps "Chat" on an agent/manager,
// their NEXT plain message is routed here (one-shot) then cleared.
interface PendingChatEntry {
  type: 'agent' | 'manager' | 'agent_direct' | 'agent_edit_prompt' | 'agent_edit_model' | 'task_chat' | 'schedule_edit_prompt' | 'schedule_edit_pattern';
  teamId?: string;
  agentId?: string;    // only for type='agent'
  taskId?: string;
  scheduleId?: string;
  agentName?: string;
  teamName?: string;
}

interface StopTargetEntry {
  sourceType: 'runtime' | 'task';
  id: string;
  kind: string;
  label: string;
  icon: string;
  startedAt: number;
  status: string;
  sessionId?: string;
  taskId?: string;
  teamId?: string;
  agentId?: string;
  scheduleId?: string;
  detail?: string;
}

type ResumeChannelKey = 'telegram' | 'discord' | 'whatsapp' | 'terminal';

type ResumeScope = 'all' | 'ch' | 'pr' | 'channel' | 'project';

interface ResumeSessionSummary {
  sessionId: string;
  title: string;
  firstMessage: string;
  messageCount: number;
  lastActiveAt: number;
  createdAt: number;
  projectId?: string | null;
  projectName?: string | null;
  channelKey?: ResumeChannelKey | null;
  isLinked: boolean;
}

interface ResumeProjectSummary {
  id: string;
  name: string;
  sessionCount: number;
  updatedAt: number;
}

const RESUME_PAGE_SIZE = 6;
const RESUME_CHANNEL_DEFS: Array<{ key: ResumeChannelKey; label: string; icon: string; emptyLabel: string }> = [
  { key: 'telegram', label: 'Telegram', icon: '💬', emptyLabel: 'Telegram bot chats' },
  { key: 'discord', label: 'Discord', icon: '🎮', emptyLabel: 'Discord chats' },
  { key: 'whatsapp', label: 'WhatsApp', icon: '🟢', emptyLabel: 'WhatsApp chats' },
  { key: 'terminal', label: 'CLI', icon: '🖥️', emptyLabel: 'Terminal sessions' },
];

function getSelfRepairApi(): null | typeof import('../../tools/self-repair') {
  if (isPublicDistributionBuild()) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../tools/self-repair.js');
}

function loadPendingRepairSafe(repairId: string): any | null {
  return getSelfRepairApi()?.loadPendingRepair(repairId) ?? null;
}

function listPendingRepairsSafe(): any[] {
  return getSelfRepairApi()?.listPendingRepairs() ?? [];
}

async function applyApprovedRepairSafe(repairId: string): Promise<{ success: boolean; message: string }> {
  const api = getSelfRepairApi();
  if (!api) {
    return { success: false, message: 'Self-repair is unavailable in the public distribution build.' };
  }
  return api.applyApprovedRepair(repairId);
}

function deletePendingRepairSafe(repairId: string): boolean {
  return getSelfRepairApi()?.deletePendingRepair(repairId) ?? false;
}

function formatRepairProposalSafe(repair: any): string {
  const api = getSelfRepairApi();
  return api ? api.formatRepairProposal(repair) : 'Self-repair is unavailable in the public distribution build.';
}

function getRepairButtonPayloadSafe(repair: any): { text: string } | null {
  const api = getSelfRepairApi();
  return api ? api.getRepairButtonPayload(repair) : null;
}

// ─── Telegram callback_data 64-byte limit workaround ─────────────────────────
// We keep a small in-process map: short key → full IDs.
// Keys are 8-char hex generated from the full string.
// This avoids overflow on long agent/team IDs.
const _tmKeyMap = new Map<string, { agentId?: string; teamId?: string }>();
const _tmChangeKeyMap = new Map<string, { teamId: string; changeId: string }>();
const _idKeyMap = new Map<string, string>();

function tmKey(agentId?: string, teamId?: string): string {
  const raw = `${agentId || ''}|${teamId || ''}`;
  // Simple djb2 hash → 8 hex chars
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
  const key = (h >>> 0).toString(16).padStart(8, '0');
  _tmKeyMap.set(key, { agentId, teamId });
  return key;
}

function tmResolve(key: string): { agentId?: string; teamId?: string } | null {
  return _tmKeyMap.get(key) || null;
}

function tmChangeKey(teamId: string, changeId: string): string {
  const raw = `${teamId}|${changeId}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
  const key = (h >>> 0).toString(16).padStart(8, '0');
  _tmChangeKeyMap.set(key, { teamId, changeId });
  return key;
}

function tmResolveChange(key: string): { teamId: string; changeId: string } | null {
  return _tmChangeKeyMap.get(key) || null;
}

function idKey(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h) ^ value.charCodeAt(i);
  const key = (h >>> 0).toString(16).padStart(8, '0');
  _idKeyMap.set(key, value);
  return key;
}

function idResolve(key: string): string | null {
  return _idKeyMap.get(key) || null;
}

const TELEGRAM_REASONING_EFFORTS: Record<string, Array<{ key: string; value: string; label: string }>> = {
  openai: [
    { key: 'off', value: '', label: 'Off' },
    { key: 'minimal', value: 'minimal', label: 'Minimal' },
    { key: 'low', value: 'low', label: 'Low' },
    { key: 'medium', value: 'medium', label: 'Medium' },
    { key: 'high', value: 'high', label: 'High' },
  ],
  openai_codex: [
    { key: 'off', value: '', label: 'Off' },
    { key: 'minimal', value: 'minimal', label: 'Minimal' },
    { key: 'low', value: 'low', label: 'Low' },
    { key: 'medium', value: 'medium', label: 'Medium' },
    { key: 'high', value: 'high', label: 'High' },
    { key: 'xhigh', value: 'xhigh', label: 'XHigh' },
  ],
  perplexity: [
    { key: 'off', value: '', label: 'Off' },
    { key: 'minimal', value: 'minimal', label: 'Minimal' },
    { key: 'low', value: 'low', label: 'Low' },
    { key: 'medium', value: 'medium', label: 'Medium' },
    { key: 'high', value: 'high', label: 'High' },
  ],
};

const TELEGRAM_ANTHROPIC_BUDGETS = [2048, 5000, 10000, 16000, 24000, 32000];

function escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTelegramCommandName(text: string, botUsername?: string | null): string | null {
  const firstToken = String(text || '').trim().split(/\s+/, 1)[0] || '';
  const match = firstToken.match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?$/);
  if (!match) return null;

  const targetBot = match[2];
  if (targetBot && botUsername && targetBot.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }

  return match[1].toLowerCase();
}

// ─── File path key map — keeps callback_data under 64 bytes ──────────────────
// File paths can be long (e.g. D:\Prometheus\workspace\skills\web-researcher\skill.md)
// which would exceed Telegram's 64-byte callback_data limit when base64-encoded.
// We store full paths here and use an 8-char hash as the key in callback_data.
// The map persists for the lifetime of the gateway process — buttons always work
// within a session, and on gateway restart the user just sends /browse again.
const _pathKeyMap = new Map<string, string>(); // hash → absolute path

function pathKey(absPath: string): string {
  const raw = String(absPath || '');
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
  const key = (h >>> 0).toString(16).padStart(8, '0');
  _pathKeyMap.set(key, raw);
  return key;
}

function pathResolve(key: string): string | null {
  return _pathKeyMap.get(key) || null;
}

interface TelegramDeps {
  handleChat: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    modelOverride?: string,
    executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron',
    toolFilter?: string[],
    attachments?: Array<{ base64: string; mimeType: string; name: string }>,
  ) => Promise<{ type: string; text: string; thinking?: string }>;
  runInteractiveTurn?: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    reasoningOptions?: any,
    attachments?: Array<{ base64: string; mimeType: string; name: string }>,
    modelOverride?: string,
  ) => Promise<{ type: string; text: string; thinking?: string; toolResults?: any[] }>;
  addMessage: (
    sessionId: string,
    msg: { role: 'user' | 'assistant'; content: string; timestamp: number },
    options?: { deferOnMemoryFlush?: boolean; disableMemoryFlushCheck?: boolean }
  ) => void;
  getIsModelBusy: () => boolean;
  broadcast: (data: object) => void;
  getWorkspace?: (sessionId: string) => string | undefined;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
    document?: {
      file_id: string;
      file_unique_id?: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    video?: {
      file_id: string;
      file_unique_id?: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
      duration?: number;
      width?: number;
      height?: number;
    };
    animation?: {
      file_id: string;
      file_unique_id?: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
      duration?: number;
      width?: number;
      height?: number;
    };
    video_note?: {
      file_id: string;
      file_unique_id?: string;
      file_size?: number;
      duration?: number;
      length?: number;
    };
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message: { message_id: number; chat: { id: number } };
    data: string;
  };
}

// ─── File Browser Config ───────────────────────────────────────────────────────

const BROWSER_MAX_BUTTONS_PER_ROW = 2;
const BROWSER_MAX_BUTTONS_TOTAL = 40;
const BROWSER_MAX_TEXT_PREVIEW = 2500; // bytes per page
const TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query'];

// callback_data prefix scheme (all path keys are 8-char hashes stored in _pathKeyMap):
//   fb:dir:<pathKey>       — navigate into a directory
//   fb:file:<pathKey>      — open/preview a file (page 0)
//   fb:page:<pathKey>:<n>  — paginate a text file preview (page n)
//   fb:preview:<pathKey>   — visual screenshot preview of a file
//   fb:home                — jump back to workspace root

// ─── Telegram Channel Class ────────────────────────────────────────────────────

export class TelegramChannel {
  private config: TelegramConfig;
  private deps: TelegramDeps;
  private teamDeps: TeamDeps | null = null;
  private spawnAgentFn: ((params: { agentId: string; task: string }) => Promise<any>) | null = null;
  // userId → pending chat target (one-shot: fires once then clears)
  private pendingChat = new Map<number, PendingChatEntry>();
  private polling: boolean = false;
  private lastUpdateId: number = 0;
  private botInfo: { id: number; first_name: string; username: string } | null = null;
  private abortController: AbortController | null = null;
  private workspaceRoot: string = process.env.PROMETHEUS_WORKSPACE_DIR || process.cwd();
  private progressMessageQueues = new Map<number, Promise<void>>();
  private creativeProgressCounters = new Map<string, number>();
  private creativeProgressStarted = new Set<string>();
  private creativeProgressLastSentAt = new Map<string, number>();
  private screenshotBrowserSelections = new Map<string, { sessionId: string; createdAt: number }>();

  private getTelegramSessionId(userId: number, chatId?: number): string {
    const linked = getLinkedSession(userId);
    if (linked) {
      if (typeof chatId === 'number' && Number.isFinite(chatId)) {
        setSessionChannelHint(linked, { channel: 'telegram', chatId, userId, timestamp: Date.now() });
      }
      return linked;
    }

    const latestTelegram = this.listResumeSessionsByChannel('telegram', userId)[0]?.sessionId;
    if (latestTelegram) {
      linkTelegramSession(userId, latestTelegram);
      if (typeof chatId === 'number' && Number.isFinite(chatId)) {
        setSessionChannelHint(latestTelegram, { channel: 'telegram', chatId, userId, timestamp: Date.now() });
      }
      return latestTelegram;
    }

    const fallback = `telegram_${userId}`;
    linkTelegramSession(userId, fallback);
    if (typeof chatId === 'number' && Number.isFinite(chatId)) {
      setSessionChannelHint(fallback, { channel: 'telegram', chatId, userId, timestamp: Date.now() });
    }
    return fallback;
  }

  private buildScreenshotReplyMarkup(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    return {
      inline_keyboard: [
        [{ text: '🌐 Browser instances', callback_data: 'ss:browser' }],
        [{ text: '🖥 Desktop', callback_data: 'ss:desktop' }],
      ],
    };
  }

  private htmlEscape(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private compactTelegramButtonText(value: string, max = 54): string {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
  }

  private makeScreenshotBrowserSelection(chatId: number, userId: number, sessionId: string): string {
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const key = `${chatId}:${userId}:${token}`;
    this.screenshotBrowserSelections.set(key, { sessionId, createdAt: Date.now() });
    const cutoff = Date.now() - 10 * 60_000;
    for (const [existingKey, value] of this.screenshotBrowserSelections.entries()) {
      if (value.createdAt < cutoff) this.screenshotBrowserSelections.delete(existingKey);
    }
    return token;
  }

  private getScreenshotBrowserSelection(chatId: number, userId: number, token: string): string | null {
    const key = `${chatId}:${userId}:${String(token || '').trim()}`;
    const value = this.screenshotBrowserSelections.get(key);
    if (!value) return null;
    if (Date.now() - value.createdAt > 10 * 60_000) {
      this.screenshotBrowserSelections.delete(key);
      return null;
    }
    return value.sessionId;
  }

  private async buildBrowserScreenshotPayload(
    chatId: number,
    userId: number,
  ): Promise<{ text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }> {
    const { listBrowserSessions } = await import('../browser-tools.js');
    const sessions = listBrowserSessions();
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    if (!sessions.length) {
      rows.push([{ text: '🌐 Current chat browser', callback_data: `ss:browser:current` }]);
    } else {
      for (const session of sessions.slice(0, 20)) {
        const token = this.makeScreenshotBrowserSelection(chatId, userId, session.sessionId);
        const title = session.title || session.url || session.sessionId;
        const label = `${session.originLabel || session.label || session.sessionId}${title ? ` · ${title}` : ''}`;
        rows.push([{ text: this.compactTelegramButtonText(`🌐 ${label}`), callback_data: `ss:b:${token}` }]);
      }
    }
    rows.push([{ text: '⬅️ Back', callback_data: 'ss:menu' }]);
    const lines = [
      `📸 <b>Browser Screenshots</b>`,
      sessions.length
        ? `Choose an active browser instance.`
        : `No active browser instances were detected. You can still try the current Telegram chat browser.`,
      ``,
      ...sessions.slice(0, 12).map((session, idx) => {
        const title = session.title || session.url || '(blank)';
        const port = session.debugPort ? ` · port ${session.debugPort}` : '';
        return `${idx + 1}. <b>${this.htmlEscape(session.originLabel || session.label || session.sessionId)}</b>${port}\n   <code>${this.htmlEscape(title).slice(0, 180)}</code>`;
      }),
    ];
    return { text: lines.filter((line) => line !== null).join('\n'), reply_markup: { inline_keyboard: rows } };
  }

  private buildDesktopMonitorReplyMarkup(
    monitors: Array<{ index: number; width: number; height: number; primary?: boolean }>,
  ): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [
      [{ text: '🧩 All monitors (combined)', callback_data: 'ss:desktop:all' }],
    ];
    for (const m of monitors) {
      const label = `🖥 Monitor ${m.index + 1}${m.primary ? ' (Primary)' : ''} ${m.width}x${m.height}`;
      rows.push([{ text: label, callback_data: `ss:desktop:m:${m.index}` }]);
    }
    rows.push([{ text: '⬅️ Back', callback_data: 'ss:menu' }]);
    return { inline_keyboard: rows };
  }

  private buildRestartReplyMarkup(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    return {
      inline_keyboard: [
        [{ text: '🔁 Full Restart', callback_data: 'rs:full' }],
        [{ text: '⚡ Quick Restart', callback_data: 'rs:quick' }],
      ],
    };
  }

  private buildUpdateReplyMarkup(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    return {
      inline_keyboard: [
        [{ text: '✅ Update Now', callback_data: 'us:apply' }],
        [{ text: '🔎 Re-check', callback_data: 'us:check' }],
        [{ text: '❌ Cancel', callback_data: 'us:cancel' }],
      ],
    };
  }

  private runShellCapture(command: string, cwd: string, timeoutMs: number = 15000): { ok: boolean; stdout: string; stderr: string } {
    try {
      const out = execSync(command, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: timeoutMs,
      });
      return { ok: true, stdout: String(out || '').trim(), stderr: '' };
    } catch (err: any) {
      const stdout = String(err?.stdout || '').trim();
      const stderr = String(err?.stderr || err?.message || '').trim();
      return { ok: false, stdout, stderr };
    }
  }

  private checkForGitUpdate(): UpdateCheckResult {
    const root = path.resolve(__dirname, '..', '..', '..');
    const gitProbe = this.runShellCapture('git rev-parse --is-inside-work-tree', root, 6000);
    if (!gitProbe.ok || gitProbe.stdout !== 'true') {
      return {
        ok: false,
        available: false,
        message: 'This install is not a git working tree. /update currently supports git installs.',
      };
    }

    const branchRes = this.runShellCapture('git rev-parse --abbrev-ref HEAD', root, 6000);
    if (!branchRes.ok || !branchRes.stdout) {
      return { ok: false, available: false, message: 'Could not resolve current git branch.' };
    }
    const branch = branchRes.stdout;
    const upstreamRes = this.runShellCapture('git rev-parse --abbrev-ref --symbolic-full-name @{u}', root, 6000);
    if (!upstreamRes.ok) {
      return {
        ok: false,
        available: false,
        branch,
        message: `No upstream tracking branch is configured for "${branch}".`,
      };
    }

    this.runShellCapture('git fetch --quiet', root, 20000);
    const countsRes = this.runShellCapture('git rev-list --left-right --count HEAD...@{u}', root, 6000);
    if (!countsRes.ok) {
      return { ok: false, available: false, branch, message: 'Unable to compare local branch with upstream.' };
    }

    const [aheadRaw, behindRaw] = countsRes.stdout.split(/\s+/);
    const ahead = Number(aheadRaw || 0);
    const behind = Number(behindRaw || 0);
    const available = Number.isFinite(behind) && behind > 0;
    let message = `Already up to date on "${branch}".`;
    if (available && ahead > 0) message = `Update available: behind ${behind}, ahead ${ahead} on "${branch}".`;
    else if (available) message = `Update available: behind by ${behind} commit(s) on "${branch}".`;
    else if (ahead > 0) message = `Local branch "${branch}" is ahead by ${ahead} commit(s).`;

    let commits: Array<{ hash: string; subject: string }> = [];
    if (available) {
      const logRes = this.runShellCapture('git log --oneline -n 6 HEAD..@{u}', root, 8000);
      if (logRes.ok && logRes.stdout) {
        commits = logRes.stdout.split(/\r?\n/).map((line) => {
          const trimmed = String(line || '').trim();
          const sp = trimmed.indexOf(' ');
          return sp > 0
            ? { hash: trimmed.slice(0, sp), subject: trimmed.slice(sp + 1) }
            : { hash: trimmed, subject: '' };
        }).filter((c) => c.hash);
      }
    }

    return { ok: true, available, branch, ahead, behind, commits, message };
  }

  private formatUpdateCheckMessage(check: UpdateCheckResult): string {
    const lines: string[] = ['🔥 <b>Update Check</b>', ''];
    lines.push(check.ok ? `Status: ${check.message}` : `Status: ${check.message}`);
    if (typeof check.branch === 'string' && check.branch) lines.push(`Branch: <code>${check.branch}</code>`);
    if (typeof check.behind === 'number' || typeof check.ahead === 'number') {
      lines.push(`Ahead/Behind: ${Number(check.ahead || 0)} / ${Number(check.behind || 0)}`);
    }
    if (check.available && Array.isArray(check.commits) && check.commits.length > 0) {
      lines.push('');
      lines.push('<b>Incoming commits:</b>');
      for (const c of check.commits.slice(0, 6)) {
        lines.push(`• <code>${c.hash}</code> ${String(c.subject || '').slice(0, 120)}`);
      }
    }
    return lines.join('\n');
  }

  private async runTelegramSelfUpdate(chatId: number, userId: number): Promise<void> {
    const sessionId = this.getTelegramSessionId(userId, chatId);
    const root = path.resolve(__dirname, '..', '..', '..');
    const check = this.checkForGitUpdate();
    if (!check.ok) {
      await this.sendMessage(chatId, `❌ ${check.message}`);
      return;
    }
    if (!check.available) {
      await this.sendMessage(chatId, `✅ ${check.message}`);
      return;
    }

    const dirty = this.runShellCapture('git status --porcelain', root, 6000);
    if (dirty.ok && dirty.stdout) {
      await this.sendMessage(chatId, '❌ Update blocked: local git changes detected. Commit/stash changes first.');
      return;
    }

    await this.sendMessage(chatId, '🔥 Update confirmed. Running: fetch → pull --ff-only → npm install → npm run build');

    const pullRes = this.runShellCapture('git pull --ff-only', root, 45000);
    if (!pullRes.ok) {
      await this.sendMessage(chatId, `❌ git pull failed.\n\n<code>${String(pullRes.stderr || pullRes.stdout).slice(-1200)}</code>`);
      return;
    }

    const installRes = this.runShellCapture('npm install', root, 180000);
    if (!installRes.ok) {
      await this.sendMessage(chatId, `❌ npm install failed.\n\n<code>${String(installRes.stderr || installRes.stdout).slice(-1200)}</code>`);
      return;
    }

    const buildRes = this.runShellCapture('npm run build', root, 240000);
    if (!buildRes.ok) {
      await this.sendMessage(chatId, `❌ Build failed. Gateway will stay online.\n\n<code>${String(buildRes.stderr || buildRes.stdout).slice(-1200)}</code>`);
      return;
    }

    await this.sendMessage(chatId, '✅ Update build succeeded. Restarting gateway now...');
    const { gracefulRestart } = await import('../lifecycle.js');
    await gracefulRestart({
      reason: 'self_update',
      timestamp: Date.now(),
      title: 'Telegram self-update',
      summary: `Self-update requested from Telegram by user ${userId}.`,
      previousSessionId: sessionId,
      originChannel: 'telegram',
      respondToTelegram: true,
      previousTelegramChatId: String(chatId),
      previousTelegramUserId: userId,
      buildOutput: String(buildRes.stdout || '').slice(-2000),
      testInstructions: 'Confirm update pulled latest commits, gateway restarted, and Telegram polling resumed.',
    });
  }

  private async runFullRestart(chatId: number, userId: number): Promise<void> {
    const sessionId = this.getTelegramSessionId(userId, chatId);
    await this.sendMessage(chatId, '🔁 Full restart requested. Running build now...');
    const { buildAndRestart } = await import('../lifecycle.js');
    const result = await buildAndRestart({
      reason: 'manual',
      timestamp: Date.now(),
      title: 'Telegram full restart',
      summary: `Full restart requested from Telegram by user ${userId}.`,
      previousSessionId: sessionId,
      originChannel: 'telegram',
      respondToTelegram: true,
      previousTelegramChatId: String(chatId),
      previousTelegramUserId: userId,
      testInstructions: 'Confirm gateway booted and Telegram polling resumed.',
    });
    if (!result.success) {
      await this.sendMessage(chatId, `❌ Build failed. Restart cancelled.\n\n<code>${String(result.output || '').slice(-1200)}</code>`);
      return;
    }
    await this.sendMessage(chatId, `✅ Build succeeded (${result.durationMs}ms). Restarting now...`);
  }

  private async runQuickRestart(chatId: number, userId: number): Promise<void> {
    const sessionId = this.getTelegramSessionId(userId, chatId);
    await this.sendMessage(chatId, '⚡ Quick restart requested. Restarting gateway without build...');
    const { gracefulRestart } = await import('../lifecycle.js');
    await gracefulRestart({
      reason: 'manual',
      timestamp: Date.now(),
      title: 'Telegram quick restart',
      summary: `Quick restart requested from Telegram by user ${userId}.`,
      previousSessionId: sessionId,
      originChannel: 'telegram',
      respondToTelegram: true,
      previousTelegramChatId: String(chatId),
      previousTelegramUserId: userId,
      testInstructions: 'Confirm gateway booted and Telegram polling resumed.',
    });
  }

  private async sendPhotoToChat(
    chatId: number,
    imageData: Buffer | string,
    caption: string = '',
    fileName: string = 'screenshot.png',
    mimeType: string = 'image/png',
  ): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) return;
    const buf = typeof imageData === 'string'
      ? Buffer.from(imageData, 'base64')
      : imageData;
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([buf], { type: mimeType || 'image/png' }), fileName || 'image.png');
    if (caption) {
      form.append('caption', caption.slice(0, 1024));
      form.append('parse_mode', 'HTML');
    }
    const resp = await fetch(`${this.apiBase}/sendPhoto`, { method: 'POST', body: form });
    const data: any = await resp.json();
    if (!data.ok) {
      throw new Error(data.description || 'Telegram sendPhoto failed');
    }
  }

  async sendFileToChat(chatId: number, filePath: string, caption: string = '', options: { forceDocument?: boolean } = {}): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) return;
    const resolved = path.resolve(String(filePath || ''));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`File not found: ${filePath}`);
    }
    const ext = path.extname(resolved).toLowerCase();
    const fileName = path.basename(resolved);
    const fileBuffer = fs.readFileSync(resolved);
    const imageMime: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    const videoMime: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.m4v': 'video/x-m4v',
      '.webm': 'video/webm',
    };
    if (imageMime[ext]) {
      await this.sendPhotoToChat(chatId, fileBuffer, caption, fileName, imageMime[ext]);
      return;
    }
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) {
      form.append('caption', caption.slice(0, 1024));
      form.append('parse_mode', 'HTML');
    }
    if (videoMime[ext] && options.forceDocument !== true) {
      form.append('video', new Blob([fileBuffer], { type: videoMime[ext] }), fileName);
      const resp = await fetch(`${this.apiBase}/sendVideo`, { method: 'POST', body: form });
      const data: any = await resp.json();
      if (data.ok) return;
      console.warn(`[Telegram] sendVideo failed for ${fileName}; retrying as document: ${data.description || 'unknown error'}`);
      const docForm = new FormData();
      docForm.append('chat_id', String(chatId));
      if (caption) {
        docForm.append('caption', caption.slice(0, 1024));
        docForm.append('parse_mode', 'HTML');
      }
      docForm.append('document', new Blob([fileBuffer], { type: videoMime[ext] }), fileName);
      const docResp = await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: docForm });
      const docData: any = await docResp.json();
      if (!docData.ok) throw new Error(docData.description || data.description || 'Telegram video upload failed');
      return;
    }
    form.append('document', new Blob([fileBuffer], { type: videoMime[ext] || 'application/octet-stream' }), fileName);
    const resp = await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: form });
    const data: any = await resp.json();
    if (!data.ok) throw new Error(data.description || 'Telegram sendDocument failed');
  }

  private async sendGeneratedImagesToChat(chatId: number, generatedImages: any[]): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) return;
    const fsLocal = require('fs') as typeof import('fs');
    const pathLocal = require('path') as typeof import('path');
    const inferMimeType = (filePath: string, hintedMimeType?: string): string => {
      const hinted = String(hintedMimeType || '').trim().toLowerCase();
      if (hinted.startsWith('image/')) return hinted;
      switch (pathLocal.extname(String(filePath || '')).toLowerCase()) {
        case '.jpg':
        case '.jpeg':
          return 'image/jpeg';
        case '.webp':
          return 'image/webp';
        case '.gif':
          return 'image/gif';
        case '.png':
        default:
          return 'image/png';
      }
    };

    const files = generatedImages
      .map((image) => {
        const rawPath = String(image?.path || image?.rel_path || '').trim();
        if (!rawPath) return null;
        const absPath = pathLocal.isAbsolute(rawPath)
          ? rawPath
          : pathLocal.join(this.workspaceRoot, rawPath);
        if (!fsLocal.existsSync(absPath)) return null;
        return {
          absPath,
          fileName: String(image?.file_name || pathLocal.basename(absPath) || 'generated-image.png').trim() || 'generated-image.png',
          mimeType: inferMimeType(absPath, image?.mime_type),
        };
      })
      .filter(Boolean) as Array<{ absPath: string; fileName: string; mimeType: string }>;

    if (!files.length) return;

    const caption = files.length === 1
      ? '🖼️ <b>Generated image</b>'
      : `🖼️ <b>Generated ${files.length} images</b>`;

    if (files.length === 1) {
      const file = files[0];
      await this.sendPhotoToChat(chatId, fsLocal.readFileSync(file.absPath), caption, file.fileName, file.mimeType);
      return;
    }

    try {
      const mediaItems = files.slice(0, 10).map((file, index) => (
        index === 0
          ? { type: 'photo', media: `attach://generated_${index}`, caption, parse_mode: 'HTML' }
          : { type: 'photo', media: `attach://generated_${index}` }
      ));
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('media', JSON.stringify(mediaItems));
      files.slice(0, 10).forEach((file, index) => {
        const buf = fsLocal.readFileSync(file.absPath);
        form.append(`generated_${index}`, new Blob([buf], { type: file.mimeType || 'image/png' }), file.fileName);
      });
      const resp = await fetch(`${this.apiBase}/sendMediaGroup`, { method: 'POST', body: form });
      const data: any = await resp.json();
      if (!data.ok) throw new Error(data.description || 'Telegram sendMediaGroup failed');
    } catch (err) {
      console.warn(`[Telegram] sendGeneratedImagesToChat media group failed: ${String((err as any)?.message || err)}`);
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        await this.sendPhotoToChat(
          chatId,
          fsLocal.readFileSync(file.absPath),
          index === 0 ? caption : '',
          file.fileName,
          file.mimeType,
        );
      }
    }
  }

  private async sendGeneratedVideosToChat(chatId: number, generatedVideos: any[]): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) return;
    const fsLocal = require('fs') as typeof import('fs');
    const pathLocal = require('path') as typeof import('path');

    for (let index = 0; index < generatedVideos.length; index += 1) {
      const video = generatedVideos[index];
      const rawPath = String(video?.path || video?.rel_path || '').trim();
      if (!rawPath) continue;
      const absPath = pathLocal.isAbsolute(rawPath)
        ? rawPath
        : pathLocal.join(this.workspaceRoot, rawPath);
      if (!fsLocal.existsSync(absPath)) continue;

      const caption = index === 0
        ? '🎬 <b>Generated video</b>'
        : '';
      await this.sendFileToChat(chatId, absPath, caption, { forceDocument: false });
    }
  }

  private async runTelegramBrowserScreenshot(
    chatId: number,
    userId: number,
    triggerLabel: string,
    opts?: { sessionId?: string },
  ): Promise<string> {
    const sessionId = String(opts?.sessionId || '').trim() || this.getTelegramSessionId(userId, chatId);
    const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const { browserVisionScreenshot, getBrowserSessionInfo } = await import('../browser-tools.js');
    const info = getBrowserSessionInfo(sessionId);
    const origin = info.originLabel || 'Browser';
    const title = info.title || info.url || '';
    const caption = [
      `Browser screenshot (${triggerLabel}) @ ${ts}`,
      origin,
      title ? title.slice(0, 140) : '',
    ].filter(Boolean).join('\n');
    const shot = await browserVisionScreenshot(sessionId);
    if (!shot?.base64) return 'ERROR: No browser session. Use browser_open first.';
    await this.sendPhotoToChat(chatId, Buffer.from(shot.base64, 'base64'), caption);
    return `Browser screenshot sent (${shot.width}x${shot.height}) from ${origin}.`;
  }

  private async runTelegramDesktopScreenshot(
    chatId: number,
    userId: number,
    opts?: { monitorIndex?: number; triggerLabel?: string },
  ): Promise<string> {
    const sessionId = this.getTelegramSessionId(userId, chatId);
    const triggerLabel = String(opts?.triggerLabel || 'desktop button');
    const monitorIndex = Number.isFinite(Number(opts?.monitorIndex))
      ? Math.max(0, Math.floor(Number(opts?.monitorIndex)))
      : null;
    const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const caption = monitorIndex === null
      ? `Desktop screenshot (${triggerLabel}) @ ${ts}`
      : `Desktop monitor ${monitorIndex + 1} screenshot (${triggerLabel}) @ ${ts}`;

    const { desktopScreenshot, getDesktopAdvisorPacket } = await import('../desktop-tools.js');
    const result = await desktopScreenshot(
      sessionId,
      monitorIndex === null ? { capture: 'all' } : { capture: monitorIndex },
    );
    if (/^ERROR:/i.test(String(result || ''))) return String(result || 'ERROR: desktop_screenshot failed.');

    const packet = getDesktopAdvisorPacket(sessionId);
    if (!packet?.screenshotBase64) return 'ERROR: Desktop screenshot capture completed, but no image packet was stored.';
    await this.sendPhotoToChat(chatId, Buffer.from(packet.screenshotBase64, 'base64'), caption);
    return `Desktop screenshot sent (${packet.width}x${packet.height}).`;
  }

  private buildTelegramCommandsMessage(_userId: number): string {
    return [
      `🔥 <b>Prometheus Commands</b>`,
      ``,
      `💬 <b>Chat</b>`,
      `/status — bot &amp; model status`,
      `/clear — clear history  /new — new session`,
      `/resume — reopen an older chat`,
      `/cancel — cancel pending flow`,
      `/stop_now — abort current main chat turn`,
      `/stop — inspect and abort any live AI flow`,
      ``,
      `📁 <b>Workspace</b>`,
      `/browse [path] — file browser`,
      `/download &lt;path&gt; — download file`,
      `/screenshot — browser or desktop screenshot`,
      `/restart — full or quick restart`,
      `/update — check &amp; apply updates`,
      ``,
      `🤖 <b>Teams &amp; Agents</b>`,
      `/teams — team browser &amp; controls`,
      `/agents — browse, dispatch, edit agents`,
      `/tasks — background tasks &amp; controls`,
      `/schedule — schedules &amp; controls`,
      ``,
	      `⚡ <b>Models</b>`,
	      `/models — provider &amp; model picker`,
	      `/reasoning — current provider reasoning controls`,
	      ``,
      `📋 <b>Proposals &amp; Repairs</b>`,
      `/proposals [pending|done|id] — inbox`,
      `/repairs — pending repairs`,
      `/approve &lt;id&gt; · /reject &lt;id&gt; — act on proposal`,
      ``,
      `🔌 <b>Integrations</b>`,
      `/integrations — configured integrations`,
      `/mcp-status — MCP server status`,
      `/setup &lt;service&gt; — connect a service`,
      ``,
      `🎯 <b>Goals</b>`,
      `/approve_goal &lt;id&gt; · /reject_goal &lt;id&gt;`,
    ].join('\n');
  }

  private getActiveReasoningContext(): { cfg: any; llm: any; provider: string; providerCfg: any; model: string } {
    const cfg = getConfig().getConfig() as any;
    const llm = cfg?.llm || {};
    const provider = String(llm.provider || 'ollama').trim() || 'ollama';
    const providerCfg = llm?.providers?.[provider] || {};
    const model = String(providerCfg?.model || cfg?.models?.primary || 'unknown').trim() || 'unknown';
    return { cfg, llm, provider, providerCfg, model };
  }

  private getReasoningProviderLabel(provider: string): string {
    return ({
      anthropic: 'Anthropic Claude',
      openai: 'OpenAI API',
      openai_codex: 'OpenAI Codex',
      perplexity: 'Perplexity',
      ollama: 'Ollama',
      llama_cpp: 'llama.cpp',
      lm_studio: 'LM Studio',
      gemini: 'Google Gemini',
    } as Record<string, string>)[provider] || provider;
  }

  private buildReasoningMenu(): { text: string; keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    const { provider, providerCfg, model } = this.getActiveReasoningContext();
    const providerLabel = this.getReasoningProviderLabel(provider);
    const footer = [[
      { text: '🔄 Refresh', callback_data: 'rg:list' },
      { text: '🤖 Models', callback_data: 'md:list' },
    ]];

    if (provider === 'anthropic') {
      const enabled = providerCfg?.extended_thinking === true;
      const rawBudget = Number(providerCfg?.thinking_budget);
      const budget = Number.isFinite(rawBudget) && rawBudget >= 1024 ? Math.floor(rawBudget) : 10000;
      const keyboard: Array<Array<{ text: string; callback_data: string }>> = [[
        { text: enabled ? '✅ On' : 'On', callback_data: 'rg:ath:on' },
        { text: !enabled ? '✅ Off' : 'Off', callback_data: 'rg:ath:off' },
      ]];
      for (let i = 0; i < TELEGRAM_ANTHROPIC_BUDGETS.length; i += 3) {
        const row = TELEGRAM_ANTHROPIC_BUDGETS.slice(i, i + 3).map((value) => ({
          text: `${value === budget ? '✅ ' : ''}${Math.round(value / 1000)}k`,
          callback_data: `rg:bud:${value}`,
        }));
        keyboard.push(row);
      }
      keyboard.push(...footer);
      return {
        text: [
          '🧠 <b>Reasoning Controls</b>',
          '',
          `<b>Provider:</b> ${escHtml(providerLabel)} (<code>${escHtml(provider)}</code>)`,
          `<b>Model:</b> <code>${escHtml(model)}</code>`,
          `<b>Current reasoning:</b> ${enabled ? 'extended thinking enabled' : 'extended thinking disabled'}`,
          `<b>Budget:</b> <code>${budget.toLocaleString('en-US')}</code> tokens`,
          '',
          '<i>Tap a budget to enable extended thinking at that level.</i>',
        ].join('\n'),
        keyboard,
      };
    }

    const effortOptions = TELEGRAM_REASONING_EFFORTS[provider];
    if (Array.isArray(effortOptions) && effortOptions.length) {
      const currentEffort = typeof providerCfg?.reasoning_effort === 'string'
        ? providerCfg.reasoning_effort.trim()
        : '';
      const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
      for (let i = 0; i < effortOptions.length; i += 3) {
        const row = effortOptions.slice(i, i + 3).map((opt) => ({
          text: `${opt.value === currentEffort ? '✅ ' : ''}${opt.label}`,
          callback_data: `rg:eff:${provider}:${opt.key}`,
        }));
        keyboard.push(row);
      }
      keyboard.push(...footer);
      return {
        text: [
          '🧠 <b>Reasoning Controls</b>',
          '',
          `<b>Provider:</b> ${escHtml(providerLabel)} (<code>${escHtml(provider)}</code>)`,
          `<b>Model:</b> <code>${escHtml(model)}</code>`,
          `<b>Current reasoning:</b> <code>${escHtml(currentEffort || 'disabled')}</code>`,
          '',
          '<i>Pick the saved reasoning level for this provider.</i>',
        ].join('\n'),
        keyboard,
      };
    }

    return {
      text: [
        '🧠 <b>Reasoning Controls</b>',
        '',
        `<b>Provider:</b> ${escHtml(providerLabel)} (<code>${escHtml(provider)}</code>)`,
        `<b>Model:</b> <code>${escHtml(model)}</code>`,
        '<b>Current reasoning:</b> not configurable for this provider in Telegram.',
      ].join('\n'),
      keyboard: footer,
    };
  }

  private maybeQueueCreativeProgressPlaceholder(chatId: number, sessionId: string, type: string, data: any): boolean {
    const creativeMode = getCreativeMode(sessionId);
    if (!creativeMode || creativeMode === 'design') return false;

    const isToolStreamEvent =
      type === 'tool_call'
      || type === 'tool_result'
      || type === 'progress_state'
      || type === 'info'
      || type === 'orchestration';
    if (!isToolStreamEvent) return false;

    if (!this.creativeProgressStarted.has(sessionId)) {
      this.creativeProgressStarted.add(sessionId);
      this.creativeProgressLastSentAt.set(sessionId, Date.now());
      this.enqueueProgressMessage(chatId, CREATIVE_TELEGRAM_PROGRESS_MESSAGES[0]);
    }

    const shouldCountEvent =
      type === 'tool_call'
      || type === 'tool_result'
      || type === 'info'
      || type === 'progress_state'
      || type === 'orchestration';
    if (shouldCountEvent) {
      const nextStep = (this.creativeProgressCounters.get(sessionId) || 0) + 1;
      this.creativeProgressCounters.set(sessionId, nextStep);
      const now = Date.now();
      const lastSentAt = this.creativeProgressLastSentAt.get(sessionId) || 0;
      if (
        nextStep > 0
        && nextStep % CREATIVE_TELEGRAM_PROGRESS_INTERVAL === 0
        && now - lastSentAt >= CREATIVE_TELEGRAM_PROGRESS_MIN_INTERVAL_MS
      ) {
        const index = Math.floor(nextStep / CREATIVE_TELEGRAM_PROGRESS_INTERVAL) - 1;
        const message = CREATIVE_TELEGRAM_PROGRESS_MESSAGES[index % CREATIVE_TELEGRAM_PROGRESS_MESSAGES.length];
        this.creativeProgressLastSentAt.set(sessionId, now);
        this.enqueueProgressMessage(chatId, message);
      }
    }

    return true;
  }

  private async persistReasoningConfig(
    provider: string,
    patch: { reasoning_effort?: string; extended_thinking?: boolean; thinking_budget?: number },
  ): Promise<void> {
    const cm = getConfig();
    const current = cm.getConfig() as any;
    const currentLlm = current?.llm || {};
    const currentProviders = currentLlm?.providers || {};
    const nextProviderCfg = { ...(currentProviders?.[provider] || {}) };

    if (provider === 'anthropic') {
      if (Object.prototype.hasOwnProperty.call(patch, 'extended_thinking')) {
        nextProviderCfg.extended_thinking = patch.extended_thinking === true;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'thinking_budget')) {
        const budget = Number(patch.thinking_budget);
        if (Number.isFinite(budget) && budget >= 1024) {
          nextProviderCfg.thinking_budget = Math.floor(budget);
        }
      }
    } else if (Object.prototype.hasOwnProperty.call(patch, 'reasoning_effort')) {
      const effort = typeof patch.reasoning_effort === 'string' ? patch.reasoning_effort.trim() : '';
      if (effort) nextProviderCfg.reasoning_effort = effort;
      else delete nextProviderCfg.reasoning_effort;
    }

    cm.updateConfig({
      llm: {
        ...currentLlm,
        providers: {
          ...currentProviders,
          [provider]: nextProviderCfg,
        },
      },
    } as any);

    try {
      const { resetProvider } = require('../../providers/factory.js');
      if (typeof resetProvider === 'function') resetProvider();
    } catch {}
  }

  private async runTelegramMainChatTurn(params: {
    chatId: number;
    sessionId: string;
    message: string;
    sendSSE: (event: string, data: any) => void;
    callerContext?: string;
    attachments?: Array<{ base64: string; mimeType: string; name: string }>;
  }): Promise<{ aborted: boolean; result: { type: string; text: string; thinking?: string; toolResults?: any[] } }> {
    const abortSignal = { aborted: false };
    const runtimeId = registerLiveRuntime({
      kind: 'main_chat',
      label: 'Main chat',
      sessionId: params.sessionId,
      source: 'telegram',
      chatId: params.chatId,
      detail: String(params.message || '').slice(0, 160),
      abortSignal,
    });
    try {
      const result = this.deps.runInteractiveTurn
        ? await this.deps.runInteractiveTurn(
            params.message,
            params.sessionId,
            params.sendSSE,
            undefined,
            abortSignal,
            params.callerContext,
            undefined,
            params.attachments,
          )
        : await this.deps.handleChat(
            params.message,
            params.sessionId,
            params.sendSSE,
            undefined,
            abortSignal,
            params.callerContext,
            undefined,
            undefined,
            undefined,
            params.attachments,
          );
      return { aborted: abortSignal.aborted, result };
    } finally {
      finishLiveRuntime(runtimeId);
    }
  }

  private getStopKindMeta(kind: string): { icon: string; label: string } {
    switch (kind) {
      case 'main_chat':
        return { icon: '🧠', label: 'Main Chat' };
      case 'team_manager':
        return { icon: '👥', label: 'Manager' };
      case 'team_subagent':
        return { icon: '🤖', label: 'Team Subagent' };
      case 'proposal_execution':
        return { icon: '📋', label: 'Proposal' };
      case 'subagent':
        return { icon: '🤖', label: 'Subagent' };
      case 'scheduled_task':
      case 'cron':
        return { icon: '🗓️', label: 'Scheduled Task' };
      case 'heartbeat':
        return { icon: '💓', label: 'Heartbeat' };
      case 'brain_thought':
        return { icon: '🧠', label: 'Brain Thought' };
      case 'brain_dream':
        return { icon: '🌙', label: 'Brain Dream' };
      default:
        return { icon: '🧵', label: 'Background Task' };
    }
  }

  private buildStopTargetFromRuntime(runtime: LiveRuntimeSnapshot): StopTargetEntry {
    const meta = this.getStopKindMeta(runtime.kind);
    return {
      sourceType: 'runtime',
      id: runtime.id,
      kind: runtime.kind,
      label: runtime.label || meta.label,
      icon: meta.icon,
      startedAt: runtime.startedAt,
      status: runtime.abortRequestedAt ? 'abort_requested' : 'running',
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      teamId: runtime.teamId,
      agentId: runtime.agentId,
      scheduleId: runtime.scheduleId,
      detail: runtime.detail,
    };
  }

  private buildStopTargetFromTask(task: any): StopTargetEntry {
    const sessionId = String(task?.sessionId || '');
    const isProposal = sessionId.startsWith('proposal_');
    const isTeamSubagent = !!task?.teamSubagent;
    const isScheduled = !!task?.scheduleId || String(task?.taskKind || '') === 'scheduled' || sessionId.startsWith('cron_');
    const isSubagent = !isTeamSubagent && (sessionId.startsWith('subagent_') || !!task?.subagentProfile);
    const kind = isTeamSubagent
      ? 'team_subagent'
      : isProposal
        ? 'proposal_execution'
        : isScheduled
          ? 'scheduled_task'
          : isSubagent
            ? 'subagent'
            : 'background_task';
    const meta = this.getStopKindMeta(kind);
    const currentStep = Array.isArray(task?.plan) ? task.plan[task.currentStepIndex] : null;
    const label = isTeamSubagent
      ? `${meta.label} - ${task?.teamSubagent?.agentName || task?.teamSubagent?.agentId || task?.title || task?.id}`
      : `${meta.label} - ${String(task?.title || task?.id || 'Task').slice(0, 80)}`;
    return {
      sourceType: 'task',
      id: String(task?.id || ''),
      kind,
      label,
      icon: meta.icon,
      startedAt: Number(task?.startedAt || Date.now()),
      status: String(task?.status || 'running'),
      sessionId: sessionId || undefined,
      taskId: String(task?.id || ''),
      teamId: task?.teamSubagent?.teamId,
      agentId: task?.teamSubagent?.agentId || task?.subagentProfile,
      scheduleId: task?.scheduleId,
      detail: currentStep?.description || String(task?.prompt || '').slice(0, 160),
    };
  }

  private listStopTargets(): StopTargetEntry[] {
    const targets: StopTargetEntry[] = listLiveRuntimes().map((runtime) => this.buildStopTargetFromRuntime(runtime));
    try {
      const { BackgroundTaskRunner } = require('../tasks/background-task-runner.js');
      const { loadTask } = require('../tasks/task-store.js');
      for (const taskId of BackgroundTaskRunner.getRunningTasks()) {
        const task = loadTask(taskId);
        if (!task) continue;
        targets.push(this.buildStopTargetFromTask(task));
      }
    } catch (err: any) {
      console.warn('[Telegram] Could not enumerate running background tasks:', err?.message || err);
    }
    try {
      const { listBackgroundStatuses } = require('../tasks/task-runner.js');
      const knownIds = new Set(targets.map((target) => target.taskId || target.id));
      for (const bg of listBackgroundStatuses()) {
        const state = String(bg?.state || '');
        if (!['queued', 'in_progress'].includes(state)) continue;
        if (knownIds.has(String(bg.id))) continue;
        const meta = this.getStopKindMeta('background_agent');
        targets.push({
          sourceType: 'task',
          id: String(bg.id),
          kind: 'background_agent',
          label: `${meta.label} - ${String(bg.id).slice(0, 18)}`,
          icon: meta.icon,
          startedAt: Number(bg.startedAt || Date.now()),
          status: state,
          sessionId: `background_${bg.id}`,
          taskId: String(bg.id),
          detail: Array.isArray(bg.tags) && bg.tags.length ? `Tags: ${bg.tags.join(', ')}` : undefined,
        });
      }
    } catch (err: any) {
      console.warn('[Telegram] Could not enumerate ephemeral background agents:', err?.message || err);
    }
    return targets.sort((a, b) => b.startedAt - a.startedAt);
  }

  private getStopTarget(sourceType: 'runtime' | 'task', id: string): StopTargetEntry | null {
    if (sourceType === 'runtime') {
      const runtime = getLiveRuntime(id);
      return runtime ? this.buildStopTargetFromRuntime(runtime) : null;
    }
    try {
      const { loadTask } = require('../tasks/task-store.js');
      const task = loadTask(id);
      if (!task) {
        try {
          const { backgroundStatus } = require('../tasks/task-runner.js');
          const bg = backgroundStatus(id);
          if (!bg) return null;
          const meta = this.getStopKindMeta('background_agent');
          return {
            sourceType: 'task',
            id: String(bg.id),
            kind: 'background_agent',
            label: `${meta.label} - ${String(bg.id).slice(0, 18)}`,
            icon: meta.icon,
            startedAt: Number(bg.startedAt || Date.now()),
            status: String(bg.state || 'running'),
            sessionId: `background_${bg.id}`,
            taskId: String(bg.id),
            detail: Array.isArray(bg.tags) && bg.tags.length ? `Tags: ${bg.tags.join(', ')}` : undefined,
          };
        } catch {
          return null;
        }
      }
      return this.buildStopTargetFromTask(task);
    } catch {
      return null;
    }
  }

  private formatStopTargetDetail(target: StopTargetEntry): string {
    const lines = [
      `${target.icon} <b>${target.label}</b>`,
      `Type: <code>${target.kind}</code>`,
      `Status: <code>${target.status}</code>`,
      `Started: ${new Date(target.startedAt).toLocaleString()}`,
      target.sessionId ? `Session: <code>${target.sessionId}</code>` : '',
      target.taskId ? `Task: <code>${target.taskId}</code>` : '',
      target.teamId ? `Team: <code>${target.teamId}</code>` : '',
      target.agentId ? `Agent: <code>${target.agentId}</code>` : '',
      target.scheduleId ? `Schedule: <code>${target.scheduleId}</code>` : '',
      target.detail ? `\n${formatTelegramAiTextFromMarkdown(String(target.detail).slice(0, 1200))}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  private async handleStopCallback(chatId: number, messageId: number, data: string): Promise<void> {
    const edit = async (text: string, kb: any[][]) => {
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: text.slice(0, 4000),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: kb },
        });
      } catch (err: any) {
        if (!err.message?.includes('message is not modified')) {
          console.error('[STOP] edit error:', err.message);
        }
      }
    };

    if (data === 'stop:list') {
      const targets = this.listStopTargets();
      if (targets.length === 0) {
        await edit('🛑 No live AI flows are running right now.', []);
        return;
      }
      const rows = targets.slice(0, 30).map((target) => [{
        text: `${target.icon} ${target.label.slice(0, 34)}`,
        callback_data: `stop:view:${target.sourceType === 'runtime' ? 'r' : 't'}:${idKey(target.id)}`,
      }]);
      await edit(`🛑 <b>Live AI Flows (${targets.length})</b>\nTap one to inspect it, then use Abort if needed.`, rows);
      return;
    }

    if (data.startsWith('stop:view:')) {
      const parts = data.split(':');
      const sourceType = parts[2] === 'r' ? 'runtime' : 'task';
      const resolvedId = idResolve(parts[3] || '');
      if (!resolvedId) {
        await edit('❌ Session expired. Use /stop again.', [[{ text: '⬅️ Back', callback_data: 'stop:list' }]]);
        return;
      }
      const target = this.getStopTarget(sourceType, resolvedId);
      if (!target) {
        await edit('❌ That flow is no longer running.', [[{ text: '⬅️ Back', callback_data: 'stop:list' }]]);
        return;
      }
      await edit(this.formatStopTargetDetail(target), [
        [{ text: '🛑 Abort', callback_data: `stop:abort:${parts[2]}:${idKey(target.id)}` }],
        [{ text: '⬅️ Back', callback_data: 'stop:list' }],
      ]);
      return;
    }

    if (data.startsWith('stop:abort:')) {
      const parts = data.split(':');
      const sourceType = parts[2] === 'r' ? 'runtime' : 'task';
      const resolvedId = idResolve(parts[3] || '');
      if (!resolvedId) {
        await edit('❌ Session expired. Use /stop again.', [[{ text: '⬅️ Back', callback_data: 'stop:list' }]]);
        return;
      }
      if (sourceType === 'runtime') {
        const result = abortLiveRuntime(resolvedId);
        await edit(
          result.ok ? '🛑 Abort requested.' : `❌ ${result.error || 'Abort failed.'}`,
          [[{ text: '⬅️ Back', callback_data: 'stop:list' }]],
        );
        return;
      }

      try {
        const target = this.getStopTarget('task', resolvedId);
        if (target?.kind === 'background_agent' || String(resolvedId).startsWith('bg_')) {
          const { backgroundAbort } = require('../tasks/task-runner.js');
          const result = backgroundAbort(resolvedId);
          await edit(
            result.ok ? '🛑 Background agent abort requested.' : `❌ ${result.error || 'Abort failed.'}`,
            [[{ text: '⬅️ Back', callback_data: 'stop:list' }]],
          );
          return;
        }
        const { BackgroundTaskRunner } = require('../tasks/background-task-runner.js');
        const { loadTask, updateTaskStatus, appendJournal } = require('../tasks/task-store.js');
        const task = loadTask(resolvedId);
        if (!task) {
          await edit('❌ Task not found.', [[{ text: '⬅️ Back', callback_data: 'stop:list' }]]);
          return;
        }
        BackgroundTaskRunner.requestPause(resolvedId);
        updateTaskStatus(resolvedId, 'paused', { pauseReason: 'user_pause' });
        appendJournal(resolvedId, { type: 'pause', content: 'Paused via Telegram /stop. Context was preserved for resume.' });
        await edit('🛑 Task pause requested. Context is preserved for resume.', [[{ text: '⬅️ Back', callback_data: 'stop:list' }]]);
      } catch (err: any) {
        await edit(`❌ ${String(err?.message || err)}`, [[{ text: '⬅️ Back', callback_data: 'stop:list' }]]);
      }
    }
  }

  private formatResumeTime(ts: number): string {
    const value = Number(ts || 0);
    if (!Number.isFinite(value) || value <= 0) return 'Unknown';
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private clampResumeOffset(offset: number, total: number): number {
    if (total <= 0) return 0;
    const raw = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
    if (raw >= total) return Math.max(0, Math.floor((total - 1) / RESUME_PAGE_SIZE) * RESUME_PAGE_SIZE);
    return raw;
  }

  private shortenResumeText(value: string, maxLen: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '(empty)';
    return text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...` : text;
  }

  private getResumeSessionTitle(session: Session): string {
    const firstUser = session.history?.find((msg) => msg.role === 'user' && String(msg.content || '').trim());
    const fallback = session.history?.find((msg) => String(msg.content || '').trim());
    const base = firstUser?.content || fallback?.content || session.id;
    return this.shortenResumeText(base, 60);
  }

  private getResumeSessionFirstMessage(session: Session): string {
    const firstMessage = session.history?.find((msg) => String(msg.content || '').trim());
    return this.shortenResumeText(firstMessage?.content || '', 140);
  }

  private getResumeSessionChannel(session: Session): ResumeChannelKey | null {
    const hint = getSessionChannelHint(session.id);
    if (hint?.channel === 'telegram' || hint?.channel === 'discord' || hint?.channel === 'whatsapp' || hint?.channel === 'terminal') {
      return hint.channel;
    }
    if (session.channel === 'telegram' || session.id.startsWith('telegram_')) return 'telegram';
    if (session.channel === 'terminal' || session.id.startsWith('cli_') || session.id.startsWith('terminal_')) return 'terminal';
    if (session.id.startsWith('discord_')) return 'discord';
    if (session.id.startsWith('whatsapp_')) return 'whatsapp';

    const messageChannel = session.history
      ?.map((msg) => String(msg.channel || '').toLowerCase())
      .find((ch) => ch === 'telegram' || ch === 'discord' || ch === 'whatsapp' || ch === 'terminal');
    if (messageChannel === 'telegram' || messageChannel === 'discord' || messageChannel === 'whatsapp' || messageChannel === 'terminal') {
      return messageChannel;
    }
    return null;
  }

  private isResumeSessionVisibleToUser(session: Session, userId: number): boolean {
    const channelKey = this.getResumeSessionChannel(session);
    if (channelKey !== 'telegram') return true;

    const idMatch = String(session.id || '').match(/^telegram_(\d+)(?:_|$)/);
    if (idMatch) {
      return Number(idMatch[1]) === userId;
    }

    const hint = getSessionChannelHint(session.id);
    if (hint?.channel === 'telegram' && Number.isFinite(Number(hint.userId))) {
      return Number(hint.userId) === userId;
    }

    return true;
  }

  // Only surface user-facing chats here; background/system sessions create too much noise.
  private isResumeCandidateSession(session: Session, userId: number): boolean {
    const sessionId = String(session.id || '').trim();
    if (!sessionId) return false;
    if (!Array.isArray(session.history) || session.history.length === 0) return false;
    if (!session.history.some((msg) => msg.role === 'user' && String(msg.content || '').trim())) return false;
    if (!this.isResumeSessionVisibleToUser(session, userId)) return false;

    const lowerId = sessionId.toLowerCase();
    if (session.channel === 'system') return false;
    if (lowerId === 'default' || lowerId === 'boot-startup' || lowerId === 'telegram-bootstrap') return false;
    if (
      lowerId.startsWith('task_')
      || lowerId.startsWith('cron_')
      || lowerId.startsWith('auto_')
      || lowerId.startsWith('background_')
      || lowerId.startsWith('webhook_')
      || lowerId.startsWith('brain_')
      || lowerId.startsWith('startup_')
      || lowerId.startsWith('subagent_')
    ) {
      return false;
    }
    return true;
  }

  private buildResumeProjectLookup(): Map<string, { projectId: string; projectName: string }> {
    const projectMap = new Map<string, { projectId: string; projectName: string }>();
    for (const project of listProjects()) {
      for (const entry of project.sessions || []) {
        const sessionId = String(entry?.id || '').trim();
        if (!sessionId) continue;
        projectMap.set(sessionId, { projectId: project.id, projectName: project.name });
      }
    }
    return projectMap;
  }

  private buildResumeSessionSummary(
    session: Session,
    linkedSessionId: string | null,
    projectInfo?: { projectId: string; projectName: string } | null,
  ): ResumeSessionSummary {
    return {
      sessionId: session.id,
      title: this.getResumeSessionTitle(session),
      firstMessage: this.getResumeSessionFirstMessage(session),
      messageCount: Array.isArray(session.history) ? session.history.length : 0,
      lastActiveAt: Number(session.lastActiveAt || session.createdAt || Date.now()),
      createdAt: Number(session.createdAt || session.lastActiveAt || Date.now()),
      projectId: projectInfo?.projectId || null,
      projectName: projectInfo?.projectName || null,
      channelKey: this.getResumeSessionChannel(session),
      isLinked: linkedSessionId === session.id,
    };
  }

  private listResumeSessions(userId: number): ResumeSessionSummary[] {
    const sessionsDir = path.join(getConfig().getConfigDir(), 'sessions');
    if (!fs.existsSync(sessionsDir)) return [];

    const linkedSessionId = getLinkedSession(userId);
    const projectLookup = this.buildResumeProjectLookup();
    const summaries: ResumeSessionSummary[] = [];
    const files = fs.readdirSync(sessionsDir).filter((file) => file.endsWith('.json'));

    for (const file of files) {
      const sessionId = file.slice(0, -5);
      try {
        const session = getSession(sessionId);
        if (!this.isResumeCandidateSession(session, userId)) continue;
        summaries.push(this.buildResumeSessionSummary(session, linkedSessionId, projectLookup.get(sessionId) || null));
      } catch {
        // Skip unreadable sessions.
      }
    }

    return summaries.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  private listResumeSessionsByChannel(channelKey: ResumeChannelKey, userId: number): ResumeSessionSummary[] {
    return this.listResumeSessions(userId).filter((session) => session.channelKey === channelKey);
  }

  private listResumeProjectSessions(project: Project, userId: number): ResumeSessionSummary[] {
    const linkedSessionId = getLinkedSession(userId);
    const sessions: ResumeSessionSummary[] = [];

    for (const entry of project.sessions || []) {
      const sessionId = String(entry?.id || '').trim();
      if (!sessionId || !sessionExists(sessionId)) continue;
      try {
        const session = getSession(sessionId);
        if (!this.isResumeCandidateSession(session, userId)) continue;
        sessions.push(this.buildResumeSessionSummary(session, linkedSessionId, { projectId: project.id, projectName: project.name }));
      } catch {
        // Ignore corrupt or missing project session records.
      }
    }

    return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  private listResumeProjects(userId: number): ResumeProjectSummary[] {
    return listProjects()
      .map((project) => {
        const sessions = this.listResumeProjectSessions(project, userId);
        return {
          id: project.id,
          name: project.name,
          sessionCount: sessions.length,
          updatedAt: Math.max(project.updatedAt || 0, sessions[0]?.lastActiveAt || 0),
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private buildResumeRootPayload(userId: number): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
    const sessions = this.listResumeSessions(userId);
    const projects = this.listResumeProjects(userId);
    const counts = RESUME_CHANNEL_DEFS.map((def) => {
      const count = sessions.filter((session) => session.channelKey === def.key).length;
      return `${def.icon} ${def.label}: ${count}`;
    });
    const linkedSessionId = getLinkedSession(userId);
    let linkedLine = '';
    if (linkedSessionId && sessionExists(linkedSessionId)) {
      try {
        linkedLine = `Current Telegram link: <b>${this.tgEscape(this.getResumeSessionTitle(getSession(linkedSessionId)))}</b>`;
      } catch {
        linkedLine = `Current Telegram link: <code>${this.tgEscape(linkedSessionId)}</code>`;
      }
    }

    const text = [
      '🔁 <b>Resume a Conversation</b>',
      '',
      linkedLine,
      `Chats: <code>${sessions.length}</code>`,
      `Projects: <code>${projects.length}</code>`,
      counts.join('  •  '),
      '',
      'Choose how you want to browse old conversations:',
    ].filter(Boolean).join('\n');

    return {
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💬 Chats', callback_data: 'rsm:list:all:0' },
            { text: '📡 Channels', callback_data: 'rsm:channels' },
          ],
          [
            { text: '🗂 Projects', callback_data: 'rsm:projects:0' },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ],
        ],
      },
    };
  }

  private buildResumeChannelsPayload(userId: number): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
    const sessions = this.listResumeSessions(userId);
    const counts = new Map<ResumeChannelKey, number>();
    for (const def of RESUME_CHANNEL_DEFS) counts.set(def.key, 0);
    for (const session of sessions) {
      if (session.channelKey) counts.set(session.channelKey, (counts.get(session.channelKey) || 0) + 1);
    }

    const lines = RESUME_CHANNEL_DEFS.map((def) => {
      const count = counts.get(def.key) || 0;
      return `${def.icon} <b>${def.label}</b> — ${count > 0 ? `${count} chat${count === 1 ? '' : 's'}` : def.emptyLabel}`;
    });

    return {
      text: [
        '📡 <b>Resume by Channel</b>',
        '',
        'Pick one of the four channel buckets, then choose a chat to preview:',
        '',
        ...lines,
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: `💬 Telegram (${counts.get('telegram') || 0})`, callback_data: 'rsm:list:ch:telegram:0' },
            { text: `🎮 Discord (${counts.get('discord') || 0})`, callback_data: 'rsm:list:ch:discord:0' },
          ],
          [
            { text: `🟢 WhatsApp (${counts.get('whatsapp') || 0})`, callback_data: 'rsm:list:ch:whatsapp:0' },
            { text: `🖥️ CLI (${counts.get('terminal') || 0})`, callback_data: 'rsm:list:ch:terminal:0' },
          ],
          [
            { text: '⬅️ Back', callback_data: 'rsm:menu' },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ],
        ],
      },
    };
  }

  private buildResumeSessionListPayload(params: {
    header: string;
    emptyText: string;
    sessions: ResumeSessionSummary[];
    offset: number;
    backCallback: string;
    pageCallback: (offset: number) => string;
    detailCallback: (sessionKey: string) => string;
  }): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
    const total = params.sessions.length;
    const safeOffset = this.clampResumeOffset(params.offset, total);
    const pageSessions = params.sessions.slice(safeOffset, safeOffset + RESUME_PAGE_SIZE);

    if (pageSessions.length === 0) {
      return {
        text: `${params.header}\n\n${params.emptyText}`,
        reply_markup: {
          inline_keyboard: [[
            { text: '⬅️ Back', callback_data: params.backCallback },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ]],
        },
      };
    }

    const lines = [
      params.header,
      '',
      `Showing <code>${safeOffset + 1}-${safeOffset + pageSessions.length}</code> of <code>${total}</code>.`,
      '',
    ];

    pageSessions.forEach((session, index) => {
      const channelLabel = RESUME_CHANNEL_DEFS.find((def) => def.key === session.channelKey)?.label || 'Web';
      const tags = [
        `${session.messageCount} msgs`,
        this.formatResumeTime(session.lastActiveAt),
        channelLabel,
        session.projectName ? `Project: ${session.projectName}` : '',
        session.isLinked ? 'Currently linked' : '',
      ].filter(Boolean);

      lines.push(
        `<b>${safeOffset + index + 1}. ${this.tgEscape(session.title)}</b>${session.isLinked ? ' 🔗' : ''}`,
        `First message: ${this.tgEscape(session.firstMessage)}`,
        `<i>${this.tgEscape(tags.join(' • '))}</i>`,
        '',
      );
    });

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = pageSessions.map((session, index) => [{
      text: `${safeOffset + index + 1}. ${session.isLinked ? '🔗 ' : ''}${this.shortenResumeText(session.title, 28)}`,
      callback_data: params.detailCallback(idKey(session.sessionId)),
    }]);

    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (safeOffset > 0) navRow.push({ text: '◀️ Newer', callback_data: params.pageCallback(Math.max(0, safeOffset - RESUME_PAGE_SIZE)) });
    if (safeOffset + pageSessions.length < total) navRow.push({ text: 'Show More ▶️', callback_data: params.pageCallback(safeOffset + RESUME_PAGE_SIZE) });
    if (navRow.length > 0) keyboard.push(navRow);
    keyboard.push([
      { text: '⬅️ Back', callback_data: params.backCallback },
      { text: '❌ Cancel', callback_data: 'rsm:cancel' },
    ]);

    return {
      text: lines.join('\n').trim(),
      reply_markup: { inline_keyboard: keyboard },
    };
  }

  private buildResumeProjectsPayload(userId: number, offset: number): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
    const projects = this.listResumeProjects(userId);
    const total = projects.length;
    const safeOffset = this.clampResumeOffset(offset, total);
    const pageProjects = projects.slice(safeOffset, safeOffset + RESUME_PAGE_SIZE);

    if (pageProjects.length === 0) {
      return {
        text: '🗂 <b>Projects</b>\n\nNo projects found.',
        reply_markup: { inline_keyboard: [[
          { text: '⬅️ Back', callback_data: 'rsm:menu' },
          { text: '❌ Cancel', callback_data: 'rsm:cancel' },
        ]] },
      };
    }

    const lines = [
      '🗂 <b>Projects</b>',
      '',
      `Showing <code>${safeOffset + 1}-${safeOffset + pageProjects.length}</code> of <code>${total}</code>.`,
      '',
    ];

    pageProjects.forEach((project, index) => {
      lines.push(
        `<b>${safeOffset + index + 1}. ${this.tgEscape(this.shortenResumeText(project.name, 52))}</b>`,
        `<i>${project.sessionCount} project chat${project.sessionCount === 1 ? '' : 's'} • ${this.tgEscape(this.formatResumeTime(project.updatedAt))}</i>`,
        '',
      );
    });

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = pageProjects.map((project, index) => [{
      text: `${safeOffset + index + 1}. ${this.shortenResumeText(project.name, 28)}`,
      callback_data: `rsm:list:pr:${idKey(project.id)}:0`,
    }]);

    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (safeOffset > 0) navRow.push({ text: '◀️ Newer', callback_data: `rsm:projects:${Math.max(0, safeOffset - RESUME_PAGE_SIZE)}` });
    if (safeOffset + pageProjects.length < total) navRow.push({ text: 'Show More ▶️', callback_data: `rsm:projects:${safeOffset + RESUME_PAGE_SIZE}` });
    if (navRow.length > 0) keyboard.push(navRow);
    keyboard.push([
      { text: '⬅️ Back', callback_data: 'rsm:menu' },
      { text: '❌ Cancel', callback_data: 'rsm:cancel' },
    ]);

    return {
      text: lines.join('\n').trim(),
      reply_markup: { inline_keyboard: keyboard },
    };
  }

  private buildResumeProjectSessionsPayload(projectId: string, userId: number, offset: number): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
    const project = getProject(projectId);
    if (!project) {
      return {
        text: '❌ Project not found.',
        reply_markup: { inline_keyboard: [[
          { text: '⬅️ Projects', callback_data: 'rsm:projects:0' },
          { text: '❌ Cancel', callback_data: 'rsm:cancel' },
        ]] },
      };
    }

    return this.buildResumeSessionListPayload({
      header: `🗂 <b>${this.tgEscape(this.shortenResumeText(project.name, 72))}</b>\nProject chats`,
      emptyText: 'No chats in this project yet.',
      sessions: this.listResumeProjectSessions(project, userId),
      offset,
      backCallback: 'rsm:projects:0',
      pageCallback: (nextOffset) => `rsm:list:pr:${idKey(project.id)}:${nextOffset}`,
      detailCallback: (sessionKey) => `rsm:view:${sessionKey}:pr:${idKey(project.id)}:${offset}`,
    });
  }

  private buildResumeRecentMessages(session: Session): string {
    const recent = (session.history || [])
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .slice(-6);
    if (recent.length === 0) return '<i>No recent messages stored for this chat.</i>';

    return recent.map((msg) => {
      const speaker = msg.role === 'user' ? 'You' : 'Prometheus';
      return `<b>${speaker}:</b> ${this.tgEscape(this.shortenResumeText(String(msg.content || ''), 240))}`;
    }).join('\n\n');
  }

  private buildResumeSessionDetailPayload(
    sessionId: string,
    userId: number,
    backCallback: string,
  ): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
    if (!sessionExists(sessionId)) {
      return {
        text: '❌ Chat session not found.',
        reply_markup: { inline_keyboard: [[
          { text: '⬅️ Back', callback_data: backCallback },
          { text: '❌ Cancel', callback_data: 'rsm:cancel' },
        ]] },
      };
    }

    const projectLookup = this.buildResumeProjectLookup();
    const session = getSession(sessionId);
    if (!this.isResumeCandidateSession(session, userId)) {
      return {
        text: '❌ This chat is not available to resume from Telegram.',
        reply_markup: { inline_keyboard: [[
          { text: '⬅️ Back', callback_data: backCallback },
          { text: '❌ Cancel', callback_data: 'rsm:cancel' },
        ]] },
      };
    }

    const summary = this.buildResumeSessionSummary(session, getLinkedSession(userId), projectLookup.get(sessionId) || null);
    const channelLabel = RESUME_CHANNEL_DEFS.find((def) => def.key === summary.channelKey)?.label || 'Web';

    return {
      text: [
        '🔁 <b>Resume Chat</b>',
        '',
        `<b>${this.tgEscape(summary.title)}</b>${summary.isLinked ? ' 🔗' : ''}`,
        `<code>${this.tgEscape(summary.sessionId)}</code>`,
        '',
        `<b>First message:</b> ${this.tgEscape(summary.firstMessage)}`,
        `<b>Messages:</b> <code>${summary.messageCount}</code>`,
        `<b>Last active:</b> ${this.tgEscape(this.formatResumeTime(summary.lastActiveAt))}`,
        `<b>Channel:</b> ${this.tgEscape(channelLabel)}`,
        summary.projectName ? `<b>Project:</b> ${this.tgEscape(summary.projectName)}` : '',
        '',
        '<b>Recent messages</b>',
        this.buildResumeRecentMessages(session),
      ].filter(Boolean).join('\n'),
      reply_markup: {
        inline_keyboard: [
          [{ text: '▶️ Resume', callback_data: `rsm:link:${idKey(summary.sessionId)}` }],
          [
            { text: '⬅️ Back', callback_data: backCallback },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ],
        ],
      },
    };
  }

  /** Inject team management deps after boot (called from server-v2) */
  setTeamDeps(deps: TeamDeps & { spawnAgent?: (p: { agentId: string; task: string }) => Promise<any> }): void {
    this.teamDeps = deps;
    if (deps.spawnAgent) this.spawnAgentFn = deps.spawnAgent;
  }

  constructor(config: TelegramConfig, deps: TelegramDeps) {
    this.config = config;
    this.deps = deps;
  }

  // ─── Bot API Helpers ─────────────────────────────────────────────────────────

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.config.botToken}`;
  }

  private async apiCall(method: string, body?: object): Promise<any> {
    const resp = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data: any = await resp.json();
    if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description || 'unknown error'}`);
    return data.result;
  }

  // ─── Public Methods ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) {
      console.log('[Telegram] Disabled or no bot token — skipping');
      return;
    }

    // Resolve workspace root at start time from config
    try {
      const cfg = getConfig().getConfig() as any;
      const ws = cfg?.workspace?.path;
      if (ws && fs.existsSync(ws)) this.workspaceRoot = ws;
    } catch {
      // fall back to cwd
    }

    try {
      this.botInfo = await this.apiCall('getMe');
      console.log(`[Telegram] Connected as @${this.botInfo!.username} (${this.botInfo!.first_name})`);
    } catch (err: any) {
      console.error(`[Telegram] Failed to connect: ${err.message}`);
      return;
    }

    // Register commands in Telegram's command menu
    try {
      await this.apiCall('setMyCommands', {
	        commands: [
	          { command: 'status',       description: 'Check connection and model status' },
	          { command: 'new',          description: 'Start a new chat session' },
		          { command: 'resume',       description: 'Resume an older conversation' },
		          { command: 'clear',        description: 'Reset chat history' },
		          { command: 'stop_now',     description: 'Abort the current main chat turn' },
		          { command: 'stop',         description: 'Inspect and abort live AI flows' },
		          { command: 'browse',       description: 'Browse workspace files' },
	          { command: 'teams',        description: 'View and manage agent teams' },
          { command: 'agents',       description: 'Browse and dispatch agents' },
	          { command: 'tasks',        description: 'List background tasks' },
	          { command: 'schedule',     description: 'Manage scheduled jobs' },
	          { command: 'models',       description: 'Switch provider / model' },
	          { command: 'reasoning',    description: 'Adjust current provider reasoning' },
	          { command: 'screenshot',   description: 'Take a browser or desktop screenshot' },
	          { command: 'download',     description: 'Download a workspace file' },
          { command: 'proposals',    description: 'List pending code proposals' },
          { command: 'repairs',      description: 'List self-repair items' },
          { command: 'integrations', description: 'Show configured integrations' },
          { command: 'mcp_status',   description: 'Show MCP server status' },
          { command: 'setup',        description: 'Connect a service (github, slack, …)' },
          { command: 'restart',      description: 'Restart the gateway' },
          { command: 'update',       description: 'Check and apply updates' },
          { command: 'commands',     description: 'Full command catalog' },
        ],
      });
      console.log('[Telegram] Commands registered in Telegram menu');
    } catch (err: any) {
      console.warn(`[Telegram] setMyCommands failed (non-fatal): ${err.message}`);
    }

    this.polling = true;
    this.pollLoop();
  }

  stop(): void {
    this.polling = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    console.log('[Telegram] Polling stopped');
  }

  updateConfig(newConfig: Partial<TelegramConfig>): void {
    const wasEnabled = this.config.enabled;
    const oldToken = this.config.botToken;
    this.config = { ...this.config, ...newConfig };

    const tokenChanged = newConfig.botToken && newConfig.botToken !== oldToken;

    if (wasEnabled && !this.config.enabled) {
      this.stop();
    } else if (!wasEnabled && this.config.enabled) {
      this.start();
    } else if (wasEnabled && this.config.enabled && tokenChanged) {
      // Token changed while running — reconnect with new bot
      this.stop();
      this.botInfo = null;
      this.start();
    }
  }

  getStatus(): { connected: boolean; username: string | null; polling: boolean } {
    return {
      connected: this.botInfo !== null,
      username: this.botInfo?.username || null,
      polling: this.polling,
    };
  }

  /** Return the list of allowed Telegram user IDs (for session bridge linking). */
  getAllowedUserIds(): number[] {
    return this.config.allowedUserIds || [];
  }

  /** Send a message to all allowed users (for cron/heartbeat delivery) */
  async sendToAllowed(text: string): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) return;
    try {
      for (const userId of this.config.allowedUserIds) {
        try {
          await this.sendMessage(userId, text);
        } catch (err: any) {
          console.error(`[Telegram] Failed to send to ${userId}: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`[Telegram] sendToAllowed no-op guard: ${String(err?.message || err)}`);
    }
  }

  /** Send a photo (Buffer or base64 string) to all allowed users. */
  async sendPhotoToAllowed(imageData: Buffer | string, caption: string = ''): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) return;
    const buf = typeof imageData === 'string'
      ? Buffer.from(imageData, 'base64')
      : imageData;
    for (const userId of this.config.allowedUserIds) {
      try {
        const form = new FormData();
        form.append('chat_id', String(userId));
        form.append('photo', new Blob([buf], { type: 'image/png' }), 'screenshot.png');
        if (caption) {
          form.append('caption', caption.slice(0, 1024));
          form.append('parse_mode', 'HTML');
        }
        const resp = await fetch(`${this.apiBase}/sendPhoto`, { method: 'POST', body: form });
        const data: any = await resp.json();
        if (!data.ok) {
          console.error(`[Telegram] sendPhotoToAllowed failed for ${userId}: ${JSON.stringify(data)}`);
        }
      } catch (err: any) {
        console.error(`[Telegram] sendPhotoToAllowed error for ${userId}: ${err?.message}`);
      }
    }
  }

  /** Send a single message */
  async sendMessage(chatId: number, text: string, messageThreadId?: number): Promise<void> {
    const outbound = stripInternalToolNotes(text) || String(text || '').trim();
    if (!outbound) return;
    // Telegram messages max 4096 chars — split if needed
    const chunks = this.splitMessage(outbound, 4000);
    for (const chunk of chunks) {
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: chunk,
        message_thread_id: messageThreadId || undefined,
        parse_mode: 'HTML',
      }).catch(async () => {
        // HTML parse failed — strip tags and retry as plain text
        const plain = chunk
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        return this.apiCall('sendMessage', { chat_id: chatId, text: plain, message_thread_id: messageThreadId || undefined }).catch((err: any) => {
          console.error(`[Telegram] sendMessage failed even as plain text: ${err?.message}`);
        });
      });
    }
  }

  private tgEscape(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private getProposalStatusEmoji(status: string): string {
    const statusEmoji: Record<string, string> = {
      pending: '⏳',
      approved: '✅',
      executing: '🔄',
      repairing: '🛠️',
      executed: '🎉',
      failed: '❌',
      denied: '🚫',
      expired: '⏰',
    };
    return statusEmoji[status] || '❓';
  }

  private formatProposalSummaryCard(proposal: any): string {
    const emoji = this.getProposalStatusEmoji(String(proposal?.status || ''));
    const affectedFiles = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles : [];
    const files = affectedFiles.length
      ? `\n\n<b>Affected Files (${affectedFiles.length}):</b>\n${affectedFiles.slice(0, 8).map((f: any) => `  • ${this.tgEscape(f?.path || '?')} (${this.tgEscape(f?.action || 'touch')})`).join('\n')}${affectedFiles.length > 8 ? '\n  • ...' : ''}`
      : '';
    return [
      `${emoji} <b>${this.tgEscape(proposal?.title || 'Untitled proposal')}</b>`,
      ``,
      `<b>ID:</b> <code>${this.tgEscape(proposal?.id || '')}</code>`,
      `<b>Status:</b> ${this.tgEscape(proposal?.status || 'unknown')}`,
      `<b>Priority:</b> ${this.tgEscape(proposal?.priority || 'medium')}`,
      `<b>Type:</b> ${this.tgEscape(proposal?.type || 'general')}`,
      proposal?.sourceAgentId ? `<b>Source:</b> ${this.tgEscape(proposal.sourceAgentId)}` : '',
      ``,
      `<b>Summary:</b>`,
      this.tgEscape(proposal?.summary || '(no summary)'),
      files,
    ].filter(Boolean).join('\n');
  }

  private formatProposalFullDetails(proposal: any): string {
    const affectedFiles = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles : [];
    const steps = Array.isArray(proposal?.executionSteps) ? proposal.executionSteps : [];
    const stepBlock = steps.length
      ? `\n\n<b>Execution Plan:</b>\n${steps.map((step: any, index: number) => {
          const title = this.tgEscape(step?.title || step?.description || `Step ${index + 1}`);
          const kind = step?.kind ? ` [${this.tgEscape(step.kind)}]` : '';
          const desc = step?.description ? `\n   ${this.tgEscape(step.description)}` : '';
          const success = step?.successCriteria ? `\n   Success: ${this.tgEscape(step.successCriteria)}` : '';
          return `${index + 1}. ${title}${kind}${desc}${success}`;
        }).join('\n')}`
      : '';
    const fileBlock = affectedFiles.length
      ? `\n\n<b>Affected Files:</b>\n${affectedFiles.map((f: any) => `  • ${this.tgEscape(f?.path || '?')} (${this.tgEscape(f?.action || 'touch')})${f?.description ? ` - ${this.tgEscape(f.description)}` : ''}`).join('\n')}`
      : '';
    const diffBlock = proposal?.diffPreview
      ? `\n\n<b>Diff Preview:</b>\n${this.tgEscape(proposal.diffPreview)}`
      : '';
    const executorBlock = proposal?.executorPrompt
      ? `\n\n<b>Executor Prompt:</b>\n${this.tgEscape(proposal.executorPrompt)}`
      : '';
    const impactBlock = proposal?.estimatedImpact
      ? `\n\n<b>Estimated Impact:</b>\n${this.tgEscape(proposal.estimatedImpact)}`
      : '';

    return [
      `📖 <b>Proposal Details</b>`,
      `<code>${this.tgEscape(proposal?.id || '')}</code> - ${this.tgEscape(proposal?.title || 'Untitled proposal')}`,
      ``,
      `<b>Details:</b>`,
      this.tgEscape(proposal?.details || '(no details)'),
      stepBlock,
      fileBlock,
      impactBlock,
      diffBlock,
      executorBlock,
    ].filter(Boolean).join('\n');
  }

  private buildProposalKeyboard(proposal: any, backTarget: 'pending' | 'done' = 'pending', includeDetails = true): any[][] {
    const kb: any[][] = [];
    if (includeDetails) {
      kb.push([{ text: '📖 View Details', callback_data: `pr:full:${proposal.id}` }]);
    }
    if (proposal.status === 'pending') {
      kb.push([{ text: '✅ Approve', callback_data: `pr:ap:${proposal.id}` }, { text: '❌ Reject', callback_data: `pr:rj:${proposal.id}` }]);
    }
    kb.push([{ text: '📋 Back to list', callback_data: `pr:list:${backTarget}` }]);
    return kb;
  }

  private getCommandApprovalOrigin(record: {
    sessionId?: string;
    taskId?: string;
    agentId?: string;
    originLabel?: string;
    originType?: string;
    toolArgs?: Record<string, any>;
  }): string {
    const explicit = String(record.originLabel || '').trim();
    if (explicit) return explicit;

    const sid = String(record.sessionId || '').trim();
    const taskId = String(record.taskId || '').trim();
    let task: any = null;
    if (taskId || sid.startsWith('task_')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { loadTask } = require('../tasks/task-store');
        task = loadTask(taskId || sid.replace(/^task_/, ''));
      } catch {}
    }

    if (sid.startsWith('proposal_') || sid.startsWith('code_exec') || String(task?.sessionId || '').startsWith('proposal_')) {
      return 'Proposal';
    }
    if (sid.startsWith('cron_job_') || sid.startsWith('schedule_') || task?.taskKind === 'scheduled' || task?.scheduleId) {
      const title = String(task?.title || task?.scheduleId || '').trim();
      return title ? `Scheduled Task (${title})` : 'Scheduled Task';
    }
    const teamAgentName = String(task?.teamSubagent?.agentName || task?.teamSubagent?.agentId || '').trim();
    const subagentName = teamAgentName || String(task?.subagentProfile || record.agentId || record.toolArgs?.agent_id || '').trim();
    if (sid.startsWith('team_dispatch_') || sid.startsWith('subagent_') || task?.teamSubagent || task?.subagentProfile || task?.parentTaskId) {
      return subagentName ? `Subagent (${subagentName})` : 'Subagent';
    }
    if (sid.startsWith('task_') || sid.startsWith('bg_') || sid.startsWith('background_') || task?.taskKind === 'run_once') {
      const title = String(task?.title || '').trim();
      return title ? `Background Task (${title})` : 'Background Task';
    }
    if (sid === 'default' || sid.startsWith('telegram_') || sid.startsWith('chat_') || sid) return 'Main Chat';
    return 'Unknown';
  }

  async sendCommandApproval(record: {
	    id: string;
	    action?: string;
	    toolName?: string;
	    toolArgs?: Record<string, any>;
	    reason?: string;
	    riskScore?: number;
	    sessionId?: string;
	    taskId?: string;
	    agentId?: string;
	    originLabel?: string;
	    originType?: string;
	    affectedSystems?: string[];
	    status?: string;
	  }): Promise<void> {
	    if (!this.config.enabled || !this.config.botToken) return;
	    const command = String(record.toolArgs?.command || '');
	    const systems = Array.isArray(record.affectedSystems) && record.affectedSystems.length
	      ? record.affectedSystems.join(', ')
	      : 'shell';
    const body = [
      `⏳ <b>Command Approval Required</b>`,
      ``,
	      `<b>ID:</b> <code>${this.tgEscape(record.id)}</code>`,
	      `<b>Status:</b> ${this.tgEscape(record.status || 'pending')}`,
	      `<b>Origin:</b> ${this.tgEscape(this.getCommandApprovalOrigin(record))}`,
	      `<b>Risk:</b> ${Number(record.riskScore || 0)}/10`,
	      `<b>Session:</b> <code>${this.tgEscape(record.sessionId || 'unknown')}</code>`,
	      `<b>Systems:</b> ${this.tgEscape(systems)}`,
	      ``,
	      `<b>Reason:</b> ${this.tgEscape(record.reason || record.action || 'User approval required.')}`,
	      `<b>Command:</b>`,
	      `<code>${this.tgEscape(command.slice(0, 700))}</code>`,
	    ].join('\n');
    const replyMarkup = {
      inline_keyboard: [[
        { text: '✅ Approve Once', callback_data: `ca:ap:${record.id}` },
        { text: '❌ Reject', callback_data: `ca:rj:${record.id}` },
      ], [
        { text: 'This Session', callback_data: `ca:session:${record.id}` },
        { text: 'Always Allow', callback_data: `ca:always:${record.id}` },
      ], [
        { text: '📋 Pending', callback_data: 'ca:list:pending' },
      ]],
    };
    for (const userId of this.config.allowedUserIds) {
      await this.apiCall('sendMessage', {
        chat_id: userId,
        text: body.slice(0, 4000),
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }).catch((err: any) => {
        console.error(`[Telegram] Failed to send command approval ${record.id} to ${userId}: ${err?.message}`);
      });
    }
  }

  private enqueueProgressMessage(chatId: number, text: string): void {
    const previous = this.progressMessageQueues.get(chatId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.sendMessage(chatId, text));
    this.progressMessageQueues.set(chatId, next);
    next.finally(() => {
      const current = this.progressMessageQueues.get(chatId);
      if (current === next) this.progressMessageQueues.delete(chatId);
    }).catch(() => undefined);
  }

  private async sendAiMessage(chatId: number, text: string): Promise<void> {
    const formatted = formatTelegramAiTextFromMarkdown(text);
    await this.sendMessage(chatId, formatted || text);
  }

  /** Send a team change proposal with inline approve/reject actions */
  async sendTeamChangeProposal(chatId: number, payload: {
    teamId: string;
    teamName: string;
    changeId: string;
    description: string;
    riskLevel?: string;
  }): Promise<void> {
    const token = tmChangeKey(payload.teamId, payload.changeId);
    await this.apiCall('sendMessage', {
      chat_id: chatId,
      text: [
        `⚠️ <b>Team Change Proposed</b>`,
        `Team: <b>${payload.teamName || payload.teamId}</b>`,
        payload.riskLevel ? `Risk: <code>${payload.riskLevel}</code>` : '',
        ``,
        String(payload.description || '').slice(0, 900),
      ].filter(Boolean).join('\n'),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: `tm:ap:${token}` },
          { text: '❌ Reject', callback_data: `tm:rj:${token}` },
        ]],
      },
    }).catch(async () => {
      await this.sendMessage(
        chatId,
        `⚠️ Team change proposed: ${payload.teamName || payload.teamId}\n${String(payload.description || '').slice(0, 900)}`,
      );
    });
  }

  /**
   * Send a repair/feature proposal with inline ✅ Approve / ❌ Reject buttons.
   * Called from server-v2 after propose_repair tool completes.
   */
  async sendRepairWithButtons(chatId: number, repairId: string): Promise<void> {
    const repair = loadPendingRepairSafe(repairId);
    if (!repair) {
      await this.sendMessage(chatId, `❌ Repair <code>#${repairId}</code> not found in pending store.`);
      return;
    }
    const payload = getRepairButtonPayloadSafe(repair);
    if (!payload) {
      await this.sendMessage(chatId, '❌ Self-repair is unavailable in this build.');
      return;
    }
    // Telegram max message length is 4096 — truncate if needed
    const text = payload.text.slice(0, 3800);
    await this.apiCall('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve — Apply & Rebuild', callback_data: `rp:ap:${repairId}` },
          { text: '❌ Reject', callback_data: `rp:rj:${repairId}` },
        ]],
      },
    }).catch(async () => {
      // Fallback: send as plain text if HTML parse fails
      await this.sendMessage(chatId, text).catch(() => {});
    });
  }

  /** Test the bot token — returns bot info or throws */
  async testConnection(): Promise<{ username: string; firstName: string }> {
    const info = await this.apiCall('getMe');
    return { username: info.username, firstName: info.first_name };
  }

  // ─── Long Polling Loop ───────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    console.log('[Telegram] Starting long poll loop...');
    console.log(`[Telegram] Subscribed update types: ${TELEGRAM_ALLOWED_UPDATES.join(', ')}`);

    while (this.polling) {
      try {
        this.abortController = new AbortController();
        const resp = await fetch(`${this.apiBase}/getUpdates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset: this.lastUpdateId + 1,
            timeout: 30,
            allowed_updates: TELEGRAM_ALLOWED_UPDATES,
          }),
          signal: this.abortController.signal,
        });
        const data: any = await resp.json();

        if (!data.ok || !Array.isArray(data.result)) {
          console.error('[Telegram] getUpdates failed:', data?.description || 'unknown error');
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        for (const update of data.result as TelegramUpdate[]) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
          if (update.callback_query) {
            this.handleCallbackQuery(update.callback_query).catch(err =>
              console.error('[Telegram] Callback query error:', err.message)
            );
          } else if (
            update.message?.text
            || update.message?.caption
            || update.message?.photo
            || update.message?.document
            || update.message?.video
            || update.message?.animation
            || update.message?.video_note
          ) {
            this.handleIncomingMessage(update.message).catch(err =>
              console.error('[Telegram] Message handling error:', err.message)
            );
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') break;
        console.error('[Telegram] Poll error:', err.message);
        // Wait before retrying on error
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  // ─── File Browser Helpers ────────────────────────────────────────────────────

  /** Resolve a user-supplied relative path against workspace root, with traversal guard */
  private resolveWorkspacePath(rel: string): string {
    const root = path.resolve(this.workspaceRoot);
    const resolved = path.resolve(root, rel);
    // Security: clamp to workspace root to prevent path traversal
    if (!resolved.startsWith(root)) return root;
    return resolved;
  }

  /** Build the inline keyboard + caption for a directory listing */
  private buildDirectoryKeyboard(dirPath: string): { text: string; reply_markup: object } | null {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return null;
    }

    // Sort: folders first, then files, both alphabetical
    const dirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
    const all = [...dirs, ...files].slice(0, BROWSER_MAX_BUTTONS_TOTAL);

    const wsRoot = path.resolve(this.workspaceRoot);
    const relDir = path.relative(wsRoot, dirPath) || '.';

    // Build file/folder buttons
    const buttons: Array<{ text: string; callback_data: string }> = [];
    for (const entry of all) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        buttons.push({
          text: `📁 ${entry.name}`,
          callback_data: `fb:dir:${pathKey(fullPath)}`,
        });
      } else {
        buttons.push({
          text: `📄 ${entry.name}`,
          callback_data: `fb:file:${pathKey(fullPath)}`,
        });
      }
    }

    // Navigation row at the bottom
    const navRow: Array<{ text: string; callback_data: string }> = [];
    const parentDir = path.dirname(dirPath);
    const resolvedDir = path.resolve(dirPath);
    if (parentDir !== dirPath && resolvedDir !== wsRoot) {
      navRow.push({ text: '⬆️ Up', callback_data: `fb:dir:${pathKey(parentDir)}` });
    }
    navRow.push({ text: '🏠 Home', callback_data: 'fb:home' });

    // Group buttons into rows of BROWSER_MAX_BUTTONS_PER_ROW
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < buttons.length; i += BROWSER_MAX_BUTTONS_PER_ROW) {
      rows.push(buttons.slice(i, i + BROWSER_MAX_BUTTONS_PER_ROW));
    }
    rows.push(navRow);

    const caption = `📂 <b>${relDir}</b>\n<i>${dirs.length} folders · ${files.length} files</i>`;

    return {
      text: caption,
      reply_markup: { inline_keyboard: rows },
    };
  }

  // File types that support visual preview (screenshot via /preview route)
  private static PREVIEWABLE_EXTS = new Set([
    'html','htm','svg','md','markdown','json','csv','tsv',
    'ts','js','py','sh','txt','yaml','yml','toml','css','rs','go',
  ]);

  /** Build text preview + pagination keyboard for a file */
  private buildFilePreview(filePath: string, page: number): { text: string; reply_markup: object } {
    const wsRoot = path.resolve(this.workspaceRoot);
    const relFile = path.relative(wsRoot, filePath);
    const fpKey = pathKey(filePath);
    const parentKey = pathKey(path.dirname(filePath));
    const backBtn = { text: '⬆️ Back', callback_data: `fb:dir:${parentKey}` };
    const homeBtn = { text: '🏠 Home', callback_data: 'fb:home' };

    let content: Buffer;
    try {
      content = fs.readFileSync(filePath);
    } catch (e: any) {
      return {
        text: `❌ Cannot read file: <code>${relFile}</code>\n${e.message}`,
        reply_markup: { inline_keyboard: [[backBtn, homeBtn]] },
      };
    }

    // Binary detection: look for null bytes in the first 512 bytes
    const isBinary = content.slice(0, 512).includes(0);
    if (isBinary) {
      const size = content.length;
      const sizeStr = size > 1024 * 1024
        ? `${(size / 1024 / 1024).toFixed(1)} MB`
        : size > 1024
          ? `${(size / 1024).toFixed(1)} KB`
          : `${size} B`;
      return {
        text: `📦 <b>${relFile}</b>\n\n<i>Binary file — ${sizeStr}</i>\n\nUse /download ${relFile} to download it.`,
        reply_markup: { inline_keyboard: [[backBtn, homeBtn]] },
      };
    }

    const fullText = content.toString('utf-8');
    const totalPages = Math.max(1, Math.ceil(fullText.length / BROWSER_MAX_TEXT_PREVIEW));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const chunk = fullText.slice(safePage * BROWSER_MAX_TEXT_PREVIEW, (safePage + 1) * BROWSER_MAX_TEXT_PREVIEW);

    // Escape HTML entities for <pre> block
    const escaped = chunk
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const header = `📄 <b>${relFile}</b> — page ${safePage + 1}/${totalPages}\n\n`;
    const preview = `${header}<pre>${escaped}</pre>`;

    // Pagination row
    const pageRow: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) pageRow.push({ text: '◀️ Prev', callback_data: `fb:page:${fpKey}:${safePage - 1}` });
    if (safePage < totalPages - 1) pageRow.push({ text: '▶️ Next', callback_data: `fb:page:${fpKey}:${safePage + 1}` });

    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const canPreview = TelegramChannel.PREVIEWABLE_EXTS.has(ext);
    const previewBtn = { text: '📸 Preview', callback_data: `fb:preview:${pathKey(filePath)}` };

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
    if (pageRow.length) keyboard.push(pageRow);
    if (canPreview) keyboard.push([previewBtn]);
    keyboard.push([backBtn, homeBtn]);

    return {
      text: preview.slice(0, 4000),
      reply_markup: { inline_keyboard: keyboard },
    };
  }

  /** Send a new browser message, or edit an existing one in-place */
  private async sendBrowserView(
    chatId: number,
    payload: { text: string; reply_markup: object },
    existingMessageId?: number,
  ): Promise<number> {
    const body = {
      chat_id: chatId,
      text: payload.text,
      parse_mode: 'HTML',
      reply_markup: payload.reply_markup,
    };

    if (existingMessageId) {
      try {
        await this.apiCall('editMessageText', { ...body, message_id: existingMessageId });
        return existingMessageId;
      } catch {
        // Fall through to send a new message if edit fails
      }
    }

    const result = await this.apiCall('sendMessage', body);
    return result.message_id as number;
  }

  // ─── Callback Query Handler (File Browser Navigation) ────────────────────────

  private async handleCallbackQuery(cq: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
    const chatId = cq.message.chat.id;
    const messageId = cq.message.message_id;
    const userId = cq.from.id;
    const data = cq.data;

    // Dismiss the loading spinner immediately
    await this.apiCall('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});

    // Allowlist check
    if (this.config.allowedUserIds.length > 0 && !this.config.allowedUserIds.includes(userId)) return;

    console.log(`[Telegram] Callback from ${cq.from.username || cq.from.first_name || userId}: ${String(data || '').slice(0, 120)}`);

    // ── pr: proposal approve/reject/list buttons ─────────────────────────────────
    if (data.startsWith('pr:')) {
      const parts = data.split(':');
      const action = parts[1]; // 'ap'=approve, 'rj'=reject, 'detail'=show detail, 'list'=show list
      const proposalId = parts[2];
      
      if (action === 'list') {
        // /proposals callback to switch between pending/done
        const status = proposalId === 'pending' ? 'pending' : 'done';
        const { listProposals } = await import('../proposals/proposal-store');
        const statusFilter = status === 'done' ? ['approved', 'executed', 'failed'] : ['pending'];
        const proposals = listProposals(statusFilter as any);
        
        if (proposals.length === 0) {
          await this.apiCall('editMessageText', {
            chat_id: chatId, message_id: messageId,
            text: `📋 No proposals in ${status}.`,
            reply_markup: { inline_keyboard: [[{ text: status === 'done' ? '⏳ View pending' : '✅ View done', callback_data: `pr:list:${status === 'done' ? 'pending' : 'done'}` }]] },
          }).catch(() => {});
          return;
        }
        const lines = proposals.map(p => {
          const emoji = this.getProposalStatusEmoji(p.status);
          return `${emoji} <code>#${this.tgEscape(p.id)}</code> <b>${this.tgEscape(String(p.title || 'Untitled').slice(0, 40))}</b>\n   Priority: ${this.tgEscape(p.priority)}`;
        });
        const kb = proposals.map(p => [{ text: this.compactTelegramButtonText(p.title || p.id, 34), callback_data: `pr:detail:${p.id}` }]);
        kb.push([{ text: status === 'done' ? '⏳ View pending' : '✅ View done', callback_data: `pr:list:${status === 'done' ? 'pending' : 'done'}` }]);
        
        try {
          await this.apiCall('editMessageText', {
            chat_id: chatId, message_id: messageId,
            text: `📋 <b>Proposals (${status.toUpperCase()})</b>\n\n${lines.join('\n\n')}`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kb },
          });
        } catch (e: any) {
          if (!e.message?.includes('message is not modified')) {
            console.error('[Telegram] pr:list edit error:', e.message);
          }
        }
        return;
      }
      
      if (action === 'detail') {
        // Show compact proposal card; the long plan stays behind View Details.
        const { loadProposal } = await import('../proposals/proposal-store');
        const p = loadProposal(proposalId);
        if (!p) {
          await this.apiCall('editMessageText', {
            chat_id: chatId, message_id: messageId,
            text: `❌ Proposal <code>#${proposalId}</code> not found.`,
            reply_markup: { inline_keyboard: [[{ text: '📋 Back', callback_data: 'pr:list:pending' }]] },
          }).catch(() => {});
          return;
        }
        const kb = this.buildProposalKeyboard(p, p.status === 'pending' ? 'pending' : 'done');
        
        try {
          await this.apiCall('editMessageText', {
            chat_id: chatId, message_id: messageId,
            text: this.formatProposalSummaryCard(p).slice(0, 4000),
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kb },
          });
        } catch (e: any) {
          if (!e.message?.includes('message is not modified')) {
            console.error('[Telegram] pr:detail edit error:', e.message);
          }
        }
        return;
      }

      if (action === 'full') {
        const { loadProposal } = await import('../proposals/proposal-store');
        const p = loadProposal(proposalId);
        if (!p) {
          await this.apiCall('editMessageText', {
            chat_id: chatId, message_id: messageId,
            text: `❌ Proposal <code>#${this.tgEscape(proposalId)}</code> not found.`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📋 Back', callback_data: 'pr:list:pending' }]] },
          }).catch(() => {});
          return;
        }
        const chunks = this.splitMessage(this.formatProposalFullDetails(p), 3800);
        for (let i = 0; i < chunks.length; i++) {
          const suffix = chunks.length > 1 ? `\n\n<i>Part ${i + 1}/${chunks.length}</i>` : '';
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: `${chunks[i]}${suffix}`,
            parse_mode: 'HTML',
            reply_markup: i === chunks.length - 1 ? { inline_keyboard: this.buildProposalKeyboard(p, p.status === 'pending' ? 'pending' : 'done', false) } : undefined,
          }).catch(async (err: any) => {
            await this.sendMessage(chatId, `❌ Could not send proposal details: ${String(err?.message || err)}`);
          });
        }
        return;
      }
      
      if (!proposalId) {
        await this.apiCall('editMessageText', {
          chat_id: chatId, message_id: messageId,
          text: '❌ Invalid proposal button — no proposal ID.',
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
        return;
      }
      
      if (action === 'ap') {
        // Approve proposal
        const { loadProposal, approveProposal } = await import('../proposals/proposal-store');
        const p = loadProposal(proposalId);
        if (!p) {
          await this.apiCall('editMessageText', {
            chat_id: chatId, message_id: messageId,
            text: `❌ Proposal <code>#${proposalId}</code> not found.`,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
          return;
        }
        
        // Disable buttons immediately
        await this.apiCall('editMessageReplyMarkup', {
          chat_id: chatId, message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '⏳ Approving...', callback_data: 'noop' }]] },
        }).catch(() => {});
        
        try {
          const { dispatchApprovedProposal } = await import('../routes/proposals.router');
          const approved = approveProposal(proposalId);
          if (approved) {
            await this.apiCall('editMessageReplyMarkup', {
              chat_id: chatId, message_id: messageId,
              reply_markup: { inline_keyboard: [[{ text: '✅ Approved', callback_data: 'noop' }, { text: '📋 List', callback_data: 'pr:list:pending' }]] },
            }).catch(() => {});
            const hasExecutionPlan = !!(approved.executorPrompt || (approved.affectedFiles?.length && approved.details));
            if (hasExecutionPlan) {
              await this.sendMessage(chatId, `✅ Proposal <code>#${proposalId}</code> approved. Executing...`);
              try {
                await dispatchApprovedProposal(approved, { channel: 'telegram', telegramChatId: chatId });
                await this.sendMessage(chatId, `🚀 Proposal <code>#${proposalId}</code> dispatched for execution.`);
              } catch (dispatchErr: any) {
                await this.sendMessage(chatId, `⚠️ Proposal approved but execution dispatch failed: ${dispatchErr?.message}`);
              }
            } else {
              await this.sendMessage(chatId, `✅ Proposal <code>#${proposalId}</code> approved. Ready for execution.`);
            }
          } else {
            await this.sendMessage(chatId, `❌ Could not approve proposal <code>#${proposalId}</code>.`);
          }
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Approval error: ${err.message}`);
        }
      } else if (action === 'rj') {
        // Reject proposal
        const { loadProposal, denyProposal } = await import('../proposals/proposal-store');
        const p = loadProposal(proposalId);
        if (!p) {
          await this.apiCall('editMessageText', {
            chat_id: chatId, message_id: messageId,
            text: `❌ Proposal <code>#${proposalId}</code> not found.`,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
          return;
        }
        
        await this.apiCall('editMessageReplyMarkup', {
          chat_id: chatId, message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '❌ Rejected', callback_data: 'noop' }, { text: '📋 List', callback_data: 'pr:list:pending' }]] },
        }).catch(() => {});
        
        try {
          denyProposal(proposalId);
          await this.sendMessage(chatId, `🗑️ Proposal <code>#${proposalId}</code> rejected.`);
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Rejection error: ${err.message}`);
        }
      }
      return;
	    }

	    // ── ca: command approval approve/reject/list buttons ───────────────────────
		    if (data.startsWith('ca:')) {
		      const parts = data.split(':');
		      const action = parts[1];
		      const approvalId = parts[2];

		      if (action === 'list') {
		        const { getApprovalQueue } = await import('../verification-flow');
		        const queue = getApprovalQueue();
		        const showDone = approvalId === 'done';
		        const approvals = queue.listAll().filter((item: any) => showDone ? item.status !== 'pending' : item.status === 'pending');
		        if (approvals.length === 0) {
		          await this.apiCall('editMessageText', {
		            chat_id: chatId,
		            message_id: messageId,
		            text: `📋 No command approvals ${showDone ? 'completed' : 'pending'}.`,
		            reply_markup: { inline_keyboard: [[{ text: showDone ? '⏳ View pending' : '✅ View done', callback_data: `ca:list:${showDone ? 'pending' : 'done'}` }]] },
		          }).catch(() => {});
		          return;
		        }
		        const statusEmoji: Record<string, string> = { pending: '⏳', approved: '✅', rejected: '❌' };
		        const lines = approvals.slice(0, 15).map((a: any) =>
		          `${statusEmoji[a.status] || '❓'} <code>#${a.id}</code> <b>${this.tgEscape(String(a.toolArgs?.command || '').slice(0, 42))}</b>\n   Origin: ${this.tgEscape(this.getCommandApprovalOrigin(a))} · Risk: ${Number(a.riskScore || 0)}/10`
		        );
		        const kb = approvals.slice(0, 15).map((a: any) => [{ text: String(a.toolArgs?.command || '').slice(0, 28) || a.id, callback_data: `ca:detail:${a.id}` }]);
		        kb.push([{ text: showDone ? '⏳ View pending' : '✅ View done', callback_data: `ca:list:${showDone ? 'pending' : 'done'}` }]);
		        await this.apiCall('editMessageText', {
		          chat_id: chatId,
		          message_id: messageId,
		          text: `📋 <b>Command Approvals (${showDone ? 'DONE' : 'PENDING'})</b>\n\n${lines.join('\n\n')}`.slice(0, 4000),
		          parse_mode: 'HTML',
		          reply_markup: { inline_keyboard: kb },
		        }).catch(() => {});
		        return;
		      }

		      if (action === 'detail') {
		        const { getApprovalQueue } = await import('../verification-flow');
		        const approval = getApprovalQueue().get(String(approvalId || '').trim());
		        if (!approval) {
	          await this.apiCall('editMessageText', {
	            chat_id: chatId,
	            message_id: messageId,
	            text: `❌ Command approval <code>#${this.tgEscape(approvalId)}</code> not found.`,
	            reply_markup: { inline_keyboard: [[{ text: '📋 Back', callback_data: 'ca:list:pending' }]] },
	          }).catch(() => {});
	          return;
	        }
		        const statusEmoji: Record<string, string> = { pending: '⏳', approved: '✅', rejected: '❌' };
		        const detail = [
		          `${statusEmoji[approval.status] || '❓'} <b>Command Approval</b>`,
		          ``,
		          `<b>ID:</b> <code>${this.tgEscape(approval.id)}</code>`,
		          `<b>Status:</b> ${this.tgEscape(approval.status)}`,
		          `<b>Origin:</b> ${this.tgEscape(this.getCommandApprovalOrigin(approval))}`,
		          `<b>Risk:</b> ${Number(approval.riskScore || 0)}/10`,
		          `<b>Session:</b> <code>${this.tgEscape(approval.sessionId || 'unknown')}</code>`,
		          `<b>Reason:</b> ${this.tgEscape(approval.reason || approval.action || '')}`,
		          ``,
		          `<b>Command:</b>`,
		          `<code>${this.tgEscape(String(approval.toolArgs?.command || '').slice(0, 1200))}</code>`,
		        ].filter(Boolean).join('\n');
	        const kb: any[][] = [];
	        if (approval.status === 'pending') {
	          kb.push([{ text: '✅ Approve Once', callback_data: `ca:ap:${approval.id}` }, { text: '❌ Reject', callback_data: `ca:rj:${approval.id}` }]);
	          kb.push([{ text: 'This Session', callback_data: `ca:session:${approval.id}` }, { text: 'Always Allow', callback_data: `ca:always:${approval.id}` }]);
	        }
	        kb.push([{ text: '📋 Back to list', callback_data: 'ca:list:pending' }]);
	        await this.apiCall('editMessageText', {
	          chat_id: chatId,
	          message_id: messageId,
	          text: detail.slice(0, 4000),
	          parse_mode: 'HTML',
	          reply_markup: { inline_keyboard: kb },
	        }).catch(() => {});
	        return;
	      }

	      if (!approvalId) {
	        await this.apiCall('editMessageText', {
	          chat_id: chatId, message_id: messageId,
	          text: '❌ Invalid command approval button — no approval ID.',
	          reply_markup: { inline_keyboard: [] },
	        }).catch(() => {});
	        return;
	      }

		      if (action === 'ap' || action === 'session' || action === 'always') {
		        const { getApprovalQueue } = await import('../verification-flow');
		        const queue = getApprovalQueue();
		        const existing = queue.get(approvalId);
		        if (!existing) {
		          await this.sendMessage(chatId, `❌ Command approval <code>#${approvalId}</code> not found.`);
		          return;
	        }
	        await this.apiCall('editMessageReplyMarkup', {
	          chat_id: chatId,
	          message_id: messageId,
	          reply_markup: { inline_keyboard: [[{ text: '⏳ Approving...', callback_data: 'noop' }]] },
		        }).catch(() => {});
		        try {
		          const approved = queue.resolve(approvalId, true, 'telegram');
		          if (!approved) throw new Error('Approval is no longer pending.');
              let grantLabel = '';
              if ((action === 'session' || action === 'always') && approved.commandPermissionCandidate) {
                const { addCommandPermissionGrant } = await import('../command-permissions');
                const grant = addCommandPermissionGrant(approved.commandPermissionCandidate, action, 'telegram');
                const { appendAuditEntry } = await import('../audit-log');
                appendAuditEntry({
                  sessionId: approved.sessionId,
                  agentId: approved.agentId,
                  actionType: 'approval_resolved',
                  toolName: approved.toolName,
                  toolArgs: { command: approved.commandPermissionCandidate.command },
                  policyTier: approved.policyTier,
                  approvalStatus: 'auto_allowed' as any,
                  resultSummary: `Created ${action} command permission ${grant.id}`,
                });
                grantLabel = action === 'always'
                  ? ` Always allow saved (<code>${this.tgEscape(grant.id)}</code>).`
                  : ` Session allow saved (<code>${this.tgEscape(grant.id)}</code>).`;
              }
		          await this.apiCall('editMessageReplyMarkup', {
		            chat_id: chatId,
		            message_id: messageId,
		            reply_markup: { inline_keyboard: [[{ text: action === 'always' ? '✅ Always allowed' : action === 'session' ? '✅ Allowed this session' : '✅ Approved', callback_data: 'noop' }, { text: '📋 List', callback_data: 'ca:list:pending' }]] },
		          }).catch(() => {});
		          await this.sendMessage(chatId, `✅ Command approval <code>#${approvalId}</code> approved.${grantLabel} The paused run will continue now.`);
		        } catch (err: any) {
		          await this.sendMessage(chatId, `❌ Approval error: ${err.message}`);
		        }
	        return;
	      }

		      if (action === 'rj') {
		        const { getApprovalQueue } = await import('../verification-flow');
		        const queue = getApprovalQueue();
		        const existing = queue.get(approvalId);
		        if (!existing) {
		          await this.sendMessage(chatId, `❌ Command approval <code>#${approvalId}</code> not found.`);
		          return;
	        }
	        await this.apiCall('editMessageReplyMarkup', {
	          chat_id: chatId,
	          message_id: messageId,
	          reply_markup: { inline_keyboard: [[{ text: '❌ Rejected', callback_data: 'noop' }, { text: '📋 List', callback_data: 'ca:list:pending' }]] },
		        }).catch(() => {});
		        try {
		          const denied = queue.resolve(approvalId, false, 'telegram');
		          if (!denied) throw new Error('Approval is no longer pending.');
		          await this.sendMessage(chatId, `🗑️ Command approval <code>#${approvalId}</code> rejected.`);
		        } catch (err: any) {
		          await this.sendMessage(chatId, `❌ Rejection error: ${err.message}`);
	        }
	        return;
	      }
	    }

	    // ── rp: repair approve/reject buttons ──────────────────────────────────
	    if (data.startsWith('rp:')) {
      const parts = data.split(':');
      const action = parts[1]; // 'ap' or 'rj'
      const repairId = parts[2];
      if (!repairId) {
        await this.apiCall('editMessageText', {
          chat_id: chatId, message_id: messageId,
          text: '\u274c Invalid repair button — no repair ID.',
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
        return;
      }
      if (action === 'ap') {
        // Disable buttons immediately to prevent double-tap
        await this.apiCall('editMessageReplyMarkup', {
          chat_id: chatId, message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '\u23f3 Applying...', callback_data: 'noop' }]] },
        }).catch(() => {});
        await this.sendMessage(chatId,
          `🔧 Applying repair <code>#${repairId}</code>... patching, rebuilding, restarting. Takes 30–60s.`
        );
        applyApprovedRepairSafe(repairId).then(async (result) => {
          try {
            // Update the original message to show the outcome
            await this.apiCall('editMessageReplyMarkup', {
              chat_id: chatId, message_id: messageId,
              reply_markup: { inline_keyboard: [[{ text: result.success ? '\u2705 Applied' : '\u274c Failed', callback_data: 'noop' }]] },
            }).catch(() => {});
            await this.sendMessage(chatId, result.message);
          } catch {}
        }).catch(async (err) => {
          try { await this.sendMessage(chatId, `❌ Repair error: ${err.message}`); } catch {}
        });
      } else if (action === 'rj') {
        const repair = loadPendingRepairSafe(repairId);
        const deleted = repair ? deletePendingRepairSafe(repairId) : false;
        await this.apiCall('editMessageReplyMarkup', {
          chat_id: chatId, message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '\u274c Rejected', callback_data: 'noop' }]] },
        }).catch(() => {});
        await this.sendMessage(chatId, deleted
          ? `🗑️ Repair <code>#${repairId}</code> rejected and discarded.`
          : `❌ Could not find repair <code>#${repairId}</code> to reject.`
        );
      }
      return;
    }

	    // Route team callbacks to the team handler
	    if (data.startsWith('rsm:')) {
	      await this.handleResumeCallback(chatId, messageId, data, userId);
	      return;
	    }
	    if (data.startsWith('tm:')) {
	      await this.handleTeamCallback(chatId, messageId, data, userId);
	      return;
	    }
    if (data.startsWith('ag:')) {
      await this.handleAgentsCallback(chatId, messageId, data, userId);
      return;
    }
    if (data.startsWith('bg:')) {
      await this.handleBgTasksCallback(chatId, messageId, data, userId);
      return;
    }
    if (data.startsWith('sc:')) {
      await this.handleScheduleCallback(chatId, messageId, data, userId);
      return;
    }

	    if (data.startsWith('md:')) {
	      await this.handleModelCallback(chatId, messageId, data, userId);
	      return;
	    }

	    if (data.startsWith('rg:')) {
	      await this.handleReasoningCallback(chatId, messageId, data, userId);
	      return;
	    }

	    if (data.startsWith('ss:')) {
      const action = data.slice('ss:'.length).trim().toLowerCase();
      const monitorMatch = action.match(/^desktop:m:(\d+)$/);
      if (action === 'menu') {
        await this.apiCall('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: '📸 <b>Screenshot Menu</b>\nChoose what to capture.',
          parse_mode: 'HTML',
          reply_markup: this.buildScreenshotReplyMarkup(),
        }).catch(async () => {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: '📸 <b>Screenshot Menu</b>\nChoose what to capture.',
            parse_mode: 'HTML',
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        });
        return;
      }
      if (action === 'desktop') {
        try {
          const { desktopGetMonitors } = await import('../desktop-tools.js');
          const monitorsRaw = await desktopGetMonitors();
          const monitors = (Array.isArray(monitorsRaw) ? monitorsRaw : [])
            .filter((m: any) => Number.isFinite(Number(m?.index)) && Number(m?.width) > 0 && Number(m?.height) > 0)
            .map((m: any) => ({
              index: Math.max(0, Math.floor(Number(m.index))),
              width: Math.max(1, Math.floor(Number(m.width))),
              height: Math.max(1, Math.floor(Number(m.height))),
              primary: !!m.primary,
            }))
            .sort((a: any, b: any) => a.index - b.index);

          if (monitors.length <= 1) {
            const autoIndex = monitors.length === 1 ? monitors[0].index : 0;
            await this.apiCall('editMessageReplyMarkup', {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [] },
            }).catch(() => {});
            await this.sendMessage(chatId, `📸 Capturing desktop monitor ${autoIndex + 1} (single monitor detected)...`);
            const desktopResult = await this.runTelegramDesktopScreenshot(chatId, userId, {
              monitorIndex: autoIndex,
              triggerLabel: 'desktop button (single monitor auto)',
            });
            const ok = !/^ERROR:/i.test(String(desktopResult || ''));
            await this.apiCall('sendMessage', {
              chat_id: chatId,
              text: [
                `📸 <b>Desktop Screenshot</b>`,
                `Result: ${ok ? '✅' : '⚠️'} ${String(desktopResult || '').slice(0, 700) || 'No response'}`,
                `<i>Captured using desktop_screenshot with monitor selection (same pipeline AI uses).</i>`,
              ].join('\n'),
              parse_mode: 'HTML',
              reply_markup: this.buildScreenshotReplyMarkup(),
            }).catch(() => {});
            return;
          }

          await this.apiCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: [
              `🖥 <b>Desktop Screenshot</b>`,
              `Detected <b>${monitors.length}</b> monitors.`,
              `Choose which monitor to capture.`,
              `<i>This uses desktop_screenshot monitor capture (same image path AI sees).</i>`,
            ].join('\n'),
            parse_mode: 'HTML',
            reply_markup: this.buildDesktopMonitorReplyMarkup(monitors),
          }).catch(async () => {
            await this.apiCall('sendMessage', {
              chat_id: chatId,
              text: [
                `🖥 <b>Desktop Screenshot</b>`,
                `Detected <b>${monitors.length}</b> monitors. Choose one below.`,
              ].join('\n'),
              parse_mode: 'HTML',
              reply_markup: this.buildDesktopMonitorReplyMarkup(monitors),
            }).catch(() => {});
          });
        } catch (err: any) {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: `❌ Could not detect monitors: ${String(err?.message || err)}`,
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        }
        return;
      }
      if (action === 'desktop:all') {
        try {
          await this.apiCall('editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
          await this.sendMessage(chatId, '📸 Capturing combined desktop (all monitors)...');
          const desktopResult = await this.runTelegramDesktopScreenshot(chatId, userId, {
            triggerLabel: 'desktop all monitors button',
          });
          const ok = !/^ERROR:/i.test(String(desktopResult || ''));
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: [
              `📸 <b>Desktop Screenshot (All Monitors)</b>`,
              `Result: ${ok ? '✅' : '⚠️'} ${String(desktopResult || '').slice(0, 700) || 'No response'}`,
            ].join('\n'),
            parse_mode: 'HTML',
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        } catch (err: any) {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: `❌ Desktop screenshot failed: ${String(err?.message || err)}`,
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        }
        return;
      }
      if (monitorMatch) {
        const monitorIndex = Math.max(0, Math.floor(Number(monitorMatch[1])));
        try {
          await this.apiCall('editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
          await this.sendMessage(chatId, `📸 Capturing desktop monitor ${monitorIndex + 1}...`);
          const desktopResult = await this.runTelegramDesktopScreenshot(chatId, userId, {
            monitorIndex,
            triggerLabel: `desktop monitor ${monitorIndex + 1} button`,
          });
          const ok = !/^ERROR:/i.test(String(desktopResult || ''));
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: [
              `📸 <b>Desktop Screenshot</b>`,
              `Monitor ${monitorIndex + 1}: ${ok ? '✅' : '⚠️'} ${String(desktopResult || '').slice(0, 700) || 'No response'}`,
            ].join('\n'),
            parse_mode: 'HTML',
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        } catch (err: any) {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: `❌ Desktop screenshot failed: ${String(err?.message || err)}`,
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        }
        return;
      }
      if (action === 'browser') {
        try {
          const payload = await this.buildBrowserScreenshotPayload(chatId, userId);
          await this.apiCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: payload.text,
            parse_mode: 'HTML',
            reply_markup: payload.reply_markup,
          }).catch(async () => {
            await this.apiCall('sendMessage', {
              chat_id: chatId,
              text: payload.text,
              parse_mode: 'HTML',
              reply_markup: payload.reply_markup,
            }).catch(() => {});
          });
        } catch (err: any) {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: `❌ Could not list browser instances: ${String(err?.message || err)}`,
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        }
        return;
      }
      if (action === 'browser:current' || action.startsWith('b:')) {
        const selectedSessionId = action === 'browser:current'
          ? this.getTelegramSessionId(userId, chatId)
          : this.getScreenshotBrowserSelection(chatId, userId, action.slice('b:'.length));
        if (!selectedSessionId) {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: '❌ Browser selection expired. Use /screenshot to refresh the browser list.',
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
          return;
        }
        try {
          await this.apiCall('editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
          await this.sendMessage(chatId, `📸 Capturing browser screenshot...`);
          const browserResult = await this.runTelegramBrowserScreenshot(chatId, userId, 'browser instance button', {
            sessionId: selectedSessionId,
          });
          const ok = !/^ERROR:/i.test(String(browserResult || ''));
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: [
              `📸 <b>Browser Screenshot</b>`,
              `Result: ${ok ? '✅' : '⚠️'} ${this.htmlEscape(String(browserResult || '').slice(0, 700) || 'No response')}`,
            ].join('\n'),
            parse_mode: 'HTML',
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        } catch (err: any) {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: `❌ Screenshot capture failed: ${this.htmlEscape(String(err?.message || err))}`,
            parse_mode: 'HTML',
            reply_markup: this.buildScreenshotReplyMarkup(),
          }).catch(() => {});
        }
        return;
      }
      if (action !== 'browser') {
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: '❌ Unknown screenshot action. Use /screenshot to start again.',
          reply_markup: this.buildScreenshotReplyMarkup(),
        }).catch(() => {});
        return;
      }
    }

    if (data.startsWith('rs:')) {
      const mode = data.slice('rs:'.length).trim().toLowerCase();
      await this.apiCall('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      try {
        if (mode === 'full') {
          await this.runFullRestart(chatId, userId);
        } else if (mode === 'quick') {
          await this.runQuickRestart(chatId, userId);
        } else {
          await this.sendMessage(chatId, '❌ Unknown restart option. Use /restart to open the restart menu again.');
        }
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Restart failed: ${String(err?.message || err)}`);
      }
      return;
    }

    if (data.startsWith('us:')) {
      const action = data.slice('us:'.length).trim().toLowerCase();
      await this.apiCall('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      try {
        if (action === 'check') {
          const check = this.checkForGitUpdate();
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: this.formatUpdateCheckMessage(check),
            parse_mode: 'HTML',
            reply_markup: check.ok && check.available ? this.buildUpdateReplyMarkup() : undefined,
          });
        } else if (action === 'apply') {
          await this.runTelegramSelfUpdate(chatId, userId);
        } else if (action === 'cancel') {
          await this.sendMessage(chatId, 'Update canceled.');
        } else {
          await this.sendMessage(chatId, '❌ Unknown update option. Use /update to open the update menu again.');
        }
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Update action failed: ${String(err?.message || err)}`);
      }
      return;
    }

    if (data.startsWith('stop:')) {
      await this.handleStopCallback(chatId, messageId, data);
      return;
    }

    // Only handle file browser callbacks
    if (!data.startsWith('fb:')) return;

    let payload: { text: string; reply_markup: object } | null = null;

    if (data === 'fb:home') {
      payload = this.buildDirectoryKeyboard(path.resolve(this.workspaceRoot));

    } else if (data.startsWith('fb:dir:')) {
      const dirPath = pathResolve(data.slice('fb:dir:'.length));
      if (!dirPath) { await this.sendMessage(chatId, '❌ Session expired — send /browse to start again.'); return; }
      payload = this.buildDirectoryKeyboard(dirPath);

    } else if (data.startsWith('fb:file:')) {
      const filePath = pathResolve(data.slice('fb:file:'.length));
      if (!filePath) { await this.sendMessage(chatId, '❌ Session expired — send /browse to start again.'); return; }
      payload = this.buildFilePreview(filePath, 0);

    } else if (data.startsWith('fb:page:')) {
      // Format: fb:page:<pathKey>:<pageNum>
      const rest = data.slice('fb:page:'.length);
      const lastColon = rest.lastIndexOf(':');
      const key = rest.slice(0, lastColon);
      const pageNum = parseInt(rest.slice(lastColon + 1), 10) || 0;
      const filePath = pathResolve(key);
      if (!filePath) { await this.sendMessage(chatId, '❌ Session expired — send /browse to start again.'); return; }
      payload = this.buildFilePreview(filePath, pageNum);

    } else if (data.startsWith('fb:preview:')) {
      // Visual preview — screenshot the file via the /preview route
      const filePath = pathResolve(data.slice('fb:preview:'.length));
      if (!filePath) { await this.sendMessage(chatId, '❌ Session expired — send /browse to start again.'); return; }
      const wsRoot = path.resolve(this.workspaceRoot);
      const relPath = path.relative(wsRoot, filePath).replace(/\\/g, '/');
      const fileName = path.basename(filePath);

      // 1. Show immediate loading message (edit in-place)
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: `📸 <b>Generating preview…</b>\n\n<code>${fileName}</code>\n\n<i>Rendering and screenshotting the page. This takes a few seconds.</i>`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        });
      } catch { /* non-fatal — best effort */ }

      // 2. Call the screenshot route
      try {
        const cfg = (await import('../../config/config.js')).getConfig().getConfig() as any;
        const token = resolveGatewayAuthToken();
        const port = Number(cfg?.gateway?.port || 18789);
        const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
        const screenshotUrl = `http://127.0.0.1:${port}/api/preview/screenshot?path=${encodeURIComponent(relPath)}${tokenParam}`;

        const resp = await fetch(screenshotUrl);
        const result: any = await resp.json();

        if (!result.success || !Array.isArray(result.chunks) || result.chunks.length === 0) {
          throw new Error(result.error || 'No chunks returned');
        }

        const chunks: Array<{ base64: string; index: number; total: number }> = result.chunks;
        const total = chunks.length;

        // 3a. Single chunk — send as one photo, then restore the code preview
        if (total === 1) {
          const buf = Buffer.from(chunks[0].base64, 'base64');
          const form = new FormData();
          form.append('chat_id', String(chatId));
          form.append('photo', new Blob([buf], { type: 'image/png' }), `${fileName}-preview.png`);
          form.append('caption', `📸 <b>${fileName}</b> — full preview`);
          form.append('parse_mode', 'HTML');
          await fetch(`${this.apiBase}/sendPhoto`, { method: 'POST', body: form });
        } else {
          // 3b. Multiple chunks — send as a media group album
          // Build the media array for sendMediaGroup (up to 10 items)
          const mediaItems = chunks.slice(0, 10).map((chunk, i) => ({
            type: 'photo',
            media: `attach://chunk_${i}`,
            caption: i === 0 ? `📸 <b>${fileName}</b> — page ${i + 1}/${total}` : `Page ${i + 1}/${total}`,
            parse_mode: 'HTML',
          }));

          const form = new FormData();
          form.append('chat_id', String(chatId));
          form.append('media', JSON.stringify(mediaItems));
          chunks.slice(0, 10).forEach((chunk, i) => {
            const buf = Buffer.from(chunk.base64, 'base64');
            form.append(`chunk_${i}`, new Blob([buf], { type: 'image/png' }), `preview_${i}.png`);
          });
          await fetch(`${this.apiBase}/sendMediaGroup`, { method: 'POST', body: form });

          if (total > 10) {
            await this.sendMessage(chatId, `⚠️ Page is very long (${total} chunks). Showing first 10. Use /download ${relPath} to get the full file.`);
          }
        }

        // 4. Restore the code preview in the original message with the Preview button back
        const restored = this.buildFilePreview(filePath, 0);
        try {
          await this.apiCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: restored.text,
            parse_mode: 'HTML',
            reply_markup: restored.reply_markup,
          });
        } catch { /* non-fatal */ }

      } catch (err: any) {
        // Restore the code preview with an error note
        const restored = this.buildFilePreview(filePath, 0);
        try {
          await this.apiCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `❌ Preview failed: ${String(err?.message || err).slice(0, 200)}\n\n${restored.text}`,
            parse_mode: 'HTML',
            reply_markup: restored.reply_markup,
          });
        } catch { /* non-fatal */ }
      }
      return; // handled inline — no fallthrough to the payload block below
    }

    if (!payload) return;

    try {
      await this.apiCall('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: payload.text,
        parse_mode: 'HTML',
        reply_markup: payload.reply_markup,
      });
    } catch (err: any) {
      // Telegram returns an error if the content is identical — that's fine, ignore it
      if (!err.message?.includes('message is not modified')) {
        console.error('[Telegram] editMessageText error:', err.message);
      }
    }
  }

  private async handleResumeCallback(chatId: number, messageId: number, data: string, userId: number): Promise<void> {
    const edit = async (payload: { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }) => {
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: payload.text.slice(0, 4000),
          parse_mode: 'HTML',
          reply_markup: payload.reply_markup,
        });
      } catch (err: any) {
        if (err?.message?.includes('message is not modified')) return;
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: payload.text.slice(0, 4000),
          parse_mode: 'HTML',
          reply_markup: payload.reply_markup,
        }).catch(() => {});
      }
    };

    if (data === 'rsm:menu') {
      await edit(this.buildResumeRootPayload(userId));
      return;
    }

    if (data === 'rsm:cancel') {
      await edit({
        text: '❌ Resume picker closed.',
        reply_markup: { inline_keyboard: [] },
      });
      return;
    }

    if (data === 'rsm:channels') {
      await edit(this.buildResumeChannelsPayload(userId));
      return;
    }

    if (data.startsWith('rsm:projects:')) {
      const offset = Number.parseInt(data.slice('rsm:projects:'.length), 10) || 0;
      await edit(this.buildResumeProjectsPayload(userId, offset));
      return;
    }

    if (data.startsWith('rsm:list:all:')) {
      const offset = Number.parseInt(data.slice('rsm:list:all:'.length), 10) || 0;
      await edit(this.buildResumeSessionListPayload({
        header: '💬 <b>Chats</b>',
        emptyText: 'No resumable chats found.',
        sessions: this.listResumeSessions(userId),
        offset,
        backCallback: 'rsm:menu',
        pageCallback: (nextOffset) => `rsm:list:all:${nextOffset}`,
        detailCallback: (sessionKey) => `rsm:view:${sessionKey}:all:${offset}`,
      }));
      return;
    }

    if (data.startsWith('rsm:list:ch:')) {
      const parts = data.split(':');
      const channelKey = parts[3] as ResumeChannelKey;
      const offset = Number.parseInt(parts[4] || '0', 10) || 0;
      if (!RESUME_CHANNEL_DEFS.some((def) => def.key === channelKey)) {
        await edit({
          text: '❌ Unknown channel.',
          reply_markup: { inline_keyboard: [[
            { text: '⬅️ Back', callback_data: 'rsm:channels' },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ]] },
        });
        return;
      }
      const channelDef = RESUME_CHANNEL_DEFS.find((def) => def.key === channelKey)!;
      await edit(this.buildResumeSessionListPayload({
        header: `${channelDef.icon} <b>${this.tgEscape(channelDef.label)}</b>\nChannel chats`,
        emptyText: `No ${channelDef.label} chats found.`,
        sessions: this.listResumeSessionsByChannel(channelKey, userId),
        offset,
        backCallback: 'rsm:channels',
        pageCallback: (nextOffset) => `rsm:list:ch:${channelKey}:${nextOffset}`,
        detailCallback: (sessionKey) => `rsm:view:${sessionKey}:ch:${channelKey}:${offset}`,
      }));
      return;
    }

    if (data.startsWith('rsm:list:pr:')) {
      const parts = data.split(':');
      const projectId = idResolve(parts[3] || '');
      const offset = Number.parseInt(parts[4] || '0', 10) || 0;
      if (!projectId) {
        await edit({
          text: '❌ Project list expired. Use /resume again.',
          reply_markup: { inline_keyboard: [[
            { text: '⬅️ Projects', callback_data: 'rsm:projects:0' },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ]] },
        });
        return;
      }
      await edit(this.buildResumeProjectSessionsPayload(projectId, userId, offset));
      return;
    }

    if (data.startsWith('rsm:view:')) {
      const parts = data.split(':');
      const sessionId = idResolve(parts[2] || '');
      const scope = parts[3] as ResumeScope;
      if (!sessionId) {
        await edit({
          text: '❌ Chat list expired. Use /resume again.',
          reply_markup: { inline_keyboard: [[
            { text: '⬅️ Back', callback_data: 'rsm:menu' },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ]] },
        });
        return;
      }

      let backCallback = 'rsm:menu';
      if (scope === 'all') {
        const offset = Number.parseInt(parts[4] || '0', 10) || 0;
        backCallback = `rsm:list:all:${offset}`;
      } else if (scope === 'channel') {
        const channelKey = parts[4] as ResumeChannelKey;
        const offset = Number.parseInt(parts[5] || '0', 10) || 0;
        backCallback = `rsm:list:ch:${channelKey}:${offset}`;
      } else if (scope === 'project') {
        const projectId = idResolve(parts[4] || '');
        const offset = Number.parseInt(parts[5] || '0', 10) || 0;
        backCallback = projectId ? `rsm:list:pr:${idKey(projectId)}:${offset}` : 'rsm:projects:0';
      } else if (scope === 'ch') {
        const channelKey = parts[4] as ResumeChannelKey;
        const offset = Number.parseInt(parts[5] || '0', 10) || 0;
        backCallback = `rsm:list:ch:${channelKey}:${offset}`;
      } else if (scope === 'pr') {
        const projectId = idResolve(parts[4] || '');
        const offset = Number.parseInt(parts[5] || '0', 10) || 0;
        backCallback = projectId ? `rsm:list:pr:${idKey(projectId)}:${offset}` : 'rsm:projects:0';
      }

      await edit(this.buildResumeSessionDetailPayload(sessionId, userId, backCallback));
      return;
    }

    if (data.startsWith('rsm:link:')) {
      const sessionId = idResolve(data.slice('rsm:link:'.length));
      if (!sessionId || !sessionExists(sessionId)) {
        await edit({
          text: '❌ Chat session not found. Use /resume again.',
          reply_markup: { inline_keyboard: [[
            { text: '🔁 Resume Menu', callback_data: 'rsm:menu' },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ]] },
        });
        return;
      }

      const session = getSession(sessionId);
      if (!this.isResumeCandidateSession(session, userId)) {
        await edit({
          text: '❌ This chat is not available to resume from Telegram.',
          reply_markup: { inline_keyboard: [[
            { text: '🔁 Resume Menu', callback_data: 'rsm:menu' },
            { text: '❌ Cancel', callback_data: 'rsm:cancel' },
          ]] },
        });
        return;
      }

      linkTelegramSession(userId, sessionId);
      setSessionChannelHint(sessionId, { channel: 'telegram', chatId, userId, timestamp: Date.now() });

      const projectInfo = this.buildResumeProjectLookup().get(sessionId);
      const summary = this.buildResumeSessionSummary(session, sessionId, projectInfo || null);
      const contextBits = [
        `${summary.messageCount} msgs`,
        this.formatResumeTime(summary.lastActiveAt),
        summary.projectName ? `Project: ${summary.projectName}` : '',
      ].filter(Boolean);

      await edit({
        text: [
          '✅ <b>Telegram is now linked to this chat.</b>',
          '',
          `<b>${this.tgEscape(summary.title)}</b>`,
          this.tgEscape(summary.firstMessage),
          '',
          `<i>${this.tgEscape(contextBits.join(' • '))}</i>`,
          '',
          'Your next Telegram message will continue this exact conversation with its full session context.',
        ].join('\n'),
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔁 Resume Another', callback_data: 'rsm:menu' }],
            [{ text: '❌ Close', callback_data: 'rsm:cancel' }],
          ],
        },
      });
    }
  }

  // ─── Teams Deep Browser ───────────────────────────────────────────────────────────

  // callback_data scheme (all single-message in-place edits):
  //   tm:list                   — root: list all teams
  //   tm:t:<k>                  — team overview (k = tmKey(undefined,teamId))
  //   tm:mgr:<k>                — manager node (k = tmKey(undefined,teamId))
  //   tm:ag:<k>                 — agent node   (k = tmKey(agentId,teamId))
  //   tm:inf_ag:<k>             — agent info panel
  //   tm:inf_mgr:<k>            — manager info panel
  //   tm:prompt:<k>:<p>         — paginated prompt file (page p)
  //   tm:runs:<k>               — agent run log
  //   tm:tchat:<k>              — team chat log (manager conversation history)
  //   tm:dochat_ag:<k>          — set pending chat → dispatch to agent
  //   tm:dochat_mgr:<k>         — set pending chat → message to manager
  //   tm:cancel_chat:<userId>   — cancel pending chat

  private async handleTeamCallback(chatId: number, messageId: number, data: string, userId: number): Promise<void> {
    if (!this.teamDeps) {
      await this.apiCall('editMessageText', {
        chat_id: chatId, message_id: messageId,
        text: '⚠️ Team management not ready. Try again in a moment.',
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      return;
    }

    // Helper: edit the existing message in-place
    const edit = async (text: string, kb: any[][]) => {
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId, message_id: messageId,
          text: text.slice(0, 4000), parse_mode: 'HTML',
          reply_markup: { inline_keyboard: kb },
        });
      } catch (e: any) {
        if (!e.message?.includes('message is not modified')) {
          console.error('[TM] edit error:', e.message);
        }
      }
    };

    // Helper: read a workspace file for an agent (prompt/system_prompt.md or HEARTBEAT.md)
    const readAgentPrompt = (agentId: string): { text: string; filePath: string } => {
      try {
        const { getAgentById, resolveAgentWorkspace } = require('../config/config.js');
        const agent = getAgentById(agentId);
        if (!agent) return { text: '(agent not found)', filePath: '' };
        const ws = resolveAgentWorkspace(agent);
        for (const name of ['system_prompt.md', 'HEARTBEAT.md', 'SOUL.md', 'IDENTITY.md']) {
          const fp = path.join(ws, name);
          if (fs.existsSync(fp)) return { text: fs.readFileSync(fp, 'utf-8'), filePath: fp };
        }
        return { text: '(no prompt file found in workspace)', filePath: '' };
      } catch { return { text: '(error reading prompt)', filePath: '' }; }
    };

    // ── tm:list ────────────────────────────────────────────────────────
    if (data === 'tm:list') {
      const teams = this.teamDeps.listManagedTeams();
      if (teams.length === 0) { await edit('🤖 No teams configured.', []); return; }
      const rows = teams.map((t: any) => [{
        text: `${t.emoji || '🤖'} ${t.name}  (${t.subagentIds?.length || 0} agents)`,
        callback_data: `tm:t:${tmKey(undefined, t.id)}`,
      }]);
      await edit(`🤖 <b>Your Teams</b>\n\nSelect a team to explore:`, rows);
      return;
    }

    // ── tm:t:<k>  team overview ──────────────────────────────────────
    if (data.startsWith('tm:t:')) {
      const k = data.slice('tm:t:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired. Use /teams again.', []); return; }
      const { teamId } = ids;
      const team = this.teamDeps.getManagedTeam(teamId!);
      if (!team) { await edit(`❌ Team not found.`, [[{ text: '⬅️ Teams', callback_data: 'tm:list' }]]); return; }

      const paused = team.paused ? '⏸️ Paused' : '▶️ Running';
      const lastReview = team.manager?.lastReviewAt
        ? new Date(team.manager.lastReviewAt).toLocaleString()
        : 'Never';
      const pendingCount = (team.pendingChanges || []).filter((c: any) => c.status === 'pending').length;
      const lastChat = (team.teamChat || []).slice(-1)[0];

      const header = [
        `${team.emoji || '🤖'} <b>${team.name}</b>`,
        `${team.description ? `<i>${team.description.slice(0, 120)}</i>` : ''}`,
        ``,
        `${paused}  •  ${(team.subagentIds || []).length} agents  •  ${pendingCount} pending changes`,
        `Last review: ${lastReview}`,
        lastChat ? `\nLast chat: <i>${String(lastChat.content).slice(0, 100)}</i>` : '',
      ].filter(s => s !== undefined).join('\n').trim();

      // Manager button + one button per subagent
      const mgrK = tmKey(undefined, teamId);
      const kb: any[][] = [
        [{ text: '🧠 Manager', callback_data: `tm:mgr:${mgrK}` }],
      ];
      const agents: string[] = team.subagentIds || [];
      for (const agId of agents) {
        const agK = tmKey(agId, teamId!);
        let agName = agId;
        try { const { getAgentById } = require('../config/config.js'); agName = getAgentById(agId)?.name || agId; } catch {}
        kb.push([{ text: `🤖 ${agName}`, callback_data: `tm:ag:${agK}` }]);
      }
      kb.push([{ text: '🗓 Team Schedules', callback_data: `tm:sched:${mgrK}` }]);
      const pendingChanges = (team.pendingChanges || []).filter((c: any) => c.status === 'pending').slice(0, 3);
      for (const ch of pendingChanges) {
        const ck = tmChangeKey(team.id, ch.id);
        kb.push([
          { text: `✅ ${String(ch.description || 'Approve').slice(0, 24)}`, callback_data: `tm:ap:${ck}` },
          { text: '❌ Reject', callback_data: `tm:rj:${ck}` },
        ]);
      }
      kb.push([{ text: '💬 Team Chat', callback_data: `tm:tchat:${mgrK}` }]);
      kb.push([{ text: '🔄 Trigger Review', callback_data: `tm:review:${mgrK}` }]);
      kb.push([{ text: '⬅️ Teams', callback_data: 'tm:list' }]);
      await edit(header, kb);
      return;
    }

    // ── tm:mgr:<k>  manager node ───────────────────────────────────
    if (data.startsWith('tm:mgr:')) {
      const k = data.slice('tm:mgr:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const team = this.teamDeps.getManagedTeam(ids.teamId!);
      if (!team) { await edit('❌ Team not found.', [[{ text: '⬅️ Teams', callback_data: 'tm:list' }]]); return; }

      const lastReview = team.manager?.lastReviewAt
        ? new Date(team.manager.lastReviewAt).toLocaleString()
        : 'Never';
      const autoApply = team.manager?.autoApplyLowRisk ? 'Yes' : 'No';
      const reviewTrigger = team.manager?.reviewTrigger || 'after_each_run';

      const txt = [
        `🧠 <b>Manager — ${team.name}</b>`,
        ``,
        `Review trigger: <code>${reviewTrigger}</code>`,
        `Auto-apply low risk: ${autoApply}`,
        `Last review: ${lastReview}`,
      ].join('\n');

      const backK = tmKey(undefined, ids.teamId);
      await edit(txt, [
        [
          { text: 'ℹ️ Info', callback_data: `tm:inf_mgr:${k}` },
          { text: '💬 Chat', callback_data: `tm:dochat_mgr:${k}` },
        ],
        [{ text: '⬅️ Team', callback_data: `tm:t:${backK}` }],
      ]);
      return;
    }

    // ── tm:ag:<k>  agent node ──────────────────────────────────────
    if (data.startsWith('tm:ag:')) {
      const k = data.slice('tm:ag:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const { agentId, teamId } = ids;

      let agName = agentId || 'Agent';
      let agEmoji = '🤖';
      let cronSchedule = 'none';
      let agModel = 'default';
      let agDesc = '';
      try {
        const { getAgentById } = require('../config/config.js');
        const ag = getAgentById(agentId!);
        if (ag) {
          agName = ag.name || agName;
          agEmoji = ag.emoji || '🤖';
          cronSchedule = ag.cronSchedule || 'none';
          agModel = ag.model || 'default';
          agDesc = ag.description || '';
        }
      } catch {}

      // Recent run status
      let lastRunLine = 'No runs yet';
      try {
        const { getAgentRunHistory } = require('../scheduler.js');
        const runs = getAgentRunHistory(agentId!, 1);
        if (runs && runs.length > 0) {
          const r = runs[0];
          const icon = r.success ? '✅' : '❌';
          const ts = new Date(r.startedAt).toLocaleString();
          lastRunLine = `${icon} ${ts} (${(r.durationMs / 1000).toFixed(1)}s)`;
        }
      } catch {}

      const txt = [
        `${agEmoji} <b>${agName}</b>`,
        agDesc ? `<i>${agDesc.slice(0, 120)}</i>` : '',
        ``,
        `Schedule: <code>${cronSchedule}</code>`,
        `Model: <code>${agModel}</code>`,
        `Last run: ${lastRunLine}`,
      ].filter(Boolean).join('\n');

      const teamK = tmKey(undefined, teamId);
      await edit(txt, [
        [
          { text: 'ℹ️ Info', callback_data: `tm:inf_ag:${k}` },
          { text: '⏱ Runs', callback_data: `tm:runs:${k}` },
        ],
        [{ text: '▶️ Dispatch', callback_data: `tm:dochat_ag:${k}` }],
        [{ text: '⬅️ Team', callback_data: `tm:t:${teamK}` }],
      ]);
      return;
    }

    // ── tm:inf_ag:<k>  agent info panel ───────────────────────────
    if (data.startsWith('tm:inf_ag:')) {
      const k = data.slice('tm:inf_ag:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const { agentId } = ids;

      // Show prompt with pagination button + workspace files button
      const { text: promptText } = readAgentPrompt(agentId!);
      const CHUNK = 800;
      const totalPages = Math.max(1, Math.ceil(promptText.length / CHUNK));
      const preview = promptText.slice(0, CHUNK)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const txt = `ℹ️ <b>Agent Prompt</b> (page 1/${totalPages})

<pre>${preview}</pre>`;

      const kb: any[][] = [];
      if (totalPages > 1) kb.push([{ text: '▶️ Page 2', callback_data: `tm:prompt:${k}:1` }]);
      kb.push([{ text: '⬅️ Back', callback_data: `tm:ag:${k}` }]);
      await edit(txt, kb);
      return;
    }

    // ── tm:inf_mgr:<k>  manager info panel ───────────────────────
    if (data.startsWith('tm:inf_mgr:')) {
      const k = data.slice('tm:inf_mgr:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const team = this.teamDeps.getManagedTeam(ids.teamId!);
      if (!team) { await edit('❌ Team not found.', []); return; }

      const prompt = (team.manager?.systemPrompt || '(no system prompt set)').slice(0, 1200);
      const CHUNK = 800;
      const totalPages = Math.max(1, Math.ceil(prompt.length / CHUNK));
      const preview = prompt.slice(0, CHUNK)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const txt = `ℹ️ <b>Manager System Prompt</b> (page 1/${totalPages})\n\n<pre>${preview}</pre>`;
      const kb: any[][] = [];
      if (totalPages > 1) kb.push([{ text: '▶️ Page 2', callback_data: `tm:mgrprompt:${k}:1` }]);
      kb.push([{ text: '⬅️ Back', callback_data: `tm:mgr:${k}` }]);
      await edit(txt, kb);
      return;
    }

    // ── tm:prompt:<k>:<p>  paginated agent prompt ──────────────────
    if (data.startsWith('tm:prompt:')) {
      const rest = data.slice('tm:prompt:'.length);
      const lastColon = rest.lastIndexOf(':');
      const k = rest.slice(0, lastColon);
      const page = parseInt(rest.slice(lastColon + 1), 10) || 0;
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }

      const { text: promptText } = readAgentPrompt(ids.agentId!);
      const CHUNK = 800;
      const totalPages = Math.max(1, Math.ceil(promptText.length / CHUNK));
      const safePage = Math.min(page, totalPages - 1);
      const preview = promptText.slice(safePage * CHUNK, (safePage + 1) * CHUNK)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const txt = `ℹ️ <b>Agent Prompt</b> (page ${safePage + 1}/${totalPages})\n\n<pre>${preview}</pre>`;
      const kb: any[][] = [];
      const pageRow: any[] = [];
      if (safePage > 0) pageRow.push({ text: '◀️ Prev', callback_data: `tm:prompt:${k}:${safePage - 1}` });
      if (safePage < totalPages - 1) pageRow.push({ text: '▶️ Next', callback_data: `tm:prompt:${k}:${safePage + 1}` });
      if (pageRow.length) kb.push(pageRow);
      kb.push([{ text: '⬅️ Back', callback_data: `tm:inf_ag:${k}` }]);
      await edit(txt, kb);
      return;
    }

    // ── tm:mgrprompt:<k>:<p>  paginated manager prompt ─────────────
    if (data.startsWith('tm:mgrprompt:')) {
      const rest = data.slice('tm:mgrprompt:'.length);
      const lastColon = rest.lastIndexOf(':');
      const k = rest.slice(0, lastColon);
      const page = parseInt(rest.slice(lastColon + 1), 10) || 0;
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const team = this.teamDeps.getManagedTeam(ids.teamId!);
      if (!team) { await edit('❌ Team not found.', []); return; }

      const prompt = team.manager?.systemPrompt || '';
      const CHUNK = 800;
      const totalPages = Math.max(1, Math.ceil(prompt.length / CHUNK));
      const safePage = Math.min(page, totalPages - 1);
      const preview = prompt.slice(safePage * CHUNK, (safePage + 1) * CHUNK)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const txt = `ℹ️ <b>Manager Prompt</b> (page ${safePage + 1}/${totalPages})\n\n<pre>${preview}</pre>`;
      const kb: any[][] = [];
      const pageRow: any[] = [];
      if (safePage > 0) pageRow.push({ text: '◀️ Prev', callback_data: `tm:mgrprompt:${k}:${safePage - 1}` });
      if (safePage < totalPages - 1) pageRow.push({ text: '▶️ Next', callback_data: `tm:mgrprompt:${k}:${safePage + 1}` });
      if (pageRow.length) kb.push(pageRow);
      kb.push([{ text: '⬅️ Back', callback_data: `tm:inf_mgr:${k}` }]);
      await edit(txt, kb);
      return;
    }

    // ── tm:runs:<k>  agent run log ──────────────────────────────────
    if (data.startsWith('tm:runs:')) {
      const k = data.slice('tm:runs:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const { agentId, teamId } = ids;

      let agName = agentId || 'Agent';
      try { const { getAgentById } = require('../config/config.js'); agName = getAgentById(agentId!)?.name || agName; } catch {}

      const lines: string[] = [];
      try {
        const { getAgentRunHistory } = require('../scheduler.js');
        const runs = getAgentRunHistory(agentId!, 8);
        if (!runs || runs.length === 0) {
          lines.push('No run history yet.');
        } else {
          for (const r of runs) {
            const icon = r.success ? '✅' : '❌';
            const ts = new Date(r.startedAt).toLocaleString();
            const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
            const trigger = r.trigger || 'manual';
            const preview = String(r.resultPreview || r.error || '').slice(0, 150);
            lines.push(`${icon} <b>${ts}</b> • ${dur} • <i>${trigger}</i>\n${preview ? preview : '(no output)'}`);
          }
        }
      } catch (err: any) {
        lines.push(`Error: ${err.message}`);
      }

      const teamK = tmKey(undefined, teamId);
      await edit(
        `⏱ <b>${agName}</b> — Recent Runs\n\n${lines.join('\n\n')}`,
        [[{ text: '⬅️ Back', callback_data: `tm:ag:${k}` }]],
      );
      return;
    }

    // ── tm:tchat:<k>  team chat log ───────────────────────────────
    if (data.startsWith('tm:tchat:')) {
      const k = data.slice('tm:tchat:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const team = this.teamDeps.getManagedTeam(ids.teamId!);
      if (!team) { await edit('❌ Team not found.', []); return; }

      const messages = (team.teamChat || []).slice(-8);
      const teamK = tmKey(undefined, ids.teamId);
      if (messages.length === 0) {
        await edit(`💬 <b>${team.name}</b> — No team chat yet.`, [[{ text: '⬅️ Team', callback_data: `tm:t:${teamK}` }]]);
        return;
      }
      const lines = messages.map((m: any) => {
        const icon = m.from === 'manager' ? '🧠' : m.from === 'user' ? '👤' : '⚙️';
        const ts = new Date(m.timestamp).toLocaleTimeString();
        return `${icon} <b>${m.fromName || m.from}</b> [${ts}]\n${String(m.content).slice(0, 200)}`;
      });
      await edit(
        `💬 <b>${team.name}</b> — Team Chat\n\n${lines.join('\n\n')}`,
        [[{ text: '⬅️ Team', callback_data: `tm:t:${teamK}` }]],
      );
      return;
    }

    // ── tm:review:<k>  trigger manual manager review ─────────────────
    if (data.startsWith('tm:review:')) {
      const k = data.slice('tm:review:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired. Use /teams again.', []); return; }
      const team = this.teamDeps.getManagedTeam(ids.teamId!);
      if (!team) { await edit('❌ Team not found.', [[{ text: '⬅️ Teams', callback_data: 'tm:list' }]]); return; }

      const backK = tmKey(undefined, ids.teamId);
      await edit(
        `🔄 <b>Running manager review for ${team.name}...</b>\n\n<i>Analyzing all agents and dispatching tasks as needed. Results will arrive as a new message.</i>`,
        [[{ text: '⬅️ Team', callback_data: `tm:t:${backK}` }]],
      );

      // Run in background — review can take 30–90s with multiple dispatch iterations
      ;(async () => {
        try {
          const { triggerManagerReview } = await import('../teams/team-manager-runner.js');
          const result = await triggerManagerReview(ids.teamId!, this.deps.broadcast);
          if (!result) {
            await this.sendMessage(chatId, `⚠️ Review skipped for <b>${team.name}</b> — team may be paused or review trigger is set to manual.`);
            return;
          }
          const lines = [
            `✅ <b>${team.name}</b> — Review complete`,
            ``,
            `📨 Dispatches executed: ${result.managerToolsExecuted}`,
            `📝 Changes proposed: ${result.changesProposed}`,
            `⚡ Auto-applied: ${result.changesAutoApplied}`,
          ];
          if (result.changesProposed > result.changesAutoApplied) {
            lines.push(`\n⚠️ ${result.changesProposed - result.changesAutoApplied} change(s) pending approval in the web UI.`);
          }
          await this.sendMessage(chatId, lines.join('\n'));
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Review failed for <b>${team?.name || 'team'}</b>: ${err.message}`);
        }
      })();
      return;
    }

    // ── tm:sched:<k>  show schedules for all team agents ────────────────
    if (data.startsWith('tm:sched:')) {
      const k = data.slice('tm:sched:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired. Use /teams again.', []); return; }
      const team = this.teamDeps.getManagedTeam(ids.teamId!);
      if (!team) { await edit('❌ Team not found.', [[{ text: '⬅️ Teams', callback_data: 'tm:list' }]]); return; }
      const lines: string[] = [];
      for (const agId of (team.subagentIds || [])) {
        try {
          const { getAgentById } = require('../config/config.js');
          const ag = getAgentById(agId);
          const agName = ag?.name || agId;
          const sched = String(ag?.cronSchedule || '').trim() || '(none)';
          lines.push(`• <b>${agName}</b> (<code>${agId}</code>)\n  cron: <code>${sched}</code>`);
        } catch {
          lines.push(`• <b>${agId}</b>\n  cron: <code>(unknown)</code>`);
        }
      }
      const backK = tmKey(undefined, team.id);
      await edit(
        `🗓 <b>${team.name}</b> — Agent Schedules\n\n${lines.length ? lines.join('\n\n') : '(no team agents)'}`,
        [[{ text: '⬅️ Team', callback_data: `tm:t:${backK}` }]],
      );
      return;
    }

    // ── tm:ap:<changeToken>  approve team change ────────────────────────
    if (data.startsWith('tm:ap:')) {
      const token = data.slice('tm:ap:'.length);
      const resolved = tmResolveChange(token);
      if (!resolved) { await edit('❌ Approval link expired.', []); return; }
      if (!this.teamDeps.applyTeamChange) {
        await edit('❌ Team change approval is unavailable in this build.', []);
        return;
      }
      const result = await this.teamDeps.applyTeamChange(resolved.teamId, resolved.changeId);
      await edit(
        result.success
          ? `✅ Change approved and applied.`
          : `❌ Could not apply change: ${result.error || 'unknown error'}`,
        [],
      );
      return;
    }

    // ── tm:rj:<changeToken>  reject team change ─────────────────────────
    if (data.startsWith('tm:rj:')) {
      const token = data.slice('tm:rj:'.length);
      const resolved = tmResolveChange(token);
      if (!resolved) { await edit('❌ Rejection link expired.', []); return; }
      if (!this.teamDeps.rejectTeamChange) {
        await edit('❌ Team change rejection is unavailable in this build.', []);
        return;
      }
      const result = this.teamDeps.rejectTeamChange(resolved.teamId, resolved.changeId);
      await edit(
        result.success
          ? `🗑️ Change rejected.`
          : `❌ Could not reject change: ${result.error || 'unknown error'}`,
        [],
      );
      return;
    }

    // ── tm:dochat_ag:<k>  set pending → dispatch to agent ─────────────
    if (data.startsWith('tm:dochat_ag:')) {
      const k = data.slice('tm:dochat_ag:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const { agentId, teamId } = ids;

      let agName = agentId || 'Agent';
      try { const { getAgentById } = require('../config/config.js'); agName = getAgentById(agentId!)?.name || agName; } catch {}
      let teamName = '';
      try { teamName = this.teamDeps.getManagedTeam(teamId!)?.name || ''; } catch {}

      this.pendingChat.set(userId, { type: 'agent', teamId: teamId!, agentId, agentName: agName, teamName });

      await edit(
        `📨 <b>Dispatch to ${agName}</b>\n\nType your task below and send it. I'll dispatch it directly to the agent and show you the result.\n\nSend /cancel to abort.`,
        [[{ text: '❌ Cancel', callback_data: `tm:cancel_chat:${userId}` }]],
      );
      return;
    }

    // ── tm:dochat_mgr:<k>  set pending → message to manager ─────────
    if (data.startsWith('tm:dochat_mgr:')) {
      const k = data.slice('tm:dochat_mgr:'.length);
      const ids = tmResolve(k);
      if (!ids) { await edit('❌ Session expired.', []); return; }
      const team = this.teamDeps.getManagedTeam(ids.teamId!);
      const teamName = team?.name || '';

      this.pendingChat.set(userId, { type: 'manager', teamId: ids.teamId!, teamName });

      await edit(
        `🧠 <b>Message to ${teamName} Manager</b>\n\nType your message and send it. The manager will process it using its normal review flow.\n\nSend /cancel to abort.`,
        [[{ text: '❌ Cancel', callback_data: `tm:cancel_chat:${userId}` }]],
      );
      return;
    }

    // ── tm:cancel_chat:<userId>  cancel pending chat ────────────────
    if (data.startsWith('tm:cancel_chat:')) {
      const uid = parseInt(data.slice('tm:cancel_chat:'.length), 10);
      this.pendingChat.delete(uid);
      await edit('❌ Chat cancelled. Use /teams to navigate again.', []);
      return;
    }
  }

  private async handleAgentsCallback(chatId: number, messageId: number, data: string, userId: number): Promise<void> {
    const edit = async (text: string, kb: any[][]) => {
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId, message_id: messageId,
          text: text.slice(0, 4000), parse_mode: 'HTML',
          reply_markup: { inline_keyboard: kb },
        });
      } catch (e: any) {
        if (!e.message?.includes('message is not modified')) console.error('[AG] edit error:', e.message);
      }
    };

    const listAgents = () => {
      const { getAgents } = require('../config/config.js');
      return (getAgents() || []).map((a: any) => ({
        id: String(a.id || ''),
        name: String(a.name || a.id || 'Agent'),
        model: String(a.model || '').trim(),
        cronSchedule: String(a.cronSchedule || '').trim(),
        description: String(a.description || '').trim(),
      }));
    };

    const readAgentPrompt = (agentId: string): string => {
      try {
        const { getAgentById, resolveAgentWorkspace } = require('../config/config.js');
        const ag = getAgentById(agentId);
        if (!ag) return '';
        const ws = resolveAgentWorkspace(ag);
        for (const name of ['system_prompt.md', 'HEARTBEAT.md', 'SOUL.md', 'AGENTS.md']) {
          const fp = path.join(ws, name);
          if (fs.existsSync(fp)) return fs.readFileSync(fp, 'utf-8');
        }
      } catch {}
      return '';
    };

    const upsertAgent = async (agentId: string, patch: Record<string, any>): Promise<{ ok: boolean; error?: string }> => {
      try {
        const { getConfig, getAgentById, ensureAgentWorkspace } = require('../config/config.js');
        const { reloadAgentSchedules } = require('../scheduler.js');
        const cm = getConfig();
        const raw = cm.getConfig() as any;
        const agents = Array.isArray(raw.agents) ? [...raw.agents] : [];
        const idx = agents.findIndex((a: any) => String(a?.id || '') === agentId);
        if (idx >= 0) {
          agents[idx] = { ...agents[idx], ...patch, id: agentId };
        } else {
          const existing = getAgentById(agentId);
          if (!existing) return { ok: false, error: `Agent "${agentId}" not found` };
          agents.push({ ...existing, ...patch, id: agentId });
        }
        cm.updateConfig({ agents } as any);
        const saved = (require('../config/config.js').getAgentById(agentId));
        if (saved) ensureAgentWorkspace(saved);
        reloadAgentSchedules();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message || err) };
      }
    };

    if (data === 'ag:list') {
      const agents = listAgents();
      if (agents.length === 0) { await edit('🤖 No agents configured.', []); return; }
      const rows = agents.map((a: any) => [{ text: `🤖 ${a.name}`, callback_data: `ag:v:${idKey(a.id)}` }]);
      await edit(`🤖 <b>Agents (${agents.length})</b>\nSelect an agent:`, rows);
      return;
    }

    if (data.startsWith('ag:v:')) {
      const agentId = idResolve(data.slice('ag:v:'.length));
      if (!agentId) { await edit('❌ Session expired. Use /agents again.', []); return; }
      const ag = listAgents().find((x: any) => x.id === agentId);
      if (!ag) { await edit('❌ Agent not found.', [[{ text: '⬅️ Agents', callback_data: 'ag:list' }]]); return; }
      const txt = [
        `🤖 <b>${ag.name}</b>`,
        `<code>${ag.id}</code>`,
        ag.description ? `<i>${ag.description.slice(0, 140)}</i>` : '',
        '',
        `Model: <code>${ag.model || '(default)'}</code>`,
        `Schedule: <code>${ag.cronSchedule || '(none)'}</code>`,
      ].filter(Boolean).join('\n');
      const k = idKey(ag.id);
      await edit(txt, [
        [{ text: '▶️ Run Instruction Prompt', callback_data: `ag:run:${k}` }],
        [{ text: '💬 Chat', callback_data: `ag:chat:${k}` }, { text: '📨 Dispatch', callback_data: `ag:disp:${k}` }],
        [{ text: '✏️ Prompt', callback_data: `ag:prompt:${k}` }, { text: '🧠 Model', callback_data: `ag:model:${k}` }],
        [{ text: '⬅️ Agents', callback_data: 'ag:list' }],
      ]);
      return;
    }

    if (data.startsWith('ag:chat:') || data.startsWith('ag:disp:')) {
      const agentId = idResolve(data.split(':')[2] || '');
      if (!agentId) { await edit('❌ Session expired. Use /agents again.', []); return; }
      const { getAgentById } = require('../config/config.js');
      const ag = getAgentById(agentId);
      this.pendingChat.set(userId, { type: 'agent_direct', agentId, agentName: ag?.name || agentId });
      await edit(
        `💬 <b>${ag?.name || agentId}</b>\nSend your message now. I will dispatch it as a one-off task.\n\nSend /cancel to abort.`,
        [[{ text: '❌ Cancel', callback_data: `tm:cancel_chat:${userId}` }]],
      );
      return;
    }

    if (data.startsWith('ag:run:')) {
      const agentId = idResolve(data.slice('ag:run:'.length));
      if (!agentId) { await edit('❌ Session expired. Use /agents again.', []); return; }
      if (!this.spawnAgentFn) { await edit('❌ Agent dispatch is not available.', []); return; }
      const prompt = readAgentPrompt(agentId).trim();
      if (!prompt) { await edit('❌ No instruction prompt found for this agent.', []); return; }
      const { getAgentById } = require('../config/config.js');
      const ag = getAgentById(agentId);
      await edit(`⏳ Running one-off task for <b>${ag?.name || agentId}</b>...`, []);
      try {
        const result = await this.spawnAgentFn({ agentId, task: prompt });
        const out = String(result?.output || result?.result || result?.text || 'Completed.');
        // Inline edit has 4000 char limit — use sendMessage for long results
        if (out.length > 3000) {
          await edit(`✅ <b>${ag?.name || agentId}</b> finished. Full response below:`, [[{ text: '⬅️ Agents', callback_data: 'ag:list' }]]);
          await this.sendMessage(chatId, `🤖 <b>${ag?.name || agentId}:</b>\n\n${out}`);
        } else {
          await edit(`✅ <b>${ag?.name || agentId}</b> finished.\n\n${out.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`, [[{ text: '⬅️ Agents', callback_data: 'ag:list' }]]);
        }
      } catch (err: any) {
        await edit(`❌ Run failed: ${String(err?.message || err)}`, [[{ text: '⬅️ Agents', callback_data: 'ag:list' }]]);
      }
      return;
    }

    if (data.startsWith('ag:prompt:')) {
      const agentId = idResolve(data.slice('ag:prompt:'.length));
      if (!agentId) { await edit('❌ Session expired. Use /agents again.', []); return; }
      const prompt = readAgentPrompt(agentId);
      const preview = (prompt || '(no prompt file found)').slice(0, 1200)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const k = idKey(agentId);
      await edit(`✏️ <b>Prompt Preview</b>\n\n<pre>${preview}</pre>`, [
        [{ text: '✏️ Replace Prompt', callback_data: `ag:editprompt:${k}` }],
        [{ text: '⬅️ Agent', callback_data: `ag:v:${k}` }],
      ]);
      return;
    }

    if (data.startsWith('ag:editprompt:')) {
      const agentId = idResolve(data.slice('ag:editprompt:'.length));
      if (!agentId) { await edit('❌ Session expired. Use /agents again.', []); return; }
      const { getAgentById } = require('../config/config.js');
      const ag = getAgentById(agentId);
      this.pendingChat.set(userId, { type: 'agent_edit_prompt', agentId, agentName: ag?.name || agentId });
      await edit(
        `✏️ Send the NEW full prompt for <b>${ag?.name || agentId}</b>.\nIt will replace system_prompt.md (or HEARTBEAT.md fallback).\n\nSend /cancel to abort.`,
        [[{ text: '❌ Cancel', callback_data: `tm:cancel_chat:${userId}` }]],
      );
      return;
    }

    if (data.startsWith('ag:model:')) {
      const agentId = idResolve(data.slice('ag:model:'.length));
      if (!agentId) { await edit('❌ Session expired. Use /agents again.', []); return; }
      const { getAgentById, getConfig } = require('../config/config.js');
      const { buildProviderById } = require('../providers/factory.js');
      const ag = getAgentById(agentId);
      const cfg = getConfig().getConfig() as any;
      const activeProvider = String(cfg?.llm?.provider || 'ollama');
      const current = String(ag?.model || `${activeProvider}/${cfg?.llm?.providers?.[activeProvider]?.model || ''}`).trim();
      let providerId = activeProvider;
      if (current.includes('/')) providerId = current.split('/')[0];
      const provider = buildProviderById(providerId);
      let models: string[] = [];
      try {
        models = (await provider.listModels()).map((m: any) => String(m?.name || '')).filter(Boolean).slice(0, 8);
      } catch {}
      const k = idKey(agentId);
      const kb: any[][] = [];
      if (models.length > 0) {
        for (const m of models) {
          kb.push([{ text: `• ${m}`, callback_data: `ag:pickmodel:${k}:${idKey(`${providerId}/${m}`)}` }]);
        }
      }
      kb.push([{ text: '✏️ Enter Model Manually', callback_data: `ag:editmodel:${k}` }]);
      kb.push([{ text: '⬅️ Agent', callback_data: `ag:v:${k}` }]);
      await edit(`🧠 <b>Model</b>\nCurrent: <code>${current || '(unset)'}</code>\nProvider: <code>${providerId}</code>`, kb);
      return;
    }

    if (data.startsWith('ag:pickmodel:')) {
      const rest = data.slice('ag:pickmodel:'.length);
      const parts = rest.split(':');
      if (parts.length !== 2) { await edit('❌ Invalid model selection.', []); return; }
      const agentId = idResolve(parts[0]);
      const model = idResolve(parts[1]);
      if (!agentId || !model) { await edit('❌ Session expired. Use /agents again.', []); return; }
      const r = await upsertAgent(agentId, { model });
      await edit(
        r.ok ? `✅ Model updated to <code>${model}</code>` : `❌ Could not update model: ${r.error || 'unknown error'}`,
        [[{ text: '⬅️ Agents', callback_data: 'ag:list' }]],
      );
      return;
    }

    if (data.startsWith('ag:editmodel:')) {
      const agentId = idResolve(data.slice('ag:editmodel:'.length));
      if (!agentId) { await edit('❌ Session expired. Use /agents again.', []); return; }
      const { getAgentById } = require('../config/config.js');
      const ag = getAgentById(agentId);
      this.pendingChat.set(userId, { type: 'agent_edit_model', agentId, agentName: ag?.name || agentId });
      await edit(
        `🧠 Send model as <code>provider/model</code> (example: <code>openai/gpt-4o</code> or <code>ollama/qwen3:8b</code>).`,
        [[{ text: '❌ Cancel', callback_data: `tm:cancel_chat:${userId}` }]],
      );
      return;
    }
  }

  private async handleBgTasksCallback(chatId: number, messageId: number, data: string, userId: number): Promise<void> {
    const edit = async (text: string, kb: any[][]) => {
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId, message_id: messageId,
          text: text.slice(0, 4000), parse_mode: 'HTML',
          reply_markup: { inline_keyboard: kb },
        });
      } catch (e: any) {
        if (!e.message?.includes('message is not modified')) console.error('[BG] edit error:', e.message);
      }
    };

    const loadModules = () => {
      const taskStore = require('../tasks/task-store.js');
      const { BackgroundTaskRunner } = require('../tasks/background-task-runner.js');
      return { taskStore, BackgroundTaskRunner };
    };

    if (data === 'bg:list') {
      const { taskStore } = loadModules();
      const statuses = ['queued', 'running', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'waiting_subagent'];
      const tasks = taskStore.listTaskSummaries({ status: statuses }).slice(0, 25);
      if (tasks.length === 0) { await edit('🧵 No queued/paused/stalled tasks.', []); return; }
      const rows = tasks.map((t: any) => [{
        text: `${t.status === 'running' ? '🔄' : t.status === 'queued' ? '⏳' : t.status === 'paused' ? '⏸️' : '⚠️'} ${String(t.title || '').slice(0, 28)}`,
        callback_data: `bg:v:${idKey(t.id)}`,
      }]);
      await edit(`🧵 <b>Background Tasks (${tasks.length})</b>`, rows);
      return;
    }

    if (data.startsWith('bg:v:')) {
      const taskId = idResolve(data.slice('bg:v:'.length));
      if (!taskId) { await edit('❌ Session expired. Use /tasks again.', []); return; }
      const { taskStore } = loadModules();
      const task = taskStore.loadTask(taskId);
      if (!task) { await edit('❌ Task not found.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]); return; }
      const currentStep = task.plan?.[task.currentStepIndex]?.description || '(none)';
      const txt = [
        `🧵 <b>${String(task.title || '').slice(0, 120)}</b>`,
        `<code>${task.id}</code>`,
        `Status: <code>${task.status}</code>`,
        `Step: ${task.currentStepIndex + 1}/${Math.max(1, (task.plan || []).length)}`,
        `Current: ${String(currentStep).slice(0, 120)}`,
      ].join('\n');
      const k = idKey(task.id);
      await edit(txt, [
        [{ text: '💬 Chat Agent', callback_data: `bg:chat:${k}` }],
        [{ text: '▶️ Resume', callback_data: `bg:resume:${k}` }, { text: '⏸ Pause', callback_data: `bg:pause:${k}` }],
        [{ text: '🛑 Cancel', callback_data: `bg:cancel:${k}` }, { text: '🗑 Delete', callback_data: `bg:del:${k}` }],
        [{ text: '⬅️ Tasks', callback_data: 'bg:list' }],
      ]);
      return;
    }

    if (data.startsWith('bg:chat:')) {
      const taskId = idResolve(data.slice('bg:chat:'.length));
      if (!taskId) { await edit('❌ Session expired. Use /tasks again.', []); return; }
      const { taskStore } = loadModules();
      const task = taskStore.loadTask(taskId);
      if (!task) { await edit('❌ Task not found.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]); return; }
      this.pendingChat.set(userId, { type: 'task_chat', taskId });
      await edit(
        `💬 Send your message for task <code>${taskId.slice(0, 8)}</code>.\nIf paused/stalled, I will resume it after injecting your message.`,
        [[{ text: '❌ Cancel', callback_data: `tm:cancel_chat:${userId}` }]],
      );
      return;
    }

    if (data.startsWith('bg:resume:')) {
      const taskId = idResolve(data.slice('bg:resume:'.length));
      if (!taskId) { await edit('❌ Session expired.', []); return; }
      const { taskStore, BackgroundTaskRunner } = loadModules();
      const task = taskStore.loadTask(taskId);
      if (!task) { await edit('❌ Task not found.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]); return; }
      if (task.status === 'running' && BackgroundTaskRunner.isRunning(task.id)) {
        await edit('ℹ️ Task is already running.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]);
        return;
      }
      if (task.status === 'running') BackgroundTaskRunner.forceRelease(task.id);
      taskStore.updateTaskStatus(task.id, 'queued');
      const runner = new BackgroundTaskRunner(task.id, this.deps.handleChat, this.deps.broadcast, this);
      runner.start().catch((err: any) => console.error('[BG] resume error:', err?.message || err));
      await edit('✅ Task resumed.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]);
      return;
    }

    if (data.startsWith('bg:pause:')) {
      const taskId = idResolve(data.slice('bg:pause:'.length));
      if (!taskId) { await edit('❌ Session expired.', []); return; }
      const { taskStore, BackgroundTaskRunner } = loadModules();
      const task = taskStore.updateTaskStatus(taskId, 'paused', { pauseReason: 'user_pause' });
      if (!task) { await edit('❌ Task not found.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]); return; }
      BackgroundTaskRunner.requestPause(taskId);
      await edit('⏸ Task pause requested.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]);
      return;
    }

    if (data.startsWith('bg:cancel:')) {
      const taskId = idResolve(data.slice('bg:cancel:'.length));
      if (!taskId) { await edit('❌ Session expired.', []); return; }
      const { taskStore, BackgroundTaskRunner } = loadModules();
      const task = taskStore.loadTask(taskId);
      if (!task) { await edit('❌ Task not found.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]); return; }
      BackgroundTaskRunner.cancelTask(taskId, 'Cancelled by user via Telegram.');
      await edit('🛑 Task cancelled.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]);
      return;
    }

    if (data.startsWith('bg:del:')) {
      const taskId = idResolve(data.slice('bg:del:'.length));
      if (!taskId) { await edit('❌ Session expired.', []); return; }
      const { taskStore, BackgroundTaskRunner } = loadModules();
      BackgroundTaskRunner.requestPause(taskId);
      const ok = taskStore.deleteTask(taskId);
      await edit(ok ? '🗑 Task deleted.' : '❌ Task not found.', [[{ text: '⬅️ Tasks', callback_data: 'bg:list' }]]);
      return;
    }
  }

  private async handleScheduleCallback(chatId: number, messageId: number, data: string, userId: number): Promise<void> {
    const edit = async (text: string, kb: any[][]) => {
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId, message_id: messageId,
          text: text.slice(0, 4000), parse_mode: 'HTML',
          reply_markup: { inline_keyboard: kb },
        });
      } catch (e: any) {
        if (!e.message?.includes('message is not modified')) console.error('[SC] edit error:', e.message);
      }
    };

    const listJobs = () => (this.teamDeps?.getCronJobs ? this.teamDeps.getCronJobs() : []);
    if (!this.teamDeps?.getCronJobs || !this.teamDeps?.runCronJobNow || !this.teamDeps?.updateCronJob || !this.teamDeps?.deleteCronJob) {
      await edit('⚠️ Schedule controls are not wired in this runtime.', []);
      return;
    }

    if (data === 'sc:list') {
      const jobs = listJobs();
      if (!jobs.length) { await edit('🗓 No schedules configured.', []); return; }
      const rows = jobs.slice(0, 30).map((j: any) => [{
        text: `${j.enabled ? '✅' : '⏸️'} ${String(j.name || j.id).slice(0, 28)}`,
        callback_data: `sc:v:${idKey(j.id)}`,
      }]);
      await edit(`🗓 <b>Schedules (${jobs.length})</b>`, rows);
      return;
    }

    if (data.startsWith('sc:v:')) {
      const jobId = idResolve(data.slice('sc:v:'.length));
      if (!jobId) { await edit('❌ Session expired. Use /schedule again.', []); return; }
      const job = listJobs().find((j: any) => j.id === jobId);
      if (!job) { await edit('❌ Schedule not found.', [[{ text: '⬅️ Schedules', callback_data: 'sc:list' }]]); return; }
      const { loadRunLog } = require('../scheduling/schedule-memory.js');
      const runs = loadRunLog(job.id).runs.slice(-3).reverse();
      const runLines = runs.length
        ? runs.map((r: any) => `${r.status === 'complete' ? '✅' : r.status === 'failed' ? '❌' : '⏳'} ${new Date(r.startedAt || r.scheduledAt).toLocaleString()} ${String(r.summary || '').slice(0, 80)}`).join('\n')
        : '(no recent runs)';
      const txt = [
        `🗓 <b>${String(job.name || '').slice(0, 120)}</b>`,
        `<code>${job.id}</code>`,
        `Status: <code>${job.status}</code>`,
        `Cron: <code>${String(job.schedule || '(none)')}</code>`,
        `Next: ${job.nextRun ? new Date(job.nextRun).toLocaleString() : '(none)'}`,
        `Last: ${job.lastRun ? new Date(job.lastRun).toLocaleString() : '(never)'}`,
        '',
        `<b>Recent Runs</b>`,
        runLines,
      ].join('\n');
      const k = idKey(job.id);
      await edit(txt, [
        [{ text: '▶️ Run Now', callback_data: `sc:run:${k}` }],
        [{ text: '✏️ Edit Prompt', callback_data: `sc:editp:${k}` }, { text: '🕒 Edit Cron', callback_data: `sc:editc:${k}` }],
        [{ text: '🗑 Delete', callback_data: `sc:del:${k}` }],
        [{ text: '⬅️ Schedules', callback_data: 'sc:list' }],
      ]);
      return;
    }

    if (data.startsWith('sc:run:')) {
      const jobId = idResolve(data.slice('sc:run:'.length));
      if (!jobId) { await edit('❌ Session expired.', []); return; }
      await this.teamDeps.runCronJobNow(jobId);
      await edit('✅ Schedule triggered manually.', [[{ text: '⬅️ Schedules', callback_data: 'sc:list' }]]);
      return;
    }

    if (data.startsWith('sc:del:')) {
      const jobId = idResolve(data.slice('sc:del:'.length));
      if (!jobId) { await edit('❌ Session expired.', []); return; }
      const ok = this.teamDeps.deleteCronJob(jobId);
      await edit(ok ? '🗑 Schedule deleted.' : '❌ Schedule not found.', [[{ text: '⬅️ Schedules', callback_data: 'sc:list' }]]);
      return;
    }

    if (data.startsWith('sc:editp:')) {
      const jobId = idResolve(data.slice('sc:editp:'.length));
      if (!jobId) { await edit('❌ Session expired.', []); return; }
      this.pendingChat.set(userId, { type: 'schedule_edit_prompt', scheduleId: jobId });
      await edit('✏️ Send the new schedule prompt text (replaces existing prompt).', [[{ text: '❌ Cancel', callback_data: `tm:cancel_chat:${userId}` }]]);
      return;
    }

    if (data.startsWith('sc:editc:')) {
      const jobId = idResolve(data.slice('sc:editc:'.length));
      if (!jobId) { await edit('❌ Session expired.', []); return; }
      this.pendingChat.set(userId, { type: 'schedule_edit_pattern', scheduleId: jobId });
      await edit('🕒 Send the new 5-field cron expression (example: <code>0 9 * * *</code>).', [[{ text: '❌ Cancel', callback_data: `tm:cancel_chat:${userId}` }]]);
      return;
    }
  }

  // ─── Message Handler ─────────────────────────────────────────────────────────

  private async handleReasoningCallback(chatId: number, messageId: number, data: string, _userId: number): Promise<void> {
    const edit = async (text: string, kb: any[][]) => {
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: text.slice(0, 4000),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: kb },
        });
      } catch (e: any) {
        if (!e.message?.includes('message is not modified')) console.error('[RG] edit error:', e.message);
      }
    };

    const refresh = async (note?: string) => {
      const payload = this.buildReasoningMenu();
      const text = note ? `${payload.text}\n\n<i>${escHtml(note)}</i>` : payload.text;
      await edit(text, payload.keyboard);
    };

    if (data === 'rg:list') {
      await refresh();
      return;
    }

    if (data.startsWith('rg:eff:')) {
      const parts = data.split(':');
      const provider = String(parts[2] || '').trim();
      const levelKey = String(parts[3] || '').trim();
      const activeProvider = this.getActiveReasoningContext().provider;
      if (!provider || provider !== activeProvider) {
        await refresh('The active provider changed, so this menu was refreshed.');
        return;
      }
      const options = TELEGRAM_REASONING_EFFORTS[provider] || [];
      const selected = options.find((opt) => opt.key === levelKey);
      if (!selected) {
        await refresh('That reasoning option is not valid for the active provider.');
        return;
      }
      await this.persistReasoningConfig(provider, { reasoning_effort: selected.value });
      await refresh();
      return;
    }

    if (data === 'rg:ath:on' || data === 'rg:ath:off') {
      const activeProvider = this.getActiveReasoningContext().provider;
      if (activeProvider !== 'anthropic') {
        await refresh('The active provider changed, so this menu was refreshed.');
        return;
      }
      await this.persistReasoningConfig('anthropic', { extended_thinking: data === 'rg:ath:on' });
      await refresh();
      return;
    }

    if (data.startsWith('rg:bud:')) {
      const activeProvider = this.getActiveReasoningContext().provider;
      if (activeProvider !== 'anthropic') {
        await refresh('The active provider changed, so this menu was refreshed.');
        return;
      }
      const budget = Number(data.slice('rg:bud:'.length));
      if (!Number.isFinite(budget) || budget < 1024) {
        await refresh('That Anthropic thinking budget is invalid.');
        return;
      }
      await this.persistReasoningConfig('anthropic', {
        extended_thinking: true,
        thinking_budget: Math.floor(budget),
      });
      await refresh();
      return;
    }

    await refresh('Unknown reasoning action. Use /reasoning to reopen the menu.');
  }

  private async handleModelCallback(chatId: number, messageId: number, data: string, _userId: number): Promise<void> {
    const cfg = getConfig().getConfig() as any;
    const edit = async (text: string, kb: any[][]) => {
      try {
        await this.apiCall('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: text.slice(0, 4000),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: kb },
        });
      } catch (e: any) {
        if (!e.message?.includes('message is not modified')) console.error('[MD] edit error:', e.message);
      }
    };

    const showProviderMenu = async () => {
      const latest = getConfig().getConfig() as any;
      const activeProvider = latest.llm?.provider || 'ollama';
      const primaryModel = latest.llm?.providers?.[activeProvider]?.model || 'unknown';
      let connections: Record<string, any> = {};
      try {
        const connPath = path.join(getConfig().getConfigDir(), 'connections.json');
        if (fs.existsSync(connPath)) connections = JSON.parse(fs.readFileSync(connPath, 'utf-8')) || {};
      } catch {}
      const providers = [
        { id: 'anthropic', name: '🤖 Anthropic Claude', connected: !!(connections.anthropic as any)?.connected },
        { id: 'openai', name: '🔴 OpenAI - API Key', connected: !!(connections.openai as any)?.connected },
        { id: 'openai_codex', name: '💬 OpenAI - Codex (OAuth)', connected: !!(connections.openai_codex as any)?.connected },
        { id: 'ollama', name: '🦙 Ollama (Local)', connected: true },
        { id: 'llama_cpp', name: '📚 llama.cpp (Local)', connected: true },
        { id: 'lm_studio', name: '🎨 LM Studio (Local)', connected: true },
      ];
      const rows = providers.map((p: any) => [{
        text: `${p.connected ? '✅' : '⭕'} ${p.name}${activeProvider === p.id ? ' <- active' : ''}`,
        callback_data: `md:prov:${p.id}`,
      }]);
      await edit(
        `🔄 <b>LLM Provider & Model</b>\n\n<b>Current:</b> ${activeProvider} / <code>${primaryModel}</code>\n\nSelect a provider:`,
        rows,
      );
    };

    if (data === 'md:list') {
      await showProviderMenu();
      return;
    }

    if (data.startsWith('md:prov:')) {
      const provider = data.slice('md:prov:'.length);
      const modelsByProvider: Record<string, string[]> = {
        anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
        openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
        openai_codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex'],
        ollama: [],
        llama_cpp: [],
        lm_studio: [],
      };
      if (provider === 'ollama') {
        try {
          const endpoint = cfg.llm?.providers?.ollama?.endpoint || cfg.ollama?.endpoint || 'http://localhost:11434';
          const resp = await fetch(`${endpoint}/api/tags`);
          if (resp.ok) {
            const d: any = await resp.json();
            modelsByProvider.ollama = (d.models || []).map((m: any) => m.name);
          }
        } catch {}
      } else if (provider === 'llama_cpp') {
        try {
          const endpoint = cfg.llm?.providers?.llama_cpp?.endpoint || 'http://localhost:8080';
          const resp = await fetch(`${endpoint}/v1/models`);
          if (resp.ok) {
            const d: any = await resp.json();
            modelsByProvider.llama_cpp = (d.data || []).map((m: any) => m.id);
          }
        } catch {}
      } else if (provider === 'lm_studio') {
        try {
          const endpoint = cfg.llm?.providers?.lm_studio?.endpoint || 'http://localhost:1234';
          const resp = await fetch(`${endpoint}/v1/models`);
          if (resp.ok) {
            const d: any = await resp.json();
            modelsByProvider.lm_studio = (d.data || []).map((m: any) => m.id);
          }
        } catch {}
      }
      const models = (modelsByProvider[provider] || []).slice(0, 20);
      if (models.length === 0) {
        await edit(`❌ No models available for <b>${provider}</b>.`, [[{ text: '⬅️ Back', callback_data: 'md:list' }]]);
        return;
      }
      const rows = models.map((m: string) => [{ text: m, callback_data: `md:sel:${provider}:${m}` }]);
      rows.push([{ text: '⬅️ Back', callback_data: 'md:list' }]);
      await edit(`<b>Select Model - ${provider}</b>`, rows);
      return;
    }

    if (data.startsWith('md:sel:')) {
      const parts = data.slice('md:sel:'.length).split(':');
      const provider = parts[0];
      const model = parts.slice(1).join(':');
      await edit(
        `<b>Confirm Model Selection</b>\n\n<b>Provider:</b> <code>${provider}</code>\n<b>Model:</b> <code>${model}</code>`,
        [
          [{ text: '✅ Confirm', callback_data: `md:conf:${provider}:${model}` }],
          [{ text: '🧪 Test Connection', callback_data: `md:test:${provider}:${model}` }],
          [{ text: '⬅️ Back', callback_data: `md:prov:${provider}` }],
        ],
      );
      return;
    }

    if (data.startsWith('md:test:')) {
      const parts = data.slice('md:test:'.length).split(':');
      const provider = parts[0];
      const model = parts.slice(1).join(':');
      await edit(
        `🧪 <b>Testing Connection...</b>\n\nProvider: <code>${provider}</code>\nModel: <code>${model}</code>`,
        [[{ text: '⏳ Testing...', callback_data: 'noop' }]],
      );
      try {
        let isConnected = false;
        if (provider === 'ollama') {
          const endpoint = cfg.llm?.providers?.ollama?.endpoint || cfg.ollama?.endpoint || 'http://localhost:11434';
          const resp = await fetch(`${endpoint}/api/tags`).catch(() => null);
          isConnected = !!resp?.ok;
        } else if (provider === 'llama_cpp') {
          const endpoint = cfg.llm?.providers?.llama_cpp?.endpoint || 'http://localhost:8080';
          const resp = await fetch(`${endpoint}/v1/models`).catch(() => null);
          isConnected = !!resp?.ok;
        } else if (provider === 'lm_studio') {
          const endpoint = cfg.llm?.providers?.lm_studio?.endpoint || 'http://localhost:1234';
          const resp = await fetch(`${endpoint}/v1/models`).catch(() => null);
          isConnected = !!resp?.ok;
        } else {
          const { buildProviderById } = require('../../providers/factory.js');
          const p = buildProviderById(provider);
          isConnected = !!(await p.testConnection());
        }

        if (isConnected) {
          await edit(
            `✅ <b>Connection Test Passed</b>\n\nThe <code>${provider}</code> provider is reachable.`,
            [
              [{ text: '💾 Save This Model', callback_data: `md:conf:${provider}:${model}` }],
              [{ text: '⬅️ Back', callback_data: `md:prov:${provider}` }],
            ],
          );
        } else {
          await edit(
            `❌ <b>Connection Test Failed</b>\n\nCould not reach <code>${provider}</code>.`,
            [[{ text: '⬅️ Back', callback_data: `md:prov:${provider}` }]],
          );
        }
      } catch (err: any) {
        await edit(
          `❌ <b>Connection Error</b>\n\n<code>${String(err?.message || err)}</code>`,
          [[{ text: '⬅️ Back', callback_data: `md:prov:${provider}` }]],
        );
      }
      return;
    }

    if (data.startsWith('md:conf:')) {
      const parts = data.slice('md:conf:'.length).split(':');
      const provider = parts[0];
      const model = parts.slice(1).join(':');
      try {
        const cm = getConfig();
        const current = cm.getConfig() as any;
        const currentLlm = current.llm || {};
        const currentProviders = currentLlm.providers || {};
        cm.updateConfig({
          llm: {
            ...currentLlm,
            provider,
            providers: {
              ...currentProviders,
              [provider]: { ...(currentProviders[provider] || {}), model },
            },
          },
          models: {
            ...(current.models || {}),
            primary: model,
            roles: { ...(current.models?.roles || {}) },
          },
        } as any);
        try {
          const { resetProvider } = require('../../providers/factory.js');
          if (typeof resetProvider === 'function') resetProvider();
        } catch {}
        await edit(
          `✅ <b>Model Updated</b>\n\n<b>Provider:</b> <code>${provider}</code>\n<b>Model:</b> <code>${model}</code>`,
          [[{ text: '⬅️ Back to Models', callback_data: 'md:list' }]],
        );
      } catch (err: any) {
        await edit(
          `❌ Error saving model: ${String(err?.message || err)}`,
          [[{ text: '⬅️ Back', callback_data: `md:prov:${provider}` }]],
        );
      }
      return;
    }

    await edit('❌ Unknown model action. Use /models to start over.', [[{ text: '🔄 /models', callback_data: 'noop' }]]);
  }

  /** Download the largest available photo size from Telegram as base64. */
  private async downloadTelegramPhoto(fileId: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
      const fileInfo = await this.apiCall('getFile', { file_id: fileId });
      const filePath: string = fileInfo.file_path;
      const url = `https://api.telegram.org/file/bot${this.config.botToken}/${filePath}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const buf = Buffer.from(await resp.arrayBuffer());
      const ext = (filePath.split('.').pop() || 'jpg').toLowerCase();
      const mimeType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : `image/${ext}`;
      return { base64: buf.toString('base64'), mimeType };
    } catch (err: any) {
      console.error('[Telegram] Failed to download photo:', err.message);
      return null;
    }
  }

  /** Download a Telegram document only if it is an image. */
  private async downloadTelegramImageDocument(
    fileId: string,
    hintedMimeType?: string,
  ): Promise<{ base64: string; mimeType: string } | null> {
    try {
      const fileInfo = await this.apiCall('getFile', { file_id: fileId });
      const filePath: string = String(fileInfo?.file_path || '');
      if (!filePath) return null;

      const ext = (filePath.split('.').pop() || '').toLowerCase();
      const inferredMimeType = ext
        ? ((ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : `image/${ext}`)
        : '';
      const mimeType = String(hintedMimeType || inferredMimeType || '').toLowerCase();
      if (!mimeType.startsWith('image/')) return null;

      const url = `https://api.telegram.org/file/bot${this.config.botToken}/${filePath}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const buf = Buffer.from(await resp.arrayBuffer());
      return { base64: buf.toString('base64'), mimeType };
    } catch (err: any) {
      console.error('[Telegram] Failed to download image document:', err.message);
      return null;
    }
  }

  private sanitizeTelegramFilename(input: string, fallbackStem: string, fallbackExt: string = ''): string {
    const raw = path.basename(String(input || '').trim());
    const cleaned = raw
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const fallback = `${fallbackStem}${fallbackExt || ''}`;
    const candidate = cleaned || fallback;
    return candidate.slice(0, 120) || fallback;
  }

  private extensionFromMimeType(mimeType?: string): string {
    const normalized = String(mimeType || '').trim().toLowerCase();
    switch (normalized) {
      case 'video/mp4': return '.mp4';
      case 'video/quicktime': return '.mov';
      case 'video/webm': return '.webm';
      case 'video/x-matroska': return '.mkv';
      case 'video/x-msvideo': return '.avi';
      case 'video/mpeg': return '.mpeg';
      case 'video/3gpp': return '.3gp';
      case 'video/x-ms-wmv': return '.wmv';
      case 'image/png': return '.png';
      case 'image/jpeg': return '.jpg';
      case 'image/webp': return '.webp';
      case 'image/gif': return '.gif';
      default: return '';
    }
  }

  private inferMimeTypeFromFilePath(filePath: string, hintedMimeType?: string): string {
    const hinted = String(hintedMimeType || '').trim().toLowerCase();
    if (hinted) return hinted;
    switch (path.extname(String(filePath || '')).toLowerCase()) {
      case '.mp4': return 'video/mp4';
      case '.mov': return 'video/quicktime';
      case '.webm': return 'video/webm';
      case '.mkv': return 'video/x-matroska';
      case '.avi': return 'video/x-msvideo';
      case '.mpeg':
      case '.mpg': return 'video/mpeg';
      case '.3gp': return 'video/3gpp';
      case '.wmv': return 'video/x-ms-wmv';
      case '.gif': return 'image/gif';
      default: return 'application/octet-stream';
    }
  }

  private isVideoMimeType(mimeType?: string): boolean {
    const normalized = String(mimeType || '').trim().toLowerCase();
    return normalized.startsWith('video/') || normalized === 'image/gif';
  }

  private isTelegramVideoDocument(doc?: NonNullable<TelegramUpdate['message']>['document']): boolean {
    if (!doc?.file_id) return false;
    if (this.isVideoMimeType(doc.mime_type)) return true;
    const ext = path.extname(String(doc.file_name || '')).toLowerCase();
    return ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mpeg', '.mpg', '.wmv', '.3gp', '.gif'].includes(ext);
  }

  private getWorkspaceRootForSession(sessionId?: string): string {
    const hinted = sessionId && typeof this.deps.getWorkspace === 'function'
      ? String(this.deps.getWorkspace(sessionId) || '').trim()
      : '';
    const candidate = path.resolve(hinted || this.workspaceRoot);
    return fs.existsSync(candidate) ? candidate : path.resolve(this.workspaceRoot);
  }

  private buildUniqueWorkspacePath(targetDir: string, fileName: string): string {
    const ext = path.extname(fileName);
    const stem = path.basename(fileName, ext);
    let candidate = path.join(targetDir, fileName);
    let counter = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(targetDir, `${stem}-${counter}${ext}`);
      counter += 1;
    }
    return candidate;
  }

  private async downloadTelegramFileToWorkspace(
    fileId: string,
    options?: {
      sessionId?: string;
      fileName?: string;
      hintedMimeType?: string;
      fallbackStem?: string;
      subdir?: string;
    },
  ): Promise<{ absPath: string; relPath: string; fileName: string; mimeType: string; sizeBytes: number } | null> {
    try {
      const fileInfo = await this.apiCall('getFile', { file_id: fileId });
      const telegramFilePath = String(fileInfo?.file_path || '').trim();
      if (!telegramFilePath) return null;

      const workspaceRoot = this.getWorkspaceRootForSession(options?.sessionId);
      const hintedMimeType = String(options?.hintedMimeType || '').trim().toLowerCase();
      const inferredExt = path.extname(telegramFilePath).toLowerCase() || this.extensionFromMimeType(hintedMimeType);
      const requestedName = String(options?.fileName || '').trim()
        || path.basename(telegramFilePath)
        || `${String(options?.fallbackStem || 'telegram-file').trim() || 'telegram-file'}${inferredExt || ''}`;
      const safeName = this.sanitizeTelegramFilename(
        requestedName,
        String(options?.fallbackStem || 'telegram-file').trim() || 'telegram-file',
        inferredExt,
      );
      const dayStamp = new Date().toISOString().slice(0, 10);
      const targetDir = path.join(workspaceRoot, options?.subdir || 'uploads', 'telegram', dayStamp);
      fs.mkdirSync(targetDir, { recursive: true });

      const url = `https://api.telegram.org/file/bot${this.config.botToken}/${telegramFilePath}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const buf = Buffer.from(await resp.arrayBuffer());
      const targetPath = this.buildUniqueWorkspacePath(targetDir, safeName);
      fs.writeFileSync(targetPath, buf);

      return {
        absPath: targetPath,
        relPath: path.relative(workspaceRoot, targetPath).replace(/\\/g, '/'),
        fileName: path.basename(targetPath),
        mimeType: this.inferMimeTypeFromFilePath(telegramFilePath, hintedMimeType),
        sizeBytes: buf.length,
      };
    } catch (err: any) {
      console.error('[Telegram] Failed to download file to workspace:', err.message);
      return null;
    }
  }

  private saveTelegramImageAttachmentToWorkspace(
    attachment: { base64: string; mimeType: string; name: string },
    options?: { sessionId?: string; fallbackStem?: string },
  ): { absPath: string; relPath: string; fileName: string; mimeType: string; sizeBytes: number } | null {
    try {
      const workspaceRoot = this.getWorkspaceRootForSession(options?.sessionId);
      const ext = path.extname(String(attachment.name || ''))
        || this.extensionFromMimeType(attachment.mimeType)
        || '.png';
      const safeName = this.sanitizeTelegramFilename(
        attachment.name,
        String(options?.fallbackStem || 'telegram-image').trim() || 'telegram-image',
        ext,
      );
      const dayStamp = new Date().toISOString().slice(0, 10);
      const targetDir = path.join(workspaceRoot, 'uploads', 'telegram', dayStamp);
      fs.mkdirSync(targetDir, { recursive: true });

      const targetPath = this.buildUniqueWorkspacePath(targetDir, safeName);
      const buf = Buffer.from(String(attachment.base64 || '').replace(/^data:.*?;base64,/, ''), 'base64');
      fs.writeFileSync(targetPath, buf);

      return {
        absPath: targetPath,
        relPath: path.relative(workspaceRoot, targetPath).replace(/\\/g, '/'),
        fileName: path.basename(targetPath),
        mimeType: attachment.mimeType,
        sizeBytes: buf.length,
      };
    } catch (err: any) {
      console.error('[Telegram] Failed to save image attachment to workspace:', err.message);
      return null;
    }
  }

  private async handleIncomingMessage(msg: TelegramUpdate['message']): Promise<void> {
    if (!msg || (!msg.text && !msg.caption && !msg.photo && !msg.document && !msg.video && !msg.animation && !msg.video_note)) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    // For photo messages, use the caption as text (or empty string so AI still fires)
    const text = (msg.text || msg.caption || '').trim();
    const commandName = getTelegramCommandName(text, this.botInfo?.username);
    const userName = msg.from.first_name || msg.from.username || 'Unknown';

    console.log(`[Telegram] Message from ${userName} (${userId}): ${text.slice(0, 80)}`);

    // Check allowlist
    if (this.config.allowedUserIds.length > 0 && !this.config.allowedUserIds.includes(userId)) {
      console.log(`[Telegram] Rejected message from unauthorized user ${userId}`);
      await this.sendMessage(chatId, '🔥 Unauthorized. Your Telegram user ID is not in the allowlist.\n\nYour ID: <code>' + userId + '</code>');
      return;
    }

    // ── /cancel — clear pending chat ─────────────────────────────────────────
    if (commandName === 'cancel') {
      if (this.pendingChat.has(userId)) {
        this.pendingChat.delete(userId);
        await this.sendMessage(chatId, '❌ Cancelled. Back to normal chat.');
      } else {
        await this.sendMessage(chatId, 'Nothing to cancel.');
      }
      return;
    }

    // ── Pending chat intercept (one-shot after tapping Chat/Dispatch in /teams) ──
    const pending = this.pendingChat.get(userId);
    if (pending) {
      this.pendingChat.delete(userId); // clear immediately — one-shot
      await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

      if (pending.type === 'manager') {
        // Route to manager conversation flow
        await this.sendMessage(chatId, `🧠 Sending to <b>${pending.teamName || 'manager'}</b>...`);
        try {
          await this.teamDeps!.handleManagerConversation(pending.teamId!, text, this.deps.broadcast);
          const fresh = this.teamDeps!.getManagedTeam(pending.teamId!);
          const last = (fresh?.teamChat || []).filter((m: any) => m.from === 'manager').slice(-1)[0];
          await this.sendMessage(chatId,
            last
              ? `🧠 <b>${pending.teamName || 'Manager'}:</b>\n\n${String(last.content)}`
              : '✅ Manager processed your message.'
          );
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Manager error: ${err.message}`);
        }
      } else if (pending.type === 'agent') {
        // Manual dispatch to subagent
        await this.sendMessage(chatId, `▶️ Dispatching to <b>${pending.agentName || pending.agentId}</b>...`);
        try {
          if (this.spawnAgentFn) {
            const result = await this.spawnAgentFn({ agentId: pending.agentId!, task: text });
            const output = result?.output || result?.result || result?.text || '✅ Agent completed task.';
            await this.sendMessage(chatId, `🤖 <b>${pending.agentName}:</b>\n\n${String(output)}`);
          } else {
            // Fallback: route through manager with explicit dispatch instruction
            await this.teamDeps!.handleManagerConversation(
              pending.teamId!,
              `Please dispatch the following task directly to agent ${pending.agentId} (${pending.agentName}) right now: ${text}`,
              this.deps.broadcast
            );
            const fresh = this.teamDeps!.getManagedTeam(pending.teamId!);
            const last = (fresh?.teamChat || []).slice(-1)[0];
            await this.sendMessage(chatId,
              last
                ? `✅ Dispatched. Manager says:\n\n${last.content}`
                : '✅ Dispatch sent.'
            );
          }
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Dispatch error: ${err.message}`);
        }
      } else if (pending.type === 'agent_direct') {
        await this.sendMessage(chatId, `▶️ Dispatching to <b>${pending.agentName || pending.agentId}</b>...`);
        try {
          if (!this.spawnAgentFn || !pending.agentId) {
            await this.sendMessage(chatId, '❌ Agent dispatch is unavailable.');
            return;
          }
          const result = await this.spawnAgentFn({ agentId: pending.agentId, task: text });
          const output = result?.output || result?.result || result?.text || '✅ Agent completed task.';
          await this.sendMessage(chatId, `🤖 <b>${pending.agentName || pending.agentId}:</b>\n\n${String(output)}`);
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Dispatch error: ${err.message}`);
        }
      } else if (pending.type === 'agent_edit_prompt') {
        try {
          const { getAgentById, resolveAgentWorkspace } = require('../config/config.js');
          const ag = getAgentById(pending.agentId!);
          if (!ag) {
            await this.sendMessage(chatId, `❌ Agent not found: <code>${pending.agentId}</code>`);
            return;
          }
          const ws = resolveAgentWorkspace(ag);
          const target = fs.existsSync(path.join(ws, 'system_prompt.md'))
            ? path.join(ws, 'system_prompt.md')
            : path.join(ws, 'HEARTBEAT.md');
          fs.writeFileSync(target, text, 'utf-8');
          await this.sendMessage(chatId, `✅ Prompt updated for <b>${ag.name || ag.id}</b>.\n<code>${target}</code>`);
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Prompt update failed: ${err.message}`);
        }
      } else if (pending.type === 'agent_edit_model') {
        try {
          const model = String(text || '').trim();
          if (!model) {
            await this.sendMessage(chatId, '❌ Model cannot be empty.');
            return;
          }
          const { getConfig, getAgentById } = require('../config/config.js');
          const { reloadAgentSchedules } = require('../scheduler.js');
          const cm = getConfig();
          const raw = cm.getConfig() as any;
          const agents = Array.isArray(raw.agents) ? [...raw.agents] : [];
          const idx = agents.findIndex((a: any) => String(a?.id || '') === String(pending.agentId || ''));
          if (idx >= 0) {
            agents[idx] = { ...agents[idx], model, id: pending.agentId };
          } else {
            const existing = getAgentById(pending.agentId);
            if (!existing) {
              await this.sendMessage(chatId, `❌ Agent not found: <code>${pending.agentId}</code>`);
              return;
            }
            agents.push({ ...existing, model, id: pending.agentId });
          }
          cm.updateConfig({ agents } as any);
          reloadAgentSchedules();
          await this.sendMessage(chatId, `✅ Model updated to <code>${model}</code> for <b>${pending.agentName || pending.agentId}</b>.`);
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Model update failed: ${err.message}`);
        }
      } else if (pending.type === 'task_chat') {
        try {
          const { loadTask, appendJournal, updateTaskStatus } = require('../tasks/task-store.js');
          const { addMessage } = require('../session.js');
          const { BackgroundTaskRunner } = require('../tasks/background-task-runner.js');
          const task = loadTask(pending.taskId);
          if (!task) {
            await this.sendMessage(chatId, `❌ Task not found: <code>${pending.taskId}</code>`);
            return;
          }
          const taskSessionId = `task_${task.id}`;
          addMessage(taskSessionId, { role: 'user', content: text, timestamp: Date.now() });
          appendJournal(task.id, { type: 'status_push', content: `User replied via Telegram: ${text.slice(0, 200)}` });
          const needsResume = ['needs_assistance', 'paused', 'stalled'].includes(String(task.status || ''));
          if (needsResume) {
            updateTaskStatus(task.id, 'queued');
            const runner = new BackgroundTaskRunner(task.id, this.deps.handleChat, this.deps.broadcast, this);
            runner.start().catch((err: any) => console.error(`[TelegramTaskChat] ${task.id}:`, err?.message || err));
          }
          await this.sendMessage(chatId, needsResume ? '✅ Message injected and task resumed.' : '✅ Message injected into active task session.');
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Task chat failed: ${err.message}`);
        }
      } else if (pending.type === 'schedule_edit_prompt') {
        try {
          if (!this.teamDeps?.updateCronJob) {
            await this.sendMessage(chatId, '❌ Schedule update unavailable.');
            return;
          }
          const job = this.teamDeps.updateCronJob(pending.scheduleId!, { prompt: text });
          await this.sendMessage(chatId, job ? `✅ Schedule prompt updated for <code>${pending.scheduleId}</code>.` : `❌ Schedule not found.`);
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Schedule update failed: ${err.message}`);
        }
      } else if (pending.type === 'schedule_edit_pattern') {
        try {
          if (!this.teamDeps?.updateCronJob) {
            await this.sendMessage(chatId, '❌ Schedule update unavailable.');
            return;
          }
          const cronExpr = String(text || '').trim();
          const job = this.teamDeps.updateCronJob(pending.scheduleId!, { schedule: cronExpr });
          await this.sendMessage(chatId, job ? `✅ Schedule cron updated to <code>${cronExpr}</code>.` : `❌ Schedule not found or invalid.`);
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Schedule update failed: ${err.message}`);
        }
      }
      // After one-shot, return to normal — do NOT fall through to handleChat
      return;
    }

    // ── /browse command ────────────────────────────────────────────────────────
    if (text.startsWith('/browse')) {
      const arg = text.slice('/browse'.length).trim();
      const targetPath = arg ? this.resolveWorkspacePath(arg) : path.resolve(this.workspaceRoot);
      const payload = this.buildDirectoryKeyboard(targetPath);
      if (!payload) {
        await this.sendMessage(chatId, `❌ Cannot open path: <code>${arg || '.'}</code>`);
        return;
      }
      await this.sendBrowserView(chatId, payload);
      return;
    }

    // ── /teams command — deep inline keyboard team browser ───────────────────
    if (text === '/teams' || text === '/teams ') {
      if (!this.teamDeps) {
        await this.sendMessage(chatId, '⚠️ Team management not available yet — try again in a moment.');
        return;
      }
      const teams = this.teamDeps.listManagedTeams();
      if (teams.length === 0) {
        await this.sendMessage(chatId, '🤖 <b>Teams</b>\n\nNo teams configured yet. Create one in the web UI.');
        return;
      }
      const rows = teams.map((t: any) => [{
        text: `${t.emoji || '🤖'} ${t.name}  (${t.subagentIds?.length || 0} agents)`,
        callback_data: `tm:t:${tmKey(undefined, t.id)}`,
      }]);
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: `🤖 <b>Your Teams (${teams.length})</b>\n\nSelect a team to explore:`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    // ── /agents command — browse agents, dispatch, edit prompt/model ──────────
    if (text === '/agents' || text === '/agents ') {
      try {
        const { getAgents } = require('../config/config.js');
        const agents = getAgents() || [];
        if (agents.length === 0) {
          await this.sendMessage(chatId, '🤖 No agents configured.');
          return;
        }
        const rows = agents.slice(0, 30).map((a: any) => [{
          text: `🤖 ${String(a?.name || a?.id || 'Agent')}`,
          callback_data: `ag:v:${idKey(String(a?.id || ''))}`,
        }]);
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: `🤖 <b>Agents (${agents.length})</b>\n\nSelect an agent:`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        });
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Could not load agents: ${err.message}`);
      }
      return;
    }

    // ── /tasks command — list queued/paused/stalled tasks ─────────────────────
    if (text === '/tasks' || text === '/tasks ') {
      try {
        const { listTaskSummaries } = require('../tasks/task-store.js');
        const statuses = ['queued', 'running', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'waiting_subagent'];
        const tasks = listTaskSummaries({ status: statuses }).slice(0, 25);
        if (tasks.length === 0) {
          await this.sendMessage(chatId, '🧵 No queued/paused/stalled tasks.');
          return;
        }
        const rows = tasks.map((t: any) => [{
          text: `${t.status === 'running' ? '🔄' : t.status === 'queued' ? '⏳' : t.status === 'paused' ? '⏸️' : '⚠️'} ${String(t.title || '').slice(0, 28)}`,
          callback_data: `bg:v:${idKey(String(t.id || ''))}`,
        }]);
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: `🧵 <b>Background Tasks (${tasks.length})</b>`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        });
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Could not load tasks: ${err.message}`);
      }
      return;
    }

    // ── /schedule command — list schedules and run/modify/delete ──────────────
    if (text === '/schedule' || text === '/schedules') {
      if (!this.teamDeps?.getCronJobs) {
        await this.sendMessage(chatId, '⚠️ Schedule controls are not wired in this runtime.');
        return;
      }
      const jobs = this.teamDeps.getCronJobs();
      if (!jobs || jobs.length === 0) {
        await this.sendMessage(chatId, '🗓 No schedules configured.');
        return;
      }
      const rows = jobs.slice(0, 30).map((j: any) => [{
        text: `${j.enabled ? '✅' : '⏸️'} ${String(j.name || j.id).slice(0, 28)}`,
        callback_data: `sc:v:${idKey(String(j.id || ''))}`,
      }]);
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: `🗓 <b>Schedules (${jobs.length})</b>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    // ── /models + /reasoning commands ─────────────────────────────────────────
    if (text === '/reasoning' || text === '/reasoning ') {
      try {
        const payload = this.buildReasoningMenu();
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: payload.text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: payload.keyboard },
        });
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Failed to load reasoning controls: ${String(err?.message || err)}`);
      }
      return;
    }

    if (text === '/models' || text === '/models ' || text === '/model' || text === '/model ') {
      try {
        const cfg = getConfig().getConfig() as any;
        const activeProvider = cfg.llm?.provider || 'ollama';
        const primaryModel = cfg.llm?.providers?.[activeProvider]?.model || 'unknown';
        let connections: Record<string, any> = {};
        try {
          const connPath = path.join(getConfig().getConfigDir(), 'connections.json');
          if (fs.existsSync(connPath)) connections = JSON.parse(fs.readFileSync(connPath, 'utf-8')) || {};
        } catch {}
        const providers = [
          { id: 'anthropic', name: '🤖 Anthropic Claude', connected: !!(connections.anthropic as any)?.connected },
          { id: 'openai', name: '🔴 OpenAI - API Key', connected: !!(connections.openai as any)?.connected },
          { id: 'openai_codex', name: '💬 OpenAI - Codex (OAuth)', connected: !!(connections.openai_codex as any)?.connected },
          { id: 'ollama', name: '🦙 Ollama (Local)', connected: true },
          { id: 'llama_cpp', name: '📚 llama.cpp (Local)', connected: true },
          { id: 'lm_studio', name: '🎨 LM Studio (Local)', connected: true },
        ];
        const rows = providers.map((p: any) => [{
          text: `${p.connected ? '✅' : '⭕'} ${p.name}${activeProvider === p.id ? ' <- active' : ''}`,
          callback_data: `md:prov:${p.id}`,
        }]);
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: `🔄 <b>LLM Provider & Model</b>\n\n<b>Current:</b> ${activeProvider} / <code>${primaryModel}</code>\n\nSelect a provider:`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        });
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Failed to load models: ${String(err?.message || err)}`);
      }
      return;
    }

    if (text === '/screenshot' || text === '/screenshot ') {
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: '📸 <b>Screenshot Menu</b>\nChoose what to capture.',
        parse_mode: 'HTML',
        reply_markup: this.buildScreenshotReplyMarkup(),
      }).catch(async () => {
        await this.sendMessage(chatId, '❌ Could not open screenshot menu.');
      });
      return;
    }

    if (commandName === 'new') {
      const sessionId = `telegram_${userId}_${Date.now()}`;
      const now = Date.now();
      const responseText = '✅ Started a new Telegram chat session. This thread is now linked to the new channel session.';
      linkTelegramSession(userId, sessionId);
      setSessionChannelHint(sessionId, { channel: 'telegram', chatId, userId, timestamp: now });
      this.deps.addMessage(sessionId, { role: 'assistant', content: responseText, timestamp: now }, { disableMemoryFlushCheck: true });
      await this.sendMessage(chatId, responseText);
      this.deps.broadcast({
        type: 'telegram_message',
        sessionId,
        from: userName,
        userId,
        message: { role: 'user', content: '/new', timestamp: now },
        responseMessage: { role: 'assistant', content: responseText, timestamp: now },
      });
      return;
    }

    if (text === '/resume' || text === '/resume ') {
      const payload = this.buildResumeRootPayload(userId);
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: payload.text,
        parse_mode: 'HTML',
        reply_markup: payload.reply_markup,
      }).catch(async (err: any) => {
        await this.sendMessage(chatId, `❌ Could not open resume menu: ${String(err?.message || err)}`);
      });
      return;
    }

    if (text === '/restart' || text === '/restart ') {
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: [
          '🔁 <b>Restart Options</b>',
          '',
          '<b>Full Restart</b>: run build, then restart gateway.',
          '<b>Quick Restart</b>: restart gateway without running build.',
        ].join('\n'),
        parse_mode: 'HTML',
        reply_markup: this.buildRestartReplyMarkup(),
      }).catch(async (err: any) => {
        await this.sendMessage(chatId, `❌ Could not open restart menu: ${String(err?.message || err)}`);
      });
      return;
    }

    if (text === '/update' || text === '/update ' || text === '/update check') {
      const check = this.checkForGitUpdate();
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: this.formatUpdateCheckMessage(check),
        parse_mode: 'HTML',
        reply_markup: check.ok && check.available ? this.buildUpdateReplyMarkup() : undefined,
      }).catch(async (err: any) => {
        await this.sendMessage(chatId, `❌ Could not run update check: ${String(err?.message || err)}`);
      });
      return;
    }

    if (text.startsWith('/download')) {
      const arg = text.slice('/download'.length).trim();
      if (!arg) {
        await this.sendMessage(chatId, '❌ Usage: /download &lt;path&gt;');
        return;
      }
      const filePath = this.resolveWorkspacePath(arg);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        await this.sendMessage(chatId, `❌ File not found: <code>${arg}</code>`);
        return;
      }
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);
        const formData = new FormData();
        formData.append('chat_id', String(chatId));
        formData.append('document', new Blob([fileBuffer]), fileName);
        const resp = await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: formData });
        const data: any = await resp.json();
        if (!data.ok) throw new Error(data.description || 'sendDocument failed');
        console.log(`[Telegram] Sent file ${fileName} to ${userId}`);
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Download failed: ${err.message}`);
      }
      return;
    }

	    // ── Built-in commands ──────────────────────────────────────────────────────
	    if (text === '/start') {
	      await this.sendMessage(chatId, `🔥 <b>Prometheus connected!</b>\n\nYour Telegram user ID: <code>${userId}</code>\n\nJust send me a message and I'll respond using your local LLM.\n\nUse <code>/commands</code> any time for the full command catalog.\n\n<b>Core Commands:</b>\n/status — check connection\n/clear — reset chat history\n/new — start a new Telegram channel session\n/resume — browse older chats, channels, and projects\n/stop_now — abort current main chat turn\n/stop — inspect and abort live AI flows\n/browse — browse workspace files\n/download &lt;path&gt; — download a file\n/teams — view and manage agent teams\n/agents — browse all agents (chat/dispatch/edit prompt/model)\n/tasks — list queued/paused/stalled tasks (chat/resume/cancel/delete)\n/schedule — list schedules (run now/edit/delete)\n/models — switch provider/model\n/reasoning — adjust the active provider reasoning settings\n/screenshot — browser screenshot or per-monitor desktop screenshot\n/restart — choose full or quick gateway restart\n/update — check and apply updates (with confirmation)\n\n<b>Integrations:</b>\n/integrations — list configured integrations\n/mcp-status — show MCP server status\n/setup &lt;service&gt; — connect any service (github, slack, jira, etc.)\n\n<b>Proposals:</b>\n/proposals — list pending proposals (pending/done)
/proposals [id] — show proposal details\n\n<b>Self-Repair:</b>\n/repairs — list pending repair proposals\n/repair &lt;id&gt; — show full details of a repair\n/approve &lt;id&gt; — apply a repair, rebuild &amp; restart\n/reject &lt;id&gt; — discard a repair`);
	      return;
	    }
    if (text === '/commands' || text === '/commands ' || text === '/help' || text === '/help ') {
      await this.sendMessage(chatId, this.buildTelegramCommandsMessage(userId));
      return;
    }
    if (text === '/status') {
      const busy = this.deps.getIsModelBusy();
      await this.sendMessage(chatId, `🔥 <b>Status</b>\n\nModel: ${busy ? '🔄 Busy' : '✅ Ready'}\nBot: @${this.botInfo?.username || 'unknown'}\nYour ID: <code>${userId}</code>`);
      return;
    }
    if (text === '/clear') {
      try {
        const { clearHistory } = await import('../session');
        // Clear both the telegram-specific session AND unlink the bridge
        clearHistory(`telegram_${userId}`);
        const linked = getLinkedSession(userId);
        if (linked) {
          clearHistory(linked);
          unlinkTelegramSession(userId);
        }
      } catch {}
      await this.sendMessage(chatId, '🔥 Chat history cleared (web + Telegram sessions).');
      return;
    }

    if (text === '/stop_now') {
      const candidateSessionIds = new Set(
        [
          getLinkedSession(userId),
          getLastMainSessionId(),
          `telegram_${userId}`,
        ]
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      );
      const activeMain = listLiveRuntimes().find((runtime) =>
        runtime.kind === 'main_chat'
          && (
            candidateSessionIds.has(String(runtime.sessionId || '').trim())
            || runtime.chatId === chatId
          ),
      );
      if (!activeMain) {
        await this.sendMessage(chatId, '🛑 No main chat turn is currently running for this session.');
        return;
      }
      const result = abortLiveRuntime(activeMain.id);
      await this.sendMessage(chatId, result.ok ? '🛑 Main chat abort requested.' : `❌ ${result.error || 'Abort failed.'}`);
      return;
    }

    if (text === '/stop') {
      const targets = this.listStopTargets();
      if (targets.length === 0) {
        await this.sendMessage(chatId, '🛑 No live AI flows are running right now.');
        return;
      }
      const rows = targets.slice(0, 30).map((target) => [{
        text: `${target.icon} ${target.label.slice(0, 34)}`,
        callback_data: `stop:view:${target.sourceType === 'runtime' ? 'r' : 't'}:${idKey(target.id)}`,
      }]);
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: `🛑 <b>Live AI Flows (${targets.length})</b>\nTap one to inspect it, then use Abort if needed.`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      }).catch(async (err: any) => {
        await this.sendMessage(chatId, `❌ Could not open stop menu: ${String(err?.message || err)}`);
      });
      return;
    }

	    // ── /proposals — list and manage proposals ────────────────────────────────────
	    if (text === '/proposals' || text.startsWith('/proposals ')) {
      const { listProposals } = await import('../proposals/proposal-store');
      const arg = text.slice('/proposals'.length).trim().toLowerCase();
      const showStatus: 'pending' | 'done' | 'id' = arg === 'done' ? 'done' : 
                         arg === 'pending' ? 'pending' :
                         arg ? 'id' : 'pending';
      
      let proposals: any[] = [];
      if (showStatus === 'id') {
        const p = (await import('../proposals/proposal-store')).loadProposal(arg);
        if (p) proposals = [p];
      } else {
        const statusFilter = showStatus === 'done' ? ['approved', 'executed', 'failed'] : ['pending'];
        proposals = listProposals(statusFilter as any);
      }
      
      if (proposals.length === 0) {
        const statusLabel = showStatus === 'id' ? 'found' : Array.isArray(showStatus) ? 'in ' + showStatus.join('/') : showStatus;
        await this.sendMessage(chatId, `💼 No proposals ${statusLabel}.`);
        return;
      }
      
      const isSingleProposal = proposals.length === 1 && showStatus === 'id';
      if (isSingleProposal) {
        const p = proposals[0];
        const kb = this.buildProposalKeyboard(p, p.status === 'pending' ? 'pending' : 'done');
        
        try {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: this.formatProposalSummaryCard(p).slice(0, 4000),
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kb },
          });
        } catch (e: any) {
          await this.sendMessage(chatId, this.formatProposalSummaryCard(p));
        }
        return;
      }
      
      const statusLabel = showStatus === 'done' ? 'COMPLETED' : showStatus === 'pending' ? 'PENDING' : 'FOUND';
      const lines = proposals.map(p => {
        const emoji = this.getProposalStatusEmoji(p.status);
        return `${emoji} <code>#${this.tgEscape(p.id)}</code> <b>${this.tgEscape(String(p.title || 'Untitled').slice(0, 40))}</b>\n   Priority: ${this.tgEscape(p.priority)} | Type: ${this.tgEscape(p.type)}`;
      });
      
      try {
        const kb = proposals.map(p => [{ text: this.compactTelegramButtonText(p.title || p.id, 34), callback_data: `pr:detail:${p.id}` }]);
        kb.push([{ text: showStatus === 'done' ? '⏳ View pending' : '✅ View completed', callback_data: `pr:list:${showStatus === 'done' ? 'pending' : 'done'}` }]);
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: `💼 <b>Proposals (${statusLabel})</b>\n\n${lines.join('\n\n')}`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: kb },
        });
      } catch (e: any) {
        await this.sendMessage(chatId, `💼 <b>Proposals (${statusLabel})</b>\n\n${lines.join('\n\n')}`);
      }
	      return;
	    }

		    if (text === '/approvals' || text.startsWith('/approvals ')) {
		      const { getApprovalQueue } = await import('../verification-flow');
		      const queue = getApprovalQueue();
		      const arg = text.slice('/approvals'.length).trim().toLowerCase();
		      const showStatus: 'pending' | 'done' | 'id' = arg === 'done' ? 'done'
		        : arg === 'pending' ? 'pending'
		        : arg ? 'id' : 'pending';

		      let approvals: any[] = [];
		      if (showStatus === 'id') {
		        const a = queue.get(arg);
		        if (a) approvals = [a];
		      } else {
		        approvals = queue.listAll().filter((item: any) => showStatus === 'done' ? item.status !== 'pending' : item.status === 'pending');
		      }

	      if (approvals.length === 0) {
	        await this.sendMessage(chatId, `⏳ No command approvals ${showStatus === 'id' ? 'found' : `in ${showStatus}`}.`);
	        return;
	      }

	      if (approvals.length === 1 && showStatus === 'id') {
	        const a = approvals[0];
	        const textBody = [
		          `⏳ <b>Command Approval</b>`,
		          ``,
		          `<b>ID:</b> <code>${this.tgEscape(a.id)}</code>`,
		          `<b>Status:</b> ${this.tgEscape(a.status)}`,
		          `<b>Origin:</b> ${this.tgEscape(this.getCommandApprovalOrigin(a))}`,
		          `<b>Risk:</b> ${Number(a.riskScore || 0)}/10`,
		          `<b>Reason:</b> ${this.tgEscape(a.reason || a.action || '')}`,
		          ``,
		          `<code>${this.tgEscape(String(a.toolArgs?.command || '').slice(0, 1200))}</code>`,
		        ].join('\n');
	        const kb: any[][] = [];
	        if (a.status === 'pending') kb.push([{ text: '✅ Approve', callback_data: `ca:ap:${a.id}` }, { text: '❌ Reject', callback_data: `ca:rj:${a.id}` }]);
	        kb.push([{ text: '📋 Back to list', callback_data: 'ca:list:pending' }]);
	        await this.apiCall('sendMessage', {
	          chat_id: chatId,
	          text: textBody.slice(0, 4000),
	          parse_mode: 'HTML',
	          reply_markup: { inline_keyboard: kb },
	        }).catch(() => this.sendMessage(chatId, textBody));
	        return;
	      }

		      const lines = approvals.slice(0, 15).map(a =>
		        `⏳ <code>#${a.id}</code> <b>${this.tgEscape(String(a.toolArgs?.command || '').slice(0, 40))}</b>\n   Origin: ${this.tgEscape(this.getCommandApprovalOrigin(a))} | Status: ${this.tgEscape(a.status)} | Risk: ${Number(a.riskScore || 0)}/10`
		      );
		      const kb = approvals.slice(0, 15).map(a => [{ text: String(a.toolArgs?.command || '').slice(0, 30) || a.id, callback_data: `ca:detail:${a.id}` }]);
	      kb.push([{ text: showStatus === 'done' ? '⏳ View pending' : '✅ View completed', callback_data: `ca:list:${showStatus === 'done' ? 'pending' : 'done'}` }]);
	      await this.apiCall('sendMessage', {
	        chat_id: chatId,
	        text: `⏳ <b>Command Approvals (${showStatus === 'done' ? 'DONE' : 'PENDING'})</b>\n\n${lines.join('\n\n')}`.slice(0, 4000),
	        parse_mode: 'HTML',
	        reply_markup: { inline_keyboard: kb },
	      }).catch(() => this.sendMessage(chatId, lines.join('\n\n')));
	      return;
	    }

	    // ── /repairs — list pending self-repair proposals ───────────────────────────
	    if (text === '/repairs') {
      const pending = listPendingRepairsSafe();
      if (pending.length === 0) {
        await this.sendMessage(chatId, '🔥 No pending repairs.');
        return;
      }
      const lines = pending.map(r =>
        `🔧 <b>#${r.id}</b> — <code>${r.affectedFile}</code>\n   ${r.errorSummary.slice(0, 80)}`
      );
      await this.sendMessage(chatId, `🔥 <b>Pending Repairs (${pending.length})</b>\n\n${lines.join('\n\n')}\n\nUse /approve &lt;id&gt; or /reject &lt;id&gt;`);
      return;
    }

    // ── /approve <id> — apply a pending repair ──────────────────────────────────
    if (text.startsWith('/approve')) {
      const repairId = text.slice('/approve'.length).trim();
      if (!repairId) {
        await this.sendMessage(chatId, '❌ Usage: /approve &lt;repair-id&gt;\n\nUse /repairs to list pending repairs.');
        return;
      }
      const repair = loadPendingRepairSafe(repairId);
      if (!repair) {
        await this.sendMessage(chatId, `❌ No pending repair found with ID: <code>${repairId}</code>\n\nUse /repairs to list pending repairs.`);
        return;
      }
      if (repair.status !== 'pending') {
        await this.sendMessage(chatId, `❌ Repair <code>#${repairId}</code> is not pending (status: ${repair.status}).`);
        return;
      }

      await this.sendMessage(chatId, `🔧 Applying repair <code>#${repairId}</code>...\n\nPatching <code>${repair.affectedFile}</code>, then rebuilding. This may take 30–60 seconds.`);

      // Run in background so Telegram doesn't time out
      applyApprovedRepairSafe(repairId).then(async (result) => {
        try {
          await this.sendMessage(chatId, result.message);
        } catch {}
      }).catch(async (err) => {
        try {
          await this.sendMessage(chatId, `❌ Unexpected error during repair: ${err.message}`);
        } catch {}
      });
      return;
    }

    // ── /reject <id> — discard a pending repair ─────────────────────────────────
    if (text.startsWith('/reject')) {
      const repairId = text.slice('/reject'.length).trim();
      if (!repairId) {
        await this.sendMessage(chatId, '❌ Usage: /reject &lt;repair-id&gt;');
        return;
      }
      const repair = loadPendingRepairSafe(repairId);
      if (!repair) {
        await this.sendMessage(chatId, `❌ No repair found with ID: <code>${repairId}</code>.`);
        return;
      }
      const deleted = deletePendingRepairSafe(repairId);
      await this.sendMessage(chatId, deleted
        ? `🗑️ Repair <code>#${repairId}</code> discarded.\n\n<i>Fixed: ${repair.affectedFile}</i>`
        : `❌ Could not delete repair <code>#${repairId}</code>.`
      );
      return;
    }

    // ── /mcp-status — show all MCP server statuses ───────────────────────────────
    if (text === '/mcp-status') {
      try {
        const cfg = getConfig().getConfig() as any;
        const configDir = getConfig().getConfigDir ? getConfig().getConfigDir() : '';
        const mcpConfigPath = configDir ? require('path').join(configDir, 'mcp-servers.json') : '';
        let servers: any[] = [];
        if (mcpConfigPath && require('fs').existsSync(mcpConfigPath)) {
          servers = JSON.parse(require('fs').readFileSync(mcpConfigPath, 'utf-8')) || [];
        }
        if (!Array.isArray(servers) || servers.length === 0) {
          await this.sendMessage(chatId, '🔌 <b>MCP Servers</b>\n\nNo MCP servers configured.\n\nUse the Settings UI to add MCP servers, or ask me to set up an integration (e.g. "connect me to GitHub").');
          return;
        }
        const lines = servers.map((s: any) => {
          const icon = s.enabled ? '✅' : '⚫';
          const label = s.name || s.id;
          const transport = s.url ? `SSE: ${s.url}` : `${s.command || '?'} ${(s.args || []).join(' ')}`;
          return `${icon} <b>${label}</b> (${s.id})\n   <code>${transport.slice(0, 60)}</code>`;
        });
        await this.sendMessage(chatId, `🔌 <b>MCP Servers (${servers.length})</b>\n\n${lines.join('\n\n')}\n\n<i>Status shown from config — connect via Settings UI or ask me to run a health check.</i>`);
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Could not read MCP config: ${err.message}`);
      }
      return;
    }

    // ── /integrations — show integration state ──────────────────────────────────
    if (text === '/integrations') {
      try {
        const cfg = getConfig().getConfig() as any;
        const configDir = getConfig().getConfigDir ? getConfig().getConfigDir() : '';
        const stateFile = require('path').join(configDir, 'integrations-state.json');
        let state: any = { integrations: {} };
        if (require('fs').existsSync(stateFile)) {
          state = JSON.parse(require('fs').readFileSync(stateFile, 'utf-8'));
        }
        const entries = Object.entries(state.integrations || {}) as [string, any][];
        if (entries.length === 0) {
          await this.sendMessage(chatId, '🔌 <b>Integrations</b>\n\nNo integrations configured yet.\n\nJust ask me to connect any service — there are hundreds of MCP servers available.\n\nExample: /setup github\nExample: /setup slack\nExample: /setup jira\n\nOr just tell me: "connect me to [service]"');
          return;
        }
        const lines = entries.map(([name, info]: [string, any]) => {
          const icon = info.status === 'configured' ? '✅' : info.status === 'broken' ? '❌' : '⚫';
          const caps = (info.capabilities || []).join(', ') || 'unknown';
          return `${icon} <b>${name}</b> — ${info.status}\n   Capabilities: ${caps.slice(0, 80)}`;
        });
        await this.sendMessage(chatId, `🔌 <b>Integrations (${entries.length})</b>\n\n${lines.join('\n\n')}`);
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Could not read integrations state: ${err.message}`);
      }
      return;
    }

    // ── /setup <service> — guided integration setup ─────────────────────────────
    if (text.startsWith('/setup')) {
      const serviceName = text.slice('/setup'.length).trim().toLowerCase();
      if (!serviceName) {
        await this.sendMessage(chatId, '🔌 <b>Integration Setup</b>\n\nI can connect to any service that has an MCP server or webhook support.\n\nUsage: /setup &lt;service&gt;\nExamples:\n• /setup github\n• /setup slack\n• /setup jira\n• /setup discord\n• /setup notion\n• /setup linear\n\nOr just ask naturally: "connect me to GitHub"');
        return;
      }
      if (this.deps.getIsModelBusy()) {
        await this.sendMessage(chatId, '🔥 I\'m currently busy. Try again in a moment.');
        return;
      }
      await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
      const sessionId = this.getTelegramSessionId(userId, chatId);
      const events: Array<{ type: string; data: any }> = [];
      const setupPresentedFiles: Array<{ path: string; trigger: string }> = [];
      const sendSSE = (type: string, data: any) => {
        events.push({ type, data });
        if (type === 'canvas_present' && data?.path) {
          setupPresentedFiles.push({ path: String(data.path), trigger: 'created' });
        }
      };
	      const setupPrompt = `The user wants to set up the ${serviceName} integration via Telegram. Use the integration-setup skill. Check workspace/integrations/${serviceName}.md first — if it has a full definition use it, otherwise research the ${serviceName} MCP server or webhook setup yourself (web_search), build the definition file, then guide the user through setup step by step.`;
	      const setupContext = `CONTEXT: You are responding via Telegram via a direct interactive session. You have FULL ACCESS to all tools including workspace file access (read_file, list_files, list_directory). The user triggered /setup ${serviceName}. You are running a guided integration setup flow using the integration-setup skill. You can connect to any service — research and build the definition if it does not already exist.`;
	      try {
	        const turn = await this.runTelegramMainChatTurn({
	          chatId,
	          sessionId,
	          message: setupPrompt,
	          sendSSE,
	          callerContext: setupContext,
	        });
	        if (turn.aborted) return;
	        const result = turn.result;
	        const responseText = result.text || 'Unable to start setup. Make sure the integration-setup skill is enabled.';
	        await this.sendAiMessage(chatId, responseText);
        // Present any files created during setup (e.g. integrations/<service>.md)
        this.filePresented.clear();
        for (const { path: fp, trigger } of setupPresentedFiles) {
          try { await this.sendFilePresentation(chatId, fp, trigger); } catch {}
        }
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Setup error: ${err.message}`);
      }
      return;
    }

    // ── /approve_goal <id> — approve a goal decomposition ─────────────────────
    if (text.startsWith('/approve_goal ')) {
      const parts = text.slice('/approve_goal '.length).trim().split(/\s+/);
      const goalId = parts[0];
      if (!goalId) {
        await this.sendMessage(chatId, '❌ Usage: /approve_goal <goal_id>\nGet goal IDs from the web UI or goal decomposition messages.');
        return;
      }
      try {
        const { approveGoal, loadGoal } = await import('../goal-decomposer.js');
        const goal = loadGoal(goalId);
        if (!goal) {
          await this.sendMessage(chatId, `❌ No goal found with ID: <code>${goalId}</code>`);
          return;
        }
        // Get cronScheduler from global context — it's initialized in server-v2
        // We dynamically get it via the broadcast hook
        await this.sendMessage(chatId, `⏳ Approving goal "${goal.title}"...`);
        // Signal back to server to process the approval
        this.deps.broadcast({ type: 'approve_goal_request', goalId, chatId });
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Goal approval error: ${err.message}`);
      }
      return;
    }

    // ── /reject_goal <id> — reject a goal decomposition ─────────────────────────
    if (text.startsWith('/reject_goal ')) {
      const goalId = text.slice('/reject_goal '.length).trim();
      try {
        const { loadGoal, saveGoal } = await import('../goal-decomposer.js');
        const goal = loadGoal(goalId);
        if (!goal) {
          await this.sendMessage(chatId, `❌ No goal found with ID: <code>${goalId}</code>`);
          return;
        }
        goal.status = 'archived';
        saveGoal(goal);
        await this.sendMessage(chatId, `🗑️ Goal "${goal.title}" rejected and archived.`);
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Goal rejection error: ${err.message}`);
      }
      return;
    }

    // ── /repair <id> — show full details of a pending repair ────────────────────
    if (text.startsWith('/repair ')) {
      const repairId = text.slice('/repair '.length).trim();
      const repair = loadPendingRepairSafe(repairId);
      if (!repair) {
        await this.sendMessage(chatId, `❌ No repair found with ID: <code>${repairId}</code>. Use /repairs to list all.`);
        return;
      }
      await this.sendMessage(chatId, formatRepairProposalSafe(repair));
      return;
    }

    // Check if model is busy
    if (this.deps.getIsModelBusy()) {
      await this.sendMessage(chatId, '🔥 I\'m currently busy with another task. Try again in a moment.');
      return;
    }

    // Send "typing" indicator
    await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

    // Route to handleChat
    // ── Session Bridge: if a web UI (or other) session recently sent a Telegram
    //    message to this user, continue through that same session so the AI sees
    //    the full conversation history.  Telegram becomes a seamless extension
    //    of whichever session last talked to the user. ──
    const sessionId = this.getTelegramSessionId(userId, chatId);
    if (getLinkedSession(userId)) {
      console.log(`[Telegram] Routing user ${userId} through linked session: ${sessionId}`);
    }
	    this.creativeProgressCounters.set(sessionId, 0);
	    this.creativeProgressStarted.delete(sessionId);
	    this.creativeProgressLastSentAt.delete(sessionId);
	    const events: Array<{ type: string; data: any }> = [];
	    // Collect files to present: canvas_present events + edit/apply_patch results
	    const presentedFiles: Array<{ path: string; trigger: string }> = [];
      const generatedImages: any[] = [];
      const generatedImageKeys = new Set<string>();
      const generatedVideos: any[] = [];
      const generatedVideoKeys = new Set<string>();
	    let lastProgressSignature = '';
	    const sendSSE = (type: string, data: any) => {
      events.push({ type, data });
      const suppressTelegramProgress = this.maybeQueueCreativeProgressPlaceholder(chatId, sessionId, type, data);
      if (!suppressTelegramProgress && type === 'tool_call') {
        const toolName = String(data?.action || data?.name || 'unknown_tool');
        if (toolName === 'context_compaction') {
          const threshold = Number(data?.args?.threshold_messages || 0);
          const windowCount = Number(data?.args?.candidate_messages || 0);
          const lines = [
            '🧠 Main Chat Agent',
            '🗜️ <b>Compacting thread context...</b>',
            Number.isFinite(threshold) && threshold > 0 ? `Threshold: <code>${threshold}</code> messages` : '',
            Number.isFinite(windowCount) && windowCount > 0 ? `Window count: <code>${windowCount}</code>` : '',
          ].filter(Boolean);
          this.enqueueProgressMessage(chatId, lines.join('\n'));
          return;
        }
        let browserUrl = '';
        let browserTitle = '';
        try {
          const { getBrowserSessionInfo } = require('../browser-tools.js') as any;
          const info = getBrowserSessionInfo(sessionId);
          browserUrl = String(info?.url || '');
          browserTitle = String(info?.title || '');
        } catch { /* non-fatal */ }
        const logMsg = formatTelegramToolCall({
          actor: 'main_chat',
          toolName,
          args: data?.args,
          browserUrl,
          browserTitle,
          composite: data?.composite ? String(data.composite) : undefined,
          stepNum: data?.stepNum != null ? Number(data.stepNum) : undefined,
          totalSteps: data?.totalSteps != null ? Number(data.totalSteps) : undefined,
        });
        this.enqueueProgressMessage(chatId, logMsg);
	      } else if (!suppressTelegramProgress && type === 'tool_result' && String(data?.action || '') !== 'context_compaction') {
		        const resultMsg = formatTelegramToolResult({
		          actor: 'main_chat',
		          toolName: String(data?.action || 'unknown_tool'),
		          args: data?.args,
		          result: String(data?.result || ''),
		          error: data?.error === true,
		          forceShow: data?.show_result === true,
		        });
	        if (resultMsg) {
	          this.enqueueProgressMessage(chatId, resultMsg);
	        } else if (data?.error) {
	          const errMsg = formatTelegramToolError({
	            actor: 'main_chat',
	            toolName: String(data?.action || 'unknown_tool'),
	            errorText: String(data?.result || 'Unknown tool error'),
	          });
	          this.enqueueProgressMessage(chatId, errMsg);
	        }
	      } else if (!suppressTelegramProgress && type === 'tool_result' && !data?.error && String(data?.action || '') === 'context_compaction') {
        const status = String(data?.extra?.status || '').toLowerCase();
        const mode = String(data?.extra?.mode || '').trim();
        const summary = String(data?.extra?.summary || '').trim();
        const previewRaw = summary ? `${summary.slice(0, 1200)}${summary.length > 1200 ? '...' : ''}` : String(data?.result || '');
        const preview = previewRaw ? formatTelegramAiTextFromMarkdown(previewRaw) : '';
        const lines = [
          '🧠 Main Chat Agent',
          status === 'skipped' ? 'ℹ️ <b>Thread compaction skipped.</b>' : '✅ <b>Thread compacted.</b>',
          mode ? `Mode: <code>${mode}</code>` : '',
          preview ? `<b>Summary Preview</b>\n${preview}` : '',
        ].filter(Boolean);
        this.enqueueProgressMessage(chatId, lines.join('\n\n'));
      } else if (!suppressTelegramProgress && type === 'progress_state') {
        // Only stream plan progress when a plan was explicitly declared (source='declared')
        // or preflight-seeded. Skip auto-inferred tool_sequence plans to avoid noise.
        const progressSource = String(data?.source || 'none');
        if (progressSource !== 'tool_sequence') {
          const progressMsg = formatTelegramProgressState({
            actor: 'main_chat',
            items: Array.isArray(data?.items) ? data.items : [],
          });
          if (progressMsg) {
            const sig = `${progressSource}|${JSON.stringify(data?.items || [])}`;
            if (sig !== lastProgressSignature) {
              lastProgressSignature = sig;
              this.enqueueProgressMessage(chatId, progressMsg);
            }
          }
        }
      }
      // canvas_present fires for create_file and write tools (from server-v2)
      if (type === 'canvas_present' && data?.path) {
        presentedFiles.push({ path: String(data.path), trigger: 'created' });
      }
      // Catch edit and apply_patch successes — extract path from result
	      if (type === 'tool_result' && !data?.error) {
	        const action = String(data?.action || '');
	        if (action === 'generate_image') {
	          const imageRows = Array.isArray(data?.extra?.generated_images)
	            ? data.extra.generated_images
	            : (data?.extra?.generated_image ? [data.extra.generated_image] : []);
	          for (const image of imageRows) {
	            const key = String(image?.path || image?.rel_path || '').trim().toLowerCase();
	            if (!key || generatedImageKeys.has(key)) continue;
	            generatedImageKeys.add(key);
	            generatedImages.push(image);
	          }
	        }
	        if (action === 'generate_video') {
	          const videoRows = Array.isArray(data?.extra?.generated_videos)
	            ? data.extra.generated_videos
	            : (data?.extra?.generated_video ? [data.extra.generated_video] : []);
	          for (const video of videoRows) {
	            const key = String(video?.path || video?.rel_path || '').trim().toLowerCase();
	            if (!key || generatedVideoKeys.has(key)) continue;
	            generatedVideoKeys.add(key);
	            generatedVideos.push(video);
	          }
	        }
	        if (action === 'edit' || action === 'find_replace' || action === 'replace_lines') {
	          // Tool result typically contains "path: /abs/path" — extract it
	          const resultStr = String(data?.result || '');
          const pathMatch = resultStr.match(/path[:\s]+([^\s,\n]+)/i);
          if (pathMatch?.[1]) presentedFiles.push({ path: pathMatch[1], trigger: 'edit' });
        }
        if (action === 'apply_patch') {
          const resultStr = String(data?.result || '');
          const pathMatch = resultStr.match(/([^\s,\n]+\.[a-z]{1,10})/i);
          if (pathMatch?.[1]) presentedFiles.push({ path: pathMatch[1], trigger: 'apply_patch' });
        }
      }
    };

    // Download image attachment if present.
    // Prefer photo payloads; also support images sent as document.
    let imageAttachment: { base64: string; mimeType: string; name: string } | undefined;
    let savedImageAttachment:
      | { absPath: string; relPath: string; fileName: string; mimeType: string; sizeBytes: number }
      | undefined;
    let videoAttachment:
      | { absPath: string; relPath: string; fileName: string; mimeType: string; sizeBytes: number }
      | undefined;
    if (msg!.photo && msg!.photo.length > 0) {
      const largest = msg!.photo[msg!.photo.length - 1];
      const downloaded = await this.downloadTelegramPhoto(largest.file_id);
      if (downloaded) {
        const ext = downloaded.mimeType.split('/')[1] || 'jpg';
        imageAttachment = { ...downloaded, name: `photo.${ext}` };
        console.log(`[Telegram] Downloaded photo (${Math.round(downloaded.base64.length * 0.75 / 1024)}KB)`);
      }
    } else if (msg!.video?.file_id) {
      videoAttachment = await this.downloadTelegramFileToWorkspace(msg!.video.file_id, {
        sessionId,
        fileName: msg!.video.file_name,
        hintedMimeType: msg!.video.mime_type,
        fallbackStem: 'telegram-video',
      }) || undefined;
    } else if (msg!.animation?.file_id) {
      videoAttachment = await this.downloadTelegramFileToWorkspace(msg!.animation.file_id, {
        sessionId,
        fileName: msg!.animation.file_name,
        hintedMimeType: msg!.animation.mime_type,
        fallbackStem: 'telegram-animation',
      }) || undefined;
    } else if (msg!.video_note?.file_id) {
      videoAttachment = await this.downloadTelegramFileToWorkspace(msg!.video_note.file_id, {
        sessionId,
        hintedMimeType: 'video/mp4',
        fallbackStem: 'telegram-video-note',
      }) || undefined;
    } else if (msg!.document?.file_id) {
      if (this.isTelegramVideoDocument(msg!.document)) {
        videoAttachment = await this.downloadTelegramFileToWorkspace(msg!.document.file_id, {
          sessionId,
          fileName: msg!.document.file_name,
          hintedMimeType: msg!.document.mime_type,
          fallbackStem: 'telegram-video',
        }) || undefined;
      } else {
        const downloaded = await this.downloadTelegramImageDocument(
          msg!.document.file_id,
          msg!.document.mime_type,
        );
        if (downloaded) {
          const ext = downloaded.mimeType.split('/')[1] || 'png';
          const rawName = String(msg!.document.file_name || '').trim();
          const safeName = rawName || `image.${ext}`;
          imageAttachment = { ...downloaded, name: safeName };
          console.log(`[Telegram] Downloaded image document (${Math.round(downloaded.base64.length * 0.75 / 1024)}KB)`);
        }
      }
    }

    if (imageAttachment) {
      savedImageAttachment = this.saveTelegramImageAttachmentToWorkspace(imageAttachment, {
        sessionId,
        fallbackStem: 'telegram-image',
      }) || undefined;
      if (savedImageAttachment) {
        console.log(
          `[Telegram] Saved image attachment to ${savedImageAttachment.relPath} (${Math.round(savedImageAttachment.sizeBytes / 1024)}KB)`,
        );
      }
    }

    if (videoAttachment) {
      console.log(
        `[Telegram] Downloaded video attachment to ${videoAttachment.relPath} (${Math.round(videoAttachment.sizeBytes / 1024)}KB)`,
      );
    }

    // For media-only messages (no caption), supply a neutral prompt so the AI knows to inspect the attachment.
    const effectiveText = text
      || (videoAttachment
        ? '(Video attached via Telegram — please analyze it)'
        : imageAttachment
          ? '(Image attached — please analyze it)'
          : '');
    const messageForModel = effectiveText;

	    try {
	      const telegramContext = 'CONTEXT: You are responding via Telegram via a direct interactive session (not a subagent). You have FULL ACCESS to all tools including complete workspace file access (read_file, list_files, list_directory, grep, semantic_search) and can see all files in the workspace. You are running on the user\'s local Windows PC. All computer tools (run_command, browser_open, browser_snapshot, browser_click, browser_fill, browser_press_key, browser_wait, browser_close, desktop_screenshot, desktop_find_window, desktop_focus_window, desktop_click, desktop_drag, desktop_wait, desktop_type, desktop_press_key, desktop_get_clipboard, desktop_set_clipboard) are fully available and operational. Use them confidently when the user asks you to open, browse, or interact with anything on their computer.';
      const isDesktopStatusCheck =
	        /\b(vs code|vscode|codex)\b/i.test(text)
	        && /\b(done|finished|complete|completed|responded)\b/i.test(text);
	      const statusContext = isDesktopStatusCheck
	        ? 'CONTEXT: This Telegram request is a desktop status check. First action should be desktop_screenshot (then desktop advisor flow), not browser tools.'
	        : '';
      const videoContext = videoAttachment
	        ? `CONTEXT: A Telegram video attachment for this turn has already been downloaded into the workspace.\nLocal video path: ${videoAttachment.relPath}\nAbsolute path: ${videoAttachment.absPath}\nMime type: ${videoAttachment.mimeType}\nIf the user wants the clip analyzed, call analyze_video on this path before answering. Do not claim to have watched the video unless you actually ran analyze_video.`
	        : '';
      const imageContext = savedImageAttachment
        ? `CONTEXT: A Telegram image attachment for this turn has already been saved into the workspace.\nLocal image path: ${savedImageAttachment.relPath}\nAbsolute path: ${savedImageAttachment.absPath}\nMime type: ${savedImageAttachment.mimeType}\nThe image is also attached as a vision payload, so you can inspect it visually and use this path for file/tool operations.`
        : '';
	      const callerContext = [telegramContext, statusContext || '', videoContext || '', imageContext || ''].filter(Boolean).join('\n');
	      const turn = await this.runTelegramMainChatTurn({
		        chatId,
		        sessionId,
		        message: messageForModel,
		        sendSSE,
		        callerContext,
		        attachments: imageAttachment ? [imageAttachment] : undefined,
		      });
		      if (turn.aborted) return;
	      const result = turn.result;
	      const responseText = sanitizeFinalReply(result.text || '') || 'No response generated.';
      const now = Date.now();

	      const userContent = videoAttachment
	        ? `${text ? `${text} ` : ''}[Video attached via Telegram: ${videoAttachment.relPath}]`
	        : savedImageAttachment
	          ? `${text ? text + ' ' : ''}[Image attached via Telegram: ${savedImageAttachment.relPath}]`
	        : imageAttachment
	          ? `${text ? text + ' ' : ''}[Image attached via Telegram]`
	          : effectiveText;

	      await this.sendAiMessage(chatId, responseText);
	      if (generatedImages.length) {
	        try {
	          await this.sendGeneratedImagesToChat(chatId, generatedImages);
	        } catch (err: any) {
	          console.warn(`[Telegram] Generated image delivery failed: ${err?.message}`);
	        }
	      }
	      if (generatedVideos.length) {
	        try {
	          await this.sendGeneratedVideosToChat(chatId, generatedVideos);
	        } catch (err: any) {
	          console.warn(`[Telegram] Generated video delivery failed: ${err?.message}`);
	        }
	      }

	      // ── Present any files the AI created or edited ──────────────────────────
      // Reset per-turn dedup set, then send each unique file
      this.filePresented.clear();
      for (const { path: filePath, trigger } of presentedFiles) {
        try {
          await this.sendFilePresentation(chatId, filePath, trigger);
        } catch (err: any) {
          console.warn(`[Telegram] File presentation failed for ${filePath}: ${err?.message}`);
        }
      }

      // Broadcast to web UI that a Telegram message was processed
	      this.deps.broadcast({
	        type: 'telegram_message',
	        sessionId,
	        from: userName,
	        userId,
	        message: { role: 'user', content: userContent, timestamp: now },
	        responseMessage: {
	          role: 'assistant',
	          content: responseText,
	          timestamp: now,
	        generatedImages: generatedImages.length ? generatedImages : undefined,
	        generatedVideos: generatedVideos.length ? generatedVideos : undefined,
	        },
      });

      this.creativeProgressCounters.delete(sessionId);
      this.creativeProgressStarted.delete(sessionId);
      this.creativeProgressLastSentAt.delete(sessionId);
      console.log(`[Telegram] Replied to ${userName}: ${responseText.slice(0, 80)}`);
    } catch (err: any) {
      this.creativeProgressCounters.delete(sessionId);
      this.creativeProgressStarted.delete(sessionId);
      this.creativeProgressLastSentAt.delete(sessionId);
      console.error(`[Telegram] handleChat error:`, err.message);
      await this.sendMessage(chatId, `🔥 Error: ${err.message}`);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  // ─── File Presentation ───────────────────────────────────────────────────────
  // Called after handleChat resolves when the AI created or edited files.
  // Mirrors the web UI's canvas_present behaviour — sends the file to Telegram
  // so the user sees it without having to open the web UI.

  private filePresented = new Set<string>(); // deduplicate within a turn

  /**
   * Present a workspace file to the user on Telegram.
   * - Small text files (≤3KB): inline code-block preview + document attachment
   * - Larger text files (≤2MB): document attachment with caption
   * - Very large or binary files: path-only message with /download hint
   */
  async sendFilePresentation(chatId: number, filePath: string, triggeredBy?: string): Promise<void> {
    // Resolve absolute path
    const absPath = require('path').isAbsolute(filePath)
      ? filePath
      : require('path').join(this.workspaceRoot, filePath);

    // Deduplicate within a single turn
    const key = String(absPath).toLowerCase();
    if (this.filePresented.has(key)) return;
    this.filePresented.add(key);

    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');

    if (!fs.existsSync(absPath)) return;

    let stat: import('fs').Stats;
    try { stat = fs.statSync(absPath); } catch { return; }
    if (!stat.isFile()) return;

    const fileName = path.basename(absPath);
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const sizeBytes = stat.size;

    // Emoji label by type
    const typeEmoji = (() => {
      if (['ts', 'js', 'py', 'sh', 'rs', 'go', 'java', 'cpp', 'c', 'cs'].includes(ext)) return '💻';
      if (['md', 'txt', 'rst'].includes(ext)) return '📝';
      if (['html', 'htm', 'css'].includes(ext)) return '🌐';
      if (['json', 'yaml', 'yml', 'toml', 'env'].includes(ext)) return '⚙️';
      if (['csv', 'tsv'].includes(ext)) return '📊';
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼';
      return '📄';
    })();

    const triggerLabel = triggeredBy === 'edit' ? 'edited' : triggeredBy === 'apply_patch' ? 'patched' : 'created';
    const sizeLabel = sizeBytes > 1024 * 1024
      ? `${(sizeBytes / 1024 / 1024).toFixed(1)}MB`
      : sizeBytes > 1024
        ? `${(sizeBytes / 1024).toFixed(1)}KB`
        : `${sizeBytes}B`;

    // Binary / image detection
    const BINARY_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','mp3','mp4','mov','avi','zip','gz','tar','pdf','exe','dll']);
    const isBinary = BINARY_EXTS.has(ext);

    // Very large or binary — just notify with path
    if (sizeBytes > 2 * 1024 * 1024 || (isBinary && !['png','jpg','jpeg','gif','webp'].includes(ext))) {
      await this.sendMessage(chatId,
        `${typeEmoji} <b>${fileName}</b> ${triggerLabel} (${sizeLabel})\n<code>${absPath}</code>\n\nUse /download ${path.relative(this.workspaceRoot, absPath)} to get the file.`
      );
      return;
    }

    // Image — send as photo
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      try {
        const buf = fs.readFileSync(absPath);
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('photo', new Blob([buf], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }), fileName);
        form.append('caption', `${typeEmoji} <b>${fileName}</b> ${triggerLabel} (${sizeLabel})`);
        form.append('parse_mode', 'HTML');
        const resp = await fetch(`${this.apiBase}/sendPhoto`, { method: 'POST', body: form });
        const data: any = await resp.json();
        if (data.ok) return;
      } catch {}
      // Fall through to document if photo send fails
    }

    // Text file — read content
    let content: string;
    try { content = fs.readFileSync(absPath, 'utf-8'); } catch { return; }

    const INLINE_PREVIEW_MAX = 3000; // bytes at which we show inline preview
    const isSmall = sizeBytes <= INLINE_PREVIEW_MAX;

    // For small text files — send inline preview first
    if (isSmall) {
      const escaped = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const previewMsg = `${typeEmoji} <b>${fileName}</b> ${triggerLabel} (${sizeLabel})\n\n<pre>${escaped}</pre>`;
      await this.sendMessage(chatId, previewMsg);
      return; // small files don't need a separate attachment — preview is enough
    }

    // Larger text files — send as document with a short preview caption
    const previewLines = content.split('\n').slice(0, 6).join('\n');
    const caption = `${typeEmoji} <b>${fileName}</b> ${triggerLabel} (${sizeLabel})\n\n<code>${previewLines.slice(0, 300).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;

    try {
      const buf = Buffer.from(content, 'utf-8');
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('document', new Blob([buf], { type: 'text/plain' }), fileName);
      form.append('caption', caption.slice(0, 1024));
      form.append('parse_mode', 'HTML');
      const resp = await fetch(`${this.apiBase}/sendDocument`, { method: 'POST', body: form });
      const data: any = await resp.json();
      if (!data.ok) {
        // Fallback: send caption as plain message with /download hint
        await this.sendMessage(chatId,
          `${typeEmoji} <b>${fileName}</b> ${triggerLabel} (${sizeLabel})\n<code>${absPath}</code>\n\nUse /download ${path.relative(this.workspaceRoot, absPath)} to download.`
        );
      }
    } catch (err: any) {
      console.warn(`[Telegram] sendFilePresentation failed for ${fileName}: ${err?.message}`);
    }
  }

  /**
   * Send a proposal to all allowed users via Telegram with approve/reject buttons.
   * Called automatically when a proposal is created via write_proposal.
   */
  async sendProposalToAllowed(proposal: any): Promise<void> {
    if (!this.config.enabled || !this.botInfo) return;
    
    const fullMessage = this.formatProposalSummaryCard(proposal).slice(0, 4000);
    const keyboard = this.buildProposalKeyboard(proposal, 'pending');
    
    for (const userId of this.config.allowedUserIds) {
      try {
        await this.apiCall('sendMessage', {
          chat_id: userId,
          text: fullMessage,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        });
      } catch (err: any) {
        console.warn(`[Telegram] Failed to send proposal to user ${userId}: ${err.message}`);
      }
    }
  }

  private splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to split at double newline (paragraph boundary) first
      let splitAt = remaining.lastIndexOf('\n\n', maxLen);
      // Fall back to single newline
      if (splitAt <= maxLen * 0.5) splitAt = remaining.lastIndexOf('\n', maxLen);
      // Fall back to sentence boundary (. or ? or !)
      if (splitAt <= maxLen * 0.5) {
        const sentenceEnd = remaining.slice(0, maxLen).search(/[.?!][\s\n](?=[A-Z]|$)/g);
        if (sentenceEnd > maxLen * 0.5) splitAt = sentenceEnd + 1;
      }
      // Fall back to word boundary
      if (splitAt <= maxLen * 0.5) splitAt = remaining.lastIndexOf(' ', maxLen);
      // Hard cut only as last resort
      if (splitAt <= 0) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
  }
}


