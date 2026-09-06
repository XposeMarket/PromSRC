import path from 'node:path';
import { maintainSqliteMemoryIndex } from '../dist/gateway/memory-index/sqlite-store.js';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const workspace = readArg('--workspace');
const backupDir = readArg('--backup-dir');
const vacuum = !process.argv.includes('--no-vacuum');
const confirmed = process.argv.includes('--yes');

if (!workspace || !confirmed) {
  console.error('Usage: npm run maintenance:memory-index -- --workspace <path> --yes [--backup-dir <path>] [--no-vacuum]');
  console.error('The --yes flag confirms that the gateway/index writer is quiesced.');
  process.exit(2);
}

const result = maintainSqliteMemoryIndex(path.resolve(workspace), {
  backupDir: backupDir ? path.resolve(backupDir) : undefined,
  vacuum,
  quiesced: true,
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
