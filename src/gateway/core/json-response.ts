/**
 * JSON response sending: one serialization, Express ETag/304 semantics, and
 * brotli/gzip for large bodies when the client accepts it.
 *
 * Large JSON API responses (chat history pages reach several MB, mostly
 * repetitive trace JSON) dominate the cost of opening a thread over
 * LAN/Tailscale: 3.5 MB -> ~340 KB with brotli q4 in ~20 ms. Only JSON bodies
 * are touched (res.json() via the middleware, or sendJsonText() from routes
 * that already hold the serialized text), so SSE streams, static files
 * (compressed separately in core/server.ts) and small replies keep their
 * existing behavior. Compression runs async off the event loop.
 *
 * Compressed responses keep the conditional-GET behavior Express gives every
 * res.send(): an ETag from the app's `etag fn` over the uncompressed body, and
 * a bodiless 304 when If-None-Match matches. Vary is appended, never replaced,
 * so the CORS layer's `Vary: Origin` survives.
 */
import type express from 'express';
import zlib from 'zlib';

export const JSON_COMPRESSION_MIN_BYTES = 16 * 1024;

export type JsonResponseEncoding = 'br' | 'gzip';

export function pickJsonResponseEncoding(acceptEncoding: unknown): JsonResponseEncoding | null {
  const header = String(acceptEncoding || '').trim().toLowerCase();
  if (!header) return null;
  const q = new Map<string, number>();
  let wildcard: number | undefined;
  for (const part of header.split(',')) {
    const [rawToken, ...params] = part.trim().split(';');
    const token = rawToken.trim();
    if (!token) continue;
    let value = 1;
    for (const param of params) {
      const [key, raw] = param.split('=');
      if (String(key || '').trim() !== 'q') continue;
      const parsed = Number(String(raw || '').trim());
      value = Number.isFinite(parsed) ? parsed : 1;
    }
    if (token === '*') wildcard = value;
    else q.set(token, value);
  }
  const ok = (token: string) => {
    const value = q.has(token) ? q.get(token)! : wildcard;
    return value !== undefined && value > 0;
  };
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

function compress(raw: Buffer, encoding: JsonResponseEncoding, done: (err: Error | null, out?: Buffer) => void): void {
  if (encoding === 'br') {
    zlib.brotliCompress(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    }, done);
  } else {
    zlib.gzip(raw, { level: 5 }, done);
  }
}

/**
 * Send an already-serialized JSON body. Use this when a route needs the text
 * anyway (for example to hash or measure it) so the body is stringified once.
 */
export function sendJsonText(req: express.Request, res: express.Response, text: string): void {
  if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const encoding = pickJsonResponseEncoding(req.headers['accept-encoding']);
  const raw = Buffer.from(text, 'utf8');
  if (!encoding || req.method === 'HEAD' || raw.length < JSON_COMPRESSION_MIN_BYTES || res.headersSent || res.getHeader('Content-Encoding')) {
    // Express's own path: ETag, 304 and HEAD handling exactly as res.json() had them.
    res.send(text);
    return;
  }
  res.vary('Accept-Encoding');
  const etagFn = req.app?.get('etag fn');
  if (typeof etagFn === 'function' && !res.getHeader('ETag')) {
    const tag = etagFn(raw, 'utf8');
    if (tag) res.setHeader('ETag', tag);
  }
  if (req.fresh) {
    res.statusCode = 304;
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    res.removeHeader('Transfer-Encoding');
    res.end();
    return;
  }
  compress(raw, encoding, (err, compressed) => {
    if (res.headersSent || res.writableEnded) return;
    if (err || !compressed || compressed.length >= raw.length) {
      res.setHeader('Content-Length', String(raw.length));
      res.end(raw);
      return;
    }
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Content-Length', String(compressed.length));
    res.end(compressed);
  });
}

/** Middleware: routes keep calling res.json(); large bodies go through sendJsonText. */
export function compressLargeJsonResponses(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const encoding = pickJsonResponseEncoding(req.headers['accept-encoding']);
  if (!encoding || req.method === 'HEAD') { next(); return; }
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    let text: string;
    try { text = JSON.stringify(body); } catch { return originalJson(body); }
    if (text === undefined || res.headersSent || res.getHeader('Content-Encoding')) return originalJson(body);
    sendJsonText(req, res, text);
    return res;
  }) as any;
  next();
}
