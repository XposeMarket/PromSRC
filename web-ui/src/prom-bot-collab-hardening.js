// Hardening layer for lightweight Prom Bot group rooms.
//
// Group rooms intentionally reuse the canonical standalone-agent stream, but
// they must not mutate the direct-DM read cursor or allow overlapping user
// turns to interleave one room transcript.
const DIRECT_SEEN_KEY = 'prometheus_prom_bot_seen_v1';

let groupSendPromise = null;

function setGroupComposerBusy(busy) {
  const input = document.getElementById('prom-bot-group-input');
  const send = document.getElementById('prom-bot-group-send');
  if (input) {
    input.disabled = !!busy;
    input.setAttribute('aria-busy', String(!!busy));
  }
  if (send) send.disabled = !!busy;
}

function snapshotDirectSeenCursor() {
  try { return localStorage.getItem(DIRECT_SEEN_KEY); }
  catch { return null; }
}

function restoreDirectSeenCursor(snapshot) {
  try {
    if (snapshot == null) localStorage.removeItem(DIRECT_SEEN_KEY);
    else localStorage.setItem(DIRECT_SEEN_KEY, snapshot);
  } catch {}
}

function installGroupSendGuard() {
  const nativeSend = window.sendPromBotGroupMessage;
  const nativeKeydown = window.handlePromBotGroupKeydown;
  if (typeof nativeSend !== 'function' || nativeSend.__promBotHardened === true) return false;

  const guardedSend = async function guardedPromBotGroupSend() {
    if (groupSendPromise) {
      window.showToast?.('Prom Bot group', 'This room is still responding. Finish the current turn before sending another message.', 'info');
      return groupSendPromise;
    }

    // The legacy collaboration layer advances the same local read cursor used
    // for direct DMs after room-generated traffic. Snapshot and restore it so a
    // real direct reply that lands during a Group run can never be swallowed.
    const directSeenBefore = snapshotDirectSeenCursor();
    setGroupComposerBusy(true);
    groupSendPromise = Promise.resolve()
      .then(() => nativeSend())
      .finally(async () => {
        restoreDirectSeenCursor(directSeenBefore);
        groupSendPromise = null;
        setGroupComposerBusy(false);
        try { await window.refreshPromBotRosterIntelligence?.({ force: true }); } catch {}
        document.getElementById('prom-bot-group-input')?.focus({ preventScroll: true });
      });
    return groupSendPromise;
  };
  guardedSend.__promBotHardened = true;
  window.sendPromBotGroupMessage = guardedSend;

  window.handlePromBotGroupKeydown = function hardenedPromBotGroupKeydown(event) {
    if (event?.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void guardedSend();
      return;
    }
    return typeof nativeKeydown === 'function' ? nativeKeydown(event) : undefined;
  };

  // The collaboration module's voice helper closes over its original send
  // function, so replace that entry point too; otherwise speech could bypass
  // the one-turn-at-a-time guard.
  window.startPromBotGroupVoice = function hardenedPromBotGroupVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      window.showToast?.('Voice unavailable', 'Speech recognition is unavailable in this browser.', 'warning');
      return;
    }
    if (groupSendPromise) {
      window.showToast?.('Prom Bot group', 'This room is still responding.', 'info');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results || []).map((result) => result?.[0]?.transcript || '').join(' ').trim();
      const input = document.getElementById('prom-bot-group-input');
      if (input) input.value = text;
    };
    recognition.onend = () => {
      if (String(document.getElementById('prom-bot-group-input')?.value || '').trim()) void guardedSend();
    };
    recognition.start();
  };
  return true;
}

function boot() {
  if (installGroupSendGuard()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (installGroupSendGuard() || attempts >= 20) clearInterval(timer);
  }, 250);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
