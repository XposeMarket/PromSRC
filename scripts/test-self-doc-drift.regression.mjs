import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const index = path.join(root, 'workspace', 'self', 'index.md');
const text = fs.readFileSync(index, 'utf8');
const links = [...text.matchAll(/\]\(([^)#?]+)(?:[#?][^)]*)?\)/g)].map((match) => match[1]);
assert.ok(links.length >= 1);
assert.deepEqual(links.filter((link) => !fs.existsSync(path.resolve(path.dirname(index), link))), []);
console.log('self-documentation drift regression passed');