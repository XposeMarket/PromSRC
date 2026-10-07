import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimRuntimeRecovery, setRecoveryClaimDirForTests } from './recovery-claims';

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

// The retrigger and handoff recovery paths must use the guards.
const root = path.resolve(__dirname, '..');
const router = fs.readFileSync(path.join(root, 'routes', 'chat.router.ts'), 'utf8');
const start = router.indexOf('export function retriggerInterruptedMainChat(');
const claimAt = router.indexOf("claimRuntimeRecovery(", start);
const leaseAt = router.indexOf('mainChatTurnCoordinator.tryAcquire(sessionId)', start);
assert.ok(start >= 0 && claimAt > start && claimAt < leaseAt, 'retrigger must claim before acquiring the session lease');
const bridge = fs.readFileSync(path.join(__dirname, 'gateway-handoff-bridge.ts'), 'utf8');
assert.match(bridge, /function scheduleRecoveryPass[\s\S]{0,400}isGatewayDraining\(\)/, 'draining gateways must not run handoff recovery');

setRecoveryClaimDirForTests(null);
fs.rmSync(dir, { recursive: true, force: true });
console.log('recovery-claims regression passed');
