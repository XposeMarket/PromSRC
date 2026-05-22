import fs from 'fs';
import path from 'path';
import {
  canReadSkillResource,
  loadSkillPackage,
  sanitizeSkillId,
  type LoadedSkillPackage,
  type SkillManifest,
  type SkillPermissions,
} from './skill-package';
import { scanSkillDirectory, type SkillSafetyScan } from './skill-safety';

export type SkillImportSourceKind = 'prometheus' | 'codex' | 'hermes' | 'openclaw' | 'generic' | 'unknown';
export type SkillImportAuditStatus = 'ready' | 'needs_changes' | 'blocked';
export type SkillImportFindingSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface SkillImportFinding {
  severity: SkillImportFindingSeverity;
  code: string;
  message: string;
  path?: string;
  suggestedChange?: string;
}

export interface SkillImportPatch {
  kind: 'manifest_overlay' | 'manual_review';
  path?: string;
  description: string;
  safeToApply: boolean;
  manifest?: Record<string, unknown>;
}

export interface SkillImportAudit {
  schemaVersion: 'prometheus-skill-import-audit-v1';
  auditedAt: string;
  source: string;
  sourceKind: SkillImportSourceKind;
  status: SkillImportAuditStatus;
  skillId: string;
  rootName: string;
  summary: string;
  safety: SkillSafetyScan;
  findings: SkillImportFinding[];
  proposedPatches: SkillImportPatch[];
  manifestOverlay?: Record<string, unknown>;
}

const PROMETHEUS_SCHEMA = 'prometheus-skill-bundle-v1';

const KNOWN_EXTERNAL_TOOL_MAP: Array<{
  ecosystem: SkillImportSourceKind;
  pattern: RegExp;
  prometheusHint: string;
}> = [
  {
    ecosystem: 'hermes',
    pattern: /\b(hermes[._-]?(browser|shell|desktop|agent|tool)|Hermes Agent)\b/i,
    prometheusHint: 'Rewrite Hermes-specific tool calls into Prometheus Browser, shell, desktop, or skill workflow guidance.',
  },
  {
    ecosystem: 'openclaw',
    pattern: /\b(openclaw|claw[._-]?(browser|shell|agent|tool))\b/i,
    prometheusHint: 'Rewrite OpenClaw-specific tool calls into Prometheus tool and skill workflow guidance.',
  },
  {
    ecosystem: 'codex',
    pattern: /\b(Codex|apply_patch|commentary channel|analysis channel|developer instructions)\b/i,
    prometheusHint: 'Keep useful Codex workflow guidance, but make tool names and channel assumptions explicit for Prometheus.',
  },
];

function readTextFiles(rootDir: string, maxFiles = 80, maxBytes = 512_000): Array<{ rel: string; text: string }> {
  const root = path.resolve(rootDir);
  const stack = [root];
  const out: Array<{ rel: string; text: string }> = [];
  while (stack.length && out.length < maxFiles) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.history') continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (path.basename(rel).toLowerCase() !== 'skill.json' && !canReadSkillResource(rel)) continue;
      try {
        if (fs.statSync(abs).size > maxBytes) continue;
        out.push({ rel, text: fs.readFileSync(abs, 'utf-8') });
      } catch {}
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

function detectSourceKind(rootDir: string, pkg: LoadedSkillPackage | null, source: string): SkillImportSourceKind {
  const manifest = pkg?.manifest || {};
  const schema = String((manifest as SkillManifest).schemaVersion || '').toLowerCase();
  const sourceText = source.toLowerCase();
  if (pkg?.manifestSource !== 'frontmatter' && schema === PROMETHEUS_SCHEMA) return 'prometheus';
  if (sourceText.includes('hermes')) return 'hermes';
  if (sourceText.includes('openclaw') || sourceText.includes('open-claw')) return 'openclaw';

  const joined = readTextFiles(rootDir, 24).map((item) => item.text).join('\n\n').slice(0, 200_000);
  if (/\bHermes Agent\b|\bhermes[._-]?(browser|shell|agent|tool)\b/i.test(joined)) return 'hermes';
  if (/\bopenclaw\b|\bclaw[._-]?(browser|shell|agent|tool)\b/i.test(joined)) return 'openclaw';
  if (/\bCodex\b|\bSKILL\.md\b|\bapply_patch\b|\bdeveloper instructions\b/i.test(joined)) return 'codex';
  if (pkg?.kind === 'simple') return 'generic';
  return 'unknown';
}

function inferPermissions(pkg: LoadedSkillPackage | null, textCorpus: string): SkillPermissions {
  const current = pkg?.permissions || {};
  return {
    workspaceRead: current.workspaceRead !== false,
    workspaceWrite: current.workspaceWrite === true || /\b(apply_patch|writeResource|workspaceWrite|edit files?|modify files?)\b/i.test(textCorpus),
    shell: current.shell === true || /\b(shell|powershell|bash|terminal|npm |pnpm |yarn |python |node |git )\b/i.test(textCorpus),
    browser: current.browser === true || /\b(browser|playwright|localhost|web page|screenshot|navigate)\b/i.test(textCorpus),
    desktop: current.desktop === true || /\b(desktop|electron|window|click|type into)\b/i.test(textCorpus),
    externalSideEffects: current.externalSideEffects === true || /\b(push|publish|send email|post to|upload|deploy|external side effect)\b/i.test(textCorpus),
  };
}

function inferCategories(pkg: LoadedSkillPackage | null, sourceKind: SkillImportSourceKind): string[] {
  const categories = new Set((pkg?.categories || []).map((item) => item.toLowerCase()));
  categories.add('imported');
  if (sourceKind !== 'prometheus' && sourceKind !== 'unknown') categories.add(sourceKind);
  return [...categories].sort();
}

function inferTriggers(pkg: LoadedSkillPackage | null): string[] {
  const triggers = new Set((pkg?.triggers || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
  const name = String(pkg?.name || pkg?.id || '').trim().toLowerCase();
  if (name && triggers.size === 0) triggers.add(name);
  return [...triggers].slice(0, 12);
}

function buildManifestOverlay(params: {
  pkg: LoadedSkillPackage | null;
  rootDir: string;
  fallbackId?: string;
  sourceKind: SkillImportSourceKind;
  textCorpus: string;
  status: SkillImportAuditStatus;
}): Record<string, unknown> {
  const id = sanitizeSkillId(params.fallbackId || params.pkg?.id || path.basename(params.rootDir));
  const manifest = params.pkg?.manifest;
  const entrypoint = params.pkg?.entrypoint || (fs.existsSync(path.join(params.rootDir, 'skill.md')) ? 'skill.md' : 'SKILL.md');
  const permissions = inferPermissions(params.pkg, params.textCorpus);
  const requires = {
    ...(manifest?.requires || {}),
    permissions: Object.entries(permissions)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => key),
  };

  return {
    schemaVersion: PROMETHEUS_SCHEMA,
    id,
    name: params.pkg?.name || id,
    description: params.pkg?.description || `Imported ${params.sourceKind} skill.`,
    version: params.pkg?.version && params.pkg.version !== '0.0.0' ? params.pkg.version : '1.0.0',
    entrypoint,
    triggers: inferTriggers(params.pkg),
    categories: inferCategories(params.pkg, params.sourceKind),
    requiredTools: params.pkg?.requiredTools || [],
    requires,
    assignment: manifest?.assignment,
    toolBinding: manifest?.toolBinding,
    permissions,
    resources: params.pkg?.resources || [],
    status: params.status === 'blocked' ? 'blocked' : 'ready',
    lifecycle: params.sourceKind === 'prometheus' ? (manifest?.lifecycle || 'active') : 'experimental',
    ownership: params.sourceKind === 'prometheus' ? 'imported' : 'prometheus-owned-overlay',
    executionEnabled: params.status !== 'blocked',
    riskLevel: params.status === 'ready' ? 'low' : params.status === 'blocked' ? 'high' : 'medium',
  };
}

export function auditSkillImport(rootDir: string, params: { source: string; fallbackId?: string }): SkillImportAudit {
  const pkg = loadSkillPackage(rootDir, params.fallbackId || path.basename(rootDir));
  const safety = scanSkillDirectory(rootDir);
  const textFiles = readTextFiles(rootDir);
  const textCorpus = textFiles.map((item) => item.text).join('\n\n').slice(0, 300_000);
  const sourceKind = detectSourceKind(rootDir, pkg, params.source);
  const findings: SkillImportFinding[] = [];

  if (!pkg) {
    findings.push({
      severity: 'critical',
      code: 'missing-skill-entrypoint',
      message: 'No skill.json, SKILL.md, or skill.md entrypoint was found.',
      suggestedChange: 'Add a Prometheus-compatible SKILL.md or skill.json before importing.',
    });
  } else {
    for (const warning of pkg.validation.warnings) {
      findings.push({ severity: 'warn', code: 'package-validation-warning', message: warning });
    }
    for (const error of pkg.validation.errors) {
      findings.push({ severity: 'error', code: 'package-validation-error', message: error });
    }
    if (pkg.manifest.schemaVersion !== PROMETHEUS_SCHEMA) {
      findings.push({
        severity: 'info',
        code: 'manifest-normalization',
        message: 'Skill metadata will be normalized through a Prometheus manifest overlay.',
        path: pkg.manifestPath ? path.relative(rootDir, pkg.manifestPath).replace(/\\/g, '/') : undefined,
        suggestedChange: 'Keep upstream metadata intact and add Prometheus-specific compatibility fields in an overlay.',
      });
    }
    if (!pkg.triggers.length) {
      findings.push({
        severity: 'warn',
        code: 'missing-triggers',
        message: 'Skill has no trigger phrases, which can make automatic discovery unreliable.',
        suggestedChange: 'Add concise task phrases to triggers.',
      });
    }
  }

  for (const finding of safety.findings) {
    findings.push({
      severity: finding.severity === 'critical' ? 'critical' : finding.severity === 'warn' ? 'warn' : 'info',
      code: `safety-${finding.id}`,
      message: finding.message,
      path: finding.file,
      suggestedChange: finding.severity === 'critical'
        ? 'Review or remove this instruction before enabling the skill.'
        : 'Review this instruction before relying on the skill.',
    });
  }

  for (const item of textFiles) {
    for (const rule of KNOWN_EXTERNAL_TOOL_MAP) {
      if (!rule.pattern.test(item.text)) continue;
      findings.push({
        severity: rule.ecosystem === sourceKind ? 'warn' : 'info',
        code: `external-${rule.ecosystem}-tool-reference`,
        message: `Skill references ${rule.ecosystem} conventions that may not map directly to Prometheus.`,
        path: item.rel,
        suggestedChange: rule.prometheusHint,
      });
    }
  }

  const hasCritical = findings.some((finding) => finding.severity === 'critical');
  const hasErrors = findings.some((finding) => finding.severity === 'error');
  const hasWarnings = findings.some((finding) => finding.severity === 'warn');
  const status: SkillImportAuditStatus = hasCritical || hasErrors || safety.verdict === 'critical'
    ? 'blocked'
    : hasWarnings || sourceKind !== 'prometheus'
      ? 'needs_changes'
      : 'ready';

  const manifestOverlay = pkg
    ? buildManifestOverlay({
      pkg,
      rootDir,
      fallbackId: params.fallbackId,
      sourceKind,
      textCorpus,
      status,
    })
    : undefined;

  const proposedPatches: SkillImportPatch[] = [];
  if (manifestOverlay) {
    proposedPatches.push({
      kind: 'manifest_overlay',
      description: 'Add a Prometheus compatibility overlay with normalized metadata, permissions, requirements, lifecycle, and resources.',
      safeToApply: status !== 'blocked',
      manifest: manifestOverlay,
    });
  }
  for (const finding of findings.filter((item) => item.severity === 'warn' || item.severity === 'error' || item.severity === 'critical')) {
    proposedPatches.push({
      kind: 'manual_review',
      path: finding.path,
      description: `${finding.code}: ${finding.suggestedChange || finding.message}`,
      safeToApply: false,
    });
  }

  const skillId = sanitizeSkillId(String(manifestOverlay?.id || params.fallbackId || pkg?.id || path.basename(rootDir)));
  return {
    schemaVersion: 'prometheus-skill-import-audit-v1',
    auditedAt: new Date().toISOString(),
    source: params.source,
    sourceKind,
    status,
    skillId,
    rootName: path.basename(rootDir),
    summary: status === 'ready'
      ? 'Skill appears Prometheus-compatible.'
      : status === 'blocked'
        ? 'Skill import is blocked until critical compatibility or safety findings are addressed.'
        : 'Skill can be imported with Prometheus compatibility metadata, but some guidance should be reviewed.',
    safety,
    findings,
    proposedPatches,
    manifestOverlay,
  };
}
