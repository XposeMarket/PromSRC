import { renderProviderLogo } from './provider-logo.js';
import { escHtml } from '../utils.js';

// The effort inherits the existing theme foreground; only the model is emphasized.
export function desktopModelLabel(provider, model, name, effort = '') {
  const logo = provider || model ? renderProviderLogo(provider, model, 'composer-provider-mark') : '';
  return `${logo}<b class="composer-model-title">${escHtml(name)}</b>${effort ? `<span class="composer-model-effort"> ${escHtml(effort)}</span>` : ''}`;
}
