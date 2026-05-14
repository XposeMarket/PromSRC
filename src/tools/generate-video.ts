import type { ToolResult } from '../types.js';
import { generateVideo } from '../video-generation/registry.js';

type GenerateVideoArgs = {
  prompt: string;
  image?: string;
  reference_images?: string[] | string;
  video?: string;
  mode?: string;
  aspect_ratio?: string;
  duration?: number;
  resolution?: string;
  provider?: string;
  model?: string;
  output_dir?: string;
  save_to_workspace?: boolean;
  poll_interval_ms?: number;
  timeout_ms?: number;
};

export async function executeGenerateVideo(args: GenerateVideoArgs): Promise<ToolResult> {
  const referenceImages = Array.isArray(args?.reference_images)
    ? args.reference_images.map((item) => String(item))
    : (args?.reference_images != null ? [String(args.reference_images)] : undefined);
  const result = await generateVideo({
    prompt: String(args?.prompt || ''),
    image: args?.image != null ? String(args.image) : undefined,
    reference_images: referenceImages,
    video: args?.video != null ? String(args.video) : undefined,
    mode: args?.mode != null ? String(args.mode) : undefined,
    aspect_ratio: args?.aspect_ratio != null ? String(args.aspect_ratio) : undefined,
    duration: args?.duration != null ? Number(args.duration) : undefined,
    resolution: args?.resolution != null ? String(args.resolution) : undefined,
    provider: args?.provider != null ? String(args.provider) : undefined,
    model: args?.model != null ? String(args.model) : undefined,
    output_dir: args?.output_dir != null ? String(args.output_dir) : undefined,
    save_to_workspace: args?.save_to_workspace,
    poll_interval_ms: args?.poll_interval_ms != null ? Number(args.poll_interval_ms) : undefined,
    timeout_ms: args?.timeout_ms != null ? Number(args.timeout_ms) : undefined,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      data: result,
    };
  }

  const location = result.video.rel_path || result.video.path;
  return {
    success: true,
    stdout: `Generated video with ${result.provider}/${result.model}. Saved to ${location}.`,
    data: {
      provider: result.provider,
      model: result.model,
      prompt: result.prompt,
      mode: result.mode,
      aspect_ratio: result.aspect_ratio,
      duration: result.duration,
      resolution: result.resolution,
      request_id: result.request_id,
      video_url: result.video_url,
      respect_moderation: result.respect_moderation ?? null,
      progress: result.progress,
      path: result.video.path,
      rel_path: result.video.rel_path,
      cache_path: result.video.cache_path,
      mime_type: result.video.mime_type,
      file_name: result.video.file_name,
      bytes: result.video.bytes,
      source_url: result.video.source_url,
      video: result.video,
    },
  };
}

export const generateVideoTool = {
  name: 'generate_video',
  description: 'Generate a short raster video using a configured AI video provider such as xAI Grok Imagine Video. Use this for one-shot text-to-video, image-to-video, reference-to-video, video editing, or video extension when the user wants an AI-generated MP4 rather than an editable timeline project.',
  execute: executeGenerateVideo,
  schema: {
    prompt: 'Text prompt describing the video to generate, edit, or extend',
    image: 'Optional local file path, workspace-relative path, HTTPS URL, or data URL for image-to-video',
    reference_images: 'Optional reference image paths/URLs/data URLs for reference-to-video',
    video: 'Optional local file path, workspace-relative path, HTTPS URL, or data URL for edit/extend modes',
    mode: 'Optional mode: generate, edit, or extend. Defaults to generate, or edit when video is provided',
    aspect_ratio: 'Optional aspect ratio: landscape, square, or portrait',
    duration: 'Optional video duration in seconds. xAI supports 1-15 for generation, max 10 for reference/extension',
    resolution: 'Optional resolution: 480p or 720p',
    provider: 'Optional provider override: auto or xai',
    model: 'Optional video model override, e.g. grok-imagine-video',
    output_dir: 'Optional workspace-relative output directory (default: generated/videos)',
    save_to_workspace: 'If false, keep the video only in Prometheus cache',
    poll_interval_ms: 'Optional polling interval in milliseconds',
    timeout_ms: 'Optional generation timeout in milliseconds',
  },
  jsonSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Text prompt describing the video to generate, edit, or extend' },
      image: { type: 'string', description: 'Optional source image path, URL, or data URL for image-to-video' },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 7,
        description: 'Optional reference images as local/workspace paths, HTTPS URLs, or data URLs for reference-to-video',
      },
      video: { type: 'string', description: 'Optional source video path, URL, or data URL for edit/extend modes' },
      mode: {
        type: 'string',
        enum: ['generate', 'edit', 'extend'],
        description: 'Video request mode',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['landscape', 'square', 'portrait'],
        description: 'Desired video aspect ratio',
      },
      duration: {
        type: 'integer',
        minimum: 1,
        maximum: 15,
        description: 'Video duration in seconds',
      },
      resolution: {
        type: 'string',
        enum: ['480p', '720p'],
        description: 'Video resolution',
      },
      provider: {
        type: 'string',
        enum: ['auto', 'xai'],
        description: 'Video generation provider override',
      },
      model: { type: 'string', description: 'Optional video model override, e.g. grok-imagine-video' },
      output_dir: { type: 'string', description: 'Workspace-relative output directory' },
      save_to_workspace: { type: 'boolean', description: 'If false, keep the video only in Prometheus cache' },
      poll_interval_ms: { type: 'integer', minimum: 1000, maximum: 30000, description: 'Polling interval in milliseconds' },
      timeout_ms: { type: 'integer', minimum: 30000, maximum: 1800000, description: 'Generation timeout in milliseconds' },
    },
    additionalProperties: false,
  },
};
