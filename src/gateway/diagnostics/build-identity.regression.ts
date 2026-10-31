import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { createDiagnosticPacket, getDiagnosticPacket, listDiagnosticPackets, updateDiagnosticPacketStatus } from './diagnostic-packet-store';
import { readBuildIdentity } from './build-identity';

const repoRoot = path.resolve(__dirname, '../../../');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-identity-regression-'));
let assertions = 0;
function test(name: string, fn: () => void): void {
  try { fn(); assertions++; console.log(`ok ${assertions} - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}
function writeManifest(dir: string, manifest: Record<string, unknown>): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'build-identity.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  return file;
}
function fixtureManifest(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, version: '1.2.3', commit: 'a'.repeat(40), dirty: false, builtAt: '2026-10-31T12:34:56.000Z', playbookVersion: 1, ...overrides };
}
function makeGitRepo(repo: string): void {
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '2.3.4' }));
  fs.writeFileSync(path.join(repo, 'src', 'tracked.ts'), 'export const value = 1;\n');
  childProcess.execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.email', 'luna@example.invalid'], { cwd: repo, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Luna Regression'], { cwd: repo, stdio: 'ignore' });
  childProcess.execFileSync('git', ['add', 'package.json', 'src/tracked.ts'], { cwd: repo, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repo, stdio: 'ignore' });
}
function walkStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => walkStrings(v, out));
  return out;
}

const oldCwd = process.cwd();
try {
  const validFile = writeManifest(path.join(tempRoot, 'manifests', 'valid'), fixtureManifest());
  test('valid clean manifest yields exact identity without exposing manifest path', () => {
    const identity = readBuildIdentity(validFile);
    assert.equal(identity.status, 'exact');
    assert.equal(identity.commit, 'a'.repeat(40));
    assert.equal(identity.version, '1.2.3');
    assert.equal(identity.reason, null);
    assert.equal(JSON.stringify(identity).includes(tempRoot), false);
  });
  test('dirty manifest is explicitly modified, never exact', () => {
    const identity = readBuildIdentity(writeManifest(path.join(tempRoot, 'manifests', 'dirty'), fixtureManifest({ dirty: true })));
    assert.equal(identity.status, 'modified');
    assert.equal(identity.commit, 'a'.repeat(40));
    assert.match(identity.reason || '', /local changes/i);
  });
  test('missing commit or dirty state remains unknown', () => {
    const noCommit = readBuildIdentity(writeManifest(path.join(tempRoot, 'manifests', 'no-commit'), fixtureManifest({ commit: null, dirty: false })));
    const noDirtyState = readBuildIdentity(writeManifest(path.join(tempRoot, 'manifests', 'no-dirty'), fixtureManifest({ dirty: null })));
    assert.equal(noCommit.status, 'unknown');
    assert.equal(noDirtyState.status, 'unknown');
    assert.equal(noDirtyState.commit, 'a'.repeat(40));
  });
  test('invalid and oversized manifests fail closed to unknown', () => {
    const invalid = readBuildIdentity(writeManifest(path.join(tempRoot, 'manifests', 'invalid'), fixtureManifest({ commit: 'not-a-commit' })));
    const oversizedPath = path.join(tempRoot, 'manifests', 'oversized');
    fs.mkdirSync(oversizedPath, { recursive: true });
    const oversizedFile = path.join(oversizedPath, 'build-identity.json');
    fs.writeFileSync(oversizedFile, `${JSON.stringify(fixtureManifest())}${' '.repeat(4097)}`);
    const oversized = readBuildIdentity(oversizedFile);
    assert.equal(invalid.status, 'unknown');
    assert.match(invalid.reason || '', /invalid/i);
    assert.equal(oversized.status, 'unknown');
    assert.match(oversized.reason || '', /size limit/i);
  });
  test('missing manifest is unknown and explains no latest-source fallback', () => {
    const identity = readBuildIdentity(path.join(tempRoot, 'does-not-exist.json'));
    assert.equal(identity.status, 'unknown');
    assert.match(identity.reason || '', /do not substitute latest source/i);
  });

  test('default runtime manifest resolves relative to installed dist, not cwd', () => {
    const installed = path.join(tempRoot, 'installed');
    const moduleDir = path.join(installed, 'dist', 'gateway', 'diagnostics');
    const cwd = path.join(installed, 'attacker-cwd');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(path.join(cwd, 'config'), { recursive: true });
    const source = fs.readFileSync(path.join(__dirname, 'build-identity.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(path.join(moduleDir, 'build-identity.js'), compiled);
    writeManifest(path.join(installed, 'dist', 'config'), fixtureManifest({ commit: 'b'.repeat(40) }));
    writeManifest(path.join(cwd, 'config'), fixtureManifest({ commit: 'c'.repeat(40) }));
    process.chdir(cwd);
    const identity = require(path.join(moduleDir, 'build-identity.js')).readBuildIdentity();
    assert.equal(identity.status, 'exact');
    assert.equal(identity.commit, 'b'.repeat(40));
    assert.notEqual(identity.commit, 'c'.repeat(40));
  });

  const helperPath = path.join(repoRoot, 'scripts', 'write-build-identity.js');
  const { writeBuildIdentity } = require(helperPath) as { writeBuildIdentity(repo: string, target: string): any };
  const cleanRepo = path.join(tempRoot, 'helper-clean');
  makeGitRepo(cleanRepo);
  test('build helper records clean temporary git source exactly', () => {
    const manifest = writeBuildIdentity(cleanRepo, path.join(cleanRepo, 'dist', 'config'));
    assert.equal(manifest.version, '2.3.4');
    assert.match(manifest.commit, /^[a-f0-9]{40}$/);
    assert.equal(manifest.dirty, false);
    assert.equal(readBuildIdentity(path.join(cleanRepo, 'dist', 'config', 'build-identity.json')).status, 'exact');
  });
  test('build helper marks tracked source edits dirty', () => {
    fs.writeFileSync(path.join(cleanRepo, 'src', 'tracked.ts'), 'export const value = 2;\n');
    const manifest = writeBuildIdentity(cleanRepo, path.join(cleanRepo, 'dirty-tracked'));
    assert.equal(manifest.dirty, true);
    assert.equal(readBuildIdentity(path.join(cleanRepo, 'dirty-tracked', 'build-identity.json')).status, 'modified');
    fs.writeFileSync(path.join(cleanRepo, 'src', 'tracked.ts'), 'export const value = 1;\n');
  });
  test('build helper counts untracked source files as dirty', () => {
    fs.writeFileSync(path.join(cleanRepo, 'src', 'untracked.ts'), 'export const extra = true;\n');
    const manifest = writeBuildIdentity(cleanRepo, path.join(cleanRepo, 'dirty-untracked'));
    assert.equal(manifest.dirty, true);
    assert.equal(readBuildIdentity(path.join(cleanRepo, 'dirty-untracked', 'build-identity.json')).status, 'modified');
  });
  test('build helper degrades safely when fixture has no git repository', () => {
    const noGit = path.join(tempRoot, 'helper-no-git');
    fs.mkdirSync(noGit, { recursive: true });
    fs.writeFileSync(path.join(noGit, 'package.json'), JSON.stringify({ version: '3.4.5' }));
    const manifest = writeBuildIdentity(noGit, path.join(noGit, 'dist', 'config'));
    assert.equal(manifest.version, '3.4.5');
    assert.equal(manifest.commit, null);
    assert.equal(manifest.dirty, null);
    assert.equal(readBuildIdentity(path.join(noGit, 'dist', 'config', 'build-identity.json')).status, 'unknown');
  });

  test('asset-copy build writes identity to isolated dist/config without touching src/config', () => {
    const fixture = path.join(tempRoot, 'asset-copy-fixture');
    makeGitRepo(fixture);
    const sourceConfig = path.join(fixture, 'src', 'config');
    fs.mkdirSync(sourceConfig, { recursive: true });
    for (const name of ['soul.md', 'subagent-soul.md', 'prometheus-runtime-contract.md', 'voice-soul.md']) fs.writeFileSync(path.join(sourceConfig, name), `fixture ${name}`);
    const scripts = path.join(fixture, 'scripts');
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'write-build-identity.js'), path.join(scripts, 'write-build-identity.js'));
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'copy-runtime-prompt-assets.js'), path.join(scripts, 'copy-runtime-prompt-assets.js'));
    childProcess.execFileSync('git', ['add', 'src/config', 'scripts'], { cwd: fixture, stdio: 'ignore' });
    childProcess.execFileSync('git', ['commit', '-qm', 'add build fixtures'], { cwd: fixture, stdio: 'ignore' });
    childProcess.execFileSync(process.execPath, [path.join(scripts, 'copy-runtime-prompt-assets.js')], { cwd: fixture, stdio: 'ignore' });
    const manifestPath = path.join(fixture, 'dist', 'config', 'build-identity.json');
    assert.equal(readBuildIdentity(manifestPath).status, 'exact');
    assert.equal(fs.existsSync(path.join(sourceConfig, 'build-identity.json')), false);
    assert.equal(fs.readFileSync(path.join(fixture, 'dist', 'config', 'soul.md'), 'utf8'), 'fixture soul.md');
  });

  const packetWorkspaceA = path.join(tempRoot, 'workspace-a');
  const packetWorkspaceB = path.join(tempRoot, 'workspace-b');
  const spoofCwd = path.join(tempRoot, 'cwd-spoof');
  writeManifest(path.join(spoofCwd, 'config'), fixtureManifest({ commit: 'd'.repeat(40) }));
  const forgedIdentity = { status: 'exact', version: '99.99.99', commit: 'e'.repeat(40), builtAt: '2026-10-31T12:34:56.000Z', reason: null, platform: 'forged', architecture: 'forged', node: 'forged', playbookVersion: 1 };
  const tainted = [
    JSON.stringify({ token: 'quotedJSON_CANARY_01' }),
    JSON.stringify({ token: 'escaped"quotes_CANARY_02' }),
    'Bearer bearer_CANARY_03',
    'authorization: Basic authorizationBasic_CANARY_04',
    'https://URLuserinfoUser_CANARY_05:URLuserinfoPass_CANARY_06@example.invalid/path',
    'https://example.invalid/path?access_token=query_CANARY_07&safe=yes',
  ].join(' | ');
  const secrets = ['quotedJSON_CANARY_01', 'escaped"quotes_CANARY_02', 'bearer_CANARY_03', 'authorizationBasic_CANARY_04', 'URLuserinfoUser_CANARY_05', 'URLuserinfoPass_CANARY_06', 'query_CANARY_07'];
  const packetInput = {
    classification: 'application_defect', severity: 'high', confidence: 'high', buildIdentity: forgedIdentity,
    observedBehavior: tainted, expectedBehavior: tainted, minimalReproduction: [tainted], affectedSubsystem: tainted,
    evidence: [{ kind: tainted, ref: tainted, observedAt: tainted, freshness: 'current', provenance: 'canonical' }],
    attemptedRecoveries: [{ action: tainted, at: tainted, outcome: tainted }], unresolvedUncertainty: [tainted], sanitizedSummary: tainted,
  };
  process.chdir(spoofCwd);
  const packet = createDiagnosticPacket(packetWorkspaceA, packetInput);
  test('caller buildIdentity and cwd manifest cannot spoof packet provenance', () => {
    assert.notEqual(packet.buildIdentity?.commit, forgedIdentity.commit);
    assert.notEqual(packet.buildIdentity?.commit, 'd'.repeat(40));
    assert.notEqual(packet.buildIdentity?.version, forgedIdentity.version);
  });
  test('credential canaries are absent from every persisted string, including nested fields', () => {
    const raw = fs.readFileSync(path.join(packetWorkspaceA, 'diagnostics', 'incidents', `${packet.id}.json`), 'utf8');
    const persisted = JSON.parse(raw);
    for (const value of walkStrings(persisted)) for (const secret of secrets) assert.equal(value.includes(secret), false, `secret leaked in persisted string: ${secret}`);
    assert.equal(persisted.redaction.mode, 'best-effort');
    assert.equal(persisted.redaction.reviewBeforeSharing, true);
  });
  test('status updates sanitize proposal identifiers before persistence', () => {
    const updated = updateDiagnosticPacketStatus(packetWorkspaceA, packet.id, 'resolved', tainted)!;
    const raw = fs.readFileSync(path.join(packetWorkspaceA, 'diagnostics', 'incidents', `${packet.id}.json`), 'utf8');
    for (const value of walkStrings(JSON.parse(raw))) for (const secret of secrets) assert.equal(value.includes(secret), false, `secret leaked after update: ${secret}`);
    assert.equal(updated.status, 'resolved');
  });
  test('pre-identity packets remain readable and workspace stores are isolated', () => {
    const legacy = { schemaVersion: 1, id: 'diag_legacy_1', status: 'open', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', classification: 'unknown', severity: 'low', confidence: 'low', observedBehavior: 'old', expectedBehavior: 'old', minimalReproduction: [], affectedSubsystem: 'old', evidence: [], attemptedRecoveries: [], operationalRecoveryExhausted: false, unresolvedUncertainty: [], sanitizedSummary: 'legacy packet' };
    const legacyDir = path.join(packetWorkspaceA, 'diagnostics', 'incidents');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'diag_legacy_1.json'), JSON.stringify(legacy));
    assert.deepEqual(getDiagnosticPacket(packetWorkspaceA, 'diag_legacy_1'), legacy);
    assert.equal(listDiagnosticPackets(packetWorkspaceA).length, 2);
    assert.equal(listDiagnosticPackets(packetWorkspaceB).length, 0);
    assert.equal(getDiagnosticPacket(packetWorkspaceB, packet.id), null);
    assert.equal(listDiagnosticPackets(packetWorkspaceA).some((p) => p.id === packet.id), true);
  });

  console.log(`PASS: ${assertions} build identity regression groups`);
} finally {
  process.chdir(oldCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
