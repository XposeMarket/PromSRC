'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const pending = new WeakSet();

// The authenticated gateway owns this disposable spool. A web page never chooses a path.
function captureClickedDownload(wc, { spool, timeoutMs }, click) {
  if (!/^prom-download-[a-zA-Z0-9]{6}$/.test(spool)) throw new Error('Invalid download spool.');
  const dir = path.join(os.tmpdir(), spool);
  if (!fs.lstatSync(dir).isDirectory()) throw new Error('Download spool unavailable.');
  if (pending.has(wc)) throw new Error('A download is already pending on this tab.');
  const session = wc.session;
  pending.add(wc);
  return new Promise((resolve, reject) => {
    let item, settled = false, name;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.removeListener('will-download', onDownload);
      wc.removeListener('destroyed', onClosed);
      pending.delete(wc);
      if (item) { try { item.removeListener('done', onDone); if (error) item.cancel(); } catch {} }
      if (error) reject(error); else resolve({ filename: name });
    };
    const onClosed = () => finish(new Error('The download tab closed.'));
    const onDone = (_event, state) => finish(state === 'completed' ? null : new Error(`Download ${state}.`));
    const onDownload = (_event, next, source) => {
      if (source !== wc || item) return;
      item = next;
      try { name = item.getFilename(); item.setSavePath(path.join(dir, 'payload')); item.once('done', onDone); }
      catch (err) { finish(err); }
    };
    const timer = setTimeout(() => finish(new Error('Timed out waiting for this tab to finish downloading.')), Math.min(120000, Math.max(1000, Number(timeoutMs) || 15000)));
    wc.once('destroyed', onClosed);
    session.on('will-download', onDownload);
    Promise.resolve().then(() => click(() => !settled)).catch(finish);
  });
}
module.exports = { captureClickedDownload };
