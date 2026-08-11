import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const require = createRequire(import.meta.url);
const {
  isLocalGatewayUrl,
  isTrustedRendererUrl,
  normalizeEmbeddedBrowserUrl,
  normalizeExternalUrl,
  normalizePassthroughExternalUrl,
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

assert.equal(isLocalGatewayUrl('http://localhost:18789/chat', gateway), true);
assert.equal(isLocalGatewayUrl('http://127.0.0.1:18790/chat', gateway), false);
assert.equal(normalizeExternalUrl('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
assert.equal(normalizeExternalUrl('http://example.com/docs?q=1'), 'http://example.com/docs?q=1');
for (const candidate of ['file:///tmp/a', 'javascript:alert(1)', 'mailto:test@example.com', 'https://u:p@example.com/']) {
  assert.equal(normalizeExternalUrl(candidate), null, candidate);
}
assert.equal(normalizePassthroughExternalUrl('mailto:test@example.com'), 'mailto:test@example.com');
assert.equal(normalizePassthroughExternalUrl('tel:+15551212'), 'tel:+15551212');
assert.equal(normalizePassthroughExternalUrl('javascript:alert(1)'), null);

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
const desktopPreloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const settingsPageSource = fs.readFileSync(path.join(root, 'web-ui', 'src', 'pages', 'SettingsPage.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(root, 'web-ui', 'index.html'), 'utf8');
const chatSource = fs.readFileSync(path.join(root, 'web-ui', 'src', 'pages', 'ChatPage.js'), 'utf8');
const slashCommandsSource = fs.readFileSync(path.join(root, 'web-ui', 'src', 'chat-slash-commands.js'), 'utf8');
const mobileApiSource = fs.readFileSync(path.join(root, 'web-ui', 'src', 'mobile', 'mobile-api.js'), 'utf8');
const mobilePagesSource = fs.readFileSync(path.join(root, 'web-ui', 'src', 'mobile', 'mobile-pages.js'), 'utf8');
const cliSource = fs.readFileSync(path.join(root, 'src', 'cli', 'index.ts'), 'utf8');
const telegramSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'comms', 'telegram-channel.ts'), 'utf8');
const settingsRouterSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'routes', 'settings.router.ts'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'server-v2.ts'), 'utf8');
const selfUpdateSource = fs.readFileSync(path.join(root, 'src', 'tools', 'self-update.ts'), 'utf8');
const canonicalUpdaterSource = fs.readFileSync(path.join(root, 'src', 'update', 'canonical-updater.ts'), 'utf8');
const publicBuilderSource = fs.readFileSync(path.join(root, 'electron-builder-public.yml'), 'utf8');
assert.doesNotMatch(mainSource, /url\.startsWith\(GATEWAY_URL\)/);
assert.doesNotMatch(mainSource, /killPortIfInUse/);
assert.match(mainSource, /selectGatewayPort\(\)/);
assert.match(mainSource, /assertGatewayPortAvailable\(gatewayPort\)/);
assert.match(mainSource, /PROMETHEUS_GATEWAY_PORT/);
assert.equal((mainSource.match(/ipcMain\.handle\(/g) || []).length, 1, 'all privileged invoke handlers must register through handleTrustedMain');
for (const channel of ['get-app-version', 'external-link:open', 'select-canvas-paths', 'native-browser:navigate', 'native-browser:teach-capture', 'updater:check', 'updater:download', 'updater:set-auto-update', 'updater:install']) {
  assert.match(mainSource, new RegExp(`handleTrustedMain\\('${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
}
assert.match(mainSource, /autoUpdater\.autoDownload\s*=\s*false/);
assert.match(mainSource, /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/);
assert.match(mainSource, /autoUpdater\.verifyUpdateCodeSignature\s*=\s*false/);
assert.match(mainSource, /canonicalUpdaterApi\.createVersionedStateBackup/);
assert.match(mainSource, /canonicalUpdaterApi\.writePendingValidation/);
assert.match(mainSource, /completePendingCanonicalValidation/);
assert.match(mainSource, /restart_validation_failed/);
assert.match(mainSource, /payload\?\.confirm !== true/);
assert.match(mainSource, /requestUpdateDrain\(\)/);
assert.doesNotMatch(mainSource, /hasConfiguredUpdatePublisher/);
assert.match(mainSource, /waitForGatewayProcessExitStrict/);
assert.match(mainSource, /autoUpdater\.quitAndInstall\(false, true\)/);
assert.doesNotMatch(mainSource, /autoUpdater\.autoInstallOnAppQuit\s*=\s*autoUpdateEnabled/);
const beforeQuitSource = mainSource.slice(mainSource.indexOf("app.on('before-quit'"));
assert.doesNotMatch(beforeQuitSource, /taskkill|SIGKILL/, 'normal quit must not force-kill the gateway');
assert.match(mainSource, /UPDATER_SETTINGS_FILE/);
assert.match(desktopPreloadSource, /downloadUpdate: \(\) => ipcRenderer\.invoke\('updater:download'\)/);
assert.match(desktopPreloadSource, /setAutoUpdateEnabled: \(enabled\) => ipcRenderer\.invoke\('updater:set-auto-update'/);
assert.match(desktopPreloadSource, /installUpdate: \(confirmed = false\) => ipcRenderer\.invoke\('updater:install', \{ confirm: confirmed === true \}\)/);
assert.match(settingsHtml, /settings-auto-update-toggle/);
assert.match(settingsHtml, /settings-update-download/);
const generalPanelStart = settingsHtml.indexOf('id="settings-panel-system"');
const agentsPanelStart = settingsHtml.indexOf('id="settings-panel-agents"');
const updatePanelStart = settingsHtml.indexOf('settings-updates-section');
assert.ok(generalPanelStart >= 0 && updatePanelStart > generalPanelStart && updatePanelStart < agentsPanelStart, 'update settings must live inside General, not Agents');
assert.match(settingsPageSource, /function loadDesktopUpdateSettings\(\)/);
assert.match(settingsPageSource, /function toggleDesktopAutoUpdate\(\)/);
assert.match(settingsPageSource, /showConfirm\(/, 'desktop update installation must use explicit confirmation');
assert.match(slashCommandsSource, /command: '\/update'/);
assert.match(chatSource, /handleDesktopUpdateCommand/);
assert.match(mobileApiSource, /export async function requestMobileUpdate/);
assert.match(mobilePagesSource, /command === '\/update'/);
assert.match(settingsRouterSource, /Explicit confirmation is required before installing an update/);
assert.doesNotMatch(settingsRouterSource, /req\.body\?\.configuredExternalPaths/);
assert.match(serverSource, /app\.post\('\/api\/internal\/update-drain'/);
assert.match(serverSource, /before\.activeOperations > 0/);
assert.match(canonicalUpdaterSource, /encrypted-manifest/);
assert.match(canonicalUpdaterSource, /acquireUpdateLock/);
assert.match(canonicalUpdaterSource, /verifyFileSha512/);
assert.match(canonicalUpdaterSource, /copyFileSync/);
assert.match(publicBuilderSource, /forceCodeSigning:\s*true/);
assert.match(publicBuilderSource, /verifyUpdateCodeSignature:\s*false/);
assert.match(publicBuilderSource, /signAndEditExecutable:\s*false/);
assert.match(cliSource, /requestRunningGatewayUpdate/);
assert.doesNotMatch(cliSource, /git fetch --quiet/);
assert.doesNotMatch(cliSource, /npm view .* version/);
assert.match(telegramSource, /requestCanonicalUpdate/);
assert.doesNotMatch(telegramSource, /git pull|npm install/i, 'Telegram update must not run source checkout/package-manager updates');
assert.match(selfUpdateSource, /requestCanonicalUpdate/);
assert.doesNotMatch(selfUpdateSource, /cmd\.exe|spawn\(|fs\.existsSync/i, 'legacy self-update must not launch or probe a detached script');
assert.match(mainSource, /event\.sender !== mainWindow\.webContents/);
assert.match(mainSource, /event\.senderFrame !== event\.sender\.mainFrame/);
assert.match(mainSource, /view\.webContents !== event\.sender/);
assert.match(mainSource, /normalizeEmbeddedBrowserUrl\(url\)/, 'native browser loads must use the embedded URL boundary');
assert.match(mainSource, /requestPrometheusBrowserNavigation\(url\)/, 'desktop external navigation must dispatch to the Prometheus Browser');
assert.match(mainSource, /isLocalGatewayUrl\(url, GATEWAY_URL\)/, 'local gateway links must remain internal');
assert.match(mainSource, /presentNativeView\(partition\)/, 'native browser navigation must present the session-keyed view');
assert.match(chatSource, /async function openDirectNativeBrowserSurface\(options = \{\}\)/, 'Browser surface must support direct Electron open');
assert.match(chatSource, /url: requestedUrl/, 'direct Electron open must start with a usable new-tab URL');
assert.match(chatSource, /function normalizeBrowserAddressInput\(value\)/, 'address entry must normalize and validate URLs');
assert.match(chatSource, /async function sendNativeBrowserNavigation\(action, url = ''\)/, 'native browser controls must remain on the embedded surface');
assert.match(chatSource, /state\.lastError = nextError/, 'native browser load errors must reach browser UI state');

const sent = [];
const ipcListeners = new Map();
const domListeners = new Map();
const ipcRenderer = {
  on(channel, fn) { ipcListeners.set(channel, fn); },
  send(channel, payload) { sent.push({ channel, payload }); },
};
const fakeWindow = {
  CSS: { escape: (value) => String(value) },
  location: { href: 'https://example.test/' },
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener(type, fn) { domListeners.set(type, fn); },
};
const preloadSource = fs.readFileSync(path.join(root, 'electron', 'inhouse-browser-preload.js'), 'utf8');
const context = vm.createContext({
  console: { log() {} },
  window: fakeWindow,
  document: { title: '' },
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
