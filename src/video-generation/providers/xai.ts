import { getConfig } from '../../config/config.js';
import type {
  VideoGenerationProvider,
  VideoGenerationResolvedRequest,
  VideoGenerationResult,
} from '../types.js';
import {
  buildVideoGenerationError,
  buildVideoGenerationSuccess,
  fetchBinaryAsset,
  getVideoGenerationConfig,
  persistGeneratedVideo,
  resolveSecretReference,
  resolveVideoInput,
} from '../utils.js';

const DEFAULT_MODEL = 'grok-imagine-video';
const MODEL_IDS = ['grok-imagine-video'] as const;
const DEFAULT_ENDPOINT = 'https://api.x.ai/v1';

const XAI_ASPECT_RATIO_BY_PROMETHEUS: Record<string, string> = {
  landscape: '16:9',
  square: '1:1',
  portrait: '9:16',
};

function coerceModelId(value?: string): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  return MODEL_IDS.includes(raw as any) ? raw : undefined;
}

function getXAIProviderConfig(): Record<string, unknown> {
  const cfg = getConfig().getConfig() as any;
  return (cfg.llm?.providers?.xai && typeof cfg.llm.providers.xai === 'object')
    ? cfg.llm.providers.xai
    : {};
}

function getXAIVideoProviderConfig(): Record<string, unknown> {
  const videoCfg = getVideoGenerationConfig();
  return videoCfg.providers.xai || {};
}

function getApiBase(): string {
  const videoProviderCfg = getXAIVideoProviderConfig();
  const llmProviderCfg = getXAIProviderConfig();
  const configured = String(videoProviderCfg.endpoint || llmProviderCfg.endpoint || '').trim();
  return (configured || DEFAULT_ENDPOINT).replace(/\/+$/, '');
}

function getGenerationsEndpoint(): string {
  return `${getApiBase()}/videos/generations`;
}

function getEditsEndpoint(): string {
  return `${getApiBase()}/videos/edits`;
}

function getExtensionsEndpoint(): string {
  return `${getApiBase()}/videos/extensions`;
}

function getStatusEndpoint(requestId: string): string {
  return `${getApiBase()}/videos/${encodeURIComponent(requestId)}`;
}

function getApiKey(): string | undefined {
  const providerCfg = getXAIProviderConfig();
  return resolveSecretReference(providerCfg.api_key) || process.env.XAI_API_KEY;
}

function resolveDefaultModel(): string {
  const videoCfg = getVideoGenerationConfig();
  const providerCfg = getXAIVideoProviderConfig();
  return coerceModelId(String(providerCfg.model || videoCfg.model || process.env.XAI_VIDEO_MODEL || DEFAULT_MODEL)) || DEFAULT_MODEL;
}

function buildMediaObject(url: string): { url: string } {
  return { url };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class XAIVideoGenerationProvider implements VideoGenerationProvider {
  readonly id = 'xai';
  readonly displayName = 'xAI Grok Imagine Video';

  listModels(): readonly string[] {
    return MODEL_IDS;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(getApiKey());
  }

  resolveModel(requestedModel?: string): string {
    return coerceModelId(requestedModel) || resolveDefaultModel();
  }

  async generate(request: VideoGenerationResolvedRequest): Promise<VideoGenerationResult> {
    const prompt = String(request.prompt || '').trim();
    const model = this.resolveModel(request.model);
    const apiKey = getApiKey();
    const aspectRatio = XAI_ASPECT_RATIO_BY_PROMETHEUS[request.aspect_ratio] || '16:9';

    if (!prompt) {
      return buildVideoGenerationError({
        provider: this.id,
        model,
        prompt,
        mode: request.mode,
        aspectRatio: request.aspect_ratio,
        error: 'Prompt is required and must be a non-empty string.',
        errorType: 'invalid_argument',
      });
    }

    if (!apiKey) {
      return buildVideoGenerationError({
        provider: this.id,
        model,
        prompt,
        mode: request.mode,
        aspectRatio: request.aspect_ratio,
        error: 'XAI_API_KEY is not configured for Grok Imagine video generation.',
        errorType: 'auth_required',
      });
    }

    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      const body: Record<string, unknown> = {
        model,
        prompt,
      };
      let startEndpoint = getGenerationsEndpoint();

      if (request.mode === 'edit' || request.mode === 'extend') {
        if (!request.video) {
          return buildVideoGenerationError({
            provider: this.id,
            model,
            prompt,
            mode: request.mode,
            aspectRatio: request.aspect_ratio,
            error: `A source video is required for xAI video ${request.mode}.`,
            errorType: 'invalid_argument',
          });
        }
        const videoInput = await resolveVideoInput(request.video);
        body.video = buildMediaObject(videoInput.url);
        startEndpoint = request.mode === 'edit' ? getEditsEndpoint() : getExtensionsEndpoint();
        if (request.mode === 'extend') {
          body.duration = Math.max(2, Math.min(10, request.duration));
        }
      } else {
        body.duration = request.duration;
        body.aspect_ratio = aspectRatio;
        body.resolution = request.resolution;

        if (request.image) {
          const imageInput = await resolveVideoInput(request.image);
          body.image = buildMediaObject(imageInput.url);
        }

        if (request.reference_images.length) {
          if (request.image) {
            return buildVideoGenerationError({
              provider: this.id,
              model,
              prompt,
              mode: request.mode,
              aspectRatio: request.aspect_ratio,
              error: 'Use either image or reference_images for xAI video generation, not both.',
              errorType: 'invalid_argument',
            });
          }
          if (request.duration > 10) {
            return buildVideoGenerationError({
              provider: this.id,
              model,
              prompt,
              mode: request.mode,
              aspectRatio: request.aspect_ratio,
              error: 'xAI reference-to-video supports a maximum duration of 10 seconds.',
              errorType: 'invalid_argument',
            });
          }
          const references = [];
          for (const reference of request.reference_images) {
            const resolved = await resolveVideoInput(reference);
            references.push(buildMediaObject(resolved.url));
          }
          body.reference_images = references;
        }
      }

      const startResponse = await fetch(startEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const startText = await startResponse.text();
      const startParsed = startText ? JSON.parse(startText) : {};

      if (!startResponse.ok) {
        const message = String(startParsed?.error?.message || startText || startResponse.statusText || 'Video generation request failed').slice(0, 400);
        return buildVideoGenerationError({
          provider: this.id,
          model,
          prompt,
          mode: request.mode,
          aspectRatio: request.aspect_ratio,
          error: `xAI Grok Imagine video generation failed: ${message}`,
          errorType: startResponse.status === 401 ? 'auth_required' : 'api_error',
        });
      }

      const requestId = String(startParsed?.request_id || '').trim();
      if (!requestId) {
        return buildVideoGenerationError({
          provider: this.id,
          model,
          prompt,
          mode: request.mode,
          aspectRatio: request.aspect_ratio,
          error: 'xAI did not return a video request_id.',
          errorType: 'empty_response',
        });
      }

      const deadline = Date.now() + request.timeout_ms;
      let latestProgress = 0;

      while (Date.now() < deadline) {
        await sleep(request.poll_interval_ms);
        const statusResponse = await fetch(getStatusEndpoint(requestId), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(60_000),
        });
        const statusText = await statusResponse.text();
        const statusParsed = statusText ? JSON.parse(statusText) : {};
        if (!statusResponse.ok) {
          const message = String(statusParsed?.error?.message || statusText || statusResponse.statusText || 'Video polling failed').slice(0, 400);
          return buildVideoGenerationError({
            provider: this.id,
            model,
            prompt,
            mode: request.mode,
            aspectRatio: request.aspect_ratio,
            requestId,
            progress: latestProgress,
            error: `xAI Grok Imagine video polling failed: ${message}`,
            errorType: statusResponse.status === 401 ? 'auth_required' : 'api_error',
          });
        }

        latestProgress = Number.isFinite(Number(statusParsed?.progress)) ? Number(statusParsed.progress) : latestProgress;
        const status = String(statusParsed?.status || '').trim().toLowerCase();

        if (status === 'failed' || status === 'expired') {
          const message = String(statusParsed?.error?.message || statusParsed?.error || `Video request ${status}.`).slice(0, 400);
          return buildVideoGenerationError({
            provider: this.id,
            model,
            prompt,
            mode: request.mode,
            aspectRatio: request.aspect_ratio,
            requestId,
            progress: latestProgress,
            error: `xAI Grok Imagine video generation ${status}: ${message}`,
            errorType: status === 'expired' ? 'request_expired' : 'api_error',
          });
        }

        if (status === 'done') {
          const videoUrl = String(statusParsed?.video?.url || '').trim();
          if (!videoUrl) {
            return buildVideoGenerationError({
              provider: this.id,
              model,
              prompt,
              mode: request.mode,
              aspectRatio: request.aspect_ratio,
              requestId,
              progress: latestProgress,
              error: 'xAI completed the video request but returned no video URL.',
              errorType: 'empty_response',
            });
          }

          const downloaded = await fetchBinaryAsset(videoUrl);
          const video = await persistGeneratedVideo({
            bytes: downloaded.bytes,
            mimeType: downloaded.mimeType || 'video/mp4',
            provider: this.id,
            prompt,
            outputDir: request.output_dir,
            saveToWorkspace: request.save_to_workspace,
            sourceUrl: videoUrl,
          });

          return buildVideoGenerationSuccess({
            provider: this.id,
            model,
            prompt,
            mode: request.mode,
            aspectRatio: request.aspect_ratio,
            duration: Number(statusParsed?.video?.duration || request.duration),
            resolution: request.resolution,
            requestId,
            video,
            videoUrl,
            respectModeration: typeof statusParsed?.video?.respect_moderation === 'boolean'
              ? statusParsed.video.respect_moderation
              : null,
            progress: latestProgress || 100,
          });
        }
      }

      return buildVideoGenerationError({
        provider: this.id,
        model,
        prompt,
        mode: request.mode,
        aspectRatio: request.aspect_ratio,
        requestId,
        progress: latestProgress,
        error: `xAI Grok Imagine video generation timed out after ${Math.round(request.timeout_ms / 1000)} seconds.`,
        errorType: 'timeout',
      });
    } catch (error: any) {
      return buildVideoGenerationError({
        provider: this.id,
        model,
        prompt,
        mode: request.mode,
        aspectRatio: request.aspect_ratio,
        error: `xAI Grok Imagine video generation failed: ${String(error?.message || error)}`,
        errorType: 'api_error',
      });
    }
  }
}
