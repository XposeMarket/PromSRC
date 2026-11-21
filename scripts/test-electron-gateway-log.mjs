// Regression: desktop gateway.log gets a timestamp on every line and rotates by
// size (electron/gateway-log.js, wired in electron/main.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGatewayLog, resolveGatewayLogLimits } = require('../electron/gateway-log.js');

const MB = 1024 * 1024;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-gwlog-'));
let clock = Date.parse('2026-11-21T16:00:00.000Z');
const now = () => new Date(clock);
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const tick = () => new Promise((resolve) => setImmediate(resolve));
let failures = 0;

async function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(root, 'case-'));
  try {
    await fn(dir);
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(err);
  }
}

await test('stamps every line, reassembles chunked output per source, buffers pre-open writes', async (dir) => {
  const file = path.join(dir, 'gateway.log');
  const lines = [];
  const log = createGatewayLog({ filePath: file, now, onLine: (line) => lines.push(line), partialFlushMs: 20 });
  log.write('[main] before open\n');
  log.open();
  log.write('[Gateway] hel', 'out');
  clock += 1000;
  log.write('[err] boom\r\n', 'err');
  log.write('lo world\n\n[Gateway] second\n', 'out');
  log.write('prompt without newline', 'out2');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(await log.whenIdle(), true);
  await log.close();
  const rows = read(file).split('\n');
  assert.deepEqual(rows, [
    '2026-11-21T16:00:00.000Z [main] before open',
    '2026-11-21T16:00:01.000Z [err] boom',
    '2026-11-21T16:00:00.000Z [Gateway] hello world',
    '',
    '2026-11-21T16:00:01.000Z [Gateway] second',
    '2026-11-21T16:00:01.000Z prompt without newline',
    '',
  ]);
  assert.deepEqual(lines, ['[main] before open', '[err] boom', '[Gateway] hello world', '[Gateway] second', 'prompt without newline']);
});

await test('reopening below the cap keeps appending (restart history survives)', async (dir) => {
  const file = path.join(dir, 'gateway.log');
  const first = createGatewayLog({ filePath: file, now, maxBytes: 10_000 });
  first.open();
  first.write('[main] first lifetime\n');
  await first.whenIdle();
  await first.close();
  const second = createGatewayLog({ filePath: file, now, maxBytes: 10_000 });
  second.open();
  second.write('[main] second lifetime\n');
  await second.whenIdle();
  await second.close();
  assert.match(read(file), /\[main\] first lifetime\n.*\[main\] second lifetime\n$/s);
  assert.equal(fs.existsSync(`${file}.1`), false);
});

await test('rotates by size, keeps only N archives, never loses or reorders lines in the kept window', async (dir) => {
  const file = path.join(dir, 'gateway.log');
  const maxBytes = 2000;
  const log = createGatewayLog({ filePath: file, now, maxBytes, keep: 2 });
  log.open();
  for (let index = 0; index < 400; index += 1) {
    log.write(`[main] line ${String(index).padStart(4, '0')} ${'x'.repeat(40)}\n`);
    if (index % 25 === 0) await tick();
  }
  assert.equal(await log.whenIdle(), true);
  const { rotations } = log.stats();
  await log.close();
  assert.ok(rotations >= 10, `expected many rotations, got ${rotations}`);
  assert.equal(fs.existsSync(`${file}.1`), true);
  assert.equal(fs.existsSync(`${file}.2`), true);
  assert.equal(fs.existsSync(`${file}.3`), false);
  for (const target of [file, `${file}.1`, `${file}.2`]) {
    assert.ok(fs.statSync(target).size <= maxBytes + 100, `${path.basename(target)} is ${fs.statSync(target).size} bytes`);
  }
  const kept = [`${file}.2`, `${file}.1`, file].map(read).join('');
  const numbers = [...kept.matchAll(/line (\d{4})/g)].map((match) => Number(match[1]));
  assert.equal(numbers.at(-1), 399);
  for (let index = 1; index < numbers.length; index += 1) assert.equal(numbers[index], numbers[index - 1] + 1);
});

await test('an oversized legacy log is rotated out at open and its archive trimmed to whole newest lines', async (dir) => {
  const file = path.join(dir, 'gateway.log');
  const legacy = Array.from({ length: 2000 }, (_, index) => `legacy ${String(index).padStart(5, '0')} ${'y'.repeat(30)}`).join('\n') + '\n';
  fs.writeFileSync(file, legacy);
  const log = createGatewayLog({ filePath: file, now, maxBytes: 10_000, keep: 3 });
  log.open();
  log.write('[main] fresh start\n');
  assert.equal(await log.whenIdle(), true);
  await log.close();
  assert.match(read(file), /^2026-11-21T\S+ \[main\] fresh start\n$/);
  const archived = read(`${file}.1`);
  assert.ok(Buffer.byteLength(archived) <= 10_000 + 200, `archive is ${Buffer.byteLength(archived)} bytes`);
  const rows = archived.split('\n');
  assert.match(rows[0], /archive trimmed to its newest 10 KB \(was 86 KB\)/);
  assert.match(rows[1], /^legacy \d{5} y{30}$/);
  assert.ok(archived.endsWith(`legacy 01999 ${'y'.repeat(30)}\n`));
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
});

await test('a rotation that cannot move the file keeps logging and warns once', async (dir) => {
  const file = path.join(dir, 'gateway.log');
  // keep=1 and a non-empty directory at gateway.log.1 makes the rename fail.
  fs.mkdirSync(`${file}.1`);
  fs.writeFileSync(path.join(`${file}.1`, 'blocker'), 'x');
  const warnings = [];
  const log = createGatewayLog({ filePath: file, now, maxBytes: 1000, keep: 1, warn: (message) => warnings.push(message) });
  log.open();
  for (let index = 0; index < 60; index += 1) {
    log.write(`[main] row ${index} ${'z'.repeat(40)}\n`);
    if (index % 10 === 0) await tick();
  }
  assert.equal(await log.whenIdle(), true);
  await log.close();
  const text = read(file);
  assert.equal((text.match(/\[main\] row /g) || []).length, 60);
  assert.equal(warnings.filter((message) => message.includes('rotation failed')).length, 1);
});

await test('limits come from env with safe fallbacks', async () => {
  assert.deepEqual(resolveGatewayLogLimits({}), { maxBytes: 20 * MB, keep: 3 });
  assert.deepEqual(
    resolveGatewayLogLimits({ PROMETHEUS_GATEWAY_LOG_MAX_MB: '5', PROMETHEUS_GATEWAY_LOG_KEEP: '1' }),
    { maxBytes: 5 * MB, keep: 1 },
  );
  assert.deepEqual(
    resolveGatewayLogLimits({ PROMETHEUS_GATEWAY_LOG_MAX_MB: 'abc', PROMETHEUS_GATEWAY_LOG_KEEP: '0' }),
    { maxBytes: 20 * MB, keep: 3 },
  );
});

await test('electron/main.js routes every gateway.log write through the module', async () => {
  const source = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(source, /require\('\.\/gateway-log'\)/);
  assert.match(source, /createGatewayLog\(\{\s*filePath: GATEWAY_LOG_PATH/);
  assert.doesNotMatch(source, /createWriteStream\(GATEWAY_LOG_PATH/);
  assert.match(source, /supervisor\.stdout\?\.on\('data', \(d\) => writeGatewayLog\(d, supervisorStdout\)\)/);
  assert.match(source, /supervisor\.stderr\?\.on\('data', \(d\) => writeGatewayLog\(d, supervisorStderr\)\)/);
  assert.match(source, /gatewayLog\.flush\(supervisorStdout\)/);
});

fs.rmSync(root, { recursive: true, force: true });
if (failures) {
  console.error(`${failures} gateway log test(s) failed`);
  process.exit(1);
}
console.log('gateway log rotation + timestamps: all checks passed');
