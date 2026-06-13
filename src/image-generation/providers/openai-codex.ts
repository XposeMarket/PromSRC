import { getConfig } from '../../config/config.js';
import {
  buildCodexCloudflareHeaders,
  getValidToken,
  loadTokens,
} from '../../auth/openai-oauth.js';
import type {
  ImageGenerationProvider,
  ImageGenerationResolvedRequest,
  ImageGenerationResult,
} from '../types.js';
import {
  buildImageGenerationError,
  buildImageGenerationSuccess,
  getImageGenerationConfig,
  IMAGE_SIZE_BY_ASPECT_RATIO,
  persistGeneratedImage,
  resolveReferenceImages,
} from '../utils.js';

const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const CODEX_CHAT_MODEL = 'gpt-5.4';
const API_MODEL = 'gpt-image-2';
const DEFAULT_MODEL = 'gpt-image-2-medium';
const MODEL_IDS = ['gpt-image-2-low', 'gpt-image-2-medium', 'gpt-image-2-high'] as const;

const MODEL_METADATA: Record<string, { quality: 'low' | 'medium' | 'high' }> = {
  'gpt-image-2-low': { quality: 'low' },
  'gpt-image-2-medium': { quality: 'medium' },
  'gpt-image-2-high': { quality: 'high' },
};

const CODEX_INSTRUCTIONS = 'You are an assistant that must fulfill image generation requests by using the image_generation tool when provided.';

function appendSeparateOutputGuardrail(prompt: string, count: number): string {
  if (count <= 1) return prompt;
  return [
    prompt,
    '',
    `Generate exactly ${count} separate standalone image outputs.`,
    'Do not create a collage, grid, contact sheet, split-screen composition, or multi-panel layout.',
    'Each output should be a complete full-frame image on its own.',
  ].join('\n');
}

function coerceModelId(value?: string): string | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'gpt-image-2') return DEFAULT_MODEL;
  return MODEL_METADATA[raw] ? raw : undefined;
}

function resolveDefaultModel(): string {
  const imageCfg = getImageGenerationConfig();
  const providerCfg = imageCfg.providers.openai_codex || {};
  return coerceModelId(String(providerCfg.model || imageCfg.model || process.env.CODEX_IMAGE_MODEL || DEFAULT_MODEL)) || DEFAULT_MODEL;
}

function getConfigDir(): string {
  return getConfig().getConfigDir();
}

type CodexStreamResult = {
  images: Array<{
    id?: string | null;
    imageB64: string;
    revisedPrompt?: string | null;
    order: number;
  }>;
};

function extractImagesFromFinalResponse(finalResponse: any): CodexStreamResult['images'] {
  const output = Array.isArray(finalResponse?.output) ? finalResponse.output : [];
  let order = 0;
  const images = [];
  for (const item of output) {
    if (item?.type === 'image_generation_call' && typeof item?.result === 'string' && item.result) {
      images.push({
        id: typeof item?.id === 'string' ? item.id : null,
        imageB64: item.result,
        revisedPrompt: typeof item?.revised_prompt === 'string' ? item.revised_prompt : null,
        order: order++,
      });
    }
  }
  return images;
}

async function collectImageFromStream(response: Response): Promise<CodexStreamResult> {
  if (!response.body) {
    throw new Error('Codex image generation returned no response body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: any = null;
  let eventOrder = 0;
  const completedImages = new Map<string, CodexStreamResult['images'][number]>();
  const partialImages = new Map<string, CodexStreamResult['images'][number]>();

  const imageKeyFor = (value: any, fallbackPrefix: string) => {
    const key = String(value || '').trim();
    return key || `${fallbackPrefix}_${eventOrder++}`;
  };

  const findSeparatorIndex = (input: string): { index: number; length: number } | null => {
    const crlf = input.indexOf('\r\n\r\n');
    const lf = input.indexOf('\n\n');
    if (crlf === -1 && lf === -1) return null;
    if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
    return { index: lf, length: 2 };
  };

  const handleBlock = (block: string) => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    if (!lines.length) return;

    const dataLines: string[] = [];
    let eventType = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    const payloadText = dataLines.join('\n').trim();
    if (!payloadText || payloadText === '[DONE]') return;

    let payload: any = null;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      return;
    }

    const payloadType = String(payload?.type || eventType || '').trim();
    if (payloadType === 'response.output_item.done') {
      const item = payload?.item;
      if (item?.type === 'image_generation_call' && typeof item?.result === 'string' && item.result) {
        const key = imageKeyFor(item?.id, 'done');
        completedImages.set(key, {
          id: typeof item?.id === 'string' ? item.id : null,
          imageB64: item.result,
          revisedPrompt: typeof item?.revised_prompt === 'string' ? item.revised_prompt : null,
          order: eventOrder++,
        });
      }
      return;
    }

    if (payloadType === 'response.image_generation_call.partial_image' || payloadType === 'image_generation.partial_image') {
      const partialB64 = typeof payload?.partial_image_b64 === 'string' && payload.partial_image_b64
        ? payload.partial_image_b64
        : (typeof payload?.b64_json === 'string' ? payload.b64_json : '');
      if (partialB64) {
        const key = imageKeyFor(payload?.item_id ?? payload?.id ?? payload?.partial_image_index, 'partial');
        if (!completedImages.has(key)) {
          partialImages.set(key, {
            id: typeof payload?.item_id === 'string' ? payload.item_id : (typeof payload?.id === 'string' ? payload.id : null),
            imageB64: partialB64,
            revisedPrompt: null,
            order: eventOrder++,
          });
        }
      }
      return;
    }

    if (payloadType === 'response.completed') {
      finalResponse = payload?.response || payload;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    }

    let separator = findSeparatorIndex(buffer);
    while (separator) {
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator.length);
      handleBlock(block);
      separator = findSeparatorIndex(buffer);
    }

    if (done) break;
  }

  const remaining = buffer.trim();
  if (remaining) handleBlock(remaining);

  if (finalResponse) {
    const fromFinal = extractImagesFromFinalResponse(finalResponse);
    if (fromFinal.length) {
      return { images: fromFinal };
    }
  }

  const completed = [...completedImages.values()].sort((a, b) => a.order - b.order);
  if (completed.length) {
    return { images: completed };
  }

  return {
    images: [...partialImages.values()].sort((a, b) => a.order - b.order),
  };
}

export class OpenAICodexImageGenerationProvider implements ImageGenerationProvider {
  readonly id = 'openai_codex';
  readonly displayName = 'OpenAI (Codex auth)';

  listModels(): readonly string[] {
    return MODEL_IDS;
  }

  async isAvailable(): Promise<boolean> {
    return loadTokens(getConfigDir()) !== null;
  }

  resolveModel(requestedModel?: string): string {
    return coerceModelId(requestedModel) || resolveDefaultModel();
  }

  async generate(request: ImageGenerationResolvedRequest): Promise<ImageGenerationResult> {
    const prompt = String(request.prompt || '').trim();
    const model = this.resolveModel(request.model);
    const size = IMAGE_SIZE_BY_ASPECT_RATIO[request.aspect_ratio];
    const meta = MODEL_METADATA[model] || MODEL_METADATA[DEFAULT_MODEL];
    const configDir = getConfigDir();

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

    try {
      const token = await getValidToken(configDir);
      const tokens = loadTokens(configDir);
      const headers: Record<string, string> = {
        ...buildCodexCloudflareHeaders(token, tokens?.account_id || ''),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        'OpenAI-Beta': 'responses=experimental',
      };

      const images: Awaited<ReturnType<typeof persistGeneratedImage>>[] = [];
      let revisedPrompt: string | null = null;
      const referenceImages = await resolveReferenceImages(request.reference_images || []);
      const promptForGeneration = appendSeparateOutputGuardrail(prompt, request.count);

      const persistStreamImages = async (streamResult: CodexStreamResult) => {
        if (revisedPrompt == null) {
          revisedPrompt = streamResult.images.find((item) => item.revisedPrompt)?.revisedPrompt ?? null;
        }

        for (const generated of streamResult.images) {
          if (images.length >= request.count) break;
          const persisted = await persistGeneratedImage({
            bytes: Buffer.from(generated.imageB64, 'base64'),
            mimeType: 'image/png',
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
      };

      const runCodexImageRequest = async (requestedCount: number, includeCountParam: boolean): Promise<{ ok: true; result: CodexStreamResult } | { ok: false; response: Response; rawText: string }> => {
        const content: any[] = [{ type: 'input_text', text: requestedCount > 1 ? promptForGeneration : prompt }];
        for (const reference of referenceImages) {
          content.push({ type: 'input_image', image_url: reference.imageUrl });
        }

        const imageTool: Record<string, unknown> = {
          type: 'image_generation',
          model: API_MODEL,
          size,
          quality: meta.quality,
          output_format: 'png',
          background: 'opaque',
          action: referenceImages.length ? 'edit' : 'generate',
          partial_images: 1,
        };
        if (includeCountParam && requestedCount > 1) {
          imageTool.n = requestedCount;
        }

        const response = await fetch(CODEX_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: CODEX_CHAT_MODEL,
            store: false,
            instructions: CODEX_INSTRUCTIONS,
            input: [{
              type: 'message',
              role: 'user',
              content,
            }],
            tools: [imageTool],
            tool_choice: {
              type: 'allowed_tools',
              mode: 'required',
              tools: [{ type: 'image_generation' }],
            },
            stream: true,
          }),
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });

        if (!response.ok) {
          return { ok: false, response, rawText: await response.text().catch(() => '') };
        }
        return { ok: true, result: await collectImageFromStream(response) };
      };

      if (request.count > 1) {
        const batch = await runCodexImageRequest(request.count, true);
        if (batch.ok && batch.result.images.length) {
          await persistStreamImages(batch.result);
        } else if (!batch.ok && batch.response.status === 401) {
          return buildImageGenerationError({
            provider: this.id,
            model,
            prompt,
            aspectRatio: request.aspect_ratio,
            error: `OpenAI image generation via Codex auth failed: ${String(batch.rawText || batch.response.statusText || batch.response.status).slice(0, 400)}`,
            errorType: 'auth_required',
          });
        }
      }

      while (images.length < request.count) {
        const single = await runCodexImageRequest(1, false);
        if (!single.ok) {
          if (images.length) break;
          return buildImageGenerationError({
            provider: this.id,
            model,
            prompt,
            aspectRatio: request.aspect_ratio,
            error: `OpenAI image generation via Codex auth failed: ${String(single.rawText || single.response.statusText || single.response.status).slice(0, 400)}`,
            errorType: single.response.status === 401 ? 'auth_required' : 'api_error',
          });
        }

        if (!single.result.images.length) {
          if (images.length) break;
          return buildImageGenerationError({
            provider: this.id,
            model,
            prompt,
            aspectRatio: request.aspect_ratio,
            error: 'Codex response contained no image_generation_call result.',
            errorType: 'empty_response',
          });
        }

        await persistStreamImages(single.result);
      }

      if (!images.length) {
        return buildImageGenerationError({
          provider: this.id,
          model,
          prompt,
          aspectRatio: request.aspect_ratio,
          error: 'Codex response contained no image_generation_call result.',
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
      const message = String(error?.message || error);
      return buildImageGenerationError({
        provider: this.id,
        model,
        prompt,
        aspectRatio: request.aspect_ratio,
        error: `OpenAI image generation via Codex auth failed: ${message}`,
        errorType: /not connected to openai/i.test(message) ? 'auth_required' : 'api_error',
      });
    }
  }
}
