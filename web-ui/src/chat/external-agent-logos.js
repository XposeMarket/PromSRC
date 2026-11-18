// Brand marks for the agents a chat can run on. Same assets as Settings >
// Agents & imports, so every surface shows one logo per harness.
const LOGOS = {
  prometheus: '/static/assets/prometheus-one/p1-logo.png',
  codex: '/static/assets/import-sources/openai.svg',
  'claude-code': '/static/assets/import-sources/claude.svg',
  cursor: '/static/assets/import-sources/cursor.svg',
  hermes: '/static/assets/import-sources/hermes.png',
  openclaw: '/static/assets/import-sources/openclaw.svg',
};

export function agentLogoHtml(id = 'prometheus') {
  const key = Object.prototype.hasOwnProperty.call(LOGOS, id) ? id : 'prometheus';
  return `<img class="ea-logo ea-logo-${key}" src="${LOGOS[key]}" alt="" aria-hidden="true" draggable="false">`;
}
