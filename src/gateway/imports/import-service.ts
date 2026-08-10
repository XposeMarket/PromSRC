import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { getConfig } from '../../config/config';
import { scrubSecrets } from '../../security/vault';
import { getMCPManager, MCPManager } from '../mcp-manager';
import {
  createImportedProject,
  deleteProject,
  findProjectByExternalImportDedupeKey,
  getProject,
  addSessionToProject,
  type Project,
} from '../projects/project-store';
import { getResourceStore } from '../resources/resource-store';
import { deleteSession, flushSession, getSession, reorderSessionSidebar, sessionExists, type ChatMessage, type Session } from '../session';
import { assertSafeStorageId, resolveConfinedStoragePath } from '../storage/storage-paths';
import {
  IMPORT_MAX_INPUT_BYTES,
  IMPORT_MAX_TEXT_BYTES,
  listStagedFiles,
  parseConversationImport,
  parseSetupImport,
  stableImportId,
  type AdapterContext,
  type StagedFile,
} from './import-adapters';
import {
  type ExternalImportBinding,
  type ConversationImportMode,
  type ImportedConversation,
  type ImportedHistoricalEvent,
  type ImportedMessage,
  type ImportedResource,
  type ImportedProjectReference,
  type ImportAdapterId,
  type ImportJob,
  type ImportJobKind,
  type ImportJobProgress,
  type ImportJobResult,
  type ImportJobStatus,
  type ImportPreview,
  type ImportedSetup,
} from './import-types';

const IMPORT_SCHEMA_VERSION = 1 as const;
const MAX_JOBS = 500;
const MAX_SOURCE_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_PREVIEW_CONVERSATIONS = 10_000;
const MAX_SELECTED_CONVERSATIONS = 10_000;

interface CreateImportJobInput {
  ownerId: string;
  workspacePath?: string;
  kind: ImportJobKind;
  sourcePath?: string;
  sourceText?: string;
  sourceBase64?: string;
  sourceLabel?: string;
  requestedAdapter?: ImportAdapterId;
  sourceAccountId?: string;
  overwrite?: boolean;
  conversationMode?: ConversationImportMode;
  /** Optional bounded file selection for source-aware batch imports. */
  sourceFiles?: string[];
}

interface StagedInput {
  stagedPath: string;
  sourceLabel: string;
  inputDigest: string;
  sourcePathProvided: boolean;
}

function nowIso(): string { return new Date().toISOString(); }

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeImportedWorkspacePath(reference: ImportedProjectReference): { path?: string; state: 'linked' | 'permission_required' | 'unavailable' } {
  const raw = String(reference.workspacePath || reference.sourcePath || '').trim();
  if (!raw) return { state: 'unavailable' };
  const selected = path.resolve(raw);
  try {
    const stat = fs.lstatSync(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
  const cfg = getConfig().getConfig() as any;
  const allowedRoots = [cfg?.workspace?.path, ...(Array.isArray(cfg?.tools?.permissions?.files?.allowed_paths)
    ? cfg.tools.permissions.files.allowed_paths
    : [])]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  return allowedRoots.some((root) => isPathInside(root, selected))
    ? { path: selected, state: 'linked' }
    : { state: 'permission_required' };
}

function safeJobId(value: string): string {
  return assertSafeStorageId(value, 'import job');
}

function importRoot(): string {
  return path.join(getConfig().getConfigDir(), 'imports');
}

function jobsRoot(): string {
  return path.join(importRoot(), 'jobs');
}

function jobPath(id: string): string {
  return resolveConfinedStoragePath(jobsRoot(), `${safeJobId(id)}.json`, { label: 'import job' });
}

function stagingRoot(id: string): string {
  return resolveConfinedStoragePath(path.join(importRoot(), 'staging'), safeJobId(id), { label: 'import staging' });
}

function tombstonePath(id: string): string {
  return resolveConfinedStoragePath(path.join(importRoot(), 'tombstones'), `${safeJobId(id)}.json`, { label: 'import tombstone' });
}

function backupRoot(id: string): string {
  return resolveConfinedStoragePath(path.join(importRoot(), 'backups'), safeJobId(id), { label: 'import backup' });
}

function setupSnapshotRoot(id: string): string {
  return resolveConfinedStoragePath(path.join(importRoot(), 'setup-snapshots'), safeJobId(id), { label: 'setup import snapshot' });
}

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, filePath);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function persistJob(job: ImportJob): void {
  job.updatedAt = nowIso();
  atomicWrite(jobPath(job.id), job);
}

function cleanupStaging(job: ImportJob): void {
  try { fs.rmSync(stagingRoot(job.id), { recursive: true, force: true }); } catch { /* best effort; job state remains durable */ }
}

function readJob(id: string): ImportJob | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(jobPath(id), 'utf8')) as ImportJob;
    if (parsed?.schemaVersion !== IMPORT_SCHEMA_VERSION || String(parsed?.id || '') !== id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function projectSummariesFor(conversations: ImportedConversation[], mode: ConversationImportMode = 'sessions'): ImportPreview['projectSummaries'] {
  if (mode !== 'projects') return [];
  const groups = new Map<string, { project: ImportedProjectReference; conversations: number; messages: number; events: number }>();
  for (const conversation of conversations) {
    const project = conversation.project;
    if (!project?.sourceProjectId) continue;
    const existing = groups.get(project.sourceProjectId) || { project, conversations: 0, messages: 0, events: 0 };
    existing.conversations += 1;
    existing.messages += conversation.messages.length;
    existing.events += conversation.events.length;
    groups.set(project.sourceProjectId, existing);
  }
  return [...groups.entries()].slice(0, 500).map(([id, item]) => ({
    id,
    name: item.project.name,
    ...(item.project.sourcePath ? { sourcePath: item.project.sourcePath } : {}),
    conversations: item.conversations,
    messages: item.messages,
    events: item.events,
  }));
}

function listInternalJobs(ownerId?: string): ImportJob[] {
  const root = jobsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJob(name.slice(0, -5)))
    .filter((job): job is ImportJob => !!job)
    .filter((job) => !ownerId || job.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_JOBS);
}

function publicJob(job: ImportJob): ImportJob {
  const result = clone(job);
  // Quarantine paths are server-private. The UI gets labels, digests, counts,
  // and checkpoint state, never an arbitrary local path.
  delete (result as any).stagedPath;
  delete (result as any).normalizedPath;
  delete (result as any).workspacePath;
  delete (result as any).backupPath;
  return result;
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureNoSymlinkPath(filePath: string): fs.Stats {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error('Import sources may not contain symbolic links.');
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('Import source is not a regular file or directory.');
  return stat;
}

function copyFileConfined(source: string, destination: string, maxBytes = IMPORT_MAX_INPUT_BYTES): number {
  const stat = ensureNoSymlinkPath(source);
  if (!stat.isFile()) throw new Error('Import source file expected.');
  if (stat.size > maxBytes) throw new Error('Import source exceeds the safety limit.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return stat.size;
}

function copyTree(source: string, destination: string, kind: ImportJobKind): { bytes: number; digest: string; files: number } {
  const root = fs.realpathSync(source);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let files = 0;
  const walk = (current: string, relative: string) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = ensureNoSymlinkPath(next);
      if (stat.isDirectory()) {
        walk(next, nextRelative);
        continue;
      }
      if (files >= 8_000) throw new Error('Import contains too many files.');
      bytes += stat.size;
      if (bytes > IMPORT_MAX_INPUT_BYTES) throw new Error('Import directory exceeds the safety limit.');
      const safeName = nextRelative.replace(/\\/g, '/');
      if (!safeName || safeName.includes('\0') || safeName.split('/').some((segment) => !segment || segment === '..')) {
        throw new Error('Import source contains an unsafe path.');
      }
      const destinationPath = resolveConfinedStoragePath(destination, safeName, { label: 'staged import file' });
      let data = fs.readFileSync(next);
      // Setup imports get a redacted working copy. The raw source is never
      // copied into the active config or workspace by this feature.
      if (kind === 'setup' && (stat.size <= IMPORT_MAX_TEXT_BYTES) && /\.(json|jsonl|ya?ml|toml|env|md|txt)$/i.test(safeName)) {
        const text = data.toString('utf8');
        data = Buffer.from(scrubSecrets(text), 'utf8');
      }
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, data);
      hash.update(safeName).update('\0').update(data);
      files += 1;
    }
  };
  walk(root, '');
  return { bytes, digest: hash.digest('hex'), files };
}

function copySelectedFiles(
  sourceRoot: string,
  destination: string,
  selectedFiles: string[],
  kind: ImportJobKind,
): { bytes: number; digest: string; files: number } {
  const rootAbsolute = path.resolve(sourceRoot);
  const rootStat = ensureNoSymlinkPath(rootAbsolute);
  if (!rootStat.isDirectory()) throw new Error('Selected import files require a source directory.');
  const rootReal = fs.realpathSync(rootAbsolute);
  const uniqueFiles = [...new Set(selectedFiles.map((value) => path.resolve(String(value || '').trim())).filter(Boolean))];
  if (!uniqueFiles.length) throw new Error('The selected import batch contains no files.');
  if (uniqueFiles.length > 8_000) throw new Error('Import batch contains too many files.');

  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for (const selected of uniqueFiles) {
    if (!isPathInside(rootAbsolute, selected)) throw new Error('Selected import file is outside its source directory.');
    const selectedReal = fs.realpathSync(selected);
    if (!isPathInside(rootReal, selectedReal) || path.resolve(selectedReal) !== path.resolve(selected)) {
      throw new Error('Selected import files may not traverse symbolic links.');
    }
    const stat = ensureNoSymlinkPath(selected);
    if (!stat.isFile()) throw new Error('Selected import batch entries must be regular files.');
    bytes += stat.size;
    if (bytes > IMPORT_MAX_INPUT_BYTES) throw new Error('Import batch exceeds the safety limit.');
    const relative = path.relative(rootAbsolute, selected).replace(/\\/g, '/');
    if (!relative || relative.includes('\0') || relative.split('/').some((segment) => !segment || segment === '..')) {
      throw new Error('Selected import file has an unsafe relative path.');
    }
    const destinationPath = resolveConfinedStoragePath(destination, relative, { label: 'staged import file' });
    let data = fs.readFileSync(selected);
    if (kind === 'setup' && stat.size <= IMPORT_MAX_TEXT_BYTES && /\.(json|jsonl|ya?ml|toml|env|md|txt)$/i.test(relative)) {
      data = Buffer.from(scrubSecrets(data.toString('utf8')), 'utf8');
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, data);
    hash.update(relative).update('\0').update(data);
  }
  return { bytes, digest: hash.digest('hex'), files: uniqueFiles.length };
}

function stageInput(input: CreateImportJobInput, id: string): StagedInput {
  const root = stagingRoot(id);
  fs.mkdirSync(root, { recursive: true });
  if (input.sourceText !== undefined) {
    const text = String(input.sourceText);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_SOURCE_UPLOAD_BYTES) throw new Error('Uploaded import text is too large.');
    const suggestedName = input.sourceLabel && /\.[a-z0-9]+$/i.test(input.sourceLabel)
      ? path.basename(input.sourceLabel).replace(/[^a-zA-Z0-9._-]/g, '_')
      : '';
    const name = suggestedName || (input.kind === 'setup' ? 'source.md' : 'source.json');
    const file = path.join(root, name);
    fs.writeFileSync(file, input.kind === 'setup' ? scrubSecrets(text) : text, 'utf8');
    return { stagedPath: root, sourceLabel: input.sourceLabel || name, inputDigest: hashFile(file), sourcePathProvided: false };
  }
  if (input.sourceBase64 !== undefined) {
    const raw = String(input.sourceBase64).replace(/^data:[^,]+,/, '');
    let bytes: Buffer;
    try { bytes = Buffer.from(raw, 'base64'); } catch { throw new Error('Uploaded import data is not valid base64.'); }
    if (!bytes.length || bytes.length > MAX_SOURCE_UPLOAD_BYTES) throw new Error('Uploaded import data is too large or empty.');
    const name = input.sourceLabel && /\.[a-z0-9]+$/i.test(input.sourceLabel) ? path.basename(input.sourceLabel) : (input.kind === 'setup' ? 'source.json' : 'source.zip');
    const file = resolveConfinedStoragePath(root, name, { label: 'staged upload' });
    fs.writeFileSync(file, bytes);
    return { stagedPath: root, sourceLabel: input.sourceLabel || name, inputDigest: hashFile(file), sourcePathProvided: false };
  }
  const sourcePath = String(input.sourcePath || '').trim();
  if (!sourcePath) throw new Error('sourcePath, sourceText, or sourceBase64 is required.');
  const absolute = path.resolve(sourcePath);
  const stat = ensureNoSymlinkPath(absolute);
  if (stat.isDirectory()) {
    if (Array.isArray(input.sourceFiles) && input.sourceFiles.length) {
      const copied = copySelectedFiles(absolute, root, input.sourceFiles, input.kind);
      return { stagedPath: root, sourceLabel: input.sourceLabel || path.basename(absolute), inputDigest: copied.digest, sourcePathProvided: true };
    }
    const copied = copyTree(absolute, root, input.kind);
    return { stagedPath: root, sourceLabel: input.sourceLabel || path.basename(absolute), inputDigest: copied.digest, sourcePathProvided: true };
  }
  const name = path.basename(absolute).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'source';
  const file = resolveConfinedStoragePath(root, name, { label: 'staged source' });
  copyFileConfined(absolute, file);
  return { stagedPath: root, sourceLabel: input.sourceLabel || name, inputDigest: hashFile(file), sourcePathProvided: true };
}

function progress(job: ImportJob, phase: ImportJobStatus, completed: number, total: number, message?: string, checkpoint?: string): void {
  const next: ImportJobProgress = { phase, completed, total, ...(message ? { message } : {}), ...(checkpoint ? { checkpoint } : {}) };
  job.progress = next;
  job.status = phase;
  job.checkpoint = checkpoint || job.checkpoint;
  persistJob(job);
}

function adapterContext(job: ImportJob): AdapterContext {
  return {
    stagedPath: job.stagedPath,
    files: listStagedFiles(job.stagedPath),
    sourceLabel: job.sourceLabel,
    inputDigest: job.sourceDigest,
    requestedAdapter: job.adapter === 'unsupported' ? undefined : job.adapter,
  };
}

function buildPreview(job: ImportJob, conversations: ImportedConversation[] = [], setup?: ImportedSetup, warnings: string[] = [], unsupportedReason?: string): ImportPreview {
  const sourceDigest = job.sourceDigest;
  const projectSummaries = projectSummariesFor(conversations, job.conversationMode || 'sessions');
  const orderedConversations = [...conversations].sort((a, b) => {
    const updatedDelta = (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    return updatedDelta || String(a.id || '').localeCompare(String(b.id || ''));
  });
  const conversationSummaries = orderedConversations.slice(0, MAX_PREVIEW_CONVERSATIONS);
  const projectBoundaryWarnings = job.kind === 'conversation' && job.conversationMode === 'projects' && conversations.length > 0 && projectSummaries.length === 0
    ? ['No source project/workspace boundary was found. Chats will be imported as top-level Prometheus threads; review the source format or choose a project-bearing folder if you want project grouping.']
    : [];
  const preview: ImportPreview = {
    adapter: job.adapter,
    provider: job.provider,
    sourceLabel: job.sourceLabel,
    sourceDigest,
    ...(job.conversationMode ? { conversationMode: job.conversationMode } : {}),
    conversations: conversations.length,
    projects: projectSummaries.length,
    messages: conversations.reduce((sum, item) => sum + item.messages.length, 0),
    historicalEvents: conversations.reduce((sum, item) => sum + item.events.length, 0),
    resources: conversations.reduce((sum, item) => sum + item.resources.length, 0),
    setupFiles: setup?.files.length || 0,
    mcpServers: setup?.mcpServers.length || 0,
    secretsRedacted: setup?.secretNotices.length || 0,
    conflicts: setup ? setup.mcpServers.filter((server) => getMCPManager().getConfigs().some((current) => current.id === server.id)).length : 0,
    warnings: [...warnings, ...projectBoundaryWarnings, ...(setup?.warnings || [])].slice(0, 200),
    conversationSummariesTotal: conversations.length,
    conversationSummariesTruncated: conversations.length > MAX_PREVIEW_CONVERSATIONS,
    conversationSummaries: conversationSummaries.map((item) => ({
      id: item.id,
      title: item.title,
      ...(item.project?.name ? { projectName: item.project.name } : {}),
      messages: item.messages.length,
      events: item.events.length,
      resources: item.resources.length,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    projectSummaries,
    ...(unsupportedReason ? { unsupported: true, unsupportedReason } : {}),
  };
  return preview;
}

function writeNormalized(job: ImportJob, value: unknown): void {
  const file = resolveConfinedStoragePath(job.stagedPath, 'normalized.json', { label: 'normalized import' });
  atomicWrite(file, value);
  job.normalizedPath = file;
}

function readNormalized(job: ImportJob): ImportedConversation[] {
  if (!job.normalizedPath) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(job.normalizedPath, 'utf8'));
    return Array.isArray(parsed?.conversations) ? parsed.conversations as ImportedConversation[] : [];
  } catch {
    return [];
  }
}

async function readZipAsset(job: ImportJob, resource: ImportedResource): Promise<Buffer | undefined> {
  if (!resource.relativePath?.startsWith('__zip__/')) return undefined;
  const zipFile = listStagedFiles(job.stagedPath).find((file) => file.relativePath.toLowerCase().endsWith('.zip'));
  if (!zipFile) return undefined;
  const entryName = resource.relativePath.slice('__zip__/'.length);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(zipFile.absolutePath), { checkCRC32: true, createFolders: false });
  const entry = zip.files[entryName];
  if (!entry || entry.dir) return undefined;
  const size = Number(entry._data?.uncompressedSize || 0);
  if (!Number.isFinite(size) || size > 100 * 1024 * 1024) throw new Error(`Imported asset is too large: ${entryName}`);
  return entry.async('nodebuffer');
}

function eventToProcessEntry(event: ImportedHistoricalEvent): Record<string, unknown> {
  const type = event.type === 'tool_call' ? 'tool' : event.type === 'tool_result' ? 'result' : event.type === 'reasoning' ? 'think' : 'info';
  const content = event.content || event.resultPreview || event.inputPreview || event.name || event.type;
  return {
    id: event.id,
    type,
    actor: event.provider || 'Imported source',
    content: String(content || '').slice(0, 60_000),
    text: String(content || '').slice(0, 60_000),
    ts: new Date(event.timestamp).toLocaleTimeString(),
    timestamp: event.timestamp,
    extra: {
      source: 'external_import',
      historicalOnly: true,
      executed: false,
      eventType: event.type,
      toolName: event.name,
      sourceEventId: event.sourceEventId,
    },
  };
}

function attachEventsToMessage(message: ImportedMessage, events: ImportedHistoricalEvent[]): ChatMessage {
  const relevant = [...(message.events || []), ...events.filter((event) => event.sourceMessageId && event.sourceMessageId === message.sourceMessageId)]
    .filter((event, index, list) => list.findIndex((other) => other.id === event.id) === index)
    .slice(0, 500);
  const historicalOnly = relevant.map(eventToProcessEntry);
  return {
    messageId: message.id,
    messageKind: 'imported_message',
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    channel: 'web',
    channelLabel: 'Imported history',
    origin: { channel: 'web', surface: 'external_import', device: 'server', label: message.provider || 'Imported source', source: message.provider },
    source: `external_import:${message.provider || 'unknown'}`,
    ...(message.model || message.provider ? { turnProviderUsage: { provider: message.provider, model: message.model, source: 'external_import', historicalOnly: true } } : {}),
    ...(message.reasoningSummary ? { reasoningSummary: message.reasoningSummary } : {}),
    ...(historicalOnly.length ? { processEntries: historicalOnly } : {}),
    ...(relevant.length ? { historicalEvents: relevant } : {}),
  } as ChatMessage;
}

function appendUnattachedEvents(history: ChatMessage[], events: ImportedHistoricalEvent[], provider: string): void {
  const attached = new Set<string>();
  for (const message of history) {
    for (const entry of Array.isArray((message as any).historicalEvents) ? (message as any).historicalEvents : []) {
      if (entry?.id) attached.add(String(entry.id));
    }
  }
  const remainder = events.filter((event) => !attached.has(event.id));
  if (!remainder.length) return;
  history.push({
    messageId: `msg_${stableImportId(provider, 'unattached-events', remainder.map((event) => event.id).join(','))}`,
    messageKind: 'imported_event',
    role: 'assistant',
    content: '[Historical activity from the source session]',
    timestamp: remainder[0].timestamp || Date.now(),
    channel: 'web',
    channelLabel: 'Imported history',
    origin: { channel: 'web', surface: 'external_import', device: 'server', label: provider, source: provider },
    source: `external_import:${provider}`,
    processEntries: remainder.slice(0, 500).map(eventToProcessEntry),
    historicalEvents: remainder.slice(0, 500),
  } as ChatMessage);
}

function importedProjectDedupeKey(job: ImportJob, reference: ImportedProjectReference): string {
  const source = reference.sourcePath || reference.sourceProjectId;
  return stableImportId(
    job.ownerId,
    path.resolve(job.workspacePath),
    job.provider,
    job.sourceAccountId || '',
    reference.sourceProjectId,
    source,
  );
}

function addUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) values.push(value);
}

function projectForReference(job: ImportJob, reference: ImportedProjectReference, result: ImportJobResult): Project | null {
  if (job.conversationMode !== 'projects') return null;
  const dedupeKey = importedProjectDedupeKey(job, reference);
  const existing = findProjectByExternalImportDedupeKey(dedupeKey);
  if (existing) {
    addUnique(result.projectIds, existing.id);
    return existing;
  }
  const linked = safeImportedWorkspacePath(reference);
  const binding = {
    version: 1 as const,
    jobId: job.id,
    dedupeKey,
    provider: job.provider,
    adapter: job.adapter,
    sourceLabel: job.sourceLabel.slice(0, 240),
    sourceProjectId: reference.sourceProjectId.slice(0, 300),
    ...(reference.sourcePath ? { sourcePath: reference.sourcePath.slice(0, 2_000) } : {}),
    importedAt: nowIso(),
    linkState: linked.state,
  };
  const project = createImportedProject(reference.name.slice(0, 200) || `${job.provider} project`, linked.path || '', binding);
  addUnique(result.projectIds, project.id);
  addUnique(result.createdProjectIds, project.id);
  return project;
}

function importedSessionIdForConversation(job: ImportJob, conversation: ImportedConversation): string {
  const source = {
    ...conversation.source,
    ...(job.sourceAccountId ? { sourceAccountId: job.sourceAccountId } : {}),
  };
  const sourceConversationId = String(source.sourceConversationId || conversation.id);
  const dedupeKey = stableImportId(job.ownerId, path.resolve(job.workspacePath), source.provider, source.sourceAccountId || '', sourceConversationId);
  const baseId = `import_${source.adapter.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${dedupeKey}`;
  const baseSessionId = baseId.slice(0, 180);
  if (!sessionExists(baseSessionId)) return baseSessionId;
  const existing = getSession(baseSessionId);
  if ((existing as any).externalImport?.dedupeKey === dedupeKey) return baseSessionId;
  return `${baseId.slice(0, 150)}_${stableImportId(job.id).slice(0, 16)}`;
}

function sessionForConversation(job: ImportJob, conversation: ImportedConversation, result: ImportJobResult): string {
  const source = {
    ...conversation.source,
    ...(job.sourceAccountId ? { sourceAccountId: job.sourceAccountId } : {}),
  };
  const sourceConversationId = String(source.sourceConversationId || conversation.id);
  const dedupeKey = stableImportId(job.ownerId, path.resolve(job.workspacePath), source.provider, source.sourceAccountId || '', sourceConversationId);
  const baseId = `import_${source.adapter.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${dedupeKey}`;
  let sessionId = baseId.slice(0, 180);
  if (sessionExists(sessionId)) {
    const existing = getSession(sessionId);
    if ((existing as any).externalImport?.dedupeKey === dedupeKey) {
      result.skipped += 1;
      result.sessionIds.push(sessionId);
      return '';
    }
    sessionId = `${baseId.slice(0, 150)}_${stableImportId(job.id).slice(0, 16)}`;
  }
  const session = getSession(sessionId);
  const history: ChatMessage[] = conversation.messages.map((message) => attachEventsToMessage(message, conversation.events));
  appendUnattachedEvents(history, conversation.events, conversation.source.provider);
  const importedAt = nowIso();
  const binding: ExternalImportBinding = {
    version: 1,
    jobId: job.id,
    dedupeKey,
    source,
    continuation: 'prometheus',
    sourceResume: 'unsupported',
    importedMessageCount: conversation.messages.length,
    importedEventCount: conversation.events.length,
    importedResourceCount: conversation.resources.length,
    importedAt,
  };
  session.history = history.slice(0, 100_000);
  session.workspace = job.workspacePath;
  session.channel = 'web';
  session.title = conversation.title.slice(0, 200);
  session.autoTitleLocked = true;
  session.externalImport = binding as any;
  const timestamps = history.map((message) => Number(message.timestamp)).filter((value) => Number.isFinite(value) && value > 0);
  session.createdAt = timestamps.length ? Math.min(...timestamps) : Date.now();
  session.lastActiveAt = timestamps.length ? Math.max(...timestamps) : Date.now();
  session.lastAssistantAt = Math.max(...history.filter((message) => message.role === 'assistant').map((message) => Number(message.timestamp) || 0), 0) || undefined;
  session.userTurnCounter = history.filter((message) => message.role === 'user').length;
  flushSession(sessionId);
  result.sessionIds.push(sessionId);
  return sessionId;
}

async function attachConversationResources(job: ImportJob, conversation: ImportedConversation, sessionId: string, result: ImportJobResult): Promise<void> {
  if (!conversation.resources.length) return;
  const store = getResourceStore(job.workspacePath);
  for (const resource of conversation.resources.slice(0, 2_000)) {
    const bytes = await readZipAsset(job, resource);
    const text = resource.text;
    const locator = resource.url
      ? { type: 'url' as const, url: resource.url, canonical: resource.url }
      : { type: 'artifact' as const, canonical: `external:${conversation.source.adapter}:${conversation.source.sourceConversationId || conversation.id}:${resource.id}` };
    const attached = store.attach({
      threadId: sessionId,
      kind: resource.kind,
      title: resource.title,
      mimeType: resource.mimeType,
      origin: 'external_import',
      locator,
      content: bytes || text,
      snapshotKind: bytes ? 'binary' : text !== undefined ? 'text' : 'metadata',
      metadata: { ...(resource.metadata || {}), externalImportJobId: job.id, sourceConversationId: conversation.source.sourceConversationId || conversation.id },
      actor: 'external_import',
      sensitive: resource.sensitive === true,
    });
    result.resourceIds.push(attached.resource.id);
    if (attached.created) result.createdResourceIds.push(attached.resource.id);
  }
}

function ensureResult(job: ImportJob): ImportJobResult {
  const current = job.result || ({} as ImportJobResult);
  return {
    sessionIds: Array.isArray(current.sessionIds) ? current.sessionIds : [],
    projectIds: Array.isArray(current.projectIds) ? current.projectIds : [],
    createdProjectIds: Array.isArray(current.createdProjectIds) ? current.createdProjectIds : [],
    resourceIds: Array.isArray(current.resourceIds) ? current.resourceIds : [],
    createdResourceIds: Array.isArray(current.createdResourceIds) ? current.createdResourceIds : [],
    mcpServerIds: Array.isArray(current.mcpServerIds) ? current.mcpServerIds : [],
    skipped: Number(current.skipped || 0),
    conflicts: Number(current.conflicts || 0),
    failures: Array.isArray(current.failures) ? current.failures : [],
    ...(current.setupSnapshotPath ? { setupSnapshotPath: current.setupSnapshotPath } : {}),
    ...(current.rolledBackAt ? { rolledBackAt: current.rolledBackAt } : {}),
  };
}

function markResult(job: ImportJob, result: ImportJobResult): void {
  job.result = result;
  persistJob(job);
}

async function commitConversationJob(job: ImportJob): Promise<ImportJob> {
  const allConversations = readNormalized(job);
  const conversations = Array.isArray(job.selectedConversationIds)
    ? allConversations.filter((conversation) => job.selectedConversationIds!.includes(conversation.id))
    : allConversations;
  const result = ensureResult(job);
  if (Array.isArray(job.selectedConversationIds) && !conversations.length) {
    throw new Error('No selected conversations remain in this import preview. Select at least one chat and try again.');
  }
  const total = conversations.length;
  for (let index = 0; index < conversations.length; index += 1) {
    const conversation = conversations[index];
    progress(job, 'committing', index, total, `Importing ${conversation.title}`, conversation.id);
    try {
      const project = conversation.project ? projectForReference(job, conversation.project, result) : null;
      const expectedSessionId = project ? importedSessionIdForConversation(job, conversation) : '';
      const sessionId = sessionForConversation(job, conversation, result);
      if (sessionId) await attachConversationResources(job, conversation, sessionId, result);
      if (project && (sessionId || expectedSessionId)) {
        addSessionToProject(project.id, sessionId || expectedSessionId, conversation.title.slice(0, 200));
      }
    } catch (error: any) {
      result.failures.push(`${conversation.title}: ${error?.message || 'commit failed'}`);
    }
    markResult(job, result);
  }
  if (result.sessionIds.length) {
    // Imported threads are intentionally surfaced at the top of the normal
    // Prometheus sidebar. A retry is safe and also restores that placement
    // without creating duplicate sessions.
    reorderSessionSidebar(result.sessionIds, { channel: 'web', state: 'all' });
  }
  const complete = result.failures.length === 0;
  job.status = complete ? 'completed' : (result.sessionIds.length || result.resourceIds.length ? 'partial' : 'failed');
  job.progress = { phase: job.status, completed: total, total, message: complete ? 'Import completed.' : 'Import completed with failures.', checkpoint: job.checkpoint };
  persistJob(job);
  if (complete) cleanupStaging(job);
  return job;
}

function setupSnapshotFile(job: ImportJob, setup: ImportedSetup): string {
  const root = setupSnapshotRoot(job.id);
  fs.mkdirSync(root, { recursive: true });
  atomicWrite(path.join(root, 'manifest.json'), setup);
  const stagedFiles = listStagedFiles(job.stagedPath);
  for (const item of setup.files) {
    if (!['memory', 'skill', 'agent_instructions', 'permissions', 'connector', 'config'].includes(item.category)) continue;
    const source = stagedFiles.find((file) => file.relativePath === item.relativePath);
    if (!source || source.size > IMPORT_MAX_TEXT_BYTES) continue;
    if (!/\.(json|jsonl|ya?ml|toml|env|md|txt|ini|cfg)$/i.test(item.relativePath)) continue;
    const destination = resolveConfinedStoragePath(root, item.relativePath, { label: 'setup snapshot file' });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, scrubSecrets(fs.readFileSync(source.absolutePath, 'utf8')), 'utf8');
  }
  return path.relative(getConfig().getConfigDir(), root);
}

async function commitSetupJob(job: ImportJob): Promise<ImportJob> {
  const setup = job.setup;
  if (!setup) throw new Error('Setup import preview is missing.');
  const result = ensureResult(job);
  const mcp = getMCPManager();
  const configPath = path.join(getConfig().getConfigDir(), 'mcp-servers.json');
  const backup = backupRoot(job.id);
  fs.mkdirSync(backup, { recursive: true });
  const backupPath = path.join(backup, 'mcp-servers.json');
  if (fs.existsSync(configPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(configPath, backupPath);
    job.backupPath = backupPath;
  }
  for (let index = 0; index < setup.mcpServers.length; index += 1) {
    const server = setup.mcpServers[index];
    progress(job, 'committing', index, setup.mcpServers.length || 1, `Reviewing MCP server ${server.id}`, server.id);
    const existing = mcp.getConfigs().find((item) => item.id === server.id);
    // Re-check the live config at commit time. A server may have been added
    // after preview, so the default conflict policy must remain skip even when
    // the preview originally reported zero conflicts.
    if (existing && !job.overwrite) {
      result.conflicts += 1;
      continue;
    }
    try {
      const normalized = MCPManager.normalizeConfig({ ...(server.config as any), enabled: false }, server.id);
      if (!normalized) throw new Error('unsupported MCP configuration');
      mcp.upsertConfig({ ...normalized, enabled: false });
      result.mcpServerIds.push(normalized.id);
    } catch (error: any) {
      result.failures.push(`MCP ${server.id}: ${error?.message || 'not imported'}`);
    }
    markResult(job, result);
  }
  result.setupSnapshotPath = setupSnapshotFile(job, setup);
  job.result = result;
  job.status = result.failures.length ? 'partial' : 'completed';
  job.progress = { phase: job.status, completed: setup.mcpServers.length, total: setup.mcpServers.length, message: result.failures.length ? 'Setup import completed with failures.' : 'Setup import completed.' };
  persistJob(job);
  if (!result.failures.length) cleanupStaging(job);
  return job;
}

async function parseStagedJob(job: ImportJob): Promise<void> {
  progress(job, 'parsing', 0, 1, 'Parsing staged source.');
  const context = adapterContext(job);
  if (job.kind === 'conversation') {
    const parsed = await parseConversationImport(context);
    job.adapter = parsed.adapter;
    job.provider = parsed.provider;
    writeNormalized(job, { conversations: parsed.conversations });
    job.preview = buildPreview(job, parsed.conversations, undefined, parsed.warnings, parsed.unsupportedReason);
    if (parsed.unsupportedReason) {
      job.status = 'failed';
      job.error = parsed.unsupportedReason;
    } else {
      job.status = 'preview_ready';
      job.error = undefined;
    }
  } else {
    const parsed = parseSetupImport(context);
    job.adapter = parsed.adapter;
    job.provider = parsed.provider;
    job.setup = parsed.setup;
    job.preview = buildPreview(job, [], parsed.setup, parsed.setup.warnings);
    job.status = 'preview_ready';
    job.error = undefined;
  }
  job.progress = { phase: job.status, completed: 1, total: 1, message: job.status === 'failed' ? job.error : 'Preview ready; explicit confirmation is required.' };
  persistJob(job);
}

export async function createImportJob(input: CreateImportJobInput): Promise<{ job: ImportJob; idempotent: boolean }> {
  const ownerId = String(input.ownerId || 'local').trim().slice(0, 200) || 'local';
  const workspacePath = path.resolve(input.workspacePath || getConfig().getWorkspacePath());
  if (input.kind !== 'conversation' && input.kind !== 'setup') throw new Error('Import kind must be conversation or setup.');
  const id = `imp_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
  const staged = stageInput({ ...input, ownerId, workspacePath }, id);
  const sourceAccountId = String(input.sourceAccountId || '').trim().slice(0, 240);
  const existing = listInternalJobs(ownerId).find((job) => job.kind === input.kind
    && job.workspacePath === workspacePath
    && (input.kind !== 'conversation' || (job.conversationMode || 'sessions') === (input.conversationMode || 'sessions'))
    && job.sourceDigest === staged.inputDigest
    && String(job.sourceAccountId || '') === sourceAccountId
    && !['deleted', 'rolled_back'].includes(job.status));
  if (existing) {
    fs.rmSync(stagingRoot(id), { recursive: true, force: true });
    return { job: publicJob(existing), idempotent: true };
  }
  const initialAdapter = input.requestedAdapter || (input.kind === 'setup' ? 'setup-config' : 'unsupported');
  const job: ImportJob = {
    schemaVersion: IMPORT_SCHEMA_VERSION,
    id,
    ownerId,
    workspacePath,
    kind: input.kind,
    ...(input.kind === 'conversation' ? { conversationMode: input.conversationMode || 'sessions' } : {}),
    status: 'staging',
    adapter: initialAdapter,
    provider: 'generic',
    sourceLabel: staged.sourceLabel,
    sourceDigest: staged.inputDigest,
    stagedPath: staged.stagedPath,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    progress: { phase: 'staging', completed: 0, total: 1, message: 'Source staged in quarantine.' },
    sourcePathProvided: staged.sourcePathProvided,
    ...(sourceAccountId ? { sourceAccountId } : {}),
  };
  job.overwrite = input.overwrite === true;
  persistJob(job);
  try {
    await parseStagedJob(job);
  } catch (error: any) {
    job.status = 'failed';
    job.error = error?.message || 'Import parsing failed.';
    job.progress = { phase: 'failed', completed: 0, total: 1, message: job.error };
    persistJob(job);
  }
  return { job: publicJob(job), idempotent: false };
}

export function listImportJobs(ownerId: string): ImportJob[] {
  return listInternalJobs(ownerId).map(publicJob);
}

export function getImportJob(id: string, ownerId: string): ImportJob | null {
  const job = readJob(safeJobId(id));
  if (!job || job.ownerId !== ownerId) return null;
  return publicJob(job);
}

function getOwnedJob(id: string, ownerId: string): ImportJob {
  const job = readJob(safeJobId(id));
  if (!job || job.ownerId !== ownerId) throw new Error('Import job not found.');
  return job;
}

export async function confirmImportJob(id: string, ownerId: string, selectedConversationIds?: string[]): Promise<ImportJob> {
  const job = getOwnedJob(id, ownerId);
  if (job.status === 'completed') return publicJob(job);
  if (job.status === 'rolled_back' || job.status === 'deleted') throw new Error('Import job is no longer active.');
  if (job.preview?.unsupported) throw new Error(job.preview.unsupportedReason || 'This import source is unsupported.');
  if (!['preview_ready', 'partial', 'failed'].includes(job.status)) throw new Error(`Import job is ${job.status}; it cannot be confirmed.`);
  if (job.kind === 'conversation' && selectedConversationIds === undefined && !Array.isArray(job.selectedConversationIds)) {
    throw new Error('Explicit chat selection is required before confirming this import.');
  }
  if (job.kind === 'conversation' && selectedConversationIds !== undefined) {
    const normalized = [...new Set(selectedConversationIds
      .map((value) => String(value || '').trim())
      .filter(Boolean))].slice(0, MAX_SELECTED_CONVERSATIONS);
    if (!normalized.length) throw new Error('Select at least one chat before confirming this import.');
    const available = new Set(readNormalized(job).map((conversation) => conversation.id));
    const unknown = normalized.filter((conversationId) => !available.has(conversationId));
    if (unknown.length) throw new Error('The preview changed and one or more selected chats are no longer available. Rebuild the preview.');
    job.selectedConversationIds = normalized;
    persistJob(job);
  }
  if (job.kind === 'conversation') return publicJob(await commitConversationJob(job));
  return publicJob(await commitSetupJob(job));
}

export async function retryImportJob(id: string, ownerId: string): Promise<ImportJob> {
  const job = getOwnedJob(id, ownerId);
  if (!['partial', 'failed'].includes(job.status)) throw new Error('Only partial or failed imports can be retried.');
  if (job.preview?.unsupported) return publicJob(job);
  if (!job.preview || (job.kind === 'conversation' && !job.normalizedPath) || (job.kind === 'setup' && !job.setup)) {
    job.error = undefined;
    job.status = 'parsing';
    persistJob(job);
    try {
      await parseStagedJob(job);
    } catch (error: any) {
      job.status = 'failed';
      job.error = error?.message || 'Import parsing failed.';
      job.progress = { phase: 'failed', completed: 0, total: 1, message: job.error };
      persistJob(job);
      return publicJob(job);
    }
    if (String(job.status) === 'failed') return publicJob(job);
  }
  job.status = 'preview_ready';
  job.error = undefined;
  persistJob(job);
  return confirmImportJob(id, ownerId);
}

export function rollbackImportJob(id: string, ownerId: string): ImportJob {
  const job = getOwnedJob(id, ownerId);
  if (job.status === 'deleted') throw new Error('Import job is no longer active.');
  if (job.status === 'rolled_back') return publicJob(job);
  const result = ensureResult(job);
  const removedSessions: string[] = [];
  for (const sessionId of [...new Set(result.sessionIds)]) {
    try {
      if (!sessionExists(sessionId)) continue;
      const session = getSession(sessionId);
      if ((session as any).externalImport?.jobId !== job.id) continue;
      if (deleteSession(sessionId)) removedSessions.push(sessionId);
    } catch { /* retain a tombstone and continue other rollback items */ }
  }
  for (const resourceId of [...new Set(result.createdResourceIds)]) {
    try {
      const store = getResourceStore(job.workspacePath);
      for (const sessionId of result.sessionIds) {
        try { store.deleteResourceForThread(sessionId, resourceId, 'external_import_rollback'); break; } catch { /* try next thread */ }
      }
    } catch { /* best effort; resource tombstones remain in the store */ }
  }
  const removedProjects: string[] = [];
  for (const projectId of [...new Set(result.createdProjectIds)]) {
    try {
      const project = getProject(projectId);
      if (project?.externalImport?.jobId !== job.id) continue;
      if (deleteProject(projectId)) removedProjects.push(projectId);
    } catch { /* retain project tombstone metadata and continue rollback */ }
  }
  if (job.kind === 'setup') {
    const configPath = path.join(getConfig().getConfigDir(), 'mcp-servers.json');
    if (job.backupPath && fs.existsSync(job.backupPath)) {
      fs.copyFileSync(job.backupPath, configPath);
      getMCPManager().load();
    } else {
      const manager = getMCPManager();
      for (const idToDelete of result.mcpServerIds) {
        try { manager.deleteConfig(idToDelete); } catch { /* continue */ }
      }
      // Keep the long-lived manager aligned with the durable file even when a
      // host has loaded more than one gateway module instance during restart.
      try { manager.load(); } catch { /* durable deletion already completed */ }
    }
  }
  result.sessionIds = removedSessions;
  result.rolledBackAt = nowIso();
  job.result = result;
  job.status = 'rolled_back';
  job.progress = { phase: 'rolled_back', completed: 1, total: 1, message: 'Imported data was rolled back and tombstoned.' };
  persistJob(job);
  cleanupStaging(job);
  atomicWrite(tombstonePath(job.id), {
    schemaVersion: 1,
    jobId: job.id,
    ownerId: job.ownerId,
    rolledBackAt: result.rolledBackAt,
    sessions: removedSessions,
    projects: removedProjects,
    resources: result.createdResourceIds,
    mcpServers: result.mcpServerIds,
  });
  return publicJob(job);
}

export function deleteImportJob(id: string, ownerId: string): boolean {
  const job = getOwnedJob(id, ownerId);
  if (['completed', 'partial'].includes(job.status)) throw new Error('Roll back the import before deleting its job record.');
  try { fs.rmSync(stagingRoot(job.id), { recursive: true, force: true }); } catch { /* best effort */ }
  if (job.status !== 'rolled_back') {
    job.status = 'deleted';
    job.progress = { phase: 'deleted', completed: 1, total: 1, message: 'Import job deleted.' };
    persistJob(job);
  } else {
    job.status = 'deleted';
    persistJob(job);
  }
  return true;
}
