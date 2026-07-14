/**
 * Prometheus Desktop - Electron Main Process
 *
 * Spawns the Prometheus gateway
 * then opens a BrowserWindow pointed at http://127.0.0.1:18789
 *
 * User data is stored in %APPDATA%\Prometheus\ (C:\Users\<n>\AppData\Roaming\Prometheus)
 * so it survives app updates and works correctly for any user on any machine.
 *
 * First-run dependency installation:
 *   On first launch (or after update), runs scripts/postinstall.js to ensure
 *   all document skill npm packages are present. Shows a setup splash screen
 *   during installation so users see progress rather than a blank window.
 */

const {
  app,
  BrowserWindow,
  BrowserView,
  WebContentsView,
  shell,
  Menu,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
} = require('electron');
const { spawn, execSync }  = require('child_process');
const path       = require('path');
const http       = require('http');
const fs         = require('fs');
const crypto     = require('crypto');
const {
  isTrustedRendererUrl,
  normalizeEmbeddedBrowserUrl,
  normalizeExternalUrl,
  parseWindowsListeningPids,
} = require('./security');

// ─── Config ────────────────────────────────────────────────────────────────
const GATEWAY_URL  = 'http://127.0.0.1:18789';
const APP_ID       = 'com.prometheus.desktop';
const APP_ROOT     = path.join(__dirname, '..');
const ICON_PATH    = path.join(APP_ROOT, 'assets', 'Prometheus.ico');
const ICON_IMAGE   = nativeImage.createFromPath(ICON_PATH);
const MAX_RETRIES  = 200;  // 200 x 300ms = 60s max wait (dev tsx startup can be slow)
const RETRY_DELAY  = 300;
const GATEWAY_HEALTH_INTERVAL_MS = 15_000;
const GATEWAY_HEALTH_TIMEOUT_MS = 5_000;
const GATEWAY_HEALTH_FAILURE_LIMIT = 2;
const GATEWAY_BUSY_RECOVERY_GRACE_MS = 45_000;
const PACKAGE_JSON = require(path.join(APP_ROOT, 'package.json'));
const IS_PUBLIC_BUILD = String(process.env.PROMETHEUS_PUBLIC_BUILD || PACKAGE_JSON.prometheusBuild || '').trim().toLowerCase() === 'public';
const IS_PACKAGED_RUNTIME = app.isPackaged;

function getPackagedAppRoot() {
  return path.join(process.resourcesPath, 'app.asar');
}

function getGatewayEntryPath() {
  return IS_PACKAGED_RUNTIME
    ? path.join(getPackagedAppRoot(), 'dist', 'gateway', 'server-v2.js')
    : path.join(APP_ROOT, 'src', 'gateway', 'server-v2.ts');
}

function getGatewayWorkingDirectory() {
  return IS_PACKAGED_RUNTIME
    ? process.resourcesPath
    : APP_ROOT;
}

// ─── User Data Dir ─────────────────────────────────────────────────────────
const USER_DATA_DIR = path.join(app.getPath('appData'), 'Prometheus');
app.setAppUserModelId(APP_ID);
app.setName('Prometheus');
app.setPath('userData', USER_DATA_DIR);
if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

// ─── First-Run Stamp ───────────────────────────────────────────────────────
// Stores the last version that completed dependency setup.
// If the version changes (app update), re-runs the check automatically.
const SETUP_STAMP_FILE = path.join(USER_DATA_DIR, '.setup-complete');
const CURRENT_VERSION  = require('../package.json').version;

function needsDependencySetup() {
  if (IS_PACKAGED_RUNTIME) return false;
  try {
    const stamp = fs.readFileSync(SETUP_STAMP_FILE, 'utf-8').trim();
    return stamp !== CURRENT_VERSION;
  } catch {
    return true; // no stamp = first run
  }
}

function markSetupComplete() {
  fs.writeFileSync(SETUP_STAMP_FILE, CURRENT_VERSION, 'utf-8');
}

// ─── Dep packages to verify ────────────────────────────────────────────────
const DOC_PACKAGES = ['mammoth', 'docx', 'pdf-parse', 'xlsx'];
const NM = path.join(APP_ROOT, 'node_modules');

function isInstalled(pkg) {
  try {
    require.resolve(path.join(NM, pkg, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

function getMissingPackages() {
  return DOC_PACKAGES.filter(p => !isInstalled(p));
}

// ─── Auto-Updater ──────────────────────────────────────────────────────────
// Only active in packaged public builds — skip entirely in dev mode.
let autoUpdater = null;
if (IS_PACKAGED_RUNTIME && IS_PUBLIC_BUILD) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload    = true;   // download silently in background
    autoUpdater.autoInstallOnAppQuit = false; // we control install via the UI button
    autoUpdater.logger          = null;   // suppress console noise; surface via events only
  } catch (e) {
    console.error('[Updater] electron-updater not available:', e.message);
  }
}

// ─── State ─────────────────────────────────────────────────────────────────
let mainWindow          = null;
let gatewayProcess      = null;
let nativeBrowserRpcServer = null;
let nativeBrowserRpcPort = 0;
let isQuitting          = false;
let gatewayShuttingDown = false;
let pendingUpdate       = null;  // holds UpdateInfo once a release is downloaded
let updaterStatus       = autoUpdater ? 'idle' : 'unsupported';
let updaterMessage      = autoUpdater ? '' : 'Updates are available only in packaged public builds.';
let updaterChecking     = false;
let updaterInstalling   = false;
let updaterProgress     = 0;
let isGatewayRestarting = false;
let gatewayHealthTimer = null;
let gatewayHealthCheckInFlight = false;
let gatewayHealthFailures = 0;
const GATEWAY_RESTART_EXIT_CODE = 42;
const NATIVE_BROWSER_RPC_TOKEN = crypto.randomBytes(32).toString('hex');
const PAIRING_ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
const NATIVE_BROWSER_EMPTY_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };

function getUpdaterState(extra = {}) {
  return {
    supported: !!autoUpdater,
    status: updaterStatus,
    message: updaterMessage,
    progress: updaterProgress,
    version: pendingUpdate && pendingUpdate.version ? pendingUpdate.version : '',
    releaseName: pendingUpdate && pendingUpdate.releaseName ? pendingUpdate.releaseName : '',
    releaseNotes: pendingUpdate && typeof pendingUpdate.releaseNotes === 'string' ? pendingUpdate.releaseNotes : '',
    ...extra,
  };
}

function sendUpdaterState(extra = {}) {
  const state = getUpdaterState(extra);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('updater-state', state); } catch {}
  }
  return state;
}

async function checkForPrometheusUpdates(source = 'manual') {
  if (!autoUpdater) {
    updaterStatus = 'unsupported';
    updaterMessage = 'Updates are available only in packaged public builds.';
    return sendUpdaterState({ source });
  }
  if (updaterInstalling) return sendUpdaterState({ source });
  if (pendingUpdate) {
    updaterStatus = 'ready';
    updaterMessage = 'Update downloaded and ready to install.';
    return sendUpdaterState({ source });
  }
  if (updaterChecking) return sendUpdaterState({ source });

  updaterChecking = true;
  updaterStatus = 'checking';
  updaterMessage = 'Checking for the latest Prometheus release...';
  updaterProgress = 0;
  sendUpdaterState({ source });

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      updaterStatus = 'idle';
      updaterMessage = 'Prometheus is up to date.';
      return sendUpdaterState({ source });
    }
    return sendUpdaterState({ source });
  } catch (e) {
    updaterStatus = 'error';
    updaterMessage = e && e.message ? e.message : 'Update check failed.';
    console.error('[Updater] checkForUpdates failed:', updaterMessage);
    return sendUpdaterState({ source });
  } finally {
    updaterChecking = false;
  }
}

// ─── Native in-house browser: profile-keyed multi-view registry ──────────────
// Each "profile" is an isolated, on-disk Electron session partition (its own
// cookies/logins), analogous to Prometheus' per-agent Chrome debug profiles.
//   - The main chat uses the "main" profile by default.
//   - Subagents/other owners can either share the main profile or get their own,
//     so two agents driving two accounts never clash over one logged-in session.
// Only ONE view is "presented" (positioned + visible) in the canvas at a time —
// the main chat's. Other profiles' views stay parked at zero size but remain
// alive for background automation (DOM snapshot / run-js).
const NATIVE_BROWSER_DEFAULT_PROFILE = 'main';
const nativeBrowserViews = new Map();      // partition -> WebContentsView/BrowserView
const nativeBrowserSessionPartitions = new Map(); // sessionId -> partition
let presentedNativePartition = '';         // partition currently shown in the canvas
const nativeBrowserState = {
  available: !!(WebContentsView || BrowserView),
  attached: false,
  visible: false,
  sessionId: '',
  profile: '',
  partition: '',
  url: 'about:blank',
  title: '',
  loading: false,
  bounds: { ...NATIVE_BROWSER_EMPTY_BOUNDS },
  lastError: '',
};

// ─── Setup Splash Screen ───────────────────────────────────────────────────
// Shown during first-run dependency installation.
// Supports live status updates via loadURL data: refresh.
function createSetupWindow() {
  const win = new BrowserWindow({
    width:           480,
    height:          340,
    frame:           false,
    resizable:       false,
    center:          true,
    icon:            ICON_IMAGE.isEmpty() ? ICON_PATH : ICON_IMAGE,
    backgroundColor: '#0a0a0a',
    webPreferences:  { nodeIntegration: false },
  });
  renderSetupWindow(win, 'Checking dependencies…', []);
  return win;
}

function renderSetupWindow(win, statusLine, lines) {
  const listItems = lines.map(l =>
    `<div class="line ${l.ok ? 'ok' : l.fail ? 'fail' : 'pending'}">${escHtml(l.text)}</div>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;user-select:none}
    h1{font-size:22px;font-weight:700;letter-spacing:.08em;
      background:linear-gradient(135deg,#f97316,#facc15);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .status{font-size:12px;color:#64748b;min-height:16px}
    .lines{width:320px;display:flex;flex-direction:column;gap:4px;min-height:80px}
    .line{font-size:12px;padding:3px 0;color:#64748b}
    .line.ok::before{content:'✓  ';color:#4ade80}
    .line.fail::before{content:'✗  ';color:#f43f5e}
    .line.pending::before{content:'·  ';color:#f97316}
    .spinner{width:28px;height:28px;border:2px solid #1e293b;border-top-color:#f97316;border-radius:50%;animation:spin .7s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style></head><body>
    <div class="spinner"></div>
    <h1>PROMETHEUS</h1>
    <p class="status">${escHtml(statusLine)}</p>
    <div class="lines">${listItems}</div>
  </body></html>`;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Dependency Installation ────────────────────────────────────────────────
async function runDependencySetup(setupWin) {
  const missing = getMissingPackages();

  if (!missing.length) {
    renderSetupWindow(setupWin, 'All packages present.', DOC_PACKAGES.map(p => ({ text: p, ok: true })));
    await sleep(600);
    markSetupComplete();
    return true;
  }

  const lines = DOC_PACKAGES.map(p => ({
    text: p,
    ok: isInstalled(p),
    fail: false,
    pending: !isInstalled(p),
  }));

  renderSetupWindow(setupWin, `Installing ${missing.length} package(s)…`, lines);
  await sleep(400); // let the window render

  let anyFailed = false;

  for (const pkg of missing) {
    const idx = lines.findIndex(l => l.text === pkg);
    lines[idx].pending = true;
    renderSetupWindow(setupWin, `Installing ${pkg}…`, lines);

    const ok = await installPackage(pkg);
    lines[idx].ok      = ok;
    lines[idx].fail    = !ok;
    lines[idx].pending = false;
    if (!ok) anyFailed = true;

    renderSetupWindow(setupWin, ok ? `Installed ${pkg}` : `Failed: ${pkg}`, lines);
    await sleep(200);
  }

  const finalStatus = anyFailed
    ? 'Some packages failed — document skills may be limited'
    : 'Setup complete.';
  renderSetupWindow(setupWin, finalStatus, lines);
  await sleep(anyFailed ? 2500 : 800);

  markSetupComplete();
  return !anyFailed;
}

function installPackage(pkg) {
  return new Promise((resolve) => {
    try {
      execSync(`npm install ${pkg} --save --prefer-offline --no-audit --no-fund`, {
        cwd: APP_ROOT, stdio: 'pipe',
      });
      resolve(true);
    } catch {
      try {
        execSync(`npm install ${pkg} --save --no-audit --no-fund`, {
          cwd: APP_ROOT, stdio: 'pipe',
        });
        resolve(true);
      } catch {
        resolve(false);
      }
    }
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Port cleanup ──────────────────────────────────────────────────────────
// Never kill an arbitrary process just because it owns the configured port.
// Refuse startup instead; the operator can then identify and close the owner.
function assertGatewayPortAvailable(port) {
  if (process.platform !== 'win32') return;
  try {
    const output = execSync('netstat -ano -p tcp', {
      encoding: 'utf-8', stdio: 'pipe',
    });
    const owners = parseWindowsListeningPids(output, port).filter((pid) => pid !== process.pid);
    if (owners.length) {
      throw new Error(
        `Prometheus cannot start because port ${port} is already in use by PID ${owners.join(', ')}. ` +
        'Close that process and start Prometheus again.'
      );
    }
  } catch (error) {
    if (error && /already in use by PID/.test(String(error.message || ''))) throw error;
    writeGatewayLog(`[main] Port ownership check unavailable: ${error && error.message ? error.message : error}\n`);
  }
}

// ─── Gateway Log ───────────────────────────────────────────────────────────
// In packaged builds stdout/stderr have no terminal — write to a log file so
// crashes are diagnosable. Also keeps the last 200 lines in memory for the
// error dialog shown when the gateway fails to start.
const GATEWAY_LOG_PATH = path.join(USER_DATA_DIR, 'gateway.log');
let gatewayLogStream = null;
const gatewayLogLines = [];   // rolling last-200-lines buffer for error dialog
const MAX_LOG_LINES = 200;

function openGatewayLog() {
  try {
    const logsDir = path.dirname(GATEWAY_LOG_PATH);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    gatewayLogStream = fs.createWriteStream(GATEWAY_LOG_PATH, { flags: 'w' });
    gatewayLogStream.on('error', (err) => {
      if (err?.code !== 'EPIPE') {
        console.warn('[Prometheus] Gateway log stream error:', err?.message || err);
      }
    });
  } catch (e) {
    console.warn('[Prometheus] Could not open gateway log:', e.message);
  }
}

function safeWriteMainStdout(text) {
  try {
    if (!process.stdout || process.stdout.destroyed || !process.stdout.writable) return;
    process.stdout.write(text);
  } catch (err) {
    if (err?.code !== 'EPIPE') {
      try { console.warn('[Prometheus] Could not write gateway output to stdout:', err?.message || err); } catch {}
    }
  }
}

function writeGatewayLog(data) {
  const text = String(data);
  if (gatewayLogStream) {
    try { gatewayLogStream.write(text); } catch {}
  }
  // Keep rolling buffer for error dialog
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      gatewayLogLines.push(line);
      if (gatewayLogLines.length > MAX_LOG_LINES) gatewayLogLines.shift();
    }
  }
  // Also forward to main-process stdio (visible in dev / when run from terminal)
  safeWriteMainStdout(`[gateway] ${text}`);
}

function getLastGatewayOutput(maxLines = 30) {
  return gatewayLogLines.slice(-maxLines).join('\n');
}

// ─── Vault master key ────────────────────────────────────────────────────────
// The gateway runs as a child process and cannot use safeStorage (main-process
// only). So we own the master key here: keep it OS-sealed at rest (vault.key.enc)
// and hand the plaintext key to the child over stdin. Returns a 64-char hex string,
// or null if protection is unavailable (child then falls back to its key file).
function resolveVaultMasterKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      writeGatewayLog('[main] safeStorage unavailable — vault key will use file fallback\n');
      return null;
    }
    const vaultDir = path.join(USER_DATA_DIR, '.prometheus', 'vault');
    if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
    const sealedPath = path.join(vaultDir, 'vault.key.enc');
    const legacyPath = path.join(vaultDir, 'vault.key');

    // Already sealed → unseal and use.
    if (fs.existsSync(sealedPath)) {
      const hex = safeStorage.decryptString(fs.readFileSync(sealedPath)).trim();
      return /^[0-9a-fA-F]{64}$/.test(hex) ? hex.toLowerCase() : null;
    }

    // Migration: an existing plaintext key must be preserved (vault.enc was
    // encrypted with it), so re-seal the SAME bytes, then delete the plaintext.
    if (fs.existsSync(legacyPath)) {
      const hex = fs.readFileSync(legacyPath, 'utf-8').trim();
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        fs.writeFileSync(sealedPath, safeStorage.encryptString(hex.toLowerCase()));
        try { fs.rmSync(legacyPath); } catch {}
        writeGatewayLog('[main] Migrated vault.key → OS-sealed vault.key.enc\n');
        return hex.toLowerCase();
      }
    }

    // First run: generate a fresh key and seal it.
    const hex = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(sealedPath, safeStorage.encryptString(hex));
    writeGatewayLog('[main] Created OS-sealed vault master key\n');
    return hex;
  } catch (err) {
    writeGatewayLog(`[main] Vault key sealing failed: ${err && err.message ? err.message : err}\n`);
    return null;
  }
}

// ─── Gateway ───────────────────────────────────────────────────────────────
function checkGatewayHealth(timeoutMs = GATEWAY_HEALTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const req = http.request(`${GATEWAY_URL}/api/health`, {
      method: 'GET',
      headers: { Connection: 'close' },
    }, (res) => {
      const ok = Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 300;
      res.resume();
      res.once('end', () => done(ok));
      res.once('close', () => done(ok));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      done(false);
    });
    req.once('error', () => done(false));
    req.end();
  });
}

function readGatewayRuntimeStatus() {
  try {
    const statusPath = path.join(USER_DATA_DIR, '.prometheus', 'gateway-runtime-status.json');
    if (!fs.existsSync(statusPath)) return null;
    return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  } catch {
    return null;
  }
}

function shouldDeferGatewayHealthRecovery(status) {
  if (!status || !Number.isFinite(Number(status.timestamp))) return false;
  const heartbeatAgeMs = Math.max(0, Date.now() - Number(status.timestamp));
  if (heartbeatAgeMs < 20_000) return true;
  if (!status.modelBusy) return false;
  const busyAgeAtHeartbeatMs = Number.isFinite(Number(status.modelBusyAgeMs))
    ? Number(status.modelBusyAgeMs)
    : 0;
  const busyAgeFromStartMs = Number.isFinite(Number(status.modelBusySince))
    ? Math.max(0, Date.now() - Number(status.modelBusySince))
    : 0;
  const effectiveBusyAgeMs = Math.max(
    busyAgeFromStartMs,
    busyAgeAtHeartbeatMs + heartbeatAgeMs,
  );
  return effectiveBusyAgeMs < GATEWAY_BUSY_RECOVERY_GRACE_MS;
}

function killGatewayProcessTree(child = gatewayProcess) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${child.pid} /F /T`, { stdio: 'pipe', timeout: 8_000 });
      return;
    } catch {}
  }
  try { child.kill('SIGKILL'); } catch {}
}

function waitForGatewayProcessExit(child, timeoutMs = 10_000) {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    child.once('exit', done);
  });
}

function startGatewayHealthWatchdog() {
  if (gatewayHealthTimer) return;
  gatewayHealthTimer = setInterval(async () => {
    if (isQuitting || isGatewayRestarting || gatewayHealthCheckInFlight || !gatewayProcess) return;
    gatewayHealthCheckInFlight = true;
    try {
      if (await checkGatewayHealth()) {
        gatewayHealthFailures = 0;
        return;
      }
      const status = readGatewayRuntimeStatus();
      if (shouldDeferGatewayHealthRecovery(status)) {
        gatewayHealthFailures = 0;
        writeGatewayLog('[main] Gateway health timed out, but runtime heartbeat/busy grace is still current; deferring recovery\n');
        return;
      }
      gatewayHealthFailures += 1;
      writeGatewayLog(`[main] Gateway health failure ${gatewayHealthFailures}/${GATEWAY_HEALTH_FAILURE_LIMIT}\n`);
      if (gatewayHealthFailures >= GATEWAY_HEALTH_FAILURE_LIMIT) {
        gatewayHealthFailures = 0;
        await restartGatewayFromElectron({
          terminateExisting: true,
          reason: 'health watchdog detected an unresponsive gateway',
        });
      }
    } finally {
      gatewayHealthCheckInFlight = false;
    }
  }, GATEWAY_HEALTH_INTERVAL_MS);
  gatewayHealthTimer.unref?.();
}

function startGateway() {
  console.log('[Prometheus] Starting gateway...');
  console.log(`[Prometheus] User data: ${USER_DATA_DIR}`);
  console.log(`[Prometheus] Packaged runtime: ${IS_PACKAGED_RUNTIME ? 'yes' : 'no'}`);

  openGatewayLog();
  writeGatewayLog(`[main] Gateway starting — pid will follow\n`);
  writeGatewayLog(`[main] Data dir: ${USER_DATA_DIR}\n`);
  writeGatewayLog(`[main] Packaged: ${IS_PACKAGED_RUNTIME}\n`);

  assertGatewayPortAvailable(18789);

  // Bundled skills path — inside extraResources (outside asar, accessible to Node subprocess)
  const bundledSkillsDir = IS_PACKAGED_RUNTIME
    ? path.join(process.resourcesPath, 'bundled-skills')
    : path.join(APP_ROOT, 'workspace', 'skills');

  // Unseal the vault master key (or null if OS protection is unavailable). Handed
  // to the child over stdin below — the child blocks on that read, so we MUST write
  // a line in both cases (a hex key, or an empty sentinel for the file-fallback path).
  const vaultKeyHex = resolveVaultMasterKey();

  const gatewayEnv = {
    ...process.env,
    FORCE_COLOR:                  '0',
    PROMETHEUS_DATA_DIR:          USER_DATA_DIR,
    PROMETHEUS_APP_ROOT:          APP_ROOT,
    PROMETHEUS_WORKSPACE_DIR:     path.join(USER_DATA_DIR, 'workspace'),
    PROMETHEUS_BUNDLED_SKILLS_DIR: bundledSkillsDir,
    PROMETHEUS_ELECTRON_MANAGED:  '1',
    PROMETHEUS_PAIRING_ADMIN_TOKEN: PAIRING_ADMIN_TOKEN,
    PROMETHEUS_ELECTRON_BROWSER_RPC_URL: nativeBrowserRpcPort ? `http://127.0.0.1:${nativeBrowserRpcPort}` : '',
    PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN: nativeBrowserRpcPort ? NATIVE_BROWSER_RPC_TOKEN : '',
    ...(IS_PUBLIC_BUILD ? { PROMETHEUS_PUBLIC_BUILD: '1' } : {}),
  };

  if (IS_PACKAGED_RUNTIME) {
    const gatewayEntry = getGatewayEntryPath();
    writeGatewayLog(`[main] Entry: ${gatewayEntry}\n`);
    writeGatewayLog(`[main] Exec: ${process.execPath}\n`);
    gatewayProcess = spawn(process.execPath, [gatewayEntry], {
      cwd: getGatewayWorkingDirectory(),
      env: {
        ...gatewayEnv,
        ELECTRON_RUN_AS_NODE: '1',
      },
      windowsHide: true,
    });
  } else {
    const isWin = process.platform === 'win32';
    const tsxBin = path.join(
      APP_ROOT, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx'
    );
    const tsxExists = fs.existsSync(tsxBin);
    const [cmd, args] = tsxExists
      ? [tsxBin, [getGatewayEntryPath()]]
      : ['npx', ['tsx', getGatewayEntryPath()]];  // fallback

    gatewayProcess = spawn(cmd, args, {
      cwd:   getGatewayWorkingDirectory(),
      env:   gatewayEnv,
      shell: isWin,
      windowsHide: true,
    });
  }

  writeGatewayLog(`[main] Gateway spawned (pid=${gatewayProcess.pid})\n`);

  // Hand off the master key (or an empty sentinel) as the first stdin line. The
  // child's vault-key-bootstrap reads exactly one line, then stdin is left open.
  try {
    gatewayProcess.stdin?.write((vaultKeyHex || '') + '\n');
  } catch (err) {
    writeGatewayLog(`[main] Vault key handoff write failed: ${err && err.message ? err.message : err}\n`);
  }

  gatewayProcess.stdout?.on('data', (d) => writeGatewayLog(d));
  gatewayProcess.stderr?.on('data', (d) => writeGatewayLog(d));

  gatewayProcess.on('error', (err) => {
    writeGatewayLog(`[main] Spawn error: ${err.message}\n`);
    if (!isQuitting) {
      dialog.showErrorBox(
        'Prometheus — Gateway Error',
        `Failed to start the Prometheus gateway:\n\n${err.message}\n\nLog: ${GATEWAY_LOG_PATH}`
      );
      app.quit();
    }
  });

  gatewayProcess.on('exit', (code, signal) => {
    writeGatewayLog(`[main] Gateway exited (code=${code}, signal=${signal})\n`);
    if (!isQuitting && isGatewayRestarting) return;
    if (!isQuitting && code === GATEWAY_RESTART_EXIT_CODE) {
      restartGatewayFromElectron();
      return;
    }
    if (!isQuitting) {
      const lastOutput = getLastGatewayOutput();
      dialog.showErrorBox(
        'Prometheus — Gateway Crashed',
        `The Prometheus gateway exited unexpectedly (code=${code}).\n\nLast output:\n${lastOutput || '(none)'}\n\nFull log: ${GATEWAY_LOG_PATH}`
      );
      app.quit();
    }
  });
}

async function restartGatewayFromElectron(options = {}) {
  if (isGatewayRestarting) return;
  isGatewayRestarting = true;
  const terminateExisting = options.terminateExisting === true;
  const reason = String(options.reason || 'gateway requested restart');
  writeGatewayLog(`[main] Electron-managed gateway restart requested: ${reason}\n`);

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway-restarting');
    }
  } catch {}

  try {
    if (terminateExisting && gatewayProcess) {
      const staleProcess = gatewayProcess;
      writeGatewayLog(`[main] Terminating unresponsive gateway tree (pid=${staleProcess.pid || 'unknown'})\n`);
      killGatewayProcessTree(staleProcess);
      await waitForGatewayProcessExit(staleProcess);
    }
    gatewayProcess = null;
    startGateway();
    await waitForGateway();
    writeGatewayLog('[main] Electron-managed gateway restart complete\n');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(GATEWAY_URL);
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    writeGatewayLog(`[main] Electron-managed gateway restart failed: ${message}\n`);
    if (!isQuitting) {
      dialog.showErrorBox(
        'Prometheus - Gateway Restart Failed',
        `Prometheus could not restart the gateway:\n\n${message}\n\nLog: ${GATEWAY_LOG_PATH}`
      );
      app.quit();
    }
  } finally {
    isGatewayRestarting = false;
  }
}

function waitForGateway(retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => { if (!settled) { settled = true; fn(); } };

    // Abort immediately if the gateway process dies before becoming ready.
    const onProcessExit = (code, signal) => {
      done(() => reject(new Error(
        `Gateway process exited before becoming ready (code=${code}, signal=${signal}).\n` +
        `Check that all dependencies are installed (npm install).`
      )));
    };
    if (gatewayProcess) {
      gatewayProcess.once('exit', onProcessExit);
    }

    const attempt = () => {
      if (settled) return;
      http.get(GATEWAY_URL, (res) => {
        res.resume();
        if (gatewayProcess) gatewayProcess.removeListener('exit', onProcessExit);
        done(resolve);
      }).on('error', () => {
        if (settled) return;
        if (retries-- > 0) {
          setTimeout(attempt, RETRY_DELAY);
        } else {
          if (gatewayProcess) gatewayProcess.removeListener('exit', onProcessExit);
          done(() => reject(new Error(
            `Gateway did not respond at ${GATEWAY_URL} after ${(MAX_RETRIES * RETRY_DELAY) / 1000}s`
          )));
        }
      });
    };
    attempt();
  });
}

// ─── Native In-App Browser Surface (profile-keyed multi-view) ────────────────
// Build a clean Chrome user-agent so the embedded browser is indistinguishable
// from regular Chrome. The default Electron UA leaks "Electron/x.y" and the app
// name ("prometheus/1.0.5"), which sites like X use to flag/limit automation.
// We reuse the real bundled Chromium version so the UA stays internally consistent.
function buildNativeBrowserUserAgent() {
  const chrome = String(process.versions.chrome || '').trim() || '130.0.0.0';
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : (process.platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64');
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function applyNativeBrowserUserAgent(view) {
  try {
    const ua = buildNativeBrowserUserAgent();
    view.webContents.setUserAgent(ua);
    // Cover sub-resource / fetch requests in this partition too.
    if (view.webContents.session && typeof view.webContents.session.setUserAgent === 'function') {
      view.webContents.session.setUserAgent(ua);
    }
  } catch {}
}

function slugifyNativeProfile(value) {
  const raw = String(value || '').trim().toLowerCase();
  const slug = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || NATIVE_BROWSER_DEFAULT_PROFILE;
}

function partitionForNativeProfile(profileId) {
  return `persist:prometheus-inhouse-${slugifyNativeProfile(profileId)}`;
}

function nativeProfileFromPartition(partition) {
  return String(partition || '').replace(/^persist:prometheus-inhouse-/, '') || NATIVE_BROWSER_DEFAULT_PROFILE;
}

function resolveNativePartition(sessionId, profileId) {
  if (profileId) return partitionForNativeProfile(profileId);
  const sid = String(sessionId || '').trim();
  if (sid && nativeBrowserSessionPartitions.has(sid)) return nativeBrowserSessionPartitions.get(sid);
  return partitionForNativeProfile(NATIVE_BROWSER_DEFAULT_PROFILE);
}

function nativeViewMeta(view) {
  if (!view.__promMeta) view.__promMeta = { url: 'about:blank', title: '', loading: false, lastError: '' };
  return view.__promMeta;
}

function getNativeViewByPartition(partition) {
  const view = nativeBrowserViews.get(partition);
  if (view && !view.webContents?.isDestroyed()) return view;
  if (view) nativeBrowserViews.delete(partition);
  return null;
}

function normalizeNativeBrowserBounds(bounds = {}) {
  return {
    x: Math.max(0, Math.round(Number(bounds.x || 0))),
    y: Math.max(0, Math.round(Number(bounds.y || 0))),
    width: Math.max(0, Math.round(Number(bounds.width || 0))),
    height: Math.max(0, Math.round(Number(bounds.height || 0))),
  };
}

function normalizeBrowserUrlForLoad(url) {
  return normalizeEmbeddedBrowserUrl(url);
}

// Broadcasts the PRESENTED (canvas-visible) view's state to the renderer.
function broadcastNativeBrowserState(extra = {}) {
  const partition = presentedNativePartition;
  const view = partition ? getNativeViewByPartition(partition) : null;
  const wc = view?.webContents;
  if (wc && !wc.isDestroyed()) {
    const meta = nativeViewMeta(view);
    meta.url = wc.getURL() || meta.url || 'about:blank';
    meta.title = wc.getTitle() || meta.title || '';
    meta.loading = wc.isLoading();
    nativeBrowserState.url = meta.url;
    nativeBrowserState.title = meta.title;
    nativeBrowserState.loading = meta.loading;
    nativeBrowserState.profile = nativeProfileFromPartition(partition);
    nativeBrowserState.partition = partition;
  }
  const payload = { ...nativeBrowserState, ...extra, timestamp: Date.now() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('native-browser-state', payload); } catch {}
  }
  return payload;
}

// Per-session state payload (used by RPC results so each owner/profile gets its
// OWN url/title/loading rather than whatever happens to be presented).
function nativeSessionStatePayload(sessionId, view, partition, extra = {}) {
  const meta = nativeViewMeta(view);
  const wc = view.webContents;
  if (wc && !wc.isDestroyed()) {
    meta.url = wc.getURL() || meta.url || 'about:blank';
    meta.title = wc.getTitle() || meta.title || '';
    meta.loading = wc.isLoading();
  }
  return {
    sessionId: String(sessionId || ''),
    profile: nativeProfileFromPartition(partition),
    partition,
    attached: true,
    url: meta.url,
    title: meta.title,
    loading: meta.loading,
    lastError: meta.lastError || '',
    presented: partition === presentedNativePartition,
    timestamp: Date.now(),
    ...extra,
  };
}

// Emits a session state payload and, when that session's view is the presented
// one, refreshes the canvas-facing broadcast too.
function emitNativeSessionState(sessionId, view, partition, extra = {}) {
  const payload = nativeSessionStatePayload(sessionId, view, partition, extra);
  if (partition === presentedNativePartition) broadcastNativeBrowserState();
  return payload;
}

function wireNativeViewEvents(view, partition) {
  const wc = view.webContents;
  const meta = nativeViewMeta(view);
  const onUpdate = () => { if (partition === presentedNativePartition) broadcastNativeBrowserState(); };
  // DEBUG: surface the in-house view's console (incl. preload) to the main log.
  wc.on('console-message', (_e, level, message) => {
    if (String(message || '').includes('[inhouse-preload]')) writeGatewayLog(`[main][inhouse-view] ${message}\n`);
  });
  wc.on('preload-error', (_e, preloadPath, error) => {
    writeGatewayLog(`[main][inhouse-preload-error] ${preloadPath}: ${error && error.message ? error.message : error}\n`);
  });
  wc.setWindowOpenHandler(({ url }) => {
    try {
      const targetUrl = normalizeBrowserUrlForLoad(url);
      if (targetUrl !== 'about:blank') {
        wc.loadURL(targetUrl).catch((err) => { meta.lastError = err?.message || String(err); onUpdate(); });
      }
    } catch (err) {
      meta.lastError = err?.message || String(err);
      onUpdate();
    }
    return { action: 'deny' };
  });
  wc.on('did-start-loading', () => { meta.loading = true; onUpdate(); });
  wc.on('did-stop-loading', () => { meta.loading = false; onUpdate(); });
  wc.on('did-navigate', (_event, url) => { meta.url = url || wc.getURL() || meta.url; meta.title = wc.getTitle() || meta.title || ''; onUpdate(); });
  wc.on('did-navigate-in-page', (_event, url) => { meta.url = url || wc.getURL() || meta.url; meta.title = wc.getTitle() || meta.title || ''; onUpdate(); });
  wc.on('page-title-updated', (_event, title) => { meta.title = title || wc.getTitle() || ''; onUpdate(); });
  wc.on('did-fail-load', (_event, _code, description, validatedURL) => { meta.lastError = description || 'Native browser load failed.'; meta.url = validatedURL || wc.getURL() || meta.url; onUpdate(); });
}

// Ensures a view exists for the resolved profile partition and maps the session
// to it. Returns { view, partition }.
function ensureNativeBrowserView(sessionId = '', profileId = '') {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Prometheus window is not ready.');
  if (!nativeBrowserState.available) throw new Error('Electron native browser surface is unavailable in this runtime.');
  const partition = resolveNativePartition(sessionId, profileId);
  const sid = String(sessionId || '').trim();
  if (sid) nativeBrowserSessionPartitions.set(sid, partition);

  let view = getNativeViewByPartition(partition);
  if (view) return { view, partition };

  const webPreferences = {
    partition,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    preload: path.join(__dirname, 'inhouse-browser-preload.js'),
  };
  view = WebContentsView
    ? new WebContentsView({ webPreferences })
    : new BrowserView({ webPreferences });

  if (WebContentsView && mainWindow.contentView?.addChildView) {
    mainWindow.contentView.addChildView(view);
  } else if (typeof mainWindow.addBrowserView === 'function') {
    mainWindow.addBrowserView(view);
  } else if (typeof mainWindow.setBrowserView === 'function') {
    mainWindow.setBrowserView(view);
  }
  view.setBounds({ ...NATIVE_BROWSER_EMPTY_BOUNDS });
  applyNativeBrowserUserAgent(view);
  wireNativeViewEvents(view, partition);
  nativeBrowserViews.set(partition, view);
  return { view, partition };
}

function requireNativeViewForSession(sessionId, profileId = '') {
  const { view, partition } = ensureNativeBrowserView(sessionId, profileId);
  const wc = view.webContents;
  if (!wc || wc.isDestroyed()) throw new Error('Native browser view is not available.');
  return { view, wc, partition };
}

// Makes one profile's view the canvas-visible one and parks all others at zero
// size, so only a single in-house browser is ever painted in the panel.
function presentNativeView(partition) {
  presentedNativePartition = partition;
  nativeBrowserState.partition = partition;
  nativeBrowserState.profile = nativeProfileFromPartition(partition);
  for (const [p, v] of nativeBrowserViews) {
    if (p !== partition) { try { v.setBounds({ ...NATIVE_BROWSER_EMPTY_BOUNDS }); } catch {} }
  }
}

function setNativeBrowserBounds(bounds = {}, sessionId = '') {
  const sid = String(sessionId || nativeBrowserState.sessionId || '').trim();
  const partition = resolveNativePartition(sid, '');
  presentNativeView(partition);
  const next = normalizeNativeBrowserBounds(bounds);
  nativeBrowserState.bounds = next;
  nativeBrowserState.visible = nativeBrowserState.attached && next.width > 8 && next.height > 8;
  const view = getNativeViewByPartition(partition);
  if (view) {
    try {
      view.setBounds(nativeBrowserState.visible ? next : { ...NATIVE_BROWSER_EMPTY_BOUNDS });
    } catch (err) {
      nativeViewMeta(view).lastError = err?.message || String(err);
    }
  }
  return broadcastNativeBrowserState();
}

function hideNativeBrowserSurface(reason = '') {
  nativeBrowserState.visible = false;
  nativeBrowserState.bounds = { ...NATIVE_BROWSER_EMPTY_BOUNDS };
  const view = presentedNativePartition ? getNativeViewByPartition(presentedNativePartition) : null;
  if (view) { try { view.setBounds({ ...NATIVE_BROWSER_EMPTY_BOUNDS }); } catch {} }
  return broadcastNativeBrowserState({ reason });
}

async function openNativeBrowserSurface({ sessionId = '', url = '', profile = '' } = {}) {
  const { view, wc, partition } = requireNativeViewForSession(sessionId, profile);
  nativeBrowserState.attached = true;
  if (sessionId) nativeBrowserState.sessionId = String(sessionId);
  const meta = nativeViewMeta(view);
  meta.lastError = '';
  const targetUrl = normalizeBrowserUrlForLoad(url || meta.url || 'about:blank');
  if (targetUrl && targetUrl !== 'about:blank') await wc.loadURL(targetUrl);
  meta.url = wc.getURL() || targetUrl;
  meta.title = wc.getTitle() || '';
  return emitNativeSessionState(sessionId, view, partition);
}

// Idempotent attach used by the renderer to (re)mount + present the view without
// forcing a navigation. It only loads the requested URL when the view has no real
// page yet, which prevents the render → attach → reload → broadcast → render echo
// loop. Explicit navigation goes through openNativeBrowserSurface / navigate.
async function attachNativeBrowserSurface({ sessionId = '', url = '', profile = '' } = {}) {
  const { view, wc, partition } = requireNativeViewForSession(sessionId, profile);
  presentNativeView(partition);
  nativeBrowserState.attached = true;
  if (sessionId) nativeBrowserState.sessionId = String(sessionId);
  const meta = nativeViewMeta(view);
  meta.lastError = '';
  const currentUrl = String(wc.getURL() || '').trim();
  const hasRealPage = currentUrl && currentUrl !== 'about:blank';
  if (!hasRealPage) {
    const targetUrl = normalizeBrowserUrlForLoad(url || meta.url || 'about:blank');
    if (targetUrl && targetUrl !== 'about:blank') await wc.loadURL(targetUrl);
  }
  meta.url = wc.getURL() || meta.url || 'about:blank';
  meta.title = wc.getTitle() || meta.title || '';
  return broadcastNativeBrowserState();
}

async function navigateNativeBrowserSurface({ action = '', url = '', sessionId = '' } = {}) {
  const { view, wc, partition } = requireNativeViewForSession(sessionId);
  const normalized = String(action || '').trim().toLowerCase();
  if (normalized === 'back') {
    if (wc.canGoBack()) wc.goBack();
  } else if (normalized === 'forward') {
    if (wc.canGoForward()) wc.goForward();
  } else if (normalized === 'reload') {
    wc.reload();
  } else if (normalized === 'open') {
    await wc.loadURL(normalizeBrowserUrlForLoad(url));
  } else {
    throw new Error(`Unsupported native browser navigation action "${normalized || 'unknown'}".`);
  }
  return emitNativeSessionState(sessionId, view, partition);
}

// Toggle Teach-mode click capture inside the in-house view's preload. When on,
// the user's clicks are intercepted (not performed) and reported back so the
// renderer can stage a Teach step.
function setNativeBrowserTeachCapture({ sessionId = '', enabled = false } = {}) {
  const { wc } = requireNativeViewForSession(sessionId);
  wc.send('prometheus-teach-capture', !!enabled);
  writeGatewayLog(`[main] teach-capture set enabled=${!!enabled} sessionId=${sessionId}\n`);
  return { ok: true, enabled: !!enabled };
}

function stateNativeBrowserSurface({ sessionId = '' } = {}) {
  const sid = String(sessionId || '').trim();
  if (sid && nativeBrowserSessionPartitions.has(sid)) {
    const partition = nativeBrowserSessionPartitions.get(sid);
    const view = getNativeViewByPartition(partition);
    if (view) return nativeSessionStatePayload(sid, view, partition);
  }
  return broadcastNativeBrowserState();
}

function buildNativeSnapshotScript() {
  return `(() => {
    const selector = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"],summary';
    const visible = (el) => {
      const rect = el.getBoundingClientRect && el.getBoundingClientRect();
      if (!rect || (rect.width <= 0 && rect.height <= 0)) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };
    const textOf = (el) => String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || el.value || el.href || el.tagName || '').replace(/\\s+/g, ' ').trim().slice(0, 140);
    const roleOf = (el) => String(el.getAttribute('role') || el.tagName || '').toLowerCase();
    const inputish = (el) => {
      const tag = String(el.tagName || '').toLowerCase();
      const role = roleOf(el);
      return ['input','textarea','select'].includes(tag) || el.isContentEditable || ['textbox','searchbox','combobox'].includes(role);
    };
    const elements = Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, 240).map((el, index) => {
      const ref = index + 1;
      try { el.setAttribute('data-prometheus-native-ref', String(ref)); } catch {}
      const rect = el.getBoundingClientRect();
      return {
        ref,
        role: roleOf(el),
        tag: String(el.tagName || '').toLowerCase(),
        name: textOf(el),
        isInput: inputish(el),
        selector: el.id ? '#' + CSS.escape(el.id) : '',
        bounds: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    });
    const lines = [
      'Page: ' + (document.title || location.href),
      'URL: ' + location.href,
      'Elements (' + elements.length + '):',
      ...elements.map((el) => '@' + el.ref + ' [' + (el.isInput ? 'INPUT ' : '') + (el.role || el.tag || 'element') + '] ' + (el.name || el.selector || el.tag))
    ];
    return { url: location.href, title: document.title || '', viewportWidth: innerWidth, viewportHeight: innerHeight, elements, snapshot: lines.join('\\n') };
  })()`;
}

async function executeNativeBrowserJavaScript(code, sessionId = '') {
  const { wc } = requireNativeViewForSession(sessionId);
  return wc.executeJavaScript(code, true);
}

async function snapshotNativeBrowserSurface(sessionId = '') {
  const { view, wc, partition } = requireNativeViewForSession(sessionId);
  const result = await wc.executeJavaScript(buildNativeSnapshotScript(), true);
  const meta = nativeViewMeta(view);
  meta.url = String(result?.url || meta.url || '');
  meta.title = String(result?.title || meta.title || '');
  if (partition === presentedNativePartition) broadcastNativeBrowserState();
  return result;
}

function nativeTargetSelector(payload = {}) {
  return payload.selector
    ? `document.querySelector(${JSON.stringify(String(payload.selector))})`
    : `document.querySelector('[data-prometheus-native-ref="${Number(payload.ref || 0)}"]')`;
}

// Locate an element, scroll it into view, and return its viewport-center click
// point plus metadata. Used so clicks/fills dispatch REAL OS input events at the
// correct pixel (trusted, isTrusted=true) instead of synthetic el.click().
async function locateNativeElement(payload = {}, sessionId = '') {
  return executeNativeBrowserJavaScript(`(() => {
    const el = ${nativeTargetSelector(payload)};
    if (!el) return { ok: false, error: 'Target element not found.' };
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const cx = Math.round(Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)));
    const cy = Math.round(Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)));
    const tag = String(el.tagName || '').toLowerCase();
    const name = String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || el.tagName || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    const role = String(el.getAttribute('role') || el.tagName || '').toLowerCase();
    const editable = tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
    return { ok: true, x: cx, y: cy, tag, role, name, editable,
      bounds: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } };
  })()`, sessionId);
}

function sendNativeMouseClick(wc, x, y, button = 'left') {
  wc.focus();
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
}

async function clickNativeBrowserSurface(payload = {}) {
  const sessionId = payload.sessionId || '';
  await snapshotNativeBrowserSurface(sessionId).catch(() => null);
  const { wc } = requireNativeViewForSession(sessionId);
  const located = await locateNativeElement(payload, sessionId);
  if (!located?.ok) throw new Error(located?.error || 'Target element not found.');
  // Real trusted click at the element's center — matches how Playwright clicks
  // Chrome (coordinate-based, isTrusted=true) so sites like X accept it.
  sendNativeMouseClick(wc, located.x, located.y, payload.button === 'right' ? 'right' : 'left');
  return located;
}

async function fillNativeBrowserSurface(payload = {}) {
  const sessionId = payload.sessionId || '';
  await snapshotNativeBrowserSurface(sessionId).catch(() => null);
  const text = String(payload.text || '');
  const { wc } = requireNativeViewForSession(sessionId);
  const located = await locateNativeElement(payload, sessionId);
  if (!located?.ok) throw new Error(located?.error || 'Target element not found.');
  // Focus the field with a real click, select any existing content, then type
  // the value as TRUSTED input. This is required for rich editors like X's
  // Draft.js composer (a contenteditable) that ignore programmatic textContent,
  // and it keeps isTrusted=true so anti-bot checks accept it.
  sendNativeMouseClick(wc, located.x, located.y, 'left');
  await executeNativeBrowserJavaScript(`(() => {
    const el = ${nativeTargetSelector(payload)};
    if (!el) return false;
    el.focus?.();
    try {
      if (typeof el.select === 'function') el.select();
      else if (typeof el.setSelectionRange === 'function') el.setSelectionRange(0, String(el.value || '').length);
      else { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    } catch {}
    return true;
  })()`, sessionId);
  // Replace the selection with the new text via the real input pipeline.
  if (text) {
    wc.insertText(text);
  } else {
    // Empty value = clear the field.
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' });
  }
  // For plain input/textarea, also fire change so frameworks that only listen on
  // blur/change settle their state.
  await executeNativeBrowserJavaScript(`(() => {
    const el = ${nativeTargetSelector(payload)};
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`, sessionId).catch(() => null);
  return { ok: true, role: located.role, name: located.name, bounds: located.bounds };
}

async function inputNativeBrowserSurface(payload = {}) {
  const { wc } = requireNativeViewForSession(payload.sessionId || '');
  const action = String(payload.action || '').trim().toLowerCase();
  if (action === 'text') {
    wc.insertText(String(payload.text || ''));
  } else if (action === 'key') {
    const keyCode = String(payload.key || 'Enter');
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
  } else if (action === 'wheel') {
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: Math.max(0, Math.round(Number(payload.x || 0))),
      y: Math.max(0, Math.round(Number(payload.y || 0))),
      deltaX: Number(payload.deltaX || 0),
      deltaY: Number(payload.deltaY || 0),
      canScroll: true,
    });
  } else if (action === 'click') {
    const x = Math.max(0, Math.round(Number(payload.x || 0)));
    const y = Math.max(0, Math.round(Number(payload.y || 0)));
    const button = payload.button === 'right' ? 'right' : 'left';
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
  } else {
    throw new Error(`Unsupported native browser input action "${action || 'unknown'}".`);
  }
  return { ok: true };
}

async function screenshotNativeBrowserSurface(sessionId = '') {
  const { view, wc, partition } = requireNativeViewForSession(sessionId);
  const image = await wc.capturePage();
  const size = image.getSize();
  const meta = nativeViewMeta(view);
  // capturePage returns PHYSICAL pixels (size scaled by devicePixelRatio), but
  // native input events use CSS pixels. Report the CSS viewport so the gateway can
  // scale vision-click coordinates back from image space to CSS space.
  let viewport = { width: size.width, height: size.height };
  try {
    viewport = await wc.executeJavaScript('({ width: window.innerWidth, height: window.innerHeight })', true);
  } catch {}
  return {
    base64: image.toPNG().toString('base64'),
    width: size.width,
    height: size.height,
    viewportWidth: Number(viewport?.width || size.width) || size.width,
    viewportHeight: Number(viewport?.height || size.height) || size.height,
    mimeType: 'image/png',
    url: meta.url,
    title: meta.title,
    profile: nativeProfileFromPartition(partition),
  };
}

async function inspectNativeBrowserPoint(payload = {}) {
  const sessionId = payload.sessionId || '';
  const point = { x: Math.max(0, Math.round(Number(payload.x || 0))), y: Math.max(0, Math.round(Number(payload.y || 0))) };
  return executeNativeBrowserJavaScript(`((point) => {
    const el = document.elementFromPoint(point.x, point.y);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const selector = el.id ? '#' + CSS.escape(el.id) : (el.getAttribute('data-prometheus-native-ref') ? '[data-prometheus-native-ref="' + el.getAttribute('data-prometheus-native-ref') + '"]' : el.tagName.toLowerCase());
    return {
      selector,
      tagName: String(el.tagName || '').toLowerCase(),
      role: String(el.getAttribute('role') || '').toLowerCase(),
      id: String(el.id || ''),
      text: String(el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
      bounds: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      viewport: { width: innerWidth, height: innerHeight }
    };
  })(${JSON.stringify(point)})`, sessionId);
}

async function startNativeBrowserRpcServer() {
  if (nativeBrowserRpcServer) return nativeBrowserRpcPort;
  nativeBrowserRpcServer = http.createServer((req, res) => {
    const respond = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body || {}));
    };
    if (req.method !== 'POST') return respond(405, { error: 'Method not allowed.' });
    if (req.headers.authorization !== `Bearer ${NATIVE_BROWSER_RPC_TOKEN}`) {
      return respond(401, { error: 'Unauthorized.' });
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', async () => {
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { return respond(400, { error: 'Invalid JSON.' }); }
      try {
        const pathName = new URL(req.url || '/', 'http://127.0.0.1').pathname;
        let result;
        if (pathName === '/state') result = stateNativeBrowserSurface(payload);
        else if (pathName === '/attach') result = await attachNativeBrowserSurface(payload);
        else if (pathName === '/bounds') result = setNativeBrowserBounds(payload.bounds || payload, payload.sessionId);
        else if (pathName === '/hide') result = hideNativeBrowserSurface('rpc hide');
        else if (pathName === '/open') result = await openNativeBrowserSurface(payload);
        else if (pathName === '/navigate') result = await navigateNativeBrowserSurface(payload);
        else if (pathName === '/snapshot') result = await snapshotNativeBrowserSurface(payload.sessionId);
        else if (pathName === '/click') result = await clickNativeBrowserSurface(payload);
        else if (pathName === '/fill') result = await fillNativeBrowserSurface(payload);
        else if (pathName === '/input') result = await inputNativeBrowserSurface(payload);
        else if (pathName === '/screenshot') result = await screenshotNativeBrowserSurface(payload.sessionId);
        else if (pathName === '/inspect') result = await inspectNativeBrowserPoint(payload);
        else if (pathName === '/run-js') result = await executeNativeBrowserJavaScript(String(payload.code || ''), payload.sessionId);
        else return respond(404, { error: 'Unknown native browser RPC route.' });
        return respond(200, { ok: true, result });
      } catch (err) {
        nativeBrowserState.lastError = err?.message || String(err);
        broadcastNativeBrowserState();
        return respond(500, { error: nativeBrowserState.lastError });
      }
    });
  });
  await new Promise((resolve, reject) => {
    nativeBrowserRpcServer.once('error', reject);
    nativeBrowserRpcServer.listen(0, '127.0.0.1', () => {
      nativeBrowserRpcServer.off('error', reject);
      nativeBrowserRpcPort = nativeBrowserRpcServer.address().port;
      resolve();
    });
  });
  writeGatewayLog(`[main] Native browser RPC listening on 127.0.0.1:${nativeBrowserRpcPort}\n`);
  return nativeBrowserRpcPort;
}

// ─── Loading Screen ────────────────────────────────────────────────────────
function createLoadingWindow() {
  const loader = new BrowserWindow({
    width:           420,
    height:          300,
    frame:           false,
    resizable:       false,
    center:          true,
    icon:            ICON_IMAGE.isEmpty() ? ICON_PATH : ICON_IMAGE,
    backgroundColor: '#0a0a0a',
    webPreferences:  { nodeIntegration: false },
  });

  loader.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100vh; gap: 20px; user-select: none;
  }
  h1 {
    font-size: 24px; font-weight: 700; letter-spacing: 0.08em;
    background: linear-gradient(135deg, #f97316, #facc15);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  p { font-size: 13px; color: #666; }
  .spinner {
    width: 36px; height: 36px; border: 3px solid #1a1a1a;
    border-top-color: #f97316; border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="spinner"></div>
  <h1>PROMETHEUS</h1>
  <p>Starting gateway…</p>
</body>
</html>
  `)}`);

  return loader;
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────
const PAIRING_ADMIN_ROUTES = [
  ['POST', /^\/api\/pairing\/qr$/],
  ['GET', /^\/api\/pairing\/pending$/],
  ['POST', /^\/api\/pairing\/(?:approve|deny)$/],
  ['GET', /^\/api\/pairing\/devices$/],
  ['PATCH', /^\/api\/pairing\/devices\/[^/?#]+$/],
  ['DELETE', /^\/api\/pairing\/devices\/[^/?#]+$/],
  ['GET', /^\/api\/pairing\/remote-access$/],
  ['PUT', /^\/api\/pairing\/remote-access$/],
  ['GET', /^\/api\/pairing\/tailscale\/status$/],
  ['GET', /^\/api\/pairing\/tailscale\/funnel\/status$/],
  ['POST', /^\/api\/pairing\/tailscale\/funnel\/(?:enable|disable)$/],
];

function requireTrustedMainFrame(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('This desktop operation is available only from the Prometheus window.');
  }
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Desktop operations are not available to child frames.');
  }
  if (!isTrustedRendererUrl(event.senderFrame.url, GATEWAY_URL)) {
    throw new Error('Untrusted desktop operation sender.');
  }
}

function handleTrustedMain(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    requireTrustedMainFrame(event);
    return handler(event, ...args);
  });
}

function requireTrustedNativeMainFrame(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Teach capture events are accepted only from an embedded browser main frame.');
  }
  const partition = presentedNativePartition;
  const view = partition ? getNativeViewByPartition(partition) : null;
  if (!view || view.webContents !== event.sender) {
    throw new Error('Teach capture events are accepted only from the presented browser surface.');
  }
  const sessionId = String(nativeBrowserState.sessionId || '').trim();
  if (!sessionId || nativeBrowserSessionPartitions.get(sessionId) !== partition) {
    throw new Error('Teach capture has no validated owning session.');
  }
  return sessionId;
}

function relayTeachEvent(event, channel, payload = {}) {
  let sessionId;
  try {
    sessionId = requireTrustedNativeMainFrame(event);
  } catch (error) {
    writeGatewayLog(`[main] Rejected ${channel}: ${error && error.message ? error.message : error}\n`);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(channel, { ...payload, sessionId }); } catch {}
  }
}

handleTrustedMain('pairing-admin:request', async (_event, payload = {}) => {
  const method = String(payload?.method || 'GET').trim().toUpperCase();
  const requestPath = String(payload?.path || '').trim();
  let parsed;
  try {
    parsed = new URL(requestPath, GATEWAY_URL);
  } catch {
    throw new Error('Invalid pairing administration path.');
  }
  if (parsed.origin !== new URL(GATEWAY_URL).origin || parsed.search || parsed.hash) {
    throw new Error('Invalid pairing administration path.');
  }
  const allowed = PAIRING_ADMIN_ROUTES.some(([allowedMethod, pattern]) => (
    allowedMethod === method && pattern.test(parsed.pathname)
  ));
  if (!allowed) throw new Error('Pairing administration route is not allowed.');

  const body = payload?.body === undefined ? undefined : JSON.stringify(payload.body);
  if (body && Buffer.byteLength(body, 'utf8') > 64 * 1024) {
    throw new Error('Pairing administration request is too large.');
  }
  const response = await fetch(parsed.href, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Prometheus-Pairing-Admin': PAIRING_ADMIN_TOKEN,
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
  const responseText = await response.text();
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; }
  catch { throw new Error(`Pairing administration returned an invalid response (${response.status}).`); }
  if (!response.ok) throw new Error(String(data?.error || `Pairing administration failed (${response.status}).`));
  return data;
});

handleTrustedMain('get-app-version', () => CURRENT_VERSION);

handleTrustedMain('select-canvas-paths', async (_event, options = {}) => {
  const mode = options && options.mode === 'folder' ? 'folder' : 'files';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: mode === 'folder' ? 'Add Folder to Canvas' : 'Add Files to Canvas',
    properties: mode === 'folder'
      ? ['openDirectory']
      : ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return Array.isArray(result.filePaths) ? result.filePaths : [];
});

handleTrustedMain('native-browser:available', () => nativeBrowserState.available === true);
handleTrustedMain('native-browser:attach', async (_event, options = {}) => attachNativeBrowserSurface(options));
handleTrustedMain('native-browser:detach', async () => hideNativeBrowserSurface('detached'));
handleTrustedMain('native-browser:set-bounds', async (_event, bounds = {}) => setNativeBrowserBounds(bounds, bounds && bounds.sessionId));
handleTrustedMain('native-browser:navigate', async (_event, payload = {}) => navigateNativeBrowserSurface(payload));
handleTrustedMain('native-browser:focus', async () => {
  const sid = String(nativeBrowserState.sessionId || '').trim();
  try { requireNativeViewForSession(sid).wc.focus(); } catch {}
  return broadcastNativeBrowserState();
});
handleTrustedMain('native-browser:state', async () => broadcastNativeBrowserState());
handleTrustedMain('native-browser:teach-capture', async (_event, options = {}) => setNativeBrowserTeachCapture(options));

// Relay Teach capture events from the in-house view's preload to the Prometheus
// renderer, tagged with the presented session so the right Teach session records.
ipcMain.on('prometheus-teach-click', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-teach-click', payload);
});
ipcMain.on('prometheus-teach-hover', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-teach-hover', payload);
});
ipcMain.on('prometheus-teach-fill', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-teach-fill', payload);
});
ipcMain.on('prometheus-teach-key', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-teach-key', payload);
});
ipcMain.on('prometheus-teach-scroll', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-teach-scroll', payload);
});

handleTrustedMain('updater:get-state', () => getUpdaterState());

handleTrustedMain('updater:check', async () => checkForPrometheusUpdates('manual'));

handleTrustedMain('updater:install', async () => {
  if (!autoUpdater) {
    updaterStatus = 'unsupported';
    updaterMessage = 'Updates are available only in packaged public builds.';
    return sendUpdaterState();
  }
  if (updaterInstalling) return sendUpdaterState();
  if (!pendingUpdate) {
    return checkForPrometheusUpdates('install');
  }

  updaterInstalling = true;
  updaterStatus = 'installing';
  updaterMessage = 'Closing Prometheus to install the update...';
  sendUpdaterState();

  isQuitting = true;
  autoUpdater.quitAndInstall(false, true); // isSilent=false, isForceRunAfter=true
  return getUpdaterState();
});

// ─── Main Window ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1440,
    height:          920,
    minWidth:        960,
    minHeight:       640,
    icon:            ICON_IMAGE.isEmpty() ? ICON_PATH : ICON_IMAGE,
    title:           'Prometheus',
    backgroundColor: '#0a0a0a',
    show:            false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          true,
    },
    autoHideMenuBar: true,
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(GATEWAY_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  const openExternalSafely = (url) => {
    const externalUrl = normalizeExternalUrl(url);
    if (!externalUrl) {
      writeGatewayLog(`[main] Blocked unsafe external URL: ${String(url || '').slice(0, 300)}\n`);
      return;
    }
    shell.openExternal(externalUrl).catch((error) => {
      writeGatewayLog(`[main] Failed to open external URL: ${error && error.message ? error.message : error}\n`);
    });
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedRendererUrl(url, GATEWAY_URL)) {
      mainWindow.loadURL(url);
    } else {
      openExternalSafely(url);
    }
    return { action: 'deny' };
  });

  const guardMainNavigation = (event, url) => {
    if (isTrustedRendererUrl(url, GATEWAY_URL)) return;
    event.preventDefault();
    openExternalSafely(url);
  };
  mainWindow.webContents.on('will-navigate', guardMainNavigation);
  mainWindow.webContents.on('will-redirect', guardMainNavigation);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Auto-Update Events ────────────────────────────────────────────────────
// Wire after createWindow() has been called so mainWindow exists.
function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.on('checking-for-update', () => {
    updaterStatus = 'checking';
    updaterMessage = 'Checking for the latest Prometheus release...';
    updaterProgress = 0;
    sendUpdaterState();
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Update available: v${info.version}`);
    updaterStatus = 'downloading';
    updaterMessage = `Downloading Prometheus ${info.version || 'update'}...`;
    updaterProgress = 0;
    sendUpdaterState({
      version: info.version || '',
      releaseName: info.releaseName || (info.version ? `v${info.version}` : ''),
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    });
    // Start download automatically (autoDownload=true handles this).
  });

  autoUpdater.on('update-not-available', () => {
    pendingUpdate = null;
    updaterStatus = 'idle';
    updaterMessage = 'Prometheus is up to date.';
    updaterProgress = 0;
    sendUpdaterState();
  });

  autoUpdater.on('download-progress', (progress) => {
    updaterStatus = 'downloading';
    updaterMessage = 'Downloading update...';
    updaterProgress = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', updaterProgress);
    }
    sendUpdaterState();
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Update downloaded: v${info.version} — ready to install`);
    pendingUpdate = info;
    updaterStatus = 'ready';
    updaterMessage = 'Update downloaded and ready to install.';
    updaterProgress = 100;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-ready', {
        version:     info.version,
        releaseName: info.releaseName || `v${info.version}`,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
      });
    }
    sendUpdaterState();
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    updaterStatus = 'error';
    updaterMessage = err && err.message ? err.message : 'Update check failed.';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', updaterMessage);
    }
    sendUpdaterState();
  });

  // Delay the first check so it doesn't race with gateway startup.
  setTimeout(() => {
    checkForPrometheusUpdates('startup').catch((e) => {
      console.error('[Updater] startup check failed:', e.message);
    });
  }, 10_000); // 10s after app is ready
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {

  // ── Step 1: First-run / post-update dependency check ──────────────────
  if (!IS_PACKAGED_RUNTIME && (needsDependencySetup() || getMissingPackages().length > 0)) {
    const setupWin = createSetupWindow();
    await runDependencySetup(setupWin);
    setupWin.close();
  }

  // ── Step 2: Show loading splash + start gateway ────────────────────────
  const loader = createLoadingWindow();
  try {
    await startNativeBrowserRpcServer();
  } catch (err) {
    writeGatewayLog(`[main] Native browser RPC unavailable: ${err && err.message ? err.message : err}\n`);
  }
  try {
    startGateway();
    await waitForGateway();
    createWindow();
    loader.close();
    setupAutoUpdater();
    startGatewayHealthWatchdog();
  } catch (err) {
    loader.close();
    const lastOutput = getLastGatewayOutput();
    dialog.showErrorBox(
      'Prometheus — Startup Failed',
      `The Prometheus gateway did not start in time.\n\n${err.message}\n\nLast gateway output:\n${lastOutput || '(none — check log file)'}\n\nFull log: ${GATEWAY_LOG_PATH}`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  isQuitting = true;
  app.quit();
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (gatewayHealthTimer) {
    clearInterval(gatewayHealthTimer);
    gatewayHealthTimer = null;
  }

  // If gateway is already gone or we already started shutdown, let quit proceed.
  if (!gatewayProcess || gatewayProcess.killed || gatewayShuttingDown) return;

  gatewayShuttingDown = true;
  event.preventDefault();

  const forceKillAndQuit = () => {
    try {
      if (process.platform === 'win32' && gatewayProcess && gatewayProcess.pid) {
        execSync(`taskkill /PID ${gatewayProcess.pid} /F /T`, { stdio: 'pipe' });
      } else if (gatewayProcess) {
        gatewayProcess.kill('SIGKILL');
      }
    } catch {}
    app.quit();
  };

  const onExit = () => {
    clearTimeout(fallbackTimer);
    app.quit();
  };
  gatewayProcess.once('exit', onExit);

  // Force-kill fallback — gateway's own gracefulShutdown has a 1.2s hard exit,
  // so 3s is more than enough.
  const fallbackTimer = setTimeout(() => {
    if (gatewayProcess) gatewayProcess.removeListener('exit', onExit);
    forceKillAndQuit();
  }, 3000);

  // Ask the gateway to shut down gracefully via HTTP.
  const req = http.request(
    { hostname: '127.0.0.1', port: 18789, path: '/api/internal/shutdown', method: 'POST', timeout: 1000 },
    (res) => { res.resume(); } // response received — gateway is draining, wait for 'exit'
  );
  req.on('error', () => {
    // Gateway unreachable — skip straight to force-kill.
    clearTimeout(fallbackTimer);
    if (gatewayProcess) gatewayProcess.removeListener('exit', onExit);
    forceKillAndQuit();
  });
  req.end();
});
