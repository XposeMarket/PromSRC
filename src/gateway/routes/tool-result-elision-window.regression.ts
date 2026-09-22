import assert from 'node:assert/strict';
import { elideStaleToolResults, TOOL_RESULT_ELISION_MARKER } from './tool-result-elision';

// Regression (2026-09-22): with keepRecentRounds=1 a result was shortened on the
// very next round. The model does not carry its reasoning forward between
// rounds, so a result elided one round after arriving is effectively lost and
// gets re-requested. Measured ~15 wasted re-reads in one main-chat turn.

function body(tag: string, n = 4000): string {
  return `${tag} `.padEnd(n, 'x');
}

function sequentialTurn(rounds: number, size = 4000): any[] {
  const messages: any[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }];
  for (let r = 0; r < rounds; r++) {
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${r}`, type: 'function', function: { name: 'workspace_read', arguments: '{}' } }] });
    messages.push({ role: 'tool', tool_call_id: `c${r}`, tool_name: 'workspace_read', content: body(`r${r}`, size) });
  }
  return messages;
}

const isElided = (m: any) => typeof m.content === 'string' && m.content.startsWith(TOOL_RESULT_ELISION_MARKER);

// 1. Single-call rounds: the previous round's result must survive the next round.
{
  const messages = sequentialTurn(3);
  elideStaleToolResults(messages);
  const tools = messages.filter((m) => m.role === 'tool');
  assert.equal(tools.some(isElided), false, 'results from the last few sequential rounds must stay verbatim');
}

// 2. A working window of recent output survives even past the round guarantee.
{
  const messages = sequentialTurn(10, 4000); // 40k chars total, under the 60k window
  elideStaleToolResults(messages);
  const tools = messages.filter((m) => m.role === 'tool');
  assert.equal(tools.filter(isElided).length, 0, 'recent output under the char budget must stay verbatim');
}

// 3. Long turns still shrink: very old output beyond the window is elided.
{
  const messages = sequentialTurn(40, 4000); // 160k chars
  const { elidedCount, savedChars } = elideStaleToolResults(messages);
  const tools = messages.filter((m) => m.role === 'tool');
  assert.ok(elidedCount > 0 && savedChars > 0, 'old output beyond the window must still be elided');
  assert.equal(isElided(tools[0]), true, 'oldest result is elided');
  assert.equal(isElided(tools[tools.length - 1]), false, 'newest result is never elided');
  assert.equal(isElided(tools[tools.length - 2]), false, 'previous result is never elided');
  // Protected window is contiguous: once verbatim, everything newer is verbatim.
  const firstVerbatim = tools.findIndex((m) => !isElided(m));
  assert.equal(tools.slice(firstVerbatim).some(isElided), false, 'protected window must be contiguous');
}

// 4. Budget can be disabled explicitly for callers that want the old behavior.
{
  const messages = sequentialTurn(10, 4000);
  const { elidedCount } = elideStaleToolResults(messages, { keepRecent: 0, keepRecentRounds: 1, recentBudgetChars: 0 });
  assert.equal(elidedCount, 9, 'explicit minimal options still elide everything but the last round');
}

console.log('tool-result-elision-window regression passed');
