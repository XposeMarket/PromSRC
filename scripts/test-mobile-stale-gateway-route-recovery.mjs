import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('web-ui/src/mobile/mobile-router.js', 'utf8');
const generated = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-router.js', 'utf8');
const catalog = fs.readFileSync('web-ui/src/mobile/mobile-gateway-catalog.js', 'utf8');
const shell = fs.readFileSync('web-ui/src/mobile/mobile-shell.js', 'utf8');

assert.equal(source, generated, 'generated mobile router must mirror canonical source');

assert.match(
  shell,
  /if \(!target\) throw new Error\('This chat’s gateway is unavailable\. Reconnect it before trying again\.'\)/,
  'regression must continue covering the exact stale-route failure reported by mobile',
);
assert.match(
  catalog,
  /resolveMobileSessionGateway[\s\S]*?boundOrigin[\s\S]*?normalizeGatewayOrigin\(entry\.origin\) === boundOrigin/,
  'session gateway resolution must retain the existing same-origin identity-replacement recovery path',
);

const repairStart = source.indexOf('function _repairNamespacedChatRoute');
const renderStart = source.indexOf('\nfunction render()', repairStart);
assert.ok(repairStart >= 0 && renderStart > repairStart, 'mobile router must define stale namespaced chat route repair before render');
const repair = source.slice(repairStart, renderStart);

assert.match(
  repair,
  /resolveMobileSessionGateway\(parsed\.targetId, \{ fallbackToCurrentGateway: false \}\)/,
  'stale route repair must resolve through the session binding/origin without arbitrary current-gateway fallback',
);
assert.match(
  repair,
  /targetNamespacedId\(recoveredGateway\.gatewayId, parsed\.targetId\)/,
  'repaired route must keep the original session id and only canonicalize its gateway id',
);
assert.match(
  repair,
  /history\.replaceState\([\s\S]*?#mobile\/chat\//,
  'already-open stale routes must be canonicalized in place instead of forcing a new chat',
);
assert.doesNotMatch(
  repair,
  /fallbackToCurrentGateway:\s*true/,
  'a remote thread must never recover by silently jumping to whichever gateway is currently active',
);

assert.match(
  source,
  /let \{ page, arg, extra \} = mobileRouteFromLocation\(\);\s*arg = _repairNamespacedChatRoute\(page, arg\);/,
  'route repair must happen before renderChatPage receives the target id',
);
assert.match(
  source,
  /recoverMobileBootSurface[\s\S]*?targetedChat[\s\S]*?safeRender\(\)/,
  'a fully rendered targeted chat must re-evaluate its route after iOS resume/focus',
);
assert.match(
  source,
  /onGatewayCatalogChanged\(\(detail\) => \{[\s\S]*?gateway_identity_migrated[\s\S]*?safeRender\(\)/,
  'visible chats must immediately re-render after same-computer gateway identity migration',
);

console.log('[test-mobile-stale-gateway-route-recovery] passed: existing chats repair stale gateway ids without cross-gateway fallback');
