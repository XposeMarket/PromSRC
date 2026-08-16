from pathlib import Path

p = Path('src/gateway/realtime/codex-app-server-bridge.ts')
text = p.read_text(encoding='utf-8')

if 'class CodexAppServerBridge {' not in text:
    raise SystemExit('bridge class anchor not found')
text = text.replace('class CodexAppServerBridge {', 'export class CodexAppServerBridge {', 1)

old_end = """  private handleProcessEnd(error: Error): void {\n    if (!this.child) return;\n    this.child = null;\n    this.cachedStatus = null;\n    for (const [id, pending] of this.pending) {\n      this.pending.delete(id);\n      clearTimeout(pending.timer);\n      pending.reject(error);\n    }\n    for (const waiter of this.notificationWaiters) {\n      clearTimeout(waiter.timer);\n      waiter.reject(error);\n    }\n    this.notificationWaiters.clear();\n    for (const pending of this.pendingDynamicToolRequests.values()) clearTimeout(pending.timer);\n    this.pendingDynamicToolRequests.clear();\n  }\n"""
new_end = """  private clearProcessBoundState(error: Error): void {\n    this.cachedStatus = null;\n    for (const [id, pending] of this.pending) {\n      this.pending.delete(id);\n      clearTimeout(pending.timer);\n      pending.reject(error);\n    }\n    for (const waiter of this.notificationWaiters) {\n      clearTimeout(waiter.timer);\n      waiter.reject(error);\n    }\n    this.notificationWaiters.clear();\n    for (const session of this.sessions.values()) {\n      for (const waiter of session.eventWaiters) {\n        clearTimeout(waiter.timer);\n        waiter.resolve([]);\n      }\n      session.eventWaiters.clear();\n    }\n    this.sessions.clear();\n    this.pendingRealtimeEvents.clear();\n    for (const pending of this.pendingDynamicToolRequests.values()) clearTimeout(pending.timer);\n    this.pendingDynamicToolRequests.clear();\n  }\n\n  private handleProcessEnd(error: Error): void {\n    if (!this.child) return;\n    this.child = null;\n    this.clearProcessBoundState(error);\n  }\n"""
if old_end not in text:
    raise SystemExit('process-end anchor not found')
text = text.replace(old_end, new_end, 1)

old_start = """    const outcomePromise = this.waitForNotification(\n      ['thread/realtime/sdp', 'thread/realtime/error'],\n      (params) => String(params?.threadId || '') === threadId,\n      REALTIME_START_TIMEOUT_MS,\n    );\n    const startedPromise = this.waitForNotification(\n      ['thread/realtime/started'],\n      (params) => String(params?.threadId || '') === threadId,\n      REALTIME_START_TIMEOUT_MS,\n    ).catch(() => null);\n\n    await this.request('thread/realtime/start', {\n      threadId,\n      // Frameless Bidi v3 uses the original Codex Voice (`v1`) catalog.\n      version: REALTIME_CONVERSATION_VERSION,\n      outputModality: 'audio',\n      voice: resolvedVoice,\n      prompt: input.prompt,\n      transport: { type: 'webrtc', sdp: input.sdp },\n    }, REALTIME_START_TIMEOUT_MS);\n\n    const outcome = await outcomePromise;\n    if (outcome.method === 'thread/realtime/error') {\n      throw new Error(String(outcome.params?.message || 'Codex realtime session failed.'));\n    }\n    const answerSdp = normalizeRealtimeSdp(outcome.params?.sdp);\n    if (!answerSdp.startsWith('v=')) throw new Error('Codex realtime did not return a valid SDP answer.');\n\n    const started = await Promise.race([\n      startedPromise,\n      new Promise<null>((resolve) => {\n        const timer = setTimeout(() => resolve(null), 500);\n        timer.unref?.();\n      }),\n    ]);\n    const sessionId = randomUUID();\n    const events = this.pendingRealtimeEvents.get(threadId) || [];\n    this.pendingRealtimeEvents.delete(threadId);\n    this.sessions.set(sessionId, {\n      threadId,\n      ownerSessionId: String(input.ownerSessionId || '').trim(),\n      events,\n      eventWaiters: new Set(),\n    });\n    return {\n      sessionId,\n      threadId,\n      sdp: answerSdp,\n      realtimeSessionId: String(started?.params?.realtimeSessionId || '').trim() || undefined,\n      realtimeReady: !!started,\n      voice: resolvedVoice,\n      realtimeVersion: REALTIME_CONVERSATION_VERSION,\n      voiceVersion: REALTIME_VOICE_CATALOG_VERSION,\n    };\n"""
new_start = """    try {\n      const outcomePromise = this.waitForNotification(\n        ['thread/realtime/sdp', 'thread/realtime/error'],\n        (params) => String(params?.threadId || '') === threadId,\n        REALTIME_START_TIMEOUT_MS,\n      );\n      const startedPromise = this.waitForNotification(\n        ['thread/realtime/started'],\n        (params) => String(params?.threadId || '') === threadId,\n        REALTIME_START_TIMEOUT_MS,\n      ).catch(() => null);\n\n      await this.request('thread/realtime/start', {\n        threadId,\n        // Frameless Bidi v3 uses the original Codex Voice (`v1`) catalog.\n        version: REALTIME_CONVERSATION_VERSION,\n        outputModality: 'audio',\n        voice: resolvedVoice,\n        prompt: input.prompt,\n        transport: { type: 'webrtc', sdp: input.sdp },\n      }, REALTIME_START_TIMEOUT_MS);\n\n      const outcome = await outcomePromise;\n      if (outcome.method === 'thread/realtime/error') {\n        throw new Error(String(outcome.params?.message || 'Codex realtime session failed.'));\n      }\n      const answerSdp = normalizeRealtimeSdp(outcome.params?.sdp);\n      if (!answerSdp.startsWith('v=')) throw new Error('Codex realtime did not return a valid SDP answer.');\n\n      const started = await Promise.race([\n        startedPromise,\n        new Promise<null>((resolve) => {\n          const timer = setTimeout(() => resolve(null), 500);\n          timer.unref?.();\n        }),\n      ]);\n      const sessionId = randomUUID();\n      const events = this.pendingRealtimeEvents.get(threadId) || [];\n      this.pendingRealtimeEvents.delete(threadId);\n      this.sessions.set(sessionId, {\n        threadId,\n        ownerSessionId: String(input.ownerSessionId || '').trim(),\n        events,\n        eventWaiters: new Set(),\n      });\n      return {\n        sessionId,\n        threadId,\n        sdp: answerSdp,\n        realtimeSessionId: String(started?.params?.realtimeSessionId || '').trim() || undefined,\n        realtimeReady: !!started,\n        voice: resolvedVoice,\n        realtimeVersion: REALTIME_CONVERSATION_VERSION,\n        voiceVersion: REALTIME_VOICE_CATALOG_VERSION,\n      };\n    } catch (error) {\n      // Notifications can arrive before the browser session is materialized.\n      // A failed start has no future owner for that event tail, so do not pin it\n      // by threadId for the lifetime of the gateway.\n      this.pendingRealtimeEvents.delete(threadId);\n      throw error;\n    }\n"""
if old_start not in text:
    raise SystemExit('realtime start block anchor not found')
text = text.replace(old_start, new_start, 1)

old_shutdown = """  shutdown(): void {\n    const child = this.child;\n    this.child = null;\n    this.cachedStatus = null;\n    if (!child) return;\n    try { child.stdin.end(); } catch {}\n    try { child.kill(); } catch {}\n  }\n"""
new_shutdown = """  shutdown(): void {\n    const child = this.child;\n    this.child = null;\n    this.clearProcessBoundState(new Error('Codex app-server bridge shut down.'));\n    if (!child) return;\n    try { child.stdin.end(); } catch {}\n    try { child.kill(); } catch {}\n  }\n"""
if old_shutdown not in text:
    raise SystemExit('shutdown anchor not found')
text = text.replace(old_shutdown, new_shutdown, 1)
p.write_text(text, encoding='utf-8')

reg = Path('src/gateway/realtime/codex-app-server-bridge.regression.ts')
reg.write_text(r'''import assert from 'node:assert/strict';
import { CodexAppServerBridge } from './codex-app-server-bridge.js';

const cleanup = new CodexAppServerBridge() as any;
let pendingRejected = 0;
let notificationRejected = 0;
let eventWaiterResolved = 0;
cleanup.pending.set(1, { timer: setTimeout(() => {}, 60_000), reject: () => { pendingRejected += 1; } });
cleanup.notificationWaiters.add({ timer: setTimeout(() => {}, 60_000), reject: () => { notificationRejected += 1; } });
cleanup.pendingRealtimeEvents.set('dead-thread', [{ id: 1 }]);
cleanup.pendingDynamicToolRequests.set('tool-1', { threadId: 'dead-thread', requestId: 1, timer: setTimeout(() => {}, 60_000) });
cleanup.sessions.set('dead-session', {
  threadId: 'dead-thread',
  ownerSessionId: 'owner',
  events: [],
  eventWaiters: new Set([{ afterId: 0, timer: setTimeout(() => {}, 60_000), resolve: () => { eventWaiterResolved += 1; } }]),
});
cleanup.shutdown();
assert.equal(cleanup.pending.size, 0);
assert.equal(cleanup.notificationWaiters.size, 0);
assert.equal(cleanup.pendingRealtimeEvents.size, 0);
assert.equal(cleanup.pendingDynamicToolRequests.size, 0);
assert.equal(cleanup.sessions.size, 0);
assert.equal(pendingRejected, 1);
assert.equal(notificationRejected, 1);
assert.equal(eventWaiterResolved, 1);

const failedStart = new CodexAppServerBridge() as any;
failedStart.ensureStarted = async () => {};
failedStart.status = async () => ({
  available: true,
  activeVoices: ['cove'],
  defaultVoice: 'cove',
});
failedStart.waitForNotification = async (methods: string[]) => methods.includes('thread/realtime/sdp')
  ? { method: 'thread/realtime/sdp', params: { threadId: 'thread-fail', sdp: 'v=0\r\n' } }
  : { method: 'thread/realtime/started', params: { threadId: 'thread-fail' } };
failedStart.request = async (method: string) => {
  if (method === 'account/read') return { account: { type: 'chatgpt' } };
  if (method === 'thread/start') return { thread: { id: 'thread-fail' } };
  if (method === 'thread/realtime/start') {
    failedStart.pendingRealtimeEvents.set('thread-fail', [{ id: 1 }]);
    throw new Error('synthetic start failure');
  }
  return {};
};
await assert.rejects(
  failedStart.startRealtimeSession({ sdp: 'v=0\r\n', prompt: 'test', voice: 'cove', cwd: process.cwd() }),
  /synthetic start failure/,
);
assert.equal(failedStart.pendingRealtimeEvents.has('thread-fail'), false, 'failed starts must discard unowned pre-session event tails');

console.log('codex realtime cache cleanup regression: ok');
''', encoding='utf-8')
print('codex realtime cache cleanup patch applied')
