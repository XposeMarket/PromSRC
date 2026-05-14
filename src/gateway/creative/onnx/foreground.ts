import * as ort from 'onnxruntime-node';
import Jimp from 'jimp';
import { isCreativeModelAvailable, requireCreativeModel } from './model-paths';
import { dilate, loadJimp } from './image-utils';

let rmbgSessionPromise: Promise<ort.InferenceSession> | null = null;

async function getRmbg(): Promise<ort.InferenceSession> {
  if (!rmbgSessionPromise) {
    const p = requireCreativeModel('rmbg');
    rmbgSessionPromise = ort.InferenceSession.create(p, { executionProviders: ['cpu'] });
  }
  return rmbgSessionPromise;
}

export function isForegroundModelAvailable(): boolean {
  return isCreativeModelAvailable('rmbg');
}

export type ForegroundMaskResult = {
  mask: Uint8Array;
  width: number;
  height: number;
  bbox: { x: number; y: number; width: number; height: number } | null;
  model: string;
};

function resolveStaticDim(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function getInputShape(session: ort.InferenceSession, inputName: string): unknown[] {
  const meta = (session as any).inputMetadata;
  const entry = Array.isArray(meta)
    ? meta.find((item: any) => item?.name === inputName)
    : meta?.[inputName];
  return Array.isArray(entry?.dimensions)
    ? entry.dimensions
    : Array.isArray(entry?.shape)
      ? entry.shape
      : [];
}

function imageToNormalizedCHW(img: Jimp, width: number, height: number): Float32Array {
  const resized = img.clone().resize(width, height, Jimp.RESIZE_BILINEAR);
  const out = new Float32Array(3 * width * height);
  const planeSize = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const i = y * width + x;
      out[i] = resized.bitmap.data[idx] / 255;
      out[i + planeSize] = resized.bitmap.data[idx + 1] / 255;
      out[i + 2 * planeSize] = resized.bitmap.data[idx + 2] / 255;
    }
  }
  return out;
}

function normalizeMaskValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (min < 0 || max > 1.5) {
    const span = Math.max(1e-6, max - min);
    return Math.max(0, Math.min(1, (value - min) / span));
  }
  return Math.max(0, Math.min(1, value));
}

function largestComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
  const total = width * height;
  const seen = new Uint8Array(total);
  const best = new Uint8Array(total);
  const queue = new Int32Array(total);
  let bestCount = 0;
  for (let start = 0; start < total; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const pixel = queue[head++];
      count++;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const add = (next: number) => {
        if (next < 0 || next >= total || seen[next] || !mask[next]) return;
        seen[next] = 1;
        queue[tail++] = next;
      };
      if (x > 0) add(pixel - 1);
      if (x < width - 1) add(pixel + 1);
      if (y > 0) add(pixel - width);
      if (y < height - 1) add(pixel + width);
    }
    if (count > bestCount) {
      best.fill(0);
      for (let i = 0; i < tail; i++) best[queue[i]] = 255;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : mask;
}

function maskBbox(mask: Uint8Array, width: number, height: number): { x: number; y: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function resizeMaskBilinearToAlpha(mask: Float32Array | number[], srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    const v = Number(mask[i]);
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Uint8Array(dstW * dstH);
  const sx = srcW / Math.max(1, dstW);
  const sy = srcH / Math.max(1, dstH);
  for (let y = 0; y < dstH; y++) {
    const fy = Math.min(srcH - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const wy = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < dstW; x++) {
      const fx = Math.min(srcW - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const wx = Math.max(0, Math.min(1, fx - x0));
      const a = normalizeMaskValue(Number(mask[y0 * srcW + x0]), min, max);
      const b = normalizeMaskValue(Number(mask[y0 * srcW + x1]), min, max);
      const c = normalizeMaskValue(Number(mask[y1 * srcW + x0]), min, max);
      const d = normalizeMaskValue(Number(mask[y1 * srcW + x1]), min, max);
      const top = a * (1 - wx) + b * wx;
      const bottom = c * (1 - wx) + d * wx;
      out[y * dstW + x] = Math.max(0, Math.min(255, Math.round((top * (1 - wy) + bottom * wy) * 255)));
    }
  }
  return out;
}

function thresholdAlpha(alpha: Uint8Array, threshold: number): Uint8Array {
  const out = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = alpha[i] >= threshold ? 255 : 0;
  return out;
}

function fillEnclosedHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const total = width * height;
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const enqueue = (pixel: number) => {
    if (pixel < 0 || pixel >= total || outside[pixel] || mask[pixel]) return;
    outside[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x < width - 1) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y < height - 1) enqueue(pixel + width);
  }
  const filled = new Uint8Array(mask);
  for (let i = 0; i < total; i++) {
    if (!mask[i] && !outside[i]) filled[i] = 255;
  }
  return filled;
}

function refineAlphaWithComponent(alpha: Uint8Array, component: Uint8Array, width: number, height: number): Uint8Array {
  const core = fillEnclosedHoles(component, width, height);
  const support = new Uint8Array(core);
  dilate(support, width, height, 1);
  const refined = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    if (!support[i]) continue;
    if (core[i]) {
      refined[i] = Math.max(alpha[i], 224);
    } else {
      refined[i] = Math.min(alpha[i], 180);
    }
  }
  return refined;
}

export async function runForegroundMask(absPath: string, opts: { threshold?: number; largestOnly?: boolean } = {}): Promise<ForegroundMaskResult> {
  const session = await getRmbg();
  const image = await loadJimp(absPath);
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const inputName = session.inputNames[0];
  if (!inputName) throw new Error('RMBG model has no input tensor.');
  const dims = getInputShape(session, inputName);
  const inputH = resolveStaticDim(dims[2], 1024);
  const inputW = resolveStaticDim(dims[3], 1024);
  const feeds: Record<string, ort.Tensor> = {
    [inputName]: new ort.Tensor('float32', imageToNormalizedCHW(image, inputW, inputH), [1, 3, inputH, inputW]),
  };
  const outputs = await session.run(feeds);
  const outputName = session.outputNames[0];
  const out = outputs[outputName];
  if (!out) throw new Error('RMBG model returned no output tensor.');
  const outDims = out.dims as number[];
  const outData = out.data as Float32Array;
  const maskH = resolveStaticDim(outDims[outDims.length - 2], inputH);
  const maskW = resolveStaticDim(outDims[outDims.length - 1], inputW);
  const alpha = resizeMaskBilinearToAlpha(outData, maskW, maskH, width, height);
  let component = thresholdAlpha(alpha, Math.round((opts.threshold ?? 0.45) * 255));
  if (opts.largestOnly !== false) component = largestComponent(component, width, height);
  const mask = refineAlphaWithComponent(alpha, component, width, height);
  const bbox = maskBbox(mask, width, height);
  return { mask, width, height, bbox, model: 'rmbg' };
}

export async function disposeForegroundSessions(): Promise<void> {
  rmbgSessionPromise = null;
}
