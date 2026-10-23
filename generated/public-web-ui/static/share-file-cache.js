// Shared "save to phone" helpers for media in chat and the mobile canvas sheet.
//
// iOS only opens the share sheet (navigator.share with a File, which offers
// "Save Video" / "Save Image") while the tap's user activation is still alive.
// Downloading a multi-MB video between the tap and share() lets that activation
// expire, so share() rejects with NotAllowedError ("The request is not allowed
// by the user agent or the platform in the current context..."). The fix is to
// fetch the file BEFORE the tap (warm) and call share() synchronously when the
// file is already cached.

export const SHARE_FILE_MAX_BYTES = 150 * 1024 * 1024;
export const SHARE_FILE_CACHE_MAX = 4;

export function createShareFileCache({
  fetchImpl,
  FileCtor,
  max = SHARE_FILE_CACHE_MAX,
  maxBytes = SHARE_FILE_MAX_BYTES,
} = {}) {
  const files = new Map(); // src -> File (insertion order = LRU order)
  const pending = new Map(); // src -> Promise<File>

  const get = (src) => {
    const key = String(src || '');
    const hit = files.get(key);
    if (!hit) return null;
    files.delete(key);
    files.set(key, hit);
    return hit;
  };

  const load = (src, name, fallbackType = 'application/octet-stream') => {
    const key = String(src || '');
    if (!key) return Promise.reject(new Error('No file to save'));
    const hit = get(key);
    if (hit) return Promise.resolve(hit);
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      const doFetch = fetchImpl || globalThis.fetch;
      const res = await doFetch(key, { credentials: 'include' });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const len = Number(res.headers?.get?.('Content-Length') || 0);
      if (len && len > maxBytes) {
        const err = new Error('File is too large to save from here');
        err.name = 'TooLargeError';
        throw err;
      }
      const blob = await res.blob();
      // Content-Length can be missing (chunked/Funnel): check the real size too.
      if (blob.size > maxBytes) {
        const err = new Error('File is too large to save from here');
        err.name = 'TooLargeError';
        throw err;
      }
      const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : fallbackType;
      const Ctor = FileCtor || globalThis.File;
      const file = new Ctor([blob], String(name || 'file'), { type });
      files.set(key, file);
      while (files.size > max) files.delete(files.keys().next().value);
      return file;
    })();
    pending.set(key, job);
    job.then(() => pending.delete(key), () => pending.delete(key));
    return job;
  };

  return { get, load, has: (src) => files.has(String(src || '')), size: () => files.size };
}

export function canShareFiles() {
  try {
    return typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function';
  } catch {
    return false;
  }
}

export function downloadFileObject(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 15000);
}

// Calls navigator.share synchronously (before any await) so a cached file keeps
// the tap's user activation. Returns 'shared' | 'cancelled' | 'needs-tap' |
// 'downloaded'. No title/text is passed: on iOS that can hide "Save Video".
export async function shareOrDownloadFile(file, { download = downloadFileObject } = {}) {
  let shareable = false;
  try { shareable = canShareFiles() && navigator.canShare({ files: [file] }); } catch { shareable = false; }
  if (shareable) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      if (err?.name === 'NotAllowedError') return 'needs-tap';
      throw err;
    }
  }
  download(file);
  return 'downloaded';
}

// One cache per page, shared by inline chat videos and the canvas sheet.
export const shareFileCache = createShareFileCache();
