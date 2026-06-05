/**
 * session.ts - Simple session state for Prometheus v2
 * 
 * No plans. No verified facts. No workspace ledger. No self-learning.
 * Just conversation history.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import { stripInternalToolNotes } from './comms/reply-processor';
import { resolveActiveModelContextProfile } from './context/model-context';
import { getUsageCalibration } from '../providers/model-usage';
import { getRecentToolObservationsForContext as readRecentToolObservationsForContext } from './tool-observations';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  workStartedAt?: number;
  workEndedAt?: number;
  workDurationMs?: number;
  channel?: 'terminal' | 'telegram' | 'web' | 'mobile' | 'discord' | 'whatsapp' | 'system';
  channelLabel?: string;
  origin?: TurnOrigin;
  artifacts?: any[];
  generatedImages?: any[];
  generatedVideos?: any[];
  attachmentPreviews?: any[];
  canvasFiles?: string[];
  fileChanges?: any;
  processEntries?: any[];
  toolLog?: string; // full tool call log for this turn (injected by chat.router after turn completes)
  productCarousel?: { title: string; items: Array<{
    title: string; price?: string; description?: string; rating?: number;
    reviews?: number; tag?: string; imageUrl?: string; imagePath?: string;
    productUrl: string; merchant?: string;
  }> };
  richArtifacts?: import('./rich-artifacts').RichArtifact[];
}

export interface TurnOrigin {
  channel: 'terminal' | 'telegram' | 'web' | 'mobile' | 'discord' | 'whatsapp' | 'system';
  surface?: 'desktop_app' | 'mobile_app' | 'public_web' | 'terminal' | 'bot' | 'automation' | string;
  device?: 'computer' | 'phone' | 'tablet' | 'server' | 'unknown' | string;
  chatId?: string;
  userId?: string;
  label?: string;
  source?: string;
}

export type MainChatGoalStatus = 'active' | 'paused' | 'blocked' | 'done' | 'cleared' | 'failed';

export interface MainChatGoalState {
  id: string;
  sessionId: string;
  goal: string;
  status: MainChatGoalStatus;
  turnsUsed: number;
  goalSummaryTurn: number;
  createdAt: number;
  updatedAt: number;
  lastTurnAt?: number;
  completedAt?: number;
  lastVerdict?: 'done' | 'continue' | 'blocked' | 'failed';
  lastReason?: string;
  blockedReason?: string;
  pausedReason?: string;
  failureReason?: string;
  progressSummary?: string;
  deniedActions?: Array<{
    at: number;
    toolName: string;
    category: string;
    reason: string;
    safeAlternative: string;
  }>;
  lastSummaryAt?: number;
  lastSummaryMessageIndex?: number;
  consecutiveJudgeFailures: number;
  consecutiveRuntimeFailures: number;
}

export type CreativeMode = 'design' | 'image' | 'canvas' | 'video';

export type CreativeReferenceAuthority = 'primary' | 'supporting' | 'secondary' | 'low' | 'unknown';
export type CreativeReferenceIntent = 'style' | 'pacing' | 'structure' | 'content' | 'audio' | 'mixed';

export interface CreativeReferenceRecord {
  id: string;
  sourceUrl: string | null;
  sourceType: 'x_post' | 'web_fetch' | 'manual' | 'unknown';
  sourceTweetId?: string | null;
  sourceTweetLink?: string | null;
  authority: CreativeReferenceAuthority;
  intent: CreativeReferenceIntent;
  kind: 'image' | 'video' | 'audio' | 'other';
  path: string | null;
  absPath: string | null;
  selectedFrames: string[];
  contactSheetPath?: string | null;
  analysis?: string | null;
  transcript?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasProjectLink {
  rootPath?: string | null;
  github?: {
    repoFullName?: string | null;
    remoteUrl?: string | null;
    branch?: string | null;
    defaultBranch?: string | null;
  } | null;
  vercel?: {
    projectId?: string | null;
    projectName?: string | null;
    teamId?: string | null;
    orgId?: string | null;
    deploymentUrl?: string | null;
    dashboardUrl?: string | null;
  } | null;
}

export interface Session {
  id: string;
  history: ChatMessage[];
  workspace: string;
  title?: string;
  autoTitleLocked?: boolean;
  channel?: 'terminal' | 'telegram' | 'web' | 'mobile' | 'discord' | 'whatsapp' | 'system'; // Inferred from sessionId prefix
  createdAt: number;
  lastActiveAt: number;
  lastAssistantAt?: number;
  mobileLastReadAt?: number;
  pendingMemoryFlush?: boolean;
  pendingCompaction?: boolean;
  contextTokenEstimate?: number;
  latestContextSummary?: string;
  contextStartIndex?: number;
  contextSummaryUpdatedAt?: number;
  tags?: string[];
  activatedToolCategories?: string[];
  activatedSkillIds?: string[];
  activatedSkillResources?: Record<string, string[]>;
  businessContextEnabled?: boolean;
  creativeMode?: CreativeMode | null;
  creativeReferences?: CreativeReferenceRecord[];
  canvasProjectRoot?: string | null;
  canvasProjectLabel?: string | null;
  canvasProjectLink?: CanvasProjectLink | null;
  mainChatGoal?: MainChatGoalState | null;
  mainChatGoalHistory?: MainChatGoalState[];
}

export interface SessionMutationScope {
  allowedFiles?: string[];
  allowedDirs?: string[];
}

export interface SessionSummary {
  id: string;
  channel: 'terminal' | 'telegram' | 'web' | 'mobile' | 'discord' | 'whatsapp' | 'system';
  createdAt: number;
  lastActiveAt: number;
  lastMessageAt?: number;
  lastAssistantAt?: number;
  mobileLastReadAt?: number;
  mobileUnread?: boolean;
  activeRun?: boolean;
  messageCount: number;
  title: string;
  preview: string;
  creativeMode?: CreativeMode | null;
  canvasProjectRoot?: string | null;
  canvasProjectLabel?: string | null;
  canvasProjectLink?: CanvasProjectLink | null;
  mainChatGoal?: MainChatGoalState | null;
}

export interface SessionSearchResult extends SessionSummary {
  matchedRole: ChatMessage['role'] | 'title';
  matchedContent: string;
  matchedIndex: number;
}

export interface SessionListOptions {
  channel?: Session['channel'];
  limit?: number;
  offset?: number;
}

export interface SessionListPage {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface SessionIndex {
  summaries: Record<string, SessionSummary>;
  updatedAt: number;
}

const sessions = new Map<string, Session>();
export const PRE_COMPACTION_MEMORY_FLUSH_PROMPT = [
  'SYSTEM: Context is getting long. Before we continue, do this NOW (be quick):',
  '1. memory_write — save new facts/preferences/rules to the correct file: user, soul, or memory',
  '2. persona_update USER.md — update anything new you learned about your human (name, preferences, quirks, projects)',
  '3. persona_update SOUL.md — if you developed any new operating principles or learned how to work better with this human, add them',
  '4. write_note — log a 1-2 line session note via the write_note tool (intraday notes)',
  'After writing, reply with just: NO_REPLY (the user does not need to see this turn)',
  'Only send a real reply if there is something critical to tell the user right now.',
].join('\n');
export const PRE_COMPACTION_SUMMARY_PROMPT = 'Before continuing: summarize the conversation so far into a compact context note. Include goals, constraints, decisions, and open items in <= 180 words.';
const API_HISTORY_PRUNE_THRESHOLD_CHARS = 3000;
const API_HISTORY_PRUNE_KEEP_CHARS = 2500;
const SESSION_CLEANUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_SESSION_ID_RE = /^(task_|cron_|brain_|auto_)/i;
const INTERNAL_SESSION_ID_RE = /^(brain_thought_|brain_dream_|brain_dream_cleanup_|subagent_chat_)/i;
const SESSION_SAVE_DEBOUNCE_MS = 500;
const sessionSaveTimers = new Map<string, NodeJS.Timeout>();
const sessionMutationScopes = new Map<string, SessionMutationScope>();
let sessionIndexCache: SessionIndex | null = null;
let sessionIndexCommandTitleRebuildAttempted = false;

const SESSION_DIR = (() => {
  try {
    return path.join(getConfig().getConfigDir(), 'sessions');
  } catch {
    return path.join(process.cwd(), '.prometheus', 'sessions');
  }
})();

function ensureSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function sessionIndexPath(): string {
  return path.join(SESSION_DIR, '_index.json');
}

function scrubPersistedText(value: string | undefined | null): string {
  const text = String(value || '');
  try {
    const { scrubSecrets } = require('../security/vault');
    return scrubSecrets(text);
  } catch {
    return text;
  }
}

function scrubPersistedData(value: any): any {
  if (typeof value === 'string') return scrubPersistedText(value);
  if (Array.isArray(value)) return value.map((item) => scrubPersistedData(item));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = scrubPersistedData(entry);
    }
    return out;
  }
  return value;
}

function scrubMainChatGoal(goal: MainChatGoalState | null | undefined): MainChatGoalState | null | undefined {
  if (!goal) return goal;
  return {
    ...goal,
    goal: scrubPersistedText(goal.goal),
    lastReason: goal.lastReason ? scrubPersistedText(goal.lastReason) : goal.lastReason,
    blockedReason: goal.blockedReason ? scrubPersistedText(goal.blockedReason) : goal.blockedReason,
    pausedReason: goal.pausedReason ? scrubPersistedText(goal.pausedReason) : goal.pausedReason,
    failureReason: goal.failureReason ? scrubPersistedText(goal.failureReason) : goal.failureReason,
    progressSummary: goal.progressSummary ? scrubPersistedText(goal.progressSummary) : goal.progressSummary,
    deniedActions: Array.isArray(goal.deniedActions)
      ? goal.deniedActions.map((item) => ({
          ...item,
          toolName: scrubPersistedText(item.toolName),
          category: scrubPersistedText(item.category),
          reason: scrubPersistedText(item.reason),
          safeAlternative: scrubPersistedText(item.safeAlternative),
        }))
      : goal.deniedActions,
  };
}

export function normalizeCreativeMode(input: any): CreativeMode | null {
  const mode = String(input || '').trim().toLowerCase();
  if (mode === 'design' || mode === 'image' || mode === 'canvas' || mode === 'video') {
    return mode as CreativeMode;
  }
  return null;
}

function normalizeCreativeReferenceAuthority(input: any): CreativeReferenceAuthority {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'primary' || value === 'supporting' || value === 'secondary' || value === 'low' || value === 'unknown') {
    return value as CreativeReferenceAuthority;
  }
  return 'unknown';
}

function normalizeCreativeReferenceIntent(input: any): CreativeReferenceIntent {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'style' || value === 'pacing' || value === 'structure' || value === 'content' || value === 'audio' || value === 'mixed') {
    return value as CreativeReferenceIntent;
  }
  return 'mixed';
}

function normalizeCreativeReferenceKind(input: any): CreativeReferenceRecord['kind'] {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'image' || value === 'video' || value === 'audio' || value === 'other') return value;
  return 'other';
}

function normalizeCreativeReferenceRecord(input: any): CreativeReferenceRecord | null {
  const pathValue = typeof input?.path === 'string' && input.path.trim() ? input.path.trim() : null;
  const absPathValue = typeof input?.absPath === 'string' && input.absPath.trim()
    ? input.absPath.trim()
    : (typeof input?.abs_path === 'string' && input.abs_path.trim() ? input.abs_path.trim() : null);
  const sourceUrl = typeof input?.sourceUrl === 'string' && input.sourceUrl.trim()
    ? input.sourceUrl.trim()
    : (typeof input?.source_url === 'string' && input.source_url.trim() ? input.source_url.trim() : null);
  const seed = [
    pathValue,
    absPathValue,
    sourceUrl,
    input?.sourceTweetId || input?.source_tweet_id || '',
    Date.now(),
  ].filter(Boolean).join(':');
  const id = String(input?.id || `cref_${Buffer.from(seed || Math.random().toString()).toString('base64url').slice(0, 16)}`);
  const now = new Date().toISOString();
  const selectedFramesRaw = Array.isArray(input?.selectedFrames)
    ? input.selectedFrames
    : (Array.isArray(input?.selected_frames) ? input.selected_frames : []);
  return {
    id,
    sourceUrl,
    sourceType: (['x_post', 'web_fetch', 'manual', 'unknown'].includes(String(input?.sourceType || input?.source_type || ''))
      ? String(input?.sourceType || input?.source_type)
      : 'unknown') as CreativeReferenceRecord['sourceType'],
    sourceTweetId: input?.sourceTweetId || input?.source_tweet_id ? String(input?.sourceTweetId || input?.source_tweet_id) : null,
    sourceTweetLink: input?.sourceTweetLink || input?.source_tweet_link ? String(input?.sourceTweetLink || input?.source_tweet_link) : null,
    authority: normalizeCreativeReferenceAuthority(input?.authority),
    intent: normalizeCreativeReferenceIntent(input?.intent),
    kind: normalizeCreativeReferenceKind(input?.kind),
    path: pathValue,
    absPath: absPathValue,
    selectedFrames: selectedFramesRaw.map((value: any) => String(value || '').trim()).filter(Boolean).slice(0, 16),
    contactSheetPath: input?.contactSheetPath || input?.contact_sheet_path ? String(input?.contactSheetPath || input?.contact_sheet_path) : null,
    analysis: typeof input?.analysis === 'string' && input.analysis.trim() ? input.analysis.trim().slice(0, 2800) : null,
    transcript: typeof input?.transcript === 'string' && input.transcript.trim() ? input.transcript.trim().slice(0, 4000) : null,
    note: typeof input?.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 1200) : null,
    createdAt: String(input?.createdAt || input?.created_at || now),
    updatedAt: String(input?.updatedAt || input?.updated_at || now),
  };
}

function normalizeCreativeReferences(input: any): CreativeReferenceRecord[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(normalizeCreativeReferenceRecord)
    .filter((item): item is CreativeReferenceRecord => !!item)
    .slice(0, 120);
}

function normalizeMainChatGoal(input: any, sessionId: string): MainChatGoalState | null {
  if (!input || typeof input !== 'object') return null;
  const goal = String(input.goal || '').trim();
  if (!goal) return null;
  const rawStatus = String(input.status || 'active').trim().toLowerCase();
  const status: MainChatGoalStatus = (
    rawStatus === 'active'
    || rawStatus === 'paused'
    || rawStatus === 'blocked'
    || rawStatus === 'done'
    || rawStatus === 'cleared'
    || rawStatus === 'failed'
  ) ? rawStatus : 'active';
  const now = Date.now();
  const deniedActionsRaw = Array.isArray(input.deniedActions)
    ? input.deniedActions
    : (Array.isArray(input.denied_actions) ? input.denied_actions : []);
  const deniedActions = deniedActionsRaw
    .map((item: any) => ({
      at: Number.isFinite(Number(item?.at)) ? Number(item.at) : now,
      toolName: String(item?.toolName || item?.tool_name || '').trim().slice(0, 120),
      category: String(item?.category || '').trim().slice(0, 120),
      reason: String(item?.reason || '').trim().slice(0, 600),
      safeAlternative: String(item?.safeAlternative || item?.safe_alternative || '').trim().slice(0, 600),
    }))
    .filter((item: any) => item.toolName || item.category || item.reason)
    .slice(-20);
  return {
    id: String(input.id || `goal_${now}_${Math.random().toString(16).slice(2, 8)}`),
    sessionId: String(input.sessionId || input.session_id || sessionId),
    goal,
    status,
    turnsUsed: Math.max(0, Math.floor(Number(input.turnsUsed ?? input.turns_used ?? 0) || 0)),
    goalSummaryTurn: Math.max(0, Math.floor(Number(input.goalSummaryTurn ?? input.goal_summary_turn ?? 0) || 0)),
    createdAt: Number.isFinite(Number(input.createdAt ?? input.created_at)) ? Number(input.createdAt ?? input.created_at) : now,
    updatedAt: Number.isFinite(Number(input.updatedAt ?? input.updated_at)) ? Number(input.updatedAt ?? input.updated_at) : now,
    lastTurnAt: Number.isFinite(Number(input.lastTurnAt ?? input.last_turn_at)) ? Number(input.lastTurnAt ?? input.last_turn_at) : undefined,
    completedAt: Number.isFinite(Number(input.completedAt ?? input.completed_at)) ? Number(input.completedAt ?? input.completed_at) : undefined,
    lastVerdict: ['done', 'continue', 'blocked', 'failed'].includes(String(input.lastVerdict || input.last_verdict || ''))
      ? String(input.lastVerdict || input.last_verdict) as MainChatGoalState['lastVerdict']
      : undefined,
    lastReason: typeof input.lastReason === 'string' ? input.lastReason : (typeof input.last_reason === 'string' ? input.last_reason : undefined),
    blockedReason: typeof input.blockedReason === 'string' ? input.blockedReason : (typeof input.blocked_reason === 'string' ? input.blocked_reason : undefined),
    pausedReason: typeof input.pausedReason === 'string' ? input.pausedReason : (typeof input.paused_reason === 'string' ? input.paused_reason : undefined),
    failureReason: typeof input.failureReason === 'string' ? input.failureReason : (typeof input.failure_reason === 'string' ? input.failure_reason : undefined),
    progressSummary: typeof input.progressSummary === 'string' ? input.progressSummary : (typeof input.progress_summary === 'string' ? input.progress_summary : undefined),
    deniedActions,
    lastSummaryAt: Number.isFinite(Number(input.lastSummaryAt ?? input.last_summary_at)) ? Number(input.lastSummaryAt ?? input.last_summary_at) : undefined,
    lastSummaryMessageIndex: Number.isFinite(Number(input.lastSummaryMessageIndex ?? input.last_summary_message_index))
      ? Math.max(0, Math.floor(Number(input.lastSummaryMessageIndex ?? input.last_summary_message_index)))
      : undefined,
    consecutiveJudgeFailures: Math.max(0, Math.floor(Number(input.consecutiveJudgeFailures ?? input.consecutive_judge_failures ?? 0) || 0)),
    consecutiveRuntimeFailures: Math.max(0, Math.floor(Number(input.consecutiveRuntimeFailures ?? input.consecutive_runtime_failures ?? 0) || 0)),
  };
}

function normalizeMainChatGoalHistory(input: any, sessionId: string): MainChatGoalState[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .map((item) => normalizeMainChatGoal(item, sessionId))
    .filter((item): item is MainChatGoalState => !!item)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(-200);
}

function getSessionPath(id: string): string {
  return path.join(SESSION_DIR, `${id}.json`);
}

function defaultSessionIndex(): SessionIndex {
  return { summaries: {}, updatedAt: Date.now() };
}

function normalizeSessionSummary(input: any): SessionSummary | null {
  const id = String(input?.id || '').trim();
  if (!id) return null;
  const createdAt = Number(input?.createdAt);
  const lastActiveAt = Number(input?.lastActiveAt);
  const messageCount = Number(input?.messageCount);
  const channel = input?.channel === 'terminal'
    || input?.channel === 'telegram'
    || input?.channel === 'mobile'
    || input?.channel === 'discord'
    || input?.channel === 'whatsapp'
    || input?.channel === 'system'
    ? input.channel
    : inferChannelFromSessionId(id);
  return {
    id,
    channel,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    lastActiveAt: Number.isFinite(lastActiveAt) ? lastActiveAt : Date.now(),
    lastAssistantAt: Number.isFinite(Number(input?.lastAssistantAt)) ? Number(input.lastAssistantAt) : undefined,
    mobileLastReadAt: Number.isFinite(Number(input?.mobileLastReadAt)) ? Number(input.mobileLastReadAt) : undefined,
    mobileUnread: input?.mobileUnread === true,
    activeRun: input?.activeRun === true,
    messageCount: Number.isFinite(messageCount) ? Math.max(0, Math.floor(messageCount)) : 0,
    title: String(input?.title || '(empty)').slice(0, 60) || '(empty)',
    preview: String(input?.preview || input?.title || '(empty)').slice(0, 60) || '(empty)',
    creativeMode: normalizeCreativeMode(input?.creativeMode),
    canvasProjectRoot: typeof input?.canvasProjectRoot === 'string' && input.canvasProjectRoot.trim()
      ? input.canvasProjectRoot
      : null,
    canvasProjectLabel: typeof input?.canvasProjectLabel === 'string' && input.canvasProjectLabel.trim()
      ? input.canvasProjectLabel
      : null,
    canvasProjectLink: normalizeCanvasProjectLink(input?.canvasProjectLink),
  };
}

function loadSessionIndex(): SessionIndex {
  if (sessionIndexCache) return sessionIndexCache;
  const p = sessionIndexPath();
  if (!fs.existsSync(p)) {
    sessionIndexCache = defaultSessionIndex();
    return sessionIndexCache;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as any;
    const summaries: Record<string, SessionSummary> = {};
    if (parsed?.summaries && typeof parsed.summaries === 'object') {
      for (const [id, raw] of Object.entries(parsed.summaries)) {
        const normalized = normalizeSessionSummary({ ...(raw as any), id });
        if (normalized) summaries[normalized.id] = normalized;
      }
    }
    sessionIndexCache = {
      summaries,
      updatedAt: Number.isFinite(Number(parsed?.updatedAt)) ? Number(parsed.updatedAt) : Date.now(),
    };
    return sessionIndexCache;
  } catch {
    sessionIndexCache = defaultSessionIndex();
    return sessionIndexCache;
  }
}

function saveSessionIndex(index: SessionIndex): void {
  ensureSessionDir();
  index.updatedAt = Date.now();
  sessionIndexCache = index;
  fs.writeFileSync(sessionIndexPath(), JSON.stringify(index, null, 2), 'utf-8');
}

function isCommandTitleText(value: any): boolean {
  const text = String(value || '').trim();
  return /^\/[a-z][\w-]*(?:@\w+)?(?:\s|$)/i.test(text);
}

function isSessionTitleCommandMessage(msg: any): boolean {
  if (!msg || msg.role !== 'user') return false;
  return isCommandTitleText(msg.content);
}

function normalizeSessionTitleText(value: any): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_~>[\]()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGreetingOnlySessionMessage(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  return /^(?:hey|hi|hello|yo|sup|gm|good\s+(?:morning|afternoon|evening)|howdy|hiya|heya|thanks|thank you|ok|okay|cool|nice|great|test|testing|new chat|greeting)[\s!.,-]*(?:prom|prometheus)?[\s!.,-]*(?:how(?:'|’)s it going\??|what(?:'|’)s up\??)?$/i.test(t);
}

function titleCaseSessionWord(word: string, index: number): string {
  const lower = String(word || '').toLowerCase();
  const keepLower = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'via', 'with']);
  const upper = new Set(['ai', 'api', 'ci', 'css', 'html', 'ui', 'ux', 'llm', 'mcp', 'pwa', 'qr', 'sms', 'seo']);
  if (upper.has(lower)) return lower.toUpperCase();
  if (index > 0 && keepLower.has(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function polishSessionTitle(raw: string): string {
  let text = normalizeSessionTitleText(raw)
    .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, '')
    .replace(/^(?:please\s+)?(?:can|could|would)\s+we\s+/i, '')
    .replace(/^(?:please\s+)?(?:help\s+me\s+|help\s+us\s+|help\s+)/i, '')
    .replace(/^(?:please\s+)?(?:look\s+into|check\s+out|take\s+a\s+look\s+at|investigate|review|fix|update|add|create|make|build|implement|debug)\s+/i, (match) => {
      const verb = match.replace(/please\s+/i, '').trim();
      return `${verb.replace(/\s+/g, ' ')} `;
    })
    .replace(/\b(?:please|pls|thanks|thank you)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text
    .replace(/\b(?:i think|maybe|kind of|sort of|basically|actually)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = text.split(/\s+/).filter(Boolean);
  const stopAt = words.findIndex((word, index) => index >= 3 && /^(?:because|where|while|when|after|before|so|and|but|however)$/i.test(word));
  const kept = (stopAt > 0 ? words.slice(0, stopAt) : words).slice(0, 7);
  const title = kept.map(titleCaseSessionWord).join(' ').replace(/[.,:;!?-]+$/g, '').trim();
  return title.length > 56 ? `${title.slice(0, 53).trim()}...` : title;
}

export function getSessionTitleFromHistory(history: any[]): string {
  const earlyUsers = (Array.isArray(history) ? history : [])
    .filter((msg) => msg?.role === 'user' && !isSessionTitleCommandMessage(msg))
    .slice(0, 3);
  const candidate = earlyUsers
    .map((msg) => normalizeSessionTitleText(msg?.content))
    .find((text) => text.length >= 8 && !isGreetingOnlySessionMessage(text));
  return candidate ? polishSessionTitle(candidate) || 'New chat' : 'New chat';
}

function shouldLockExistingSessionTitle(title: any): boolean {
  const current = String(title || '').trim();
  return !!current && current !== 'New chat' && !isCommandTitleText(current) && !isGreetingOnlySessionMessage(current);
}

function applyAutoSessionTitleOnce(session: Session): void {
  if (!session || session.autoTitleLocked === true) return;
  if (shouldLockExistingSessionTitle(session.title)) return;
  const nextTitle = getSessionTitleFromHistory(session.history);
  if (!nextTitle || nextTitle === 'New chat') return;
  session.title = nextTitle;
}

export function getSessionDisplayTitle(session: Pick<Session, 'title' | 'history'>): string {
  const current = String(session?.title || '').trim();
  return current || getSessionTitleFromHistory(session?.history || []);
}

function getLastAssistantTimestamp(history: any[]): number | undefined {
  if (!Array.isArray(history)) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role !== 'assistant') continue;
    const ts = Number(msg.timestamp || 0);
    return Number.isFinite(ts) && ts > 0 ? ts : Date.now();
  }
  return undefined;
}

function isSummaryTimelineMessage(msg: any): boolean {
  const content = String(msg?.content || '').trim();
  if (!content) return false;
  if (content === PRE_COMPACTION_SUMMARY_PROMPT) return false;
  if (content === PRE_COMPACTION_MEMORY_FLUSH_PROMPT) return false;
  if (/^\[(?:Rolling context summary|Compacted context summary|Active goal progress summary)\]/i.test(content)) return false;
  return msg?.role === 'user' || msg?.role === 'assistant';
}

function getLastMessageTimestamp(history: any[]): number | undefined {
  if (!Array.isArray(history)) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!isSummaryTimelineMessage(msg)) continue;
    const ts = Number(msg.timestamp || 0);
    return Number.isFinite(ts) && ts > 0 ? ts : Date.now();
  }
  return undefined;
}

function getMobileUnreadState(lastAssistantAt: number | undefined, mobileLastReadAt: number | undefined): boolean {
  const assistantAt = Number(lastAssistantAt || 0);
  if (!Number.isFinite(assistantAt) || assistantAt <= 0) return false;
  const readAt = Number(mobileLastReadAt || 0);
  return !Number.isFinite(readAt) || readAt < assistantAt;
}

function buildSessionSummary(session: Session): SessionSummary {
  if (INTERNAL_SESSION_ID_RE.test(session.id)) {
    return {
      id: session.id,
      channel: 'system',
      createdAt: Number(session.createdAt || Date.now()),
      lastActiveAt: Number(session.lastActiveAt || Date.now()),
      lastAssistantAt: undefined,
      mobileLastReadAt: undefined,
      mobileUnread: false,
      activeRun: false,
      messageCount: 0,
      title: '(internal)',
      preview: '(internal)',
      creativeMode: null,
      canvasProjectRoot: null,
      canvasProjectLabel: null,
      canvasProjectLink: null,
      mainChatGoal: null,
    };
  }
  const title = getSessionDisplayTitle(session);
  const lastMessageAt = getLastMessageTimestamp(session.history);
  const lastAssistantAt = getLastAssistantTimestamp(session.history);
  const mobileLastReadAt = Number.isFinite(Number(session.mobileLastReadAt)) ? Number(session.mobileLastReadAt) : undefined;
  return {
    id: session.id,
    channel: session.channel || inferChannelFromSessionId(session.id),
    createdAt: Number(session.createdAt || Date.now()),
    lastActiveAt: Number(session.lastActiveAt || Date.now()),
    lastMessageAt,
    lastAssistantAt,
    mobileLastReadAt,
    mobileUnread: getMobileUnreadState(lastAssistantAt, mobileLastReadAt),
    activeRun: false,
    messageCount: Array.isArray(session.history) ? session.history.length : 0,
    title,
    preview: title,
    creativeMode: session.creativeMode || null,
    canvasProjectRoot: session.canvasProjectRoot || null,
    canvasProjectLabel: session.canvasProjectLabel || null,
    canvasProjectLink: normalizeCanvasProjectLink(session.canvasProjectLink),
    mainChatGoal: session.mainChatGoal || null,
  };
}

function upsertSessionSummary(session: Session): void {
  const index = loadSessionIndex();
  const summary = buildSessionSummary(session);
  const shouldIndex = summary.messageCount > 0 || summary.channel === 'mobile';
  if (shouldIndex) {
    index.summaries[summary.id] = summary;
  } else {
    delete index.summaries[summary.id];
  }
  saveSessionIndex(index);
}

function removeSessionSummary(id: string): void {
  const index = loadSessionIndex();
  if (!index.summaries[id]) return;
  delete index.summaries[id];
  saveSessionIndex(index);
}

function buildSessionSummaryFromFile(sessionId: string): SessionSummary | null {
  if (INTERNAL_SESSION_ID_RE.test(sessionId)) return null;
  const filePath = getSessionPath(sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const history = Array.isArray(data?.history) ? data.history : [];
    const title = String(data?.title || '').trim() || getSessionTitleFromHistory(history);
    const lastMessageAt = getLastMessageTimestamp(history);
    const lastAssistantAt = getLastAssistantTimestamp(history);
    const mobileLastReadAt = Number.isFinite(Number(data?.mobileLastReadAt)) ? Number(data.mobileLastReadAt) : undefined;
    const channel = data?.channel === 'terminal'
      || data?.channel === 'telegram'
      || data?.channel === 'mobile'
      || data?.channel === 'discord'
      || data?.channel === 'whatsapp'
      || data?.channel === 'system'
      ? data.channel
      : inferChannelFromSessionId(sessionId);
    return {
      id: String(data?.id || sessionId),
      channel,
      createdAt: Number.isFinite(Number(data?.createdAt)) ? Number(data.createdAt) : Date.now(),
      lastActiveAt: Number.isFinite(Number(data?.lastActiveAt)) ? Number(data.lastActiveAt) : Date.now(),
      lastMessageAt,
      lastAssistantAt,
      mobileLastReadAt,
      mobileUnread: getMobileUnreadState(lastAssistantAt, mobileLastReadAt),
      activeRun: false,
      messageCount: history.length,
      title,
      preview: title,
      creativeMode: normalizeCreativeMode(data?.creativeMode),
      canvasProjectRoot: typeof data?.canvasProjectRoot === 'string' && data.canvasProjectRoot.trim()
        ? data.canvasProjectRoot
        : null,
      canvasProjectLabel: typeof data?.canvasProjectLabel === 'string' && data.canvasProjectLabel.trim()
        ? data.canvasProjectLabel
        : null,
      canvasProjectLink: normalizeCanvasProjectLink(data?.canvasProjectLink),
      mainChatGoal: normalizeMainChatGoal(data?.mainChatGoal, sessionId),
    };
  } catch {
    return null;
  }
}

function rebuildSessionIndex(): SessionIndex {
  ensureSessionDir();
  const index = defaultSessionIndex();
  const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.json') && f !== '_index.json');
  for (const file of files) {
    const sessionId = file.slice(0, -5);
    const summary = buildSessionSummaryFromFile(sessionId);
    if (summary && (summary.messageCount > 0 || summary.channel === 'mobile')) {
      index.summaries[summary.id] = summary;
    }
  }
  saveSessionIndex(index);
  return index;
}

function getSortedSessionSummaries(channel?: Session['channel']): SessionSummary[] {
  ensureSessionDir();
  let index = loadSessionIndex();
  const hasSessionFiles = fs.readdirSync(SESSION_DIR).some((f) => f.endsWith('.json') && f !== '_index.json');
  if (hasSessionFiles) {
    if (Object.keys(index.summaries).length === 0) {
      index = rebuildSessionIndex();
    } else if (
      !sessionIndexCommandTitleRebuildAttempted
      && Object.values(index.summaries).some((summary) => isCommandTitleText(summary.title))
    ) {
      sessionIndexCommandTitleRebuildAttempted = true;
      index = rebuildSessionIndex();
    } else if (Object.values(index.summaries).some((summary) => summary.messageCount > 0 && !summary.lastMessageAt)) {
      index = rebuildSessionIndex();
    }
  }
  return Object.values(index.summaries)
    .filter((summary) => !INTERNAL_SESSION_ID_RE.test(summary.id))
    .filter((summary) => !channel || summary.channel === channel)
    .filter((summary) => summary.messageCount > 0 || summary.channel === 'mobile')
    .sort((a, b) => Number(b.lastMessageAt || b.lastActiveAt || b.createdAt || 0) - Number(a.lastMessageAt || a.lastActiveAt || a.createdAt || 0));
}

export function listSessionSummaries(channel?: Session['channel']): SessionSummary[];
export function listSessionSummaries(options: SessionListOptions): SessionListPage;
export function listSessionSummaries(input?: Session['channel'] | SessionListOptions): SessionSummary[] | SessionListPage {
  const options = typeof input === 'object' && input !== null ? input : { channel: input };
  const sorted = getSortedSessionSummaries(options.channel);
  if (typeof input !== 'object' || input === null) return sorted;

  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(200, Math.floor(Number(options.limit))))
    : 20;
  const offset = Number.isFinite(Number(options.offset))
    ? Math.max(0, Math.floor(Number(options.offset)))
    : 0;
  const sessions = sorted.slice(offset, offset + limit);
  return {
    sessions,
    total: sorted.length,
    limit,
    offset,
    hasMore: offset + sessions.length < sorted.length,
  };
}

function readSessionFileForSearch(sessionId: string): Session | null {
  const cached = sessions.get(sessionId);
  if (cached) return cached;
  const filePath = getSessionPath(sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      id: String(data?.id || sessionId),
      history: Array.isArray(data?.history) ? data.history : [],
      workspace: typeof data?.workspace === 'string' ? data.workspace : getConfig().getWorkspacePath(),
      channel: data?.channel || inferChannelFromSessionId(sessionId),
      createdAt: Number.isFinite(Number(data?.createdAt)) ? Number(data.createdAt) : Date.now(),
      lastActiveAt: Number.isFinite(Number(data?.lastActiveAt)) ? Number(data.lastActiveAt) : Date.now(),
      lastAssistantAt: Number.isFinite(Number(data?.lastAssistantAt)) ? Number(data.lastAssistantAt) : undefined,
      mobileLastReadAt: Number.isFinite(Number(data?.mobileLastReadAt)) ? Number(data.mobileLastReadAt) : undefined,
      pendingMemoryFlush: data?.pendingMemoryFlush === true,
      pendingCompaction: data?.pendingCompaction === true,
      contextTokenEstimate: Number.isFinite(Number(data?.contextTokenEstimate)) ? Number(data.contextTokenEstimate) : undefined,
      latestContextSummary: typeof data?.latestContextSummary === 'string' ? data.latestContextSummary : undefined,
      contextStartIndex: Number.isFinite(Number(data?.contextStartIndex)) ? Math.max(0, Math.floor(Number(data.contextStartIndex))) : undefined,
      contextSummaryUpdatedAt: Number.isFinite(Number(data?.contextSummaryUpdatedAt)) ? Number(data.contextSummaryUpdatedAt) : undefined,
      activatedToolCategories: Array.isArray(data?.activatedToolCategories) ? data.activatedToolCategories : [],
      activatedSkillIds: Array.isArray(data?.activatedSkillIds) ? data.activatedSkillIds : [],
      businessContextEnabled: data?.businessContextEnabled === true,
      creativeMode: normalizeCreativeMode(data?.creativeMode),
      creativeReferences: normalizeCreativeReferences(data?.creativeReferences),
      canvasProjectRoot: typeof data?.canvasProjectRoot === 'string' && data.canvasProjectRoot.trim() ? data.canvasProjectRoot : null,
      canvasProjectLabel: typeof data?.canvasProjectLabel === 'string' && data.canvasProjectLabel.trim() ? data.canvasProjectLabel : null,
      canvasProjectLink: normalizeCanvasProjectLink(data?.canvasProjectLink),
      mainChatGoal: normalizeMainChatGoal(data?.mainChatGoal, sessionId),
      mainChatGoalHistory: normalizeMainChatGoalHistory(data?.mainChatGoalHistory, sessionId),
    };
  } catch {
    return null;
  }
}

export function searchSessionSummaries(
  query: string,
  options: { channel?: Session['channel']; limit?: number } = {},
): SessionSearchResult[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(200, Math.floor(Number(options.limit))))
    : 80;
  const summaries = listSessionSummaries(options.channel);
  const results: SessionSearchResult[] = [];

  for (const summary of summaries) {
    const title = String(summary.title || 'New chat');
    const titleIndex = title.toLowerCase().indexOf(q);
    const session = readSessionFileForSearch(summary.id);
    const history = Array.isArray(session?.history) ? session.history : [];
    const matchedMessage = history.find((msg) => {
      const content = String(msg?.content || '');
      return content.toLowerCase().includes(q);
    });
    if (matchedMessage) {
      const content = String(matchedMessage.content || '');
      results.push({
        ...summary,
        matchedRole: matchedMessage.role === 'assistant' ? 'assistant' : 'user',
        matchedContent: content,
        matchedIndex: content.toLowerCase().indexOf(q),
      });
    } else if (titleIndex >= 0) {
      results.push({
        ...summary,
        matchedRole: 'title',
        matchedContent: title,
        matchedIndex: titleIndex,
      });
    } else {
      continue;
    }
    if (results.length >= limit) break;
  }

  return results;
}

export function sessionExists(id: string): boolean {
  const sessionId = String(id || '').trim();
  return !!sessionId && fs.existsSync(getSessionPath(sessionId));
}

export function touchSession(id: string, options: { channel?: Session['channel']; title?: string } = {}): Session {
  const session = getSession(id);
  if (options.channel) session.channel = options.channel;
  session.lastActiveAt = Date.now();

  const title = String(options.title || '').trim();
  if (title && !session.history.length) {
    session.history.push({
      role: 'user',
      content: title,
      timestamp: session.lastActiveAt,
      channel: session.channel,
      channelLabel: session.channel === 'mobile' ? 'Mobile app' : session.channel,
      origin: session.channel === 'mobile'
        ? { channel: 'mobile', surface: 'mobile_app', device: 'phone', label: 'Mobile app', source: 'session_touch' }
        : undefined,
    });
  }

  saveSession(id);
  return session;
}


function inferChannelFromSessionId(sessionId: string): NonNullable<Session['channel']> {
  if (sessionId.startsWith('cli_')) return 'terminal';
  if (sessionId.startsWith('telegram_')) return 'telegram';
  if (sessionId.startsWith('mobile_')) return 'mobile';
  if (sessionId.startsWith('discord_')) return 'discord';
  if (sessionId.startsWith('whatsapp_')) return 'whatsapp';
  if (sessionId.startsWith('task_') || sessionId.startsWith('cron_')) return 'system';
  if (sessionId.startsWith('brain_')) return 'system';
  if (sessionId.startsWith('auto_')) return 'system';
  return 'web'; // default for custom/web sessions
}

function resolveNumCtx(): number {
  // Explicit overrides win (used to pin a local Ollama num_ctx regardless of model).
  const envCandidates = [
    process.env.LOCALCLAW_SESSION_NUM_CTX,
    process.env.LOCALCLAW_CHAT_NUM_CTX,
  ];
  for (const raw of envCandidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 512) return Math.floor(n);
  }
  try {
    const cfg: any = getConfig().getConfig();
    const candidate = Number(cfg?.llm?.num_ctx);
    if (Number.isFinite(candidate) && candidate > 512) return Math.floor(candidate);
  } catch {
    // fall through to provider-aware detection
  }
  // No explicit override: use the real context window for the active provider+model
  // instead of a provider-blind 8192 default (which compacted huge-window models
  // ~70x too early).
  try {
    const win = Number(resolveActiveModelContextProfile().contextWindowTokens);
    if (Number.isFinite(win) && win > 512) return Math.floor(win);
  } catch {
    // fall through
  }
  return 8192;
}

function estimateMessageTokens(msg: ChatMessage): number {
  const contentTokens = Math.max(1, Math.ceil(String(msg.content || '').length / 3.5));
  // Per-message framing overhead
  return contentTokens + 6;
}

function estimateHistoryTokens(history: ChatMessage[]): number {
  let total = 0;
  for (const msg of history) total += estimateMessageTokens(msg);
  return total;
}

function getCompactedContextHistoryForTokenEstimate(session: Session): ChatMessage[] {
  const rawMessages = Array.isArray(session.history) ? session.history : [];
  const summary = String(session.latestContextSummary || '').trim();
  if (!summary) return rawMessages;

  const base = Number.isFinite(Number(session.contextStartIndex))
    ? Math.max(0, Math.min(Math.floor(Number(session.contextStartIndex)), rawMessages.length))
    : 0;
  const summaryMsg: ChatMessage = {
    role: 'assistant',
    content: `[Rolling context summary]\n${summary}`,
    timestamp: Number(session.contextSummaryUpdatedAt || Date.now()),
    channel: 'system',
  };
  const since = base < rawMessages.length ? rawMessages.slice(base) : [];
  return [summaryMsg, ...since];
}

function estimateActiveContextTokens(session: Session): number {
  return estimateHistoryTokens(getCompactedContextHistoryForTokenEstimate(session));
}

function activeUsageCalibrationFactor(): number {
  // Scale raw char-based estimates toward what the active provider+model actually
  // counts as input tokens, using recent provider-reported usage. Falls back to
  // 1.0 (no correction) until enough provider samples exist. Clamped inside
  // getUsageCalibration so a noisy ratio can never wildly distort the budget.
  try {
    const profile = resolveActiveModelContextProfile();
    return getUsageCalibration(profile.providerId, profile.model).factor || 1;
  } catch {
    return 1;
  }
}

function resolveSessionPolicy(): {
  maxMessages: number;
  compactionThreshold: number;
  memoryFlushThreshold: number;
  compactionMinMessages: number;
} {
  const defaults = {
    maxMessages: 120,
    compactionThreshold: 0.7,
    memoryFlushThreshold: 0.75,
    compactionMinMessages: 20,
  };
  try {
    const cfg: any = getConfig().getConfig();
    const maxMessagesRaw = Number(cfg?.session?.maxMessages);
    const compactionThresholdRaw = Number(cfg?.session?.compactionThreshold);
    const memoryFlushThresholdRaw = Number(cfg?.session?.memoryFlushThreshold);
    const rollingMessageCountRaw = Number(cfg?.session?.rollingCompactionMessageCount);
    const compactionMinMessagesRaw = Number(cfg?.session?.compactionMinMessages);
    const maxMessages = Number.isFinite(maxMessagesRaw) && maxMessagesRaw >= 20
      ? Math.floor(maxMessagesRaw)
      : defaults.maxMessages;
    const compactionThreshold = Number.isFinite(compactionThresholdRaw) && compactionThresholdRaw >= 0.4 && compactionThresholdRaw <= 0.95
      ? compactionThresholdRaw
      : defaults.compactionThreshold;
    const memoryFlushThreshold = Number.isFinite(memoryFlushThresholdRaw) && memoryFlushThresholdRaw >= 0.5 && memoryFlushThresholdRaw <= 0.98
      ? memoryFlushThresholdRaw
      : defaults.memoryFlushThreshold;
    const fallbackMinMessages = Number.isFinite(rollingMessageCountRaw)
      ? Math.max(2, Math.min(120, Math.floor(rollingMessageCountRaw)))
      : defaults.compactionMinMessages;
    const compactionMinMessages = Number.isFinite(compactionMinMessagesRaw)
      ? Math.max(2, Math.min(120, Math.floor(compactionMinMessagesRaw)))
      : fallbackMinMessages;
    return { maxMessages, compactionThreshold, memoryFlushThreshold, compactionMinMessages };
  } catch {
    return defaults;
  }
}

function isRealContextMessage(msg: ChatMessage): boolean {
  const content = String(msg?.content || '').trim();
  if (!content) return false;
  if (content === PRE_COMPACTION_SUMMARY_PROMPT) return false;
  if (content === PRE_COMPACTION_MEMORY_FLUSH_PROMPT) return false;
  if (/^\[(?:Rolling context summary|Compacted context summary|Active goal progress summary)\]/i.test(content)) return false;
  return msg.role === 'user' || msg.role === 'assistant';
}

function trimHistory(session: Session, maxMessages: number): void {
  // Preserve full raw history for auditability.
  // API-call context is compacted separately via getHistoryForApiCall().
  void session;
  void maxMessages;
}

function appendCompactionArtifacts(
  sessionId: string,
  kind: 'legacy' | 'rolling',
  summaryText: string,
  baseMessageCount: number,
  extra?: Record<string, any>,
): void {
  try {
    const cfg = getConfig();
    const workspacePath = cfg.getWorkspacePath();
    const compactionDir = path.join(workspacePath, 'audit', 'chats', 'compactions');
    fs.mkdirSync(compactionDir, { recursive: true });

    const ts = new Date().toISOString();
    const cleanSummary = scrubPersistedText(String(summaryText || '')).slice(0, 12000);
    const cleanExtra = extra ? scrubPersistedData(extra) : undefined;
    const payload = {
      timestamp: ts,
      sessionId,
      kind,
      baseMessageCount,
      summary: cleanSummary,
      ...(cleanExtra || {}),
    };

    const jsonlPath = path.join(compactionDir, `${sessionId}.jsonl`);
    fs.appendFileSync(jsonlPath, JSON.stringify(payload) + '\n', 'utf-8');

    const mdPath = path.join(compactionDir, `${sessionId}.md`);
    const mdLines = [
      `### [${kind.toUpperCase()}_COMPACTION] ${ts}`,
      `- Base message count: ${baseMessageCount}`,
      ...(cleanExtra ? Object.entries(cleanExtra).map(([k, v]) => `- ${k}: ${String(v)}`) : []),
      '',
      cleanSummary.trim() || '(No summary generated.)',
      '',
    ];
    fs.appendFileSync(mdPath, mdLines.join('\n'), 'utf-8');
  } catch {
    // Compaction artifacts are best-effort only.
  }
}

function appendTranscriptArtifacts(
  sessionId: string,
  msg: ChatMessage,
  opts?: { synthetic?: boolean },
): void {
  try {
    const cfg = getConfig();
    const workspacePath = cfg.getWorkspacePath();
    const transcriptDir = path.join(workspacePath, 'audit', 'chats', 'transcripts');
    fs.mkdirSync(transcriptDir, { recursive: true });

    const ts = Number.isFinite(Number(msg.timestamp)) ? Number(msg.timestamp) : Date.now();
    const iso = new Date(ts).toISOString();
    const cleanContent = scrubPersistedText(msg.content);
    const cleanToolLog = msg.toolLog ? scrubPersistedText(msg.toolLog) : undefined;
    const payload = {
      timestamp: ts,
      timestampIso: iso,
      sessionId,
      role: msg.role,
      channel: msg.channel || undefined,
      channelLabel: msg.channelLabel || undefined,
      origin: msg.origin || undefined,
      toolLog: cleanToolLog,
      synthetic: opts?.synthetic === true,
      content: cleanContent,
    };

    const jsonlPath = path.join(transcriptDir, `${sessionId}.jsonl`);
    fs.appendFileSync(jsonlPath, JSON.stringify(payload) + '\n', 'utf-8');

    const mdPath = path.join(transcriptDir, `${sessionId}.md`);
    const mdLines = [
      `### [${iso}] ${msg.role}${opts?.synthetic ? ' [synthetic]' : ''}`,
      '',
      cleanContent.trim() || '(empty)',
      '',
    ];
    fs.appendFileSync(mdPath, mdLines.join('\n'), 'utf-8');
  } catch {
    // Transcript logging is best-effort only.
  }
}

export function recordSessionCompaction(
  sessionId: string,
  kind: 'legacy' | 'rolling',
  summaryText: string,
  baseMessageCount: number,
  extra?: Record<string, any>,
): void {
  const session = getSession(sessionId);
  const cleanSummary = String(summaryText || '').trim();
  if (!cleanSummary) return;
  session.latestContextSummary = cleanSummary.slice(0, 12000);
  session.contextStartIndex = Math.max(0, Math.floor(Number(baseMessageCount) || 0));
  session.contextSummaryUpdatedAt = Date.now();
  appendCompactionArtifacts(sessionId, kind, session.latestContextSummary, session.contextStartIndex, extra);
  saveSession(sessionId);
}

export function getMainChatGoal(sessionId: string): MainChatGoalState | null {
  return getSession(sessionId).mainChatGoal || null;
}

export function setMainChatGoal(sessionId: string, goal: MainChatGoalState | null): MainChatGoalState | null {
  const session = getSession(sessionId);
  session.mainChatGoal = goal ? normalizeMainChatGoal({ ...goal, sessionId }, sessionId) : null;
  session.lastActiveAt = Date.now();
  saveSession(sessionId);
  return session.mainChatGoal || null;
}

export function updateMainChatGoal(
  sessionId: string,
  updater: (goal: MainChatGoalState | null, session: Session) => MainChatGoalState | null,
): MainChatGoalState | null {
  const session = getSession(sessionId);
  const next = updater(session.mainChatGoal || null, session);
  session.mainChatGoal = next ? normalizeMainChatGoal({ ...next, sessionId }, sessionId) : null;
  session.lastActiveAt = Date.now();
  saveSession(sessionId);
  return session.mainChatGoal || null;
}

export function archiveMainChatGoal(sessionId: string, goal: MainChatGoalState | null | undefined): void {
  if (!goal) return;
  const session = getSession(sessionId);
  const normalized = normalizeMainChatGoal(goal, sessionId);
  if (!normalized) return;
  const history = Array.isArray(session.mainChatGoalHistory) ? session.mainChatGoalHistory : [];
  const filtered = history.filter((item) => item.id !== normalized.id);
  filtered.push({ ...normalized, updatedAt: Date.now() });
  session.mainChatGoalHistory = filtered.slice(-200);
  saveSession(sessionId);
}

export function listMainChatGoalRecords(): Array<MainChatGoalState & {
  current: boolean;
  sessionTitle: string;
  sessionLastActiveAt: number;
}> {
  const summaries = listSessionSummaries();
  const out: Array<MainChatGoalState & { current: boolean; sessionTitle: string; sessionLastActiveAt: number }> = [];
  const globalSeen = new Set<string>();
  const pushGoalForSummary = (summary: SessionSummary, goal: MainChatGoalState | null | undefined, current: boolean) => {
    const normalized = normalizeMainChatGoal(goal, summary.id);
    if (!normalized || globalSeen.has(normalized.id)) return;
    globalSeen.add(normalized.id);
    out.push({
      ...normalized,
      current,
      sessionTitle: summary.title,
      sessionLastActiveAt: summary.lastActiveAt,
    });
  };

  for (const summary of summaries) {
    pushGoalForSummary(summary, summary.mainChatGoal, true);
  }

  // Historical goals are useful context, but loading every session file can
  // stall the Hub on long-lived installs. Scan the recent sessions only.
  for (const summary of summaries.slice(0, 250)) {
    const session = readSessionFileForSearch(summary.id);
    if (!session) continue;
    pushGoalForSummary(summary, session.mainChatGoal, true);
    for (const goal of session.mainChatGoalHistory || []) {
      pushGoalForSummary(summary, goal, false);
    }
  }
  return out.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
}

/**
 * Replaces session history with a single summary message after rolling compaction.
 * This is the critical step that actually resets the message count so compaction
 * doesn't re-trigger on the very next turn.
 */
export function applyRollingCompactionToHistory(
  sessionId: string,
  summaryText: string,
  summaryPrefix: string,
): void {
  const session = getSession(sessionId);
  const cleanSummary = String(summaryText || '').trim();
  if (!cleanSummary) return;
  const summaryMsg: ChatMessage = {
    role: 'assistant',
    content: `${summaryPrefix}\n${cleanSummary}`,
    timestamp: Date.now(),
  };
  session.history = [summaryMsg];
  session.contextTokenEstimate = estimateActiveContextTokens(session);
  saveSession(sessionId);
}

function compactHistoryWithSummary(sessionId: string, session: Session, summaryText: string, maxMessages: number): boolean {
  const promptIndex = session.history
    .map((m, i) => ({ m, i }))
    .reverse()
    .find((x) => x.m.role === 'user' && x.m.content === PRE_COMPACTION_SUMMARY_PROMPT)?.i ?? -1;
  if (promptIndex <= 0) return false;

  const beforePromptCount = promptIndex;
  const cleanSummary = String(summaryText || '').trim();
  if (cleanSummary) {
    recordSessionCompaction(sessionId, 'legacy', cleanSummary, beforePromptCount, {
      strategy: 'pre_compaction_prompt',
      maxMessages,
    });
  }

  // Persist compaction summary to intraday notes so restart does not lose condensed context.
  try {
    const { getConfig: _getCfg } = require('../config/config');
    const _workspacePath = _getCfg().getWorkspacePath();
    const _today = new Date().toISOString().slice(0, 10);
    const _notesPath = require('path').join(_workspacePath, 'memory', `${_today}-intraday-notes.md`);
    const _fs = require('fs');
    _fs.mkdirSync(require('path').dirname(_notesPath), { recursive: true });
    const _ts = new Date().toISOString();
    const _cleanSummary = scrubPersistedText(String(summaryText || '')).slice(0, 600);
    _fs.appendFileSync(_notesPath, `### [COMPACTION_SUMMARY] ${_ts}\n${_cleanSummary}\n\n`, 'utf-8');
  } catch {
    // Memory persistence must not break chat flow.
  }

  // Keep raw user/assistant messages intact, but strip internal compaction prompt
  // and its assistant summary response from persisted history.
  // This preserves real thread data while removing synthetic control turns.
  const removeCount = Math.min(2, Math.max(0, session.history.length - promptIndex));
  if (removeCount > 0) {
    session.history.splice(promptIndex, removeCount);
  }
  trimHistory(session, maxMessages);
  return true;
}

function normalizeCanvasProjectLink(input: any): CanvasProjectLink | null {
  if (!input || typeof input !== 'object') return null;
  const rootPath = typeof input.rootPath === 'string' && input.rootPath.trim()
    ? input.rootPath.trim()
    : null;
  const github = input.github && typeof input.github === 'object'
    ? {
        repoFullName: typeof input.github.repoFullName === 'string' && input.github.repoFullName.trim() ? input.github.repoFullName.trim() : null,
        remoteUrl: typeof input.github.remoteUrl === 'string' && input.github.remoteUrl.trim() ? input.github.remoteUrl.trim() : null,
        branch: typeof input.github.branch === 'string' && input.github.branch.trim() ? input.github.branch.trim() : null,
        defaultBranch: typeof input.github.defaultBranch === 'string' && input.github.defaultBranch.trim() ? input.github.defaultBranch.trim() : null,
      }
    : null;
  const vercel = input.vercel && typeof input.vercel === 'object'
    ? {
        projectId: typeof input.vercel.projectId === 'string' && input.vercel.projectId.trim() ? input.vercel.projectId.trim() : null,
        projectName: typeof input.vercel.projectName === 'string' && input.vercel.projectName.trim() ? input.vercel.projectName.trim() : null,
        teamId: typeof input.vercel.teamId === 'string' && input.vercel.teamId.trim() ? input.vercel.teamId.trim() : null,
        orgId: typeof input.vercel.orgId === 'string' && input.vercel.orgId.trim() ? input.vercel.orgId.trim() : null,
        deploymentUrl: typeof input.vercel.deploymentUrl === 'string' && input.vercel.deploymentUrl.trim() ? input.vercel.deploymentUrl.trim() : null,
        dashboardUrl: typeof input.vercel.dashboardUrl === 'string' && input.vercel.dashboardUrl.trim() ? input.vercel.dashboardUrl.trim() : null,
      }
    : null;
  return { rootPath, github, vercel };
}

export interface AddMessageOptions {
  deferOnMemoryFlush?: boolean;
  deferOnCompaction?: boolean;
  disableMemoryFlushCheck?: boolean;
  disableCompactionCheck?: boolean;
  disableAutoSave?: boolean;
  maxMessages?: number;
}

export interface AddMessageResult {
  added: boolean;
  compactionInjected: boolean;
  deferredForCompaction: boolean;
  compactionPrompt?: string;
  compactionApplied?: boolean;
  memoryFlushInjected: boolean;
  deferredForMemoryFlush: boolean;
  memoryFlushPrompt?: string;
  estimatedTokens: number;
  contextLimitTokens: number;
  thresholdTokens: number;
}

export function getSession(id: string): Session {
  if (sessions.has(id)) {
    return sessions.get(id)!;
  }

  ensureSessionDir();
  const filePath = getSessionPath(id);

  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const session: Session = {
        id: data.id || id,
        history: Array.isArray(data.history) ? data.history : [],
        workspace: data.workspace || getConfig().getWorkspacePath(),
        title: typeof data.title === 'string' ? data.title : undefined,
        autoTitleLocked: data.autoTitleLocked === true,
        channel: data.channel || inferChannelFromSessionId(id),
        createdAt: data.createdAt || Date.now(),
        lastActiveAt: data.lastActiveAt || Date.now(),
        lastAssistantAt: Number.isFinite(Number(data.lastAssistantAt)) ? Number(data.lastAssistantAt) : undefined,
        mobileLastReadAt: Number.isFinite(Number(data.mobileLastReadAt)) ? Number(data.mobileLastReadAt) : undefined,
        pendingMemoryFlush: data.pendingMemoryFlush === true,
        pendingCompaction: data.pendingCompaction === true,
        contextTokenEstimate: Number.isFinite(Number(data.contextTokenEstimate))
          ? Number(data.contextTokenEstimate)
          : undefined,
        latestContextSummary: typeof data.latestContextSummary === 'string'
          ? data.latestContextSummary
          : undefined,
        contextStartIndex: Number.isFinite(Number(data.contextStartIndex))
          ? Math.max(0, Math.floor(Number(data.contextStartIndex)))
          : undefined,
        contextSummaryUpdatedAt: Number.isFinite(Number(data.contextSummaryUpdatedAt))
          ? Number(data.contextSummaryUpdatedAt)
          : undefined,
        activatedToolCategories: Array.isArray(data.activatedToolCategories) ? data.activatedToolCategories : [],
        activatedSkillIds: Array.isArray(data.activatedSkillIds) ? data.activatedSkillIds : [],
        businessContextEnabled: data.businessContextEnabled === true,
        creativeMode: normalizeCreativeMode(data.creativeMode),
        creativeReferences: normalizeCreativeReferences(data.creativeReferences),
        canvasProjectRoot: typeof data.canvasProjectRoot === 'string' && data.canvasProjectRoot.trim()
          ? data.canvasProjectRoot
          : null,
        canvasProjectLabel: typeof data.canvasProjectLabel === 'string' && data.canvasProjectLabel.trim()
          ? data.canvasProjectLabel
          : null,
        canvasProjectLink: normalizeCanvasProjectLink(data.canvasProjectLink),
        mainChatGoal: normalizeMainChatGoal(data.mainChatGoal, id),
        mainChatGoalHistory: normalizeMainChatGoalHistory(data.mainChatGoalHistory, id),
      };
      sessions.set(id, session);
      return session;
    } catch {
      // Corrupted file, create new session
    }
  }

  const session: Session = {
    id,
    history: [],
    workspace: getConfig().getWorkspacePath(),
    title: undefined,
    autoTitleLocked: false,
    channel: inferChannelFromSessionId(id),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    lastAssistantAt: undefined,
    mobileLastReadAt: undefined,
    pendingMemoryFlush: false,
    pendingCompaction: false,
    contextTokenEstimate: 0,
    latestContextSummary: undefined,
    contextStartIndex: 0,
    contextSummaryUpdatedAt: undefined,
    activatedToolCategories: [],
    activatedSkillIds: [],
    businessContextEnabled: false,
    creativeMode: null,
    creativeReferences: [],
    canvasProjectRoot: null,
    canvasProjectLabel: null,
    canvasProjectLink: null,
    mainChatGoal: null,
    mainChatGoalHistory: [],
  };
  sessions.set(id, session);
  saveSession(id);
  return session;
}

export function getSessionsByChannel(channel: Session['channel']): Session[] {
  const result: Session[] = [];
  
  // Get all sessions from disk
  if (!fs.existsSync(SESSION_DIR)) {
    return result;
  }
  
  const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const sessionId = file.slice(0, -5); // remove .json
    try {
      const session = getSession(sessionId);
      if (session.channel === channel) {
        result.push(session);
      }
    } catch {
      // Skip corrupted sessions
    }
  }
  
  return result;
}

export function addMessage(id: string, msg: ChatMessage, options: AddMessageOptions = {}): AddMessageResult {
  const session = getSession(id);
  const sessionPolicy = resolveSessionPolicy();
  const maxMessages = Number.isFinite(Number(options.maxMessages)) && Number(options.maxMessages) >= 10
    ? Math.floor(Number(options.maxMessages))
    : sessionPolicy.maxMessages;
  const contextLimitTokens = resolveNumCtx();
  const thresholdTokens = Math.floor(contextLimitTokens * sessionPolicy.memoryFlushThreshold);
  const compactionThresholdTokens = Math.floor(contextLimitTokens * sessionPolicy.compactionThreshold);
  // Correct raw estimates toward real provider input-token counts before
  // comparing against the (now provider-aware) window thresholds.
  const usageCalibrationFactor = activeUsageCalibrationFactor();
  const beforeTokens = Math.round(estimateActiveContextTokens(session) * usageCalibrationFactor);
  let compactionInjected = false;
  let deferredForCompaction = false;
  let compactionApplied = false;
  let memoryFlushInjected = false;
  let deferredForMemoryFlush = false;

  if (
    msg.role === 'user'
    && !options.disableCompactionCheck
    && !session.pendingCompaction
  ) {
    const projectedTokens = beforeTokens + Math.round(estimateMessageTokens(msg) * usageCalibrationFactor);
    const realMessageCount = session.history.filter(isRealContextMessage).length + 1;
    const recentlyCompacted = session.history
      .slice(-8)
      .some((h) => h.role === 'user' && h.content === PRE_COMPACTION_SUMMARY_PROMPT);
    const shouldCompact = realMessageCount >= sessionPolicy.compactionMinMessages
      && projectedTokens >= compactionThresholdTokens
      && !recentlyCompacted;
    if (shouldCompact) {
      const injectedMsg: ChatMessage = {
        role: 'user',
        content: PRE_COMPACTION_SUMMARY_PROMPT,
        timestamp: Math.max(0, msg.timestamp - 1),
      };
      session.history.push(injectedMsg);
      appendTranscriptArtifacts(id, injectedMsg, { synthetic: true });
      session.pendingCompaction = true;
      compactionInjected = true;
      deferredForCompaction = options.deferOnCompaction === true;
    }
  }

  if (
    !deferredForCompaction
    && msg.role === 'user'
    && !options.disableMemoryFlushCheck
    && !session.pendingMemoryFlush
  ) {
    const projectedTokens = beforeTokens + Math.round(estimateMessageTokens(msg) * usageCalibrationFactor);
    const realMessageCount = session.history.filter(isRealContextMessage).length + 1;
    const recentlyPrompted = session.history
      .slice(-6)
      .some((h) => h.role === 'user' && h.content === PRE_COMPACTION_MEMORY_FLUSH_PROMPT);
    const shouldInject = realMessageCount >= sessionPolicy.compactionMinMessages
      && projectedTokens >= thresholdTokens
      && !recentlyPrompted;
    if (shouldInject) {
      const injectedMsg: ChatMessage = {
        role: 'user',
        content: PRE_COMPACTION_MEMORY_FLUSH_PROMPT,
        timestamp: Math.max(0, msg.timestamp - 1),
      };
      session.history.push(injectedMsg);
      appendTranscriptArtifacts(id, injectedMsg, { synthetic: true });
      session.pendingMemoryFlush = true;
      memoryFlushInjected = true;
      deferredForMemoryFlush = options.deferOnMemoryFlush === true;
    }
  }

  const storedMsg: ChatMessage = {
    ...msg,
    content: msg.role === 'assistant'
      ? stripInternalToolNotes(msg.content) || '[Internal tool observation omitted.]'
      : msg.content,
  };

  if (!deferredForCompaction && !deferredForMemoryFlush) {
    session.history.push(storedMsg);
    if (storedMsg.role === 'assistant') {
      const assistantAt = Number(storedMsg.timestamp || Date.now());
      session.lastAssistantAt = Number.isFinite(assistantAt) && assistantAt > 0 ? assistantAt : Date.now();
    }
    appendTranscriptArtifacts(id, storedMsg, { synthetic: false });
  }

  if (storedMsg.role === 'assistant' && session.pendingCompaction) {
    compactionApplied = compactHistoryWithSummary(id, session, storedMsg.content, maxMessages);
    session.pendingCompaction = false;
  }

  if (storedMsg.role === 'assistant' && session.pendingMemoryFlush) {
    session.pendingMemoryFlush = false;
  }

  trimHistory(session, maxMessages);
  session.contextTokenEstimate = estimateActiveContextTokens(session);
  session.lastActiveAt = Date.now();
  if (!options.disableAutoSave) {
    saveSession(id);
  }

  return {
    added: !deferredForCompaction && !deferredForMemoryFlush,
    compactionInjected,
    deferredForCompaction,
    compactionPrompt: compactionInjected ? PRE_COMPACTION_SUMMARY_PROMPT : undefined,
    compactionApplied,
    memoryFlushInjected,
    deferredForMemoryFlush,
    memoryFlushPrompt: memoryFlushInjected ? PRE_COMPACTION_MEMORY_FLUSH_PROMPT : undefined,
    estimatedTokens: session.contextTokenEstimate,
    contextLimitTokens,
    thresholdTokens,
  };
}

export function getHistory(id: string, maxTurns: number = 10): ChatMessage[] {
  const session = getSession(id);
  // Return last N messages (2 messages per turn = user + assistant)
  const maxMessages = maxTurns * 2;
  return session.history.slice(-maxMessages);
}

function buildActiveGoalSummaryMessage(session: Session): ChatMessage | null {
  const goal = session.mainChatGoal && ['active', 'paused', 'blocked'].includes(session.mainChatGoal.status)
    ? session.mainChatGoal
    : null;
  const progress = String(goal?.progressSummary || '').trim();
  if (!goal || !progress) return null;
  return {
    role: 'assistant',
    content: [
      '[Active goal progress summary]',
      `Goal: ${goal.goal}`,
      `Status: ${goal.status}`,
      `Turns used: ${goal.turnsUsed}`,
      goal.lastReason ? `Last reason: ${goal.lastReason}` : '',
      '',
      progress,
    ].filter(Boolean).join('\n'),
    timestamp: Number(goal.lastSummaryAt || goal.updatedAt || Date.now()),
    channel: 'system',
  };
}

export function getHistoryForApiCall(
  id: string,
  maxTurns: number = 60,
  options?: { maxMessages?: number },
): ChatMessage[] {
  const session = getSession(id);
  const maxMessages = Number.isFinite(Number(options?.maxMessages))
    ? Math.max(1, Math.floor(Number(options?.maxMessages)))
    : maxTurns * 2;
  const rawMessages = Array.isArray(session.history) ? session.history : [];

  let messages: ChatMessage[];
  const summary = String(session.latestContextSummary || '').trim();
  const base = Number.isFinite(Number(session.contextStartIndex))
    ? Math.max(0, Math.floor(Number(session.contextStartIndex)))
    : 0;

  const goalSummaryMsg = buildActiveGoalSummaryMessage(session);

  if (summary) {
    const summaryMsg: ChatMessage = {
      role: 'assistant',
      content: `[Rolling context summary]\n${summary}`,
      timestamp: Number(session.contextSummaryUpdatedAt || Date.now()),
      channel: 'system',
    };
    const since = base < rawMessages.length ? rawMessages.slice(base) : [];
    messages = goalSummaryMsg ? [summaryMsg, goalSummaryMsg, ...since] : [summaryMsg, ...since];
    if (messages.length > maxMessages) {
      const preserved = goalSummaryMsg ? [summaryMsg, goalSummaryMsg] : [summaryMsg];
      messages = [...preserved, ...since.slice(-maxMessages)];
    }
  } else {
    messages = goalSummaryMsg
      ? [goalSummaryMsg, ...rawMessages.slice(-(maxMessages - 1))]
      : rawMessages.slice(-maxMessages);
  }

  return messages.map((msg) => {
    const cleaned = msg.role === 'assistant'
      ? stripInternalToolNotes(msg.content)
      : String(msg.content || '');
    const content = cleaned || (/\[tool-note:[^\]]+\]/i.test(String(msg.content || '')) ? '' : String(msg.content || ''));
    if (!content.trim()) return null;
    return { ...msg, content };
  }).filter((msg): msg is ChatMessage => !!msg);
}

/**
 * Builds a [RECENT_TOOL_LOG] block from full toolLog fields stored on the
 * last `lookbackTurns` assistant messages. Returns empty string if no tool
 * log data exists. If maxChars is omitted, no application-level cap is applied.
 *
 * Populated by chat.router after each turn completes via persistToolLog().
 */
export function getRecentToolLog(
  id: string,
  lookbackTurns: number = 5,
  maxChars?: number,
): string {
  const session = getSession(id);
  const recentAssistant = session.history
    .filter((m) => m.role === 'assistant' && m.toolLog)
    .slice(-lookbackTurns);

  if (recentAssistant.length === 0) return '';

  const lines: string[] = [];
  for (const msg of recentAssistant) {
    const log = String(msg.toolLog || '').trim();
    if (log) lines.push(log);
  }

  if (lines.length === 0) return '';

  const block = `[RECENT_TOOL_LOG]\n${lines.join('\n')}`;
  if (!Number.isFinite(Number(maxChars)) || Number(maxChars) <= 0) return block;
  return block.length <= Number(maxChars) ? block : block.slice(0, Number(maxChars)) + '\n[...truncated]';
}

export function getRecentToolObservationsForContext(
  id: string,
  lookbackTurns: number = 5,
  maxChars?: number,
): string {
  const observations = readRecentToolObservationsForContext(id, {
    lookbackTurns,
    maxChars,
    includeHeader: true,
  });
  if (observations) return observations;
  const legacy = getRecentToolLog(id, lookbackTurns, maxChars);
  return legacy ? legacy.replace(/^\[RECENT_TOOL_LOG\]/, '[RECENT_TOOL_OBSERVATIONS]\nlegacy_format: true') : '';
}

/**
 * Persists a full tool log string onto the most recent assistant message
 * in session history. Called by chat.router after allToolResults are finalized.
 */
export function persistToolLog(id: string, toolLog: string): void {
  const session = getSession(id);
  for (let i = session.history.length - 1; i >= 0; i--) {
    if (session.history[i].role === 'assistant') {
      session.history[i].toolLog = toolLog;
      saveSession(id);
      return;
    }
  }
}

export function clearHistory(id: string): void {
  const session = getSession(id);
  session.history = [];
  session.pendingCompaction = false;
  session.pendingMemoryFlush = false;
  session.contextTokenEstimate = 0;
  session.latestContextSummary = undefined;
  session.contextStartIndex = 0;
  session.contextSummaryUpdatedAt = undefined;
  session.lastActiveAt = Date.now();
  saveSession(id);
}

export function replaceHistory(
  id: string,
  history: ChatMessage[],
  options: { resetCompaction?: boolean } = {},
): void {
  const session = getSession(id);
  const previousSummary = session.latestContextSummary;
  const previousContextStartIndex = Number.isFinite(Number(session.contextStartIndex))
    ? Math.max(0, Math.floor(Number(session.contextStartIndex)))
    : 0;
  const previousSummaryUpdatedAt = session.contextSummaryUpdatedAt;
  session.history = (Array.isArray(history) ? history : [])
    .map((msg: any) => {
      const role = msg?.role === 'assistant' || msg?.role === 'ai' ? 'assistant' : 'user';
      return {
        ...msg,
        role,
        content: String(msg?.content || ''),
        timestamp: Number.isFinite(Number(msg?.timestamp)) ? Number(msg.timestamp) : Date.now(),
      } as ChatMessage;
    })
    .filter((msg) => msg.content.trim().length > 0);
  session.pendingCompaction = false;
  session.pendingMemoryFlush = false;
  const shouldPreserveCompaction = options.resetCompaction !== true
    && !!String(previousSummary || '').trim()
    && previousContextStartIndex > 0
    && session.history.length >= previousContextStartIndex;
  if (shouldPreserveCompaction) {
    session.latestContextSummary = previousSummary;
    session.contextStartIndex = previousContextStartIndex;
    session.contextSummaryUpdatedAt = previousSummaryUpdatedAt;
  } else {
    session.latestContextSummary = undefined;
    session.contextStartIndex = 0;
    session.contextSummaryUpdatedAt = undefined;
  }
  session.contextTokenEstimate = estimateActiveContextTokens(session);
  session.lastActiveAt = Date.now();
  saveSession(id);
}

export function getCreativeMode(id: string): CreativeMode | null {
  const session = getSession(id);
  return session.creativeMode || null;
}

export function getCreativeReferences(id: string): CreativeReferenceRecord[] {
  const session = getSession(id);
  const normalized = normalizeCreativeReferences(session.creativeReferences);
  if (normalized.length !== (session.creativeReferences || []).length) {
    session.creativeReferences = normalized;
    saveSession(id);
  }
  return normalized;
}

export function addCreativeReferences(id: string, references: Array<Partial<CreativeReferenceRecord>>): CreativeReferenceRecord[] {
  const session = getSession(id);
  const existing = normalizeCreativeReferences(session.creativeReferences);
  const now = new Date().toISOString();
  const next = [...existing];
  for (const raw of references || []) {
    const normalized = normalizeCreativeReferenceRecord({
      ...raw,
      updatedAt: now,
      createdAt: raw?.createdAt || now,
    });
    if (!normalized) continue;
    const duplicateIndex = next.findIndex((item) =>
      (!!normalized.path && item.path === normalized.path)
      || (!!normalized.absPath && item.absPath === normalized.absPath)
      || (!!normalized.sourceUrl && item.sourceUrl === normalized.sourceUrl && item.kind === normalized.kind && item.sourceTweetId === normalized.sourceTweetId));
    if (duplicateIndex >= 0) {
      next[duplicateIndex] = {
        ...next[duplicateIndex],
        ...normalized,
        id: next[duplicateIndex].id,
        createdAt: next[duplicateIndex].createdAt || normalized.createdAt,
        selectedFrames: Array.from(new Set([
          ...(next[duplicateIndex].selectedFrames || []),
          ...(normalized.selectedFrames || []),
        ])).slice(0, 16),
        analysis: normalized.analysis || next[duplicateIndex].analysis || null,
        transcript: normalized.transcript || next[duplicateIndex].transcript || null,
        updatedAt: now,
      };
    } else {
      next.unshift(normalized);
    }
  }
  session.creativeReferences = next.slice(0, 120);
  session.lastActiveAt = Date.now();
  saveSession(id);
  return session.creativeReferences;
}

export function clearCreativeReferences(id: string): void {
  const session = getSession(id);
  session.creativeReferences = [];
  session.lastActiveAt = Date.now();
  saveSession(id);
}

export function formatCreativeReferencesForPrompt(id: string, limit: number = 12): string {
  const refs = getCreativeReferences(id).slice(0, Math.max(1, Math.min(40, Math.floor(limit))));
  if (!refs.length) return '';
  const lines = refs.map((ref, index) => {
    const frameText = ref.selectedFrames.length > 0
      ? ` frames=[${ref.selectedFrames.slice(0, 8).join(', ')}]`
      : '';
    const analysisText = ref.analysis
      ? `\n  notes: ${ref.analysis.replace(/\s+/g, ' ').slice(0, 420)}`
      : '';
    return `${index + 1}. ${ref.kind} authority=${ref.authority} intent=${ref.intent} path=${ref.path || ref.absPath || '(no local path)'}${frameText}\n  source=${ref.sourceTweetLink || ref.sourceUrl || 'unknown'}${analysisText}`;
  });
  return [
    '[CREATIVE_REFERENCES]',
    `This session has ${getCreativeReferences(id).length} saved creative reference item(s) from fetched/downloaded media.`,
    'When Creative mode is active, treat these as visual style, pacing, composition, UI, and audio references. Use the listed image paths and selected frame paths as actual media evidence; inspect them again with analyze_image/analyze_video or reference-aware creative tools before final direction decisions.',
    ...lines,
  ].join('\n');
}

export function setCreativeMode(id: string, mode: CreativeMode | null): CreativeMode | null {
  const session = getSession(id);
  session.creativeMode = normalizeCreativeMode(mode);
  session.lastActiveAt = Date.now();
  saveSession(id);
  return session.creativeMode || null;
}

export function getCanvasProjectRoot(id: string): string | null {
  const session = getSession(id);
  return typeof session.canvasProjectRoot === 'string' && session.canvasProjectRoot.trim()
    ? session.canvasProjectRoot
    : null;
}

export function getCanvasProjectLabel(id: string): string | null {
  const session = getSession(id);
  return typeof session.canvasProjectLabel === 'string' && session.canvasProjectLabel.trim()
    ? session.canvasProjectLabel
    : null;
}

export function getCanvasProjectLink(id: string): CanvasProjectLink | null {
  const session = getSession(id);
  return normalizeCanvasProjectLink(session.canvasProjectLink);
}

export function setCanvasProject(id: string, rootPath: string | null, label?: string | null): { rootPath: string | null; label: string | null } {
  const session = getSession(id);
  const prevRoot = typeof session.canvasProjectRoot === 'string' && session.canvasProjectRoot.trim()
    ? session.canvasProjectRoot.trim()
    : null;
  session.canvasProjectRoot = typeof rootPath === 'string' && rootPath.trim() ? rootPath.trim() : null;
  session.canvasProjectLabel = typeof label === 'string' && label.trim()
    ? label.trim()
    : (session.canvasProjectRoot ? path.basename(session.canvasProjectRoot) : null);
  if (session.canvasProjectRoot !== prevRoot) {
    session.canvasProjectLink = session.canvasProjectRoot
      ? { rootPath: session.canvasProjectRoot, github: null, vercel: null }
      : null;
  }
  session.lastActiveAt = Date.now();
  saveSession(id);
  return {
    rootPath: session.canvasProjectRoot || null,
    label: session.canvasProjectLabel || null,
  };
}

export function setCanvasProjectLink(id: string, nextLink: CanvasProjectLink | null): CanvasProjectLink | null {
  const session = getSession(id);
  const normalized = normalizeCanvasProjectLink(nextLink);
  session.canvasProjectLink = normalized;
  session.lastActiveAt = Date.now();
  saveSession(id);
  return normalizeCanvasProjectLink(session.canvasProjectLink);
}

export function markSessionReadForMobile(id: string, readAt: number = Date.now()): SessionSummary | null {
  const sessionId = String(id || '').trim();
  if (!sessionId) return null;
  const session = getSession(sessionId);
  const timestamp = Number.isFinite(Number(readAt)) ? Number(readAt) : Date.now();
  session.mobileLastReadAt = Math.max(Number(session.mobileLastReadAt || 0) || 0, timestamp);
  saveSession(sessionId);
  return buildSessionSummary(session);
}


export function deleteSession(id: string): boolean {
  const sessionId = String(id || '').trim();
  if (!sessionId) return false;
  sessions.delete(sessionId);
  const existing = sessionSaveTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
    sessionSaveTimers.delete(sessionId);
  }
  const filePath = getSessionPath(sessionId);
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    removeSessionSummary(sessionId);
    return true;
  } catch {
    return false;
  }
}

export function renameSession(id: string, title: string): SessionSummary | null {
  const sessionId = String(id || '').trim();
  const nextTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!sessionId || !nextTitle) return null;
  const session = getSession(sessionId);
  session.title = nextTitle;
  session.autoTitleLocked = true;
  session.lastActiveAt = Date.now();
  flushSession(sessionId);
  return buildSessionSummary(session);
}

export function autoNameSession(id: string, title: string): SessionSummary | null {
  const sessionId = String(id || '').trim();
  const nextTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!sessionId || !nextTitle) return null;
  const session = getSession(sessionId);
  if (session.autoTitleLocked === true) return null;
  session.title = nextTitle;
  session.autoTitleLocked = true;
  session.lastActiveAt = Date.now();
  flushSession(sessionId);
  return buildSessionSummary(session);
}

export function cleanupSessions(nowMs: number = Date.now()): { deleted: number; scanned: number } {
  ensureSessionDir();
  let deleted = 0;
  let scanned = 0;
  try {
    const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.json') && f !== '_index.json');
    for (const file of files) {
      scanned++;
      const id = file.replace(/\.json$/i, '');
      if (!AUTO_SESSION_ID_RE.test(id)) continue;
      const filePath = path.join(SESSION_DIR, file);
      let st: fs.Stats;
      try {
        st = fs.statSync(filePath);
      } catch {
        continue;
      }
      const ageMs = nowMs - Number(st.mtimeMs || 0);
      if (ageMs < SESSION_CLEANUP_MAX_AGE_MS) continue;
      try {
        fs.unlinkSync(filePath);
        sessions.delete(id);
        removeSessionSummary(id);
        deleted++;
      } catch {
        // ignore unlink failures; next startup can retry
      }
    }
  } catch {
    return { deleted: 0, scanned: 0 };
  }
  return { deleted, scanned };
}

function scrubSession(session: Session): Session {
  return {
    ...session,
    latestContextSummary: session.latestContextSummary
      ? scrubPersistedText(session.latestContextSummary)
      : session.latestContextSummary,
    mainChatGoal: scrubMainChatGoal(session.mainChatGoal),
    mainChatGoalHistory: Array.isArray(session.mainChatGoalHistory)
      ? session.mainChatGoalHistory.map((goal) => scrubMainChatGoal(goal)).filter(Boolean) as MainChatGoalState[]
      : session.mainChatGoalHistory,
    history: session.history.map(msg => ({
      ...msg,
      content: scrubPersistedText(msg.content),
      toolLog: msg.toolLog ? scrubPersistedText(msg.toolLog) : msg.toolLog,
      processEntries: Array.isArray(msg.processEntries)
        ? msg.processEntries.map((entry) => ({
            ...entry,
            content: entry?.content ? scrubPersistedText(String(entry.content)) : entry?.content,
          }))
        : msg.processEntries,
    })),
  };
}

function saveSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;

  const existing = sessionSaveTimers.get(id);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    sessionSaveTimers.delete(id);
    const latest = sessions.get(id);
    if (!latest) return;
    latest.lastAssistantAt = getLastAssistantTimestamp(latest.history);
    applyAutoSessionTitleOnce(latest);
    ensureSessionDir();
    try {
      fs.writeFileSync(getSessionPath(id), JSON.stringify(scrubSession(latest), null, 2));
      upsertSessionSummary(latest);
    } catch (err) {
      console.warn(`[session] Failed to save session ${id}:`, err);
    }
  }, SESSION_SAVE_DEBOUNCE_MS);
  if (typeof (timer as any).unref === 'function') {
    (timer as any).unref();
  }
  sessionSaveTimers.set(id, timer);
}

export function flushSession(id: string): void {
  const existing = sessionSaveTimers.get(id);
  if (existing) {
    clearTimeout(existing);
    sessionSaveTimers.delete(id);
  }
  const session = sessions.get(id);
  if (!session) return;
  session.lastAssistantAt = getLastAssistantTimestamp(session.history);
  applyAutoSessionTitleOnce(session);
  ensureSessionDir();
  try {
    fs.writeFileSync(getSessionPath(id), JSON.stringify(scrubSession(session), null, 2));
    upsertSessionSummary(session);
  } catch (err) {
    console.warn(`[session] Failed to flush session ${id}:`, err);
  }
}

export function getWorkspace(id: string): string {
  return getSession(id).workspace;
}

export function setWorkspace(id: string, workspacePath: string): void {
  const session = getSession(id);
  session.workspace = workspacePath;
  session.lastActiveAt = Date.now();
  saveSession(id);
}

function normalizeScopePath(input: string): string {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

export function setSessionMutationScope(id: string, scope: SessionMutationScope | null): void {
  if (!scope) {
    sessionMutationScopes.delete(id);
    return;
  }
  const allowedFiles = Array.from(new Set((scope.allowedFiles || []).map(normalizeScopePath).filter(Boolean)));
  const allowedDirs = Array.from(new Set((scope.allowedDirs || []).map(normalizeScopePath).filter(Boolean)));
  sessionMutationScopes.set(id, { allowedFiles, allowedDirs });
}

export function clearSessionMutationScope(id: string): void {
  sessionMutationScopes.delete(id);
}

export function getSessionMutationScope(id: string): SessionMutationScope | null {
  return sessionMutationScopes.get(id) || null;
}

export function activateToolCategory(id: string, category: string): void {
  const session = getSession(id);
  if (!session.activatedToolCategories) session.activatedToolCategories = [];
  if (!session.activatedToolCategories.includes(category)) {
    session.activatedToolCategories.push(category);
    saveSession(id);
  }
}

export function setActivatedToolCategories(id: string, categories: string[]): void {
  const session = getSession(id);
  const next = Array.from(new Set(
    (categories || [])
      .map((category) => String(category || '').trim())
      .filter(Boolean),
  ));
  session.activatedToolCategories = next;
  saveSession(id);
}

export function getActivatedToolCategories(id: string): Set<string> {
  const session = getSession(id);
  return new Set(session.activatedToolCategories || []);
}

function normalizeSessionSkillId(input: string): string {
  return String(input || '').trim();
}

export function activateSkillForSession(id: string, skillId: string): void {
  const normalized = normalizeSessionSkillId(skillId);
  if (!normalized) return;
  const session = getSession(id);
  if (!session.activatedSkillIds) session.activatedSkillIds = [];
  if (!session.activatedSkillIds.includes(normalized)) {
    session.activatedSkillIds.push(normalized);
    saveSession(id);
  }
}

export function setActivatedSkillIds(id: string, skillIds: string[]): void {
  const session = getSession(id);
  const next = Array.from(new Set(
    (skillIds || [])
      .map(normalizeSessionSkillId)
      .filter(Boolean),
  ));
  session.activatedSkillIds = next;
  saveSession(id);
}

export function getActivatedSkillIds(id: string): Set<string> {
  const session = getSession(id);
  return new Set(session.activatedSkillIds || []);
}

export function activateSkillResourceForSession(sessionId: string, skillId: string, resourcePath: string): void {
  const nSkill = normalizeSessionSkillId(skillId);
  const nPath = String(resourcePath || '').trim();
  if (!nSkill || !nPath) return;
  const session = getSession(sessionId);
  if (!session.activatedSkillResources) session.activatedSkillResources = {};
  const existing = session.activatedSkillResources[nSkill] || [];
  if (!existing.includes(nPath)) {
    session.activatedSkillResources[nSkill] = [...existing, nPath];
    saveSession(sessionId);
  }
}

export function getActivatedSkillResources(sessionId: string, skillId: string): string[] {
  const session = getSession(sessionId);
  return (session.activatedSkillResources || {})[normalizeSessionSkillId(skillId)] || [];
}

export function setBusinessContextEnabled(id: string, enabled: boolean): boolean {
  const session = getSession(id);
  const normalized = enabled === true;
  session.businessContextEnabled = normalized;
  session.lastActiveAt = Date.now();
  saveSession(id);
  return normalized;
}

export function isBusinessContextEnabled(id: string): boolean {
  return getSession(id).businessContextEnabled === true;
}
