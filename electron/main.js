/**
 * Prometheus Desktop - Electron Main Process
 *
 * Spawns the Prometheus gateway
 * then opens a BrowserWindow pointed at the selected local gateway port
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
  session,
  shell,
  Menu,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
} = require('electron');
const { spawn, execSync, execFileSync }  = require('child_process');
const path       = require('path');
const http       = require('http');
const net        = require('net');
const fs         = require('fs');
const crypto     = require('crypto');
const { createGatewayReverseProxy } = require('./gateway-reverse-proxy');
const {
  isLocalGatewayUrl,
  isTrustedRendererUrl,
  normalizeEmbeddedBrowserUrl,
  normalizeExternalUrl,
  normalizePassthroughExternalUrl,
  parseWindowsListeningPids,
} = require('./security');
const { getNativeBrowserViewImplementations } = require('./native-browser-view');
const {
  getChromeProfileCatalog,
  getImportedChromeProfile,
  copyChromeProfile,
} = require('./chrome-profile');
const {
  getPosixListeningPids,
  killGatewayPortOwner,
  killGatewayProcessTree: killManagedGatewayProcessTree,
} = require('./gateway-process');

// ─── Config ────────────────────────────────────────────────────────────────
function parseGatewayPort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}
const requestedGatewayPort = parseGatewayPort(
  process.env.PROMETHEUS_GATEWAY_PORT || process.env.GATEWAY_PORT,
);
// A caller can pin a port for a separately managed Electron instance. Normal
// desktop launches select an available port below and keep it stable in their
// own profile rather than depending on the historic 18789 default.
let gatewayPort = requestedGatewayPort;
let GATEWAY_URL = `http://127.0.0.1:${gatewayPort || 0}`;
// Electron holds gatewayPort for its entire lifetime. The gateway child uses a
// private loopback port so it can be replaced without making Tailscale Funnel
// lose the public listener that paired mobile devices know.
let gatewayBackendPort = null;
let gatewayRelay = null;
const APP_ID       = 'com.prometheus.desktop';
const APP_ROOT     = path.join(__dirname, '..');
const ICON_PATH    = path.join(
  APP_ROOT,
  'assets',
  process.platform === 'darwin' ? 'Prometheus.png' : 'Prometheus.ico',
);
const ICON_IMAGE   = nativeImage.createFromPath(ICON_PATH);
const MAX_RETRIES  = 200;  // 200 x 300ms = 60s max wait (dev tsx startup can be slow)
const RETRY_DELAY  = 300;
// Keep the renderer header and the native Windows/Linux caption controls on
// the same physical row. This value is also mirrored by --window-chrome-height
// in web-ui/src/styles/base.css.
const ELECTRON_TITLEBAR_HEIGHT = 30;
const DEFAULT_TITLEBAR_COLOR = '#1f1f1f';
const DEFAULT_TITLEBAR_SYMBOL_COLOR = '#d8c9a8';
const GATEWAY_HEALTH_INTERVAL_MS = 15_000;
const GATEWAY_HEALTH_TIMEOUT_MS = 5_000;
const GATEWAY_HEALTH_FAILURE_LIMIT = 2;
const GATEWAY_BUSY_RECOVERY_GRACE_MS = 45_000;
const GATEWAY_QUIT_GRACE_MS = 12_000;
const PACKAGE_JSON = require(path.join(APP_ROOT, 'package.json'));
const IS_PUBLIC_BUILD = String(process.env.PROMETHEUS_PUBLIC_BUILD || PACKAGE_JSON.prometheusBuild || '').trim().toLowerCase() === 'public';
const IS_PACKAGED_RUNTIME = app.isPackaged;
const IS_SOURCE_ELECTRON_DEV = !IS_PACKAGED_RUNTIME && process.env.PROMETHEUS_ELECTRON_DEV === '1';

// The source Electron launcher must never reuse the installed app's Chromium
// renderer cache. The gateway state stays shared below, but the renderer gets
// its own profile so a stale packaged instance cannot make current source UI
// look like an older release.
if (IS_SOURCE_ELECTRON_DEV) {
  app.commandLine.appendSwitch('disable-http-cache');
}

function getPackagedAppRoot() {
  // Public builds use app.asar, while the unsigned tester build intentionally
  // uses an unpacked Resources/app directory. Resolve the actual layout so
  // both distribution paths start the same compiled gateway entrypoint.
  const asarRoot = path.join(process.resourcesPath, 'app.asar');
  const unpackedRoot = path.join(process.resourcesPath, 'app');
  return fs.existsSync(asarRoot) ? asarRoot : unpackedRoot;
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

function resolveSourceGatewayNode() {
  const configured = String(process.env.PROMETHEUS_NODE_EXECUTABLE || '').trim();
  if (configured && fs.existsSync(configured)) return configured;
  if (process.platform === 'win32') {
    try {
      const located = String(execFileSync('where.exe', ['node'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2_000,
      }) || '')
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find((value) => value && fs.existsSync(value));
      if (located) return located;
    } catch {}
  }
  return 'node';
}

// ─── User Data Dir ─────────────────────────────────────────────────────────
const defaultUserDataDir = path.join(app.getPath('appData'), 'Prometheus');
const configuredUserDataDir = String(
  process.env.PROMETHEUS_ELECTRON_DATA_DIR || process.env.PROMETHEUS_INSTANCE_DATA_DIR || '',
).trim();
const USER_DATA_DIR = configuredUserDataDir
  ? path.resolve(configuredUserDataDir)
  : defaultUserDataDir;
// Keep the Electron profile aligned with the canonical Prometheus data root in
// source development too.  The vault master key is sealed through Electron's
// safeStorage, whose backing key is profile-scoped on Windows.  Using a
// source-only profile here made direct `electron .` launches unable to decrypt
// the key created by the installed desktop app, so the gateway silently fell
// back to the legacy plaintext key and all saved credentials appeared missing.
// The source renderer cache is still cleared below; the profile itself must be
// shared so installed and source runs use the same vault encryption context.
const ELECTRON_PROFILE_DIR = USER_DATA_DIR;
app.setAppUserModelId(APP_ID);
app.setName('Prometheus');
app.setPath('userData', ELECTRON_PROFILE_DIR);
if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ELECTRON_PROFILE_DIR)) {
  fs.mkdirSync(ELECTRON_PROFILE_DIR, { recursive: true });
}

// ─── First-Run Stamp ───────────────────────────────────────────────────────
// Stores the last version that completed dependency setup.
// If the version changes (app update), re-runs the check automatically.
const SETUP_STAMP_FILE = path.join(USER_DATA_DIR, '.setup-complete');
const CURRENT_VERSION  = require('../package.json').version;
const UPDATER_SETTINGS_FILE = path.join(USER_DATA_DIR, 'updater-settings.json');
const CANONICAL_UPDATE_CONFIG_DIR = path.join(USER_DATA_DIR, '.prometheus');
const GATEWAY_PORT_STATE_FILE = path.join(CANONICAL_UPDATE_CONFIG_DIR, 'electron-gateway-port.json');
const AUTO_GATEWAY_PORT_MIN = 20_000;
const AUTO_GATEWAY_PORT_MAX = 45_000;
const AUTO_GATEWAY_PORT_ATTEMPTS = 512;

// The shared updater protocol is compiled into dist for packaged builds. A
// missing module is a fail-safe condition: the app can run, but it cannot
// install an update or fall back to git/npm.
let canonicalUpdaterApi = null;
try {
  const canonicalPath = path.join(APP_ROOT, 'dist', 'update', 'canonical-updater.js');
  if (fs.existsSync(canonicalPath)) canonicalUpdaterApi = require(canonicalPath);
} catch (error) {
  console.error('[Updater] Canonical updater unavailable; updates disabled:', error && error.message ? error.message : error);
}

function readUpdaterSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(UPDATER_SETTINGS_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { autoUpdateEnabled: true };
    return {
      // Automatic updates are opt-out. Treat malformed/old settings as the
      // default so an interrupted write cannot silently disable updates.
      autoUpdateEnabled: parsed.autoUpdateEnabled !== false,
    };
  } catch {
    return { autoUpdateEnabled: true };
  }
}

function persistUpdaterSettings() {
  const tempPath = `${UPDATER_SETTINGS_FILE}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify({ autoUpdateEnabled }, null, 2), 'utf8');
    fs.renameSync(tempPath, UPDATER_SETTINGS_FILE);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    console.error('[Updater] Could not persist settings:', error.message);
  }
}

let autoUpdateEnabled = readUpdaterSettings().autoUpdateEnabled;

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
    // Checks are allowed according to the preference, but downloads and
    // installation are never implicit. The canonical backup/drain flow below
    // is the only path allowed to call downloadUpdate or quitAndInstall.
    autoUpdater.autoDownload    = false;
    // Installation is never implicit. A user-confirmed request must pass the
    // canonical backup/drain flow below before quitAndInstall is called.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowDowngrade = false;
    // Public Windows packages are intentionally unsigned in this
    // distribution. The canonical updater still requires an explicit user
    // confirmation, a protected state backup, release validation, and a
    // matching SHA-512 digest before installation.
    autoUpdater.verifyUpdateCodeSignature = false;
    autoUpdater.setFeedURL?.({ provider: 'github', owner: 'XposeMarket', repo: 'prometheus-releases' });
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
let availableUpdate     = null;  // holds UpdateInfo before a download begins
let pendingUpdate       = null;  // holds UpdateInfo once a release is downloaded
let updaterStatus       = autoUpdater ? 'idle' : 'unsupported';
let updaterMessage      = autoUpdater ? '' : 'Updates are available only in packaged public builds.';
let updaterChecking     = false;
let updaterInstalling   = false;
let updaterProgress     = 0;
let canonicalUpdatePromise = null;
let canonicalUpdateWatcher = null;
let canonicalUpdateLock = null;
let canonicalUpdatePendingValidation = null;
let updaterReleaseValidated = false;
let updaterSha512Verified = false;
let updaterStateBackupCreated = false;
let updaterRestartValidated = false;
let updaterBackupId = '';
let updaterInstallerPath = '';
let isGatewayRestarting = false;
let gatewayHealthTimer = null;
let gatewayHealthCheckInFlight = false;
let gatewayHealthFailures = 0;
const GATEWAY_RESTART_EXIT_CODE = 42;
const NATIVE_BROWSER_RPC_TOKEN = crypto.randomBytes(32).toString('hex');
const PAIRING_ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
const NATIVE_BROWSER_EMPTY_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };

// A desktop gateway owns the user-data directory, connector sessions, and
// runtime status snapshots. Starting a second Electron process against that
// same directory creates two gateways that overwrite each other's heartbeat
// files and compete for single-consumer integrations (for example Telegram),
// which presents as a reconnecting app and can leave orphaned child shells.
// Separate instances remain possible by setting a different
// PROMETHEUS_ELECTRON_DATA_DIR before launching the app.
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function normalizeTitlebarColor(value, fallback) {
  const color = String(value || '').trim();
  if (!color || color.length > 96 || /[;{}'"`]/.test(color)) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^(?:rgba?|hsla?)\([0-9.%\s,+\-/]+\)$/i.test(color)) return color;
  return fallback;
}

function setElectronTitlebarTheme(options = {}) {
  if (process.platform === 'darwin' || !mainWindow || mainWindow.isDestroyed()) return false;
  if (typeof mainWindow.setTitleBarOverlay !== 'function') return false;
  try {
    mainWindow.setTitleBarOverlay({
      color: normalizeTitlebarColor(options?.color, DEFAULT_TITLEBAR_COLOR),
      symbolColor: normalizeTitlebarColor(options?.symbolColor, DEFAULT_TITLEBAR_SYMBOL_COLOR),
      height: ELECTRON_TITLEBAR_HEIGHT,
    });
    return true;
  } catch (error) {
    writeGatewayLog(`[main] Could not update titlebar theme: ${error && error.message ? error.message : error}\n`);
    return false;
  }
}

function getUpdaterState(extra = {}) {
  return {
    supported: !!autoUpdater && !!canonicalUpdaterApi && IS_PACKAGED_RUNTIME && IS_PUBLIC_BUILD,
    autoUpdateEnabled,
    currentVersion: CURRENT_VERSION,
    status: updaterStatus,
    message: updaterStatus === 'error' && canonicalUpdaterApi?.sanitizeUpdateError
      ? canonicalUpdaterApi.sanitizeUpdateError(updaterMessage)
      : updaterMessage,
    progress: updaterProgress,
    version: (pendingUpdate || availableUpdate)?.version || '',
    releaseName: (pendingUpdate || availableUpdate)?.releaseName || '',
    releaseNotes: typeof (pendingUpdate || availableUpdate)?.releaseNotes === 'string'
      ? (pendingUpdate || availableUpdate).releaseNotes
      : '',
    ...extra,
  };
}

function updaterCanonicalPhase() {
  const allowed = new Set([
    'unsupported', 'idle', 'checking', 'available', 'downloading', 'ready',
    'preparing', 'installing', 'relaunching', 'validated', 'busy', 'error',
  ]);
  return allowed.has(updaterStatus) ? updaterStatus : 'error';
}

function writeCanonicalUpdaterStatus(extra = {}) {
  if (!canonicalUpdaterApi?.writeCanonicalUpdateStatus) return;
  const info = pendingUpdate || availableUpdate || {};
  try {
    canonicalUpdaterApi.writeCanonicalUpdateStatus(CANONICAL_UPDATE_CONFIG_DIR, {
      supported: !!autoUpdater && IS_PACKAGED_RUNTIME && IS_PUBLIC_BUILD,
      phase: updaterCanonicalPhase(),
      currentVersion: CURRENT_VERSION,
      targetVersion: String(extra.version || info.version || ''),
      message: canonicalUpdaterApi.sanitizeUpdateError
        ? canonicalUpdaterApi.sanitizeUpdateError(updaterMessage)
        : String(updaterMessage || '').slice(0, 500),
      progress: updaterProgress,
      requestId: String(extra.requestId || '').trim() || undefined,
      source: String(extra.source || '').trim() || undefined,
      backupId: updaterBackupId || undefined,
      recoveryAvailable: extra.recoveryAvailable === true || updaterStateBackupCreated,
      releaseValidated: updaterReleaseValidated,
      sha512Verified: updaterSha512Verified,
      stateBackupCreated: updaterStateBackupCreated,
      restartValidated: updaterRestartValidated,
      errorCode: String(extra.errorCode || '').trim() || undefined,
    });
  } catch (error) {
    writeGatewayLog(`[main] Could not write canonical updater status: ${error && error.message ? error.message : error}\n`);
  }
}

function validatePrometheusRelease(info) {
  if (!canonicalUpdaterApi?.validateReleaseInfo) {
    return { ok: false, message: 'The canonical release validator is unavailable; update is blocked.' };
  }
  return canonicalUpdaterApi.validateReleaseInfo(CURRENT_VERSION, info || {});
}

function getReleaseDigest(info) {
  return String(info?.sha512 || info?.files?.find?.((file) => file?.sha512)?.sha512 || '').trim();
}

async function verifyDownloadedRelease(info) {
  const digest = getReleaseDigest(info);
  if (!digest) throw new Error('Downloaded release has no SHA-512 digest.');
  const candidate = String(updaterInstallerPath || info?.downloadedFile || info?.path || '').trim();
  if (!candidate || !fs.existsSync(candidate) || !canonicalUpdaterApi?.verifyFileSha512) {
    throw new Error('Downloaded release path is unavailable for SHA-512 verification.');
  }
  const verified = await canonicalUpdaterApi.verifyFileSha512(candidate, digest);
  if (!verified) throw new Error('Downloaded release SHA-512 verification failed.');
  updaterSha512Verified = true;
  return true;
}

function isCanonicalPathWithin(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function getCanonicalStateRoots(requestRoots = []) {
  if (!canonicalUpdaterApi?.collectUserStateRoots) return [];
  let config = {};
  try {
    const configPath = path.join(CANONICAL_UPDATE_CONFIG_DIR, 'config.json');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object') config = parsed;
  } catch {}
  const standard = canonicalUpdaterApi.collectUserStateRoots(USER_DATA_DIR, config, []);
  const requested = Array.isArray(requestRoots) ? requestRoots : [];
  const roots = [...standard, ...requested];
  const seen = new Set();
  return roots.filter((root) => {
    const rawPath = String(root?.path || '').trim();
    if (!rawPath) return false;
    const candidate = path.resolve(rawPath);
    if (candidate === path.parse(candidate).root) return false;
    if (isCanonicalPathWithin(path.join(CANONICAL_UPDATE_CONFIG_DIR, 'updates'), candidate)) return false;
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((root) => ({
    label: String(root?.label || 'configured').slice(0, 80),
    path: path.resolve(String(root.path).trim()),
  }));
}

function encryptBackupManifest(plaintext) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-backed encryption is unavailable; protected update backup cannot be created.');
  }
  return safeStorage.encryptString(String(plaintext || ''));
}

function protectBackupDirectory(backupDir) {
  const resolved = path.resolve(backupDir);
  if (process.platform === 'win32') {
    const username = String(process.env.USERNAME || '').trim();
    if (!username) throw new Error('The current Windows user could not be resolved for backup protection.');
    execFileSync('icacls.exe', [
      resolved,
      '/inheritance:r',
      '/grant:r', `${username}:(OI)(CI)F`,
      '/T',
      '/C',
    ], { stdio: 'ignore', windowsHide: true, timeout: 15_000 });
    return;
  }
  fs.chmodSync(resolved, 0o700);
}

function requestLocalJson(method, pathname, payload = null, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    const headers = { Connection: 'close' };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: gatewayPort,
      path: pathname,
      method,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (raw.length < 100_000) raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
        if (Number(res.statusCode || 0) < 200 || Number(res.statusCode || 0) >= 300) {
          const error = new Error(String(parsed?.error || `Local Prometheus request failed (${res.statusCode || 0}).`));
          error.statusCode = res.statusCode;
          reject(error);
          return;
        }
        resolve(parsed);
      });
    });
    req.once('timeout', () => req.destroy(new Error('The Prometheus gateway did not respond in time.')));
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestUpdateDrain() {
  const result = await requestLocalJson('POST', '/api/internal/update-drain', null, 10_000);
  if (!result?.ok || !result?.preflight?.ready) {
    const reasons = Array.isArray(result?.preflight?.reasons) ? result.preflight.reasons.join(', ') : 'pending work';
    throw new Error(`Update is blocked until Prometheus is idle and durable writes are drained (${reasons}).`);
  }
  return result;
}

function sendUpdaterState(extra = {}) {
  if (updaterStatus === 'error' && canonicalUpdaterApi?.sanitizeUpdateError) {
    updaterMessage = canonicalUpdaterApi.sanitizeUpdateError(updaterMessage);
  }
  const state = getUpdaterState(extra);
  writeCanonicalUpdaterStatus(extra);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('updater-state', state); } catch {}
  }
  return state;
}

function applyUpdaterPreferences() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
}

function updateBusyState(source = 'manual') {
  updaterStatus = 'busy';
  updaterMessage = 'Another Prometheus update operation is already in progress.';
  return sendUpdaterState({ source, errorCode: 'busy' });
}

function runLocalCanonicalUpdateOperation(source, operation) {
  if (!autoUpdater || !canonicalUpdaterApi?.acquireUpdateLock) {
    return Promise.resolve().then(operation);
  }
  if (canonicalUpdatePromise || canonicalUpdateLock) {
    return Promise.resolve(updateBusyState(source));
  }
  const lock = canonicalUpdaterApi.acquireUpdateLock(CANONICAL_UPDATE_CONFIG_DIR, `electron-main-${source}`);
  if (!lock) return Promise.resolve(updateBusyState(source));
  canonicalUpdateLock = lock;
  canonicalUpdatePromise = Promise.resolve()
    .then(operation)
    .finally(() => {
      try { lock.release(); } catch {}
      if (canonicalUpdateLock === lock) canonicalUpdateLock = null;
      canonicalUpdatePromise = null;
    });
  return canonicalUpdatePromise;
}

async function downloadPrometheusUpdate(source = 'manual', lockHeld = false) {
  if (!autoUpdater) {
    updaterStatus = 'unsupported';
    updaterMessage = 'Updates are available only in packaged public builds.';
    return sendUpdaterState({ source });
  }
  if (updaterInstalling) return sendUpdaterState({ source });
  if (pendingUpdate) {
    updaterStatus = 'ready';
    updaterMessage = 'Update downloaded and ready for your explicit confirmation.';
    return sendUpdaterState({ source });
  }
  if (!availableUpdate) return checkForPrometheusUpdates(source, lockHeld);

  const releaseCheck = validatePrometheusRelease(availableUpdate);
  if (!releaseCheck.ok) {
    updaterStatus = 'error';
    updaterMessage = releaseCheck.message;
    return sendUpdaterState({ source, errorCode: 'release_validation_failed' });
  }
  updaterStatus = 'downloading';
  updaterMessage = `Downloading Prometheus ${availableUpdate.version || 'update'}...`;
  updaterProgress = 0;
  sendUpdaterState({ source });
  try {
    const downloaded = await autoUpdater.downloadUpdate();
    const paths = Array.isArray(downloaded) ? downloaded : [];
    updaterInstallerPath = paths.find((candidate) => typeof candidate === 'string' && fs.existsSync(candidate)) || updaterInstallerPath;
    await verifyDownloadedRelease(availableUpdate);
    pendingUpdate = pendingUpdate || availableUpdate;
    updaterStatus = 'ready';
    updaterMessage = 'Update downloaded and ready for your explicit confirmation.';
    updaterProgress = 100;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const info = pendingUpdate || availableUpdate || {};
      mainWindow.webContents.send('update-ready', {
        version: info.version,
        releaseName: info.releaseName || `v${info.version}`,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
      });
    }
    return sendUpdaterState({ source });
  } catch (error) {
    updaterStatus = 'error';
    updaterMessage = canonicalUpdaterApi?.sanitizeUpdateError
      ? canonicalUpdaterApi.sanitizeUpdateError(error)
      : 'Update download failed.';
    console.error('[Updater] downloadUpdate failed:', updaterMessage);
    return sendUpdaterState({ source });
  }
}

async function setAutoUpdateEnabled(enabled) {
  autoUpdateEnabled = enabled === true;
  persistUpdaterSettings();
  applyUpdaterPreferences();

  if (!autoUpdater) {
    updaterStatus = 'unsupported';
    updaterMessage = 'Updates are available only in packaged public builds.';
    return sendUpdaterState({ source: 'settings' });
  }

  if (!autoUpdateEnabled && !pendingUpdate && !availableUpdate && updaterStatus === 'idle') {
    updaterMessage = 'Automatic updates are off. Use Check for updates when you want to look.';
  }
  if (autoUpdateEnabled && !pendingUpdate) {
    return runLocalCanonicalUpdateOperation('settings-check', () => checkForPrometheusUpdates('settings', true));
  }
  return sendUpdaterState({ source: 'settings' });
}

async function checkForPrometheusUpdates(source = 'manual', lockHeld = false) {
  if (!autoUpdater) {
    updaterStatus = 'unsupported';
    updaterMessage = 'Updates are available only in packaged public builds.';
    return sendUpdaterState({ source });
  }
  if (updaterInstalling) return sendUpdaterState({ source });
  if (pendingUpdate) {
    updaterStatus = 'ready';
    updaterMessage = 'Update downloaded and ready for your explicit confirmation.';
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
    // electron-updater emits update-not-available/update-available for the
    // authoritative result. Only use the return value as a fallback when no
    // event changed the state (some provider versions return null in dev QA).
    if (!result || !result.updateInfo) {
      updaterStatus = 'idle';
      updaterMessage = 'Prometheus is up to date.';
      return sendUpdaterState({ source });
    }
    return sendUpdaterState({ source });
  } catch (e) {
    updaterStatus = 'error';
    updaterMessage = canonicalUpdaterApi?.sanitizeUpdateError
      ? canonicalUpdaterApi.sanitizeUpdateError(e)
      : 'Update check failed.';
    console.error('[Updater] checkForUpdates failed:', updaterMessage);
    return sendUpdaterState({ source });
  } finally {
    updaterChecking = false;
  }
}

// ─── Native in-house browser: profile/session/tab view registry ─────────────
// Each "profile" is an isolated, on-disk Electron session partition (its own
// cookies/logins), analogous to Prometheus' per-agent Chrome debug profiles.
//   - The main chat uses the "main" profile by default.
//   - Subagents/other owners can either share the main profile or get their own,
//     so two agents driving two accounts never clash over one logged-in session.
// Only ONE tab view is "presented" (positioned + visible) in the canvas at a
// time. Other tabs/profiles stay detached from the window but remain alive for
// background automation (DOM snapshot / run-js).
const NATIVE_BROWSER_DEFAULT_PROFILE = 'main';
const nativeBrowserViews = new Map();      // `${profileKey}::${tabId}` -> WebContentsView/BrowserView
const nativeBrowserSessionPartitions = new Map(); // sessionId -> partition
const nativeBrowserSessionTabs = new Map(); // `${sessionId}::${profileKey}` -> { partition, tabIds, activeTabId }
const nativeBrowserProfileSessions = new Map(); // imported profile id -> Electron Session
let nativeBrowserTabSequence = 0;
let presentedNativePartition = '';         // partition currently shown in the canvas
let presentedNativeTabId = '';             // tab currently shown in the canvas
const nativeBrowserState = {
  available: false,
  attached: false,
  visible: false,
  sessionId: '',
  profile: '',
  profileLabel: 'Prometheus in-house browser',
  partition: '',
  activeTabId: '',
  tabs: [],
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

// ─── Port selection ─────────────────────────────────────────────────────────
// Electron owns the public relay for its lifetime. The relay port is selected
// once per Electron profile, persisted, and deliberately kept across worker
// restarts; the child gateway uses a separate loopback backend port. A second
// Electron profile can set PROMETHEUS_ELECTRON_DATA_DIR and receive its own
// public relay port without clashing with this instance.
function isGatewayPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    let settled = false;
    const done = (available) => {
      if (settled) return;
      settled = true;
      resolve(available);
    };
    probe.once('error', () => done(false));
    probe.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
      probe.close(() => done(true));
    });
  });
}

function readPersistedGatewayPort() {
  try {
    const parsed = JSON.parse(fs.readFileSync(GATEWAY_PORT_STATE_FILE, 'utf8'));
    return parseGatewayPort(parsed?.port);
  } catch {
    return null;
  }
}

function persistGatewayPort(port) {
  try {
    fs.mkdirSync(path.dirname(GATEWAY_PORT_STATE_FILE), { recursive: true });
    const temporaryPath = `${GATEWAY_PORT_STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify({ port, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, GATEWAY_PORT_STATE_FILE);
  } catch (error) {
    writeGatewayLog(`[main] Could not persist selected gateway relay port: ${error?.message || error}\n`);
  }
}

async function selectAvailableGatewayPort() {
  const persistedPort = readPersistedGatewayPort();
  if (persistedPort && await isGatewayPortAvailable(persistedPort)) {
    writeGatewayLog(`[main] Reusing persisted gateway relay port ${persistedPort}\n`);
    return persistedPort;
  }
  if (persistedPort) {
    writeGatewayLog(`[main] Persisted gateway relay port ${persistedPort} is unavailable; selecting a replacement\n`);
  }

  const span = AUTO_GATEWAY_PORT_MAX - AUTO_GATEWAY_PORT_MIN + 1;
  const startingOffset = crypto.randomInt(span);
  for (let attempt = 0; attempt < AUTO_GATEWAY_PORT_ATTEMPTS; attempt += 1) {
    const candidate = AUTO_GATEWAY_PORT_MIN + ((startingOffset + attempt) % span);
    if (await isGatewayPortAvailable(candidate)) return candidate;
  }
  throw new Error('Prometheus could not find an available local relay port. Set PROMETHEUS_GATEWAY_PORT to an unused port and restart.');
}

async function selectGatewayPort() {
  if (!gatewayPort) {
    gatewayPort = await selectAvailableGatewayPort();
    persistGatewayPort(gatewayPort);
    writeGatewayLog(`[main] Selected gateway relay port ${gatewayPort}\n`);
  }
  GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
  if (gatewayRelay?.server?.listening) return;
  if (!(await isGatewayPortAvailable(gatewayPort))) {
    assertGatewayPortAvailable(gatewayPort);
    throw new Error(
      `Prometheus cannot start because gateway port ${gatewayPort} is already in use. ` +
      'Close the existing Prometheus/gateway instance or launch this instance with a separate PROMETHEUS_ELECTRON_DATA_DIR.',
    );
  }
}

function getConfiguredTailscaleFunnel() {
  try {
    const configPath = path.join(CANONICAL_UPDATE_CONFIG_DIR, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const remoteAccess = config?.gateway?.remoteAccess;
    if (!remoteAccess?.enabled || typeof remoteAccess.publicUrl !== 'string') return null;
    const publicUrl = new URL(remoteAccess.publicUrl.trim());
    if (publicUrl.protocol !== 'https:' || !publicUrl.hostname.endsWith('.ts.net')) return null;
    const httpsPort = Number(publicUrl.port || 443);
    if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) return null;
    return { httpsPort, publicUrl: publicUrl.origin };
  } catch {
    return null;
  }
}

function getTailscaleCliPath() {
  const configured = String(process.env.PROMETHEUS_TAILSCALE_BIN || '').trim();
  const installedCandidates = process.platform === 'darwin'
    ? [
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      path.join(process.env.HOME || '', 'Applications/Tailscale.app/Contents/MacOS/Tailscale'),
    ]
    : process.platform === 'win32'
      ? [
        path.join(String(process.env.ProgramFiles || ''), 'Tailscale', 'tailscale.exe'),
        path.join(String(process.env.LOCALAPPDATA || ''), 'Tailscale', 'tailscale.exe'),
      ]
      : [];
  return [configured, ...installedCandidates].find((candidate) => candidate && fs.existsSync(candidate)) || 'tailscale';
}

// Funnel's public URL is stable; only its local target must follow a relay
// port selected for this Electron profile. Do this after the relay is bound so
// there is no gap where Funnel forwards requests to a closed local listener.
function synchronizeTailscaleFunnelTarget() {
  const funnel = getConfiguredTailscaleFunnel();
  if (!funnel) return;
  const tailscaleBin = getTailscaleCliPath();
  try {
    execFileSync(tailscaleBin, ['funnel', '--bg', `--https=${funnel.httpsPort}`, String(gatewayPort)], {
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
      timeout: 12_000,
    });
    writeGatewayLog(`[main] Tailscale Funnel ${funnel.publicUrl} now targets local relay ${gatewayPort}\n`);
  } catch (error) {
    writeGatewayLog(`[main] Could not retarget Tailscale Funnel to ${gatewayPort} via ${tailscaleBin}: ${error?.message || error}\n`);
  }
}

async function selectGatewayBackendPort() {
  if (gatewayBackendPort != null) {
    if (await isGatewayPortAvailable(gatewayBackendPort)) return gatewayBackendPort;
    throw new Error(
      `Prometheus gateway backend port ${gatewayBackendPort} is still in use after the previous worker stopped. ` +
      'Wait for the previous worker to exit, then restart Prometheus.',
    );
  }

  // Keep the public port and potential built-in HTTPS listener out of the
  // backend range. The backend is selected once per Electron lifetime and is
  // retained for every worker replacement.
  const configuredHttpsPort = getConfiguredGatewayHttpsPort();
  for (let offset = 1; offset <= 512; offset += 1) {
    const candidate = gatewayPort + offset;
    if (candidate > 65_535 || candidate === configuredHttpsPort) continue;
    if (await isGatewayPortAvailable(candidate)) {
      gatewayBackendPort = candidate;
      return gatewayBackendPort;
    }
  }
  throw new Error(`Prometheus could not reserve a private backend port near ${gatewayPort}.`);
}

function getConfiguredGatewayHttpsPort() {
  const enabledByEnvironment = ['1', 'true'].includes(String(process.env.GATEWAY_HTTPS_ENABLED || '').trim().toLowerCase());
  try {
    const configPath = path.join(USER_DATA_DIR, '.prometheus', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const https = config?.gateway?.https || {};
    const enabled = https.enabled === true || enabledByEnvironment;
    if (!enabled) return 0;
    const port = Number(https.port || process.env.GATEWAY_HTTPS_PORT || 18790);
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : 0;
  } catch {
    if (!enabledByEnvironment) return 0;
    const port = Number(process.env.GATEWAY_HTTPS_PORT || 18790);
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : 0;
  }
}

async function startGatewayRelay() {
  if (gatewayRelay?.server?.listening) return;
  if (!(await isGatewayPortAvailable(gatewayPort))) {
    assertGatewayPortAvailable(gatewayPort);
    throw new Error(`Prometheus cannot start the stable gateway relay because port ${gatewayPort} is already in use.`);
  }
  const relay = createGatewayReverseProxy({
    port: gatewayPort,
    getTargetPort: () => gatewayBackendPort,
    log: writeGatewayLog,
  });
  try {
    await relay.listen();
    gatewayRelay = relay;
    writeGatewayLog(`[main] Stable gateway relay listening on ${gatewayPort}\n`);
  } catch (error) {
    try { await relay.close(); } catch {}
    throw error;
  }
}

// Preserve the detailed Windows owner message for explicitly requested ports.
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

function getGatewayPortOwnerPids(port = gatewayPort) {
  if (process.platform !== 'win32') return getPosixListeningPids(port);
  try {
    const output = execSync('netstat -ano -p tcp', {
      encoding: 'utf-8', stdio: 'pipe', timeout: 5_000,
    });
    return parseWindowsListeningPids(output, port);
  } catch {
    return [];
  }
}

// Only clean listeners whose runtime status still identifies the gateway that
// Electron just owned. This prevents a restart race from killing an unrelated
// process that happened to claim the same port after the old child exited.
function forceCleanupOwnedGatewayPort(
  expectedPid,
  expectedRuntimePid = 0,
  port = gatewayBackendPort || gatewayPort,
) {
  const status = readGatewayRuntimeStatus();
  const statusPid = Number(status?.pid || 0);
  const runtimePid = Number(expectedRuntimePid || statusPid || 0);
  if (!runtimePid) return;
  if (expectedRuntimePid && statusPid && statusPid !== runtimePid) return;
  if (!expectedRuntimePid && statusPid !== Number(expectedPid || 0)) return;
  for (const pid of getGatewayPortOwnerPids(port)) {
    // Only terminate the listener identified by the gateway's own runtime
    // status. Never kill an unrelated process that claimed the port during a
    // restart race.
    if (!pid || pid === process.pid || pid !== runtimePid) continue;
    killGatewayPortOwner(pid);
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
    try { gatewayLogStream?.end(); } catch {}
    // Keep the previous gateway lifetime in the same log. Truncating here
    // erased the restart trigger before the replacement could report it.
    gatewayLogStream = fs.createWriteStream(GATEWAY_LOG_PATH, { flags: 'a' });
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

async function openExternalSafely(rawUrl) {
  const externalUrl = normalizeExternalUrl(rawUrl);
  if (!externalUrl) {
    writeGatewayLog(`[main] Blocked unsafe external URL: ${String(rawUrl || '').slice(0, 300)}\n`);
    throw new Error('Only credential-free HTTP and HTTPS URLs may open externally.');
  }
  await shell.openExternal(externalUrl);
  return { ok: true, url: externalUrl };
}

async function openPassthroughExternalSafely(rawUrl) {
  const passthroughUrl = normalizePassthroughExternalUrl(rawUrl);
  if (!passthroughUrl) {
    writeGatewayLog(`[main] Blocked unsafe passthrough URL: ${String(rawUrl || '').slice(0, 300)}\n`);
    throw new Error('This URL scheme is not allowed from the Prometheus window.');
  }
  await shell.openExternal(passthroughUrl);
  return { ok: true, url: passthroughUrl };
}

function requestPrometheusBrowserNavigation(rawUrl) {
  let browserUrl;
  try {
    browserUrl = normalizeEmbeddedBrowserUrl(rawUrl);
  } catch (error) {
    writeGatewayLog(`[main] Blocked in-app browser URL: ${error && error.message ? error.message : error}\n`);
    return false;
  }
  if (!browserUrl || browserUrl === 'about:blank' || !mainWindow || mainWindow.isDestroyed()) return false;
  try {
    mainWindow.webContents.send('prometheus-browser-navigation', {
      url: browserUrl,
      source: 'electron-main-window',
      timestamp: Date.now(),
    });
    return true;
  } catch (error) {
    writeGatewayLog(`[main] Could not dispatch in-app browser navigation: ${error && error.message ? error.message : error}\n`);
    return false;
  }
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
      // The gateway has a raw HEAD fast path. Avoid making the watchdog wait
      // for a JSON body or any downstream middleware while deciding whether
      // the process is reachable.
      method: 'HEAD',
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

function readGatewayProgressLease() {
  try {
    const leasePath = path.join(USER_DATA_DIR, '.prometheus', 'gateway-progress-lease.json');
    if (!fs.existsSync(leasePath)) return null;
    return JSON.parse(fs.readFileSync(leasePath, 'utf-8'));
  } catch {
    return null;
  }
}

function shouldDeferGatewayHealthRecovery(status, lease, expectedPid) {
  const now = Date.now();
  const gatewayPid = Number(expectedPid);
  const statusPid = Number(status?.pid);
  // Never use a stale heartbeat written by the gateway process that was just
  // replaced. The progress lease has the same PID identity guard below.
  const currentStatus = status
    && (!gatewayPid || !statusPid || statusPid === gatewayPid)
    ? status
    : null;

  if (currentStatus && Number.isFinite(Number(currentStatus.timestamp))) {
    const heartbeatAgeMs = Math.max(0, now - Number(currentStatus.timestamp));
    if (heartbeatAgeMs < 20_000) return true;
    if (!currentStatus.modelBusy) return false;
    const busyAgeAtHeartbeatMs = Number.isFinite(Number(currentStatus.modelBusyAgeMs))
      ? Number(currentStatus.modelBusyAgeMs)
      : 0;
    const busyAgeFromStartMs = Number.isFinite(Number(currentStatus.modelBusySince))
      ? Math.max(0, now - Number(currentStatus.modelBusySince))
      : 0;
    const effectiveBusyAgeMs = Math.max(
      busyAgeFromStartMs,
      busyAgeAtHeartbeatMs + heartbeatAgeMs,
    );
    if (effectiveBusyAgeMs < GATEWAY_BUSY_RECOVERY_GRACE_MS) return true;
  }

  const leasePid = Number(lease?.pid);
  const lastProgressAt = Number(lease?.lastProgressAt);
  const expiresAt = Number(lease?.expiresAt);
  if (
    lease?.state === 'active'
    && (!gatewayPid || leasePid === gatewayPid)
    && lastProgressAt > 0
    && expiresAt > now
  ) {
    // An active provider worker renews this lease every few seconds. The
    // model-worker pool independently kills a worker after stale heartbeats,
    // so this cannot keep a dead provider request alive indefinitely.
    return true;
  }

  return false;
}

// Electron can still be torn down by a renderer crash, an OS close request,
// or an explicit process exit before the async before-quit handshake finishes.
// Make the final process boundary synchronous so a managed gateway cannot be
// left behind holding the desktop port.
process.on('exit', () => {
  if (!gatewayProcess || !gatewayProcess.pid) return;
  if (gatewayProcess.exitCode != null || gatewayProcess.signalCode != null) return;
  killManagedGatewayProcessTree(gatewayProcess);
});

async function waitForGatewayPortRelease(timeoutMs = 10_000) {
  const port = gatewayBackendPort || gatewayPort;
  const deadline = Date.now() + timeoutMs;
  while (!(await isGatewayPortAvailable(port))) {
    if (Date.now() >= deadline) {
      throw new Error(`Prometheus gateway backend port ${port} remained occupied after process cleanup.`);
    }
    await sleep(100);
  }
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

function waitForGatewayProcessExitStrict(child, timeoutMs = 30_000) {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => done();
    const timer = setTimeout(() => done(new Error('Prometheus gateway did not shut down gracefully; update was not installed.')), timeoutMs);
    child.once('exit', onExit);
  });
}

async function shutdownGatewayForSafeUpdate() {
  const target = gatewayProcess;
  if (!target) return;
  gatewayShuttingDown = true;
  try {
    await requestLocalJson('POST', '/api/internal/shutdown', null, 5_000);
    await waitForGatewayProcessExitStrict(target, 30_000);
    if (target.exitCode == null && target.signalCode == null) {
      throw new Error('Prometheus gateway remained alive after graceful shutdown.');
    }
    if (gatewayProcess === target) gatewayProcess = null;
  } catch (error) {
    gatewayShuttingDown = false;
    throw error;
  }
}

async function recoverGatewayAfterUpdateFailure() {
  if (gatewayProcess || isQuitting) return;
  gatewayShuttingDown = false;
  try {
    await startGateway();
    await waitForGateway();
    writeGatewayLog('[main] Gateway recovered after a blocked update attempt\n');
  } catch (error) {
    writeGatewayLog(`[main] Gateway recovery after update failure failed: ${error && error.message ? error.message : error}\n`);
  }
}

async function runSafeCanonicalApply(request = {}) {
  if (canonicalUpdatePromise) return canonicalUpdatePromise;
  canonicalUpdatePromise = (async () => {
    const source = String(request?.source || 'electron').slice(0, 64);
    const requestId = String(request?.requestId || '').trim() || undefined;
    let installStarted = false;
    let gatewayWasStopped = false;
    if (request?.confirmed !== true) {
      updaterStatus = 'error';
      updaterMessage = 'Explicit confirmation is required before installing a Prometheus update.';
      return sendUpdaterState({ source, requestId, errorCode: 'confirmation_required' });
    }
    if (!autoUpdater || !canonicalUpdaterApi) {
      updaterStatus = 'unsupported';
      updaterMessage = 'Safe updates are available only in a packaged public Prometheus build.';
      return sendUpdaterState({ source, requestId, errorCode: 'unsupported' });
    }
    const lock = canonicalUpdaterApi.acquireUpdateLock(CANONICAL_UPDATE_CONFIG_DIR, 'electron-main');
    if (!lock) {
      updaterStatus = 'busy';
      updaterMessage = 'Another Prometheus update operation is already in progress.';
      return sendUpdaterState({ source, requestId, errorCode: 'busy' });
    }
    canonicalUpdateLock = lock;
    try {
      updaterStatus = 'preparing';
      updaterMessage = 'Preparing the safe Prometheus update...';
      updaterStateBackupCreated = false;
      updaterRestartValidated = false;
      updaterBackupId = '';
      sendUpdaterState({ source, requestId });

      if (!pendingUpdate) {
        await checkForPrometheusUpdates(source, true);
        if (!pendingUpdate && availableUpdate) await downloadPrometheusUpdate(source, true);
      }
      if (!pendingUpdate) {
        return sendUpdaterState({ source, requestId });
      }

      const releaseCheck = validatePrometheusRelease(pendingUpdate);
      if (!releaseCheck.ok) throw new Error(releaseCheck.message);
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS-backed encryption is unavailable; Prometheus will not create an unprotected update backup.');
      }
      // Re-verify immediately before any drain, backup, or installer launch.
      // This closes the race where electron-updater emits update-downloaded
      // before its download promise has returned the final installer path.
      await verifyDownloadedRelease(pendingUpdate);
      if (updaterSha512Verified !== true) throw new Error('Downloaded release was not SHA-512 verified.');

      await requestUpdateDrain();
      updaterStatus = 'preparing';
      updaterMessage = 'Durable writes are drained. Creating a protected user-state backup...';
      sendUpdaterState({ source, requestId });

      const paths = canonicalUpdaterApi.getUpdatePaths(CANONICAL_UPDATE_CONFIG_DIR);
      const backup = canonicalUpdaterApi.createVersionedStateBackup({
        stateRoot: USER_DATA_DIR,
        updateDir: paths.updateDir,
        backupsDir: paths.backupsDir,
        currentVersion: CURRENT_VERSION,
        targetVersion: String(pendingUpdate.version || ''),
        stateRoots: getCanonicalStateRoots(request?.stateRoots),
        encryptManifest: encryptBackupManifest,
        protectBackup: protectBackupDirectory,
      });
      updaterBackupId = backup.backupId;
      updaterStateBackupCreated = true;
      canonicalUpdatePendingValidation = {
        backupId: backup.backupId,
        backupDir: backup.backupDir,
        targetVersion: String(pendingUpdate.version || ''),
        statePaths: backup.manifest.entries.filter((entry) => entry.exists).map((entry) => entry.sourcePath),
        source,
        requestId,
      };
      canonicalUpdaterApi.writePendingValidation(CANONICAL_UPDATE_CONFIG_DIR, canonicalUpdatePendingValidation);

      updaterStatus = 'installing';
      updaterMessage = 'Backup complete. Closing Prometheus to install the verified release...';
      updaterInstalling = true;
      sendUpdaterState({ source, requestId, recoveryAvailable: true });
      isQuitting = true;
      await shutdownGatewayForSafeUpdate();
      gatewayWasStopped = true;
      updaterStatus = 'relaunching';
      updaterMessage = 'Installing the verified release and reopening Prometheus...';
      sendUpdaterState({ source, requestId, recoveryAvailable: true });
      // electron-updater performs the signed installer launch and returns to
      // this process only during shutdown. No force-kill fallback is allowed.
      autoUpdater.quitAndInstall(false, true);
      installStarted = true;
      return getUpdaterState({ source, requestId });
    } catch (error) {
      const message = canonicalUpdaterApi.sanitizeUpdateError
        ? canonicalUpdaterApi.sanitizeUpdateError(error)
        : String(error?.message || error || 'Safe update failed.');
      updaterStatus = 'error';
      updaterMessage = message;
      updaterInstalling = false;
      isQuitting = false;
      if (gatewayWasStopped || gatewayShuttingDown) await recoverGatewayAfterUpdateFailure();
      return sendUpdaterState({
        source,
        requestId,
        errorCode: 'safe_update_failed',
        recoveryAvailable: updaterStateBackupCreated,
      });
    } finally {
      if (!installStarted) {
        updaterInstalling = false;
        try { lock.release(); } catch {}
        if (canonicalUpdateLock === lock) canonicalUpdateLock = null;
      }
    }
  })().finally(() => {
    canonicalUpdatePromise = null;
  });
  return canonicalUpdatePromise;
}

async function processCanonicalUpdateRequest() {
  if (!canonicalUpdaterApi || !canonicalUpdaterApi.consumeCanonicalUpdateRequest) return;
  if (canonicalUpdatePromise || updaterInstalling || isQuitting) return;
  const request = canonicalUpdaterApi.consumeCanonicalUpdateRequest(CANONICAL_UPDATE_CONFIG_DIR);
  if (!request) return;
  if (!autoUpdater) {
    updaterStatus = 'unsupported';
    updaterMessage = 'Safe updates are unavailable because the packaged public updater is not installed.';
    sendUpdaterState({ source: request.source, requestId: request.requestId, errorCode: 'updater_unavailable' });
    return;
  }
  if (request.action === 'apply') {
    await runSafeCanonicalApply(request);
    return;
  }
  const lock = canonicalUpdaterApi.acquireUpdateLock(CANONICAL_UPDATE_CONFIG_DIR, 'electron-main-check');
  if (!lock) {
    updaterStatus = 'busy';
    updaterMessage = 'Another Prometheus update operation is already in progress.';
    sendUpdaterState({ source: request.source, requestId: request.requestId, errorCode: 'busy' });
    return;
  }
  canonicalUpdatePromise = (async () => {
    try {
      await checkForPrometheusUpdates(request.source, true);
      sendUpdaterState({ source: request.source, requestId: request.requestId });
    } finally {
      try { lock.release(); } catch {}
      if (canonicalUpdateLock === lock) canonicalUpdateLock = null;
    }
  })().finally(() => { canonicalUpdatePromise = null; });
  await canonicalUpdatePromise;
}

function startCanonicalUpdateWatcher() {
  if (canonicalUpdateWatcher || !canonicalUpdaterApi) return;
  canonicalUpdateWatcher = setInterval(() => {
    processCanonicalUpdateRequest().catch((error) => {
      updaterStatus = 'error';
      updaterMessage = canonicalUpdaterApi.sanitizeUpdateError
        ? canonicalUpdaterApi.sanitizeUpdateError(error)
        : 'Safe update request failed.';
      sendUpdaterState({ source: 'canonical-watcher', errorCode: 'request_processing_failed' });
    });
  }, 500);
  canonicalUpdateWatcher.unref?.();
}

async function completePendingCanonicalValidation() {
  if (!canonicalUpdaterApi?.readPendingValidation) return;
  const pending = canonicalUpdaterApi.readPendingValidation(CANONICAL_UPDATE_CONFIG_DIR);
  if (!pending) return;
  canonicalUpdatePendingValidation = pending;
  updaterBackupId = String(pending.backupId || '');
  updaterStateBackupCreated = true;
  const updatePaths = canonicalUpdaterApi.getUpdatePaths(CANONICAL_UPDATE_CONFIG_DIR);
  const backupId = String(pending.backupId || '').trim();
  const backupDir = path.resolve(String(pending.backupDir || ''));
  const expectedBackupDir = path.resolve(path.join(updatePaths.backupsDir, backupId));
  const targetVersion = String(pending.targetVersion || '');
  const backupLocationValid = /^[A-Za-z0-9._-]+$/.test(backupId)
    && isCanonicalPathWithin(updatePaths.backupsDir, backupDir)
    && backupDir === expectedBackupDir;
  let manifestValid = false;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const plaintext = safeStorage.decryptString(fs.readFileSync(path.join(backupDir, 'manifest.enc')));
      const manifest = JSON.parse(plaintext);
      const entriesValid = Array.isArray(manifest?.entries) && manifest.entries.every((entry) => {
        const relative = String(entry?.backupPath || '').trim();
        if (!relative || path.isAbsolute(relative)) return false;
        const backupEntry = path.resolve(backupDir, relative);
        return isCanonicalPathWithin(backupDir, backupEntry)
          && (!entry.exists || fs.existsSync(backupEntry));
      });
      manifestValid = manifest?.schemaVersion === 1
        && manifest?.protection === 'encrypted-manifest'
        && manifest?.backupId === backupId
        && entriesValid;
      if (manifestValid) {
        pending._validatedStatePaths = manifest.entries
          .filter((entry) => entry.exists)
          .map((entry) => String(entry.sourcePath || '').trim())
          .filter(Boolean);
      }
    }
  } catch {}
  const statePaths = Array.isArray(pending._validatedStatePaths) ? pending._validatedStatePaths : [];
  const valid = targetVersion === CURRENT_VERSION
    && backupLocationValid
    && !!backupDir
    && fs.existsSync(backupDir)
    && fs.existsSync(path.join(backupDir, 'manifest.enc'))
    && manifestValid
    && statePaths.every((candidate) => fs.existsSync(path.resolve(String(candidate || ''))));
  if (!valid) {
    updaterStatus = 'error';
    updaterMessage = 'The previous update could not validate its protected backup and user state. The backup was retained for recovery.';
    updaterRestartValidated = false;
    sendUpdaterState({ source: pending.source || 'restart-validation', requestId: pending.requestId, errorCode: 'restart_validation_failed', recoveryAvailable: true });
    return;
  }
  updaterStatus = 'validated';
  updaterMessage = `Prometheus ${CURRENT_VERSION} reopened and validated its protected user-state backup.`;
  updaterRestartValidated = true;
  sendUpdaterState({ source: pending.source || 'restart-validation', requestId: pending.requestId, recoveryAvailable: true });
  try { fs.unlinkSync(canonicalUpdaterApi.getUpdatePaths(CANONICAL_UPDATE_CONFIG_DIR).pendingValidationFile); } catch {}
  canonicalUpdatePendingValidation = null;
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
      const lease = readGatewayProgressLease();
      if (shouldDeferGatewayHealthRecovery(status, lease, gatewayProcess.pid)) {
        gatewayHealthFailures = 0;
        const phase = lease?.phase ? ` phase=${String(lease.phase).slice(0, 80)}` : '';
        writeGatewayLog(`[main] Gateway health timed out, but current runtime heartbeat/progress lease is still fresh${phase}; deferring recovery\n`);
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

async function startGateway() {
  console.log('[Prometheus] Starting gateway...');
  console.log(`[Prometheus] User data: ${USER_DATA_DIR}`);
  console.log(`[Prometheus] Packaged runtime: ${IS_PACKAGED_RUNTIME ? 'yes' : 'no'}`);

  openGatewayLog();
  writeGatewayLog(`[main] Gateway starting — pid will follow\n`);
  writeGatewayLog(`[main] Data dir: ${USER_DATA_DIR}\n`);
  writeGatewayLog(`[main] Packaged: ${IS_PACKAGED_RUNTIME}\n`);

  await selectGatewayPort();
  await startGatewayRelay();
  synchronizeTailscaleFunnelTarget();
  await selectGatewayBackendPort();
  writeGatewayLog(`[main] Gateway public port ${gatewayPort} (${GATEWAY_URL}); private backend ${gatewayBackendPort}\n`);

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
    // The public port remains the gateway identity used by pairing, lifecycle
    // restarts, Electron navigation, and Tailscale Funnel. Only the HTTP
    // listener itself moves behind Electron's stable relay.
    PROMETHEUS_GATEWAY_PORT:      String(gatewayPort),
    PROMETHEUS_GATEWAY_PUBLIC_PORT: String(gatewayPort),
    PROMETHEUS_GATEWAY_INTERNAL_PORT: String(gatewayBackendPort),
    PROMETHEUS_GATEWAY_INTERNAL_HOST: '127.0.0.1',
    PROMETHEUS_VERSION:            CURRENT_VERSION,
    PROMETHEUS_BUNDLED_SKILLS_DIR: bundledSkillsDir,
    PROMETHEUS_ELECTRON_MANAGED:  '1',
    PROMETHEUS_ELECTRON_PID:      String(process.pid),
    // Keep the gateway's own stall recovery aligned with the Electron
    // watchdog. An unset value should use the production-safe default; an
    // explicit 0/false remains available for diagnostics.
    PROMETHEUS_GATEWAY_STALL_AUTORESTART: process.env.PROMETHEUS_GATEWAY_STALL_AUTORESTART ?? '1',
    PROMETHEUS_PAIRING_ADMIN_TOKEN: PAIRING_ADMIN_TOKEN,
    PROMETHEUS_ELECTRON_BROWSER_RPC_URL: nativeBrowserRpcPort ? `http://127.0.0.1:${nativeBrowserRpcPort}` : '',
    PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN: nativeBrowserRpcPort ? NATIVE_BROWSER_RPC_TOKEN : '',
    ...(IS_PACKAGED_RUNTIME ? {
      PLAYWRIGHT_BROWSERS_PATH: path.join(process.resourcesPath, 'playwright-browsers'),
    } : {}),
    ...(IS_PACKAGED_RUNTIME && process.platform === 'darwin' ? {
      PROMETHEUS_DESKTOP_HELPER_PATH: path.join(process.resourcesPath, 'prometheus-desktop-helper'),
    } : {}),
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
      detached: process.platform !== 'win32',
    });
  } else {
    // Do not spawn the Windows .cmd shim with shell:true. Electron would then
    // track only cmd.exe while the real tsx/node gateway became a detached
    // descendant, which is exactly how ports survived an app close. In source
    // development, use the normal Node runtime for the gateway child so native
    // addons (notably better-sqlite3) match the ABI installed by npm. The
    // gateway remains a separate Electron-owned process and still receives the
    // sealed vault key over stdin.
    const tsxCli = path.join(APP_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!fs.existsSync(tsxCli)) {
      throw new Error(`The local tsx runtime is missing: ${tsxCli}`);
    }
    const sourceGatewayNode = resolveSourceGatewayNode();
    writeGatewayLog(`[main] Source gateway runtime: ${sourceGatewayNode}\n`);
    gatewayProcess = spawn(sourceGatewayNode, [tsxCli, getGatewayEntryPath()], {
      cwd:   getGatewayWorkingDirectory(),
      env:   { ...gatewayEnv },
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
  }

  const spawnedGatewayProcess = gatewayProcess;
  writeGatewayLog(`[main] Gateway spawned (pid=${spawnedGatewayProcess.pid}, backend=${gatewayBackendPort})\n`);

  // Hand off the master key (or an empty sentinel) as the first stdin line. The
  // child's vault-key-bootstrap reads exactly one line, then stdin is left open.
  try {
    spawnedGatewayProcess.stdin?.write((vaultKeyHex || '') + '\n');
  } catch (err) {
    writeGatewayLog(`[main] Vault key handoff write failed: ${err && err.message ? err.message : err}\n`);
  }

  spawnedGatewayProcess.stdout?.on('data', (d) => writeGatewayLog(d));
  spawnedGatewayProcess.stderr?.on('data', (d) => writeGatewayLog(d));

  spawnedGatewayProcess.on('error', (err) => {
    writeGatewayLog(`[main] Spawn error: ${err.message}\n`);
    if (!isQuitting) {
      dialog.showErrorBox(
        'Prometheus — Gateway Error',
        `Failed to start the Prometheus gateway:\n\n${err.message}\n\nLog: ${GATEWAY_LOG_PATH}`
      );
      app.quit();
    }
  });

  spawnedGatewayProcess.on('exit', (code, signal) => {
    writeGatewayLog(`[main] Gateway exited (code=${code}, signal=${signal})\n`);
    // A timed-out restart may have terminated the gateway before its worker
    // descendants released the listener. Clean only the old Electron-owned
    // port before attempting the replacement.
    const exitedRuntimePid = Number(readGatewayRuntimeStatus()?.pid || 0);
    forceCleanupOwnedGatewayPort(spawnedGatewayProcess.pid || 0, exitedRuntimePid);
    if (!isQuitting && isGatewayRestarting) return;
    if (!isQuitting && code === GATEWAY_RESTART_EXIT_CODE) {
      restartGatewayFromElectron({
        terminateExisting: true,
        reason: 'gateway requested restart',
      });
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
      const staleRuntimePid = Number(readGatewayRuntimeStatus()?.pid || 0);
      writeGatewayLog(`[main] Terminating unresponsive gateway tree (pid=${staleProcess.pid || 'unknown'})\n`);
      killManagedGatewayProcessTree(staleProcess);
      await waitForGatewayProcessExit(staleProcess);
      forceCleanupOwnedGatewayPort(staleProcess.pid || 0, staleRuntimePid);
      await waitForGatewayPortRelease();
    }
    gatewayProcess = null;
    await startGateway();
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
        const ready = Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 300;
        if (ready) {
          if (gatewayProcess) gatewayProcess.removeListener('exit', onProcessExit);
          done(resolve);
          return;
        }
        if (retries-- > 0) {
          setTimeout(attempt, RETRY_DELAY);
        } else {
          if (gatewayProcess) gatewayProcess.removeListener('exit', onProcessExit);
          done(() => reject(new Error(
            `Gateway did not become ready at ${GATEWAY_URL} after ${(MAX_RETRIES * RETRY_DELAY) / 1000}s`
          )));
        }
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
  const value = String(partition || '').trim();
  if (value.startsWith('imported:')) return value.slice('imported:'.length) || NATIVE_BROWSER_DEFAULT_PROFILE;
  return value.replace(/^persist:prometheus-inhouse-/, '') || NATIVE_BROWSER_DEFAULT_PROFILE;
}

function nativeImportedProfileId(profileId) {
  const value = String(profileId || '').trim();
  if (value.startsWith('imported:')) return value.slice('imported:'.length).trim();
  return value.startsWith('imported-') ? value : '';
}

function resolveNativeProfileDescriptor(profileId = '') {
  const importedId = nativeImportedProfileId(profileId);
  if (importedId) {
    const imported = getImportedChromeProfile(USER_DATA_DIR, importedId);
    if (imported?.importedPath) {
      let importedSession = nativeBrowserProfileSessions.get(imported.id);
      if (!importedSession) {
        importedSession = session.fromPath(path.resolve(imported.importedPath));
        nativeBrowserProfileSessions.set(imported.id, importedSession);
      }
      return {
        key: `imported:${imported.id}`,
        profileId: imported.id,
        session: importedSession,
        label: `Imported Chrome · ${imported.name || imported.directory || imported.id}`,
      };
    }
  }
  const normalized = String(profileId || '').trim();
  const key = partitionForNativeProfile(normalized || NATIVE_BROWSER_DEFAULT_PROFILE);
  return {
    key,
    profileId: nativeProfileFromPartition(key),
    session: null,
    label: 'Prometheus in-house browser',
  };
}

function resolveNativePartition(sessionId, profileId) {
  if (profileId) return resolveNativeProfileDescriptor(profileId).key;
  const sid = String(sessionId || '').trim();
  if (sid && nativeBrowserSessionPartitions.has(sid)) return nativeBrowserSessionPartitions.get(sid);
  return partitionForNativeProfile(NATIVE_BROWSER_DEFAULT_PROFILE);
}

function nativeSessionKey(sessionId, partition) {
  const sid = String(sessionId || '').trim();
  return sid ? `${sid}::${partition}` : `partition:${partition}`;
}

function nativeTabKey(partition, tabId) {
  return `${partition}::${String(tabId || '').trim()}`;
}

function createNativeBrowserTabId() {
  nativeBrowserTabSequence += 1;
  return `native-tab-${Date.now().toString(36)}-${nativeBrowserTabSequence.toString(36)}`;
}

function getNativeTabRegistry(sessionId, partition, create = false) {
  const key = nativeSessionKey(sessionId, partition);
  let registry = nativeBrowserSessionTabs.get(key);
  if (!registry && create) {
    registry = { sessionId: String(sessionId || '').trim(), partition, tabIds: [], activeTabId: '' };
    nativeBrowserSessionTabs.set(key, registry);
  }
  return registry || null;
}

function nativeViewMeta(view) {
  if (!view.__promMeta) view.__promMeta = {
    url: 'about:blank',
    title: '',
    loading: false,
    lastError: '',
    designMode: false,
    sessionId: '',
    tabId: '',
    attached: false,
  };
  return view.__promMeta;
}

function nativeBrowserViewImplementations() {
  return getNativeBrowserViewImplementations({ mainWindow, WebContentsView, BrowserView });
}

function refreshNativeBrowserAvailability() {
  nativeBrowserState.available = nativeBrowserViewImplementations().length > 0;
  return nativeBrowserState.available;
}

function attachNativeBrowserView(view) {
  if (!view) throw new Error('Native browser view is missing.');
  const meta = nativeViewMeta(view);
  if (meta.attached === true) return;
  const kind = view.__prometheusNativeBrowserViewKind;
  if (kind === 'web-contents') {
    if (!mainWindow?.contentView?.addChildView) throw new Error('Electron WebContentsView attachment is unavailable.');
    mainWindow.contentView.addChildView(view);
  } else if (kind === 'browser') {
    if (typeof mainWindow?.addBrowserView === 'function') mainWindow.addBrowserView(view);
    else if (typeof mainWindow?.setBrowserView === 'function') mainWindow.setBrowserView(view);
    else throw new Error('Electron BrowserView attachment is unavailable.');
  } else {
    throw new Error('Unknown native browser view implementation.');
  }
  meta.attached = true;
}

function detachNativeBrowserView(view) {
  if (!view) return;
  const meta = nativeViewMeta(view);
  if (meta.attached !== true) return;
  const kind = view.__prometheusNativeBrowserViewKind;
  try {
    if (kind === 'web-contents') {
      if (mainWindow?.contentView?.removeChildView) mainWindow.contentView.removeChildView(view);
      else throw new Error('Electron WebContentsView removal is unavailable.');
    } else if (kind === 'browser') {
      if (typeof mainWindow?.removeBrowserView === 'function') mainWindow.removeBrowserView(view);
      else if (typeof mainWindow?.setBrowserView === 'function') mainWindow.setBrowserView(null);
      else throw new Error('Electron BrowserView removal is unavailable.');
    } else {
      throw new Error('Unknown native browser view implementation.');
    }
    meta.attached = false;
  } catch (error) {
    writeGatewayLog(`[main] Failed to detach native browser view: ${error?.message || error}\n`);
  }
}

function getNativeViewByPartition(partition, tabId = '') {
  const requestedTabId = String(tabId || '').trim();
  const candidates = [];
  for (const [key, view] of nativeBrowserViews) {
    const meta = nativeViewMeta(view);
    if (meta.partition === partition || key.startsWith(`${partition}::`)) candidates.push([key, view, meta]);
  }
  const selected = requestedTabId
    ? candidates.find(([, , meta]) => meta.tabId === requestedTabId)
    : (partition === presentedNativePartition && presentedNativeTabId
      ? candidates.find(([, , meta]) => meta.tabId === presentedNativeTabId)
      : candidates[0]);
  if (!selected) return null;
  const [key, view] = selected;
  if (view && !view.webContents?.isDestroyed()) return view;
  if (view) nativeBrowserViews.delete(key);
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

function clampNativeBrowserBoundsToContent(bounds = {}) {
  const next = normalizeNativeBrowserBounds(bounds);
  const size = mainWindow?.getContentSize?.();
  const contentWidth = Number(size?.[0] || 0);
  const contentHeight = Number(size?.[1] || 0);
  if (!contentWidth || !contentHeight) return next;
  const x = Math.min(next.x, contentWidth);
  const y = Math.min(next.y, contentHeight);
  return {
    x,
    y,
    width: Math.max(0, Math.min(next.width, contentWidth - x)),
    height: Math.max(0, Math.min(next.height, contentHeight - y)),
  };
}

function normalizeBrowserUrlForLoad(url) {
  return normalizeEmbeddedBrowserUrl(url);
}

function refreshNativeViewMeta(view) {
  if (!view) return { url: 'about:blank', title: '', loading: false, lastError: '', tabId: '', sessionId: '' };
  if (!view.webContents || view.webContents.isDestroyed()) return nativeViewMeta(view);
  const meta = nativeViewMeta(view);
  const wc = view.webContents;
  meta.url = wc.getURL() || meta.url || 'about:blank';
  meta.title = wc.getTitle() || meta.title || '';
  meta.loading = wc.isLoading();
  return meta;
}

function nativeTabsForSession(sessionId, partition, activeTabId = '') {
  const registry = getNativeTabRegistry(sessionId, partition, false);
  const activeId = String(activeTabId || registry?.activeTabId || '').trim();
  return (registry?.tabIds || []).map((tabId, index) => {
    const view = getNativeViewByPartition(partition, tabId);
    const meta = view ? refreshNativeViewMeta(view) : { url: 'about:blank', title: '', loading: false, lastError: '' };
    const wc = view?.webContents;
    return {
      id: tabId,
      index,
      title: meta.title || 'New Tab',
      url: meta.url || 'about:blank',
      loading: meta.loading === true,
      active: tabId === activeId,
      canGoBack: !!(wc && !wc.isDestroyed() && wc.canGoBack?.()),
      canGoForward: !!(wc && !wc.isDestroyed() && wc.canGoForward?.()),
    };
  });
}

// Broadcasts the PRESENTED (canvas-visible) view's state to the renderer.
function broadcastNativeBrowserState(extra = {}) {
  const partition = presentedNativePartition;
  const tabId = presentedNativeTabId;
  const view = partition ? getNativeViewByPartition(partition, tabId) : null;
  if (view) {
    const meta = refreshNativeViewMeta(view);
    nativeBrowserState.url = meta.url;
    nativeBrowserState.title = meta.title;
    nativeBrowserState.loading = meta.loading;
    nativeBrowserState.lastError = meta.lastError || '';
    nativeBrowserState.sessionId = String(meta.sessionId || nativeBrowserState.sessionId || '').trim();
  }
  nativeBrowserState.activeTabId = tabId || '';
  nativeBrowserState.tabs = nativeTabsForSession(nativeBrowserState.sessionId, partition, tabId);
  nativeBrowserState.profile = partition ? nativeProfileFromPartition(partition) : nativeBrowserState.profile;
  nativeBrowserState.profileLabel = partition
    ? resolveNativeProfileDescriptor(nativeBrowserState.profile).label
    : nativeBrowserState.profileLabel;
  nativeBrowserState.partition = partition || nativeBrowserState.partition;
  const payload = { ...nativeBrowserState, ...extra, timestamp: Date.now() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('native-browser-state', payload); } catch {}
  }
  return payload;
}

// Per-session state payload (used by RPC results so each owner/profile gets its
// OWN url/title/loading rather than whatever happens to be presented).
function nativeSessionStatePayload(sessionId, view, partition, extra = {}) {
  const meta = view ? refreshNativeViewMeta(view) : { url: 'about:blank', title: '', loading: false, lastError: '', tabId: '' };
  const registry = getNativeTabRegistry(sessionId, partition, false);
  const activeTabId = String(registry?.activeTabId || meta.tabId || '').trim();
  const profile = nativeProfileFromPartition(partition);
  const profileDescriptor = resolveNativeProfileDescriptor(profile);
  return {
    sessionId: String(sessionId || ''),
    profile,
    profileLabel: profileDescriptor.label,
    partition,
    attached: extra.attached !== undefined ? extra.attached : true,
    url: meta.url || 'about:blank',
    title: meta.title || '',
    loading: meta.loading === true,
    lastError: meta.lastError || '',
    activeTabId,
    tabs: nativeTabsForSession(sessionId, partition, activeTabId),
    presented: partition === presentedNativePartition && activeTabId === presentedNativeTabId,
    timestamp: Date.now(),
    ...extra,
  };
}

// Emits a session state payload and, when that session's view is the presented
// one, refreshes the canvas-facing broadcast too.
function emitNativeSessionState(sessionId, view, partition, extra = {}) {
  const payload = nativeSessionStatePayload(sessionId, view, partition, extra);
  const meta = view ? nativeViewMeta(view) : null;
  if (partition === presentedNativePartition && (!meta || meta.tabId === presentedNativeTabId)) broadcastNativeBrowserState();
  return payload;
}

function wireNativeViewEvents(view, partition, sessionId, tabId) {
  const wc = view.webContents;
  const meta = nativeViewMeta(view);
  const onUpdate = () => {
    if (partition === presentedNativePartition && tabId === presentedNativeTabId) broadcastNativeBrowserState();
  };
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
      Promise.resolve().then(async () => {
        const created = ensureNativeBrowserView(sessionId, '', '', { forceNew: true });
        presentNativeView(partition, created.tabId, sessionId);
        if (targetUrl !== 'about:blank') await created.view.webContents.loadURL(targetUrl);
      }).catch((err) => { meta.lastError = err?.message || String(err); onUpdate(); });
    } catch (err) {
      meta.lastError = err?.message || String(err);
      onUpdate();
    }
    return { action: 'deny' };
  });
  wc.on('did-start-loading', () => { meta.loading = true; onUpdate(); });
  wc.on('did-stop-loading', () => { meta.loading = false; onUpdate(); });
  wc.on('did-finish-load', () => {
    if (meta.designMode === true) {
      try { wc.send('prometheus-design-mode', { enabled: true }); } catch {}
    }
  });
  wc.on('did-navigate', (_event, url) => { meta.lastError = ''; meta.url = url || wc.getURL() || meta.url; meta.title = wc.getTitle() || meta.title || ''; onUpdate(); });
  wc.on('did-navigate-in-page', (_event, url) => { meta.lastError = ''; meta.url = url || wc.getURL() || meta.url; meta.title = wc.getTitle() || meta.title || ''; onUpdate(); });
  wc.on('page-title-updated', (_event, title) => { meta.title = title || wc.getTitle() || ''; onUpdate(); });
  wc.on('did-fail-load', (_event, _code, description, validatedURL) => { meta.lastError = description || 'Native browser load failed.'; meta.url = validatedURL || wc.getURL() || meta.url; onUpdate(); });
}

// Ensures a view exists for the resolved profile partition and tab, and maps
// the session to it. Returns { view, partition, tabId }.
function ensureNativeBrowserView(sessionId = '', profileId = '', requestedTabId = '', options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Prometheus window is not ready.');
  if (!refreshNativeBrowserAvailability()) throw new Error('Electron native browser surface is unavailable in this runtime.');
  const partition = resolveNativePartition(sessionId, profileId);
  const sid = String(sessionId || '').trim();
  if (sid) nativeBrowserSessionPartitions.set(sid, partition);
  const registry = getNativeTabRegistry(sid, partition, true);
  let tabId = String(requestedTabId || '').trim();
  if (!tabId && options.forceNew !== true) tabId = String(registry.activeTabId || registry.tabIds[0] || '').trim();
  if (!tabId) tabId = createNativeBrowserTabId();
  if (!registry.tabIds.includes(tabId)) registry.tabIds.push(tabId);
  registry.activeTabId = tabId;

  let view = getNativeViewByPartition(partition, tabId);
  if (view) return { view, partition, tabId };

  const profileDescriptor = resolveNativeProfileDescriptor(partition);
  const webPreferences = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    preload: path.join(__dirname, 'inhouse-browser-preload.js'),
  };
  if (profileDescriptor.session) webPreferences.session = profileDescriptor.session;
  else webPreferences.partition = partition;
  let creationError = null;
  for (const implementation of nativeBrowserViewImplementations()) {
    let candidate = null;
    try {
      candidate = new implementation.Constructor({ webPreferences });
      candidate.__prometheusNativeBrowserViewKind = implementation.kind;
      attachNativeBrowserView(candidate);
      view = candidate;
      break;
    } catch (error) {
      creationError = error;
      writeGatewayLog(`[main] Failed to create ${implementation.kind} native browser view: ${error?.message || error}\n`);
      try { detachNativeBrowserView(candidate); } catch {}
      try {
        if (candidate?.webContents && !candidate.webContents.isDestroyed()) candidate.webContents.destroy?.();
      } catch {}
    }
  }
  if (!view) throw creationError || new Error('Electron native browser surface could not be created.');

  view.setBounds({ ...NATIVE_BROWSER_EMPTY_BOUNDS });
  applyNativeBrowserUserAgent(view);
  const meta = nativeViewMeta(view);
  meta.sessionId = sid;
  meta.partition = partition;
  meta.tabId = tabId;
  wireNativeViewEvents(view, partition, sid, tabId);
  nativeBrowserViews.set(nativeTabKey(partition, tabId), view);
  return { view, partition, tabId };
}

function requireNativeViewForSession(sessionId, profileId = '', tabId = '') {
  const { view, partition, tabId: resolvedTabId } = ensureNativeBrowserView(sessionId, profileId, tabId);
  const wc = view.webContents;
  if (!wc || wc.isDestroyed()) throw new Error('Native browser view is not available.');
  return { view, wc, partition, tabId: resolvedTabId };
}

// Makes one profile's view the canvas-visible one. Detached inactive views keep
// their WebContents alive for automation, while avoiding multiple attached
// WebContentsViews (which can report incorrect visibility on macOS).
function presentNativeView(partition, tabId = '', sessionId = '') {
  const sid = String(sessionId || nativeBrowserState.sessionId || '').trim();
  const registry = getNativeTabRegistry(sid, partition, true);
  const selectedTabId = String(tabId || registry.activeTabId || registry.tabIds[0] || '').trim();
  if (selectedTabId) registry.activeTabId = selectedTabId;
  presentedNativePartition = partition;
  presentedNativeTabId = selectedTabId;
  if (sid) nativeBrowserState.sessionId = sid;
  nativeBrowserState.activeTabId = selectedTabId;
  nativeBrowserState.partition = partition;
  nativeBrowserState.profile = nativeProfileFromPartition(partition);
  for (const [, v] of nativeBrowserViews) {
    const meta = nativeViewMeta(v);
    const isSelected = meta.partition === partition && meta.tabId === selectedTabId;
    if (isSelected) {
      attachNativeBrowserView(v);
    } else {
      try { v.setBounds({ ...NATIVE_BROWSER_EMPTY_BOUNDS }); } catch {}
      detachNativeBrowserView(v);
    }
  }
}

function setNativeBrowserBounds(bounds = {}, sessionId = '', tabId = '') {
  const sid = String(sessionId || nativeBrowserState.sessionId || '').trim();
  const partition = resolveNativePartition(sid, '');
  if (!nativeBrowserState.attached) {
    nativeBrowserState.visible = false;
    nativeBrowserState.bounds = { ...NATIVE_BROWSER_EMPTY_BOUNDS };
    return broadcastNativeBrowserState({ visible: false });
  }
  if (tabId) {
    const registry = getNativeTabRegistry(sid, partition, false);
    if (registry?.tabIds.includes(String(tabId).trim())) registry.activeTabId = String(tabId).trim();
  }
  presentNativeView(partition);
  const next = clampNativeBrowserBoundsToContent(bounds);
  nativeBrowserState.bounds = next;
  nativeBrowserState.visible = nativeBrowserState.attached && next.width > 8 && next.height > 8;
  const view = getNativeViewByPartition(partition, presentedNativeTabId);
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
  nativeBrowserState.attached = false;
  nativeBrowserState.visible = false;
  nativeBrowserState.bounds = { ...NATIVE_BROWSER_EMPTY_BOUNDS };
  for (const [, view] of nativeBrowserViews) {
    try { view.setBounds({ ...NATIVE_BROWSER_EMPTY_BOUNDS }); } catch {}
    detachNativeBrowserView(view);
  }
  return broadcastNativeBrowserState({ reason, attached: false, visible: false });
}

async function openNativeBrowserSurface({ sessionId = '', url = '', profile = '', tabId = '' } = {}) {
  const { view, wc, partition, tabId: resolvedTabId } = requireNativeViewForSession(sessionId, profile, tabId);
  presentNativeView(partition, resolvedTabId, sessionId);
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
async function attachNativeBrowserSurface({ sessionId = '', url = '', profile = '', tabId = '' } = {}) {
  const { view, wc, partition, tabId: resolvedTabId } = requireNativeViewForSession(sessionId, profile, tabId);
  presentNativeView(partition, resolvedTabId, sessionId);
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

async function navigateNativeBrowserSurface({ action = '', url = '', sessionId = '', tabId = '' } = {}) {
  const { view, wc, partition, tabId: resolvedTabId } = requireNativeViewForSession(sessionId, '', tabId);
  presentNativeView(partition, resolvedTabId, sessionId);
  const normalized = String(action || '').trim().toLowerCase();
  nativeViewMeta(view).lastError = '';
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

function listNativeBrowserTabs({ sessionId = '', profile = '' } = {}) {
  const sid = String(sessionId || '').trim();
  const partition = resolveNativePartition(sid, profile);
  const registry = getNativeTabRegistry(sid, partition, false);
  return {
    sessionId: sid,
    profile: nativeProfileFromPartition(partition),
    partition,
    activeTabId: String(registry?.activeTabId || '').trim(),
    tabs: nativeTabsForSession(sid, partition, registry?.activeTabId || ''),
    attached: !!(registry && registry.tabIds.length),
    presented: partition === presentedNativePartition,
    timestamp: Date.now(),
  };
}

function selectNativeBrowserTab({ sessionId = '', tabId = '', index = null } = {}) {
  const sid = String(sessionId || '').trim();
  const partition = resolveNativePartition(sid, '');
  const registry = getNativeTabRegistry(sid, partition, false);
  if (!registry || !registry.tabIds.length) throw new Error('No native browser tabs are open.');
  const requested = String(tabId || '').trim();
  const selectedTabId = requested || registry.tabIds[Math.max(0, Math.min(registry.tabIds.length - 1, Number(index) || 0))];
  if (!registry.tabIds.includes(selectedTabId)) throw new Error('No native browser tab "' + selectedTabId + '".');
  const view = getNativeViewByPartition(partition, selectedTabId);
  if (!view) throw new Error('The requested native browser tab is no longer available.');
  registry.activeTabId = selectedTabId;
  presentNativeView(partition, selectedTabId, sid);
  nativeBrowserState.attached = true;
  nativeBrowserState.sessionId = sid;
  return emitNativeSessionState(sid, view, partition);
}

async function newNativeBrowserTab({ sessionId = '', url = '', profile = '' } = {}) {
  const sid = String(sessionId || '').trim();
  const { view, wc, partition, tabId } = ensureNativeBrowserView(sid, profile, '', { forceNew: true });
  presentNativeView(partition, tabId, sid);
  nativeBrowserState.attached = true;
  nativeBrowserState.sessionId = sid;
  const meta = nativeViewMeta(view);
  meta.lastError = '';
  const targetUrl = normalizeBrowserUrlForLoad(url || 'about:blank');
  if (targetUrl && targetUrl !== 'about:blank') await wc.loadURL(targetUrl);
  refreshNativeViewMeta(view);
  return emitNativeSessionState(sid, view, partition);
}

function destroyNativeBrowserView(partition, tabId, view) {
  const key = nativeTabKey(partition, tabId);
  detachNativeBrowserView(view);
  try {
    if (view?.webContents && !view.webContents.isDestroyed()) view.webContents.destroy?.();
  } catch {}
  nativeBrowserViews.delete(key);
}

function closeNativeBrowserTab({ sessionId = '', tabId = '', index = null } = {}) {
  const sid = String(sessionId || '').trim();
  const partition = resolveNativePartition(sid, '');
  const registry = getNativeTabRegistry(sid, partition, false);
  if (!registry || !registry.tabIds.length) throw new Error('No native browser tabs are open.');
  const requested = String(tabId || '').trim();
  const activeIndex = registry.tabIds.indexOf(registry.activeTabId);
  const tabIndex = requested
    ? registry.tabIds.indexOf(requested)
    : (index == null
      ? Math.max(0, activeIndex)
      : Math.max(0, Math.min(registry.tabIds.length - 1, Number(index) || 0)));
  if (tabIndex < 0) throw new Error('No native browser tab "' + requested + '".');
  const closingTabId = registry.tabIds[tabIndex];
  const view = getNativeViewByPartition(partition, closingTabId);
  if (view) destroyNativeBrowserView(partition, closingTabId, view);
  registry.tabIds.splice(tabIndex, 1);
  if (!registry.tabIds.length) {
    nativeBrowserSessionTabs.delete(nativeSessionKey(sid, partition));
    if (presentedNativePartition === partition) {
      presentedNativePartition = '';
      presentedNativeTabId = '';
      nativeBrowserState.attached = false;
      nativeBrowserState.visible = false;
      nativeBrowserState.bounds = { ...NATIVE_BROWSER_EMPTY_BOUNDS };
      nativeBrowserState.activeTabId = '';
      nativeBrowserState.tabs = [];
      broadcastNativeBrowserState({ attached: false, visible: false, activeTabId: '', tabs: [] });
    }
    return {
      sessionId: sid,
      profile: nativeProfileFromPartition(partition),
      partition,
      attached: false,
      activeTabId: '',
      tabs: [],
      presented: false,
      timestamp: Date.now(),
    };
  }
  const nextIndex = Math.min(tabIndex, registry.tabIds.length - 1);
  registry.activeTabId = registry.tabIds[nextIndex];
  const nextView = getNativeViewByPartition(partition, registry.activeTabId);
  presentNativeView(partition, registry.activeTabId, sid);
  nativeBrowserState.attached = true;
  nativeBrowserState.sessionId = sid;
  return emitNativeSessionState(sid, nextView, partition);
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

function setNativeBrowserDesignMode({ sessionId = '', enabled = false } = {}) {
  const { view, wc } = requireNativeViewForSession(sessionId);
  nativeViewMeta(view).designMode = enabled === true;
  wc.send('prometheus-design-mode', { enabled: !!enabled });
  writeGatewayLog(`[main] design-mode set enabled=${!!enabled} sessionId=${sessionId}\n`);
  return { ok: true, enabled: !!enabled };
}

function stateNativeBrowserSurface({ sessionId = '' } = {}) {
  // The RPC server starts before the renderer, so refresh this lazily as well
  // as during window creation. That lets browserDoctor/browser tools recognize
  // the in-app surface before the user has opened the canvas once.
  refreshNativeBrowserAvailability();
  const sid = String(sessionId || '').trim();
  if (sid) {
    if (nativeBrowserSessionPartitions.has(sid)) {
      const partition = nativeBrowserSessionPartitions.get(sid);
      const registry = getNativeTabRegistry(sid, partition, false);
      const view = getNativeViewByPartition(partition, registry?.activeTabId || '');
      if (view) return nativeSessionStatePayload(sid, view, partition);
      if (registry) return nativeSessionStatePayload(sid, null, partition, { attached: false });
    }
    // Never return the globally presented view for a session that has no native
    // registry yet. That view may belong to another chat and would leak its
    // tabs/URL into browserDoctor or a newly opened session.
    return {
      ...nativeSessionStatePayload(sid, null, partitionForNativeProfile(NATIVE_BROWSER_DEFAULT_PROFILE), { attached: false }),
      available: nativeBrowserState.available,
      visible: false,
      presented: false,
    };
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
        else if (pathName === '/tabs') result = listNativeBrowserTabs(payload);
        else if (pathName === '/select-tab') result = selectNativeBrowserTab(payload);
        else if (pathName === '/new-tab') result = await newNativeBrowserTab(payload);
        else if (pathName === '/close-tab') result = closeNativeBrowserTab(payload);
        else if (pathName === '/attach') result = await attachNativeBrowserSurface(payload);
        else if (pathName === '/bounds') result = setNativeBrowserBounds(payload.bounds || payload, payload.sessionId, payload.tabId);
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
  const view = partition ? getNativeViewByPartition(partition, presentedNativeTabId) : null;
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

handleTrustedMain('window:titlebar-theme', (_event, payload = {}) => (
  setElectronTitlebarTheme(payload)
));

handleTrustedMain('external-link:open', async (_event, payload = {}) => {
  return openExternalSafely(String(payload?.url || '').trim());
});

handleTrustedMain('select-canvas-paths', async (_event, options = {}) => {
  const mode = options && options.mode === 'folder'
    ? 'folder'
    : options && options.mode === 'any'
      ? 'any'
      : 'files';
  const requestedTitle = typeof options?.title === 'string' ? options.title.trim() : '';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: requestedTitle || (mode === 'folder' ? 'Add Folder to Canvas' : mode === 'any' ? 'Choose File or Folder' : 'Add Files to Canvas'),
    properties: mode === 'folder'
      ? ['openDirectory']
      : mode === 'any'
        ? ['openFile', 'openDirectory']
      : ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return Array.isArray(result.filePaths) ? result.filePaths : [];
});

handleTrustedMain('native-browser:available', () => refreshNativeBrowserAvailability());
handleTrustedMain('chrome-profiles:detect', () => getChromeProfileCatalog(USER_DATA_DIR));
handleTrustedMain('chrome-profiles:import', async (_event, options = {}) => {
  const profileId = String(options?.profileId || '').trim();
  if (!profileId) throw new Error('Choose a Chrome profile to import.');
  return copyChromeProfile(USER_DATA_DIR, profileId, { refresh: options?.refresh === true });
});
handleTrustedMain('native-browser:attach', async (_event, options = {}) => attachNativeBrowserSurface(options));
handleTrustedMain('native-browser:detach', async () => hideNativeBrowserSurface('detached'));
handleTrustedMain('native-browser:set-bounds', async (_event, bounds = {}) => setNativeBrowserBounds(bounds, bounds && bounds.sessionId, bounds && bounds.tabId));
handleTrustedMain('native-browser:navigate', async (_event, payload = {}) => navigateNativeBrowserSurface(payload));
handleTrustedMain('native-browser:list-tabs', async (_event, payload = {}) => listNativeBrowserTabs(payload));
handleTrustedMain('native-browser:select-tab', async (_event, payload = {}) => selectNativeBrowserTab(payload));
handleTrustedMain('native-browser:new-tab', async (_event, payload = {}) => newNativeBrowserTab(payload));
handleTrustedMain('native-browser:close-tab', async (_event, payload = {}) => closeNativeBrowserTab(payload));
handleTrustedMain('native-browser:focus', async () => {
  const sid = String(nativeBrowserState.sessionId || '').trim();
  try { requireNativeViewForSession(sid).wc.focus(); } catch {}
  return broadcastNativeBrowserState();
});
handleTrustedMain('native-browser:state', async () => broadcastNativeBrowserState());
handleTrustedMain('native-browser:teach-capture', async (_event, options = {}) => setNativeBrowserTeachCapture(options));
handleTrustedMain('native-browser:design-mode', async (_event, options = {}) => setNativeBrowserDesignMode(options));

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
ipcMain.on('prometheus-design-hover', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-design-hover', payload);
});
ipcMain.on('prometheus-design-select', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-design-select', payload);
});
ipcMain.on('prometheus-design-action', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-design-action', payload);
});
ipcMain.on('prometheus-design-chat', (event, payload = {}) => {
  relayTeachEvent(event, 'native-browser-design-chat', payload);
});

handleTrustedMain('updater:get-state', () => getUpdaterState());

handleTrustedMain('updater:check', async () => (
  runLocalCanonicalUpdateOperation('manual-check', () => checkForPrometheusUpdates('manual', true))
));

handleTrustedMain('updater:download', async () => (
  runLocalCanonicalUpdateOperation('manual-download', () => downloadPrometheusUpdate('manual', true))
));

handleTrustedMain('updater:set-auto-update', async (_event, payload = {}) => (
  setAutoUpdateEnabled(payload?.enabled === true)
));

handleTrustedMain('updater:install', async (_event, payload = {}) => {
  if (payload?.confirm !== true) {
    updaterStatus = 'error';
    updaterMessage = 'Explicit confirmation is required before installing a Prometheus update.';
    return sendUpdaterState({ source: 'desktop-settings', errorCode: 'confirmation_required' });
  }
  if (!autoUpdater || !canonicalUpdaterApi) {
    updaterStatus = 'unsupported';
    updaterMessage = 'Safe updates are available only in packaged public builds.';
    return sendUpdaterState({ source: 'desktop-settings', errorCode: 'unsupported' });
  }
  return runSafeCanonicalApply({ source: 'desktop-settings', confirmed: true });
});

// ─── Main Window ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1440,
    height:          920,
    minWidth:        960,
    minHeight:       640,
    // Let the renderer own the title-bar surface while Electron keeps the
    // platform-native window buttons. This is the same overlay model used by
    // modern desktop apps: the app header can occupy the title-bar area, but
    // minimize/maximize/close remain OS-managed and continue to work with
    // keyboard shortcuts, double-click, and accessibility tooling.
    frame:           false,
    titleBarStyle:   process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    // Keep the Windows/Linux native controls inside the same dark surface as
    // the renderer header. `transparent` looks like a white rectangle on
    // Windows when the frameless overlay is composited by DWM.
    titleBarOverlay: process.platform === 'darwin'
      ? false
      : {
          color:       DEFAULT_TITLEBAR_COLOR,
          symbolColor: DEFAULT_TITLEBAR_SYMBOL_COLOR,
          height:      ELECTRON_TITLEBAR_HEIGHT,
        },
    trafficLightPosition: process.platform === 'darwin'
      ? { x: 12, y: 8 }
      : undefined,
    thickFrame:      true,
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
  refreshNativeBrowserAvailability();

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(GATEWAY_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedRendererUrl(url, GATEWAY_URL) || isLocalGatewayUrl(url, GATEWAY_URL)) {
      mainWindow.loadURL(url);
    } else if (!requestPrometheusBrowserNavigation(url)) {
      const passthrough = normalizePassthroughExternalUrl(url);
      if (passthrough) {
        openPassthroughExternalSafely(passthrough).catch((error) => {
          writeGatewayLog(`[main] Failed to open passthrough URL: ${error && error.message ? error.message : error}\n`);
        });
      } else {
        openExternalSafely(url).catch((error) => {
          writeGatewayLog(`[main] Failed to open external URL: ${error && error.message ? error.message : error}\n`);
        });
      }
    }
    return { action: 'deny' };
  });

  const guardMainNavigation = (event, url) => {
    if (isTrustedRendererUrl(url, GATEWAY_URL) || isLocalGatewayUrl(url, GATEWAY_URL)) return;
    event.preventDefault();
    if (!requestPrometheusBrowserNavigation(url)) {
      const passthrough = normalizePassthroughExternalUrl(url);
      if (passthrough) {
        openPassthroughExternalSafely(passthrough).catch((error) => {
          writeGatewayLog(`[main] Failed to open passthrough URL: ${error && error.message ? error.message : error}\n`);
        });
      } else {
        openExternalSafely(url).catch((error) => {
          writeGatewayLog(`[main] Failed to open external URL: ${error && error.message ? error.message : error}\n`);
        });
      }
    }
  };
  mainWindow.webContents.on('will-navigate', guardMainNavigation);
  mainWindow.webContents.on('will-redirect', guardMainNavigation);

  mainWindow.on('closed', () => {
    mainWindow = null;
    nativeBrowserState.available = false;
  });
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
    const releaseCheck = validatePrometheusRelease(info);
    if (!releaseCheck.ok) {
      availableUpdate = null;
      pendingUpdate = null;
      updaterReleaseValidated = false;
      updaterSha512Verified = false;
      updaterStatus = 'error';
      updaterMessage = releaseCheck.message;
      sendUpdaterState({ errorCode: 'release_validation_failed' });
      return;
    }
    availableUpdate = info;
    pendingUpdate = null;
    updaterReleaseValidated = true;
    updaterSha512Verified = false;
    updaterStatus = 'available';
    updaterMessage = `Prometheus ${info.version || 'update'} is available. Choose Download, then confirm installation.`;
    updaterProgress = 0;
    sendUpdaterState({
      version: info.version || '',
      releaseName: info.releaseName || (info.version ? `v${info.version}` : ''),
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    });
    // Downloads are always explicit. The preference controls checks only.
  });

  autoUpdater.on('update-not-available', () => {
    availableUpdate = null;
    pendingUpdate = null;
    updaterReleaseValidated = false;
    updaterSha512Verified = false;
    updaterStateBackupCreated = false;
    updaterBackupId = '';
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
    console.log(`[Updater] Update downloaded: v${info.version} — awaiting SHA-512 verification`);
    availableUpdate = info;
    pendingUpdate = info;
    updaterReleaseValidated = validatePrometheusRelease(info).ok;
    updaterSha512Verified = false;
    updaterStatus = 'downloading';
    updaterMessage = 'Download complete. Verifying the release SHA-512 before it can be installed...';
    updaterProgress = 99;
    // The ready event is emitted only by downloadPrometheusUpdate after the
    // returned installer path has passed SHA-512 verification.
    sendUpdaterState();
  });

  autoUpdater.on('error', (err) => {
    const safeMessage = canonicalUpdaterApi?.sanitizeUpdateError
      ? canonicalUpdaterApi.sanitizeUpdateError(err)
      : 'Update operation failed.';
    updaterStatus = 'error';
    updaterMessage = safeMessage;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', updaterMessage);
    }
    sendUpdaterState();
  });

  // Delay the first check so it doesn't race with gateway startup.
  setTimeout(() => {
    runLocalCanonicalUpdateOperation('startup-check', () => checkForPrometheusUpdates('startup', true)).catch((e) => {
      console.error('[Updater] startup check failed:', e.message);
    });
  }, 10_000); // 10s after app is ready
}

async function prepareSourceElectronRenderer() {
  if (!IS_SOURCE_ELECTRON_DEV) return;
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['serviceworkers', 'cachestorage'],
    });
    writeGatewayLog(`[main] Source Electron renderer cache reset (${ELECTRON_PROFILE_DIR})\n`);
  } catch (error) {
    writeGatewayLog(`[main] Source Electron renderer cache reset failed: ${error && error.message ? error.message : error}\n`);
  }
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (!singleInstanceLock) return;

  // ── Step 1: First-run / post-update dependency check ──────────────────
  if (!IS_PACKAGED_RUNTIME && (needsDependencySetup() || getMissingPackages().length > 0)) {
    const setupWin = createSetupWindow();
    await runDependencySetup(setupWin);
    setupWin.close();
  }

  // ── Step 2: Show loading splash + start gateway ────────────────────────
  const loader = createLoadingWindow();
  try {
    // safeStorage is available only after Electron is ready. Validate the
    // previous release's retained backup before starting normal app traffic.
    await completePendingCanonicalValidation();
  } catch (error) {
    writeGatewayLog(`[main] Pending update validation failed closed: ${error && error.message ? error.message : error}\n`);
  }
  try {
    await startNativeBrowserRpcServer();
  } catch (err) {
    writeGatewayLog(`[main] Native browser RPC unavailable: ${err && err.message ? err.message : err}\n`);
  }
  try {
    await startGateway();
    await waitForGateway();
    await prepareSourceElectronRenderer();
    createWindow();
    loader.close();
    setupAutoUpdater();
    startCanonicalUpdateWatcher();
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

  // A safe update has already completed this handshake and cleared
  // gatewayProcess before quitAndInstall. For a normal quit, give the gateway
  // a bounded graceful-drain window, then terminate only this Electron-owned
  // process tree so closing the app cannot strand a listener or child worker.
  if (!gatewayProcess || gatewayProcess.killed || gatewayProcess.exitCode != null || gatewayProcess.signalCode != null) return;
  if (gatewayShuttingDown) {
    event.preventDefault();
    return;
  }

  const target = gatewayProcess;
  const targetRuntimePid = Number(readGatewayRuntimeStatus()?.pid || 0);
  gatewayShuttingDown = true;
  event.preventDefault();

  let settled = false;
  let shutdownTimer;
  let shutdownRequest;
  const finishQuit = (message, forceKill = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(shutdownTimer);
    try { shutdownRequest?.destroy(); } catch {}
    target.removeListener('exit', onExit);
    if (forceKill) {
      killManagedGatewayProcessTree(target);
      forceCleanupOwnedGatewayPort(target.pid || 0, targetRuntimePid);
    }
    if (gatewayProcess === target) gatewayProcess = null;
    gatewayShuttingDown = false;
    writeGatewayLog(`[main] ${forceKill ? 'Forced' : 'Graceful'} quit complete: ${message}\n`);
    app.quit();
  };
  const onExit = () => {
    if (settled) return;
    settled = true;
    clearTimeout(shutdownTimer);
    if (gatewayProcess === target) gatewayProcess = null;
    app.quit();
  };
  target.once('exit', onExit);
  shutdownTimer = setTimeout(() => {
    finishQuit(`The Prometheus gateway did not shut down gracefully within ${GATEWAY_QUIT_GRACE_MS / 1000} seconds.`, true);
  }, GATEWAY_QUIT_GRACE_MS);

  shutdownRequest = http.request(
    { hostname: '127.0.0.1', port: gatewayPort, path: '/api/internal/shutdown', method: 'POST', timeout: 5_000 },
    (res) => { res.resume(); },
  );
  shutdownRequest.on('timeout', () => {
    writeGatewayLog('[main] Graceful quit request timed out; waiting for bounded process cleanup\n');
    shutdownRequest.destroy();
  });
  shutdownRequest.on('error', (error) => {
    writeGatewayLog(`[main] Graceful quit request failed: ${error?.message || error}\n`);
  });
  shutdownRequest.end();
});
