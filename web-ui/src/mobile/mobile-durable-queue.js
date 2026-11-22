const ROUTE = '/api/chat/mobile-queue';
const RECEIPT_KEY = 'pm.mobile.last-unconfirmed-queue-receipt';

const encode = (value) => new TextEncoder().encode(value);
async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function draftFingerprint(message, files, skills) {
  const attachments = await Promise.all(files.map(async file => [file?.name, file?.kind, file?.mimeType,
    await digest(file?.file?.arrayBuffer ? await file.file.arrayBuffer() : encode(file?.base64 || file?.text || file?.dataUrl || ''))]));
  return digest(encode(JSON.stringify([message, attachments, skills.selectedSkillIds || [], skills.excludedSkillIds || []])));
}

function readRetries() {
  try {
    const entries = JSON.parse(localStorage.getItem(RECEIPT_KEY) || '[]');
    return Array.isArray(entries) ? entries : [];
  } catch { return []; }
}
function writeRetries(entries) {
  try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(entries.slice(-16))); } catch { /* storage may be disabled */ }
}
function saveRetry(value, id) {
  const entries = readRetries().filter(entry => entry?.id !== id);
  if (value) entries.push(value);
  writeRetries(entries);
}

export function clearMobileQueueDraftReceipt(value) {
  if (!value?.gatewayId || !value.sessionId) return;
  const draftKey = JSON.stringify([value.gatewayId, value.sessionId]);
  const entries = readRetries();
  const retained = entries.filter(entry => entry?.key !== draftKey);
  if (retained.length !== entries.length) writeRetries(retained);
}

const pauseText = {
  stopped: 'Stopped. Resume when you’re ready.',
  turn_failed: 'The last turn failed. Resume when you’re ready.',
  delivery_uncertain: 'Delivery could not be confirmed. Review your chat history before removing the held message.',
  model_unavailable: 'The selected model is unavailable. Fix the model connection before resuming.',
  attachment_unavailable: 'An uploaded file is unavailable. Delete that item and attach the file again.',
  device_unavailable: 'The sending phone is no longer paired. Delete the held item to continue.',
  chat_unavailable: 'This chat is no longer available.',
  not_started: 'The last message could not start.',
  recovery_pending: 'The gateway restarted during a turn. Review the chat before resuming.',
  storage_unavailable: 'The gateway could not update the queue. Keep your draft and reconnect after the gateway is fixed.',
};

export function createMobileDurableQueue({ panel, target, pinFetch, report, escape, runtimeId, upload }) {
  let key = '';
  let state = null;
  let generation = 0;
  let disposed = false;
  let pending = null;
  let actionPending = false;
  let rendered = '';

  const current = () => {
    const value = target();
    return value?.gatewayId && value.sessionId ? { ...value, key: JSON.stringify([value.gatewayId, value.sessionId]) } : null;
  };
  function render() {
    const signature = JSON.stringify([key, state, actionPending]);
    if (!panel || signature === rendered) return;
    const openId = panel.dataset.queueKey === key && panel.querySelector('[data-queue-menu][aria-expanded="true"]')?.dataset.itemId;
    panel.dataset.queueKey = key;
    rendered = signature;
    const items = state?.items || [];
    panel.hidden = !items.length;
    if (panel.parentElement?.id === 'pm-mobile-queue-stack') panel.parentElement.hidden = panel.hidden && panel.parentElement.querySelector('#pm-mobile-queued-prompts')?.hidden !== false;
    panel.innerHTML = !items.length ? '' : `<div class="pm-mobile-queued-list">
      ${state.paused ? `<div class="pm-mobile-queued-item"><span role="status">${escape(pauseText[state.paused] || 'Queue paused.')}</span>
        ${state.paused === 'storage_unavailable' || items.some(item => item.state === 'uncertain') ? '' : `<button type="button" data-queue-action="resume" ${actionPending ? 'disabled' : ''}>Resume</button>`}</div>` : ''}
      ${items.map((item, index) => `<div class="pm-mobile-queued-item">
        ${item.state === 'pending' ? `<button type="button" class="pm-mobile-queued-text" data-queue-action="edit" data-index="${index}" title="Edit queued prompt" ${actionPending ? 'disabled' : ''}>` : '<span class="pm-mobile-queued-text">'}${escape(String(item.message || '').slice(0, 140))}${item.attachmentCount ? ` <em>+${Number(item.attachmentCount)}</em>` : ''}${item.state === 'pending' ? '</button>' : '</span>'}
        <div class="pm-mobile-queued-actions">${item.state === 'claimed' ? '<span>Starting</span>' : `
          ${item.state === 'pending' ? '' : '<span>Held</span>'}<div class="pm-mobile-queued-menu-wrap">
          <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-queue-menu data-item-id="${escape(item.id)}" aria-label="Queued prompt actions" aria-expanded="${openId === item.id}" ${actionPending ? 'disabled' : ''}>&#8943;</button>
          <div class="pm-mobile-queued-popover" ${openId === item.id ? '' : 'hidden'}>
          ${item.state === 'pending' ? `<button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-queue-action="steer" data-index="${index}" ${actionPending || state.paused ? 'disabled' : ''}>Steer</button>` : ''}
          <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-queue-action="cancel" data-index="${index}" ${actionPending ? 'disabled' : ''}>Delete</button></div></div>`}
        </div></div>`).join('')}
      </div>`;
  }
  function adopt(value, next) {
    if (!disposed && current()?.key === value.key && Array.isArray(next?.items)) {
      key = value.key;
      state = next;
      render();
    }
  }
  async function refresh() {
    const value = current();
    if (key !== value?.key) { key = value?.key || ''; state = null; render(); }
    if (disposed || !value || actionPending) return;
    const seq = ++generation;
    try {
      const next = await pinFetch(value.gatewayId)(`${ROUTE}?sessionId=${encodeURIComponent(value.sessionId)}`);
      if (seq === generation) adopt(value, next);
    } catch (error) {
      if (seq === generation && (error?.status === 401 || error?.status === 403 || error?.status === 404) && current()?.key === value.key) {
        state = null;
        render();
      }
    }
  }
  function invalidateDraft(value = current()) {
    if (!value?.gatewayId || !value.sessionId) return;
    const draftKey = JSON.stringify([value.gatewayId, value.sessionId]);
    if (pending?.key === draftKey) pending.invalidated = true;
    clearMobileQueueDraftReceipt(value);
  }
  const matchesRetry = async (value, message, files, skills) => {
    const targetKey = JSON.stringify([value.gatewayId, value.sessionId]);
    const candidates = readRetries().filter(entry => entry?.key === targetKey);
    if (!candidates.length) return false;
    const fingerprint = await draftFingerprint(message, files, skills);
    return candidates.some(entry => entry.fingerprint === fingerprint);
  };
  async function enqueue(value, message, files, skills = {}, guard = null) {
    const queueKey = JSON.stringify([value.gatewayId, value.sessionId]);
    const fetch = pinFetch(value.gatewayId);
    // Retry the exact prepared payload, including upload paths, if the POST
    // response went missing. This is a receipt retry, not a client outbox.
    const previous = pending;
    const skillKey = JSON.stringify(skills);
    const same = !previous?.invalidated && previous?.key === queueKey && previous.message === message && previous.skillKey === skillKey
      && previous.files.length === files.length && previous.files.every((file, i) => file === files[i]);
    if (previous?.inFlight) throw new Error('Waiting for the gateway to confirm the last queued message.');
    const attempt = same ? previous : { key: queueKey, message, files: [...files], skillKey, id: '', payload: null };
    pending = attempt;
    attempt.inFlight = true;
    try {
      const fingerprint = await draftFingerprint(message, files, skills);
      const retry = readRetries().find(entry => entry?.key === queueKey && entry.fingerprint === fingerprint);
      if (!attempt.id) attempt.id = retry?.id || `mq_${crypto.randomUUID()}`;
      const queuePath = `${ROUTE}?sessionId=${encodeURIComponent(value.sessionId)}`;
      if (retry?.id === attempt.id) {
        const saved = await fetch(`${queuePath}&receiptId=${encodeURIComponent(attempt.id)}`);
        if (saved?.id === attempt.id && Array.isArray(saved.items)) {
          if (attempt.invalidated || (guard && !guard())) throw new Error('This message was queued in the original chat. Your new draft was not changed.');
          pending = null;
          saveRetry(null, attempt.id);
          ++generation;
          adopt({ ...value, key: queueKey }, saved);
          return saved;
        }
      }
      if (!attempt.payload) {
        // Capability check before copying attachments to a gateway that cannot queue them.
        const capability = await fetch(queuePath);
        if (!Array.isArray(capability?.items)) throw new Error('This gateway does not support durable queues.');
        const results = files.length ? await upload(files, fetch) : [];
        if (results.length !== files.length || results.some(item => item.error || !item.relPath)) {
          throw new Error('An attachment did not upload. Your message was not queued.');
        }
        attempt.payload = { id: attempt.id, sessionId: value.sessionId, message: message || 'Attached file(s)', ...skills,
          attachments: results.map((item, i) => ({ name: item.name, path: item.relPath, mimeType: item.mimeType || files[i]?.mimeType || '', kind: files[i]?.kind || '' })),
        };
      }
      if (attempt.invalidated || (guard && !guard())) throw new Error('The draft changed or you left this chat. Nothing new was queued.');
      // Keep only an opaque lookup ID and draft fingerprint across reloads, never payload or media.
      saveRetry({ key: queueKey, id: attempt.id, fingerprint }, attempt.id);
      const receipt = await fetch(ROUTE, { method: 'POST', body: JSON.stringify(attempt.payload) });
      if (receipt?.id !== attempt.id || !Array.isArray(receipt.items)) throw new Error('The gateway did not confirm this message. Retry the same draft.');
      pending = null;
      ++generation;
      adopt({ ...value, key: queueKey }, receipt);
      if (attempt.invalidated || (guard && !guard())) throw new Error('This message was queued in the original chat. Your new draft was not changed.');
      saveRetry(null, attempt.id);
      return receipt;
    } catch (error) {
      if (error?.status === 404 || error?.status === 405) throw new Error('This chat or gateway does not support durable queues. Your draft was not queued.');
      throw error;
    } finally { attempt.inFlight = false; }
  }
  async function act(action, id, message) {
    const value = current();
    if (disposed || !value || actionPending || key !== value.key) return false;
    actionPending = true;
    ++generation;
    render();
    try {
      const body = { action, id, message, sessionId: value.sessionId, expectedRuntimeId: runtimeId() || '' };
      const next = await pinFetch(value.gatewayId)(`${ROUTE}/action`, { method: 'POST', body: JSON.stringify(body) });
      adopt(value, next);
      return true;
    } catch (err) {
      report(err?.message || 'Could not update the queue.', 'warn');
      return false;
    } finally { actionPending = false; render(); void refresh(); }
  }
  const listeners = new AbortController();
  function closeMenu(restoreFocus = false) {
    const trigger = panel?.querySelector('[data-queue-menu][aria-expanded="true"]');
    if (!trigger) return;
    trigger.nextElementSibling.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }
  panel?.ownerDocument.addEventListener('pointerdown', event => {
    if (!panel.contains(event.target.closest('.pm-mobile-queued-menu-wrap'))) closeMenu();
  }, {signal:listeners.signal});
  panel?.ownerDocument.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(true); }, {signal:listeners.signal});
  panel?.addEventListener('click', event => {
    const trigger = event.target.closest('[data-queue-menu]');
    if (trigger) {
      const open = trigger.nextElementSibling.hidden;
      closeMenu();
      trigger.nextElementSibling.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      return;
    }
    closeMenu();
    const button = event.target.closest('[data-queue-action]');
    if (!button || actionPending) return;
    const action = button.dataset.queueAction;
    const row = state?.items?.[Number(button.dataset.index)];
    if (action === 'resume') { void act(action); return; }
    if (!row) return;
    const message = action === 'edit' ? window.prompt('Edit queued prompt', row.message) : undefined;
    if (message === null) return;
    void act(action, row.id, message);
  }, {signal:listeners.signal});
  return { enqueue, refresh, act, matchesRetry, invalidateDraft, dispose() { listeners.abort(); disposed = true; ++generation; } };
}
