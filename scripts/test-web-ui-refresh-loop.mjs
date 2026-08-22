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
  /const id = notificationId \|\| String\(msg\?\.batchId \|\| msg\?\.timestamp/,
  'reload deduplication must remain stable when a notification id is available',
);
assert.match(
  wsSource,
  /if \(isReloadPending\(\)\) return;/,
  'a page must not schedule multiple reloads for one restart',
);

console.log('web-ui refresh-loop contract passed');
