import crypto from 'crypto';

type RequestLike = {
  method?: string;
  url?: string;
  headers?: Record<string, any>;
};

type WorkerRenderGrant = {
  kind: 'worker';
  jobId: string;
  expiresAt: number;
};

type PreviewRenderGrant = {
  kind: 'preview';
  sessionId: string;
  htmlPath: string;
  root: string;
  expiresAt: number;
};

type WorkspacePreviewGrant = {
  kind: 'workspace-preview';
  path: string;
  expiresAt: number;
};

type RenderGrant = WorkerRenderGrant | PreviewRenderGrant | WorkspacePreviewGrant;

const grants = new Map<string, RenderGrant>();
const HEADER_NAME = 'x-prometheus-render-token';

function headerValue(headers: RequestLike['headers'], name: string): string {
  const value = headers?.[name];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function pruneExpired(now = Date.now()): void {
  for (const [token, grant] of grants) {
    if (grant.expiresAt <= now) grants.delete(token);
  }
}

function parsedUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl, 'http://127.0.0.1');
  } catch {
    return null;
  }
}

function isAllowed(grant: RenderGrant, methodRaw: string, rawUrl: string): boolean {
  const method = String(methodRaw || 'GET').toUpperCase();
  const url = parsedUrl(rawUrl);
  const pathname = url?.pathname || String(rawUrl || '').split('?', 1)[0];
  if (grant.kind === 'workspace-preview') {
    return method === 'GET'
      && pathname === '/preview'
      && String(url?.searchParams.get('path') || '') === grant.path;
  }
  if (grant.kind === 'preview') {
    if (method !== 'GET' || !url) return false;
    if (pathname !== '/api/canvas/html-motion-clip/preview' && pathname !== '/api/canvas/html-motion-clip/asset') return false;
    return String(url.searchParams.get('sessionId') || '') === grant.sessionId
      && String(url.searchParams.get('path') || '') === grant.htmlPath
      && String(url.searchParams.get('root') || '') === grant.root;
  }
  if (method === 'GET' && (
    pathname === '/api/canvas/creative-render-ui'
    || pathname.startsWith('/api/canvas/creative-render-ui/')
  )) return true;

  const jobBase = `/api/canvas/creative-render-jobs/${encodeURIComponent(grant.jobId)}`;
  if (method === 'GET' && pathname === jobBase) return true;
  if (method === 'POST' && (pathname === `${jobBase}/progress` || pathname === `${jobBase}/complete`)) return true;
  return false;
}

export function issueCreativeRenderGrant(jobIdRaw: string, ttlMs = 15 * 60 * 1000): string {
  const jobId = String(jobIdRaw || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(jobId)) {
    throw new Error('Cannot issue a creative render grant for an invalid job id.');
  }
  pruneExpired();
  const token = crypto.randomBytes(32).toString('base64url');
  grants.set(token, {
    kind: 'worker',
    jobId,
    expiresAt: Date.now() + Math.max(30_000, Math.min(60 * 60 * 1000, Number(ttlMs) || 0)),
  });
  return token;
}

export function issueCreativePreviewGrant(
  input: { sessionId: string; htmlPath: string; root?: string },
  ttlMs = 30 * 60 * 1000,
): string {
  const sessionId = String(input.sessionId || '').trim();
  const htmlPath = String(input.htmlPath || '').trim();
  const root = String(input.root || '').trim();
  if (!sessionId || !htmlPath) throw new Error('Cannot issue a creative preview grant without a session and HTML path.');
  pruneExpired();
  const token = crypto.randomBytes(32).toString('base64url');
  grants.set(token, {
    kind: 'preview',
    sessionId,
    htmlPath,
    root,
    expiresAt: Date.now() + Math.max(30_000, Math.min(60 * 60 * 1000, Number(ttlMs) || 0)),
  });
  return token;
}

export function issueWorkspacePreviewGrant(pathRaw: string, ttlMs = 2 * 60 * 1000): string {
  const workspacePath = String(pathRaw || '').trim();
  if (!workspacePath) throw new Error('Cannot issue a workspace preview grant without a path.');
  pruneExpired();
  const token = crypto.randomBytes(32).toString('base64url');
  grants.set(token, {
    kind: 'workspace-preview',
    path: workspacePath,
    expiresAt: Date.now() + Math.max(30_000, Math.min(10 * 60 * 1000, Number(ttlMs) || 0)),
  });
  return token;
}

export function revokeCreativeRenderGrant(token: string): void {
  grants.delete(String(token || '').trim());
}

export function shouldAttachCreativeRenderGrant(tokenRaw: string, method: string, rawUrl: string): boolean {
  const token = String(tokenRaw || '').trim();
  pruneExpired();
  const grant = token ? grants.get(token) : null;
  return !!grant && isAllowed(grant, method, rawUrl);
}

export function evaluateCreativeRenderGrant(req: RequestLike): { present: boolean; ok: boolean } {
  const url = parsedUrl(String(req.url || ''));
  const token = headerValue(req.headers, HEADER_NAME) || String(url?.searchParams.get('renderToken') || '').trim();
  if (!token) return { present: false, ok: false };
  pruneExpired();
  const grant = grants.get(token);
  return { present: true, ok: !!grant && isAllowed(grant, String(req.method || 'GET'), String(req.url || '')) };
}

export const CREATIVE_RENDER_AUTH_HEADER = 'X-Prometheus-Render-Token';
