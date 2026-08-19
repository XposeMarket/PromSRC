/** Desktop composer rendering/dictation extracted verbatim for dependency review. */

export function renderUnifiedDesktopComposerHtml(options = {}

export function toggleUnifiedDesktopComposerDictation(inputId, button = null) {
  const input = document.getElementById(String(inputId || '').trim());
  if (!input) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Speech unavailable', 'This browser does not expose speech dictation.', 'error');
    return;
  }
  const states = window.__promUnifiedDesktopDictationStates || (window.__promUnifiedDesktopDictationStates = {});
  const key = String(inputId || '').trim();
  const existing = states[key];
  if (existing?.recognition) {
    existing.active = false;
    try { existing.recognition.stop(); } catch {}
    delete states[key];
    button?.classList.remove('recording', 'active');
    return;
  }
  const recognition = new SpeechRecognition();
  const state = { recognition, active: true };
  states[key] = state;
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;
  button?.classList.add('recording', 'active');
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results || [])
      .map((result) => String(result?.[0]?.transcript || ''))
      .join(' ')
      .trim();
    if (!transcript || !state.active) return;
    const current = String(input.value || '').trimEnd();
    input.value = `${current}${current ? ' ' : ''}${transcript}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };
  recognition.onerror = (event) => {
    if (!state.active) return;
    const error = String(event?.error || 'unknown');
    if (!['no-speech', 'aborted'].includes(error)) showToast('Dictation error', error === 'not-allowed' ? 'Microphone permission was denied.' : 'Could not transcribe that recording.', 'error');
  };
  recognition.onend = () => {
    if (states[key] === state) delete states[key];
    button?.classList.remove('recording', 'active');
  };
  try {
    recognition.start();
  } catch (err) {
    delete states[key];
    button?.classList.remove('recording', 'active');
    showToast('Dictation unavailable', err?.message || 'Could not start dictation.', 'error');
  }
}
