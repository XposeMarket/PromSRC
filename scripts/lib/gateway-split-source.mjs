// Source-contract helpers for the split browser/desktop gateway layers.
// browser-tools.ts and desktop-tools.ts are facades that re-export the
// implementation modules under src/gateway/browser/ and src/gateway/desktop/.
// Contract scripts that grep source text must read the whole layer, not only
// the facade, so a behavior-preserving module split does not look like a removal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readLayer(facadeRel, dirRel) {
  const parts = [fs.readFileSync(path.join(repoRoot, facadeRel), 'utf8')];
  const dir = path.join(repoRoot, dirRel);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.regression.ts')).sort()) {
      parts.push(`\n// ---- ${dirRel}/${name}\n` + fs.readFileSync(path.join(dir, name), 'utf8'));
    }
  }
  return parts.join('\n');
}

export function readBrowserGatewaySource() {
  return readLayer('src/gateway/browser-tools.ts', 'src/gateway/browser');
}

export function readDesktopGatewaySource() {
  return readLayer('src/gateway/desktop-tools.ts', 'src/gateway/desktop');
}
