import { spawnSync } from 'node:child_process';
const commands = [
  ['chat-model-route', 'src/gateway/chat/chat-model-route.regression.ts'],
  ['thread-ops-model-route', 'src/gateway/threads/thread-ops-model-route.regression.ts'],
  ['model-routing', 'src/agents/model-routing.regression.ts'],
];
for (const [label, file] of commands) {
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', file], { stdio: 'inherit', shell: false });
  if (result.status !== 0) { console.error(`model acceptance failed: ${label}`); process.exit(result.status ?? 1); }
}
console.log(`model acceptance suite passed: ${commands.length} deterministic route contracts`);