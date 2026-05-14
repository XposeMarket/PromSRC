import type { ToolResult } from '../types.js';
import { generateImage } from '../image-generation/registry.js';

type GenerateImageArgs = {
  prompt: string;
  reference_images?: string[] | string;
  aspect_ratio?: string;
  count?: number;
  provider?: string;
  model?: string;
  output_dir?: string;
  save_to_workspace?: boolean;
};

export async function executeGenerateImage(args: GenerateImageArgs): Promise<ToolResult> {
  const referenceImages = Array.isArray(args?.reference_images)
    ? args.reference_images.map((item) => String(item))
    : (args?.reference_images != null ? [String(args.reference_images)] : undefined);
  const result = await generateImage({
    prompt: String(args?.prompt || ''),
    reference_images: referenceImages,
    aspect_ratio: args?.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
    count: args?.count != null ? Number(args.count) : undefined,
    provider: args?.provider != null ? String(args.provider) : undefined,
    model: args?.model != null ? String(args.model) : undefined,
    output_dir: args?.output_dir != null ? String(args.output_dir) : undefined,
    save_to_workspace: args?.save_to_workspace,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      data: result,
    };
  }

  const primary = result.images[0] || result.image;
  const location = primary.rel_path || primary.path;
  const imageCount = Math.max(1, Number(result.image_count || result.images.length || 1));
  return {
    success: true,
    stdout: `Generated ${imageCount} image${imageCount === 1 ? '' : 's'} with ${result.provider}/${result.model}. First image saved to ${location}.`,
    data: {
      provider: result.provider,
      model: result.model,
      prompt: result.prompt,
      reference_images: referenceImages || [],
      revised_prompt: result.revised_prompt ?? null,
      aspect_ratio: result.aspect_ratio,
      image_count: imageCount,
      quality: result.quality,
      size: result.size,
      path: primary.path,
      rel_path: primary.rel_path,
      cache_path: primary.cache_path,
      mime_type: primary.mime_type,
      file_name: primary.file_name,
      bytes: primary.bytes,
      images: result.images.map((image) => ({
        provider: result.provider,
        model: result.model,
        prompt: result.prompt,
        revised_prompt: result.revised_prompt ?? null,
        aspect_ratio: result.aspect_ratio,
        path: image.path,
        rel_path: image.rel_path,
        cache_path: image.cache_path,
        mime_type: image.mime_type,
        file_name: image.file_name,
        bytes: image.bytes,
      })),
    },
  };
}

export const generateImageTool = {
  name: 'generate_image',
  description: 'Generate a new raster image from a text prompt using the configured AI image provider such as OpenAI GPT image models or xAI Grok Imagine. Use this for one-shot image generation, including brand kits, posters, thumbnails, concept art, and requests that reference uploaded files.',
  execute: executeGenerateImage,
  schema: {
    prompt: 'Text prompt describing the image to generate',
    reference_images: 'Optional local file paths, workspace-relative paths, HTTPS URLs, or data URLs to use as image references',
    aspect_ratio: 'Optional aspect ratio: landscape, square, or portrait',
    count: 'Optional number of images to generate at once (1-4)',
    provider: 'Optional provider override: auto, openai, openai_codex, or xai. Use xai for Grok Imagine.',
    model: 'Optional image model tier override, e.g. gpt-image-2-medium or grok-imagine-image-quality',
    output_dir: 'Optional workspace-relative output directory (default: generated/images)',
    save_to_workspace: 'If false, keep the image only in Prometheus cache',
  },
  jsonSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Text prompt describing the image to generate' },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 16,
        description: 'Optional reference images as local/workspace file paths, HTTPS URLs, or data URLs. These are sent as actual image inputs for gpt-image-2 reference/edit generation.',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['landscape', 'square', 'portrait'],
        description: 'Desired image aspect ratio',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: 4,
        description: 'How many images to generate at once',
      },
      provider: {
        type: 'string',
        enum: ['auto', 'openai', 'openai_codex', 'xai'],
        description: 'Image generation provider override',
      },
      model: { type: 'string', description: 'Optional image model tier override, e.g. gpt-image-2-medium or grok-imagine-image-quality' },
      output_dir: { type: 'string', description: 'Workspace-relative output directory' },
      save_to_workspace: { type: 'boolean', description: 'If false, keep the image only in Prometheus cache' },
    },
    additionalProperties: false,
  },
};
