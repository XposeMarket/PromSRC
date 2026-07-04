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
  mimeTypeForImageOutputFormat,
  persistGeneratedImage,
  resolveReferenceImages,
  resolveSecretReference,
} from '../utils.js';

const DEFAULT_MODEL = 'gpt-image-2-medium';
const DEFAULT_API_MODEL = 'gpt-image-2';
const TRANSPARENT_API_MODEL = 'gpt-image-1.5';
const MODEL_IDS = [
  'gpt-image-2-low',
  'gpt-image-2-medium',
  'gpt-image-2-high',
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
] as const;

const MODEL_METADATA: Record<string, { apiModel: string; quality?: 'low' | 'medium' | 'high' }> = {
  'gpt-image-2-low': { apiModel: DEFAULT_API_MODEL, quality: 'low' },
  'gpt-image-2-medium': { apiModel: DEFAULT_API_MODEL, quality: 'medium' },
  'gpt-image-2-high': { apiModel: DEFAULT_API_MODEL, quality: 'high' },
  'gpt-image-2': { apiModel: DEFAULT_API_MODEL },
  'gpt-image-1.5': { apiModel: 'gpt-image-1.5' },
  'gpt-image-1': { apiModel: 'gpt-image-1' },
  'gpt-image-1-mini': { apiModel: 'gpt-image-1-mini' },
};

function coerceModelId(value?: string): string | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  return MODEL_METADATA[raw] ? raw : undefined;
}

function resolveApiModelForRequest(model: string, requestedModel: string | undefined, background: string): { model: string; apiModel: string; explicitUnsupportedTransparent: boolean } {
  const meta = MODEL_METADATA[model] || MODEL_METADATA[DEFAULT_MODEL];
  const explicitRequested = Boolean(String(requestedModel || '').trim());
  if (background === 'transparent' && String(meta.apiModel).startsWith('gpt-image-2')) {
    if (explicitRequested) {
      return { model, apiModel: meta.apiModel, explicitUnsupportedTransparent: true };
    }
    return { model: TRANSPARENT_API_MODEL, apiModel: TRANSPARENT_API_MODEL, explicitUnsupportedTransparent: false };
  }
  return { model, apiModel: meta.apiModel, explicitUnsupportedTransparent: false };
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
    let model = this.resolveModel(request.model);
    const size = IMAGE_SIZE_BY_ASPECT_RATIO[request.aspect_ratio];
    const resolved = resolveApiModelForRequest(model, request.model, request.background);
    model = resolved.model;
    const meta = MODEL_METADATA[model] || { apiModel: resolved.apiModel };
    const quality = request.quality || meta.quality || 'medium';
    const mimeType = mimeTypeForImageOutputFormat(request.output_format);
    const apiKey = getApiKey();
    const referenceImages = request.reference_images || [];

    if (!prompt) {
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        background: request.background,
        outputFormat: request.output_format,
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
        background: request.background,
        outputFormat: request.output_format,
        error: 'OPENAI_API_KEY is not configured for OpenAI image generation.',
        errorType: 'auth_required',
      });
    }

    if (resolved.explicitUnsupportedTransparent) {
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        background: request.background,
        outputFormat: request.output_format,
        error: `${resolved.apiModel} does not support transparent backgrounds. Use background="opaque"/"auto" with ${resolved.apiModel}, or omit the model so Prometheus can use ${TRANSPARENT_API_MODEL} for true alpha output.`,
        errorType: 'unsupported_background',
      });
    }

    try {
      let response: Response;
      if (referenceImages.length) {
        const resolvedReferences = await resolveReferenceImages(referenceImages);
        const form = new FormData();
        form.set('model', resolved.apiModel);
        form.set('prompt', prompt);
        form.set('size', size);
        form.set('n', String(request.count));
        form.set('quality', quality);
        form.set('background', request.background);
        form.set('output_format', request.output_format);

        for (const reference of resolvedReferences) {
          if (reference.bytes) {
            form.append(
              'image',
              new Blob([reference.bytes as any], { type: reference.mimeType }),
              reference.fileName,
            );
          } else {
            const downloaded = await fetchBinaryAsset(reference.imageUrl);
            form.append(
              'image',
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
          model: resolved.apiModel,
          prompt,
          size,
          n: request.count,
          quality,
          background: request.background,
          output_format: request.output_format,
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
          background: request.background,
          outputFormat: request.output_format,
          error: `OpenAI image generation failed: ${message}`,
          errorType: 'api_error',
        });
      }

      const data = Array.isArray(parsed?.data) ? parsed.data : [];
      const revisedPrompt = typeof data[0]?.revised_prompt === 'string' ? data[0].revised_prompt : null;
      const images = [];

      for (const item of data) {
        let imageBytes: Buffer | null = null;
        let itemMimeType = mimeType;

        if (typeof item?.b64_json === 'string' && item.b64_json) {
          imageBytes = Buffer.from(item.b64_json, 'base64');
        } else if (typeof item?.url === 'string' && item.url) {
          const downloaded = await fetchBinaryAsset(item.url);
          imageBytes = downloaded.bytes;
          itemMimeType = downloaded.mimeType || itemMimeType;
        }

        if (!imageBytes || imageBytes.length === 0) continue;
        const persisted = await persistGeneratedImage({
          bytes: imageBytes,
          mimeType: itemMimeType,
          provider: this.id,
          prompt,
          outputDir: request.output_dir,
          outputRunDir: request.output_run_dir,
          saveToWorkspace: request.save_to_workspace,
        });
        images.push(persisted);
        try {
          await request.on_image_persisted?.(persisted);
        } catch {}
      }

      if (!images.length) {
        return buildImageGenerationError({
          provider: this.id,
          model,
          prompt,
          aspectRatio: request.aspect_ratio,
          background: request.background,
          outputFormat: request.output_format,
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
        quality,
        size,
        background: request.background,
        outputFormat: request.output_format,
      });
    } catch (error: any) {
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        background: request.background,
        outputFormat: request.output_format,
        error: `OpenAI image generation failed: ${String(error?.message || error)}`,
        errorType: 'api_error',
      });
    }
  }
}
