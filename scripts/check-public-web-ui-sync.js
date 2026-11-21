'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
const syntaxCache = require('./lib/syntax-check-cache.cjs');

const ROOT = path.join(__dirname, '..');
// Files whose exact bytes already passed both syntax checks are not re-checked (see the lib).
const SYNTAX_CACHE_FILE = path.join(ROOT, 'node_modules', '.cache', 'prometheus', 'web-ui-syntax.json');
const SYNTAX_CACHE_SALT = `node ${process.version}|esbuild ${esbuild.version}|node --check + esbuild esm chrome100`;
const SRC_WEB_UI = path.join(ROOT, 'web-ui');
const SRC_WEB_UI_SRC = path.join(SRC_WEB_UI, 'src');
const OUT_ROOT = path.join(ROOT, 'generated', 'public-web-ui');
const OUT_STATIC = path.join(OUT_ROOT, 'static');
const GENERATED_VENDOR_FILES = [
  'vendor/codemirror/codemirror.min.css',
  'vendor/codemirror/theme/material-darker.min.css',
  'vendor/codemirror/codemirror.min.js',
  'vendor/codemirror/mode/javascript/javascript.min.js',
  'vendor/codemirror/mode/xml/xml.min.js',
  'vendor/codemirror/mode/css/css.min.js',
  'vendor/codemirror/mode/htmlmixed/htmlmixed.min.js',
  'vendor/codemirror/mode/markdown/markdown.min.js',
  'vendor/codemirror/mode/python/python.min.js',
  'vendor/marked/marked.min.js',
  'vendor/jsqr/jsQR.js',
  'vendor/dompurify/purify.min.js',
  'vendor/fabric/fabric.min.js',
  'vendor/gif/gif.js',
  'vendor/gif/gif.worker.js',
  'vendor/iconify/iconify.min.js',
  'vendor/lottie-player/lottie-player.js',
  'vendor/chart/chart.umd.js',
  'vendor/prom-viz/prom-viz.js',
  'vendor/maplibre/maplibre-gl.js',
  'vendor/maplibre/maplibre-gl.css',
  'vendor/mermaid/mermaid.min.js',
  'static/fonts/manrope-400.woff2',
  'static/fonts/manrope-500.woff2',
  'static/fonts/manrope-600.woff2',
  'static/fonts/manrope-700.woff2',
  'static/fonts/manrope-800.woff2',
  'static/fonts/ibm-plex-mono-400.woff2',
  'static/fonts/ibm-plex-mono-500.woff2',
  'static/fonts/ibm-plex-mono-600.woff2',
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

// .gitattributes forces generated text files to LF on checkout while web-ui
// sources may be CRLF under core.autocrlf=true on Windows. A line-ending-only
// difference is not staleness, so it must not fail the build after a merge.
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.svg', '.webmanifest', '.md', '.txt']);
function sameTextIgnoringEol(expectedPath, expectedBuffer, actualBuffer) {
  if (!TEXT_EXTENSIONS.has(path.extname(expectedPath).toLowerCase())) return false;
  const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
  return norm(expectedBuffer) === norm(actualBuffer);
}

function compareBuffer(expectedPath, actualPath, expectedBuffer) {
  if (!fs.existsSync(actualPath)) {
    fail(`Missing generated file: ${toPosix(path.relative(ROOT, actualPath))}`);
    return;
  }

  const actualBuffer = fs.readFileSync(actualPath);
  if (!expectedBuffer.equals(actualBuffer) && !sameTextIgnoringEol(expectedPath, expectedBuffer, actualBuffer)) {
    fail(
      `Generated file is stale: ${toPosix(path.relative(ROOT, actualPath))} ` +
      `(source: ${toPosix(path.relative(ROOT, expectedPath))})`
    );
  }
}

function verifyGeneratedWebUiIsCurrent() {
  const sourceIndex = path.join(SRC_WEB_UI, 'index.html');

  if (!fs.existsSync(sourceIndex)) {
    fail(`Missing source UI index: ${toPosix(path.relative(ROOT, sourceIndex))}`);
    return;
  }

  const expectedFiles = new Set(['index.html']);
  for (const name of ['index.html', 'mobile.html']) {
    const sourcePath = path.join(SRC_WEB_UI, name);
    if (!fs.existsSync(sourcePath)) continue;
    expectedFiles.add(name);
    if (!fs.existsSync(path.join(OUT_ROOT, name))) fail(`Missing generated document: ${name}`);
  }
  for (const sourcePath of walkFiles(SRC_WEB_UI_SRC)) {
    const relative = path.relative(SRC_WEB_UI_SRC, sourcePath);
    const generatedPath = path.join(OUT_STATIC, relative);
    expectedFiles.add(toPosix(path.join('static', relative)));
    if (toPosix(relative) === 'styles/fonts.css') continue;
    compareBuffer(sourcePath, generatedPath, fs.readFileSync(sourcePath));
  }

  for (const relative of GENERATED_VENDOR_FILES) {
    expectedFiles.add(relative);
    const generatedPath = path.join(OUT_ROOT, relative);
    if (!fs.existsSync(generatedPath)) {
      fail(`Missing generated vendor file: ${relative}`);
    }
  }

  // PWA assets that live at the site root, not under static/.
  const ROOT_LEVEL_FILES = ['manifest.webmanifest', 'service-worker-v2.js'];
  for (const name of ROOT_LEVEL_FILES) {
    const sourcePath = path.join(SRC_WEB_UI, name);
    if (!fs.existsSync(sourcePath)) continue;
    const generatedPath = path.join(OUT_ROOT, name);
    expectedFiles.add(name);
    compareBuffer(sourcePath, generatedPath, fs.readFileSync(sourcePath));
  }
  expectedFiles.add('service-worker.js');
  if (!fs.existsSync(path.join(OUT_ROOT, 'service-worker.js'))) fail('Missing generated service-worker.js');

  const assetManifestPath = path.join(OUT_ROOT, 'asset-manifest.json');
  expectedFiles.add('asset-manifest.json');
  if (!fs.existsSync(assetManifestPath)) {
    fail('Missing generated asset-manifest.json');
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(assetManifestPath, 'utf8'));
      for (const asset of manifest.assets || []) {
        expectedFiles.add(String(asset.path || '').replace(/^\/+/, ''));
      }
    } catch (error) {
      fail(`Invalid generated asset-manifest.json: ${error.message}`);
    }
  }

  for (const generatedPath of walkFiles(OUT_ROOT)) {
    const relative = toPosix(path.relative(OUT_ROOT, generatedPath));
    if (!expectedFiles.has(relative)) {
      fail(`Unexpected generated file: ${relative}`);
    }
  }
}

function verifyIndexAssets(root, indexPath, assetRootName) {
  if (!fs.existsSync(indexPath)) return;

  const html = fs.readFileSync(indexPath, 'utf8');
  const assetPattern = /\b(?:href|src)=["']([^"']+)["']/g;
  let match;

  while ((match = assetPattern.exec(html)) !== null) {
    const ref = match[1];
    if (/^(?:https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('#')) continue;
    const rootedRef = ref.replace(/^\/+/, '');
    if (!rootedRef.startsWith(`${assetRootName}/`)) continue;

    const cleanRef = rootedRef.split(/[?#]/, 1)[0];
    const target = path.join(root, cleanRef);
    if (!fs.existsSync(target)) {
      fail(`Missing index asset reference in ${toPosix(path.relative(ROOT, indexPath))}: ${cleanRef}`);
    }
  }
}

function verifyRelativeImports(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const importPatterns = [
    /\bimport\s+[^'"()]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of importPatterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const ref = match[1];
      if (!ref.startsWith('.')) continue;

      const cleanRef = ref.split(/[?#]/, 1)[0];
      const target = path.resolve(path.dirname(filePath), cleanRef);
      if (!fs.existsSync(target)) {
        fail(`Missing module import in ${toPosix(path.relative(ROOT, filePath))}: ${ref}`);
      }
    }
  }
}

// `node --check` can accept a module graph that Chromium later rejects before
// any mobile UI mounts. Parse source through esbuild as a browser ES module too,
// so the static check uses a second, strict parser and reports an actionable
// source location. The async API lets esbuild parse every file concurrently.
async function runEsbuildChecks(files) {
  const results = new Map();
  await Promise.all(files.map(async (filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    try {
      await esbuild.transform(source, {
        loader: 'js',
        format: 'esm',
        target: 'chrome100',
        sourcefile: toPosix(path.relative(ROOT, filePath)),
      });
      results.set(filePath, null);
    } catch (error) {
      const details = Array.isArray(error?.errors) && error.errors.length
        ? error.errors.map((entry) => {
          const loc = entry.location ? `:${entry.location.line}:${entry.location.column}` : '';
          return `${entry.text || String(entry)}${loc}`;
        }).join('\n')
        : String(error?.message || error);
      results.set(filePath, details);
    }
  }));
  return results;
}

let esbuildCheckResults = new Map();
function verifyJavaScriptSyntax(filePath) {
  if (!esbuildCheckResults.has(filePath)) {
    fail(`Browser module syntax check did not run for ${toPosix(path.relative(ROOT, filePath))}`);
  } else if (esbuildCheckResults.get(filePath) !== null) {
    fail(
      `Browser module syntax check failed for ${toPosix(path.relative(ROOT, filePath))}\n${esbuildCheckResults.get(filePath)}`,
    );
  }

  const result = nodeCheckResults.get(filePath);
  if (!result || result.status !== 0) {
    fail(
      `JavaScript syntax check failed for ${toPosix(path.relative(ROOT, filePath))}\n` +
      `${(result ? result.output : 'node --check did not run').trim()}`
    );
  }
}

// `node --check` needs one process per file (~60 ms each on Windows, ~270 files), which
// made this check the slowest part of every build. Run the processes concurrently up
// front; failures are still reported per file, in the same order as before.
let nodeCheckResults = new Map();
function runNodeChecks(files) {
  const results = new Map();
  if (!files.length) return Promise.resolve(results);
  const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const limit = Math.max(1, Math.min(16, cpuCount || 1, files.length));
  let next = 0;
  const worker = () => new Promise((resolve) => {
    const launch = () => {
      if (next >= files.length) {
        resolve();
        return;
      }
      const filePath = files[next++];
      let output = '';
      let settled = false;
      const finish = (status, extra = '') => {
        if (settled) return;
        settled = true;
        results.set(filePath, { status, output: `${output}${extra}` });
        launch();
      };
      const child = childProcess.spawn(process.execPath, ['--check', filePath], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', (error) => finish(1, `\n${error && error.message ? error.message : error}`));
      child.on('close', (code, signal) => finish(code === 0 && !signal ? 0 : (code || 1), signal ? `\nterminated by ${signal}` : ''));
    };
    launch();
  });
  return Promise.all(Array.from({ length: limit }, worker)).then(() => results);
}

function verifySourceWebUi(sourceFiles) {
  verifyIndexAssets(SRC_WEB_UI, path.join(SRC_WEB_UI, 'index.html'), 'src');
  verifyIndexAssets(SRC_WEB_UI, path.join(SRC_WEB_UI, 'mobile.html'), 'src');

  for (const filePath of sourceFiles) {
    verifyJavaScriptSyntax(filePath);
    verifyRelativeImports(filePath);
  }
}

function verifyGeneratedWebUi() {
  verifyIndexAssets(OUT_ROOT, path.join(OUT_ROOT, 'index.html'), 'build');
  verifyIndexAssets(OUT_ROOT, path.join(OUT_ROOT, 'mobile.html'), 'build');
}

function verifyProductionManifest() {
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'build-web-ui-production.mjs'), '--check'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    fail(`Production module build is stale:\n${result.stdout || ''}${result.stderr || ''}`);
  }
}

async function main() {
  const sourceFiles = walkFiles(SRC_WEB_UI_SRC).filter((file) => file.endsWith('.js'));
  const useCache = syntaxCache.enabled();
  const passed = useCache ? syntaxCache.load(SYNTAX_CACHE_FILE, SYNTAX_CACHE_SALT) : new Set();
  const keys = new Map(sourceFiles.map((file) => [file, syntaxCache.cacheKey(fs.readFileSync(file), SYNTAX_CACHE_SALT)]));
  const toCheck = sourceFiles.filter((file) => !passed.has(keys.get(file)));
  [nodeCheckResults, esbuildCheckResults] = await Promise.all([runNodeChecks(toCheck), runEsbuildChecks(toCheck)]);
  for (const file of sourceFiles) {
    if (nodeCheckResults.has(file)) continue;
    nodeCheckResults.set(file, { status: 0, output: '' });
    esbuildCheckResults.set(file, null);
  }
  if (useCache) {
    for (const file of toCheck) {
      if (nodeCheckResults.get(file).status === 0 && esbuildCheckResults.get(file) === null) passed.add(keys.get(file));
    }
    syntaxCache.save(SYNTAX_CACHE_FILE, SYNTAX_CACHE_SALT, passed, [...keys.values()]);
  }
  verifySourceWebUi(sourceFiles);
  verifyGeneratedWebUiIsCurrent();
  verifyGeneratedWebUi();
  verifyProductionManifest();

  if (failures.length > 0) {
    console.error('[check-public-web-ui-sync] Web UI check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error('\nRun `npm run sync:web-ui` to regenerate generated/public-web-ui from web-ui.');
    process.exit(1);
  }

  console.log(`[check-public-web-ui-sync] web-ui and generated/public-web-ui are in sync (syntax-checked ${toCheck.length}, unchanged since a passing check ${sourceFiles.length - toCheck.length})`);
}

main().catch((error) => {
  console.error('[check-public-web-ui-sync] check crashed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
