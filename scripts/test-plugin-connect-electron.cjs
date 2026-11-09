'use strict';
// Isolated development-Electron test; never launches the product app or a live profile.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const base = path.join(root, '.pr', 'native-fixture');
const resultPath = path.join(base, 'results.json');
const synthetic = 'PR852_SYNTHETIC_NOT_A_CREDENTIAL';
if (!process.versions.electron) {
  fs.mkdirSync(base, { recursive: true });
  const profile = fs.mkdtempSync(path.join(base, 'profile-'));
  const binary = require('electron');
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, PR852_NATIVE_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const runs = [];
  for (const mode of ['exercise', 'decrypt']) {
    const child = spawnSync(binary, [__filename, '--native-mode=' + mode], { cwd: root, env, timeout: 60000, encoding: 'utf8' });
    runs.push({ mode, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr });
    if (child.status !== 0) break;
  }
  const report = { timestamp: new Date().toISOString(), binary, profile, packagedArtifact: 'Not established: this is a development Electron executable and explicit test entrypoint.', runs, exercise: read('exercise.json'), decrypt: read('decrypt.json') };
  function read(name) { try { return JSON.parse(fs.readFileSync(path.join(profile, name), 'utf8')); } catch { return null; } }
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = runs.length === 2 && runs.every(r => r.status === 0) ? 0 : 1;
} else {
  const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
  const profile = process.env.PR852_NATIVE_PROFILE;
  assert(profile && path.resolve(profile).startsWith(base + path.sep), 'fixture-only profile');
  app.setPath('userData', profile);
  app.setPath('sessionData', path.join(profile, 'session'));
  app.setPath('crashDumps', path.join(profile, 'crashes'));
  app.setAppLogsPath(path.join(profile, 'logs'));
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  const mode = process.argv.find(a => a.startsWith('--native-mode='))?.split('=')[1];
  const checks = [];
  const pass = label => checks.push(label);
  const deadline = setTimeout(() => { console.error('Native test deadline exceeded'); app.exit(2); }, 45000);
  async function renderer(window) {
    for (let i = 0; i < 150; i++) {
      if (await window.webContents.executeJavaScript('Boolean(window.promOwnerConsent)').catch(() => false)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Consent preload unavailable');
  }
  app.whenReady().then(async () => {
    assert.equal(app.isPackaged, false); pass('explicit development harness, not packaged app');
    assert.equal(safeStorage.isEncryptionAvailable(), true); pass('actual Electron safeStorage encryption available');
    const cipherPath = path.join(profile, 'synthetic.enc');
    if (mode === 'decrypt') {
      assert.equal(safeStorage.decryptString(fs.readFileSync(cipherPath)), synthetic);
      pass('persisted synthetic ciphertext decrypts in a fresh Electron process');
    } else {
      const cipher = safeStorage.encryptString(synthetic);
      assert(Buffer.isBuffer(cipher)); assert(!cipher.includes(Buffer.from(synthetic)));
      assert.equal(safeStorage.decryptString(cipher), synthetic);
      fs.writeFileSync(cipherPath, cipher);
      pass('actual OS-backed encrypt/decrypt roundtrip; ciphertext excludes plaintext');
      assert.throws(() => safeStorage.decryptString(Buffer.from('invalid synthetic ciphertext')));
      pass('invalid ciphertext rejected');
      const { createOwnerConsent } = require(path.join(root, 'electron', 'owner-consent.js'));
      const owner = 'PR852_SYNTHETIC_OWNER_TOKEN_ONLY';
      const locks = []; let acceptLock = true;
      // No gateway, socket or live endpoint: only the transport boundary is stubbed.
      global.fetch = async (url, opts) => {
        assert.equal(url, 'https://native-fixture.invalid/api/owner-consent/lock');
        const lock = JSON.parse(opts.body);
        const key = crypto.createHmac('sha256', owner).update('prometheus-owner-consent-v1').digest();
        assert.equal(lock.mac, crypto.createHmac('sha256', key).update(`lock|${lock.active ? 1 : 0}|${lock.ts}`).digest('hex'));
        if (locks.length) assert(lock.ts > locks.at(-1).ts);
        locks.push(lock); return { ok: acceptLock };
      };
      const consent = createOwnerConsent({ BrowserWindow, app, ipcMain, ownerToken: owner, getGatewayUrl: () => 'https://native-fixture.invalid', getParent: () => null });
      const request = { method: 'POST', path: '/api/connection-attempts/pr852-synthetic/connect', body: JSON.stringify({ secret: synthetic }), detail: 'PR852 isolated synthetic native regression; no real access' };
      await assert.rejects(consent.request({ ...request, method: 'GET' }), /does not use owner approval/);
      pass('unsupported method fails closed');
      acceptLock = false;
      await assert.rejects(consent.request(request), /could not lock/);
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      pass('lock refusal prevents native window creation');
      acceptLock = true;
      let pending = consent.request(request);
      while (!consent.isOpen()) await new Promise(resolve => setTimeout(resolve, 10));
      let window = BrowserWindow.getAllWindows()[0]; await renderer(window);
      const prefs = window.webContents.getLastWebPreferences();
      assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false); assert.equal(window.webContents.isDevToolsOpened(), false); assert.equal(window.webContents.isDevToolsFocused(), false);
      pass('real BrowserWindow uses production preload and hardened preferences');
      await assert.rejects(consent.request(request), /already open/); pass('concurrent approval rejected');
      const stranger = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'electron', 'owner-consent-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await stranger.loadURL('data:text/html,<title>PR852 unrelated sender</title>'); await renderer(stranger);
      assert.deepEqual(await stranger.webContents.executeJavaScript('window.promOwnerConsent.submit("WRONG")'), { ok: false });
      await stranger.webContents.executeJavaScript('window.promOwnerConsent.cancel()'); assert.equal(consent.isOpen(), true);
      stranger.destroy(); pass('actual unrelated renderer IPC cannot submit or cancel active consent');
      for (let i = 0; i < 2; i++) assert.deepEqual(await window.webContents.executeJavaScript('window.promOwnerConsent.submit("WRONG")'), { ok: false, retry: true });
      // Third failure destroys the requesting renderer before its invoke response can arrive.
      void window.webContents.executeJavaScript('window.promOwnerConsent.submit("WRONG")').catch(() => {});
      assert.equal(await pending, null); assert.equal(consent.isOpen(), false);
      pass('actual production IPC rejects three wrong codes and closes without consent');
      pending = consent.request(request);
      while (!consent.isOpen()) await new Promise(resolve => setTimeout(resolve, 10));
      window = BrowserWindow.getAllWindows()[0]; await renderer(window);
      void window.webContents.executeJavaScript('window.promOwnerConsent.cancel()').catch(() => {});
      assert.equal(await pending, null); pass('actual production cancel IPC closes without consent');
      app.commandLine.appendSwitch('remote-debugging-port', '0');
      assert.equal(consent.supported(), false);
      await assert.rejects(consent.request(request), /remote debugging/);
      app.commandLine.removeSwitch('remote-debugging-port'); pass('remote debugging flag fails closed (no debug listener started)');
      assert.equal(locks.at(-1).active, false); pass('signed monotonic synthetic lock/unlock requests verified');
    }
    fs.writeFileSync(path.join(profile, mode + '.json'), JSON.stringify({ electron: process.versions.electron, platform: process.platform, appIsPackaged: app.isPackaged, checks }, null, 2));
    clearTimeout(deadline); app.exit(0);
  }).catch(error => { fs.writeFileSync(path.join(profile, mode + '.json'), JSON.stringify({ checks, error: error.stack }, null, 2)); clearTimeout(deadline); app.exit(1); });
}
