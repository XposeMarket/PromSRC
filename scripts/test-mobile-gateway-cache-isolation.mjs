import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('web-ui/src/mobile/mobile-api.js');
const generated = read('generated/public-web-ui/static/mobile/mobile-api.js');

assert.equal(source, generated, 'generated mobile API shim must match canonical source');
assert.match(source, /function _mobileGatewayCacheScope\(\)/, 'mobile caches need an explicit gateway namespace');
assert.match(source, /__pmMobileActiveGatewayId/, 'gateway cache namespace should prefer the catalog gateway id');
assert.match(source, /function _mobilePageCacheId\(key, scope = _mobileGatewayCacheScope\(\)\)/, 'page cache keys must include the selected gateway scope');
assert.match(source, /function _coalesceMobilePageRequest\(key, factory, scope = _mobileGatewayCacheScope\(\)\)/, 'in-flight page requests must be gateway-scoped');
assert.match(source, /loadMobileSchedules[\s\S]*const cacheScope = _mobileGatewayCacheScope\(\)[\s\S]*getCachedMobilePageData\('schedules', 21_600_000, cacheScope\)[\s\S]*_coalesceMobilePageRequest\('schedules',[\s\S]*cacheScope\)/, 'schedule cache/read coalescing must stay on one gateway');
assert.match(source, /let _teamsCache = \{ scope: '', at: 0, list: null \};[\s\S]*_teamsCache\.scope === cacheScope/, 'short-lived teams memory cache must include gateway identity');
assert.match(source, /loadMobileSubagents[\s\S]*const cacheScope = _mobileGatewayCacheScope\(\)[\s\S]*getCachedMobilePageData\('subagents', 21_600_000, cacheScope\)[\s\S]*_saveMobilePageData\('subagents', normalized, cacheScope\)/, 'subagent cache must be gateway-scoped');
assert.match(source, /loadBgTasks[\s\S]*const cacheScope = _mobileGatewayCacheScope\(\)[\s\S]*getCachedMobilePageData\('tasks', 8_000, cacheScope\)[\s\S]*_saveMobilePageData\('tasks', r\.tasks, cacheScope\)/, 'background-task cache must be gateway-scoped');
assert.match(source, /function _sessionCacheKey\(sid, scope = _mobileGatewayCacheScope\(\)\)/, 'chat session cache keys must include gateway identity');
assert.match(source, /loadMobileChatSession[\s\S]*const gatewayScope = _mobileGatewayCacheScope\(\)[\s\S]*requestKey = `\$\{gatewayScope\}:/, 'session in-flight request keys must include gateway identity');
assert.match(source, /_sessionCacheSet\(sid, session, gatewayScope\)/, 'a session response must be saved under the gateway scope captured when its request started');
assert.match(source, /const _mobileHistoryClients = new Map\(\)[\s\S]*loadMobileChatHistoryPage[\s\S]*const gatewayScope = _mobileGatewayCacheScope\(\)[\s\S]*_mobileHistoryClients\.get\(gatewayScope\)\.loadOlder/, 'cursor page request coalescing must not cross gateway identities');

console.log('[test-mobile-gateway-cache-isolation] passed: mobile page/session caches and in-flight requests are gateway-scoped');
