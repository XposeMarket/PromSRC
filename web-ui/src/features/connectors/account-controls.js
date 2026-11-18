import { el, postJson } from '../secure-access/secure-access-core.js';
/** Shared desktop/mobile account list. Host provides lifecycle actions; never embeds credentials. */
export function renderPluginAccounts(host, accounts, { fetchJson, onSelect, onAdd, onReauth, onChanged } = {}) {
  host.replaceChildren();
  const heading = el('h3', { text: 'Connected accounts' }); host.append(heading);
  const status = el('p', { class: 'sa-muted', 'aria-live': 'polite' }); host.append(status);
  const invoke = async (button, action) => {
    button.disabled = true; status.textContent = '';
    try { await action(); } catch { status.textContent = 'Account action failed. No other account was selected.'; }
    finally { button.disabled = false; }
  };
  for (const account of accounts) {
    const row = el('section', { class: 'sa-account-row' });
    Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '12px 0' });
    const label = el('input', { type: 'text', value: account.label, 'aria-label': `Name for ${account.label}`, maxlength: '256' });
    Object.assign(label.style, { minWidth: '0', flex: '1 1 160px' }); row.append(label);
    row.append(el('span', { text: account.account?.email || account.account?.username || account.authState, class: 'sa-muted' }));
    const addButton = (text, action) => { const button=el('button',{type:'button',class:'sa-btn',text});button.onclick=()=>invoke(button,action);row.append(button);return button; };
    addButton('Rename', async()=>{await postJson(fetchJson,`/api/plugin-accounts/${encodeURIComponent(account.id)}/rename`,{label:label.value},'Rename account');onChanged?.();});
    if(onSelect) addButton('Select',()=>onSelect(account.id));
    if(onReauth) addButton('Reconnect',()=>onReauth(account.id));
    addButton('Disconnect', async()=>{
      if(row.querySelector('[data-account-disconnect-confirm]'))return;
      const confirm=el('button',{type:'button',class:'sa-btn',text:`Confirm disconnect ${account.label}`,'data-account-disconnect-confirm':'true'});
      confirm.onclick=()=>invoke(confirm,async()=>{await postJson(fetchJson,`/api/plugin-accounts/${encodeURIComponent(account.id)}/disconnect`,{},`Disconnect ${account.label}`);onChanged?.();});
      row.append(confirm);confirm.focus();
    });
    host.append(row);
  }
  if(!accounts.length) status.textContent='No accounts connected.';
  if(onAdd){const add=el('button',{type:'button',class:'sa-btn sa-pri',text:'Add account'});add.onclick=()=>invoke(add,onAdd);host.append(add);}
}
