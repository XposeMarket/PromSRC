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
  on_image_persisted?: (image: {
    path: string;
    rel_path?: string;
    cache_path?: string;
    mime_type: string;
    file_name: string;
    bytes: number;
  }) => void | Promise<void>;
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
    on_image_persisted: args?.on_image_persisted,
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
  description: 'Generate one or more raster images from a text prompt using the configured AI image provider such as OpenAI GPT image models or xAI Grok Imagine. For separate options/variations, set count > 1 and ask for separate standalone images, not a collage. Use count=1 only when the user wants one image or explicitly wants a single collage/grid/contact sheet.',
  execute: executeGenerateImage,
  schema: {
    prompt: 'Text prompt describing the image to generate',
    reference_images: 'Optional local file paths, workspace-relative paths, HTTPS URLs, or data URLs to use as image references',
    aspect_ratio: 'Optional aspect ratio: landscape, square, or portrait',
    count: 'Optional number of images to generate at once (1-4)',
    provider: 'Optional provider override: auto, openai, openai_codex, or xai. openai may use either an OpenAI API key or saved OpenAI OAuth/Codex auth; use xai for Grok Imagine.',
    model: 'Optional image model tier override, e.g. gpt-image-2-medium or grok-imagine-image-quality',
    output_dir: 'Optional workspace-relative parent output directory. Each generation run is saved in a new child folder. Default: generated/images',
    save_to_workspace: 'If false, keep the image only in Prometheus cache',
  },
  jsonSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Text prompt describing the image(s) to generate. For count > 1, say each output must be a separate standalone image and must not be a collage, grid, contact sheet, split-screen, or multi-panel image.' },
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
        description: 'How many separate image outputs to generate at once. Use values greater than 1 for options, variations, sets, or several standalone images; do not use count > 1 for a single collage/grid image.',
      },
      provider: {
        type: 'string',
        enum: ['auto', 'openai', 'openai_codex', 'xai'],
        description: 'Image generation provider override. openai may use either direct OpenAI API credentials or saved OpenAI OAuth/Codex auth.',
      },
      model: { type: 'string', description: 'Optional image model tier override, e.g. gpt-image-2-medium or grok-imagine-image-quality' },
      output_dir: { type: 'string', description: 'Workspace-relative parent output directory. Each generation run is saved in a new child folder.' },
      save_to_workspace: { type: 'boolean', description: 'If false, keep the image only in Prometheus cache' },
    },
    additionalProperties: false,
  },
};
