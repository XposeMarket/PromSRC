// Shared Voice Settings renderer for desktop and paired mobile settings.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function optionList(items, selected, emptyLabel) {
  if (!items.length) return `<option value="">${escapeHtml(emptyLabel || 'None available')}</option>`;
  return items.map(item => { const id = typeof item === 'string' ? item : item.id; const label = typeof item === 'string' ? item : (item.label || id); return `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`; }).join('');
}

function providerConnection(provider) {
  if (provider.connected) return `<span class="voice-settings-pill connected">Connected</span>${String(provider.authSource || '').startsWith('chat:') ? '<span>Uses chat connection</span>' : ''}`;
  if (String(provider.authSource || '').startsWith('chat:') && (provider.id === 'openai' || provider.id === 'xai')) {
    return `<span class="voice-settings-pill">Not connected · Uses chat connection · <a href="#" data-voice-chat-link="${escapeHtml(provider.id)}">Chat connections</a></span>`;
  }
  return `<span class="voice-settings-pill">Not connected</span>`;
}

function providerCard(provider) {
  const models = (provider.models || []).map(model => model.label || model.id).join(', ') || 'No models reported';
  const deleteButton = !provider.builtIn ? `<button type="button" class="voice-settings-delete" data-voice-delete="${escapeHtml(provider.id)}">Remove</button>` : '';
  return `<div class="voice-settings-provider">
    <div><strong>${escapeHtml(provider.label || provider.id)}</strong><span class="voice-settings-protocol">${escapeHtml(provider.protocol || 'voice')}</span></div>
    <div class="voice-settings-provider-meta">${providerConnection(provider)}${provider.connectionLabel ? `<span>${escapeHtml(provider.connectionLabel)}</span>` : ''}</div>
    <div class="voice-settings-provider-models">${escapeHtml(models)}</div>${deleteButton}
  </div>`;
}

export async function mountVoiceProviderSettings(container, { request, mode = 'desktop', onChatConnections } = {}) {
  if (!container || typeof request !== 'function') return;
  const className = mode === 'mobile' ? 'pm-card' : 'settings-section';
  const status = (message, tone = '') => {
    const el = container.querySelector('[data-voice-status]');
    if (el) { el.textContent = message || ''; el.className = `voice-settings-status ${tone}`; }
  };
  const load = async () => {
    status('Loading voice providers…');
    const data = await request('/api/voice/providers');
    const providers = Array.isArray(data?.providers) ? data.providers : [];
    const connected = providers.filter(provider => provider.connected);
    const defaults = data?.defaults || {};
    const selectedProvider = connected.some(provider => provider.id === defaults.provider) ? defaults.provider : (connected[0]?.id || '');
    const selected = providers.find(provider => provider.id === selectedProvider) || { models: [], voices: [] };
    const unavailable = (data?.catalog || []).filter(item => item.available === false);
    container.innerHTML = `
      <style>.voice-settings-root{display:grid;gap:14px}.voice-settings-provider{position:relative;padding:12px;border:1px solid var(--border,var(--line));border-radius:10px;display:grid;gap:7px}.voice-settings-provider>div:first-child{display:flex;align-items:center;gap:8px}.voice-settings-protocol,.voice-settings-provider-meta,.voice-settings-provider-models,.voice-settings-status{font-size:12px;color:var(--muted)}.voice-settings-provider-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.voice-settings-pill{border:1px solid var(--border,var(--line));border-radius:999px;padding:2px 7px}.voice-settings-pill.connected{color:var(--success,var(--accent));border-color:var(--success,var(--accent))}.voice-settings-delete{justify-self:start}.voice-settings-form{display:grid;gap:10px}.voice-settings-form label{display:grid;gap:5px;font-size:12px;color:var(--muted)}.voice-settings-form input,.voice-settings-form select{width:100%;box-sizing:border-box}.voice-settings-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.voice-settings-segmented{display:flex;gap:6px;flex-wrap:wrap}.voice-settings-segmented button.active{background:var(--brand,var(--accent));color:#fff}.voice-settings-empty{font-size:13px;color:var(--muted)}</style>
      <div class="voice-settings-root">
        <section class="${className}"><h3>Voice providers</h3><div class="voice-settings-provider-list">${providers.map(providerCard).join('') || '<div class="voice-settings-empty">No voice providers are available.</div>'}</div>${unavailable.length ? `<div class="voice-settings-empty">Coming soon: ${unavailable.map(item => `${escapeHtml(item.label || item.id)}${item.reason ? ` — ${escapeHtml(item.reason)}` : ''}`).join(' · ')}</div>` : ''}</section>
        <section class="${className}"><h3>Voice defaults</h3><div class="voice-settings-form">
          <label>Provider <select data-voice-default-provider>${optionList(connected, selectedProvider, 'No connected providers')}</select></label>
          <label>Model <select data-voice-default-model>${optionList(selected.models || [], defaults.model || selected.defaultModel, 'No models available')}</select></label>
          <label>Voice <select data-voice-default-voice>${optionList(selected.voices || [], defaults.voice || selected.defaultVoice, 'Default voice')}</select></label>
          <div><label>Listening mode</label><div class="voice-settings-segmented"><button type="button" data-voice-listen="push_to_talk" class="${(defaults.listenMode || 'push_to_talk') === 'push_to_talk' ? 'active' : ''}">Push to talk</button><button type="button" data-voice-listen="always_listening" class="${defaults.listenMode === 'always_listening' ? 'active' : ''}">Always listening</button></div></div>
          <div class="voice-settings-row"><button type="button" class="pm-btn primary" data-voice-save-defaults ${connected.length ? '' : 'disabled'}>Save voice defaults</button><span data-voice-status></span></div>
        </div></section>
        <section class="${className}"><h3>Add custom realtime provider</h3><div class="voice-settings-form">
          <label>Label <input data-voice-custom-label autocomplete="off" placeholder="My voice provider"></label><label>Base URL <input data-voice-custom-base-url type="url" autocomplete="url" placeholder="https://…"></label><label>Model <input data-voice-custom-model autocomplete="off" placeholder="Model ID"></label><label>Voices <input data-voice-custom-voices autocomplete="off" placeholder="Voice IDs, comma-separated"></label><label>API key <input data-voice-custom-api-key type="password" autocomplete="new-password" placeholder="Optional API key"></label><div class="voice-settings-row"><button type="button" class="pm-btn" data-voice-add-custom>Add provider</button></div>
        </div></section>
      </div>`;
    let listenMode = defaults.listenMode || 'push_to_talk';
    const findProvider = () => providers.find(provider => provider.id === container.querySelector('[data-voice-default-provider]')?.value) || { models: [], voices: [] };
    const refreshDependent = () => { const provider = findProvider(); const model = container.querySelector('[data-voice-default-model]'); const voice = container.querySelector('[data-voice-default-voice]'); model.innerHTML = optionList(provider.models || [], provider.defaultModel, 'No models available'); voice.innerHTML = optionList(provider.voices || [], provider.defaultVoice, 'Default voice'); };
    container.querySelector('[data-voice-default-provider]')?.addEventListener('change', refreshDependent);
    container.querySelectorAll('[data-voice-listen]').forEach(button => button.addEventListener('click', () => { listenMode = button.dataset.voiceListen; container.querySelectorAll('[data-voice-listen]').forEach(item => item.classList.toggle('active', item === button)); }));
    container.querySelector('[data-voice-save-defaults]')?.addEventListener('click', async () => { try { status('Saving…'); await request('/api/voice/defaults', { method: 'PUT', body: JSON.stringify({ provider: container.querySelector('[data-voice-default-provider]').value, model: container.querySelector('[data-voice-default-model]').value, voice: container.querySelector('[data-voice-default-voice]').value, listenMode }) }); status('Voice defaults saved.', 'success'); } catch (error) { status(error.message || 'Could not save voice defaults.', 'error'); } });
    container.querySelector('[data-voice-add-custom]')?.addEventListener('click', async () => { try { const read = key => container.querySelector(`[data-voice-custom-${key}]`)?.value.trim() || ''; const label = read('label'); const baseUrl = read('base-url'); const model = read('model'); if (!label || !baseUrl || !model) throw new Error('Label, base URL, and model are required.'); status('Adding provider…'); await request('/api/voice/providers/custom', { method: 'POST', body: JSON.stringify({ label, baseUrl, model, voices: read('voices').split(',').map(value => value.trim()).filter(Boolean), apiKey: read('api-key') }) }); await load(); status('Custom provider added.', 'success'); } catch (error) { status(error.message || 'Could not add provider.', 'error'); } });
    container.querySelectorAll('[data-voice-delete]').forEach(button => button.addEventListener('click', async () => { try { status('Removing provider…'); await request(`/api/voice/providers/custom/${encodeURIComponent(button.dataset.voiceDelete)}`, { method: 'DELETE' }); await load(); status('Custom provider removed.', 'success'); } catch (error) { status(error.message || 'Could not remove provider.', 'error'); } }));
    container.querySelectorAll('[data-voice-chat-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); onChatConnections?.(link.dataset.voiceChatLink); }));
    status('');
  };
  try { await load(); } catch (error) { container.innerHTML = `<div class="voice-settings-status error">${escapeHtml(error.message || 'Could not load voice providers.')}</div>`; }
}
