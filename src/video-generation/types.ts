export const VALID_VIDEO_ASPECT_RATIOS = ['landscape', 'square', 'portrait'] as const;
export const VALID_VIDEO_RESOLUTIONS = ['480p', '720p'] as const;
export const VALID_VIDEO_MODES = ['generate', 'edit', 'extend'] as const;

export type VideoAspectRatio = typeof VALID_VIDEO_ASPECT_RATIOS[number];
export type VideoResolution = typeof VALID_VIDEO_RESOLUTIONS[number];
export type VideoMode = typeof VALID_VIDEO_MODES[number];

export interface VideoGenerationRequest {
  prompt: string;
  image?: string;
  reference_images?: string[];
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
}

export interface VideoGenerationResolvedRequest {
  prompt: string;
  image?: string;
  reference_images: string[];
  video?: string;
  mode: VideoMode;
  aspect_ratio: VideoAspectRatio;
  duration: number;
  resolution: VideoResolution;
  model?: string;
  output_dir?: string;
  save_to_workspace: boolean;
  poll_interval_ms: number;
  timeout_ms: number;
}

export interface GeneratedVideoAsset {
  path: string;
  rel_path?: string;
  cache_path?: string;
  mime_type: string;
  file_name: string;
  bytes: number;
  source_url?: string;
}

export interface VideoGenerationSuccess {
  success: true;
  provider: string;
  model: string;
  prompt: string;
  mode: VideoMode;
  aspect_ratio: VideoAspectRatio;
  duration: number;
  resolution: VideoResolution;
  request_id: string;
  video: GeneratedVideoAsset;
  video_url?: string;
  respect_moderation?: boolean | null;
  progress?: number;
}

export interface VideoGenerationFailure {
  success: false;
  provider: string;
  model?: string;
  prompt: string;
  mode: VideoMode;
  aspect_ratio: VideoAspectRatio;
  error: string;
  error_type: string;
  request_id?: string;
  progress?: number;
}

export type VideoGenerationResult = VideoGenerationSuccess | VideoGenerationFailure;

export interface VideoGenerationProvider {
  readonly id: string;
  readonly displayName: string;
  listModels(): readonly string[];
  isAvailable(): Promise<boolean>;
  resolveModel(requestedModel?: string): string;
  generate(request: VideoGenerationResolvedRequest): Promise<VideoGenerationResult>;
}
