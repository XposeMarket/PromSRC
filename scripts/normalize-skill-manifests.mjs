import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { validateSkillTriggers } from '../dist/gateway/skills-runtime/skill-package.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(repoRoot, 'workspace', 'skills');
const skip = new Set(process.argv.slice(2));
const explicitOnly = new Set([
  'ai-surface-smoke-research', 'animejs',
  'brand-strategist', 'browse-sh-web-skills', 'context-pack-builder', 'css-animations',
  'chatgpt-desktop-restart', 'contribute-catalog', 'day-trading-mnq-mgc', 'dev-debugging',
  'file-surgery', 'financial-analyst', 'gsap', 'hook-library', 'hr-recruiter',
  'hyperframes-catalog-assets', 'hyperframes-cli', 'hyperframes-registry',
  'json-and-config-surgery', 'local-media-utilities', 'lottie',
  'mermaid-diagrams', 'operations-manager', 'polymarket-research', 'product-discovery',
  'prometheus-ash-archive-style', 'prometheus-hyperframes-bridge',
  'prometheus-x-growth-operator', 'revenue-manager', 'self-repair-protocol',
  'skill-creator', 'social-intel', 'src-edit-proposal-rigor', 'subagent-system-prompt-design',
  'svg-diagrams', 'tailwind', 'three', 'threejs-mobile-webgl', 'twitter-thread',
  'typegpu', 'voice-browser-desktop-smoke-test', 'waapi', 'windows-shell-playbook',
]);
const triggerOverrides = {
  'api-integration': ['call a REST API', 'integrate an external API', 'debug an API request', 'implement API authentication', 'handle API pagination', 'test an API endpoint'],
  'legal-drafting': ['draft an NDA', 'review a service agreement', 'revise a contract clause', 'explain this legal document', 'negotiate agreement terms', 'write a privacy policy'],
  'revenue-manager': ['design a pricing strategy', 'optimize product pricing', 'build packaging tiers', 'analyze discount policy', 'model revenue optimization', 'test willingness to pay'],
  'subagent-system-prompt-design': ['design a subagent system prompt', 'review an agent role prompt', 'define a subagent tool boundary', 'write an agent handoff contract', 'test agent system instructions', 'narrow agent mutation scope'],
};

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readFrontmatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error(`Missing frontmatter: ${filePath}`);
  return yaml.load(match[1]) || {};
}

for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_') || skip.has(entry.name)) continue;
  const skillId = entry.name;
  const skillDir = path.join(skillsRoot, skillId);
  const entrypoint = ['SKILL.md', 'skill.md'].map((name) => path.join(skillDir, name)).find(fs.existsSync);
  if (!entrypoint) continue;
  const fm = readFrontmatter(entrypoint);
  const nativePath = path.join(skillDir, 'skill.json');
  const overlayPath = path.join(skillsRoot, '.manifests', `${skillId}.skill.json`);
  const native = readJson(nativePath);
  const overlay = readJson(overlayPath);
  const effective = { ...(native || {}), ...(overlay || {}) };
  const lifecycle = String(effective.lifecycle || 'active').toLowerCase();
  const requestedTriggers = triggerOverrides[skillId] || effective.triggers || [];
  const triggers = ['deprecated', 'archived'].includes(lifecycle) ? [] : validateSkillTriggers(requestedTriggers).triggers;
  const common = {
    id: skillId,
    name: String(fm.name),
    description: String(fm.description),
    entrypoint: path.basename(entrypoint),
    triggers,
    implicitInvocation: ['deprecated', 'archived'].includes(lifecycle)
      ? false
      : explicitOnly.has(skillId)
        ? false
        : typeof effective.implicitInvocation === 'boolean' ? effective.implicitInvocation : true,
    lifecycle,
  };
  const targets = [
    ...(native ? [[nativePath, native]] : []),
    ...(overlay ? [[overlayPath, overlay]] : []),
  ];
  if (!targets.length) targets.push([nativePath, {
    schemaVersion: 'prometheus-skill-bundle-v1',
    version: '1.0.0',
    categories: [],
    requiredTools: [],
    permissions: {},
    resources: [],
  }]);
  for (const [manifestPath, manifest] of targets) {
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, ...common }, null, 2)}\n`, 'utf8');
  }
  console.log(`NORMALIZED ${skillId}: ${triggers.length} triggers; implicit=${common.implicitInvocation}; lifecycle=${lifecycle}`);
}
