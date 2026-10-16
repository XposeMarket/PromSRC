import assert from 'node:assert/strict';
import {
  CodexAppServerBridge,
  codexRealtimeModelCandidates,
  isCodexRealtimeModelRejection,
  selectCodexRealtimeVoiceCatalog,
} from './codex-app-server-bridge.js';

const REJECTED = '{"detail":"Field `session.model` is not allowed for this Codex realtime session"}';
const SDP = 'v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\n';

type Behavior = 'accept' | 'reject_model' | 'network';

function fakeBridge(behaviors: Record<string, Behavior>) {
  const bridge = new CodexAppServerBridge() as any;
  const startedModels: string[] = [];
  let threadCounter = 0;
  let currentModel = '';
  bridge.ensureStarted = async () => {};
  bridge.status = async () => ({
    available: true,
    voiceVersion: 'v3',
    activeVoices: ['cove', 'viola'],
    defaultVoice: 'cove',
  });
  bridge.request = async (method: string, params: any) => {
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'thread/start') {
      threadCounter += 1;
      return { thread: { id: `thread-${threadCounter}` } };
    }
    if (method === 'thread/realtime/start') {
      currentModel = String(params.model);
      startedModels.push(currentModel);
      return {};
    }
    return {};
  };
  // Resolves after the start request (mirrors the app-server's async notifications).
  bridge.waitForNotification = async (methods: string[]) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const threadId = `thread-${threadCounter}`;
    const behavior = behaviors[currentModel] || 'reject_model';
    if (methods.includes('thread/realtime/started')) {
      return { method: 'thread/realtime/started', params: { threadId, realtimeSessionId: threadId } };
    }
    if (behavior === 'accept') return { method: 'thread/realtime/sdp', params: { threadId, sdp: SDP } };
    if (behavior === 'network') return { method: 'thread/realtime/error', params: { threadId, message: 'connection reset by peer' } };
    return { method: 'thread/realtime/error', params: { threadId, message: REJECTED } };
  };
  return { bridge, startedModels };
}

async function main(): Promise<void> {
  const savedEnv = { ...process.env };
  delete process.env.PROMETHEUS_CODEX_REALTIME_MODELS;
  delete process.env.PROMETHEUS_CODEX_REALTIME_MODEL;

  // Candidate order: GPT-Live-1.1 first, Live-1 as the guaranteed last fallback.
  assert.deepEqual(codexRealtimeModelCandidates({}), ['gpt-live-1.1-codex', 'gpt-live-1-codex']);
  assert.deepEqual(
    codexRealtimeModelCandidates({ PROMETHEUS_CODEX_REALTIME_MODELS: 'gpt-live-1-codex, gpt-live-2-codex' }),
    ['gpt-live-2-codex', 'gpt-live-1-codex'],
    'env override keeps the Live-1 fallback last',
  );
  assert.deepEqual(
    codexRealtimeModelCandidates({ PROMETHEUS_CODEX_REALTIME_MODEL: 'bad model!' }),
    ['gpt-live-1.1-codex', 'gpt-live-1-codex'],
    'invalid override falls back to defaults',
  );

  assert.equal(isCodexRealtimeModelRejection(REJECTED), true);
  assert.equal(isCodexRealtimeModelRejection('model `gpt-live-1.1-codex` is not supported'), true);
  assert.equal(isCodexRealtimeModelRejection('connection reset by peer'), false);

  // Voice catalog: prefer the GPT-Live-1.1 v3 catalog when the runtime exposes it.
  const v3 = selectCodexRealtimeVoiceCatalog({
    v1: ['juniper', 'cove'], v3: ['juniper', 'cove', 'viola'], defaultV1: 'cove',
  });
  assert.deepEqual(v3, { version: 'v3', activeVoices: ['juniper', 'cove', 'viola'], defaultVoice: 'cove' });
  const v1 = selectCodexRealtimeVoiceCatalog({ v1: ['juniper', 'cove'], defaultV1: 'cove' });
  assert.deepEqual(v1, { version: 'v1', activeVoices: ['juniper', 'cove'], defaultVoice: 'cove' });

  // 1.1 accepted: used directly, no fallback.
  {
    const { bridge, startedModels } = fakeBridge({ 'gpt-live-1.1-codex': 'accept', 'gpt-live-1-codex': 'accept' });
    const session = await bridge.startRealtimeSession({ sdp: SDP, prompt: 'p', voice: 'viola', cwd: process.cwd() });
    assert.equal(session.model, 'gpt-live-1.1-codex');
    assert.equal(session.voice, 'viola');
    assert.equal(session.voiceVersion, 'v3');
    assert.equal(session.modelFallbackFrom, undefined);
    assert.deepEqual(startedModels, ['gpt-live-1.1-codex']);
  }

  // 1.1 rejected upstream: falls back to Live-1, then skips 1.1 on the next connect.
  {
    const { bridge, startedModels } = fakeBridge({ 'gpt-live-1.1-codex': 'reject_model', 'gpt-live-1-codex': 'accept' });
    const warn = console.warn;
    console.warn = () => {};
    const first = await bridge.startRealtimeSession({ sdp: SDP, prompt: 'p', voice: 'cove', cwd: process.cwd() });
    console.warn = warn;
    assert.equal(first.model, 'gpt-live-1-codex');
    assert.deepEqual(first.modelFallbackFrom, ['gpt-live-1.1-codex']);
    assert.equal(bridge.pendingRealtimeEvents.size, 0, 'rejected attempt must not leak an event tail');
    const second = await bridge.startRealtimeSession({ sdp: SDP, prompt: 'p', voice: 'cove', cwd: process.cwd() });
    assert.equal(second.model, 'gpt-live-1-codex');
    assert.deepEqual(startedModels, ['gpt-live-1.1-codex', 'gpt-live-1-codex', 'gpt-live-1-codex']);
    // After the retry window, 1.1 is tried again so a server-side rollout is picked up.
    bridge.rejectedRealtimeModels.set('gpt-live-1.1-codex', Date.now() - 24 * 60 * 60_000);
    assert.deepEqual(bridge.realtimeModelAttemptOrder(), ['gpt-live-1.1-codex', 'gpt-live-1-codex']);
  }

  // Non-model failures are not masked by a fallback attempt.
  {
    const { bridge, startedModels } = fakeBridge({ 'gpt-live-1.1-codex': 'network', 'gpt-live-1-codex': 'accept' });
    await assert.rejects(
      bridge.startRealtimeSession({ sdp: SDP, prompt: 'p', voice: 'cove', cwd: process.cwd() }),
      /connection reset by peer/,
    );
    assert.deepEqual(startedModels, ['gpt-live-1.1-codex']);
  }

  // Every candidate rejected: the original upstream error surfaces (classified by codex-realtime-errors).
  {
    const { bridge } = fakeBridge({});
    const warn = console.warn;
    console.warn = () => {};
    await assert.rejects(
      bridge.startRealtimeSession({ sdp: SDP, prompt: 'p', voice: 'cove', cwd: process.cwd() }),
      /session\.model/,
    );
    console.warn = warn;
  }

  process.env = savedEnv;
  console.log('codex realtime model fallback regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
