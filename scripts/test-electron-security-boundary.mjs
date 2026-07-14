import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const require = createRequire(import.meta.url);
const {
  isTrustedRendererUrl,
  normalizeEmbeddedBrowserUrl,
  normalizeExternalUrl,
  parseWindowsListeningPids,
} = require(path.join(root, 'electron', 'security.js'));

const gateway = 'http://127.0.0.1:18789';
assert.equal(isTrustedRendererUrl(`${gateway}/chat?session=ok#turn`, gateway), true);
for (const candidate of [
  'http://127.0.0.1:18789@evil.example/',
  'http://user:pass@127.0.0.1:18789/',
  'http://127.0.0.1:18790/',
  'https://127.0.0.1:18789/',
  'http://localhost:18789/',
  'file:///C:/Prometheus/index.html',
  'data:text/html,owned',
  'not a url',
]) assert.equal(isTrustedRendererUrl(candidate, gateway), false, candidate);

assert.equal(normalizeExternalUrl('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
for (const candidate of ['http://example.com', 'file:///tmp/a', 'javascript:alert(1)', 'mailto:test@example.com', 'https://u:p@example.com/']) {
  assert.equal(normalizeExternalUrl(candidate), null, candidate);
}

assert.equal(normalizeEmbeddedBrowserUrl('example.com'), 'https://example.com/');
assert.equal(normalizeEmbeddedBrowserUrl('http://example.com/a'), 'http://example.com/a');
assert.equal(normalizeEmbeddedBrowserUrl('about:blank'), 'about:blank');
for (const candidate of ['file:///C:/secret.txt', 'data:text/html,owned', 'javascript:alert(1)', 'https://u:p@example.com/']) {
  assert.throws(() => normalizeEmbeddedBrowserUrl(candidate), undefined, candidate);
}

const netstat = [
  '  TCP    127.0.0.1:18789      0.0.0.0:0       LISTENING       4242',
  '  TCP    [::1]:18789          [::]:0          LISTENING       4242',
  '  TCP    127.0.0.1:187890     0.0.0.0:0       LISTENING       9999',
  '  UDP    0.0.0.0:18789        *:*                            7777',
].join('\r\n');
assert.deepEqual(parseWindowsListeningPids(netstat, 18789), [4242]);

const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
assert.doesNotMatch(mainSource, /url\.startsWith\(GATEWAY_URL\)/);
assert.doesNotMatch(mainSource, /killPortIfInUse/);
assert.match(mainSource, /assertGatewayPortAvailable\(18789\)/);
assert.equal((mainSource.match(/ipcMain\.handle\(/g) || []).length, 1, 'all privileged invoke handlers must register through handleTrustedMain');
for (const channel of ['get-app-version', 'select-canvas-paths', 'native-browser:navigate', 'native-browser:teach-capture', 'updater:install']) {
  assert.match(mainSource, new RegExp(`handleTrustedMain\\('${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
}
assert.match(mainSource, /event\.sender !== mainWindow\.webContents/);
assert.match(mainSource, /event\.senderFrame !== event\.sender\.mainFrame/);
assert.match(mainSource, /view\.webContents !== event\.sender/);

const sent = [];
const ipcListeners = new Map();
const domListeners = new Map();
const ipcRenderer = {
  on(channel, fn) { ipcListeners.set(channel, fn); },
  send(channel, payload) { sent.push({ channel, payload }); },
};
const fakeWindow = {
  CSS: { escape: (value) => String(value) },
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener(type, fn) { domListeners.set(type, fn); },
};
const preloadSource = fs.readFileSync(path.join(root, 'electron', 'inhouse-browser-preload.js'), 'utf8');
const context = vm.createContext({
  console: { log() {} },
  window: fakeWindow,
  setTimeout,
  clearTimeout,
});
new vm.Script(`(function(require){${preloadSource}\n})`)
  .runInContext(context)((name) => {
    if (name === 'electron') return { ipcRenderer };
    throw new Error(`Unexpected require: ${name}`);
  });
ipcListeners.get('prometheus-teach-capture')({}, true);

function element({ type = 'text', name = '', value = '', autocomplete = '', placeholder = '' } = {}) {
  const attrs = { type, name, autocomplete, placeholder };
  return {
    nodeType: 1,
    tagName: 'INPUT',
    id: '',
    value,
    innerText: '',
    isContentEditable: false,
    parentElement: null,
    getAttribute(key) { return attrs[key] || ''; },
    getBoundingClientRect() { return { left: 1, top: 2, width: 100, height: 20 }; },
  };
}

const password = element({ type: 'password', name: 'password', value: 'never-record-me' });
domListeners.get('input')({ isTrusted: true, target: password });
domListeners.get('blur')({ isTrusted: true, target: password });
domListeners.get('click')({ isTrusted: true, target: password, button: 0, clientX: 5, clientY: 6 });
assert.equal(sent.some((entry) => JSON.stringify(entry).includes('never-record-me')), false);
assert.equal(sent.some((entry) => entry.channel === 'prometheus-teach-fill'), false);
assert.equal(sent.at(-1).payload.label, 'Sensitive field');
assert.equal(sent.at(-1).payload.text, '');

const recovery = element({ name: 'recovery_code', value: 'secret-recovery-code' });
domListeners.get('input')({ isTrusted: true, target: recovery });
domListeners.get('blur')({ isTrusted: true, target: recovery });
assert.equal(sent.some((entry) => JSON.stringify(entry).includes('secret-recovery-code')), false);

const normal = element({ name: 'display_name', value: 'Ada Lovelace' });
domListeners.get('input')({ isTrusted: true, target: normal });
domListeners.get('blur')({ isTrusted: true, target: normal });
assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), {
  channel: 'prometheus-teach-fill',
  payload: {
    selector: 'input',
    text: 'Ada Lovelace',
    label: 'display_name',
    tagName: 'input',
    role: '',
    bounds: { x: 1, y: 2, width: 100, height: 20 },
  },
});

const beforeSynthetic = sent.length;
const synthetic = element({ name: 'display_name', value: 'synthetic' });
domListeners.get('input')({ isTrusted: false, target: synthetic });
domListeners.get('blur')({ isTrusted: false, target: synthetic });
assert.equal(sent.length, beforeSynthetic);

console.log('Electron security boundary regression tests passed.');
