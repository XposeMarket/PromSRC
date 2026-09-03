import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const baseUrl = new URL(process.env.PROMETHEUS_BENCHMARK_URL || 'http://127.0.0.1:32467/');
const messageCount = Math.max(1, Math.min(8, Number(process.env.PROMETHEUS_FIRST_TOKEN_MESSAGES || 3)));
const providerId = String(process.env.PROMETHEUS_FIRST_TOKEN_PROVIDER || 'openai_codex').trim();
const model = String(process.env.PROMETHEUS_FIRST_TOKEN_MODEL || 'gpt-5.6-luna').trim();
const reasoningEffort = String(process.env.PROMETHEUS_FIRST_TOKEN_REASONING || 'low').trim();
const timeoutMs = Math.max(30_000, Math.min(8 * 60_000, Number(process.env.PROMETHEUS_FIRST_TOKEN_TIMEOUT_MS || 240_000)));

function url(pathname) {
  return new URL(pathname, baseUrl);
}

async function request(pathname, options = {}) {
  const response = await fetch(url(pathname), {
    ...options,
    signal: options.signal || AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} ${response.status}: ${String(body?.error || text || 'request failed')}`);
  }
  return body;
}

function compactNumber(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : null;
}

async function streamTurn(sessionId, turnIndex) {
  const clientRequestId = `ttftbench_${crypto.randomUUID()}`;
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('first-token benchmark timeout')), timeoutMs);
  const response = await fetch(url('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      message: turnIndex === 0
        ? 'Reply with exactly: benchmark first.'
        : `Reply with exactly: benchmark follow-up ${turnIndex + 1}.`,
      sessionId,
      clientRequestId,
      // Keep this benchmark read-only and deterministic. The route only honors
      // these controls for origin.source=local_benchmark.
      toolFilter: ['timer'],
      memoryMode: 'compact',
      reasoning: { enabled: false },
      origin: {
        channel: 'web',
        surface: 'desktop_app',
        device: 'computer',
        label: 'First-token latency benchmark',
        source: 'local_benchmark',
      },
    }),
    signal: controller.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST /api/chat ${response.status}: ${text.slice(0, 300)}`);
  }

  const traceId = String(response.headers.get('x-prometheus-trace-id') || '').trim();
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstSseByteAt = null;
  let firstVisibleTokenAt = null;
  let firstReasoningAt = null;
  let clientDoneAt = null;
  let streamError = '';
  const serverMarks = {};

  const consumeLine = (line) => {
    if (!line.startsWith('data: ')) return false;
    let event;
    try { event = JSON.parse(line.slice(6)); } catch { return false; }
    const type = String(event?.type || '').trim();
    if (type === 'latency_mark') {
      const stage = String(event.stage || '').trim();
      if (stage) serverMarks[stage] = {
        elapsedMs: compactNumber(event.elapsedMs),
        providerTtftMs: compactNumber(event.providerTtftMs),
        providerWaitMs: compactNumber(event.providerWaitMs),
      };
      if (stage === 'first_reasoning_delta' && firstReasoningAt === null) firstReasoningAt = performance.now();
      if (stage === 'first_visible_token' && firstVisibleTokenAt === null) firstVisibleTokenAt = performance.now();
    }
    if (type === 'token' && firstVisibleTokenAt === null && String(event.text || '')) firstVisibleTokenAt = performance.now();
    if (type === 'done' || type === 'error') {
      clientDoneAt ||= performance.now();
      if (type === 'error') streamError = String(event.message || event.error || 'gateway stream error');
      return true;
    }
    return false;
  };

  let terminalSeen = false;
  try {
    while (reader) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value?.byteLength && firstSseByteAt === null) firstSseByteAt = performance.now();
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (consumeLine(line)) terminalSeen = true;
      }
      if (terminalSeen) break;
    }
  } finally {
    clearTimeout(timeout);
    if (terminalSeen) {
      try { await reader?.cancel?.(); } catch {}
    }
    reader?.releaseLock?.();
  }
  if (streamError) throw new Error(streamError);

  return {
    turn: turnIndex + 1,
    traceId,
    clientRequestId,
    client: {
      firstSseByteMs: firstSseByteAt === null ? null : compactNumber(firstSseByteAt - startedAt),
      firstReasoningMs: firstReasoningAt === null ? null : compactNumber(firstReasoningAt - startedAt),
      firstVisibleTokenMs: firstVisibleTokenAt === null ? null : compactNumber(firstVisibleTokenAt - startedAt),
      doneMs: clientDoneAt === null ? null : compactNumber(clientDoneAt - startedAt),
      wallMs: compactNumber(performance.now() - startedAt),
    },
    server: serverMarks,
  };
}

async function main() {
  const sessionId = `ttftbench_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const results = [];
  try {
    await request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId, channel: 'web', title: 'First-token benchmark' }),
    });
    const route = await request(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, model, reasoningEffort }),
    });
    if (route?.chatModelRoute?.availability === 'unavailable') {
      throw new Error(String(route.chatModelRoute.error || 'requested benchmark route is unavailable'));
    }

    for (let turn = 0; turn < messageCount; turn += 1) {
      results.push(await streamTurn(sessionId, turn));
    }
    console.log(JSON.stringify({
      benchmark: 'first-token-latency',
      baseUrl: baseUrl.toString(),
      sessionId,
      route: { providerId, model, reasoningEffort },
      messages: messageCount,
      results,
      metricDefinitions: {
        firstVisibleTokenMs: 'client time to first non-empty visible assistant token',
        serverFirstVisibleTokenMs: 'server turn timing elapsedMs for first_visible_token',
        providerTtftMs: 'provider request start to first visible text delta',
        firstReasoningMs: 'time to first provider reasoning delta; not the visible-token metric',
      },
    }, null, 2));
  } finally {
    try {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    } catch {}
  }
}

main().catch((error) => {
  console.error(`[first-token benchmark] ${String(error?.message || error)}`);
  process.exitCode = 1;
});
