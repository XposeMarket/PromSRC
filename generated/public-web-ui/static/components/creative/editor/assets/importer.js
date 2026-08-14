/**
 * Media importer — File → asset descriptor.
 * Uses native browser APIs (HTMLVideoElement, Web Audio API, canvas).
 * No external dependencies.
 */

const WAVEFORM_SAMPLES = 200; // peaks array resolution

function uid() {
  return (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
}

function safeFilename(name) {
  return String(name || 'asset')
    .trim()
    .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 140) || 'asset';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

async function persistFile(file) {
  const filename = safeFilename(file.name || 'asset');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const relativePath = `creative-editor/${stamp}-${filename}`;
  const base64 = await fileToDataUrl(file);
  const response = await fetch('/api/canvas/upload-binary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      relativePath,
      mimeType: file.type || 'application/octet-stream',
      base64,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `Upload failed with HTTP ${response.status}`);
  }
  const relPath = String(data.relPath || '').replace(/\\/g, '/');
  return {
    path: relPath,
    absPath: data.absPath || null,
    src: `/api/canvas/inline?path=${encodeURIComponent(relPath)}`,
  };
}

// ── Video thumbnail + duration ────────────────────────────────────────────────

function extractVideoInfo(objectUrl) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.crossOrigin = 'anonymous';

    video.addEventListener('loadedmetadata', () => {
      // Seek to 10% for thumbnail
      video.currentTime = video.duration * 0.1;
    });

    video.addEventListener('seeked', () => {
      const w = video.videoWidth  || 160;
      const h = video.videoHeight || 90;
      const scale = Math.min(160 / w, 90 / h);
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const ctx = c.getContext('2d');
      ctx.drawImage(video, 0, 0, tw, th);
      const thumbnail = c.toDataURL('image/jpeg', 0.7);
      const result = {
        duration: Number.isFinite(video.duration) ? video.duration * 1000 : null,
        thumbnail,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      video.src = '';
      resolve(result);
    }, { once: true });

    video.addEventListener('error', reject, { once: true });
    video.src = objectUrl;
  });
}

// ── Audio waveform peaks ──────────────────────────────────────────────────────

async function extractAudioInfo(file, objectUrl = '') {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (AudioContextCtor) {
    let ac = null;
    try {
      ac = new AudioContextCtor({ sampleRate: 44100 });
      const buf = await file.arrayBuffer();
      const decoded = await ac.decodeAudioData(buf);
      const ch = decoded.getChannelData(0);
      const blockSize = Math.max(1, Math.floor(ch.length / WAVEFORM_SAMPLES));
      const peaks = [];
      for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
        let max = 0;
        const start = i * blockSize;
        const end = Math.min(ch.length, start + blockSize);
        for (let j = start; j < end; j++) {
          const abs = Math.abs(ch[j] || 0);
          if (abs > max) max = abs;
        }
        peaks.push(max);
      }
      return { duration: decoded.duration * 1000, peaks };
    } finally {
      try { await ac?.close?.(); } catch {}
    }
  }

  // Metadata-only fallback keeps the clip usable on browsers/WebViews that
  // do not expose Web Audio decoding.
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const cleanup = () => {
      audio.removeAttribute('src');
      try { audio.load(); } catch {}
    };
    audio.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      cleanup();
      resolve({ duration, peaks: null });
    }, { once: true });
    audio.addEventListener('error', () => {
      cleanup();
      reject(new Error('Could not read audio metadata.'));
    }, { once: true });
    audio.src = objectUrl;
  });
}

// ── Image info ────────────────────────────────────────────────────────────────

function extractImageInfo(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = objectUrl;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * importFile(file) → Promise<AssetDescriptor>
 *
 * AssetDescriptor: { id, name, type, mimeType, src, thumbnail, duration, peaks, width, height }
 */
export async function importFile(file) {
  const id  = uid();
  const objectSrc = URL.createObjectURL(file);
  let persisted = null;
  try {
    persisted = await persistFile(file);
  } catch (err) {
    console.warn('[ce] persistent upload failed; falling back to session blob:', err);
  }
  const src = persisted?.src || objectSrc;
  const mime = file.type || '';
  const name = file.name || 'untitled';

  let type = 'unknown';
  let thumbnail = null;
  let duration  = null;
  let peaks     = null;
  let width     = null;
  let height    = null;

  try {
    if (mime.startsWith('image/')) {
      type = 'image';
      thumbnail = src;
      const info = await extractImageInfo(src);
      width  = info.width;
      height = info.height;

    } else if (mime.startsWith('video/')) {
      type = 'video';
      const info = await extractVideoInfo(src);
      thumbnail = info.thumbnail;
      duration  = info.duration;
      width     = info.width;
      height    = info.height;

    } else if (mime.startsWith('audio/')) {
      type = 'audio';
      const info = await extractAudioInfo(file, objectSrc);
      duration  = info.duration;
      peaks     = info.peaks;
    }
  } catch (err) {
    console.warn('[ce] importFile probe failed:', err);
  }

  if (persisted?.src && objectSrc !== persisted.src) URL.revokeObjectURL(objectSrc);
  return {
    id,
    name,
    type,
    mimeType: mime,
    src,
    thumbnail,
    duration,
    peaks,
    width,
    height,
    path: persisted?.path || null,
    absPath: persisted?.absPath || null,
    persisted: !!persisted,
  };
}

/**
 * importFiles(fileList) → Promise<AssetDescriptor[]>
 */
export function importFiles(fileList) {
  return Promise.all(Array.from(fileList).map(importFile));
}

/**
 * revokeAsset(asset) — free the object URL when the asset is removed.
 */
export function revokeAsset(asset) {
  if (asset?.src?.startsWith('blob:')) URL.revokeObjectURL(asset.src);
  if (asset?.thumbnail?.startsWith('blob:')) URL.revokeObjectURL(asset.thumbnail);
}

/**
 * assetToSceneElement(asset, scene) — build a new scene element from an asset.
 * Centers it in the scene.
 */
export function assetToSceneElement(asset, scene) {
  const sw = scene?.width  || 1920;
  const sh = scene?.height || 1080;
  const dur = scene?.durationMs || 5000;

  const elW = asset.width  || (asset.type === 'audio' ? sw * 0.8 : 640);
  const elH = asset.height || (asset.type === 'audio' ? 80      : 360);
  const scale = Math.min(sw * 0.8 / elW, sh * 0.8 / elH, 1);

  const w = Math.round(elW * scale);
  const h = Math.round(elH * scale);

  return {
    id:     'el_' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2)),
    type:   asset.type === 'image' ? 'image' : asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image',
    name:   asset.name,
    x:      Math.round((sw - w) / 2),
    y:      Math.round((sh - h) / 2),
    width:  w,
    height: h,
    zIndex: 10,
    src:    asset.src,
    source: asset.src,
    opacity: 1,
    rotation: 0,
    meta: {
      assetId:  asset.id,
      source:   asset.src,
      path:     asset.path || null,
      persisted: asset.persisted === true,
      startMs:  0,
      endMs:    asset.duration || dur,
      durationMs: asset.duration || dur,
      trimStartMs: 0,
      trimEndMs: 0,
      volume: 1,
      muted: false,
    },
  };
}
