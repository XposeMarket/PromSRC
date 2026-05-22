/**
 * Preview renderer — RAF draw loop for the creative editor canvas.
 *
 * Draws scene elements at a given timeMs onto the viewport canvas.
 * Handles: background, shapes, text, image (cached), video (placeholder),
 * element transforms (translate/rotate/scale), opacity, z-ordering,
 * effects (blur/shadow/glow/etc.), masks (polygon/ellipse/feather),
 * gradient fills, and advanced text (letterSpacing, lineHeight, textShadow).
 */

import { buildFilter, applyPreEffects, applyPostEffects, applyMask, buildGradientFill } from '../effects/registry.js';
import { drawSubtitles } from '../subtitles/panel.js';
import { resolveElementAtTime as resolveSceneElementAtTime } from '../../sceneGraph.js';

const VIDEO_CACHE = new Map(); // src -> HTMLVideoElement

const IMG_CACHE = new Map(); // src → HTMLImageElement

function loadImage(src) {
  src = normalizeMediaSrc(src);
  if (IMG_CACHE.has(src)) return IMG_CACHE.get(src);
  const img = new Image();
  img.src = src;
  IMG_CACHE.set(src, img);
  return img;
}

function loadVideo(src, markDirty) {
  src = normalizeMediaSrc(src);
  if (VIDEO_CACHE.has(src)) return VIDEO_CACHE.get(src);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.src = src;
  video.addEventListener('loadeddata', () => markDirty?.());
  video.addEventListener('seeked', () => markDirty?.());
  video.addEventListener('error', () => markDirty?.());
  VIDEO_CACHE.set(src, video);
  return video;
}

function normalizeMediaSrc(src) {
  const value = String(src || '').trim().replace(/\\/g, '/');
  if (!value || /^(?:data:|blob:|https?:|\/api\/)/i.test(value)) return value;
  return `/api/canvas/inline?path=${encodeURIComponent(value)}`;
}

function waitForVideoReady(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', done);
    };
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('error', done, { once: true });
  });
}

async function seekVideo(video, seconds) {
  if (!Number.isFinite(seconds)) return;
  const safe = Math.max(0, Math.min(seconds, Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.02) : seconds));
  if (Math.abs((video.currentTime || 0) - safe) < 0.035 && video.readyState >= 2) return;
  await new Promise((resolve) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', done);
    };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', done, { once: true });
    try { video.currentTime = safe; } catch { done(); }
  });
}

/**
 * resolveElementAtTime — interpolate keyframes at a given ms.
 * Falls back to element's own x/y/width/height/opacity/rotation if no keyframes.
 */
function resolveElementAtTime(el, atMs) {
  const resolved = resolveSceneElementAtTime(el, atMs);
  if (resolved) return resolved;
  // Try to use a global helper if available (injected by sceneGraph.js)
  if (typeof window.resolveElementAtTime === 'function') {
    return window.resolveElementAtTime(el, atMs);
  }
  // Minimal fallback — no interpolation
  return {
    x:        el.x        ?? 0,
    y:        el.y        ?? 0,
    width:    el.width    ?? 200,
    height:   el.height   ?? 100,
    rotation: el.rotation ?? 0,
    opacity:  el.opacity  ?? 1,
  };
}

function isVisibleAtTime(el, timeMs) {
  const start = el.meta?.startMs ?? el.startMs ?? 0;
  const end   = el.meta?.endMs   ?? el.endMs ?? Infinity;
  return timeMs >= start && timeMs < end;
}

function metaValue(el, key, fallback) {
  return el?.[key] ?? el?.meta?.[key] ?? fallback;
}

function effectView(el) {
  return {
    ...(el || {}),
    effects: el?.meta?.effectStack || el?.effects || [],
    mask: el?.meta?.mask || el?.mask || null,
    gradientFill: el?.meta?.gradientFill || el?.gradientFill || null,
  };
}

function drawBackground(ctx, scene, vw, vh) {
  ctx.fillStyle = '#1a1a2e'; // dark fallback
  ctx.fillRect(0, 0, vw, vh);
}

function drawSceneBackground(ctx, scene, transform) {
  const { scale, panX, panY } = transform;
  const sw = scene.width  || 1920;
  const sh = scene.height || 1080;
  ctx.fillStyle = scene.background || '#050816';
  ctx.fillRect(panX, panY, sw * scale, sh * scale);
}

function drawElement(ctx, el, timeMs, transform, options = {}) {
  const resolved = resolveElementAtTime(el, timeMs);
  const { scale, panX, panY } = transform;

  const sx = resolved.x      * scale + panX;
  const sy = resolved.y      * scale + panY;
  const sw = resolved.width  * scale;
  const sh = resolved.height * scale;
  const rot = (resolved.rotation || 0) * Math.PI / 180;
  const opacity = resolved.opacity ?? 1;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.translate(sx + sw / 2, sy + sh / 2);
  if (rot) ctx.rotate(rot);
  ctx.translate(-sw / 2, -sh / 2);

  const fxEl = effectView(el);

  // Apply mask clip
  applyMask(ctx, fxEl, sw, sh);

  // Apply CSS filters (blur, brightness, etc.)
  const filter = buildFilter(fxEl);
  if (filter !== 'none') ctx.filter = filter;

  // Apply pre-draw effects (shadow, glow)
  applyPreEffects(ctx, fxEl, sw, sh);

  const type = (el.type || '').toLowerCase();

  if (type === 'shape' || type === 'rect' || type === 'rectangle') {
    drawShape(ctx, el, sw, sh);
  } else if (type === 'ellipse' || type === 'circle') {
    drawEllipse(ctx, el, sw, sh);
  } else if (type === 'text') {
    drawText(ctx, el, sw, sh, scale);
  } else if (type === 'image' || type === 'img') {
    drawImage(ctx, el, sw, sh);
  } else if (type === 'video') {
    if (options.awaitMedia) {
      return drawVideo(ctx, el, timeMs, sw, sh, options).finally(() => ctx.restore());
    }
    drawVideo(ctx, el, timeMs, sw, sh, options);
  } else if (type === 'audio') {
    // Audio-only layers live in the timeline and export mix; they do not draw.
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, sw, sh);
  }

  // Post-draw effects (reset shadows)
  applyPostEffects(ctx, fxEl, sw, sh);
  if (filter !== 'none') ctx.filter = 'none';

  ctx.restore();
  return null;
}

function drawShape(ctx, el, sw, sh) {
  const grad = buildGradientFill(ctx, effectView(el), sw, sh);
  ctx.fillStyle = grad || metaValue(el, 'fill', null) || metaValue(el, 'color', null) || 'rgba(99,102,241,0.8)';
  ctx.fillRect(0, 0, sw, sh);
  const stroke = metaValue(el, 'stroke', null);
  if (stroke && stroke !== 'transparent') {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = metaValue(el, 'strokeWidth', 1);
    ctx.strokeRect(0, 0, sw, sh);
  }
}

function drawEllipse(ctx, el, sw, sh) {
  ctx.beginPath();
  ctx.ellipse(sw / 2, sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
  const grad = buildGradientFill(ctx, effectView(el), sw, sh);
  ctx.fillStyle = grad || metaValue(el, 'fill', null) || metaValue(el, 'color', null) || 'rgba(99,102,241,0.8)';
  ctx.fill();
  const stroke = metaValue(el, 'stroke', null);
  if (stroke && stroke !== 'transparent') {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = metaValue(el, 'strokeWidth', 1);
    ctx.stroke();
  }
}

function drawText(ctx, el, sw, sh, scale) {
  const fontSize   = metaValue(el, 'fontSize', 48) * scale;
  const fontFamily = metaValue(el, 'fontFamily', 'Inter, sans-serif');
  const color      = metaValue(el, 'color', '#ffffff');
  const align      = metaValue(el, 'textAlign', 'left');
  const lineHeight = metaValue(el, 'lineHeight', 1.3) * fontSize;
  const text       = metaValue(el, 'text', null) || metaValue(el, 'content', '');

  // Text shadow
  const textShadow = metaValue(el, 'textShadow', null);
  if (textShadow) {
    ctx.shadowOffsetX = textShadow.x    ?? 2;
    ctx.shadowOffsetY = textShadow.y    ?? 2;
    ctx.shadowBlur    = textShadow.blur ?? 4;
    ctx.shadowColor   = textShadow.color || 'rgba(0,0,0,0.5)';
  }

  ctx.font = `${metaValue(el, 'fontStyle', '')} ${metaValue(el, 'fontWeight', 400)} ${fontSize}px ${fontFamily}`.trim();

  // Gradient text
  const grad = buildGradientFill(ctx, effectView(el), sw, sh);
  ctx.fillStyle = grad || color;
  ctx.textAlign    = align;
  ctx.textBaseline = 'top';

  ctx.beginPath();
  ctx.rect(0, 0, sw, sh);
  ctx.clip();

  const ox = align === 'center' ? sw / 2 : align === 'right' ? sw : 0;

  // Letter spacing via manual character layout
  const letterSpacing = metaValue(el, 'letterSpacing', 0);
  if (letterSpacing && letterSpacing !== 0) {
    drawTextLetterSpaced(ctx, text, ox, 0, sw, lineHeight, letterSpacing * scale, align);
  } else {
    wrapText(ctx, text, ox, 0, sw, lineHeight);
  }

  // Reset shadow
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
}

function drawTextLetterSpaced(ctx, text, ox, oy, maxW, lineH, spacing, align) {
  const lines = wrapLines(ctx, text, maxW, spacing);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineW = line.split('').reduce((w, ch) => w + ctx.measureText(ch).width + spacing, 0);
    let x = align === 'center' ? ox - lineW / 2 : align === 'right' ? ox - lineW : ox;
    const y = oy + li * lineH;
    for (const ch of line) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + spacing;
    }
  }
}

function wrapLines(ctx, text, maxWidth, spacing = 0) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    const w = test.split('').reduce((a, c) => a + ctx.measureText(c).width + spacing, 0);
    if (w > maxWidth && cur) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (let i = 0; i < words.length; i++) {
    const test = line + words[i] + ' ';
    if (ctx.measureText(test).width > maxWidth && i > 0) {
      ctx.fillText(line, x, curY);
      line = words[i] + ' ';
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, curY);
}

function drawImage(ctx, el, sw, sh) {
  const src = metaValue(el, 'src', null) || metaValue(el, 'url', null) || metaValue(el, 'source', null);
  if (!src) {
    drawImagePlaceholder(ctx, sw, sh, 'No src');
    return;
  }
  const img = loadImage(src);
  if (img.complete && img.naturalWidth > 0) {
    drawMediaFit(ctx, img, sw, sh, metaValue(el, 'fit', 'cover'));
  } else {
    drawImagePlaceholder(ctx, sw, sh, 'Loading…');
    // Force a redraw once loaded
    img.onload = () => { /* renderer will redraw on next frame */ };
  }
}

function drawImagePlaceholder(ctx, sw, sh, label) {
  ctx.fillStyle = 'rgba(80,80,120,0.5)';
  ctx.fillRect(0, 0, sw, sh);
  ctx.strokeStyle = 'rgba(150,150,200,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, sw, sh);
  // Diagonal cross
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(sw, sh);
  ctx.moveTo(sw, 0); ctx.lineTo(0, sh);
  ctx.stroke();
  if (label) {
    ctx.fillStyle = 'rgba(200,200,255,0.7)';
    ctx.font = `${Math.min(14, sh * 0.12)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, sw / 2, sh / 2);
  }
}

async function drawVideo(ctx, el, timeMs, sw, sh, options = {}) {
  const src = metaValue(el, 'src', null) || metaValue(el, 'url', null) || metaValue(el, 'source', null);
  if (!src) {
    drawImagePlaceholder(ctx, sw, sh, 'No video');
    return;
  }
  const startMs = Math.max(0, Number(el.meta?.startMs ?? el.startMs) || 0);
  const trimStartMs = Math.max(0, Number(el.meta?.trimStartMs) || 0);
  const localMs = Math.max(0, timeMs - startMs + trimStartMs);
  const video = loadVideo(src, options.markDirty);
  if (options.awaitMedia) {
    await waitForVideoReady(video);
    await seekVideo(video, localMs / 1000);
  } else if (video.readyState >= 1) {
    const target = localMs / 1000;
    if (Math.abs((video.currentTime || 0) - target) > 0.08) {
      try {
        video.currentTime = Math.max(0, Math.min(target, Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.02) : target));
      } catch {}
    }
  }
  if (video.readyState >= 2 && video.videoWidth > 0) {
    drawMediaFit(ctx, video, sw, sh, metaValue(el, 'fit', 'cover'));
  } else {
    drawImagePlaceholder(ctx, sw, sh, 'Loading...');
  }
}

function drawMediaFit(ctx, media, sw, sh, fit = 'cover') {
  const mw = Number(media.videoWidth || media.naturalWidth || media.width) || sw;
  const mh = Number(media.videoHeight || media.naturalHeight || media.height) || sh;
  const mode = String(fit || 'cover').toLowerCase();
  if (mode === 'fill') {
    ctx.drawImage(media, 0, 0, sw, sh);
    return;
  }
  const scale = mode === 'contain' ? Math.min(sw / mw, sh / mh) : Math.max(sw / mw, sh / mh);
  const dw = mw * scale;
  const dh = mh * scale;
  const dx = (sw - dw) / 2;
  const dy = (sh - dh) / 2;
  ctx.drawImage(media, dx, dy, dw, dh);
}

function drawVideoPlaceholder(ctx, el, sw, sh) {
  drawImagePlaceholder(ctx, sw, sh, '▶ ' + (el.name || 'video'));
}

function drawSelectionHighlight(ctx, el, timeMs, transform) {
  const resolved = resolveElementAtTime(el, timeMs);
  const { scale, panX, panY } = transform;
  const sx = resolved.x * scale + panX;
  const sy = resolved.y * scale + panY;
  const sw = resolved.width  * scale;
  const sh = resolved.height * scale;
  const rot = (resolved.rotation || 0) * Math.PI / 180;

  ctx.save();
  ctx.translate(sx + sw / 2, sy + sh / 2);
  if (rot) ctx.rotate(rot);
  ctx.translate(-sw / 2, -sh / 2);

  // Dashed selection border
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(-1, -1, sw + 2, sh + 2);
  ctx.setLineDash([]);

  // Corner handles
  const hs = 6;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.5;
  const corners = [[0,0],[sw,0],[0,sh],[sw,sh]];
  for (const [cx, cy] of corners) {
    ctx.fillRect(cx - hs/2, cy - hs/2, hs, hs);
    ctx.strokeRect(cx - hs/2, cy - hs/2, hs, hs);
  }

  ctx.restore();
}

// ── Hit testing ──────────────────────────────────────────────────────────────

export function hitTestScene(sceneX, sceneY, scene, timeMs) {
  if (!scene?.elements) return null;
  const visible = (scene.elements)
    .filter(el => isVisibleAtTime(el, timeMs))
    .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0)); // top-first

  for (const el of visible) {
    const r = resolveElementAtTime(el, timeMs);
    // Simple AABB check (ignores rotation for now)
    if (sceneX >= r.x && sceneX <= r.x + r.width &&
        sceneY >= r.y && sceneY <= r.y + r.height) {
      return el;
    }
  }
  return null;
}

// ── Playback engine ──────────────────────────────────────────────────────────

let _rafId = null;
let _lastTs = null;

function startPlaybackLoop(store) {
  stopPlaybackLoop();
  function tick(ts) {
    if (_lastTs !== null) {
      const delta = ts - _lastTs;
      const { timeMs, durationMs, playing } = store.getState();
      if (playing) {
        const next = timeMs + delta;
        if (next >= durationMs) {
          store.setState({ timeMs: 0, playing: false });
        } else {
          store.setState({ timeMs: next });
        }
      }
    }
    _lastTs = ts;
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

function stopPlaybackLoop() {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _lastTs = null;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function drawSceneToContext(ctx, scene, timeMs, transform, options = {}) {
  const { scale, panX, panY } = transform;
  const cssW = options.cssW || (ctx.canvas?.width || 1);
  const cssH = options.cssH || (ctx.canvas?.height || 1);

  drawBackground(ctx, scene, cssW, cssH);
  if (!scene) return;

  drawSceneBackground(ctx, scene, { scale, panX, panY });
  const elements = (scene.elements || [])
    .filter(el => isVisibleAtTime(el, timeMs))
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  for (const el of elements) {
    const maybePromise = drawElement(ctx, el, timeMs, { scale, panX, panY }, options);
    if (options.awaitMedia && maybePromise && typeof maybePromise.then === 'function') {
      await maybePromise;
    }
  }

  if (Array.isArray(options.selectedIds)) {
    for (const el of elements) {
      if (options.selectedIds.includes(el.id)) {
        drawSelectionHighlight(ctx, el, timeMs, { scale, panX, panY });
      }
    }
  }

  drawSubtitles(ctx, scene, timeMs, { scale, panX, panY }, cssW, cssH);
}

/**
 * createRenderer({ viewport, store, getScene })
 *   viewport — result of createViewport(...)
 *   store    — reactive store
 *   getScene — () => scene object
 */
export function createRenderer({ viewport, store, getScene }) {
  let _raf = null;
  let _dirty = true;

  function markDirty() { _dirty = true; }

  function draw() {
    const { canvas, ctx, getTransform } = viewport;
    const transform = getTransform();
    const { dpr, scale, panX, panY } = transform;
    const vw = canvas.width;
    const vh = canvas.height;

    ctx.save();
    ctx.scale(dpr, dpr);

    const cssW = vw / dpr;
    const cssH = vh / dpr;

    const scene = getScene();
    const { timeMs, selectedIds } = store.getState();
    drawSceneToContext(ctx, scene, timeMs, { scale, panX, panY }, {
      cssW,
      cssH,
      selectedIds,
      markDirty,
      awaitMedia: false,
    }).catch(() => {});

    ctx.restore();
    _dirty = false;
  }

  function loop() {
    if (_dirty) draw();
    _raf = requestAnimationFrame(loop);
  }

  // Subscribe to store changes
  const unsubs = [
    store.subscribe(markDirty),
  ];

  // Start render loop
  loop();
  // Also start playback tick loop
  startPlaybackLoop(store);

  function dispose() {
    if (_raf !== null) cancelAnimationFrame(_raf);
    stopPlaybackLoop();
    for (const u of unsubs) u();
  }

  return { draw, markDirty, dispose };
}
