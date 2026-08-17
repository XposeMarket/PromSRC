import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const audit = read('src/gateway/audit-log.ts');
const router = read('src/gateway/routes/audit-log.router.ts');

assert.doesNotMatch(
  audit,
  /AUDIT_ROTATION_PENDING_BYTES/,
  'async rotation must not silently cap and drop pending audit entries',
);
assert.match(
  audit,
  /if \(_rotationInProgress\) \{[\s\S]*?_rotationPendingLines\.push\(line\);[\s\S]*?return;/,
  'entries arriving during rotation must be retained for the post-rotation flush',
);
assert.match(
  audit,
  /export async function queryAuditLogAsync/,
  'gateway-facing audit reads need an asynchronous query path',
);
assert.match(
  audit,
  /await fs\.promises\.readFile\(logPath, 'utf-8'\)/,
  'audit query file I/O must not synchronously read the entire log on the gateway loop',
);
assert.match(
  audit,
  /index % 512 === 0[\s\S]*?setImmediate/,
  'large audit parsing should yield periodically to the gateway loop',
);
assert.match(
  router,
  /router\.get\('\/api\/audit-log', async/,
  'the HTTP audit handler must be asynchronous',
);
assert.match(
  router,
  /await queryAuditLogAsync\(/,
  'the HTTP audit handler must use the non-blocking query path',
);
assert.doesNotMatch(
  router,
  /\bqueryAuditLog\(/,
  'the HTTP path must not regress to the synchronous full-file query',
);

console.log('[test-audit-log-async-contract] passed: audit rotation preserves pending records and HTTP queries avoid synchronous full-file reads');
