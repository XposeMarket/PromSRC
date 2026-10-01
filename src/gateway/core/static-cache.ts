// Build assets are content-hashed. Everything else retains its existing
// revalidation policy, including HTML, the asset manifest and service worker.
export function staticCacheControl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.endsWith('/index.html')) return 'no-cache';
  if (/\/build\/(?:entries|chunks|styles|inline)\/[^/]+-[a-z0-9]{8,}\.(?:js|css)$/i.test(normalized)) {
    return 'public, max-age=31536000, immutable';
  }
  if (normalized.includes('/static/') || normalized.includes('/vendor/') || normalized.includes('/assets/')) {
    return 'public, max-age=86400';
  }
  return 'no-cache';
}
