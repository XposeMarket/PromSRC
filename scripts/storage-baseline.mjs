#!/usr/bin/env node
import fs from 'node:fs/promises';
import { scanStorage, compareStorage } from './lib/storage-baseline.mjs';

async function readReport(filename) {
  let handle;
  try {
    handle = await fs.open(filename, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 65536) throw new Error();
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw new Error();
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } catch { throw new Error('Invalid or oversized report file'); }
  finally { await handle?.close(); }
}
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Read-only metadata: --root <directory> [--max-entries 1..1000000] [--max-depth 1..64]\nCompare saved reports: --before <json> --after <json>\nJSON goes to stdout. No files are deleted or written. Sizes are apparent, not allocated. Incomplete scans are provisional.');
  } else {
    const opts = {};
    const allowed = new Set(['--root', '--max-entries', '--max-depth', '--before', '--after']);
    for (let i = 0; i < args.length; i += 2) {
      if (!allowed.has(args[i]) || opts[args[i]] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid arguments');
      opts[args[i]] = args[i + 1];
    }
    let result;
    if (opts['--before'] || opts['--after']) {
      if (!opts['--before'] || !opts['--after'] || Object.keys(opts).length !== 2) throw new Error('Comparison requires only --before and --after');
      result = compareStorage(await readReport(opts['--before']), await readReport(opts['--after']));
    } else {
      result = await scanStorage(opts['--root'], { maxEntries: opts['--max-entries'], maxDepth: opts['--max-depth'] });
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  // Library and parsing messages are fixed, never raw filesystem errors/paths.
  console.error(error.message);
  process.exitCode = 1;
}
