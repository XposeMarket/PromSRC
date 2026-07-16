import path from 'path';
import type { GeneratedImageAsset } from '../image-generation/types.js';

export const GENERATED_IMAGE_CACHE_PREVIEW_ROUTE = '/api/canvas/generated-image-preview';

function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanPath(value: unknown): string {
  return cleanString(value).replace(/\\/g, '/');
}

export function generatedImagePreviewIdentity(image: Partial<GeneratedImageAsset> & Record<string, any>): string {
  const generationId = cleanString(image?.generation_id || image?.generationId);
  if (generationId) return `generation:${generationId}`;
  const parentGenerationId = cleanString(image?.parent_generation_id || image?.parentGenerationId);
  const partialIndex = cleanString(image?.partial_index ?? image?.partialIndex);
  if (parentGenerationId && partialIndex) return `generation:${parentGenerationId}:partial:${partialIndex}`;
  const relPath = cleanPath(image?.rel_path || image?.relPath || image?.workspacePath);
  if (relPath) return `workspace:${relPath}`;
  const cacheFile = generatedImageCacheFileName(image);
  if (cacheFile) return `cache:${cacheFile}`;
  return '';
}

export function generatedImageCacheFileName(image: Partial<GeneratedImageAsset> & Record<string, any>): string {
  const raw = cleanString(image?.cache_path || image?.cachePath || (!image?.rel_path ? image?.path : ''));
  if (!raw) return '';
  const base = path.basename(raw);
  if (!base || base === '.' || base === '..') return '';
  return base;
}

export function buildGeneratedImagePreviewUrl(image: Partial<GeneratedImageAsset> & Record<string, any>): string {
  const workspacePath = cleanPath(image?.rel_path || image?.relPath || image?.workspacePath);
  if (workspacePath) return `/api/canvas/inline?path=${encodeURIComponent(workspacePath)}`;
  const cacheFile = generatedImageCacheFileName(image);
  if (cacheFile) return `${GENERATED_IMAGE_CACHE_PREVIEW_ROUTE}?cache=${encodeURIComponent(cacheFile)}`;
  return '';
}

export function buildGeneratedImagePreviewPayload(image: Partial<GeneratedImageAsset> & Record<string, any>): Record<string, any> | undefined {
  const dataUrl = buildGeneratedImagePreviewUrl(image);
  if (!dataUrl) return undefined;
  const workspacePath = cleanPath(image?.rel_path || image?.relPath || image?.workspacePath);
  const cacheFile = generatedImageCacheFileName(image);
  const generationId = cleanString(image?.generation_id || image?.generationId) || undefined;
  const previewId = generatedImagePreviewIdentity(image);
  return {
    dataUrl,
    workspacePath: workspacePath || undefined,
    cacheKey: workspacePath ? undefined : cacheFile || undefined,
    mimeType: cleanString(image?.mime_type || image?.mimeType || 'image/png') || 'image/png',
    width: Number(image?.width || image?.width_actual || 0) || undefined,
    height: Number(image?.height || image?.height_actual || 0) || undefined,
    title: cleanString(image?.file_name || image?.fileName || (image?.partial ? 'Generated image partial' : 'Generated image')),
    artifactKind: image?.partial ? 'generated_image_partial' : 'generated_image',
    status: image?.partial ? 'partial' : 'final',
    provider: image?.provider,
    model: image?.model,
    generationId,
    previewId: previewId || undefined,
    partialIndex: image?.partial_index ?? image?.partialIndex ?? undefined,
  };
}

export function buildGeneratedImageVisionEvent(input: {
  image: Partial<GeneratedImageAsset> & Record<string, any>;
  tool: string;
  label?: string;
}): Record<string, any> | undefined {
  const preview = buildGeneratedImagePreviewPayload(input.image);
  if (!preview) return undefined;
  const isPartial = preview.status === 'partial';
  return {
    source: 'generated_image',
    tool: input.tool,
    label: input.label || (isPartial ? 'Generated image partial' : 'Generated image'),
    previewTitle: preview.title || (isPartial ? 'Generated image partial' : 'Generated image'),
    preview,
    injected: true,
  };
}
