// Static smoke test for the video-project card (no DOM needed).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'web-ui/src/components/video-project-card.js',
  'web-ui/src/components/video-project-card/v2.js',
];
for (const f of files) execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'inherit' });
const src = files.map((f) => readFileSync(path.join(root, f), 'utf8')).join('\n');
const needles = ['import_asset', "'storyboard'", 'shot.approveStoryboard', "'voiceover'", "'captions'", "'music'", "'qa'", "'run'", 'render_variants', 'poster'];
const missing = needles.filter((n) => !src.includes(n));
if (missing.length) { console.error('Missing handlers:', missing.join(', ')); process.exit(1); }
console.log(`ok: ${files.length} files parse, ${needles.length} handlers present`);
