import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('web-ui/src/prom-bot.js');
const generated = read('generated/public-web-ui/static/prom-bot.js');
const performanceSource = read('web-ui/src/performance.js');
const performanceGenerated = read('generated/public-web-ui/static/performance.js');
const index = read('web-ui/index.html');

assert.equal(source, generated, 'Prom Bot generated runtime must mirror canonical source');
assert.equal(performanceSource, performanceGenerated, 'desktop bootstrap mirror must stay in sync');
assert.match(performanceSource, /!window\.__PROM_SHOULD_BOOT_MOBILE\?\.\(\)/, 'Prom Bot must stay out of the mobile/PWA runtime');
assert.match(performanceSource, /import\('\.\/prom-bot\.js'\)/, 'Prom Bot must boot with the desktop app shell');

// The new mode button belongs between Search and Priority and deliberately
// reuses the existing Subagents robot glyph rather than inventing a new icon.
assert.match(source, /getElementById\('sidebarSearchToggle'\)/);
assert.match(source, /getElementById\('sidebarPriorityToggle'\)/);
assert.match(source, /insertBefore\(button, priorityButton\)/, 'Prom Bot toggle must sit immediately before Priority');
assert.match(source, /<rect x="4" y="5" width="8" height="7" rx="2"\/>/, 'Prom Bot must reuse the Subagents robot icon');
assert.ok(index.indexOf('id="sidebarSearchToggle"') < index.indexOf('id="sidebarPriorityToggle"'), 'existing Search/Priority order changed unexpectedly');

// Mode adds a fourth top-level content section without replacing the existing
// pinned/project/chat lists.
assert.match(source, /PROM_BOT_SECTION_ID = 'prom-bot-sidebar-section'/);
assert.match(source, /getElementById\('sidebar-pinned-section'\)/);
assert.match(source, /insertBefore\(section, pinnedSection\)/, 'Subagents section must be directly above Pinned Chats');
assert.match(source, /<span>Subagents<\/span>/);
assert.match(source, /PROM_BOT_MODE_KEY = 'prometheus_prom_bot_mode_v1'/, 'Prom Bot mode should persist across desktop reloads');
assert.match(index, /id="sidebar-pinned-section"/);
assert.match(index, /id="sidebar-projects-section"/);
assert.match(index, /id="jobs-list"/);

// Sidebar identities come from the same real subagent catalog as the existing
// Subagents page. Default/synthetic shells must not leak into Prom Bot.
assert.match(source, /api\('\/api\/agents'/);
assert.match(source, /!agent\.default && !agent\.isSynthetic/);

// Critical architecture contract: clicking a bot reuses the existing durable
// single-thread Subagents runtime and the shared ChatPage renderer. There is no
// second /chat implementation or duplicate thread id in this feature shell.
assert.match(source, /import\('\.\/pages\/SubagentsPage\.js'\)/);
assert.match(source, /__PROM_UNIFIED_DESKTOP_CHAT/);
assert.match(source, /openSubagentDetail\(id\)/);
assert.match(source, /switchSubagentTab\('chat', id\)/);
assert.match(source, /getElementById\('subagent-board'\)/);
assert.match(source, /getElementById\('chat-view'\)/);
assert.match(source, /PROM_BOT_HOST_ID = 'prom-bot-chat-host'/);
assert.doesNotMatch(source, /api\(`\/api\/agents\/\$\{[^}]+\}\/chat/, 'Prom Bot shell must not fork the direct-chat transport');

// Normal sidebar navigation restores the untouched Prometheus chat underneath
// while Prom Bot mode itself can remain enabled and visible.
assert.match(source, /closePromBotChat\(\{ keepMode: true \}\)/);
assert.match(source, /restoreSubagentBoard\(\)/);
assert.match(source, /originalBoardParent\.insertBefore/);
assert.match(source, /sidebar\.addEventListener\('click'/);

console.log('[test-desktop-prom-bot] passed: persistent sidebar bots reuse durable subagent threads and unified desktop chat');
