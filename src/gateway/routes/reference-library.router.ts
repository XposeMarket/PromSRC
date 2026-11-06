import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { getReferenceService } from '../resources/reference-service';
import { openReference, publicReference, exportReference } from '../resources/reference-library';

// Mounted behind the same gateway + account authentication as Memory. Never accepts workspace/owner from requests.
export const referenceLibraryRouter = Router();
const library = () => getReferenceService(getConfig().getWorkspacePath());
const error = (res: any, err: any) => res.status(/unavailable|excluded|match/.test(err.message) ? 404 : 400).json({ success: false, error: err.message });
referenceLibraryRouter.get('/api/memory/references', (req, res) => {
  try {
    const s = library(); const items = s.metadata.list({ query: String(req.query.q || ''), includeExcluded: true, limit: 50, offset: Number(req.query.offset || 0), sourceSession: req.query.sourceSession ? String(req.query.sourceSession) : undefined });
    res.json({ success: true, ...s.metadata.stats(), storageBytes: s.metadata.storageUsage(), items: items.map(publicReference), settings: s.metadata.settings(), writable: s.metadata.writable, visibility: 'personal', sharingAvailable: false });
  } catch (e) { error(res, e); }
});
referenceLibraryRouter.patch('/api/memory/references/settings', (req, res) => {
  try { res.json({ success: true, settings: library().metadata.setSettings(req.body || {}) }); } catch (e) { error(res, e); }
});
referenceLibraryRouter.post('/api/memory/references', (req, res) => {
  let temp: string | undefined;
  try {
    const s = library(); const title = String(req.body?.title || 'Saved reference').slice(0, 500);
    const quote = String(req.body?.userQuote || '').slice(0, 16000);
    const operationId = `owner:${crypto.randomUUID()}`;
    let ref;
    if (req.body?.base64) {
      const encoded = String(req.body.base64); if (encoded.length > 28 * 1024 * 1024) throw new Error('Upload exceeds 20 MiB');
      const bytes = Buffer.from(encoded, 'base64'); if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Empty or oversized upload');
      const name = path.basename(String(req.body.name || 'attachment')).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
      const dir = path.join(s.resources.workspaceScope, 'uploads', 'references'); fs.mkdirSync(dir, { recursive: true });
      temp = path.join(dir, `${crypto.randomUUID()}-${name}`); fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
      ref = s.saveAttachment({ operationId, filePath: temp, title, mimeType: String(req.body.mimeType || 'application/octet-stream').slice(0, 120), userQuote: quote });
    } else {
      const content = String(req.body?.content || '').trim(); if (!content || content.length > 100000) throw new Error('Enter a note or source link (maximum 100,000 characters)');
      ref = s.saveText({ operationId, title, content, userQuote: quote });
    }
    res.json({ success: true, reference: publicReference(ref) });
  } catch (e) { error(res, e); }
  finally { if (temp) { try { fs.unlinkSync(temp); } catch { /* only remove this request's temporary upload */ } } }
});
referenceLibraryRouter.get('/api/memory/references/:id', (req, res) => {
  try {
    const s = library(); const opened = openReference(s, String(req.params.id), { owner: true, offset: Number(req.query.offset || 0), limit: 6 });
    const backlinks = s.metadata.backlinks(opened.reference.id).map(publicReference);
    res.json({ success: true, ...opened, assets: opened.assets.map(({ bytes, ...asset }) => asset), backlinks, writable: s.metadata.writable });
  } catch (e) { error(res, e); }
});
referenceLibraryRouter.get('/api/memory/references/:id/assets/:index', (req, res) => {
  try {
    const index = Number(req.params.index); if (!Number.isInteger(index) || index < 0) throw new Error('Invalid asset');
    const opened = openReference(library(), String(req.params.id), { owner: true, offset: index, limit: 1 });
    const asset = opened.assets.find(item => item.index === index); if (!asset) throw new Error('Asset unavailable');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.json({ success: true, mimeType: asset.mimeType, base64: asset.bytes.toString('base64') });
  } catch (e) { error(res, e); }
});
referenceLibraryRouter.patch('/api/memory/references/:id', (req, res) => {
  try {
    const { title, userQuote, interpretation, notes, status, excluded, relatedIds } = req.body || {};
    res.json({ success: true, reference: publicReference(library().metadata.update(String(req.params.id), { title, userQuote, interpretation, notes, status, excluded, relatedIds })) });
  } catch (e) { error(res, e); }
});
referenceLibraryRouter.post('/api/memory/references/:id/forget-source', (req, res) => {
  try { library().metadata.forgetSource(String(req.params.id)); res.json({ success: true, message: 'Reference excluded. Its entire source chat is suppressed from future memory searches; original chat and previously delivered copies remain. Use as reference again reverses this.' }); } catch (e) { error(res, e); }
});
referenceLibraryRouter.delete('/api/memory/references/:id', (req, res) => {
  try { library().metadata.remove(String(req.params.id)); res.json({ success: true, message: 'Removed from the reference library. Independent source chats, exports and provider history are unchanged.' }); } catch (e) { error(res, e); }
});
referenceLibraryRouter.get('/api/memory/references/:id/export', async (req, res) => {
  try {
    const bytes = await exportReference(library(), String(req.params.id));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, mimeType: 'application/zip', base64: bytes.toString('base64') });
  } catch (e) { error(res, e); }
});
