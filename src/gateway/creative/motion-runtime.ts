import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  normalizeCreativeMotionTemplateInstance,
  type CreativeMotionInput,
  type CreativeMotionTemplateInstance,
} from './contracts';
import { listCreativeMotionTemplates, getCreativeMotionTemplate } from '../../remotion/runtime/templateRegistry';
import { CREATIVE_SOCIAL_PRESETS } from '../../remotion/runtime/socialPresets';
import { resolveCreativeMotionInput, validateCreativeMotionInput } from '../../remotion/runtime/resolveTemplateInput';

type CreativeMotionStorageLike = {
  workspacePath: string;
  rootAbsPath: string;
  rootRelPath: string;
  creativeDir: string;
};

type CreativeMotionPreviewArtifact = {
  id: string;
  filename: string;
  path: string;
  absPath: string;
  mimeType: string;
  size: number;
  renderer: 'remotion' | 'html-fallback';
  width: number;
  height: number;
};

const remotionBundlePromises = new Map<string, Promise<string>>();

export function getCreativeMotionCatalog() {
  return {
    templates: listCreativeMotionTemplates(),
    socialPresets: Object.values(CREATIVE_SOCIAL_PRESETS),
  };
}

function escapeHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function motionId(prefix = 'motion'): string {
  if (typeof crypto.randomUUID === 'function') return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildWorkspaceRelativePath(storage: CreativeMotionStorageLike, absPath: string): string {
  const rel = path.relative(storage.workspacePath, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : absPath.replace(/\\/g, '/');
}

function resolveRemotionEntryPoint(): string {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'remotion', 'index.tsx'),
    path.resolve(process.cwd(), 'dist', 'remotion', 'index.js'),
    path.resolve(__dirname, '..', '..', 'remotion', 'index.js'),
    path.resolve(__dirname, '..', '..', '..', 'src', 'remotion', 'index.tsx'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!found) {
    throw new Error(`Could not find Remotion entry point. Checked: ${candidates.join(', ')}`);
  }
  return found;
}

async function getCreativeMotionServeUrl(storage: CreativeMotionStorageLike): Promise<string> {
  const entryPoint = resolveRemotionEntryPoint();
  const cacheKey = `${entryPoint}::${storage.creativeDir}`;
  const existing = remotionBundlePromises.get(cacheKey);
  if (existing) return existing;
  const outDir = path.join(storage.creativeDir, 'motion', 'bundle-cache');
  fs.mkdirSync(outDir, { recursive: true });
  const { bundle } = require('@remotion/bundler') as any;
  const promise = bundle({
    entryPoint,
    outDir,
    enableCaching: true,
    onProgress: () => undefined,
    ignoreRegisterRootWarning: false,
  });
  remotionBundlePromises.set(cacheKey, promise);
  try {
    return await promise;
  } catch (err) {
    remotionBundlePromises.delete(cacheKey);
    throw err;
  }
}

function buildCaptionPreviewHtml(input: CreativeMotionInput): string {
  const brand = input.brand;
  const background = brand?.colors.background || '#101828';
  const accent = brand?.colors.accent || '#ffcf33';
  const textColor = brand?.colors.text || '#ffffff';
  const title = input.text.title || 'Caption Reel';
  const firstCaption = input.captions?.segments?.[0]?.text || 'Caption text will animate here.';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #111827; }
    body { display: grid; place-items: center; font-family: Inter, Arial, sans-serif; }
    .frame {
      width: min(92vw, ${Math.round(input.width / 2)}px);
      aspect-ratio: ${input.width} / ${input.height};
      background: ${escapeHtml(background)};
      color: ${escapeHtml(textColor)};
      position: relative;
      overflow: hidden;
      box-shadow: 0 30px 90px rgba(0,0,0,.34);
    }
    .frame::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 18% 16%, ${escapeHtml(accent)}55, transparent 35%), linear-gradient(145deg, transparent, rgba(255,255,255,.12));
    }
    .content {
      position: absolute;
      left: 8%;
      right: 8%;
      top: 50%;
      transform: translateY(-50%);
    }
    .title {
      color: ${escapeHtml(accent)};
      font-weight: 800;
      font-size: clamp(20px, 4vw, 44px);
      margin-bottom: 18px;
    }
    .caption {
      font-weight: 900;
      line-height: 1.02;
      font-size: clamp(34px, 7vw, 82px);
      text-shadow: 0 18px 60px rgba(0,0,0,.35);
    }
    .bar {
      position: absolute;
      left: 8%;
      right: 8%;
      bottom: 6%;
      height: 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.2);
      overflow: hidden;
    }
    .bar span { display: block; width: 38%; height: 100%; background: ${escapeHtml(accent)}; }
  </style>
</head>
<body>
  <div class="frame">
    <div class="content">
      <div class="title">${escapeHtml(title)}</div>
      <div class="caption">${escapeHtml(firstCaption)}</div>
    </div>
    <div class="bar"><span></span></div>
  </div>
</body>
</html>`;
}

export function prepareCreativeMotionTemplate(raw: any = {}): {
  template: ReturnType<typeof getCreativeMotionTemplate>;
  input: CreativeMotionInput;
  validation: { ok: boolean; warnings: string[]; blockers: string[] };
  instance: CreativeMotionTemplateInstance;
} {
  const input = resolveCreativeMotionInput(raw);
  const template = getCreativeMotionTemplate(input.templateId);
  const validation = validateCreativeMotionInput(input);
  const instance = normalizeCreativeMotionTemplateInstance({
    id: raw.id || motionId('motion_template'),
    type: 'motionTemplate',
    templateId: input.templateId,
    presetId: input.presetId,
    socialFormat: input.socialFormat,
    startMs: raw.startMs,
    durationMs: input.durationMs,
    input,
    preview: raw.preview || null,
  });
  if (!instance) throw new Error('Could not normalize motion template instance.');
  return { template, input, validation, instance };
}

export function writeCreativeMotionPreview(storage: {
  workspacePath: string;
  rootAbsPath: string;
  rootRelPath: string;
  creativeDir: string;
}, input: CreativeMotionInput): CreativeMotionPreviewArtifact {
  const id = motionId('motion_preview');
  const dir = path.join(storage.creativeDir, 'motion', 'previews');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${id}.html`;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(absPath, buildCaptionPreviewHtml(input), 'utf-8');
  const stat = fs.statSync(absPath);
  return {
    id,
    filename,
    path: buildWorkspaceRelativePath(storage, absPath),
    absPath,
    mimeType: 'text/html; charset=utf-8',
    size: stat.size,
    renderer: 'html-fallback',
    width: input.width,
    height: input.height,
  };
}

export async function renderCreativeMotionStillPreview(storage: CreativeMotionStorageLike, input: CreativeMotionInput): Promise<CreativeMotionPreviewArtifact> {
  const template = getCreativeMotionTemplate(input.templateId);
  if (!template) throw new Error(`Unknown motion template "${input.templateId}".`);
  const id = motionId('motion_preview');
  const dir = path.join(storage.creativeDir, 'motion', 'previews');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${id}.png`;
  const absPath = path.join(dir, filename);
  const serveUrl = await getCreativeMotionServeUrl(storage);
  const { renderStill, selectComposition } = require('@remotion/renderer') as any;
  const composition = await selectComposition({
    serveUrl,
    id: template.compositionId,
    inputProps: input as unknown as Record<string, unknown>,
    logLevel: 'warn',
  });
  await renderStill({
    serveUrl,
    composition,
    inputProps: input as unknown as Record<string, unknown>,
    output: absPath,
    frame: 0,
    imageFormat: 'png',
    overwrite: true,
    logLevel: 'warn',
  });
  const stat = fs.statSync(absPath);
  return {
    id,
    filename,
    path: buildWorkspaceRelativePath(storage, absPath),
    absPath,
    mimeType: 'image/png',
    size: stat.size,
    renderer: 'remotion',
    width: composition.width,
    height: composition.height,
  };
}

export async function createCreativeMotionPreview(storage: CreativeMotionStorageLike, input: CreativeMotionInput): Promise<{
  preview: CreativeMotionPreviewArtifact;
  fallback: CreativeMotionPreviewArtifact | null;
  rendererError: string | null;
}> {
  try {
    const preview = await renderCreativeMotionStillPreview(storage, input);
    return { preview, fallback: null, rendererError: null };
  } catch (err: any) {
    const fallback = writeCreativeMotionPreview(storage, input);
    return {
      preview: fallback,
      fallback,
      rendererError: String(err?.message || err || 'Remotion preview render failed'),
    };
  }
}
