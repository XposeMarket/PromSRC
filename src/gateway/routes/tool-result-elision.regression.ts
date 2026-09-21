/**
 * Regression coverage for stale tool-result elision.
 *
 * These assertions are written so that deleting or no-op-ing
 * elideStaleToolResults fails the suite. The savings assertions use real
 * payload sizes rather than "did not throw".
 */
import {
  elideStaleToolResults,
  TOOL_RESULT_ELISION_MARKER,
  TOOL_RESULT_ELISION_MIN_CHARS,
} from './tool-result-elision';

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(`tool-result-elision regression failed: ${message}`);
}

const BIG = 'x'.repeat(TOOL_RESULT_ELISION_MIN_CHARS * 3);

function toolMsg(toolName: string, content: any, id: string) {
  return { role: 'tool', tool_name: toolName, tool_call_id: id, content };
}

function totalChars(messages: Array<any>): number {
  return messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    if (Array.isArray(m.content)) {
      return sum + m.content.reduce(
        (inner: number, p: any) => inner + (p?.type === 'text' ? String(p.text || '').length : 0),
        0,
      );
    }
    return sum;
  }, 0);
}

// 1. Older results are elided; the newest keepRecent results stay verbatim.
{
  const messages = [
    { role: 'user', content: 'do the thing' },
    toolMsg('run_command', `old-1 ${BIG}`, 'c1'),
    toolMsg('run_command', `old-2 ${BIG}`, 'c2'),
    toolMsg('run_command', `recent-1 ${BIG}`, 'c3'),
    toolMsg('run_command', `recent-2 ${BIG}`, 'c4'),
    toolMsg('run_command', `recent-3 ${BIG}`, 'c5'),
  ];
  const before = totalChars(messages);
  const result = elideStaleToolResults(messages, { keepRecent: 3 });

  assert(result.elidedCount === 2, `expected 2 elided, got ${result.elidedCount}`);
  assert(result.savedChars > 0, 'expected a positive savedChars');
  assert(totalChars(messages) < before, 'expected total context chars to shrink');

  assert(String(messages[1].content).startsWith(TOOL_RESULT_ELISION_MARKER), 'oldest should be elided');
  assert(String(messages[2].content).startsWith(TOOL_RESULT_ELISION_MARKER), 'second oldest should be elided');
  assert(String(messages[3].content).includes(BIG), 'recent-1 must stay verbatim');
  assert(String(messages[4].content).includes(BIG), 'recent-2 must stay verbatim');
  assert(String(messages[5].content).includes(BIG), 'recent-3 must stay verbatim');

  // Provider pairing invariant: no message dropped, ids and order preserved.
  assert(messages.length === 6, 'no messages may be dropped');
  assert(
    messages.slice(1).map((m: any) => m.tool_call_id).join(',') === 'c1,c2,c3,c4,c5',
    'tool_call_id order/pairing must be preserved',
  );
  // A useful placeholder still identifies the tool and original size.
  assert(String(messages[1].content).includes('tool=run_command'), 'placeholder should name the tool');
  assert(String(messages[1].content).includes('original_chars='), 'placeholder should record original size');
}

// 2. Errors stay verbatim even when old: they drive retry decisions.
{
  const errorText = `Error: the term 'gh' is not recognized ${BIG}`;
  const messages = [
    toolMsg('run_command', errorText, 'e1'),
    toolMsg('run_command', `filler ${BIG}`, 'e2'),
    toolMsg('run_command', `filler ${BIG}`, 'e3'),
    toolMsg('run_command', `filler ${BIG}`, 'e4'),
    toolMsg('run_command', `filler ${BIG}`, 'e5'),
  ];
  elideStaleToolResults(messages, { keepRecent: 3 });
  assert(messages[0].content === errorText, 'error results must never be elided');
}

// 3. Short results are left alone; eliding them would cost more than it saves.
{
  const shortText = 'exit 0 ok';
  const messages = [
    toolMsg('run_command', shortText, 's1'),
    toolMsg('run_command', shortText, 's2'),
    toolMsg('run_command', shortText, 's3'),
    toolMsg('run_command', shortText, 's4'),
    toolMsg('run_command', shortText, 's5'),
  ];
  const result = elideStaleToolResults(messages, { keepRecent: 3 });
  assert(result.elidedCount === 0, 'short results should not be elided');
  assert(messages[0].content === shortText, 'short result must stay verbatim');
}

// 4. Exempt tools keep full content for the whole turn.
{
  const skillText = `SKILL BODY ${BIG}`;
  const messages = [
    toolMsg('skill_read', skillText, 'k1'),
    toolMsg('run_command', `filler ${BIG}`, 'k2'),
    toolMsg('run_command', `filler ${BIG}`, 'k3'),
    toolMsg('run_command', `filler ${BIG}`, 'k4'),
    toolMsg('run_command', `filler ${BIG}`, 'k5'),
  ];
  elideStaleToolResults(messages, { keepRecent: 3 });
  assert(messages[0].content === skillText, 'skill_read must stay verbatim');
}

// 5. Multimodal image parts survive; only old text parts shrink.
{
  const messages = [
    toolMsg('desktop_screenshot', [
      { type: 'image', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: `screen description ${BIG}` },
    ], 'm1'),
    toolMsg('run_command', `filler ${BIG}`, 'm2'),
    toolMsg('run_command', `filler ${BIG}`, 'm3'),
    toolMsg('run_command', `filler ${BIG}`, 'm4'),
    toolMsg('run_command', `filler ${BIG}`, 'm5'),
  ];
  elideStaleToolResults(messages, { keepRecent: 3 });
  const parts = messages[0].content as Array<any>;
  assert(parts.length === 2, 'multimodal parts must be preserved');
  assert(parts[0].type === 'image', 'image part must survive elision');
  assert(
    String(parts[1].text).startsWith(TOOL_RESULT_ELISION_MARKER),
    'old text part should be elided',
  );
}

// 6. Idempotent: a second pass does not re-elide or double-shrink.
{
  const messages = [
    toolMsg('run_command', `old ${BIG}`, 'i1'),
    toolMsg('run_command', `r ${BIG}`, 'i2'),
    toolMsg('run_command', `r ${BIG}`, 'i3'),
    toolMsg('run_command', `r ${BIG}`, 'i4'),
  ];
  const first = elideStaleToolResults(messages, { keepRecent: 3 });
  const snapshot = String(messages[0].content);
  const second = elideStaleToolResults(messages, { keepRecent: 3 });
  assert(first.elidedCount === 1, 'first pass should elide exactly one');
  assert(second.elidedCount === 0, 'second pass must be a no-op');
  assert(String(messages[0].content) === snapshot, 'content must be stable across passes');
}

// 7. Nothing happens when the turn is still short.
{
  const messages = [
    toolMsg('run_command', `only ${BIG}`, 'n1'),
    toolMsg('run_command', `only ${BIG}`, 'n2'),
  ];
  const before = totalChars(messages);
  const result = elideStaleToolResults(messages, { keepRecent: 3 });
  assert(result.elidedCount === 0, 'short turns should be untouched');
  assert(totalChars(messages) === before, 'short turns must not lose content');
}

// 8. Realistic long loop: savings should be substantial, not cosmetic.
{
  const messages: Array<any> = [{ role: 'user', content: 'long task' }];
  for (let i = 0; i < 15; i++) {
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `t${i}` }] });
    messages.push(toolMsg('run_command', `result ${i} ${BIG}`, `t${i}`));
  }
  const before = totalChars(messages);
  const result = elideStaleToolResults(messages);
  const after = totalChars(messages);
  assert(result.elidedCount === 12, `expected 12 elided in a 15-call turn, got ${result.elidedCount}`);
  assert(after < before * 0.35, `expected >65% reduction, got ${Math.round((after / before) * 100)}%`);
}

console.log('tool-result-elision regression passed');
