import { Router } from 'express';
import {
  getMigrationReport,
  listMigrationReports,
  listMigrationSources,
  runMigration,
  MigrationOptions,
} from '../migration/migration-service';

export const router = Router();

router.get('/api/migration/sources', (_req, res) => {
  try {
    res.json({ success: true, sources: listMigrationSources(), reports: listMigrationReports() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to scan migration sources' });
  }
});

router.post('/api/migration/preview', (req, res) => {
  try {
    const options = normalizeOptions(req.body || {});
    const report = runMigration({ ...options, execute: false });
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Migration preview failed' });
  }
});

router.post('/api/migration/execute', (req, res) => {
  try {
    const options = normalizeOptions(req.body || {});
    const report = runMigration({ ...options, execute: true });
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Migration failed' });
  }
});

router.get('/api/migration/reports', (_req, res) => {
  try {
    res.json({ success: true, reports: listMigrationReports() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to list migration reports' });
  }
});

router.get('/api/migration/reports/:id', (req, res) => {
  try {
    const report = getMigrationReport(String(req.params.id || ''));
    if (!report) {
      res.status(404).json({ success: false, error: 'Migration report not found' });
      return;
    }
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to load migration report' });
  }
});

function normalizeOptions(raw: any): MigrationOptions {
  const mode = raw.mode === 'full' ? 'full' : 'user-data';
  const skillConflict = raw.skillConflict === 'overwrite' || raw.skillConflict === 'rename'
    ? raw.skillConflict
    : 'skip';
  const sourceKind = ['hermes', 'openclaw', 'localclaw', 'custom'].includes(raw.sourceKind)
    ? raw.sourceKind
    : undefined;
  return {
    sourceId: typeof raw.sourceId === 'string' ? raw.sourceId : undefined,
    sourcePath: typeof raw.sourcePath === 'string' && raw.sourcePath.trim() ? raw.sourcePath.trim() : undefined,
    sourceKind,
    mode,
    includeSecrets: raw.includeSecrets === true || mode === 'full',
    overwrite: raw.overwrite === true,
    skillConflict,
    categories: Array.isArray(raw.categories) ? raw.categories.map((v: any) => String(v)) : undefined,
  };
}
