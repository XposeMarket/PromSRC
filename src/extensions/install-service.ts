import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { loadBundledExtensionDescriptors, resolveUserPluginsDir } from './loader.js';
import { parseExtensionDescriptor } from './schema.js';
import { reloadExtensions } from './reload.js';
import { EXTENSION_DESCRIPTOR_FILENAME } from './loader.js';

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface InstallUserPluginInput {
  manifest: unknown;
  /** Optional CommonJS runtime module source (index.js). */
  indexJs?: string;
}

export interface InstallUserPluginResult {
  id: string;
  dir: string;
  hadEntrypoint: boolean;
  reload: { connectors: number; tools: number };
}

function bundledIds(): Set<string> {
  return new Set(loadBundledExtensionDescriptors().map((d) => `${d.kind}:${d.id}`));
}

/**
 * Validate and write a user plugin to the writable plugins dir, then hot-reload
 * the extension system so it becomes live immediately. Throws on validation
 * failure so callers (the HTTP route) can surface a precise error.
 */
export function installUserPlugin(input: InstallUserPluginInput): InstallUserPluginResult {
  // Validate the manifest against the same schema bundled connectors use. The
  // sourcePath here is virtual — the descriptor isn't on disk yet.
  const descriptor = parseExtensionDescriptor(input.manifest, '(install)');

  const id = String(descriptor.id || '').trim();
  if (!SAFE_ID.test(id)) {
    throw new Error(
      `Invalid plugin id "${id}". Use 1-64 chars: lowercase letters, digits, dash, underscore.`,
    );
  }

  if (bundledIds().has(`${descriptor.kind}:${id}`)) {
    throw new Error(`"${descriptor.kind}:${id}" is a built-in extension and cannot be overwritten.`);
  }
  const pluginApi = String(descriptor.compatibility?.pluginApi || '1').trim();
  if (!/^(?:\^|~|>=)?1(?:\.\d+){0,2}$/.test(pluginApi)) {
    throw new Error(`Plugin "${id}" requires unsupported plugin API ${pluginApi}; this Prometheus build supports API 1.`);
  }

  const wantsEntrypoint = !!descriptor.runtime?.entrypoint;
  if (wantsEntrypoint && !input.indexJs) {
    throw new Error(
      `Manifest declares runtime.entrypoint but no index.js source was provided.`,
    );
  }

  const userDir = resolveUserPluginsDir();
  fs.mkdirSync(userDir, { recursive: true });
  const pluginDir = path.join(userDir, id);
  const stagingRoot = path.join(path.dirname(userDir), 'user-plugin-staging');
  const stagingDir = path.join(stagingRoot, `${id}-${randomUUID()}`);
  const backupDir = path.join(stagingRoot, `${id}-backup-${randomUUID()}`);
  fs.mkdirSync(stagingDir, { recursive: true });

  fs.writeFileSync(
    path.join(stagingDir, EXTENSION_DESCRIPTOR_FILENAME),
    JSON.stringify(input.manifest, null, 2),
    'utf-8',
  );

  let hadEntrypoint = false;
  if (input.indexJs) {
    const entryName = descriptor.runtime?.entrypoint
      ? path.basename(descriptor.runtime.entrypoint)
      : 'index.js';
    fs.writeFileSync(path.join(stagingDir, entryName), input.indexJs, 'utf-8');
    hadEntrypoint = true;
  }
  // Re-read staged content through the production validator before promotion.
  parseExtensionDescriptor(JSON.parse(fs.readFileSync(path.join(stagingDir, EXTENSION_DESCRIPTOR_FILENAME), 'utf8')), path.join(stagingDir, EXTENSION_DESCRIPTOR_FILENAME));
  let backedUp = false;
  try {
    if (fs.existsSync(pluginDir)) { fs.renameSync(pluginDir, backupDir); backedUp = true; }
    fs.renameSync(stagingDir, pluginDir);
    const reload = reloadExtensions();
    if (backedUp && fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
    return { id, dir: pluginDir, hadEntrypoint, reload };
  } catch (error) {
    try { if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true }); } catch {}
    try { if (backedUp && fs.existsSync(backupDir)) fs.renameSync(backupDir, pluginDir); } catch {}
    try { if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    try { reloadExtensions(); } catch {}
    throw error;
  }
}

export interface RemoveUserPluginResult {
  id: string;
  removed: boolean;
  reload: { connectors: number; tools: number };
}

/**
 * Remove a user-installed plugin. Bundled extensions live in the read-only app
 * bundle and are never touched here.
 */
export function removeUserPlugin(id: string): RemoveUserPluginResult {
  const safeId = String(id || '').trim();
  if (!SAFE_ID.test(safeId)) {
    throw new Error(`Invalid plugin id "${id}".`);
  }

  const pluginDir = path.join(resolveUserPluginsDir(), safeId);
  let removed = false;
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    removed = true;
  }

  const reload = reloadExtensions();
  return { id: safeId, removed, reload };
}

export interface UserPluginSummary {
  id: string;
  kind: string;
  name: string;
  hasEntrypoint: boolean;
}

/** List installed user plugins (for the Connections "manage" surface). */
export function listUserPlugins(): UserPluginSummary[] {
  const userDir = resolveUserPluginsDir();
  if (!fs.existsSync(userDir)) return [];
  const out: UserPluginSummary[] = [];
  for (const entry of fs.readdirSync(userDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(userDir, entry.name, EXTENSION_DESCRIPTOR_FILENAME);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const descriptor = parseExtensionDescriptor(raw, manifestPath);
      out.push({
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        hasEntrypoint: !!descriptor.runtime?.entrypoint,
      });
    } catch {
      // skip malformed
    }
  }
  return out;
}
