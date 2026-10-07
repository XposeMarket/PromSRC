import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getPrometheusLayout } from '../../runtime/storage-layout.js';

// Schema 2 adds install-level first-start tracking. Onboarding must run exactly
// once per install: it is driven only by this persisted record, never by
// "is this a fresh page load" or "did the gateway just restart".
const SCHEMA_VERSION = 2;

/** Stable key used when Prometheus runs without accounts (the default). */
export const LOCAL_ONBOARDING_USER = 'local';

export type OnboardingStep = 'model' | 'meet' | 'memory_confirm' | 'tutorial' | 'done';
export type OnboardingSource = 'fresh' | 'existing_install';

export interface OnboardingFirstStart {
  at: string;
  version: string | null;
  surface: string | null;
  platform: string;
  source: OnboardingSource;
  /** Why an install was treated as pre-existing (grandfathered). */
  existingReason?: string | null;
}

export interface OnboardingRecord {
  firstSeenAt: string;
  firstStart?: OnboardingFirstStart;
  boots?: { count: number; lastAt: string | null; lastVersion: string | null; lastSurface: string | null };
  completedAt?: string | null;
  dismissedAt?: string | null;
  tutorial:     { shownAt: string | null; completedAt: string | null; skippedAt?: string | null; version: number };
  migration:    { completedAt: string | null; skippedAt: string | null; sourceId: string | null };
  model:        { firstConnectedAt: string | null; skippedAt?: string | null; provider: string | null; model: string | null };
  meetAndGreet: { startedAt: string | null; completedAt: string | null; sessionId: string | null; memorySeededAt: string | null };
}

interface OnboardingFile {
  schemaVersion: number;
  installId: string;
  users: Record<string, OnboardingRecord>;
}

export interface FirstStartContext {
  version?: string | null;
  surface?: string | null;
  /**
   * Returns a non-empty reason when this install was already in use before
   * onboarding tracking existed (connected model, chats, old account record).
   * Such installs are grandfathered as complete so upgrades never re-trigger
   * onboarding.
   */
  detectExisting?: () => string | null;
}

const TUTORIAL_VERSION = 2;

function dataDir(): string {
  const layout = getPrometheusLayout();
  if (layout.mode === 'canonical') return layout.runtime.root;
  return process.env.PROMETHEUS_DATA_DIR || path.join(os.homedir(), '.prometheus');
}

export function onboardingFilePath(): string {
  return path.join(dataDir(), 'onboarding.json');
}

function nowIso(): string { return new Date().toISOString(); }

function emptyRecord(): OnboardingRecord {
  return {
    firstSeenAt: nowIso(),
    boots: { count: 0, lastAt: null, lastVersion: null, lastSurface: null },
    completedAt: null,
    dismissedAt: null,
    tutorial:     { shownAt: null, completedAt: null, skippedAt: null, version: TUTORIAL_VERSION },
    migration:    { completedAt: null, skippedAt: null, sourceId: null },
    model:        { firstConnectedAt: null, skippedAt: null, provider: null, model: null },
    meetAndGreet: { startedAt: null, completedAt: null, sessionId: null, memorySeededAt: null },
  };
}

function normalizeRecord(rec: any): OnboardingRecord {
  const base = emptyRecord();
  const out: OnboardingRecord = {
    ...base,
    ...rec,
    boots:        { ...base.boots!, ...(rec?.boots || {}) },
    tutorial:     { ...base.tutorial, ...(rec?.tutorial || {}) },
    migration:    { ...base.migration, ...(rec?.migration || {}) },
    model:        { ...base.model, ...(rec?.model || {}) },
    meetAndGreet: { ...base.meetAndGreet, ...(rec?.meetAndGreet || {}) },
  };
  if (!out.firstSeenAt) out.firstSeenAt = base.firstSeenAt;
  return out;
}

function load(): OnboardingFile {
  const fp = onboardingFilePath();
  try {
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object') {
        const users: Record<string, OnboardingRecord> = {};
        for (const [id, rec] of Object.entries(parsed.users)) users[id] = normalizeRecord(rec);
        return {
          schemaVersion: SCHEMA_VERSION,
          installId: String(parsed.installId || crypto.randomUUID()),
          users,
        };
      }
    }
  } catch {
    // A corrupt file must never re-trigger onboarding for an existing user.
    // Keep the bad copy for diagnosis; the existing-install detector below
    // grandfathers any install that has real usage.
    try { fs.copyFileSync(fp, fp + '.corrupt-' + Date.now()); } catch { /* ignore */ }
  }
  return { schemaVersion: SCHEMA_VERSION, installId: crypto.randomUUID(), users: {} };
}

function save(file: OnboardingFile): void {
  const fp = onboardingFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...file, schemaVersion: SCHEMA_VERSION }, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

function markAllDone(rec: OnboardingRecord, at: string): void {
  rec.completedAt = rec.completedAt || at;
  rec.tutorial.shownAt = rec.tutorial.shownAt || at;
  rec.tutorial.completedAt = rec.tutorial.completedAt || at;
  if (!rec.migration.completedAt && !rec.migration.skippedAt) rec.migration.skippedAt = at;
  if (!rec.model.firstConnectedAt && !rec.model.skippedAt) rec.model.skippedAt = at;
  rec.meetAndGreet.completedAt = rec.meetAndGreet.completedAt || at;
  rec.meetAndGreet.memorySeededAt = rec.meetAndGreet.memorySeededAt || at;
}

/** Find an older record (account-era) that already finished or progressed. */
function findPriorRecord(file: OnboardingFile, exceptId: string): OnboardingRecord | null {
  for (const [id, rec] of Object.entries(file.users)) {
    if (id === exceptId) continue;
    if (rec.completedAt || rec.tutorial?.completedAt || rec.model?.firstConnectedAt || rec.meetAndGreet?.completedAt) return rec;
  }
  return null;
}

/**
 * Create the record for a user the first time it is requested, stamping the
 * one-and-only first start. Existing installs are grandfathered as complete.
 */
function createRecord(file: OnboardingFile, userId: string, ctx: FirstStartContext = {}): OnboardingRecord {
  const at = nowIso();
  const rec = emptyRecord();
  let existingReason: string | null = null;
  const prior = findPriorRecord(file, userId);
  if (prior) {
    existingReason = 'prior_onboarding_record';
  } else {
    try { existingReason = ctx.detectExisting?.() || null; } catch { existingReason = null; }
  }
  if (prior) {
    // Carry over what the account-era record already knew.
    rec.model = { ...rec.model, ...prior.model };
    rec.migration = { ...rec.migration, ...prior.migration };
  }
  rec.firstStart = {
    at,
    version: ctx.version || null,
    surface: ctx.surface || null,
    platform: process.platform,
    source: existingReason ? 'existing_install' : 'fresh',
    existingReason,
  };
  if (existingReason) markAllDone(rec, at);
  file.users[userId] = rec;
  return rec;
}

export function nextStep(rec: OnboardingRecord): OnboardingStep {
  if (rec.completedAt || rec.dismissedAt) return 'done';
  const modelConnected = !!rec.model.firstConnectedAt;
  if (!modelConnected && !rec.model.skippedAt) return 'model';
  // Meet & greet and memory seeding need a working model. When the user
  // skipped model setup we go straight to the tour instead of looping.
  if (modelConnected) {
    if (!rec.meetAndGreet.completedAt) return 'meet';
    if (!rec.meetAndGreet.memorySeededAt) return 'memory_confirm';
  }
  if (!rec.tutorial.completedAt && !rec.tutorial.skippedAt) return 'tutorial';
  return 'done';
}

function settle(rec: OnboardingRecord): void {
  if (!rec.completedAt && !rec.dismissedAt && nextStep(rec) === 'done') rec.completedAt = nowIso();
}

export function getRecord(userId: string, ctx: FirstStartContext = {}): OnboardingRecord {
  const file = load();
  const existing = file.users[userId];
  if (existing) return existing;
  const rec = createRecord(file, userId, ctx);
  save(file);
  return rec;
}

function mutate(userId: string, fn: (rec: OnboardingRecord) => void, ctx: FirstStartContext = {}): OnboardingRecord {
  const file = load();
  if (!file.users[userId]) createRecord(file, userId, ctx);
  fn(file.users[userId]);
  settle(file.users[userId]);
  save(file);
  return file.users[userId];
}

/**
 * Record one UI boot. This is telemetry only: it never resets or advances
 * onboarding, so restarts and reloads cannot trigger the flow.
 */
export function recordBoot(userId: string, ctx: FirstStartContext = {}): OnboardingRecord {
  return mutate(userId, r => {
    const boots = r.boots || { count: 0, lastAt: null, lastVersion: null, lastSurface: null };
    boots.count = (Number(boots.count) || 0) + 1;
    boots.lastAt = nowIso();
    boots.lastVersion = ctx.version || boots.lastVersion || null;
    boots.lastSurface = ctx.surface || boots.lastSurface || null;
    r.boots = boots;
  }, ctx);
}

export function markTutorialShown(userId: string): OnboardingRecord {
  return mutate(userId, r => { if (!r.tutorial.shownAt) r.tutorial.shownAt = nowIso(); });
}

export function markTutorialComplete(userId: string, skipped = false): OnboardingRecord {
  return mutate(userId, r => {
    const now = nowIso();
    if (!r.tutorial.shownAt) r.tutorial.shownAt = now;
    if (skipped) r.tutorial.skippedAt = now;
    else r.tutorial.completedAt = now;
    r.tutorial.version = TUTORIAL_VERSION;
  });
}

export function markMigrationComplete(userId: string, sourceId: string | null, skipped = false): OnboardingRecord {
  return mutate(userId, r => {
    const now = nowIso();
    r.migration.completedAt = skipped ? null : now;
    r.migration.skippedAt = skipped ? now : null;
    r.migration.sourceId = sourceId;
  });
}

export function markModelConnected(userId: string, provider: string, model: string): OnboardingRecord {
  return mutate(userId, r => {
    if (!r.model.firstConnectedAt) r.model.firstConnectedAt = nowIso();
    r.model.skippedAt = null;
    r.model.provider = provider;
    r.model.model = model;
  });
}

export function markModelSkipped(userId: string): OnboardingRecord {
  return mutate(userId, r => { if (!r.model.firstConnectedAt) r.model.skippedAt = nowIso(); });
}

/** User chose "skip setup": never auto-show onboarding again on this install. */
export function dismissOnboarding(userId: string): OnboardingRecord {
  return mutate(userId, r => { r.dismissedAt = r.dismissedAt || nowIso(); });
}

export function startMeet(userId: string, sessionId: string): OnboardingRecord {
  return mutate(userId, r => {
    if (!r.meetAndGreet.startedAt) r.meetAndGreet.startedAt = nowIso();
    r.meetAndGreet.sessionId = sessionId;
  });
}

export function completeMeet(userId: string): OnboardingRecord {
  return mutate(userId, r => { r.meetAndGreet.completedAt = nowIso(); });
}

export function markMemorySeeded(userId: string): OnboardingRecord {
  return mutate(userId, r => { r.meetAndGreet.memorySeededAt = nowIso(); });
}

// Soft replay: clears tutorial + meet + memory-seed flags so those steps run
// again. Leaves model.firstConnectedAt intact so the user is not asked to
// reconnect their model. firstStart is never cleared.
export function replayTutorial(userId: string): OnboardingRecord {
  return mutate(userId, r => {
    r.completedAt = null;
    r.dismissedAt = null;
    r.tutorial.shownAt = null;
    r.tutorial.completedAt = null;
    r.tutorial.skippedAt = null;
    r.migration.completedAt = null;
    r.migration.skippedAt = null;
    r.migration.sourceId = null;
    r.meetAndGreet.startedAt = null;
    r.meetAndGreet.completedAt = null;
    r.meetAndGreet.sessionId = null;
    r.meetAndGreet.memorySeededAt = null;
    if (!r.model.firstConnectedAt) r.model.skippedAt = null;
  });
}

export function reset(userId: string): void {
  const file = load();
  delete file.users[userId];
  save(file);
}

export function getInstallId(): string {
  const file = load();
  if (!fs.existsSync(onboardingFilePath())) save(file);
  return file.installId;
}
