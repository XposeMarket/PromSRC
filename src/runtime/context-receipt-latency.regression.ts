import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { configureContextReceipts, readContextReceipts, recordContextReceiptOutcome } from './context-receipt';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-latency-'));
const dir = path.join(root, 'audit', 'context-receipts');
fs.mkdirSync(dir, { recursive: true });
const id = (n: number) => `rpm_${1700000000000 + n}_aaaaaaaaaaaaaaaa_bbbbbb`;
const put = (n: number, sessionId: string, gatewayTurnId: string) => {
  const record = { version: 1, manifestId: id(n), timestamp: new Date().toISOString(), sessionId, gatewayTurnId, sections: [], userInput: { text: `${sessionId === 'other' ? 'UNRELATED_SENTINEL' : 'TARGET_SENTINEL'} password=unsafe-secret` }, token: 'unsafe-secret' };
  fs.writeFileSync(path.join(dir, `${id(n)}.json`), JSON.stringify(record));
};
const outcome = { sessionId: 'selected', gatewayTurnId: 'turn', status: 'completed' as const, response: 'password=response-secret' };
try {
  for (let n = 0; n < 200; n++) put(n, 'other', 'other-turn');
  put(200, 'selected', 'turn');
  put(201, 'selected', 'different-turn');
  put(202, 'different-session', 'turn');
  const times: number[] = [];
  for (let n = 0; n < 7; n++) {
    const start = performance.now();
    assert.equal(recordContextReceiptOutcome(outcome, root).joined, 1);
    times.push(performance.now() - start);
  }
  console.log('BENCH ' + JSON.stringify({ fixture: '200-unrelated-1-target-2-near-misses', samplesMs: times, medianMs: [...times].sort((a,b) => a-b)[3] }));
  let unrelatedScrubs = 0;
  const original = RegExp.prototype[Symbol.replace];
  RegExp.prototype[Symbol.replace] = function (text: string, replacement: any): string {
    if (String(text).includes('UNRELATED_SENTINEL')) unrelatedScrubs++;
    return original.call(this, text, replacement);
  };
  try { assert.equal(recordContextReceiptOutcome(outcome, root).joined, 1); }
  finally { RegExp.prototype[Symbol.replace] = original; }
  assert.equal(unrelatedScrubs, 0, 'outcome join must not scrub unrelated receipt text');
  configureContextReceipts({ enabled: true }, root);
  let settingsReads = 0;
  const readFileSync = fs.readFileSync;
  (fs as any).readFileSync = (...args: any[]) => {
    if (String(args[0]) === path.join(dir, 'settings.json')) settingsReads++;
    return (readFileSync as any)(...args);
  };
  try { assert.equal(recordContextReceiptOutcome(outcome, root).joined, 1); }
  finally { fs.readFileSync = readFileSync; }
  assert(settingsReads <= 3, `outcome join must not reload settings per file: ${settingsReads}`);
  assert.equal(readContextReceipts({ limit: 256 }, root).records.length, 100, 'public list stays capped at 100');
  const selected = readContextReceipts({ id: id(200), sessionId: 'selected', gatewayTurnId: 'turn', detail: true } as any, root).records[0];
  assert.equal(selected.outcome.state, 'available');
  assert(!JSON.stringify(selected).includes('unsafe-secret'));
  assert(!JSON.stringify(selected).includes('response-secret'));
  for (const n of [201, 202]) assert.equal(readContextReceipts({ id: id(n) }, root).records[0].outcome, undefined);
  assert.equal(readContextReceipts({ id: id(201), gatewayTurnId: 'turn' } as any, root).records.length, 0);
  configureContextReceipts({ enabled: false }, root);
  assert.equal(recordContextReceiptOutcome(outcome, root).joined, 0);
  configureContextReceipts({ enabled: true }, root);
  fs.writeFileSync(path.join(dir, `${id(203)}.json`), '{broken');
  assert.equal(readContextReceipts({ id: id(203) }, root).skipped, 1);
  // Disk-only historical fixtures, independent of capture/maintenance module state.
  for (const name of fs.readdirSync(dir)) if (name !== 'settings.json') fs.unlinkSync(path.join(dir, name));
  for (let n = 0; n < 270; n++) put(n, 'selected', 'turn');
  assert.equal(recordContextReceiptOutcome(outcome, root).joined, 256, 'join all retained records, not the list API limit of 100');
  const joined = fs.readdirSync(dir).filter(n => n !== 'settings.json').map(n => JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'))).filter(r => r.outcome?.state === 'available');
  assert.equal(joined.length, 256);
  console.log('PASS receipt latency: selective sanitization, disk-only joins, redaction, disabled, malformed, >100 matches, cap256');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
