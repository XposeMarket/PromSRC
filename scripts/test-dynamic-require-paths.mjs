// Guard: every relative require('...') / import('...') in src/ must resolve to a real file.
// tsc does not type-check the specifier of a lazy require(), so a file move (e.g. #655's
// chat pipeline split) can silently break runtime paths. That is how compaction broke:
// require('../context/model-context') from routes/chat/pipeline threw "Cannot find module"
// on every compaction attempt, and agents kept re-triggering compaction.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const exts = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '/index.ts', '/index.js'];

// Known-missing optional modules: the call sites are inside try/catch and degrade on purpose.
// Keep this list short; prefer fixing the path.
const ALLOWED_MISSING = new Set([
  'src/gateway/agents-runtime/handlers/agents.ts ./../../teams/team-round-runner',
]);

const bad = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'generated'].includes(entry.name)) walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const re = /(?:require|import)\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
    let match;
    while ((match = re.exec(text))) {
      const spec = match[1];
      const base = path.resolve(path.dirname(full), spec.replace(/\.js$/, ''));
      const ok = exts.some((ext) => fs.existsSync(base + ext) && fs.statSync(base + ext).isFile());
      if (ok) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (ALLOWED_MISSING.has(`${rel} ${spec}`)) continue;
      // Skip specifiers that only appear inside comments.
      const lineStart = text.lastIndexOf('\n', match.index) + 1;
      const linePrefix = text.slice(lineStart, match.index).trim();
      if (linePrefix.startsWith('//') || linePrefix.startsWith('*')) continue;
      const line = text.slice(0, match.index).split('\n').length;
      bad.push(`${rel}:${line}  ${spec}`);
    }
  }
}
walk(src);

if (bad.length) {
  console.error(`Unresolvable relative require()/import() paths (${bad.length}):\n- ${bad.join('\n- ')}`);
  process.exit(1);
}
console.log('dynamic require paths: all resolve');
