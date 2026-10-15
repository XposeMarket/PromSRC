'use strict';

// Single source of truth for which bundled skills ship in public builds and
// what must never appear inside a shipped skill. Used by
// scripts/prepare-public-build.js (build gate) and
// scripts/test-public-skill-bundle.mjs (CI gate).
//
// Every skill folder under workspace/skills must declare a visibility in its
// skill.json (or in workspace/skills/.manifests/<id>.skill.json for imported
// skills that keep metadata as an overlay):
//
//   "visibility": "public"    ships in the installer and is seeded for new users
//   "visibility": "personal"  owner-specific (accounts, projects, clients); never ships
//   "visibility": "dev"       Prometheus maintainer workflows (source repo, PR flow); never ships
//
// A public skill may also list owner-specific resource files that must be
// stripped from the public copy:
//
//   "publicExcludeResources": ["references/my-private-notes.md"]
//
// Missing visibility fails the public build. Content is never used to decide
// whether a skill ships; instead, a shipped copy that still contains any of the
// leak patterns below fails the build, so the fix is always explicit (clean the
// text, exclude the resource, or mark the skill personal/dev).

const fs = require('fs');
const path = require('path');

const SKILL_VISIBILITIES = Object.freeze(['public', 'personal', 'dev']);

const SKILL_TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.jsonl', '.md', '.markdown', '.mjs',
  '.ps1', '.py', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

// Owner identity, owner projects/clients, owner infrastructure, pinned
// owner-only model routes, and maintainer-only tools/paths.
const PUBLIC_SKILL_LEAK_PATTERNS = Object.freeze([
  { id: 'owner-name', re: /\bRaul\b/i },
  { id: 'owner-handle', re: /\braulinvests\b/i },
  { id: 'owner-home-dir', re: /\brafel\b/i },
  { id: 'owner-business', re: /\bXpose/i },
  { id: 'owner-client', re: /\bFrederick\b/i },
  { id: 'owner-project', re: /\b(?:NebulaX|Last Ward|Kart Rush|VitaShell|VitaLink|PS Vita|Vita bridge)\b/i },
  { id: 'owner-character', re: /\bEdna\b/ },
  { id: 'owner-tailnet', re: /desktop-sc61io5|tailca7310/i },
  { id: 'owner-agent', re: /x_account_operator|\bx-growth|Signal Radar|Opportunity Radar/i },
  { id: 'pinned-model-route', re: /\bgpt-6(?:\.\d+)?-(?:sol|luna)\b/i },
  { id: 'source-repo', re: /\bPromSRC\b|\bpromsrc-pr\b/i },
  // Placeholder / fixture user folders (<user>, %USERNAME%, $env, "Test User",
  // Public, Default) are fine; a concrete user folder is not.
  { id: 'local-path', re: /D:\\{1,2}Prometheus|[A-Z]:\\{1,2}Users\\{1,2}(?![<%$]|Test User\\|Public\\|Default\\)[A-Za-z]/ },
  { id: 'dev-workspace', re: /\bworkspace\/self\b/ },
  {
    id: 'dev-tool',
    re: /\b(?:read_dev_sources|apply_dev_source_patchset|request_dev_source_edit|update_dev_source_edit|await_dev_source_edit_approval|prom_apply_dev_changes|src_edit|prom_repo_(?:push|pull|sync))\b/,
  },
]);

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf-8')));
  } catch {
    return null;
  }
}

/** skill.json inside the folder wins; otherwise the .manifests overlay. */
function readSkillManifest(skillDir, overlayManifestPath) {
  const own = path.join(skillDir, 'skill.json');
  if (fs.existsSync(own)) return { manifest: readJsonFile(own), source: own };
  if (overlayManifestPath && fs.existsSync(overlayManifestPath)) {
    return { manifest: readJsonFile(overlayManifestPath), source: overlayManifestPath };
  }
  return { manifest: null, source: null };
}

function normalizeVisibility(value) {
  const text = String(value || '').trim().toLowerCase();
  return SKILL_VISIBILITIES.includes(text) ? text : null;
}

function publicExcludedResources(manifest) {
  const list = Array.isArray(manifest?.publicExcludeResources) ? manifest.publicExcludeResources : [];
  return new Set(list.map((item) => String(item || '').replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean));
}

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Returns [{ file, line, pattern, text }] for every leak-pattern hit in the
 * text files of a skill folder. `ignored` holds skill-relative paths to skip.
 */
function scanSkillDirForLeaks(skillDir, ignored = new Set()) {
  const hits = [];
  for (const file of walkFiles(skillDir)) {
    const rel = path.relative(skillDir, file).replace(/\\/g, '/');
    if (ignored.has(rel)) continue;
    if (!SKILL_TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const pattern of PUBLIC_SKILL_LEAK_PATTERNS) {
        if (pattern.re.test(text)) {
          hits.push({ file: rel, line: index + 1, pattern: pattern.id, text: text.trim().slice(0, 200) });
        }
      }
    });
  }
  return hits;
}

/**
 * Public skills must not route the model to a skill that does not ship.
 * Returns [{ file, line, skillId }] for references to non-public skill ids.
 */
function scanSkillDirForHiddenSkillRefs(skillDir, hiddenSkillIds, ignored = new Set()) {
  const ids = [...hiddenSkillIds].filter(Boolean);
  if (!ids.length) return [];
  const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\w-])(${escaped.join('|')})(?![\\w-])`);
  const hits = [];
  for (const file of walkFiles(skillDir)) {
    const rel = path.relative(skillDir, file).replace(/\\/g, '/');
    if (ignored.has(rel)) continue;
    if (!SKILL_TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    fs.readFileSync(file, 'utf-8').split(/\r?\n/).forEach((text, index) => {
      const match = re.exec(text);
      if (match) hits.push({ file: rel, line: index + 1, skillId: match[1], text: text.trim().slice(0, 200) });
    });
  }
  return hits;
}

/** Classify every skill folder in a source skills directory. */
function classifySourceSkills(skillsDir) {
  const manifestsDir = path.join(skillsDir, '.manifests');
  const skills = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const dir = path.join(skillsDir, entry.name);
    const hasEntrypoint = ['SKILL.md', 'skill.md', 'skill.json'].some((name) => fs.existsSync(path.join(dir, name)));
    if (!hasEntrypoint) continue;
    const { manifest, source } = readSkillManifest(dir, path.join(manifestsDir, `${entry.name}.skill.json`));
    skills.push({
      id: entry.name,
      dir,
      manifest,
      manifestSource: source,
      visibility: normalizeVisibility(manifest?.visibility),
      excludedResources: publicExcludedResources(manifest),
    });
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = {
  SKILL_VISIBILITIES,
  SKILL_TEXT_EXTENSIONS,
  PUBLIC_SKILL_LEAK_PATTERNS,
  classifySourceSkills,
  normalizeVisibility,
  publicExcludedResources,
  readSkillManifest,
  scanSkillDirForHiddenSkillRefs,
  scanSkillDirForLeaks,
};
