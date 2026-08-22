import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPrometheusLayout } from '../runtime/storage-layout.js';

function safeReadDirs(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e && typeof e.isDirectory === 'function' && e.isDirectory())
      .map((e) => String(e.name || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function sanitizeSkillId(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'skill';
}

function copyLegacySkillsIfNeeded(projectRoot: string, legacyRoot: string): void {
  try {
    if (path.resolve(projectRoot) === path.resolve(legacyRoot)) return;
    const projectEntries = safeReadDirs(projectRoot);
    if (projectEntries.length > 0) return;
    const legacyEntries = safeReadDirs(legacyRoot);
    if (!legacyEntries.length) return;
    fs.mkdirSync(projectRoot, { recursive: true });
    for (const slug of legacyEntries) {
      const src = path.join(legacyRoot, slug);
      const dest = path.join(projectRoot, slug);
      if (fs.existsSync(dest)) continue;
      try {
        fs.cpSync(src, dest, { recursive: true, force: false });
      } catch {
        // Ignore per-skill copy failures to avoid blocking startup.
      }
    }
  } catch {
    // best-effort legacy migration only
  }
}

function getLegacyPrometheusConfigBase(): string {
  // Preserve the pre-layout-v2 skill/plugin root behavior while legacy mode is
  // active: Electron/Docker use DATA_DIR/.prometheus and source runs use the
  // checkout-local .prometheus directory.
  return process.env.PROMETHEUS_DATA_DIR
    ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus')
    : path.join(process.cwd(), '.prometheus');
}

export function resolveSkillsRoot(): string {
  const layout = getPrometheusLayout();
  const root = layout.mode === 'canonical'
    ? layout.workspace.skills
    : path.join(getLegacyPrometheusConfigBase(), 'skills');

  fs.mkdirSync(root, { recursive: true });

  // Layout-v2 migration owns canonical copies. Keep the old best-effort home
  // import only in legacy mode so startup never races the verified migration.
  if (layout.mode === 'legacy') {
    copyLegacySkillsIfNeeded(root, path.join(os.homedir(), '.prometheus', 'skills'));
  }
  return root;
}

export function resolveSkillDir(skillId: string): string {
  return path.join(resolveSkillsRoot(), sanitizeSkillId(skillId));
}

export function resolveSkillInstallStateFile(): string {
  const layout = getPrometheusLayout();
  if (layout.mode === 'canonical') {
    return path.join(layout.runtime.config, 'skills', 'lock.json');
  }
  return path.join(getLegacyPrometheusConfigBase(), 'skill-state', 'lock.json');
}

// Compatibility export for callers that still use the older generic name.
export function resolveSkillLockFile(): string {
  return resolveSkillInstallStateFile();
}

export function ensureSkillsRoot(): string {
  const root = resolveSkillsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function listSkillIds(): string[] {
  return safeReadDirs(resolveSkillsRoot()).map(sanitizeSkillId).filter(Boolean).sort();
}

export function normalizeSkillId(input: string): string {
  return sanitizeSkillId(input);
}
