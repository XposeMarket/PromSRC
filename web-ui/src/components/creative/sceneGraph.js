import { prepare, layout } from '/vendor/pretext/layout.js';

const DEFAULT_ELEMENT = {
  type: 'shape',
  x: 0,
  y: 0,
  width: 120,
  height: 120,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  zIndex: 0,
  meta: {},
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function quoteFontFamily(family = 'Manrope') {
  const value = String(family || 'Manrope').trim() || 'Manrope';
  if (/^["'].*["']$/.test(value) || !/\s/.test(value)) return value;
  return `"${value}"`;
}

function computeLineHeightPx(fontSize = 24, lineHeight = 1.2) {
  const safeFont = Math.max(10, Number(fontSize) || 24);
  const safeLineHeight = Number.isFinite(Number(lineHeight)) ? Number(lineHeight) : 1.2;
  return Math.max(safeFont, Math.ceil((safeLineHeight <= 4 ? safeFont * safeLineHeight : safeLineHeight)));
}

export function buildTextFontSpec(meta = {}) {
  const fontSize = Math.max(10, Number(meta.fontSize) || 24);
  const fontWeight = Math.max(100, Number(meta.fontWeight) || 700);
  const fontStyle = String(meta.fontStyle || 'normal').trim().toLowerCase();
  const family = quoteFontFamily(meta.fontFamily || 'Manrope');
  return `${fontStyle !== 'normal' ? `${fontStyle} ` : ''}${fontWeight} ${fontSize}px ${family}`;
}

function measureTextHeuristically(content, fontSize = 24, width = 320, lineHeight = 1.2) {
  const text = String(content || '').trim();
  const safeWidth = Math.max(80, Number(width) || 320);
  const safeFont = Math.max(10, Number(fontSize) || 24);
  const safeLineHeight = Math.max(1, Number(lineHeight) || 1.2);
  const approxCharsPerLine = Math.max(6, Math.floor(safeWidth / Math.max(6, safeFont * 0.56)));
  const logicalLines = text
    ? text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Math.max(1, line.length) / approxCharsPerLine)), 0)
    : 1;
  const height = Math.max(Math.ceil(safeFont * safeLineHeight * logicalLines + 12), Math.ceil(safeFont * 1.6));
  return { height, lineCount: logicalLines, lineHeightPx: computeLineHeightPx(safeFont, safeLineHeight), kind: 'heuristic' };
}

export function measureTextBlock(content, fontSpecOrFontSize = 24, width = 320, lineHeight = 1.2, options = {}) {
  const text = String(content || '');
  const fontSize = Math.max(10, Number(options.fontSize) || (typeof fontSpecOrFontSize === 'number' ? Number(fontSpecOrFontSize) : 24) || 24);
  const safeWidth = Math.max(80, Number(width) || 320);
  const lineHeightPx = computeLineHeightPx(fontSize, lineHeight);
  const fontSpec = typeof fontSpecOrFontSize === 'string'
    ? fontSpecOrFontSize
    : buildTextFontSpec({
        fontSize,
        fontWeight: options.fontWeight,
        fontFamily: options.fontFamily,
        fontStyle: options.fontStyle,
      });
  try {
    const prepared = prepare(text || ' ', fontSpec, {
      whiteSpace: 'pre-wrap',
      wordBreak: options.wordBreak === 'keep-all' ? 'keep-all' : 'normal',
    });
    const measured = layout(prepared, safeWidth, lineHeightPx);
    return {
      height: Math.max(Math.ceil(Number(measured?.height) || 0), Math.ceil(fontSize * 1.4)),
      lineCount: Math.max(1, Number(measured?.lineCount) || 1),
      lineHeightPx,
      fontSpec,
      kind: 'pretext',
    };
  } catch {
    const fallback = measureTextHeuristically(text, fontSize, safeWidth, lineHeight);
    return { ...fallback, fontSpec };
  }
}

const CREATIVE_LIBRARY_SECTIONS = ['text', 'shapes', 'icons', 'images', 'videos', 'components'];
const CREATIVE_LIBRARY_SECTION_TYPES = {
  text: 'text',
  shapes: 'shape',
  icons: 'icon',
  images: 'image',
  videos: 'video',
  components: 'group',
};
const CREATIVE_LIBRARY_CATEGORIES = new Set(['core', 'icons', 'motion', 'components', 'shapes']);
const CREATIVE_ANIMATION_TARGETS = new Set(['text', 'shape', 'image', 'video', 'icon', 'group']);
let runtimeCreativeCustomLibraryPacks = [];

export const CREATIVE_STYLE_PRESETS = [
  {
    id: 'startup-launch',
    label: 'Startup Launch',
    fonts: { heading: 'Sora', body: 'Inter' },
    colors: { background: '#07111F', surface: '#0F172A', text: '#F8FAFC', muted: '#B6C2D9', accent: '#38BDF8', accent2: '#A7F3D0' },
    motion: ['rise_fade', 'scale_pop', 'slide_left'],
  },
  {
    id: 'tiktok-bold',
    label: 'TikTok Bold',
    fonts: { heading: 'Bebas Neue', body: 'Manrope' },
    colors: { background: '#050608', surface: '#111827', text: '#FFFFFF', muted: '#D1D5DB', accent: '#FF4D2D', accent2: '#16D9FF' },
    motion: ['stamp_in', 'glitch_in', 'pulse'],
  },
  {
    id: 'luxury',
    label: 'Luxury',
    fonts: { heading: 'Playfair Display', body: 'Inter' },
    colors: { background: '#0D0B09', surface: '#17120E', text: '#FFF8EC', muted: '#C9BFAF', accent: '#D6B36A', accent2: '#F3E5C2' },
    motion: ['soft_blur_in', 'rise_fade', 'fade_in'],
  },
  {
    id: 'editorial',
    label: 'Editorial',
    fonts: { heading: 'Georgia', body: 'Inter' },
    colors: { background: '#F8FAFC', surface: '#FFFFFF', text: '#111827', muted: '#475467', accent: '#E11D48', accent2: '#2563EB' },
    motion: ['rise_fade', 'slide_left', 'fade_in'],
  },
  {
    id: 'saas-product',
    label: 'SaaS Product',
    fonts: { heading: 'Inter', body: 'Inter' },
    colors: { background: '#F8FAFC', surface: '#FFFFFF', text: '#111827', muted: '#475467', accent: '#2563EB', accent2: '#7C3AED' },
    motion: ['slide_up', 'scale_pop', 'cascade_in'],
  },
  {
    id: 'meme-news',
    label: 'Meme / News',
    fonts: { heading: 'Impact', body: 'Arial' },
    colors: { background: '#111827', surface: '#FBBF24', text: '#FFFFFF', muted: '#E5E7EB', accent: '#FBBF24', accent2: '#EF4444' },
    motion: ['stamp_in', 'shake', 'zoom_in'],
  },
  {
    id: 'local-business',
    label: 'Local Business Ad',
    fonts: { heading: 'Montserrat', body: 'Manrope' },
    colors: { background: '#082F49', surface: '#FFFFFF', text: '#F8FAFC', muted: '#D0E8F2', accent: '#F97316', accent2: '#22C55E' },
    motion: ['slide_up', 'bounce_in', 'pulse'],
  },
];

function cloneData(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeMotionTemplateInstance(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const input = source.input && typeof source.input === 'object' && !Array.isArray(source.input)
    ? cloneData(source.input)
    : {};
  return {
    id: source.id || createId('motion'),
    type: 'motionTemplate',
    templateId: String(source.templateId || input.templateId || 'caption-reel').trim() || 'caption-reel',
    presetId: source.presetId || input.presetId || null,
    socialFormat: String(source.socialFormat || input.socialFormat || 'reel').trim() || 'reel',
    startMs: Math.max(0, Number(source.startMs) || 0),
    durationMs: Math.max(1000, Number(source.durationMs || input.durationMs) || 12000),
    locked: source.locked === true,
    input,
    preview: source.preview && typeof source.preview === 'object' && !Array.isArray(source.preview)
      ? cloneData(source.preview)
      : null,
  };
}

function normalizeLibraryId(raw, fallback = '') {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function normalizeAnimationPresetId(raw, fallback = '') {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9._]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function normalizeLibraryLabel(raw, fallback = 'Library Pack') {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80) || fallback;
}

function normalizeLibraryCategory(raw = '', fallback = 'components') {
  const normalized = String(raw || '').trim().toLowerCase();
  return CREATIVE_LIBRARY_CATEGORIES.has(normalized) ? normalized : fallback;
}

function normalizeLibrarySection(raw = '') {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'text' || normalized === 'texts') return 'text';
  if (normalized === 'shape' || normalized === 'shapes') return 'shapes';
  if (normalized === 'icon' || normalized === 'icons') return 'icons';
  if (normalized === 'image' || normalized === 'images') return 'images';
  if (normalized === 'video' || normalized === 'videos') return 'videos';
  if (normalized === 'component' || normalized === 'components' || normalized === 'group' || normalized === 'groups') return 'components';
  return null;
}

function normalizeAnimationTargets(input) {
  const values = Array.isArray(input) ? input : [input];
  const normalized = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => CREATIVE_ANIMATION_TARGETS.has(value));
  return normalized.length ? [...new Set(normalized)] : ['text', 'shape', 'image', 'video', 'icon', 'group'];
}

function normalizeRecipeState(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = {};
  ['x', 'y', 'xOffset', 'yOffset', 'width', 'height', 'scale', 'opacity', 'rotation'].forEach((key) => {
    if (Number.isFinite(Number(source[key]))) result[key] = Number(source[key]);
  });
  return result;
}

function normalizeMotionEffects(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = {};
  if (source.blurIn && typeof source.blurIn === 'object' && !Array.isArray(source.blurIn)) {
    result.blurIn = {
      fromPx: Number.isFinite(Number(source.blurIn.fromPx)) ? Number(source.blurIn.fromPx) : 18,
      toPx: Number.isFinite(Number(source.blurIn.toPx)) ? Number(source.blurIn.toPx) : 0,
    };
  }
  if (source.typewriter) {
    const typewriter = typeof source.typewriter === 'object' && source.typewriter && !Array.isArray(source.typewriter)
      ? source.typewriter
      : {};
    result.typewriter = {
      sourceContent: String(typewriter.sourceContent || ''),
    };
  }
  return Object.keys(result).length ? result : null;
}

function normalizeCustomLibraryElement(section, raw, libraryId) {
  const normalizedSection = normalizeLibrarySection(section);
  if (!normalizedSection || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = String(raw.type || CREATIVE_LIBRARY_SECTION_TYPES[normalizedSection] || '').trim().toLowerCase();
  const kind = normalizeLibraryId(raw.kind || raw.id || raw.label, '');
  if (!kind) return null;
  const label = normalizeLibraryLabel(raw.label || raw.kind || raw.id, kind);
  const meta = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? cloneData(raw.meta) : {};
  if (normalizedSection === 'icons' && raw.iconName && !meta.iconName) meta.iconName = String(raw.iconName);
  if (normalizedSection === 'shapes' && raw.shape && !meta.shape) meta.shape = String(raw.shape);
  if (normalizedSection === 'components' && raw.component && !meta.component) meta.component = String(raw.component);
  if (normalizedSection === 'text' && raw.content && !meta.content) meta.content = String(raw.content);
  if (normalizedSection === 'text' && !meta.content) meta.content = label;
  return {
    kind,
    label,
    type: type || CREATIVE_LIBRARY_SECTION_TYPES[normalizedSection],
    libraryId,
    meta,
    defaultWidth: Number.isFinite(Number(raw.defaultWidth)) ? Math.max(12, Number(raw.defaultWidth)) : null,
    defaultHeight: Number.isFinite(Number(raw.defaultHeight)) ? Math.max(12, Number(raw.defaultHeight)) : null,
  };
}

function normalizeCustomAnimationPreset(raw, libraryId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = normalizeAnimationPresetId(raw.id || raw.label, '');
  if (!id) return null;
  const label = normalizeLibraryLabel(raw.label || raw.id, id);
  return {
    id,
    label,
    libraryId,
    targets: normalizeAnimationTargets(raw.targets),
    defaultDurationMs: Math.max(100, Number(raw.defaultDurationMs) || 500),
    from: normalizeRecipeState(raw.from),
    to: normalizeRecipeState(raw.to),
    holdMs: Math.max(0, Number(raw.holdMs) || 0),
    ease: String(raw.ease || 'power2.out').trim() || 'power2.out',
    effects: normalizeMotionEffects(raw.effects),
  };
}

function deriveLibraryCategory(elements = {}, animationPresets = [], explicitCategory = '') {
  if (CREATIVE_LIBRARY_CATEGORIES.has(String(explicitCategory || '').trim().toLowerCase())) {
    return String(explicitCategory).trim().toLowerCase();
  }
  if (animationPresets.length && !Object.values(elements).some((entries) => Array.isArray(entries) && entries.length)) return 'motion';
  if (Array.isArray(elements.icons) && elements.icons.length) return 'icons';
  if (Array.isArray(elements.shapes) && elements.shapes.length) return 'shapes';
  if (Array.isArray(elements.components) && elements.components.length) return 'components';
  if (Array.isArray(elements.text) && elements.text.length) return 'core';
  return 'components';
}

function buildLibraryIncludes(rawIncludes, elements = {}, animationPresets = []) {
  if (Array.isArray(rawIncludes) && rawIncludes.length) {
    return rawIncludes
      .map((value) => normalizeLibraryLabel(value, ''))
      .filter(Boolean)
      .slice(0, 12);
  }
  const derived = [];
  CREATIVE_LIBRARY_SECTIONS.forEach((section) => {
    (Array.isArray(elements[section]) ? elements[section] : []).forEach((entry) => {
      if (entry?.label) derived.push(entry.label);
    });
  });
  animationPresets.forEach((preset) => {
    if (preset?.label) derived.push(preset.label);
  });
  return [...new Set(derived)].slice(0, 12);
}

export function normalizeCreativeLibraryPackManifest(raw, options = {}) {
  const source = raw?.pack && typeof raw.pack === 'object' && !Array.isArray(raw.pack) ? raw.pack : raw;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const id = normalizeLibraryId(options.id || source.id || source.label, '');
  if (!id) return null;
  const sourceElements = source?.elements && typeof source.elements === 'object' && !Array.isArray(source.elements) ? source.elements : {};
  const elements = {};
  CREATIVE_LIBRARY_SECTIONS.forEach((section) => {
    const rawEntries = Object.entries(sourceElements).reduce((collection, [rawSection, entries]) => {
      if (normalizeLibrarySection(rawSection) !== section || !Array.isArray(entries)) return collection;
      return collection.concat(entries);
    }, []);
    const normalizedEntries = rawEntries
      .map((entry) => normalizeCustomLibraryElement(section, entry, id))
      .filter(Boolean);
    if (normalizedEntries.length) elements[section] = normalizedEntries;
  });
  const animationPresets = (Array.isArray(source.animationPresets) ? source.animationPresets : [])
    .map((entry) => normalizeCustomAnimationPreset(entry, id))
    .filter(Boolean);
  if (!Object.keys(elements).length && !animationPresets.length) return null;
  return {
    id,
    label: normalizeLibraryLabel(source.label || id, id),
    category: deriveLibraryCategory(elements, animationPresets, source.category),
    description: normalizeLibraryLabel(source.description || 'Imported custom creative library pack.', 'Imported custom creative library pack.'),
    includes: buildLibraryIncludes(source.includes, elements, animationPresets),
    defaultEnabled: source.defaultEnabled === true,
    source: 'custom',
    sourceUrl: String(options.sourceUrl || source.sourceUrl || '').trim() || null,
    manifestPath: String(options.manifestPath || source.manifestPath || '').trim() || null,
    manifestPathRelative: String(options.manifestPathRelative || source.manifestPathRelative || '').trim() || null,
    elements,
    animationPresets,
  };
}

export const CREATIVE_ELEMENT_LIBRARY = {
  text: [
    { kind: 'heading', label: 'Heading', type: 'text', libraryId: 'core-foundation', meta: { content: 'Heading', fontSize: 48, fontWeight: 800, lineHeight: 1.1 } },
    { kind: 'subheading', label: 'Subheading', type: 'text', libraryId: 'core-foundation', meta: { content: 'Subheading', fontSize: 28, fontWeight: 700, lineHeight: 1.2 } },
    { kind: 'body', label: 'Body', type: 'text', libraryId: 'core-foundation', meta: { content: 'Body copy', fontSize: 16, fontWeight: 500, lineHeight: 1.5 } },
    { kind: 'caption', label: 'Caption', type: 'text', libraryId: 'core-foundation', meta: { content: 'Caption', fontSize: 12, fontWeight: 600, lineHeight: 1.4 } },
    { kind: 'display-hook', label: 'Display Hook', type: 'text', libraryId: 'creative-ad-pack', defaultWidth: 720, defaultHeight: 180, meta: { content: 'Make the offer impossible to miss', fontSize: 72, fontWeight: 950, fontFamily: 'Bebas Neue', lineHeight: 0.96, color: '#ffffff', shadow: '0 20px 70px rgba(0,0,0,.35)' } },
    { kind: 'kicker-label', label: 'Kicker Label', type: 'text', libraryId: 'creative-ad-pack', defaultWidth: 360, defaultHeight: 44, meta: { content: 'NEW TEMPLATE SYSTEM', fontSize: 22, fontWeight: 900, fontFamily: 'Manrope', lineHeight: 1.05, color: '#FFCB1F' } },
  ],
  shapes: [
    { kind: 'rect', label: 'Rectangle', type: 'shape', libraryId: 'core-foundation', meta: { shape: 'rect', fill: '#111827', radius: 0 } },
    { kind: 'rounded-rect', label: 'Rounded Rect', type: 'shape', libraryId: 'core-foundation', meta: { shape: 'rect', fill: '#111827', radius: 18 } },
    { kind: 'circle', label: 'Circle', type: 'shape', libraryId: 'core-foundation', meta: { shape: 'circle', fill: '#111827' } },
    { kind: 'triangle', label: 'Triangle', type: 'shape', libraryId: 'shapes-extended', meta: { shape: 'triangle', fill: '#111827', stroke: 'transparent', strokeWidth: 0 } },
    { kind: 'polygon', label: 'Polygon', type: 'shape', libraryId: 'shapes-extended', meta: { shape: 'polygon', fill: '#111827', stroke: 'transparent', strokeWidth: 0, sides: 6 } },
    { kind: 'line', label: 'Line', type: 'shape', libraryId: 'core-foundation', meta: { shape: 'line', stroke: '#111827', strokeWidth: 2 } },
    { kind: 'arrow', label: 'Arrow', type: 'shape', libraryId: 'core-foundation', meta: { shape: 'arrow', stroke: '#111827', strokeWidth: 2 } },
    { kind: 'safe-card', label: 'Safe Card', type: 'shape', libraryId: 'creative-ad-pack', defaultWidth: 520, defaultHeight: 260, meta: { shape: 'rect', fill: '#111827', radius: 32, stroke: 'rgba(255,255,255,.16)', strokeWidth: 1, shadow: '0 26px 80px rgba(0,0,0,.32)' } },
    { kind: 'accent-slab', label: 'Accent Slab', type: 'shape', libraryId: 'creative-ad-pack', defaultWidth: 240, defaultHeight: 360, meta: { shape: 'rect', fill: '#FF4D2D', radius: 36, rotation: 8, shadow: '0 26px 80px rgba(255,77,45,.34)' } },
    { kind: 'progress-bar', label: 'Progress Bar', type: 'shape', libraryId: 'creative-ad-pack', defaultWidth: 680, defaultHeight: 16, meta: { shape: 'rect', fill: '#16D9FF', radius: 999, shadow: '0 0 34px rgba(22,217,255,.42)' } },
    { kind: 'light-sweep', label: 'Light Sweep', type: 'shape', libraryId: 'creative-ad-pack', defaultWidth: 340, defaultHeight: 32, meta: { shape: 'rect', fill: 'rgba(255,255,255,.28)', radius: 999, rotation: -12 } },
    { kind: 'gradient-panel', label: 'Gradient Panel', type: 'shape', libraryId: 'creative-ad-pack', defaultWidth: 680, defaultHeight: 420, meta: { shape: 'rect', fill: '#2563EB', radius: 34, shadow: '0 28px 90px rgba(37,99,235,.28)', treatment: 'gradient-panel', accentFill: '#16D9FF' } },
    { kind: 'dot-texture', label: 'Dot Texture', type: 'shape', libraryId: 'creative-ad-pack', defaultWidth: 520, defaultHeight: 300, meta: { shape: 'rect', fill: 'rgba(255,255,255,.08)', radius: 0, opacity: 0.28, treatment: 'dot-texture' } },
    { kind: 'ui-frame', label: 'UI Frame', type: 'shape', libraryId: 'creative-ad-pack', defaultWidth: 640, defaultHeight: 420, meta: { shape: 'rect', fill: '#0B1220', radius: 28, stroke: 'rgba(255,255,255,.18)', strokeWidth: 2, shadow: '0 28px 90px rgba(0,0,0,.32)' } },
    { kind: 'mockup-bezel', label: 'Mockup Bezel', type: 'shape', libraryId: 'creative-ad-pack', defaultWidth: 360, defaultHeight: 720, meta: { shape: 'rect', fill: '#050608', radius: 54, stroke: 'rgba(255,255,255,.16)', strokeWidth: 3, shadow: '0 34px 100px rgba(0,0,0,.42)' } },
  ],
  icons: [
    { kind: 'sparkles', label: 'Sparkles', type: 'icon', libraryId: 'iconify-essentials', meta: { iconName: 'solar:stars-bold-duotone', color: '#111827' } },
    { kind: 'bolt', label: 'Bolt', type: 'icon', libraryId: 'iconify-essentials', meta: { iconName: 'solar:bolt-bold-duotone', color: '#111827' } },
    { kind: 'lock', label: 'Lock', type: 'icon', libraryId: 'iconify-essentials', meta: { iconName: 'solar:lock-keyhole-bold-duotone', color: '#111827' } },
    { kind: 'camera', label: 'Camera', type: 'icon', libraryId: 'iconify-ui-pack', meta: { iconName: 'solar:camera-bold-duotone', color: '#111827' } },
    { kind: 'globe', label: 'Globe', type: 'icon', libraryId: 'iconify-ui-pack', meta: { iconName: 'solar:global-bold-duotone', color: '#111827' } },
    { kind: 'palette', label: 'Palette', type: 'icon', libraryId: 'iconify-ui-pack', meta: { iconName: 'solar:palette-round-bold-duotone', color: '#111827' } },
    { kind: 'chart', label: 'Chart', type: 'icon', libraryId: 'iconify-ui-pack', meta: { iconName: 'solar:chart-square-bold-duotone', color: '#111827' } },
    { kind: 'play', label: 'Play', type: 'icon', libraryId: 'creative-ad-pack', meta: { iconName: 'solar:play-circle-bold-duotone', color: '#ffffff' } },
    { kind: 'rocket', label: 'Rocket', type: 'icon', libraryId: 'creative-ad-pack', meta: { iconName: 'solar:rocket-2-bold-duotone', color: '#ffffff' } },
    { kind: 'cursor', label: 'Cursor', type: 'icon', libraryId: 'creative-ad-pack', meta: { iconName: 'solar:cursor-bold-duotone', color: '#ffffff' } },
    { kind: 'megaphone', label: 'Megaphone', type: 'icon', libraryId: 'creative-ad-pack', meta: { iconName: 'solar:chat-square-call-bold-duotone', color: '#ffffff' } },
    { kind: 'calendar', label: 'Calendar', type: 'icon', libraryId: 'creative-ad-pack', meta: { iconName: 'solar:calendar-bold-duotone', color: '#ffffff' } },
    { kind: 'quote', label: 'Quote Mark', type: 'icon', libraryId: 'creative-ad-pack', meta: { iconName: 'solar:quote-up-square-bold-duotone', color: '#ffffff' } },
    { kind: 'waveform', label: 'Waveform', type: 'icon', libraryId: 'creative-ad-pack', meta: { iconName: 'solar:soundwave-bold-duotone', color: '#ffffff' } },
    { kind: 'cart', label: 'Cart', type: 'icon', libraryId: 'creative-ad-pack', meta: { iconName: 'solar:cart-large-2-bold-duotone', color: '#ffffff' } },
    { kind: 'github', label: 'GitHub', type: 'icon', libraryId: 'iconify-brand-pack', meta: { iconName: 'mdi:github', color: '#111827' } },
    { kind: 'figma', label: 'Figma', type: 'icon', libraryId: 'iconify-brand-pack', meta: { iconName: 'simple-icons:figma', color: '#111827' } },
    { kind: 'slack', label: 'Slack', type: 'icon', libraryId: 'iconify-brand-pack', meta: { iconName: 'simple-icons:slack', color: '#111827' } },
  ],
  images: [
    { kind: 'upload', label: 'Upload', type: 'image', libraryId: 'core-foundation', meta: { source: null, fit: 'cover' } },
    { kind: 'placeholder', label: 'Placeholder', type: 'image', libraryId: 'core-foundation', meta: { source: null, placeholder: true, fit: 'cover' } },
    { kind: 'phone-frame', label: 'Phone Frame', type: 'image', libraryId: 'creative-ad-pack', defaultWidth: 320, defaultHeight: 640, meta: { source: null, placeholder: true, fit: 'cover', radius: 42, frame: 'phone' } },
    { kind: 'app-screenshot', label: 'App Screenshot', type: 'image', libraryId: 'creative-ad-pack', defaultWidth: 640, defaultHeight: 420, meta: { source: null, placeholder: true, fit: 'cover', radius: 28, shadow: '0 24px 80px rgba(0,0,0,.28)' } },
  ],
  videos: [
    { kind: 'clip', label: 'Video Clip', type: 'video', libraryId: 'core-foundation', defaultWidth: 360, defaultHeight: 640, meta: { source: null, fit: 'cover', muted: true, volume: 0, trimStartMs: 0, timelineStartMs: 0 } },
    { kind: 'video-placeholder', label: 'Video Placeholder', type: 'video', libraryId: 'core-foundation', defaultWidth: 360, defaultHeight: 640, meta: { source: null, placeholder: true, fit: 'cover', muted: true, volume: 0 } },
  ],
  components: [
    { kind: 'card', label: 'Card', type: 'group', libraryId: 'components-core', meta: { component: 'card' } },
    { kind: 'button', label: 'Button', type: 'group', libraryId: 'components-core', meta: { component: 'button' } },
    { kind: 'badge', label: 'Badge', type: 'group', libraryId: 'components-core', meta: { component: 'badge' } },
    { kind: 'divider', label: 'Divider', type: 'group', libraryId: 'components-core', meta: { component: 'divider' } },
    { kind: 'stat', label: 'Stat', type: 'group', libraryId: 'components-story-pack', meta: { component: 'stat' } },
    { kind: 'quote', label: 'Quote', type: 'group', libraryId: 'components-story-pack', meta: { component: 'quote' } },
    { kind: 'cta-card', label: 'CTA Card', type: 'group', libraryId: 'creative-ad-pack', defaultWidth: 560, defaultHeight: 180, meta: { component: 'cta-card' } },
    { kind: 'caption-block', label: 'Caption Block', type: 'group', libraryId: 'creative-ad-pack', defaultWidth: 720, defaultHeight: 220, meta: { component: 'caption-block' } },
    { kind: 'feature-card', label: 'Feature Card', type: 'group', libraryId: 'creative-ad-pack', defaultWidth: 440, defaultHeight: 260, meta: { component: 'feature-card' } },
    { kind: 'logo-lockup', label: 'Logo Lockup', type: 'group', libraryId: 'creative-ad-pack', defaultWidth: 360, defaultHeight: 110, meta: { component: 'logo-lockup' } },
    { kind: 'lower-third', label: 'Lower Third', type: 'group', libraryId: 'creative-ad-pack', defaultWidth: 740, defaultHeight: 150, meta: { component: 'lower-third' } },
    { kind: 'product-callout', label: 'Product Callout', type: 'group', libraryId: 'creative-ad-pack', defaultWidth: 520, defaultHeight: 220, meta: { component: 'product-callout' } },
  ],
  animations: [
    { kind: 'lottie', label: 'Lottie', type: 'lottie', libraryId: 'lottie-pack', defaultWidth: 240, defaultHeight: 240, meta: { source: '', autoplay: true, loop: true, speed: 1 } },
  ],
};

export const CREATIVE_LIBRARY_PACKS = [
  {
    id: 'core-foundation',
    label: 'Core Foundation',
    category: 'core',
    description: 'Base text, image, video, and shape primitives that power every scene.',
    includes: ['Text styles', 'Rect / circle / line', 'Image blocks', 'Video clips'],
    defaultEnabled: true,
  },
  {
    id: 'iconify-essentials',
    label: 'Iconify Essentials',
    category: 'icons',
    description: 'Starter Iconify set for general UI, motion, and studio accents.',
    includes: ['Sparkles', 'Bolt', 'Lock', 'Direct icon name swaps'],
    defaultEnabled: true,
  },
  {
    id: 'motion-core',
    label: 'Motion Core',
    category: 'motion',
    description: 'Foundational motion presets for fast entrance timing.',
    includes: ['Fade In', 'Slide Up', 'Fade + Up'],
    defaultEnabled: true,
  },
  {
    id: 'components-core',
    label: 'Components Core',
    category: 'components',
    description: 'Starter components for cards, buttons, badges, and dividers.',
    includes: ['Card', 'Button', 'Badge', 'Divider'],
    defaultEnabled: true,
  },
  {
    id: 'shapes-extended',
    label: 'Shapes Extended',
    category: 'shapes',
    description: 'Adds higher-level geometry so layouts do not stop at boxes and circles.',
    includes: ['Triangle', 'Polygon'],
    defaultEnabled: false,
  },
  {
    id: 'motion-expressive',
    label: 'Motion Expressive',
    category: 'motion',
    description: 'Richer motion library for punchier entrances and text treatments.',
    includes: ['Scale Pop', 'Blur In', 'Typewriter'],
    defaultEnabled: false,
  },
  {
    id: 'iconify-ui-pack',
    label: 'Iconify UI Pack',
    category: 'icons',
    description: 'A broader UI icon starter set for product shots, marketing frames, and dashboards.',
    includes: ['Camera', 'Globe', 'Palette', 'Chart'],
    defaultEnabled: false,
  },
  {
    id: 'iconify-brand-pack',
    label: 'Iconify Brand Pack',
    category: 'icons',
    description: 'Brand icons for product mosaics, partner grids, and social compositions.',
    includes: ['GitHub', 'Figma', 'Slack'],
    defaultEnabled: false,
  },
  {
    id: 'components-story-pack',
    label: 'Components Story Pack',
    category: 'components',
    description: 'Narrative-ready blocks for quotes, stats, and presentation frames.',
    includes: ['Stat', 'Quote'],
    defaultEnabled: false,
  },
  {
    id: 'creative-ad-pack',
    label: 'Creative Ad Pack',
    category: 'components',
    description: 'Production-oriented ad primitives for promo videos, social posts, product launches, and conversion creative.',
    includes: ['Display Hook', 'CTA Card', 'Caption Block', 'Feature Card', 'Logo Lockup', 'Lower Third', 'Product Callout'],
    defaultEnabled: true,
  },
  {
    id: 'motion-entrance',
    label: 'Motion Entrance',
    category: 'motion',
    description: '9 entrance animations: slides from all directions, bounce, zoom, spin, elastic pop, drop, and float.',
    includes: ['Slide Down', 'Slide Left', 'Slide Right', 'Bounce In', 'Zoom In', 'Spin In', 'Elastic Pop', 'Drop In', 'Rise Float'],
    defaultEnabled: false,
  },
  {
    id: 'motion-exit',
    label: 'Motion Exit',
    category: 'motion',
    description: '6 exit animations for clean scene transitions: fades, slides, scale, blur, and spin.',
    includes: ['Fade Out', 'Slide Out Down', 'Slide Out Up', 'Scale Out', 'Blur Out', 'Spin Out'],
    defaultEnabled: false,
  },
  {
    id: 'motion-attention',
    label: 'Motion Attention',
    category: 'motion',
    description: 'Attention animations: pulse, shake, float loop, and glitch entrance.',
    includes: ['Pulse', 'Shake', 'Float Up', 'Glitch In'],
    defaultEnabled: false,
  },
  {
    id: 'motion-text-pro',
    label: 'Motion Text Pro',
    category: 'motion',
    description: 'Text-optimized animations: soft blur, rise fade, cascade, and stamp.',
    includes: ['Soft Blur In', 'Rise Fade', 'Cascade In', 'Stamp In'],
    defaultEnabled: false,
  },
  {
    id: 'lottie-pack',
    label: 'Lottie Animations',
    category: 'animations',
    description: 'Drop in any Lottie JSON animation via URL or file. Access 50,000+ free animations from LottieFiles.com.',
    includes: ['URL import', 'Autoplay', 'Loop control', 'Speed control'],
    defaultEnabled: false,
  },
];

const DEFAULT_CREATIVE_LIBRARY_IDS = new Set(
  CREATIVE_LIBRARY_PACKS.filter((pack) => pack.defaultEnabled).map((pack) => pack.id),
);
[
  'shapes-extended',
  'motion-expressive',
  'motion-entrance',
  'motion-attention',
  'motion-text-pro',
  'iconify-ui-pack',
  'components-story-pack',
  'creative-ad-pack',
].forEach((libraryId) => DEFAULT_CREATIVE_LIBRARY_IDS.add(libraryId));

export const CREATIVE_SIZE_PRESETS = {
  presentation_16_9: { label: '16:9', width: 1200, height: 675 },
  social_square: { label: 'Square', width: 1080, height: 1080 },
  vertical_story: { label: 'Story', width: 1080, height: 1920 },
  document_a4: { label: 'A4', width: 794, height: 1123 },
};

const ANIMATION_PRESETS = {
  fade_in: ({ element, startMs = 0, durationMs = 400 }) => ([
    {
      id: createId('kf'),
      atMs: startMs,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      opacity: 0,
      rotation: element.rotation,
      ease: 'power2.out',
    },
    {
      id: createId('kf'),
      atMs: startMs + durationMs,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      opacity: element.opacity,
      rotation: element.rotation,
      ease: 'power2.out',
    },
  ]),
  slide_up: ({ element, startMs = 0, durationMs = 450 }) => ([
    {
      id: createId('kf'),
      atMs: startMs,
      x: element.x,
      y: element.y + 48,
      width: element.width,
      height: element.height,
      opacity: element.opacity,
      rotation: element.rotation,
      ease: 'power3.out',
    },
    {
      id: createId('kf'),
      atMs: startMs + durationMs,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      opacity: element.opacity,
      rotation: element.rotation,
      ease: 'power3.out',
    },
  ]),
  fade_slide_up: ({ element, startMs = 0, durationMs = 500 }) => ([
    {
      id: createId('kf'),
      atMs: startMs,
      x: element.x,
      y: element.y + 56,
      width: element.width,
      height: element.height,
      opacity: 0,
      rotation: element.rotation,
      ease: 'power3.out',
    },
    {
      id: createId('kf'),
      atMs: startMs + durationMs,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      opacity: element.opacity,
      rotation: element.rotation,
      ease: 'power3.out',
    },
  ]),
  scale_pop: ({ element, startMs = 0, durationMs = 420 }) => {
    const startScale = 0.74;
    const startWidth = Math.max(24, Math.round(element.width * startScale));
    const startHeight = Math.max(24, Math.round(element.height * startScale));
    return [
      {
        id: createId('kf'),
        atMs: startMs,
        x: element.x + Math.round((element.width - startWidth) / 2),
        y: element.y + Math.round((element.height - startHeight) / 2),
        width: startWidth,
        height: startHeight,
        opacity: 0,
        rotation: element.rotation,
        ease: 'back.out(1.7)',
      },
      {
        id: createId('kf'),
        atMs: startMs + durationMs,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        opacity: element.opacity,
        rotation: element.rotation,
        ease: 'back.out(1.7)',
      },
    ];
  },
  blur_in: ({ element, startMs = 0, durationMs = 520 }) => ({
    keyframes: [
      {
        id: createId('kf'),
        atMs: startMs,
        x: element.x,
        y: element.y + 22,
        width: element.width,
        height: element.height,
        opacity: 0,
        rotation: element.rotation,
        ease: 'power2.out',
      },
      {
        id: createId('kf'),
        atMs: startMs + durationMs,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        opacity: element.opacity,
        rotation: element.rotation,
        ease: 'power2.out',
      },
    ],
    metaPatch: {
      motionEffects: {
        blurIn: {
          startMs,
          durationMs,
          fromPx: 18,
          toPx: 0,
        },
      },
    },
  }),
  typewriter: ({ element, startMs = 0, durationMs = 900 }) => ({
    keyframes: [
      {
        id: createId('kf'),
        atMs: startMs,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        opacity: element.opacity,
        rotation: element.rotation,
        ease: 'linear',
      },
      {
        id: createId('kf'),
        atMs: startMs + durationMs,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        opacity: element.opacity,
        rotation: element.rotation,
        ease: 'linear',
      },
    ],
    metaPatch: {
      motionEffects: {
        typewriter: {
          startMs,
          durationMs,
          sourceContent: String(element?.meta?.content || ''),
        },
      },
    },
  }),

  // --- ENTRANCE GROUP ---
  slide_down: (element, startMs, durationMs = 450) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y - 60, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power3.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power3.out' },
    ],
  }),

  slide_left: (element, startMs, durationMs = 450) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x + 80, y: element.y, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power3.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power3.out' },
    ],
  }),

  slide_right: (element, startMs, durationMs = 450) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x - 80, y: element.y, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power3.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power3.out' },
    ],
  }),

  bounce_in: (element, startMs, durationMs = 500) => {
    const scale = 0.55;
    const dw = element.width * (1 - scale);
    const dh = element.height * (1 - scale);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x + dw / 2, y: element.y + dh / 2, width: element.width * scale, height: element.height * scale, opacity: 0, rotation: element.rotation, ease: 'back.out(2.4)' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'back.out(2.4)' },
      ],
    };
  },

  zoom_in: (element, startMs, durationMs = 380) => {
    const scale = 0.12;
    const dw = element.width * (1 - scale);
    const dh = element.height * (1 - scale);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x + dw / 2, y: element.y + dh / 2, width: element.width * scale, height: element.height * scale, opacity: 0, rotation: element.rotation, ease: 'power2.out' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.out' },
      ],
    };
  },

  spin_in: (element, startMs, durationMs = 560) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: 0, rotation: (element.rotation || 0) + 160, ease: 'power2.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.out' },
    ],
  }),

  elastic_pop: (element, startMs, durationMs = 600) => {
    const scale = 0.3;
    const dw = element.width * (1 - scale);
    const dh = element.height * (1 - scale);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x + dw / 2, y: element.y + dh / 2, width: element.width * scale, height: element.height * scale, opacity: 0, rotation: element.rotation, ease: 'elastic.out(1.2,0.4)' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'elastic.out(1.2,0.4)' },
      ],
    };
  },

  drop_in: (element, startMs, durationMs = 520) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y - 100, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'bounce.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'bounce.out' },
    ],
  }),

  rise_float: (element, startMs, durationMs = 700) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y + 30, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power1.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power1.out' },
    ],
  }),

  // --- EXIT GROUP ---
  fade_out: (element, startMs, durationMs = 400) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.in' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power2.in' },
    ],
  }),

  slide_out_down: (element, startMs, durationMs = 420) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power3.in' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y + 72, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power3.in' },
    ],
  }),

  slide_out_up: (element, startMs, durationMs = 420) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power3.in' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y - 72, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power3.in' },
    ],
  }),

  scale_out: (element, startMs, durationMs = 360) => {
    const scale = 0.1;
    const dw = element.width * (1 - scale);
    const dh = element.height * (1 - scale);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.in' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x + dw / 2, y: element.y + dh / 2, width: element.width * scale, height: element.height * scale, opacity: 0, rotation: element.rotation, ease: 'power2.in' },
      ],
    };
  },

  blur_out: (element, startMs, durationMs = 480) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.in' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y - 18, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power2.in' },
    ],
    metaPatch: {
      motionEffects: {
        blurOut: { startMs, durationMs, fromPx: 0, toPx: 18 },
      },
    },
  }),

  spin_out: (element, startMs, durationMs = 480) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.in' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: 0, rotation: (element.rotation || 0) + 90, ease: 'power2.in' },
    ],
  }),

  // --- ATTENTION GROUP ---
  pulse: (element, startMs, durationMs = 600) => {
    const scale = 1.08;
    const dw = element.width * (scale - 1);
    const dh = element.height * (scale - 1);
    const midMs = startMs + Math.round(durationMs / 2);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.inOut' },
        { id: createId('kf'), atMs: midMs, x: element.x - dw / 2, y: element.y - dh / 2, width: element.width * scale, height: element.height * scale, opacity: element.opacity, rotation: element.rotation, ease: 'power2.inOut' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.inOut' },
      ],
    };
  },

  shake: (element, startMs, durationMs = 480) => {
    const step = Math.round(durationMs / 5);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power1.inOut' },
        { id: createId('kf'), atMs: startMs + step, x: element.x + 8, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power1.inOut' },
        { id: createId('kf'), atMs: startMs + step * 2, x: element.x - 8, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power1.inOut' },
        { id: createId('kf'), atMs: startMs + step * 3, x: element.x + 8, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power1.inOut' },
        { id: createId('kf'), atMs: startMs + step * 4, x: element.x - 8, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power1.inOut' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power1.inOut' },
      ],
    };
  },

  float_up: (element, startMs, durationMs = 1200) => {
    const midMs = startMs + Math.round(durationMs / 2);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'sine.inOut' },
        { id: createId('kf'), atMs: midMs, x: element.x, y: element.y - 16, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'sine.inOut' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'sine.inOut' },
      ],
    };
  },

  glitch_in: (element, startMs, durationMs = 500) => {
    const s1 = startMs;
    const s2 = startMs + Math.round(durationMs / 6);
    const s3 = startMs + Math.round(durationMs * 2 / 6);
    const s4 = startMs + Math.round(durationMs * 3 / 6);
    const s5 = startMs + Math.round(durationMs * 4 / 6);
    const s6 = startMs + Math.round(durationMs * 5 / 8);
    const s7 = startMs + durationMs;
    return {
      keyframes: [
        { id: createId('kf'), atMs: s1, x: element.x, y: element.y, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'none' },
        { id: createId('kf'), atMs: s2, x: element.x + 6, y: element.y - 3, width: element.width, height: element.height, opacity: 0.7, rotation: (element.rotation || 0) + 1, ease: 'none' },
        { id: createId('kf'), atMs: s3, x: element.x - 6, y: element.y + 3, width: element.width, height: element.height, opacity: 0.4, rotation: (element.rotation || 0) - 1, ease: 'none' },
        { id: createId('kf'), atMs: s4, x: element.x + 4, y: element.y - 2, width: element.width, height: element.height, opacity: 0.8, rotation: element.rotation, ease: 'none' },
        { id: createId('kf'), atMs: s5, x: element.x - 3, y: element.y + 2, width: element.width, height: element.height, opacity: 0.6, rotation: (element.rotation || 0) + 1, ease: 'none' },
        { id: createId('kf'), atMs: s6, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.out' },
        { id: createId('kf'), atMs: s7, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.out' },
      ],
    };
  },

  // --- TEXT PRO GROUP ---
  soft_blur_in: (element, startMs, durationMs = 700) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power2.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.out' },
    ],
    metaPatch: {
      motionEffects: {
        blurIn: { startMs, durationMs, fromPx: 12, toPx: 0 },
      },
    },
  }),

  rise_fade: (element, startMs, durationMs = 600) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y + 22, width: element.width, height: element.height, opacity: 0, rotation: element.rotation, ease: 'power2.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.out' },
    ],
  }),

  cascade_in: (element, startMs, durationMs = 550) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x + 20, y: element.y + 10, width: element.width * 0.88, height: element.height * 0.88, opacity: 0, rotation: element.rotation, ease: 'power3.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power3.out' },
    ],
  }),

  stamp_in: (element, startMs, durationMs = 320) => {
    const scale = 1.3;
    const dw = element.width * (scale - 1);
    const dh = element.height * (scale - 1);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x - dw / 2, y: element.y - dh / 2, width: element.width * scale, height: element.height * scale, opacity: 0, rotation: (element.rotation || 0) + 4, ease: 'back.out(4)' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'back.out(4)' },
      ],
    };
  },
  wipe_reveal: (element, startMs = 0, durationMs = 520) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: Math.max(12, element.width * 0.08), height: element.height, opacity: 0, rotation: element.rotation, ease: 'power3.out' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power3.out' },
    ],
  }),
  punch_zoom: (element, startMs = 0, durationMs = 420) => {
    const scale = 1.16;
    const dw = element.width * (scale - 1);
    const dh = element.height * (scale - 1);
    return {
      keyframes: [
        { id: createId('kf'), atMs: startMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.out' },
        { id: createId('kf'), atMs: startMs + Math.round(durationMs * 0.48), x: element.x - dw / 2, y: element.y - dh / 2, width: element.width * scale, height: element.height * scale, opacity: element.opacity, rotation: element.rotation, ease: 'back.out(1.8)' },
        { id: createId('kf'), atMs: startMs + durationMs, x: element.x, y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'power2.inOut' },
      ],
    };
  },
  parallax_drift: (element, startMs = 0, durationMs = 1400) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x - 18, y: element.y + 8, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'sine.inOut' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x + 18, y: element.y - 8, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation, ease: 'sine.inOut' },
    ],
  }),
  light_sweep: (element, startMs = 0, durationMs = 900) => ({
    keyframes: [
      { id: createId('kf'), atMs: startMs, x: element.x - Math.round(element.width * 0.45), y: element.y, width: element.width, height: element.height, opacity: 0, rotation: element.rotation || -12, ease: 'linear' },
      { id: createId('kf'), atMs: startMs + Math.round(durationMs * 0.2), x: element.x - Math.round(element.width * 0.2), y: element.y, width: element.width, height: element.height, opacity: element.opacity, rotation: element.rotation || -12, ease: 'linear' },
      { id: createId('kf'), atMs: startMs + durationMs, x: element.x + Math.round(element.width * 0.45), y: element.y, width: element.width, height: element.height, opacity: 0, rotation: element.rotation || -12, ease: 'linear' },
    ],
  }),
};

const CREATIVE_ANIMATION_PRESET_META = {
  fade_in: { label: 'Fade In', libraryId: 'motion-core', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 400 },
  slide_up: { label: 'Slide Up', libraryId: 'motion-core', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 450 },
  fade_slide_up: { label: 'Fade + Up', libraryId: 'motion-core', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 500 },
  scale_pop: { label: 'Scale Pop', libraryId: 'motion-expressive', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 420 },
  blur_in: { label: 'Blur In', libraryId: 'motion-expressive', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 520 },
  typewriter: { label: 'Typewriter', libraryId: 'motion-expressive', targets: ['text'], defaultDurationMs: 900 },

  // Entrance
  slide_down: { label: 'Slide Down', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group', 'lottie'], defaultDurationMs: 450 },
  slide_left: { label: 'Slide Left', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group', 'lottie'], defaultDurationMs: 450 },
  slide_right: { label: 'Slide Right', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group', 'lottie'], defaultDurationMs: 450 },
  bounce_in: { label: 'Bounce In', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 500 },
  zoom_in: { label: 'Zoom In', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 380 },
  spin_in: { label: 'Spin In', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 560 },
  elastic_pop: { label: 'Elastic Pop', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 600 },
  drop_in: { label: 'Drop In', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 520 },
  rise_float: { label: 'Rise Float', libraryId: 'motion-entrance', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 700 },

  // Exit
  fade_out: { label: 'Fade Out', libraryId: 'motion-exit', targets: ['text', 'shape', 'image', 'icon', 'group', 'lottie'], defaultDurationMs: 400 },
  slide_out_down: { label: 'Slide Out Down', libraryId: 'motion-exit', targets: ['text', 'shape', 'image', 'icon', 'group', 'lottie'], defaultDurationMs: 420 },
  slide_out_up: { label: 'Slide Out Up', libraryId: 'motion-exit', targets: ['text', 'shape', 'image', 'icon', 'group', 'lottie'], defaultDurationMs: 420 },
  scale_out: { label: 'Scale Out', libraryId: 'motion-exit', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 360 },
  blur_out: { label: 'Blur Out', libraryId: 'motion-exit', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 480 },
  spin_out: { label: 'Spin Out', libraryId: 'motion-exit', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 480 },

  // Attention
  pulse: { label: 'Pulse', libraryId: 'motion-attention', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 600 },
  shake: { label: 'Shake', libraryId: 'motion-attention', targets: ['text', 'shape', 'image', 'icon', 'group', 'lottie'], defaultDurationMs: 480 },
  float_up: { label: 'Float Up', libraryId: 'motion-attention', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 1200 },
  glitch_in: { label: 'Glitch In', libraryId: 'motion-attention', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 500 },

  // Text Pro
  soft_blur_in: { label: 'Soft Blur In', libraryId: 'motion-text-pro', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 700 },
  rise_fade: { label: 'Rise Fade', libraryId: 'motion-text-pro', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 600 },
  cascade_in: { label: 'Cascade In', libraryId: 'motion-text-pro', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 550 },
  stamp_in: { label: 'Stamp In', libraryId: 'motion-text-pro', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 320 },
  wipe_reveal: { label: 'Wipe Reveal', libraryId: 'motion-text-pro', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 520 },
  punch_zoom: { label: 'Punch Zoom', libraryId: 'motion-attention', targets: ['text', 'shape', 'image', 'icon', 'group'], defaultDurationMs: 420 },
  parallax_drift: { label: 'Parallax Drift', libraryId: 'motion-attention', targets: ['shape', 'image', 'video', 'icon', 'group'], defaultDurationMs: 1400 },
  light_sweep: { label: 'Light Sweep', libraryId: 'motion-expressive', targets: ['shape', 'image', 'video', 'group'], defaultDurationMs: 900 },
};

function normalizeCreativeLibraryId(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function getEnabledCreativeLibraryIds(input = []) {
  const ids = new Set(DEFAULT_CREATIVE_LIBRARY_IDS);
  (Array.isArray(input) ? input : []).forEach((value) => {
    const normalized = normalizeCreativeLibraryId(value);
    if (normalized) ids.add(normalized);
  });
  return [...ids];
}

function isCreativeLibraryEnabled(libraryId, enabledIds = []) {
  const normalized = normalizeCreativeLibraryId(libraryId);
  if (!normalized) return true;
  return new Set(getEnabledCreativeLibraryIds(enabledIds)).has(normalized);
}

function getCustomAnimationPresets(customPacks = runtimeCreativeCustomLibraryPacks) {
  return (Array.isArray(customPacks) ? customPacks : []).flatMap((pack) => (
    Array.isArray(pack?.animationPresets) ? pack.animationPresets : []
  ));
}

function getCustomAnimationPresetById(presetId, customPacks = runtimeCreativeCustomLibraryPacks) {
  const normalizedId = normalizeAnimationPresetId(presetId, '');
  return getCustomAnimationPresets(customPacks).find((preset) => preset?.id === normalizedId) || null;
}

function buildCreativeLibraryCatalog(customPacks = runtimeCreativeCustomLibraryPacks) {
  const customCatalog = (Array.isArray(customPacks) ? customPacks : []).map((pack) => ({
    ...pack,
    source: 'custom',
  }));
  return [...CREATIVE_LIBRARY_PACKS, ...customCatalog];
}

export function setCreativeLibraryRuntimePacks(input = []) {
  runtimeCreativeCustomLibraryPacks = (Array.isArray(input) ? input : [])
    .map((pack) => normalizeCreativeLibraryPackManifest(pack))
    .filter(Boolean);
  return runtimeCreativeCustomLibraryPacks;
}

export function getCreativeLibraryPackCatalog(customPacks = runtimeCreativeCustomLibraryPacks) {
  return buildCreativeLibraryCatalog(customPacks);
}

export function getCreativeElementLibrary(enabledIds = [], customPacks = runtimeCreativeCustomLibraryPacks) {
  const library = {};
  Object.entries(CREATIVE_ELEMENT_LIBRARY).forEach(([section, items]) => {
    const filtered = (Array.isArray(items) ? items : []).filter((item) => (
      isCreativeLibraryEnabled(item?.libraryId, enabledIds)
    ));
    if (filtered.length) library[section] = filtered;
  });
  (Array.isArray(customPacks) ? customPacks : []).forEach((pack) => {
    if (!isCreativeLibraryEnabled(pack?.id, enabledIds)) return;
    CREATIVE_LIBRARY_SECTIONS.forEach((section) => {
      const packItems = Array.isArray(pack?.elements?.[section]) ? pack.elements[section].map((item) => cloneData(item)) : [];
      if (!packItems.length) return;
      library[section] = [...(Array.isArray(library[section]) ? library[section] : []), ...packItems];
    });
  });
  return library;
}

export function getCreativeAnimationPresetCatalog(enabledIds = [], elementType = '', customPacks = runtimeCreativeCustomLibraryPacks) {
  const normalizedType = String(elementType || '').trim().toLowerCase();
  const builtin = Object.entries(CREATIVE_ANIMATION_PRESET_META)
    .filter(([, meta]) => (
      isCreativeLibraryEnabled(meta?.libraryId, enabledIds)
      && (!normalizedType || !Array.isArray(meta?.targets) || meta.targets.includes(normalizedType))
    ))
    .map(([id, meta]) => ({
      id,
      label: meta?.label || id,
      libraryId: meta?.libraryId || '',
      targets: Array.isArray(meta?.targets) ? meta.targets.slice() : [],
      defaultDurationMs: Math.max(100, Number(meta?.defaultDurationMs) || 500),
    }));
  const custom = getCustomAnimationPresets(customPacks)
    .filter((preset) => (
      isCreativeLibraryEnabled(preset?.libraryId, enabledIds)
      && (!normalizedType || !Array.isArray(preset?.targets) || preset.targets.includes(normalizedType))
    ))
    .map((preset) => ({
      id: preset.id,
      label: preset.label || preset.id,
      libraryId: preset.libraryId || '',
      targets: Array.isArray(preset.targets) ? preset.targets.slice() : [],
      defaultDurationMs: Math.max(100, Number(preset?.defaultDurationMs) || 500),
    }));
  return [...builtin, ...custom];
}

function createId(prefix = 'el') {
  const rand = typeof crypto !== 'undefined' && crypto?.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}

function cloneMeta(meta) {
  return meta && typeof meta === 'object' ? JSON.parse(JSON.stringify(meta)) : {};
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return target;
  Object.entries(source).forEach(([key, value]) => {
    if (isPlainObject(value)) {
      const base = isPlainObject(target[key]) ? target[key] : {};
      target[key] = deepMerge({ ...base }, value);
      return;
    }
    target[key] = Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : value;
  });
  return target;
}

function getComponentMetaDefaults(component = 'card') {
  const normalized = String(component || 'card').trim().toLowerCase();
  if (normalized === 'button') {
    return {
      component: 'button',
      label: 'Get Started',
      background: '#f97316',
      textColor: '#fff7ed',
      accent: '#fdba74',
      radius: 999,
    };
  }
  if (normalized === 'badge') {
    return {
      component: 'badge',
      label: 'Featured',
      background: '#1f2937',
      textColor: '#f8fafc',
      accent: '#38bdf8',
      radius: 999,
    };
  }
  if (normalized === 'divider') {
    return {
      component: 'divider',
      label: 'Section divider',
      stroke: '#475569',
      textColor: '#cbd5e1',
      accent: '#f97316',
    };
  }
  if (normalized === 'stat') {
    return {
      component: 'stat',
      label: 'Conversion',
      value: '24%',
      background: '#111827',
      textColor: '#f8fafc',
      accent: '#f97316',
      radius: 24,
    };
  }
  if (normalized === 'quote') {
    return {
      component: 'quote',
      quote: 'Design the system, then let it move.',
      author: 'Prometheus',
      background: '#111827',
      textColor: '#f8fafc',
      accent: '#38bdf8',
      radius: 24,
    };
  }
  if (normalized === 'cta-card') {
    return {
      component: 'cta-card',
      title: 'Ready to build faster?',
      body: 'Turn ideas into polished creative with reusable systems.',
      label: 'Get started',
      background: '#111827',
      textColor: '#f8fafc',
      accent: '#FFCB1F',
      radius: 28,
    };
  }
  if (normalized === 'caption-block') {
    return {
      component: 'caption-block',
      title: 'Reusable motion templates',
      body: 'Captions, presets, and QA gates become one creative workflow.',
      background: '#050608',
      textColor: '#f8fafc',
      accent: '#16D9FF',
      radius: 24,
    };
  }
  if (normalized === 'feature-card') {
    return {
      component: 'feature-card',
      title: 'Feature',
      body: 'Add a concise benefit, proof point, or product capability.',
      iconName: 'solar:bolt-bold-duotone',
      background: '#ffffff',
      textColor: '#111827',
      accent: '#2563EB',
      radius: 24,
    };
  }
  if (normalized === 'logo-lockup') {
    return {
      component: 'logo-lockup',
      label: 'Prometheus',
      body: 'Creative Mode',
      iconName: 'solar:stars-bold-duotone',
      background: 'rgba(255,255,255,.08)',
      textColor: '#f8fafc',
      accent: '#FFCB1F',
      radius: 24,
    };
  }
  if (normalized === 'lower-third') {
    return {
      component: 'lower-third',
      title: 'Main takeaway',
      body: 'A short supporting line goes here.',
      background: 'rgba(15,23,42,.92)',
      textColor: '#f8fafc',
      accent: '#38BDF8',
      radius: 24,
    };
  }
  if (normalized === 'product-callout') {
    return {
      component: 'product-callout',
      title: 'Product benefit',
      body: 'Show what changes for the viewer.',
      iconName: 'solar:cursor-bold-duotone',
      background: '#111827',
      textColor: '#f8fafc',
      accent: '#22C55E',
      radius: 28,
    };
  }
  return {
    component: 'card',
    title: 'Feature card',
    body: 'Use starter components to block in polished layouts quickly.',
    background: '#111827',
    textColor: '#f8fafc',
    accent: '#f97316',
    radius: 24,
  };
}

function normalizeAudioTrack(input = {}) {
  return {
    source: String(input?.source || ''),
    label: String(input?.label || ''),
    startMs: Math.max(0, Number(input?.startMs) || 0),
    durationMs: Math.max(0, Number(input?.durationMs) || 0),
    trimStartMs: Math.max(0, Number(input?.trimStartMs) || 0),
    trimEndMs: Math.max(0, Number(input?.trimEndMs) || 0),
    volume: clamp(Number.isFinite(Number(input?.volume)) ? Number(input.volume) : 1, 0, 1),
    muted: input?.muted === true,
    fadeInMs: Math.max(0, Number(input?.fadeInMs) || 0),
    fadeOutMs: Math.max(0, Number(input?.fadeOutMs) || 0),
    analysis: input?.analysis && typeof input.analysis === 'object' && !Array.isArray(input.analysis)
      ? cloneData(input.analysis)
      : null,
  };
}

function normalizeTimelineClip(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const startMs = Math.max(0, Number(source.startMs ?? source.timelineStartMs) || 0);
  const durationMs = Number.isFinite(Number(source.durationMs ?? source.timelineDurationMs))
    ? Math.max(1, Number(source.durationMs ?? source.timelineDurationMs))
    : null;
  const endMs = Number.isFinite(Number(source.endMs))
    ? Math.max(startMs + 1, Number(source.endMs))
    : (durationMs ? startMs + durationMs : null);
  return {
    startMs,
    endMs,
    durationMs: endMs ? Math.max(1, endMs - startMs) : durationMs,
    trimStartMs: Math.max(0, Number(source.trimStartMs) || 0),
    trimEndMs: Math.max(0, Number(source.trimEndMs) || 0),
    speed: Math.max(0.05, Number(source.speed) || 1),
    loop: source.loop === true,
  };
}

function normalizeBlendMode(raw = '') {
  const normalized = String(raw || '').trim().toLowerCase();
  const allowed = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
  return allowed.has(normalized) ? normalized : 'normal';
}

function normalizeMask(input = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const type = String(input.type || input.shape || 'rect').trim().toLowerCase();
  const allowed = new Set(['rect', 'rounded-rect', 'ellipse', 'circle', 'polygon', 'path', 'inset']);
  return {
    type: allowed.has(type) ? type : 'rect',
    x: Number.isFinite(Number(input.x)) ? Number(input.x) : 0,
    y: Number.isFinite(Number(input.y)) ? Number(input.y) : 0,
    width: Number.isFinite(Number(input.width)) ? Math.max(1, Number(input.width)) : null,
    height: Number.isFinite(Number(input.height)) ? Math.max(1, Number(input.height)) : null,
    radius: Math.max(0, Number(input.radius) || 0),
    path: input.path ? String(input.path) : null,
    points: Array.isArray(input.points) ? input.points.slice(0, 24) : null,
    feather: Math.max(0, Number(input.feather) || 0),
    inverted: input.inverted === true,
  };
}

function normalizeEffect(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = String(input.id || createId('fx'));
  const type = String(input.type || input.effect || 'blur').trim().toLowerCase();
  const startMs = Math.max(0, Number(input.startMs) || 0);
  const durationMs = Math.max(1, Number(input.durationMs) || 1);
  const enabled = input.enabled !== false;
  const params = input.params && typeof input.params === 'object' && !Array.isArray(input.params)
    ? cloneData(input.params)
    : {};
  ['amount', 'from', 'to', 'angle', 'opacity', 'scale', 'x', 'y', 'radius', 'intensity'].forEach((key) => {
    if (Number.isFinite(Number(input[key])) && params[key] === undefined) params[key] = Number(input[key]);
  });
  if (input.color && params.color === undefined) params.color = String(input.color);
  return { id, type, startMs, durationMs, enabled, params };
}

function normalizeEffectStack(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((entry) => normalizeEffect(entry))
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeSceneBrandKit(input = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const colors = input.colors && typeof input.colors === 'object' && !Array.isArray(input.colors) ? input.colors : {};
  const fonts = input.fonts && typeof input.fonts === 'object' && !Array.isArray(input.fonts) ? input.fonts : {};
  return {
    id: String(input.id || 'brand'),
    name: String(input.name || 'Brand'),
    colors: {
      primary: String(colors.primary || '#ff4d2d'),
      secondary: String(colors.secondary || '#111827'),
      accent: String(colors.accent || '#f7c948'),
      background: String(colors.background || '#0f172a'),
      text: String(colors.text || '#ffffff'),
    },
    fonts: {
      heading: String(fonts.heading || 'Inter'),
      body: String(fonts.body || 'Inter'),
    },
    logo: input.logo ? String(input.logo) : null,
    motion: input.motion && typeof input.motion === 'object' && !Array.isArray(input.motion) ? cloneData(input.motion) : {},
    components: input.components && typeof input.components === 'object' && !Array.isArray(input.components) ? cloneData(input.components) : {},
  };
}

function normalizeElement(element) {
  const next = {
    ...element,
    meta: cloneMeta(element.meta),
  };
  next.opacity = clamp(Number.isFinite(Number(next.opacity)) ? Number(next.opacity) : 1, 0, 1);
  next.rotation = Number.isFinite(Number(next.rotation)) ? Number(next.rotation) : 0;
  next.visible = next.visible !== false;
  next.locked = next.locked === true;
  next.x = Number.isFinite(Number(next.x)) ? Number(next.x) : 0;
  next.y = Number.isFinite(Number(next.y)) ? Number(next.y) : 0;
  next.width = Math.max(8, Number(next.width) || 120);
  next.height = Math.max(8, Number(next.height) || 120);
  if (!Array.isArray(next.meta.keyframes)) next.meta.keyframes = [];
  next.meta.timeline = normalizeTimelineClip({
    ...(next.meta.timeline && typeof next.meta.timeline === 'object' ? next.meta.timeline : {}),
    startMs: next.meta.startMs ?? next.meta.timelineStartMs,
    endMs: next.meta.endMs,
    durationMs: next.meta.durationMs ?? next.meta.timelineDurationMs,
    trimStartMs: next.meta.trimStartMs,
    trimEndMs: next.meta.trimEndMs,
    speed: next.meta.speed,
    loop: next.meta.loop,
  });
  next.meta.startMs = next.meta.timeline.startMs;
  if (next.meta.timeline.endMs != null) next.meta.endMs = next.meta.timeline.endMs;
  if (next.meta.timeline.durationMs != null) next.meta.durationMs = next.meta.timeline.durationMs;
  next.meta.timelineStartMs = next.meta.timeline.startMs;
  if (next.meta.timeline.durationMs != null) next.meta.timelineDurationMs = next.meta.timeline.durationMs;
  next.meta.trimStartMs = next.meta.timeline.trimStartMs;
  next.meta.trimEndMs = next.meta.timeline.trimEndMs;
  next.meta.speed = next.meta.timeline.speed;
  next.meta.loop = next.meta.timeline.loop;
  next.meta.blendMode = normalizeBlendMode(next.meta.blendMode);
  next.meta.mask = normalizeMask(next.meta.mask);
  next.meta.effectStack = normalizeEffectStack(next.meta.effectStack);

  if (next.type === 'text') {
    next.meta.content = String(next.meta.content || 'Text');
    next.meta.fontSize = Math.max(10, Number(next.meta.fontSize) || 24);
    next.meta.fontWeight = Number(next.meta.fontWeight) || 700;
    next.meta.fontFamily = String(next.meta.fontFamily || 'Manrope');
    next.meta.fontStyle = String(next.meta.fontStyle || 'normal');
    next.meta.lineHeight = Math.max(1, Number(next.meta.lineHeight) || 1.2);
    next.meta.letterSpacing = Number(next.meta.letterSpacing) || 0;
    next.meta.textAlign = String(next.meta.textAlign || 'left');
    next.meta.color = next.meta.color || '#111827';
    const measurement = measureTextBlock(next.meta.content, buildTextFontSpec(next.meta), next.width, next.meta.lineHeight, {
      fontSize: next.meta.fontSize,
      fontWeight: next.meta.fontWeight,
      fontFamily: next.meta.fontFamily,
      fontStyle: next.meta.fontStyle,
    });
    next.height = Math.max(8, measurement.height);
    next.meta.layoutMeasured = true;
    next.meta.pretextMeasured = measurement.kind === 'pretext';
    next.meta.measurement = {
      kind: measurement.kind,
      lineCount: measurement.lineCount,
      height: measurement.height,
      lineHeightPx: measurement.lineHeightPx,
      fontSpec: measurement.fontSpec,
    };
  }

  if (next.type === 'icon') {
    next.meta.iconName = next.meta.iconName || 'solar:stars-bold-duotone';
    next.meta.color = next.meta.color || '#111827';
    const size = Math.max(24, Math.min(next.width, next.height));
    next.width = size;
    next.height = size;
  }

  if (next.type === 'shape') {
    next.meta.shape = next.meta.shape || 'rect';
    next.meta.fill = next.meta.fill || '#111827';
    next.meta.stroke = next.meta.stroke || 'transparent';
    next.meta.strokeWidth = Math.max(0, Number(next.meta.strokeWidth) || 0);
    next.meta.radius = Math.max(0, Number(next.meta.radius) || 0);
    next.meta.sides = Math.max(5, Math.min(8, Number(next.meta.sides) || 6));
    if (next.meta.shape === 'circle') {
      const size = Math.max(next.width, next.height);
      next.width = size;
      next.height = size;
      next.meta.radius = Math.max(next.meta.radius, Math.floor(size / 2));
    }
    if (next.meta.shape === 'line' || next.meta.shape === 'arrow') {
      next.height = Math.max(2, Number(next.meta.strokeWidth) || 2);
    }
  }

  if (next.type === 'image') {
    next.meta.fit = next.meta.fit || 'cover';
    next.meta.radius = Math.max(0, Number(next.meta.radius) || 18);
  }

  if (next.type === 'video') {
    next.meta.fit = next.meta.fit || 'cover';
    next.meta.radius = Math.max(0, Number(next.meta.radius) || 18);
    next.meta.source = next.meta.source ? String(next.meta.source) : '';
    next.meta.poster = next.meta.poster ? String(next.meta.poster) : '';
    next.meta.muted = next.meta.muted !== false;
    next.meta.volume = clamp(Number.isFinite(Number(next.meta.volume)) ? Number(next.meta.volume) : 0, 0, 1);
    next.meta.trimStartMs = Math.max(0, Number(next.meta.trimStartMs) || 0);
    next.meta.trimEndMs = Math.max(0, Number(next.meta.trimEndMs) || 0);
    next.meta.timelineStartMs = Math.max(0, Number(next.meta.timelineStartMs) || 0);
    if (Number.isFinite(Number(next.meta.timelineDurationMs))) {
      next.meta.timelineDurationMs = Math.max(100, Number(next.meta.timelineDurationMs));
    }
  }

  if (next.type === 'group') {
    const defaults = getComponentMetaDefaults(next.meta.component || 'card');
    next.meta = {
      ...defaults,
      ...next.meta,
    };
    next.meta.radius = Math.max(0, Number(next.meta.radius) || Number(defaults.radius) || 0);
  }

  if (typeof next.meta.aspectLocked !== 'boolean') {
    next.meta.aspectLocked = (
      next.type === 'icon'
      || next.type === 'image'
      || next.type === 'video'
      || (next.type === 'shape' && ['circle', 'triangle', 'polygon'].includes(String(next.meta.shape || '').toLowerCase()))
    );
  }

  return next;
}

function getCreativeValidationBounds(element = {}) {
  return {
    left: Number(element.x) || 0,
    top: Number(element.y) || 0,
    right: (Number(element.x) || 0) + Math.max(0, Number(element.width) || 0),
    bottom: (Number(element.y) || 0) + Math.max(0, Number(element.height) || 0),
    width: Math.max(0, Number(element.width) || 0),
    height: Math.max(0, Number(element.height) || 0),
  };
}

function creativeBoundsOverlap(a, b) {
  if (!a || !b) return false;
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}

function addCreativeValidationIssue(issues, severity, code, message, elementIds = [], details = {}) {
  issues.push({
    severity,
    code,
    message,
    elementIds: Array.isArray(elementIds) ? elementIds.filter(Boolean) : [],
    ...details,
  });
}

export function validateCreativeSceneLayout(doc = {}, options = {}) {
  const width = Math.max(1, Number(doc.width) || 1080);
  const height = Math.max(1, Number(doc.height) || 1080);
  const mode = String(options.mode || doc.mode || '').toLowerCase();
  const safeMargin = Math.round(Math.min(width, height) * (mode === 'video' ? 0.055 : 0.04));
  const elements = (Array.isArray(doc.elements) ? doc.elements : [])
    .filter((element) => element && element.visible !== false && element.opacity !== 0 && element.locked !== true)
    .map((element) => normalizeElement(element));
  const issues = [];
  const textElements = elements.filter((element) => element.type === 'text');

  elements.forEach((element) => {
    const bounds = getCreativeValidationBounds(element);
    if (bounds.right < -2 || bounds.bottom < -2 || bounds.left > width + 2 || bounds.top > height + 2) {
      addCreativeValidationIssue(issues, 'error', 'off_canvas', `${element.id || element.type} is fully outside the canvas.`, [element.id], { bounds });
      return;
    }
    const unsafe = bounds.left < safeMargin || bounds.top < safeMargin || bounds.right > width - safeMargin || bounds.bottom > height - safeMargin;
    if (unsafe && ['text', 'group', 'icon'].includes(element.type)) {
      addCreativeValidationIssue(issues, 'warn', 'unsafe_margin', `${element.type} is inside the ${safeMargin}px safe-area margin.`, [element.id], { bounds, safeMargin });
    }
  });

  textElements.forEach((element) => {
    const content = String(element.meta?.content || '');
    const measurement = measureTextBlock(content, buildTextFontSpec(element.meta), element.width, element.meta?.lineHeight || 1.2, {
      fontSize: element.meta?.fontSize,
      fontWeight: element.meta?.fontWeight,
      fontFamily: element.meta?.fontFamily,
      fontStyle: element.meta?.fontStyle,
    });
    const manualLines = content.split('\n');
    if (measurement.height > element.height + Math.max(4, Number(element.meta?.fontSize || 24) * 0.25)) {
      addCreativeValidationIssue(issues, 'error', 'text_overflow', `Text "${content.slice(0, 42)}" is taller than its box.`, [element.id], { measuredHeight: measurement.height, boxHeight: element.height });
    }
    if (manualLines.some((line) => line.length <= 2 && content.length > 18)) {
      addCreativeValidationIssue(issues, 'error', 'broken_line_wrap', `Text "${content.slice(0, 42)}" contains one- or two-character line fragments.`, [element.id]);
    }
    if (/\b[A-Za-z]{3,}\s*\n\s*[A-Za-z]{1,2}\b|\b[A-Za-z]{1,2}\s*\n\s*[A-Za-z]{3,}\b/.test(content)) {
      addCreativeValidationIssue(issues, 'warn', 'suspicious_line_break', `Text "${content.slice(0, 42)}" may contain an awkward manual line break.`, [element.id]);
    }
    const longestWord = content.split(/\s+/).reduce((longest, word) => Math.max(longest, word.length), 0);
    if (longestWord > 16 && element.width < Number(element.meta?.fontSize || 24) * 9) {
      addCreativeValidationIssue(issues, 'warn', 'long_word_risk', `Text "${content.slice(0, 42)}" has a long word in a narrow box.`, [element.id]);
    }
  });

  const significant = elements.filter((element) => ['text', 'group', 'icon', 'image', 'video'].includes(element.type));
  for (let i = 0; i < significant.length; i += 1) {
    for (let j = i + 1; j < significant.length; j += 1) {
      const a = significant[i];
      const b = significant[j];
      const overlap = creativeBoundsOverlap(getCreativeValidationBounds(a), getCreativeValidationBounds(b));
      if (!overlap) continue;
      const smallerArea = Math.max(1, Math.min((Number(a.width) || 0) * (Number(a.height) || 0), (Number(b.width) || 0) * (Number(b.height) || 0)));
      if (overlap / smallerArea > 0.22) {
        addCreativeValidationIssue(issues, a.type === 'text' || b.type === 'text' ? 'error' : 'warn', 'element_overlap', `${a.type} and ${b.type} overlap significantly.`, [a.id, b.id], { overlapRatio: Number((overlap / smallerArea).toFixed(2)) });
      }
    }
  }

  const textCount = textElements.length;
  const graphicCount = elements.filter((element) => ['icon', 'image', 'video', 'group'].includes(element.type) || (element.type === 'shape' && Number(element.width || 0) * Number(element.height || 0) > width * height * 0.015)).length;
  if (mode === 'video' && textCount > 0 && graphicCount < 2) {
    addCreativeValidationIssue(issues, 'warn', 'basic_video_composition', 'Video scene has text but very few graphic/media/component anchors.', [], { textCount, graphicCount });
  }
  if (mode === 'video') {
    const animatedCount = elements.filter((element) => Array.isArray(element.meta?.keyframes) && element.meta.keyframes.length >= 2).length;
    if (elements.length >= 3 && animatedCount < 2) {
      addCreativeValidationIssue(issues, 'warn', 'weak_motion_progression', 'Video scene has few animated elements; sampled frames may look static.', [], { animatedCount });
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warnCount = issues.filter((issue) => issue.severity === 'warn').length;
  return {
    ok: errorCount === 0,
    errorCount,
    warnCount,
    safeMargin,
    issueCount: issues.length,
    issues,
  };
}

function deepSet(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

export function createSceneNode(input = {}) {
  const baseMeta = cloneMeta(DEFAULT_ELEMENT.meta);
  const nextMeta = cloneMeta(input.meta);
  return normalizeElement({
    ...DEFAULT_ELEMENT,
    ...input,
    id: input.id || createId('el'),
    type: input.type || DEFAULT_ELEMENT.type,
    meta: { ...baseMeta, ...nextMeta },
  });
}

export function createSceneDocument(input = {}) {
  const elements = Array.isArray(input.elements) ? input.elements.map((element) => createSceneNode(element)) : [];
  return {
    id: input.id || createId('scene'),
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
    width: Number.isFinite(Number(input.width)) ? Number(input.width) : 1280,
    height: Number.isFinite(Number(input.height)) ? Number(input.height) : 720,
    background: input.background || '#ffffff',
    durationMs: Math.max(1000, Number(input.durationMs) || 12000),
    frameRate: Math.max(1, Number(input.frameRate) || 60),
    audioTrack: normalizeAudioTrack(input.audioTrack),
    elements,
    motionTemplates: Array.isArray(input.motionTemplates)
      ? input.motionTemplates.map((entry) => normalizeMotionTemplateInstance(entry))
      : [],
    captions: Array.isArray(input.captions) ? cloneData(input.captions) : [],
    brandKit: normalizeSceneBrandKit(input.brandKit),
    selectedId: input.selectedId || null,
  };
}

export function findSceneElement(doc, id) {
  if (!doc || !Array.isArray(doc.elements)) return null;
  return doc.elements.find((element) => element.id === id) || null;
}

export function buildSceneSelectionContext(doc, id) {
  const element = findSceneElement(doc, id);
  if (!element) return null;
  const siblings = (doc.elements || [])
    .filter((candidate) => candidate.id !== id)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
    .map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
      zIndex: candidate.zIndex,
    }));
  return {
    element,
    siblings,
    canvas: {
      width: doc.width,
      height: doc.height,
      background: doc.background,
      durationMs: doc.durationMs,
      frameRate: doc.frameRate,
      audioTrack: normalizeAudioTrack(doc.audioTrack),
    },
  };
}

function applySetPatch(element, patch = {}) {
  Object.entries(patch).forEach(([key, value]) => {
    if (key.includes('.')) deepSet(element, key, value);
    else element[key] = value;
  });
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > 0;
}

function reflowTextDependents(elements, previousById, changedTextIds) {
  if (!changedTextIds.size) return elements;
  for (const textId of changedTextIds) {
    const current = elements.find((element) => element.id === textId && element.type === 'text');
    const previous = previousById.get(textId);
    if (!current || !previous) continue;
    const delta = Math.round((Number(current.height) || 0) - (Number(previous.height) || 0));
    if (!delta) continue;
    const previousBottom = (Number(previous.y) || 0) + (Number(previous.height) || 0);
    const currentLeft = Number(current.x) || 0;
    const currentRight = currentLeft + (Number(current.width) || 0);
    elements.forEach((candidate) => {
      if (!candidate || candidate.id === textId || candidate.locked) return;
      const candidateTop = Number(candidate.y) || 0;
      const candidateLeft = Number(candidate.x) || 0;
      const candidateRight = candidateLeft + (Number(candidate.width) || 0);
      if (candidateTop < previousBottom - 2) return;
      if (!rangesOverlap(currentLeft, currentRight, candidateLeft, candidateRight)) return;
      candidate.y += delta;
    });
  }
  return elements;
}

function createKeyframeFromElement(element, atMs = 0) {
  return {
    id: createId('kf'),
    atMs: Math.max(0, Number(atMs) || 0),
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    opacity: element.opacity,
    rotation: element.rotation,
  };
}

function buildPresetStateFromRecipe(element, recipe = {}) {
  const baseWidth = Math.max(1, Number(element?.width) || 1);
  const baseHeight = Math.max(1, Number(element?.height) || 1);
  const scale = Number.isFinite(Number(recipe?.scale)) ? Math.max(0.05, Number(recipe.scale)) : null;
  const width = Number.isFinite(Number(recipe?.width))
    ? Math.max(1, Number(recipe.width))
    : (scale ? Math.max(1, Math.round(baseWidth * scale)) : baseWidth);
  const height = Number.isFinite(Number(recipe?.height))
    ? Math.max(1, Number(recipe.height))
    : (scale ? Math.max(1, Math.round(baseHeight * scale)) : baseHeight);
  const hasExplicitX = Number.isFinite(Number(recipe?.x));
  const hasExplicitY = Number.isFinite(Number(recipe?.y));
  const xOffset = Number.isFinite(Number(recipe?.xOffset)) ? Number(recipe.xOffset) : 0;
  const yOffset = Number.isFinite(Number(recipe?.yOffset)) ? Number(recipe.yOffset) : 0;
  const centerXOffset = !hasExplicitX && width !== baseWidth ? Math.round((baseWidth - width) / 2) : 0;
  const centerYOffset = !hasExplicitY && height !== baseHeight ? Math.round((baseHeight - height) / 2) : 0;
  return {
    x: hasExplicitX ? Number(recipe.x) : (Number(element?.x) || 0) + centerXOffset + xOffset,
    y: hasExplicitY ? Number(recipe.y) : (Number(element?.y) || 0) + centerYOffset + yOffset,
    width,
    height,
    opacity: Number.isFinite(Number(recipe?.opacity)) ? clamp(Number(recipe.opacity), 0, 1) : (Number(element?.opacity) || 1),
    rotation: Number.isFinite(Number(recipe?.rotation)) ? Number(recipe.rotation) : (Number(element?.rotation) || 0),
  };
}

function buildCustomAnimationPreset(preset, element, startMs = 0, durationMs = 400) {
  if (!preset) return { keyframes: [], metaPatch: null };
  const safeStartMs = Math.max(0, Number(startMs) || 0);
  const safeDurationMs = Math.max(100, Number(durationMs) || Number(preset?.defaultDurationMs) || 400);
  const ease = String(preset?.ease || 'power2.out').trim() || 'power2.out';
  const fromState = buildPresetStateFromRecipe(element, preset.from || {});
  const toState = buildPresetStateFromRecipe(element, preset.to || {});
  const holdMs = Math.max(0, Number(preset?.holdMs) || 0);
  const keyframes = [
    {
      id: createId('kf'),
      atMs: safeStartMs,
      ...fromState,
      ease,
    },
    {
      id: createId('kf'),
      atMs: safeStartMs + safeDurationMs,
      ...toState,
      ease,
    },
  ];
  if (holdMs > 0) {
    keyframes.push({
      id: createId('kf'),
      atMs: safeStartMs + safeDurationMs + holdMs,
      ...toState,
      ease,
    });
  }
  const effects = preset?.effects && typeof preset.effects === 'object' && !Array.isArray(preset.effects)
    ? preset.effects
    : null;
  const metaPatch = effects ? { motionEffects: {} } : null;
  if (metaPatch && effects?.blurIn) {
    metaPatch.motionEffects.blurIn = {
      startMs: safeStartMs,
      durationMs: safeDurationMs,
      fromPx: Number.isFinite(Number(effects.blurIn.fromPx)) ? Number(effects.blurIn.fromPx) : 18,
      toPx: Number.isFinite(Number(effects.blurIn.toPx)) ? Number(effects.blurIn.toPx) : 0,
    };
  }
  if (metaPatch && effects?.typewriter && String(element?.type || '').toLowerCase() === 'text') {
    metaPatch.motionEffects.typewriter = {
      startMs: safeStartMs,
      durationMs: safeDurationMs,
      sourceContent: String(effects.typewriter.sourceContent || element?.meta?.content || ''),
    };
  }
  return {
    keyframes,
    metaPatch: metaPatch && Object.keys(metaPatch.motionEffects).length ? metaPatch : null,
  };
}

function extractJsonCandidates(text) {
  const source = String(text || '');
  const candidates = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fence;
  while ((fence = fenceRegex.exec(source)) !== null) {
    const chunk = String(fence[1] || '').trim();
    if (chunk) candidates.push(chunk);
  }
  const stack = [];
  let start = -1;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      if (!stack.length) start = i;
      stack.push(ch);
    } else if (ch === '}' && stack.length) {
      stack.pop();
      if (!stack.length && start >= 0) {
        const chunk = source.slice(start, i + 1).trim();
        if (chunk) candidates.push(chunk);
        start = -1;
      }
    }
  }
  return candidates;
}

export function parseCreativeOpsFromText(text) {
  const candidates = extractJsonCandidates(text);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && Array.isArray(parsed.ops)) {
        return {
          matched: true,
          ops: parsed.ops,
          payload: parsed,
          source: candidate,
        };
      }
    } catch {
      // keep scanning
    }
  }
  return { matched: false, ops: [], payload: null, source: '' };
}

export function getCreativePatchInstruction(mode = 'canvas') {
  const label = mode === 'video' ? 'video scene' : 'canvas scene';
  return [
    '[CREATIVE_PATCH_PROTOCOL]',
    `When editing the live ${label}, prefer returning a JSON object with an "ops" array inside a \`\`\`json fenced block.`,
    'Each op must be typed and deterministic. Supported ops: add, delete, set, move, resize, swap-icon, set-keyframes, add-keyframe, move-keyframe, delete-keyframe, set-ease, add-animation-preset.',
    'Use existing element IDs when changing the current scene. Only add new IDs when creating new elements.',
  ].join('\n');
}

function interpolateNumber(a, b, t) {
  return a + ((b - a) * t);
}

function easePowerIn(t, power = 2) {
  return Math.pow(t, power);
}

function easePowerOut(t, power = 2) {
  return 1 - Math.pow(1 - t, power);
}

function easePowerInOut(t, power = 2) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < 0.5) return Math.pow(t * 2, power) / 2;
  return 1 - (Math.pow((1 - t) * 2, power) / 2);
}

function easeBackIn(t, overshoot = 1.70158) {
  const c3 = overshoot + 1;
  return (c3 * t * t * t) - (overshoot * t * t);
}

function easeBackOut(t, overshoot = 1.70158) {
  const c3 = overshoot + 1;
  const shifted = t - 1;
  return 1 + (c3 * shifted * shifted * shifted) + (overshoot * shifted * shifted);
}

function easeBackInOut(t, overshoot = 1.70158) {
  const c2 = overshoot * 1.525;
  if (t < 0.5) {
    const scaled = 2 * t;
    return (scaled * scaled * ((c2 + 1) * scaled - c2)) / 2;
  }
  const scaled = (2 * t) - 2;
  return (scaled * scaled * ((c2 + 1) * scaled + c2) + 2) / 2;
}

function applyTimelineEase(progress, easeName = '') {
  const t = clamp(Number(progress) || 0, 0, 1);
  const normalized = String(easeName || '').trim().toLowerCase();
  if (!normalized || normalized === 'linear' || normalized === 'none') return t;

  const backMatch = normalized.match(/^back\.(in|out|inout)(?:\(([-\d.]+)\))?$/);
  if (backMatch) {
    const variant = backMatch[1];
    const overshoot = Number.isFinite(Number(backMatch[2])) ? Number(backMatch[2]) : 1.70158;
    if (variant === 'in') return easeBackIn(t, overshoot);
    if (variant === 'inout') return easeBackInOut(t, overshoot);
    return easeBackOut(t, overshoot);
  }

  const powerMap = {
    quad: 2,
    cubic: 3,
    quart: 4,
    quint: 5,
  };

  const powerMatch = normalized.match(/^(?:(power)([1-5])|(quad|cubic|quart|quint))(?:\.)?(in|out|inout)$/);
  if (powerMatch) {
    const power = powerMatch[2] ? Number(powerMatch[2]) : powerMap[powerMatch[3]] || 2;
    const variant = powerMatch[4];
    if (variant === 'in') return easePowerIn(t, power);
    if (variant === 'inout') return easePowerInOut(t, power);
    return easePowerOut(t, power);
  }

  if (normalized === 'easein') return easePowerIn(t, 2);
  if (normalized === 'easeout') return easePowerOut(t, 2);
  if (normalized === 'easeinout') return easePowerInOut(t, 2);
  return t;
}

export function resolveElementAtTime(element, atMs = 0) {
  const base = createSceneNode(element || {});
  const keyframes = Array.isArray(base.meta?.keyframes)
    ? base.meta.keyframes
        .map((keyframe) => ({
          ...keyframe,
          atMs: Math.max(0, Number(keyframe?.atMs) || 0),
        }))
        .sort((a, b) => a.atMs - b.atMs)
    : [];
  if (!keyframes.length) return base;
  const currentMs = Math.max(0, Number(atMs) || 0);
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (currentMs <= first.atMs) {
    return createSceneNode({
      ...base,
      x: first.x ?? base.x,
      y: first.y ?? base.y,
      width: first.width ?? base.width,
      height: first.height ?? base.height,
      opacity: first.opacity ?? base.opacity,
      rotation: first.rotation ?? base.rotation,
    });
  }
  if (currentMs >= last.atMs) {
    return createSceneNode({
      ...base,
      x: last.x ?? base.x,
      y: last.y ?? base.y,
      width: last.width ?? base.width,
      height: last.height ?? base.height,
      opacity: last.opacity ?? base.opacity,
      rotation: last.rotation ?? base.rotation,
    });
  }
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const left = keyframes[i];
    const right = keyframes[i + 1];
    if (currentMs < left.atMs || currentMs > right.atMs) continue;
    const span = Math.max(1, right.atMs - left.atMs);
    const t = clamp((currentMs - left.atMs) / span, 0, 1);
    const easedT = applyTimelineEase(t, right.ease || left.ease || '');
    return createSceneNode({
      ...base,
      x: interpolateNumber(left.x ?? base.x, right.x ?? base.x, easedT),
      y: interpolateNumber(left.y ?? base.y, right.y ?? base.y, easedT),
      width: interpolateNumber(left.width ?? base.width, right.width ?? base.width, easedT),
      height: interpolateNumber(left.height ?? base.height, right.height ?? base.height, easedT),
      opacity: interpolateNumber(left.opacity ?? base.opacity, right.opacity ?? base.opacity, easedT),
      rotation: interpolateNumber(left.rotation ?? base.rotation, right.rotation ?? base.rotation, easedT),
    });
  }
  return base;
}

export function applySceneGraphOps(doc, ops = []) {
  const nextDoc = createSceneDocument(doc || {});
  const previousById = new Map(nextDoc.elements.map((element) => [element.id, createSceneNode(element)]));
  const nextElements = [...nextDoc.elements];
  const changedTextIds = new Set();
  for (const rawOp of Array.isArray(ops) ? ops : []) {
    const op = rawOp || {};
    const kind = String(op.op || '').trim().toLowerCase();
    if (!kind) continue;
    if (kind === 'add-motion-template') {
      nextDoc.motionTemplates = [
        ...(Array.isArray(nextDoc.motionTemplates) ? nextDoc.motionTemplates : []),
        normalizeMotionTemplateInstance(op.template || op.instance || op.patch || op),
      ];
      continue;
    }
    if (kind === 'set-motion-template') {
      const id = String(op.id || op.templateId || '').trim();
      if (!id) continue;
      nextDoc.motionTemplates = (Array.isArray(nextDoc.motionTemplates) ? nextDoc.motionTemplates : [])
        .map((entry) => entry.id === id ? normalizeMotionTemplateInstance({ ...entry, ...(op.patch || {}) }) : entry);
      continue;
    }
    if (kind === 'delete-motion-template') {
      const id = String(op.id || op.templateId || '').trim();
      if (!id) continue;
      nextDoc.motionTemplates = (Array.isArray(nextDoc.motionTemplates) ? nextDoc.motionTemplates : [])
        .filter((entry) => entry.id !== id);
      continue;
    }
    if (kind === 'set-brand-kit' || kind === 'apply-brand-kit') {
      nextDoc.brandKit = normalizeSceneBrandKit(op.brandKit || op.patch?.brandKit || op.patch || op);
      if (kind === 'apply-brand-kit' && nextDoc.brandKit) {
        nextDoc.background = nextDoc.brandKit.colors.background || nextDoc.background;
        nextElements.forEach((element) => {
          if (element.type === 'text') {
            element.meta.color = element.meta.color || nextDoc.brandKit.colors.text;
            element.meta.fontFamily = element.meta.fontFamily || nextDoc.brandKit.fonts.body;
          }
          if (element.type === 'shape' && (!element.meta.fill || element.meta.fill === '#111827')) {
            element.meta.fill = nextDoc.brandKit.colors.secondary;
          }
          if (element.type === 'icon') {
            element.meta.color = element.meta.color || nextDoc.brandKit.colors.accent;
          }
        });
      }
      continue;
    }
    if (kind === 'add') {
      nextElements.push(createSceneNode(op));
      continue;
    }
    if (kind === 'delete') {
      const idx = nextElements.findIndex((element) => element.id === op.id);
      if (idx !== -1) nextElements.splice(idx, 1);
      continue;
    }
    const element = nextElements.find((candidate) => candidate.id === op.id);
    if (!element) continue;
    if (kind === 'set') {
      applySetPatch(element, op.patch || {});
      if (element.type === 'text') changedTextIds.add(element.id);
      continue;
    }
    if (kind === 'move') {
      applySetPatch(element, { x: op.patch?.x ?? element.x, y: op.patch?.y ?? element.y });
      continue;
    }
    if (kind === 'resize') {
      applySetPatch(element, { width: op.patch?.width ?? element.width, height: op.patch?.height ?? element.height });
      if (element.type === 'text') changedTextIds.add(element.id);
      continue;
    }
    if (kind === 'swap-icon') {
      applySetPatch(element, { 'meta.iconName': op.patch?.meta?.iconName || op.patch?.iconName || null });
      continue;
    }
    if (kind === 'set-clip' || kind === 'trim-clip') {
      const clipPatch = {
        ...(element.meta?.timeline || {}),
        ...(op.patch || {}),
      };
      const normalizedClip = normalizeTimelineClip(clipPatch);
      element.meta.timeline = normalizedClip;
      element.meta.startMs = normalizedClip.startMs;
      element.meta.timelineStartMs = normalizedClip.startMs;
      element.meta.trimStartMs = normalizedClip.trimStartMs;
      element.meta.trimEndMs = normalizedClip.trimEndMs;
      element.meta.speed = normalizedClip.speed;
      element.meta.loop = normalizedClip.loop;
      if (normalizedClip.endMs != null) element.meta.endMs = normalizedClip.endMs;
      if (normalizedClip.durationMs != null) {
        element.meta.durationMs = normalizedClip.durationMs;
        element.meta.timelineDurationMs = normalizedClip.durationMs;
      }
      continue;
    }
    if (kind === 'set-blend-mode') {
      element.meta.blendMode = normalizeBlendMode(op.patch?.blendMode || op.blendMode || op.mode);
      continue;
    }
    if (kind === 'set-mask' || kind === 'add-mask') {
      element.meta.mask = normalizeMask(op.patch?.mask || op.mask || op.patch || op);
      continue;
    }
    if (kind === 'delete-mask') {
      element.meta.mask = null;
      continue;
    }
    if (kind === 'set-effects' || kind === 'set-effect-stack') {
      element.meta.effectStack = normalizeEffectStack(op.patch?.effectStack || op.effectStack || op.effects || []);
      continue;
    }
    if (kind === 'add-effect') {
      const effect = normalizeEffect(op.patch?.effect || op.effect || op.patch || op);
      if (!effect) continue;
      element.meta.effectStack = [...normalizeEffectStack(element.meta.effectStack), effect].slice(0, 24);
      continue;
    }
    if (kind === 'delete-effect') {
      const effectId = String(op.patch?.id || op.effectId || op.id || '').trim();
      if (!effectId) continue;
      element.meta.effectStack = normalizeEffectStack(element.meta.effectStack).filter((effect) => effect.id !== effectId);
      continue;
    }
    if (kind === 'set-keyframes') {
      const rawKeyframes = Array.isArray(op.patch?.keyframes)
        ? op.patch.keyframes
        : (Array.isArray(op.keyframes) ? op.keyframes : []);
      element.meta.keyframes = rawKeyframes.length
        ? rawKeyframes.map((keyframe) => ({
            ...keyframe,
            id: keyframe?.id || createId('kf'),
            atMs: Math.max(0, Number(keyframe?.atMs) || 0),
          }))
        : [];
      continue;
    }
    if (kind === 'add-keyframe') {
      const atMs = op.patch?.atMs ?? op.atMs ?? 0;
      const base = createKeyframeFromElement(element, atMs);
      element.meta.keyframes = [...(Array.isArray(element.meta.keyframes) ? element.meta.keyframes : []), {
        ...base,
        ...(op.patch || {}),
        id: op.patch?.id || createId('kf'),
      }].sort((a, b) => (a.atMs || 0) - (b.atMs || 0));
      continue;
    }
    if (kind === 'move-keyframe') {
      const keyframeId = String(op.patch?.id || op.keyframeId || '').trim();
      const nextAtMs = Math.max(0, Number(op.patch?.atMs ?? op.atMs ?? op.toAtMs ?? op.patch?.toAtMs) || 0);
      if (!keyframeId) continue;
      element.meta.keyframes = (Array.isArray(element.meta.keyframes) ? element.meta.keyframes : [])
        .map((keyframe) => (
          keyframe?.id === keyframeId
            ? { ...keyframe, atMs: nextAtMs }
            : keyframe
        ))
        .sort((a, b) => (a.atMs || 0) - (b.atMs || 0));
      continue;
    }
    if (kind === 'delete-keyframe') {
      const keyframeId = String(op.patch?.id || op.keyframeId || '').trim();
      if (!keyframeId) continue;
      element.meta.keyframes = (Array.isArray(element.meta.keyframes) ? element.meta.keyframes : [])
        .filter((keyframe) => keyframe?.id !== keyframeId);
      continue;
    }
    if (kind === 'set-ease') {
      const targetAtMs = Number(op.patch?.atMs ?? op.atMs);
      const targetId = String(op.patch?.id || op.keyframeId || '').trim();
      const ease = String(op.patch?.ease || op.ease || '').trim();
      if (!ease) continue;
      element.meta.keyframes = (Array.isArray(element.meta.keyframes) ? element.meta.keyframes : []).map((keyframe) => {
        const idMatch = targetId && keyframe?.id === targetId;
        const timeMatch = Number.isFinite(targetAtMs) && Number(keyframe?.atMs) === targetAtMs;
        return (idMatch || timeMatch) ? { ...keyframe, ease } : keyframe;
      });
      continue;
    }
    if (kind === 'add-animation-preset') {
      const presetKey = normalizeAnimationPresetId(op.patch?.preset || op.preset, '');
      const builder = ANIMATION_PRESETS[presetKey];
      const customPreset = builder ? null : getCustomAnimationPresetById(presetKey);
      if (!builder && !customPreset) continue;
      const startMs = Math.max(0, Number(op.patch?.startMs ?? op.patch?.startT ?? op.startMs ?? op.startT) || 0);
      const durationMs = Math.max(100, Number(op.patch?.durationMs ?? op.patch?.duration ?? op.durationMs ?? op.duration) || 400);
      const built = builder
        ? builder({ element, startMs, durationMs })
        : buildCustomAnimationPreset(customPreset, element, startMs, durationMs);
      const presetResult = Array.isArray(built)
        ? { keyframes: built, metaPatch: null }
        : {
            keyframes: Array.isArray(built?.keyframes) ? built.keyframes : [],
            metaPatch: isPlainObject(built?.metaPatch) ? built.metaPatch : null,
          };
      const existing = Array.isArray(element.meta.keyframes) ? element.meta.keyframes : [];
      element.meta.keyframes = [...existing, ...presetResult.keyframes]
        .map((keyframe) => ({
          ...keyframe,
          id: keyframe?.id || createId('kf'),
          atMs: Math.max(0, Number(keyframe?.atMs) || 0),
        }))
        .sort((a, b) => (a.atMs || 0) - (b.atMs || 0));
      if (presetResult.metaPatch) {
        element.meta = deepMerge({ ...(element.meta || {}) }, presetResult.metaPatch);
      }
    }
  }
  nextDoc.elements = reflowTextDependents(
    nextElements
    .map((element, index) => normalizeElement({ ...element, zIndex: Number.isFinite(Number(element.zIndex)) ? Number(element.zIndex) : index }))
    .sort((a, b) => a.zIndex - b.zIndex),
    previousById,
    changedTextIds,
  );
  return nextDoc;
}

export function executeSceneGraphOps(doc, ops = []) {
  return applySceneGraphOps(doc, ops);
}
