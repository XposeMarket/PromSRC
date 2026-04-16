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

const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const { spawn, execSync }  = require('child_process');
const path       = require('path');
const http       = require('http');
const fs         = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────
const GATEWAY_URL  = 'http://127.0.0.1:18789';
const APP_ROOT     = path.join(__dirname, '..');
const ICON_PATH    = path.join(APP_ROOT, 'assets', 'Prometheus.ico');
const MAX_RETRIES  = 200;  // 200 x 300ms = 60s max wait (dev tsx startup can be slow)
const RETRY_DELAY  = 300;
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
let mainWindow     = null;
let gatewayProcess = null;
let isQuitting     = false;
let pendingUpdate  = null;  // holds UpdateInfo once a release is downloaded

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
    icon:            ICON_PATH,
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
// On Windows, if the previous gateway process didn't exit cleanly it may still
// hold port 18789. Kill any LISTENING process on that port before spawning.
function killPortIfInUse(port) {
  if (process.platform !== 'win32') return;
  try {
    const output = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, {
      encoding: 'utf-8', stdio: 'pipe',
    });
    const lines = output.trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0' && Number(pid) !== process.pid) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
          console.log(`[Prometheus] Killed stale gateway (PID ${pid}) holding port ${port}`);
        } catch { /* ignore */ }
      }
    }
  } catch { /* port not in use or netstat unavailable */ }
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

// ─── Gateway ───────────────────────────────────────────────────────────────
function startGateway() {
  console.log('[Prometheus] Starting gateway...');
  console.log(`[Prometheus] User data: ${USER_DATA_DIR}`);
  console.log(`[Prometheus] Packaged runtime: ${IS_PACKAGED_RUNTIME ? 'yes' : 'no'}`);

  openGatewayLog();
  writeGatewayLog(`[main] Gateway starting — pid will follow\n`);
  writeGatewayLog(`[main] Data dir: ${USER_DATA_DIR}\n`);
  writeGatewayLog(`[main] Packaged: ${IS_PACKAGED_RUNTIME}\n`);

  // Kill any stale gateway process that may still hold the port from a previous run.
  // This is synchronous — Windows releases the port almost immediately after kill.
  killPortIfInUse(18789);

  // Bundled skills path — inside extraResources (outside asar, accessible to Node subprocess)
  const bundledSkillsDir = IS_PACKAGED_RUNTIME
    ? path.join(process.resourcesPath, 'bundled-skills')
    : path.join(APP_ROOT, 'workspace', 'skills');

  const gatewayEnv = {
    ...process.env,
    FORCE_COLOR:                  '0',
    PROMETHEUS_DATA_DIR:          USER_DATA_DIR,
    PROMETHEUS_WORKSPACE_DIR:     path.join(USER_DATA_DIR, 'workspace'),
    PROMETHEUS_BUNDLED_SKILLS_DIR: bundledSkillsDir,
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

// ─── Loading Screen ────────────────────────────────────────────────────────
function createLoadingWindow() {
  const loader = new BrowserWindow({
    width:           420,
    height:          300,
    frame:           false,
    resizable:       false,
    center:          true,
    icon:            ICON_PATH,
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
ipcMain.handle('get-app-version', () => CURRENT_VERSION);

ipcMain.on('install-update', () => {
  if (autoUpdater && pendingUpdate) {
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true); // isSilent=false, isForceRunAfter=true
  }
});

// ─── Main Window ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1440,
    height:          920,
    minWidth:        960,
    minHeight:       640,
    icon:            ICON_PATH,
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(GATEWAY_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Auto-Update Events ────────────────────────────────────────────────────
// Wire after createWindow() has been called so mainWindow exists.
function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Update available: v${info.version}`);
    // Start download automatically (autoDownload=true handles this)
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', Math.round(progress.percent));
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Update downloaded: v${info.version} — ready to install`);
    pendingUpdate = info;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-ready', {
        version:     info.version,
        releaseName: info.releaseName || `v${info.version}`,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', err.message);
    }
  });

  // Delay the first check so it doesn't race with gateway startup.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.error('[Updater] checkForUpdates failed:', e.message);
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
  startGateway();

  try {
    await waitForGateway();
    createWindow();
    loader.close();
    setupAutoUpdater();
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

app.on('before-quit', () => {
  isQuitting = true;
  if (gatewayProcess && !gatewayProcess.killed) {
    try {
      // On Windows, TerminateProcess immediately — no graceful drain needed.
      if (process.platform === 'win32' && gatewayProcess.pid) {
        execSync(`taskkill /PID ${gatewayProcess.pid} /F /T`, { stdio: 'pipe' });
      } else {
        gatewayProcess.kill('SIGKILL');
      }
    } catch {
      gatewayProcess.kill();
    }
  }
});

