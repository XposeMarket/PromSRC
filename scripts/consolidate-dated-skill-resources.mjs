import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const apply = process.argv.includes('--apply');
const skipArg = process.argv.find((arg) => arg.startsWith('--skip='));
const skipped = new Set((skipArg?.slice('--skip='.length) || '').split(',').filter(Boolean));
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = new Set((onlyArg?.slice('--only='.length) || '').split(',').filter(Boolean));
const datePattern = /(?:^|[-_])((?:19|20)\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])(?=[-_.]|$)/i;

// Final catalog closeout mappings. These collapse equivalent lessons into one
// stable reference instead of merely stripping dates into several near-duplicates.
const exactDestinations = new Map([
  ['dev-debugging:examples/mobile-new-chat-bug-handoff-2026-05-27.md', 'examples/mobile-new-chat-bug-handoff.md'],
  ['dev-debugging:notes/composite-codex-handoff-recovery-2026-05-27.md', 'references/handoff-recovery.md'],
  ['dev-debugging:notes/current-chat-creative-export-handoff-2026-05-20.md', 'references/handoff-recovery.md'],
  ['dev-debugging:notes/desktop-tool-availability-and-typing-recovery-2026-05-23.md', 'references/handoff-recovery.md'],
  ['dev-debugging:notes/existing-chat-fetch-failure-recovery-2026-05-12.md', 'references/handoff-recovery.md'],
  ['dev-debugging:notes/powershell-typing-failure-recovery-2026-05-16.md', 'references/handoff-recovery.md'],
  ['dev-debugging:notes/recovery-permission-click-and-raw-tool-reporting-2026-05-30.md', 'references/handoff-recovery.md'],
  ['dev-debugging:templates/stuck-approved-proposal-handoff-2026-05-09.md', 'templates/stuck-approved-proposal-handoff.md'],
  ['git-workflow:notes/github-cli-full-access-setup-2026-05-16.md', 'references/github-authentication.md'],
  ['hyperframes-catalog-assets:resources/compatibility-notes-2026-05-09.md', 'resources/compatibility.md'],
  ['hyperframes-cli:references/known-issues/exported-mp4-playback-freeze-2026-05-29.md', 'references/qa-and-export-verification.md'],
  ['hyperframes-cli:references/required-agent-qa-loop-2026-06-04.md', 'references/qa-and-export-verification.md'],
  ['hyperframes-cli:references/strict-hyperframes-project-flow-2026-05-24.md', 'references/qa-and-export-verification.md'],
  ['hyperframes-cli:references/windows-install-troubleshooting-2026-05-24.md', 'references/windows-runtime.md'],
]);

// Duplicates or deprecated-source lessons already merged into the listed
// canonical target. Removal remains evidence-bearing in the Brain store.
const removeInto = new Map([
  ['dev-debugging:references/workflows/dev-debugging-2026-06-13.md', 'SKILL.md'],
  ['dev-debugging:references/workflows/dev-debugging-2026-07-07.md', 'SKILL.md'],
  ['voice-browser-desktop-smoke-test:examples/2026-05-21-mobile-screenshot-updates.md', '../ai-surface-smoke-research/references/examples/wedged-chrome-and-mobile-screenshot-delivery.md'],
  ['voice-browser-desktop-smoke-test:examples/2026-05-21-stop-steer-guardrail.md', '../ai-surface-smoke-research/references/examples/interrupted-browser-target-closed.md'],
  ['voice-browser-desktop-smoke-test:references/styles/voice-browser-desktop-smoke-test-2026-07-04.md', '../ai-surface-smoke-research/references/styles/ai-surface-smoke-research.md'],
  ['voice-browser-desktop-smoke-test:references/workflows/voice-browser-desktop-smoke-test-2026-07-07.md', '../ai-surface-smoke-research/references/workflows/ai-surface-smoke-research.md'],
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.history') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function stripDate(baseName) {
  return baseName
    .replace(datePattern, '')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '') || 'legacy-lesson';
}

function destination(skillId, source, skillDir) {
  const rel = path.relative(skillDir, source).replace(/\\/g, '/');
  const exact = exactDestinations.get(`${skillId}:${rel}`);
  if (exact) return exact;
  const parsed = path.parse(rel);
  const stableBase = stripDate(parsed.name);
  if (/^references\/workflows\//i.test(rel)) return `references/workflows/${skillId}${parsed.ext}`;
  if (/^references\/styles\//i.test(rel)) return `references/styles/${skillId}${parsed.ext}`;
  if (/^references\/recovery\//i.test(rel)) {
    if (skillId === 'file-surgery' && /(find-replace|apply-.*patchset|text-not-found|error-text-not-found)/i.test(parsed.name)) {
      return 'references/recovery/text-match-failures.md';
    }
    return `references/recovery/${stableBase}${parsed.ext}`;
  }
  if (/^examples\//i.test(rel)) return `references/examples/${stableBase}${parsed.ext}`;
  if (/^notes\//i.test(rel)) return `references/background/${stableBase}${parsed.ext}`;
  if (/^resources\//i.test(rel) && /\.md$/i.test(rel)) return `references/background/${stableBase}${parsed.ext}`;
  return `${parsed.dir ? `${parsed.dir}/` : ''}${stableBase}${parsed.ext}`;
}

function mergeMarkdown(existing, incoming, sourceRel) {
  const normalizedExisting = existing.replace(/\s+/g, ' ').trim();
  const normalizedIncoming = incoming.replace(/\s+/g, ' ').trim();
  if (!normalizedIncoming || normalizedExisting.includes(normalizedIncoming)) return existing;
  if (!existing.trim()) return `${incoming.trim()}\n`;
  const heading = path.basename(sourceRel, path.extname(sourceRel)).replace(/[-_]+/g, ' ');
  return `${existing.trim()}\n\n---\n\n## ${heading}\n\n${incoming.trim()}\n`;
}

function replaceResourcePaths(skillDir, replacements) {
  for (const file of walk(skillDir)) {
    if (!/\.(md|json|ya?ml|txt)$/i.test(file) || replacements.has(path.relative(skillDir, file).replace(/\\/g, '/'))) continue;
    let raw = fs.readFileSync(file, 'utf8');
    let next = raw;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    if (next !== raw) fs.writeFileSync(file, next, 'utf8');
  }
}

const operations = [];
for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_') || skipped.has(entry.name) || (only.size && !only.has(entry.name))) continue;
  const skillDir = path.join(skillsRoot, entry.name);
  for (const file of walk(skillDir)) {
    if (!datePattern.test(path.basename(file))) continue;
    const sourceRel = path.relative(skillDir, file).replace(/\\/g, '/');
    const key = `${entry.name}:${sourceRel}`;
    const evidenceTarget = removeInto.get(key);
    const targetRel = evidenceTarget ? null : destination(entry.name, file, skillDir);
    if (sourceRel === targetRel) continue;
    const date = path.basename(file).match(datePattern)?.slice(1, 4).join('-') || null;
    operations.push({ skillId: entry.name, skillDir, source: file, sourceRel, targetRel, evidenceTarget, drop: !!evidenceTarget, date });
  }
}

for (const op of operations) console.log(`${apply ? 'APPLY' : 'PLAN'} ${op.skillId}: ${op.sourceRel} -> ${op.targetRel || `REMOVE (merged into ${op.evidenceTarget})`}`);
if (!apply) {
  console.log(`Planned ${operations.length} dated resource migrations; skipped ${skipped.size} failed skill(s).`);
  process.exit(0);
}

const evidence = [];
const grouped = new Map();
for (const item of operations) {
  const rows = grouped.get(item.skillId) || [];
  rows.push(item);
  grouped.set(item.skillId, rows);
}
for (const [skillId, skillOps] of grouped) {
  const replacements = new Map();
  for (const op of skillOps) {
    const content = fs.readFileSync(op.source, 'utf8');
    if (op.drop) {
      fs.rmSync(op.source);
      replacements.set(op.sourceRel, '');
      evidence.push({
        type: 'skill_catalog_resource_migration',
        skillId,
        sourcePath: op.sourceRel,
        sourceDate: op.date,
        targetPath: op.evidenceTarget,
        disposition: 'merged_or_duplicate_removed',
        confidence: 'reviewed-migration',
        contentSha256: crypto.createHash('sha256').update(content).digest('hex'),
        migratedAt: new Date().toISOString(),
      });
      continue;
    }
    const target = path.resolve(op.skillDir, op.targetRel);
    if (!target.startsWith(`${op.skillDir}${path.sep}`)) throw new Error(`Unsafe target: ${op.targetRel}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    fs.writeFileSync(target, /\.md$/i.test(target) ? mergeMarkdown(existing, content, op.sourceRel) : content, 'utf8');
    fs.rmSync(op.source);
    replacements.set(op.sourceRel, op.targetRel);
    evidence.push({
      type: 'skill_catalog_resource_migration',
      skillId,
      sourcePath: op.sourceRel,
      sourceDate: op.date,
      targetPath: op.targetRel,
      confidence: 'reviewed-migration',
      contentSha256: crypto.createHash('sha256').update(content).digest('hex'),
      migratedAt: new Date().toISOString(),
    });
  }
  replaceResourcePaths(skillOps[0].skillDir, replacements);
}

const evidencePath = path.join(repoRoot, 'workspace', 'Brain', 'skill-curator', 'catalog-migration-evidence.jsonl');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.appendFileSync(evidencePath, evidence.map((row) => JSON.stringify(row)).join('\n') + (evidence.length ? '\n' : ''), 'utf8');
console.log(`Migrated ${operations.length} dated resources; evidence: ${path.relative(repoRoot, evidencePath)}`);
