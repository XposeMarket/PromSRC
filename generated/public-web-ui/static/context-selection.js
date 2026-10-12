const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString();
export function renderContextSelection(profile, budget, prefix = 'context-choice') {
  const p = profile || {}, b = budget || {};
  const standard = p.standardContextWindowTokens || p.contextWindowTokens || 0;
  const maximum = p.maxContextWindowTokens || p.contextWindowTokens || 0;
  const mode = ['standard','maximum','custom'].includes(p.contextSelectionMode) ? p.contextSelectionMode : 'standard';
  return `<section style="margin:12px 0;padding:12px;border:1px solid var(--prom-border,var(--line));border-radius:10px;color:var(--prom-text,var(--text));background:transparent">
    <strong>Context window</strong><div style="font-size:12px;margin:6px 0;overflow-wrap:anywhere">${esc(p.providerId)}/${esc(p.model)}<br>Selected: ${fmt(p.contextWindowTokens)} · Standard: ${fmt(standard)} · Maximum: ${fmt(maximum)} tokens<br>Compacts near ${fmt(b.compactionTriggerTokens)} input tokens. Output, reasoning and safety reserves are separate.<br>Capacity source: ${esc(p.source || 'unknown')}. Provider/account admission may differ.</div>
    <label for="${prefix}-mode">Context mode</label><select id="${prefix}-mode" style="display:block;width:100%;margin:6px 0;background:transparent;color:inherit"><option value="standard" ${mode==='standard'?'selected':''}>Standard (${fmt(standard)})</option><option value="maximum" ${mode==='maximum'?'selected':''}>Maximum (${fmt(maximum)})</option><option value="custom" ${mode==='custom'?'selected':''}>Custom token budget</option></select>
    <label for="${prefix}-tokens">Custom tokens (1024–${fmt(maximum)})</label><input id="${prefix}-tokens" type="number" min="1024" max="${maximum}" step="1" value="${p.contextWindowTokens || standard}" style="display:block;width:100%;box-sizing:border-box;margin:6px 0;background:transparent;color:inherit">
    <div role="note" style="font-size:12px;color:var(--prom-warning,var(--muted));margin:10px 0">${esc(p.contextUsageWarning || 'Larger requests use more tokens. Provider pricing and subscription rules vary.')}</div>
    <label style="display:flex;gap:8px;font-size:12px"><input id="${prefix}-ack" type="checkbox" ${p.contextWindowTokens > standard ? 'checked':''}>I understand extended context may use more allowance or cost more.</label>
    <button id="${prefix}-save" type="button" style="margin-top:10px;background:transparent;color:inherit">Save context window</button><div id="${prefix}-status" role="status" style="font-size:12px;margin-top:6px"></div>
  </section>`;
}
export function wireContextSelection(root, profile, save, refresh, prefix = 'context-choice') {
  const find = suffix => root.querySelector(`#${prefix}-${suffix}`);
  const mode = find('mode'), tokens = find('tokens'), ack = find('ack'), button = find('save'), status = find('status');
  if (!button) return;
  const update = () => { tokens.disabled = mode.value !== 'custom'; const extended = (mode.value === 'maximum' ? profile.maxContextWindowTokens : mode.value === 'custom' ? Number(tokens.value) : profile.standardContextWindowTokens) > profile.standardContextWindowTokens; ack.disabled = !extended; button.disabled = extended && !ack.checked; status.textContent = extended && !ack.checked ? 'Acknowledge the usage warning to enable extended context.' : ''; };
  [mode,tokens,ack].forEach(el => el.addEventListener('change', update)); tokens.addEventListener('input', update); update();
  button.addEventListener('click', async () => { button.disabled = true; status.textContent = 'Saving…'; try { await save({ providerId: profile.providerId, model: profile.model, accountId: profile.contextAccountId, mode: mode.value, tokens: Number(tokens.value), extendedAcknowledged: ack.checked }); status.textContent = 'Saved. Applies to new turns; running turns keep their existing budget.'; if (refresh) await refresh(); } catch(e) { status.textContent = e.message || 'Save failed'; } finally { button.disabled = false; } });
}
