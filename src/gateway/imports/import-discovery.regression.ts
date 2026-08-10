import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { discoverImportSources } from './import-discovery';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-import-discovery-'));
const home = path.join(root, 'home');
const localAppData = path.join(root, 'local-app-data');
const appData = path.join(root, 'app-data');

function write(relativePath: string, value = '{}'): void {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
}

write('local-app-data/hermes/sessions/2026/session-1.jsonl', '{"role":"user","content":"hello"}\n');
write('local-app-data/hermes/config.yaml', 'model: safe\n');
write('home/.codex/sessions/2026/rollout-1.jsonl', '{"type":"event_msg"}\n');
write('home/.claude/projects/demo/session.jsonl', '{"type":"user"}\n');
write('home/.openclaw/plugins/installs.json', '{"plugins":[]}');
write('home/Downloads/conversations.json', '[]');
write('app-data/Cursor/User/History/ignored.txt', 'not a transcript');

const result = discoverImportSources({
  homeDir: home,
  localAppData,
  appData,
  now: () => new Date('2026-08-09T12:00:00.000Z'),
});

assert.equal(result.scannedAt, '2026-08-09T12:00:00.000Z');
assert.ok(result.sources.some((item) => item.id === 'hermes-conversations' && item.transcriptCount === 1));
assert.ok(result.sources.some((item) => item.id === 'hermes-setup' && item.setupFileCount >= 1));
assert.ok(result.sources.some((item) => item.id === 'codex-conversations' && item.adapter === 'codex-local'));
assert.ok(result.sources.some((item) => item.id === 'claude-code-conversations' && item.transcriptCount === 1));
assert.ok(result.sources.some((item) => item.id === 'chatgpt-export-SG9tZQ' || item.label === 'ChatGPT official export'));
assert.ok(result.sources.some((item) => item.id === 'openclaw-setup' && item.kind === 'setup'));
assert.ok(!result.sources.some((item) => item.id.startsWith('cursor-conversations-')));
const codexSource = result.sources.find((item) => item.id === 'codex-conversations');
assert.equal(codexSource?.batchable, true);
assert.equal(codexSource?.batches?.length, 1);
assert.equal(codexSource?.batches?.[0]?.sourceFiles.length, 1);

for (const item of result.sources) {
  assert.ok(path.isAbsolute(item.sourcePath));
  assert.equal(typeof item.previewable, 'boolean');
  assert.equal(typeof item.supportsProjects, 'boolean');
  assert.equal(typeof item.batchable, 'boolean');
  assert.ok(!('content' in item));
  assert.ok(!('secret' in item));
}

console.log(`import discovery regression: ok (${result.sources.length} bounded candidates)`);
