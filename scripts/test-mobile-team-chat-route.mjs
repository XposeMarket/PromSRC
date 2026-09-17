import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const teams = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-teams-pages.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-router.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-chat-renderer-runtime.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web-ui/src/styles/mobile.css'), 'utf8');

const checks = [
  ['team action is Chat', teams.includes('data-act="chat">${ICONS.chat} Chat')],
  ['legacy Review action is gone', !teams.includes('data-act="review"')],
  ['team Chat action opens its route', teams.includes('navigate(`#mobile/teams/${encodeURIComponent(teamId)}/chat`)')],
  ['dedicated Team Chat page is exported', teams.includes('export async function renderTeamChatPage')],
  ['dedicated page reuses subagent chat body', teams.includes('pm-subagent-chat-body pm-team-chat-page-body')],
  ['standalone team chat reuses the subagent shell', teams.includes("'pm-sa-chat-shell pm-team-chat-page-shell'")],
  ['router dispatches Team Chat before team detail', router.indexOf('owner.renderTeamChatPage') > -1 && router.indexOf('owner.renderTeamChatPage') < router.indexOf('owner.renderTeamDetailPage')],
  ['dedicated team list is not height-capped', css.includes('.pm-team-chat-page-body .pm-team-chat-list') && css.includes('max-height: none;')],
  ['agent sender name precedes work timer', renderer.indexOf('inner += senderIconHtml') > -1 && renderer.indexOf('inner += senderIconHtml') < renderer.indexOf('inner += _renderMobileWorkTimer')],
  ['dedicated keyboard keeps the tab bar visible', css.includes('pm-app.pm-keyboard-open .pm-page.pm-agent-chat-page + .pm-tabbar') && css.includes('display: grid !important;')],
  ['team sender row stays above work timer', css.includes('.pm-page.pm-team-agent-chat-page .pm-bubble .pm-sender-with-icon') && css.includes('display: flex !important;') && css.includes('width: 100%;')],
  ['dedicated composer keeps a real keyboard anchor', teams.includes('visibleTabbarBottomInset') && css.includes('bottom: calc(var(--pm-keyboard-offset, 0px) + var(--pm-tabbar-h, 60px)') && !css.includes('pm-app.pm-keyboard-open .pm-page.pm-agent-chat-page .pm-agent-chat-composer.pm-composer {\r\n  bottom: auto !important;')],
  ['keyboard composer starts placement before focus', teams.indexOf('beginKeyboardPlacement();\n    window.requestAnimationFrame(() => input?.focus') > -1],
  ['dedicated keyboard releases after viewport recovery', teams.includes('keyboardFocusGraceUntil') && teams.includes('if (!keyboardStillVisible && !focusHandoff)') && teams.includes('releaseKeyboardPlacement();')],
  ['dedicated composer matches main-chat scroll handoff', teams.includes('composerModeScrollIntentUntil') && teams.includes('composerModeScrollIgnoreUntil') && teams.includes("setAgentComposerMode(false, { animate: true, reason: 'scroll' })")],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [label] of failed) console.error(`FAIL: ${label}`);
  process.exit(1);
}

for (const [label] of checks) console.log(`PASS: ${label}`);
