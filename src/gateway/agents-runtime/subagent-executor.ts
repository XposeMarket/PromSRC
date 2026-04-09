// src/gateway/subagent-executor.ts
// Tool execution engine — extracted from server-v2.ts (Step 14.1, Phase 3).
// Restored and adapted for dep-injected execution.

import fs from 'fs';
import path from 'path';
import { getConfig, getAgents, getAgentById } from '../../config/config';
import { getPolicyEngine } from '../policy';
import { appendAuditEntry } from '../audit-log';
import { webSearch, webFetch } from '../../tools/web';
import { executeAgentList, executeAgentInfo } from '../../tools/agent-control';
import { getMCPManager } from '../mcp-manager';
import { executeAgentBuilderTool } from './agent-builder-integration';
import { SubagentManager } from './subagent-manager';
import {
  listManagedTeams,
  createManagedTeam,
  getManagedTeam,
  saveManagedTeam,
  deleteManagedTeam,
  appendTeamChat,
} from '../teams/managed-teams';
import { triggerManagerReview, handleManagerConversation } from '../teams/team-manager-runner';
import { buildTeamDispatchTask } from '../teams/team-dispatch-runtime';
import { recordAgentRun, reloadAgentSchedules } from '../../scheduler';
import { getSessionChannelHint, linkTelegramSession } from '../comms/broadcaster';
import {
  browserOpen,
  browserSnapshot,
  browserClick,
  browserFill,
  browserPressKey,
  browserType,
  browserWait,
  browserScroll,
  browserClose,
  browserGetFocusedItem,
  browserGetPageText,
  browserVisionScreenshot,
  browserVisionClick,
  browserVisionType,
  browserSendToTelegram,
  browserScrollCollect,
  browserRunJs,
  browserInterceptNetwork,
  browserElementWatch,
  browserSnapshotDelta,
  browserExtractStructured,
} from '../browser-tools';
import {
  desktopScreenshot,
  desktopScreenshotWithHistory,
  parseDesktopScreenshotToolArgs,
  parseDesktopPointerMonitorArgs,
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
  desktopLaunchApp,
  desktopCloseApp,
  desktopGetProcessList,
  desktopGetMonitorsSummary,
  desktopWaitForChange,
  desktopDiffScreenshot,
  desktopWindowScreenshot,
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
import { backgroundSpawn, backgroundStatus, backgroundJoin, backgroundProgress } from '../tasks/task-runner';
import { saveSiteShortcut } from '../site-shortcuts';
import { deployAnalysisTeamTool } from '../../tools/deploy-analysis-team.js';
import { socialIntelTool } from '../../tools/social-scraper.js';
import {
  ALL_TOOL_CATEGORIES,
  normalizeScheduleJobAction,
  summarizeCronJob,
  normalizeDeliveryChannel,
  parseJsonLike,
  parseLooseMap,
  toStringRecord,
  type ToolResult,
  type TaskControlResponse,
} from '../tool-builder';
import { activateToolCategory } from '../session';
import { loadTask } from '../tasks/task-store';
import type { SkillWindow } from '../prompt-context';

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

// Track last-used filename per session for when model forgets to pass it.
export const lastFilenameUsed = new Map<string, string>();

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

  // ── Helper: resolve file paths for proposal sessions ──────────────────────
  // In proposal/code_exec sessions, src/ paths should resolve to PROJECT_ROOT/src/
  // (one level up from workspace) so edits land in the actual source tree.
  // All other paths resolve to workspace as normal.
  const _isProposalSession = isProposalExecutionSession(sessionId);
  function resolveFilePath(filename: string): string {
    const normalized = String(filename || '').replace(/\\/g, '/');
    if (_isProposalSession && normalized.startsWith('src/')) {
      return path.join(path.resolve(workspacePath, '..'), normalized);
    }
    return path.join(workspacePath, filename);
  }

  // [A4] Policy evaluation + audit trail — log every tool call, non-blocking
  try {
    const evaluation = getPolicyEngine().evaluateAction(sessionId, name, args);
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

  try {
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
          console.log(`[talk_to_subagent] Queued message for "${targetAgentId}" in team "${team.name}"`);
          return { name, args, result: `Message queued for ${targetAgentId} (team: ${team.name}). They will receive it on their next run.`, error: false };
        } catch (e: any) {
          return { name, args, result: `ERROR: ${e.message}`, error: true };
        }
      }

      case 'talk_to_manager': {
        const message = String(args?.message || '').trim();
        if (!message) return { name, args, result: 'ERROR: message is required', error: true };
        try {
          const { listManagedTeams: lmt, queueManagerMessage } = require('../teams/managed-teams');
          const teams = lmt();
          // Identify which team this agent belongs to from the sessionId (format: team_dispatch_<agentId>_<ts>)
          const fromAgentId = sessionId.startsWith('team_dispatch_')
            ? sessionId.replace(/^team_dispatch_/, '').replace(/_\d+$/, '')
            : '';
          const team = fromAgentId
            ? teams.find((t: any) => Array.isArray(t.subagentIds) && t.subagentIds.includes(fromAgentId))
            : null;
          if (!team) return { name, args, result: 'ERROR: talk_to_manager only works inside a team dispatch session. Could not identify team.', error: true };
          queueManagerMessage(team.id, fromAgentId, message);
          console.log(`[talk_to_manager] Agent "${fromAgentId}" queued message to manager in team "${team.name}"`);
          return { name, args, result: `Message sent to manager of team "${team.name}". They will see it on their next review cycle.`, error: false };
        } catch (e: any) {
          return { name, args, result: `ERROR: ${e.message}`, error: true };
        }
      }

      case 'list_files': {
        const files = fs.readdirSync(workspacePath).filter(f => {
          try { return fs.statSync(path.join(workspacePath, f)).isFile(); } catch { return false; }
        });
        return { name, args, result: JSON.stringify(files), error: false };
      }

      case 'read_file': {
        const filename = args.filename || args.name;
        if (!filename) return { name, args, result: 'filename is required', error: true };
        const _normalizedFn = String(filename || '').replace(/\\/g, '/');
        // Redirect src/ and root-allowlisted files to read_source, web-ui/ to read_webui_source
        const ROOT_READ_ALLOWLIST = ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'CHANGELOG.md'];
        if (_normalizedFn.startsWith('src/') || ROOT_READ_ALLOWLIST.includes(_normalizedFn)) {
          const redirectArgs = { ...args, file: filename };
          return executeTool('read_source', redirectArgs, workspacePath, deps, sessionId);
        }
        if (_normalizedFn.startsWith('web-ui/')) {
          const redirectArgs = { ...args, file: _normalizedFn.slice('web-ui/'.length) };
          return executeTool('read_webui_source', redirectArgs, workspacePath, deps, sessionId);
        }
        const filePath = path.join(workspacePath, filename);
        if (!fs.existsSync(filePath)) return { name, args, result: `File "${filename}" not found`, error: true };
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
          const numberedWindow = windowLines
            .map((line, i) => `${startLine + i}: ${line}`)
            .join('\n');
          const endLine = startLine + windowLines.length - 1;
          return {
            name,
            args,
            result: `${filename} (${allLines.length} lines) [window ${startLine}-${endLine}]:\n${numberedWindow}`,
            error: false,
          };
        }
        const numbered = allLines.map((line, i) => `${i + 1}: ${line}`).join('\n');
        return { name, args, result: `${filename} (${allLines.length} lines):\n${numbered}`, error: false };
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
        const filePath = path.join(workspacePath, String(filename));
        if (!fs.existsSync(filePath)) return { name, args, result: `File "${filename}" not found`, error: true };
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return { name, args, result: `"${filename}" is not a file`, error: true };
        const content = fs.readFileSync(filePath, 'utf-8');
        const lineCount = content.split('\n').length;
        const readCap = 240;
        const payload = {
          file: String(filename),
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
        const projectRoot = path.resolve(workspacePath, '..');
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

      case 'webui_source_stats':
      case 'webui_stats': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'file path is required', error: true };
        const projectRoot = path.resolve(workspacePath, '..');
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
        const filePath = path.join(workspacePath, String(filename));
        if (!fs.existsSync(filePath)) return { name, args, result: `File "${filename}" not found`, error: true };
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return { name, args, result: `"${filename}" is not a file`, error: true };
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
          file: String(filename),
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
        const rootDir = path.resolve(workspacePath);
        const searchDir = path.resolve(path.join(workspacePath, String(directoryArg)));
        const relCheck = path.relative(rootDir, searchDir);
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
          return { name, args, result: `Directory "${directoryArg}" is outside workspace`, error: true };
        }
        if (!fs.existsSync(searchDir)) return { name, args, result: `"${directoryArg}" not found`, error: true };
        if (!fs.statSync(searchDir).isDirectory()) {
          return { name, args, result: `"${directoryArg}" is not a directory`, error: true };
        }
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, args.case_insensitive ? 'gi' : 'g');
        } catch {
          return { name, args, result: `Invalid regex pattern: ${pattern}`, error: true };
        }
        const rawGlob = String((name === 'grep_files' ? args.glob : args.file_glob) || args.file_glob || args.glob || '')
          .trim()
          .toLowerCase();
        const globs = rawGlob ? rawGlob.split(',').map((g: string) => g.trim()).filter(Boolean) : [];
        const contextLines = Math.max(0, Math.min(5, Math.floor(Number(args.context ?? args.context_lines) || 0)));
        const maxResults = Math.max(1, Math.min(500, Math.floor(Number(args.max_results) || 100)));
        const matches: Array<{
          file: string;
          line_number: number;
          line: string;
          context_before?: string[];
          context_after?: string[];
        }> = [];
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
            const rel = path.relative(workspacePath, abs).replace(/\\/g, '/');
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
              const item: {
                file: string;
                line_number: number;
                line: string;
                context_before?: string[];
                context_after?: string[];
              } = {
                file: rel,
                line_number: i + 1,
                line: lines[i],
              };
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
          directory: path.relative(workspacePath, searchDir).replace(/\\/g, '/') || '.',
          pattern,
          match_count: matches.length,
          matches,
        };
        return { name, args, result: JSON.stringify(payload, null, 2), error: false };
      }

      case 'grep_webui_source':
      case 'grep_source': {
        // Unified search across src/ and/or web-ui/ (read-only)
        // grep_webui_source defaults root to 'web-ui'; grep_source defaults to 'src'
        const gs_pattern = String(args.pattern || '');
        if (!gs_pattern) return { name, args, result: 'pattern is required', error: true };

        const gs_projectRoot = path.resolve(workspacePath, '..');
        const gs_srcRoot = path.join(gs_projectRoot, 'src');
        const gs_webUiRoot = path.join(gs_projectRoot, 'web-ui');

        // Determine which roots to search
        const gs_defaultRoot = name === 'grep_webui_source' ? 'web-ui' : 'src';
        const gs_rootParam = String(args.root || gs_defaultRoot).toLowerCase();
        const gs_searchBoth = gs_rootParam === 'both';
        const gs_useSrc = gs_searchBoth || gs_rootParam === 'src';
        const gs_useWebUi = gs_searchBoth || gs_rootParam === 'web-ui';

        // Build glob filter
        const gs_rawGlob = String(args.glob || '').trim().toLowerCase();
        const gs_globs = gs_rawGlob ? gs_rawGlob.split(',').map((g: string) => g.trim()).filter(Boolean) : [];

        // Parse options
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

        // Build search directories (path param applies only when searching a single root)
        const gs_rawPath = gs_searchBoth ? '' : String(args.path || '').trim();
        if (gs_useSrc) {
          const gs_srcSubdir = gs_rawPath ? path.resolve(gs_srcRoot, gs_rawPath) : gs_srcRoot;
          if (!gs_srcSubdir.startsWith(gs_srcRoot)) {
            return { name, args, result: `ERROR: path "${gs_rawPath}" is outside src/`, error: true };
          }
          if (!fs.existsSync(gs_srcSubdir)) {
            return { name, args, result: `Directory not found: src/${gs_rawPath}`, error: true };
          }
          gs_walkDir(gs_srcSubdir, gs_srcRoot, 'src');
        }
        if (gs_useWebUi) {
          const gs_webUiSubdir = gs_rawPath ? path.resolve(gs_webUiRoot, gs_rawPath) : gs_webUiRoot;
          if (!gs_webUiSubdir.startsWith(gs_webUiRoot)) {
            return { name, args, result: `ERROR: path "${gs_rawPath}" is outside web-ui/`, error: true };
          }
          if (!fs.existsSync(gs_webUiSubdir)) {
            return { name, args, result: `Directory not found: web-ui/${gs_rawPath}`, error: true };
          }
          gs_walkDir(gs_webUiSubdir, gs_webUiRoot, 'web-ui');
        }

        const gs_searchedLabel = gs_searchBoth ? 'src/ + web-ui/' : (gs_useSrc ? 'src/' + (gs_rawPath ? gs_rawPath : '') : 'web-ui/' + (gs_rawPath ? gs_rawPath : ''));
        const gs_payload = {
          searched: gs_searchedLabel,
          pattern: gs_pattern,
          match_count: gs_matches.length,
          matches: gs_matches,
        };
        return { name, args, result: JSON.stringify(gs_payload, null, 2), error: false };
      }

      case 'create_file': {
        const filename = args.filename || args.name;
        const filePath = resolveFilePath(filename);
        if (fs.existsSync(filePath)) return { name, args, result: `"${filename}" already exists. Use replace_lines or insert_after to edit.`, error: true };
        // Auto-create parent directories so agents can write nested paths like src/app/layout.tsx
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, args.content || '', 'utf-8');
        return { name, args, result: `${filename} created`, error: false };
      }

      case 'replace_lines': {
        const filename = args.filename || args.name;
        const startLine = Math.max(1, Math.floor(Number(args.start_line) || 1));
        const endLine = Math.max(startLine, Math.floor(Number(args.end_line) || startLine));
        const newContent = args.new_content || '';
        const filePath = resolveFilePath(filename);
        if (!fs.existsSync(filePath)) return { name, args, result: `"${filename}" not found`, error: true };
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        if (startLine > lines.length) return { name, args, result: `Line ${startLine} past end (${lines.length} lines)`, error: true };
        const end = Math.min(endLine, lines.length);
        lines.splice(startLine - 1, end - startLine + 1, ...newContent.split('\n'));
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        return { name, args, result: `${filename}: replaced lines ${startLine}-${end} (now ${lines.length} lines)`, error: false };
      }

      case 'insert_after': {
        const filename = args.filename || args.name;
        const afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
        const content = String(args.content || '').replace(/\\n/g, '\n');
        const filePath = resolveFilePath(filename);
        if (!fs.existsSync(filePath)) return { name, args, result: `"${filename}" not found`, error: true };
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        const insertAt = Math.min(afterLine, lines.length);
        lines.splice(insertAt, 0, ...content.split('\n'));
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        return { name, args, result: `${filename}: inserted after line ${afterLine} (now ${lines.length} lines)`, error: false };
      }

      case 'delete_lines': {
        const filename = args.filename || args.name;
        const startLine = Math.max(1, Math.floor(Number(args.start_line) || 1));
        const endLine = Math.max(startLine, Math.floor(Number(args.end_line) || startLine));
        const filePath = resolveFilePath(filename);
        if (!fs.existsSync(filePath)) return { name, args, result: `"${filename}" not found`, error: true };
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        const end = Math.min(endLine, lines.length);
        lines.splice(startLine - 1, end - startLine + 1);
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        return { name, args, result: `${filename}: deleted lines ${startLine}-${end} (now ${lines.length} lines)`, error: false };
      }

      case 'find_replace': {
        const filename = args.filename || args.name;
        const find = args.find || '';
        const replace = args.replace ?? '';
        const filePath = resolveFilePath(filename);
        if (!fs.existsSync(filePath)) return { name, args, result: `"${filename}" not found`, error: true };
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes(find)) return { name, args, result: `Text not found. Use read_file to check exact content.`, error: true };
        const doReplaceAll = args.replace_all === true;
        const updated = doReplaceAll ? content.split(find).join(replace) : content.replace(find, replace);
        const count = doReplaceAll ? content.split(find).length - 1 : 1;
        fs.writeFileSync(filePath, updated, 'utf-8');
        return { name, args, result: `${filename} updated (${count} occurrence${count !== 1 ? 's' : ''} replaced)`, error: false };
      }

      case 'delete_file': {
        const filename = args.filename || args.name;
        const filePath = resolveFilePath(filename);
        if (!fs.existsSync(filePath)) return { name, args, result: `"${filename}" not found`, error: true };
        fs.unlinkSync(filePath);
        return { name, args, result: `${filename} deleted`, error: false };
      }

      case 'write_file': {
        const filename = String(args.filename || args.name || '');
        if (!filename) return { name, args, result: 'filename is required', error: true };
        const filePath = resolveFilePath(filename);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, String(args.content || ''), 'utf-8');
        const lineCount = String(args.content || '').split('\n').length;
        return { name, args, result: `${filename} written (${lineCount} lines)`, error: false };
      }

      case 'rename_file': {
        const oldRel = String(args.old_path || args.old_filename || '');
        const newRel = String(args.new_path || args.new_filename || '');
        if (!oldRel) return { name, args, result: 'old_path is required', error: true };
        if (!newRel) return { name, args, result: 'new_path is required', error: true };
        const oldAbs = resolveFilePath(oldRel);
        const newAbs = resolveFilePath(newRel);
        if (!fs.existsSync(oldAbs)) return { name, args, result: `"${oldRel}" not found`, error: true };
        if (fs.existsSync(newAbs)) return { name, args, result: `"${newRel}" already exists`, error: true };
        fs.mkdirSync(path.dirname(newAbs), { recursive: true });
        fs.renameSync(oldAbs, newAbs);
        return { name, args, result: `Renamed ${oldRel} → ${newRel}`, error: false };
      }

      case 'mkdir': {
        const dirRel = String(args.path || args.dir || '').replace(/\\/g, '/');
        if (!dirRel) return { name, args, result: 'path is required', error: true };
        const dirAbs = path.join(workspacePath, dirRel);
        fs.mkdirSync(dirAbs, { recursive: true });
        return { name, args, result: `Directory "${dirRel}" ready`, error: false };
      }

      case 'list_directory': {
        const dirRel = String(args.path || args.dir || '.').replace(/\\/g, '/') || '.';
        const dirAbs = path.join(workspacePath, dirRel);
        if (!fs.existsSync(dirAbs)) return { name, args, result: `"${dirRel}" not found`, error: true };
        function walkDir(base: string, rel: string): string[] {
          const entries = fs.readdirSync(base);
          const result: string[] = [];
          for (const entry of entries) {
            const entryRel = rel ? `${rel}/${entry}` : entry;
            const entryAbs = path.join(base, entry);
            try {
              const stat = fs.statSync(entryAbs);
              if (stat.isDirectory()) {
                result.push(`[DIR]  ${entryRel}/`);
                result.push(...walkDir(entryAbs, entryRel));
              } else {
                result.push(`[FILE] ${entryRel}`);
              }
            } catch { /* skip */ }
          }
          return result;
        }
        const lines = walkDir(dirAbs, dirRel === '.' ? '' : dirRel);
        return { name, args, result: lines.length ? lines.join('\n') : '(empty)', error: false };
      }

      // ── read_source: read a file from src/ or allowed project-root files ──────
      case 'read_source': {
        const rel = String(args.file || args.filename || args.path || '').replace(/\\/g, '/');
        if (!rel) return { name, args, result: 'ERROR: file path required.', error: true };
        // Resolve relative to project root (one level up from workspace)
        const projectRoot = path.resolve(workspacePath, '..');
        const srcRoot = path.join(projectRoot, 'src');

        // Allow a small allowlist of project-root files (read-only, non-sensitive)
        const ROOT_ALLOWLIST = ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'CHANGELOG.md'];
        const normalizedRel = rel.replace(/^\.?\//, '');
        if (ROOT_ALLOWLIST.includes(normalizedRel)) {
          const rootFile = path.join(projectRoot, normalizedRel);
          if (!fs.existsSync(rootFile)) {
            return { name, args, result: `File not found: ${normalizedRel}`, error: true };
          }
          const content = fs.readFileSync(rootFile, 'utf-8');
          const allLines = content.split('\n');
          const head = args.head ? Number(args.head) : 0;
          const tail = args.tail ? Number(args.tail) : 0;
          const startLine = args.start_line ? Math.max(1, Math.floor(Number(args.start_line))) : 0;
          const numLines = args.num_lines ? Math.max(1, Math.floor(Number(args.num_lines))) : 0;
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
          return { name, args, result: `${normalizedRel} (${allLines.length} lines):\n${numbered}`, error: false };
        }

        // Otherwise must stay inside src/
        const absPath = path.resolve(srcRoot, rel.replace(/^\.?\/?src\//, ''));
        if (!absPath.startsWith(srcRoot)) {
          return { name, args, result: `ERROR: read_source only allows access to src/ or root files (${ROOT_ALLOWLIST.join(', ')}).`, error: true };
        }
        if (!fs.existsSync(absPath)) {
          return { name, args, result: `File not found: src/${rel.replace(/^\.?\/?src\//, '')}. Use list_source to browse available files.`, error: true };
        }
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          const entries = fs.readdirSync(absPath).map(e => {
            const s = fs.statSync(path.join(absPath, e));
            return s.isDirectory() ? `[DIR]  ${e}/` : `[FILE] ${e}`;
          });
          return { name, args, result: entries.join('\n') || '(empty directory)', error: false };
        }
        const content = fs.readFileSync(absPath, 'utf-8');
        const relDisplay = 'src/' + absPath.slice(srcRoot.length + 1).replace(/\\/g, '/');
        const allLines = content.split('\n');
        const head = args.head ? Number(args.head) : 0;
        const tail = args.tail ? Number(args.tail) : 0;
        const startLine = args.start_line ? Math.max(1, Math.floor(Number(args.start_line))) : 0;
        const numLines = args.num_lines ? Math.max(1, Math.floor(Number(args.num_lines))) : 0;
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
        return { name, args, result: `${relDisplay} (${allLines.length} lines):\n${numbered}`, error: false };
      }

      // ── find_replace_source: surgical text swap in src/ (proposal sessions only) ───
      case 'find_replace_source': {
        const frs_sid = String(sessionId || '');
        if (!isProposalExecutionSession(frs_sid)) {
          return { name, args, result: 'ERROR: find_replace_source is only available in proposal execution sessions. Use write_proposal to request src/ changes from regular sessions.', error: true };
        }
        const frs_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
        const frs_find = String(args.find || '');
        const frs_replace = String(args.replace ?? '');
        if (!frs_rel) return { name, args, result: 'ERROR: file path required', error: true };
        if (!frs_find) return { name, args, result: 'ERROR: find text required', error: true };
        const frs_projectRoot = path.resolve(workspacePath, '..');
        const frs_srcRoot = path.join(frs_projectRoot, 'src');
        const frs_absPath = path.resolve(frs_srcRoot, frs_rel.replace(/^\.?\/?src\//, ''));
        if (!frs_absPath.startsWith(frs_srcRoot)) {
          return { name, args, result: 'ERROR: find_replace_source only allows access to src/ directory.', error: true };
        }
        if (!fs.existsSync(frs_absPath)) {
          return { name, args, result: `File not found: src/${frs_rel.replace(/^\.?\/?src\//, '')}. Use list_source to verify path.`, error: true };
        }
        const frs_content = fs.readFileSync(frs_absPath, 'utf-8');
        if (!frs_content.includes(frs_find)) {
          return { name, args, result: `Text not found in src/${frs_rel.replace(/^\.?\/?src\//, '')}. Use read_source to confirm exact text including whitespace.`, error: true };
        }
        const frs_replaceAll = args.replace_all === true;
        const frs_updated = frs_replaceAll
          ? frs_content.split(frs_find).join(frs_replace)
          : frs_content.replace(frs_find, frs_replace);
        const frs_occurrences = frs_replaceAll ? (frs_content.split(frs_find).length - 1) : 1;
        fs.writeFileSync(frs_absPath, frs_updated, 'utf-8');
        const frs_display = 'src/' + frs_absPath.slice(frs_srcRoot.length + 1).replace(/\\/g, '/');
        console.log(`[edit_source] find_replace_source: ${frs_display} (session: ${frs_sid})`);
        return { name, args, result: `✅ ${frs_display} updated (${frs_occurrences} occurrence${frs_occurrences !== 1 ? 's' : ''} replaced). Call run_command({command:"npm run build", shell:true}) to compile and verify.`, error: false };
      }

      // ── replace_lines_source: line-based edit in src/ (proposal sessions only) ──
      case 'replace_lines_source': {
        const rls_sid = String(sessionId || '');
        if (!isProposalExecutionSession(rls_sid)) {
          return { name, args, result: 'ERROR: replace_lines_source is only available in proposal execution sessions. Use write_proposal to request src/ changes from regular sessions.', error: true };
        }
        const rls_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
        const rls_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
        const rls_end = Math.max(rls_start, Math.floor(Number(args.end_line) || rls_start));
        const rls_newContent = String(args.new_content || '');
        if (!rls_rel) return { name, args, result: 'ERROR: file path required', error: true };
        const rls_projectRoot = path.resolve(workspacePath, '..');
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
        console.log(`[edit_source] replace_lines_source: ${rls_display} lines ${rls_start}-${rls_endClamped} (session: ${rls_sid})`);
        return { name, args, result: `✅ ${rls_display}: replaced lines ${rls_start}-${rls_endClamped} (now ${rls_lines.length} lines). Call run_command({command:"npm run build", shell:true}) to compile and verify.`, error: false };
      }

      // ── insert_after_source: insert lines after a given line in src/ ─────────
      case 'insert_after_source': {
        const ias_sid = String(sessionId || '');
        if (!isProposalExecutionSession(ias_sid)) {
          return { name, args, result: 'ERROR: insert_after_source is only available in proposal execution sessions.', error: true };
        }
        const ias_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
        const ias_afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
        const ias_content = String(args.content || '');
        if (!ias_rel) return { name, args, result: 'ERROR: file path required', error: true };
        const ias_projectRoot = path.resolve(workspacePath, '..');
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
        return { name, args, result: `✅ ${ias_display}: inserted after line ${ias_afterLine} (now ${ias_lines.length} lines). Call run_command({command:"npm run build", shell:true}) to compile and verify.`, error: false };
      }

      // ── delete_lines_source: delete a range of lines from a src/ file ─────────
      case 'delete_lines_source': {
        const dls_sid = String(sessionId || '');
        if (!isProposalExecutionSession(dls_sid)) {
          return { name, args, result: 'ERROR: delete_lines_source is only available in proposal execution sessions.', error: true };
        }
        const dls_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
        const dls_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
        const dls_end = Math.max(dls_start, Math.floor(Number(args.end_line) || dls_start));
        if (!dls_rel) return { name, args, result: 'ERROR: file path required', error: true };
        const dls_projectRoot = path.resolve(workspacePath, '..');
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
        return { name, args, result: `✅ ${dls_display}: deleted lines ${dls_start}-${dls_endClamped} (now ${dls_lines.length} lines). Call run_command({command:"npm run build", shell:true}) to compile and verify.`, error: false };
      }

      // ── write_source: create or overwrite a file in src/ ─────────────────────
      case 'write_source': {
        const ws_sid = String(sessionId || '');
        if (!isProposalExecutionSession(ws_sid)) {
          return { name, args, result: 'ERROR: write_source is only available in proposal execution sessions.', error: true };
        }
        const ws_rel = String(args.file || args.filename || '').replace(/\\/g, '/');
        const ws_content = String(args.content || '');
        const ws_overwrite = args.overwrite !== false;
        if (!ws_rel) return { name, args, result: 'ERROR: file path required', error: true };
        const ws_projectRoot = path.resolve(workspacePath, '..');
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
        return { name, args, result: `✅ ${ws_display} written (${ws_lineCount} lines). Call run_command({command:"npm run build", shell:true}) to compile and verify.`, error: false };
      }

      // ── list_source: list files/dirs inside src/ ──────────────────────────────
      case 'list_source': {
        const rel = String(args.path || args.dir || '').replace(/\\/g, '/').replace(/^\.?\/?src\/?/, '') || '';
        const projectRoot = path.resolve(workspacePath, '..');
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
        const lwu_projectRoot = path.resolve(workspacePath, '..');
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
        const rwu_projectRoot = path.resolve(workspacePath, '..');
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
        if (!isProposalExecutionSession(frwu_sid)) {
          return { name, args, result: 'ERROR: find_replace_webui_source is only available in proposal execution sessions. Use write_proposal to request web-ui/ changes from regular sessions.', error: true };
        }
        const frwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const frwu_find = String(args.find || '');
        const frwu_replace = String(args.replace ?? '');
        if (!frwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
        if (!frwu_find) return { name, args, result: 'ERROR: find text required', error: true };
        const frwu_projectRoot = path.resolve(workspacePath, '..');
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
        if (!isProposalExecutionSession(rlwu_sid)) {
          return { name, args, result: 'ERROR: replace_lines_webui_source is only available in proposal execution sessions.', error: true };
        }
        const rlwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const rlwu_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
        const rlwu_end = Math.max(rlwu_start, Math.floor(Number(args.end_line) || rlwu_start));
        const rlwu_newContent = String(args.new_content || '');
        if (!rlwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
        const rlwu_projectRoot = path.resolve(workspacePath, '..');
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
        if (!isProposalExecutionSession(iawu_sid)) {
          return { name, args, result: 'ERROR: insert_after_webui_source is only available in proposal execution sessions.', error: true };
        }
        const iawu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const iawu_afterLine = Math.max(0, Math.floor(Number(args.after_line) || 0));
        const iawu_content = String(args.content || '');
        if (!iawu_rel) return { name, args, result: 'ERROR: file path required', error: true };
        const iawu_projectRoot = path.resolve(workspacePath, '..');
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
        if (!isProposalExecutionSession(dlwu_sid)) {
          return { name, args, result: 'ERROR: delete_lines_webui_source is only available in proposal execution sessions.', error: true };
        }
        const dlwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const dlwu_start = Math.max(1, Math.floor(Number(args.start_line) || 1));
        const dlwu_end = Math.max(dlwu_start, Math.floor(Number(args.end_line) || dlwu_start));
        if (!dlwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
        const dlwu_projectRoot = path.resolve(workspacePath, '..');
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
        if (!isProposalExecutionSession(wwu_sid)) {
          return { name, args, result: 'ERROR: write_webui_source is only available in proposal execution sessions.', error: true };
        }
        const wwu_rel = String(args.file || args.filename || '').replace(/\\/g, '/').replace(/^\.?\/?web-ui\//, '');
        const wwu_content = String(args.content || '');
        const wwu_overwrite = args.overwrite !== false;
        if (!wwu_rel) return { name, args, result: 'ERROR: file path required', error: true };
        const wwu_projectRoot = path.resolve(workspacePath, '..');
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
        const resultStr = tr?.stdout ?? tr?.error ?? JSON.stringify(tr);
        return { name, args, result: resultStr, error: tr?.success === false };
      }

      case 'present_file': {
        const filePath = String(args?.path || args?.filename || '').trim();
        if (!filePath) return { name, args, result: 'ERROR: path is required', error: true };
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
        if (!fs.existsSync(absPath)) return { name, args, result: `File not found: ${filePath}`, error: true };
        const relPath = path.isAbsolute(filePath) ? path.relative(workspacePath, absPath) : filePath;
        return { name, args, result: `File presented in canvas: ${relPath}`, error: false };
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
        const result = await webFetch(args.url || '');
        return { name, args, result, error: result.startsWith('Fetch failed') || result.startsWith('Fetch error') || result.startsWith('Fetch timed') };
      }

      case 'run_command': {
        const rawCmd = (args.command || '').trim();
        if (!rawCmd) return { name, args, result: 'command is required', error: true };
        const cmd = rawCmd.toLowerCase();
        // Check blocked patterns
        for (const blocked of deps.BLOCKED_PATTERNS) {
          if (cmd.includes(blocked.toLowerCase())) {
            return { name, args, result: `Blocked: "${cmd}" contains unsafe pattern "${blocked}"`, error: true };
          }
        }

        const normalizedCmd = deps.normalizeWorkspacePathAliases(rawCmd, workspacePath);
        const wantVisible = args.visible === true || args.window === true;
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
            const projectRoot = path.resolve(workspacePath, '..');
            const cwd = fs.existsSync(path.join(projectRoot, 'package.json')) ? projectRoot : workspacePath;
            try {
              const captured = await deps.runCommandCaptured(normalizedCmd, cwd, 120_000);
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
              const exitLabel = captured.timedOut ? 'TIMED OUT' : `exit ${captured.code ?? '?'}`;
              return {
                name, args,
                result: `${normalizedCmd} [${exitLabel}]\n${output.slice(0, 4000) || '(no output)'}`,
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
            const projectRoot = path.resolve(workspacePath, '..');
            const cwd = fs.existsSync(path.join(projectRoot, 'package.json')) ? projectRoot : workspacePath;
            try {
              const captured = await deps.runCommandCaptured(normalizedCmd, cwd, 120_000);
              const output = [captured.stdout, captured.stderr].filter(Boolean).join('\n').trim();
              const exitLabel = captured.timedOut ? 'TIMED OUT' : `exit ${captured.code ?? '?'}`;
              return {
                name, args,
                result: `${normalizedCmd} [${exitLabel}]\n${output.slice(0, 4000) || '(no output)'}`,
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
          exec(execCmd);
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
          const status = backgroundSpawn({
            prompt,
            spawnerSessionId: sessionId,
            joinPolicy: args.join_policy || 'wait_until_timeout',
            timeoutMs: args.timeout_ms,
            tags: args.tags,
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
                // Merge registry definition into create_if_missing (caller fields take priority)
                createIfMissing = {
                  name: createIfMissing?.name || roleDef.name || (fromRole.charAt(0).toUpperCase() + fromRole.slice(1)),
                  description: createIfMissing?.description || roleDef.description || '',
                  system_instructions: createIfMissing?.system_instructions ||
                    (args.specialization
                      ? `${roleDef.system_prompt}\n\n[SPECIALIZATION]\n${args.specialization}`
                      : roleDef.system_prompt || ''),
                  allowed_categories: createIfMissing?.allowed_categories || roleDef.default_categories || [],
                  forbidden_tools: createIfMissing?.forbidden_tools || [],
                  constraints: createIfMissing?.constraints || [],
                  success_criteria: createIfMissing?.success_criteria || `Complete the assigned task and post the done signal.`,
                  max_steps: createIfMissing?.max_steps || 20,
                  model: createIfMissing?.model || roleDef.model || undefined,
                  roleType: fromRole,
                };
              } else {
                console.warn(`[spawn_subagent] Role registry file not found: ${registryPath}`);
              }
            } catch (roleErr: any) {
              console.warn(`[spawn_subagent] Failed to load role "${fromRole}": ${roleErr.message}`);
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
            const teamContext = String(args.team_context || args.teamContext || '').trim();
            if (!teamName || !teamContext) {
              return { name, args, result: 'team_manage(create) requires name and team_context', error: true };
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

            appendTeamChat(teamId, {
              from: 'user',
              fromName: 'Team Owner',
              content: `Session started (task: ${kickoffTask})`,
            });
            deps.broadcastTeamEvent({ type: 'team_chat_message', teamId, teamName: team.name });

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

            appendTeamChat(teamId, {
              from: 'manager',
              fromName: '?? Manager',
              content: `?? Dispatched one-off task to ${agentId}: ${task}`,
            });
            deps.broadcastTeamEvent({ type: 'team_dispatch', teamId, teamName: team.name, agentId, task });

            (async () => {
              try {
                const dispatchPrompt = buildTeamDispatchTask({
                  agentId,
                  task,
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
                appendTeamChat(teamId, {
                  from: 'subagent',
                  fromName: agentId,
                  fromAgentId: agentId,
                  content: result.success
                    ? `? Task complete: ${String(result.result || '')}`
                    : `? Task failed: ${result.error || 'unknown error'}`,
                });
                deps.broadcastTeamEvent({
                  type: 'team_dispatch_complete',
                  teamId,
                  teamName: team.name,
                  agentId,
                  success: result.success,
                  resultPreview: String(result.result || result.error || ''),
                });
                // NOTE: Do NOT trigger a full manager review here - dispatches are transient actions,
                // not subagent scheduled completions. Reviews only fire on scheduled agent runs.
              } catch (err: any) {
                appendTeamChat(teamId, {
                  from: 'subagent',
                  fromName: agentId,
                  fromAgentId: agentId,
                  content: `? Dispatch failed: ${err.message}`,
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
            `1. Analyze the purpose — pick 2-4 roles that cover the ongoing work`,
            `2. For each role, call spawn_subagent with:`,
            `   - subagent_id: "<role>_<shortname>_v1" (e.g. "researcher_growth_v1")`,
            `   - from_role: "<role>" (e.g. "researcher")`,
            `   - specialization: one sentence describing this agent's specific focus for THIS purpose`,
            `   - run_now: false`,
            `3. Call team_manage(action="create") with:`,
            `   - name, purpose (the static team purpose — NOT a one-time task), subagent_ids (all created agents)`,
            `   - originating_session_id: "${originatingSessionId}"`,
            `   PURPOSE NOTE: The team's purpose is static ("why this team exists"). Each run, the coordinator reads memory files and generates a fresh task from accumulated context. Do NOT set purpose to a one-time task — it should be an enduring mandate.`,
            `4. Respond with a brief summary: team name, team_id, agents created, purpose, status "ready (not started)".`,
            `5. End with this exact follow-up question to the main agent:`,
            `   "Team is ready. Would you like to start it now? If yes, what should the first task be?"`,
            ``,
            `STRICT RULES:`,
            `- Maximum 5 agents`,
            `- Do NOT ask questions — make decisions and act`,
            `- Do NOT use browser, desktop, scheduling, or memory tools`,
            `- Do NOT create nested teams`,
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
          
          if (t.includes('daily') || t.includes('every day')) {
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
          } else if (t.includes('monday') || t.includes('tuesday') || t.includes('wednesday') || t.includes('thursday') || t.includes('friday')) {
            const timeInfo = extractTime(t);
            if (timeInfo) {
              cron = `${timeInfo.minute} ${timeInfo.hour} * * 1-5`;
              preview = `Weekdays at ${String(timeInfo.hour).padStart(2, '0')}:${String(timeInfo.minute).padStart(2, '0')}`;
            } else {
              cron = '0 9 * * 1-5';
              preview = 'Weekdays at 09:00';
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
        const result = await browserOpen(sessionId, args.url || '');
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_snapshot': {
        const result = await browserSnapshot(sessionId);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_click': {
        const result = await browserClick(sessionId, Number(args.ref || 0));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_fill': {
        const result = await browserFill(sessionId, Number(args.ref || 0), String(args.text || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_press_key':
      case 'browser_key': {
        const result = await browserPressKey(sessionId, String(args.key || 'Enter'));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_type': {
        const result = await browserType(sessionId, String(args.text || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_wait': {
        const result = await browserWait(sessionId, Number(args.ms || 2000));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_scroll': {
        const dir = String(args.direction || 'down').toLowerCase() === 'up' ? 'up' : 'down';
        const result = await browserScroll(sessionId, dir, Number(args.multiplier || 1));
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_close': {
        const result = await browserClose(sessionId);
        return { name, args, result, error: false };
      }
      case 'browser_get_focused_item': {
        const result = await browserGetFocusedItem(sessionId);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_get_page_text': {
        const result = await browserGetPageText(sessionId);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_send_to_telegram': {
        const caption = String(args.caption || 'Browser screenshot');
        const result = await browserSendToTelegram(sessionId, caption, deps.telegramChannel);
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Vision fallback tools (Component 3)
      case 'browser_vision_screenshot': {
        const vshot = await browserVisionScreenshot(sessionId);
        if (!vshot) return { name, args, result: 'ERROR: No browser session. Use browser_open first.', error: true };
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
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_vision_type': {
        const result = await browserVisionType(
          sessionId,
          Number(args.x),
          Number(args.y),
          String(args.text || ''),
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Browser power tools
      case 'browser_scroll_collect': {
        const result = await browserScrollCollect(sessionId, {
          scrolls: args.scrolls != null ? Number(args.scrolls) : undefined,
          direction: args.direction === 'up' ? 'up' : 'down',
          multiplier: args.multiplier != null ? Number(args.multiplier) : undefined,
          delay_ms: args.delay_ms != null ? Number(args.delay_ms) : undefined,
          stop_text: args.stop_text != null ? String(args.stop_text) : undefined,
          max_chars: args.max_chars != null ? Number(args.max_chars) : undefined,
        });
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_run_js': {
        const result = await browserRunJs(sessionId, String(args.code || ''));
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
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_snapshot_delta': {
        const result = await browserSnapshotDelta(sessionId);
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'browser_extract_structured': {
        const result = await browserExtractStructured(sessionId, args.schema || args || {});
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
          focus_first: args.focus_first === true,
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
      case 'desktop_click': {
        const result = await desktopClick(
          Number(args.x),
          Number(args.y),
          String(args.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          args.double_click === true,
          parseDesktopPointerMonitorArgs(args),
          args.modifier === 'shift' || args.modifier === 'ctrl' || args.modifier === 'alt'
            ? args.modifier
            : undefined,
        );
        return { name, args, result, error: result.startsWith('ERROR') };
      }
      case 'desktop_drag': {
        const result = await desktopDrag(
          Number(args.from_x),
          Number(args.from_y),
          Number(args.to_x),
          Number(args.to_y),
          Number(args.steps || 20),
          parseDesktopPointerMonitorArgs(args),
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
        const result = await desktopSetClipboard(String(args.text || ''));
        return { name, args, result, error: result.startsWith('ERROR') };
      }

      // Phase 4: App launch / process control
      case 'desktop_launch_app': {
        const result = await desktopLaunchApp(
          String(args.app || ''),
          String(args.args || ''),
          Number(args.wait_ms || 6000),
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
        const result = await desktopScroll(
          dir === 'up' || dir === 'left' ? (dir as 'up' | 'left') : (dir === 'right' ? 'right' : 'down'),
          Number(args.amount || 3),
          args.x !== undefined ? Number(args.x) : undefined,
          args.y !== undefined ? Number(args.y) : undefined,
          dir === 'left' || dir === 'right',
          parseDesktopPointerMonitorArgs(args),
        );
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
            schedule: a.schedule || null,
          }));
          const lines = agentSummaries.map((a: any) =>
            `- ${a.id}${a.default ? ' (default)' : ''}: ${a.description}${a.schedule ? ` [scheduled: ${a.schedule}]` : ''}`
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
          if (!out.record) return { name, args, result: `Record not found: ${recordId}`, error: true };
          return { name, args, result: JSON.stringify(out, null, 2), error: false };
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
            const { appendJournal } = require('../tasks/task-store');
            appendJournal(taskId, {
              type: 'write_note',
              content: `[${noteTag}] ${noteContent.slice(0, 300)}`,
              detail: noteContent.slice(0, 2000),
            });
          } catch {}
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
        const slLines = all.map((s: any) =>
          `${s.emoji} ${s.id}${s.enabled ? ' [PINNED]' : ''} - ${s.description || '(no description)'}`
        ).join('\n');
        return {
          name, args,
          result: `${all.length} skill${all.length !== 1 ? 's' : ''} available:\n${slLines}\n\nTo read a skill: skill_read("<id>")\nTo save a new skill: skill_create(id, name, instructions, ...)`,
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
          return { name, args, result: `${skill.emoji} ${skill.name} (${skillId})\n\n${content}`, error: false };
        } catch {
          // Fallback to stored instructions if file read fails
          return { name, args, result: `${skill.emoji} ${skill.name} (${skillId})\n\n${skill.instructions}`, error: false };
        }
      }

      case 'skill_enable': {
        // Legacy compat - reads and returns skill content. Preferred: skill_list() -> skill_read(id)
        const skillId = String(args.id || '').trim();
        const skill = deps.skillsManager.get(skillId);
        if (!skill) {
          return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available skills.`, error: true };
        }
        const body = skill.instructions.length > 2000
          ? skill.instructions.slice(0, 2000) + '...'
          : skill.instructions;
        return {
          name, args,
          result: `${skill.emoji} ${skill.name}\n\n${body}\n\nTip: Use skill_read("${skill.id}") to read the full content.`,
          error: false,
        };
      }

      case 'skill_disable': {
        // No-op - skills no longer have session state. Pinning is managed via UI.
        const skillId = String(args.id || '').trim();
        return {
          name, args,
          result: `Skill "${skillId}" noted. Skills are managed via pinning (UI) and reading as needed.`,
          error: false,
        };
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

        // ── self_improve ──────────────────────────────────────
        if (name === 'self_improve') {
          try {
            const {
              getSelfImproveSummary, getLatestReportFormatted,
              formatSchedulePerformanceForPrompt, getErrorSummaryForPrompt,
              getGoalsSummaryForPrompt, getRecentChangelog,
              getPendingProposalsSummary, getPendingSkillEvolutions,
              addChangelogEntry, getProvenPatterns,
            } = require('../proposals/self-improvement-api');
            const { getConfig: gc } = require('../../config/config');
            const { CronScheduler: _cs } = require('../scheduling/cron-scheduler');

            // Load jobs list for schedule performance queries
            let jobs: any[] = [];
            try {
              const storePath = require('path').join(gc().getConfigDir(), 'jobs', 'jobs.json');
              const raw = JSON.parse(require('fs').readFileSync(storePath, 'utf-8'));
              jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
            } catch { jobs = []; }

            const action = String(args.action || '').trim();
            let result = '';

            if (action === 'get_summary') {
              const s = getSelfImproveSummary();
              result = JSON.stringify(s, null, 2);
            } else if (action === 'get_latest_report') {
              result = getLatestReportFormatted();
            } else if (action === 'get_schedule_health') {
              result = formatSchedulePerformanceForPrompt(jobs);
            } else if (action === 'get_error_summary') {
              result = getErrorSummaryForPrompt();
            } else if (action === 'get_goals') {
              result = getGoalsSummaryForPrompt();
            } else if (action === 'get_changelog') {
              result = getRecentChangelog(Number(args.limit) || 10);
            } else if (action === 'get_pending_proposals') {
              result = getPendingProposalsSummary();
            } else if (action === 'get_pending_skills') {
              result = getPendingSkillEvolutions();
            } else if (action === 'add_changelog_entry') {
              if (!args.change || !args.reason) {
                return { name, args, result: 'add_changelog_entry requires change and reason', error: true };
              }
              addChangelogEntry(
                String(args.change),
                String(args.reason),
                args.job_name ? String(args.job_name) : undefined,
                args.expected_impact ? String(args.expected_impact) : undefined,
              );
              result = 'Changelog entry recorded.';
            } else if (action === 'get_proven_patterns') {
              result = getProvenPatterns(String(args.category || 'general'));
            } else {
              return { name, args, result: `Unknown self_improve action: ${action}`, error: true };
            }

            return { name, args, result: result || '(no data)', error: false };
          } catch (err: any) {
            return { name, args, result: `self_improve error: ${err.message}`, error: true };
          }
        }

        // ── write_proposal ──────────────────────────────────────
        if (name === 'write_proposal') {
          if (isProposalExecutionSession(sessionId)) {
            return {
              name,
              args,
              result: 'BLOCKED: write_proposal is disabled during approved proposal execution. Execute the approved edits directly and complete the task; do not create a new proposal from inside proposal execution.',
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
            const { submitStandaloneProposal: submitProposal } = require('../proposals/self-improvement-api');
            const proposal = submitProposal({
              type: args.type || 'general',
              priority: args.priority || 'medium',
              title: String(args.title || '').slice(0, 120),
              summary: String(args.summary || '').slice(0, 500),
              details: String(args.details || ''),
              sourceAgentId: sessionId || 'unknown',
              sourceSessionId: String(sessionId || '') || undefined,
              sourcePipeline: args.source_pipeline,
              affectedFiles: Array.isArray(args.affected_files) ? args.affected_files : [],
              diffPreview: args.diff_preview,
              estimatedImpact: args.estimated_impact,
              requiresBuild: args.requires_build === true,
              executorAgentId: args.executor_agent_id,
              executorPrompt: args.executor_prompt,
              riskTier: args.risk_tier === 'low' || args.risk_tier === 'high' ? args.risk_tier : undefined,
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
            const { getTeamForAgent } = require('../teams/managed-teams');
            const { postMessage, getTeamState } = require('../teams/team-state');
            const team = getTeamForAgent(args.agent_id === 'all' || args.agent_id === 'manager'
              ? (sessionId.startsWith('team_dispatch_') ? sessionId.split('_')[2] : '')
              : args.agent_id);
            // Determine which team this agent belongs to from the session
            const fromAgentId = sessionId.startsWith('team_dispatch_')
              ? sessionId.split('_')[2]
              : 'main';
            // Find team by scanning — the agent might be the sender, not the target
            let teamId = '';
            try {
              const { listManagedTeams } = require('../teams/managed-teams');
              const teams = listManagedTeams();
              for (const t of teams) {
                if ((t.subagentIds || []).includes(fromAgentId) || (t.subagentIds || []).includes(args.agent_id)) {
                  teamId = t.id;
                  break;
                }
              }
            } catch {}
            if (!teamId) {
              return { name, args, result: 'ERROR: Could not determine team context. This tool works within team sessions.', error: true };
            }
            const { getAgentById } = require('../../config/config');
            const fromAgent = getAgentById(fromAgentId);
            const state = getTeamState(teamId);
            const msg = postMessage(teamId, {
              from: fromAgentId,
              fromName: fromAgent?.name || fromAgentId,
              to: args.agent_id || 'all',
              content: String(args.message || ''),
              type: args.type || 'chat',
              roundNumber: state.currentRound,
            });
            return { name, args, result: `Message sent to ${args.agent_id}: "${String(args.message || '').slice(0, 80)}"`, error: false };
          } catch (err: any) {
            return { name, args, result: `talk_to_teammate error: ${err.message}`, error: true };
          }
        }

        if (name === 'update_my_status') {
          try {
            const { updateAgentStatus, getTeamState } = require('../teams/team-state');
            const { listManagedTeams } = require('../teams/managed-teams');
            const fromAgentId = sessionId.startsWith('team_dispatch_')
              ? sessionId.split('_')[2]
              : 'main';
            let teamId = '';
            const teams = listManagedTeams();
            for (const t of teams) {
              if ((t.subagentIds || []).includes(fromAgentId)) { teamId = t.id; break; }
            }
            if (!teamId) {
              return { name, args, result: 'ERROR: Could not determine team context.', error: true };
            }
            const status = updateAgentStatus(teamId, fromAgentId, {
              phase: args.phase || 'executing',
              currentTask: args.current_task,
              blockedReason: args.blocked_reason,
              roundResult: args.result,
            });
            return { name, args, result: `Status updated: ${status.phase}${status.currentTask ? ' — ' + status.currentTask.slice(0, 60) : ''}`, error: false };
          } catch (err: any) {
            return { name, args, result: `update_my_status error: ${err.message}`, error: true };
          }
        }

        if (name === 'update_team_goal') {
          try {
            const { addGoal, updateGoal, getTeamState, postMessage } = require('../teams/team-state');
            const { listManagedTeams } = require('../teams/managed-teams');
            const fromAgentId = sessionId.startsWith('team_dispatch_')
              ? sessionId.split('_')[2]
              : 'main';
            let teamId = '';
            const teams = listManagedTeams();
            for (const t of teams) {
              if ((t.subagentIds || []).includes(fromAgentId)) { teamId = t.id; break; }
            }
            if (!teamId) {
              return { name, args, result: 'ERROR: Could not determine team context.', error: true };
            }
            const state = getTeamState(teamId);
            if (args.goal_id) {
              const updated = updateGoal(teamId, args.goal_id, {
                description: args.description,
                priority: args.priority,
                status: args.status,
              });
              if (!updated) return { name, args, result: `Goal ${args.goal_id} not found.`, error: true };
              postMessage(teamId, {
                from: fromAgentId, fromName: fromAgentId,
                to: 'all', content: `Goal updated: ${args.description} (reason: ${args.reason})`,
                type: 'goal_update', roundNumber: state.currentRound,
              });
              return { name, args, result: `Goal ${args.goal_id} updated: ${args.description}`, error: false };
            } else {
              const goal = addGoal(teamId, {
                description: args.description,
                priority: args.priority || 'medium',
                status: args.status || 'active',
                createdBy: fromAgentId,
              });
              postMessage(teamId, {
                from: fromAgentId, fromName: fromAgentId,
                to: 'all', content: `New goal proposed: ${args.description} (reason: ${args.reason})`,
                type: 'goal_update', roundNumber: state.currentRound,
              });
              return { name, args, result: `Goal created: ${goal.id} — ${args.description}`, error: false };
            }
          } catch (err: any) {
            return { name, args, result: `update_team_goal error: ${err.message}`, error: true };
          }
        }

        if (name === 'share_artifact') {
          try {
            const { shareArtifact } = require('../teams/team-state');
            const { listManagedTeams } = require('../teams/managed-teams');
            const fromAgentId = sessionId.startsWith('team_dispatch_')
              ? sessionId.split('_')[2]
              : 'main';
            let teamId = '';
            const teams = listManagedTeams();
            for (const t of teams) {
              if ((t.subagentIds || []).includes(fromAgentId)) { teamId = t.id; break; }
            }
            if (!teamId) {
              return { name, args, result: 'ERROR: Could not determine team context.', error: true };
            }
            const artifact = shareArtifact(teamId, {
              name: args.name,
              type: args.type || 'data',
              content: args.content,
              path: args.path,
              createdBy: fromAgentId,
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
              const VALID_TYPES = ['main_chat', 'proposal_executor_high_risk', 'proposal_executor_low_risk', 'manager', 'subagent', 'background_task'];
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

        if (name === 'request_tool_category') {
          const rawCategory = String(args?.category || '').trim().toLowerCase();
          if (!rawCategory) {
            return { name, args, result: `request_tool_category requires category. Valid: ${ALL_TOOL_CATEGORIES.join(', ')}`, error: true };
          }
          if (!ALL_TOOL_CATEGORIES.includes(rawCategory as any)) {
            return { name, args, result: `Invalid category "${rawCategory}". Valid: ${ALL_TOOL_CATEGORIES.join(', ')}`, error: true };
          }
          activateToolCategory(sessionId, rawCategory);
          return { name, args, result: `Tool category "${rawCategory}" activated for session ${sessionId}.`, error: false };
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
