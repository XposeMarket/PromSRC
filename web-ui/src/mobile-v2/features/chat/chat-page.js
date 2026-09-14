import { ICONS } from '../../ui/icons.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderText(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function messageMarkup(message) {
  const user = message.role === 'user';
  const reasoning = !user && message.reasoning
    ? `<details class="pm-v2-reasoning" open><summary>Reasoning</summary><div>${renderText(message.reasoning)}</div></details>`
    : '';
  const tools = !user && message.tools?.length
    ? `<div class="pm-v2-tools">${message.tools.map((tool) => `<div class="pm-v2-tool"><span>${escapeHtml(tool.name || 'Tool')}</span><small>${escapeHtml(tool.message || (tool.phase === 'tool_result' ? 'Done' : 'Working…'))}</small></div>`).join('')}</div>`
    : '';
  const status = message.status === 'streaming' && !message.text ? '<span class="pm-v2-typing">Thinking…</span>' : '';
  const error = message.status === 'error' ? '<div class="pm-v2-message-error">Response interrupted</div>' : '';
  return `<div class="pm-msg ${user ? 'from-user' : 'from-ai'}" data-message-id="${escapeHtml(message.id)}">
    <div class="pm-bubble"><div class="markdown-body">${message.text ? renderText(message.text) : status}</div>${reasoning}${tools}${error}</div>
  </div>`;
}

function scrollToBottom(thread, behavior = 'auto') {
  requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior }));
}

export async function mountChatPage({ shell, gateway, chatStore, sessionId }) {
  const id = String(sessionId || 'mobile_default');
  const gatewayId = gateway.id;
  let streamController = null;
  let destroyed = false;
  let firstRender = true;

  shell.setActiveTab('chat');
  shell.setTitle('Prometheus');
  try { localStorage.setItem('pm_mobile_v2_active_session', id); } catch {}

  shell.page.innerHTML = `
    <section class="pm-v2-chat-screen">
      <div class="pm-chat-body pm-chat-thread pm-v2-chat-thread" id="pm-v2-chat-thread">
        <div class="pm-v2-chat-loading">Loading chat…</div>
      </div>
      <div class="pm-composer pm-v2-composer" id="pm-v2-composer">
        <div class="pm-composer-row">
          <button class="pm-icon-btn pm-v2-attach" type="button" aria-label="Attach" disabled>${ICONS.plus}</button>
          <div class="pm-v2-input-wrap"><textarea id="pm-v2-input" rows="1" placeholder="Message Prometheus" aria-label="Message Prometheus"></textarea></div>
          <button class="pm-icon-btn pm-v2-mic" type="button" aria-label="Voice" disabled>${ICONS.mic}</button>
          <button class="pm-send pm-v2-send" type="button" aria-label="Send">${ICONS.send}</button>
        </div>
      </div>
    </section>`;

  const thread = shell.page.querySelector('#pm-v2-chat-thread');
  const composer = shell.page.querySelector('#pm-v2-composer');
  const input = shell.page.querySelector('#pm-v2-input');
  const send = shell.page.querySelector('.pm-v2-send');

  function render(state) {
    if (destroyed) return;
    const stick = firstRender || (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120);
    thread.innerHTML = state.messages.length
      ? state.messages.map(messageMarkup).join('')
      : '<div class="pm-v2-chat-empty"><strong>Prometheus</strong><span>What can I help you with?</span></div>';
    if (state.hasOlder) {
      thread.insertAdjacentHTML('afterbegin', '<button class="pm-v2-load-older" type="button">Load earlier messages</button>');
    }
    if (state.error) thread.insertAdjacentHTML('beforeend', `<div class="pm-v2-stream-error">${escapeHtml(state.error)}</div>`);
    composer.classList.toggle('is-streaming', state.streaming);
    send.classList.toggle('is-abort', state.streaming);
    if (stick) scrollToBottom(thread);
    firstRender = false;
  }

  const unsubscribe = chatStore.subscribe(gatewayId, id, render);

  async function load() {
    chatStore.setLoading(gatewayId, id, true);
    try {
      const payload = await gateway.getSession(id);
      chatStore.hydrate(gatewayId, id, payload);
    } catch (error) {
      if (Number(error?.status) === 404 && id === 'mobile_default') {
        await gateway.createSession({ id, title: 'New Chat' });
        const payload = await gateway.getSession(id);
        chatStore.hydrate(gatewayId, id, payload);
      } else {
        chatStore.mutate(gatewayId, id, (state) => {
          state.loading = false;
          state.error = String(error?.message || error || 'Could not load this chat.');
        });
      }
    }
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
    if (!text) return;
    input.value = '';
    composer.classList.remove('has-text', 'is-focused');
    const requestId = `mobile_v2_${crypto.randomUUID?.() || `${Date.now()}_${Math.random()}`}`;
    const assistantId = `${requestId}:assistant`;
    chatStore.appendUser(gatewayId, id, { id: requestId, text });
    chatStore.beginAssistant(gatewayId, id, assistantId);
    streamController = new AbortController();
    try {
      await gateway.streamChat({
        sessionId: id,
        message: text,
        clientRequestId: requestId,
        signal: streamController.signal,
        onEvent: (event) => chatStore.applyStreamEvent(gatewayId, id, assistantId, event),
      });
      const state = chatStore.get(gatewayId, id);
      const row = state.messages.find((message) => message.id === assistantId);
      if (row?.status === 'streaming') {
        chatStore.applyStreamEvent(gatewayId, id, assistantId, { type: 'assistant.done' });
      }
      shell.refreshSessions().catch(() => {});
    } catch (error) {
      if (error?.name === 'AbortError') {
        chatStore.applyStreamEvent(gatewayId, id, assistantId, { type: 'assistant.error', message: 'Stopped' });
      } else chatStore.failStream(gatewayId, id, assistantId, error);
    } finally {
      streamController = null;
    }
  }

  thread.addEventListener('click', (event) => {
    if (event.target.closest('.pm-v2-load-older')) loadOlder();
  });
  send.addEventListener('click', submit);
  input.addEventListener('input', () => {
    composer.classList.toggle('has-text', !!input.value.trim());
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, Math.max(44, window.innerHeight * 0.42))}px`;
  });
  input.addEventListener('focus', () => composer.classList.add('is-focused'));
  input.addEventListener('blur', () => { if (!input.value.trim()) composer.classList.remove('is-focused'); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  await load();

  return () => {
    destroyed = true;
    streamController?.abort();
    unsubscribe();
  };
}
