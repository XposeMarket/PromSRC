// Row-local progress: never schedule a transcript render from the clock.
export function pendingStatusLabel(elapsedMs, queued, finished = false) {
  if (finished || elapsedMs < 4000) return '';
  return queued ? 'Waiting for a model slot' : `Thinking · ${Math.floor(elapsedMs / 1000)}s`;
}
export function updatePendingStatus(state, event) {
  const type = String(event?.type || '');
  if (['queued', 'queue', 'status', 'latency'].includes(type)) {
    const phase = String(event.phase || event.status || event.state || type).toLowerCase();
    if (['queued', 'queue', 'waiting_for_slot', 'waiting_for_model_slot'].includes(phase)) state.queued = true;
    else if (['running', 'started', 'model_started', 'slot_acquired'].includes(phase)) state.queued = false;
  }
  if (['final', 'done', 'error', 'tool_start', 'tool_call', 'tool_call_start'].includes(type)
    || (['token', 'assistant_delta', 'reasoning_summary', 'reasoning_summary_delta'].includes(type)
      && String(event.text || event.token || event.delta || event.summary || '').trim())) state.finished = true;
  return state;
}
export function startPendingStatusTimer(elapsed, queued, render, clock = globalThis) {
  const tick = () => render(pendingStatusLabel(elapsed(), queued()));
  tick();
  const timer = clock.setInterval(tick, 1000);
  let stopped = false;
  return () => { if (!stopped) { stopped = true; clock.clearInterval(timer); } };
}
let nextPendingId = 0;
function pendingState(message) {
  const state = message._pmPendingStatus ||= { startedAt: Date.now(), queued: false, finished: false };
  // Cached messages can be restored after a module reload; renew their local ID.
  if (!state._live) Object.defineProperties(state, { id: {value: ++nextPendingId, configurable:true}, _live: {value:true} });
  return state;
}
export function noteMobilePendingEvent(message, event) {
  const state = updatePendingStatus(pendingState(message), event);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pm-pending-status', { detail: { state } }));
}
export function pendingStatusMarkup(message) {
  const state = pendingState(message);
  if (state.finished) return '';
  // No registry retains old chats; the element owns its clock and listener.
  return `<pm-pending-status data-pending-id="${state.id}" data-start="${state.startedAt}" data-queued="${state.queued ? '1' : '0'}"></pm-pending-status>`;
}
if (typeof customElements !== 'undefined' && !customElements.get('pm-pending-status')) {
  customElements.define('pm-pending-status', class extends HTMLElement {
    connectedCallback() {
      this.stop?.();
      this.startedAt = Number(this.dataset.start);
      this.queued = this.dataset.queued === '1';
      this.setAttribute('role', 'status');
      const render = (label) => { this.textContent = label; this.hidden = !label; };
      this.stop = startPendingStatusTimer(() => Date.now() - this.startedAt, () => this.queued, render);
      this.onStatus = ({detail}) => {
        const state = detail?.state;
        if (state?.id !== Number(this.dataset.pendingId)) return;
        this.queued = state.queued;
        render(pendingStatusLabel(Date.now() - this.startedAt, this.queued, state.finished));
        if (state.finished) this.stop();
      };
      window.addEventListener('pm-pending-status', this.onStatus);
    }
    disconnectedCallback() {
      this.stop?.();
      window.removeEventListener('pm-pending-status', this.onStatus);
    }
  });
}
