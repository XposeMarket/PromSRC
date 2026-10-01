import { performance } from 'node:perf_hooks';
import { createSessionPersistenceScheduler } from '../web-ui/src/features/chat/core/session-persistence-scheduler.js';

// Deterministic logical time; CPU serialization time is measured separately.
const sessions = Array.from({ length: 40 }, (_, n) => ({ id: `session-${n}`, title: `Session ${n}`, summary: 'indexed notes '.repeat(270), history: Array.from({ length: 200 }, (_, j) => ({ role: j % 2 ? 'assistant' : 'user', content: `Conversation ${n} message ${j}: ` + 'text '.repeat(35), timestamp: j })) }));
const snapshot = () => sessions.map(s => ({ ...s, history: s.history.slice(-4) }));
function bench(scheduled) {
  let now = 0, nextId = 0, stringifyMs = 0, calls = 0, bytes = 0;
  const timers = new Map();
  const localStorage = { setItem(_key, value) { calls++; bytes += Buffer.byteLength(value); } };
  let last = null;
  const save = () => {
    const t = performance.now();
    const value = JSON.stringify(snapshot());
    stringifyMs += performance.now() - t;
    if (scheduled && value === last) return;
    localStorage.setItem('prometheus_chat_sessions_v1', value);
    last = value;
  };
  const scheduler = createSessionPersistenceScheduler({ save, now: () => now, backgroundDelayMs: 4000,
    setTimer(fn, ms) { const id = ++nextId; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimer(id) { timers.delete(id); },
  });
  function advance(to) {
    while (true) {
      const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > to) break;
      timers.delete(next[0]); now = next[1].due; next[1].fn();
    }
    now = to;
  }
  // Three other sessions stream while foreground is idle. Bookkeeping wakes 20 times in 20s;
  // four extra background persistSession callbacks mirror measured live stacks.
  for (let second = 0; second < 20; second++) {
    advance(second * 1000);
    sessions[second % 3].updatedAt = second + 1;
    if (scheduled) scheduler.schedule({ background: true }); else save();
    if (second % 5 === 0) { if (scheduled) scheduler.schedule({ background: true }); else save(); }
  }
  advance(20000);
  const background = { calls, bytes, stringifyMs: +stringifyMs.toFixed(2) };
  // A separate 3000-token + 60-tool-event stream across the same 40-session index.
  calls = 0; bytes = 0; stringifyMs = 0;
  for (let i = 0; i < 3060; i++) {
    advance(21000 + i * 7);
    if (i % 51 === 0) sessions[i % 40].updatedAt = i;
    if (scheduled) scheduler.schedule({ background: true }); else save();
  }
  if (scheduled) scheduler.flush();
  return { background, longStream: { calls, bytes, stringifyMs: +stringifyMs.toFixed(2) } };
}
const before = bench(false), after = bench(true);
console.log(JSON.stringify({ scenario: 'idle desktop / three background sessions streaming 20s; 3000 tokens + 60 tools', before, after }, null, 2));
