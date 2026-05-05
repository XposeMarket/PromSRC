/**
 * pretext-measure.ts — gateway-side text-fit checks for HTML motion clips,
 * scene graph elements, and template slot copy.
 *
 * The browser uses @chenglou/pretext directly through /vendor/pretext for
 * pixel-accurate measurement. The gateway runs in CommonJS Node without a
 * canvas backend, so we ship a tuned heuristic measurer here that mirrors
 * the fallback path in web-ui/src/components/creative/sceneGraph.js. The
 * heuristic is conservative — it flags clear overflow and approximates line
 * counts to within ±1 line for typical Latin copy. Production-grade pixel
 * measurement still happens in the browser and during snapshot QA.
 */

export type PretextMeasureOptions = {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number | string;
  fontStyle?: string;
  lineHeight?: number;
  /** Character width factor relative to fontSize. Default 0.56 for Inter-ish. */
  widthRatio?: number;
};

export type PretextMeasureResult = {
  text: string;
  width: number;
  height: number;
  lineCount: number;
  lineHeightPx: number;
  fontSize: number;
  kind: 'heuristic';
};

export type PretextFitOptions = PretextMeasureOptions & {
  width: number;
  maxHeight?: number;
};

export type PretextFitResult = PretextMeasureResult & {
  availableWidth: number;
  availableHeight: number | null;
  overflowsHeight: boolean;
  overflowsWidth: boolean;
  suggestedFontSize?: number;
};

const DEFAULT_FONT_SIZE = 24;
const DEFAULT_LINE_HEIGHT = 1.2;
const DEFAULT_WIDTH_RATIO = 0.56;

function clampNumber(value: unknown, min: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, num);
}

function avgCharWidthFor(fontSize: number, opts: PretextMeasureOptions): number {
  const family = String(opts.fontFamily || '').toLowerCase();
  const weight = Number(opts.fontWeight) || 400;
  let ratio = Number(opts.widthRatio);
  if (!Number.isFinite(ratio)) {
    if (/impact|bebas|condensed|narrow/.test(family)) ratio = 0.46;
    else if (/mono|consol|courier/.test(family)) ratio = 0.6;
    else if (/playfair|georgia|serif/.test(family)) ratio = 0.54;
    else ratio = DEFAULT_WIDTH_RATIO;
  }
  if (weight >= 800) ratio *= 1.05;
  else if (weight <= 300) ratio *= 0.96;
  if (String(opts.fontStyle || '').toLowerCase() === 'italic') ratio *= 0.98;
  return Math.max(4, fontSize * ratio);
}

function lineHeightPxFrom(fontSize: number, lineHeight: number | undefined): number {
  const lh = Number.isFinite(Number(lineHeight)) ? Number(lineHeight) : DEFAULT_LINE_HEIGHT;
  if (lh > 4) return Math.max(fontSize, Math.ceil(lh));
  return Math.max(fontSize, Math.ceil(fontSize * lh));
}

function countLogicalLines(text: string, charsPerLine: number): number {
  if (!text) return 1;
  const segments = text.split(/\r?\n/);
  let total = 0;
  for (const seg of segments) {
    if (!seg) {
      total += 1;
      continue;
    }
    // Word-aware wrap: greedy fit by words.
    const words = seg.split(/\s+/).filter(Boolean);
    if (!words.length) {
      total += 1;
      continue;
    }
    let lines = 1;
    let used = 0;
    for (const word of words) {
      const wlen = word.length;
      if (wlen > charsPerLine) {
        if (used > 0) lines += 1;
        const wraps = Math.ceil(wlen / charsPerLine);
        lines += wraps - 1;
        used = wlen % charsPerLine || charsPerLine;
        continue;
      }
      const candidate = used === 0 ? wlen : used + 1 + wlen;
      if (candidate > charsPerLine) {
        lines += 1;
        used = wlen;
      } else {
        used = candidate;
      }
    }
    total += lines;
  }
  return Math.max(1, total);
}

export function measureTextBlock(text: string, width: number, options: PretextMeasureOptions = {}): PretextMeasureResult {
  const safeText = String(text ?? '');
  const fontSize = clampNumber(options.fontSize, 6, DEFAULT_FONT_SIZE);
  const safeWidth = clampNumber(width, 16, 320);
  const charWidth = avgCharWidthFor(fontSize, options);
  const charsPerLine = Math.max(4, Math.floor(safeWidth / charWidth));
  const lineCount = countLogicalLines(safeText.trim() || ' ', charsPerLine);
  const lhPx = lineHeightPxFrom(fontSize, options.lineHeight);
  const height = Math.max(lhPx, Math.ceil(lhPx * lineCount));
  return {
    text: safeText,
    width: safeWidth,
    height,
    lineCount,
    lineHeightPx: lhPx,
    fontSize,
    kind: 'heuristic',
  };
}

export function checkTextFit(text: string, options: PretextFitOptions): PretextFitResult {
  const measurement = measureTextBlock(text, options.width, options);
  const availableHeight = Number.isFinite(Number(options.maxHeight)) ? Number(options.maxHeight) : null;
  const charWidth = avgCharWidthFor(measurement.fontSize, options);
  const longestRun = (String(text || '').split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0)) * charWidth;
  const overflowsWidth = longestRun > measurement.width + 1;
  const overflowsHeight = availableHeight !== null && measurement.height > availableHeight + 1;
  let suggestedFontSize: number | undefined;
  if (overflowsHeight && availableHeight && availableHeight > 0) {
    const ratio = availableHeight / measurement.height;
    const candidate = Math.max(8, Math.floor(measurement.fontSize * ratio * 0.97));
    if (candidate < measurement.fontSize) suggestedFontSize = candidate;
  }
  return {
    ...measurement,
    availableWidth: measurement.width,
    availableHeight,
    overflowsHeight,
    overflowsWidth,
    ...(suggestedFontSize ? { suggestedFontSize } : {}),
  };
}

// ---------- HTML scanning helpers ----------

type ScannedTextNode = {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  attrs: string;
  styleInline: string;
};

const TEXT_BEARING_TAGS = new Set([
  'h1','h2','h3','h4','h5','h6','p','span','div','section','article',
  'li','blockquote','figcaption','strong','em','b','i','u','small','mark','code','pre','q','cite','a','dt','dd','caption','summary',
]);

const BLOCK_VOID_TAGS = new Set(['script','style','svg','canvas','iframe','video','audio','img','source','track','meta','link','br','hr','input','select','textarea','option']);

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function getAttr(attrs: string, name: string): string | null {
  const exact = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(attrs);
  if (exact) return exact[2] ?? '';
  return null;
}
function parseClasses(value: string | null): string[] {
  return String(value || '').split(/\s+/).filter(Boolean);
}
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function findMatchingClose(source: string, tag: string, openEndIdx: number): number {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  openRe.lastIndex = openEndIdx;
  closeRe.lastIndex = openEndIdx;
  let depth = 1;
  while (depth > 0) {
    const close = closeRe.exec(source);
    if (!close) return -1;
    let nextOpen = openRe.exec(source);
    while (nextOpen && nextOpen.index < close.index) {
      // Self-closing or void check is unnecessary for text-bearing tags.
      depth += 1;
      nextOpen = openRe.exec(source);
    }
    depth -= 1;
    if (depth === 0) return close.index;
  }
  return -1;
}

export function collectTextNodesFromHtml(html: string): ScannedTextNode[] {
  const source = String(html || '');
  const nodes: ScannedTextNode[] = [];
  const counters = new Map<string, number>();
  const openTagRe = /<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = openTagRe.exec(source)) !== null) {
    const tag = String(m[1] || '').toLowerCase();
    const attrs = String(m[2] || '');
    if (BLOCK_VOID_TAGS.has(tag)) continue;
    if (!TEXT_BEARING_TAGS.has(tag)) continue;
    if (attrs.trimEnd().endsWith('/')) continue;
    const openEnd = openTagRe.lastIndex;
    const closeIdx = findMatchingClose(source, tag, openEnd);
    if (closeIdx < 0) continue;
    const inner = source.slice(openEnd, closeIdx);
    // Only treat as a text node if no nested block-level text-bearing tag is inside.
    if (/<(?:h[1-6]|p|li|blockquote|figcaption|section|article|div)\b/i.test(inner)) continue;
    const text = stripTags(inner);
    if (!text) continue;
    const id = getAttr(attrs, 'id');
    const classes = parseClasses(getAttr(attrs, 'class'));
    const c = (counters.get(tag) || 0) + 1;
    counters.set(tag, c);
    nodes.push({
      selector: id ? `#${id}` : (classes[0] ? `${tag}.${classes[0]}` : `${tag}:nth-of-type(${c})`),
      tag,
      id,
      classes,
      text,
      attrs,
      styleInline: getAttr(attrs, 'style') || '',
    });
  }
  return nodes;
}

const STYLE_NUM_RE = (prop: string) => new RegExp(`(?:^|;)\\s*${escapeRegExp(prop)}\\s*:\\s*([0-9]*\\.?[0-9]+)\\s*(px|rem|em|%)?`, 'i');
function readStyleNumber(style: string, prop: string): { value: number; unit: string } | null {
  const m = STYLE_NUM_RE(prop).exec(style || '');
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (m[2] || 'px').toLowerCase() };
}
function readStyleString(style: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${escapeRegExp(prop)}\\s*:\\s*([^;]+)`, 'i');
  const m = re.exec(style || '');
  return m ? String(m[1] || '').trim() : null;
}

function pxFromStyleNumber(num: { value: number; unit: string } | null, base = 16, parentPx = 0): number | null {
  if (!num) return null;
  if (num.unit === 'px') return num.value;
  if (num.unit === 'rem' || num.unit === 'em') return num.value * base;
  if (num.unit === '%' && parentPx > 0) return (num.value / 100) * parentPx;
  return null;
}

export type HtmlTextFitFinding = {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  fontSize: number;
  width: number;
  measuredHeight: number;
  availableHeight: number | null;
  lineCount: number;
  overflowsHeight: boolean;
  overflowsWidth: boolean;
  suggestedFontSize?: number;
};

export type HtmlTextFitReport = {
  ok: boolean;
  stage: { width: number | null; height: number | null };
  totalNodes: number;
  measuredNodes: number;
  overflowCount: number;
  findings: HtmlTextFitFinding[];
};

function inferStageDims(html: string): { width: number | null; height: number | null } {
  const stageMatch = /<(?:main|div|section)[^>]*\bdata-(?:composition-id|width|height)\b[^>]*>/i.exec(html);
  if (!stageMatch) return { width: null, height: null };
  const tag = stageMatch[0];
  const w = Number((/data-width\s*=\s*"(\d+)"/i.exec(tag) || [])[1]) || null;
  const h = Number((/data-height\s*=\s*"(\d+)"/i.exec(tag) || [])[1]) || null;
  return { width: w, height: h };
}

export function reportHtmlTextFit(html: string, opts: { stageWidth?: number; stageHeight?: number } = {}): HtmlTextFitReport {
  const source = String(html || '');
  const stageInferred = inferStageDims(source);
  const stage = {
    width: clampNumber(opts.stageWidth, 1, stageInferred.width || 1080),
    height: clampNumber(opts.stageHeight, 1, stageInferred.height || 1920),
  };
  const nodes = collectTextNodesFromHtml(source);
  const findings: HtmlTextFitFinding[] = [];
  for (const node of nodes) {
    const style = node.styleInline || '';
    const fontSizeStyle = pxFromStyleNumber(readStyleNumber(style, 'font-size'), 16, 0) ?? 24;
    const widthStyle = pxFromStyleNumber(readStyleNumber(style, 'width'), 16, stage.width)
      ?? pxFromStyleNumber(readStyleNumber(style, 'max-width'), 16, stage.width)
      ?? Math.min(stage.width, 1080);
    const heightStyle = pxFromStyleNumber(readStyleNumber(style, 'height'), 16, stage.height)
      ?? pxFromStyleNumber(readStyleNumber(style, 'max-height'), 16, stage.height);
    const lineHeightRaw = readStyleString(style, 'line-height');
    let lineHeight: number | undefined;
    if (lineHeightRaw) {
      const num = Number(String(lineHeightRaw).replace('px', '').replace('em', ''));
      if (Number.isFinite(num)) lineHeight = num;
    }
    const fontFamily = readStyleString(style, 'font-family') || undefined;
    const fontWeightStr = readStyleString(style, 'font-weight') || '';
    const fontWeight = Number(fontWeightStr) || (/(bold|black|heavy)/i.test(fontWeightStr) ? 700 : 400);
    const fontStyle = readStyleString(style, 'font-style') || undefined;
    const fit = checkTextFit(node.text, {
      width: widthStyle,
      maxHeight: heightStyle ?? undefined,
      fontSize: fontSizeStyle,
      fontFamily,
      fontWeight,
      fontStyle,
      lineHeight,
    });
    findings.push({
      selector: node.selector,
      tag: node.tag,
      id: node.id,
      classes: node.classes,
      text: node.text.length > 240 ? `${node.text.slice(0, 237)}...` : node.text,
      fontSize: fit.fontSize,
      width: fit.availableWidth,
      measuredHeight: fit.height,
      availableHeight: fit.availableHeight,
      lineCount: fit.lineCount,
      overflowsHeight: fit.overflowsHeight,
      overflowsWidth: fit.overflowsWidth,
      ...(fit.suggestedFontSize ? { suggestedFontSize: fit.suggestedFontSize } : {}),
    });
  }
  const overflowCount = findings.filter((f) => f.overflowsHeight || f.overflowsWidth).length;
  return {
    ok: overflowCount === 0,
    stage: { width: stage.width, height: stage.height },
    totalNodes: nodes.length,
    measuredNodes: findings.length,
    overflowCount,
    findings,
  };
}
