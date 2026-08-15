from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Persist an explicit Thought coverage cursor. lastThoughtAt remains the
# completion timestamp used by UI/status; lastThoughtWindowEndAt is the exact
# half-open activity boundary consumed by the successful Thought.
replace_once(
    'src/gateway/brain/brain-state.ts',
    "  /** ISO timestamp of the last thought run */\n  lastThoughtAt: string | null;\n",
    "  /** ISO timestamp of the last thought run completion */\n  lastThoughtAt: string | null;\n  /** Exact end boundary of the last successfully covered Thought activity window */\n  lastThoughtWindowEndAt: string | null;\n",
)
replace_once(
    'src/gateway/brain/brain-state.ts',
    "    lastThoughtAt: null,\n    lastThoughtAttemptAt: null,\n",
    "    lastThoughtAt: null,\n    lastThoughtWindowEndAt: null,\n    lastThoughtAttemptAt: null,\n",
)
insert_anchor = "export function markGatewayStarted(): void {\n"
state = Path('src/gateway/brain/brain-state.ts').read_text(encoding='utf-8')
if insert_anchor not in state:
    raise SystemExit('brain-state insertion anchor missing')
helper = """/**\n * Returns the durable end boundary of activity already consumed by Thoughts.\n * Older state files predate the explicit cursor, so lastThoughtAt is retained as\n * a migration fallback only.\n */\nexport function resolveThoughtCoverageCursor(\n  state: Pick<BrainLatestState, 'lastThoughtWindowEndAt' | 'lastThoughtAt'>,\n): Date | null {\n  for (const candidate of [state.lastThoughtWindowEndAt, state.lastThoughtAt]) {\n    if (!candidate) continue;\n    const parsed = new Date(candidate);\n    if (Number.isFinite(parsed.getTime())) return parsed;\n  }\n  return null;\n}\n\n"""
state = state.replace(insert_anchor, helper + insert_anchor, 1)
Path('src/gateway/brain/brain-state.ts').write_text(state, encoding='utf-8')

# 2) Make continuation artifacts idempotent. They are complete snapshots of a
# deterministic omitted-event slice, not append-only journals.
activity = Path('src/gateway/brain/activity-package.ts').read_text(encoding='utf-8')
anchor = "function appendJsonl(filePath: string, rows: unknown[]): void {\n  fs.mkdirSync(path.dirname(filePath), { recursive: true });\n  fs.appendFileSync(filePath, rows.map((row) => `${JSON.stringify(row)}\\n`).join(''), 'utf8');\n}\n\n"
if activity.count(anchor) != 1:
    raise SystemExit('activity appendJsonl anchor mismatch')
activity = activity.replace(anchor, anchor + """function writeJsonlSnapshot(filePath: string, rows: unknown[]): void {\n  fs.mkdirSync(path.dirname(filePath), { recursive: true });\n  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;\n  try {\n    fs.writeFileSync(tmp, rows.map((row) => `${JSON.stringify(row)}\\n`).join(''), 'utf8');\n    fs.renameSync(tmp, filePath);\n  } finally {\n    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort temp cleanup */ }\n  }\n}\n\n""", 1)
old = "      appendJsonl(filePath, rows);\n      const raw = fs.readFileSync(filePath);\n"
if activity.count(old) != 1:
    raise SystemExit('continuation write call mismatch')
activity = activity.replace(old, "      writeJsonlSnapshot(filePath, rows);\n      const raw = fs.readFileSync(filePath);\n", 1)
Path('src/gateway/brain/activity-package.ts').write_text(activity, encoding='utf-8')

# 3) Centralize sidecar integrity classification so the runner can recover a
# genuinely missing optional sidecar without silently erasing malformed/stale
# model output.
Path('src/gateway/brain/brain-artifact-integrity.ts').write_text(r'''import fs from 'fs';
import type { BrainCarryForwardDecisionFile } from './brain-continuity.js';
import { parseBrainCarryForwardDecision, parseBrainThoughtCapsules } from './brain-continuity.js';

export type BrainArtifactStatus = 'missing' | 'stale' | 'invalid' | 'valid';

export interface BrainThoughtCapsuleArtifactInspection {
  status: BrainArtifactStatus;
  count: number;
  error?: string;
}

export interface BrainCarryForwardArtifactInspection {
  status: BrainArtifactStatus;
  decision: BrainCarryForwardDecisionFile | null;
  error?: string;
}

function isFresh(filePath: string, runStartedAt: number): boolean {
  try {
    return fs.statSync(filePath).mtimeMs >= (runStartedAt - 5000);
  } catch {
    return false;
  }
}

export function inspectBrainThoughtCapsuleArtifact(
  filePath: string,
  runStartedAt: number,
): BrainThoughtCapsuleArtifactInspection {
  if (!fs.existsSync(filePath)) return { status: 'missing', count: 0 };
  if (!isFresh(filePath, runStartedAt)) return { status: 'stale', count: 0 };
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsedRaw = JSON.parse(raw);
    if (!Array.isArray(parsedRaw)) {
      return { status: 'invalid', count: 0, error: 'capsule sidecar must be a JSON array' };
    }
    const parsed = parseBrainThoughtCapsules(raw);
    if (parsed.length !== parsedRaw.length) {
      return {
        status: 'invalid',
        count: parsed.length,
        error: `capsule sidecar contains ${parsedRaw.length - parsed.length} invalid entr${parsedRaw.length - parsed.length === 1 ? 'y' : 'ies'}`,
      };
    }
    return { status: 'valid', count: parsed.length };
  } catch (error: any) {
    return { status: 'invalid', count: 0, error: String(error?.message || error || 'invalid JSON') };
  }
}

export function inspectBrainCarryForwardArtifact(
  filePath: string,
  runStartedAt: number,
  targetDate: string,
): BrainCarryForwardArtifactInspection {
  if (!fs.existsSync(filePath)) return { status: 'missing', decision: null };
  if (!isFresh(filePath, runStartedAt)) return { status: 'stale', decision: null };
  try {
    const decision = parseBrainCarryForwardDecision(fs.readFileSync(filePath, 'utf-8'));
    if (!decision) return { status: 'invalid', decision: null, error: 'carry-forward sidecar is not valid decision JSON' };
    if (decision.targetDate !== targetDate) {
      return {
        status: 'invalid',
        decision: null,
        error: `carry-forward targetDate ${decision.targetDate} does not match ${targetDate}`,
      };
    }
    return { status: 'valid', decision };
  } catch (error: any) {
    return { status: 'invalid', decision: null, error: String(error?.message || error || 'invalid carry-forward JSON') };
  }
}
''', encoding='utf-8')

# 4) Wire the explicit cursor and artifact inspection into BrainRunner.
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "  fmtLocal,\n  type BrainLatestState,\n} from './brain-state';\n",
    "  fmtLocal,\n  resolveThoughtCoverageCursor,\n  type BrainLatestState,\n} from './brain-state';\n",
)
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "import {\n  applyCarryForwardToIntradayFile,\n  parseBrainCarryForwardDecision,\n  parseBrainThoughtCapsules,\n} from './brain-continuity.js';\n",
    "import { applyCarryForwardToIntradayFile } from './brain-continuity.js';\nimport {\n  inspectBrainCarryForwardArtifact,\n  inspectBrainThoughtCapsuleArtifact,\n} from './brain-artifact-integrity.js';\n",
)
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "    const elapsed     = now.getTime() - lastThought.getTime();\n\n    if (elapsed < THOUGHT_INTERVAL_MS) return null;\n\n    // Catch-up: cap window to 12h max regardless of actual gap\n    const windowStart = elapsed > CATCHUP_CAP_MS\n      ? new Date(now.getTime() - CATCHUP_CAP_MS)\n      : lastThought;\n",
    "    const lastCoveredAt = resolveThoughtCoverageCursor(state) || lastThought;\n    const elapsed = now.getTime() - lastCoveredAt.getTime();\n\n    if (elapsed < THOUGHT_INTERVAL_MS) return null;\n\n    // Catch-up: cap window to 12h max regardless of actual gap. The normal\n    // start boundary is the exact prior package end, not model completion time.\n    const windowStart = elapsed > CATCHUP_CAP_MS\n      ? new Date(now.getTime() - CATCHUP_CAP_MS)\n      : lastCoveredAt;\n",
)
old_capsule = """    const fileLooksFresh = artifactFresh();
    let capsuleArtifactValid = false;
    try {
      if (fs.existsSync(absCapsuleFile)) {
        const stat = fs.statSync(absCapsuleFile);
        const rawCapsules = fs.readFileSync(absCapsuleFile, 'utf-8');
        const parsedRaw = JSON.parse(rawCapsules);
        capsuleArtifactValid = stat.mtimeMs >= (runStartedAt - 5000)
          && Array.isArray(parsedRaw)
          && parseBrainThoughtCapsules(rawCapsules).length === parsedRaw.length;
      }
      // An empty array is a valid quiet-window result. Recover only the missing
      // sidecar, never manufacture capsules from prose.
      if (!capsuleArtifactValid && fileLooksFresh && !wasAborted && !runFailed) {
        fs.mkdirSync(path.dirname(absCapsuleFile), { recursive: true });
        fs.writeFileSync(absCapsuleFile, '[]\n', 'utf-8');
        capsuleArtifactValid = true;
      }
    } catch {
      capsuleArtifactValid = false;
    }
    const verifiedSuccess = fileLooksFresh && capsuleArtifactValid && !runFailed;
"""
new_capsule = """    const fileLooksFresh = artifactFresh();
    let capsuleArtifact = inspectBrainThoughtCapsuleArtifact(absCapsuleFile, runStartedAt);
    // An empty array is a valid quiet-window result. Recover only a genuinely
    // missing sidecar; malformed or stale model output is preserved and fails
    // the run so continuity loss is observable instead of silently erased.
    if (capsuleArtifact.status === 'missing' && fileLooksFresh && !wasAborted && !runFailed) {
      try {
        fs.mkdirSync(path.dirname(absCapsuleFile), { recursive: true });
        fs.writeFileSync(absCapsuleFile, '[]\n', 'utf-8');
        capsuleArtifact = inspectBrainThoughtCapsuleArtifact(absCapsuleFile, runStartedAt);
      } catch (err: any) {
        capsuleArtifact = { status: 'invalid', count: 0, error: String(err?.message || err) };
      }
    }
    const capsuleArtifactValid = capsuleArtifact.status === 'valid';
    const verifiedSuccess = fileLooksFresh && capsuleArtifactValid && !runFailed;
"""
replace_once('src/gateway/brain/brain-runner.ts', old_capsule, new_capsule)
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "      latestAfter.lastThoughtAt = new Date().toISOString();\n      latestAfter.lastThoughtWindow = windowLabel;\n",
    "      latestAfter.lastThoughtAt = new Date().toISOString();\n      latestAfter.lastThoughtWindowEndAt = windowEnd.toISOString();\n      latestAfter.lastThoughtWindow = windowLabel;\n",
)
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "          : `Expected thought artifact missing or stale: ${outFile}`,\n",
    "          : !fileLooksFresh\n            ? `Expected thought artifact missing or stale: ${outFile}`\n            : `Thought capsule artifact ${capsuleArtifact.status}: ${capsuleFile}${capsuleArtifact.error ? ` (${capsuleArtifact.error})` : ''}`,\n",
)

old_carry = """    let carryForwardFresh = false;
    try {
      if (artifactFresh(absCarryDecisionFile)) {
        const decision = parseBrainCarryForwardDecision(fs.readFileSync(absCarryDecisionFile, 'utf-8'));
        if (decision && decision.targetDate === carryTargetDate) {
          applyCarryForwardToIntradayFile(this.deps.workspacePath, decision);
          carryForwardFresh = artifactFresh(path.join(this.deps.workspacePath, carryNotesFile));
        }
      }
      if (!carryForwardFresh && dreamFresh && !wasAborted && !runFailed) {
        fs.mkdirSync(path.dirname(absCarryDecisionFile), { recursive: true });
        const fallback = {
          targetDate: carryTargetDate,
          generatedAt: new Date().toISOString(),
          sourceDream: workspaceOutFile,
          items: [],
        };
        fs.writeFileSync(absCarryDecisionFile, `${JSON.stringify(fallback, null, 2)}\n`, 'utf-8');
        applyCarryForwardToIntradayFile(this.deps.workspacePath, fallback);
        carryForwardFresh = artifactFresh(path.join(this.deps.workspacePath, carryNotesFile));
        artifactRecoveryNotes.push('Recovered missing carry-forward decision with an empty validated next-day section.');
      }
    } catch (err: any) {
      artifactRecoveryNotes.push(`Carry-forward generation failed: ${err?.message || err}`);
    }
"""
new_carry = """    let carryForwardFresh = false;
    let carryArtifact = inspectBrainCarryForwardArtifact(absCarryDecisionFile, runStartedAt, carryTargetDate);
    try {
      if (carryArtifact.status === 'valid' && carryArtifact.decision) {
        applyCarryForwardToIntradayFile(this.deps.workspacePath, carryArtifact.decision);
        carryForwardFresh = artifactFresh(path.join(this.deps.workspacePath, carryNotesFile));
      }
      // As with Thought capsules, recovery is only for a truly missing sidecar.
      // Invalid/stale Dream output is evidence of a failed continuity contract
      // and must not be overwritten with an empty successful decision.
      if (!carryForwardFresh && carryArtifact.status === 'missing' && dreamFresh && !wasAborted && !runFailed) {
        fs.mkdirSync(path.dirname(absCarryDecisionFile), { recursive: true });
        const fallback = {
          targetDate: carryTargetDate,
          generatedAt: new Date().toISOString(),
          sourceDream: workspaceOutFile,
          items: [],
        };
        fs.writeFileSync(absCarryDecisionFile, `${JSON.stringify(fallback, null, 2)}\n`, 'utf-8');
        carryArtifact = inspectBrainCarryForwardArtifact(absCarryDecisionFile, runStartedAt, carryTargetDate);
        applyCarryForwardToIntradayFile(this.deps.workspacePath, fallback);
        carryForwardFresh = artifactFresh(path.join(this.deps.workspacePath, carryNotesFile));
        artifactRecoveryNotes.push('Recovered missing carry-forward decision with an empty validated next-day section.');
      }
    } catch (err: any) {
      artifactRecoveryNotes.push(`Carry-forward generation failed: ${err?.message || err}`);
    }
"""
replace_once('src/gateway/brain/brain-runner.ts', old_carry, new_carry)
replace_once(
    'src/gateway/brain/brain-runner.ts',
    "            proposalsFresh ? null : 'proposals.md',\n          ].filter(Boolean).join(', ') || '(unknown)'}`,\n",
    "            proposalsFresh ? null : 'proposals.md',\n            carryForwardFresh ? null : `${carryDecisionFile} (${carryArtifact.status}${carryArtifact.error ? `: ${carryArtifact.error}` : ''})`,\n          ].filter(Boolean).join(', ') || '(unknown)'}`,\n",
)

# 5) Strengthen activity-package regression to prove reruns do not append the
# same continuation events repeatedly.
activity_test = Path('src/gateway/brain/activity-package.regression.ts').read_text(encoding='utf-8')
old_final = """    const [again, concurrent] = await Promise.all([
      buildThoughtActivityPackage(options),
      buildThoughtActivityPackage(options),
    ]);
    assert.equal(again.package.packageId, pkg.packageId, 'same stores/window must produce deterministic package ID');
    assert.equal(concurrent.package.packageId, pkg.packageId, 'concurrent builders must be deterministic');
    console.log('activity-package regression passed', JSON.stringify({
"""
new_final = """    const [again, concurrent] = await Promise.all([
      buildThoughtActivityPackage(options),
      buildThoughtActivityPackage(options),
    ]);
    assert.equal(again.package.packageId, pkg.packageId, 'same stores/window must produce deterministic package ID');
    assert.equal(concurrent.package.packageId, pkg.packageId, 'concurrent builders must be deterministic');
    const rerunContinuationEvents = pkg.eventLedger.continuations.flatMap((entry) => {
      const filePath = path.join(workspacePath, entry.path);
      const rows = fs.readFileSync(filePath, 'utf8').trim().split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line));
      assert.equal(rows.length, entry.eventCount, `continuation ${entry.path} must be a snapshot, not an append-only rerun journal`);
      assert.equal(new Set(rows.map((row: any) => row.id)).size, rows.length, `continuation ${entry.path} must not duplicate event ids after reruns`);
      return rows;
    });
    assert.equal(
      rerunContinuationEvents.length,
      pkg.eventLedger.totalEvents - pkg.eventLedger.inline.length,
      'rerunning the same window must not grow continuation contents',
    );
    console.log('activity-package regression passed', JSON.stringify({
"""
if activity_test.count(old_final) != 1:
    raise SystemExit('activity-package regression final anchor mismatch')
activity_test = activity_test.replace(old_final, new_final, 1)
Path('src/gateway/brain/activity-package.regression.ts').write_text(activity_test, encoding='utf-8')

# 6) Regression for sidecar classification, cursor migration, and runner wiring.
Path('src/gateway/brain/brain-cognition-integrity.regression.ts').write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inspectBrainCarryForwardArtifact,
  inspectBrainThoughtCapsuleArtifact,
} from './brain-artifact-integrity.js';
import { resolveThoughtCoverageCursor } from './brain-state.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-brain-integrity-'));
try {
  const now = Date.now();
  assert.equal(
    resolveThoughtCoverageCursor({ lastThoughtWindowEndAt: '2026-08-15T12:00:00.000Z', lastThoughtAt: '2026-08-15T12:08:00.000Z' })?.toISOString(),
    '2026-08-15T12:00:00.000Z',
    'explicit activity boundary must win over model completion time',
  );
  assert.equal(
    resolveThoughtCoverageCursor({ lastThoughtWindowEndAt: null, lastThoughtAt: '2026-08-15T12:08:00.000Z' })?.toISOString(),
    '2026-08-15T12:08:00.000Z',
    'legacy state must migrate through lastThoughtAt fallback',
  );

  const capsules = path.join(root, 'capsules.json');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'missing');
  fs.writeFileSync(capsules, '{bad json', 'utf8');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'invalid');
  fs.writeFileSync(capsules, JSON.stringify([{ id: 'broken' }]), 'utf8');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'invalid');
  const validCapsule = {
    id: 'capsule-v1',
    threadKey: 'project:prometheus',
    kind: 'active_work',
    priority: 'high',
    status: 'in_progress',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
    summary: 'Prometheus audit remains active.',
    facts: ['A fact.'],
    nextUsefulAction: 'Continue the audit.',
    relevance: { projects: ['Prometheus'], triggers: ['audit'], surfaces: ['main_chat'] },
    evidence: ['fixture'],
    lastValidatedAt: new Date(now).toISOString(),
    verificationRequired: true,
    supersedes: [],
  };
  fs.writeFileSync(capsules, JSON.stringify([validCapsule]), 'utf8');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'valid');
  fs.utimesSync(capsules, new Date(now - 60_000), new Date(now - 60_000));
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'stale');

  const carry = path.join(root, 'carry.json');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'missing');
  fs.writeFileSync(carry, '{bad json', 'utf8');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'invalid');
  const decision = {
    targetDate: '2026-08-16',
    generatedAt: new Date(now).toISOString(),
    sourceDream: 'Brain/dreams/2026-08-15/23-30-dream.md',
    items: [],
  };
  fs.writeFileSync(carry, JSON.stringify(decision), 'utf8');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-17').status, 'invalid');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'valid');

  const runnerSource = fs.readFileSync(path.join(process.cwd(), 'src/gateway/brain/brain-runner.ts'), 'utf8');
  assert.match(runnerSource, /capsuleArtifact\.status === 'missing'/, 'runner must only recover genuinely missing Thought sidecars');
  assert.match(runnerSource, /carryArtifact\.status === 'missing'/, 'runner must only recover genuinely missing Dream carry-forward sidecars');
  assert.match(runnerSource, /lastThoughtWindowEndAt = windowEnd\.toISOString\(\)/, 'runner must persist the exact covered activity boundary');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('brain cognition integrity regression: ok');
''', encoding='utf-8')

print('brain cognition integrity patch applied')
