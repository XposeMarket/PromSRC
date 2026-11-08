// Reference sharing: explicit existing-team grants and collection membership.
// Exports:
//   mountReferenceSharing(host, { referenceId?, onChange? }) -> { refresh(), destroy() }
//     referenceId set: sharing panel for one reference (direct grants, collection membership).
//     referenceId omitted: collection overview (create/edit/delete, member removal, collection grants).
//   mountCollectionOverview(host, { onChange? }) -> same return value.
//   summarizeReferenceAudience(state, referenceId), summarizeCollectionAudience(state, collectionId): pure helpers.
// All requests go through the shared api() helper under /api/memory/reference-sharing.
import { api } from '../api.js';
import { escHtml as esc } from '../utils.js';

export const SHARING_ROOT = '/api/memory/reference-sharing';
const STYLE_ID = 'mrs-style';
const css = '.mrs{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--border,#444);margin-top:12px;padding-top:12px}.mrs h4{margin:4px 0 0;font-size:14px}.mrs-audience{font-size:13px}.mrs button{border:1px solid var(--border,#444);border-radius:9px;background:var(--bg-secondary,#202020);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}.mrs button:disabled{opacity:.5;cursor:default}.mrs .mrs-danger{color:#ff8a80}.mrs input:not([type=checkbox]),.mrs textarea,.mrs select{background:var(--bg-primary,#151515);color:inherit;border:1px solid var(--border,#444);border-radius:8px;padding:7px;font:inherit;max-width:100%}.mrs label{display:flex;flex-direction:column;gap:4px;font-size:13px}.mrs form{display:flex;flex-direction:column;gap:8px}.mrs-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.mrs-row label{flex-direction:row;align-items:center}.mrs-item{border:1px solid var(--border,#333);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px}.mrs-confirm{border:1px solid var(--accent,#d6b35b);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}.mrs-muted{opacity:.75;font-size:12px}@media (max-width:640px){.mrs-row{flex-direction:column;align-items:stretch}}';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css + REQUIRED_CSS;
  document.head.append(style);
}

const REQUIRED_CSS = '.mrs .mrs-check{flex-direction:row;align-items:center;gap:6px}.mrs-required{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:6px;background:#5a3b00;color:#ffd27a;font-size:12px;font-weight:600}';
export const REQUIRED_LABEL = 'Required for every task in this team';

const teamName = (state, id) => (state.teams || []).find(team => team.id === id)?.name || id;

export function summarizeReferenceAudience(state, referenceId) {
  const grants = state.grants || [];
  const collections = state.collections || [];
  const direct = grants
    .filter(g => g.targetKind === 'reference' && g.targetId === referenceId)
    .map(g => ({ grantId: g.id, teamId: g.teamId, teamName: teamName(state, g.teamId), required: g.required === true, purpose: g.purpose || '' }));
  const memberOf = collections.filter(c => (c.members || []).includes(referenceId));
  const viaCollections = memberOf.flatMap(c => grants
    .filter(g => g.targetKind === 'collection' && g.targetId === c.id)
    .map(g => ({ grantId: g.id, collectionId: c.id, collectionTitle: c.title, teamId: g.teamId, teamName: teamName(state, g.teamId), required: g.required === true, purpose: g.purpose || '' })));
  return { direct, viaCollections, memberOf, isPrivate: direct.length === 0 && viaCollections.length === 0 };
}

export function summarizeCollectionAudience(state, collectionId) {
  const collection = (state.collections || []).find(c => c.id === collectionId) || null;
  const grants = (state.grants || [])
    .filter(g => g.targetKind === 'collection' && g.targetId === collectionId)
    .map(g => ({ grantId: g.id, teamId: g.teamId, teamName: teamName(state, g.teamId), required: g.required === true, purpose: g.purpose || '' }));
  return { collection, grants, isPrivate: grants.length === 0 };
}

export function mountReferenceSharing(host, options = {}) {
  if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('mountReferenceSharing requires a host element');
  const referenceId = options.referenceId ? String(options.referenceId) : '';
  const notify = typeof options.onChange === 'function' ? options.onChange : () => {};
  injectStyle();
  const root = document.createElement('section');
  root.className = 'mrs';
  root.setAttribute('aria-label', referenceId ? 'Reference sharing' : 'Collections and team sharing');
  host.replaceChildren(root);
  let state = { teams: [], collections: [], grants: [] };
  let writable = false; let loaded = false; let generation = 0; let destroyed = false; let busy = false; let pending = null;
  let note = ''; let noteFailure = false;

  const request = async (url, init) => { const r = await api(url, init); if (r?.success === false) throw new Error(r.error || 'Sharing request failed'); return r; };
  const mutate = (url, method, body) => request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const setNote = (text, failure = false) => { note = text; noteFailure = failure; };
  const enc = encodeURIComponent;

  const actions = {
    // required is only true after the explicit confirmation step; ordinary shares always send required:false.
    'share-reference': p => mutate(`${SHARING_ROOT}/grants`, 'POST', { teamId: p.teamId, targetKind: 'reference', targetId: p.targetId, required: p.required === true, purpose: p.purpose || '' }),
    'share-collection': p => mutate(`${SHARING_ROOT}/grants`, 'POST', { teamId: p.teamId, targetKind: 'collection', targetId: p.targetId, required: p.required === true, purpose: p.purpose || '' }),
    'revoke': p => mutate(`${SHARING_ROOT}/grants/${enc(p.grantId)}`, 'DELETE'),
    'delete-collection': p => mutate(`${SHARING_ROOT}/collections/${enc(p.collectionId)}`, 'DELETE'),
    'create-collection': p => mutate(`${SHARING_ROOT}/collections`, 'POST', { title: p.title, purpose: p.purpose }),
    'update-collection': p => mutate(`${SHARING_ROOT}/collections/${enc(p.collectionId)}`, 'PATCH', { title: p.title, purpose: p.purpose }),
    'set-member': p => mutate(`${SHARING_ROOT}/collections/${enc(p.collectionId)}/members`, 'POST', { referenceId: p.referenceId, add: p.add === true, acknowledgeSharedAudience: p.acknowledgeSharedAudience === true }),
  };

  // Stale responses are dropped: only the newest GET may replace the view.
  async function load() {
    const seq = ++generation;
    try {
      const r = await request(SHARING_ROOT);
      if (destroyed || seq !== generation) return false;
      state = { teams: r.teams || [], collections: r.collections || [], grants: r.grants || [] };
      writable = r.writable === true; loaded = true;
      render();
      return true;
    } catch (err) {
      if (!destroyed && seq === generation) { setNote(err.message, true); render(); }
      return false;
    }
  }

  async function run(action, payload, success) {
    if (busy || !writable || destroyed) return;
    busy = true; render();
    let ok = false;
    try { await actions[action](payload); ok = true; setNote(success); }
    catch (err) { setNote(err.message, true); }
    pending = null; busy = false;
    await load();
    if (ok && !destroyed) notify();
  }

  const draft = { title: '', purpose: '' };
  const titleOf = id => (typeof options.resolveTitle === 'function' && options.resolveTitle(id)) || `Reference ${String(id).slice(0, 8)}`;
  const namesOf = grants => grants.map(g => g.teamName).join(', ');

  function teamPicker(key) {
    if (!state.teams.length) return '<span class="mrs-muted">No teams yet. Create a team first; sharing only goes to existing teams.</span>';
    const dis = writable && !busy ? '' : 'disabled';
    const options = state.teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    return `<label>Team (existing teams only)<select data-team-for="${esc(key)}" ${dis}>${options}</select></label>`;
  }

  function shareControls(kind, targetId, grants) {
    const dis = writable && !busy ? '' : 'disabled';
    const key = kind + ':' + targetId;
    const list = grants.map(g => `<div class="mrs-item" data-grant-row="${esc(g.grantId)}"><span>Shared with <strong>${esc(g.teamName)}</strong>${g.required ? `<span class="mrs-required" data-required-grant="${esc(g.grantId)}">${REQUIRED_LABEL}</span>` : ''}</span>${g.purpose ? `<span class="mrs-muted">Purpose: ${esc(g.purpose)}</span>` : ''}<button type="button" data-act="revoke" data-grant="${esc(g.grantId)}" ${dis}>${g.required ? 'Stop sharing (removes requirement)' : 'Stop sharing'}</button></div>`).join('');
    const ctl = !state.teams.length || dis ? 'disabled' : '';
    const pend = pending && pending.kind === 'required' && pending.key === key ? pending : null;
    const what = kind === 'collection' ? 'this collection and every reference in it' : 'this reference';
    const confirm = pend ? confirmBlock('required', `Every task that ${teamName(state, pend.teamId)} runs will receive ${what}, not only tasks where it looks relevant. Audience: ${teamName(state, pend.teamId)} (all members working on its tasks).${pend.purpose ? ` Purpose: ${pend.purpose}.` : ''} Stop sharing later to remove the requirement. Evidence already delivered cannot be unsent.`, `<button type="button" data-act="confirm-required" ${dis}>Share as required for every task</button>`) : '';
    return `${list}<div class="mrs-row">${teamPicker(key)}<label>Purpose (optional)<input data-purpose-for="${esc(key)}" maxlength="500" placeholder="Why this team needs it" ${ctl}></label><label class="mrs-check"><input type="checkbox" data-required-for="${esc(key)}" ${ctl}> ${REQUIRED_LABEL}</label><button type="button" data-act="share" data-kind="${esc(kind)}" data-target="${esc(targetId)}" ${ctl}>Share with team</button></div>${confirm}<div class="mrs-muted">Ordinary sharing is optional: the team uses it only when relevant. Stop sharing blocks future reads. Evidence already delivered to a team cannot be unsent.</div>`;
  }

  function confirmBlock(kind, teamsText, actionHtml) {
    return `<div class="mrs-confirm" role="alertdialog" aria-label="${esc(kind)}"><strong>${kind === 'add' ? 'Add to a shared collection?' : kind === 'required' ? 'Require for every task in this team?' : 'Delete collection?'}</strong><div>${esc(teamsText)}</div><div class="mrs-row">${actionHtml}<button type="button" data-act="cancel">Cancel</button></div></div>`;
  }

  function renderReference() {
    const dis = writable && !busy ? '' : 'disabled';
    const a = summarizeReferenceAudience(state, referenceId);
    const audience = a.isPrivate
      ? '<strong>Private.</strong> Only you can see this reference. No team has access.'
      : `<strong>Shared with:</strong> ${esc([...a.direct.map(g => g.teamName), ...a.viaCollections.map(g => `${g.teamName} (via “${g.collectionTitle}”)`)].join(', '))}`;
    const pendingAdd = pending && pending.kind === 'add' && pending.referenceId === referenceId ? pending : null;
    const pendingCollection = pendingAdd ? state.collections.find(c => c.id === pendingAdd.collectionId) : null;
    const pendingGrants = pendingCollection ? state.grants.filter(g => g.targetKind === 'collection' && g.targetId === pendingCollection.id).map(g => ({ teamName: teamName(state, g.teamId) })) : [];
    const confirm = pendingAdd && pendingCollection ? confirmBlock('add', `Adding this reference to “${pendingCollection.title}” shares it with: ${namesOf(pendingGrants)}. They receive it right away. Stopping later does not unsend what they already received.`, `<button type="button" data-act="confirm-add" data-collection="${esc(pendingAdd.collectionId)}" data-ref="${esc(referenceId)}" ${dis}>Add and share</button>`) : '';
    const memberships = state.collections.map(c => {
      const cGrants = state.grants.filter(g => g.targetKind === 'collection' && g.targetId === c.id).map(g => ({ teamName: teamName(state, g.teamId) }));
      const checked = (c.members || []).includes(referenceId);
      return `<div class="mrs-item"><label class="mrs-check"><input type="checkbox" data-member="${esc(c.id)}" data-ref="${esc(referenceId)}" ${checked ? 'checked' : ''} ${dis}> ${esc(c.title)}</label><span class="mrs-muted">${cGrants.length ? 'Shared with ' + esc(namesOf(cGrants)) : 'Private collection'}</span></div>`;
    }).join('');
    return `<h4>Sharing</h4><div class="mrs-audience" role="status">${audience}</div>${shareControls('reference', referenceId, a.direct)}<h4>Collections</h4>${memberships || '<span class="mrs-muted">No collections yet.</span>'}${confirm}`;
  }

  function renderCollections() {
    const dis = writable && !busy ? '' : 'disabled';
    const createForm = `<div class="mrs-item"><strong>New collection</strong><label>Title<input data-draft="title" maxlength="200" value="${esc(draft.title)}" ${dis}></label><label>Purpose<textarea data-draft="purpose" ${dis}>${esc(draft.purpose)}</textarea></label><div class="mrs-row"><button type="button" data-act="create" ${dis}>Create collection</button></div></div>`;
    const cards = state.collections.map(c => {
      const cAud = summarizeCollectionAudience(state, c.id);
      const audience = cAud.isPrivate ? 'Private collection. No team has access.' : `Shared with: ${namesOf(cAud.grants)}`;
      const pendingDelete = pending && pending.kind === 'delete' && pending.collectionId === c.id;
      const members = (c.members || []).map(id => `<div class="mrs-item"><span>${esc(titleOf(id))}</span><button type="button" data-act="remove-member" data-collection="${esc(c.id)}" data-ref="${esc(id)}" ${dis}>Remove from collection</button></div>`).join('') || '<span class="mrs-muted">No references yet. Add them from a reference’s Sharing panel.</span>';
      const deleteBlock = pendingDelete
        ? confirmBlock('delete', `Delete “${c.title}”? References are not deleted. Teams lose access through this collection. Evidence already delivered cannot be unsent.`, `<button type="button" class="mrs-danger" data-act="confirm-delete" data-collection="${esc(c.id)}" ${dis}>Delete collection</button>`)
        : `<div class="mrs-row"><button type="button" class="mrs-danger" data-act="ask-delete" data-collection="${esc(c.id)}" ${dis}>Delete collection</button></div>`;
      return `<div class="mrs-item"><strong>${esc(c.title)}</strong><div class="mrs-audience">${esc(audience)}</div><label>Title<input data-edit-title="${esc(c.id)}" value="${esc(c.title)}" ${dis}></label><label>Purpose<textarea data-edit-purpose="${esc(c.id)}" ${dis}>${esc(c.purpose || '')}</textarea></label><div class="mrs-row"><button type="button" data-act="save" data-collection="${esc(c.id)}" ${dis}>Save changes</button></div><h4>References (${(c.members || []).length})</h4>${members}<h4>Team sharing</h4>${shareControls('collection', c.id, cAud.grants)}${deleteBlock}</div>`;
    }).join('');
    return `<h4>Collections</h4>${createForm}${cards || '<span class="mrs-muted">No collections yet.</span>'}`;
  }

  function render() {
    if (destroyed) return;
    if (!loaded) { root.innerHTML = `<p class="mrs-muted">${note ? esc(note) : 'Loading sharing…'}</p>`; return; }
    const readOnly = writable ? '' : '<div class="mrs-muted">Read-only: another gateway owns the reference library. Sharing changes are disabled here.</div>';
    const status = note ? `<div class="mrs-muted" role="status"${noteFailure ? ' style="color:#ff8a80"' : ''}>${esc(note)}</div>` : '';
    root.innerHTML = `${readOnly}${status}${referenceId ? renderReference() : renderCollections()}`;
  }

  const fail = msg => { setNote(msg, true); render(); };
  const onInput = e => {
    const key = e.target.dataset?.draft;
    if (key) draft[key] = e.target.value;
  };
  const onChange = e => {
    const el = e.target;
    if (!el.dataset?.member || busy || !writable) return;
    const collectionId = el.dataset.member; const refId = el.dataset.ref;
    if (el.checked) {
      const shared = state.grants.some(g => g.targetKind === 'collection' && g.targetId === collectionId);
      if (shared) { // Never add silently to a shared collection: show recipient audience and ask.
        pending = { kind: 'add', collectionId, referenceId: refId };
        render();
        return;
      }
      run('set-member', { collectionId, referenceId: refId, add: true, acknowledgeSharedAudience: false }, 'Added to collection.');
    } else {
      run('set-member', { collectionId, referenceId: refId, add: false, acknowledgeSharedAudience: false }, 'Removed from collection.');
    }
  };
  const onClick = async e => {
    const btn = e.target.closest?.('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'cancel') { pending = null; setNote(''); render(); return; }
    if (act === 'share') {
      const row = btn.closest('.mrs-row');
      const teamId = row?.querySelector('select')?.value;
      if (!teamId) return fail('Choose an existing team first.');
      const kind = btn.dataset.kind; const targetId = btn.dataset.target;
      const purpose = (row.querySelector('[data-purpose-for]')?.value || '').trim();
      // Required is never inferred: only the explicit checkbox, then an explicit confirmation, sends required:true.
      if (row.querySelector('[data-required-for]')?.checked === true) {
        pending = { kind: 'required', key: kind + ':' + targetId, shareKind: kind, targetId, teamId, purpose };
        setNote(''); return render();
      }
      return run(kind === 'collection' ? 'share-collection' : 'share-reference', { teamId, targetId, required: false, purpose }, 'Shared with team. Revoking later stops future access only.');
    }
    if (act === 'confirm-required') {
      const p = pending;
      if (!p || p.kind !== 'required') return;
      pending = null;
      return run(p.shareKind === 'collection' ? 'share-collection' : 'share-reference', { teamId: p.teamId, targetId: p.targetId, required: true, purpose: p.purpose }, 'Shared as required for every task in this team. Stop sharing to remove the requirement.');
    }
    if (act === 'revoke') return run('revoke', { grantId: btn.dataset.grant }, 'Sharing stopped. Evidence already delivered to that team cannot be unsent.');
    if (act === 'create') {
      const title = draft.title.trim();
      if (!title) return fail('Enter a collection title.');
      await run('create-collection', { title, purpose: draft.purpose.trim() }, 'Collection created.');
      if (!noteFailure) { draft.title = ''; draft.purpose = ''; render(); }
      return;
    }
    if (act === 'save') {
      const id = btn.dataset.collection;
      const title = root.querySelector(`[data-edit-title="${CSS.escape(id)}"]`)?.value.trim();
      const purpose = root.querySelector(`[data-edit-purpose="${CSS.escape(id)}"]`)?.value.trim() ?? '';
      if (!title) return fail('Collection title cannot be empty.');
      return run('update-collection', { collectionId: id, title, purpose }, 'Collection saved.');
    }
    if (act === 'ask-delete') { pending = { kind: 'delete', collectionId: btn.dataset.collection }; return render(); }
    if (act === 'confirm-delete') { pending = null; return run('delete-collection', { collectionId: btn.dataset.collection }, 'Collection deleted. References were not deleted; teams lose access through it.'); }
    if (act === 'remove-member') return run('set-member', { collectionId: btn.dataset.collection, referenceId: btn.dataset.ref, add: false, acknowledgeSharedAudience: false }, 'Removed from collection.');
    if (act === 'confirm-add') { pending = null; return run('set-member', { collectionId: btn.dataset.collection, referenceId: btn.dataset.ref, add: true, acknowledgeSharedAudience: true }, 'Added and shared with the collection’s teams.'); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('input', onInput);
    if (host.contains(root)) host.replaceChildren();
  }

  render();
  load();
  return { refresh: load, destroy, isWritable: () => writable };
}

export function mountCollectionOverview(host, options = {}) {
  return mountReferenceSharing(host, { ...options, referenceId: undefined });
}
