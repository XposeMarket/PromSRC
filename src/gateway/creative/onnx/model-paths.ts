import fs from 'fs';
import path from 'path';
import { getConfig } from '../../../config/config';

export type CreativeModelKey = 'sam_encoder' | 'sam_decoder' | 'lama';

const FILE_NAMES: Record<CreativeModelKey, string> = {
  sam_encoder: 'mobile_sam_encoder.onnx',
  sam_decoder: 'mobile_sam_decoder.onnx',
  lama: 'lama.onnx',
};

const ENV_OVERRIDES: Record<CreativeModelKey, string> = {
  sam_encoder: 'PROMETHEUS_MOBILESAM_ENCODER_PATH',
  sam_decoder: 'PROMETHEUS_MOBILESAM_DECODER_PATH',
  lama: 'PROMETHEUS_LAMA_PATH',
};

export const CREATIVE_MODEL_URL_HINTS: Record<CreativeModelKey, string[]> = {
  sam_encoder: [
    'https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx',
  ],
  sam_decoder: [
    'https://huggingface.co/Acly/MobileSAM/resolve/main/sam_mask_decoder_multi.onnx',
  ],
  lama: [
    'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
    'https://huggingface.co/aka7774/lama-onnx/resolve/main/big-lama.onnx',
  ],
};

export function getCreativeModelsDir(): string {
  const dir = path.join(getConfig().getConfigDir(), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveCreativeModelPath(key: CreativeModelKey): string {
  const override = process.env[ENV_OVERRIDES[key]];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(getCreativeModelsDir(), FILE_NAMES[key]);
}

export function isCreativeModelAvailable(key: CreativeModelKey): boolean {
  try {
    return fs.statSync(resolveCreativeModelPath(key)).size > 1024;
  } catch {
    return false;
  }
}

export function requireCreativeModel(key: CreativeModelKey): string {
  const target = resolveCreativeModelPath(key);
  if (!isCreativeModelAvailable(key)) {
    const hints = CREATIVE_MODEL_URL_HINTS[key].map((u) => `  • ${u}`).join('\n');
    throw new Error(
      `Creative model "${FILE_NAMES[key]}" not found at ${target}. ` +
        `Run "node scripts/download-creative-models.mjs" or download manually from one of:\n${hints}`,
    );
  }
  return target;
}

export function listCreativeModelStatus(): Array<{
  key: CreativeModelKey;
  fileName: string;
  path: string;
  available: boolean;
  sizeBytes: number | null;
  urlHints: string[];
}> {
  return (Object.keys(FILE_NAMES) as CreativeModelKey[]).map((key) => {
    const p = resolveCreativeModelPath(key);
    let size: number | null = null;
    try {
      size = fs.statSync(p).size;
    } catch {
      size = null;
    }
    return {
      key,
      fileName: FILE_NAMES[key],
      path: p,
      available: isCreativeModelAvailable(key),
      sizeBytes: size,
      urlHints: CREATIVE_MODEL_URL_HINTS[key],
    };
  });
}
