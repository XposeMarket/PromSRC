import { getConfig } from '../config/config.js';
import { OpenAIImageGenerationProvider } from './providers/openai.js';
import { OpenAICodexImageGenerationProvider } from './providers/openai-codex.js';
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
];

const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

function normalizeProviderId(value?: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'auto' ? '' : normalized;
}

function buildAutoCandidateIds(explicitProvider?: string): string[] {
  const imageCfg = getImageGenerationConfig();
  const llmProvider = String((getConfig().getConfig() as any)?.llm?.provider || '').trim().toLowerCase();
  const ordered = [
    normalizeProviderId(explicitProvider),
    normalizeProviderId(imageCfg.provider),
    llmProvider === 'openai' || llmProvider === 'openai_codex' ? llmProvider : '',
    'openai_codex',
    'openai',
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

  if (!prompt) {
    return buildImageGenerationError({
      provider: requestedProviderId || 'image_generation',
      model: request.model,
      prompt,
      aspectRatio,
      error: 'Prompt is required and must be a non-empty string.',
      errorType: 'invalid_argument',
    });
  }

  if (requestedProviderId) {
    const provider = PROVIDERS_BY_ID.get(requestedProviderId);
    if (!provider) {
      return buildImageGenerationError({
        provider: requestedProviderId,
        model: request.model,
        prompt,
        aspectRatio,
        error: `Unknown image generation provider "${requestedProviderId}".`,
        errorType: 'invalid_provider',
      });
    }
    if (!(await provider.isAvailable())) {
      return buildImageGenerationError({
        provider: requestedProviderId,
        model: provider.resolveModel(request.model),
        prompt,
        aspectRatio,
        error: `Image generation provider "${requestedProviderId}" is not available.`,
        errorType: 'provider_unavailable',
      });
    }
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
    error: 'No image generation provider is available. Configure OpenAI API access or connect OpenAI Codex OAuth.',
    errorType: 'provider_unavailable',
  });
}
