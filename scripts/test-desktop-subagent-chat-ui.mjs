import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const subagents = read('web-ui/src/pages/SubagentsPage.js');
const teams = read('web-ui/src/pages/TeamsPage.js');
const chat = read('web-ui/src/pages/ChatPage.js');
const index = read('web-ui/index.html');
const performance = read('web-ui/src/performance.js');
const performanceGenerated = read('generated/public-web-ui/static/performance.js');
const canonical = read('web-ui/src/features/chat/canonical-desktop-composer.js');
const canonicalGenerated = read('generated/public-web-ui/static/features/chat/canonical-desktop-composer.js');

assert.match(
  subagents,
  /const isChat = subagentDetailTab === 'chat';[\s\S]*?header\.hidden = isChat;[\s\S]*?header\.style\.display = isChat \? 'none' : 'flex';/,
  'the outer subagent board header must be hidden while direct chat is active',
);
assert.match(
  subagents,
  /function closeUnifiedSubagentChat\(agentId\) \{[\s\S]*?captureSubagentChatDraft\(\);[\s\S]*?subagentDetailTab = 'overview';/,
  'the chat exit control must capture the draft before returning to Overview',
);
assert.match(
  subagents,
  /onclick="closeUnifiedSubagentChat\(\$\{agentArg\}\)"/,
  'the unified chat header must own a safe return-to-overview control',
);
assert.match(
  subagents,
  /voiceAction: "toggleUnifiedDesktopComposerDictation\('subagent-chat-input', this\)"/,
  'subagent voice input must use the shared desktop dictation behavior',
);

const chatTab = subagents.match(/function renderSubagentChatTab\(agent\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(chatTab, /return renderSubagentUnifiedDesktopChat\(agent\);/);
assert.doesNotMatch(chatTab, /chat-input-area panel-chat-composer/);

// The page-specific renderers still own state/transport adapters, but their
// visible composer is NOT allowed to be a separately styled implementation.
assert.match(subagents, /renderer\.renderComposer\(\{/);
assert.match(teams, /renderer\.renderComposer\(\{/);
assert.match(chat, /window\.__PROM_UNIFIED_DESKTOP_CHAT = \{/);
assert.match(chat, /renderComposer: renderUnifiedDesktopComposerHtml/);

assert.equal(performance, performanceGenerated, 'performance source/generated copies must match');
assert.equal(canonical, canonicalGenerated, 'canonical composer source/generated copies must match');
assert.match(performance, /import\('\.\/features\/chat\/canonical-desktop-composer\.js'\)/,
  'desktop bootstrap must install canonical main-composer reuse');

// One visual source of truth: clone the composer already mounted in #chat-view.
assert.match(index, /<div class="chat-input-area">[\s\S]*?<div class="chat-input-row">[\s\S]*?class="chat-composer-input-wrap"/,
  'main chat composer DOM contract changed unexpectedly');
assert.match(index, /id="chat-composer-input-wrap"/,
  'main composer input wrapper identity changed; clone isolation contract must be revisited');
assert.match(canonical, /MAIN_COMPOSER_SELECTOR = '#chat-view > \.chat-input-area/);
assert.match(canonical, /const clone = main\.cloneNode\(true\)/,
  'secondary composers must reuse the actual main composer DOM');
assert.match(canonical, /clone\.querySelectorAll\('\[id\]'\)\.forEach\(\(node\) => node\.removeAttribute\('id'\)\)/,
  'cloned main-only ids must be stripped before restoring secondary identities');
assert.match(canonical, /clone\.dataset\.canonicalComposerSource = 'main-chat-dom'/);

// Cover every legacy desktop entry point the user can actually see.
assert.match(canonical, /\.side-chat-composer\.chat-input-area/,
  'legacy side chats must be replaced with the canonical main composer');
assert.match(canonical, /\.unified-agent-chat-composer\.chat-input-area/,
  'subagent/team chats must be replaced with the canonical main composer');
assert.match(subagents, /composerClass:\s*'unified-agent-chat-composer subagent-panel-chat-composer'/,
  'subagent entry point changed; canonical selector coverage must be updated');
assert.match(teams, /composerClass:\s*'unified-agent-chat-composer team-chat-unified-composer'/,
  'team entry point changed; canonical selector coverage must be updated');
assert.match(chat, /composerClass:\s*'side-chat-composer'/,
  'legacy side-chat entry point changed; canonical selector coverage must be updated');

// Never put the classes that trigger the old panel geometry on the replacement.
assert.match(canonical, /clone\.className = 'chat-input-area unified-desktop-chat-composer'/);
assert.doesNotMatch(canonical, /clone\.classList\.add\([^\n]*(?:side-chat-composer|unified-agent-chat-composer|subagent-panel-chat-composer|team-chat-unified-composer)/,
  'legacy geometry classes must never be re-added to the visible composer');
assert.doesNotMatch(canonical, /width:\s*min\(760px|calc\(100% - 52px\)/,
  'canonical reuse must not recreate legacy composer geometry');

console.log('desktop subagent/team/side composer contract: visible surfaces reuse the real main composer DOM without duplicate main ids');
