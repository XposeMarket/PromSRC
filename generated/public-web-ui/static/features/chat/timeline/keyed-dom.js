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
  return Object.freeze({
    anchorKey,
    anchorOffset,
    nearBottom: distanceFromBottom <= threshold,
    distanceFromBottom,
    scrollTop: metrics.scrollTop,
    pinnedKeys: selectedTimelineRowKeys(root),
  });
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
