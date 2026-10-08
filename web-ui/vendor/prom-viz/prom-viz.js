/*!
 * Prometheus Viz Kit (window.ui / window.PV)
 * Loaded automatically into every inline ```html visual sandbox.
 * Zero dependencies. Theme-aware (reads --prom-* tokens injected by the host),
 * responsive from 320px, touch-friendly tooltips, re-renders on resize/theme change.
 *
 * Quick reference (target = selector | element | null -> appended to the page root):
 *   const page = ui.page({kicker, title, subtitle, source})
 *   ui.kpis(t, [{label, value, format, delta, good:'up'|'down', spark:[..], note}])
 *   const body = ui.section(t, {kicker, title, subtitle, right})
 *   ui.chart(t, {type:'line'|'area'|'stacked'|'bar'|'stackedBar', x:[..], series:[{name, values}], format, annotations:[{x, label}], height})
 *   ui.bars(t, {items:[{label, value, note}], format, highlight:'max'|label, limit})
 *   ui.heatmap(t, {rows, cols, values:[[..]], format, mark:'max'})
 *   ui.treemap(t, {data:{name, children:[{name, value|children}]}, format, height})
 *   ui.donut(t, {items:[{label, value}], format, center:{label, value}})
 *   ui.table(t, {columns:[{key, label, format, align}], rows, sort:{key, dir}})
 *   ui.tabs(t, {tabs:[{label, render(el)}]})   ui.segmented(t, {options, value, onChange})
 *   ui.compare(t, {variants:[{name, note, html|render(el)}]})  // Theo-style design variants with "Pick this"
 *   ui.callout(t, html)  ui.badge(text, tone)  ui.spark(values)  ui.fmt(v, format)  ui.ask(prompt)
 *   ui.state.get(key, fallback) / ui.state.set(key, value)  // persisted widget state
 * 1.1:
 *   ui.slider(t, {label, min, max, step, value, format, key, onChange(v)})
 *   ui.params(t, {params:[{key, label, min, max, step, value, format}], onChange(values)})   // "what if" panel
 *   ui.loop(t, {step(dt, t, frame), reset(), autoplay, speed})   // play/pause/reset/speed for simulations
 *   ui.timeline(t, {items:[{lane, label, start, end, status:'ok'|'bad'|'warn'|'run', note}], markers:[{at, label}], format:'time'|'date'|'num'})
 *   ui.sankey(t, {links:[{source, target, value}], format, height})
 *   ui.form(t, {title, fields:[{key, label, type:'text'|'number'|'textarea'|'select'|'toggle'|'chips'|'slider', options, required}], submit, prompt})
 *   Tap-to-ask: pass ask:'Why is {label} {value}?' (or fn(ctx)) to chart/bars/heatmap/treemap/table/timeline/sankey.
 *     The tapped data point lands in the chat composer; askSend:true sends it instead.
 *   ui.insert(text, {send})  ui.toast(msg)  ui.exportBar(t, {png, x, csv:rows, name})  ui.toPng(el, {x:true})  ui.csv(rows, {name})
 */
(function () {
  'use strict';
  if (window.PV) return;
  var d = document;
  var root = d.documentElement;

  // ── Styles ────────────────────────────────────────────────────────────────
  var CSS = [
    "@font-face{font-family:'PV Sans';font-weight:400;font-display:swap;src:url('/static/fonts/manrope-400.woff2') format('woff2')}",
    "@font-face{font-family:'PV Sans';font-weight:600;font-display:swap;src:url('/static/fonts/manrope-600.woff2') format('woff2')}",
    "@font-face{font-family:'PV Sans';font-weight:700;font-display:swap;src:url('/static/fonts/manrope-700.woff2') format('woff2')}",
    "@font-face{font-family:'PV Mono';font-weight:500;font-display:swap;src:url('/static/fonts/ibm-plex-mono-500.woff2') format('woff2')}",
    "@font-face{font-family:'PV Mono';font-weight:600;font-display:swap;src:url('/static/fonts/ibm-plex-mono-600.woff2') format('woff2')}",
    ":root{--pv-font:'PV Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--pv-mono:'PV Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;",
    "--pv-text:var(--prom-text,currentColor);--pv-muted:var(--prom-muted,#8a8f98);--pv-line:var(--prom-border,rgba(127,127,127,.22));",
    "--pv-line-2:var(--prom-border-strong,rgba(127,127,127,.4));--pv-surface:var(--prom-surface,rgba(127,127,127,.06));",
    "--pv-soft:var(--prom-surface-secondary,rgba(127,127,127,.1));--pv-accent:var(--prom-accent,#d6b75e);--pv-on-accent:var(--prom-on-accent,#050505);",
    "--pv-ok:var(--prom-success,#22a06b);--pv-warn:var(--prom-warning,#d99a00);--pv-bad:var(--prom-danger,#e5484d);--pv-r:12px}",
    "body{font-family:var(--pv-font);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased;padding:2px 1px 6px}",
    ".pv{display:flex;flex-direction:column;gap:20px;color:var(--pv-text);min-width:0}",
    ".pv-num{font-family:var(--pv-mono);font-variant-numeric:tabular-nums}",
    ".pv-kicker{font:600 10.5px/1.2 var(--pv-mono);letter-spacing:.09em;text-transform:uppercase;color:var(--pv-muted)}",
    ".pv-h1{font:700 21px/1.2 var(--pv-font);letter-spacing:-.015em;margin-top:6px}",
    ".pv-title{font:700 16px/1.25 var(--pv-font);letter-spacing:-.01em;margin-top:4px}",
    ".pv-sub{font-size:13px;color:var(--pv-muted);margin-top:4px;max-width:68ch}",
    ".pv-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}",
    ".pv-section{display:flex;flex-direction:column;gap:12px;min-width:0}",
    ".pv-card{border:1px solid var(--pv-line);border-radius:var(--pv-r);background:var(--pv-surface);padding:14px;min-width:0}",
    ".pv-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr));gap:8px}",
    ".pv-kpi{border:1px solid var(--pv-line);border-radius:var(--pv-r);padding:12px 14px;background:var(--pv-surface);min-width:0}",
    ".pv-kpi-l{font:600 10px/1.2 var(--pv-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--pv-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".pv-kpi-v{font:600 24px/1.1 var(--pv-mono);font-variant-numeric:tabular-nums;margin-top:8px;letter-spacing:-.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".pv-kpi-d{font:500 11.5px var(--pv-mono);margin-top:5px;color:var(--pv-muted)}",
    ".pv-kpi svg{display:block;margin-top:8px;width:100%;height:26px}",
    ".pv-up{color:var(--pv-ok)!important}.pv-down{color:var(--pv-bad)!important}",
    ".pv-chart{position:relative;width:100%;min-width:0;touch-action:pan-y}",
    ".pv-chart svg{display:block;width:100%;overflow:visible;user-select:none;-webkit-user-select:none}",
    ".pv-ax{font:500 10.5px var(--pv-mono);fill:var(--pv-muted)}",
    ".pv-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--pv-muted)}",
    ".pv-legend button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:2px 0}",
    ".pv-legend i{width:9px;height:9px;border-radius:3px;display:inline-block}",
    ".pv-legend .off{opacity:.35;text-decoration:line-through}",
    ".pv-tip{position:fixed;z-index:50;pointer-events:none;min-width:130px;max-width:260px;padding:9px 11px;border-radius:10px;border:1px solid var(--pv-line-2);background:var(--pv-tipbg,#111);color:var(--pv-text);font-size:12px;line-height:1.4;box-shadow:0 10px 30px rgba(0,0,0,.28);opacity:0;transition:opacity .12s}",
    ".pv-tip .h{font:600 10.5px var(--pv-mono);color:var(--pv-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}",
    ".pv-tip .r{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-top:2px}",
    ".pv-tip .k{display:flex;align-items:center;gap:6px;color:var(--pv-text);opacity:.78;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".pv-tip .k i{width:8px;height:8px;border-radius:2px;flex:none}",
    ".pv-tip .v{font:600 12px var(--pv-mono);font-variant-numeric:tabular-nums}",
    ".pv-tip .t{border-top:1px solid var(--pv-line);margin-top:6px;padding-top:6px}",
    ".pv-seg{display:inline-flex;padding:3px;border-radius:999px;border:1px solid var(--pv-line);background:var(--pv-soft);gap:2px;max-width:100%;overflow-x:auto;scrollbar-width:none}",
    ".pv-seg button{all:unset;cursor:pointer;padding:5px 12px;border-radius:999px;font:600 12px var(--pv-font);color:var(--pv-muted);white-space:nowrap;transition:background .15s,color .15s}",
    ".pv-seg button[aria-pressed=true]{background:var(--pv-accent);color:var(--pv-on-accent)}",
    ".pv-tabbar{display:flex;gap:2px;border-bottom:1px solid var(--pv-line);overflow-x:auto;scrollbar-width:none}",
    ".pv-tabbar button{all:unset;cursor:pointer;padding:8px 12px;font:600 13px var(--pv-font);color:var(--pv-muted);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}",
    ".pv-tabbar button[aria-selected=true]{color:var(--pv-text);border-bottom-color:var(--pv-accent)}",
    ".pv-tabpanel{padding-top:14px;min-width:0}",
    ".pv-bars{display:flex;flex-direction:column;gap:8px}",
    ".pv-bar{display:grid;grid-template-columns:minmax(64px,30%) 1fr auto;gap:10px;align-items:center;font-size:13px}",
    ".pv-bar-l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pv-muted)}",
    ".pv-bar-t{height:10px;border-radius:999px;background:var(--pv-soft);overflow:hidden}",
    ".pv-bar-f{height:100%;border-radius:999px;width:0;transition:width .6s cubic-bezier(.2,.8,.2,1)}",
    ".pv-bar-v{font:500 12px var(--pv-mono);font-variant-numeric:tabular-nums;color:var(--pv-muted);min-width:42px;text-align:right}",
    ".pv-bar.hl .pv-bar-l,.pv-bar.hl .pv-bar-v{color:var(--pv-text);font-weight:700}",
    ".pv-bar[data-click]{cursor:pointer}.pv-bar[data-click]:hover .pv-bar-l{color:var(--pv-text)}",
    ".pv-heat{display:grid;gap:2px;min-width:0}",
    ".pv-heat .c{border-radius:3px;min-height:18px;cursor:default}",
    ".pv-heat .c:hover,.pv-heat .c.mk{outline:2px solid var(--pv-text);outline-offset:-1px}",
    ".pv-heat .rl,.pv-heat .cl{font:500 10px var(--pv-mono);color:var(--pv-muted);white-space:nowrap;overflow:hidden}",
    ".pv-heat .rl{padding-right:6px;align-self:center;text-align:right}.pv-heat .cl{text-align:left;padding-top:3px;overflow:visible}",
    ".pv-scale{display:flex;align-items:center;gap:8px;font:500 10px var(--pv-mono);color:var(--pv-muted)}",
    ".pv-scale .g{height:8px;width:110px;border-radius:999px}",
    ".pv-tree{position:relative;width:100%;border-radius:var(--pv-r);overflow:hidden}",
    ".pv-tree .n{position:absolute;padding:6px 7px;overflow:hidden;cursor:pointer;border-radius:5px;transition:left .35s,top .35s,width .35s,height .35s,filter .15s}",
    ".pv-tree .n:hover{filter:brightness(1.12)}",
    ".pv-tree .n .t{font:600 12px/1.25 var(--pv-font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".pv-tree .n .v{font:500 11px var(--pv-mono);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".pv-crumbs{display:flex;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--pv-muted);align-items:center}",
    ".pv-crumbs button{all:unset;cursor:pointer;color:var(--pv-accent);font-weight:600}",
    ".pv-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;min-width:0}",
    ".pv-table{width:100%;border-collapse:collapse;font-size:13px}",
    ".pv-table th{font:600 10px var(--pv-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--pv-muted);text-align:left;padding:8px 10px;border-bottom:1px solid var(--pv-line-2);cursor:pointer;white-space:nowrap;user-select:none}",
    ".pv-table td{padding:8px 10px;border-bottom:1px solid var(--pv-line);white-space:nowrap}",
    ".pv-table td.w{white-space:normal;min-width:180px;line-height:1.35}",
    "@media (max-width:520px){.pv-table td.w{min-width:150px}.pv-table td,.pv-table th{padding:7px 8px}}",
    ".pv-table .n{text-align:right;font-family:var(--pv-mono);font-variant-numeric:tabular-nums}",
    ".pv-table tbody tr:hover td{background:var(--pv-soft)}",
    ".pv-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font:600 11px var(--pv-font);background:var(--pv-soft);color:var(--pv-muted);border:1px solid var(--pv-line);white-space:nowrap}",
    ".pv-badge.ok{color:var(--pv-ok)}.pv-badge.bad{color:var(--pv-bad)}.pv-badge.warn{color:var(--pv-warn)}.pv-badge.accent{background:var(--pv-accent);color:var(--pv-on-accent);border-color:transparent}",
    ".pv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px}",
    ".pv-callout{border-left:3px solid var(--pv-accent);padding:9px 12px;background:var(--pv-soft);border-radius:0 10px 10px 0;font-size:13px}",
    ".pv-foot{font-size:11px;color:var(--pv-muted)}",
    ".pv-btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;font:600 12.5px var(--pv-font);background:var(--pv-accent);color:var(--pv-on-accent)}",
    ".pv-btn.ghost{background:transparent;color:var(--pv-text);border:1px solid var(--pv-line-2)}",
    ".pv-stage{border:1px solid var(--pv-line);border-radius:var(--pv-r);padding:16px;background:var(--pv-surface);min-height:80px}",
    ".pv-donut{display:flex;gap:18px;align-items:center;flex-wrap:wrap}",
    ".pv-donut svg{flex:none}.pv-donut path{cursor:pointer;transition:opacity .15s}",
    "@keyframes pv-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}",
    ".pv-in{animation:pv-in .4s cubic-bezier(.2,.8,.2,1) both}",
    "@media (max-width:420px){.pv-kpi-v{font-size:20px}.pv-h1{font-size:18px}.pv-bar{grid-template-columns:minmax(56px,34%) 1fr auto}}",
    "@media (prefers-reduced-motion:reduce){.pv-in{animation:none}.pv-bar-f,.pv-tree .n{transition:none}}"
  ].join('\n');
  var styleEl = d.createElement('style');
  styleEl.id = 'pv-kit-css';
  styleEl.textContent = CSS;
  (d.head || root).appendChild(styleEl);

  // ── Color + theme ─────────────────────────────────────────────────────────
  var probe = null;
  function resolveColor(value) {
    if (!value) return null;
    if (!probe) { probe = d.createElement('span'); probe.style.display = 'none'; (d.body || root).appendChild(probe); }
    probe.style.color = '';
    probe.style.color = value;
    var c = getComputedStyle(probe).color;
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function tokenColor(name, fallback) {
    var raw = getComputedStyle(root).getPropertyValue(name).trim();
    var c = raw && !/^(currentColor|transparent|inherit)$/i.test(raw) ? resolveColor(raw) : null;
    if (!c || c.a === 0) c = resolveColor(fallback);
    return c;
  }
  function rgb(c, a) { return c ? 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + (a == null ? c.a : a) + ')' : 'transparent'; }
  function lum(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function mix(a, b, t) { return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 }; }
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    return { r: 255 * f(0), g: 255 * f(8), b: 255 * f(4), a: 1 };
  }
  function toHsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var dd = mx - mn; s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h *= 60;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }

  var T = {};
  function readTheme() {
    var cs = getComputedStyle(root);
    var scheme = (cs.getPropertyValue('--prom-scheme') || cs.colorScheme || '').trim();
    var text = tokenColor('--prom-text', '#1f2328');
    var bgTok = tokenColor('--prom-bg', 'transparent');
    // Host scheme hint wins; then page background; text luminance is the last resort.
    var dark = /dark/.test(scheme) ? true : /light/.test(scheme) ? false
      : (bgTok && bgTok.a > 0.5 ? lum(bgTok) < 0.3 : lum(text) > 0.4);
    // Guard against a host handing us text that is unreadable on its own scheme.
    if (dark !== (lum(text) > 0.3)) {
      text = resolveColor(dark ? '#e6ebf2' : '#1f2328');
      root.style.setProperty('--prom-text', rgb(text, 1));
    }
    var accent = tokenColor('--prom-accent', '#d6b75e');
    var ah = toHsl(accent);
    // Near-white/near-black/grey accents (mono themes) are useless as a data color.
    var weakAccent = ah.s < 22 || ah.l > 88 || ah.l < 12;
    var dataAccent = weakAccent ? (dark ? hsl(24, 92, 60) : hsl(22, 90, 50)) : accent;
    var onAccent = lum(accent) > 0.45 ? '#0b0d10' : '#ffffff';
    root.style.setProperty('--prom-on-accent', onAccent);
    var tipBase = tokenColor('--prom-bg', dark ? '#121417' : '#ffffff');
    if (!tipBase || tipBase.a < 0.9) tipBase = dark ? resolveColor('#15181d') : resolveColor('#ffffff');
    // Lift the tooltip slightly off the page so it reads as a layer.
    tipBase = mix(tipBase, dark ? resolveColor('#ffffff') : resolveColor('#000000'), dark ? 0.06 : 0.02);
    root.style.setProperty('--pv-tipbg', rgb(tipBase, 1));
    // Categorical palette: accent first, then hue-spaced companions with matched lightness.
    // Restrained, editorial companions (no neon magenta/lime).
    var base = toHsl(dataAccent), L = dark ? 62 : 50, S = dark ? 52 : 48;
    var hues = [0, 190, 140, 40, 230, 320, 100, 260];
    var cat = hues.map(function (off, i) {
      if (i === 0) return rgb(dataAccent, 1);
      return rgb(hsl((base.h + off) % 360, S, L), 1);
    });
    T = {
      dark: dark,
      text: rgb(text, 1),
      muted: rgb(tokenColor('--prom-muted', dark ? '#8b949e' : '#6b7280'), 1),
      line: rgb(tokenColor('--prom-border', dark ? '#30363d' : '#d0d7de'), dark ? 0.55 : 0.8),
      grid: dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)',
      accent: rgb(dataAccent, 1),
      accentRaw: accent,
      dataAccent: dataAccent,
      ok: rgb(tokenColor('--prom-success', '#22a06b'), 1),
      bad: rgb(tokenColor('--prom-danger', '#e5484d'), 1),
      warn: rgb(tokenColor('--prom-warning', '#d99a00'), 1),
      cat: cat,
      bgSeq: dark ? resolveColor('#1a1d22') : resolveColor('#f1f3f5'),
    };
    return T;
  }
  function seq(t) { // sequential ramp: neutral -> data accent
    t = Math.max(0, Math.min(1, t));
    return rgb(mix(T.bgSeq, T.dataAccent, 0.08 + 0.92 * Math.pow(t, 0.85)), 1);
  }
  function div(t) { // diverging: bad <- neutral -> ok, t in [-1,1]
    var c = t < 0 ? resolveColor(T.bad) : resolveColor(T.ok);
    return rgb(mix(T.bgSeq, c, Math.min(1, Math.abs(t))), 1);
  }
  function textOn(cssColor) { var c = resolveColor(cssColor); return c && lum(c) > 0.42 ? '#0b0d10' : '#ffffff'; }

  // ── Number formatting ─────────────────────────────────────────────────────
  function fmt(v, f) {
    if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '–';
    if (typeof f === 'function') return f(v);
    if (typeof v !== 'number') return String(v);
    f = f || 'compact';
    var abs = Math.abs(v), sign = v < 0 ? '-' : '';
    var compact = function (x, dec) {
      var a = Math.abs(x), s = x < 0 ? '-' : '';
      if (a >= 1e12) return s + (a / 1e12).toFixed(dec) + 'T';
      if (a >= 1e9) return s + (a / 1e9).toFixed(dec) + 'B';
      if (a >= 1e6) return s + (a / 1e6).toFixed(dec) + 'M';
      if (a >= 1e4) return s + (a / 1e3).toFixed(dec) + 'k';
      if (a >= 1e3) return s + (a / 1e3).toFixed(dec) + 'k';
      return s + (Number.isInteger(a) ? a : a.toFixed(a < 10 ? 2 : 1));
    };
    switch (f) {
      case 'int': return Math.round(v).toLocaleString('en-US');
      case 'num': return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
      case 'compact': return compact(v, 1);
      case 'usd': return sign + '$' + (abs >= 1e4 ? compact(abs, 1) : abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 }));
      case 'usd0': return sign + '$' + Math.round(abs).toLocaleString('en-US');
      case 'usd2': return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'pct': return (v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0) + '%';
      case 'pct1': return (v * 100).toFixed(1) + '%';
      case 'pctRaw': return v.toFixed(1) + '%';
      case 'delta': return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
      case 'ms': return abs >= 1000 ? (v / 1000).toFixed(abs >= 1e4 ? 0 : 1) + 's' : Math.round(v) + 'ms';
      case 'dur': { var s2 = Math.round(abs), h = Math.floor(s2 / 3600), m = Math.floor((s2 % 3600) / 60); return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + (s2 % 60) + 's' : s2 + 's'; }
      case 'bytes': { var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, x = abs; while (x >= 1024 && i < 4) { x /= 1024; i++; } return sign + x.toFixed(i ? 1 : 0) + ' ' + u[i]; }
      default:
        if (typeof f === 'string' && f.indexOf('{v}') >= 0) return f.replace('{v}', compact(v, 1));
        return compact(v, 1);
    }
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(tag, cls, html) { var e = d.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  var pageRoot = null;
  function host(target) {
    if (target && target.nodeType === 1) return target;
    if (typeof target === 'string') { var f = d.querySelector(target); if (f) return f; }
    if (!pageRoot) { pageRoot = h('div', 'pv'); (d.body || root).appendChild(pageRoot); }
    return pageRoot;
  }
  // Entrance animation only while the page is first being built. Re-renders (slider drags,
  // ui.loop frames) must not restart a fade from opacity 0 or the view never becomes visible.
  var bootAt = Date.now();
  function mount(target, el) { host(target).appendChild(el); if (Date.now() - bootAt < 1200) el.classList.add('pv-in'); return el; }
  // Forgiving argument shapes: models often pass a bare array, or a target as the first arg of page().
  // Normalize instead of rendering nothing, and show a visible notice when there is truly no data.
  function opts(o, key) { if (Array.isArray(o)) { var r = {}; r[key || 'items'] = o; return r; } return o && typeof o === 'object' && o.nodeType !== 1 ? o : {}; }
  function emptyNote(target, what) { return mount(target, h('div', 'pv-sub', esc(what + ': no data to show'))); }
  function showError(msg) { try { var b = h('div', 'pv-callout', '<b>Visual error:</b> ' + esc(msg)); b.style.borderColor = 'var(--pv-bad, #d33)'; host(null).appendChild(b); } catch (e) {} }
  if (!window.__pvErrHook) { window.__pvErrHook = 1; window.addEventListener('error', function (e) { showError((e && e.message) || 'script error'); }); window.addEventListener('unhandledrejection', function (e) { showError(String((e && e.reason && e.reason.message) || (e && e.reason) || 'promise rejected')); }); }
  function widthOf(el) { return Math.max(240, Math.floor(el.getBoundingClientRect().width || el.clientWidth || 600)); }

  // Re-render registry (resize + theme changes).
  var renderers = [];
  function live(el, draw) {
    var last = 0;
    var run = function () { var w = widthOf(el); last = w; draw(w); };
    renderers.push({ el: el, run: run, last: function () { return last; } });
    run();
    return run;
  }
  var resizeTimer = null;
  function rerunAll(force) {
    renderers = renderers.filter(function (r) { return r.el.isConnected; });
    renderers.forEach(function (r) { if (force || Math.abs(widthOf(r.el) - r.last()) > 2) r.run(); });
  }
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { rerunAll(false); }, 80); });
  window.addEventListener('prometheus:visual-theme-change', function () { setTimeout(function () { readTheme(); rerunAll(true); }, 0); });

  // ── Tooltip (mouse + touch) ───────────────────────────────────────────────
  var tip = null;
  function tipEl() { if (!tip) { tip = h('div', 'pv-tip'); tip.setAttribute('role', 'tooltip'); (d.body || root).appendChild(tip); } return tip; }
  function showTip(html, x, y) {
    var t = tipEl(); t.innerHTML = html; t.style.opacity = '1';
    var tw = t.offsetWidth, th = t.offsetHeight, vw = innerWidth, vh = innerHeight;
    var left = x + 14; if (left + tw > vw - 6) left = Math.max(6, x - tw - 14);
    var top = y - th - 12; if (top < 6) top = Math.min(vh - th - 6, y + 16);
    t.style.left = left + 'px'; t.style.top = top + 'px';
  }
  function hideTip() { if (tip) tip.style.opacity = '0'; }
  function tipRows(title, rows, total) {
    var s = title ? '<div class="h">' + esc(title) + '</div>' : '';
    rows.forEach(function (r) { s += '<div class="r"><span class="k">' + (r.color ? '<i style="background:' + r.color + '"></i>' : '') + esc(r.label) + '</span><span class="v">' + esc(r.value) + '</span></div>'; });
    if (total) s += '<div class="r t"><span class="k">' + esc(total.label) + '</span><span class="v">' + esc(total.value) + '</span></div>';
    return s;
  }
  function bindHover(el, onMove, onLeave) {
    var move = function (e) { var p = e.touches ? e.touches[0] : e; if (p) onMove(p.clientX, p.clientY, e); };
    var leave = function () { hideTip(); if (onLeave) onLeave(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') leave(); });
    d.addEventListener('pointerdown', function (e) { if (!el.contains(e.target)) leave(); });
  }

  // ── Persisted state (works with the Prometheus visual bridge) ─────────────
  var state = {
    get: function (key, fallback) {
      var s = (window.openai && window.openai.widgetState) || {};
      return s.pv && Object.prototype.hasOwnProperty.call(s.pv, key) ? s.pv[key] : fallback;
    },
    set: function (key, value) {
      var s = Object.assign({}, (window.openai && window.openai.widgetState) || {});
      s.pv = Object.assign({}, s.pv || {}); s.pv[key] = value;
      try { if (window.openai && window.openai.setWidgetState) window.openai.setWidgetState(s); } catch (e) {}
    }
  };
  function ask(prompt, title) {
    try { if (window.prometheusVisual) window.prometheusVisual.sendFollowUpMessage({ prompt: String(prompt), title: title || '' }); } catch (e) {}
  }

  // ── Layout primitives ─────────────────────────────────────────────────────
  function page(o, o2) {
    if (o && (o.nodeType === 1 || typeof o === 'string') && o2 && typeof o2 === 'object') { if (o.nodeType === 1) pageRoot = pageRoot || o; o = o2; }
    o = typeof o === 'string' ? { title: o } : opts(o);
    var p = host(null);
    if (o.kicker || o.title || o.subtitle) {
      var head = h('div', 'pv-head');
      var left = h('div', '');
      if (o.kicker) left.appendChild(h('div', 'pv-kicker', esc(o.kicker)));
      if (o.title) left.appendChild(h('div', 'pv-h1', esc(o.title)));
      if (o.subtitle) left.appendChild(h('div', 'pv-sub', esc(o.subtitle)));
      head.appendChild(left);
      mount(p, head);
    }
    if (o.source) {
      // footer rendered after the rest of the page is built
      setTimeout(function () { mount(p, h('div', 'pv-foot', 'Source: ' + esc(o.source))); }, 0);
    }
    return p;
  }
  function section(target, o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    var s = h('section', 'pv-section');
    var head = h('div', 'pv-head');
    var left = h('div', '');
    if (o.kicker) left.appendChild(h('div', 'pv-kicker', esc(o.kicker)));
    if (o.title) left.appendChild(h('div', 'pv-title', esc(o.title)));
    if (o.subtitle) left.appendChild(h('div', 'pv-sub', esc(o.subtitle)));
    head.appendChild(left);
    var right = h('div', '');
    head.appendChild(right);
    if (o.kicker || o.title || o.subtitle) s.appendChild(head);
    var body = h('div', o.card ? 'pv-card' : '');
    body.style.minWidth = '0';
    s.appendChild(body);
    mount(target, s);
    body.head = right; body.section = s;
    if (o.right && o.right.nodeType === 1) right.appendChild(o.right);
    return body;
  }
  function grid(target, n) {
    var g = h('div', 'pv-grid');
    if (n) g.style.gridTemplateColumns = 'repeat(auto-fit,minmax(min(100%,' + Math.floor(640 / n) + 'px),1fr))';
    mount(target, g);
    return g;
  }
  function card(target) { return mount(target, h('div', 'pv-card')); }
  function callout(target, html) { return mount(target, h('div', 'pv-callout', html)); }
  function badge(text, tone) { return '<span class="pv-badge ' + (tone || '') + '">' + esc(text) + '</span>'; }

  function sparkPath(values, w, hgt, pad) {
    var vals = values.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (vals.length < 2) return null;
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), rng = mx - mn || 1;
    var pts = values.map(function (v, i) { return [pad + i * (w - pad * 2) / (values.length - 1), hgt - pad - ((v - mn) / rng) * (hgt - pad * 2)]; });
    return { line: 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L'), pts: pts };
  }
  function spark(values, o) {
    o = o || {};
    var w = 120, hh = 26, sp = sparkPath(values || [], w, hh, 2);
    if (!sp) return '';
    var col = o.color || T.accent;
    var last = sp.pts[sp.pts.length - 1];
    var id = 'g' + Math.random().toString(36).slice(2, 8);
    return '<svg viewBox="0 0 ' + w + ' ' + hh + '" preserveAspectRatio="none"><defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".28"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + sp.line + 'L' + last[0] + ',' + hh + 'L2,' + hh + 'Z" fill="url(#' + id + ')"/>' +
      '<path d="' + sp.line + '" fill="none" stroke="' + col + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';
  }

  function kpis(target, items) {
    var wrap = h('div', 'pv-kpis');
    (items || []).forEach(function (k) {
      var el = h('div', 'pv-kpi');
      var dHtml = '';
      if (k.delta != null) {
        var dv = typeof k.delta === 'number' ? k.delta : null;
        var good = k.good === 'down' ? dv < 0 : dv > 0;
        var cls = dv == null || dv === 0 ? '' : good ? 'pv-up' : 'pv-down';
        var arrow = dv == null ? '' : dv > 0 ? '▲ ' : dv < 0 ? '▼ ' : '';
        dHtml = '<div class="pv-kpi-d"><span class="' + cls + '">' + arrow + esc(typeof k.delta === 'number' ? fmt(Math.abs(k.delta), k.deltaFormat || 'pct1') : k.delta) + '</span>' + (k.note ? ' ' + esc(k.note) : '') + '</div>';
      } else if (k.note) dHtml = '<div class="pv-kpi-d">' + esc(k.note) + '</div>';
      el.innerHTML = '<div class="pv-kpi-l" title="' + esc(k.label) + '">' + esc(k.label) + '</div><div class="pv-kpi-v"' + (k.color ? ' style="color:' + esc(k.color) + '"' : '') + '>' + esc(fmt(k.value, k.format)) + '</div>' + dHtml + (k.spark ? spark(k.spark, { color: k.color }) : '');
      wrap.appendChild(el);
    });
    return mount(target, wrap);
  }

  function legend(target, series, colors, onToggle) {
    var lg = h('div', 'pv-legend');
    var hidden = {};
    series.forEach(function (s, i) {
      var b = h('button', '', '<i style="background:' + colors[i] + '"></i>' + esc(s.name));
      b.type = 'button';
      if (onToggle) b.addEventListener('click', function () { hidden[i] = !hidden[i]; b.classList.toggle('off', !!hidden[i]); onToggle(hidden); });
      lg.appendChild(b);
    });
    target.appendChild(lg);
    return lg;
  }

  function segmented(target, o) {
    var seg = h('div', 'pv-seg');
    seg.setAttribute('role', 'group');
    var value = o.key ? state.get(o.key, o.value) : o.value;
    var opts = (o.options || []).map(function (op) { return typeof op === 'object' ? op : { label: String(op), value: op }; });
    var paint = function () { Array.prototype.forEach.call(seg.children, function (b, i) { b.setAttribute('aria-pressed', String(opts[i].value === value)); }); };
    opts.forEach(function (op) {
      var b = h('button', '', esc(op.label)); b.type = 'button';
      b.addEventListener('click', function () { value = op.value; paint(); if (o.key) state.set(o.key, value); if (o.onChange) o.onChange(value); });
      seg.appendChild(b);
    });
    paint();
    var t = target && target.head ? target.head : host(target);
    t.appendChild(seg);
    if (o.onChange && o.fireInitial !== false) setTimeout(function () { o.onChange(value); }, 0);
    return { el: seg, get: function () { return value; } };
  }

  function tabs(target, o) {
    var wrap = h('div', '');
    var bar = h('div', 'pv-tabbar'); bar.setAttribute('role', 'tablist');
    var panel = h('div', 'pv-tabpanel');
    var list = o.tabs || [];
    var active = o.key ? state.get(o.key, o.active || 0) : (o.active || 0);
    var show = function (i) {
      active = i;
      Array.prototype.forEach.call(bar.children, function (b, j) { b.setAttribute('aria-selected', String(j === i)); });
      panel.innerHTML = '';
      var tb = list[i];
      if (tb && tb.render) tb.render(panel); else if (tb && tb.html) panel.innerHTML = tb.html;
      if (o.key) state.set(o.key, i);
    };
    list.forEach(function (tb, i) { var b = h('button', '', esc(tb.label)); b.type = 'button'; b.setAttribute('role', 'tab'); b.addEventListener('click', function () { show(i); }); bar.appendChild(b); });
    wrap.appendChild(bar); wrap.appendChild(panel);
    mount(target, wrap);
    show(Math.min(active, list.length - 1));
    return { el: wrap, show: show };
  }

  // ── Scales ────────────────────────────────────────────────────────────────
  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (count * step) / span;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }
  function svgEl(tag, attrs) { var e = d.createElementNS('http://www.w3.org/2000/svg', tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }

  // ── Cartesian chart ───────────────────────────────────────────────────────
  // {type:'line'|'area'|'stacked'|'bar'|'stackedBar', x:[labels], series:[{name, values, color, dash}],
  //  format, xFormat(label)->string, height, annotations:[{x, label}], band:{from,to,label}, legend:true,
  //  target:{value,label}, onClick(index,label)}
  function chart(target, o) {
    o = o || {};
    var wrap = h('div', 'pv-chart');
    mount(target, wrap);
    var type = o.type || 'line';
    var stacked = type === 'stacked' || type === 'stackedBar';
    var isBar = type === 'bar' || type === 'stackedBar';
    var series = (o.series || []).map(function (s, i) { return Object.assign({ color: s.color || T.cat[i % T.cat.length] }, s); });
    var xs = o.x || (series[0] ? series[0].values.map(function (_, i) { return i; }) : []);
    var hidden = {};
    var svgHost = h('div', '');
    wrap.appendChild(svgHost);
    if (series.length > 1 && o.legend !== false) {
      var lgw = h('div', ''); lgw.style.marginTop = '10px';
      legend(lgw, series, series.map(function (s) { return s.color; }), function (hd) { hidden = hd; draw(); });
      wrap.appendChild(lgw);
    }
    var draw;
    var redraw = live(wrap, function (W) {
      draw = function () { render(W); };
      draw();
    });
    function render(W) {
      // recompute colors on theme change
      series.forEach(function (s, i) { if (!(o.series[i] || {}).color) s.color = T.cat[i % T.cat.length]; });
      var H = o.height || (W < 420 ? 210 : 260);
      var compact = W < 420;
      var vis = series.filter(function (_, i) { return !hidden[i]; });
      var n = xs.length;
      // stacked totals
      var stacks = xs.map(function (_, j) { var acc = 0; return vis.map(function (s) { var v = +s.values[j] || 0; var y0 = acc; acc += v; return [y0, acc]; }); });
      var maxV = 0, minV = 0;
      if (stacked) stacks.forEach(function (st) { var t = st.length ? st[st.length - 1][1] : 0; if (t > maxV) maxV = t; });
      else vis.forEach(function (s) { s.values.forEach(function (v) { if (v == null) return; if (v > maxV) maxV = v; if (v < minV) minV = v; }); });
      if (o.target && o.target.value > maxV) maxV = o.target.value;
      if (o.min != null) minV = o.min; if (o.max != null) maxV = o.max;
      var ticks = niceTicks(minV, maxV || 1, compact ? 4 : 5);
      var y0 = ticks[0], y1 = ticks[ticks.length - 1];
      var labW = Math.max.apply(null, ticks.map(function (t) { return fmt(t, o.format).length; })) * 6.6 + 10;
      var M = { l: Math.max(30, labW), r: 10, t: o.annotations && o.annotations.length ? 26 : 10, b: 24 };
      var iw = W - M.l - M.r, ih = H - M.t - M.b;
      var band = isBar ? iw / Math.max(1, n) : 0;
      var X = function (j) { return isBar ? M.l + band * j + band / 2 : M.l + (n <= 1 ? iw / 2 : (iw * j) / (n - 1)); };
      var Y = function (v) { return M.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih; };
      var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H, role: 'img', 'aria-label': o.title || 'chart' });
      // grid + y labels
      ticks.forEach(function (t) {
        svg.appendChild(svgEl('line', { x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t), stroke: t === 0 && minV < 0 ? T.line : T.grid, 'stroke-width': 1 }));
        var tx = svgEl('text', { x: M.l - 8, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'pv-ax' }); tx.textContent = fmt(t, o.format); svg.appendChild(tx);
      });
      // x labels (auto skip)
      var maxLabels = Math.max(2, Math.floor(iw / (compact ? 58 : 74)));
      var stepX = Math.max(1, Math.ceil(n / maxLabels));
      xs.forEach(function (lab, j) {
        if (j % stepX !== 0 && j !== n - 1) return;
        if (j === n - 1 && j % stepX !== 0 && (n - 1) % stepX < stepX * 0.6) return;
        var tx = svgEl('text', { x: X(j), y: H - 6, 'text-anchor': isBar ? 'middle' : j === 0 ? 'start' : j === n - 1 ? 'end' : 'middle', class: 'pv-ax' });
        tx.textContent = o.xFormat ? o.xFormat(lab, j) : String(lab); svg.appendChild(tx);
      });
      // band highlight
      if (o.band) {
        var bi0 = xs.indexOf(o.band.from), bi1 = xs.indexOf(o.band.to);
        if (bi0 >= 0 && bi1 >= 0) {
          var bx0 = X(bi0) - (isBar ? band / 2 : 0), bx1 = X(bi1) + (isBar ? band / 2 : 0);
          svg.appendChild(svgEl('rect', { x: bx0, y: M.t, width: Math.max(2, bx1 - bx0), height: ih, fill: T.accent, opacity: 0.07 }));
        }
      }
      // series
      var gid = 'pvg' + Math.random().toString(36).slice(2, 7);
      var defs = svgEl('defs', {}); svg.appendChild(defs);
      if (isBar) {
        var groupW = band * 0.72, bw = stacked ? groupW : groupW / Math.max(1, vis.length);
        xs.forEach(function (_, j) {
          vis.forEach(function (s, k) {
            var v = +s.values[j] || 0, yA, yB, x;
            if (stacked) { yA = Y(stacks[j][k][1]); yB = Y(stacks[j][k][0]); x = X(j) - groupW / 2; }
            else { yA = Y(Math.max(0, v)); yB = Y(Math.min(0, v)); x = X(j) - groupW / 2 + k * bw; }
            var r = Math.min(4, bw / 3);
            svg.appendChild(svgEl('rect', { x: x + 0.5, y: yA, width: Math.max(1, bw - 1), height: Math.max(0.5, yB - yA), rx: stacked && k < vis.length - 1 ? 0 : r, fill: s.color, opacity: 0.92, 'data-j': j }));
          });
        });
      } else {
        vis.forEach(function (s, k) {
          var pts = xs.map(function (_, j) { var v = stacked ? stacks[j][k][1] : s.values[j]; return v == null ? null : [X(j), Y(v)]; });
          var line = '', started = false;
          pts.forEach(function (p) { if (!p) { started = false; return; } line += (started ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); started = true; });
          if (type === 'area' || stacked) {
            var lower = stacked ? xs.map(function (_, j) { return [X(j), Y(stacks[j][k][0])]; }).reverse() : [[X(n - 1), Y(Math.max(y0, 0))], [X(0), Y(Math.max(y0, 0))]];
            var lg = svgEl('linearGradient', { id: gid + k, x1: 0, x2: 0, y1: 0, y2: 1 });
            lg.appendChild(svgEl('stop', { offset: 0, 'stop-color': s.color, 'stop-opacity': stacked ? 0.55 : 0.32 }));
            lg.appendChild(svgEl('stop', { offset: 1, 'stop-color': s.color, 'stop-opacity': stacked ? 0.35 : 0.02 }));
            defs.appendChild(lg);
            svg.appendChild(svgEl('path', { d: line + 'L' + lower.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L') + 'Z', fill: 'url(#' + gid + k + ')' }));
          }
          svg.appendChild(svgEl('path', { d: line, fill: 'none', stroke: s.color, 'stroke-width': s.width || (stacked ? 1.4 : 2), 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash ? '4 4' : 'none' }));
          if (n <= 24 && !stacked) pts.forEach(function (p) { if (p) svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 2.6, fill: s.color })); });
        });
      }
      // target line
      if (o.target) {
        var ty = Y(o.target.value);
        svg.appendChild(svgEl('line', { x1: M.l, x2: W - M.r, y1: ty, y2: ty, stroke: T.muted, 'stroke-dasharray': '3 4', 'stroke-width': 1 }));
        var tt = svgEl('text', { x: W - M.r, y: ty - 5, 'text-anchor': 'end', class: 'pv-ax' }); tt.textContent = (o.target.label || 'Target') + ' ' + fmt(o.target.value, o.format); svg.appendChild(tt);
      }
      // annotations
      (o.annotations || []).forEach(function (a) {
        var j = typeof a.x === 'number' && xs.indexOf(a.x) < 0 ? a.x : xs.indexOf(a.x);
        if (j < 0 || j >= n) return;
        var ax = X(j);
        svg.appendChild(svgEl('line', { x1: ax, x2: ax, y1: M.t - 6, y2: M.t + ih, stroke: T.text, 'stroke-opacity': 0.35, 'stroke-dasharray': '2 3' }));
        var at = svgEl('text', { x: Math.min(W - 4, Math.max(4, ax)), y: M.t - 12, 'text-anchor': ax > W * 0.75 ? 'end' : ax < W * 0.25 ? 'start' : 'middle', class: 'pv-ax', style: 'fill:' + T.text + ';font-weight:600' });
        at.textContent = a.label; svg.appendChild(at);
      });
      // crosshair
      var cross = svgEl('line', { y1: M.t, y2: M.t + ih, stroke: T.text, 'stroke-opacity': 0.4, 'stroke-width': 1, visibility: 'hidden' });
      svg.appendChild(cross);
      var dots = vis.map(function (s) { var c = svgEl('circle', { r: 4, fill: s.color, stroke: T.dark ? '#000' : '#fff', 'stroke-width': 1.5, visibility: 'hidden' }); svg.appendChild(c); return c; });
      svgHost.innerHTML = ''; svgHost.appendChild(svg);
      var idxAt = function (cx) {
        var r = svg.getBoundingClientRect(); var x = (cx - r.left) * (W / r.width);
        var j = isBar ? Math.floor((x - M.l) / band) : Math.round(((x - M.l) / iw) * (n - 1));
        return Math.max(0, Math.min(n - 1, j));
      };
      bindHover(svg, function (cx, cy) {
        if (!n) return;
        var j = idxAt(cx);
        cross.setAttribute('x1', X(j)); cross.setAttribute('x2', X(j)); cross.setAttribute('visibility', isBar ? 'hidden' : 'visible');
        var rows = [], total = 0;
        vis.forEach(function (s, k) {
          var v = s.values[j]; total += +v || 0;
          rows.push({ label: s.name || 'Value', value: fmt(v, o.format), color: s.color });
          if (!isBar && v != null) { dots[k].setAttribute('cx', X(j)); dots[k].setAttribute('cy', Y(stacked ? stacks[j][k][1] : v)); dots[k].setAttribute('visibility', 'visible'); }
        });
        if (!stacked) rows.sort(function (a, b) { return 0; });
        showTip(tipRows(o.xFormat ? o.xFormat(xs[j], j) : xs[j], stacked ? rows.slice().reverse() : rows, stacked && vis.length > 1 ? { label: 'Total', value: fmt(total, o.format) } : null), cx, cy);
      }, function () { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (c) { c.setAttribute('visibility', 'hidden'); }); });
      var askC = asker(o, function (j) { var vals = {}; vis.forEach(function (s) { vals[s.name || 'Value'] = fmt(s.values[j], o.format); }); return { x: o.xFormat ? o.xFormat(xs[j], j) : xs[j], label: o.xFormat ? o.xFormat(xs[j], j) : xs[j], values: Object.keys(vals).map(function (k) { return k + ' ' + vals[k]; }).join(', '), title: o.title || '' }; });
      if (askC) svg.classList.add('pv-askable');
      if (o.onClick || askC) svg.addEventListener('click', function (e) { var j = idxAt(e.clientX); if (o.onClick) o.onClick(j, xs[j]); if (askC) askC(j); });
    }
    return { el: wrap, redraw: function () { redraw(); } };
  }

  // ── Ranked bars ───────────────────────────────────────────────────────────
  function bars(target, o) {
    o = opts(o);
    var items = (o.items || o.data || []).slice();
    if (!items.length) return { el: emptyNote(target, 'Bars') };
    if (o.sort !== false) items.sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
    var limit = o.limit || items.length;
    var wrap = h('div', 'pv-bars');
    mount(target, wrap);
    var expanded = false;
    var draw = function () {
      wrap.innerHTML = '';
      var shown = expanded ? items : items.slice(0, limit);
      var mx = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value || 0); }).concat([1]));
      var hl = o.highlight === 'max' ? (items[0] && items[0].label) : o.highlight;
      shown.forEach(function (it, i) {
        var row = h('div', 'pv-bar' + (it.label === hl ? ' hl' : ''));
        var col = it.color || (it.label === hl || !hl ? T.accent : rgb(resolveColor(T.accent), T.dark ? 0.45 : 0.4));
        row.innerHTML = '<div class="pv-bar-l" title="' + esc(it.label) + '">' + esc(it.label) + '</div><div class="pv-bar-t"><div class="pv-bar-f" style="background:' + col + '"></div></div><div class="pv-bar-v">' + esc(fmt(it.value, o.format)) + '</div>';
        var askB = asker(o, function () { return { label: it.label, value: fmt(it.value, o.format), note: it.note || '', rank: i + 1 }; });
        if (o.onClick || askB) { row.setAttribute('data-click', '1'); row.addEventListener('click', function () { if (o.onClick) o.onClick(it, i); if (askB) askB(); }); }
        bindHover(row, function (cx, cy) { showTip(tipRows(it.label, [{ label: o.valueLabel || 'Value', value: fmt(it.value, o.format), color: col }].concat(it.note ? [{ label: it.note, value: '' }] : [])), cx, cy); });
        wrap.appendChild(row);
        var f = row.querySelector('.pv-bar-f');
        requestAnimationFrame(function () { requestAnimationFrame(function () { f.style.width = (Math.abs(it.value || 0) / mx * 100).toFixed(2) + '%'; }); });
      });
      if (items.length > limit) {
        var more = h('button', 'pv-btn ghost', expanded ? 'Show less' : 'Show all ' + items.length); more.type = 'button'; more.style.alignSelf = 'flex-start';
        more.addEventListener('click', function () { expanded = !expanded; draw(); });
        wrap.appendChild(more);
      }
    };
    draw();
    return { el: wrap };
  }

  // ── Heatmap ───────────────────────────────────────────────────────────────
  // {rows:[labels], cols:[labels], values:[[row][col]], format, mark:'max'|[r,c], diverging:false, colLabelEvery}
  function heatmap(target, o) {
    o = o || {};
    var outer = h('div', 'pv-section'); outer.style.gap = '8px';
    mount(target, outer);
    var rows = o.rows || [], cols = o.cols || [], vals = o.values || [];
    var flat = [].concat.apply([], vals).filter(function (v) { return typeof v === 'number'; });
    var mn = o.min != null ? o.min : Math.min.apply(null, flat), mx = o.max != null ? o.max : Math.max.apply(null, flat);
    var mark = o.mark;
    if (mark === 'max') { mark = null; vals.forEach(function (r, i) { r.forEach(function (v, j) { if (v === mx) mark = [i, j]; }); }); }
    var gridEl = h('div', 'pv-heat');
    var scaleEl = h('div', 'pv-scale');
    outer.appendChild(h('div', 'pv-scroll')).appendChild(gridEl);
    outer.appendChild(scaleEl);
    live(outer, function (W) {
      var labW = Math.min(90, Math.max.apply(null, rows.map(function (r) { return String(r).length; }).concat([2])) * 6.4 + 8);
      var cellMin = W < 420 ? 9 : 14;
      gridEl.style.gridTemplateColumns = labW + 'px repeat(' + cols.length + ',minmax(' + cellMin + 'px,1fr))';
      gridEl.style.minWidth = (labW + cols.length * (cellMin + 2)) + 'px';
      var every = o.colLabelEvery || Math.max(1, Math.ceil(cols.length / Math.max(4, Math.floor((W - labW) / 34))));
      var html = '';
      rows.forEach(function (r, i) {
        html += '<div class="rl">' + esc(r) + '</div>';
        cols.forEach(function (c, j) {
          var v = (vals[i] || [])[j];
          var t = typeof v === 'number' ? (v - mn) / (mx - mn || 1) : null;
          var bg = t == null ? 'transparent' : o.diverging ? div(v / Math.max(Math.abs(mn), Math.abs(mx) || 1)) : seq(t);
          var mk = mark && mark[0] === i && mark[1] === j ? ' mk' : '';
          html += '<div class="c' + mk + '" data-i="' + i + '" data-j="' + j + '" style="background:' + bg + '"></div>';
        });
      });
      html += '<div></div>';
      cols.forEach(function (c, j) { html += '<div class="cl">' + (j % every === 0 ? esc(c) : '') + '</div>'; });
      gridEl.innerHTML = html;
      var g0 = o.diverging ? div(-1) : seq(0), g1 = o.diverging ? div(1) : seq(1);
      scaleEl.innerHTML = '<span>' + esc(fmt(mn, o.format)) + '</span><span class="g" style="background:linear-gradient(90deg,' + g0 + (o.diverging ? ',' + div(0) : '') + ',' + g1 + ')"></span><span>' + esc(fmt(mx, o.format)) + '</span>' + (o.legendLabel ? '<span>' + esc(o.legendLabel) + '</span>' : '');
    });
    bindHover(gridEl, function (cx, cy, e) {
      var el = d.elementFromPoint(cx, cy);
      if (!el || !el.classList.contains('c')) { hideTip(); return; }
      var i = +el.getAttribute('data-i'), j = +el.getAttribute('data-j');
      showTip(tipRows(rows[i] + ' · ' + cols[j], [{ label: o.valueLabel || 'Value', value: fmt((vals[i] || [])[j], o.format), color: el.style.background }]), cx, cy);
    });
    var askH = asker(o, function (i, j) { return { row: rows[i], col: cols[j], value: fmt((vals[i] || [])[j], o.format), label: rows[i] + ' ' + cols[j] }; });
    if (o.onClick || askH) gridEl.addEventListener('click', function (e) { var el = e.target; if (!el.classList.contains('c')) return; var i = +el.getAttribute('data-i'), j = +el.getAttribute('data-j'); if (o.onClick) o.onClick(i, j); if (askH) askH(i, j); });
    return { el: outer };
  }

  // ── Treemap (squarified, click to zoom) ───────────────────────────────────
  function sumNode(n) { if (n.children && n.children.length) { n._v = n.children.reduce(function (a, c) { return a + sumNode(c); }, 0); } else n._v = +n.value || 0; return n._v; }
  function squarify(items, x, y, w, hgt) {
    var out = [], total = items.reduce(function (a, i) { return a + i._v; }, 0);
    if (!total || w <= 0 || hgt <= 0) return out;
    var scale = (w * hgt) / total;
    var list = items.filter(function (i) { return i._v > 0; }).map(function (i) { return { n: i, a: i._v * scale }; }).sort(function (a, b) { return b.a - a.a; });
    var worst = function (row, side) { var s = row.reduce(function (a, r) { return a + r.a; }, 0), mxA = 0, mnA = Infinity; row.forEach(function (r) { mxA = Math.max(mxA, r.a); mnA = Math.min(mnA, r.a); }); return Math.max(side * side * mxA / (s * s), (s * s) / (side * side * mnA)); };
    var row = [];
    while (list.length) {
      var side = Math.min(w, hgt), item = list[0];
      if (!row.length || worst(row.concat([item]), side) <= worst(row, side)) { row.push(item); list.shift(); continue; }
      var s = row.reduce(function (a, r) { return a + r.a; }, 0);
      if (w >= hgt) { var cw = s / hgt, cy = y; row.forEach(function (r) { var rh = r.a / cw; out.push({ n: r.n, x: x, y: cy, w: cw, h: rh }); cy += rh; }); x += cw; w -= cw; }
      else { var rh2 = s / w, cx = x; row.forEach(function (r) { var rw = r.a / rh2; out.push({ n: r.n, x: cx, y: y, w: rw, h: rh2 }); cx += rw; }); y += rh2; hgt -= rh2; }
      row = [];
    }
    if (row.length) {
      var s2 = row.reduce(function (a, r) { return a + r.a; }, 0);
      if (w >= hgt) { var cw2 = s2 / hgt, cy2 = y; row.forEach(function (r) { var rh = r.a / cw2; out.push({ n: r.n, x: x, y: cy2, w: cw2, h: rh }); cy2 += rh; }); }
      else { var rh3 = s2 / w, cx2 = x; row.forEach(function (r) { var rw = r.a / rh3; out.push({ n: r.n, x: cx2, y: y, w: rw, h: rh3 }); cx2 += rw; }); }
    }
    return out;
  }
  function treemap(target, o) {
    o = o || {};
    var data = o.data || { name: 'All', children: o.items || [] };
    sumNode(data);
    var outer = h('div', 'pv-section'); outer.style.gap = '8px';
    var crumbs = h('div', 'pv-crumbs');
    var box = h('div', 'pv-tree');
    outer.appendChild(crumbs); outer.appendChild(box);
    mount(target, outer);
    var path = [data];
    // color each top-level branch by category; leaves shade by size within branch
    (data.children || []).forEach(function (c, i) { c._ci = i; });
    var colorFor = function (n, topIndex, t) { var base = resolveColor(T.cat[topIndex % T.cat.length]); return rgb(mix(base, T.dark ? resolveColor('#000') : resolveColor('#fff'), 0.15 + 0.35 * (1 - t)), 1); };
    var draw = function (W) {
      var node = path[path.length - 1];
      var H = o.height || Math.round(Math.min(420, Math.max(240, W * 0.55)));
      box.style.height = H + 'px';
      crumbs.innerHTML = '';
      path.forEach(function (p, i) {
        if (i) crumbs.appendChild(h('span', '', '›'));
        if (i < path.length - 1) { var b = h('button', '', esc(p.name)); b.type = 'button'; b.addEventListener('click', function () { path = path.slice(0, i + 1); draw(widthOf(box)); }); crumbs.appendChild(b); }
        else crumbs.appendChild(h('span', '', '<b style="color:var(--pv-text)">' + esc(p.name) + '</b> · <span class="pv-num">' + esc(fmt(p._v, o.format)) + '</span>'));
      });
      if (path.length === 1) crumbs.appendChild(h('span', '', '· tap a block to zoom'));
      var kids = node.children && node.children.length ? node.children : [node];
      var cells = squarify(kids, 0, 0, W, H);
      var mxK = Math.max.apply(null, kids.map(function (k) { return k._v; }).concat([1]));
      box.innerHTML = '';
      cells.forEach(function (c) {
        var top = path.length > 1 ? path[1]._ci : c.n._ci;
        var col = colorFor(c.n, top == null ? 0 : top, c.n._v / mxK);
        var el = h('div', 'n');
        var g = 1.5;
        el.style.cssText = 'left:' + (c.x + g) + 'px;top:' + (c.y + g) + 'px;width:' + Math.max(0, c.w - g * 2) + 'px;height:' + Math.max(0, c.h - g * 2) + 'px;background:' + col + ';color:' + textOn(col);
        if (c.w > 46 && c.h > 30) el.innerHTML = '<div class="t">' + esc(c.n.name) + '</div>' + (c.h > 44 ? '<div class="v">' + esc(fmt(c.n._v, o.format)) + ' · ' + (c.n._v / node._v * 100).toFixed(1) + '%</div>' : '');
        bindHover(el, function (cx, cy) { showTip(tipRows(path.map(function (p) { return p.name; }).slice(1).concat([c.n.name]).join(' › '), [{ label: o.valueLabel || 'Value', value: fmt(c.n._v, o.format), color: col }, { label: 'Share of ' + node.name, value: (c.n._v / node._v * 100).toFixed(1) + '%' }].concat(c.n.children ? [{ label: 'Items', value: String(c.n.children.length) }] : [])), cx, cy); });
        el.addEventListener('click', function () { hideTip(); if (c.n.children && c.n.children.length) { path.push(c.n); draw(widthOf(box)); } else { if (o.onClick) o.onClick(c.n); if (o.ask) asker(o, function () { return { name: c.n.name, label: c.n.name, path: path.map(function (p) { return p.name; }).slice(1).concat([c.n.name]).join(' / '), value: fmt(c.n._v, o.format), share: (c.n._v / node._v * 100).toFixed(1) + '%' }; })(); } });
        box.appendChild(el);
      });
    };
    live(box, draw);
    return { el: outer };
  }

  // ── Donut ─────────────────────────────────────────────────────────────────
  function donut(target, o) {
    o = opts(o);
    var items = (o.items || o.data || []).filter(function (i) { return i.value > 0; });
    if (!items.length) return { el: emptyNote(target, 'Donut') };
    var total = items.reduce(function (a, i) { return a + i.value; }, 0) || 1;
    var wrap = h('div', 'pv-donut');
    mount(target, wrap);
    var draw = function () {
      var S = 150, R = 70, r = 46, cx = S / 2, cy = S / 2, a0 = -Math.PI / 2;
      var svg = svgEl('svg', { viewBox: '0 0 ' + S + ' ' + S, width: S, height: S });
      var center = svgEl('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', style: 'font:600 18px var(--pv-mono);fill:' + T.text });
      var sub = svgEl('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', class: 'pv-ax' });
      var setCenter = function (v, l) { center.textContent = v; sub.textContent = l; };
      var def = o.center || { value: fmt(total, o.format), label: 'Total' };
      items.forEach(function (it, i) {
        var col = it.color || T.cat[i % T.cat.length];
        var a1 = a0 + (it.value / total) * Math.PI * 2;
        var large = a1 - a0 > Math.PI ? 1 : 0;
        var p = function (rad, a) { return (cx + rad * Math.cos(a)).toFixed(2) + ',' + (cy + rad * Math.sin(a)).toFixed(2); };
        var dd = items.length === 1 ? 'M' + p(R, 0) + 'A' + R + ',' + R + ' 0 1 1 ' + p(R, Math.PI) + 'A' + R + ',' + R + ' 0 1 1 ' + p(R, 0) + 'M' + p(r, 0) + 'A' + r + ',' + r + ' 0 1 0 ' + p(r, Math.PI) + 'A' + r + ',' + r + ' 0 1 0 ' + p(r, 0) + 'Z'
          : 'M' + p(R, a0) + 'A' + R + ',' + R + ' 0 ' + large + ' 1 ' + p(R, a1) + 'L' + p(r, a1) + 'A' + r + ',' + r + ' 0 ' + large + ' 0 ' + p(r, a0) + 'Z';
        var path = svgEl('path', { d: dd, fill: col, stroke: T.dark ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.8)', 'stroke-width': 1, 'fill-rule': 'evenodd' });
        path.addEventListener('pointerenter', function () { svg.querySelectorAll('path').forEach(function (q) { q.style.opacity = q === path ? '1' : '.35'; }); setCenter(fmt(it.value, o.format), it.label + ' · ' + (it.value / total * 100).toFixed(0) + '%'); });
        path.addEventListener('pointerleave', function () { svg.querySelectorAll('path').forEach(function (q) { q.style.opacity = '1'; }); setCenter(def.value, def.label); });
        svg.appendChild(path);
        a0 = a1;
      });
      svg.appendChild(center); svg.appendChild(sub); setCenter(def.value, def.label);
      var list = h('div', 'pv-bars'); list.style.flex = '1 1 160px';
      items.forEach(function (it, i) {
        var col = it.color || T.cat[i % T.cat.length];
        list.appendChild(h('div', '', '<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px"><span style="display:flex;gap:7px;align-items:center;color:var(--pv-muted);min-width:0"><i style="width:9px;height:9px;border-radius:3px;background:' + col + ';flex:none"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.label) + '</span></span><span class="pv-num" style="font-size:12px">' + esc(fmt(it.value, o.format)) + ' <span style="color:var(--pv-muted)">' + (it.value / total * 100).toFixed(0) + '%</span></span></div>'));
      });
      wrap.innerHTML = ''; wrap.appendChild(svg); wrap.appendChild(list);
    };
    live(wrap, draw);
    return { el: wrap };
  }

  // ── Sortable table ────────────────────────────────────────────────────────
  function table(target, o) {
    o = opts(o, 'rows');
    var arrRows = Array.isArray((o.rows || [])[0]);
    var cols = (o.columns || Object.keys((o.rows || [])[0] || {})).map(function (c, i) { return typeof c === 'string' ? { key: arrRows ? String(i) : c, label: c } : c; });
    if (!(o.rows || []).length) return { el: emptyNote(target, 'Table') };
    var rows = (o.rows || []).slice();
    var sort = o.sort || null;
    var wrap = h('div', 'pv-scroll');
    mount(target, wrap);
    var draw = function () {
      if (sort) rows.sort(function (a, b) { var x = a[sort.key], y = b[sort.key]; var c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return sort.dir === 'asc' ? c : -c; });
      var mx = {};
      cols.forEach(function (c) { if (c.bar) mx[c.key] = Math.max.apply(null, rows.map(function (r) { return Math.abs(+r[c.key] || 0); }).concat([1])); });
      var html = '<table class="pv-table"><thead><tr>' + cols.map(function (c) { var num = c.align === 'right' || c.format; return '<th data-k="' + esc(c.key) + '"' + (num ? ' style="text-align:right"' : '') + '>' + esc(c.label || c.key) + (sort && sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.slice(0, o.limit || rows.length).forEach(function (r) {
        html += '<tr>' + cols.map(function (c) {
          var v = r[c.key];
          if (c.render) return '<td>' + c.render(v, r) + '</td>';
          if (c.format || typeof v === 'number') {
            var bar = c.bar ? '<span style="display:inline-block;vertical-align:middle;margin-right:8px;height:6px;border-radius:9px;background:' + T.accent + ';opacity:.55;width:' + Math.round(Math.abs(+v || 0) / mx[c.key] * 60) + 'px"></span>' : '';
            var tone = c.tone ? ((+v || 0) > 0 ? ' pv-up' : (+v || 0) < 0 ? ' pv-down' : '') : '';
            return '<td class="n' + tone + '">' + bar + esc(fmt(v, c.format)) + '</td>';
          }
          return '<td' + (String(v == null ? '' : v).length > 32 ? ' class="w"' : '') + '>' + esc(v) + '</td>';
        }).join('') + '</tr>';
      });
      wrap.innerHTML = html + '</tbody></table>';
      wrap.querySelectorAll('th').forEach(function (th) { th.addEventListener('click', function () { var k = th.getAttribute('data-k'); sort = { key: k, dir: sort && sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' }; draw(); }); });
      if (o.ask || o.onRowClick) wrap.querySelectorAll('tbody tr').forEach(function (tr, ri) {
        tr.classList.add('pv-askable');
        tr.addEventListener('click', function () { var r = rows[ri]; if (o.onRowClick) o.onRowClick(r, ri); if (o.ask) asker(o, function () { var ctx = Object.assign({}, r); ctx.row = cols.map(function (c) { return (c.label || c.key) + ': ' + (c.format ? fmt(r[c.key], c.format) : r[c.key]); }).join(', '); return ctx; })(); });
      });
    };
    live(wrap, draw);
    return { el: wrap };
  }

  // ── Design-variant comparison (Theo-style) ────────────────────────────────
  // {variants:[{name, note, html, css, render(el)}], key, pickPrompt:'Build variant {name}'}
  function compare(target, o) {
    o = o || {};
    var vs = o.variants || [];
    var wrap = h('div', 'pv-section');
    mount(target, wrap);
    var cur = o.key ? state.get(o.key, 0) : 0;
    var seg = h('div', 'pv-seg');
    var stage = h('div', 'pv-stage');
    var foot = h('div', 'pv-head');
    var note = h('div', 'pv-sub'); note.style.marginTop = '0';
    var pick = h('button', 'pv-btn', 'Pick this'); pick.type = 'button';
    foot.appendChild(note); foot.appendChild(pick);
    wrap.appendChild(seg); wrap.appendChild(stage); wrap.appendChild(foot);
    var show = function (i) {
      cur = i;
      Array.prototype.forEach.call(seg.children, function (b, j) { b.setAttribute('aria-pressed', String(j === i)); });
      var v = vs[i] || {};
      stage.innerHTML = (v.css ? '<style>' + v.css + '</style>' : '') + (v.html || '');
      if (v.render) v.render(stage);
      note.textContent = v.note || '';
      if (o.key) state.set(o.key, i);
    };
    vs.forEach(function (v, i) { var b = h('button', '', esc(String.fromCharCode(65 + i) + ' · ' + v.name)); b.type = 'button'; b.addEventListener('click', function () { show(i); }); seg.appendChild(b); });
    pick.addEventListener('click', function () { var v = vs[cur] || {}; ask((o.pickPrompt || 'Go with variant {letter} ({name}) and build it.').replace('{name}', v.name || '').replace('{letter}', String.fromCharCode(65 + cur)), 'Picked ' + v.name); pick.textContent = 'Sent ✓'; setTimeout(function () { pick.textContent = 'Pick this'; }, 1600); });
    show(Math.min(cur, vs.length - 1));
    return { el: wrap, show: show };
  }

  // ══ Kit 1.1: controls, simulations, timeline, sankey, forms, tap-to-ask, export ══
  styleEl.textContent += '\n' + [
    ".pv-params{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:12px 18px}",
    ".pv-slider{display:flex;flex-direction:column;gap:6px;min-width:0}",
    ".pv-slider .top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}",
    ".pv-slider label{font:600 10px/1.2 var(--pv-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--pv-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".pv-slider output{font:600 14px var(--pv-mono);font-variant-numeric:tabular-nums;color:var(--pv-text)}",
    ".pv-range{-webkit-appearance:none;appearance:none;width:100%;height:28px;background:transparent;margin:0;touch-action:pan-y;cursor:pointer}",
    ".pv-range::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--pv-accent) var(--p,50%),var(--pv-soft) var(--p,50%))}",
    ".pv-range::-moz-range-track{height:6px;border-radius:999px;background:var(--pv-soft)}",
    ".pv-range::-moz-range-progress{height:6px;border-radius:999px;background:var(--pv-accent)}",
    ".pv-range::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;background:var(--pv-text);border:3px solid var(--pv-accent);box-shadow:0 2px 6px rgba(0,0,0,.25)}",
    ".pv-range::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--pv-text);border:3px solid var(--pv-accent)}",
    ".pv-player{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
    ".pv-player .pv-num{font-size:12px;color:var(--pv-muted)}",
    ".pv-form{display:flex;flex-direction:column;gap:12px}",
    ".pv-field{display:flex;flex-direction:column;gap:6px;min-width:0}",
    ".pv-field>span{font:600 10px/1.2 var(--pv-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--pv-muted)}",
    ".pv-input{all:unset;box-sizing:border-box;width:100%;padding:9px 12px;border-radius:10px;border:1px solid var(--pv-line-2);background:var(--pv-soft);color:var(--pv-text);font:500 14px var(--pv-font)}",
    ".pv-input:focus{border-color:var(--pv-accent)}",
    "textarea.pv-input{min-height:72px;white-space:pre-wrap}",
    "select.pv-input{appearance:none;-webkit-appearance:none;cursor:pointer}",
    "select.pv-input option{background:var(--pv-tipbg);color:var(--pv-text)}",
    ".pv-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;font-size:13.5px}",
    ".pv-toggle input{position:absolute;opacity:0;pointer-events:none}",
    ".pv-toggle i{flex:none;width:40px;height:24px;border-radius:999px;background:var(--pv-soft);border:1px solid var(--pv-line-2);position:relative;transition:background .15s}",
    ".pv-toggle i:after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--pv-muted);transition:transform .15s,background .15s}",
    ".pv-toggle input:checked+i{background:var(--pv-accent);border-color:transparent}",
    ".pv-toggle input:checked+i:after{transform:translateX(16px);background:var(--pv-on-accent)}",
    ".pv-chips{display:flex;flex-wrap:wrap;gap:6px}",
    ".pv-chips button{all:unset;cursor:pointer;padding:5px 11px;border-radius:999px;border:1px solid var(--pv-line-2);font:600 12px var(--pv-font);color:var(--pv-text)}",
    ".pv-chips button[aria-pressed=true]{background:var(--pv-accent);color:var(--pv-on-accent);border-color:transparent}",
    ".pv-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    ".pv-tl{position:relative;min-width:0}",
    ".pv-tl .bar{cursor:pointer;transition:opacity .15s}.pv-tl .bar:hover{opacity:.8}",
    ".pv-sk path{transition:opacity .15s;cursor:pointer}.pv-sk rect{cursor:pointer}",
    ".pv-askable{cursor:pointer}",
    ".pv-toast{position:fixed;left:50%;bottom:14px;transform:translateX(-50%) translateY(8px);padding:8px 14px;border-radius:999px;background:var(--pv-tipbg);border:1px solid var(--pv-line-2);color:var(--pv-text);font:600 12px var(--pv-font);opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;z-index:60;white-space:nowrap}",
    ".pv-toast.on{opacity:1;transform:translateX(-50%)}",
    ".pv-export{display:flex;gap:6px;align-items:center}",
    ".pv-export button{all:unset;cursor:pointer;padding:4px 10px;border-radius:999px;border:1px solid var(--pv-line);font:600 11px var(--pv-mono);letter-spacing:.04em;color:var(--pv-muted)}",
    ".pv-export button:hover{color:var(--pv-text);border-color:var(--pv-line-2)}",
    ".pv-exporting .pv-export,.pv-exporting .pv-noexport{display:none!important}"
  ].join('\n');

  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = h('div', 'pv-toast'); (d.body || root).appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 1800);
  }
  // Put text in the chat composer without sending it (tap-to-ask). Falls back to sending.
  function insert(text, o) {
    o = o || {};
    var s = String(text || '').trim(); if (!s) return;
    var pv = window.prometheusVisual;
    try {
      if (pv && pv.insertPrompt) pv.insertPrompt({ prompt: s, send: !!o.send });
      else if (pv && pv.sendFollowUpMessage) pv.sendFollowUpMessage({ prompt: s, title: '' });
    } catch (e) {}
    toast(o.send ? 'Sent to chat' : 'Added to the composer');
  }
  function tpl(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? '' : String(vars[k]); });
  }
  // o.ask: string template or function(ctx) -> text. Returns a click handler or null.
  function asker(o, ctxFn) {
    if (!o || !o.ask) return null;
    return function () {
      var ctx = ctxFn.apply(null, arguments);
      var text = typeof o.ask === 'function' ? o.ask(ctx) : tpl(o.ask, ctx);
      insert(text, { send: !!o.askSend });
    };
  }

  // ── Sliders + parameter panels ────────────────────────────────────────────
  // ui.slider(t, {label, min, max, step, value, format, key, onChange(v)}) -> {el, get, set}
  function slider(target, o) {
    o = o || {};
    var min = o.min != null ? +o.min : 0, max = o.max != null ? +o.max : 100, step = o.step != null ? +o.step : (max - min) / 100;
    var val = o.key ? state.get(o.key, o.value != null ? o.value : min) : (o.value != null ? +o.value : min);
    var wrap = h('div', 'pv-slider');
    var id = 'pvs' + Math.random().toString(36).slice(2, 8);
    wrap.innerHTML = '<div class="top"><label for="' + id + '">' + esc(o.label || '') + '</label><output class="pv-num"></output></div>';
    var inp = h('input', 'pv-range'); inp.type = 'range'; inp.id = id;
    inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    if (o.label) inp.setAttribute('aria-label', o.label);
    wrap.appendChild(inp);
    if (o.note) wrap.appendChild(h('div', 'pv-foot', esc(o.note)));
    var out = wrap.querySelector('output');
    var paint = function () {
      var v = +inp.value;
      out.textContent = fmt(v, o.format || 'num');
      inp.style.setProperty('--p', ((v - min) / (max - min || 1) * 100).toFixed(2) + '%');
    };
    var saveT = 0;
    inp.addEventListener('input', function () {
      paint(); val = +inp.value;
      if (o.onChange) o.onChange(val);
      if (o.key) { clearTimeout(saveT); saveT = setTimeout(function () { state.set(o.key, val); }, 250); }
    });
    paint();
    mount(target, wrap);
    return { el: wrap, input: inp, get: function () { return +inp.value; }, set: function (v) { inp.value = v; paint(); val = +v; if (o.onChange) o.onChange(val); } };
  }
  // ui.params(t, {params:[{key,label,min,max,step,value,format,note}], onChange(values), card:true}) -> {values, el, set}
  function params(target, o) {
    o = o || {};
    var box = h('div', 'pv-params' + (o.card === false ? '' : ' pv-card'));
    mount(target, box);
    var values = {};
    var fire = function () { if (o.onChange) o.onChange(Object.assign({}, values)); };
    var ctrls = {};
    (o.params || []).forEach(function (p) {
      var c = slider(box, Object.assign({}, p, {
        key: p.key && o.key !== false ? 'param:' + p.key : null,
        onChange: function (v) { values[p.key] = v; fire(); }
      }));
      values[p.key] = c.get(); ctrls[p.key] = c;
    });
    setTimeout(fire, 0);
    return { el: box, values: values, set: function (k, v) { if (ctrls[k]) ctrls[k].set(v); } };
  }

  // ── Animation loop for simulations ────────────────────────────────────────
  // ui.loop(t|null, {step(dt, t, frame), autoplay, speed, controls:true, label, reset()}) -> {play, pause, reset, running}
  function loop(target, o) {
    if (typeof target === 'function') { o = { step: target }; target = null; }
    o = o || {};
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var running = false, raf = 0, last = 0, t = 0, frame = 0, speed = o.speed || 1;
    var btn = null, clock = null;
    var tick = function (now) {
      if (!running) return;
      var dt = Math.min(0.1, (now - (last || now)) / 1000) * speed; last = now; t += dt; frame++;
      try { o.step && o.step(dt, t, frame); } catch (e) { pause(); throw e; }
      if (clock) clock.textContent = 't = ' + t.toFixed(1) + 's';
      raf = requestAnimationFrame(tick);
    };
    function play() { if (running) return; running = true; last = 0; if (btn) btn.textContent = '❚❚ Pause'; raf = requestAnimationFrame(tick); }
    function pause() { running = false; cancelAnimationFrame(raf); if (btn) btn.textContent = '▶ Play'; }
    function reset() { pause(); t = 0; frame = 0; if (clock) clock.textContent = 't = 0.0s'; if (o.reset) o.reset(); }
    if (o.controls !== false && target !== false) {
      var bar = h('div', 'pv-player pv-noexport');
      btn = h('button', 'pv-btn', '▶ Play'); btn.type = 'button';
      btn.addEventListener('click', function () { running ? pause() : play(); });
      var rs = h('button', 'pv-btn ghost', '↺ Reset'); rs.type = 'button'; rs.addEventListener('click', reset);
      bar.appendChild(btn); bar.appendChild(rs);
      if (o.speeds !== false) {
        segmented(bar, { options: [{ label: '0.5×', value: 0.5 }, { label: '1×', value: 1 }, { label: '2×', value: 2 }], value: speed, onChange: function (v) { speed = v; } });
      }
      clock = h('span', 'pv-num', 't = 0.0s'); bar.appendChild(clock);
      mount(target, bar);
    }
    d.addEventListener('visibilitychange', function () { if (d.hidden && running) { pause(); } });
    if (o.autoplay !== false && !reduce) setTimeout(play, 60);
    return { play: play, pause: pause, reset: reset, running: function () { return running; } };
  }

  // ── Timeline / Gantt ──────────────────────────────────────────────────────
  // ui.timeline(t, {items:[{lane, label, start, end, status:'ok'|'bad'|'warn'|'run', color, note}],
  //   format:'time'|'date'|'num'|fn, markers:[{at,label}], now, ask, onClick(item)})
  // start/end: Date | ISO string | number. Missing end = point event (or running to `now`).
  function toNum(v) { if (v == null || v === '') return null; if (typeof v === 'number') return v; var t = Date.parse(v); return isNaN(t) ? +v : t; }
  function timeline(target, o) {
    o = o || {};
    var wrap = h('div', 'pv-tl');
    mount(target, wrap);
    var items = (o.items || []).map(function (it, i) {
      var s = toNum(it.start), e = toNum(it.end);
      if (e == null && it.status === 'run') e = toNum(o.now) || Date.now();
      return Object.assign({}, it, { _s: s, _e: e == null ? s : e, _i: i });
    }).filter(function (it) { return it._s != null; });
    var lanes = [];
    items.forEach(function (it) { var l = it.lane == null ? '' : String(it.lane); if (lanes.indexOf(l) < 0) lanes.push(l); });
    var isTime = o.format === 'time' || o.format === 'date' || (o.format == null && items.length && items[0]._s > 1e11);
    var fx = function (v) {
      if (typeof o.format === 'function') return o.format(v);
      if (!isTime) return fmt(v, o.format || 'num');
      var dt = new Date(v);
      if (o.format === 'date') return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };
    var span = function (it) {
      var dur = it._e - it._s;
      if (!isTime) return fmt(dur, o.format || 'num');
      return fmt(dur / 1000, 'dur');
    };
    var colorOf = function (it) {
      if (it.color) return it.color;
      if (it.status === 'bad') return T.bad; if (it.status === 'warn') return T.warn;
      if (it.status === 'ok') return T.ok; if (it.status === 'run') return T.accent;
      var li = lanes.indexOf(it.lane == null ? '' : String(it.lane));
      return o.colorBy === 'lane' ? T.cat[li % T.cat.length] : T.accent;
    };
    var click = asker(o, function (it) { return { label: it.label || '', lane: it.lane || '', start: fx(it._s), end: fx(it._e), duration: span(it), status: it.status || '', note: it.note || '' }; });
    live(wrap, function (W) {
      wrap.innerHTML = '';
      if (!items.length) { wrap.appendChild(h('div', 'pv-foot', 'No events')); return; }
      var mn = Math.min.apply(null, items.map(function (i) { return i._s; }));
      var mx = Math.max.apply(null, items.map(function (i) { return i._e; }));
      (o.markers || []).forEach(function (m) { var a = toNum(m.at); if (a != null) { mn = Math.min(mn, a); mx = Math.max(mx, a); } });
      if (mx === mn) mx = mn + (isTime ? 60000 : 1);
      var compact = W < 420;
      var labW = lanes.length > 1 || lanes[0] ? Math.min(compact ? 84 : 130, Math.max.apply(null, lanes.map(function (l) { return l.length; })) * 6.6 + 12) : 0;
      var rowH = compact ? 26 : 28, M = { l: labW, r: 8, t: (o.markers && o.markers.length) ? 22 : 6, b: 22 };
      var iw = W - M.l - M.r, H = M.t + lanes.length * rowH + M.b;
      var X = function (v) { return M.l + (v - mn) / (mx - mn) * iw; };
      var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H, role: 'img', 'aria-label': o.title || 'timeline' });
      var nt = Math.max(2, Math.floor(iw / (compact ? 70 : 96)));
      for (var k = 0; k <= nt; k++) {
        var tv = mn + (mx - mn) * k / nt, tx = X(tv);
        svg.appendChild(svgEl('line', { x1: tx, x2: tx, y1: M.t, y2: H - M.b, stroke: T.grid }));
        var tl = svgEl('text', { x: tx, y: H - 6, 'text-anchor': k === 0 ? 'start' : k === nt ? 'end' : 'middle', class: 'pv-ax' }); tl.textContent = fx(tv); svg.appendChild(tl);
      }
      lanes.forEach(function (l, li) {
        var y = M.t + li * rowH;
        if (li % 2) svg.appendChild(svgEl('rect', { x: 0, y: y, width: W, height: rowH, fill: T.text, 'fill-opacity': 0.025 }));
        if (labW) { var lt = svgEl('text', { x: labW - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'pv-ax' }); lt.textContent = l.length > 18 ? l.slice(0, 17) + '…' : l; svg.appendChild(lt); }
      });
      items.forEach(function (it) {
        var li = lanes.indexOf(it.lane == null ? '' : String(it.lane));
        var y = M.t + li * rowH + 5, bh = rowH - 10, x0 = X(it._s), x1 = X(it._e), col = colorOf(it);
        var g = svgEl('g', { class: 'bar' });
        if (x1 - x0 < 3) {
          g.appendChild(svgEl('circle', { cx: x0, cy: y + bh / 2, r: 5, fill: col, stroke: T.dark ? '#000' : '#fff', 'stroke-width': 1.5 }));
        } else {
          g.appendChild(svgEl('rect', { x: x0, y: y, width: Math.max(3, x1 - x0), height: bh, rx: Math.min(5, bh / 2), fill: col, opacity: it.status === 'run' ? 0.75 : 0.92 }));
          if (it.status === 'run') g.appendChild(svgEl('rect', { x: Math.max(x0, x1 - 3), y: y, width: 3, height: bh, fill: T.text, opacity: 0.8 }));
          if (it.label && x1 - x0 > 54) {
            var bt = svgEl('text', { x: x0 + 7, y: y + bh / 2 + 4, style: 'font:600 11px var(--pv-font);fill:' + textOn(col) + ';pointer-events:none' });
            var maxc = Math.floor((x1 - x0 - 12) / 6.4); bt.textContent = it.label.length > maxc ? it.label.slice(0, Math.max(1, maxc - 1)) + '…' : it.label;
            g.appendChild(bt);
          }
        }
        bindHover(g, function (cx, cy) {
          showTip(tipRows(it.label || it.lane, [
            { label: 'Start', value: fx(it._s), color: col },
            { label: 'Duration', value: x1 - x0 < 3 && it._e === it._s ? 'point' : span(it) }
          ].concat(it.status ? [{ label: 'Status', value: it.status === 'run' ? 'running' : it.status }] : []).concat(it.note ? [{ label: it.note, value: '' }] : [])), cx, cy);
        });
        if (click || o.onClick) g.addEventListener('click', function () { hideTip(); if (o.onClick) o.onClick(it); if (click) click(it); });
        svg.appendChild(g);
      });
      (o.markers || []).forEach(function (m) {
        var a = toNum(m.at); if (a == null) return; var mxp = X(a);
        svg.appendChild(svgEl('line', { x1: mxp, x2: mxp, y1: M.t - 4, y2: H - M.b, stroke: T.text, 'stroke-opacity': 0.45, 'stroke-dasharray': '2 3' }));
        var mt = svgEl('text', { x: mxp, y: M.t - 9, 'text-anchor': mxp > W * 0.75 ? 'end' : mxp < W * 0.25 ? 'start' : 'middle', class: 'pv-ax', style: 'fill:' + T.text + ';font-weight:600' });
        mt.textContent = m.label || ''; svg.appendChild(mt);
      });
      wrap.appendChild(svg);
    });
    return { el: wrap };
  }

  // ── Sankey / flow ─────────────────────────────────────────────────────────
  // ui.sankey(t, {links:[{source, target, value}], format, height, ask, onClick(node|link)})
  function sankey(target, o) {
    o = o || {};
    var wrap = h('div', 'pv-sk pv-chart');
    mount(target, wrap);
    var links = (o.links || []).filter(function (l) { return l && l.source != null && l.target != null && +l.value > 0; })
      .map(function (l) { return { s: String(l.source), t: String(l.target), v: +l.value }; });
    var names = [];
    links.forEach(function (l) { [l.s, l.t].forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); }); });
    var nodes = names.map(function (n) { return { name: n, ins: [], outs: [], col: 0 }; });
    var by = {}; nodes.forEach(function (n) { by[n.name] = n; });
    links.forEach(function (l) { l.src = by[l.s]; l.tgt = by[l.t]; l.src.outs.push(l); l.tgt.ins.push(l); });
    // longest-path layering (guards cycles by capping iterations)
    for (var it = 0; it < nodes.length; it++) {
      var moved = false;
      links.forEach(function (l) { if (l.tgt.col < l.src.col + 1 && l.src.col + 1 < nodes.length) { l.tgt.col = l.src.col + 1; moved = true; } });
      if (!moved) break;
    }
    var maxCol = Math.max.apply(null, nodes.map(function (n) { return n.col; }).concat([0]));
    // sinks to the last column
    nodes.forEach(function (n) { if (!n.outs.length && n.ins.length) n.col = maxCol; });
    nodes.forEach(function (n) { n.v = Math.max(n.ins.reduce(function (a, l) { return a + l.v; }, 0), n.outs.reduce(function (a, l) { return a + l.v; }, 0)); });
    var click = asker(o, function (x) { return x.name != null ? { name: x.name, value: fmt(x.v, o.format) } : { source: x.s, target: x.t, value: fmt(x.v, o.format), name: x.s + ' → ' + x.t }; });
    live(wrap, function (W) {
      wrap.innerHTML = '';
      if (!links.length) { wrap.appendChild(h('div', 'pv-foot', 'No flows')); return; }
      var compact = W < 420, H = o.height || (compact ? 300 : 340);
      var nodeW = compact ? 10 : 12, pad = compact ? 8 : 12, labRoom = compact ? 0 : 0;
      var cols = []; nodes.forEach(function (n) { (cols[n.col] = cols[n.col] || []).push(n); });
      var scale = Infinity;
      cols.forEach(function (c) { if (!c) return; var tot = c.reduce(function (a, n) { return a + n.v; }, 0); scale = Math.min(scale, (H - pad * (c.length - 1) - 8) / (tot || 1)); });
      var colX = function (ci) { return 4 + labRoom + (maxCol ? ci * (W - 8 - nodeW - labRoom * 2) / maxCol : 0); };
      cols.forEach(function (c) {
        if (!c) return;
        c.sort(function (a, b) { return b.v - a.v; });
        var tot = c.reduce(function (a, n) { return a + n.v * scale; }, 0) + pad * (c.length - 1);
        var y = (H - tot) / 2;
        c.forEach(function (n) { n.x = colX(n.col); n.y = y; n.h = Math.max(2, n.v * scale); y += n.h + pad; n.oy = n.y; n.iy = n.y; });
      });
      nodes.forEach(function (n) { n.outs.sort(function (a, b) { return a.tgt.y - b.tgt.y; }); n.ins.sort(function (a, b) { return a.src.y - b.src.y; }); });
      var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H, role: 'img', 'aria-label': o.title || 'flow diagram' });
      var colorOf = function (n) { var top = n; while (top.ins.length && top.col > 0) top = top.ins[0].src; return T.cat[nodes.indexOf(top) % T.cat.length]; };
      var paths = [];
      nodes.forEach(function (n) { n.outs.forEach(function (l) {
        var w = l.v * scale, x0 = n.x + nodeW, x1 = l.tgt.x, y0 = n.oy + w / 2, y1 = l.tgt.iy + w / 2;
        n.oy += w; l.tgt.iy += w;
        var mx2 = (x0 + x1) / 2, col = colorOf(n);
        var p = svgEl('path', { d: 'M' + x0 + ',' + y0 + 'C' + mx2 + ',' + y0 + ' ' + mx2 + ',' + y1 + ' ' + x1 + ',' + y1, fill: 'none', stroke: col, 'stroke-opacity': T.dark ? 0.38 : 0.32, 'stroke-width': Math.max(1, w) });
        p._l = l; paths.push(p); svg.appendChild(p);
        bindHover(p, function (cx, cy) {
          paths.forEach(function (q) { q.style.opacity = q === p ? '1' : '.35'; });
          showTip(tipRows(l.s + ' → ' + l.t, [{ label: o.valueLabel || 'Flow', value: fmt(l.v, o.format), color: col }, { label: 'Share of ' + l.s, value: (l.v / (n.v || 1) * 100).toFixed(1) + '%' }]), cx, cy);
        }, function () { paths.forEach(function (q) { q.style.opacity = ''; }); });
        if (click || o.onClick) p.addEventListener('click', function () { hideTip(); if (o.onClick) o.onClick(l); if (click) click(l); });
      }); });
      nodes.forEach(function (n) {
        var col = colorOf(n);
        var r = svgEl('rect', { x: n.x, y: n.y, width: nodeW, height: n.h, rx: 2, fill: col });
        svg.appendChild(r);
        bindHover(r, function (cx, cy) {
          paths.forEach(function (q) { q.style.opacity = q._l.src === n || q._l.tgt === n ? '1' : '.25'; });
          showTip(tipRows(n.name, [{ label: o.valueLabel || 'Total', value: fmt(n.v, o.format), color: col }]), cx, cy);
        }, function () { paths.forEach(function (q) { q.style.opacity = ''; }); });
        if (click || o.onClick) r.addEventListener('click', function () { hideTip(); if (o.onClick) o.onClick(n); if (click) click(n); });
        if (n.h >= 9 || !compact) {
          var right = n.col < maxCol;
          var lt = svgEl('text', { x: right ? n.x + nodeW + 6 : n.x - 6, y: n.y + n.h / 2 + 4, 'text-anchor': right ? 'start' : 'end', style: 'font:600 11px var(--pv-font);fill:' + T.text + ';paint-order:stroke;stroke:' + (T.dark ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.75)') + ';stroke-width:3px;pointer-events:none' });
          lt.textContent = n.name + (compact ? '' : ' · ' + fmt(n.v, o.format));
          svg.appendChild(lt);
        }
      });
      wrap.appendChild(svg);
    });
    return { el: wrap };
  }

  // ── Forms that hand structured data back to the model ─────────────────────
  // ui.form(t, {title, fields:[{key, label, type:'text'|'number'|'textarea'|'select'|'toggle'|'chips'|'slider',
  //   options, value, min, max, step, format, multiple, placeholder, required}], submit:'Send',
  //   prompt:'Template {key}' | fn(values), send:true, key, onSubmit(values)}) -> {el, values()}
  function form(target, o) {
    o = o || {};
    // Not a <form>: the visual sandbox has no allow-forms, so native submit is blocked.
    var box = h('div', 'pv-form pv-card'); box.setAttribute('role', 'form');
    if (o.title) box.appendChild(h('div', 'pv-title', esc(o.title)));
    if (o.subtitle) box.appendChild(h('div', 'pv-sub', esc(o.subtitle)));
    var saved = o.key ? state.get(o.key, {}) || {} : {};
    var getters = {};
    (o.fields || []).forEach(function (f, idx) {
      var key = f.key || ('field' + idx), type = f.type || 'text';
      var init = saved[key] != null ? saved[key] : f.value;
      var opts = (f.options || []).map(function (op) { return typeof op === 'object' ? op : { label: String(op), value: op }; });
      if (type === 'slider') {
        var sl = slider(box, { label: f.label, min: f.min, max: f.max, step: f.step, value: init, format: f.format, note: f.note });
        getters[key] = sl.get; return;
      }
      if (type === 'toggle') {
        var tg = h('label', 'pv-toggle');
        tg.innerHTML = '<span>' + esc(f.label || key) + '</span><input type="checkbox"' + (init ? ' checked' : '') + '><i></i>';
        box.appendChild(tg);
        var cb = tg.querySelector('input'); getters[key] = function () { return !!cb.checked; }; return;
      }
      var fld = h('label', 'pv-field');
      fld.appendChild(h('span', '', esc(f.label || key) + (f.required ? ' *' : '')));
      if (type === 'chips') {
        var sel = Array.isArray(init) ? init.slice() : init != null ? [init] : [];
        var chips = h('div', 'pv-chips');
        opts.forEach(function (op) {
          var b = h('button', '', esc(op.label)); b.type = 'button';
          var paint = function () { b.setAttribute('aria-pressed', String(sel.indexOf(op.value) >= 0)); };
          b.addEventListener('click', function () {
            var at = sel.indexOf(op.value);
            if (f.multiple) { if (at >= 0) sel.splice(at, 1); else sel.push(op.value); }
            else sel = at >= 0 ? [] : [op.value];
            Array.prototype.forEach.call(chips.children, function (c) { c._paint && c._paint(); });
          });
          b._paint = paint; paint(); chips.appendChild(b);
        });
        fld.appendChild(chips); box.appendChild(fld);
        getters[key] = function () { return f.multiple ? sel.slice() : (sel[0] == null ? null : sel[0]); }; return;
      }
      var inp;
      if (type === 'select') {
        inp = h('select', 'pv-input');
        opts.forEach(function (op) { var e = d.createElement('option'); e.value = String(op.value); e.textContent = op.label; inp.appendChild(e); });
        if (init != null) inp.value = String(init);
      } else if (type === 'textarea') {
        inp = h('textarea', 'pv-input'); if (init != null) inp.value = init;
      } else {
        inp = h('input', 'pv-input'); inp.type = type === 'number' ? 'number' : 'text';
        if (f.min != null) inp.min = f.min; if (f.max != null) inp.max = f.max; if (f.step != null) inp.step = f.step;
        if (init != null) inp.value = init;
      }
      if (f.placeholder) inp.placeholder = f.placeholder;
      fld.appendChild(inp); box.appendChild(fld);
      getters[key] = function () {
        if (type === 'number') return inp.value === '' ? null : +inp.value;
        if (type === 'select') { var m = opts.filter(function (op) { return String(op.value) === inp.value; })[0]; return m ? m.value : inp.value; }
        return inp.value;
      };
    });
    var values = function () { var v = {}; Object.keys(getters).forEach(function (k) { v[k] = getters[k](); }); return v; };
    var acts = h('div', 'pv-actions pv-noexport');
    var btn = h('button', 'pv-btn', esc(o.submit || 'Send to Prom')); btn.type = 'button';
    acts.appendChild(btn);
    var msg = h('span', 'pv-foot', ''); acts.appendChild(msg);
    box.appendChild(acts);
    box.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); btn.click(); } });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var v = values();
      var missing = (o.fields || []).filter(function (f) { var x = v[f.key]; return f.required && (x == null || x === '' || (Array.isArray(x) && !x.length)); });
      if (missing.length) { msg.textContent = 'Fill in: ' + missing.map(function (f) { return f.label || f.key; }).join(', '); msg.style.color = 'var(--pv-bad)'; return; }
      msg.textContent = ''; msg.style.color = '';
      if (o.key) state.set(o.key, v);
      if (o.onSubmit) o.onSubmit(v);
      if (o.prompt !== false) {
        var lead = typeof o.prompt === 'function' ? o.prompt(v) : o.prompt ? tpl(o.prompt, Object.keys(v).reduce(function (a, k) { a[k] = Array.isArray(v[k]) ? v[k].join(', ') : v[k]; return a; }, {})) : (o.title ? o.title + ':' : 'Form values:');
        var text = lead + '\n```json\n' + JSON.stringify(v, null, 2) + '\n```';
        insert(text, { send: o.send !== false });
      }
      btn.textContent = 'Sent ✓'; setTimeout(function () { btn.textContent = o.submit || 'Send to Prom'; }, 1600);
    });
    mount(target, box);
    return { el: box, values: values };
  }

  // ── Export: PNG (incl. X-post 16:9), SVG fallback, CSV ────────────────────
  function deliver(name, dataUrl, mime) {
    var inFrame = false; try { inFrame = window.parent && window.parent !== window; } catch (e) {}
    var pv = window.prometheusVisual;
    if (inFrame && pv && pv.download) { pv.download({ name: name, dataUrl: dataUrl, mime: mime }); toast('Saved ' + name); return; }
    var a = d.createElement('a'); a.href = dataUrl; a.download = name; (d.body || root).appendChild(a); a.click(); a.remove();
    toast('Saved ' + name);
  }
  function cssVarsBlock() {
    var cs = getComputedStyle(root), out = [];
    for (var i = 0; i < cs.length; i++) { var n = cs[i]; if (n.indexOf('--') === 0) out.push(n + ':' + cs.getPropertyValue(n)); }
    return ':root{' + out.join(';') + '}';
  }
  // ui.toPng(el?, {name, scale:2, x:true (1600×900 card), title}) -> Promise
  function toPng(el, o) {
    if (el && !el.nodeType && typeof el === 'object' && !(typeof el === 'string')) { o = el; el = null; }
    o = o || {};
    var node = el ? host(el) : (pageRoot || d.body);
    var bg = T.dark ? (getComputedStyle(root).getPropertyValue('--pv-tipbg') || '#111').trim() : '#ffffff';
    var bgTok = tokenColor('--prom-bg', 'transparent'); if (bgTok && bgTok.a > 0.9) bg = rgb(bgTok, 1);
    root.classList.add('pv-exporting');
    var W = Math.ceil(o.x ? 1200 : node.getBoundingClientRect().width || 600);
    // cloneNode copies attributes, not live control state: bake current values in first.
    var liveCtl = node.querySelectorAll('input,select,textarea');
    var clone = node.cloneNode(true);
    var cloneCtl = clone.querySelectorAll('input,select,textarea');
    Array.prototype.forEach.call(liveCtl, function (src, i) {
      var c = cloneCtl[i]; if (!c) return;
      if (src.type === 'checkbox' || src.type === 'radio') { c.style.display = 'none'; if (src.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
      else if (src.tagName === 'TEXTAREA') c.textContent = src.value;
      else if (src.tagName === 'SELECT') { Array.prototype.forEach.call(c.options, function (op, j) { if (j === src.selectedIndex) op.setAttribute('selected', ''); else op.removeAttribute('selected'); }); }
      else c.setAttribute('value', src.value);
    });
    root.classList.remove('pv-exporting');
    Array.prototype.forEach.call(clone.querySelectorAll('.pv-export,.pv-noexport,script'), function (n) { n.remove(); });
    var styles = Array.prototype.map.call(d.querySelectorAll('style'), function (s) { return s.textContent; }).join('\n').replace(/@font-face\{[^}]*\}/g, '');
    var probeHost = h('div', ''); probeHost.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + W + 'px';
    probeHost.appendChild(clone.cloneNode(true)); (d.body || root).appendChild(probeHost);
    var H = Math.ceil(probeHost.getBoundingClientRect().height) + 4; probeHost.remove();
    var pad = o.x ? 48 : 16, outW = W + pad * 2, outH = H + pad * 2;
    if (o.x) { outW = 1600; outH = Math.max(900, H + pad * 2); }
    var scale = o.scale || (o.x ? 1 : 2);
    var html = '<div xmlns="http://www.w3.org/1999/xhtml" class="pv-export-root" style="width:' + W + 'px;padding:' + pad + 'px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:' + T.text + '"><style>' + cssVarsBlock() + styles.replace(/<\/?style>/g, '') + '.pv-in,.pv-in *{animation:none!important;opacity:1!important;transform:none!important}.pv-bar-f{transition:none!important}</style>' + new XMLSerializer().serializeToString(clone) + '</div>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (W + pad * 2) + '" height="' + (H + pad * 2) + '"><foreignObject width="100%" height="100%">' + html + '</foreignObject></svg>';
    var svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    var base = (o.name || (o.title || 'prometheus-visual')).replace(/[^\w.-]+/g, '-').toLowerCase().replace(/\.png$/, '');
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = d.createElement('canvas'); c.width = outW * scale; c.height = outH * scale;
          var g = c.getContext('2d'); g.scale(scale, scale);
          g.fillStyle = bg; g.fillRect(0, 0, outW, outH);
          var dx = o.x ? Math.max(0, (outW - (W + pad * 2)) / 2) : 0, dy = o.x ? Math.max(0, (outH - (H + pad * 2)) / 2) : 0;
          g.drawImage(img, dx, dy);
          deliver(base + (o.x ? '-x' : '') + '.png', c.toDataURL('image/png'), 'image/png'); resolve(true);
        } catch (e) { deliver(base + '.svg', svgUrl, 'image/svg+xml'); resolve(false); }
      };
      img.onerror = function () { deliver(base + '.svg', svgUrl, 'image/svg+xml'); resolve(false); };
      img.src = svgUrl;
    });
  }
  // ui.csv(rows, {name, columns:[key|{key,label}]}) - rows = array of objects or arrays
  function csv(rows, o) {
    o = o || {};
    rows = rows || [];
    var cols = o.columns ? o.columns.map(function (c) { return typeof c === 'object' ? c : { key: c, label: c }; })
      : rows.length && !Array.isArray(rows[0]) ? Object.keys(rows[0]).map(function (k) { return { key: k, label: k }; }) : null;
    var q = function (v) { v = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [];
    if (cols) { lines.push(cols.map(function (c) { return q(c.label || c.key); }).join(',')); rows.forEach(function (r) { lines.push(cols.map(function (c) { return q(r[c.key]); }).join(',')); }); }
    else rows.forEach(function (r) { lines.push((r || []).map(q).join(',')); });
    var name = (o.name || 'prometheus-data').replace(/\.csv$/, '') + '.csv';
    deliver(name, 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + lines.join('\n')), 'text/csv');
  }
  // ui.exportBar(t, {png:true, x:true, csv:rows|fn, name}) -> small button row (hidden in exports)
  function exportBar(target, o) {
    o = o || {};
    var bar = h('div', 'pv-export');
    var add = function (label, fn) { var b = h('button', '', label); b.type = 'button'; b.addEventListener('click', fn); bar.appendChild(b); };
    if (o.png !== false) add('PNG', function () { toPng(o.el || null, { name: o.name }); });
    if (o.x !== false) add('X post', function () { toPng(o.el || null, { name: o.name, x: true }); });
    if (o.csv) add('CSV', function () { csv(typeof o.csv === 'function' ? o.csv() : o.csv, { name: o.name, columns: o.columns }); });
    mount(target, bar);
    return bar;
  }




  // ── Public API ────────────────────────────────────────────────────────────
  readTheme();
  var api = {
    version: '1.1.2',
    slider: slider, params: params, loop: loop, timeline: timeline, sankey: sankey, form: form,
    insert: insert, toast: toast, toPng: toPng, csv: csv, exportBar: exportBar,
    page: page, section: section, grid: grid, card: card, callout: callout, badge: badge,
    kpis: kpis, chart: chart, bars: bars, heatmap: heatmap, treemap: treemap, donut: donut, table: table,
    tabs: tabs, segmented: segmented, legend: legend, compare: compare,
    spark: spark, fmt: fmt, esc: esc, h: h, tooltip: { show: showTip, hide: hideTip, rows: tipRows },
    color: { theme: function () { return T; }, cat: function (i) { return T.cat[i % T.cat.length]; }, seq: seq, div: div, textOn: textOn },
    state: state, ask: ask, live: live,
    // Read-only data bridge: the host may inject window.PROM_DATA; models can also inline JSON in <script type="application/json" id="data">.
    data: function (id) {
      if (window.PROM_DATA && id && window.PROM_DATA[id] != null) return window.PROM_DATA[id];
      var el = d.getElementById(id || 'data');
      if (el && el.type === 'application/json') { try { return JSON.parse(el.textContent); } catch (e) { return null; } }
      return window.PROM_DATA || null;
    },
    ready: function (fn) { if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', fn); else fn(); }
  };
  window.PV = api;
  if (!window.ui) window.ui = api;
  // Keep the theme in sync if the body is created after the kit loaded.
  api.ready(function () { readTheme(); });
})();
