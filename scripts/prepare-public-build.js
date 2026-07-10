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

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function mkdirp(target) {
  fs.mkdirSync(target, { recursive: true });
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
    fs.copyFileSync(src, dest);
    return;
  }

  const text = fs.readFileSync(src, 'utf-8');
  fs.writeFileSync(dest, text.replace(/[ \t]+$/gm, ''), 'utf-8');
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
    fs.copyFileSync(src, path.join(fontsDir, filename));
    declarations.push(
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./fonts/${filename}') format('woff2');}`,
    );
  }
  fs.writeFileSync(path.join(OUT_STATIC, 'styles', 'fonts.css'), `${declarations.join('\n')}\n`, 'utf-8');
}

function copyPublicWebVendorAssets() {
  copyVendorFile('node_modules/codemirror/lib/codemirror.css', 'codemirror/codemirror.min.css');
  copyVendorFile('node_modules/codemirror/theme/material-darker.css', 'codemirror/theme/material-darker.min.css');
  copyVendorFile('node_modules/codemirror/lib/codemirror.js', 'codemirror/codemirror.min.js');
  for (const mode of ['javascript', 'xml', 'css', 'htmlmixed', 'markdown', 'python']) {
    copyVendorFile(`node_modules/codemirror/mode/${mode}/${mode}.js`, `codemirror/mode/${mode}/${mode}.min.js`);
  }
  copyVendorFile('node_modules/marked/marked.min.js', 'marked/marked.min.js');
  copyVendorFile('node_modules/dompurify/dist/purify.min.js', 'dompurify/purify.min.js');
  copyVendorFile('web-ui/vendor/fabric/fabric.min.js', 'fabric/fabric.min.js');
  copyVendorFile('node_modules/gif.js/dist/gif.js', 'gif/gif.js');
  copyVendorFile('node_modules/gif.js/dist/gif.worker.js', 'gif/gif.worker.js');
  copyVendorFile('node_modules/@iconify/iconify/dist/iconify.min.js', 'iconify/iconify.min.js');
  copyVendorFile('node_modules/@lottiefiles/lottie-player/dist/lottie-player.js', 'lottie-player/lottie-player.js');
  copyVendorFile('node_modules/chart.js/dist/chart.umd.js', 'chart/chart.umd.js');
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
  'self-repair-protocol',
  'src-edit-proposal-rigor',
  'subagent-system-prompt-design',
  'voice-browser-desktop-smoke-test',
  'windows-shell-playbook',
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

function skillContainsPrivateContent(skillDir) {
  const stack = [skillDir];
  while (stack.length) {
    const current = stack.pop();
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
    if (skillContainsPrivateContent(srcSkillDir)) {
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
    count++;
  }

  console.log(`[prepare-public-build] Bundled ${count} skills to generated/bundled-skills`);
}

function buildPublicWebUi() {
  rmrf(OUT_ROOT);
  mkdirp(OUT_STATIC);

  const indexPath = path.join(SRC_WEB_UI, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf-8');

  // Replace attribute-style references: href="src/..." and src="src/..."
  html = html.replace(/(["'])src\//g, '$1static/');
  // Replace inline ES module import paths: from './src/...' and import('./src/...')
  html = html.replace(/(["'])\.\/(src)\//g, '$1./static/');
  html = html.replace(/(EXTRACTED to )src\//g, '$1static/');
  html = html.replace(
    '</head>',
    '<script>window.PROMETHEUS_PUBLIC_BUILD = true;</script>\n</head>',
  );

  fs.writeFileSync(path.join(OUT_ROOT, 'index.html'), html, 'utf-8');
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
}

if (!SKILLS_ONLY) {
  buildPublicWebUi();
  console.log('[prepare-public-build] Generated public web UI at generated/public-web-ui');
}

if (!WEB_ONLY) {
  bundleSkills();
}
