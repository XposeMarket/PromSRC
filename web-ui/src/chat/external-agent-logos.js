// Brand marks for the agents a chat can run on. Same assets as Settings >
// Agents & imports, so every surface shows one logo per harness.
const LOGOS = {
  // The ring mark the app uses everywhere else; p1-logo.png is the full poster
  // (wordmark + tagline) and turns to mush at icon size.
  prometheus: '/static/assets/prometheus-one/p1-mark-ring.png',
  codex: '/static/assets/import-sources/openai.svg',
  'claude-code': '/static/assets/import-sources/claude.svg',
  cursor: '/static/assets/import-sources/cursor.svg',
  // Nous Research mark, same as Settings > Agents & imports.
  hermes: '/static/assets/import-sources/nous-research.png',
  openclaw: '/static/assets/import-sources/openclaw.svg',
  antigravity: '/static/assets/import-sources/antigravity.svg',
  'openai-dots': '/static/assets/import-sources/openai.svg',
};

/** Logo URL for a known agent id (import ids too: "claude"), or '' when there is none. */
export function agentLogoSrc(id = '') {
  const key = id === 'claude' ? 'claude-code' : id;
  return Object.prototype.hasOwnProperty.call(LOGOS, key) ? LOGOS[key] : '';
}

export function agentLogoHtml(id = 'prometheus') {
  const key = Object.prototype.hasOwnProperty.call(LOGOS, id) ? id : 'prometheus';
  return `<img class="ea-logo ea-logo-${key}" src="${LOGOS[key]}" alt="" aria-hidden="true" draggable="false">`;
}
