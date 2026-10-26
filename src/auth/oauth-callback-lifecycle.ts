import type { Server, ServerResponse } from 'http';

export function oauthErrorResponse(res: ServerResponse, message: string, status = 200): void {
  const escaped = message.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<html><body><h2>${escaped}</h2><p>You can close this window.</p></body></html>`);
}

/** One login owns its listener, timer and result. Late work cannot settle its successor. */
export class OAuthCallbackLifecycle<R> {
  private server?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  private settled = false;
  private claimed = false;
  constructor(private readonly current: () => boolean, private readonly complete: (result: R) => void) {}
  isActive(): boolean { return !this.settled && this.current(); }
  assertActive(): void { if (!this.isActive()) throw new Error('OAuth flow is no longer active.'); }
  claim(): boolean {
    if (!this.isActive() || this.claimed) return false;
    this.claimed = true;
    return true;
  }
  accept(url: URL, res: ServerResponse, state: string): boolean {
    // Never consume a pending login or reflect provider input before validating state.
    if (url.searchParams.get('state') !== state) {
      oauthErrorResponse(res, 'Invalid OAuth state.', 400);
      return false;
    }
    if (!this.claim()) { oauthErrorResponse(res, 'OAuth callback already handled or expired.', 409); return false; }
    return true;
  }
  attach(server: Server): void { this.server = server; }
  arm(result: R): void {
    if (!this.isActive() || this.timer) return;
    this.timer = setTimeout(() => this.finish(result), 5 * 60 * 1000);
  }
  closeListener(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.server?.close();
    this.server = undefined;
  }
  finish(result: R): boolean {
    if (!this.isActive()) return false;
    this.settled = true;
    this.closeListener();
    this.complete(result);
    return true;
  }
}
