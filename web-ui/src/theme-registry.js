// Canonical IDs on every surface: light=P1 black/gold, gray=ash/ember,
// dark=warm graphite/orange, blue=navy/blue, purple=violet, custom=user palette.
// Never rename light to dark on mobile: persisted IDs are surface-independent.
window.PROM_THEMES = [
  { id: 'light', label: 'Prometheus One', base: 'dark', description: 'Black & gold · shared P1 shell' },
  { id: 'gray', label: 'Ash & Ember', base: 'dark', description: 'Light graphite & ember · shared P1 shell' },
  { id: 'dark', label: 'Default Dark', base: 'dark', description: 'Warm graphite · shared P1 shell' },
  { id: 'blue', label: 'Olympian Blue', base: 'dark', description: 'Electric navy · shared P1 shell' },
  { id: 'purple', label: 'Aether Violet', base: 'dark', description: 'Deep violet · shared P1 shell' },
];
window.PROM_RESOLVE_THEME = (id) => id === 'custom'
  ? { id: 'custom', label: 'Custom theme', base: 'dark' }
  : window.PROM_THEMES.find((theme) => theme.id === id) || window.PROM_THEMES[0];
window.PROM_READ_SAVED_THEME = () => {
  try {
    const saved = localStorage.getItem('prometheus_theme');
    if (saved === 'custom' || window.PROM_THEMES.some((theme) => theme.id === saved)) return saved;
  } catch {}
  return '';
};
