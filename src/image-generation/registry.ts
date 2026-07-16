import { getConfig } from '../config/config.js';
import { OpenAIImageGenerationProvider } from './providers/openai.js';
import { OpenAICodexImageGenerationProvider } from './providers/openai-codex.js';
import { XAIImageGenerationProvider } from './providers/xai.js';
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from './types.js';
import {
  buildImageGenerationRunOutputDir,
  buildImageGenerationError,
  getImageGenerationConfig,
  normalizeImageAspectRatio,
  normalizeImageBackground,
  normalizeImageCount,
  normalizeImageOutputFormat,
  normalizeImageOutputCompression,
  normalizeImagePresentationMode,
  normalizeImageQuality,
  normalizeImageSize,
  normalizeReferenceImages,
  validateMaskImage,
} from './utils.js';

const PROVIDERS: ImageGenerationProvider[] = [
  new OpenAIImageGenerationProvider(),
  new OpenAICodexImageGenerationProvider(),
  new XAIImageGenerationProvider(),
];

const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

function normalizeProviderId(value?: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'auto' ? '' : normalized;
}

function inferProviderIdsFromModel(model?: string): string[] {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return [];
  if (
    normalized.startsWith('grok-')
    || normalized.includes('grok-imagine')
    || normalized.includes('grok-image')
  ) {
    return ['xai'];
  }
  if (normalized.startsWith('gpt-image-')) return ['openai', 'openai_codex'];
  return [];
}

function compatibleProviderIds(providerId?: string): string[] {
  const normalized = normalizeProviderId(providerId);
  if (!normalized) return [];
  if (normalized === 'openai') return ['openai', 'openai_codex'];
  if (normalized === 'openai_codex') return ['openai_codex', 'openai'];
  return [normalized];
}

function buildAutoCandidateIds(explicitProvider?: string): string[] {
  const imageCfg = getImageGenerationConfig();
  const llmProvider = String((getConfig().getConfig() as any)?.llm?.provider || '').trim().toLowerCase();
  const ordered = [
    ...compatibleProviderIds(explicitProvider),
    ...compatibleProviderIds(imageCfg.provider),
    ...inferProviderIdsFromModel(imageCfg.model),
    llmProvider === 'openai' || llmProvider === 'openai_codex' || llmProvider === 'xai' ? llmProvider : '',
    'openai_codex',
    'openai',
    'xai',
  ].filter(Boolean);

  return Array.from(new Set(ordered));
}

function providerSupportsRequest(provider: ImageGenerationProvider, request: {
  background: string;
  outputFormat: string;
  referenceImages: string[];
  mask?: string;
  partialImages: number;
  exactSizeRequested: boolean;
}): string | null {
  const caps = provider.capabilities;
  if (request.background === 'transparent' && !caps.transparency) return `${provider.id} does not support transparent-background output.`;
  if (!caps.outputFormats.includes(request.outputFormat as any)) return `${provider.id} does not support ${request.outputFormat} output.`;
  if (request.referenceImages.length && !caps.referenceImages) return `${provider.id} does not support reference image inputs.`;
  if (request.referenceImages.length > caps.maxReferenceImages) return `${provider.id} supports at most ${caps.maxReferenceImages} reference image(s).`;
  if (request.mask && !caps.maskEditing) return `${provider.id} does not support selection/mask editing.`;
  if (request.partialImages > 0 && !caps.partialStreaming) return `${provider.id} does not support partial image streaming.`;
  if (request.exactSizeRequested && !caps.exactSizes) return `${provider.id} does not support exact width/height image sizes.`;
  return null;
}

export function listImageGenerationProviders(): ImageGenerationProvider[] {
  return [...PROVIDERS];
}

export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const prompt = String(request.prompt || '').trim();
  const aspectRatio = normalizeImageAspectRatio(request.aspect_ratio);
  const count = normalizeImageCount(request.count);
  const referenceImages = normalizeReferenceImages(request.reference_images);
  const background = normalizeImageBackground(request.background, prompt);
  const outputFormat = normalizeImageOutputFormat(request.output_format, background);
  const outputCompression = normalizeImageOutputCompression(request.output_compression, outputFormat);
  const quality = normalizeImageQuality(request.quality);
  const presentationMode = normalizeImagePresentationMode(request.presentation_mode);
  const partialImagesRaw = request.partial_images === true ? 1 : Math.floor(Number(request.partial_images));
  const partialImages = Math.max(0, Math.min(3, Number.isFinite(partialImagesRaw) ? partialImagesRaw : (presentationMode === 'background' ? 1 : 0)));
  const stream = request.stream === true || partialImages > 0;
  const exactSizeRequested = request.size != null || request.width != null || request.height != null;
  const imageCfg = getImageGenerationConfig();
  const saveToWorkspace = request.save_to_workspace ?? imageCfg.save_to_workspace;
  const outputDir = request.output_dir || imageCfg.default_output_dir;
  const requestedProviderId = normalizeProviderId(request.provider);
  const requestedProviderIds = requestedProviderId
    ? compatibleProviderIds(requestedProviderId)
    : inferProviderIdsFromModel(request.model);

  let sizeInfo: { size: string; width?: number; height?: number };
  try {
    sizeInfo = normalizeImageSize({ size: request.size, width: request.width, height: request.height, aspectRatio });
    if (request.mask && !referenceImages.length) throw new Error('Mask editing requires at least one reference image edit target.');
    if (request.mask) await validateMaskImage(String(request.mask), referenceImages[0]);
  } catch (error: any) {
    return buildImageGenerationError({
      provider: requestedProviderIds[0] || 'image_generation',
      model: request.model,
      prompt,
      aspectRatio,
      background,
      outputFormat,
      presentationMode,
      error: String(error?.message || error),
      errorType: 'invalid_argument',
    });
  }

  if (!prompt) {
    return buildImageGenerationError({
      provider: requestedProviderIds[0] || 'image_generation',
      model: request.model,
      prompt,
      aspectRatio,
      background,
      outputFormat,
      presentationMode,
      error: 'Prompt is required and must be a non-empty string.',
      errorType: 'invalid_argument',
    });
  }

  if (requestedProviderIds.length) {
    let sawKnownProvider = false;
    for (const candidateId of requestedProviderIds) {
      const provider = PROVIDERS_BY_ID.get(candidateId);
      if (!provider) continue;
      sawKnownProvider = true;
      const incompatibility = providerSupportsRequest(provider, { background, outputFormat, referenceImages, mask: request.mask, partialImages, exactSizeRequested });
      if (incompatibility) {
        return buildImageGenerationError({
          provider: provider.id,
          model: request.model,
          prompt,
          aspectRatio,
          background,
          outputFormat,
          presentationMode,
          error: incompatibility,
          errorType: 'unsupported_capability',
        });
      }
      if (await provider.isAvailable()) {
        const outputRunDir = buildImageGenerationRunOutputDir({ outputDir, provider: provider.id, prompt });
        return provider.generate({
          prompt,
          aspect_ratio: aspectRatio,
          reference_images: referenceImages,
          count,
          model: request.model,
          background,
          output_format: outputFormat,
          output_compression: outputCompression,
          quality,
          size: sizeInfo.size,
          width: sizeInfo.width,
          height: sizeInfo.height,
          mask: request.mask ? String(request.mask) : undefined,
          presentation_mode: presentationMode,
          partial_images: partialImages,
          stream,
          output_dir: outputDir,
          output_run_dir: outputRunDir,
          save_to_workspace: saveToWorkspace,
          on_image_persisted: request.on_image_persisted,
          on_partial_image: request.on_partial_image,
        });
      }
    }
    const primaryProviderId = requestedProviderIds[0];
    return buildImageGenerationError({
      provider: primaryProviderId,
      model: request.model,
      prompt,
      aspectRatio,
      background,
      outputFormat,
      presentationMode,
      error: sawKnownProvider
        ? `Image generation provider "${primaryProviderId}" is not available.`
        : `Unknown image generation provider "${primaryProviderId}".`,
      errorType: sawKnownProvider ? 'provider_unavailable' : 'invalid_provider',
    });
  }

  for (const candidateId of buildAutoCandidateIds(request.provider)) {
    const provider = PROVIDERS_BY_ID.get(candidateId);
    if (!provider) continue;
    if (providerSupportsRequest(provider, { background, outputFormat, referenceImages, mask: request.mask, partialImages, exactSizeRequested })) continue;
    if (await provider.isAvailable()) {
      const outputRunDir = buildImageGenerationRunOutputDir({ outputDir, provider: provider.id, prompt });
      return provider.generate({
        prompt,
        aspect_ratio: aspectRatio,
        reference_images: referenceImages,
        count,
        model: request.model,
        background,
        output_format: outputFormat,
        output_compression: outputCompression,
        quality,
        size: sizeInfo.size,
        width: sizeInfo.width,
        height: sizeInfo.height,
        mask: request.mask ? String(request.mask) : undefined,
        presentation_mode: presentationMode,
        partial_images: partialImages,
        stream,
        output_dir: outputDir,
        output_run_dir: outputRunDir,
        save_to_workspace: saveToWorkspace,
        on_image_persisted: request.on_image_persisted,
        on_partial_image: request.on_partial_image,
      });
    }
  }

  return buildImageGenerationError({
    provider: 'image_generation',
    model: request.model,
    prompt,
    aspectRatio,
    background,
    outputFormat,
    presentationMode,
    error: 'No image generation provider is available. Configure xAI/OpenAI API access or connect OpenAI Codex OAuth.',
    errorType: 'provider_unavailable',
  });
}
