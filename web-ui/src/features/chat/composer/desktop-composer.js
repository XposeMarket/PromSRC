import { escHtml, showToast } from '../../../utils.js';

/** Desktop composer rendering/dictation staged verbatim for dependency review. */

export function renderUnifiedDesktopComposerHtml(options = {}) {
  const inputId = String(options.inputId || 'unified-chat-input').trim();
  const fileInputId = String(options.fileInputId || `${inputId}-file-input`).trim();
  const stagingId = String(options.stagingId || '').trim();
  const sendButtonId = String(options.sendButtonId || `${inputId}-send-button`).trim();
  const placeholder = String(options.placeholder || 'Send a message').trim();
  const composerClass = String(options.composerClass || '').trim();
  const inputClass = String(options.inputClass || 'chat-textarea').trim();
  const inputAttributes = String(options.inputAttributes || '').trim();
  const inputStyle = String(options.inputStyle || '').trim();
  const inputWrapClass = String(options.inputWrapClass || '').trim();
  const inputWrapStyle = String(options.inputWrapStyle || '').trim();
  const extraTopMarkup = String(options.extraTopMarkup || '');
  const extraInputMarkup = String(options.extraInputMarkup || '');
  const footerExtraMarkup = String(options.footerExtraMarkup || '');
  const fileInputOnChange = String(options.fileInputOnChange || '').trim();
  const attachAction = String(options.attachAction || `document.getElementById('${fileInputId}')?.click()`).trim();
  const voiceAction = String(options.voiceAction || '').trim();
  const sendAction = String(options.sendAction || '').trim();
  const footerHint = String(options.footerHint || '').trim();
  const modelName = String(options.modelName || document.getElementById('chat-model-name')?.textContent || 'your model').trim();
  const queueBadgeId = String(options.queueBadgeId || '').trim();
  const queueCount = Math.max(0, Number(options.queueCount || 0) || 0);
  const busy = options.busy === true;
  const attachButton = `<button class="chat-attach-btn" type="button" onclick="${attachAction}" title="Attach file(s)" aria-label="Attach file(s)">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
  </button>`;
  const voiceButton = `<button class="chat-voice-btn" type="button"${voiceAction ? ` onclick="${voiceAction}"` : ''} title="Dictate message" aria-label="Dictate message">
    <svg class="voice-btn-icon voice-btn-icon-mic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>
  </button>`;
  const sendIcon = busy
    ? '<svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10" rx="1.5"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="22 2 15 22 11 13 2 9"/></svg>';
  const queueBadge = queueBadgeId
    ? `<span id="${escHtml(queueBadgeId)}" class="unified-chat-queue-badge" style="display:${queueCount ? 'inline-flex' : 'none'}">${queueCount} queued</span>`
    : '';
  return `<div class="chat-input-area unified-desktop-chat-composer ${escHtml(composerClass)}" data-unified-composer="1">
    ${extraTopMarkup}
    ${stagingId ? `<div class="chat-composer-attachment-stack"><div id="${escHtml(stagingId)}" class="chat-file-staging" style="display:none"></div></div>` : ''}
    <input id="${escHtml(fileInputId)}" type="file" multiple style="display:none"${fileInputOnChange ? ` onchange="${fileInputOnChange}"` : ''}>
    <div class="chat-input-row">
      ${attachButton}
      ${voiceButton}
      <div class="chat-composer-input-wrap ${escHtml(inputWrapClass)}"${inputWrapStyle ? ` style="${inputWrapStyle}"` : ''}>
        ${extraInputMarkup}
        <textarea id="${escHtml(inputId)}" class="${escHtml(inputClass)}" rows="1" placeholder="${escHtml(placeholder)}" autocomplete="off"${inputStyle ? ` style="${inputStyle}"` : ''}${inputAttributes ? ` ${inputAttributes}` : ''}></textarea>
      </div>
      <button id="${escHtml(sendButtonId)}" class="send-btn" type="button" onclick="${sendAction}" title="${busy ? 'Stop' : 'Send'}" aria-label="${busy ? 'Stop' : 'Send'}">${sendIcon}</button>
    </div>
    <div class="agent-toggle unified-desktop-chat-composer-footer" style="margin-bottom:0;margin-top:6px">
      <div class="chat-hint" style="margin:0;flex:1">${escHtml(footerHint)}${queueBadge}</div>
      ${footerExtraMarkup}
      <div class="chat-model-switcher-wrap">
        <button type="button" class="unified-chat-model-label" title="Chat model" aria-label="Chat model">
          <span>${escHtml(modelName)}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

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
