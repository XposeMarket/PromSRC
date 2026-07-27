import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('web-ui/src/mobile/mobile-shell.js', 'utf8');

assert.match(source, /let _drawerStateCache = null;/, 'drawer navigation should keep an in-memory view state');
assert.match(source, /if \(_drawerStateCache\) return \{ \.\.\._drawerStateCache \};/, 'drawer state should not depend on a storage round-trip while open');
assert.match(source, /_drawerStateCache = _normalizeDrawerState\(state\);/, 'navigation must update the in-memory drawer state first');

const renderStart = source.indexOf('async function _renderDrawerSessions');
const migration = source.indexOf('await _migrateLegacyPinnedSessionsToServer();', renderStart);
const channelsLoading = source.indexOf("Loading channels...", renderStart);
assert.ok(channelsLoading > renderStart && channelsLoading < migration, 'Channels should replace mobile chats before asynchronous drawer work starts');
assert.match(source, /preserveScroll = false/, 'drawer redraws should support preserving scroll position');
assert.match(source, /const preservedScrollTop = preserveScroll/, 'drawer redraw should capture its current scroll position');
assert.match(source, /finally \{\s*restoreScroll\(\);\s*\}/, 'drawer redraw should restore scroll after rendering');

const controlsStart = source.indexOf('function _wireDrawerSessionControls');
const controls = source.slice(controlsStart, source.indexOf('\nfunction ', controlsStart + 1));
assert.match(controls, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/, 'drawer view taps must not bubble into drawer gestures');
assert.match(controls, /preserveScroll: true/, 'drawer navigation must preserve the current drawer scroll position');
assert.match(source, /data-drawer-pinned-toggle/, 'Pinned should be rendered as a drawer control');
assert.match(source, /_drawerPinnedCollapsed = !_drawerPinnedCollapsed;/, 'Pinned control should toggle its collapsed state');
assert.match(source, /content\.hidden = _drawerPinnedCollapsed/, 'Pinned content should collapse without redrawing the drawer');

console.log('mobile drawer channel navigation regression checks passed');
