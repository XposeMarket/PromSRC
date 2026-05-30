/**
 * utils.js — F1 Scaffold
 *
 * Shared utility functions used across multiple pages.
 * Consolidated from duplicates in the original index.html.
 *
 * Usage:
 *   import { escHtml, timeAgo, showToast, renderMd } from './utils.js';
 */

// ─── HTML Escaping ─────────────────────────────────────────────
// NOTE: The original index.html had TWO escape functions:
//   escHtml(str)  at L5034 — includes &quot;
//   escapeHtml(s) at L10193 — does NOT include &quot;
// Consolidated here. Use escHtml() everywhere.

export function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Alias for backward compat during migration
export const escapeHtml = escHtml;

// ─── Time Formatting ──────────────────────────────────────────

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Stat Formatting ──────────────────────────────────────────

export function fmtPercent(v, digits = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--%';
  return `${n.toFixed(digits)}%`;
}

export function fmtMemoryGb(usedGb, totalGb) {
  const u = Number(usedGb);
  const t = Number(totalGb);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return '-- / -- GB';
  return `${u.toFixed(1)} / ${t.toFixed(1)} GB`;
}

export function meterWidth(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.max(0, Math.min(100, n))}%`;
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text || '');
}

export function setMeter(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = meterWidth(pct);
}

// ─── Toast / Confirm ──────────────────────────────────────────

export function showToast(title, body, type = 'info', duration = 5000) {
  const colors = {
    info:    { bg: 'var(--panel)', border: 'var(--line)',    icon: '\u2139\uFE0F', titleColor: 'var(--text)' },
    success: { bg: '#efffea',      border: '#b2dfb2',        icon: '\u2713',       titleColor: '#1a6e35' },
    error:   { bg: '#fff0f0',      border: '#fca5a5',        icon: '\u26A0\uFE0F', titleColor: '#9c1a1a' },
    warning: { bg: '#fffbea',      border: '#f5d87a',        icon: '\u26A0\uFE0F', titleColor: '#7c4d00' },
  };
  const c = colors[type] || colors.info;
  const toast = document.createElement('div');
  const existing = document.querySelectorAll('.__sc-toast');
  const offset = 24 + [...existing].reduce((sum, t) => sum + t.offsetHeight + 8, 0);
  toast.className = '__sc-toast';
  toast.style.cssText = `position:fixed;bottom:${offset}px;right:24px;z-index:99999;background:${c.bg};border:1.5px solid ${c.border};border-radius:12px;padding:12px 16px 12px 14px;min-width:240px;max-width:380px;box-shadow:0 4px 24px rgba(0,0,0,0.13);font-family:var(--font);display:flex;gap:10px;align-items:flex-start;animation:scToastIn 0.2s ease`;
  toast.innerHTML = `
    <span style="font-size:16px;flex-shrink:0;line-height:1.4">${c.icon}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:800;color:${c.titleColor};margin-bottom:${body ? '3px' : '0'}">${escHtml(title)}</div>
      ${body ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;word-break:break-word">${escHtml(String(body))}</div>` : ''}
    </div>
    <button onclick="this.closest('.__sc-toast').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;flex-shrink:0;padding:0 0 0 4px">&times;</button>
  `;
  if (!document.getElementById('__sc-toast-style')) {
    const s = document.createElement('style');
    s.id = '__sc-toast-style';
    s.textContent = '@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(s);
  }
  document.body.appendChild(toast);
  const timer = setTimeout(() => { toast.style.transition = 'opacity 0.3s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
}

export function bgtToast(title, body) {
  showToast(title, body, 'info');
}

export function showConfirm(message, onConfirm, onCancel, opts = {}) {
  const { title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, details = '' } = opts;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)';
  box.innerHTML = `
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${escHtml(title)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${escHtml(message)}</div>
    ${details ? `<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${escHtml(details)}</pre>` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${escHtml(cancelText)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${danger ? '#dc2626' : 'var(--brand)'};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${escHtml(confirmText)}</button>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  box.querySelector('#__sc-confirm-cancel').onclick = () => { close(); if (onCancel) onCancel(); };
  box.querySelector('#__sc-confirm-ok').onclick = () => { close(); if (onConfirm) onConfirm(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) { close(); if (onCancel) onCancel(); } });
}

// ─── Logging ──────────────────────────────────────────────────

const logLines = [];

export function log(text, type = 'log') {
  const ts = new Date().toLocaleTimeString();
  logLines.push({ text: `[${ts}] ${text}`, type });
  if (logLines.length > 100) logLines.shift();
  const lp = document.getElementById('log-panel');
  if (lp) {
    lp.innerHTML = logLines.map(l => `<div class="log-line ${l.type}">${l.text}</div>`).join('');
    lp.scrollTop = lp.scrollHeight;
  }
}

// ─── Visual Block Renderer ────────────────────────────────────

export function buildVisualSrcdoc(lang, code, isDark) {
  const mermaidTheme = isDark ? 'dark' : 'neutral';
  const sharedStyles = '*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;scrollbar-width:none;-ms-overflow-style:none}::-webkit-scrollbar{display:none}';
  const mermaidControlsBg = isDark ? 'rgba(18,25,38,0.92)' : 'rgba(255,255,255,0.94)';
  const mermaidControlsBorder = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.14)';
  const mermaidControlsText = isDark ? '#dbeafe' : '#1e293b';

  if (lang === 'chart') {
    const chartColors = isDark
      ? `Chart.defaults.color='#cdd6f4';Chart.defaults.borderColor='rgba(255,255,255,0.1)';`
      : `Chart.defaults.color='#374151';Chart.defaults.borderColor='rgba(0,0,0,0.1)';`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${sharedStyles}body{display:flex;align-items:center;justify-content:center;height:100vh}canvas{max-width:100%;max-height:100%}<\/style>
</head><body><canvas id="c"></canvas>
<script>try{${chartColors}const cfg=(${code});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};new Chart(document.getElementById('c'),cfg);}catch(e){document.body.innerHTML='<pre style="color:red;padding:8px;font-size:11px">'+e.message+'<\\/pre>';}<\/script>
<\/body><\/html>`;
  }
  if (lang === 'svg') {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${sharedStyles}html,body{height:100%}body{padding:0}.sv-shell{position:relative;min-height:280px;height:100%;overflow:hidden;background:transparent}.sv-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.sv-viewport.dragging{cursor:grabbing}.sv-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.sv-stage svg{max-width:none!important;height:auto;display:block}.sv-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-controls,.sv-shell:focus-within .sv-controls{opacity:1;transform:translateY(0);pointer-events:auto}.sv-btn{border:1px solid ${mermaidControlsBorder};background:${mermaidControlsBg};color:${mermaidControlsText};border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.sv-btn:hover{filter:brightness(1.08)}.sv-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:${mermaidControlsText};opacity:0;transform:translateY(4px);background:${mermaidControlsBg};border:1px solid ${mermaidControlsBorder};border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-hint,.sv-shell:focus-within .sv-hint{opacity:.82;transform:translateY(0)}<\/style>
<\/head><body>
<div class="sv-shell">
  <div class="sv-controls">
    <button class="sv-btn" id="sv-out" type="button">-<\/button>
    <button class="sv-btn" id="sv-in" type="button">+<\/button>
    <button class="sv-btn" id="sv-reset" type="button">Reset<\/button>
  <\/div>
  <div class="sv-viewport" id="sv-vp">
    <div class="sv-stage" id="sv-stage">${code}<\/div>
  <\/div>
  <div class="sv-hint">Pinch to zoom · Drag to pan<\/div>
<\/div>
<script>
(function(){
  const viewport=document.getElementById('sv-vp');
  const stage=document.getElementById('sv-stage');
  const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
  let scale=1,tx=0,ty=0,minScale=0.2,maxScale=8;

  function applyTransform(){stage.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';}

  function svgBounds(){
    const svg=stage.querySelector('svg');
    if(!svg)return null;
    const w=Number(svg.getAttribute('width'))||(svg.viewBox&&svg.viewBox.baseVal?svg.viewBox.baseVal.width:0)||svg.getBoundingClientRect().width;
    const h=Number(svg.getAttribute('height'))||(svg.viewBox&&svg.viewBox.baseVal?svg.viewBox.baseVal.height:0)||svg.getBoundingClientRect().height;
    if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return null;
    return{width:w,height:h};
  }

  function fitToViewport(){
    const b=svgBounds();if(!b)return;
    const vw=Math.max(1,viewport.clientWidth),vh=Math.max(1,viewport.clientHeight),pad=28;
    const fit=Math.min((vw-pad)/b.width,(vh-pad)/b.height);
    scale=clamp(Number.isFinite(fit)&&fit>0?fit:1,0.15,2.4);
    minScale=Math.max(0.1,scale*0.35);maxScale=Math.max(2.5,scale*12);
    tx=(vw-b.width*scale)/2;ty=(vh-b.height*scale)/2;applyTransform();
  }

  function zoomAt(ns,cx,cy){
    const ts=clamp(ns,minScale,maxScale);
    if(Math.abs(ts-scale)<0.0001)return;
    const r=viewport.getBoundingClientRect();
    const ox=cx-r.left,oy=cy-r.top;
    const wx=(ox-tx)/scale,wy=(oy-ty)/scale;
    scale=ts;tx=ox-wx*scale;ty=oy-wy*scale;applyTransform();
  }

  viewport.addEventListener('wheel',(e)=>{e.preventDefault();zoomAt(scale*(e.deltaY>0?0.9:1.1),e.clientX,e.clientY);},{passive:false});

  const ptrs=new Map();let lpd=0,lpmx=0,lpmy=0;
  viewport.addEventListener('pointerdown',(e)=>{
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});viewport.setPointerCapture(e.pointerId);
    if(ptrs.size===1)viewport.classList.add('dragging');
    if(ptrs.size===2){
      viewport.classList.remove('dragging');
      const[a,b]=[...ptrs.values()];const dx=b.x-a.x,dy=b.y-a.y;
      lpd=Math.sqrt(dx*dx+dy*dy);lpmx=(a.x+b.x)/2;lpmy=(a.y+b.y)/2;
    }
  });
  viewport.addEventListener('pointermove',(e)=>{
    if(!ptrs.has(e.pointerId))return;
    const old=ptrs.get(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrs.size===2){
      const[a,b]=[...ptrs.values()];const dx=b.x-a.x,dy=b.y-a.y;
      const d=Math.sqrt(dx*dx+dy*dy),mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
      if(lpd>0){zoomAt(scale*(d/lpd),mx,my);tx+=mx-lpmx;ty+=my-lpmy;applyTransform();}
      lpd=d;lpmx=mx;lpmy=my;
    }else if(ptrs.size===1){tx+=e.clientX-old.x;ty+=e.clientY-old.y;applyTransform();}
  });
  function onUp(e){
    ptrs.delete(e.pointerId);
    if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);
    if(ptrs.size===0)viewport.classList.remove('dragging');
    if(ptrs.size<2)lpd=0;
  }
  viewport.addEventListener('pointerup',onUp);viewport.addEventListener('pointercancel',onUp);

  document.getElementById('sv-in').addEventListener('click',()=>{const r=viewport.getBoundingClientRect();zoomAt(scale*1.18,r.left+r.width/2,r.top+r.height/2);});
  document.getElementById('sv-out').addEventListener('click',()=>{const r=viewport.getBoundingClientRect();zoomAt(scale/1.18,r.left+r.width/2,r.top+r.height/2);});
  document.getElementById('sv-reset').addEventListener('click',fitToViewport);
  window.addEventListener('resize',fitToViewport);
  requestAnimationFrame(()=>{fitToViewport();setTimeout(fitToViewport,80);});
})();
<\/script>
<\/body><\/html>`;
  }
  if (lang === 'mermaid') {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/mermaid/mermaid.min.js"><\/script>
<style>${sharedStyles}html,body{height:100%}body{padding:0;font-family:sans-serif}.mm-shell{position:relative;min-height:280px;height:100%;overflow:hidden;background:transparent}.mm-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.mm-viewport.dragging{cursor:grabbing}.mm-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.mermaid svg{max-width:none!important;height:auto;background:transparent!important}.mermaid{background:transparent!important}.mm-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-controls{opacity:1;transform:translateY(0);pointer-events:auto}.mm-btn{border:1px solid ${mermaidControlsBorder};background:${mermaidControlsBg};color:${mermaidControlsText};border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.mm-btn:hover{filter:brightness(1.08)}.mm-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:${mermaidControlsText};opacity:0;transform:translateY(4px);background:${mermaidControlsBg};border:1px solid ${mermaidControlsBorder};border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-hint{opacity:.82;transform:translateY(0)}<\/style>
<\/head><body>
<div class="mm-shell">
  <div class="mm-controls">
    <button class="mm-btn" id="mm-zoom-out" type="button">-<\/button>
    <button class="mm-btn" id="mm-zoom-in" type="button">+<\/button>
    <button class="mm-btn" id="mm-reset" type="button">Reset<\/button>
  <\/div>
  <div class="mm-viewport" id="mm-viewport">
    <div class="mm-stage" id="mm-stage">
      <div class="mermaid" id="mm-graph">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}<\/div>
    <\/div>
  <\/div>
  <div class="mm-hint">Pinch to zoom · Drag to pan<\/div>
<\/div>
<script>
(function(){
  const viewport = document.getElementById('mm-viewport');
  const stage = document.getElementById('mm-stage');
  const graphEl = document.getElementById('mm-graph');
  const zoomInBtn = document.getElementById('mm-zoom-in');
  const zoomOutBtn = document.getElementById('mm-zoom-out');
  const resetBtn = document.getElementById('mm-reset');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let minScale = 0.2;
  let maxScale = 8;
  function applyTransform() {
    stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }

  function graphBounds() {
    const svg = stage.querySelector('svg');
    if (!svg) return null;
    const width = Number(svg.getAttribute('width')) || (svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : 0) || svg.getBoundingClientRect().width;
    const height = Number(svg.getAttribute('height')) || (svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.height : 0) || svg.getBoundingClientRect().height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  function fitToViewport() {
    const bounds = graphBounds();
    if (!bounds) return;
    const vw = Math.max(1, viewport.clientWidth);
    const vh = Math.max(1, viewport.clientHeight);
    const padding = 28;
    const fitScale = Math.min((vw - padding) / bounds.width, (vh - padding) / bounds.height);
    scale = clamp(Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1, 0.15, 2.4);
    minScale = Math.max(0.1, scale * 0.35);
    maxScale = Math.max(2.5, scale * 12);
    tx = (vw - bounds.width * scale) / 2;
    ty = (vh - bounds.height * scale) / 2;
    applyTransform();
  }

  function zoomAt(nextScale, clientX, clientY) {
    const targetScale = clamp(nextScale, minScale, maxScale);
    if (Math.abs(targetScale - scale) < 0.0001) return;
    const rect = viewport.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const worldX = (cx - tx) / scale;
    const worldY = (cy - ty) / scale;
    scale = targetScale;
    tx = cx - worldX * scale;
    ty = cy - worldY * scale;
    applyTransform();
  }

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(scale * direction, event.clientX, event.clientY);
  }, { passive: false });

  // Multi-pointer: 1-finger pan + 2-finger pinch-to-zoom (works on both touch and mouse)
  const ptrs = new Map();
  let lpd = 0, lpmx = 0, lpmy = 0;

  viewport.addEventListener('pointerdown', (event) => {
    ptrs.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.setPointerCapture(event.pointerId);
    if (ptrs.size === 1) viewport.classList.add('dragging');
    if (ptrs.size === 2) {
      viewport.classList.remove('dragging');
      const [a, b] = [...ptrs.values()];
      const dx = b.x - a.x, dy = b.y - a.y;
      lpd = Math.sqrt(dx * dx + dy * dy);
      lpmx = (a.x + b.x) / 2; lpmy = (a.y + b.y) / 2;
    }
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!ptrs.has(event.pointerId)) return;
    const old = ptrs.get(event.pointerId);
    ptrs.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (lpd > 0) { zoomAt(scale * (d / lpd), mx, my); tx += mx - lpmx; ty += my - lpmy; applyTransform(); }
      lpd = d; lpmx = mx; lpmy = my;
    } else if (ptrs.size === 1) {
      tx += event.clientX - old.x; ty += event.clientY - old.y; applyTransform();
    }
  });

  function onPointerUp(event) {
    ptrs.delete(event.pointerId);
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (ptrs.size === 0) viewport.classList.remove('dragging');
    if (ptrs.size < 2) lpd = 0;
  }
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);

  zoomInBtn.addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    zoomAt(scale * 1.18, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  zoomOutBtn.addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    zoomAt(scale / 1.18, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  resetBtn.addEventListener('click', fitToViewport);
  window.addEventListener('resize', fitToViewport);

  function showRenderError(err) {
    viewport.style.touchAction = 'auto';
    const msg = err && err.message ? err.message : String(err || 'Mermaid render failed');
    stage.innerHTML = '<pre style="color:#b91c1c;padding:12px;font-size:11px;white-space:pre-wrap">Mermaid render error: ' + msg + '<\/pre>';
  }

  function resolveMermaid() {
    return new Promise((resolve, reject) => {
      if (window.mermaid) return resolve(window.mermaid);
      try {
        if (window.parent && window.parent.mermaid) return resolve(window.parent.mermaid);
      } catch {}
      let waited = 0;
      const timer = setInterval(() => {
        if (window.mermaid) {
          clearInterval(timer);
          resolve(window.mermaid);
          return;
        }
        try {
          if (window.parent && window.parent.mermaid) {
            clearInterval(timer);
            resolve(window.parent.mermaid);
            return;
          }
        } catch {}
        waited += 50;
        if (waited >= 3000) {
          clearInterval(timer);
          reject(new Error('Mermaid library unavailable'));
        }
      }, 50);
    });
  }

  resolveMermaid()
    .then((mm) => {
      mm.initialize({startOnLoad:false,theme:'${mermaidTheme}',securityLevel:'loose',themeVariables:{background:'transparent',primaryBackground:'transparent'}});
      const run = mm.run
        ? mm.run({ querySelector: '#mm-graph' })
        : Promise.resolve(mm.init(undefined, graphEl));
      return Promise.resolve(run);
    })
    .then(() => {
      if (!stage.querySelector('svg')) throw new Error('No SVG output');
      requestAnimationFrame(() => {
        fitToViewport();
        setTimeout(fitToViewport, 80);
      });
    })
    .catch(showRenderError);
})();
<\/script>
<\/body><\/html>`;
  }
  // html block
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${sharedStyles}body{font-family:sans-serif}<\/style>
<\/head><body>${code}<\/body><\/html>`;
}

export function buildVisualIframe(lang, code) {
  const id = 'vis_' + Math.random().toString(36).slice(2);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const srcdoc = buildVisualSrcdoc(lang, code, isDark);
  const encoded = srcdoc.replace(/"/g, '&quot;');
  const escapedLang = lang.replace(/"/g, '');
  const escapedCode = code.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const minHeight = 280;
  const onloadHandler = "(function(f){try{var h=f.contentDocument.documentElement.scrollHeight;if(h>60)f.style.minHeight=Math.min(h+16,700)+'px'}catch(e){}})(this)";
  return `<div class="visual-block" id="${id}-wrap" data-vis-lang="${escapedLang}" data-vis-code="${escapedCode}" style="margin:10px 0;border-radius:10px;overflow:hidden;border:1px solid var(--line)">
  <iframe
    id="${id}"
    srcdoc="${encoded}"
    sandbox="allow-scripts allow-same-origin allow-downloads"
    style="width:100%;min-height:${minHeight}px;border:none;display:block;background:transparent"
    loading="lazy"
    onload="${onloadHandler}"
  ><\/iframe>
<\/div>`;
}

// ─── Partial Visual (streaming in-progress) ──────────────────

function buildPartialVisual(lang, partialCode) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // HTML is browser-forgiving — render partial code live for piece-by-piece effect
  if (lang === 'html' && partialCode.trim().length > 10) {
    const srcdoc = buildVisualSrcdoc(lang, partialCode, isDark);
    const encoded = srcdoc.replace(/"/g, '&quot;');
    const overlayBg = isDark ? 'rgba(18,25,38,0.80)' : 'rgba(248,250,252,0.82)';
    const overlayText = isDark ? '#94a3b8' : '#64748b';
    return `<div class="visual-block" style="margin:10px 0;border-radius:10px;overflow:hidden;border:1px solid var(--line);position:relative">
  <style>@keyframes vis-blink{0%,100%{opacity:.25}50%{opacity:1}}</style>
  <iframe srcdoc="${encoded}" sandbox="allow-scripts allow-same-origin" style="width:100%;min-height:280px;border:none;display:block;background:transparent" loading="eager"></iframe>
  <div style="position:absolute;top:8px;right:8px;background:${overlayBg};border:1px solid rgba(99,102,241,.35);border-radius:6px;padding:3px 10px;font-size:10px;color:${overlayText};font-family:sans-serif;display:flex;align-items:center;gap:6px;backdrop-filter:blur(4px);pointer-events:none">
    <span style="width:6px;height:6px;border-radius:50%;background:#6366f1;display:inline-block;animation:vis-blink .75s ease-in-out infinite"></span>Building…
  </div>
</div>`;
  }

  // mermaid / chart / svg — partial syntax errors badly, show a spinner skeleton instead
  const bg = isDark ? 'rgba(30,41,59,0.8)' : '#f8fafc';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const labels = { mermaid: 'diagram', chart: 'chart', svg: 'graphic', html: 'visual' };
  const label = labels[lang] || 'visual';
  return `<div class="visual-block" style="margin:10px 0;border-radius:10px;overflow:hidden;border:1px solid ${border};background:${bg};min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">
  <style>@keyframes vis-spin{to{transform:rotate(360deg)}}@keyframes vis-bar{0%,100%{transform:scaleX(.3)}50%{transform:scaleX(1)}}</style>
  <div style="width:32px;height:32px;border-radius:50%;border:2px solid rgba(99,102,241,.2);border-top-color:#6366f1;animation:vis-spin .8s linear infinite"></div>
  <div style="color:${textColor};font-size:12px;font-family:sans-serif">Building ${label}…</div>
  <div style="width:120px;height:3px;background:rgba(99,102,241,.15);border-radius:99px;overflow:hidden"><div style="height:100%;background:#6366f1;border-radius:99px;transform-origin:left;animation:vis-bar 1.2s ease-in-out infinite"></div></div>
</div>`;
}

// ─── Markdown Renderer ────────────────────────────────────────

export function renderMd(text) {
  if (!text) return '';
  try {
    const visuals = [];

    // Match COMPLETE fenced visual blocks
    const FENCE_RE = /```(chart|svg|html|mermaid)\n([\s\S]*?)```/g;
    let withPlaceholders = String(text).replace(FENCE_RE, (_, lang, code) => {
      const idx = visuals.length;
      visuals.push({ lang: lang.toLowerCase(), code: code.trim(), partial: false });
      return `\x00VISUAL_${idx}\x00`;
    });

    // Detect a trailing INCOMPLETE (streaming) code block — no closing fence yet.
    // Replace it with a placeholder so raw code is never shown to the user.
    const OPEN_FENCE_RE = /```(chart|svg|html|mermaid)\n([\s\S]*)$/;
    const openMatch = withPlaceholders.match(OPEN_FENCE_RE);
    if (openMatch) {
      const idx = visuals.length;
      visuals.push({ lang: openMatch[1].toLowerCase(), code: openMatch[2], partial: true });
      withPlaceholders = withPlaceholders.slice(0, openMatch.index) + `\x00VISUAL_${idx}\x00`;
    }

    let html = marked.parse(withPlaceholders, { breaks: true, gfm: true, mangle: false, headerIds: false });

    if (visuals.length) {
      html = html.replace(/\x00VISUAL_(\d+)\x00/g, (_, i) => {
        const v = visuals[+i];
        if (!v) return '';
        return v.partial ? buildPartialVisual(v.lang, v.code) : buildVisualIframe(v.lang, v.code);
      });
      html = html.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g, '$1');
    }

    return html;
  } catch (e) {
    return escHtml(text);
  }
}

// ─── Expose on window for inline script and HTML onclick handlers ────────────
window.escHtml = escHtml;
window.escapeHtml = escHtml;
window.timeAgo = timeAgo;
window.fmtPercent = fmtPercent;
window.fmtMemoryGb = fmtMemoryGb;
window.meterWidth = meterWidth;
window.setText = setText;
window.setMeter = setMeter;
window.showToast = showToast;
window.bgtToast = bgtToast;
window.showConfirm = showConfirm;
window.log = log;
window.buildVisualSrcdoc = buildVisualSrcdoc;
window.buildVisualIframe = buildVisualIframe;
window.renderMd = renderMd;
