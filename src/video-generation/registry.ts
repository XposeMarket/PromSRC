import { getConfig } from '../config/config.js';
import { XAIVideoGenerationProvider } from './providers/xai.js';
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
} from './types.js';
import {
  buildVideoGenerationError,
  getVideoGenerationConfig,
  normalizePollIntervalMs,
  normalizeTimeoutMs,
  normalizeVideoAspectRatio,
  normalizeVideoDuration,
  normalizeVideoMode,
  normalizeVideoReferences,
  normalizeVideoResolution,
} from './utils.js';

const PROVIDERS: VideoGenerationProvider[] = [
  new XAIVideoGenerationProvider(),
];

const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

function normalizeProviderId(value?: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'auto' ? '' : normalized;
}

function buildAutoCandidateIds(explicitProvider?: string): string[] {
  const videoCfg = getVideoGenerationConfig();
  const llmProvider = String((getConfig().getConfig() as any)?.llm?.provider || '').trim().toLowerCase();
  const ordered = [
    normalizeProviderId(explicitProvider),
    normalizeProviderId(videoCfg.provider),
    llmProvider === 'xai' ? llmProvider : '',
    'xai',
  ].filter(Boolean);

  return Array.from(new Set(ordered));
}

export function listVideoGenerationProviders(): VideoGenerationProvider[] {
  return [...PROVIDERS];
}

export async function generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const prompt = String(request.prompt || '').trim();
  const aspectRatio = normalizeVideoAspectRatio(request.aspect_ratio);
  const mode = normalizeVideoMode(request.mode || (request.video ? 'edit' : 'generate'));
  const videoCfg = getVideoGenerationConfig();
  const saveToWorkspace = request.save_to_workspace ?? videoCfg.save_to_workspace;
  const outputDir = request.output_dir || videoCfg.default_output_dir;
  const requestedProviderId = normalizeProviderId(request.provider);
  const duration = normalizeVideoDuration(request.duration ?? videoCfg.duration);
  const resolution = normalizeVideoResolution(request.resolution || videoCfg.resolution);
  const referenceImages = normalizeVideoReferences(request.reference_images);
  const pollIntervalMs = normalizePollIntervalMs(request.poll_interval_ms);
  const timeoutMs = normalizeTimeoutMs(request.timeout_ms);

  if (!prompt) {
    return buildVideoGenerationError({
      provider: requestedProviderId || 'video_generation',
      model: request.model,
      prompt,
      mode,
      aspectRatio,
      error: 'Prompt is required and must be a non-empty string.',
      errorType: 'invalid_argument',
    });
  }

  if (requestedProviderId) {
    const provider = PROVIDERS_BY_ID.get(requestedProviderId);
    if (!provider) {
      return buildVideoGenerationError({
        provider: requestedProviderId,
        model: request.model,
        prompt,
        mode,
        aspectRatio,
        error: `Unknown video generation provider "${requestedProviderId}".`,
        errorType: 'invalid_provider',
      });
    }
    if (!(await provider.isAvailable())) {
      return buildVideoGenerationError({
        provider: requestedProviderId,
        model: provider.resolveModel(request.model),
        prompt,
        mode,
        aspectRatio,
        error: `Video generation provider "${requestedProviderId}" is not available.`,
        errorType: 'provider_unavailable',
      });
    }
    return provider.generate({
      prompt,
      image: request.image,
      reference_images: referenceImages,
      video: request.video,
      mode,
      aspect_ratio: aspectRatio,
      duration,
      resolution,
      model: request.model,
      output_dir: outputDir,
      save_to_workspace: saveToWorkspace,
      poll_interval_ms: pollIntervalMs,
      timeout_ms: timeoutMs,
    });
  }

  for (const candidateId of buildAutoCandidateIds(request.provider)) {
    const provider = PROVIDERS_BY_ID.get(candidateId);
    if (!provider) continue;
    if (await provider.isAvailable()) {
      return provider.generate({
        prompt,
        image: request.image,
        reference_images: referenceImages,
        video: request.video,
        mode,
        aspect_ratio: aspectRatio,
        duration,
        resolution,
        model: request.model,
        output_dir: outputDir,
        save_to_workspace: saveToWorkspace,
        poll_interval_ms: pollIntervalMs,
        timeout_ms: timeoutMs,
      });
    }
  }

  return buildVideoGenerationError({
    provider: 'video_generation',
    model: request.model,
    prompt,
    mode,
    aspectRatio,
    error: 'No video generation provider is available. Configure xAI API access.',
    errorType: 'provider_unavailable',
  });
}
