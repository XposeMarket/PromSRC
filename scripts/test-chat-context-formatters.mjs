import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as formatters from '../web-ui/src/chat-context-formatters.js';
import { execFileSync } from 'node:child_process';
const source=execFileSync('git',['show','8430e9502:web-ui/src/pages/ChatPage.js'],{encoding:'utf8',maxBuffer:10000000});
const start=source.indexOf('function formatContextDurationLabel(value) {');
const end=source.indexOf('\nfunction setChatContextWindowLoading(',start);
const original=source.slice(start,end);
const actual=fs.readFileSync(new URL('../web-ui/src/chat-context-formatters.js',import.meta.url),'utf8').replace(/^export function /gm,'function ').trim();
assert.equal(actual,original.trim(),'lossless source extraction');
const old={}; vm.createContext(old); vm.runInContext(original,old);
for(const value of [null,undefined,-1,0,1,999,1000,9999,60000,61000,1000000,NaN,Infinity,'2500']) {
 assert.equal(formatters.formatContextDurationLabel(value),old.formatContextDurationLabel(value));
 assert.equal(formatters.formatContextTokenCount(value),old.formatContextTokenCount(value));
 for(const calls of [0,1,5]) {const tool={durationMsMax:value,calls};assert.equal(formatters.formatContextToolDurationSuffix(tool),old.formatContextToolDurationSuffix(tool));}
}
console.log('PASS pure context formatters: lossless extraction and boundary parity');
