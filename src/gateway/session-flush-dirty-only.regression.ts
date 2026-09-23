// Shutdown used to rewrite every cached session (pretty-printed, synchronous),
// including sessions that were only loaded for reading. With multi-MB mobile
// threads that alone cost ~2s of every gateway restart. flushAllSessions must
// now write only sessions with unsaved changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-flush-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;

async function main() {
  const session = await import('./session');
  const { getSession, addMessage, flushAllSessions, sessionHasUnsavedChanges, flushPendingSessionWrites } = session as any;

  const readOnlyId = 'flushtest_readonly';
  const dirtyId = 'flushtest_dirty';

  // A session that is written once and settles on disk.
  getSession(readOnlyId);
  addMessage(readOnlyId, { role: 'user', content: 'hello' });
  await flushPendingSessionWrites();
  assert.equal(sessionHasUnsavedChanges(readOnlyId), false, 'settled session must report no unsaved changes');

  // A session with a pending, not-yet-debounced write.
  getSession(dirtyId);
  addMessage(dirtyId, { role: 'user', content: 'pending' });
  assert.equal(sessionHasUnsavedChanges(dirtyId), true, 'session with a pending save must report unsaved changes');

  const counts = flushAllSessions();
  assert.ok(counts.flushed >= 1, `dirty session must be flushed (got ${JSON.stringify(counts)})`);
  assert.ok(counts.skipped >= 1, `settled session must be skipped (got ${JSON.stringify(counts)})`);
  assert.equal(sessionHasUnsavedChanges(dirtyId), false, 'flushed session must be clean afterwards');

  // A second flush has nothing to do.
  const again = flushAllSessions();
  assert.equal(again.flushed, 0, `second flush must write nothing (got ${JSON.stringify(again)})`);

  console.log('session-flush-dirty-only regression: ok');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
