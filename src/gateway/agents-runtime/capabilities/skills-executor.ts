import fs from 'fs';
import { parseJsonLike, type ToolResult } from '../../tool-builder';
import { activateSkillForSession, activateSkillResourceForSession } from '../../session';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';

const SKILL_TOOL_NAMES = new Set([
  'skill_list',
  'skill_read',
  'skill_resource_list',
  'skill_resource_read',
  'skill_import_bundle',
  'skill_inspect',
  'skill_manifest_write',
  'skill_create_bundle',
  'skill_resource_write',
  'skill_resource_delete',
  'skill_export_bundle',
  'skill_update_from_source',
  'skill_create',
  'skill_audit_all',
  'skill_update_metadata',
  'skill_repair_metadata',
]);

export function splitCsv(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((v: any) => String(v || '').trim()).filter(Boolean);
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = parseJsonLike(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v: any) => String(v || '').trim()).filter(Boolean);
      }
    } catch {}
  }
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

export interface SkillMetadataAudit {
  id: string;
  name: string;
  kind: string;
  score: number;
  issues: string[];
  description: string;
  triggers: string[];
  hasManifestOverlay: boolean;
}

const PLACEHOLDER_DESCRIPTION_RE = /^(\(no description\)|tbd|todo|placeholder|description|skill|n\/a|none)\.?$/i;

// Pure metadata-quality scorer. Returns issues + a 0-100 score so fleet tools
// can flag skills whose triggers/descriptions will route poorly, without any
// file mutation. Higher score = better discovery metadata.
export function scoreSkillMetadata(skill: any): SkillMetadataAudit {
  const description = String(skill?.description || '').trim();
  const triggers: string[] = Array.isArray(skill?.triggers)
    ? skill.triggers.map((t: any) => String(t || '').trim()).filter(Boolean)
    : [];
  const issues: string[] = [];
  let score = 100;

  if (!description) {
    issues.push('missing_description');
    score -= 45;
  } else {
    if (PLACEHOLDER_DESCRIPTION_RE.test(description)) {
      issues.push('placeholder_description');
      score -= 35;
    }
    if (description.length < 40) {
      issues.push('description_too_short');
      score -= 20;
    }
    if (!/\b(use (this|it)|triggers? on|use when|use for)\b/i.test(description)) {
      issues.push('description_missing_usage_guidance');
      score -= 10;
    }
  }

  if (triggers.length === 0) {
    issues.push('no_triggers');
    score -= 40;
  } else {
    if (triggers.length < 3) {
      issues.push('too_few_triggers');
      score -= 15;
    }
    const unique = new Set(triggers.map((t) => t.toLowerCase()));
    if (unique.size < triggers.length) {
      issues.push('duplicate_triggers');
      score -= 5;
    }
    if (triggers.some((t) => t.length < 3)) {
      issues.push('weak_short_trigger');
      score -= 5;
    }
  }

  if (skill?.validation && skill.validation.ok === false) {
    issues.push('manifest_validation_error');
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  return {
    id: String(skill?.id || ''),
    name: String(skill?.name || skill?.id || ''),
    kind: String(skill?.kind || 'simple'),
    score,
    issues,
    description,
    triggers,
    hasManifestOverlay: skill?.manifestSource === 'overlay' || !!skill?.overlayPath,
  };
}

export function skillMatchesScope(skill: any, scope: string): boolean {
  const s = String(scope || 'all').trim().toLowerCase();
  if (!s || s === 'all') return true;
  const hay = `${skill?.id || ''} ${skill?.name || ''} ${String(skill?.description || '')} ${(skill?.categories || []).join(' ')}`.toLowerCase();
  if (s === 'prometheus-related' || s === 'prometheus') {
    return /prometheus|gateway|subagent|\bteam\b|schedule|memory|desktop|browser|hyperframes|creative|connector|skill|composite|webhook|mcp|brain|approval|artifact|context-pack|runbook/.test(hay);
  }
  return hay.includes(s);
}

// Build a manifest overlay object from structured metadata args, preserving
// existing fields unless explicitly overridden. Returns null when nothing changes.
export function buildMetadataManifest(skill: any, args: any): Record<string, unknown> | null {
  const manifest: Record<string, unknown> = {};
  const existingEntrypoint = String(skill?.entrypoint || '').trim();
  if (existingEntrypoint) manifest.entrypoint = existingEntrypoint;
  let changed = false;
  if (args.description !== undefined && args.description !== null) {
    const d = String(args.description).trim();
    if (d && d !== String(skill?.description || '').trim()) { manifest.description = d; changed = true; }
  }
  const currentTriggers = Array.isArray(skill?.triggers)
    ? skill.triggers.map((t: any) => String(t || '').trim()).filter(Boolean)
    : [];
  let nextTriggers: string[] | null = null;
  if (args.triggers !== undefined && args.triggers !== null) {
    const t = splitCsv(args.triggers);
    if (t.length) nextTriggers = t;
  }
  if (args.addTriggers !== undefined || args.add_triggers !== undefined) {
    const additions = splitCsv(args.addTriggers ?? args.add_triggers);
    if (additions.length) nextTriggers = [...(nextTriggers || currentTriggers), ...additions];
  }
  if (args.removeTriggers !== undefined || args.remove_triggers !== undefined) {
    const removals = new Set(splitCsv(args.removeTriggers ?? args.remove_triggers).map((t: string) => t.toLowerCase()));
    if (removals.size) nextTriggers = (nextTriggers || currentTriggers).filter((t: string) => !removals.has(t.toLowerCase()));
  }
  if (nextTriggers) {
    const seen = new Set<string>();
    const deduped = nextTriggers
      .map((t) => String(t || '').trim())
      .filter((t) => {
        const key = t.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const before = currentTriggers.map((t: string) => t.toLowerCase()).join('\n');
    const after = deduped.map((t: string) => t.toLowerCase()).join('\n');
    if (deduped.length && before !== after) {
      manifest.triggers = deduped;
      changed = true;
    }
  }
  if (args.categories !== undefined && args.categories !== null) {
    const c = splitCsv(args.categories);
    if (c.length) { manifest.categories = c; changed = true; }
  }
  if (args.requiredTools !== undefined || args.required_tools !== undefined) {
    const r = splitCsv(args.requiredTools ?? args.required_tools);
    if (r.length) { manifest.requiredTools = r; changed = true; }
  }
  if (args.lifecycle !== undefined && args.lifecycle !== null) {
    const l = String(args.lifecycle).trim();
    if (l) { manifest.lifecycle = l; changed = true; }
  }
  if (args.name !== undefined && args.name !== null) {
    const n = String(args.name).trim();
    if (n && n !== String(skill?.name || '').trim()) { manifest.name = n; changed = true; }
  }
  return changed ? manifest : null;
}

function stripSkillEmojiFrontmatter(content: string): string {
  const raw = String(content || '');
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return raw;
  const frontmatter = raw.slice(0, end)
    .split('\n')
    .filter((line) => !/^\s*emoji\s*:/i.test(line))
    .join('\n');
  return frontmatter + raw.slice(end);
}

const SKILL_QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'best', 'by', 'can', 'create', 'do', 'does', 'for', 'from',
  'get', 'how', 'i', 'in', 'into', 'is', 'it', 'list', 'me', 'my', 'of', 'on', 'or', 'please',
  'show', 'skill', 'skills', 'the', 'this', 'to', 'under', 'use', 'using', 'want', 'with',
]);

const SKILL_QUERY_ALIASES: Record<string, string[]> = {
  bug: ['debug', 'fix', 'repair', 'issue', 'broken', 'error', 'troubleshoot', 'regression'],
  fix: ['debug', 'repair', 'issue', 'broken', 'error', 'troubleshoot', 'bug'],
  debug: ['bug', 'fix', 'repair', 'issue', 'troubleshoot', 'error'],
  repair: ['fix', 'debug', 'issue', 'broken', 'regression'],
  issue: ['bug', 'fix', 'debug', 'problem', 'broken'],
  lead: ['lead-generation', 'leadgeneration', 'prospect', 'prospecting', 'outreach', 'local-lead', 'b2b'],
  generation: ['lead-generation', 'leadgeneration', 'prospecting', 'outreach'],
  leadgeneration: ['lead', 'lead-generation', 'prospecting', 'outreach', 'local-lead'],
  maps: ['map', 'google-maps', 'googlemaps', 'local', 'places'],
  google: ['google-maps', 'googlemaps', 'maps', 'local'],
  website: ['site', 'web', 'domain', 'landing-page', 'homepage'],
  analysis: ['analyze', 'audit', 'intelligence', 'research', 'inspect'],
  analyze: ['analysis', 'audit', 'intelligence', 'inspect'],
  source: ['src', 'code', 'self-edit', 'dev-source', 'repository'],
  src: ['source', 'code', 'self-edit', 'dev-source'],
  edit: ['editing', 'modify', 'change', 'patch', 'update'],
  mobile: ['web-ui', 'frontend', 'responsive', 'ios', 'app'],
  browser: ['web', 'page', 'dom', 'automation', 'click', 'screenshot'],
  desktop: ['window', 'app', 'screen', 'automation', 'click', 'screenshot'],
  automation: ['automate', 'workflow', 'playbook', 'browser', 'desktop'],
  screenshot: ['capture', 'screen', 'vision'],
  shopping: ['shop', 'buying', 'product', 'deal', 'price', 'commerce'],
  product: ['shopping', 'deal', 'price', 'buying', 'commerce'],
  research: ['analysis', 'analyze', 'investigate', 'compare', 'intelligence'],
  laptop: ['computer', 'pc', 'notebook'],
  gaming: ['game', 'gpu', 'performance'],
  video: ['creative', 'promo', 'social', 'motion', 'remotion', 'hyperframes'],
  promo: ['promotional', 'marketing', 'social', 'video'],
  hyperframes: ['hyperframe', 'hyper-frames', 'hyper', 'frames', 'video', 'creative'],
  hyperframe: ['hyperframes', 'hyper-frames', 'video', 'creative'],
  xpose: ['xpose-market', 'market', 'lead-generation', 'website-analysis'],
};

function normalizeSkillSearchText(value: any): string {
  return String(value || '')
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[\-_./]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function skillSearchTokens(value: any, opts: { expand?: boolean } = {}): Set<string> {
  const normalized = normalizeSkillSearchText(value);
  const rawTokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !SKILL_QUERY_STOPWORDS.has(token));
  const tokens = new Set<string>();
  const add = (token: string) => {
    const clean = normalizeSkillSearchText(token).replace(/\s+/g, '');
    if (clean.length >= 2 && !SKILL_QUERY_STOPWORDS.has(clean)) tokens.add(clean);
  };
  for (const token of rawTokens) {
    add(token);
    if (opts.expand) {
      for (const alias of SKILL_QUERY_ALIASES[token] || []) add(alias);
    }
  }
  for (let i = 0; i < rawTokens.length - 1; i++) {
    const joined = `${rawTokens[i]}${rawTokens[i + 1]}`;
    add(joined);
    if (opts.expand) {
      for (const alias of SKILL_QUERY_ALIASES[joined] || []) add(alias);
    }
  }
  const compact = normalized.replace(/\s+/g, '');
  if (compact.length >= 4) add(compact);
  return tokens;
}

function skillTokenMatches(queryToken: string, fieldTokens: Set<string>): boolean {
  if (fieldTokens.has(queryToken)) return true;
  if (queryToken.length < 4) return false;
  for (const fieldToken of fieldTokens) {
    if (fieldToken.length < 4) continue;
    if (fieldToken.includes(queryToken) || queryToken.includes(fieldToken)) return true;
  }
  return false;
}

function charNgrams(value: string, size = 3): Set<string> {
  const compact = normalizeSkillSearchText(value).replace(/\s+/g, '');
  const grams = new Set<string>();
  if (compact.length < size) {
    if (compact) grams.add(compact);
    return grams;
  }
  for (let i = 0; i <= compact.length - size; i++) grams.add(compact.slice(i, i + size));
  return grams;
}

function ngramSimilarity(left: string, right: string): number {
  const a = charNgrams(left);
  const b = charNgrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

type RankedSkill = {
  skill: any;
  score: number;
  confidence: 'strong' | 'weak';
  matchedTerms: string[];
  matchedFields: string[];
};

const SKILL_STRONG_MATCH_SCORE = 8;

function rankSkillForQuery(skill: any, query: string): RankedSkill {
  const queryTokens = skillSearchTokens(query, { expand: true });
  const queryNorm = normalizeSkillSearchText(query);
  const fields: Array<{ name: string; weight: number; values: any[] }> = [
    { name: 'id', weight: 12, values: [skill?.id] },
    { name: 'name', weight: 10, values: [skill?.name] },
    { name: 'triggers', weight: 8, values: Array.isArray(skill?.triggers) ? skill.triggers : [] },
    { name: 'categories', weight: 8, values: Array.isArray(skill?.categories) ? skill.categories : [] },
    { name: 'requiredTools', weight: 5, values: Array.isArray(skill?.requiredTools) ? skill.requiredTools : [] },
    { name: 'description', weight: 3, values: [skill?.description] },
  ];
  let score = 0;
  const matchedTerms = new Set<string>();
  const matchedFields = new Set<string>();
  const allFieldText: string[] = [];

  for (const field of fields) {
    const text = field.values.map((value) => String(value || '')).filter(Boolean).join(' ');
    if (!text) continue;
    allFieldText.push(text);
    const fieldNorm = normalizeSkillSearchText(text);
    const fieldTokens = skillSearchTokens(text);
    for (const queryToken of queryTokens) {
      if (skillTokenMatches(queryToken, fieldTokens)) {
        score += field.weight;
        matchedTerms.add(queryToken);
        matchedFields.add(field.name);
      }
    }
    if (queryNorm && fieldNorm.includes(queryNorm)) {
      score += field.weight * 4;
      matchedFields.add(field.name);
    }
  }

  if (queryNorm) {
    const fuzzy = ngramSimilarity(queryNorm, allFieldText.join(' '));
    if (fuzzy >= 0.08) score += Math.round(fuzzy * 20);
  }

  return {
    skill,
    score,
    confidence: score >= SKILL_STRONG_MATCH_SCORE ? 'strong' : 'weak',
    matchedTerms: Array.from(matchedTerms).slice(0, 8),
    matchedFields: Array.from(matchedFields).slice(0, 6),
  };
}

export function rankSkillsForQuery(skills: any[], query: string): RankedSkill[] {
  const q = String(query || '').trim();
  if (!q) {
    return skills.map((skill) => ({ skill, score: 0, confidence: 'strong', matchedTerms: [], matchedFields: [] }));
  }
  return skills
    .map((skill) => rankSkillForQuery(skill, q))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.skill?.id || '').localeCompare(String(b.skill?.id || ''));
    });
}

export function formatCompactSkillList(skills: any[], args: any): string {
  const query = String(args?.query || args?.q || '').trim().toLowerCase();
  const includeDescriptions = args?.include_descriptions === true || args?.includeDescriptions === true;
  const includeMatchDetails = args?.include_match_details === true || args?.includeMatchDetails === true;
  const requestedLimit = Math.floor(Number(args?.limit) || 24);
  const limit = Math.max(1, Math.min(80, requestedLimit));
  const ranked = query ? rankSkillsForQuery(skills, query) : skills.map((skill) => ({ skill, score: 0, confidence: 'strong' as const, matchedTerms: [], matchedFields: [] }));
  const strongCount = query ? ranked.filter((item) => item.confidence === 'strong').length : ranked.length;
  const weakCount = query ? ranked.length - strongCount : 0;
  const matched = ranked.map((item) => item.skill);
  const rows = ranked.slice(0, limit).map((rankedSkill) => {
    const s = rankedSkill.skill;
    const status = s.eligibility?.status && s.eligibility.status !== 'ready' ? ` [${s.eligibility.status}]` : '';
    const base = {
      id: String(s.id || ''),
      name: String(s.name || s.id || ''),
      status: status ? String(s.eligibility.status || '') : undefined,
      confidence: query ? rankedSkill.confidence : undefined,
      score: query ? rankedSkill.score : undefined,
      categories: Array.isArray(s.categories) ? s.categories.slice(0, 4) : undefined,
      requiredTools: Array.isArray(s.requiredTools) ? s.requiredTools.slice(0, 6) : undefined,
      description: includeDescriptions ? String(s.description || '').slice(0, 180) : undefined,
      matchedTerms: includeMatchDetails ? rankedSkill.matchedTerms : undefined,
      matchedFields: includeMatchDetails ? rankedSkill.matchedFields : undefined,
    };
    return Object.fromEntries(Object.entries(base).filter(([, value]) =>
      value !== undefined && (!Array.isArray(value) || value.length > 0)
    ));
  });
  return JSON.stringify({
    totalInstalled: skills.length,
    query: query || undefined,
    matchedCount: matched.length,
    strongMatchCount: query ? strongCount : undefined,
    weakMatchCount: query ? weakCount : undefined,
    returnedCount: rows.length,
    truncated: matched.length > rows.length,
    compact: !includeDescriptions,
    retrieval: query ? 'weighted token/alias OR match with weak candidates instead of exact full-query substring matching' : undefined,
    note: query && strongCount === 0 && weakCount > 0
      ? 'No strong matches. Returning weak candidates; try a shorter query or call skill_read on the most plausible candidate.'
      : 'Compact skill discovery. Natural task queries are matched across id/name/description/triggers/categories/requiredTools. Call skill_read(id) for one relevant skill.',
    skills: rows,
  }, null, 2);
}

export const skillsCapabilityExecutor: CapabilityExecutor = {
  id: 'skills',

  canHandle(name: string): boolean {
    return SKILL_TOOL_NAMES.has(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, deps, sessionId } = ctx;

    switch (name) {
      case 'skill_list': {
        deps.skillsManager.scanSkills();
        const all = deps.skillsManager.getAll();
        if (all.length === 0) {
          return { name, args, result: 'No skills installed yet. Use skill_create to save a new one.', error: false };
        }
        return {
          name, args,
          result: formatCompactSkillList(all, args),
          error: false,
        };
      }

      case 'skill_read': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) {
          return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        }
        activateSkillForSession(sessionId, skill.id);
        try {
          const content = stripSkillEmojiFrontmatter(fs.readFileSync(skill.filePath, 'utf-8'));
          const header = [
            `${skill.name} (${skill.id}) ${skill.kind === 'bundle' ? `v${skill.version} bundle` : 'simple skill'}`,
            skill.description ? `Description: ${skill.description}` : '',
            Array.isArray(skill.requiredTools) && skill.requiredTools.length ? `Required tools: ${skill.requiredTools.join(', ')}` : '',
            skill.status && skill.status !== 'ready' ? `Status: ${skill.status}` : '',
            skill.validation && !skill.validation.ok ? `Validation errors: ${skill.validation.errors.join('; ')}` : '',
          ].filter(Boolean).join('\n');

          // For bundle skills, inline the ENTIRE bundle this turn — SKILL.md plus
          // every bundled resource — and mark each resource active for the session.
          // Because they're activated, subsequent turns only show the [ACTIVE_SKILLS]
          // pointer instead of re-injecting the full bundle (one-time full load).
          let resourceBlock = '';
          if (skill.kind === 'bundle' && Array.isArray(skill.resources) && skill.resources.length) {
            const PER_RESOURCE_CAP = 8000;
            const TOTAL_CAP = 48000;
            const parts: string[] = ['', '', `Bundled resources (${skill.resources.length}) — full contents:`];
            let used = 0;
            const overflow: string[] = [];
            for (const r of skill.resources as any[]) {
              if (used >= TOTAL_CAP) { overflow.push(r.path); continue; }
              const res = deps.skillsManager.readResource(skillId, r.path, PER_RESOURCE_CAP);
              if (!res.ok) { overflow.push(r.path); continue; }
              activateSkillResourceForSession(sessionId, skill.id, res.path);
              used += (res.content || '').length;
              parts.push('', `--- ${r.path}${r.description ? ` (${r.description})` : ''}${res.truncated ? ' [truncated]' : ''} ---`, res.content);
            }
            if (overflow.length) {
              parts.push('', `Not inlined (over budget — read individually with skill_resource_read if needed): ${overflow.join(', ')}`);
            }
            resourceBlock = parts.join('\n');
          }

          return { name, args, result: `${header}\n\nInstructions:\n${content}${resourceBlock}`, error: false };
        } catch {
          return { name, args, result: `${skill.name} (${skillId})\n\n${skill.instructions}`, error: false };
        }
      }

      case 'skill_resource_list': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        const resources = deps.skillsManager.listResources(skillId);
        if (!resources.length) return { name, args, result: `Skill "${skill.id}" has no declared or discovered resources.`, error: false };
        const lines = resources.map((r: any) => {
          const size = Number.isFinite(Number(r.sizeBytes)) ? `, ${r.sizeBytes} bytes` : '';
          return `- ${r.path} (${r.type}${size})${r.description ? ` - ${r.description}` : ''}`;
        }).join('\n');
        return {
          name, args,
          result: `Resources for ${skill.name} (${skill.id}):\n${lines}\n\nRead one with skill_resource_read({"id":"${skill.id}","path":"<resource path>"}).`,
          error: false,
        };
      }

      case 'skill_resource_read': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required.', error: true };
        if (!resourcePath) return { name, args, result: 'ERROR: path is required.', error: true };
        const maxChars = args.max_chars ? Number(args.max_chars) : undefined;
        const result = deps.skillsManager.readResource(skillId, resourcePath, Number.isFinite(maxChars) ? maxChars : undefined);
        if (!result.ok) return { name, args, result: `skill_resource_read failed: ${result.error}`, error: true };
        const skill = deps.skillsManager.get(skillId);
        activateSkillForSession(sessionId, skill?.id || skillId);
        activateSkillResourceForSession(sessionId, skill?.id || skillId, result.path);
        return {
          name, args,
          result: `Resource ${skillId}/${result.path}${result.truncated ? ' (truncated)' : ''}:\n\n${result.content}`,
          error: false,
        };
      }

      case 'skill_import_bundle': {
        const source = String(args.source || args.url || args.path || '').trim();
        if (!source) return { name, args, result: 'skill_import_bundle: source is required (directory, .zip path, GitHub tree URL, or https URL to a .zip).', error: true };
        try {
          const imported = await deps.skillsManager.importBundles(source, {
            id: args.id ? String(args.id) : undefined,
            overwrite: args.overwrite === true,
          });
          const lines = imported.map((skill: any) =>
            `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources) - ${skill.description || skill.name}`
          ).join('\n');
          return {
            name, args,
            result: `Imported ${imported.length} skill${imported.length !== 1 ? 's' : ''}:\n${lines}\n\nUse skill_read("<id>") to inspect one.`,
            error: false,
          };
        } catch (importErr: any) {
          return { name, args, result: `skill_import_bundle failed: ${importErr.message}`, error: true };
        }
      }

      case 'skill_inspect': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required. Call skill_list first to see available skill IDs.', error: true };
        const inspection = deps.skillsManager.inspect(skillId);
        if (!inspection) return { name, args, result: `Skill "${skillId}" not found.`, error: true };
        return {
          name, args,
          result: JSON.stringify(inspection, null, 2),
          error: false,
        };
      }

      case 'skill_manifest_write': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'ERROR: id is required.', error: true };
        const manifestArg = args.manifest;
        const manifest = typeof manifestArg === 'string' ? parseJsonLike(manifestArg) : manifestArg;
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
          return { name, args, result: 'ERROR: manifest must be an object or JSON object string.', error: true };
        }
        try {
          const updated = deps.skillsManager.writeManifestOverlay(skillId, manifest, {
            changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : undefined,
            evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
            appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          });
          return {
            name, args,
            result: `Wrote manifest overlay for ${updated.name} (${updated.id}) at ${updated.overlayPath || '(overlay path unavailable)'}. Manifest source: ${updated.manifestSource}.`,
            error: false,
          };
        } catch (manifestErr: any) {
          return { name, args, result: `skill_manifest_write failed: ${manifestErr.message}`, error: true };
        }
      }

      case 'skill_create_bundle': {
        const scId = String(args.id || '').trim();
        const scName = String(args.name || '').trim();
        const scInstructions = String(args.instructions || '').trim();
        if (!scId) return { name, args, result: 'skill_create_bundle: id is required', error: true };
        if (!scName) return { name, args, result: 'skill_create_bundle: name is required', error: true };
        if (!scInstructions) return { name, args, result: 'skill_create_bundle: instructions is required', error: true };
        try {
          const skill = deps.skillsManager.createBundle({
            id: scId,
            name: scName,
            description: args.description ? String(args.description).trim() : '',
            instructions: scInstructions,
            version: args.version ? String(args.version) : undefined,
            triggers: splitCsv(args.triggers),
            categories: splitCsv(args.categories),
            requiredTools: splitCsv(args.requiredTools || args.required_tools),
            permissions: args.permissions && typeof args.permissions === 'object' ? args.permissions : undefined,
            resources: Array.isArray(args.resources) ? args.resources : [],
            overwrite: args.overwrite === true,
          });
          return {
            name, args,
            result: `Bundle skill "${skill.name}" created at ${skill.rootDir}. Resources: ${skill.resources.length}. Use skill_read("${skill.id}") to inspect it.`,
            error: false,
          };
        } catch (bundleErr: any) {
          return { name, args, result: `skill_create_bundle failed: ${bundleErr.message}`, error: true };
        }
      }

      case 'skill_resource_write': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        const content = String(args.content ?? '');
        if (!skillId) return { name, args, result: 'skill_resource_write: id is required', error: true };
        if (!resourcePath) return { name, args, result: 'skill_resource_write: path is required', error: true };
        try {
          const updated = deps.skillsManager.writeResource(skillId, resourcePath, content, {
            type: args.type ? String(args.type) : undefined,
            description: args.description ? String(args.description) : undefined,
            addToManifest: args.addToManifest !== false,
            change: {
              changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : undefined,
              evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
              appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
              reason: args.reason ? String(args.reason) : undefined,
            },
          });
          return {
            name, args,
            result: `Wrote ${resourcePath} in skill "${updated.id}". Resources now: ${updated.resources.length}.`,
            error: false,
          };
        } catch (resourceErr: any) {
          return { name, args, result: `skill_resource_write failed: ${resourceErr.message}`, error: true };
        }
      }

      case 'skill_resource_delete': {
        const skillId = String(args.id || args.skill_id || '').trim();
        const resourcePath = String(args.path || args.resource_path || '').trim();
        if (!skillId) return { name, args, result: 'skill_resource_delete: id is required', error: true };
        if (!resourcePath) return { name, args, result: 'skill_resource_delete: path is required', error: true };
        try {
          const updated = deps.skillsManager.deleteResource(skillId, resourcePath, {
            removeFromManifest: args.removeFromManifest !== false,
          });
          return {
            name, args,
            result: `Deleted ${resourcePath} from skill "${updated.id}". Resources now: ${updated.resources.length}.`,
            error: false,
          };
        } catch (deleteErr: any) {
          return { name, args, result: `skill_resource_delete failed: ${deleteErr.message}`, error: true };
        }
      }

      case 'skill_export_bundle': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_export_bundle: id is required', error: true };
        try {
          const exported = await deps.skillsManager.exportBundle(skillId, args.outputPath ? String(args.outputPath) : undefined);
          return {
            name, args,
            result: `Exported skill "${skillId}" to ${exported.path} (${exported.bytes} bytes).`,
            error: false,
          };
        } catch (exportErr: any) {
          return { name, args, result: `skill_export_bundle failed: ${exportErr.message}`, error: true };
        }
      }

      case 'skill_update_from_source': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_update_from_source: id is required', error: true };
        try {
          const updated = await deps.skillsManager.updateFromSource(skillId, { overwrite: args.overwrite !== false });
          const lines = updated.map((skill: any) => `- ${skill.id} (${skill.kind}, ${skill.resources.length} resources)`).join('\n');
          return {
            name, args,
            result: `Updated ${updated.length} skill${updated.length !== 1 ? 's' : ''} from stored source:\n${lines}`,
            error: false,
          };
        } catch (updateErr: any) {
          return { name, args, result: `skill_update_from_source failed: ${updateErr.message}`, error: true };
        }
      }

      case 'skill_create': {
        const scId = String(args.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const scName = String(args.name || '').trim();
        const scInstructions = String(args.instructions || '').trim();
        if (!scId) return { name, args, result: 'skill_create: id is required', error: true };
        if (!scName) return { name, args, result: 'skill_create: name is required', error: true };
        if (!scInstructions) return { name, args, result: 'skill_create: instructions is required', error: true };
        try {
          const scSkill = deps.skillsManager.createSkill({
            id: scId,
            name: scName,
            description: args.description ? String(args.description).trim() : '',
            triggers: splitCsv(args.triggers),
            instructions: scInstructions,
          });
          return {
            name, args,
            result: `Skill "${scSkill.name}" created at ${scSkill.filePath}.\nUse skill_read("${scSkill.id}") to verify it, or skill_list() to see all skills.`,
            error: false,
          };
        } catch (scErr: any) {
          return { name, args, result: `skill_create failed: ${scErr.message}`, error: true };
        }
      }

      case 'skill_audit_all': {
        deps.skillsManager.scanSkills();
        const scope = String(args.scope || 'all');
        const onlyProblems = args.onlyProblems !== false && args.only_problems !== false;
        const threshold = Number.isFinite(Number(args.threshold)) ? Number(args.threshold) : 80;
        const all = deps.skillsManager.getAll().filter((s: any) => skillMatchesScope(s, scope));
        const audits = all.map((s: any) => scoreSkillMetadata(s)).sort((a: SkillMetadataAudit, b: SkillMetadataAudit) => a.score - b.score);
        const flagged = audits.filter((a: SkillMetadataAudit) => a.score < threshold || a.issues.length > 0);
        const list = onlyProblems ? flagged : audits;
        const summary = {
          scope,
          totalScanned: all.length,
          flagged: flagged.length,
          threshold,
          avgScore: audits.length ? Math.round(audits.reduce((n: number, a: SkillMetadataAudit) => n + a.score, 0) / audits.length) : 100,
          skills: list.map((a: SkillMetadataAudit) => ({ id: a.id, name: a.name, score: a.score, issues: a.issues })),
        };
        return { name, args, result: JSON.stringify(summary, null, 2), error: false };
      }

      case 'skill_update_metadata': {
        const skillId = String(args.id || args.skill_id || '').trim();
        if (!skillId) return { name, args, result: 'skill_update_metadata: id is required', error: true };
        const skill = deps.skillsManager.get(skillId);
        if (!skill) return { name, args, result: `Skill "${skillId}" not found. Call skill_list to see available IDs.`, error: true };
        const manifest = buildMetadataManifest(skill, args);
        if (!manifest) {
          return { name, args, result: `skill_update_metadata: no metadata changes provided for "${skillId}" (pass description, triggers, addTriggers, removeTriggers, categories, requiredTools, lifecycle, or name).`, error: true };
        }
        try {
          const updated = deps.skillsManager.writeManifestOverlay(skillId, manifest, {
            changeType: args.changeType || args.change_type ? String(args.changeType || args.change_type) : 'metadata_update',
            evidence: Array.isArray(args.evidence) ? args.evidence.map((v: any) => String(v || '').trim()).filter(Boolean) : (args.evidence ? [String(args.evidence)] : undefined),
            appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          });
          const after = scoreSkillMetadata(updated);
          return {
            name, args,
            result: `Updated metadata for ${updated.name} (${updated.id}). Fields: ${Object.keys(manifest).join(', ')}. New quality score: ${after.score}${after.issues.length ? `, remaining issues: ${after.issues.join(', ')}` : ' (clean)'}.`,
            error: false,
          };
        } catch (metaErr: any) {
          return { name, args, result: `skill_update_metadata failed: ${metaErr.message}`, error: true };
        }
      }

      case 'skill_repair_metadata': {
        deps.skillsManager.scanSkills();
        const mode = String(args.mode || 'preview').trim().toLowerCase();
        const scope = String(args.scope || 'all');
        const ids = splitCsv(args.ids).map((s) => s.toLowerCase());
        const repairs = Array.isArray(args.repairs) ? args.repairs : [];
        if (mode === 'apply') {
          if (args.confirm !== true) {
            return { name, args, result: 'skill_repair_metadata: apply mode requires confirm:true. Run mode:"preview" first to inspect the proposed patch set.', error: true };
          }
          if (!repairs.length) {
            return { name, args, result: 'skill_repair_metadata: apply mode requires a repairs array of {id, description?, triggers?, categories?, requiredTools?, lifecycle?, name?} objects (typically the edited preview set).', error: true };
          }
          const applied: any[] = [];
          const failed: any[] = [];
          for (const r of repairs) {
            const rid = String(r?.id || '').trim();
            if (!rid) { failed.push({ id: rid, error: 'missing id' }); continue; }
            const sk = deps.skillsManager.get(rid);
            if (!sk) { failed.push({ id: rid, error: 'not found' }); continue; }
            const manifest = buildMetadataManifest(sk, r);
            if (!manifest) { failed.push({ id: rid, error: 'no changes' }); continue; }
            try {
              const updated = deps.skillsManager.writeManifestOverlay(rid, manifest, {
                changeType: 'metadata_repair',
                appliedBy: args.appliedBy || args.applied_by ? String(args.appliedBy || args.applied_by) : undefined,
                reason: args.reason ? String(args.reason) : 'bulk metadata repair',
              });
              applied.push({ id: updated.id, fields: Object.keys(manifest), score: scoreSkillMetadata(updated).score });
            } catch (e: any) {
              failed.push({ id: rid, error: e.message });
            }
          }
          return { name, args, result: JSON.stringify({ mode: 'apply', applied: applied.length, failed: failed.length, results: applied, errors: failed }, null, 2), error: false };
        }
        // preview mode: return the flagged skills as an editable repair template
        const threshold = Number.isFinite(Number(args.threshold)) ? Number(args.threshold) : 80;
        const all = deps.skillsManager.getAll().filter((s: any) => {
          if (ids.length) return ids.includes(String(s.id || '').toLowerCase());
          return skillMatchesScope(s, scope);
        });
        const flagged = all
          .map((s: any) => ({ skill: s, audit: scoreSkillMetadata(s) }))
          .filter(({ audit }: { skill: any; audit: SkillMetadataAudit }) => audit.score < threshold || audit.issues.length > 0)
          .sort((a: { skill: any; audit: SkillMetadataAudit }, b: { skill: any; audit: SkillMetadataAudit }) => a.audit.score - b.audit.score);
        const template = flagged.map(({ skill, audit }: { skill: any; audit: SkillMetadataAudit }) => ({
          id: audit.id,
          name: audit.name,
          score: audit.score,
          issues: audit.issues,
          currentDescription: audit.description,
          currentTriggers: audit.triggers,
          // Fill these in, then resend with mode:"apply", confirm:true, repairs:[...]
          description: '',
          triggers: '',
        }));
        return {
          name, args,
          result: `${JSON.stringify({ mode: 'preview', scope, flagged: template.length, threshold, repairs: template }, null, 2)}\n\nTo apply: edit description/triggers in each repair entry, then call skill_repair_metadata({mode:"apply", confirm:true, repairs:[...]}).`,
          error: false,
        };
      }

      default:
        return { name, args, result: `Unhandled skill tool: ${name}`, error: true };
    }
  },
};
