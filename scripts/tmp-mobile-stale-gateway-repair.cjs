const fs = require('fs');

function replaceExact(file, from, to) {
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.includes(from)) throw new Error(`Expected patch anchor missing in ${file}`);
  const next = raw.replace(from, to);
  if (next === raw) throw new Error(`Patch made no change in ${file}`);
  fs.writeFileSync(file, next);
}

for (const file of [
  'web-ui/src/mobile/mobile-gateway-catalog.js',
  'generated/public-web-ui/static/mobile/mobile-gateway-catalog.js',
]) {
  replaceExact(
    file,
    "const SESSION_TARGETS_KEY = 'pm_mobile_session_targets_v1';\nconst PENDING_GATEWAY_PAIR_KEY = 'pm_mobile_pending_gateway_pair_v1';",
    "const SESSION_TARGETS_KEY = 'pm_mobile_session_targets_v1';\nconst GATEWAY_ALIASES_KEY = 'pm_mobile_gateway_aliases_v1';\nconst PENDING_GATEWAY_PAIR_KEY = 'pm_mobile_pending_gateway_pair_v1';",
  );

  replaceExact(
    file,
    `export function getGateway(gatewayId) {\n  return loadGatewayCatalog().find((entry) => entry.gatewayId === String(gatewayId || '').trim()) || null;\n}`,
    `function _readGatewayAliases() {\n  const raw = _readJson(GATEWAY_ALIASES_KEY, {});\n  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};\n}\n\nfunction _writeGatewayAliases(aliases) {\n  const rows = Object.entries(aliases && typeof aliases === 'object' ? aliases : {})\n    .map(([fromGatewayId, value]) => {\n      const from = String(fromGatewayId || '').trim();\n      const to = String(value?.gatewayId || value || '').trim();\n      const origin = normalizeGatewayOrigin(value?.origin || '');\n      const updatedAt = Number(value?.updatedAt || Date.now()) || Date.now();\n      return from && to && from !== to ? [from, { gatewayId: to, origin, updatedAt }] : null;\n    })\n    .filter(Boolean)\n    .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))\n    .slice(0, 64);\n  return _writeJson(GATEWAY_ALIASES_KEY, Object.fromEntries(rows));\n}\n\nfunction _recordGatewayAliases(oldIds, nextGateway) {\n  if (!(oldIds instanceof Set) || !oldIds.size || !nextGateway?.gatewayId) return;\n  const nextId = String(nextGateway.gatewayId || '').trim();\n  const nextOrigin = normalizeGatewayOrigin(nextGateway.origin);\n  const aliases = _readGatewayAliases();\n  for (const [aliasId, value] of Object.entries(aliases)) {\n    const targetId = String(value?.gatewayId || value || '').trim();\n    if (oldIds.has(targetId)) aliases[aliasId] = { gatewayId: nextId, origin: nextOrigin, updatedAt: Date.now() };\n  }\n  for (const oldId of oldIds) aliases[String(oldId)] = { gatewayId: nextId, origin: nextOrigin, updatedAt: Date.now() };\n  _writeGatewayAliases(aliases);\n}\n\nfunction _removeGatewayAliases(gatewayId) {\n  const id = String(gatewayId || '').trim();\n  if (!id) return;\n  const aliases = _readGatewayAliases();\n  let changed = false;\n  for (const [aliasId, value] of Object.entries(aliases)) {\n    const targetId = String(value?.gatewayId || value || '').trim();\n    if (aliasId === id || targetId === id) {\n      delete aliases[aliasId];\n      changed = true;\n    }\n  }\n  if (changed) _writeGatewayAliases(aliases);\n}\n\nexport function getGateway(gatewayId) {\n  const requestedId = String(gatewayId || '').trim();\n  if (!requestedId) return null;\n  const entries = loadGatewayCatalog();\n  const direct = entries.find((entry) => entry.gatewayId === requestedId) || null;\n  if (direct) return direct;\n\n  // A gateway can legitimately receive a replacement identity while the same\n  // phone still has an already-open route such as old-id::session-id. Identity\n  // migration already treats same-origin replacements as the same computer;\n  // retain a bounded alias so those stale routes resolve to that exact migrated\n  // gateway instead of being mistaken for an outage. Never fall back to an\n  // unrelated active gateway.\n  const aliases = _readGatewayAliases();\n  let currentId = requestedId;\n  const seen = new Set([currentId]);\n  for (let hop = 0; hop < 8; hop += 1) {\n    const alias = aliases[currentId];\n    const nextId = String(alias?.gatewayId || alias || '').trim();\n    if (!nextId || seen.has(nextId)) return null;\n    seen.add(nextId);\n    const resolved = entries.find((entry) => entry.gatewayId === nextId) || null;\n    if (resolved) {\n      const aliasOrigin = normalizeGatewayOrigin(alias?.origin || '');\n      if (aliasOrigin && normalizeGatewayOrigin(resolved.origin) !== aliasOrigin) return null;\n      return resolved;\n    }\n    currentId = nextId;\n  }\n  return null;\n}`,
  );

  replaceExact(
    file,
    `function _migrateGatewayReferences(oldIds, nextGateway) {\n  if (!(oldIds instanceof Set) || !oldIds.size || !nextGateway?.gatewayId) return;\n  const nextId = String(nextGateway.gatewayId);\n  const nextOrigin = normalizeGatewayOrigin(nextGateway.origin);`,
    `function _migrateGatewayReferences(oldIds, nextGateway) {\n  if (!(oldIds instanceof Set) || !oldIds.size || !nextGateway?.gatewayId) return;\n  const nextId = String(nextGateway.gatewayId);\n  const nextOrigin = normalizeGatewayOrigin(nextGateway.origin);\n  _recordGatewayAliases(oldIds, nextGateway);`,
  );

  replaceExact(
    file,
    `  saveGatewayCatalog(next);\n  setGatewayToken(id, '');\n  if (String(_readJson(ACTIVE_KEY, '') || '') === id) _remove(ACTIVE_KEY);`,
    `  saveGatewayCatalog(next);\n  setGatewayToken(id, '');\n  _removeGatewayAliases(id);\n  if (String(_readJson(ACTIVE_KEY, '') || '') === id) _remove(ACTIVE_KEY);`,
  );

  replaceExact(
    file,
    `export function bindMobileSessionTarget(sessionId, gatewayId, { path = '', started = false, project = '', workspace = '' } = {}) {\n  const sid = String(sessionId || '').trim();\n  const gid = String(gatewayId || '').trim();\n  if (!sid || !gid || sid === 'mobile_default') return false;\n  const all = _readJson(SESSION_TARGETS_KEY, {});\n  const existing = all[sid];\n  if (existing?.gatewayId && existing.gatewayId !== gid) return false;\n  const gateway = getGateway(gid);`,
    `export function bindMobileSessionTarget(sessionId, gatewayId, { path = '', started = false, project = '', workspace = '', authoritative = false } = {}) {\n  const sid = String(sessionId || '').trim();\n  const gid = String(gatewayId || '').trim();\n  if (!sid || !gid || sid === 'mobile_default') return false;\n  const all = _readJson(SESSION_TARGETS_KEY, {});\n  const existing = all[sid];\n  const gateway = getGateway(gid);\n  if (!gateway) return false;\n  // Normal bindings stay immutable. The one exception is an authenticated,\n  // target-namespaced session row that the router just loaded directly from a\n  // gateway. That row is authoritative evidence of which computer owns this\n  // session and is allowed to repair stale persisted identity.\n  if (existing?.gatewayId && existing.gatewayId !== gateway.gatewayId && !authoritative) return false;\n  const resolvedGatewayId = String(gateway.gatewayId || gid);`,
  );

  replaceExact(
    file,
    `    gatewayId: gid,\n    // Keep the origin alongside the immutable id so a refreshed catalog can\n    // recover an already-open chat even when the gateway id was regenerated.\n    origin: normalizeGatewayOrigin(gateway?.origin || existing?.origin || ''),`,
    `    gatewayId: resolvedGatewayId,\n    // Keep the origin alongside the target so a refreshed catalog can recover\n    // an already-open chat even when the gateway id was regenerated.\n    origin: normalizeGatewayOrigin(gateway.origin || existing?.origin || ''),`,
  );

  replaceExact(
    file,
    `  _emitCatalogChanged({ type: 'session_target_bound', sessionId: sid, gatewayId: gid });`,
    `  _emitCatalogChanged({ type: 'session_target_bound', sessionId: sid, gatewayId: resolvedGatewayId });`,
  );
}

for (const file of [
  'web-ui/src/mobile/mobile-router.js',
  'generated/public-web-ui/static/mobile/mobile-router.js',
]) {
  replaceExact(
    file,
    `  getPendingGatewayPair,\n} from './mobile-gateway-catalog.js';`,
    `  getPendingGatewayPair,\n  targetNamespacedId,\n  getGateway,\n  onGatewayCatalogChanged,\n} from './mobile-gateway-catalog.js';`,
  );

  replaceExact(
    file,
    `      if (parsedTarget?.gatewayId) bindMobileSessionTarget(openSessionId, parsedTarget.gatewayId, { started: true });`,
    `      if (parsedTarget?.gatewayId) {\n        // This namespaced row came from the selected gateway's authenticated\n        // session list. It is authoritative and may repair a stale binding left\n        // behind by a gateway identity/origin refresh.\n        bindMobileSessionTarget(openSessionId, parsedTarget.gatewayId, { started: true, authoritative: true });\n      }`,
  );

  replaceExact(
    file,
    `  let { page, arg, extra } = mobileRouteFromLocation();\n  const pairCode = _pairCodeFromUrl();`,
    `  let { page, arg, extra } = mobileRouteFromLocation();\n\n  // Canonicalize an already-open namespaced chat when its gateway identity was\n  // replaced while the PWA was suspended. getGateway() resolves only explicit\n  // same-computer identity aliases; it never falls back to the currently active\n  // gateway, so this repair cannot move a chat between unrelated computers.\n  if (page === 'chat' && arg) {\n    try {\n      const decodedArg = decodeURIComponent(arg);\n      const parsedRouteTarget = parseTargetNamespacedId(decodedArg);\n      if (parsedRouteTarget) {\n        const canonicalGateway = getGateway(parsedRouteTarget.gatewayId);\n        if (canonicalGateway?.gatewayId && canonicalGateway.gatewayId !== parsedRouteTarget.gatewayId) {\n          const repairedTarget = targetNamespacedId(canonicalGateway.gatewayId, parsedRouteTarget.targetId);\n          const repairedHash = '#mobile/chat/' + encodeURIComponent(repairedTarget);\n          history.replaceState(null, '', (window.location.pathname || '/') + (window.location.search || '') + repairedHash);\n          arg = encodeURIComponent(repairedTarget);\n        }\n      }\n    } catch {}\n  }\n\n  const pairCode = _pairCodeFromUrl();`,
  );

  replaceExact(
    file,
    `window.addEventListener('hashchange', safeRender);\nwindow.addEventListener('popstate', safeRender);`,
    `// If the catalog replaces a gateway identity while a chat is already on\n// screen, repaint immediately so a stale red gateway banner does not remain\n// latched until the user leaves the thread.\nonGatewayCatalogChanged((detail) => {\n  if (detail?.type !== 'gateway_identity_migrated') return;\n  const route = mobileRouteFromLocation();\n  if (route.page === 'chat' || route.page === 'voice') safeRender();\n});\n\nwindow.addEventListener('hashchange', safeRender);\nwindow.addEventListener('popstate', safeRender);`,
  );
}

const testFile = 'scripts/test-mobile-gateway-contract.mjs';
let test = fs.readFileSync(testFile, 'utf8');
test = test.replace(
  `  assert.match(catalog, /targetNamespacedId/);`,
  `  assert.match(catalog, /targetNamespacedId/);\n  assert.match(catalog, /pm_mobile_gateway_aliases_v1/, 'gateway identity replacements must retain a bounded stale-route alias');\n  assert.match(catalog, /authoritative = false/, 'session bindings need an explicit authoritative repair path');\n  assert.match(router, /authoritative: true/, 'authenticated namespaced session rows must repair stale persisted bindings');\n  assert.match(router, /getGateway\\(parsedRouteTarget\\.gatewayId\\)/, 'already-open routes must canonicalize migrated gateway ids');\n  assert.match(router, /gateway_identity_migrated/, 'visible chats must repaint after gateway identity migration');`,
);
test = test.replace(
  `  assert.equal(c.resolveMobileSessionGateway('session-1').gatewayId, repairedMac.gatewayId, 'bound chats recover a replacement descriptor by origin');`,
  `  assert.equal(c.resolveMobileSessionGateway('session-1').gatewayId, repairedMac.gatewayId, 'bound chats recover a replacement descriptor by origin');\n  assert.equal(c.getGateway('gw-mac').gatewayId, repairedMac.gatewayId, 'stale namespaced routes resolve only through recorded same-origin identity aliases');\n  assert.equal(c.bindMobileSessionTarget('session-1', desktop.gatewayId, { started: true }), false, 'normal bindings remain immutable after identity repair');\n  assert.equal(c.bindMobileSessionTarget('session-1', desktop.gatewayId, { started: true, authoritative: true }), true, 'authenticated namespaced session selection may repair a stale binding');\n  assert.equal(c.getMobileSessionTarget('session-1').gatewayId, desktop.gatewayId);`,
);
fs.writeFileSync(testFile, test);
