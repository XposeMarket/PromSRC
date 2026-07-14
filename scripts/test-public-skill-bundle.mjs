import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'generated', 'bundled-skills');
const ids = new Set(fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name));
assert.equal(ids.size, 137, 'unexpected public skill count');

for (const id of [
  'self-repair-protocol', 'chatgpt-desktop-restart', 'prometheus-ash-archive-style',
  'webhook-receiver-framework', 'pptx-writer', 'hyperframes', 'hyperframes-cli',
  'media-use', 'website-to-video', 'git-workflow', 'scheduler-operations-playbook',
]) assert(ids.has(id), `missing required public skill: ${id}`);

for (const id of [
  'codex-desktop-restart', 'hyperframes-media', 'website-to-hyperframes',
  'src-edit-proposal-rigor', 'dev-debugging', 'subagent-system-prompt-design',
]) assert(!ids.has(id), `private, retired, or renamed skill leaked: ${id}`);

assert(!fs.existsSync(path.join(root, 'self-repair-protocol', 'references', 'dev-escalation.md')), 'self-repair dev reference leaked');
assert(!fs.existsSync(path.join(root, 'git-workflow', 'references', 'prometheus-public-release-pointer.md')), 'private release pointer leaked');

const privatePatterns = [
  /\bRaul\b/i, /\bXpose Market\b/i, /\bFrederick Roof Repair\b/i, /\bTelegram\b/i,
  /D:\\Prometheus/i, /C:\\Users\\rafel/i, /\bPromSRC\b/i, /\bworkspace\/self\b/i,
  /\bread_dev_sources\b/i, /\bapply_dev_source_patchset\b/i, /\brequest_dev_source_edit\b/i,
  /\bupdate_dev_source_edit\b/i, /\bawait_dev_source_edit_approval\b/i,
  /\bprom_apply_dev_changes\b/i, /\bsrc_edit\b/i,
];
const textExtensions = /\.(?:md|markdown|txt|json|jsonl|ya?ml|js|mjs|ts|tsx|py|ps1|sh)$/i;

function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

const leaks = walk(root)
  .filter((file) => textExtensions.test(file))
  .filter((file) => privatePatterns.some((pattern) => pattern.test(fs.readFileSync(file, 'utf8'))))
  .map((file) => path.relative(root, file).replace(/\\/g, '/'));
assert.deepEqual(leaks, [], `private content leaked into public skills: ${leaks.join(', ')}`);

console.log(`Public skill bundle regression passed: ${ids.size} skills, required present, private/dev/retired absent.`);
