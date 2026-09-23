// Stream writers call replaceHistoryTurn(row, { key: <active stream turnKey> }).
// After a steer the target row is the continuation (`id:<group>:continuation`)
// and after a gateway restart the recovered row can carry its own id. Keying
// by the stream cursor there either appended a second copy of the row (the
// duplicate tool stream after a restart) or left the visible row stale (the
// steer continuation stuck on "..." until the thread was reopened).
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function main() {
  const mod: any = await import(pathToFileURL(path.resolve(__dirname, '../../web-ui/src/features/chat/runtime/chat-runtime.js')).href);
  const { ChatRuntime } = mod;
  const cid = 'mobile_x_req1';
  const G = 'chat_steer_1';

  // 1. Steer continuation receives stream frames in place.
  {
    const rt = new ChatRuntime({ sessionId: 's' });
    rt.replaceHistory([
      { role: 'user', clientRequestId: cid, content: 'hi' },
      { role: 'assistant', _clientRequestId: cid, messageId: `${G}:before`, workflowGroupId: G, workflowPart: 'before_interruption', content: 'before' },
      { role: 'user', messageId: 'steer1', content: 'steer', workflowGroupId: G, workflowPart: 'interruption' },
      { role: 'assistant', _clientRequestId: cid, messageId: `${G}:continuation`, workflowGroupId: G, workflowPart: 'interruption_response', content: '' },
    ]);
    rt.replaceHistoryTurn(
      { role: 'assistant', _clientRequestId: cid, messageId: `${G}:continuation`, workflowGroupId: G, workflowPart: 'interruption_response', content: 'after steer' },
      { key: `request:assistant:${cid}` },
    );
    const rows = rt.getSourceHistory();
    assert.equal(rows.length, 4, 'steer continuation must update in place, not append a copy');
    assert.equal(rows[3].content, 'after steer', 'continuation row must show post-steer stream text');
    assert.equal(rows[1].content, 'before', 'pre-steer row must stay frozen');
  }

  // 2. A restart-recovered row with its own id is not duplicated by the stream cursor.
  {
    const rt = new ChatRuntime({ sessionId: 's' });
    rt.replaceHistory([
      { role: 'user', clientRequestId: cid, content: 'hi' },
      { role: 'assistant', _clientRequestId: cid, messageId: 'turn_abc', content: 'pre-restart' },
    ]);
    for (let i = 0; i < 3; i += 1) {
      rt.replaceHistoryTurn({ role: 'assistant', _clientRequestId: cid, messageId: 'turn_abc', content: `post-restart ${i}` }, { key: `request:assistant:${cid}` });
    }
    const rows = rt.getSourceHistory();
    assert.equal(rows.length, 2, 'recovered row must not be duplicated across stream frames');
    assert.equal(rows[1].content, 'post-restart 2');
  }

  // 3. Ordinary streaming (row keyed only by request id) still works.
  {
    const rt = new ChatRuntime({ sessionId: 's' });
    rt.replaceHistory([{ role: 'user', clientRequestId: cid, content: 'hi' }, { role: 'assistant', _clientRequestId: cid, content: '' }]);
    rt.replaceHistoryTurn({ role: 'assistant', _clientRequestId: cid, content: 'a' }, { key: `request:assistant:${cid}` });
    rt.replaceHistoryTurn({ role: 'assistant', _clientRequestId: cid, content: 'ab' }, { key: `request:assistant:${cid}` });
    const rows = rt.getSourceHistory();
    assert.equal(rows.length, 2);
    assert.equal(rows[1].content, 'ab');
  }
  console.log('mobile-stream-row-identity regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
