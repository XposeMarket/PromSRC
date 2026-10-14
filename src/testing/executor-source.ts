/** Joined source for contracts spanning the mechanically extracted executor. */
import fs from 'node:fs';
import path from 'node:path';
export function readExecutorSource(root: string = process.cwd()): string {
  const runtime = path.join(root, 'src', 'gateway', 'agents-runtime');
  const parts = [fs.readFileSync(path.join(runtime, 'subagent-executor.ts'), 'utf8')];
  for (const file of ['workspace-helpers.ts', 'wrapper-normalizers.ts', 'executor-helpers.ts']) {
    const helper = path.join(runtime, file);
    if (fs.existsSync(helper)) parts.push(fs.readFileSync(helper, 'utf8'));
  }
  const handlers = path.join(runtime, 'handlers');
  if (fs.existsSync(handlers)) for (const file of fs.readdirSync(handlers).sort()) {
    if (file.endsWith('.ts') && !file.endsWith('.regression.ts')) parts.push(fs.readFileSync(path.join(handlers, file), 'utf8'));
  }
  return parts.join('\n');
}
