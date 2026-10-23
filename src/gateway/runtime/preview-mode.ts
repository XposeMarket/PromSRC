/**
 * Preview-mode guard for disposable review gateways (PROMETHEUS_PREVIEW_MODE=1).
 *
 * A preview gateway boots a PR worktree against copied data. It must never run
 * outward side effects (schedulers, channels, funnel, MCP, interrupted-run
 * recovery) or rotate OAuth refresh tokens that the live gateway shares.
 *
 * Dependency-free on purpose: imported from startup and auth refresh paths.
 */

type EnvLike = { readonly [key: string]: string | undefined };

const PREVIEW_ENV_KEY = 'PROMETHEUS_PREVIEW_MODE';
const skippedLabels = new Set<string>();
let bannerLogged = false;

export function isPreviewMode(env: EnvLike = process.env): boolean {
  const raw = String(env[PREVIEW_ENV_KEY] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Returns true when the subsystem named by `label` must not start in preview mode. */
export function skipInPreview(label: string, env: EnvLike = process.env): boolean {
  if (!isPreviewMode(env)) return false;
  if (!skippedLabels.has(label)) {
    skippedLabels.add(label);
    console.log(`[PreviewMode] skipped ${label}`);
  }
  return true;
}

export class PreviewRefreshBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewRefreshBlockedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Throws in preview mode: refresh tokens rotate in the live gateway only. */
export function assertTokenRefreshAllowed(label: string, env: EnvLike = process.env): void {
  if (!isPreviewMode(env)) return;
  throw new PreviewRefreshBlockedError(
    `Preview gateway: ${label} token refresh is disabled (shared refresh tokens belong to the live gateway). Reconnect or refresh in the live gateway.`,
  );
}

export function logPreviewModeBanner(): void {
  if (bannerLogged) return;
  bannerLogged = true;
  console.log('[PreviewMode] Preview gateway: schedulers, channels, funnel, MCP, recovery and OAuth refresh are disabled.');
}
