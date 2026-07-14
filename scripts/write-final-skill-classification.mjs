import fs from 'node:fs';
import path from 'node:path';

const { SkillsManager } = await import('../dist/gateway/skills-runtime/skills-manager.js');

const repoRoot = path.resolve(import.meta.dirname, '..');
const manager = new SkillsManager(path.join(repoRoot, 'workspace', 'skills'));

const narrowed = new Set([
  'api-integration', 'browser-automation-playbook', 'chart-visualizer', 'cold-outreach-writer',
  'competitive-intelligence', 'connector-builder', 'data-pipeline', 'deal-analyzer',
  'desktop-automation-playbook', 'dev-debugging', 'email-composer', 'embedding-search',
  'error-budget-tracker', 'exact-logo-brand-kit-workflow', 'file-surgery', 'financial-analyst',
  'financial-model', 'frontend-quality-guard', 'ghostwriter', 'git-workflow', 'gsap',
  'hr-recruiter', 'integration-setup', 'landing-page-blueprint', 'legal-drafting',
  'local-file-browser-verification', 'local-lead-hunting', 'market-research',
  'marketing-campaign-builder', 'memory-governance-playbook', 'operations-manager',
  'pitch-deck-builder', 'professional-blog-posting-engine', 'prometheus-ash-archive-style',
  'report-generator', 'revenue-manager', 'scheduler-operations-playbook', 'sdr-sales',
  'secret-and-token-ops', 'skill-creator', 'social-intel', 'src-edit-proposal-rigor',
  'tailwind', 'twitter-thread', 'typegpu', 'web-design-skill', 'web-researcher',
  'web-scraper', 'windows-shell-playbook', 'x-browser-automation-playbook',
]);

const split = new Set(['execution-mode-routing', 'task-lifecycle']);
const mergedTargets = new Set([
  'ai-surface-smoke-research', 'connector-builder', 'docx', 'file-surgery',
  'interactive-artifacts', 'knowledge-import-pipeline', 'media-use', 'pdf',
  'prometheus-x-growth-operator', 'spreadsheets', 'website-to-video',
]);

function disposition(skill) {
  if (skill.lifecycle === 'archived') return 'archived';
  if (skill.lifecycle === 'deprecated') return 'deprecated';
  if (split.has(skill.id)) return 'split';
  if (mergedTargets.has(skill.id)) return 'merge';
  if (narrowed.has(skill.id)) return 'narrow';
  return 'keep';
}

const skills = manager.getAll().map((skill) => ({
  id: skill.id,
  migrationDisposition: disposition(skill),
  explicitOnly: !skill.implicitInvocation,
  lifecycle: skill.lifecycle,
  ownership: skill.ownership,
  health: skill.health.state,
  eligibility: skill.eligibility.status,
  triggerCount: skill.triggers.length,
}));

const counts = {
  total: skills.length,
  dispositions: Object.fromEntries([...new Set(skills.map((skill) => skill.migrationDisposition))]
    .sort()
    .map((name) => [name, skills.filter((skill) => skill.migrationDisposition === name).length])),
  explicitOnly: skills.filter((skill) => skill.explicitOnly).length,
  implicitEligible: skills.filter((skill) => !skill.explicitOnly && skill.lifecycle === 'active').length,
  healthReady: skills.filter((skill) => skill.health === 'ready').length,
  eligibilityReady: skills.filter((skill) => skill.eligibility === 'ready').length,
};

const output = {
  schemaVersion: 'prometheus-skill-catalog-classification-v1',
  generatedAt: new Date().toISOString(),
  counts,
  removed: [
    { id: 'xpose-lead-outreach-packet', reason: 'User-requested removal; missing-input workflow retired.' },
    { id: 'hyperframes-media', reason: 'Merged into official media-use.' },
    { id: 'website-to-hyperframes', reason: 'Replaced by official website-to-video and product-launch-video routing.' },
  ],
  renamed: [
    { from: 'codex-desktop-restart', to: 'chatgpt-desktop-restart' },
    { from: 'codex-frontend-engineer', to: 'frontend-quality-guard' },
  ],
  skills,
};

const target = path.join(repoRoot, 'docs', 'SKILL_CATALOG_FINAL_CLASSIFICATION_2026-07-12.json');
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(repoRoot, target)} with ${skills.length} classified skills.`);
