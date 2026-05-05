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

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  channel?: 'telegram' | 'web' | 'discord' | 'whatsapp' | 'system';
  channelLabel?: string;
  toolLog?: string; // compact tool call summary for this turn (injected by chat.router after turn completes)
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
  channel?: 'terminal' | 'telegram' | 'web' | 'system'; // Inferred from sessionId prefix
  createdAt: number;
  lastActiveAt: number;
  pendingMemoryFlush?: boolean;
  pendingCompaction?: boolean;
  contextTokenEstimate?: number;
  latestContextSummary?: string;
  contextStartIndex?: number;
  contextSummaryUpdatedAt?: number;
  tags?: string[];
  activatedToolCategories?: string[];
  businessContextEnabled?: boolean;
  creativeMode?: CreativeMode | null;
  creativeReferences?: CreativeReferenceRecord[];
  canvasProjectRoot?: string | null;
  canvasProjectLabel?: string | null;
  canvasProjectLink?: CanvasProjectLink | null;
}

export interface SessionMutationScope {
  allowedFiles?: string[];
  allowedDirs?: string[];
}

export interface SessionSummary {
  id: string;
  channel: 'terminal' | 'telegram' | 'web' | 'system';
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  title: string;
  preview: string;
  creativeMode?: CreativeMode | null;
  canvasProjectRoot?: string | null;
  canvasProjectLabel?: string | null;
  canvasProjectLink?: CanvasProjectLink | null;
}

export interface SessionSearchResult extends SessionSummary {
  matchedRole: ChatMessage['role'] | 'title';
  matchedContent: string;
  matchedIndex: number;
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
const AUTO_SESSION_ID_RE = /^(task_|cron_|brain_)/i;
const INTERNAL_SESSION_ID_RE = /^(brain_thought_|brain_dream_|brain_dream_cleanup_|subagent_chat_)/i;
const SESSION_SAVE_DEBOUNCE_MS = 500;
const sessionSaveTimers = new Map<string, NodeJS.Timeout>();
const sessionMutationScopes = new Map<string, SessionMutationScope>();
let sessionIndexCache: SessionIndex | null = null;

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
  return {
    id,
    channel: input?.channel === 'terminal' || input?.channel === 'telegram' || input?.channel === 'system'
      ? input.channel
      : 'web',
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    lastActiveAt: Number.isFinite(lastActiveAt) ? lastActiveAt : Date.now(),
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

function getSessionTitleFromHistory(history: any[]): string {
  const firstUserMsg = Array.isArray(history)
    ? history.find((msg) => msg?.role === 'user' && !isSessionTitleCommandMessage(msg))
    : undefined;
  const titleRaw = String(firstUserMsg?.content || '').trim();
  return titleRaw.slice(0, 60) || 'New chat';
}

function buildSessionSummary(session: Session): SessionSummary {
  if (INTERNAL_SESSION_ID_RE.test(session.id)) {
    return {
      id: session.id,
      channel: 'system',
      createdAt: Number(session.createdAt || Date.now()),
      lastActiveAt: Number(session.lastActiveAt || Date.now()),
      messageCount: 0,
      title: '(internal)',
      preview: '(internal)',
      creativeMode: null,
      canvasProjectRoot: null,
      canvasProjectLabel: null,
      canvasProjectLink: null,
    };
  }
  const title = getSessionTitleFromHistory(session.history);
  return {
    id: session.id,
    channel: session.channel || 'web',
    createdAt: Number(session.createdAt || Date.now()),
    lastActiveAt: Number(session.lastActiveAt || Date.now()),
    messageCount: Array.isArray(session.history) ? session.history.length : 0,
    title,
    preview: title,
    creativeMode: session.creativeMode || null,
    canvasProjectRoot: session.canvasProjectRoot || null,
    canvasProjectLabel: session.canvasProjectLabel || null,
    canvasProjectLink: normalizeCanvasProjectLink(session.canvasProjectLink),
  };
}

function upsertSessionSummary(session: Session): void {
  const index = loadSessionIndex();
  const summary = buildSessionSummary(session);
  if (summary.messageCount > 0) {
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
    const title = getSessionTitleFromHistory(history);
    return {
      id: String(data?.id || sessionId),
      channel: data?.channel === 'terminal' || data?.channel === 'telegram' || data?.channel === 'system'
        ? data.channel
        : 'web',
      createdAt: Number.isFinite(Number(data?.createdAt)) ? Number(data.createdAt) : Date.now(),
      lastActiveAt: Number.isFinite(Number(data?.lastActiveAt)) ? Number(data.lastActiveAt) : Date.now(),
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
    if (summary && summary.messageCount > 0) {
      index.summaries[summary.id] = summary;
    }
  }
  saveSessionIndex(index);
  return index;
}

export function listSessionSummaries(channel?: Session['channel']): SessionSummary[] {
  ensureSessionDir();
  let index = loadSessionIndex();
  const hasSessionFiles = fs.readdirSync(SESSION_DIR).some((f) => f.endsWith('.json') && f !== '_index.json');
  if (hasSessionFiles) {
    if (Object.keys(index.summaries).length === 0) {
      index = rebuildSessionIndex();
    } else if (Object.values(index.summaries).some((summary) => isCommandTitleText(summary.title))) {
      index = rebuildSessionIndex();
    }
  }
  return Object.values(index.summaries)
    .filter((summary) => !INTERNAL_SESSION_ID_RE.test(summary.id))
    .filter((summary) => !channel || summary.channel === channel)
    .filter((summary) => summary.messageCount > 0)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
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
      pendingMemoryFlush: data?.pendingMemoryFlush === true,
      pendingCompaction: data?.pendingCompaction === true,
      contextTokenEstimate: Number.isFinite(Number(data?.contextTokenEstimate)) ? Number(data.contextTokenEstimate) : undefined,
      latestContextSummary: typeof data?.latestContextSummary === 'string' ? data.latestContextSummary : undefined,
      contextStartIndex: Number.isFinite(Number(data?.contextStartIndex)) ? Math.max(0, Math.floor(Number(data.contextStartIndex))) : undefined,
      contextSummaryUpdatedAt: Number.isFinite(Number(data?.contextSummaryUpdatedAt)) ? Number(data.contextSummaryUpdatedAt) : undefined,
      activatedToolCategories: Array.isArray(data?.activatedToolCategories) ? data.activatedToolCategories : [],
      businessContextEnabled: data?.businessContextEnabled === true,
      creativeMode: normalizeCreativeMode(data?.creativeMode),
      creativeReferences: normalizeCreativeReferences(data?.creativeReferences),
      canvasProjectRoot: typeof data?.canvasProjectRoot === 'string' && data.canvasProjectRoot.trim() ? data.canvasProjectRoot : null,
      canvasProjectLabel: typeof data?.canvasProjectLabel === 'string' && data.canvasProjectLabel.trim() ? data.canvasProjectLabel : null,
      canvasProjectLink: normalizeCanvasProjectLink(data?.canvasProjectLink),
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

function inferChannelFromSessionId(sessionId: string): Session['channel'] {
  if (sessionId.startsWith('cli_')) return 'terminal';
  if (sessionId.startsWith('telegram_')) return 'telegram';
  if (sessionId.startsWith('task_') || sessionId.startsWith('cron_')) return 'system';
  if (sessionId.startsWith('brain_')) return 'system';
  if (sessionId.startsWith('auto_')) return 'system';
  return 'web'; // default for custom/web sessions
}

function resolveNumCtx(): number {
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

function resolveSessionPolicy(): {
  maxMessages: number;
  compactionThreshold: number;
  memoryFlushThreshold: number;
} {
  const defaults = {
    maxMessages: 120,
    compactionThreshold: 0.7,
    memoryFlushThreshold: 0.75,
  };
  try {
    const cfg: any = getConfig().getConfig();
    const maxMessagesRaw = Number(cfg?.session?.maxMessages);
    const compactionThresholdRaw = Number(cfg?.session?.compactionThreshold);
    const memoryFlushThresholdRaw = Number(cfg?.session?.memoryFlushThreshold);
    const maxMessages = Number.isFinite(maxMessagesRaw) && maxMessagesRaw >= 20
      ? Math.floor(maxMessagesRaw)
      : defaults.maxMessages;
    const compactionThreshold = Number.isFinite(compactionThresholdRaw) && compactionThresholdRaw >= 0.4 && compactionThresholdRaw <= 0.95
      ? compactionThresholdRaw
      : defaults.compactionThreshold;
    const memoryFlushThreshold = Number.isFinite(memoryFlushThresholdRaw) && memoryFlushThresholdRaw >= 0.5 && memoryFlushThresholdRaw <= 0.98
      ? memoryFlushThresholdRaw
      : defaults.memoryFlushThreshold;
    return { maxMessages, compactionThreshold, memoryFlushThreshold };
  } catch {
    return defaults;
  }
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
    const cleanSummary = scrubPersistedText(String(summaryText || '')).slice(0, 5000);
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
  session.latestContextSummary = cleanSummary.slice(0, 5000);
  session.contextStartIndex = Math.max(0, Math.floor(Number(baseMessageCount) || 0));
  session.contextSummaryUpdatedAt = Date.now();
  appendCompactionArtifacts(sessionId, kind, session.latestContextSummary, session.contextStartIndex, extra);
  saveSession(sessionId);
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
  session.contextTokenEstimate = estimateHistoryTokens(session.history);
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
        channel: data.channel || inferChannelFromSessionId(id),
        createdAt: data.createdAt || Date.now(),
        lastActiveAt: data.lastActiveAt || Date.now(),
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
    channel: inferChannelFromSessionId(id),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    pendingMemoryFlush: false,
    pendingCompaction: false,
    contextTokenEstimate: 0,
    latestContextSummary: undefined,
    contextStartIndex: 0,
    contextSummaryUpdatedAt: undefined,
    businessContextEnabled: false,
    creativeMode: null,
    creativeReferences: [],
    canvasProjectRoot: null,
    canvasProjectLabel: null,
    canvasProjectLink: null,
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
  const beforeTokens = estimateHistoryTokens(session.history);
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
    const projectedTokens = beforeTokens + estimateMessageTokens(msg);
    const recentlyCompacted = session.history
      .slice(-8)
      .some((h) => h.role === 'user' && h.content === PRE_COMPACTION_SUMMARY_PROMPT);
    const shouldCompact = projectedTokens >= compactionThresholdTokens && !recentlyCompacted;
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
    const projectedTokens = beforeTokens + estimateMessageTokens(msg);
    const recentlyPrompted = session.history
      .slice(-6)
      .some((h) => h.role === 'user' && h.content === PRE_COMPACTION_MEMORY_FLUSH_PROMPT);
    const shouldInject = projectedTokens >= thresholdTokens && !recentlyPrompted;
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
  session.contextTokenEstimate = estimateHistoryTokens(session.history);
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

// Per-message content caps for history sent to the API.
// Recent turns (last 2 turns = last 4 messages) get a generous cap so the model
// has full fidelity on the most recent exchange. Older turns get a tighter cap
// to keep the context window from blowing out on long sessions.
const API_HISTORY_CONTENT_CAP_RECENT_CHARS = 3000;  // last 2 turns
const API_HISTORY_CONTENT_CAP_OLDER_CHARS  = 1200;  // all older turns

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

  if (summary) {
    const summaryMsg: ChatMessage = {
      role: 'assistant',
      content: `[Rolling context summary]\n${summary}`,
      timestamp: Number(session.contextSummaryUpdatedAt || Date.now()),
      channel: 'system',
    };
    const since = base < rawMessages.length ? rawMessages.slice(base) : [];
    messages = [summaryMsg, ...since];
    if (messages.length > maxMessages) {
      messages = [summaryMsg, ...messages.slice(-(maxMessages - 1))];
    }
  } else {
    messages = rawMessages.slice(-maxMessages);
  }

  const recentCutoff = messages.length - 4; // last 2 turns = 4 messages
  return messages.map((msg, idx) => {
    const cap = idx >= recentCutoff
      ? API_HISTORY_CONTENT_CAP_RECENT_CHARS
      : API_HISTORY_CONTENT_CAP_OLDER_CHARS;
    const cleaned = msg.role === 'assistant'
      ? stripInternalToolNotes(msg.content)
      : String(msg.content || '');
    const content = cleaned || (/\[tool-note:[^\]]+\]/i.test(String(msg.content || '')) ? '' : String(msg.content || ''));
    if (!content.trim()) return null;
    if (content.length <= cap) return { ...msg, content };
    const removed = content.length - cap;
    return {
      ...msg,
      content: `${content.slice(0, cap)}\n[pruned: ${removed} chars]`,
    };
  }).filter((msg): msg is ChatMessage => !!msg);
}

/**
 * Builds a compact [RECENT_TOOL_LOG] block from toolLog fields stored on the
 * last `lookbackTurns` assistant messages. Returns empty string if no tool
 * log data exists. Capped at maxChars.
 *
 * Populated by chat.router after each turn completes via persistToolLog().
 */
export function getRecentToolLog(
  id: string,
  lookbackTurns: number = 3,
  maxChars: number = 1500,
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
  return block.length <= maxChars ? block : block.slice(0, maxChars) + '\n[...truncated]';
}

/**
 * Persists a compact tool log string onto the most recent assistant message
 * in session history. Called by chat.router after allToolResults are finalized.
 */
export function persistToolLog(id: string, toolLog: string): void {
  const session = getSession(id);
  for (let i = session.history.length - 1; i >= 0; i--) {
    if (session.history[i].role === 'assistant') {
      session.history[i].toolLog = toolLog.slice(0, 2000);
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
    history: session.history.map(msg => ({
      ...msg,
      content: scrubPersistedText(msg.content),
      toolLog: msg.toolLog ? scrubPersistedText(msg.toolLog) : msg.toolLog,
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
