import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const desktop = read('web-ui/index.html');
const themes = read('web-ui/src/styles/themes.css');
const generatedThemes = read('generated/public-web-ui/static/styles/themes.css');

if (themes !== generatedThemes) throw new Error('desktop theme source/generated copies are out of sync');

const extractFunction = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end < 0 ? source.length : end);
};

const main = extractFunction(desktop, 'function _renderDesktopSwitcherMain(', 'function _renderDesktopSwitcherQuick(');
const models = extractFunction(desktop, 'async function _renderDesktopSwitcherModels(', 'function _renderDesktopSwitcherEffort(');
const effort = extractFunction(desktop, 'function _renderDesktopSwitcherEffort(', 'function _renderDesktopSwitcherSpeed(');
const speed = extractFunction(desktop, 'function _renderDesktopSwitcherSpeed(', 'async function toggleModelSwitcher(');

if (!/data-switcher-view="speed"/.test(main) || !/speedCapable/.test(main)) {
  throw new Error('desktop model settings must expose Speed only for fast-capable models');
}
if (!/data-switcher-view="effort"/.test(main) || !/data-switcher-view="models"/.test(main)) {
  throw new Error('desktop model settings must keep Model and Effort as distinct controls');
}
if (!/Standard/.test(speed) || !/Fast/.test(speed) || !/data-switcher-speed/.test(speed)) {
  throw new Error('desktop Speed detail must provide Standard and Fast choices');
}
if (!/setActiveChatModelRoute\([^)]*speed/.test(speed)) {
  throw new Error('desktop Speed choices must persist the selected route speed');
}
if (/data-switcher-speed|_renderDesktopSwitcherSpeed/.test(effort)) {
  throw new Error('selecting reasoning effort must not open or mutate the Speed selector');
}
if (!/setActiveChatModelRoute\([^)]*speed: provider === state\.provider \? state\.speed : undefined/.test(models)) {
  throw new Error('model changes must preserve speed only within the same provider');
}
if (!/background:\s*transparent !important/.test(themes)
  || !/\.nav-group > \.nav-item, \.nav-more-wrap > \.nav-item, \.more-popover-item\)\.active:not\(:hover\):not\(:focus-visible\)/.test(themes)) {
  throw new Error('desktop current-page navigation highlight must be visually neutral');
}
if (!/\.sidebar:not\(\.pages-collapsed\) \.sidebar-pages-toggle::before/.test(themes)
  || !/opacity:\s*0 !important/.test(themes)) {
  throw new Error('expanded Pages divider must be hidden without removing its collapse control');
}

console.log('desktop model selector contract: independent Standard/Fast speed, separate Effort flow, neutral current-page nav, and hidden expanded Pages divider ok');
