import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import {
  getMemoryGraphSnapshot,
  readMemoryRecord,
  getRelatedMemory,
  refreshMemoryIndexFromAudit,
} from '../memory-index';

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
    const related = getRelatedMemory(workspacePath, recordId, 10);
    if (!payload.record) {
      res.status(404).json({ success: false, error: 'Record not found' });
      return;
    }
    res.json({
      success: true,
      record: {
        ...payload.record,
        timestamp: payload.record?.timestampMs ? new Date(payload.record.timestampMs).toISOString() : '',
      },
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

router.post('/api/memory/refresh', (_req: Request, res: Response) => {
  try {
    const workspacePath = getWorkspacePath();
    const result = refreshMemoryIndexFromAudit(workspacePath, { force: true, maxChangedFiles: 500 });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to refresh memory index' });
  }
});

export { router };
