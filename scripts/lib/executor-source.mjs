// Source-text contract tests read the tool executor. Handler families are being
// moved out of subagent-executor.ts into agents-runtime/handlers/*.ts, so read
// the executor together with every handler module.
import fs from 'node:fs';
import path from 'node:path';

export function readExecutorSource(root) {
  const runtime = path.join(root, 'src', 'gateway', 'agents-runtime');
  const parts = [fs.readFileSync(path.join(runtime, 'subagent-executor.ts'), 'utf8')];
  const handlers = path.join(runtime, 'handlers');
  if (fs.existsSync(handlers)) {
    for (const file of fs.readdirSync(handlers).sort()) {
      if (file.endsWith('.ts') && !file.endsWith('.regression.ts')) parts.push(fs.readFileSync(path.join(handlers, file), 'utf8'));
    }
  }
  return parts.join('\n');
}
