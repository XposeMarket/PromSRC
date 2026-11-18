import { el, postJson, ensureSecureAccessStyles } from '../secure-access/secure-access-core.js';
import { renderPluginAccounts } from './account-controls.js';
import { openConnectFlow } from './connect-flow.js';

/** Shared responsive controller. Selected IDs are explicit per use, never a global default. */
export async function openPluginAccountManager(fetchJson, serviceId, { onSelect, onChanged } = {}) {
  ensureSecureAccessStyles();
  const previous = document.activeElement;
  const overlay = el('div', { class: 'sa-connect-overlay' });
  Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '10030', background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: '16px' });
  const panel = el('section', { class: 'sa-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Plugin accounts', tabindex: '-1' });
  Object.assign(panel.style, { width: 'min(640px,100%)', maxHeight: '85dvh', overflowY: 'auto', padding: '20px', boxSizing: 'border-box', background: 'var(--panel,Canvas)', color: 'var(--text,CanvasText)' });
  const content = el('div');
  const error = el('p', { 'aria-live': 'polite' });
  const done = el('button', { type: 'button', class: 'sa-btn', text: 'Done' });
  let closed = false;
  const close = () => { if (closed) return; closed = true; overlay.remove(); previous?.focus?.(); };
  done.onclick = close;
  panel.append(content, error, done); overlay.append(panel); document.body.append(overlay); panel.focus();
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
    if (!nodes.length) { event.preventDefault(); panel.focus(); return; }
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
  });
  async function refresh() {
    if (closed) return;
    content.textContent = 'Loading accounts…';
    try {
      const result = await postJson(fetchJson, '/api/plugin-accounts/list', {}, 'List plugin accounts');
      if (closed) return;
      const accounts = (result.accounts || []).filter(account => account.serviceId === serviceId);
      const addTemplate = accounts.find(account => account.canAddAccount === true);
      renderPluginAccounts(content, accounts, { fetchJson,
        onSelect: onSelect ? id => { onSelect(id); close(); } : undefined,
        onReauth: id => openConnectFlow(fetchJson, { serviceId, connectionId: id }, { onChanged: refresh }),
        onChanged: async () => { await refresh(); onChanged?.(); },
        onAdd: addTemplate ? () => add(addTemplate) : (result.creatableServices || []).includes(serviceId) ? () => add(null) : undefined,
      });
      error.textContent = !addTemplate && accounts.length ? (accounts[0].addAccountUnavailableReason || 'Adding another account is not available for this plugin yet.') : '';
    } catch { error.textContent = 'Accounts could not be loaded. No account has been selected or changed.'; }
  }
  async function add(template) {
    const existing = content.querySelector('[data-account-add-form]');
    if (existing) { existing.querySelector('input')?.focus(); return; }
    const form = el('form', { 'data-account-add-form': 'true' });
    const name = el('input', { type: 'text', required: 'true', maxlength: '256', 'aria-label': 'New account name', placeholder: 'Business account' });
    const submit = el('button', { type: 'submit', class: 'sa-btn', text: 'Continue to sign in' });
    const cancel = el('button', { type: 'button', class: 'sa-btn', text: 'Cancel' });
    cancel.onclick = () => { form.remove(); };
    form.append(name, submit, cancel); content.append(form); name.focus();
    form.onsubmit = async event => {
      event.preventDefault(); if (!name.value.trim()) return; submit.disabled = true;
      try {
        const result = await postJson(fetchJson, template ? `/api/plugin-accounts/${encodeURIComponent(template.id)}/add` : '/api/plugin-accounts/create', { label: name.value.trim(), ...(template ? {} : { serviceId }) }, 'Add account');
        form.remove();
        await openConnectFlow(fetchJson, { serviceId, connectionId: result.account.id, attemptId: result.attempt.id }, { onChanged: refresh });
        await refresh();
      } catch { error.textContent = 'Setup did not finish. Refresh the account list before retrying; a new pending account may have been created.'; }
      finally { submit.disabled = false; }
    };
  }
  await refresh();
  return { close, refresh };
}

/** Open the account picker only when this plugin already has managed identities. */
export async function openExistingPluginAccounts(fetchJson, serviceId, options = {}) {
  const result = await postJson(fetchJson, '/api/plugin-accounts/list', {}, 'List plugin accounts');
  if (!(result.accounts || []).some(account => account.serviceId === serviceId)) {
    if (options.managedOnly) return false;
    const legacy = result.canManageLegacyAccounts === false ? { accounts: [] } : await postJson(fetchJson, '/api/plugin-accounts/legacy-list', {}, 'Find existing login');
    const account = (legacy.accounts || []).find(item => item.serviceId === serviceId);
    if (!account) {
      if (!(result.creatableServices || []).includes(serviceId)) return false;
      await openPluginAccountManager(fetchJson,serviceId,options);return true;
    }
    ensureSecureAccessStyles();
    const overlay = el('div', { class: 'sa-connect-overlay' });
    Object.assign(overlay.style, { position:'fixed',inset:'0',zIndex:'10030',display:'grid',placeItems:'center',padding:'16px',background:'rgba(0,0,0,.45)' });
    const panel = el('section', { class:'sa-card',role:'dialog','aria-modal':'true','aria-label':'Keep existing account' });
    Object.assign(panel.style,{padding:'20px',width:'min(460px,100%)',boxSizing:'border-box',background:'var(--panel,Canvas)',color:'var(--text,CanvasText)'});
    panel.append(el('h3',{text:'Keep your existing account'}),el('p',{text:`Keep ${account.account?.email || account.label} connected, then add another account separately.`}));
    const keep=el('button',{type:'button',class:'sa-btn sa-pri',text:'Keep account and continue'});
    const cancel=el('button',{type:'button',class:'sa-btn',text:'Cancel'});
    const error=el('p',{'aria-live':'polite'});
    const previous=document.activeElement;
    const close=()=>{overlay.remove();previous?.focus?.();};
    cancel.onclick=close;
    panel.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const nodes=[...panel.querySelectorAll('button:not(:disabled)')];
        if(event.shiftKey && document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1)?.focus();}
        else if(!event.shiftKey && document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0]?.focus();}
      }
    });
    keep.onclick=async()=>{keep.disabled=true;try{
      await postJson(fetchJson,`/api/plugin-accounts/${encodeURIComponent(account.id)}/adopt`,{},'Keep existing account');
      overlay.remove();await openPluginAccountManager(fetchJson,serviceId,options);
    }catch{error.textContent='Could not prepare this account. Your existing login has not been disconnected.';keep.disabled=false;}};
    panel.append(keep,cancel,error);overlay.append(panel);document.body.append(overlay);keep.focus();
    return true;
  }
  await openPluginAccountManager(fetchJson, serviceId, options);
  return true;
}
