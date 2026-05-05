import { Router } from 'express';
import { buildExtensionsCatalog } from '../../extensions/catalog-service.js';
import type { ExtensionKind } from '../../extensions/types.js';

export const router = Router();

function isExtensionKind(value: string): value is ExtensionKind {
  return value === 'provider' || value === 'connector' || value === 'mcp_preset';
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
