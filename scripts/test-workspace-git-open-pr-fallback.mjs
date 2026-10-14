import assert from 'node:assert/strict';
import { readExecutorSource } from './lib/executor-source.mjs';

const source = readExecutorSource(process.cwd());
const start = source.lastIndexOf("case 'open_pr':");
const end = source.indexOf("case 'run_tests':", start);
assert.ok(start >= 0 && end > start, 'open_pr implementation must exist');
const block = source.slice(start, end);
assert.match(block, /gh pr create/);
assert.match(block, /GitHub CLI is unavailable/);
assert.match(block, /connector_github_create_pr/);
assert.match(block, /not recognized\|command not found\|not found/);
console.log('workspace git open-pr fallback regression: ok');
