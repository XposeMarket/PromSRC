'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_WEB_UI = path.join(ROOT, 'web-ui');
const SRC_WEB_UI_SRC = path.join(SRC_WEB_UI, 'src');
const OUT_ROOT = path.join(ROOT, 'generated', 'public-web-ui');
const OUT_STATIC = path.join(OUT_ROOT, 'static');

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

function transformIndexHtml(html) {
  return html
    .replace(/(["'])src\//g, '$1static/')
    .replace(/(["'])\.\/(src)\//g, '$1./static/')
    .replace(/(EXTRACTED to )src\//g, '$1static/');
}

function compareBuffer(expectedPath, actualPath, expectedBuffer) {
  if (!fs.existsSync(actualPath)) {
    fail(`Missing generated file: ${toPosix(path.relative(ROOT, actualPath))}`);
    return;
  }

  const actualBuffer = fs.readFileSync(actualPath);
  if (!expectedBuffer.equals(actualBuffer)) {
    fail(
      `Generated file is stale: ${toPosix(path.relative(ROOT, actualPath))} ` +
      `(source: ${toPosix(path.relative(ROOT, expectedPath))})`
    );
  }
}

function verifyGeneratedWebUiIsCurrent() {
  const sourceIndex = path.join(SRC_WEB_UI, 'index.html');
  const generatedIndex = path.join(OUT_ROOT, 'index.html');

  if (!fs.existsSync(sourceIndex)) {
    fail(`Missing source UI index: ${toPosix(path.relative(ROOT, sourceIndex))}`);
    return;
  }

  const expectedIndex = Buffer.from(transformIndexHtml(fs.readFileSync(sourceIndex, 'utf8')), 'utf8');
  compareBuffer(sourceIndex, generatedIndex, expectedIndex);

  const expectedFiles = new Set(['index.html']);
  for (const sourcePath of walkFiles(SRC_WEB_UI_SRC)) {
    const relative = path.relative(SRC_WEB_UI_SRC, sourcePath);
    const generatedPath = path.join(OUT_STATIC, relative);
    expectedFiles.add(toPosix(path.join('static', relative)));
    compareBuffer(sourcePath, generatedPath, fs.readFileSync(sourcePath));
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
    if (!ref.startsWith(`${assetRootName}/`)) continue;

    const cleanRef = ref.split(/[?#]/, 1)[0];
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

function verifyJavaScriptSyntax(filePath) {
  const result = childProcess.spawnSync(process.execPath, ['--check', filePath], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    fail(
      `JavaScript syntax check failed for ${toPosix(path.relative(ROOT, filePath))}\n` +
      `${(result.stderr || result.stdout || '').trim()}`
    );
  }
}

function verifySourceWebUi() {
  verifyIndexAssets(SRC_WEB_UI, path.join(SRC_WEB_UI, 'index.html'), 'src');

  for (const filePath of walkFiles(SRC_WEB_UI_SRC).filter((file) => file.endsWith('.js'))) {
    verifyJavaScriptSyntax(filePath);
    verifyRelativeImports(filePath);
  }
}

function verifyGeneratedWebUi() {
  verifyIndexAssets(OUT_ROOT, path.join(OUT_ROOT, 'index.html'), 'static');
}

verifySourceWebUi();
verifyGeneratedWebUiIsCurrent();
verifyGeneratedWebUi();

if (failures.length > 0) {
  console.error('[check-public-web-ui-sync] Web UI check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('\nRun `npm run sync:web-ui` to regenerate generated/public-web-ui from web-ui.');
  process.exit(1);
}

console.log('[check-public-web-ui-sync] web-ui and generated/public-web-ui are in sync');
