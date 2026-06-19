import { api } from '../api.js';

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

const PROVIDERS = [
  { id: '', label: 'Use global voice default' },
  { id: 'openai_realtime', label: 'OpenAI Realtime' },
  { id: 'xai', label: 'xAI Realtime' },
  { id: 'openai', label: 'OpenAI TTS' },
  { id: 'browser', label: 'Browser' },
];

const FALLBACK_VOICES = {
  openai_realtime: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'],
  openai: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
  xai: ['eve', 'ara', 'rex', 'sal', 'leo'],
  browser: ['default'],
};

const MODEL_OPTIONS = {
  openai_realtime: ['gpt-realtime-2', 'gpt-realtime'],
  xai: ['grok-voice-latest'],
  openai: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
};

const REASONING_OPTIONS = ['', 'low', 'medium', 'high'];

const callbacks = new Map();

export function normalizeAgentVoiceProfile(raw = {}) {
  const profile = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const provider = String(profile.provider || profile.voiceProvider || '').trim();
  const mode = String(profile.mode || profile.voiceMode || '').trim();
  const voice = String(profile.voice || profile.voiceId || '').trim();
  const model = String(profile.model || profile.voiceModel || '').trim();
  const reasoning = String(profile.reasoning_effort || profile.reasoningEffort || '').trim();
  const speed = Number(profile.speed);
  if (provider) out.provider = provider;
  if (mode) out.mode = mode;
  if (voice) out.voice = voice;
  if (model) out.model = model;
  if (reasoning) out.reasoning_effort = reasoning;
  if (Number.isFinite(speed) && speed > 0) out.speed = Math.max(0.25, Math.min(2, Math.round(speed * 100) / 100));
  return out;
}

export function renderAgentVoicePicker(agent, scope = 'agent-voice') {
  const profile = normalizeAgentVoiceProfile(agent?.voice || {});
  const provider = profile.provider || '';
  const voice = profile.voice || '';
  const model = profile.model || '';
  const reasoning = profile.reasoning_effort || '';
  const speed = Number.isFinite(Number(profile.speed)) ? Number(profile.speed) : 1;
  const modelChoices = Array.from(new Set([model, ...(MODEL_OPTIONS[provider] || [])].filter(Boolean)));
  return `
    <div class="agent-voice-picker" id="${escHtml(scope)}-voice-picker" data-agent-id="${escHtml(agent?.id || '')}" style="background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px">
        <div>
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">Voice Agent</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Default provider and voice when voice mode opens for this agent.</div>
        </div>
        <button type="button" id="${escHtml(scope)}-voice-save" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:800;cursor:pointer">Save</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;align-items:end">
        <label style="display:grid;gap:4px;font-size:11px;color:var(--muted);font-weight:700">Provider
          <select id="${escHtml(scope)}-voice-provider" style="border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:12px;background:var(--panel);color:var(--text);width:100%">
            ${PROVIDERS.map((p) => `<option value="${escHtml(p.id)}"${p.id === provider ? ' selected' : ''}>${escHtml(p.label)}</option>`).join('')}
          </select>
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:var(--muted);font-weight:700">Voice
          <select id="${escHtml(scope)}-voice-voice" data-current="${escHtml(voice)}" style="border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:12px;background:var(--panel);color:var(--text);width:100%">
            <option value="">${provider ? 'Loading voices...' : 'use provider default'}</option>
          </select>
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:var(--muted);font-weight:700">Model
          <input id="${escHtml(scope)}-voice-model" list="${escHtml(scope)}-voice-model-list" value="${escHtml(model)}" placeholder="${provider ? 'provider default' : 'global default'}" style="border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:12px;background:var(--panel);color:var(--text);width:100%;box-sizing:border-box;font-family:'IBM Plex Mono',monospace" />
          <datalist id="${escHtml(scope)}-voice-model-list">${modelChoices.map((m) => `<option value="${escHtml(m)}"></option>`).join('')}</datalist>
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:var(--muted);font-weight:700">Reasoning
          <select id="${escHtml(scope)}-voice-reasoning" style="border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:12px;background:var(--panel);color:var(--text);width:100%">
            ${REASONING_OPTIONS.map((v) => `<option value="${escHtml(v)}"${v === reasoning ? ' selected' : ''}>${v ? escHtml(v) : 'provider default'}</option>`).join('')}
          </select>
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:var(--muted);font-weight:700">Speed
          <input id="${escHtml(scope)}-voice-speed" type="number" min="0.25" max="2" step="0.05" value="${escHtml(speed)}" style="border:1px solid var(--line);border-radius:8px;padding:7px 8px;font-size:12px;background:var(--panel);color:var(--text);width:100%;box-sizing:border-box" />
        </label>
      </div>
      <div id="${escHtml(scope)}-voice-status" style="font-size:10px;color:var(--muted);margin-top:6px"></div>
    </div>`;
}

async function loadVoiceOptions(provider) {
  const key = String(provider || '').trim();
  if (!key) return [];
  try {
    const data = await api(`/api/voice/voices?provider=${encodeURIComponent(key)}`, { timeoutMs: 8000 });
    const voices = Array.isArray(data?.voices) ? data.voices : [];
    return voices.map((v) => typeof v === 'string' ? v : (v?.id || v?.name || '')).filter(Boolean);
  } catch {
    return FALLBACK_VOICES[key] || [];
  }
}

export async function agentVoicePickerHydrate(scope = 'agent-voice', agent = null) {
  const providerEl = document.getElementById(`${scope}-voice-provider`);
  const voiceEl = document.getElementById(`${scope}-voice-voice`);
  const modelEl = document.getElementById(`${scope}-voice-model`);
  const modelListEl = document.getElementById(`${scope}-voice-model-list`);
  const reasoningEl = document.getElementById(`${scope}-voice-reasoning`);
  const speedEl = document.getElementById(`${scope}-voice-speed`);
  const saveBtn = document.getElementById(`${scope}-voice-save`);
  const statusEl = document.getElementById(`${scope}-voice-status`);
  if (!providerEl || !voiceEl || !saveBtn) return;

  const setStatus = (text, color = 'var(--muted)') => {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.style.color = color;
  };
  const renderVoices = async () => {
    const provider = String(providerEl.value || '').trim();
    const current = String(voiceEl.value || voiceEl.dataset.current || agent?.voice?.voice || '').trim();
    const currentModel = String(modelEl?.value || agent?.voice?.model || '').trim();
    if (modelListEl) {
      const models = Array.from(new Set([currentModel, ...(MODEL_OPTIONS[provider] || [])].filter(Boolean)));
      modelListEl.innerHTML = models.map((model) => `<option value="${escHtml(model)}"></option>`).join('');
    }
    if (modelEl) modelEl.placeholder = provider ? 'provider default' : 'global default';
    if (reasoningEl) reasoningEl.disabled = !provider;
    voiceEl.disabled = !provider;
    if (!provider) {
      voiceEl.innerHTML = '<option value="">use provider default</option>';
      setStatus('Using the global voice settings for this agent.');
      return;
    }
    voiceEl.innerHTML = '<option value="">Loading...</option>';
    const voices = await loadVoiceOptions(provider);
    const unique = Array.from(new Set([...(voices || []), current].filter(Boolean)));
    voiceEl.innerHTML = `<option value="">provider default</option>${unique.map((voice) => `<option value="${escHtml(voice)}">${escHtml(voice)}</option>`).join('')}`;
    if (current && unique.includes(current)) voiceEl.value = current;
    setStatus(provider === 'xai'
      ? 'xAI voice uses realtime audio; image/video understanding can still fall back through the configured vision summary path.'
      : '');
  };

  providerEl.onchange = () => {
    voiceEl.dataset.current = '';
    renderVoices().catch(() => {});
  };
  saveBtn.onclick = async () => {
    const agentId = String(agent?.id || document.getElementById(`${scope}-voice-picker`)?.dataset?.agentId || '').trim();
    if (!agentId) return;
    const profile = normalizeAgentVoiceProfile({
      provider: providerEl.value,
      voice: voiceEl.value,
      model: modelEl?.value,
      reasoning_effort: reasoningEl?.value,
      speed: speedEl?.value,
    });
    saveBtn.disabled = true;
    setStatus('Saving voice profile...');
    try {
      const data = await api(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: { agent: { voice: Object.keys(profile).length ? profile : null } },
        timeoutMs: 10000,
      });
      if (!data?.success) throw new Error(data?.error || 'save failed');
      setStatus('Voice profile saved.', 'var(--success)');
      const cb = callbacks.get(scope);
      if (cb) await cb(agentId, data.agent);
    } catch (err) {
      setStatus(err?.message || 'Could not save voice profile.', 'var(--danger)');
    } finally {
      saveBtn.disabled = false;
    }
  };
  await renderVoices();
}

export function registerAgentVoicePickerOnSaved(scope, callback) {
  if (!scope || typeof callback !== 'function') return;
  callbacks.set(scope, callback);
}
