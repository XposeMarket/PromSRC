import type { ToolResult } from '../types.js';
import { generateImage } from '../image-generation/registry.js';

type GenerateImageArgs = {
  prompt: string;
  reference_images?: string[] | string;
  aspect_ratio?: string;
  count?: number;
  provider?: string;
  model?: string;
  background?: string;
  output_format?: string;
  output_compression?: number;
  quality?: string;
  size?: string;
  width?: number;
  height?: number;
  mask?: string;
  presentation_mode?: 'foreground' | 'background' | 'auto';
  partial_images?: number | boolean;
  stream?: boolean;
  output_dir?: string;
  save_to_workspace?: boolean;
  on_image_persisted?: (image: {
    path: string;
    rel_path?: string;
    cache_path?: string;
    mime_type: string;
    file_name: string;
    bytes: number;
    width?: number | null;
    height?: number | null;
    has_alpha?: boolean | null;
  }) => void | Promise<void>;
  on_partial_image?: (image: any) => void | Promise<void>;
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
    background: args?.background != null ? String(args.background) : undefined,
    output_format: args?.output_format != null ? String(args.output_format) : undefined,
    output_compression: args?.output_compression != null ? Number(args.output_compression) : undefined,
    quality: args?.quality != null ? String(args.quality) : undefined,
    size: args?.size != null ? String(args.size) : undefined,
    width: args?.width != null ? Number(args.width) : undefined,
    height: args?.height != null ? Number(args.height) : undefined,
    mask: args?.mask != null ? String(args.mask) : undefined,
    presentation_mode: args?.presentation_mode,
    partial_images: args?.partial_images,
    stream: args?.stream,
    output_dir: args?.output_dir != null ? String(args.output_dir) : undefined,
    save_to_workspace: args?.save_to_workspace,
    on_image_persisted: args?.on_image_persisted,
    on_partial_image: args?.on_partial_image,
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
      background: result.background,
      output_format: result.output_format,
      quality: result.quality,
      size: result.size,
      width: result.width,
      height: result.height,
      presentation_mode: result.presentation_mode,
      path: primary.path,
      rel_path: primary.rel_path,
      cache_path: primary.cache_path,
      mime_type: primary.mime_type,
      file_name: primary.file_name,
      bytes: primary.bytes,
      width_actual: primary.width,
      height_actual: primary.height,
      has_alpha: primary.has_alpha,
      images: result.images.map((image) => ({
        provider: result.provider,
        model: result.model,
        prompt: result.prompt,
        revised_prompt: result.revised_prompt ?? null,
        aspect_ratio: result.aspect_ratio,
        background: result.background,
        output_format: result.output_format,
        path: image.path,
        rel_path: image.rel_path,
        cache_path: image.cache_path,
        mime_type: image.mime_type,
        file_name: image.file_name,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        has_alpha: image.has_alpha,
      })),
    },
  };
}

export const generateImageTool = {
  name: 'generate_image',
  description: 'Generate one or more raster images from a prompt or references using the configured image provider. Use background="transparent" and output_format="png" for true alpha transparency; do not rely only on prompt wording. Use count > 1 for separate standalone variations.',
  execute: executeGenerateImage,
  schema: {
    prompt: 'Text prompt describing the image to generate',
    reference_images: 'Optional local file paths, workspace-relative paths, HTTPS URLs, or data URLs to use as image references',
    aspect_ratio: 'Optional aspect ratio: landscape, square, or portrait',
    count: 'Optional number of images to generate at once (1-4)',
    provider: 'Optional provider override: auto, openai, openai_codex, or xai. openai may use either an OpenAI API key or saved OpenAI OAuth/Codex auth; use xai for Grok Imagine.',
    model: 'Optional image model tier override, e.g. gpt-image-2-medium or grok-imagine-image-quality',
    background: 'Optional background mode: transparent, opaque, or auto. Use transparent for real alpha in generated PNG/WebP files.',
    output_format: 'Optional output file format: png, jpeg, or webp. Transparency requires png or webp; png is used when transparent is requested.',
    output_compression: 'Optional compression/quality control for JPEG/WebP where supported, 0-100',
    quality: 'Optional quality setting: low, medium, high, or auto.',
    size: 'Optional exact output size WIDTHxHEIGHT for providers/models that support it',
    width: 'Optional exact output width in pixels',
    height: 'Optional exact output height in pixels',
    mask: 'Optional PNG alpha mask for selection editing, matching the first reference image dimensions',
    presentation_mode: 'foreground for direct image deliverables, background for workflow/intermediate asset generation',
    partial_images: 'Internal: number of partial image previews to stream where supported',
    output_dir: 'Optional workspace-relative parent output directory. Each generation run is saved in a new child folder. Default: generated/images',
    save_to_workspace: 'If false, keep the image only in Prometheus cache',
  },
  jsonSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Image prompt. For count > 1, request separate standalone outputs, not a collage/grid.' },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 16,
        description: 'Optional local/workspace paths, HTTPS URLs, or data URLs used as image references.',
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
        description: 'Number of separate image outputs, 1-4.',
      },
      provider: {
        type: 'string',
        enum: ['auto', 'openai', 'openai_codex', 'xai'],
        description: 'Provider override.',
      },
      model: { type: 'string', description: 'Optional image model tier override, e.g. gpt-image-2-medium or grok-imagine-image-quality' },
      background: {
        type: 'string',
        enum: ['transparent', 'opaque', 'auto'],
        description: 'Background mode. Use transparent for true alpha; Prometheus also infers this when the prompt asks for a transparent/no background sprite or cutout.',
      },
      output_format: {
        type: 'string',
        enum: ['png', 'jpeg', 'webp'],
        description: 'Output file format. Use png or webp for transparency; png is forced if background is transparent and jpeg was requested.',
      },
      output_compression: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'JPEG/WebP output compression/quality control where supported.',
      },
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'auto'],
        description: 'Image generation quality.',
      },
      size: { type: 'string', description: 'Exact output size such as 1536x1024, 1024x1024, 1024x1536, or auto.' },
      width: { type: 'integer', minimum: 256, maximum: 4096, description: 'Exact output width in pixels.' },
      height: { type: 'integer', minimum: 256, maximum: 4096, description: 'Exact output height in pixels.' },
      mask: { type: 'string', description: 'PNG alpha mask for selection editing. Must match the first reference image dimensions.' },
      presentation_mode: {
        type: 'string',
        enum: ['foreground', 'background', 'auto'],
        description: 'Presentation mode. foreground is for direct image deliverables; background is for generated assets used as part of a larger workflow.',
      },
      partial_images: { type: 'integer', minimum: 0, maximum: 3, description: 'Internal preview streaming control where supported.' },
      output_dir: { type: 'string', description: 'Workspace-relative parent output directory. Each generation run is saved in a new child folder.' },
      save_to_workspace: { type: 'boolean', description: 'If false, keep the image only in Prometheus cache' },
    },
    additionalProperties: false,
  },
};
