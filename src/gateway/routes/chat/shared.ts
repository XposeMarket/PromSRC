import { createForegroundToolActivityTracker, foregroundConnectionMessage, type ForegroundToolActivity } from '../../chat/foreground-tool-activity';
import { isInternalBackgroundResult } from '../../history-reconciliation';
import { buildAttachmentRuntimeContext, appendAttachmentContextToMessage, normalizeRuntimeVisionAttachments, type RuntimeVisionAttachment } from '../../chat/attachment-context';
import type { MainChatStreamState } from '../../chat/main-chat-stream-store';
import { getLiveRuntime } from '../../live-runtime-registry';

export function normalizeRuntimeVisionAttachmentsInput(value: unknown): RuntimeVisionAttachment[] {
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

export function normalizeRuntimeAttachmentPreviewsInput(value: unknown): any[] {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === 'object')
    .slice(0, 8);
}

export const getOrchestrationConfig: any = () => null;

export function truncateRuntimeProcessText(value: unknown, max = 4000): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function summarizeMobileRuntime(runtime: any): Record<string, any> {
  const checkpoint = runtime?.checkpoint && typeof runtime.checkpoint === 'object'
    ? runtime.checkpoint
    : null;
  const rawActiveTool = checkpoint?.activeTool;
  const activeTool: ForegroundToolActivity | null = rawActiveTool && typeof rawActiveTool === 'object'
    && Number(rawActiveTool.startedAt) > 0
    ? {
        name: String(rawActiveTool.name || '').slice(0, 120),
        kind: ['terminal', 'background', 'tool', 'wait'].includes(rawActiveTool.kind) ? rawActiveTool.kind : 'tool',
        startedAt: Number(rawActiveTool.startedAt),
        lastUpdateAt: Number(rawActiveTool.lastUpdateAt || rawActiveTool.startedAt),
        openCalls: Math.max(1, Number(rawActiveTool.openCalls || 1)),
        ...(Number(rawActiveTool.waitUntil) > 0 ? { waitUntil: Number(rawActiveTool.waitUntil) } : {}),
      }
    : null;
  const connectionMessage = activeTool ? foregroundConnectionMessage(activeTool, Date.now() - activeTool.lastUpdateAt) : '';
  const checkpointProcessEntries = Array.isArray(checkpoint?.processEntries)
    ? checkpoint.processEntries
      .slice(-500)
      .map((entry: any) => sanitizeProcessEntryForUi(entry, { textLimit: 4000, extraLimit: 4000 }))
    : [];
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
    clientRequestId: runtime?.clientRequestId ? String(runtime.clientRequestId) : '',
    detail: runtime?.detail ? String(runtime.detail).slice(0, 500) : '',
    startedAt: Number(runtime?.startedAt || 0),
    abortable: runtime?.abortable === true,
    abortRequestedAt: Number(runtime?.abortRequestedAt || 0) || null,
    checkpoint: checkpoint ? {
      event: String(checkpoint.event || ''),
      at: Number(checkpoint.at || 0) || null,
      toolName: String(checkpoint.toolName || ''),
      message: truncateRuntimeProcessText(checkpoint.message || '', 4000),
      activeTool,
      ...(connectionMessage ? { connectionMessage } : {}),
      processEntries: checkpointProcessEntries,
    } : null,
  };
}

export function isLiveRunningRuntime(runtime: any): boolean {
  return String(runtime?.status || 'running') === 'running' && !runtime?.abortRequestedAt;
}

export function sessionProcessLogFromHistory(session: any): any[] {
  const out: any[] = [];
  for (const msg of Array.isArray(session?.history) ? session.history : []) {
    if (Array.isArray((msg as any)?.processEntries)) out.push(...(msg as any).processEntries);
  }
  return out.slice(-500);
}

export function boundedPositiveInt(input: unknown, fallback: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function sanitizeUiProcessValue(value: unknown, maxChars: number): unknown {
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

export function sanitizeProcessEntryForUi(entry: any, options: { textLimit: number; extraLimit: number }): any {
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

export function sanitizeAttachmentPreviewForUi(preview: any, options: { dataUrlLimit: number; textLimit: number }): any {
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

export function sanitizeMessageMediaForUi(msg: any): void {
  for (const key of ['generatedImages', 'generatedVideos', 'files', 'artifacts']) {
    if (Array.isArray(msg[key])) msg[key] = msg[key].map(sanitizeDurableMediaDescriptorForUi);
  }
  if (msg.body && typeof msg.body === 'object' && Array.isArray(msg.body.files)) {
    msg.body = { ...msg.body, files: msg.body.files.map(sanitizeDurableMediaDescriptorForUi) };
  }
}

export function trimLiveTraceStringLeaves(value: any, maxChars: number, depth: number): any {
  if (typeof value === 'string') return value.length > maxChars ? truncateRuntimeProcessText(value, maxChars) : value;
  if (!value || typeof value !== 'object') return value;
  if (depth >= 6) return value;
  if (Array.isArray(value)) {
    const items = value.length > 40 ? value.slice(0, 40) : value;
    return items.map((item) => trimLiveTraceStringLeaves(item, maxChars, depth + 1));
  }
  const next: any = {};
  for (const key of Object.keys(value)) next[key] = trimLiveTraceStringLeaves(value[key], maxChars, depth + 1);
  return next;
}

export function sanitizeLiveTraceEntriesForUi(entries: any[], limit: number): any[] {
  const durable = entries.filter((entry) => !isTransientLiveTraceEntryForUi(entry));
  if (!(limit > 0) || durable.length <= limit) return durable;
  // Keep a head window as well as the tail so both halves of a restart-spanning
  // turn survive the cap. Order is preserved and the total never exceeds `limit`.
  const head = Math.min(limit - 1, Math.max(1, Math.floor(limit * LIVE_TRACE_HEAD_RETENTION_RATIO)));
  const tail = limit - head;
  return [...durable.slice(0, head), ...durable.slice(durable.length - tail)];
}

export function compactFileChangeFilesForUi(files: any[]): any[] {
  return files.map((file) => {
    if (!file || typeof file !== 'object' || !('diffPreview' in file)) return file;
    const { diffPreview: _omit, ...rest } = file;
    return { ...rest, diffPreviewOmitted: true };
  });
}

export function sanitizeHistoryForUiResponse(
  history: any[],
  options: {
    historyLimit: number;
    includeToolLog: boolean;
    perMessageProcessLimit: number;
    processEntryTextLimit?: number;
    processEntryExtraLimit?: number;
    attachmentPreviewDataUrlLimit?: number;
    attachmentPreviewTextLimit?: number;
    perMessageLiveTraceLimit?: number;
  },
): any[] {
  const source = (Array.isArray(history) ? history : []).filter((row) => !isInternalBackgroundResult(row));
  const limited = options.historyLimit > 0 ? source.slice(-options.historyLimit) : source;
  // Older turns render collapsed, so their full tool traces were pure transfer
  // and parse cost on every chat open (2.6MB for an 80-message chat). Keep
  // full traces for the recent tail; older turns get a compact trace. Only
  // applied when the caller asked for a bounded trace (not full/fullProcess).
  const RECENT_FULL_TRACE_MESSAGES = 12;
  const OLDER_TRACE_LIMIT = 40;
  const OLDER_TRACE_LEAF_LIMIT = 400;
  const boundedTrace = typeof options.perMessageLiveTraceLimit === 'number';
  const recentStart = Math.max(0, limited.length - RECENT_FULL_TRACE_MESSAGES);
  return limited.map((raw, index) => {
    if (!raw || typeof raw !== 'object') return raw;
    const msg: any = { ...raw };
    const olderTurn = boundedTrace && index < recentStart;
    if (olderTurn && Array.isArray(msg.liveTraceEntries) && msg.liveTraceEntries.length > 0) {
      msg.liveTraceTotalCount = msg.liveTraceEntries.length;
      msg.liveTraceEntries = sanitizeLiveTraceEntriesForUi(msg.liveTraceEntries, OLDER_TRACE_LIMIT)
        .map((entry: any) => trimLiveTraceStringLeaves(entry, OLDER_TRACE_LEAF_LIMIT, 0));
      if (msg.liveTraceEntries.length < msg.liveTraceTotalCount) msg.liveTraceCompacted = true;
      else delete msg.liveTraceTotalCount;
    }
    if (!options.includeToolLog) delete msg.toolLog;
    // Bounded chat opens: the message file-change card renders path, status and
    // +/- counts only and fetches the real diff from /api/coding/diff on click,
    // so per-file diffPreview text (up to 13 KB each, ~1 MB of a 3 MB chat
    // switch on 2026-10-01) is dropped here. full/fullProcess reads keep it.
    if (boundedTrace && Array.isArray(msg.fileChanges?.files)) {
      msg.fileChanges = { ...msg.fileChanges, files: compactFileChangeFilesForUi(msg.fileChanges.files) };
      if (Array.isArray(msg.fileChanges.groups)) {
        msg.fileChanges.groups = msg.fileChanges.groups.map((group: any) => (group && Array.isArray(group?.fileChanges?.files)
          ? { ...group, fileChanges: { ...group.fileChanges, files: compactFileChangeFilesForUi(group.fileChanges.files) } }
          : group && Array.isArray(group?.files) ? { ...group, files: compactFileChangeFilesForUi(group.files) } : group));
      }
    }
    if (Array.isArray(msg.processEntries)) {
      msg.processEntries = msg.processEntries
        .slice(-options.perMessageProcessLimit)
        .map((entry: any) => sanitizeProcessEntryForUi(entry, {
          textLimit: options.processEntryTextLimit || 1600,
          extraLimit: options.processEntryExtraLimit || 1200,
        }));
    }
    if (Array.isArray(msg.liveTraceEntries) && typeof options.perMessageLiveTraceLimit === 'number') {
      msg.liveTraceEntries = sanitizeLiveTraceEntriesForUi(msg.liveTraceEntries, options.perMessageLiveTraceLimit);
    }
    if (Array.isArray(msg.liveTraceEntries)) {
      // Trace rows carry full tool args/results (3-18KB each, 500 per turn).
      // They were count-capped but never size-capped, so one long turn could
      // add ~2MB to every chat open. Apply the same per-field limits as
      // processEntries; `full` requests pass effectively unlimited limits.
      // Trim long string leaves only: the tool-activity renderer reads
      // structured fields (args.command, args.code, activity.result), so the
      // object shape must survive.
      const leafLimit = Math.max(options.processEntryTextLimit || 1600, options.processEntryExtraLimit || 1200);
      msg.liveTraceEntries = msg.liveTraceEntries.map((entry: any) => trimLiveTraceStringLeaves(entry, leafLimit, 0));
    }
    if (Array.isArray(msg.attachmentPreviews)) {
      msg.attachmentPreviews = msg.attachmentPreviews.map((preview: any) => sanitizeAttachmentPreviewForUi(preview, {
        dataUrlLimit: options.attachmentPreviewDataUrlLimit || 60_000,
        textLimit: options.attachmentPreviewTextLimit || 4000,
      }));
    }
    sanitizeMessageMediaForUi(msg);
    return msg;
  });
}

export type MainChatTurnReconciliation = {
  active: boolean;
  runtime: ReturnType<typeof getLiveRuntime>;
  stream: MainChatStreamState | null;
  recovered: boolean;
  recoveryReason?: 'orphaned_stream_or_lease';
};


export const LIVE_TRACE_HEAD_RETENTION_RATIO = 0.35;

export function isTransientLiveTraceEntryForUi(entry: any): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const str = (value: any) => String(value || '').trim().toLowerCase();
  const type = str(entry.type || entry.kind);
  const event = str(entry.event || extra.event || extra.eventType);
  const source = str(entry.source || extra.source);
  const visibility = str(entry.visibility || extra.visibility);
  const reasoningKind = str(entry.reasoningKind || extra.reasoningKind || extra.presentationKind);
  if (reasoningKind === 'full_thought') return false;
  return source === 'agent_progress'
    || source === 'reasoning_summary'
    || ['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(type)
    || ['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(event)
    || reasoningKind === 'summary'
    || (visibility === 'summary' && ['think', 'thinking', 'agent_thought'].includes(type));
}

export function sanitizeDurableMediaDescriptorForUi(value: any): any {
  if (!value || typeof value !== 'object') return value;
  const next: any = { ...value };
  const durablePath = String(
    next.path || next.absPath || next.relPath || next.rel_path || next.workspacePath
    || next.filePath || next.cachePath || next.cache_path || '',
  ).trim();
  if (durablePath) {
    // The client can stream this through /api/canvas/inline when the element
    // enters view. Do not duplicate the file as base64 in initial chat JSON.
    for (const key of ['dataUrl', 'base64', 'raw', 'buffer']) delete next[key];
  }
  return next;
}
