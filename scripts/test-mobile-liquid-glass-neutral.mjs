import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');
for (const variable of [
  '--pm-lg-header-saturate',
  '--pm-lg-pill-saturate',
  '--pm-lg-panel-saturate',
  '--pm-lg-lens-saturate',
  '--pm-lg-rim-saturate',
]) {
  assert.match(css, new RegExp(`${escapeRegex(variable)}:\\s*1\\s*;`), `${variable} must pass theme color through naturally`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(selector) {
  const pattern = new RegExp(`^${escapeRegex(selector)} \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}`, 'm');
  const body = css.match(pattern)?.[1] || '';
  assert.ok(body, `missing liquid-glass rule: ${selector}`);
  return body;
}

function background(selector) {
  const pattern = new RegExp(`^${escapeRegex(selector)} \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}`, 'gm');
  const bodies = [...css.matchAll(pattern)].map((match) => match[1]);
  assert.ok(bodies.length, `missing liquid-glass rule: ${selector}`);
  const value = bodies
    .map((body) => body.match(/(?:^|\r?\n)\s*background:\s*([\s\S]*?);/)?.[1] || '')
    .find(Boolean) || '';
  assert.ok(value, `missing liquid-glass background: ${selector}`);
  return value;
}

const neutralGlassSelectors = [
  '.pm-header .pm-icon-btn',
  ':root[data-theme="dark"] .pm-header .pm-icon-btn',
  '.pm-header .pm-online',
  ':root[data-theme="dark"] .pm-header .pm-online',
  '.pm-header-action-cluster',
  ':root[data-theme="dark"] .pm-header-action-cluster',
  '.pm-msheet',
  ':root[data-theme="dark"] .pm-msheet',
  '.pm-tabbar',
  ':root[data-theme="dark"] .pm-tabbar',
  '.pm-composer',
  ':root[data-theme="dark"] .pm-composer',
  '.pm-speak-confirm',
  ':root[data-theme="dark"] .pm-speak-confirm',
  '.pm-msg-lp-popover',
  ':root[data-theme="dark"] .pm-msg-lp-popover',
  '.pm-mobile-goal-pill',
  '.pm-chat-connection-status',
  '.pm-mobile-queued-prompts',
  '.pm-mobile-queued-popover',
  '.pm-composer .pm-skill-trigger-pill',
  '.pm-attach-sheet-panel',
  '.pm-browse-section',
  '.pm-creative-composer',
  '.pm-chat-settings-popover',
];

for (const selector of neutralGlassSelectors) {
  const material = background(selector);
  assert.doesNotMatch(material, /var\(--pm-(?:orange|accent)/, `${selector} still contains a theme tint`);
  assert.doesNotMatch(material, /var\(--pm-surface(?:-strong)?\)/, `${selector} still paints a theme-colored surface into the glass`);
  assert.doesNotMatch(material, /255\s*,\s*(?:247|250)\s*,\s*(?:235|241)/, `${selector} still contains a warm tint`);
  assert.doesNotMatch(material, /linear-gradient\(\s*135deg/i, `${selector} still has left-to-right directional shading`);
}

// Theme color remains an intentional control accent, not part of the glass.
assert.match(background('.pm-reasoning-fill'), /var\(--pm-orange\)/);

console.log('mobile liquid-glass surfaces are neutral; intentional theme accents remain');
