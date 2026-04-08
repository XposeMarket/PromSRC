/**
 * Prometheus Desktop - Electron Main Process
 *
 * Spawns the Prometheus gateway (tsx src/gateway/server-v2.ts)
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

const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const { spawn, execSync }  = require('child_process');
const path       = require('path');
const http       = require('http');
const fs         = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────
const GATEWAY_URL  = 'http://127.0.0.1:18789';
const APP_ROOT     = path.join(__dirname, '..');
const ICON_PATH    = path.join(APP_ROOT, 'assets', 'Prometheus.png');
const GATEWAY_ARGS = ['src/gateway/server-v2.ts'];
const MAX_RETRIES  = 40;
const RETRY_DELAY  = 500;

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

// ─── State ─────────────────────────────────────────────────────────────────
let mainWindow     = null;
let gatewayProcess = null;
let isQuitting     = false;

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

// ─── Gateway ───────────────────────────────────────────────────────────────
function startGateway() {
  console.log('[Prometheus] Starting gateway...');
  console.log(`[Prometheus] User data: ${USER_DATA_DIR}`);

  const isWin = process.platform === 'win32';

  const gatewayEnv = {
    ...process.env,
    FORCE_COLOR:              '0',
    PROMETHEUS_DATA_DIR:      USER_DATA_DIR,
    PROMETHEUS_WORKSPACE_DIR: path.join(USER_DATA_DIR, 'workspace'),
  };

  gatewayProcess = spawn('npx', ['tsx', ...GATEWAY_ARGS], {
    cwd:   APP_ROOT,
    env:   gatewayEnv,
    shell: isWin,
    windowsHide: true,
  });

  gatewayProcess.stdout?.on('data', (d) => process.stdout.write(`[gateway] ${d}`));
  gatewayProcess.stderr?.on('data', (d) => process.stderr.write(`[gateway] ${d}`));

  gatewayProcess.on('error', (err) => {
    console.error('[Prometheus] Gateway spawn error:', err.message);
    if (!isQuitting) {
      dialog.showErrorBox(
        'Prometheus — Gateway Error',
        `Failed to start the Prometheus gateway:\n\n${err.message}\n\nMake sure Node.js and npm dependencies are installed.`
      );
      app.quit();
    }
  });

  gatewayProcess.on('exit', (code, signal) => {
    if (!isQuitting) {
      console.error(`[Prometheus] Gateway exited unexpectedly (code=${code}, signal=${signal})`);
    }
  });
}

function waitForGateway(retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(GATEWAY_URL, (res) => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (retries-- > 0) {
          setTimeout(attempt, RETRY_DELAY);
        } else {
          reject(new Error(
            `Gateway did not respond at ${GATEWAY_URL} after ${(MAX_RETRIES * RETRY_DELAY) / 1000}s`
          ));
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

// ─── App Lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {

  // ── Step 1: First-run / post-update dependency check ──────────────────
  if (needsDependencySetup() || getMissingPackages().length > 0) {
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
  } catch (err) {
    loader.close();
    dialog.showErrorBox(
      'Prometheus — Startup Failed',
      `The Prometheus gateway did not start in time.\n\n${err.message}\n\nCheck that port 18789 is not already in use.`
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
    gatewayProcess.kill();
  }
});
