import './performance.js';

/**
 * app.js — F1 Scaffold
 *
 * Application init: theme, boot sequence, setMode page switching.
 *
 * This module is loaded LAST (after all page modules register their
 * WS handlers and expose their functions). It kicks off the boot
 * sequence that was previously inline at the bottom of the <script> block.
 *
 * During migration, this module coexists with the inline <script>.
 * Functions here are also exposed on window.* so the inline HTML
 * onclick handlers continue to work.
 *
 * Usage:
 *   <script type="module" src="src/app.js"></script>
 */

import { state, THEME_KEY, APPEARANCE_KEY } from './state.js';
import { runIfNeeded as runOnboardingIfNeeded } from './onboarding/onboarding-controller.js';
import { initGlobalShortcuts } from './shortcuts.js';
import { formatModelDisplayName, formatModelWithReasoning, relabelModelSelect } from './model-display.js';
import './link-router.js';

initGlobalShortcuts();

window.formatModelDisplayName = formatModelDisplayName;
window.formatModelWithReasoning = formatModelWithReasoning;
window.relabelModelSelect = relabelModelSelect;

for (const [id, provider] of [
  ['settings-openai-model', 'openai'],
  ['settings-codex-model', 'openai_codex'],
]) {
  relabelModelSelect(document.getElementById(id), provider);
}

// Theme registry is defined in index.html (window.PROM_THEMES) so it loads
// before any script. Fall back to dark/light if it is somehow unavailable.
const APPEARANCE_DEFAULTS = Object.freeze({
  backgroundEffects: false,
  backgroundOpacity: 0.82,
});

const CUSTOM_THEME_DEFAULTS = Object.freeze({
  light: {
    accent: '#d6b75e', background: '#050505', foreground: '#f2ebdd',
    font: 'Manrope', translucentSidebar: true, contrast: 60, sourceTheme: 'light',
  },
  dark: {
    accent: '#f97316', background: '#1a1a1a', foreground: '#e8e6e1',
    font: 'Manrope', translucentSidebar: true, contrast: 60, sourceTheme: 'dark',
  },
  blue: {
    accent: '#3d8bff', background: '#07101f', foreground: '#dde8ff',
    font: 'Manrope', translucentSidebar: true, contrast: 60, sourceTheme: 'blue',
  },
  purple: {
    accent: '#8b5cf6', background: '#0c0518', foreground: '#e8ddff',
    font: 'Manrope', translucentSidebar: true, contrast: 60, sourceTheme: 'purple',
  },
  gray: {
    accent: '#f97316', background: '#2e2e2e', foreground: '#f1eee8',
    font: 'Manrope', translucentSidebar: true, contrast: 60, sourceTheme: 'gray',
  },
});

const APPEARANCE_FONT_OPTIONS = new Set(['Manrope', 'Inter', 'IBM Plex Sans', 'system-ui', 'Georgia']);
const CUSTOM_STYLE_PROPS = [
  '--bg', '--bg-soft', '--panel', '--panel-2', '--line', '--line-strong', '--text', '--fg', '--muted',
  '--brand', '--brand-2', '--flame', '--flame-mid', '--flame-glow', '--flame-border',
  '--sidebar-bg', '--sidebar-text', '--sidebar-muted', '--sidebar-icon-bg', '--sidebar-icon-border',
  '--sidebar-item-bg', '--sidebar-item-hover', '--sidebar-active-bg', '--sidebar-search-bg',
  '--sidebar-seg-bg', '--sidebar-seg-active', '--composer-bg', '--composer-panel', '--composer-input',
  '--composer-border', '--composer-text', '--composer-muted', '--pm-orange', '--pm-orange-hot',
  '--pm-ember', '--pm-gold', '--pm-chat-page-bg', '--pm-unread-chat-bg', '--pm-pinned-chat-bg',
  '--pm-custom-font', '--pm-custom-accent', '--pm-custom-background',
  '--pm-custom-foreground', '--pm-custom-contrast',
];

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeHex(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function normalizeCustomTheme(raw, fallback = CUSTOM_THEME_DEFAULTS.light) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = fallback || CUSTOM_THEME_DEFAULTS.light;
  const font = APPEARANCE_FONT_OPTIONS.has(source.font) ? source.font : base.font;
  return {
    accent: normalizeHex(source.accent, base.accent),
    background: normalizeHex(source.background, base.background),
    foreground: normalizeHex(source.foreground, base.foreground),
    font,
    translucentSidebar: source.translucentSidebar !== false,
    contrast: Math.round(clampNumber(source.contrast, 0, 100, base.contrast)),
    sourceTheme: getThemeList().some((theme) => theme.id === source.sourceTheme) ? source.sourceTheme : base.sourceTheme,
  };
}

function normalizeAppearancePreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    backgroundEffects: source.backgroundEffects === true,
    backgroundOpacity: clampNumber(source.backgroundOpacity, 0, 1, APPEARANCE_DEFAULTS.backgroundOpacity),
    custom: normalizeCustomTheme(source.custom, CUSTOM_THEME_DEFAULTS.light),
  };
}

function readAppearancePreferences() {
  try {
    return normalizeAppearancePreferences(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}'));
  } catch {
    return normalizeAppearancePreferences({});
  }
}

function writeAppearancePreferences(preferences) {
  const normalized = normalizeAppearancePreferences(preferences);
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(normalized)); } catch {}
  return normalized;
}

function getThemeList() {
  return (window.PROM_THEMES && window.PROM_THEMES.length)
    ? window.PROM_THEMES
    : [{ id: 'light', label: 'Prometheus One', base: 'dark' }, { id: 'dark', label: 'Default Dark', base: 'dark' }];
}

function resolveTheme(id) {
  const list = getThemeList();
  return list.find((t) => t.id === id) || list[0];
}

function nextThemeId(currentId) {
  const list = getThemeList();
  const idx = list.findIndex((t) => t.id === currentId);
  return list[(idx < 0 ? 0 : idx + 1) % list.length].id;
}

function hexRgb(hex) {
  const value = normalizeHex(hex, '#000000').slice(1);
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function rgba(hex, alpha) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clampNumber(alpha, 0, 1, 1).toFixed(3)})`;
}

function mixHex(first, second, amount) {
  const a = hexRgb(first);
  const b = hexRgb(second);
  const t = clampNumber(amount, 0, 1, 0.5);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * t).toString(16).padStart(2, '0')).join('')}`;
}

function presetCustomDefaults(themeId) {
  return normalizeCustomTheme(CUSTOM_THEME_DEFAULTS[themeId] || CUSTOM_THEME_DEFAULTS.light, CUSTOM_THEME_DEFAULTS.light);
}

function customDraftForCurrentTheme(preferences) {
  const activeId = document.documentElement.getAttribute('data-skin') || 'light';
  if (activeId === 'custom') return normalizeCustomTheme(preferences.custom, preferences.custom);
  return presetCustomDefaults(activeId);
}

function clearCustomThemeVariables() {
  const root = document.documentElement;
  CUSTOM_STYLE_PROPS.forEach((property) => root.style.removeProperty(property));
}

function applyCustomThemeVariables(custom) {
  const root = document.documentElement;
  const background = custom.background;
  const foreground = custom.foreground;
  const accent = custom.accent;
  const contrast = custom.contrast / 100;
  const panel = mixHex(background, foreground, 0.08 + contrast * 0.10);
  const panel2 = mixHex(background, foreground, 0.13 + contrast * 0.13);
  const bgSoft = mixHex(background, foreground, 0.045 + contrast * 0.07);
  const muted = mixHex(foreground, background, 0.48);
  const fontStack = custom.font === 'system-ui'
    ? 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    : `'${custom.font}', sans-serif`;

  root.style.setProperty('--pm-custom-font', fontStack);
  root.style.setProperty('--pm-custom-accent', accent);
  root.style.setProperty('--pm-custom-background', background);
  root.style.setProperty('--pm-custom-foreground', foreground);
  root.style.setProperty('--pm-custom-contrast', `${custom.contrast}%`);
  root.style.setProperty('--bg', background);
  root.style.setProperty('--bg-soft', bgSoft);
  root.style.setProperty('--panel', panel);
  root.style.setProperty('--panel-2', panel2);
  root.style.setProperty('--line', rgba(foreground, 0.12));
  root.style.setProperty('--line-strong', rgba(foreground, 0.24));
  root.style.setProperty('--text', foreground);
  root.style.setProperty('--fg', foreground);
  root.style.setProperty('--muted', muted);
  root.style.setProperty('--brand', accent);
  root.style.setProperty('--brand-2', mixHex(accent, background, 0.72));
  root.style.setProperty('--flame', accent);
  root.style.setProperty('--flame-mid', mixHex(accent, foreground, 0.28));
  root.style.setProperty('--flame-glow', rgba(accent, 0.22));
  root.style.setProperty('--flame-border', rgba(accent, 0.48));
  root.style.setProperty('--sidebar-bg', custom.translucentSidebar ? rgba(background, 0.78) : panel);
  root.style.setProperty('--sidebar-text', foreground);
  root.style.setProperty('--sidebar-muted', muted);
  root.style.setProperty('--sidebar-icon-bg', rgba(foreground, 0.08));
  root.style.setProperty('--sidebar-icon-border', rgba(foreground, 0.14));
  root.style.setProperty('--sidebar-item-bg', rgba(foreground, 0.05));
  root.style.setProperty('--sidebar-item-hover', rgba(accent, 0.14));
  root.style.setProperty('--sidebar-active-bg', rgba(accent, 0.20));
  root.style.setProperty('--sidebar-search-bg', rgba(foreground, 0.07));
  root.style.setProperty('--sidebar-seg-bg', rgba(foreground, 0.07));
  root.style.setProperty('--sidebar-seg-active', rgba(accent, 0.18));
  const unreadChatBackground = mixHex(panel, accent, 0.18);
  root.style.setProperty('--pm-chat-page-bg', unreadChatBackground);
  root.style.setProperty('--pm-unread-chat-bg', unreadChatBackground);
  root.style.setProperty('--pm-pinned-chat-bg', panel2);
  root.style.setProperty('--composer-bg', panel2);
  root.style.setProperty('--composer-panel', panel2);
  root.style.setProperty('--composer-input', panel2);
  root.style.setProperty('--composer-border', rgba(foreground, 0.14));
  root.style.setProperty('--composer-text', foreground);
  root.style.setProperty('--composer-muted', rgba(foreground, 0.58));
  root.style.setProperty('--pm-orange', accent);
  root.style.setProperty('--pm-orange-hot', mixHex(accent, foreground, 0.2));
  root.style.setProperty('--pm-ember', mixHex(accent, background, 0.72));
  root.style.setProperty('--pm-gold', mixHex(accent, foreground, 0.35));
}

function applyBackgroundPreferences(preferences, skinId = document.documentElement.getAttribute('data-skin') || 'dark') {
  const root = document.documentElement;
  const normalized = normalizeAppearancePreferences(preferences);
  const palette = {
    light: [5, 5, 5],
    gray: [46, 46, 46],
    dark: [26, 26, 26],
    blue: [6, 13, 30],
    purple: [10, 4, 24],
    custom: hexRgb(normalized.custom.background),
  }[skinId] || [26, 26, 26];
  const overlayAlpha = (1 - normalized.backgroundOpacity).toFixed(3);
  root.setAttribute('data-background-visuals', normalized.backgroundEffects ? 'on' : 'off');
  root.style.setProperty('--pm-background-opacity', String(normalized.backgroundOpacity));
  root.style.setProperty('--pm-background-overlay', `rgba(${palette[0]}, ${palette[1]}, ${palette[2]}, ${overlayAlpha})`);
}

function dispatchAppearanceChange(theme) {
  try {
    document.dispatchEvent(new CustomEvent('prom-theme-change', { detail: { id: theme.id, base: theme.base } }));
    document.dispatchEvent(new CustomEvent('prom-appearance-change', { detail: { id: theme.id, base: theme.base } }));
  } catch {}
  syncElectronTitlebarTheme();
}

// Windows/Linux render the native caption buttons inside Electron's titlebar
// overlay. Feed that overlay the same surface/text colors as the active UI so
// the native controls follow named and custom Prometheus themes. macOS traffic
// lights remain system-rendered and are intentionally left untouched.
function syncElectronTitlebarTheme() {
  const bridge = window.prometheusApp;
  if (!bridge?.isElectron || typeof bridge.setTitleBarTheme !== 'function') return;
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  // Use the opaque panel token rather than the translucent sidebar token.
  // Windows' native overlay compositor can turn translucent titlebar colors
  // into a light rectangle, especially on frameless windows.
  const color = styles.getPropertyValue('--panel').trim()
    || styles.getPropertyValue('--bg').trim();
  const symbolColor = styles.getPropertyValue('--text').trim()
    || styles.getPropertyValue('--fg').trim();
  if (!color || !symbolColor) return;
  Promise.resolve(bridge.setTitleBarTheme({ color, symbolColor })).catch(() => {});
}

function updateThemeToggle(themeId, themeBase, themeLabel) {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const next = resolveTheme(nextThemeId(themeId));
  const label = themeLabel || (themeId === 'custom' ? 'Custom theme' : resolveTheme(themeId).label);
  const title = 'Theme: ' + label + ' — click for ' + next.label;
  toggle.setAttribute('data-theme-state', themeBase || 'dark');
  toggle.title = title;
  toggle.setAttribute('aria-label', title);
}

export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'custom') return saved;
    if (saved && getThemeList().some((t) => t.id === saved)) return saved;
  } catch {}
  return 'light';
}

function applyCustomTheme(customTheme, { persist = true } = {}) {
  const preferences = readAppearancePreferences();
  const custom = normalizeCustomTheme(customTheme, preferences.custom);
  preferences.custom = custom;
  if (persist) writeAppearancePreferences(preferences);
  clearCustomThemeVariables();
  applyCustomThemeVariables(custom);
  const root = document.documentElement;
  root.setAttribute('data-theme', 'dark');
  root.setAttribute('data-skin', 'custom');
  try { localStorage.setItem(THEME_KEY, 'custom'); } catch {}
  applyBackgroundPreferences(preferences, 'custom');
  updateThemeToggle('custom', 'dark', 'Custom theme');
  dispatchAppearanceChange({ id: 'custom', base: 'dark' });
  renderThemePicker();
  syncAppearanceSettingsForm();
}

export function applyTheme(themeId) {
  if (themeId === 'custom') {
    applyCustomTheme(readAppearancePreferences().custom);
    return;
  }
  const theme = resolveTheme(themeId);
  clearCustomThemeVariables();
  document.documentElement.setAttribute('data-theme', theme.base);
  document.documentElement.setAttribute('data-skin', theme.id);
  try { localStorage.setItem(THEME_KEY, theme.id); } catch {}
  const preferences = readAppearancePreferences();
  applyBackgroundPreferences(preferences, theme.id);
  updateThemeToggle(theme.id, theme.base, theme.label);
  dispatchAppearanceChange(theme);
  renderThemePicker();
  syncAppearanceSettingsForm();
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-skin')
    || document.documentElement.getAttribute('data-theme')
    || 'dark';
  applyTheme(nextThemeId(current));
}

// Select a specific theme by id (used by the Settings appearance picker).
export function selectTheme(themeId) {
  applyTheme(themeId);
}

function setAppearanceSwitch(id, enabled) {
  const button = document.getElementById(id);
  if (!button) return;
  button.classList.toggle('is-on', Boolean(enabled));
  button.setAttribute('aria-checked', enabled ? 'true' : 'false');
}

function syncAppearanceSettingsForm() {
  const grid = document.getElementById('theme-picker-grid');
  if (!grid) return;
  const preferences = readAppearancePreferences();
  const activeId = document.documentElement.getAttribute('data-skin') || 'light';
  const activeTheme = activeId === 'custom'
    ? { id: 'custom', label: 'Custom theme', base: 'dark', description: 'Your palette' }
    : resolveTheme(activeId);
  const customActive = activeId === 'custom';
  const custom = customDraftForCurrentTheme(preferences);
  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  };
  setValue('appearance-accent-color', custom.accent);
  setValue('appearance-accent-text', custom.accent);
  setValue('appearance-background-color', custom.background);
  setValue('appearance-background-text', custom.background);
  setValue('appearance-foreground-color', custom.foreground);
  setValue('appearance-foreground-text', custom.foreground);
  setValue('appearance-font', custom.font);
  setValue('appearance-contrast', custom.contrast);
  setValue('appearance-contrast-value', custom.contrast);
  setValue('appearance-background-opacity', Math.round(preferences.backgroundOpacity * 100));
  setValue('appearance-background-opacity-value', `${Math.round(preferences.backgroundOpacity * 100)}%`);
  const contrastValue = document.getElementById('appearance-contrast-value');
  if (contrastValue) contrastValue.textContent = String(custom.contrast);
  const opacityValue = document.getElementById('appearance-background-opacity-value');
  if (opacityValue) opacityValue.textContent = `${Math.round(preferences.backgroundOpacity * 100)}%`;
  const opacityInput = document.getElementById('appearance-background-opacity');
  if (opacityInput) opacityInput.disabled = !preferences.backgroundEffects;
  setAppearanceSwitch('appearance-sidebar-translucent', custom.translucentSidebar);
  setAppearanceSwitch('appearance-background-effects', preferences.backgroundEffects);

  const customControlIds = [
    'appearance-accent-color', 'appearance-accent-text',
    'appearance-background-color', 'appearance-background-text',
    'appearance-foreground-color', 'appearance-foreground-text',
    'appearance-font', 'appearance-contrast',
  ];
  customControlIds.forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.disabled = !customActive;
    element.setAttribute('aria-disabled', customActive ? 'false' : 'true');
  });
  const customSwitch = document.getElementById('appearance-sidebar-translucent');
  if (customSwitch) {
    customSwitch.disabled = !customActive;
    customSwitch.setAttribute('aria-disabled', customActive ? 'false' : 'true');
  }
  const resetButton = document.getElementById('appearance-reset-custom');
  if (resetButton) {
    resetButton.disabled = !customActive;
    resetButton.title = customActive ? 'Reset the custom theme to its source preset' : 'Select Custom theme to edit it';
  }
  const editButton = document.getElementById('appearance-edit-custom');
  if (editButton) editButton.hidden = customActive;
  const customState = document.getElementById('appearance-custom-state');
  if (customState) {
    customState.textContent = customActive
      ? 'Custom theme is active. Changes update the desktop shell live and stay on this device.'
      : `${activeTheme.label} is a preset. The Prometheus One shell stays shared; make a custom copy to edit colors or typography.`;
  }
  const activeState = document.getElementById('appearance-active-theme');
  if (activeState) {
    activeState.textContent = customActive
      ? 'Active theme: Custom theme'
      : `Active theme: ${activeTheme.label} · ${activeTheme.description || 'Official desktop preset'}`;
  }
}

// Render the theme cards and the live Appearance controls.
export function renderThemePicker() {
  const grid = document.getElementById('theme-picker-grid');
  if (!grid) return;
  const activeId = document.documentElement.getAttribute('data-skin') || 'dark';
  const themes = [...getThemeList(), { id: 'custom', label: 'Custom theme', base: 'dark' }];
  grid.innerHTML = themes.map((theme) => {
    const active = theme.id === activeId;
    const description = theme.description || (theme.id === 'light' ? 'Black & gold · shared P1 shell' : theme.id === 'gray' ? 'Light graphite & ember · shared P1 shell' : theme.id === 'dark' ? 'Warm graphite · shared P1 shell' : theme.id === 'blue' ? 'Electric navy · shared P1 shell' : theme.id === 'purple' ? 'Deep violet · shared P1 shell' : 'Your palette');
    return (
      '<button type="button" class="theme-swatch theme-swatch--large' + (active ? ' is-active' : '') + '"'
      + ' data-theme-id="' + theme.id + '" data-skin-preview="' + theme.id + '"'
      + ' onclick="selectTheme(\'' + theme.id + '\')"'
      + ' aria-pressed="' + (active ? 'true' : 'false') + '">'
      + '<span class="theme-preview" aria-hidden="true">'
      + '<span class="theme-preview-topline"></span><span class="theme-preview-window">'
      + '<span class="theme-preview-line theme-preview-line--wide"></span><span class="theme-preview-line"></span>'
      + '<span class="theme-preview-card"></span><span class="theme-preview-card theme-preview-card--small"></span>'
      + '</span></span>'
      + '<span class="theme-swatch-meta"><span class="theme-swatch-label">' + theme.label + '</span><span class="theme-swatch-description">' + description + '</span></span>'
      + (active ? '<span class="theme-swatch-check" aria-hidden="true">✓</span>' : '')
      + '</button>'
    );
  }).join('');
  syncAppearanceSettingsForm();
}

export function renderAppearanceSettings() {
  renderThemePicker();
  syncAppearanceSettingsForm();
}

export function updateAppearanceCustomField(field, value) {
  const preferences = readAppearancePreferences();
  const activeId = document.documentElement.getAttribute('data-skin') || 'light';
  if (activeId !== 'custom') return;
  const seedId = activeId === 'custom' ? preferences.custom.sourceTheme : activeId;
  const draft = normalizeCustomTheme(activeId === 'custom' ? preferences.custom : presetCustomDefaults(seedId), presetCustomDefaults(seedId));
  if (field === 'accent' || field === 'background' || field === 'foreground') draft[field] = normalizeHex(value, draft[field]);
  if (field === 'font' && APPEARANCE_FONT_OPTIONS.has(value)) draft.font = value;
  if (field === 'contrast') draft.contrast = Math.round(clampNumber(value, 0, 100, draft.contrast));
  draft.sourceTheme = seedId;
  applyCustomTheme(draft);
}

export function toggleAppearanceCustomSwitch(field) {
  if (field !== 'translucentSidebar') return;
  const preferences = readAppearancePreferences();
  const activeId = document.documentElement.getAttribute('data-skin') || 'light';
  if (activeId !== 'custom') return;
  const seedId = activeId === 'custom' ? preferences.custom.sourceTheme : activeId;
  const draft = normalizeCustomTheme(activeId === 'custom' ? preferences.custom : presetCustomDefaults(seedId), presetCustomDefaults(seedId));
  draft.translucentSidebar = !draft.translucentSidebar;
  draft.sourceTheme = seedId;
  applyCustomTheme(draft);
}

export function editAppearanceAsCustom() {
  const preferences = readAppearancePreferences();
  const activeId = document.documentElement.getAttribute('data-skin') || 'light';
  if (activeId === 'custom') return;
  const draft = presetCustomDefaults(activeId);
  preferences.custom = { ...draft, sourceTheme: activeId };
  writeAppearancePreferences(preferences);
  applyCustomTheme(preferences.custom);
}

export function resetAppearanceCustomTheme() {
  const preferences = readAppearancePreferences();
  const activeId = document.documentElement.getAttribute('data-skin') || 'light';
  if (activeId !== 'custom') return;
  const seedId = activeId === 'custom' ? preferences.custom.sourceTheme : activeId;
  const draft = presetCustomDefaults(seedId);
  preferences.custom = draft;
  writeAppearancePreferences(preferences);
  applyCustomTheme(draft);
}

export function toggleAppearanceBackgrounds(nextValue) {
  const preferences = readAppearancePreferences();
  preferences.backgroundEffects = typeof nextValue === 'boolean' ? nextValue : !preferences.backgroundEffects;
  writeAppearancePreferences(preferences);
  applyBackgroundPreferences(preferences);
  dispatchAppearanceChange({
    id: document.documentElement.getAttribute('data-skin') || 'dark',
    base: document.documentElement.getAttribute('data-theme') || 'dark',
  });
  syncAppearanceSettingsForm();
}

export function updateAppearanceBackgroundOpacity(value) {
  const preferences = readAppearancePreferences();
  preferences.backgroundOpacity = clampNumber(Number(value) / 100, 0, 1, APPEARANCE_DEFAULTS.backgroundOpacity);
  writeAppearancePreferences(preferences);
  applyBackgroundPreferences(preferences);
  const output = document.getElementById('appearance-background-opacity-value');
  if (output) output.textContent = `${Math.round(preferences.backgroundOpacity * 100)}%`;
}

// ── Right panel (inline drawer) ───────────────────────────────
const RIGHT_PANEL_W = 380;
const SIDEBAR_DEFAULT_W = 280; // matches --sidebar-w
const SIDEBAR_MIN_W = 180;
const SIDEBAR_MAX_W = 400;
const SIDEBAR_PAGES_COLLAPSED_KEY = 'sidebar_pages_collapsed';
let _sidebarPinnedCollapsed = false;
let _sidebarProjectsCollapsed = false;

function _resetSidebarWidth() {
  document.documentElement.style.removeProperty('--sidebar-w');
  try { localStorage.removeItem('sidebar_width'); } catch {}
  _sidebarDragW = 0;
}

function _getRightPanelWidth() {
  const panel = document.getElementById('right-panel');
  if (!panel || !panel.classList.contains('open')) return 0;
  return panel.offsetWidth || RIGHT_PANEL_W;
}

function _getSourcesMinimizedLayoutWidth() {
  // The minimized Sources surface is a floating peek, not a second layout
  // column. Keep this helper for older callers, but never reserve space for
  // the overlay or shift the chat underneath it.
  return 0;
}

// Tracks custom drag width; 0 means use the stylesheet default.
let _sidebarDragW = 0;

function _clampSidebarWidth(width) {
  const parsed = Number.parseFloat(width);
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_W;
  return Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, parsed));
}

function _applySidebarWidth(width) {
  const nextWidth = _clampSidebarWidth(width);
  document.documentElement.style.setProperty('--sidebar-w', `${nextWidth}px`);
  _sidebarDragW = nextWidth;
  return nextWidth;
}

function _syncPageViewPositions() {
  const sidebar = document.getElementById('sidebar');
  const collapsed = sidebar && sidebar.classList.contains('collapsed');
  const sidebarRight = collapsed
    ? 0
    : sidebar
      ? Math.round(_sidebarDragW || sidebar.getBoundingClientRect().width || SIDEBAR_DEFAULT_W)
      : SIDEBAR_DEFAULT_W;
  const left = `${sidebarRight}px`;
  const rightW = _getRightPanelWidth() + _getSourcesMinimizedLayoutWidth();
  const right = rightW > 0 ? `${rightW}px` : '0';
  document.querySelectorAll('.page-view').forEach(el => {
    el.style.setProperty('left', left, 'important');
    el.style.setProperty('right', right, 'important');
  });
  const cv = document.getElementById('connector-view');
  if (cv) { cv.style.left = left; cv.style.right = right; }
  if (typeof window.syncCenterColumnVisibility === 'function') {
    window.syncCenterColumnVisibility();
  }
}

export function toggleRightPanel() {
  const panel = document.getElementById('right-panel');
  const toggleBtn = document.getElementById('drawerToggle');
  if (!panel) return;

  const wasOpen = panel.classList.contains('open');
  const isOpen = panel.classList.toggle('open');
  document.body.classList.toggle('right-collapsed', !isOpen);
  if (toggleBtn) toggleBtn.classList.toggle('active', isOpen);

  if (!isOpen && wasOpen) {
    panel.style.removeProperty('width');
    panel.style.removeProperty('min-width');
    panel.style.removeProperty('max-width');
  } else if (isOpen && !wasOpen) {
    // Opening canvas: collapse sidebar AND reset its width
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
      _resetSidebarWidth();
      toggleSidebar();
    }
  }

  _syncPageViewPositions();
}

// ── Sidebar collapse ──────────────────────────────────────────
function syncSidebarEdgeReveal(collapsed) {
  const edge = document.getElementById('sidebar-edge-reveal');
  if (edge) edge.classList.toggle('is-active', !!collapsed);
}

function updateSidebarToggleControls(collapsed) {
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  ['sidebarToggle', 'windowSidebarToggle'].forEach((id) => {
    const control = document.getElementById(id);
    if (!control) return;
    control.classList.toggle('active', collapsed);
    control.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    control.setAttribute('aria-label', label);
    control.title = label;
  });
  syncSidebarEdgeReveal(collapsed);
}

export function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const collapsed = sidebar.classList.toggle('collapsed');
  if (collapsed) _resetSidebarWidth();
  try { localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0'); } catch {}
  updateSidebarToggleControls(collapsed);
  _syncPageViewPositions();
}

// Keeps the page navigation available without making it compete with a long
// session list. The control itself is the existing divider until collapsed.
export function setSidebarPagesCollapsed(collapsed, { persist = true } = {}) {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-pages-toggle');
  if (!sidebar || !toggle) return;
  sidebar.classList.toggle('pages-collapsed', !!collapsed);
  toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  toggle.setAttribute('aria-label', collapsed ? 'Expand pages' : 'Collapse pages');
  toggle.title = collapsed ? 'Expand pages' : 'Collapse pages';
  if (persist) {
    try { localStorage.setItem(SIDEBAR_PAGES_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
  }
}

export function toggleSidebarPages(event) {
  if (event) event.stopPropagation();
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  setSidebarPagesCollapsed(!sidebar.classList.contains('pages-collapsed'));
}

function setSidebarSectionCollapsed(sectionName, collapsed) {
  const config = sectionName === 'projects'
    ? { sectionId: 'sidebar-projects-section', contentId: 'sidebar-projects-list' }
    : { sectionId: 'sidebar-pinned-section', contentId: 'pinned-chats-list' };
  const section = document.getElementById(config.sectionId);
  const toggle = section?.querySelector(`[data-sidebar-section-toggle="${sectionName}"]`);
  const content = document.getElementById(config.contentId);
  const nextCollapsed = Boolean(collapsed);

  if (sectionName === 'projects') _sidebarProjectsCollapsed = nextCollapsed;
  else _sidebarPinnedCollapsed = nextCollapsed;

  section?.classList.toggle('is-collapsed', nextCollapsed);
  toggle?.setAttribute('aria-expanded', String(!nextCollapsed));
  if (content) content.hidden = nextCollapsed;
}

// Desktop mirrors the mobile drawer: the section state is intentionally
// session-local and does not affect the underlying chats or project data.
function initSidebarSectionToggles() {
  document.querySelectorAll('[data-sidebar-section-toggle]').forEach((toggle) => {
    if (toggle.dataset.sidebarSectionToggleBound === '1') return;
    toggle.dataset.sidebarSectionToggleBound = '1';
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sectionName = toggle.dataset.sidebarSectionToggle === 'projects' ? 'projects' : 'pinned';
      const isCollapsed = sectionName === 'projects' ? _sidebarProjectsCollapsed : _sidebarPinnedCollapsed;
      setSidebarSectionCollapsed(sectionName, !isCollapsed);
    });
  });

  setSidebarSectionCollapsed('pinned', _sidebarPinnedCollapsed);
  setSidebarSectionCollapsed('projects', _sidebarProjectsCollapsed);
}

// Desktop convenience: a deliberate move to the physical left screen edge
// reopens a collapsed sidebar. A short dwell prevents accidental reveals while
// simply passing the pointer across the page.
function initSidebarEdgeReveal() {
  if (window.matchMedia?.('(pointer: coarse)').matches) return;
  let revealTimer = null;
  let edge = document.getElementById('sidebar-edge-reveal');
  if (!edge && document.body) {
    edge = document.createElement('div');
    edge.id = 'sidebar-edge-reveal';
    edge.className = 'sidebar-edge-reveal';
    edge.setAttribute('aria-hidden', 'true');
    document.body.appendChild(edge);
  }
  const cancel = () => {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = null;
  };
  const schedule = (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return cancel();
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !sidebar.classList.contains('collapsed') || sidebar.classList.contains('is-resizing')) return cancel();
    if (event.buttons) return cancel();
    if (revealTimer) return;
    revealTimer = setTimeout(() => {
      revealTimer = null;
      const current = document.getElementById('sidebar');
      if (current?.classList.contains('collapsed')) toggleSidebar();
    }, 120);
  };
  edge?.addEventListener('pointerenter', schedule, { passive: true });
  edge?.addEventListener('pointermove', schedule, { passive: true });
  edge?.addEventListener('pointerleave', cancel, { passive: true });
  document.addEventListener('pointermove', (event) => {
    if (event.clientX > 18 || event.buttons) return cancel();
    schedule(event);
  }, { passive: true });
  window.addEventListener('blur', cancel);
  syncSidebarEdgeReveal(document.getElementById('sidebar')?.classList.contains('collapsed'));
}

// ── Sidebar drag-resize ───────────────────────────────────────
function _initSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;

  let startX = 0;
  let startW = 0;

  handle.addEventListener('pointerdown', (e) => {
    if (sidebar.classList.contains('collapsed')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width || SIDEBAR_DEFAULT_W;
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add('dragging');
    sidebar.classList.add('is-resizing');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    function onPointerMove(ev) {
      const delta = ev.clientX - startX;
      _applySidebarWidth(startW + delta);
      _syncPageViewPositions();
    }

    function onPointerUp(ev) {
      handle.releasePointerCapture?.(ev.pointerId);
      handle.classList.remove('dragging');
      sidebar.classList.remove('is-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      _syncPageViewPositions();
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  });
}

// Init resize after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initSidebarResize);
} else {
  _initSidebarResize();
}

// ── More popover ──────────────────────────────────────────────
export function toggleMorePopover(event) {
  if (event) event.stopPropagation();
  const popover = document.getElementById('morePopover');
  if (!popover) return;
  const isOpen = popover.classList.toggle('open');
  if (isOpen) {
    // Position the fixed popover next to the trigger button
    const trigger = document.getElementById('moreNavBtn');
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      popover.style.left = (rect.right + 8) + 'px';
      popover.style.top = rect.top + 'px';
    }
  }
}

export function closeMorePopover() {
  const popover = document.getElementById('morePopover');
  if (popover) popover.classList.remove('open');
}

// ── Sidebar segment tabs ──────────────────────────────────────
let _projectsPagePromise = null;

function ensureProjectsPage() {
  if (typeof window.loadProjects === 'function') return Promise.resolve();
  if (!_projectsPagePromise) {
    _projectsPagePromise = import('./pages/ProjectsPage.js').catch((error) => {
      _projectsPagePromise = null;
      throw error;
    });
  }
  return _projectsPagePromise;
}

async function loadProjectSidebar() {
  try {
    // Projects render in the dedicated Projects section above Sessions, so
    // hydration must not depend on a standalone projects tab panel.
    await ensureProjectsPage();
    if (typeof window.loadProjects === 'function') await window.loadProjects();
  } catch (error) {
    console.warn('[projects] Failed to load project sidebar:', error);
  }
}
window.loadProjectSidebar = loadProjectSidebar;

export function setSidebarSegTab(tab) {
  // Projects live in their own section above Sessions; keep old callers
  // harmless by treating a legacy projects tab request as a Chats request.
  const selectedTab = tab === 'projects' ? 'chats' : tab;
  const tabs = ['chats', 'skills'];
  tabs.forEach(t => {
    const btn = document.querySelector(`[data-tab="${t}"]`);
    const content = document.getElementById(t === 'chats' ? 'sidebar-jobs' : `sidebar-${t}`);
    if (btn) btn.classList.toggle('active', t === selectedTab);
    if (content) {
      content.style.display = t === selectedTab ? '' : 'none';
    }
  });

  const sessionsEditBar = document.getElementById('sessions-edit-bar');
  if (sessionsEditBar) sessionsEditBar.style.display = selectedTab === 'chats' ? 'flex' : 'none';

  // Pinned chats section only shows on the chats tab
  const pinnedSection = document.getElementById('sidebar-pinned-section');
  const projectsSection = document.getElementById('sidebar-projects-section');
  if (pinnedSection) {
    if (selectedTab === 'chats') {
      if (typeof window.renderSessionsList === 'function') window.renderSessionsList();
    } else {
      pinnedSection.style.display = 'none';
    }
  }
  if (projectsSection && selectedTab !== 'chats') projectsSection.style.display = 'none';

  window.sidebarTab = selectedTab;

  // Load content for the selected tab
  if (selectedTab === 'skills' && typeof window.loadInstalledSkills === 'function') {
    window.loadInstalledSkills();
  }
}

// ── Page mode ─────────────────────────────────────────────────
const VALID_MODES = ['chat', 'bgtasks', 'schedule', 'teams', 'subagents', 'proposals', 'audit', 'memory', 'hub', 'plugins'];

const PAGE_TITLES = {
  chat: ['New chat', 'Prometheus operator workspace'],
  bgtasks: ['Tasks', 'Background task queue'],
  schedule: ['Schedule', 'Recurring + one-off jobs'],
  teams: ['Teams', 'Managed agent teams'],
  subagents: ['Subagents', 'Standalone subagent workspace'],
  proposals: ['Proposals', 'Agent-generated proposals awaiting approval'],
  audit: ['Audit Log', 'Non-main agent runs'],
  memory: ['Memory Graph', 'Knowledge web across sessions'],
  hub: ['Hub', 'Skill usage, achievements, and tool activity'],
  plugins: ['Plugins', 'Connectors, integrations, and MCP access'],
};

const PAGE_MODULES = {
  chat: './pages/ChatPage.js',
  bgtasks: './pages/TasksPage.js',
  schedule: './pages/SchedulePage.js',
  teams: './pages/TeamsPage.js',
  subagents: './pages/SubagentsPage.js',
  proposals: './pages/ProposalsPage.js',
  audit: './pages/AuditPage.js',
  memory: './pages/MemoryPage.js',
  hub: './pages/HubPage.js',
  plugins: './pages/ConnectionsPage.js',
};
const _pageModulePromises = new Map();

function ensurePageModule(mode) {
  const src = PAGE_MODULES[mode];
  if (!src) return Promise.resolve();
  if (!_pageModulePromises.has(mode)) {
    _pageModulePromises.set(mode, import(src).catch((err) => {
      _pageModulePromises.delete(mode);
      console.error(`[app] Failed to load page module for ${mode}:`, err);
      throw err;
    }));
  }
  return _pageModulePromises.get(mode);
}

function activateLoadedPageMode(mode) {
  if (mode !== window.currentMode) return;
  if (mode === 'chat' && typeof window.syncChatTopbarTitle === 'function') {
    window.syncChatTopbarTitle();
  }
  if (mode === 'bgtasks' && typeof window.refreshBgTasks === 'function') window.refreshBgTasks();
  if (mode === 'schedule' && typeof window.refreshSchedules === 'function') window.refreshSchedules();
  if (mode === 'teams') {
    const badge = document.getElementById('teams-badge');
    if (badge) badge.style.display = 'none';
    if (typeof window.teamsPageActivate === 'function') window.teamsPageActivate();
    else if (typeof window.refreshTeams === 'function') window.refreshTeams();
  }
  if (mode === 'proposals') {
    if (typeof window.loadProposals === 'function') window.loadProposals();
    if (typeof window.loadSessionApprovals === 'function') window.loadSessionApprovals();
    const badge = document.getElementById('proposals-badge');
    if (badge) badge.style.display = 'none';
  }
  if (mode === 'subagents') {
    if (typeof window.subagentsPageActivate === 'function') window.subagentsPageActivate();
    else if (typeof window.refreshSubagents === 'function') window.refreshSubagents();
  }
  if (mode === 'audit' && typeof window.loadAuditLog === 'function') window.loadAuditLog();
  if (mode === 'memory' && typeof window.memoryPageActivate === 'function') window.memoryPageActivate();
  if (mode === 'hub' && typeof window.hubPageActivate === 'function') window.hubPageActivate();
  if (mode === 'plugins' && typeof window.pluginsPageActivate === 'function') window.pluginsPageActivate();
}

export function setMode(mode) {
  if (!VALID_MODES.includes(mode)) mode = 'chat';
  if (window.currentMode !== mode && typeof window.closeConnectorView === 'function') {
    window.closeConnectorView();
  }
  state.currentMode = mode;
  window.currentMode = mode;
  document.body?.classList.toggle('chat-mode-active', mode === 'chat');

  // Activate correct nav item
  VALID_MODES.forEach(m => {
    const el = document.getElementById(`nav-${m}`);
    if (el) el.classList.toggle('active', m === mode);
  });
  // "More" popover items
  ['audit', 'memory', 'hub', 'plugins'].forEach(m => {
    const el = document.getElementById(`nav-${m}`);
    if (el) el.classList.toggle('active', m === mode);
  });
  const moreBtn = document.getElementById('moreNavBtn');
  if (moreBtn) moreBtn.classList.toggle('active', mode === 'audit' || mode === 'memory' || mode === 'hub' || mode === 'plugins');
  closeMorePopover();

  // Update page title
  const titleParts = PAGE_TITLES[mode] || ['Chat', 'Prometheus'];
  const titleEl = document.getElementById('page-title-text');
  const subEl = document.getElementById('page-title-sub');
  if (titleEl) titleEl.textContent = titleParts[0];
  if (subEl) subEl.textContent = titleParts[1];
  if (mode === 'chat' && typeof window.syncChatTopbarTitle === 'function') {
    window.syncChatTopbarTitle();
  }

  // Show/hide views
  const viewMap = {
    chat: 'chat-view',
    bgtasks: 'bgtasks-view',
    schedule: 'schedule-view',
    teams: 'teams-view',
    subagents: 'subagents-view',
    proposals: 'proposals-view',
    audit: 'audit-view',
    memory: 'memory-view',
    hub: 'hub-view',
    plugins: 'plugins-view',
  };
  Object.entries(viewMap).forEach(([m, viewId]) => {
    const el = document.getElementById(viewId);
    if (el) el.style.display = m === mode ? 'flex' : 'none';
  });

  // In v2 layout, sidebar is always visible, main/right-panel only hide for non-chat modes
  const mainEl = document.querySelector('main.main-shell');
  if (mainEl) mainEl.style.display = mode === 'chat' ? '' : 'none';

  // Right panel stays unless you close it manually (or hide for non-chat)
  const rightPanel = document.getElementById('right-panel');
  if (rightPanel && mode !== 'chat') {
    rightPanel.classList.remove('open');
    rightPanel.style.removeProperty('width');
    rightPanel.style.removeProperty('min-width');
    rightPanel.style.removeProperty('max-width');
    document.body.classList.add('right-collapsed');
    _syncPageViewPositions();
  }
  const toggleBtn = document.getElementById('drawerToggle');
  if (toggleBtn) {
    toggleBtn.classList.remove('active');
    toggleBtn.style.display = mode === 'chat' ? '' : 'none';
  }
  if (mode === 'chat' && rightPanel) {
    document.body.classList.toggle('right-collapsed', !rightPanel.classList.contains('open'));
    _syncPageViewPositions();
  }

  return ensurePageModule(mode).then(() => activateLoadedPageMode(mode)).catch(() => {});
}

// Legacy compatibility: old header buttons still broadcast to setMode via onclick
export function toggleMoreMenu(event) { toggleMorePopover(event); }

window.setMode = setMode;
window.toggleTheme = toggleTheme;
window.applyTheme = applyTheme;
window.getInitialTheme = getInitialTheme;
window.selectTheme = selectTheme;
window.renderThemePicker = renderThemePicker;
window.renderAppearanceSettings = renderAppearanceSettings;
window.updateAppearanceCustomField = updateAppearanceCustomField;
window.toggleAppearanceCustomSwitch = toggleAppearanceCustomSwitch;
window.editAppearanceAsCustom = editAppearanceAsCustom;
window.resetAppearanceCustomTheme = resetAppearanceCustomTheme;
window.toggleAppearanceBackgrounds = toggleAppearanceBackgrounds;
window.updateAppearanceBackgroundOpacity = updateAppearanceBackgroundOpacity;
window.toggleMoreMenu = toggleMoreMenu;
window.toggleMorePopover = toggleMorePopover;
window.closeMorePopover = closeMorePopover;
window.toggleSidebar = toggleSidebar;
window.toggleSidebarPages = toggleSidebarPages;
window.setSidebarPagesCollapsed = setSidebarPagesCollapsed;
window.toggleRightPanel = toggleRightPanel;
window.setSidebarSegTab = setSidebarSegTab;
window._syncPageViewPositions = _syncPageViewPositions;

// Close more popover when clicking outside
document.addEventListener('click', (event) => {
  const wrap = document.querySelector('.nav-more-wrap');
  if (wrap && !wrap.contains(event.target)) closeMorePopover();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMorePopover();
});

window.addEventListener('resize', () => {
  _syncPageViewPositions();
});

// Restore sidebar collapse state
(function() {
  try {
    _resetSidebarWidth();
    if (localStorage.getItem('sidebar_collapsed') === '1') {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.add('collapsed');
    }
    updateSidebarToggleControls(document.getElementById('sidebar')?.classList.contains('collapsed'));
    setSidebarPagesCollapsed(localStorage.getItem(SIDEBAR_PAGES_COLLAPSED_KEY) === '1', { persist: false });
    _syncPageViewPositions();
  } catch {}
})();

initSidebarEdgeReveal();
initSidebarSectionToggles();

window.runPrometheusOnboarding = () => runOnboardingIfNeeded().catch((err) => {
  console.warn('[onboarding] manual start failed:', err);
});
