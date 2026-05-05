export type CreativePremiumTemplateSlot = {
  id: string;
  label: string;
  kind: 'text' | 'image' | 'video' | 'audio' | 'brand' | 'color';
  required?: boolean;
  placeholder?: string;
};

export type CreativePremiumTemplate = {
  id: string;
  name: string;
  description: string;
  category: 'saas' | 'ai' | 'audio' | 'product' | 'social';
  supportedModes: Array<'video'>;
  defaultFormat: 'reel' | 'short' | 'story' | 'square' | 'feed45' | 'youtube';
  defaultWidth: number;
  defaultHeight: number;
  defaultDurationMs: number;
  defaultFrameRate: number;
  qualityChecks: string[];
  slots: CreativePremiumTemplateSlot[];
  tags: string[];
};

const PREMIUM_TEMPLATES: CreativePremiumTemplate[] = [
  {
    id: 'saas-hero-reveal',
    name: 'SaaS Hero Reveal',
    description: 'Premium SaaS launch opener with product frame, proof chips, CTA, animated gradient plate, and staggered type.',
    category: 'saas',
    supportedModes: ['video'],
    defaultFormat: 'reel',
    defaultWidth: 1080,
    defaultHeight: 1920,
    defaultDurationMs: 9000,
    defaultFrameRate: 60,
    qualityChecks: ['safe-area', 'text-overflow', 'timeline-coverage', 'visual-density', 'cta-readability'],
    slots: [
      { id: 'title', label: 'Headline', kind: 'text', required: true, placeholder: 'Launch the workflow that sells while you sleep' },
      { id: 'subtitle', label: 'Subheadline', kind: 'text', placeholder: 'Prometheus turns strategy, assets, and follow-up into one operating layer.' },
      { id: 'cta', label: 'CTA', kind: 'text', placeholder: 'See the system' },
      { id: 'productImage', label: 'Product screenshot', kind: 'image' },
      { id: 'brandKit', label: 'Brand kit', kind: 'brand' },
    ],
    tags: ['saas', 'launch', 'hero', 'product', 'cta'],
  },
  {
    id: 'ai-dashboard-flythrough',
    name: 'AI Dashboard Flythrough',
    description: 'Cinematic AI/product dashboard motion with layered panels, metric cards, neural overlay, and camera-like parallax.',
    category: 'ai',
    supportedModes: ['video'],
    defaultFormat: 'reel',
    defaultWidth: 1080,
    defaultHeight: 1920,
    defaultDurationMs: 11000,
    defaultFrameRate: 60,
    qualityChecks: ['safe-area', 'panel-overlap', 'motion-depth', 'text-overflow', 'frame-diff'],
    slots: [
      { id: 'title', label: 'Headline', kind: 'text', required: true, placeholder: 'Your AI command center, finally visible' },
      { id: 'subtitle', label: 'Subheadline', kind: 'text', placeholder: 'Dashboards, agents, decisions, and proof in one living system.' },
      { id: 'metricOne', label: 'Metric 1', kind: 'text', placeholder: '+38%' },
      { id: 'metricTwo', label: 'Metric 2', kind: 'text', placeholder: '4.2x' },
      { id: 'brandKit', label: 'Brand kit', kind: 'brand' },
    ],
    tags: ['ai', 'dashboard', 'flythrough', 'metrics', 'product'],
  },
  {
    id: 'podcast-audiogram-premium',
    name: 'Podcast Audiogram Premium',
    description: 'Polished audio highlight format with cover plate, waveform bars, caption window, progress, speaker badge, and audio-aware slots.',
    category: 'audio',
    supportedModes: ['video'],
    defaultFormat: 'reel',
    defaultWidth: 1080,
    defaultHeight: 1920,
    defaultDurationMs: 30000,
    defaultFrameRate: 60,
    qualityChecks: ['audio-sync', 'caption-timing', 'waveform-coverage', 'safe-area', 'readability'],
    slots: [
      { id: 'title', label: 'Episode title', kind: 'text', required: true, placeholder: 'The founder systems episode' },
      { id: 'subtitle', label: 'Pull quote', kind: 'text', placeholder: 'The bottleneck was never effort. It was rhythm.' },
      { id: 'speaker', label: 'Speaker', kind: 'text', placeholder: 'Prometheus Radio' },
      { id: 'audio', label: 'Audio file', kind: 'audio' },
      { id: 'coverImage', label: 'Cover image', kind: 'image' },
    ],
    tags: ['podcast', 'audiogram', 'waveform', 'caption', 'audio'],
  },
];

export function listCreativePremiumTemplates(): CreativePremiumTemplate[] {
  return PREMIUM_TEMPLATES.map((template) => JSON.parse(JSON.stringify(template)));
}

export function getCreativePremiumTemplate(templateId: any): CreativePremiumTemplate | null {
  const normalized = String(templateId || '').trim().toLowerCase();
  return PREMIUM_TEMPLATES.find((template) => template.id === normalized) || null;
}
