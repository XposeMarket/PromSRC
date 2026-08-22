import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourceUi = fs.readFileSync('web-ui/src/computer-use-live-view.js', 'utf8');
const generatedUi = fs.readFileSync('generated/public-web-ui/static/computer-use-live-view.js', 'utf8');
const sourcePerf = fs.readFileSync('web-ui/src/performance.js', 'utf8');
const generatedPerf = fs.readFileSync('generated/public-web-ui/static/performance.js', 'utf8');
const route = fs.readFileSync('src/gateway/routes/connections-v2.router.ts', 'utf8');
const stateTracker = fs.readFileSync('src/gateway/computer-use-view-state.ts', 'utf8');

assert.equal(sourceUi, generatedUi, 'Watch Prometheus source/generated UI must stay byte-identical');
assert.equal(sourcePerf, generatedPerf, 'performance bootstrap source/generated mirrors must stay byte-identical');
assert.match(sourcePerf, /import '\.\/computer-use-live-view\.js';/);

assert.match(sourceUi, /Watch Prometheus/);
assert.match(sourceUi, /MutationObserver/);
assert.match(sourceUi, /\.tool-activity-entry/);
assert.match(sourceUi, /state\.isThinking/);
assert.match(sourceUi, /state\.streamingSessionId/);
assert.match(sourceUi, /api\/computer-use\/frame/);
assert.match(sourceUi, /data-cu-source=\"browser\"/);
assert.match(sourceUi, /data-cu-source=\"desktop\"/);
assert.match(sourceUi, /source-panel-tabs/);
assert.match(sourceUi, /X-Pairing-Token/);
assert.match(sourceUi, /__pmMobileActiveGatewayOrigin/);
assert.match(sourceUi, /__PROM_COMPUTER_USE_VIEW/);

assert.match(route, /router\.get\('\/api\/computer-use\/frame\/:sessionId'/);
assert.match(route, /browserVisionScreenshot\(sessionId\)/);
assert.match(route, /desktopScreenshot\(sessionId, \{ skipOcr: true \}\)/);
assert.match(route, /getDesktopAdvisorPacket\(sessionId\)/);
assert.match(route, /Cache-Control/);

assert.match(stateTracker, /class ComputerUseViewTracker/);
assert.match(stateTracker, /classifyComputerUseTool/);
assert.match(stateTracker, /desktopMode: ComputerUseDesktopMode/);
assert.match(stateTracker, /hostControl/);
assert.match(stateTracker, /cursor/);
assert.match(stateTracker, /desktop_background/);

console.log('[computer-use-live-view] viewer lifecycle, authenticated frame route, source/generated parity, and state contract passed');
