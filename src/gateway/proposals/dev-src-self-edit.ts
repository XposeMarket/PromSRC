import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolvePrometheusRoot, isPublicDistributionBuild } from '../../runtime/distribution.js';

export const DEV_SRC_SELF_EDIT_MODE = 'dev_src_self_edit' as const;
export const DEV_SRC_SELF_EDIT_REPAIR_MODE = 'dev_src_self_edit_repair' as const;

export interface ProposalFileBaseline {
  exists: boolean;
  sha256?: string;
}

export interface DevSrcSelfEditWorkspace {
  sandboxRoot: string;
  projectRoot: string;
  liveProjectRoot: string;
  liveFileBaselines: Record<string, ProposalFileBaseline>;
}

function normalizeProposalPath(rawPath: unknown): string {
  return String(rawPath || '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

function isSrcPath(normalizedPath: string): boolean {
  return normalizedPath.startsWith('src/');
}

function isWebUiPath(normalizedPath: string): boolean {
  return normalizedPath.startsWith('web-ui/');
}

function isDevSelfEditPath(normalizedPath: string): boolean {
  return isSrcPath(normalizedPath) || isWebUiPath(normalizedPath);
}

function generatedPublicWebUiPathForWebUiPath(normalizedPath: string): string | null {
  if (normalizedPath === 'web-ui/index.html') return 'generated/public-web-ui/index.html';
  if (normalizedPath.startsWith('web-ui/src/')) {
    return `generated/public-web-ui/static/${normalizedPath.slice('web-ui/src/'.length)}`;
  }
  return null;
}

function expandPromotionPaths(allowedFiles: string[]): string[] {
  const expanded: string[] = [];
  for (const rawPath of allowedFiles) {
    const normalizedPath = normalizeProposalPath(rawPath);
    if (!normalizedPath) continue;
    if (isDevSelfEditPath(normalizedPath)) expanded.push(normalizedPath);
    const generatedPath = generatedPublicWebUiPathForWebUiPath(normalizedPath);
    if (generatedPath) expanded.push(generatedPath);
  }
  return Array.from(new Set(expanded));
}

function ensureSafeSandboxPath(targetPath: string, liveProjectRoot: string): void {
  const sandboxBase = path.resolve(liveProjectRoot, '.prometheus', 'proposal-workspaces');
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(sandboxBase, resolvedTarget);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to operate outside proposal sandbox root: ${resolvedTarget}`);
  }
}

function hashFile(absPath: string): string | undefined {
  if (!fs.existsSync(absPath)) return undefined;
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) return undefined;
  const content = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function copyRootEntry(sourcePath: string, destPath: string): void {
  if (!fs.existsSync(sourcePath)) return;
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, destPath, { recursive: true, force: true });
    return;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
}

function linkNodeModules(liveProjectRoot: string, projectRoot: string): void {
  const liveNodeModules = path.join(liveProjectRoot, 'node_modules');
  if (!fs.existsSync(liveNodeModules)) return;
  const sandboxNodeModules = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(sandboxNodeModules)) return;
  fs.symlinkSync(
    liveNodeModules,
    sandboxNodeModules,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

export function proposalUsesDevSrcSelfEditMode(proposal: any): boolean {
  if (isPublicDistributionBuild()) return false;
  const affectedFiles = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles : [];
  const normalizedPaths = affectedFiles
    .map((file: any) => normalizeProposalPath(file?.path))
    .filter(Boolean);
  if (normalizedPaths.length === 0) return false;
  const allAllowed = normalizedPaths.every(isDevSelfEditPath);
  const hasSrc = normalizedPaths.some(isSrcPath);
  const hasWebUi = normalizedPaths.some(isWebUiPath);
  return allAllowed && (hasSrc || hasWebUi);
}

export function captureLiveSrcFileBaselines(
  liveProjectRoot: string,
  allowedFiles: string[],
): Record<string, ProposalFileBaseline> {
  const baselines: Record<string, ProposalFileBaseline> = {};
  for (const rawPath of expandPromotionPaths(allowedFiles)) {
    const normalizedPath = normalizeProposalPath(rawPath);
    if (!isDevSelfEditPath(normalizedPath) && !normalizedPath.startsWith('generated/public-web-ui/')) continue;
    const liveAbsPath = path.resolve(liveProjectRoot, normalizedPath);
    const rel = path.relative(liveProjectRoot, liveAbsPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Baseline path escapes project root: ${normalizedPath}`);
    }
    const sha256 = hashFile(liveAbsPath);
    baselines[normalizedPath] = sha256
      ? { exists: true, sha256 }
      : { exists: fs.existsSync(liveAbsPath) };
  }
  return baselines;
}

function prepareWorkspaceFromProjectRoot(
  proposalId: string,
  allowedFiles: string[],
  sourceProjectRoot: string,
  liveProjectRoot: string,
  captureLiveBaselines: boolean,
): DevSrcSelfEditWorkspace {
  const normalizedProposalId = String(proposalId || '').trim();
  if (!normalizedProposalId) throw new Error('proposalId is required');
  const sandboxRoot = path.resolve(liveProjectRoot, '.prometheus', 'proposal-workspaces', normalizedProposalId);
  ensureSafeSandboxPath(sandboxRoot, liveProjectRoot);
  fs.rmSync(sandboxRoot, { recursive: true, force: true });

  const projectRoot = path.join(sandboxRoot, 'repo');
  fs.mkdirSync(projectRoot, { recursive: true });

  const rootEntriesToCopy = [
    'package.json',
    'package-lock.json',
    '.npmrc',
    'src',
    'web-ui',
    'generated',
    'scripts',
  ];
  for (const entry of rootEntriesToCopy) {
    copyRootEntry(path.join(sourceProjectRoot, entry), path.join(projectRoot, entry));
  }

  const tsconfigFiles = fs.existsSync(sourceProjectRoot)
    ? fs.readdirSync(sourceProjectRoot).filter((entry) => /^tsconfig(\..+)?\.json$/i.test(entry))
    : [];
  for (const tsconfigFile of tsconfigFiles) {
    copyRootEntry(path.join(sourceProjectRoot, tsconfigFile), path.join(projectRoot, tsconfigFile));
  }

  linkNodeModules(liveProjectRoot, projectRoot);

  const baselines = captureLiveBaselines
    ? captureLiveSrcFileBaselines(liveProjectRoot, allowedFiles)
    : {};
  fs.writeFileSync(
    path.join(sandboxRoot, 'manifest.json'),
    JSON.stringify({
      proposalId: normalizedProposalId,
      mode: captureLiveBaselines ? DEV_SRC_SELF_EDIT_MODE : DEV_SRC_SELF_EDIT_REPAIR_MODE,
      projectRoot,
      liveProjectRoot,
      sourceProjectRoot: path.resolve(sourceProjectRoot),
      createdAt: Date.now(),
      allowedFiles: captureLiveBaselines
        ? Object.keys(baselines)
        : expandPromotionPaths(allowedFiles),
    }, null, 2),
    'utf-8',
  );

  return {
    sandboxRoot,
    projectRoot,
    liveProjectRoot,
    liveFileBaselines: baselines,
  };
}

export function prepareDevSrcSelfEditWorkspace(
  proposalId: string,
  allowedFiles: string[],
  liveProjectRoot: string = resolvePrometheusRoot(),
): DevSrcSelfEditWorkspace {
  return prepareWorkspaceFromProjectRoot(
    proposalId,
    allowedFiles,
    liveProjectRoot,
    liveProjectRoot,
    true,
  );
}

export function prepareDevSrcRepairWorkspace(
  proposalId: string,
  failedProjectRoot: string,
  allowedFiles: string[],
  liveProjectRoot: string = resolvePrometheusRoot(),
): DevSrcSelfEditWorkspace {
  const sourceProjectRoot = path.resolve(String(failedProjectRoot || '').trim());
  if (!sourceProjectRoot || !fs.existsSync(sourceProjectRoot)) {
    throw new Error(`Failed repair workspace source does not exist: ${failedProjectRoot || '(missing)'}`);
  }
  return prepareWorkspaceFromProjectRoot(
    proposalId,
    allowedFiles,
    sourceProjectRoot,
    liveProjectRoot,
    false,
  );
}

export function promoteDevSrcSelfEditWorkspace(opts: {
  projectRoot: string;
  liveProjectRoot: string;
  allowedFiles: string[];
  liveFileBaselines?: Record<string, ProposalFileBaseline>;
}): { promotedFiles: string[]; deletedFiles: string[] } {
  const projectRoot = path.resolve(opts.projectRoot);
  const liveProjectRoot = path.resolve(opts.liveProjectRoot);
  const allowedFiles = expandPromotionPaths(opts.allowedFiles || []);
  const baselines = opts.liveFileBaselines || {};
  const conflicts: string[] = [];
  const promotedFiles: string[] = [];
  const deletedFiles: string[] = [];

  for (const normalizedPath of allowedFiles) {
    const sandboxAbsPath = path.resolve(projectRoot, normalizedPath);
    const liveAbsPath = path.resolve(liveProjectRoot, normalizedPath);
    const sandboxRel = path.relative(projectRoot, sandboxAbsPath);
    const liveRel = path.relative(liveProjectRoot, liveAbsPath);
    if (sandboxRel.startsWith('..') || path.isAbsolute(sandboxRel)) {
      throw new Error(`Sandbox path escapes project root: ${normalizedPath}`);
    }
    if (liveRel.startsWith('..') || path.isAbsolute(liveRel)) {
      throw new Error(`Live path escapes project root: ${normalizedPath}`);
    }

    const sandboxHash = hashFile(sandboxAbsPath);
    const liveHash = hashFile(liveAbsPath);
    const liveExists = fs.existsSync(liveAbsPath);
    const baseline = baselines[normalizedPath];
    const liveChangedSinceSandbox =
      !!baseline
      && (baseline.exists !== liveExists || (baseline.sha256 || '') !== (liveHash || ''));
    const sandboxMatchesLive =
      (!!sandboxHash || !fs.existsSync(sandboxAbsPath))
      && (sandboxHash || '') === (liveHash || '')
      && fs.existsSync(sandboxAbsPath) === liveExists;
    if (liveChangedSinceSandbox && !sandboxMatchesLive) {
      conflicts.push(normalizedPath);
      continue;
    }

    if (sandboxHash) {
      fs.mkdirSync(path.dirname(liveAbsPath), { recursive: true });
      fs.copyFileSync(sandboxAbsPath, liveAbsPath);
      promotedFiles.push(normalizedPath);
      continue;
    }

    if (liveExists) {
      fs.unlinkSync(liveAbsPath);
      deletedFiles.push(normalizedPath);
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Promotion blocked because the live repo changed after the sandbox was created: ${conflicts.join(', ')}`,
    );
  }

  return { promotedFiles, deletedFiles };
}
