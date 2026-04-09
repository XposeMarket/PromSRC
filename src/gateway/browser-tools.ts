/**
 * browser-tools.ts - Browser Automation for Prometheus
 * 
 * Strategy: Connect to user's Chrome via CDP (--remote-debugging-port=9222).
 * If Chrome isn't running with the debug port, launch it ourselves with a
 * dedicated Prometheus profile so it doesn't conflict with the user's Chrome.
 * 
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import { formatShortcutsForUrl } from './site-shortcuts';

type PwBrowser = any;
type PwContext = any;
type PwPage = any;

interface BrowserSession {
  browser: PwBrowser;
  context: PwContext;
  page: PwPage;
  lastSnapshot: string;
  lastSnapshotAt: number;  // epoch ms when lastSnapshot was captured; 0 = never
  createdAt: number;
}

interface SnapElement {
  ref: number;
  tag: string;        // raw tag name
  role: string;       // semantic role for the LLM
  name: string;       // visible text / label
  type?: string;      // input type="" if applicable
  placeholder?: string;
  value?: string;
  isInput: boolean;   // can this be filled?
}

export type BrowserPageType = 'x_feed' | 'search_results' | 'article' | 'chat_interface' | 'generic';

export interface BrowserFeedItem {
  id?: string;
  author?: string;
  handle?: string;
  time?: string;
  text?: string;
  link?: string;
  title?: string;
  snippet?: string;
  source?: string;
  metrics?: {
    likes?: string;
    replies?: string;
    reposts?: string;
    views?: string;
  };
}

export interface BrowserAdvisorPacket {
  page: {
    title: string;
    url: string;
    pageType: BrowserPageType;
  };
  snapshot: string;
  snapshotElements: number;
  extractedFeed: BrowserFeedItem[];
  textBlocks: string[];
  pageText: string;          // visible body text for non-feed pages (chat responses, articles)
  isGenerating: boolean;    // true when a chat interface is still streaming a response
  contentHash: string;
}

function attachShortcutsContext(output: string, url: string): string {
  const text = String(output || '');
  // Do not double-inject if shortcuts block is already present
  if (text.includes('SITE SHORTCUTS FOR')) return text;
  const shortcutsBlock = formatShortcutsForUrl(url);
  // No saved shortcuts for this host — return as-is
  if (!shortcutsBlock) return text;
  // Always inject shortcuts even when base output is empty so every browser
  // tool response carries the shortcut context regardless of page content.
  return text ? `${text}\n\n${shortcutsBlock}` : shortcutsBlock;
}

// ─── Session Management ────────────────────────────────────────────────────────

const sessions: Map<string, BrowserSession> = new Map();

// ─── Browser Vision Screenshot Cache ─────────────────────────────────────────
// Stores the last browser_vision_screenshot result per session so chat.router.ts
// can inject it as a role:'user' vision message (OpenAI doesn't support images in tool messages).
const _lastBrowserScreenshot: Map<string, { base64: string; width: number; height: number; ts: number }> = new Map();

export function setLastBrowserScreenshot(sessionId: string, data: { base64: string; width: number; height: number }): void {
  _lastBrowserScreenshot.set(sessionId, { ...data, ts: Date.now() });
}

export function getLastBrowserScreenshot(sessionId: string): { base64: string; width: number; height: number } | null {
  const entry = _lastBrowserScreenshot.get(sessionId);
  if (!entry) return null;
  // Expire after 60 seconds — stale screenshots are useless
  if (Date.now() - entry.ts > 60_000) {
    _lastBrowserScreenshot.delete(sessionId);
    return null;
  }
  return { base64: entry.base64, width: entry.width, height: entry.height };
}

export function clearLastBrowserScreenshot(sessionId: string): void {
  _lastBrowserScreenshot.delete(sessionId);
}

// ─── Network Intercept Store ───────────────────────────────────────────────────
interface NetworkLogEntry {
  url: string;
  method: string;
  status: number;
  contentType: string;
  body?: string;
  ts: number;
}
const _networkInterceptLog: Map<string, NetworkLogEntry[]> = new Map();
const _networkInterceptHandlers: Map<string, (response: any) => void> = new Map();

// ─── Macro Recording Store (browser-side: element watch state) ────────────────
// Per-session snapshot hash stored for delta computation
const _snapshotHashCache: Map<string, string> = new Map();

let playwrightModule: any = null;
let playwrightChecked = false;

function ensurePlaywrightBrowsersPath(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  try {
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.homedir(), '.playwright-browsers');
  } catch {
    // Best-effort only; Playwright has its own defaults.
  }
}

async function findBundledChromiumExecutable(): Promise<string | null> {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const home = os.homedir();
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, '.playwright-browsers'),
    path.join(home, '.playwright-browsers'),
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? path.join(home, 'AppData', 'Local', 'ms-playwright')
        : path.join(home, '.cache', 'ms-playwright'),
  ];

  const exeCandidates = process.platform === 'darwin'
    ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? ['chrome-win/chrome.exe']
      : ['chrome-linux/chrome'];

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const dirs = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith('chromium-'))
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a));
      for (const dir of dirs) {
        for (const rel of exeCandidates) {
          const candidate = path.join(root, dir, rel);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // Continue scanning other roots.
    }
  }
  return null;
}

async function getPW(): Promise<any | null> {
  if (playwrightChecked) return playwrightModule;
  playwrightChecked = true;
  ensurePlaywrightBrowsersPath();
  try {
    playwrightModule = await (Function('return import("playwright")')() as Promise<any>);
    return playwrightModule;
  } catch {
    console.warn('[Browser] Playwright not installed. Run: npm install playwright && npx playwright install chromium');
    return null;
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/json/version`);
    return resp.ok;
  } catch { return false; }
}

async function isSessionAlive(session: BrowserSession): Promise<boolean> {
  try {
    // A closed page will throw on .url() or return 'about:blank' after CDP disconnect
    const url = session.page.url();
    // Also ping the debug port to confirm the underlying Chrome process is still up
    const debugPort = Number(process.env.CHROME_DEBUG_PORT || '9222');
    const alive = await isPortOpen(debugPort);
    return alive;
  } catch {
    return false;
  }
}

/**
 * Returns the path to the user's real Chrome profile directory.
 * Used when CHROME_USE_REAL_PROFILE=true — allows Prometheus to reuse
 * existing login sessions instead of starting fresh with an isolated profile.
 * WARNING: Chrome must be fully closed before connecting, or CDP will reject it.
 */
function getRealChromeProfileDir(): string {
  const os = require('os') as typeof import('os');
  const home = os.homedir();
  if (process.platform === 'win32') {
    return `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\User Data`;
  } else if (process.platform === 'darwin') {
    return `${home}/Library/Application Support/Google/Chrome`;
  }
  return `${home}/.config/google-chrome`;
}

async function getOrCreateSession(sessionId: string): Promise<BrowserSession> {
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId)!;
    // Verify the session is still usable — if Chrome was closed externally the
    // page/browser objects are dead and every tool call will fail with
    // "Target page, context or browser has been closed". Evict and recreate.
    const alive = await isSessionAlive(existing);
    if (alive) return existing;
    console.log(`[Browser] Session "${sessionId}" is dead (Chrome was closed). Evicting and relaunching...`);
    sessions.delete(sessionId);
    try { await existing.page.close(); } catch {}
    try { await existing.browser.close(); } catch {}
  }

  const pw = await getPW();
  if (!pw) throw new Error('Playwright not installed. Run: npm install playwright && npx playwright install chromium');

  const debugPort = Number(process.env.CHROME_DEBUG_PORT || '9222');
  let browser: any;

  // Step 1: Try connecting to an existing Chrome with debug port
  if (await isPortOpen(debugPort)) {
    try {
      browser = await pw.chromium.connectOverCDP(`http://localhost:${debugPort}`);
      console.log(`[Browser] Connected to existing Chrome on port ${debugPort}`);
    } catch (e: any) {
      console.warn(`[Browser] Port ${debugPort} responded but CDP connect failed: ${e.message}`);
    }
  }

  // Step 2: Launch Chrome ourselves if not connected
  if (!browser) {
    console.log(`[Browser] Launching Chrome with --remote-debugging-port=${debugPort}...`);

    const chromePaths = [
      process.env.CHROME_PATH,
      process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
      process.platform === 'linux' ? '/usr/bin/google-chrome' : '',
      process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : '',
      process.platform === 'linux' ? '/usr/bin/chromium-browser' : '',
      process.platform === 'linux' ? '/usr/bin/chromium' : '',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      await findBundledChromiumExecutable(),
    ].filter(Boolean) as string[];

    const fs = await import('fs');
    const chromePath = chromePaths.find(p => fs.existsSync(p));

    if (chromePath) {
      const path = await import('path');
      const os = await import('os');
      const profileDir = process.env.CHROME_PROFILE
        || path.join(os.homedir(), '.prometheus', 'chrome-debug-profile');

      // Ensure profile dir exists
      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

      const { spawn } = await import('child_process');
      spawn(chromePath, [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
      ], { detached: true, stdio: 'ignore' }).unref();

      console.log(`[Browser] Chrome profile: ${profileDir} (log in once, saved forever)`);

      // Wait for Chrome to start
      let connected = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await isPortOpen(debugPort)) {
          try {
            browser = await pw.chromium.connectOverCDP(`http://localhost:${debugPort}`);
            connected = true;
            break;
          } catch { /* retry */ }
        }
      }
      if (!connected) throw new Error(`Chrome launched but did not respond on port ${debugPort} after 15s. Close any existing Chrome windows and try again.`);
      console.log(`[Browser] Launched and connected to Chrome on port ${debugPort}`);
    } else {
      console.log('[Browser] No system Chrome found; launching Playwright Chromium directly.');
      browser = await pw.chromium.launch({ headless: false });
    }
  }

  // Get or create a context, then a page
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pages = context.pages();
  // Use existing blank page or create new
  const page = pages.find((p: any) => p.url() === 'about:blank') || await context.newPage();

  const session: BrowserSession = { browser, context, page, lastSnapshot: '', lastSnapshotAt: 0, createdAt: Date.now() };
  sessions.set(sessionId, session);
  console.log(`[Browser] Session created for ${sessionId}`);

  // Auto-handle OAuth popups (e.g. "Continue as Raul" Google sign-in dialog).
  // These appear as new pages in the context and are invisible to the DOM snapshot.
  // We click the primary confirm button automatically so the agent doesn't get stuck.
  context.on('page', async (popup: any) => {
    try {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const popupUrl = popup.url();
      console.log(`[Browser] Popup opened: ${popupUrl}`);
      // Google OAuth confirm page: click the blue continue/confirm button
      const confirmSelectors = [
        'button[id="submit_approve_access"]',  // Google OAuth approve
        'button:has-text("Continue")',
        'button:has-text("Allow")',
        'button:has-text("Confirm")',
        'button:has-text("Accept")',
        '#submit_approve_access',
      ];
      for (const sel of confirmSelectors) {
        try {
          const btn = popup.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click();
            console.log(`[Browser] Auto-clicked popup confirm: ${sel}`);
            break;
          }
        } catch { /* try next selector */ }
      }
    } catch (err: any) {
      console.warn(`[Browser] Popup handler error: ${err.message}`);
    }
  });

  return session;
}

// ─── DOM-Based Snapshot (works on ALL Playwright versions) ─────────────────────

async function takeSnapshot(page: PwPage, maxElements: number = 100): Promise<string> {
  try {
    const title = await page.title();
    const url = page.url();

    // Scrape the DOM directly — no dependency on accessibility APIs
    const snapshotData: {
      elements: SnapElement[];
      diagnostics: {
        scanned: number;
        included: number;
        hidden: number;
        unlabeled_non_input: number;
        unnamed_input_included: number;
      };
      modalOpen: boolean;
      modalLabel: string;
    } = await page.evaluate((max: number) => {
      const doc = (globalThis as any).document;
      // Expanded selector set — includes data-testid (React apps), explicit search inputs
      const selector = [
        'a[href]', 'button', 'input', 'select', 'textarea',
        'input[type="search"]', 'input[type="text"]',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="search"]',
        '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]',
        '[contenteditable="true"]',
        '[data-testid]',
        'h1', 'h2', 'h3',
      ].join(', ');

      // ── Modal / dialog detection ───────────────────────────────────────────
      // If a modal or dialog is open, ONLY elements inside it are interactable.
      // Scanning the full DOM would expose background elements the AI cannot
      // actually click (they are aria-hidden or covered by the overlay).
      // Priority: aria-modal dialogs > role=dialog > data-testid dialogs.
      const openModal = (
        doc.querySelector('[role="dialog"][aria-modal="true"]')
        || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
        || doc.querySelector('[data-testid="sheetDialog"], [data-testid="confirmationSheetDialog"], [data-testid="keyboardShortcutModal"]')
        || doc.querySelector('dialog[open]')
        // X.com reply-permission dropdown and other sheets that aren't role=dialog
        || doc.querySelector('[data-testid="Dropdown"]')
        || doc.querySelector('[role="menu"]')
        || null
      );
      const searchRoot = openModal || doc;

      // De-duplicate nodes (data-testid + input could match same element twice)
      const seen = new Set<any>();
      const nodes: any[] = [];
      for (const el of Array.from(searchRoot.querySelectorAll(selector))) {
        if (!seen.has(el)) { seen.add(el); nodes.push(el); }
        if (nodes.length >= max) break;
      }

      const results: any[] = [];
      const diagnostics = {
        scanned: nodes.length,
        included: 0,
        hidden: 0,
        unlabeled_non_input: 0,
        unnamed_input_included: 0,
      };

      // ── Stable ref assignment using data-sc-ref attributes ─────────────────
      // Pre-scan all existing data-sc-ref values so we never reassign a taken ref.
      // Elements that already have data-sc-ref keep the SAME ref across DOM mutations
      // (React re-renders, SPA route changes) — this eliminates ref-drift entirely.
      const usedRefs = new Set<number>();
      for (const anyEl of Array.from(doc.querySelectorAll('[data-sc-ref]'))) {
        const n = parseInt((anyEl as any).getAttribute('data-sc-ref') || '', 10);
        if (!isNaN(n) && n > 0) usedRefs.add(n);
      }
      let _nextRef = 1;
      const assignRef = (el: any): number => {
        const existing = el.getAttribute('data-sc-ref');
        if (existing) {
          const n = parseInt(existing, 10);
          if (!isNaN(n) && n > 0) return n;
        }
        while (usedRefs.has(_nextRef)) _nextRef++;
        const r = _nextRef++;
        usedRefs.add(r);
        try { el.setAttribute('data-sc-ref', String(r)); } catch { /* read-only frame */ }
        return r;
      };

      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const tag = el.tagName.toLowerCase();
        const ariaRole = el.getAttribute('role') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const inputType = el.getAttribute('type') || '';
        const testId = el.getAttribute('data-testid') || '';
        const text = (el.innerText || '').trim().slice(0, 80);
        const val = el.value ? String(el.value).slice(0, 60) : '';
        const isContentEditable = el.getAttribute('contenteditable') === 'true';
        const inputLikeTag = ['input', 'textarea', 'select'].includes(tag) || isContentEditable;

        // Determine visible name — prefer aria-label, then text, then placeholder, then data-testid
        let name = ariaLabel || text || placeholder || testId || '';
        if (!name && tag === 'input') name = placeholder || inputType || 'input';
        if (!name && isContentEditable) name = 'editable';

        // Skip invisible or empty non-interactive elements
        if (!name && !inputLikeTag) {
          diagnostics.unlabeled_non_input++;
          continue;
        }
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        const hiddenByBox =
          (el.offsetWidth === 0 && el.offsetHeight === 0)
          || (rect ? (rect.width === 0 && rect.height === 0) : false);
        const style = typeof (globalThis as any).getComputedStyle === 'function'
          ? (globalThis as any).getComputedStyle(el)
          : null;
        const hiddenByStyle =
          !!style
          && (style.display === 'none' || style.visibility === 'hidden');
        if (hiddenByBox || hiddenByStyle) {
          diagnostics.hidden++;
          continue;
        }

        // Determine semantic role
        let role = ariaRole || tag;
        if (tag === 'a') role = 'link';
        if (tag === 'button' || ariaRole === 'button') role = 'button';
        if (tag === 'input' && ['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(inputType)) role = 'textbox';
        if (tag === 'input' && inputType === 'search') role = 'searchbox';
        if (tag === 'textarea') role = 'textbox';
        if (tag === 'select' || ariaRole === 'combobox' || ariaRole === 'listbox') role = 'combobox';
        if (ariaRole === 'searchbox' || ariaRole === 'textbox') role = ariaRole;
        if (tag === 'input' && inputType === 'checkbox') role = 'checkbox';
        if (tag === 'input' && inputType === 'radio') role = 'radio';

        const isInput = ['textbox', 'searchbox', 'combobox', 'textarea'].includes(role)
          || (tag === 'input' && ['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(inputType))
          || tag === 'textarea'
          || isContentEditable;

        if (!name && isInput) diagnostics.unnamed_input_included++;

        results.push({
          // Stable ref: persists across DOM mutations via data-sc-ref attribute
          ref: assignRef(el),
          tag,
          role,
          // Use placeholder as name fallback so model sees "Search Reddit" not empty string
          name: (name || placeholder || '').slice(0, 80),
          type: inputType || undefined,
          placeholder: placeholder || undefined,
          value: val || undefined,
          isInput,
          testId: testId || undefined,
        });
      }
      diagnostics.included = results.length;
      const modalLabel = openModal
        ? (openModal.getAttribute('aria-label') || openModal.getAttribute('aria-labelledby') && (doc.getElementById(openModal.getAttribute('aria-labelledby') || '') as any)?.innerText || openModal.getAttribute('data-testid') || 'dialog')
        : '';
      return { elements: results, diagnostics, modalOpen: !!openModal, modalLabel: String(modalLabel || '').trim().slice(0, 80) };
    }, maxElements);
    const rawElements = Array.isArray(snapshotData?.elements) ? snapshotData.elements : [];
    const elements: SnapElement[] = rawElements
      .map((raw: any) => {
        const role = String(raw?.role || raw?.tag || 'element').trim().toLowerCase() || 'element';
        const tag = String(raw?.tag || role || 'div').trim().toLowerCase() || 'div';
        const name = String(raw?.name || raw?.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const type = raw?.type ? String(raw.type).replace(/\s+/g, ' ').trim().slice(0, 40) : undefined;
        const placeholder = raw?.placeholder
          ? String(raw.placeholder).replace(/\s+/g, ' ').trim().slice(0, 80)
          : undefined;
        const value = raw?.value
          ? String(raw.value).replace(/\s+/g, ' ').trim().slice(0, 60)
          : undefined;
        const isInput = !!raw?.isInput
          || ['textbox', 'searchbox', 'combobox', 'textarea'].includes(role)
          || tag === 'input'
          || tag === 'textarea'
          || tag === 'select';
        // Use the stable ref from data-sc-ref attribute (set during page.evaluate)
        const ref = Number.isFinite(Number(raw?.ref)) && Number(raw.ref) > 0 ? Number(raw.ref) : 0;
        return { ref, tag, role, name, type, placeholder, value, isInput };
      })
      .filter((el) => el.ref > 0 && (el.name.length > 0 || el.isInput));

    const toCount = (value: unknown, fallback: number): number => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
    };
    const rawDiagnostics = snapshotData?.diagnostics && typeof snapshotData.diagnostics === 'object'
      ? snapshotData.diagnostics as Record<string, unknown>
      : {};
    const diagnostics = {
      scanned: toCount(rawDiagnostics.scanned, Math.max(rawElements.length, elements.length)),
      included: elements.length,
      hidden: toCount(rawDiagnostics.hidden, 0),
      unlabeled_non_input: toCount(rawDiagnostics.unlabeled_non_input, 0),
      unnamed_input_included: toCount(rawDiagnostics.unnamed_input_included, 0),
    };
    if (diagnostics.scanned < diagnostics.included) {
      diagnostics.scanned = diagnostics.included;
    }

    // Build compact text for the LLM
    const displayUrlRaw = String(url || '').replace(/\s+/g, ' ').trim();
    const displayUrl = displayUrlRaw.length > 360 ? `${displayUrlRaw.slice(0, 357)}...` : displayUrlRaw;
    const lines = [
      `Page: ${title}`,
      `Elements (${elements.length}):`,
      `Snapshot diagnostics: scanned=${diagnostics.scanned} included=${diagnostics.included} hidden=${diagnostics.hidden} unlabeled_non_input=${diagnostics.unlabeled_non_input} unnamed_input_included=${diagnostics.unnamed_input_included}`,
      `URL: ${displayUrl}`,
      '',
    ];
    for (const el of elements) {
      let line = `[@${el.ref}] ${el.role}`;
      // Always show a name — fall back to placeholder so inputs are never shown as [@N] textbox ""
      const displayName = el.name || (el as any).placeholder || '';
      if (displayName) line += ` "${displayName}"`;
      if (el.isInput) line += ' [INPUT]';
      if (el.value) line += ` value="${el.value}"`;
      lines.push(line);
    }
    const snapshotText = lines.join('\n');

    // Modal / dialog open — warn the AI so it doesn't try to interact with background elements.
    if (snapshotData?.modalOpen) {
      const label = snapshotData.modalLabel ? ` ("${snapshotData.modalLabel}")` : '';
      return snapshotText
        + `\n\n[MODAL OPEN]${label} A dialog/modal is blocking the page. The ${elements.length} elements above are ONLY the controls inside this modal. Background page elements are NOT accessible until the modal is closed. To dismiss: look for a Close button or press Escape with browser_press_key({"key":"Escape"}).`;
    }

    // Login wall detection — append an explicit action hint so the agent doesn't loop.
    // If the page looks like a login wall and there's a one-click sign-in button, say so.
    const elementText = elements.map(e => e.name).join(' ').toLowerCase();
    const isLoginWall = /join today|sign in|log in|create account/i.test(title + ' ' + elementText);
    if (isLoginWall) {
      const signInRef = elements.find(e =>
        /sign in as|continue as|sign in with google|sign in with apple/i.test(e.name)
      );
      if (signInRef) {
        return snapshotText + `\n\n[LOGIN PAGE DETECTED] Click @${signInRef.ref} ("${signInRef.name}") to sign in immediately. Do NOT loop on snapshots.`;
      }
      const plainSignIn = elements.find(e => /^sign in$/i.test(e.name.trim()));
      if (plainSignIn) {
        return snapshotText + `\n\n[LOGIN PAGE DETECTED] Click @${plainSignIn.ref} ("${plainSignIn.name}") to proceed to the login form.`;
      }
    }

    // ── Low-element heuristic: try same-origin frame piercing, flag cross-origin ─
    // If the main document has few elements, content is likely in iframes.
    // Same-origin frames: we can scan their elements directly via Playwright frames().
    // Cross-origin frames: we cannot read them, but we surface the URL for navigation.
    if (elements.length < 15) {
      try {
        const pageOrigin = (() => { try { return new URL(url).origin; } catch { return ''; } })();

        // Collect iframe info from DOM
        const iframeInfo: Array<{ src: string; id: string; name: string; width: number; height: number }> =
          await page.evaluate(() => {
            return Array.from((globalThis as any).document.querySelectorAll('iframe'))
              .map((f: any) => ({
                src: f.src || f.getAttribute('src') || '',
                id: f.id || '',
                name: f.name || f.getAttribute('title') || '',
                width: f.offsetWidth,
                height: f.offsetHeight,
              }))
              .filter((f: any) => f.src && !f.src.startsWith('javascript') && f.width > 60 && f.height > 60)
              .slice(0, 8);
          });

        const crossOrigin: typeof iframeInfo = [];
        const sameOriginElements: string[] = [];

        // Try to pierce same-origin frames via Playwright's frames() API
        for (const frameHandle of page.frames()) {
          try {
            const fUrl = frameHandle.url();
            if (!fUrl || fUrl === 'about:blank' || fUrl === url) continue;
            // Check if this frame matches one of the DOM iframes
            const matchInfo = iframeInfo.find(f => f.src && fUrl.startsWith(f.src.split('?')[0]));
            const frameOrigin = (() => { try { return new URL(fUrl).origin; } catch { return ''; } })();
            if (pageOrigin && frameOrigin && frameOrigin !== pageOrigin) {
              // Cross-origin: flag it
              if (matchInfo) crossOrigin.push(matchInfo);
              continue;
            }
            // Same-origin: scan elements inside this frame
            const frameData = await frameHandle.evaluate((max: number) => {
              const doc = (globalThis as any).document;
              const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]';
              const results: any[] = [];
              let nextRef = 1;
              const usedRefs = new Set<number>();
              for (const el of Array.from(doc.querySelectorAll(sel)).slice(0, max) as any[]) {
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || tag;
                const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || '').slice(0, 80);
                if (!name && !['input','textarea','select'].includes(tag)) continue;
                const rect = el.getBoundingClientRect?.();
                if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0)) continue;
                // Assign stable ref in this frame too
                const existing = el.getAttribute('data-sc-ref');
                let ref: number;
                if (existing) { ref = parseInt(existing, 10); } else {
                  while (usedRefs.has(nextRef)) nextRef++;
                  ref = nextRef++;
                  usedRefs.add(ref);
                  try { el.setAttribute('data-sc-ref', String(ref)); } catch {}
                }
                results.push({ ref, role, name, tag, isInput: ['input','textarea','select'].includes(tag) });
              }
              return results;
            }, 60).catch(() => []);

            for (const el of frameData) {
              const frameLabel = matchInfo ? (matchInfo.name || matchInfo.id || new URL(fUrl).hostname) : new URL(fUrl).hostname;
              let line = `[@${el.ref}] ${el.role} "${el.name}" [frame:${frameLabel}]`;
              if (el.isInput) line += ' [INPUT]';
              sameOriginElements.push(line);
            }
          } catch { /* cross-origin frame, skip */ }
        }

        // Any iframe in DOM but NOT reachable via page.frames() is cross-origin
        for (const fi of iframeInfo) {
          const fOrigin = (() => { try { return new URL(fi.src).origin; } catch { return ''; } })();
          if (pageOrigin && fOrigin && fOrigin !== pageOrigin && !crossOrigin.find(c => c.src === fi.src)) {
            crossOrigin.push(fi);
          }
        }

        const extras: string[] = [];
        if (sameOriginElements.length > 0) {
          extras.push(`\n[SAME-ORIGIN FRAME ELEMENTS — interactable via normal browser_click/browser_fill]\n${sameOriginElements.join('\n')}`);
        }
        if (crossOrigin.length > 0) {
          const lines = crossOrigin.map(f => `  - ${f.name || f.id || 'iframe'} → ${f.src.slice(0, 200)}`).join('\n');
          extras.push(`\n[CROSS-ORIGIN IFRAMES — content cannot be read directly; navigate with browser_open]\n${lines}`);
        }
        if (extras.length > 0) {
          return snapshotText + extras.join('');
        }
      } catch { /* best effort */ }

      // ── Fallback: append visible body text so AI can still read content ─────
      try {
        const bodyText = await page.evaluate(() => {
          const el = (globalThis as any).document.body;
          if (!el) return '';
          return (el.innerText || el.textContent || '')
            .replace(/\s{3,}/g, '\n')
            .trim()
            .slice(0, 3000);
        });
        if (bodyText && bodyText.length > 100) {
          return snapshotText + '\n\n[PAGE TEXT \u2014 low element count, showing visible content]\n' + bodyText;
        }
      } catch { /* best effort */ }
    }

    return snapshotText;
  } catch (err: any) {
    return `Snapshot error: ${err.message}`;
  }
}

// ─── Element Interaction ───────────────────────────────────────────────────────

// Shared selector used consistently across snapshot + click + fill
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  'input[type="search"]', 'input[type="text"]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="search"]',
  '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]',
  '[contenteditable="true"]',
  '[data-testid]',
  'h1', 'h2', 'h3',
].join(', ');

// Click a page element by its stable data-sc-ref number
async function clickByRef(page: PwPage, ref: number): Promise<{ role: string; name: string }> {
  // Primary path: use the stable data-sc-ref attribute written by takeSnapshot.
  // Falls back to the old positional scan if the attribute is missing (e.g. snapshot
  // was taken by an older version or the attr was stripped by a page reload).
  const result = await page.evaluate((refNum: number) => {
    const doc = (globalThis as any).document;
    // Direct lookup by stable ref — O(1), immune to DOM reordering
    let el: any = doc.querySelector(`[data-sc-ref="${refNum}"]`);
    if (!el) return null; // caller falls back to positional scan

    el.scrollIntoView({ block: 'center' });
    el.focus();
    el.click();
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase() || tag;
    const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || tag).slice(0, 80);
    return { role, name };
  }, ref);

  if (!result) {
    // Fallback: positional scan (legacy path for elements without data-sc-ref)
    const fallback = await page.evaluate((args: { refIdx: number; sel: string }) => {
      const doc = (globalThis as any).document;
      const openModal = (
        doc.querySelector('[role="dialog"][aria-modal="true"]')
        || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
        || doc.querySelector('dialog[open]')
        || doc.querySelector('[role="menu"]')
        || null
      );
      const searchRoot = openModal || doc;
      let counter = 0;
      for (const el of Array.from(searchRoot.querySelectorAll(args.sel)) as any[]) {
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const isContentEditable = el.getAttribute('contenteditable') === 'true';
        const isInputLike = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
        const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80) || (isContentEditable ? 'editable' : '');
        if (!name && !isInputLike) continue;
        const rect = el.getBoundingClientRect?.();
        if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0 && rect.height === 0)) continue;
        const style = (globalThis as any).getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
        counter++;
        if (counter === args.refIdx) {
          el.scrollIntoView({ block: 'center' });
          el.focus();
          el.click();
          return { role: role || tag, name: name || tag };
        }
      }
      return null;
    }, { refIdx: ref, sel: INTERACTIVE_SELECTOR });
    if (!fallback) throw new Error(`Element @${ref} not found`);
    await page.waitForTimeout(1500);
    return fallback;
  }
  await page.waitForTimeout(1500);
  return result;
}

// Fill a page element by its stable data-sc-ref number
async function fillByRef(page: PwPage, ref: number, text: string): Promise<{ role: string; name: string; needsNativeType?: boolean }> {
  // Primary: stable data-sc-ref lookup
  const result = await page.evaluate((args: { ref: number; text: string }) => {
    const doc = (globalThis as any).document;
    const el = doc.querySelector(`[data-sc-ref="${args.ref}"]`);
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const isContentEditable = el.getAttribute('contenteditable') === 'true';
    const isInput = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
    const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80) || (isContentEditable ? 'editable' : '');
    if (!isInput) return { error: `Element @${args.ref} (${el.getAttribute('role') || tag}) is not a text input.` };
    el.scrollIntoView({ block: 'center' });
    el.focus();
    if (tag === 'select') {
      el.value = args.text;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (isContentEditable) {
      el.click();
      return { role: role || tag, name: name || tag, needsNativeType: true };
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor((globalThis as any).HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor((globalThis as any).HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(el, args.text);
      else el.value = args.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { role: role || tag, name: name || tag };
  }, { ref, text });

  if (result === null) {
    // Fallback: positional scan (legacy path for elements without data-sc-ref)
    const fallback = await page.evaluate((args: { ref: number; text: string; sel: string }) => {
      const doc = (globalThis as any).document;
      const openModal = doc.querySelector('[role="dialog"][aria-modal="true"]') || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])') || doc.querySelector('dialog[open]') || doc.querySelector('[role="menu"]') || null;
      const searchRoot = openModal || doc;
      let counter = 0;
      for (const el of Array.from(searchRoot.querySelectorAll(args.sel)) as any[]) {
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const isContentEditable = el.getAttribute('contenteditable') === 'true';
        const isInput = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
        const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80) || (isContentEditable ? 'editable' : '');
        if (!name && !isInput) continue;
        const rect = el.getBoundingClientRect?.();
        if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0 && rect.height === 0)) continue;
        const style = (globalThis as any).getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
        counter++;
        if (counter === args.ref) {
          if (!isInput) return { error: `Element @${args.ref} (${el.getAttribute('role') || tag}) is not a text input.` };
          el.scrollIntoView({ block: 'center' }); el.focus();
          if (tag === 'select') { el.value = args.text; el.dispatchEvent(new Event('change', { bubbles: true })); }
          else if (isContentEditable) { el.click(); return { role: role || tag, name: name || tag, needsNativeType: true }; }
          else {
            const nativeSetter = Object.getOwnPropertyDescriptor((globalThis as any).HTMLInputElement.prototype, 'value')?.set || Object.getOwnPropertyDescriptor((globalThis as any).HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(el, args.text); else el.value = args.text;
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { role: role || tag, name: name || tag };
        }
      }
      return { error: `Element @${args.ref} not found` };
    }, { ref, text, sel: INTERACTIVE_SELECTOR });
    if (!fallback || (fallback as any).error) throw new Error((fallback as any)?.error || `Element @${ref} not found`);
    // contenteditable native-type path for fallback
    if ((fallback as any).needsNativeType) {
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+A');
      await page.waitForTimeout(100);
      await page.keyboard.type(text, { delay: 20 });
      await page.waitForTimeout(400);
    } else {
      await page.waitForTimeout(800);
    }
    return { role: (fallback as any).role, name: (fallback as any).name, needsNativeType: !!(fallback as any).needsNativeType };
  }

  if (!result || (result as any).error) throw new Error((result as any)?.error || `Element @${ref} not found`);

  // contenteditable elements (e.g. X.com composer) need Playwright-native typing.
  // The evaluate() click above set DOM focus; now we clear any existing content
  // with Ctrl+A then type the text through the real CDP keyboard pipeline.
  if ((result as any).needsNativeType) {
    // Small wait for React to process the click/focus event
    await page.waitForTimeout(300);
    // Select-all to clear any pre-existing text in the composer
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(100);
    // Type text character by character — this fires real KeyDown/KeyPress/KeyUp/Input
    // events that React's synthetic event system correctly intercepts.
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(400);
  } else {
    await page.waitForTimeout(800);
  }

  return { role: result.role, name: result.name, needsNativeType: !!(result as any).needsNativeType };
}

// Press a key (e.g. Enter, Tab)
async function pressKey(page: PwPage, key: string): Promise<void> {
  await page.keyboard.press(key);
  // Allow page navigation / React state updates to settle
  await page.waitForTimeout(1500);
}

function parseSnapshotElementCount(snapshot: string): number {
  const m = String(snapshot || '').match(/Elements\s*\((\d+)\):/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function stableHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function normalizeFeedItemText(item: BrowserFeedItem): string {
  return [
    item.id || '',
    item.author || '',
    item.handle || '',
    item.time || '',
    item.text || '',
    item.link || '',
    item.title || '',
    item.snippet || '',
    item.source || '',
  ].join('|');
}

function dedupeFeedItems(items: BrowserFeedItem[]): BrowserFeedItem[] {
  const out: BrowserFeedItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.id
      ? `id:${item.id}`
      : item.link
        ? `link:${item.link}`
        : stableHash(normalizeFeedItemText(item).slice(0, 500));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildPacketHash(input: {
  url: string;
  pageType: BrowserPageType;
  snapshot: string;
  extractedFeed: BrowserFeedItem[];
  textBlocks: string[];
  pageText?: string;
}): string {
  const compact = [
    input.url,
    input.pageType,
    input.snapshot.slice(0, 1800),
    ...input.extractedFeed.slice(0, 40).map((i) => normalizeFeedItemText(i)),
    ...input.textBlocks.slice(0, 20),
    (input.pageText || '').slice(0, 800),
  ].join('\n');
  return stableHash(compact);
}

async function extractStructuredFromPage(
  page: PwPage,
  maxItems: number,
): Promise<{
  pageType: BrowserPageType;
  extractedFeed: BrowserFeedItem[];
  textBlocks: string[];
  pageText: string;
  isGenerating: boolean;
}> {
  const extracted = await page.evaluate((max: number) => {
    const doc = (globalThis as any).document;
    const normalize = (v: any, maxLen: number = 400) =>
      String(v || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    const toAbs = (href: string) => {
      try { return new URL(href, (globalThis as any).location.href).toString(); } catch { return String(href || '').trim(); }
    };
    const host = String((globalThis as any).location.hostname || '').toLowerCase();
    const url = String((globalThis as any).location.href || '').toLowerCase();
    const title = normalize((globalThis as any).document.title || '', 180);
    const out: { pageType: any; extractedFeed: any[]; textBlocks: string[]; pageText: string; isGenerating: boolean } = {
      pageType: 'generic',
      extractedFeed: [],
      textBlocks: [],
      pageText: '',
      isGenerating: false,
    };

    // ── Chat interface detection (ChatGPT, Claude, Gemini, etc.) ────────────────
    const isChatInterface = /(^|\.)chatgpt\.com$/.test(host)
      || /(^|\.)claude\.ai$/.test(host)
      || /(^|\.)gemini\.google\.com$/.test(host)
      || /(^|\.)chat\.openai\.com$/.test(host)
      || /\/c\/[a-f0-9-]{8,}/.test(url);   // generic /c/<uuid> conversation URL pattern

    if (isChatInterface) {
      out.pageType = 'chat_interface';

      // Detect if the AI is still generating — look for stop/streaming indicators
      const bodyText = normalize(doc.body?.innerText || '', 200);
      const stopBtn = doc.querySelector(
        'button[aria-label*="Stop"], button[data-testid*="stop"], [aria-label*="Stop generating"], .stop-button',
      );
      const streamingIndicator = doc.querySelector(
        '[data-testid="streaming-indicator"], .result-streaming, [class*="streaming"], [class*="generating"]',
      );
      // Heuristic: page title "ChatGPT" (not yet renamed to conversation topic) + very few response nodes
      const stillOnDefaultTitle = /^chatgpt$/i.test(title.trim());
      out.isGenerating = !!(stopBtn || streamingIndicator);

      // Extract the last assistant message — ChatGPT uses [data-message-author-role="assistant"]
      // Claude.ai uses [data-is-streaming], Gemini uses .model-response-text
      const assistantMsgSelectors = [
        '[data-message-author-role="assistant"]',
        '[data-testid*="conversation-turn"]:last-of-type',
        '.agent-turn',
        '.model-response-text',
        '[class*="AssistantMessage"]',
        '[class*="response-text"]',
      ];
      let lastMsgText = '';
      for (const sel of assistantMsgSelectors) {
        const nodes = Array.from(doc.querySelectorAll(sel)) as any[];
        if (!nodes.length) continue;
        const last = nodes[nodes.length - 1];
        const txt = normalize(last?.innerText || last?.textContent || '', 3000);
        if (txt.length > 60) { lastMsgText = txt; break; }
      }

      // Fallback: grab all paragraph text from main content area
      if (!lastMsgText) {
        const mainArea = doc.querySelector('main, [role="main"], #__next > div:nth-child(2)');
        if (mainArea) lastMsgText = normalize(mainArea?.innerText || '', 3000);
      }

      out.pageText = lastMsgText;
      // Put a short excerpt in textBlocks so existing advisor prompts that read textBlocks also work
      if (lastMsgText) out.textBlocks = [lastMsgText.slice(0, 1200)];
      return out;
    }

    const isX = /(^|\.)x\.com$/.test(host) || /(^|\.)twitter\.com$/.test(host);
    const isSearch = /(search|results|q=)/.test(url) || /(google|bing|duckduckgo|brave|yahoo)\./.test(host);

    if (isX) {
      // Smarter X.com page type detection — not all x.com pages are feed pages.
      // Compose, settings, notifications, and other interactive pages should be 'generic'
      // so the browser advisor treats them as interaction targets, not feed collectors.
      const xPathname = String((globalThis as any).location?.pathname || '');
      const isXComposePage = /^\/(compose|intent)/.test(xPathname);
      const isXSettingsPage = xPathname.startsWith('/settings') || xPathname.startsWith('/i/');
      const isXNotifications = xPathname.startsWith('/notifications');
      const isXHomeFeed = xPathname === '/' || xPathname === '/home' || xPathname === '';
      const isXProfileOrThread = /^\/[a-z0-9_]+(\/(status\/\d+)?)?$/i.test(xPathname) && !isXComposePage && !isXSettingsPage && !isXNotifications;

      if (isXComposePage || isXSettingsPage || isXNotifications) {
        // Interactive page — treat as generic so advisor uses ref-based interaction mode
        out.pageType = 'generic';
        return out;
      } else if (isXHomeFeed || isXProfileOrThread) {
        // Home feed has a composer at the top — if the composer textarea is present
        // in the DOM, treat as generic so the scroll-before-act gate fires and forces
        // the model to interact with the composer rather than scrolling past it.
        const composerPresent = !!doc.querySelector(
          '[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea"], '
          + 'div[contenteditable="true"][aria-label], '
          + 'div[role="textbox"][data-testid]'
        );
        out.pageType = composerPresent ? 'generic' : 'x_feed';
      } else {
        // Unknown x.com path — fall back to generic (safer for interaction)
        out.pageType = 'generic';
        return out;
      }

      const seen = new Set<string>();
      const tweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]')) as any[];
      for (const tw of tweets) {
        const text = normalize(
          Array.from(tw.querySelectorAll('[data-testid="tweetText"]'))
            .map((n: any) => n.innerText || n.textContent || '')
            .join(' '),
          1800,
        );
        const statusLink = tw.querySelector('a[href*="/status/"]') as any;
        const link = statusLink ? toAbs(statusLink.getAttribute('href') || '') : '';
        const idMatch = link.match(/\/status\/(\d+)/);
        const tweetId = idMatch ? idMatch[1] : '';
        const userNameNode = tw.querySelector('[data-testid="User-Name"]') as any;
        const author = normalize(
          userNameNode?.querySelector('span')?.textContent
            || tw.querySelector('a[role="link"] span')?.textContent
            || '',
          120,
        );
        let handle = '';
        const spans = userNameNode ? Array.from(userNameNode.querySelectorAll('span')) : [];
        for (const sp of spans) {
          const val = normalize((sp as any).textContent || '', 80);
          if (/^@[a-z0-9_]{1,30}$/i.test(val)) { handle = val; break; }
        }
        if (!handle) {
          const m = normalize(tw.innerText || '', 500).match(/@[a-z0-9_]{1,30}/i);
          handle = m ? m[0] : '';
        }

        const time = normalize((tw.querySelector('time') as any)?.getAttribute('datetime') || '', 80);
        const replies = normalize((tw.querySelector('[data-testid="reply"]') as any)?.innerText || '', 30);
        const reposts = normalize((tw.querySelector('[data-testid="retweet"]') as any)?.innerText || '', 30);
        const likes = normalize((tw.querySelector('[data-testid="like"]') as any)?.innerText || '', 30);
        const views = normalize((tw.querySelector('[data-testid="viewCount"]') as any)?.innerText || '', 30);

        if (!text && !link) continue;
        const key = tweetId || link || `${handle}|${text.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.extractedFeed.push({
          id: tweetId || undefined,
          author: author || undefined,
          handle: handle || undefined,
          time: time || undefined,
          text: text || undefined,
          link: link || undefined,
          source: 'x',
          metrics: {
            replies: replies || undefined,
            reposts: reposts || undefined,
            likes: likes || undefined,
            views: views || undefined,
          },
        });
        if (out.extractedFeed.length >= max) break;
      }
      return out;
    }

    if (isSearch) {
      out.pageType = 'search_results';
      const cards = Array.from(
        doc.querySelectorAll(
          'div.g, div[data-sokoban-container], li.b_algo, .result, .search-result, article, main section',
        ),
      ) as any[];
      const seen = new Set<string>();
      for (const card of cards) {
        const titleEl = card.querySelector('h3, h2');
        const linkEl = card.querySelector('a[href]');
        const snippetEl = card.querySelector('.VwiC3b, .IsZvec, p, span');
        const titleText = normalize(titleEl?.textContent || '', 220);
        const link = normalize(linkEl ? toAbs(linkEl.getAttribute('href') || '') : '', 500);
        const snippet = normalize(snippetEl?.textContent || '', 500);
        if (!titleText && !snippet) continue;
        const key = link || `${titleText}|${snippet.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.extractedFeed.push({
          title: titleText || undefined,
          link: link || undefined,
          snippet: snippet || undefined,
          source: host,
        });
        if (out.extractedFeed.length >= max) break;
      }
      return out;
    }

    // Generic article-ish content for research pages.
    const paras = Array.from(doc.querySelectorAll('article p, main p, p')) as any[];
    const blocks: string[] = [];
    for (const p of paras) {
      const text = normalize(p.innerText || p.textContent || '', 700);
      if (text.length < 80) continue;
      blocks.push(text);
      if (blocks.length >= max) break;
    }
    out.textBlocks = blocks;
    out.pageText = blocks.slice(0, 6).join(' ');
    if (
      /article|news|blog|post|story/i.test(title)
      || /(news|blog|substack|medium)\./.test(host)
      || blocks.length >= 4
    ) {
      out.pageType = 'article';
    }
    return out;
  }, Math.max(4, Math.min(maxItems, 60)));

  return {
    pageType: extracted.pageType,
    extractedFeed: dedupeFeedItems((extracted.extractedFeed || []) as BrowserFeedItem[]).slice(0, maxItems),
    textBlocks: (Array.isArray(extracted.textBlocks) ? extracted.textBlocks : []).map((s: any) => String(s || '')).filter(Boolean).slice(0, maxItems),
    pageText: String(extracted.pageText || ''),
    isGenerating: !!extracted.isGenerating,
  };
}

// How stale a cached snapshot is allowed to be before we re-scrape for the advisor.
// browser_open / click / fill / scroll all update session.lastSnapshot immediately, so
// in those flows the snapshot is always < 500 ms old. Only browser_wait paths might
// produce a snapshot that drifts, hence the 4-second ceiling.
const SNAPSHOT_CACHE_TTL_MS = 4000;

async function buildAdvisorPacketForSession(
  session: BrowserSession,
  options?: { maxItems?: number; snapshotElements?: number; cachedSnapshotMs?: number },
): Promise<BrowserAdvisorPacket> {
  const maxItems = Math.max(6, Math.min(Number(options?.maxItems || 24), 60));
  const snapshotElements = Math.max(80, Math.min(Number(options?.snapshotElements || 140), 280));

  const title = await session.page.title();
  const url = session.page.url();

  // Reuse the snapshot the tool handler already captured if it's fresh enough.
  // This avoids a second full DOM scrape immediately after browser_open / click / fill / scroll.
  const cacheAgeMs = options?.cachedSnapshotMs ?? SNAPSHOT_CACHE_TTL_MS;
  const snapshotAge = session.lastSnapshotAt ? Date.now() - session.lastSnapshotAt : Infinity;
  let snapshot: string;
  if (session.lastSnapshot && snapshotAge < cacheAgeMs) {
    snapshot = session.lastSnapshot;
  } else {
    snapshot = await takeSnapshot(session.page, snapshotElements);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
  }

  // extractStructuredFromPage is a separate page.evaluate that does its own DOM walk.
  // We still need it for feed/article extraction which the compact snapshot doesn't capture.
  const structured = await extractStructuredFromPage(session.page, maxItems);

  const packet: BrowserAdvisorPacket = {
    page: {
      title: String(title || '').trim(),
      url: String(url || '').trim(),
      pageType: structured.pageType,
    },
    snapshot,
    snapshotElements: parseSnapshotElementCount(snapshot),
    extractedFeed: structured.extractedFeed,
    textBlocks: structured.textBlocks,
    pageText: structured.pageText,
    isGenerating: structured.isGenerating,
    contentHash: buildPacketHash({
      url,
      pageType: structured.pageType,
      snapshot,
      extractedFeed: structured.extractedFeed,
      textBlocks: structured.textBlocks,
      pageText: structured.pageText,
    }),
  };
  return packet;
}

// ─── Exported Tool Handlers ────────────────────────────────────────────────────

// ─── Shared browser session alias ────────────────────────────────────────────
// Task sessions (task_<id>) share the browser connection of the parent user
// session that spawned them.  Without this, each task would try to open a
// fresh CDP connection from a cold start — which always fails mid-task because
// the debug port is already bound to the live user Chrome instance.
//
// Resolution order:
//   1. Exact session match (cache hit)
//   2. If sessionId starts with "task_" and the parent session exists, clone it
//   3. Otherwise create a brand-new session (normal CHAT path)
export function resolveSessionId(sessionId: string): string {
  const sid = String(sessionId || 'default');
  if (sessions.has(sid)) return sid;                       // fast path — already exists
  if (sid.startsWith('task_')) {
    // Walk back to find a live parent: task_<taskId> was spawned from a user
    // session stored in the task record.  Try common parent IDs in order.
    const taskId = sid.slice('task_'.length);
    const { loadTask } = require('./tasks/task-store') as typeof import('./tasks/task-store');
    const task = loadTask(taskId);
    const parentId = task?.sessionId || 'default';
    if (sessions.has(parentId)) {
      console.log(`[Browser] Task session "${sid}" aliased to parent session "${parentId}"`);
      sessions.set(sid, sessions.get(parentId)!);
      return sid;
    }
    // Parent not yet open — fall through so getOrCreateSession makes a fresh one
  }
  return sid;
}

export async function browserOpen(sessionId: string, url: string): Promise<string> {
  // ── URL sanity guard ──────────────────────────────────────────────────────
  // When called from inside the node_call<> VM sandbox the URL may arrive as
  // undefined / null / a stringified object if the model emitted bad code.
  // CDP rejects all of these with "Cannot navigate to invalid URL" and the
  // reactor retries indefinitely — producing the 29-step loop seen in logs.
  const rawUrl = String(url ?? '').trim();
  if (!rawUrl || rawUrl === 'undefined' || rawUrl === 'null' || rawUrl === 'object') {
    return 'ERROR: browser_open requires a valid URL string. Received: ' + JSON.stringify(url);
  }

  const resolvedSessionId = resolveSessionId(sessionId);
  let session: BrowserSession;
  try {
    session = await getOrCreateSession(resolvedSessionId);
  } catch (err: any) {
    return `ERROR: ${err.message}`;
  }

  try {
    let targetUrl = rawUrl;
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Best-effort networkidle wait — catches SPAs that hydrate after domcontentloaded
    // Non-blocking: if it times out that's fine, we just take a snapshot with what's loaded
    await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Extra settle time for React/Next hydration
    await session.page.waitForTimeout(1500);

    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();

    // Attach per-site shortcut context on open and keep it host-driven (no site hardcoding).
    return attachShortcutsContext(snapshot, session.page.url());
  } catch (err: any) {
    return `ERROR: Navigation failed: ${err.message}`;
  }
}

export async function browserSnapshot(sessionId: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  let session = sessions.get(resolved);
  if (session && !(await isSessionAlive(session))) {
    console.log(`[Browser] browserSnapshot: session dead, evicting.`);
    sessions.delete(resolved);
    try { await session.page.close(); } catch {}
    try { await session.browser.close(); } catch {}
    session = undefined;
  }
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    // Wait for the DOM to settle before snapshotting — SPAs (like x.com) may still
    // be hydrating after domcontentloaded, leaving querySelectorAll with 0 results.
    // networkidle is best-effort; we proceed even if it times out.
    await session.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Additional settle time for React/Next/Vue hydration to mount interactive elements.
    await session.page.waitForTimeout(600);
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    return attachShortcutsContext(snapshot, session.page.url());
  } catch (err: any) {
    return `ERROR: Snapshot failed: ${err.message}`;
  }
}

export async function browserClick(sessionId: string, ref: number): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const el = await clickByRef(session.page, ref);
    // Extra settle before snapshot — dialogs / dropdowns / navigation need time
    await session.page.waitForTimeout(500);
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    return attachShortcutsContext(`Clicked @${ref} (${el.role}: "${el.name}")\n\n${snapshot}`, session.page.url());
  } catch (err: any) {
    return `ERROR: Click @${ref} failed: ${err.message}`;
  }
}

export async function browserFill(sessionId: string, ref: number, text: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const el = await fillByRef(session.page, ref, text);

    // After filling, find the submit button closest to the filled element in the DOM.
    // This lets us annotate the snapshot so the model clicks the RIGHT Post button
    // (the composer's) and not a Post button elsewhere on the page (e.g. in the feed).
    // Find the Post/Tweet submit button ref after filling.
    // Strategy: use X.com's stable data-testid first, then fall back to DOM walk.
    // We recount refs using the same filter logic as takeSnapshot to get the correct number.
    const submitHint = await session.page.evaluate((args: { ref: number; sel: string }) => {
      const doc = (globalThis as any).document as any;
      const openModal: any = (
        doc.querySelector('[role="dialog"][aria-modal="true"]')
        || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
        || doc.querySelector('dialog[open]')
        || doc.querySelector('[data-testid="Dropdown"]')
        || doc.querySelector('[role="menu"]')
        || null
      );
      const searchRoot: any = openModal || doc.documentElement;

      // Build the same visible-element list as takeSnapshot so ref numbers match exactly
      const isVisible = (e: any): boolean => {
        const r = typeof e.getBoundingClientRect === 'function' ? e.getBoundingClientRect() : null;
        if (!r || (r.width === 0 && r.height === 0)) return false;
        const style = typeof (globalThis as any).getComputedStyle === 'function' ? (globalThis as any).getComputedStyle(e) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        return true;
      };
      const seen = new Set<any>();
      const all: any[] = [];
      for (const e of Array.from(searchRoot.querySelectorAll(args.sel))) {
        if (!seen.has(e)) { seen.add(e); all.push(e); }
      }
      // Filter same way as takeSnapshot
      const visible = all.filter((e: any) => {
        const tag = e.tagName.toLowerCase();
        const role = (e.getAttribute('role') || '').toLowerCase();
        const ce = e.getAttribute('contenteditable') === 'true';
        const isInput = ['input', 'textarea', 'select'].includes(tag) || ce || ['textbox', 'searchbox', 'combobox'].includes(role);
        const name = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.getAttribute('data-testid') || '').trim().slice(0, 80) || (ce ? 'editable' : '');
        if (!name && !isInput) return false;
        return isVisible(e);
      });

      // Strategy 1: X.com stable testid — tweetButtonInline is the in-timeline composer Post button
      const xPostBtn = doc.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
      if (xPostBtn && isVisible(xPostBtn)) {
        const btnRef = visible.indexOf(xPostBtn) + 1;
        if (btnRef > 0) {
          const label = (xPostBtn.getAttribute('aria-label') || xPostBtn.innerText || 'Post').trim();
          return { ref: btnRef, label, strategy: 'testid' };
        }
      }

      // Strategy 2: Find filled element, walk up DOM to find Post/Tweet button ancestor
      let filledEl: any = null;
      for (let i = 0; i < visible.length; i++) {
        if (i + 1 === args.ref) { filledEl = visible[i]; break; }
      }
      if (!filledEl) return null;

      let ancestor: any = filledEl.parentElement;
      const MAX_DEPTH = 14;
      for (let d = 0; d < MAX_DEPTH && ancestor; d++) {
        const buttons = Array.from(ancestor.querySelectorAll('button, [role="button"]')) as any[];
        for (const btn of buttons) {
          const label = (btn.getAttribute('aria-label') || btn.innerText || '').trim();
          if (/^(post|tweet)$/i.test(label) && isVisible(btn)) {
            const btnRef = visible.indexOf(btn) + 1;
            if (btnRef > 0) return { ref: btnRef, label, strategy: 'walk' };
          }
        }
        ancestor = ancestor.parentElement;
      }
      return null;
    }, { ref, sel: INTERACTIVE_SELECTOR }).catch(() => null);

    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    const snapshotCount = parseSnapshotElementCount(snapshot);

    // ── X.com composer: click Post button directly after a contenteditable fill ──
    // The ref-based hint is unreliable because X renders multiple "Post"-labelled
    // buttons (inline composer + toolbar) and the wrong one gets picked.
    // Strategy: try stable testids in order, fall back to text match.
    // We do this HERE so the model never has to guess the ref.
    if ((el as any).needsNativeType === true) {
      // Only auto-submit for contenteditable fills (the X.com composer case)
      const xPostSelectors = [
        '[data-testid="tweetButtonInline"]',   // home feed inline composer
        '[data-testid="tweetButton"]',          // full /compose modal
      ];
      let clicked = false;
      for (const sel of xPostSelectors) {
        try {
          const btn = session.page.locator(sel).first();
          if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
            await btn.click();
            clicked = true;
            console.log(`[Browser] Auto-clicked Post button via ${sel}`);
            break;
          }
        } catch { /* try next */ }
      }
      if (clicked) {
        // Wait for post to submit and feed to update
        await session.page.waitForTimeout(2000);
        await session.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        const afterSnapshot = await takeSnapshot(session.page);
        session.lastSnapshot = afterSnapshot;
        session.lastSnapshotAt = Date.now();
        return attachShortcutsContext(
          `Filled composer and clicked Post button. Tweet has been posted successfully. Snapshot refreshed (${parseSnapshotElementCount(afterSnapshot)} elements).`,
          session.page.url(),
        );
      }
    }

    // Compact by default: do not dump full snapshot here.
    let result = `Filled @${ref} (${el.role}: "${el.name}") with "${text.slice(0, 50)}". Snapshot refreshed (${snapshotCount} elements).`;
    if (submitHint) {
      result += ` Submit hint: click @${submitHint.ref} ("${submitHint.label}").`;
    }
    return attachShortcutsContext(result, session.page.url());
  } catch (err: any) {
    return `ERROR: Fill @${ref} failed: ${err.message}`;
  }
}

export async function browserPressKey(sessionId: string, key: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    await pressKey(session.page, key);
    // Best-effort networkidle after key press (Enter often triggers navigation)
    await session.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    const count = parseSnapshotElementCount(snapshot);
    return attachShortcutsContext(`Pressed "${key}". Snapshot refreshed (${count} elements).`, session.page.url());
  } catch (err: any) {
    return `ERROR: Key press failed: ${err.message}`;
  }
}

/**
 * Type text into whatever element currently has keyboard focus.
 * Unlike browserFill (which needs a @ref), this just sends keystrokes — works for
 * contenteditable divs (e.g. X/Twitter compose box) where fill by ref often fails.
 */
export async function browserType(sessionId: string, text: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    await session.page.keyboard.type(String(text || ''), { delay: 25 });
    await session.page.waitForTimeout(400);
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    const count = parseSnapshotElementCount(snapshot);
    return attachShortcutsContext(`Typed ${String(text).length} chars into focused element. Snapshot refreshed (${count} elements).`, session.page.url());
  } catch (err: any) {
    return `ERROR: browser_type failed: ${err.message}`;
  }
}

export async function browserWait(sessionId: string, ms: number): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const clamped = Math.min(Math.max(ms || 1000, 500), 8000);
  try {
    await session.page.waitForTimeout(clamped);
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    const count = parseSnapshotElementCount(snapshot);
    return attachShortcutsContext(`Waited ${clamped}ms. Snapshot refreshed (${count} elements).`, session.page.url());
  } catch (err: any) {
    return `ERROR: Wait failed: ${err.message}`;
  }
}

/**
 * Returns info about the currently keyboard-focused element on the page.
 * Critical for navigation shortcuts (j/k on X.com) — tells the AI which tweet/item
 * is currently selected so it knows how many more presses are needed.
 */
export async function browserGetFocusedItem(sessionId: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const info = await session.page.evaluate(() => {
      const doc = (globalThis as any).document;
      const focused = doc.activeElement;
      if (!focused || focused === doc.body) {
        // On X.com, keyboard-focused tweet has data-testid="tweet" and a CSS highlight class
        // Check for X.com highlighted/focused tweet (has outline or aria-selected)
        const highlighted = doc.querySelector(
          'article[data-testid="tweet"][tabindex="0"], article[data-testid="tweet"]:focus-within'
        );
        if (highlighted) {
          const tweetText = (highlighted.querySelector('[data-testid="tweetText"]') as any)?.innerText?.trim()?.slice(0, 120) || '';
          const author = (highlighted.querySelector('[data-testid="User-Name"]') as any)?.innerText?.trim()?.replace(/\n/g, ' ')?.slice(0, 60) || '';
          const link = (highlighted.querySelector('a[href*="/status/"]') as any)?.href || '';
          const idMatch = link.match(/\/status\/(\d+)/);
          // Count position in feed
          const allTweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
          const idx = allTweets.indexOf(highlighted);
          return {
            type: 'tweet',
            position: idx + 1,
            totalVisible: allTweets.length,
            author,
            text: tweetText,
            tweetId: idMatch ? idMatch[1] : '',
            link,
          };
        }
        return { type: 'none', message: 'No element focused. Press j to select first tweet, or click a tweet first.' };
      }

      const tag = focused.tagName?.toLowerCase() || 'unknown';
      const role = focused.getAttribute('role') || '';
      const ariaLabel = focused.getAttribute('aria-label') || '';
      const text = (focused.innerText || '').trim().slice(0, 120);
      const testId = focused.getAttribute('data-testid') || '';

      // Check if this focused element is inside a tweet — find the ancestor article
      let article: any = focused;
      while (article && article.tagName?.toLowerCase() !== 'article') {
        article = article.parentElement;
      }
      if (article && article.getAttribute('data-testid') === 'tweet') {
        const tweetText = (article.querySelector('[data-testid="tweetText"]') as any)?.innerText?.trim()?.slice(0, 120) || '';
        const author = (article.querySelector('[data-testid="User-Name"]') as any)?.innerText?.trim()?.replace(/\n/g, ' ')?.slice(0, 60) || '';
        const link = (article.querySelector('a[href*="/status/"]') as any)?.href || '';
        const idMatch = link.match(/\/status\/(\d+)/);
        const allTweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
        const idx = allTweets.indexOf(article);
        return {
          type: 'tweet',
          position: idx + 1,
          totalVisible: allTweets.length,
          author,
          text: tweetText,
          tweetId: idMatch ? idMatch[1] : '',
          link,
          focusedElement: { tag, role, ariaLabel, testId },
        };
      }

      return {
        type: 'element',
        tag,
        role,
        ariaLabel,
        text,
        testId,
      };
    });

    if (info.type === 'tweet') {
      const lines = [
        `⌨️ KEYBOARD FOCUS: Tweet #${info.position} of ${info.totalVisible} visible`,
        `   Author: ${info.author || '(unknown)'}`,
        `   Text: ${info.text ? info.text.slice(0, 100) : '(no text)'}`,
        info.tweetId ? `   Tweet ID: ${info.tweetId}` : '',
        info.link ? `   Link: ${info.link}` : '',
        ``,
        `NAVIGATION HINT: To reach tweet #N, press j a total of N times from no selection, or adjust from current position.`,
        `Current position is #${info.position}. Press j to go forward, k to go back.`,
      ].filter(Boolean);
      return lines.join('\n');
    }

    if (info.type === 'none') {
      return `⌨️ KEYBOARD FOCUS: No tweet selected\n${info.message}`;
    }

    return `⌨️ KEYBOARD FOCUS: ${info.type} — <${info.tag}> role="${info.role}" label="${info.ariaLabel}" text="${info.text?.slice(0,80)}" testid="${info.testId}"`;
  } catch (err: any) {
    return `ERROR: getFocusedItem failed: ${err.message}`;
  }
}

export async function browserClose(sessionId: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'No browser session to close.';
  try {
    // Don't close the whole browser (user's Chrome) — just close our page
    await session.page.close();
    sessions.delete(sessionId);
    console.log(`[Browser] Session closed for ${sessionId}`);
    return 'Browser tab closed.';
  } catch (err: any) {
    sessions.delete(sessionId);
    return `Browser closed (with warning: ${err.message})`;
  }
}

export async function browserScroll(sessionId: string, direction: 'down' | 'up', multiplier?: number): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const clampedMult = Math.min(Math.max(multiplier || 1.0, 0.5), 4.0);

  try {
    await session.page.evaluate((mult: number) => {
      const pageGlobal = globalThis as any;
      pageGlobal.scrollBy(0, pageGlobal.innerHeight * mult);
    }, direction === 'up' ? -clampedMult : clampedMult);

    await session.page.waitForTimeout(1200); // X/Twitter needs ~1s for new articles to mount

    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    const elementCount = parseSnapshotElementCount(snapshot);
    return attachShortcutsContext(
      `Scrolled ${direction} ${clampedMult}x viewport. ` +
      `Snapshot refreshed (${elementCount} elements). ` +
      `Use browser_snapshot only if you need fresh @ref interactions.`,
      session.page.url(),
    );
  } catch (err: any) {
    return `ERROR: Scroll failed: ${err.message}`;
  }
}

export async function browserScrollCollect(
  sessionId: string,
  options: {
    scrolls?: number;
    direction?: 'down' | 'up';
    multiplier?: number;
    delay_ms?: number;
    stop_text?: string;
    max_chars?: number;
  } = {}
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const scrolls   = Math.min(Math.max(options.scrolls || 5, 1), 30);
  const direction  = options.direction || 'down';
  const mult       = Math.min(Math.max(options.multiplier || 1.5, 0.5), 4.0);
  const delayMs    = Math.min(Math.max(options.delay_ms || 1500, 500), 5000);
  const stopText   = options.stop_text || '';
  const maxChars   = Math.min(Math.max(options.max_chars || 50000, 5000), 100000);

  const seenLines  = new Set<string>();
  const allNewText: string[] = [];
  const scrollLog: string[]  = [];
  let totalChars   = 0;
  let stopReason   = 'completed all scrolls';

  try {
    for (let i = 0; i < scrolls; i++) {
      // Scroll
      const prevScrollY = await session.page.evaluate(() => (globalThis as any).scrollY);
      await session.page.evaluate((m: number) => {
        (globalThis as any).scrollBy(0, (globalThis as any).innerHeight * m);
      }, direction === 'up' ? -mult : mult);

      // Wait for content to load
      await session.page.waitForTimeout(delayMs);

      // Read visible text — with structured extraction for X.com/Twitter
      const pageText = await session.page.evaluate(() => {
        const doc = (globalThis as any).document;
        // X.com structured tweet extraction
        const tweetEls = doc.querySelectorAll('article[data-testid="tweet"]');
        if (tweetEls.length > 0) {
          return Array.from(tweetEls).map((el: any) => {
            const name = el.querySelector('[data-testid="User-Name"]')?.innerText?.replace(/\n/g, ' ') || '';
            const text = el.querySelector('[data-testid="tweetText"]')?.innerText || '';
            const likes = el.querySelector('[data-testid="like"]')?.textContent?.trim() || '';
            const reposts = el.querySelector('[data-testid="retweet"]')?.textContent?.trim() || '';
            return `${name}\n${text}\n♥ ${likes} | ↺ ${reposts}`;
          }).join('\n---TWEET---\n');
        }
        // General fallback — use live body.innerText (not a detached clone)
        const body = doc.body;
        if (!body) return '';
        return (body.innerText || '')
          .replace(/[^\S\n]{3,}/g, ' ')
          .replace(/\n{4,}/g, '\n\n')
          .trim();
      });

      const currentScrollY = await session.page.evaluate(() => (globalThis as any).scrollY);

      // Deduplicate — structured tweets vs general lines
      const isStructuredTweets = pageText.includes('\n---TWEET---\n');
      const chunks = isStructuredTweets
        ? pageText.split('\n---TWEET---\n')
        : pageText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      const newLines: string[] = [];
      for (const chunk of chunks) {
        // For tweets, dedup by tweet text content; for lines, by first 200 chars
        const key = isStructuredTweets
          ? (chunk.split('\n')[1] || chunk).slice(0, 300)
          : chunk.slice(0, 200);
        if (!seenLines.has(key)) {
          seenLines.add(key);
          newLines.push(chunk);
        }
      }

      const newText = isStructuredTweets ? newLines.join('\n---TWEET---\n') : newLines.join('\n');
      const newChars = newText.length;

      scrollLog.push(`  #${i + 1}: +${newChars.toLocaleString()} chars (new), scrollY=${currentScrollY}`);

      if (newChars > 0) {
        allNewText.push(newText);
        totalChars += newChars;
      }

      // Early stop: max chars reached
      if (totalChars >= maxChars) {
        stopReason = 'max_chars reached';
        break;
      }

      // Early stop: page bottom (scroll position didn't change)
      if (currentScrollY === prevScrollY && direction === 'down') {
        scrollLog[scrollLog.length - 1] += ' — page bottom reached, stopping';
        stopReason = 'reached bottom';
        break;
      }

      // Early stop: sentinel text found
      if (stopText && pageText.includes(stopText)) {
        stopReason = `stop_text "${stopText}" found`;
        break;
      }
    }

    // Build result
    const collectedText = allNewText.join('\n\n').slice(0, maxChars);
    const header = [
      `browser_scroll_collect: Scrolled ${direction} ${scrollLog.length} times (stopped: ${stopReason})`,
      `Total text collected: ${totalChars.toLocaleString()} chars | Unique lines: ${seenLines.size}`,
      '',
    ].join('\n');

    const result = [
      header,
      '=== COLLECTED TEXT (deduplicated) ===',
      collectedText,
      '',
      '=== SCROLL LOG ===',
      ...scrollLog,
    ].join('\n');

    return result;

  } catch (err: any) {
    return `ERROR: browser_scroll_collect failed: ${err.message}`;
  }
}

export async function getBrowserAdvisorPacket(
  sessionId: string,
  options?: { maxItems?: number; snapshotElements?: number },
): Promise<BrowserAdvisorPacket | null> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return null;
  try {
    return await buildAdvisorPacketForSession(session, options);
  } catch {
    return null;
  }
}

// ─── Tool Definitions (for Ollama) ─────────────────────────────────────────────

export function getBrowserToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'browser_open',
        description: 'Open a URL in a Playwright-controlled Chrome browser (NOT your regular Chrome or Edge). This is the ONLY correct way to open URLs for browser automation — NEVER use run_command to open chrome/edge, as those windows are invisible to all other browser tools. Always use browser_open first to establish a session before using browser_snapshot, browser_click, etc. Returns a snapshot of interactive page elements with @ref numbers — read it immediately. Do NOT call browser_open again for a different URL within the same site — use browser_click on the link @ref instead. For searches, build a direct search URL (e.g. github.com/search?q=query). Elements marked [INPUT] can be filled. If element count looks low, call browser_wait to let JS finish loading.',
        parameters: {
          type: 'object', required: ['url'],
          properties: {
            url: { type: 'string', description: 'Full URL to navigate to. For searches, build the search URL directly.' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: screenshot for navigation.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot',
        description: 'Re-scan the current page and return an updated list of interactive elements with @ref numbers. ONLY call this when you do NOT already have a recent snapshot in context — do NOT call it twice in a row or after browser_open/browser_fill/browser_wait which already return a snapshot. If you just received a snapshot, ACT on it immediately (browser_click or browser_fill) instead of re-snapping. Repeated snapshot calls without acting = stall loop.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: snapshot for explicit snapshot request.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: 'Click a page element by its @ref number. Always take a browser_snapshot after clicking to see the result. If the snapshot looks unchanged after clicking, the wrong element was clicked — pick a different @ref and try again.',
        parameters: {
          type: 'object', required: ['ref'],
          properties: {
            ref: { type: 'number', description: '@ref number from the most recent snapshot' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: delta for medium-risk clicks.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_fill',
        description: 'Type text into an [INPUT] element by its @ref number. Only works on elements labelled [INPUT] in the snapshot. After filling, use browser_press_key with "Enter" to submit, or browser_click on the submit button.',
        parameters: {
          type: 'object', required: ['ref', 'text'],
          properties: {
            ref: { type: 'number', description: '@ref number of an [INPUT] element from the snapshot' },
            text: { type: 'string', description: 'Text to type into the field' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: delta for text input.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_press_key',
        description: 'Press a keyboard key. Use "Enter" to submit a form or search after filling an input. Use "Escape" to close a popup. Use "Tab" to move focus to the next field.',
        parameters: {
          type: 'object', required: ['key'],
          properties: {
            key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowDown, ArrowUp, Space' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: none for deterministic keypresses.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_key',
        description: 'Alias for browser_press_key. Press a keyboard key on the focused element.',
        parameters: {
          type: 'object', required: ['key'],
          properties: {
            key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowDown, ArrowUp, Space, etc.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_type',
        description:
          'Type text into the currently focused element by sending raw keystrokes. ' +
          'Use this for contenteditable elements (e.g. X/Twitter compose box, rich text editors) where browser_fill does not work. ' +
          'First click the target element to focus it, then call browser_type with the text.',
        parameters: {
          type: 'object', required: ['text'],
          properties: {
            text: { type: 'string', description: 'Text to type into the focused element.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_wait',
        description: 'Wait for the page to finish loading, then return a fresh snapshot. Use this when: (1) a page just loaded but has few elements, (2) after a click that should open something but the snapshot looks unchanged, (3) waiting for search results or dynamic content to appear.',
        parameters: {
          type: 'object',
          properties: {
            ms: { type: 'number', description: 'Milliseconds to wait before snapping (500-8000, default 2000)' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: none for timing-only waits.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll',
        description: 'Scroll the page by a multiple of the viewport height. Prefer this over browser_press_key(PageDown) on sites with infinite scroll or content virtualization. Use direction="down" with multiplier=1.75 on X/Twitter to reliably load new tweets past virtualization. Default multiplier=1.0.',
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['down', 'up'], description: 'Scroll direction' },
            multiplier: { type: 'number', description: 'Viewport height multiplier. Use 1.75 for X/Twitter, 1.0 for most sites. Range: 0.5–4.0.' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: none for scrolling (cadence handles orientation).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll_collect',
        description:
          'Scroll multiple times and collect ALL visible text at each position — a single-call web scraping engine. ' +
          'Use this instead of repeated browser_scroll calls when you need to collect data from infinite scroll pages, ' +
          'search results, feeds, or any page with content that loads on scroll. ' +
          'Returns deduplicated text from all scroll positions in one response. ' +
          'Does NOT return a DOM snapshot — call browser_snapshot() afterward if you need to interact with elements. ' +
          'Example: browser_scroll_collect({scrolls: 10, multiplier: 1.75}) on X/Twitter to collect ~30-50 tweets at once.',
        parameters: {
          type: 'object',
          properties: {
            scrolls:    { type: 'number', description: 'Number of scroll iterations (1–30, default 5)' },
            direction:  { type: 'string', enum: ['down', 'up'], description: 'Scroll direction (default: down)' },
            multiplier: { type: 'number', description: 'Viewport height multiplier per scroll (0.5–4.0, default 1.5). Use 1.75 for X/Twitter.' },
            delay_ms:   { type: 'number', description: 'Wait between scrolls in ms for content to load (500–5000, default 1500)' },
            stop_text:  { type: 'string', description: 'Stop scrolling early when this text appears on page (e.g. "No more results")' },
            max_chars:  { type: 'number', description: 'Max total chars to collect (5000–100000, default 50000)' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: delta for content collection.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_close',
        description: 'Close the browser tab when done.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_focused_item',
        description: 'Check which item currently has keyboard focus on the page. CRITICAL for keyboard navigation: after pressing j/k on X.com to navigate tweets, call this to find out which tweet number is currently focused, its author, and its text. Use this after EVERY j/k press so you can determine if you need more presses to reach the right tweet. Returns position (e.g. "Tweet #2 of 8 visible") and tweet content so you can confirm you are on the correct item before pressing like/reply/etc.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: none for read-only focus check.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_page_text',
        description: 'Extract ALL visible text from the current page, including content inside iframes. Use this when browser_snapshot shows very few elements (< 12) and the page likely has menus, product listings, or other content hidden in iframes (common with dispensary menus using Jane Technologies, Dutchie, or Leafly widgets) or script-rendered blocks. Returns raw page text + a list of any iframe URLs found so you can navigate to them directly with browser_open.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: none for read-only text extraction.' },
          },
        },
      },
    },
    // ─ Vision fallback tools ─ injected only when VISION MODE is active ──────────────────
    {
      type: 'function',
      function: {
        name: 'browser_vision_screenshot',
        description:
          'Capture the current browser tab viewport as PNG (not full desktop). Use when DOM snapshot is sparse. ' +
          'The image is attached for vision-capable models — you choose browser_vision_click / browser_vision_type coordinates.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: none (tool IS the observation).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_vision_click',
        description:
          'Click at viewport pixel coordinates (from browser_vision_screenshot / attached image). ' +
          'Use when DOM is sparse. After clicking, if snapshot element count recovers to > 10, prefer browser_click(@ref).',
        parameters: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            x: { type: 'number', description: 'Pixel X coordinate within the browser viewport' },
            y: { type: 'number', description: 'Pixel Y coordinate within the browser viewport' },
            button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default left)' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: screenshot for vision-based clicks.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_vision_type',
        description:
          'Click at pixel coordinates and type text. ' +
          'Use when VISION MODE is active and you need to type into a canvas/overlay input with no DOM ref. ' +
          'After typing, check the returned snapshot element count — if > 10, switch back to DOM mode.',
        parameters: {
          type: 'object',
          required: ['x', 'y', 'text'],
          properties: {
            x: { type: 'number', description: 'Pixel X coordinate to click before typing' },
            y: { type: 'number', description: 'Pixel Y coordinate to click before typing' },
            text: { type: 'string', description: 'Text to type after clicking' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: delta for vision typing.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_send_to_telegram',
        description:
          'Capture the current browser tab as a screenshot and send it to the user via Telegram. ' +
          'Use this to share what the browser is currently showing — search results, tweets, articles, dashboards, etc. ' +
          'Takes a fresh screenshot of the visible viewport (not full page) and sends it as a photo with caption.',
        parameters: {
          type: 'object',
          properties: {
            caption: { type: 'string', description: 'Caption for the screenshot (default: "Browser screenshot")' },
            observe: { type: 'string', enum: ['none', 'delta', 'snapshot', 'screenshot'], description: 'Observation mode after this action. Overrides system default. Default: none (side-effect only).' },
          },
        },
      },
    },
    // ─ NEW POWER TOOLS ──────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'browser_run_js',
        description:
          'Execute arbitrary JavaScript in the current page context and return the result. ' +
          'Top-level await is supported. Use this to: read React/Vue component state, trigger programmatic events, ' +
          'inspect hidden variables, extract data not visible in the DOM, run browser APIs. ' +
          'Return value is JSON-serialized. Example: `return document.cookie` or `return window.__STORE__.getState()`. ' +
          'WARNING: treat this as a fallback tool. Prefer browser_snapshot/browser_vision_screenshot + browser_click/browser_fill first, and only use browser_run_js when visual/DOM refs are insufficient. ' +
          'Only use for inspection/read-only operations unless you intentionally want to modify page state.',
        parameters: {
          type: 'object',
          required: ['code'],
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript to execute in the page. Top-level await works. Return a value with `return expr`. Example: `return document.title`',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_intercept_network',
        description:
          'Hook into the Playwright network layer to capture XHR/fetch responses. ' +
          'Call with action="start" before navigating/clicking, then action="read" to inspect what APIs returned. ' +
          'JSON and text response bodies are captured. Binary/image responses are skipped. ' +
          'Use to: inspect what an API returned, find hidden data endpoints, debug what data is loading. ' +
          'action="start" begins capturing; action="stop" removes the listener; action="read" dumps the log; action="clear" wipes it.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['start', 'stop', 'read', 'clear'],
              description: '"start" = begin capturing, "stop" = remove listener, "read" = show captured entries, "clear" = wipe log',
            },
            url_filter: {
              type: 'string',
              description: 'Optional substring to filter URLs (e.g. "/api/" to capture only API calls). Applied in both start and read.',
            },
            max_entries: {
              type: 'number',
              description: 'Max responses to buffer (default 200, max 500).',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_element_watch',
        description:
          'Wait until a DOM element appears, disappears, or contains specific text — without burning tokens on repeated snapshots. ' +
          'Uses Playwright\'s native waitForSelector for appear/disappear (efficient, no polling overhead). ' +
          'Use instead of browser_wait + browser_snapshot loops when you know exactly what you\'re waiting for. ' +
          'Returns a fresh snapshot when the condition is met.',
        parameters: {
          type: 'object',
          required: ['selector', 'wait_for'],
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to watch (e.g. ".result-list", "#submit-btn", "[data-testid=\'chat-bubble\']")',
            },
            wait_for: {
              type: 'string',
              enum: ['appear', 'disappear', 'text_contains'],
              description: '"appear" = wait until visible, "disappear" = wait until hidden/removed, "text_contains" = wait until element text includes the "text" param',
            },
            text: {
              type: 'string',
              description: 'Required when wait_for="text_contains". The substring to look for inside the element.',
            },
            timeout_ms: {
              type: 'number',
              description: 'Max wait in ms (default 15000, max 120000).',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot_delta',
        description:
          'Re-scan the page and return ONLY what changed since the last snapshot. ' +
          'Shows added elements, removed elements, and page title/URL changes. ' +
          'Use this instead of browser_snapshot on SPAs and heavy pages to reduce token usage by 60–80%. ' +
          'If no previous snapshot exists, returns a full snapshot. ' +
          'PREFER over browser_snapshot when you already have a snapshot in context and just want to see what changed after an action.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_extract_structured',
        description:
          'Extract structured JSON data from the page using a CSS-schema. ' +
          'Define a container_selector (repeated element, e.g. ".product-card") and fields (each with a CSS selector and extraction type). ' +
          'Returns a JSON array of objects — one per container match. ' +
          'Use this to scrape product listings, search results, tables, social posts, etc. in one call instead of parsing page text. ' +
          'Field type options: "text" (default, innerText), "href" (link href), "src" (img src), "attr" (any attribute), "html" (innerHTML).',
        parameters: {
          type: 'object',
          required: ['schema'],
          properties: {
            schema: {
              type: 'object',
              description:
                'Extraction schema. Example: { "container_selector": ".product", "limit": 20, "fields": { "name": { "selector": "h2" }, "price": { "selector": ".price" }, "link": { "selector": "a", "type": "href" } } }',
              properties: {
                container_selector: { type: 'string', description: 'CSS selector for the repeated container element' },
                limit: { type: 'number', description: 'Max items to return (default 50, max 500)' },
                fields: {
                  type: 'object',
                  description: 'Map of field name → { selector: string, type?: "text"|"href"|"src"|"attr"|"html", attribute?: string }',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      selector: { type: 'string' },
                      type: { type: 'string', enum: ['text', 'href', 'src', 'attr', 'html'] },
                      attribute: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  ];
}

export async function browserGetPageText(sessionId: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const url = session.page.url();
    const title = await session.page.title();

    // 1. Main document visible text
    const mainText = await session.page.evaluate(() => {
      const body = (globalThis as any).document.body;
      if (!body) return '';
      // Strip scripts and styles before reading innerText
      const clone = body.cloneNode(true) as any;
      for (const el of clone.querySelectorAll('script,style,noscript')) el.remove();
      return (clone.innerText || clone.textContent || '')
        .replace(/[^\S\n]{3,}/g, ' ')
        .replace(/\n{4,}/g, '\n\n')
        .trim()
        .slice(0, 6000);
    });

    // 2. Detect iframes — report their src URLs so AI can navigate to them
    const iframes = await session.page.evaluate(() => {
      return Array.from((globalThis as any).document.querySelectorAll('iframe'))
        .map((f: any) => ({
          src: f.src || f.getAttribute('src') || '',
          id: f.id || '',
          title: f.getAttribute('title') || f.name || '',
          w: f.offsetWidth,
          h: f.offsetHeight,
        }))
        .filter((f: any) => f.src && !f.src.startsWith('javascript') && f.w > 80 && f.h > 80);
    }) as Array<{ src: string; id: string; title: string; w: number; h: number }>;

    // 3. Try to read same-origin iframes directly via Playwright frames API
    const iframeTexts: string[] = [];
    for (const frameHandle of session.page.frames()) {
      try {
        const frameUrl = frameHandle.url();
        if (!frameUrl || frameUrl === 'about:blank' || frameUrl === url) continue;
        const fText = await frameHandle.evaluate(() => {
          const body = (globalThis as any).document.body;
          if (!body) return '';
          const clone = body.cloneNode(true) as any;
          for (const el of clone.querySelectorAll('script,style,noscript')) el.remove();
          return (clone.innerText || clone.textContent || '')
            .replace(/[^\S\n]{3,}/g, ' ')
            .replace(/\n{4,}/g, '\n\n')
            .trim()
            .slice(0, 4000);
        }).catch(() => '');
        if (fText && fText.length > 80) {
          iframeTexts.push(`--- IFRAME (${frameUrl.slice(0, 120)}) ---\n${fText}`);
        }
      } catch { /* cross-origin iframe — skip text, will be listed in iframe URLs */ }
    }

    const parts: string[] = [
      `Page: ${title}`,
      `URL: ${url}`,
      '',
    ];

    if (mainText) {
      parts.push('=== MAIN PAGE TEXT ===');
      parts.push(mainText);
    }

    if (iframeTexts.length > 0) {
      parts.push('');
      parts.push('=== IFRAME CONTENT (same-origin) ===');
      parts.push(...iframeTexts);
    }

    // Cross-origin iframes — can't read text but list the URLs
    const crossOriginIframes = iframes.filter(f => {
      try {
        const fHost = new URL(f.src).hostname;
        const pHost = new URL(url).hostname;
        return fHost !== pHost;
      } catch { return true; }
    });
    if (crossOriginIframes.length > 0) {
      parts.push('');
      parts.push('=== CROSS-ORIGIN IFRAMES (navigate to these with browser_open) ===');
      for (const f of crossOriginIframes) {
        const label = f.title || f.id || 'iframe';
        parts.push(`  ${label}: ${f.src}`);
      }
      parts.push('');
      parts.push('TIP: Use browser_open({url: "<iframe src above>"}) to navigate directly into the embedded menu/widget.');
    }

    const result = parts.join('\n');
    return result.length > 20 ? result : 'No readable text found on this page.';
  } catch (err: any) {
    return `ERROR: browser_get_page_text failed: ${err.message}`;
  }
}

export { INTERACTIVE_SELECTOR };

// ─── browser_run_js ───────────────────────────────────────────────────────────

/**
 * Execute arbitrary JavaScript in the current page context and return the result.
 * Wraps in an async IIFE so top-level await works. Result is JSON-serialized.
 * Playwright's page.evaluate() passes a serializable return value back to Node.
 */
export async function browserRunJs(sessionId: string, code: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!code || !code.trim()) return 'ERROR: code parameter is required.';
  try {
    // Wrap in async IIFE so `await` works at top level
    const wrapped = `(async () => { ${code} })()`;
    const result = await session.page.evaluate(wrapped);
    if (result === undefined || result === null) return 'JS executed successfully (returned: null/undefined).';
    if (typeof result === 'object') return JSON.stringify(result, null, 2);
    return String(result);
  } catch (err: any) {
    return `ERROR: JS execution failed: ${err.message}`;
  }
}

// ─── browser_intercept_network ────────────────────────────────────────────────

/**
 * Hook into Playwright's network layer to intercept and log XHR/fetch responses.
 * action='start': begin capturing (optional url_filter substring match)
 * action='stop': remove the listener
 * action='read': return captured log (optionally filter by url substring)
 * action='clear': wipe the log without stopping
 */
export async function browserInterceptNetwork(
  sessionId: string,
  action: 'start' | 'stop' | 'read' | 'clear',
  urlFilter?: string,
  maxEntries = 200,
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  if (action === 'start') {
    // Remove old handler if already intercepting
    const oldHandler = _networkInterceptHandlers.get(resolved);
    if (oldHandler) session.page.off('response', oldHandler);
    _networkInterceptLog.set(resolved, []);

    const handler = async (response: any) => {
      try {
        const url: string = response.url();
        if (urlFilter && !url.includes(urlFilter)) return;
        const log = _networkInterceptLog.get(resolved);
        if (!log || log.length >= maxEntries) return;
        const req = response.request();
        const headers = response.headers();
        const contentType = (headers['content-type'] || '').split(';')[0].trim();
        let body: string | undefined;
        // Capture body only for JSON / text to avoid large binaries
        if (contentType.includes('json') || contentType.startsWith('text/')) {
          try {
            body = await response.text();
            if (body && body.length > 3000) body = body.slice(0, 3000) + '…[truncated]';
          } catch { /* ignore */ }
        }
        log.push({ url, method: req.method(), status: response.status(), contentType, body, ts: Date.now() });
      } catch { /* ignore disposal errors */ }
    };
    _networkInterceptHandlers.set(resolved, handler);
    session.page.on('response', handler);
    const limit = String(maxEntries);
    const filterNote = urlFilter ? ` (url filter: "${urlFilter}")` : '';
    return `Network interception started${filterNote}. Capturing up to ${limit} responses. Use browser_intercept_network(action="read") to inspect, "stop" to disable.`;
  }

  if (action === 'stop') {
    const handler = _networkInterceptHandlers.get(resolved);
    if (handler) { session.page.off('response', handler); _networkInterceptHandlers.delete(resolved); }
    const count = (_networkInterceptLog.get(resolved) || []).length;
    return `Network interception stopped. ${count} entries in log — use action="read" to view.`;
  }

  if (action === 'clear') {
    _networkInterceptLog.set(resolved, []);
    return 'Network intercept log cleared.';
  }

  if (action === 'read') {
    const log = (_networkInterceptLog.get(resolved) || []).filter(e => !urlFilter || e.url.includes(urlFilter));
    if (log.length === 0) {
      return _networkInterceptHandlers.has(resolved)
        ? 'No matching network responses captured yet (interception is active).'
        : 'No entries — start interception first with action="start".';
    }
    const lines = log.map(e => {
      const time = new Date(e.ts).toISOString().slice(11, 23);
      const bodyLine = e.body ? `\n    Body: ${e.body.replace(/\n/g, ' ')}` : '';
      return `[${time}] ${e.method} ${e.status} ${e.contentType}\n    ${e.url}${bodyLine}`;
    });
    return `Network log (${log.length} entries):\n\n${lines.join('\n\n')}`;
  }

  return 'ERROR: action must be "start", "stop", "read", or "clear".';
}

// ─── browser_element_watch ────────────────────────────────────────────────────

/**
 * Wait until a DOM element appears, disappears, or contains specific text.
 * Uses Playwright's native waitForSelector for appear/disappear — efficient,
 * no polling overhead. Returns a fresh snapshot when condition is met.
 */
export async function browserElementWatch(
  sessionId: string,
  selector: string,
  waitFor: 'appear' | 'disappear' | 'text_contains',
  text?: string,
  timeoutMs = 15000,
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!selector) return 'ERROR: selector is required.';
  const safeTimeout = Math.min(Math.max(Number(timeoutMs) || 15000, 500), 120_000);

  const freshSnapshot = async () => {
    const snap = await takeSnapshot(session.page);
    session.lastSnapshot = snap;
    session.lastSnapshotAt = Date.now();
    return attachShortcutsContext(snap, session.page.url());
  };

  try {
    if (waitFor === 'appear') {
      await session.page.waitForSelector(selector, { state: 'visible', timeout: safeTimeout });
      return `Element "${selector}" appeared.\n\n${await freshSnapshot()}`;
    }
    if (waitFor === 'disappear') {
      await session.page.waitForSelector(selector, { state: 'hidden', timeout: safeTimeout });
      return `Element "${selector}" disappeared.\n\n${await freshSnapshot()}`;
    }
    if (waitFor === 'text_contains') {
      if (!text) return 'ERROR: text_contains requires a "text" parameter.';
      const deadline = Date.now() + safeTimeout;
      while (Date.now() < deadline) {
        try {
          const el = session.page.locator(selector).first();
          const elText = await el.innerText({ timeout: 1000 }).catch(() => '');
          if (elText.includes(text)) {
            return `Element "${selector}" contains text "${text}".\n\n${await freshSnapshot()}`;
          }
        } catch { /* element not present yet — keep polling */ }
        await session.page.waitForTimeout(500);
      }
      return `ERROR: Timed out after ${safeTimeout}ms waiting for "${selector}" to contain text "${text}".`;
    }
    return 'ERROR: waitFor must be "appear", "disappear", or "text_contains".';
  } catch (err: any) {
    return `ERROR: browser_element_watch failed: ${err.message}`;
  }
}

// ─── browser_snapshot_delta ───────────────────────────────────────────────────

/**
 * Re-scan the page and return ONLY what changed since the last snapshot.
 * Compares element lines (each line containing @ref text) between snapshots.
 * Dramatically reduces token cost on heavy SPAs where most elements stay stable.
 * Falls back to full snapshot if no previous snapshot exists.
 */
export async function browserSnapshotDelta(sessionId: string): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const prevSnapshot = session.lastSnapshot;
  const newSnapshot = await takeSnapshot(session.page);
  session.lastSnapshot = newSnapshot;
  session.lastSnapshotAt = Date.now();
  const url = session.page.url();

  if (!prevSnapshot) {
    const elemCount = (newSnapshot.match(/@\d+/g) || []).length;
    return attachShortcutsContext(
      `No previous snapshot to diff — returning full snapshot (${elemCount} elements):\n\n${newSnapshot}`,
      url,
    );
  }

  // Compare element lines (lines containing @ref numbers)
  const toElemSet = (snap: string) => new Set(snap.split('\n').filter(l => l.includes('@')));
  const prevSet = toElemSet(prevSnapshot);
  const newSet = toElemSet(newSnapshot);
  const added = [...newSet].filter(l => !prevSet.has(l));
  const removed = [...prevSet].filter(l => !newSet.has(l));

  // Check for page-level changes even if element lines are identical
  const prevTitle = (prevSnapshot.match(/^Page:\s*(.+)$/m) || [])[1] || '';
  const newTitle = (newSnapshot.match(/^Page:\s*(.+)$/m) || [])[1] || '';
  const prevUrl = (prevSnapshot.match(/^URL:\s*(.+)$/m) || [])[1] || '';
  const newUrl = (newSnapshot.match(/^URL:\s*(.+)$/m) || [])[1] || '';

  if (added.length === 0 && removed.length === 0 && prevTitle === newTitle && prevUrl === newUrl) {
    return attachShortcutsContext(
      `No DOM changes detected (${newSet.size} elements unchanged).`,
      url,
    );
  }

  const parts: string[] = [`DOM delta — +${added.length} added, -${removed.length} removed (${newSet.size} total)`];
  if (prevTitle !== newTitle) parts.push(`Page title: "${prevTitle}" → "${newTitle}"`);
  if (prevUrl !== newUrl) parts.push(`URL: ${prevUrl} → ${newUrl}`);
  if (added.length > 0) { parts.push('\n=== ADDED ==='); parts.push(...added.slice(0, 60)); }
  if (removed.length > 0) { parts.push('\n=== REMOVED ==='); parts.push(...removed.slice(0, 60)); }
  if (added.length > 60 || removed.length > 60) parts.push('\n…(truncated — use browser_snapshot for full view)');

  return attachShortcutsContext(parts.join('\n'), url);
}

// ─── browser_extract_structured ───────────────────────────────────────────────

/**
 * Extract structured data from the current page by describing a schema.
 * Schema format:
 *   container_selector: CSS selector for repeated items (e.g. ".product-card")
 *   limit: max items to return (default 50)
 *   fields: { fieldName: { selector: CSS, type: "text"|"href"|"src"|"attr", attribute?: string } }
 *
 * Example schema to scrape products:
 *   { "container_selector": ".product", "fields": {
 *       "name":  { "selector": "h2" },
 *       "price": { "selector": ".price" },
 *       "link":  { "selector": "a", "type": "href" }
 *   }}
 *
 * Returns JSON array of matched items. Fields not found return null.
 */
export async function browserExtractStructured(
  sessionId: string,
  schema: Record<string, any>,
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!schema || typeof schema !== 'object') return 'ERROR: schema must be an object with container_selector and fields.';

  try {
    const result: any[] = await session.page.evaluate((s: any) => {
      const doc = (globalThis as any).document;
      const containerSel: string = s.container_selector || 'body';
      const fields: Record<string, any> = s.fields || {};
      const limitNum = Math.min(Number(s.limit) || 50, 500);

      const containers = Array.from(doc.querySelectorAll(containerSel)).slice(0, limitNum);

      return containers.map((container: any) => {
        const item: Record<string, any> = {};
        for (const [fieldName, def] of Object.entries(fields)) {
          const fieldDef = def as any;
          const sel: string = fieldDef.selector || '';
          if (!sel) { item[fieldName] = null; continue; }
          try {
            const el: any = container.querySelector(sel);
            if (!el) { item[fieldName] = null; continue; }
            const extractType: string = fieldDef.type || 'text';
            if (extractType === 'href') item[fieldName] = el.href || el.getAttribute('href') || null;
            else if (extractType === 'src') item[fieldName] = el.src || el.getAttribute('src') || null;
            else if (extractType === 'attr') item[fieldName] = el.getAttribute(fieldDef.attribute || 'value') || null;
            else if (extractType === 'html') item[fieldName] = (el.innerHTML || '').trim().slice(0, 1000);
            else item[fieldName] = ((el.innerText || el.textContent || '').trim()).slice(0, 500);
          } catch { item[fieldName] = null; }
        }
        return item;
      });
    }, schema);

    if (!Array.isArray(result) || result.length === 0) {
      return `No items found matching container_selector "${schema.container_selector || 'body'}".`;
    }
    return JSON.stringify(result, null, 2);
  } catch (err: any) {
    return `ERROR: browser_extract_structured failed: ${err.message}`;
  }
}

// ─── Vision Tools (Component 1 + 3) ──────────────────────────────────────────
//
// These tools capture the Playwright viewport as a PNG (not via PowerShell/desktop)
// and allow coordinate-based click/type when the DOM snapshot has too few elements.
// Used by the vision fallback system when stabilization is exhausted.

/**
 * Capture the current browser tab viewport as a base64 PNG.
 * Much faster than desktop_screenshot because it uses Playwright's CDP directly.
 * Returns null if no session exists.
 */
export async function browserVisionScreenshot(sessionId: string): Promise<{
  base64: string;
  width: number;
  height: number;
} | null> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return null;
  try {
    const buf: Buffer = await session.page.screenshot({ type: 'png', fullPage: false });
    const viewport = session.page.viewportSize() || { width: 1280, height: 720 };
    const out = {
      base64: buf.toString('base64'),
      width: viewport.width,
      height: viewport.height,
    };
    // Keep the latest browser screenshot available for primary vision injection.
    setLastBrowserScreenshot(sessionId, out);
    return out;
  } catch (err: any) {
    console.warn('[Browser] browserVisionScreenshot failed:', err.message);
    return null;
  }
}

/**
 * Capture a browser tab screenshot and send it to Telegram.
 * Takes a fresh screenshot via Playwright, then sends it to all allowed Telegram users.
 */
export async function browserSendToTelegram(
  sessionId: string,
  caption: string = 'Browser screenshot',
  telegramChannel?: any,
): Promise<string> {
  if (!telegramChannel) {
    return 'ERROR: Telegram channel not available.';
  }
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const buf: Buffer = await session.page.screenshot({ type: 'png', fullPage: false });
    const viewport = session.page.viewportSize() || { width: 1280, height: 720 };
    // Also expose this screenshot to the model so it's not "send-only".
    setLastBrowserScreenshot(sessionId, {
      base64: buf.toString('base64'),
      width: viewport.width,
      height: viewport.height,
    });
    await telegramChannel.sendPhotoToAllowed(buf, caption);
    return `Browser screenshot sent to Telegram (${viewport.width}x${viewport.height}). Caption: "${caption}"`;
  } catch (err: any) {
    return `ERROR: Failed to send browser screenshot to Telegram: ${err?.message || err}`;
  }
}

/**
 * Click at viewport coordinates (pixels). Uses Playwright CDP mouse API.
 * More precise than DOM refs — works on canvas/SVG/WebGL pages.
 * Returns a fresh DOM snapshot after clicking so the model can check if DOM recovered.
 */
export async function browserVisionClick(
  sessionId: string,
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const px = Math.round(Number(x) || 0);
  const py = Math.round(Number(y) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return 'ERROR: x and y must be valid numbers.';
  }
  try {
    await session.page.mouse.click(px, py, { button });
    await session.page.waitForTimeout(600);
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    const elemCount = (snapshot.match(/@\d+/g) || []).length;
    return (
      `Vision-clicked (${px}, ${py}). Post-click snapshot (${elemCount} elements):\n\n` +
      attachShortcutsContext(snapshot, session.page.url())
    );
  } catch (err: any) {
    return `ERROR: Vision click at (${px}, ${py}) failed: ${err.message}`;
  }
}

/**
 * Click at viewport coordinates then type text. Uses Playwright mouse + keyboard APIs.
 * Works on canvas/input overlays that don't have DOM refs.
 * Returns a fresh snapshot.
 */
export async function browserVisionType(
  sessionId: string,
  x: number,
  y: number,
  text: string,
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const px = Math.round(Number(x) || 0);
  const py = Math.round(Number(y) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return 'ERROR: x and y must be valid numbers.';
  }
  const payload = String(text || '');
  try {
    await session.page.mouse.click(px, py);
    await session.page.waitForTimeout(200);
    await session.page.keyboard.type(payload, { delay: 25 });
    await session.page.waitForTimeout(500);
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
    const elemCount = (snapshot.match(/@\d+/g) || []).length;
    return (
      `Vision-typed ${payload.length} chars at (${px}, ${py}). Post-type snapshot (${elemCount} elements):\n\n` +
      attachShortcutsContext(snapshot, session.page.url())
    );
  } catch (err: any) {
    return `ERROR: Vision type at (${px}, ${py}) failed: ${err.message}`;
  }
}

// ─── Session State Helpers (for system prompt injection) ───────────────────────

export function hasBrowserSession(sessionId: string): boolean {
  return sessions.has(resolveSessionId(sessionId));
}

export function getBrowserSessionInfo(sessionId: string): { active: boolean; url?: string; title?: string } {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return { active: false };
  try {
    const url = session.page.url();
    const snapshot = session.lastSnapshot || '';
    // Extract title from lastSnapshot first line: "Page: <title>"
    const titleMatch = snapshot.match(/^Page:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : undefined;
    return { active: true, url, title };
  } catch {
    return { active: true };
  }
}

// Cleanup on process exit
process.on('exit', () => {
  for (const [, session] of sessions) {
    try { session.page.close(); } catch {}
  }
});

// ─── Preview Screenshot ───────────────────────────────────────────────────────
// Used by the Telegram file browser to render a visual preview of any workspace
// file. Completely isolated from the main chat browser session — opens a fresh
// page, screenshots it in chunks, then immediately closes the page.
// Chrome is auto-launched if it isn't running (same path as normal browser tools).

export interface PreviewChunk {
  index: number;       // 0-based chunk number
  total: number;       // total number of chunks
  base64: string;      // PNG encoded as base64
  width: number;
  height: number;      // actual height of this chunk (last chunk may be smaller)
}

/**
 * Take a full-page screenshot of a URL and return it as an array of vertical
 * chunks so long pages can be sent as a Telegram photo album.
 *
 * @param url         The URL to screenshot (typically the /preview route)
 * @param chunkHeight Height in px of each chunk (default 1200)
 * @param maxChunks   Maximum chunks to return (default 10 = up to ~12000px)
 */
export async function browserPreviewScreenshot(
  url: string,
  chunkHeight = 1200,
  maxChunks = 10,
): Promise<PreviewChunk[]> {
  // Get (or launch) Chrome using the same logic as normal browser tools.
  // Using a dedicated session ID keeps this page completely separate from
  // any active user browser session.
  const PREVIEW_SESSION = '__preview_internal__';
  const session = await getOrCreateSession(PREVIEW_SESSION);

  // Always open a BRAND NEW page — never reuse the session's shared page.
  // This ensures zero interference with the user's active browsing session.
  const page: PwPage = await session.context.newPage();

  try {
    // Clean 1280px viewport — matches a standard desktop browser width.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    // Brief settle to let fonts/images render fully
    await page.waitForTimeout(400);

    // Get the full rendered page height — use the maximum of several measures
    // because some pages (e.g. 100vh layouts) return a small scrollHeight.
    const fullHeight: number = await page.evaluate(`
      Math.max(
        document.documentElement.scrollHeight || 0,
        document.documentElement.clientHeight || 0,
        document.body ? document.body.scrollHeight : 0,
        document.body ? document.body.offsetHeight : 0
      )
    `);
    const viewportWidth = 1280;
    const viewportHeight = 900;
    // Clamp: if the page reports a tiny or zero height, fall back to viewport height
    const effectiveHeight = Math.max(fullHeight, viewportHeight);
    const safeChunkHeight = Math.max(200, Math.min(2000, chunkHeight));
    const totalChunks = Math.min(maxChunks, Math.ceil(effectiveHeight / safeChunkHeight));

    const chunks: PreviewChunk[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const scrollY = i * safeChunkHeight;
      // Never let the chunk extend past the effective page height
      const thisChunkHeight = Math.min(safeChunkHeight, effectiveHeight - scrollY);
      if (thisChunkHeight <= 0) break;

      // Scroll so the chunk we want is at the TOP of the viewport
      await page.evaluate(`window.scrollTo(0, ${scrollY})`);
      await page.waitForTimeout(80);

      // Resize viewport to exactly the chunk height so the screenshot
      // captures only this slice — clip coords are always viewport-relative
      // so we set the viewport to match the chunk height instead of clipping
      await page.setViewportSize({ width: viewportWidth, height: thisChunkHeight });

      const buf: Buffer = await page.screenshot({ type: 'png' });

      // Restore viewport for next iteration
      await page.setViewportSize({ width: viewportWidth, height: safeChunkHeight });

      chunks.push({
        index: i,
        total: totalChunks,
        base64: buf.toString('base64'),
        width: viewportWidth,
        height: thisChunkHeight,
      });
    }

    return chunks;
  } finally {
    // Always close this temporary page — never leave it open in Chrome
    try { await page.close(); } catch {}
  }
}
