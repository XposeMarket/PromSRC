import { api } from '../api.js';
import { mountReferenceSharing, mountCollectionOverview } from './MemoryReferenceSharing.js';
import { escHtml as esc, showToast } from '../utils.js';
const ROOT = '/api/memory/references';
const css = `.memory-reference-library{display:flex;flex-direction:column;min-height:0;flex:1;overflow:auto;color:var(--text-primary,#eee);padding:16px;gap:16px}.mref-bar,.mref-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mref-tabs{display:flex;gap:8px;padding:8px 16px;flex-shrink:0}.mref-tabs button,.memory-reference-library button{border:1px solid var(--border,#444);border-radius:9px;background:var(--bg-secondary,#202020);color:inherit;padding:9px 12px;cursor:pointer}.mref-tabs button[aria-selected=true]{border-color:var(--accent,#d6b35b);color:var(--accent,#d6b35b)}.memory-reference-library input:not([type=checkbox]),.memory-reference-library textarea,.memory-reference-library select{box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--border,#444);border-radius:8px;background:var(--bg-primary,#151515);color:inherit;font:inherit}.memory-reference-library label{display:grid;gap:6px;font-size:13px}.mref-layout{display:grid;grid-template-columns:minmax(210px,1fr) minmax(260px,1.7fr);gap:20px;min-height:0}.mref-list{display:flex;flex-direction:column;gap:8px}.mref-list button{text-align:left;display:grid;gap:5px}.mref-list small,.mref-muted{color:var(--text-secondary,#aaa);font-size:12px;line-height:1.5}.mref-detail{display:grid;align-content:start;gap:14px;min-width:0}.mref-detail h3{margin:0}.mref-detail textarea{min-height:75px;resize:vertical}.mref-previews{display:flex;gap:10px;overflow:auto;max-width:100%}.mref-previews figure{margin:0;flex:0 0 min(100%,280px)}.mref-previews img{width:100%;max-height:260px;object-fit:contain;background:#111;border-radius:8px}.mref-previews figcaption{font-size:12px;padding-top:5px}.mref-status{font-size:13px;min-height:20px}.mref-error{color:var(--error,#ef8e8e)}.mref-detail pre{white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;font-size:12px}.mref-new[hidden]{display:none}.mref-new{display:grid;gap:12px;border:1px solid var(--border,#444);padding:14px;border-radius:12px}.mref-switch{display:flex!important;align-items:center;gap:8px!important}.mref-danger{color:var(--error,#ef8e8e)!important}.mref-related{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:700px){.memory-reference-library{padding:12px}.mref-layout{grid-template-columns:1fr}.mref-list{max-height:230px;overflow:auto}.mref-detail{border-top:1px solid var(--border,#444);padding-top:16px}.mref-tabs{padding:8px 12px}}`;

export function mountMemoryReferences() {
  const canvas = document.getElementById('memory-graph-canvas');
  const shell = canvas?.closest('.memory-page-shell') || document.querySelector('#page-memory');
  if (!shell || shell.querySelector('.mref-tabs')) return;
  const graph = shell.querySelector('.memory-page-body'); if (!graph) return;
  const style = document.createElement('style'); style.textContent = css; shell.append(style);
  const tabs = document.createElement('div'); tabs.className = 'mref-tabs'; tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button type="button" role="tab" aria-selected="true" data-tab="graph">Graph</button><button type="button" role="tab" aria-selected="false" data-tab="references">References</button>';
  graph.before(tabs);
  const panel = document.createElement('section'); panel.className = 'memory-reference-library'; panel.hidden = true; panel.style.display = 'none'; graph.after(panel);
  let sharing = null; let generation = 0; let detailGeneration = 0; let items = []; let selected; let writable = false; let offset = 0;
  panel.innerHTML = `<div class="mref-bar"><div style="flex:1"><strong>Saved references</strong><div class="mref-muted">Original evidence, with why it matters. Private to your personal chats.</div></div><button type="button" data-new>Add reference</button></div>
    <div class="mref-bar"><label class="mref-switch"><input type="checkbox" data-capture>Save new shared attachments</label><label class="mref-switch"><input type="checkbox" data-recall>Suggest relevant references in chats</label></div>
    <div class="mref-muted" data-storage></div><form data-search><input type="search" aria-label="Search saved references" placeholder="Search references…"></form>
    <form class="mref-new" hidden><strong>Add a reference</strong><label>Title<input name="title" required maxlength="500"></label><label>Why are you sharing it?<textarea name="userQuote" placeholder="What should Prom take from this?"></textarea></label><label>Note or source link<textarea name="content" placeholder="Links are saved as links, not automatically downloaded."></textarea></label><label>Or upload a file<input name="file" type="file"></label><div class="mref-actions"><button type="submit" ${writable ? '' : 'disabled'}>Save reference</button><button type="button" data-cancel>Cancel</button></div></form>
    <div class="mref-status" role="status"></div><div class="mref-collections-host"></div><div class="mref-layout"><div><div class="mref-list"></div><div class="mref-actions"><button type="button" data-prev-page>Previous</button><button type="button" data-next-page>Next</button></div></div><div class="mref-detail"><p class="mref-muted">Choose a reference to view its original evidence and context.</p></div></div>`;
  const $ = s => panel.querySelector(s);
  mountCollectionOverview($('.mref-collections-host'), { resolveTitle: rid => items.find(i => i.id === rid)?.title, onChange: () => { if (selected) detail(selected); } });
  const status = (message, failure = false) => { $('.mref-status').textContent = message; $('.mref-status').classList.toggle('mref-error', failure); };
  const request = async (url, options) => { const r = await api(url, options); if (r.success === false) throw new Error(r.error || 'Reference request failed'); return r; };
  const mutate = (url, method, body) => request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  async function load() {
    const seq = ++generation; status('Loading references…');
    try {
      const r = await request(`${ROOT}?q=${encodeURIComponent($('[type=search]').value)}&offset=${offset}`); if (seq !== generation || !panel.isConnected) return;
      items = r.items; writable = r.writable;
      $('[data-prev-page]').disabled = offset === 0; $('[data-next-page]').disabled = items.length < 50;
      $('[data-capture]').checked = r.settings.capture; $('[data-recall]').checked = r.settings.recall;
      $('[data-capture]').disabled = !writable; $('[data-recall]').disabled = !writable; $('[data-new]').disabled = !writable; $('.mref-new [type=submit]').disabled = !writable;
      $('[data-storage]').textContent = `${r.total ?? items.length} references · ${r.storageBytes != null ? (r.storageBytes / 1048576).toFixed(1) + ' MiB managed resource storage (approx.) · ' : ''}Private unless you share it with a team${writable ? '' : ' · Read-only: another gateway owns the library'}`;
      $('.mref-list').innerHTML = items.length ? items.map(ref => `<button type="button" data-id="${esc(ref.id)}"><strong>${esc(ref.title)}</strong><small>${ref.excluded ? 'Not used as a reference' : esc(ref.status)} · ${esc(ref.userQuote || 'No purpose recorded')}</small></button>`).join('') : '<p class="mref-muted">No saved references yet. Add a picture, document, note or link. Existing chat history is not imported automatically.</p>';
      status('');
    } catch (e) { status(e.message, true); }
  }
  async function detail(id, offset = 0) {
    sharing?.destroy(); sharing = null; selected = id; const seq = ++detailGeneration; const target = $('.mref-detail'); status('Opening saved evidence…');
    try {
      const r = await request(`${ROOT}/${encodeURIComponent(id)}?offset=${offset}`); if (selected !== id || seq !== detailGeneration || !panel.isConnected) return;
      const ref = r.reference;
      target.innerHTML = `<h3>${esc(ref.title)}</h3><div class="mref-muted">${esc(ref.versionId)}<br>${esc(ref.sourceSession ? 'From chat ' + ref.sourceSession : 'Saved directly in Memory')} · ${esc(r.coverage.replaceAll('_',' '))}</div><div class="mref-previews"></div>
        ${r.nextOffset !== null ? `<button type="button" data-next="${r.nextOffset}">Next saved frames</button>` : ''}
        <form data-edit><div class="mref-detail"><label>Title<input name="title" value="${esc(ref.title)}"></label><label>Your original reason<textarea name="userQuote">${esc(ref.userQuote || '')}</textarea></label><label>Interpretation (can be corrected)<textarea name="interpretation">${esc(ref.interpretation || '')}</textarea></label><label>Notes<textarea name="notes">${esc(ref.notes || '')}</textarea></label><label>Use as<select name="status"><option value="saved">Saved evidence, not a rule</option><option value="suggested">Suggested connection</option><option value="confirmed">Confirmed guidance</option></select></label><label>Related references<select name="relatedIds" multiple size="4">${[...new Map([...items.filter(item => item.id !== id), ...(ref.relatedIds || []).filter(link => !items.some(item => item.id === link)).map(link => ({id:link,title:'Linked reference '+link}))].map(item => [item.id,item])).values()].map(item => `<option value="${esc(item.id)}" ${(ref.relatedIds || []).includes(item.id) ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select><small class="mref-muted">Choose related saved evidence. Multiple selections are supported.</small></label><button type="submit" ${writable ? '' : 'disabled'}>Save corrections</button></div></form>
        <div><strong>Linked from</strong><div class="mref-related">${r.backlinks.length ? r.backlinks.map(b => `<button type="button" data-related="${esc(b.id)}">${esc(b.title)}</button>`).join('') : '<span class="mref-muted">No backlinks yet</span>'}</div></div>
        <div class="mref-sharing-host"></div><details><summary>Stored text / analysis</summary><pre>${esc(r.text || 'No text extraction saved. The original file is still available for export.')}</pre></details>
        <div class="mref-actions"><button type="button" data-export>Download original + context</button><button type="button" data-exclude ${writable ? '' : 'disabled'}>${ref.excluded ? 'Use as reference again' : 'Don’t use as reference'}</button>${ref.sourceSession ? `<button type="button" data-forget ${writable ? '' : 'disabled'}>Forget source chat from memory</button>` : ''}<button type="button" data-delete class="mref-danger" ${writable ? '' : 'disabled'}>Delete reference</button></div><p class="mref-muted">Stopping reference use does not erase independent chat history. Deletion removes this library entry; source chats, external originals and previously delivered copies are unchanged.</p>`;
      target.querySelector('[name=status]').value = ref.status;
      sharing = mountReferenceSharing(target.querySelector('.mref-sharing-host'), { referenceId: id, resolveTitle: rid => items.find(i => i.id === rid)?.title, onChange: () => load() });
      target.querySelector('[data-edit]').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); try { await mutate(`${ROOT}/${id}`, 'PATCH', { title: f.get('title'), userQuote: f.get('userQuote'), interpretation: f.get('interpretation'), notes: f.get('notes'), status: f.get('status'), relatedIds: f.getAll('relatedIds').map(String) }); await load(); await detail(id); status('Corrections saved.'); } catch (err) { status(err.message, true); } };
      target.querySelector('[data-exclude]').onclick = async () => { try { await mutate(`${ROOT}/${id}`, 'PATCH', { excluded: !ref.excluded }); await load(); await detail(id); } catch (e) { status(e.message, true); } };
      target.querySelector('[data-forget]')?.addEventListener('click', async () => { if (!window.confirm('Exclude this reference and suppress its ENTIRE source chat from future memory searches? Original chat files and information already delivered remain. Use as reference again reverses this.')) return; try { await mutate(`${ROOT}/${id}/forget-source`, 'POST', {}); await load(); await detail(id); } catch (e) { status(e.message, true); } });
      target.querySelector('[data-delete]').onclick = async () => { if (!window.confirm('Delete this saved reference? Source chats and external originals will not be deleted.')) return; try { await mutate(`${ROOT}/${id}`, 'DELETE'); selected = null; target.textContent = 'Reference deleted.'; await load(); } catch (e) { status(e.message, true); } };
      target.querySelector('[data-export]').onclick = async () => { try { const r = await request(`${ROOT}/${id}/export`); const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0)); const blob = new Blob([bytes], { type: 'application/zip' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${ref.title.replace(/[^a-z0-9_-]/gi, '_')}-reference.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); status('Export downloaded with original bytes and reference context.'); } catch (e) { status(e.message, true); } };
      target.querySelector('[data-next]')?.addEventListener('click', e => detail(id, Number(e.currentTarget.dataset.next)));
      target.querySelectorAll('[data-related]').forEach(b => b.onclick = () => detail(b.dataset.related));
      for (const asset of r.assets) {
        const data = await request(`${ROOT}/${id}/assets/${asset.index}`); if (selected !== id || seq !== detailGeneration || !target.isConnected) return;
        const figure = document.createElement('figure'); const img = document.createElement('img'); img.alt = asset.title; img.src = `data:${data.mimeType};base64,${data.base64}`;
        const caption = document.createElement('figcaption'); caption.textContent = asset.title + (asset.timestampSeconds != null ? ` · ${asset.timestampSeconds}s` : ''); figure.append(img, caption); target.querySelector('.mref-previews').append(figure);
      }
      status('');
    } catch (e) { status(e.message, true); }
  }
  tabs.onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; const refs = b.dataset.tab === 'references'; graph.style.display = refs ? 'none' : ''; panel.hidden = !refs; panel.style.display = refs ? 'flex' : 'none'; tabs.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === b))); if (refs) load(); else window.dispatchEvent(new Event('resize')); };
  $('[data-search]').onsubmit = e => { e.preventDefault(); offset = 0; load(); };
  $('[data-prev-page]').onclick = () => { offset = Math.max(0, offset - 50); load(); };
  $('[data-next-page]').onclick = () => { offset += 50; load(); };
  $('.mref-list').onclick = e => { const b = e.target.closest('[data-id]'); if (b) detail(b.dataset.id); };
  $('[data-new]').onclick = () => { $('.mref-new').hidden = false; $('.mref-new [name=title]').focus(); };
  $('[data-cancel]').onclick = () => { $('.mref-new').hidden = true; };
  for (const key of ['capture', 'recall']) $(`[data-${key}]`).onchange = async e => { try { await mutate(`${ROOT}/settings`, 'PATCH', { [key]: e.target.checked }); status('Preference saved.'); } catch (err) { e.target.checked = !e.target.checked; status(err.message, true); } };
  $('.mref-new').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const file = f.get('file'); const body = { title: f.get('title'), userQuote: f.get('userQuote'), content: f.get('content') }; try { if (file?.size) { if (file.size > 20 * 1048576) throw new Error('File exceeds 20 MiB'); body.base64 = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); body.name = file.name; body.mimeType = file.type; } const r = await mutate(ROOT, 'POST', body); e.target.reset(); e.target.hidden = true; await load(); await detail(r.reference.id); } catch (err) { status(err.message, true); } };
}

const DIALOG_BUTTON = 'display:block;width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--prom-border,#444);background:var(--prom-surface-secondary,#202020);color:inherit;cursor:pointer;text-align:left;font:inherit';

// Accessible three-way choice: resolves 'cancel' | 'keep' | 'delete'. Escape and backdrop click cancel.
function askReferenceDeletion(count) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const host = document.createElement('div');
    host.className = 'mref-delete-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55)';
    const noun = count === 1 ? 'reference' : 'references';
    host.innerHTML = `<div role="alertdialog" aria-modal="true" aria-labelledby="mref-delete-title" aria-describedby="mref-delete-desc" style="width:100%;max-width:420px;display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:12px;border:1px solid var(--prom-border,#444);background:var(--prom-surface,#1b1b1b);color:var(--prom-text,#eee)"><h2 id="mref-delete-title" style="margin:0;font-size:17px">Delete this chat?</h2><p id="mref-delete-desc" style="margin:0;font-size:14px;line-height:1.45">This chat has ${count} saved memory ${noun}. Choose what happens to ${count === 1 ? 'it' : 'them'}.</p><div style="display:flex;flex-direction:column;gap:8px"><button type="button" data-choice="cancel" style="${DIALOG_BUTTON}">Cancel, delete nothing</button><button type="button" data-choice="keep" style="${DIALOG_BUTTON}">Delete chat, keep references (default)</button><button type="button" data-choice="delete" style="${DIALOG_BUTTON}">Delete chat and references</button></div></div>`;
    const finish = choice => {
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      if (previous?.focus) previous.focus();
      resolve(choice);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); finish('cancel'); return; }
      if (e.key !== 'Tab') return;
      const buttons = [...host.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i < 0 || i === buttons.length - 1 ? 0 : i + 1);
      e.preventDefault();
      buttons[next].focus();
    };
    host.addEventListener('click', e => {
      const button = e.target.closest?.('[data-choice]');
      if (button) finish(button.dataset.choice);
      else if (e.target === host) finish('cancel');
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(host);
    host.querySelector('[data-choice="keep"]').focus();
  });
}

export async function chooseReferenceDeletion(sessionId) {
  let count = 0;
  try {
    const r = await api(`${ROOT}?sourceSession=${encodeURIComponent(sessionId)}`);
    count = r.items?.length || 0;
  } catch { return 'keep'; } // Retention is the safe default if the library is unavailable.
  if (!count) return 'keep';
  return askReferenceDeletion(count);
}

// Resolves { cancelled: true } without any request when the user cancels; callers must not remove the local chat then.
export async function deleteReferenceSession(id) {
  const choice = await chooseReferenceDeletion(id);
  if (choice === 'cancel') return { cancelled: true };
  const deleteReferences = choice === 'delete';
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}${deleteReferences ? '?deleteReferences=true' : ''}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Delete failed (${res.status})`);
  }
  const body = await res.json().catch(() => ({}));
  if (body.references === 'partial') {
    showToast('Chat deleted, reference cleanup incomplete', body.warning || `${body.referencesRemoved ?? 0} reference(s) removed before cleanup failed. Check Memory → References.`, 'warning', 8000);
  }
  return { cancelled: false, ...body };
}
