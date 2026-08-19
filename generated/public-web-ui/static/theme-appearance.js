/** Appearance-tab integration for Theme System v2. */

const KEY = 'prometheus_appearance_v2';
const FIELDS = Object.freeze({ surface: '--panel', surfaceStrong: '--panel-2', textMuted: '--muted', border: '--line' });
let paletteChanged = () => {};

function root() { return typeof document !== 'undefined' ? document.documentElement : null; }
function read() {
  try { const value = JSON.parse(localStorage.getItem(KEY) || '{}'); return { advancedCustom: value?.advancedCustom || {} }; }
  catch { return { advancedCustom: {} }; }
}
function write(value) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch {} }
function hex(value, fallback = '') { const text = String(value || '').trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(text) ? text : fallback; }
function inputHex(value, fallback = '#000000') {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  const match = text.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (!match) return fallback;
  return `#${[match[1], match[2], match[3]].map((v) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0')).join('')}`;
}

export function applyAdvancedCustomOverrides() {
  const el = root(); if (!el || el.getAttribute('data-skin') !== 'custom') return;
  const overrides = read().advancedCustom;
  for (const [field, property] of Object.entries(FIELDS)) {
    const value = hex(overrides[field]);
    if (value) el.style.setProperty(property, value);
  }
}

function update(field, value) {
  const el = root(); if (!el || el.getAttribute('data-skin') !== 'custom' || !Object.hasOwn(FIELDS, field)) return;
  const next = hex(value); if (!next) return;
  const prefs = read(); prefs.advancedCustom[field] = next; write(prefs);
  el.style.setProperty(FIELDS[field], next); paletteChanged(); syncControls();
}

function reset() {
  const prefs = read(); prefs.advancedCustom = {}; write(prefs);
  if (root()?.getAttribute('data-skin') === 'custom' && typeof window.applyTheme === 'function') window.applyTheme('custom');
  else paletteChanged();
  syncControls();
}

function row(id, label, description) {
  return `<div class="appearance-control-row prom-theme-v2-control-row"><div class="appearance-control-copy"><label for="${id}">${label}</label><span>${description}</span></div><div class="appearance-color-control"><input id="${id}" type="color" aria-label="${label}"><input id="${id}-text" class="appearance-hex-input" type="text" maxlength="7" aria-label="${label} hex value"></div></div>`;
}

function mount() {
  if (typeof document === 'undefined' || document.getElementById('appearance-theme-v2-section')) return;
  const panel = document.getElementById('settings-panel-appearance'); const customize = panel?.querySelector('.appearance-custom-section');
  if (!panel || !customize) return;
  const section = document.createElement('section');
  section.id = 'appearance-theme-v2-section'; section.className = 'settings-section appearance-theme-v2-section';
  section.innerHTML = `<div class="settings-section-heading"><h2>Advanced palette</h2><span class="settings-help" tabindex="0" aria-label="Advanced palette details" data-settings-help="Theme System v2 keeps semantic colors separate from layout and typography. These values apply only to Custom theme and bridge desktop and mobile.">?</span></div><div class="settings-section-description">Fine-tune semantic surfaces without changing Prometheus layout, spacing, typography, glass, or component geometry.</div><div class="settings-section-panel appearance-custom-panel prom-theme-v2-panel"><div class="appearance-panel-toolbar"><div><div class="appearance-panel-title">Semantic colors</div><div id="appearance-theme-v2-status" class="settings-section-description">Theme System v2 is active.</div></div><button id="appearance-theme-v2-reset" class="appearance-secondary-button" type="button">Reset advanced</button></div><div class="appearance-control-list">${row('appearance-v2-surface','Surface','Cards, dialogs, and primary panels')}${row('appearance-v2-surface-strong','Elevated surface','Inputs, raised cards, and secondary panels')}${row('appearance-v2-muted-text','Muted text','Secondary labels and supporting copy')}${row('appearance-v2-border','Border','Subtle separators and panel outlines')}</div><div class="prom-theme-v2-contract-note"><strong>Theme contract v2</strong><span>Current presets remain visually protected. Future/imported themes map into this same semantic palette.</span></div></div>`;
  customize.insertAdjacentElement('afterend', section);
  const controls = { surface:'appearance-v2-surface', surfaceStrong:'appearance-v2-surface-strong', textMuted:'appearance-v2-muted-text', border:'appearance-v2-border' };
  for (const [field,id] of Object.entries(controls)) {
    const picker=document.getElementById(id); const text=document.getElementById(`${id}-text`);
    picker?.addEventListener('input',()=>{ if(text) text.value=picker.value; update(field,picker.value); });
    text?.addEventListener('change',()=>update(field,text.value));
  }
  document.getElementById('appearance-theme-v2-reset')?.addEventListener('click', reset);
  syncControls();
}

export function syncControls() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
  const el=root(); const section=document.getElementById('appearance-theme-v2-section'); if(!el||!section) return;
  const custom=el.getAttribute('data-skin')==='custom'; const prefs=read(); const styles=getComputedStyle(el);
  const controls={ surface:'appearance-v2-surface', surfaceStrong:'appearance-v2-surface-strong', textMuted:'appearance-v2-muted-text', border:'appearance-v2-border' };
  for(const [field,id] of Object.entries(controls)){
    const value=prefs.advancedCustom[field]||styles.getPropertyValue(FIELDS[field]).trim(); const normalized=inputHex(value);
    const picker=document.getElementById(id); const text=document.getElementById(`${id}-text`);
    if(picker){picker.value=normalized;picker.disabled=!custom;} if(text){text.value=normalized;text.disabled=!custom;}
  }
  const resetBtn=document.getElementById('appearance-theme-v2-reset'); if(resetBtn) resetBtn.disabled=!custom||Object.keys(prefs.advancedCustom).length===0;
  const status=document.getElementById('appearance-theme-v2-status'); if(status) status.textContent=custom?'Custom theme is active. Advanced colors update desktop and mobile together.':'Select Edit as custom above to unlock advanced semantic colors.';
  section.classList.toggle('is-disabled',!custom);
}

export function installThemeAppearance(onPaletteChanged) {
  paletteChanged = typeof onPaletteChanged === 'function' ? onPaletteChanged : () => {};
  if (typeof document === 'undefined') return;
  const run=()=>{mount();syncControls();};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run,{once:true}); else queueMicrotask(run);
  new MutationObserver(run).observe(document.documentElement,{subtree:true,childList:true});
}
