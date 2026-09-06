import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const desktopSource = read('web-ui/src/legacy-desktop-bootstrap.js');
const themes = read('web-ui/src/styles/themes.css');
const generatedThemes = read('generated/public-web-ui/static/styles/themes.css');
const sessionSource = read('src/gateway/session.ts');

if (themes !== generatedThemes) throw new Error('desktop theme source/generated copies are out of sync');

const extractFunction = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  return source.slice(start, end < 0 ? source.length : end);
};

const main = extractFunction(desktopSource, 'function _renderDesktopSwitcherMain(', 'function _renderDesktopSwitcherQuick(');
const models = extractFunction(desktopSource, 'async function _renderDesktopSwitcherModels(', 'function _renderDesktopSwitcherEffort(');
const effort = extractFunction(desktopSource, 'function _renderDesktopSwitcherEffort(', 'function _renderDesktopSwitcherSpeed(');
const speed = extractFunction(desktopSource, 'function _renderDesktopSwitcherSpeed(', 'async function toggleModelSwitcher(');
const open = extractFunction(desktopSource, 'function _openDesktopSwitcher(', 'async function toggleModelSwitcher(');

if (!/data-switcher-view="speed"/.test(main) || !/speedCapable/.test(main)) throw new Error('Speed must be limited to fast-capable models');
if (!/data-switcher-view="effort"/.test(main) || !/data-switcher-view="models"/.test(main)) throw new Error('Model and Effort must remain separate controls');
if (!/Standard/.test(speed) || !/Fast/.test(speed) || !/data-switcher-speed/.test(speed)) throw new Error('Speed must expose Standard and Fast');
if (!/setActiveChatModelRoute\([^)]*speed/.test(speed)) throw new Error('Speed must persist the selected route speed');
if (/data-switcher-speed|_renderDesktopSwitcherSpeed/.test(effort)) throw new Error('Effort must not mutate Speed');
if (!/setActiveChatModelRoute\([^)]*speed: provider === state\.provider \? state\.speed : undefined/.test(models)) throw new Error('Model changes must preserve same-provider speed');
if (!/function _desktopSwitcherStateFromCache\(sessionId = ''\)/.test(desktopSource) || !/function _openDesktopSwitcher\(controller\)/.test(desktopSource) || !/_renderDesktopSwitcherQuick\(_desktopSwitcherStateFromCache\(controller\.sessionId\), controller\)/.test(open)) throw new Error('Selector must paint cached controls before hydration');
if (!/function _desktopSwitcherCachedRouteForSession\(sessionId = ''\)/.test(desktopSource) || !/const cachedState = _desktopSwitcherCachedRouteForSession\(sessionId\)/.test(desktopSource)) throw new Error('Selector must cache per-chat route state');
if (!/chatModelRoute: normalizeChatModelRoute\(data\?\.chatModelRoute\)/.test(sessionSource)) throw new Error('Session summaries must retain chatModelRoute');
if (!/background:\s*transparent !important/.test(themes) || !/\.nav-group > \.nav-item, \.nav-more-wrap > \.nav-item, \.more-popover-item\)\.active:not\(:hover\):not\(:focus-visible\)/.test(themes)) throw new Error('Current-page nav highlight must be neutral');
if (!/\.sidebar:not\(\.pages-collapsed\) \.sidebar-pages-toggle::before/.test(themes) || !/opacity:\s*0 !important/.test(themes)) throw new Error('Expanded Pages divider must be hidden');

console.log('desktop model selector contract passed');
