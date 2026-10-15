// Single theme registry for every surface (desktop, legacy bootstrap, mobile,
// custom builder, ember canvas, status bar). Loaded as a classic script before
// first paint so the FOUC guard can resolve the saved theme synchronously.
//
// Two kinds of theme:
//   legacy  = hand-tuned presets whose palettes live in CSS (p1, gray, dark,
//             blue, purple). Their `swatch` only feeds the pickers.
//   palette = data-only presets. The 7 `palette` colors below are the whole
//             theme: applyAttributes() writes them as --skin-* before paint and
//             `[data-skin-kind="palette"]` CSS derives every other token on
//             desktop (themes.css) and mobile (mobile-shell.css). Adding one is
//             a single entry here; `npm run check:web-ui` validates it.
// `custom` is a palette theme whose colors come from the user's saved custom
// theme, and `system` is a choice that resolves to a light or dark theme.
//
// Canonical IDs are persisted in localStorage `prometheus_theme`.
// History: P1 used to be stored as `light` on desktop and as `dark` on mobile.
// PROM_MIGRATE_SAVED_THEME() rewrites those once per origin.
(() => {
  const THEME_KEY = 'prometheus_theme';
  const MIGRATION_KEY = 'prometheus_theme_schema';
  const APPEARANCE_KEY = 'prometheus_appearance_v1';
  const SCHEMA = '2';
  const DEFAULT_ID = 'p1';
  const SYSTEM_ID = 'system';
  const DEFAULT_LIGHT_ID = 'olympus-day';
  const BOTH = Object.freeze(['desktop', 'mobile']);
  const SKIN_PROPS = ['--skin-bg', '--skin-sidebar', '--skin-panel', '--skin-text', '--skin-muted', '--skin-accent', '--skin-accent-ink'];

  // bg, sidebar, panel, text, muted, accent, ink (text drawn on the accent)
  const pal = (bg, sidebar, panel, text, muted, accent, ink) => Object.freeze({ bg, sidebar, panel, text, muted, accent, ink });
  const theme = (def) => Object.freeze({
    base: 'dark', kind: 'legacy', tone: 'dark', surfaces: BOTH, ember: null, chromeAccent: 'own',
    ...def,
    statusBar: def.statusBar ?? (def.palette ? def.palette.bg : ''),
    loadingWords: Object.freeze([...(def.loadingWords || ['thinking'])]),
  });
  // Palette themes always tint the ember canvas from their own accent.
  const preset = (id, label, description, palette, extra = {}) => theme({ id, label, description, kind: 'palette', palette, ...extra, ember: 'accent' });

  const THEMES = Object.freeze([
    theme({
      id: 'p1', label: 'Prometheus One', description: 'Black & gold · shared P1 shell',
      ember: null, statusBar: '#050505', swatch: pal('#050505', '#0b0b0a', '#141311', '#f2ebdd', '#8f887a', '#d6b75e', '#050505'),
      loadingWords: ['kindling', 'stoking the fire', 'forging', 'tending the flame'],
    }),
    theme({
      id: 'gray', label: 'Ash & Ember', description: 'Light graphite & ember · shared P1 shell',
      statusBar: '#2e2e2e', swatch: pal('#2e2e2e', '#171717', '#3d3d3d', '#f1eee8', '#aaa49a', '#f97316', '#ffffff'),
      loadingWords: ['raking the ash', 'banking the coals', 'catching a spark'],
    }),
    theme({
      id: 'dark', label: 'Default Dark', description: 'Warm graphite · legacy palette',
      surfaces: Object.freeze(['desktop']), ember: 'ember', statusBar: '#1a1a1a',
      swatch: pal('#1a1a1a', '#141414', '#262626', '#e8e6e1', '#9a9890', '#f97316', '#ffffff'),
      loadingWords: ['smoldering', 'stoking'],
    }),
    theme({
      id: 'blue', label: 'Olympian Blue', description: 'Electric navy · shared P1 shell',
      ember: 'blue', statusBar: '#07101f', chromeAccent: 'p1-gold',
      swatch: pal('#07101f', '#0c1730', '#122444', '#dde8ff', '#8da3c9', '#3d8bff', '#ffffff'),
      loadingWords: ['ascending Olympus', 'consulting the heavens'],
    }),
    theme({
      id: 'purple', label: 'Aether Violet', description: 'Deep violet · shared P1 shell',
      ember: 'purple', statusBar: '#0c0518', chromeAccent: 'p1-gold',
      swatch: pal('#0c0518', '#150a28', '#1e1138', '#e8ddff', '#a892cf', '#8b5cf6', '#ffffff'),
      loadingWords: ['drawing from the aether', 'weaving starlight'],
    }),
    preset('ares', 'Ares', 'Crimson-black & bronze',
      pal('#0f0807', '#160c0a', '#22130f', '#f3e6dc', '#a08a7c', '#cd7f32', '#120806'),
      { ember: 'ember', loadingWords: ['forging', 'marching', 'tempering steel', 'sharpening the blade'] }),
    preset('kiln', 'Kiln', 'Warm gray & clay',
      pal('#262624', '#1f1e1d', '#30302e', '#faf9f5', '#a6a39a', '#d97757', '#1a1a19'),
      { ember: 'ember', loadingWords: ['firing the kiln', 'throwing clay', 'glazing'] }),
    preset('obsidian', 'Obsidian', 'Pure grayscale · white accent',
      pal('#181818', '#111111', '#232323', '#ededed', '#8a8a8a', '#f2f2f2', '#111111'),
      { loadingWords: ['thinking', 'working', 'polishing'] }),
    preset('hearth', 'Hearth', 'Retro warm · Gruvbox-inspired',
      pal('#282828', '#1d2021', '#32302f', '#ebdbb2', '#a89984', '#fabd2f', '#282828'),
      { ember: 'ember', loadingWords: ['tending the hearth', 'warming up', 'brewing'] }),
    preset('sumi', 'Sumi', 'Ink-wash navy · Kanagawa-inspired',
      pal('#1f1f28', '#16161d', '#2a2a37', '#dcd7ba', '#908e84', '#c0a36e', '#16161d'),
      { loadingWords: ['grinding ink', 'laying brushstrokes', 'letting it dry'] }),
    preset('poseidon', 'Poseidon', 'Deep sea & seafoam',
      pal('#061317', '#040e11', '#0b2027', '#d7eeec', '#7fa3a6', '#5fd4c0', '#04110f'),
      { ember: 'blue', loadingWords: ['sounding the depth', 'charting currents', 'reading the tide'] }),
    preset('boreas', 'Boreas', 'Arctic slate · Nord-inspired',
      pal('#2e3440', '#272c36', '#3b4252', '#eceff4', '#9aa3b5', '#88c0d0', '#1f242d'),
      { ember: 'blue', loadingWords: ['riding the north wind', 'frosting over'] }),
    preset('eos', 'Eos', 'Dusk purple & rose · Rosé Pine-inspired',
      pal('#191724', '#14121e', '#1f1d2e', '#e0def4', '#908caa', '#ebbcba', '#191724'),
      { ember: 'purple', loadingWords: ['greeting the dawn', 'painting the sky'] }),
    preset('hestia', 'Hestia', 'Cozy pastel · Catppuccin-inspired',
      pal('#1e1e2e', '#181825', '#313244', '#cdd6f4', '#9399b2', '#fab387', '#1e1e2e'),
      { ember: 'purple', loadingWords: ['keeping the hearth', 'simmering'] }),
    preset('olympus-day', 'Olympus Day', 'Bone & deep gold · light',
      pal('#f5f1e8', '#ece6d8', '#fffdf8', '#17140d', '#6f6757', '#9a7a22', '#fffdf8'),
      { tone: 'light', loadingWords: ['convening on Olympus', 'consulting the oracle'] }),
    preset('parchment', 'Parchment', 'Ivory & clay · light',
      pal('#faf9f5', '#f0eee6', '#ffffff', '#141413', '#6b6a64', '#c15f3c', '#ffffff'),
      { tone: 'light', loadingWords: ['drafting', 'inking the margins'] }),
    preset('daylight', 'Daylight', 'Clean white & blue · light',
      pal('#ffffff', '#f7f7f8', '#f4f4f5', '#0d0d0d', '#626262', '#0277e6', '#ffffff'),
      { tone: 'light', loadingWords: ['thinking', 'working'] }),
  ]);
  const CUSTOM = theme({
    id: 'custom', label: 'Custom theme', description: 'Your palette', kind: 'palette',
    ember: 'accent', statusBar: '', loadingWords: ['thinking', 'working'],
  });
  const SYSTEM = Object.freeze({
    id: SYSTEM_ID, label: 'Match system', description: 'Follows your device light/dark setting',
    base: 'dark', kind: 'system', surfaces: BOTH,
  });
  const LEGACY_ALIASES = Object.freeze({ light: 'p1' });
  const PALETTE_KEYS = Object.freeze(['bg', 'sidebar', 'panel', 'text', 'muted', 'accent', 'ink']);
  const PREF_DEFAULTS = Object.freeze({ contrast: 50, loadingWords: true, systemDark: DEFAULT_ID, systemLight: DEFAULT_LIGHT_ID });

  // ── Color math (also used by share codes and VS Code import) ──────────────
  function hex(value, fallback = '') {
    let text = String(value || '').trim().toLowerCase();
    if (/^#[0-9a-f]{3,4}$/.test(text)) text = `#${text.slice(1, 4).split('').map((c) => c + c).join('')}`;
    if (/^#[0-9a-f]{8}$/.test(text)) text = text.slice(0, 7); // drop VS Code alpha
    return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
  }
  function rgb(value) {
    const n = parseInt(hex(value, '#000000').slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const x = rgb(a);
    const y = rgb(b);
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
  }
  function luminance(value) {
    const c = rgb(value).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrastRatio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
  }
  function toneOf(bg) { return luminance(bg) > 0.4 ? 'light' : 'dark'; }
  function inkFor(accent) { return contrastRatio(accent, '#ffffff') >= contrastRatio(accent, '#111111') ? '#ffffff' : '#111111'; }
  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  }

  // Fill in any missing palette roles from bg/text/accent.
  function completePalette(input) {
    const bg = hex(input.bg, '#050505');
    const text = hex(input.text, toneOf(bg) === 'light' ? '#141413' : '#f2ebdd');
    const accent = hex(input.accent, mix(text, bg, 0.3));
    const light = toneOf(bg) === 'light';
    let ink = hex(input.ink) || inkFor(accent);
    if (contrastRatio(ink, accent) < 3) ink = inkFor(accent);
    return Object.freeze({
      bg,
      sidebar: hex(input.sidebar) || (light ? mix(bg, '#000000', 0.04) : mix(bg, '#000000', 0.22)),
      panel: hex(input.panel) || (light ? mix(bg, '#ffffff', 0.7) : mix(bg, text, 0.07)),
      text,
      muted: hex(input.muted) || mix(text, bg, 0.45),
      accent,
      ink,
    });
  }

  // ── Appearance prefs shared with app.js (same localStorage key) ───────────
  function readAppearance() {
    try {
      const value = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }
  function normalizeThemePrefs(source) {
    const s = source && typeof source === 'object' ? source : {};
    const pick = (id, tone, fallback) => (THEMES.some((t) => t.id === id && t.tone === tone) ? id : fallback);
    return {
      contrast: clampInt(s.contrast, 0, 100, PREF_DEFAULTS.contrast),
      loadingWords: s.loadingWords !== false,
      systemDark: pick(s.systemDark, 'dark', PREF_DEFAULTS.systemDark),
      systemLight: pick(s.systemLight, 'light', PREF_DEFAULTS.systemLight),
    };
  }
  function themePrefs() { return normalizeThemePrefs(readAppearance()); }
  function writeThemePrefs(patch) {
    const all = readAppearance();
    const next = { ...all, ...normalizeThemePrefs({ ...all, ...(patch || {}) }) };
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next)); } catch {}
    return normalizeThemePrefs(next);
  }
  function customPalette() {
    const c = readAppearance().custom || {};
    return completePalette({
      bg: c.background, text: c.foreground, accent: c.accent,
      sidebar: c.sidebar, panel: c.panel, muted: c.muted, ink: c.ink,
    });
  }
  function saveCustom(custom) {
    const all = readAppearance();
    all.custom = { ...(all.custom || {}), ...custom };
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(all)); } catch {}
    return all.custom;
  }

  // ── Surfaces, resolution, migration ───────────────────────────────────────
  function isMobileSurface() {
    try {
      if (typeof window.__PROM_SHOULD_BOOT_MOBILE === 'function') return !!window.__PROM_SHOULD_BOOT_MOBILE();
      return /^\/mobile(\/|$)/.test(String(window.location.pathname || ''));
    } catch {
      return false;
    }
  }
  function currentSurface() { return isMobileSurface() ? 'mobile' : 'desktop'; }
  function themesFor(surface = currentSurface()) { return THEMES.filter((t) => t.surfaces.includes(surface)); }
  function normalizeId(id) {
    const value = String(id || '').trim();
    return LEGACY_ALIASES[value] || value;
  }
  function systemPrefersDark() {
    try {
      return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return true;
    }
  }
  function systemTargetId() {
    const prefs = themePrefs();
    return systemPrefersDark() ? prefs.systemDark : prefs.systemLight;
  }
  function resolve(id, surface = currentSurface()) {
    const value = normalizeId(id);
    if (value === 'custom') return CUSTOM;
    if (value === SYSTEM_ID) return resolve(systemTargetId(), surface);
    return themesFor(surface).find((t) => t.id === value) || THEMES.find((t) => t.id === DEFAULT_ID);
  }
  function paletteFor(id) {
    const theme = resolve(id);
    if (theme.id === 'custom') return customPalette();
    return theme.palette || theme.swatch || null;
  }

  // One-time rewrite of persisted pre-unification IDs. Mobile always stored
  // P1 as `dark`, so `dark` only means Default Dark when it was saved on desktop.
  function migrateSavedTheme(surface = currentSurface()) {
    try {
      if (localStorage.getItem(MIGRATION_KEY) === SCHEMA) return localStorage.getItem(THEME_KEY) || '';
      const saved = String(localStorage.getItem(THEME_KEY) || '').trim();
      let next = saved;
      if (saved === 'light') next = 'p1';
      else if (saved === 'dark' && surface === 'mobile') next = 'p1';
      if (next && next !== saved) localStorage.setItem(THEME_KEY, next);
      localStorage.setItem(MIGRATION_KEY, SCHEMA);
      return next;
    } catch {
      return '';
    }
  }
  function readSavedTheme(surface = currentSurface()) {
    try {
      const saved = normalizeId(migrateSavedTheme(surface));
      if (saved === 'custom' || saved === SYSTEM_ID || themesFor(surface).some((t) => t.id === saved)) return saved;
    } catch {}
    return '';
  }

  function savedChoice() {
    try { return normalizeId(localStorage.getItem(THEME_KEY) || ''); } catch { return ''; }
  }

  // The one place that writes theme attributes. Palette themes also get their
  // 7 colors as inline --skin-* properties; legacy themes read theirs from CSS.
  // `chromeAccent`: 'own' keeps the skin accent everywhere; 'p1-gold' keeps the
  // skin accent in Chat/Voice and uses P1 gold chrome on other mobile routes.
  function applyAttributes(themeOrId, root = document.documentElement, choice) {
    const asked = themeOrId && typeof themeOrId === 'object' ? themeOrId.id : themeOrId;
    const id = normalizeId(asked);
    const theme = id === 'custom' ? CUSTOM : resolve(id);
    const prefs = themePrefs();
    const palette = theme.kind === 'palette' ? paletteFor(theme.id) : null;
    const tone = palette ? toneOf(palette.bg) : (theme.tone || 'dark');
    const chosen = choice || (id === SYSTEM_ID || savedChoice() === SYSTEM_ID ? SYSTEM_ID : theme.id);
    // Palette themes report their real tone so light palettes pick up the
    // light-base CSS paths; legacy presets keep their declared base.
    root.setAttribute('data-theme', palette ? tone : (theme.base || 'dark'));
    root.setAttribute('data-skin', theme.id);
    root.setAttribute('data-skin-kind', theme.kind || 'legacy');
    root.setAttribute('data-tone', tone);
    root.setAttribute('data-chrome-accent', theme.chromeAccent || 'own');
    root.setAttribute('data-theme-choice', chosen);
    const style = root.style;
    if (palette) SKIN_PROPS.forEach((prop, i) => style.setProperty(prop, palette[PALETTE_KEYS[i]]));
    else SKIN_PROPS.forEach((prop) => style.removeProperty(prop));
    style.setProperty('--skin-contrast', String(prefs.contrast / 100));
    style.setProperty('color-scheme', tone);
    // Legacy presets have hand-tuned borders; only override them once the
    // user actually moves the contrast slider off its neutral midpoint.
    if (!palette && prefs.contrast !== PREF_DEFAULTS.contrast) {
      const k = prefs.contrast / 100;
      style.setProperty('--line', `color-mix(in srgb, var(--text) ${Math.round(5 + k * 16)}%, transparent)`);
      style.setProperty('--line-strong', `color-mix(in srgb, var(--text) ${Math.round(10 + k * 26)}%, transparent)`);
      root.setAttribute('data-contrast-override', 'on');
    } else if (!palette || root.getAttribute('data-contrast-override') === 'on') {
      if (root.getAttribute('data-contrast-override') === 'on' && root.getAttribute('data-skin') !== 'custom') {
        style.removeProperty('--line');
        style.removeProperty('--line-strong');
      }
      root.removeAttribute('data-contrast-override');
    }
    return theme;
  }

  // Persist a choice (`system` stays `system`) and apply it.
  function setTheme(choice, root = document.documentElement) {
    const id = normalizeId(choice) || DEFAULT_ID;
    const theme = id === 'custom' ? CUSTOM : resolve(id);
    const stored = id === SYSTEM_ID ? SYSTEM_ID : theme.id;
    try { localStorage.setItem(THEME_KEY, stored); } catch {}
    return applyAttributes(theme, root, stored);
  }

  // Re-apply the active theme after a pref change (contrast, system picks).
  function refresh(root = document.documentElement) {
    const choice = savedChoice() || root.getAttribute('data-theme-choice') || DEFAULT_ID;
    return applyAttributes(choice, root, choice === SYSTEM_ID ? SYSTEM_ID : undefined);
  }

  try {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const onSchemeChange = () => {
      if (savedChoice() !== SYSTEM_ID) return;
      try { document.dispatchEvent(new CustomEvent('prom-system-scheme-change', { detail: { dark: systemPrefersDark() } })); } catch {}
    };
    if (media && typeof media.addEventListener === 'function') media.addEventListener('change', onSchemeChange);
    else if (media && typeof media.addListener === 'function') media.addListener(onSchemeChange);
  } catch {}

  // ── Per-theme loading words (Hermes-style spinner verbs) ───────────────────
  // Deterministic per key so a re-rendered bubble never flickers to a new word.
  function loadingWord(key = '') {
    if (!themePrefs().loadingWords) return '';
    const theme = resolve(document.documentElement.getAttribute('data-skin') || DEFAULT_ID);
    const words = theme.loadingWords && theme.loadingWords.length ? theme.loadingWords : ['thinking'];
    let h = 0;
    for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const word = words[h % words.length];
    return `${word.charAt(0).toUpperCase()}${word.slice(1)}…`;
  }
  function loadingWordHtml(key = '', className = 'prom-loading-word', tag = 'span') {
    const word = loadingWord(key);
    const el = /^(span|em|i|b|small)$/.test(tag) ? tag : 'span';
    const cls = String(className || '').replace(/[^\w -]/g, '') || 'prom-loading-word';
    return word ? `<${el} class="${cls}" aria-live="off">${word.replace(/[&<>"]/g, '')}</${el}>` : '';
  }
  // Shared "thinking" indicator (three dots + the theme's loading word) so chat
  // renderers don't each inline the markup.
  function thinkingDotsHtml(key = '') {
    return `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>${loadingWordHtml(key)}</div>`;
  }

  // ── Theme share codes (Codex-style copy/import) ───────────────────────────
  // PROM1-<7 colors as 42 hex chars><contrast as 2 hex>-<url-encoded name>
  // Plain ASCII so it survives chat apps, X posts and QR codes.
  function encodeShareCode(palette, { name = 'Shared theme', contrast } = {}) {
    const full = completePalette(palette || {});
    const c = clampInt(contrast ?? themePrefs().contrast, 0, 100, PREF_DEFAULTS.contrast);
    const body = PALETTE_KEYS.map((key) => full[key].slice(1)).join('') + c.toString(16).padStart(2, '0');
    const label = encodeURIComponent(String(name || '').trim().slice(0, 40));
    return `PROM1-${body}${label ? `-${label}` : ''}`;
  }
  function decodeShareCode(code) {
    const match = /^PROM1-([0-9a-f]{44})(?:-(.*))?$/i.exec(String(code || '').trim());
    if (!match) return null;
    const body = match[1].toLowerCase();
    const palette = {};
    PALETTE_KEYS.forEach((key, i) => { palette[key] = `#${body.slice(i * 6, i * 6 + 6)}`; });
    let name = 'Imported theme';
    try { if (match[2]) name = decodeURIComponent(match[2]).slice(0, 40) || name; } catch {}
    return { name, palette: completePalette(palette), contrast: clampInt(parseInt(body.slice(42, 44), 16), 0, 100, PREF_DEFAULTS.contrast) };
  }
  function activeShareCode() {
    const id = document.documentElement.getAttribute('data-skin') || DEFAULT_ID;
    const theme = resolve(id);
    const palette = paletteFor(id);
    const custom = readAppearance().custom || {};
    const name = id === 'custom' ? (custom.name || 'My theme') : theme.label;
    const contrast = id === 'custom' ? custom.contrast : themePrefs().contrast;
    return palette ? encodeShareCode(palette, { name, contrast }) : '';
  }

  // ── VS Code theme import ──────────────────────────────────────────────────
  // Accepts a theme JSON file (comments and trailing commas allowed) and maps
  // workbench colors onto the 7 palette roles. Token colors are a fallback
  // accent source for themes that leave the UI chrome default.
  function stripJsonc(text) {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (inString) {
        out += ch;
        if (ch === '\\') { out += next || ''; i += 1; } else if (ch === '"') inString = false;
      } else if (ch === '"') { inString = true; out += ch; }
      else if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; }
      else if (ch === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1; i += 1; }
      else out += ch;
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
  }
  function importVsCodeTheme(source) {
    let json = source;
    if (typeof source === 'string') {
      try { json = JSON.parse(stripJsonc(source)); } catch { return { error: 'That is not valid theme JSON.' }; }
    }
    const colors = json && typeof json.colors === 'object' ? json.colors : null;
    if (!colors) return { error: 'No "colors" block found. Paste the full VS Code theme file.' };
    const first = (...keys) => keys.map((key) => hex(colors[key])).find(Boolean) || '';
    let accent = first('button.background', 'activityBarBadge.background', 'focusBorder', 'textLink.foreground', 'progressBar.background', 'tab.activeBorder');
    if (!accent && Array.isArray(json.tokenColors)) {
      const keyword = json.tokenColors.find((t) => /keyword|storage/.test([].concat(t.scope || []).join(' ')));
      accent = hex(keyword?.settings?.foreground);
    }
    const bg = first('editor.background', 'sideBar.background', 'panel.background');
    if (!bg) return { error: 'This theme does not define editor.background.' };
    const text = first('editor.foreground', 'foreground', 'sideBar.foreground');
    const declaredType = String(json.type || '').toLowerCase();
    const palette = completePalette({
      bg,
      sidebar: first('sideBar.background', 'activityBar.background', 'titleBar.activeBackground'),
      panel: first('editorWidget.background', 'dropdown.background', 'input.background', 'quickInput.background', 'editorGroupHeader.tabsBackground'),
      text: text || (declaredType === 'light' ? '#1f1f1f' : '#e6e6e6'),
      muted: first('descriptionForeground', 'editorLineNumber.activeForeground', 'tab.inactiveForeground', 'editorLineNumber.foreground'),
      accent,
      ink: first('button.foreground', 'activityBarBadge.foreground'),
    });
    const mapped = Object.keys(colors).length;
    return { name: String(json.name || 'VS Code theme').slice(0, 40), palette, mappedKeys: mapped, tone: toneOf(palette.bg) };
  }

  // Import either format straight into the custom theme and activate it.
  function importTheme(text) {
    const raw = String(text || '').trim();
    if (!raw) return { error: 'Paste a PROM1 share code or a VS Code theme JSON file.' };
    const result = /^PROM1-/i.test(raw) ? decodeShareCode(raw) : importVsCodeTheme(raw);
    if (!result) return { error: 'That share code is not valid. It should start with PROM1-.' };
    if (result.error) return result;
    const p = result.palette;
    saveCustom({
      name: result.name, background: p.bg, foreground: p.text, accent: p.accent,
      sidebar: p.sidebar, panel: p.panel, muted: p.muted, ink: p.ink, sourceTheme: DEFAULT_ID,
      ...(result.contrast != null ? { contrast: result.contrast } : {}),
    });
    return { ok: true, name: result.name, palette: p, source: /^PROM1-/i.test(raw) ? 'share-code' : 'vscode' };
  }

  // Re-apply the active choice when the device flips light/dark.
  const hasDocument = typeof document !== 'undefined' && !!document.documentElement;
  if (hasDocument) {
    document.addEventListener('prom-system-scheme-change', () => {
      const theme = refresh();
      try { document.dispatchEvent(new CustomEvent('prom-theme-change', { detail: { id: theme.id, base: theme.base, reason: 'system' } })); } catch {}
    });
  }

  window.PROM_APPLY_THEME_ATTRIBUTES = applyAttributes;
  window.PROM_SET_THEME = setTheme;
  window.PROM_THEME_KEY = THEME_KEY;
  window.PROM_DEFAULT_THEME = DEFAULT_ID;
  window.PROM_ALL_THEMES = THEMES;
  // Surface-filtered list: existing consumers iterate this for pickers/toggles.
  window.PROM_THEMES = themesFor();
  window.PROM_THEMES_FOR_SURFACE = themesFor;
  window.PROM_CUSTOM_THEME = CUSTOM;
  window.PROM_SYSTEM_THEME = SYSTEM;
  window.PROM_NORMALIZE_THEME_ID = normalizeId;
  window.PROM_RESOLVE_THEME = resolve;
  window.PROM_MIGRATE_SAVED_THEME = migrateSavedTheme;
  window.PROM_READ_SAVED_THEME = readSavedTheme;
  window.PROM_THEME_SURFACE = currentSurface;
  window.PROM_THEME_ENGINE = Object.freeze({
    palette: paletteFor, completePalette, toneOf, contrastRatio, mix, hex,
    prefs: themePrefs, setPrefs: (patch) => { const prefs = writeThemePrefs(patch); refresh(); return prefs; },
    refresh, setTheme, choice: () => savedChoice() || DEFAULT_ID, systemPrefersDark, systemTarget: systemTargetId,
    loadingWord, loadingWordHtml, thinkingDotsHtml,
    encodeShareCode, decodeShareCode, activeShareCode, importVsCodeTheme, importTheme,
    paletteKeys: PALETTE_KEYS,
  });

  // Paint the saved theme before any stylesheet resolves, on every surface.
  // Shell code re-applies later through the same function, so this is idempotent.
  if (hasDocument) {
    try { applyAttributes(readSavedTheme() || DEFAULT_ID); } catch {}
  }
})();
