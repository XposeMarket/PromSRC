export const VALID_IMAGE_ASPECT_RATIOS = ['landscape', 'square', 'portrait'] as const;

export type ImageAspectRatio = typeof VALID_IMAGE_ASPECT_RATIOS[number];

export interface ImageGenerationRequest {
  prompt: string;
  reference_images?: string[];
  aspect_ratio?: string;
  count?: number;
  provider?: string;
  model?: string;
  output_dir?: string;
  save_to_workspace?: boolean;
}

export interface ImageGenerationResolvedRequest {
  prompt: string;
  reference_images: string[];
  aspect_ratio: ImageAspectRatio;
  count: number;
  model?: string;
  output_dir?: string;
  save_to_workspace: boolean;
}

export interface GeneratedImageAsset {
  path: string;
  rel_path?: string;
  cache_path?: string;
  mime_type: string;
  file_name: string;
  bytes: number;
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
}

export interface ImageGenerationFailure {
  success: false;
  provider: string;
  model?: string;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
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
