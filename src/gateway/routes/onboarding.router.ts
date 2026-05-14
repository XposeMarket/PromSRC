import { Router } from 'express';
import { getCurrentUserId } from './account.router';
import {
  getRecord, nextStep, reset, getInstallId,
  markTutorialShown, markTutorialComplete,
  markMigrationComplete,
  markModelConnected,
  startMeet, completeMeet, markMemorySeeded,
  replayTutorial,
} from '../onboarding/onboarding-store';
import { redoOnboarding } from '../onboarding/redo-onboarding';
import { planSeed, applySeed, OnboardingProfile } from '../onboarding/memory-seed';
import { checkModelHealth } from '../onboarding/model-health';

export const router = Router();

function requireUser(res: any): string | null {
  const userId = getCurrentUserId();
  if (!userId) {
    res.status(401).json({ error: 'Account login required' });
    return null;
  }
  return userId;
}

function statusPayload(userId: string) {
  const record = getRecord(userId);
  return { installId: getInstallId(), userId, record, nextStep: nextStep(record) };
}

router.get('/api/onboarding/status', (_req, res) => {
  const userId = requireUser(res); if (!userId) return;
  res.json(statusPayload(userId));
});

router.post('/api/onboarding/tutorial-shown', (_req, res) => {
  const userId = requireUser(res); if (!userId) return;
  markTutorialShown(userId);
  res.json(statusPayload(userId));
});

router.post('/api/onboarding/tutorial-complete', (_req, res) => {
  const userId = requireUser(res); if (!userId) return;
  markTutorialComplete(userId);
  res.json(statusPayload(userId));
});

router.post('/api/onboarding/migration-complete', (req, res) => {
  const userId = requireUser(res); if (!userId) return;
  const sourceId = typeof req.body?.sourceId === 'string' ? req.body.sourceId : null;
  const skipped = req.body?.skipped !== false;
  markMigrationComplete(userId, sourceId, skipped);
  res.json(statusPayload(userId));
});

router.get('/api/onboarding/model/health', async (_req, res) => {
  const userId = requireUser(res); if (!userId) return;
  const health = await checkModelHealth();
  res.json(health);
});

router.post('/api/onboarding/model-connected', (req, res) => {
  const userId = requireUser(res); if (!userId) return;
  const provider = String(req.body?.provider || '').trim();
  const model    = String(req.body?.model    || '').trim();
  if (!provider || !model) {
    res.status(400).json({ error: 'provider and model are required' });
    return;
  }
  markModelConnected(userId, provider, model);
  res.json(statusPayload(userId));
});

router.post('/api/onboarding/meet/start', (_req, res) => {
  const userId = requireUser(res); if (!userId) return;
  const sessionId = `onboarding_${userId}_${Date.now()}`;
  startMeet(userId, sessionId);
  res.json({ ...statusPayload(userId), sessionId });
});

router.post('/api/onboarding/meet/complete', (_req, res) => {
  const userId = requireUser(res); if (!userId) return;
  completeMeet(userId);
  res.json(statusPayload(userId));
});

router.post('/api/onboarding/memory-seed', (req, res) => {
  const userId = requireUser(res); if (!userId) return;
  const profile: OnboardingProfile = {
    name:                String(req.body?.profile?.name || '').trim() || undefined,
    workingOn:           String(req.body?.profile?.workingOn || '').trim() || undefined,
    helpWanted:          String(req.body?.profile?.helpWanted || '').trim() || undefined,
    businessContext:     String(req.body?.profile?.businessContext || '').trim() || undefined,
    workingPreferences:  String(req.body?.profile?.workingPreferences || '').trim() || undefined,
    thingsToAvoid:       String(req.body?.profile?.thingsToAvoid || '').trim() || undefined,
    toolsAndAccounts:    String(req.body?.profile?.toolsAndAccounts || '').trim() || undefined,
  };
  const plans = planSeed(profile);
  const dryRun = req.query?.dryRun === 'true' || req.body?.dryRun === true;
  if (dryRun) {
    res.json({ dryRun: true, plans });
    return;
  }
  const approved: string[] = Array.isArray(req.body?.approvedPaths)
    ? req.body.approvedPaths.map((s: any) => String(s))
    : plans.filter(p => p.changed).map(p => p.path);
  const written = applySeed(plans, approved);
  markMemorySeeded(userId);
  res.json({ ...statusPayload(userId), written });
});

router.post('/api/onboarding/reset', (_req, res) => {
  const userId = requireUser(res); if (!userId) return;
  reset(userId);
  res.json({ ok: true, userId });
});

router.post('/api/onboarding/replay-tutorial', (_req, res) => {
  const userId = requireUser(res); if (!userId) return;
  replayTutorial(userId);
  res.json(statusPayload(userId));
});

router.post('/api/onboarding/redo', (req, res) => {
  const userId = requireUser(res); if (!userId) return;
  // Server-side guard echoing the UI's triple-gate. The body must include
  // confirmPhrase exactly equal to "redo onboarding" so that even a misfired
  // POST cannot wipe data without explicit intent.
  const phrase = String(req.body?.confirmPhrase || '').trim().toLowerCase();
  if (phrase !== 'redo onboarding') {
    res.status(400).json({ error: 'confirmation_phrase_required', expected: 'redo onboarding' });
    return;
  }
  const result = redoOnboarding(userId);
  res.json({ ok: true, userId, ...result, status: statusPayload(userId) });
});
