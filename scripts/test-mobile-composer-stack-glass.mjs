import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const css = read('web-ui/src/styles/mobile-composer-stack.css');
const generatedCss = read('generated/public-web-ui/static/styles/mobile-composer-stack.css');
const mobileCss = read('web-ui/src/styles/mobile.css');
const generatedMobileCss = read('generated/public-web-ui/static/styles/mobile.css');
const data = read('web-ui/src/mobile/mobile-data.js');
const generatedData = read('generated/public-web-ui/static/mobile/mobile-data.js');
const dataBase = read('web-ui/src/mobile/mobile-data-base.js');
const generatedDataBase = read('generated/public-web-ui/static/mobile/mobile-data-base.js');
const owners = read('web-ui/src/mobile/mobile-style-owners.js');
const generatedOwners = read('generated/public-web-ui/static/mobile/mobile-style-owners.js');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const generatedPages = read('generated/public-web-ui/static/mobile/mobile-pages.js');

assert.equal(generatedCss, css, 'generated composer-stack CSS must mirror source exactly');
assert.equal(generatedData, data, 'generated mobile-data loader must mirror source exactly');
assert.equal(generatedDataBase, dataBase, 'generated mobile-data base must mirror source exactly');
assert.equal(generatedOwners, owners, 'generated mobile style-owner registry must mirror source exactly');
assert.doesNotMatch(dataBase, /stylesheet|mobile-composer-stack|mobile-liquid-glass/, 'data base must stay free of route stylesheet installation');
assert.match(owners, /chat:\s*Object\.freeze\(\[[\s\S]*?mobile-composer-stack\.css/, 'chat must own the composer-stack stylesheet');
assert.match(owners, /ensureMobileChatStyles\(\)/, 'chat route must expose an explicit stylesheet owner entry point');
assert.match(pages, /import \{ ensureMobileChatStyles \} from '\.\/mobile-style-owners\.js';/, 'chat renderer must import its stylesheet owner');
assert.match(pages, /ensureMobileChatStyles\(\);/, 'chat renderer must activate its stylesheet owner');

for (const token of [
  '--pm-composer-stack-gap',
  '--pm-composer-stack-inset',
  '--pm-composer-stack-base-bottom',
]) {
  assert.ok(css.includes(token), `missing shared composer-stack token ${token}`);
}

for (const selector of [
  '.pm-mobile-goal-pill',
  '.pm-mobile-queued-prompts',
  '.pm-mobile-queued-menu-trigger',
  '.pm-mobile-queued-popover',
  '.pm-tool-progress-pill',
  '.pm-main-plan-pill',
  '.pm-main-plan-popover',
  '.pm-background-spawn-pill',
  '.pm-background-spawn-lane',
  '.pm-mobile-side-sheet.background-agent-detail-mode .pm-mobile-side-panel',
  '.pm-background-spawn-close',
  '.pm-chat-connection-status',
  '.pm-scroll-latest',
]) {
  assert.ok(css.includes(selector), `composer-stack stylesheet must cover ${selector}`);
}

assert.match(css, /blur\(var\(--pm-lg-panel-blur/, 'stack surfaces must use the baked composer panel blur token');
assert.match(css, /saturate\(var\(--pm-lg-panel-saturate/, 'stack surfaces must use the baked composer saturation token');
assert.match(css, /brightness\(var\(--pm-lg-panel-brightness/, 'stack surfaces must use the baked composer brightness token');
assert.doesNotMatch(css, /blur\((?:16|18|20)px\)/, 'old thick-blur liquid glass must not be reintroduced in the stack stylesheet');
assert.doesNotMatch(css, /linear-gradient\(135deg/, 'stack glass must stay neutral instead of using old directional shading');

assert.match(
  css,
  /\.pm-mobile-queued-prompts\s*\{[\s\S]*?left:\s*var\(--pm-composer-stack-inset\);[\s\S]*?right:\s*var\(--pm-composer-stack-inset\);[\s\S]*?width:\s*auto;[\s\S]*?bottom:\s*calc\(var\(--pm-composer-stack-base-bottom\) \+ var\(--pm-goal-live-height, 0px\)\);/,
  'queued messages must share the composer horizontal inset and stack directly above it',
);
assert.match(
  css,
  /\.pm-tool-progress-dock\s*\{[\s\S]*?--pm-composer-stack-base-bottom[\s\S]*?--pm-queued-live-height/,
  'tool progress must stack from the same composer base above queue/goal heights',
);
assert.match(
  css,
  /:is\(\.pm-main-plan-dock, \.pm-background-spawn-dock\)[\s\S]*?--pm-composer-stack-base-bottom[\s\S]*?--pm-tool-progress-live-height/,
  'plan/background docks must use the shared stack base and preceding live heights',
);
assert.match(
  css,
  /\.pm-page\.pm-chat-status-priority-active \.pm-chat-connection-status\s*\{\s*bottom:\s*var\(--pm-composer-stack-base-bottom\);/,
  'priority reconnect/recovery status must ignore stale hidden-stack heights and pin directly above the composer',
);
assert.match(css, /\[class\*="recovery"\]\[class\*="toast"\]/, 'dedicated recovery toast variants must be composer anchored');
assert.match(css, /\[class\*="reconnect"\]\[class\*="toast"\]/, 'dedicated reconnect toast variants must be composer anchored');
assert.match(css, /body\.pm-mobile-active\.pm-keyboard-open[\s\S]*?--pm-composer-stack-base-bottom/, 'keyboard-open mode must redefine the shared base instead of detaching individual overlays');

assert.match(
  mobileCss,
  /\.pm-background-spawn-dock\.has-many\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/,
  'many-agent mobile docks must stack vertically inside a readable scroll region',
);
assert.match(
  mobileCss,
  /\.pm-background-spawn-dock\.has-many \.pm-background-spawn-lane\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
  'many-agent lanes must use the available mobile width instead of fixed horizontal cards',
);
for (const generatedRule of [
  /\.pm-background-spawn-dock\.has-many\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/,
  /\.pm-background-spawn-dock\.has-many \.pm-background-spawn-lane\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
]) {
  assert.match(generatedMobileCss, generatedRule, 'generated mobile CSS must carry the background-dock mobile geometry');
}
assert.match(
  css,
  /body\.pm-mobile-active \.pm-background-spawn-dock\.is-open\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?left:\s*var\(--pm-composer-stack-inset\);[\s\S]*?right:\s*var\(--pm-composer-stack-inset\);[\s\S]*?bottom:\s*var\(--pm-composer-stack-base-bottom\);[\s\S]*?margin:\s*0;[\s\S]*?transform:\s*none;/,
  'expanded background docks must remain fixed to the composer anchor',
);
assert.match(
  pages,
  /const overlayDockHeight = dockHeight;/,
  'chat geometry must reserve the fixed expanded background dock height',
);
assert.match(
  generatedPages,
  /const overlayDockHeight = dockHeight;/,
  'generated chat geometry must keep the fixed background dock contract',
);
assert.match(
  pages,
  /function _reconcileMobileBackgroundSpawnDockMarkup\(host, markup\)[\s\S]*?reconcileKeyedTimelineRows\(host, markup/,
  'background dock updates must reconcile keyed lanes instead of replacing the expanded card shell',
);
assert.match(
  pages,
  /data-pm-row-key="background:\$\{escapeHtml\(lane\.id\)\}"/,
  'background lanes must have stable keys across live tool events',
);
assert.match(
  pages,
  /_pushMobileStreamProcessEntry\(message, 'think', text,[\s\S]*?visibility/,
  'curated background thoughts must be retained in the expandable process stream',
);
assert.match(
  css,
  /body\.pm-mobile-active \.pm-mobile-side-composer\.pm-composer[\s\S]*?justify-content:\s*center[\s\S]*?height:\s*54px/,
  'background-agent side composer must use the centered main-composer geometry',
);

console.log('[test-mobile-composer-stack-glass] passed: modern liquid glass and composer-locked runtime stack');
