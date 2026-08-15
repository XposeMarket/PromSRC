from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_span(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{path}: start marker not found: {start_marker!r}')
    end_start = text.find(end_marker, start)
    if end_start < 0:
        raise SystemExit(f'{path}: end marker not found: {end_marker!r}')
    end = end_start + len(end_marker)
    p.write_text(text[:start] + replacement + text[end:], encoding='utf-8')

runner = 'src/gateway/brain/brain-runner.ts'

# The first-stage patch intentionally stops at this legacy block. Replace it by
# semantic anchors so tabs/spaces in the historical runner cannot make the
# audit harness brittle.
replace_span(
    runner,
    '    const fileLooksFresh = artifactFresh();',
    '    const verifiedSuccess = fileLooksFresh && capsuleArtifactValid && !runFailed;',
    """    const fileLooksFresh = artifactFresh();
    let capsuleArtifact = inspectBrainThoughtCapsuleArtifact(absCapsuleFile, runStartedAt);
    // An empty array is a valid quiet-window result. Recover only a genuinely
    // missing sidecar; malformed or stale model output is preserved and fails
    // the run so continuity loss is observable instead of silently erased.
    if (capsuleArtifact.status === 'missing' && fileLooksFresh && !wasAborted && !runFailed) {
      try {
        fs.mkdirSync(path.dirname(absCapsuleFile), { recursive: true });
        fs.writeFileSync(absCapsuleFile, '[]\\n', 'utf-8');
        capsuleArtifact = inspectBrainThoughtCapsuleArtifact(absCapsuleFile, runStartedAt);
      } catch (err: any) {
        capsuleArtifact = { status: 'invalid', count: 0, error: String(err?.message || err) };
      }
    }
    const capsuleArtifactValid = capsuleArtifact.status === 'valid';
    const verifiedSuccess = fileLooksFresh && capsuleArtifactValid && !runFailed;""",
)
replace_once(
    runner,
    '      latestAfter.lastThoughtAt = new Date().toISOString();\n      latestAfter.lastThoughtWindow = windowLabel;',
    '      latestAfter.lastThoughtAt = new Date().toISOString();\n      latestAfter.lastThoughtWindowEndAt = windowEnd.toISOString();\n      latestAfter.lastThoughtWindow = windowLabel;',
)
replace_once(
    runner,
    '          : `Expected thought artifact missing or stale: ${outFile}`,',
    """          : !fileLooksFresh
            ? `Expected thought artifact missing or stale: ${outFile}`
            : `Thought capsule artifact ${capsuleArtifact.status}: ${capsuleFile}${capsuleArtifact.error ? ` (${capsuleArtifact.error})` : ''}`,""",
)

replace_span(
    runner,
    '    let carryForwardFresh = false;',
    '    const artifactsFresh = dreamFresh && proposalsFresh && carryForwardFresh;',
    """    let carryForwardFresh = false;
    let carryArtifact = inspectBrainCarryForwardArtifact(absCarryDecisionFile, runStartedAt, carryTargetDate);
    try {
      if (carryArtifact.status === 'valid' && carryArtifact.decision) {
        applyCarryForwardToIntradayFile(this.deps.workspacePath, carryArtifact.decision);
        carryForwardFresh = artifactFresh(path.join(this.deps.workspacePath, carryNotesFile));
      }
      // Recover only a genuinely absent optional sidecar. Malformed, stale, or
      // wrong-target model output is preserved and makes the Dream fail closed.
      if (!carryForwardFresh && carryArtifact.status === 'missing' && dreamFresh && !wasAborted && !runFailed) {
        fs.mkdirSync(path.dirname(absCarryDecisionFile), { recursive: true });
        const fallback = {
          targetDate: carryTargetDate,
          generatedAt: new Date().toISOString(),
          sourceDream: workspaceOutFile,
          items: [],
        };
        fs.writeFileSync(absCarryDecisionFile, `${JSON.stringify(fallback, null, 2)}\\n`, 'utf-8');
        carryArtifact = inspectBrainCarryForwardArtifact(absCarryDecisionFile, runStartedAt, carryTargetDate);
        applyCarryForwardToIntradayFile(this.deps.workspacePath, fallback);
        carryForwardFresh = artifactFresh(path.join(this.deps.workspacePath, carryNotesFile));
        artifactRecoveryNotes.push('Recovered missing carry-forward decision with an empty validated next-day section.');
      }
    } catch (err: any) {
      artifactRecoveryNotes.push(`Carry-forward generation failed: ${err?.message || err}`);
    }
    const artifactsFresh = dreamFresh && proposalsFresh && carryForwardFresh;""",
)
replace_once(
    runner,
    "            proposalsFresh ? null : 'proposals.md',\n          ].filter(Boolean).join(', ') || '(unknown)'}`,
",
    "            proposalsFresh ? null : 'proposals.md',\n            carryForwardFresh ? null : `${carryDecisionFile} (${carryArtifact.status}${carryArtifact.error ? `: ${carryArtifact.error}` : ''})`,\n          ].filter(Boolean).join(', ') || '(unknown)'}`,
",
)

# Strengthen activity-package rerun coverage. Insert before the existing report.
test_path = Path('src/gateway/brain/activity-package.regression.ts')
test = test_path.read_text(encoding='utf-8')
marker = "    console.log('activity-package regression passed', JSON.stringify({"
pos = test.find(marker)
if pos < 0:
    raise SystemExit('activity-package report marker missing')
insert = """    const rerunContinuationEvents = pkg.eventLedger.continuations.flatMap((entry) => {
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
"""
# Only add once; the first-stage patch did not reach this section.
test_path.write_text(test[:pos] + insert + test[pos:], encoding='utf-8')

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
    id: 'capsule-v1', threadKey: 'project:prometheus', kind: 'active_work', priority: 'high', status: 'in_progress',
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
    summary: 'Prometheus audit remains active.', facts: ['A fact.'], nextUsefulAction: 'Continue the audit.',
    relevance: { projects: ['Prometheus'], triggers: ['audit'], surfaces: ['main_chat'] }, evidence: ['fixture'],
    lastValidatedAt: new Date(now).toISOString(), verificationRequired: true, supersedes: [],
  };
  fs.writeFileSync(capsules, JSON.stringify([validCapsule]), 'utf8');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'valid');
  fs.utimesSync(capsules, new Date(now - 60_000), new Date(now - 60_000));
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'stale');

  const carry = path.join(root, 'carry.json');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'missing');
  fs.writeFileSync(carry, '{bad json', 'utf8');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'invalid');
  const decision = { targetDate: '2026-08-16', generatedAt: new Date(now).toISOString(), sourceDream: 'Brain/dreams/2026-08-15/23-30-dream.md', items: [] };
  fs.writeFileSync(carry, JSON.stringify(decision), 'utf8');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-17').status, 'invalid');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'valid');

  const runnerSource = fs.readFileSync(path.join(process.cwd(), 'src/gateway/brain/brain-runner.ts'), 'utf8');
  assert.match(runnerSource, /capsuleArtifact\.status === 'missing'/);
  assert.match(runnerSource, /carryArtifact\.status === 'missing'/);
  assert.match(runnerSource, /lastThoughtWindowEndAt = windowEnd\.toISOString\(\)/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('brain cognition integrity regression: ok');
''', encoding='utf-8')

print('brain cognition integrity finish patch applied')
