import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Jimp from 'jimp';
import { encodeImageForSam, runSamDecoder, isSamAvailable, type SamImageContext, type SamPrompt } from './sam';
import { inpaintWithLama, isLamaAvailable } from './lama';
import { traceFlatRegion, type TracedShape } from './vector-trace';
import { applyAlphaMaskToImage, applyMaskToImage, dilate, loadJimp, pixelSampleColor, relativeLuminance, rgbaToHex, type RGBA } from './image-utils';
import { isForegroundModelAvailable, runForegroundMask } from './foreground';

export type ExtractionPipelineLayer = {
  id?: string;
  type: 'text' | 'shape' | 'image' | 'group';
  role?: string;
  content?: string;
  description?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  confidence?: number;
  meta?: Record<string, any>;
  /* Additions populated by the pipeline */
  cutoutPath?: string;
  cutoutAbsPath?: string;
  cutoutBbox?: { x: number; y: number; width: number; height: number };
  cutoutMaskWidth?: number;
  cutoutMaskHeight?: number;
  sampledColor?: string | null;
  sampledTextColor?: string | null;
  vectorPath?: string | null;
};

export type RunSamCutoutsResult = {
  layers: ExtractionPipelineLayer[];
  context: SamImageContext | null;
  contentHash: string;
};

const samContextCache: Map<string, SamImageContext> = new Map();
const SAM_CACHE_LIMIT = 4;

export async function getOrEncodeSamContext(absPath: string): Promise<{ context: SamImageContext; hash: string }> {
  const buf = fs.readFileSync(absPath);
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  let ctx = samContextCache.get(hash);
  if (!ctx) {
    ctx = await encodeImageForSam(absPath);
    samContextCache.set(hash, ctx);
    while (samContextCache.size > SAM_CACHE_LIMIT) {
      const firstKey = samContextCache.keys().next().value;
      if (firstKey === undefined) break;
      samContextCache.delete(firstKey);
    }
  }
  return { context: ctx, hash };
}

export function isSegmentationStackAvailable(): { sam: boolean; lama: boolean; foreground: boolean } {
  return { sam: isSamAvailable(), lama: isLamaAvailable(), foreground: isForegroundModelAvailable() };
}

export type SamCutoutOptions = {
  sourceAbsPath: string;
  layers: ExtractionPipelineLayer[];
  outputDir: string;
  contentHashSeed?: string;
};

export type ApproximateCutoutOptions = {
  sourceAbsPath: string;
  layers: ExtractionPipelineLayer[];
  outputDir: string;
  contentHashSeed?: string;
};

export type ForegroundSubjectCutoutOptions = {
  sourceAbsPath: string;
  outputDir: string;
  contentHashSeed?: string;
};

export async function runSamCutouts(opts: SamCutoutOptions): Promise<RunSamCutoutsResult> {
  if (!isSamAvailable()) {
    return { layers: opts.layers, context: null, contentHash: '' };
  }
  const { context, hash } = await getOrEncodeSamContext(opts.sourceAbsPath);
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const updated: ExtractionPipelineLayer[] = [];
  let cutoutIndex = 0;
  for (const layer of opts.layers) {
    if (layer.type !== 'image' || layer.cutoutAbsPath) {
      updated.push(layer);
      continue;
    }
    cutoutIndex++;
    try {
      const box = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
      const sam = await runSamDecoder(context, {
        box,
        points: buildSubjectPromptPoints(box, context.origWidth, context.origHeight),
      });
      const applied = await applyMaskToImage(opts.sourceAbsPath, sam.mask, sam.width, sam.height, 0.58);
      if (!applied.bbox) {
        updated.push(layer);
        continue;
      }
      const fileName = `cutout_${cutoutIndex.toString(36)}_${hash.slice(0, 8)}.png`;
      const cutAbs = path.join(opts.outputDir, fileName);
      fs.writeFileSync(cutAbs, applied.buffer);
      updated.push({
        ...layer,
        cutoutAbsPath: cutAbs,
        cutoutBbox: applied.bbox,
        cutoutMaskWidth: applied.width,
        cutoutMaskHeight: applied.height,
        x: applied.bbox.x,
        y: applied.bbox.y,
        width: applied.bbox.width,
        height: applied.bbox.height,
        confidence: layer.confidence ?? sam.iou,
      });
    } catch (err) {
      updated.push({
        ...layer,
        meta: { ...(layer.meta || {}), samError: String((err as any)?.message || err).slice(0, 240) },
      });
    }
  }
  return { layers: updated, context, contentHash: hash };
}

function buildSubjectPromptPoints(
  box: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): Array<{ x: number; y: number; positive: boolean }> {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(imageWidth, box.x + box.width);
  const y1 = Math.min(imageHeight, box.y + box.height);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const cx = x0 + w * 0.5;
  const cy = y0 + h * 0.5;
  const points: Array<{ x: number; y: number; positive: boolean }> = [
    { x: cx, y: cy, positive: true },
    { x: x0 + w * 0.38, y: y0 + h * 0.48, positive: true },
    { x: x0 + w * 0.62, y: y0 + h * 0.48, positive: true },
  ];
  const insetX = Math.max(3, Math.min(18, w * 0.06));
  const insetY = Math.max(3, Math.min(18, h * 0.06));
  points.push(
    { x: x0 + insetX, y: y0 + insetY, positive: false },
    { x: x1 - insetX, y: y0 + insetY, positive: false },
    { x: x0 + insetX, y: y1 - insetY, positive: false },
    { x: x1 - insetX, y: y1 - insetY, positive: false },
  );
  return points.filter((point) => point.x >= 0 && point.y >= 0 && point.x <= imageWidth && point.y <= imageHeight);
}

export async function runApproximateCutouts(opts: ApproximateCutoutOptions): Promise<{ layers: ExtractionPipelineLayer[]; cutoutCount: number }> {
  const source = await Jimp.read(opts.sourceAbsPath);
  const hash = opts.contentHashSeed || crypto.createHash('sha1').update(fs.readFileSync(opts.sourceAbsPath)).digest('hex');
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const updated: ExtractionPipelineLayer[] = [];
  let cutoutIndex = 0;
  let cutoutCount = 0;
  for (const layer of opts.layers) {
    if (layer.type !== 'image' || layer.cutoutAbsPath) {
      updated.push(layer);
      continue;
    }
    cutoutIndex++;
    try {
      const applied = await approximateCutoutFromBox(source, {
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
      });
      if (!applied) {
        updated.push(layer);
        continue;
      }
      const fileName = `approx_cutout_${cutoutIndex.toString(36)}_${hash.slice(0, 8)}.png`;
      const cutAbs = path.join(opts.outputDir, fileName);
      fs.writeFileSync(cutAbs, applied.buffer);
      cutoutCount++;
      updated.push({
        ...layer,
        cutoutAbsPath: cutAbs,
        cutoutBbox: applied.bbox,
        cutoutMaskWidth: source.bitmap.width,
        cutoutMaskHeight: source.bitmap.height,
        x: applied.bbox.x,
        y: applied.bbox.y,
        width: applied.bbox.width,
        height: applied.bbox.height,
        confidence: Math.max(0.35, Number(layer.confidence) || 0.35),
        meta: {
          ...(layer.meta || {}),
          approximateCutout: true,
        },
      });
    } catch (err) {
      updated.push({
        ...layer,
        meta: { ...(layer.meta || {}), approximateCutoutError: String((err as any)?.message || err).slice(0, 240) },
      });
    }
  }
  return { layers: updated, cutoutCount };
}

export async function runForegroundSubjectCutout(opts: ForegroundSubjectCutoutOptions): Promise<{ layer: ExtractionPipelineLayer | null; model: string | null }> {
  if (!isForegroundModelAvailable()) return { layer: null, model: null };
  const fg = await runForegroundMask(opts.sourceAbsPath, { threshold: 0.45, largestOnly: true });
  if (!fg.bbox) return { layer: null, model: fg.model };
  const area = fg.bbox.width * fg.bbox.height;
  const canvasArea = fg.width * fg.height;
  if (area < canvasArea * 0.025 || area > canvasArea * 0.92) return { layer: null, model: fg.model };
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const hash = opts.contentHashSeed || crypto.createHash('sha1').update(fs.readFileSync(opts.sourceAbsPath)).digest('hex');
  const applied = await applyAlphaMaskToImage(opts.sourceAbsPath, fg.mask, fg.width, fg.height, 8);
  if (!applied.bbox) return { layer: null, model: fg.model };
  const cutAbs = path.join(opts.outputDir, `foreground_subject_${hash.slice(0, 8)}.png`);
  fs.writeFileSync(cutAbs, applied.buffer);
  return {
    model: fg.model,
    layer: {
      id: 'foreground_subject',
      type: 'image',
      role: 'foreground_subject',
      description: 'Primary foreground subject',
      x: applied.bbox.x,
      y: applied.bbox.y,
      width: applied.bbox.width,
      height: applied.bbox.height,
      confidence: 0.86,
      cutoutAbsPath: cutAbs,
      cutoutBbox: applied.bbox,
      cutoutMaskWidth: fg.width,
      cutoutMaskHeight: fg.height,
      meta: {
        foregroundModel: fg.model,
        subjectCutout: true,
      },
    },
  };
}

async function approximateCutoutFromBox(
  source: Jimp,
  rawBox: { x: number; y: number; width: number; height: number },
): Promise<{ buffer: Buffer; bbox: { x: number; y: number; width: number; height: number } } | null> {
  const sourceW = source.bitmap.width;
  const sourceH = source.bitmap.height;
  const x0 = Math.max(0, Math.floor(rawBox.x));
  const y0 = Math.max(0, Math.floor(rawBox.y));
  const x1 = Math.min(sourceW, Math.ceil(rawBox.x + rawBox.width));
  const y1 = Math.min(sourceH, Math.ceil(rawBox.y + rawBox.height));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  if (w < 8 || h < 8) return null;
  const crop = source.clone().crop(x0, y0, w, h);
  const data = crop.bitmap.data;
  const samples: RGBA[] = [];
  const pushSample = (x: number, y: number) => {
    const idx = (y * w + x) * 4;
    if (data[idx + 3] < 8) return;
    samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] });
  };
  const cornerSamples: RGBA[] = [];
  const pushCornerSample = (x: number, y: number) => {
    const idx = (y * w + x) * 4;
    if (data[idx + 3] < 8) return;
    cornerSamples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] });
  };
  const cornerW = Math.max(3, Math.round(w * 0.12));
  const cornerH = Math.max(3, Math.round(h * 0.12));
  for (let y = 0; y < cornerH; y++) {
    for (let x = 0; x < cornerW; x++) {
      pushCornerSample(x, y);
      pushCornerSample(w - 1 - x, y);
      pushCornerSample(x, h - 1 - y);
      pushCornerSample(w - 1 - x, h - 1 - y);
    }
  }
  for (let x = 0; x < w; x++) {
    pushSample(x, 0);
    pushSample(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    pushSample(0, y);
    pushSample(w - 1, y);
  }
  if (!samples.length) return null;
  const median = (pick: (sample: RGBA) => number) => {
    const sourceSamples = cornerSamples.length >= 16 ? cornerSamples : samples;
    const values = sourceSamples.map(pick).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] || 0;
  };
  const bg: RGBA = { r: median((s) => s.r), g: median((s) => s.g), b: median((s) => s.b), a: 255 };
  const bgLum = 255 * relativeLuminance(bg);
  const bgSat = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
  const sat = (idx: number) => Math.max(data[idx], data[idx + 1], data[idx + 2]) - Math.min(data[idx], data[idx + 1], data[idx + 2]);
  const lum = (idx: number) => 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
  const dist = (idx: number) => {
    const dr = data[idx] - bg.r;
    const dg = data[idx + 1] - bg.g;
    const db = data[idx + 2] - bg.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  const similarToBackground = (pixel: number): boolean => {
    const idx = pixel * 4;
    if (data[idx + 3] < 8) return true;
    const pixelLum = lum(idx);
    const pixelSat = sat(idx);
    const brightOrColored = pixelLum > bgLum + 28 || pixelSat > Math.max(52, bgSat + 38);
    const darkMatteLike = pixelLum <= bgLum + 18 && pixelSat <= bgSat + 32;
    return !brightOrColored && (dist(idx) < 74 || (darkMatteLike && Math.abs(pixelLum - bgLum) < 58));
  };
  const total = w * h;
  const background = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const enqueue = (pixel: number) => {
    if (pixel < 0 || pixel >= total || background[pixel]) return;
    if (!similarToBackground(pixel)) return;
    background[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < w; x++) {
    enqueue(x);
    enqueue((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    enqueue(y * w);
    enqueue(y * w + w - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    const px = pixel % w;
    const py = Math.floor(pixel / w);
    if (px > 0) enqueue(pixel - 1);
    if (px < w - 1) enqueue(pixel + 1);
    if (py > 0) enqueue(pixel - w);
    if (py < h - 1) enqueue(pixel + w);
  }

  let foreground = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let pixel = 0; pixel < total; pixel++) {
    const idx = pixel * 4;
    if (background[pixel]) {
      data[idx + 3] = 0;
      continue;
    }
    if (data[idx + 3] > 8) {
      foreground++;
      const px = pixel % w;
      const py = Math.floor(pixel / w);
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  const minForeground = Math.max(32, total * 0.012);
  if (foreground < minForeground || foreground > total * 0.985 || maxX < minX || maxY < minY) return null;
  featherCutoutAlpha(data, background, w, h);
  const pad = Math.min(10, Math.max(2, Math.round(Math.min(maxX - minX + 1, maxY - minY + 1) * 0.025)));
  const tx = Math.max(0, minX - pad);
  const ty = Math.max(0, minY - pad);
  const tw = Math.min(w - tx, maxX - minX + 1 + pad * 2);
  const th = Math.min(h - ty, maxY - minY + 1 + pad * 2);
  const trimmed = crop.clone().crop(tx, ty, tw, th);
  return {
    buffer: await trimmed.getBufferAsync(Jimp.MIME_PNG),
    bbox: { x: x0 + tx, y: y0 + ty, width: tw, height: th },
  };
}

function featherCutoutAlpha(data: Buffer, background: Uint8Array, w: number, h: number): void {
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const pixel = y * w + x;
      if (background[pixel]) continue;
      const touchesBg = background[pixel - 1] || background[pixel + 1] || background[pixel - w] || background[pixel + w];
      if (touchesBg) {
        const idx = pixel * 4;
        data[idx + 3] = Math.min(data[idx + 3], 205);
      }
    }
  }
}

export async function refineCutoutWithPoints(opts: {
  sourceAbsPath: string;
  outputAbsPath: string;
  bbox: { x: number; y: number; width: number; height: number };
  points: Array<{ x: number; y: number; positive: boolean }>;
}): Promise<{ buffer: Buffer; bbox: { x: number; y: number; width: number; height: number } | null }> {
  if (!isSamAvailable()) throw new Error('SAM models not installed; run scripts/download-creative-models.mjs');
  const { context } = await getOrEncodeSamContext(opts.sourceAbsPath);
  const prompt: SamPrompt = {
    box: opts.bbox,
    points: opts.points,
  };
  const sam = await runSamDecoder(context, prompt);
  const applied = await applyMaskToImage(opts.sourceAbsPath, sam.mask, sam.width, sam.height, 0.5);
  fs.mkdirSync(path.dirname(opts.outputAbsPath), { recursive: true });
  fs.writeFileSync(opts.outputAbsPath, applied.buffer);
  return applied;
}

export type CleanPlateOptions = {
  sourceAbsPath: string;
  outputAbsPath: string;
  cutoutLayers: ExtractionPipelineLayer[];
  textBoxes: Array<{ x: number; y: number; width: number; height: number }>;
  shapeBoxes: Array<{ x: number; y: number; width: number; height: number }>;
  padPx?: number;
};

export async function produceCleanPlate(opts: CleanPlateOptions): Promise<{ absPath: string; written: boolean }> {
  const img = await loadJimp(opts.sourceAbsPath);
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  const mask = new Uint8Array(W * H);
  for (const layer of opts.cutoutLayers) {
    if (!layer.cutoutAbsPath) continue;
    try {
      const cut = await Jimp.read(layer.cutoutAbsPath);
      const offX = Math.max(0, Math.round(layer.cutoutBbox?.x ?? layer.x));
      const offY = Math.max(0, Math.round(layer.cutoutBbox?.y ?? layer.y));
      for (let y = 0; y < cut.bitmap.height; y++) {
        for (let x = 0; x < cut.bitmap.width; x++) {
          const idx = (y * cut.bitmap.width + x) * 4;
          if (cut.bitmap.data[idx + 3] > 64) {
            const gx = offX + x;
            const gy = offY + y;
            if (gx >= 0 && gx < W && gy >= 0 && gy < H) mask[gy * W + gx] = 255;
          }
        }
      }
    } catch {
      // Fall back to bbox below.
      const bx = layer.cutoutBbox || { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
      paintBoxMask(mask, W, H, bx);
    }
  }
  const textPad = Math.max(8, Math.round(opts.padPx ?? 16) + 6);
  const shapePad = Math.max(4, Math.round((opts.padPx ?? 16) / 2));
  for (const box of opts.textBoxes) paintBoxMask(mask, W, H, expandBox(box, textPad));
  for (const box of opts.shapeBoxes) paintBoxMask(mask, W, H, expandBox(box, shapePad));
  const pad = Math.max(0, Math.round(opts.padPx ?? 16));
  if (pad > 0) dilate(mask, W, H, pad);

  let active = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) active++;
  if (!active) return { absPath: opts.sourceAbsPath, written: false };

  const diagPath = path.join(path.dirname(opts.outputAbsPath), '..', '..', '..', 'logs', 'lama-errors.log');
  const writeDiag = (line: string) => {
    try {
      fs.mkdirSync(path.dirname(diagPath), { recursive: true });
      fs.appendFileSync(diagPath, `[${new Date().toISOString()}] ${line}\n`);
    } catch { /* ignore */ }
  };
  writeDiag(`produceCleanPlate: lamaAvailable=${isLamaAvailable()} mask_active=${active}/${mask.length} W=${W} H=${H}`);

  let plate: Jimp | null = null;
  if (isLamaAvailable()) {
    try {
      writeDiag('LaMa: starting inference');
      const buffer = await inpaintWithLama({
        imageAbsPath: opts.sourceAbsPath,
        mask,
        maskWidth: W,
        maskHeight: H,
      });
      plate = await Jimp.read(buffer);
      writeDiag('LaMa: success');
    } catch (err) {
      // LaMa failed at runtime (OOM, ORT error, etc). Fall through to flat-fill
      // so the plate still gets the source regions erased — otherwise the locked
      // background ends up as the untouched original and dragging extracted
      // layers reveals everything underneath.
      const msg = (err as any)?.stack || (err as any)?.message || String(err);
      console.warn('[creative] LaMa inpainting failed, falling back to flat-fill:', msg);
      writeDiag(`LaMa: error ${msg}`);
      plate = null;
    }
  }
  if (!plate) {
    plate = img.clone();
    plate = await flatFillCutoutRegions(plate, opts.cutoutLayers, Math.max(6, Math.round(opts.padPx ?? 16)));
    plate = await flatFillBoxRegions(plate, opts.shapeBoxes, shapePad);
  }
  plate = await flatFillTextRegions(plate, opts.textBoxes, textPad);
  fs.mkdirSync(path.dirname(opts.outputAbsPath), { recursive: true });
  await plate.writeAsync(opts.outputAbsPath);
  return { absPath: opts.outputAbsPath, written: true };
}

async function flatFillBoxRegions(
  plate: Jimp,
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
  pad: number,
): Promise<Jimp> {
  return flatFillTextRegions(plate, boxes, pad);
}

async function flatFillCutoutRegions(
  plate: Jimp,
  cutoutLayers: ExtractionPipelineLayer[],
  pad: number,
): Promise<Jimp> {
  const W = plate.bitmap.width;
  const H = plate.bitmap.height;
  for (const layer of cutoutLayers) {
    const bbox = layer.cutoutBbox || { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    if (!bbox || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) continue;
    const x0 = Math.max(0, Math.floor(bbox.x - pad));
    const y0 = Math.max(0, Math.floor(bbox.y - pad));
    const x1 = Math.min(W, Math.ceil(bbox.x + bbox.width + pad));
    const y1 = Math.min(H, Math.ceil(bbox.y + bbox.height + pad));
    if (x1 <= x0 || y1 <= y0) continue;
    const ring = sampleRingColor(plate, x0, y0, x1 - x0, y1 - y0, Math.max(6, Math.round(pad / 2)));
    if (!ring) continue;
    if (layer.cutoutAbsPath) {
      try {
        const cut = await Jimp.read(layer.cutoutAbsPath);
        const offX = Math.max(0, Math.round(bbox.x));
        const offY = Math.max(0, Math.round(bbox.y));
        for (let y = 0; y < cut.bitmap.height; y++) {
          for (let x = 0; x < cut.bitmap.width; x++) {
            if (cut.bitmap.data[(y * cut.bitmap.width + x) * 4 + 3] > 64) {
              const gx = offX + x;
              const gy = offY + y;
              if (gx >= 0 && gx < W && gy >= 0 && gy < H) {
                const idx = (gy * W + gx) * 4;
                plate.bitmap.data[idx] = ring.r;
                plate.bitmap.data[idx + 1] = ring.g;
                plate.bitmap.data[idx + 2] = ring.b;
                plate.bitmap.data[idx + 3] = 255;
              }
            }
          }
        }
        continue;
      } catch {
        // fall through to bbox fill
      }
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * W + x) * 4;
        plate.bitmap.data[idx] = ring.r;
        plate.bitmap.data[idx + 1] = ring.g;
        plate.bitmap.data[idx + 2] = ring.b;
        plate.bitmap.data[idx + 3] = 255;
      }
    }
  }
  return plate;
}

async function flatFillTextRegions(
  plate: Jimp,
  textBoxes: Array<{ x: number; y: number; width: number; height: number }>,
  pad: number,
): Promise<Jimp> {
  const W = plate.bitmap.width;
  const H = plate.bitmap.height;
  for (const raw of textBoxes) {
    // Scale pad by box height so vision-tight bboxes still cover ascenders/descenders
    // and glow halos around large display type. Fixed `pad` alone leaks original glyphs.
    const dynamicPad = Math.max(pad, Math.ceil(Math.max(raw.height, raw.width * 0.15) * 0.45));
    const box = expandBox(raw, dynamicPad);
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(W, Math.ceil(box.x + box.width));
    const y1 = Math.min(H, Math.ceil(box.y + box.height));
    if (x1 <= x0 || y1 <= y0) continue;
    const ring = sampleRingColor(plate, x0, y0, x1 - x0, y1 - y0, Math.max(4, Math.round(dynamicPad / 2)));
    if (!ring) continue;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * W + x) * 4;
        plate.bitmap.data[idx] = ring.r;
        plate.bitmap.data[idx + 1] = ring.g;
        plate.bitmap.data[idx + 2] = ring.b;
        plate.bitmap.data[idx + 3] = 255;
      }
    }
  }
  return plate;
}

function sampleRingColor(
  img: Jimp,
  x: number,
  y: number,
  width: number,
  height: number,
  ring: number,
): RGBA | null {
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  let r = 0, g = 0, b = 0, n = 0;
  const sample = (sx: number, sy: number, sw: number, sh: number) => {
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    const x1 = Math.min(W, sx + sw), y1 = Math.min(H, sy + sh);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const idx = (yy * W + xx) * 4;
        r += img.bitmap.data[idx];
        g += img.bitmap.data[idx + 1];
        b += img.bitmap.data[idx + 2];
        n++;
      }
    }
  };
  sample(x - ring, y - ring, width + ring * 2, ring);
  sample(x - ring, y + height, width + ring * 2, ring);
  sample(x - ring, y, ring, height);
  sample(x + width, y, ring, height);
  if (!n) return null;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: 255 };
}

function expandBox(
  box: { x: number; y: number; width: number; height: number },
  pad: number,
): { x: number; y: number; width: number; height: number } {
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
}

function paintBoxMask(mask: Uint8Array, W: number, H: number, box: { x: number; y: number; width: number; height: number }): void {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(W, Math.ceil(box.x + box.width));
  const y1 = Math.min(H, Math.ceil(box.y + box.height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * W + x] = 255;
  }
}

export async function sampleLayerColors(opts: {
  sourceAbsPath: string;
  layers: ExtractionPipelineLayer[];
}): Promise<ExtractionPipelineLayer[]> {
  const img = await loadJimp(opts.sourceAbsPath);
  const out: ExtractionPipelineLayer[] = [];
  for (const layer of opts.layers) {
    if (layer.type !== 'text' && layer.type !== 'shape') {
      out.push(layer);
      continue;
    }
    const insideW = Math.max(2, Math.round(layer.width * 0.6));
    const insideH = Math.max(2, Math.round(layer.height * 0.6));
    const insideX = Math.round(layer.x + (layer.width - insideW) / 2);
    const insideY = Math.round(layer.y + (layer.height - insideH) / 2);
    const inside = await pixelSampleColor(img, insideX, insideY, insideW, insideH);
    const ringSize = Math.max(2, Math.round(Math.min(layer.width, layer.height) * 0.15));
    const ringX = Math.max(0, Math.round(layer.x - ringSize));
    const ringY = Math.max(0, Math.round(layer.y - ringSize));
    const ringW = Math.round(layer.width + ringSize * 2);
    const ringH = Math.round(layer.height + ringSize * 2);
    const around = await pixelSampleColor(img, ringX, ringY, ringW, ringH);

    if (layer.type === 'text') {
      out.push({
        ...layer,
        sampledTextColor: rgbaToHex(pickTextColor(inside, around)),
        sampledColor: rgbaToHex(around),
      });
    } else {
      out.push({
        ...layer,
        sampledColor: rgbaToHex(inside),
      });
    }
  }
  return out;
}

function isCropFlat(crop: Jimp): boolean {
  const W = crop.bitmap.width;
  const H = crop.bitmap.height;
  const total = W * H;
  if (total < 16) return false;
  const stride = Math.max(1, Math.floor(Math.sqrt(total / 1024)));
  let n = 0;
  let sumL = 0;
  let sumL2 = 0;
  for (let y = 0; y < H; y += stride) {
    for (let x = 0; x < W; x += stride) {
      const idx = (y * W + x) * 4;
      const r = crop.bitmap.data[idx];
      const g = crop.bitmap.data[idx + 1];
      const b = crop.bitmap.data[idx + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumL += lum;
      sumL2 += lum * lum;
      n++;
    }
  }
  if (!n) return false;
  const mean = sumL / n;
  const variance = Math.max(0, sumL2 / n - mean * mean);
  return Math.sqrt(variance) < 28;
}

function pickTextColor(inside: RGBA, around: RGBA): RGBA {
  const lumIn = relativeLuminance(inside);
  const lumOut = relativeLuminance(around);
  if (Math.abs(lumIn - lumOut) > 0.25) return inside;
  return lumOut > 0.5 ? { r: 17, g: 17, b: 17, a: 255 } : { r: 245, g: 245, b: 245, a: 255 };
}

export async function tryTraceShapeLayers(opts: {
  sourceAbsPath: string;
  layers: ExtractionPipelineLayer[];
}): Promise<ExtractionPipelineLayer[]> {
  const out: ExtractionPipelineLayer[] = [];
  let img: Jimp | null = null;
  for (const layer of opts.layers) {
    if (layer.type !== 'shape') {
      out.push(layer);
      continue;
    }
    try {
      if (!img) img = await loadJimp(opts.sourceAbsPath);
      const crop = img.clone().crop(
        Math.max(0, Math.round(layer.x)),
        Math.max(0, Math.round(layer.y)),
        Math.max(2, Math.round(layer.width)),
        Math.max(2, Math.round(layer.height)),
      );
      if (crop.bitmap.width > 320 || crop.bitmap.height > 320) {
        out.push(layer);
        continue;
      }
      if (!isCropFlat(crop)) {
        out.push(layer);
        continue;
      }
      const fill = layer.sampledColor || (layer.meta?.fill as string) || '#ffffff';
      const traced: TracedShape | null = await traceFlatRegion(crop, fill);
      if (traced) {
        out.push({
          ...layer,
          vectorPath: traced.svgPath,
          meta: { ...(layer.meta || {}), vectorPath: traced.svgPath, fill },
        });
        continue;
      }
    } catch {
      // ignore trace failure
    }
    out.push(layer);
  }
  return out;
}
