import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('web-ui/src/prom-bot.js');
const generated = read('generated/public-web-ui/static/prom-bot.js');
const performanceSource = read('web-ui/src/performance.js');
const performanceGenerated = read('generated/public-web-ui/static/performance.js');
const multiChatSource = read('web-ui/src/features/chat/multi-chat-workspace-v2.js');
const multiChatGenerated = read('generated/public-web-ui/static/features/chat/multi-chat-workspace-v2.js');
const chatPageSource = read('web-ui/src/pages/ChatPage.js');
const chatPageGenerated = read('generated/public-web-ui/static/pages/ChatPage.js');
const index = read('web-ui/index.html');

assert.equal(source, generated, 'Prom Bot generated runtime must mirror canonical source');
assert.equal(performanceSource, performanceGenerated, 'desktop bootstrap mirror must stay in sync');
assert.equal(multiChatSource, multiChatGenerated, 'multi-chat generated runtime must mirror canonical source');
assert.equal(chatPageSource, chatPageGenerated, 'ChatPage generated runtime must mirror canonical source');
// The mobile exclusion is request-observed in
// test-web-ui-performance-foundation.mjs rather than inferred from source text.
assert.match(performanceSource, /import\('\.\/prom-bot\.js'\)/, 'Prom Bot must boot with the desktop app shell');

// The mode button belongs between Search and Priority and deliberately reuses
// the existing Subagents robot glyph rather than inventing a new icon.
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

// Critical architecture contract: clicking a bot reuses the durable Subagents
// runtime and shared ChatPage renderer, but it replaces the visible main chat
// region instead of layering an absolute subagent panel over it.
assert.match(source, /import\('\.\/pages\/SubagentsPage\.js'\)/);
assert.match(source, /__PROM_UNIFIED_DESKTOP_CHAT/);
assert.match(source, /openSubagentDetail\(id\)/);
assert.match(source, /switchSubagentTab\('chat', id\)/);
assert.match(source, /PROM_BOT_SURFACE_ID = 'prom-bot-main-surface'/);
assert.match(source, /function displaceMainChatSurface\(/);
assert.match(source, /entry\.node\.hidden = true/);
assert.match(source, /#chat-view\.prom-bot-chat-active > \[hidden\][\s\S]*?display: none !important/,
  'Prom Bot must suppress authored display rules on displaced main-chat children');
assert.match(source, /function restoreMainChatSurface\(/);
assert.match(source, /mountSubagentBoardAsMainChatSurface\(\)/);
assert.match(source, /function setPromChatTitleOverride\(/,
  'Prom Bot should expose a shared title override instead of renaming the underlying chat session');
assert.match(source, /setPromChatTitleOverride\(agent\?\.name \|\| id, 'Prom Bot · Subagent chat', 'prom-bot'\)/,
  'direct Prom Bot tabs must identify the selected subagent');
assert.match(source, /clearPromChatTitleOverride\('prom-bot'\)/,
  'direct Prom Bot title overrides must be cleared when leaving the subagent');
assert.match(multiChatSource, /titleOverrideForSession\(/,
  'multi-chat tabs must consume the Prom Bot title projection');
assert.match(multiChatSource, /window\.refreshPromMultiChatTabs = renderTabStrip/,
  'Prom Bot title changes must be able to refresh the existing tab strip');
assert.match(chatPageSource, /__PROM_CHAT_TITLE_OVERRIDE/,
  'the regular chat topbar must consume the same Prom Bot title projection');
assert.doesNotMatch(source, /PROM_BOT_HOST_ID|prom-bot-chat-host/, 'the retired absolute overlay host must not return');
assert.doesNotMatch(source, /#\$\{PROM_BOT_SURFACE_ID\}\s*\{[\s\S]*?position:\s*absolute/, 'Prom Bot surface must participate in the main chat layout instead of overlaying it');
assert.doesNotMatch(source, /api\(`\/api\/agents\/\$\{[^}]+\}\/chat/, 'Prom Bot shell must not fork the direct-chat transport');

// Normal sidebar navigation restores the displaced Prometheus chat nodes while
// Prom Bot mode itself can remain enabled and visible.
assert.match(source, /closePromBotChat\(\{ keepMode: true \}\)/);
assert.match(source, /restoreSubagentBoard\(\)/);
assert.match(source, /restoreMainChatSurface\(\)/);
assert.match(source, /originalBoardParent\.insertBefore/);
assert.match(source, /sidebar\.addEventListener\('click'/);

console.log('[test-desktop-prom-bot] passed: persistent sidebar bots replace the main chat region without an overlay and reuse durable subagent threads');
