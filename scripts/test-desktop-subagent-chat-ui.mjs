import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const subagents = read('web-ui/src/pages/SubagentsPage.js');
const chat = read('web-ui/src/pages/ChatPage.js');

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
assert.match(subagents, /renderer\.renderComposer\(\{/);
assert.match(chat, /data-unified-composer/);
assert.match(chat, /window\.__PROM_UNIFIED_DESKTOP_CHAT = \{/);
assert.match(chat, /renderComposer: renderUnifiedDesktopComposerHtml/);

console.log('desktop subagent chat UI contract: ok');
