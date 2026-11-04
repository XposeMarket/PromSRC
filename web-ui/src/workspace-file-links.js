// Workspace file links in rendered chat markdown.
//
// Models often link files they wrote as plain markdown, for example
// `[Locked plan](plans/connected-memory/PLAN.md)`. Left alone, the browser
// resolves that against the page origin: desktop gets a 404, and a phone that
// reaches the gateway through a proxy (Tailscale Funnel) lands on a raw
// "Unauthorized: proxied remote requests require a paired device" JSON page,
// because a plain navigation carries no pairing token.
//
// renderMd marks these anchors with data-workspace-file so one delegated click
// handler (utils.js) can open the host's file viewer instead: the mobile canvas
// sheet or the desktop Canvas. The fallback href points at the authenticated
// inline media route so a non-JS open still works.
//
// Pure string helpers only (no DOM) so node tests can import this module.

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABS_RE = /^[a-z]:[\\/]/i;
const FILE_EXT_RE = /\.[a-z0-9_-]{1,12}$/i;
const BARE_DOMAIN_RE = /\.(?:com|org|net|io|ai|co|gov|edu|us|uk|ca|de|me|tv|xyz)$/i;

function decodeHref(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

// Returns the workspace path a markdown link points at, or '' when the link is
// a web URL, an app route, an in-page anchor, or not a file.
export function workspaceFilePathFromHref(rawHref) {
  let href = decodeHref(String(rawHref || '').trim().replace(/&amp;/g, '&')).trim();
  if (!href || href.startsWith('#')) return '';
  if (/^file:\/\//i.test(href)) {
    href = href.replace(/^file:\/\/\/?/i, '');
  } else if (!WINDOWS_ABS_RE.test(href)) {
    if (SCHEME_RE.test(href)) return ''; // http:, https:, mailto:, tel:, data:, ...
    if (href.startsWith('/') || href.startsWith('\\')) return ''; // app/server route or //host
    if (/^www\./i.test(href)) return '';
  }
  const path = href.split(/[?#]/)[0].replace(/^\.\//, '').trim();
  if (!path || /[\u0000-\u001f<>"]/.test(path)) return '';
  const last = path.split(/[\\/]/).pop() || '';
  if (!FILE_EXT_RE.test(last)) return '';
  // `[site](example.com)` is a bare domain, not a workspace file.
  if (!/[\\/]/.test(path) && BARE_DOMAIN_RE.test(last)) return '';
  return path;
}

function attr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Rewrites sanitized anchors that point at workspace files. toUrl(path) builds
// the authenticated fallback URL (workspaceMediaUrl in utils.js).
export function resolveWorkspaceFileLinks(html, toUrl) {
  const source = String(html || '');
  if (!source.includes('<a')) return source;
  return source.replace(/<a\b([^>]*?)\shref="([^"]*)"([^>]*)>/gi, (match, before, href, after) => {
    if (/\sdata-workspace-file=/i.test(match)) return match;
    const path = workspaceFilePathFromHref(href);
    if (!path) return match;
    let url = '';
    try { url = typeof toUrl === 'function' ? String(toUrl(path) || '') : ''; } catch { url = ''; }
    // Never put the device pairing token (?pt=) in a copy/shareable link href.
    // A normal tap opens the authenticated viewer; the href is only a fallback.
    url = url.replace(/([?&])pt=[^&#]*&?/g, '$1').replace(/[?&](?=#|$)/, '');
    return `<a${before} href="${attr(url || href.replace(/&amp;/g, '&'))}" data-workspace-file="${attr(path)}"${after}>`;
  });
}
