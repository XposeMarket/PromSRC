/**
 * skills-manager.ts
 *
 * Skills are either simple SKILL.md playbooks or bundled skill packages with
 * skill.json, an entrypoint markdown file, and optional static resources.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  getSkillOverlayPath,
  getSkillProvenancePath,
  loadSkillPackage,
  normalizeSkillRelativePathForWrite,
  readSkillResourceText,
  resolveSkillRelativePath,
  sanitizeSkillId,
  canReadSkillResource,
  type LoadedSkillPackage,
  type SkillPermissions,
  type SkillResource,
  type SkillLifecycleState,
  type SkillOwnershipState,
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
  eligibility: SkillEligibility;
  safety: SkillSafetyScan;
  lifecycle: SkillLifecycleState;
  ownership: SkillOwnershipState;
  executionEnabled: boolean;
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
    if (normalizedTrigger.length < 5 || normalizedWord.length < 5) return false;
    return normalizedWord.startsWith(normalizedTrigger) || normalizedTrigger.startsWith(normalizedWord);
  });
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
    const text = `${toolName || ''} ${messageText || ''}`.toLowerCase();
    const words = text.split(/\W+/).filter(Boolean);
    const matches: string[] = [];
    for (const skill of this.skills.values()) {
      if (skill.triggers.length === 0) continue;
      if (skill.triggers.some(t => skillTriggerMatchesText(t, text, words))) {
        matches.push(skill.id);
      }
    }
    return matches;
  }

  findMatchingSkillsForMessage(messageText: string): string[] {
    const text = String(messageText || '').toLowerCase();
    const words = text.split(/\W+/).filter(w => w.length > 2);
    const matches: string[] = [];
    for (const skill of this.skills.values()) {
      if (skill.triggers.length === 0) continue;
      if (skill.triggers.some(t => skillTriggerMatchesText(t, text, words))) {
        matches.push(skill.id);
      }
    }
    return matches;
  }

  createSkill(data: {
    id: string;
    name: string;
    description: string;
    emoji?: string;
    triggers?: string[];
    instructions: string;
  }): Skill {
    const id = sanitizeSkillId(data.id);
    if (!id) throw new Error('Invalid skill ID');

    const skillDir = path.join(this.skillsDir, id);
    fs.mkdirSync(skillDir, { recursive: true });

    const lines = [
      '---',
      `name: ${data.name}`,
      `description: ${data.description}`,
      'version: 1.0.0',
    ];
    if (data.triggers?.length) {
      lines.push(`triggers: ${data.triggers.join(', ')}`);
    }
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
    resources?: Array<{ path: string; content: string; type?: string; description?: string }>;
    overwrite?: boolean;
  }): Skill {
    const id = sanitizeSkillId(data.id);
    if (!id) throw new Error('Invalid skill ID');
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
      triggers: data.triggers || [],
      categories: data.categories || [],
      requiredTools: data.requiredTools || [],
      requires: data.requires,
      assignment: data.assignment,
      toolBinding: data.toolBinding,
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

  async importBundle(source: string, options?: { id?: string; overwrite?: boolean }): Promise<Skill> {
    const installed = await this.importBundles(source, options);
    if (installed.length !== 1) {
      throw new Error(`Expected one skill bundle but found ${installed.length}. Leave id unset and use collection import semantics.`);
    }
    return installed[0];
  }

  async importBundles(source: string, options?: { id?: string; overwrite?: boolean }): Promise<Skill[]> {
    const sourceText = String(source || '').trim();
    if (!sourceText) throw new Error('source is required');
    const overwrite = options?.overwrite === true;
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
        });
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
      const parts = [
        `${s.id}`,
        s.kind === 'bundle' ? `v${s.version} [bundle: ${s.resources.length} resources]` : '[simple]',
        s.requiredTools.length ? `[tools: ${s.requiredTools.join(',')}]` : '',
        s.toolBinding?.recommendedToolCategories?.length ? `[tool-cats: ${s.toolBinding.recommendedToolCategories.join(',')}]` : '',
        s.assignment?.preferredAgent ? `[agent: ${s.assignment.preferredAgent}]` : '',
        s.eligibility.status !== 'ready' ? `[${s.eligibility.status}: ${s.eligibility.reasons.join('; ').slice(0, 120)}]` : '',
        s.triggers.length ? `[triggers: ${s.triggers.join(',')}]` : '',
        `- ${s.description.slice(0, 100) || '(no description)'}`,
      ].filter(Boolean);
      return parts.join(' ');
    }).join('\n');
  }

  buildTurnContext(_messageText: string, _maxCharsPerSkill = 3000): string {
    const all = this.getAll();
    if (!all.length) return '';
    const matchedSkills = this.findMatchingSkillsForMessage(_messageText)
      .map((id) => this.get(id))
      .filter((skill): skill is Skill => !!skill)
      .slice(0, 5);
    const matchedBlock = matchedSkills.length
      ? (
        `\n\n[MATCHING_SKILLS]\n` +
        `The user's message matches skill trigger metadata. These skills are not active instructions yet; if one is relevant, call skill_read(id) before acting.\n` +
        matchedSkills.map((s) => {
          const triggerPreview = s.triggers.length ? ` [triggers: ${s.triggers.slice(0, 6).join(', ')}]` : '';
          return `- ${s.id}${triggerPreview} - ${s.description.slice(0, 140) || s.name}`;
        }).join('\n')
      )
      : '';

    return (
      `[SKILLS] You have ${all.length} reusable skill playbook${all.length !== 1 ? 's' : ''}.\n` +
      `For greetings, small talk, quick Q&A, or confirmations: respond directly - do NOT call skill_list.\n` +
      `Before browser/desktop automation, file edits, or other execution-heavy work: call skill_list first.\n` +
      `If a relevant skill exists, call skill_read(id) and follow it before acting.\n` +
      `If a skill declares toolBinding metadata, treat requiredTools and defaultWorkflow as the expected operating contract; activate missing tool categories before using the workflow.\n` +
      `If a skill declares assignment.preferredAgent or assignedAgents/assignedTeams, consider routing substantial work to that agent/team when the task matches.\n` +
      `During and after real work, treat skills as living workflow playbooks: notice missing triggers, clearer steps, better tool order, reusable examples, templates, guardrails, and resources that would make the skill more useful next time.\n` +
      `When a completed workflow seems reusable but no skill fit, briefly offer to turn it into a skill or record it as a candidate; do not interrupt casual conversation with skill maintenance chatter.\n` +
      `For bundled skill templates/examples/schemas/references, use skill_resource_list(id) and skill_resource_read(id,path), loading only the specific resource needed.\n` +
      `Use skill_inspect(id) for normalized metadata/provenance, and skill_manifest_write(id,manifest) to enrich imported skills with overlays.\n` +
      `Use skill_import_bundle(source) for directory/zip/GitHub skill bundles; skill_update_from_source(id) to refresh imported bundles; skill_export_bundle(id) to package one.\n` +
      `Use skill_create_bundle for reusable workflows that need templates/schemas/examples/references; skill_resource_write/delete to maintain bundle resources; use skill_create only for simple one-file playbooks.\n` +
      `skill_list, skill_read, skill_resource_list, skill_resource_read, skill_import_bundle, skill_inspect, skill_manifest_write, skill_create_bundle, skill_resource_write, skill_resource_delete, skill_export_bundle, skill_update_from_source, and skill_create are core tools.\n` +
      `Save new reusable workflows with skill_create_bundle when resources or rich metadata would help.` +
      matchedBlock
    );
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
