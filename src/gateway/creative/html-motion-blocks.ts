import { renderAsciiSourceCanvasParts } from './ascii-html-motion';
import {
  type CreativeStorageLike,
  getCustomHtmlMotionBlock,
  listCustomHtmlMotionBlocks,
  renderTemplatePlaceholders,
} from './custom-registries';

export type HtmlMotionBlockCategory =
  | 'captions'
  | 'typography'
  | 'layout'
  | 'product'
  | 'charts'
  | 'media'
  | 'transitions'
  | 'cta'
  | 'utility'
  | 'experimental';

export type HtmlMotionBlockSlot = {
  id: string;
  label: string;
  kind: 'text' | 'number' | 'color' | 'asset' | 'select' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
};

export type HtmlMotionBlockDefinition = {
  id: string;
  packId: string;
  name: string;
  description: string;
  category: HtmlMotionBlockCategory;
  tags: string[];
  bestFor: string;
  slots: HtmlMotionBlockSlot[];
  requiredStageFeatures: string[];
  outputContract: {
    htmlRegion: boolean;
    usesTimingAttributes: boolean;
    usesPrometheusSeekEvent: boolean;
    assetPlaceholders: string[];
  };
};

export type HtmlMotionBlockRenderResult = {
  block: HtmlMotionBlockDefinition;
  html: string;
  css: string;
  js: string;
  insertHint: 'before-stage-end';
};

const STAGE_REQS = ['data-composition-id', 'data-width', 'data-height', 'data-duration'];

const BLOCKS: HtmlMotionBlockDefinition[] = [
  // ── core ─────────────────────────────────────────────────────────────────
  {
    id: 'timed-caption',
    packId: 'prometheus-core',
    name: 'Timed Caption',
    description: 'A HyperFrames-compatible caption block with explicit start/duration timing and role metadata.',
    category: 'captions',
    tags: ['caption', 'subtitle', 'social', 'timed'],
    bestFor: 'Word or phrase captions that should be easy for an agent to patch.',
    slots: [
      { id: 'text', label: 'Caption text', kind: 'text', required: true, default: 'Caption text' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 2 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#facc15' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'lower-third',
    packId: 'prometheus-core',
    name: 'Lower Third',
    description: 'A timed identity/title strip for interviews, tutorials, and launch videos.',
    category: 'layout',
    tags: ['lower-third', 'identity', 'title', 'timed'],
    bestFor: 'Introducing a speaker, product feature, or segment.',
    slots: [
      { id: 'title', label: 'Title', kind: 'text', required: true, default: 'Name or feature' },
      { id: 'subtitle', label: 'Subtitle', kind: 'text', default: 'Short descriptor' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 3 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#38bdf8' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'seekable-canvas',
    packId: 'prometheus-core',
    name: 'Seekable Canvas Hook',
    description: 'A scaffold block for JS/canvas/WebGL effects driven by Prometheus deterministic seek events.',
    category: 'utility',
    tags: ['canvas', 'webgl', 'seek', 'effect'],
    bestFor: 'Custom visualizers, particle fields, shader-like graphics, and animated charts.',
    slots: [
      { id: 'id', label: 'Canvas id', kind: 'text', default: 'motion-canvas' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 5 },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },

  // ── captions pack ────────────────────────────────────────────────────────
  {
    id: 'flow-orb-copy',
    packId: 'prometheus-layout',
    name: 'Flow Orb + Copy',
    description: 'A selectable orb/media object paired with a text region that wraps around it using Prometheus flow exclusion metadata.',
    category: 'layout',
    tags: ['flow', 'pretext', 'exclusion', 'orb', 'copy', 'wrap', 'editable'],
    bestFor: 'PreText-style layouts where a visual object must stay draggable while copy flows around it.',
    slots: [
      { id: 'copy', label: 'Flow copy', kind: 'text', required: true, default: 'Prometheus makes typography measurable before pixels are drawn, so text can flow around objects instead of sitting in boxes.' },
      { id: 'orbLabel', label: 'Orb label', kind: 'text', default: 'FLOW OBJECT' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 6 },
      { id: 'accent', label: 'Orb color', kind: 'color', default: '#a3ff12' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'ascii-source-canvas',
    packId: 'prometheus-ascii',
    name: 'ASCII Source Canvas',
    description: 'A source-backed ASCII smart layer that converts an image/video/logo asset into animated glyph fields with reveal, glitch, CRT, and deterministic seek support.',
    category: 'media',
    tags: ['ascii', 'source', 'canvas', 'video', 'logo', 'glitch', 'crt', 'seek'],
    bestFor: 'Logo reveals, portrait/product ASCII treatments, terminal cinema backgrounds, and HyperFrames-style clips that need source-driven character art.',
    slots: [
      { id: 'id', label: 'Canvas id', kind: 'text', default: 'ascii-source-canvas' },
      { id: 'sourceAssetId', label: 'Source asset id', kind: 'asset', required: true, default: 'source' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 6 },
      { id: 'glyphSet', label: 'Glyph set', kind: 'select', default: 'ascii', options: ['ascii', 'binary', 'blocks', 'braille', 'katakana'] },
      { id: 'palette', label: 'Palette', kind: 'select', default: 'neon', options: ['neon', 'phosphor', 'mono', 'inferno'] },
      { id: 'reveal', label: 'Reveal mode', kind: 'select', default: 'scramble', options: ['scramble', 'scan', 'iris'] },
      { id: 'density', label: 'Density', kind: 'number', default: 0.72 },
      { id: 'glitch', label: 'Glitch', kind: 'number', default: 0.45 },
      { id: 'bloom', label: 'Bloom', kind: 'number', default: 0.65 },
      { id: 'fit', label: 'Fit', kind: 'select', default: 'cover', options: ['cover', 'contain'] },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: ['source'] },
  },
  {
    id: 'punch-caption',
    packId: 'prometheus-captions',
    name: 'Punch Caption',
    description: 'High-energy single-word punch caption with scale-bounce keyframes for short-form social.',
    category: 'captions',
    tags: ['caption', 'punch', 'tiktok', 'short-form'],
    bestFor: 'Hook words and emphasis beats — “BOOM”, “WAIT”, “NEW”.',
    slots: [
      { id: 'text', label: 'Word', kind: 'text', required: true, default: 'BOOM' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 0.7 },
      { id: 'color', label: 'Text color', kind: 'color', default: '#ffffff' },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#ef4444' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'karaoke-caption',
    packId: 'prometheus-captions',
    name: 'Karaoke Caption',
    description: 'Multi-word caption that highlights one word at a time using staggered timed spans.',
    category: 'captions',
    tags: ['caption', 'karaoke', 'highlight', 'timed'],
    bestFor: 'Voiceover-driven content where each word should pop in sync with audio.',
    slots: [
      { id: 'words', label: 'Words (comma-separated)', kind: 'text', required: true, default: 'BUILD,SHIP,WIN' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'wordDuration', label: 'Per-word seconds', kind: 'number', default: 0.45 },
      { id: 'accent', label: 'Highlight color', kind: 'color', default: '#22d3ee' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'subtitle-bar',
    packId: 'prometheus-captions',
    name: 'Subtitle Bar',
    description: 'A neutral subtitle strip with two-line wrap, ideal for documentary-style narration.',
    category: 'captions',
    tags: ['caption', 'subtitle', 'documentary'],
    bestFor: 'Long-form narration captions that need to stay readable for several seconds.',
    slots: [
      { id: 'text', label: 'Subtitle text', kind: 'text', required: true, default: 'A clear narration line for the viewer.' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 4 },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },

  // ── product pack ─────────────────────────────────────────────────────────
  {
    id: 'app-frame',
    packId: 'prometheus-product',
    name: 'App Frame',
    description: 'A browser-style product frame with traffic-light controls and an inner content slot.',
    category: 'product',
    tags: ['product', 'browser', 'frame', 'demo'],
    bestFor: 'Showcasing a desktop app or web dashboard within a stylized chrome.',
    slots: [
      { id: 'title', label: 'Address bar text', kind: 'text', default: 'prometheus.app' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 5 },
      { id: 'image', label: 'Inner image asset', kind: 'asset', default: 'product' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: ['product'] },
  },
  {
    id: 'phone-mockup',
    packId: 'prometheus-product',
    name: 'Phone Mockup',
    description: 'A vertical phone bezel mockup with a media slot for product screen recordings.',
    category: 'product',
    tags: ['product', 'phone', 'mockup', 'mobile'],
    bestFor: 'Mobile-first product walkthroughs in a 9:16 stage.',
    slots: [
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 5 },
      { id: 'image', label: 'Phone screen asset', kind: 'asset', default: 'phone' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: ['phone'] },
  },
  {
    id: 'dashboard-panel',
    packId: 'prometheus-product',
    name: 'Dashboard Flythrough Panel',
    description: 'A blurred glass panel with a metric headline and trend label — pairs well with screen recordings.',
    category: 'product',
    tags: ['product', 'dashboard', 'metric', 'panel'],
    bestFor: 'Calling out a single metric over a dashboard background.',
    slots: [
      { id: 'metric', label: 'Metric value', kind: 'text', required: true, default: '42%' },
      { id: 'label', label: 'Metric label', kind: 'text', default: 'Activation lift' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 4 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#22c55e' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },

  // ── charts pack ──────────────────────────────────────────────────────────
  {
    id: 'count-up-stat',
    packId: 'prometheus-charts',
    name: 'Count-up Stat',
    description: 'A large statistic that counts from 0 to a target value driven by Prometheus seek events.',
    category: 'charts',
    tags: ['chart', 'stat', 'count-up', 'seek'],
    bestFor: 'Highlighting a single big number — ARR, user count, time saved.',
    slots: [
      { id: 'id', label: 'DOM id', kind: 'text', default: 'count-up' },
      { id: 'target', label: 'Target value', kind: 'number', required: true, default: 1000 },
      { id: 'prefix', label: 'Prefix', kind: 'text', default: '' },
      { id: 'suffix', label: 'Suffix', kind: 'text', default: '+' },
      { id: 'label', label: 'Label', kind: 'text', default: 'Active builders' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 2 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#fbbf24' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },
  {
    id: 'bar-race',
    packId: 'prometheus-charts',
    name: 'Bar Race',
    description: 'A canvas bar-chart race driven by seek events — bars grow toward target values.',
    category: 'charts',
    tags: ['chart', 'bar', 'race', 'canvas', 'seek'],
    bestFor: 'Comparing 3–6 entities growing over a duration.',
    slots: [
      { id: 'id', label: 'Canvas id', kind: 'text', default: 'bar-race' },
      { id: 'labels', label: 'Labels (comma)', kind: 'text', default: 'A,B,C,D' },
      { id: 'targets', label: 'Targets (comma)', kind: 'text', default: '60,80,40,100' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 4 },
      { id: 'accent', label: 'Bar color', kind: 'color', default: '#a855f7' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },
  {
    id: 'sparkline-reveal',
    packId: 'prometheus-charts',
    name: 'Sparkline Reveal',
    description: 'An SVG sparkline that draws progressively as the seek time advances.',
    category: 'charts',
    tags: ['chart', 'sparkline', 'reveal', 'svg', 'seek'],
    bestFor: 'A subtle trend reveal for a metric callout.',
    slots: [
      { id: 'id', label: 'DOM id', kind: 'text', default: 'sparkline' },
      { id: 'points', label: 'Points (comma 0–100)', kind: 'text', default: '10,28,22,38,34,52,48,72,66,90' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 3 },
      { id: 'accent', label: 'Stroke color', kind: 'color', default: '#34d399' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },

  // ── transitions pack ────────────────────────────────────────────────────
  {
    id: 'flash-transition',
    packId: 'prometheus-transitions',
    name: 'Flash Transition',
    description: 'A fullscreen white flash that fades in/out over a short window.',
    category: 'transitions',
    tags: ['transition', 'flash', 'cut'],
    bestFor: 'Snappy hard-cut feel between two clip segments.',
    slots: [
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 0.25 },
      { id: 'color', label: 'Flash color', kind: 'color', default: '#ffffff' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'wipe-transition',
    packId: 'prometheus-transitions',
    name: 'Wipe Transition',
    description: 'A diagonal color wipe across the stage.',
    category: 'transitions',
    tags: ['transition', 'wipe', 'diagonal'],
    bestFor: 'Stylized scene change with a single accent color.',
    slots: [
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 0.6 },
      { id: 'color', label: 'Wipe color', kind: 'color', default: '#0ea5e9' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'blur-push-transition',
    packId: 'prometheus-transitions',
    name: 'Blur Push Transition',
    description: 'A blur+slide overlay that pushes content offscreen — ideal for soft scene swaps.',
    category: 'transitions',
    tags: ['transition', 'blur', 'push'],
    bestFor: 'Smooth context shift between two related scenes.',
    slots: [
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 0.7 },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'shader-canvas-transition',
    packId: 'prometheus-transitions',
    name: 'Shader-like Canvas Transition',
    description: 'A canvas-driven noise-dissolve transition driven by seek time — shader-like without WebGL.',
    category: 'transitions',
    tags: ['transition', 'canvas', 'noise', 'dissolve', 'seek'],
    bestFor: 'Premium scene-to-scene transition with controllable timing.',
    slots: [
      { id: 'id', label: 'Canvas id', kind: 'text', default: 'shader-transition' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 0.8 },
      { id: 'color', label: 'Dissolve color', kind: 'color', default: '#0f172a' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },

  // ── cta pack ─────────────────────────────────────────────────────────────
  {
    id: 'end-card',
    packId: 'prometheus-cta',
    name: 'End Card',
    description: 'A full-stage end card with headline, sub-line, and CTA pill — sits at the tail of the clip.',
    category: 'cta',
    tags: ['cta', 'end-card', 'outro'],
    bestFor: 'The final 2–3 seconds of a promo or social cut.',
    slots: [
      { id: 'headline', label: 'Headline', kind: 'text', required: true, default: 'Build with Prometheus' },
      { id: 'subline', label: 'Sub-line', kind: 'text', default: 'Try the agent OS free' },
      { id: 'cta', label: 'CTA text', kind: 'text', default: 'prometheus.app' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 6 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 2 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#f97316' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'button-pulse',
    packId: 'prometheus-cta',
    name: 'Button Pulse',
    description: 'A pill-shaped CTA button that pulses to draw the eye.',
    category: 'cta',
    tags: ['cta', 'button', 'pulse'],
    bestFor: 'Reinforcing a CTA without a full end card.',
    slots: [
      { id: 'label', label: 'Button label', kind: 'text', required: true, default: 'Try it free →' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 4 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 3 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#22d3ee' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'logo-lockup',
    packId: 'prometheus-cta',
    name: 'Logo Lockup',
    description: 'A center-aligned logo + wordmark lockup with optional tagline beneath.',
    category: 'cta',
    tags: ['cta', 'logo', 'lockup', 'brand'],
    bestFor: 'Brand sting at the start or end of a clip.',
    slots: [
      { id: 'wordmark', label: 'Wordmark', kind: 'text', required: true, default: 'PROMETHEUS' },
      { id: 'tagline', label: 'Tagline', kind: 'text', default: 'Build like a god.' },
      { id: 'logo', label: 'Logo asset', kind: 'asset', default: 'logo' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 1.5 },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: ['logo'] },
  },
  {
    id: 'feature-checklist',
    packId: 'prometheus-product',
    name: 'Feature Checklist',
    description: 'A polished checklist card for product benefits, offer inclusions, or launch features.',
    category: 'product',
    tags: ['features', 'checklist', 'benefits', 'card'],
    bestFor: 'Replacing random text blocks with a structured benefit card.',
    slots: [
      { id: 'title', label: 'Card title', kind: 'text', default: 'Everything you need' },
      { id: 'items', label: 'Items (comma)', kind: 'text', default: 'Templates, Captions, Frame QA, MP4 export' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 2 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 4 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#34d399' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'notification-stack',
    packId: 'prometheus-product',
    name: 'Notification Stack',
    description: 'Three stacked notification cards that fly in like product activity or automation events.',
    category: 'product',
    tags: ['notifications', 'activity', 'automation', 'stack'],
    bestFor: 'Showing app activity, agent progress, completed tasks, or workflow events.',
    slots: [
      { id: 'item1', label: 'Notification 1', kind: 'text', default: 'Template selected' },
      { id: 'item2', label: 'Notification 2', kind: 'text', default: 'Frame QA passed' },
      { id: 'item3', label: 'Notification 3', kind: 'text', default: 'MP4 ready' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 4 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#f97316' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'icon-burst',
    packId: 'prometheus-layout',
    name: 'Icon Burst',
    description: 'A radial burst of CSS icon tokens around a center mark, useful for energetic hooks.',
    category: 'layout',
    tags: ['icons', 'burst', 'radial', 'accent'],
    bestFor: 'Adding motion energy without drawing random rectangles.',
    slots: [
      { id: 'center', label: 'Center label', kind: 'text', default: 'AI' },
      { id: 'icons', label: 'Icons / labels (comma)', kind: 'text', default: 'Build,Ship,QA,Export' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 3 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#facc15' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'price-offer-card',
    packId: 'prometheus-cta',
    name: 'Price / Offer Card',
    description: 'A high-contrast offer card with price/value, details, and CTA button.',
    category: 'cta',
    tags: ['offer', 'price', 'sale', 'cta'],
    bestFor: 'Paid ads, local business promos, product offers, and limited-time deals.',
    slots: [
      { id: 'label', label: 'Offer label', kind: 'text', default: 'Limited offer' },
      { id: 'price', label: 'Price or value', kind: 'text', default: '50% OFF' },
      { id: 'detail', label: 'Detail', kind: 'text', default: 'Ends Friday at midnight' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 4 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 3 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#ef4444' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'timeline-steps',
    packId: 'prometheus-layout',
    name: 'Timeline Steps',
    description: 'A vertical three-step timeline with numbered nodes and staggered cards.',
    category: 'layout',
    tags: ['steps', 'timeline', 'process', 'tutorial'],
    bestFor: 'Explainers, tutorials, product processes, and workflow demos.',
    slots: [
      { id: 'step1', label: 'Step 1', kind: 'text', default: 'Pick a template' },
      { id: 'step2', label: 'Step 2', kind: 'text', default: 'Fill the brief' },
      { id: 'step3', label: 'Step 3', kind: 'text', default: 'Export the video' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 5 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#38bdf8' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'gradient-wipe-transition',
    packId: 'prometheus-transitions',
    name: 'Gradient Wipe Transition',
    description: 'A colorful full-stage wipe with soft edges for moving between acts.',
    category: 'transitions',
    tags: ['wipe', 'gradient', 'transition', 'act-break'],
    bestFor: 'Making HTML motion clips feel edited instead of static.',
    slots: [
      { id: 'start', label: 'Start seconds', kind: 'number', default: 3 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 0.65 },
      { id: 'from', label: 'Gradient color 1', kind: 'color', default: '#f97316' },
      { id: 'to', label: 'Gradient color 2', kind: 'color', default: '#facc15' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'browser-workspace-frame',
    packId: 'prometheus-product-demo',
    name: 'Browser Workspace Frame',
    description: 'A Claude-style product workspace shell with top toolbar, side panel, preview area, and optional right rail.',
    category: 'product',
    tags: ['browser', 'workspace', 'product-demo', 'toolbar', 'shell'],
    bestFor: 'Hero shots in product-launch films and AI workspace demos.',
    slots: [
      { id: 'title', label: 'Window title', kind: 'text', default: 'Prometheus Design' },
      { id: 'leftTitle', label: 'Left panel title', kind: 'text', default: 'Build panel' },
      { id: 'previewTitle', label: 'Preview title', kind: 'text', default: 'Live Preview' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 8 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#d97757' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'chat-build-panel',
    packId: 'prometheus-product-demo',
    name: 'Chat Build Panel',
    description: 'AI chat/sidebar panel with prompt bubble and animated plan checklist.',
    category: 'product',
    tags: ['chat', 'ai', 'build-panel', 'checklist', 'prompt'],
    bestFor: 'Showing how the AI interprets a user request before producing an artifact.',
    slots: [
      { id: 'prompt', label: 'Prompt text', kind: 'text', default: 'Create an interactive product demo with editable controls.' },
      { id: 'step1', label: 'Step 1', kind: 'text', default: 'Plan the scene' },
      { id: 'step2', label: 'Step 2', kind: 'text', default: 'Generate the artifact' },
      { id: 'step3', label: 'Step 3', kind: 'text', default: 'Expose knobs' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 5 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#d97757' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'tweak-panel',
    packId: 'prometheus-product-demo',
    name: 'Tweak Panel',
    description: 'Right-side knobs panel with labeled slider controls for generated artifacts.',
    category: 'product',
    tags: ['knobs', 'tweaks', 'sliders', 'controls', 'parameters'],
    bestFor: 'Making generated artifacts feel editable and system-driven.',
    slots: [
      { id: 'title', label: 'Panel title', kind: 'text', default: 'Knobs' },
      { id: 'rows', label: 'Rows label:value comma list', kind: 'text', default: 'Arc glow:78, Density:64, Pulse speed:82' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 3 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 5 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#d97757' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'cursor-path',
    packId: 'prometheus-product-demo',
    name: 'Cursor Path',
    description: 'A seekable cursor layer with human-ish movement and click ripple.',
    category: 'layout',
    tags: ['cursor', 'click', 'interaction', 'demo', 'path'],
    bestFor: 'Making product demos feel interactive and real.',
    slots: [
      { id: 'start', label: 'Start seconds', kind: 'number', default: 1 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 8 },
      { id: 'accent', label: 'Click ripple color', kind: 'color', default: '#d97757' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },
  {
    id: 'artifact-gallery',
    packId: 'prometheus-product-demo',
    name: 'Artifact Gallery',
    description: 'A four-card montage grid of generated artifacts for launch videos.',
    category: 'product',
    tags: ['gallery', 'montage', 'artifacts', 'grid'],
    bestFor: 'Capability montage sections that show breadth without needing real screenshots.',
    slots: [
      { id: 'headline', label: 'Headline', kind: 'text', default: 'Generated artifacts, ready to refine.' },
      { id: 'items', label: 'Items (comma)', kind: 'text', default: 'Mobile app, Dashboard, Brand board, Interactive map' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 8 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 5 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#d97757' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'export-agent-modal',
    packId: 'prometheus-product-demo',
    name: 'Export to Agent Modal',
    description: 'Modal for sending a generated design/artifact to a local coding agent.',
    category: 'cta',
    tags: ['export', 'agent', 'handoff', 'modal', 'code'],
    bestFor: 'Ending AI design/product demos with a clear implementation handoff.',
    slots: [
      { id: 'title', label: 'Modal title', kind: 'text', default: 'Send to local coding agent' },
      { id: 'body', label: 'Body copy', kind: 'text', default: 'Implement this design in the current workspace.' },
      { id: 'command', label: 'Command', kind: 'text', default: 'prometheus fetch Interactive Globe.html --implement' },
      { id: 'cta', label: 'CTA', kind: 'text', default: 'Export handoff' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 12 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 4 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#d97757' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'progress-bar',
    packId: 'prometheus-utility',
    name: 'Seekable Progress Bar',
    description: 'A deterministic top or bottom progress bar driven by Prometheus seek time.',
    category: 'utility',
    tags: ['progress', 'bar', 'timeline', 'seek', 'timer'],
    bestFor: 'Short-form videos, tutorials, and product walkthroughs that need visible progress.',
    slots: [
      { id: 'id', label: 'Element id', kind: 'text', default: 'prom-progress-bar' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 8 },
      { id: 'position', label: 'Position', kind: 'select', default: 'bottom', options: ['top', 'bottom'] },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#22d3ee' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },
  {
    id: 'waveform-audiogram',
    packId: 'prometheus-audio',
    name: 'Waveform Audiogram',
    description: 'A seekable canvas waveform/audiogram layer for narration, music, and podcast-style clips.',
    category: 'media',
    tags: ['audio', 'waveform', 'audiogram', 'canvas', 'seek'],
    bestFor: 'Talking-head clips, narration videos, music previews, and audio-reactive overlays.',
    slots: [
      { id: 'id', label: 'Canvas id', kind: 'text', default: 'prom-waveform' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 8 },
      { id: 'bars', label: 'Bars', kind: 'number', default: 64 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#f97316' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },
  {
    id: 'social-overlay',
    packId: 'prometheus-social',
    name: 'Social Overlay',
    description: 'Platform-style handle, metric, and CTA overlay for short-form social proof.',
    category: 'layout',
    tags: ['social', 'overlay', 'handle', 'likes', 'short-form'],
    bestFor: 'TikTok/Reels/Shorts-style ads that need native social framing without relying on platform screenshots.',
    slots: [
      { id: 'handle', label: 'Handle', kind: 'text', default: '@prometheus' },
      { id: 'metric', label: 'Metric', kind: 'text', default: '24.8K' },
      { id: 'cta', label: 'CTA', kind: 'text', default: 'Tap to build' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 8 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#f43f5e' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: false, assetPlaceholders: [] },
  },
  {
    id: 'html-in-canvas-card',
    packId: 'prometheus-experimental',
    name: 'HTML-in-Canvas Card',
    description: 'Experimental WICG HTML-in-Canvas block that draws a real DOM card into canvas when supported, with a normal DOM fallback.',
    category: 'experimental',
    tags: ['html-in-canvas', 'wicg', 'canvas', 'dom-texture', 'experimental', 'shader'],
    bestFor: 'Testing rich HTML cards as canvas textures for shader transitions, 3D surfaces, and future video export workflows.',
    slots: [
      { id: 'id', label: 'Canvas id', kind: 'text', default: 'prom-html-canvas-card' },
      { id: 'headline', label: 'Headline', kind: 'text', default: 'DOM as texture' },
      { id: 'body', label: 'Body', kind: 'text', default: 'Experimental HTML-in-Canvas with fallback.' },
      { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
      { id: 'duration', label: 'Duration seconds', kind: 'number', default: 4 },
      { id: 'accent', label: 'Accent color', kind: 'color', default: '#22d3ee' },
    ],
    requiredStageFeatures: STAGE_REQS,
    outputContract: { htmlRegion: true, usesTimingAttributes: true, usesPrometheusSeekEvent: true, assetPlaceholders: [] },
  },
];

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slotValue(input: Record<string, any>, id: string, fallback: any = ''): string {
  const value = input?.[id];
  if (value === undefined || value === null || value === '') return String(fallback ?? '');
  return String(value);
}

function slotNumber(input: Record<string, any>, id: string, fallback: number): number {
  const numeric = Number(input?.[id]);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function seconds(input: Record<string, any>, id: string, fallback: number): string {
  return `${slotNumber(input, id, fallback)}s`;
}

function csvList(input: Record<string, any>, id: string, fallback: string[]): string[] {
  const raw = String(input?.[id] ?? '').trim();
  if (!raw) return fallback.slice();
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

function normalizeBlockSearchText(value: any): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function listHtmlMotionBlocks(filters: { category?: string; query?: string; packId?: string } = {}, storage?: CreativeStorageLike | null) {
  const query = String(filters.query || '').trim().toLowerCase();
  const normalizedQuery = normalizeBlockSearchText(query);
  const queryTokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];
  const category = String(filters.category || '').trim().toLowerCase();
  const packId = String(filters.packId || '').trim().toLowerCase();
  const customBlocks = listCustomHtmlMotionBlocks(storage).map((block) => ({
    id: block.id,
    packId: block.packId,
    name: block.name,
    description: block.description,
    category: block.category as HtmlMotionBlockCategory,
    tags: block.tags,
    bestFor: block.bestFor,
    slots: block.slots,
    requiredStageFeatures: block.requiredStageFeatures,
    outputContract: block.outputContract,
    source: 'custom' as const,
    manifestPath: block.manifestPath || null,
    manifestPathRelative: block.manifestPathRelative || null,
  }));
  return [...BLOCKS.map((block) => ({ ...block, source: 'builtin' as const })), ...customBlocks].filter((block) => {
    if (category && block.category !== category) return false;
    if (packId && block.packId !== packId) return false;
    if (!query) return true;
    const haystack = [block.id, block.name, block.description, block.bestFor, block.category, ...block.tags].join(' ').toLowerCase();
    const normalizedHaystack = normalizeBlockSearchText(haystack);
    return haystack.includes(query) || (normalizedQuery ? normalizedHaystack.includes(normalizedQuery) : false) || queryTokens.every((token) => normalizedHaystack.includes(token));
  });
}

type Renderer = (block: HtmlMotionBlockDefinition, input: Record<string, any>) => Omit<HtmlMotionBlockRenderResult, 'block' | 'insertHint'>;

const RENDERERS: Record<string, Renderer> = {
  'timed-caption': (_block, input) => {
    const text = escapeHtml(slotValue(input, 'text', 'Caption text'));
    const accent = escapeHtml(slotValue(input, 'accent', '#facc15'));
    return {
      html: `<div class="prom-block prom-caption" data-role="caption" data-caption="${text}" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 2)}"><span>${text}</span></div>`,
      css: `.prom-caption{position:absolute;left:7%;right:7%;bottom:14%;text-align:center;font:900 76px/1.02 Inter,system-ui,sans-serif;color:#fff;text-shadow:0 8px 28px rgba(0,0,0,.45)}.prom-caption span{display:inline-block;padding:.14em .24em;border-radius:18px;background:linear-gradient(180deg,${accent},#fff0 180%);color:#111827}`,
      js: '',
    };
  },
  'lower-third': (_block, input) => {
    const title = escapeHtml(slotValue(input, 'title', 'Name or feature'));
    const subtitle = escapeHtml(slotValue(input, 'subtitle', 'Short descriptor'));
    const accent = escapeHtml(slotValue(input, 'accent', '#38bdf8'));
    return {
      html: `<section class="prom-block prom-lower-third" data-role="lower-third" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 3)}"><b>${title}</b><span>${subtitle}</span></section>`,
      css: `.prom-lower-third{position:absolute;left:6%;right:6%;bottom:8%;display:grid;gap:8px;padding:24px 28px;border-left:8px solid ${accent};border-radius:20px;background:rgba(15,23,42,.78);backdrop-filter:blur(18px);color:#fff;box-shadow:0 22px 70px rgba(0,0,0,.28)}.prom-lower-third b{font:850 44px/1.05 Inter,system-ui,sans-serif}.prom-lower-third span{font:650 25px/1.25 Inter,system-ui,sans-serif;color:rgba(255,255,255,.72)}`,
      js: '',
    };
  },
  'seekable-canvas': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'motion-canvas'));
    return {
      html: `<canvas id="${id}" class="prom-block prom-seekable-canvas" data-role="visualizer" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 5)}"></canvas>`,
      css: `.prom-seekable-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}`,
      js: `<script>(function(){const canvas=document.getElementById('${id}');if(!canvas)return;const ctx=canvas.getContext('2d');function draw(t){const r=canvas.getBoundingClientRect();canvas.width=Math.max(1,Math.round(r.width));canvas.height=Math.max(1,Math.round(r.height));ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111827';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#38bdf8';ctx.beginPath();ctx.arc(canvas.width/2+Math.sin(t)*canvas.width*.22,canvas.height/2,Math.max(24,canvas.width*.055),0,Math.PI*2);ctx.fill();}window.addEventListener('prometheus-html-motion-seek',e=>draw(Number(e.detail&&e.detail.timeSeconds)||0));draw(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__||0);})();</script>`,
    };
  },
  'flow-orb-copy': (_block, input) => {
    const copy = escapeHtml(slotValue(input, 'copy', 'Prometheus makes typography measurable before pixels are drawn, so text can flow around objects instead of sitting in boxes.'));
    const label = escapeHtml(slotValue(input, 'orbLabel', 'FLOW OBJECT'));
    const accent = escapeHtml(slotValue(input, 'accent', '#a3ff12'));
    return {
      html: `<section class="prom-block prom-flow-composition" data-layout-body="flow-region" data-role="flow-text" data-flow-text data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 6)}"><div class="prom-flow-orb" data-role="orb" data-layout-body="flow-object" data-flow-exclusion data-flow-shape="circle" data-layout-priority="70"><span>${label}</span></div><p>${copy}</p></section>`,
      css: `.prom-flow-composition{position:absolute;left:7%;right:7%;top:16%;min-height:720px;color:#f8fafc;font:650 40px/1.18 Inter,system-ui,sans-serif;letter-spacing:0;text-wrap:pretty}.prom-flow-composition p{margin:0;max-width:100%;text-shadow:0 8px 28px rgba(0,0,0,.42)}.prom-flow-orb{position:absolute;left:84px;top:290px;width:320px;height:320px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 36% 31%,#f7ffb0 0%,${accent} 32%,rgba(80,180,20,.64) 58%,rgba(80,180,20,.12) 72%,transparent 74%);box-shadow:0 0 64px ${accent}99,0 0 0 2px ${accent}55;z-index:2}.prom-flow-orb:before{content:'';position:absolute;inset:-28px;border:3px dashed ${accent}88;border-radius:50%;opacity:.78}.prom-flow-orb span{font:950 14px/1 Inter,system-ui,sans-serif;letter-spacing:.22em;color:#1a2508;text-transform:uppercase;text-shadow:none}`,
      js: '',
    };
  },
  'ascii-source-canvas': (_block, input) => {
    const parts = renderAsciiSourceCanvasParts({
      id: slotValue(input, 'id', 'ascii-source-canvas'),
      sourceAssetId: slotValue(input, 'sourceAssetId', 'source'),
      start: slotNumber(input, 'start', 0),
      duration: slotNumber(input, 'duration', 6),
      glyphSet: slotValue(input, 'glyphSet', 'ascii'),
      palette: slotValue(input, 'palette', 'neon'),
      reveal: slotValue(input, 'reveal', 'scramble'),
      density: slotNumber(input, 'density', 0.72),
      glitch: slotNumber(input, 'glitch', 0.45),
      bloom: slotNumber(input, 'bloom', 0.65),
      fit: slotValue(input, 'fit', 'cover'),
    });
    return { html: parts.html, css: parts.css, js: parts.js };
  },
  'punch-caption': (_block, input) => {
    const text = escapeHtml(slotValue(input, 'text', 'BOOM'));
    const color = escapeHtml(slotValue(input, 'color', '#ffffff'));
    const accent = escapeHtml(slotValue(input, 'accent', '#ef4444'));
    return {
      html: `<div class="prom-block prom-punch" data-role="caption" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 0.7)}"><span>${text}</span></div>`,
      css: `.prom-punch{position:absolute;inset:0;display:grid;place-items:center;font:900 168px/1 Inter,system-ui,sans-serif;color:${color};text-shadow:0 8px 0 ${accent},0 0 60px rgba(0,0,0,.55);letter-spacing:-.04em;animation:prom-punch-pop .42s cubic-bezier(.22,1.4,.36,1) both}.prom-punch span{display:inline-block;transform-origin:center}@keyframes prom-punch-pop{0%{transform:scale(.5);opacity:0}55%{transform:scale(1.18);opacity:1}100%{transform:scale(1);opacity:1}}`,
      js: '',
    };
  },
  'karaoke-caption': (_block, input) => {
    const words = csvList(input, 'words', ['BUILD', 'SHIP', 'WIN']);
    const start = slotNumber(input, 'start', 0);
    const each = Math.max(0.05, slotNumber(input, 'wordDuration', 0.45));
    const accent = escapeHtml(slotValue(input, 'accent', '#22d3ee'));
    const spans = words
      .map((word, i) => `<span data-role="word" data-track-index="1" data-start="${(start + i * each).toFixed(2)}s" data-duration="${each}s">${escapeHtml(word)}</span>`)
      .join('');
    return {
      html: `<div class="prom-block prom-karaoke" data-role="caption" data-start="${start}s" data-duration="${(words.length * each).toFixed(2)}s">${spans}</div>`,
      css: `.prom-karaoke{position:absolute;left:6%;right:6%;bottom:18%;display:flex;gap:.4em;flex-wrap:wrap;justify-content:center;font:900 84px/1 Inter,system-ui,sans-serif;color:rgba(255,255,255,.55);text-shadow:0 6px 22px rgba(0,0,0,.45)}.prom-karaoke span{display:inline-block;padding:.06em .18em;border-radius:14px;transition:color .12s,background .12s,transform .18s}.prom-karaoke span[data-active="true"]{color:#0f172a;background:${accent};transform:translateY(-4px) scale(1.04)}`,
      js: '',
    };
  },
  'subtitle-bar': (_block, input) => {
    const text = escapeHtml(slotValue(input, 'text', 'A clear narration line for the viewer.'));
    return {
      html: `<div class="prom-block prom-subtitle" data-role="subtitle" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 4)}"><p>${text}</p></div>`,
      css: `.prom-subtitle{position:absolute;left:8%;right:8%;bottom:6%;display:flex;justify-content:center;pointer-events:none}.prom-subtitle p{margin:0;padding:14px 22px;border-radius:14px;background:rgba(2,6,23,.72);color:#f8fafc;font:600 32px/1.3 Inter,system-ui,sans-serif;text-align:center;max-width:min(900px,86%);backdrop-filter:blur(10px)}`,
      js: '',
    };
  },
  'app-frame': (_block, input) => {
    const title = escapeHtml(slotValue(input, 'title', 'prometheus.app'));
    return {
      html: `<figure class="prom-block prom-app-frame" data-role="product" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 5)}"><header><i></i><i></i><i></i><b>${title}</b></header><div class="prom-app-frame__body" style="background-image:url('{{asset.product}}')"></div></figure>`,
      css: `.prom-app-frame{position:absolute;left:8%;right:8%;top:14%;bottom:14%;margin:0;border-radius:22px;overflow:hidden;box-shadow:0 38px 90px rgba(2,6,23,.45);background:#0b1220}.prom-app-frame header{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#111827;color:rgba(248,250,252,.78);font:600 14px/1 Inter,system-ui,sans-serif}.prom-app-frame header i{width:12px;height:12px;border-radius:50%;background:#475569}.prom-app-frame header i:nth-child(1){background:#ef4444}.prom-app-frame header i:nth-child(2){background:#fbbf24}.prom-app-frame header i:nth-child(3){background:#22c55e}.prom-app-frame header b{margin-left:14px;font-weight:600;letter-spacing:.02em}.prom-app-frame__body{flex:1;height:calc(100% - 40px);background-size:cover;background-position:center;background-color:#0f172a}`,
      js: '',
    };
  },
  'phone-mockup': (_block, input) => {
    return {
      html: `<figure class="prom-block prom-phone" data-role="product" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 5)}"><div class="prom-phone__bezel"><div class="prom-phone__notch"></div><img alt="" src="{{asset.phone}}"/></div></figure>`,
      css: `.prom-phone{position:absolute;left:50%;top:50%;width:46%;aspect-ratio:9/19.5;margin:0;transform:translate(-50%,-50%)}.prom-phone__bezel{position:relative;width:100%;height:100%;border-radius:48px;background:#0b0f1a;box-shadow:0 30px 80px rgba(2,6,23,.55),inset 0 0 0 4px #1e293b;overflow:hidden}.prom-phone__notch{position:absolute;top:14px;left:50%;width:38%;height:26px;border-radius:18px;background:#000;transform:translateX(-50%);z-index:2}.prom-phone img{position:absolute;inset:8px;width:calc(100% - 16px);height:calc(100% - 16px);object-fit:cover;border-radius:40px;background:#1e293b}`,
      js: '',
    };
  },
  'dashboard-panel': (_block, input) => {
    const metric = escapeHtml(slotValue(input, 'metric', '42%'));
    const label = escapeHtml(slotValue(input, 'label', 'Activation lift'));
    const accent = escapeHtml(slotValue(input, 'accent', '#22c55e'));
    return {
      html: `<aside class="prom-block prom-dash" data-role="metric" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 4)}"><b>${metric}</b><span>${label}</span></aside>`,
      css: `.prom-dash{position:absolute;right:6%;top:10%;padding:24px 30px;border-radius:22px;background:rgba(15,23,42,.62);backdrop-filter:blur(22px);box-shadow:0 24px 60px rgba(2,6,23,.45);color:#fff;display:grid;gap:6px;border:1px solid rgba(255,255,255,.08)}.prom-dash b{font:900 64px/1 Inter,system-ui,sans-serif;color:${accent};letter-spacing:-.02em}.prom-dash span{font:600 18px/1.2 Inter,system-ui,sans-serif;color:rgba(248,250,252,.72)}`,
      js: '',
    };
  },
  'count-up-stat': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'count-up'));
    const target = slotNumber(input, 'target', 1000);
    const prefix = escapeHtml(slotValue(input, 'prefix', ''));
    const suffix = escapeHtml(slotValue(input, 'suffix', '+'));
    const label = escapeHtml(slotValue(input, 'label', 'Active builders'));
    const start = slotNumber(input, 'start', 0);
    const dur = Math.max(0.1, slotNumber(input, 'duration', 2));
    const accent = escapeHtml(slotValue(input, 'accent', '#fbbf24'));
    return {
      html: `<div id="${id}" class="prom-block prom-countup" data-role="stat" data-start="${start}s" data-duration="${dur}s"><b><i data-prefix>${prefix}</i><i data-value>0</i><i data-suffix>${suffix}</i></b><span>${label}</span></div>`,
      css: `.prom-countup{position:absolute;inset:0;display:grid;place-items:center;align-content:center;color:#fff;text-align:center;gap:8px}.prom-countup b{font:900 200px/1 Inter,system-ui,sans-serif;color:${accent};letter-spacing:-.04em;display:inline-flex;align-items:baseline;justify-content:center}.prom-countup b i{font-style:normal}.prom-countup span{font:700 26px/1.2 Inter,system-ui,sans-serif;color:rgba(248,250,252,.78);text-transform:uppercase;letter-spacing:.16em}`,
      js: `<script>(function(){var el=document.getElementById('${id}');if(!el)return;var valueEl=el.querySelector('[data-value]');var start=${start},dur=${dur},target=${target};function fmt(n){return Math.round(n).toLocaleString()}function tick(t){var p=Math.max(0,Math.min(1,(t-start)/dur));valueEl.textContent=fmt(target*p)}window.addEventListener('prometheus-html-motion-seek',function(e){tick(Number(e.detail&&e.detail.timeSeconds)||0)});tick(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__||0);})();</script>`,
    };
  },
  'bar-race': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'bar-race'));
    const labels = csvList(input, 'labels', ['A', 'B', 'C', 'D']);
    const targets = csvList(input, 'targets', ['60', '80', '40', '100']).map((n) => Number(n) || 0);
    const start = slotNumber(input, 'start', 0);
    const dur = Math.max(0.1, slotNumber(input, 'duration', 4));
    const accent = escapeHtml(slotValue(input, 'accent', '#a855f7'));
    const labelsJson = JSON.stringify(labels);
    const targetsJson = JSON.stringify(targets);
    return {
      html: `<canvas id="${id}" class="prom-block prom-bar-race" data-role="chart" data-start="${start}s" data-duration="${dur}s"></canvas>`,
      css: `.prom-bar-race{position:absolute;left:8%;right:8%;top:18%;bottom:18%;width:auto;height:auto;display:block}`,
      js: `<script>(function(){var c=document.getElementById('${id}');if(!c)return;var ctx=c.getContext('2d');var labels=${labelsJson};var targets=${targetsJson};var start=${start},dur=${dur};function draw(t){var r=c.getBoundingClientRect();c.width=Math.max(1,Math.round(r.width));c.height=Math.max(1,Math.round(r.height));ctx.clearRect(0,0,c.width,c.height);var p=Math.max(0,Math.min(1,(t-start)/dur));var max=Math.max.apply(null,targets)||1;var n=labels.length;var rowH=c.height/n;ctx.font='600 '+Math.round(rowH*.32)+'px Inter,system-ui,sans-serif';ctx.textBaseline='middle';for(var i=0;i<n;i++){var v=targets[i]*p;var w=(c.width-160)*(v/max);var y=i*rowH+rowH*.18;var h=rowH*.64;ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(120,y,c.width-160,h);ctx.fillStyle='${accent}';ctx.fillRect(120,y,w,h);ctx.fillStyle='#fff';ctx.textAlign='right';ctx.fillText(labels[i],108,y+h/2);ctx.textAlign='left';ctx.fillText(Math.round(v).toString(),124+w,y+h/2);}}window.addEventListener('prometheus-html-motion-seek',function(e){draw(Number(e.detail&&e.detail.timeSeconds)||0)});draw(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__||0);})();</script>`,
    };
  },
  'sparkline-reveal': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'sparkline'));
    const points = csvList(input, 'points', ['10', '28', '22', '38', '34', '52', '48', '72', '66', '90']).map((n) => Number(n) || 0);
    const start = slotNumber(input, 'start', 0);
    const dur = Math.max(0.1, slotNumber(input, 'duration', 3));
    const accent = escapeHtml(slotValue(input, 'accent', '#34d399'));
    const W = 600, H = 180;
    const max = Math.max(...points, 1);
    const stepX = W / Math.max(1, points.length - 1);
    const path = points
      .map((value, i) => {
        const x = (i * stepX).toFixed(1);
        const y = (H - (value / max) * H).toFixed(1);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
    return {
      html: `<svg id="${id}" class="prom-block prom-spark" data-role="chart" data-start="${start}s" data-duration="${dur}s" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path data-spark="line" d="${path}" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      css: `.prom-spark{position:absolute;left:10%;right:10%;top:35%;height:30%;width:auto;display:block;filter:drop-shadow(0 8px 24px rgba(15,23,42,.45))}.prom-spark path{stroke-dasharray:var(--prom-spark-len,2000);stroke-dashoffset:var(--prom-spark-offset,2000)}`,
      js: `<script>(function(){var svg=document.getElementById('${id}');if(!svg)return;var path=svg.querySelector('[data-spark="line"]');var len=path.getTotalLength();svg.style.setProperty('--prom-spark-len',len);var start=${start},dur=${dur};function tick(t){var p=Math.max(0,Math.min(1,(t-start)/dur));svg.style.setProperty('--prom-spark-offset',len*(1-p))}window.addEventListener('prometheus-html-motion-seek',function(e){tick(Number(e.detail&&e.detail.timeSeconds)||0)});tick(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__||0);})();</script>`,
    };
  },
  'flash-transition': (_block, input) => {
    const color = escapeHtml(slotValue(input, 'color', '#ffffff'));
    return {
      html: `<div class="prom-block prom-flash" data-role="transition" data-start="${seconds(input, 'start', 1)}" data-duration="${seconds(input, 'duration', 0.25)}"></div>`,
      css: `.prom-flash{position:absolute;inset:0;background:${color};animation:prom-flash linear both;animation-duration:inherit;pointer-events:none}@keyframes prom-flash{0%{opacity:0}40%{opacity:1}100%{opacity:0}}`,
      js: '',
    };
  },
  'wipe-transition': (_block, input) => {
    const color = escapeHtml(slotValue(input, 'color', '#0ea5e9'));
    return {
      html: `<div class="prom-block prom-wipe" data-role="transition" data-start="${seconds(input, 'start', 1)}" data-duration="${seconds(input, 'duration', 0.6)}"><span></span></div>`,
      css: `.prom-wipe{position:absolute;inset:0;overflow:hidden;pointer-events:none}.prom-wipe span{position:absolute;inset:-20%;background:${color};transform:translateX(-130%) skewX(-18deg);animation:prom-wipe ease-in-out both;animation-duration:inherit}@keyframes prom-wipe{0%{transform:translateX(-130%) skewX(-18deg)}50%{transform:translateX(0) skewX(-18deg)}100%{transform:translateX(130%) skewX(-18deg)}}`,
      js: '',
    };
  },
  'blur-push-transition': (_block, input) => {
    return {
      html: `<div class="prom-block prom-blur-push" data-role="transition" data-start="${seconds(input, 'start', 1)}" data-duration="${seconds(input, 'duration', 0.7)}"></div>`,
      css: `.prom-blur-push{position:absolute;inset:0;backdrop-filter:blur(0);background:rgba(15,23,42,0);pointer-events:none;animation:prom-blur-push ease-in-out both;animation-duration:inherit}@keyframes prom-blur-push{0%{backdrop-filter:blur(0);background:rgba(15,23,42,0);transform:translateX(0)}50%{backdrop-filter:blur(28px);background:rgba(15,23,42,.55);transform:translateX(0)}100%{backdrop-filter:blur(0);background:rgba(15,23,42,0);transform:translateX(8%)}}`,
      js: '',
    };
  },
  'shader-canvas-transition': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'shader-transition'));
    const start = slotNumber(input, 'start', 1);
    const dur = Math.max(0.1, slotNumber(input, 'duration', 0.8));
    const color = escapeHtml(slotValue(input, 'color', '#0f172a'));
    return {
      html: `<canvas id="${id}" class="prom-block prom-shader" data-role="transition" data-start="${start}s" data-duration="${dur}s"></canvas>`,
      css: `.prom-shader{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}`,
      js: `<script>(function(){var c=document.getElementById('${id}');if(!c)return;var ctx=c.getContext('2d');var start=${start},dur=${dur};function draw(t){var r=c.getBoundingClientRect();var W=c.width=Math.max(1,Math.round(r.width)),H=c.height=Math.max(1,Math.round(r.height));ctx.clearRect(0,0,W,H);var p=Math.max(0,Math.min(1,(t-start)/dur));if(p<=0||p>=1)return;var cells=72;var cw=Math.ceil(W/cells),ch=Math.ceil(H/cells);ctx.fillStyle='${color}';for(var y=0;y<cells;y++){for(var x=0;x<cells;x++){var n=Math.sin(x*12.9898+y*78.233)*43758.5453;var threshold=(n-Math.floor(n));if(threshold<p){ctx.globalAlpha=Math.min(1,(p-threshold)*4);ctx.fillRect(x*cw,y*ch,cw+1,ch+1)}}}ctx.globalAlpha=1}window.addEventListener('prometheus-html-motion-seek',function(e){draw(Number(e.detail&&e.detail.timeSeconds)||0)});draw(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__||0);})();</script>`,
    };
  },
  'end-card': (_block, input) => {
    const headline = escapeHtml(slotValue(input, 'headline', 'Build with Prometheus'));
    const subline = escapeHtml(slotValue(input, 'subline', 'Try the agent OS free'));
    const cta = escapeHtml(slotValue(input, 'cta', 'prometheus.app'));
    const accent = escapeHtml(slotValue(input, 'accent', '#f97316'));
    return {
      html: `<section class="prom-block prom-endcard" data-role="end-card" data-start="${seconds(input, 'start', 6)}" data-duration="${seconds(input, 'duration', 2)}"><h1>${headline}</h1><p>${subline}</p><b>${cta}</b></section>`,
      css: `.prom-endcard{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:18px;text-align:center;background:radial-gradient(ellipse at center,rgba(15,23,42,.0),rgba(2,6,23,.85));color:#fff;padding:0 8%}.prom-endcard h1{margin:0;font:900 110px/1 Inter,system-ui,sans-serif;letter-spacing:-.04em}.prom-endcard p{margin:0;font:600 32px/1.3 Inter,system-ui,sans-serif;color:rgba(248,250,252,.78)}.prom-endcard b{display:inline-block;padding:14px 28px;border-radius:999px;background:${accent};color:#0b0f1a;font:800 30px/1 Inter,system-ui,sans-serif;letter-spacing:.02em}`,
      js: '',
    };
  },
  'button-pulse': (_block, input) => {
    const label = escapeHtml(slotValue(input, 'label', 'Try it free →'));
    const accent = escapeHtml(slotValue(input, 'accent', '#22d3ee'));
    return {
      html: `<button class="prom-block prom-pulse" data-role="cta" data-start="${seconds(input, 'start', 4)}" data-duration="${seconds(input, 'duration', 3)}" type="button">${label}</button>`,
      css: `.prom-pulse{position:absolute;left:50%;bottom:14%;transform:translateX(-50%);padding:18px 38px;border-radius:999px;border:0;background:${accent};color:#0b0f1a;font:800 30px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;box-shadow:0 22px 60px rgba(34,211,238,.45);animation:prom-pulse 1.4s ease-in-out infinite both}@keyframes prom-pulse{0%,100%{transform:translateX(-50%) scale(1);box-shadow:0 22px 60px rgba(34,211,238,.45)}50%{transform:translateX(-50%) scale(1.06);box-shadow:0 28px 80px rgba(34,211,238,.6)}}`,
      js: '',
    };
  },
  'logo-lockup': (_block, input) => {
    const wordmark = escapeHtml(slotValue(input, 'wordmark', 'PROMETHEUS'));
    const tagline = escapeHtml(slotValue(input, 'tagline', 'Build like a god.'));
    return {
      html: `<div class="prom-block prom-lockup" data-role="logo" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 1.5)}"><img alt="" src="{{asset.logo}}"/><b>${wordmark}</b><span>${tagline}</span></div>`,
      css: `.prom-lockup{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:10px;color:#fff;text-align:center}.prom-lockup img{width:96px;height:96px;object-fit:contain;filter:drop-shadow(0 8px 30px rgba(0,0,0,.45))}.prom-lockup b{font:900 64px/1 Inter,system-ui,sans-serif;letter-spacing:.18em}.prom-lockup span{font:500 22px/1.3 Inter,system-ui,sans-serif;color:rgba(248,250,252,.7);letter-spacing:.04em}`,
      js: '',
    };
  },
  'feature-checklist': (_block, input) => {
    const title = escapeHtml(slotValue(input, 'title', 'Everything you need'));
    const items = csvList(input, 'items', ['Templates', 'Captions', 'Frame QA', 'MP4 export']);
    const accent = escapeHtml(slotValue(input, 'accent', '#34d399'));
    const rows = items.map((item, i) => `<li style="animation-delay:${(0.12 + i * 0.12).toFixed(2)}s"><span>&#10003;</span>${escapeHtml(item)}</li>`).join('');
    return {
      html: `<section class="prom-block prom-feature-list" data-role="feature-card" data-start="${seconds(input, 'start', 2)}" data-duration="${seconds(input, 'duration', 4)}"><h3>${title}</h3><ul>${rows}</ul></section>`,
      css: `.prom-feature-list{position:absolute;left:7%;right:7%;top:48%;padding:34px;border-radius:30px;background:rgba(255,255,255,.1);backdrop-filter:blur(22px);border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 80px rgba(2,6,23,.35);color:#fff}.prom-feature-list h3{margin:0 0 22px;font:900 42px/1 Inter,system-ui,sans-serif;letter-spacing:-.02em}.prom-feature-list ul{margin:0;padding:0;display:grid;gap:14px;list-style:none}.prom-feature-list li{display:flex;align-items:center;gap:14px;font:750 30px/1.15 Inter,system-ui,sans-serif;animation:prom-list-in .42s both}.prom-feature-list span{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:${accent};color:#07111f;font:950 22px/1 Inter,sans-serif}@keyframes prom-list-in{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:translateX(0)}}`,
      js: '',
    };
  },
  'notification-stack': (_block, input) => {
    const items = [
      escapeHtml(slotValue(input, 'item1', 'Template selected')),
      escapeHtml(slotValue(input, 'item2', 'Frame QA passed')),
      escapeHtml(slotValue(input, 'item3', 'MP4 ready')),
    ];
    const accent = escapeHtml(slotValue(input, 'accent', '#f97316'));
    return {
      html: `<div class="prom-block prom-notify-stack" data-role="activity" data-start="${seconds(input, 'start', 1)}" data-duration="${seconds(input, 'duration', 4)}">${items.map((item, i) => `<div class="prom-note" style="--i:${i}"><b></b><span>${item}</span></div>`).join('')}</div>`,
      css: `.prom-notify-stack{position:absolute;left:8%;right:8%;top:34%;display:grid;gap:18px}.prom-note{display:flex;align-items:center;gap:18px;padding:24px 26px;border-radius:24px;background:rgba(15,23,42,.82);border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 60px rgba(2,6,23,.34);color:#fff;font:800 30px/1.1 Inter,system-ui,sans-serif;animation:prom-note-in .48s calc(var(--i)*.22s) both}.prom-note b{width:18px;height:18px;border-radius:50%;background:${accent};box-shadow:0 0 28px ${accent}}@keyframes prom-note-in{from{opacity:0;transform:translateY(30px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}`,
      js: '',
    };
  },
  'icon-burst': (_block, input) => {
    const center = escapeHtml(slotValue(input, 'center', 'AI'));
    const icons = csvList(input, 'icons', ['Build', 'Ship', 'QA', 'Export']).slice(0, 8);
    const accent = escapeHtml(slotValue(input, 'accent', '#facc15'));
    const nodes = icons.map((item, i) => `<span style="--n:${i};--total:${icons.length}">${escapeHtml(item)}</span>`).join('');
    return {
      html: `<div class="prom-block prom-icon-burst" data-role="graphic" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 3)}"><strong>${center}</strong>${nodes}</div>`,
      css: `.prom-icon-burst{position:absolute;left:50%;top:42%;width:560px;height:560px;transform:translate(-50%,-50%);display:grid;place-items:center}.prom-icon-burst strong{display:grid;place-items:center;width:170px;height:170px;border-radius:44px;background:${accent};color:#0b0f1a;font:950 54px/1 Inter,system-ui,sans-serif;box-shadow:0 28px 90px rgba(0,0,0,.38);animation:scalePop .55s both}.prom-icon-burst span{position:absolute;left:50%;top:50%;padding:12px 16px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font:850 22px/1 Inter,system-ui,sans-serif;transform:rotate(calc(360deg/var(--total)*var(--n))) translate(250px) rotate(calc(-360deg/var(--total)*var(--n)));animation:prom-burst .7s calc(var(--n)*.07s) both}@keyframes prom-burst{from{opacity:0;transform:rotate(calc(360deg/var(--total)*var(--n))) translate(90px) rotate(calc(-360deg/var(--total)*var(--n))) scale(.7)}to{opacity:1}}`,
      js: '',
    };
  },
  'price-offer-card': (_block, input) => {
    const label = escapeHtml(slotValue(input, 'label', 'Limited offer'));
    const price = escapeHtml(slotValue(input, 'price', '50% OFF'));
    const detail = escapeHtml(slotValue(input, 'detail', 'Ends Friday at midnight'));
    const accent = escapeHtml(slotValue(input, 'accent', '#ef4444'));
    return {
      html: `<section class="prom-block prom-offer-card" data-role="offer" data-start="${seconds(input, 'start', 4)}" data-duration="${seconds(input, 'duration', 3)}"><small>${label}</small><b>${price}</b><p>${detail}</p></section>`,
      css: `.prom-offer-card{position:absolute;left:8%;right:8%;bottom:11%;padding:34px;border-radius:34px;background:${accent};color:#fff;text-align:center;box-shadow:0 28px 90px rgba(0,0,0,.38);animation:scalePop .52s both}.prom-offer-card small{display:block;font:900 24px/1 Inter,system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;opacity:.86}.prom-offer-card b{display:block;margin:12px 0;font:950 92px/.92 Inter,system-ui,sans-serif;letter-spacing:-.06em}.prom-offer-card p{margin:0;font:800 30px/1.2 Inter,system-ui,sans-serif}`,
      js: '',
    };
  },
  'timeline-steps': (_block, input) => {
    const steps = [
      escapeHtml(slotValue(input, 'step1', 'Pick a template')),
      escapeHtml(slotValue(input, 'step2', 'Fill the brief')),
      escapeHtml(slotValue(input, 'step3', 'Export the video')),
    ];
    const accent = escapeHtml(slotValue(input, 'accent', '#38bdf8'));
    return {
      html: `<div class="prom-block prom-timeline" data-role="steps" data-start="${seconds(input, 'start', 1)}" data-duration="${seconds(input, 'duration', 5)}">${steps.map((step, i) => `<div class="prom-step" style="--i:${i}"><i>${i + 1}</i><span>${step}</span></div>`).join('')}</div>`,
      css: `.prom-timeline{position:absolute;left:9%;right:9%;top:32%;display:grid;gap:26px}.prom-timeline:before{content:'';position:absolute;left:30px;top:20px;bottom:20px;width:4px;background:${accent};opacity:.55}.prom-step{position:relative;display:flex;align-items:center;gap:24px;padding:26px 30px 26px 0;color:#fff;font:850 34px/1.1 Inter,system-ui,sans-serif;animation:slideInLeft .48s calc(var(--i)*.22s) both}.prom-step i{z-index:1;display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:${accent};color:#07111f;font:950 28px/1 Inter,system-ui,sans-serif;font-style:normal;box-shadow:0 0 34px rgba(56,189,248,.35)}.prom-step span{padding:22px 26px;border-radius:22px;background:rgba(255,255,255,.1);backdrop-filter:blur(16px);flex:1}`,
      js: '',
    };
  },
  'gradient-wipe-transition': (_block, input) => {
    const from = escapeHtml(slotValue(input, 'from', '#f97316'));
    const to = escapeHtml(slotValue(input, 'to', '#facc15'));
    return {
      html: `<div class="prom-block prom-gradient-wipe" data-role="transition" data-start="${seconds(input, 'start', 3)}" data-duration="${seconds(input, 'duration', 0.65)}"></div>`,
      css: `.prom-gradient-wipe{position:absolute;inset:-12%;background:linear-gradient(90deg,${from},${to});filter:blur(1px);transform:translateX(-120%) skewX(-16deg);animation:prom-gradient-wipe ease-in-out both;animation-duration:inherit;pointer-events:none}@keyframes prom-gradient-wipe{0%{transform:translateX(-120%) skewX(-16deg)}50%{transform:translateX(0) skewX(-16deg)}100%{transform:translateX(120%) skewX(-16deg)}}`,
      js: '',
    };
  },
  'browser-workspace-frame': (_block, input) => {
    const title = escapeHtml(slotValue(input, 'title', 'Prometheus Design'));
    const leftTitle = escapeHtml(slotValue(input, 'leftTitle', 'Build panel'));
    const previewTitle = escapeHtml(slotValue(input, 'previewTitle', 'Live Preview'));
    const accent = escapeHtml(slotValue(input, 'accent', '#d97757'));
    return {
      html: `<section class="prom-block prom-workspace-frame" data-role="product-workspace" data-start="${seconds(input, 'start', 1)}" data-duration="${seconds(input, 'duration', 8)}"><header><span class="lights"><i></i><i></i><i></i></span><b>${title}</b><nav><em>Tweaks</em><em>Comment</em><em>Knobs</em><em>Export</em></nav></header><div class="cols"><aside>${leftTitle}</aside><main><strong>${previewTitle}</strong></main><section>Controls</section></div></section>`,
      css: `.prom-workspace-frame{position:absolute;inset:6%;border-radius:30px;background:#20201f;color:#f8f1e8;box-shadow:0 42px 120px rgba(0,0,0,.36);overflow:hidden}.prom-workspace-frame header{height:64px;display:flex;align-items:center;gap:16px;padding:0 20px;background:#292826;border-bottom:1px solid rgba(255,255,255,.08)}.prom-workspace-frame .lights{display:flex;gap:8px}.prom-workspace-frame i{width:12px;height:12px;border-radius:50%;background:#7c756d}.prom-workspace-frame i:nth-child(1){background:#d66d55}.prom-workspace-frame i:nth-child(2){background:#e0b85c}.prom-workspace-frame i:nth-child(3){background:#7ba66b}.prom-workspace-frame b{font:850 18px/1 Inter,system-ui,sans-serif}.prom-workspace-frame nav{margin-left:auto;display:flex;gap:10px}.prom-workspace-frame em{font:800 13px/1 Inter,system-ui,sans-serif;font-style:normal;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.08)}.prom-workspace-frame em:first-child{background:${accent};color:#1b1715}.prom-workspace-frame .cols{display:grid;grid-template-columns:22% 1fr 20%;height:calc(100% - 64px)}.prom-workspace-frame aside,.prom-workspace-frame section{padding:26px;background:#2b2a27;font:850 24px/1 Inter,system-ui,sans-serif}.prom-workspace-frame main{position:relative;margin:34px;border-radius:24px;background:linear-gradient(180deg,#171716,#0c0c0c);display:grid;place-items:start;padding:28px}.prom-workspace-frame main strong{font:850 22px/1 Inter,system-ui,sans-serif}`,
      js: '',
    };
  },
  'chat-build-panel': (_block, input) => {
    const prompt = escapeHtml(slotValue(input, 'prompt', 'Create an interactive product demo with editable controls.'));
    const steps = [
      escapeHtml(slotValue(input, 'step1', 'Plan the scene')),
      escapeHtml(slotValue(input, 'step2', 'Generate the artifact')),
      escapeHtml(slotValue(input, 'step3', 'Expose knobs')),
    ];
    const accent = escapeHtml(slotValue(input, 'accent', '#d97757'));
    return {
      html: `<aside class="prom-block prom-chat-build" data-role="build-panel" data-start="${seconds(input, 'start', 1)}" data-duration="${seconds(input, 'duration', 5)}"><h3>Build panel</h3><p>${prompt}</p>${steps.map((step, i) => `<div style="--i:${i}"><span>&#10003;</span>${step}</div>`).join('')}</aside>`,
      css: `.prom-chat-build{position:absolute;left:7%;top:18%;width:360px;padding:26px;border-radius:26px;background:rgba(43,42,39,.92);color:#f8f1e8;box-shadow:0 28px 80px rgba(0,0,0,.28)}.prom-chat-build h3{margin:0 0 16px;font:850 24px/1 Inter,system-ui,sans-serif}.prom-chat-build p{margin:0 0 22px;padding:18px;border-radius:18px;background:#3a3833;font:650 18px/1.35 Inter,system-ui,sans-serif}.prom-chat-build div{display:flex;gap:10px;align-items:center;margin-top:12px;font:800 16px/1 Inter,system-ui,sans-serif;color:#d9cec0;opacity:0;animation:prom-chat-step .42s calc(var(--i)*.22s) both}.prom-chat-build span{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:${accent};color:#1b1715;font:950 12px/1 Inter,system-ui,sans-serif}@keyframes prom-chat-step{to{opacity:1;transform:translateY(0)}from{opacity:0;transform:translateY(12px)}}`,
      js: '',
    };
  },
  'tweak-panel': (_block, input) => {
    const title = escapeHtml(slotValue(input, 'title', 'Knobs'));
    const rows = csvList(input, 'rows', ['Arc glow:78', 'Density:64', 'Pulse speed:82']).slice(0, 6);
    const accent = escapeHtml(slotValue(input, 'accent', '#d97757'));
    const controls = rows.map((row) => {
      const [label, rawValue] = row.split(':');
      const value = Math.max(0, Math.min(100, Number(rawValue) || 65));
      return `<div class="prom-knob"><label><span>${escapeHtml(label || 'Control')}</span><b>${value}%</b></label><i><em style="width:${value}%"></em></i></div>`;
    }).join('');
    return {
      html: `<section class="prom-block prom-tweak-panel" data-role="knobs" data-start="${seconds(input, 'start', 3)}" data-duration="${seconds(input, 'duration', 5)}"><h3>${title}</h3>${controls}</section>`,
      css: `.prom-tweak-panel{position:absolute;right:7%;top:18%;width:320px;padding:26px;border-radius:26px;background:rgba(43,42,39,.92);color:#f8f1e8;box-shadow:0 28px 80px rgba(0,0,0,.28)}.prom-tweak-panel h3{margin:0 0 20px;font:850 24px/1 Inter,system-ui,sans-serif}.prom-knob{margin:0 0 22px}.prom-knob label{display:flex;justify-content:space-between;margin-bottom:9px;font:750 14px/1 Inter,system-ui,sans-serif;color:#d9cec0}.prom-knob i{display:block;height:9px;border-radius:999px;background:#494640;overflow:hidden}.prom-knob em{display:block;height:100%;background:${accent};transform-origin:left;animation:barFill .9s both}@keyframes barFill{from{transform:scaleX(0)}to{transform:scaleX(1)}}`,
      js: '',
    };
  },
  'cursor-path': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'prom-cursor-path'));
    const start = slotNumber(input, 'start', 1);
    const dur = Math.max(0.1, slotNumber(input, 'duration', 8));
    const accent = escapeHtml(slotValue(input, 'accent', '#d97757'));
    return {
      html: `<div id="${id}" class="prom-block prom-cursor-path" data-role="cursor" data-start="${start}s" data-duration="${dur}s"><span></span><i></i></div>`,
      css: `.prom-cursor-path{position:absolute;left:50%;top:50%;z-index:50;width:36px;height:36px;pointer-events:none}.prom-cursor-path span{position:absolute;inset:0;clip-path:polygon(0 0,0 100%,32% 73%,52% 100%,68% 91%,48% 65%,86% 65%);background:#fff;filter:drop-shadow(0 8px 18px rgba(0,0,0,.32))}.prom-cursor-path i{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px;border-radius:50%;border:3px solid ${accent};opacity:0}`,
      js: `<script>(function(){var el=document.getElementById('${id}');if(!el)return;var ripple=el.querySelector('i');var start=${start},dur=${dur};var pts=[[.5,.55],[.32,.22],[.75,.18],[.82,.46],[.48,.72],[.65,.64]];function lerp(a,b,t){return a+(b-a)*t}function tick(time){var p=Math.max(0,Math.min(1,(time-start)/dur));var seg=Math.min(pts.length-2,Math.floor(p*(pts.length-1)));var local=p*(pts.length-1)-seg;var a=pts[seg],b=pts[seg+1];el.style.left=(lerp(a[0],b[0],local)*100)+'%';el.style.top=(lerp(a[1],b[1],local)*100)+'%';var click=Math.abs(p-.35)<.045||Math.abs(p-.7)<.045;ripple.style.opacity=click?String(1-Math.abs((p%0.35)-0.175)*4):'0';ripple.style.transform='scale('+(1+p*1.5)+')'}window.addEventListener('prometheus-html-motion-seek',function(e){tick(Number(e.detail&&e.detail.timeSeconds)||0)});tick(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__||0);})();</script>`,
    };
  },
  'artifact-gallery': (_block, input) => {
    const headline = escapeHtml(slotValue(input, 'headline', 'Generated artifacts, ready to refine.'));
    const items = csvList(input, 'items', ['Mobile app', 'Dashboard', 'Brand board', 'Interactive map']).slice(0, 6);
    const accent = escapeHtml(slotValue(input, 'accent', '#d97757'));
    return {
      html: `<section class="prom-block prom-artifact-gallery" data-role="artifact-gallery" data-start="${seconds(input, 'start', 8)}" data-duration="${seconds(input, 'duration', 5)}"><h2>${headline}</h2><div>${items.map((item, i) => `<article style="--i:${i}"><b>${escapeHtml(item)}</b><span>Generated</span></article>`).join('')}</div></section>`,
      css: `.prom-artifact-gallery{position:absolute;inset:8%;padding:34px;color:#1b1715}.prom-artifact-gallery h2{margin:0 0 30px;font:500 72px/.95 Georgia,serif;letter-spacing:-.04em}.prom-artifact-gallery>div{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}.prom-artifact-gallery article{height:330px;border-radius:28px;background:#fffaf2;box-shadow:0 22px 70px rgba(54,40,30,.15);padding:24px;display:grid;align-content:end;gap:10px;position:relative;overflow:hidden;animation:prom-card-in .5s calc(var(--i)*.12s) both}.prom-artifact-gallery article:before{content:'';position:absolute;left:22px;right:22px;top:22px;height:190px;border-radius:20px;background:linear-gradient(135deg,#1f1f1e,${accent})}.prom-artifact-gallery b{font:850 26px/1 Inter,system-ui,sans-serif;z-index:1}.prom-artifact-gallery span{font:800 14px/1 Inter,system-ui,sans-serif;color:${accent};letter-spacing:.15em;text-transform:uppercase;z-index:1}@keyframes prom-card-in{from{opacity:0;transform:translateY(38px)}to{opacity:1;transform:translateY(0)}}`,
      js: '',
    };
  },
  'export-agent-modal': (_block, input) => {
    const title = escapeHtml(slotValue(input, 'title', 'Send to local coding agent'));
    const body = escapeHtml(slotValue(input, 'body', 'Implement this design in the current workspace.'));
    const command = escapeHtml(slotValue(input, 'command', 'prometheus fetch Interactive Globe.html --implement'));
    const cta = escapeHtml(slotValue(input, 'cta', 'Export handoff'));
    const accent = escapeHtml(slotValue(input, 'accent', '#d97757'));
    return {
      html: `<section class="prom-block prom-agent-modal" data-role="export-modal" data-start="${seconds(input, 'start', 12)}" data-duration="${seconds(input, 'duration', 4)}"><h2>${title}</h2><p>${body}</p><code>${command}</code><b>${cta}</b></section>`,
      css: `.prom-agent-modal{position:absolute;left:50%;top:50%;width:760px;transform:translate(-50%,-50%);padding:38px;border-radius:30px;background:#fffaf2;color:#1b1715;box-shadow:0 34px 120px rgba(30,20,12,.3);animation:scalePop .55s both}.prom-agent-modal h2{margin:0 0 12px;font:850 42px/1 Inter,system-ui,sans-serif}.prom-agent-modal p{margin:0 0 28px;font:650 22px/1.35 Inter,system-ui,sans-serif;color:#746a61}.prom-agent-modal code{display:block;padding:18px 20px;border-radius:16px;background:#191817;color:#f8efe5;font:700 20px/1.35 Courier New,monospace}.prom-agent-modal b{margin-top:26px;display:inline-block;padding:18px 24px;border-radius:999px;background:${accent};font:900 22px/1 Inter,system-ui,sans-serif;color:#1b1715}@keyframes scalePop{0%{transform:translate(-50%,-50%) scale(.88);opacity:0}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}`,
      js: '',
    };
  },
  'progress-bar': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'prom-progress-bar'));
    const start = slotNumber(input, 'start', 0);
    const dur = Math.max(0.1, slotNumber(input, 'duration', 8));
    const position = slotValue(input, 'position', 'bottom') === 'top' ? 'top' : 'bottom';
    const accent = escapeHtml(slotValue(input, 'accent', '#22d3ee'));
    return {
      html: `<div id="${id}" class="prom-block prom-progress prom-progress--${position}" data-role="progress" data-start="${start}s" data-duration="${dur}s"><span></span></div>`,
      css: `.prom-progress{position:absolute;left:0;right:0;${position}:0;height:10px;background:rgba(255,255,255,.16);overflow:hidden;z-index:80}.prom-progress span{display:block;width:100%;height:100%;background:${accent};transform:scaleX(var(--prom-progress,0));transform-origin:left center;box-shadow:0 0 24px ${accent}}`,
      js: `<script>(function(){var el=document.getElementById('${id}');if(!el)return;var start=${start},dur=${dur};function tick(ms){var p=Math.max(0,Math.min(1,(ms/1000-start)/dur));el.style.setProperty('--prom-progress',p.toFixed(4))}window.addEventListener('prometheus-html-motion-seek',function(e){tick(Number(e.detail&&e.detail.timeMs)||window.__PROMETHEUS_HTML_MOTION_TIME_MS__||0)});tick(window.__PROMETHEUS_HTML_MOTION_TIME_MS__||0);})();</script>`,
    };
  },
  'waveform-audiogram': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'prom-waveform'));
    const start = slotNumber(input, 'start', 0);
    const dur = Math.max(0.1, slotNumber(input, 'duration', 8));
    const bars = Math.max(12, Math.min(160, Math.round(slotNumber(input, 'bars', 64))));
    const accent = escapeHtml(slotValue(input, 'accent', '#f97316'));
    return {
      html: `<canvas id="${id}" class="prom-block prom-waveform" data-role="waveform" data-start="${start}s" data-duration="${dur}s"></canvas>`,
      css: `.prom-waveform{position:absolute;left:8%;right:8%;bottom:16%;height:180px;width:auto;display:block;filter:drop-shadow(0 18px 44px rgba(0,0,0,.32))}`,
      js: `<script>(function(){var c=document.getElementById('${id}');if(!c)return;var ctx=c.getContext('2d');var start=${start},dur=${dur},bars=${bars};function draw(ms){var r=c.getBoundingClientRect();var W=c.width=Math.max(1,Math.round(r.width));var H=c.height=Math.max(1,Math.round(r.height));var t=ms/1000;var p=Math.max(0,Math.min(1,(t-start)/dur));ctx.clearRect(0,0,W,H);var gap=3;var bw=Math.max(2,(W-(bars-1)*gap)/bars);for(var i=0;i<bars;i++){var phase=i/bars;var env=Math.sin(Math.PI*Math.min(1,Math.max(0,p*1.15-phase*.15)));var amp=(.25+.75*Math.abs(Math.sin(i*1.91+t*2.4))*env);var h=Math.max(4,H*amp*.86);var x=i*(bw+gap);var y=(H-h)/2;ctx.fillStyle=i/bars<=p?'${accent}':'rgba(255,255,255,.24)';ctx.fillRect(x,y,bw,h)}}window.addEventListener('prometheus-html-motion-seek',function(e){draw(Number(e.detail&&e.detail.timeMs)||window.__PROMETHEUS_HTML_MOTION_TIME_MS__||0)});draw(window.__PROMETHEUS_HTML_MOTION_TIME_MS__||0);})();</script>`,
    };
  },
  'social-overlay': (_block, input) => {
    const handle = escapeHtml(slotValue(input, 'handle', '@prometheus'));
    const metric = escapeHtml(slotValue(input, 'metric', '24.8K'));
    const cta = escapeHtml(slotValue(input, 'cta', 'Tap to build'));
    const accent = escapeHtml(slotValue(input, 'accent', '#f43f5e'));
    return {
      html: `<aside class="prom-block prom-social-overlay" data-role="social-overlay" data-start="${seconds(input, 'start', 0)}" data-duration="${seconds(input, 'duration', 8)}"><div><b>${handle}</b><span>${cta}</span></div><ul><li><i></i>${metric}</li><li><i></i>Save</li><li><i></i>Share</li></ul></aside>`,
      css: `.prom-social-overlay{position:absolute;left:6%;right:6%;bottom:7%;display:flex;align-items:flex-end;justify-content:space-between;color:#fff;z-index:70;text-shadow:0 4px 18px rgba(0,0,0,.55)}.prom-social-overlay div{display:grid;gap:8px;max-width:72%}.prom-social-overlay b{font:900 34px/1 Inter,system-ui,sans-serif}.prom-social-overlay span{font:700 25px/1.25 Inter,system-ui,sans-serif;color:rgba(255,255,255,.86)}.prom-social-overlay ul{margin:0;padding:0;display:grid;gap:16px;list-style:none;text-align:center;font:800 17px/1 Inter,system-ui,sans-serif}.prom-social-overlay li{display:grid;justify-items:center;gap:7px}.prom-social-overlay i{width:48px;height:48px;border-radius:50%;background:${accent};box-shadow:0 12px 30px rgba(0,0,0,.34)}`,
      js: '',
    };
  },
  'html-in-canvas-card': (_block, input) => {
    const id = escapeHtml(slotValue(input, 'id', 'prom-html-canvas-card'));
    const headline = escapeHtml(slotValue(input, 'headline', 'DOM as texture'));
    const body = escapeHtml(slotValue(input, 'body', 'Experimental HTML-in-Canvas with fallback.'));
    const start = slotNumber(input, 'start', 0);
    const dur = Math.max(0.1, slotNumber(input, 'duration', 4));
    const accent = escapeHtml(slotValue(input, 'accent', '#22d3ee'));
    return {
      html: `<canvas id="${id}" class="prom-block prom-html-canvas-card" data-role="html-in-canvas" data-start="${start}s" data-duration="${dur}s" layoutsubtree><article data-html-canvas-source><small>Experimental</small><h2>${headline}</h2><p>${body}</p></article></canvas>`,
      css: `.prom-html-canvas-card{position:absolute;inset:0;width:100%;height:100%;display:block}.prom-html-canvas-card [data-html-canvas-source]{position:absolute;left:8%;top:16%;width:min(680px,78%);padding:34px;border-radius:28px;background:#fff;color:#0f172a;box-shadow:0 26px 90px rgba(2,6,23,.32);border:1px solid rgba(15,23,42,.08)}.prom-html-canvas-card small{display:block;margin:0 0 12px;color:${accent};font:900 14px/1 Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase}.prom-html-canvas-card h2{margin:0 0 14px;font:900 58px/.95 Inter,system-ui,sans-serif;letter-spacing:-.03em}.prom-html-canvas-card p{margin:0;color:#475569;font:650 24px/1.35 Inter,system-ui,sans-serif}.prom-html-canvas-card[data-prometheus-html-in-canvas-supported="true"] [data-html-canvas-source]{opacity:0;pointer-events:none}`,
      js: `<script>(function(){var canvas=document.getElementById('${id}');if(!canvas)return;var ctx=canvas.getContext('2d');var source=canvas.querySelector('[data-html-canvas-source]');var supported=!!(ctx&&source&&typeof ctx.drawElementImage==='function');canvas.setAttribute('data-prometheus-html-in-canvas-supported',supported?'true':'false');function resize(){var r=canvas.getBoundingClientRect();canvas.width=Math.max(1,Math.round(r.width));canvas.height=Math.max(1,Math.round(r.height))}async function draw(ms){resize();if(!supported)return;var t=(Number(ms)||0)/1000;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.globalAlpha=.96;ctx.filter='drop-shadow(0 28px 70px rgba(2,6,23,.32)) blur('+Math.max(0,Math.sin(t*2)*2+2).toFixed(2)+'px)';try{await ctx.drawElementImage(source,canvas.width*.08+Math.sin(t)*18,canvas.height*.16)}catch(e){supported=false;canvas.setAttribute('data-prometheus-html-in-canvas-supported','false')}ctx.restore()}window.addEventListener('prometheus-html-motion-seek',function(e){draw(Number(e.detail&&e.detail.timeMs)||window.__PROMETHEUS_HTML_MOTION_TIME_MS__||0)});draw(window.__PROMETHEUS_HTML_MOTION_TIME_MS__||0);})();</script>`,
    };
  },
};

export function renderHtmlMotionBlock(blockId: string, input: Record<string, any> = {}, storage?: CreativeStorageLike | null): HtmlMotionBlockRenderResult {
  const block = BLOCKS.find((candidate) => candidate.id === blockId);
  if (!block) {
    const custom = getCustomHtmlMotionBlock(storage, blockId);
    if (!custom) throw new Error(`Unknown HTML motion block "${blockId}".`);
    const renderedBlock: HtmlMotionBlockDefinition = {
      id: custom.id,
      packId: custom.packId,
      name: custom.name,
      description: custom.description,
      category: custom.category as HtmlMotionBlockCategory,
      tags: custom.tags,
      bestFor: custom.bestFor,
      slots: custom.slots,
      requiredStageFeatures: custom.requiredStageFeatures,
      outputContract: custom.outputContract,
    };
    return {
      block: renderedBlock,
      html: renderTemplatePlaceholders(custom.html, input || {}),
      css: renderTemplatePlaceholders(custom.css, input || {}),
      js: renderTemplatePlaceholders(custom.js, input || {}),
      insertHint: 'before-stage-end',
    };
  }
  const renderer = RENDERERS[block.id];
  if (!renderer) throw new Error(`HTML motion block "${blockId}" is missing a renderer.`);
  const parts = renderer(block, input || {});
  return { block, html: parts.html, css: parts.css, js: parts.js, insertHint: 'before-stage-end' };
}
