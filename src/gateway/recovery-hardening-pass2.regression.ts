/**
 * Recovery hardening pass 2 (crash/restart audit, 2026-10-17).
 * Covers: corrupt state-file quarantine + atomic writes, recovery-claim
 * release, task crash-loop auto-resume cap, stale dev-edit 'applying' batch
 * reconciliation, and background-agent status/join/wait from durable receipts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-recovery-pass2-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_APP_ROOT = root;

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks++;
  console.log(`  ok - ${name}`);
}

async function main(): Promise<void> {
  // 1. Quarantine + atomic write helper
  const { quarantineCorruptStateFile, writeFileAtomicSync } = await import('./state-file-quarantine');
  const corrupt = path.join(root, 'store.json');
  fs.writeFileSync(corrupt, '{"jobs": [ {"id": "a"');
  const copy = quarantineCorruptStateFile(corrupt, 'test', new Error('Unexpected end of JSON input'));
  check('corrupt state file is preserved before defaults are used', () => {
    assert.ok(copy && fs.existsSync(copy));
    assert.equal(fs.readFileSync(copy!, 'utf8'), '{"jobs": [ {"id": "a"');
    assert.ok(fs.existsSync(corrupt), 'quarantine copies, never moves');
  });
  check('same corrupt bytes are only quarantined once per process', () => {
    assert.equal(quarantineCorruptStateFile(corrupt, 'test'), null);
  });
  check('empty torn file is not worth a quarantine copy', () => {
    const empty = path.join(root, 'empty.json');
    fs.writeFileSync(empty, '');
    assert.equal(quarantineCorruptStateFile(empty, 'test'), null);
  });
  check('atomic write replaces content and leaves no temp files', () => {
    const target = path.join(root, 'atomic.json');
    writeFileAtomicSync(target, '{"v":1}');
    writeFileAtomicSync(target, '{"v":2}');
    assert.equal(fs.readFileSync(target, 'utf8'), '{"v":2}');
    assert.equal(fs.readdirSync(root).filter((n) => n.startsWith('atomic.json.') && n.endsWith('.tmp')).length, 0);
  });

  // 2. Recovery claims can be released by their owner only
  const claims = await import('./runtime/recovery-claims');
  const claimDir = path.join(root, 'claims');
  claims.setRecoveryClaimDirForTests(claimDir);
  const runtimeId = `rt_${randomUUID()}`;
  check('claim -> release -> reclaim works for the owning pid', () => {
    assert.equal(claims.claimRuntimeRecovery(runtimeId, 'main_chat_retrigger'), true);
    assert.equal(claims.claimRuntimeRecovery(runtimeId, 'main_chat_retrigger'), false);
    assert.equal(claims.releaseRuntimeRecoveryClaim(runtimeId, 'main_chat_retrigger'), true);
    assert.equal(claims.claimRuntimeRecovery(runtimeId, 'main_chat_retrigger'), true);
  });
  check('a claim owned by another process is never released', () => {
    const foreign = `rt_${randomUUID()}`;
    fs.writeFileSync(path.join(claimDir, `${foreign}.main_chat_retrigger.claim`), JSON.stringify({ pid: process.pid + 99999 }));
    assert.equal(claims.releaseRuntimeRecoveryClaim(foreign, 'main_chat_retrigger'), false);
    assert.equal(claims.claimRuntimeRecovery(foreign, 'main_chat_retrigger'), false);
  });
  claims.setRecoveryClaimDirForTests(null);
  const continuitySrc = fs.readFileSync(path.join(__dirname, 'routes', 'chat', 'pipeline', 'restart-continuity.ts'), 'utf8');
  check('retrigger releases its claim when the session lease is busy', () => {
    const busyAt = continuitySrc.indexOf('if (!admissionLease) {');
    assert.ok(busyAt > 0);
    assert.match(continuitySrc.slice(busyAt, busyAt + 600), /releaseRuntimeRecoveryClaim\(/);
  });

  // 3. Task crash-loop cap
  const recovery = await import('./runtime-recovery');
  const crashRuntime: any = { id: 'rt1', kind: 'task', interruptReason: 'gateway_crash', recoveryData: {} };
  const plannedRuntime: any = { id: 'rt2', kind: 'task', interruptReason: 'signal_sigterm', recoveryData: {} };
  check('unplanned vs planned interruption classification', () => {
    assert.equal(recovery.isUnplannedTaskInterruption(crashRuntime), true);
    assert.equal(recovery.isUnplannedTaskInterruption({ ...crashRuntime, interruptReason: undefined }), true);
    assert.equal(recovery.isUnplannedTaskInterruption(plannedRuntime), false);
    assert.equal(recovery.isUnplannedTaskInterruption({ ...plannedRuntime, interruptReason: 'gateway_restart' }), false);
  });
  check('only crash auto-resumes count toward the cap', () => {
    const journal = [
      { t: 1, type: 'resume', content: 'Auto-resumed after gateway restart.' },
      { t: 2, type: 'resume', content: 'Auto-resumed after gateway crash.' },
      { t: 3, type: 'resume', content: 'Auto-resumed after gateway crash.' },
      { t: 4, type: 'tool_result', content: 'Auto-resumed after gateway crash.' },
    ];
    assert.equal(recovery.countTaskCrashAutoResumes({ journal } as any), 2);
    assert.equal(recovery.MAX_TASK_CRASH_AUTO_RESUMES, 2);
  });

  // 4. Stale dev-edit apply batch
  const coordinator = await import('./dev-edit-coordinator');
  const coordPath = path.join(root, '.prometheus', 'dev-edit-coordination.json');
  fs.mkdirSync(path.dirname(coordPath), { recursive: true });
  const now = Date.now();
  const edit = (id: string, batchId: string) => ({ id, sessionId: `s_${id}`, phase: 'applying', requestedFiles: [], ownedFiles: [], waitingFiles: [], touchedFiles: [], batchId, createdAt: now, updatedAt: now, leaseExpiresAt: now + 1000 });
  const batch = (id: string, applyStartedAt?: number) => ({ id, memberIds: [`e_${id}`], memberSessionIds: [`s_e_${id}`], files: [], createdAt: now, status: 'applying', leaderId: `e_${id}`, applyStartedAt });
  fs.writeFileSync(coordPath, JSON.stringify({
    version: 1, revision: 1,
    edits: [edit('e_dead', 'dead'), edit('e_live', 'live'), edit('e_legacy', 'legacy')],
    batches: [batch('dead', now - coordinator.STALE_APPLY_MS - 60_000), batch('live', now - 60_000), batch('legacy')],
  }));
  const edits = coordinator.listCoordinatedDevEdits();
  const state = JSON.parse(fs.readFileSync(coordPath, 'utf8'));
  const byId = (id: string) => state.batches.find((b: any) => b.id === id);
  check('an apply killed by a crash stops blocking future applies', () => {
    assert.equal(byId('dead').status, 'failed');
    assert.match(byId('dead').failure, /crashed mid-apply/);
    const deadEdit = edits.find((e) => e.id === 'e_dead')!;
    assert.equal(deadEdit.phase, 'verified_handoff');
    assert.equal(deadEdit.batchId, undefined);
  });
  check('a fresh apply (and a pre-upgrade batch with no start time) is left alone', () => {
    assert.equal(byId('live').status, 'applying');
    assert.equal(byId('legacy').status, 'applying');
  });
  fs.writeFileSync(coordPath, '{"version":1,"edits":[');
  coordinator.listCoordinatedDevEdits();
  check('corrupt coordination store is quarantined', () => {
    assert.ok(fs.readdirSync(path.dirname(coordPath)).some((n) => n.startsWith('dev-edit-coordination.json.corrupt-')));
  });

  // 5. Background agents across a restart (no live record, receipt only)
  const { persistBackgroundSpawnReceipt } = await import('./tasks/background-spawn-continuity');
  const runner = await import('./tasks/task-runner');
  const sessionId = `pass2-${randomUUID()}`;
  const liveAtCrash = `bg_${randomUUID()}`;
  const finished = `bg_${randomUUID()}`;
  persistBackgroundSpawnReceipt({ id: liveAtCrash, spawnerSessionId: sessionId, state: 'in_progress', startedAt: Date.now() - 5000, promptPreview: 'audit' });
  persistBackgroundSpawnReceipt({ id: finished, spawnerSessionId: sessionId, state: 'completed', startedAt: Date.now() - 5000, completedAt: Date.now(), result: 'done: 3 findings' });
  check('status of a worker lost in a restart is an explicit interruption, not "not found"', () => {
    const status = runner.backgroundStatus(liveAtCrash);
    assert.ok(status);
    assert.equal(status!.state, 'failed');
    assert.equal(status!.error, runner.BACKGROUND_INTERRUPTED_BY_RESTART_ERROR);
  });
  check('a finished worker still returns its result after restart', () => {
    assert.equal(runner.backgroundStatus(finished)?.state, 'completed');
    assert.equal(runner.backgroundStatus(finished)?.result, 'done: 3 findings');
  });
  const joined = await runner.backgroundJoin({ backgroundId: finished, joinPolicy: 'wait_all' });
  check('join settles from the receipt instead of returning null', () => {
    assert.equal(joined?.state, 'completed');
    assert.equal(joined?.result, 'done: 3 findings');
  });
  const t0 = Date.now();
  const waited = await runner.backgroundWait({ backgroundIds: [liveAtCrash, finished], timeoutMs: 30_000 });
  check('wait on restored ids returns immediately instead of burning the timeout', () => {
    assert.ok(Date.now() - t0 < 5_000, `waited ${Date.now() - t0}ms`);
    assert.equal(waited.completed, 1);
    assert.equal(waited.failed, 1);
    assert.equal(waited.running, 0);
    assert.equal(waited.timedOut, false);
  });
  check('unknown ids still report not found', () => {
    assert.equal(runner.backgroundStatus(`bg_${randomUUID()}`), null);
  });

  console.log(`recovery-hardening-pass2: ${checks}/${checks} passed`);
}

main()
  .then(() => { fs.rmSync(root, { recursive: true, force: true }); process.exit(0); })
  .catch((err) => { console.error(err); fs.rmSync(root, { recursive: true, force: true }); process.exit(1); });
