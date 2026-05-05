import type { CreativeMotionTemplate } from '../../gateway/creative/contracts';

export const CREATIVE_MOTION_TEMPLATES: CreativeMotionTemplate[] = [
  {
    id: 'caption-reel-v2',
    name: 'Caption Reel V2',
    description: 'Production-grade social caption reel with word highlighting, kinetic punches, clean line breaking, safe-area framing, CTA/outro card, and progress motion.',
    category: 'captions',
    supportedModes: ['video'],
    supportedFormats: ['reel', 'short', 'story', 'square', 'feed45'],
    defaultDurationMs: 15000,
    defaultFps: 30,
    compositionId: 'CaptionReelV2',
    presets: [
      {
        id: 'bold-tiktok-v2',
        label: 'Bold TikTok V2',
        description: 'Large kinetic captions, bright active-word highlights, punch motion, and a strong vertical social layout.',
        style: { preset: 'bold-tiktok', energy: 'hype', density: 'balanced', motion: 'kinetic', palette: 'contrast' },
      },
      {
        id: 'startup-launch-v2',
        label: 'Startup Launch V2',
        description: 'Clean product-launch framing with tech typography, progress accents, and refined motion pacing.',
        style: { preset: 'startup-launch', energy: 'clean', density: 'balanced', motion: 'snappy', palette: 'tech' },
      },
      {
        id: 'editorial-v2',
        label: 'Editorial V2',
        description: 'Warmer editorial typography, quieter motion, and premium caption rhythm.',
        style: { preset: 'editorial', energy: 'calm', density: 'minimal', motion: 'subtle', palette: 'editorial' },
      },
      {
        id: 'professional-v2',
        label: 'Professional V2',
        description: 'Readable professional motion for LinkedIn-style clips, launches, and explainers.',
        style: { preset: 'professional', energy: 'calm', density: 'balanced', motion: 'measured', palette: 'professional' },
      },
    ],
    schema: {
      required: ['captions'],
      properties: {
        captions: 'CreativeCaptionTrack with segments and optional word timings, or plain caption/captionText for auto-segmentation',
        text: 'Title, subtitle/body support copy, and optional cta',
        brand: 'Optional CreativeBrandKit with colors and fonts',
        style: 'Preset, energy, density, motion, and palette controls',
      },
    },
  },
  {
    id: 'caption-reel',
    name: 'Caption Reel',
    description: 'Turns transcript segments or word timings into a vertical social caption video with animated emphasis.',
    category: 'captions',
    supportedModes: ['video'],
    supportedFormats: ['reel', 'short', 'story', 'square', 'feed45'],
    defaultDurationMs: 15000,
    defaultFps: 30,
    compositionId: 'CaptionReel',
    presets: [
      {
        id: 'clean-creator',
        label: 'Clean Creator',
        description: 'Large readable captions, restrained motion, and a bright creator-style layout.',
        style: { energy: 'clean', density: 'balanced', motion: 'snappy', palette: 'light' },
      },
      {
        id: 'bold-tiktok',
        label: 'Bold TikTok',
        description: 'High-contrast word highlights and punchier timing for short-form clips.',
        style: { energy: 'hype', density: 'balanced', motion: 'kinetic', palette: 'contrast' },
      },
      {
        id: 'minimal-linkedin',
        label: 'Minimal LinkedIn',
        description: 'Quiet typography, measured motion, and professional framing.',
        style: { energy: 'calm', density: 'minimal', motion: 'subtle', palette: 'professional' },
      },
    ],
    schema: {
      required: ['captions'],
      properties: {
        captions: 'CreativeCaptionTrack with segments and optional word timings',
        text: 'Optional title, subtitle, body, and cta copy',
        brand: 'Optional CreativeBrandKit',
        style: 'Energy, density, motion, and palette controls',
      },
    },
  },
  {
    id: 'audio-visualizer',
    name: 'Audio Visualizer',
    description: 'Builds waveform, pulse, and progress visuals from Prometheus audio analysis data.',
    category: 'audio-reactive',
    supportedModes: ['video'],
    supportedFormats: ['reel', 'short', 'story', 'square', 'feed45', 'youtube'],
    defaultDurationMs: 30000,
    defaultFps: 30,
    compositionId: 'AudioVisualizer',
    presets: [
      {
        id: 'podcast-audiogram',
        label: 'Podcast Audiogram',
        description: 'Centered title, waveform lane, captions, and progress bar.',
        style: { energy: 'clean', density: 'balanced', motion: 'subtle' },
      },
      {
        id: 'music-pulse',
        label: 'Music Pulse',
        description: 'Beat-like scale and waveform movement for music clips.',
        style: { energy: 'hype', density: 'maximal', motion: 'kinetic' },
      },
    ],
    schema: {
      required: ['audioAnalysis'],
      properties: {
        audioAnalysis: 'CreativeAudioAnalysis with waveformPeaks',
        text: 'Title and subtitle copy',
        brand: 'Optional CreativeBrandKit',
      },
    },
  },
  {
    id: 'product-promo',
    name: 'Product Promo',
    description: 'Animates screenshots, benefits, CTA, and brand marks into a social product sequence.',
    category: 'product',
    supportedModes: ['video'],
    supportedFormats: ['reel', 'short', 'story', 'square', 'feed45', 'youtube'],
    defaultDurationMs: 15000,
    defaultFps: 30,
    compositionId: 'ProductPromo',
    presets: [
      {
        id: 'saas-launch',
        label: 'SaaS Launch',
        description: 'Product screenshots with title cards and feature callouts.',
        style: { energy: 'clean', density: 'balanced', motion: 'snappy' },
      },
      {
        id: 'feature-drop',
        label: 'Feature Drop',
        description: 'Fast visual rhythm for announcing a new capability.',
        style: { energy: 'bold', density: 'balanced', motion: 'kinetic' },
      },
    ],
    schema: {
      required: ['text'],
      properties: {
        assets: 'Images or video clips for screenshots/product views',
        text: 'Title, subtitle, benefits, and CTA',
        brand: 'Optional CreativeBrandKit',
      },
    },
  },
];

export function listCreativeMotionTemplates(): CreativeMotionTemplate[] {
  return CREATIVE_MOTION_TEMPLATES.map((template) => JSON.parse(JSON.stringify(template)));
}

export function getCreativeMotionTemplate(templateId: any): CreativeMotionTemplate | null {
  const normalized = String(templateId || '').trim().toLowerCase();
  return CREATIVE_MOTION_TEMPLATES.find((template) => template.id === normalized) || null;
}
