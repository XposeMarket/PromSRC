import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { MCPManager } from '../mcp-manager';
import {
  type ImportAdapterId,
  type ImportedConversation,
  type ImportedHistoricalEvent,
  type ImportedMessage,
  type ImportedMcpServer,
  type ImportedProjectReference,
  type ImportedResource,
  type ImportedSetup,
  type ImportedSetupFile,
  type ImportSourceIdentity,
  type SetupSecretNotice,
  type SetupImportScope,
} from './import-types';

export const IMPORT_MAX_FILES = 8_000;
export const IMPORT_MAX_INPUT_BYTES = 250 * 1024 * 1024;
export const IMPORT_MAX_TEXT_BYTES = 12 * 1024 * 1024;
export const IMPORT_MAX_MESSAGES = 100_000;
export const IMPORT_MAX_EVENTS = 100_000;
export const IMPORT_MAX_RESOURCES = 2_000;
export const IMPORT_MAX_ZIP_ENTRIES = 5_000;
export const IMPORT_MAX_ZIP_BYTES = 250 * 1024 * 1024;

export interface StagedFile {
  relativePath: string;
  absolutePath: string;
  size: number;
}

export interface AdapterContext {
  stagedPath: string;
  files: StagedFile[];
  sourceLabel: string;
  inputDigest: string;
  requestedAdapter?: ImportAdapterId;
  setupScope?: SetupImportScope;
}

export interface ConversationAdapterResult {
  adapter: ImportAdapterId;
  provider: string;
  conversations: ImportedConversation[];
  warnings: string[];
  unsupportedReason?: string;
}

export interface SetupAdapterResult {
  adapter: ImportAdapterId;
  provider: string;
  setup: ImportedSetup;
}

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableImportId(...parts: unknown[]): string {
  return digest(parts.map((value) => String(value ?? '')).join('\u001f')).slice(0, 32);
}

function safeRelativePath(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) {
    throw new Error('Unsafe import path.');
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '..')) throw new Error('Unsafe import path.');
  return segments.join('/');
}

export function listStagedFiles(root: string): StagedFile[] {
  const out: StagedFile[] = [];
  const walk = (current: string, relative: string) => {
    if (out.length > IMPORT_MAX_FILES) throw new Error(`Import contains more than ${IMPORT_MAX_FILES} files.`);
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const next = path.join(current, entry.name);
      const stat = fs.lstatSync(next);
      // Quarantined imports never follow links or inspect device files.
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(next, safeRelativePath(nextRelative));
        continue;
      }
      const safe = safeRelativePath(nextRelative);
      out.push({ relativePath: safe, absolutePath: next, size: stat.size });
    }
  };
  walk(path.resolve(root), '');
  const bytes = out.reduce((sum, item) => sum + item.size, 0);
  if (bytes > IMPORT_MAX_INPUT_BYTES) {
    throw new Error(`Import exceeds the ${Math.round(IMPORT_MAX_INPUT_BYTES / 1024 / 1024)} MiB safety limit.`);
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function readText(file: StagedFile, maxBytes = IMPORT_MAX_TEXT_BYTES): string {
  if (file.size > maxBytes) throw new Error(`Import file is too large: ${file.relativePath}`);
  return fs.readFileSync(file.absolutePath, 'utf8');
}

function parseJsonText(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch (error: any) {
    throw new Error(`Invalid JSON in ${label}: ${error?.message || 'parse failed'}`);
  }
}

function cleanText(value: unknown, max = 600_000): string {
  if (typeof value === 'string') return value.slice(0, max);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => cleanText(item, max)).filter(Boolean).join('\n').slice(0, max);
  if (value && typeof value === 'object') {
    const candidate = value as any;
    for (const key of ['text', 'content', 'value', 'output', 'result', 'message', 'parts']) {
      if (candidate[key] !== undefined) {
        const result = cleanText(candidate[key], max);
        if (result) return result;
      }
    }
    try { return JSON.stringify(value).slice(0, max); } catch { return ''; }
  }
  return '';
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number < 10_000_000_000 ? Math.floor(number * 1000) : Math.floor(number);
  return fallback;
}

function normalizeRole(value: unknown): 'user' | 'assistant' | 'system' | 'tool' | null {
  const raw = value && typeof value === 'object'
    ? firstValue(value as any, ['role', 'type', 'kind', 'name', 'value'])
    : value;
  const role = String(raw || '').trim().toLowerCase();
  if (['user', 'human', 'client', 'prompt', 'customer'].includes(role)) return 'user';
  if (['assistant', 'ai', 'model', 'claude', 'chatgpt', 'grok', 'codex', 'bot'].includes(role)) return 'assistant';
  if (['system', 'developer'].includes(role)) return 'system';
  if (['tool', 'function', 'tool_call', 'tool_result', 'function_call'].includes(role)) return 'tool';
  return null;
}

function firstValue(raw: any, keys: string[]): unknown {
  for (const key of keys) {
    if (raw?.[key] !== undefined && raw?.[key] !== null) return raw[key];
  }
  return undefined;
}

function extractSourceMessageId(raw: any): string | undefined {
  const value = firstValue(raw, ['id', 'message_id', 'messageId', 'uuid', 'key', 'node_id', 'nodeId']);
  const text = String(value || '').trim();
  return text ? text.slice(0, 300) : undefined;
}

function extractContent(raw: any): string {
  const value = firstValue(raw, ['content', 'text', 'value', 'message', 'parts', 'body', 'output', 'response']);
  return cleanText(value);
}

function eventType(value: unknown): ImportedHistoricalEvent['type'] {
  const type = String(value || '').toLowerCase();
  if (type.includes('tool') && (type.includes('result') || type.includes('output'))) return 'tool_result';
  if (type.includes('tool') || type.includes('function') || type.includes('command')) return 'tool_call';
  if (type.includes('reason') || type.includes('thinking') || type === 'think') return 'reasoning';
  if (type.includes('browser') || type.includes('web')) return 'browser';
  if (type.includes('artifact') || type.includes('file')) return 'artifact';
  if (type.includes('subagent') || type.includes('delegate')) return 'subagent';
  if (type.includes('system') || type.includes('developer')) return 'system';
  return 'status';
}

function makeEvent(raw: any, context: { conversationId: string; index: number; timestamp: number; sourceMessageId?: string; provider: string }): ImportedHistoricalEvent {
  const metadata = raw?.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined;
  const name = String(firstValue(raw, ['name', 'tool_name', 'toolName', 'function', 'command']) || '').trim();
  const input = firstValue(raw, ['arguments', 'args', 'input', 'parameters', 'request', 'query']);
  const result = firstValue(raw, ['result', 'output', 'response', 'error', 'observation']);
  const type = eventType(firstValue(raw, ['type', 'kind', 'event', 'role', 'status']));
  return {
    id: `evt_${stableImportId(context.provider, context.conversationId, context.sourceMessageId || '', context.index, type, name)}`,
    type,
    timestamp: context.timestamp,
    ...(name ? { name: name.slice(0, 240) } : {}),
    ...(input !== undefined ? { inputPreview: cleanText(input, 20_000) } : {}),
    ...(result !== undefined ? { resultPreview: cleanText(result, 60_000) } : {}),
    ...(extractContent(raw) ? { content: extractContent(raw).slice(0, 60_000) } : {}),
    ...(context.sourceMessageId ? { sourceMessageId: context.sourceMessageId } : {}),
    sourceEventId: extractSourceMessageId(raw),
    provider: context.provider,
    historicalOnly: true,
    metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
  };
}

function eventsFromRaw(raw: any, context: { conversationId: string; index: number; timestamp: number; sourceMessageId?: string; provider: string }): ImportedHistoricalEvent[] {
  const out: ImportedHistoricalEvent[] = [];
  const candidates = [
    ...(Array.isArray(raw?.events) ? raw.events : []),
    ...(Array.isArray(raw?.tool_calls) ? raw.tool_calls : []),
    ...(Array.isArray(raw?.toolCalls) ? raw.toolCalls : []),
    ...(Array.isArray(raw?.tool_results) ? raw.tool_results : []),
    ...(Array.isArray(raw?.toolResults) ? raw.toolResults : []),
  ];
  if (raw?.tool_call || raw?.toolCall || raw?.tool_result || raw?.toolResult) {
    candidates.push(raw.tool_call || raw.toolCall || raw.tool_result || raw.toolResult);
  }
  for (const candidate of candidates.slice(0, 500)) {
    out.push(makeEvent(candidate, context));
  }
  const contentBlocks = Array.isArray(raw?.content) ? raw.content : Array.isArray(raw?.message?.content) ? raw.message.content : [];
  for (const block of contentBlocks.slice(0, 500)) {
    const blockType = String(block?.type || block?.kind || '').toLowerCase();
    if (block && typeof block === 'object' && (blockType.includes('tool') || blockType.includes('thinking') || blockType.includes('reason'))) {
      out.push(makeEvent({ ...block, content: block.text || block.content || block.input || block.output }, context));
    }
  }
  return out;
}

function makeMessage(raw: any, context: { conversationId: string; index: number; fallbackTimestamp: number; provider: string }): { message?: ImportedMessage; events: ImportedHistoricalEvent[] } {
  const nested = raw?.message && typeof raw.message === 'object' ? { ...raw.message, ...raw } : raw;
  const role = normalizeRole(firstValue(nested, ['role', 'author_role', 'authorRole', 'speaker', 'sender', 'type']));
  const sourceMessageId = extractSourceMessageId(nested);
  const timestamp = normalizeTimestamp(firstValue(nested, ['timestamp', 'created_at', 'createdAt', 'create_time', 'updated_at', 'time']), context.fallbackTimestamp);
  const events = eventsFromRaw(nested, {
    conversationId: context.conversationId,
    index: context.index,
    timestamp,
    sourceMessageId,
    provider: context.provider,
  });
  const content = extractContent(nested).trim();
  const model = String(firstValue(nested, ['model', 'model_name', 'modelName']) || '').trim();
  const reasoningSummary = cleanText(firstValue(nested, ['reasoning_summary', 'reasoningSummary', 'thinking', 'analysis']), 40_000).trim();
  if (role === 'tool') {
    if (!events.length) events.push(makeEvent({ type: 'tool_result', content }, { conversationId: context.conversationId, index: context.index, timestamp, sourceMessageId, provider: context.provider }));
    return { events };
  }
  if (role === 'system') {
    if (content) events.push(makeEvent({ type: 'system', content }, { conversationId: context.conversationId, index: context.index, timestamp, sourceMessageId, provider: context.provider }));
    return { events };
  }
  if (!role || !content) return { events };
  const message: ImportedMessage = {
    id: `msg_${stableImportId(context.provider, context.conversationId, sourceMessageId || '', context.index, role, content.slice(0, 120))}`,
    role,
    content: content.slice(0, 600_000),
    timestamp,
    ...(sourceMessageId ? { sourceMessageId } : {}),
    ...(model ? { model, provider: context.provider } : { provider: context.provider }),
    ...(reasoningSummary ? { reasoningSummary } : {}),
    ...(events.length ? { events } : {}),
  };
  return { message, events };
}

function baseSource(context: AdapterContext, adapter: ImportAdapterId, provider: string, conversationId?: string, file?: string): ImportSourceIdentity {
  return {
    provider,
    adapter,
    sourceLabel: context.sourceLabel.slice(0, 240),
    ...(conversationId ? { sourceConversationId: conversationId.slice(0, 300) } : {}),
    ...(file ? { sourceFile: file.slice(0, 500) } : {}),
    inputDigest: context.inputDigest,
    importedAt: new Date().toISOString(),
  };
}

function projectPathValue(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.includes('\0') || raw.length > 1_000) return undefined;
  if (!path.isAbsolute(raw) && !path.win32.isAbsolute(raw)) return undefined;
  return raw;
}

function projectReferenceFromRecords(
  records: any[],
  context: AdapterContext,
  adapter: ImportAdapterId,
  provider: string,
  file: string,
): ImportedProjectReference | undefined {
  let sourcePath = '';
  let projectName = '';
  for (const record of records.slice(0, 200)) {
    if (!record || typeof record !== 'object') continue;
    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
    const pathCandidate = [
      record.cwd,
      record.workingDirectory,
      record.workspacePath,
      record.projectPath,
      record.rootPath,
      record.workspace,
      metadata.cwd,
      metadata.workingDirectory,
      metadata.workspacePath,
      metadata.projectPath,
      payload.cwd,
      payload.workingDirectory,
      payload.workspacePath,
      payload.projectPath,
    ].map(projectPathValue).find(Boolean);
    if (!sourcePath && pathCandidate) sourcePath = pathCandidate;
    if (!projectName) {
      projectName = String(
        record.projectName
        || record.workspaceName
        || (typeof record.project === 'string' ? record.project : '')
        || metadata.projectName
        || metadata.workspaceName
        || '',
      ).trim().slice(0, 200);
    }
    if (sourcePath && projectName) break;
  }

  // Claude Code's project folder is itself a stable project boundary even
  // when a particular transcript has no cwd-bearing record near its start.
  const relativeSegments = file.replace(/\\/g, '/').split('/').filter(Boolean);
  const sourceProjectKey = sourcePath
    || (adapter === 'claude-code-local' && relativeSegments.length > 1 ? relativeSegments[0] : '')
    || projectName;
  if (!sourceProjectKey) return undefined;

  if (!projectName) {
    projectName = sourcePath
      ? (path.basename(sourcePath) || path.win32.basename(sourcePath))
      : sourceProjectKey.replace(/^project[-_]?/i, '').replace(/[-_]+/g, ' ');
  }
  projectName = projectName.trim().slice(0, 200) || `${provider} project`;
  const sourceProjectId = `source_${stableImportId(provider, sourceProjectKey).slice(0, 28)}`;
  return {
    sourceProjectId,
    name: projectName,
    ...(sourcePath ? { sourcePath, workspacePath: sourcePath } : {}),
    metadata: {
      provider,
      adapter,
      sourceProjectKey: sourceProjectKey.slice(0, 500),
      sourceFile: file.slice(0, 500),
      sourceLabel: context.sourceLabel.slice(0, 240),
    },
  };
}

function conversationFromRecords(records: any[], context: AdapterContext, options: { id: string; title?: string; provider: string; adapter: ImportAdapterId; file?: string; project?: ImportedProjectReference }): ImportedConversation {
  const id = String(options.id || `conversation_${stableImportId(context.inputDigest, options.file || '', options.title || '')}`).slice(0, 300);
  const fallback = Date.now();
  const messages: ImportedMessage[] = [];
  const events: ImportedHistoricalEvent[] = [];
  for (let index = 0; index < records.length && messages.length + events.length < IMPORT_MAX_MESSAGES + IMPORT_MAX_EVENTS; index += 1) {
    const parsed = makeMessage(records[index], { conversationId: id, index, fallbackTimestamp: fallback + index, provider: options.provider });
    if (parsed.message) messages.push(parsed.message);
    events.push(...parsed.events.slice(0, 500));
  }
  messages.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  events.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  const allTimes = [...messages.map((m) => m.timestamp), ...events.map((e) => e.timestamp)].filter((value) => Number.isFinite(value));
  const createdAt = allTimes.length ? Math.min(...allTimes) : fallback;
  const updatedAt = allTimes.length ? Math.max(...allTimes) : createdAt;
  const title = String(options.title || '').trim().slice(0, 200) || `${options.provider} import`;
  return {
    id,
    title,
    createdAt,
    updatedAt,
    source: baseSource(context, options.adapter, options.provider, id, options.file),
    messages,
    events,
    resources: [],
    ...(options.project ? { project: options.project } : {}),
  };
}

function recordsFromConversationObject(raw: any): any[] {
  if (Array.isArray(raw?.messages)) return raw.messages;
  if (Array.isArray(raw?.history)) return raw.history;
  if (Array.isArray(raw?.turns)) return raw.turns;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.chat)) return raw.chat;
  if (raw?.role || raw?.content || raw?.text) return [raw];
  return [];
}

function parseChatGptConversation(raw: any, context: AdapterContext, file = 'conversations.json', index = 0): ImportedConversation {
  const id = String(raw?.conversation_id || raw?.id || raw?.uuid || `chatgpt_${index}`);
  const title = String(raw?.title || 'ChatGPT conversation');
  const records: any[] = [];
  const mapping = raw?.mapping && typeof raw.mapping === 'object' ? raw.mapping : null;
  if (mapping) {
    const nodes = Object.entries(mapping).map(([key, value]: [string, any]) => ({ key, ...(value || {}) }));
    nodes.sort((a, b) => normalizeTimestamp(a.message?.create_time || a.created_at, index) - normalizeTimestamp(b.message?.create_time || b.created_at, index));
    for (const node of nodes) {
      const message = node.message;
      if (!message) continue;
      const content = message.content && typeof message.content === 'object'
        ? { ...message.content, content: message.content.parts || message.content.text || message.content }
        : message.content;
      records.push({
        ...message,
        id: message.id || node.key,
        role: message.author?.role || message.role,
        content,
        create_time: message.create_time,
        model: message.metadata?.model_slug || message.metadata?.model,
        metadata: message.metadata,
      });
    }
  } else {
    records.push(...recordsFromConversationObject(raw));
  }
  const conversation = conversationFromRecords(records, context, { id, title, provider: 'chatgpt', adapter: 'chatgpt-export', file });
  const metadata = raw?.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined;
  conversation.metadata = metadata ? JSON.parse(JSON.stringify(metadata)) : undefined;
  return conversation;
}

function parseJsonRoot(root: any, context: AdapterContext, adapter: ImportAdapterId, provider: string, file: string): ImportedConversation[] {
  const rawConversations = Array.isArray(root)
    ? root
    : Array.isArray(root?.conversations)
      ? root.conversations
      : Array.isArray(root?.sessions)
        ? root.sessions
        : Array.isArray(root?.threads)
          ? root.threads
          : [root];
  return rawConversations
    .slice(0, 20_000)
    .map((raw: any, index: number) => {
      const id = String(firstValue(raw, ['conversation_id', 'conversationId', 'session_id', 'sessionId', 'thread_id', 'threadId', 'id', 'uuid']) || `${path.basename(file)}_${index}`);
      const title = String(firstValue(raw, ['title', 'name', 'subject']) || `${provider} conversation`);
      const records = recordsFromConversationObject(raw);
      return conversationFromRecords(records, context, {
        id,
        title,
        provider,
        adapter,
        file,
        project: projectReferenceFromRecords([raw, ...records], context, adapter, provider, file),
      });
    })
    .filter((conversation: ImportedConversation) => conversation.messages.length || conversation.events.length);
}

function parseJsonlFile(file: StagedFile, context: AdapterContext, adapter: ImportAdapterId, provider: string): ImportedConversation[] {
  const lines = readText(file).split(/\r?\n/).filter((line) => line.trim());
  const groups = new Map<string, any[]>();
  for (const line of lines.slice(0, IMPORT_MAX_MESSAGES)) {
    let raw: any;
    try { raw = JSON.parse(line); } catch { continue; }
    const id = String(firstValue(raw, ['conversation_id', 'conversationId', 'session_id', 'sessionId', 'thread_id', 'threadId', 'session_key', 'sessionKey']) || path.basename(file.relativePath, path.extname(file.relativePath)));
    const bucket = groups.get(id) || [];
    bucket.push(raw);
    groups.set(id, bucket);
  }
  return [...groups.entries()].map(([id, records]) => conversationFromRecords(records, context, {
    id,
    title: String(firstValue(records[0], ['title', 'conversation_title', 'session_title']) || id),
    provider,
    adapter,
    file: file.relativePath,
    project: projectReferenceFromRecords(records, context, adapter, provider, file.relativePath),
  })).filter((conversation) => conversation.messages.length || conversation.events.length);
}

function hermesExportShape(value: any): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && Array.isArray(value.messages)
    && (value.id || value.session_id || value.sessionId)
    && (value.model !== undefined || value.started_at !== undefined || value.source !== undefined),
  );
}

function parseHermesExportFile(file: StagedFile, context: AdapterContext): ImportedConversation[] {
  const lines = readText(file).split(/\r?\n/).filter((line) => line.trim());
  const conversations: ImportedConversation[] = [];
  for (const line of lines.slice(0, IMPORT_MAX_MESSAGES)) {
    let raw: any;
    try { raw = JSON.parse(line); } catch { continue; }
    if (!hermesExportShape(raw)) continue;

    const sessionId = String(firstValue(raw, ['id', 'session_id', 'sessionId']) || '').trim().slice(0, 300);
    if (!sessionId) continue;
    const fallback = normalizeTimestamp(raw.started_at, Date.now());
    const model = String(raw.model || '').trim().slice(0, 240);
    const messages: ImportedMessage[] = [];
    const events: ImportedHistoricalEvent[] = [];
    const sourceMessages = Array.isArray(raw.messages) ? raw.messages : [];

    for (let index = 0; index < sourceMessages.length && messages.length + events.length < IMPORT_MAX_MESSAGES + IMPORT_MAX_EVENTS; index += 1) {
      const source = sourceMessages[index];
      if (!source || typeof source !== 'object') continue;
      const timestamp = normalizeTimestamp(source.timestamp, fallback + index);
      const sourceMessageId = extractSourceMessageId(source);
      const reasoning = cleanText(firstValue(source, [
        'reasoning_summary',
        'reasoningSummary',
        'reasoning',
        'reasoning_content',
        'reasoning_details',
        'analysis',
        'thinking',
        'codex_reasoning_items',
      ]), 40_000).trim();
      const normalized = reasoning ? { ...source, reasoningSummary: reasoning } : source;
      const parsed = makeMessage(normalized, {
        conversationId: sessionId,
        index,
        fallbackTimestamp: timestamp,
        provider: 'hermes',
      });
      if (parsed.message) {
        const messageMetadata: Record<string, unknown> = {};
        for (const key of ['compacted', 'observed', 'active', 'finish_reason']) {
          if (source[key] !== undefined && source[key] !== null) messageMetadata[key] = source[key];
        }
        messages.push({
          ...parsed.message,
          ...(model && !parsed.message.model ? { model, provider: 'hermes' } : {}),
          ...(Object.keys(messageMetadata).length ? { metadata: messageMetadata } : {}),
        });
      }
      events.push(...parsed.events.slice(0, 500));
      if (reasoning) {
        events.push(makeEvent({
          type: 'reasoning',
          content: reasoning,
          metadata: { source: 'hermes-session-export' },
        }, {
          conversationId: sessionId,
          index,
          timestamp,
          sourceMessageId,
          provider: 'hermes',
        }));
      }
    }

    const systemPrompt = cleanText(raw.system_prompt, 60_000).trim();
    if (systemPrompt) {
      events.push(makeEvent({
        type: 'system',
        content: systemPrompt,
        metadata: { source: 'hermes-session-export', historicalContext: true },
      }, {
        conversationId: sessionId,
        index: sourceMessages.length,
        timestamp: fallback,
        provider: 'hermes',
      }));
    }
    if (!messages.length && !events.length) continue;

    messages.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    events.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    const times = [...messages.map((item) => item.timestamp), ...events.map((item) => item.timestamp)].filter((value) => Number.isFinite(value));
    const createdAt = times.length ? Math.min(...times) : fallback;
    const updatedAt = normalizeTimestamp(raw.ended_at, times.length ? Math.max(...times) : createdAt);
    const metadata: Record<string, unknown> = {
      source: raw.source,
      model,
      messageCount: raw.message_count,
      toolCallCount: raw.tool_call_count,
      startedAt: raw.started_at,
      endedAt: raw.ended_at,
      billingProvider: raw.billing_provider,
      billingMode: raw.billing_mode,
      workingDirectory: raw.cwd,
    };
    for (const key of Object.keys(metadata)) if (metadata[key] === undefined || metadata[key] === null || metadata[key] === '') delete metadata[key];
    conversations.push({
      id: sessionId,
      title: String(raw.title || `Hermes session ${sessionId.slice(0, 12)}`).trim().slice(0, 200),
      createdAt,
      updatedAt,
      source: {
        ...baseSource(context, 'hermes-local', 'hermes', sessionId, file.relativePath),
        sourceSessionKey: sessionId,
      },
      messages,
      events,
      resources: [],
      project: projectReferenceFromRecords([raw, ...sourceMessages], context, 'hermes-local', 'hermes', file.relativePath),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    });
  }
  return conversations;
}

function codexRolloutShape(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  const payload = value.payload && typeof value.payload === 'object' ? value.payload : {};
  if (value.type === 'session_meta' && (payload.session_id || payload.id)) return true;
  if (value.type === 'response_item' && ['message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(String(payload.type || ''))) return true;
  if (value.type === 'event_msg' && ['agent_reasoning', 'agent_message', 'user_message', 'task_started', 'task_complete', 'token_count'].includes(String(payload.type || ''))) return true;
  return value.type === 'turn_context' && !!payload.model;
}

function looksLikeCodexRollout(file: StagedFile): boolean {
  if (!/\.jsonl$/i.test(file.relativePath)) return false;
  if (/^rollout[-_]/i.test(path.basename(file.relativePath))) return true;
  try {
    const fd = fs.openSync(file.absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(128 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.toString('utf8', 0, bytes).split(/\r?\n/).slice(0, 80).some((line) => {
        try { return codexRolloutShape(JSON.parse(line)); } catch { return false; }
      });
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function codexText(value: unknown, max = 60_000): string {
  return cleanText(value, max).trim().slice(0, max);
}

function codexMetadata(payload: any, recordType: string): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = { codexRecordType: recordType };
  for (const key of ['type', 'phase', 'status', 'turn_id', 'call_id', 'model', 'name']) {
    if (payload?.[key] !== undefined && payload?.[key] !== null) {
      const value = typeof payload[key] === 'string' ? payload[key].slice(0, 500) : payload[key];
      if (typeof value !== 'object') metadata[key] = value;
    }
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function codexEvent(args: {
  provider: string;
  model?: string;
  inputDigest: string;
  file: string;
  line: number;
  type: ImportedHistoricalEvent['type'];
  timestamp: number;
  sourceEventId?: string;
  name?: string;
  content?: string;
  inputPreview?: string;
  resultPreview?: string;
  metadata?: Record<string, unknown>;
}): ImportedHistoricalEvent {
  return {
    id: `evt_${stableImportId(args.inputDigest, args.file, args.line, args.type, args.sourceEventId || '', args.name || '')}`,
    type: args.type,
    timestamp: args.timestamp,
    ...(args.sourceEventId ? { sourceEventId: args.sourceEventId.slice(0, 300) } : {}),
    ...(args.name ? { name: args.name.slice(0, 240) } : {}),
    ...(args.content ? { content: args.content.slice(0, 60_000) } : {}),
    ...(args.inputPreview ? { inputPreview: args.inputPreview.slice(0, 20_000) } : {}),
    ...(args.resultPreview ? { resultPreview: args.resultPreview.slice(0, 60_000) } : {}),
    provider: args.provider,
    ...(args.model ? { model: args.model.slice(0, 300) } : {}),
    historicalOnly: true,
    metadata: args.metadata,
  };
}

function codexResource(value: unknown, context: AdapterContext, file: string, line: number, kind: ImportedResource['kind']): ImportedResource | undefined {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? value as any : null;
  if (!raw) return undefined;
  const urlValue = typeof raw === 'string' ? raw : firstValue(raw, ['url', 'uri', 'href']);
  const url = /^https?:\/\//i.test(String(urlValue || '').trim()) ? String(urlValue).trim().slice(0, 2_000) : undefined;
  const label = typeof raw === 'string'
    ? raw
    : String(firstValue(raw, ['name', 'title', 'filename', 'fileName', 'path', 'file_path']) || 'Codex attachment');
  const title = path.basename(label.replace(/\\/g, '/')).slice(0, 240) || 'Codex attachment';
  return {
    id: `res_${stableImportId(context.inputDigest, file, line, title, url || '')}`,
    kind: url ? (kind === 'image' ? 'web_page' : 'link') : kind,
    title,
    ...(url ? { url } : {}),
    metadata: {
      source: 'codex_rollout',
      recordFile: file,
      recordLine: line,
      ...(typeof raw === 'object' ? { fields: Object.keys(raw).slice(0, 40) } : {}),
    },
  };
}

function codexTitleCandidate(content: string): string {
  let value = String(content || '').trim();
  if (!value || /^<recommended_plugins\b/i.test(value) || /^<environment_context\b/i.test(value)) return '';
  const delegatedInput = value.match(/^<codex_delegation\b[\s\S]*?<input>([\s\S]*?)<\/input>/i);
  if (delegatedInput?.[1]) value = delegatedInput[1].trim();
  const firstLine = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  if (!firstLine || /^<[^>]+>$/i.test(firstLine)) return '';
  return firstLine.slice(0, 200);
}

function parseCodexRolloutFile(file: StagedFile, context: AdapterContext): ImportedConversation[] {
  // Codex rollout files can be substantially larger than ordinary exports
  // because they retain encrypted reasoning, tool traffic, and prior
  // context. The staged-import boundary already caps the complete source at
  // IMPORT_MAX_INPUT_BYTES, so allow this adapter to consume that bounded
  // single-file budget instead of applying the smaller human-export text
  // limit and reporting a valid rollout as unsupported.
  const lines = readText(file, IMPORT_MAX_INPUT_BYTES).split(/\r?\n/).filter((line) => line.trim());
  const messages: ImportedMessage[] = [];
  const events: ImportedHistoricalEvent[] = [];
  const resources: ImportedResource[] = [];
  const resourceIds = new Set<string>();
  let sourceSessionId = '';
  let model = '';
  let title = '';
  let pendingReasoning = '';
  let lastAssistant: ImportedMessage | undefined;
  const projectRecords: any[] = [];

  const addReasoningSummary = (text: string): void => {
    const bounded = text.slice(0, 40_000);
    if (!bounded) return;
    pendingReasoning = `${pendingReasoning}${pendingReasoning ? '\n' : ''}${bounded}`.slice(0, 40_000);
  };

  const addResources = (payload: any, lineNumber: number): void => {
    for (const [value, kind] of [
      [payload?.images, 'image'],
      [payload?.local_images, 'image'],
      [payload?.audio, 'file'],
    ] as Array<[unknown, ImportedResource['kind']]>) {
      if (!Array.isArray(value)) continue;
      for (const item of value.slice(0, 200)) {
        const resource = codexResource(item, context, file.relativePath, lineNumber, kind);
        if (resource && !resourceIds.has(resource.id)) {
          resourceIds.add(resource.id);
          resources.push(resource);
        }
      }
    }
  };

  for (let index = 0; index < lines.length && (messages.length + events.length) < IMPORT_MAX_MESSAGES + IMPORT_MAX_EVENTS; index += 1) {
    let row: any;
    try { row = JSON.parse(lines[index]); } catch { continue; }
    projectRecords.push(row);
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
    const recordType = String(row?.type || '').trim();
    const payloadType = String(payload?.type || '').trim();
    const timestamp = normalizeTimestamp(row?.timestamp, Date.now() + index);
    const sourceEventId = String(payload?.id || payload?.call_id || payload?.turn_id || '').trim() || undefined;

    if (recordType === 'session_meta') {
      sourceSessionId = String(payload.session_id || payload.id || '').trim().slice(0, 300) || sourceSessionId;
      if (!model) model = String(payload.model || payload.model_provider || '').trim().slice(0, 300);
      continue;
    }
    if (recordType === 'turn_context') {
      if (payload.model) model = String(payload.model).trim().slice(0, 300);
      continue;
    }
    if (recordType === 'response_item' && payloadType === 'message') {
      const role = normalizeRole(payload.role);
      const content = codexText(payload.content);
      if (role === 'system') {
        if (content) events.push(codexEvent({ provider: 'codex', model, inputDigest: context.inputDigest, file: file.relativePath, line: index + 1, type: 'system', timestamp, sourceEventId, content, metadata: codexMetadata(payload, payloadType) }));
        continue;
      }
      if (role !== 'user' && role !== 'assistant') continue;
      const message: ImportedMessage = {
        id: `msg_${stableImportId(context.inputDigest, file.relativePath, index, payload.id || '', role, content.slice(0, 120))}`,
        role,
        content,
        timestamp,
        ...(payload.id ? { sourceMessageId: String(payload.id).slice(0, 300) } : {}),
        provider: 'codex',
        ...(model ? { model } : {}),
        ...(pendingReasoning && role === 'assistant' ? { reasoningSummary: pendingReasoning } : {}),
        ...(codexMetadata(payload, payloadType) ? { metadata: codexMetadata(payload, payloadType) } : {}),
      };
      pendingReasoning = '';
      messages.push(message);
      if (role === 'user' && content) {
        const candidate = codexTitleCandidate(content);
        if (candidate && !title) title = candidate;
      }
      if (role === 'assistant') lastAssistant = message;
      continue;
    }
    if (recordType === 'response_item' && payloadType === 'reasoning') {
      const summary = codexText(payload.summary, 40_000);
      const content = summary || (payload.encrypted_content ? '[Encrypted Codex reasoning summary]' : '');
      if (summary) addReasoningSummary(summary);
      if (content) events.push(codexEvent({ provider: 'codex', model, inputDigest: context.inputDigest, file: file.relativePath, line: index + 1, type: 'reasoning', timestamp, sourceEventId, content, metadata: { ...(codexMetadata(payload, payloadType) || {}), ...(payload.encrypted_content ? { encrypted: true } : {}) } }));
      continue;
    }
    if (recordType === 'response_item' && ['function_call', 'custom_tool_call'].includes(payloadType)) {
      const name = String(payload.name || payload.function?.name || payloadType).slice(0, 240);
      const inputPreview = codexText(payload.arguments ?? payload.input, 20_000);
      events.push(codexEvent({ provider: 'codex', model, inputDigest: context.inputDigest, file: file.relativePath, line: index + 1, type: 'tool_call', timestamp, sourceEventId, name, inputPreview, metadata: codexMetadata(payload, payloadType) }));
      continue;
    }
    if (recordType === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(payloadType)) {
      const resultPreview = codexText(payload.output ?? payload.result, 60_000);
      events.push(codexEvent({ provider: 'codex', model, inputDigest: context.inputDigest, file: file.relativePath, line: index + 1, type: 'tool_result', timestamp, sourceEventId, resultPreview, metadata: codexMetadata(payload, payloadType) }));
      continue;
    }
    if (recordType === 'event_msg') {
      addResources(payload, index + 1);
      if (payloadType === 'agent_reasoning') {
        const content = codexText(payload.text, 40_000);
        addReasoningSummary(content);
        if (content) events.push(codexEvent({ provider: 'codex', model, inputDigest: context.inputDigest, file: file.relativePath, line: index + 1, type: 'reasoning', timestamp, content, metadata: codexMetadata(payload, payloadType) }));
        continue;
      }
      // user_message and agent_message mirror response_item messages in the
      // rollout. Their image/audio fields are retained above, but their text
      // is deliberately not added again.
      if (payloadType === 'user_message' || payloadType === 'agent_message' || payloadType === 'token_count') continue;
      const eventType = payloadType === 'web_search_end'
        ? 'browser'
        : payloadType === 'patch_apply_end'
          ? 'artifact'
          : ['task_started', 'task_complete', 'thread_settings_applied', 'context_compacted'].includes(payloadType)
            ? 'status'
            : null;
      if (eventType) {
        const content = codexText(payload.message ?? payload.text ?? payload.info ?? payload.stdout ?? payload.stderr ?? payload.status ?? payloadType, 60_000);
        if (content) events.push(codexEvent({ provider: 'codex', model, inputDigest: context.inputDigest, file: file.relativePath, line: index + 1, type: eventType as ImportedHistoricalEvent['type'], timestamp, content, metadata: codexMetadata(payload, payloadType) }));
      }
      continue;
    }
    if (recordType === 'compacted') {
      const content = codexText(payload.summary ?? payload.state ?? 'Codex context compacted', 20_000);
      events.push(codexEvent({ provider: 'codex', model, inputDigest: context.inputDigest, file: file.relativePath, line: index + 1, type: 'status', timestamp, content, metadata: codexMetadata(payload, recordType) }));
    }
  }

  // Some rollout versions emit the reasoning event after the assistant
  // response item. Preserve that summary without making it executable.
  if (pendingReasoning && lastAssistant) {
    lastAssistant.reasoningSummary = `${lastAssistant.reasoningSummary || ''}${lastAssistant.reasoningSummary ? '\n' : ''}${pendingReasoning}`.slice(0, 40_000);
  }
  if (!messages.length && !events.length) return [];
  messages.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  events.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  const times = [...messages.map((item) => item.timestamp), ...events.map((item) => item.timestamp)].filter((value) => Number.isFinite(value));
  const fallbackId = `codex_${stableImportId(context.inputDigest, file.relativePath)}`;
  const sessionId = sourceSessionId || fallbackId;
  return [{
    id: sessionId,
    title: title || `Codex session ${sessionId.slice(0, 12)}`,
    createdAt: times.length ? Math.min(...times) : Date.now(),
    updatedAt: times.length ? Math.max(...times) : Date.now(),
    source: {
      provider: 'codex',
      adapter: 'codex-local',
      sourceLabel: context.sourceLabel.slice(0, 240),
      sourceConversationId: sessionId,
      sourceSessionKey: sessionId,
      sourceFile: file.relativePath.slice(0, 500),
      inputDigest: context.inputDigest,
      importedAt: new Date().toISOString(),
    },
    messages,
    events,
    resources,
    project: projectReferenceFromRecords(projectRecords, context, 'codex-local', 'codex', file.relativePath),
    metadata: { format: 'codex-rollout-jsonl', model: model || undefined },
  }];
}

function parseMarkdownFile(file: StagedFile, context: AdapterContext, provider: string, adapter: ImportAdapterId): ImportedConversation[] {
  const text = readText(file);
  const title = (text.match(/^#\s+(.+)$/m)?.[1] || path.basename(file.relativePath, path.extname(file.relativePath))).trim().slice(0, 200);
  const records: any[] = [];
  const marker = /^\s*(?:\*\*|__)?(user|human|assistant|ai|claude|chatgpt|grok|codex|prometheus)(?:\*\*|__)?\s*:\s*(.*)$/i;
  let current: any = null;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(marker);
    if (match) {
      if (current) records.push(current);
      current = { role: match[1], content: match[2], timestamp: Date.now() + records.length };
    } else if (current) {
      current.content = `${current.content || ''}${current.content ? '\n' : ''}${line}`;
    }
  }
  if (current) records.push(current);
  if (!records.length && text.trim()) records.push({ role: 'user', content: text });
  const conversation = conversationFromRecords(records, context, {
    id: `${path.basename(file.relativePath)}:${stableImportId(context.inputDigest, file.relativePath)}`,
    title,
    provider,
    adapter,
    file: file.relativePath,
  });
  return conversation.messages.length || conversation.events.length ? [conversation] : [];
}

function findChatGptJson(files: StagedFile[]): StagedFile | undefined {
  return files.find((file) => /(^|\/)conversations\.json$/i.test(file.relativePath));
}

function zipEntryPath(name: string): string {
  return safeRelativePath(name);
}

async function parseZip(file: StagedFile, context: AdapterContext): Promise<ConversationAdapterResult> {
  if (file.size > IMPORT_MAX_ZIP_BYTES) throw new Error('Import archive is too large.');
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(file.absolutePath), { checkCRC32: true, createFolders: false });
  const entries: Array<{ name: string; entry: any }> = [];
  let uncompressed = 0;
  for (const [rawName, entry] of Object.entries(zip.files)) {
    const isDirectory = (entry as any).dir === true;
    const normalizedRawName = isDirectory ? rawName.replace(/\/+$/, '') : rawName;
    if (!normalizedRawName) continue;
    const name = zipEntryPath(normalizedRawName);
    if (isDirectory) continue;
    const size = Number((entry as any)._data?.uncompressedSize || 0);
    uncompressed += Number.isFinite(size) ? size : 0;
    if (entries.length >= IMPORT_MAX_ZIP_ENTRIES || uncompressed > IMPORT_MAX_ZIP_BYTES) {
      throw new Error('Import archive exceeds the entry or decompressed-size safety limit.');
    }
    entries.push({ name, entry });
  }
  const conversationsEntry = entries.find((item) => /(^|\/)conversations\.json$/i.test(item.name));
  if (!conversationsEntry) {
    return { adapter: 'unsupported', provider: 'chatgpt', conversations: [], warnings: [], unsupportedReason: 'The archive does not contain a conversations.json export.' };
  }
  const jsonText = await conversationsEntry.entry.async('string');
  if (Buffer.byteLength(jsonText, 'utf8') > IMPORT_MAX_TEXT_BYTES) throw new Error('conversations.json is too large.');
  const root = parseJsonText(jsonText, conversationsEntry.name);
  const conversations = (Array.isArray(root) ? root : []).map((raw, index) => parseChatGptConversation(raw, context, conversationsEntry.name, index));
  const assets: ImportedResource[] = [];
  for (const item of entries) {
    if (item.name === conversationsEntry.name || /(^|\/)(metadata|user|shared|message_feedback)\.json$/i.test(item.name)) continue;
    if (item.name.toLowerCase().endsWith('.json')) continue;
    const assetSize = Number((item.entry as any)._data?.uncompressedSize || 0);
    if (!Number.isFinite(assetSize) || assetSize > 100 * 1024 * 1024) continue;
    const bytes = await item.entry.async('nodebuffer');
    const mime = mimeFromName(item.name);
    assets.push({
      id: `res_${stableImportId(context.inputDigest, item.name)}`,
      kind: mime.startsWith('image/') ? 'image' : 'file',
      title: path.basename(item.name),
      mimeType: mime,
      relativePath: `__zip__/${item.name}`,
      metadata: { archiveEntry: item.name, archivePath: file.relativePath, bytes: bytes.length },
    });
  }
  if (assets.length && conversations.length) {
    // ChatGPT exports do not provide a stable attachment-to-message contract;
    // retain every safe asset on the first conversation and say so in preview.
    conversations[0].resources.push(...assets.slice(0, IMPORT_MAX_RESOURCES));
  }
  return {
    adapter: 'chatgpt-export',
    provider: 'chatgpt',
    conversations,
    warnings: assets.length ? ['Archive assets were preserved on the first imported conversation because the export has no stable attachment mapping.'] : [],
  };
}

function mimeFromName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.jsonl': 'application/jsonl',
    '.html': 'text/html', '.csv': 'text/csv', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.zip': 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function findDatabaseFile(files: StagedFile): boolean {
  return /\.(vscdb|sqlite|sqlite3|db)$/i.test(files.relativePath);
}

function parseCursorDatabase(file: StagedFile, context: AdapterContext): ImportedConversation[] {
  let DatabaseCtor: any;
  try { DatabaseCtor = require('better-sqlite3'); } catch { throw new Error('Cursor history import requires the bundled SQLite runtime.'); }
  let db: any;
  try { db = new DatabaseCtor(file.absolutePath, { readonly: true, fileMustExist: true }); } catch (error: any) {
    throw new Error(`Cursor history database could not be opened read-only: ${error?.message || 'open failed'}`);
  }
  const recordsByConversation = new Map<string, any[]>();
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const table of tables.slice(0, 100)) {
      const tableName = String(table.name || '').replace(/"/g, '');
      if (!tableName) continue;
      let columns: any[] = [];
      try { columns = db.prepare(`PRAGMA table_info("${tableName}")`).all(); } catch { continue; }
      const names = columns.map((column) => String(column.name || '').toLowerCase());
      const hasText = names.some((name) => ['content', 'text', 'message', 'value', 'input', 'output'].includes(name));
      const hasIdentity = names.some((name) => ['role', 'session_id', 'sessionid', 'conversation_id', 'conversationid', 'created_at', 'timestamp'].includes(name));
      if (!hasText || !hasIdentity) continue;
      let rows: any[] = [];
      try { rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT 20000`).all(); } catch { continue; }
      for (const row of rows) {
        let candidate: any = row;
        for (const key of ['value', 'message', 'content', 'data']) {
          if (typeof row?.[key] !== 'string') continue;
          try {
            const parsed = JSON.parse(row[key]);
            if (parsed && typeof parsed === 'object') candidate = { ...row, ...parsed };
          } catch { /* plain text row */ }
        }
        const content = extractContent(candidate).trim();
        const role = normalizeRole(firstValue(candidate, ['role', 'author', 'speaker', 'sender']));
        if (!content || !role || role === 'system' || role === 'tool') continue;
        const id = String(firstValue(candidate, ['session_id', 'sessionId', 'conversation_id', 'conversationId', 'chat_id', 'chatId']) || tableName);
        const bucket = recordsByConversation.get(id) || [];
        bucket.push(candidate);
        recordsByConversation.set(id, bucket);
      }
    }
  } finally {
    try { db.close(); } catch { /* best effort */ }
  }
  if (!recordsByConversation.size) throw new Error('Cursor SQLite schema did not expose readable transcript messages; private UI storage is not supported.');
  return [...recordsByConversation.entries()].map(([id, records]) => conversationFromRecords(records, context, {
    id,
    title: `Cursor conversation ${id}`,
    provider: 'cursor',
    adapter: 'cursor-local',
    file: file.relativePath,
    project: projectReferenceFromRecords(records, context, 'cursor-local', 'cursor', file.relativePath),
  }));
}

function adapterForContext(context: AdapterContext): { adapter: ImportAdapterId; provider: string } {
  if (context.requestedAdapter && context.requestedAdapter !== 'unsupported') {
    const provider = context.requestedAdapter === 'chatgpt-export' ? 'chatgpt'
      : context.requestedAdapter === 'codex-local' ? 'codex'
        : context.requestedAdapter === 'claude-code-local' ? 'claude'
          : context.requestedAdapter === 'cursor-local' ? 'cursor'
            : context.requestedAdapter === 'hermes-local' ? 'hermes'
              : context.requestedAdapter === 'openclaw-local' ? 'openclaw'
                : context.requestedAdapter === 'localclaw-local' ? 'localclaw' : 'generic';
    return { adapter: context.requestedAdapter, provider };
  }
  const lower = `${context.sourceLabel} ${context.files.map((file) => file.relativePath).join(' ')}`.toLowerCase();
  if (findChatGptJson(context.files)) return { adapter: 'chatgpt-export', provider: 'chatgpt' };
  if (context.files.some(looksLikeCodexRollout)) return { adapter: 'codex-local', provider: 'codex' };
  if (lower.includes('claude')) return { adapter: 'claude-code-local', provider: 'claude' };
  if (lower.includes('cursor') || context.files.some(findDatabaseFile)) return { adapter: 'cursor-local', provider: 'cursor' };
  if (lower.includes('codex')) return { adapter: 'codex-local', provider: 'codex' };
  if (lower.includes('hermes')) return { adapter: 'hermes-local', provider: 'hermes' };
  if (lower.includes('openclaw')) return { adapter: 'openclaw-local', provider: 'openclaw' };
  if (lower.includes('localclaw')) return { adapter: 'localclaw-local', provider: 'localclaw' };
  if (context.files.some((file) => file.relativePath.toLowerCase().endsWith('.jsonl'))) return { adapter: 'generic-jsonl', provider: 'generic' };
  if (context.files.some((file) => file.relativePath.toLowerCase().endsWith('.md'))) return { adapter: 'generic-markdown', provider: 'generic' };
  return { adapter: 'generic-json', provider: 'generic' };
}

export async function parseConversationImport(context: AdapterContext): Promise<ConversationAdapterResult> {
  const warnings: string[] = [];
  const selected = adapterForContext(context);
  const zipFile = context.files.find((file) => file.relativePath.toLowerCase().endsWith('.zip'));
  if (zipFile && (selected.adapter === 'chatgpt-export' || !context.requestedAdapter)) return parseZip(zipFile, context);
  if (selected.adapter === 'codex-local') {
    const jsonlFiles = context.files.filter((file) => file.relativePath.toLowerCase().endsWith('.jsonl'));
    const rolloutFiles = jsonlFiles.filter(looksLikeCodexRollout);
    if (rolloutFiles.length) {
      const conversations = rolloutFiles.flatMap((file) => parseCodexRolloutFile(file, context));
      if (conversations.length) return { adapter: 'codex-local', provider: 'codex', conversations, warnings };
      // Keep compatibility with older/local Codex fixtures that used a
      // simple role/content JSONL envelope before the current rollout event
      // protocol. This fallback is still read-only and historical-only; it
      // does not broaden the adapter into command execution or private APIs.
      const simpleConversations = rolloutFiles.flatMap((file) => parseJsonlFile(file, context, 'codex-local', 'codex'));
      if (simpleConversations.length) {
        warnings.push('The Codex file used a simple role/content JSONL envelope; imported records remain historical-only.');
        return { adapter: 'codex-local', provider: 'codex', conversations: simpleConversations, warnings };
      }
      return { adapter: 'unsupported', provider: 'codex', conversations: [], warnings, unsupportedReason: 'The Codex rollout contained no readable messages or historical events.' };
    }
  }
  if (selected.adapter === 'hermes-local') {
    const jsonlFiles = context.files.filter((file) => file.relativePath.toLowerCase().endsWith('.jsonl'));
    const conversations = jsonlFiles.flatMap((file) => parseHermesExportFile(file, context));
    if (conversations.length) return { adapter: 'hermes-local', provider: 'hermes', conversations, warnings };
    return {
      adapter: 'unsupported',
      provider: 'hermes',
      conversations: [],
      warnings,
      unsupportedReason: 'Hermes import requires the native `hermes sessions export` JSONL session envelope or another supported local transcript format.',
    };
  }
  if (selected.adapter === 'cursor-local') {
    const database = context.files.find(findDatabaseFile);
    if (!database) return { adapter: 'unsupported', provider: 'cursor', conversations: [], warnings, unsupportedReason: 'Cursor local import requires a copied SQLite history database.' };
    return { adapter: selected.adapter, provider: selected.provider, conversations: parseCursorDatabase(database, context), warnings };
  }
  if (selected.adapter === 'chatgpt-export') {
    const json = findChatGptJson(context.files);
    if (!json) return { adapter: 'unsupported', provider: 'chatgpt', conversations: [], warnings, unsupportedReason: 'ChatGPT import requires the official conversations.json export or ZIP.' };
    const root = parseJsonText(readText(json), json.relativePath);
    const conversations = (Array.isArray(root) ? root : []).map((raw, index) => parseChatGptConversation(raw, context, json.relativePath, index));
    return { adapter: selected.adapter, provider: selected.provider, conversations, warnings };
  }
  const conversations: ImportedConversation[] = [];
  const jsonlFiles = context.files.filter((file) => file.relativePath.toLowerCase().endsWith('.jsonl'));
  for (const file of jsonlFiles) conversations.push(...parseJsonlFile(file, context, selected.adapter, selected.provider));
  const jsonFiles = context.files.filter((file) => file.relativePath.toLowerCase().endsWith('.json') && !/conversations\.json$/i.test(file.relativePath));
  for (const file of jsonFiles.slice(0, 200)) {
    try {
      conversations.push(...parseJsonRoot(parseJsonText(readText(file), file.relativePath), context, selected.adapter, selected.provider, file.relativePath));
    } catch (error: any) {
      warnings.push(`${file.relativePath}: ${error?.message || 'skipped'}`);
    }
  }
  if (!conversations.length) {
    for (const file of context.files.filter((item) => /\.md$/i.test(item.relativePath)).slice(0, 200)) {
      conversations.push(...parseMarkdownFile(file, context, selected.provider, selected.adapter));
    }
  }
  if (!conversations.length) {
    return {
      adapter: 'unsupported',
      provider: selected.provider,
      conversations: [],
      warnings,
      unsupportedReason: 'No supported local transcript, JSON, JSONL, Markdown, or SQLite conversation artifact was found. Private web UI scraping is not supported.',
    };
  }
  return { adapter: selected.adapter, provider: selected.provider, conversations, warnings };
}

function isSecretKey(key: string): boolean {
  return /token|secret|password|passwd|api[_-]?key|private[_-]?key|authorization|cookie|credential|client_secret|access[_-]?token|refresh[_-]?token/i.test(key);
}

function redactSetupValue(value: unknown, key: string, notices: SetupSecretNotice[], serverId?: string): unknown {
  if (typeof value === 'string') {
    if (isSecretKey(key) || /^vault:/i.test(value) || /^(sk-|xai-|ghp_|gho_|AIza|Bearer\s)/i.test(value.trim())) {
      notices.push({ serverId, key, reason: /^vault:/i.test(value) ? 'reauthorization_required' : 'credential_redacted' });
      return `vault:pending-import:${stableImportId(serverId || 'setup', key)}`;
    }
    return value.slice(0, 20_000);
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactSetupValue(item, key, notices, serverId));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = redactSetupValue(child, childKey, notices, serverId);
    }
    return out;
  }
  return value;
}

function extractMcpCandidates(root: any): Array<{ id: string; raw: any }> {
  const out: Array<{ id: string; raw: any }> = [];
  const pushMap = (map: any) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    for (const [id, raw] of Object.entries(map)) out.push({ id: String(id), raw });
  };
  if (Array.isArray(root)) root.forEach((raw, index) => out.push({ id: String(raw?.id || `server_${index + 1}`), raw }));
  pushMap(root?.mcpServers);
  pushMap(root?.servers);
  if (root?.mcp && typeof root.mcp === 'object') pushMap(root.mcp.servers || root.mcp);
  if (root?.mcpServer && typeof root.mcpServer === 'object') pushMap(root.mcpServer);
  return out;
}

function classifySetupFile(relativePath: string): ImportedSetupFile['category'] {
  const lower = relativePath.toLowerCase();
  if (/(^|\/)memory(\/|$)|memory\.md|user\.md|soul\.md/.test(lower)) return 'memory';
  if (/(^|\/)skills?(\/|$)|skill\.md$/.test(lower)) return 'skill';
  if (/(^|\/)(agents?\.md|claude\.md|agents\.md)$/.test(lower)) return 'agent_instructions';
  if (/permission|policy|allowlist|denylist|sandbox/.test(lower)) return 'permissions';
  if (/connector|integration|oauth|mcp/.test(lower)) return 'connector';
  if (/\.json$|\.yaml$|\.yml$|\.toml$|\.env/.test(lower)) return 'config';
  return 'unknown';
}

/**
 * Parse only the small TOML subset used by local Codex MCP declarations.
 * This is intentionally not a general TOML interpreter: import preview must
 * never evaluate expressions, expand commands, or execute provider config.
 */
function stripTomlComment(line: string): string {
  let quote = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? '' : (quote || char);
    }
    if (char === '#' && !quote) return line.slice(0, index).trim();
  }
  return line.trim();
}

function splitTomlArray(value: string): string[] {
  const out: string[] = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') quote = quote === char ? '' : (quote || char);
    if (quote) continue;
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      out.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (value.slice(start).trim()) out.push(value.slice(start).trim());
  return out;
}

function parseTomlScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitTomlArray(trimmed.slice(1, -1)).map((item) => parseTomlScalar(item));
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1).slice(0, 20_000); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).slice(0, 20_000);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.slice(0, 20_000);
}

function extractCodexMcpCandidates(text: string): { candidates: Array<{ id: string; raw: any }>; hasProviderPlugins: boolean } {
  const byId = new Map<string, Record<string, any>>();
  let currentId = '';
  let section = '';
  let hasProviderPlugins = false;
  for (const rawLine of text.split(/\r?\n/).slice(0, 100_000)) {
    const line = stripTomlComment(rawLine);
    if (!line) continue;
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1].trim();
      if (/^plugins(?:\.|$)/i.test(section)) hasProviderPlugins = true;
      const serverMatch = section.match(/^mcp_servers\.(.+?)(\.env)?$/i);
      if (!serverMatch) {
        currentId = '';
        continue;
      }
      const rawId = serverMatch[1].replace(/^['"]|['"]$/g, '').trim();
      currentId = rawId.slice(0, 120);
      if (!currentId) continue;
      if (!byId.has(currentId)) byId.set(currentId, { id: currentId });
      if (Boolean(serverMatch[2])) {
        const existing = byId.get(currentId)!;
        existing.env = existing.env && typeof existing.env === 'object' ? existing.env : {};
      }
      continue;
    }
    const assignment = line.match(/^\s*([A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*=\s*(.*?)\s*$/);
    if (!assignment || !currentId) continue;
    const key = assignment[1].replace(/^['"]|['"]$/g, '');
    const target = /\.env$/i.test(section)
      ? (byId.get(currentId)!.env ||= {})
      : byId.get(currentId)!;
    target[key] = parseTomlScalar(assignment[2]);
  }
  return { candidates: [...byId.entries()].map(([id, raw]) => ({ id, raw })), hasProviderPlugins };
}

export function parseSetupImport(context: AdapterContext): SetupAdapterResult {
  const lower = `${context.sourceLabel} ${context.files.map((file) => file.relativePath).join(' ')}`.toLowerCase();
  const provider = lower.includes('codex') ? 'codex' : lower.includes('chatgpt') || lower.includes('openai') ? 'chatgpt' : lower.includes('hermes') ? 'hermes' : lower.includes('openclaw') ? 'openclaw' : lower.includes('localclaw') ? 'localclaw' : lower.includes('claude') ? 'claude' : 'generic';
  const scope = context.setupScope || 'all';
  const mcpServers: ImportedMcpServer[] = [];
  const secretNotices: SetupSecretNotice[] = [];
  const warnings: string[] = [];
  const files: ImportedSetupFile[] = [];
  for (const file of context.files.slice(0, IMPORT_MAX_FILES)) {
    const category = classifySetupFile(file.relativePath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file.absolutePath)).digest('hex');
    if (scope === 'all') {
      files.push({ relativePath: file.relativePath, category, size: file.size, sha256: hash, activation: category === 'config' || category === 'connector' ? 'review_required' : 'inactive_snapshot' });
    }
    if (!/\.(json|toml)$/i.test(file.relativePath) || file.size > IMPORT_MAX_TEXT_BYTES) continue;
    let root: any;
    let candidates: Array<{ id: string; raw: any }> = [];
    let text = '';
    try {
      text = readText(file);
      if (/\.toml$/i.test(file.relativePath)) {
        const parsed = extractCodexMcpCandidates(text);
        candidates = parsed.candidates;
        if (parsed.hasProviderPlugins) warnings.push(`${file.relativePath}: provider plugin package metadata was detected; only compatible MCP server declarations are imported.`);
      } else {
        root = parseJsonText(text, file.relativePath);
        candidates = extractMcpCandidates(root);
      }
    } catch { continue; }
    for (const candidate of candidates) {
      const id = candidate.id.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || `server_${mcpServers.length + 1}`;
      const notices: SetupSecretNotice[] = [];
      const redacted = redactSetupValue({ ...(candidate.raw || {}), id }, '', notices, id) as Record<string, unknown>;
      const normalized = MCPManager.normalizeConfig({ ...redacted, id, enabled: false }, id);
      if (!normalized) {
        warnings.push(`${file.relativePath}: MCP server "${id}" is not a valid supported server config.`);
        continue;
      }
      mcpServers.push({ id: normalized.id, config: normalized as unknown as Record<string, unknown>, sourceFile: file.relativePath, secretNotices: notices });
      secretNotices.push(...notices);
    }
  }
  const source: ImportSourceIdentity = {
    provider,
    adapter: 'setup-config',
    sourceLabel: context.sourceLabel.slice(0, 240),
    inputDigest: context.inputDigest,
    importedAt: new Date().toISOString(),
  };
  if (scope === 'mcp' && !mcpServers.length) warnings.push('No supported MCP server declarations were found. Provider-native plugin packages are not executable Prometheus MCP servers and were not copied.');
  return { adapter: 'setup-config', provider, setup: { source, mcpServers, files, secretNotices, warnings } };
}
