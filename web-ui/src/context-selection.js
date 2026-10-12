const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString();
export function renderContextSelection(profile, budget, prefix = 'context-choice') {
  const p = profile || {};
  const standard = p.standardContextWindowTokens || p.contextWindowTokens || 0;
  const maximum = p.maxContextWindowTokens || p.contextWindowTokens || 0;
  const selected = p.contextWindowTokens || standard;
  const mode = p.contextSelectionMode === 'custom' && selected === 500000 ? '500k' : ['standard','maximum','custom'].includes(p.contextSelectionMode) ? p.contextSelectionMode : 'standard';
  const choices = [...new Set([32000,64000,128000,256000,500000,1000000,standard,maximum,selected])].filter(n => n >= 1024 && n <= maximum).sort((a,b) => a-b);
  return `<section style="margin:12px 0;padding:12px;border:1px solid var(--prom-border,var(--line));border-radius:10px;color:var(--prom-text,var(--text));background:transparent">
    <strong>Context window</strong>
    <label for="${prefix}-mode" style="display:block;font-size:12px;margin-top:8px">Preset</label><select id="${prefix}-mode" style="display:block;width:100%;box-sizing:border-box;margin:6px 0;background:transparent;color:inherit"><option value="standard" ${mode==='standard'?'selected':''}>Standard (${fmt(standard)})</option>${maximum >= 500000 && standard !== 500000 && maximum !== 500000 ? `<option value="500k" ${mode==='500k'?'selected':''}>500k tokens</option>` : ''}<option value="maximum" ${mode==='maximum'?'selected':''}>Maximum (${fmt(maximum)})</option><option value="custom" ${mode==='custom'?'selected':''}>Custom</option></select>
    <label for="${prefix}-tokens" style="font-size:12px">Token budget</label><select id="${prefix}-tokens" style="display:block;width:100%;box-sizing:border-box;margin:6px 0;background:transparent;color:inherit">${choices.map(n => `<option value="${n}" ${n===selected?'selected':''}>${fmt(n)} tokens</option>`).join('')}</select>
    <div role="note" style="font-size:12px;color:var(--prom-warning,var(--muted));margin:10px 0">${esc(p.contextUsageWarning || 'Larger requests use more tokens. Provider pricing and subscription rules vary.')}</div>
    <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px"><input id="${prefix}-ack" type="checkbox" ${selected > standard ? 'checked':''}>I understand extended context may use more allowance or cost more.</label>
    <button id="${prefix}-save" type="button" style="margin-top:10px;background:transparent;color:inherit">Save</button><div id="${prefix}-status" role="status" style="font-size:12px;margin-top:6px"></div>
  </section>`;
}
export function wireContextSelection(root, profile, save, refresh, prefix = 'context-choice') {
  const find = suffix => root.querySelector(`#${prefix}-${suffix}`);
  const mode = find('mode'), tokens = find('tokens'), ack = find('ack'), button = find('save'), status = find('status');
  if (!button) return;
  const standard = profile.standardContextWindowTokens || profile.contextWindowTokens;
  const maximum = profile.maxContextWindowTokens || profile.contextWindowTokens;
  let saving = false;
  const update = () => {
    const preset = mode.value === 'maximum' ? maximum : mode.value === '500k' ? 500000 : mode.value === 'standard' ? standard : null;
    if (preset !== null) tokens.value = String(preset);
    tokens.disabled = mode.value !== 'custom';
    const extended = Number(tokens.value) > standard;
    ack.disabled = !extended;
    button.disabled = saving || (extended && !ack.checked);
    status.textContent = extended && !ack.checked ? 'Acknowledge the usage warning to enable extended context.' : '';
  };
  [mode,tokens,ack].forEach(el => el.addEventListener('change', update)); update();
  button.addEventListener('click', async () => {
    saving = true; button.disabled = true; status.textContent = 'Saving…';
    try {
      await save({providerId:profile.providerId,model:profile.model,accountId:profile.contextAccountId,mode:mode.value==='500k'?'custom':mode.value,tokens:Number(tokens.value),extendedAcknowledged:ack.checked});
      status.textContent = 'Saved.';
      if (refresh) await refresh();
    } catch(e) { status.textContent = e.message || 'Save failed'; }
    finally { saving = false; button.disabled = Number(tokens.value) > standard && !ack.checked; }
  });
}
