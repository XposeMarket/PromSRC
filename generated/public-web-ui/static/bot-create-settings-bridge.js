// Keep every desktop Bot creation entry point on the identity-first flow.
// Existing-agent editing remains owned by SettingsPage; only the legacy + New
// action is redirected to the shared Prom Bot creator.

const NEW_BUTTON_SELECTOR = '.settings-agents-new-btn';
let observer = null;
let queued = false;

function isDesktopShell() {
  try { return !window.__PROM_SHOULD_BOOT_MOBILE?.(); }
  catch { return true; }
}

function wireSettingsBotCreate() {
  queued = false;
  if (!isDesktopShell()) return;
  const button = document.querySelector(NEW_BUTTON_SELECTOR);
  if (!button || button.dataset.botCreationV2 === '1') return;

  // Remove the old inline agentFormNew() create path. The Settings page still
  // uses its normal editor for already-created Bots.
  button.removeAttribute('onclick');
  button.onclick = null;
  button.dataset.botCreationV2 = '1';
  button.textContent = '+ New Bot';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.openBotCreateModal?.();
  });
}

function queueWire() {
  if (queued) return;
  queued = true;
  queueMicrotask(wireSettingsBotCreate);
}

function boot() {
  if (!isDesktopShell()) return;
  wireSettingsBotCreate();
  if (!observer && document.body) {
    observer = new MutationObserver(queueWire);
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
