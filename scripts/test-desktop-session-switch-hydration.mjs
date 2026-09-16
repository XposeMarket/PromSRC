import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../web-ui/src/pages/ChatPage.js', import.meta.url), 'utf8');
const generated = fs.readFileSync(new URL('../generated/public-web-ui/static/pages/ChatPage.js', import.meta.url), 'utf8');

for (const text of [source, generated]) {
  assert.match(text, /const desktopSessionLoadStates = new Map\(\)/,
    'desktop session loading must have per-session failure state');
  assert.match(text, /function renderDesktopSessionLoadNotice\(session/,
    'a failed desktop session load must render an explicit notice');
  assert.match(text, /class="chat-session-load-retry"/,
    'failed desktop session loads must expose a retry action');
  assert.match(text, /function hydrateStoredSessionStubForOpen\(session\)/);
  assert.match(text, /Object\.defineProperty\(stub, '_startupCachedSession',[\s\S]{0,180}enumerable: false/,
    'startup snapshot must survive in memory without bloating persistence');
  assert.match(text, /const cached = session\._startupCachedSession/);
  assert.match(text, /const stored = parsed\.find\(\(entry\) => String\(entry\?\.id \|\| ''\) === String\(session\.id \|\| ''\)\)/);
  assert.match(text, /hydrateStoredSessionStubForOpen\(sess\);[\s\S]{0,500}syncActiveChat\(\);/,
    'a selected desktop session must hydrate before its first paint');
  assert.match(text, /fetchJsonWithTimeout\([\s\S]{0,240}\/api\/sessions\/\$\{encodeURIComponent\(id\)\}[\s\S]{0,180}10000[\s\S]{0,120}throwOnHttpError: true/,
    'desktop history loading must allow long local sessions to respond');
  assert.match(text, /setDesktopSessionLoadState\(id, 'error'/,
    'session-load failures must retain an explicit error state');
  assert.match(text, /window\.prometheusGateway\?\.restart/,
    'desktop retry must be able to recover a failed Electron gateway');
  assert.match(text, /Could not load session \$\{id\} from the server/,
    'session-load failures must remain observable');
  const startupStart = text.indexOf('async function loadChatSessions()');
  const startupBlock = text.slice(startupStart, text.indexOf('function getSessionLastMessageAt', startupStart));
  assert.ok(startupBlock.indexOf('syncActiveChat();') < startupBlock.indexOf('fetchChatSessionSummariesWithRetry()'),
    'desktop startup must paint cached chat state before waiting for summaries');
  assert.match(text, /if \(startupGeneration !== desktopSessionOpenGeneration\) return;/,
    'a stale desktop startup must not replace a user-selected chat');
  assert.doesNotMatch(text, /const pending = desktopSessionOpenRequests\.get\(sessionId\)/,
    'a pending history request must not swallow a later navigation click');
  assert.match(text, /const generation = \+\+desktopSessionOpenGeneration;\s*return _openSession\(sessionId, generation\);/,
    'every desktop session click must receive fresh navigation ownership');
}

console.log('desktop session-switch hydration regression passed');
