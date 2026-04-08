/**
 * chat/chat-helpers.ts — B5 Refactor
 *
 * All helper functions used by handleChat, extracted verbatim from server-v2.ts.
 * Zero logic changes — pure move.
 *
 * Exported (used outside handleChat in server-v2.ts):
 *   - buildTools                    → passed to runStartup
 *   - _dispatchToAgent              → channels router init
 */

import path from 'path';
import fs from 'fs';
import { getConfig } from '../../config/config';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getWorkspace, setWorkspace, clearHistory, cleanupSessions, activateToolCategory, getActivatedToolCategories } from '../session';
import { hookBus } from '../hooks';
import { runBootMd } from '../boot';
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
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import {
  buildTools as _buildTools,
  type BuildToolsDeps,
  type ToolResult,
  type TaskControlResponse,
  type ScheduleJobAction,
  normalizeScheduleJobAction,
  summarizeCronJob,
  normalizeDeliveryChannel,
  normalizeToolArgs,
  parseJsonLike,
  toStringRecord,
  parseLooseMap,
} from '../tool-builder';
import {
  executeTool as _executeTool,
  lastFilenameUsed,
  type ExecuteToolDeps,
} from '../agents-runtime/subagent-executor';
import {
  broadcastWS,
  broadcastTeamEvent,
  isModelBusy, setModelBusy,
  getLastMainSessionId, setLastMainSessionId,
} from '../comms/broadcaster';
import {
  getSessionSkillWindows,
  sessionCurrentTurn,
  recoverSkillsIfEmpty,
} from '../skills-runtime/skill-windows';
import { primarySupportsVision, buildVisionImagePart } from '../vision-chat';
import {
  separateThinkingFromContent,
  sanitizeFinalReply,
  stripExplicitThinkTags,
  normalizeForDedup,
  isGreetingLikeMessage,
} from '../comms/reply-processor';
import { addCanvasFile, getCanvasContextBlock } from '../routes/canvas-state';
import { getMCPManager } from '../mcp-manager';
import {
  buildBootStartupSnapshot as _buildBootStartupSnapshot,
  loadWorkspaceFile,
  readDailyMemoryContext,
  detectToolCategories,
  readMemoryCategories,
  readMemorySnippets,
  buildPersonalityContext as _buildPersonalityContext,
  TOOL_BLOCKS,
  TOOL_TO_MEMORY_CATS,
  type SkillWindow,
} from '../prompt-context';
import {
  browserOpen,
  browserSnapshot,
  browserClick,
  browserFill,
  browserPressKey,
  browserWait,
  browserScroll,
  browserClose,
  browserGetFocusedItem,
  browserGetPageText,
  getBrowserToolDefinitions,
  getBrowserSessionInfo,
  browserVisionScreenshot,
  browserVisionClick,
  browserVisionType,
  browserPreviewScreenshot,
  getLastBrowserScreenshot,
  clearLastBrowserScreenshot,
} from '../browser-tools';
import {
  desktopScreenshot,
  desktopFindWindow,
  desktopFocusWindow,
  desktopClick,
  desktopDrag,
  desktopWait,
  desktopType,
  desktopPressKey,
  desktopGetClipboard,
  desktopSetClipboard,
  desktopLaunchApp,
  desktopCloseApp,
  desktopGetProcessList,
  desktopWaitForChange,
  desktopDiffScreenshot,
  desktopScreenshotWithHistory,
  getDesktopToolDefinitions,
  getDesktopAdvisorPacket,
} from '../desktop-tools';
// ─── Block A (was server-v2.ts lines 375-705) ───────────────────────────────

type RuntimeProgressStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

export type RuntimeProgressItem = {
  id: string;
  text: string;
  status: RuntimeProgressStatus;
};

const preemptSessionCounts: Map<string, number> = new Map();

// Canvas session file tracking — see routes/canvas-state.ts
// addCanvasFile, getCanvasContextBlock imported from './routes/canvas-state'

export function prettifyToolName(name: string): string {
  return String(name || 'tool')
    .replace(/^browser_/, 'Browser ')
    .replace(/^desktop_/, 'Desktop ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^\w)|(\s\w)/g, (m) => m.toUpperCase());
}

export function normalizeProgressLine(line: string): string {
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text
    .replace(/^[\-\*\d\.\)\s]+/, '')
    .replace(/^step\s*\d+\s*[:.-]\s*/i, '')
    .slice(0, 96);
}

export function buildProgressItems(lines: string[]): RuntimeProgressItem[] {
  const cleaned = lines
    .map(normalizeProgressLine)
    .filter(Boolean)
    .slice(0, 6);
  return cleaned.map((text, i) => ({
    id: `p${i + 1}`,
    text,
    status: 'pending',
  }));
}

export function getPreemptSessionCount(sessionId: string): number {
  return preemptSessionCounts.get(String(sessionId || 'default')) || 0;
}

export function incrementPreemptSessionCount(sessionId: string): number {
  const id = String(sessionId || 'default');
  const next = getPreemptSessionCount(id) + 1;
  preemptSessionCounts.set(id, next);
  return next;
}

// Safe commands allowlist for run_command
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

const SAFE_COMMANDS: Record<string, string> = isWindows
  ? {
      'chrome': 'start chrome',
      'browser': 'start chrome',
      'firefox': 'start firefox',
      'edge': 'start msedge',
      'notepad': 'start notepad',
      'calc': 'start calc',
      'calculator': 'start calc',
      'explorer': 'start explorer',
      'terminal': 'start cmd',
      'cmd': 'start cmd',
      'powershell': 'start powershell',
    }
  : isMac
    ? {
        'chrome': 'open -a "Google Chrome"',
        'browser': 'open',
        'firefox': 'open -a "Firefox"',
        'edge': 'open -a "Microsoft Edge"',
        'notepad': 'open -a "TextEdit"',
        'calc': 'open -a "Calculator"',
        'calculator': 'open -a "Calculator"',
        'explorer': 'open .',
        'terminal': 'open -a "Terminal"',
        'cmd': 'open -a "Terminal"',
        'powershell': 'open -a "Terminal"',
      }
    : {
        'chrome': 'google-chrome',
        'browser': 'xdg-open',
        'firefox': 'firefox',
        'edge': 'microsoft-edge',
        'notepad': 'gedit',
        'calc': 'gnome-calculator',
        'calculator': 'gnome-calculator',
        'explorer': 'xdg-open .',
        'terminal': 'x-terminal-emulator',
        'cmd': 'x-terminal-emulator',
        'powershell': 'pwsh',
      };

function quoteShellArg(value: string): string {
  return `"${String(value || '').replace(/"/g, '\\"')}"`;
}

function buildUrlOpenCommand(url: string): string {
  if (isWindows) return `start "" ${quoteShellArg(url)}`;
  if (isMac) return `open ${quoteShellArg(url)}`;
  return `xdg-open ${quoteShellArg(url)}`;
}

function buildBrowserLaunchCommand(app: string, url: string): string {
  const appCmd = SAFE_COMMANDS[app] || SAFE_COMMANDS.browser;
  if (isWindows) return `${appCmd} ${quoteShellArg(url)}`;
  if (app === 'browser') return buildUrlOpenCommand(url);
  return `${appCmd} ${quoteShellArg(url)}`;
}

function hasUriScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(value || '').trim());
}

function normalizeWorkspacePathAliases(rawCmd: string, workspacePath: string): string {
  if (!isWindows) return rawCmd;
  return rawCmd.replace(/cd\s+(?:\/d\s+)?(["']?)\/workspace\1/ig, `cd /d "${workspacePath}"`);
}

function isAllowedShellSegment(segment: string): boolean {
  const cleaned = segment.trim().replace(/^\(+/, '');
  if (!cleaned) return true;
  const token = (cleaned.match(/^[^\s]+/)?.[0] || '').toLowerCase();
  const allowed = new Set([
    'cd', 'if', 'set', 'echo', 'dir', 'ls', 'pwd', 'cat', 'type', 'more', 'find', 'findstr', 'where', 'whoami',
    'git', 'npm', 'node', 'npx', 'yarn', 'pnpm', 'python', 'python3', 'pip', 'pip3', 'tsc', 'ts-node',
    'cargo', 'rustc', 'go', 'java', 'javac', 'mvn', 'gradle', 'dotnet', 'docker', 'kubectl', 'az', 'aws',
    'curl', 'wget', 'cmd', 'powershell', 'pwsh',
  ]);
  return allowed.has(token);
}

function isAllowedShellCommand(rawCmd: string): boolean {
  const segments = rawCmd.split(/&&|\|\||\||;/g).map(s => s.trim()).filter(Boolean);
  return segments.length > 0 && segments.every(isAllowedShellSegment);
}

async function runCommandCaptured(
  command: string,
  cwd: string,
  timeoutMs = 120000,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  const { spawn } = await import('child_process');
  return await new Promise(resolve => {
    const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash');
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-lc', command];
    const child = spawn(shell, shellArgs, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const maxOutputChars = 120000;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const capture = (existing: string, chunk: Buffer | string): string => {
      if (existing.length >= maxOutputChars) return existing;
      const next = existing + String(chunk);
      if (next.length <= maxOutputChars) return next;
      return next.slice(0, maxOutputChars);
    };

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout = capture(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = capture(stderr, chunk);
    });
    child.on('error', err => {
      stderr = capture(stderr, err.message || String(err));
      finish(null);
    });
    child.on('close', code => finish(code));
  });
}

const BLOCKED_PATTERNS = ['del ', 'rm ', 'format', 'shutdown', 'restart', 'rmdir', 'rd ', 'taskkill', 'reg '];

// ── Sub-Agent Tool Profiles ────────────────────────────────────────────────────────────
export type SubagentProfile = 'file_editor' | 'researcher' | 'shell_runner' | 'reader_only';
const TOOL_PROFILES: Record<SubagentProfile, Set<string>> = {
  file_editor:  new Set(['read_file', 'create_file', 'replace_lines', 'insert_after', 'delete_lines', 'find_replace', 'list_files', 'mkdir', 'list_directory']),
  researcher:   new Set(['read_file', 'list_files', 'web_search', 'web_fetch']),
  shell_runner: new Set(['run_command', 'read_file', 'list_files']),
  reader_only:  new Set(['read_file', 'list_files']),
};

// Track last-used filename per session for when model forgets to pass it
// lastFilenameUsed is imported from subagent-executor.ts

// Skills system
// Primary location: workspace/skills (AI has full read/write access here via file tools).
// Falls back to CONFIG_DIR_PATH/skills if no workspace is configured.
const _workspaceSkillsDir = (() => {
  try {
    const wp = getConfig().getWorkspacePath();
    return wp ? path.join(wp, 'skills') : null;
  } catch { return null; }
})();
const _config = getConfig().getConfig() as any;
const _configDirPath = getConfig().getConfigDir();
export const configuredSkillsDir = _config.skills?.directory ||
  _workspaceSkillsDir ||
  path.join(_configDirPath, 'skills');
export const fallbackSkillsDir = path.join(_configDirPath, 'skills');

export function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

export function syncMissingSkills(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceSkillDir = path.join(sourceDir, entry.name);
    const sourceSkillMd = path.join(sourceSkillDir, 'SKILL.md');
    if (!fs.existsSync(sourceSkillMd)) continue;

    const targetSkillDir = path.join(targetDir, entry.name);
    if (fs.existsSync(path.join(targetSkillDir, 'SKILL.md'))) continue;
    fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
  }
}

export function migrateSkillsStateIfMissing(targetDir: string): void {
  const targetStatePath = path.join(path.dirname(targetDir), 'skills_state.json');
  if (fs.existsSync(targetStatePath)) return;

  const sourceStatePath = path.join(path.dirname(fallbackSkillsDir), 'skills_state.json');
  if (!fs.existsSync(sourceStatePath)) return;

  fs.mkdirSync(path.dirname(targetStatePath), { recursive: true });
  fs.copyFileSync(sourceStatePath, targetStatePath);
}

export function resolveSkillsDir(configuredDir: string): string {
  const fallbackDir = fallbackSkillsDir;
  const targetDir = configuredDir || fallbackDir;

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    if (!samePath(targetDir, fallbackDir)) {
      syncMissingSkills(fallbackDir, targetDir);
      migrateSkillsStateIfMissing(targetDir);
    }
    return targetDir;
  } catch (err: any) {
    console.warn(`[Skills] Failed to prepare configured skills directory "${targetDir}": ${err.message}`);
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
}

// ─── Block C (was server-v2.ts lines 1074-1671) ──────────────────────────────

// Singletons injected from server-v2.ts at startup via initChatHelpers()
let _handleChat: any;
let _telegramChannel: any;
let _makeBroadcastForTask: any;

export function initChatHelpers(deps: {
  handleChat: any;
  telegramChannel: any;
  makeBroadcastForTask: any;
}): void {
  _handleChat = deps.handleChat;
  _telegramChannel = deps.telegramChannel;
  _makeBroadcastForTask = deps.makeBroadcastForTask;
}

// --- Hook: gateway:startup -> run BOOT.md ------------------------------------
// buildBootStartupSnapshot is imported from prompt-context.ts.
// This wrapper binds the local listTasks dependency.
function buildBootStartupSnapshot(workspacePath: string): string {
  return _buildBootStartupSnapshot(
    workspacePath,
    (opts: { status: string[] }) => listTasks({ status: opts.status as any }),
  );
}

hookBus.register('gateway:startup', async ({ workspacePath }) => {
  const startupSnapshot = buildBootStartupSnapshot(workspacePath);
  const bootResult = await runBootMd(workspacePath, async (message, sessionId, sendSSE) => {
    const bootContext = [
      'CONTEXT: Internal startup BOOT.md turn. All data has been pre-fetched and is in the snapshot below.',
      'Do NOT call any tools. Read the snapshot and write a 2-3 sentence startup summary.',
      '[BOOT STARTUP SNAPSHOT - pre-fetched runtime data, no tools needed]',
      startupSnapshot,
      '[/BOOT STARTUP SNAPSHOT]',
    ].join('\n\n');
    const effectiveSessionId = sessionId || `auto_boot_${Date.now()}`;
    setWorkspace(effectiveSessionId, workspacePath);
    clearHistory(effectiveSessionId);
    const result = await _handleChat(message, effectiveSessionId, sendSSE, undefined, undefined, bootContext);
    if (result?.text) {
      // Backward-compatible fallback for old clients still listening for boot_greeting.
      broadcastWS({ type: 'boot_greeting', text: result.text, sessionId: effectiveSessionId });
    }
    return { text: result.text };
  });

  if (bootResult?.status === 'ran' && bootResult.automatedSession) {
    broadcastWS({
      type: 'session_notification',
      sessionId: bootResult.sessionId,
      text: bootResult.reply,
      title: bootResult.title,
      source: bootResult.source,
      automatedSession: bootResult.automatedSession,
    });
  }
});

// --- Hook: command:new -> snapshot session before reset -----------------------
hookBus.register('command:new', async ({ sessionId, workspacePath }) => {
  const history = getHistory(sessionId, 10);
  if (history.length === 0) return;

  const memDir = path.join(workspacePath, 'memory');
  fs.mkdirSync(memDir, { recursive: true });

  const stamp = new Date().toISOString().replace('T', '_').slice(0, 16).replace(':', '-');
  const slug = String(sessionId || '').slice(0, 8) || 'default';
  const outPath = path.join(memDir, `${stamp}-${slug}.md`);
  const lines = history.map((m) => `**${m.role}**: ${String(m.content || '').slice(0, 300)}`);
  fs.writeFileSync(outPath, `# Session snapshot - ${stamp}\n\n${lines.join('\n\n')}\n`, 'utf-8');
  console.log(`[hooks:command:new] Saved session snapshot -> ${path.basename(outPath)}`);
});

// ─── Workspace Memory Loader ───────────────────────────────────────────────────

// loadWorkspaceFile, readDailyMemoryContext, detectToolCategories,
// TOOL_BLOCKS, TOOL_TO_MEMORY_CATS, readMemoryCategories, readMemorySnippets,
// buildPersonalityContext, logToDaily — all imported from prompt-context.ts.
// Only the local wrapper for buildPersonalityContext lives here.

// ─── buildPersonalityContext wrapper ────────────────────────────────────────────
// Bridges server-v2 local state (skillsManager, getSessionSkillWindows,
// sessionCurrentTurn) to the imported function.
export async function buildPersonalityContext(
  sessionId: string,
  workspacePath: string,
  messageText: string,
  executionMode: string,
  historyLength: number,
  skillsManager: any,
  extraCats?: Set<string>,
  options?: { profile?: 'default' | 'switch_model' | 'local_llm' },
): Promise<string> {
  return _buildPersonalityContext(
    sessionId,
    workspacePath,
    messageText,
    executionMode,
    historyLength,
    skillsManager,
    getSessionSkillWindows,
    (sid: string, turn: number) => { sessionCurrentTurn.set(sid, turn); },
    extraCats,
    options,
  );
}

// ─── Tiered Prompt System ─────────────────────────────────────────────────────
// detectToolCategories, TOOL_BLOCKS, TOOL_TO_MEMORY_CATS, readMemoryCategories,
// readMemorySnippets, TOOL_TO_MEMORY_CATS — imported from prompt-context.ts.
// detectToolCategories is imported from prompt-context.ts — no inline body needed.


// ─── Tool Definitions ──────────────────────────────────────────────────────────

// buildTools is imported from tool-builder.ts
export function buildTools(sessionId?: string) {
  const activatedCategories = sessionId ? getActivatedToolCategories(sessionId) : undefined;
  return _buildTools({ getMCPManager }, activatedCategories);
}

// ─── Auto-detect and activate tool categories on first turn ───────────────────
// Maps detected intent categories to tool categories and silently activates them.
export function autoActivateToolCategories(sessionId: string, message: string, historyLength: number): void {
  // Run on every turn so late-intent shifts (e.g., greeting first, then browser task)
  // still activate required tool categories in the same session.
  void historyLength; // retained for call-site compatibility
  const cats = detectToolCategories(message);
  const catMap: Partial<Record<string, string>> = {
    browser: 'browser',
    desktop: 'desktop',
    teams: 'team_ops',
    agents: 'team_ops',
    routing: 'team_ops',
    schedule: 'scheduling',
    integrations: 'integrations',
    // 'files' → not needed; file tools are core
    // 'source_write' requires explicit activation (code editing)
  };
  for (const [detectedCat, toolCat] of Object.entries(catMap)) {
    if (cats.has(detectedCat) && toolCat) {
      activateToolCategory(sessionId, toolCat);
    }
  }
}


// ─── Tool Execution ────────────────────────────────────────────────────────────
// executeTool is imported from subagent-executor.ts.
// This wrapper binds server-v2 singletons into ExecuteToolDeps.
export function executeTool(
  name: string,
  args: any,
  workspacePath: string,
  deps: any,
  sessionId: string = 'default',
): Promise<ToolResult> {
  return _executeTool(name, args, workspacePath, {
    ...deps,
    broadcastWS,
    broadcastTeamEvent,
    dispatchToAgent: _dispatchToAgent,
    isWindows,
    SAFE_COMMANDS,
    BLOCKED_PATTERNS,
    hasUriScheme,
    buildUrlOpenCommand,
    buildBrowserLaunchCommand,
    normalizeWorkspacePathAliases,
    isAllowedShellCommand,
    runCommandCaptured,
    getSessionSkillWindows,
    sessionCurrentTurn,
  }, sessionId);
}



// ─── Piece 5: _dispatchToAgent helper ────────────────────────────────────────

export async function _dispatchToAgent(
  agentId: string,
  message: string,
  context: string | undefined,
  parentSessionId: string,
): Promise<{ task_id: string; agent_id: string; status: string }> {
  const fullPrompt = context ? `${message}\n\n[CONTEXT]\n${context}` : message;
  const task = createTask({
    title: `[Dispatch] ${agentId}: ${message.slice(0, 60)}`,
    prompt: fullPrompt,
    sessionId: `dispatch_${agentId}_${Date.now()}`,
    channel: 'web',
    subagentProfile: agentId,
    parentTaskId: undefined,
    plan: [
      { index: 0, description: `Execute dispatched task for agent ${agentId}`, status: 'pending' },
      { index: 1, description: 'Return results', status: 'pending' },
    ],
  });
  // Immediately spin up a BackgroundTaskRunner for this dispatched task
  const runner = new BackgroundTaskRunner(task.id, _handleChat, _makeBroadcastForTask(task.id), _telegramChannel);
  runner.start().catch((err: any) => console.error(`[dispatch_to_agent] Runner error for ${task.id}:`, err?.message));
  broadcastWS({ type: 'agent_spawned', serverAgentId: task.id, name: agentId, task: message.slice(0, 100), isDispatched: true });
  return { task_id: task.id, agent_id: agentId, status: 'dispatched' };
}

export function logToolCall(workspacePath: string, toolName: string, args: any, result: string, error: boolean) {
  try {
    const logPath = path.join(workspacePath, 'tool_audit.log');
    const ts = new Date().toISOString();
    fs.appendFileSync(logPath, `[${ts}] ${error ? 'FAIL' : 'OK'} ${toolName}(${JSON.stringify(args).slice(0, 200)}) => ${result.slice(0, 200)}\n`);
  } catch {}
}
// Reply processor fns (separateThinkingFromContent etc.) extracted to reply-processor.ts

// ─── Main Chat Handler ─────────────────────────────────────────────────────────

export function isExecutionLikeRequest(message: string): boolean {
  const m = String(message || '');
  return /\b(create|build|implement|develop|scaffold|generate|fix|debug|edit|update|refactor|rewrite|patch|setup|configure|calendar|app|component|project|file|folder|directory|workspace|code|desktop|window|screen|mouse|keyboard|clipboard|vs code|vscode)\b/i.test(m);
}

export function isBrowserAutomationRequest(message: string): boolean {
  const m = String(message || '');
  const hasBrowserVerb = /\b(open|go to|navigate|visit|browse|click|type|fill|press|submit|log ?in|login|use my computer)\b/i.test(m);
  const hasTarget = /(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?/i.test(m)
    || /\b(chatgpt|google|reddit|x\.com|twitter|github|youtube)\b/i.test(m);
  return hasBrowserVerb && hasTarget;
}

export function isDesktopAutomationRequest(message: string): boolean {
  const m = String(message || '');
  const hasDesktopVerb = /\b(check|look|see|open|focus|click|type|press|read|copy|paste|use my computer|screenshot)\b/i.test(m);
  const hasDesktopTarget = /\b(desktop|screen|window|app|application|vs code|vscode|terminal|notepad|clipboard|codex)\b/i.test(m);
  const statusAsk = /\b(is|did|has).*\b(done|finished|complete|completed)\b/i.test(m);
  return (hasDesktopVerb && hasDesktopTarget) || (statusAsk && /\b(vs code|vscode|codex)\b/i.test(m));
}

export function extractLikelyUrl(message: string): string | null {
  const raw = String(message || '');
  const directUrlMatch = raw.match(/\bhttps?:\/\/[^\s)]+/i);
  const domainMatch = raw.match(/\b(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?/i);
  const url = (directUrlMatch?.[0] || domainMatch?.[0] || '').trim();
  if (!url) return null;
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return normalized.replace(/["'<>]/g, '');
}

export function looksLikeSafetyRefusal(text: string): boolean {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return false;
  return (
    /disallowed|can't (help|assist|do that|use your computer)|cannot (help|assist|do that|use your computer)|unable to (help|assist|do that)/i.test(s)
    || /i (can't|cannot) (control|operate|use) (your|the) computer/i.test(s)
    || /against (policy|safety)/i.test(s)
  );
}

export function looksLikeIntentOnlyReply(text: string): boolean {
  const s = String(text || '').trim();
  if (!s) return true;

  const intentPattern = /\b(first[, ]|next[, ]|then[, ]|let me|i(?:'| a)?ll|i will|i'm going to|i can|i should|i need to|before i|to start|we should)\b/i;
  const completionPattern = /\b(done|completed|created|updated|fixed|implemented|finished|here(?:'s| is)|built|saved|wrote|ran|executed)\b/i;
  const questionPattern = /\?$/.test(s) || /\bshould i|want me to|do you want\b/i.test(s);

  if (completionPattern.test(s) || questionPattern) return false;
  return intentPattern.test(s);
}

export function isContinuationCue(message: string): boolean {
  const s = String(message || '').trim().toLowerCase();
  if (!s) return false;
  return /^(ok|okay|yes|yep|sure|proceed|continue|go ahead|keep going|do it|try again|move on|all set|ready|done|fixed|i logged in|logged in|it's fixed|it is fixed)\.?$/.test(s);
}

export function hasPendingExecutionIntent(
  history: Array<{ role: string; content: string }>,
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') continue;
    const text = String(msg.content || '').trim();
    if (!text) continue;
    if (hasConcreteCompletion(text)) return false;
    return looksLikeIntentOnlyReply(text);
  }
  return false;
}

export function isHardBlockerReply(text: string): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/\?\s*$/.test(s)) return true;
  return /\b(blocked|cannot proceed|can't proceed|need (your|a|the)|missing|required)\b.*\b(token|credential|api key|password|permission|approval|decision|team id|path)\b/i.test(s);
}

export function hasConcreteCompletion(text: string): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  // Explicit completion keywords
  if (/\b(done|completed|created|updated|fixed|implemented|finished|saved|wrote|executed|here(?:'s| is) (?:the|your)|success(?:fully)?)\b/i.test(s)) return true;
  // Substantive answer: if the response is long enough (300+ chars) and doesn't end with
  // "I'll now..." or "Let me..." (intent-only), treat it as a concrete answer.
  // This prevents the checklist guard from looping on observational/descriptive responses.
  if (s.length >= 300 && !/\b(I('ll| will| need to|'m going to)|let me|next I|now I)\b[^.]{0,60}$/i.test(s)) return true;
  return false;
}

export function isBrowserToolName(name: string): boolean {
  return /^browser_(open|snapshot|click|fill|press_key|wait|scroll|scroll_collect|close|get_focused_item|get_page_text|vision_screenshot|vision_click|vision_type|send_to_telegram)$/i.test(String(name || ''));
}

export function isDesktopToolName(name: string): boolean {
  return /^desktop_(screenshot|get_monitors|window_screenshot|find_window|focus_window|click|drag|wait|type|type_raw|press_key|get_clipboard|set_clipboard|launch_app|close_app|get_process_list|wait_for_change|diff_screenshot|scroll|send_to_telegram)$/i.test(String(name || ''));
}

export function isHighStakesFile(filename: string): boolean {
  const f = String(filename || '').toLowerCase();
  return /(auth|billing|payment|security|secret|token|config|credential|oauth|permission|acl)/.test(f);
}

export function requestedFullTemplate(message: string): boolean {
  return /\b(full page|full template|full config|full layout|complete page|entire file|whole file)\b/i
    .test(String(message || ''));
}

export function resolveWorkspaceFilePath(workspacePath: string, filename: string): string {
  if (!filename) return '';
  if (path.isAbsolute(filename)) return filename;
  return path.join(workspacePath, filename);
}

export function collectFileSnapshots(
  workspacePath: string,
  files: string[],
  maxCharsPerFile: number = 3600,
): Array<{
  filename: string;
  exists: boolean;
  content_preview: string;
  line_count: number;
  char_count: number;
}> {
  const out: Array<{
    filename: string;
    exists: boolean;
    content_preview: string;
    line_count: number;
    char_count: number;
  }> = [];
  const seen = new Set<string>();
  for (const raw of files || []) {
    const fn = String(raw || '').trim();
    if (!fn) continue;
    if (seen.has(fn.toLowerCase())) continue;
    seen.add(fn.toLowerCase());

    const fp = resolveWorkspaceFilePath(workspacePath, fn);
    if (!fp) continue;
    if (!fs.existsSync(fp)) {
      out.push({
        filename: fn,
        exists: false,
        content_preview: '',
        line_count: 0,
        char_count: 0,
      });
      continue;
    }
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      const lines = content.split('\n');
      const numbered = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
      out.push({
        filename: fn,
        exists: true,
        content_preview: numbered.slice(0, maxCharsPerFile),
        line_count: lines.length,
        char_count: content.length,
      });
    } catch {
      out.push({
        filename: fn,
        exists: true,
        content_preview: '',
        line_count: 0,
        char_count: 0,
      });
    }
    if (out.length >= 10) break;
  }
  return out;
}

// ─── Browser tool result compaction (non-vision primaries) ─────────────────
// Short acknowledgments keep token use down; full snapshot/vision context is injected separately.
export function buildBrowserAck(toolName: string, result: ToolResult): string {
  const raw = String(result.result || '');
  const shortcutIdx = raw.indexOf('SITE SHORTCUTS FOR');
  const shortcutHint = shortcutIdx >= 0
    ? raw.slice(shortcutIdx).split('\n').slice(0, 6).join('\n')
    : '';
  if (result.error) {
    // On error the LLM does need to know what failed so it can decide next step
    return `${toolName} failed: ${result.result.slice(0, 200)}`;
  }
  const withShortcutHint = (base: string) => shortcutHint ? `${base}\n${shortcutHint}` : base;
  switch (toolName) {
    case 'browser_open':
      return withShortcutHint('Browser opened. Use the snapshot and your plan to choose the next browser_* step.');
    case 'browser_snapshot':
      return withShortcutHint('Snapshot captured. Use refs from the snapshot for the next action.');
    case 'browser_press_key':
      return withShortcutHint('Key pressed. Page may be updating — snapshot again if needed.');
    case 'browser_wait':
      return withShortcutHint('Wait complete.');
    case 'browser_click':
      return withShortcutHint('Clicked. Check snapshot or vision for the new state.');
    case 'browser_fill':
      return withShortcutHint('Input filled.');
    case 'browser_get_focused_item':
      return withShortcutHint('Focus checked.');
    default:
      return withShortcutHint(`${toolName} complete.`);
  }
}
export function buildDesktopAck(toolName: string, result: ToolResult): string {
  if (result.error) {
    return `${toolName} failed: ${result.result.slice(0, 200)}`;
  }
  switch (toolName) {
    case 'desktop_screenshot':
      return result.result;
    case 'desktop_get_monitors':
      return result.result;
    case 'desktop_window_screenshot':
      return result.result;
    case 'desktop_find_window':
      return result.result;
    case 'desktop_focus_window':
      return result.result;
    case 'desktop_click':
      return result.result;
    case 'desktop_drag':
      return result.result;
    case 'desktop_wait':
      return result.result;
    case 'desktop_type':
      return result.result;
    case 'desktop_press_key':
      return result.result;
    case 'desktop_get_clipboard':
      return result.result;
    case 'desktop_set_clipboard':
      return result.result;
    case 'desktop_launch_app':
      return result.result;
    case 'desktop_close_app':
      return result.result;
    case 'desktop_get_process_list':
      return result.result;
    case 'desktop_wait_for_change':
      return result.result;
    case 'desktop_diff_screenshot':
      return result.result;
    default:
      return result.result || `${toolName} complete.`;
  }
}

/**
 * Build the message content for a desktop_screenshot tool result.
 * - OpenAI primary: returns a multipart content array with the image + text description.
 * - Local model (Ollama etc.): returns the full rich text description only.
 * The text description always includes OCR text and window list for local models.
 */
/**
 * Build the TEXT content for a desktop screenshot tool result.
 * Always returns a string (OCR + metadata). Never returns image data.
 * The actual PNG image is injected separately via buildVisionScreenshotMessage().
 *
 * NOTE: OpenAI's API only supports image_url content parts in role:'user' messages,
 * NOT in role:'tool' messages. So we must inject screenshots as separate user messages.
 */
export function buildDesktopScreenshotContent(
  toolResult: ToolResult,
  sessionId: string,
  goalReminder: string,
): string {
  if (toolResult.error) {
    return toolResult.result + goalReminder;
  }

  const packet = getDesktopAdvisorPacket(sessionId);

  return [
    toolResult.result,
    packet?.ocrText ? `\nFull OCR text from screen:\n${packet.ocrText.slice(0, 4000)}` : '',
    primarySupportsVision() && packet?.screenshotBase64
      ? '\n[Screenshot image attached — you can see the current screen state above.]'
      : '',
    goalReminder,
  ].join('');
}

/**
 * Build a role:'user' vision message containing a screenshot PNG.
 * Returns null if vision is not supported or no screenshot is available.
 *
 * OpenAI only supports image_url in role:'user' messages, so we inject
 * the screenshot as a synthetic user message right after the tool result.
 *
 * @param source — 'desktop' reads from the desktop advisor packet,
 *                 or pass a raw { base64, width, height } for browser screenshots
 */
export function buildVisionScreenshotMessage(
  sessionId: string,
  source: 'desktop' | 'browser' | { base64: string; width: number; height: number },
): { role: string; content: any[] } | null {
  if (!primarySupportsVision()) return null;

  let base64: string | undefined;
  let label: string;

  if (source === 'desktop') {
    const packet = getDesktopAdvisorPacket(sessionId);
    base64 = packet?.screenshotBase64;
    label = 'Desktop screenshot';
  } else if (source === 'browser') {
    const cached = getLastBrowserScreenshot(sessionId);
    if (!cached) return null;
    base64 = cached.base64;
    label = `Browser screenshot (${cached.width}x${cached.height})`;
    // Consume the cached screenshot so it's not re-injected on subsequent tool calls
    clearLastBrowserScreenshot(sessionId);
  } else {
    base64 = source.base64;
    label = `Browser screenshot (${source.width}x${source.height})`;
  }

  if (!base64) return null;

  return {
    role: 'user',
    content: [
      buildVisionImagePart(base64, 'image/png'),
      {
        type: 'text',
        text: `[SYSTEM: ${label} — this is what the screen looks like right now. Use this visual to understand the current state.]`,
      },
    ],
  };
}

export function goalIsInteractiveAction(goal: string): boolean {
  // Returns true when the user's goal is to DO something on the page (post, click, fill, submit)
  // rather than READ or RESEARCH. Used to skip feed-collection mode on social feeds.
  return /\b(post|tweet|retweet|reply|send|publish|submit|compose|write.*tweet|make.*post|create.*post|type.*message|fill|click|navigate to|go to|open composer|draft)\b/i.test(String(goal || ''));
}

export function isBrowserHeavyResearchPage(input: {
  url?: string;
  pageType?: string;
  snapshotElements?: number;
  feedCount?: number;
  goal?: string;
}): boolean {
  const url = String(input.url || '').toLowerCase();
  const pageType = String(input.pageType || '').toLowerCase();
  const elements = Number(input.snapshotElements || 0);
  const feedCount = Number(input.feedCount || 0);

  if (pageType === 'x_feed' || pageType === 'search_results' || pageType === 'article') return true;
  if (feedCount >= 6) return true;
  if (elements >= 10) return true;
  return /(x\.com|twitter\.com|reddit\.com|google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com|news|search\?q=)/.test(url);
}

type SnapshotDiagnostics = {
  scanned: number;
  included: number;
  hidden: number;
  unlabeledNonInput: number;
  unnamedInputIncluded: number;
};

type BrowserSnapshotQuality = {
  low: boolean;
  reasons: string[];
  elementCount: number;
  inputCandidates: number;
  dominantRoles: string[];
  diagnostics: SnapshotDiagnostics | null;
};

export function goalLikelyNeedsTextInput(goal: string): boolean {
  const text = String(goal || '');
  return /\b(type|fill|enter|input|message|say|send|search|write|reply|post|submit|login|log ?in|chat|comment)\b/i.test(text);
}

export function parseSnapshotDiagnostics(snapshot: string): SnapshotDiagnostics | null {
  const m = String(snapshot || '').match(
    /Snapshot diagnostics:\s*scanned=([0-9]*)\s+included=([0-9]*)\s+hidden=([0-9]*)\s+unlabeled_non_input=([0-9]*)\s+unnamed_input_included=([0-9]*)/i,
  );
  if (!m) return null;
  const toInt = (x: string) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  };
  return {
    scanned: toInt(m[1]),
    included: toInt(m[2]),
    hidden: toInt(m[3]),
    unlabeledNonInput: toInt(m[4]),
    unnamedInputIncluded: toInt(m[5]),
  };
}

export function evaluateBrowserSnapshotQuality(snapshot: string, snapshotElements: number, goal: string): BrowserSnapshotQuality {
  const elementCount = Number.isFinite(Number(snapshotElements)) ? Math.max(0, Math.floor(Number(snapshotElements))) : 0;
  const roleCounts = new Map<string, number>();
  let inputCandidates = 0;

  for (const raw of String(snapshot || '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^\[@\d+\]\s+([a-z0-9_-]+)/i);
    if (!m) continue;
    const role = String(m[1] || '').toLowerCase();
    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    if (
      /\[INPUT\]/i.test(line)
      || role === 'textbox'
      || role === 'searchbox'
      || role === 'combobox'
      || role === 'textarea'
    ) {
      inputCandidates++;
    }
  }

  const dominantRoles = Array.from(roleCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([role, count]) => `${role}:${count}`);
  const diagnostics = parseSnapshotDiagnostics(snapshot);
  const reasons: string[] = [];
  const needsInput = goalLikelyNeedsTextInput(goal);
  if (elementCount < 10) reasons.push(`low_elements=${elementCount}`);
  if (needsInput && inputCandidates === 0) reasons.push('expected_input_but_none_detected');
  if (needsInput && inputCandidates === 0 && dominantRoles.length) {
    reasons.push(`top_roles=${dominantRoles.join(',')}`);
  }
  if (diagnostics && diagnostics.hidden > diagnostics.included) {
    reasons.push('many_hidden_candidates');
  }
  if (diagnostics && diagnostics.unlabeledNonInput > diagnostics.included) {
    reasons.push('many_unlabeled_non_input_candidates');
  }

  return {
    low: reasons.length > 0,
    reasons,
    elementCount,
    inputCandidates,
    dominantRoles,
    diagnostics,
  };
}

export interface HandleChatResult {
  type: 'chat' | 'execute';
  text: string;
  thinking?: string;
  toolResults?: ToolResult[];
}

// ─── Orchestration session stats stubs (multi-agent system removed) ───────────
type OrchestrationStats = { assistCount: number };
const _orchStats = new Map<string, OrchestrationStats>();
export function getOrchestrationSessionStats(sessionId: string): OrchestrationStats {
  if (!_orchStats.has(sessionId)) _orchStats.set(sessionId, { assistCount: 0 });
  return _orchStats.get(sessionId)!;
}
export const orchestrationSessionStats = _orchStats;
export function recordOrchestrationEvent(
  sessionId: string,
  _event: { trigger: string; mode?: string; reason?: string; route?: string },
  _cfg?: any,
): OrchestrationStats {
  return getOrchestrationSessionStats(sessionId);
}
export function ensureMultiAgentSkill(): void {
  // no-op: multi-agent skill system removed
}


