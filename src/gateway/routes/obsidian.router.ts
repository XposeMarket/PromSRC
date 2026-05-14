import { Router } from 'express';
import {
  loadObsidianBridgeState,
  removeObsidianVault,
  syncObsidianVaults,
  upsertObsidianVault,
  writePrometheusNoteToObsidian,
  type ObsidianBridgeMode,
} from '../obsidian/bridge';

export const router = Router();

function parseMode(value: any): ObsidianBridgeMode {
  const mode = String(value || '').trim();
  if (mode === 'full' || mode === 'assisted') return mode;
  return 'read_only';
}

function parseStringList(value: any): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

router.get('/api/obsidian/status', (_req, res) => {
  try {
    res.json({ success: true, bridge: loadObsidianBridgeState() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to load Obsidian bridge status' });
  }
});

router.post('/api/obsidian/vaults', (req, res) => {
  try {
    const vaultPath = String(req.body?.path || '').trim();
    if (!vaultPath) {
      res.status(400).json({ success: false, error: 'path is required' });
      return;
    }
    const vault = upsertObsidianVault({
      path: vaultPath,
      name: req.body?.name ? String(req.body.name).trim() : undefined,
      mode: parseMode(req.body?.mode),
      enabled: req.body?.enabled === undefined ? true : !!req.body.enabled,
      include: parseStringList(req.body?.include),
      exclude: parseStringList(req.body?.exclude),
      writebackFolder: req.body?.writebackFolder ? String(req.body.writebackFolder).trim() : undefined,
    });
    const sync = req.body?.syncNow === false ? null : syncObsidianVaults({ vaultId: vault.id, force: true });
    res.status(201).json({ success: true, vault, sync, bridge: loadObsidianBridgeState() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to connect Obsidian vault' });
  }
});

router.patch('/api/obsidian/vaults/:vaultId', (req, res) => {
  try {
    const bridge = loadObsidianBridgeState();
    const existing = bridge.vaults.find((vault) => vault.id === String(req.params.vaultId || '').trim());
    if (!existing) {
      res.status(404).json({ success: false, error: 'Vault not found' });
      return;
    }
    const vault = upsertObsidianVault({
      path: existing.path,
      name: req.body?.name !== undefined ? String(req.body.name).trim() : existing.name,
      mode: req.body?.mode !== undefined ? parseMode(req.body.mode) : existing.mode,
      enabled: req.body?.enabled !== undefined ? !!req.body.enabled : existing.enabled,
      include: parseStringList(req.body?.include) ?? existing.include,
      exclude: parseStringList(req.body?.exclude) ?? existing.exclude,
      writebackFolder: req.body?.writebackFolder !== undefined ? String(req.body.writebackFolder).trim() : existing.writebackFolder,
    });
    res.json({ success: true, vault, bridge: loadObsidianBridgeState() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to update Obsidian vault' });
  }
});

router.delete('/api/obsidian/vaults/:vaultId', (req, res) => {
  try {
    const removeIndexedNotes = String(req.query?.removeIndexedNotes || 'true').toLowerCase() !== 'false';
    const bridge = removeObsidianVault(String(req.params.vaultId || '').trim(), { removeIndexedNotes });
    res.json({ success: true, bridge });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to remove Obsidian vault' });
  }
});

router.post('/api/obsidian/sync', (req, res) => {
  try {
    const vaultId = req.body?.vaultId ? String(req.body.vaultId).trim() : undefined;
    const result = syncObsidianVaults({ vaultId, force: req.body?.force !== false });
    res.json({ success: true, sync: result, bridge: loadObsidianBridgeState() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to sync Obsidian vaults' });
  }
});

router.post('/api/obsidian/writeback', (req, res) => {
  try {
    const result = writePrometheusNoteToObsidian({
      vaultId: String(req.body?.vaultId || '').trim(),
      title: String(req.body?.title || '').trim(),
      content: String(req.body?.content || '').trim(),
      folder: req.body?.folder ? String(req.body.folder).trim() : undefined,
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map((tag: any) => String(tag || '').trim()).filter(Boolean) : undefined,
      sourceRecordId: req.body?.sourceRecordId ? String(req.body.sourceRecordId).trim() : undefined,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to write to Obsidian' });
  }
});
