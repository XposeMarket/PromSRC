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
  buildImageGenerationError,
  getImageGenerationConfig,
  normalizeImageAspectRatio,
  normalizeImageCount,
  normalizeReferenceImages,
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

export function listImageGenerationProviders(): ImageGenerationProvider[] {
  return [...PROVIDERS];
}

export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const prompt = String(request.prompt || '').trim();
  const aspectRatio = normalizeImageAspectRatio(request.aspect_ratio);
  const count = normalizeImageCount(request.count);
  const referenceImages = normalizeReferenceImages(request.reference_images);
  const imageCfg = getImageGenerationConfig();
  const saveToWorkspace = request.save_to_workspace ?? imageCfg.save_to_workspace;
  const outputDir = request.output_dir || imageCfg.default_output_dir;
  const requestedProviderId = normalizeProviderId(request.provider);
  const requestedProviderIds = requestedProviderId
    ? compatibleProviderIds(requestedProviderId)
    : inferProviderIdsFromModel(request.model);

  if (!prompt) {
    return buildImageGenerationError({
      provider: requestedProviderIds[0] || 'image_generation',
      model: request.model,
      prompt,
      aspectRatio,
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
      if (await provider.isAvailable()) {
        return provider.generate({
          prompt,
          aspect_ratio: aspectRatio,
          reference_images: referenceImages,
          count,
          model: request.model,
          output_dir: outputDir,
          save_to_workspace: saveToWorkspace,
        });
      }
    }
    const primaryProviderId = requestedProviderIds[0];
    return buildImageGenerationError({
      provider: primaryProviderId,
      model: request.model,
      prompt,
      aspectRatio,
      error: sawKnownProvider
        ? `Image generation provider "${primaryProviderId}" is not available.`
        : `Unknown image generation provider "${primaryProviderId}".`,
      errorType: sawKnownProvider ? 'provider_unavailable' : 'invalid_provider',
    });
  }

  for (const candidateId of buildAutoCandidateIds(request.provider)) {
    const provider = PROVIDERS_BY_ID.get(candidateId);
    if (!provider) continue;
    if (await provider.isAvailable()) {
      return provider.generate({
        prompt,
        aspect_ratio: aspectRatio,
        reference_images: referenceImages,
        count,
        model: request.model,
        output_dir: outputDir,
        save_to_workspace: saveToWorkspace,
      });
    }
  }

  return buildImageGenerationError({
    provider: 'image_generation',
    model: request.model,
    prompt,
    aspectRatio,
    error: 'No image generation provider is available. Configure xAI/OpenAI API access or connect OpenAI Codex OAuth.',
    errorType: 'provider_unavailable',
  });
}
