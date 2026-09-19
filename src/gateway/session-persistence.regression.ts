import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-session-persistence-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const sessionApi = await import('./session');
    const sessionId = 'session_persistence_regression';
    sessionApi.addMessage(sessionId, {
      role: 'user',
      content: 'first message',
      timestamp: Date.now(),
    });
    sessionApi.addMessage(sessionId, {
      role: 'assistant',
      content: 'first response',
      timestamp: Date.now() + 1,
    });

    const transcriptPath = path.join(root, 'audit', 'chats', 'transcripts', `${sessionId}.jsonl`);
    assert.equal(fs.existsSync(transcriptPath), false, 'message arrival must not synchronously write the transcript');
    await sessionApi.flushPendingChatAuditWrites();
    const transcriptRows = fs.readFileSync(transcriptPath, 'utf-8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(
      transcriptRows.map((row) => row.content),
      ['first message', 'first response'],
      'the async transcript queue must preserve per-session message order',
    );
    const auditStatus = sessionApi.getChatAuditPersistenceStatus();
    assert.equal(auditStatus.pendingRecords, 0);
    assert.equal(auditStatus.dropped, 0);
    assert.equal(auditStatus.markdownDropped, 0);

    await new Promise<void>((resolve) => setTimeout(resolve, 550));
    await sessionApi.flushPendingSessionWrites();
    const sessionPath = path.join(root, '.prometheus', 'sessions', `${sessionId}.json`);
    const indexPath = path.join(root, '.prometheus', 'sessions', '_index.json');
    assert.equal(fs.existsSync(sessionPath), true);
    assert.equal(fs.existsSync(indexPath), true);
    let stored = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    assert.equal(stored.history.length, 2);
    assert.equal(sessionApi.getSessionPersistenceStatus().pending, 0);

    sessionApi.addMessage(sessionId, {
      role: 'user',
      content: 'newest message',
      timestamp: Date.now() + 2,
    });
    sessionApi.flushSession(sessionId);
    await new Promise<void>((resolve) => setTimeout(resolve, 650));
    await sessionApi.flushPendingSessionWrites();
    stored = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    assert.equal(stored.history.at(-1)?.content, 'newest message', 'an older queued save must not overwrite a synchronous flush');

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    assert.equal(index.summaries[sessionId].messageCount, 3);

    const compactedSessionId = 'session_active-history-regression';
    sessionApi.addMessage(compactedSessionId, {
      role: 'user',
      content: 'before compaction request',
      timestamp: Date.now() + 10,
    });
    sessionApi.addMessage(compactedSessionId, {
      role: 'assistant',
      content: 'before compaction response',
      timestamp: Date.now() + 11,
    });
    sessionApi.addMessage(compactedSessionId, {
      role: 'user',
      content: 'active work after boundary',
      timestamp: Date.now() + 12,
    });
    sessionApi.recordSessionCompaction(
      compactedSessionId,
      'rolling',
      'Summary of everything before the active work boundary.',
      2,
    );
    sessionApi.addMessage(compactedSessionId, {
      role: 'assistant',
      content: 'active response after boundary',
      timestamp: Date.now() + 13,
    });
    assert.deepEqual(
      sessionApi.getActiveHistoryForPersistence(compactedSessionId, 20).map((message: any) => message.content),
      ['active work after boundary', 'active response after boundary'],
      'task and agent resume stores must persist only the active transcript after compaction',
    );
    sessionApi.recordSessionCompaction(
      compactedSessionId,
      'rolling',
      'Second summary retaining the first summary and later active work.',
      sessionApi.getSession(compactedSessionId).history.length,
    );
    sessionApi.addMessage(compactedSessionId, {
      role: 'user',
      content: 'work after the second compaction',
      timestamp: Date.now() + 14,
    });
    assert.deepEqual(
      sessionApi.getActiveHistoryForApiCall(compactedSessionId).map((message: any) => message.content),
      [
        '[Rolling context summary]\nSecond summary retaining the first summary and later active work.',
        'work after the second compaction',
      ],
      'a later compaction must replace the retained summary and advance the active-history boundary',
    );
    console.log('session persistence regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
