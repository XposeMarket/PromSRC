// Single theme registry for every surface (desktop, legacy bootstrap, mobile,
// custom builder, ember canvas, status bar). Loaded as a classic script before
// first paint so the FOUC guard can resolve the saved theme synchronously.
//
// Canonical IDs are surface-independent and persisted in localStorage
// `prometheus_theme`:
//   p1     = Prometheus One (black & gold, the brand default)
//   gray   = Ash & Ember
//   dark   = Default Dark (legacy warm graphite/orange; desktop only)
//   blue   = Olympian Blue
//   purple = Aether Violet
//   custom = user palette (desktop builder; mobile renders its tokens)
//
// History: P1 used to be stored as `light` on desktop and as `dark` on mobile.
// PROM_MIGRATE_SAVED_THEME() rewrites those once per origin so nobody's theme
// changes when the IDs were unified.
(() => {
  const THEME_KEY = 'prometheus_theme';
  const MIGRATION_KEY = 'prometheus_theme_schema';
  const SCHEMA = '2';
  const DEFAULT_ID = 'p1';

  const THEMES = Object.freeze([
    Object.freeze({
      id: 'p1', label: 'Prometheus One', base: 'dark', description: 'Black & gold · shared P1 shell',
      surfaces: ['desktop', 'mobile'], ember: null, statusBar: '#050505', chromeAccent: 'own',
    }),
    Object.freeze({
      id: 'gray', label: 'Ash & Ember', base: 'dark', description: 'Light graphite & ember · shared P1 shell',
      surfaces: ['desktop', 'mobile'], ember: null, statusBar: '#2e2e2e', chromeAccent: 'own',
    }),
    Object.freeze({
      id: 'dark', label: 'Default Dark', base: 'dark', description: 'Warm graphite · legacy palette',
      surfaces: ['desktop'], ember: 'ember', statusBar: '#1a1a1a', chromeAccent: 'own',
    }),
    Object.freeze({
      id: 'blue', label: 'Olympian Blue', base: 'dark', description: 'Electric navy · shared P1 shell',
      surfaces: ['desktop', 'mobile'], ember: 'blue', statusBar: '#07101f', chromeAccent: 'own',
    }),
    Object.freeze({
      id: 'purple', label: 'Aether Violet', base: 'dark', description: 'Deep violet · shared P1 shell',
      surfaces: ['desktop', 'mobile'], ember: 'purple', statusBar: '#0c0518', chromeAccent: 'own',
    }),
  ]);
  const CUSTOM = Object.freeze({
    id: 'custom', label: 'Custom theme', base: 'dark', description: 'Your palette',
    surfaces: ['desktop', 'mobile'], ember: 'custom', statusBar: '', chromeAccent: 'own',
  });
  const LEGACY_ALIASES = Object.freeze({ light: 'p1' });

  function isMobileSurface() {
    try {
      if (typeof window.__PROM_SHOULD_BOOT_MOBILE === 'function') return !!window.__PROM_SHOULD_BOOT_MOBILE();
      return /^\/mobile(\/|$)/.test(String(window.location.pathname || ''));
    } catch {
      return false;
    }
  }

  function currentSurface() {
    return isMobileSurface() ? 'mobile' : 'desktop';
  }

  function themesFor(surface = currentSurface()) {
    return THEMES.filter((theme) => theme.surfaces.includes(surface));
  }

  function normalizeId(id) {
    const value = String(id || '').trim();
    return LEGACY_ALIASES[value] || value;
  }

  function resolve(id, surface = currentSurface()) {
    const value = normalizeId(id);
    if (value === 'custom') return CUSTOM;
    return themesFor(surface).find((theme) => theme.id === value)
      || THEMES.find((theme) => theme.id === DEFAULT_ID);
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
      if (saved === 'custom' || themesFor(surface).some((theme) => theme.id === saved)) return saved;
    } catch {}
    return '';
  }

  window.PROM_THEME_KEY = THEME_KEY;
  window.PROM_DEFAULT_THEME = DEFAULT_ID;
  window.PROM_ALL_THEMES = THEMES;
  // Surface-filtered list: existing consumers iterate this for pickers/toggles.
  window.PROM_THEMES = themesFor();
  window.PROM_THEMES_FOR_SURFACE = themesFor;
  window.PROM_CUSTOM_THEME = CUSTOM;
  window.PROM_NORMALIZE_THEME_ID = normalizeId;
  window.PROM_RESOLVE_THEME = resolve;
  window.PROM_MIGRATE_SAVED_THEME = migrateSavedTheme;
  window.PROM_READ_SAVED_THEME = readSavedTheme;
  window.PROM_THEME_SURFACE = currentSurface;
})();
