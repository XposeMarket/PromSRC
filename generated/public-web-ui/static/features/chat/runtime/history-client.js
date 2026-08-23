function cleanId(value) {
  return String(value ?? '').trim();
}

function parsedPayload(response) {
  if (response && typeof response.json === 'function') {
    if ('ok' in response && response.ok === false) {
      return response.text?.().then((text) => {
        throw new Error(text || `History page request failed (${response.status || 'unknown'})`);
      });
    }
    return response.json();
  }
  return Promise.resolve(response);
}

export function buildChatHistoryPagePath({ sessionId, before = '', limit = 50, mobile = false } = {}) {
  const sid = cleanId(sessionId);
  if (!sid) throw new Error('A history page request requires sessionId.');
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)))));
  if (cleanId(before)) params.set('before', cleanId(before));
  if (mobile) params.set('mobile', '1');
  params.set('includeToolLog', '0');
  return `/api/sessions/${encodeURIComponent(sid)}/history-page?${params}`;
}

export function validateChatHistoryPage(payload, sessionId = '') {
  const page = payload && typeof payload === 'object' ? payload : {};
  if (!Array.isArray(page.items) || !page.pageInfo || typeof page.pageInfo !== 'object') {
    throw new Error('Gateway returned an invalid chat history page.');
  }
  const expected = cleanId(sessionId);
  const actual = cleanId(page.sessionId);
  if (expected && actual && expected !== actual) throw new Error('Gateway returned history for a different session.');
  return {
    sessionId: actual || expected,
    items: page.items,
    pageInfo: {
      olderCursor: cleanId(page.pageInfo.olderCursor) || null,
      hasOlder: page.pageInfo.hasOlder === true,
      totalCount: Math.max(page.items.length, Number(page.pageInfo.totalCount || 0) || 0),
      loadedCount: page.items.length,
      startKey: cleanId(page.pageInfo.startKey) || null,
      endKey: cleanId(page.pageInfo.endKey) || null,
    },
  };
}

export function createChatHistoryClient({ request = globalThis.fetch?.bind(globalThis), mobile = false } = {}) {
  if (typeof request !== 'function') throw new TypeError('createChatHistoryClient requires a request function.');
  const inFlight = new Map();
  return Object.freeze({
    async loadOlder({ sessionId, before, limit = 50, signal } = {}) {
      const path = buildChatHistoryPagePath({ sessionId, before, limit, mobile });
      const key = `${path}|${signal ? 'signal' : 'shared'}`;
      if (!signal && inFlight.has(key)) return inFlight.get(key);
      const operation = Promise.resolve(request(path, { method: 'GET', signal }))
        .then(parsedPayload)
        .then((payload) => validateChatHistoryPage(payload, sessionId))
        .finally(() => {
          if (inFlight.get(key) === operation) inFlight.delete(key);
        });
      if (!signal) inFlight.set(key, operation);
      return operation;
    },
  });
}
