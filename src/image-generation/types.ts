export const VALID_IMAGE_ASPECT_RATIOS = ['landscape', 'square', 'portrait'] as const;

export type ImageAspectRatio = typeof VALID_IMAGE_ASPECT_RATIOS[number];
export type ImageBackground = 'transparent' | 'opaque' | 'auto';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageQuality = 'low' | 'medium' | 'high' | 'auto';
export type ImageGenerationPresentationMode = 'foreground' | 'background';

export interface ImageGenerationProviderCapabilities {
  transparency: boolean;
  referenceImages: boolean;
  maxReferenceImages: number;
  maskEditing: boolean;
  partialStreaming: boolean;
  outputFormats: readonly ImageOutputFormat[];
  outputCompression: boolean;
  exactSizes: boolean;
  sizes: string[];
}

export interface GeneratedImageAsset {
  path: string;
  rel_path?: string;
  cache_path?: string;
  mime_type: string;
  file_name: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  has_alpha?: boolean | null;
  generation_id?: string | null;
  parent_generation_id?: string | null;
  partial_index?: number | null;
}

export type ImagePersistedCallback = (image: GeneratedImageAsset) => void | Promise<void>;
export type ImagePartialCallback = (image: GeneratedImageAsset & { partial: true }) => void | Promise<void>;

export interface ImageGenerationRequest {
  prompt: string;
  reference_images?: string[];
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
  presentation_mode?: ImageGenerationPresentationMode | 'auto';
  partial_images?: number | boolean;
  stream?: boolean;
  output_dir?: string;
  save_to_workspace?: boolean;
  on_image_persisted?: ImagePersistedCallback;
  on_partial_image?: ImagePartialCallback;
}

export interface ImageGenerationResolvedRequest {
  prompt: string;
  reference_images: string[];
  aspect_ratio: ImageAspectRatio;
  count: number;
  model?: string;
  background: ImageBackground;
  output_format: ImageOutputFormat;
  output_compression?: number;
  quality?: ImageQuality;
  size: string;
  width?: number;
  height?: number;
  mask?: string;
  presentation_mode: ImageGenerationPresentationMode;
  partial_images: number;
  stream: boolean;
  output_dir?: string;
  output_run_dir?: string;
  save_to_workspace: boolean;
  on_image_persisted?: ImagePersistedCallback;
  on_partial_image?: ImagePartialCallback;
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
  width?: number;
  height?: number;
  background?: ImageBackground;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  presentation_mode?: ImageGenerationPresentationMode;
}

export interface ImageGenerationFailure {
  success: false;
  provider: string;
  model?: string;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  background?: ImageBackground;
  output_format?: ImageOutputFormat;
  presentation_mode?: ImageGenerationPresentationMode;
  error: string;
  error_type: string;
}

export type ImageGenerationResult = ImageGenerationSuccess | ImageGenerationFailure;

export interface ImageGenerationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ImageGenerationProviderCapabilities;
  listModels(): readonly string[];
  isAvailable(): Promise<boolean>;
  resolveModel(requestedModel?: string): string;
  generate(request: ImageGenerationResolvedRequest): Promise<ImageGenerationResult>;
}
