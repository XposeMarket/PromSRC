import fs from 'node:fs';

const source = fs.readFileSync('web-ui/index.html', 'utf8');

const getSessionSortTime = source.match(/function getSessionSortTime\(s\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
if (!/const sidebarOrder = Number\(s\?\.sidebarOrder\)/.test(getSessionSortTime)
  || !/if \(Number\.isFinite\(sidebarOrder\)\) return sidebarOrder/.test(getSessionSortTime)
  || !/const activity = getSessionLastMessageAt\(s\)/.test(getSessionSortTime)
  || !/return activity \* 1000/.test(getSessionSortTime)) {
  throw new Error('new chats must use the same precision as persisted manual sidebar ranks');
}

if (!/function setLocalSidebarOrder\(sessionIds\)[\s\S]*?Date\.now\(\) \* 1000/.test(source)) {
  throw new Error('manual sidebar ranks no longer document their millisecond*1000 precision');
}

console.log('desktop sidebar session order contract: fresh chats share the manual-rank precision and sort immediately');
