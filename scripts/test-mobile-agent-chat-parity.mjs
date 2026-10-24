// Regression checks: mobile subagent + team chat routes match main mobile chat.
// Source-level assertions (no browser). Each spec section has a positive and,
// where meaningful, a negative check so the opt-in path cannot leak elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const router = read('web-ui/src/mobile/mobile-router.js');
const teams = read('web-ui/src/mobile/mobile-teams-pages.js');
const subagent = read('web-ui/src/mobile/mobile-subagent-pages.js');
const renderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const css = read('web-ui/src/styles/mobile.css');

// Body of _renderMobileAgentChatBubble, used for the chatParity polarity checks.
const bubbleStart = renderer.indexOf('function _renderMobileAgentChatBubble(');
const bubbleEnd = renderer.indexOf('function _mobileMainPlanState(');
const bubble = bubbleStart > -1 && bubbleEnd > bubbleStart ? renderer.slice(bubbleStart, bubbleEnd) : '';

// Named export block of a module (the last `export {` ... `};`).
const exportBlock = (src) => {
  const start = src.lastIndexOf('\nexport {');
  return start > -1 ? src.slice(start, src.indexOf('};', start)) : '';
};

// Keyboard helpers in mobile-teams-pages.js (inside _installMobileAgentComposer).
const beginFn = teams.slice(teams.indexOf('const beginKeyboardPlacement'), teams.indexOf('const beginKeyboardPlacement') + 600);
const placeFn = teams.slice(teams.indexOf('const placeAboveKeyboard'), teams.indexOf('const placeAboveKeyboard') + 500);
const clearFn = teams.slice(teams.indexOf('const clearKeyboardPlacement'), teams.indexOf('const clearKeyboardPlacement') + 700);

const checks = [
  // A. Markdown libs for dedicated agent routes
  ['router ensures markdown libs for dedicated agent routes', router.includes("page === 'chat' || page === 'voice' || isDedicatedAgentChatRoute({ page, arg, extra })")],
  ['router no longer gates markdown libs on chat/voice only', !router.includes("if (page === 'chat' || page === 'voice') {")],
  ['team tab registers markdown-ready re-render', teams.includes("window.addEventListener('prometheus:markdown-ready', onMarkdownReady)")],
  ['team tab removes markdown-ready listener on cleanup', teams.includes("window.removeEventListener('prometheus:markdown-ready', onMarkdownReady)")],
  ['subagent tab keeps its markdown-ready listener', subagent.includes("window.addEventListener('prometheus:markdown-ready', onMarkdownReady)") && subagent.includes("window.removeEventListener('prometheus:markdown-ready', onMarkdownReady)")],

  // B. Thread class on both lists, never id="pm-chat-thread"
  ['subagent list carries pm-chat-thread', subagent.includes('<div id="pm-sa-chat-list" class="pm-sa-chat-list pm-chat-thread">')],
  ['team standalone list carries pm-chat-thread', teams.includes("pm-team-chat-list${standalone ? ' pm-chat-thread pm-sa-chat-scrollport pm-sa-chat-list' : ''}")],
  ['embedded team list has no pm-chat-thread', !teams.includes('class="pm-team-chat-list pm-chat-thread')],
  ['neither list uses id="pm-chat-thread"', !subagent.includes('id="pm-chat-thread"') && !teams.includes('id="pm-chat-thread"')],

  // C. Skin scope: :is(.pm-chat-body, .pm-agent-chat-page)
  ['p1 user bubble uses :is() scope', css.includes(':root[data-skin="p1"] body.pm-mobile-active :is(.pm-chat-body, .pm-agent-chat-page) .pm-msg.from-user .pm-bubble {')],
  ['bare p1 user-bubble selector is gone', !css.includes('body.pm-mobile-active .pm-chat-body .pm-msg.from-user .pm-bubble {')],
  ['at least seven p1 skin selectors are scoped', (css.match(/:is\(\.pm-chat-body, \.pm-agent-chat-page\)/g) || []).length >= 7],

  // D. Final-authority CSS block for dedicated agent chat threads
  ['final-authority block sets thread gap 17px', css.includes('body.pm-mobile-active .pm-page.pm-agent-chat-page .pm-chat-thread {') && css.includes('gap: 17px;')],
  ['final-authority block zeroes agent message margin', css.includes('body.pm-mobile-active .pm-page.pm-agent-chat-page .pm-chat-thread .pm-msg.pm-agent-chat-msg {')],

  // E. Bubble chrome, opt-in via chatParity
  ['bubble honors chatParity option', bubble.includes('options.chatParity === true')],
  ['chatParity path emits reveal time', bubble.includes('<span class="pm-reveal-time" aria-hidden="true">')],
  ['chatParity path emits copy action', bubble.includes('data-pm-agent-msg-action="copy"')],
  ['chatParity path emits speak action', bubble.includes('data-pm-agent-msg-action="speak"')],
  ['non-parity path keeps in-bubble pm-time', bubble.includes("${time && !chatParity ? `<span class=\"pm-time\">${escapeHtml(time)}</span>` : ''}")],
  ['actions skip streaming and background bubbles', bubble.includes('!fromUser && !streaming && text && !backgroundAgentId')],
  ['subagent recovery bubble stays on default path', subagent.includes("_renderMobileAgentChatBubble(message, { sender: 'Recovery' })")],
  ['showSender:false suppresses AI sender row', bubble.includes("options.showSender === false")],
  ['subagent route passes showSender:false', subagent.includes('showSender: false')],
  ['team route does not pass showSender:false', !teams.includes('showSender: false')],
  ['team route passes chatParity', teams.includes('chatParity: true,')],

  // F. Action wiring
  ['action helper is exported from teams module', exportBlock(teams).includes('_wireMobileAgentMessageActions')],
  ['action helper is idempotent', teams.includes("listEl.dataset.pmAgentActionsWired === '1'")],
  ['copy checks clipboard API before use', teams.includes("if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');")],
  ['copy falls back to execCommand when clipboard is missing', teams.includes("document.execCommand('copy')") && teams.includes('_copyMobileAgentMessageText(text);')],
  ['copy never calls clipboard.writeText unguarded', !teams.includes('navigator.clipboard.writeText(text).then(')],
  ['actions read only the answer markdown, not trace drawers', teams.includes("querySelector(':scope > .pm-bubble > .markdown-body')") && !teams.includes("btn.closest('.pm-msg')?.querySelector('.markdown-body')")],
  ['subagent route wires actions', subagent.includes('_wireMobileAgentMessageActions(listEl)') && subagent.includes('_wireMobileAgentMessageActions,')],
  ['team route wires actions', teams.includes('_wireMobileAgentMessageActions(listEl);')],
  ['mobile-pages exports _ttsSpeak and _ttsStop', exportBlock(pages).includes('_ttsSpeak,') && exportBlock(pages).includes('_ttsStop,')],
  ['teams imports _ttsSpeak and _ttsStop', teams.includes('  _ttsSpeak,') && teams.includes('  _ttsStop,')],

  // G. Keyboard like main
  ['old force-visible tab bar rule is removed', !css.includes('pm-app.pm-keyboard-open .pm-page.pm-agent-chat-page + .pm-tabbar')],
  ['keyboard fallback uses calc(keyboard-offset + 8px)', css.includes('bottom: calc(var(--pm-keyboard-offset, 0px) + 8px) !important;')],
  ['keyboardTabbar hidden in beginKeyboardPlacement', beginFn.includes("keyboardTabbar?.style.setProperty('display', 'none', 'important')")],
  ['keyboardTabbar hidden in placeAboveKeyboard', placeFn.includes("keyboardTabbar?.style.setProperty('display', 'none', 'important')")],
  ['keyboardTabbar restored in clearKeyboardPlacement', clearFn.includes("keyboardTabbar?.style.removeProperty('display')")],
  ['tab bar is not forced visible while keyboard open', !css.includes('display: grid !important;\n  visibility: visible !important;\n  pointer-events: auto !important;\n}\nbody.pm-mobile-active .pm-app.pm-keyboard-open .pm-page.pm-agent-chat-page .pm-agent-chat-composer')],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [label] of failed) console.error(`FAIL: ${label}`);
  process.exit(1);
}

for (const [label] of checks) console.log(`PASS: ${label}`);
console.log(`ok - ${checks.length} mobile agent chat parity checks passed`);
