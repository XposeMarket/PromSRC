/**
 * skills-manager.ts
 *
 * Skills are either simple SKILL.md playbooks or bundled skill packages with
 * skill.json, an entrypoint markdown file, and optional static resources.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isPublicDistributionBuild } from '../../runtime/distribution';
import {
  buildActiveSkillRoutingContext,
  getSkillRoutingMode,
  recordSkillRoutingReport,
  resolveSkillRuntimeRouting,
} from '../../runtime/skill-routing-resolver';
import {
  getSkillOverlayPath,
  getSkillProvenancePath,
  loadSkillPackage,
  normalizeSkillRelativePathForWrite,
  readSkillResourceText,
  resolveSkillRelativePath,
  sanitizeSkillId,
  canReadSkillResource,
  validateSkillTriggers,
  MAX_SKILL_TRIGGERS,
  type LoadedSkillPackage,
  type SkillPermissions,
  type SkillResource,
  type SkillLifecycleState,
  type SkillOwnershipState,
  type SkillHealth,
} from './skill-package';
import {
  assertSkillScanAllowed,
  ensureSkillSafetyDirs,
  scanSkillDirectory,
  scanSkillText,
  type SkillSafetyScan,
} from './skill-safety';
import {
  resolveSkillEligibility,
  type SkillAssignment,
  type SkillEligibility,
  type SkillRequires,
  type SkillToolBinding,
} from './skill-eligibility';
import {
  auditSkillImport,
  type SkillImportAudit,
} from './skill-import-auditor';

export interface Skill {
  id: string;
  name: string;
  description: string;
  emoji: string;
  version: string;
  kind: 'simple' | 'bundle';
  triggers: string[];
  categories: string[];
  requiredTools: string[];
  requires?: SkillRequires;
  assignment?: SkillAssignment;
  toolBinding?: SkillToolBinding;
  permissions: SkillPermissions;
  resources: SkillResource[];
  status: 'ready' | 'needs_setup' | 'blocked';
  health: SkillHealth;
  eligibility: SkillEligibility;
  safety: SkillSafetyScan;
  lifecycle: SkillLifecycleState;
  ownership: SkillOwnershipState;
  executionEnabled: boolean;
  implicitInvocation: boolean;
  riskLevel?: string;
  instructions: string;
  filePath: string;
  rootDir: string;
  entrypoint: string;
  promptPath?: string;
  validation: LoadedSkillPackage['validation'];
  manifest: LoadedSkillPackage['manifest'];
  manifestSource: LoadedSkillPackage['manifestSource'];
  manifestPath?: string;
  overlayPath?: string;
  provenancePath?: string;
  provenance?: Record<string, unknown>;
}

export interface SkillChangeMetadata {
  changeType?: string;
  evidence?: string[];
  appliedBy?: string;
  reason?: string;
  triggerPositivePrompts?: string[];
  triggerNegativePrompts?: string[];
}

export interface SkillChangeLedgerEntry {
  timestamp: string;
  skillId: string;
  changeType: string;
  evidence: string[];
  beforeHash: string;
  afterHash: string;
  appliedBy: string;
  status: 'active';
  snapshotDir?: string;
  changedPaths: string[];
  reason?: string;
}

export interface SkillImportOptions {
  id?: string;
  overwrite?: boolean;
  mode?: 'adapt' | 'force';
  applySafeFixes?: boolean;
}

type BuildTurnContextOptions = {
  maxCharsPerSkill?: number;
  excludedSkillIds?: Iterable<string> | string[];
  forcedSkillIds?: string[];
  sessionId?: string;
};

function normalizeSkillIdSet(value: unknown): Set<string> {
  const ids = new Set<string>();
  const add = (item: unknown) => {
    const text = String(item || '').trim().toLowerCase();
    if (text) ids.add(text);
  };
  if (typeof value === 'string') {
    value.split(',').forEach(add);
  } else if (value && typeof (value as any)[Symbol.iterator] === 'function') {
    for (const item of value as Iterable<unknown>) add(item);
  }
  return ids;
}

function normalizeSkillMatchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SKILL_TRIGGER_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'with', 'in', 'on', 'at',
  'me', 'my', 'our', 'this', 'that', 'please',
]);

function normalizeSkillMatchTextLoose(value: string): string {
  return normalizeSkillMatchText(value)
    .split(' ')
    .filter((word) => word && !SKILL_TRIGGER_STOPWORDS.has(word))
    .join(' ');
}

function skillTriggerMatchesText(trigger: string, rawText: string, words: string[]): boolean {
  const normalizedTrigger = normalizeSkillMatchText(trigger);
  if (!normalizedTrigger) return false;
  const normalizedText = normalizeSkillMatchText(rawText);
  if (normalizedTrigger.includes(' ')) {
    if (normalizedText.includes(normalizedTrigger)) return true;
    const looseTrigger = normalizeSkillMatchTextLoose(trigger);
    const looseText = normalizeSkillMatchTextLoose(rawText);
    return looseTrigger.length >= 4 && looseText.includes(looseTrigger);
  }
  return words.some((word) => {
    const normalizedWord = normalizeSkillMatchText(word);
    if (normalizedWord === normalizedTrigger) return true;
    if (normalizedTrigger.length < 3 || normalizedWord.length < 3) return false;
    return normalizedWord.startsWith(normalizedTrigger) || normalizedTrigger.startsWith(normalizedWord);
  });
}

const SKILL_METADATA_MATCH_ALIASES: Record<string, string[]> = {
  bug: ['debug', 'fix', 'repair', 'issue', 'broken', 'error', 'troubleshoot'],
  fix: ['bug', 'debug', 'repair', 'issue', 'broken', 'error'],
  debug: ['bug', 'fix', 'repair', 'issue', 'troubleshoot'],
  lead: ['lead generation', 'lead-generation', 'prospect', 'prospecting', 'outreach'],
  generation: ['lead generation', 'lead-generation', 'prospecting'],
  maps: ['google maps', 'google-maps', 'local', 'places'],
  website: ['site', 'web', 'domain', 'homepage'],
  source: ['src', 'code', 'self edit', 'dev source'],
  src: ['source', 'code', 'self edit', 'dev source'],
  edit: ['modify', 'change', 'patch', 'update'],
  mobile: ['web ui', 'frontend', 'responsive', 'ios'],
  browser: ['web', 'page', 'dom', 'automation', 'click', 'screenshot'],
  desktop: ['window', 'screen', 'automation', 'click', 'screenshot'],
  shopping: ['buying', 'product', 'deal', 'price', 'commerce'],
  product: ['shopping', 'deal', 'price', 'commerce'],
  hyperframes: ['hyper frames', 'hyperframe', 'video', 'creative'],
  video: ['creative', 'promo', 'social', 'motion', 'hyperframes'],
};

function expandedSkillMetadataWords(text: string): string[] {
  const base = normalizeSkillMatchTextLoose(text)
    .split(' ')
    .filter((word) => word.length >= 3);
  const words = new Set<string>(base);
  for (const word of base) {
    for (const alias of SKILL_METADATA_MATCH_ALIASES[word] || []) {
      normalizeSkillMatchTextLoose(alias)
        .split(' ')
        .filter((item) => item.length >= 3)
        .forEach((item) => words.add(item));
    }
  }
  return Array.from(words);
}

function skillMetadataFallbackScore(skill: Skill, rawText: string): number {
  const words = expandedSkillMetadataWords(rawText);
  if (!words.length) return 0;
  const fields: Array<{ weight: number; text: string }> = [
    { weight: 10, text: skill.id },
    { weight: 8, text: skill.name },
    { weight: 7, text: skill.triggers.join(' ') },
    { weight: 7, text: skill.categories.join(' ') },
    { weight: 4, text: skill.requiredTools.join(' ') },
    { weight: 3, text: skill.description },
  ];
  let score = 0;
  for (const field of fields) {
    const hay = normalizeSkillMatchTextLoose(field.text);
    if (!hay) continue;
    for (const word of words) {
      if (hay.includes(word)) score += field.weight;
    }
  }
  return score;
}

const COMPOSER_SKILL_MATCH_IGNORED_WORDS = new Set([
  ...Array.from(SKILL_TRIGGER_STOPWORDS),
  'can', 'could', 'would', 'should', 'may', 'might',
  'want', 'wants', 'wanted', 'need', 'needs', 'needed',
  'like', 'just', 'thing', 'things', 'something', 'anything', 'stuff',
  'help', 'helps', 'helped', 'make', 'makes', 'made', 'create', 'creates', 'created',
  'use', 'uses', 'used', 'using', 'get', 'gets', 'got', 'give', 'gives', 'gave',
  'pls',
]);
const COMPOSER_SKILL_MATCH_SHORT_WORDS = new Set(['x', 'ui', 'ux', 'ai', 'seo', '3d', 'js', 'ts']);
const COMPOSER_METADATA_AMBIGUOUS_WORDS = new Set(['post']);

function composerSkillWords(rawText: string): string[] {
  return normalizeSkillMatchTextLoose(rawText)
    .split(' ')
    .map((word) => word.trim())
    .filter((word) =>
      (word.length >= 3 || COMPOSER_SKILL_MATCH_SHORT_WORDS.has(word)) &&
      !COMPOSER_SKILL_MATCH_IGNORED_WORDS.has(word)
    );
}

function composerWordSet(rawText: string): Set<string> {
  return new Set<string>(composerSkillWords(rawText));
}

function composerTriggerScore(trigger: string, rawText: string, queryWords: Set<string>): number {
  const triggerText = normalizeSkillMatchTextLoose(trigger);
  if (!triggerText || queryWords.size === 0) return 0;
  const queryText = Array.from(queryWords).join(' ');
  const triggerWords = triggerText
    .split(' ')
    .filter((word) => word.length >= 3 && !COMPOSER_SKILL_MATCH_IGNORED_WORDS.has(word));
  if (!triggerWords.length) return 0;

  if (triggerWords.length > 1) {
    if (queryText.includes(triggerText) || normalizeSkillMatchTextLoose(rawText).includes(triggerText)) return 40;
    const overlap = triggerWords.filter((word) => queryWords.has(word)).length;
    if (overlap >= Math.min(2, triggerWords.length)) return 18 + overlap;
    if (queryWords.size === 1) {
      const [onlyWord] = Array.from(queryWords);
      if (onlyWord.length >= 5 && triggerWords.includes(onlyWord)) return 12;
    }
    return 0;
  }

  const triggerWord = triggerWords[0];
  if (COMPOSER_SKILL_MATCH_IGNORED_WORDS.has(triggerWord)) return 0;
  if (queryWords.has(triggerWord)) return 14;
  if (triggerWord.length < 5) return 0;
  return Array.from(queryWords).some((word) =>
    word.length >= 5 && (word.startsWith(triggerWord) || triggerWord.startsWith(word))
  ) ? 10 : 0;
}

function composerMetadataScore(skill: Skill, rawText: string, queryWords: Set<string>): number {
  if (queryWords.size === 0) return 0;
  const fields: Array<{ weight: number; text: string }> = [
    { weight: 10, text: skill.id },
    { weight: 8, text: skill.name },
    { weight: 7, text: skill.categories.join(' ') },
  ];
  let score = 0;
  for (const field of fields) {
    const hayWords = new Set(composerSkillWords(field.text));
    for (const word of queryWords) {
      if (COMPOSER_METADATA_AMBIGUOUS_WORDS.has(word)) continue;
      if (hayWords.has(word)) score += field.weight;
    }
  }
  return score;
}

export type SkillRouteConfidence = 'high' | 'medium' | 'low';

export interface SkillRouteMatch {
  id: string;
  skill: Skill;
  score: number;
  confidence: SkillRouteConfidence;
  explicitMention: boolean;
  implicitEligible: boolean;
  domainConflict: boolean;
  matchedTriggers: string[];
  matchedDomains: string[];
}

const SKILL_DOMAIN_PATTERNS: Record<string, RegExp> = {
  coding: /\b(code|coding|source|src|repo|repository|typescript|javascript|python|frontend|backend|api|debug|bug|patch|refactor|compile|build|test|webgl|webgpu)\b/i,
  email: /\b(email|gmail|inbox|outlook|mail|imap|smtp)\b/i,
  creative: /\b(creative|video|animation|hyperframes|remotion|motion|3d|graphics|image|design|render|mp4|lottie|gsap)\b/i,
  social: /\b(social|twitter|tweet|linkedin|instagram|tiktok|repost|thread)\b|\bx\b/i,
  browser: /\b(browser|chrome|chromium|website|webpage|dom|playwright|tab)\b/i,
  desktop: /\b(desktop|windows|macos|window|computer use|screen automation)\b/i,
  documents: /\b(document|docx|pdf|presentation|pptx|slides|word)\b/i,
  spreadsheets: /\b(spreadsheet|excel|xlsx|csv|workbook)\b/i,
  scheduling: /\b(schedule|scheduled|scheduler|cron|timer|background job|automation job)\b/i,
  business: /\b(business|client|customer|sales|revenue|invoice|lead|prospect|operations|crm)\b/i,
  research: /\b(research|investigate|sources|citations|competitive analysis|web search)\b/i,
};

function detectSkillDomains(value: string): Set<string> {
  const out = new Set<string>();
  for (const [domain, pattern] of Object.entries(SKILL_DOMAIN_PATTERNS)) {
    if (pattern.test(value)) out.add(domain);
  }
  return out;
}

function exactPhraseInText(phrase: string, text: string): boolean {
  const normalizedPhrase = normalizeSkillMatchTextLoose(phrase);
  const normalizedText = normalizeSkillMatchTextLoose(text);
  if (normalizedPhrase.length < 4) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i').test(normalizedText);
}

function explicitSkillMentionScore(skill: Skill, rawText: string): number {
  const normalizedText = normalizeSkillMatchTextLoose(rawText);
  const idText = normalizeSkillMatchTextLoose(skill.id);
  const nameText = normalizeSkillMatchTextLoose(skill.name);
  const raw = String(rawText || '');
  const escapedId = skill.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:^|\\s)(?:\\$${escapedId}|skill:${escapedId})(?=$|\\s|[.,;!?])`, 'i').test(raw)) return 240;

  const nameWords = nameText.split(' ').filter(Boolean);
  const genericShortName = nameWords.length === 1 && nameText.length < 6;
  if (!genericShortName && nameText.length >= 4 && exactPhraseInText(nameText, normalizedText)) {
    return 190 + Math.min(30, nameWords.length * 6);
  }

  const idWords = idText.split(' ').filter(Boolean);
  const genericShortId = idWords.length === 1 && idText.length < 6;
  if (!genericShortId && idText.length >= 4 && exactPhraseInText(idText, normalizedText)) {
    return 185 + Math.min(24, idWords.length * 5);
  }
  if (genericShortId && exactPhraseInText(`skill ${idText}`, normalizedText)) return 220;
  return 0;
}

function triggerRouteScore(trigger: string, rawText: string, queryWords: Set<string>): number {
  const triggerText = normalizeSkillMatchTextLoose(trigger);
  const triggerWords = triggerText.split(' ').filter((word) => word.length >= 3);
  if (!triggerWords.length) return 0;
  if (exactPhraseInText(triggerText, rawText)) return 150 + Math.min(20, triggerWords.length * 4);
  const overlap = triggerWords.filter((word) => queryWords.has(word)).length;
  if (triggerWords.length >= 2 && overlap === triggerWords.length) return 52;
  if (triggerWords.length >= 3 && overlap >= 2 && overlap / triggerWords.length >= 0.66) return 34;
  return 0;
}

export function rankSkillMatches(
  skills: Skill[],
  messageText: string,
  options?: { includeExplicitOnly?: boolean; includeUnavailable?: boolean; limit?: number },
): SkillRouteMatch[] {
  const text = String(messageText || '').trim();
  if (!text) return [];
  const normalized = normalizeSkillMatchTextLoose(text);
  const queryWords = composerWordSet(text);
  const queryDomains = detectSkillDomains(normalized);
  const ranked: SkillRouteMatch[] = [];

  for (const skill of skills) {
    if (skill.lifecycle === 'deprecated' || skill.lifecycle === 'archived') continue;
    if (!options?.includeUnavailable && (skill.executionEnabled === false || skill.eligibility?.status !== 'ready')) continue;
    if (skill.status === 'blocked' || skill.health.state === 'blocked' || ['blocked', 'quarantined', 'unsupported'].includes(skill.eligibility.status)) continue;
    const explicitMentionScore = explicitSkillMentionScore(skill, text);
    const explicitMention = explicitMentionScore > 0;
    const matchedTriggers = skill.triggers
      .map((trigger) => ({ trigger, score: triggerRouteScore(trigger, text, queryWords) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const bestTriggerScore = matchedTriggers[0]?.score || 0;
    const hasExactTrigger = !!matchedTriggers[0] && exactPhraseInText(matchedTriggers[0].trigger, text);

    const skillText = [
      skill.id,
      skill.name,
      skill.categories.join(' '),
      skill.requiredTools.join(' '),
      skill.description,
    ].join(' ');
    const skillDomains = detectSkillDomains(normalizeSkillMatchTextLoose(skillText));
    const matchedDomains = Array.from(queryDomains).filter((domain) => skillDomains.has(domain));
    const domainConflict = queryDomains.size > 0 && skillDomains.size > 0 && matchedDomains.length === 0;
    const specializedExtraDomains = Array.from(skillDomains).filter((domain) =>
      !queryDomains.has(domain) && ['coding', 'email', 'creative', 'social', 'documents', 'spreadsheets', 'business'].includes(domain)
    );

    let score = explicitMention ? explicitMentionScore : bestTriggerScore;
    const metadataWords = new Set(composerSkillWords(`${skill.id} ${skill.name} ${skill.categories.join(' ')}`));
    const metadataOverlap = Array.from(queryWords).filter((word) => metadataWords.has(word)).length;
    score += Math.min(24, metadataOverlap * 8);
    const descriptionWords = new Set(composerSkillWords(skill.description));
    const descriptionOverlap = Array.from(queryWords).filter((word) => descriptionWords.has(word)).length;
    score += Math.min(30, descriptionOverlap * 10);
    if (matchedDomains.length) score += 18 + Math.min(12, matchedDomains.length * 4);
    if (queryDomains.size > 0 && specializedExtraDomains.length && !explicitMention && !hasExactTrigger) score -= 60;
    if (domainConflict && !explicitMention && !hasExactTrigger) score -= 80;

    const sourceWorkIntent = /\b(prometheus\s+(?:source|src)|self[ -]?edit|source\s+code|fix(?:ing)?\s+(?:a\s+)?bug|live\s+ui\s+verification)\b/i.test(text);
    const sourceRigorSkill = /src-edit-proposal-rigor|source.*edit.*rigor/i.test(`${skill.id} ${skill.name}`);
    if (sourceWorkIntent && sourceRigorSkill) score += 95;
    if (sourceWorkIntent && /restart|launch|open app/i.test(`${skill.id} ${skill.name} ${skill.description}`) && !sourceRigorSkill) score -= 85;

    const noBrowseIntent = /\b(draft only|write only|do not browse|don['’]?t browse|no research|do not publish|don['’]?t publish)\b/i.test(text);
    const networkOperationSkill = /\b(browser|fetch|publish|post media|web research|playwright)\b/i.test(
      `${skill.id} ${skill.name} ${skill.categories.join(' ')} ${skill.requiredTools.join(' ')} ${skill.description}`,
    );
    if (noBrowseIntent && networkOperationSkill && !explicitMention) score -= 100;

    const setupRestricted = skill.status === 'needs_setup' || skill.health.state === 'needs_setup' || skill.health.state === 'partial' || skill.eligibility.status === 'needs_setup';
    const implicitEligible = (!setupRestricted && skill.implicitInvocation !== false) || explicitMention;
    if (!implicitEligible && !options?.includeExplicitOnly) continue;
    if (domainConflict && !explicitMention && !hasExactTrigger) continue;
    if (score < 25) continue;
    const confidence: SkillRouteConfidence = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low';
    ranked.push({
      id: skill.id,
      skill,
      score,
      confidence,
      explicitMention,
      implicitEligible,
      domainConflict,
      matchedTriggers: matchedTriggers.slice(0, 3).map((item) => item.trigger),
      matchedDomains,
    });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, options?.limit || 8));
}

export function evaluateSkillTriggerRouting(
  skills: Skill[],
  targetSkill: Skill,
  positivePrompts: string[],
  negativePrompts: string[],
): {
  passed: boolean;
  failedPositive: string[];
  failedNegative: string[];
  failedPositiveDetails: Array<{ prompt: string; top: { id: string; score: number; confidence: SkillRouteConfidence } | null }>;
  failedNegativeDetails: Array<{ prompt: string; target: { score: number; confidence: SkillRouteConfidence } | null }>;
} {
  const evaluationSkills = skills.map((skill) => skill.id === targetSkill.id ? targetSkill : skill);
  if (!evaluationSkills.some((skill) => skill.id === targetSkill.id)) evaluationSkills.push(targetSkill);
  const failedPositiveDetails = positivePrompts.flatMap((prompt) => {
    const top = rankSkillMatches(evaluationSkills, prompt, { includeExplicitOnly: true, limit: 1 })[0];
    if (top?.id === targetSkill.id && top.confidence === 'high') return [];
    return [{ prompt, top: top ? { id: top.id, score: top.score, confidence: top.confidence } : null }];
  });
  // Negative preflight checks must exercise only the proposed trigger surface.
  // A new skill's broad name, description, categories, and required tools describe
  // its domain, but must not make it fail installation for adjacent requests.
  const failedNegativeDetails = negativePrompts.flatMap((prompt) => {
    const queryWords = composerWordSet(prompt);
    const score = Math.max(0, ...targetSkill.triggers.map((trigger) => triggerRouteScore(trigger, prompt, queryWords)));
    const confidence: SkillRouteConfidence = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low';
    if (confidence === 'low') return [];
    return [{ prompt, target: { score, confidence } }];
  });
  return {
    passed: failedPositiveDetails.length === 0 && failedNegativeDetails.length === 0,
    failedPositive: failedPositiveDetails.map((detail) => detail.prompt),
    failedNegative: failedNegativeDetails.map((detail) => detail.prompt),
    failedPositiveDetails,
    failedNegativeDetails,
  };
}

function mergeSkillIds(primary: string[], fallback: string[], limit = 8): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const id of [...primary, ...fallback]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
    if (merged.length >= limit) break;
  }
  return merged;
}

export class SkillsManager {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private lastScanAt = 0;

  constructor(workspaceOrSkillsDir: string) {
    this.skillsDir = workspaceOrSkillsDir.endsWith('skills')
      ? workspaceOrSkillsDir
      : path.join(workspaceOrSkillsDir, 'skills');

    fs.mkdirSync(this.skillsDir, { recursive: true });
    ensureSkillSafetyDirs(this.skillsDir);
    this.scanSkills();
  }

  getSkillsDir(): string { return this.skillsDir; }

  scanSkills(): void {
    this.skills.clear();
    this.lastScanAt = Date.now();

    if (!fs.existsSync(this.skillsDir)) return;

    for (const entry of fs.readdirSync(this.skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

      try {
        const pkg = loadSkillPackage(path.join(this.skillsDir, entry.name), entry.name);
        if (!pkg) continue;
        const safety = scanSkillDirectory(pkg.rootDir);
        const eligibility = resolveSkillEligibility({
          status: pkg.status,
          safety,
          requires: pkg.requires,
          permissions: pkg.permissions,
        });
        this.skills.set(pkg.id, {
          ...pkg,
          safety,
          eligibility,
        });
      } catch (e) {
        console.error(`[Skills] Failed to load ${entry.name}:`, e);
      }
    }

    console.log(`[Skills] ${this.skills.size} skills in ${this.skillsDir}`);
  }

  scanSkillsIfStale(maxAgeMs = 30_000): void {
    if (Date.now() - this.lastScanAt < maxAgeMs && this.skills.size > 0) return;
    this.scanSkills();
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Compatibility shim for shutdown hooks. Skills are filesystem-backed. */
  persistState(): void {}

  get(id: string): Skill | undefined {
    return this.skills.get(id) || this.skills.get(sanitizeSkillId(id));
  }

  listResources(id: string): SkillResource[] {
    return this.get(id)?.resources || [];
  }

  getAssignedToAgent(agentId: string): Skill[] {
    const id = String(agentId || '').trim();
    if (!id) return [];
    return this.getAll().filter((skill) => {
      const assigned = skill.assignment?.assignedAgents || [];
      return assigned.includes(id) || skill.assignment?.preferredAgent === id;
    });
  }

  getAssignedToTeam(teamId: string): Skill[] {
    const id = String(teamId || '').trim();
    if (!id) return [];
    return this.getAll().filter((skill) => (skill.assignment?.assignedTeams || []).includes(id));
  }

  readResource(
    id: string,
    relPath: string,
    maxChars?: number,
  ): { ok: true; path: string; content: string; truncated: boolean } | { ok: false; error: string } {
    const skill = this.get(id);
    if (!skill) return { ok: false, error: `Skill "${id}" not found.` };
    return readSkillResourceText(skill, relPath, maxChars);
  }

  readAutoLoadedResources(id: string): Array<{ path: string; content: string }> {
    const skill = this.get(id);
    if (!skill || isPublicDistributionBuild()) return [];
    const paths = skill.id === 'self-repair-protocol'
      ? ['references/dev-escalation.md']
      : [];
    return paths.flatMap((resourcePath) => {
      const result = this.readResource(skill.id, resourcePath, 12_000);
      return result.ok ? [{ path: result.path, content: result.content }] : [];
    });
  }

  inspect(id: string): any {
    const skill = this.get(id);
    if (!skill) return null;
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      kind: skill.kind,
      manifestSource: skill.manifestSource,
      manifestPath: skill.manifestPath,
      overlayPath: skill.overlayPath,
      provenancePath: skill.provenancePath,
      provenance: skill.provenance,
      rootDir: skill.rootDir,
      entrypoint: skill.entrypoint,
      filePath: skill.filePath,
      promptPath: skill.promptPath,
      triggers: skill.triggers,
      categories: skill.categories,
      requiredTools: skill.requiredTools,
      requires: skill.requires,
      assignment: skill.assignment,
      toolBinding: skill.toolBinding,
      permissions: skill.permissions,
      status: skill.status,
      eligibility: skill.eligibility,
      safety: skill.safety,
      lifecycle: skill.lifecycle,
      ownership: skill.ownership,
      executionEnabled: skill.executionEnabled,
      implicitInvocation: skill.implicitInvocation,
      riskLevel: skill.riskLevel,
      resources: skill.resources,
      validation: skill.validation,
      manifest: skill.manifest,
    };
  }

  writeManifestOverlay(id: string, manifest: Record<string, unknown>, metadata?: SkillChangeMetadata): Skill {
    const existing = this.get(id);
    const skillId = sanitizeSkillId(String(manifest?.id || existing?.id || id));
    const rootDir = existing?.rootDir || path.join(this.skillsDir, skillId);
    if (!fs.existsSync(rootDir)) throw new Error(`Skill "${id}" not found`);
    const beforeHash = hashSkillDirectory(rootDir);
    const snapshotDir = this.snapshotSkill(existing || null, rootDir, 'manifest-overlay');
    const overlayPath = getSkillOverlayPath(rootDir, skillId);
    if (Object.prototype.hasOwnProperty.call(manifest || {}, 'triggers')) {
      const validation = validateSkillTriggers(manifest.triggers);
      if (validation.rejected.length || validation.capped.length) {
        const rejected = validation.rejected.map((item) => `"${item.trigger}" (${item.reason})`);
        const capped = validation.capped.length ? [`${validation.capped.length} over cap ${MAX_SKILL_TRIGGERS}`] : [];
        throw new Error(`Invalid skill trigger set: ${[...rejected, ...capped].join(', ')}`);
      }
      manifest = { ...manifest, triggers: validation.triggers };
      const before = (existing?.triggers || []).join('\n');
      const after = validation.triggers.join('\n');
      if (before !== after) {
        const positivePrompts = (metadata?.triggerPositivePrompts || []).map(String).filter(Boolean);
        const negativePrompts = (metadata?.triggerNegativePrompts || []).map(String).filter(Boolean);
        if (!positivePrompts.length || !negativePrompts.length) {
          throw new Error('Trigger changes require positive and negative prompt evaluations.');
        }
        if (!existing) throw new Error('Cannot evaluate trigger routing for a missing skill.');
        const candidateSkill: Skill = {
          ...existing,
          triggers: validation.triggers,
          implicitInvocation: typeof manifest.implicitInvocation === 'boolean'
            ? manifest.implicitInvocation
            : existing.implicitInvocation,
        };
        const evaluationSkills = this.getAll().map((skill) => skill.id === existing.id ? candidateSkill : skill);
        const failedPositive = positivePrompts.filter((prompt) => {
          const top = rankSkillMatches(evaluationSkills, prompt, { limit: 1 })[0];
          return top?.id !== existing.id || top.confidence !== 'high';
        });
        const failedNegative = negativePrompts.filter((prompt) => {
          const target = rankSkillMatches(evaluationSkills, prompt, { limit: 8 }).find((match) => match.id === existing.id);
          return !!target && target.confidence !== 'low';
        });
        if (failedPositive.length || failedNegative.length) {
          throw new Error(`Trigger evaluation failed: ${failedPositive.length} positive prompt(s), ${failedNegative.length} negative prompt(s).`);
        }
      }
    }
    fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
    const { emoji: _emoji, ...manifestWithoutEmoji } = manifest || {};
    const normalized = {
      schemaVersion: 'prometheus-skill-bundle-v1',
      entrypoint: 'SKILL.md',
      ...manifestWithoutEmoji,
      id: skillId,
    };
    assertSkillScanAllowed(scanSkillText(JSON.stringify(normalized, null, 2), 'skill.json overlay'), `Manifest overlay for "${skillId}"`);
    fs.writeFileSync(overlayPath, JSON.stringify(normalized, null, 2) + '\n', 'utf-8');
    this.scanSkills();
    const updated = this.get(skillId);
    if (!updated) throw new Error(`Manifest written but skill "${skillId}" could not be loaded`);
    this.recordSkillChange(updated.id, {
      beforeHash,
      afterHash: hashSkillDirectory(updated.rootDir),
      changedPaths: [path.relative(updated.rootDir, overlayPath).replace(/\\/g, '/') || 'skill.json'],
      snapshotDir,
      metadata: { changeType: 'manifest_overlay', ...metadata },
    });
    return updated;
  }

  findMatchingSkills(toolName: string, messageText?: string): string[] {
    return rankSkillMatches(Array.from(this.skills.values()), `${toolName || ''} ${messageText || ''}`, { limit: 8 })
      .filter((item) => item.confidence !== 'low')
      .map((item) => item.id);
  }

  findMatchingSkillsForMessage(messageText: string): string[] {
    return rankSkillMatches(Array.from(this.skills.values()), messageText, { limit: 4 })
      .filter((item) => item.confidence !== 'low')
      .map((item) => item.id);
  }

  findComposerSkillMatches(messageText: string, limit = 8): string[] {
    return rankSkillMatches(Array.from(this.skills.values()), messageText, { includeExplicitOnly: true, limit })
      .filter((item) => item.confidence !== 'low')
      .map((item) => item.id);
  }

  resolveRuntimeRouting(messageText: string, options?: { forcedSkillIds?: string[]; excludedSkillIds?: Iterable<string> | string[] }) {
    const all = this.getAll();
    return resolveSkillRuntimeRouting({
      skills: all,
      rankedMatches: rankSkillMatches(all, messageText, { limit: 12 }),
      message: messageText,
      forcedSkillIds: options?.forcedSkillIds,
      excludedSkillIds: options?.excludedSkillIds,
    });
  }

  createSkill(data: {
    id: string;
    name: string;
    description: string;
    emoji?: string;
    triggers?: string[];
    triggerPositivePrompts?: string[];
    triggerNegativePrompts?: string[];
    implicitInvocation?: boolean;
    instructions: string;
  }): Skill {
    const id = sanitizeSkillId(data.id);
    if (!id) throw new Error('Invalid skill ID');
    const triggerValidation = validateSkillTriggers(data.triggers || []);
    if (triggerValidation.rejected.length || triggerValidation.capped.length) throw new Error('Invalid or over-cap skill triggers.');
    if (triggerValidation.triggers.length) {
      const positive = (data.triggerPositivePrompts || []).map(String).filter(Boolean);
      const negative = (data.triggerNegativePrompts || []).map(String).filter(Boolean);
      if (!positive.length || !negative.length) throw new Error('New skill triggers require positive and negative prompt evaluations.');
      const candidate = {
        id,
        name: data.name,
        description: data.description,
        triggers: triggerValidation.triggers,
        categories: [],
        requiredTools: [],
        implicitInvocation: data.implicitInvocation !== false,
        executionEnabled: true,
        status: 'ready',
        health: { state: 'ready' },
        eligibility: { status: 'ready' },
        lifecycle: 'active',
      } as unknown as Skill;
      const evaluation = evaluateSkillTriggerRouting(this.getAll(), candidate, positive, negative);
      if (!evaluation.passed) throw new Error(`New skill trigger evaluation failed: ${evaluation.failedPositive.length} positive, ${evaluation.failedNegative.length} negative. Details: ${JSON.stringify({ positive: evaluation.failedPositiveDetails, negative: evaluation.failedNegativeDetails })}`);
    }

    const skillDir = path.join(this.skillsDir, id);
    fs.mkdirSync(skillDir, { recursive: true });

    const lines = [
      '---',
      `name: ${data.name}`,
      `description: ${data.description}`,
      'version: 1.0.0',
    ];
    if (triggerValidation.triggers.length) {
      lines.push(`triggers: ${triggerValidation.triggers.join(', ')}`);
    }
    if (data.implicitInvocation === false) lines.push('implicitInvocation: false');
    lines.push('---');
    const content = lines.join('\n') + '\n\n' + data.instructions;
    assertSkillScanAllowed(scanSkillText(content, 'SKILL.md'), `Skill "${id}"`);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');

    this.scanSkills();

    const skill = this.skills.get(id);
    if (!skill) throw new Error('Skill creation failed');
    console.log(`[Skills] Created: ${id}`);
    return skill;
  }

  createBundle(data: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    emoji?: string;
    version?: string;
    triggers?: string[];
    categories?: string[];
    requiredTools?: string[];
    permissions?: SkillPermissions;
    requires?: SkillRequires;
    assignment?: SkillAssignment;
    toolBinding?: SkillToolBinding;
    implicitInvocation?: boolean;
    triggerPositivePrompts?: string[];
    triggerNegativePrompts?: string[];
    resources?: Array<{ path: string; content: string; type?: string; description?: string }>;
    overwrite?: boolean;
  }): Skill {
    const id = sanitizeSkillId(data.id);
    if (!id) throw new Error('Invalid skill ID');
    const triggerValidation = validateSkillTriggers(data.triggers || []);
    if (triggerValidation.rejected.length || triggerValidation.capped.length) throw new Error('Invalid or over-cap skill triggers.');
    if (triggerValidation.triggers.length) {
      const positive = (data.triggerPositivePrompts || []).map(String).filter(Boolean);
      const negative = (data.triggerNegativePrompts || []).map(String).filter(Boolean);
      if (!positive.length || !negative.length) throw new Error('New skill triggers require positive and negative prompt evaluations.');
      const candidate = {
        id,
        name: data.name,
        description: data.description,
        triggers: triggerValidation.triggers,
        categories: data.categories || [],
        requiredTools: data.requiredTools || [],
        implicitInvocation: data.implicitInvocation !== false,
        executionEnabled: true,
        status: 'ready',
        health: { state: 'ready' },
        eligibility: { status: 'ready' },
        lifecycle: 'active',
      } as unknown as Skill;
      const evaluation = evaluateSkillTriggerRouting(this.getAll(), candidate, positive, negative);
      if (!evaluation.passed) throw new Error(`New skill trigger evaluation failed: ${evaluation.failedPositive.length} positive, ${evaluation.failedNegative.length} negative. Details: ${JSON.stringify({ positive: evaluation.failedPositiveDetails, negative: evaluation.failedNegativeDetails })}`);
    }
    const skillDir = path.join(this.skillsDir, id);
    const existing = this.get(id);
    const beforeHash = existing ? hashSkillDirectory(existing.rootDir) : '';
    const snapshotDir = existing ? this.snapshotSkill(existing, existing.rootDir, 'bundle-overwrite') : undefined;
    if (fs.existsSync(skillDir)) {
      if (!data.overwrite) throw new Error(`Skill "${id}" already exists. Pass overwrite:true to replace it.`);
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
    assertSkillScanAllowed(scanSkillText(String(data.instructions || '').trim(), 'SKILL.md'), `Skill bundle "${id}"`);
    for (const resource of data.resources || []) {
      assertSkillScanAllowed(scanSkillText(String(resource.content || ''), resource.path), `Skill bundle "${id}" resource "${resource.path}"`);
    }
    fs.mkdirSync(skillDir, { recursive: true });

    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), String(data.instructions || '').trim() + '\n', 'utf-8');
    const manifest = {
      schemaVersion: 'prometheus-skill-bundle-v1',
      id,
      name: data.name,
      description: data.description || '',
      version: data.version || '1.0.0',
      entrypoint: 'SKILL.md',
      triggers: triggerValidation.triggers,
      categories: data.categories || [],
      requiredTools: data.requiredTools || [],
      requires: data.requires,
      assignment: data.assignment,
      toolBinding: data.toolBinding,
      implicitInvocation: data.implicitInvocation !== false,
      permissions: data.permissions || {
        workspaceRead: true,
        workspaceWrite: true,
        shell: false,
        externalSideEffects: false,
      },
      resources: (data.resources || []).map((resource) => ({
        path: normalizeSkillRelativePathForWrite(resource.path) || resource.path,
        type: resource.type || inferResourceTypeForWrite(resource.path),
        description: resource.description || undefined,
      })),
    };
    fs.writeFileSync(path.join(skillDir, 'skill.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    for (const resource of data.resources || []) {
      this.writeResourceFile(skillDir, resource.path, resource.content);
    }

    this.writeProvenance(skillDir, id, {
      sourceType: 'prometheus-created',
      source: 'skill_create_bundle',
      createdAt: new Date().toISOString(),
      prometheusCreatedVersion: 1,
    });
    this.scanSkills();
    const skill = this.get(id);
    if (!skill) throw new Error('Bundle creation failed');
    this.recordSkillChange(skill.id, {
      beforeHash,
      afterHash: hashSkillDirectory(skill.rootDir),
      changedPaths: ['SKILL.md', 'skill.json', ...(data.resources || []).map((resource) => normalizeSkillRelativePathForWrite(resource.path) || resource.path)],
      snapshotDir,
      metadata: { changeType: existing ? 'bundle_overwrite' : 'skill_created', appliedBy: 'skill_create_bundle' },
    });
    return skill;
  }

  writeResource(
    id: string,
    relPath: string,
    content: string,
    options?: { type?: string; description?: string; addToManifest?: boolean; change?: SkillChangeMetadata },
  ): Skill {
    const skill = this.get(id);
    if (!skill) throw new Error(`Skill "${id}" not found`);
    assertSkillScanAllowed(scanSkillText(content, relPath), `Skill "${id}" resource "${relPath}"`);
    const beforeHash = hashSkillDirectory(skill.rootDir);
    const snapshotDir = this.snapshotSkill(skill, skill.rootDir, 'resource-write', [relPath]);
    this.writeResourceFile(skill.rootDir, relPath, content);
    if (options?.addToManifest !== false) {
      this.upsertNativeManifestResource(skill, relPath, options?.type, options?.description);
    }
    this.scanSkills();
    const updated = this.get(skill.id);
    if (!updated) throw new Error(`Resource written but skill "${skill.id}" could not be loaded`);
    const safeRel = normalizeSkillRelativePathForWrite(relPath) || relPath;
    this.recordSkillChange(updated.id, {
      beforeHash,
      afterHash: hashSkillDirectory(updated.rootDir),
      changedPaths: options?.addToManifest === false ? [safeRel] : [safeRel, 'skill.json'],
      snapshotDir,
      metadata: { changeType: inferSkillChangeType(safeRel), ...options?.change },
    });
    return updated;
  }

  deleteResource(id: string, relPath: string, options?: { removeFromManifest?: boolean; change?: SkillChangeMetadata }): Skill {
    const skill = this.get(id);
    if (!skill) throw new Error(`Skill "${id}" not found`);
    const beforeHash = hashSkillDirectory(skill.rootDir);
    const snapshotDir = this.snapshotSkill(skill, skill.rootDir, 'resource-delete', [relPath]);
    const safeRel = normalizeSkillRelativePathForWrite(relPath);
    if (!safeRel) throw new Error('Invalid resource path');
    const abs = resolveSkillRelativePath(skill.rootDir, safeRel);
    if (!abs) throw new Error('Resource path escapes the skill folder');
    if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    if (options?.removeFromManifest !== false) this.removeNativeManifestResource(skill, safeRel);
    this.scanSkills();
    const updated = this.get(skill.id);
    if (!updated) throw new Error(`Resource deleted but skill "${skill.id}" could not be loaded`);
    this.recordSkillChange(updated.id, {
      beforeHash,
      afterHash: hashSkillDirectory(updated.rootDir),
      changedPaths: options?.removeFromManifest === false ? [safeRel] : [safeRel, 'skill.json'],
      snapshotDir,
      metadata: { changeType: 'resource_delete', ...options?.change },
    });
    return updated;
  }

  async exportBundle(id: string, outputPath?: string): Promise<{ path: string; bytes: number }> {
    const skill = this.get(id);
    if (!skill) throw new Error(`Skill "${id}" not found`);
    const JSZip = require('jszip');
    const zip = new JSZip();
    const root = path.resolve(skill.rootDir);
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        zip.file(`${skill.id}/${rel}`, fs.readFileSync(abs));
      }
    }
    if (skill.manifestSource === 'overlay' && skill.manifestPath && fs.existsSync(skill.manifestPath)) {
      zip.file(`${skill.id}/skill.json`, fs.readFileSync(skill.manifestPath));
    }
    const buffer: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const out = outputPath
      ? path.resolve(outputPath)
      : path.join(this.skillsDir, 'exports', `${skill.id}.skill.zip`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buffer);
    return { path: out, bytes: buffer.length };
  }

  async updateFromSource(id: string, options?: { overwrite?: boolean }): Promise<Skill[]> {
    const skill = this.get(id);
    if (!skill) throw new Error(`Skill "${id}" not found`);
    const source = String(skill.provenance?.source || '').trim();
    if (!source) throw new Error(`Skill "${id}" has no provenance source`);
    return this.importBundles(source, { overwrite: options?.overwrite !== false });
  }

  listChangeLedger(skillId?: string, limit = 20): SkillChangeLedgerEntry[] {
    const filePath = this.getLedgerPath();
    if (!fs.existsSync(filePath)) return [];
    const entries: SkillChangeLedgerEntry[] = [];
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as SkillChangeLedgerEntry;
        if (skillId && parsed.skillId !== sanitizeSkillId(skillId)) continue;
        entries.push(parsed);
      } catch {}
    }
    return entries
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, Math.max(1, Math.floor(Number(limit) || 20)));
  }

  async auditImportBundles(source: string, options?: { id?: string }): Promise<SkillImportAudit[]> {
    const sourceText = String(source || '').trim();
    if (!sourceText) throw new Error('source is required');
    const tempRoot = fs.mkdtempSync(path.join(this.skillsDir, '.import-audit-'));

    try {
      const staged = await stageSkillBundleSource(sourceText, tempRoot);
      const roots = findBundleRoots(staged);
      if (!roots.length) throw new Error('No skill.json or SKILL.md found in bundle source');
      if (options?.id && roots.length !== 1) throw new Error('id override can only be used when auditing a single skill bundle');
      return roots.map((root) => auditSkillImport(root, {
        source: sourceText,
        fallbackId: options?.id,
      }));
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  }

  async importBundle(source: string, options?: SkillImportOptions): Promise<Skill> {
    const installed = await this.importBundles(source, options);
    if (installed.length !== 1) {
      throw new Error(`Expected one skill bundle but found ${installed.length}. Leave id unset and use collection import semantics.`);
    }
    return installed[0];
  }

  async importBundles(source: string, options?: SkillImportOptions): Promise<Skill[]> {
    const sourceText = String(source || '').trim();
    if (!sourceText) throw new Error('source is required');
    const overwrite = options?.overwrite === true;
    const mode = options?.mode || 'adapt';
    const applySafeFixes = options?.applySafeFixes !== false;
    const tempRoot = fs.mkdtempSync(path.join(this.skillsDir, '.import-'));

    try {
      const staged = await stageSkillBundleSource(sourceText, tempRoot);
      const roots = findBundleRoots(staged);
      if (!roots.length) throw new Error('No skill.json or SKILL.md found in bundle source');
      if (options?.id && roots.length !== 1) throw new Error('id override can only be used when importing a single skill bundle');

      const installed: Skill[] = [];
      for (const root of roots) {
        const pkg = loadSkillPackage(root, options?.id || path.basename(root));
        if (!pkg) continue;
        if (!pkg.validation.ok) throw new Error(`Invalid skill bundle "${pkg.id}": ${pkg.validation.errors.join('; ')}`);
        const audit = auditSkillImport(root, {
          source: sourceText,
          fallbackId: options?.id,
        });
        if (mode !== 'force' && audit.status === 'blocked') {
          const first = audit.findings.find((finding) => finding.severity === 'critical' || finding.severity === 'error');
          throw new Error(`Imported skill bundle "${audit.skillId}" blocked by compatibility audit: ${first?.code || audit.summary}${first?.message ? ` - ${first.message}` : ''}`);
        }
        assertSkillScanAllowed(scanSkillDirectory(root), `Imported skill bundle "${pkg.id}"`);

        const id = sanitizeSkillId(options?.id || pkg.id);
        const targetDir = path.join(this.skillsDir, id);
        if (fs.existsSync(targetDir)) {
          if (!overwrite) throw new Error(`Skill "${id}" already exists. Pass overwrite:true to replace it.`);
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        fs.cpSync(root, targetDir, { recursive: true, force: false });
        this.writeProvenance(targetDir, id, {
          sourceType: classifyImportSource(sourceText),
          source: sourceText,
          importedAt: new Date().toISOString(),
          upstreamFolder: path.basename(root),
          prometheusImportedVersion: 1,
          compatibilityAudit: {
            status: audit.status,
            sourceKind: audit.sourceKind,
            findings: audit.findings.length,
          },
        });
        this.writeImportAudit(targetDir, id, audit);
        if (mode !== 'force' && applySafeFixes && audit.manifestOverlay && audit.status !== 'blocked') {
          this.writeManifestOverlayFile(targetDir, id, { ...audit.manifestOverlay, id });
        }
        this.scanSkills();
        const loaded = this.get(id);
        if (!loaded) throw new Error(`Bundle import completed but skill "${id}" could not be loaded`);
        installed.push(loaded);
      }
      return installed;
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  }

  private writeProvenance(rootDir: string, id: string, provenance: Record<string, unknown>): void {
    try {
      const p = getSkillProvenancePath(rootDir, id);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(provenance, null, 2) + '\n', 'utf-8');
    } catch (err: any) {
      console.warn(`[Skills] Failed to write provenance for ${id}: ${err?.message || err}`);
    }
  }

  private writeManifestOverlayFile(rootDir: string, id: string, manifest: Record<string, unknown>): void {
    const p = getSkillOverlayPath(rootDir, id);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const { emoji: _emoji, ...manifestWithoutEmoji } = manifest || {};
    fs.writeFileSync(p, JSON.stringify({
      schemaVersion: 'prometheus-skill-bundle-v1',
      ...manifestWithoutEmoji,
      id: sanitizeSkillId(String(manifestWithoutEmoji.id || id)),
    }, null, 2) + '\n', 'utf-8');
  }

  private writeImportAudit(rootDir: string, id: string, audit: SkillImportAudit): void {
    try {
      const p = getSkillImportAuditPath(rootDir, id);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(audit, null, 2) + '\n', 'utf-8');
    } catch (err: any) {
      console.warn(`[Skills] Failed to write import audit for ${id}: ${err?.message || err}`);
    }
  }

  private getHistoryRoot(): string {
    return path.join(this.skillsDir, '.history');
  }

  private getLedgerPath(): string {
    return path.join(this.getHistoryRoot(), 'skill-change-ledger.jsonl');
  }

  private snapshotSkill(skill: Skill | null, rootDir: string, reason: string, extraRelPaths: string[] = []): string | undefined {
    try {
      if (!fs.existsSync(rootDir)) return undefined;
      const skillId = sanitizeSkillId(skill?.id || path.basename(rootDir));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotDir = path.join(this.getHistoryRoot(), skillId, `${stamp}-${sanitizeSkillId(reason)}`);
      fs.mkdirSync(snapshotDir, { recursive: true });
      const rels = Array.from(new Set([
        'SKILL.md',
        'skill.md',
        'skill.json',
        skill?.entrypoint,
        skill?.manifestPath ? path.relative(rootDir, skill.manifestPath).replace(/\\/g, '/') : undefined,
        skill?.overlayPath ? path.relative(rootDir, skill.overlayPath).replace(/\\/g, '/') : undefined,
        ...extraRelPaths,
      ].filter(Boolean) as string[]));

      const copied: string[] = [];
      for (const rel of rels) {
        const abs = path.isAbsolute(rel) ? rel : resolveSkillRelativePath(rootDir, rel);
        if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        const outName = path.isAbsolute(rel)
          ? path.join('__external', path.basename(abs))
          : rel;
        const target = path.join(snapshotDir, outName);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(abs, target);
        copied.push(outName.replace(/\\/g, '/'));
      }
      fs.writeFileSync(path.join(snapshotDir, 'snapshot.json'), JSON.stringify({
        skillId,
        reason,
        createdAt: new Date().toISOString(),
        rootDir,
        copied,
        hash: hashSkillDirectory(rootDir),
      }, null, 2) + '\n', 'utf-8');
      return snapshotDir;
    } catch (err: any) {
      console.warn(`[Skills] Snapshot failed: ${err?.message || err}`);
      return undefined;
    }
  }

  private recordSkillChange(skillId: string, input: {
    beforeHash: string;
    afterHash: string;
    changedPaths: string[];
    snapshotDir?: string;
    metadata?: SkillChangeMetadata;
  }): void {
    try {
      const entry: SkillChangeLedgerEntry = {
        timestamp: new Date().toISOString(),
        skillId: sanitizeSkillId(skillId),
        changeType: sanitizeLedgerToken(input.metadata?.changeType || 'skill_update'),
        evidence: normalizeEvidence(input.metadata?.evidence),
        beforeHash: input.beforeHash || '',
        afterHash: input.afterHash || '',
        appliedBy: String(input.metadata?.appliedBy || 'skill_manager').slice(0, 120),
        status: 'active',
        snapshotDir: input.snapshotDir,
        changedPaths: Array.from(new Set(input.changedPaths.map((p) => String(p || '').replace(/\\/g, '/')).filter(Boolean))).slice(0, 40),
        reason: input.metadata?.reason ? String(input.metadata.reason).slice(0, 1000) : undefined,
      };
      const ledgerPath = this.getLedgerPath();
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err: any) {
      console.warn(`[Skills] Ledger write failed: ${err?.message || err}`);
    }
  }

  private writeResourceFile(rootDir: string, relPath: string, content: string): void {
    const safeRel = normalizeSkillRelativePathForWrite(relPath);
    if (!safeRel) throw new Error('Invalid resource path');
    if (!canReadSkillResource(safeRel)) throw new Error(`Resource extension is not allowed for text resource authoring: ${path.extname(safeRel) || '(none)'}`);
    const abs = resolveSkillRelativePath(rootDir, safeRel);
    if (!abs) throw new Error('Resource path escapes the skill folder');
    const bytes = Buffer.byteLength(String(content || ''), 'utf-8');
    if (bytes > 1_000_000) throw new Error('Resource content is too large for V1 authoring (max 1MB)');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content || ''), 'utf-8');
  }

  private upsertNativeManifestResource(skill: Skill, relPath: string, type?: string, description?: string): void {
    const safeRel = normalizeSkillRelativePathForWrite(relPath);
    if (!safeRel) throw new Error('Invalid resource path');
    const manifestPath = path.join(skill.rootDir, 'skill.json');
    const manifest = readJsonObject(manifestPath) || {
      schemaVersion: 'prometheus-skill-bundle-v1',
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version || '1.0.0',
      entrypoint: skill.entrypoint || 'SKILL.md',
      triggers: skill.triggers || [],
      categories: skill.categories || [],
      requiredTools: skill.requiredTools || [],
      permissions: skill.permissions || {},
    };
    const resources = Array.isArray((manifest as any).resources) ? [...(manifest as any).resources] : [];
    const idx = resources.findIndex((r: any) => String(r?.path || '') === safeRel);
    const entry = {
      path: safeRel,
      type: type || inferResourceTypeForWrite(safeRel),
      ...(description ? { description } : {}),
    };
    if (idx >= 0) resources[idx] = { ...resources[idx], ...entry };
    else resources.push(entry);
    (manifest as any).resources = resources;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }

  private removeNativeManifestResource(skill: Skill, relPath: string): void {
    const manifestPath = path.join(skill.rootDir, 'skill.json');
    const manifest = readJsonObject(manifestPath);
    if (!manifest || !Array.isArray((manifest as any).resources)) return;
    (manifest as any).resources = (manifest as any).resources.filter((r: any) => String(r?.path || '') !== relPath);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }

  deleteSkill(id: string): boolean {
    const skill = this.get(id);
    if (!skill) return false;
    try {
      fs.rmSync(skill.rootDir, { recursive: true, force: true });
      this.skills.delete(skill.id);
      return true;
    } catch { return false; }
  }

  getCompactList(): string {
    const all = this.getAll();
    if (!all.length) return 'No skills installed.';
    return all.map(s => {
      const status = s.health.state !== 'ready' ? ` [${s.health.state}]` : '';
      const reason = s.health.state !== 'ready' && s.health.reason ? ` Setup: ${s.health.reason}` : '';
      return `${s.id}${status} - ${s.description || '(no description)'}${reason}`;
    }).join('\n');
  }

  buildTurnContext(_messageText: string, optionsOrMaxChars: number | BuildTurnContextOptions = 3000): string {
    const all = this.getAll();
    if (!all.length) return '';
    const excludedSkillIds = typeof optionsOrMaxChars === 'number'
      ? new Set<string>()
      : normalizeSkillIdSet(optionsOrMaxChars?.excludedSkillIds);
    const forcedSkillIds = typeof optionsOrMaxChars === 'number'
      ? []
      : (Array.isArray(optionsOrMaxChars?.forcedSkillIds) ? optionsOrMaxChars.forcedSkillIds : []);
    const selectedSkills = forcedSkillIds
      .map((id) => String(id || '').trim())
      .filter((id) => !excludedSkillIds.has(String(id || '').trim().toLowerCase()))
      .map((id) => this.get(id))
      .filter((skill): skill is Skill => !!skill && skill.health.state !== 'blocked' && skill.status !== 'blocked')
      .slice(0, 3);
    const selectedIds = new Set(selectedSkills.map((skill) => skill.id));
    const allRankedMatches = rankSkillMatches(all, _messageText, { limit: 12 })
      .filter((match) => !excludedSkillIds.has(match.id.toLowerCase()));
    const rankedMatches = allRankedMatches
      .filter((match) => !selectedIds.has(match.id));
    const mandatoryMatch = rankedMatches.find((match) => match.confidence === 'high');
    const advisoryMatches = rankedMatches
      .filter((match) => match.id !== mandatoryMatch?.id && match.confidence !== 'low')
      .slice(0, 3);
    const selectedBlock = selectedSkills.length
      ? (
        `\n\n[USER_SELECTED_SKILLS] — inspect relevance before reading\n` +
        `The user explicitly selected these skills. Read only the ones whose description directly fits the current request; selection is not permission to load unrelated playbooks.\n` +
        selectedSkills.map((skill) => `- ${skill.id}${skill.health.state !== 'ready' ? ` [${skill.health.state}: ${skill.health.reason || 'setup required'}]` : ''} - ${skill.description.slice(0, 180) || skill.name}`).join('\n')
      )
      : '';
    const mandatoryBlock = mandatoryMatch
      ? (
        `\n\n[RELEVANT_SKILL] — one high-confidence read\n` +
        `This is the only implicit skill ranked high enough to read before acting. Read it because its full task scope matches—not merely because one word overlapped.\n` +
        `- ${mandatoryMatch.id} [score ${mandatoryMatch.score}; matched: ${mandatoryMatch.matchedTriggers.join(', ') || mandatoryMatch.matchedDomains.join(', ') || 'explicit name'}] - ${mandatoryMatch.skill.description.slice(0, 180) || mandatoryMatch.skill.name}`
      )
      : '';
    const advisoryBlock = advisoryMatches.length
      ? (
        `\n\n[POSSIBLY_RELEVANT_SKILLS] — suggestions, not required reads\n` +
        `Do not read these automatically. Read at most one only if a concrete part of the request clearly requires its non-obvious procedure. Ignore cross-domain or merely lexical matches.\n` +
        advisoryMatches.map((match) => `- ${match.id} [score ${match.score}] - ${match.skill.description.slice(0, 160) || match.skill.name}`).join('\n')
      )
      : '';

    const legacyContext = (
      `[SKILLS] You have ${all.length} reusable skill playbook${all.length !== 1 ? 's' : ''}. Skills are saved workflow instructions — the canonical how-to for a task. Reading the right skill makes you faster, cheaper in tokens, and correct, instead of re-deriving a workflow from scratch.\n` +
      `THE GOAL: use focused skills for genuinely repeatable workflows; do not create a skill for every task or one-off variation.\n` +
      `For greetings, small talk, quick Q&A, or confirmations: respond directly — do NOT call skill_list.\n` +
      `Use skill_list only when the request is unfamiliar or specialized and no high-confidence match is supplied. Never list or read skills merely because work is multi-step, involves files, or contains a broad word such as code, email, video, browser, or workflow.\n` +
      `When skill context appears, compare each description against the full user request. Read only the single clearly relevant skill; ignore unrelated matches even if their triggers overlap one token.\n` +
      `If a skill declares toolBinding metadata, treat requiredTools/defaultWorkflow as the operating contract (activate missing tool categories first); if it declares preferredAgent/assignedAgents/assignedTeams, consider routing substantial matching work there.\n` +
      `AFTER finishing a workflow: do not create or update a skill automatically. Normal turn evidence is recorded as a candidate; use skill_candidate_submit only when an explicit, evidence-backed candidate needs to be added. Skill mutations require Curator review or a direct user request. (Full skill-tool reference is in the SKILLS tool block.)` +
      selectedBlock + mandatoryBlock + advisoryBlock
    );
    const report = resolveSkillRuntimeRouting({
      skills: all,
      rankedMatches: allRankedMatches,
      message: _messageText,
      forcedSkillIds,
      excludedSkillIds,
    });
    if (typeof optionsOrMaxChars !== 'number' && optionsOrMaxChars.sessionId) {
      recordSkillRoutingReport(optionsOrMaxChars.sessionId, report);
    }
    const deterministicCommandSkills = /^\s*\/visual(?:\s|$)/i.test(_messageText)
      ? selectedSkills.filter((skill) => skill.id === 'interactive-visuals')
      : [];
    const forcedInstructions = deterministicCommandSkills.length
      ? [
          '[USER_SELECTED_SKILL_INSTRUCTIONS]',
          'The user explicitly selected the following skill instructions for this turn. They are already loaded: follow them directly and do not merely mention or rediscover them.',
          ...deterministicCommandSkills.flatMap((skill) => [
            '',
            `## ${skill.id}`,
            String(skill.instructions || '').trim(),
          ]),
          '[/USER_SELECTED_SKILL_INSTRUCTIONS]',
        ].join('\n')
      : '';
    return getSkillRoutingMode() === 'active'
      ? [buildActiveSkillRoutingContext({ report, skills: all }), forcedInstructions].filter(Boolean).join('\n\n')
      : legacyContext;
  }

  buildPromptContext(options?: {
    maxCharsPerSkill?: number;
    reassessSkills?: Array<{ id: string; name: string; emoji: string; turnsActive: number }>;
  }): string {
    return this.buildTurnContext('', options?.maxCharsPerSkill ?? 3000);
  }
}

async function stageSkillBundleSource(source: string, tempRoot: string): Promise<string> {
  const githubTree = parseGitHubTreeUrl(source);
  if (githubTree) {
    const zipUrl = `https://codeload.github.com/${githubTree.owner}/${githubTree.repo}/zip/refs/heads/${githubTree.ref}`;
    const response = await fetch(zipUrl);
    if (!response.ok) throw new Error(`GitHub download failed (${response.status} ${response.statusText})`);
    await extractZipBuffer(Buffer.from(await response.arrayBuffer()), tempRoot);
    const extractedRoot = findSingleExtractedRoot(tempRoot);
    const subdir = path.resolve(extractedRoot, githubTree.subpath);
    const root = path.resolve(extractedRoot);
    if (subdir !== root && !subdir.startsWith(root + path.sep)) throw new Error('GitHub tree path escapes repository root');
    if (!fs.existsSync(subdir) || !fs.statSync(subdir).isDirectory()) throw new Error(`GitHub tree path not found: ${githubTree.subpath}`);
    return subdir;
  }

  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Download failed (${response.status} ${response.statusText})`);
    const arrayBuffer = await response.arrayBuffer();
    const filename = source.split('/').pop()?.split('?')[0] || 'bundle.zip';
    const buffer = Buffer.from(arrayBuffer);
    if (filename.toLowerCase().endsWith('.zip')) return extractZipBuffer(buffer, tempRoot);
    const target = path.join(tempRoot, filename);
    fs.writeFileSync(target, buffer);
    throw new Error('Downloaded source is not a .zip bundle');
  }

  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`Source not found: ${source}`);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const target = path.join(tempRoot, path.basename(resolved));
    fs.cpSync(resolved, target, { recursive: true, force: false });
    return findBundleRoot(target);
  }
  if (stat.isFile() && resolved.toLowerCase().endsWith('.zip')) {
    return extractZipBuffer(fs.readFileSync(resolved), tempRoot);
  }
  throw new Error('Bundle source must be a directory, .zip file, or https URL to a .zip file');
}

async function extractZipBuffer(buffer: Buffer, tempRoot: string): Promise<string> {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const writes: Array<Promise<void>> = [];
  const root = path.resolve(tempRoot);

  zip.forEach((relativePath: string, file: any) => {
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('../')) return;
    const target = path.resolve(tempRoot, normalized);
    if (target !== root && !target.startsWith(root + path.sep)) return;
    if (file.dir) {
      fs.mkdirSync(target, { recursive: true });
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writes.push(file.async('nodebuffer').then((content: Buffer) => {
      fs.writeFileSync(target, content);
    }));
  });

  await Promise.all(writes);
  return findBundleRoot(tempRoot);
}

function findBundleRoot(root: string): string {
  const candidates = findBundleRoots(root);
  if (!candidates.length) throw new Error('No skill.json or SKILL.md found in bundle');
  return candidates.sort((a, b) => a.length - b.length)[0];
}

function findBundleRoots(root: string): string[] {
  const candidates: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    if (
      fs.existsSync(path.join(current, 'skill.json')) ||
      fs.existsSync(path.join(current, 'SKILL.md')) ||
      fs.existsSync(path.join(current, 'skill.md'))
    ) {
      candidates.push(current);
    }
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('__MACOSX')) stack.push(path.join(current, entry.name));
    }
  }
  return candidates
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .filter((candidate, index, all) => {
      const parent = all.find((other, otherIndex) => otherIndex < index && candidate.startsWith(other + path.sep));
      return !parent;
    });
}

function findSingleExtractedRoot(tempRoot: string): string {
  const dirs = fs.readdirSync(tempRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('__MACOSX'))
    .map((entry) => path.join(tempRoot, entry.name));
  return dirs.length === 1 ? dirs[0] : tempRoot;
}

function parseGitHubTreeUrl(source: string): { owner: string; repo: string; ref: string; subpath: string } | null {
  const match = String(source || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
    ref: match[3],
    subpath: match[4].replace(/^\/+/, ''),
  };
}

function classifyImportSource(source: string): string {
  if (parseGitHubTreeUrl(source)) return 'github-tree';
  if (/^https?:\/\//i.test(source)) return source.toLowerCase().split('?')[0].endsWith('.zip') ? 'zip-url' : 'url';
  if (source.toLowerCase().endsWith('.zip')) return 'zip-file';
  return 'directory';
}

function getSkillImportAuditPath(rootDir: string, skillIdOrFolder?: string): string {
  const folderName = sanitizeSkillId(skillIdOrFolder || path.basename(rootDir));
  return path.join(path.dirname(rootDir), '.manifests', `${folderName}.import-audit.json`);
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function inferResourceTypeForWrite(relPath: string): string {
  const top = String(relPath || '').replace(/\\/g, '/').split('/')[0]?.toLowerCase();
  if (top === 'templates') return 'template';
  if (top === 'schemas') return 'schema';
  if (top === 'examples') return 'example';
  if (top === 'assets') return 'asset';
  if (top === 'prompts' || top === 'prompt-fragments') return 'prompt-fragment';
  if (top === 'data' || top === 'fixtures') return 'data';
  return 'doc';
}

function sanitizeLedgerToken(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'skill_update';
}

function normalizeEvidence(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
  }
  const value = String(raw || '').trim();
  return value ? [value] : [];
}

function inferSkillChangeType(relPath: string): string {
  const normalized = String(relPath || '').replace(/\\/g, '/').toLowerCase();
  if (normalized.endsWith('skill.md') || normalized.endsWith('skill.md')) return 'instructions_update';
  if (normalized.includes('/examples/') || normalized.startsWith('examples/')) return 'example_update';
  if (normalized.includes('/templates/') || normalized.startsWith('templates/')) return 'template_update';
  if (normalized.includes('/schemas/') || normalized.startsWith('schemas/')) return 'schema_update';
  if (normalized.endsWith('skill.json')) return 'manifest_update';
  return 'resource_update';
}

function hashSkillDirectory(rootDir: string): string {
  try {
    if (!fs.existsSync(rootDir)) return '';
    const files: string[] = [];
    const stack = [rootDir];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
        if (rel.startsWith('.history/')) continue;
        if (!canReadSkillResource(rel) && path.basename(rel).toLowerCase() !== 'skill.json') continue;
        files.push(abs);
      }
    }
    const h = crypto.createHash('sha256');
    for (const abs of files.sort()) {
      const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
      h.update(rel);
      h.update('\0');
      h.update(fs.readFileSync(abs));
      h.update('\0');
    }
    return h.digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}
