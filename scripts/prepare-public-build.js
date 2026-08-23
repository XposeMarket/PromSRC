'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_WEB_UI = path.join(ROOT, 'web-ui');
const OUT_ROOT = path.join(ROOT, 'generated', 'public-web-ui');
const OUT_STATIC = path.join(OUT_ROOT, 'static');
const ARGS = new Set(process.argv.slice(2));
const WEB_ONLY = ARGS.has('--web-only');
const SKILLS_ONLY = ARGS.has('--skills-only');

const PUBLIC_WEB_VENDOR_FILES = [
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

let temporaryFileSequence = 0;

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function mkdirp(target) {
  fs.mkdirSync(target, { recursive: true });
}

function isFileLockError(error) {
  return ['EBUSY', 'EACCES', 'EPERM'].includes(error?.code);
}

function waitBriefly(milliseconds) {
  // This build script is intentionally synchronous. Atomics.wait gives us a
  // bounded retry without introducing an async rewrite to every copy helper.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function relativeDisplayPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function writeFileIfChanged(destination, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  mkdirp(path.dirname(destination));

  try {
    if (fs.readFileSync(destination).equals(buffer)) return;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      if (isFileLockError(error)) {
        throw new Error(
          `[prepare-public-build] Cannot read locked generated file ${relativeDisplayPath(destination)}. ` +
          'Close the app/preview serving the public build and retry.'
        );
      }
      throw error;
    }
  }

  const retryDelays = [50, 100, 200, 400];
  let lastError;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const temporary = `${destination}.prometheus-tmp-${process.pid}-${Date.now()}-${temporaryFileSequence++}`;
    try {
      fs.writeFileSync(temporary, buffer);
      fs.renameSync(temporary, destination);
      return;
    } catch (error) {
      lastError = error;
      try { fs.rmSync(temporary, { force: true }); } catch {}
      if (!isFileLockError(error) || attempt === retryDelays.length) break;
      waitBriefly(retryDelays[attempt]);
    }
  }

  if (isFileLockError(lastError)) {
    throw new Error(
      `[prepare-public-build] Cannot replace locked generated file ${relativeDisplayPath(destination)}. ` +
      'Close the app/preview serving the public build and retry.'
    );
  }
  throw lastError;
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  return files;
}

function expectedPublicWebUiFiles() {
  const expected = new Set(['index.html', ...PUBLIC_WEB_VENDOR_FILES]);
  if (fs.existsSync(path.join(SRC_WEB_UI, 'mobile.html'))) expected.add('mobile.html');
  const sourceRoot = path.join(SRC_WEB_UI, 'src');
  for (const sourcePath of listFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourcePath).replace(/\\/g, '/');
    expected.add(`static/${relative}`);
  }
  for (const name of ['manifest.webmanifest', 'service-worker.js']) {
    if (fs.existsSync(path.join(SRC_WEB_UI, name))) expected.add(name);
  }
  return expected;
}

function removeStalePublicWebUiFiles() {
  const expected = expectedPublicWebUiFiles();
  for (const generatedPath of listFiles(OUT_ROOT)) {
    const relative = path.relative(OUT_ROOT, generatedPath).replace(/\\/g, '/');
    if (expected.has(relative)) continue;
    try {
      fs.rmSync(generatedPath, { force: true });
    } catch (error) {
      if (isFileLockError(error)) {
        throw new Error(
          `[prepare-public-build] Cannot remove locked stale generated file ${relativeDisplayPath(generatedPath)}. ` +
          'Close the app/preview serving the public build and retry.'
        );
      }
      throw error;
    }
  }
}

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);

function copyFileForPublicBuild(src, dest, options = {}) {
  mkdirp(path.dirname(dest));

  if (!options.normalizeText || !TEXT_EXTENSIONS.has(path.extname(src).toLowerCase())) {
    writeFileIfChanged(dest, fs.readFileSync(src));
    return;
  }

  const text = fs.readFileSync(src, 'utf-8');
  writeFileIfChanged(dest, text.replace(/[ \t]+$/gm, ''));
}

function copyRecursive(src, dest, options = {}) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    mkdirp(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), options);
    }
    return;
  }
  copyFileForPublicBuild(src, dest, options);
}

function copyVendorFile(srcRel, destRel) {
  const src = path.join(ROOT, srcRel);
  if (!fs.existsSync(src)) {
    throw new Error(`[prepare-public-build] Missing vendor source: ${srcRel}`);
  }
  copyFileForPublicBuild(src, path.join(OUT_ROOT, 'vendor', destRel));
}

function writeLocalFontCss() {
  const fontsDir = path.join(OUT_STATIC, 'fonts');
  mkdirp(fontsDir);
  const fonts = [
    ['@fontsource/manrope/files/manrope-latin-400-normal.woff2', 'manrope-400.woff2', 'Manrope', 400],
    ['@fontsource/manrope/files/manrope-latin-500-normal.woff2', 'manrope-500.woff2', 'Manrope', 500],
    ['@fontsource/manrope/files/manrope-latin-600-normal.woff2', 'manrope-600.woff2', 'Manrope', 600],
    ['@fontsource/manrope/files/manrope-latin-700-normal.woff2', 'manrope-700.woff2', 'Manrope', 700],
    ['@fontsource/manrope/files/manrope-latin-800-normal.woff2', 'manrope-800.woff2', 'Manrope', 800],
    ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2', 'IBM Plex Mono', 400],
    ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500.woff2', 'IBM Plex Mono', 500],
    ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 'ibm-plex-mono-600.woff2', 'IBM Plex Mono', 600],
  ];
  const declarations = [];
  for (const [srcRel, filename, family, weight] of fonts) {
    const src = path.join(ROOT, 'node_modules', srcRel);
    if (!fs.existsSync(src)) {
      throw new Error(`[prepare-public-build] Missing font source: node_modules/${srcRel}`);
    }
    writeFileIfChanged(path.join(fontsDir, filename), fs.readFileSync(src));
    declarations.push(
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./fonts/${filename}') format('woff2');}`,
    );
  }
  writeFileIfChanged(path.join(OUT_STATIC, 'styles', 'fonts.css'), `${declarations.join('\n')}\n`);
}

function copyPublicWebVendorAssets() {
  copyVendorFile('node_modules/codemirror/lib/codemirror.css', 'codemirror/codemirror.min.css');
  copyVendorFile('node_modules/codemirror/theme/material-darker.css', 'codemirror/theme/material-darker.min.css');
  copyVendorFile('node_modules/codemirror/lib/codemirror.js', 'codemirror/codemirror.min.js');
  for (const mode of ['javascript', 'xml', 'css', 'htmlmixed', 'markdown', 'python']) {
    copyVendorFile(`node_modules/codemirror/mode/${mode}/${mode}.js`, `codemirror/mode/${mode}/${mode}.min.js`);
  }
  copyVendorFile('node_modules/marked/marked.min.js', 'marked/marked.min.js');
  copyVendorFile('node_modules/jsqr/dist/jsQR.js', 'jsqr/jsQR.js');
  copyVendorFile('node_modules/dompurify/dist/purify.min.js', 'dompurify/purify.min.js');
  copyVendorFile('web-ui/vendor/fabric/fabric.min.js', 'fabric/fabric.min.js');
  copyVendorFile('node_modules/gif.js/dist/gif.js', 'gif/gif.js');
  copyVendorFile('node_modules/gif.js/dist/gif.worker.js', 'gif/gif.worker.js');
  copyVendorFile('node_modules/@iconify/iconify/dist/iconify.min.js', 'iconify/iconify.min.js');
  copyVendorFile('node_modules/@lottiefiles/lottie-player/dist/lottie-player.js', 'lottie-player/lottie-player.js');
  copyVendorFile('node_modules/chart.js/dist/chart.umd.js', 'chart/chart.umd.js');
  copyVendorFile('node_modules/maplibre-gl/dist/maplibre-gl.js', 'maplibre/maplibre-gl.js');
  copyVendorFile('node_modules/maplibre-gl/dist/maplibre-gl.css', 'maplibre/maplibre-gl.css');
  copyVendorFile('node_modules/mermaid/dist/mermaid.min.js', 'mermaid/mermaid.min.js');
  writeLocalFontCss();
}

// Skills that are internal/dev-only and should NOT be shipped to public users
const SKILLS_EXCLUDE = new Set([
  'ai-surface-smoke-research',
  'dev-debugging',
  'file-surgery',
  'json-and-config-surgery',
  'prometheus-team-design',
  'src-edit-proposal-rigor',
  'subagent-system-prompt-design',
  'voice-browser-desktop-smoke-test',
  'windows-shell-playbook',
]);

const PUBLIC_SKILL_RESOURCE_EXCLUDES = new Map([
  ['git-workflow', new Set(['references/prometheus-public-release-pointer.md'])],
  ['self-repair-protocol', new Set(['references/dev-escalation.md'])],
]);

const PRIVATE_SKILL_CONTENT_PATTERNS = [
  /\bRaul\b/i,
  /\bXpose Market\b/i,
  /\bFrederick Roof Repair\b/i,
  /\bTelegram\b/i,
  /\bdesktop_send_to_telegram\b/i,
  /\bbrowser_send_to_telegram\b/i,
  /D:\\Prometheus/i,
  /C:\\Users\\rafel/i,
  /\bPromSRC\b/i,
  /\bworkspace\/self\b/i,
  /\bread_dev_sources\b/i,
  /\bapply_dev_source_patchset\b/i,
  /\brequest_dev_source_edit\b/i,
  /\bupdate_dev_source_edit\b/i,
  /\bawait_dev_source_edit_approval\b/i,
  /\bprom_apply_dev_changes\b/i,
  /\bsrc_edit\b/i,
];

function skillContainsPrivateContent(skillDir, ignoredRelativePaths = new Set()) {
  const stack = [skillDir];
  while (stack.length) {
    const current = stack.pop();
    const relative = path.relative(skillDir, current).replace(/\\/g, '/');
    if (ignoredRelativePaths.has(relative)) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
      continue;
    }
    if (!TEXT_EXTENSIONS.has(path.extname(current).toLowerCase())) continue;
    const text = fs.readFileSync(current, 'utf-8');
    if (PRIVATE_SKILL_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  }
  return false;
}

function bundleSkills() {
  const srcSkills = path.join(ROOT, 'workspace', 'skills');
  const destSkills = path.join(ROOT, 'generated', 'bundled-skills');
  const srcManifests = path.join(srcSkills, '.manifests');

  if (!fs.existsSync(srcSkills)) {
    console.log('[prepare-public-build] No workspace skills found, skipping skill bundling');
    return;
  }

  rmrf(destSkills);
  mkdirp(destSkills);

  let count = 0;
  for (const entry of fs.readdirSync(srcSkills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (SKILLS_EXCLUDE.has(entry.name)) continue;
    if (entry.name.endsWith('-team-design')) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const srcSkillDir = path.join(srcSkills, entry.name);
    const srcMd = path.join(srcSkillDir, 'SKILL.md');
    const srcMdLower = path.join(srcSkillDir, 'skill.md');
    const srcManifest = path.join(srcSkillDir, 'skill.json');
    if (!fs.existsSync(srcMd) && !fs.existsSync(srcMdLower) && !fs.existsSync(srcManifest)) continue;
    const privateScanIgnores = PUBLIC_SKILL_RESOURCE_EXCLUDES.get(entry.name) || new Set();
    if (skillContainsPrivateContent(srcSkillDir, privateScanIgnores)) {
      console.log(`[prepare-public-build] Skipping private/local skill: ${entry.name}`);
      continue;
    }

    const destSkillDir = path.join(destSkills, entry.name);
    copyRecursive(srcSkillDir, destSkillDir, { normalizeText: true });

    // Imported skills may keep Prometheus bundle metadata as an overlay in
    // workspace/skills/.manifests. Public bundled skills need that metadata
    // inside each skill directory so future workspaces seed the same triggers,
    // resources, and permissions.
    const destManifest = path.join(destSkillDir, 'skill.json');
    const overlayManifest = path.join(srcManifests, `${entry.name}.skill.json`);
    if (!fs.existsSync(destManifest) && fs.existsSync(overlayManifest)) {
      copyFileForPublicBuild(overlayManifest, destManifest, { normalizeText: true });
    }
    const excludedResources = PUBLIC_SKILL_RESOURCE_EXCLUDES.get(entry.name) || new Set();
    for (const relativePath of excludedResources) rmrf(path.join(destSkillDir, relativePath));
    if (excludedResources.size && fs.existsSync(destManifest)) {
      const manifest = JSON.parse(fs.readFileSync(destManifest, 'utf-8'));
      manifest.resources = (Array.isArray(manifest.resources) ? manifest.resources : [])
        .filter((resource) => !excludedResources.has(resource?.path));
      fs.writeFileSync(destManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    }
    count++;
  }

  console.log(`[prepare-public-build] Bundled ${count} skills to generated/bundled-skills`);
}

function buildPublicWebUi() {
  // Do not remove OUT_ROOT first. On Windows, a browser or preview process
  // can briefly hold an existing generated asset open; recursive deletion is
  // incremental and can leave the output tree half-deleted after EBUSY.
  mkdirp(OUT_STATIC);

  for (const name of ['index.html', 'mobile.html']) {
    const sourcePath = path.join(SRC_WEB_UI, name);
    if (!fs.existsSync(sourcePath)) continue;
    let html = fs.readFileSync(sourcePath, 'utf-8');

    // Replace both document-relative and root-relative source references.
    // Root-relative references are required by /mobile/* history routes.
    html = html.replace(/(["'])\/src\//g, '$1/static/');
    html = html.replace(/(["'])src\//g, '$1static/');
    html = html.replace(/(["'])\.\/(src)\//g, '$1./static/');
    html = html.replace(/(EXTRACTED to )src\//g, '$1static/');
    html = html.replace(
      '</head>',
      '<script>window.PROMETHEUS_PUBLIC_BUILD = true;</script>\n</head>',
    );

    writeFileIfChanged(path.join(OUT_ROOT, name), html);
  }
  copyRecursive(path.join(SRC_WEB_UI, 'src'), OUT_STATIC);
  copyPublicWebVendorAssets();

  // Root-level web-ui files that must be served at the site root (PWA contract).
  // The service worker must be at "/" to claim scope "/"; the manifest must be
  // at a stable path that <link rel="manifest"> can resolve.
  const ROOT_LEVEL_FILES = ['manifest.webmanifest', 'service-worker.js'];
  for (const name of ROOT_LEVEL_FILES) {
    const srcFile = path.join(SRC_WEB_UI, name);
    if (fs.existsSync(srcFile)) {
      copyFileForPublicBuild(srcFile, path.join(OUT_ROOT, name), { normalizeText: true });
    }
  }

  removeStalePublicWebUiFiles();
}

if (!SKILLS_ONLY) {
  buildPublicWebUi();
  console.log('[prepare-public-build] Generated public web UI at generated/public-web-ui');
}

if (!WEB_ONLY) {
  bundleSkills();
}
