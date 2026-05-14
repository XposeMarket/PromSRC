/**
 * background-task-runner.ts
 *
 * Executes a TaskRecord autonomously in the background, detached from any HTTP request.
 * Agent-driven step completion: the AI calls step_complete() to advance the plan.
 * No external auditor. No per-round verification LLM call.
 *
 * Stall detection: if 10 tool calls fire with no step_complete, inject a nudge.
 * Stall counter resets automatically when any write/mutate tool fires (real progress).
 */

import * as path from 'path';
import * as fs from 'fs';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import {
  loadTask,
  saveTask,
  createTask,
  updateTaskStatus,
  setTaskStepRunning,
  appendJournal,
  mutatePlan,
  updateResumeContext,
  updateTaskRuntimeProgress,
  resolveSubagentCompletion,
  writeToEvidenceBus,
  loadEvidenceBus,
  type TaskRecord,
  type PauseReason,
  type TaskPauseSnapshot,
} from './task-store';
import { clearHistory, addMessage, getHistory, flushSession, activateToolCategory, clearSessionMutationScope, setSessionMutationScope, setWorkspace } from '../session';
import {
  buildTaskPauseSnapshot,
  formatTaskPauseSnapshot,
  getTaskRecoveryNoToolsFilter,
  getTaskRecoverySessionId,
  isTaskRecoveryEligible,
  syncTaskRecoverySession,
} from './task-recovery';
import { errorCategorizer } from '../errors/error-categorizer';
import { getRetryStrategy } from '../retry-strategy';
import { getErrorAnalyzer } from '../errors/error-analyzer';
import { getErrorHistory } from '../errors/error-history';
import {
  createProposal,
  loadProposal,
  markProposalExecuting,
  markProposalRepairing,
  type Proposal,
  type ProposalAffectedFile,
} from '../proposals/proposal-store';
import {
  DEV_SRC_SELF_EDIT_MODE,
  DEV_SRC_SELF_EDIT_REPAIR_MODE,
  promoteDevSrcSelfEditWorkspace,
} from '../proposals/dev-src-self-edit.js';
import type { ProposalRepairContext } from '../proposals/repair-context.js';
// task-self-healer / synthesis round removed — lastResultSummary is delivered directly
import { runWithWorkspace } from '../../tools/workspace-context';
import {
	  formatTelegramProgressState,
	  formatTelegramToolCall,
	  formatTelegramToolResult,
	  inferActorFromTask,
	} from '../comms/telegram-tool-log';
import { buildObsoleteBrandBlockMessage, containsObsoleteProductBrand } from '../scheduled-output-guard';
import { appendSubagentChatMessage } from '../agents-runtime/subagent-chat-store';

// ─── Globals ──────────────────────────────────────────────────────────────────
const pauseRequests = new Set<string>();
const activeRunners = new Set<string>();
const taskAbortSignals = new Map<string, { aborted: boolean }>();  // Per-task abort signals for immediate pause

const MAX_RESUME_MESSAGES = 10;
const BACKGROUND_SESSION_MAX_MESSAGES = 40;
const DEFAULT_ROUND_TIMEOUT_MS = 120_000;
// How long to wait after the LAST tool call before timing out a round.
// This resets on every tool_call SSE event so slow-starting models don't
// burn the budget before their first tool fires.
const INACTIVITY_TIMEOUT_MS = 120_000;
// After this many tool calls with no step_complete, inject a nudge.
const STALL_TOOL_CALL_THRESHOLD = 10;
// Tools that indicate real write progress — reset stall counter when fired.
const MUTATE_TOOLS = new Set([
		  'find_replace', 'find_replace_source',
	  'find_replace_webui_source', 'find_replace_prom',
	  'replace_lines', 'replace_lines_source',
	  'replace_lines_webui_source', 'replace_lines_prom',
	  'insert_after_source', 'insert_after_webui_source', 'insert_after_prom',
	  'delete_lines_source', 'delete_lines_webui_source', 'delete_lines_prom',
	  'write_source', 'write_webui_source', 'write_prom_file',
	  'create_file', 'write_file', 'append_file',
	  'write_note', 'delete_file', 'delete_source', 'delete_webui_source', 'delete_prom_file', 'rename_file',
	  'browser_fill', 'browser_click',
	]);

const BUILD_INVALIDATING_TOOLS = new Set([
  'find_replace', 'find_replace_source',
  'find_replace_webui_source', 'find_replace_prom',
  'replace_lines', 'replace_lines_source',
  'replace_lines_webui_source', 'replace_lines_prom',
  'insert_after', 'insert_after_source', 'insert_after_webui_source', 'insert_after_prom',
  'delete_lines', 'delete_lines_source', 'delete_lines_webui_source', 'delete_lines_prom',
  'write_source', 'write_webui_source', 'write_prom_file',
  'create_file', 'write_file', 'append_file',
  'delete_file', 'delete_source', 'delete_webui_source', 'delete_prom_file', 'rename_file', 'mkdir',
]);

function resolveRoundTimeoutMs(isResearchTask?: boolean): number {
  const candidates = [
    process.env.LOCALCLAW_BG_ROUND_TIMEOUT_MS,
    process.env.LOCALCLAW_TASK_ROUND_TIMEOUT_MS,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 10_000) return Math.floor(n);
  }
  if (isResearchTask) return 300_000;
  return DEFAULT_ROUND_TIMEOUT_MS;
}

function buildSubagentToolFilter(subagentProfile: string | undefined): string[] | undefined {
  void subagentProfile;
  // Standalone subagents inherit the main runtime tool surface. Keep this hook
  // only for future explicit filters; the default must remain unrestricted.
  return undefined;
}

function looksLikeClarificationQuestion(text: string): boolean {
  if (!text || text.length < 20) return false;
  const t = text.trim();
  const hasQuestion = t.includes('?');
  const hasNeedPhrasing = /\b(i need|please (provide|tell|give|let me know|share|specify)|to complete this|before i can|in order to|could you (provide|tell|share|confirm|clarify|give)|what (exactly|should|would|tone|text|content|do you want))\b/i.test(t);
  if (!hasQuestion && !hasNeedPhrasing) return false;
  const strongSignals = [
    /\bwhat (exactly|should|would|tone|text|content|link|hashtag|word.?for.?word)\b/i,
    /\bplease (provide|tell me|share|let me know|specify|give me)\b/i,
    /\bi need (you to|the|your|exact|more|a|an|to know)\b/i,
    /\bto complete this (step|task|request)\b/i,
    /\b(tell me|let me know)\b.*\?/i,
    /\b(word.?for.?word|exact text|exact wording|exact content)\b/i,
    /\b(1[\)\.]|2[\)\.]|3[\)\.]).*\n.*(1[\)\.]|2[\)\.])/i,
  ];
  return strongSignals.some(re => re.test(t));
}

function extractClarificationQuestion(text: string): string {
  return text.trim().slice(0, 800);
}

function isProposalLikeSourceSessionId(sessionId: string): boolean {
  const sid = String(sessionId || '');
  return sid.startsWith('proposal_') || sid.startsWith('code_exec');
}

const BUILD_FAILURE_PROM_ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'README.md',
  'CHANGELOG.md',
  'SELF.md',
  'AGENTS.md',
]);

function normalizeProjectRelativePath(rawPath: unknown): string {
  return String(rawPath || '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '')
    .replace(/:\d+(?::\d+)?$/, '');
}

function isProposalRelevantPath(normalizedPath: string): boolean {
  if (!normalizedPath) return false;
  if (normalizedPath.startsWith('src/')) return true;
  if (normalizedPath.startsWith('web-ui/')) return true;
  const topLevel = normalizedPath.split('/')[0] || '';
  return BUILD_FAILURE_PROM_ROOT_FILES.has(normalizedPath)
    || ['.prometheus', 'scripts', 'electron', 'build', 'dist'].includes(topLevel);
}

function extractBuildFailurePaths(buildOutput: string): string[] {
  const text = String(buildOutput || '').replace(/\r/g, '\n');
  const matches = new Set<string>();
  const pathPatterns = [
    /\b(?:src|web-ui|\.prometheus|scripts|electron|build|dist)[\\/][A-Za-z0-9._\-\\/]+(?:\.[A-Za-z0-9._-]+)\b(?::\d+(?::\d+)?)?/g,
    /\b(?:package\.json|package-lock\.json|tsconfig\.json|README\.md|CHANGELOG\.md|SELF\.md|AGENTS\.md)\b/g,
  ];
  for (const pattern of pathPatterns) {
    for (const rawMatch of text.match(pattern) || []) {
      const normalized = normalizeProjectRelativePath(rawMatch);
      if (isProposalRelevantPath(normalized)) matches.add(normalized);
    }
  }
  return Array.from(matches);
}

function mergeBuildFailureAffectedFiles(originalProposal: Proposal | null, buildOutput: string): ProposalAffectedFile[] {
  const merged = new Map<string, ProposalAffectedFile>();
  for (const file of Array.isArray(originalProposal?.affectedFiles) ? originalProposal!.affectedFiles : []) {
    const normalized = normalizeProjectRelativePath(file?.path);
    if (!isProposalRelevantPath(normalized)) continue;
    merged.set(normalized, {
      path: normalized,
      action: file?.action === 'create' || file?.action === 'delete' ? file.action : 'edit',
      description: String(file?.description || 'Touched by the original approved proposal.'),
    });
  }
  for (const normalized of extractBuildFailurePaths(buildOutput)) {
    if (merged.has(normalized)) continue;
    merged.set(normalized, {
      path: normalized,
      action: 'edit',
      description: 'Referenced directly in the build failure output.',
    });
  }
  return Array.from(merged.values()).slice(0, 16);
}

function buildRepairAffectedFiles(task: TaskRecord, originalProposal: Proposal | null, buildOutput: string): ProposalAffectedFile[] {
  if (!isDevSrcProposalTask(task)) {
    return mergeBuildFailureAffectedFiles(originalProposal, buildOutput);
  }

  const originalFiles = new Map<string, ProposalAffectedFile>();
  for (const file of Array.isArray(originalProposal?.affectedFiles) ? originalProposal!.affectedFiles : []) {
    const normalized = normalizeProjectRelativePath(file?.path);
    if (!normalized.startsWith('src/')) continue;
    originalFiles.set(normalized, {
      path: normalized,
      action: file?.action === 'create' || file?.action === 'delete' ? file.action : 'edit',
      description: String(file?.description || 'Touched by the original approved proposal.'),
    });
  }

  const explicitBuildPaths = extractBuildFailurePaths(buildOutput)
    .map(normalizeProjectRelativePath)
    .filter((filePath) => filePath.startsWith('src/'));
  const changedSandboxPaths = collectChangedSandboxSrcFiles(task)
    .map(normalizeProjectRelativePath)
    .filter((filePath) => filePath.startsWith('src/'));
  const scopedAllowedFiles = Array.isArray(task.proposalExecution?.mutationScope?.allowedFiles)
    ? task.proposalExecution?.mutationScope?.allowedFiles
        .map(normalizeProjectRelativePath)
        .filter((filePath) => filePath.startsWith('src/'))
    : [];

  const candidates = new Set<string>();
  for (const filePath of explicitBuildPaths) candidates.add(filePath);
  for (const filePath of changedSandboxPaths) candidates.add(filePath);
  if (candidates.size === 0) {
    for (const filePath of scopedAllowedFiles) {
      candidates.add(filePath);
    }
  }

  return Array.from(candidates).slice(0, 16).map((filePath) => {
    const original = originalFiles.get(filePath);
    const reasons: string[] = [];
    if (explicitBuildPaths.includes(filePath)) reasons.push('Referenced directly in the captured build failure.');
    if (changedSandboxPaths.includes(filePath)) reasons.push('Already modified inside the failed sandbox.');
    return {
      path: filePath,
      action: original?.action || 'edit',
      description: reasons.join(' ') || original?.description || 'Scoped build repair target.',
    };
  });
}

function proposalTouchesSrcFiles(files: ProposalAffectedFile[]): boolean {
  return Array.isArray(files) && files.some((file) => String(file?.path || '').replace(/\\/g, '/').startsWith('src/'));
}

function isDevSrcSelfEditTask(task: TaskRecord | null | undefined): boolean {
  return task?.proposalExecution?.mode === DEV_SRC_SELF_EDIT_MODE;
}

function isDevSrcSelfEditRepairTask(task: TaskRecord | null | undefined): boolean {
  return task?.proposalExecution?.mode === DEV_SRC_SELF_EDIT_REPAIR_MODE;
}

function isDevSrcProposalTask(task: TaskRecord | null | undefined): boolean {
  return isDevSrcSelfEditTask(task) || isDevSrcSelfEditRepairTask(task);
}

function defaultBuildCommandForTask(task: TaskRecord | null | undefined): string {
  return isDevSrcProposalTask(task) ? 'npm run build:backend' : 'npm run build';
}

function canonicalizeBuildCommand(rawCommand: string | undefined, task?: TaskRecord | null): string {
  const text = String(rawCommand || '').trim();
  const match = text.match(/\bnpm\s+run\s+((?:build(?::[A-Za-z0-9:_-]+)?)|tsc)\b/i);
  if (match) {
    const normalized = `npm run ${match[1]}`;
    if (isDevSrcProposalTask(task) && /^npm\s+run\s+build$/i.test(normalized)) {
      return 'npm run build:backend';
    }
    return normalized;
  }
  return defaultBuildCommandForTask(task);
}

function hashFile(absPath: string): string | undefined {
  if (!absPath || !fs.existsSync(absPath)) return undefined;
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) return undefined;
  const content = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isBuildLikeStep(description: string | undefined): boolean {
  return /\b(build|compile|typecheck|tsc)\b/i.test(String(description || ''));
}

function findNearestBuildStepIndex(task: TaskRecord | null | undefined): number {
  if (!task || !Array.isArray(task.plan) || task.plan.length === 0) return 0;
  const currentIndex = Math.max(0, Math.min(task.currentStepIndex, task.plan.length - 1));
  if (isBuildLikeStep(task.plan[currentIndex]?.description)) return currentIndex;
  for (let i = currentIndex + 1; i < task.plan.length; i++) {
    if (isBuildLikeStep(task.plan[i]?.description)) return i;
  }
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (isBuildLikeStep(task.plan[i]?.description)) return i;
  }
  return currentIndex;
}

function detectSandboxVerificationIssue(task: TaskRecord | null | undefined, buildOutput: string): string | undefined {
  if (!isDevSrcProposalTask(task)) return undefined;
  const output = String(buildOutput || '');
  if (/\[check-public-web-ui-sync\]/i.test(output) || /Missing source UI index:\s*web-ui\/index\.html/i.test(output)) {
    return 'Sandbox verification environment issue: this dev src sandbox does not include web-ui assets, so full npm run build cannot run here. Use npm run build:backend for dev src proposal execution, or expand the sandbox contents before retrying full build.';
  }
  if (/generated\/public-web-ui\/index\.html/i.test(output) || /npm\s+run\s+sync:web-ui/i.test(output)) {
    return 'Sandbox verification environment issue: the dev src sandbox is missing public web-ui sync artifacts required by full npm run build.';
  }
  return undefined;
}

function formatAffectedFilePlanLine(file: ProposalAffectedFile): string {
  const pathText = String(file?.path || '').trim() || '?';
  const action = file?.action === 'create'
    ? 'Create only'
    : file?.action === 'delete'
      ? 'Delete only'
      : 'Edit only';
  const description = String(file?.description || '').trim();
  return `- ${action} \`${pathText}\`${description ? `: ${description}` : '.'}`;
}

function collectChangedSandboxSrcFiles(task: TaskRecord): string[] {
  const projectRoot = String(task.proposalExecution?.projectRoot || task.agentWorkspace || '').trim();
  const allowedFiles = Array.isArray(task.proposalExecution?.mutationScope?.allowedFiles)
    ? task.proposalExecution?.mutationScope?.allowedFiles || []
    : [];
  const baselines = task.proposalExecution?.liveFileBaselines || {};
  if (!projectRoot || allowedFiles.length === 0) return [];
  const changed = new Set<string>();
  for (const rawPath of allowedFiles) {
    const normalizedPath = normalizeProjectRelativePath(rawPath);
    if (!normalizedPath.startsWith('src/')) continue;
    const sandboxAbsPath = path.resolve(projectRoot, normalizedPath);
    const rel = path.relative(projectRoot, sandboxAbsPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const sandboxHash = hashFile(sandboxAbsPath);
    const sandboxExists = fs.existsSync(sandboxAbsPath);
    const baseline = baselines[normalizedPath];
    if (!baseline) {
      if (sandboxExists) changed.add(normalizedPath);
      continue;
    }
    if (baseline.exists !== sandboxExists || (baseline.sha256 || '') !== (sandboxHash || '')) {
      changed.add(normalizedPath);
    }
  }
  return Array.from(changed);
}

export class BackgroundTaskRunner {
  private taskId: string;
  private handleChat: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    modelOverride?: string,
    executionMode?: 'interactive' | 'background_task' | 'proposal_execution' | 'background_agent' | 'heartbeat' | 'cron' | 'team_manager' | 'team_subagent',
    toolFilter?: string[],
    attachments?: undefined,
    reasoningOptions?: undefined,
    providerOverride?: string,
  ) => Promise<{ type: string; text: string; thinking?: string }>;
  private broadcast: (data: object) => void;
  private telegramChannel: {
    sendToAllowed: (text: string) => Promise<void>;
    sendMessage?: (chatId: number, text: string) => Promise<void>;
  } | null;
  private openingAction: string | undefined;

  constructor(
    taskId: string,
    handleChat: BackgroundTaskRunner['handleChat'],
    broadcast: (data: object) => void,
    telegramChannel: {
      sendToAllowed: (text: string) => Promise<void>;
      sendMessage?: (chatId: number, text: string) => Promise<void>;
    } | null,
    openingAction?: string,
  ) {
    this.taskId = taskId;
    this.handleChat = handleChat;
    this.broadcast = broadcast;
    this.telegramChannel = telegramChannel;
    this.openingAction = openingAction;
  }

  static requestPause(taskId: string): void {
    pauseRequests.add(taskId);
    // Immediately set abort signal so in-flight handleChat calls can interrupt
    const signal = taskAbortSignals.get(taskId);
    if (signal) {
      signal.aborted = true;
      console.log(`[Background Task] Pause requested for ${taskId} - abort signal set`);
    }
  }

  static cancelTask(taskId: string, reason: string = 'Cancelled by operator.'): boolean {
    const task = loadTask(taskId);
    if (!task) return false;
    pauseRequests.add(taskId);
    const signal = taskAbortSignals.get(taskId);
    if (signal) {
      signal.aborted = true;
    }
    updateTaskStatus(taskId, 'failed', { finalSummary: reason });
    appendJournal(taskId, { type: 'status_push', content: reason });
    console.log(`[Background Task] Cancel requested for ${taskId}: ${reason}`);
    return true;
  }

  static isRunning(taskId: string): boolean { return activeRunners.has(taskId); }

  static forceRelease(taskId: string): void {
    if (activeRunners.has(taskId)) {
      console.warn(`[Background Task] Force-releasing stale activeRunners entry for task ${taskId}`);
      activeRunners.delete(taskId);
      pauseRequests.delete(taskId);
    }
    taskAbortSignals.delete(taskId);
  }

  static getRunningTasks(): string[] { return Array.from(activeRunners); }

  static interruptTaskForSchedule(taskId: string, scheduleId: string): boolean {
    if (!activeRunners.has(taskId)) return false;
    const task = loadTask(taskId);
    if (!task) return false;
    updateTaskStatus(taskId, 'paused', {
      pauseReason: 'interrupted_by_schedule',
      pausedByScheduleId: scheduleId,
      pausedAt: Date.now(),
      pausedAtStepIndex: task.currentStepIndex,
      shouldResumeAfterSchedule: true,
    });
    pauseRequests.add(taskId);
    console.log(`[Background Task] Task ${taskId} interrupted by schedule ${scheduleId}`);
    return true;
  }

  static resumeTaskAfterSchedule(taskId: string, scheduleId: string): boolean {
    const task = loadTask(taskId);
    if (!task) return false;
    if (task.pausedByScheduleId !== scheduleId) {
      console.warn(`[Background Task] Task ${taskId} not paused by schedule ${scheduleId}`);
      return false;
    }
    updateTaskStatus(taskId, 'running', {
      pauseReason: undefined,
      pausedByScheduleId: undefined,
      pausedAt: undefined,
      pausedAtStepIndex: undefined,
      shouldResumeAfterSchedule: false,
    });
    if (!activeRunners.has(taskId)) {
      console.log(`[Background Task] Resuming task ${taskId} after schedule ${scheduleId} completed`);
    }
    return true;
  }

  async start(): Promise<void> {
    const { taskId } = this;
    if (activeRunners.has(taskId)) {
      console.log(`[Background Task] Task ${taskId} already running - skipping duplicate start.`);
      return;
    }
    const task = loadTask(taskId);
    if (!task) { console.error(`[Background Task] Task ${taskId} not found.`); return; }
    if (task.status === 'complete' || task.status === 'failed') {
      console.log(`[Background Task] Task ${taskId} is already ${task.status} - nothing to do.`);
      return;
    }

    activeRunners.add(taskId);
    pauseRequests.delete(taskId);

    // ── Mandatory write_note step ─────────────────────────────────────────────
    // Every background task gets a final "Log completion" step appended at start.
    // This replaces the old synthesis round: the AI calls write_note inside this
    // step, its text response becomes lastResultSummary, and that is delivered
    // directly to the user. No second LLM call needed after all steps are done.
    //
    // Skip for: resuming mid-task, legacy child sub-agents (they don't deliver to user chat),
    // and tasks that already have the step (idempotent on restart).
    const isResuming = task.currentStepIndex > 0;
    const isLegacySubagent = !task.teamSubagent && (!!task.subagentProfile || !!task.parentTaskId);
    const alreadyHasWriteNoteStep = task.plan.some((s: any) => s.notes === 'write_note_completion');
    if (!isResuming && !isLegacySubagent && !alreadyHasWriteNoteStep && task.plan.length > 0) {
      mutatePlan(taskId, [{
        op: 'add',
        after_index: task.plan.length - 1,
        description:
          'Log completion: call write_note with a full summary of what was done in this task — ' +
          'what changed, what was created or modified, key results, and any important findings. ' +
          'Tag it "task_complete". Then write your final response to the user summarizing the outcome.',
        notes: 'write_note_completion',
      }]);
      appendJournal(taskId, { type: 'status_push', content: 'Appended mandatory write_note completion step.' });
    }

    // ── Legacy memory extraction (opt-in, kept for backward compat) ───────────
    const alreadyHasMemStep = task.plan.some((s: any) => s.notes === 'memory_extraction');
    const memExtractionEnabled = !!(task as any).enableMemoryExtraction;
    if (!isResuming && !isLegacySubagent && !alreadyHasMemStep && task.plan.length > 0 && memExtractionEnabled) {
      mutatePlan(taskId, [{
        op: 'add',
        after_index: task.plan.length - 1,
        description:
          'Memory extraction: review everything learned during this run and call write_note ' +
          'for each distinct fact about the user, their business, preferences, environment, ' +
          'tools, contacts, or recurring patterns. Write one write_note per fact — be specific ' +
          'and concrete. Skip facts already in USER.md.',
        notes: 'memory_extraction',
      }]);
    }

    const agentWs = (task as any).agentWorkspace as string | undefined;
    const agentAllowedWorkPaths = Array.isArray((task as any).agentAllowedWorkPaths)
      ? (task as any).agentAllowedWorkPaths.map((p: any) => String(p || '').trim()).filter(Boolean)
      : undefined;
    if (agentWs) console.log(`[Background Task] Workspace scoped to: ${agentWs} for task ${taskId}`);

    try {
      if (agentWs) {
        await runWithWorkspace(agentWs, () => this._run(), agentAllowedWorkPaths);
      } else {
        await this._run();
      }
    } finally {
      activeRunners.delete(taskId);
      pauseRequests.delete(taskId);
      taskAbortSignals.delete(taskId);
    }
  }

  private _buildCallerContext(task: TaskRecord): string {
		    if (isProposalLikeSourceSessionId(task.sessionId || '')) {
		      const buildFailure = task.proposalExecution?.buildFailure;
	          const sandboxNote = isDevSrcSelfEditRepairTask(task)
	            ? `- This run is repairing an isolated failed code_change sandbox at ${task.proposalExecution?.projectRoot || task.agentWorkspace || '(unknown sandbox)'}. Fix only the scoped build failure, then hand the repaired sandbox back to the blocked original proposal task.`
	            : isDevSrcSelfEditTask(task)
	              ? `- This run is editing an isolated code_change sandbox at ${task.proposalExecution?.projectRoot || task.agentWorkspace || '(unknown sandbox)'}. Only approved src/ and web-ui/ files may be written, and a successful sandbox build is required before promotion back into the live repo.`
	            : '';
		      const recoveryNote = buildFailure?.status === 'resolved'
		        ? `- The previous build failure was repaired${buildFailure.repairProposalId ? ` by proposal ${buildFailure.repairProposalId}` : ''}. The current workspace already includes that fix. Continue from the current step only and do not redo earlier edits.`
		        : buildFailure?.repairProposalId
		          ? `- This run already failed its build and repair proposal ${buildFailure.repairProposalId} was created. Do not make more source edits in this task.`
		          : buildFailure?.allowWriteProposal
		            ? `- This run already failed its build. Source edits are frozen. If resumed, file exactly one scoped repair proposal with write_proposal, then stop.`
	            : '';
	      return [
	        `PROPOSAL EXECUTION PROTOCOL:`,
	        `- Execute only the approved proposal scope and task steps.`,
	        isDevSrcSelfEditRepairTask(task)
	          ? `- This is a repair-only run. Do NOT continue the original feature work in this task.`
	          : `- Do NOT create a new proposal during this run.`,
		        `- Execute each step directly with tools; after finishing a step, call step_complete(note: "what you did").`,
		        `- Do NOT call declare_plan again.`,
		        `- If blocked, state the blocker and best next action concisely.`,
            sandboxNote,
	        recoveryNote,
	      ].join('\n');
	    }

    const teamSubagentNote = task.teamSubagent?.callerContext
      ? `\n${task.teamSubagent.callerContext}`
      : '';
    const profileNote = task.subagentProfile
      ? `\nSub-agent role: ${task.subagentProfile}. Stay focused on your assigned task only. Do NOT call subagent_spawn.`
      : '';
    const pauseSnapshot = task.pauseSnapshot;
    const blockedStepDescription = pauseSnapshot?.currentStepDescription || task.plan?.[task.currentStepIndex]?.description || '';
    const blockedStateNote = pauseSnapshot
      ? [
          `\nLATEST BLOCKED STATE:`,
          `- Paused status: ${pauseSnapshot.taskStatus}${pauseSnapshot.pauseReason ? ` (${pauseSnapshot.pauseReason})` : ''}.`,
          `- Failure/blocked step: ${Math.min(pauseSnapshot.currentStepIndex + 1, Math.max(1, pauseSnapshot.totalSteps))}/${Math.max(1, pauseSnapshot.totalSteps)}${blockedStepDescription ? ` - ${blockedStepDescription}` : ''}.`,
          pauseSnapshot.pendingClarificationQuestion ? `- Pending clarification question: ${pauseSnapshot.pendingClarificationQuestion}` : '',
          pauseSnapshot.lastToolCall ? `- Last tool call before pause: ${pauseSnapshot.lastToolCall}` : '',
        ].filter(Boolean).join('\n')
      : '';
    const latestPauseAnalysis = task.pauseAnalysis?.message
      ? `\nLATEST PAUSE ANALYSIS:\n${String(task.pauseAnalysis.message).slice(0, 1800)}`
      : '';
    const latestResumeBrief = task.resumeBrief?.content
      ? `\nLATEST RESUME BRIEF:\n${String(task.resumeBrief.content).slice(0, 1600)}`
      : '';
    const resumeNote = task.resumeContext?.onResumeInstruction
      ? `\n${task.resumeContext.onResumeInstruction}`
      : '';
    const isXTask = /\b(x\.com|twitter|tweet|retweet|post.*tweet|reply.*tweet)\b/i.test(task.prompt + ' ' + task.title);
    const xLoginGuidance = isXTask
      ? `\nX.COM LOGIN NOTE: If the browser page title shows "(N) Home / X", "Home / X", or any title ending in "/ X", ` +
        `the user IS already logged in to X — do NOT ask to confirm login or suggest they log in. ` +
        `Proceed directly with the task action.\n` +
        `X.COM POSTING FLOW: When posting a tweet, follow EXACTLY these steps:\n` +
        `  1. browser_open("https://x.com")\n` +
        `  2. Find the textbox with name "Post text" — browser_fill it.\n` +
        `  3. The fill result shows "COMPOSER SUBMIT BUTTON: @N" — browser_click(@N) immediately.\n` +
        `  4. After posting, call browser_close() then call step_complete. STOP.`
      : '';

    // Inline plan summary for context
    const planLines = task.plan.map((s, i) => {
      const icon = s.status === 'done' ? '✓' : s.status === 'running' ? '►' : s.status === 'skipped' ? '-' : ' ';
      const current = i === task.currentStepIndex ? ' ← CURRENT' : '';
      return `  [${icon}] Step ${i + 1}: ${s.description.slice(0, 120)}${current}`;
    }).join('\n');

    return [
      `[BACKGROUND TASK CONTEXT]`,
      `Task ID: ${task.id}`,
      `Task Title: ${task.title}`,
      `Original Request: ${task.prompt.slice(0, 400)}`,
      ``,
      `PLAN (${task.plan.length} steps):`,
      planLines,
      ``,
      `PROTOCOL:`,
      `- Execute steps in order. Use whatever tools each step requires.`,
      `- After completing ALL tool calls for a step, call step_complete(note: "what you did").`,
      `- Do NOT call declare_plan again — your plan is already set.`,
      `- The FINAL step in every plan is "Log completion". In that step you MUST call write_note`,
      `  (tag: "task_complete") with a full rundown of what was done, then write your summary`,
      `  response to the user as plain text. That text becomes the final message delivered to chat.`,
      `- If blocked, say what is blocking you and stop.`,
      `You are running autonomously.${teamSubagentNote}${profileNote}${blockedStateNote}${latestPauseAnalysis}${latestResumeBrief}${resumeNote}${xLoginGuidance}`,
      `[/BACKGROUND TASK CONTEXT]`,
    ].filter(Boolean).join('\n');
  }

  private _buildPauseAnalysisContext(task: TaskRecord, snapshot: TaskPauseSnapshot, mode: 'clarification' | 'assistance'): string {
    const modeInstructions = mode === 'clarification'
      ? [
          'TASK RECOVERY MODE: Clarification pause analysis.',
          'You are explaining why a background task paused to ask the user a question.',
          'Do not use tools. Do not claim the task has resumed.',
          'Explain what information is missing, why it matters, what answer would unblock the task, and the plan after the user answers.',
        ].join('\n')
      : [
          'TASK RECOVERY MODE: Failure/blocked-task analysis.',
          'You are explaining why a background task paused and proposing the next recovery plan.',
          'Do not use tools. Do not claim the task has resumed.',
          'Explain what happened, why it paused, the most likely fix, and what the task will do if the user approves that plan.',
        ].join('\n');
    return [
      modeInstructions,
      '',
      formatTaskPauseSnapshot(snapshot, { maxChars: 100_000 }),
    ].join('\n');
  }

  private async _generatePauseAnalysis(task: TaskRecord, snapshot: TaskPauseSnapshot, mode: 'clarification' | 'assistance'): Promise<string> {
    const recoverySessionId = getTaskRecoverySessionId(task.id);
    try {
      clearHistory(recoverySessionId);
    } catch {}
    const prompt = mode === 'clarification'
      ? [
          'Write the paused-task message for the user.',
          'Include these sections in plain English:',
          '1. What happened',
          '2. What I need from you',
          '3. Recommended next plan',
          '4. What I will do if you say "go ahead"',
          'Keep it concrete and grounded in the provided logs.',
        ].join('\n')
      : [
          'Write the paused-task message for the user.',
          'Include these sections in plain English:',
          '1. What happened',
          '2. Why it paused',
          '3. Recommended fix plan',
          '4. What I will do if you say "go ahead"',
          'Keep it concrete and grounded in the provided logs.',
        ].join('\n');
    try {
      const result = await this.handleChat(
        prompt,
        recoverySessionId,
        () => {},
        undefined,
        undefined,
        this._buildPauseAnalysisContext(task, snapshot, mode),
        undefined,
        'interactive',
        getTaskRecoveryNoToolsFilter(),
        undefined,
        undefined,
        task.executorProvider,
      );
      const text = String(result?.text || '').trim();
      if (text) return text;
    } catch (err: any) {
      console.warn(`[TaskRecovery] Pause analysis failed for task ${task.id}:`, err?.message || err);
    }
    if (mode === 'clarification') {
      return [
        `Task paused and needs your input: ${task.title}`,
        snapshot.pendingClarificationQuestion ? `What I need from you: ${snapshot.pendingClarificationQuestion}` : 'What I need from you: clarification to unblock the current step.',
        `Recommended next plan: once I have that answer, I will continue from step ${Math.min(snapshot.currentStepIndex + 1, Math.max(1, snapshot.totalSteps))}/${Math.max(1, snapshot.totalSteps)}.`,
        `If you want me to continue after answering, reply here with your answer and then say "go ahead".`,
      ].join('\n');
    }
    const latestPause = [...(task.journal || [])].reverse().find((entry) => entry.type === 'pause' || entry.type === 'error');
    return [
      `Task paused and needs input: ${task.title}`,
      `What happened: ${latestPause?.content || task.pauseReason || 'The task hit a blocker and paused.'}`,
      `Why it paused: it needs a recovery decision before continuing safely.`,
      `Recommended fix plan: review the blocker, apply the most likely fix, then continue from step ${Math.min(snapshot.currentStepIndex + 1, Math.max(1, snapshot.totalSteps))}/${Math.max(1, snapshot.totalSteps)}.`,
      `If you want me to continue, reply with any adjustment and then say "go ahead".`,
    ].join('\n');
  }

  private async _preparePauseRecoveryMessage(task: TaskRecord, mode: 'clarification' | 'assistance'): Promise<string | null> {
    if (!isTaskRecoveryEligible(task)) return null;
    const liveTask = loadTask(task.id) || task;
    const snapshot = buildTaskPauseSnapshot(liveTask);
    const analysisMessage = await this._generatePauseAnalysis(liveTask, snapshot, mode);
    const storedTask = loadTask(task.id) || liveTask;
    storedTask.pauseSnapshot = snapshot;
    storedTask.pauseAnalysis = {
      createdAt: Date.now(),
      message: analysisMessage,
    };
    storedTask.recoveryConversation = [
      {
        role: 'assistant',
        content: analysisMessage,
        timestamp: Date.now(),
        source: 'pause_analysis',
      },
    ];
    storedTask.resumeBrief = undefined;
    saveTask(storedTask);
    try {
      syncTaskRecoverySession(storedTask);
    } catch {}
    appendJournal(task.id, {
      type: 'status_push',
      content: `Recovery analysis prepared for paused task (${mode}).`,
    });
    return analysisMessage;
  }

  private _createBuildFailureRepairProposal(
    task: TaskRecord,
    buildCommand: string,
    buildOutput: string,
  ): {
    repairProposalId?: string;
    originalProposalId?: string;
    parentProposalId?: string;
    canonicalBuildCommand: string;
    creationError?: string;
    environmentIssue?: string;
  } {
    const sourceSessionId = String(task.sessionId || '');
    const parentProposalId = String(task.proposalExecution?.proposalId || '')
      || (sourceSessionId.startsWith('proposal_') ? sourceSessionId.replace(/^proposal_/, '') : '');
    const parentProposal = parentProposalId ? loadProposal(parentProposalId) : null;
    const repairOnly = isDevSrcProposalTask(task);
    const rootProposalId = String(
      task.proposalExecution?.repairContext?.rootProposalId
      || parentProposal?.repairContext?.rootProposalId
      || parentProposalId,
    ).trim();
    const rootTaskId = String(
      task.proposalExecution?.repairContext?.rootTaskId
      || parentProposal?.repairContext?.rootTaskId
      || task.id,
    ).trim();
    const resumeOriginalTaskId = String(
      task.proposalExecution?.repairContext?.resumeOriginalTaskId
      || rootTaskId
      || task.id,
    ).trim();
    const originalProposalId = rootProposalId || parentProposalId;
    const originalProposal = originalProposalId ? loadProposal(originalProposalId) : parentProposal;
    const canonicalBuildCommand = canonicalizeBuildCommand(buildCommand, task);
    const affectedFiles = buildRepairAffectedFiles(task, originalProposal, buildOutput);
    const truncatedOutput = String(buildOutput || '').slice(-3000);
    const titleBase = String(originalProposal?.title || parentProposal?.title || task.title || 'approved proposal')
      .replace(/^\[Proposal\]\s*/i, '')
      .trim();
    const failedStepIndex = findNearestBuildStepIndex(task);
    const currentStep = task.plan[failedStepIndex] || task.plan[task.currentStepIndex];
    const affectedFilePlanLines = affectedFiles.map(formatAffectedFilePlanLine);
    const affectedFilePrompt = affectedFiles.map((file) => `- ${String(file?.path || '').trim() || '?'}`);
    const repairContext: ProposalRepairContext | undefined = repairOnly
      ? {
          repairOnly: true,
          rootProposalId: originalProposalId || undefined,
          rootTaskId: rootTaskId || undefined,
          parentProposalId: parentProposalId || undefined,
          parentTaskId: task.id,
          resumeOriginalTaskId: resumeOriginalTaskId || undefined,
          failedAtStepIndex: failedStepIndex,
          failedStepDescription: currentStep?.description,
          failedWorkspaceRoot: String(task.proposalExecution?.projectRoot || task.agentWorkspace || '').trim() || undefined,
          canonicalBuildCommand,
          capturedFailureCommand: String(buildCommand || '').trim() || undefined,
          repairDepth: Math.max(1, Number(task.proposalExecution?.repairContext?.repairDepth || 0) + 1),
        }
      : undefined;

    if (repairOnly && (!repairContext?.failedWorkspaceRoot || affectedFiles.length === 0)) {
      return {
        originalProposalId,
        parentProposalId,
        canonicalBuildCommand,
        creationError: !repairContext?.failedWorkspaceRoot
          ? 'No failed sandbox workspace was available to repair.'
          : 'Could not derive a narrowed src repair scope from the failed sandbox.',
      };
    }

    const details = repairOnly
      ? [
          `Why this change`,
          `The approved proposal "${titleBase}" failed during ${canonicalBuildCommand}. This repair-only follow-up fixes the build break inside the failed sandbox and then hands that repaired sandbox back to the blocked original proposal task.`,
          ``,
          `Exact source edits`,
          ...affectedFilePlanLines,
          `- Inspect the captured build output below and the failed sandbox state first.`,
          `- Apply the minimum repair needed to make ${canonicalBuildCommand} pass.`,
          `- Limit writes to the affected files listed in this proposal.`,
          `- Do NOT continue implementing the original proposal in this repair task.`,
          `- If additional files are required, stop and file another scoped repair proposal instead of expanding the write surface silently.`,
          ``,
          `Captured build failure`,
          '```text',
          truncatedOutput || 'No build output was captured.',
          '```',
          ``,
          `Deterministic behavior after patch`,
          `- ${canonicalBuildCommand} exits successfully inside the repair sandbox.`,
          `- The captured failing diagnostics are resolved.`,
          `- The repaired sandbox is handed back to the blocked original proposal task without redoing prior feature work.`,
          ``,
          `Acceptance tests`,
          `- Run ${canonicalBuildCommand}.`,
          `- Confirm the captured failure does not appear again.`,
          `- Stop immediately after the build passes and write a repair handoff summary.`,
          ``,
          `Risks and compatibility`,
          `- This repair is intentionally scoped to the files listed below.`,
          `- If the build failure propagates beyond those files, pause and create another approval-scoped repair proposal rather than editing outside approval.`,
        ].join('\n')
      : [
          `Why this change`,
          `The approved proposal "${titleBase}" failed during ${canonicalBuildCommand}. This follow-up proposal isolates the build failure and restores a clean build before any further source edits continue.`,
          ``,
          `Exact source edits`,
          ...affectedFilePlanLines,
          `- Inspect the captured build output below.`,
          `- Apply the minimum repair needed to make the build pass.`,
          `- Limit writes to the affected files listed in this proposal.`,
          `- If additional files are required, stop and file another scoped proposal instead of expanding the write surface silently.`,
          ``,
          `Captured build failure`,
          '```text',
          truncatedOutput || 'No build output was captured.',
          '```',
          ``,
          `Deterministic behavior after patch`,
          `- ${canonicalBuildCommand} exits successfully.`,
          `- The captured failing diagnostics are resolved.`,
          `- No new build errors are introduced by the repair.`,
          ``,
          `Acceptance tests`,
          `- Run ${canonicalBuildCommand}.`,
          `- Confirm the captured failure does not appear again.`,
          ``,
          `Risks and compatibility`,
          `- This repair is intentionally scoped to the files listed below.`,
          `- If the build failure propagates beyond those files, pause and create another approval-scoped proposal rather than editing outside approval.`,
        ].join('\n');
    const executorPrompt = repairOnly
      ? [
          `Repair the build failure introduced while executing approved proposal ${originalProposalId || '(unknown proposal)'}.`,
          `This is a repair-only proposal. Fix the build in the failed sandbox and do not continue the original feature work here.`,
          `Read the listed files and the captured build output first.`,
          `Allowed repair files:`,
          ...affectedFilePrompt,
          `Apply the smallest repair that makes ${canonicalBuildCommand} pass.`,
          `Do not write outside affected_files. If another file is required, stop and create another scoped repair proposal.`,
          `After the repair edits, run ${canonicalBuildCommand} once, write a repair handoff summary, and stop.`,
          ``,
          `Captured build output:`,
          truncatedOutput || 'No build output was captured.',
        ].join('\n')
      : [
          `Repair the build failure introduced while executing approved proposal ${originalProposalId || '(unknown proposal)'}.`,
          `Read the listed files and the captured build output first.`,
          `Allowed repair files:`,
          ...affectedFilePrompt,
          `Apply the smallest repair that makes ${canonicalBuildCommand} pass.`,
          `Do not write outside affected_files. If another file is required, stop and create another scoped proposal.`,
          `After the repair edits, run ${canonicalBuildCommand} once.`,
          ``,
          `Captured build output:`,
          truncatedOutput || 'No build output was captured.',
        ].join('\n');

    try {
      const repairProposal = createProposal({
        type: proposalTouchesSrcFiles(affectedFiles) ? 'src_edit' : 'general',
        priority: originalProposal?.priority === 'critical' ? 'critical' : 'high',
        title: `Repair build failure after ${titleBase}`.slice(0, 120),
        summary: (
          repairOnly
            ? `The approved proposal "${titleBase}" failed during ${canonicalBuildCommand}. This repair-only proposal fixes the build break inside the failed sandbox and then resumes the blocked original proposal task.`
            : `The approved proposal "${titleBase}" failed during ${canonicalBuildCommand}. This follow-up proposal repairs the build break using the narrowed failure scope.`
        ).slice(0, 500),
        details,
        sourceAgentId: 'proposal_executor',
        sourceSessionId: originalProposal?.sourceSessionId,
        sourcePipeline: 'proposal_build_failure',
        affectedFiles,
        diffPreview: truncatedOutput || undefined,
        estimatedImpact: repairOnly
          ? `Repair the failed sandbox so ${canonicalBuildCommand} passes again, then resume the blocked original proposal task.`
          : `Restore a passing ${canonicalBuildCommand} after proposal execution failure.`,
        requiresBuild: true,
        requiresSrcEdit: proposalTouchesSrcFiles(affectedFiles) || originalProposal?.requiresSrcEdit === true,
        executorPrompt,
        riskTier: 'high',
        executorProviderId: originalProposal?.executorProviderId,
        executorModel: originalProposal?.executorModel,
        repairContext,
      });
      try {
        if (this.telegramChannel && typeof (this.telegramChannel as any).sendProposalToAllowed === 'function') {
          (this.telegramChannel as any).sendProposalToAllowed(repairProposal).catch(() => {});
        }
      } catch {}
      return {
        repairProposalId: repairProposal.id,
        originalProposalId,
        parentProposalId,
        canonicalBuildCommand,
      };
    } catch (err: any) {
      return {
        originalProposalId,
        parentProposalId,
        canonicalBuildCommand,
        creationError: err?.message || String(err),
      };
    }
  }

  private async _finalizeDevSrcSelfEditRepairHandoff(
    task: TaskRecord,
    repairSummary: string,
  ): Promise<{
    handled: boolean;
    ok: boolean;
    summarySuffix?: string;
  }> {
    if (!isDevSrcSelfEditRepairTask(task)) {
      return { handled: false, ok: true };
    }

    const proposalExecution = task.proposalExecution || {};
    const repairContext = proposalExecution.repairContext;
    if (proposalExecution.buildRequired !== false && !proposalExecution.buildVerifiedAt) {
      appendJournal(task.id, {
        type: 'error',
        content: 'Repair handoff blocked because no successful build was verified inside the repair sandbox.',
      });
      await this._pauseForAssistance(
        task,
        'Repair task reached the end without a verified build. Run the canonical build successfully inside the repair sandbox before handing it back.',
        `Repair sandbox: ${proposalExecution.projectRoot || task.agentWorkspace || '(unknown)'}`,
        { pauseReason: 'recovering_from_build_error' },
      );
      return { handled: true, ok: false };
    }

    const originalTaskId = String(repairContext?.resumeOriginalTaskId || '').trim();
    const repairWorkspaceRoot = String(proposalExecution.projectRoot || task.agentWorkspace || '').trim();
    if (!originalTaskId || !repairWorkspaceRoot) {
      await this._pauseForAssistance(
        task,
        'Repair task finished, but the original blocked task or repair workspace path was missing.',
        `resumeOriginalTaskId=${originalTaskId || '(missing)'}, repairWorkspaceRoot=${repairWorkspaceRoot || '(missing)'}`,
        { pauseReason: 'recovering_from_build_error' },
      );
      return { handled: true, ok: false };
    }

    const originalTask = loadTask(originalTaskId);
    if (!originalTask) {
      await this._pauseForAssistance(
        task,
        'Repair task finished, but the original blocked task could not be loaded for handoff.',
        `Original task id: ${originalTaskId}`,
        { pauseReason: 'recovering_from_build_error' },
      );
      return { handled: true, ok: false };
    }

    const currentRepairProposalId = String(proposalExecution.proposalId || repairContext?.parentProposalId || '').trim();
    const resolutionSummary = String(repairSummary || '').trim()
      || String(repairContext?.handoffSummary || '').trim()
      || 'Repair build completed successfully.';
    const now = Date.now();
    const nextBuildCommand = String(proposalExecution.buildVerifiedCommand || repairContext?.canonicalBuildCommand || 'npm run build').trim() || 'npm run build';

    const reloadedOriginalTask = loadTask(originalTask.id) || originalTask;
    reloadedOriginalTask.agentWorkspace = repairWorkspaceRoot;
    reloadedOriginalTask.status = 'queued';
    reloadedOriginalTask.pauseReason = undefined;
    reloadedOriginalTask.lastProgressAt = now;
    reloadedOriginalTask.resumeContext = {
      ...(reloadedOriginalTask.resumeContext || {
        messages: [],
        browserSessionActive: false,
        round: 0,
        orchestrationLog: [],
      }),
      onResumeInstruction: [
        `[REPAIR HANDOFF]`,
        `Repair proposal ${currentRepairProposalId || '(unknown repair proposal)'} fixed the previous build failure.`,
        `The current workspace already includes that repair. Continue from the current step only.`,
        `Do not redo earlier edits or restart the original proposal from the beginning.`,
        `Repair summary: ${resolutionSummary}`,
      ].join('\n'),
    };
    reloadedOriginalTask.proposalExecution = {
      ...(reloadedOriginalTask.proposalExecution || {}),
      projectRoot: repairWorkspaceRoot,
      buildVerifiedAt: proposalExecution.buildVerifiedAt,
      buildVerifiedCommand: nextBuildCommand,
      buildFailure: {
        ...(reloadedOriginalTask.proposalExecution?.buildFailure || {
          failedAt: now,
          command: nextBuildCommand,
          output: '',
        }),
        status: 'resolved',
        command: nextBuildCommand,
        allowWriteProposal: false,
        repairProposalId: currentRepairProposalId || reloadedOriginalTask.proposalExecution?.buildFailure?.repairProposalId,
        repairTaskId: task.id,
        resolutionSummary,
        resolvedAt: now,
        resolvedByProposalId: currentRepairProposalId || undefined,
        resolvedByTaskId: task.id,
      },
    };
    saveTask(reloadedOriginalTask);

    appendJournal(reloadedOriginalTask.id, {
      type: 'write_note',
      content: `[build_repair] ${resolutionSummary.slice(0, 300)}`,
      detail: resolutionSummary.slice(0, 2000),
    });

    const blockedStepIndex = Number.isFinite(Number(reloadedOriginalTask.proposalExecution?.buildFailure?.blockedAtStepIndex))
      ? Number(reloadedOriginalTask.proposalExecution?.buildFailure?.blockedAtStepIndex)
      : reloadedOriginalTask.currentStepIndex;
    const blockedStep = reloadedOriginalTask.plan[blockedStepIndex];
    if (proposalExecution.buildVerifiedAt && isBuildLikeStep(repairContext?.failedStepDescription || blockedStep?.description)) {
      mutatePlan(reloadedOriginalTask.id, [{
        op: 'complete',
        step_index: blockedStepIndex,
        notes: `auto-complete: repair proposal ${currentRepairProposalId || task.id} verified ${nextBuildCommand}`,
      }]);
      const postMutation = loadTask(reloadedOriginalTask.id);
      if (postMutation && postMutation.currentStepIndex === blockedStepIndex) {
        postMutation.currentStepIndex = Math.min(blockedStepIndex + 1, postMutation.plan.length);
        postMutation.lastProgressAt = now;
        saveTask(postMutation);
      }
      appendJournal(reloadedOriginalTask.id, {
        type: 'status_push',
        content: `Auto-completed blocked build step ${blockedStepIndex + 1} after repair proposal ${currentRepairProposalId || task.id} verified ${nextBuildCommand}.`,
      });
    }

    if (repairContext?.rootProposalId) {
      markProposalExecuting(repairContext.rootProposalId, reloadedOriginalTask.id);
      this._broadcast('proposal_executing', {
        proposalId: repairContext.rootProposalId,
        taskId: reloadedOriginalTask.id,
        sessionId: reloadedOriginalTask.sessionId,
      });
    }

    this._broadcast('task_panel_update', { taskId: reloadedOriginalTask.id });

    const { launchBackgroundTaskRunner } = await import('./task-router.js');
    launchBackgroundTaskRunner(reloadedOriginalTask.id);

    return {
      handled: true,
      ok: true,
      summarySuffix: `Handed the repaired sandbox back to original proposal task ${reloadedOriginalTask.id} and resumed it from step ${Math.min((loadTask(reloadedOriginalTask.id)?.currentStepIndex || 0) + 1, Math.max(1, reloadedOriginalTask.plan.length))}/${Math.max(1, reloadedOriginalTask.plan.length)}.`,
    };
  }

  private async _finalizeDevSrcSelfEditPromotion(task: TaskRecord): Promise<{
    ok: boolean;
    summarySuffix?: string;
  }> {
    if (!isDevSrcSelfEditTask(task)) return { ok: true };
    const proposalExecution = task.proposalExecution || {};
    if (proposalExecution.buildRequired !== false && !proposalExecution.buildVerifiedAt) {
      appendJournal(task.id, {
        type: 'error',
        content: 'Sandbox promotion blocked because no successful build was verified after the last source edit.',
      });
      await this._pauseForAssistance(
        task,
        'Sandboxed src proposal reached the end without a verified build. Run npm run build successfully inside the isolated workspace before promotion.',
        `Sandbox workspace: ${proposalExecution.projectRoot || task.agentWorkspace || '(unknown)'}`,
        { pauseReason: 'recovering_from_build_error' },
      );
      return { ok: false };
    }
    if (proposalExecution.promotion?.status === 'promoted') {
      const promotedCount = (proposalExecution.promotion.promotedFiles || []).length + (proposalExecution.promotion.deletedFiles || []).length;
      return {
        ok: true,
        summarySuffix: promotedCount > 0
          ? `Sandboxed src changes were already promoted back into the live repo (${promotedCount} file${promotedCount === 1 ? '' : 's'}).`
          : 'Sandboxed src promotion was already finalized.',
      };
    }
    const projectRoot = String(proposalExecution.projectRoot || task.agentWorkspace || '').trim();
    const liveProjectRoot = String(proposalExecution.liveProjectRoot || '').trim();
    const allowedFiles = proposalExecution.mutationScope?.allowedFiles || [];
    if (!projectRoot || !liveProjectRoot || allowedFiles.length === 0) {
      const detail = [
        `projectRoot=${projectRoot || '(missing)'}`,
        `liveProjectRoot=${liveProjectRoot || '(missing)'}`,
        `allowedFiles=${allowedFiles.length}`,
      ].join(', ');
      appendJournal(task.id, {
        type: 'error',
        content: 'Sandbox promotion blocked because proposal execution metadata is incomplete.',
        detail,
      });
      await this._pauseForAssistance(
        task,
        'Sandboxed src proposal finished, but its promotion metadata was incomplete. Review the task before promoting any live changes.',
        detail,
        { pauseReason: 'recovering_from_build_error' },
      );
      return { ok: false };
    }

    try {
      const promotion = promoteDevSrcSelfEditWorkspace({
        projectRoot,
        liveProjectRoot,
        allowedFiles,
        liveFileBaselines: proposalExecution.liveFileBaselines,
      });
      const liveTask = loadTask(task.id) || task;
      liveTask.proposalExecution = {
        ...(liveTask.proposalExecution || {}),
        promotion: {
          status: 'promoted',
          promotedAt: Date.now(),
          promotedFiles: promotion.promotedFiles,
          deletedFiles: promotion.deletedFiles,
        },
      };
      saveTask(liveTask);
      appendJournal(task.id, {
        type: 'status_push',
        content: `Promoted sandboxed src changes back into the live repo: ${[...promotion.promotedFiles, ...promotion.deletedFiles].join(', ') || 'no file deltas detected'}.`,
      });
      this._broadcast('task_panel_update', { taskId: task.id });
      const promotedCount = promotion.promotedFiles.length + promotion.deletedFiles.length;
      return {
        ok: true,
        summarySuffix: promotedCount > 0
          ? `Promoted ${promotedCount} approved src file${promotedCount === 1 ? '' : 's'} from the isolated proposal sandbox back into the live repo.`
          : 'The isolated proposal sandbox matched the live repo scope, so no live src files needed promotion.',
      };
    } catch (err: any) {
      const message = err?.message || String(err);
      const liveTask = loadTask(task.id) || task;
      liveTask.proposalExecution = {
        ...(liveTask.proposalExecution || {}),
        promotion: {
          status: 'failed',
          error: message,
        },
      };
      saveTask(liveTask);
      appendJournal(task.id, {
        type: 'error',
        content: `Sandbox promotion failed: ${message}`,
      });
      await this._pauseForAssistance(
        task,
        'Sandbox build passed, but promoting the approved src files back into the live repo failed. Review the task before retrying.',
        message,
        { pauseReason: 'recovering_from_build_error' },
      );
      return { ok: false };
    }
  }

  private _restoreSessionForRetry(sessionId: string, resumeMessages: any[]): void {
    clearHistory(sessionId);
    for (const msg of resumeMessages) {
      if (msg && (msg.role === 'user' || msg.role === 'assistant')) {
        addMessage(sessionId, {
          role: msg.role,
          content: String(msg.content || ''),
          timestamp: msg.timestamp || Date.now(),
        }, {
          disableMemoryFlushCheck: true,
          disableCompactionCheck: true,
          disableAutoSave: true,
          maxMessages: BACKGROUND_SESSION_MAX_MESSAGES,
        });
      }
    }
  }

  private _persistResumeContextSnapshot(taskId: string, sessionId: string): void {
    const task = loadTask(taskId);
    const existingRound = Number(task?.resumeContext?.round) || 0;
    const sessionHistory = getHistory(sessionId, 40);
    updateResumeContext(taskId, {
      messages: sessionHistory.slice(-MAX_RESUME_MESSAGES).map(h => ({
        role: h.role,
        content: h.content,
        timestamp: h.timestamp,
      })),
      round: existingRound,
    });
  }

  private async _withRoundTimeout<T>(
    op: Promise<T>,
    timeoutMs: number,
    abortSignal?: { aborted: boolean },
    // Optional callback to subscribe to activity pings that reset the inactivity clock.
    // Pass a function; it receives a "ping" callback the caller should invoke on each
    // tool_call SSE event. When present, timeoutMs starts after the first ping and then
    // becomes the inactivity window since the most recent tool activity.
    onRegisterPing?: (ping: () => void) => void,
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;

    const scheduleTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (abortSignal) abortSignal.aborted = true;
        reject(new Error(`Round timeout (${Math.round(timeoutMs / 1000)}s)`));
      }, timeoutMs);
      if (timeoutId && typeof (timeoutId as any).unref === 'function') (timeoutId as any).unref();
    };

    let reject!: (err: Error) => void;
    const timeoutPromise = new Promise<T>((_, rej) => { reject = rej; });

    // Register the ping so callers can start/reset the inactivity window on tool activity.
    if (onRegisterPing) onRegisterPing(() => scheduleTimeout());

    if (!onRegisterPing) scheduleTimeout();
    try {
      return await Promise.race([op, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async _runRoundWithRetry(
    task: TaskRecord,
    prompt: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    abortSignal: { aborted: boolean },
    callerContextOverride?: string,
    modelOverride?: string,
    toolFilter?: string[],
    timeoutOverrideMs?: number,
    providerOverride?: string,
	    executionModeOverride: 'background_task' | 'proposal_execution' | 'background_agent' | 'team_subagent' = 'background_task',
  ): Promise<
    | { ok: true; result: { type: string; text: string; thinking?: string } }
    | { ok: false; reason: string; detail: string }
  > {
    const MAX_TRANSPORT_RETRIES = 2;
    const RETRY_DELAY_MS = 4000;
    const isResearchTask = /\b(research|search|news|articles?|web.*search|browser|scroll|page|google)\b/i.test(task.prompt + ' ' + task.title);
    const roundTimeoutMs = timeoutOverrideMs ?? resolveRoundTimeoutMs(isResearchTask);
    const resumeMessages = Array.isArray(task.resumeContext?.messages)
      ? task.resumeContext.messages.slice(-MAX_RESUME_MESSAGES)
      : [];
    const callerContext = callerContextOverride ?? this._buildCallerContext(task);

    for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
      let attemptResult: { type: string; text: string; thinking?: string };
      // Pass the REFERENCE, not a snapshot, so pause requests update it live
      try {
        // Wire up inactivity-based timeout: the clock resets each time a tool_call
        // SSE fires, so the 120s budget is "120s since last tool activity" not
        // "120s since handleChat was called". This prevents slow-startup models
        // from burning the whole budget before their first tool fires.
        let pingInactivityTimeout: (() => void) | null = null;
        const wrappedSendSSE = (event: string, data: any) => {
          if (event === 'tool_call' && pingInactivityTimeout) pingInactivityTimeout();
          sendSSE(event, data);
        };
        attemptResult = await this._withRoundTimeout(
          this.handleChat(prompt, sessionId, wrappedSendSSE, undefined, abortSignal, callerContext, modelOverride, executionModeOverride, toolFilter, undefined, undefined, providerOverride),
          INACTIVITY_TIMEOUT_MS,
          abortSignal,
          (ping) => { pingInactivityTimeout = ping; },
        );
      } catch (retryErr: any) {
        const errMsg = String(retryErr?.message || retryErr || 'unknown');
        appendJournal(task.id, { type: 'error', content: `Attempt ${attempt + 1} threw: ${errMsg.slice(0, 200)}` });
        if (attempt < MAX_TRANSPORT_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          this._restoreSessionForRetry(sessionId, resumeMessages);
          continue;
        }
        return { ok: false, reason: `Task stopped after ${MAX_TRANSPORT_RETRIES + 1} failed attempts.`, detail: errMsg.slice(0, 600) };
      }

      const text = String(attemptResult.text || '');
      const isTransportError =
        text.startsWith('Error: Ollama') || text.startsWith('Error: fetch failed') ||
        text.startsWith('Error: provider') || text.includes('fetch failed');

      if (isTransportError) {
        const errSnippet = text.slice(0, 200);
        const retryStrategy = getRetryStrategy();
        if (!retryStrategy.getState(task.id)) {
          retryStrategy.createRetryState(task.id, { maxAttempts: MAX_TRANSPORT_RETRIES + 1, baseDelayMs: RETRY_DELAY_MS, maxDelayMs: 30000, jitter: true });
        }
        const retryResult = retryStrategy.recordAttempt(task.id);
        appendJournal(task.id, { type: 'error', content: `Transport error (attempt ${retryResult.attemptsUsed}/${MAX_TRANSPORT_RETRIES + 1}): ${errSnippet}` });
        if (retryResult.canRetry && attempt < MAX_TRANSPORT_RETRIES) {
          await new Promise(r => setTimeout(r, retryResult.delayMs || RETRY_DELAY_MS * (attempt + 1)));
          this._restoreSessionForRetry(sessionId, resumeMessages);
          continue;
        }
        retryStrategy.clearState(task.id);
        return { ok: false, reason: `Task paused after transport retries exhausted at step ${task.currentStepIndex + 1}.`, detail: errSnippet };
      }

      if (text.startsWith('Error:')) {
        appendJournal(task.id, { type: 'error', content: `Model returned error: ${text.slice(0, 200)}` });
        return { ok: false, reason: `Task paused — model returned an unrecoverable error at step ${task.currentStepIndex + 1}.`, detail: text.slice(0, 600) };
      }

      return { ok: true, result: attemptResult };
    }

    return { ok: false, reason: 'Task paused — no valid result produced.', detail: 'No result after retry loop.' };
  }

  private async _run(): Promise<void> {
    const { taskId } = this;

    updateTaskStatus(taskId, 'running');
    appendJournal(taskId, { type: 'resume', content: 'Runner started.' });

    const initialTask = loadTask(taskId);
    if (!initialTask) return;

    this._broadcast('task_running', { taskId, title: initialTask.title });

    // Always use task_<id> as the execution session ID.
    // task.sessionId (e.g. 'proposal_prop_...') is preserved for result delivery only.
    // Using task_ prefix is required so chat.router.ts step_complete/declare_plan handlers
    // can resolve the task record from the session ID.
    const sessionId = `task_${taskId}`;
    clearHistory(sessionId);
    if (initialTask.teamSubagent?.teamId && initialTask.teamSubagent?.agentId) {
      try {
        const { registerBrowserSessionMetadata } = await import('../browser-tools');
        registerBrowserSessionMetadata(sessionId, {
          ownerType: 'team-agent',
          ownerId: initialTask.teamSubagent.agentId,
          label: `Team Subagent (${initialTask.teamSubagent.teamId} / ${initialTask.teamSubagent.agentName || initialTask.teamSubagent.agentId})`,
          taskPrompt: initialTask.prompt || initialTask.title || '',
          spawnerSessionId: initialTask.teamSubagent.teamId,
        });
      } catch {
        // Non-fatal: browser tools can still infer team identity from the task record.
      }
    }
    if (initialTask.agentWorkspace) {
      try {
        setWorkspace(sessionId, initialTask.agentWorkspace);
      } catch {
        // Best effort only; runWithWorkspace still scopes ALS-backed file tools.
      }
    }

    // Dev src proposal tasks need scoped source write tools available from round 1.
    // Other proposal tasks no longer get implicit source-write powers.
		    const sourceSessionId = String(initialTask.sessionId || '');
		    const isProposalLikeSourceSession =
		      isProposalLikeSourceSessionId(sourceSessionId);
	        const isDevSrcScopedProposalTask = isDevSrcProposalTask(initialTask);
		    const suppressSyntheticToolProgress = isProposalLikeSourceSession;
		    if (isProposalLikeSourceSession && isDevSrcScopedProposalTask) {
		      try {
		        activateToolCategory(sessionId, 'source_write');
		        activateToolCategory(sourceSessionId, 'source_write');
        const proposalScope = initialTask.proposalExecution?.mutationScope;
        if (proposalScope && ((proposalScope.allowedFiles || []).length > 0 || (proposalScope.allowedDirs || []).length > 0)) {
          setSessionMutationScope(sessionId, proposalScope);
          setSessionMutationScope(sourceSessionId, proposalScope);
        }
	      } catch {
	        // Non-fatal: category activation failures should not block task execution.
	      }
	    }

	    try {

	    // Pre-warm browser session alias
	    try {
	      const { resolveSessionId } = await import('../browser-tools');
      resolveSessionId(sessionId);
    } catch { /* lazy */ }

    // Restore conversation context
    // Cap total restored chars to avoid context-overflow death loops where a prior
    // run's large read_source results make every retry exceed the 200k token limit.
    const MAX_RESUME_TOTAL_CHARS = 60_000;
    const rawResumeMessages = Array.isArray(initialTask.resumeContext?.messages)
      ? initialTask.resumeContext.messages.slice(-MAX_RESUME_MESSAGES)
      : [];
    let resumeTotalChars = 0;
    const initialMessages = rawResumeMessages.filter(m => {
      const chars = String(m?.content || '').length;
      if (resumeTotalChars + chars > MAX_RESUME_TOTAL_CHARS) return false;
      resumeTotalChars += chars;
      return true;
    });
    if (initialMessages.length > 0) {
      for (const msg of initialMessages) {
        if (msg && (msg.role === 'user' || msg.role === 'assistant')) {
          addMessage(sessionId, {
            role: msg.role,
            content: String(msg.content || ''),
            timestamp: msg.timestamp || Date.now(),
          }, {
            disableMemoryFlushCheck: true,
            disableCompactionCheck: true,
            disableAutoSave: true,
            maxMessages: BACKGROUND_SESSION_MAX_MESSAGES,
          });
        }
      }
      appendJournal(taskId, { type: 'resume', content: `Restored ${initialMessages.length}/${rawResumeMessages.length} message(s) (${resumeTotalChars} chars).` });
    }

    // ── Stall counter state ───────────────────────────────────────────────────
    // Tracks tool calls since the last step_complete. At threshold, inject nudge.
    let toolCallsSinceLastStepComplete = 0;
    let stallNudgeInjected = false;
    let buildFailureRetryCount = 0;  // NEW: Track build failures in current step
    let lastProgressSignature = '';
    const abortSignal = { aborted: false };
    taskAbortSignals.set(taskId, abortSignal);  // Store so requestPause can access it

    const sendSSE = (event: string, data: any) => {
      this._broadcast('task_stream_event', { taskId, eventType: event, data });
      if (event === 'tool_call') {
        this._broadcast('task_panel_update', { taskId });
        const toolName = String(data.action || '');
	        if (toolName === 'step_complete' || toolName === 'declare_plan') {
	          // handled by task_step_done below
	        } else if (MUTATE_TOOLS.has(toolName)) {
	          // Write/mutate tool fired — real progress, reset stall counter
	          toolCallsSinceLastStepComplete = 0;
	          stallNudgeInjected = false;
            const liveTask = loadTask(taskId);
	            if (BUILD_INVALIDATING_TOOLS.has(toolName) && isDevSrcProposalTask(liveTask) && liveTask?.proposalExecution?.buildVerifiedAt) {
              liveTask.proposalExecution = {
                ...(liveTask.proposalExecution || {}),
                buildVerifiedAt: undefined,
                buildVerifiedCommand: undefined,
              };
              saveTask(liveTask);
            }
	        } else {
	          toolCallsSinceLastStepComplete++;
	        }
        appendJournal(taskId, {
          type: 'tool_call',
          content: `${data.action || 'unknown'}(${JSON.stringify(data.args || {}).slice(0, 80)})`,
        });
        this._broadcast('task_tool_call', { taskId, tool: data.action, args: data.args });
        const liveTask = loadTask(taskId);
        if (
          liveTask?.channel === 'telegram'
          && liveTask.telegramChatId
          && this.telegramChannel
          && typeof this.telegramChannel.sendMessage === 'function'
        ) {
          const actor = inferActorFromTask({
            managerEnabled: !!liveTask.managerEnabled,
            subagentProfile: liveTask.subagentProfile,
            title: liveTask.title,
            sessionId: liveTask.sessionId,
          });
          const tgMessage = formatTelegramToolCall({
            actor,
            toolName: String(data?.action || 'unknown_tool'),
            args: data?.args,
          });
          this.telegramChannel.sendMessage(liveTask.telegramChatId, tgMessage).catch(() => {});
        }
      } else if (event === 'task_step_done') {
        // step_complete was called — reset stall counter
        toolCallsSinceLastStepComplete = 0;
        stallNudgeInjected = false;
        appendJournal(taskId, { type: 'status_push', content: `Step complete signal received.` });
        this._broadcast('task_step_done', { taskId, ...data });
        this._broadcast('task_panel_update', { taskId });
        const liveTask = loadTask(taskId);
        if (
          liveTask?.channel === 'telegram'
          && liveTask.telegramChatId
          && this.telegramChannel
          && typeof this.telegramChannel.sendMessage === 'function'
        ) {
          const actor = inferActorFromTask({
            managerEnabled: !!liveTask.managerEnabled,
            subagentProfile: liveTask.subagentProfile,
            title: liveTask.title,
            sessionId: liveTask.sessionId,
          });
          const tgMessage = formatTelegramToolCall({
            actor,
            toolName: 'step_complete',
            args: { note: String(data?.note || '').trim() },
          });
          this.telegramChannel.sendMessage(liveTask.telegramChatId, tgMessage).catch(() => {});
        }
      } else if (event === 'tool_result') {
        appendJournal(taskId, {
          type: 'tool_result',
          content: `${data.action || 'unknown'}: ${String(data.result || '').slice(0, 120)}${data.error ? ' [ERROR]' : ''}`,
	          detail: data.error ? String(data.result || '') : undefined,
	        });
	        const liveTaskForTelegram = loadTask(taskId);
	        if (
	          liveTaskForTelegram?.channel === 'telegram'
	          && liveTaskForTelegram.telegramChatId
	          && this.telegramChannel
	          && typeof this.telegramChannel.sendMessage === 'function'
	        ) {
	          const actor = inferActorFromTask({
	            managerEnabled: !!liveTaskForTelegram.managerEnabled,
	            subagentProfile: liveTaskForTelegram.subagentProfile,
	            title: liveTaskForTelegram.title,
	            sessionId: liveTaskForTelegram.sessionId,
	          });
		          const tgResult = formatTelegramToolResult({
		            actor,
		            toolName: String(data?.action || 'unknown_tool'),
		            args: data?.args,
		            result: String(data?.result || ''),
		            error: data?.error === true,
		            forceShow: data?.show_result === true,
		          });
	          if (tgResult) this.telegramChannel.sendMessage(liveTaskForTelegram.telegramChatId, tgResult).catch(() => {});
	        }
        // Proposal build failure guard — check both plumbing session and original task session
	        const isProposalTaskFailFast = isProposalLikeSourceSessionId(sourceSessionId);
	            const isSandboxBuildVerificationCandidate = isDevSrcProposalTask(loadTask(taskId));
            if (!data.error && isSandboxBuildVerificationCandidate) {
              const action = String(data.action || '').toLowerCase();
              const commandText = String(data?.args?.command || '').trim();
              const isSandboxBuildCheck =
                action === 'run_command'
                && /npm\s+run\s+(?:build(?::[A-Za-z0-9:_-]+)?|tsc)\b/i.test(commandText || '');
              if (isSandboxBuildCheck) {
                const verifiedTask = loadTask(taskId);
                if (verifiedTask) {
                  verifiedTask.proposalExecution = {
                    ...(verifiedTask.proposalExecution || {}),
                    buildVerifiedAt: Date.now(),
                    buildVerifiedCommand: canonicalizeBuildCommand(commandText, verifiedTask),
                  };
                  saveTask(verifiedTask);
                }
              }
            }
		        if (data.error && isProposalTaskFailFast) {
	          const action = String(data.action || '').toLowerCase();
	          const result = String(data.result || '');
	          const commandText = String(data?.args?.command || '').trim();
	          const isBuildFailure =
	            (action === 'run_command' && /npm\s+run\s+build|npm\s+run\s+tsc/i.test(`${commandText}\n${result}`) && /exit\s+[1-9]\d*|timed out/i.test(result)) ||
	            (action === 'gateway_restart' && /build\s+failed/i.test(result));
	          if (isBuildFailure) {
	            const taskForStatusUpdate = loadTask(taskId);
	            if (taskForStatusUpdate) {
	              const buildCommand = commandText || (action === 'gateway_restart' ? 'npm run build' : 'npm run build');
	              const buildDetail = result.slice(-2000);
	              const canonicalBuildCommand = canonicalizeBuildCommand(buildCommand, taskForStatusUpdate);
	              const liveTask = loadTask(taskId) || taskForStatusUpdate;
                  const sandboxVerificationIssue = detectSandboxVerificationIssue(liveTask, result);
	              const existingBuildFailure = liveTask.proposalExecution?.buildFailure;
	              const repair = sandboxVerificationIssue
                    ? {
                        originalProposalId: String(
                          liveTask.proposalExecution?.repairContext?.rootProposalId
                          || liveTask.proposalExecution?.proposalId
                          || '',
                        ).trim() || undefined,
                        parentProposalId: liveTask.proposalExecution?.proposalId,
                        canonicalBuildCommand,
                        creationError: sandboxVerificationIssue,
                        environmentIssue: sandboxVerificationIssue,
                      }
                    : existingBuildFailure?.repairProposalId && existingBuildFailure.status !== 'resolved'
	                ? {
	                    repairProposalId: existingBuildFailure.repairProposalId,
	                    originalProposalId: String(
	                      liveTask.proposalExecution?.repairContext?.rootProposalId
	                      || liveTask.proposalExecution?.proposalId
	                      || '',
	                    ).trim() || undefined,
	                    parentProposalId: liveTask.proposalExecution?.proposalId,
	                    canonicalBuildCommand,
	                  }
	                : this._createBuildFailureRepairProposal(taskForStatusUpdate, buildCommand, result);
	              const blockedStepIndex = findNearestBuildStepIndex(liveTask);
	              const blockedStepDescription = liveTask.plan[blockedStepIndex]?.description;
	              liveTask.proposalExecution = {
	                ...(liveTask.proposalExecution || {}),
	                proposalId: liveTask.proposalExecution?.proposalId || repair.parentProposalId || repair.originalProposalId,
	                buildFailure: {
	                  failedAt: Date.now(),
	                  status: repair.repairProposalId ? 'blocked' : 'blocked',
	                  command: repair.canonicalBuildCommand,
	                  output: result.slice(-4000),
	                  repairProposalId: repair.repairProposalId,
	                  repairTaskId: existingBuildFailure?.repairTaskId,
	                  allowWriteProposal: !repair.repairProposalId && !repair.environmentIssue,
	                  blockedAtStepIndex: blockedStepIndex,
	                  blockedStepDescription,
	                  resolutionSummary: undefined,
	                  resolvedAt: undefined,
	                  resolvedByProposalId: undefined,
	                  resolvedByTaskId: undefined,
	                },
	              };
	              saveTask(liveTask);
	              appendJournal(taskId, {
	                type: 'write_note',
	                content: `[build_failure] ${repair.repairProposalId ? `Created repair proposal ${repair.repairProposalId} after build failure.` : repair.environmentIssue ? 'Build failed due to a sandbox verification environment issue. No automatic code repair proposal was created.' : 'Build failed and no automatic repair proposal could be created.'}`,
	                detail: buildDetail,
	              });
	              appendJournal(taskId, {
	                type: 'error',
	                content: repair.environmentIssue
                      ? `Build verification failed due to a sandbox environment issue: ${repair.environmentIssue}`
	                  : repair.repairProposalId
	                  ? `Build failed during proposal execution. Repair proposal ${repair.repairProposalId} created.`
	                  : `Build failed during proposal execution. Automatic repair proposal creation failed: ${repair.creationError || 'unknown error'}.`,
	                detail: buildDetail,
	              });
	              if (liveTask.proposalExecution?.proposalId) {
	                markProposalRepairing(
	                  liveTask.proposalExecution.proposalId,
	                  repair.environmentIssue
                        ? `Build verification is blocked by the sandbox environment: ${repair.environmentIssue}`
	                    : repair.repairProposalId
	                    ? `Build failed during execution. Repair proposal ${repair.repairProposalId} created.`
	                    : `Build failed during execution. Automatic repair proposal creation failed: ${repair.creationError || 'unknown error'}.`,
	                  liveTask.id,
	                );
	                this._broadcast('proposal_repairing', {
	                  proposalId: liveTask.proposalExecution.proposalId,
	                  taskId,
	                  sessionId: sourceSessionId,
	                  repairProposalId: repair.repairProposalId,
	                  error: buildDetail,
	                });
	              }
	              if (repair.originalProposalId && repair.originalProposalId !== liveTask.proposalExecution?.proposalId) {
	                markProposalRepairing(
	                  repair.originalProposalId,
	                  repair.environmentIssue
                        ? `Build verification is blocked by the sandbox environment: ${repair.environmentIssue}`
	                    : repair.repairProposalId
	                    ? `Build failed during repair. Follow-up repair proposal ${repair.repairProposalId} created.`
	                    : `Build failed during repair. Automatic follow-up repair proposal creation failed: ${repair.creationError || 'unknown error'}.`,
	                );
	              }
	              abortSignal.aborted = true;
	              void this._pauseForAssistance(
	                liveTask,
	                repair.environmentIssue
                      ? `Build verification failed because the dev src sandbox is missing required environment assets. No repair proposal was created because this is not a scoped src code failure. Fix the sandbox verification command or sandbox contents before resuming.`
	                  : repair.repairProposalId
	                  ? `Build failed during proposal execution. Logged the failure and created repair proposal ${repair.repairProposalId}. Review and approve that proposal before any more source edits.`
	                  : `Build failed during proposal execution. Logged the failure, but automatic repair proposal creation failed. Resume only to file a scoped repair proposal with write_proposal.`,
	                buildDetail,
	                { pauseReason: repair.repairProposalId ? 'blocked_on_repair' : 'recovering_from_build_error' },
	              );
	              return;
	            }
	          }
	        }
        const _isProposalTask = isProposalLikeSourceSessionId(sessionId) || (() => {
          if (!sessionId.startsWith('task_')) return false;
          try { const t = loadTask(sessionId.replace(/^task_/, '')); return isProposalLikeSourceSessionId(String(t?.sessionId || '')); } catch { return false; }
        })();
	        if (data.error && _isProposalTask && !isProposalTaskFailFast) {
          const action = String(data.action || '').toLowerCase();
          const result = String(data.result || '');
          const isBuildFailure =
            (action === 'run_command' && /npm\s+run\s+build|npm\s+run\s+tsc/.test(result) && /exit\s+[1-9]\d*|TIMED OUT/i.test(result)) ||
            (action === 'gateway_restart' && /build\s+failed|Build\s+FAILED/i.test(result));
          if (isBuildFailure) {
            buildFailureRetryCount++;
            const taskForStatusUpdate = loadTask(taskId);
            if (taskForStatusUpdate) {
              // First failure: log + let agent continue (self-healing attempt)
              if (buildFailureRetryCount === 1) {
                appendJournal(taskId, {
                  type: 'error',
                  content: `Build failed (attempt 1): ${result.slice(-200)}. Agent will attempt recovery.`,
                });
                // Do NOT pause — allow agent to self-heal
              } 
              // Second failure: show "recovering" status + continue
              else if (buildFailureRetryCount === 2) {
                appendJournal(taskId, {
                  type: 'error',
                  content: `Build failed again (attempt 2): ${result.slice(-200)}. Recovery in progress.`,
                });
                updateTaskStatus(taskId, 'running', { pauseReason: 'recovering_from_build_error' });
                this._broadcast('task_panel_update', { taskId });
                // Do NOT pause — agent gets one more chance
              } 
              // Third+ failure: genuinely stuck, pause for assistance
              else {
                appendJournal(taskId, {
                  type: 'error',
                  content: `Build failed ${buildFailureRetryCount} times. Pausing for assistance: ${result.slice(-500)}`,
                  detail: result.slice(-1500),
                });
                this._pauseForAssistance(taskForStatusUpdate, `Build failed ${buildFailureRetryCount} times — unable to auto-recover.`, result.slice(-1500));
                return; // Only return here to stop SSE processing on actual pause
              }
            }
          }
        }
      } else if (event === 'progress_state') {
        updateTaskRuntimeProgress(taskId, {
          source: data?.source,
          activeIndex: Number(data?.activeIndex ?? -1),
          items: Array.isArray(data?.items)
            ? data.items.map((item: any, idx: number) => ({
              id: String(item?.id || `p${idx + 1}`),
              text: String(item?.text || ''),
              status: String(item?.status || 'pending') as any,
            }))
            : [],
        });
        // declare_plan → real plan sync (first call only, at step 0, all-pending)
	        if (!suppressSyntheticToolProgress && data?.source === 'tool_sequence' && Array.isArray(data?.items) && data.items.length >= 2) {
          try {
            const liveTask = loadTask(taskId);
            if (liveTask) {
              const allPending = liveTask.plan.every((s: any) => s.status === 'pending');
              const isMoreGranular = data.items.length > liveTask.plan.length;
              const atStart = liveTask.currentStepIndex === 0;
              if (allPending && isMoreGranular && atStart) {
                const newPlan = data.items.map((item: any, i: number) => ({
                  index: i,
                  description: String(item?.text || `Step ${i + 1}`).slice(0, 300),
                  status: 'pending' as const,
                }));
                liveTask.plan = newPlan;
                saveTask(liveTask);
                appendJournal(taskId, { type: 'plan_mutation', content: `declare_plan seeded ${newPlan.length} steps.` });
              }
            }
          } catch { /* best-effort */ }
        }
        this._broadcast('task_panel_update', { taskId });
        const liveTask = loadTask(taskId);
        if (
	          !suppressSyntheticToolProgress
	          && data?.source !== 'tool_sequence'
	          && liveTask?.channel === 'telegram'
          && liveTask.telegramChatId
          && this.telegramChannel
          && typeof this.telegramChannel.sendMessage === 'function'
        ) {
          const actor = inferActorFromTask({
            managerEnabled: !!liveTask.managerEnabled,
            subagentProfile: liveTask.subagentProfile,
            title: liveTask.title,
            sessionId: liveTask.sessionId,
          });
          const progressMsg = formatTelegramProgressState({
            actor,
            items: Array.isArray(data?.items) ? data.items : [],
          });
          if (progressMsg) {
            const sig = `${data?.source || 'none'}|${JSON.stringify(data?.items || [])}`;
            if (sig !== lastProgressSignature) {
              lastProgressSignature = sig;
              this.telegramChannel.sendMessage(liveTask.telegramChatId, progressMsg).catch(() => {});
            }
          }
        }
      } else if (event === 'task_panel_update') {
        this._broadcast('task_panel_update', { taskId });
      }
    };

    let lastResultSummary = '';
    let firstRound = true;

    while (true) {
      const task = loadTask(taskId);
      if (!task) return;
      if (task.status === 'complete' || task.status === 'failed') return;
      if (task.status === 'needs_assistance') return;
      if (task.status === 'awaiting_user_input') return;

      if (pauseRequests.has(taskId)) {
        const pauseReason = task.pauseReason || 'user_pause';
        const scheduleId = task.pausedByScheduleId;
        updateTaskStatus(taskId, 'paused', { pauseReason });
        const pauseMsg = pauseReason === 'interrupted_by_schedule' && scheduleId
          ? `Paused by scheduled task (schedule: ${scheduleId}). Will resume after schedule completes.`
          : 'Paused by user request.';
        appendJournal(taskId, { type: 'pause', content: pauseMsg });
        this._broadcast('task_paused', { taskId, reason: pauseReason, scheduleId });
        flushSession(sessionId);
        return;
      }

      if (task.status === 'waiting_subagent') {
        activeRunners.delete(taskId);
        appendJournal(taskId, { type: 'pause', content: 'Waiting for sub-agents to complete.' });
        flushSession(sessionId);
        return;
      }

      // ── All steps done → deliver lastResultSummary directly ───────────────
      // The synthesis round has been removed. The AI's response from the final
      // plan step (which always ends with a write_note call) IS the final output.
      // lastResultSummary captures the last text the AI returned, which is the
      // summary it wrote after completing write_note. Deliver it as-is.
	      if (task.currentStepIndex >= task.plan.length) {
		        let finalMsg = task.finalSummary
		          || lastResultSummary
		          || 'Task completed all planned steps.';
            if (task.scheduleId && containsObsoleteProductBrand(finalMsg)) {
              const reason = buildObsoleteBrandBlockMessage('Scheduled task final output');
              appendJournal(taskId, { type: 'error', content: reason });
              updateTaskStatus(taskId, 'failed', { finalSummary: reason });
              flushSession(sessionId);
              return;
            }
	            const repairHandoffResult = await this._finalizeDevSrcSelfEditRepairHandoff(task, finalMsg);
	            if (repairHandoffResult.handled) {
	              if (!repairHandoffResult.ok) {
	                flushSession(sessionId);
	                return;
	              }
	              if (repairHandoffResult.summarySuffix) {
	                finalMsg = `${finalMsg}\n\n${repairHandoffResult.summarySuffix}`;
	              }
	            }
	            const promotionResult = await this._finalizeDevSrcSelfEditPromotion(task);
	            if (!promotionResult.ok) {
	              flushSession(sessionId);
	              return;
            }
            if (promotionResult.summarySuffix) {
              finalMsg = `${finalMsg}\n\n${promotionResult.summarySuffix}`;
            }
	        updateTaskStatus(taskId, 'complete', { finalSummary: finalMsg });
	        // If this task originated from an approved proposal session, mark the proposal executed.
        try {
          const sourceSessionId = String(task.sessionId || '');
          if (sourceSessionId.startsWith('proposal_')) {
            const proposalId = sourceSessionId.replace(/^proposal_/, '');
            if (proposalId) {
              const { markProposalExecuted } = await import('../proposals/proposal-store.js');
              markProposalExecuted(proposalId, finalMsg);
              this._broadcast('proposal_executed', { proposalId, taskId, sessionId: sourceSessionId });
            }
          }
        } catch (e: any) {
          console.warn(`[Background Task] Could not mark proposal executed for task ${taskId}:`, e?.message || e);
        }
        appendJournal(taskId, { type: 'status_push', content: 'Task complete.' });
        this._broadcast('task_complete', { taskId, summary: finalMsg });
        await this._deliverToChannel(task, finalMsg);
        this._persistResumeContextSnapshot(taskId, sessionId);
        flushSession(sessionId);
        return;
      }

      // ── Execute current step ──────────────────────────────────────────────
      updateTaskStatus(taskId, 'running');
      setTaskStepRunning(taskId, task.currentStepIndex);
      const liveTask = loadTask(taskId) || task;
      const currentStep = liveTask.plan[liveTask.currentStepIndex];

      // ── Stall nudge injection ─────────────────────────────────────────────
      // If the stall counter has fired and we haven't injected a nudge yet this
      // stall window, append a reminder message to the conversation.
      let stallNudgeMessage: string | null = null;
      if (toolCallsSinceLastStepComplete >= STALL_TOOL_CALL_THRESHOLD && !stallNudgeInjected) {
        stallNudgeInjected = true;
        const stepDesc = currentStep?.description || 'current step';
        stallNudgeMessage = [
          `[STALL DETECTED: ${toolCallsSinceLastStepComplete} tool calls with no step_complete]`,
          ``,
          `You are currently on: Step ${liveTask.currentStepIndex + 1}/${liveTask.plan.length} — "${stepDesc}"`,
          ``,
          `Either:`,
          `  A) Call step_complete(note: "what you did") if this step is actually done, then continue.`,
          `  B) Briefly describe what you're doing and why you haven't completed the step yet, then continue.`,
          ``,
          `Do NOT call declare_plan. Continue executing the current plan.`,
        ].join('\n');
        appendJournal(taskId, { type: 'status_push', content: `Stall detected: ${toolCallsSinceLastStepComplete} tool calls with no step_complete. Injecting nudge.` });
        this._broadcast('task_panel_update', { taskId });
      }

      const isWriteNoteStep = currentStep?.notes === 'write_note_completion';
      // Canonical completion detection uses durable write_note journal entries.
      const hasTaskCompleteWriteNoteAlready = isWriteNoteStep
        && Array.isArray(liveTask.journal)
        && liveTask.journal.some((entry: any) =>
          entry?.type === 'write_note'
          && /^\s*\[task_complete\]\b/i.test(String(entry?.content || ''))
        );
      const prompt = firstRound
        ? (this.openingAction
            ? `[Resuming task from heartbeat. Opening action: ${this.openingAction}]\n\n${task.prompt}`
            : task.prompt)
        : stallNudgeMessage
          ? stallNudgeMessage
          : isWriteNoteStep
            ? [
                `Continue task: ${liveTask.title}`,
                ``,
                `CURRENT STEP: ${liveTask.currentStepIndex + 1} of ${liveTask.plan.length} — FINAL STEP`,
                `STEP GOAL: ${currentStep?.description}`,
                ``,
                ...(hasTaskCompleteWriteNoteAlready
                  ? [
                      `A task_complete note is already logged. The task will complete automatically.`,
                      `Write your final plain-text summary response now — do NOT call write_note or step_complete again.`,
                    ]
                  : [
                      `This is the final step. Do the following IN ORDER:`,
                      `1. Call write_note with tag "task_complete" and a full summary of everything done:`,
                      `   what files changed, what was created/modified, key results, findings.`,
                      `   Calling write_note with tag "task_complete" will automatically complete the task.`,
                      `   Do NOT call step_complete after write_note.`,
                      `2. After write_note returns, write your final plain-text response to the user.`,
                      `   Make it clear and complete — this goes directly to chat.`,
                    ]),
              ].filter(Boolean).join('\n')
            : [
                `Continue task: ${liveTask.title}`,
                ``,
                `CURRENT STEP: ${liveTask.currentStepIndex + 1} of ${liveTask.plan.length}`,
                `STEP GOAL: ${currentStep?.description || 'No step description provided.'}`,
                ``,
                `Execute this step now. When you have finished ALL tool calls for this step, call step_complete(note: "brief summary").`,
                ``,
                `REMAINING STEPS:`,
                ...liveTask.plan.slice(liveTask.currentStepIndex + 1).map((s, i) =>
                  `  Step ${liveTask.currentStepIndex + 2 + i}: ${s.description}`
                ),
              ].filter(Boolean).join('\n');

	      firstRound = false;
      // Parse task.executorProvider ("providerId/model") → per-round model + provider override.
      // Set at task creation time by dispatchApprovedProposal when proposal has a risk_tier.
      let taskModelOverride: string | undefined;
      let taskProviderOverride: string | undefined;
      if (liveTask.executorProvider) {
        const slashIdx = liveTask.executorProvider.indexOf('/');
        if (slashIdx > 0) {
          taskProviderOverride = liveTask.executorProvider.slice(0, slashIdx);
          taskModelOverride = liveTask.executorProvider.slice(slashIdx + 1);
        } else {
          taskModelOverride = liveTask.executorProvider;
        }
      }

      const roundOutcome = await this._runRoundWithRetry(
        liveTask,
        prompt,
        sessionId,
        sendSSE,
        abortSignal,
        undefined,
        taskModelOverride,
        buildSubagentToolFilter(task.subagentProfile),
        undefined,
        taskProviderOverride,
	        task.teamSubagent ? 'team_subagent' : task.subagentProfile ? 'background_agent' : isProposalLikeSourceSession ? 'proposal_execution' : 'background_task',
	      );

      if (!roundOutcome.ok) {
        await this._pauseForAssistance(task, roundOutcome.reason, roundOutcome.detail);
        return;
      }

      const result = roundOutcome.result;
      lastResultSummary = String(result.text || '').replace(/\s+/g, ' ').trim();
      sendSSE('final', { text: String(result.text || '') });
      sendSSE('done', {
        reply: String(result.text || ''),
        thinking: String(result.thinking || ''),
      });

      // ── Clarification check ───────────────────────────────────────────────
      const freshTask = loadTask(taskId);
      const taskAfterRound = freshTask || liveTask;

      if (looksLikeClarificationQuestion(lastResultSummary)) {
        const question = extractClarificationQuestion(lastResultSummary);
        appendJournal(taskId, { type: 'status_push', content: `Task paused — agent asked a clarification question.` });
        await this._pauseForClarification(taskAfterRound, question);
        flushSession(sessionId);
        return;
      }

      // Persist session context
      const sessionHistory = getHistory(sessionId, 40);
      updateResumeContext(taskId, {
        messages: sessionHistory.slice(-MAX_RESUME_MESSAGES).map(h => ({
          role: h.role,
          content: h.content,
          timestamp: h.timestamp,
        })),
        round: (Number(task.resumeContext?.round) || 0) + 1,
      });
      flushSession(sessionId);

      if (pauseRequests.has(taskId)) {
        const t2 = loadTask(taskId);
        const pauseReason = t2?.pauseReason || 'user_pause';
        updateTaskStatus(taskId, 'paused', { pauseReason });
        appendJournal(taskId, { type: 'pause', content: 'Paused by user request.' });
        this._broadcast('task_paused', { taskId, reason: pauseReason });
        flushSession(sessionId);
        return;
      }

      // Check if handleChat hit its internal step cap
      const hitMaxSteps = /^hit max steps/i.test(lastResultSummary);
      if (hitMaxSteps) {
        appendJournal(taskId, { type: 'status_push', content: 'Round hit max tool steps — continuing.' });
        continue;
      }

      // Check if step_complete was called during this round (currentStepIndex advanced)
      const reloadedTask = loadTask(taskId);
      if (!reloadedTask) return;

      if (reloadedTask.currentStepIndex !== liveTask.currentStepIndex) {
        // Agent called step_complete and step advanced — log it and continue
        appendJournal(taskId, {
          type: 'status_push',
          content: `Step advanced from ${liveTask.currentStepIndex + 1} to ${reloadedTask.currentStepIndex + 1} via step_complete.`,
        });
        toolCallsSinceLastStepComplete = 0;
        stallNudgeInjected = false;
        buildFailureRetryCount = 0;  // NEW: Reset for new step
        this._broadcast('task_step_done', {
          taskId,
          completedStep: liveTask.currentStepIndex,
          nextStep: reloadedTask.currentStepIndex,
        });
        // Continue loop — the top of loop will check if all steps are done
        continue;
      }

      // Step did NOT advance. The agent either:
      // 1. Is still working on the step (stall counter running), or
      // 2. Said something meaningful but didn't call step_complete.
      // Final-step safeguard: if this is write_note_completion and a canonical
      // [task_complete] write_note journal entry exists, auto-complete deterministically.
      const stepAfterRound = reloadedTask.plan[reloadedTask.currentStepIndex];
      const isWriteNoteCompletionStep = stepAfterRound?.notes === 'write_note_completion';
      if (isWriteNoteCompletionStep) {
        const hasTaskCompleteWriteNote = Array.isArray(reloadedTask.journal)
          && reloadedTask.journal.some((entry: any) =>
            entry?.type === 'write_note'
            && /^\s*\[task_complete\]\b/i.test(String(entry?.content || ''))
          );

        if (hasTaskCompleteWriteNote) {
          const completedStepIndex = reloadedTask.currentStepIndex;
          mutatePlan(taskId, [{
            op: 'complete',
            step_index: completedStepIndex,
            notes: 'auto-complete: task_complete already logged',
          }]);

          const postMutationTask = loadTask(taskId);
          if (postMutationTask && postMutationTask.currentStepIndex === completedStepIndex) {
            postMutationTask.currentStepIndex = Math.min(completedStepIndex + 1, postMutationTask.plan.length);
            postMutationTask.lastProgressAt = Date.now();
            saveTask(postMutationTask);
          }

          appendJournal(taskId, {
            type: 'status_push',
            content: `Auto-advanced final step ${completedStepIndex + 1}: task_complete note already logged.`,
          });
          toolCallsSinceLastStepComplete = 0;
          stallNudgeInjected = false;
          this._broadcast('task_step_done', {
            taskId,
            completedStep: completedStepIndex,
            nextStep: completedStepIndex + 1,
          });
          continue;
        }
	      }

	      // Otherwise, continue the loop and let the model keep working this step.
	      continue;
	    }
	    } finally {
	      clearSessionMutationScope(sessionId);
	      if (isProposalLikeSourceSession && sourceSessionId && sourceSessionId !== sessionId) {
	        clearSessionMutationScope(sourceSessionId);
	      }
	    }
	  }

  private async _pauseForClarification(task: TaskRecord, question: string): Promise<void> {
    if (task.teamSubagent?.teamId && task.teamSubagent?.agentId) {
      try {
        const { appendTeamChat, queueManagerMessage } = await import('../teams/managed-teams.js');
        queueManagerMessage(task.teamSubagent.teamId, task.teamSubagent.agentId, question);
        appendTeamChat(task.teamSubagent.teamId, {
          from: 'subagent',
          fromName: task.teamSubagent.agentName || task.teamSubagent.agentId,
          fromAgentId: task.teamSubagent.agentId,
          content: `Question for manager: ${question}`,
        });
      } catch (e) {
        console.warn('[TeamSubagent] Could not route clarification to manager:', e);
      }
    }
    const freshTask = loadTask(task.id);
    if (freshTask) {
      freshTask.pendingClarificationQuestion = question;
      freshTask.status = 'awaiting_user_input';
      freshTask.pauseReason = 'awaiting_user_input';
      freshTask.lastProgressAt = Date.now();
      saveTask(freshTask);
    }
    appendJournal(task.id, { type: 'pause', content: `Task paused — waiting for clarification: ${question.slice(0, 200)}` });
    this._broadcast('task_awaiting_input', { taskId: task.id, question });
    this._broadcast('task_paused', { taskId: task.id, reason: 'awaiting_user_input' });
    const analysisMessage = await this._preparePauseRecoveryMessage(freshTask || task, 'clarification');
    await this._deliverToChannel(freshTask || task, analysisMessage || question);
	    if (!task.proposalExecution?.teamExecution && this.telegramChannel && task.channel !== 'telegram') {
      try { await this.telegramChannel.sendToAllowed(analysisMessage || question); } catch {}
    }
  }

  private async _pauseForAssistance(
    task: TaskRecord,
    reason: string,
    detail?: string,
    opts?: { pauseReason?: PauseReason },
  ): Promise<void> {
    const pausedTask = updateTaskStatus(task.id, 'needs_assistance', { pauseReason: opts?.pauseReason || 'error' }) || loadTask(task.id) || task;
    appendJournal(task.id, {
      type: 'pause',
      content: `Task paused for assistance: ${reason.slice(0, 220)}`,
      detail: detail ? detail.slice(0, 1200) : undefined,
    });

    const fullErrorMsg = detail ? `${reason}\n${detail}` : reason;
    const categorization = errorCategorizer.categorizeError(fullErrorMsg);

    try {
      const analyzer = getErrorAnalyzer();
      const history = getErrorHistory();
      if (categorization.category !== 'unknown') analyzer.recordError(fullErrorMsg, categorization.category);
      history.add({ taskId: task.id, errorMessage: reason.substring(0, 200), category: categorization.category, resolved: false });
    } catch {}

    if (categorization.confidence > 0.7 && categorization.template) {
      this._broadcast('task_error_requires_response', {
        taskId: task.id,
        errorCategory: categorization.category,
        errorMessage: reason,
        errorDetail: detail || '',
        template: categorization.template,
      });
    }

    this._broadcast('task_paused', { taskId: task.id, reason: 'needs_assistance' });
    this._broadcast('task_needs_assistance', { taskId: task.id, title: task.title, reason, detail: detail || '' });

    const fallbackMessage = [
      `Task paused and needs input: ${task.title}`,
      `Reason: ${reason}`,
      detail ? `Details: ${detail}` : '',
      `Reply in this chat with any adjustment or confirmation, and I will resume the task.`,
      `Task ID: ${task.id}`,
    ].filter(Boolean).join('\n');
    const recoveryMessage = await this._preparePauseRecoveryMessage(pausedTask, 'assistance');
    const message = recoveryMessage || fallbackMessage;

    await this._deliverToChannel(task, message);
	    if (!task.proposalExecution?.teamExecution && this.telegramChannel && task.channel !== 'telegram') {
      try { await this.telegramChannel.sendToAllowed(message); } catch {}
    }
  }

  private _broadcast(event: string, data: object): void {
    try { this.broadcast({ type: event, ...data }); } catch {}
  }

	  private async _deliverToChannel(task: TaskRecord, message: string, opts?: { forceTelegram?: boolean }): Promise<void> {
    // Sub-agent path: notify parent instead of user chat
    if (task.parentTaskId) {
      try {
        const { parentTask, allChildrenDone } = resolveSubagentCompletion(task.id, message);
        if (parentTask && allChildrenDone) {
          this._broadcast('task_step_followup_needed', { taskId: parentTask.id, delayMs: 2000 });
        }
      } catch (e) {
        console.warn('[SubAgent] resolveSubagentCompletion error:', e);
      }
      return;
    }

    // run_once_task path: verification + delivery to originating session
    if (task.taskKind === 'run_once' && task.originatingSessionId && task.status === 'complete') {
      try {
        await this._verifyAndDeliverRunOnce(task, message);
        // Re-load task to get the updated finalSummary from verification
        const updatedTask = loadTask(task.id);
        const finalMsg = updatedTask?.finalSummary || message;
        this._broadcast('task_notification', {
          taskId: task.id,
          sessionId: task.originatingSessionId,
          channel: task.channel,
          message: finalMsg
        });
      } catch (e) {
        console.warn('[BTR] run_once verification/delivery error:', e);
        // Fallback: deliver unverified to originating session
        try {
          addMessage(task.originatingSessionId, {
            role: 'assistant',
            content: message,
            timestamp: Date.now()
          } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
        } catch {}
        this._broadcast('task_notification', {
          taskId: task.id,
          sessionId: task.originatingSessionId,
          channel: task.channel,
          message
        });
      }
      return;
    }

	    if (task.taskKind === 'run_once' && task.originatingSessionId) {
      try {
        addMessage(task.originatingSessionId, {
          role: 'assistant',
          content: message,
          timestamp: Date.now()
        } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
      } catch {}
      this._broadcast('task_notification', {
        taskId: task.id,
        sessionId: task.originatingSessionId,
        channel: task.channel,
        message
      });
	      return;
	    }

    const teamExecution = task.proposalExecution?.teamExecution;
    if (teamExecution?.teamId && teamExecution?.executorAgentId) {
      const isComplete = task.status === 'complete';
      const proposalId = String(task.proposalExecution?.proposalId || '').trim();
      const agentName = task.teamSubagent?.agentName || teamExecution.executorAgentName || teamExecution.executorAgentId;
      const heading = isComplete ? 'Proposal executor completed' : 'Proposal executor update';
      const content = [
        `${heading}: ${task.title}`,
        proposalId ? `Proposal: ${proposalId}` : '',
        `Task: ${task.id}`,
        `Executor: ${agentName}`,
        '',
        String(message || '').trim() || '(No message returned.)',
      ].filter(Boolean).join('\n');
      try {
        const { appendTeamChat, queueManagerMessage } = await import('../teams/managed-teams.js');
        const chatMsg = appendTeamChat(teamExecution.teamId, {
          from: 'subagent',
          fromName: agentName,
          fromAgentId: teamExecution.executorAgentId,
          content,
          metadata: {
            source: 'team_proposal_execution',
            proposalId,
            taskId: task.id,
            runSuccess: isComplete,
          },
        });
        this._broadcast('team_chat_message', {
          teamId: teamExecution.teamId,
          chatMessage: chatMsg,
          text: String(chatMsg?.content || ''),
        });
        if (!isComplete) {
          queueManagerMessage(
            teamExecution.teamId,
            teamExecution.executorAgentId,
            [
              `Proposal executor paused or needs help.`,
              proposalId ? `Proposal ID: ${proposalId}` : '',
              `Task ID: ${task.id}`,
              `Executor: ${agentName}`,
              `Message: ${String(message || '').slice(0, 2000)}`,
              '',
              `Reply with guidance for the proposal executor. Your manager response will be mirrored into the task recovery chat and used to resume the proposal task.`,
            ].filter(Boolean).join('\n'),
          );
        }
      } catch (e) {
        console.warn('[TeamProposal] Could not deliver proposal update to team chat:', e);
      }
      try {
        const { getConfig } = await import('../../config/config.js');
        const { notifyMainAgent } = await import('../teams/notify-bridge.js');
        notifyMainAgent(
          getConfig().getWorkspacePath(),
          teamExecution.teamId,
          isComplete ? 'team_task_complete' : 'team_error',
          {
            proposalId,
            taskId: task.id,
            task: task.title,
            result: isComplete ? String(message || '').slice(0, 2000) : undefined,
            error: isComplete ? undefined : String(message || '').slice(0, 2000),
            executorAgentId: teamExecution.executorAgentId,
            executorAgentName: agentName,
            message: String(message || '').slice(0, 2000),
          },
          undefined,
          teamExecution.originatingSessionId,
        );
      } catch {}
      this._broadcast('task_notification', { taskId: task.id, sessionId: task.sessionId, channel: 'team_chat', message: content });
      return;
    }

	    // Standalone subagent path: deliver the response into the originating main
    // chat as durable context, not as a floating notification. The readable
    // assistant message is for the user; the structured user message gives the
    // next main-agent turn exact context it can reason over and follow up on.
    if (task.originatingSessionId && task.subagentProfile && !task.parentTaskId) {
      const agentId = String(task.subagentProfile || 'subagent');
      const title = String(task.title || agentId).replace(/^\[Subagent\]\s*/i, '').trim() || agentId;
      const clipped = String(message || '').trim();
      const isScheduledSubagentDelivery = String(task.originatingSessionId || '').startsWith('schedule_');
      try {
        if (!isScheduledSubagentDelivery) {
          const chatMessage = appendSubagentChatMessage(agentId, {
            role: 'agent',
            content: clipped || '(No response text returned.)',
            metadata: {
              source: 'main_agent_dispatch',
              taskId: task.id,
              success: task.status === 'complete',
              originatingSessionId: task.originatingSessionId,
            },
          });
          this._broadcast('subagent_chat_message', {
            agentId,
            message: chatMessage,
          });
        }
      } catch (e) {
        console.warn('[SubAgent] appendSubagentChatMessage failed:', e);
      }

      if (task.suppressOriginDelivery === true) {
        appendJournal(task.id, {
          type: 'status_push',
          content: `Standalone subagent "${title}" finished; result kept in the subagent task panel.`,
        });
        this._broadcast('task_panel_update', { taskId: task.id });
        this._broadcast('agent_completed', {
          taskId: task.id,
          serverAgentId: task.id,
          agentId,
          title,
          message: clipped.slice(0, 500),
        });
        return;
      }

      const contextMessage = [
        `[SUBAGENT_RESPONSE agent_id="${agentId}" task_id="${task.id}" title="${title}"]`,
        clipped.slice(0, 8000),
        `[/SUBAGENT_RESPONSE]`,
        ``,
        `Main chat note: This response came from standalone subagent "${title}". You can continue the conversation with message_subagent(agent_id: "${agentId}", message: "...") if a follow-up is needed.`,
      ].join('\n');
      const userNotice = [
        `Also, your subagent ${title} finished.`,
        ``,
        clipped || '(No response text returned.)',
      ].join('\n');

      try {
        addMessage(task.originatingSessionId, {
          role: 'user',
          content: contextMessage,
          timestamp: Date.now() - 1,
        } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
        addMessage(task.originatingSessionId, {
          role: 'assistant',
          content: userNotice,
          timestamp: Date.now(),
        } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
      } catch (e) {
        console.warn('[SubAgent] addMessage to originating session failed:', e);
      }

      this._broadcast('task_notification', {
        taskId: task.id,
        sessionId: task.originatingSessionId,
        channel: task.channel,
        agentId,
        message: userNotice,
      });
      return;
    }

    // Normal task path (scheduled, background_spawn spawned, subagent, etc.).
    // Keep delivery as an assistant notification only; the old synthetic
    // [BACKGROUND_TASK_RESULT] user turn leaked into the chat UI.
    try {
      addMessage(task.sessionId, { role: 'assistant', content: message, timestamp: Date.now() });
    } catch (e) {
      console.warn('[BTR] Delivery failed (addMessage):', e);
    }

    // Skip Telegram delivery for run_once tasks — only web delivery
    if (!task.taskKind?.startsWith('run_once') && ((opts?.forceTelegram || task.channel === 'telegram') && this.telegramChannel)) {
      try {
        if (task.telegramChatId && typeof this.telegramChannel.sendMessage === 'function') {
          await this.telegramChannel.sendMessage(task.telegramChatId, message);
        } else {
          await this.telegramChannel.sendToAllowed(message);
        }
      } catch (e) {
        console.warn('[BTR] Delivery failed (telegram):', e);
      }
    }

    this._broadcast('task_notification', { taskId: task.id, sessionId: task.sessionId, channel: task.channel, message });
  }

  private async _verifyAndDeliverRunOnce(task: TaskRecord, taskResult: string): Promise<void> {
    const noOp = () => {};
    const { modelOverride, providerOverride } = this._resolveRunOnceModel();

    // Collect evidence notes
    const bus = loadEvidenceBus(task.id);
    const notes = (bus?.entries || [])
      .filter((e: any) => e.category === 'finding' || e.category === 'artifact')
      .map((e: any) => `• ${String(e.value || '').slice(0, 300)}`)
      .join('\n');

    // Build and run verification prompt
    const verifyPrompt = this._buildVerifyPrompt(task.title, taskResult, notes);
    const verifySessionId = `run_once_verify_${task.id}_${Date.now()}`;

    let verificationText = taskResult;
    try {
      const verifyResult = await this.handleChat(
        verifyPrompt, verifySessionId, noOp,
        undefined, undefined, undefined,
        modelOverride || undefined, 'background_task',
        undefined, undefined, undefined, providerOverride || undefined,
      );
      verificationText = (verifyResult?.text || '').trim() || taskResult;
    } catch (err: any) {
      console.warn(`[RunOnce] Verification error for task ${task.id}:`, err?.message);
    } finally {
      try { clearHistory(verifySessionId); } catch {}
    }

    // Update task with verification status + final result
    task.verificationStatus = 'complete';
    task.finalSummary = verificationText;
    saveTask(task);

    // Deliver verified result to originating session
    if (task.originatingSessionId) {
      try {
        addMessage(task.originatingSessionId, {
          role: 'assistant',
          content: verificationText,
          timestamp: Date.now(),
        } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
      } catch (e) {
        console.warn('[RunOnce] addMessage to originating session failed:', e);
      }
    }

    console.log(`[RunOnce] Task "${task.title}" (${task.id}) verified and delivered to session ${task.originatingSessionId}`);
  }

  private _resolveRunOnceModel(): { modelOverride?: string; providerOverride?: string } {
    try {
      const cfg = getConfig().getConfig() as any;
      const ref = String(cfg?.agent_model_defaults?.background_task || '').trim();
      if (!ref) return {};
      const slash = ref.indexOf('/');
      if (slash > 0) return { providerOverride: ref.slice(0, slash), modelOverride: ref.slice(slash + 1) };
      return { modelOverride: ref };
    } catch {
      return {};
    }
  }

  private _buildVerifyPrompt(title: string, taskResult: string, notes: string): string {
    const lines = [
      `A task you executed has completed. Please review the results, verify the work was done correctly, and provide a clear summary.`,
      '',
      `**Task:** ${title}`,
      '',
      '**Results from execution:**',
      taskResult || '*(no output)*',
    ];
    if (notes) lines.push('', '**Evidence collected during execution:**', notes);
    lines.push(
      '',
      'Please:',
      '1. Confirm the task was completed successfully (or identify any issues)',
      '2. Highlight the key outcomes',
      '3. Note anything that needs follow-up',
      '',
      'Keep your response concise and actionable.',
    );
    return lines.join('\n');
  }
}

// ─── run_task_now: one-off background task with automatic verification ───────
// Creates a task with proper plan, runs through BackgroundTaskRunner,
// automatically verifies on completion, and delivers to originating session.

export interface RunOnceOpts {
  title: string;
  prompt: string;
  subagentId?: string;
  timeoutMs?: number;
  originatingSessionId: string;
  handleChat: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: any,
    abortSignal?: any,
    callerContext?: string,
    modelOverride?: string,
    executionMode?: string,
    toolFilter?: string[],
    attachments?: any,
    reasoningOptions?: any,
    providerOverride?: string,
  ) => Promise<{ text: string; [k: string]: any }>;
  broadcastWS: (data: object) => void;
}

/**
 * Spawn a one-off background task that runs with full plan/step tracking,
 * then automatically verifies the result and delivers to the originating session.
 * Returns immediately with task_id — execution is fully detached.
 */
export function runOnceTask(opts: RunOnceOpts): { task_id: string } {
  const task = createTask({
    title: opts.title,
    prompt: opts.prompt,
    sessionId: `run_once_${opts.originatingSessionId}_${Date.now()}`, // Isolated session for task execution
    channel: 'web',
    plan: [
      { index: 0, description: opts.prompt.slice(0, 200), status: 'pending' }
    ],
    taskKind: 'run_once',
    originatingSessionId: opts.originatingSessionId,
  });

  saveTask(task);

  // Spawn the BackgroundTaskRunner in background
  setImmediate(() => {
    try {
      const runner = new BackgroundTaskRunner(
        task.id,
        opts.handleChat as any,  // Cast to match BackgroundTaskRunner's strict signature
        opts.broadcastWS,
        null  // No telegram channel for web-based run_once tasks
      );
      runner.start().catch((err: any) => {
        console.error(`[RunOnce] BackgroundTaskRunner error for task ${task.id}:`, err?.message || err);
      });
    } catch (err: any) {
      console.error(`[RunOnce] Failed to spawn runner for task ${task.id}:`, err?.message || err);
    }
  });

  return { task_id: task.id };
}
