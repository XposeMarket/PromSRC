export * from './mobile-data-base.js';

import { initMobileStatusBarTheme } from './mobile-status-bar-theme.js';

const PM_AUG12_GLASS_STYLE_VERSION = 'pm-v303-2026-08-23-aug12-glass-crosscheck';

function refreshMobileAug12GlassStyles() {
  if (typeof document === 'undefined') return;
  try {
    let link = document.getElementById('pm-mobile-demo-glass-style');
    if (!link) {
      link = document.createElement('link');
      link.id = 'pm-mobile-demo-glass-style';
      link.rel = 'stylesheet';
      link.dataset.promMobileDemoGlassStyle = '1';
      document.head.appendChild(link);
    }
    link.href = new URL(`../styles/mobile-liquid-glass-demo.css?v=${PM_AUG12_GLASS_STYLE_VERSION}&drawer-tabs=white-v1`, import.meta.url).href;
  } catch {}
}

refreshMobileAug12GlassStyles();
initMobileStatusBarTheme();
