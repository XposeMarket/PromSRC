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
const gatewayServer = read('src/gateway/core/server.ts');
const broadcaster = read('src/gateway/comms/broadcaster.ts');
const auditMaterializer = read('src/gateway/audit/materializer.ts');

assert.match(api, /const _sessionRequests = new Map\(\)/, 'session hydration requests must be coalesced');
assert.match(api, /fullProcess=1&_fresh=1/, 'forced recovery hydration must request complete process entries');
assert.match(router, /const fullProcess = full \|\| req\.query\.fullProcess/, 'session API must support full process recovery');
assert.match(router, /processEntries: checkpointProcessEntries/, 'active runtime status must expose its durable tool checkpoint');

assert.match(pages, /let mobileRecoveryInFlight = null/, 'mobile recovery must be single-flight');
assert.match(pages, /aiTurn\._pmFinalReceived = true/, 'a displayed final response must become a monotonic recovery boundary');
assert.match(
  pages,
  /if \(targetAiTurn\?\._pmFinalReceived && _mobileAssistantHasVisibleAnswer\(targetAiTurn\)\)/,
  'a late disconnect callback must not replace an already-received final response',
);
assert.match(
  pages,
  /if \(aiTurn\?\._pmFinalReceived && _mobileAssistantHasVisibleAnswer\(aiTurn\)\)/,
  'foreground recovery must preserve and finalize an already-received response',
);
assert.doesNotMatch(
  pages,
  /run\?\.busy \|\| run\?\.lastSeq > 0/,
  'hiding the app must not resurrect a completed run solely because it has an old stream sequence',
);
assert.match(
  api,
  /if \(!gotFinal\) cb\('onError', toChatStreamError\(err\)\)/,
  'SSE teardown after a final frame must not be reported as a disconnect',
);
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
assert.match(gatewayServer, /type: 'gateway_heartbeat'/, 'gateway must send application-level WebSocket heartbeats');
assert.match(ws, /_WS_STALE_AFTER_MS/, 'client must track an inbound-silence threshold');
assert.match(ws, /type: 'ws:stale'/, 'client must report and replace an OPEN-but-silent WebSocket');
assert.match(ws, /connectWS\(\{ force: true, timeoutMs: 6000, reconnectDelayMs: 0 \}\)/, 'stale sockets must reconnect immediately');
assert.match(broadcaster, /gateway-event-loop-stalls\.ndjson/, 'gateway must retain event-loop stall diagnostics');
assert.match(auditMaterializer, /new Worker\(__filename/, 'audit materialization must run outside the gateway event loop');
assert.match(auditMaterializer, /prometheus_audit_materializer/, 'audit worker must have an explicit worker entrypoint');

console.log('[mobile-chat-recovery] recovery/replay/reload contract passed');
