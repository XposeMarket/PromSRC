
/**
 * browser-tools.ts - Browser Automation for Prometheus
 *
 * Strategy: use the Electron in-house browser by default in the desktop app.
 * The Prometheus-owned Chrome/CDP lane and the user's Chrome extension remain
 * available as explicit secondary targets.
 * Background agents, tasks, and team agents get isolated persistent profiles
 * and CDP ports derived from their stable owner identity.
 *
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import { BrowserConsoleEntry } from './types.js';
import { resolveSessionId } from './extraction.js';
import { recoverInHouseSessionMapping } from './inhouse-sessions.js';
import { getInHouseSession, callInHouseBrowser } from './inhouse.js';
import { sessions, _networkInterceptLog, _networkInterceptHandlers } from './state.js';
import { attachBrowserConsoleCollector, safeBrowserPageUrl } from './sessions.js';
import { MAX_NETWORK_INTERCEPT_ENTRIES } from './snapshot-format.js';


export function buildBrowserRunJsEnvelopeSource(code: string): string {
  return `
    (async () => {
      const source = ${JSON.stringify(String(code || ''))};
      const typeOfValue = (value) => {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (Array.isArray(value)) return 'array';
        return typeof value;
      };
      const normalize = (value, depth = 0, seen = new WeakSet()) => {
        if (value === undefined) return '[undefined]';
        if (value === null) return null;
        const kind = typeof value;
        if (kind === 'string' || kind === 'number' || kind === 'boolean') return value;
        if (kind === 'bigint') return value.toString() + 'n';
        if (kind === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
        if (kind !== 'object') return String(value);
        if (seen.has(value)) return '[Circular]';
        if (depth >= 5) return '[MaxDepth]';
        seen.add(value);
        if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
        if (typeof Element !== 'undefined' && value instanceof Element) {
          return {
            tagName: value.tagName,
            id: value.id || undefined,
            className: typeof value.className === 'string' ? value.className : undefined,
            text: (value.textContent || '').trim().slice(0, 500),
          };
        }
        if (value instanceof Map) return Array.from(value.entries()).map(([key, val]) => [normalize(key, depth + 1, seen), normalize(val, depth + 1, seen)]);
        if (value instanceof Set) return Array.from(value.values()).map((val) => normalize(val, depth + 1, seen));
        if (Array.isArray(value)) return value.slice(0, 200).map((item) => normalize(item, depth + 1, seen));
        const out = {};
        for (const key of Object.keys(value).slice(0, 200)) {
          try { out[key] = normalize(value[key], depth + 1, seen); }
          catch (err) { out[key] = '[Thrown while reading property: ' + (err && err.message || err) + ']'; }
        }
        return out;
      };
      const serialize = (value) => {
        const valueType = typeOfValue(value);
        if (value === undefined) return { valueType, isUndefined: true, text: 'undefined' };
        if (typeof value === 'string') return { valueType, isUndefined: false, text: value };
        try { return { valueType, isUndefined: false, text: JSON.stringify(normalize(value), null, 2) }; }
        catch (err) { return { valueType, isUndefined: false, text: String(value) }; }
      };
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const trimmed = String(source || '').trim();
      if (!trimmed) return { ok: false, mode: 'empty', error: 'code parameter is required.' };

      let expressionCompileError = '';
      const expressionSource = trimmed.replace(/;\\s*$/, '');
      if (expressionSource) {
        let expressionFn = null;
        try {
          expressionFn = new AsyncFunction('return (' + expressionSource + ');');
        } catch (err) {
          expressionCompileError = String((err && err.message) || err || '');
        }
        if (expressionFn) {
          try {
            const value = await expressionFn();
            return { ok: true, mode: 'expression', ...serialize(value) };
          } catch (err) {
            return { ok: false, mode: 'expression', error: String((err && (err.stack || err.message)) || err || 'JS expression failed') };
          }
        }
      }

      try {
        const bodyFn = new AsyncFunction(source);
        const value = await bodyFn();
        return { ok: true, mode: 'function-body', expressionCompileError, ...serialize(value) };
      } catch (err) {
        return {
          ok: false,
          mode: 'function-body',
          expressionCompileError,
          error: String((err && (err.stack || err.message)) || err || 'JS execution failed'),
        };
      }
    })()
  `;
}

export function formatBrowserRunJsEnvelope(envelope: any): string {
  if (typeof envelope === 'string') {
    try {
      const parsed = JSON.parse(envelope);
      return formatBrowserRunJsEnvelope(parsed);
    } catch {
      return envelope;
    }
  }
  if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
    return envelope === undefined || envelope === null
      ? 'JS executed successfully (returned: null/undefined).'
      : (typeof envelope === 'object' ? JSON.stringify(envelope, null, 2) : String(envelope));
  }
  if (!envelope.ok) {
    const expressionNote = envelope.expressionCompileError
      ? `\nExpression parse fallback: ${String(envelope.expressionCompileError).split('\n')[0]}`
      : '';
    return `ERROR: JS execution failed (${envelope.mode || 'unknown'}): ${envelope.error || 'unknown error'}${expressionNote}`;
  }
  if (envelope.isUndefined) {
    return `JS executed successfully (${envelope.mode || 'unknown'}; returned undefined).`;
  }
  return [
    `JS result (${envelope.mode || 'unknown'}, ${envelope.valueType || 'value'}):`,
    String(envelope.text ?? ''),
  ].join('\n');
}

export async function readInPageBrowserEventLog(page: any, action: 'read' | 'clear'): Promise<BrowserConsoleEntry[]> {
  const result = await page.evaluate((requestedAction: 'read' | 'clear') => {
    const g = globalThis as any;
    const ensure = () => {
      if (!g.__promBrowserEventLog) {
        g.__promBrowserEventLog = [];
        const push = (entry: any) => {
          try {
            g.__promBrowserEventLog.push({
              source: 'in_page',
              level: String(entry?.level || 'error'),
              message: String(entry?.message || ''),
              ts: Date.now(),
              url: String(g.location?.href || ''),
              location: entry?.location || undefined,
            });
            if (g.__promBrowserEventLog.length > 1000) {
              g.__promBrowserEventLog.splice(0, g.__promBrowserEventLog.length - 1000);
            }
          } catch {}
        };
        g.addEventListener('error', (event: any) => push({
          level: 'error',
          message: event?.message || 'window error',
          location: {
            source: event?.filename,
            lineNumber: event?.lineno,
            columnNumber: event?.colno,
          },
        }));
        g.addEventListener('unhandledrejection', (event: any) => push({
          level: 'error',
          message: 'unhandledrejection: ' + (event?.reason?.stack || event?.reason?.message || event?.reason || ''),
        }));
      }
    };
    ensure();
    if (requestedAction === 'clear') {
      g.__promBrowserEventLog = [];
      return [];
    }
    return Array.isArray(g.__promBrowserEventLog) ? g.__promBrowserEventLog.slice(-1000) : [];
  }, action);
  return Array.isArray(result) ? result as BrowserConsoleEntry[] : [];
}

export function formatInHouseConsoleResult(result: any): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result || { entries: [], count: 0, returned: 0 }, null, 2);
}

export function formatInHouseNetworkResult(result: any, options: { includeBodies?: boolean } = {}): string {
  if (typeof result === 'string') return result;
  const action = String(result?.action || 'read');
  if (action === 'start') {
    return `Network observation started in the Prometheus in-house browser${result?.urlFilter ? ` (filter applied: "${result.urlFilter}")` : ''}. Capturing up to ${Number(result?.limit || 200)} responses. Response bodies are unavailable in the native lane.`;
  }
  if (action === 'stop') {
    return `Network observation stopped. ${Number(result?.captured || 0)} entries remain in the native tab log.`;
  }
  if (action === 'clear') return 'Native browser network log cleared.';
  const entries = Array.isArray(result?.returned) ? result.returned : [];
  if (!entries.length) {
    return result?.active
      ? 'No matching native network responses captured yet (observation is active).'
      : 'No native network entries � start observation first with action="start".';
  }
  const lines = entries.map((entry: any) => {
    const ts = entry?.ts ? new Date(Number(entry.ts)).toISOString().slice(11, 23) : 'unknown time';
    const status = Number(entry?.status || 0) || (entry?.error ? 'ERR' : '�');
    const error = entry?.error ? ` (${String(entry.error).replace(/\s+/g, ' ').slice(0, 240)})` : '';
    return `[${ts}] ${String(entry?.method || 'GET')} ${status} ${String(entry?.contentType || '')}${error}\n    ${String(entry?.url || '')}`;
  });
  return `Network log (${entries.length} returned of ${Number(result?.total || entries.length)} matching; bodies=${options.includeBodies === true ? 'unavailable in native lane' : 'omitted'}):\n\n${lines.join('\n\n')}\n\n${result?.note || ''}`.trim();
}

export async function browserInspectConsole(
  sessionId: string,
  options: { action?: 'read' | 'clear' | string; maxEntries?: number; sinceTs?: number; pageOnly?: boolean; urlFilter?: string; maxMessageChars?: number } = {},
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    try {
      const result = await callInHouseBrowser('console', { sessionId: resolved, ...options });
      return formatInHouseConsoleResult(result);
    } catch (err: any) {
      return `ERROR: In-house browser console inspection failed: ${err.message}`;
    }
  }
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const action = String(options.action || 'read').toLowerCase() === 'clear' ? 'clear' : 'read';
  const maxEntries = Math.max(1, Math.min(500, Math.floor(Number(options.maxEntries || 100))));
  attachBrowserConsoleCollector(session, session.page);
  if (action === 'clear') {
    session.consoleEntries = [];
    await readInPageBrowserEventLog(session.page, 'clear').catch(() => []);
    const title = await session.page.title().catch(() => '');
    return JSON.stringify({
      cleared: true,
      url: safeBrowserPageUrl(session.page),
      title,
      controller_entries: 0,
      in_page_entries: 0,
    }, null, 2);
  }

  const inPageEntries = await readInPageBrowserEventLog(session.page, 'read').catch(() => []);
  const controllerEntries = Array.isArray(session.consoleEntries) ? session.consoleEntries : [];
  const currentUrl = safeBrowserPageUrl(session.page);
  const sinceTs = Math.max(0, Number(options.sinceTs || 0));
  const urlFilter = String(options.urlFilter || '').trim();
  const allEntries = [...controllerEntries, ...inPageEntries]
    .filter((entry) => entry && String(entry.message || '').trim())
    .filter((entry) => !sinceTs || Number(entry.ts || 0) >= sinceTs)
    .filter((entry) => !urlFilter || String(entry.url || '').includes(urlFilter))
    .filter((entry) => options.pageOnly === false || !entry.url || String(entry.url) === currentUrl)
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  const maxMessageChars = Math.max(80, Math.min(4000, Math.floor(Number(options.maxMessageChars || 500))));
  const entries = allEntries.slice(-maxEntries).map((entry) => ({
    ts: entry.ts ? new Date(Number(entry.ts)).toISOString() : undefined,
    source: entry.source,
    level: entry.level,
    message: String(entry.message || '').slice(0, maxMessageChars),
    url: String(entry.url || '').slice(0, 500),
    location: entry.location ? {
      url: String(entry.location.url || entry.location.source || '').slice(0, 300),
      lineNumber: entry.location.lineNumber,
      columnNumber: entry.location.columnNumber,
    } : undefined,
  }));
  const counts = entries.reduce((acc: Record<string, number>, entry: any) => {
    const key = String(entry.level || 'log');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const title = await session.page.title().catch(() => '');
  return JSON.stringify({
    url: currentUrl,
    title,
    count: allEntries.length,
    returned: entries.length,
    controller_entries: controllerEntries.length,
    in_page_entries: inPageEntries.length,
    counts,
    entries,
    scope: { since_ts: sinceTs || null, page_only: options.pageOnly !== false, url_filter: urlFilter || null },
    note: 'Console entries are scoped to the current page by default. Set page_only=false only for explicit session-global history.',
  }, null, 2);
}

// --- browser_intercept_network ------------------------------------------------

/**
 * Hook into Playwright's network layer to intercept and log XHR/fetch responses.
 * action='start': begin capturing (optional url_filter substring match)
 * action='stop': remove the listener
 * action='read': return captured log (optionally filter by url substring)
 * action='clear': wipe the log without stopping
 */
export async function browserInterceptNetwork(
  sessionId: string,
  action: 'start' | 'stop' | 'read' | 'clear',
  urlFilter?: string,
  maxEntries = 200,
  options: { includeBodies?: boolean; bodyMaxChars?: number; statusMin?: number; statusMax?: number } = {},
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    try {
      const result = await callInHouseBrowser('network', {
        sessionId: resolved,
        action,
        urlFilter: String(urlFilter || '').trim(),
        maxEntries,
        includeBodies: options.includeBodies === true,
        bodyMaxChars: options.bodyMaxChars,
        statusMin: options.statusMin,
        statusMax: options.statusMax,
      });
      return formatInHouseNetworkResult(result, options);
    } catch (err: any) {
      return `ERROR: In-house browser network inspection failed: ${err.message}`;
    }
  }
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  if (session.transport === 'extension') {
    if (action === 'start') {
      _networkInterceptLog.set(resolved, []);
      _networkInterceptHandlers.set(resolved, () => {});
      return `Network observation started through the Personal Chrome extension${urlFilter ? ` (filter applied when reading: "${urlFilter}")` : ''}. Response bodies are not available through chrome.debugger.`;
    }
    if (action === 'stop') {
      _networkInterceptHandlers.delete(resolved);
      return `Network observation stopped. ${(_networkInterceptLog.get(resolved) || []).length} entries remain in the log.`;
    }
  }

  if (action === 'start') {
    const captureLimit = Math.max(1, Math.min(MAX_NETWORK_INTERCEPT_ENTRIES, Math.floor(Number(maxEntries || 200))));
    // Remove old handler if already intercepting
    const oldHandler = _networkInterceptHandlers.get(resolved);
    if (oldHandler) session.context.off('response', oldHandler);
    _networkInterceptLog.set(resolved, []);

    const handler = async (response: any) => {
      try {
        const url: string = response.url();
        if (urlFilter && !url.includes(urlFilter)) return;
        const log = _networkInterceptLog.get(resolved);
        if (!log || log.length >= captureLimit) return;
        const req = response.request();
        const headers = response.headers();
        const contentType = (headers['content-type'] || '').split(';')[0].trim();
        let body: string | undefined;
        // Bodies are opt-in so a diagnostic read cannot dominate model context.
        if (options.includeBodies === true && (contentType.includes('json') || contentType.startsWith('text/'))) {
          try {
            body = await response.text();
            const bodyMaxChars = Math.max(0, Math.min(20_000, Number(options.bodyMaxChars ?? 1000)));
            if (body && body.length > bodyMaxChars) body = body.slice(0, bodyMaxChars) + '�[truncated]';
          } catch { /* ignore */ }
        }
        log.push({ url, method: req.method(), status: response.status(), contentType, body, ts: Date.now() });
      } catch { /* ignore disposal errors */ }
    };
    _networkInterceptHandlers.set(resolved, handler);
    session.context.on('response', handler);
    const limit = String(captureLimit);
    const filterNote = urlFilter ? ` (url filter: "${urlFilter}")` : '';
    return `Network interception started${filterNote}. Capturing up to ${limit} responses. Use browser_intercept_network(action="read") to inspect, "stop" to disable.`;
  }

  if (action === 'stop') {
    const handler = _networkInterceptHandlers.get(resolved);
    if (handler) { session.context.off('response', handler); _networkInterceptHandlers.delete(resolved); }
    const count = (_networkInterceptLog.get(resolved) || []).length;
    return `Network interception stopped. ${count} entries in log � use action="read" to view.`;
  }

  if (action === 'clear') {
    _networkInterceptLog.set(resolved, []);
    return 'Network intercept log cleared.';
  }

  if (action === 'read') {
    const statusMin = Math.max(0, Number(options.statusMin ?? 0));
    const statusMax = Math.min(999, Number(options.statusMax ?? 999));
    const allMatching = (_networkInterceptLog.get(resolved) || []).filter(e => (!urlFilter || e.url.includes(urlFilter)) && e.status >= statusMin && e.status <= statusMax);
    const safeLimit = Math.max(1, Math.min(200, Number(maxEntries || 50)));
    const log = allMatching.slice(-safeLimit);
    if (log.length === 0) {
      return _networkInterceptHandlers.has(resolved)
        ? 'No matching network responses captured yet (interception is active).'
        : 'No entries � start interception first with action="start".';
    }
    const lines = log.map(e => {
      const time = new Date(e.ts).toISOString().slice(11, 23);
      const bodyLine = e.body ? `\n    Body: ${e.body.replace(/\n/g, ' ')}` : '';
      return `[${time}] ${e.method} ${e.status} ${e.contentType}\n    ${e.url}${bodyLine}`;
    });
    return `Network log (${log.length} returned of ${allMatching.length} matching; bodies=${options.includeBodies === true ? 'included' : 'omitted'}):\n\n${lines.join('\n\n')}`;
  }

  return 'ERROR: action must be "start", "stop", "read", or "clear".';
}
