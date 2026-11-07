// Regression for legacy POST /api/connections/disconnect: owner gate, exact-byte consent parser coverage,
// X lifecycle tombstone fail-closed (no mutation after stop failure), and client consent allowlists.
// Source checks here; runtime denial/approval/exact-body HTTP proof lives in scripts/test-protected-plugin-http.ts.
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const conn = read('src/gateway/routes/connections.router.ts');
check('legacy disconnect route requires protected owner', /router\.post\('\/api\/connections\/disconnect',\s*requireProtectedOwner,/.test(conn));

const xStart = conn.indexOf("if (id === 'x')");
const tombstoneAt = conn.indexOf("setPluginCredentialState(getConfig().getConfigDir(), 'x', true, 'disconnect')", xStart);
const clearAt = conn.indexOf('clearXApiTokens(getConfig().getConfigDir())', xStart);
check('X legacy disconnect persists lifecycle tombstone before clearing tokens', xStart > 0 && tombstoneAt > xStart && clearAt > tombstoneAt);
check('tombstone sits in its own try, not the swallowed best-effort block', /if \(id === 'x'\) \{\s*try \{\s*$/.test(conn.slice(xStart, tombstoneAt)));
check('tombstone failure returns fixed-text 503 and returns before mutation', /^[\s\S]*?\} catch \{[\s\S]*?res\.status\(503\)\.json\(\{ error: 'CONNECTOR_STOP_FAILED' \}\);\s*return;\s*\}\s*clearXApiTokens/.test(conn.slice(tombstoneAt, clearAt + 40)));

const app = read('src/gateway/core/app.ts');
const rawLine = app.split('\n').find(l => l.includes("limit: '32kb'") && l.includes("'/api/connections-v2'")) || '';
check('app.ts 32kb raw-body parser lists /api/connections/disconnect', rawLine.includes("'/api/connections/disconnect'"));

const consent = read('electron/owner-consent.js');
check('native owner-consent allowlists legacy disconnect', consent.includes('/^\\/api\\/connections\\/disconnect$/'));

const core = read('web-ui/src/features/secure-access/secure-access-core.js');
check('web needsOwnerConsent allowlists legacy disconnect', core.includes('connections\\/disconnect'));

const mobile = read('web-ui/src/mobile/mobile-plugins-page.js');
check('mobile legacy followup uses consent-aware postJsonConsent', /postJsonConsent\([\s\S]{0,260}'\/api\/connections\/disconnect'/.test(mobile));
check('mobile has no unguarded legacy fallback post', !/\bpost\('\/api\/connections\/disconnect'/.test(mobile));

if (failures.length) {
  console.error(`FAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('test-legacy-disconnect-owner: PASS');
