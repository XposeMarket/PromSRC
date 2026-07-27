import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');

const badgeRule = css.match(/^\.pm-header \.pm-online \{\r?\n([\s\S]*?)\r?\n\}/m)?.[1] || '';
const actionClusterRule = css.match(/^\.pm-header-action-cluster \{\r?\n([\s\S]*?)\r?\n\}/m)?.[1] || '';
for (const token of [
  'var(--pm-lg-header-blur, 6px)',
  'var(--pm-lg-header-saturate, 1.7)',
  'var(--pm-lg-header-brightness, 1.04)',
  'var(--pm-lg-header-border-alpha, .18)',
  'inset 0 1.5px 1px rgba(255,255,255,.34)',
  'inset 0 -1.5px 2px rgba(255,255,255,.13)',
]) {
  assert.ok(badgeRule.includes(token), `model badge is missing action-button glass token: ${token}`);
  assert.ok(actionClusterRule.includes(token), `action cluster is missing shared glass token: ${token}`);
}

const fillRule = css.match(/^\.pm-reasoning-fill \{\r?\n([\s\S]*?)\r?\n\}/m)?.[1] || '';
assert.match(fillRule, /var\(--pm-orange\)/, 'reasoning fill must use the active mobile theme accent');
assert.doesNotMatch(fillRule, /#ffffff 0%, #f7f7f7/, 'reasoning fill must not stay hard-coded white');

const knobRule = css.match(/^\.pm-reasoning-fill::after \{\r?\n([\s\S]*?)\r?\n\}/m)?.[1] || '';
assert.match(knobRule, /#fff/, 'reasoning slider knob should remain high-contrast white');

console.log('mobile model-selector glass and theme-slider regression checks passed');
