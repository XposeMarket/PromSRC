import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const routeSource = read('src', 'gateway', 'routes', 'creative-composition.routes.ts');
const appSource = read('src', 'gateway', 'core', 'app.ts');
const bridgeSource = read('web-ui', 'src', 'components', 'creative', 'compositionBridge.js');
const publicBridgeSource = read('generated', 'public-web-ui', 'static', 'components', 'creative', 'compositionBridge.js');
const runtimeSource = read('web-ui', 'src', 'components', 'creative', 'featureRuntime.js');
const timelineSource = read('web-ui', 'src', 'components', 'creative', 'editor', 'timeline', 'editor.js');

assert.match(routeSource, /router\.use\('\/api\/canvas\/composition', requireGatewayAuth\)/, 'composition routes must retain gateway auth');
assert.match(routeSource, /router\.get\('\/api\/canvas\/composition'/, 'composition GET route must be mounted');
assert.match(routeSource, /router\.post\('\/api\/canvas\/composition'/, 'composition mutation route must be mounted');
assert.match(routeSource, /router\.post\('\/api\/canvas\/composition\/lint'/, 'composition lint route must be mounted');
assert.match(routeSource, /router\.post\('\/api\/canvas\/composition\/render'/, 'composition render route must be mounted');
assert.match(routeSource, /renderComposition\(/, 'composition render route must call the real renderer');
assert.match(appSource, /registerCreativeCompositionRoutes\(app\)/, 'gateway app must register composition routes');

assert.equal(publicBridgeSource, bridgeSource, 'public Creative composition bridge must stay byte-for-byte synced');
assert.match(runtimeSource, /window\.prometheusCreativeCompositionBridge = createCreativeCompositionBridge\(\)/, 'Creative runtime must install the composition bridge');
assert.match(bridgeSource, /splitAtPlayhead/, 'bridge must expose playhead split');
assert.match(bridgeSource, /deleteSelected/, 'bridge must expose composition delete');
assert.match(bridgeSource, /saveSequence/, 'bridge must expose composition save');
assert.match(bridgeSource, /timeoutMs: 720000/, 'long renders must not inherit the normal 10s API timeout');

assert.match(timelineSource, /b\?\.openSequence\?\.\(\)/, 'timeline Open sequence control must call the bridge');
assert.match(timelineSource, /b\?\.saveSequence\?\.\(\)/, 'timeline Save control must call the bridge');
assert.match(timelineSource, /b\?\.render\?\.\(\)/, 'timeline Render control must call the bridge');
assert.match(timelineSource, /b\?\.splitAtPlayhead\?\.\(\)/, 'timeline Split control must call the bridge');
assert.match(timelineSource, /b\?\.deleteSelected\?\.\(\)/, 'timeline Delete control must call the bridge');
assert.match(timelineSource, /bridge\(\)\?\.selectClip\?\./, 'composition clip selection must route through the bridge');

console.log('[test-creative-video-composition-contract] passed: video timeline is wired to authenticated persistent composition APIs');
