export const VALID_IMAGE_ASPECT_RATIOS = ['landscape', 'square', 'portrait'] as const;

export type ImageAspectRatio = typeof VALID_IMAGE_ASPECT_RATIOS[number];
export type ImageBackground = 'transparent' | 'opaque' | 'auto';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageQuality = 'low' | 'medium' | 'high' | 'auto';

export interface GeneratedImageAsset {
  path: string;
  rel_path?: string;
  cache_path?: string;
  mime_type: string;
  file_name: string;
  bytes: number;
}

export type ImagePersistedCallback = (image: GeneratedImageAsset) => void | Promise<void>;

export interface ImageGenerationRequest {
  prompt: string;
  reference_images?: string[];
  aspect_ratio?: string;
  count?: number;
  provider?: string;
  model?: string;
  background?: string;
  output_format?: string;
  quality?: string;
  output_dir?: string;
  save_to_workspace?: boolean;
  on_image_persisted?: ImagePersistedCallback;
}

export interface ImageGenerationResolvedRequest {
  prompt: string;
  reference_images: string[];
  aspect_ratio: ImageAspectRatio;
  count: number;
  model?: string;
  background: ImageBackground;
  output_format: ImageOutputFormat;
  quality?: ImageQuality;
  output_dir?: string;
  output_run_dir?: string;
  save_to_workspace: boolean;
  on_image_persisted?: ImagePersistedCallback;
}

export interface ImageGenerationSuccess {
  success: true;
  provider: string;
  model: string;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  image: GeneratedImageAsset;
  images: GeneratedImageAsset[];
  image_count: number;
  revised_prompt?: string | null;
  quality?: string;
  size?: string;
  background?: ImageBackground;
  output_format?: ImageOutputFormat;
}

export interface ImageGenerationFailure {
  success: false;
  provider: string;
  model?: string;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  background?: ImageBackground;
  output_format?: ImageOutputFormat;
  error: string;
  error_type: string;
}

export type ImageGenerationResult = ImageGenerationSuccess | ImageGenerationFailure;

export interface ImageGenerationProvider {
  readonly id: string;
  readonly displayName: string;
  listModels(): readonly string[];
  isAvailable(): Promise<boolean>;
  resolveModel(requestedModel?: string): string;
  generate(request: ImageGenerationResolvedRequest): Promise<ImageGenerationResult>;
}
