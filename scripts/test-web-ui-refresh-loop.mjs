#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = fs.readFileSync(path.join(root, 'src/gateway/core/server.ts'), 'utf8');
const wsSource = fs.readFileSync(path.join(root, 'web-ui/src/ws.js'), 'utf8');

assert.match(
  serverSource,
  /type:\s*'dev_reload_requested',[\s\S]{0,240}notificationId:\s*item\.id/,
  'restart reload events must identify the startup notification they supersede',
);
assert.match(
  wsSource,
  /const notificationId = String\(msg\?\.notificationId \|\| ''\)\.trim\(\);/,
  'the web UI must read the stable restart notification id',
);
assert.match(
  wsSource,
  /wsSend\(\{[\s\S]{0,220}type:\s*'startup_notification_ack',[\s\S]{0,220}notificationId/,
  'the web UI must acknowledge a restart notification before reloading',
);
assert.match(
  wsSource,
  /function reloadScopeId\(msg = \{\}\)[\s\S]{0,220}msg\?\.batchId \|\| msg\?\.notificationId/,
  'restart dedupe must prefer a shared restart batch before the individual notification id',
);
assert.match(
  wsSource,
  /function isReloadPending\(scopeId\)[\s\S]{0,360}guard\?\.scopeId[\s\S]{0,180}String\(scopeId \|\| ''\)[\s\S]{0,180}guard\?\.until/,
  'the reload guard must suppress only the same restart scope while its guard is active',
);
assert.match(
  wsSource,
  /const scopeId = reloadScopeId\(msg\);\s*if \(isReloadPending\(scopeId\)\) return;/,
  'duplicate notifications from the same restart scope must schedule only one reload',
);
assert.match(
  wsSource,
  /markReloadPending\(scopeId, delayMs \+ 15000\);/,
  'the persisted reload guard must be written for the current restart scope',
);
assert.doesNotMatch(
  wsSource,
  /if \(isReloadPending\(\)\) return;/,
  'a global time-only reload guard would incorrectly suppress a genuinely separate restart',
);

const scopeFor = (msg = {}) => String(msg?.batchId || msg?.notificationId || msg?.timestamp || msg?.reason || 'restart').trim();
const sameNotification = { batchId: 'restart-a', notificationId: 'notification-1' };
const sameBatchOtherNotification = { batchId: 'restart-a', notificationId: 'notification-2' };
const separateRestart = { batchId: 'restart-b', notificationId: 'notification-3' };
assert.equal(scopeFor(sameNotification), scopeFor(sameNotification), 'the same notification must retain one dedupe scope');
assert.equal(scopeFor(sameNotification), scopeFor(sameBatchOtherNotification), 'multiple notifications from one restart batch must share one dedupe scope');
assert.notEqual(scopeFor(sameNotification), scopeFor(separateRestart), 'a genuinely separate restart batch must be eligible for a new reload');

console.log('web-ui refresh-loop contract passed');
