import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const api = read('web-ui/src/mobile/mobile-api.js');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const ws = read('web-ui/src/ws.js');
const index = read('web-ui/index.html');
const router = read('src/gateway/routes/chat.router.ts');

assert.match(api, /const _sessionRequests = new Map\(\)/, 'session hydration requests must be coalesced');
assert.match(api, /fullProcess=1&_fresh=1/, 'forced recovery hydration must request complete process entries');
assert.match(router, /const fullProcess = full \|\| req\.query\.fullProcess/, 'session API must support full process recovery');
assert.match(router, /processEntries: checkpointProcessEntries/, 'active runtime status must expose its durable tool checkpoint');

assert.match(pages, /let mobileRecoveryInFlight = null/, 'mobile recovery must be single-flight');
assert.match(pages, /if \(!initialSessionLoadPending\)/, 'cold hydration and recovery must not start as competing loads');
assert.match(pages, /let shouldResetForReplay = fullRefresh\s*\|\| isColdReopen/, 'foreground/full recovery must replay from the beginning');
assert.match(pages, /addEventListener\('pageshow', runRecoveryOnReturn\)/, 'bfcache/app resume must trigger recovery');
assert.match(pages, /_saveMobileThreadCache\(requestedSession, _activeMobileThread\(\)\)/, 'recovered live trace must survive a hard reload');
assert.match(pages, /\.filter\(_isMobileMessageCacheable\)/, 'in-progress trace messages must be cacheable');
assert.doesNotMatch(
  pages,
  /activeSessionId \|\| ''\) === sid \|\| location\.hash\.startsWith\('#mobile\/chat'\)/,
  'background delivery notifications must not select their source session',
);
assert.match(
  pages,
  /sid === requestedSession && sid === activeSid/,
  'voice and tool updates must render only for the still-active session',
);
assert.doesNotMatch(
  pages,
  /if \(detail\?\.force === true\) \{[\s\S]{0,240}activeSessionId = sid/,
  'forced background renders must not change the selected chat',
);

assert.match(ws, /pm_reload_pending_until/, 'explicit reload must coordinate with service-worker takeover');
assert.match(index, /pendingUntil > Date\.now\(\)/, 'controllerchange must suppress a duplicate pending reload');

console.log('[mobile-chat-recovery] recovery/replay/reload contract passed');
