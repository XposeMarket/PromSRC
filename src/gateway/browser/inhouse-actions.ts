
/**
 * browser-tools.ts - Browser Automation for Prometheus
 *
 * Strategy: use the Electron in-house browser by default in the desktop app.
 * The Prometheus-owned Chrome/CDP lane and the user's Chrome extension remain
 * available as explicit secondary targets.
 * Background agents, tasks, and team agents get isolated persistent profiles
 * and CDP ports derived from their stable owner identity.
 *
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import { getUserChromeRelay } from '../user-chrome-relay.js';

import { BrowserObserveMode, BrowserPerformanceObserver, markBrowserPerformance } from './types.js';
import { resolveSessionId } from './extraction.js';
import { callInHouseBrowser, getInHouseSession } from './inhouse.js';
import { resolveInHouseProfileId, upsertInHouseSession, broadcastInHouseBrowserStatus, recoverInHouseSessionMapping } from './inhouse-sessions.js';
import { resolveBrowserObserveMode, shouldReturnSnapshot, attachShortcutsContext } from './observation.js';
import { boundedBrowserSnapshot } from './snapshot-format.js';
import { buildBrowserRunJsEnvelopeSource, formatBrowserRunJsEnvelope } from './diagnostics.js';
import { setLastBrowserScreenshot } from './state.js';


export async function browserOpenInHouse(
  sessionId: string,
  rawUrl: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  let targetUrl = String(rawUrl || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(targetUrl)) targetUrl = `https://${targetUrl}`;
  try {
    const state: any = await callInHouseBrowser('open', { sessionId: resolved, url: targetUrl, profile: resolveInHouseProfileId(resolved) });
    if (!state || typeof state !== 'object' || !String(state.url || '').trim()) {
      return `ERROR: In-house browser open returned no page state; session=${resolved}.`;
    }
    const inHouse = upsertInHouseSession(resolved, state);
    broadcastInHouseBrowserStatus(resolved, 'browser_open', 'Opened in Prometheus in-house browser.', {
      active: true,
      url: inHouse.url,
      title: inHouse.title,
    });
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_open');
    if (shouldReturnSnapshot(observeMode)) {
      return await browserSnapshotInHouse(resolved);
    }
    return `Browser opened in Prometheus in-house browser.\nPage: ${inHouse.title || inHouse.url}\nURL: ${inHouse.url}`;
  } catch (err: any) {
    return `ERROR: In-house browser open failed: ${err.message}`;
  }
}

export async function browserSnapshotInHouse(sessionId: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (!getInHouseSession(resolved)) return 'ERROR: No in-house browser session. Use browser_open with target="inhouse" first.';
  try {
    const result: any = await callInHouseBrowser('snapshot', { sessionId: resolved });
    if (typeof result?.snapshot !== 'string' || !result.snapshot.trim()) {
      return `ERROR: In-house browser snapshot returned no observation evidence; session=${resolved}. Retry browser_snapshot once the page is ready.`;
    }
    const rawSnapshot = result.snapshot.trim();
    const inHouse = upsertInHouseSession(resolved, result);
    inHouse.lastSnapshot = boundedBrowserSnapshot(rawSnapshot);
    inHouse.lastSnapshotAt = Date.now();
    const snapshot = boundedBrowserSnapshot(rawSnapshot);
    broadcastInHouseBrowserStatus(resolved, 'browser_snapshot', 'Snapshot captured from Prometheus in-house browser.', {
      active: true,
      url: inHouse.url,
      title: inHouse.title,
    });
    return attachShortcutsContext(snapshot, inHouse.url, resolved);
  } catch (err: any) {
    return `ERROR: In-house browser snapshot failed: ${err.message}`;
  }
}

// Only observation modes wait for a paint/DOM quiet signal. This is a bounded
// best-effort readiness hint, NOT proof that the click reached an event listener.
export async function waitForInHouseClickReadiness(sessionId: string): Promise<string> {
  const script = `new Promise(resolve => {
    let finished = false;
    let timeout;
    let quiet;
    let observer;
    const done = reason => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout); clearTimeout(quiet); observer?.disconnect(); resolve(reason);
    };
    timeout = setTimeout(() => done('timeout'), 180);
    if (document.visibilityState !== 'visible') return done('hidden_unverified');
    try {
      observer = new MutationObserver(() => {
        clearTimeout(quiet);
        quiet = setTimeout(() => done('dom_quiet'), 45);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      requestAnimationFrame(() => { if (!finished) { clearTimeout(quiet); quiet = setTimeout(() => done('frame_quiet'), 45); } });
    } catch { done('unavailable'); }
  })`;
  try {
    const result: any = await callInHouseBrowser('run-js', { sessionId, code: script });
    return typeof result === 'string' ? result : String(result?.result || result?.value || 'unavailable');
  } catch { return 'unavailable'; }
}


export async function browserClickInHouse(
  sessionId: string,
  target: number | { ref?: number; element?: string; selector?: string },
  options?: { observe?: BrowserObserveMode; onPerformanceStage?: BrowserPerformanceObserver },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const inHouse = getInHouseSession(resolved);
  if (!inHouse) return 'ERROR: No in-house browser session. Use browser_open with target="inhouse" first.';
  const requestedSelector = typeof target === 'object' && target !== null ? String(target.selector || '').trim() : '';
  const requestedRef = typeof target === 'number'
    ? Number(target)
    : Number((target && typeof target === 'object' ? target.ref : 0) || 0);
  if (!requestedSelector && (!Number.isFinite(requestedRef) || requestedRef <= 0)) {
    return 'ERROR: In-house browser click currently requires ref or selector.';
  }
  const startedAt = performance.now();
  let nativeRpcMs = 0;
  let readinessMs = 0;
  let observationMs = 0;
  let settledBy = 'not_requested';
  const observeMode = options?.observe || resolveBrowserObserveMode('browser_click');
  const record = () => markBrowserPerformance(options?.onPerformanceStage, 'click_timing', {
    nativeRpcMs: Math.round(nativeRpcMs * 10) / 10,
    readinessMs: Math.round(readinessMs * 10) / 10,
    observationMs: Math.round(observationMs * 10) / 10,
    totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
    observeMode, settledBy,
  });
  try {
    const clicked: any = await callInHouseBrowser('click', { sessionId: resolved, ref: requestedRef, selector: requestedSelector });
    nativeRpcMs = performance.now() - startedAt;
    if (shouldReturnSnapshot(observeMode)) {
      const readinessStartedAt = performance.now();
      settledBy = await waitForInHouseClickReadiness(resolved);
      readinessMs = performance.now() - readinessStartedAt;
      const observationStartedAt = performance.now();
      const snapshot = await browserSnapshotInHouse(resolved);
      observationMs = performance.now() - observationStartedAt;
      record();
      if (snapshot.startsWith('ERROR')) return `ERROR: Click action completed, but its observation failed. Do not repeat the click; retry browser_observe.\n${snapshot}`;
      return `Clicked ${requestedSelector || `@${requestedRef}`} (${clicked?.role || 'element'}: "${clicked?.name || ''}")\n\n${snapshot}`;
    }
    // compact/delta/screenshot have no inline observation in this native handler.
    // Never charge them for readiness or imply they verified the resulting page.
    broadcastInHouseBrowserStatus(resolved, 'browser_click', `Clicked ${requestedSelector || `@${requestedRef}`} in Prometheus in-house browser.`, {
      active: true,
    });
    record();
    return `Clicked ${requestedSelector || `@${requestedRef}`} (${clicked?.role || 'element'}: "${clicked?.name || ''}").`;
  } catch (err: any) {
    markBrowserPerformance(options?.onPerformanceStage, 'click_error_timing', { totalMs: Math.round(performance.now() - startedAt), observeMode });
    return `ERROR: In-house browser click failed: ${err.message}`;
  }
}

export async function browserFillInHouse(
  sessionId: string,
  target: number | { ref?: number; element?: string; selector?: string },
  text: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const inHouse = getInHouseSession(resolved);
  if (!inHouse) return 'ERROR: No in-house browser session. Use browser_open with target="inhouse" first.';
  const requestedSelector = typeof target === 'object' && target !== null ? String(target.selector || '').trim() : '';
  const requestedRef = typeof target === 'number'
    ? Number(target)
    : Number((target && typeof target === 'object' ? target.ref : 0) || 0);
  if (!requestedSelector && (!Number.isFinite(requestedRef) || requestedRef <= 0)) {
    return 'ERROR: In-house browser fill currently requires ref or selector.';
  }
  try {
    const filled: any = await callInHouseBrowser('fill', { sessionId: resolved, ref: requestedRef, selector: requestedSelector, text: String(text || '') });
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_fill');
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await browserSnapshotInHouse(resolved);
      if (snapshot.startsWith('ERROR')) return `ERROR: Fill action completed, but its observation failed. Do not repeat the fill; retry browser_observe.\n${snapshot}`;
      return `Filled ${requestedSelector || `@${requestedRef}`} (${filled?.role || 'element'}: "${filled?.name || ''}") with "${String(text || '').slice(0, 50)}".\n\n${snapshot}`;
    }
    broadcastInHouseBrowserStatus(resolved, 'browser_fill', `Filled ${requestedSelector || `@${requestedRef}`} in Prometheus in-house browser.`, {
      active: true,
    });
    return `Filled ${requestedSelector || `@${requestedRef}`} (${filled?.role || 'element'}: "${filled?.name || ''}") with "${String(text || '').slice(0, 50)}".`;
  } catch (err: any) {
    return `ERROR: In-house browser fill failed: ${err.message}`;
  }
}

export type BrowserKeyOptions = {
  observe?: BrowserObserveMode;
  hold_ms?: number;
  keys?: string[];
  sequence?: Array<{ key?: string; keys?: string[]; hold_ms?: number; wait_ms?: number }>;
  tab_id?: string;
};

export function validatedNativeKeyOptions(options?: BrowserKeyOptions): Record<string, unknown> | string {
  if (!options) return {};
  const payload: Record<string, unknown> = {};
  if (options.hold_ms !== undefined) {
    if (!Number.isInteger(options.hold_ms) || options.hold_ms < 0 || options.hold_ms > 5000) return 'hold_ms must be an integer between 0 and 5000.';
    payload.holdMs = options.hold_ms;
  }
  if (options.keys !== undefined) {
    if (!Array.isArray(options.keys) || options.keys.length < 1 || options.keys.length > 4 || options.keys.some(k => typeof k !== 'string' || !k.trim())) return 'keys must contain 1�4 nonempty key names.';
    if (options.keys.some(k => /^(enter|return|space|spacebar|delete|backspace)$/i.test(k.trim()) || /^(key[a-z]|digit[0-9])$/i.test(k.trim()) || /^[a-z0-9]$/i.test(k.trim()))) return 'keys cannot include printable/submit/edit keys until chord final-action approval checking is supported.';
    payload.keys = options.keys;
  }
  if (options.sequence !== undefined) {
    if (!Array.isArray(options.sequence) || options.sequence.length < 1 || options.sequence.length > 32) return 'sequence must contain 1�32 steps.';
    let duration = Number(options.hold_ms || 0);
    const steps: Array<Record<string, unknown>> = [];
    for (const step of options.sequence) {
      if (!step || typeof step !== 'object') return 'sequence steps must be objects.';
      const keys = step.keys;
      if (keys !== undefined && (!Array.isArray(keys) || keys.length < 1 || keys.length > 4 || keys.some(k => typeof k !== 'string' || !k.trim()))) return 'sequence step keys must contain 1�4 nonempty key names.';
      if (step.key !== undefined && (typeof step.key !== 'string' || !step.key.trim())) return 'sequence step key must be a nonempty string.';
      // The final-action approval gate currently inspects the top-level key, not
      // arbitrary keys nested in a sequence. Reject those until the gate supports them.
      if ([step.key, ...(keys || [])].some(k => /^(enter|return|space|spacebar|delete|backspace)$/i.test(String(k || '').trim()) || /^(key[a-z]|digit[0-9])$/i.test(String(k || '').trim()) || /^[a-z0-9]$/i.test(String(k || '').trim()))) return 'sequence cannot include submit, printable, or editing keys until nested final-action approval checking is supported.';
      if (keys === undefined && step.key === undefined && step.wait_ms === undefined) return 'sequence step needs key, keys, or wait_ms.';
      if (step.hold_ms !== undefined && (!Number.isInteger(step.hold_ms) || step.hold_ms < 0 || step.hold_ms > 5000)) return 'sequence hold_ms must be an integer between 0 and 5000.';
      if (step.wait_ms !== undefined && (!Number.isInteger(step.wait_ms) || step.wait_ms < 0 || step.wait_ms > 5000)) return 'sequence wait_ms must be an integer between 0 and 5000.';
      duration += Number(step.hold_ms || 0) + Number(step.wait_ms || 0);
      steps.push({ ...(step.key === undefined ? {} : { key: step.key }), ...(keys === undefined ? {} : { keys }), ...(step.hold_ms === undefined ? {} : { holdMs: step.hold_ms }), ...(step.wait_ms === undefined ? {} : { waitMs: step.wait_ms }) });
    }
    if (duration > 10000) return 'sequence total requested duration must not exceed 10000ms.';
    payload.sequence = steps;
  }
  return payload;
}

export async function browserPressKeyInHouse(sessionId: string, key: string, options?: BrowserKeyOptions): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const session = getInHouseSession(resolved);
  if (!session) return 'ERROR: No in-house browser session. Use browser_open with target="inhouse" first.';
  const extra = validatedNativeKeyOptions(options);
  if (typeof extra === 'string') return `ERROR: ${extra} No input sent.`;
  try {
    if (options?.tab_id !== undefined && (!options.tab_id || options.tab_id !== session.activeTabId)) return 'ERROR: tab_id must match the active in-house tab; no input sent.';
    await callInHouseBrowser('input', { sessionId: resolved, tabId: session.activeTabId, action: 'key', key, ...extra });
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_press_key');
    if (shouldReturnSnapshot(observeMode)) return await browserSnapshotInHouse(resolved);
    const actionLabel = options?.sequence ? 'Input sequence acknowledged' : options?.keys ? 'Key chord acknowledged' : `Key "${key}" acknowledged`;
    broadcastInHouseBrowserStatus(resolved, 'browser_press_key', `${actionLabel} in Prometheus in-house browser.`, { active: true });
    return `${actionLabel} in Prometheus in-house browser (delivery not verified).`;
  } catch (err: any) {
    return `ERROR: In-house browser key press failed: ${err.message}`;
  }
}

export async function browserTypeInHouse(sessionId: string, text: string, options?: { observe?: BrowserObserveMode }): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  if (!getInHouseSession(resolved)) return 'ERROR: No in-house browser session. Use browser_open with target="inhouse" first.';
  try {
    await callInHouseBrowser('input', { sessionId: resolved, action: 'text', text: String(text || '') });
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_type');
    if (shouldReturnSnapshot(observeMode)) return await browserSnapshotInHouse(resolved);
    broadcastInHouseBrowserStatus(resolved, 'browser_type', `Typed ${String(text || '').length} chars in Prometheus in-house browser.`, { active: true });
    return `Typed ${String(text || '').length} chars in Prometheus in-house browser.`;
  } catch (err: any) {
    return `ERROR: In-house browser type failed: ${err.message}`;
  }
}

export async function browserRunJsInHouse(sessionId: string, code: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const inHouse = getInHouseSession(resolved);
  if (!inHouse) return 'ERROR: No in-house browser session. Use browser_open with target="inhouse" first.';
  if (!String(code || '').trim()) return 'ERROR: code parameter is required.';
  try {
    const result = await callInHouseBrowser('run-js', { sessionId: resolved, code: buildBrowserRunJsEnvelopeSource(code) });
    broadcastInHouseBrowserStatus(resolved, 'browser_run_js', 'Ran JavaScript in Prometheus in-house browser.', { active: true });
    return formatBrowserRunJsEnvelope(result);
  } catch (err: any) {
    return `ERROR: In-house browser run-js failed: ${err.message}`;
  }
}

export async function browserVisionScreenshotInHouse(sessionId: string): Promise<{
  base64: string;
  width: number;
  height: number;
  mimeType?: 'image/png' | 'image/jpeg';
  viewportWidth?: number;
  viewportHeight?: number;
  coordinateScale?: { x: number; y: number };
  normalized?: boolean;
} | null> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error || !getInHouseSession(resolved)) return null;
  let shot: any = null;
  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      shot = await callInHouseBrowser('screenshot', { sessionId: resolved });
      break;
    } catch (err: any) {
      lastError = err;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }
  if (!shot) throw lastError || new Error('Native browser screenshot returned no image.');
  const imgW = Number(shot?.width || 0);
  const imgH = Number(shot?.height || 0);
  const cssW = Number(shot?.viewportWidth || imgW) || imgW;
  const cssH = Number(shot?.viewportHeight || imgH) || imgH;
  // The captured PNG is in physical pixels (devicePixelRatio applied). Map model
  // image coordinates back to CSS pixels for native input via coordinateScale.
  const scaleX = imgW > 0 ? cssW / imgW : 1;
  const scaleY = imgH > 0 ? cssH / imgH : 1;
  const normalized = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
  const out = {
    base64: String(shot?.base64 || ''),
    width: imgW,
    height: imgH,
    mimeType: 'image/png' as const,
    viewportWidth: cssW,
    viewportHeight: cssH,
    coordinateScale: { x: scaleX, y: scaleY },
    normalized,
  };
  if (!out.base64 || imgW <= 0 || imgH <= 0) {
    // A live session that returns an empty/0x0 image means Electron capturePage had
    // nothing to paint (view detached, canvas closed, or tab hidden). Do not collapse
    // this into `null`, which the executor reports as "No browser session".
    throw new Error(
      `Browser screenshot returned an empty image (${imgW}x${imgH}). The in-house browser view is likely hidden or detached; open the browser panel / select the tab and retry, or use browser_observe(action:"snapshot") for DOM state.`,
    );
  }
  setLastBrowserScreenshot(resolved, out);
  return out;
}

/**
 * Current in-app browser frame for the login handoff viewer (mobile). Returns
 * the PNG plus the CSS viewport so the client can map taps to page coordinates.
 */
// Auth providers a site's login may bounce through; their cookies are what
// make "already signed in with Google/Apple/Microsoft" work after import.
export const LOGIN_IMPORT_PROVIDER_DOMAINS = ['google.com', 'accounts.google.com', 'youtube.com', 'apple.com', 'appleid.apple.com', 'live.com', 'microsoftonline.com', 'github.com'];

// Sites whose sign-in session lives on a sibling domain. Without these a
// ChatGPT import only copied chatgpt.com + Google and missed auth.openai.com.
export const LOGIN_IMPORT_SIBLING_DOMAINS: Record<string, string[]> = {
  'chatgpt.com': ['openai.com'],
  'openai.com': ['chatgpt.com'],
  'x.com': ['twitter.com'],
  'twitter.com': ['x.com'],
  'claude.ai': ['anthropic.com'],
  'anthropic.com': ['claude.ai'],
};

export function registrableDomain(host: string): string {
  const parts = String(host || '').toLowerCase().replace(/^\.+/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const twoPartTld = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoPartTld ? -3 : -2).join('.');
}

/** Login view mode for the phone viewer (phone-sized layout on/off). */
export async function browserLoginHandoffView(sessionId: string, mode: 'phone' | 'off', width?: number, height?: number): Promise<any> {
  const resolved = resolveSessionId(sessionId);
  if (!getInHouseSession(resolved)) throw new Error('No in-app browser is open for this chat yet.');
  return callInHouseBrowser('login-view', { sessionId: resolved, mode, width, height });
}

/** Editable field rects + nav state so the phone can open its real keyboard. */
export async function browserLoginHandoffState(sessionId: string): Promise<any> {
  const resolved = resolveSessionId(sessionId);
  if (!getInHouseSession(resolved)) throw new Error('No in-app browser is open for this chat yet.');
  return callInHouseBrowser('login-state', { sessionId: resolved });
}

export async function browserLoginHandoffNavigate(sessionId: string, action: 'back' | 'forward' | 'reload'): Promise<any> {
  const resolved = resolveSessionId(sessionId);
  if (!getInHouseSession(resolved)) throw new Error('No in-app browser is open for this chat yet.');
  return callInHouseBrowser('navigate', { sessionId: resolved, action });
}

/**
 * "Use my Chrome": copy the user's existing sign-in for the current site (and
 * its auth providers) from their real Chrome via the paired Personal Chrome
 * extension into this chat's in-app browser, then reload. Chrome's own
 * cookies API returns decrypted values, which sidesteps app-bound encryption
 * (the reason copying Chrome's cookie DB fails on Windows). Values never reach
 * the model; only counts are returned.
 */
export async function browserLoginImportFromChrome(sessionId: string, extraDomains: string[] = []): Promise<{ imported: number; received: number; failedCount: number; domains: string[]; byDomain: Record<string, number>; failed: string[]; url: string; openedUrl: string }> {
  const resolved = resolveSessionId(sessionId);
  const inHouse: any = getInHouseSession(resolved);
  if (!inHouse) throw new Error('No in-app browser is open for this chat yet.');
  const relay = getUserChromeRelay();
  // A suspended MV3 worker reconnects on its next wake; give it a moment
  // instead of failing with a misleading "not paired".
  if (!relay.getStatus().authenticated && !(await relay.waitForPeer(8_000))) {
    throw new Error(relay.disconnectedMessage());
  }
  // The gateway's cached URL goes stale once the user moves to a provider page
  // (e.g. accounts.google.com mid-OAuth). Ask Electron for the live URL and keep
  // the cached one as the originating site.
  let liveUrl = '';
  try { liveUrl = String((await callInHouseBrowser('login-state', { sessionId: resolved }))?.url || ''); } catch {}
  const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };
  const providerSet = new Set(LOGIN_IMPORT_PROVIDER_DOMAINS.map(registrableDomain));
  const candidates = [registrableDomain(hostOf(String(inHouse.url || ''))), registrableDomain(hostOf(liveUrl))].filter(Boolean);
  const origin = candidates.find((d) => !providerSet.has(d)) || candidates[0] || '';
  const siblings = candidates.flatMap((d) => LOGIN_IMPORT_SIBLING_DOMAINS[d] || []);
  const domains = [...new Set([...candidates, ...siblings, ...extraDomains.map(registrableDomain), ...LOGIN_IMPORT_PROVIDER_DOMAINS].filter(Boolean))].slice(0, 20);
  console.log(`[login-handoff] import-chrome session=${resolved} origin=${origin || '-'} live=${hostOf(liveUrl) || '-'} domains=${domains.join(',')}`);
  let got: any;
  try {
    got = await relay.request('cookies.forDomains', { domains }, 20_000);
  } catch (err: any) {
    // Chrome keeps running an unpacked extension's OLD service worker until the
    // user presses Reload on it, so a paired v1.0 worker rejects this method.
    if (/Unsupported Personal Chrome relay method/i.test(String(err?.message || err))) {
      throw new Error('Your Chrome is still running the old Prometheus extension. In Chrome open chrome://extensions and press the reload icon on "Prometheus Personal Chrome", then tap Use my Chrome again.');
    }
    throw err;
  }
  const cookies = Array.isArray(got?.cookies) ? got.cookies : [];
  const res: any = await callInHouseBrowser('import-cookies', { sessionId: resolved, cookies });
  const imported = Number(res?.imported || 0);
  const failedCount = Number(res?.failedCount || 0);
  const byDomain: Record<string, number> = res?.byDomain && typeof res.byDomain === 'object' ? res.byDomain : {};
  const failed: string[] = Array.isArray(res?.failed) ? res.failed.map(String) : [];
  // Counts and cookie NAMES@domain for failures only; never cookie values.
  console.log(`[login-handoff] import-chrome result received=${cookies.length} imported=${imported} failed=${failedCount} byDomain=${JSON.stringify(byDomain)}${failed.length ? ` firstFailures=${JSON.stringify(failed.slice(0, 3))}` : ''}`);
  // Reloading /auth/login (or a provider page mid-OAuth) just shows the login
  // form again even when signed in, so open the originating site instead.
  let openedUrl = '';
  if (imported > 0 && origin) {
    openedUrl = `https://${origin === 'openai.com' ? 'chatgpt.com' : origin}/`;
    try { await callInHouseBrowser('navigate', { sessionId: resolved, action: 'open', url: openedUrl }); } catch { openedUrl = ''; }
  }
  if (!openedUrl) { try { await callInHouseBrowser('navigate', { sessionId: resolved, action: 'reload' }); } catch {} }
  return { imported, received: cookies.length, failedCount, domains, byDomain, failed, url: liveUrl || String(inHouse.url || ''), openedUrl };
}

export function browserLoginChromePaired(): boolean {
  try { return !!getUserChromeRelay().getStatus().authenticated; } catch { return false; }
}

export async function browserLoginHandoffFrame(sessionId: string): Promise<{
  base64: string;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  url: string;
  title: string;
}> {
  const shot = await browserVisionScreenshotInHouse(sessionId);
  if (!shot) throw new Error('No in-app browser is open for this chat yet.');
  const inHouse: any = getInHouseSession(resolveSessionId(sessionId));
  return {
    base64: shot.base64,
    width: shot.width,
    height: shot.height,
    viewportWidth: Number(shot.viewportWidth || shot.width),
    viewportHeight: Number(shot.viewportHeight || shot.height),
    url: String(inHouse?.url || ''),
    title: String(inHouse?.title || ''),
  };
}
