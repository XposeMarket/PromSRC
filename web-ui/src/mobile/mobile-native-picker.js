// A real, directly tapped select: Safari owns presentation and accessibility.
// The overlay lives beside (never inside) the visual button.
export function attachNativePicker(trigger, { label, options, onChange, multiple = false }) {
  if (!trigger?.parentElement) return { refresh() {}, destroy() {} };
  const host = document.createElement('span');
  host.className = 'pm-native-picker-host';
  // Hosts often live inside pointer-events:none docks (the new-chat context
  // dock); pointer-events is inherited, so opt the host and select back in or
  // the tap falls through to the visual button and nothing opens.
  host.style.cssText = 'position:relative;display:inline-flex;min-width:0;align-items:stretch;pointer-events:auto';
  trigger.before(host);
  host.append(trigger);
  const select = document.createElement('select');
  select.className = 'pm-native-picker';
  select.setAttribute('aria-label', label || trigger.getAttribute('aria-label') || trigger.textContent.trim());
  select.multiple = multiple;
  select.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px;cursor:pointer;z-index:2;pointer-events:auto';
  const oldTabIndex = trigger.getAttribute('tabindex');
  const oldAriaHidden = trigger.getAttribute('aria-hidden');
  trigger.tabIndex = -1;
  trigger.setAttribute('aria-hidden', 'true');
  host.append(select);
  let destroyed = false;
  const syncTrigger = () => {
    host.style.display = trigger.hidden ? 'none' : 'inline-flex';
    select.disabled = !!trigger.disabled || !select.options.length;
  };
  const observer = new MutationObserver(syncTrigger);
  observer.observe(trigger, { attributes: true, attributeFilter: ['disabled', 'hidden'] });
  function refresh() {
    if (destroyed) return;
    const entries = typeof options === 'function' ? options() : options;
    select.replaceChildren();
    for (const entry of entries || []) {
      const option = document.createElement('option');
      option.value = String(entry.value);
      option.textContent = entry.label;
      option.disabled = !!entry.disabled;
      option.selected = !!entry.selected;
      select.append(option);
    }
    syncTrigger();
  }
  // Refresh before the browser's default picker activation; never preventDefault
  // or synthesize a click (iOS requires the original trusted tap).
  select.addEventListener('pointerdown', refresh);
  select.addEventListener('focus', refresh);
  select.addEventListener('click', event => event.stopPropagation());
  select.addEventListener('change', event => {
    event.stopPropagation();
    onChange(multiple ? Array.from(select.selectedOptions, option => option.value) : select.value, select);
  });
  select.addEventListener('focus', () => host.classList.add('pm-native-picker-focused'));
  select.addEventListener('blur', () => host.classList.remove('pm-native-picker-focused'));
  refresh();
  return {
    refresh,
    select,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      host.before(trigger);
      host.remove();
      if (oldTabIndex === null) trigger.removeAttribute('tabindex'); else trigger.setAttribute('tabindex', oldTabIndex);
      if (oldAriaHidden === null) trigger.removeAttribute('aria-hidden'); else trigger.setAttribute('aria-hidden', oldAriaHidden);
    },
  };
}
