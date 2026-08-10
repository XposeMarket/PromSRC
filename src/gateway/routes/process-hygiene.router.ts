import express from 'express';
import { getConfig } from '../../config/config';
import { listBrowserSessions } from '../browser-tools';
import {
  buildProcessHygieneReport,
  type BrowserHygieneSession,
} from '../process-hygiene';

export const router = express.Router();

function snapshotBrowserSessions(): BrowserHygieneSession[] {
  // Keep the observer's input deliberately narrower than the browser registry.
  // In particular, URLs, titles, profile directories, labels, and prompts never
  // cross into the hygiene report.
  return listBrowserSessions().slice(0, 250).map((session) => ({
    sessionId: String(session.sessionId || '').slice(0, 160),
    ownerType: String(session.ownerType || '').slice(0, 80),
    ownerId: String(session.ownerId || '').slice(0, 160),
    profileKind: session.profileKind === 'user' || session.profileKind === 'inhouse' || session.profileKind === 'prometheus'
      ? session.profileKind
      : undefined,
    browserTarget: session.browserTarget === 'user' || session.browserTarget === 'inhouse' || session.browserTarget === 'prometheus'
      ? session.browserTarget
      : undefined,
    active: session.active === true,
    streamActive: session.streamActive === true,
    createdAt: Number(session.createdAt || 0) || undefined,
    updatedAt: Number(session.updatedAt || 0) || undefined,
  }));
}

async function makeReport(mode: 'observe' | 'dry_run') {
  return buildProcessHygieneReport({
    configDir: getConfig().getConfigDir(),
    mode,
    browserSessions: snapshotBrowserSessions(),
  });
}

router.get('/api/process-hygiene/report', async (_req, res) => {
  try {
    res.json({ success: true, report: await makeReport('observe') });
  } catch {
    res.status(503).json({ success: false, error: 'process_hygiene_observer_unavailable' });
  }
});

router.get('/api/process-hygiene/dry-run', async (_req, res) => {
  try {
    res.json({ success: true, report: await makeReport('dry_run') });
  } catch {
    res.status(503).json({ success: false, error: 'process_hygiene_observer_unavailable' });
  }
});

router.get('/api/process-hygiene/thought-summary', async (_req, res) => {
  try {
    const report = await makeReport('observe');
    res.json({ success: true, thoughtSummary: report.thoughtSummary });
  } catch {
    res.status(503).json({ success: false, error: 'process_hygiene_observer_unavailable' });
  }
});

