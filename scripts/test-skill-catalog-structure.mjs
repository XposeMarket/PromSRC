import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const { SkillsManager } = await import('../dist/gateway/skills-runtime/skills-manager.js');

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const manager = new SkillsManager(skillsRoot);
const catalog = manager.getAll();
const datePattern = /(?:19|20)\d{2}[-_](?:0[1-9]|1[0-2])[-_](?:0[1-9]|[12]\d|3[01])/;
const genericWords = new Set([
  'agent', 'automation', 'browser', 'code', 'coding', 'creative', 'data', 'desktop',
  'document', 'edit', 'email', 'file', 'help', 'image', 'marketing', 'post', 'project',
  'research', 'skill', 'social', 'task', 'tool', 'video', 'web', 'workflow', 'write', 'writing',
]);

function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.history') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function wordCount(text) {
  return (String(text).match(/[\p{L}\p{N}_-]+/gu) || []).length;
}

assert.equal(catalog.length, 145, 'unexpected catalog size');
assert.equal(new Set(catalog.map((skill) => skill.id)).size, catalog.length, 'duplicate skill IDs');
assert(catalog.every((skill) => skill.health.state === 'ready'), 'every catalog item must have ready health');
assert(catalog.every((skill) => skill.eligibility.status === 'ready'), 'every catalog item must pass eligibility');
assert(catalog.every((skill) => skill.safety.verdict !== 'critical'), 'critical skill safety finding remains');
assert(!manager.get('codex-desktop-restart'), 'renamed Codex restart skill remains');
assert(!manager.get('hyperframes-media'), 'retired hyperframes-media remains');
assert(!manager.get('website-to-hyperframes'), 'retired website-to-hyperframes remains');

for (const skill of catalog) {
  assert.equal(skill.validation.errors.length, 0, `${skill.id} has validation errors: ${skill.validation.errors.join('; ')}`);
  for (const resource of skill.resources) {
    assert(fs.existsSync(path.join(skill.rootDir, resource.path)), `${skill.id} declares missing ${resource.path}`);
  }
  if (skill.ownership === 'upstream-managed') continue;
  const raw = fs.readFileSync(skill.filePath, 'utf8');
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert(block, `${skill.id} is missing frontmatter`);
  const frontmatter = yaml.load(block[1]);
  assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name'], `${skill.id} frontmatter contains unsupported keys`);
  assert.equal(frontmatter.name, skill.id, `${skill.id} frontmatter name must equal its slug`);
  if (!['deprecated', 'archived'].includes(skill.lifecycle)) {
    assert(wordCount(raw) <= 750, `${skill.id} entrypoint exceeds 750 words`);
  }
}

const dated = walk(skillsRoot).filter((file) => datePattern.test(path.basename(file)));
assert.deepEqual(dated, [], `dated canonical resources remain: ${dated.join(', ')}`);

const manifestFiles = [
  ...fs.readdirSync(path.join(skillsRoot, '.manifests'))
    .filter((file) => file.endsWith('.skill.json'))
    .map((file) => path.join(skillsRoot, '.manifests', file)),
  ...fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(skillsRoot, entry.name, 'skill.json'))
    .filter((file) => fs.existsSync(file)),
];
const triggerOwners = new Map();
for (const file of manifestFiles) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = String(manifest.id || path.basename(path.dirname(file)));
  const triggers = Array.isArray(manifest.triggers) ? manifest.triggers : [];
  assert(triggers.length <= 12, `${id} stores more than 12 triggers in ${file}`);
  for (const raw of triggers) {
    const trigger = String(raw).trim().toLowerCase();
    const words = trigger.split(/\s+/).filter(Boolean);
    assert(!(words.length === 1 && (words[0].length < 5 || genericWords.has(words[0]))), `${id} stores generic trigger “${trigger}”`);
    const owners = triggerOwners.get(trigger) || new Set();
    owners.add(id);
    triggerOwners.set(trigger, owners);
  }
}
for (const [trigger, owners] of triggerOwners) {
  assert(owners.size <= 1, `exact trigger collision “${trigger}”: ${[...owners].join(', ')}`);
}

function headingIds(markdown) {
  const ids = new Set();
  const counts = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  }
  for (const match of markdown.matchAll(/<(?:a|[a-z][\w:-]*)\b[^>]*(?:id|name)=["']([^"']+)["']/gi)) ids.add(match[1]);
  return ids;
}

const brokenLinks = [];
for (const file of walk(skillsRoot).filter((candidate) => /\.md$/i.test(candidate))) {
  const markdown = fs.readFileSync(file, 'utf8');
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (!rawTarget || /^(?:https?:|mailto:|data:)/i.test(rawTarget)) continue;
    const [rawPath, rawFragment = ''] = rawTarget.split('#', 2);
    let targetPath;
    try { targetPath = decodeURIComponent(rawPath); } catch { targetPath = rawPath; }
    const target = targetPath ? path.resolve(path.dirname(file), targetPath) : file;
    if (!fs.existsSync(target)) {
      brokenLinks.push(`${path.relative(skillsRoot, file)} -> ${rawTarget}`);
      continue;
    }
    if (!rawFragment || !fs.statSync(target).isFile() || !/\.md$/i.test(target)) continue;
    let fragment;
    try { fragment = decodeURIComponent(rawFragment); } catch { fragment = rawFragment; }
    if (!headingIds(fs.readFileSync(target, 'utf8')).has(fragment)) {
      brokenLinks.push(`${path.relative(skillsRoot, file)} -> #${fragment}`);
    }
  }
}
assert.deepEqual(brokenLinks, [], `broken local Markdown links: ${brokenLinks.join('; ')}`);

console.log(`Skill catalog structure passed: ${catalog.length} skills, all ready/eligible, zero dated resources, trigger violations, or broken live links.`);
