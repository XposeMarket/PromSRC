import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveSkillsRoot } from '../skills/store.js';
import { loadSkillPackage } from '../gateway/skills-runtime/skill-package.js';

// Prefer config next to the project, fall back to home.
// In packaged Electron runtime PROMETHEUS_DATA_DIR is set by main.js and takes priority
// so user data is read from %APPDATA%\Prometheus rather than the resources directory.
const PROJECT_CONFIG_NEW = path.join(process.cwd(), '.prometheus');
const PROJECT_CONFIG = PROJECT_CONFIG_NEW;
const CONFIG_DIR = process.env.PROMETHEUS_DATA_DIR
  ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus')
  : fs.existsSync(PROJECT_CONFIG) ? PROJECT_CONFIG : path.join(os.homedir(), '.prometheus');
const SOUL_PATHS = [
  path.join(CONFIG_DIR, 'soul.md'),
  path.join(process.cwd(), 'src', 'config', 'soul.md'),
];
const SKILLS_DIR = resolveSkillsRoot();

function intEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

const PROMPT_BUDGET_FULL = {
  totalChars: intEnv('PROMETHEUS_PROMPT_TOTAL_CHARS', 7500),
  soulChars: 3200,
  memoryChars: 700,
  skillsTotalChars: 1400,
  skillEachChars: 900,
  extraChars: 4500,
};

const SOUL_EMBODIMENT_GUIDANCE = [
  '## Prometheus Identity Contract',
  '',
  'If SOUL.md is present, it is not optional flavor text. Treat it as your durable personality, values, relationship posture, and operating identity.',
  '',
  'Embody its persona and tone unless a higher-priority instruction conflicts. Let it shape how you collaborate, not just what facts you mention.',
  '',
  'Avoid stiff generic chatbot behavior, corporate assistant-speak, hollow enthusiasm, and purely transactional replies. Stay useful, grounded, and action-oriented while sounding like Prometheus.',
].join('\n');

const PROMPT_BUDGET_MINIMAL = {
  totalChars: intEnv('PROMETHEUS_SUBAGENT_PROMPT_TOTAL_CHARS', 2000),
  soulChars: 0,
  memoryChars: 0,
  skillsTotalChars: 0,
  skillEachChars: 0,
  extraChars: 600,
};

function clampText(text: string, maxChars: number): string {
  const t = String(text || '').trim();
  if (!t || maxChars <= 0) return '';
  if (t.length <= maxChars) return t;
  const head = t.slice(0, Math.max(0, maxChars - 20)).trimEnd();
  return `${head}\n...[truncated]`;
}

function readFirstExisting(paths: string[]): string {
  for (const p of paths) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8').trim();
  }
  return '';
}

export function loadSoul(): string {
  return readFirstExisting(SOUL_PATHS);
}

export interface SkillInfo {
  slug: string;
  content: string;
  path: string;
  promptPath?: string;
  status?: string;
  executionEnabled?: boolean;
  riskLevel?: string;
  name?: string;
  description?: string;
  triggers?: string[];
  templates?: Array<{ action?: string; label?: string; command?: string }>;
}

export function loadSkills(): SkillInfo[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const skills: SkillInfo[] = [];
  try {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(SKILLS_DIR, entry.name);
      const pkg = loadSkillPackage(skillDir, entry.name);
      if (!pkg) continue;
      if (!pkg.executionEnabled || pkg.status === 'blocked' || pkg.status === 'needs_setup') continue;
      const contentPath = pkg.promptPath || pkg.filePath;
      skills.push({
        slug: pkg.id,
        content: fs.readFileSync(contentPath, 'utf-8').trim(),
        path: pkg.filePath,
        promptPath: pkg.promptPath,
        status: pkg.status,
        executionEnabled: pkg.executionEnabled,
        riskLevel: pkg.riskLevel,
        name: pkg.name,
        description: pkg.description,
        triggers: Array.isArray(pkg.triggers) ? pkg.triggers : [],
        templates: Array.isArray((pkg.manifest as any)?.templates) ? (pkg.manifest as any).templates : [],
      });
    }
  } catch {}
  return skills;
}

function tokenizeSkillQuery(input: string): string[] {
  const stop = new Set([
    'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'in', 'on', 'at', 'is', 'are',
    'be', 'can', 'you', 'please', 'use', 'run', 'help', 'skill', 'skills', 'prometheus',
  ]);
  const tokens = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
  // Note: 'prometheus' and 'prom' excluded from stopwords intentionally — not skill keywords
  return Array.from(new Set(tokens));
}

const SKILL_TRIGGER_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'with', 'in', 'on', 'at',
  'me', 'my', 'our', 'this', 'that', 'please',
]);

function normalizeSkillTriggerText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSkillTriggerTextLoose(input: string): string {
  return normalizeSkillTriggerText(input)
    .split(' ')
    .filter((word) => word && !SKILL_TRIGGER_STOPWORDS.has(word))
    .join(' ');
}

function skillTriggerScore(trigger: string, query: string): number {
  const normalizedTrigger = normalizeSkillTriggerText(trigger);
  if (!normalizedTrigger) return 0;
  const normalizedQuery = normalizeSkillTriggerText(query);
  if (!normalizedQuery) return 0;
  if (normalizedTrigger.includes(' ')) {
    if (normalizedQuery.includes(normalizedTrigger)) return 7;
    const looseTrigger = normalizeSkillTriggerTextLoose(normalizedTrigger);
    const looseQuery = normalizeSkillTriggerTextLoose(normalizedQuery);
    return looseTrigger.length >= 4 && looseQuery.includes(looseTrigger) ? 5 : 0;
  }
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  return words.some((word) => {
    if (word === normalizedTrigger) return true;
    if (normalizedTrigger.length < 5 || word.length < 5) return false;
    return word.startsWith(normalizedTrigger) || normalizedTrigger.startsWith(word);
  }) ? 5 : 0;
}

export function selectSkillSlugsForMessage(message: string, max = 2): string[] {
  const query = String(message || '').trim().toLowerCase();
  if (!query) return [];
  const skills = loadSkills();
  if (!skills.length) return [];
  const tokens = tokenizeSkillQuery(query);
  const scored: Array<{ slug: string; score: number }> = [];

  for (const s of skills) {
    const slug = String(s.slug || '').toLowerCase();
    const name = String(s.name || '').toLowerCase();
    const desc = String(s.description || '').toLowerCase();
    const content = String(s.content || '').toLowerCase();
    const triggers = Array.isArray(s.triggers) ? s.triggers : [];
    const templates = Array.isArray(s.templates) ? s.templates : [];
    let score = 0;

    if (slug && query.includes(slug)) score += 8;
    if (name && query.includes(name)) score += 6;
    for (const trigger of triggers) score += skillTriggerScore(trigger, query);

    for (const t of tokens) {
      if (slug.includes(t)) score += 4;
      if (name.includes(t)) score += 3;
      if (desc.includes(t)) score += 2;
      for (const trigger of triggers) {
        const normalizedTrigger = normalizeSkillTriggerText(trigger);
        if (normalizedTrigger.includes(t)) score += 2;
      }
      if (t.length >= 4 && content.includes(t)) score += 1;
      for (const tpl of templates) {
        const cmd = String(tpl?.command || '').toLowerCase();
        const action = String(tpl?.action || '').toLowerCase();
        if (cmd.includes(t) || action.includes(t)) score += 2;
      }
    }

    if (score > 0) scored.push({ slug: s.slug, score });
  }

  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return scored.slice(0, Math.max(1, Number(max) || 2)).map((x) => x.slug);
}

export interface BuildSystemPromptOptions {
  includeSkillSlugs?: string[];
  extraInstructions?: string;
  includeMemory?: boolean;
  includeSoul?: boolean;
  /** workspace directory to read bootstrap files from */
  workspacePath?: string;
  /**
   * prompt mode
   * "full"    = all files injected (main agent / user chat)
   * "minimal" = only AGENTS.md + TOOLS.md injected (sub-agents)
   * "none"    = only base identity line
   */
  promptMode?: 'full' | 'minimal' | 'none';
}

export function loadWorkspaceBootstrap(
  workspacePath: string,
  promptMode: 'full' | 'minimal' | 'none' = 'full',
): string {
  const read = (filename: string): string => {
    const p = path.join(workspacePath, filename);
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf-8').trim();
  };

  if (promptMode === 'none') return '';

  const sections: Array<{ label: string; content: string }> = [];

  // AGENTS.md - always injected (defines the agent's job)
  const agentsMd = read('AGENTS.md');
  if (agentsMd) sections.push({ label: 'AGENTS.md', content: agentsMd });

  // TOOLS.md - always injected (tool usage notes)
  const toolsMd = read('TOOLS.md');
  if (toolsMd) sections.push({ label: 'TOOLS.md', content: toolsMd });

  if (promptMode === 'minimal') {
    // Sub-agents get AGENTS.md + TOOLS.md only.
    return sections
      .map(s => `### ${s.label}\n${clampText(s.content, 4000)}`)
      .join('\n\n');
  }

  // Full mode: inject all bootstrap files
  const fullFiles = [
    { label: 'SOUL.md', filename: 'SOUL.md', maxChars: 3000 },
    { label: 'USER.md', filename: 'USER.md', maxChars: 3000 },
    { label: 'MEMORY.md', filename: 'MEMORY.md', maxChars: 1600 },
    { label: 'HEARTBEAT.md', filename: 'HEARTBEAT.md', maxChars: 3000 },
  ];

  for (const f of fullFiles) {
    const content = read(f.filename);
    if (content) sections.push({ label: f.label, content: clampText(content, f.maxChars) });
  }

  // Daily memory file
  const today = new Date().toISOString().slice(0, 10);
  const dailyPath = path.join(workspacePath, 'memory', `${today}.md`);
  if (fs.existsSync(dailyPath)) {
    const daily = fs.readFileSync(dailyPath, 'utf-8').trim();
    if (daily) sections.push({ label: `memory/${today}.md`, content: clampText(daily, 2000) });
  }

  if (!sections.length) return '';

  return [
    '## Project Context',
    sections.map(s => `### ${s.label}\n${s.content}`).join('\n\n---\n\n'),
  ].join('\n');
}

export function buildSystemPrompt(options?: BuildSystemPromptOptions): string {
  const budget = (options?.promptMode === 'minimal' || options?.promptMode === 'none')
    ? PROMPT_BUDGET_MINIMAL
    : PROMPT_BUDGET_FULL;
  const includeSoul = options?.includeSoul ?? true;
  const soul = includeSoul ? loadSoul() : '';
  const allSkills = loadSkills();

  // Skills are opt-in per turn to keep context tight on small models.
  const requestedSkills = Array.isArray(options?.includeSkillSlugs) ? options!.includeSkillSlugs! : [];
  const skills = requestedSkills.length
    ? allSkills.filter(s => requestedSkills.includes(s.slug))
    : [];

  const parts: string[] = [];
  let usedChars = 0;
  const pushPart = (text: string): void => {
    const normalized = String(text || '').trim();
    if (!normalized) return;
    const sep = parts.length ? '\n\n---\n\n' : '';
    const candidate = `${sep}${normalized}`;
    if (usedChars + candidate.length > budget.totalChars) return;
    parts.push(normalized);
    usedChars += candidate.length;
  };

  const soulCapped = clampText(soul, budget.soulChars);
  if (soulCapped) {
    pushPart(SOUL_EMBODIMENT_GUIDANCE);
    pushPart(soulCapped);
  }

  const includeMemory = options?.includeMemory ?? true;
  if (includeMemory) {
    // Curated memory now comes from runtime fact-store retrieval tools.
    // Do not inject legacy markdown memory files here.
  }

  // If a workspacePath is provided, inject workspace bootstrap files.
  if (options?.workspacePath) {
    const mode = options.promptMode ?? 'full';
    const bootstrap = loadWorkspaceBootstrap(options.workspacePath, mode);
    if (bootstrap) pushPart(bootstrap);
  }

  if (skills.length > 0) {
    const skillDocs: string[] = [];
    let skillUsed = 0;
    for (const s of skills) {
      const one = `### Skill: ${s.slug}\n${clampText(s.content, budget.skillEachChars)}`.trim();
      if (!one) continue;
      if (skillUsed + one.length > budget.skillsTotalChars) break;
      skillDocs.push(one);
      skillUsed += one.length;
    }
    if (skillDocs.length) pushPart(`## Available Skills\n${skillDocs.join('\n\n')}`);
  }

  if (options?.extraInstructions) {
    pushPart(clampText(options.extraInstructions, budget.extraChars));
  }

  return parts.join('\n\n---\n\n');
}
