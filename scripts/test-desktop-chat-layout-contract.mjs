import fs from 'node:fs';

const paths = {
  base: 'web-ui/src/styles/base.css',
  components: 'web-ui/src/styles/components.css',
  chat: 'web-ui/src/pages/ChatPage.js',
  multiChatIntent: 'web-ui/src/features/chat/multi-chat-intent.js',
  multiChat: 'web-ui/src/features/chat/multi-chat-workspace-v2.js',
  multiChatCss: 'web-ui/src/styles/multi-chat-workspace.css',
  themes: 'web-ui/src/styles/themes.css',
  performance: 'web-ui/src/performance.js',
  sourceContext: 'web-ui/src/source-panel-context.js',
  generatedBase: 'generated/public-web-ui/static/styles/base.css',
  generatedComponents: 'generated/public-web-ui/static/styles/components.css',
  generatedChat: 'generated/public-web-ui/static/pages/ChatPage.js',
  generatedMultiChatIntent: 'generated/public-web-ui/static/features/chat/multi-chat-intent.js',
  generatedMultiChat: 'generated/public-web-ui/static/features/chat/multi-chat-workspace-v2.js',
  generatedMultiChatCss: 'generated/public-web-ui/static/styles/multi-chat-workspace.css',
  generatedThemes: 'generated/public-web-ui/static/styles/themes.css',
  generatedPerformance: 'generated/public-web-ui/static/performance.js',
  generatedSourceContext: 'generated/public-web-ui/static/source-panel-context.js',
};

const read = (path) => fs.readFileSync(path, 'utf8');
const sourceBase = read(paths.base);
const sourceComponents = read(paths.components);
const sourceChat = read(paths.chat);
const multiChatIntent = read(paths.multiChatIntent);
const multiChat = read(paths.multiChat);
const multiChatCss = read(paths.multiChatCss);
const themes = read(paths.themes);
const performance = read(paths.performance);
const sourceContext = read(paths.sourceContext);
const generatedBase = read(paths.generatedBase);
const generatedComponents = read(paths.generatedComponents);
const generatedChat = read(paths.generatedChat);
const generatedMultiChatIntent = read(paths.generatedMultiChatIntent);
const generatedMultiChat = read(paths.generatedMultiChat);
const generatedMultiChatCss = read(paths.generatedMultiChatCss);
const generatedThemes = read(paths.generatedThemes);
const generatedPerformance = read(paths.generatedPerformance);
const generatedSourceContext = read(paths.generatedSourceContext);

if (sourceBase !== generatedBase) throw new Error('base.css source/generated copies are out of sync');
if (sourceComponents !== generatedComponents) throw new Error('components.css source/generated copies are out of sync');
if (sourceChat !== generatedChat) throw new Error('ChatPage.js source/generated copies are out of sync');
if (multiChatIntent !== generatedMultiChatIntent) throw new Error('multi-chat intent source/generated copies are out of sync');
if (multiChat !== generatedMultiChat) throw new Error('multi-chat v2 workspace source/generated copies are out of sync');
if (multiChatCss !== generatedMultiChatCss) throw new Error('multi-chat workspace styles source/generated copies are out of sync');
if (themes !== generatedThemes) throw new Error('themes.css source/generated copies are out of sync');
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

const toggleCanvasFullscreen = extractFunction(sourceChat, 'function toggleCanvasFullscreen()', 'function setCanvasEditorValue');
if (!/panel\.style\.position\s*=\s*'fixed'/.test(toggleCanvasFullscreen)
  || !/electron-shell/.test(toggleCanvasFullscreen)
  || !/--window-chrome-height/.test(toggleCanvasFullscreen)
  || !/panel\.style\.inset\s*=\s*electronTitlebarInset/.test(toggleCanvasFullscreen)) {
  throw new Error('Electron Canvas fullscreen must preserve the native titlebar inset');
}

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

// The panel-icon button in the Sources header opens the docked right-side Canvas
// (files/browser). It used to minimize Sources into the floating peek.
const indexHtml = read('web-ui/index.html');
const topbarHtml = indexHtml.match(/<div id="right-panel-topbar"[\s\S]*?<\/div>\s*<!--/)?.[0] || '';
const openCanvasBtn = topbarHtml.match(/<button id="right-panel-open-canvas"[^>]*>/)?.[0] || '';
if (!openCanvasBtn || !/onclick="toggleCanvas\(true\)"/.test(openCanvasBtn)) {
  throw new Error('Sources header panel button must open the docked Canvas with toggleCanvas(true)');
}
if (/source/i.test(openCanvasBtn.replace(/class="[^"]*"/, ''))) {
  throw new Error('Canvas opener id/label must not contain "source" or the split-chat Sources picker intercepts it');
}
if (/showSourcesMinimizedPanel|Minimize sources/.test(topbarHtml)) {
  throw new Error('Sources header must not offer a minimize-to-peek button');
}

const miniItems = extractFunction(sourceChat, 'function sourcePanelMiniItems(', 'function toggleSourcePanelMiniFilter');
if (!/data\.recent/.test(miniItems) || !/data\.gitItems/.test(miniItems)) {
  throw new Error('populated Sources state must continue to use minimized source items');
}

// Intent activation is exercised behaviorally by
// test-chat-optional-ownership.mjs. This ownership check ensures the desktop
// entry cannot bypass the lightweight intent module and eagerly load a full
// workspace controller.
if (!/import\('\.\/features\/chat\/multi-chat-intent\.js'\)/.test(performance)
  || /import\('\.\/features\/chat\/multi-chat-workspace(?:-v2)?\.js'\)/.test(performance)) {
  throw new Error('desktop boot must select the lightweight multi-chat intent owner');
}
if (!/import\('\.\/multi-chat-workspace-v2\.js'\)/.test(multiChatIntent)
  || /import\('\.\/multi-chat-workspace\.js'\)/.test(multiChatIntent)) {
  throw new Error('multi-chat intent must select only the corrected v2 workspace');
}
if (!/prometheus_multi_chat_tabs_v3/.test(multiChat) || !/MAX_TABS\s*=\s*30/.test(multiChat)) {
  throw new Error('native multi-chat tabs need a clean persisted state namespace');
}
if (!/DRAG_MIME\s*=\s*'application\/x-prometheus-chat'/.test(multiChat)) {
  throw new Error('sidebar/tab drag and drop must use the desktop chat transfer contract');
}

const addExplicitTab = extractFunction(multiChat, 'function addExplicitTab(', 'function closeNativeSideIfOwned');
if (!/state\.tabs\.find\(\(tab\) => tab\.sessionId === sid\)/.test(addExplicitTab)
  || !/if \(existing\)/.test(addExplicitTab)
  || !/state\.tabs\.push\(/.test(addExplicitTab)) {
  throw new Error('explicit tab enrollment must dedupe by session id');
}

const syncMainSession = extractFunction(multiChat, 'function syncMainSession()', 'function render()');
if (/addExplicitTab\(|state\.tabs\.push\(/.test(syncMainSession) || !/placeMainTab\(sid, previous\)/.test(syncMainSession)) {
  throw new Error('sidebar navigation must go through placeMainTab (reuse the current tab), not append a tab directly');
}
if (!/state\.mainSessionId = sid/.test(syncMainSession) || !/renderTabStrip\(\)/.test(syncMainSession)) {
  throw new Error('main-session changes must update the visible main-session marker');
}
const placeMainTab = extractFunction(multiChat, 'function placeMainTab(', 'function tabNeighborAfterClose');
if (!/consumeNewTabIntent\(sid\)/.test(placeMainTab) || !/canNavigateTabAway\(prev\)/.test(placeMainTab)
  || !/state\.tabs\[prevIndex\] = tab/.test(placeMainTab)) {
  throw new Error('browser-style tabs: navigation replaces the idle current tab; New chat / Ctrl-click open a new tab');
}
if (!/!isSessionRunning\(sid\)/.test(extractFunction(multiChat, 'function canNavigateTabAway(', 'function placeMainTab'))) {
  throw new Error('navigation must never replace a tab whose chat is still working');
}
if (!/dispatchDesktopChatLifecycle\('chat-new-tab-intent'/.test(sourceChat)
  || !/window\.reopenDesktopDraftChatSession = reopenDesktopDraftChatSession/.test(sourceChat)) {
  throw new Error('New chat must announce a new tab and unsent draft tabs must be re-openable');
}

const activateMain = extractFunction(multiChat, 'function activateMain(', 'function openSide');
const openSide = extractFunction(multiChat, 'function openSide(', 'function closeSide');
if (!/addExplicitTab\(sid, title\)/.test(activateMain) || !/addExplicitTab\(sid, title\)/.test(openSide)) {
  throw new Error('drag/drop pane activation must explicitly enroll the dragged session as a tab');
}
if (!/ensureMainTab\(mainId/.test(openSide)) {
  throw new Error('opening a side chat must enroll the current main chat as a tab too');
}
if (!/revealNativeSide\(\)/.test(openSide) || !/refreshNativeSideSession\(sid\)/.test(openSide)) {
  throw new Error('opening the side pane must use the native split immediately and hydrate that existing session in place');
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
const renderTabStrip = extractFunction(multiChat, 'function renderTabStrip()', 'function allSourceTabs');
if (!/strip\.hidden = state\.tabs\.length === 0/.test(renderTabStrip)
  || /state\.tabs\.length < 2/.test(renderTabStrip)) {
  throw new Error('one retained tab must stay visible after side close so it can be dragged back into a pane');
}
if (/prom-multi-chat-tab-role/.test(renderTabStrip) || />Side chat</.test(renderTabStrip) || />Main chat</.test(renderTabStrip)) {
  throw new Error('tabs must display the session title only, never MAIN CHAT or SIDE CHAT labels');
}

const nativeLink = extractFunction(multiChat, 'function ensureNativeSideLink(', 'function syncSplitBodyClass');
if (!/window\.sideChatLinks/.test(nativeLink)
  || !/parentSessionId/.test(nativeLink)
  || !/__promMultiChatTab/.test(nativeLink)) {
  throw new Error('multi-chat must bind existing sessions into the native side-chat link model');
}
const nativeReveal = extractFunction(multiChat, 'function revealNativeSide(', 'async function refreshNativeSideSession');
if (!/window\.showSideChatSplit\(sid\)/.test(nativeReveal)) {
  throw new Error('multi-chat side rendering must reuse ChatPage showSideChatSplit instead of a separate surface');
}
const nativeHydrate = extractFunction(multiChat, 'async function refreshNativeSideSession(', 'function activateMain');
if (!/window\._loadSessionFromServer\(sid/.test(nativeHydrate)) {
  throw new Error('native side sessions must hydrate existing chat history without navigating the main pane');
}

if (/<iframe\b/i.test(multiChat)
  || /sideFrameUrl/.test(multiChat)
  || /multiChatPane/.test(multiChat)
  || /prom-multi-chat-embedded-side/.test(multiChat)) {
  throw new Error('multi-chat must not use an iframe or an embedded second app runtime');
}
if (/prom-multi-chat-side-pane|prom-multi-chat-side-frame|prom-multi-chat-embedded-side/.test(multiChatCss)) {
  throw new Error('multi-chat CSS must not carry iframe-side-pane chrome');
}

const sessionMeta = extractFunction(multiChat, 'function sessionMeta(', 'function titleForSession');
if (!/projectName/.test(sessionMeta) || !/canvasProjectLabel/.test(sessionMeta)) {
  throw new Error('multi-chat session headers must retain project metadata from normal chat sessions');
}
// Pane headers are rendered once by ChatPage (no post-render patching that
// fights keyed reconciliation): chat-tab panes show the chat title plus its
// project, true side chats keep "Side chat · parent".
if (/function patchPaneHeader\(|function patchNativeSplitHeaders\(/.test(multiChat)) {
  throw new Error('multi-chat must not patch native split headers after render');
}
const sidePaneRenderer = extractFunction(sourceChat, 'function renderSideChatPaneHtml(', 'function renderBackgroundAgentSidePaneHtml');
if (!/const multiChat = isMultiChatSideLink\(link\)/.test(sidePaneRenderer)
  || !/multiChat \? desktopSplitPaneKicker\(side\) : `Side chat · \$\{parentTitle\}`/.test(sidePaneRenderer)) {
  throw new Error('chat-tab side panes must not be labelled as a child of the left chat');
}
if (!/if \(isMultiChatSideLink\(link\)\) \{\s*return String\(link\.id \|\| ''\) !== String\(window\.activeChatSessionId \|\| ''\) \? link : null;/.test(sourceChat)) {
  throw new Error('a chat-tab right pane must survive left-tab switches');
}
if (!/const splitMainEmpty = splitActive/.test(sourceChat) || !/splitMainEmpty \? renderSplitPaneWelcomeHtml\(projectWelcome\)/.test(sourceChat)) {
  throw new Error('a new chat on the left of a split must render its landing page, not a blank pane');
}
if (!/prom-multi-chat-native-split/.test(multiChatCss)) {
  throw new Error('native multi-chat split styling is missing');
}
if (!/body:not\(\.pm-mobile-active\) #chat-view > #chat-messages\.side-chat-split-shell \{\s*padding: 0 !important;/.test(sourceComponents)) {
  throw new Error('split panes must ignore theme clearance padding so both composers line up');
}
if (!/\.main-shell:has\(> \.prom-multi-chat-tabs:not\(\[hidden\]\)\) > #chat-context-header/.test(multiChatCss)
  || /:has\(\.prom-multi-chat-tabs:not\(\[hidden\]\)\) #chat-messages/.test(multiChatCss)) {
  throw new Error('chat tabs must replace the context header above the native main/side headers');
}
const tabHeaderRules = themes.match(/body:not\(\.pm-mobile-active\):not\(\.electron-shell\) \.main-shell-wrap:has\(> \.topbar \+ \.main-shell > \.prom-multi-chat-tabs:not\(\[hidden\]\)\)[\s\S]*?(?=\/\* Give the jump-to-message rail)/)?.[0] || '';
if (!tabHeaderRules
  || !/\.topbar\s*\{[\s\S]*?height:\s*0\s*!important/.test(tabHeaderRules)
  || !/\.topbar-left\s*\{[\s\S]*?display:\s*none\s*!important/.test(tabHeaderRules)
  || !/\.topbar-right\s*\{[\s\S]*?position:\s*absolute/.test(tabHeaderRules)) {
  throw new Error('browser tab placement must not collapse the Electron shared header');
}
if (/body:not\(\.pm-mobile-active\) \.main-shell-wrap:has\(> \.topbar \+ \.main-shell > \.prom-multi-chat-tabs:not\(\[hidden\]\)\) > \.topbar/.test(themes)) {
  throw new Error('multi-chat tabs must not change the Electron topbar geometry');
}

if (!/function reorderTabs\(/.test(multiChat) || !/state\.tabs\.splice\(to,\s*0,\s*tab\)/.test(multiChat)) {
  throw new Error('chat tabs must support drag reordering');
}
const allSourceTabs = extractFunction(multiChat, 'function allSourceTabs()', 'function showSourceSelector');
if (!/currentMainSessionId\(\)/.test(allSourceTabs) || !/nativeSideOpenFor\(state\.sideSessionId\)/.test(allSourceTabs)) {
  throw new Error('Sources selector must offer exactly the two visible panes; tabs in the background follow normal chat sources');
}
if (!/function clearSourceSelection\(\)/.test(multiChat) || !/globalThis\.__PROM_SOURCE_PANEL_SELECTED_SESSION_ID = ''/.test(multiChat)) {
  throw new Error('closing the split or switching chats must release the pinned Sources chat');
}
if (!/showSourceSelector\(\{ openDrawerAfter: kind === 'drawer' \}\)/.test(multiChat)) {
  throw new Error('opening the Sources drawer without a selected chat must force the chat selector first');
}
if (!/__PROM_SOURCE_PANEL_SELECTED_SESSION_ID/.test(multiChat) || !/__PROM_SOURCE_PANEL_SELECTED_SESSION_ID/.test(sourceContext)) {
  throw new Error('selected Sources context must remain bound to the chosen tab even when another main chat is visible');
}

const parityWidth = String.raw`width:\s*min\(var\(--chat-content-max-width\),\s*calc\(100%\s*-\s*var\(--chat-content-inline-gutter\)\s*-\s*var\(--chat-content-inline-gutter\)\)\)\s*!important`;
if (!(new RegExp(parityWidth)).test(multiChatCss)) {
  throw new Error('side composers must consume the same shared width contract as the main composer');
}
const sideParityBlock = multiChatCss.match(/body:not\(\.pm-mobile-active\) \.side-chat-composer\.chat-input-area,[\s\S]*?\{([\s\S]*?)\}/)?.[1] || '';
if (/760px|52px/.test(sideParityBlock)) {
  throw new Error('side composer parity must not reintroduce the legacy 760px / 52px geometry');
}

// Docked Canvas can leave a ~400px chat column. Its gutters must scale with the
// column (cqw), not the window (vw), and must not keep 24px/48px floors, or the
// composer collapses to ~180px and wraps its placeholder (Nov 25 2026).
const canvasOpenBlocks = [...themes.matchAll(/body:not\(\.pm-mobile-active\):not\(\.side-chat-split-active\)\.right-canvas-open #chat-view \{([\s\S]*?)\}/g)].map(m => m[1]);
const surfaceGutterDecls = canvasOpenBlocks.flatMap(b => b.match(/--chat-surface-gutter:[^;]*/g) || []);
const inlineGutterDecls = canvasOpenBlocks.flatMap(b => b.match(/--chat-content-inline-gutter:[^;]*/g) || []);
if (!surfaceGutterDecls.length || !inlineGutterDecls.length) {
  throw new Error('Canvas-open chat column must declare its surface and inline gutters');
}
for (const decl of [...surfaceGutterDecls, ...inlineGutterDecls]) {
  const floor = Number(decl.match(/clamp\(\s*(\d+)px/)?.[1] ?? NaN);
  if (/\dvw\b/.test(decl) || !/cqw/.test(decl) || !(floor <= 16)) {
    throw new Error(`Canvas-open gutters must be column-relative (cqw) with a floor <= 16px: ${decl.trim()}`);
  }
}
// The new-chat composer stays 12px wider than the "Directed chat" shelf
// (min(708px, 100% - 72px)) at every column width, Canvas open or not.
if (!/body:not\(\.pm-mobile-active\):not\(\.side-chat-split-active\) #chat-view\.chat-empty:not\(\.desktop-voice-mode\) \{\s*--chat-column-width:\s*min\(720px,\s*calc\(100% - 60px\)\)\s*!important;/.test(themes)
  || !/#chat-view > \.chat-new-context-dock \{[\s\S]*?width:\s*min\(708px,\s*calc\(100% - 72px\)\)/.test(sourceComponents)) {
  throw new Error('empty-chat composer must track the Directed chat shelf width (shelf + 12px)');
}


console.log('desktop chat layout contract: browser-style tabs, native split reuse, no iframe runtime, native pane headers, split-scoped Sources, and composer parity ok');
