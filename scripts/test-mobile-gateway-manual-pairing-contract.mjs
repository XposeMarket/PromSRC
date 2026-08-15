import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const pairing = read('web-ui/src/mobile/mobile-pairing-page.js');
const generatedPairing = read('generated/public-web-ui/static/mobile/mobile-pairing-page.js');

assert.equal(generatedPairing, pairing, 'generated mobile pairing page must stay synchronized with source');
assert.match(pairing, /pm_mobile_pending_gateway_pair_origin_v1/, 'manual add flow must retain the remote origin on the current PWA origin');
assert.match(pairing, /const useTargetGatewayPairing = Boolean\(pairingPayload\)[\s\S]*addMode && targetOrigin && targetOrigin !== currentOrigin/, 'manual remote additions must use the cross-origin pairing bridge');
assert.match(pairing, /if \(addMode\) \{[\s\S]*_setPendingManualGatewayOrigin\(requestedOrigin\);[\s\S]*nextUrl\.searchParams\.set\('pair', parsed\.code\);[\s\S]*nextUrl\.hash = pairRoute;[\s\S]*window\.location\.href = nextUrl\.toString\(\)/, 'manual additions must stay on the current app origin instead of navigating to the target origin');
assert.match(pairing, /_pairRequestCacheKey\(code, origin = ''\)[\s\S]*const scoped = `\$\{target\}\|\$\{String\(code \|\| ''\)\.trim\(\)\}`/, 'pair request cache keys must include the target origin');
assert.match(pairing, /_loadPairRequestCache\(pairingCode, targetOrigin\)/);
assert.match(pairing, /_storePairRequestCache\(pairingCode, targetOrigin, r\)/);
assert.match(pairing, /_clearPairRequestCache\(pairingCode, targetOrigin\)/);

console.log('[test-mobile-gateway-manual-pairing-contract] passed: manual additions remain single-origin and pairing request caches are target-scoped');
