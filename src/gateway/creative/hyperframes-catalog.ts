import https from 'https';
import path from 'path';
import {
  type CreativeStorageLike,
  saveCustomHtmlMotionBlock,
  saveCustomHtmlMotionTemplate,
  sanitizeCreativeRegistryId,
} from './custom-registries';
import {
  escapeInlineScriptText,
  getHyperframesTimelineCompatScript,
  getHyperframesRuntimeScript,
  getInlineGsapScript,
  normalizeForHyperframes,
} from './hyperframes-bridge';
import {
  type CreativeAssetStorage,
  type CreativeAssetRecord,
} from './assets';
import {
  ingestHyperframesAssets,
  type HyperframesAssetIngestResult,
} from './hyperframes-asset-ingest';

export type HyperframesRegistrySection = 'blocks' | 'components';
export type HyperframesImportKind = 'template' | 'block';

export type HyperframesCatalogItem = {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  registrySection: HyperframesRegistrySection;
  importKind: HyperframesImportKind;
  tags: string[];
};

type HyperframesRegistryFile = {
  path: string;
  target: string;
  type: string;
};

type HyperframesRegistryItem = {
  name: string;
  type: string;
  title?: string;
  description?: string;
  tags?: string[];
  dimensions?: {
    width?: number;
    height?: number;
  };
  duration?: number;
  files?: HyperframesRegistryFile[];
};

export type ImportedHyperframesAsset = {
  id: string;
  source: string;
  type: 'image' | 'video' | 'audio' | 'font' | 'asset';
  label: string;
};

export type HyperframesImportResult = {
  item: HyperframesCatalogItem;
  registry: HyperframesRegistryItem;
  importedAs: HyperframesImportKind;
  template?: any;
  block?: any;
  assets: ImportedHyperframesAsset[];
  sourceFile: string;
  warnings: string[];
};

const HYPERFRAMES_RAW_BASE = 'https://raw.githubusercontent.com/heygen-com/hyperframes/main';
const HYPERFRAMES_DOCS_BASE = 'https://hyperframes.mintlify.app';

const CATALOG_LINES = `
- [App Showcase](https://hyperframes.mintlify.app/catalog/blocks/app-showcase.md): Fitness app product showcase with three floating smartphone screens
- [Apple Money Count](https://hyperframes.mintlify.app/catalog/blocks/apple-money-count.md): Apple-style finance counter that counts from $0 to $10,000, flashes green, and bursts money icons with sound.
- [Blue Sweater Intro Video](https://hyperframes.mintlify.app/catalog/blocks/blue-sweater-intro-video.md): Warm AI creator intro sequence that resolves into an X follow card for @_blue_sweater_.
- [Chromatic Radial Split](https://hyperframes.mintlify.app/catalog/blocks/chromatic-radial-split.md): Shader transition with chromatic aberration radial split
- [Cinematic Zoom](https://hyperframes.mintlify.app/catalog/blocks/cinematic-zoom.md): Shader transition with dramatic zoom blur
- [Cross Warp Morph](https://hyperframes.mintlify.app/catalog/blocks/cross-warp-morph.md): Shader transition with cross-warped morphing
- [Data Chart](https://hyperframes.mintlify.app/catalog/blocks/data-chart.md): Animated bar + line chart with staggered reveal, NYT-style typography, and value labels
- [Domain Warp Dissolve](https://hyperframes.mintlify.app/catalog/blocks/domain-warp-dissolve.md): Shader transition with fractal noise domain warping
- [Flash Through White](https://hyperframes.mintlify.app/catalog/blocks/flash-through-white.md): Shader transition with white flash crossfade
- [Flowchart](https://hyperframes.mintlify.app/catalog/blocks/flowchart.md): Animated decision tree with SVG connectors, sticky-note nodes, cursor interaction, and typing correction
- [Glitch](https://hyperframes.mintlify.app/catalog/blocks/glitch.md): Shader transition with digital glitch artifacts
- [Gravitational Lens](https://hyperframes.mintlify.app/catalog/blocks/gravitational-lens.md): Shader transition with gravitational lensing distortion
- [Instagram Follow](https://hyperframes.mintlify.app/catalog/blocks/instagram-follow.md): Animated Instagram follow overlay with profile card and follow button
- [Light Leak](https://hyperframes.mintlify.app/catalog/blocks/light-leak.md): Shader transition with cinematic light leak overlay
- [Logo Outro](https://hyperframes.mintlify.app/catalog/blocks/logo-outro.md): Cinematic logo reveal with piece-by-piece assembly, glow bloom, tagline fade-in, and URL pill
- [macOS Notification](https://hyperframes.mintlify.app/catalog/blocks/macos-notification.md): Animated macOS-style notification banner with app icon and message
- [North Korea Locked Down](https://hyperframes.mintlify.app/catalog/blocks/north-korea-locked-down.md): Realistic map zoom into North Korea with a red scribble circle, locked-down pop-up label, and reddish editorial wash.
- [NYC Paris Flight](https://hyperframes.mintlify.app/catalog/blocks/nyc-paris-flight.md): Apple-style realistic map animation with a plane flying from New York to Paris, marker circle, landing pop, and sound effects.
- [Reddit Post Card](https://hyperframes.mintlify.app/catalog/blocks/reddit-post.md): Animated Reddit post card overlay with upvotes and comments
- [Ridged Burn](https://hyperframes.mintlify.app/catalog/blocks/ridged-burn.md): Shader transition with ridged turbulence burn effect
- [Ripple Waves](https://hyperframes.mintlify.app/catalog/blocks/ripple-waves.md): Shader transition with concentric ripple wave distortion
- [SDF Iris](https://hyperframes.mintlify.app/catalog/blocks/sdf-iris.md): Shader transition with signed distance field iris reveal
- [Spotify Now Playing](https://hyperframes.mintlify.app/catalog/blocks/spotify-card.md): Animated Spotify now-playing card with album art and progress bar
- [Swirl Vortex](https://hyperframes.mintlify.app/catalog/blocks/swirl-vortex.md): Shader transition with swirling vortex distortion
- [Thermal Distortion](https://hyperframes.mintlify.app/catalog/blocks/thermal-distortion.md): Shader transition with heat haze thermal distortion
- [TikTok Follow](https://hyperframes.mintlify.app/catalog/blocks/tiktok-follow.md): Animated TikTok follow overlay with profile card and follow button
- [3D Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-3d.md): Showcase of 3D perspective flip and rotate transitions
- [Blur Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-blur.md): Showcase of blur-based transitions between scenes
- [Cover Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-cover.md): Showcase of cover/uncover slide transitions
- [Destruction Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-destruction.md): Showcase of destructive break-apart transitions
- [Dissolve Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-dissolve.md): Showcase of dissolve and fade transitions
- [Distortion Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-distortion.md): Showcase of warp and distortion transitions
- [Grid Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-grid.md): Showcase of grid-based tile transitions
- [Light Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-light.md): Showcase of light-based glow and flash transitions
- [Mechanical Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-mechanical.md): Showcase of mechanical shutter and iris transitions
- [Other Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-other.md): Showcase of miscellaneous creative transitions
- [Push Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-push.md): Showcase of push and slide transitions
- [Radial Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-radial.md): Showcase of radial wipe and reveal transitions
- [Scale Transitions](https://hyperframes.mintlify.app/catalog/blocks/transitions-scale.md): Showcase of scale and zoom transitions
- [3D UI Reveal](https://hyperframes.mintlify.app/catalog/blocks/ui-3d-reveal.md): Perspective 3D reveal animation for UI elements
- [VPN YouTube Spot](https://hyperframes.mintlify.app/catalog/blocks/vpn-youtube-spot.md): Snappy Apple-style YouTube insert showing a phone finding and installing a friendly VPN app with sound effects.
- [Whip Pan](https://hyperframes.mintlify.app/catalog/blocks/whip-pan.md): Shader transition simulating a fast camera whip pan
- [X Post Card](https://hyperframes.mintlify.app/catalog/blocks/x-post.md): Animated X/Twitter post card overlay with engagement metrics
- [YouTube Lower Third](https://hyperframes.mintlify.app/catalog/blocks/yt-lower-third.md): Animated YouTube subscribe lower third with avatar and channel info
- [Grain Overlay](https://hyperframes.mintlify.app/catalog/components/grain-overlay.md): Animated film grain texture overlay using CSS keyframes - adds warmth and analog character to any composition
- [Grid Pixelate Wipe](https://hyperframes.mintlify.app/catalog/components/grid-pixelate-wipe.md): Transition effect where the screen dissolves into a grid of squares that fade out with staggered timing - use between scenes
- [Shimmer Sweep](https://hyperframes.mintlify.app/catalog/components/shimmer-sweep.md): Animated light sweep across text or elements using a CSS gradient mask - ideal for AI accents and premium reveals
`;

function httpGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirected = new URL(res.headers.location, url).toString();
        res.resume();
        httpGetText(redirected).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`GET ${url} failed with status ${res.statusCode || 'unknown'}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function inferTags(section: HyperframesRegistrySection, description: string): string[] {
  const interesting = new Set([
    'social', 'overlay', 'shader', 'transition', 'transitions', 'chart', 'data', 'map',
    'follow', 'youtube', 'instagram', 'tiktok', 'reddit', 'spotify', 'macos', 'logo',
    'outro', 'grain', 'texture', 'shimmer', 'wipe', 'ui', '3d', 'app', 'showcase',
    'flight', 'vpn', 'notification', 'flowchart', 'effect', 'cinematic',
  ]);
  const base = section === 'blocks' ? 'block' : 'component';
  const tags = String(description || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((word) => interesting.has(word));
  return [...new Set([base, ...tags])];
}

function parseCatalogLines(source: string): HyperframesCatalogItem[] {
  const items: HyperframesCatalogItem[] = [];
  const pattern = /^- \[([^\]]+)\]\((https:\/\/hyperframes\.mintlify\.app\/catalog\/(blocks|components)\/([^)]+?)\.md)\):\s*(.*)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const registrySection = match[3] as HyperframesRegistrySection;
    items.push({
      id: match[4],
      name: match[1],
      description: match[5].trim(),
      docsUrl: match[2],
      registrySection,
      importKind: registrySection === 'components' ? 'block' : 'template',
      tags: inferTags(registrySection, match[5]),
    });
  }
  return items;
}

export const BUNDLED_HYPERFRAMES_CATALOG: HyperframesCatalogItem[] = parseCatalogLines(CATALOG_LINES);

function normalizeQuery(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

export function listHyperframesCatalogItems(filters: { query?: string; kind?: string; tag?: string } = {}): HyperframesCatalogItem[] {
  const query = normalizeQuery(filters.query);
  const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
  const kind = String(filters.kind || '').trim().toLowerCase();
  const tag = String(filters.tag || '').trim().toLowerCase();
  return BUNDLED_HYPERFRAMES_CATALOG.filter((item) => {
    if (kind && item.importKind !== kind && item.registrySection !== kind && item.registrySection.replace(/s$/, '') !== kind) return false;
    if (tag && !item.tags.includes(tag)) return false;
    if (!query) return true;
    const haystack = normalizeQuery([item.id, item.name, item.description, item.registrySection, item.importKind, ...item.tags].join(' '));
    return tokens.every((token) => haystack.includes(token));
  });
}

export function getHyperframesCatalogItem(id: string): HyperframesCatalogItem | null {
  const normalized = sanitizeCreativeRegistryId(id, '');
  if (!normalized) return null;
  return BUNDLED_HYPERFRAMES_CATALOG.find((item) => item.id === normalized || `hyperframes-${item.id}` === normalized) || null;
}

async function fetchLiveCatalog(): Promise<HyperframesCatalogItem[]> {
  const source = await httpGetText(`${HYPERFRAMES_DOCS_BASE}/llms.txt`);
  const parsed = parseCatalogLines(source);
  return parsed.length ? parsed : BUNDLED_HYPERFRAMES_CATALOG;
}

function registryItemUrl(item: HyperframesCatalogItem): string {
  return `${HYPERFRAMES_RAW_BASE}/registry/${item.registrySection}/${item.id}/registry-item.json`;
}

function registryFileUrl(item: HyperframesCatalogItem, filePath: string): string {
  return `${HYPERFRAMES_RAW_BASE}/registry/${item.registrySection}/${item.id}/${filePath.replace(/\\/g, '/')}`;
}

async function fetchRegistryItem(item: HyperframesCatalogItem): Promise<HyperframesRegistryItem> {
  const raw = await httpGetText(registryItemUrl(item));
  const parsed = JSON.parse(raw) as HyperframesRegistryItem;
  return {
    ...parsed,
    name: parsed.name || item.id,
    title: parsed.title || item.name,
    description: parsed.description || item.description,
    tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags : item.tags,
    files: Array.isArray(parsed.files) ? parsed.files : [],
  };
}

function htmlFileFor(registry: HyperframesRegistryItem): HyperframesRegistryFile | null {
  const files = Array.isArray(registry.files) ? registry.files : [];
  return files.find((file) => /\.html?$/i.test(file.path) && /composition|snippet/i.test(file.type || ''))
    || files.find((file) => /\.html?$/i.test(file.path))
    || null;
}

function assetTypeFor(filePath: string): ImportedHyperframesAsset['type'] {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(ext)) return 'audio';
  if (['.woff', '.woff2', '.ttf', '.otf'].includes(ext)) return 'font';
  return 'asset';
}

function assetIdFor(filePath: string): string {
  const parsed = path.parse(filePath.replace(/\\/g, '/'));
  return sanitizeCreativeRegistryId(parsed.name || parsed.dir || 'asset', 'asset');
}

function collectAssets(item: HyperframesCatalogItem, registry: HyperframesRegistryItem): ImportedHyperframesAsset[] {
  const files = Array.isArray(registry.files) ? registry.files : [];
  return files
    .filter((file) => /asset/i.test(file.type || '') || !/\.html?$/i.test(file.path))
    .map((file) => ({
      id: assetIdFor(file.target || file.path),
      source: registryFileUrl(item, file.path),
      type: assetTypeFor(file.path),
      label: path.basename(file.target || file.path),
    }));
}

function toSeconds(value: any, fallback = 6): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function inferBlockCategory(item: HyperframesCatalogItem, registry: HyperframesRegistryItem): string {
  const haystack = [item.id, item.description, ...(registry.tags || [])].join(' ').toLowerCase();
  if (/caption|lower-third|subtitle/.test(haystack)) return 'captions';
  if (/chart|data|graph/.test(haystack)) return 'charts';
  if (/transition|wipe|shader|dissolve|warp|zoom|glitch|lens/.test(haystack)) return 'transitions';
  if (/app|phone|product|ui|showcase/.test(haystack)) return 'product';
  if (/media|spotify|youtube|instagram|tiktok|reddit|x-post|social|overlay|notification/.test(haystack)) return 'media';
  if (/logo|outro|cta|follow/.test(haystack)) return 'cta';
  return 'utility';
}

function normalizeHyperframesTimes(html: string): string {
  return html.replace(
    /\b(data-(?:start|duration|end|media-start|media-offset|trim-start|offset|from))=(["'])(-?\d+(?:\.\d+)?)(ms|s)?\2/gi,
    (_match, attr, quote, value, unit) => {
      const numeric = Number(value);
      const seconds = String(unit || '').toLowerCase() === 'ms' ? numeric / 1000 : numeric;
      return `${attr}=${quote}${Number(seconds.toFixed(6))}${quote}`;
    },
  );
}

function stripExternalRuntimeDependencies(html: string, warnings: string[]): string {
  let next = html;
  if (/<script\b[^>]*\bsrc=/i.test(next)) {
    warnings.push('Removed external script tags and injected the Prometheus HyperFrames runtime shim.');
    next = next.replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>/gi, '');
  }
  if (/<link\b[^>]*href=["']https?:\/\/fonts\./i.test(next)) {
    warnings.push('Removed external font links; Prometheus uses local/system font fallbacks during export.');
    next = next.replace(/<link\b[^>]*href=["']https?:\/\/fonts\.[^"']+["'][^>]*\/?>/gi, '');
    next = next.replace(/<link\b[^>]*rel=["']preconnect["'][^>]*\/?>/gi, '');
  }
  return next;
}

function injectInlineGsap(html: string, warnings: string[]): string {
  if (!/\bgsap\s*\.|window\.gsap\b|\.timeline\(/.test(html)) return html;
  if (/<script\b[^>]*data-hyperframes-gsap[^>]*>/i.test(html)) return html;
  const gsap = getInlineGsapScript();
  if (!gsap) {
    warnings.push('GSAP was referenced but node_modules/gsap/dist/gsap.min.js was not available to inline.');
    return html;
  }
  const inline = `<script data-hyperframes-gsap="inline">\n${escapeInlineScriptText(gsap)}\n</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `${inline}\n</head>`);
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${inline}`);
  return `${inline}\n${html}`;
}

function injectFrameRate(html: string, frameRate: number): string {
  if (/\bdata-frame-rate=/.test(html)) return html;
  return html.replace(/(<[^>]+\bdata-composition-id=["'][^"']+["'][^>]*)(>)/i, `$1 data-frame-rate="${frameRate}"$2`);
}

function rewriteAssetReferences(html: string, assets: ImportedHyperframesAsset[]): string {
  let next = html;
  for (const asset of assets) {
    const escapedNames = [asset.label, `assets/${asset.label}`]
      .filter(Boolean)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    for (const escapedName of escapedNames) {
      next = next.replace(new RegExp(escapedName, 'g'), `{{asset.${asset.id}}}`);
    }
  }
  return next;
}

/**
 * Returns the official @hyperframes/core runtime IIFE wrapped in a script tag.
 * Replaces the hand-rolled GSAP polyfill that previously lived here.
 *
 * The official runtime exposes:
 *   window.__player, window.__playerReady, window.__renderReady, window.__timelines,
 *   window.__HF_PICKER_API (hit-testing for click-to-select),
 * listens for postMessage with source 'hf-parent' for control actions, and
 * cooperates with prometheus-html-motion-seek (we add that bridge below).
 */
function hyperframesRuntimeShim(): string {
  const official = escapeInlineScriptText(getHyperframesRuntimeScript());
  const compat = escapeInlineScriptText(getHyperframesTimelineCompatScript());
  // Prometheus seek bridge: forwards prometheus-html-motion-seek events into
  // the official runtime so existing Prometheus clip wiring keeps working.
  const promBridge = `(function(){
    if (window.__PROM_HF_SEEK_BRIDGE__) return;
    window.__PROM_HF_SEEK_BRIDGE__ = true;
    function seekHandler(event){
      var detail = (event && event.detail) || {};
      var seconds = Number(detail.timeSeconds);
      if (!Number.isFinite(seconds)) seconds = Number(detail.timeMs) / 1000;
      if (!Number.isFinite(seconds)) {
        var ms = Number(window.__PROMETHEUS_HTML_MOTION_TIME_MS__);
        seconds = Number.isFinite(ms) ? ms / 1000 : 0;
      }
      try { window.postMessage({ source: 'hf-parent', action: 'seek', payload: { timeMs: seconds * 1000 } }, '*'); } catch(e){}
      var timelines = window.__timelines || {};
      Object.keys(timelines).forEach(function(key){ var tl = timelines[key]; if (tl && typeof tl.time === 'function') { try { tl.time(seconds, false); } catch(e){} } });
    }
    window.addEventListener('prometheus-html-motion-seek', seekHandler);
  })();`;
  return `<script data-prometheus-hyperframes-runtime="true" data-runtime-source="hyperframes-core">\n${compat}\n${official}\n${promBridge}\n</script>`;
}

// Legacy shim retained as a fallback in case the official runtime fails to
// load. Used only when explicitly requested via importLegacyShim().
function legacyHyperframesShim(): string {
  return `<script data-prometheus-hyperframes-runtime="legacy">
(function(){
  if (window.__PROMETHEUS_HYPERFRAMES_RUNTIME__) return;
  window.__PROMETHEUS_HYPERFRAMES_RUNTIME__ = true;
  function nodes(target){ if(!target) return []; if(typeof target === 'string') return Array.prototype.slice.call(document.querySelectorAll(target)); if(target.length && !target.nodeType) return Array.prototype.slice.call(target); return [target]; }
  function num(v, fallback){ var n=Number(v); return Number.isFinite(n)?n:fallback; }
  function currentTime(){ return num(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__, num(window.__PROMETHEUS_HTML_MOTION_TIME_MS__,0)/1000); }
  function easeLinear(p){ return Math.max(0, Math.min(1, p)); }
  function readState(el){ return el.__promHfState || (el.__promHfState={x:0,y:0,scale:1,rotate:0,opacity:1}); }
  function apply(el, vars){
    var s=readState(el);
    if(vars.x!==undefined) s.x=num(vars.x,s.x);
    if(vars.y!==undefined) s.y=num(vars.y,s.y);
    if(vars.scale!==undefined) s.scale=num(vars.scale,s.scale);
    if(vars.rotation!==undefined) s.rotate=num(vars.rotation,s.rotate);
    if(vars.rotate!==undefined) s.rotate=num(vars.rotate,s.rotate);
    if(vars.opacity!==undefined){ s.opacity=num(vars.opacity,s.opacity); el.style.opacity=String(s.opacity); }
    if(vars.color!==undefined) el.style.color=String(vars.color);
    if(vars.background!==undefined) el.style.background=String(vars.background);
    if(vars.backgroundColor!==undefined) el.style.backgroundColor=String(vars.backgroundColor);
    el.style.transform='translate('+s.x+'px,'+s.y+'px) scale('+s.scale+') rotate('+s.rotate+'deg)';
  }
  function Timeline(){ this.items=[]; this.paused=true; }
  Timeline.prototype.set=function(target, vars, at){ var start=num(at,0); this.items.push({target:target, from:vars, to:vars, start:start, duration:0, called:false}); return this; };
  Timeline.prototype.to=function(target, vars, at){ var start=num(at,0); var duration=Math.max(.001,num(vars.duration,.001)); this.items.push({target:target, to:vars, start:start, duration:duration, called:false}); return this; };
  Timeline.prototype.from=function(target, vars, at){ var start=num(at,0); var duration=Math.max(.001,num(vars.duration,.001)); var to={}; nodes(target).forEach(function(el){ var s=readState(el); to={x:s.x,y:s.y,scale:s.scale,rotate:s.rotate,rotation:s.rotate,opacity:s.opacity,color:el.style.color||window.getComputedStyle(el).color}; }); this.items.push({target:target, from:vars, to:to, start:start, duration:duration, called:false}); return this; };
  Timeline.prototype.fromTo=function(target, fromVars, toVars, at){ var start=num(at,0); var duration=Math.max(.001,num(toVars.duration,.001)); this.items.push({target:target, from:fromVars, to:toVars, start:start, duration:duration, called:false}); return this; };
  Timeline.prototype.time=function(t){ var time=num(t,0); this.items.forEach(function(item){ nodes(item.target).forEach(function(el){
    if(item.from && !item.__fromApplied){ apply(el,item.from); }
    var p=item.duration<=0 ? (time>=item.start?1:0) : easeLinear((time-item.start)/item.duration);
    if(p<=0 && !item.from) return;
    var from=item.from || readState(el);
    var vars={};
    Object.keys(item.to||{}).forEach(function(key){
      if(key==='duration'||key==='ease'||key==='stagger'||key==='onStart'||key==='onUpdate'||key==='onComplete') return;
      var a=Number(from[key]); var b=Number(item.to[key]);
      vars[key]=Number.isFinite(a)&&Number.isFinite(b) ? a+(b-a)*p : (p>=1 ? item.to[key] : from[key]);
    });
    if(p>0 && !item.called && item.to && typeof item.to.onStart==='function'){ item.called=true; try{ item.to.onStart(); }catch(e){} }
    if(p>0 && item.to && typeof item.to.onUpdate==='function'){ try{ item.to.onUpdate(); }catch(e){} }
    if(p>=1 && item.to && typeof item.to.onComplete==='function'){ try{ item.to.onComplete(); }catch(e){} }
    apply(el,vars);
  }); item.__fromApplied=true; }); return this; };
  Timeline.prototype.seek=Timeline.prototype.time;
  window.gsap = window.gsap || {
    set:function(target,vars){ nodes(target).forEach(function(el){ apply(el,vars||{}); }); },
    to:function(target,vars){ nodes(target).forEach(function(el){ apply(el,vars||{}); if(vars&&typeof vars.onStart==='function') vars.onStart(); }); },
    fromTo:function(target,fromVars,toVars){ nodes(target).forEach(function(el){ apply(el,fromVars||{}); apply(el,toVars||{}); }); },
    timeline:function(){ return new Timeline(); }
  };
  function seek(event){
    var detail=event&&event.detail||{};
    var seconds=Number(detail.timeSeconds);
    if(!Number.isFinite(seconds)) seconds=Number(detail.timeMs)/1000;
    if(!Number.isFinite(seconds)) seconds=currentTime();
    var timelines=window.__timelines||{};
    Object.keys(timelines).forEach(function(key){ var tl=timelines[key]; if(tl&&typeof tl.time==='function') tl.time(seconds,false); });
  }
  window.addEventListener('prometheus-html-motion-seek', seek);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){ seek(); }); else setTimeout(seek,0);
})();
</script>`;
}

function adaptCompositionHtml(item: HyperframesCatalogItem, registry: HyperframesRegistryItem, html: string, assets: ImportedHyperframesAsset[], warnings: string[]): string {
  const frameRate = 60;
  let next = stripExternalRuntimeDependencies(html, warnings);
  next = rewriteAssetReferences(next, assets);
  next = normalizeHyperframesTimes(next);
  next = injectFrameRate(next, frameRate);
  next = injectInlineGsap(next, warnings);
  if (!/data-prometheus-hyperframes-runtime/.test(next)) {
    next = next.replace(/<\/head>/i, () => `${hyperframesRuntimeShim()}\n</head>`);
  }
  if (!/\bdata-composition-id=/.test(next)) {
    const width = Number(registry.dimensions?.width) || 1080;
    const height = Number(registry.dimensions?.height) || 1920;
    const duration = toSeconds(registry.duration, 6);
    next = `<!doctype html><html><head><meta charset="utf-8">${hyperframesRuntimeShim()}<style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}</style></head><body><main id="stage" data-composition-id="hyperframes-${item.id}" data-width="${width}" data-height="${height}" data-duration="${duration}" data-frame-rate="60">${next}</main></body></html>`;
  }
  return normalizeForHyperframes(next);
}

function adaptSnippetHtml(item: HyperframesCatalogItem, html: string, assets: ImportedHyperframesAsset[], warnings: string[]): string {
  let next = stripExternalRuntimeDependencies(html, warnings);
  next = rewriteAssetReferences(next, assets);
  next = normalizeHyperframesTimes(next);
  if (!/\bdata-role=/.test(next)) {
    next = next.replace(/(<[a-z][^>]*\bid=["'][^"']+["'][^>]*)(>)/i, '$1 data-role="hyperframes-component"$2');
  }
  if (!/\bdata-start=/.test(next)) {
    next = next.replace(/(<[a-z][^>]*\bid=["'][^"']+["'][^>]*)(>)/i, '$1 data-start="0" data-duration="6" data-track-index="10"$2');
  }
  next = injectInlineGsap(next, warnings);
  if (!/data-prometheus-hyperframes-runtime/.test(next) && /window\.gsap|\bgsap\./.test(next)) {
    next = `${hyperframesRuntimeShim()}\n${next}`;
  }
  if (!next.trim()) {
    warnings.push(`HyperFrames component ${item.id} did not contain HTML after adaptation.`);
  }
  return next;
}

export async function importHyperframesComponent(storage: CreativeStorageLike, componentId: string): Promise<HyperframesImportResult> {
  const item = getHyperframesCatalogItem(componentId);
  if (!item) throw new Error(`Unknown HyperFrames component: ${componentId}`);
  const registry = await fetchRegistryItem(item);
  const htmlFile = htmlFileFor(registry);
  if (!htmlFile) throw new Error(`HyperFrames component ${item.id} has no HTML file in its registry item.`);
  const rawHtml = await httpGetText(registryFileUrl(item, htmlFile.path));
  const assets = collectAssets(item, registry);
  const warnings: string[] = [];
  const importedAs: HyperframesImportKind = /snippet/i.test(htmlFile.type || '') || item.importKind === 'block' ? 'block' : 'template';
  const width = Number(registry.dimensions?.width) || 1080;
  const height = Number(registry.dimensions?.height) || 1920;
  const durationSec = toSeconds(registry.duration, importedAs === 'block' ? 6 : 8);

  if (importedAs === 'block') {
    const html = adaptSnippetHtml(item, rawHtml, assets, warnings);
    const block = saveCustomHtmlMotionBlock(storage, {
      id: `hyperframes-${item.id}`,
      packId: `hyperframes-${item.registrySection}`,
      name: registry.title || item.name,
      description: registry.description || item.description,
      category: inferBlockCategory(item, registry),
      tags: [...new Set(['hyperframes', ...(registry.tags || item.tags)])],
      bestFor: `Reusable HyperFrames catalog component: ${registry.description || item.description}`,
      slots: [
        { id: 'start', label: 'Start seconds', kind: 'number', default: 0 },
        { id: 'duration', label: 'Duration seconds', kind: 'number', default: durationSec },
      ],
      outputContract: {
        htmlRegion: true,
        usesTimingAttributes: true,
        usesPrometheusSeekEvent: /prometheus-html-motion-seek|__PROMETHEUS_HTML_MOTION/.test(html),
        assetPlaceholders: assets.map((asset) => asset.id),
      },
      html,
      css: '',
      js: '',
    });
    return { item, registry, importedAs, block, assets, sourceFile: htmlFile.path, warnings };
  }

  const html = adaptCompositionHtml(item, registry, rawHtml, assets, warnings);
  const template = saveCustomHtmlMotionTemplate(storage, {
    id: `hyperframes-${item.id}`,
    name: registry.title || item.name,
    description: registry.description || item.description,
    bestFor: `Using the HyperFrames catalog component "${registry.title || item.name}" in Prometheus Creative Video Mode.`,
    width,
    height,
    durationMs: Math.round(durationSec * 1000),
    frameRate: 60,
    optionalInputs: assets.map((asset) => ({
      id: asset.id,
      label: `${asset.label} asset`,
      description: `Optional replacement for HyperFrames asset ${asset.label}.`,
      example: `{{asset.${asset.id}}}`,
    })),
    defaultInputs: {},
    html,
  });
  return { item, registry, importedAs, template, assets, sourceFile: htmlFile.path, warnings };
}

export async function importHyperframesCatalog(storage: CreativeStorageLike, options: { ids?: string[]; query?: string; limit?: number; live?: boolean } = {}) {
  const catalog = options.live ? await fetchLiveCatalog() : BUNDLED_HYPERFRAMES_CATALOG;
  const explicitIds = (Array.isArray(options.ids) ? options.ids : [])
    .map((id) => sanitizeCreativeRegistryId(id, ''))
    .filter(Boolean);
  const query = normalizeQuery(options.query);
  const selected = catalog.filter((item) => {
    if (explicitIds.length) return explicitIds.includes(item.id) || explicitIds.includes(`hyperframes-${item.id}`);
    if (!query) return true;
    const haystack = normalizeQuery([item.id, item.name, item.description, ...item.tags].join(' '));
    return query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token));
  }).slice(0, Math.max(1, Math.min(200, Number(options.limit) || catalog.length)));

  const imported: HyperframesImportResult[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const item of selected) {
    try {
      imported.push(await importHyperframesComponent(storage, item.id));
    } catch (err: any) {
      failed.push({ id: item.id, error: err?.message || String(err) });
    }
  }
  return {
    catalogCount: catalog.length,
    selectedCount: selected.length,
    imported,
    failed,
  };
}

/**
 * Ingest-aware variant of importHyperframesComponent. Fetches each remote
 * asset URL, hashes the bytes, and registers it in the creative asset index
 * (which dedupes by sha-256 — re-imports are free). Returns the import
 * result plus the ingestion summary.
 *
 * Use this from API/Catalog endpoints that want assets persisted under the
 * workspace. The plain importHyperframesComponent leaves assets as remote
 * URLs and is fine for ephemeral previews or when the UI handles ingest.
 */
export async function importHyperframesComponentWithIngest(
  storage: CreativeStorageLike,
  assetStorage: CreativeAssetStorage,
  componentId: string,
): Promise<HyperframesImportResult & {
  ingest: {
    results: HyperframesAssetIngestResult[];
    failed: Array<{ placeholderId: string; error: string }>;
  };
}> {
  const imported = await importHyperframesComponent(storage, componentId);
  const ingest = await ingestHyperframesAssets(
    assetStorage,
    imported.assets.map((asset) => ({
      placeholderId: asset.id,
      remoteUrl: asset.source,
      fileName: asset.label,
    })),
  );
  return { ...imported, ingest };
}

/**
 * Ingest-aware variant of importHyperframesCatalog. Same dedupe semantics.
 */
export async function importHyperframesCatalogWithIngest(
  storage: CreativeStorageLike,
  assetStorage: CreativeAssetStorage,
  options: { ids?: string[]; query?: string; limit?: number; live?: boolean } = {},
) {
  const result = await importHyperframesCatalog(storage, options);
  const ingestResults: HyperframesAssetIngestResult[] = [];
  const ingestFailed: Array<{ placeholderId: string; error: string }> = [];
  for (const item of result.imported) {
    const ingest = await ingestHyperframesAssets(
      assetStorage,
      item.assets.map((asset) => ({
        placeholderId: asset.id,
        remoteUrl: asset.source,
        fileName: asset.label,
      })),
    );
    ingestResults.push(...ingest.results);
    ingestFailed.push(...ingest.failed);
  }
  return {
    ...result,
    ingest: { results: ingestResults, failed: ingestFailed },
  };
}
