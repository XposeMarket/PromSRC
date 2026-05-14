import * as ort from 'onnxruntime-node';
import Jimp from 'jimp';
import { requireCreativeModel, isCreativeModelAvailable } from './model-paths';
import { chwFloat32ToPngBuffer, loadJimp } from './image-utils';

const LAMA_MAX_SIDE = 1024;
const LAMA_PAD_MULTIPLE = 8;

let lamaSessionPromise: Promise<ort.InferenceSession> | null = null;

async function getLama(): Promise<ort.InferenceSession> {
  if (!lamaSessionPromise) {
    const p = requireCreativeModel('lama');
    lamaSessionPromise = ort.InferenceSession.create(p, { executionProviders: ['cpu'] });
  }
  return lamaSessionPromise;
}

export function isLamaAvailable(): boolean {
  return isCreativeModelAvailable('lama');
}

function nextMultiple(n: number, m: number): number {
  return Math.ceil(n / m) * m;
}

function resolveStaticDim(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
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

function jimpToImage01CHW(img: Jimp, width: number, height: number): Float32Array {
  const out = new Float32Array(3 * width * height);
  const planeSize = width * height;
  const { data } = img.bitmap;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const i = y * width + x;
      out[i] = data[idx] / 255;
      out[i + planeSize] = data[idx + 1] / 255;
      out[i + 2 * planeSize] = data[idx + 2] / 255;
    }
  }
  return out;
}

function maskToFloatPlane(mask: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number): Float32Array {
  const out = new Float32Array(dstW * dstH);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const my = Math.min(srcH - 1, Math.floor(y * sy));
    for (let x = 0; x < dstW; x++) {
      const mx = Math.min(srcW - 1, Math.floor(x * sx));
      out[y * dstW + x] = mask[my * srcW + mx] > 127 ? 1 : 0;
    }
  }
  return out;
}

export async function inpaintWithLama(opts: {
  imageAbsPath: string;
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
}): Promise<Buffer> {
  const session = await getLama();
  const original = await loadJimp(opts.imageAbsPath);
  const origW = original.bitmap.width;
  const origH = original.bitmap.height;

  const inputs = session.inputNames;
  const imageInputName = inputs.find((n) => /image|img|input(?!.*mask)/i.test(n)) || inputs[0];
  const maskInputName = inputs.find((n) => /mask/i.test(n)) || inputs[1];
  if (!imageInputName || !maskInputName) {
    throw new Error(`LaMa ONNX inputs unexpected: [${inputs.join(', ')}]`);
  }
  const imageDims = getInputShape(session, imageInputName);
  const staticH = resolveStaticDim(imageDims[2]);
  const staticW = resolveStaticDim(imageDims[3]);
  const fixedInput = !!staticW && !!staticH;
  const scale = fixedInput
    ? Math.min(staticW! / origW, staticH! / origH)
    : Math.min(1, LAMA_MAX_SIDE / Math.max(origW, origH));
  const resizedW = Math.max(1, Math.round(origW * scale));
  const resizedH = Math.max(1, Math.round(origH * scale));
  const targetW = fixedInput ? staticW! : nextMultiple(Math.max(8, resizedW), LAMA_PAD_MULTIPLE);
  const targetH = fixedInput ? staticH! : nextMultiple(Math.max(8, resizedH), LAMA_PAD_MULTIPLE);

  const resized = original.clone().resize(resizedW, resizedH, Jimp.RESIZE_BILINEAR);
  const padded = new Jimp(targetW, targetH, 0x000000ff);
  padded.composite(resized, 0, 0);

  const imageTensor = jimpToImage01CHW(padded, targetW, targetH);
  const maskPlane = new Float32Array(targetW * targetH);
  const sampled = maskToFloatPlane(opts.mask, opts.maskWidth, opts.maskHeight, resized.bitmap.width, resized.bitmap.height);
  for (let y = 0; y < resized.bitmap.height; y++) {
    for (let x = 0; x < resized.bitmap.width; x++) {
      maskPlane[y * targetW + x] = sampled[y * resized.bitmap.width + x];
    }
  }

  const feeds: Record<string, ort.Tensor> = {
    [imageInputName]: new ort.Tensor('float32', imageTensor, [1, 3, targetH, targetW]),
    [maskInputName]: new ort.Tensor('float32', maskPlane, [1, 1, targetH, targetW]),
  };
  const out = await session.run(feeds);
  const outputName = session.outputNames[0];
  const outTensor = out[outputName];
  if (!outTensor) throw new Error('LaMa returned no output tensor.');
  const outDims = outTensor.dims as number[];
  const outData = outTensor.data as Float32Array;
  if (outDims.length !== 4 || outDims[1] !== 3) {
    throw new Error(`Unexpected LaMa output dims ${outDims.join('x')}`);
  }
  const outH = outDims[2];
  const outW = outDims[3];
  const maxAbs = Math.max(...outData.slice(0, Math.min(outData.length, 4096)).map((v) => Math.abs(v)));
  const scaleOut = maxAbs > 1.5 ? 1 : 255;
  const png = await chwFloat32ToPngBuffer(outData, outW, outH, scaleOut);

  const inpainted = await Jimp.read(png);
  const cropped = inpainted.crop(0, 0, resized.bitmap.width, resized.bitmap.height);
  const final = cropped.resize(origW, origH, Jimp.RESIZE_BILINEAR);
  return final.getBufferAsync(Jimp.MIME_PNG);
}
