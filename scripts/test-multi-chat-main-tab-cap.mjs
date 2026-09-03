import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.join(process.cwd(), 'web-ui', 'src', 'features', 'chat', 'multi-chat-workspace-v2.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const match = source.match(/function ensureMainTab\([\s\S]*?\n}\n\nfunction closeNativeSideIfOwned/);
if (!match) throw new Error('ensureMainTab implementation not found');
const block = match[0];
if (!/state\.tabs\.unshift\(/.test(block)) throw new Error('ensureMainTab must prepend the current main tab');
if (!/state\.tabs\.splice\(MAX_TABS\)/.test(block)) {
  throw new Error('ensureMainTab must trim from the tail so a newly prepended main survives the 30-tab cap');
}
if (/state\.tabs\.splice\(0,\s*state\.tabs\.length\s*-\s*MAX_TABS\)/.test(block)) {
  throw new Error('ensureMainTab must not trim from index 0 after prepending the main tab');
}

const full = Array.from({ length: 30 }, (_, index) => `tab-${index}`);
full.unshift('current-main');
full.splice(30);
if (full.length !== 30 || full[0] !== 'current-main' || full.includes('tab-29')) {
  throw new Error('30-tab cap simulation must preserve current main and evict from the tail');
}

console.log('multi-chat main-tab cap regression passed');
