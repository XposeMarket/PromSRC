import { renderMd } from '../../../utils.js';
import { ensureMobileV2Markdown } from '../../core/markdown.js';
import { ICONS } from '../../ui/icons.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function renderPlainText(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function renderAssistantText(text) {
  try { return renderMd(String(text || '')); }
  catch { return renderPlainText(text); }
}

function messageMarkup(message) {
  const user = message.role === 'user';
  const body = message.text ? (user ? renderPlainText(message.text) : renderAssistantText(message.text)) : '';
  const reasoning = !user && message.reasoning
    ? `<details class="pm-v2-reasoning"><summary>Reasoning</summary><div class="markdown-body">${renderAssistantText(message.reasoning)}</div></details>`
    : '';
  const tools = !user && message.tools?.length
    ? `<div class="pm-v2-tools">${message.tools.map((tool) => `<div class="pm-v2-tool"><span>${escapeHtml(tool.name || 'Tool')}</span><small>${escapeHtml(tool.message || (tool.phase === 'tool_result' ? 'Done' : 'Working…'))}</small></div>`).join('')}</div>`
    : '';
  const status = message.status === 'streaming' && !message.text ? '<span class="pm-v2-typing">Thinking…</span>' : '';
  const error = message.status === 'error' ? '<div class="pm-v2-message-error">Response interrupted</div>' : '';
  return `<div class="pm-msg ${user ? 'from-user' : 'from-ai'}" data-message-id="${escapeHtml(message.id)}"><div class="pm-bubble"><div class="markdown-body">${body || status}</div>${reasoning}${tools}${error}</div></div>`;
}

function scrollToBottom(thread, behavior = 'auto') {
  requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior }));
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

function historyFromPayload(payload) {
  const session = payload?.session || payload || {};
  return Array.isArray(session.history) ? session.history : (Array.isArray(payload?.history) ? payload.history : []);
}

export async function mountChatPage({ shell, gateway, gateways, chatStore, sessionId, sessionRef }) {
  const id = String(sessionId || 'mobile_default');
  const gatewayId = gateway.id;
  const ref = String(sessionRef || `${gatewayId}::${id}`);
  let streamController = null;
  let destroyed = false;
  let firstRender = true;
  let attachments = [];
  let reconcilePromise = null;

  shell.setActiveTab('chat');
  shell.setTitle('Prometheus');
  try { localStorage.setItem('pm_mobile_v2_active_session', ref); } catch {}
  gateways?.bindSession?.(id, gatewayId);

  shell.page.innerHTML = `<section class="pm-v2-chat-screen"><div class="pm-chat-body pm-chat-thread pm-v2-chat-thread" id="pm-v2-chat-thread"><div class="pm-v2-chat-loading">Loading chat…</div></div><div class="pm-v2-attachment-strip" data-v2-attachments hidden></div><div class="pm-composer pm-v2-composer" id="pm-v2-composer"><input type="file" multiple hidden data-v2-file-input/><div class="pm-composer-row"><button class="pm-icon-btn pm-v2-attach" type="button" aria-label="Attach">${ICONS.plus}</button><div class="pm-v2-input-wrap"><textarea id="pm-v2-input" rows="1" placeholder="Message Prometheus" aria-label="Message Prometheus"></textarea></div><button class="pm-icon-btn pm-v2-mic" type="button" aria-label="Voice">${ICONS.mic}</button><button class="pm-send pm-v2-send" type="button" aria-label="Send">${ICONS.send}</button></div></div></section>`;

  const thread = shell.page.querySelector('#pm-v2-chat-thread');
  const composer = shell.page.querySelector('#pm-v2-composer');
  const input = shell.page.querySelector('#pm-v2-input');
  const send = shell.page.querySelector('.pm-v2-send');
  const fileInput = shell.page.querySelector('[data-v2-file-input]');
  const attachmentStrip = shell.page.querySelector('[data-v2-attachments]');

  function paintAttachments() {
    attachmentStrip.hidden = !attachments.length;
    attachmentStrip.innerHTML = attachments.map((item, index) => `<span class="pm-attach-chip"><span>${escapeHtml(item.name)}</span><button type="button" data-remove-attachment="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></span>`).join('');
    composer.classList.toggle('has-attachments', attachments.length > 0);
  }

  function render(state) {
    if (destroyed) return;
    const stick = firstRender || (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120);
    thread.innerHTML = state.messages.length
      ? state.messages.map(messageMarkup).join('')
      : '<div class="pm-v2-chat-empty"><strong>Prometheus</strong><span>What can I help you with?</span></div>';
    if (state.hasOlder) thread.insertAdjacentHTML('afterbegin', '<button class="pm-v2-load-older" type="button">Load earlier messages</button>');
    if (state.error) thread.insertAdjacentHTML('beforeend', `<div class="pm-v2-stream-error">${escapeHtml(state.error)}</div>`);
    composer.classList.toggle('is-streaming', state.streaming);
    send.classList.toggle('is-abort', state.streaming);
    if (stick) scrollToBottom(thread);
    firstRender = false;
  }

  const unsubscribe = chatStore.subscribe(gatewayId, id, render);
  ensureMobileV2Markdown().then((ready) => {
    if (ready && !destroyed) render(chatStore.get(gatewayId, id));
  });

  async function load() {
    chatStore.setLoading(gatewayId, id, true);
    try {
      const payload = await gateway.getSession(id);
      chatStore.hydrate(gatewayId, id, payload);
    } catch (error) {
      if (Number(error?.status) === 404) {
        try {
          await gateway.createSession({ id, title: 'New Chat' });
          const payload = await gateway.getSession(id);
          chatStore.hydrate(gatewayId, id, payload);
        } catch (inner) {
          chatStore.mutate(gatewayId, id, (state) => { state.loading = false; state.error = String(inner?.message || inner); });
        }
      } else {
        chatStore.mutate(gatewayId, id, (state) => { state.loading = false; state.error = String(error?.message || error || 'Could not load this chat.'); });
      }
    }
  }

  async function reconcile({ announce = false } = {}) {
    if (destroyed || chatStore.get(gatewayId, id).streaming) return false;
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = (async () => {
      try {
        const payload = await gateway.getSession(id);
        if (destroyed) return false;
        const remoteHistory = historyFromPayload(payload);
        const local = chatStore.get(gatewayId, id).messages;
        if (remoteHistory.length || !local.length) {
          chatStore.hydrate(gatewayId, id, payload);
          if (announce) shell.showNotice('Chat reconnected and synced.');
          return true;
        }
      } catch {}
      return false;
    })().finally(() => { reconcilePromise = null; });
    return reconcilePromise;
  }

  async function loadOlder() {
    const state = chatStore.get(gatewayId, id);
    if (!state.hasOlder || !state.olderCursor) return;
    const beforeHeight = thread.scrollHeight;
    try {
      const page = await gateway.getHistoryPage(id, { limit: 80, before: state.olderCursor });
      chatStore.prependHistory(gatewayId, id, page);
      requestAnimationFrame(() => { thread.scrollTop += thread.scrollHeight - beforeHeight; });
    } catch (error) {
      shell.showNotice(error?.message || 'Could not load earlier messages.');
    }
  }

  async function submit() {
    const text = input.value.trim();
    const current = chatStore.get(gatewayId, id);
    if (current.streaming) {
      streamController?.abort();
      return;
    }
    if (!text && !attachments.length) return;
    input.value = '';
    composer.classList.remove('has-text', 'is-focused');
    const requestId = `mobile_v2_${crypto.randomUUID?.() || `${Date.now()}_${Math.random()}`}`;
    const assistantId = `${requestId}:assistant`;
    const sentAttachments = attachments.map((item) => ({ name: item.name, path: item.path, mimeType: item.mimeType, size: item.size }));
    attachments = [];
    paintAttachments();
    chatStore.appendUser(gatewayId, id, { id: requestId, text: text || `[Attached ${sentAttachments.length} file${sentAttachments.length === 1 ? '' : 's'}]` });
    chatStore.beginAssistant(gatewayId, id, assistantId);
    streamController = new AbortController();
    try {
      await gateway.streamChat({
        sessionId: id,
        message: text || 'Please inspect the attached file(s).',
        clientRequestId: requestId,
        attachments: sentAttachments,
        signal: streamController.signal,
        onEvent: (event) => chatStore.applyStreamEvent(gatewayId, id, assistantId, event),
      });
      const state = chatStore.get(gatewayId, id);
      const row = state.messages.find((message) => message.id === assistantId);
      if (row?.status === 'streaming') chatStore.applyStreamEvent(gatewayId, id, assistantId, { type: 'assistant.done' });
      shell.refreshSessions();
    } catch (error) {
      if (error?.name === 'AbortError') {
        chatStore.applyStreamEvent(gatewayId, id, assistantId, { type: 'assistant.error', message: 'Stopped' });
      } else {
        chatStore.failStream(gatewayId, id, assistantId, error);
        await reconcile({ announce: true });
      }
    } finally {
      streamController = null;
    }
  }

  async function addFiles(files) {
    for (const file of files) {
      try {
        shell.showNotice(`Uploading ${file.name}…`);
        const base64 = await fileBase64(file);
        const result = await gateway.uploadBinaryFile({ filename: file.name, base64, mimeType: file.type || 'application/octet-stream' });
        const path = result?.absPath || result?.path || result?.relPath || '';
        if (!path) throw new Error('Upload did not return a workspace path.');
        attachments.push({ name: file.name, path, mimeType: file.type || 'application/octet-stream', size: file.size });
        paintAttachments();
      } catch (error) {
        shell.showNotice(`${file.name}: ${error?.message || 'Upload failed.'}`);
      }
    }
    if (attachments.length) shell.showNotice(`${attachments.length} attachment${attachments.length === 1 ? '' : 's'} ready.`);
  }

  const onOnline = () => { reconcile({ announce: true }).catch(() => {}); };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') reconcile().catch(() => {});
  };

  thread.addEventListener('click', (event) => { if (event.target.closest('.pm-v2-load-older')) loadOlder(); });
  send.addEventListener('click', submit);
  shell.page.querySelector('.pm-v2-attach')?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  attachmentStrip.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-attachment]');
    if (!button) return;
    attachments.splice(Number(button.dataset.removeAttachment), 1);
    paintAttachments();
  });
  shell.page.querySelector('.pm-v2-mic')?.addEventListener('click', () => {
    try { localStorage.setItem('pm_mobile_v2_voice_session', id); } catch {}
    shell.navigate('voice');
  });
  input.addEventListener('input', () => {
    composer.classList.toggle('has-text', !!input.value.trim());
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, Math.max(44, window.innerHeight * .42))}px`;
  });
  input.addEventListener('focus', () => composer.classList.add('is-focused'));
  input.addEventListener('blur', () => { if (!input.value.trim()) composer.classList.remove('is-focused'); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibilityChange);

  await load();
  return () => {
    destroyed = true;
    streamController?.abort();
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    unsubscribe();
  };
}
