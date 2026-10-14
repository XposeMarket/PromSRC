import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Regression for the public skill bundle (run after
// `node scripts/prepare-public-build.js --skills-only`).
// Which skills ship is decided by each skill's declared "visibility"
// (scripts/public-skill-policy.js), never by a content denylist.
const require = createRequire(import.meta.url);
const policy = require('./public-skill-policy.js');

const repo = path.resolve(import.meta.dirname, '..');
const sourceDir = path.join(repo, 'workspace', 'skills');
const root = path.join(repo, 'generated', 'bundled-skills');

// 1. Every source skill declares a valid visibility.
const source = policy.classifySourceSkills(sourceDir);
const untagged = source.filter((skill) => !skill.visibility).map((skill) => skill.id);
assert.deepEqual(untagged, [], `skills without a valid "visibility": ${untagged.join(', ')}`);

const expectedPublic = source.filter((skill) => skill.visibility === 'public').map((skill) => skill.id).sort();
const hidden = new Set(source.filter((skill) => skill.visibility !== 'public').map((skill) => skill.id));

// 2. The bundle is exactly the public set.
const shipped = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(shipped, expectedPublic, 'bundled skills differ from the skills tagged visibility:"public"');

// Snapshot so an accidental public-surface change needs an intentional update.
assert.equal(shipped.length, 186, 'unexpected public skill count');

const ids = new Set(shipped);
// Generic skills the old content denylist wrongly dropped must ship.
for (const id of [
  'fast-coding-loop', 'git-workflow', 'docx', 'spec-writing', 'receiving-code-review', 'file-surgery',
  'self-repair-protocol', 'chatgpt-desktop-restart', 'prometheus-ash-archive-style', 'webhook-receiver-framework',
  'pptx-writer', 'hyperframes', 'hyperframes-cli', 'media-use', 'website-to-video', 'scheduler-operations-playbook',
  'x-browser-automation-playbook', 'local-lead-hunting', 'exact-logo-brand-kit-workflow',
]) assert(ids.has(id), `missing required public skill: ${id}`);

// Personal / dev / retired skills must never ship.
for (const id of [
  'prometheus-x-growth-operator', 'ps-vita-vitashell-ftp-deploy', 'x-video-vertical-social-cut',
  'ai-surface-smoke-research', 'promsrc-pr-worktree', 'dev-debugging', 'tool-failure-audit',
  'subagent-system-prompt-design', 'codex-desktop-restart', 'hyperframes-media', 'website-to-hyperframes',
  'src-edit-proposal-rigor',
]) assert(!ids.has(id), `private, dev, or retired skill leaked: ${id}`);

// 3. Excluded resources are stripped and dropped from the shipped manifest.
for (const skill of source.filter((item) => item.visibility === 'public' && item.excludedResources.size)) {
  const manifestPath = path.join(root, skill.id, 'skill.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  assert(!('publicExcludeResources' in manifest), `${skill.id}: publicExcludeResources leaked into shipped manifest`);
  for (const rel of skill.excludedResources) {
    assert(!fs.existsSync(path.join(root, skill.id, rel)), `${skill.id}: excluded resource shipped: ${rel}`);
    const listed = (manifest.resources || []).some((resource) => resource?.path === rel);
    assert(!listed, `${skill.id}: shipped manifest still lists excluded resource ${rel}`);
  }
}
assert(!fs.existsSync(path.join(root, 'self-repair-protocol', 'references', 'dev-escalation.md')), 'self-repair dev reference leaked');
assert(!fs.existsSync(path.join(root, 'git-workflow', 'references', 'prometheus-public-release-pointer.md')), 'private release pointer leaked');

// 4. No owner-specific content and no pointers to skills that do not ship.
const leaks = [];
for (const id of shipped) {
  const dir = path.join(root, id);
  for (const hit of policy.scanSkillDirForLeaks(dir)) leaks.push(`${id}/${hit.file}:${hit.line} [${hit.pattern}]`);
  for (const hit of policy.scanSkillDirForHiddenSkillRefs(dir, hidden)) leaks.push(`${id}/${hit.file}:${hit.line} [non-public skill ${hit.skillId}]`);
}
assert.deepEqual(leaks, [], `owner-specific content in public skills:\n${leaks.join('\n')}`);

// 5. The policy itself catches what it claims to (guards against a regex regression).
const probe = fs.mkdtempSync(path.join(repo, 'generated', '.skill-policy-probe-'));
try {
  const lines = [
    'Ask Raul first.', 'Post as @raulinvests.', 'Xpose Market client.', 'C:\\Users\\rafel\\x',
    'route openai_codex/gpt-6-sol', 'see PromSRC', 'workspace/self/index.md', 'call prom_apply_dev_changes',
    'D:\\Prometheus\\workspace',
  ];
  fs.writeFileSync(path.join(probe, 'SKILL.md'), `${lines.join('\n')}\n`);
  const hits = policy.scanSkillDirForLeaks(probe);
  assert.equal(new Set(hits.map((hit) => hit.line)).size, lines.length, `policy missed probe lines: ${JSON.stringify(hits)}`);
  fs.writeFileSync(path.join(probe, 'SKILL.md'), 'Use C:\\Users\\<user>\\x or C:\\Users\\Test User\\y. Telegram is fine. Radar chart.\n');
  assert.deepEqual(policy.scanSkillDirForLeaks(probe), [], 'policy flags placeholders or generic terms');
} finally {
  fs.rmSync(probe, { recursive: true, force: true });
}

console.log(`Public skill bundle regression passed: ${shipped.length} public skills, ${hidden.size} personal/dev kept out, no owner-specific content.`);
