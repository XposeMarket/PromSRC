import fs from 'fs';
import path from 'path';
import { getConfig } from '../../../config/config';
import { toAsarUnpackedPath } from '../../../runtime/dependencies';

export type CreativeModelKey = 'sam_encoder' | 'sam_decoder' | 'lama' | 'rmbg';

const FILE_NAMES: Record<CreativeModelKey, string> = {
  sam_encoder: 'mobile_sam_encoder.onnx',
  sam_decoder: 'mobile_sam_decoder.onnx',
  lama: 'lama.onnx',
  rmbg: 'rmbg.onnx',
};

const ENV_OVERRIDES: Record<CreativeModelKey, string> = {
  sam_encoder: 'PROMETHEUS_MOBILESAM_ENCODER_PATH',
  sam_decoder: 'PROMETHEUS_MOBILESAM_DECODER_PATH',
  lama: 'PROMETHEUS_LAMA_PATH',
  rmbg: 'PROMETHEUS_RMBG_PATH',
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
  rmbg: [
    'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx',
    'https://huggingface.co/briaai/RMBG-2.0/resolve/main/onnx/model.onnx',
    'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx',
  ],
};

export function getCreativeModelsDir(): string {
  const dir = path.join(getConfig().getConfigDir(), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function modelCandidatePaths(key: CreativeModelKey): string[] {
  const fileName = FILE_NAMES[key];
  const candidates: string[] = [];
  const override = process.env[ENV_OVERRIDES[key]];
  if (override && override.trim()) candidates.push(path.resolve(override.trim()));

  const resourcesPath = (process as any).resourcesPath ? String((process as any).resourcesPath) : '';
  if (resourcesPath) candidates.push(toAsarUnpackedPath(path.join(resourcesPath, 'creative-models', fileName)));

  const configDir = getConfig().getConfigDir();
  candidates.push(path.join(getCreativeModelsDir(), fileName));

  const workspacePath = getConfig().getWorkspacePath?.() || '';
  if (workspacePath) candidates.push(path.join(workspacePath, '.prometheus', 'models', fileName));

  // Compatibility for older/manual installs that ran from the workspace cwd and
  // wrote model weights to workspace/.prometheus/models while the runtime reads
  // from the config dir. Keep this after the canonical config-dir path.
  candidates.push(path.join(configDir, '..', 'workspace', '.prometheus', 'models', fileName));

  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

function modelFileSize(modelPath: string): number | null {
  try {
    return fs.statSync(modelPath).size;
  } catch {
    return null;
  }
}

function isUsableModelFile(modelPath: string): boolean {
  const size = modelFileSize(modelPath);
  return size !== null && size > 1024;
}

export function resolveCreativeModelPath(key: CreativeModelKey): string {
  const candidates = modelCandidatePaths(key);
  const found = candidates.find(isUsableModelFile);
  return found || candidates[0] || path.join(getCreativeModelsDir(), FILE_NAMES[key]);
}

export function isCreativeModelAvailable(key: CreativeModelKey): boolean {
  return isUsableModelFile(resolveCreativeModelPath(key));
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
  candidates: Array<{ path: string; available: boolean; sizeBytes: number | null }>;
}> {
  return (Object.keys(FILE_NAMES) as CreativeModelKey[]).map((key) => {
    const p = resolveCreativeModelPath(key);
    const candidates = modelCandidatePaths(key).map((candidate) => {
      const sizeBytes = modelFileSize(candidate);
      return {
        path: candidate,
        available: sizeBytes !== null && sizeBytes > 1024,
        sizeBytes,
      };
    });
    const size = modelFileSize(p);
    return {
      key,
      fileName: FILE_NAMES[key],
      path: p,
      available: isCreativeModelAvailable(key),
      sizeBytes: size,
      urlHints: CREATIVE_MODEL_URL_HINTS[key],
      candidates,
    };
  });
}
