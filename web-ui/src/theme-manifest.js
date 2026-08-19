/**
 * Prometheus Theme System v2 manifest.
 *
 * This file is data/translation only. Shipping themes keep their existing CSS
 * paint paths; these definitions are the canonical semantic description used
 * by future themes and adapters.
 */

export const THEME_SCHEMA_VERSION = 2;

const STATUS = Object.freeze({ success: '#4ade80', warning: '#fbbf24', danger: '#f87171' });

export const THEME_PRESETS = Object.freeze([
  {
    id: 'light', label: 'Prometheus One', base: 'dark', legacyProfile: 'light',
    description: 'Black & gold · shared P1 shell',
    colors: {
      background: '#050505', backgroundSoft: '#0d0d0c', surface: '#0b0b0a', surfaceStrong: '#151411',
      text: '#f2ebdd', textMuted: '#aaa294', border: 'rgba(214, 183, 94, .14)', borderStrong: 'rgba(214, 183, 94, .27)',
      accent: '#d6b75e', accentStrong: '#9b7d32', accentLight: '#f0d98b', ...STATUS,
    },
    mobile: {
      background: '#0b0b0d', backgroundSoft: '#111113', surface: '#1c1c1f', surfaceStrong: '#242427', popover: '#46464b',
      text: '#f4f4f5', textSoft: '#d4d4d8', textMuted: '#9ca3af', accent: '#d6b75e', accentSoft: 'rgba(214, 183, 94, .14)', accentStrong: '#9b7d32',
    },
    atmosphere: [5, 5, 5], preview: ['#050505', '#15130f', '#d6b75e'],
  },
  {
    id: 'gray', label: 'Ash & Ember', base: 'dark', legacyProfile: 'gray',
    description: 'Light graphite & ember · shared P1 shell',
    colors: {
      background: '#2e2e2e', backgroundSoft: '#363636', surface: '#3d3d3d', surfaceStrong: '#484848',
      text: '#f1eee8', textMuted: '#aaa49a', border: 'rgba(255, 255, 255, .12)', borderStrong: 'rgba(255, 255, 255, .20)',
      accent: '#f97316', accentStrong: '#c2410c', accentLight: '#fb923c', ...STATUS,
    },
    mobile: {
      background: '#2e2e2e', backgroundSoft: '#363636', surface: '#3d3d3d', surfaceStrong: '#484848', popover: '#555555',
      text: '#f1eee8', textSoft: '#ddd8cf', textMuted: '#aaa49a', accent: '#f97316', accentSoft: 'rgba(249, 115, 22, .15)', accentStrong: '#c2410c',
    },
    atmosphere: [46, 46, 46], preview: ['#2e2e2e', '#3d3d3d', '#f97316'],
  },
  {
    id: 'dark', label: 'Default Dark', base: 'dark', legacyProfile: 'dark',
    description: 'Warm graphite · shared P1 shell',
    colors: {
      background: '#1a1a1a', backgroundSoft: '#222222', surface: '#2a2a2a', surfaceStrong: '#313131',
      text: '#e8e6e1', textMuted: '#9a9890', border: 'rgba(255, 255, 255, .10)', borderStrong: 'rgba(255, 255, 255, .16)',
      accent: '#f97316', accentStrong: '#c2410c', accentLight: '#fb923c', ...STATUS,
    },
    mobile: {
      background: '#0b0b0d', backgroundSoft: '#111113', surface: '#1c1c1f', surfaceStrong: '#242427', popover: '#46464b',
      text: '#f4f4f5', textSoft: '#d4d4d8', textMuted: '#9ca3af', accent: '#ea6a1f', accentSoft: 'rgba(234, 106, 31, .14)', accentStrong: '#c0541a',
    },
    atmosphere: [26, 26, 26], preview: ['#1a1a1a', '#2a2a2a', '#f97316'],
  },
  {
    id: 'blue', label: 'Olympian Blue', base: 'dark', legacyProfile: 'blue',
    description: 'Electric navy · shared P1 shell',
    colors: {
      background: '#07101f', backgroundSoft: '#0c1730', surface: '#122444', surfaceStrong: '#16294e',
      text: '#dde8ff', textMuted: '#8da3c9', border: 'rgba(120, 170, 255, .12)', borderStrong: 'rgba(120, 170, 255, .22)',
      accent: '#3d8bff', accentStrong: '#1e5fd0', accentLight: '#6fb0ff', ...STATUS,
    },
    mobile: {
      background: '#122444', backgroundSoft: '#16294e', surface: '#1b3765', surfaceStrong: '#254a7d', popover: '#2b4d7a',
      text: '#dde8ff', textSoft: '#b8c9ee', textMuted: '#8da5ca', accent: '#3d8bff', accentSoft: 'rgba(61, 139, 255, .14)', accentStrong: '#256fd8',
    },
    atmosphere: [6, 13, 30], preview: ['#07101f', '#122444', '#3d8bff'],
  },
  {
    id: 'purple', label: 'Aether Violet', base: 'dark', legacyProfile: 'purple',
    description: 'Deep violet · shared P1 shell',
    colors: {
      background: '#0c0518', backgroundSoft: '#150a28', surface: '#1e1138', surfaceStrong: '#261545',
      text: '#e8ddff', textMuted: '#a892cf', border: 'rgba(170, 120, 255, .12)', borderStrong: 'rgba(170, 120, 255, .22)',
      accent: '#8b5cf6', accentStrong: '#6d28d9', accentLight: '#b794ff', ...STATUS,
    },
    mobile: {
      background: '#1e1138', backgroundSoft: '#261545', surface: '#33205b', surfaceStrong: '#432d73', popover: '#4c3472',
      text: '#e8ddff', textSoft: '#d4c6ea', textMuted: '#ab9dc7', accent: '#8b5cf6', accentSoft: 'rgba(139, 92, 246, .14)', accentStrong: '#6d3fd8',
    },
    atmosphere: [10, 4, 24], preview: ['#0c0518', '#1e1138', '#8b5cf6'],
  },
]);

export const PRESET_BY_ID = new Map(THEME_PRESETS.map((theme) => [theme.id, theme]));

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function hex(value, fallback) {
  const text = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
}
export function rgb(value) {
  const h = hex(value, '#000000').slice(1);
  return [0, 2, 4].map((offset) => parseInt(h.slice(offset, offset + 2), 16));
}
export function rgba(value, alpha) {
  const [r, g, b] = rgb(value);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, Number(alpha) || 0)).toFixed(3)})`;
}
export function mix(first, second, amount) {
  const a = rgb(first); const b = rgb(second); const t = Math.max(0, Math.min(1, Number(amount) || 0));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export function normalizeTheme(raw, fallback = PRESET_BY_ID.get('dark')) {
  const source = object(raw); const c = object(source.colors); const m = object(source.mobile); const f = fallback.colors;
  const background = hex(c.background, f.background); const text = hex(c.text, f.text); const accent = hex(c.accent, f.accent);
  const backgroundSoft = hex(c.backgroundSoft, mix(background, text, .055));
  const surface = hex(c.surface, mix(background, text, .10));
  const surfaceStrong = hex(c.surfaceStrong, mix(background, text, .16));
  const textMuted = hex(c.textMuted, mix(text, background, .46));
  const accentStrong = hex(c.accentStrong, mix(accent, background, .34));
  const accentLight = hex(c.accentLight, mix(accent, text, .28));
  const id = String(source.id || 'custom-theme').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-theme';
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    id, label: String(source.label || id).trim().slice(0, 80) || id,
    base: source.base === 'light' ? 'light' : 'dark',
    legacyProfile: PRESET_BY_ID.has(source.legacyProfile) ? source.legacyProfile : 'custom',
    description: String(source.description || 'Custom Prometheus palette').trim().slice(0, 180),
    colors: {
      background, backgroundSoft, surface, surfaceStrong, text, textMuted,
      border: String(c.border || rgba(text, .12)), borderStrong: String(c.borderStrong || rgba(text, .22)),
      accent, accentStrong, accentLight,
      success: hex(c.success, STATUS.success), warning: hex(c.warning, STATUS.warning), danger: hex(c.danger, STATUS.danger),
    },
    mobile: {
      background: hex(m.background, background), backgroundSoft: hex(m.backgroundSoft, backgroundSoft),
      surface: hex(m.surface, surface), surfaceStrong: hex(m.surfaceStrong, surfaceStrong), popover: hex(m.popover, surfaceStrong),
      text: hex(m.text, text), textSoft: hex(m.textSoft, mix(text, background, .18)), textMuted: hex(m.textMuted, textMuted),
      accent: hex(m.accent, accent), accentSoft: String(m.accentSoft || rgba(accent, .14)), accentStrong: hex(m.accentStrong, accentStrong),
    },
    atmosphere: Array.isArray(source.atmosphere) && source.atmosphere.length === 3 ? source.atmosphere : rgb(background),
    preview: Array.isArray(source.preview) && source.preview.length === 3 ? source.preview : [background, surface, accent],
  };
}

export function toLegacyVariables(themeInput) {
  const theme = normalizeTheme(themeInput); const c = theme.colors; const m = theme.mobile;
  return {
    '--bg': c.background, '--bg-soft': c.backgroundSoft, '--panel': c.surface, '--panel-2': c.surfaceStrong,
    '--line': c.border, '--line-strong': c.borderStrong, '--text': c.text, '--fg': c.text, '--muted': c.textMuted,
    '--brand': c.accent, '--brand-2': c.accentStrong, '--ok': c.success, '--warn': c.warning, '--err': c.danger,
    '--flame': c.accent, '--flame-mid': c.accentLight, '--flame-glow': rgba(c.accent, .22), '--flame-border': rgba(c.accent, .48),
    '--sidebar-bg': rgba(c.background, .82), '--sidebar-text': c.text, '--sidebar-muted': c.textMuted,
    '--sidebar-icon-bg': rgba(c.text, .08), '--sidebar-icon-border': rgba(c.text, .14), '--sidebar-item-bg': rgba(c.text, .05),
    '--sidebar-item-hover': rgba(c.accent, .14), '--sidebar-active-bg': rgba(c.accent, .20), '--sidebar-search-bg': rgba(c.text, .07),
    '--sidebar-seg-bg': rgba(c.text, .07), '--sidebar-seg-active': rgba(c.accent, .18),
    '--composer-bg': rgba(c.background, .86), '--composer-panel': rgba(c.surface, .88), '--composer-input': rgba(c.surfaceStrong, .90),
    '--composer-border': rgba(c.text, .14), '--composer-text': c.text, '--composer-muted': rgba(c.text, .58),
    '--pm-orange': c.accent, '--pm-orange-hot': c.accentLight, '--pm-ember': mix(c.accent, c.background, .64), '--pm-gold': c.accentLight,
    '--pm-shell-surface': c.background, '--pm-shell-accent': c.accent, '--pm-shell-accent-light': c.accentLight, '--pm-shell-accent-muted': c.accentStrong,
    '--pm-chat-page-bg': c.background, '--pm-unread-chat-bg': mix(c.surface, c.accent, .16), '--pm-pinned-chat-bg': c.surfaceStrong, '--pm-studio-surface': c.surface,
    '--pm-bg': m.background, '--pm-bg-soft': m.backgroundSoft, '--pm-surface': m.surface, '--pm-surface-strong': m.surfaceStrong,
    '--pm-ios-popover-base': m.popover, '--pm-border': c.border, '--pm-border-strong': c.borderStrong,
    '--pm-text': m.text, '--pm-text-soft': m.textSoft, '--pm-muted': m.textMuted,
    '--pm-accent': m.accent, '--pm-accent-soft': m.accentSoft, '--pm-accent-dark': m.accentStrong,
    '--pm-orange-soft': m.accentSoft, '--pm-orange-dark': m.accentStrong,
  };
}
