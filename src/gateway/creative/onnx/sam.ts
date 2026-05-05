import * as ort from 'onnxruntime-node';
import Jimp from 'jimp';
import { requireCreativeModel, isCreativeModelAvailable } from './model-paths';
import { jimpToImagenetCHW, loadJimp } from './image-utils';

const SAM_INPUT_SIZE = 1024;

let encoderSessionPromise: Promise<ort.InferenceSession> | null = null;
let decoderSessionPromise: Promise<ort.InferenceSession> | null = null;

async function getEncoder(): Promise<ort.InferenceSession> {
  if (!encoderSessionPromise) {
    const p = requireCreativeModel('sam_encoder');
    encoderSessionPromise = ort.InferenceSession.create(p, { executionProviders: ['cpu'] });
  }
  return encoderSessionPromise;
}

async function getDecoder(): Promise<ort.InferenceSession> {
  if (!decoderSessionPromise) {
    const p = requireCreativeModel('sam_decoder');
    decoderSessionPromise = ort.InferenceSession.create(p, { executionProviders: ['cpu'] });
  }
  return decoderSessionPromise;
}

export function isSamAvailable(): boolean {
  return isCreativeModelAvailable('sam_encoder') && isCreativeModelAvailable('sam_decoder');
}

export type SamPrompt = {
  box?: { x: number; y: number; width: number; height: number };
  points?: Array<{ x: number; y: number; positive: boolean }>;
};

export type SamMask = {
  mask: Float32Array;
  width: number;
  height: number;
  iou: number;
};

export type SamImageContext = {
  embeddings: ort.Tensor;
  origWidth: number;
  origHeight: number;
};

function letterboxScale(origW: number, origH: number): { scale: number; newW: number; newH: number } {
  const scale = SAM_INPUT_SIZE / Math.max(origW, origH);
  return {
    scale,
    newW: Math.round(origW * scale),
    newH: Math.round(origH * scale),
  };
}

function preprocessForSam(image: Jimp): { tensor: Float32Array; origWidth: number; origHeight: number } {
  const origW = image.bitmap.width;
  const origH = image.bitmap.height;
  const { scale, newW, newH } = letterboxScale(origW, origH);
  const resized = image.clone().resize(newW, newH, Jimp.RESIZE_BILINEAR);
  const padded = new Jimp(SAM_INPUT_SIZE, SAM_INPUT_SIZE, 0x000000ff);
  padded.composite(resized, 0, 0);
  void scale;
  return {
    tensor: jimpToImagenetCHW(padded, SAM_INPUT_SIZE, SAM_INPUT_SIZE),
    origWidth: origW,
    origHeight: origH,
  };
}

export async function encodeImageForSam(absPath: string): Promise<SamImageContext> {
  const session = await getEncoder();
  const image = await loadJimp(absPath);
  const { tensor, origWidth, origHeight } = preprocessForSam(image);
  const inputName = session.inputNames[0] || 'input';
  const outputName = session.outputNames[0] || 'image_embeddings';
  const inputTensor = new ort.Tensor('float32', tensor, [1, 3, SAM_INPUT_SIZE, SAM_INPUT_SIZE]);
  const outputs = await session.run({ [inputName]: inputTensor });
  const embeddings = outputs[outputName] || outputs[session.outputNames[0]];
  if (!embeddings) throw new Error('SAM encoder produced no embeddings tensor.');
  return { embeddings: embeddings as ort.Tensor, origWidth, origHeight };
}

function buildPromptTensors(prompt: SamPrompt, context: SamImageContext): { coords: Float32Array; labels: Float32Array; nPoints: number } {
  const { origWidth, origHeight } = context;
  const { scale } = letterboxScale(origWidth, origHeight);
  const coordsList: number[] = [];
  const labelsList: number[] = [];
  if (prompt.box) {
    const x0 = Math.max(0, prompt.box.x) * scale;
    const y0 = Math.max(0, prompt.box.y) * scale;
    const x1 = Math.min(origWidth, prompt.box.x + prompt.box.width) * scale;
    const y1 = Math.min(origHeight, prompt.box.y + prompt.box.height) * scale;
    coordsList.push(x0, y0, x1, y1);
    labelsList.push(2, 3);
  }
  if (prompt.points) {
    for (const pt of prompt.points) {
      coordsList.push(pt.x * scale, pt.y * scale);
      labelsList.push(pt.positive ? 1 : 0);
    }
  }
  if (!coordsList.length) {
    coordsList.push(0, 0);
    labelsList.push(-1);
  }
  return {
    coords: Float32Array.from(coordsList),
    labels: Float32Array.from(labelsList),
    nPoints: labelsList.length,
  };
}

export async function runSamDecoder(context: SamImageContext, prompt: SamPrompt): Promise<SamMask> {
  const decoder = await getDecoder();
  const { coords, labels, nPoints } = buildPromptTensors(prompt, context);
  const feeds: Record<string, ort.Tensor> = {};
  const inputs = decoder.inputNames;
  const setIfExpected = (name: string, tensor: ort.Tensor) => {
    if (inputs.includes(name)) feeds[name] = tensor;
  };
  setIfExpected('image_embeddings', context.embeddings);
  setIfExpected('point_coords', new ort.Tensor('float32', coords, [1, nPoints, 2]));
  setIfExpected('point_labels', new ort.Tensor('float32', labels, [1, nPoints]));
  setIfExpected('mask_input', new ort.Tensor('float32', new Float32Array(1 * 1 * 256 * 256), [1, 1, 256, 256]));
  setIfExpected('has_mask_input', new ort.Tensor('float32', Float32Array.from([0]), [1]));
  setIfExpected(
    'orig_im_size',
    new ort.Tensor('float32', Float32Array.from([context.origHeight, context.origWidth]), [2]),
  );
  for (const required of inputs) {
    if (!feeds[required]) {
      throw new Error(`MobileSAM decoder requires unexpected input "${required}". Update sam.ts to feed it.`);
    }
  }
  const out = await decoder.run(feeds);
  const masksTensor = out['masks'] || out[decoder.outputNames[0]];
  const iouTensor = out['iou_predictions'] || out[decoder.outputNames[1]];
  if (!masksTensor) throw new Error('SAM decoder returned no masks tensor.');
  const dims = masksTensor.dims as number[];
  const data = masksTensor.data as Float32Array;
  let H: number;
  let W: number;
  let nMasks: number;
  if (dims.length === 4) {
    nMasks = dims[1];
    H = dims[2];
    W = dims[3];
  } else if (dims.length === 3) {
    nMasks = dims[0];
    H = dims[1];
    W = dims[2];
  } else {
    throw new Error(`Unexpected SAM mask dims: ${dims.join('x')}`);
  }
  const iouRaw = iouTensor ? (iouTensor.data as Float32Array) : null;
  let bestIdx = 0;
  if (iouRaw && iouRaw.length >= nMasks) {
    let bestVal = -Infinity;
    for (let i = 0; i < nMasks; i++) {
      if (iouRaw[i] > bestVal) {
        bestVal = iouRaw[i];
        bestIdx = i;
      }
    }
  }
  const sliceSize = H * W;
  const slice = new Float32Array(sliceSize);
  const offset = bestIdx * sliceSize;
  for (let i = 0; i < sliceSize; i++) {
    const v = data[offset + i];
    slice[i] = 1 / (1 + Math.exp(-v));
  }
  return {
    mask: slice,
    width: W,
    height: H,
    iou: iouRaw ? iouRaw[bestIdx] : 1,
  };
}

export async function disposeSamSessions(): Promise<void> {
  encoderSessionPromise = null;
  decoderSessionPromise = null;
}
