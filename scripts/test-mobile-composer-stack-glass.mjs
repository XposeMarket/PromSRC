import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const css = read('web-ui/src/styles/mobile-composer-stack.css');
const generatedCss = read('generated/public-web-ui/static/styles/mobile-composer-stack.css');
const data = read('web-ui/src/mobile/mobile-data.js');
const generatedData = read('generated/public-web-ui/static/mobile/mobile-data.js');

assert.equal(generatedCss, css, 'generated composer-stack CSS must mirror source exactly');
assert.equal(generatedData, data, 'generated mobile-data loader must mirror source exactly');
assert.match(data, /new URL\(`\.\.\/styles\/mobile-composer-stack\.css\?v=\$\{PM_COMPOSER_STACK_STYLE_VERSION\}`,[\s\S]*?import\.meta\.url\)/, 'mobile boot must load composer-stack CSS relative to the active source/generated module');
assert.match(data, /ensureMobileComposerStackStyles\(\);/, 'composer-stack CSS loader must run during mobile shell bootstrap');

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

console.log('[test-mobile-composer-stack-glass] passed: modern liquid glass and composer-locked runtime stack');
