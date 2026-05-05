import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Jimp from 'jimp';
import { encodeImageForSam, runSamDecoder, isSamAvailable, type SamImageContext, type SamPrompt } from './sam';
import { inpaintWithLama, isLamaAvailable } from './lama';
import { traceFlatRegion, type TracedShape } from './vector-trace';
import { applyMaskToImage, dilate, loadJimp, pixelSampleColor, relativeLuminance, rgbaToHex, type RGBA } from './image-utils';

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

export function isSegmentationStackAvailable(): { sam: boolean; lama: boolean } {
  return { sam: isSamAvailable(), lama: isLamaAvailable() };
}

export type SamCutoutOptions = {
  sourceAbsPath: string;
  layers: ExtractionPipelineLayer[];
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
    if (layer.type !== 'image') {
      updated.push(layer);
      continue;
    }
    cutoutIndex++;
    try {
      const sam = await runSamDecoder(context, {
        box: { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
      });
      const applied = await applyMaskToImage(opts.sourceAbsPath, sam.mask, sam.width, sam.height, 0.5);
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
  if (!isLamaAvailable()) {
    return { absPath: opts.sourceAbsPath, written: false };
  }
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

  const buffer = await inpaintWithLama({
    imageAbsPath: opts.sourceAbsPath,
    mask,
    maskWidth: W,
    maskHeight: H,
  });
  let plate = await Jimp.read(buffer);
  plate = await flatFillTextRegions(plate, opts.textBoxes, textPad);
  fs.mkdirSync(path.dirname(opts.outputAbsPath), { recursive: true });
  await plate.writeAsync(opts.outputAbsPath);
  return { absPath: opts.outputAbsPath, written: true };
}

async function flatFillTextRegions(
  plate: Jimp,
  textBoxes: Array<{ x: number; y: number; width: number; height: number }>,
  pad: number,
): Promise<Jimp> {
  const W = plate.bitmap.width;
  const H = plate.bitmap.height;
  for (const raw of textBoxes) {
    const box = expandBox(raw, pad);
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(W, Math.ceil(box.x + box.width));
    const y1 = Math.min(H, Math.ceil(box.y + box.height));
    if (x1 <= x0 || y1 <= y0) continue;
    const ring = sampleRingColor(plate, x0, y0, x1 - x0, y1 - y0, Math.max(4, Math.round(pad / 2)));
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
