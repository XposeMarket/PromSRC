
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

import { PwPage, SnapElement } from './types.js';

// --- DOM-Based Snapshot (works on ALL Playwright versions) ---------------------

export async function takeSnapshot(page: PwPage, maxElements: number = 100): Promise<string> {
  try {
    const title = await page.title();
    const url = page.url();

    // Scrape the DOM directly � no dependency on accessibility APIs
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
      // Expanded selector set � includes data-testid (React apps), explicit search inputs
      const selector = [
        'a[href]', 'button', 'input', 'select', 'textarea',
        'input[type="search"]', 'input[type="text"]',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="search"]',
        '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]',
        '[contenteditable="true"]',
        '[data-testid]',
        'h1', 'h2', 'h3',
      ].join(', ');

      // -- Modal / dialog detection -------------------------------------------
      // If a modal or dialog is open, ONLY elements inside it are interactable.
      // Scanning the full DOM would expose background elements the AI cannot
      // actually click (they are aria-hidden or covered by the overlay).
      // Priority: aria-modal dialogs > role=dialog > data-testid dialogs.
      const modalCandidates = Array.from(doc.querySelectorAll([
        '[role="dialog"][aria-modal="true"]',
        '[role="dialog"]:not([aria-hidden="true"])',
        '[data-testid="sheetDialog"]',
        '[data-testid="confirmationSheetDialog"]',
        '[data-testid="keyboardShortcutModal"]',
        'dialog[open]',
        '[data-testid="Dropdown"]',
        '[role="menu"]',
      ].join(', '))) as any[];
      const openModal = modalCandidates.find((candidate: any) => {
        if (!candidate || candidate.getAttribute?.('aria-hidden') === 'true' || candidate.hasAttribute?.('inert')) return false;
        const rect = candidate.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        const style = (globalThis as any).getComputedStyle?.(candidate);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0)) return false;
        const viewportWidth = Number((globalThis as any).innerWidth || doc.documentElement?.clientWidth || 0);
        const viewportHeight = Number((globalThis as any).innerHeight || doc.documentElement?.clientHeight || 0);
        if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) return false;
        const centerX = Math.max(0, Math.min(viewportWidth - 1, rect.left + rect.width / 2));
        const centerY = Math.max(0, Math.min(viewportHeight - 1, rect.top + rect.height / 2));
        const hit = doc.elementFromPoint?.(centerX, centerY);
        return !hit || candidate === hit || candidate.contains?.(hit);
      }) || null;
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

      // -- Stable ref assignment using data-sc-ref attributes -----------------
      // Pre-scan all existing data-sc-ref values so we never reassign a taken ref.
      // Elements that already have data-sc-ref keep the SAME ref across DOM mutations
      // (React re-renders, SPA route changes) � this eliminates ref-drift entirely.
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

        // Determine visible name � prefer aria-label, then text, then placeholder, then data-testid
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
      // Always show a name � fall back to placeholder so inputs are never shown as [@N] textbox ""
      const displayName = el.name || (el as any).placeholder || '';
      if (displayName) line += ` "${displayName}"`;
      if (el.isInput) line += ' [INPUT]';
      if (el.value) line += ` value="${el.value}"`;
      lines.push(line);
    }
    const snapshotText = lines.join('\n');

    // Modal / dialog open � warn the AI so it doesn't try to interact with background elements.
    if (snapshotData?.modalOpen) {
      const label = snapshotData.modalLabel ? ` ("${snapshotData.modalLabel}")` : '';
      return snapshotText
        + `\n\n[MODAL OPEN]${label} A dialog/modal is blocking the page. The ${elements.length} elements above are ONLY the controls inside this modal. Background page elements are NOT accessible until the modal is closed. To dismiss: look for a Close button or press Escape with browser_press_key({"key":"Escape"}).`;
    }

    // Login wall detection � append an explicit action hint so the agent doesn't loop.
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

    // -- Low-element heuristic: try same-origin frame piercing, flag cross-origin -
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
        let nextFrameRef = elements.reduce((max, el) => Math.max(max, Number(el.ref) || 0), 0) + 1;

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
            const startRef = nextFrameRef;
            const frameData = await frameHandle.evaluate((args: { max: number; startRef: number }) => {
              const doc = (globalThis as any).document;
              const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]';
              const results: any[] = [];
              let nextRef = Number(args.startRef) || 1;
              for (const el of Array.from(doc.querySelectorAll(sel)).slice(0, args.max) as any[]) {
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || tag;
                const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || '').slice(0, 80);
                if (!name && !['input','textarea','select'].includes(tag)) continue;
                const rect = el.getBoundingClientRect?.();
                if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0)) continue;
                // Reassign frame refs from the current snapshot high-water mark so
                // they stay unique against main-frame refs and old legacy frame refs.
                const ref = nextRef++;
                try { el.setAttribute('data-sc-ref', String(ref)); } catch {}
                results.push({ ref, role, name, tag, isInput: ['input','textarea','select'].includes(tag) });
              }
              return results;
            }, { max: 60, startRef }).catch(() => []);
            nextFrameRef = frameData.reduce((max: number, entry: any) => Math.max(max, Number(entry?.ref) || 0), startRef - 1) + 1;

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
          extras.push(`\n[SAME-ORIGIN FRAME ELEMENTS � interactable via normal browser_click/browser_fill]\n${sameOriginElements.join('\n')}`);
        }
        if (crossOrigin.length > 0) {
          const lines = crossOrigin.map(f => `  - ${f.name || f.id || 'iframe'} ? ${f.src.slice(0, 200)}`).join('\n');
          extras.push(`\n[CROSS-ORIGIN IFRAMES � content cannot be read directly; navigate with browser_open]\n${lines}`);
        }
        if (extras.length > 0) {
          return snapshotText + extras.join('');
        }
      } catch { /* best effort */ }

      // -- Fallback: append visible body text so AI can still read content -----
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

// --- Element Interaction -------------------------------------------------------

// Shared selector used consistently across snapshot + click + fill
export const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  'input[type="search"]', 'input[type="text"]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="search"]',
  '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]',
  '[contenteditable="true"]',
  '[data-testid]',
  'h1', 'h2', 'h3',
].join(', ');

export async function findLocatorByStableRef(page: PwPage, ref: number): Promise<any | null> {
  const selector = `[data-sc-ref="${ref}"]`;
  for (const frame of page.frames()) {
    try {
      const locator = frame.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (count > 0) return locator;
    } catch {
      // Continue scanning other frames.
    }
  }
  return null;
}

export async function describeLocator(locator: any): Promise<{
  tag: string;
  role: string;
  name: string;
  isInput: boolean;
  isContentEditable: boolean;
}> {
  const meta = await locator.evaluate((el: any) => {
    const tag = String(el?.tagName || '').toLowerCase() || 'element';
    const role = String(el?.getAttribute?.('role') || '').toLowerCase() || tag;
    const isContentEditable = el?.getAttribute?.('contenteditable') === 'true';
    const isInput = ['input', 'textarea', 'select'].includes(tag)
      || isContentEditable
      || ['textbox', 'searchbox', 'combobox'].includes(role);
    const name = String(
      el?.getAttribute?.('aria-label')
      || (el?.innerText || '').trim()
      || el?.getAttribute?.('placeholder')
      || el?.getAttribute?.('data-testid')
      || tag,
    ).slice(0, 80);
    return { tag, role, name, isInput, isContentEditable };
  }).catch(() => null);
  if (!meta) {
    return { tag: 'element', role: 'element', name: 'element', isInput: false, isContentEditable: false };
  }
  return {
    tag: String(meta.tag || 'element'),
    role: String(meta.role || meta.tag || 'element'),
    name: String(meta.name || meta.tag || 'element').trim() || 'element',
    isInput: !!meta.isInput,
    isContentEditable: !!meta.isContentEditable,
  };
}

export async function resolveViewportPointFromTarget(
  page: PwPage,
  target: { ref?: number; x?: number; y?: number },
  labelPrefix: string,
): Promise<{ x: number; y: number; label: string }> {
  const ref = Number(target?.ref);
  if (Number.isFinite(ref) && ref > 0) {
    const locator = await findLocatorByStableRef(page, ref);
    if (!locator) throw new Error(`${labelPrefix} ref @${ref} not found`);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const meta = await describeLocator(locator);
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error(`${labelPrefix} ref @${ref} is not visible`);
    }
    return {
      x: Math.round(box.x + (box.width / 2)),
      y: Math.round(box.y + (box.height / 2)),
      label: `@${ref} (${meta.role}: "${meta.name}")`,
    };
  }
  const x = Math.round(Number(target?.x));
  const y = Math.round(Number(target?.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${labelPrefix} requires either *_ref or both *_x and *_y`);
  }
  return { x, y, label: `(${x}, ${y})` };
}

// Click a page element by its stable data-sc-ref number
export async function clickByRef(page: PwPage, ref: number, options?: { settleMs?: number }): Promise<{ role: string; name: string }> {
  const settleMs = Math.max(0, Number(options?.settleMs ?? 120) || 0);
  const locator = await findLocatorByStableRef(page, ref);
  if (locator) {
    const meta = await describeLocator(locator);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click();
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    return { role: meta.role, name: meta.name };
  }

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
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  return fallback;
}

export async function clickBySelector(page: PwPage, selector: string, options?: { settleMs?: number }): Promise<{ role: string; name: string }> {
  const settleMs = Math.max(0, Number(options?.settleMs ?? 120) || 0);
  const locator = page.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  if (!count) throw new Error(`No element found for selector "${selector}"`);
  const meta = await locator.evaluate((el: any) => {
    const tag = String(el?.tagName || '').toLowerCase() || 'element';
    const role = String(el?.getAttribute?.('role') || '').toLowerCase() || tag;
    const name = String(
      el?.getAttribute?.('aria-label')
      || (el?.innerText || '').trim()
      || el?.getAttribute?.('placeholder')
      || el?.getAttribute?.('data-testid')
      || tag,
    ).slice(0, 80);
    return { role, name };
  }).catch(() => null);
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click();
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  return {
    role: String(meta?.role || 'element'),
    name: String(meta?.name || selector).trim() || selector,
  };
}

// Fill a page element by its stable data-sc-ref number
export async function fillByRef(page: PwPage, ref: number, text: string): Promise<{ role: string; name: string; needsNativeType?: boolean }> {
  const locator = await findLocatorByStableRef(page, ref);
  const result = locator
    ? await locator.evaluate((el: any, args: { ref: number; text: string }) => {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const isContentEditable = el.getAttribute('contenteditable') === 'true';
      const isInput = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
      const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80) || (isContentEditable ? 'editable' : '');
      if (!isInput) return { error: `Element @${args.ref} (${el.getAttribute('role') || tag}) is not a text input.` };
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
      if (typeof el.focus === 'function') el.focus();
      if (tag === 'select') {
        el.value = args.text;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (isContentEditable) {
        if (typeof el.click === 'function') el.click();
        return { role: role || tag, name: name || tag, needsNativeType: true };
      } else {
        const valuePrototype = tag === 'textarea'
          ? (globalThis as any).HTMLTextAreaElement?.prototype
          : (globalThis as any).HTMLInputElement?.prototype;
        const nativeSetter = valuePrototype
          ? Object.getOwnPropertyDescriptor(valuePrototype, 'value')?.set
          : undefined;
        if (nativeSetter) nativeSetter.call(el, args.text);
        else el.value = args.text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { role: role || tag, name: name || tag };
    }, { ref, text })
    : null;

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
            const valuePrototype = tag === 'textarea' ? (globalThis as any).HTMLTextAreaElement?.prototype : (globalThis as any).HTMLInputElement?.prototype;
            const nativeSetter = valuePrototype ? Object.getOwnPropertyDescriptor(valuePrototype, 'value')?.set : undefined;
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
    // Type text character by character � this fires real KeyDown/KeyPress/KeyUp/Input
    // events that React's synthetic event system correctly intercepts.
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(400);
  }

  return { role: result.role, name: result.name, needsNativeType: !!(result as any).needsNativeType };
}

export async function fillBySelector(
  page: PwPage,
  selector: string,
  text: string,
): Promise<{ role: string; name: string; needsNativeType?: boolean }> {
  const locator = page.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  if (!count) throw new Error(`No element found for selector "${selector}"`);
  const result = await locator.evaluate((el: any, nextText: string) => {
    const tag = String(el?.tagName || '').toLowerCase();
    const role = String(el?.getAttribute?.('role') || '').toLowerCase();
    const isContentEditable = el?.getAttribute?.('contenteditable') === 'true';
    const isInput = ['input', 'textarea', 'select'].includes(tag) || isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role);
    const name = String(
      el?.getAttribute?.('aria-label')
      || (el?.innerText || '').trim()
      || el?.getAttribute?.('placeholder')
      || el?.getAttribute?.('data-testid')
      || '',
    ).slice(0, 80) || (isContentEditable ? 'editable' : '') || tag || 'element';
    if (!isInput) {
      return { error: `Element "${name}" (${role || tag || 'element'}) is not a text input.` };
    }
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    if (typeof el?.focus === 'function') el.focus();
    if (tag === 'select') {
      el.value = nextText;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { role: role || tag, name };
    }
    if (isContentEditable) {
      if (typeof el?.click === 'function') el.click();
      return { role: role || tag, name, needsNativeType: true };
    }
    const valuePrototype = tag === 'textarea'
      ? (globalThis as any).HTMLTextAreaElement?.prototype
      : (globalThis as any).HTMLInputElement?.prototype;
    const nativeSetter = valuePrototype
      ? Object.getOwnPropertyDescriptor(valuePrototype, 'value')?.set
      : undefined;
    if (nativeSetter) nativeSetter.call(el, nextText);
    else el.value = nextText;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { role: role || tag, name };
  }, text);

  if (!result || (result as any).error) {
    throw new Error((result as any)?.error || `Unable to fill selector "${selector}"`);
  }
  if ((result as any).needsNativeType) {
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(100);
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(400);
  }
  return {
    role: String((result as any).role || 'element'),
    name: String((result as any).name || selector).trim() || selector,
    needsNativeType: !!(result as any).needsNativeType,
  };
}
