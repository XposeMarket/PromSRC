import assert from 'node:assert/strict';
import { CodexAppServerBridge } from './codex-app-server-bridge.js';

async function main(): Promise<void> {
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
