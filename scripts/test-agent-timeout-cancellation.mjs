import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src', 'agents', 'spawner.ts'), 'utf8');

assert.match(source, /function guardTimedAgentClient\(/);
assert.match(source, /'chatWithThinking', 'generateWithRetryThinking'/);
assert.match(source, /if \(isTimedOut\(\)\) throw timeoutError;/);
assert.match(source, /timedOut = true;\s*reject\(timeoutError\);/s);
assert.match(source, /if \(timeoutHandle\) clearTimeout\(timeoutHandle\);/);
assert.doesNotMatch(source, /setTimeout\(\s*\(\) => reject\(new Error\(`Sub-agent timeout/);

console.log('Sub-agent timeout cancellation contract passed.');
