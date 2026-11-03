import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimRuntimeRecovery, setRecoveryClaimDirForTests } from './recovery-claims';
import { readChatRouterSource } from '../../testing/chat-router-source';
import { MAX_DEFERRED_MAIN_CHAT_DRAIN_ATTEMPTS, stepDeferredMainChatRecovery } from '../runtime-recovery';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-recovery-claims-'));
setRecoveryClaimDirForTests(dir);

// Same process: only the first claim wins.
assert.equal(claimRuntimeRecovery('rt-a', 'main_chat_retrigger'), true);
assert.equal(claimRuntimeRecovery('rt-a', 'main_chat_retrigger'), false);
// Different runtime or kind is independent.
assert.equal(claimRuntimeRecovery('rt-b', 'main_chat_retrigger'), true);
assert.equal(claimRuntimeRecovery('rt-a', 'other'), true);

// Separate OS processes racing for the same runtime: exactly one wins.
const childSrc = `
const fs=require('fs'),path=require('path');
const f=path.join(process.argv[1],'rt-race.main_chat_retrigger.claim');
try{const fd=fs.openSync(f,'wx');fs.closeSync(fd);process.stdout.write('WIN');}catch(e){process.stdout.write(e.code==='EEXIST'?'LOSE':'ERR');}
`;
const results = [0, 1, 2, 3].map(() => spawnSync(process.execPath, ['-e', childSrc, dir], { encoding: 'utf8' }).stdout);
assert.equal(results.filter((r) => r === 'WIN').length, 1, `exactly one process should win: ${results.join(',')}`);
assert.equal(claimRuntimeRecovery('rt-race', 'main_chat_retrigger'), false, 'module sees the cross-process claim');

// A claim left by a process that died (incident 2026-11-03) is taken over
// exactly once; a claim held by a live process is never taken over.
const deadPid = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' }).pid;
assert.ok(Number.isInteger(deadPid) && deadPid > 0, 'spawned a short-lived child for a dead pid');
fs.writeFileSync(path.join(dir, 'rt-dead.main_chat_retrigger.claim'), JSON.stringify({ pid: deadPid, runtimeId: 'rt-dead' }));
assert.equal(claimRuntimeRecovery('rt-dead', 'main_chat_retrigger'), true, 'dead owner claim is taken over');
assert.equal(claimRuntimeRecovery('rt-dead', 'main_chat_retrigger'), false, 'takeover happens only once');
assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'rt-dead.main_chat_retrigger.claim'), 'utf8')).pid, process.pid, 'claim now names the new owner');
fs.writeFileSync(path.join(dir, 'rt-live.main_chat_retrigger.claim'), JSON.stringify({ pid: process.pid, runtimeId: 'rt-live' }));
assert.equal(claimRuntimeRecovery('rt-live', 'main_chat_retrigger'), false, 'live owner keeps its claim');
fs.writeFileSync(path.join(dir, 'rt-blank.main_chat_retrigger.claim'), '');
assert.equal(claimRuntimeRecovery('rt-blank', 'main_chat_retrigger'), false, 'fresh unreadable claim may still be mid-write');
const old = new Date(Date.now() - 120_000);
fs.utimesSync(path.join(dir, 'rt-blank.main_chat_retrigger.claim'), old, old);
assert.equal(claimRuntimeRecovery('rt-blank', 'main_chat_retrigger'), true, 'old unreadable claim is abandoned');

// The deferred startup drain must not retry forever.
const fakeRuntime = { id: 'rt-drain', kind: 'main_chat', sessionId: 's-drain', recoveryData: {} } as any;
const attempts = new Map<string, number>();
let calls = 0;
assert.equal(stepDeferredMainChatRecovery(fakeRuntime, () => { calls++; return true; }, attempts, () => false), 'dropped', 'retired record is dropped');
assert.equal(calls, 0, 'retired record is never replayed');
assert.equal(stepDeferredMainChatRecovery(fakeRuntime, () => true, attempts, () => true), 'started');
let last = '';
for (let i = 0; i < MAX_DEFERRED_MAIN_CHAT_DRAIN_ATTEMPTS; i++) last = stepDeferredMainChatRecovery(fakeRuntime, () => false, attempts, () => true);
assert.equal(last, 'dropped', 'failed admissions stop after the attempt cap');
assert.equal(attempts.get('rt-drain'), MAX_DEFERRED_MAIN_CHAT_DRAIN_ATTEMPTS);
let pending = true;
assert.equal(stepDeferredMainChatRecovery({ ...fakeRuntime, id: 'rt-drain-2' }, () => { pending = false; return false; }, attempts, () => pending), 'dropped', 'record retired during the attempt is dropped');

// The retrigger and handoff recovery paths must use the guards.
const root = path.resolve(__dirname, '..');
const router = readChatRouterSource();
const serverSource = fs.readFileSync(path.join(root, 'server-v2.ts'), 'utf8');
assert.match(serverSource, /stepDeferredMainChatRecovery\(runtime, retriggerInterruptedMainChat, deferredDrainAttempts\) === 'retry'/, 'startup drain re-queues only bounded retries');
const start = router.indexOf('export function retriggerInterruptedMainChat(');
const claimAt = router.indexOf("claimRuntimeRecovery(", start);
const leaseAt = router.indexOf('mainChatTurnCoordinator.tryAcquire(sessionId)', start);
assert.ok(start >= 0 && claimAt > start && claimAt < leaseAt, 'retrigger must claim before acquiring the session lease');
const bridge = fs.readFileSync(path.join(__dirname, 'gateway-handoff-bridge.ts'), 'utf8');
assert.match(bridge, /function scheduleRecoveryPass[\s\S]{0,400}isGatewayDraining\(\)/, 'draining gateways must not run handoff recovery');

setRecoveryClaimDirForTests(null);
fs.rmSync(dir, { recursive: true, force: true });
console.log('recovery-claims regression passed');
