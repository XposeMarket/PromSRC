import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const skillIds = process.argv.slice(2);

if (!skillIds.length) {
  console.error('Usage: node scripts/preserve-skill-details.mjs <skill-id> [...]');
  process.exit(1);
}

function bodyWithoutFrontmatter(raw) {
  if (!raw.startsWith('---')) return raw.trim();
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return match ? raw.slice(match[0].length).trim() : raw.trim();
}

for (const skillId of skillIds) {
  const skillDir = path.resolve(skillsRoot, skillId);
  if (!skillDir.startsWith(`${skillsRoot}${path.sep}`)) {
    throw new Error(`Unsafe skill id: ${skillId}`);
  }

  const entrypoint = ['SKILL.md', 'skill.md']
    .map((name) => path.join(skillDir, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!entrypoint) throw new Error(`Missing entrypoint: ${skillId}`);

  const referencesDir = path.join(skillDir, 'references');
  const target = path.join(referencesDir, 'detailed-guide.md');
  if (fs.existsSync(target)) {
    console.log(`SKIP ${skillId}: references/detailed-guide.md already exists`);
    continue;
  }

  const body = bodyWithoutFrontmatter(fs.readFileSync(entrypoint, 'utf8'))
    .replace(/\]\(references\//g, '](')
    .replace(/\]\(examples\//g, '](../examples/')
    .replace(/\]\(resources\//g, '](../resources/')
    .replace(/\]\(notes\//g, '](../notes/');
  fs.mkdirSync(referencesDir, { recursive: true });
  fs.writeFileSync(
    target,
    `# Detailed guide\n\nThis reference preserves the full operating detail that was moved out of the concise skill entrypoint during the catalog migration. Read only the sections needed for the current task.\n\n${body}\n`,
    'utf8',
  );
  console.log(`PRESERVED ${skillId}: ${path.relative(repoRoot, target)}`);
}
