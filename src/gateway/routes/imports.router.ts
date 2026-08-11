import { Router } from 'express';

import { getConfig } from '../../config/config';
import { getCurrentUserId } from './account.router';
import {
  confirmImportJob,
  createImportJob,
  deleteImportJob,
  getImportJob,
  listImportJobs,
  retryImportJob,
  rollbackImportJob,
} from '../imports/import-service';
import { discoverImportSources } from '../imports/import-discovery';
import type { ConversationImportMode, ImportAdapterId, ImportJobKind, SetupImportScope } from '../imports/import-types';

export const router = Router();

function ownerId(): string {
  return getCurrentUserId() || 'local';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Import operation failed.');
}

function normalizeAdapter(value: unknown): ImportAdapterId | undefined {
  const allowed: ImportAdapterId[] = [
    'chatgpt-export', 'generic-json', 'generic-jsonl', 'generic-markdown',
    'codex-local', 'claude-code-local', 'cursor-local', 'hermes-local',
    'openclaw-local', 'localclaw-local', 'setup-config', 'unsupported',
  ];
  const item = String(value || '').trim() as ImportAdapterId;
  return allowed.includes(item) ? item : undefined;
}

function normalizeKind(value: unknown): ImportJobKind {
  return String(value || '').trim().toLowerCase() === 'setup' ? 'setup' : 'conversation';
}

function normalizeConversationMode(value: unknown): ConversationImportMode {
  // Project boundaries are detected automatically. Keep an explicit
  // `sessions` value for backwards-compatible API callers, but omit it from
  // the new General settings UI.
  return String(value || '').trim().toLowerCase() === 'sessions' ? 'sessions' : 'projects';
}

function normalizeSetupScope(value: unknown): SetupImportScope {
  return String(value || '').trim().toLowerCase() === 'all' ? 'all' : 'mcp';
}

router.get('/api/imports/jobs', (_req, res) => {
  try {
    res.json({ success: true, jobs: listImportJobs(ownerId()) });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

/**
 * Read-only scan of bounded, well-known local agent locations. This never
 * stages or parses source files; the returned candidates still go through the
 * normal preview and explicit-confirmation import pipeline.
 */
router.get('/api/imports/discover', (_req, res) => {
  try {
    res.json({ success: true, ...discoverImportSources() });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

router.get('/api/imports/jobs/:id', (req, res) => {
  try {
    const job = getImportJob(String(req.params.id || ''), ownerId());
    if (!job) {
      res.status(404).json({ success: false, error: 'Import job not found.' });
      return;
    }
    res.json({ success: true, job });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

/**
 * Stage and parse an import. No active Prometheus state is changed here.
 * Desktop builds can pass a local sourcePath; browser clients can pass a
 * bounded sourceText/sourceBase64 payload.
 */
router.post('/api/imports/jobs', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sourcePath = typeof body.sourcePath === 'string' ? body.sourcePath.trim() : undefined;
    const sourceText = typeof body.sourceText === 'string' ? body.sourceText : undefined;
    const sourceBase64 = typeof body.sourceBase64 === 'string' ? body.sourceBase64 : undefined;
    const sourceFiles = Array.isArray(body.sourceFiles)
      ? body.sourceFiles.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim()).filter(Boolean).slice(0, 8_000)
      : undefined;
    if (!sourcePath && sourceText === undefined && sourceBase64 === undefined) {
      res.status(400).json({ success: false, error: 'Provide a local source path or upload source data.' });
      return;
    }
    const created = await createImportJob({
      ownerId: ownerId(),
      workspacePath: getConfig().getWorkspacePath(),
      kind: normalizeKind(body.kind),
      sourcePath,
      sourceText,
      sourceBase64,
      sourceLabel: typeof body.sourceLabel === 'string' ? body.sourceLabel.trim() : undefined,
      requestedAdapter: normalizeAdapter(body.adapter || body.requestedAdapter),
      sourceAccountId: typeof body.sourceAccountId === 'string' ? body.sourceAccountId.trim() : undefined,
      overwrite: body.overwrite === true,
      conversationMode: normalizeKind(body.kind) === 'conversation' ? normalizeConversationMode(body.conversationMode) : undefined,
      setupScope: normalizeKind(body.kind) === 'setup' ? normalizeSetupScope(body.setupScope) : undefined,
      sourceFiles,
    });
    res.status(created.idempotent ? 200 : 201).json({ success: true, idempotent: created.idempotent, job: created.job });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

router.post('/api/imports/jobs/:id/confirm', async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      res.status(400).json({ success: false, error: 'Explicit confirmation is required.' });
      return;
    }
    const conversationIds = Array.isArray(req.body?.conversationIds)
      ? req.body.conversationIds
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => value.trim())
        .filter(Boolean)
        .slice(0, 10_000)
      : undefined;
    const job = await confirmImportJob(String(req.params.id || ''), ownerId(), conversationIds);
    res.json({ success: true, job });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

router.post('/api/imports/jobs/:id/retry', async (req, res) => {
  try {
    const job = await retryImportJob(String(req.params.id || ''), ownerId());
    res.json({ success: true, job });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

router.post('/api/imports/jobs/:id/rollback', (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      res.status(400).json({ success: false, error: 'Explicit rollback confirmation is required.' });
      return;
    }
    const job = rollbackImportJob(String(req.params.id || ''), ownerId());
    res.json({ success: true, job });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});

router.delete('/api/imports/jobs/:id', (req, res) => {
  try {
    deleteImportJob(String(req.params.id || ''), ownerId());
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: errorMessage(error) });
  }
});
