import { Router, type Request, type Response } from 'express';
import path from 'path';

import { getConfig } from '../../config/config';
import { getSession, getWorkspace, sessionExists } from '../session';
import { executeWebFetch } from '../../tools/web';
import {
  assertSafeStorageId,
  isStorageBoundaryError,
} from '../storage/storage-paths';
import {
  browserGetPageText,
  getBrowserSessionInfo,
} from '../browser-tools';
import {
  getResourceStore,
  redactResourceText,
  type ResourceKind,
  type ResourceOrigin,
} from '../resources/resource-store';

export const router = Router();

function threadIdParam(req: Request): string {
  return assertSafeStorageId(req.params.sessionId, 'session');
}

function resourceIdParam(req: Request): string {
  return assertSafeStorageId(String(req.params.resourceId || '').trim(), 'resource');
}

function storeForThread(sessionId: string) {
  if (!sessionExists(sessionId)) throw new Error('Resource not found.');
  return getResourceStore(getWorkspace(sessionId) || getConfig().getWorkspacePath());
}

function sendError(res: Response, error: unknown, status = 400): void {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Resource operation failed.');
  const safeMessage = redactResourceText(rawMessage);
  const message = /not attached|not found|another workspace|not available|invalid resource|permission|unauthorized|outside the configured workspace/i.test(safeMessage)
    ? 'Resource not found or unavailable.'
    : safeMessage || 'Resource operation failed.';
  res.status(status).json({ success: false, error: message });
}

router.get('/api/sessions/:sessionId/resources', (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const store = storeForThread(sessionId);
    const query = String(req.query.q || '').trim();
    const resources = store.listThreadResources(sessionId, {
      query,
      limit: Math.min(Math.max(Number(req.query.limit || 60) || 60, 1), 200),
    });
    res.json({ success: true, resources, query });
  } catch (error) {
    sendError(res, error);
  }
});

// Legacy promotion is explicit/write-only. Reads never create registry
// records or migration markers.
router.post('/api/sessions/:sessionId/resources/migrate', (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const result = storeForThread(sessionId).migrateLegacyHistory(sessionId, getSession(sessionId).history as any);
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/api/sessions/:sessionId/resources/:resourceId/content', (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const maxChars = Math.min(Math.max(Number(req.query.maxChars || 24_000) || 24_000, 500), 100_000);
    const result = storeForThread(sessionId).getThreadResourceContent(sessionId, resourceIdParam(req), {
      maxChars,
      versionId: typeof req.query.versionId === 'string' ? req.query.versionId : undefined,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, /not attached|not found/i.test(String(error)) ? 404 : 400);
  }
});

router.post('/api/sessions/:sessionId/resources/attach', (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const store = storeForThread(sessionId);
    const actor = String(body.actor || 'user');
    let result: any;
    if (body.url) {
      result = store.attachUrl(sessionId, String(body.url), {
        title: body.title ? String(body.title) : undefined,
        origin: (body.origin as ResourceOrigin) || 'user_link',
        mimeType: body.mimeType ? String(body.mimeType) : undefined,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
        actor,
        pinned: body.pinned === undefined ? false : Boolean(body.pinned),
      });
    } else if (body.path || body.filePath) {
      result = store.attachFile({
        threadId: sessionId,
        filePath: String(body.path || body.filePath),
        title: body.title ? String(body.title) : undefined,
        mimeType: body.mimeType ? String(body.mimeType) : undefined,
        actor,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
        pinned: body.pinned === undefined ? false : Boolean(body.pinned),
      });
    } else if (body.text !== undefined || body.content !== undefined) {
      const kind = (body.kind as ResourceKind) || 'file';
      result = store.attach({
        threadId: sessionId,
        kind,
        title: body.title ? String(body.title) : 'Attached source',
        mimeType: body.mimeType ? String(body.mimeType) : 'text/plain',
        origin: (body.origin as ResourceOrigin) || 'user_link',
        locator: { type: 'artifact', canonical: `manual:${sessionId}:${String(body.title || 'source')}` },
        content: String(body.text ?? body.content ?? ''),
        snapshotKind: 'text',
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
        actor,
        pinned: body.pinned === undefined ? false : Boolean(body.pinned),
      });
    } else {
      throw new Error('Attach requires a URL, workspace file path, or text content.');
    }
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/api/sessions/:sessionId/resources/copy-from', (req, res) => {
  try {
    const destinationSessionId = threadIdParam(req);
    const sourceSessionId = assertSafeStorageId(String(req.body?.sourceSessionId || req.body?.source_session_id || ''), 'source session');
    const destinationWorkspace = getWorkspace(destinationSessionId);
    const sourceWorkspace = getWorkspace(sourceSessionId);
    if (!destinationWorkspace || !sourceWorkspace || path.resolve(destinationWorkspace) !== path.resolve(sourceWorkspace)) {
      throw new Error('Resource belongs to another workspace.');
    }
    const resourceIds = Array.isArray(req.body?.resourceIds)
      ? req.body.resourceIds.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 200)
      : undefined;
    const resources = storeForThread(destinationSessionId).copyThreadResources(sourceSessionId, destinationSessionId, {
      resourceIds,
      inheritedBy: 'fork',
      actor: 'fork',
    });
    res.json({ success: true, resources });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/api/sessions/:sessionId/resources/:resourceId', (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const link = storeForThread(sessionId).detach(sessionId, resourceIdParam(req), String(req.body?.actor || 'user'));
    res.json({ success: true, link });
  } catch (error) {
    sendError(res, error, 404);
  }
});

router.post('/api/sessions/:sessionId/resources/:resourceId/pin', (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const pinned = req.body?.pinned !== false;
    const link = storeForThread(sessionId).setPinned(sessionId, resourceIdParam(req), pinned, String(req.body?.actor || 'user'));
    res.json({ success: true, link });
  } catch (error) {
    sendError(res, error, 404);
  }
});

router.post('/api/sessions/:sessionId/resources/:resourceId/delete', (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const resourceId = resourceIdParam(req);
    const store = storeForThread(sessionId);
    const resource = store.deleteResourceForThread(sessionId, resourceId, String(req.body?.actor || 'user'));
    res.json({ success: true, resource });
  } catch (error) {
    sendError(res, error, 404);
  }
});

router.post('/api/sessions/:sessionId/resources/:resourceId/refresh', async (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const resourceId = resourceIdParam(req);
    const store = storeForThread(sessionId);
    const current = store.getThreadResourceContent(sessionId, resourceId, { maxChars: 1 });
    const locator = current.resource.locator;
    if (locator.type === 'file' && locator.path) {
      const result = store.refreshFile(sessionId, resourceId, 'user');
      res.json({ success: true, ...result });
      return;
    }
    const url = String(locator.url || '').trim();
    if (!url) throw new Error('Resource has no refreshable URL or workspace file path.');
    const fetched = await executeWebFetch({ url, max_chars: 60_000 });
    const text = String(fetched.data?.preview || fetched.data?.text || fetched.stdout || '').trim();
    if (!text) {
      store.markStatus(resourceId, 'stale', 'user', { error: fetched.error || 'No readable content returned.' });
      throw new Error(fetched.error || 'No readable content returned.');
    }
    const result = store.attach({
      threadId: sessionId,
      kind: current.resource.kind,
      title: String(fetched.data?.title || current.resource.title),
      mimeType: String(fetched.data?.content_type || current.resource.mimeType || 'text/html'),
      origin: current.resource.kind === 'browser_page' ? 'browser_save' : 'web_fetch',
      locator,
      content: text,
      snapshotKind: 'text',
      metadata: { ...(current.resource.metadata || {}), refreshedAt: new Date().toISOString() },
      actor: 'user',
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, /not attached|not found/i.test(String(error)) ? 404 : 400);
  }
});

router.post('/api/sessions/:sessionId/resources/browser/current', async (req, res) => {
  try {
    const sessionId = threadIdParam(req);
    const browserSessionId = String(req.body?.browserSessionId || 'default');
    const info = getBrowserSessionInfo(browserSessionId);
    if (!info.active || !info.url) throw new Error('No active Browser page is available to save.');
    const text = await browserGetPageText(browserSessionId, { maxChars: 60_000 });
    if (!text || /^ERROR:/i.test(text)) throw new Error(text || 'The current Browser page has no readable text.');
    const result = storeForThread(sessionId).captureBrowserPage({
      threadId: sessionId,
      url: info.url,
      title: info.title,
      text,
      browserSessionId: info.sessionId,
      actor: 'user',
      metadata: { browserTarget: info.browserTarget, originLabel: info.originLabel },
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/api/browser/history', (req, res) => {
  try {
    const requestedSessionId = String(req.query.sessionId || '').trim();
    const store = requestedSessionId
      ? storeForThread(assertSafeStorageId(requestedSessionId, 'session'))
      : getResourceStore();
    const resources = store.listBrowserHistory({
      query: String(req.query.q || '').trim(),
      limit: Math.min(Math.max(Number(req.query.limit || 100) || 100, 1), 500),
    });
    res.json({ success: true, resources });
  } catch (error) {
    sendError(res, error);
  }
});

router.use((error: any, _req: Request, res: Response, next: any) => {
  if (!isStorageBoundaryError(error)) {
    next(error);
    return;
  }
  sendError(res, error);
});
