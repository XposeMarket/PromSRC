import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const indexPath = path.join(repoRoot, 'workspace', 'self', 'index.md');
const text = fs.readFileSync(indexPath, 'utf8');
const links = [...text.matchAll(/\]\(([^)#?]+)(?:[#?][^)]*)?\)/g)].map((match) => match[1]);
const missing = links.filter((link) => !fs.existsSync(path.resolve(path.dirname(indexPath), link)));
if (missing.length) {
  console.error(`self-documentation drift: ${missing.length} broken index link(s)`);
  for (const link of missing) console.error(`- ${link}`);
  process.exitCode = 1;
} else {
  console.log(`self-documentation drift check passed: ${links.length} index links resolve`);
}