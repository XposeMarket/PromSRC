'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Called only by the authenticated native-browser RPC, against its session-owned view.
async function uploadNativeFiles(wc, payload) {
  const paths = [...new Set([payload.file_path, ...(Array.isArray(payload.file_paths) ? payload.file_paths : [])]
    .filter(p => typeof p === 'string' && p.trim()).map(p => path.resolve(p)))];
  if (!paths.length) throw new Error('file_path or file_paths is required.');
  for (const p of paths) if (!fs.statSync(p).isFile()) throw new Error('Upload path must be a regular file.');
  const selector = typeof payload.selector === 'string' && payload.selector.trim()
    ? payload.selector : Number.isInteger(payload.ref) && payload.ref > 0 ? `[data-sc-ref="${payload.ref}"]` : '';
  if (!selector) throw new Error('Upload requires a file input selector or snapshot ref.');
  const dbg = wc.debugger;
  const attachedHere = !dbg.isAttached();
  if (attachedHere) dbg.attach('1.3');
  let objectId;
  try {
    const result = await dbg.sendCommand('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Upload target not found.'); const input = el.matches('input[type="file"]') ? el : el.querySelector('input[type="file"]'); if (!input) throw new Error('Target is not a file input.'); if (input.disabled) throw new Error('File input is disabled.'); if (${paths.length} > 1 && !input.multiple) throw new Error('File input does not accept multiple files.'); return input; })()`,
      returnByValue: false,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Invalid upload target.');
    objectId = result.result?.objectId;
    if (!objectId) throw new Error('Upload target is not available.');
    await dbg.sendCommand('DOM.setFileInputFiles', { objectId, files: paths });
    return { count: paths.length, names: paths.map(p => path.basename(p)) };
  } finally {
    if (objectId) await dbg.sendCommand('Runtime.releaseObject', { objectId }).catch(() => {});
    if (attachedHere && dbg.isAttached()) dbg.detach();
  }
}
module.exports = { uploadNativeFiles };
