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
  IMAGE_SIZE_BY_ASPECT_RATIO,
  persistGeneratedImage,
  resolveReferenceImages,
  resolveSecretReference,
} from '../utils.js';

const API_MODEL = 'gpt-image-2';
const DEFAULT_MODEL = 'gpt-image-2-medium';
const MODEL_IDS = ['gpt-image-2-low', 'gpt-image-2-medium', 'gpt-image-2-high'] as const;

const MODEL_METADATA: Record<string, { quality: 'low' | 'medium' | 'high' }> = {
  'gpt-image-2-low': { quality: 'low' },
  'gpt-image-2-medium': { quality: 'medium' },
  'gpt-image-2-high': { quality: 'high' },
};

function coerceModelId(value?: string): string | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'gpt-image-2') return DEFAULT_MODEL;
  return MODEL_METADATA[raw] ? raw : undefined;
}

function getOpenAIProviderConfig(): Record<string, unknown> {
  const cfg = getConfig().getConfig() as any;
  return (cfg.llm?.providers?.openai && typeof cfg.llm.providers.openai === 'object')
    ? cfg.llm.providers.openai
    : {};
}

function getApiBase(): string {
  const configured = String(getOpenAIProviderConfig().endpoint || '').trim();
  return (configured || 'https://api.openai.com').replace(/\/+$/, '');
}

function getGenerationsEndpoint(): string {
  return `${getApiBase()}/v1/images/generations`;
}

function getEditsEndpoint(): string {
  return `${getApiBase()}/v1/images/edits`;
}

function getApiKey(): string | undefined {
  const providerCfg = getOpenAIProviderConfig();
  return resolveSecretReference(providerCfg.api_key) || process.env.OPENAI_API_KEY;
}

function resolveDefaultModel(): string {
  const imageCfg = getImageGenerationConfig();
  const providerCfg = imageCfg.providers.openai || {};
  return coerceModelId(String(providerCfg.model || imageCfg.model || process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL)) || DEFAULT_MODEL;
}

export class OpenAIImageGenerationProvider implements ImageGenerationProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';

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
    const size = IMAGE_SIZE_BY_ASPECT_RATIO[request.aspect_ratio];
    const meta = MODEL_METADATA[model] || MODEL_METADATA[DEFAULT_MODEL];
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
        error: 'OPENAI_API_KEY is not configured for OpenAI image generation.',
        errorType: 'auth_required',
      });
    }

    try {
      let response: Response;
      if (referenceImages.length) {
        const resolvedReferences = await resolveReferenceImages(referenceImages);
        const form = new FormData();
        form.set('model', API_MODEL);
        form.set('prompt', prompt);
        form.set('size', size);
        form.set('n', String(request.count));
        form.set('quality', meta.quality);

        for (const reference of resolvedReferences) {
          if (reference.bytes) {
            form.append(
              'image[]',
              new Blob([reference.bytes as any], { type: reference.mimeType }),
              reference.fileName,
            );
          } else {
            const downloaded = await fetchBinaryAsset(reference.imageUrl);
            form.append(
              'image[]',
              new Blob([downloaded.bytes as any], { type: downloaded.mimeType || reference.mimeType }),
              reference.fileName,
            );
          }
        }

        response = await fetch(getEditsEndpoint(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
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
          model: API_MODEL,
          prompt,
          size,
          n: request.count,
          quality: meta.quality,
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
          error: `OpenAI image generation failed: ${message}`,
          errorType: 'api_error',
        });
      }

      const data = Array.isArray(parsed?.data) ? parsed.data : [];
      const revisedPrompt = typeof data[0]?.revised_prompt === 'string' ? data[0].revised_prompt : null;
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
          error: 'OpenAI returned no image data.',
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
        revisedPrompt,
        quality: meta.quality,
        size,
      });
    } catch (error: any) {
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        error: `OpenAI image generation failed: ${String(error?.message || error)}`,
        errorType: 'api_error',
      });
    }
  }
}
