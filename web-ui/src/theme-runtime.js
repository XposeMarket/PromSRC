/** Theme System v2 browser runtime. */
import { THEME_SCHEMA_VERSION, THEME_PRESETS, normalizeTheme, rgba, mix, toLegacyVariables } from './theme-manifest.js';
import { applyAdvancedCustomOverrides, installThemeAppearance, syncControls } from './theme-appearance.js';

const runtimeProperties = new Set();
const canonicalProperties = new Set();
function root(){return typeof document!=='undefined'?document.documentElement:null;}
function set(property,value,{canonical=false}={}){const el=root();if(!el||!value)return;el.style.setProperty(property,value);(canonical?canonicalProperties:runtimeProperties).add(property);}
function clearRuntime(){const el=root();if(!el)return;for(const property of runtimeProperties){el.style.removeProperty(property);}runtimeProperties.clear();}

function ensureStyles(){
  if(typeof document==='undefined'||document.querySelector('link[data-prom-theme-contract]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./styles/theme-contract.css',import.meta.url).href;link.dataset.promThemeContract='v2';document.head?.appendChild(link);
}

export function syncCanonicalTokens(){
  const el=root();if(!el||typeof getComputedStyle!=='function')return {};
  const styles=getComputedStyle(el);const read=(name,fallback='')=>styles.getPropertyValue(name).trim()||fallback;
  const tokens={
    '--prom-color-background':read('--bg'),'--prom-color-background-soft':read('--bg-soft'),'--prom-color-surface':read('--panel'),'--prom-color-surface-strong':read('--panel-2'),
    '--prom-color-text':read('--text',read('--fg')),'--prom-color-text-muted':read('--muted'),'--prom-color-border':read('--line'),'--prom-color-border-strong':read('--line-strong'),
    '--prom-color-accent':read('--brand'),'--prom-color-accent-strong':read('--brand-2'),'--prom-color-success':read('--ok'),'--prom-color-warning':read('--warn'),'--prom-color-danger':read('--err'),
    '--prom-color-mobile-background':read('--pm-bg',read('--bg')),'--prom-color-mobile-surface':read('--pm-surface',read('--panel')),'--prom-color-mobile-text':read('--pm-text',read('--text')),'--prom-color-mobile-accent':read('--pm-accent',read('--brand')),
  };
  for(const [property,value] of Object.entries(tokens))set(property,value,{canonical:true});return tokens;
}

function bridgeCustomToMobile(){
  const el=root();if(!el||el.getAttribute('data-skin')!=='custom'||typeof getComputedStyle!=='function')return;
  const styles=getComputedStyle(el);const read=(name,fallback='')=>styles.getPropertyValue(name).trim()||fallback;
  const accent=read('--brand','#f97316');const text=read('--text','#f4f4f5');const bg=read('--bg','#0b0b0d');
  const values={
    '--pm-bg':bg,'--pm-bg-soft':read('--bg-soft'),'--pm-surface':read('--panel'),'--pm-surface-strong':read('--panel-2'),'--pm-ios-popover-base':read('--panel-2'),
    '--pm-border':read('--line'),'--pm-border-strong':read('--line-strong'),'--pm-text':text,'--pm-text-soft':mix(text,bg,.18),'--pm-muted':read('--muted'),
    '--pm-accent':accent,'--pm-accent-soft':rgba(accent,.14),'--pm-accent-dark':read('--brand-2'),'--pm-orange-soft':rgba(accent,.14),'--pm-orange-dark':read('--brand-2'),
  };
  for(const [property,value] of Object.entries(values))set(property,value);
}

function syncIdentity(id){const el=root();if(!el)return;const skin=el.getAttribute('data-skin')||'dark';el.setAttribute('data-theme-engine','v2');el.setAttribute('data-theme-id',String(id||skin));el.setAttribute('data-theme-profile',skin);}

function syncAfterExistingAppearance(id){
  const el=root();if(!el)return;const skin=el.getAttribute('data-skin')||'dark';if(skin!=='custom')clearRuntime();
  syncIdentity(id||(skin==='custom'?el.getAttribute('data-theme-id')||'custom':skin));
  if(skin==='custom'){applyAdvancedCustomOverrides();bridgeCustomToMobile();}
  syncCanonicalTokens();syncControls();
}

export function applyThemeDefinition(input,{persist=true}={}){
  const el=root();const theme=normalizeTheme(input);if(!el)return theme;clearRuntime();
  el.setAttribute('data-theme',theme.base);el.setAttribute('data-skin','custom');el.setAttribute('data-theme-id',theme.id);el.setAttribute('data-theme-profile','custom');el.setAttribute('data-theme-engine','v2');
  for(const [property,value] of Object.entries(toLegacyVariables(theme)))set(property,value);
  const [r,g,b]=theme.atmosphere;set('--pm-background-overlay',`rgba(${r}, ${g}, ${b}, .18)`);
  syncCanonicalTokens();if(persist){try{localStorage.setItem('prometheus_theme','custom');}catch{}}
  try{document.dispatchEvent(new CustomEvent('prom-theme-change',{detail:{id:theme.id,base:theme.base,runtime:true}}));document.dispatchEvent(new CustomEvent('prom-appearance-change',{detail:{id:theme.id,base:theme.base,runtime:true}}));}catch{}
  return theme;
}

function install(){
  if(typeof window==='undefined'||typeof document==='undefined')return;ensureStyles();
  window.PROM_THEMES=THEME_PRESETS.map(({id,label,base,description})=>({id,label,base,description}));
  window.PROM_RESOLVE_THEME=(id)=>window.PROM_THEMES.find((theme)=>theme.id===id)||window.PROM_THEMES[0];
  window.PROM_THEME_V2=Object.freeze({schemaVersion:THEME_SCHEMA_VERSION,presets:THEME_PRESETS,normalize:normalizeTheme,toLegacyVariables,applyDefinition:applyThemeDefinition,syncTokens:syncCanonicalTokens});
  syncAfterExistingAppearance(root()?.getAttribute('data-skin')||'dark');
  document.addEventListener('prom-theme-change',(event)=>{if(event?.detail?.runtime){syncIdentity(event.detail.id);syncCanonicalTokens();syncControls();return;}syncAfterExistingAppearance(event?.detail?.id);});
  document.addEventListener('prom-appearance-change',(event)=>{if(!event?.detail?.runtime)syncAfterExistingAppearance(event?.detail?.id);});
  installThemeAppearance(()=>{bridgeCustomToMobile();syncCanonicalTokens();});
}
install();
