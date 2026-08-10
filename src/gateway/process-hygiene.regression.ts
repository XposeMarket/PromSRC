import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildProcessHygieneReport,
  classifyHygieneObservation,
  readCurrentProcessInventory,
  type CurrentEnvironmentInventory,
  type HygieneObservationInput,
} from './process-hygiene';

const NOW = Date.parse('2026-08-09T16:00:00.000Z');

function observation(overrides: Partial<HygieneObservationInput>): HygieneObservationInput {
  return {
    kind: 'worker',
    identity: 'fixture-worker',
    ownership: 'prometheus',
    knownPrometheusOwner: true,
    ownerKey: 'fixture-owner',
    relation: 'active',
    lease: 'none',
    processIdentity: 'match',
    ...overrides,
  };
}

function candidateFor(report: Awaited<ReturnType<typeof buildProcessHygieneReport>>, kind: string, flag?: string) {
  return report.candidates.find((candidate) => candidate.kind === kind && (!flag || candidate.flags.includes(flag)));
}

function assertReportOnly(report: Awaited<ReturnType<typeof buildProcessHygieneReport>>): void {
  assert.deepEqual(report.dryRun, {
    destructiveActions: 0,
    processTermination: 0,
    browserClose: 0,
    vmStop: 0,
    fileDeletion: 0,
    executableActions: [],
  });
  assert.equal(report.scope.workspaceFilesRead, false);
  assert.equal(report.scope.chatHistoryRead, false);
  assert.equal(report.scope.memoryRead, false);
  assert.equal(report.scope.taskDataRead, false);
  assert.equal(report.scope.auditLogsRead, false);
  assert.equal(report.scope.personalChromeControl, 'excluded_and_protected');
  assert.equal(report.audit.eventType, 'process_hygiene_report_generated');
  assert.equal(report.audit.reportOnly, true);
  assert.equal(report.audit.mutationsAttempted, 0);
  assert.equal(report.thoughtSummary.safety.rawCommandsIncluded, false);
  assert.equal(report.thoughtSummary.safety.rawUrlsIncluded, false);
  assert.equal(report.thoughtSummary.safety.rawPathsIncluded, false);
  assert.equal(report.thoughtSummary.safety.secretsIncluded, false);
}

function testClassificationRules(): void {
  assert.equal(classifyHygieneObservation(observation({ relation: 'active', lease: 'active' }), NOW), 'active');
  assert.equal(classifyHygieneObservation(observation({ preferLeaseClassification: true, relation: 'unknown', lease: 'active' }), NOW), 'leased');
  assert.equal(classifyHygieneObservation(observation({ relation: 'terminal', lease: 'none', processIdentity: 'missing', lastObservedAt: NOW - 1_000 }), NOW), 'recent');
  assert.equal(classifyHygieneObservation(observation({ relation: 'terminal', lease: 'none', processIdentity: 'missing', lastObservedAt: NOW - 6 * 60 * 60 * 1000 }), NOW), 'recent');
  assert.equal(classifyHygieneObservation(observation({ relation: 'terminal', lease: 'expired', processIdentity: 'missing', lastObservedAt: NOW - 7 * 60 * 60 * 1000 }), NOW), 'stale');
  assert.equal(classifyHygieneObservation(observation({ relation: 'terminal', lease: 'none', processIdentity: 'missing', lastObservedAt: NOW + 5 * 60 * 1000 }), NOW), 'unknown');
  assert.equal(classifyHygieneObservation(observation({ relation: 'missing', lease: 'none', processIdentity: 'match' }), NOW), 'orphaned');
  assert.equal(classifyHygieneObservation(observation({ knownPrometheusOwner: false, ownership: 'unknown', processIdentity: 'unknown' }), NOW), 'unknown');
  assert.equal(classifyHygieneObservation(observation({ ownership: 'user', knownPrometheusOwner: false }), NOW), 'protected');
  assert.equal(classifyHygieneObservation(observation({ processIdentity: 'pid_reused', relation: 'missing' }), NOW), 'unknown');
  // Protection does not erase useful lifecycle state for owned always-on
  // resources; it only prevents a future cleanup executor from acting on them.
  assert.equal(classifyHygieneObservation(observation({ kind: 'gateway', protectedReason: 'always_on_gateway' }), NOW), 'active');
}

function fixtureInventory(): CurrentEnvironmentInventory {
  return {
    available: true,
    partial: false,
    processes: [
      { pid: 100, parentPid: 1, creationTimeMs: 10_000 },
      { pid: 200, parentPid: 100, creationTimeMs: 20_000 },
      { pid: 300, parentPid: 1, creationTimeMs: 30_000 },
    ],
    listeners: [
      { pid: 100, port: 47_001, addressFamily: 'IPv4' },
      { pid: 9_999, port: 47_002, addressFamily: 'IPv4' },
    ],
    vms: [{ vmName: 'Prometheus-Desktop', state: 'Running', status: 'Running' }],
  };
}

function fixtureObservations(): HygieneObservationInput[] {
  return [
    observation({ kind: 'gateway', identity: 'gateway|100', ownerKey: 'gateway|100', processIdentity: 'match', protectedReason: 'always_on_gateway', strongActiveEvidence: true }),
    observation({ identity: 'worker-1', ownerKey: 'same-worker-owner', processIdentity: 'match' }),
    observation({ identity: 'worker-2', ownerKey: 'same-worker-owner', processIdentity: 'match' }),
    observation({ identity: 'stale-lease', ownerKey: 'stale-lease', relation: 'terminal', lease: 'expired', processIdentity: 'missing', lastObservedAt: NOW - 8 * 60 * 60 * 1000 }),
    observation({ identity: 'pid-reuse', ownerKey: 'pid-reuse', relation: 'missing', lease: 'none', processIdentity: 'pid_reused', lastObservedAt: NOW - 1_000 }),
    observation({ identity: 'ambiguous', ownerKey: 'ambiguous', ownership: 'unknown', knownPrometheusOwner: false, relation: 'active', lease: 'none', processIdentity: 'unknown' }),
    observation({ kind: 'vm', identity: 'vm-owned', ownerKey: 'vm-owned', relation: 'active', lease: 'active', preferLeaseClassification: true, processIdentity: 'match', protectedReason: 'exact_vm_boundary_no_control' }),
    observation({ kind: 'vm', identity: 'vm-external', ownerKey: 'vm-external', ownership: 'external', knownPrometheusOwner: false, relation: 'active', lease: 'active', processIdentity: 'unknown', protectedReason: 'exact_vm_boundary_no_control' }),
  ];
}

async function testSyntheticFixtures(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-process-hygiene-'));
  try {
    const browserSessions = [
      { sessionId: 'prom-browser', ownerType: 'thought', ownerId: 'thought-1', profileKind: 'prometheus' as const, browserTarget: 'prometheus' as const, active: true, streamActive: true, createdAt: NOW - 1000, updatedAt: NOW },
      { sessionId: 'user-browser', ownerType: 'user', ownerId: 'personal', profileKind: 'user' as const, browserTarget: 'user' as const, active: true, streamActive: false, createdAt: NOW - 1000, updatedAt: NOW },
    ];
    const report = await buildProcessHygieneReport({
      configDir: root,
      now: NOW,
      mode: 'dry_run',
      processInventory: fixtureInventory(),
      browserSessions,
      fixtureObservations: fixtureObservations(),
      includeStateSurfaces: false,
    });
    assertReportOnly(report);
    assert.equal(candidateFor(report, 'gateway')?.classification, 'active');
    assert.equal(candidateFor(report, 'gateway')?.protection, 'protected');
    assert.equal(candidateFor(report, 'worker', 'duplicate_identity')?.flags.includes('duplicate_identity'), true);
    assert.equal(report.counts.duplicateIdentity >= 2, true, 'both duplicate identities must be visible');
    assert.equal(candidateFor(report, 'worker')?.classification, 'active');
    assert.equal(report.candidates.some((candidate) => candidate.classification === 'stale' && candidate.flags.includes('lease_expired')), true);
    assert.equal(report.candidates.some((candidate) => candidate.flags.includes('pid_reuse') && candidate.classification === 'unknown'), true);
    assert.equal(report.candidates.some((candidate) => candidate.classification === 'unknown' && candidate.ownership === 'unknown'), true);
    assert.equal(report.candidates.some((candidate) => candidate.kind === 'vm' && candidate.protection === 'protected'), true);
    assert.equal(report.candidates.some((candidate) => candidate.kind === 'browser_session' && candidate.ownership === 'user' && candidate.classification === 'protected'), true);
    assert.equal(report.candidates.some((candidate) => candidate.kind === 'browser_session' && candidate.ownership === 'prometheus' && ['active', 'leased'].includes(candidate.classification)), true);
    assert.equal(report.listeners.attributedPrometheus, 0, 'unrelated listeners must not be attributed by port alone');
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('https://'), false, 'browser URLs are outside the observer input/output contract');
    assert.equal(serialized.includes('fixture-secret'), false, 'raw fixture secrets must not be returned');

    const concurrent = await Promise.all(Array.from({ length: 4 }, () => buildProcessHygieneReport({
      configDir: root,
      now: NOW,
      processInventory: fixtureInventory(),
      browserSessions,
      fixtureObservations: fixtureObservations(),
      includeStateSurfaces: false,
    })));
    assert(concurrent.every((result) => result.reportId === concurrent[0].reportId), 'concurrent reports must be idempotent');
    assert.deepEqual(concurrent[0].candidates, report.candidates);

    fs.writeFileSync(path.join(root, 'gateway-runtime-status.json'), '{not-json\n', 'utf8');
    const partial = await buildProcessHygieneReport({
      configDir: root,
      now: NOW,
      processInventory: { ...fixtureInventory(), partial: true, note: 'synthetic partial inventory' },
      includeStateSurfaces: false,
    });
    assert.equal(partial.sources.find((source) => source.source === 'gateway_status')?.status, 'partial');
    assert.equal(partial.sources.find((source) => source.source === 'os_process_inventory')?.status, 'partial');
    assertReportOnly(partial);

    // A fresh gateway heartbeat with a different PID than an expired progress
    // lease is stale-lease evidence, not permission to call the live gateway a
    // reused PID or a stale process.
    fs.writeFileSync(path.join(root, 'gateway-runtime-status.json'), JSON.stringify({ pid: 100, timestamp: NOW }), 'utf8');
    fs.writeFileSync(path.join(root, 'gateway-progress-lease.json'), JSON.stringify({
      pid: 999,
      processStartedAt: 999_000,
      runtimeId: 'stale-progress-runtime',
      leaseId: 'stale-progress-lease',
      state: 'active',
      expiresAt: NOW - 1_000,
      updatedAt: NOW - 2_000,
    }), 'utf8');
    const mismatchedLease = await buildProcessHygieneReport({
      configDir: root,
      now: NOW,
      processInventory: fixtureInventory(),
      includeStateSurfaces: false,
    });
    const gateway = mismatchedLease.candidates.find((candidate) => candidate.kind === 'gateway');
    assert.equal(gateway?.classification, 'active');
    assert.equal(gateway?.flags.includes('progress_lease_pid_mismatch'), true);
    assert.equal(gateway?.flags.includes('pid_reuse'), false);
    assert.equal(mismatchedLease.candidates.some((candidate) => candidate.kind === 'runtime' && candidate.flags.includes('gateway_process_is_alive')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testCurrentEnvironmentReadOnlyCheck(): Promise<void> {
  const before = await readCurrentProcessInventory();
  assert(Array.isArray(before.processes));
  assert(Array.isArray(before.listeners));
  assert(Array.isArray(before.vms));
  const report = await buildProcessHygieneReport({
    configDir: path.join(os.tmpdir(), 'prometheus-process-hygiene-current-check-do-not-create'),
    now: NOW,
    processInventory: before,
    browserSessions: [],
    includeStateSurfaces: false,
  });
  assertReportOnly(report);
}

async function main(): Promise<void> {
  testClassificationRules();
  await testSyntheticFixtures();
  await testCurrentEnvironmentReadOnlyCheck();
  console.log('process-hygiene regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
