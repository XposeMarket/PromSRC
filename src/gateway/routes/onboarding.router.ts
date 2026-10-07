import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getCurrentUserId, isAccountRequired } from './account.router';
import {
  getRecord, nextStep, reset, getInstallId, recordBoot,
  markTutorialShown, markTutorialComplete,
  markMigrationComplete,
  markModelConnected, markModelSkipped, dismissOnboarding,
  startMeet, completeMeet, markMemorySeeded,
  replayTutorial, LOCAL_ONBOARDING_USER, FirstStartContext,
} from '../onboarding/onboarding-store';
import { redoOnboarding } from '../onboarding/redo-onboarding';
import { planSeed, applySeed, OnboardingProfile } from '../onboarding/memory-seed';
import { checkModelHealth } from '../onboarding/model-health';
import { detectExistingInstall } from '../onboarding/existing-install';

export const router = Router();

/**
 * Onboarding is tracked per install. With accounts disabled (the default) the
 * record key is the stable "local" user; when the account gate is on we keep
 * the per-account key so multi-account installs still work.
 */
function onboardingUser(res: any): string | null {
  if (!isAccountRequired()) return LOCAL_ONBOARDING_USER;
  const userId = getCurrentUserId();
  if (!userId) {
    res.status(401).json({ error: 'Account login required' });
    return null;
  }
  return userId;
}

let cachedVersion: string | null | undefined;
function appVersion(): string | null {
  if (cachedVersion !== undefined) return cachedVersion;
  cachedVersion = String(process.env.PROMETHEUS_VERSION || '').trim() || null;
  if (!cachedVersion) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
      cachedVersion = String(pkg?.version || '') || null;
    } catch { cachedVersion = null; }
  }
  return cachedVersion;
}

function surfaceOf(req: any): string {
  const raw = String(req?.body?.surface || req?.query?.surface || '').trim().toLowerCase();
  if (raw) return raw.slice(0, 32);
  return process.env.PROMETHEUS_ELECTRON_MANAGED === '1' ? 'electron' : 'web';
}

function ctx(req: any): FirstStartContext {
  return { version: appVersion(), surface: surfaceOf(req), detectExisting: detectExistingInstall };
}

function statusPayload(userId: string, req?: any) {
  const record = getRecord(userId, ctx(req));
  return {
    installId: getInstallId(),
    userId,
    accountRequired: isAccountRequired(),
    record,
    nextStep: nextStep(record),
  };
}

router.get('/api/onboarding/status', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  res.json(statusPayload(userId, req));
});

// Called once per UI boot. Records boot telemetry only. It never advances or
// resets onboarding, so restarts/reloads cannot re-trigger the flow.
router.post('/api/onboarding/boot', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  recordBoot(userId, ctx(req));
  res.json(statusPayload(userId, req));
});

router.post('/api/onboarding/dismiss', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  dismissOnboarding(userId);
  res.json(statusPayload(userId, req));
});

router.post('/api/onboarding/tutorial-shown', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  markTutorialShown(userId);
  res.json(statusPayload(userId, req));
});

router.post('/api/onboarding/tutorial-complete', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  markTutorialComplete(userId, req.body?.skipped === true);
  res.json(statusPayload(userId, req));
});

router.post('/api/onboarding/migration-complete', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  const sourceId = typeof req.body?.sourceId === 'string' ? req.body.sourceId : null;
  const skipped = req.body?.skipped !== false;
  markMigrationComplete(userId, sourceId, skipped);
  res.json(statusPayload(userId, req));
});

router.get('/api/onboarding/model/health', async (_req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  const health = await checkModelHealth();
  res.json(health);
});

router.post('/api/onboarding/model-connected', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  const provider = String(req.body?.provider || '').trim();
  const model    = String(req.body?.model    || '').trim();
  if (!provider || !model) {
    res.status(400).json({ error: 'provider and model are required' });
    return;
  }
  markModelConnected(userId, provider, model);
  res.json(statusPayload(userId, req));
});

router.post('/api/onboarding/model-skipped', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  markModelSkipped(userId);
  res.json(statusPayload(userId, req));
});

router.post('/api/onboarding/meet/start', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  const sessionId = `onboarding_${userId}_${Date.now()}`;
  startMeet(userId, sessionId);
  res.json({ ...statusPayload(userId, req), sessionId });
});

router.post('/api/onboarding/meet/complete', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  completeMeet(userId);
  res.json(statusPayload(userId, req));
});

router.post('/api/onboarding/memory-seed', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
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
  res.json({ ...statusPayload(userId, req), written });
});

router.post('/api/onboarding/reset', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  reset(userId);
  res.json({ ok: true, userId });
});

router.post('/api/onboarding/replay-tutorial', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  replayTutorial(userId);
  res.json(statusPayload(userId, req));
});

router.post('/api/onboarding/redo', (req, res) => {
  const userId = onboardingUser(res); if (!userId) return;
  // Server-side guard echoing the UI's triple-gate. The body must include
  // confirmPhrase exactly equal to "redo onboarding" so that even a misfired
  // POST cannot wipe data without explicit intent.
  const phrase = String(req.body?.confirmPhrase || '').trim().toLowerCase();
  if (phrase !== 'redo onboarding') {
    res.status(400).json({ error: 'confirmation_phrase_required', expected: 'redo onboarding' });
    return;
  }
  const result = redoOnboarding(userId);
  res.json({ ok: true, userId, ...result, status: statusPayload(userId, req) });
});
