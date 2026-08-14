/**
 * Video encoder — renders scene to video using canvas + MediaRecorder.
 *
 * Primary:  MediaRecorder with video/mp4 (Chrome 130+) or video/webm;codecs=vp9
 * Fallback: video/webm
 *
 * For each frame: advances store.timeMs, waits for renderer to draw,
 * then the captureStream picks up the frame automatically.
 */

import { createCreativeExportAudioSession } from '../../audioEngine.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Export cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

/**
 * bestMimeType() — pick the best supported mimeType for recording.
 */
function bestMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  return candidates.find(t => {
    try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
  }) || 'video/webm';
}

/**
 * renderSceneToCanvas(scene, atMs, exportCanvas, drawFn)
 *   drawFn(ctx, scene, atMs, transform) — your renderer's draw logic
 */
async function renderFrame(exportCanvas, scene, atMs, drawFn) {
  const ctx = exportCanvas.getContext('2d');
  ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
  await drawFn(ctx, scene, atMs, {
    scale: exportCanvas.width / (scene.width || 1920),
    panX:  0,
    panY:  0,
    dpr:   1,
  });
}

/**
 * encodeVideo({ scene, drawFn, width, height, fps, startMs, endMs,
 *   audioTrack, signal, onProgress })
 *   → Promise<{ blob, mimeType }>  (MP4 or WebM depending on browser support)
 */
export async function encodeVideo({
  scene,
  drawFn,
  width = 1920,
  height = 1080,
  fps = 30,
  startMs,
  endMs,
  onProgress,
  audioTrack = null,
  signal = null,
  isCanceled = null,
  resolveSourceUrl = null,
} = {}) {
  const safeFps = Math.max(1, Math.min(120, Number(fps) || 30));
  const safeWidth = Math.max(2, Math.round(Number(width) || 1920));
  const safeHeight = Math.max(2, Math.round(Number(height) || 1080));
  const frameMs = 1000 / safeFps;
  const contentEnd = (scene?.elements || []).reduce((max, element) => {
    const start = Math.max(0, Number(element?.meta?.startMs ?? element?.startMs) || 0);
    const explicitEnd = Number(element?.meta?.endMs ?? element?.endMs);
    const duration = Number(element?.meta?.durationMs ?? element?.durationMs) || 0;
    return Math.max(max, Number.isFinite(explicitEnd) && explicitEnd > start ? explicitEnd : start + Math.max(0, duration));
  }, 0);
  const audioEnd = Math.max(0, Number(scene?.audioTrack?.startMs) || 0)
    + Math.max(0, Number(scene?.audioTrack?.durationMs) || Number(scene?.audioTrack?.analysis?.durationMs) || 0);
  const rawSceneDuration = Math.max(Number(scene?.durationMs) || 0, contentEnd, audioEnd);
  const sceneDuration = Math.max(frameMs, rawSceneDuration || 5000);
  const start = Math.max(0, Math.min(sceneDuration - frameMs, Number(startMs) || 0));
  const requestedEnd = Number(endMs);
  const end = Math.max(
    start + frameMs,
    Math.min(sceneDuration, Number.isFinite(requestedEnd) ? requestedEnd : sceneDuration),
  );
  const totalMs = end - start;
  const totalFrames = Math.max(1, Math.ceil(totalMs / frameMs));
  if (!scene || typeof drawFn !== 'function') throw new Error('A scene and export draw function are required.');
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record canvas video.');
  }

  // Offscreen export canvas
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width  = safeWidth;
  exportCanvas.height = safeHeight;
  document.body.appendChild(exportCanvas); // must be in DOM for captureStream
  exportCanvas.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none';

  const mimeType = bestMimeType();
  if (!mimeType) {
    exportCanvas.remove();
    throw new Error('MediaRecorder is unavailable in this browser.');
  }
  let stream;
  try {
    // A zero-rate stream lets supported browsers capture exactly after each
    // rendered frame. Older browsers reject it, so fall back to a clocked
    // stream without making export fail.
    stream = exportCanvas.captureStream(0);
    if (!stream.getVideoTracks?.()[0]?.requestFrame) {
      stream.getTracks?.().forEach(track => track.stop());
      stream = exportCanvas.captureStream(safeFps);
    }
  } catch (error) {
    try {
      stream = exportCanvas.captureStream(safeFps);
    } catch {
      exportCanvas.remove();
      throw error;
    }
  }
  const chunks   = [];
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  } catch (error) {
    try { stream.getTracks?.().forEach(track => track.stop()); } catch {}
    exportCanvas.remove();
    throw error;
  }
  let audioSession = null;
  let recorderDone = null;

  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise((resolve, reject) => {
    recorder.onstop  = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = e => reject(e?.error || new Error('MediaRecorder failed.'));
  });
  recorderDone = done;

  try {
    if (audioTrack?.source) {
      try {
        audioSession = await createCreativeExportAudioSession(audioTrack, sceneDuration, {
          resolveSourceUrl,
        });
        const audioTracks = audioSession?.destination?.stream?.getAudioTracks?.() || [];
        audioTracks.forEach(track => {
          try { stream.addTrack(track); } catch {}
        });
      } catch (error) {
        console.warn('[ce] audio export unavailable; continuing with video:', error);
        audioSession = null;
      }
    }

    throwIfAborted(signal);
    if (isCanceled?.()) throwIfAborted({ aborted: true });
    recorder.start();

    const videoTrack = stream.getVideoTracks?.()[0];
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(signal);
      if (isCanceled?.()) throwIfAborted({ aborted: true });
      const atMs = Math.min(end, start + i * frameMs);
      await renderFrame(exportCanvas, scene, atMs, drawFn);
      await audioSession?.sync?.(atMs, { forceSeek: i === 0 });
      videoTrack?.requestFrame?.();
      onProgress?.((i + 1) / totalFrames);
      // Keep audio and clocked capture streams in real time. Manual frame
      // capture can use a short yield because requestFrame is deterministic.
      await sleep(audioSession ? frameMs : (videoTrack?.requestFrame ? 4 : Math.max(1, frameMs / 2)));
    }

    if (recorder.state !== 'inactive') recorder.stop();
    const blob = await done;
    return { blob, mimeType };
  } finally {
    try { audioSession?.stop?.(); } catch {}
    if (recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
      try { await recorderDone; } catch {}
    }
    try { stream?.getTracks?.().forEach(track => track.stop()); } catch {}
    exportCanvas.remove();
  }
}

/**
 * downloadBlob(blob, filename) — trigger browser download.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
}

/**
 * buildDrawFn() — draw function for export. Imports effect helpers.
 * Works without a live renderer reference.
 */
export function buildDrawFn() {
  let rendererPromise = null;
  return async function drawFn(ctx, scene, atMs, transform) {
    if (!rendererPromise) rendererPromise = import('../preview/renderer.js');
    const renderer = await rendererPromise;
    await renderer.drawSceneToContext(ctx, scene, atMs, transform, {
      cssW: ctx.canvas.width,
      cssH: ctx.canvas.height,
      awaitMedia: true,
    });
  };
}
