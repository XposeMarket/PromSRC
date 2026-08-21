import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const apply = process.argv.includes('--apply');

const targetSkills = new Set([
  'approval-policy-designer',
  'browse-sh-web-skills',
  'browser-automation-playbook',
  'competitive-intelligence',
  'day-trading-mnq-mgc',
  'desktop-automation-playbook',
  'docx',
  'error-budget-tracker',
  'exact-logo-brand-kit-workflow',
  'integration-setup',
  'knowledge-import-pipeline',
  'local-file-browser-verification',
  'local-lead-hunting',
  'pdf',
  'polymarket-research',
  'pptx-writer',
  'product-carousel-builder',
  'prometheus-x-growth-operator',
  'report-generator',
  'scheduler-operations-playbook',
  'secret-and-token-ops',
  'spreadsheets',
  'task-lifecycle',
  'web-researcher',
  'x-browser-automation-playbook',
]);

const textExtensions = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.js', '.mjs', '.ts', '.tsx', '.py', '.ps1', '.sh',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const replacements = [
  [/[A-Za-z]:\\Users\\[^\\/\r\n]+/gi, '<user-home>'],
  [/\/Users\/[^/\s]+/g, '<user-home>'],
  [/\/home\/[^/\s]+/g, '<user-home>'],
  [/[A-Za-z]:\\Prometheus/gi, '<prometheus-workspace>'],
  [/\/[A-Za-z]\/Prometheus/gi, '<prometheus-workspace>'],
];

const privateMarkers = (process.env.PROM_REPO_PRIVATE_MARKERS || '')
  .split(/[,\n]/)
  .map((value) => value.trim())
  .filter(Boolean);
for (const marker of privateMarkers) {
  replacements.push([new RegExp(escapeRegExp(marker), 'gi'), '<private-marker>']);
}

function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.history') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) output.push(full);
  }
  return output;
}

const changed = [];
for (const skillId of targetSkills) {
  const skillDir = path.join(skillsRoot, skillId);
  if (!fs.existsSync(skillDir)) throw new Error(`Missing target skill: ${skillId}`);
  for (const file of walk(skillDir)) {
    const original = fs.readFileSync(file, 'utf8');
    let next = original;
    for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
    if (next === original) continue;
    changed.push(path.relative(repoRoot, file).replace(/\\/g, '/'));
    if (apply) fs.writeFileSync(file, next, 'utf8');
  }
}

console.log(`${apply ? 'REDACTED' : 'WOULD_REDACT'} ${changed.length} files`);
for (const file of changed) console.log(file);

if (apply && changed.length) {
  const evidencePath = path.join(repoRoot, 'workspace', 'Brain', 'skill-curator', 'catalog-migration-evidence.jsonl');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.appendFileSync(evidencePath, `${JSON.stringify({
    type: 'catalog_private_metadata_redaction',
    migratedAt: new Date().toISOString(),
    source: 'final_catalog_closeout',
    confidence: 1,
    files: changed,
    disposition: 'Canonical skill guidance generalized; inactive history snapshots preserved.',
  })}\n`, 'utf8');
}
