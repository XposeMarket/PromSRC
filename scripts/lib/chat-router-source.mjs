// Source-contract tests historically read src/gateway/routes/chat.router.ts as text.
// The giant-file split moves that code into src/gateway/routes/chat/**, so contract
// tests read the router plus every module under routes/chat/ as one logical source.
// Keep in sync with src/testing/chat-router-source.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(entry.name) && !/\.(regression|test)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

export function chatRouterSourceFiles(root = repoRoot) {
  const routes = path.join(root, 'src', 'gateway', 'routes');
  return [path.join(routes, 'chat.router.ts'), ...walk(path.join(routes, 'chat'))];
}

export function readChatRouterSource(root = repoRoot) {
  return chatRouterSourceFiles(root).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}
