// Desktop secondary chat surfaces must not maintain a visual copy of the main
// composer. Subagent, team, and legacy side-chat renderers may still own their
// transport/state adapters, but the visible control is cloned from the actual
// main #chat-view composer DOM every time those surfaces render.
//
// This deliberately strips the old surface-specific geometry classes
// (side-chat-composer, unified-agent-chat-composer, subagent-panel-chat-composer,
// etc.) so only the same .chat-input-area/.chat-input-row styling path used by
// the main chat can affect the visible control.

const SECONDARY_COMPOSER_SELECTOR = [
  '.side-chat-composer.chat-input-area',
  '.unified-agent-chat-composer.chat-input-area',
].join(', ');

const MAIN_COMPOSER_SELECTOR = '#chat-view > .chat-input-area:not([data-canonical-secondary-composer])';
const MAIN_ONLY_SELECTOR = [
  '#main-goal-strip',
  '#chat-design-selection-pills',
  '#chat-skill-trigger-pill',
  '#chat-question-popover',
  '#chat-slash-command-popover',
  '#chat-skill-command-popover',
  '#chat-slash-menu',
  '#chat-command-chip',
].join(', ');

function copyBehaviorAttributes(target, source, names) {
  if (!target || !source) return;
  for (const name of names) {
    if (source.hasAttribute(name)) target.setAttribute(name, source.getAttribute(name));
    else target.removeAttribute(name);
  }
}

function copyIdentity(target, source) {
  if (!target || !source) return;
  if (source.id) target.id = source.id;
  else target.removeAttribute('id');
  for (const attr of Array.from(source.attributes || [])) {
    if (!attr.name.startsWith('data-')) continue;
    target.setAttribute(attr.name, attr.value);
  }
}

function copyRootState(target, source) {
  if (!target || !source) return;
  for (const attr of Array.from(source.attributes || [])) {
    if (!attr.name.startsWith('data-') && !attr.name.startsWith('aria-')) continue;
    target.setAttribute(attr.name, attr.value);
  }
}

function resetMainOnlyState(clone) {
  clone.querySelectorAll(MAIN_ONLY_SELECTOR).forEach((node) => node.remove());

  // A DOM clone also copies every descendant id. Those ids belong to the real
  // main composer and must never exist twice in the document (for example,
  // #chat-composer-input-wrap). Context-specific ids are restored below from
  // the owning secondary renderer after the main visual shell is sanitized.
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));

  const queuePanel = clone.querySelector('.queued-prompts-panel');
  if (queuePanel) {
    queuePanel.style.display = 'none';
    const list = queuePanel.querySelector('.queued-prompts-list');
    if (list) list.replaceChildren();
  }

  const richPreview = clone.querySelector('.chat-composer-rich-preview');
  if (richPreview) {
    richPreview.replaceChildren();
    richPreview.hidden = true;
  }
}

function legacyStagingNode(legacy) {
  const candidates = Array.from(legacy.querySelectorAll('.chat-file-staging'));
  return candidates.find((node) => node.id)
    || candidates.find((node) => node.innerHTML.trim() || node.style.display !== 'none')
    || candidates[0]
    || null;
}

function transferStaging(clone, legacy) {
  const legacyStaging = legacyStagingNode(legacy);
  const cloneStack = clone.querySelector('.chat-composer-attachment-stack');
  const cloneStaging = clone.querySelector('.chat-file-staging');
  if (!cloneStack || !cloneStaging) return;

  cloneStack.removeAttribute('id');
  cloneStack.style.display = legacyStaging && legacyStaging.style.display !== 'none' ? '' : 'none';
  if (!legacyStaging) {
    cloneStaging.removeAttribute('id');
    cloneStaging.replaceChildren();
    cloneStaging.style.display = 'none';
    return;
  }

  copyIdentity(cloneStaging, legacyStaging);
  cloneStaging.innerHTML = legacyStaging.innerHTML;
  cloneStaging.style.display = legacyStaging.style.display || 'none';
}

function transferFileInput(clone, legacy) {
  const source = legacy.querySelector('input[type="file"]');
  const target = clone.querySelector('input[type="file"]');
  if (!source || !target) return;
  copyIdentity(target, source);
  copyBehaviorAttributes(target, source, ['onchange', 'accept', 'multiple']);
}

function transferButton(clone, legacy, selector, behaviorAttributes) {
  const source = legacy.querySelector(selector);
  const target = clone.querySelector(selector);
  if (!source || !target) return;
  copyIdentity(target, source);
  copyBehaviorAttributes(target, source, behaviorAttributes);
  // Keep the main composer's button chrome but preserve contextual stop/send
  // iconography where the owning surface changes it dynamically.
  if (selector === '.send-btn') target.innerHTML = source.innerHTML;
}

function transferTextarea(clone, legacy) {
  const source = legacy.querySelector('textarea');
  const target = clone.querySelector('textarea');
  if (!source || !target) return;

  copyIdentity(target, source);
  copyBehaviorAttributes(target, source, [
    'oninput', 'onkeydown', 'onpaste', 'placeholder', 'autocomplete',
    'autocapitalize', 'enterkeyhint', 'aria-label', 'rows',
  ]);
  // Secondary IDs cannot use the #chat-input selector, so use the existing
  // shared textarea hook. Its declarations intentionally match #chat-input.
  target.classList.add('chat-textarea');
  target.value = source.value || '';
  target.textContent = source.value || '';
}

function transferLegacyFooter(clone, legacy) {
  const source = legacy.querySelector('.agent-toggle');
  const target = clone.querySelector('.agent-toggle');
  if (!source || !target) return;

  // Move the contextual footer rather than serializing it so any listeners
  // already attached by Subagents/Teams survive canonicalization. Remove the
  // old helper-only class/inline spacing so the main .agent-toggle rules win.
  source.classList.remove('unified-desktop-chat-composer-footer');
  source.removeAttribute('style');
  target.replaceWith(source);
}

function transferSecondaryAuxiliaryMarkup(clone, legacy) {
  // Team chat owns its @mention menu outside the shared composer controls.
  // Keep that behavior while discarding the old mirrored-text input chrome;
  // the canonical textarea already provides the visible input surface.
  const mentionPopover = legacy.querySelector('#team-chat-mention-popover');
  const inputWrap = clone.querySelector('.chat-composer-input-wrap');
  if (mentionPopover && inputWrap) inputWrap.appendChild(mentionPopover);
}

function configureSideComposerControls(clone, legacy) {
  const sessionId = String(
    legacy.dataset.composerSessionId
    || clone.dataset.composerSessionId
    || legacy.closest('[data-chat-pane-key]')?.getAttribute('data-chat-pane-key')?.replace(/^side:/, '')
    || '',
  ).trim();
  if (!sessionId) return false;

  clone.dataset.composerSessionId = sessionId;
  clone.dataset.secondarySurface = legacy.dataset.secondarySurface || 'side-chat';
  clone.classList.add('canonical-secondary-desktop-composer');

  const switcherWrap = clone.querySelector('.chat-model-switcher-wrap');
  const modelButton = switcherWrap?.querySelector('button');
  const modelName = switcherWrap?.querySelector('button span:not(.model-speed-icon)');
  const speedIcon = switcherWrap?.querySelector('.model-speed-icon');
  if (modelButton) {
    modelButton.removeAttribute('id');
    modelButton.setAttribute('onclick', 'toggleDesktopComposerModelSwitcher(event, this)');
    modelButton.dataset.composerModelSessionId = sessionId;
    modelButton.title = 'Switch model for this chat';
    modelButton.setAttribute('aria-label', 'Switch model for this chat');
  }
  if (modelName) {
    modelName.classList.add('chat-model-name');
    modelName.dataset.composerModelName = '1';
    modelName.dataset.composerModelSessionId = sessionId;
  }
  if (speedIcon) {
    speedIcon.removeAttribute('id');
    speedIcon.dataset.composerModelSpeed = '1';
    speedIcon.dataset.composerModelSessionId = sessionId;
  }

  const contextButton = switcherWrap?.querySelector('.chat-context-window-btn');
  const contextPopover = switcherWrap?.querySelector('.chat-context-window-popover');
  const contextToggle = contextPopover?.querySelector('.chat-context-window-toggle');
  if (contextButton) {
    contextButton.removeAttribute('id');
    contextButton.dataset.contextWindowSessionId = sessionId;
    contextButton.setAttribute('onclick', 'toggleChatContextWindowPopover(event, this)');
  }
  if (contextPopover) {
    contextPopover.removeAttribute('id');
    contextPopover.dataset.contextWindowSessionId = sessionId;
    contextPopover.querySelector('.chat-context-window-head span:last-child')?.classList.add('chat-context-window-total');
  }
  if (contextToggle) {
    contextToggle.removeAttribute('id');
    contextToggle.setAttribute('onclick', 'toggleChatContextBreakdown(event, this)');
  }

  const modelPopover = switcherWrap?.querySelector('.model-switcher-popover');
  const modelMain = modelPopover?.querySelector('.model-switcher-panel:not(.model-switcher-detail)');
  const modelDetail = modelPopover?.querySelector('.model-switcher-detail');
  if (modelPopover) {
    modelPopover.removeAttribute('id');
    modelPopover.dataset.modelSwitcherPopover = '1';
    modelPopover.dataset.modelSwitcherSessionId = sessionId;
  }
  if (modelMain) {
    modelMain.removeAttribute('id');
    modelMain.dataset.modelSwitcherMain = '1';
  }
  if (modelDetail) {
    modelDetail.removeAttribute('id');
    modelDetail.dataset.modelSwitcherDetail = '1';
  }

  return true;
}

function canonicalizeComposer(legacy) {
  if (!(legacy instanceof HTMLElement)) return null;
  if (legacy.dataset.canonicalSecondaryComposer === '1') return legacy;

  const main = document.querySelector(MAIN_COMPOSER_SELECTOR);
  if (!(main instanceof HTMLElement) || main === legacy) return null;

  const clone = main.cloneNode(true);
  clone.hidden = false;
  clone.removeAttribute('id');
  clone.removeAttribute('style');
  clone.removeAttribute('aria-hidden');
  // Keep only the base composer plus the existing non-geometric shared hook.
  // Critically, do not carry any side/subagent/team geometry class forward.
  clone.className = 'chat-input-area unified-desktop-chat-composer';
  copyRootState(clone, legacy);
  clone.dataset.canonicalSecondaryComposer = '1';
  clone.dataset.canonicalComposerSource = 'main-chat-dom';
  clone.setAttribute('data-main-composer-parity', '1');

  resetMainOnlyState(clone);
  transferStaging(clone, legacy);
  transferFileInput(clone, legacy);
  transferButton(clone, legacy, '.chat-attach-btn', ['onclick', 'title', 'aria-label', 'type']);
  transferButton(clone, legacy, '.chat-voice-btn', ['onclick', 'title', 'aria-label', 'type']);
  transferTextarea(clone, legacy);
  transferButton(clone, legacy, '.send-btn', ['onclick', 'title', 'aria-label', 'type']);
  transferSecondaryAuxiliaryMarkup(clone, legacy);
  if (legacy.dataset.secondarySurface === 'background-agent') transferLegacyFooter(clone, legacy);
  else configureSideComposerControls(clone, legacy);

  legacy.replaceWith(clone);
  if (legacy.dataset.secondarySurface !== 'background-agent') {
    setTimeout(() => {
      try { window.refreshActiveChatModelRoute?.(clone.dataset.composerSessionId); } catch {}
      try {
        const button = clone.querySelector('.chat-context-window-btn');
        window.refreshChatContextWindow?.({ sessionId: clone.dataset.composerSessionId, target: button, force: true });
      } catch {}
    }, 0);
  }
  try {
    clone.dispatchEvent(new CustomEvent('prometheus:canonical-composer-mounted', { bubbles: true }));
  } catch {}
  return clone;
}

function scan(root = document) {
  if (window.__PROM_SHOULD_BOOT_MOBILE?.()) return;
  if (root instanceof Element && root.matches?.(SECONDARY_COMPOSER_SELECTOR)) {
    canonicalizeComposer(root);
  }
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll(SECONDARY_COMPOSER_SELECTOR).forEach((node) => canonicalizeComposer(node));
}

function install() {
  if (window.__PROM_CANONICAL_DESKTOP_COMPOSER_INSTALLED) return;
  window.__PROM_CANONICAL_DESKTOP_COMPOSER_INSTALLED = true;
  scan(document);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__PROM_CANONICAL_DESKTOP_COMPOSER = { scan, canonicalizeComposer };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
