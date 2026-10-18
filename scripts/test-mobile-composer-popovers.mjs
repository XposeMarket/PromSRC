import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('web-ui/src/mobile/mobile-reasoning-sheet-geometry.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source.replace('export function', 'function') + '\nthis.place = reasoningSheetViewportPlacement;', context);
for (const width of [390, 430]) {
  for (const height of [844, 450]) {
    for (const offsetTop of [0, 84]) {
      const trigger = { top: offsetTop + height - 80, bottom: offsetTop + height - 48 };
      const placement = context.place({ visualViewport: { width, height, offsetTop }, layoutHeight: 844, triggerRect: trigger, preferredHeight: 176 });
      assert.equal(placement.top + placement.height, trigger.top - 8, 'panel must end eight pixels above its trigger');
      assert.ok(placement.top >= offsetTop + 10);
      const resized = context.place({ visualViewport: { width, height, offsetTop }, layoutHeight: 450, triggerRect: trigger, preferredHeight: 176 });
      assert.equal(resized.top, placement.top, 'layout height must not shift a fixed top anchor');
    }
  }
}
const runtime = fs.readFileSync('web-ui/src/mobile/mobile-chat-page-runtime.js', 'utf8');
assert.match(runtime, /document\.body\.append\(attachSheet\)/);
assert.match(runtime, /const lowerOrbitY = -64;/);
assert.doesNotMatch(runtime, /aboveComposer \+ 18/);
assert.match(runtime, /scrim\.remove\(\);/);
const css = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');
assert.match(css, /body\.pm-mobile-active > #pm-attach-sheet \{ z-index: 10101 !important; \}/);
assert.match(css, /\.pm-composer-popover-scrim \{[^}]*z-index: 10100;[^}]*backdrop-filter: blur\(9px\)/);
console.log('PASS mobile composer popover geometry / body portals / scrim layering');
