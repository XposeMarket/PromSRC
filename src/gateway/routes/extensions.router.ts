import { Router } from 'express';
import { buildExtensionsCatalog } from '../../extensions/catalog-service.js';
import { ensurePrometheusExtensionRuntimeLoaded } from '../../extensions/legacy-connector-adapter.js';
import { buildMcpServerConfigFromPreset, listMcpPresets } from '../../extensions/mcp-preset-service.js';
import { reloadExtensions } from '../../extensions/reload.js';
import {
  installUserPlugin,
  listUserPlugins,
  removeUserPlugin,
} from '../../extensions/install-service.js';
import type { ExtensionKind } from '../../extensions/types.js';

export const router = Router();

function isExtensionKind(value: string): value is ExtensionKind {
  return value === 'provider' || value === 'connector' || value === 'mcp_preset' || value === 'integration';
}

router.get('/api/extensions/catalog', (req, res) => {
  try {
    const rawKind = String(req.query?.kind || '').trim();
    if (rawKind) {
      if (!isExtensionKind(rawKind)) {
        res.status(400).json({ success: false, error: `Invalid kind "${rawKind}"` });
        return;
      }
      const items = buildExtensionsCatalog(rawKind);
      res.json({ success: true, kind: rawKind, items });
      return;
    }

    const catalog = buildExtensionsCatalog();
    res.json({ success: true, catalog });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to build extension catalog' });
  }
});

// List MCP presets (bundled + user) from the registry — the source of truth for
// quick-setup / Connections "Add MCP". Each carries the credential fields the
// user must supply.
router.get('/api/extensions/mcp-presets', (_req, res) => {
  try {
    ensurePrometheusExtensionRuntimeLoaded();
    res.json({ success: true, presets: listMcpPresets() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to list MCP presets' });
  }
});

// Resolve a preset id + credentials into a concrete MCP server config (the shape
// the MCP manager launches). Body: { id, credentials? }
router.post('/api/extensions/mcp-presets/build', (req, res) => {
  try {
    ensurePrometheusExtensionRuntimeLoaded();
    const id = String((req.body || {}).id || '').trim();
    if (!id) {
      res.status(400).json({ success: false, error: 'id is required' });
      return;
    }
    const credentials = (req.body || {}).credentials;
    const config = buildMcpServerConfigFromPreset(id, credentials && typeof credentials === 'object' ? credentials : {});
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Failed to build MCP preset config' });
  }
});

// List user-installed (non-bundled) plugins for the manage surface.
router.get('/api/extensions/user', (_req, res) => {
  try {
    res.json({ success: true, items: listUserPlugins() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to list user plugins' });
  }
});

// Hot-reload the extension system from disk (after manual edits in the data dir).
router.post('/api/extensions/reload', (_req, res) => {
  try {
    const reload = reloadExtensions();
    res.json({ success: true, reload });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to reload extensions' });
  }
});

// Install a user plugin: validate manifest, write to the data dir, hot-reload.
// Body: { manifest: object, indexJs?: string }
router.post('/api/extensions/install', (req, res) => {
  try {
    const manifest = (req.body || {}).manifest;
    const indexJs = (req.body || {}).indexJs;
    if (!manifest || typeof manifest !== 'object') {
      res.status(400).json({ success: false, error: 'manifest object is required' });
      return;
    }
    if (indexJs !== undefined && typeof indexJs !== 'string') {
      res.status(400).json({ success: false, error: 'indexJs must be a string when provided' });
      return;
    }
    const result = installUserPlugin({ manifest, indexJs });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Failed to install plugin' });
  }
});

// Remove a user plugin by id. Body: { id: string }
router.post('/api/extensions/remove', (req, res) => {
  try {
    const id = String((req.body || {}).id || '').trim();
    if (!id) {
      res.status(400).json({ success: false, error: 'id is required' });
      return;
    }
    const result = removeUserPlugin(id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Failed to remove plugin' });
  }
});
