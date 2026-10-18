import assert from 'node:assert/strict';
import { stripChatUiMarkup } from './chat-ui-markup.js';
import { sanitizeFinalReply } from './reply-processor.js';

// Real GPT reply that rendered with raw ** and a missing "LM Studio" label on mobile.
const gpt = [
  '## What I\'d install',
  '',
  '<row align="start" gap={3}>',
  ' <AsyncImage query="Ollama desktop application" aspectRatio="4:5" maxWidth="100px"/>',
  ' <box flex="1" gap={1}>',
  ' **<Entity value="Ollama" category="software" disambig="Local AI model runtime"/> — easiest starting point**',
  '',
  '[ollama.com](https://ollama.com/)',
  '',
  'Install it, then run the commands above.',
  ' </box>',
  '</row>',
  '<row align="start" gap={3}>',
  ' <box flex="1" gap={1}>',
  ' **<Entity value="LM Studio" category="software"/> — easiest graphical interface**',
  ' </box>',
  '</row>',
].join('\n');

const out = stripChatUiMarkup(gpt);
assert.ok(!/<\/?(?:row|box|Entity|AsyncImage)\b/.test(out), out);
assert.match(out, /^\*\*Ollama — easiest starting point\*\*$/m);
assert.match(out, /^\*\*LM Studio — easiest graphical interface\*\*$/m);
assert.match(out, /^\[ollama\.com\]\(https:\/\/ollama\.com\/\)$/m);
assert.ok(!/\n{3,}/.test(out));

// Untouched when there is no markup, and code fences are preserved verbatim.
assert.equal(stripChatUiMarkup('plain **bold** <b>x</b>'), 'plain **bold** <b>x</b>');
const fenced = 'see <Entity value="A"/>\n```jsx\n<row><Entity value="B"/></row>\n```';
assert.equal(stripChatUiMarkup(fenced), 'see A\n```jsx\n<row><Entity value="B"/></row>\n```');

// Wired into the final-reply sanitizer (channels + saved history for new turns).
assert.equal(sanitizeFinalReply('Use <Entity value="Ollama"/> today.'), 'Use Ollama today.');

console.log('chat-ui-markup regression: ok');
