import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';

const SECRET_KEY_RE = /(password|token|secret|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)/i;

export function safeAuditSessionId(value: unknown): string {
  const id = String(value || '').trim();
  if (!id || !/^[a-zA-Z0-9._-]{1,180}$/.test(id)) throw new Error('Invalid audit session reference.');
  return id;
}

export function scrubAuditValue(value: any, depth = 0): any {
  if (depth > 5) return '[depth limit]';
  if (typeof value === 'string') {
    let text = value;
    try { text = require('../../security/vault').scrubSecrets(text); } catch {}
    return text.length > 4000 ? `${text.slice(0, 4000)}\n[...truncated]` : text;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => scrubAuditValue(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, entry]) => [
      key,
      SECRET_KEY_RE.test(key) ? '***' : scrubAuditValue(entry, depth + 1),
    ]));
  }
  return value;
}

function continuityPath(sessionId: string): string {
  return path.join(getConfig().getWorkspacePath(), 'audit', 'chats', 'continuity', `${safeAuditSessionId(sessionId)}.jsonl`);
}

function recentIndexPath(): string {
  return path.join(getConfig().getWorkspacePath(), 'audit', 'chats', 'continuity', '_recent.jsonl');
}

/** A synchronous, small recovery journal. It intentionally never carries raw tool output. */
export function appendContinuityEvent(sessionId: string, type: string, detail: Record<string, any>): void {
  try {
    const filePath = continuityPath(sessionId);
    const event = scrubAuditValue({
      timestamp: Date.now(),
      sessionId: safeAuditSessionId(sessionId),
      type: String(type || 'event').slice(0, 80),
      ...detail,
    });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
    // A tiny append-only recent index avoids a corpus walk for ordinary
    // recovery. It is advisory; the per-session journal remains the evidence.
    fs.appendFileSync(recentIndexPath(), `${JSON.stringify({ sessionId: event.sessionId, timestamp: event.timestamp, type: event.type })}\n`, 'utf-8');
  } catch {
    // Audit continuity is deliberately best-effort and must not break a user turn.
  }
}

export function appendContinuityMessage(sessionId: string, message: any, synthetic = false): void {
  appendContinuityEvent(sessionId, 'message', {
    role: message?.role,
    messageKind: message?.messageKind,
    timestamp: Number(message?.timestamp) || Date.now(),
    synthetic,
    content: String(message?.content || '').slice(0, 4000),
    toolLog: message?.toolLog ? String(message.toolLog).slice(0, 1600) : undefined,
  });
}

export function appendContinuityToolObservation(observation: any): void {
  appendContinuityEvent(observation?.sessionId, 'tool_observation', {
    observationId: observation?.id,
    turnId: observation?.turnId,
    stepNum: observation?.stepNum,
    toolName: observation?.toolName,
    category: observation?.category,
    status: observation?.status,
    argsPreview: observation?.argsPreview,
    resultPreview: observation?.resultPreview,
    resultRawRef: observation?.resultRawRef ? 'available via canonical observation mirror after materialization' : undefined,
    pathsTouched: observation?.pathsTouched,
    exitCode: observation?.exitCode,
    startedAt: observation?.startedAt,
    finishedAt: observation?.finishedAt,
    timestamp: observation?.createdAt || Date.now(),
  });
}
