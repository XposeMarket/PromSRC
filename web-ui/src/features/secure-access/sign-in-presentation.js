// Presentation only. No transport, credential state or authorization decisions.
export const SIGN_IN_CSS = `
.sa-login{--sa-surface:var(--prom-surface,var(--pm-surface,var(--bg-secondary,Canvas)));--sa-ink:var(--prom-text,var(--text-primary,CanvasText));color:var(--sa-ink);font-family:var(--font-sans,system-ui,sans-serif);width:100%;max-width:460px}
.sa-login-launch{padding:20px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:24px;background:var(--sa-surface);display:grid;gap:18px}
.sa-login-identity{display:flex;gap:12px;align-items:flex-start;min-width:0}.sa-login-identity>div{min-width:0}.sa-login-identity h3{margin:0 0 5px;font-size:18px;line-height:1.3}.sa-login-origin{margin:0;font-size:13px;opacity:.72;overflow-wrap:anywhere}
.sa-login-icon{width:24px;height:24px;flex:none}.sa-login-launch .sa-row{flex-wrap:nowrap}.sa-login button{font:inherit;cursor:pointer}.sa-login .sa-btn{min-height:49px;border-radius:28px}.sa-login .sa-pri{background:var(--sa-ink);color:var(--sa-surface);border-color:transparent}.sa-login-launch .sa-btn{border:1px solid color-mix(in srgb,currentColor 20%,transparent);padding:10px 20px;background:transparent;color:inherit}.sa-login-launch .sa-pri{background:var(--sa-ink);color:var(--sa-surface)}
.sa-login-dialog{color:var(--sa-ink);background:var(--sa-surface);border:1px solid color-mix(in srgb,currentColor 12%,transparent);border-radius:32px;padding:0;width:min(440px,calc(100% - 16px));max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain}.sa-login-dialog::backdrop{background:rgb(0 0 0 / .6)}
.sa-login-dialog .sa-card{border:0;background:transparent;max-width:none;padding:28px 22px 22px;gap:20px;color:inherit;width:100%}.sa-login-dialog .sa-hd{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;position:relative}.sa-login-dialog .sa-hd>svg{width:28px;height:28px;color:inherit;margin:8px}.sa-login-dialog .sa-hd h3{font-size:23px;font-weight:650}.sa-login-dialog .sa-hd p{margin-top:7px}.sa-login-dialog .sa-badge{border:0;padding:0;font-size:11px}.sa-login-dialog .sa-form{gap:16px}.sa-login-dialog .sa-lbl{margin:0 0 3px 4px;font-weight:500}.sa-login-dialog .sa-input{min-height:54px;border-radius:17px;font-size:16px;padding:12px 16px}.sa-login-dialog .sa-inrow{position:relative}.sa-login-dialog .sa-inrow .sa-input{padding-right:52px}.sa-login-dialog .sa-reveal{position:absolute;right:5px;top:5px;width:44px;min-height:44px;padding:10px;border:0;background:transparent}.sa-reveal svg{width:22px;height:22px}
.sa-login-dialog .sa-row{flex-direction:column;gap:10px}.sa-login-dialog .sa-row>.sa-btn{flex:auto;width:100%}.sa-login-dialog .sa-row>.sa-btn:not(.sa-pri){background:color-mix(in srgb,currentColor 8%,transparent);border-color:transparent}.sa-login-dialog details{border:0;padding:0;color:var(--sa-m)}.sa-login-dialog summary{font-weight:500}.sa-login-dialog .sa-remember{border:0;padding:0;justify-content:flex-start;align-items:flex-start;gap:10px;font-size:14px}.sa-login-dialog .sa-remember .sa-knob{order:-1;width:19px;height:19px;border-radius:5px;margin-top:2px}.sa-login-dialog .sa-remember .sa-knob::after{display:none}.sa-login-dialog .sa-remember[aria-checked=true] .sa-knob{background:var(--sa-ink);color:var(--sa-surface)}.sa-login-dialog .sa-remember[aria-checked=true] .sa-knob::after{display:block;content:'✓';position:static;background:none;width:auto;height:auto;text-align:center;font-size:14px;line-height:18px;color:var(--sa-surface)}.sa-login-dialog .sa-remember strong{font-weight:500}.sa-login-dialog .sa-remember .sa-muted{font-size:11px;line-height:1.5}.sa-login-privacy{text-align:center;font-size:12px;color:var(--sa-m);line-height:1.6}.sa-login-dismiss{position:absolute;right:12px;top:10px;display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:24px;background:transparent;color:inherit;font-size:24px!important}.sa-login-dialog .sa-input:focus-visible{outline-color:var(--sa-ink)}.sa-login-dialog .sa-remember strong{font-weight:500}.sa-login button:focus-visible{outline:2px solid currentColor;outline-offset:3px}.sa-login [hidden]{display:none!important}
@media(max-width:699px){.sa-login-dialog{margin:auto auto max(8px,env(safe-area-inset-bottom));max-height:calc(100dvh - 16px);padding-bottom:env(safe-area-inset-bottom)}}
@media(prefers-reduced-motion:reduce){.sa-login *{transition:none!important}}
`;

export function signInIcon(kind = 'globe') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'aria-hidden': 'true', class: 'sa-login-icon' })) svg.setAttribute(key, value);
  const paths = kind === 'eye' ? ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'] : ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M3 12h18', 'M12 3c5 5 5 13 0 18-5-5-5-13 0-18'];
  for (const d of paths) { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.appendChild(p); }
  return svg;
}

export function presentSignIn(card, { origin, title = 'Sign in to continue', onDismiss, onSkip } = {}) {
  const make = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
  const root = make('div', 'sa-login');
  const launcher = make('section', 'sa-login-launch');
  const identity = make('div', 'sa-login-identity');
  const heading = make('div', ''); heading.append(make('h3', '', title), make('p', 'sa-login-origin', origin));
  identity.append(signInIcon(), heading);
  const actions = make('div', 'sa-row');
  const open = make('button', 'sa-btn sa-pri', 'Continue'); open.type = 'button'; open.setAttribute('aria-haspopup', 'dialog');
  const skip = make('button', 'sa-btn', 'Skip'); skip.type = 'button';
  actions.append(open, skip); launcher.append(identity, actions);
  const dialog = make('dialog', 'sa-login-dialog'); dialog.setAttribute('aria-label', title);
  const close = make('button', 'sa-login-dismiss', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close sign-in');
  dialog.append(card, close); root.append(launcher, dialog);
  let ended = false;
  const viewport = globalThis.visualViewport;
  const fit = () => {
    if (!dialog.open) return;
    const height = viewport?.height || innerHeight;
    dialog.style.maxHeight = Math.max(120, height - 24) + 'px';
    if (innerWidth < 700) dialog.style.bottom = Math.max(0, innerHeight - height - (viewport?.offsetTop || 0)) + 'px';
  };
  viewport?.addEventListener('resize', fit);
  viewport?.addEventListener('scroll', fit);
  const cleanup = () => { viewport?.removeEventListener('resize', fit); viewport?.removeEventListener('scroll', fit); };
  const dismiss = () => { onDismiss?.(); if (dialog.open) dialog.close(); };
  open.addEventListener('click', () => { if (!ended) { dialog.showModal(); fit(); } });
  skip.addEventListener('click', () => onSkip?.());
  close.addEventListener('click', dismiss);
  dialog.addEventListener('close', () => { onDismiss?.(); if (!ended && open.isConnected) open.focus(); });
  dialog.addEventListener('cancel', () => onDismiss?.());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button, input, summary, a[href], [tabindex]')].filter(n => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  return {
    el: root,
    submitted() { skip.hidden = true; open.textContent = 'Check sign-in'; },
    finish() { ended = true; cleanup(); dismiss(); root.replaceChildren(card); },
    destroy() { ended = true; cleanup(); dismiss(); root.remove(); },
  };
}
