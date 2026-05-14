import { getConfig } from '../../config/config.js';
import type {
  ImageGenerationProvider,
  ImageGenerationResolvedRequest,
  ImageGenerationResult,
} from '../types.js';
import {
  buildImageGenerationError,
  buildImageGenerationSuccess,
  fetchBinaryAsset,
  getImageGenerationConfig,
  persistGeneratedImage,
  resolveReferenceImages,
  resolveSecretReference,
} from '../utils.js';

const DEFAULT_MODEL = 'grok-imagine-image-quality';
const MODEL_IDS = [
  'grok-imagine-image-quality',
  'grok-imagine-image-quality-latest',
  'grok-imagine-image',
  'grok-imagine-image-pro',
] as const;
const DEFAULT_ENDPOINT = 'https://api.x.ai/v1';
const MAX_XAI_REFERENCE_IMAGES = 3;

const XAI_ASPECT_RATIO_BY_PROMETHEUS: Record<string, string> = {
  landscape: '16:9',
  square: '1:1',
  portrait: '9:16',
};

const MODEL_ALIASES: Record<string, string> = {
  'grok-image-image-quality': 'grok-imagine-image-quality',
  'grok-image-quality': 'grok-imagine-image-quality',
  'grok-imagine-quality': 'grok-imagine-image-quality',
  'grok-image': 'grok-imagine-image',
};

function coerceModelId(value?: string): string | undefined {
  const rawInput = String(value || '').trim();
  const raw = MODEL_ALIASES[rawInput.toLowerCase()] || rawInput;
  if (!raw) return undefined;
  return MODEL_IDS.includes(raw as any) ? raw : undefined;
}

function getXAIProviderConfig(): Record<string, unknown> {
  const cfg = getConfig().getConfig() as any;
  return (cfg.llm?.providers?.xai && typeof cfg.llm.providers.xai === 'object')
    ? cfg.llm.providers.xai
    : {};
}

function getXAIImageProviderConfig(): Record<string, unknown> {
  const imageCfg = getImageGenerationConfig();
  return imageCfg.providers.xai || {};
}

function getApiBase(): string {
  const imageProviderCfg = getXAIImageProviderConfig();
  const llmProviderCfg = getXAIProviderConfig();
  const configured = String(imageProviderCfg.endpoint || llmProviderCfg.endpoint || '').trim();
  return (configured || DEFAULT_ENDPOINT).replace(/\/+$/, '');
}

function getGenerationsEndpoint(): string {
  return `${getApiBase()}/images/generations`;
}

function getEditsEndpoint(): string {
  return `${getApiBase()}/images/edits`;
}

function getApiKey(): string | undefined {
  const providerCfg = getXAIProviderConfig();
  return resolveSecretReference(providerCfg.api_key) || process.env.XAI_API_KEY;
}

function resolveDefaultModel(): string {
  const imageCfg = getImageGenerationConfig();
  const providerCfg = getXAIImageProviderConfig();
  return coerceModelId(String(providerCfg.model || imageCfg.model || process.env.XAI_IMAGE_MODEL || DEFAULT_MODEL)) || DEFAULT_MODEL;
}

function getResolution(): string {
  const providerCfg = getXAIImageProviderConfig();
  const raw = String(providerCfg.resolution || process.env.XAI_IMAGE_RESOLUTION || '1k').trim().toLowerCase();
  return raw === '2k' ? '2k' : '1k';
}

function buildImageInput(reference: { imageUrl: string }): { type: 'image_url'; url: string } {
  return {
    type: 'image_url',
    url: reference.imageUrl,
  };
}

export class XAIImageGenerationProvider implements ImageGenerationProvider {
  readonly id = 'xai';
  readonly displayName = 'xAI Grok Imagine';

  listModels(): readonly string[] {
    return MODEL_IDS;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(getApiKey());
  }

  resolveModel(requestedModel?: string): string {
    return coerceModelId(requestedModel) || resolveDefaultModel();
  }

  async generate(request: ImageGenerationResolvedRequest): Promise<ImageGenerationResult> {
    const prompt = String(request.prompt || '').trim();
    const model = this.resolveModel(request.model);
    const aspectRatio = XAI_ASPECT_RATIO_BY_PROMETHEUS[request.aspect_ratio] || '16:9';
    const resolution = getResolution();
    const apiKey = getApiKey();
    const referenceImages = request.reference_images || [];

    if (!prompt) {
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        error: 'Prompt is required and must be a non-empty string.',
        errorType: 'invalid_argument',
      });
    }

    if (!apiKey) {
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        error: 'XAI_API_KEY is not configured for Grok Imagine image generation.',
        errorType: 'auth_required',
      });
    }

    if (referenceImages.length > MAX_XAI_REFERENCE_IMAGES) {
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        error: `xAI image editing supports up to ${MAX_XAI_REFERENCE_IMAGES} reference images per request.`,
        errorType: 'invalid_argument',
      });
    }

    try {
      let response: Response;
      if (referenceImages.length) {
        const resolvedReferences = await resolveReferenceImages(referenceImages);
        const body: Record<string, unknown> = {
          model,
          prompt,
          response_format: 'b64_json',
        };

        if (resolvedReferences.length === 1) {
          body.image = buildImageInput(resolvedReferences[0]);
        } else {
          body.images = resolvedReferences.map(buildImageInput);
          body.aspect_ratio = aspectRatio;
        }

        response = await fetch(getEditsEndpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5 * 60 * 1000),
        });
      } else {
        response = await fetch(getGenerationsEndpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            prompt,
            n: request.count,
            response_format: 'b64_json',
            aspect_ratio: aspectRatio,
            resolution,
          }),
          signal: AbortSignal.timeout(5 * 60 * 1000),
        });
      }

      const rawText = await response.text();
      const parsed = rawText ? JSON.parse(rawText) : {};
      if (!response.ok) {
        const message = String(parsed?.error?.message || rawText || response.statusText || 'Image generation request failed').slice(0, 400);
        return buildImageGenerationError({
          provider: this.id,
          model,
          prompt,
          aspectRatio: request.aspect_ratio,
          error: `xAI Grok Imagine image generation failed: ${message}`,
          errorType: response.status === 401 ? 'auth_required' : 'api_error',
        });
      }

      const data = Array.isArray(parsed?.data) ? parsed.data : [];
      const images = [];

      for (const item of data) {
        let imageBytes: Buffer | null = null;
        let mimeType = 'image/png';

        if (typeof item?.b64_json === 'string' && item.b64_json) {
          imageBytes = Buffer.from(item.b64_json, 'base64');
        } else if (typeof item?.url === 'string' && item.url) {
          const downloaded = await fetchBinaryAsset(item.url);
          imageBytes = downloaded.bytes;
          mimeType = downloaded.mimeType || mimeType;
        }

        if (!imageBytes || imageBytes.length === 0) continue;
        images.push(await persistGeneratedImage({
          bytes: imageBytes,
          mimeType,
          provider: this.id,
          prompt,
          outputDir: request.output_dir,
          saveToWorkspace: request.save_to_workspace,
        }));
      }

      if (!images.length) {
        return buildImageGenerationError({
          provider: this.id,
          model,
          prompt,
          aspectRatio: request.aspect_ratio,
          error: 'xAI returned no image data.',
          errorType: 'empty_response',
        });
      }

      return buildImageGenerationSuccess({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        image: images[0],
        images,
        size: `${aspectRatio}/${resolution}`,
      });
    } catch (error: any) {
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        error: `xAI Grok Imagine image generation failed: ${String(error?.message || error)}`,
        errorType: 'api_error',
      });
    }
  }
}
