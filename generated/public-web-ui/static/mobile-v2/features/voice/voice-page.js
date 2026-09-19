import { mountThinkingOrbWhenReady } from '../../../features/chat/optional/thinking-orb-runtime.js';
import { ICONS } from '../../ui/icons.js';

const VOICE_SESSION_KEY = 'pm_mobile_v2_voice_session';
const VOICE_SETTINGS_KEY = 'pm_voice_settings_v1';
const OPENAI_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];

function readVoiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) || '{}');
    return {
      voiceMode: saved.voiceMode === 'xai' ? 'xai' : 'openai_realtime',
      listenMode: saved.listenMode === 'always_listening' ? 'always_listening' : 'push_to_speak',
      inputMode: ['automatic', 'browser', 'record_transcribe'].includes(saved.inputMode) ? saved.inputMode : 'automatic',
      dictation: saved.dictation === 'milestone' ? 'milestone' : 'quiet',
      realtimeVoice: String(saved.realtimeVoice || 'marin'),
      realtimeSpeed: Number(saved.realtimeSpeed || 1.05),
      serverVoice: String(saved.serverVoice || 'eve'),
      xaiSpeed: Number(saved.xaiSpeed || saved.realtimeSpeed || 1),
    };
  } catch {
    return { voiceMode: 'openai_realtime', listenMode: 'push_to_speak', inputMode: 'automatic', dictation: 'quiet', realtimeVoice: 'marin', realtimeSpeed: 1.05, serverVoice: 'eve', xaiSpeed: 1 };
  }
}

function saveVoiceSettings(settings) {
  try {
    const current = readVoiceSettings();
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
  } catch {}
}

function readVoiceSession() {
  try { return localStorage.getItem(VOICE_SESSION_KEY) || 'mobile_v2_voice'; } catch { return 'mobile_v2_voice'; }
}

function saveVoiceSession(id) {
  try { localStorage.setItem(VOICE_SESSION_KEY, id); } catch {}
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function newVoiceSessionId() {
  return `mobile_voice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function gatewayInitials(name) {
  const words = String(name || 'Gateway').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || 'GW').toUpperCase();
}

export async function mountVoicePage({ shell, features, gateways, route }) {
  shell.setActiveTab('voice');
  shell.setTitle('Voice');
  shell.renderHeader?.({ rightActions: `<button class="pm-icon-btn" type="button" data-action="new-voice" aria-label="New voice chat">${ICONS.compose}</button>` });

  const page = shell.page;
  const entries = gateways.list();
  let activeGatewayId = gateways.activeId;
  let sessionId = String(route?.id || readVoiceSession()).trim() || readVoiceSession();
  let disposed = false;
  let recognition = null;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let aborter = null;
  let listening = false;
  let transcript = '';
  let reply = '';
  let speakReplies = true;
  let voiceSettings = readVoiceSettings();
  let narrationMode = voiceSettings.dictation;
  let voiceProviderStatus = null;
  let selectedAgent = { kind: 'main', id: '', name: 'Main Agent' };
  let voiceAgents = [];
  let pendingApproval = null;
  let recognitionSilenceTimer = null;
  let alwaysListeningEnabled = false;
  let orbPressTimer = 0;
  let orbPressStarted = false;
  let currentAudio = null;
  let currentAudioResolve = null;
  let currentAudioUrl = '';
  let lastReply = '';
  let pendingAttachments = [];
  let cameraStream = null;
  let speechRun = 0;
  let speechQueue = Promise.resolve();
  let loadStatusGeneration = 0;
  let orbController = null;
  const recent = [];

  const targetOptions = entries.map((entry) => `
    <button type="button" class="pm-voice-target-character${entry.id === activeGatewayId ? ' active' : ''}" data-voice-target="${escapeHtml(entry.id)}" aria-label="${escapeHtml(entry.name)}" title="${escapeHtml(entry.name)}">
      <span class="pm-voice-target-avatar"><span aria-hidden="true">${escapeHtml(gatewayInitials(entry.name))}</span></span>
      <span>${escapeHtml(entry.name)}</span>
    </button>
  `).join('');

  page.innerHTML = `
    <div class="pm-body pm-voice-body pm-voice-body--page pm-v2-voice-screen" style="height:100%;min-height:0;box-sizing:border-box;padding:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;">
      <section class="pm-voice-snap-section pm-voice-snap-primary">
        <div class="pm-voice-stage">
          <div class="pm-voice-preview-host" aria-live="polite"></div>
          <div class="pm-voice-overlay-anchor" aria-hidden="true"></div>
          <div class="pm-voice-target-card" data-agent-target-menu hidden aria-label="Choose voice target">
            <div class="pm-voice-target-grid" data-agent-target-grid>
              <button type="button" class="pm-voice-target-character active" data-agent-target="main" aria-label="Main Agent" title="Main Agent">
                <span class="pm-voice-target-avatar pm-main-agent-avatar"><span aria-hidden="true">P</span></span>
              </button>
            </div>
          </div>
          <div class="pm-voice-approval" data-voice-approval hidden aria-live="polite" aria-label="Approval required">
            <div class="pm-va-header">
              <span class="pm-va-icon" aria-hidden="true">!</span>
              <div class="pm-va-heading"><strong class="pm-va-title">Allow this tool to run?</strong><code class="pm-va-tool" data-approval-tool></code></div>
            </div>
            <div class="pm-va-action" data-approval-action></div>
            <details class="pm-va-details" open>
              <summary>View details <span aria-hidden="true">⌃</span></summary>
              <div class="pm-va-detail-body">
                <div class="pm-va-detail" data-approval-detail></div>
                <details class="pm-va-section pm-va-collapsible" data-approval-technical>
                  <summary>Technical details</summary><pre class="pm-va-args" data-approval-args></pre>
                </details>
              </div>
            </details>
            <div class="pm-va-btns">
              <button type="button" class="pm-va-btn approve" data-approval-once>Allow once</button>
              <button type="button" class="pm-va-btn session" data-approval-session>Allow this session</button>
              <button type="button" class="pm-va-btn always" data-approval-always>Always allow</button>
              <button type="button" class="pm-va-btn reject" data-approval-deny>Deny</button>
            </div>
          </div>
          <div class="pm-voice-status-region" aria-live="polite">
            <div class="pm-voice-status pm-voice-live-text" data-voice-status>Ready</div>
            <div class="pm-voice-hint" data-voice-hint>Tap and hold the orb to speak</div>
          </div>
          <div class="pm-voice-orb-dock">
            <button type="button" class="pm-voice-orb pm-voice-mic pm-voice-page-mic pm-voice-orb-mic pm-voice-particle-orb" data-voice-orb aria-label="Hold to talk">
              <span class="pm-thinking-orb-host" aria-hidden="true"></span>
            </button>
            <button type="button" class="pm-voice-snap-arrow pm-voice-snap-arrow-down" data-voice-snap-down aria-label="Swipe down to voice controls">
              <span aria-hidden="true">&#8595;</span>
              <small>Swipe down</small>
            </button>
          </div>
        </div>
      </section>

      <section class="pm-voice-snap-section pm-voice-snap-secondary">
        <button type="button" class="pm-voice-snap-arrow pm-voice-snap-arrow-up" data-voice-snap-up aria-label="Return to main voice screen">
          <span aria-hidden="true">&#8593;</span>
          <small>Voice</small>
        </button>
        <div class="pm-voice-secondary-content pm-v2-voice-home-content">
          <div class="pm-v2-voice-provider-banner" data-voice-provider-banner aria-live="polite" style="margin-top:14px;font-size:12px;color:var(--pm-muted);">Input: Automatic - Output: Device voice - Push to Speak</div>
          <button class="pm-v2-voice-session-target" data-voice-session-target type="button" aria-label="Current voice chat target">Target: <strong>Mobile - New Chat</strong></button>

          <div class="pm-voice-settings-panel" data-voice-settings-panel hidden style="display:none;margin-top:10px;width:min(100%,430px);box-sizing:border-box;text-align:left;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px;">
            <div class="pm-voice-settings-heading" style="font-size:12px;font-weight:850;color:var(--pm-text);margin:1px 0 8px;">Prometheus</div>
            <button type="button" class="pm-voice-session-target" data-agent-target-toggle aria-expanded="false" style="margin:0 0 10px;border:1px solid var(--pm-border);background:var(--pm-bg-soft);color:var(--pm-text-soft);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Voice target: <span data-agent-target-name>Main Agent</span></button>
            <div class="pm-v2-voice-quick-settings" aria-label="Voice input and output">
              <label>Input<select data-input-mode><option value="automatic">Automatic</option><option value="browser">Browser speech recognition</option><option value="record_transcribe">Record and transcribe</option></select></label>
              <label>Output<select data-voice-mode data-output-mode><option value="openai_realtime">OpenAI voice</option><option value="xai">xAI / Grok</option></select></label>
              <label>Listening<select data-listen-mode><option value="push_to_speak">Push to Speak</option><option value="always_listening">Always listening</option></select></label>
            </div>
            <div class="pm-v2-voice-provider-details" data-voice-provider-details aria-live="polite" style="margin-top:8px;color:var(--pm-muted);font-size:11px;line-height:1.4;"></div>
            <label class="pm-voice-settings-check" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--pm-text);"><input type="checkbox" data-speak-replies checked><span>Speak Prometheus replies</span></label>
            <div class="pm-v2-voice-settings-grid">
              <label>Gateway<select data-gateway-preference><option value="active">Current gateway</option></select></label>
              <label data-server-voice-label hidden>Response Voice<select data-server-voice></select></label>
              <label data-openai-voice-label>OpenAI Voice<select data-openai-voice></select></label>
              <label class="pm-v2-voice-speed" data-voice-speed-label>Speed <span data-voice-speed-value></span><input data-voice-speed type="range" min="0.75" max="1.3" step="0.05"></label>
            </div>
            <button type="button" class="pm-voice-session-target pm-v2-voice-gateway-target" data-voice-target-toggle aria-expanded="false" style="margin-top:8px;border:1px solid var(--pm-border);background:var(--pm-bg-soft);color:var(--pm-text-soft);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Gateway: <span data-voice-target-name></span></button>
            <div class="pm-voice-target-card" data-voice-target-menu aria-label="Choose a gateway" hidden>
              <div class="pm-voice-target-grid">${targetOptions || '<p>No gateways are available.</p>'}</div>
            </div>
            <div class="pm-v2-voice-media-actions">
              <button type="button" class="pm-btn ghost" data-voice-attach>${ICONS.paperclip} Attach files or photos</button>
              <button type="button" class="pm-btn ghost" data-voice-camera>${ICONS.camera} Take photo</button>
              <input type="file" data-voice-file-input accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.csv" multiple hidden />
            </div>
          </div>

          <form class="pm-voice-dictation-fallback" data-voice-dictation hidden style="display:none;margin-top:12px;width:min(100%,420px);">
            <textarea rows="3" data-voice-dictation-text autocapitalize="sentences" autocomplete="off" placeholder="Tap here, use the iPhone keyboard mic, then send" aria-label="Voice dictation" style="width:100%;box-sizing:border-box;border:1px solid var(--pm-border);border-radius:12px;background:var(--pm-surface-strong);color:var(--pm-text);padding:10px 12px;font:inherit;font-size:14px;resize:vertical;"></textarea>
            <div class="pm-voice-dictation-actions" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;">
              <span data-voice-capability-note style="font-size:11px;color:var(--pm-muted);line-height:1.35;text-align:left;">Use keyboard dictation to send a voice message.</span>
              <button class="pm-btn primary" type="submit" style="padding:7px 14px;font-size:12px;white-space:nowrap;">Send</button>
            </div>
          </form>

          <section class="pm-voice-controls" aria-label="Voice controls">
            ${sessionId.startsWith('voice_room_') ? `<button type="button" class="pm-voice-control-btn pm-voice-transcript-btn" data-voice-transcript aria-label="View Voice Room transcript">${ICONS.chat}<span>View transcript</span></button>` : ''}
            <button type="button" class="pm-voice-control-btn pm-voice-repeat-btn" data-voice-repeat aria-label="Repeat last response" title="Repeat last response" disabled>${ICONS.refresh}<span>Repeat last response</span></button>
            <button class="pm-voice-control-btn pm-voice-settings-icon" type="button" data-voice-settings-toggle aria-label="Voice settings" title="Voice settings">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.4 13.5 1.1.9-1.2 2.1-1.4-.5a7.8 7.8 0 0 1-1.5.9l-.2 1.5h-2.4l-.3-1.5a7.6 7.6 0 0 1-1.6-.7l-1.3.7-1.3-2 1-1.1a7.2 7.2 0 0 1 0-1.8l-1-1 1.2-2.1 1.4.5a7.8 7.8 0 0 1 1.5-.9l.2-1.5h2.4l.3 1.5a7.6 7.6 0 0 1 1.6.7l1.3-.7 1.3 2-1 1.1a7.2 7.2 0 0 1 0 1.8Z"/></svg>
            </button>
            <div class="pm-voice-mode-toggle" role="group" aria-label="Voice narration mode">
              <button type="button" data-narration-mode="quiet" aria-pressed="false">Quiet</button>
              <button type="button" data-narration-mode="milestone" aria-pressed="false">Milestone</button>
            </div>
          </section>

          <div data-voice-attachments hidden style="width:min(100%,430px);margin:0 auto 10px"></div>

          <section class="pm-recent" aria-label="Recent voice commands">
            <div class="pm-recent-head"><h3>Recent Commands &amp; Tasks</h3><a href="#" data-voice-clear>Clear</a></div>
            <div class="pm-recent-list" data-voice-recent><div class="pm-v2-voice-empty-recent">No commands yet. Hold the orb to start.</div></div>
          </section>
        </div>
      </section>
    </div>
    <div data-voice-camera-capture hidden style="position:fixed;inset:0;z-index:10020;background:#000;display:none;align-items:center;justify-content:center;flex-direction:column">
      <video data-voice-camera-video autoplay muted playsinline style="width:100%;height:100%;object-fit:cover"></video>
      <div style="position:absolute;bottom:max(24px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:18px">
        <button type="button" class="pm-btn ghost" data-voice-camera-close>Cancel</button>
        <button type="button" class="pm-btn primary" data-voice-camera-shutter aria-label="Capture photo">Capture</button>
      </div>
      <div data-voice-camera-status style="position:absolute;top:max(18px,env(safe-area-inset-top));color:white;text-shadow:0 1px 3px #000">Opening camera…</div>
    </div>
  `;

  const scroller = page.querySelector('.pm-v2-voice-screen');
  const stage = page.querySelector('.pm-voice-stage');
  const orb = page.querySelector('[data-voice-orb]');
  const status = page.querySelector('[data-voice-status]');
  const hint = page.querySelector('[data-voice-hint]');
  const targetButton = page.querySelector('[data-voice-target-toggle]');
  const targetName = page.querySelector('[data-voice-target-name]');
  const targetMenu = page.querySelector('[data-voice-target-menu]');
  const settingsPanel = page.querySelector('[data-voice-settings-panel]');
  const settingsToggle = page.querySelector('[data-voice-settings-toggle]');
  const providerBanner = page.querySelector('[data-voice-provider-banner]');
  const providerDetails = page.querySelector('[data-voice-provider-details]');
  const sessionTargetButton = page.querySelector('[data-voice-session-target]');
  const sessionTargetLabel = sessionTargetButton?.querySelector('strong');
  const agentTargetButton = page.querySelector('[data-agent-target-toggle]');
  const agentTargetName = page.querySelector('[data-agent-target-name]');
  const agentTargetMenu = page.querySelector('[data-agent-target-menu]');
  const agentTargetGrid = page.querySelector('[data-agent-target-grid]');
  const approvalCard = page.querySelector('[data-voice-approval]');
  const approvalTool = page.querySelector('[data-approval-tool]');
  const approvalAction = page.querySelector('[data-approval-action]');
  const approvalDetail = page.querySelector('[data-approval-detail]');
  const approvalTechnical = page.querySelector('[data-approval-technical]');
  const approvalArgs = page.querySelector('[data-approval-args]');
  const voiceModeSelect = page.querySelector('[data-voice-mode]');
  const inputModeSelect = page.querySelector('[data-input-mode]');
  const outputModeSelect = page.querySelector('[data-output-mode]');
  const listenModeSelect = page.querySelector('[data-listen-mode]');
  const serverVoiceLabel = page.querySelector('[data-server-voice-label]');
  const serverVoiceSelect = page.querySelector('[data-server-voice]');
  const openaiVoiceLabel = page.querySelector('[data-openai-voice-label]');
  const openaiVoiceSelect = page.querySelector('[data-openai-voice]');
  const speedInput = page.querySelector('[data-voice-speed]');
  const speedLabel = page.querySelector('[data-voice-speed-value]');
  const recentList = page.querySelector('[data-voice-recent]');
  const dictationForm = page.querySelector('[data-voice-dictation]');
  const dictationText = page.querySelector('[data-voice-dictation-text]');
  const repeatButton = page.querySelector('[data-voice-repeat]');
  const attachmentList = page.querySelector('[data-voice-attachments]');
  const fileInput = page.querySelector('[data-voice-file-input]');
  const cameraOverlay = page.querySelector('[data-voice-camera-capture]');
  const cameraVideo = page.querySelector('[data-voice-camera-video]');
  const cameraStatus = page.querySelector('[data-voice-camera-status]');
  if (route?.id && sessionTargetLabel) sessionTargetLabel.textContent = 'Mobile — Voice Chat';

  function paintNarrationMode() {
    page.querySelectorAll('[data-narration-mode]').forEach((button) => {
      const active = button.dataset.narrationMode === narrationMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.style.background = active ? 'var(--pm-voice-control-accent, var(--pm-orange))' : 'transparent';
      button.style.color = active ? '#fff' : 'var(--pm-muted)';
    });
  }

  function paintAttachments() {
    attachmentList.hidden = !pendingAttachments.length;
    attachmentList.innerHTML = pendingAttachments.map((item, index) => `<div class="pm-card" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin:4px 0"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.name)}</span><small>${escapeHtml(item.mimeType || 'file')}</small><button type="button" class="pm-icon-btn" data-remove-voice-attachment="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></div>`).join('');
    attachmentList.querySelectorAll('[data-remove-voice-attachment]').forEach((button) => button.addEventListener('click', () => {
      pendingAttachments.splice(Number(button.dataset.removeVoiceAttachment), 1);
      paintAttachments();
    }));
  }

  async function uploadVoiceFiles(files) {
    if (selectedAgent.kind !== 'main') {
      shell.showNotice('Attachments are currently available when Voice targets the Main Agent.');
      return;
    }
    const gateway = gateways.client(activeGatewayId);
    for (const file of Array.from(files || [])) {
      try {
        shell.showNotice(`Uploading ${file.name}…`);
        const base64 = await blobToBase64(file);
        const result = await gateway.uploadBinaryFile({ filename: file.name || 'voice-attachment', base64, mimeType: file.type || 'application/octet-stream' });
        const path = String(result?.absPath || result?.path || result?.relPath || '').trim();
        if (!path) throw new Error('Upload did not return a workspace path.');
        pendingAttachments.push({ name: file.name || 'Voice attachment', path, mimeType: file.type || 'application/octet-stream', size: file.size || 0 });
        paintAttachments();
      } catch (error) {
        shell.showNotice(`${file.name || 'Attachment'}: ${error?.message || 'Upload failed.'}`);
      }
    }
  }

  function closeCamera() {
    cameraStream?.getTracks?.().forEach((track) => track.stop());
    cameraStream = null;
    if (cameraVideo) cameraVideo.srcObject = null;
    if (cameraOverlay) { cameraOverlay.hidden = true; cameraOverlay.style.display = 'none'; }
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      shell.showNotice('Camera is unavailable in this browser. Attach a photo from your library instead.');
      return;
    }
    // Request camera permission only after the user taps Take photo.
    try {
      cameraOverlay.hidden = false;
      cameraOverlay.style.display = 'flex';
      cameraStatus.textContent = 'Opening camera…';
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (disposed) { closeCamera(); return; }
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
      cameraStatus.textContent = 'Center a photo, then capture.';
    } catch (error) {
      closeCamera();
      shell.showNotice(error?.message || 'Could not open the camera.');
    }
  }

  async function captureCameraPhoto() {
    const width = Number(cameraVideo?.videoWidth || 0);
    const height = Number(cameraVideo?.videoHeight || 0);
    if (!width || !height) { shell.showNotice('Camera is still starting.'); return; }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) { shell.showNotice('Could not capture a camera frame.'); return; }
    context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    closeCamera();
    if (!blob) { shell.showNotice('Could not capture a camera frame.'); return; }
    const file = new File([blob], `voice-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await uploadVoiceFiles([file]);
  }

  paintNarrationMode();
  page.querySelectorAll('[data-narration-mode]').forEach((button) => button.addEventListener('click', () => {
    narrationMode = button.dataset.narrationMode === 'milestone' ? 'milestone' : 'quiet';
    voiceSettings = { ...voiceSettings, dictation: narrationMode };
    saveVoiceSettings({ dictation: narrationMode });
    paintNarrationMode();
    shell.showNotice(`${narrationMode === 'quiet' ? 'Quiet' : 'Milestone'} narration enabled.`);
  }));
  page.querySelector('[data-voice-attach]')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => { void uploadVoiceFiles(fileInput.files); fileInput.value = ''; });
  page.querySelector('[data-voice-camera]')?.addEventListener('click', () => { void openCamera(); });
  page.querySelector('[data-voice-camera-close]')?.addEventListener('click', closeCamera);
  page.querySelector('[data-voice-camera-shutter]')?.addEventListener('click', () => { void captureCameraPhoto(); });
  page.querySelector('[data-voice-transcript]')?.addEventListener('click', () => shell.navigate?.(`chat/${encodeURIComponent(sessionId)}`));

  function activeEntry() {
    return gateways.get(activeGatewayId) || gateways.activeEntry;
  }

  function paintTarget() {
    const entry = activeEntry();
    targetName.textContent = entry?.name || 'This gateway';
    targetMenu?.querySelectorAll('[data-voice-target]').forEach((button) => {
      const active = button.dataset.voiceTarget === activeGatewayId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function paintAgentTarget() {
    const selectedId = selectedAgent.kind === 'subagent' ? selectedAgent.id : 'main';
    agentTargetName.textContent = selectedAgent.name || 'Main Agent';
    agentTargetGrid.innerHTML = `
      <button type="button" class="pm-voice-target-character${selectedId === 'main' ? ' active' : ''}" data-agent-target="main" aria-label="Main Agent" title="Main Agent">
        <span class="pm-voice-target-avatar pm-main-agent-avatar"><span aria-hidden="true">P</span></span>
      </button>
      ${voiceAgents.map((agent) => {
        const id = String(agent?.id || agent?.agentId || '').trim();
        if (!id) return '';
        const name = String(agent?.name || agent?.label || id);
        const initials = gatewayInitials(name);
        return `<button type="button" class="pm-voice-target-character${selectedId === id ? ' active' : ''}" data-agent-target="${escapeHtml(id)}" aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}"><span class="pm-voice-target-avatar"><span aria-hidden="true">${escapeHtml(initials)}</span></span></button>`;
      }).join('')}
    `;
  }

  function saveVoiceSetting(update) {
    voiceSettings = { ...voiceSettings, ...update };
    saveVoiceSettings(update);
    paintVoiceSettings();
    updateVoiceRoutingDetails();
  }

  function paintVoiceSettings() {
    const mode = voiceSettings.voiceMode === 'xai' ? 'xai' : 'openai_realtime';
    const inputMode = ['automatic', 'browser', 'record_transcribe'].includes(voiceSettings.inputMode) ? voiceSettings.inputMode : 'automatic';
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const canRecordAudio = !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
    const openAiReady = !!voiceProviderStatus?.voice?.ttsProviders?.some((provider) => provider?.id === 'openai' && provider?.configured);
    const xaiReady = !!voiceProviderStatus?.voice?.ttsProviders?.some((provider) => provider?.id === 'xai' && provider?.configured);
    voiceModeSelect.value = mode;
    const openaiOption = voiceModeSelect.querySelector('option[value="openai_realtime"]');
    const xaiOption = voiceModeSelect.querySelector('option[value="xai"]');
    if (openaiOption) openaiOption.textContent = `OpenAI voice${openAiReady ? '' : ' (not connected)'}`;
    if (xaiOption) xaiOption.textContent = `xAI / Grok${xaiReady ? '' : ' (not connected)'}`;
    if (outputModeSelect) {
      outputModeSelect.value = mode;
      const outputOpenAiOption = outputModeSelect.querySelector('option[value="openai_realtime"]');
      const outputXaiOption = outputModeSelect.querySelector('option[value="xai"]');
      if (outputOpenAiOption) outputOpenAiOption.textContent = `OpenAI voice${openAiReady ? '' : ' (not connected)'}`;
      if (outputXaiOption) outputXaiOption.textContent = `xAI / Grok${xaiReady ? '' : ' (not connected)'}`;
    }
    if (inputModeSelect) {
      inputModeSelect.value = inputMode;
      const browserOption = inputModeSelect.querySelector('option[value="browser"]');
      const recordOption = inputModeSelect.querySelector('option[value="record_transcribe"]');
      if (browserOption) browserOption.disabled = !Recognition;
      if (recordOption) recordOption.disabled = !canRecordAudio;
    }
    const alwaysListeningOption = listenModeSelect.querySelector('option[value="always_listening"]');
    if (alwaysListeningOption) alwaysListeningOption.disabled = inputMode === 'record_transcribe' || !Recognition;
    if (voiceSettings.listenMode === 'always_listening' && (inputMode === 'record_transcribe' || !Recognition)) {
      voiceSettings = { ...voiceSettings, listenMode: 'push_to_speak' };
      saveVoiceSettings({ listenMode: 'push_to_speak' });
    }
    listenModeSelect.value = voiceSettings.listenMode;
    openaiVoiceLabel.hidden = mode === 'xai';
    serverVoiceLabel.hidden = mode !== 'xai';
    const openaiVoices = OPENAI_VOICES;
    openaiVoiceSelect.innerHTML = openaiVoices.map((id) => `<option value="${id}">${id[0].toUpperCase()}${id.slice(1)}</option>`).join('');
    const selectedOpenaiVoice = openaiVoices.includes(voiceSettings.realtimeVoice) ? voiceSettings.realtimeVoice : 'marin';
    openaiVoiceSelect.value = selectedOpenaiVoice;
    const advertised = Array.isArray(voiceProviderStatus?.voice?.voiceCatalogs?.xai) ? voiceProviderStatus.voice.voiceCatalogs.xai : [];
    const xaiVoices = advertised.map((voice) => typeof voice === 'string'
      ? { id: voice, label: voice[0]?.toUpperCase() + voice.slice(1) }
      : { id: String(voice?.id || voice?.voice_id || '').trim(), label: String(voice?.label || voice?.name || voice?.id || voice?.voice_id || '') }).filter((voice) => voice.id);
    const serverVoices = xaiVoices.length ? xaiVoices : [{ id: 'eve', label: 'Eve' }, { id: 'ara', label: 'Ara' }, { id: 'rex', label: 'Rex' }, { id: 'sal', label: 'Sal' }];
    serverVoiceSelect.innerHTML = serverVoices.map((voice) => `<option value="${escapeHtml(voice.id)}">${escapeHtml(voice.label)}</option>`).join('');
    const selectedServerVoice = serverVoices.some((voice) => voice.id === voiceSettings.serverVoice) ? voiceSettings.serverVoice : serverVoices[0]?.id || '';
    serverVoiceSelect.value = selectedServerVoice;
    if (selectedOpenaiVoice !== voiceSettings.realtimeVoice || selectedServerVoice !== voiceSettings.serverVoice) {
      const update = { realtimeVoice: selectedOpenaiVoice, serverVoice: selectedServerVoice };
      voiceSettings = { ...voiceSettings, ...update };
      saveVoiceSettings(update);
    }
    const speed = mode === 'xai' ? Number(voiceSettings.xaiSpeed || 1) : Number(voiceSettings.realtimeSpeed || 1.05);
    speedInput.min = mode === 'xai' ? '0.7' : '0.75';
    speedInput.max = mode === 'xai' ? '1.5' : '1.3';
    speedInput.step = '0.05';
    speedInput.value = String(speed);
    speedLabel.textContent = `${Number(speedInput.value).toFixed(2)}x`;
  }

  function updateVoiceRoutingDetails() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const inputMode = ['automatic', 'browser', 'record_transcribe'].includes(voiceSettings.inputMode) ? voiceSettings.inputMode : 'automatic';
    const inputLabel = inputMode === 'browser'
      ? 'Browser speech recognition'
      : inputMode === 'record_transcribe'
        ? 'Record audio, then transcribe through the gateway'
        : Recognition
          ? 'Automatic: browser speech recognition; gateway transcription when browser recognition is unavailable'
          : 'Automatic: record audio and transcribe through the gateway';
    const outputMode = voiceSettings.voiceMode === 'xai' ? 'xai' : 'openai_realtime';
    const providerId = outputMode === 'xai' ? 'xai' : 'openai';
    const providerReady = !!voiceProviderStatus?.voice?.ttsProviders?.some((provider) => provider?.id === providerId && provider?.configured);
    const outputLabel = !speakReplies
      ? 'Reply audio is muted'
      : providerReady
        ? `${outputMode === 'xai' ? 'xAI / Grok' : 'OpenAI'} voice, with device speech available as fallback`
        : `Device speech fallback (${outputMode === 'xai' ? 'xAI / Grok' : 'OpenAI'} voice is not connected)`;
    if (providerDetails) providerDetails.textContent = `Input: ${inputLabel}. Output: ${outputLabel}.`;
    if (providerBanner) {
      const shortInput = inputMode === 'browser' || (inputMode === 'automatic' && Recognition) ? 'Browser' : inputMode === 'record_transcribe' ? 'Record and transcribe' : 'Automatic';
      const shortOutput = !speakReplies || !providerReady ? 'Device voice' : outputMode === 'xai' ? 'xAI / Grok' : 'OpenAI voice';
      const listenLabel = voiceSettings.listenMode === 'always_listening' ? 'Always listening' : 'Push to Speak';
      providerBanner.textContent = `Input: ${shortInput} - Output: ${shortOutput} - ${listenLabel}`;
    }
  }

  function setOrbState(state = 'thinking') {
    const visualState = state === 'listening' ? 'listening' : state === 'solving' ? 'solving' : 'thinking';
    orbController?.setState(visualState);
    orb.classList.remove('listening', 'thinking', 'speaking', 'confirmed');
    if (state && state !== 'idle') orb.classList.add(state === 'solving' ? 'thinking' : state);
    orb.classList.toggle('recording', state === 'listening');
  }

  function setStatus(label, subtext = '', state = 'thinking') {
    status.textContent = label;
    hint.textContent = subtext;
    stage.classList.add('pm-voice-status-visible');
    status.classList.toggle('pm-voice-live-text', state === 'listening' || state === 'solving');
    status.classList.toggle('pm-voice-agent-text', state === 'speaking');
    hint.classList.toggle('pm-voice-live-text', state === 'listening');
    hint.classList.toggle('pm-voice-agent-text', state === 'speaking');
    setOrbState(state);
  }

  function paintTranscript() {
    if (reply) {
      setStatus(reply, 'Prometheus', 'speaking');
    } else if (transcript) {
      setStatus(transcript, listening ? 'Listening' : 'Release to send', listening ? 'listening' : 'thinking');
    }
  }

  function paintRecent() {
    if (!recent.length) {
      recentList.innerHTML = '<div class="pm-v2-voice-empty-recent">No commands yet. Hold the orb to start.</div>';
      return;
    }
    recentList.innerHTML = recent.map((item) => `
      <div class="pm-recent-item">
        <span class="pm-icon" aria-hidden="true">${item.icon === 'tool' ? '⚙' : '●'}</span>
        <div class="pm-meta"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>
      </div>
    `).join('');
  }

  function addRecent(title, detail, icon = 'voice') {
    recent.unshift({ title, detail, icon });
    recent.splice(12);
    paintRecent();
  }

  function showTargetMenu(open) {
    const visible = !!open;
    targetMenu.hidden = !visible;
    targetMenu.classList.toggle('open', visible);
    targetButton.setAttribute('aria-expanded', String(visible));
  }

  function showSettings(open) {
    settingsPanel.hidden = !open;
    settingsPanel.style.display = open ? 'block' : 'none';
    settingsToggle.setAttribute('aria-expanded', String(open));
  }

  function enableDictation(note) {
    dictationForm.hidden = false;
    dictationForm.style.display = 'block';
    page.querySelector('[data-voice-capability-note]').textContent = note || 'Use keyboard dictation to send a voice message.';
  }

  function paintApproval(approval) {
    pendingApproval = approval || null;
    if (!pendingApproval) {
      approvalCard.hidden = true;
      approvalCard.classList.remove('pm-va-visible', 'pm-va-running', 'pm-va-failed');
      return;
    }
    const tool = String(approval.toolName || approval.tool || approval.name || approval.action || 'Requested action');
    const action = String(approval.summary || approval.description || approval.reason || approval.command || 'Prometheus needs your approval to continue.');
    const details = String(approval.reason || approval.message || approval.summary || 'Review the requested action before allowing it.');
    const args = approval.arguments ?? approval.input ?? approval.args ?? approval.details;
    approvalTool.textContent = tool;
    approvalAction.textContent = action;
    approvalDetail.textContent = details;
    approvalArgs.textContent = typeof args === 'string' ? args : args ? JSON.stringify(args, null, 2) : '';
    approvalTechnical.hidden = !args;
    const canSave = (approval.approvalKind === 'path_access' || approval.approvalKind === 'command'
      || ['run_command', 'shell', 'run_command_supervised', 'start_process'].includes(String(approval.toolName || '')))
      && approval.oneShot !== true && approval.approvalKind !== 'elevated_command';
    approvalCard.querySelector('[data-approval-session]').hidden = !canSave;
    approvalCard.querySelector('[data-approval-always]').hidden = !canSave;
    approvalCard.hidden = false;
    agentTargetMenu.hidden = true;
    agentTargetMenu.classList.remove('open');
    agentTargetButton.setAttribute('aria-expanded', 'false');
    approvalCard.classList.add('pm-va-visible');
    approvalCard.classList.remove('pm-va-running', 'pm-va-failed');
    setStatus('Approval needed', 'Review the requested tool action', 'thinking');
  }

  async function resolveApproval(decision, grantScope = '') {
    if (!pendingApproval) return;
    const approvalId = String(pendingApproval.id || pendingApproval.approvalId || pendingApproval.requestId || '').trim();
    if (!approvalId) {
      shell.showNotice('The approval request did not include an ID.');
      return;
    }
    const buttons = approvalCard.querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });
    approvalCard.classList.add('pm-va-running');
    try {
      const gateway = gateways.client(activeGatewayId);
      const action = decision === 'approved' ? 'approve' : 'deny';
      await gateway.request(`/api/approvals/${encodeURIComponent(approvalId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ grantScope, source: 'mobile_voice' }),
      });
      paintApproval(null);
      setStatus(decision === 'approved' ? 'Approved' : 'Denied', decision === 'approved' ? 'Prometheus is continuing' : 'Action denied', 'thinking');
      shell.showNotice(decision === 'approved' ? 'Approval sent.' : 'Request denied.');
    } catch (error) {
      approvalCard.classList.add('pm-va-failed');
      shell.showNotice(error?.message || 'Could not update the approval.');
      buttons.forEach((button) => { button.disabled = false; });
    } finally {
      approvalCard.classList.remove('pm-va-running');
    }
  }

  approvalCard.querySelector('[data-approval-once]')?.addEventListener('click', () => resolveApproval('approved'));
  approvalCard.querySelector('[data-approval-session]')?.addEventListener('click', () => resolveApproval('approved', 'session'));
  approvalCard.querySelector('[data-approval-always]')?.addEventListener('click', () => resolveApproval('approved', 'always'));
  approvalCard.querySelector('[data-approval-deny]')?.addEventListener('click', () => resolveApproval('rejected'));

  function stopSpeech() {
    speechRun += 1;
    window.speechSynthesis?.cancel?.();
    currentAudio?.pause?.();
    currentAudioResolve?.();
    currentAudioResolve = null;
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = '';
    currentAudio = null;
  }

  function queueSpeech(text) {
    const run = speechRun;
    speechQueue = speechQueue.catch(() => {}).then(() => {
      if (disposed || run !== speechRun) return;
      return speakReply(text);
    });
    return speechQueue;
  }

  async function speakReply(text) {
    const finalText = String(text || '').trim();
    if (!finalText) return;
    const run = speechRun;
    const gateway = gateways.client(activeGatewayId);
    const mode = voiceSettings.voiceMode === 'xai' ? 'xai' : 'openai_realtime';
    const provider = mode === 'xai' ? 'xai' : 'openai';
    const configured = mode === 'xai'
      ? !!voiceProviderStatus?.voice?.ttsProviders?.some((item) => item?.id === 'xai' && item?.configured)
      : !!voiceProviderStatus?.voice?.ttsProviders?.some((item) => item?.id === 'openai' && item?.configured);
    if (configured) {
      try {
        const payload = { provider, text: finalText };
        if (provider === 'xai') {
          payload.voiceId = voiceSettings.serverVoice || 'eve';
          payload.speed = Number(voiceSettings.xaiSpeed || 1);
        } else {
          payload.voice = voiceSettings.realtimeVoice || 'marin';
        }
        const result = await gateway.request('/api/voice/tts', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 120000 });
        if (disposed || run !== speechRun) return;
        const encoded = String(result?.audioBase64 || result?.audio || '').replace(/^data:[^,]*,/, '');
        if (encoded) {
          const binary = atob(encoded);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          currentAudioUrl = URL.createObjectURL(new Blob([bytes], { type: result?.mimeType || 'audio/mpeg' }));
          currentAudio = new Audio(currentAudioUrl);
          currentAudio.playbackRate = provider === 'xai' ? Number(voiceSettings.xaiSpeed || 1) : 1;
          const playedAudio = currentAudio;
          await currentAudio.play();
          await new Promise((resolve) => {
            const finish = () => {
              if (currentAudio === playedAudio) currentAudio = null;
              if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
              currentAudioUrl = '';
              currentAudioResolve = null;
              resolve();
            };
            currentAudioResolve = finish;
            if (playedAudio.ended) finish();
            else playedAudio.addEventListener('ended', finish, { once: true });
          });
          return;
        }
      } catch (error) {
        console.warn('[mobile v2 voice] provider speech failed, using device voice:', error);
        currentAudioResolve?.();
        currentAudioResolve = null;
        currentAudio?.pause?.();
        currentAudio = null;
        if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = '';
      }
    }
    if (disposed || run !== speechRun) return;
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(finalText);
    utterance.rate = Math.max(0.5, Math.min(2, mode === 'xai' ? Number(voiceSettings.xaiSpeed || 1) : Number(voiceSettings.realtimeSpeed || 1.05)));
    const desiredVoice = mode === 'xai' ? voiceSettings.serverVoice : voiceSettings.realtimeVoice;
    const systemVoice = window.speechSynthesis.getVoices?.().find((voice) => voice.name.toLowerCase().includes(String(desiredVoice || '').toLowerCase()));
    if (systemVoice) utterance.voice = systemVoice;
    utterance.onstart = () => setStatus(finalText, 'Prometheus is speaking', 'speaking');
    await new Promise((resolve) => {
      utterance.onend = () => { setStatus(finalText, 'Prometheus replied', 'thinking'); resolve(); };
      utterance.onerror = resolve;
      window.speechSynthesis.speak(utterance);
    });
  }

  paintTarget();
  paintAgentTarget();
  paintVoiceSettings();
  setStatus('Ready', 'Tap and hold the orb to speak', 'thinking');
  paintRecent();

  void mountThinkingOrbWhenReady(page.querySelector('.pm-thinking-orb-host'), {
    state: 'thinking', size: 64, theme: 'auto', speed: 0.5,
  }).then((controller) => {
    if (disposed) { controller?.destroy?.(); return; }
    orbController = controller;
  }).catch((error) => console.warn('[mobile v2 voice] orb failed to mount:', error));

  async function refreshVoiceStatus() {
    const generation = ++loadStatusGeneration;
    const gateway = gateways.client(activeGatewayId);
    try {
      const [realtime, xaiRealtime, credentials, agents] = await Promise.all([
        gateway.request('/api/realtime/status').catch(() => null),
        gateway.request('/api/realtime/xai/status').catch(() => null),
        gateway.request('/api/settings/credentialed-model-providers').catch(() => null),
        gateway.request('/api/agents').catch(() => null),
      ]);
      if (disposed || generation !== loadStatusGeneration) return;
      const configuredProviders = Array.isArray(credentials?.providers) ? credentials.providers : Array.isArray(credentials?.ids) ? credentials.ids : [];
      const credentialReady = (id) => configuredProviders.some((provider) => {
        const providerId = typeof provider === 'string' ? provider : provider?.id || provider?.provider;
        return String(providerId || '').toLowerCase() === id && provider?.configured !== false;
      });
      const xaiConfigured = !!(xaiRealtime?.configured || configuredProviders.some((provider) => {
        const id = typeof provider === 'string' ? provider : provider?.id || provider?.provider;
        return String(id || '').toLowerCase() === 'xai' && provider?.configured !== false;
      }));
      const openAiConfigured = !!(realtime?.configured && (realtime?.oauthConfigured || realtime?.apiKeyConfigured));
      voiceProviderStatus = {
        realtime: realtime || { configured: false },
        voice: {
          sttProviders: [{ id: 'auto', label: 'Transcription', configured: true }, { id: 'xai', label: 'xAI / Grok', configured: xaiConfigured }],
          ttsProviders: [{ id: 'openai_realtime', label: 'OpenAI Realtime', configured: openAiConfigured }, { id: 'openai', label: 'OpenAI', configured: credentialReady('openai') }, { id: 'xai', label: 'xAI / Grok', configured: xaiConfigured }],
          voiceCatalogs: { xai: Array.isArray(xaiRealtime?.voices) ? xaiRealtime.voices : [] },
          xaiModel: xaiRealtime?.model || 'grok-voice-latest',
        },
      };
      voiceAgents = Array.isArray(agents) ? agents : Array.isArray(agents?.agents) ? agents.agents : [];
      paintAgentTarget();
      paintVoiceSettings();
      updateVoiceRoutingDetails();
    } catch (error) {
      if (disposed || generation !== loadStatusGeneration) return;
      providerDetails.textContent = error?.message || 'Voice status could not be checked.';
      updateVoiceRoutingDetails();
    }
  }
  void refreshVoiceStatus();

  page.querySelector('[data-speak-replies]')?.addEventListener('change', (event) => {
    speakReplies = event.currentTarget.checked;
    updateVoiceRoutingDetails();
  });
  agentTargetButton?.addEventListener('click', () => {
    const open = agentTargetMenu.hidden;
    agentTargetMenu.hidden = !open;
    agentTargetMenu.classList.toggle('open', open);
    agentTargetButton.setAttribute('aria-expanded', String(open));
    if (open) scroller.scrollTo({ top: 0, behavior: 'smooth' });
  });
  agentTargetGrid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-agent-target]');
    if (!button) return;
    const id = button.dataset.agentTarget;
    if (id === 'main') selectedAgent = { kind: 'main', id: '', name: 'Main Agent' };
    else {
      const agent = voiceAgents.find((item) => String(item?.id || item?.agentId || '') === id);
      selectedAgent = { kind: 'subagent', id, name: String(agent?.name || agent?.label || id) };
    }
    agentTargetName.textContent = selectedAgent.name;
    agentTargetMenu.hidden = true;
    agentTargetMenu.classList.remove('open');
    agentTargetButton.setAttribute('aria-expanded', 'false');
    paintAgentTarget();
    shell.showNotice(`Voice target set to ${selectedAgent.name}.`);
  });
  targetButton?.addEventListener('click', () => showTargetMenu(targetMenu.hidden));
  targetMenu?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-voice-target]');
    if (!button) return;
    try {
      const entry = gateways.select(button.dataset.voiceTarget);
      activeGatewayId = entry.id;
      paintTarget();
      showTargetMenu(false);
      shell.showNotice(`Voice target set to ${entry.name}.`);
    } catch (error) {
      shell.showNotice(error?.message || 'Could not change the voice target.');
    }
  });
  settingsToggle?.addEventListener('click', () => showSettings(settingsPanel.hidden));
  voiceModeSelect?.addEventListener('change', () => {
    saveVoiceSetting({ voiceMode: voiceModeSelect.value === 'xai' ? 'xai' : 'openai_realtime' });
    updateVoiceRoutingDetails();
  });
  inputModeSelect?.addEventListener('change', () => {
    const nextMode = ['browser', 'record_transcribe'].includes(inputModeSelect.value) ? inputModeSelect.value : 'automatic';
    if (nextMode === 'record_transcribe' && voiceSettings.listenMode === 'always_listening') {
      alwaysListeningEnabled = false;
      clearTimeout(recognitionSilenceTimer);
      void stopListening();
      voiceSettings = { ...voiceSettings, listenMode: 'push_to_speak' };
      listenModeSelect.value = 'push_to_speak';
      saveVoiceSettings({ listenMode: 'push_to_speak' });
    }
    saveVoiceSetting({ inputMode: nextMode });
    updateVoiceRoutingDetails();
    shell.showNotice(nextMode === 'automatic'
      ? 'Input set to automatic browser recognition with gateway transcription fallback.'
      : nextMode === 'browser'
        ? 'Input set to browser speech recognition.'
        : 'Input set to record and transcribe. Always listening is unavailable in this mode.');
  });
  listenModeSelect?.addEventListener('change', () => {
    saveVoiceSetting({ listenMode: listenModeSelect.value === 'always_listening' ? 'always_listening' : 'push_to_speak' });
    if (voiceSettings.listenMode === 'always_listening') {
      alwaysListeningEnabled = true;
      startListening();
      shell.showNotice('Always listening enabled. Tap Stop to pause the microphone.');
    } else {
      alwaysListeningEnabled = false;
      clearTimeout(recognitionSilenceTimer);
      void stopListening();
      shell.showNotice('Push to Speak enabled.');
    }
  });
  openaiVoiceSelect?.addEventListener('change', () => saveVoiceSetting({ realtimeVoice: openaiVoiceSelect.value }));
  serverVoiceSelect?.addEventListener('change', () => saveVoiceSetting({ serverVoice: serverVoiceSelect.value }));
  speedInput?.addEventListener('input', () => {
    const speed = Number(speedInput.value);
    speedLabel.textContent = `${speed.toFixed(2)}x`;
    saveVoiceSetting(voiceSettings.voiceMode === 'xai' ? { xaiSpeed: speed } : { realtimeSpeed: speed });
  });
  const startNewVoiceChat = () => {
    aborter?.abort();
    stopSpeech();
    paintApproval(null);
    transcript = '';
    reply = '';
    lastReply = '';
    repeatButton.hidden = true;
    repeatButton.disabled = true;
    pendingAttachments = [];
    paintAttachments();
    sessionId = newVoiceSessionId();
    saveVoiceSession(sessionId);
    if (sessionTargetLabel) sessionTargetLabel.textContent = 'Mobile — New Chat';
    setStatus('Ready', 'Tap and hold the orb to speak again', 'thinking');
    shell.showNotice('New voice chat ready.');
  };
  page.querySelector('[data-new-voice]')?.addEventListener('click', startNewVoiceChat);
  document.querySelector('#pm-v2-header-slot [data-action="new-voice"]')?.addEventListener('click', startNewVoiceChat);
  sessionTargetButton?.addEventListener('click', () => shell.setDrawer(true));
  page.querySelector('[data-voice-stop]')?.addEventListener('click', () => {
    alwaysListeningEnabled = false;
    clearTimeout(recognitionSilenceTimer);
    if (listenModeSelect.value === 'always_listening') {
      voiceSettings = { ...voiceSettings, listenMode: 'push_to_speak' };
      listenModeSelect.value = 'push_to_speak';
      saveVoiceSettings({ listenMode: 'push_to_speak' });
    }
    aborter?.abort();
    const activeRecognition = recognition;
    recognition = null;
    if (activeRecognition) {
      activeRecognition.onresult = null;
      try { activeRecognition.abort?.(); } catch { try { activeRecognition.stop(); } catch {} }
    }
    const activeRecorder = recorder;
    recorder = null;
    if (activeRecorder) try { activeRecorder.stop(); } catch {}
    stream?.getTracks?.().forEach((track) => track.stop());
    stream = null;
    stopSpeech();
    listening = false;
    orb.classList.remove('pressed', 'recording');
    setStatus('Stopped', 'Hold the orb to speak again', 'thinking');
  });
  repeatButton?.addEventListener('click', () => {
    if (lastReply) void queueSpeech(lastReply);
  });
  page.querySelector('[data-voice-clear]')?.addEventListener('click', (event) => {
    event.preventDefault();
    recent.splice(0);
    paintRecent();
  });
  const scrollToVoiceSection = (selector) => {
    const section = scroller.querySelector(selector);
    if (!section) return;
    const top = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top, behavior: 'smooth' });
  };
  page.querySelector('[data-voice-snap-down]')?.addEventListener('click', () => {
    scrollToVoiceSection('.pm-voice-snap-secondary');
  });
  page.querySelector('[data-voice-snap-up]')?.addEventListener('click', () => {
    scrollToVoiceSection('.pm-voice-snap-primary');
  });

  async function sendTranscript(text) {
    const message = String(text || '').trim();
    if (!message) return;
    if (pendingAttachments.length && selectedAgent.kind !== 'main') {
      shell.showNotice('Attachments are currently available when Voice targets the Main Agent.');
      return;
    }
    const sentAttachments = pendingAttachments.map((item) => ({ ...item }));
    transcript = message;
    reply = '';
    const targetLabel = selectedAgent.name || 'Main Agent';
    addRecent(message, `${targetLabel} · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    paintTranscript();
    setStatus('Thinking', 'Prometheus is working…', 'solving');

    const gateway = gateways.client(activeGatewayId);
    if (selectedAgent.kind === 'main') {
      try { await gateway.createSession({ id: sessionId, title: 'Voice Chat' }); }
      catch (error) {
        if (![400, 409].includes(Number(error?.status))) {
          shell.showNotice(error?.message || 'Could not start a voice chat.');
          setStatus('Voice error', 'Try again.', 'thinking');
          return;
        }
      }
      if (sessionTargetLabel) sessionTargetLabel.textContent = 'Mobile — Voice Chat';
    }

    aborter = new AbortController();
    let final = '';
    try {
      const onEvent = (event) => {
          if (event.type === 'approval.required') {
            paintApproval(event.approval || event.raw?.approval || event.raw || {});
          } else if (event.type === 'assistant.delta') {
            reply += event.text || '';
            paintTranscript();
          } else if (event.type === 'assistant.done') {
            if (event.text && !reply) reply = event.text;
            final = reply || event.text || '';
            paintTranscript();
      } else if (event.type === 'tool.activity') {
            setStatus('Working', event.name || 'Using a tool…', 'solving');
            addRecent(event.name || 'Working on your request', event.message || 'In progress', 'tool');
            if (narrationMode === 'milestone') {
              const milestone = String(event.message || event.name || '').replace(/\s+/g, ' ').trim().slice(0, 150);
              if (milestone) void queueSpeech(`Working on ${milestone}`);
            }
          } else if (event.type === 'reasoning.summary.delta') {
            setStatus('Thinking', String(event.text || '').slice(-120), 'solving');
          } else if (event.type === 'assistant.error') {
            throw new Error(event.message || 'Gateway stream failed.');
          }
        };
      if (selectedAgent.kind === 'subagent') {
        await features.streamAgentChat(selectedAgent.id, message, { signal: aborter.signal, onEvent });
      } else {
        await gateway.streamChat({
          sessionId,
          message,
          clientRequestId: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          attachments: sentAttachments,
          signal: aborter.signal,
          onEvent,
        });
      }
      final = reply || final;
      if (final) {
        lastReply = final;
        repeatButton.hidden = false;
        repeatButton.disabled = false;
        addRecent('Response ready', 'Prometheus replied', 'tool');
      }
      if (sentAttachments.length) {
        pendingAttachments.splice(0, sentAttachments.length);
        paintAttachments();
      }
      setStatus(final || 'Ready', final ? 'Prometheus replied' : 'Tap and hold the orb to speak', 'thinking');
      if (speakReplies && final) await queueSpeech(final);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        reply = `Voice error: ${error?.message || error}`;
        paintTranscript();
        setStatus('Voice error', 'Try again.', 'thinking');
      }
    } finally {
      aborter = null;
      if (alwaysListeningEnabled && !disposed) setTimeout(() => startListening(), 500);
    }
  }

  async function startListening() {
    if (listening || disposed) return;
    listening = true;
    transcript = '';
    orb.classList.add('pressed', 'recording');
    window.speechSynthesis?.cancel?.();
    setStatus('Listening', 'Release when you’re done', 'listening');

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (voiceSettings.inputMode === 'browser' && !Recognition) {
      voiceSettings = { ...voiceSettings, inputMode: 'automatic' };
      saveVoiceSettings({ inputMode: 'automatic' });
      paintVoiceSettings();
      shell.showNotice('Browser speech recognition is unavailable here. Automatic input will use audio transcription when available.');
    }
    const useBrowserRecognition = !!Recognition && voiceSettings.inputMode !== 'record_transcribe';
    if (useBrowserRecognition) {
      recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';
      let finalText = '';
      recognition.onresult = (event) => {
        let interim = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const text = event.results[index][0]?.transcript || '';
          if (event.results[index].isFinal) finalText += `${text} `;
          else interim += text;
        }
        transcript = (finalText || interim).trim();
        paintTranscript();
        if (alwaysListeningEnabled && finalText.trim()) {
          clearTimeout(recognitionSilenceTimer);
          recognitionSilenceTimer = setTimeout(() => {
            recognitionSilenceTimer = null;
            void stopListening();
          }, 900);
        }
      };
      recognition.onerror = (event) => {
        listening = false;
        orb.classList.remove('pressed', 'recording');
        if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
          alwaysListeningEnabled = false;
          voiceSettings = { ...voiceSettings, listenMode: 'push_to_speak' };
          listenModeSelect.value = 'push_to_speak';
          saveVoiceSettings({ listenMode: 'push_to_speak' });
        }
        enableDictation(event?.error === 'not-allowed' ? 'Allow microphone access, or use keyboard dictation.' : 'Browser speech recognition is unavailable.');
        setStatus('Microphone unavailable', 'Type or dictate a message below.', 'thinking');
      };
      recognition.start();
      return;
    }

    if (alwaysListeningEnabled) {
      listening = false;
      alwaysListeningEnabled = false;
      voiceSettings = { ...voiceSettings, listenMode: 'push_to_speak' };
      listenModeSelect.value = 'push_to_speak';
      saveVoiceSettings({ listenMode: 'push_to_speak' });
      orb.classList.remove('pressed', 'recording');
      shell.showNotice('Always listening requires browser speech recognition. Push to Speak is available here.');
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Audio recording is unavailable in this browser.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.start();
    } catch (error) {
      listening = false;
      orb.classList.remove('pressed', 'recording');
      enableDictation(error?.message || 'Allow microphone access, or use keyboard dictation.');
      setStatus('Microphone unavailable', 'Type or dictate a message below.', 'thinking');
    }
  }

  async function stopListening() {
    if (!listening) return;
    clearTimeout(recognitionSilenceTimer);
    recognitionSilenceTimer = null;
    listening = false;
    orb.classList.remove('pressed', 'recording');
    if (recognition) {
      const active = recognition;
      recognition = null;
      try { active.stop(); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 160));
      const text = transcript;
      setStatus('Processing', 'Sending your message…', 'solving');
      if (text) sendTranscript(text);
      else setStatus('Ready', 'I didn’t catch that. Try again.', 'thinking');
      return;
    }
    if (!recorder) return;

    const active = recorder;
    recorder = null;
    const blob = await new Promise((resolve) => {
      active.onstop = () => resolve(new Blob(chunks, { type: active.mimeType || 'audio/webm' }));
      try { active.stop(); } catch { resolve(new Blob(chunks, { type: 'audio/webm' })); }
    });
    stream?.getTracks?.().forEach((track) => track.stop());
    stream = null;
    setStatus('Transcribing', 'Turning speech into text…', 'solving');
    try {
      const audioBase64 = await blobToBase64(blob);
      const result = await features.transcribe({ provider: 'auto', audioBase64, mimeType: blob.type || 'audio/webm', filename: 'voice.webm' });
      transcript = String(result?.text || result?.transcript || result?.result || '').trim();
      paintTranscript();
      if (transcript) sendTranscript(transcript);
      else setStatus('Ready', 'I didn’t catch that. Try again.', 'thinking');
    } catch (error) {
      enableDictation(error?.message || 'Try keyboard dictation while speech transcription is unavailable.');
      setStatus('Transcription failed', 'Type or dictate a message below.', 'thinking');
    }
  }

  orb.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    orb.setPointerCapture?.(event.pointerId);
    orbPressStarted = false;
    if (voiceSettings.listenMode === 'always_listening' && !alwaysListeningEnabled) {
      alwaysListeningEnabled = true;
      orbPressStarted = true;
      startListening();
      return;
    }
    if (alwaysListeningEnabled) return;
    clearTimeout(orbPressTimer);
    orbPressTimer = setTimeout(() => {
      orbPressStarted = true;
      startListening();
    }, 210);
  });
  const finishOrbPress = (event) => {
    event?.preventDefault?.();
    clearTimeout(orbPressTimer);
    if (alwaysListeningEnabled) {
      if (orbPressStarted) { orbPressStarted = false; return; }
      agentTargetMenu.hidden = false;
      agentTargetMenu.classList.add('open');
      agentTargetButton.setAttribute('aria-expanded', 'true');
      return;
    }
    if (orbPressStarted) void stopListening();
    else {
      const open = agentTargetMenu.hidden;
      agentTargetMenu.hidden = !open;
      agentTargetMenu.classList.toggle('open', open);
      agentTargetButton.setAttribute('aria-expanded', String(open));
    }
    orbPressStarted = false;
  };
  orb.addEventListener('pointerup', finishOrbPress);
  orb.addEventListener('pointercancel', (event) => {
    clearTimeout(orbPressTimer);
    if (orbPressStarted) void stopListening();
    orbPressStarted = false;
    event?.preventDefault?.();
  });
  orb.addEventListener('click', (event) => {
    if (event.detail !== 0) return;
    const open = agentTargetMenu.hidden;
    agentTargetMenu.hidden = !open;
    agentTargetMenu.classList.toggle('open', open);
    agentTargetButton.setAttribute('aria-expanded', String(open));
  });
  dictationForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = String(dictationText?.value || '').trim();
    if (!text) return;
    dictationText.value = '';
    transcript = text;
    sendTranscript(text);
  });

  const handleGatewayChange = (event) => {
    if (event.detail?.activeId && event.detail.activeId !== activeGatewayId) {
      activeGatewayId = event.detail.activeId;
      closeCamera();
      stopSpeech();
      if (pendingAttachments.length) {
        pendingAttachments = [];
        paintAttachments();
        shell.showNotice('Queued voice attachments were cleared because they belong to the previous gateway.');
      }
      sessionId = newVoiceSessionId();
      saveVoiceSession(sessionId);
      if (sessionTargetLabel) sessionTargetLabel.textContent = 'Mobile — New Chat';
      paintTarget();
      void refreshVoiceStatus();
    }
  };
  gateways.addEventListener('change', handleGatewayChange);

  return () => {
    disposed = true;
    gateways.removeEventListener('change', handleGatewayChange);
    closeCamera();
    stopSpeech();
    aborter?.abort();
    try { recognition?.stop(); } catch {}
    try { recorder?.stop(); } catch {}
    stream?.getTracks?.().forEach((track) => track.stop());
    orbController?.destroy?.();
  };
}
