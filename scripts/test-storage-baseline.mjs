import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareStorage, scanStorage } from './lib/storage-baseline.mjs';

const DAY = 24 * 60 * 60 * 1000;
const CLI = fileURLToPath(new URL('./storage-baseline.mjs', import.meta.url));
const failures = [];
let checks = 0;
async function test(name, fn) {
  checks++;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error?.stack || error}`);
    console.error(`FAIL ${name}: ${error?.message || error}`);
  }
}
function cli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
}
function assertCliFailure(result) {
  assert.notEqual(result.status, 0, `expected CLI failure, got ${result.stdout}`);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.trim());
}
async function mkdir(dir) { await fs.mkdir(dir, { recursive: true }); }
async function putFile(filename, content, mtimeMs) {
  await mkdir(path.dirname(filename));
  await fs.writeFile(filename, content);
  const date = new Date(mtimeMs);
  await fs.utimes(filename, date, date);
}
async function snapshotTree(root) {
  const result = [];
  async function visit(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const filename = path.join(dir, entry.name);
      const st = await fs.lstat(filename);
      result.push([path.relative(root, filename), st.mode, st.size, st.mtimeMs, st.isSymbolicLink()]);
      if (st.isDirectory() && !st.isSymbolicLink()) await visit(filename);
    }
  }
  await visit(root);
  return result;
}
async function makeJunction(target, link) {
  await fs.symlink(target, link, 'junction');
  const st = await fs.lstat(link);
  assert.ok(st.isSymbolicLink(), 'fixture junction must be recognized as a link');
}
async function expectRejected(promise, message) {
  await assert.rejects(promise, message);
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-baseline-test-'));
try {
  const now = Date.UTC(2025, 4, 20, 12, 0, 0);
  const root = path.join(temp, 'DO_NOT_EMIT_root_path_93c1');
  const target = path.join(temp, 'DO_NOT_EMIT_link_target_8b24');
  await mkdir(root);
  await mkdir(target);
  const fixtureFiles = [
    { name: 'DO_NOT_EMIT_root_name_c110.dat', content: 'CONTENT_SENTINEL_root_36ef', age: DAY },
    { name: 'DO_NOT_EMIT_audit_name_7a22.bin', content: 'CONTENT_SENTINEL_audit_4ae0', dir: 'audit', age: 14 * DAY },
    { name: 'DO_NOT_EMIT_nested_name_8834.bin', content: 'CONTENT_SENTINEL_nested_d288', dir: path.join('audit', 'private-folder-DO_NOT_EMIT'), age: 60 * DAY },
    { name: 'DO_NOT_EMIT_unknown_name_e81a.log', content: 'CONTENT_SENTINEL_unknown_5c41', dir: 'private-folder-DO_NOT_EMIT', age: 3 * DAY },
    { name: 'DO_NOT_EMIT_future_name_d672.dat', content: 'CONTENT_SENTINEL_future_1b2d', dir: 'private-folder-DO_NOT_EMIT', age: -2 * DAY },
  ];
  for (const file of fixtureFiles) {
    await putFile(path.join(root, file.dir || '', file.name), file.content, now - file.age);
  }
  const targetFile = path.join(target, 'DO_NOT_EMIT_linked_file_091a.bin');
  await putFile(targetFile, 'CONTENT_SENTINEL_linked_should_not_count_31a6', now - DAY);
  const internalJunction = path.join(root, 'DO_NOT_EMIT_junction_5771');
  await makeJunction(target, internalJunction);

  let baseline;
  await test('scan counts actual regular-file bytes, files, fixed buckets, and all age bands', async () => {
    const before = await snapshotTree(root);
    const targetBefore = await snapshotTree(target);
    baseline = await scanStorage(root, { now });
    const after = await snapshotTree(root);
    const targetAfter = await snapshotTree(target);
    assert.deepEqual(after, before, 'scanner must not change fixture names or metadata');
    assert.deepEqual(targetAfter, targetBefore, 'scanner must not mutate linked-to target metadata');

    const expected = { files: 0, bytes: 0, buckets: {}, age: {
      under7Days: { files: 0, bytes: 0 }, days7To30: { files: 0, bytes: 0 },
      over30Days: { files: 0, bytes: 0 }, unknown: { files: 0, bytes: 0 },
    } };
    for (const file of fixtureFiles) {
      const filename = path.join(root, file.dir || '', file.name);
      const st = await fs.stat(filename);
      const group = file.dir?.split(path.sep)[0] === 'audit' ? 'audit' : 'other';
      const delta = now - st.mtimeMs;
      const age = delta < 0 ? 'unknown' : delta < 7 * DAY ? 'under7Days' : delta < 30 * DAY ? 'days7To30' : 'over30Days';
      for (const count of [expected, expected.buckets[group] ||= { files: 0, bytes: 0 }, expected.age[age]]) {
        count.files++;
        count.bytes += st.size;
      }
    }
    assert.equal(baseline.files, expected.files);
    assert.equal(baseline.bytes, expected.bytes);
    assert.deepEqual(baseline.buckets, expected.buckets);
    assert.deepEqual(baseline.age, expected.age);
    assert.equal(baseline.skippedLinks, 1);
    assert.equal(baseline.complete, true);
    assert.equal(baseline.sizeKind, 'apparent_bytes');
    assert.match(baseline.rootId, /^[a-f0-9]{64}$/);
    assert.equal(baseline.entries, fixtureFiles.length + 1 /* internal junction */ + 3 /* directories */);

    const json = JSON.stringify(baseline);
    for (const secret of [root, path.basename(root), path.basename(target), ...fixtureFiles.map(f => f.name), ...fixtureFiles.map(f => f.content), 'private-folder-DO_NOT_EMIT']) {
      assert.ok(!json.includes(secret), `report leaked ${secret}`);
    }
    const keys = Object.keys(baseline.buckets);
    assert.deepEqual(keys, [...keys].sort(), 'full result bucket ordering is canonical');
    const repeated = await scanStorage(root, { now });
    for (const key of ['schemaVersion', 'observedAt', 'sizeKind', 'maxEntries', 'maxDepth', 'complete', 'entries', 'files', 'bytes', 'skippedLinks', 'skippedSpecial', 'errors', 'depthLimited', 'entryLimited', 'buckets', 'age']) {
      assert.deepEqual(repeated[key], baseline[key], `stable aggregate ${key}`);
    }
  });

  await test('directory junction is skipped without following/counting target files', async () => {
    const linkRoot = path.join(temp, 'junction-scan-root');
    const externalTarget = path.join(temp, 'junction-scan-target');
    await mkdir(linkRoot);
    await mkdir(externalTarget);
    await putFile(path.join(linkRoot, 'ordinary.bin'), 'abc', now - DAY);
    await putFile(path.join(externalTarget, 'DO_NOT_EMIT_external_45f3.bin'), 'X'.repeat(1200), now - DAY);
    await makeJunction(externalTarget, path.join(linkRoot, 'junction-to-external'));
    const report = await scanStorage(linkRoot, { now });
    assert.equal(report.files, 1);
    assert.equal(report.bytes, 3);
    assert.equal(report.skippedLinks, 1);
    assert.equal(report.complete, true);
    assert.ok(!JSON.stringify(report).includes('DO_NOT_EMIT_external_45f3'));
  });

  await test('junction supplied as the scan root is rejected', async () => {
    const link = path.join(temp, 'root-junction');
    await makeJunction(root, link);
    await expectRejected(scanStorage(link, { now }), /Root must be an accessible non-link directory/);
    assertCliFailure(cli(['--root', link]));
  });

  await test('entry and depth bounds report incomplete scans without ordering assumptions', async () => {
    const limitedEntries = await scanStorage(root, { now, maxEntries: 2 });
    assert.ok(limitedEntries.entries <= 2);
    assert.equal(limitedEntries.entryLimited, true);
    assert.equal(limitedEntries.complete, false);
    assert.ok(limitedEntries.files <= limitedEntries.entries);
    const limitedDepth = await scanStorage(root, { now, maxDepth: 1 });
    assert.ok(limitedDepth.entries <= baseline.entries);
    assert.ok(limitedDepth.depthLimited > 0);
    assert.equal(limitedDepth.complete, false);
    assert.ok(limitedDepth.files <= fixtureFiles.length);
    assert.equal(limitedEntries.maxEntries, 2);
    assert.equal(limitedDepth.maxDepth, 1);
  });

  await test('invalid root, options, and time values fail closed', async () => {
    for (const value of [undefined, '', '  ', 5, null]) await expectRejected(scanStorage(value, { now }), /Explicit root required/);
    await expectRejected(scanStorage(path.join(root, 'missing'), { now }), /Root must be an accessible non-link directory/);
    const fileRoot = path.join(temp, 'not-a-directory');
    await fs.writeFile(fileRoot, 'x');
    await expectRejected(scanStorage(fileRoot, { now }), /Root must be an accessible non-link directory/);
    for (const maxEntries of [0, -1, 1.2, NaN, Infinity, 1000001, 'invalid']) {
      await expectRejected(scanStorage(root, { maxEntries, now }), /Invalid maxEntries/);
    }
    for (const maxDepth of [0, -1, 1.2, NaN, Infinity, 65, 'invalid']) {
      await expectRejected(scanStorage(root, { maxDepth, now }), /Invalid maxDepth/);
    }
    for (const badNow of [-1, NaN, Infinity, '2025-05-20']) {
      await expectRejected(scanStorage(root, { now: badNow }), /Invalid time/);
    }
  });

  await test('comparison accepts matching reports and marks incomplete deltas provisional', async () => {
    const after = await scanStorage(root, { now: now + 1000, maxEntries: 1 });
    const comparison = compareStorage(baseline, after);
    assert.equal(comparison.rootId, baseline.rootId);
    assert.equal(comparison.bytesDelta, after.bytes - baseline.bytes);
    assert.equal(comparison.filesDelta, after.files - baseline.files);
    assert.equal(comparison.provisional, true);
    assert.equal(compareStorage(baseline, baseline).provisional, false);
  });

  await test('comparison rejects malformed schema, roots, times, and numeric totals', async () => {
    const invalid = [
      { ...baseline, schemaVersion: 2 },
      { ...baseline, sizeKind: 'allocated_bytes' },
      { ...baseline, rootId: 'not-a-hash' },
      { ...baseline, observedAt: 'not a date' },
      { ...baseline, complete: 'true' },
      { ...baseline, bytes: -1 },
      { ...baseline, bytes: 1.5 },
      { ...baseline, files: -1 },
      { ...baseline, files: Number.MAX_SAFE_INTEGER + 1 },
      { ...baseline, buckets: { ...baseline.buckets, audit: { files: 1, bytes: baseline.buckets.audit.bytes + 1 } } },
      { ...baseline, age: { ...baseline.age, unknown: { files: 9, bytes: baseline.age.unknown.bytes } } },
    ];
    const acceptedMalformed = [];
    for (let i = 0; i < invalid.length; i++) {
      try { compareStorage(baseline, invalid[i]); }
      catch (error) {
        assert.match(error.message, /Invalid storage report/);
        continue;
      }
      acceptedMalformed.push(i + 1);
    }
    assert.deepEqual(acceptedMalformed, [], `compareStorage accepted malformed report cases ${acceptedMalformed.join(', ')}`);
    const otherRoot = { ...baseline, rootId: '0'.repeat(64) };
    assert.throws(() => compareStorage(baseline, otherRoot), /Storage roots do not match/);
    const laterThenEarlier = { ...baseline, observedAt: new Date(now - 1000).toISOString() };
    assert.throws(() => compareStorage(baseline, laterThenEarlier), /chronological order/);
  });

  await test('CLI help documents apparent rather than allocated size', () => {
    const result = cli(['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /apparent, not allocated/i);
    assert.match(result.stdout, /incomplete scans are provisional/i);
  });

  await test('CLI rejects malformed options and does not echo fixture paths', () => {
    const badArgs = [
      [], ['--root'], ['--root', root, '--mystery', '1'],
      ['--root', root, '--root', root], ['--root', root, '--max-entries', '0'],
      ['--root', root, '--max-entries', '1.5'], ['--root', root, '--max-entries', '1000001'],
      ['--root', root, '--max-depth', '65'], ['--root', root, '--max-depth', 'nope'],
      ['--root', root, '--max-depth'], ['--help', 'extra'],
    ];
    for (const args of badArgs) {
      const result = cli(args);
      assertCliFailure(result);
      assert.ok(!result.stderr.includes(root), `CLI error leaked root path for ${args.join(' ')}`);
      assert.ok(!result.stderr.includes('DO_NOT_EMIT'), `CLI error leaked fixture name for ${args.join(' ')}`);
    }
  });

  await test('CLI emits metadata JSON and compares bounded saved reports', async () => {
    const scanned = cli(['--root', root, '--max-entries', '2']);
    assert.equal(scanned.status, 0, scanned.stderr);
    const cliReport = JSON.parse(scanned.stdout);
    assert.equal(cliReport.entryLimited, true);
    assert.equal(cliReport.complete, false);
    assert.equal(cliReport.sizeKind, 'apparent_bytes');
    assert.ok(!scanned.stdout.includes('DO_NOT_EMIT'));
    const beforePath = path.join(temp, 'before-report.json');
    const afterPath = path.join(temp, 'after-report.json');
    await fs.writeFile(beforePath, JSON.stringify(baseline));
    const after = await scanStorage(root, { now: now + 1000, maxEntries: 1 });
    await fs.writeFile(afterPath, JSON.stringify(after));
    const compared = cli(['--before', beforePath, '--after', afterPath]);
    assert.equal(compared.status, 0, compared.stderr);
    const result = JSON.parse(compared.stdout);
    assert.equal(result.provisional, true);
    assert.equal(result.bytesDelta, after.bytes - baseline.bytes);

    const badJson = path.join(temp, 'malformed-report.json');
    await fs.writeFile(badJson, '{bad json');
    const malformed = cli(['--before', badJson, '--after', afterPath]);
    assertCliFailure(malformed);
    assert.ok(!malformed.stderr.includes(badJson));
    const oversized = path.join(temp, 'oversized-report.json');
    await fs.writeFile(oversized, `${JSON.stringify(baseline)}${' '.repeat(65536)}`);
    assert.ok((await fs.stat(oversized)).size > 65536);
    const tooLarge = cli(['--before', oversized, '--after', afterPath]);
    assertCliFailure(tooLarge);
    assert.ok(!tooLarge.stderr.includes(oversized));
  });
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

console.log(`Storage baseline test groups: ${checks}; failed: ${failures.length}`);
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exitCode = 1;
}
