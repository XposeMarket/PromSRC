import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendDurableCommentaryContext,
  buildDurableCommentaryContext,
} from './commentary-context';

const trace = [
  {
    type: 'think',
    text: 'I am checking the persisted progress before the next tool boundary.',
    extra: { source: 'agent_thought', visibility: 'user' },
  },
  {
    type: 'tool',
    text: 'Preparing workspace_run',
    extra: { action: 'workspace_run', toolName: 'workspace_run' },
  },
  {
    type: 'think',
    text: 'private provider chain of thought must stay hidden',
    extra: { source: 'provider_thinking', visibility: 'private' },
  },
];

const message = {
  role: 'assistant',
  content: 'The visible answer is complete.',
  timestamp: Date.now(),
  visibleReasoningSummary: 'The checkpoint is safe to continue from.',
  liveTraceEntries: trace,
};

const commentary = buildDurableCommentaryContext(message);
assert.match(commentary, /persisted progress/);
assert.match(commentary, /safe to continue/);
assert.match(commentary, /workspace_run/);
assert.doesNotMatch(commentary, /private provider chain of thought/);

const modelContent = appendDurableCommentaryContext(message.content, message);
assert.match(modelContent, /The visible answer is complete/);
assert.match(modelContent, /\[DURABLE_TURN_COMMENTARY\]/);

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-commentary-context-'));
process.env.PROMETHEUS_DATA_DIR = path.join(testRoot, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(testRoot, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main(): Promise<void> {
  try {
    const sessions = await import('../session');
    const sessionId = `commentary_context_${Date.now()}`;
    sessions.addMessage(sessionId, { role: 'user', content: 'Continue the work.', timestamp: Date.now() });
    sessions.addMessage(sessionId, message as any);
    sessions.addMessage(sessionId, { role: 'user', content: 'Now verify the next boundary.', timestamp: Date.now() });
    sessions.addMessage(sessionId, {
      role: 'assistant',
      content: 'The second boundary is also recorded.',
      timestamp: Date.now(),
      liveTraceEntries: [{
        type: 'preamble',
        text: 'The second turn is continuing from the first turn evidence.',
        extra: { source: 'agent_thought', visibility: 'user' },
      }],
    } as any);

    const active = sessions.getActiveHistoryForApiCall(sessionId);
    const activeAssistant = active.find((entry) => entry.role === 'assistant');
    const activeAssistantText = active.filter((entry) => entry.role === 'assistant').map((entry) => entry.content).join('\n');
    assert.match(String(activeAssistant?.content || ''), /\[DURABLE_TURN_COMMENTARY\]/);
    assert.match(activeAssistantText, /persisted progress/);
    assert.match(activeAssistantText, /second turn is continuing/);
    assert.doesNotMatch(activeAssistantText, /private provider chain of thought/);

    const raw = sessions.getHistoryForApiCall(sessionId, 20, { includeCommentaryContext: false });
    assert.doesNotMatch(String(raw.find((entry) => entry.role === 'assistant')?.content || ''), /\[DURABLE_TURN_COMMENTARY\]/);

    sessions.recordSessionCompaction(sessionId, 'rolling', 'The previous turns were summarized safely.', 4);
    const afterCompaction = sessions.getActiveHistoryForApiCall(sessionId).map((entry) => entry.content).join('\n');
    assert.match(afterCompaction, /previous turns were summarized safely/);
    assert.doesNotMatch(afterCompaction, /persisted progress/);
    assert.doesNotMatch(afterCompaction, /second turn is continuing/);
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
}

void main().then(() => {
  console.log('commentary-context regression: ok');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
