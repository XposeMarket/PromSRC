#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const home = os.homedir();
const sourceConfig = path.join(repoRoot, '.prometheus');
const sourceWorkspace = path.join(repoRoot, 'workspace');
const targetConfig = path.join(home, '.prometheus');
const targetWorkspace = path.join(home, 'workspace');
const backupRoot = path.join(home, '.prometheus-migration-backups', new Date().toISOString().replace(/[:.]/g, '-'));

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyMissing(src, dest) {
  if (!exists(src)) return { copied: 0, skipped: 0 };
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    let copied = 0;
    let skipped = 0;
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const result = copyMissing(path.join(src, entry.name), path.join(dest, entry.name));
      copied += result.copied;
      skipped += result.skipped;
    }
    return { copied, skipped };
  }
  if (exists(dest)) return { copied: 0, skipped: 1 };
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return { copied: 1, skipped: 0 };
}

function copyFullBackup(src, name) {
  if (!exists(src)) return null;
  const dest = path.join(backupRoot, name);
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true, force: true });
  return dest;
}

function updateWorkspacePath(configPath) {
  if (!exists(configPath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    data.workspace = { ...(data.workspace || {}), path: targetWorkspace };
    if (data.skills?.directory && path.resolve(String(data.skills.directory)).startsWith(repoRoot)) {
      data.skills = { ...data.skills, directory: path.join(targetWorkspace, 'skills') };
    }
    if (data.tools?.permissions?.files) {
      const files = data.tools.permissions.files;
      const allowed = Array.isArray(files.allowed_paths) ? files.allowed_paths : [];
      const rewritten = allowed.map((p) => {
        try {
          const resolved = path.resolve(String(p));
          if (resolved === sourceWorkspace || resolved.startsWith(sourceWorkspace + path.sep)) {
            return path.join(targetWorkspace, path.relative(sourceWorkspace, resolved));
          }
        } catch {}
        return p;
      });
      if (!rewritten.some((p) => path.resolve(String(p)) === path.resolve(targetWorkspace))) rewritten.push(targetWorkspace);
      files.allowed_paths = [...new Set(rewritten)];
    }
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    console.warn(`[migration] Could not rewrite ${configPath}: ${err?.message || err}`);
    return false;
  }
}

console.log('[migration] Prometheus local-data preservation migration');
console.log(`[migration] repo:      ${repoRoot}`);
console.log(`[migration] config ->  ${targetConfig}`);
console.log(`[migration] workspace -> ${targetWorkspace}`);

ensureDir(backupRoot);
const configBackup = copyFullBackup(sourceConfig, '.prometheus');
const workspaceBackup = copyFullBackup(sourceWorkspace, 'workspace');
if (configBackup) console.log(`[migration] backed up project config/runtime state to ${configBackup}`);
if (workspaceBackup) console.log(`[migration] backed up project workspace to ${workspaceBackup}`);

const configResult = copyMissing(sourceConfig, targetConfig);
const workspaceResult = copyMissing(sourceWorkspace, targetWorkspace);
console.log(`[migration] config files copied=${configResult.copied} existing-kept=${configResult.skipped}`);
console.log(`[migration] workspace files copied=${workspaceResult.copied} existing-kept=${workspaceResult.skipped}`);

updateWorkspacePath(path.join(targetConfig, 'config.json'));

// Current config resolution prefers a project-local .prometheus directory when
// one exists. Move it out of the checkout only after both a full backup and the
// home-scoped copy have succeeded. This makes the existing runtime fall back to
// ~/.prometheus without requiring a destructive source-tree cleanup.
if (exists(sourceConfig)) {
  const archived = path.join(backupRoot, '.prometheus-project-original');
  if (!exists(archived)) {
    fs.renameSync(sourceConfig, archived);
    console.log(`[migration] moved project-local .prometheus out of the repo to ${archived}`);
  }
}

const marker = path.join(targetConfig, '.local-data-outside-repo-v1');
ensureDir(targetConfig);
fs.writeFileSync(marker, JSON.stringify({
  migratedAt: new Date().toISOString(),
  repoRoot,
  targetConfig,
  targetWorkspace,
  backupRoot,
}, null, 2) + '\n', 'utf8');

console.log('[migration] complete');
console.log('[migration] IMPORTANT: do not delete the backup until Prometheus has restarted and your chats/workspace are confirmed present.');
