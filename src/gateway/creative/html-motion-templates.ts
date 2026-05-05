// HTML motion video templates for Prometheus Creative Video mode.
// Each template renders a complete, self-contained HTML document with inline
// CSS keyframe animations. No external network dependencies.

import { renderAsciiSourceCanvasParts } from './ascii-html-motion';
import {
  type CreativeStorageLike,
  getCustomHtmlMotionTemplate,
  listCustomHtmlMotionTemplates,
  renderTemplatePlaceholders,
} from './custom-registries';

export type HtmlMotionTemplateInputSpec = {
  id: string;
  label: string;
  description?: string;
  example?: string;
};

export type HtmlMotionTemplateInput = Record<string, string | undefined>;

export type HtmlMotionParameter = {
  id: string;
  label: string;
  type: 'range' | 'color' | 'select' | 'boolean' | 'text' | 'number';
  defaultValue: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  target: {
    lane: 'html-motion';
    path: string;
  };
  description?: string;
};

export type HtmlMotionTemplate = {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultDurationMs: number;
  defaultFrameRate: number;
  requiredInputs: HtmlMotionTemplateInputSpec[];
  optionalInputs: HtmlMotionTemplateInputSpec[];
  parameters?: HtmlMotionParameter[];
  renderHtml(input: HtmlMotionTemplateInput): string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pick(input: HtmlMotionTemplateInput, key: string, fallback = ''): string {
  const raw = input?.[key];
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim();
  return trimmed || fallback;
}

function pickNumber(input: HtmlMotionTemplateInput, key: string, fallback: number): number {
  const numeric = Number(input?.[key]);
  return Number.isFinite(numeric) ? numeric : fallback;
}

// Base shell: vertical safe area, system fonts, hidden overflow.
function baseCss(bg: string): string {
  return `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 1080px; height: 1920px; overflow: hidden; }
    body { font-family: 'Manrope', 'Inter', -apple-system, 'Segoe UI', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    .stage {
      position: relative;
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      color: #fff;
      background: ${bg};
    }
    .stage::before {
      content: '';
      position: absolute; inset: -10%;
      background: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.08), transparent 55%),
                  radial-gradient(circle at 80% 80%, rgba(255,255,255,0.05), transparent 50%);
      pointer-events: none;
    }
    .safe { position: absolute; left: 64px; right: 64px; }
    .grain {
      position: absolute; inset: 0; pointer-events: none; opacity: 0.08; mix-blend-mode: overlay;
      background-image:
        repeating-linear-gradient(0deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 3px),
        repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 3px);
    }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    @keyframes scalePop { 0% { transform: scale(0.85); opacity: 0; } 60% { transform: scale(1.04); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes barFill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @keyframes shimmer { 0% { background-position: -1080px 0; } 100% { background-position: 1080px 0; } }
    @keyframes floatY { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
    @keyframes ctaPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.35); } 50% { box-shadow: 0 0 0 22px rgba(255,255,255,0); } }
    @keyframes slideInLeft { from { transform: translateX(-80px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideInRight { from { transform: translateX(80px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `;
}

// ---------------- TEMPLATE 1: startup-product-promo ----------------
const startupProductPromo: HtmlMotionTemplate = {
  id: 'startup-product-promo',
  name: 'Startup Product Promo',
  description: 'Hook + 3 feature chips + CTA. Clean dark gradient, product mark, staggered entrance.',
  bestFor: 'Launching a new SaaS/startup product on social',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 8000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'brand', label: 'Brand or product name', example: 'Prometheus' },
    { id: 'headline', label: 'Headline (8-14 words)', example: 'Ship polished motion videos in seconds' },
    { id: 'cta', label: 'Call-to-action text', example: 'Try it free today' },
  ],
  optionalInputs: [
    { id: 'eyebrow', label: 'Eyebrow / category label', example: 'NEW' },
    { id: 'feature1', label: 'Feature 1', example: 'AI-driven motion design' },
    { id: 'feature2', label: 'Feature 2', example: 'Production-ready in minutes' },
    { id: 'feature3', label: 'Feature 3', example: 'On-brand every time' },
    { id: 'accent', label: 'Accent color', example: '#7c5cff' },
  ],
  renderHtml(input) {
    const brand = escapeHtml(pick(input, 'brand', 'Prometheus'));
    const eyebrow = escapeHtml(pick(input, 'eyebrow', 'NEW'));
    const headline = escapeHtml(pick(input, 'headline', 'Ship polished motion videos in seconds'));
    const cta = escapeHtml(pick(input, 'cta', 'Try it free'));
    const f1 = escapeHtml(pick(input, 'feature1', 'AI-driven motion'));
    const f2 = escapeHtml(pick(input, 'feature2', 'Production-ready'));
    const f3 = escapeHtml(pick(input, 'feature3', 'On-brand always'));
    const accent = escapeHtml(pick(input, 'accent', '#7c5cff'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('linear-gradient(160deg, #0a0a1f 0%, #14143a 55%, #1d0f3d 100%)')}
      .accent-blob { position: absolute; width: 720px; height: 720px; border-radius: 50%;
        background: radial-gradient(circle, ${accent} 0%, transparent 65%); filter: blur(40px);
        top: -180px; right: -200px; opacity: 0.7; animation: floatY 6s ease-in-out infinite; }
      .accent-blob.b2 { top: auto; bottom: -260px; left: -240px; right: auto; opacity: 0.55;
        background: radial-gradient(circle, #2dd4bf 0%, transparent 65%); animation-delay: -2s; }
      .brand-row { top: 120px; display: flex; align-items: center; gap: 18px;
        animation: fadeIn 600ms ease-out 100ms both; }
      .brand-mark { width: 56px; height: 56px; border-radius: 16px; background: ${accent};
        display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 28px; color: #fff;
        box-shadow: 0 12px 40px ${accent}66; }
      .brand-name { font-size: 32px; font-weight: 700; letter-spacing: 0.5px; }
      .eyebrow { top: 240px; font-size: 28px; font-weight: 700; color: ${accent}; letter-spacing: 4px;
        animation: fadeUp 700ms ease-out 400ms both; }
      .headline { top: 320px; font-size: 96px; font-weight: 800; line-height: 1.05; letter-spacing: -1.5px;
        animation: fadeUp 900ms ease-out 700ms both; }
      .features { top: 940px; display: flex; flex-direction: column; gap: 24px; }
      .chip { display: flex; align-items: center; gap: 22px; padding: 26px 32px;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
        border-radius: 22px; backdrop-filter: blur(20px);
        font-size: 42px; font-weight: 600; }
      .chip .dot { width: 18px; height: 18px; border-radius: 50%; background: ${accent}; flex-shrink: 0;
        box-shadow: 0 0 18px ${accent}; }
      .chip:nth-child(1) { animation: slideInLeft 700ms ease-out 1500ms both; }
      .chip:nth-child(2) { animation: slideInLeft 700ms ease-out 1800ms both; }
      .chip:nth-child(3) { animation: slideInLeft 700ms ease-out 2100ms both; }
      .progress-rail { top: 1380px; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
      .progress-bar { width: 100%; height: 100%; background: linear-gradient(90deg, ${accent}, #2dd4bf);
        transform-origin: left; animation: barFill 5500ms ease-out 1000ms both; }
      .cta { top: 1520px; left: 64px; right: 64px; padding: 40px;
        background: ${accent}; color: #fff; border-radius: 28px; font-size: 52px; font-weight: 800;
        text-align: center; letter-spacing: 0.5px; box-shadow: 0 20px 60px ${accent}80;
        animation: scalePop 700ms ease-out 5500ms both, ctaPulse 2.4s ease-in-out 6200ms infinite; }
      .footer { top: 1730px; text-align: center; font-size: 26px; opacity: 0.6;
        animation: fadeIn 600ms ease-out 6000ms both; }
    </style></head><body>
      <main class="stage" aria-label="Startup product promo">
        <div class="accent-blob"></div>
        <div class="accent-blob b2"></div>
        <div class="grain"></div>
        <div class="safe brand-row"><div class="brand-mark">${brand.charAt(0)}</div><div class="brand-name">${brand}</div></div>
        <div class="safe eyebrow">${eyebrow}</div>
        <div class="safe headline">${headline}</div>
        <div class="safe features">
          <div class="chip"><span class="dot"></span>${f1}</div>
          <div class="chip"><span class="dot"></span>${f2}</div>
          <div class="chip"><span class="dot"></span>${f3}</div>
        </div>
        <div class="safe progress-rail"><div class="progress-bar"></div></div>
        <div class="safe cta">${cta}</div>
        <div class="safe footer">${brand} &middot; learn more</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 2: bold-tiktok-caption ----------------
const boldTiktokCaption: HtmlMotionTemplate = {
  id: 'bold-tiktok-caption',
  name: 'Bold TikTok Caption',
  description: 'Massive caption-style typography with word-by-word punch, bright color blocks, captions in safe area.',
  bestFor: 'TikTok / Reels / Shorts attention hooks',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 7000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'line1', label: 'Hook line 1 (3-5 words)', example: "You're doing it" },
    { id: 'line2', label: 'Hook line 2 (1-3 words)', example: 'WRONG' },
    { id: 'payoff', label: 'Payoff / answer (4-8 words)', example: 'Here is the right way' },
    { id: 'cta', label: 'CTA', example: 'Follow for more' },
  ],
  optionalInputs: [
    { id: 'accent', label: 'Accent color', example: '#facc15' },
    { id: 'handle', label: 'Creator handle', example: '@prometheus' },
  ],
  renderHtml(input) {
    const line1 = escapeHtml(pick(input, 'line1', "You're doing it"));
    const line2 = escapeHtml(pick(input, 'line2', 'WRONG'));
    const payoff = escapeHtml(pick(input, 'payoff', 'Here is the right way'));
    const cta = escapeHtml(pick(input, 'cta', 'Follow for more'));
    const accent = escapeHtml(pick(input, 'accent', '#facc15'));
    const handle = escapeHtml(pick(input, 'handle', '@prometheus'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#0b0b0f')}
      .stage { color: #fff; }
      .bg-flash { position: absolute; inset: 0; background: ${accent}; opacity: 0;
        animation: fadeIn 120ms ease-out 1900ms both, fadeOut 200ms ease-in 2200ms both; }
      .handle { top: 140px; font-size: 36px; font-weight: 700; opacity: 0.7;
        animation: fadeIn 500ms ease-out both; }
      .l1 { top: 540px; font-size: 140px; font-weight: 900; line-height: 0.95; letter-spacing: -3px; text-transform: uppercase;
        animation: fadeUp 500ms ease-out 200ms both; }
      .l2 { top: 740px; font-size: 240px; font-weight: 900; line-height: 0.9; letter-spacing: -6px;
        color: ${accent}; text-shadow: 0 0 40px ${accent}80;
        animation: scalePop 600ms cubic-bezier(0.2, 1.4, 0.4, 1) 1000ms both; }
      .l2-stamp { display: inline-block; padding: 12px 36px; background: #000; transform: rotate(-3deg); }
      .payoff-card { top: 1120px; left: 64px; right: 64px;
        background: #fff; color: #0b0b0f; padding: 56px 48px; border-radius: 32px;
        font-size: 80px; font-weight: 800; line-height: 1.05; letter-spacing: -1px;
        box-shadow: 0 30px 80px rgba(0,0,0,0.5);
        animation: slideInLeft 700ms cubic-bezier(0.2, 1, 0.4, 1) 2400ms both; }
      .payoff-card::before {
        content: ''; position: absolute; top: 24px; left: 24px; right: 24px; height: 8px;
        background: ${accent}; border-radius: 4px;
      }
      .cta { top: 1640px; left: 64px; right: 64px; padding: 36px;
        background: ${accent}; color: #0b0b0f; border-radius: 24px;
        font-size: 56px; font-weight: 900; text-align: center; text-transform: uppercase;
        animation: scalePop 600ms ease-out 4500ms both, ctaPulse 2s ease-in-out 5200ms infinite; }
      .ticker { position: absolute; left: 0; right: 0; bottom: 32px; height: 8px;
        background: linear-gradient(90deg, ${accent}, #fff, ${accent});
        background-size: 1080px 100%; animation: shimmer 2s linear infinite; }
    </style></head><body>
      <main class="stage" aria-label="Bold caption">
        <div class="bg-flash"></div>
        <div class="safe handle">${handle}</div>
        <div class="safe l1">${line1}</div>
        <div class="safe l2"><span class="l2-stamp">${line2}</span></div>
        <div class="payoff-card">${payoff}</div>
        <div class="safe cta">${cta}</div>
        <div class="ticker"></div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 3: saas-feature-launch ----------------
const saasFeatureLaunch: HtmlMotionTemplate = {
  id: 'saas-feature-launch',
  name: 'SaaS Feature Launch',
  description: 'Three-act feature launch: problem hook, feature reveal with proof metrics, CTA with shipping bar.',
  bestFor: 'Announcing new SaaS features, version launches',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 9000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'product', label: 'Product name', example: 'Prometheus 2.0' },
    { id: 'feature', label: 'Feature name', example: 'Motion Templates' },
    { id: 'value', label: 'Value statement (one sentence)', example: 'Ship promo videos 10x faster.' },
    { id: 'cta', label: 'CTA', example: 'Try Motion Templates' },
  ],
  optionalInputs: [
    { id: 'metric1Value', label: 'Metric 1 value', example: '10x' },
    { id: 'metric1Label', label: 'Metric 1 label', example: 'faster output' },
    { id: 'metric2Value', label: 'Metric 2 value', example: '6' },
    { id: 'metric2Label', label: 'Metric 2 label', example: 'starter templates' },
    { id: 'metric3Value', label: 'Metric 3 value', example: 'MP4' },
    { id: 'metric3Label', label: 'Metric 3 label', example: 'one-click export' },
    { id: 'accent', label: 'Accent color', example: '#22d3ee' },
  ],
  renderHtml(input) {
    const product = escapeHtml(pick(input, 'product', 'Prometheus 2.0'));
    const feature = escapeHtml(pick(input, 'feature', 'Motion Templates'));
    const value = escapeHtml(pick(input, 'value', 'Ship promo videos 10x faster.'));
    const cta = escapeHtml(pick(input, 'cta', 'Try Motion Templates'));
    const m1v = escapeHtml(pick(input, 'metric1Value', '10x'));
    const m1l = escapeHtml(pick(input, 'metric1Label', 'faster'));
    const m2v = escapeHtml(pick(input, 'metric2Value', '6'));
    const m2l = escapeHtml(pick(input, 'metric2Label', 'starter templates'));
    const m3v = escapeHtml(pick(input, 'metric3Value', 'MP4'));
    const m3l = escapeHtml(pick(input, 'metric3Label', 'one-click export'));
    const accent = escapeHtml(pick(input, 'accent', '#22d3ee'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('linear-gradient(180deg, #04111f 0%, #06223d 50%, #0b3257 100%)')}
      .grid { position: absolute; inset: 0; opacity: 0.18; mix-blend-mode: screen;
        background-image:
          linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px);
        background-size: 60px 60px; mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, #000 50%, transparent 100%); }
      .badge { top: 140px; left: 64px; right: 64px; display: inline-flex; align-items: center; gap: 14px;
        padding: 14px 24px; background: rgba(34,211,238,0.12); border: 1px solid ${accent};
        border-radius: 100px; width: max-content; font-size: 26px; font-weight: 700;
        color: ${accent}; letter-spacing: 2px;
        animation: fadeIn 500ms ease-out 100ms both; }
      .badge .pulse { width: 12px; height: 12px; border-radius: 50%; background: ${accent};
        box-shadow: 0 0 0 0 ${accent}; animation: ctaPulse 1.6s ease-in-out infinite; }
      .product { top: 230px; font-size: 38px; font-weight: 700; opacity: 0.7;
        animation: fadeIn 600ms ease-out 200ms both; }
      .feature { top: 300px; font-size: 130px; font-weight: 900; line-height: 1.0; letter-spacing: -3px;
        background: linear-gradient(135deg, #fff 0%, ${accent} 100%);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        animation: fadeUp 800ms ease-out 600ms both; }
      .value { top: 600px; font-size: 54px; font-weight: 500; line-height: 1.25; opacity: 0.9;
        animation: fadeUp 800ms ease-out 1200ms both; }
      .metrics { top: 900px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; }
      .metric { padding: 36px 24px; background: rgba(255,255,255,0.06); border: 1px solid rgba(34,211,238,0.25);
        border-radius: 24px; text-align: center; backdrop-filter: blur(20px); }
      .metric .v { font-size: 88px; font-weight: 900; color: ${accent}; line-height: 1;
        text-shadow: 0 0 30px ${accent}66; }
      .metric .l { margin-top: 12px; font-size: 24px; opacity: 0.85; line-height: 1.25; }
      .metrics .metric:nth-child(1) { animation: fadeUp 600ms ease-out 1900ms both; }
      .metrics .metric:nth-child(2) { animation: fadeUp 600ms ease-out 2200ms both; }
      .metrics .metric:nth-child(3) { animation: fadeUp 600ms ease-out 2500ms both; }
      .ship-rail { top: 1280px; padding: 32px; background: rgba(0,0,0,0.4); border-radius: 22px;
        border: 1px solid rgba(255,255,255,0.1);
        animation: fadeIn 600ms ease-out 3000ms both; }
      .ship-label { font-size: 24px; opacity: 0.7; letter-spacing: 3px; text-transform: uppercase; }
      .ship-bar { margin-top: 16px; height: 14px; background: rgba(255,255,255,0.1); border-radius: 7px; overflow: hidden; }
      .ship-fill { height: 100%; background: linear-gradient(90deg, ${accent}, #34d399);
        transform-origin: left; animation: barFill 4500ms ease-out 3200ms both; }
      .ship-status { margin-top: 12px; font-size: 28px; font-weight: 700; color: ${accent}; }
      .cta { top: 1560px; left: 64px; right: 64px; padding: 44px;
        background: linear-gradient(135deg, ${accent}, #34d399);
        color: #04111f; border-radius: 28px; font-size: 52px; font-weight: 900;
        text-align: center; letter-spacing: 0.5px; box-shadow: 0 24px 64px ${accent}66;
        animation: scalePop 700ms ease-out 6200ms both, ctaPulse 2.2s ease-in-out 7000ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="SaaS feature launch">
        <div class="grid"></div>
        <div class="grain"></div>
        <div class="safe badge"><span class="pulse"></span>NOW SHIPPING</div>
        <div class="safe product">${product}</div>
        <div class="safe feature">${feature}</div>
        <div class="safe value">${value}</div>
        <div class="safe metrics">
          <div class="metric"><div class="v">${m1v}</div><div class="l">${m1l}</div></div>
          <div class="metric"><div class="v">${m2v}</div><div class="l">${m2l}</div></div>
          <div class="metric"><div class="v">${m3v}</div><div class="l">${m3l}</div></div>
        </div>
        <div class="safe ship-rail">
          <div class="ship-label">deployment progress</div>
          <div class="ship-bar"><div class="ship-fill"></div></div>
          <div class="ship-status">Live for all users</div>
        </div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 4: app-demo-card ----------------
const appDemoCard: HtmlMotionTemplate = {
  id: 'app-demo-card',
  name: 'App Demo Card',
  description: 'Glass phone-frame card with simulated app UI animating on screen, headline, CTA.',
  bestFor: 'Mobile app demos, UI previews, onboarding promos',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 8000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'appName', label: 'App name', example: 'Prometheus' },
    { id: 'headline', label: 'Headline', example: 'Your AI workspace, in your pocket' },
    { id: 'cta', label: 'CTA', example: 'Download now' },
  ],
  optionalInputs: [
    { id: 'screenTitle', label: 'In-app screen title', example: 'Today' },
    { id: 'item1', label: 'List item 1', example: 'Morning standup' },
    { id: 'item2', label: 'List item 2', example: 'Ship motion templates' },
    { id: 'item3', label: 'List item 3', example: 'Review export QA' },
    { id: 'accent', label: 'Accent color', example: '#a78bfa' },
  ],
  renderHtml(input) {
    const app = escapeHtml(pick(input, 'appName', 'Prometheus'));
    const headline = escapeHtml(pick(input, 'headline', 'Your AI workspace, in your pocket'));
    const cta = escapeHtml(pick(input, 'cta', 'Download now'));
    const screenTitle = escapeHtml(pick(input, 'screenTitle', 'Today'));
    const i1 = escapeHtml(pick(input, 'item1', 'Morning standup'));
    const i2 = escapeHtml(pick(input, 'item2', 'Ship motion templates'));
    const i3 = escapeHtml(pick(input, 'item3', 'Review export QA'));
    const accent = escapeHtml(pick(input, 'accent', '#a78bfa'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('linear-gradient(165deg, #1a0b3d 0%, #2d1466 50%, #0f0428 100%)')}
      .glow { position: absolute; width: 900px; height: 900px; border-radius: 50%;
        background: radial-gradient(circle, ${accent}55 0%, transparent 60%);
        top: 600px; left: 90px; filter: blur(40px); animation: floatY 5s ease-in-out infinite; }
      .app-tag { top: 140px; font-size: 32px; font-weight: 700; opacity: 0.7; letter-spacing: 4px; text-transform: uppercase;
        animation: fadeIn 500ms ease-out both; }
      .headline { top: 220px; font-size: 78px; font-weight: 800; line-height: 1.05; letter-spacing: -1.5px;
        animation: fadeUp 700ms ease-out 300ms both; }
      .phone { position: absolute; left: 240px; top: 600px; width: 600px; height: 1120px;
        background: linear-gradient(180deg, #1c1438 0%, #14102a 100%);
        border-radius: 64px; padding: 24px;
        border: 4px solid rgba(255,255,255,0.12);
        box-shadow: 0 40px 120px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.05);
        animation: scalePop 900ms cubic-bezier(0.2, 1, 0.4, 1) 800ms both; }
      .notch { position: absolute; top: 22px; left: 50%; transform: translateX(-50%);
        width: 220px; height: 36px; background: #000; border-radius: 18px; }
      .screen { position: absolute; inset: 28px; background: linear-gradient(180deg, #faf5ff 0%, #ede9fe 100%);
        border-radius: 44px; overflow: hidden; padding: 80px 36px 36px; color: #2d1466; }
      .screen-title { font-size: 44px; font-weight: 900; letter-spacing: -1px;
        animation: fadeUp 500ms ease-out 1500ms both; }
      .screen-sub { margin-top: 6px; font-size: 22px; color: #6d28d9; opacity: 0.7;
        animation: fadeIn 500ms ease-out 1700ms both; }
      .row { margin-top: 24px; padding: 22px; background: #fff; border-radius: 18px;
        display: flex; align-items: center; gap: 18px;
        box-shadow: 0 6px 18px rgba(120, 80, 200, 0.15); }
      .row .check { width: 36px; height: 36px; border-radius: 50%; background: ${accent};
        display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 900; font-size: 22px;
        flex-shrink: 0; }
      .row .text { font-size: 26px; font-weight: 600; }
      .row.r1 { animation: slideInLeft 600ms ease-out 1900ms both; }
      .row.r2 { animation: slideInLeft 600ms ease-out 2200ms both; }
      .row.r3 { animation: slideInLeft 600ms ease-out 2500ms both; }
      .row.r3 .check { background: #d1d5db; color: #4b5563; }
      .row.r3 .text { color: #6b7280; }
      .floating-badge { position: absolute; right: -32px; top: 320px;
        background: ${accent}; color: #fff; padding: 18px 28px; border-radius: 18px;
        font-size: 26px; font-weight: 800; transform: rotate(6deg);
        box-shadow: 0 20px 50px ${accent}99;
        animation: scalePop 600ms ease-out 3000ms both, floatY 3.5s ease-in-out 3500ms infinite; }
      .cta { top: 1780px; left: 64px; right: 64px; padding: 36px;
        background: ${accent}; color: #fff; border-radius: 24px; font-size: 48px; font-weight: 900;
        text-align: center; letter-spacing: 0.5px; box-shadow: 0 20px 60px ${accent}aa;
        animation: scalePop 700ms ease-out 5000ms both, ctaPulse 2s ease-in-out 5800ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="App demo card">
        <div class="glow"></div>
        <div class="grain"></div>
        <div class="safe app-tag">${app}</div>
        <div class="safe headline">${headline}</div>
        <div class="phone">
          <div class="notch"></div>
          <div class="screen">
            <div class="screen-title">${screenTitle}</div>
            <div class="screen-sub">3 things on your plate</div>
            <div class="row r1"><div class="check">&#10003;</div><div class="text">${i1}</div></div>
            <div class="row r2"><div class="check">&#10003;</div><div class="text">${i2}</div></div>
            <div class="row r3"><div class="check">&middot;</div><div class="text">${i3}</div></div>
          </div>
          <div class="floating-badge">+ new motion!</div>
        </div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 5: testimonial-social-proof ----------------
const testimonialSocialProof: HtmlMotionTemplate = {
  id: 'testimonial-social-proof',
  name: 'Testimonial / Social Proof',
  description: 'Quote-card driven social proof with rating, author chip, supporting metric, CTA.',
  bestFor: 'Customer testimonials, review highlights, founder quotes',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 8500,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'quote', label: 'Quote (12-30 words)', example: 'Prometheus turned a week of editing into a 5-minute drop.' },
    { id: 'author', label: 'Author name', example: 'Mira Chen' },
    { id: 'role', label: 'Role / company', example: 'Head of Growth, Northwind' },
    { id: 'cta', label: 'CTA', example: 'See more stories' },
  ],
  optionalInputs: [
    { id: 'rating', label: 'Star rating (1-5)', example: '5' },
    { id: 'metricValue', label: 'Headline metric', example: '+218%' },
    { id: 'metricLabel', label: 'Metric label', example: 'output velocity' },
    { id: 'accent', label: 'Accent color', example: '#fb923c' },
  ],
  renderHtml(input) {
    const quote = escapeHtml(pick(input, 'quote', 'Prometheus turned a week of editing into a 5-minute drop.'));
    const author = escapeHtml(pick(input, 'author', 'Mira Chen'));
    const role = escapeHtml(pick(input, 'role', 'Head of Growth, Northwind'));
    const cta = escapeHtml(pick(input, 'cta', 'See more stories'));
    const ratingNum = Math.max(1, Math.min(5, parseInt(pick(input, 'rating', '5'), 10) || 5));
    const stars = '★'.repeat(ratingNum) + '☆'.repeat(5 - ratingNum);
    const metricValue = escapeHtml(pick(input, 'metricValue', '+218%'));
    const metricLabel = escapeHtml(pick(input, 'metricLabel', 'output velocity'));
    const accent = escapeHtml(pick(input, 'accent', '#fb923c'));
    const initial = author.charAt(0).toUpperCase();
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('linear-gradient(170deg, #1a1208 0%, #2c1a09 50%, #0e0904 100%)')}
      .warm-blob { position: absolute; width: 800px; height: 800px; border-radius: 50%;
        background: radial-gradient(circle, ${accent}66 0%, transparent 60%);
        top: 200px; left: -200px; filter: blur(60px); animation: floatY 6s ease-in-out infinite; }
      .label { top: 140px; font-size: 28px; font-weight: 700; letter-spacing: 5px; color: ${accent};
        text-transform: uppercase; animation: fadeIn 500ms ease-out both; }
      .stars { top: 220px; font-size: 64px; color: ${accent}; letter-spacing: 12px;
        animation: fadeUp 600ms ease-out 300ms both; text-shadow: 0 0 20px ${accent}80; }
      .quote-card { top: 360px; left: 64px; right: 64px;
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 32px; padding: 64px 56px; backdrop-filter: blur(30px);
        animation: scalePop 900ms cubic-bezier(0.2, 1, 0.4, 1) 600ms both; }
      .quote-mark { position: absolute; top: -50px; left: 32px; font-size: 220px; color: ${accent};
        font-family: Georgia, serif; line-height: 1; opacity: 0.85;
        text-shadow: 0 0 40px ${accent}80; }
      .quote-text { font-size: 64px; font-weight: 600; line-height: 1.25; letter-spacing: -0.5px;
        animation: fadeUp 700ms ease-out 1100ms both; }
      .author { top: 1080px; left: 64px; right: 64px; display: flex; align-items: center; gap: 28px;
        animation: slideInLeft 600ms ease-out 1700ms both; }
      .avatar { width: 110px; height: 110px; border-radius: 50%;
        background: linear-gradient(135deg, ${accent}, #fbbf24);
        display: flex; align-items: center; justify-content: center;
        font-size: 56px; font-weight: 900; color: #1a1208;
        box-shadow: 0 12px 40px ${accent}66; flex-shrink: 0; }
      .author-text .name { font-size: 42px; font-weight: 800; }
      .author-text .role { margin-top: 4px; font-size: 26px; opacity: 0.7; }
      .metric-card { top: 1280px; left: 64px; right: 64px;
        padding: 44px 40px; background: ${accent}; color: #1a1208; border-radius: 28px;
        display: flex; align-items: center; justify-content: space-between; gap: 24px;
        box-shadow: 0 24px 64px ${accent}66;
        animation: fadeUp 700ms ease-out 2300ms both; }
      .metric-card .mv { font-size: 110px; font-weight: 900; line-height: 1; letter-spacing: -3px; }
      .metric-card .ml { font-size: 30px; font-weight: 700; text-align: right; max-width: 380px; line-height: 1.2; }
      .cta { top: 1660px; left: 64px; right: 64px; padding: 36px;
        background: #fff; color: #1a1208; border-radius: 24px;
        font-size: 48px; font-weight: 900; text-align: center;
        animation: scalePop 600ms ease-out 5500ms both, ctaPulse 2s ease-in-out 6200ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="Testimonial">
        <div class="warm-blob"></div>
        <div class="grain"></div>
        <div class="safe label">What customers say</div>
        <div class="safe stars">${stars}</div>
        <div class="quote-card">
          <div class="quote-mark">&ldquo;</div>
          <div class="quote-text">${quote}</div>
        </div>
        <div class="author">
          <div class="avatar">${initial}</div>
          <div class="author-text"><div class="name">${author}</div><div class="role">${role}</div></div>
        </div>
        <div class="metric-card">
          <div class="mv">${metricValue}</div>
          <div class="ml">${metricLabel}</div>
        </div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 6: event-or-offer-ad ----------------
const eventOrOfferAd: HtmlMotionTemplate = {
  id: 'event-or-offer-ad',
  name: 'Event or Offer Ad',
  description: 'Time-pressure event/offer ad: countdown vibe, big offer mark, date strip, CTA.',
  bestFor: 'Sales, launches with deadline, webinars, limited offers',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 7500,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'eyebrow', label: 'Eyebrow / category', example: 'LIMITED OFFER' },
    { id: 'offer', label: 'Big offer text (e.g. "50% OFF")', example: '50% OFF' },
    { id: 'subject', label: 'Offer subject', example: 'Annual plans this week only' },
    { id: 'cta', label: 'CTA', example: 'Claim deal' },
  ],
  optionalInputs: [
    { id: 'date', label: 'Date or deadline strip', example: 'Ends Friday 11:59 PM' },
    { id: 'detail1', label: 'Detail 1', example: 'All teams, all features' },
    { id: 'detail2', label: 'Detail 2', example: 'Cancel anytime' },
    { id: 'accent', label: 'Accent color', example: '#ef4444' },
  ],
  renderHtml(input) {
    const eyebrow = escapeHtml(pick(input, 'eyebrow', 'LIMITED OFFER'));
    const offer = escapeHtml(pick(input, 'offer', '50% OFF'));
    const subject = escapeHtml(pick(input, 'subject', 'Annual plans this week only'));
    const cta = escapeHtml(pick(input, 'cta', 'Claim deal'));
    const date = escapeHtml(pick(input, 'date', 'Ends Friday 11:59 PM'));
    const detail1 = escapeHtml(pick(input, 'detail1', 'All teams, all features'));
    const detail2 = escapeHtml(pick(input, 'detail2', 'Cancel anytime'));
    const accent = escapeHtml(pick(input, 'accent', '#ef4444'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('linear-gradient(180deg, #160202 0%, #2b0606 60%, #050000 100%)')}
      .stripes { position: absolute; inset: 0; opacity: 0.18; mix-blend-mode: screen;
        background: repeating-linear-gradient(45deg, ${accent} 0 30px, transparent 30px 60px); }
      .eyebrow-wrap { top: 160px; left: 64px; right: 64px; display: flex; align-items: center; gap: 18px;
        animation: fadeIn 500ms ease-out both; }
      .pulse-dot { width: 22px; height: 22px; border-radius: 50%; background: ${accent};
        box-shadow: 0 0 0 0 ${accent}; animation: ctaPulse 1.4s ease-in-out infinite; }
      .eyebrow { font-size: 36px; font-weight: 900; color: ${accent}; letter-spacing: 6px;
        text-transform: uppercase; }
      .offer { top: 320px; font-size: 320px; font-weight: 900; line-height: 0.9; letter-spacing: -10px;
        color: #fff; text-shadow: 0 0 60px ${accent}80;
        animation: scalePop 900ms cubic-bezier(0.2, 1.4, 0.4, 1) 300ms both; }
      .offer-underline { position: absolute; top: 690px; left: 64px; height: 18px; background: ${accent};
        width: 0; animation: barFill 800ms ease-out 1200ms both; transform-origin: left;
        box-shadow: 0 0 30px ${accent}; }
      .offer-underline { width: 600px; }
      .subject { top: 760px; font-size: 64px; font-weight: 800; line-height: 1.1; letter-spacing: -1px;
        animation: fadeUp 700ms ease-out 1500ms both; }
      .date-strip { top: 1080px; left: 64px; right: 64px;
        padding: 28px 36px; background: ${accent}; color: #fff;
        border-radius: 18px; font-size: 40px; font-weight: 900; text-align: center;
        letter-spacing: 2px; text-transform: uppercase;
        box-shadow: 0 16px 50px ${accent}80;
        animation: slideInRight 600ms ease-out 2100ms both; }
      .details { top: 1240px; display: flex; flex-direction: column; gap: 22px; }
      .detail { padding: 26px 32px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px; display: flex; align-items: center; gap: 22px;
        font-size: 38px; font-weight: 600; }
      .detail .check { width: 44px; height: 44px; border-radius: 50%; background: ${accent}; color: #fff;
        display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 24px;
        flex-shrink: 0; box-shadow: 0 0 18px ${accent}; }
      .details .detail:nth-child(1) { animation: slideInLeft 600ms ease-out 2700ms both; }
      .details .detail:nth-child(2) { animation: slideInLeft 600ms ease-out 3000ms both; }
      .cta { top: 1560px; left: 64px; right: 64px; padding: 48px;
        background: #fff; color: #160202; border-radius: 28px;
        font-size: 60px; font-weight: 900; text-align: center; letter-spacing: 0.5px;
        text-transform: uppercase; box-shadow: 0 30px 80px rgba(255,255,255,0.25);
        animation: scalePop 700ms ease-out 4200ms both, ctaPulse 1.8s ease-in-out 5000ms infinite; }
      .footer-tick { position: absolute; left: 0; right: 0; bottom: 32px;
        text-align: center; font-size: 24px; opacity: 0.5; letter-spacing: 4px; text-transform: uppercase;
        animation: fadeIn 600ms ease-out 5500ms both; }
    </style></head><body>
      <main class="stage" aria-label="Event or offer ad">
        <div class="stripes"></div>
        <div class="grain"></div>
        <div class="eyebrow-wrap"><span class="pulse-dot"></span><span class="eyebrow">${eyebrow}</span></div>
        <div class="safe offer">${offer}</div>
        <div class="offer-underline"></div>
        <div class="safe subject">${subject}</div>
        <div class="date-strip">${date}</div>
        <div class="safe details">
          <div class="detail"><div class="check">&#10003;</div><span>${detail1}</span></div>
          <div class="detail"><div class="check">&#10003;</div><span>${detail2}</span></div>
        </div>
        <div class="safe cta">${cta}</div>
        <div class="footer-tick">don't miss it</div>
      </main>
    </body></html>`;
  },
};

// Helper to override canvas dimensions for non-vertical templates.
function dimsCss(width: number, height: number): string {
  return `html, body, .stage { width: ${width}px !important; height: ${height}px !important; }`;
}

// ---------------- TEMPLATE 7: minimal-editorial-quote ----------------
const minimalEditorialQuote: HtmlMotionTemplate = {
  id: 'minimal-editorial-quote',
  name: 'Minimal Editorial Quote',
  description: 'Cream + ink editorial layout with serif typography, subtle vertical rule, and slow reveal. Magazine vibe.',
  bestFor: 'Founder quotes, manifestos, thought-leadership posts, brand voice clips',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 10000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'quote', label: 'Quote (15-40 words)', example: 'Make the work, then make it sharper. Then make it smaller. Then ship it.' },
    { id: 'author', label: 'Author', example: 'Mira Chen' },
    { id: 'cta', label: 'CTA / handle', example: 'Read the essay' },
  ],
  optionalInputs: [
    { id: 'kicker', label: 'Kicker label', example: 'ESSAY 014' },
    { id: 'role', label: 'Author role', example: 'Founder, Northwind' },
  ],
  renderHtml(input) {
    const quote = escapeHtml(pick(input, 'quote', 'Make the work, then make it sharper. Then make it smaller. Then ship it.'));
    const author = escapeHtml(pick(input, 'author', 'Mira Chen'));
    const cta = escapeHtml(pick(input, 'cta', 'Read the essay'));
    const kicker = escapeHtml(pick(input, 'kicker', 'ESSAY 014'));
    const role = escapeHtml(pick(input, 'role', 'Founder, Northwind'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#f4ede1')}
      .stage { color: #1a1a1a; }
      .stage::before { display: none; }
      .rule { position: absolute; left: 64px; top: 160px; bottom: 160px; width: 2px; background: #1a1a1a; opacity: 0.18;
        transform-origin: top; transform: scaleY(0); animation: barFill 1400ms ease-out 200ms both; }
      .kicker { top: 160px; left: 100px; font-size: 26px; font-weight: 700; letter-spacing: 8px; text-transform: uppercase;
        animation: fadeIn 600ms ease-out 600ms both; font-family: 'Inter', sans-serif; }
      .quote { top: 380px; left: 100px; right: 64px; font-family: 'Georgia', 'Times New Roman', serif;
        font-size: 88px; font-weight: 400; line-height: 1.18; letter-spacing: -1px; font-style: italic;
        animation: fadeUp 900ms ease-out 1000ms both; }
      .quote::before { content: '"'; position: absolute; top: -100px; left: -8px; font-size: 280px; line-height: 1;
        color: #c44a2c; opacity: 0.7; }
      .author-rule { position: absolute; left: 100px; right: 64px; top: 1500px; height: 1px; background: #1a1a1a; opacity: 0.3;
        transform-origin: left; transform: scaleX(0); animation: barFill 800ms ease-out 3500ms both; }
      .author { top: 1540px; left: 100px; right: 64px; font-family: 'Georgia', serif;
        font-size: 44px; font-weight: 700; animation: fadeUp 700ms ease-out 4000ms both; }
      .role { top: 1610px; left: 100px; font-size: 26px; opacity: 0.65; letter-spacing: 1px;
        animation: fadeIn 600ms ease-out 4400ms both; font-family: 'Inter', sans-serif; }
      .cta { top: 1760px; left: 100px; padding: 22px 36px; border: 2px solid #1a1a1a;
        font-size: 32px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; width: max-content;
        font-family: 'Inter', sans-serif;
        animation: fadeUp 600ms ease-out 5000ms both, ctaPulse 2.4s ease-in-out 6000ms infinite; }
      .corner-mark { position: absolute; top: 80px; right: 64px; width: 60px; height: 60px;
        border: 2px solid #c44a2c; transform: rotate(45deg);
        animation: fadeIn 800ms ease-out 200ms both; }
    </style></head><body>
      <main class="stage" aria-label="Editorial quote">
        <div class="rule"></div>
        <div class="corner-mark"></div>
        <div class="kicker">${kicker}</div>
        <div class="quote">${quote}</div>
        <div class="author-rule"></div>
        <div class="author">${author}</div>
        <div class="role">${role}</div>
        <div class="cta">${cta} &rarr;</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 8: before-after-reveal ----------------
const beforeAfterReveal: HtmlMotionTemplate = {
  id: 'before-after-reveal',
  name: 'Before / After Reveal',
  description: 'Split screen with horizontal wipe between the "before" and "after" states. Earthy clay palette.',
  bestFor: 'Transformations, makeovers, redesign showcases, fitness/results, product upgrades',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 8000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'topic', label: 'Topic / category', example: 'Landing page redesign' },
    { id: 'beforeText', label: 'Before short label', example: 'Cluttered, slow' },
    { id: 'afterText', label: 'After short label', example: 'Clear, fast, on-brand' },
    { id: 'cta', label: 'CTA', example: 'See the case study' },
  ],
  optionalInputs: [
    { id: 'metric', label: 'Result metric', example: '+47% conversion' },
  ],
  renderHtml(input) {
    const topic = escapeHtml(pick(input, 'topic', 'Landing page redesign'));
    const before = escapeHtml(pick(input, 'beforeText', 'Cluttered, slow'));
    const after = escapeHtml(pick(input, 'afterText', 'Clear, fast, on-brand'));
    const cta = escapeHtml(pick(input, 'cta', 'See the case study'));
    const metric = escapeHtml(pick(input, 'metric', '+47% conversion'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#1f1611')}
      .stage::before { display: none; }
      @keyframes wipeRight { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
      @keyframes slideLine { from { left: 0; } to { left: 50%; } }
      .topic { top: 140px; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #d97757; text-transform: uppercase;
        animation: fadeIn 500ms ease-out both; }
      .panel { position: absolute; top: 280px; height: 1100px; width: 100%; overflow: hidden; }
      .before-pane { background: linear-gradient(160deg, #3d2c20 0%, #1f1611 100%); display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 28px; }
      .after-pane { position: absolute; inset: 0; background: linear-gradient(160deg, #d97757 0%, #f4a261 50%, #e9c46a 100%);
        color: #1f1611; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px;
        clip-path: inset(0 100% 0 0); animation: wipeRight 1400ms cubic-bezier(0.7, 0, 0.3, 1) 2000ms forwards; }
      .pane-label { font-size: 36px; font-weight: 800; letter-spacing: 8px; text-transform: uppercase; opacity: 0.6; }
      .pane-text { font-size: 96px; font-weight: 900; line-height: 1.0; letter-spacing: -2px; padding: 0 80px; text-align: center; }
      .scribble { width: 240px; height: 240px; border-radius: 50%;
        background: repeating-linear-gradient(45deg, transparent 0 18px, rgba(255,255,255,0.18) 18px 22px); }
      .after-pane .scribble { background: repeating-linear-gradient(45deg, transparent 0 18px, rgba(31,22,17,0.25) 18px 22px); }
      .divider { position: absolute; top: 280px; left: 50%; width: 6px; height: 1100px; background: #fff;
        transform: translateX(-50%) scaleY(0); transform-origin: top;
        animation: barFill 600ms ease-out 1500ms forwards; box-shadow: 0 0 30px rgba(255,255,255,0.5); }
      .metric { top: 1440px; left: 64px; right: 64px; padding: 36px 40px; background: #d97757; color: #1f1611;
        border-radius: 22px; display: flex; align-items: center; justify-content: space-between;
        animation: fadeUp 700ms ease-out 4200ms both; }
      .metric .v { font-size: 84px; font-weight: 900; letter-spacing: -2px; }
      .metric .l { font-size: 26px; font-weight: 700; opacity: 0.8; letter-spacing: 2px; text-transform: uppercase; max-width: 280px; text-align: right; }
      .cta { top: 1700px; left: 64px; right: 64px; padding: 36px; background: #fff; color: #1f1611; border-radius: 24px;
        font-size: 48px; font-weight: 900; text-align: center; letter-spacing: 0.5px;
        animation: scalePop 600ms ease-out 5000ms both, ctaPulse 2s ease-in-out 5800ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="Before after reveal">
        <div class="safe topic">${topic}</div>
        <div class="panel before-pane">
          <div class="pane-label">BEFORE</div>
          <div class="scribble"></div>
          <div class="pane-text">${before}</div>
        </div>
        <div class="panel after-pane">
          <div class="pane-label">AFTER</div>
          <div class="scribble"></div>
          <div class="pane-text">${after}</div>
        </div>
        <div class="divider"></div>
        <div class="metric"><div class="v">${metric}</div><div class="l">measured uplift</div></div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 9: step-by-step-tutorial ----------------
const stepByStepTutorial: HtmlMotionTemplate = {
  id: 'step-by-step-tutorial',
  name: 'Step-by-Step Tutorial',
  description: 'Numbered 4-step instructional layout with progress dots. Forest emerald palette.',
  bestFor: 'How-to clips, mini tutorials, onboarding explainers, recipe-style instructions',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 12000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'topic', label: 'Tutorial topic', example: 'Ship a promo in 4 steps' },
    { id: 'step1', label: 'Step 1', example: 'Pick a template' },
    { id: 'step2', label: 'Step 2', example: 'Fill in the brief' },
    { id: 'step3', label: 'Step 3', example: 'Run frame QA' },
    { id: 'step4', label: 'Step 4', example: 'Export MP4' },
    { id: 'cta', label: 'CTA', example: 'Try it yourself' },
  ],
  optionalInputs: [
    { id: 'kicker', label: 'Kicker', example: 'TUTORIAL' },
  ],
  renderHtml(input) {
    const topic = escapeHtml(pick(input, 'topic', 'Ship a promo in 4 steps'));
    const s1 = escapeHtml(pick(input, 'step1', 'Pick a template'));
    const s2 = escapeHtml(pick(input, 'step2', 'Fill in the brief'));
    const s3 = escapeHtml(pick(input, 'step3', 'Run frame QA'));
    const s4 = escapeHtml(pick(input, 'step4', 'Export MP4'));
    const cta = escapeHtml(pick(input, 'cta', 'Try it yourself'));
    const kicker = escapeHtml(pick(input, 'kicker', 'TUTORIAL'));
    const stepCss = (n: number, delayMs: number) => `
      .step.s${n} { animation: fadeUp 600ms ease-out ${delayMs}ms both; }
      .step.s${n} .num-bg { animation: scalePop 500ms cubic-bezier(0.2,1.4,0.4,1) ${delayMs + 100}ms both; }
      .progress-dot.d${n} { animation: scalePop 500ms ease-out ${delayMs + 200}ms both; }`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('linear-gradient(170deg, #052e16 0%, #064e3b 50%, #022c22 100%)')}
      .stage { color: #ecfdf5; }
      .leaf-blob { position: absolute; width: 700px; height: 700px; border-radius: 50%;
        background: radial-gradient(circle, #10b98155 0%, transparent 65%); filter: blur(50px);
        top: -200px; right: -200px; animation: floatY 7s ease-in-out infinite; }
      .kicker { top: 140px; font-size: 28px; font-weight: 800; letter-spacing: 8px; color: #34d399; text-transform: uppercase;
        animation: fadeIn 500ms ease-out both; }
      .topic { top: 220px; font-size: 88px; font-weight: 900; line-height: 1.05; letter-spacing: -2px;
        animation: fadeUp 800ms ease-out 200ms both; }
      .progress-row { top: 480px; display: flex; gap: 14px; }
      .progress-dot { width: 60px; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.15); transform: scaleX(0); transform-origin: left; }
      .progress-dot.active { background: #34d399; box-shadow: 0 0 15px #34d399; }
      .steps { top: 580px; display: flex; flex-direction: column; gap: 22px; }
      .step { display: flex; align-items: center; gap: 28px; padding: 30px 32px;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(52,211,153,0.25); border-radius: 22px;
        backdrop-filter: blur(15px); }
      .step .num { width: 84px; height: 84px; flex-shrink: 0; position: relative; display: flex; align-items: center; justify-content: center;
        font-size: 44px; font-weight: 900; color: #052e16; }
      .step .num-bg { position: absolute; inset: 0; background: #34d399; border-radius: 50%;
        box-shadow: 0 0 24px #34d39988; }
      .step .num-text { position: relative; }
      .step .text { font-size: 44px; font-weight: 700; line-height: 1.2; }
      ${stepCss(1, 1200)}
      ${stepCss(2, 2800)}
      ${stepCss(3, 4400)}
      ${stepCss(4, 6000)}
      .cta { top: 1680px; left: 64px; right: 64px; padding: 38px;
        background: #34d399; color: #052e16; border-radius: 24px; font-size: 50px; font-weight: 900;
        text-align: center; letter-spacing: 0.5px; box-shadow: 0 24px 60px #10b98166;
        animation: scalePop 700ms ease-out 7600ms both, ctaPulse 2s ease-in-out 8400ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="Step by step tutorial">
        <div class="leaf-blob"></div>
        <div class="grain"></div>
        <div class="safe kicker">${kicker}</div>
        <div class="safe topic">${topic}</div>
        <div class="safe progress-row">
          <div class="progress-dot active d1"></div><div class="progress-dot active d2"></div>
          <div class="progress-dot active d3"></div><div class="progress-dot active d4"></div>
        </div>
        <div class="safe steps">
          <div class="step s1"><div class="num"><div class="num-bg"></div><span class="num-text">1</span></div><div class="text">${s1}</div></div>
          <div class="step s2"><div class="num"><div class="num-bg"></div><span class="num-text">2</span></div><div class="text">${s2}</div></div>
          <div class="step s3"><div class="num"><div class="num-bg"></div><span class="num-text">3</span></div><div class="text">${s3}</div></div>
          <div class="step s4"><div class="num"><div class="num-bg"></div><span class="num-text">4</span></div><div class="text">${s4}</div></div>
        </div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 10: stat-bomb-reel ----------------
const statBombReel: HtmlMotionTemplate = {
  id: 'stat-bomb-reel',
  name: 'Stat Bomb Reel',
  description: 'Big-number animated stat reel. Punchy data drop with three sequential stats. Mono-noir + lime accent.',
  bestFor: 'Investor / metrics highlights, growth wins, year-in-review reels',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 8000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'kicker', label: 'Kicker', example: 'Q4 IN NUMBERS' },
    { id: 's1Value', label: 'Stat 1 value', example: '$4.2M' },
    { id: 's1Label', label: 'Stat 1 label', example: 'ARR added' },
    { id: 's2Value', label: 'Stat 2 value', example: '218%' },
    { id: 's2Label', label: 'Stat 2 label', example: 'Net retention' },
    { id: 's3Value', label: 'Stat 3 value', example: '0' },
    { id: 's3Label', label: 'Stat 3 label', example: 'Churned enterprise' },
    { id: 'cta', label: 'CTA', example: 'Read the report' },
  ],
  optionalInputs: [],
  renderHtml(input) {
    const kicker = escapeHtml(pick(input, 'kicker', 'Q4 IN NUMBERS'));
    const s1v = escapeHtml(pick(input, 's1Value', '$4.2M'));
    const s1l = escapeHtml(pick(input, 's1Label', 'ARR added'));
    const s2v = escapeHtml(pick(input, 's2Value', '218%'));
    const s2l = escapeHtml(pick(input, 's2Label', 'Net retention'));
    const s3v = escapeHtml(pick(input, 's3Value', '0'));
    const s3l = escapeHtml(pick(input, 's3Label', 'Churned enterprise'));
    const cta = escapeHtml(pick(input, 'cta', 'Read the report'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#0a0a0a')}
      .stage { color: #fafafa; }
      .stage::before { display: none; }
      .grid-bg { position: absolute; inset: 0; opacity: 0.18;
        background-image: linear-gradient(rgba(190,242,100,0.18) 1px, transparent 1px),
          linear-gradient(90deg, rgba(190,242,100,0.18) 1px, transparent 1px);
        background-size: 80px 80px; mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent); }
      .kicker { top: 140px; font-family: 'Courier New', monospace; font-size: 28px; font-weight: 700;
        color: #bef264; letter-spacing: 6px; padding: 10px 20px; border: 2px solid #bef264; width: max-content; left: 64px;
        animation: fadeIn 500ms ease-out both; }
      .stat-block { position: absolute; left: 64px; right: 64px; }
      .stat-block .v { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 280px; font-weight: 900; line-height: 0.9;
        letter-spacing: -10px; color: #fff; }
      .stat-block .v .num { display: inline-block; }
      .stat-block .l { font-size: 36px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase;
        color: #bef264; margin-top: 8px; }
      .stat-block .bar { margin-top: 20px; height: 8px; background: #bef264; transform-origin: left; transform: scaleX(0);
        animation: barFill 700ms ease-out forwards; }
      .b1 { top: 280px; opacity: 0; animation: fadeIn 200ms ease-out 400ms forwards, fadeOut 300ms ease-in 2400ms forwards; }
      .b1 .v .num { animation: scalePop 600ms cubic-bezier(0.2,1.4,0.4,1) 500ms both; }
      .b1 .bar { animation-delay: 700ms; }
      .b2 { top: 280px; opacity: 0; animation: fadeIn 200ms ease-out 2700ms forwards, fadeOut 300ms ease-in 4700ms forwards; }
      .b2 .v .num { animation: scalePop 600ms cubic-bezier(0.2,1.4,0.4,1) 2800ms both; }
      .b2 .bar { animation-delay: 3000ms; }
      .b3 { top: 280px; opacity: 0; animation: fadeIn 200ms ease-out 5000ms forwards; }
      .b3 .v .num { animation: scalePop 600ms cubic-bezier(0.2,1.4,0.4,1) 5100ms both; }
      .b3 .bar { animation-delay: 5300ms; }
      .counter { position: absolute; bottom: 320px; left: 64px; right: 64px; display: flex; gap: 18px; font-family: 'Courier New', monospace; }
      .tick { flex: 1; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; }
      .tick .fill { width: 100%; height: 100%; background: #bef264; transform-origin: left; transform: scaleX(0); }
      .tick.t1 .fill { animation: barFill 2000ms linear 400ms forwards; }
      .tick.t2 .fill { animation: barFill 2000ms linear 2700ms forwards; }
      .tick.t3 .fill { animation: barFill 2000ms linear 5000ms forwards; }
      .cta { bottom: 80px; left: 64px; right: 64px; padding: 36px;
        background: #bef264; color: #0a0a0a; border-radius: 0; font-size: 50px; font-weight: 900;
        text-align: center; letter-spacing: 4px; text-transform: uppercase;
        animation: scalePop 600ms ease-out 6500ms both, ctaPulse 1.8s ease-in-out 7300ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="Stat bomb">
        <div class="grid-bg"></div>
        <div class="kicker">${kicker}</div>
        <div class="stat-block b1"><div class="v"><span class="num">${s1v}</span></div><div class="l">${s1l}</div><div class="bar"></div></div>
        <div class="stat-block b2"><div class="v"><span class="num">${s2v}</span></div><div class="l">${s2l}</div><div class="bar"></div></div>
        <div class="stat-block b3"><div class="v"><span class="num">${s3v}</span></div><div class="l">${s3l}</div><div class="bar"></div></div>
        <div class="counter"><div class="tick t1"><div class="fill"></div></div><div class="tick t2"><div class="fill"></div></div><div class="tick t3"><div class="fill"></div></div></div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 11: podcast-episode-promo ----------------
const podcastEpisodePromo: HtmlMotionTemplate = {
  id: 'podcast-episode-promo',
  name: 'Podcast Episode Promo',
  description: 'Audiogram-style podcast promo with animated waveform, episode title, host strip, and platform CTA. Cream + ink palette.',
  bestFor: 'New episode drops, podcast clips, audio-first content',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 10000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'show', label: 'Show name', example: 'Ship It Weekly' },
    { id: 'episode', label: 'Episode number', example: 'EP. 042' },
    { id: 'title', label: 'Episode title', example: 'Inside the motion template engine' },
    { id: 'host', label: 'Host(s)', example: 'with Mira Chen & Raul' },
    { id: 'cta', label: 'CTA', example: 'Listen on Spotify, Apple, YouTube' },
  ],
  optionalInputs: [],
  renderHtml(input) {
    const show = escapeHtml(pick(input, 'show', 'Ship It Weekly'));
    const episode = escapeHtml(pick(input, 'episode', 'EP. 042'));
    const title = escapeHtml(pick(input, 'title', 'Inside the motion template engine'));
    const host = escapeHtml(pick(input, 'host', 'with Mira Chen & Raul'));
    const cta = escapeHtml(pick(input, 'cta', 'Listen on Spotify, Apple, YouTube'));
    const bars = Array.from({ length: 32 }, (_, i) => i);
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#f1ead5')}
      .stage { color: #1a1a1a; }
      .stage::before { display: none; }
      @keyframes barWave { 0%, 100% { transform: scaleY(0.2); } 50% { transform: scaleY(1); } }
      .show-row { top: 140px; display: flex; align-items: center; gap: 18px;
        animation: fadeIn 500ms ease-out both; }
      .mic { width: 56px; height: 56px; border-radius: 50%; background: #1a1a1a; color: #f1ead5;
        display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 900; }
      .show-name { font-size: 32px; font-weight: 800; letter-spacing: 2px; }
      .ep { top: 240px; font-size: 28px; font-weight: 800; color: #c44a2c; letter-spacing: 6px;
        animation: fadeIn 500ms ease-out 200ms both; }
      .title { top: 320px; font-family: 'Georgia', serif; font-size: 96px; font-weight: 700; line-height: 1.05;
        letter-spacing: -2px; animation: fadeUp 800ms ease-out 600ms both; }
      .host { top: 880px; font-size: 36px; font-weight: 600; opacity: 0.7;
        animation: fadeIn 500ms ease-out 1400ms both; }
      .wave { position: absolute; left: 64px; right: 64px; top: 1080px; height: 320px;
        display: flex; align-items: center; justify-content: space-between; gap: 6px;
        animation: fadeIn 600ms ease-out 1800ms both; }
      .bar { flex: 1; background: #1a1a1a; border-radius: 6px; height: 100%; transform-origin: center;
        animation: barWave 1.4s ease-in-out infinite; }
      ${bars.map((i) => `.bar.b${i} { animation-delay: ${(i * 70) % 1400}ms; background: ${i % 5 === 0 ? '#c44a2c' : '#1a1a1a'}; }`).join('\n')}
      .cta-strip { top: 1500px; left: 64px; right: 64px; padding: 36px 40px;
        background: #1a1a1a; color: #f1ead5; border-radius: 100px;
        font-size: 36px; font-weight: 700; text-align: center; letter-spacing: 1px;
        animation: fadeUp 700ms ease-out 2400ms both; }
      .platforms { top: 1660px; left: 64px; right: 64px; display: flex; justify-content: center; gap: 32px;
        font-size: 26px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; opacity: 0.6;
        animation: fadeIn 600ms ease-out 3000ms both; }
      .play-cta { top: 1740px; left: 64px; right: 64px; padding: 36px;
        background: #c44a2c; color: #f1ead5; border-radius: 22px;
        font-size: 46px; font-weight: 900; text-align: center; letter-spacing: 1px;
        animation: scalePop 700ms ease-out 7000ms both, ctaPulse 2s ease-in-out 7800ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="Podcast episode promo">
        <div class="safe show-row"><div class="mic">P</div><div class="show-name">${show}</div></div>
        <div class="safe ep">${episode}</div>
        <div class="safe title">${title}</div>
        <div class="safe host">${host}</div>
        <div class="wave">${bars.map((i) => `<div class="bar b${i}"></div>`).join('')}</div>
        <div class="cta-strip">${cta}</div>
        <div class="platforms"><span>SPOTIFY</span><span>APPLE</span><span>YOUTUBE</span></div>
        <div class="safe play-cta">&#9654;&nbsp; PLAY NOW</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 12: recipe-card-vertical ----------------
const recipeCardVertical: HtmlMotionTemplate = {
  id: 'recipe-card-vertical',
  name: 'Recipe Card Vertical',
  description: 'Food/recipe vertical card with ingredients, time/serving chips, and CTA. Sand + tomato palette.',
  bestFor: 'Food creators, recipe drops, cooking shorts, meal-prep clips',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 10000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'dish', label: 'Dish name', example: 'Smoky tomato pasta' },
    { id: 'time', label: 'Total time', example: '20 min' },
    { id: 'serves', label: 'Servings', example: '2' },
    { id: 'ing1', label: 'Ingredient 1', example: 'Penne, 200g' },
    { id: 'ing2', label: 'Ingredient 2', example: 'San Marzano, 1 can' },
    { id: 'ing3', label: 'Ingredient 3', example: 'Smoked paprika, 1 tsp' },
    { id: 'ing4', label: 'Ingredient 4', example: 'Garlic, 3 cloves' },
    { id: 'cta', label: 'CTA', example: 'Save the recipe' },
  ],
  optionalInputs: [
    { id: 'ing5', label: 'Ingredient 5', example: 'Parmesan, to taste' },
  ],
  renderHtml(input) {
    const dish = escapeHtml(pick(input, 'dish', 'Smoky tomato pasta'));
    const time = escapeHtml(pick(input, 'time', '20 min'));
    const serves = escapeHtml(pick(input, 'serves', '2'));
    const ings = ['ing1', 'ing2', 'ing3', 'ing4', 'ing5']
      .map((k) => pick(input, k, ''))
      .filter(Boolean)
      .map(escapeHtml);
    const cta = escapeHtml(pick(input, 'cta', 'Save the recipe'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#f5e9d4')}
      .stage { color: #2b1407; }
      .stage::before { display: none; }
      .ribbon { position: absolute; top: 0; left: 0; right: 0; height: 24px;
        background: repeating-linear-gradient(90deg, #c8553d 0 60px, #f5e9d4 60px 80px); }
      .kicker { top: 100px; font-size: 28px; font-weight: 800; color: #c8553d; letter-spacing: 8px; text-transform: uppercase;
        animation: fadeIn 500ms ease-out both; }
      .dish { top: 180px; font-family: 'Georgia', serif; font-size: 110px; font-weight: 900; line-height: 1.0;
        letter-spacing: -2px; animation: fadeUp 800ms ease-out 200ms both; }
      .meta { top: 580px; display: flex; gap: 18px; }
      .chip { padding: 18px 28px; background: #2b1407; color: #f5e9d4; border-radius: 100px;
        font-size: 28px; font-weight: 800; letter-spacing: 2px; }
      .chip.alt { background: #c8553d; }
      .meta .chip:nth-child(1) { animation: slideInLeft 500ms ease-out 1000ms both; }
      .meta .chip:nth-child(2) { animation: slideInLeft 500ms ease-out 1200ms both; }
      .ing-card { top: 720px; left: 64px; right: 64px; background: #fff8ec; border: 4px solid #2b1407;
        border-radius: 32px; padding: 48px 44px; box-shadow: 12px 12px 0 #c8553d;
        animation: scalePop 700ms cubic-bezier(0.2,1,0.4,1) 1400ms both; }
      .ing-title { font-size: 32px; font-weight: 900; letter-spacing: 4px; color: #c8553d; text-transform: uppercase; margin-bottom: 18px; }
      .ing-row { display: flex; align-items: center; gap: 20px; padding: 18px 0; border-bottom: 1px dashed rgba(43,20,7,0.3);
        font-size: 38px; font-weight: 700; }
      .ing-row:last-child { border-bottom: none; }
      .ing-row .dot { width: 18px; height: 18px; border-radius: 50%; background: #c8553d; flex-shrink: 0; }
      .ing-row.r1 { animation: slideInLeft 500ms ease-out 1900ms both; }
      .ing-row.r2 { animation: slideInLeft 500ms ease-out 2200ms both; }
      .ing-row.r3 { animation: slideInLeft 500ms ease-out 2500ms both; }
      .ing-row.r4 { animation: slideInLeft 500ms ease-out 2800ms both; }
      .ing-row.r5 { animation: slideInLeft 500ms ease-out 3100ms both; }
      .cta { top: 1740px; left: 64px; right: 64px; padding: 38px;
        background: #c8553d; color: #fff8ec; border-radius: 24px;
        font-size: 50px; font-weight: 900; text-align: center; letter-spacing: 1px;
        animation: scalePop 600ms ease-out 4500ms both, ctaPulse 2s ease-in-out 5300ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="Recipe card">
        <div class="ribbon"></div>
        <div class="safe kicker">RECIPE</div>
        <div class="safe dish">${dish}</div>
        <div class="safe meta"><div class="chip">&#128337; ${time}</div><div class="chip alt">SERVES ${serves}</div></div>
        <div class="ing-card">
          <div class="ing-title">Ingredients</div>
          ${ings.map((it, i) => `<div class="ing-row r${i + 1}"><span class="dot"></span><span>${it}</span></div>`).join('')}
        </div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 13: coming-soon-teaser (short) ----------------
const comingSoonTeaser: HtmlMotionTemplate = {
  id: 'coming-soon-teaser',
  name: 'Coming Soon Teaser',
  description: 'Short 5-second mystery teaser with logo reveal, date, and minimal copy. Mono noir with red accent.',
  bestFor: 'Pre-launch teasers, drop announcements, mystery hooks',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 5000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'brand', label: 'Brand or product name', example: 'PROMETHEUS' },
    { id: 'date', label: 'Reveal date', example: '11 . 14' },
    { id: 'tagline', label: 'Single-line tagline', example: 'Something is coming.' },
  ],
  optionalInputs: [
    { id: 'accent', label: 'Accent color', example: '#dc2626' },
  ],
  renderHtml(input) {
    const brand = escapeHtml(pick(input, 'brand', 'PROMETHEUS'));
    const date = escapeHtml(pick(input, 'date', '11 . 14'));
    const tagline = escapeHtml(pick(input, 'tagline', 'Something is coming.'));
    const accent = escapeHtml(pick(input, 'accent', '#dc2626'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#000')}
      .stage::before { display: none; }
      @keyframes scanLine { 0% { top: -200px; } 100% { top: 2000px; } }
      .scan { position: absolute; left: 0; right: 0; height: 200px;
        background: linear-gradient(180deg, transparent, ${accent}33, transparent);
        animation: scanLine 3s linear 200ms 2; pointer-events: none; }
      .crosshair { position: absolute; inset: 64px; border: 2px solid ${accent}66;
        animation: fadeIn 600ms ease-out 400ms both; }
      .crosshair::before, .crosshair::after { content: ''; position: absolute; background: ${accent}; }
      .crosshair::before { top: -2px; left: -2px; width: 60px; height: 6px; box-shadow: 60px -8px 0 ${accent}; }
      .crosshair::after { bottom: -2px; right: -2px; width: 60px; height: 6px; box-shadow: -60px 8px 0 ${accent}; }
      .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px; }
      .brand { font-size: 110px; font-weight: 900; letter-spacing: 24px; color: #fff;
        animation: fadeIn 600ms ease-out 800ms both, scalePop 700ms cubic-bezier(0.2,1.4,0.4,1) 800ms both; }
      .accent-bar { width: 0; height: 8px; background: ${accent}; box-shadow: 0 0 30px ${accent};
        animation: barFill 600ms ease-out 1500ms both; transform-origin: left; }
      .accent-bar { width: 480px; }
      .date { font-family: 'Courier New', monospace; font-size: 180px; font-weight: 900; color: ${accent}; letter-spacing: 8px;
        text-shadow: 0 0 40px ${accent}80;
        animation: fadeIn 500ms ease-out 2200ms both; }
      .tagline { font-size: 36px; font-weight: 600; letter-spacing: 6px; color: #fff; opacity: 0.85; text-transform: uppercase;
        animation: fadeUp 600ms ease-out 3000ms both; }
      .meta-top { position: absolute; top: 100px; left: 100px; right: 100px; display: flex; justify-content: space-between;
        font-family: 'Courier New', monospace; font-size: 22px; color: ${accent}; letter-spacing: 4px;
        animation: fadeIn 400ms ease-out 200ms both; }
    </style></head><body>
      <main class="stage" aria-label="Coming soon teaser">
        <div class="scan"></div>
        <div class="crosshair"></div>
        <div class="meta-top"><span>// CLASSIFIED</span><span>SIGNAL_LOCK</span></div>
        <div class="center">
          <div class="brand">${brand}</div>
          <div class="accent-bar"></div>
          <div class="date">${date}</div>
          <div class="tagline">${tagline}</div>
        </div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 14: news-headline-flash ----------------
const newsHeadlineFlash: HtmlMotionTemplate = {
  id: 'news-headline-flash',
  name: 'News Headline Flash',
  description: 'Breaking-news style flash card with ticker, dateline, and big headline. Crimson + ink.',
  bestFor: 'Industry news drops, hot takes, alerts, "just announced" posts',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 6000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'label', label: 'Alert label', example: 'JUST ANNOUNCED' },
    { id: 'headline', label: 'Headline', example: 'Prometheus ships motion templates' },
    { id: 'summary', label: 'One-line summary', example: 'Promo videos go from prompt to MP4 in under a minute.' },
    { id: 'cta', label: 'CTA', example: 'Read the announcement' },
  ],
  optionalInputs: [
    { id: 'source', label: 'Source / dateline', example: 'PROMETHEUS NEWSROOM &middot; TODAY' },
    { id: 'ticker', label: 'Ticker text', example: 'BREAKING — MOTION TEMPLATES NOW LIVE — TRY 6 STARTERS — EXPORT MP4 IN ONE CLICK' },
  ],
  renderHtml(input) {
    const label = escapeHtml(pick(input, 'label', 'JUST ANNOUNCED'));
    const headline = escapeHtml(pick(input, 'headline', 'Prometheus ships motion templates'));
    const summary = escapeHtml(pick(input, 'summary', 'Promo videos go from prompt to MP4 in under a minute.'));
    const cta = escapeHtml(pick(input, 'cta', 'Read the announcement'));
    const source = escapeHtml(pick(input, 'source', 'PROMETHEUS NEWSROOM · TODAY'));
    const ticker = escapeHtml(pick(input, 'ticker', 'BREAKING — MOTION TEMPLATES NOW LIVE — TRY 6 STARTERS — EXPORT MP4 IN ONE CLICK'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#0a0a0a')}
      .stage { color: #fff; }
      .stage::before { display: none; }
      @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .red-band { position: absolute; top: 140px; left: 0; right: 0; height: 110px;
        background: #b91c1c; display: flex; align-items: center; padding: 0 64px; gap: 22px;
        animation: slideInLeft 600ms cubic-bezier(0.2,1,0.4,1) both; }
      .live-dot { width: 18px; height: 18px; border-radius: 50%; background: #fff;
        animation: ctaPulse 1.4s ease-in-out infinite; box-shadow: 0 0 0 0 #fff; }
      .label { font-size: 38px; font-weight: 900; letter-spacing: 8px; }
      .source { top: 300px; font-size: 26px; opacity: 0.7; letter-spacing: 4px;
        animation: fadeIn 400ms ease-out 800ms both; font-family: 'Courier New', monospace; }
      .headline { top: 400px; font-family: 'Georgia', serif; font-size: 130px; font-weight: 900; line-height: 0.95;
        letter-spacing: -3px; animation: fadeUp 800ms ease-out 1000ms both; }
      .underline-bar { top: 1100px; left: 64px; height: 8px; background: #b91c1c; width: 0;
        animation: barFill 600ms ease-out 1800ms both; transform-origin: left; }
      .underline-bar { width: 320px; }
      .summary { top: 1180px; font-size: 50px; font-weight: 500; line-height: 1.25; opacity: 0.92;
        animation: fadeUp 700ms ease-out 2000ms both; }
      .ticker-band { position: absolute; bottom: 220px; left: 0; right: 0; height: 80px; background: #fff; color: #0a0a0a;
        overflow: hidden; display: flex; align-items: center;
        animation: fadeIn 400ms ease-out 2800ms both; }
      .ticker-track { display: flex; gap: 80px; white-space: nowrap; font-size: 32px; font-weight: 900; letter-spacing: 2px;
        padding-left: 0; animation: ticker 18s linear infinite; }
      .cta { bottom: 80px; left: 64px; right: 64px; padding: 36px;
        background: #b91c1c; color: #fff; border-radius: 0; font-size: 46px; font-weight: 900;
        text-align: center; letter-spacing: 4px; text-transform: uppercase;
        animation: scalePop 600ms ease-out 4000ms both, ctaPulse 1.8s ease-in-out 4800ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="News headline flash">
        <div class="red-band"><div class="live-dot"></div><div class="label">${label}</div></div>
        <div class="safe source">${source}</div>
        <div class="safe headline">${headline}</div>
        <div class="underline-bar"></div>
        <div class="safe summary">${summary}</div>
        <div class="ticker-band"><div class="ticker-track"><span>${ticker}</span><span>${ticker}</span></div></div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 15: feature-comparison-vs ----------------
const featureComparisonVs: HtmlMotionTemplate = {
  id: 'feature-comparison-vs',
  name: 'Feature Comparison VS',
  description: 'Two-column comparison with checks/x marks. Sand + ocean palette (no purple/blue gradient).',
  bestFor: 'Us-vs-them comparisons, before/after migrations, plan differences',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 9000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'topic', label: 'Topic', example: 'Old workflow vs Prometheus' },
    { id: 'leftLabel', label: 'Left column label', example: 'Before' },
    { id: 'rightLabel', label: 'Right column label', example: 'Prometheus' },
    { id: 'l1', label: 'Left point 1', example: 'Hours of timeline editing' },
    { id: 'l2', label: 'Left point 2', example: 'One-off custom HTML' },
    { id: 'l3', label: 'Left point 3', example: 'Manual frame review' },
    { id: 'r1', label: 'Right point 1', example: 'Templates in seconds' },
    { id: 'r2', label: 'Right point 2', example: 'Reusable, on-brand' },
    { id: 'r3', label: 'Right point 3', example: 'Frame QA built in' },
    { id: 'cta', label: 'CTA', example: 'Switch to Prometheus' },
  ],
  optionalInputs: [],
  renderHtml(input) {
    const topic = escapeHtml(pick(input, 'topic', 'Old workflow vs Prometheus'));
    const leftLabel = escapeHtml(pick(input, 'leftLabel', 'Before'));
    const rightLabel = escapeHtml(pick(input, 'rightLabel', 'Prometheus'));
    const l = [pick(input, 'l1'), pick(input, 'l2'), pick(input, 'l3')].map(escapeHtml);
    const r = [pick(input, 'r1'), pick(input, 'r2'), pick(input, 'r3')].map(escapeHtml);
    const cta = escapeHtml(pick(input, 'cta', 'Switch to Prometheus'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#eaddc7')}
      .stage { color: #1c2530; }
      .stage::before { display: none; }
      .topic { top: 140px; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0e7c7b; text-transform: uppercase;
        animation: fadeIn 500ms ease-out both; text-align: center; }
      .vs-row { top: 240px; display: grid; grid-template-columns: 1fr auto 1fr; gap: 18px; align-items: stretch; }
      .col { padding: 36px 28px; border-radius: 28px; }
      .col.left { background: #d1c4ad; color: #5a4a35;
        animation: slideInLeft 600ms ease-out 200ms both; }
      .col.right { background: #0e7c7b; color: #f4ede0;
        animation: slideInRight 600ms ease-out 200ms both; box-shadow: 0 20px 60px #0e7c7b66; }
      .col-label { font-size: 32px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase; opacity: 0.85; margin-bottom: 18px; }
      .point { display: flex; align-items: flex-start; gap: 14px; padding: 16px 0; font-size: 30px; font-weight: 600; line-height: 1.25; }
      .point .mark { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 900; }
      .left .point .mark { background: #5a4a35; color: #d1c4ad; }
      .right .point .mark { background: #f4ede0; color: #0e7c7b; }
      .vs-pill { align-self: center; padding: 22px 28px; background: #1c2530; color: #fff; border-radius: 100px;
        font-size: 44px; font-weight: 900; letter-spacing: 6px;
        animation: scalePop 700ms cubic-bezier(0.2,1.4,0.4,1) 800ms both; box-shadow: 0 16px 40px rgba(0,0,0,0.3); }
      .left .point:nth-child(2) { animation: fadeUp 400ms ease-out 1500ms both; }
      .left .point:nth-child(3) { animation: fadeUp 400ms ease-out 1800ms both; }
      .left .point:nth-child(4) { animation: fadeUp 400ms ease-out 2100ms both; }
      .right .point:nth-child(2) { animation: fadeUp 400ms ease-out 2700ms both; }
      .right .point:nth-child(3) { animation: fadeUp 400ms ease-out 3000ms both; }
      .right .point:nth-child(4) { animation: fadeUp 400ms ease-out 3300ms both; }
      .winner-bar { top: 1480px; left: 64px; right: 64px; padding: 32px;
        background: #1c2530; color: #f4ede0; border-radius: 24px; text-align: center;
        font-size: 36px; font-weight: 800; letter-spacing: 2px;
        animation: fadeUp 600ms ease-out 4000ms both; }
      .winner-bar .check { color: #34d399; font-size: 44px; }
      .cta { top: 1700px; left: 64px; right: 64px; padding: 38px;
        background: #0e7c7b; color: #f4ede0; border-radius: 24px;
        font-size: 50px; font-weight: 900; text-align: center; letter-spacing: 1px;
        animation: scalePop 600ms ease-out 5500ms both, ctaPulse 2s ease-in-out 6300ms infinite; }
    </style></head><body>
      <main class="stage" aria-label="Feature comparison">
        <div class="safe topic">${topic}</div>
        <div class="safe vs-row">
          <div class="col left">
            <div class="col-label">${leftLabel}</div>
            <div class="point"><div class="mark">&times;</div>${l[0]}</div>
            <div class="point"><div class="mark">&times;</div>${l[1]}</div>
            <div class="point"><div class="mark">&times;</div>${l[2]}</div>
          </div>
          <div class="vs-pill">VS</div>
          <div class="col right">
            <div class="col-label">${rightLabel}</div>
            <div class="point"><div class="mark">&#10003;</div>${r[0]}</div>
            <div class="point"><div class="mark">&#10003;</div>${r[1]}</div>
            <div class="point"><div class="mark">&#10003;</div>${r[2]}</div>
          </div>
        </div>
        <div class="winner-bar"><span class="check">&#10003;</span>&nbsp; clear winner</div>
        <div class="safe cta">${cta}</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 16: glitch-cyber-promo ----------------
const glitchCyberPromo: HtmlMotionTemplate = {
  id: 'glitch-cyber-promo',
  name: 'Glitch Cyber Promo',
  description: 'High-energy glitch typography with chromatic aberration and scan lines. Black + lime + magenta.',
  bestFor: 'Tech/gaming/web3 promos, edgy launch teasers, esports, dev tools',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 7000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'tag', label: 'Top tag', example: 'V2.0 // SHIP MODE' },
    { id: 'hero', label: 'Hero word', example: 'PROMETHEUS' },
    { id: 'sub', label: 'Sub line', example: 'Motion templates, weaponized.' },
    { id: 'cta', label: 'CTA', example: 'INSTALL NOW' },
  ],
  optionalInputs: [],
  renderHtml(input) {
    const tag = escapeHtml(pick(input, 'tag', 'V2.0 // SHIP MODE'));
    const hero = escapeHtml(pick(input, 'hero', 'PROMETHEUS'));
    const sub = escapeHtml(pick(input, 'sub', 'Motion templates, weaponized.'));
    const cta = escapeHtml(pick(input, 'cta', 'INSTALL NOW'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#000')}
      .stage { color: #d4ff3a; font-family: 'Courier New', monospace; }
      .stage::before { display: none; }
      @keyframes glitchX { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-8px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(4px); } }
      @keyframes scan { 0% { background-position: 0 0; } 100% { background-position: 0 4px; } }
      .scanlines { position: absolute; inset: 0; pointer-events: none;
        background: repeating-linear-gradient(0deg, rgba(0,0,0,0.4) 0 2px, transparent 2px 4px);
        animation: scan 200ms linear infinite; }
      .corner { position: absolute; font-size: 24px; opacity: 0.7; letter-spacing: 4px; }
      .c-tl { top: 80px; left: 64px; }
      .c-tr { top: 80px; right: 64px; }
      .c-bl { bottom: 80px; left: 64px; }
      .c-br { bottom: 80px; right: 64px; color: #ff2bd6; }
      .tag { top: 240px; font-size: 30px; font-weight: 900; letter-spacing: 6px; color: #ff2bd6;
        padding: 12px 20px; border: 2px solid #ff2bd6; width: max-content; left: 64px;
        animation: fadeIn 400ms ease-out both, glitchX 200ms steps(2) 1500ms 3; }
      .hero-wrap { top: 600px; left: 64px; right: 64px; position: absolute; }
      .hero { font-size: 220px; font-weight: 900; line-height: 0.9; letter-spacing: -6px; color: #d4ff3a;
        text-shadow: -6px 0 #ff2bd6, 6px 0 #00f0ff;
        animation: fadeIn 300ms ease-out 200ms both, glitchX 150ms steps(3) 1000ms 4, glitchX 150ms steps(3) 4000ms 3; }
      .hero-rule { margin-top: 16px; height: 8px; background: #d4ff3a; width: 0;
        animation: barFill 600ms ease-out 800ms both; transform-origin: left; box-shadow: 0 0 30px #d4ff3a; }
      .hero-rule { width: 100%; }
      .sub { top: 1180px; left: 64px; right: 64px; font-size: 50px; font-weight: 700; color: #fff; letter-spacing: 2px;
        animation: fadeUp 600ms ease-out 1500ms both; }
      .data-row { top: 1380px; left: 64px; right: 64px; display: flex; gap: 12px;
        animation: fadeIn 400ms ease-out 2000ms both; }
      .data-cell { flex: 1; padding: 18px; border: 1px solid #d4ff3a; background: rgba(212,255,58,0.05);
        font-size: 22px; letter-spacing: 2px; color: #d4ff3a; }
      .data-cell.alt { border-color: #ff2bd6; color: #ff2bd6; background: rgba(255,43,214,0.05); }
      .cta { top: 1640px; left: 64px; right: 64px; padding: 40px; background: #d4ff3a; color: #000;
        font-size: 60px; font-weight: 900; text-align: center; letter-spacing: 8px;
        clip-path: polygon(0 0, 100% 0, 96% 100%, 4% 100%);
        animation: scalePop 600ms ease-out 3000ms both, ctaPulse 1.4s ease-in-out 3800ms infinite; }
      .footer-noise { position: absolute; bottom: 24px; left: 64px; right: 64px; font-size: 18px; letter-spacing: 4px; opacity: 0.5; text-align: center;
        animation: fadeIn 400ms ease-out 4000ms both; }
    </style></head><body>
      <main class="stage" aria-label="Glitch cyber promo">
        <div class="scanlines"></div>
        <div class="corner c-tl">[ SYS-OK ]</div>
        <div class="corner c-tr">SIGNAL: 100%</div>
        <div class="corner c-bl">// 0xPRMTH</div>
        <div class="corner c-br">REC &bull;</div>
        <div class="tag">${tag}</div>
        <div class="hero-wrap"><div class="hero">${hero}</div><div class="hero-rule"></div></div>
        <div class="sub">${sub}</div>
        <div class="data-row">
          <div class="data-cell">UPTIME 99.99</div>
          <div class="data-cell alt">LATENCY 12ms</div>
          <div class="data-cell">SHIP_RATE 10x</div>
        </div>
        <div class="cta">&gt;&gt; ${cta} &lt;&lt;</div>
        <div class="footer-noise">— end transmission —</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 17: square-feed-announcement ----------------
const squareFeedAnnouncement: HtmlMotionTemplate = {
  id: 'square-feed-announcement',
  name: 'Square Feed Announcement',
  description: '1:1 square format for Instagram/LinkedIn feed. Big shape composition, kicker, headline, CTA. Cream + ink + tomato.',
  bestFor: 'Instagram/LinkedIn feed posts, square ad creative, blog promo cards',
  defaultWidth: 1080,
  defaultHeight: 1080,
  defaultDurationMs: 6000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'kicker', label: 'Kicker', example: 'NEW POST' },
    { id: 'headline', label: 'Headline', example: 'How we cut promo time by 10x' },
    { id: 'cta', label: 'CTA', example: 'Read on the blog' },
  ],
  optionalInputs: [
    { id: 'brand', label: 'Brand', example: 'Prometheus' },
  ],
  renderHtml(input) {
    const kicker = escapeHtml(pick(input, 'kicker', 'NEW POST'));
    const headline = escapeHtml(pick(input, 'headline', 'How we cut promo time by 10x'));
    const cta = escapeHtml(pick(input, 'cta', 'Read on the blog'));
    const brand = escapeHtml(pick(input, 'brand', 'Prometheus'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('#f4ede1')}
      ${dimsCss(1080, 1080)}
      .stage { color: #1a1a1a; }
      .stage::before { display: none; }
      .blob { position: absolute; width: 720px; height: 720px; background: #c44a2c; border-radius: 50%;
        top: -260px; right: -260px;
        animation: scalePop 1000ms cubic-bezier(0.2, 1, 0.4, 1) 100ms both; }
      .blob.b2 { width: 380px; height: 380px; background: #1a1a1a; top: auto; bottom: -160px; left: -160px; right: auto;
        animation: scalePop 800ms cubic-bezier(0.2, 1, 0.4, 1) 400ms both; }
      .brand { top: 70px; font-size: 26px; font-weight: 800; letter-spacing: 6px; text-transform: uppercase;
        animation: fadeIn 500ms ease-out both; }
      .kicker { top: 140px; font-size: 28px; font-weight: 900; color: #c44a2c; letter-spacing: 8px; text-transform: uppercase;
        animation: fadeIn 500ms ease-out 200ms both; }
      .headline { top: 240px; left: 64px; right: 360px; font-family: 'Georgia', serif;
        font-size: 100px; font-weight: 900; line-height: 1.0; letter-spacing: -2px;
        animation: fadeUp 800ms ease-out 600ms both; }
      .underline { top: 760px; left: 64px; height: 12px; background: #c44a2c; width: 0;
        animation: barFill 700ms ease-out 1500ms both; transform-origin: left; }
      .underline { width: 320px; }
      .cta { top: 880px; left: 64px; padding: 22px 36px;
        background: #1a1a1a; color: #f4ede1; border-radius: 100px;
        font-size: 32px; font-weight: 800; letter-spacing: 2px; width: max-content;
        animation: scalePop 600ms ease-out 2200ms both, ctaPulse 2s ease-in-out 3000ms infinite; }
      .corner-num { position: absolute; bottom: 60px; right: 64px;
        font-family: 'Courier New', monospace; font-size: 22px; font-weight: 700; opacity: 0.5; letter-spacing: 4px;
        animation: fadeIn 500ms ease-out 1000ms both; }
    </style></head><body>
      <main class="stage" aria-label="Square feed announcement">
        <div class="blob"></div>
        <div class="blob b2"></div>
        <div class="safe brand">${brand}</div>
        <div class="safe kicker">${kicker}</div>
        <div class="headline">${headline}</div>
        <div class="underline"></div>
        <div class="cta">${cta} &rarr;</div>
        <div class="corner-num">// 001</div>
      </main>
    </body></html>`;
  },
};

// ---------------- TEMPLATE 18: youtube-intro-promo ----------------
const youtubeIntroPromo: HtmlMotionTemplate = {
  id: 'youtube-intro-promo',
  name: 'YouTube Intro Promo (Landscape)',
  description: '16:9 landscape intro/outro for YouTube. Big channel mark, episode title, subscribe nudge. Mint + graphite palette.',
  bestFor: 'YouTube channel intros, end cards, video promos, livestream openers',
  defaultWidth: 1920,
  defaultHeight: 1080,
  defaultDurationMs: 5000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'channel', label: 'Channel name', example: 'BUILD WITH PROMETHEUS' },
    { id: 'episode', label: 'Episode title', example: 'Inside the motion templates engine' },
    { id: 'cta', label: 'CTA', example: 'Subscribe + ring the bell' },
  ],
  optionalInputs: [
    { id: 'tag', label: 'Tag', example: 'EP. 042' },
  ],
  renderHtml(input) {
    const channel = escapeHtml(pick(input, 'channel', 'BUILD WITH PROMETHEUS'));
    const episode = escapeHtml(pick(input, 'episode', 'Inside the motion templates engine'));
    const cta = escapeHtml(pick(input, 'cta', 'Subscribe + ring the bell'));
    const tag = escapeHtml(pick(input, 'tag', 'EP. 042'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${baseCss('linear-gradient(135deg, #1f2933 0%, #0f1a23 100%)')}
      ${dimsCss(1920, 1080)}
      .safe { left: 80px; right: 80px; }
      .mint-blob { position: absolute; width: 900px; height: 900px; border-radius: 50%;
        background: radial-gradient(circle, #5eead455 0%, transparent 65%); filter: blur(50px);
        top: -200px; right: -200px; animation: floatY 5s ease-in-out infinite; }
      .left-side { position: absolute; left: 80px; top: 100px; bottom: 100px; width: 1100px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
      .channel-row { display: flex; align-items: center; gap: 22px;
        animation: slideInLeft 600ms ease-out 100ms both; }
      .ch-mark { width: 88px; height: 88px; border-radius: 22px; background: #5eead4; color: #0f1a23;
        display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 50px;
        box-shadow: 0 12px 40px #5eead466; }
      .channel { font-size: 36px; font-weight: 800; letter-spacing: 4px; color: #5eead4; text-transform: uppercase; }
      .tag { font-size: 28px; font-weight: 800; opacity: 0.6; letter-spacing: 6px; }
      .ep-title { font-size: 100px; font-weight: 900; line-height: 1.05; letter-spacing: -2px; color: #fff;
        animation: fadeUp 800ms ease-out 700ms both; }
      .accent-bar { height: 8px; background: #5eead4; width: 0;
        animation: barFill 600ms ease-out 1300ms both; transform-origin: left; box-shadow: 0 0 25px #5eead4; }
      .accent-bar { width: 360px; }
      .cta-row { display: flex; align-items: center; gap: 22px; margin-top: 18px;
        animation: scalePop 700ms ease-out 1900ms both; }
      .sub-btn { padding: 28px 42px; background: #5eead4; color: #0f1a23; border-radius: 100px;
        font-size: 36px; font-weight: 900; letter-spacing: 1px;
        animation: ctaPulse 2s ease-in-out 2600ms infinite; }
      .bell { width: 80px; height: 80px; border-radius: 50%; background: rgba(94,234,212,0.15); border: 2px solid #5eead4;
        display: flex; align-items: center; justify-content: center; color: #5eead4; font-size: 38px;
        animation: floatY 1.6s ease-in-out 2600ms infinite; }
      .right-side { position: absolute; right: 80px; top: 100px; bottom: 100px; width: 600px;
        background: linear-gradient(180deg, rgba(94,234,212,0.1), rgba(94,234,212,0.02));
        border: 1px solid rgba(94,234,212,0.3); border-radius: 28px;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
        animation: slideInRight 700ms ease-out 400ms both; }
      .play-circle { width: 280px; height: 280px; border-radius: 50%; background: #5eead4; color: #0f1a23;
        display: flex; align-items: center; justify-content: center; font-size: 130px; padding-left: 24px;
        box-shadow: 0 30px 80px #5eead466;
        animation: floatY 3s ease-in-out infinite; }
      .play-label { font-size: 26px; font-weight: 800; letter-spacing: 6px; color: #5eead4; text-transform: uppercase; }
      .timecode { font-family: 'Courier New', monospace; font-size: 22px; opacity: 0.6; letter-spacing: 2px; }
    </style></head><body>
      <main class="stage" aria-label="YouTube intro promo">
        <div class="mint-blob"></div>
        <div class="grain"></div>
        <div class="left-side">
          <div class="channel-row"><div class="ch-mark">P</div><div class="channel">${channel}</div><div class="tag">${tag}</div></div>
          <div class="ep-title">${episode}</div>
          <div class="accent-bar"></div>
          <div class="cta-row"><div class="sub-btn">${cta}</div><div class="bell">&#128276;</div></div>
        </div>
        <div class="right-side">
          <div class="play-circle">&#9654;</div>
          <div class="play-label">NOW PLAYING</div>
          <div class="timecode">00:00 / 18:42</div>
        </div>
      </main>
    </body></html>`;
  },
};

const ugcReviewCard: HtmlMotionTemplate = {
  id: 'ugc-review-card',
  name: 'UGC Review Card',
  description: 'Creator-style review clip with phone-safe quote card, rating strip, benefit chips, and CTA.',
  bestFor: 'DTC, SaaS, course, or app testimonial ads that should feel social-native',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 8500,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'hook', label: 'Hook', example: 'I tried Prometheus for one week' },
    { id: 'quote', label: 'Review quote', example: 'It turned messy ideas into polished launch clips without opening an editor.' },
    { id: 'author', label: 'Reviewer', example: 'Maya, founder' },
    { id: 'cta', label: 'CTA', example: 'Try the workflow' },
  ],
  optionalInputs: [
    { id: 'chip1', label: 'Benefit chip 1', example: 'No timeline wrestling' },
    { id: 'chip2', label: 'Benefit chip 2', example: 'Frame QA built in' },
    { id: 'chip3', label: 'Benefit chip 3', example: 'Exports MP4' },
    { id: 'accent', label: 'Accent color', example: '#f97316' },
  ],
  renderHtml(input) {
    const hook = escapeHtml(pick(input, 'hook', 'I tried this for one week'));
    const quote = escapeHtml(pick(input, 'quote', 'It made the whole workflow feel faster and more polished.'));
    const author = escapeHtml(pick(input, 'author', 'Verified creator'));
    const cta = escapeHtml(pick(input, 'cta', 'Try it today'));
    const chip1 = escapeHtml(pick(input, 'chip1', 'Faster drafts'));
    const chip2 = escapeHtml(pick(input, 'chip2', 'Cleaner edits'));
    const chip3 = escapeHtml(pick(input, 'chip3', 'Ready to post'));
    const accent = escapeHtml(pick(input, 'accent', '#f97316'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss('linear-gradient(180deg,#f7efe4 0%,#e8d6be 100%)')}
      .stage{color:#1f1611}.badge{top:116px;font:900 24px/1 Inter,sans-serif;letter-spacing:5px;color:${accent};text-transform:uppercase;animation:fadeUp .6s both}
      .hook{top:210px;font:950 94px/.95 Inter,sans-serif;letter-spacing:-5px;max-width:900px;animation:fadeUp .7s .15s both}.phone{position:absolute;left:96px;right:96px;top:640px;height:720px;border-radius:54px;background:#fffaf2;box-shadow:0 34px 100px rgba(31,22,17,.28);padding:64px;animation:scalePop .75s .65s both}
      .stars{font:900 44px/1 Inter,sans-serif;color:${accent};letter-spacing:8px}.quote{margin:42px 0 0;font:850 58px/1.08 Georgia,serif;letter-spacing:-2px}.author{position:absolute;left:64px;bottom:56px;font:800 28px/1 Inter,sans-serif;color:#6b4c35}
      .chips{position:absolute;left:96px;right:96px;top:1420px;display:grid;gap:16px}.chip{padding:22px 28px;border-radius:999px;background:#1f1611;color:#fff;font:850 34px/1 Inter,sans-serif;animation:slideInLeft .55s both}.chip:nth-child(2){animation-delay:1.4s}.chip:nth-child(3){animation-delay:1.75s}
      .cta{position:absolute;left:96px;right:96px;bottom:126px;padding:30px 40px;border-radius:999px;background:${accent};color:#1f1611;text-align:center;font:950 46px/1 Inter,sans-serif;animation:scalePop .55s 6.4s both,ctaPulse 1.4s 7s infinite}</style></head><body><main class="stage">
      <div class="grain"></div><div class="safe badge">Real customer take</div><h1 class="safe hook">${hook}</h1><section class="phone"><div class="stars">*****</div><p class="quote">"${quote}"</p><div class="author">${author}</div></section>
      <div class="chips"><div class="chip">${chip1}</div><div class="chip">${chip2}</div><div class="chip">${chip3}</div></div><div class="cta">${cta}</div></main></body></html>`;
  },
};

const aiWorkflowDemo: HtmlMotionTemplate = {
  id: 'ai-workflow-demo',
  name: 'AI Workflow Demo',
  description: 'Command palette, task stack, progress rail, and output preview for AI product demos.',
  bestFor: 'Showing an AI assistant, automation tool, or internal workflow product',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 9000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'product', label: 'Product name', example: 'Prometheus' },
    { id: 'command', label: 'Prompt / command', example: 'Create a polished promo video' },
    { id: 'result', label: 'Result statement', example: 'A reusable motion clip, QA checked and ready to export.' },
    { id: 'cta', label: 'CTA', example: 'Build faster with Prometheus' },
  ],
  optionalInputs: [
    { id: 'step1', label: 'Step 1', example: 'Reads the brief' },
    { id: 'step2', label: 'Step 2', example: 'Builds the composition' },
    { id: 'step3', label: 'Step 3', example: 'Runs frame QA' },
    { id: 'accent', label: 'Accent color', example: '#5eead4' },
  ],
  renderHtml(input) {
    const product = escapeHtml(pick(input, 'product', 'Prometheus'));
    const command = escapeHtml(pick(input, 'command', 'Create a polished promo video'));
    const result = escapeHtml(pick(input, 'result', 'A reusable motion clip, QA checked and ready to export.'));
    const cta = escapeHtml(pick(input, 'cta', 'Build faster'));
    const step1 = escapeHtml(pick(input, 'step1', 'Reads the brief'));
    const step2 = escapeHtml(pick(input, 'step2', 'Builds the composition'));
    const step3 = escapeHtml(pick(input, 'step3', 'Runs frame QA'));
    const accent = escapeHtml(pick(input, 'accent', '#5eead4'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss('linear-gradient(180deg,#111827 0%,#0f1a23 55%,#0a0f14 100%)')}
      .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:72px 72px;opacity:.38}
      .top{top:110px;font:900 26px/1 Inter,sans-serif;letter-spacing:5px;color:${accent};text-transform:uppercase;animation:fadeUp .5s both}.headline{top:190px;font:950 104px/.92 Inter,sans-serif;letter-spacing:-6px;max-width:900px;animation:fadeUp .7s .15s both}
      .palette{position:absolute;left:80px;right:80px;top:610px;border-radius:34px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 100px rgba(0,0,0,.45);overflow:hidden;animation:scalePop .65s .55s both}
      .palette header{padding:28px 34px;border-bottom:1px solid rgba(255,255,255,.1);font:800 28px/1 Inter,sans-serif;color:#cbd5e1}.cmd{padding:44px 38px;font:850 54px/1.06 Inter,sans-serif}.cursor{display:inline-block;width:24px;height:54px;background:${accent};vertical-align:-8px;animation:fadeIn .8s infinite alternate}
      .steps{position:absolute;left:96px;right:96px;top:1060px;display:grid;gap:18px}.step{display:flex;align-items:center;gap:20px;padding:24px 28px;border-radius:24px;background:rgba(255,255,255,.09);font:800 34px/1 Inter,sans-serif;animation:slideInRight .5s both}.step:nth-child(2){animation-delay:1.8s}.step:nth-child(3){animation-delay:2.25s}.dot{width:22px;height:22px;border-radius:50%;background:${accent};box-shadow:0 0 30px ${accent}}
      .result{position:absolute;left:96px;right:96px;top:1380px;font:750 38px/1.18 Inter,sans-serif;color:#dbeafe;animation:fadeUp .6s 4.2s both}.cta{position:absolute;left:96px;right:96px;bottom:122px;padding:32px 38px;border-radius:26px;background:${accent};color:#06111a;text-align:center;font:950 44px/1 Inter,sans-serif;animation:scalePop .55s 6.5s both,ctaPulse 1.3s 7s infinite}</style></head><body><main class="stage">
      <div class="grid"></div><div class="grain"></div><div class="safe top">${product} workflow</div><h1 class="safe headline">From prompt<br>to finished clip.</h1><section class="palette"><header>New task</header><div class="cmd">${command}<span class="cursor"></span></div></section>
      <div class="steps"><div class="step"><span class="dot"></span>${step1}</div><div class="step"><span class="dot"></span>${step2}</div><div class="step"><span class="dot"></span>${step3}</div></div><div class="result">${result}</div><div class="cta">${cta}</div></main></body></html>`;
  },
};

const localBusinessSpotlight: HtmlMotionTemplate = {
  id: 'local-business-spotlight',
  name: 'Local Business Spotlight',
  description: 'Warm local ad layout with offer card, trust badges, hours/location strip, and CTA.',
  bestFor: 'Restaurants, gyms, salons, clinics, contractors, real estate, and local service ads',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 8000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'business', label: 'Business name', example: 'Northside Coffee' },
    { id: 'offer', label: 'Offer / headline', example: 'Fresh breakfast all week' },
    { id: 'detail', label: 'Detail line', example: 'Locally roasted coffee, pastries, and quick pickup.' },
    { id: 'cta', label: 'CTA', example: 'Stop by today' },
  ],
  optionalInputs: [
    { id: 'location', label: 'Location', example: 'Downtown Raleigh' },
    { id: 'badge1', label: 'Badge 1', example: 'Open daily' },
    { id: 'badge2', label: 'Badge 2', example: 'Family owned' },
    { id: 'accent', label: 'Accent color', example: '#c8553d' },
  ],
  renderHtml(input) {
    const business = escapeHtml(pick(input, 'business', 'Local Business'));
    const offer = escapeHtml(pick(input, 'offer', 'Fresh offer this week'));
    const detail = escapeHtml(pick(input, 'detail', 'Made nearby, served with care, ready when you are.'));
    const cta = escapeHtml(pick(input, 'cta', 'Visit today'));
    const location = escapeHtml(pick(input, 'location', 'Your neighborhood'));
    const badge1 = escapeHtml(pick(input, 'badge1', 'Open daily'));
    const badge2 = escapeHtml(pick(input, 'badge2', 'Locally owned'));
    const accent = escapeHtml(pick(input, 'accent', '#c8553d'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss('linear-gradient(180deg,#f5e9d4 0%,#e8caa4 100%)')}
      .stage{color:#2b1407}.sun{position:absolute;right:-150px;top:90px;width:520px;height:520px;border-radius:50%;background:${accent};opacity:.22;animation:floatY 4s infinite ease-in-out}.brand{top:120px;font:900 28px/1 Inter,sans-serif;letter-spacing:4px;color:${accent};text-transform:uppercase;animation:fadeUp .5s both}
      .offer{top:240px;font:950 110px/.9 Inter,sans-serif;letter-spacing:-6px;max-width:900px;animation:fadeUp .7s .15s both}.plate{position:absolute;left:80px;right:80px;top:745px;height:560px;border-radius:46px;background:#fff8ec;box-shadow:0 30px 90px rgba(43,20,7,.22);padding:58px;animation:scalePop .7s .65s both}
      .plate p{margin:0;font:750 50px/1.12 Georgia,serif}.badges{display:flex;gap:16px;margin-top:54px}.badge{padding:18px 22px;border-radius:999px;background:#2b1407;color:#fff;font:850 26px/1 Inter,sans-serif}.loc{position:absolute;left:58px;right:58px;bottom:54px;padding-top:28px;border-top:2px solid rgba(43,20,7,.14);font:800 30px/1 Inter,sans-serif;color:${accent}}
      .cta{position:absolute;left:80px;right:80px;bottom:122px;padding:34px 40px;border-radius:30px;background:${accent};color:#fff;text-align:center;font:950 50px/1 Inter,sans-serif;animation:scalePop .55s 6s both,ctaPulse 1.3s 6.8s infinite}</style></head><body><main class="stage">
      <div class="sun"></div><div class="grain"></div><div class="safe brand">${business}</div><h1 class="safe offer">${offer}</h1><section class="plate"><p>${detail}</p><div class="badges"><div class="badge">${badge1}</div><div class="badge">${badge2}</div></div><div class="loc">${location}</div></section><div class="cta">${cta}</div></main></body></html>`;
  },
};

const courseLessonPromo: HtmlMotionTemplate = {
  id: 'course-lesson-promo',
  name: 'Course Lesson Promo',
  description: 'Education/coaching promo with lesson title, module stack, learner promise, and CTA.',
  bestFor: 'Courses, cohort launches, webinars, workshops, and creator education clips',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 9000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'course', label: 'Course / program', example: 'Motion Systems Lab' },
    { id: 'lesson', label: 'Lesson title', example: 'Design clips people actually finish watching' },
    { id: 'promise', label: 'Learner promise', example: 'Learn the repeatable structure behind stronger promo videos.' },
    { id: 'cta', label: 'CTA', example: 'Join the next cohort' },
  ],
  optionalInputs: [
    { id: 'module1', label: 'Module 1', example: 'Hooks and pacing' },
    { id: 'module2', label: 'Module 2', example: 'Visual hierarchy' },
    { id: 'module3', label: 'Module 3', example: 'Export QA' },
    { id: 'accent', label: 'Accent color', example: '#34d399' },
  ],
  renderHtml(input) {
    const course = escapeHtml(pick(input, 'course', 'Course Name'));
    const lesson = escapeHtml(pick(input, 'lesson', 'Build stronger lessons'));
    const promise = escapeHtml(pick(input, 'promise', 'Learn the system, practice the moves, ship with confidence.'));
    const cta = escapeHtml(pick(input, 'cta', 'Join now'));
    const module1 = escapeHtml(pick(input, 'module1', 'Lesson structure'));
    const module2 = escapeHtml(pick(input, 'module2', 'Practice system'));
    const module3 = escapeHtml(pick(input, 'module3', 'Final review'));
    const accent = escapeHtml(pick(input, 'accent', '#34d399'));
    return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss('linear-gradient(180deg,#052e16 0%,#064e3b 58%,#022c22 100%)')}
      .kicker{top:118px;font:900 26px/1 Inter,sans-serif;letter-spacing:5px;color:${accent};text-transform:uppercase;animation:fadeUp .5s both}.lesson{top:220px;font:950 98px/.92 Inter,sans-serif;letter-spacing:-6px;max-width:920px;animation:fadeUp .7s .15s both}
      .card{position:absolute;left:80px;right:80px;top:760px;border-radius:42px;background:#ecfdf5;color:#052e16;padding:56px;box-shadow:0 30px 100px rgba(0,0,0,.28);animation:scalePop .7s .65s both}.promise{font:780 48px/1.12 Georgia,serif;margin:0 0 42px}
      .modules{display:grid;gap:16px}.module{display:flex;align-items:center;gap:18px;font:850 32px/1 Inter,sans-serif}.num{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:${accent};color:#052e16;font:950 24px/1 Inter,sans-serif}
      .rail{position:absolute;left:80px;right:80px;bottom:280px;height:14px;border-radius:999px;background:rgba(255,255,255,.18);overflow:hidden}.rail:after{content:'';display:block;width:100%;height:100%;background:${accent};transform-origin:left;animation:barFill 8.2s linear both}
      .cta{position:absolute;left:80px;right:80px;bottom:122px;padding:34px 40px;border-radius:999px;background:${accent};color:#052e16;text-align:center;font:950 48px/1 Inter,sans-serif;animation:scalePop .55s 6.7s both,ctaPulse 1.3s 7.2s infinite}</style></head><body><main class="stage">
      <div class="grain"></div><div class="safe kicker">${course}</div><h1 class="safe lesson">${lesson}</h1><section class="card"><p class="promise">${promise}</p><div class="modules"><div class="module"><span class="num">1</span>${module1}</div><div class="module"><span class="num">2</span>${module2}</div><div class="module"><span class="num">3</span>${module3}</div></div></section><div class="rail"></div><div class="cta">${cta}</div></main></body></html>`;
  },
};

const aiDesignStudioLaunch: HtmlMotionTemplate = {
  id: 'ai-design-studio-launch',
  name: 'AI Design Studio Launch',
  description: 'Claude-style product demo film with title card, AI workspace, live preview, tweak panel, gallery montage, cursor choreography, and export-to-agent modal.',
  bestFor: 'Polished product-launch films for AI design, prototyping, builder, or creative workspace products',
  defaultWidth: 1920,
  defaultHeight: 1080,
  defaultDurationMs: 24000,
  defaultFrameRate: 60,
  requiredInputs: [
    { id: 'product', label: 'Product name', example: 'Prometheus Design' },
    { id: 'headline', label: 'Launch headline', example: 'Create production-ready prototypes with your AI workspace' },
    { id: 'prompt', label: 'Demo prompt', example: 'Make an interactive globe landing page with editable motion controls.' },
    { id: 'cta', label: 'Final CTA', example: 'Send the design to your local agent' },
  ],
  optionalInputs: [
    { id: 'eyebrow', label: 'Eyebrow', example: 'INTRODUCING' },
    { id: 'artifactTitle', label: 'Generated artifact title', example: 'Interactive Globe.html' },
    { id: 'panel1', label: 'Tweak panel row 1', example: 'Arc glow' },
    { id: 'panel2', label: 'Tweak panel row 2', example: 'City density' },
    { id: 'panel3', label: 'Tweak panel row 3', example: 'Pulse speed' },
    { id: 'gallery1', label: 'Gallery item 1', example: 'Mobile app' },
    { id: 'gallery2', label: 'Gallery item 2', example: 'Dashboard' },
    { id: 'gallery3', label: 'Gallery item 3', example: 'Brand board' },
    { id: 'gallery4', label: 'Gallery item 4', example: 'Map story' },
    { id: 'accent', label: 'Accent color', example: '#d97757' },
    { id: 'glow', label: 'Glow intensity 0-1', example: '0.75' },
    { id: 'density', label: 'Preview density 0-1', example: '0.65' },
    { id: 'speed', label: 'Motion speed 0.5-1.5', example: '1' },
  ],
  parameters: [
    { id: 'accent', label: 'Accent color', type: 'color', defaultValue: '#d97757', target: { lane: 'html-motion', path: '--accent' }, description: 'Primary product-demo accent used for cursor, control fills, arcs, and CTA.' },
    { id: 'glow', label: 'Arc glow', type: 'range', defaultValue: 0.75, min: 0, max: 1, step: 0.05, target: { lane: 'html-motion', path: '--glow' }, description: 'Controls brightness of the generated globe preview and arcs.' },
    { id: 'density', label: 'Artifact density', type: 'range', defaultValue: 0.65, min: 0, max: 1, step: 0.05, target: { lane: 'html-motion', path: '--density' }, description: 'Controls how busy the preview/gallery system feels.' },
    { id: 'speed', label: 'Motion speed', type: 'range', defaultValue: 1, min: 0.5, max: 1.5, step: 0.05, target: { lane: 'html-motion', path: '--speed' }, description: 'Global CSS timing multiplier for the demo film.' },
  ],
  renderHtml(input) {
    const product = escapeHtml(pick(input, 'product', 'Prometheus Design'));
    const headline = escapeHtml(pick(input, 'headline', 'Create production-ready prototypes with your AI workspace'));
    const prompt = escapeHtml(pick(input, 'prompt', 'Make an interactive globe landing page with editable motion controls.'));
    const cta = escapeHtml(pick(input, 'cta', 'Send the design to your local agent'));
    const eyebrow = escapeHtml(pick(input, 'eyebrow', 'INTRODUCING'));
    const artifactTitle = escapeHtml(pick(input, 'artifactTitle', 'Interactive Globe.html'));
    const panel1 = escapeHtml(pick(input, 'panel1', 'Arc glow'));
    const panel2 = escapeHtml(pick(input, 'panel2', 'City density'));
    const panel3 = escapeHtml(pick(input, 'panel3', 'Pulse speed'));
    const gallery1 = escapeHtml(pick(input, 'gallery1', 'Mobile app'));
    const gallery2 = escapeHtml(pick(input, 'gallery2', 'Dashboard'));
    const gallery3 = escapeHtml(pick(input, 'gallery3', 'Brand board'));
    const gallery4 = escapeHtml(pick(input, 'gallery4', 'Map story'));
    const accent = escapeHtml(pick(input, 'accent', '#d97757'));
    const glow = Math.max(0, Math.min(1, pickNumber(input, 'glow', 0.75)));
    const density = Math.max(0, Math.min(1, pickNumber(input, 'density', 0.65)));
    const speed = Math.max(0.5, Math.min(1.5, pickNumber(input, 'speed', 1)));
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      *,*::before,*::after{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}body{font-family:Inter,Manrope,-apple-system,Segoe UI,Arial,sans-serif;-webkit-font-smoothing:antialiased}
      :root{--accent:${accent};--glow:${glow};--density:${density};--speed:${speed};--cream:#f4ede1;--ink:#1b1715;--muted:#746a61;--panel:#fffaf2;--dark:#181615}
      .stage{position:relative;width:1920px;height:1080px;overflow:hidden;background:var(--cream);color:var(--ink)}
      .grain{position:absolute;inset:0;opacity:.055;pointer-events:none;background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.42) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(0,0,0,.25) 0 1px,transparent 1px 4px)}
      .brand-dot{position:absolute;width:108px;height:108px;border-radius:30px;background:linear-gradient(135deg,#c96f4f,var(--accent));box-shadow:0 28px 80px rgba(104,69,48,.24)}
      .title-card{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:34px;animation:titleOut calc(5.6s/var(--speed)) 0s both}
      .title-card .brand-dot{position:relative}.eyebrow{font:900 22px/1 Inter,sans-serif;letter-spacing:8px;color:var(--accent);text-transform:uppercase}.title-card h1{margin:0;font:500 148px/.95 Georgia,serif;letter-spacing:-8px}.title-card p{margin:0;width:980px;text-align:center;font:600 34px/1.28 Inter,sans-serif;color:var(--muted)}
      .workspace{position:absolute;left:64px;right:64px;top:56px;bottom:56px;border-radius:28px;background:#1f1f1e;box-shadow:0 44px 120px rgba(40,28,18,.34);overflow:hidden;opacity:0;transform:scale(.94);animation:workspaceIn calc(1.1s/var(--speed)) 4s both,workspacePush calc(9s/var(--speed)) 6.2s ease-in-out both}
      .topbar{height:64px;display:flex;align-items:center;gap:14px;padding:0 20px;background:#252523;border-bottom:1px solid rgba(255,255,255,.08);color:#f8f4ee}.traffic{display:flex;gap:8px}.traffic i{width:12px;height:12px;border-radius:50%;background:#7b746b}.traffic i:nth-child(1){background:#d66d55}.traffic i:nth-child(2){background:#e0b85c}.traffic i:nth-child(3){background:#7ba66b}.toolbar{margin-left:auto;display:flex;gap:10px}.tool{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.08);font:750 13px/1 Inter,sans-serif;color:#dfd7ca}.tool.active{background:var(--accent);color:#1b1715}
      .columns{display:grid;grid-template-columns:380px 1fr 330px;height:calc(100% - 64px)}.chat{padding:26px;background:#2b2a27;border-right:1px solid rgba(255,255,255,.08);color:#f6efe5}.chat h2{margin:0 0 20px;font:850 24px/1 Inter,sans-serif}.bubble{padding:18px 20px;border-radius:18px;background:#3a3833;color:#eee5d8;font:600 18px/1.35 Inter,sans-serif}.plan{margin-top:24px;display:grid;gap:12px}.plan div{display:flex;gap:10px;align-items:center;font:700 16px/1 Inter,sans-serif;color:#cbbfb0;opacity:0;animation:fadeUp .45s both}.plan div:nth-child(1){animation-delay:5s}.plan div:nth-child(2){animation-delay:5.45s}.plan div:nth-child(3){animation-delay:5.9s}.check{width:20px;height:20px;border-radius:50%;background:var(--accent);display:grid;place-items:center;color:#211;font:900 13px/1 Inter,sans-serif}
      .preview{position:relative;background:#10100f;overflow:hidden}.artifact{position:absolute;left:72px;right:72px;top:70px;bottom:70px;border-radius:30px;background:radial-gradient(circle at 50% 52%,rgba(217,119,87,calc(.14 + var(--glow)*.22)),transparent 34%),linear-gradient(180deg,#171716,#0c0c0c);box-shadow:0 30px 110px rgba(0,0,0,.5);overflow:hidden;opacity:0;animation:artifactIn calc(1s/var(--speed)) 5.25s both}
      .artifact header{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 30px;color:#f8f2ea;border-bottom:1px solid rgba(255,255,255,.08);font:850 20px/1 Inter,sans-serif}.globe{position:absolute;left:50%;top:54%;width:420px;height:420px;border-radius:50%;transform:translate(-50%,-50%);background:radial-gradient(circle at 35% 25%,rgba(255,255,255,.28),transparent 18%),radial-gradient(circle at center,#33433e,#111);box-shadow:0 0 calc(40px + var(--glow)*100px) rgba(217,119,87,.65),inset 0 0 60px rgba(255,255,255,.08);animation:floatY 4s infinite ease-in-out}.arc{position:absolute;border:2px solid rgba(217,119,87,calc(.28 + var(--glow)*.5));border-color:var(--accent) transparent transparent transparent;border-radius:50%;filter:drop-shadow(0 0 18px var(--accent));opacity:calc(.45 + var(--density)*.45)}.a1{left:340px;top:230px;width:360px;height:170px;transform:rotate(-18deg)}.a2{right:310px;top:390px;width:460px;height:210px;transform:rotate(23deg)}.a3{left:520px;bottom:190px;width:420px;height:180px;transform:rotate(8deg)}.city{position:absolute;width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 20px var(--accent);opacity:calc(.45 + var(--density)*.55)}.c1{left:48%;top:43%}.c2{left:56%;top:58%}.c3{left:43%;top:61%}.c4{left:60%;top:44%}
      .tweaks{padding:26px;background:#2b2a27;border-left:1px solid rgba(255,255,255,.08);color:#f6efe5;opacity:0;animation:fadeIn .5s 7.4s both}.tweaks h3{margin:0 0 20px;font:850 24px/1 Inter,sans-serif}.knob{margin:0 0 24px}.knob label{display:flex;justify-content:space-between;margin-bottom:10px;font:750 15px/1 Inter,sans-serif;color:#d9cec0}.track{height:9px;border-radius:999px;background:#494640;overflow:hidden}.track i{display:block;height:100%;background:var(--accent);transform-origin:left;animation:barFill 1.2s 8s both}.knob:nth-child(3) .track i{width:72%}.knob:nth-child(4) .track i{width:58%}.knob:nth-child(5) .track i{width:84%}
      .gallery{position:absolute;inset:0;padding:84px 96px;background:#f4ede1;opacity:0;pointer-events:none;animation:galleryShow calc(6.2s/var(--speed)) 13.4s both}.gallery h2{margin:0 0 34px;font:500 76px/.95 Georgia,serif;letter-spacing:-4px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}.card{height:520px;border-radius:32px;background:#fffaf2;box-shadow:0 22px 70px rgba(54,40,30,.16);padding:28px;display:grid;align-content:space-between;opacity:0;transform:translateY(40px);animation:cardIn .55s both}.card:nth-child(1){animation-delay:14.2s}.card:nth-child(2){animation-delay:14.45s}.card:nth-child(3){animation-delay:14.7s}.card:nth-child(4){animation-delay:14.95s}.thumb{height:330px;border-radius:22px;background:linear-gradient(135deg,#1f1f1e,#4f3729);position:relative;overflow:hidden}.thumb:after{content:'';position:absolute;inset:34px;border-radius:20px;border:2px solid rgba(255,255,255,.18)}.card b{font:850 28px/1 Inter,sans-serif}.card span{font:700 16px/1 Inter,sans-serif;color:var(--accent);letter-spacing:2px;text-transform:uppercase}
      .handoff{position:absolute;left:50%;top:50%;width:760px;padding:38px;border-radius:30px;background:#fffaf2;box-shadow:0 34px 120px rgba(30,20,12,.3);transform:translate(-50%,-50%) scale(.86);opacity:0;animation:modalIn .65s 19.2s both}.handoff h2{margin:0 0 12px;font:850 42px/1 Inter,sans-serif}.handoff p{margin:0 0 28px;font:650 22px/1.35 Inter,sans-serif;color:#746a61}.cmd{padding:18px 20px;border-radius:16px;background:#191817;color:#f8efe5;font:700 20px/1.35 Courier New,monospace}.handoff .button{margin-top:26px;display:inline-block;padding:18px 24px;border-radius:999px;background:var(--accent);font:900 22px/1 Inter,sans-serif;color:#1b1715}
      .cursor{position:absolute;z-index:20;width:28px;height:28px;clip-path:polygon(0 0,0 100%,32% 73%,52% 100%,68% 91%,48% 65%,86% 65%);background:#fff;filter:drop-shadow(0 8px 18px rgba(0,0,0,.32));left:960px;top:540px;opacity:0;animation:cursorPath 18s 4.6s both}.click{position:absolute;z-index:19;width:70px;height:70px;border:3px solid var(--accent);border-radius:50%;opacity:0;left:1450px;top:150px;animation:clickPulse 1s 8.2s both}
      @keyframes fadeUp{from{opacity:0;transform:translateY(34px)}to{opacity:1;transform:translateY(0)}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes titleOut{0%,70%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.96)}}@keyframes workspaceIn{to{opacity:1;transform:scale(1)}}@keyframes workspacePush{0%,100%{transform:scale(1)}50%{transform:scale(1.025) translateY(-6px)}}@keyframes artifactIn{from{opacity:0;transform:translateY(40px) scale(.96)}to{opacity:1;transform:none}}@keyframes floatY{0%,100%{transform:translate(-50%,-50%)}50%{transform:translate(-50%,-54%)}}@keyframes barFill{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes galleryShow{0%,8%{opacity:0}16%,82%{opacity:1}100%{opacity:0}}@keyframes cardIn{to{opacity:1;transform:translateY(0)}}@keyframes modalIn{to{opacity:1;transform:translate(-50%,-50%) scale(1)}}@keyframes cursorPath{0%{opacity:0;left:1010px;top:558px}6%{opacity:1}18%{left:760px;top:270px}32%{left:1452px;top:153px}48%{left:1560px;top:365px}62%{left:430px;top:845px}78%{left:1010px;top:600px}100%{opacity:1;left:1280px;top:740px}}@keyframes clickPulse{0%{opacity:0;transform:scale(.5)}25%{opacity:.85;transform:scale(1)}100%{opacity:0;transform:scale(1.8)}}</style></head><body><main class="stage" data-composition-id="ai-design-studio-launch" data-width="1920" data-height="1080" data-duration="24s" data-frame-rate="60" style="--accent:${accent};--glow:${glow};--density:${density};--speed:${speed}">
      <div class="grain"></div><section class="title-card"><div class="brand-dot"></div><div class="eyebrow">${eyebrow}</div><h1>${product}</h1><p>${headline}</p></section>
      <section class="workspace"><div class="topbar"><div class="traffic"><i></i><i></i><i></i></div><strong>${product}</strong><div class="toolbar"><span class="tool active">Tweaks</span><span class="tool">Comment</span><span class="tool">Edit text</span><span class="tool">Knobs</span><span class="tool">Share</span><span class="tool">Export</span></div></div><div class="columns"><aside class="chat"><h2>Build panel</h2><div class="bubble">${prompt}</div><div class="plan"><div><span class="check">✓</span>Plan product scene</div><div><span class="check">✓</span>Generate artifact</div><div><span class="check">✓</span>Expose controls</div></div></aside><section class="preview"><div class="artifact"><header><span>${artifactTitle}</span><span>Live Preview</span></header><div class="globe"></div><div class="arc a1"></div><div class="arc a2"></div><div class="arc a3"></div><div class="city c1"></div><div class="city c2"></div><div class="city c3"></div><div class="city c4"></div></div></section><aside class="tweaks"><h3>Knobs</h3><div class="knob"><label><span>${panel1}</span><b>${Math.round(glow * 100)}%</b></label><div class="track"><i style="width:${Math.round(glow * 100)}%"></i></div></div><div class="knob"><label><span>${panel2}</span><b>${Math.round(density * 100)}%</b></label><div class="track"><i style="width:${Math.round(density * 100)}%"></i></div></div><div class="knob"><label><span>${panel3}</span><b>${speed.toFixed(2)}x</b></label><div class="track"><i style="width:${Math.round((speed - .5) / 1 * 100)}%"></i></div></div></aside></div></section>
      <section class="gallery"><h2>Generated artifacts,<br>ready to refine.</h2><div class="cards"><article class="card"><div class="thumb"></div><b>${gallery1}</b><span>Prototype</span></article><article class="card"><div class="thumb"></div><b>${gallery2}</b><span>Data story</span></article><article class="card"><div class="thumb"></div><b>${gallery3}</b><span>Brand system</span></article><article class="card"><div class="thumb"></div><b>${gallery4}</b><span>Interactive map</span></article></div></section>
      <section class="handoff"><h2>Send to local coding agent</h2><p>${cta}</p><div class="cmd">prometheus fetch "${artifactTitle}" --implement</div><div class="button">Export handoff</div></section><div class="click"></div><div class="cursor"></div></main></body></html>`;
  },
};

// ---------------- TEMPLATE 24: ascii-logo-reveal ----------------
const asciiLogoReveal: HtmlMotionTemplate = {
  id: 'ascii-logo-reveal',
  name: 'ASCII Logo Reveal',
  description: 'Source-backed ASCII smart-layer reveal with CRT scan, glyph scramble, crisp HTML typography, and CTA lockup.',
  bestFor: 'Logos, product marks, portraits, or screenshots that should resolve from cinematic terminal-style glyphs',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 7000,
  defaultFrameRate: 30,
  requiredInputs: [
    { id: 'brand', label: 'Brand or product name', example: 'Prometheus' },
    { id: 'headline', label: 'Headline', example: 'Video canvas meets ASCII cinema' },
    { id: 'cta', label: 'CTA', example: 'Build the impossible' },
  ],
  optionalInputs: [
    { id: 'sourceAssetId', label: 'Source asset id', description: 'Named HTML motion asset id. Defaults to source.', example: 'source' },
    { id: 'eyebrow', label: 'Eyebrow', example: 'PROMETHEUS LABS' },
    { id: 'accent', label: 'Accent color', example: '#00f0ff' },
    { id: 'glyphSet', label: 'Glyph set', example: 'ascii' },
    { id: 'palette', label: 'Palette', example: 'neon' },
    { id: 'reveal', label: 'Reveal mode', example: 'scramble' },
    { id: 'density', label: 'Density 0.1-1', example: '0.68' },
    { id: 'glitch', label: 'Glitch 0-1', example: '0.22' },
    { id: 'bloom', label: 'Bloom 0-1', example: '0.9' },
  ],
  parameters: [
    { id: 'accent', label: 'Accent', type: 'color', defaultValue: '#00f0ff', target: { lane: 'html-motion', path: 'css.--accent' } },
    { id: 'density', label: 'ASCII density', type: 'range', defaultValue: 0.68, min: 0.1, max: 1, step: 0.01, target: { lane: 'html-motion', path: 'canvas.data-ascii-density' } },
    { id: 'glitch', label: 'Glitch', type: 'range', defaultValue: 0.22, min: 0, max: 1, step: 0.01, target: { lane: 'html-motion', path: 'canvas.data-ascii-glitch' } },
    { id: 'bloom', label: 'Bloom', type: 'range', defaultValue: 0.9, min: 0, max: 1, step: 0.01, target: { lane: 'html-motion', path: 'canvas.data-ascii-bloom' } },
    { id: 'glyphSet', label: 'Glyph set', type: 'select', defaultValue: 'ascii', options: ['ascii', 'binary', 'blocks', 'braille', 'katakana'], target: { lane: 'html-motion', path: 'canvas.data-ascii-glyph-set' } },
  ],
  renderHtml(input) {
    const brand = escapeHtml(pick(input, 'brand', 'Prometheus'));
    const headline = escapeHtml(pick(input, 'headline', 'Video canvas meets ASCII cinema'));
    const cta = escapeHtml(pick(input, 'cta', 'Build the impossible'));
    const eyebrow = escapeHtml(pick(input, 'eyebrow', 'PROMETHEUS LABS'));
    const accent = escapeHtml(pick(input, 'accent', '#00f0ff'));
    const sourceAssetId = pick(input, 'sourceAssetId', 'source');
    const glyphSet = pick(input, 'glyphSet', 'ascii');
    const palette = pick(input, 'palette', 'neon');
    const reveal = pick(input, 'reveal', 'scramble');
    const density = pickNumber(input, 'density', 0.68);
    const glitch = pickNumber(input, 'glitch', 0.22);
    const bloom = pickNumber(input, 'bloom', 0.9);
    const headlineWords = headline.split(/\s+/).filter(Boolean);
    const headlineHtml = headlineWords.length > 1
      ? `${headlineWords.slice(0, -1).join(' ')} <span>${headlineWords[headlineWords.length - 1]}</span>`
      : `<span>${headline}</span>`;
    const ascii = renderAsciiSourceCanvasParts({
      id: 'ascii-logo-source',
      sourceAssetId,
      duration: 7,
      glyphSet,
      palette,
      reveal,
      density,
      glitch,
      bloom,
      fit: 'contain',
    });
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="prometheus:width" content="1080"><meta name="prometheus:height" content="1920"><meta name="prometheus:duration" content="7000"><meta name="prometheus:frameRate" content="30"><style>
      ${baseCss('radial-gradient(circle at 50% 42%, #0d1b22 0%, #030507 48%, #000 100%)')}
      .stage{--accent:${accent};background:#010203;color:#f8fbff;}
      .stage::before{background:radial-gradient(circle at 50% 38%, ${accent}24, transparent 32%),radial-gradient(circle at 20% 78%, rgba(255,43,214,.16), transparent 38%);}
      ${ascii.css}
      .prom-ascii-source{z-index:1;inset:118px 0 318px 0;filter:saturate(1.28) contrast(1.16);}
      .prom-ascii-source::after{content:'';position:absolute;inset:7% 5%;border:1px solid color-mix(in srgb,var(--accent),transparent 70%);box-shadow:inset 0 0 90px color-mix(in srgb,var(--accent),transparent 90%),0 0 42px rgba(0,240,255,.12);pointer-events:none;}
      .hud{position:absolute;z-index:3;left:54px;right:54px;top:68px;height:88px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(255,255,255,.18);border-bottom:1px solid rgba(255,255,255,.18);font:800 22px/1 Courier New,monospace;letter-spacing:.16em;color:var(--accent);animation:fadeIn .5s .15s both;}
      .hud b{color:#fff;text-shadow:0 0 20px var(--accent);}
      .headline{position:absolute;z-index:4;left:64px;right:64px;bottom:252px;margin:0;font:950 86px/.95 Inter,system-ui,sans-serif;letter-spacing:-.035em;text-transform:uppercase;text-shadow:0 0 30px rgba(0,0,0,.82),0 12px 40px #000;animation:fadeUp .72s 3.35s both;}
      .headline span{color:var(--accent);text-shadow:0 0 22px var(--accent);}
      .brand{position:absolute;z-index:4;left:64px;bottom:172px;font:900 38px/1 Inter,system-ui,sans-serif;letter-spacing:.18em;color:#fff;animation:fadeUp .58s 4.35s both;}
      .cta{position:absolute;z-index:4;right:64px;bottom:140px;max-width:450px;padding:24px 30px;border:1px solid color-mix(in srgb,var(--accent),transparent 32%);background:rgba(0,240,255,.11);box-shadow:0 0 42px color-mix(in srgb,var(--accent),transparent 72%);font:850 28px/1.1 Inter,system-ui,sans-serif;text-align:center;color:#fff;animation:scalePop .62s 4.9s both;}
      .progress{position:absolute;z-index:4;left:64px;right:64px;bottom:88px;height:5px;background:rgba(255,255,255,.12);overflow:hidden;}
      .progress i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#ff2bd6,#d4ff3a);transform-origin:left;animation:barFill 6.4s .25s both;}
    </style></head><body><main class="stage" data-composition-id="ascii-logo-reveal" data-width="1080" data-height="1920" data-duration="7s" data-frame-rate="30">
      ${ascii.html}
      <div class="grain"></div>
      <div class="hud" data-role="hud" data-start="0s" data-duration="7s"><span>${eyebrow}</span><b>${brand}</b></div>
      <h1 class="headline" data-role="headline" data-start="3.2s" data-duration="3.8s">${headlineHtml}</h1>
      <div class="brand" data-role="brand" data-start="4.2s" data-duration="2.8s">${brand}</div>
      <div class="cta" data-role="cta" data-start="4.8s" data-duration="2.2s">${cta}</div>
      <div class="progress" data-role="progress" data-start="0s" data-duration="7s"><i></i></div>
      ${ascii.js}
    </main></body></html>`;
  },
};

// ---------------- TEMPLATE 25: ascii-cyber-poster ----------------
const asciiCyberPoster: HtmlMotionTemplate = {
  id: 'ascii-cyber-poster',
  name: 'ASCII Cyber Poster',
  description: 'Vertical event/poster composition with source-backed ASCII field, kinetic title, scan wipes, and lower CTA panel.',
  bestFor: 'Cyber flyers, music/event visuals, launch teasers, source-backed social posters, and terminal-style promos',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 8000,
  defaultFrameRate: 30,
  requiredInputs: [
    { id: 'headline', label: 'Main headline', example: 'ASCII HYPERFRAME' },
    { id: 'subline', label: 'Subline', example: 'source-backed glyph cinema for Prometheus video mode' },
    { id: 'cta', label: 'CTA / date / URL', example: 'LIVE DEMO 05.04' },
  ],
  optionalInputs: [
    { id: 'sourceAssetId', label: 'Source asset id', example: 'source' },
    { id: 'kicker', label: 'Kicker', example: 'NOUS // PROMETHEUS' },
    { id: 'accent', label: 'Accent color', example: '#d4ff3a' },
    { id: 'glyphSet', label: 'Glyph set', example: 'binary' },
    { id: 'palette', label: 'Palette', example: 'inferno' },
    { id: 'reveal', label: 'Reveal mode', example: 'scan' },
  ],
  renderHtml(input) {
    const headline = escapeHtml(pick(input, 'headline', 'ASCII HYPERFRAME'));
    const subline = escapeHtml(pick(input, 'subline', 'source-backed glyph cinema for Prometheus video mode'));
    const cta = escapeHtml(pick(input, 'cta', 'LIVE DEMO 05.04'));
    const kicker = escapeHtml(pick(input, 'kicker', 'NOUS // PROMETHEUS'));
    const accent = escapeHtml(pick(input, 'accent', '#d4ff3a'));
    const ascii = renderAsciiSourceCanvasParts({
      id: 'ascii-poster-source',
      sourceAssetId: pick(input, 'sourceAssetId', 'source'),
      duration: 8,
      glyphSet: pick(input, 'glyphSet', 'binary'),
      palette: pick(input, 'palette', 'inferno'),
      reveal: pick(input, 'reveal', 'scan'),
      density: pickNumber(input, 'density', 0.82),
      glitch: pickNumber(input, 'glitch', 0.62),
      bloom: pickNumber(input, 'bloom', 0.76),
    });
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="prometheus:width" content="1080"><meta name="prometheus:height" content="1920"><meta name="prometheus:duration" content="8000"><meta name="prometheus:frameRate" content="30"><style>
      ${baseCss('#020202')}
      .stage{--accent:${accent};background:linear-gradient(180deg,#020202,#071114 54%,#020202);font-family:Inter,system-ui,sans-serif;}
      ${ascii.css}
      .prom-ascii-source{z-index:1;inset:0;opacity:.92;}
      .poster-vignette{position:absolute;z-index:2;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.86),transparent 22%,transparent 58%,rgba(0,0,0,.95)),radial-gradient(circle at 50% 46%,transparent 0 32%,rgba(0,0,0,.62) 72%);pointer-events:none;}
      .grid{position:absolute;z-index:3;inset:46px;border:1px solid rgba(255,255,255,.18);box-shadow:0 0 0 1px rgba(0,0,0,.4),inset 0 0 80px rgba(255,255,255,.04);pointer-events:none;}
      .kicker{position:absolute;z-index:4;left:64px;right:64px;top:88px;font:850 22px/1 Courier New,monospace;letter-spacing:.22em;color:var(--accent);display:flex;justify-content:space-between;animation:fadeIn .5s .2s both;}
      .title{position:absolute;z-index:4;left:64px;right:64px;bottom:380px;margin:0;font:1000 104px/.82 Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:-.055em;text-shadow:4px 0 #ff2bd6,-4px 0 #00f0ff,0 0 46px rgba(0,0,0,.9);animation:fadeUp .8s 2.55s both;}
      .subline{position:absolute;z-index:4;left:66px;right:66px;bottom:250px;margin:0;font:750 31px/1.22 Inter,system-ui,sans-serif;color:rgba(255,255,255,.82);text-transform:uppercase;letter-spacing:.05em;animation:fadeUp .64s 3.35s both;}
      .cta{position:absolute;z-index:4;left:64px;right:64px;bottom:94px;padding:34px 38px;background:var(--accent);color:#050505;font:950 42px/1 Inter,system-ui,sans-serif;text-align:center;text-transform:uppercase;letter-spacing:.08em;box-shadow:0 0 60px color-mix(in srgb,var(--accent),transparent 48%);animation:scalePop .62s 4.5s both,ctaPulse 1.8s 5.2s infinite;}
      .side{position:absolute;z-index:4;top:250px;bottom:250px;width:24px;color:rgba(255,255,255,.48);font:800 17px/1 Courier New,monospace;letter-spacing:.16em;writing-mode:vertical-rl;text-orientation:mixed;}
      .side.left{left:22px}.side.right{right:22px;transform:rotate(180deg);}
    </style></head><body><main class="stage" data-composition-id="ascii-cyber-poster" data-width="1080" data-height="1920" data-duration="8s" data-frame-rate="30">
      ${ascii.html}
      <div class="poster-vignette"></div><div class="grain"></div><div class="grid"></div>
      <div class="kicker" data-role="kicker" data-start="0s" data-duration="8s"><span>${kicker}</span><span>ASCII VIDEO MODE</span></div>
      <div class="side left">SOURCE BACKED SMART LAYER</div><div class="side right">HTML MOTION EXPORT</div>
      <h1 class="title" data-role="headline" data-start="2.5s" data-duration="5.5s">${headline}</h1>
      <p class="subline" data-role="subline" data-start="3.2s" data-duration="4.8s">${subline}</p>
      <div class="cta" data-role="cta" data-start="4.5s" data-duration="3.5s">${cta}</div>
      ${ascii.js}
    </main></body></html>`;
  },
};

// ---------------- TEMPLATE 26: python-ascii-render-showcase ----------------
const pythonAsciiRenderShowcase: HtmlMotionTemplate = {
  id: 'python-ascii-render-showcase',
  name: 'Python ASCII Render Showcase',
  description: 'Composition wrapper for MP4s rendered by creative_render_ascii_asset: full-bleed terminal-cinema footage with editable HTML typography, HUD, and CTA overlays.',
  bestFor: 'Using the high-quality Python/nous ASCII render lane inside Prometheus Creative Video while keeping overlays editable in HTML Motion',
  defaultWidth: 1080,
  defaultHeight: 1920,
  defaultDurationMs: 7000,
  defaultFrameRate: 30,
  requiredInputs: [
    { id: 'title', label: 'Title', example: 'ASCII CINEMA' },
  ],
  optionalInputs: [
    { id: 'assetId', label: 'Rendered asset id', description: 'Named HTML motion asset id for the Python-rendered MP4.', example: 'ascii_render' },
    { id: 'eyebrow', label: 'Eyebrow', example: 'PROMETHEUS // NOUS' },
    { id: 'subtitle', label: 'Subtitle', example: 'Python render lane + editable HyperFrames overlays' },
    { id: 'cta', label: 'CTA', example: 'Render natively' },
    { id: 'accent', label: 'Accent color', example: '#00f0ff' },
    { id: 'durationSec', label: 'Duration seconds', example: '7' },
  ],
  renderHtml(input) {
    const title = escapeHtml(pick(input, 'title', 'ASCII CINEMA'));
    const eyebrow = escapeHtml(pick(input, 'eyebrow', 'PROMETHEUS // NOUS'));
    const subtitle = escapeHtml(pick(input, 'subtitle', 'Python render lane + editable HyperFrames overlays'));
    const cta = escapeHtml(pick(input, 'cta', 'Render natively'));
    const accent = escapeHtml(pick(input, 'accent', '#00f0ff'));
    const duration = Math.max(1, Math.min(120, pickNumber(input, 'durationSec', 7)));
    const rawAssetId = pick(input, 'assetId', 'ascii_render')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'ascii_render';
    const assetSrc = `{{asset.${rawAssetId}}}`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      *,*::before,*::after{box-sizing:border-box}
      html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#020506}
      body{font-family:Inter,Manrope,-apple-system,"Segoe UI",Arial,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
      .stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:#020506;--accent:${accent}}
      .ascii-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#020506}
      .veil{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,.42),transparent 22%,transparent 64%,rgba(0,0,0,.72)),radial-gradient(circle at 50% 42%,transparent 36%,rgba(0,0,0,.52) 84%)}
      .scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(to bottom,rgba(255,255,255,.08) 0 1px,transparent 1px 5px);mix-blend-mode:screen;opacity:.55}
      .hud{position:absolute;left:56px;right:56px;top:58px;display:flex;align-items:center;justify-content:space-between;font:800 22px/1 "Consolas","SFMono-Regular",monospace;letter-spacing:0;color:var(--accent);text-transform:uppercase;text-shadow:0 0 18px color-mix(in srgb,var(--accent),transparent 35%)}
      .hud::after{content:"PY_RENDER";border:1px solid color-mix(in srgb,var(--accent),transparent 35%);padding:8px 12px;color:#dff;font-size:18px;background:rgba(0,0,0,.28)}
      .lockup{position:absolute;left:64px;right:64px;bottom:126px}
      h1{margin:0 0 18px;font-size:106px;line-height:.92;font-weight:950;letter-spacing:0;text-transform:uppercase;text-wrap:balance;text-shadow:0 0 24px rgba(0,240,255,.56),0 0 42px rgba(255,43,214,.42)}
      .subtitle{max-width:780px;margin:0 0 38px;font-size:34px;line-height:1.12;font-weight:760;color:rgba(238,252,255,.9)}
      .cta{display:inline-flex;align-items:center;min-height:72px;padding:0 24px;border:1px solid color-mix(in srgb,var(--accent),transparent 20%);background:rgba(0,0,0,.42);box-shadow:0 0 28px color-mix(in srgb,var(--accent),transparent 70%);font-size:25px;font-weight:900;color:#f7ffff;text-transform:uppercase}
      .progress{position:absolute;left:64px;right:64px;bottom:72px;height:5px;background:rgba(255,255,255,.16);overflow:hidden}
      .progress i{display:block;height:100%;width:100%;background:linear-gradient(90deg,var(--accent),#ff2bd6,#d4ff3a);transform-origin:left;animation:bar ${duration}s linear both}
      @keyframes bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    </style></head><body><main class="stage" data-composition-id="python-ascii-render-showcase" data-width="1080" data-height="1920" data-duration="${duration}s" data-frame-rate="30">
      <video id="ascii-render-video" class="ascii-video" src="${escapeHtml(assetSrc)}" data-role="python-ascii-render" data-start="0s" data-duration="${duration}s" muted playsinline preload="auto"></video>
      <div class="veil"></div><div class="scan"></div>
      <div id="ascii-render-hud" class="hud" data-role="hud" data-start="0s" data-duration="${duration}s">${eyebrow}</div>
      <section id="ascii-render-lockup" class="lockup" data-role="lockup" data-start="0s" data-duration="${duration}s"><h1 id="ascii-render-title">${title}</h1><p id="ascii-render-subtitle" class="subtitle" data-role="subtitle" data-start=".55s" data-duration="${Math.max(0.45, duration - 0.55)}s">${subtitle}</p><div id="ascii-render-cta" class="cta" data-role="cta" data-start="${Math.max(0, duration - 2.6)}s" data-duration="2.6s">${cta}</div></section>
      <div id="ascii-render-progress" class="progress" data-role="progress" data-start="0s" data-duration="${duration}s"><i></i></div>
    </main><script>
      (function(){
        var video=document.getElementById('ascii-render-video');
        var duration=${duration};
        function time(){return Number(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__||0)}
        function sync(){
          if(!video||!isFinite(video.duration))return;
          var t=Math.max(0,Math.min(duration,time()));
          if(Math.abs(video.currentTime-t)>.045){try{video.currentTime=Math.min(video.duration-.04,t)}catch(e){}}
        }
        window.addEventListener('prometheus-html-motion-seek',sync);
        video&&video.addEventListener('loadedmetadata',sync);
        setInterval(sync,80);
      })();
    </script></body></html>`;
  },
};

const ALL_TEMPLATES: HtmlMotionTemplate[] = [
  startupProductPromo,
  boldTiktokCaption,
  saasFeatureLaunch,
  appDemoCard,
  testimonialSocialProof,
  eventOrOfferAd,
  minimalEditorialQuote,
  beforeAfterReveal,
  stepByStepTutorial,
  statBombReel,
  podcastEpisodePromo,
  recipeCardVertical,
  comingSoonTeaser,
  newsHeadlineFlash,
  featureComparisonVs,
  glitchCyberPromo,
  ugcReviewCard,
  aiWorkflowDemo,
  aiDesignStudioLaunch,
  localBusinessSpotlight,
  courseLessonPromo,
  squareFeedAnnouncement,
  youtubeIntroPromo,
  asciiLogoReveal,
  asciiCyberPoster,
  pythonAsciiRenderShowcase,
];

const TEMPLATE_BY_ID = new Map<string, HtmlMotionTemplate>(
  ALL_TEMPLATES.map((t) => [t.id, t] as const),
);

export function listHtmlMotionTemplates(): HtmlMotionTemplate[] {
  return ALL_TEMPLATES.slice();
}

export function getHtmlMotionTemplate(id: string): HtmlMotionTemplate | null {
  if (!id) return null;
  return TEMPLATE_BY_ID.get(String(id).trim()) || null;
}

function summarizeHtmlMotionTemplate(t: HtmlMotionTemplate, source: 'builtin' | 'custom' = 'builtin') {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    bestFor: t.bestFor,
    defaultWidth: t.defaultWidth,
    defaultHeight: t.defaultHeight,
    defaultDurationMs: t.defaultDurationMs,
    defaultFrameRate: t.defaultFrameRate,
    requiredInputs: t.requiredInputs,
    optionalInputs: t.optionalInputs,
    parameters: t.parameters || [],
    source,
  };
}

export function summarizeHtmlMotionTemplates(storage?: CreativeStorageLike | null) {
  const builtin = ALL_TEMPLATES.map((t) => summarizeHtmlMotionTemplate(t, 'builtin'));
  const custom = listCustomHtmlMotionTemplates(storage).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    bestFor: t.bestFor,
    defaultWidth: t.defaultWidth,
    defaultHeight: t.defaultHeight,
    defaultDurationMs: t.defaultDurationMs,
    defaultFrameRate: t.defaultFrameRate,
    requiredInputs: t.requiredInputs,
    optionalInputs: t.optionalInputs,
    parameters: t.parameters || [],
    source: 'custom' as const,
    manifestPath: t.manifestPath || null,
    manifestPathRelative: t.manifestPathRelative || null,
  }));
  return [...builtin, ...custom];
}

export function applyHtmlMotionTemplate(templateId: string, input: HtmlMotionTemplateInput = {}, storage?: CreativeStorageLike | null) {
  const tmpl = getHtmlMotionTemplate(templateId);
  if (!tmpl) {
    const custom = getCustomHtmlMotionTemplate(storage, templateId);
    if (!custom) throw new Error(`Unknown HTML motion template: ${templateId}`);
    const mergedInput = { ...(custom.defaultInputs || {}), ...(input || {}) };
    const missing = custom.requiredInputs
      .filter((spec) => !pick(mergedInput, spec.id))
      .map((spec) => spec.id);
    if (missing.length) {
      throw new Error(`Template ${templateId} is missing required inputs: ${missing.join(', ')}`);
    }
    return {
      template: {
        id: custom.id,
        name: custom.name,
        description: custom.description,
        bestFor: custom.bestFor,
        source: 'custom',
        manifestPath: custom.manifestPath || null,
        manifestPathRelative: custom.manifestPathRelative || null,
      },
      parameters: custom.parameters || [],
      html: renderTemplatePlaceholders(custom.html, mergedInput),
      width: custom.defaultWidth,
      height: custom.defaultHeight,
      durationMs: custom.defaultDurationMs,
      frameRate: custom.defaultFrameRate,
      title: pick(mergedInput, 'title') || custom.name,
    };
  }
  const missing = tmpl.requiredInputs
    .filter((spec) => !pick(input, spec.id))
    .map((spec) => spec.id);
  if (missing.length) {
    throw new Error(`Template ${templateId} is missing required inputs: ${missing.join(', ')}`);
  }
  return {
    template: {
      id: tmpl.id,
      name: tmpl.name,
      description: tmpl.description,
      bestFor: tmpl.bestFor,
      source: 'builtin',
    },
    parameters: tmpl.parameters || [],
    html: tmpl.renderHtml(input),
    width: tmpl.defaultWidth,
    height: tmpl.defaultHeight,
    durationMs: tmpl.defaultDurationMs,
    frameRate: tmpl.defaultFrameRate,
    title: pick(input, 'title') || tmpl.name,
  };
}
