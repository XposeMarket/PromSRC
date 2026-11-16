import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  discoverImportSources,
  isTranscriptFile,
  listCodexRolloutFiles,
  type DiscoveredImportSource,
  type ImportDiscoveryOptions,
} from './import-discovery';
import type { ImportAdapterId } from './import-types';

/**
 * "Agents & imports" settings page support (stage 1, import UI only).
 *
 * Two different read levels exist here and they must stay separate:
 *
 * 1. `listImportAgents` only regroups the metadata-only discovery result
 *    (names, counts, sizes). It never opens a transcript.
 * 2. Everything else (`listAgentChats`, `listAgentGroups`,
 *    `preflightAgentSelection`) runs only after the user opens an agent row.
 *    It reads a bounded head (title, working folder, session id) and, when
 *    `preview` is requested, a bounded tail (one line of the last message).
 *    Nothing read here is cached, persisted, written to memory or sent to a
 *    model; it is returned to the local settings client and dropped.
 *
 * Credential and login files are never opened: the transcript filter below
 * excludes them by name before any read happens.
 */

export const AGENT_HEAD_BYTES = 96 * 1024;
export const AGENT_TAIL_BYTES = 48 * 1024;
const MAX_AGENT_FILES = 8_000;
const MAX_SCAN_DEPTH = 7;
const MAX_PAGE = 100;
export const MAX_AGENT_BATCH_BYTES = 200 * 1024 * 1024;
const MAX_AGENT_BATCH_FILES = 400;

const CREDENTIAL_NAME = /(auth|credential|token|oauth|login|secret|password|cookie|keychain|\.env$|\.pem$|\.key$)/i;

/** Agents the page knows by name. Anything else discovery finds is "Import only". */
const KNOWN_AGENTS: Record<string, { name: string; letter: string; order: number }> = {
  claude: { name: 'Claude Code', letter: 'Cc', order: 1 },
  codex: { name: 'Codex', letter: 'Cx', order: 0 },
  openclaw: { name: 'OpenClaw', letter: 'Oc', order: 2 },
  hermes: { name: 'Hermes Agent', letter: 'He', order: 3 },
  cursor: { name: 'Cursor', letter: 'Cu', order: 4 },
};

export interface ImportAgentSetupSource {
  id: string;
  label: string;
  setupFileCount: number;
  /** Local config path, returned to the local settings client only (same as /discover). */
  sourcePath: string;
}

/** Adapters whose chats can be listed one by one in an opened row. */
const BROWSABLE_ADAPTERS = new Set<ImportAdapterId>(['codex-local', 'claude-code-local', 'hermes-local', 'openclaw-local']);

export interface ImportAgent {
  id: string;
  name: string;
  letter: string;
  /** Stage 1 rows are always "found". A later stage adds connection states. */
  state: 'found';
  /** True when only file import is possible (no live agent support planned for this source yet). */
  importOnly: boolean;
  chatCount: number;
  bytes: number;
  capped: boolean;
  /** Whether chats can be listed and selected individually. */
  browsable: boolean;
  supportsProjects: boolean;
  conversationSourceIds: string[];
  /** For non-browsable sources: whole-source import through the existing preview flow. */
  conversationSource?: { sourcePath: string; adapter: ImportAdapterId; label: string };
  setupSources: ImportAgentSetupSource[];
}

export interface AgentChatEntry {
  /** Opaque, root-relative path with forward slashes. */
  id: string;
  bytes: number;
  updatedAt: number;
  title?: string;
  preview?: string;
  groupKey?: string;
  groupLabel?: string;
  groupKind?: 'project' | 'folder';
  sourceConversationId?: string;
}

export interface AgentGroup {
  key: string;
  kind: 'project' | 'folder';
  label: string;
  path?: string;
  chatCount: number;
  bytes: number;
  updatedAt: number;
}

export interface AgentSelection {
  /** Whole groups (projects or folders): every chat in them, listed or not. */
  groups?: string[];
  /** Individual chats: partial groups and loose chats. */
  chats?: string[];
  /** Chats unticked inside a whole group ("all but these"). Ignored outside whole groups. */
  exclude?: string[];
}

export interface ResolvedGroupSelection {
  key: string;
  kind: 'project' | 'folder';
  label: string;
  selected: number;
  total: number;
  all: boolean;
}

export interface ResolvedAgentSelection {
  groups: ResolvedGroupSelection[];
  looseChats: number;
  totalChats: number;
  totalBytes: number;
  entries: AgentChatEntry[];
  unknownChats: string[];
}

interface AgentContext {
  agentId: string;
  source: DiscoveredImportSource;
  root: string;
  adapter: ImportAdapterId;
}

export function agentIdForProvider(provider: string): string {
  const clean = String(provider || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return clean || 'source';
}

/** Metadata-only regrouping of discovery: one row per agent, MCP config folded in. */
export function listImportAgents(options: ImportDiscoveryOptions = {}): { scannedAt: string; agents: ImportAgent[] } {
  const discovery = discoverImportSources(options);
  const agents = new Map<string, ImportAgent>();
  for (const source of discovery.sources) {
    const id = agentIdForProvider(source.provider);
    const known = KNOWN_AGENTS[id];
    const agent = agents.get(id) || {
      id,
      name: known?.name || source.label.replace(/\s+(MCP integrations|setup)$/i, '') || id,
      letter: (known?.letter || source.label.trim()[0] || '?').toUpperCase(),
      state: 'found' as const,
      // Stage 3 extension point: live connection support. Today only the four
      // named coding agents are candidates for it; every other source stays
      // import-only. Do not add a connect toggle until it does something.
      importOnly: !known || id === 'cursor',
      chatCount: 0,
      bytes: 0,
      capped: false,
      browsable: false,
      supportsProjects: false,
      conversationSourceIds: [],
      setupSources: [],
    };
    if (source.kind === 'setup') {
      agent.setupSources.push({ id: source.id, label: source.label, setupFileCount: source.setupFileCount, sourcePath: source.sourcePath });
    } else {
      agent.conversationSourceIds.push(source.id);
      agent.chatCount += source.transcriptCount;
      agent.bytes += source.bytes;
      agent.capped = agent.capped || source.capped;
      agent.supportsProjects = agent.supportsProjects || source.supportsProjects;
      const browsable = BROWSABLE_ADAPTERS.has(source.adapter);
      agent.browsable = agent.browsable || browsable;
      if (!browsable && !agent.conversationSource) {
        agent.conversationSource = { sourcePath: source.sourcePath, adapter: source.adapter, label: source.label };
      }
    }
    agents.set(id, agent);
  }
  const list = [...agents.values()].sort((a, b) => {
    const ao = KNOWN_AGENTS[a.id]?.order ?? 50;
    const bo = KNOWN_AGENTS[b.id]?.order ?? 50;
    return ao - bo || a.name.localeCompare(b.name);
  });
  return { scannedAt: discovery.scannedAt, agents: list };
}

function agentContext(agentId: string, options: ImportDiscoveryOptions): AgentContext {
  const wanted = agentIdForProvider(agentId);
  const discovery = discoverImportSources(options);
  const source = discovery.sources.find((item) => item.kind === 'conversation'
    && agentIdForProvider(item.provider) === wanted
    && BROWSABLE_ADAPTERS.has(item.adapter));
  if (!source) throw new Error('That agent has no chats to list. Scan again.');
  return { agentId: wanted, source, root: path.resolve(source.sourcePath), adapter: source.adapter };
}

function isSafeTranscriptName(relativePath: string): boolean {
  return !relativePath.split('/').some((segment) => CREDENTIAL_NAME.test(segment));
}

interface AgentFile {
  id: string;
  absolutePath: string;
  bytes: number;
  updatedAt: number;
}

/** Stat-only listing of an agent's transcript files. No file contents are read. */
export function listAgentFiles(root: string, adapter: ImportAdapterId): AgentFile[] {
  const out: AgentFile[] = [];
  if (adapter === 'codex-local') {
    for (const file of listCodexRolloutFiles(root)) {
      if (!isSafeTranscriptName(file.relativePath)) continue;
      let updatedAt = 0;
      try { updatedAt = fs.statSync(file.absolutePath).mtimeMs; } catch { continue; }
      out.push({ id: file.relativePath, absolutePath: file.absolutePath, bytes: file.bytes, updatedAt });
    }
  } else {
    const walk = (current: string, relative: string, depth: number): void => {
      if (out.length >= MAX_AGENT_FILES || depth > MAX_SCAN_DEPTH) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (out.length >= MAX_AGENT_FILES) return;
        const next = path.join(current, entry.name);
        const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
        let stat: fs.Stats;
        try { stat = fs.lstatSync(next); } catch { continue; }
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) { walk(next, nextRelative, depth + 1); continue; }
        if (!stat.isFile()) continue;
        if (!isSafeTranscriptName(nextRelative) || !isTranscriptFile(nextRelative, adapter)) continue;
        out.push({ id: nextRelative, absolutePath: next, bytes: stat.size, updatedAt: stat.mtimeMs });
      }
    };
    walk(root, '', 0);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function readBounded(file: string, start: 'head' | 'tail', bytes: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(bytes, size);
    const position = start === 'head' ? 0 : Math.max(0, size - length);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, position);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function jsonLines(text: string, dropFirst: boolean, dropLast: boolean): any[] {
  const lines = text.split(/\r?\n/);
  if (dropFirst) lines.shift();
  if (dropLast) lines.pop();
  const out: any[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch { /* partial or non-JSON line */ }
  }
  return out;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part: any) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).filter(Boolean).join(' ');
  }
  if (value && typeof value === 'object') {
    const v = value as any;
    if (typeof v.text === 'string') return v.text;
    if (v.content !== undefined) return textOf(v.content);
  }
  return '';
}

/** Returns { role, text } for a transcript record in any supported shape, or null. */
export function messageOf(record: any): { role: string; text: string } | null {
  if (!record || typeof record !== 'object') return null;
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : null;
  if (payload) {
    if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
      return { role: payload.role, text: textOf(payload.content) };
    }
    if (payload.type === 'user_message' && typeof payload.message === 'string') return { role: 'user', text: payload.message };
    if (payload.type === 'agent_message' && typeof payload.message === 'string') return { role: 'assistant', text: payload.message };
    return null;
  }
  if (record.message && typeof record.message === 'object' && (record.message.role === 'user' || record.message.role === 'assistant')) {
    return { role: record.message.role, text: textOf(record.message.content) };
  }
  const role = String(record.role || record.type || '').toLowerCase();
  if (role === 'user' || role === 'assistant' || role === 'human' || role === 'ai') {
    return { role: role === 'human' ? 'user' : role === 'ai' ? 'assistant' : role, text: textOf(record.content ?? record.text) };
  }
  return null;
}

function cleanLine(text: string, max: number): string {
  const value = String(text || '');
  if (/^\s*<(environment_context|recommended_plugins|user_instructions|permissions|system)/i.test(value)) return '';
  return value.replace(/<[^>]{1,80}>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function projectPath(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 1_000 || raw.includes('\0')) return '';
  return path.isAbsolute(raw) || path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw) ? raw : '';
}

interface HeadFacts {
  title: string;
  cwd: string;
  projectName: string;
  sourceConversationId: string;
}

/** Reads a bounded head. Called only for opened rows. */
export function readHeadFacts(file: string, adapter: ImportAdapterId, wantTitle: boolean): HeadFacts {
  const head = readBounded(file, 'head', wantTitle ? AGENT_HEAD_BYTES : 32 * 1024);
  const facts: HeadFacts = { title: '', cwd: '', projectName: '', sourceConversationId: '' };
  const records = jsonLines(head, false, head.length >= (wantTitle ? AGENT_HEAD_BYTES : 32 * 1024));
  for (const record of records.slice(0, 400)) {
    if (!record || typeof record !== 'object') continue;
    const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    if (!facts.cwd) facts.cwd = projectPath(record.cwd) || projectPath(payload.cwd) || projectPath(metadata.cwd) || projectPath(record.workingDirectory) || projectPath(record.projectPath) || projectPath(record.workspacePath);
    if (!facts.projectName) facts.projectName = String(record.projectName || record.workspaceName || metadata.projectName || metadata.workspaceName || '').trim().slice(0, 200);
    if (!facts.sourceConversationId) {
      const id = record.type === 'session_meta' ? (payload.id || payload.session_id) : (record.sessionId || record.session_id || record.conversation_id || record.conversationId || record.thread_id);
      if (typeof id === 'string' && id.trim()) facts.sourceConversationId = id.trim().slice(0, 300);
    }
    if (wantTitle && !facts.title) {
      if (record.type === 'summary' && typeof record.summary === 'string') facts.title = cleanLine(record.summary, 200);
      else if (typeof record.title === 'string' && record.title.trim()) facts.title = cleanLine(record.title, 200);
      else {
        const message = messageOf(record);
        if (message?.role === 'user') facts.title = cleanLine(message.text.split(/\r?\n/).find((line) => line.trim()) || '', 200);
      }
    }
    if (facts.cwd && facts.sourceConversationId && (!wantTitle || facts.title)) break;
  }
  if (!facts.cwd) {
    // Very long first records (Codex session_meta) can exceed the bounded head; a
    // field match on the raw head still finds the recorded working folder.
    const match = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.){1,1000})"/);
    if (match) {
      try { facts.cwd = projectPath(JSON.parse(`"${match[1]}"`)); } catch { /* ignore */ }
    }
  }
  if (!facts.sourceConversationId && adapter === 'codex-local') {
    const match = head.match(/"type"\s*:\s*"session_meta"[\s\S]{0,400}?"id"\s*:\s*"([^"]{1,300})"/);
    if (match) facts.sourceConversationId = match[1];
  }
  return facts;
}

/** One line of the last user/assistant message. Called only when the client asks for previews of an opened row. */
export function readLastMessagePreview(file: string): string {
  const tail = readBounded(file, 'tail', AGENT_TAIL_BYTES);
  let size = 0;
  try { size = fs.statSync(file).size; } catch { /* ignore */ }
  const records = jsonLines(tail, size > AGENT_TAIL_BYTES, false);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const message = messageOf(records[index]);
    if (!message) continue;
    const line = cleanLine(message.text, 160);
    if (line) return line;
  }
  return '';
}

// Grouping facts (working folder, recorded project name, source session id) are
// metadata, not message text. They are cached per file path + size + mtime so
// reopening a large agent stays fast. Titles and previews are never cached.
const factsCache = new Map<string, { size: number; mtime: number; facts: Omit<HeadFacts, 'title'> }>();
const FACTS_CACHE_LIMIT = 20_000;

function groupingFacts(file: AgentFile, adapter: ImportAdapterId): Omit<HeadFacts, 'title'> {
  const cached = factsCache.get(file.absolutePath);
  if (cached && cached.size === file.bytes && cached.mtime === file.updatedAt) return cached.facts;
  const { title: _title, ...facts } = readHeadFacts(file.absolutePath, adapter, false);
  if (factsCache.size >= FACTS_CACHE_LIMIT) factsCache.clear();
  factsCache.set(file.absolutePath, { size: file.bytes, mtime: file.updatedAt, facts });
  return facts;
}

/** Test hook: forget cached grouping metadata. */
export function clearAgentFactsCache(): void { factsCache.clear(); }

function baseName(value: string): string {
  return path.win32.basename(value.replace(/[\\/]+$/, '')) || path.posix.basename(value) || value;
}

/**
 * A group is a "project" only when the agent itself records one: Claude Code's
 * per-project folders, or an explicit project/workspace name in the records.
 * Anything grouped only by a recorded working folder is a "folder" group.
 */
export function groupForFile(file: AgentFile, adapter: ImportAdapterId, facts: Omit<HeadFacts, 'title'>): { key: string; kind: 'project' | 'folder'; label: string; path?: string } | null {
  const segments = file.id.split('/');
  if (adapter === 'claude-code-local' && segments.length > 1) {
    const folder = segments[0];
    return {
      key: `p:${folder}`,
      kind: 'project',
      label: facts.projectName || (facts.cwd ? baseName(facts.cwd) : folder.replace(/^-+/, '').replace(/-/g, ' ')),
      ...(facts.cwd ? { path: facts.cwd } : {}),
    };
  }
  if (facts.projectName) {
    return { key: `p:${facts.projectName.toLowerCase()}`, kind: 'project', label: facts.projectName, ...(facts.cwd ? { path: facts.cwd } : {}) };
  }
  if (facts.cwd) {
    const normalized = facts.cwd.replace(/[\\/]+$/, '');
    const key = /^[a-z]:/i.test(normalized) || normalized.includes('\\') ? normalized.toLowerCase().replace(/\//g, '\\') : normalized;
    return { key: `f:${key}`, kind: 'folder', label: `Folder: ${normalized}`, path: normalized };
  }
  return null;
}

interface IndexedFile extends AgentFile {
  group: ReturnType<typeof groupForFile>;
  sourceConversationId: string;
}

function indexAgent(ctx: AgentContext): IndexedFile[] {
  return listAgentFiles(ctx.root, ctx.adapter).map((file) => {
    const facts = groupingFacts(file, ctx.adapter);
    return { ...file, group: groupForFile(file, ctx.adapter, facts), sourceConversationId: facts.sourceConversationId };
  });
}

function summarizeGroups(files: IndexedFile[]): { groups: AgentGroup[]; looseChats: number; totalChats: number } {
  const groups = new Map<string, AgentGroup>();
  let looseChats = 0;
  for (const file of files) {
    if (!file.group) { looseChats += 1; continue; }
    const current = groups.get(file.group.key) || { key: file.group.key, kind: file.group.kind, label: file.group.label, ...(file.group.path ? { path: file.group.path } : {}), chatCount: 0, bytes: 0, updatedAt: 0 };
    current.chatCount += 1;
    current.bytes += file.bytes;
    current.updatedAt = Math.max(current.updatedAt, file.updatedAt);
    groups.set(file.group.key, current);
  }
  return {
    groups: [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.label.localeCompare(b.label)),
    looseChats,
    totalChats: files.length,
  };
}

export function listAgentGroups(agentId: string, options: ImportDiscoveryOptions = {}): { agentId: string; groups: AgentGroup[]; looseChats: number; totalChats: number } {
  const ctx = agentContext(agentId, options);
  return { agentId: ctx.agentId, ...summarizeGroups(indexAgent(ctx)) };
}

export interface AgentChatPageOptions extends ImportDiscoveryOptions {
  offset?: number;
  limit?: number;
  /** Group key, or "loose" for chats with no group. Omitted means every chat. */
  group?: string;
  /** Read one line of the last message for each chat on this page. */
  preview?: boolean;
}

export function listAgentChats(agentId: string, options: AgentChatPageOptions = {}): {
  agentId: string; chats: AgentChatEntry[]; total: number; offset: number; limit: number; hasMore: boolean;
} {
  const ctx = agentContext(agentId, options);
  let files = indexAgent(ctx);
  if (options.group === 'loose') files = files.filter((file) => !file.group);
  else if (options.group) files = files.filter((file) => file.group?.key === options.group);
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const limit = Math.max(1, Math.min(MAX_PAGE, Math.floor(Number(options.limit) || 50)));
  const page = files.slice(offset, offset + limit);
  const chats = page.map((file): AgentChatEntry => {
    // Opened-row reads only: bounded head for the title, bounded tail for the
    // preview. The text is returned to the client and not retained here.
    const head = readHeadFacts(file.absolutePath, ctx.adapter, true);
    return {
      id: file.id,
      bytes: file.bytes,
      updatedAt: file.updatedAt,
      title: head.title || baseName(file.id).replace(/\.(jsonl|json|md)$/i, ''),
      ...(options.preview ? { preview: readLastMessagePreview(file.absolutePath) } : {}),
      ...(file.group ? { groupKey: file.group.key, groupLabel: file.group.label, groupKind: file.group.kind } : {}),
      ...(file.sourceConversationId ? { sourceConversationId: file.sourceConversationId } : {}),
    };
  });
  return { agentId: ctx.agentId, chats, total: files.length, offset, limit, hasMore: offset + page.length < files.length };
}

/** Pure selection resolution: whole groups + individual chats -> exact chat set. */
export function resolveAgentSelection<T extends { id: string; bytes: number; group: { key: string; kind: 'project' | 'folder'; label: string } | null }>(
  files: T[],
  selection: AgentSelection,
): { groups: ResolvedGroupSelection[]; looseChats: number; totalChats: number; totalBytes: number; files: T[]; unknownChats: string[] } {
  const wholeGroups = new Set((selection.groups || []).map(String));
  const chatIds = new Set((selection.chats || []).map(String));
  const excluded = new Set((selection.exclude || []).map(String));
  const known = new Set(files.map((file) => file.id));
  const unknownChats = [...chatIds].filter((id) => !known.has(id));
  const picked: T[] = [];
  const groupTotals = new Map<string, { kind: 'project' | 'folder'; label: string; total: number; selected: number }>();
  let looseChats = 0;
  for (const file of files) {
    if (file.group) {
      const g = groupTotals.get(file.group.key) || { kind: file.group.kind, label: file.group.label, total: 0, selected: 0 };
      g.total += 1;
      const take = wholeGroups.has(file.group.key) ? !excluded.has(file.id) : chatIds.has(file.id);
      if (take) { g.selected += 1; picked.push(file); }
      groupTotals.set(file.group.key, g);
    } else if (chatIds.has(file.id)) {
      looseChats += 1;
      picked.push(file);
    }
  }
  const groups = [...groupTotals.entries()]
    .filter(([, g]) => g.selected > 0)
    .map(([key, g]) => ({ key, kind: g.kind, label: g.label, selected: g.selected, total: g.total, all: g.selected === g.total }));
  return {
    groups,
    looseChats,
    totalChats: picked.length,
    totalBytes: picked.reduce((sum, file) => sum + file.bytes, 0),
    files: picked,
    unknownChats,
  };
}

export interface AgentImportRequest {
  kind: 'conversation';
  sourcePath: string;
  adapter: ImportAdapterId;
  sourceLabel: string;
  conversationMode: 'projects';
  sourceFiles: string[];
  chatCount: number;
  bytes: number;
}

/** Splits the exact selected files into bounded requests for the existing POST /api/imports/jobs route. */
export function buildAgentImportRequests(
  root: string,
  adapter: ImportAdapterId,
  sourceLabel: string,
  files: Array<{ absolutePath: string; bytes: number }>,
): AgentImportRequest[] {
  const requests: AgentImportRequest[] = [];
  let current: typeof files = [];
  let bytes = 0;
  const flush = (): void => {
    if (!current.length) return;
    requests.push({
      kind: 'conversation', sourcePath: root, adapter, sourceLabel, conversationMode: 'projects',
      sourceFiles: current.map((file) => file.absolutePath), chatCount: current.length, bytes,
    });
    current = [];
    bytes = 0;
  };
  for (const file of files) {
    if (current.length && (bytes + file.bytes > MAX_AGENT_BATCH_BYTES || current.length >= MAX_AGENT_BATCH_FILES)) flush();
    current.push(file);
    bytes += file.bytes;
  }
  flush();
  return requests;
}

export interface AgentPreflight {
  agentId: string;
  agentName: string;
  groups: ResolvedGroupSelection[];
  looseChats: number;
  totalChats: number;
  totalBytes: number;
  alreadyImported: number;
  toImport: number;
  unknownChats: number;
  requests: AgentImportRequest[];
}

export function preflightAgentSelection(
  agentId: string,
  selection: AgentSelection,
  isAlreadyImported: (input: { provider: string; adapter: ImportAdapterId; sourceConversationId: string }) => boolean,
  options: ImportDiscoveryOptions = {},
): AgentPreflight {
  const ctx = agentContext(agentId, options);
  const resolved = resolveAgentSelection(indexAgent(ctx), selection);
  let alreadyImported = 0;
  for (const file of resolved.files) {
    if (file.sourceConversationId && isAlreadyImported({ provider: ctx.source.provider, adapter: ctx.adapter, sourceConversationId: file.sourceConversationId })) {
      alreadyImported += 1;
    }
  }
  const agentName = KNOWN_AGENTS[ctx.agentId]?.name || ctx.source.label;
  return {
    agentId: ctx.agentId,
    agentName,
    groups: resolved.groups,
    looseChats: resolved.looseChats,
    totalChats: resolved.totalChats,
    totalBytes: resolved.totalBytes,
    alreadyImported,
    toImport: resolved.totalChats - alreadyImported,
    unknownChats: resolved.unknownChats.length,
    requests: buildAgentImportRequests(ctx.root, ctx.adapter, ctx.source.label, resolved.files),
  };
}

/** Stable digest of a selection, used by the client to detect stale preflights. */
export function selectionDigest(selection: AgentSelection): string {
  return crypto.createHash('sha256').update(JSON.stringify({ g: [...(selection.groups || [])].sort(), c: [...(selection.chats || [])].sort(), x: [...(selection.exclude || [])].sort() })).digest('hex').slice(0, 16);
}
