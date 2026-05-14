import { reportHtmlTextFit, type HtmlTextFitReport } from './pretext-measure';

export type HtmlMotionLintSeverity = 'info' | 'warning' | 'error';

export type HtmlMotionLintIssue = {
  severity: HtmlMotionLintSeverity;
  code: string;
  message: string;
  selector?: string;
  hint?: string;
};

export type HtmlMotionTimedNode = {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  role: string | null;
  trackIndex: number | null;
  startMs: number;
  durationMs: number | null;
  endMs: number | null;
  animate: string | null;
  caption: string | null;
  assetRefs: string[];
};

export type HtmlMotionCompositionSummary = {
  version: 1;
  compositionId: string | null;
  stageSelector: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  frameRate: number | null;
  hasExternalNetworkDependency: boolean;
  usesPrometheusSeekEvent: boolean;
  usesPrometheusTimeGlobal: boolean;
  usesWebGl: boolean;
  usesThreeJs: boolean;
  timedNodes: HtmlMotionTimedNode[];
  roles: Array<{ role: string; count: number }>;
  tracks: Array<{ trackIndex: number; count: number; startMs: number; endMs: number | null }>;
  assetPlaceholders: string[];
};

export type HtmlMotionParsedTime = {
  raw: string;
  valueMs: number | null;
  unit: 'ms' | 's' | 'bare' | 'invalid' | 'empty';
  ambiguous: boolean;
};

export type HtmlMotionLintResult = {
  ok: boolean;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: HtmlMotionLintIssue[];
  composition: HtmlMotionCompositionSummary;
  textFit?: HtmlTextFitReport;
};

type RawTag = {
  tag: string;
  attrs: string;
  selector: string;
};

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeAssetPlaceholderId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function collectAssetPlaceholders(source: string): string[] {
  const refs = [
    ...Array.from(source.matchAll(/\{\{\s*asset\.([a-z0-9_-]+)\s*\}\}/gi)).map((match) => match[1]),
    ...Array.from(source.matchAll(/\{\{\s*(?!asset\.)([a-z0-9_-]+)\s*\}\}/gi)).map((match) => match[1]),
    ...Array.from(source.matchAll(/__PROM_ASSET_([A-Z0-9_-]+)__/g)).map((match) => match[1]),
  ]
    .map(sanitizeAssetPlaceholderId)
    .filter(Boolean);
  return [...new Set(refs)];
}

function getAttr(attrs: string, name: string): string | null {
  const exact = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs);
  if (exact) return exact[2] || '';
  const bare = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*([^\\s"'=<>` + '`' + `]+)`, 'i').exec(attrs);
  if (bare) return bare[1] || '';
  return null;
}

function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}(?:\\s*=|\\b)`, 'i').test(attrs);
}

export function parseHtmlMotionTime(value: unknown): HtmlMotionParsedTime {
  const raw = String(value ?? '').trim();
  if (!raw) return { raw, valueMs: null, unit: 'empty', ambiguous: false };
  const match = raw.match(/^(-?\d+(?:\.\d+)?)(ms|s)?$/i);
  if (!match) return { raw, valueMs: null, unit: 'invalid', ambiguous: false };
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return { raw, valueMs: null, unit: 'invalid', ambiguous: false };
  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'ms') return { raw, valueMs: Math.round(numeric), unit: 'ms', ambiguous: false };
  if (suffix === 's') return { raw, valueMs: Math.round(numeric * 1000), unit: 's', ambiguous: false };
  return { raw, valueMs: Math.round(numeric), unit: 'bare', ambiguous: true };
}

export function parseHtmlMotionTimeMs(value: unknown): number | null {
  return parseHtmlMotionTime(value).valueMs;
}

function parseMs(value: unknown): number | null {
  return parseHtmlMotionTimeMs(value);
}

function parseNumber(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseClasses(raw: string | null): string[] {
  return String(raw || '').split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function selectorFor(tag: string, attrs: string, index: number): string {
  const id = getAttr(attrs, 'id');
  if (id) return `#${id}`;
  const role = getAttr(attrs, 'data-role');
  if (role) return `${tag}[data-role="${role}"]:nth-of-type(${index + 1})`;
  const classes = parseClasses(getAttr(attrs, 'class'));
  if (classes.length) return `${tag}.${classes.slice(0, 2).join('.')}:nth-of-type(${index + 1})`;
  return `${tag}:nth-of-type(${index + 1})`;
}

function collectTags(html: string): RawTag[] {
  const tags: RawTag[] = [];
  const pattern = /<([a-z][a-z0-9:-]*)\b([^<>]*?)(\/?)>/gi;
  let match: RegExpExecArray | null = null;
  let index = 0;
  while ((match = pattern.exec(html)) !== null) {
    const tag = String(match[1] || '').toLowerCase();
    if (tag.startsWith('!') || tag === 'script' || tag === 'style') continue;
    tags.push({
      tag,
      attrs: match[2] || '',
      selector: selectorFor(tag, match[2] || '', index),
    });
    index += 1;
  }
  return tags;
}

function extractStage(tags: RawTag[]): RawTag | null {
  const isDocumentShell = (tag: RawTag) => ['html', 'head', 'body'].includes(tag.tag);
  return tags.find((tag) => getAttr(tag.attrs, 'id') === 'stage')
    || tags.find((tag) => !isDocumentShell(tag) && hasAttr(tag.attrs, 'data-composition-id'))
    || tags.find((tag) => !isDocumentShell(tag) && parseClasses(getAttr(tag.attrs, 'class')).includes('stage'))
    || null;
}

function inferDimensionFromHtml(html: string, dimension: 'width' | 'height'): number | null {
  const htmlBody = new RegExp(`(?:html|body)[^{]*\\{[^}]*\\b${dimension}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i').exec(html);
  if (htmlBody) return Math.round(Number(htmlBody[1]));
  const cssVar = new RegExp(`--(?:stage-|composition-)?${dimension}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i').exec(html);
  if (cssVar) return Math.round(Number(cssVar[1]));
  return null;
}

function extractAssetRefs(attrs: string): string[] {
  const refs = new Set<string>();
  for (const name of ['src', 'href', 'poster']) {
    const value = getAttr(attrs, name);
    if (value) refs.add(value);
  }
  return [...refs];
}

function hasExternalNetworkUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^\/\//.test(value);
}

function looksLikeAbsoluteWindowsPath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(String(value || '').trim()) || /^\\\\[^\\]+\\[^\\]+/.test(String(value || '').trim());
}

function isAssetPlaceholder(value: string): boolean {
  return /\{\{\s*asset\.[a-z0-9_-]+\s*\}\}/i.test(String(value || ''));
}

function summarizeRoles(nodes: HtmlMotionTimedNode[]) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (!node.role) continue;
    counts.set(node.role, (counts.get(node.role) || 0) + 1);
  }
  return [...counts.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => a.role.localeCompare(b.role));
}

function summarizeTracks(nodes: HtmlMotionTimedNode[]) {
  const tracks = new Map<number, HtmlMotionTimedNode[]>();
  for (const node of nodes) {
    if (node.trackIndex === null) continue;
    const list = tracks.get(node.trackIndex) || [];
    list.push(node);
    tracks.set(node.trackIndex, list);
  }
  return [...tracks.entries()].map(([trackIndex, list]) => {
    const starts = list.map((node) => node.startMs);
    const ends = list.map((node) => node.endMs).filter((value): value is number => typeof value === 'number');
    return {
      trackIndex,
      count: list.length,
      startMs: starts.length ? Math.min(...starts) : 0,
      endMs: ends.length ? Math.max(...ends) : null,
    };
  }).sort((a, b) => a.trackIndex - b.trackIndex);
}

export function lintHtmlMotionComposition(html: string, manifest: any = {}): HtmlMotionLintResult {
  const source = String(html || '');
  const issues: HtmlMotionLintIssue[] = [];
  const tags = collectTags(source);
  const stage = extractStage(tags);
  const width = Math.round(Number(manifest?.width) || 0) || parseNumber(stage ? getAttr(stage.attrs, 'data-width') : null) || inferDimensionFromHtml(source, 'width');
  const height = Math.round(Number(manifest?.height) || 0) || parseNumber(stage ? getAttr(stage.attrs, 'data-height') : null) || inferDimensionFromHtml(source, 'height');
  const durationMs = Math.round(Number(manifest?.durationMs) || 0) || parseMs(stage ? getAttr(stage.attrs, 'data-duration') : null);
  const frameRate = Math.round(Number(manifest?.frameRate) || 0) || parseNumber(stage ? getAttr(stage.attrs, 'data-frame-rate') || getAttr(stage.attrs, 'data-fps') : null);
  const assetPlaceholders = collectAssetPlaceholders(source);
  const manifestAssetIds = new Set(
    (Array.isArray(manifest?.assets) ? manifest.assets : [])
      .map((asset: any) => sanitizeAssetPlaceholderId(asset?.id || ''))
      .filter(Boolean),
  );

  if (!stage) {
    issues.push({
      severity: 'error',
      code: 'missing-stage',
      message: 'No stage element was found. Prefer a root element with data-composition-id, data-width, data-height, and data-duration.',
      hint: '<main id="stage" data-composition-id="my-video" data-width="1080" data-height="1920" data-duration="8000ms" data-frame-rate="30">',
    });
  } else {
    for (const name of ['data-composition-id', 'data-width', 'data-height', 'data-duration', 'data-frame-rate']) {
      if (hasAttr(stage.attrs, name)) continue;
      issues.push({
        severity: name === 'data-frame-rate' ? 'warning' : 'error',
        code: 'missing-stage-metadata',
        selector: stage.selector,
        message: `Stage is missing required ${name} metadata.`,
        hint: 'Prometheus HTML Motion stages should declare data-composition-id, data-width, data-height, data-duration, and data-frame-rate.',
      });
    }
  }
  if (!width || !height) {
    issues.push({
      severity: 'error',
      code: 'missing-dimensions',
      message: 'Composition width and height could not be inferred.',
      hint: 'Set manifest width/height or add data-width/data-height on the stage.',
    });
  }
  if (!durationMs) {
    issues.push({
      severity: 'error',
      code: 'missing-duration',
      message: 'Composition duration could not be inferred.',
      hint: 'Set manifest durationMs or add data-duration on the stage.',
    });
  }
  if (width && height && width < 320 || height && height < 320) {
    issues.push({
      severity: 'error',
      code: 'tiny-canvas',
      message: 'Composition dimensions are too small for video export.',
      hint: 'Use at least 320px in each dimension; 1080x1920 is the vertical default.',
    });
  }

  const timedNodes: HtmlMotionTimedNode[] = [];
  const timingAttrs = ['data-start', 'data-duration', 'data-end', 'data-trim-start', 'data-offset', 'data-from'];
  for (const tag of tags) {
    const hasTiming = hasAttr(tag.attrs, 'data-start') || hasAttr(tag.attrs, 'data-duration') || hasAttr(tag.attrs, 'data-end') || hasAttr(tag.attrs, 'data-track-index');
    const role = getAttr(tag.attrs, 'data-role');
    const animate = getAttr(tag.attrs, 'data-animate');
    const caption = getAttr(tag.attrs, 'data-caption');
    if (!hasTiming && !role && !animate && !caption) continue;
    const startMs = parseMs(getAttr(tag.attrs, 'data-start') || getAttr(tag.attrs, 'data-from')) || 0;
    const durationAttr = parseMs(getAttr(tag.attrs, 'data-duration'));
    const endAttr = parseMs(getAttr(tag.attrs, 'data-end'));
    const endMs = endAttr ?? (durationAttr !== null ? startMs + durationAttr : null);
    const node: HtmlMotionTimedNode = {
      selector: tag.selector,
      tag: tag.tag,
      id: getAttr(tag.attrs, 'id'),
      classes: parseClasses(getAttr(tag.attrs, 'class')),
      role,
      trackIndex: parseNumber(getAttr(tag.attrs, 'data-track-index')),
      startMs,
      durationMs: durationAttr,
      endMs,
      animate,
      caption,
      assetRefs: extractAssetRefs(tag.attrs),
    };
    timedNodes.push(node);
    for (const attr of timingAttrs) {
      if (!hasAttr(tag.attrs, attr)) continue;
      const parsed = parseHtmlMotionTime(getAttr(tag.attrs, attr));
      if (parsed.unit === 'invalid') {
        issues.push({
          severity: 'error',
          code: 'invalid-time-value',
          selector: tag.selector,
          message: `${attr} has an invalid time value "${parsed.raw}".`,
          hint: 'Use explicit units such as 1200ms or 1.2s.',
        });
      } else if (parsed.ambiguous) {
        issues.push({
          severity: 'warning',
          code: 'unsuffixed-time-value',
          selector: tag.selector,
          message: `${attr}="${parsed.raw}" has no unit. Prometheus currently treats legacy bare values as milliseconds, but new clips must use ms or s.`,
          hint: `Use ${parsed.raw}ms for Prometheus-native timing, or ${Number(parsed.raw) / 1000}s if you intended seconds.`,
        });
      }
    }
    if (hasTiming) {
      if (!role && tag !== stage) {
        issues.push({
          severity: 'warning',
          code: 'missing-timed-role',
          selector: tag.selector,
          message: 'Timed element is missing data-role metadata.',
          hint: 'Use roles such as scene, caption, lower-third, cta, media, transition, ascii-layer, chart, or overlay.',
        });
      }
      if (node.trackIndex === null && tag !== stage) {
        issues.push({
          severity: 'warning',
          code: 'missing-track-index',
          selector: tag.selector,
          message: 'Timed element is missing data-track-index metadata.',
          hint: 'Set data-track-index so lint can detect accidental same-track overlaps.',
        });
      }
    }
    if (durationAttr !== null && durationAttr <= 0) {
      issues.push({ severity: 'error', code: 'invalid-duration', selector: tag.selector, message: 'Timed element has a non-positive data-duration.' });
    }
    if (endMs !== null && endMs <= startMs) {
      issues.push({ severity: 'error', code: 'invalid-end', selector: tag.selector, message: 'Timed element ends before or at its start time.' });
    }
    if (durationMs && endMs !== null && endMs > durationMs + 100) {
      issues.push({ severity: 'warning', code: 'element-past-duration', selector: tag.selector, message: 'Timed element extends past the composition duration.' });
    }
    if ((tag.tag === 'video' || tag.tag === 'audio') && !hasAttr(tag.attrs, 'data-start')) {
      issues.push({ severity: 'warning', code: 'untimed-media', selector: tag.selector, message: 'Media element should declare data-start for deterministic seeking.' });
    }
  }

  if (!timedNodes.length) {
    issues.push({
      severity: 'warning',
      code: 'no-timed-nodes',
      message: 'No timed nodes were found. HyperFrames-style compositions should use data-start/data-duration on meaningful clips.',
    });
  }

  for (const track of [...new Set(timedNodes.map((node) => node.trackIndex).filter((value): value is number => value !== null))]) {
    const nodes = timedNodes
      .filter((node) => node.trackIndex === track && node.endMs !== null)
      .sort((a, b) => a.startMs - b.startMs || (a.endMs || 0) - (b.endMs || 0));
    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1];
      const current = nodes[index];
      if ((previous.endMs || 0) > current.startMs) {
        const duplicate = previous.startMs === current.startMs && previous.endMs === current.endMs;
        issues.push({
          severity: duplicate ? 'warning' : 'error',
          code: duplicate ? 'duplicate-track-timing' : 'overlapping-track-timing',
          selector: current.selector,
          message: duplicate
            ? `Track ${track} has duplicate timing with another element.`
            : `Track ${track} has overlapping timed elements (${previous.selector} overlaps ${current.selector}).`,
          hint: 'Move one element to a different data-track-index or adjust data-start/data-duration.',
        });
      }
    }
  }

  const allAssetRefs = new Set<string>();
  for (const tag of tags) {
    for (const ref of extractAssetRefs(tag.attrs)) allAssetRefs.add(ref);
  }
  const externalNetworkRefs = [...allAssetRefs].filter(hasExternalNetworkUrl);
  if (externalNetworkRefs.length) {
    issues.push({
      severity: 'error',
      code: 'external-network-assets',
      message: `Composition references ${externalNetworkRefs.length} external network asset(s).`,
      hint: 'Import reusable media through the Creative asset index or pass it via HTML motion assets for reliable offline export.',
    });
  }
  const absoluteLocalRefs = [...allAssetRefs].filter(looksLikeAbsoluteWindowsPath);
  if (absoluteLocalRefs.length) {
    issues.push({
      severity: 'error',
      code: 'absolute-local-assets',
      message: `Composition references ${absoluteLocalRefs.length} absolute local file path(s).`,
      hint: 'Use {{asset.id}} placeholders so Prometheus can serve assets in preview, QA, and export.',
    });
  }
  for (const tag of tags) {
    if (!['img', 'video', 'audio', 'source'].includes(tag.tag)) continue;
    for (const ref of extractAssetRefs(tag.attrs)) {
      if (/^data:/i.test(ref) || isAssetPlaceholder(ref)) continue;
      issues.push({
        severity: hasExternalNetworkUrl(ref) || looksLikeAbsoluteWindowsPath(ref) ? 'error' : 'warning',
        code: 'non-placeholder-media',
        selector: tag.selector,
        message: `Media source "${ref}" is not a Prometheus {{asset.id}} placeholder.`,
        hint: 'Register media as an HTML Motion asset and reference it as {{asset.demo}}, {{asset.logo}}, etc.',
      });
    }
  }
  if (/<script\b[^>]*\bsrc=/i.test(source) || /<link\b[^>]*\bhref=["']https?:\/\//i.test(source)) {
    issues.push({
      severity: 'error',
      code: 'external-code-dependency',
      message: 'Composition appears to load external script or stylesheet resources.',
      hint: 'Inline the required JS/CSS or vendor it through workspace assets before final export.',
    });
  }
  const usesWebGl = /\bWebGLRenderer\b|getContext\(\s*['"]webgl2?['"]|data-prometheus-webgl=["']true["']|data-renderer=["']three["']/i.test(source);
  const usesThreeJs = /from\s+['"](?:three|\/api\/canvas\/vendor\/three\/)|\/api\/canvas\/vendor\/three\/|data-renderer=["']three["']/i.test(source);
  if (usesWebGl && !/preserveDrawingBuffer\s*:\s*true/i.test(source)) {
    issues.push({
      severity: 'warning',
      code: 'webgl-preserve-buffer',
      message: 'WebGL content may screenshot as blank if the renderer does not use preserveDrawingBuffer:true.',
      hint: 'Create the WebGLRenderer with preserveDrawingBuffer:true for deterministic frame capture.',
    });
  }
  if (usesThreeJs && !/\/api\/canvas\/vendor\/three\//.test(source)) {
    issues.push({
      severity: 'warning',
      code: 'three-not-local-vendor',
      message: 'Three.js is referenced without the Prometheus local vendor route.',
      hint: 'Import Three.js from /api/canvas/vendor/three/build/three.module.js so preview/export stay offline and deterministic.',
    });
  }
  if (/\b(?:Date\.now|performance\.now|setInterval)\s*\(/.test(source)) {
    issues.push({
      severity: 'warning',
      code: 'wall-clock-animation',
      message: 'Composition uses wall-clock timing primitives that can drift during export.',
      hint: 'Use window.__PROMETHEUS_HTML_MOTION_TIME_MS__ or the prometheus-html-motion-seek event as the source of truth. performance.now() is only acceptable as a preview fallback.',
    });
  }
  if (/\bposition\s*:\s*fixed\b/i.test(source)) {
    issues.push({ severity: 'info', code: 'fixed-position', message: 'Fixed positioning is present; verify snapshots at start/mid/end for crop safety.' });
  }
  for (const placeholder of assetPlaceholders) {
    if (!manifestAssetIds.has(placeholder)) {
      issues.push({
        severity: 'error',
        code: 'missing-asset',
        message: `Asset placeholder "${placeholder}" does not have a matching manifest asset.`,
        hint: `Pass an HTML motion asset with id "${placeholder}" or replace the placeholder before export.`,
      });
    }
  }

  const composition: HtmlMotionCompositionSummary = {
    version: 1,
    compositionId: stage ? getAttr(stage.attrs, 'data-composition-id') : null,
    stageSelector: stage ? stage.selector : null,
    width: width ? Math.round(width) : null,
    height: height ? Math.round(height) : null,
    durationMs: durationMs ? Math.round(durationMs) : null,
    frameRate: frameRate ? Math.round(frameRate) : null,
    hasExternalNetworkDependency: externalNetworkRefs.length > 0 || /<script\b[^>]*\bsrc=|<link\b[^>]*\bhref=["']https?:\/\//i.test(source),
    usesPrometheusSeekEvent: /prometheus-html-motion-seek/.test(source),
    usesPrometheusTimeGlobal: /__PROMETHEUS_HTML_MOTION_TIME_(?:SECONDS|MS)__/.test(source),
    usesWebGl,
    usesThreeJs,
    timedNodes,
    roles: summarizeRoles(timedNodes),
    tracks: summarizeTracks(timedNodes),
    assetPlaceholders: [...new Set(assetPlaceholders)],
  };

  let textFit: HtmlTextFitReport | undefined;
  try {
    textFit = reportHtmlTextFit(source, {
      stageWidth: width || undefined,
      stageHeight: height || undefined,
    });
    for (const finding of textFit.findings) {
      if (!finding.overflowsHeight && !finding.overflowsWidth) continue;
      const reason = finding.overflowsHeight
        ? `text overflows box (${finding.measuredHeight}px measured / ${finding.availableHeight ?? '?'}px available, ${finding.lineCount} line${finding.lineCount === 1 ? '' : 's'})`
        : 'longest word is wider than the available text width';
      const hint = finding.suggestedFontSize
        ? `Lower font-size to ~${finding.suggestedFontSize}px or grow the box.`
        : 'Grow the box, shorten the copy, or wrap with explicit line breaks.';
      issues.push({
        severity: 'warning',
        code: finding.overflowsHeight ? 'text-overflow-height' : 'text-overflow-width',
        selector: finding.selector,
        message: `Text fit (pretext): ${reason}.`,
        hint,
      });
    }
  } catch {
    /* heuristic measurer is best-effort; never block lint on its failure */
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    ok: errorCount === 0,
    issueCount: issues.length,
    errorCount,
    warningCount,
    issues,
    composition,
    ...(textFit ? { textFit } : {}),
  };
}

export function buildHtmlMotionCompositionMetadata(html: string, manifest: any = {}) {
  const lint = lintHtmlMotionComposition(html, manifest);
  return {
    composition: lint.composition,
    lint: {
      ok: lint.ok,
      issueCount: lint.issueCount,
      errorCount: lint.errorCount,
      warningCount: lint.warningCount,
      issues: lint.issues.slice(0, 100),
    },
  };
}
