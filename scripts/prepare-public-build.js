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

// Skills that are internal/dev-only and should NOT be shipped to public users
const SKILLS_EXCLUDE = new Set([
  'json-and-config-surgery',
  'prometheus-team-design',
  'self-repair-protocol',
  'src-edit-proposal-rigor',
  'subagent-system-prompt-design',
]);

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
    if (!fs.existsSync(srcMd)) continue;

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

  fs.writeFileSync(path.join(OUT_ROOT, 'index.html'), html, 'utf-8');
  copyRecursive(path.join(SRC_WEB_UI, 'src'), OUT_STATIC);
}

if (!SKILLS_ONLY) {
  buildPublicWebUi();
  console.log('[prepare-public-build] Generated public web UI at generated/public-web-ui');
}

if (!WEB_ONLY) {
  bundleSkills();
}
