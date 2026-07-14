import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const [lifecycle, ...skillIds] = process.argv.slice(2);
if (!['deprecated', 'archived'].includes(lifecycle) || !skillIds.length) {
  console.error('Usage: node scripts/set-skill-lifecycle.mjs <deprecated|archived> <skill-id> [...]');
  process.exit(1);
}

function readFrontmatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? yaml.load(match[1]) || {} : {};
}

for (const skillId of skillIds) {
  const skillDir = path.resolve(skillsRoot, skillId);
  if (!skillDir.startsWith(`${skillsRoot}${path.sep}`)) throw new Error(`Unsafe skill id: ${skillId}`);
  const entrypoint = ['SKILL.md', 'skill.md'].map((name) => path.join(skillDir, name)).find(fs.existsSync);
  if (!entrypoint) throw new Error(`Missing entrypoint: ${skillId}`);
  const fm = readFrontmatter(entrypoint);
  const paths = [
    path.join(skillDir, 'skill.json'),
    path.join(skillsRoot, '.manifests', `${skillId}.skill.json`),
  ];
  let updated = 0;
  for (const manifestPath of paths) {
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.id = skillId;
    manifest.entrypoint = path.basename(entrypoint);
    if (fm.description) manifest.description = String(fm.description);
    manifest.triggers = [];
    manifest.implicitInvocation = false;
    manifest.lifecycle = lifecycle;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    updated += 1;
  }
  if (!updated) {
    const overlayPath = paths[1];
    fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
    fs.writeFileSync(overlayPath, `${JSON.stringify({
      schemaVersion: 'prometheus-skill-bundle-v1',
      id: skillId,
      entrypoint: path.basename(entrypoint),
      description: String(fm.description || ''),
      triggers: [],
      implicitInvocation: false,
      lifecycle,
    }, null, 2)}\n`, 'utf8');
    updated = 1;
  }
  console.log(`${lifecycle.toUpperCase()} ${skillId}: ${updated} manifest(s)`);
}
