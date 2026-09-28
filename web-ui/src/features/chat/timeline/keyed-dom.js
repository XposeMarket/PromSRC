function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function directKey(node, index, occurrences) {
  if (!node || node.nodeType !== 1) return '';
  const base = String(
    node.getAttribute?.('data-chat-row-key')
    || node.getAttribute?.('data-pm-row-key')
    || (node.id ? `id:${node.id}` : '')
    || `aux:${String(node.tagName || '').toLowerCase()}:${String(node.className || '')}`,
  ).trim();
  const occurrence = occurrences.get(base) || 0;
  occurrences.set(base, occurrence + 1);
  return occurrence ? `${base}::${occurrence}` : base || `row:${index}`;
}

function rowKey(node) {
  return String(node?.getAttribute?.('data-chat-row-key') || node?.getAttribute?.('data-pm-row-key') || '').trim();
}

function selectedElement(selection, node) {
  if (!node) return null;
  const element = node.nodeType === 1 ? node : node.parentElement;
  return element?.closest?.('[data-chat-row-key],[data-pm-row-key]') || null;
}

export function selectedTimelineRowKeys(root, selection = globalThis.document?.getSelection?.()) {
  const keys = new Set();
  if (!root || !selection || selection.rangeCount < 1 || selection.isCollapsed) return keys;
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const element = selectedElement(selection, node);
    if (!element || !root.contains(element)) continue;
    const key = rowKey(element);
    if (key) keys.add(key);
  }
  return keys;
}

function scrollerMetrics(scroller) {
  if (!scroller) return { top: 0, height: 0, scrollTop: 0, scrollHeight: 0 };
  const rect = scroller.getBoundingClientRect?.() || { top: 0, height: Number(scroller.clientHeight || 0) };
  return {
    top: Number(rect.top || 0),
    height: Number(rect.height || scroller.clientHeight || 0),
    scrollTop: Number(scroller.scrollTop || 0),
    scrollHeight: Number(scroller.scrollHeight || 0),
  };
}

export function captureKeyedScrollState(root, scroller = root, options = {}) {
  const metrics = scrollerMetrics(scroller);
  const threshold = Math.max(0, Number(options.bottomThreshold ?? 72));
  const distanceFromBottom = Math.max(0, metrics.scrollHeight - metrics.scrollTop - Number(scroller?.clientHeight || metrics.height || 0));
  let anchorKey = '';
  let anchorOffset = 0;
  for (const child of Array.from(root?.children || [])) {
    const key = rowKey(child);
    if (!key) continue;
    const rect = child.getBoundingClientRect?.();
    if (!rect || Number(rect.bottom) < metrics.top) continue;
    anchorKey = key;
    anchorOffset = Number(rect.top || 0) - metrics.top;
    break;
  }
  const state = Object.freeze({
    anchorKey,
    anchorOffset,
    nearBottom: distanceFromBottom <= threshold,
    distanceFromBottom,
    scrollTop: metrics.scrollTop,
    pinnedKeys: selectedTimelineRowKeys(root),
  });
  // Remember the last observed position so a session swap can restore it even
  // when the old container is already detached (no live scroller to read).
  try { if (root && root.children?.length) root.__promLastScrollState = state; } catch {}
  return state;
}

function syncAttributes(current, next) {
  for (const attribute of Array.from(current.attributes || [])) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(next.attributes || [])) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
}

function sameRenderSignature(current, next) {
  const currentSignature = current.getAttribute?.('data-chat-row-signature') || current.getAttribute?.('data-pm-row-signature');
  const nextSignature = next.getAttribute?.('data-chat-row-signature') || next.getAttribute?.('data-pm-row-signature');
  return !!currentSignature && currentSignature === nextSignature
    && current.tagName === next.tagName
    && current.className === next.className
    && current.getAttribute?.('data-chat-message-index') === next.getAttribute?.('data-chat-message-index')
    && current.getAttribute?.('data-msg-index') === next.getAttribute?.('data-msg-index');
}

function restoreScroll(root, scroller, snapshot, followBottom) {
  if (!scroller || !snapshot) return;
  if (followBottom || snapshot.nearBottom) {
    scroller.scrollTop = scroller.scrollHeight;
    return;
  }
  const anchor = snapshot.anchorKey
    ? Array.from(root.children || []).find((node) => rowKey(node) === snapshot.anchorKey)
    : null;
  if (anchor?.getBoundingClientRect) {
    const scrollerTop = Number(scroller.getBoundingClientRect?.().top || 0);
    const nextOffset = Number(anchor.getBoundingClientRect().top || 0) - scrollerTop;
    scroller.scrollTop += nextOffset - Number(snapshot.anchorOffset || 0);
  } else {
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - Number(scroller.clientHeight || 0) - Number(snapshot.distanceFromBottom || 0));
  }
}

function holdBottom(root, scroller, durationMs = 4000) {
  try { scroller.__promHoldBottomCancel?.(); } catch {}
  const win = globalThis;
  let done = false;
  let resizeObs = null;
  let mutationObs = null;
  let timer = 0;
  const pinNow = () => { if (!done) scroller.scrollTop = Number(scroller.scrollHeight || 0); };
  const stopEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const cancel = () => {
    if (done) return;
    done = true;
    try { resizeObs?.disconnect(); } catch {}
    try { mutationObs?.disconnect(); } catch {}
    try { win.clearTimeout?.(timer); } catch {}
    for (const type of stopEvents) { try { scroller.removeEventListener?.(type, cancel); } catch {} }
    if (scroller.__promHoldBottomCancel === cancel) scroller.__promHoldBottomCancel = null;
  };
  scroller.__promHoldBottomCancel = cancel;
  for (const type of stopEvents) { try { scroller.addEventListener?.(type, cancel, { passive: true }); } catch {} }
  try {
    if (typeof win.ResizeObserver === 'function') {
      resizeObs = new win.ResizeObserver(pinNow);
      resizeObs.observe(root);
      for (const child of Array.from(root.children || []).slice(-4)) resizeObs.observe(child);
    }
    if (typeof win.MutationObserver === 'function') {
      mutationObs = new win.MutationObserver(() => {
        pinNow();
        const last = root.lastElementChild;
        if (last && resizeObs) { try { resizeObs.observe(last); } catch {} }
      });
      mutationObs.observe(root, { childList: true });
    }
  } catch {}
  try { win.requestAnimationFrame?.(pinNow); } catch {}
  timer = win.setTimeout?.(cancel, durationMs) || 0;
}

// Per-session rendered-row cache. Every thread renders into ONE shared
// container, so switching A -> B -> A used to discard all of A's rows and
// rebuild every message, trace drawer and tool card from scratch. Instead we
// park the outgoing session's row nodes in a detached fragment and put them
// back when that session is shown again; reconcileKeyedTimelineRows then only
// touches rows whose signature actually changed while the thread was hidden.
const sessionRowCaches = new Map();

export function swapKeyedTimelineSession(root, sessionKey, options = {}) {
  const key = String(sessionKey || '').trim();
  if (!root || !key) return false;
  const namespace = String(options.namespace || 'default');
  const maxSessions = Math.max(1, Number(options.maxSessions) || 6);
  let state = sessionRowCaches.get(namespace);
  if (!state) {
    state = { entries: new Map(), lastRoot: null };
    sessionRowCaches.set(namespace, state);
  }
  const documentRef = root.ownerDocument || globalThis.document;
  const scroller = options.scroller || root;
  const stash = (host, hostKey, hostScroller) => {
    if (!host || !hostKey || !host.children?.length || !documentRef?.createDocumentFragment) return;
    // Read scroll BEFORE moving rows out. A detached host has no live scroller,
    // so fall back to the last observed render snapshot; unknown => bottom.
    // (Saving 0 here is what made reopened threads jump to the top.)
    let nearBottom = true;
    let distanceFromBottom = 0;
    if (hostScroller && hostScroller.scrollHeight > 0) {
      distanceFromBottom = Math.max(0, Number(hostScroller.scrollHeight || 0) - Number(hostScroller.scrollTop || 0) - Number(hostScroller.clientHeight || 0));
      nearBottom = distanceFromBottom <= 72;
    } else if (host.__promLastScrollState) {
      nearBottom = host.__promLastScrollState.nearBottom !== false;
      distanceFromBottom = Number(host.__promLastScrollState.distanceFromBottom || 0);
    }
    const fragment = documentRef.createDocumentFragment();
    while (host.firstChild) fragment.appendChild(host.firstChild);
    state.entries.delete(hostKey);
    state.entries.set(hostKey, { fragment, nearBottom, distanceFromBottom });
    while (state.entries.size > maxSessions) state.entries.delete(state.entries.keys().next().value);
  };
  // The page shell can be rebuilt (new container) while the old one still
  // holds the previous session's rows; rescue them before they are GC'd.
  const lastRoot = state.lastRoot;
  if (lastRoot && lastRoot !== root && lastRoot.isConnected === false && lastRoot.__promTimelineSessionKey) {
    stash(lastRoot, lastRoot.__promTimelineSessionKey, null);
  }
  state.lastRoot = root;
  const mounted = String(root.__promTimelineSessionKey || '');
  if (mounted === key) return false;
  if (mounted) stash(root, mounted, scroller);
  root.__promTimelineSessionKey = key;
  root.__promLastScrollState = null;
  const cached = state.entries.get(key);
  const pin = (entry) => {
    if (!scroller) return;
    const toBottom = !entry || entry.nearBottom !== false;
    const apply = () => {
      const height = Number(scroller.scrollHeight || 0);
      scroller.scrollTop = toBottom
        ? height
        : Math.max(0, height - Number(scroller.clientHeight || 0) - Number(entry.distanceFromBottom || 0));
    };
    apply();
    // Late layout (history fetch, markdown, images, fonts, tool cards) keeps
    // growing a cold thread for a second or two after the first render; one
    // rAF re-pin was not enough, so cold opens landed mid-thread. Hold the
    // bottom while content grows, until the user touches/scrolls or ~4s.
    if (toBottom) holdBottom(root, scroller);
    else { try { globalThis.requestAnimationFrame?.(apply); } catch {} }
  };
  if (!cached) {
    // Newly opened thread: start pinned to the bottom so the render that
    // follows sees nearBottom and keeps following the tail.
    pin(null);
    return false;
  }
  state.entries.delete(key);
  root.textContent = '';
  root.appendChild(cached.fragment);
  pin(cached);
  return true;
}

export function dropKeyedTimelineSession(sessionKey, namespace = 'default') {
  sessionRowCaches.get(String(namespace))?.entries.delete(String(sessionKey || '').trim());
}


export function reconcileKeyedTimelineRows(root, html, options = {}) {
  if (!root) return Object.freeze({ created: 0, updated: 0, removed: 0, reused: 0, total: 0, durationMs: 0 });
  const startedAt = now();
  const documentRef = root.ownerDocument || globalThis.document;
  const template = documentRef?.createElement?.('template');
  if (!template?.content) {
    root.innerHTML = String(html || '');
    return Object.freeze({ created: 0, updated: 0, removed: 0, reused: 0, total: root.children?.length || 0, durationMs: now() - startedAt });
  }
  template.innerHTML = String(html || '');
  const nextChildren = Array.from(template.content.children || []);
  const currentChildren = Array.from(root.children || []);
  const currentOccurrences = new Map();
  const nextOccurrences = new Map();
  const existing = new Map(currentChildren.map((node, index) => [directKey(node, index, currentOccurrences), node]));
  const retained = new Set();
  const ordered = [];
  let created = 0;
  let updated = 0;
  let reused = 0;
  const setContents = typeof options.setContents === 'function'
    ? options.setContents
    : ((node, markup) => { node.innerHTML = markup; });

  nextChildren.forEach((nextNode, index) => {
    const key = directKey(nextNode, index, nextOccurrences);
    const current = existing.get(key);
    if (current && current.tagName === nextNode.tagName) {
      retained.add(current);
      if (sameRenderSignature(current, nextNode)) {
        reused += 1;
      } else if (current.outerHTML === nextNode.outerHTML) {
        reused += 1;
      } else {
        syncAttributes(current, nextNode);
        setContents(current, nextNode.innerHTML);
        updated += 1;
      }
      ordered.push(current);
      return;
    }
    const clone = nextNode.cloneNode(true);
    ordered.push(clone);
    retained.add(clone);
    created += 1;
  });

  for (const node of currentChildren) {
    if (!retained.has(node)) node.remove();
  }
  ordered.forEach((node, index) => {
    const atIndex = root.children[index];
    if (atIndex !== node) root.insertBefore(node, atIndex || null);
  });
  const removed = currentChildren.filter((node) => !retained.has(node)).length;
  const scroller = options.scroller || root;
  restoreScroll(root, scroller, options.scrollState, options.followBottom === true);
  const restoreRevision = Number(root.__promTimelineRestoreRevision || 0) + 1;
  root.__promTimelineRestoreRevision = restoreRevision;
  globalThis.requestAnimationFrame?.(() => {
    if (root.__promTimelineRestoreRevision !== restoreRevision) return;
    restoreScroll(root, scroller, options.scrollState, options.followBottom === true);
  });
  const stats = Object.freeze({ created, updated, removed, reused, total: ordered.length, durationMs: Number((now() - startedAt).toFixed(3)) });
  const diagnostics = globalThis.__PROM_CHAT_TIMELINE_DIAGNOSTICS || (globalThis.__PROM_CHAT_TIMELINE_DIAGNOSTICS = { commits: 0, created: 0, updated: 0, removed: 0, reused: 0, last: null });
  diagnostics.commits += 1;
  diagnostics.created += created;
  diagnostics.updated += updated;
  diagnostics.removed += removed;
  diagnostics.reused += reused;
  diagnostics.last = stats;
  return stats;
}

export function reconcileKeyedTimelinePanes(root, html, options = {}) {
  if (!root?.ownerDocument) return false;
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = String(html || '');
  const currentPanes = Array.from(root.children || []).filter((pane) => pane.hasAttribute('data-chat-pane-key'));
  const nextPanes = Array.from(template.content.children || []).filter((pane) => pane.hasAttribute('data-chat-pane-key'));
  const paneKey = (pane) => String(pane.getAttribute('data-chat-pane-key') || '');
  if (!currentPanes.length || currentPanes.length !== nextPanes.length
    || currentPanes.some((pane, index) => paneKey(pane) !== paneKey(nextPanes[index]))) return false;
  for (let index = 0; index < currentPanes.length; index += 1) {
    const currentPane = currentPanes[index];
    const nextPane = nextPanes[index];
    const currentMessages = currentPane.querySelector('.side-chat-main-messages, .side-chat-messages');
    const nextMessages = nextPane.querySelector('.side-chat-main-messages, .side-chat-messages');
    if (!currentMessages || !nextMessages) return false;
    const scrollState = captureKeyedScrollState(currentMessages, currentMessages);
    reconcileKeyedTimelineRows(currentMessages, nextMessages.innerHTML, {
      scroller: currentMessages,
      scrollState,
      followBottom: scrollState.nearBottom,
      setContents: options.setContents,
    });
    const currentHeader = currentPane.querySelector('.side-chat-pane-header, .side-chat-header');
    const nextHeader = nextPane.querySelector('.side-chat-pane-header, .side-chat-header');
    if (currentHeader && nextHeader && currentHeader.innerHTML !== nextHeader.innerHTML) {
      currentHeader.innerHTML = nextHeader.innerHTML;
    }
  }
  return true;
}
