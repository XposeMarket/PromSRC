// Approved desktop C: textarea above a quiet footer. Reuse the actual controls,
// including their handlers, rather than duplicate send, dictation or attachments.
let restore = null;
export function mountMinimalAgentComposer(enabled) {
  if (!enabled) { restore?.(); restore = null; return; }
  const area = document.querySelector('#chat-view .chat-input-area');
  if (!area || !enabled || area.classList.contains('ea-minimal-composer')) return;
  const row = area.querySelector('.chat-input-row');
  const footer = area.querySelector('.agent-toggle');
  const send = document.getElementById('send-btn');
  if (!row || !footer || !send) return;
  const moved = [];
  const remember = (element) => { const marker = document.createComment('composer-control'); element.before(marker); moved.push([element, marker]); };
  area.classList.add('ea-minimal-composer');
  const more = document.createElement('div');
  more.className = 'ea-composer-more';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'ea-composer-plus'; toggle.textContent = '+';
  toggle.title = 'Add to this chat'; toggle.setAttribute('aria-label', 'Add to this chat'); toggle.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'ea-composer-add-menu'; menu.hidden = true;
  const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); });
  for (const [selector, label] of [['.chat-attach-btn', 'Attach files or photos'], ['#chat-voice-btn', 'Dictate message']]) {
    const control = row.querySelector(selector);
    if (!control) continue;
    remember(control);
    const text = document.createElement('span'); text.className = 'ea-control-label'; text.textContent = label;
    control.appendChild(text); menu.appendChild(control);
    control.addEventListener('click', close);
  }
  const project = document.createElement('button');
  project.type = 'button'; project.textContent = 'Project';
  project.addEventListener('click', () => { close(); document.getElementById('chat-new-context-trigger')?.click(); });
  menu.appendChild(project);
  const computer = document.createElement('div');
  computer.className = 'ea-composer-computer'; computer.textContent = 'Computer: this gateway';
  computer.title = 'Connected computers are a separate feature. Agents here run on this gateway.';
  menu.appendChild(computer);
  more.append(toggle, menu); footer.insertBefore(more, footer.firstChild);
  remember(send); footer.appendChild(send);
  const dock = document.getElementById('chat-new-context-dock');
  if (dock && area.parentElement) { remember(dock); area.after(dock); dock.classList.add('ea-composer-caption'); }
  const dismiss = (event) => { if (!more.contains(event.target)) close(); };
  document.addEventListener('pointerdown', dismiss);
  restore = () => {
    document.removeEventListener('pointerdown', dismiss);
    for (const [element, marker] of moved) {
      element.querySelector('.ea-control-label')?.remove();
      element.removeEventListener('click', close);
      marker.replaceWith(element);
    }
    more.remove(); dock?.classList.remove('ea-composer-caption'); area.classList.remove('ea-minimal-composer');
  };
  more.addEventListener('keydown', (event) => { if (event.key === 'Escape') { close(); toggle.focus(); } });
}
