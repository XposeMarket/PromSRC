import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const index = read('web-ui/index.html');
const app = read('web-ui/src/app.js');
const themes = read('web-ui/src/styles/themes.css');
const settings = read('web-ui/src/styles/settings.css');
const generatedIndex = read('generated/public-web-ui/index.html');
const generatedApp = read('generated/public-web-ui/static/app.js');
const generatedThemes = read('generated/public-web-ui/static/styles/themes.css');
const generatedSettings = read('generated/public-web-ui/static/styles/settings.css');

assert.match(index, /id: 'gray',\s+label: 'Ash & Ember',[\s\S]*?shared P1 shell/);
assert.match(app, /gray: \[46, 46, 46\]/);
assert.match(app, /if \(activeId !== 'custom'\) return;/);
assert.match(app, /export function editAppearanceAsCustom\(\)/);
assert.match(index, /id="appearance-active-theme"/);
assert.match(index, /id="appearance-edit-custom"/);
assert.match(settings, /\.appearance-custom-panel :is\(input, select, button\):disabled/);
assert.match(themes, /SHARED PROMETHEUS ONE DESKTOP SHELL/);
assert.match(themes, /data-skin="gray"\][\s\S]*?p1-mark-ring\.png/);
assert.match(themes, /data-skin="gray"\][\s\S]*?chat-empty:not\(\.desktop-voice-mode\)/);

assert.match(generatedIndex, /id="appearance-active-theme"/);
assert.match(generatedIndex, /id="appearance-edit-custom"/);
assert.match(generatedApp, /export function editAppearanceAsCustom\(\)/);
assert.match(generatedThemes, /SHARED PROMETHEUS ONE DESKTOP SHELL/);
assert.match(generatedSettings, /\.appearance-custom-panel :is\(input, select, button\):disabled/);

console.log('PASS: desktop presets share the Prometheus One shell and generated web UI is synchronized');
