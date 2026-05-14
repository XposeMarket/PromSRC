import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const SCHEMA_VERSION = 1;

export interface OnboardingRecord {
  firstSeenAt: string;
  tutorial:     { shownAt: string | null; completedAt: string | null; version: number };
  migration:    { completedAt: string | null; skippedAt: string | null; sourceId: string | null };
  model:        { firstConnectedAt: string | null; provider: string | null; model: string | null };
  meetAndGreet: { startedAt: string | null; completedAt: string | null; sessionId: string | null; memorySeededAt: string | null };
}

interface OnboardingFile {
  schemaVersion: number;
  installId: string;
  users: Record<string, OnboardingRecord>;
}

function dataDir(): string {
  return process.env.PROMETHEUS_DATA_DIR || path.join(os.homedir(), '.prometheus');
}

function filePath(): string {
  return path.join(dataDir(), 'onboarding.json');
}

function emptyRecord(): OnboardingRecord {
  return {
    firstSeenAt: new Date().toISOString(),
    tutorial:     { shownAt: null, completedAt: null, version: 1 },
    migration:    { completedAt: null, skippedAt: null, sourceId: null },
    model:        { firstConnectedAt: null, provider: null, model: null },
    meetAndGreet: { startedAt: null, completedAt: null, sessionId: null, memorySeededAt: null },
  };
}

function load(): OnboardingFile {
  const fp = filePath();
  try {
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.users) return parsed as OnboardingFile;
    }
  } catch { /* fall through */ }
  return { schemaVersion: SCHEMA_VERSION, installId: crypto.randomUUID(), users: {} };
}

function save(file: OnboardingFile): void {
  const fp = filePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

export function getRecord(userId: string): OnboardingRecord {
  const file = load();
  if (!file.users[userId]) {
    file.users[userId] = emptyRecord();
    save(file);
  } else if (!(file.users[userId] as any).migration) {
    (file.users[userId] as any).migration = { completedAt: null, skippedAt: null, sourceId: null };
    save(file);
  }
  return file.users[userId];
}

export function nextStep(rec: OnboardingRecord): 'tutorial' | 'migration' | 'model' | 'meet' | 'memory_confirm' | 'done' {
  if (!rec.tutorial.completedAt) return 'tutorial';
  if (!rec.migration?.completedAt && !rec.migration?.skippedAt) return 'migration';
  if (!rec.model.firstConnectedAt) return 'model';
  if (!rec.meetAndGreet.completedAt) return 'meet';
  if (!rec.meetAndGreet.memorySeededAt) return 'memory_confirm';
  return 'done';
}

function mutate(userId: string, fn: (rec: OnboardingRecord) => void): OnboardingRecord {
  const file = load();
  if (!file.users[userId]) file.users[userId] = emptyRecord();
  if (!(file.users[userId] as any).migration) {
    (file.users[userId] as any).migration = { completedAt: null, skippedAt: null, sourceId: null };
  }
  fn(file.users[userId]);
  save(file);
  return file.users[userId];
}

export function markTutorialShown(userId: string): OnboardingRecord {
  return mutate(userId, r => { if (!r.tutorial.shownAt) r.tutorial.shownAt = new Date().toISOString(); });
}

export function markTutorialComplete(userId: string): OnboardingRecord {
  return mutate(userId, r => {
    const now = new Date().toISOString();
    if (!r.tutorial.shownAt) r.tutorial.shownAt = now;
    r.tutorial.completedAt = now;
  });
}

export function markMigrationComplete(userId: string, sourceId: string | null, skipped = false): OnboardingRecord {
  return mutate(userId, r => {
    if (!r.migration) r.migration = { completedAt: null, skippedAt: null, sourceId: null };
    const now = new Date().toISOString();
    r.migration.completedAt = skipped ? null : now;
    r.migration.skippedAt = skipped ? now : null;
    r.migration.sourceId = sourceId;
  });
}

export function markModelConnected(userId: string, provider: string, model: string): OnboardingRecord {
  return mutate(userId, r => {
    if (!r.model.firstConnectedAt) r.model.firstConnectedAt = new Date().toISOString();
    r.model.provider = provider;
    r.model.model = model;
  });
}

export function startMeet(userId: string, sessionId: string): OnboardingRecord {
  return mutate(userId, r => {
    if (!r.meetAndGreet.startedAt) r.meetAndGreet.startedAt = new Date().toISOString();
    r.meetAndGreet.sessionId = sessionId;
  });
}

export function completeMeet(userId: string): OnboardingRecord {
  return mutate(userId, r => { r.meetAndGreet.completedAt = new Date().toISOString(); });
}

export function markMemorySeeded(userId: string): OnboardingRecord {
  return mutate(userId, r => { r.meetAndGreet.memorySeededAt = new Date().toISOString(); });
}

// Soft replay: clears tutorial + meet + memory-seed flags so those steps run
// again. Leaves model.firstConnectedAt intact so the user is not asked to
// reconnect their model.
export function replayTutorial(userId: string): OnboardingRecord {
  return mutate(userId, r => {
    r.tutorial.shownAt = null;
    r.tutorial.completedAt = null;
    if (!r.migration) r.migration = { completedAt: null, skippedAt: null, sourceId: null };
    r.migration.completedAt = null;
    r.migration.skippedAt = null;
    r.migration.sourceId = null;
    r.meetAndGreet.startedAt = null;
    r.meetAndGreet.completedAt = null;
    r.meetAndGreet.sessionId = null;
    r.meetAndGreet.memorySeededAt = null;
  });
}

export function reset(userId: string): void {
  const file = load();
  delete file.users[userId];
  save(file);
}

export function getInstallId(): string {
  return load().installId;
}
