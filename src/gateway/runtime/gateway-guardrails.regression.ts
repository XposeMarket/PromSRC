/**
 * Regression tests for PR C guardrails:
 *  - scripts/check-stateful-dynamic-imports.mjs flags stateful dynamic imports and passes stateless ones
 *  - gateway heap-limit formula and env overrides (gateway-node-flags.ts)
 *  - heap-pressure sampler writes a record at a forced-low threshold and rotates its file
 * Run: npx tsx src/gateway/runtime/gateway-guardrails.regression.ts
 */
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeGatewayHeapLimitMb, gatewayNodeFlagExtras } from './gateway-node-flags';
import { HEAP_PRESSURE_FILE_NAME, sampleHeapPressureOnce, startHeapPressureSampler } from './heap-pressure-sampler';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CHECK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-stateful-dynamic-imports.mjs');
const GB = 1024 ** 3;
const tempRoots: string[] = [];
let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function makeTemp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function makeFixture(files: Record<string, string>): string {
  const root = makeTemp('stateful-imports-');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, 'src', rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function runCheck(root: string): SpawnSyncReturns<string> {
  // Baseline path inside the fixture is absent, so the baseline is empty.
  return spawnSync(process.execPath, [CHECK_SCRIPT, '--root', root], { encoding: 'utf8' });
}

// Fixture specifiers are interpolated so scripts/test-dynamic-require-paths.mjs does
// not read these strings as real relative imports of this file (CI failure on f9d9cfbee).
const STATE_SPEC = "'./state.js'";
const ENTRY = `export async function load() {\n  return await import(${STATE_SPEC});\n}\n`;

try {
  check('check script flags a dynamic import of a stateful module', () => {
    const root = makeFixture({
      'entry.ts': ENTRY,
      'state.ts': 'let counter = 0;\nexport const bump = () => ++counter;\n',
    });
    const result = runCheck(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /NEW dynamic import\(\) of a stateful module/);
    assert.match(result.stderr, /src\/entry\.ts:2 -> src\/state\.ts/);
  });

  check('check script passes a dynamic import of a stateless module', () => {
    const root = makeFixture({
      'entry.ts': ENTRY,
      'state.ts': 'export const VALUE = 1;\n',
    });
    const result = runCheck(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  check('check script passes a module whose state is a processSingleton', () => {
    const root = makeFixture({
      'entry.ts': ENTRY,
      'state.ts': "const hooks = processSingleton('state-hooks', () => new Map());\nexport { hooks };\n",
    });
    assert.equal(runCheck(root).status, 0);
  });

  check('check script ignores fixtures and *.fixture.ts files', () => {
    const root = makeFixture({
      'state.ts': 'let counter = 0;\nexport const bump = () => ++counter;\n',
      'runtime/__fixtures__/probe.ts': ENTRY,
      'runtime/probe.fixture.ts': ENTRY,
    });
    assert.equal(runCheck(root).status, 0);
  });

  check('check script honors the baseline count (allowed, then exceeded)', () => {
    const root = makeFixture({
      'entry.ts': ENTRY,
      'state.ts': 'let counter = 0;\nexport const bump = () => ++counter;\n',
    });
    const baseline = path.join(root, 'baseline.json');
    fs.writeFileSync(baseline, JSON.stringify({ violations: [{ file: 'src/entry.ts', target: 'src/state.ts', count: 1 }] }));
    const allowed = spawnSync(process.execPath, [CHECK_SCRIPT, '--root', root, '--baseline', baseline], { encoding: 'utf8' });
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
    fs.writeFileSync(baseline, JSON.stringify({ violations: [{ file: 'src/entry.ts', target: 'src/state.ts', count: 0 }] }));
    const exceeded = spawnSync(process.execPath, [CHECK_SCRIPT, '--root', root, '--baseline', baseline], { encoding: 'utf8' });
    assert.equal(exceeded.status, 1);
  });

  check('check script passes on the real repo', () => {
    const result = spawnSync(process.execPath, [CHECK_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  check('heap limit formula: 8 GB -> no flag, 16 GB -> 4096, 24 GB -> 6144, 32 GB -> 8192, 64 GB -> 8192', () => {
    assert.equal(computeGatewayHeapLimitMb(8 * GB), null);
    assert.equal(computeGatewayHeapLimitMb(16 * GB), 4096);
    assert.equal(computeGatewayHeapLimitMb(24 * GB), 6144);
    assert.equal(computeGatewayHeapLimitMb(32 * GB), 8192);
    assert.equal(computeGatewayHeapLimitMb(64 * GB), 8192);
    assert.deepEqual(gatewayNodeFlagExtras({ env: {}, execArgv: [], totalMemBytes: 8 * GB }), []);
    assert.deepEqual(gatewayNodeFlagExtras({ env: {}, execArgv: [], totalMemBytes: 16 * GB }), ['--max-old-space-size=4096']);
    assert.deepEqual(gatewayNodeFlagExtras({ env: {}, execArgv: [], totalMemBytes: 32 * GB }), ['--max-old-space-size=8192']);
  });

  check('heap limit: env 0 disables, env value overrides, existing flags are respected', () => {
    assert.deepEqual(gatewayNodeFlagExtras({ env: { PROMETHEUS_GATEWAY_HEAP_LIMIT_MB: '0' }, execArgv: [], totalMemBytes: 32 * GB }), []);
    assert.deepEqual(gatewayNodeFlagExtras({ env: { PROMETHEUS_GATEWAY_HEAP_LIMIT_MB: '6000' }, execArgv: [], totalMemBytes: 8 * GB }), ['--max-old-space-size=6000']);
    assert.deepEqual(gatewayNodeFlagExtras({ env: {}, execArgv: ['--max-old-space-size=2048'], totalMemBytes: 32 * GB }), []);
    assert.deepEqual(gatewayNodeFlagExtras({ env: { NODE_OPTIONS: '--max-old-space-size=3000' }, execArgv: [], totalMemBytes: 32 * GB }), []);
  });

  check('near-limit heap snapshots are off by default and on with the env flag', () => {
    const configDir = makeTemp('heap-flags-cfg-');
    assert.deepEqual(gatewayNodeFlagExtras({ env: {}, execArgv: [], totalMemBytes: 8 * GB, configDir }).some((f) => f.includes('heapsnapshot')), false);
    const on = gatewayNodeFlagExtras({ env: { PROMETHEUS_GATEWAY_HEAPSNAPSHOT_NEAR_LIMIT: '1' }, execArgv: [], totalMemBytes: 8 * GB, configDir });
    assert.ok(on.includes('--heapsnapshot-near-heap-limit=1'));
    assert.ok(on.includes(`--diagnostic-dir=${path.join(configDir, 'logs', 'heap')}`));
  });

  check('sampler writes a record at a forced-low threshold, skips when not under pressure, and rotates', () => {
    const configDir = makeTemp('heap-sampler-');
    fs.mkdirSync(path.join(configDir, 'runtimes'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'runtimes', 'active-runtimes.json'),
      JSON.stringify({ runtimes: { rt1: { id: 'rt1', kind: 'main_chat' } } }));
    const file = path.join(configDir, HEAP_PRESSURE_FILE_NAME);

    assert.equal(sampleHeapPressureOnce({ configDir, ratio: 2 }), null, 'ratio above 1 must never trigger');
    assert.equal(fs.existsSync(file), false);

    const record = sampleHeapPressureOnce({ configDir, ratio: 0, maxBytes: 200 });
    assert.ok(record, 'forced-low threshold must write a record');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.pid, process.pid);
    assert.ok(Array.isArray(parsed.heapSpaces) && parsed.heapSpaces.length > 0);
    assert.ok(parsed.memory.heapUsed > 0);
    assert.deepEqual(parsed.runtimes, [{ id: 'rt1', kind: 'main_chat' }]);

    // Second write: the file is already over maxBytes, so it rotates to .1 first.
    sampleHeapPressureOnce({ configDir, ratio: 0, maxBytes: 200 });
    assert.equal(fs.existsSync(`${file}.1`), true, 'oversized file must rotate to .1');
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
  });

  check('sampler is disabled by PROMETHEUS_GATEWAY_HEAP_SAMPLER=0', () => {
    const previous = process.env.PROMETHEUS_GATEWAY_HEAP_SAMPLER;
    process.env.PROMETHEUS_GATEWAY_HEAP_SAMPLER = '0';
    try {
      assert.equal(startHeapPressureSampler({ configDir: makeTemp('heap-off-') }), false);
    } finally {
      if (previous === undefined) delete process.env.PROMETHEUS_GATEWAY_HEAP_SAMPLER;
      else process.env.PROMETHEUS_GATEWAY_HEAP_SAMPLER = previous;
    }
  });

  check('type-only import() references (typeof import, import().T) are not dynamic imports', () => {
    const root = makeFixture({
      'entry.ts': `export type Foo = import(${STATE_SPEC}).Foo;\nexport const probe = null as unknown as typeof import(${STATE_SPEC});\n`,
      'state.ts': 'let counter = 0;\nexport const bump = () => ++counter;\nexport interface Foo { a: number }\n',
    });
    const result = runCheck(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  check('multi-line and template-literal dynamic imports are flagged', () => {
    const stateful = 'let counter = 0;\nexport const bump = () => ++counter;\n';
    const multi = "export async function load() {\n  return await import(\n    './state.js'\n  );\n}\n";
    const multiResult = runCheck(makeFixture({ 'entry.ts': multi, 'state.ts': stateful }));
    assert.equal(multiResult.status, 1, multiResult.stdout + multiResult.stderr);
    assert.match(multiResult.stderr, /src\/entry\.ts:2 -> src\/state\.ts/);
    const tpl = 'export async function load() {\n  return await import(`./state.js`);\n}\n';
    assert.equal(runCheck(makeFixture({ 'entry.ts': tpl, 'state.ts': stateful })).status, 1);
  });

  check('a typed const Map makes the target stateful', () => {
    const root = makeFixture({
      'entry.ts': ENTRY,
      'state.ts': 'const handlers: Map<string, () => void> = new Map();\nexport { handlers };\n',
    });
    assert.equal(runCheck(root).status, 1);
  });

  check('a processSingleton-only module is not stateful', () => {
    const root = makeFixture({
      'entry.ts': ENTRY,
      'state.ts': "const s = processSingleton('x', () => ({}));\nexport { s };\n",
    });
    assert.equal(runCheck(root).status, 0);
  });

  check('a top-level process.on makes the target stateful', () => {
    const root = makeFixture({
      'entry.ts': ENTRY,
      'state.ts': "process.on('exit', () => undefined);\nexport const VALUE = 1;\n",
    });
    assert.equal(runCheck(root).status, 1);
  });

  console.log(`gateway guardrails: ${passed} checks passed`);
} finally {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true });
}
