import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pages = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-api.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web-ui/src/styles/mobile.css'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/pm-mobile-side-sheet[^>]+aria-hidden="true" inert/.test(pages), 'side chat must start hidden and inert');
assert(/sideSheet\?\.removeAttribute\('inert'\)[\s\S]{0,180}classList\.add\('open'\)/.test(pages), 'only the explicit open path may activate side chat');
assert(/closeMobileSideChatSheet[\s\S]{0,260}setAttribute\('inert', ''\)/.test(pages), 'closing side chat must restore inert state');
assert(/\.pm-mobile-side-sheet \{[\s\S]*?visibility: hidden;[\s\S]*?overflow: hidden;/.test(css), 'closed side chat must not be paintable outside the viewport');
assert(/\.pm-mobile-side-sheet\.open \{[\s\S]*?visibility: visible;/.test(css), 'open side chat must restore visibility');

assert(/Loading team chat&hellip;/.test(pages), 'team chat must show a loading state immediately');
assert(/function normalizeTeamChatMessage/.test(pages), 'team messages must be normalized before rendering');
assert(/rendered\.map\(renderTeamChatMessage\)/.test(pages), 'team history must use the resilient renderer');
assert(/rich message render failed/.test(pages), 'one malformed team message must not blank the full history');
assert(/loadTeamChat[\s\S]{0,220}mfetch/.test(api), 'team chat must use the paired mobile fetch path');
assert(/\.pm-team-chat-list \{[\s\S]*?min-height:/.test(css), 'team history needs a stable readable viewport');

console.log('Mobile team chat and side chat UI contracts passed.');
