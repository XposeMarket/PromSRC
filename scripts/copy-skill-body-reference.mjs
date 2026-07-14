import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const [sourceId, targetId, relativeTarget] = process.argv.slice(2);

if (!sourceId || !targetId || !relativeTarget) {
  console.error('Usage: node scripts/copy-skill-body-reference.mjs <source-id> <target-id> <references/file.md>');
  process.exit(1);
}

function confinedSkillDir(skillId) {
  const value = path.resolve(skillsRoot, skillId);
  if (!value.startsWith(`${skillsRoot}${path.sep}`)) throw new Error(`Unsafe skill id: ${skillId}`);
  return value;
}

function bodyWithoutFrontmatter(raw) {
  if (!raw.startsWith('---')) return raw.trim();
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return match ? raw.slice(match[0].length).trim() : raw.trim();
}

const sourceDir = confinedSkillDir(sourceId);
const targetDir = confinedSkillDir(targetId);
const source = ['SKILL.md', 'skill.md'].map((name) => path.join(sourceDir, name)).find(fs.existsSync);
if (!source) throw new Error(`Missing source entrypoint: ${sourceId}`);

const target = path.resolve(targetDir, relativeTarget);
if (!target.startsWith(`${targetDir}${path.sep}`)) throw new Error(`Unsafe target: ${relativeTarget}`);
if (fs.existsSync(target)) throw new Error(`Target already exists: ${target}`);

const body = bodyWithoutFrontmatter(fs.readFileSync(source, 'utf8'));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(
  target,
  `# Migrated ${sourceId} guidance\n\nThis reference preserves detailed guidance from the former \`${sourceId}\` entrypoint. Read it only for the matching operation.\n\n${body}\n`,
  'utf8',
);
console.log(`COPIED ${sourceId} -> ${targetId}/${relativeTarget}`);
