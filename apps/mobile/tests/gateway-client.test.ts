import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayClient } from '../src/core/gateway/gateway-client';
import { PairingClient } from '../src/core/auth/pairing-client';
import { parseSseFrame, parseSseJson, normalizeGatewayChatEvent } from '../src/core/transport/sse';
import { GatewayHttpError } from '../src/core/transport/http-client';
import { GatewayCredentialStore } from '../src/core/storage/gateway-credentials';
import { MemoryKeyValueStorage } from '../src/core/storage/storage';

test('gateway client keeps origin and token scoped while listing, creating, and loading history', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith('/api/sessions?scope=all&includeAutomated=1&state=all&limit=80&offset=0')) {
      return Response.json({ sessions: [{ id: 's-1', title: 'One' }], total: 3 });
    }
    if (url.endsWith('/api/sessions')) return Response.json({ success: true, session: { id: 's-2', channel: 'mobile', title: 'New Chat' } });
    if (url.includes('/history-page?')) return Response.json({ sessionId: 's-1', items: [{ role: 'assistant', content: 'Hello' }], pageInfo: { hasOlder: false, totalCount: 1 } });
    throw new Error(`Unexpected request: ${url}`);
  };
  const gateway = new GatewayClient({ id: 'work', name: 'Work PC', origin: 'https://work.example/base/path', token: 'token-work', fetch: mockFetch });

  assert.equal(gateway.origin, 'https://work.example');
  assert.deepEqual(await gateway.sessions.list(), { sessions: [{ id: 's-1', title: 'One' }], total: 3 });
  assert.deepEqual(await gateway.sessions.create({ title: 'New Chat' }), { id: 's-2', channel: 'mobile', title: 'New Chat' });
  const history = await gateway.sessions.history('s/1', { before: 'older-key', limit: 20 });
  assert.equal(history.items.length, 1);
  assert.ok(requests[2].url.includes('/api/sessions/s%2F1/history-page?limit=20&mobile=1&before=older-key'));
  for (const request of requests) {
    assert.equal(new Headers(request.init?.headers).get('X-Pairing-Token'), 'token-work');
    assert.ok(request.url.startsWith('https://work.example/'));
  }
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { channel: 'mobile', title: 'New Chat' });
});

test('pairing claim and approval polling preserve Prometheus fingerprint contract', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json(requests.length === 1
      ? { success: true, requestId: 'request-1', gateway: { id: 'gw' } }
      : { success: true, status: 'approved', deviceId: 'device-1', deviceToken: 'grant-1', gateway: { id: 'gw' } });
  };
  const pairing = new PairingClient({ origin: 'https://pair.example', fetch: mockFetch });
  const claim = await pairing.claim({ code: 'PAIR-ABCD-1234', deviceName: 'iPhone', deviceFingerprint: 'fingerprint-1' });
  const poll = await pairing.poll(claim.requestId!, 'fingerprint-1');
  assert.equal(requests[0].url, 'https://pair.example/api/pairing/claim');
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { code: 'PAIR-ABCD-1234', deviceName: 'iPhone', deviceFingerprint: 'fingerprint-1' });
  assert.equal(new Headers(requests[1].init?.headers).get('X-Pairing-Device-Fingerprint'), 'fingerprint-1');
  assert.equal(poll.deviceToken, 'grant-1');
});

test('chat posts the mobile contract, normalizes SSE, and honors caller abort signal', async () => {
  let request: { url?: string; init?: RequestInit } = {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"token","text":"Hi"}\n\ndata: {"type":"final","text":"Hello"}\n\ndata: {"type":"done"}\n\n'));
      controller.close();
    },
  });
  const mockFetch: typeof fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const gateway = new GatewayClient({ id: 'phone-home', name: 'Home', origin: 'http://100.64.0.4:32466', token: 'home-token', fetch: mockFetch });
  const controller = new AbortController();
  const events: string[] = [];
  const result = await gateway.chat.stream({
    message: 'Hi', sessionId: 'mobile_1', clientRequestId: 'client-1', signal: controller.signal,
    onEvent: (event) => events.push(event.type),
  });

  assert.equal(request.url, 'http://100.64.0.4:32466/api/chat');
  assert.equal(new Headers(request.init?.headers).get('X-Pairing-Token'), 'home-token');
  assert.equal(new Headers(request.init?.headers).get('Accept'), 'text/event-stream');
  const posted = JSON.parse(String(request.init?.body));
  assert.equal(posted.sessionId, 'mobile_1');
  assert.equal(posted.clientRequestId, 'client-1');
  assert.equal(posted.origin.source, 'mobile_v2');
  assert.deepEqual(events, ['assistant.delta', 'assistant.done']);
  assert.equal(result.event.type, 'assistant.done');
  assert.equal(result.event.text, 'Hello');
  assert.equal(request.init?.signal, controller.signal);
});

test('SSE parser handles named multiline frames and stream aliases', () => {
  const frame = parseSseFrame(': keepalive\r\nevent: token\r\ndata: {"text":\r\ndata: "hi"}\r\n\r\n');
  assert.deepEqual(frame, { event: 'token', data: '{"text":\n"hi"}' });
  const raw = parseSseJson(frame!);
  assert.equal(raw?.type, 'token');
  assert.deepEqual(normalizeGatewayChatEvent(raw!), { type: 'assistant.delta', text: 'hi', raw });
  assert.equal(normalizeGatewayChatEvent({ type: 'thinking_delta', thinking: 'considering' }).type, 'reasoning.delta');
  assert.equal(normalizeGatewayChatEvent({ type: 'tool_result', name: 'lookup' }).type, 'tool.activity');
});

test('chat stream abort signal cancels consumption and HTTP failures are typed', async () => {
  const controller = new AbortController();
  const streamBody = new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new TextEncoder().encode('data: {"type":"token","text":"partial"}\n\n')); },
  });
  const gateway = new GatewayClient({
    id: 'gw', name: 'Gateway', origin: 'https://gateway.example', token: 'token',
    fetch: async () => new Response(streamBody, { headers: { 'Content-Type': 'text/event-stream' } }),
  });
  await assert.rejects(gateway.chat.stream({
    message: 'Continue', sessionId: 'session-1', signal: controller.signal,
    onEvent: () => controller.abort(new DOMException('Stopped by caller.', 'AbortError')),
  }), { name: 'AbortError' });

  const failing = new GatewayClient({
    id: 'gw', name: 'Gateway', origin: 'https://gateway.example', token: 'token',
    fetch: async () => Response.json({ code: 'DEVICE_REVOKED', error: 'Pairing was revoked.' }, { status: 401 }),
  });
  await assert.rejects(failing.sessions.list(), (error: unknown) => error instanceof GatewayHttpError
    && error.status === 401 && error.code === 'DEVICE_REVOKED');
});

test('gateway credentials persist independently by gateway id', () => {
  const storage = new MemoryKeyValueStorage();
  const credentials = new GatewayCredentialStore(storage);
  credentials.set('home', { token: 'home-token', deviceId: 'phone' });
  credentials.set('office', { token: 'office-token' });
  assert.equal(credentials.get('home')?.token, 'home-token');
  assert.equal(credentials.get('office')?.token, 'office-token');
  credentials.remove('home');
  assert.equal(credentials.get('home'), null);
  assert.equal(credentials.get('office')?.token, 'office-token');
});
