/**
 * Video encoder — renders scene to video using canvas + MediaRecorder.
 *
 * Primary:  MediaRecorder with video/mp4 (Chrome 130+) or video/webm;codecs=vp9
 * Fallback: video/webm
 *
 * For each frame: advances store.timeMs, waits for renderer to draw,
 * then the captureStream picks up the frame automatically.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * bestMimeType() — pick the best supported mimeType for recording.
 */
function bestMimeType() {
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
 * encodeVideo({ scene, drawFn, width, height, fps, startMs, endMs, onProgress })
 *   → Promise<Blob>  (MP4 or WebM depending on browser support)
 */
export async function encodeVideo({ scene, drawFn, width = 1920, height = 1080, fps = 30, startMs, endMs, onProgress }) {
  const start = startMs ?? 0;
  const end   = endMs   ?? (scene.durationMs || 5000);
  const totalMs  = end - start;
  const frameMs  = 1000 / fps;
  const totalFrames = Math.ceil(totalMs / frameMs);

  // Offscreen export canvas
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width  = width;
  exportCanvas.height = height;
  document.body.appendChild(exportCanvas); // must be in DOM for captureStream
  exportCanvas.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none';

  const mimeType = bestMimeType();
  const stream   = exportCanvas.captureStream(fps);
  const chunks   = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });

  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise((resolve, reject) => {
    recorder.onstop  = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = reject;
  });

  recorder.start();

  for (let i = 0; i < totalFrames; i++) {
    const atMs = start + i * frameMs;
    await renderFrame(exportCanvas, scene, atMs, drawFn);
    onProgress?.(i / totalFrames);
    // Give the stream track time to capture the frame
    await sleep(Math.max(1, frameMs / 2));
  }

  recorder.stop();
  const blob = await done;
  document.body.removeChild(exportCanvas);
  return { blob, mimeType };
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
