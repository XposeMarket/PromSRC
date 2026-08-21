export const STREAM_RENDER_THROTTLE_MS = 180;

const streamRenderTimers = new Map();

export function scheduleStreamingRenderFor(sessionId, renderFn) {
  const key = String(sessionId || '');
  if (!key || typeof renderFn !== 'function') {
    try { renderFn?.(); } catch {}
    return;
  }
  if (streamRenderTimers.has(key)) return;
  const handle = setTimeout(() => {
    streamRenderTimers.delete(key);
    try { renderFn(); } catch {}
  }, STREAM_RENDER_THROTTLE_MS);
  if (handle && typeof handle.unref === 'function') handle.unref();
  streamRenderTimers.set(key, handle);
}

export function flushStreamingRenderFor(sessionId, renderFn) {
  const key = String(sessionId || '');
  const handle = streamRenderTimers.get(key);
  if (handle) {
    clearTimeout(handle);
    streamRenderTimers.delete(key);
  }
  if (typeof renderFn === 'function') {
    try { renderFn(); } catch {}
  }
}
