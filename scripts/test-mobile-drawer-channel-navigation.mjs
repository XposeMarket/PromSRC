import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync('web-ui/src/mobile/mobile-shell.js', 'utf8');
const api = fs.readFileSync('web-ui/src/mobile/mobile-api.js', 'utf8');

assert.match(shell, /all:\s*\{ sessions:/, 'drawer paging should own one unified session page');
assert.doesNotMatch(shell, /data-drawer-view=|data-channel-key=|Loading channels\.\.\./, 'drawer should not render channel navigation');
assert.match(shell, /head\.innerHTML = '<div class="pm-drawer-section-title">' \+ \(_drawerSessionView === 'settled' \? 'Settled' : 'Sessions'\) \+ '<\/div>';/, 'drawer should render one route-aware Sessions heading');
assert.match(shell, /_wireDrawerInfiniteScroll\(\{ loadSessions, onOpenSession, searchSessions, onNewChat \}\)/, 'infinite scroll should run against the unified page');
assert.match(shell, /Origin channel \(Desktop \/ Telegram \/ Mobile\) is intentionally not shown/, 'session rows should document the unified no-channel-label presentation');
assert.doesNotMatch(shell, /From: \$\{escapeHtml\(origin\)\}/, 'session rows should not recreate channel grouping as an origin label');
assert.match(shell, /data-session-channel="\$\{escapeHtml\(session\?\.channel \|\| ''\)\}"/, 'voice-room rows should retain their special open route metadata');
assert.match(shell, /data-drawer-pinned-toggle/, 'Pinned should remain a drawer control');
assert.match(shell, /_drawerPinnedCollapsed = !_drawerPinnedCollapsed;/, 'Pinned control should still collapse without redrawing the drawer');

assert.match(api, /scope: 'all'/, 'mobile session loading should request the unified server scope');
assert.match(api, /lastOrigin:/, 'mobile summaries should retain presentation-safe origin metadata');
assert.doesNotMatch(api, /MOBILE_SESSION_CHANNELS/, 'mobile API should not create channel groups for the drawer');

console.log('mobile unified session drawer regression checks passed');
