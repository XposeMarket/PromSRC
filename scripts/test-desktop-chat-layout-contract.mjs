import fs from 'node:fs';

const paths = {
  base: 'web-ui/src/styles/base.css',
  components: 'web-ui/src/styles/components.css',
  chat: 'web-ui/src/pages/ChatPage.js',
  multiChat: 'web-ui/src/features/chat/multi-chat-workspace-v2.js',
  multiChatCss: 'web-ui/src/styles/multi-chat-workspace.css',
  performance: 'web-ui/src/performance.js',
  sourceContext: 'web-ui/src/source-panel-context.js',
  generatedBase: 'generated/public-web-ui/static/styles/base.css',
  generatedComponents: 'generated/public-web-ui/static/styles/components.css',
  generatedChat: 'generated/public-web-ui/static/pages/ChatPage.js',
  generatedMultiChat: 'generated/public-web-ui/static/features/chat/multi-chat-workspace-v2.js',
  generatedMultiChatCss: 'generated/public-web-ui/static/styles/multi-chat-workspace.css',
  generatedPerformance: 'generated/public-web-ui/static/performance.js',
  generatedSourceContext: 'generated/public-web-ui/static/source-panel-context.js',
};

const read = (path) => fs.readFileSync(path, 'utf8');
const sourceBase = read(paths.base);
const sourceComponents = read(paths.components);
const sourceChat = read(paths.chat);
const multiChat = read(paths.multiChat);
const multiChatCss = read(paths.multiChatCss);
const performance = read(paths.performance);
const sourceContext = read(paths.sourceContext);
const generatedBase = read(paths.generatedBase);
const generatedComponents = read(paths.generatedComponents);
const generatedChat = read(paths.generatedChat);
const generatedMultiChat = read(paths.generatedMultiChat);
const generatedMultiChatCss = read(paths.generatedMultiChatCss);
const generatedPerformance = read(paths.generatedPerformance);
const generatedSourceContext = read(paths.generatedSourceContext);

if (sourceBase !== generatedBase) throw new Error('base.css source/generated copies are out of sync');
if (sourceComponents !== generatedComponents) throw new Error('components.css source/generated copies are out of sync');
if (sourceChat !== generatedChat) throw new Error('ChatPage.js source/generated copies are out of sync');
if (multiChat !== generatedMultiChat) throw new Error('multi-chat v2 workspace source/generated copies are out of sync');
if (multiChatCss !== generatedMultiChatCss) throw new Error('multi-chat workspace styles source/generated copies are out of sync');
if (performance !== generatedPerformance) throw new Error('performance.js source/generated copies are out of sync');
if (sourceContext !== generatedSourceContext) throw new Error('source-panel-context source/generated copies are out of sync');

const minimizedCenter = sourceBase.match(/body:not\(\.pm-mobile-active\)\.sources-minimized-open \.workspace > \.center-col\s*\{([\s\S]*?)\}/)?.[1] || '';
if (!/margin-right:\s*0\s*;?/.test(minimizedCenter)) {
  throw new Error('minimized Sources must remain a floating overlay without shifting the center column');
}
if (/--sources-minimized-layout-reserve:/.test(sourceBase)) {
  throw new Error('minimized Sources must not reserve a background drawer footprint');
}

const minimizedRightPanel = sourceBase.match(/body:not\(\.pm-mobile-active\)\.sources-minimized-open #right-panel\s*\{([\s\S]*?)\}/)?.[1] || '';
if (!/width:\s*0\s*!important/.test(minimizedRightPanel)
  || !/min-width:\s*0\s*!important/.test(minimizedRightPanel)
  || !/flex-basis:\s*0\s*!important/.test(minimizedRightPanel)
  || !/transition:\s*none\s*!important/.test(minimizedRightPanel)) {
  throw new Error('minimized Sources must not reopen or reserve the full right drawer');
}
if (!/\.sources-minimized-panel\s*\{[\s\S]*?position:\s*fixed/.test(sourceComponents)) {
  throw new Error('minimized Sources card should remain the compact fixed surface');
}

if (!/--chat-content-max-width:\s*860px/.test(sourceComponents)) {
  throw new Error('shared desktop chat max-width token is missing');
}
if (!/--chat-content-inline-gutter:\s*clamp\(20px,\s*4cqw,\s*44px\)/.test(sourceComponents)) {
  throw new Error('shared responsive desktop chat gutter token is missing');
}

const sharedWidth = String.raw`width:\s*min\(var\(--chat-content-max-width\),\s*calc\(100%\s*-\s*var\(--chat-content-inline-gutter\)\s*-\s*var\(--chat-content-inline-gutter\)\)\)`;
const messageShell = sourceComponents.match(/\.msg-shell\s*\{([\s\S]*?)\}/)?.[1] || '';
const composer = sourceComponents.match(/\.chat-input-area\s*\{([\s\S]*?)\}/)?.[1] || '';
if (!(new RegExp(sharedWidth)).test(messageShell)) {
  throw new Error('main message shell is not locked to the shared conversation width');
}
if (!(new RegExp(sharedWidth)).test(composer)) {
  throw new Error('main composer is not locked to the shared conversation width');
}

const extractFunction = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end < 0 ? source.length : end);
};

const toggleSources = extractFunction(sourceChat, 'function toggleSources(', 'function openChatResourceFile');
if (!/sourcePanelMiniItems\('all'\)\.length\s*===\s*0/.test(toggleSources)
  || !/showSourcesMinimizedPanel\(\)/.test(toggleSources)) {
  throw new Error('empty Sources toggle must stay on the compact minimized surface');
}
if (!/openFullSourcePanel\(\)/.test(toggleSources)) {
  throw new Error('Sources toggle must preserve the intentional full-panel path');
}

const minimizedOpen = extractFunction(sourceChat, 'function showSourcesMinimizedPanel()', 'function hideSourcesMinimizedPanel');
if (!/syncSourcesMinimizedLayout\(true\)/.test(minimizedOpen)
  || /toggleRightPanel\(|setRightPanelWidth\(/.test(minimizedOpen)) {
  throw new Error('minimized Sources opener must not open or resize the right drawer');
}

const miniItems = extractFunction(sourceChat, 'function sourcePanelMiniItems(', 'function toggleSourcePanelMiniFilter');
if (!/data\.recent/.test(miniItems) || !/data\.gitItems/.test(miniItems)) {
  throw new Error('populated Sources state must continue to use minimized source items');
}

if (!/import '\.\/features\/chat\/multi-chat-workspace-v2\.js';/.test(performance)
  || /import '\.\/features\/chat\/multi-chat-workspace\.js';/.test(performance)) {
  throw new Error('desktop boot must install only the corrected multi-chat v2 controller');
}
if (!/prometheus_multi_chat_tabs_v2/.test(multiChat) || !/MAX_TABS\s*=\s*30/.test(multiChat)) {
  throw new Error('corrected multi-chat tabs need a clean persisted state namespace');
}
if (!/DRAG_MIME\s*=\s*'application\/x-prometheus-chat'/.test(multiChat)) {
  throw new Error('sidebar/tab drag and drop must use the desktop chat transfer contract');
}

const addExplicitTab = extractFunction(multiChat, 'function addExplicitTab(', 'function removeTab');
if (!/state\.tabs\.find\(\(tab\) => tab\.sessionId === sid\)/.test(addExplicitTab)
  || !/if \(existing\)/.test(addExplicitTab)
  || !/state\.tabs\.push\(/.test(addExplicitTab)) {
  throw new Error('explicit tab enrollment must dedupe by session id');
}

const syncMainSession = extractFunction(multiChat, 'function syncMainSession()', 'function installParentWorkspace');
if (/addExplicitTab\(|state\.tabs\.push\(/.test(syncMainSession)) {
  throw new Error('ordinary main-session/sidebar navigation must not add a browser tab');
}
if (!/state\.mainSessionId = sid/.test(syncMainSession) || !/renderTabStrip\(\)/.test(syncMainSession)) {
  throw new Error('ordinary sidebar navigation should only update the visible main-session marker');
}

const activateMain = extractFunction(multiChat, 'function activateMain(', 'function sideFrameUrl');
const openSide = extractFunction(multiChat, 'function openSide(', 'function closeSide');
if (!/addExplicitTab\(sid, title\)/.test(activateMain) || !/addExplicitTab\(sid, title\)/.test(openSide)) {
  throw new Error('drag/drop pane activation must explicitly enroll the dragged session as a tab');
}

if (!/data-chat-drop="main"/.test(multiChat) || !/data-chat-drop="side"/.test(multiChat)) {
  throw new Error('drag UI must expose independent main and side pane targets');
}
if (!/zone\?\.dataset\.chatDrop === 'main'\) activateMain/.test(multiChat)
  || !/zone\?\.dataset\.chatDrop === 'side'\) openSide/.test(multiChat)) {
  throw new Error('dragging a retained tab down must replace main or reopen side independently');
}

const closeSide = extractFunction(multiChat, 'function closeSide()', 'function reorderTabs');
if (/state\.tabs\s*=|removeTab\(/.test(closeSide)) {
  throw new Error('closing the side pane must retain the chat as a browser-style tab');
}
const renderTabStrip = extractFunction(multiChat, 'function renderTabStrip()', 'function ensureSidePane');
if (!/strip\.hidden = state\.tabs\.length === 0/.test(renderTabStrip)
  || /state\.tabs\.length < 2/.test(renderTabStrip)) {
  throw new Error('one retained tab must stay visible after side close so it can be dragged back into a pane');
}

if (!/function reorderTabs\(/.test(multiChat) || !/state\.tabs\.splice\(to,\s*0,\s*tab\)/.test(multiChat)) {
  throw new Error('chat tabs must support drag reordering');
}
if (!/function allSourceTabs\(\)/.test(multiChat) || !/return state\.tabs\.slice\(\)/.test(multiChat)) {
  throw new Error('Sources selector must include every explicitly open tab and no incidental sidebar navigation');
}
if (!/showSourceSelector\(\{ openDrawerAfter: kind === 'drawer' \}\)/.test(multiChat)) {
  throw new Error('opening the Sources drawer without a selected chat must force the chat selector first');
}
if (!/__PROM_SOURCE_PANEL_SELECTED_SESSION_ID/.test(multiChat) || !/__PROM_SOURCE_PANEL_SELECTED_SESSION_ID/.test(sourceContext)) {
  throw new Error('selected Sources context must remain bound to the chosen tab even when another main chat is visible');
}

const embeddedIsolation = extractFunction(multiChat, 'function isolateEmbeddedChatSurface()', 'function installEmbeddedSidePane');
if (!/parent\.children/.test(embeddedIsolation)
  || !/sibling\.style\.setProperty\('display', 'none', 'important'\)/.test(embeddedIsolation)
  || !/node = parent/.test(embeddedIsolation)) {
  throw new Error('embedded side chat must structurally hide every app-shell sibling up to body');
}
const embeddedInstall = extractFunction(multiChat, 'function installEmbeddedSidePane()', 'export function installMultiChatWorkspace');
if (!/isolateEmbeddedChatSurface\(\)/.test(embeddedInstall)
  || !/MutationObserver\(\(\) => isolateEmbeddedChatSurface\(\)\)/.test(embeddedInstall)) {
  throw new Error('embedded side chat isolation must survive shell rerenders');
}
if (!/multiChatPane/.test(multiChat) || !/prom-multi-chat-embedded-side/.test(multiChat)) {
  throw new Error('the side pane must run an isolated real chat surface without recursively spawning multi-chat chrome');
}

const parityWidth = String.raw`width:\s*min\(var\(--chat-content-max-width\),\s*calc\(100%\s*-\s*var\(--chat-content-inline-gutter\)\s*-\s*var\(--chat-content-inline-gutter\)\)\)\s*!important`;
if (!(new RegExp(parityWidth)).test(multiChatCss)) {
  throw new Error('side composers must consume the same shared width contract as the main composer');
}
const sideParityBlock = multiChatCss.match(/body:not\(\.pm-mobile-active\) \.side-chat-composer\.chat-input-area,[\s\S]*?\{([\s\S]*?)\}/)?.[1] || '';
if (/760px|52px/.test(sideParityBlock)) {
  throw new Error('side composer parity must not reintroduce the legacy 760px / 52px geometry');
}

console.log('desktop chat layout contract: explicit-only tabs, dedupe, retained-tab pane drag/drop, shell-isolated side chat, scoped Sources, and composer parity ok');
