import fs from 'node:fs';

const paths = {
  base: 'web-ui/src/styles/base.css',
  components: 'web-ui/src/styles/components.css',
  chat: 'web-ui/src/pages/ChatPage.js',
  generatedBase: 'generated/public-web-ui/static/styles/base.css',
  generatedComponents: 'generated/public-web-ui/static/styles/components.css',
  generatedChat: 'generated/public-web-ui/static/pages/ChatPage.js',
};

const read = (path) => fs.readFileSync(path, 'utf8');
const sourceBase = read(paths.base);
const sourceComponents = read(paths.components);
const sourceChat = read(paths.chat);
const generatedBase = read(paths.generatedBase);
const generatedComponents = read(paths.generatedComponents);
const generatedChat = read(paths.generatedChat);

if (sourceBase !== generatedBase) throw new Error('base.css source/generated copies are out of sync');
if (sourceComponents !== generatedComponents) throw new Error('components.css source/generated copies are out of sync');
if (sourceChat !== generatedChat) throw new Error('ChatPage.js source/generated copies are out of sync');

const minimizedCenter = sourceBase.match(/body:not\(\.pm-mobile-active\)\.sources-minimized-open \.workspace > \.center-col\s*\{([\s\S]*?)\}/)?.[1] || '';
if (/margin-right\s*:/.test(minimizedCenter) || /--sources-minimized-layout-reserve/.test(sourceBase)) {
  throw new Error('minimized Sources must float without reserving a background drawer strip');
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

console.log('desktop chat layout contract: ok');
