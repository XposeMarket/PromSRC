import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { loadTokens } from '../../auth/openai-oauth';
import { resolveSecretReference } from '../../image-generation/utils';
import { OpenAICodexAdapter } from '../../providers/openai-codex-adapter';
import {
  analyzeCreativeAsset,
  importCreativeAsset,
  type CreativeAssetRecord,
  type CreativeAssetStorage,
} from './assets';
import { normalizeCreativeSceneDoc, summarizeCreativeSceneDoc, type CreativeSceneDoc } from './contracts';
import {
  isSegmentationStackAvailable,
  produceCleanPlate,
  runSamCutouts,
  sampleLayerColors,
  tryTraceShapeLayers,
  type ExtractionPipelineLayer,
} from './onnx/pipeline';

export type CreativeLayerExtractionMode = 'fast' | 'balanced' | 'deep';

export type CreativeLayerExtractionOptions = {
  source: string;
  mode?: CreativeLayerExtractionMode;
  prompt?: string;
  textEditable?: boolean;
  extractObjects?: boolean;
  preserveOriginal?: boolean;
  copySource?: boolean;
  maxTextLayers?: number;
  maxShapeLayers?: number;
  useVision?: boolean;
  useOcr?: boolean;
  useSam?: boolean;
  inpaintBackground?: boolean;
  vectorTraceShapes?: boolean;
};

export type CreativeLayerExtractionResult = {
  id: string;
  source: CreativeAssetRecord;
  scene: CreativeSceneDoc;
  sceneSummary: ReturnType<typeof summarizeCreativeSceneDoc>;
  scenePath: string;
  sceneAbsPath: string;
  ops: any[];
  layers: any[];
  diagnostics: {
    mode: CreativeLayerExtractionMode;
    vision: { attempted: boolean; used: boolean; error: string | null; model: string | null };
    ocr: { attempted: boolean; used: boolean; error: string | null; textLayerCount: number };
    sam: { attempted: boolean; used: boolean; cutoutCount: number; available: boolean };
    inpaint: { attempted: boolean; used: boolean; available: boolean; cleanPlatePath: string | null };
    vectorTrace: { attempted: boolean; tracedCount: number };
    warningCount: number;
    warnings: string[];
  };
};

type ProposedLayer = {
  id?: string;
  type: 'text' | 'shape' | 'image' | 'group';
  role?: string;
  content?: string;
  description?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  confidence?: number;
  meta?: Record<string, any>;
};

type VisionLayerAnalysis = {
  layers: ProposedLayer[];
  background: string | null;
  model: string;
  raw: any;
};

function nowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function sanitizeSegment(raw: string, fallback = 'layer-extraction'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
    .replace(/^[/\\]+/, '')
    .replace(/\s+/g, '-')
    .slice(0, 120);
  return cleaned || fallback;
}

function buildWorkspaceRelativePath(storage: CreativeAssetStorage, absPath: string): string {
  const rel = path.relative(storage.workspacePath, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : absPath.replace(/\\/g, '/');
}

function clampNumber(value: any, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function clampBox(layer: Partial<ProposedLayer>, canvasWidth: number, canvasHeight: number): ProposedLayer | null {
  const width = Math.max(8, Math.min(canvasWidth, Number(layer.width) || 0));
  const height = Math.max(8, Math.min(canvasHeight, Number(layer.height) || 0));
  const x = clampNumber(layer.x, -canvasWidth, canvasWidth, 0);
  const y = clampNumber(layer.y, -canvasHeight, canvasHeight, 0);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (x > canvasWidth || y > canvasHeight || x + width < 0 || y + height < 0) return null;
  return {
    type: (['text', 'shape', 'image', 'group'].includes(String(layer.type || '')) ? layer.type : 'shape') as ProposedLayer['type'],
    id: layer.id,
    role: layer.role,
    content: layer.content,
    description: layer.description,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    rotation: clampNumber(layer.rotation, -360, 360, 0),
    opacity: clampNumber(layer.opacity, 0, 1, 1),
    confidence: clampNumber(layer.confidence, 0, 1, 0.55),
    meta: layer.meta && typeof layer.meta === 'object' && !Array.isArray(layer.meta) ? layer.meta : {},
  };
}

function coerceHexColor(value: any, fallback: string): string {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(raw)) return raw;
  if (/^rgba?\(/i.test(raw)) return raw;
  return fallback;
}

function getOpenAIConfig(): { apiKey: string | undefined; endpoint: string; model: string } {
  const cfg = getConfig().getConfig() as any;
  const providerCfg = cfg?.llm?.providers?.openai && typeof cfg.llm.providers.openai === 'object'
    ? cfg.llm.providers.openai
    : {};
  const apiKey = resolveSecretReference(providerCfg.api_key) || process.env.OPENAI_API_KEY;
  const endpoint = String(providerCfg.endpoint || process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
  const model = String(
    process.env.PROMETHEUS_LAYER_EXTRACTION_MODEL
      || process.env.OPENAI_VISION_MODEL
      || providerCfg.model
      || process.env.OPENAI_MODEL
      || 'gpt-4o',
  ).trim();
  return { apiKey, endpoint, model };
}

function getCodexLayerExtractionModel(): string {
  const cfg = getConfig().getConfig() as any;
  const providerCfg = cfg?.llm?.providers?.openai_codex && typeof cfg.llm.providers.openai_codex === 'object'
    ? cfg.llm.providers.openai_codex
    : {};
  return String(
    process.env.PROMETHEUS_LAYER_EXTRACTION_CODEX_MODEL
      || process.env.PROMETHEUS_LAYER_EXTRACTION_MODEL
      || process.env.CODEX_MODEL
      || providerCfg.model
      || 'gpt-5.4',
  ).trim();
}

function extractJsonObject(text: string): any | null {
  const source = String(text || '').trim();
  if (!source) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], source].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(candidate.slice(start, end + 1));
        } catch {
          // keep looking
        }
      }
    }
  }
  return null;
}

function buildVisionLayerPrompt(input: {
  width: number;
  height: number;
  prompt?: string;
  mode: CreativeLayerExtractionMode;
  extractObjects: boolean;
}): { system: string; userText: string } {
  const system = [
    'You convert a flat raster graphic into an editable design layer plan for Prometheus Creative Image mode.',
    'Return only valid JSON. Use pixel coordinates in the original image coordinate space.',
    'Prefer editable text and simple shapes over vague descriptions. Do not invent text.',
  ].join(' ');
  const userText = [
    `Canvas size: ${input.width}x${input.height}.`,
    input.prompt ? `Original generation/user prompt: ${input.prompt}` : '',
    `Extraction depth: ${input.mode}.`,
    input.extractObjects
      ? 'Identify major visual objects as image layer candidates, but only include objects with clear bounding boxes.'
      : 'Skip decorative object layers unless they are obvious product/photo regions.',
    'JSON schema: {"background":"#ffffff","layers":[{"type":"text|shape|image","role":"headline|subtitle|body|cta|panel|product|photo|decoration|logo|other","content":"visible text for text layers","description":"short label for non-text layers","x":0,"y":0,"width":100,"height":40,"rotation":0,"opacity":1,"confidence":0.0,"meta":{"fontSize":48,"fontWeight":700,"fontFamily":"Inter","color":"#111111","textAlign":"left","shape":"rect","fill":"#ffffff","stroke":"transparent","strokeWidth":0,"radius":0}}]}',
    'Keep layers high-signal: max 18 text layers, max 16 shape/object layers.',
  ].filter(Boolean).join('\n');
  return { system, userText };
}

function parseVisionLayerResponse(body: string, raw: any, width: number, height: number): Pick<VisionLayerAnalysis, 'layers' | 'background' | 'raw'> {
  const json = extractJsonObject(body);
  const layersRaw = Array.isArray(json?.layers) ? json.layers : [];
  const layers = layersRaw
    .map((layer: any) => clampBox(layer, width, height))
    .filter(Boolean) as ProposedLayer[];
  return {
    layers,
    background: typeof json?.background === 'string' ? json.background : null,
    raw: json || raw,
  };
}

async function analyzeWithCodexVision(input: {
  imageDataUrl: string;
  width: number;
  height: number;
  prompt?: string;
  mode: CreativeLayerExtractionMode;
  extractObjects: boolean;
}): Promise<VisionLayerAnalysis> {
  const config = getConfig();
  const configDir = config.getConfigDir();
  if (!loadTokens(configDir)) {
    throw new Error('OpenAI layer vision needs either OPENAI_API_KEY or an OpenAI Codex connection in Settings.');
  }
  const model = getCodexLayerExtractionModel();
  const adapter = new OpenAICodexAdapter(configDir);
  const { system, userText } = buildVisionLayerPrompt(input);
  const result = await adapter.chat([
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'high' } },
      ],
    },
  ], model, {
    temperature: 0.1,
    max_tokens: input.mode === 'deep' ? 3200 : 2200,
    think: 'low',
  });
  const content = result?.message?.content;
  const body = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => String(part?.text || '')).join('\n')
      : '';
  const parsed = parseVisionLayerResponse(body, result, input.width, input.height);
  return {
    ...parsed,
    model: `openai_codex/${model}`,
  };
}

async function analyzeWithOpenAIVision(input: {
  absPath: string;
  mimeType: string;
  width: number;
  height: number;
  prompt?: string;
  mode: CreativeLayerExtractionMode;
  extractObjects: boolean;
}): Promise<VisionLayerAnalysis> {
  const { apiKey, endpoint, model } = getOpenAIConfig();
  const stat = fs.statSync(input.absPath);
  if (stat.size > 18 * 1024 * 1024) throw new Error('Image is larger than the 18MB layer-analysis limit.');

  const imageDataUrl = `data:${input.mimeType || 'image/png'};base64,${fs.readFileSync(input.absPath).toString('base64')}`;
  if (!apiKey) {
    return analyzeWithCodexVision({ ...input, imageDataUrl });
  }
  const { system, userText } = buildVisionLayerPrompt(input);

  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      max_tokens: input.mode === 'deep' ? 3200 : 2200,
    }),
    signal: AbortSignal.timeout(input.mode === 'deep' ? 90000 : 60000),
  });
  const rawText = await response.text();
  const parsed = rawText ? JSON.parse(rawText) : {};
  if (!response.ok) {
    throw new Error(String(parsed?.error?.message || response.statusText || rawText).slice(0, 500));
  }
  const content = parsed?.choices?.[0]?.message?.content;
  const body = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => String(part?.text || '')).join('\n')
      : '';
  const parsedBody = parseVisionLayerResponse(body, parsed, input.width, input.height);
  return {
    layers: parsedBody.layers,
    background: parsedBody.background,
    model,
    raw: parsedBody.raw,
  };
}

async function analyzeWithTesseract(input: {
  absPath: string;
  width: number;
  height: number;
  maxTextLayers: number;
}): Promise<ProposedLayer[]> {
  // tesseract.js is already a runtime dependency; use require so builds do not depend on its optional worker typings.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tesseract = require('tesseract.js') as { recognize?: (...args: any[]) => Promise<any> };
  if (typeof tesseract.recognize !== 'function') throw new Error('tesseract.js recognize() is not available.');
  const result = await tesseract.recognize(input.absPath, 'eng', { logger: () => undefined });
  const data = result?.data || {};
  const sourceLines = Array.isArray(data.lines) && data.lines.length
    ? data.lines
    : Array.isArray(data.words)
      ? data.words
      : [];
  const layers: ProposedLayer[] = [];
  for (const item of sourceLines) {
    const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
    if (text.length < 3) continue;
    const confidence = clampNumber(item?.confidence, 0, 100, 55) / 100;
    if (confidence < 0.7) continue;
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length < Math.max(2, Math.floor(text.length * 0.5))) continue;
    if (!/[aeiouyAEIOUY]/.test(letters) && letters.length < 4) continue;
    const punctRatio = (text.match(/[^a-zA-Z0-9 ]/g) || []).length / text.length;
    if (punctRatio > 0.4) continue;
    const bbox = item?.bbox || {};
    const x0 = Number(bbox.x0 ?? item?.x0 ?? item?.left);
    const y0 = Number(bbox.y0 ?? item?.y0 ?? item?.top);
    const x1 = Number(bbox.x1 ?? (Number.isFinite(Number(item?.left)) ? Number(item.left) + Number(item.width || 0) : undefined));
    const y1 = Number(bbox.y1 ?? (Number.isFinite(Number(item?.top)) ? Number(item.top) + Number(item.height || 0) : undefined));
    const box = clampBox({
      type: 'text',
      role: 'ocr_text',
      content: text,
      x: x0,
      y: y0,
      width: x1 - x0,
      height: y1 - y0,
      confidence,
      meta: {
        content: text,
        fontSize: Math.max(10, Math.round((y1 - y0) * 0.82)),
        fontWeight: text === text.toUpperCase() && text.length > 3 ? 800 : 600,
        fontFamily: 'Inter',
        color: '#111111',
        lineHeight: 1.08,
        textAlign: 'left',
      },
    }, input.width, input.height);
    if (box) layers.push(box);
    if (layers.length >= input.maxTextLayers) break;
  }
  return layers;
}

function overlapRatio(a: ProposedLayer, b: ProposedLayer): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  const minArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return area / minArea;
}

function mergeLayerProposals(visionLayers: ProposedLayer[], ocrLayers: ProposedLayer[], options: {
  maxTextLayers: number;
  maxShapeLayers: number;
  extractObjects: boolean;
  canvasWidth: number;
  canvasHeight: number;
}): ProposedLayer[] {
  const layers: ProposedLayer[] = [];
  const visionText = visionLayers.filter((layer) => layer.type === 'text' && String(layer.content || layer.meta?.content || '').trim());
  const ocrText = ocrLayers.filter((layer) => layer.type === 'text' && String(layer.content || layer.meta?.content || '').trim());
  const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
  for (const layer of [...visionText, ...ocrText]) {
    if (layers.filter((candidate) => candidate.type === 'text').length >= options.maxTextLayers) break;
    const layerText = norm(layer.content || layer.meta?.content);
    const duplicate = layers.some((candidate) => {
      if (candidate.type !== 'text') return false;
      if (overlapRatio(candidate, layer) > 0.35) return true;
      const candText = norm(candidate.content || candidate.meta?.content);
      if (layerText && candText && (layerText === candText || layerText.includes(candText) || candText.includes(layerText))) return true;
      return false;
    });
    if (!duplicate) layers.push(layer);
  }
  const canvasArea = options.canvasWidth * options.canvasHeight;
  const nonText = visionLayers
    .filter((layer) => layer.type !== 'text')
    .filter((layer) => options.extractObjects || layer.type === 'shape')
    .filter((layer) => {
      const area = layer.width * layer.height;
      const conf = Number(layer.confidence ?? 0.55);
      if (conf < 0.45) return false;
      if (area < canvasArea * 0.0008) return false;
      if (area > canvasArea * 0.45) return false;
      const ar = layer.width / Math.max(1, layer.height);
      if (ar > 12 || ar < 1 / 12) return false;
      return true;
    })
    .slice(0, options.maxShapeLayers);
  return [...nonText, ...layers];
}

function layerToElement(layer: ExtractionPipelineLayer, index: number): any | null {
  const id = sanitizeSegment(layer.id || `${layer.type}_${layer.role || index + 1}`, `${layer.type}_${index + 1}`)
    .replace(/^[^a-zA-Z]+/, 'layer_');
  const common = {
    id: `extracted_${id}_${index + 1}`,
    x: Math.round(layer.x),
    y: Math.round(layer.y),
    width: Math.round(layer.width),
    height: Math.round(layer.height),
    rotation: Number(layer.rotation) || 0,
    opacity: Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1,
    locked: false,
    visible: true,
    zIndex: index + 2,
  };
  if (layer.type === 'text') {
    const content = String(layer.content || layer.meta?.content || '').trim();
    if (!content) return null;
    const fillColor = layer.sampledTextColor || coerceHexColor(layer.meta?.color, '#111111');
    return {
      ...common,
      type: 'text',
      meta: {
        content,
        fontFamily: String(layer.meta?.fontFamily || 'Inter'),
        fontSize: Math.max(8, Math.round(Number(layer.meta?.fontSize) || layer.height * 0.78 || 24)),
        fontWeight: Math.max(100, Math.min(900, Math.round(Number(layer.meta?.fontWeight) || 700))),
        color: fillColor,
        lineHeight: Number.isFinite(Number(layer.meta?.lineHeight)) ? Number(layer.meta?.lineHeight) : 1.08,
        letterSpacing: Number.isFinite(Number(layer.meta?.letterSpacing)) ? Number(layer.meta?.letterSpacing) : 0,
        textAlign: String(layer.meta?.textAlign || 'left'),
        role: layer.role || 'text',
        extraction: {
          confidence: layer.confidence ?? null,
          editable: true,
          source: 'image-to-layers',
          colorSource: layer.sampledTextColor ? 'pixel-sampled' : 'vlm',
        },
      },
    };
  }
  if (layer.type === 'shape') {
    const fill = layer.sampledColor || coerceHexColor(layer.meta?.fill, 'rgba(255,255,255,0.7)');
    return {
      ...common,
      type: 'shape',
      meta: {
        shape: layer.vectorPath ? 'path' : String(layer.meta?.shape || 'rect'),
        path: layer.vectorPath || undefined,
        fill,
        stroke: coerceHexColor(layer.meta?.stroke, 'transparent'),
        strokeWidth: Math.max(0, Number(layer.meta?.strokeWidth) || 0),
        radius: Math.max(0, Number(layer.meta?.radius) || 0),
        role: layer.role || 'shape',
        extraction: {
          confidence: layer.confidence ?? null,
          source: 'image-to-layers',
          fillSource: layer.sampledColor ? 'pixel-sampled' : 'vlm',
          vectorTraced: !!layer.vectorPath,
        },
      },
    };
  }
  if (layer.type === 'image') {
    if (layer.cutoutPath) {
      return {
        ...common,
        type: 'image',
        meta: {
          source: layer.cutoutPath,
          fit: 'contain',
          radius: 0,
          role: layer.role || 'cutout',
          label: layer.description || layer.role || 'Extracted object',
          extraction: {
            confidence: layer.confidence ?? null,
            source: 'image-to-layers',
            samCutout: true,
            cutoutBbox: layer.cutoutBbox || null,
          },
        },
      };
    }
    return {
      ...common,
      type: 'image',
      meta: {
        source: '',
        fit: 'cover',
        radius: 0,
        role: layer.role || 'object_candidate',
        label: layer.description || layer.role || 'Object candidate',
        extraction: {
          confidence: layer.confidence ?? null,
          source: 'image-to-layers',
          cropCandidate: true,
          note: 'SAM segmentation unavailable; client falls back to rectangular bbox crop.',
        },
      },
    };
  }
  return null;
}

function buildScene(input: {
  id: string;
  source: CreativeAssetRecord;
  width: number;
  height: number;
  background: string;
  layers: ExtractionPipelineLayer[];
  preserveOriginal: boolean;
  cleanPlatePath: string | null;
}): CreativeSceneDoc {
  const sourcePath = input.source.path || input.source.relativePath || input.source.absPath || input.source.source;
  const elements: any[] = [];
  const baseLayerSource = input.cleanPlatePath || (input.preserveOriginal ? sourcePath : null);
  if (baseLayerSource) {
    elements.push({
      id: 'extracted_background_plate',
      type: 'image',
      x: 0,
      y: 0,
      width: input.width,
      height: input.height,
      rotation: 0,
      opacity: 1,
      locked: true,
      visible: true,
      zIndex: 0,
      meta: {
        source: baseLayerSource,
        fit: 'cover',
        radius: 0,
        role: input.cleanPlatePath ? 'inpainted_clean_plate' : 'locked_source_reference',
        extraction: {
          source: 'image-to-layers',
          inpainted: !!input.cleanPlatePath,
          originalSource: sourcePath,
          note: input.cleanPlatePath
            ? 'Background regenerated by LaMa inpainting after foreground removal. Drag extracted layers freely.'
            : 'Original raster preserved as locked reference. SAM/LaMa unavailable; install models for full extraction.',
        },
      },
    });
  }
  input.layers
    .map(layerToElement)
    .filter(Boolean)
    .forEach((element) => elements.push(element));

  return normalizeCreativeSceneDoc({
    id: input.id,
    version: 2,
    width: input.width,
    height: input.height,
    background: input.background,
    durationMs: 12000,
    frameRate: 60,
    elements,
    selectedId: elements.find((element) => element.type === 'text')?.id || elements[elements.length - 1]?.id || null,
  });
}

export async function extractCreativeLayers(
  storage: CreativeAssetStorage,
  options: CreativeLayerExtractionOptions,
): Promise<CreativeLayerExtractionResult> {
  const source = String(options.source || '').trim();
  if (!source) throw new Error('creative_extract_layers requires a source image.');
  const mode = (['fast', 'balanced', 'deep'].includes(String(options.mode || '')) ? options.mode : 'balanced') as CreativeLayerExtractionMode;
  const textEditable = options.textEditable === true;
  const extractObjects = options.extractObjects === true || (options.extractObjects !== false && mode === 'deep');
  const preserveOriginal = options.preserveOriginal !== false;
  const maxTextLayers = textEditable
    ? Math.max(0, Math.min(40, Number(options.maxTextLayers) || (mode === 'deep' ? 24 : 16)))
    : 0;
  const maxShapeLayers = Math.max(0, Math.min(40, Number(options.maxShapeLayers) || (mode === 'deep' ? 24 : 14)));
  const warnings: string[] = [];

  const sourceAsset = await importCreativeAsset(storage, {
    source,
    copy: options.copySource !== false,
    tags: ['layer-extraction', 'source'],
  });
  if (sourceAsset.kind !== 'image' && sourceAsset.kind !== 'svg') {
    throw new Error(`creative_extract_layers only supports image assets right now. Received ${sourceAsset.kind}.`);
  }
  if (!sourceAsset.absPath || !fs.existsSync(sourceAsset.absPath)) {
    throw new Error('Layer extraction requires a local workspace image file.');
  }

  const analyzed = sourceAsset.width && sourceAsset.height
    ? sourceAsset
    : await analyzeCreativeAsset(storage, { source: sourceAsset.absPath, tags: ['layer-extraction', 'source'] });
  const width = Math.max(64, Math.round(Number(analyzed.width) || 1080));
  const height = Math.max(64, Math.round(Number(analyzed.height) || 1080));
  const mimeType = analyzed.mimeType || 'image/png';
  const isSpriteSizedRaster = sourceAsset.kind === 'image'
    && Math.max(1, Number(analyzed.width) || width) <= 96
    && Math.max(1, Number(analyzed.height) || height) <= 96;
  if (isSpriteSizedRaster) {
    warnings.push('Tiny image detected; OCR and semantic vision extraction were skipped to avoid false text/object hallucinations. Use the Image Studio Extract Layers button for pixel-accurate sprite extraction.');
  }

  let visionLayers: ProposedLayer[] = [];
  let visionBackground: string | null = null;
  const vision = { attempted: false, used: false, error: null as string | null, model: null as string | null };
  if (options.useVision !== false && !isSpriteSizedRaster) {
    vision.attempted = true;
    try {
      const result = await analyzeWithOpenAIVision({
        absPath: sourceAsset.absPath,
        mimeType,
        width,
        height,
        prompt: options.prompt,
        mode,
        extractObjects,
      });
      visionLayers = result.layers;
      visionBackground = result.background;
      vision.used = visionLayers.length > 0;
      vision.model = result.model;
    } catch (err: any) {
      vision.error = String(err?.message || err || 'OpenAI vision analysis failed').slice(0, 500);
      warnings.push(`Vision layer proposal skipped: ${vision.error}`);
    }
  }

  let ocrLayers: ProposedLayer[] = [];
  const ocr = { attempted: false, used: false, error: null as string | null, textLayerCount: 0 };
  if (options.useOcr === true && textEditable && maxTextLayers > 0 && mode !== 'fast' && sourceAsset.kind === 'image' && !isSpriteSizedRaster) {
    ocr.attempted = true;
    try {
      ocrLayers = await analyzeWithTesseract({
        absPath: sourceAsset.absPath,
        width,
        height,
        maxTextLayers,
      });
      ocr.used = ocrLayers.length > 0;
      ocr.textLayerCount = ocrLayers.length;
    } catch (err: any) {
      ocr.error = String(err?.message || err || 'OCR failed').slice(0, 500);
      warnings.push(`OCR text extraction skipped: ${ocr.error}`);
    }
  }

  const mergedProposals = mergeLayerProposals(visionLayers, ocrLayers, {
    maxTextLayers,
    maxShapeLayers,
    extractObjects,
    canvasWidth: width,
    canvasHeight: height,
  });
  let pipelineLayers: ExtractionPipelineLayer[] = mergedProposals as ExtractionPipelineLayer[];

  const stack = isSegmentationStackAvailable();
  const useSam = options.useSam !== false && stack.sam && !isSpriteSizedRaster;
  const useLama = options.inpaintBackground !== false && stack.lama;
  const useVectorTrace = options.vectorTraceShapes !== false;
  const id = nowId('image_layers');
  const extractionDir = path.join(storage.creativeDir, 'extractions', sanitizeSegment(id));

  const sam = { attempted: false, used: false, cutoutCount: 0, available: stack.sam };
  if (useSam) {
    sam.attempted = true;
    try {
      const cutoutDir = path.join(extractionDir, 'cutouts');
      const result = await runSamCutouts({
        sourceAbsPath: sourceAsset.absPath,
        layers: pipelineLayers,
        outputDir: cutoutDir,
      });
      pipelineLayers = result.layers.map((layer) => {
        if (!layer.cutoutAbsPath) return layer;
        return { ...layer, cutoutPath: buildWorkspaceRelativePath(storage, layer.cutoutAbsPath) };
      });
      sam.cutoutCount = pipelineLayers.filter((l) => !!l.cutoutAbsPath).length;
      sam.used = sam.cutoutCount > 0;
    } catch (err: any) {
      warnings.push(`SAM cutout step skipped: ${String(err?.message || err).slice(0, 200)}`);
    }
  } else if (!stack.sam) {
    warnings.push('MobileSAM weights not installed — image layers fall back to rectangular bbox crops. Run: node scripts/download-creative-models.mjs');
  }

  try {
    pipelineLayers = await sampleLayerColors({ sourceAbsPath: sourceAsset.absPath, layers: pipelineLayers });
  } catch (err: any) {
    warnings.push(`Color sampling skipped: ${String(err?.message || err).slice(0, 200)}`);
  }

  const vectorTrace = { attempted: false, tracedCount: 0 };
  if (useVectorTrace) {
    vectorTrace.attempted = true;
    try {
      pipelineLayers = await tryTraceShapeLayers({ sourceAbsPath: sourceAsset.absPath, layers: pipelineLayers });
      vectorTrace.tracedCount = pipelineLayers.filter((l) => !!l.vectorPath).length;
    } catch (err: any) {
      warnings.push(`Vector trace skipped: ${String(err?.message || err).slice(0, 200)}`);
    }
  }

  const inpaint = { attempted: false, used: false, available: stack.lama, cleanPlatePath: null as string | null };
  let cleanPlateAbsPath: string | null = null;
  if (useLama) {
    inpaint.attempted = true;
    try {
      const cleanPlateOut = path.join(extractionDir, 'clean_plate.png');
      const cutoutLayers = pipelineLayers.filter((l) => l.type === 'image' && l.cutoutAbsPath);
      const textBoxes = pipelineLayers
        .filter((l) => l.type === 'text')
        .map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height }));
      const shapeBoxes = pipelineLayers
        .filter((l) => l.type === 'shape')
        .map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height }));
      const result = await produceCleanPlate({
        sourceAbsPath: sourceAsset.absPath,
        outputAbsPath: cleanPlateOut,
        cutoutLayers,
        textBoxes,
        shapeBoxes,
        padPx: mode === 'deep' ? 22 : 16,
      });
      if (result.written) {
        cleanPlateAbsPath = result.absPath;
        inpaint.used = true;
        inpaint.cleanPlatePath = buildWorkspaceRelativePath(storage, result.absPath);
      }
    } catch (err: any) {
      warnings.push(`Background inpainting skipped: ${String(err?.message || err).slice(0, 200)}`);
    }
  } else if (!stack.lama) {
    warnings.push('LaMa weights not installed — clean-plate background not generated. Run: node scripts/download-creative-models.mjs');
  }

  if (!pipelineLayers.length) {
    warnings.push('No editable sublayers were detected. The scene still preserves a background reference layer.');
  }

  const scene = buildScene({
    id,
    source: analyzed,
    width,
    height,
    background: coerceHexColor(visionBackground, '#ffffff'),
    layers: pipelineLayers,
    preserveOriginal,
    cleanPlatePath: inpaint.cleanPlatePath,
  });
  const scenesDir = path.join(storage.creativeDir, 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });
  const sceneAbsPath = path.join(scenesDir, `${sanitizeSegment(id)}.json`);
  fs.writeFileSync(sceneAbsPath, JSON.stringify(scene, null, 2), 'utf-8');
  const scenePath = buildWorkspaceRelativePath(storage, sceneAbsPath);
  const ops = [
    { op: 'set_canvas', width: scene.width, height: scene.height, background: scene.background, durationMs: scene.durationMs, frameRate: scene.frameRate },
    ...scene.elements.map((element) => ({ op: 'add', ...element })),
  ];

  void cleanPlateAbsPath;
  return {
    id,
    source: analyzed,
    scene,
    sceneSummary: summarizeCreativeSceneDoc(scene),
    scenePath,
    sceneAbsPath,
    ops,
    layers: pipelineLayers,
    diagnostics: {
      mode,
      vision,
      ocr,
      sam,
      inpaint,
      vectorTrace,
      warningCount: warnings.length,
      warnings,
    },
  };
}

export async function refineCreativeLayerCutout(opts: {
  storage: CreativeAssetStorage;
  source: string;
  bbox: { x: number; y: number; width: number; height: number };
  points: Array<{ x: number; y: number; positive: boolean }>;
  outputName?: string;
}): Promise<{ cutoutPath: string; cutoutAbsPath: string; bbox: { x: number; y: number; width: number; height: number } | null }> {
  const sourceAsset = await importCreativeAsset(opts.storage, { source: opts.source, copy: false, tags: ['layer-extraction', 'refine'] });
  if (!sourceAsset.absPath || !fs.existsSync(sourceAsset.absPath)) {
    throw new Error('Refine requires the source image to exist on disk.');
  }
  const refineDir = path.join(opts.storage.creativeDir, 'extractions', 'refined');
  const fileName = sanitizeSegment(opts.outputName || `refined_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}.png`, 'refined.png');
  const outAbs = path.join(refineDir, fileName.endsWith('.png') ? fileName : `${fileName}.png`);
  const { refineCutoutWithPoints } = await import('./onnx/pipeline');
  const applied = await refineCutoutWithPoints({
    sourceAbsPath: sourceAsset.absPath,
    outputAbsPath: outAbs,
    bbox: opts.bbox,
    points: opts.points,
  });
  return {
    cutoutAbsPath: outAbs,
    cutoutPath: buildWorkspaceRelativePath(opts.storage, outAbs),
    bbox: applied.bbox,
  };
}
