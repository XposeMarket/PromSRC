import fs from 'fs';
import path from 'path';

export type CreativeStorageLike = {
  workspacePath: string;
  rootAbsPath: string;
  rootRelPath: string;
  creativeDir: string;
};

export type CreativeLibrarySource = 'builtin' | 'custom';
export type CreativeLibrarySection = 'text' | 'shapes' | 'icons' | 'images' | 'components';
export type CreativeAnimationTarget = 'text' | 'shape' | 'image' | 'icon' | 'group';

export type CreativeLibraryPackCatalogEntry = {
  id: string;
  label: string;
  category: 'core' | 'icons' | 'motion' | 'components' | 'shapes';
  description: string;
  includes: string[];
  defaultEnabled: boolean;
  source?: CreativeLibrarySource;
  enabled?: boolean;
  installedAt?: string | null;
  updatedAt?: string | null;
  manifestPath?: string | null;
  manifestPathRelative?: string | null;
  sourceUrl?: string | null;
  elements?: Partial<Record<CreativeLibrarySection, any[]>>;
  animationPresets?: any[];
};

export type CreativeLibraryRegistryEntry = {
  enabled: boolean;
  source: CreativeLibrarySource;
  installedAt: string;
  updatedAt: string;
  manifestPath?: string | null;
  manifestPathRelative?: string | null;
  sourceUrl?: string | null;
};

export type CreativeLibraryRegistry = {
  version: number;
  updatedAt: string;
  libraries: Record<string, CreativeLibraryRegistryEntry>;
};

export type CustomCreativeLibraryPack = CreativeLibraryPackCatalogEntry & {
  source: 'custom';
  elements: Partial<Record<CreativeLibrarySection, any[]>>;
  animationPresets: any[];
};

export type CustomHtmlMotionTemplate = {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultDurationMs: number;
  defaultFrameRate: number;
  requiredInputs: any[];
  optionalInputs: any[];
  parameters: any[];
  html: string;
  defaultInputs: Record<string, string>;
  source: 'custom';
  savedAt: string;
  updatedAt: string;
  manifestPath?: string | null;
  manifestPathRelative?: string | null;
};

export type CustomHtmlMotionBlock = {
  id: string;
  packId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  bestFor: string;
  slots: any[];
  requiredStageFeatures: string[];
  outputContract: {
    htmlRegion: boolean;
    usesTimingAttributes: boolean;
    usesPrometheusSeekEvent: boolean;
    assetPlaceholders: string[];
  };
  html: string;
  css: string;
  js: string;
  source: 'custom';
  savedAt: string;
  updatedAt: string;
  manifestPath?: string | null;
  manifestPathRelative?: string | null;
};

export type CustomSceneTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  bestFor: string;
  tags: string[];
  width: number;
  height: number;
  durationMs: number;
  frameRate: number;
  slots: any[];
  scene: any;
  source: 'custom';
  savedAt: string;
  updatedAt: string;
  manifestPath?: string | null;
  manifestPathRelative?: string | null;
};

const CREATIVE_LIBRARY_SECTIONS: CreativeLibrarySection[] = ['text', 'shapes', 'icons', 'images', 'components'];
const CREATIVE_LIBRARY_SECTION_TYPES: Record<CreativeLibrarySection, string> = {
  text: 'text',
  shapes: 'shape',
  icons: 'icon',
  images: 'image',
  components: 'group',
};
const CREATIVE_LIBRARY_CATEGORIES = new Set(['core', 'icons', 'motion', 'components', 'shapes']);
const CREATIVE_ANIMATION_TARGETS = new Set<CreativeAnimationTarget>(['text', 'shape', 'image', 'icon', 'group']);

export const BUILTIN_CREATIVE_LIBRARY_PACKS: CreativeLibraryPackCatalogEntry[] = [
  { id: 'core-foundation', label: 'Core Foundation', category: 'core', description: 'Base text, image, video, and shape primitives that power every scene.', includes: ['Text styles', 'Rect / circle / line', 'Image blocks', 'Video clips'], defaultEnabled: true },
  { id: 'iconify-essentials', label: 'Iconify Essentials', category: 'icons', description: 'Starter Iconify set for general UI, motion, and studio accents.', includes: ['Sparkles', 'Bolt', 'Lock', 'Direct icon name swaps'], defaultEnabled: true },
  { id: 'motion-core', label: 'Motion Core', category: 'motion', description: 'Foundational motion presets for fast entrance timing.', includes: ['Fade In', 'Slide Up', 'Fade + Up'], defaultEnabled: true },
  { id: 'components-core', label: 'Components Core', category: 'components', description: 'Starter components for cards, buttons, badges, and dividers.', includes: ['Card', 'Button', 'Badge', 'Divider'], defaultEnabled: true },
  { id: 'shapes-extended', label: 'Shapes Extended', category: 'shapes', description: 'Adds higher-level geometry so layouts do not stop at boxes and circles.', includes: ['Triangle', 'Polygon'], defaultEnabled: false },
  { id: 'motion-expressive', label: 'Motion Expressive', category: 'motion', description: 'Richer motion library for punchier entrances and text treatments.', includes: ['Scale Pop', 'Blur In', 'Typewriter'], defaultEnabled: false },
  { id: 'iconify-ui-pack', label: 'Iconify UI Pack', category: 'icons', description: 'A broader UI icon starter set for product shots, marketing frames, and dashboards.', includes: ['Camera', 'Globe', 'Palette', 'Chart'], defaultEnabled: false },
  { id: 'iconify-brand-pack', label: 'Iconify Brand Pack', category: 'icons', description: 'Brand icons for product mosaics, partner grids, and social compositions.', includes: ['GitHub', 'Figma', 'Slack'], defaultEnabled: false },
  { id: 'components-story-pack', label: 'Components Story Pack', category: 'components', description: 'Narrative-ready blocks for quotes, stats, and presentation frames.', includes: ['Stat', 'Quote'], defaultEnabled: false },
  { id: 'creative-ad-pack', label: 'Creative Ad Pack', category: 'components', description: 'Production-oriented ad primitives for promo videos, social posts, product launches, and conversion creative.', includes: ['Display Hook', 'CTA Card', 'Caption Block', 'Feature Card', 'Logo Lockup', 'Lower Third', 'Product Callout'], defaultEnabled: true },
  { id: 'motion-entrance', label: 'Motion Entrance Pack', category: 'motion', description: 'Directional, bouncy, and expressive entrance presets.', includes: ['Slide Left/Right/Down', 'Bounce In', 'Elastic Pop', 'Drop In'], defaultEnabled: true },
  { id: 'motion-exit', label: 'Motion Exit Pack', category: 'motion', description: 'Exit transitions for timeline compositions.', includes: ['Fade Out', 'Slide Out', 'Scale Out', 'Blur Out'], defaultEnabled: false },
  { id: 'motion-attention', label: 'Motion Attention Pack', category: 'motion', description: 'Loops and emphasis presets for social video and CTAs.', includes: ['Pulse', 'Shake', 'Float Up', 'Glitch In'], defaultEnabled: true },
  { id: 'motion-text-pro', label: 'Motion Text Pro', category: 'motion', description: 'Typography-centric motion recipes for hooks and captions.', includes: ['Soft Blur In', 'Rise Fade', 'Cascade In', 'Stamp In'], defaultEnabled: true },
  { id: 'lottie-pack', label: 'Lottie Pack', category: 'motion', description: 'Lottie/JSON animation placeholders and runtime-ready animation slots.', includes: ['Lottie layer'], defaultEnabled: false },
];

function isPlainObject(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneData<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

export function sanitizeCreativeRegistryId(raw: any, fallback = ''): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function sanitizeAnimationPresetId(raw: any, fallback = ''): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9._]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function cleanLabel(raw: any, fallback = 'Untitled', limit = 100): string {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, limit) || fallback;
}

function cleanDescription(raw: any, fallback = ''): string {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 500) || fallback;
}

function normalizeLibraryCategory(raw: any, fallback = 'components'): CreativeLibraryPackCatalogEntry['category'] {
  const normalized = String(raw || '').trim().toLowerCase();
  return CREATIVE_LIBRARY_CATEGORIES.has(normalized)
    ? normalized as CreativeLibraryPackCatalogEntry['category']
    : fallback as CreativeLibraryPackCatalogEntry['category'];
}

function normalizeLibrarySection(raw: any): CreativeLibrarySection | null {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'text' || normalized === 'texts') return 'text';
  if (normalized === 'shape' || normalized === 'shapes') return 'shapes';
  if (normalized === 'icon' || normalized === 'icons') return 'icons';
  if (normalized === 'image' || normalized === 'images') return 'images';
  if (normalized === 'component' || normalized === 'components' || normalized === 'group' || normalized === 'groups') return 'components';
  return null;
}

function normalizeAnimationTargets(input: any): CreativeAnimationTarget[] {
  const rawValues = Array.isArray(input) ? input : [input];
  const targets = rawValues
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value): value is CreativeAnimationTarget => CREATIVE_ANIMATION_TARGETS.has(value as CreativeAnimationTarget));
  return targets.length ? [...new Set(targets)] : ['text', 'shape', 'image', 'icon', 'group'];
}

function normalizeAnimationState(raw: any): Record<string, number> {
  const source = isPlainObject(raw) ? raw : {};
  const result: Record<string, number> = {};
  ['x', 'y', 'xOffset', 'yOffset', 'width', 'height', 'scale', 'opacity', 'rotation'].forEach((key) => {
    if (Number.isFinite(Number(source[key]))) result[key] = Number(source[key]);
  });
  return result;
}

function normalizeCustomLibraryElement(section: CreativeLibrarySection, raw: any, libraryId: string): any | null {
  if (!isPlainObject(raw)) return null;
  const kind = sanitizeCreativeRegistryId(raw.kind || raw.id || raw.label, '');
  if (!kind) return null;
  const meta = isPlainObject(raw.meta) ? cloneData(raw.meta) : {};
  if (section === 'icons' && raw.iconName && !meta.iconName) meta.iconName = String(raw.iconName);
  if (section === 'shapes' && raw.shape && !meta.shape) meta.shape = String(raw.shape);
  if (section === 'components' && raw.component && !meta.component) meta.component = String(raw.component);
  if (section === 'text' && raw.content && !meta.content) meta.content = String(raw.content);
  if (section === 'text' && !meta.content) meta.content = cleanLabel(raw.label || kind, kind);
  const entry: any = {
    kind,
    label: cleanLabel(raw.label || kind, kind),
    type: String(raw.type || CREATIVE_LIBRARY_SECTION_TYPES[section] || '').trim().toLowerCase() || CREATIVE_LIBRARY_SECTION_TYPES[section],
    libraryId,
    meta,
  };
  if (Number.isFinite(Number(raw.defaultWidth))) entry.defaultWidth = Math.max(12, Number(raw.defaultWidth));
  if (Number.isFinite(Number(raw.defaultHeight))) entry.defaultHeight = Math.max(12, Number(raw.defaultHeight));
  return entry;
}

function normalizeCustomAnimationPreset(raw: any, libraryId: string): any | null {
  if (!isPlainObject(raw)) return null;
  const id = sanitizeAnimationPresetId(raw.id || raw.label, '');
  if (!id) return null;
  return {
    id,
    label: cleanLabel(raw.label || id, id),
    libraryId,
    targets: normalizeAnimationTargets(raw.targets),
    defaultDurationMs: Math.max(100, Number(raw.defaultDurationMs) || 500),
    from: normalizeAnimationState(raw.from),
    to: normalizeAnimationState(raw.to),
    holdMs: Math.max(0, Number(raw.holdMs) || 0),
    ease: String(raw.ease || 'power2.out').trim() || 'power2.out',
    effects: isPlainObject(raw.effects) ? cloneData(raw.effects) : null,
  };
}

function deriveLibraryCategory(elements: Partial<Record<CreativeLibrarySection, any[]>>, animationPresets: any[], explicit: any) {
  const normalized = String(explicit || '').trim().toLowerCase();
  if (CREATIVE_LIBRARY_CATEGORIES.has(normalized)) return normalized as CreativeLibraryPackCatalogEntry['category'];
  const hasElements = Object.values(elements).some((entries) => Array.isArray(entries) && entries.length);
  if (animationPresets.length && !hasElements) return 'motion';
  if (Array.isArray(elements.icons) && elements.icons.length) return 'icons';
  if (Array.isArray(elements.shapes) && elements.shapes.length) return 'shapes';
  if (Array.isArray(elements.components) && elements.components.length) return 'components';
  if (Array.isArray(elements.text) && elements.text.length) return 'core';
  return 'components';
}

function buildIncludes(rawIncludes: any, elements: Partial<Record<CreativeLibrarySection, any[]>>, animationPresets: any[]): string[] {
  if (Array.isArray(rawIncludes) && rawIncludes.length) {
    return [...new Set(rawIncludes.map((value) => cleanLabel(value, '', 48)).filter(Boolean))].slice(0, 12);
  }
  const derived: string[] = [];
  CREATIVE_LIBRARY_SECTIONS.forEach((section) => {
    (Array.isArray(elements[section]) ? elements[section] : []).forEach((entry) => {
      if (entry?.label) derived.push(entry.label);
    });
  });
  animationPresets.forEach((entry) => {
    if (entry?.label) derived.push(entry.label);
  });
  return [...new Set(derived)].slice(0, 12);
}

export function buildCreativeRegistryRelativePath(root: string, absPath: string): string {
  const rel = path.relative(root, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : absPath.replace(/\\/g, '/');
}

function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getCreativeLibrariesDir(storage: CreativeStorageLike): string {
  return ensureDir(path.join(storage.creativeDir, 'libraries'));
}

export function getCreativeLibraryPacksDir(storage: CreativeStorageLike): string {
  return ensureDir(path.join(getCreativeLibrariesDir(storage), 'packs'));
}

function getCreativeLibraryRegistryPath(storage: CreativeStorageLike): string {
  return path.join(getCreativeLibrariesDir(storage), 'registry.json');
}

export function readCreativeLibraryRegistry(storage: CreativeStorageLike): CreativeLibraryRegistry {
  const registryPath = getCreativeLibraryRegistryPath(storage);
  if (!fs.existsSync(registryPath)) return { version: 1, updatedAt: '', libraries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    return {
      version: Number(parsed?.version) || 1,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
      libraries: isPlainObject(parsed?.libraries) ? parsed.libraries as Record<string, CreativeLibraryRegistryEntry> : {},
    };
  } catch {
    return { version: 1, updatedAt: '', libraries: {} };
  }
}

export function writeCreativeLibraryRegistry(storage: CreativeStorageLike, registry: CreativeLibraryRegistry): void {
  const nextRegistry: CreativeLibraryRegistry = {
    version: 1,
    updatedAt: new Date().toISOString(),
    libraries: isPlainObject(registry?.libraries) ? registry.libraries : {},
  };
  fs.writeFileSync(getCreativeLibraryRegistryPath(storage), JSON.stringify(nextRegistry, null, 2), 'utf-8');
}

export function normalizeCustomCreativeLibraryManifest(raw: any, options: { sourceUrl?: string | null; manifestPath?: string | null; manifestPathRelative?: string | null; id?: string } = {}): CustomCreativeLibraryPack {
  const source = isPlainObject(raw?.pack) ? raw.pack : raw;
  if (!isPlainObject(source)) throw new Error('Creative pack manifest must be a JSON object.');
  const id = sanitizeCreativeRegistryId(options.id || source.id || source.label, '');
  if (!id) throw new Error('Creative pack manifest needs an id or label.');
  if (BUILTIN_CREATIVE_LIBRARY_PACKS.some((pack) => pack.id === id)) throw new Error(`Custom creative pack id conflicts with a built-in pack: ${id}`);
  const sourceElements = isPlainObject(source.elements) ? source.elements : {};
  const elements: Partial<Record<CreativeLibrarySection, any[]>> = {};
  CREATIVE_LIBRARY_SECTIONS.forEach((section) => {
    const rawEntries = Object.entries(sourceElements).reduce((collection: any[], [rawSection, entries]) => {
      if (normalizeLibrarySection(rawSection) !== section || !Array.isArray(entries)) return collection;
      return collection.concat(entries);
    }, []);
    const normalized = rawEntries.map((entry) => normalizeCustomLibraryElement(section, entry, id)).filter(Boolean);
    if (normalized.length) elements[section] = normalized;
  });
  const animationPresets = (Array.isArray(source.animationPresets) ? source.animationPresets : [])
    .map((entry) => normalizeCustomAnimationPreset(entry, id))
    .filter(Boolean);
  if (!Object.keys(elements).length && !animationPresets.length) throw new Error('Creative pack manifest must include elements or animationPresets.');
  return {
    id,
    label: cleanLabel(source.label || id, id),
    category: deriveLibraryCategory(elements, animationPresets, source.category),
    description: cleanDescription(source.description, 'Imported custom creative library pack.'),
    includes: buildIncludes(source.includes, elements, animationPresets),
    defaultEnabled: source.defaultEnabled === true,
    source: 'custom',
    sourceUrl: String(options.sourceUrl || source.sourceUrl || '').trim() || null,
    manifestPath: options.manifestPath || null,
    manifestPathRelative: options.manifestPathRelative || null,
    elements,
    animationPresets,
  };
}

export function getCustomCreativeLibraryManifestFilePath(storage: CreativeStorageLike, libraryId: string): string {
  return path.join(getCreativeLibraryPacksDir(storage), `${sanitizeCreativeRegistryId(libraryId)}.json`);
}

export function readCustomCreativeLibraryPacks(storage: CreativeStorageLike): CustomCreativeLibraryPack[] {
  const packsDir = getCreativeLibraryPacksDir(storage);
  return fs.readdirSync(packsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const absPath = path.join(packsDir, entry.name);
      try {
        const parsed = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
        return normalizeCustomCreativeLibraryManifest(parsed, {
          manifestPath: buildCreativeRegistryRelativePath(storage.workspacePath, absPath),
          manifestPathRelative: buildCreativeRegistryRelativePath(storage.rootAbsPath, absPath),
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CustomCreativeLibraryPack[];
}

export function writeCustomCreativeLibraryPack(storage: CreativeStorageLike, pack: CustomCreativeLibraryPack): { manifestPath: string; manifestPathRelative: string } {
  const absPath = getCustomCreativeLibraryManifestFilePath(storage, pack.id);
  const manifestPath = buildCreativeRegistryRelativePath(storage.workspacePath, absPath);
  const manifestPathRelative = buildCreativeRegistryRelativePath(storage.rootAbsPath, absPath);
  fs.writeFileSync(absPath, JSON.stringify({ ...pack, manifestPath, manifestPathRelative }, null, 2), 'utf-8');
  return { manifestPath, manifestPathRelative };
}

export function buildCreativeLibraryPayload(storage: CreativeStorageLike, registry = readCreativeLibraryRegistry(storage)) {
  const registryLibraries = isPlainObject(registry?.libraries) ? registry.libraries : {};
  const builtinCatalog = BUILTIN_CREATIVE_LIBRARY_PACKS.map((pack) => {
    const saved = registryLibraries[pack.id];
    return {
      ...pack,
      source: 'builtin',
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : !!pack.defaultEnabled,
      installedAt: typeof saved?.installedAt === 'string' ? saved.installedAt : null,
      updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null,
    } as CreativeLibraryPackCatalogEntry;
  });
  const customCatalog = readCustomCreativeLibraryPacks(storage).map((pack) => {
    const saved = registryLibraries[pack.id];
    return {
      ...pack,
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : !!pack.defaultEnabled,
      installedAt: typeof saved?.installedAt === 'string' ? saved.installedAt : null,
      updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null,
      manifestPath: pack.manifestPath || (typeof saved?.manifestPath === 'string' ? saved.manifestPath : null),
      manifestPathRelative: pack.manifestPathRelative || (typeof saved?.manifestPathRelative === 'string' ? saved.manifestPathRelative : null),
      sourceUrl: pack.sourceUrl || (typeof saved?.sourceUrl === 'string' ? saved.sourceUrl : null),
    } as CustomCreativeLibraryPack & CreativeLibraryPackCatalogEntry;
  });
  const libraries = [...builtinCatalog, ...customCatalog];
  return {
    registry,
    librariesDir: getCreativeLibrariesDir(storage),
    librariesDirRelative: buildCreativeRegistryRelativePath(storage.workspacePath, getCreativeLibrariesDir(storage)),
    builtinCatalog,
    customCatalog,
    libraries,
    enabledLibraryIds: libraries.filter((entry) => entry.enabled).map((entry) => entry.id),
  };
}

export function createCreativeLibraryPack(storage: CreativeStorageLike, manifest: any, enabled = true) {
  const pack = normalizeCustomCreativeLibraryManifest(manifest);
  const manifestInfo = writeCustomCreativeLibraryPack(storage, pack);
  const registry = readCreativeLibraryRegistry(storage);
  const nowIso = new Date().toISOString();
  const existing = registry.libraries?.[pack.id];
  registry.libraries = isPlainObject(registry.libraries) ? registry.libraries : {};
  registry.libraries[pack.id] = {
    enabled,
    source: 'custom',
    installedAt: typeof existing?.installedAt === 'string' ? existing.installedAt : nowIso,
    updatedAt: nowIso,
    manifestPath: manifestInfo.manifestPath,
    manifestPathRelative: manifestInfo.manifestPathRelative,
    sourceUrl: pack.sourceUrl || null,
  };
  writeCreativeLibraryRegistry(storage, registry);
  return { pack: { ...pack, ...manifestInfo, enabled }, payload: buildCreativeLibraryPayload(storage, registry) };
}

export function toggleCreativeLibraryPack(storage: CreativeStorageLike, libraryId: string, enabled = true) {
  const normalizedId = sanitizeCreativeRegistryId(libraryId, '');
  if (!normalizedId) throw new Error('libraryId is required');
  const registry = readCreativeLibraryRegistry(storage);
  const payload = buildCreativeLibraryPayload(storage, registry);
  const target = payload.libraries.find((pack) => pack.id === normalizedId);
  if (!target) throw new Error(`Unknown creative library pack: ${normalizedId}`);
  const nowIso = new Date().toISOString();
  const existing = registry.libraries?.[normalizedId];
  registry.libraries = isPlainObject(registry.libraries) ? registry.libraries : {};
  registry.libraries[normalizedId] = {
    enabled,
    source: target.source === 'custom' ? 'custom' : 'builtin',
    installedAt: typeof existing?.installedAt === 'string' ? existing.installedAt : nowIso,
    updatedAt: nowIso,
    manifestPath: target.source === 'custom' ? target.manifestPath || null : null,
    manifestPathRelative: target.source === 'custom' ? target.manifestPathRelative || null : null,
    sourceUrl: target.source === 'custom' ? target.sourceUrl || null : null,
  };
  writeCreativeLibraryRegistry(storage, registry);
  return { libraryId: normalizedId, enabled, payload: buildCreativeLibraryPayload(storage, registry) };
}

function getHtmlMotionDir(storage: CreativeStorageLike, child: string): string {
  return ensureDir(path.join(storage.creativeDir, 'html-motion', child));
}

function normalizeInputSpecs(input: any): any[] {
  return (Array.isArray(input) ? input : []).map((spec) => {
    if (!isPlainObject(spec)) return null;
    const id = sanitizeCreativeRegistryId(spec.id || spec.label, '');
    if (!id) return null;
    return {
      id,
      label: cleanLabel(spec.label || id, id),
      description: cleanDescription(spec.description, ''),
      example: spec.example === undefined ? undefined : String(spec.example),
    };
  }).filter(Boolean);
}

function normalizeParameters(input: any): any[] {
  return (Array.isArray(input) ? input : []).filter(isPlainObject).map(cloneData);
}

export function renderTemplatePlaceholders(source: string, input: Record<string, any> = {}): string {
  return String(source || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = input?.[String(key)];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function normalizeCustomHtmlMotionTemplate(raw: any, storage?: CreativeStorageLike, paths: { manifestPath?: string | null; manifestPathRelative?: string | null } = {}): CustomHtmlMotionTemplate {
  const source = isPlainObject(raw?.template) ? raw.template : raw;
  if (!isPlainObject(source)) throw new Error('HTML motion template manifest must be a JSON object.');
  const id = sanitizeCreativeRegistryId(source.id || source.name, '');
  if (!id) throw new Error('HTML motion template needs an id or name.');
  const html = String(source.html || '');
  if (!html.trim()) throw new Error('HTML motion template needs html.');
  const now = new Date().toISOString();
  return {
    id,
    name: cleanLabel(source.name || id, id),
    description: cleanDescription(source.description, 'Custom HTML motion template.'),
    bestFor: cleanDescription(source.bestFor, 'Reusable custom motion creative.'),
    defaultWidth: Math.max(1, Number(source.defaultWidth || source.width) || 1080),
    defaultHeight: Math.max(1, Number(source.defaultHeight || source.height) || 1920),
    defaultDurationMs: Math.max(100, Number(source.defaultDurationMs || source.durationMs) || 8000),
    defaultFrameRate: Math.max(1, Number(source.defaultFrameRate || source.frameRate) || 60),
    requiredInputs: normalizeInputSpecs(source.requiredInputs),
    optionalInputs: normalizeInputSpecs(source.optionalInputs),
    parameters: normalizeParameters(source.parameters),
    html,
    defaultInputs: isPlainObject(source.defaultInputs) ? Object.fromEntries(Object.entries(source.defaultInputs).map(([k, v]) => [k, String(v ?? '')])) : {},
    source: 'custom',
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : now,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
    manifestPath: paths.manifestPath || null,
    manifestPathRelative: paths.manifestPathRelative || null,
  };
}

export function saveCustomHtmlMotionTemplate(storage: CreativeStorageLike, raw: any): CustomHtmlMotionTemplate {
  const template = normalizeCustomHtmlMotionTemplate(raw, storage);
  const dir = getHtmlMotionDir(storage, 'templates');
  const absPath = path.join(dir, `${template.id}.json`);
  const manifestPath = buildCreativeRegistryRelativePath(storage.workspacePath, absPath);
  const manifestPathRelative = buildCreativeRegistryRelativePath(storage.rootAbsPath, absPath);
  const persisted = { ...template, manifestPath, manifestPathRelative, updatedAt: new Date().toISOString() };
  fs.writeFileSync(absPath, JSON.stringify(persisted, null, 2), 'utf-8');
  return persisted;
}

export function listCustomHtmlMotionTemplates(storage?: CreativeStorageLike | null): CustomHtmlMotionTemplate[] {
  if (!storage) return [];
  const dir = getHtmlMotionDir(storage, 'templates');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const absPath = path.join(dir, entry.name);
      try {
        return normalizeCustomHtmlMotionTemplate(JSON.parse(fs.readFileSync(absPath, 'utf-8')), storage, {
          manifestPath: buildCreativeRegistryRelativePath(storage.workspacePath, absPath),
          manifestPathRelative: buildCreativeRegistryRelativePath(storage.rootAbsPath, absPath),
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CustomHtmlMotionTemplate[];
}

export function getCustomHtmlMotionTemplate(storage: CreativeStorageLike | null | undefined, templateId: string): CustomHtmlMotionTemplate | null {
  const id = sanitizeCreativeRegistryId(templateId, '');
  if (!storage || !id) return null;
  return listCustomHtmlMotionTemplates(storage).find((template) => template.id === id) || null;
}

export function normalizeCustomHtmlMotionBlock(raw: any, storage?: CreativeStorageLike, paths: { manifestPath?: string | null; manifestPathRelative?: string | null } = {}): CustomHtmlMotionBlock {
  const source = isPlainObject(raw?.block) ? raw.block : raw;
  if (!isPlainObject(source)) throw new Error('HTML motion block manifest must be a JSON object.');
  const id = sanitizeCreativeRegistryId(source.id || source.name, '');
  if (!id) throw new Error('HTML motion block needs an id or name.');
  const now = new Date().toISOString();
  const slots = (Array.isArray(source.slots) ? source.slots : []).filter(isPlainObject).map((slot) => ({
    ...cloneData(slot),
    id: sanitizeCreativeRegistryId(slot.id || slot.label, ''),
    label: cleanLabel(slot.label || slot.id, String(slot.id || 'Slot')),
  })).filter((slot) => slot.id);
  return {
    id,
    packId: sanitizeCreativeRegistryId(source.packId || 'prometheus-custom', 'prometheus-custom'),
    name: cleanLabel(source.name || id, id),
    description: cleanDescription(source.description, 'Custom HTML motion block.'),
    category: String(source.category || 'utility').trim().toLowerCase() || 'utility',
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => cleanLabel(tag, '', 40)).filter(Boolean) : [],
    bestFor: cleanDescription(source.bestFor, 'Reusable custom motion snippet.'),
    slots,
    requiredStageFeatures: Array.isArray(source.requiredStageFeatures) ? source.requiredStageFeatures.map(String) : ['data-composition-id', 'data-width', 'data-height', 'data-duration'],
    outputContract: {
      htmlRegion: source.outputContract?.htmlRegion !== false,
      usesTimingAttributes: source.outputContract?.usesTimingAttributes !== false,
      usesPrometheusSeekEvent: source.outputContract?.usesPrometheusSeekEvent === true,
      assetPlaceholders: Array.isArray(source.outputContract?.assetPlaceholders) ? source.outputContract.assetPlaceholders.map(String) : [],
    },
    html: String(source.html || ''),
    css: String(source.css || ''),
    js: String(source.js || ''),
    source: 'custom',
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : now,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
    manifestPath: paths.manifestPath || null,
    manifestPathRelative: paths.manifestPathRelative || null,
  };
}

export function saveCustomHtmlMotionBlock(storage: CreativeStorageLike, raw: any): CustomHtmlMotionBlock {
  const block = normalizeCustomHtmlMotionBlock(raw, storage);
  if (!block.html && !block.css && !block.js) throw new Error('HTML motion block needs at least one of html, css, or js.');
  const dir = getHtmlMotionDir(storage, 'blocks');
  const absPath = path.join(dir, `${block.id}.json`);
  const manifestPath = buildCreativeRegistryRelativePath(storage.workspacePath, absPath);
  const manifestPathRelative = buildCreativeRegistryRelativePath(storage.rootAbsPath, absPath);
  const persisted = { ...block, manifestPath, manifestPathRelative, updatedAt: new Date().toISOString() };
  fs.writeFileSync(absPath, JSON.stringify(persisted, null, 2), 'utf-8');
  return persisted;
}

export function listCustomHtmlMotionBlocks(storage?: CreativeStorageLike | null): CustomHtmlMotionBlock[] {
  if (!storage) return [];
  const dir = getHtmlMotionDir(storage, 'blocks');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const absPath = path.join(dir, entry.name);
      try {
        return normalizeCustomHtmlMotionBlock(JSON.parse(fs.readFileSync(absPath, 'utf-8')), storage, {
          manifestPath: buildCreativeRegistryRelativePath(storage.workspacePath, absPath),
          manifestPathRelative: buildCreativeRegistryRelativePath(storage.rootAbsPath, absPath),
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CustomHtmlMotionBlock[];
}

export function getCustomHtmlMotionBlock(storage: CreativeStorageLike | null | undefined, blockId: string): CustomHtmlMotionBlock | null {
  const id = sanitizeCreativeRegistryId(blockId, '');
  if (!storage || !id) return null;
  return listCustomHtmlMotionBlocks(storage).find((block) => block.id === id) || null;
}

export function saveCustomSceneTemplate(storage: CreativeStorageLike, raw: any): CustomSceneTemplate {
  const source = isPlainObject(raw?.template) ? raw.template : raw;
  if (!isPlainObject(source)) throw new Error('Scene template manifest must be a JSON object.');
  const scene = isPlainObject(source.scene) ? cloneData(source.scene) : null;
  if (!scene) throw new Error('Scene template needs a scene object.');
  const id = sanitizeCreativeRegistryId(source.id || source.name || scene.id, '');
  if (!id) throw new Error('Scene template needs an id or name.');
  const now = new Date().toISOString();
  const template: CustomSceneTemplate = {
    id,
    name: cleanLabel(source.name || id, id),
    description: cleanDescription(source.description, 'Custom scene template.'),
    category: String(source.category || 'custom').trim().toLowerCase() || 'custom',
    bestFor: cleanDescription(source.bestFor, 'Reusable editable scene.'),
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => cleanLabel(tag, '', 40)).filter(Boolean) : [],
    width: Math.max(1, Number(scene.width || source.width) || 1080),
    height: Math.max(1, Number(scene.height || source.height) || 1920),
    durationMs: Math.max(100, Number(scene.durationMs || source.durationMs) || 8000),
    frameRate: Math.max(1, Number(scene.frameRate || source.frameRate) || 60),
    slots: Array.isArray(source.slots) ? cloneData(source.slots) : [],
    scene,
    source: 'custom',
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : now,
    updatedAt: now,
  };
  const dir = ensureDir(path.join(storage.creativeDir, 'templates', 'scenes'));
  const absPath = path.join(dir, `${template.id}.json`);
  template.manifestPath = buildCreativeRegistryRelativePath(storage.workspacePath, absPath);
  template.manifestPathRelative = buildCreativeRegistryRelativePath(storage.rootAbsPath, absPath);
  fs.writeFileSync(absPath, JSON.stringify(template, null, 2), 'utf-8');
  return template;
}

export function listCustomSceneTemplates(storage?: CreativeStorageLike | null): CustomSceneTemplate[] {
  if (!storage) return [];
  const dir = ensureDir(path.join(storage.creativeDir, 'templates', 'scenes'));
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const absPath = path.join(dir, entry.name);
      try {
        const parsed = JSON.parse(fs.readFileSync(absPath, 'utf-8')) as CustomSceneTemplate;
        return {
          ...parsed,
          source: 'custom',
          manifestPath: buildCreativeRegistryRelativePath(storage.workspacePath, absPath),
          manifestPathRelative: buildCreativeRegistryRelativePath(storage.rootAbsPath, absPath),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CustomSceneTemplate[];
}
