// Connector brand marks used by connection surfaces and tool activity rows.
// Keep this presentation-only map aligned with the bundled SVG assets; runtime
// connector capabilities and names remain owned by the connection catalog.

const CONNECTOR_LOGO_SLUGS = Object.freeze({
  mcp_protocol: 'modelcontextprotocol',
  asana: 'asana', atlassian: 'atlassian', brave: 'brave', canva: 'canva.png',
  cloudflare: 'cloudflare', godot: 'godotengine', higgsfield: 'higgsfield.png',
  huggingface: 'huggingface', intercom: 'intercom', linear: 'linear', mac_messages: 'apple',
  neon: 'neon', paypal: 'paypal', postgres: 'postgresql', robinhood: 'robinhood',
  sentry: 'sentry', shopmonkey: 'shopmonkey.png', sqlite: 'sqlite', square: 'square',
  supabase: 'supabase', webflow: 'webflow', websembli_mail: 'websembli.png', windows: 'windows',
  ga4: 'googleanalytics',
  github: 'github',
  gmail: 'gmail',
  google_drive: 'googledrive',
  hubspot: 'hubspot',
  instagram: 'instagram',
  linkedin: 'linkedin',
  notion: 'notion',
  obsidian: 'obsidian',
  reddit: 'reddit',
  salesforce: 'salesforce',
  slack: 'slack',
  stripe: 'stripe',
  tiktok: 'tiktok',
  vercel: 'vercel',
  x: 'x',
});

const CONNECTOR_LOGO_COLORS = Object.freeze({
  ga4: '#e37400',
  github: '#f0f0f0',
  gmail: '#ea4335',
  google_drive: '#34a853',
  hubspot: '#ff7a59',
  instagram: '#e4405f',
  linkedin: '#0a66c2',
  notion: '#f0f0f0',
  obsidian: '#a78bfa',
  reddit: '#ff4500',
  salesforce: '#00a1e0',
  slack: '#36c5f0',
  stripe: '#635bff',
  tiktok: '#f0f0f0',
  vercel: '#f0f0f0',
  x: '#f0f0f0',
});

const CONNECTOR_IDS = Object.freeze(
  Object.keys(CONNECTOR_LOGO_SLUGS).sort((a, b) => b.length - a.length),
);

function normalizeConnectorCandidate(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function connectorIdFromCandidate(value) {
  const normalized = normalizeConnectorCandidate(value);
  if (!normalized) return '';
  const candidates = [
    normalized,
    normalized.replace(/^(?:(?:connector|plugin|integration|mcp|hosted)_)+/, ''),
  ];
  for (const candidate of candidates) {
    const match = CONNECTOR_IDS.find((id) => candidate === id || candidate.startsWith(`${id}_`));
    if (match) return match;
  }
  // Reference MCP servers have no separate product brand. Don't apply this
  // mark to unrelated core memory/file tool calls such as memory_search.
  return /^(?:mcp_|hosted_)/.test(normalized) || ['filesystem', 'memory'].includes(normalized) ? 'mcp_protocol' : '';
}

export function resolveConnectorLogoId(value) {
  if (!value || typeof value !== 'object') return connectorIdFromCandidate(value);

  const args = value.args && typeof value.args === 'object' ? value.args : {};
  const explicitCandidates = [
    value.connectorId,
    value.connector_id,
    value.pluginId,
    value.plugin_id,
    value.serviceId,
    value.service_id,
    args.connectorId,
    args.connector_id,
    args.pluginId,
    args.plugin_id,
    args.serviceId,
    args.service_id,
    args.provider,
  ];
  for (const candidate of explicitCandidates) {
    const id = connectorIdFromCandidate(candidate);
    if (id) return id;
  }

  for (const candidate of [
    value.action,
    value.technicalName,
    value.toolName,
    value.tool_name,
    value.name,
    value.key,
  ]) {
    const id = connectorIdFromCandidate(candidate);
    if (id) return id;
  }
  return '';
}

export function getConnectorLogoUrl(value) {
  const id = resolveConnectorLogoId(value);
  const slug = CONNECTOR_LOGO_SLUGS[id];
  if (!slug) return '';
  // The raw module tree and the hashed production chunks have different
  // relative locations. The public static asset root is shared by both.
  return `/static/assets/connectors/${slug}${slug.endsWith('.png') ? '' : '.svg'}`;
}

// Color artwork must be painted as an image, not as an opaque silhouette.
export function colorLogoStyle(value) {
  const url = getConnectorLogoUrl(value);
  return url.endsWith('.png') ? `;mask:none;-webkit-mask:none;background:transparent url('${url}') center/contain no-repeat` : '';
}

export function renderConnectorLogo(value, escapeHtml = (input) => String(input ?? '')) {
  const id = resolveConnectorLogoId(value);
  const url = getConnectorLogoUrl(value);
  if (!id || !url) return '';
  const color = CONNECTOR_LOGO_COLORS[id] || '#f0f0f0';
  return `<span class="tool-activity-connector-logo" data-connector-logo="${escapeHtml(id)}" role="img" aria-label="${escapeHtml(id)} logo" style="--connector-logo-url:url('${escapeHtml(url)}');--connector-logo-color:${color}${colorLogoStyle(id)}"></span>`;
}
