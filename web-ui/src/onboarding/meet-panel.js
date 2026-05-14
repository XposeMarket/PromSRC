// Meet-and-greet step: starts a special chat session that the backend recognizes
// (sessionId prefix `onboarding_`), switches the chat UI to it, and watches the
// transcript for the [ONBOARDING_COMPLETE] block Prom emits when done.
//
// Resolves with the parsed profile object, or null on skip.

const COMPLETE_RE = /\[ONBOARDING_COMPLETE\]\s*([\s\S]*?)\s*\[\/ONBOARDING_COMPLETE\]/;

export function showMeetPanel() {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'prom-onboarding-root';
    root.innerHTML = `
      <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Meet Prometheus">
        <div class="prom-onb-header">
          <div class="prom-onb-step">Step · Meet Prom</div>
          <button class="prom-onb-skip" data-skip>Skip — I'll introduce myself later</button>
        </div>
        <div class="prom-onb-body">
          <div class="prom-onb-illus">
            <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
              <defs><linearGradient id="meetg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#5b8def"/><stop offset="1" stop-color="#a36ce0"/>
              </linearGradient></defs>
              <circle cx="70" cy="70" r="32" fill="url(#meetg)"/>
              <circle cx="70" cy="64" r="4" fill="#fff"/>
              <circle cx="70" cy="64" r="1.5" fill="#1a2244"/>
              <path d="M 60 78 Q 70 86 80 78" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
              <circle cx="140" cy="70" r="22" fill="#dbe5ff" stroke="#0d4faf" stroke-width="2"/>
              <circle cx="134" cy="68" r="2.5" fill="#0d4faf"/>
              <circle cx="146" cy="68" r="2.5" fill="#0d4faf"/>
              <path d="M 132 76 Q 140 80 148 76" stroke="#0d4faf" stroke-width="2" fill="none" stroke-linecap="round"/>
              <line x1="102" y1="70" x2="118" y2="70" stroke="#a36ce0" stroke-width="3" stroke-dasharray="3,3"/>
            </svg>
          </div>
          <h2 class="prom-onb-title">Time to get to know each other</h2>
          <p class="prom-onb-caption">
            I'll take you to a fresh chat where we can talk for a minute. I'll ask
            a handful of questions about you and how you'd like me to work.
            Nothing gets saved until you confirm at the end — promise.
          </p>
        </div>
        <div class="prom-onb-footer">
          <div style="font-size:11px;color:var(--muted,#888)">~2 minutes</div>
          <div class="prom-onb-actions">
            <button class="prom-onb-btn primary" data-start>Let's go →</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const startBtn = root.querySelector('[data-start]');
    const skipBtn  = root.querySelector('[data-skip]');

    function dismiss() {
      root.style.transition = 'opacity 200ms ease-out';
      root.style.opacity = '0';
      setTimeout(() => root.remove(), 200);
    }

    skipBtn.addEventListener('click', async () => {
      try { await fetch('/api/onboarding/meet/complete', { method: 'POST' }); } catch {}
      dismiss();
      resolve(null);
    });

    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = 'Setting up…';
      let sessionId;
      try {
        const r = await fetch('/api/onboarding/meet/start', { method: 'POST' });
        if (!r.ok) throw new Error('meet/start failed: ' + r.status);
        const data = await r.json();
        sessionId = data.sessionId;
      } catch (e) {
        console.warn('[onboarding] could not start meet:', e);
        startBtn.disabled = false;
        startBtn.textContent = 'Try again';
        return;
      }
      dismiss();
      const profile = await driveMeetSession(sessionId);
      resolve(profile);
    });
  });
}

// Drives the actual chat session: registers the onboarding session into the
// chat UI, switches to it, kicks off the conversation, listens for widget
// answers and for the completion block, then resolves.
function driveMeetSession(sessionId) {
  return new Promise((resolve) => {
    // Register the session in the chat UI so it shows up in the sidebar.
    window.chatSessions = window.chatSessions || [];
    if (!window.chatSessions.find(s => s.id === sessionId)) {
      window.chatSessions.unshift({
        id: sessionId, title: 'Meet Prom', history: [], processLog: [],
        creativeMode: null, canvasProjectRoot: null, canvasProjectLabel: null,
        canvasProjectLink: null, creativeSceneDoc: null, creativeSelectedId: null,
        creativeTimelineMs: 0, creativeHistoryPast: [], creativeHistoryFuture: [],
        creativeHtmlMotionClip: null, creativeComposition: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
    window.activeChatSessionId = sessionId;
    if (typeof window.setAgentSessionId === 'function') window.setAgentSessionId(sessionId);
    if (typeof window.setMode === 'function') window.setMode('chat');
    if (typeof window.syncActiveChat === 'function') window.syncActiveChat();
    if (typeof window.renderSessionsList === 'function') window.renderSessionsList();

    // Bridge: html-interactive widgets dispatch `prom-onboarding-answer` on the
    // parent window. We turn each into a normal user chat message so the
    // existing pipeline records and renders it identically to typed input.
    const widgetHandler = (ev) => {
      const { slot, value } = ev?.detail || {};
      if (!value) return;
      const text = slot ? `[${slot}] ${value}` : String(value);
      sendUserMessage(text, sessionId);
    };
    window.addEventListener('prom-onboarding-answer', widgetHandler);

    // Watch the active session's history for the [ONBOARDING_COMPLETE] block.
    let resolved = false;
    const pollTimer = setInterval(() => {
      if (resolved) return;
      const sess = (window.chatSessions || []).find(s => s.id === sessionId);
      if (!sess?.history) return;
      // Only assistant turns can emit the marker.
      for (let i = sess.history.length - 1; i >= 0; i--) {
        const m = sess.history[i];
        const role = m.role || '';
        if (role !== 'ai' && role !== 'assistant') continue;
        const text = String(m.content || m.text || '');
        const match = text.match(COMPLETE_RE);
        if (match) {
          let profile = null;
          try { profile = JSON.parse(match[1].trim()); } catch (e) {
            console.warn('[onboarding] complete block JSON parse failed:', e);
          }
          finish(profile);
          return;
        }
      }
    }, 1500);

    function finish(profile) {
      if (resolved) return;
      resolved = true;
      clearInterval(pollTimer);
      window.removeEventListener('prom-onboarding-answer', widgetHandler);
      fetch('/api/onboarding/meet/complete', { method: 'POST' }).catch(() => {});
      resolve(profile);
    }

    // Kick off the conversation. A short trigger message gets Prom started; the
    // server-side onboarding system prompt does the rest.
    setTimeout(() => sendUserMessage('Hi!', sessionId), 350);
  });
}

// Fills the chat input and triggers send. Falls back to direct fetch if the
// chat UI isn't available for some reason.
function sendUserMessage(text, sessionId) {
  if (window.activeChatSessionId !== sessionId) {
    window.activeChatSessionId = sessionId;
    if (typeof window.syncActiveChat === 'function') window.syncActiveChat();
  }
  const input = document.getElementById('chat-input') || document.querySelector('textarea[data-chat-input]');
  if (input && typeof window.sendChat === 'function') {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    try { window.sendChat(); return; }
    catch (e) { console.warn('[onboarding] sendChat failed:', e); }
  }
  // Fallback: hit /api/chat directly. The transcript won't auto-render, but
  // the backend still processes it and the polling watcher will pick up the
  // completion block via the synced session history.
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, sessionId }),
  }).catch(e => console.warn('[onboarding] direct chat post failed:', e));
}
