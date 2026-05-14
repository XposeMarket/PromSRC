import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import {
  getMemoryGraphSnapshot,
  readMemoryRecord,
  getRelatedMemory,
  refreshMemoryIndexFromAudit,
} from '../memory-index';
import { getSqliteMemoryStatus } from '../memory-index/sqlite-store.js';
import { buildMemoryNoteDocument, parseMemoryNoteDocument, type MemoryNoteAttachment } from '../memory-index/memory-note.js';

type StoreChunk = { id: string; recordId: string; index: number; text: string };
type StoreRecord = {
  id: string;
  sourcePath: string;
  sourceType: string;
  title: string;
  timestampMs: number;
  projectId?: string;
  durability: number;
};
type StoreData = {
  records: Record<string, StoreRecord>;
  chunks: Record<string, StoreChunk>;
};

type CreateMemoryAttachmentInput = {
  name?: string;
  filename?: string;
  base64?: string;
  mimeType?: string;
};

const router = Router();

function getWorkspacePath(): string {
  return getConfig().getWorkspacePath();
}

function readIndexStore(workspacePath: string): StoreData {
  const storePath = path.join(workspacePath, 'audit', '_index', 'memory', 'store.json');
  if (!fs.existsSync(storePath)) return { records: {}, chunks: {} };
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8')) as StoreData;
  } catch {
    return { records: {}, chunks: {} };
  }
}

function summarize(text: string, max = 220): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}

function sourceTypeLabel(sourceType: string): string {
  return String(sourceType || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function sanitizeFilename(value: string): string {
  return path.basename(String(value || '').trim()).replace(/[^a-zA-Z0-9._\-() ]/g, '_');
}

function ensureUniqueFilename(existing: Set<string>, filename: string): string {
  let next = filename;
  let counter = 1;
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  while (existing.has(next)) {
    counter += 1;
    next = `${stem}_${counter}${ext}`;
  }
  existing.add(next);
  return next;
}

function inferAttachmentKind(mimeType: string, filename: string): 'image' | 'file' {
  const lowerMime = String(mimeType || '').toLowerCase();
  const lowerName = String(filename || '').toLowerCase();
  if (lowerMime.startsWith('image/')) return 'image';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowerName)) return 'image';
  return 'file';
}

function attachmentWithAbsPath(workspacePath: string, attachment: MemoryNoteAttachment) {
  return {
    ...attachment,
    absPath: path.join(workspacePath, attachment.path.replace(/\//g, path.sep)),
  };
}

function readMemoryNoteMetadata(workspacePath: string, sourcePath: string) {
  if (!sourcePath || !sourcePath.startsWith('memory/files/')) return null;
  const absPath = path.join(workspacePath, 'audit', sourcePath.replace(/\//g, path.sep));
  if (!fs.existsSync(absPath)) return null;
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const parsed = parseMemoryNoteDocument(raw);
    return {
      ...parsed.meta,
      attachments: Array.isArray(parsed.meta.attachments)
        ? parsed.meta.attachments.map((attachment) => attachmentWithAbsPath(workspacePath, attachment))
        : [],
    };
  } catch {
    return null;
  }
}

router.get('/api/memory/graph', (_req: Request, res: Response) => {
  try {
    const workspacePath = getWorkspacePath();
    const graph = getMemoryGraphSnapshot(workspacePath);
    const store = readIndexStore(workspacePath);
    const degree = new Map<string, number>();
    for (const edge of graph.edges || []) {
      degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
    }

    const firstChunkByRecord = new Map<string, StoreChunk>();
    for (const chunk of Object.values(store.chunks || {})) {
      const existing = firstChunkByRecord.get(chunk.recordId);
      if (!existing || chunk.index < existing.index) firstChunkByRecord.set(chunk.recordId, chunk);
    }

    const nodes = (graph.nodes || []).map((node: any) => {
      const record = store.records?.[node.id];
      const chunk = firstChunkByRecord.get(node.id);
      return {
        id: node.id,
        label: String(node.title || record?.title || path.basename(String(node.sourcePath || 'node'))),
        sourceType: String(node.sourceType || record?.sourceType || 'unknown'),
        sourceTypeLabel: sourceTypeLabel(String(node.sourceType || record?.sourceType || 'unknown')),
        sourcePath: String(node.sourcePath || record?.sourcePath || ''),
        timestamp: String(node.timestamp || (record?.timestampMs ? new Date(record.timestampMs).toISOString() : '')),
        projectId: node.projectId || record?.projectId || null,
        durability: Number(node.durability ?? record?.durability ?? 0.5),
        degree: degree.get(node.id) || 0,
        summary: summarize(chunk?.text || ''),
      };
    });

    const edges = (graph.edges || []).map((edge: any) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: edge.type,
      weight: Number(edge.score || 0),
    }));

    res.json({
      success: true,
      generatedAt: graph.generatedAt,
      stats: {
        nodes: nodes.length,
        edges: edges.length,
        indexedAt: graph.generatedAt,
      },
      nodes,
      edges,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to load memory graph' });
  }
});

router.get('/api/memory/record/:recordId', (req: Request, res: Response) => {
  try {
    const workspacePath = getWorkspacePath();
    const recordId = String(req.params.recordId || '').trim();
    if (!recordId) {
      res.status(400).json({ success: false, error: 'recordId is required' });
      return;
    }
    const payload = readMemoryRecord(workspacePath, recordId);
    if (!payload.record) {
      res.status(404).json({ success: false, error: 'Record not found' });
      return;
    }
    const resolvedRecordId = String(payload.record?.id || recordId);
    const related = getRelatedMemory(workspacePath, resolvedRecordId, 10);
    const resolvedTimestamp = payload.record?.timestamp
      || (payload.record?.timestampMs ? new Date(payload.record.timestampMs).toISOString() : '')
      || payload.record?.updatedAt
      || payload.record?.createdAt
      || '';
    res.json({
      success: true,
      layer: payload.layer,
      record: {
        ...payload.record,
        timestamp: resolvedTimestamp,
      },
      noteMeta: readMemoryNoteMetadata(workspacePath, String(payload.record?.sourcePath || '')),
      chunks: (payload.chunks || []).map((chunk: any) => ({
        id: chunk.id,
        index: chunk.index,
        text: chunk.text,
      })),
      related,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to load memory record' });
  }
});

router.post('/api/memory/create', (req: Request, res: Response) => {
  try {
    const workspacePath = getWorkspacePath();
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const content = String(req.body?.content || '').trim();
    const attachmentsInput = Array.isArray(req.body?.attachments) ? req.body.attachments as CreateMemoryAttachmentInput[] : [];

    if (!title) {
      res.status(400).json({ success: false, error: 'title is required' });
      return;
    }
    if (!content && !description && attachmentsInput.length === 0) {
      res.status(400).json({ success: false, error: 'Provide memory text, a description, or at least one attachment.' });
      return;
    }

    const createdAt = new Date().toISOString();
    const noteId = `mem_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const day = createdAt.slice(0, 10);
    const slug = slugify(title) || noteId;
    const sourcePath = `memory/files/${day}/${slug}--${noteId}.md`;
    const noteAbsPath = path.join(workspacePath, 'audit', sourcePath.replace(/\//g, path.sep));
    const attachmentsDir = path.join(workspacePath, 'uploads', 'memory', day, noteId);
    const seenNames = new Set<string>();
    const attachments: MemoryNoteAttachment[] = [];

    for (const item of attachmentsInput) {
      const rawName = sanitizeFilename(String(item?.name || item?.filename || ''));
      const base64 = String(item?.base64 || '').trim();
      if (!rawName || !base64) {
        res.status(400).json({ success: false, error: 'Each attachment requires a filename and base64 payload.' });
        return;
      }
      const finalName = ensureUniqueFilename(seenNames, rawName);
      const pureBase64 = base64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(pureBase64, 'base64');
      fs.mkdirSync(attachmentsDir, { recursive: true });
      const absPath = path.join(attachmentsDir, finalName);
      fs.writeFileSync(absPath, buffer);
      attachments.push({
        name: finalName,
        path: path.relative(workspacePath, absPath).replace(/\\/g, '/'),
        kind: inferAttachmentKind(String(item?.mimeType || ''), finalName),
        mimeType: item?.mimeType ? String(item.mimeType).trim() : undefined,
        sizeBytes: buffer.length,
      });
    }

    fs.mkdirSync(path.dirname(noteAbsPath), { recursive: true });
    fs.writeFileSync(noteAbsPath, buildMemoryNoteDocument({
      id: noteId,
      title,
      description,
      createdAt,
      attachments,
      body: content,
    }), 'utf-8');

    refreshMemoryIndexFromAudit(workspacePath, { force: true, maxChangedFiles: 500 });
    const store = readIndexStore(workspacePath);
    const record = Object.values(store.records || {}).find((item) => item.sourcePath === sourcePath) || null;

    res.status(201).json({
      success: true,
      noteId,
      recordId: record?.id || null,
      sourcePath,
      absPath: noteAbsPath,
      title,
      attachments: attachments.map((attachment) => attachmentWithAbsPath(workspacePath, attachment)),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to create memory note' });
  }
});

router.post('/api/memory/refresh', (_req: Request, res: Response) => {
  try {
    const workspacePath = getWorkspacePath();
    const result = refreshMemoryIndexFromAudit(workspacePath, { force: true, maxChangedFiles: 500 });
    res.json({ success: true, ...result, sqlite: getSqliteMemoryStatus(workspacePath) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to refresh memory index' });
  }
});

router.get('/api/memory/sqlite/status', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...getSqliteMemoryStatus(getWorkspacePath()) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to read SQLite memory status' });
  }
});

export { router };
