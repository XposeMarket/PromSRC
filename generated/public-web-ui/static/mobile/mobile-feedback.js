export function pmToast(message, kind = 'info') {
  const presentation = message && typeof message === 'object'
    ? message
    : { key: '', severity: kind, title: '', summary: String(message || '') };
  const toastText = [presentation.title, presentation.summary].filter(Boolean).join(': ') || 'Status updated.';
  const chatPage = document.getElementById('pm-composer')?.closest?.('.pm-page') || null;
  const composer = document.getElementById('pm-composer');
  let host = document.getElementById('pm-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pm-toast-host';
    host.style.cssText = 'position:fixed;left:0;right:0;bottom:calc(var(--pm-tabbar-h) + env(safe-area-inset-bottom) + 16px);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:9999;pointer-events:none;';
    document.body.appendChild(host);
  }
  if (composer) {
    const composerTop = Number(composer.getBoundingClientRect?.().top || 0);
    if (composerTop > 0) host.style.bottom = `${Math.max(20, window.innerHeight - composerTop + 12)}px`;
  }
  chatPage?.classList.add('pm-toast-priority-active');
  const toastKey = String(presentation.key || '').trim();
  const existing = toastKey
    ? [...host.children].find((node) => String(node?.dataset?.pmToastKey || '') === toastKey)
    : null;
  const removeToast = (node) => {
    node?.remove?.();
    if (!host.childElementCount) chatPage?.classList.remove('pm-toast-priority-active');
  };
  if (existing) {
    const count = Math.max(1, Number(existing.dataset.pmToastCount || 1)) + 1;
    existing.dataset.pmToastCount = String(count);
    existing.textContent = `${toastText} (${count}x)`;
    clearTimeout(Number(existing.dataset.pmToastTimer || 0));
    existing.dataset.pmToastTimer = String(setTimeout(() => removeToast(existing), 2600));
    return;
  }
  const toast = document.createElement('div');
  const severity = String(presentation.severity || kind || 'info');
  const background = severity === 'error' ? '#a8322b' : severity === 'success' ? '#247b4c' : severity === 'warning' ? '#70511c' : '#221a14';
  toast.dataset.pmToastKey = toastKey;
  toast.dataset.pmToastCount = '1';
  toast.setAttribute('role', severity === 'error' ? 'alert' : 'status');
  toast.style.cssText = `background:${background};color:#fff;padding:9px 14px;border-radius:16px;font-size:13px;font-weight:650;line-height:1.35;box-shadow:0 8px 24px rgba(0,0,0,.22);max-width:min(88vw,420px);text-align:center;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;`;
  toast.textContent = toastText;
  host.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  const dismiss = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => removeToast(toast), 220);
  }, 2600);
  toast.dataset.pmToastTimer = String(dismiss);
}

try { window.pmToast = pmToast; } catch {}
