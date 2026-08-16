/**
 * Preview renderer — RAF draw loop for the creative editor canvas.
 *
 * Draws scene elements at a given timeMs onto the viewport canvas.
 * Handles: background, shapes, text, image/video media, components,
 * element transforms (translate/rotate/scale), opacity, z-ordering,
 * effects (blur/shadow/glow/etc.), masks (polygon/ellipse/feather),
 * gradient fills, and advanced text (letterSpacing, lineHeight, textShadow).
 */

import { buildFilter, applyPreEffects, applyPostEffects, applyMask, buildGradientFill } from '../effects/registry.js';
import { drawSubtitles } from '../subtitles/panel.js';
import { resolveElementAtTime as resolveSceneElementAtTime } from '../../sceneGraph.js';

const VIDEO_CACHE = new Map(); // src -> HTMLVideoElement, insertion order is LRU order
const IMG_CACHE = new Map(); // src → HTMLImageElement, insertion order is LRU order
const VIDEO_CACHE_LIMIT = 10;
const IMG_CACHE_LIMIT = 64;

function touchMediaCache(cache, key) {
  const value = cache.get(key);
  if (!value) return null;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function pruneImageCache() {
  while (IMG_CACHE.size > IMG_CACHE_LIMIT) {
    const oldest = IMG_CACHE.keys().next().value;
    if (!oldest) break;
    IMG_CACHE.delete(oldest);
  }
}

function releaseVideo(video) {
  try { video.pause(); } catch {}
  try {
    video.removeAttribute('src');
    video.load();
  } catch {}
}

function pruneVideoCache() {
  while (VIDEO_CACHE.size > VIDEO_CACHE_LIMIT) {
    const oldest = VIDEO_CACHE.keys().next().value;
    if (!oldest) break;
    const video = VIDEO_CACHE.get(oldest);
    VIDEO_CACHE.delete(oldest);
    if (video) releaseVideo(video);
  }
}

export function clearPreviewMediaCache() {
  IMG_CACHE.clear();
  for (const video of VIDEO_CACHE.values()) releaseVideo(video);
  VIDEO_CACHE.clear();
}

function loadImage(src, markDirty) {
  src = normalizeMediaSrc(src);
  const cached = touchMediaCache(IMG_CACHE, src);
  if (cached) return cached;
  const img = new Image();
  img.src = src;
  img.addEventListener('load', () => markDirty?.(), { once: true });
  img.addEventListener('error', () => markDirty?.(), { once: true });
  IMG_CACHE.set(src, img);
  pruneImageCache();
  return img;
}

function loadVideo(src, markDirty) {
  src = normalizeMediaSrc(src);
  const cached = touchMediaCache(VIDEO_CACHE, src);
  if (cached) return cached;
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
  pruneVideoCache();
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
  if (el?.visible === false || el?.meta?.visible === false || el?.hidden === true || el?.meta?.hidden === true) {
    return false;
  }
  const start = el.meta?.startMs ?? el.startMs ?? 0;
  const explicitEnd = Number(el.meta?.endMs ?? el.endMs);
  const duration = Number(el.meta?.durationMs ?? el.durationMs);
  const end = Number.isFinite(explicitEnd) && explicitEnd > start
    ? explicitEnd
    : Number.isFinite(duration) && duration > 0
      ? Number(start) + duration
      : Infinity;
  return timeMs >= start && timeMs < end;
}

function editorTrackCategory(type) {
  const value = String(type || '').toLowerCase();
  if (value === 'audio') return 'audio';
  if (value === 'text' || value === 'caption' || value === 'subtitle') return 'text';
  if (value === 'video' || value === 'image' || value === 'img') return 'video';
  return 'overlay';
}

function metaValue(el, key, fallback) {
  // `meta` is canonical for editor-owned properties. Root aliases remain a
  // compatibility fallback for older saved scenes, but must not override a
  // newer inspector edit.
  return el?.meta?.[key] ?? el?.[key] ?? fallback;
}

function effectView(el) {
  return {
    ...(el || {}),
    effects: el?.meta?.effectStack || el?.effects || [],
    mask: el?.meta?.mask || el?.mask || null,
    gradientFill: el?.meta?.gradientFill || el?.gradientFill || null,
  };
}

function typeIsMedia(type) {
  const value = String(type || '').toLowerCase();
  return value === 'image' || value === 'img' || value === 'video';
}

function applyRoundedClip(ctx, width, height, radius) {
  if (radius <= 0) return;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, width, height, Math.min(radius, Math.min(width, height) / 2));
  } else {
    ctx.rect(0, 0, width, height);
  }
  ctx.clip();
}

function drawIcon(ctx, el, sw, sh) {
  const color = metaValue(el, 'color', metaValue(el, 'fill', '#f97316'));
  const glyphs = {
    play: '▶', pause: 'Ⅱ', check: '✓', close: '×', plus: '+',
    star: '★', heart: '♥', bolt: 'ϟ', camera: '●', music: '♫',
  };
  const name = String(metaValue(el, 'iconName', metaValue(el, 'name', '')) || '').toLowerCase();
  const inferred = Object.entries(glyphs).find(([key]) => name.includes(key))?.[1];
  const glyph = String(metaValue(el, 'glyph', '') || '') || glyphs[name] || inferred || '◆';
  const radius = Math.min(sw, sh) * 0.18;
  ctx.fillStyle = metaValue(el, 'background', 'rgba(249,115,22,0.18)');
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, sw, sh, radius);
  else ctx.rect(0, 0, sw, sh);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = `${Math.max(12, Math.min(sw, sh) * 0.52)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, sw / 2, sh / 2);
}

function drawComponent(ctx, el, sw, sh) {
  const radius = Math.min(sw, sh) * 0.08;
  const background = metaValue(el, 'background', metaValue(el, 'fill', 'rgba(255,255,255,0.08)'));
  const accent = metaValue(el, 'accent', '#f97316');
  const title = metaValue(el, 'title', metaValue(el, 'label', el.name || 'Component'));
  const body = metaValue(el, 'body', metaValue(el, 'content', ''));
  const value = metaValue(el, 'value', '');

  ctx.fillStyle = background;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, sw, sh, radius);
  else ctx.rect(0, 0, sw, sh);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, Math.max(3, Math.min(8, sw * 0.025)), sh);
  ctx.fillStyle = metaValue(el, 'color', '#ffffff');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `700 ${Math.max(12, Math.min(26, sh * 0.18))}px sans-serif`;
  ctx.fillText(String(title || ''), Math.max(12, sw * 0.06), Math.max(10, sh * 0.08), sw * 0.82);
  if (body) {
    ctx.font = `${Math.max(10, Math.min(18, sh * 0.12))}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.fillText(String(body), Math.max(12, sw * 0.06), Math.max(30, sh * 0.32), sw * 0.82);
  }
  if (value !== '' && value != null) {
    ctx.font = `800 ${Math.max(16, Math.min(38, sh * 0.28))}px sans-serif`;
    ctx.fillStyle = accent;
    ctx.fillText(String(value), Math.max(12, sw * 0.06), Math.max(42, sh * 0.56), sw * 0.82);
  }
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

  // 3D / perspective transform (affine approximation of CapCut tilt/roll/zoom)
  const roll  = (Number(metaValue(el, 'roll', 0))  || 0) * Math.PI / 180;
  const tiltX = (Number(metaValue(el, 'tiltX', 0)) || 0) * Math.PI / 180;
  const tiltY = (Number(metaValue(el, 'tiltY', 0)) || 0) * Math.PI / 180;
  const zoom  = Math.max(0.05, Number(metaValue(el, 'zoom', 1)) || 1);
  const persp = Math.max(200, Number(metaValue(el, 'perspective', 1200)) || 1200);
  const shearK = Math.max(0.1, Math.min(0.6, 480 / persp));

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  const blendMode = String(metaValue(el, 'blendMode', 'normal') || 'normal');
  try { ctx.globalCompositeOperation = blendMode === 'normal' ? 'source-over' : blendMode; } catch {}
  ctx.translate(sx + sw / 2, sy + sh / 2);
  if (rot || roll) ctx.rotate(rot + roll);
  if (zoom !== 1) ctx.scale(zoom, zoom);
  if (tiltX || tiltY) {
    // tiltY = spin about the vertical axis → narrow width + vertical shear
    // tiltX = spin about the horizontal axis → narrow height + horizontal shear
    ctx.transform(
      Math.cos(tiltY),                 // scaleX
      Math.sin(tiltY) * shearK,        // skewY
      Math.sin(tiltX) * shearK,        // skewX
      Math.cos(tiltX),                 // scaleY
      0, 0,
    );
  }
  ctx.translate(-sw / 2, -sh / 2);

  const fxEl = effectView(el);

  // Apply mask clip
  applyMask(ctx, fxEl, sw, sh);
  const radius = Math.max(0, Number(metaValue(el, 'radius', 0)) || 0);
  if (radius > 0 && (typeIsMedia(el.type) || el.type === 'group' || el.type === 'component')) {
    applyRoundedClip(ctx, sw, sh, radius * scale);
  }

  // Apply CSS filters (blur, brightness, etc.) + focus blur
  let filter = buildFilter(fxEl);
  const focusBlur = Number(metaValue(el, 'focusBlur', 0)) || 0;
  if (focusBlur > 0) filter = (filter === 'none' ? '' : filter + ' ') + `blur(${focusBlur}px)`;
  if (filter && filter !== 'none') ctx.filter = filter;

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
    drawImage(ctx, el, sw, sh, options);
  } else if (type === 'video') {
    if (options.awaitMedia) {
      return drawVideo(ctx, el, timeMs, sw, sh, options).finally(() => ctx.restore());
    }
    drawVideo(ctx, el, timeMs, sw, sh, options);
  } else if (type === 'audio') {
    // Audio-only layers live in the timeline and export mix; they do not draw.
  } else if (type === 'icon') {
    drawIcon(ctx, el, sw, sh);
  } else if (type === 'group' || type === 'component') {
    drawComponent(ctx, el, sw, sh);
  } else if (type === 'hyperframes') {
    const previewSource = metaValue(el, 'poster', null)
      || metaValue(el, 'thumbnail', null)
      || metaValue(el, 'source', null);
    if (previewSource) {
      drawImage(ctx, {
        ...el,
        meta: { ...(el.meta || {}), source: previewSource },
      }, sw, sh, options);
    } else {
      drawImagePlaceholder(ctx, sw, sh, 'HyperFrames preview');
    }
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
  const shape = String(metaValue(el, 'shape', el.type || 'rect')).toLowerCase();
  const radius = Math.max(0, Number(metaValue(el, 'radius', metaValue(el, 'rx', 0))) || 0);
  if (shape === 'circle' || shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(sw / 2, sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(sw / 2, 0);
    ctx.lineTo(sw, sh);
    ctx.lineTo(0, sh);
    ctx.closePath();
    ctx.fill();
  } else if (shape === 'polygon' || shape === 'star') {
    const sides = Math.max(3, Math.min(24, Math.round(Number(metaValue(el, 'sides', shape === 'star' ? 5 : 6)) || 6)));
    const points = shape === 'star' ? sides * 2 : sides;
    const outer = Math.min(sw, sh) * 0.5;
    const inner = outer * 0.46;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const angle = -Math.PI / 2 + (i / points) * Math.PI * 2;
      const r = shape === 'star' && i % 2 ? inner : outer;
      const x = sw / 2 + Math.cos(angle) * r;
      const y = sh / 2 + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (shape === 'line' || shape === 'arrow') {
    const y = sh / 2;
    const head = Math.max(6, Math.min(sw * 0.2, sh * 1.8));
    const rawStroke = metaValue(el, 'stroke', metaValue(el, 'color', null));
    const lineColor = !rawStroke || rawStroke === 'none' || rawStroke === 'transparent'
      ? metaValue(el, 'fill', '#ffffff')
      : rawStroke;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(shape === 'arrow' ? sw - head : sw, y);
    if (shape === 'arrow') {
      ctx.moveTo(sw - head, y - head * 0.6);
      ctx.lineTo(sw, y);
      ctx.lineTo(sw - head, y + head * 0.6);
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = Math.max(1, Number(metaValue(el, 'strokeWidth', 2)) || 2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else if (radius > 0 && typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(0, 0, sw, sh, Math.min(radius, Math.min(sw, sh) / 2));
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, sw, sh);
  }
  const stroke = metaValue(el, 'stroke', null);
  if (stroke && stroke !== 'transparent' && stroke !== 'none' && shape !== 'line' && shape !== 'arrow') {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = metaValue(el, 'strokeWidth', 1);
    if (radius > 0 && typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(0, 0, sw, sh, Math.min(radius, Math.min(sw, sh) / 2));
      ctx.stroke();
    } else {
      ctx.strokeRect(0, 0, sw, sh);
    }
  }
}

function drawEllipse(ctx, el, sw, sh) {
  ctx.beginPath();
  ctx.ellipse(sw / 2, sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
  const grad = buildGradientFill(ctx, effectView(el), sw, sh);
  ctx.fillStyle = grad || metaValue(el, 'fill', null) || metaValue(el, 'color', null) || 'rgba(99,102,241,0.8)';
  ctx.fill();
  const stroke = metaValue(el, 'stroke', null);
  if (stroke && stroke !== 'transparent' && stroke !== 'none') {
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
  const words = String(text ?? '').split(/\s+/);
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
  const paragraphs = String(text ?? '').split(/\r?\n/);
  let curY = y;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');
    let line = '';
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
    curY += lineHeight;
  }
}

function drawImage(ctx, el, sw, sh, options = {}) {
  const src = metaValue(el, 'src', null) || metaValue(el, 'url', null) || metaValue(el, 'source', null);
  if (!src) {
    drawImagePlaceholder(ctx, sw, sh, 'No src');
    return;
  }
  const img = loadImage(src, options.markDirty);
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
  const trimEndMs = Math.max(0, Number(el.meta?.trimEndMs) || 0);
  const speed = Math.max(0.05, Number(el.meta?.speed) || 1);
  const video = loadVideo(src, options.markDirty);
  if (options.awaitMedia) {
    await waitForVideoReady(video);
  }
  const sourceDurationMs = Number.isFinite(video.duration) ? Math.max(0, video.duration * 1000) : Infinity;
  const sourceEndMs = Math.max(trimStartMs, sourceDurationMs - trimEndMs);
  const localMs = Math.min(
    sourceEndMs,
    trimStartMs + Math.max(0, timeMs - startMs) * speed,
  );
  if (options.awaitMedia) {
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
    const poster = metaValue(el, 'poster', null);
    if (poster) {
      drawImage(ctx, {
        ...el,
        meta: { ...(el.meta || {}), source: poster },
      }, sw, sh, options);
    } else {
      drawImagePlaceholder(ctx, sw, sh, 'Loading...');
    }
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
  const rot = ((resolved.rotation || 0) + (Number(metaValue(el, 'roll', 0)) || 0)) * Math.PI / 180;
  const zoom = Math.max(0.05, Number(metaValue(el, 'zoom', 1)) || 1);

  ctx.save();
  ctx.translate(sx + sw / 2, sy + sh / 2);
  if (rot) ctx.rotate(rot);
  if (zoom !== 1) ctx.scale(zoom, zoom);
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
    .filter(el => isVisibleAtTime(el, timeMs) && el.locked !== true && el.meta?.locked !== true)
    .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0)); // top-first

  for (const el of visible) {
    const r = resolveElementAtTime(el, timeMs);
    const centerX = r.x + r.width / 2;
    const centerY = r.y + r.height / 2;
    const angle = -((Number(r.rotation) || 0) + (Number(el.meta?.roll) || 0)) * Math.PI / 180;
    const dx = sceneX - centerX;
    const dy = sceneY - centerY;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const zoom = Math.max(0.05, Number(metaValue(el, 'zoom', 1)) || 1);
    const localX = (dx * cos - dy * sin) / zoom + r.width / 2;
    const localY = (dx * sin + dy * cos) / zoom + r.height / 2;
    if (localX >= 0 && localX <= r.width && localY >= 0 && localY <= r.height) {
      return el;
    }
  }
  return null;
}

// ── Playback engine ──────────────────────────────────────────────────────────

// ── Public API ───────────────────────────────────────────────────────────────

export async function drawSceneToContext(ctx, scene, timeMs, transform, options = {}) {
  const { scale, panX, panY } = transform;
  const cssW = options.cssW || (ctx.canvas?.width || 1);
  const cssH = options.cssH || (ctx.canvas?.height || 1);

  drawBackground(ctx, scene, cssW, cssH);
  if (!scene) return;

  drawSceneBackground(ctx, scene, { scale, panX, panY });
  const hiddenTracks = new Set(options.hiddenTracks || []);
  const elements = (scene.elements || [])
    .filter(el => isVisibleAtTime(el, timeMs) && !hiddenTracks.has(editorTrackCategory(el.type)))
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  for (const el of elements) {
    const maybePromise = drawElement(ctx, el, timeMs, { scale, panX, panY }, options);
    if (options.awaitMedia && maybePromise && typeof maybePromise.then === 'function') {
      await maybePromise;
    }
  }

  if (Array.isArray(options.selectedIds)) {
    for (const el of elements) {
      if (options.selectedIds.includes(el.id) && el.locked !== true && el.meta?.locked !== true) {
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
  let _playbackRaf = null;
  let _lastPlaybackTs = null;
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
    const { timeMs, selectedIds, hiddenTracks } = store.getState();
    drawSceneToContext(ctx, scene, timeMs, { scale, panX, panY }, {
      cssW,
      cssH,
      selectedIds,
      hiddenTracks,
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

  function playbackLoop(ts) {
    if (_lastPlaybackTs !== null) {
      const delta = Math.min(100, Math.max(0, ts - _lastPlaybackTs));
      const { timeMs, durationMs, playing } = store.getState();
      if (playing) {
        const duration = Math.max(0, Number(durationMs) || 0);
        const next = Number(timeMs) + delta;
        if (duration <= 0) {
          store.setState({ timeMs: 0, playing: false });
        } else if (next >= duration) {
          // Hold on the final frame. This keeps the preview and timeline in
          // sync and lets the user scrub back without an unexpected jump.
          store.setState({ timeMs: duration, playing: false });
        } else {
          store.setState({ timeMs: next });
        }
      }
    }
    _lastPlaybackTs = ts;
    _playbackRaf = requestAnimationFrame(playbackLoop);
  }

  // Subscribe to store changes
  const unsubs = [
    store.subscribe(markDirty),
  ];

  // Start render loop
  loop();
  // Also start playback tick loop
  _playbackRaf = requestAnimationFrame(playbackLoop);

  function dispose() {
    if (_raf !== null) cancelAnimationFrame(_raf);
    if (_playbackRaf !== null) cancelAnimationFrame(_playbackRaf);
    _raf = null;
    _playbackRaf = null;
    _lastPlaybackTs = null;
    for (const u of unsubs) u();
  }

  return { draw, markDirty, dispose };
}
