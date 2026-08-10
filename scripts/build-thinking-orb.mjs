import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'web-ui', 'src', 'components', 'thinking-orb-entry.jsx');
const output = path.join(root, 'web-ui', 'src', 'vendor', 'thinking-orb.js');

await mkdir(path.dirname(output), { recursive: true });
await build({
  entryPoints: [entry],
  outfile: output,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

console.log(`Built ${path.relative(root, output)}`);

