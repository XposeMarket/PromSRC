import fs from 'fs';
import path from 'path';
import { getPrometheusLayout } from './storage-layout.js';

function copyFileMissing(source: string, target: string): void {
  try {
    if (!fs.existsSync(source) || fs.existsSync(target)) return;
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  } catch {}
}

function copyTreeMissing(source: string, target: string): void {
  try {
    if (!fs.existsSync(source)) return;
    const rootStat = fs.lstatSync(source);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const src = path.join(source, entry.name);
      const dest = path.join(target, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) copyTreeMissing(src, dest);
      else if (entry.isFile()) copyFileMissing(src, dest);
    }
  } catch {}
}

export function getAuditStateRoot(workspacePath: string): string {
  const layout = getPrometheusLayout();
  if (layout.mode === 'legacy') return path.join(workspacePath, 'audit');
  copyTreeMissing(path.join(workspacePath, 'audit'), layout.runtime.audit);
  return layout.runtime.audit;
}

export function getBrainArtifactRoot(workspacePath: string): string {
  return path.join(workspacePath, 'Brain');
}

export function getBrainStateRoot(workspacePath: string): string {
  const layout = getPrometheusLayout();
  if (layout.mode === 'legacy') return path.join(getBrainArtifactRoot(workspacePath), 'state');
  copyTreeMissing(path.join(getBrainArtifactRoot(workspacePath), 'state'), layout.runtime.brainState);
  return layout.runtime.brainState;
}

export function getBootRunStatePath(workspacePath: string): string {
  const layout = getPrometheusLayout();
  const legacy = path.join(workspacePath, '.prometheus', 'boot-md-state.json');
  if (layout.mode === 'legacy') return legacy;
  const target = path.join(layout.runtime.boot, 'boot-md-state.json');
  copyFileMissing(legacy, target);
  return target;
}

export function getBrowserKnowledgeRoot(configDir: string): string {
  const layout = getPrometheusLayout();
  if (layout.mode === 'legacy') return path.join(configDir, 'browser-knowledge');
  const target = path.join(layout.runtime.browser, 'knowledge');
  const legacy = path.join(layout.legacy.activeConfig, 'browser-knowledge');
  copyTreeMissing(legacy, target);
  return target;
}
