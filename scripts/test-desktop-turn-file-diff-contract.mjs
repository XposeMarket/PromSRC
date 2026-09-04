import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const turnDiff = read('web-ui/src/features/chat/desktop-turn-file-diff.js');
const generatedTurnDiff = read('generated/public-web-ui/static/features/chat/desktop-turn-file-diff.js');
const chatPage = read('web-ui/src/pages/ChatPage.js');
const generatedChatPage = read('generated/public-web-ui/static/pages/ChatPage.js');

if (turnDiff !== generatedTurnDiff) {
  throw new Error('desktop turn-file diff source/generated copies are out of sync');
}
if (chatPage !== generatedChatPage) {
  throw new Error('ChatPage source/generated copies are out of sync');
}

const openTurnFileDiff = turnDiff.match(/export function openTurnFileDiff\([\s\S]*?\n\}/)?.[0] || '';
if (!/window\.canvasPresentFile\s*\(/.test(openTurnFileDiff)
  || !/openMode:\s*'diff'/.test(openTurnFileDiff)
  || !/diffView:\s*'turn'/.test(openTurnFileDiff)
  || /window\.openCodingWorkspace\s*\(/.test(openTurnFileDiff)) {
  throw new Error('end-of-turn file rows must open the existing Canvas diff surface');
}

const fileChangeRow = chatPage.match(/function renderFileChangeRow\([\s\S]*?\n\}/)?.[0] || '';
if (!/const openDiffArgs = canOpen/.test(fileChangeRow)
  || !/openMode: 'diff'/.test(fileChangeRow)
  || !/\$\{openDiffArgs\}/.test(fileChangeRow)
  || !/data-turn-file-path/.test(fileChangeRow)
  || !/data-turn-file-label/.test(fileChangeRow)) {
  throw new Error('end-of-turn file rows must request Diff directly from their Canvas handler');
}

if (!/row\.dataset\?\.turnFilePath/.test(read('web-ui/src/performance.js'))) {
  throw new Error('the optional turn-diff listener must not cancel explicit Canvas Diff rows');
}

if (!/id="canvas-diff-btn"/.test(read('web-ui/index.html'))
  || !/id="canvas-diff-wrap"/.test(read('web-ui/index.html'))
  || !/function renderCanvasDiffInto\(/.test(chatPage)
  || !/\/api\/coding\/diff\?/.test(chatPage)
  || !/tab\.openMode === 'diff'/.test(chatPage)) {
  throw new Error('Canvas must expose a turn-scoped diff surface for opened files');
}

console.log('desktop turn-file diff contract: end-of-turn rows reuse Canvas Diff and keep the modal out of the chat flow');
