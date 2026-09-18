const THEME_KEY = 'prometheus_theme';

export const MOBILE_V2_THEMES = [
  { id: 'dark', label: 'Prometheus One', base: 'dark' },
  { id: 'gray', label: 'Ash & Ember', base: 'dark' },
  { id: 'blue', label: 'Olympian Blue', base: 'dark' },
  { id: 'purple', label: 'Aether Violet', base: 'dark' },
];

export function resolveMobileV2Theme(themeId) {
  const requested = String(themeId || '').trim().toLowerCase();
  if (requested === 'light') return MOBILE_V2_THEMES[0];
  return MOBILE_V2_THEMES.find((theme) => theme.id === requested) || MOBILE_V2_THEMES[0];
}

export function currentMobileV2Theme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return resolveMobileV2Theme(saved);
  } catch {}
  return resolveMobileV2Theme(document.documentElement.getAttribute('data-skin'));
}

export function applyMobileV2Theme(themeId, { persist = true } = {}) {
  const theme = resolveMobileV2Theme(themeId);
  document.documentElement.setAttribute('data-theme', theme.base);
  document.documentElement.setAttribute('data-skin', theme.id);
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme.id); } catch {}
  }

  try {
    const mobileBg = getComputedStyle(document.documentElement).getPropertyValue('--pm-bg').trim();
    if (mobileBg) {
      document.documentElement.style.backgroundColor = mobileBg;
      document.body.style.backgroundColor = mobileBg;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mobileBg);
    }
  } catch {}

  document.dispatchEvent(new CustomEvent('prom-theme-change', {
    detail: { id: theme.id, base: theme.base },
  }));
  return theme;
}

export function bootMobileV2Theme() {
  return applyMobileV2Theme(currentMobileV2Theme().id, { persist: false });
}
