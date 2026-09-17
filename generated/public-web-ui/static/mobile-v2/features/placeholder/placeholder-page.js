import { ICONS } from '../../ui/icons.js';

export function mountPlaceholderPage({ shell, tab, title, message }) {
  shell.setActiveTab(tab);
  shell.setTitle(title || 'Prometheus');
  shell.page.innerHTML = `<section class="pm-v2-placeholder"><div class="pm-v2-placeholder-icon">${ICONS.spark}</div><h1>${title}</h1><p>${message}</p><small>The V2 shell is active; this feature will be migrated without importing the legacy runtime.</small></section>`;
  return () => {};
}
