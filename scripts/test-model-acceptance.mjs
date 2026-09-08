import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-acceptance-'));

const commands = [
  ['chat-model-route', 'src/gateway/chat/chat-model-route.regression.ts'],
  ['thread-handoff', 'src/gateway/threads/thread-handoff.regression.ts'],
  ['thread-ops-model-route', 'src/gateway/threads/thread-ops-model-route.regression.ts'],
  ['model-routing', 'src/agents/model-routing.regression.ts'],
  ['operating-instructions', 'src/runtime/operating-instructions.regression.ts'],
  ['tool-behavior', 'src/gateway/tool-behavior.regression.ts'],
];

for (const [label, file] of commands) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', file],
    { stdio: 'inherit', shell: false, cwd: root, timeout: 60_000,
      env: { ...process.env, PROMETHEUS_DATA_DIR: fixtureRoot, PROMETHEUS_APP_DATA_DIR: fixtureRoot, PROMETHEUS_RUNTIME_DIR: path.join(fixtureRoot, 'runtime'), PROMETHEUS_WORKSPACE_DIR: path.join(fixtureRoot, 'workspace') } },
  );

  if (result.status !== 0) {
    console.error(`model acceptance failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`runtime acceptance suite passed: ${commands.length} deterministic routing and behavior contracts; no live model was evaluated`);
