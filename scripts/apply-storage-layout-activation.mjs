import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function file(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(file(rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(file(rel), content, 'utf8');
}

function replaceExact(rel, before, after, expected = 1) {
  let content = read(rel);
  const count = content.split(before).length - 1;
  if (count !== expected) {
    throw new Error(`${rel}: expected ${expected} exact occurrence(s), found ${count}: ${before.slice(0, 120)}`);
  }
  content = content.split(before).join(after);
  write(rel, content);
}

function replaceRegex(rel, regex, after, expected = 1) {
  let content = read(rel);
  const matches = [...content.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== expected) {
    throw new Error(`${rel}: expected ${expected} regex occurrence(s), found ${matches.length}: ${regex}`);
  }
  content = content.replace(regex, after);
  write(rel, content);
}

// Electron: retain the profile root for safeStorage, but switch gateway/updater/
// vault state to runtime/ only after the verified migration marker exists.
replaceExact(
  'electron/main.js',
  "const CANONICAL_UPDATE_CONFIG_DIR = path.join(USER_DATA_DIR, '.prometheus');\nconst GATEWAY_PORT_STATE_FILE = path.join(CANONICAL_UPDATE_CONFIG_DIR, 'electron-gateway-port.json');",
  `const LEGACY_RUNTIME_STATE_DIR = path.join(USER_DATA_DIR, '.prometheus');
const STORAGE_LAYOUT_V2_RUNTIME_DIR = path.join(USER_DATA_DIR, 'runtime');
const STORAGE_LAYOUT_V2_WORKSPACE_DIR = path.join(USER_DATA_DIR, 'workspace');
const STORAGE_LAYOUT_V2_READY_FILE = path.join(STORAGE_LAYOUT_V2_RUNTIME_DIR, 'migrations', 'storage-layout-v2-ready.json');
let STORAGE_LAYOUT_V2_ACTIVE = false;
let RUNTIME_STATE_DIR = LEGACY_RUNTIME_STATE_DIR;
let RUNTIME_CONFIG_DIR = LEGACY_RUNTIME_STATE_DIR;
let RUNTIME_CONFIG_FILE = path.join(RUNTIME_CONFIG_DIR, 'config.json');
let CANONICAL_UPDATE_CONFIG_DIR = RUNTIME_STATE_DIR;
let GATEWAY_PORT_STATE_FILE = path.join(RUNTIME_STATE_DIR, 'electron-gateway-port.json');

function sameStoragePath(left, right) {
  const a = path.resolve(String(left || ''));
  const b = path.resolve(String(right || ''));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isStorageLayoutV2Ready() {
  try {
    const marker = JSON.parse(fs.readFileSync(STORAGE_LAYOUT_V2_READY_FILE, 'utf8'));
    return marker?.readyToActivate === true
      && Number(marker?.layoutVersion) === 2
      && sameStoragePath(marker?.targetRuntimeRoot, STORAGE_LAYOUT_V2_RUNTIME_DIR)
      && sameStoragePath(marker?.targetWorkspaceRoot, STORAGE_LAYOUT_V2_WORKSPACE_DIR);
  } catch {
    return false;
  }
}

function refreshStorageLayoutState() {
  STORAGE_LAYOUT_V2_ACTIVE = isStorageLayoutV2Ready();
  RUNTIME_STATE_DIR = STORAGE_LAYOUT_V2_ACTIVE ? STORAGE_LAYOUT_V2_RUNTIME_DIR : LEGACY_RUNTIME_STATE_DIR;
  RUNTIME_CONFIG_DIR = STORAGE_LAYOUT_V2_ACTIVE ? path.join(RUNTIME_STATE_DIR, 'config') : LEGACY_RUNTIME_STATE_DIR;
  RUNTIME_CONFIG_FILE = path.join(RUNTIME_CONFIG_DIR, 'config.json');
  CANONICAL_UPDATE_CONFIG_DIR = RUNTIME_STATE_DIR;
  GATEWAY_PORT_STATE_FILE = path.join(RUNTIME_STATE_DIR, 'electron-gateway-port.json');
}

function runStorageLayoutV2Migration() {
  if (isStorageLayoutV2Ready()) return true;
  if (String(process.env.PROMETHEUS_STORAGE_MIGRATION_AUTO || '').trim() === '0') return false;
  try {
    const commonArgs = ['--execute', '--app-data', USER_DATA_DIR, '--migration-id', 'desktop-auto-v2'];
    const env = { ...process.env, PROMETHEUS_DATA_DIR: USER_DATA_DIR };
    if (IS_PACKAGED_RUNTIME) {
      const migrationEntry = path.join(getPackagedAppRoot(), 'dist', 'runtime', 'storage-migration-cli.js');
      if (!fs.existsSync(migrationEntry)) throw new Error(\`Storage migration entry is missing: \${migrationEntry}\`);
      execFileSync(process.execPath, [migrationEntry, ...commonArgs], {
        cwd: getGatewayWorkingDirectory(),
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
    } else {
      const tsxCli = path.join(APP_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const migrationEntry = path.join(APP_ROOT, 'src', 'runtime', 'storage-migration-cli.ts');
      const sourceNode = resolveSourceGatewayNode();
      execFileSync(sourceNode, [tsxCli, migrationEntry, ...commonArgs], {
        cwd: APP_ROOT,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
    }
    return isStorageLayoutV2Ready();
  } catch (error) {
    console.error('[StorageMigration] v2 migration did not activate; continuing on legacy state:', error?.message || error);
    return false;
  }
}

refreshStorageLayoutState();`
);

replaceExact(
  'electron/main.js',
  "const configPath = path.join(CANONICAL_UPDATE_CONFIG_DIR, 'config.json');",
  'const configPath = RUNTIME_CONFIG_FILE;',
  2,
);
replaceExact(
  'electron/main.js',
  "const vaultDir = path.join(USER_DATA_DIR, '.prometheus', 'vault');",
  "const vaultDir = path.join(RUNTIME_STATE_DIR, 'vault');",
);
replaceExact(
  'electron/main.js',
  "const statusPath = path.join(USER_DATA_DIR, '.prometheus', 'gateway-runtime-status.json');",
  "const statusPath = path.join(RUNTIME_STATE_DIR, 'gateway-runtime-status.json');",
);
replaceExact(
  'electron/main.js',
  "return readSharedGatewayProgressLease(path.join(USER_DATA_DIR, '.prometheus'));",
  'return readSharedGatewayProgressLease(RUNTIME_STATE_DIR);',
);
replaceExact(
  'electron/main.js',
  "    path.join(USER_DATA_DIR, '.prometheus'),\n    buildGatewaySupervisorEvidence({",
  "    RUNTIME_STATE_DIR,\n    buildGatewaySupervisorEvidence({",
);
replaceExact(
  'electron/main.js',
  "  console.log('[Prometheus] Starting gateway...');\n  console.log(`[Prometheus] User data: ${USER_DATA_DIR}`);",
  "  console.log('[Prometheus] Starting gateway...');\n  runStorageLayoutV2Migration();\n  refreshStorageLayoutState();\n  console.log(`[Prometheus] User data: ${USER_DATA_DIR}`);\n  console.log(`[Prometheus] Storage layout: ${STORAGE_LAYOUT_V2_ACTIVE ? 'v2' : 'legacy'}`);",
);
replaceExact(
  'electron/main.js',
  "    PROMETHEUS_DATA_DIR:          USER_DATA_DIR,\n    PROMETHEUS_APP_ROOT:          APP_ROOT,\n    PROMETHEUS_WORKSPACE_DIR:     path.join(USER_DATA_DIR, 'workspace'),",
  `    PROMETHEUS_DATA_DIR:          USER_DATA_DIR,
    PROMETHEUS_APP_DATA_DIR:      USER_DATA_DIR,
    PROMETHEUS_APP_ROOT:          APP_ROOT,
    PROMETHEUS_WORKSPACE_DIR:     STORAGE_LAYOUT_V2_WORKSPACE_DIR,
    ...(STORAGE_LAYOUT_V2_ACTIVE ? {
      PROMETHEUS_STORAGE_LAYOUT:  'canonical',
      PROMETHEUS_RUNTIME_DIR:     RUNTIME_STATE_DIR,
    } : {}),`,
);

// Lifecycle/restart state: getConfigDir preserves legacy `.prometheus` and
// becomes runtime/ under v2, so no extra `.prometheus` segment is needed.
replaceExact(
  'src/gateway/lifecycle.ts',
  "import { DEFAULT_GATEWAY_PORT, getRuntimeGatewayPort } from '../config/gateway-port.js';",
  "import { DEFAULT_GATEWAY_PORT, getRuntimeGatewayPort } from '../config/gateway-port.js';\nimport { getConfig } from '../config/config.js';",
);
replaceRegex(
  'src/gateway/lifecycle.ts',
  /function getLifecycleStateRoot\(\): string \{[\s\S]*?\n\}\n\nfunction getRestartContextPath\(\): string \{[\s\S]*?\n\}/,
  `function getLifecycleStateRoot(): string {
  return getConfig().getConfigDir();
}

function getRestartContextPath(): string {
  const stateRoot = getLifecycleStateRoot();
  if (!fs.existsSync(stateRoot)) fs.mkdirSync(stateRoot, { recursive: true });
  return path.join(stateRoot, 'restart-context.json');
}`,
);

// Onboarding had a historical app-data-root location in Electron. Preserve that
// in legacy mode, but store it in runtime/ after v2 activates.
replaceExact(
  'src/gateway/onboarding/onboarding-store.ts',
  "import * as crypto from 'crypto';",
  "import * as crypto from 'crypto';\nimport { getPrometheusLayout } from '../../runtime/storage-layout.js';",
);
replaceExact(
  'src/gateway/onboarding/onboarding-store.ts',
  "function dataDir(): string {\n  return process.env.PROMETHEUS_DATA_DIR || path.join(os.homedir(), '.prometheus');\n}",
  `function dataDir(): string {
  const layout = getPrometheusLayout();
  if (layout.mode === 'canonical') return layout.runtime.root;
  return process.env.PROMETHEUS_DATA_DIR || path.join(os.homedir(), '.prometheus');
}`,
);

// Runtime prompt-profile overrides belong to runtime/config in v2. Keep the
// historical resolver byte-for-byte in legacy mode.
replaceExact(
  'src/config/soul-loader.ts',
  "import { readPromptProfileText } from '../gateway/prompt-profile-snapshot.js';",
  "import { readPromptProfileText } from '../gateway/prompt-profile-snapshot.js';\nimport { getPrometheusLayout } from '../runtime/storage-layout.js';",
);
replaceExact(
  'src/config/soul-loader.ts',
  `const PROJECT_CONFIG_NEW = path.join(process.cwd(), '.prometheus');
const PROJECT_CONFIG = PROJECT_CONFIG_NEW;
const CONFIG_DIR = process.env.PROMETHEUS_DATA_DIR
  ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus')
  : fs.existsSync(PROJECT_CONFIG) ? PROJECT_CONFIG : path.join(os.homedir(), '.prometheus');`,
  `const PROJECT_CONFIG_NEW = path.join(process.cwd(), '.prometheus');
const PROJECT_CONFIG = PROJECT_CONFIG_NEW;
const STORAGE_LAYOUT = getPrometheusLayout();
const CONFIG_DIR = STORAGE_LAYOUT.mode === 'canonical'
  ? STORAGE_LAYOUT.runtime.config
  : process.env.PROMETHEUS_DATA_DIR
    ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus')
    : fs.existsSync(PROJECT_CONFIG) ? PROJECT_CONFIG : path.join(os.homedir(), '.prometheus');`,
);

// Manual/CLI pairing-admin token becomes ordinary runtime state in v2 while
// retaining its exact historical location under the classic ConfigManager.
replaceExact(
  'src/cli/index.ts',
  `function getGatewayStateRoot(): string {
  return process.env.PROMETHEUS_DATA_DIR || resolveInstallRoot();
}

function getPairingAdminTokenPath(): string {
  return path.join(getGatewayStateRoot(), '.prometheus', 'pairing-admin-token');
}`,
  `function getGatewayStateRoot(): string {
  return getConfig().getConfigDir();
}

function getPairingAdminTokenPath(): string {
  return path.join(getGatewayStateRoot(), 'pairing-admin-token');
}`,
);

// Remove this one-shot patch helper and its branch-only workflow in the same
// commit so no implementation helper ships in the final PR tree.
for (const rel of [
  'scripts/apply-storage-layout-activation.mjs',
  '.github/workflows/storage-layout-activation-patch.yml',
]) {
  try { fs.rmSync(file(rel), { force: true }); } catch {}
}

console.log('Applied exact storage-layout activation patch.');
