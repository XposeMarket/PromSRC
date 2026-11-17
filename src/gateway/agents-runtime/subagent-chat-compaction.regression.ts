// Agent chat trace compaction: Nov 16 2026 Reel's agent-chats file reached
// 131 MB / 71 messages because every team-task reply stored its live trace
// twice with inline base64 screenshots. Reading 20 messages took 62 s.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../../config/config';
import { compactTraceEntries, compactTraceValue } from './subagent-chat-compaction';
import {
  AGENT_CHAT_TRACE_STORAGE_VERSION,
  appendSubagentChatMessage,
  getSubagentChatContextState,
  getSubagentChatHistory,
  toLiteChatMessage,
  toStoredChatMessage,
} from './subagent-chat-store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-compaction-'));
const config = getConfig() as any;
const origConfigDir = config.getConfigDir;
const origWorkspace = config.getWorkspacePath;
config.getConfigDir = () => path.join(dir, 'config');
config.getWorkspacePath = () => path.join(dir, 'workspace');

try {
  const imageBytes = Buffer.alloc(1_200_000, 7);
  const dataUrl = `data:image/png;base64,${imageBytes.toString('base64')}`;
  const visionEntry = (i: number) => ({
    id: `trace_${i}`, type: 'vision', text: 'Vision captured', time: i,
    extra: { event: 'vision', source: 'browser', preview: { dataUrl, mimeType: 'image/png', width: 10, height: 10 } },
    preview: { dataUrl, mimeType: 'image/png' },
  });
  const trace = [visionEntry(1), { id: 'trace_2', type: 'tool', text: 'x'.repeat(10_000), time: 2 }];

  // Pure compaction: image moved to a file, long text bounded, small values untouched.
  {
    const urls: string[] = [];
    const out = compactTraceValue(trace[0], (url) => { urls.push(url); return '/api/canvas/generated-image-preview?cache=x.png'; }) as any;
    assert.equal(urls.length, 2);
    assert.equal(out.extra.preview.dataUrl, '/api/canvas/generated-image-preview?cache=x.png');
    assert.equal(out.extra.preview.width, 10);
    const long = compactTraceEntries([trace[1]], () => null)![0];
    assert.ok(long.text.length < 1_600 && /truncated 8500 chars/.test(long.text));
    assert.deepEqual(compactTraceValue({ a: 'short', n: 3, b: true }, () => null), { a: 'short', n: 3, b: true });
    // Non-image inline data is dropped; unstorable images get a placeholder.
    assert.equal(compactTraceValue(`data:application/pdf;base64,${'A'.repeat(5000)}`, () => null), '[inline data omitted]');
    assert.equal(compactTraceValue(dataUrl, () => null), '[inline image omitted]');
  }

  // Storage shape: identical top-level + metadata trace stored once.
  {
    const arr = [{ id: 't1' }];
    const stored = toStoredChatMessage({ id: 'm', liveTraceEntries: arr, metadata: { liveTraceEntries: arr } });
    assert.equal('liveTraceEntries' in stored, false);
    assert.deepEqual(stored.metadata.liveTraceEntries, arr);
    const distinct = toStoredChatMessage({ id: 'm', liveTraceEntries: [{ id: 'a' }], metadata: { liveTraceEntries: [{ id: 'b' }] } });
    assert.ok(Array.isArray(distinct.liveTraceEntries));
  }

  // Legacy bloated file is upgraded in place with a backup, nothing lost.
  const chats = path.join(dir, 'config', 'agent-chats');
  fs.mkdirSync(chats, { recursive: true });
  const file = path.join(chats, 'reel.json');
  const legacy = {
    agentId: 'reel',
    latestContextSummary: 'summary kept',
    contextSummaryUpdatedAt: 123,
    messages: [
      { id: 'u1', agentId: 'reel', role: 'user', content: 'post it', ts: 1000 },
      { id: 'a1', agentId: 'reel', role: 'agent', content: 'posted', ts: 2000, liveTraceEntries: trace,
        metadata: { source: 'request_team_member_turn', taskId: 't', liveTraceEntries: trace, processEntries: [{ id: 'p1', text: 'ok' }] } },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(legacy, null, 2));
  const before = fs.statSync(file).size;
  assert.ok(before > 6_000_000, `fixture should be large, got ${before}`);

  const history = getSubagentChatHistory('reel', 20);
  assert.equal(history.length, 2);
  const agentMsg = history[1] as any;
  assert.equal(agentMsg.content, 'posted');
  assert.equal(agentMsg.metadata.taskId, 't');
  const preview = agentMsg.metadata.liveTraceEntries[0].extra.preview;
  assert.match(preview.dataUrl, /^\/api\/canvas\/generated-image-preview\?cache=agent-trace-[0-9a-f]{32}\.png$/);
  assert.ok(Array.isArray(agentMsg.liveTraceEntries) && agentMsg.liveTraceEntries.length === 2, 'trace re-hoisted on read');
  const cached = path.join(dir, 'config', 'cache', 'images', decodeURIComponent(preview.dataUrl.split('cache=')[1]));
  assert.deepEqual(fs.readFileSync(cached), imageBytes, 'image bytes preserved in cache file');

  const after = fs.statSync(file).size;
  assert.ok(after < 40_000, `compacted file should be small, got ${after}`);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.traceStorageVersion, AGENT_CHAT_TRACE_STORAGE_VERSION);
  assert.equal(onDisk.latestContextSummary, 'summary kept');
  assert.equal(onDisk.messages.length, 2);
  assert.equal('liveTraceEntries' in onDisk.messages[1], false, 'duplicate top-level trace not stored');
  const backup = path.join(chats, 'backup-pre-trace-compaction', 'reel.json');
  assert.equal(fs.statSync(backup).size, before, 'original backed up byte-for-byte');
  assert.equal(getSubagentChatContextState('reel').latestContextSummary, 'summary kept');

  // Second read is a no-op (version marker) and the backup is not overwritten.
  const mtime = fs.statSync(file).mtimeMs;
  getSubagentChatHistory('reel', 20);
  assert.equal(fs.statSync(file).mtimeMs, mtime);

  // New writes are compacted too.
  appendSubagentChatMessage('reel', { role: 'agent', content: 'second', liveTraceEntries: [visionEntry(9)], metadata: { liveTraceEntries: [visionEntry(9)] } });
  const appended = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(appended.messages.length, 3);
  assert.ok(fs.statSync(file).size < 60_000, `append stayed small: ${fs.statSync(file).size}`);
  assert.ok(!JSON.stringify(appended).includes('base64,'), 'no inline base64 on disk');

  // Lite preview shape drops traces everywhere but keeps content/source.
  const lite = toLiteChatMessage(getSubagentChatHistory('reel', 20)[1] as any) as any;
  assert.equal(lite.content, 'posted');
  assert.equal(lite.metadata.taskId, 't');
  assert.equal('liveTraceEntries' in lite, false);
  assert.equal('liveTraceEntries' in lite.metadata, false);
  assert.equal('processEntries' in lite.metadata, false);

  console.log('subagent-chat-compaction regression: PASS');
} finally {
  config.getConfigDir = origConfigDir;
  config.getWorkspacePath = origWorkspace;
  fs.rmSync(dir, { recursive: true, force: true });
}
