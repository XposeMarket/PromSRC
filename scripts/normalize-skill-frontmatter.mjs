import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const skip = new Set(process.argv.slice(2));

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_') || skip.has(entry.name)) continue;
  const skillDir = path.join(skillsRoot, entry.name);
  const entrypoint = ['SKILL.md', 'skill.md'].map((name) => path.join(skillDir, name)).find(fs.existsSync);
  if (!entrypoint) continue;
  const raw = fs.readFileSync(entrypoint, 'utf8');
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  let parsed = {};
  if (block) {
    try { parsed = yaml.load(block[1]) || {}; } catch { parsed = {}; }
  }
  const native = readJson(path.join(skillDir, 'skill.json'));
  const overlay = readJson(path.join(skillsRoot, '.manifests', `${entry.name}.skill.json`));
  const fallbackDescription = block?.[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
  const name = entry.name;
  const description = String(parsed.description || overlay.description || native.description || fallbackDescription).replace(/\s+/g, ' ').trim();
  if (!description) {
    console.log(`SKIP ${entry.name}: no recoverable description`);
    continue;
  }
  const body = block ? raw.slice(block[0].length).trimStart() : raw.trimStart();
  const normalized = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`;
  const finalized = `${normalized.trimEnd()}\n`;
  if (finalized.replace(/\r\n/g, '\n') === raw.replace(/\r\n/g, '\n')) continue;
  fs.writeFileSync(entrypoint, finalized, 'utf8');
  console.log(`NORMALIZED ${entry.name}`);
}
