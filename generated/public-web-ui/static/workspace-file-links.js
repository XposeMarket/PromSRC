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
// sheet or the desktop Canvas. The fallback href points at the inline media
// route (pairing token stripped) so a non-JS open still resolves the file.
//
// Pure string helpers only (no DOM) so node tests can import this module.

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABS_RE = /^[a-z]:[\\/]/i;
const FILE_EXT_RE = /\.[a-z0-9_-]{1,12}$/i;
// Web TLDs that are rarely file extensions. `.md`, `.sh`, `.py` and `.rs` are
// TLDs too, so this is a short denylist rather than an allowlist of file types.
const WEB_TLD_RE = /\.(?:com|org|net|io|ai|co|dev|app|gov|edu|xyz|us|uk|ca|de|me|tv|gg)$/i;
const VERSION_RE = /^v?\d+(?:\.\d+)+$/i;
const EMAIL_RE = /^[^@\s\\/]+@[^@\s\\/]+\.[a-z]{2,}$/i;

function decodeHref(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

// Returns the workspace path a markdown link points at, or '' when the link is
// a web URL, an app route, an in-page anchor, or not a file.
export function workspaceFilePathFromHref(rawHref) {
  let href = String(rawHref || '').trim().replace(/&amp;/g, '&').trim();
  if (!href || href.startsWith('#')) return '';
  // Drop the literal query/fragment BEFORE decoding so an encoded %23 / %3F
  // stays part of the filename instead of truncating it.
  href = decodeHref(href.split(/[?#]/)[0]).trim();
  if (!href) return '';
  // Explicit local intent (./x, ../x, file://, C:\x) skips the web heuristics.
  let local = /^\.{1,2}[\\/]/.test(href) || WINDOWS_ABS_RE.test(href);
  if (/^file:\/\//i.test(href)) {
    href = href.replace(/^file:\/\/\/?/i, '');
    local = true;
  } else if (!WINDOWS_ABS_RE.test(href)) {
    if (SCHEME_RE.test(href)) return ''; // http:, https:, mailto:, tel:, data:, ...
    if (href.startsWith('/') || href.startsWith('\\')) return ''; // app/server route or //host
    if (/^www\./i.test(href)) return '';
  }
  const path = href.replace(/^\.\//, '').trim();
  if (!path || /[\u0000-\u001f<>"]/.test(path)) return '';
  const segments = path.split(/[\\/]/);
  const last = segments[segments.length - 1] || '';
  if (!FILE_EXT_RE.test(last)) return '';
  if (!local) {
    if (VERSION_RE.test(last)) return ''; // v1.2, docs/2.0
    if (EMAIL_RE.test(segments[0])) return ''; // user@example.dev
    if (WEB_TLD_RE.test(segments[0])) return ''; // example.dev, example.com/page.html
  }
  return path;
}

function attr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Rewrites sanitized anchors that point at workspace files. toUrl(path) builds
// the fallback URL (workspaceMediaUrl in utils.js).
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
