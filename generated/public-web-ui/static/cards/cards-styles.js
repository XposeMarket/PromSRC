// Theme: host tokens with fallbacks (desktop --text/--line/--brand, mobile
// --pm-*, visual bridge --prom-*). No hardcoded light/dark canvas.
export const CARD_CSS = `
.pcx,.pc-followups{--pc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--pc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--pc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--pc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--pc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.11))));--pc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));--pc-ok:var(--prom-success,#22a06b);--pc-bad:var(--prom-danger,#e5484d)}
.pc-inline-card{margin:12px 0}.pc-inline-card>.pcx,.pc-inline-card>*:first-child{margin-top:0}.pcx{display:block;margin:10px 0;max-width:100%;border:1px solid var(--pc-line);border-radius:16px;background:var(--pc-surface);color:var(--pc-text);padding:14px;font-size:14px;line-height:1.45;overflow:hidden;box-sizing:border-box}
.pcx *{box-sizing:border-box}
.pcx svg{width:16px;height:16px;flex:none;vertical-align:-3px}
.pc-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;min-width:0}
.pc-kicker{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--pc-muted)}
.pcx-title{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pcx-title.big{font-size:18px;white-space:normal}
.pc-head .pc-icon-btn,.pc-head .pc-count{margin-left:auto}
.pc-count{font-size:12px;color:var(--pc-muted)}
.pc-muted{color:var(--pc-muted);font-size:12.5px}
.pc-center{text-align:center}
.pc-source{margin-top:8px;font-size:11px;color:var(--pc-muted)}
.pc-error{border-style:dashed}.pc-error-title{font-weight:600;margin-bottom:2px}
.pc-btn{appearance:none;border:1px solid var(--pc-line);background:var(--pc-soft);color:var(--pc-text);border-radius:999px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.pc-btn:hover:not([disabled]){border-color:var(--pc-accent)}
.pc-btn.primary{background:var(--pc-accent);border-color:var(--pc-accent);color:#fff}
.pc-btn.good{border-color:color-mix(in srgb,var(--pc-ok) 50%,transparent);color:var(--pc-ok)}
.pc-btn.bad{border-color:color-mix(in srgb,var(--pc-bad) 50%,transparent);color:var(--pc-bad)}
.pc-btn[disabled]{opacity:.45;cursor:default}
.pc-icon-btn{appearance:none;border:1px solid var(--pc-line);background:transparent;color:var(--pc-text);border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;display:inline-flex;gap:5px;align-items:center}
.pc-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
.pc-actions.split{justify-content:stretch}.pc-actions.split .pc-btn{flex:1}
.pc-chips{display:flex;flex-wrap:wrap;gap:6px}
.pc-chip{appearance:none;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--pc-line);background:transparent;color:var(--pc-text);border-radius:999px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer;text-decoration:none;white-space:nowrap}
.pc-chip:hover{border-color:var(--pc-accent)}.pc-chip.primary{background:var(--pc-accent);border-color:var(--pc-accent);color:#fff}
.pc-chip.sent,.pc-followup.sent{opacity:.55}
/* quiz / poll */
.pc-progress-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pc-muted);margin-bottom:8px}
.pc-dots{display:flex;gap:4px}.pc-dots span{width:7px;height:7px;border-radius:50%;background:var(--pc-line)}.pc-dots .on{background:var(--pc-accent)}.pc-dots .ok{background:var(--pc-ok)}.pc-dots .bad{background:var(--pc-bad)}
.pc-question{font-size:16px;font-weight:600;margin-bottom:10px}
.pc-opts{display:grid;gap:8px}
.pc-opt{appearance:none;display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--pc-line);background:transparent;color:var(--pc-text);border-radius:12px;padding:10px 12px;font:inherit;cursor:pointer;transition:border-color .12s,background .12s}
.pc-opt:hover:not([disabled]){border-color:var(--pc-accent)}
.pc-opt.picked{border-color:var(--pc-accent);background:color-mix(in srgb,var(--pc-accent) 12%,transparent)}
.pc-opt.correct{border-color:var(--pc-ok);background:color-mix(in srgb,var(--pc-ok) 14%,transparent)}
.pc-opt.wrong{border-color:var(--pc-bad);background:color-mix(in srgb,var(--pc-bad) 12%,transparent)}
.pc-opt.dim{opacity:.55}.pc-opt[disabled]{cursor:default}
.pc-opt-key{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--pc-soft)}
.pc-check{flex:none;width:18px;text-align:center;color:var(--pc-accent)}
.pc-hint{margin-top:10px;padding:8px 10px;border-radius:10px;background:var(--pc-soft);font-size:13px}
.pc-feedback{margin-top:10px;padding:10px 12px;border-radius:10px;display:grid;gap:3px;font-size:13.5px}
.pc-feedback.ok{background:color-mix(in srgb,var(--pc-ok) 14%,transparent)}.pc-feedback.bad{background:color-mix(in srgb,var(--pc-bad) 12%,transparent)}
.pc-score{display:flex;align-items:baseline;gap:10px;margin:4px 0 10px}.pc-score strong{font-size:30px}
.pc-review{margin:0;padding-left:0;list-style:none;display:grid;gap:6px}.pc-review li{display:flex;gap:8px}.pc-review .ok span{color:var(--pc-ok)}.pc-review .bad span{color:var(--pc-bad)}
.pc-poll-row{display:flex;justify-content:space-between;padding:8px 10px;border:1px solid var(--pc-line);border-radius:10px;margin-bottom:6px}.pc-poll-row.mine{border-color:var(--pc-accent);font-weight:600}
/* flashcards */
.pc-bar{height:4px;border-radius:4px;background:var(--pc-soft);overflow:hidden;margin-bottom:10px}.pc-bar span{display:block;height:100%;background:var(--pc-accent);transition:width .2s}
.pc-flip{appearance:none;width:100%;min-height:150px;border:1px solid var(--pc-line);border-radius:14px;background:var(--pc-soft);color:var(--pc-text);font:inherit;display:grid;place-items:center;align-content:center;gap:6px;padding:20px;cursor:pointer;text-align:center;animation:pc-flip-in .25s ease}
.pc-flip.flipped{background:color-mix(in srgb,var(--pc-accent) 10%,var(--pc-soft))}
.pc-flip-side{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--pc-muted)}.pc-flip-text{font-size:18px;font-weight:600}
@keyframes pc-flip-in{from{transform:rotateX(70deg);opacity:.3}to{transform:none;opacity:1}}
/* writing */
.pc-writing-subject{padding:8px 0;border-bottom:1px solid var(--pc-line);margin-bottom:8px}.pc-writing-subject span{color:var(--pc-muted);margin-right:8px;font-size:12px}
.pc-writing-body{white-space:pre-wrap;font-family:Georgia,'Iowan Old Style',serif;font-size:15px;line-height:1.6}
.pc-writing-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid var(--pc-line)}
/* follow-ups */
.pc-followups{display:grid;gap:0;margin:12px 0 4px;border-top:1px solid var(--pc-line)}
.pc-followup{appearance:none;display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--pc-line);color:var(--pc-text);font:inherit;padding:10px 2px;cursor:pointer}
.pc-followup:hover{color:var(--pc-accent)}.pc-followup span:last-child{color:var(--pc-muted)}
/* reminder */
.pc-rem{display:flex;gap:12px;align-items:flex-start}.pc-rem-icon{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--pc-soft);color:var(--pc-accent)}
/* scroller */
.pc-scroller-wrap{position:relative}
.pc-scroller{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding:2px 0 4px;-webkit-overflow-scrolling:touch}.pc-scroller::-webkit-scrollbar{display:none}
.pc-scroller>*{scroll-snap-align:start;flex:none}
.pc-nav{position:absolute;top:40%;z-index:2;width:30px;height:30px;border-radius:50%;border:1px solid var(--pc-line);background:var(--pc-surface);color:var(--pc-text);display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .15s;backdrop-filter:blur(8px)}
.pc-nav.prev{left:-4px}.pc-nav.next{right:-4px}.pc-scroller-wrap:hover .pc-nav{opacity:.95}
@media (hover:none){.pc-nav{display:none}}
/* currency */
.pc-currency{max-width:440px}
.pc-fx-row{display:flex;gap:8px;align-items:center}
.pc-input,.pc-select,.pc-fx-out{font:inherit;color:var(--pc-text);background:var(--pc-soft);border:1px solid var(--pc-line);border-radius:12px;padding:10px 12px;min-width:0}
.pc-input,.pc-fx-out{flex:1;font-size:20px;font-weight:600}.pc-select{flex:none;max-width:52%}
.pc-fx-swap{margin:6px auto;display:flex}
.pc-fx-out{display:block}
/* clock */
.pc-clock-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.pc-clock-cell{padding:12px;border-radius:12px;background:var(--pc-soft)}
.pc-clock-label{font-weight:600}.pc-clock-time{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0}
/* video */
.pc-video-tile{width:240px}.pc-video-tile.big{width:100%;margin-bottom:10px}
.pc-video-thumb{appearance:none;position:relative;display:block;width:100%;aspect-ratio:16/9;border:0;padding:0;border-radius:12px;overflow:hidden;background:var(--pc-soft);cursor:pointer}
.pc-video-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pc-play{position:absolute;inset:0;margin:auto;width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.6);color:#fff}.pc-play svg{width:24px;height:24px}
.pc-badge{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.72);color:#fff;font-size:11px;padding:2px 6px;border-radius:6px}
.pc-video-frame{width:100%;aspect-ratio:16/9;border:0;border-radius:12px;display:block;background:#000}
.pc-video-meta{padding:6px 2px 0}
.pc-link-title{color:var(--pc-text);font-weight:600;text-decoration:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.pc-link-title:hover{color:var(--pc-accent)}
/* gallery */
.pc-gallery-grid{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:96px;gap:6px}
.pc-gallery-tile{appearance:none;border:0;padding:0;border-radius:10px;overflow:hidden;background:var(--pc-soft);cursor:zoom-in}.pc-gallery-tile.hero{grid-column:span 2;grid-row:span 2}
.pc-gallery-tile img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s}.pc-gallery-tile:hover img{transform:scale(1.04)}
@media (max-width:520px){.pc-gallery-grid{grid-template-columns:repeat(3,1fr);grid-auto-rows:84px}}
.pc-lightbox{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:24px}
.pc-lightbox figure{margin:0;max-width:min(1100px,92vw);display:grid;gap:8px}.pc-lightbox img{max-width:100%;max-height:80vh;object-fit:contain;border-radius:8px}
.pc-lightbox figcaption{color:#ddd;font-size:13px;display:flex;justify-content:space-between;gap:12px}.pc-lightbox a{color:#fff}
.pc-lb-close,.pc-lb-nav{position:absolute;background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:50%;width:42px;height:42px;font-size:24px;cursor:pointer}
.pc-lb-close{top:16px;right:16px}.pc-lb-nav.prev{left:16px}.pc-lb-nav.next{right:16px}
/* news */
.pc-news-tile{width:250px;border:1px solid var(--pc-line);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--pc-text);background:var(--pc-soft);display:flex;flex-direction:column}
.pc-news-img{aspect-ratio:16/9;background:var(--pc-line);overflow:hidden}.pc-news-img img{width:100%;height:100%;object-fit:cover;display:block}
.pc-news-body{padding:10px;display:grid;gap:4px}.pc-news-title{font-weight:600;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pc-news-src{display:flex;gap:5px;align-items:center;font-size:12px;color:var(--pc-muted)}.pc-fav{width:14px;height:14px;border-radius:3px}
.pc-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.pc-clamp3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
/* sports */
.pc-game-row{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin:8px 0}
.pc-team{display:grid;justify-items:center;text-align:center;gap:3px}.pc-team-name{font-weight:600}
.pc-logo{width:48px;height:48px;object-fit:contain}.pc-logo-sm{width:18px;height:18px;object-fit:contain}
.pc-game-mid{display:flex;align-items:center;gap:14px}.pc-game-score{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--pc-muted)}.pc-game-score.win{color:var(--pc-text)}
.pc-game-status{font-size:12px;color:var(--pc-muted);text-align:center;display:flex;align-items:center;gap:5px}.pc-game-status.live{color:var(--pc-bad);font-weight:600}
.pc-live-dot{width:7px;height:7px;border-radius:50%;background:var(--pc-bad);animation:pc-pulse 1.4s infinite}@keyframes pc-pulse{50%{opacity:.25}}
.pc-game-tile{width:320px;border:1px solid var(--pc-line);border-radius:12px;padding:10px}
.pc-table-scroll{overflow-x:auto}
.pc-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.pc-table th,.pc-table td{padding:6px 8px;text-align:center;border-bottom:1px solid var(--pc-line);white-space:nowrap}.pc-table th{color:var(--pc-muted);font-weight:600;font-size:12px}
.pc-table .l,.pc-linescore td:first-child{text-align:left}.pc-team-inline{display:inline-flex;gap:6px;align-items:center}
.pc-tabs{display:flex;gap:4px;margin-bottom:8px;background:var(--pc-soft);border-radius:999px;padding:3px;width:max-content;max-width:100%;overflow-x:auto}
.pc-tab{appearance:none;border:0;background:transparent;color:var(--pc-muted);font:inherit;font-size:13px;padding:5px 12px;border-radius:999px;cursor:pointer;white-space:nowrap}.pc-tab.on{background:var(--pc-surface);color:var(--pc-text);font-weight:600}
.pc-player{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center}
.pc-headshot{width:72px;height:72px;border-radius:50%;object-fit:cover;background:var(--pc-soft)}
.pc-subhead{margin:12px 0 6px;font-size:12px;color:var(--pc-muted);text-transform:uppercase;letter-spacing:.05em}
.pcx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:6px}
.pc-stat{background:var(--pc-soft);border-radius:10px;padding:8px;text-align:center}.pc-stat-v{font-size:20px;font-weight:700}.pc-stat-k{font-size:11px;color:var(--pc-muted);font-weight:600}
.pc-more{display:inline-block;margin-top:10px;font-size:13px;color:var(--pc-accent);text-decoration:none}
/* places */
.pc-place{width:280px;border:1px solid var(--pc-line);border-radius:12px;overflow:hidden;background:var(--pc-soft);display:flex;flex-direction:column}
.pc-place-img{aspect-ratio:16/9;overflow:hidden}.pc-place-img img{width:100%;height:100%;object-fit:cover;display:block}
.pc-place-body{padding:10px;display:grid;gap:5px}.pc-place-top{display:flex;gap:8px;align-items:center}
.pc-num{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--pc-accent);color:#fff;font-size:12px;font-weight:700}
.pc-place-hours{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}.pc-open{color:var(--pc-ok);font-weight:600;font-size:12.5px}.pc-closed{color:var(--pc-bad);font-weight:600;font-size:12.5px}
.pc-stars{color:#f5a524;font-weight:600}
.pc-places .pc-map-slot{margin:-2px 0 10px;border-radius:12px;overflow:hidden;height:260px;background:#0b141b}
.pc-map-frame{width:100%;height:100%;border:0;display:block}
.pc-place.flash{outline:2px solid var(--pc-accent);outline-offset:-2px}
/* product */
.pc-product{display:grid;grid-template-columns:160px 1fr;gap:14px}.pc-product.hero{grid-template-columns:220px 1fr}
.pc-product-img{display:block;aspect-ratio:1;border-radius:12px;background:#fff;overflow:hidden}.pc-product-img img{width:100%;height:100%;object-fit:contain;display:block}
.pc-product-body{display:grid;gap:6px;align-content:start;min-width:0}.pc-product-price{display:flex;gap:8px;align-items:baseline}.pc-product-price strong{font-size:20px}
.pc-badge-pick{color:var(--pc-accent)}
.pc-pros{margin:2px 0;padding-left:18px;font-size:13px}
.pc-offers{display:grid;gap:4px}.pc-offer{display:flex;justify-content:space-between;padding:6px 10px;border:1px solid var(--pc-line);border-radius:8px;color:var(--pc-text);text-decoration:none;font-size:13px}
.pc-buy{justify-self:start;margin-top:4px}
@media (max-width:520px){.pc-product,.pc-product.hero{grid-template-columns:1fr}.pc-product-img{max-height:240px;aspect-ratio:auto;height:220px}.pcx{padding:12px;border-radius:14px}.pc-game-score{font-size:24px}.pc-logo{width:38px;height:38px}}
/* product comparison: products as columns */
.pc-cmp-scroll{overflow-x:auto;margin:0 -14px;padding:0 14px;-webkit-overflow-scrolling:touch}
.pc-cmp{border-collapse:collapse;width:100%;min-width:max-content;font-size:13px}
.pc-cmp th,.pc-cmp td{padding:8px 10px;border-bottom:1px solid var(--pc-line);text-align:left;vertical-align:top;min-width:140px;max-width:220px}
.pc-cmp tbody th{color:var(--pc-muted);font-weight:600;min-width:96px;position:sticky;left:0;background:var(--pc-surface)}
.pc-cmp thead th{border-bottom:2px solid var(--pc-line)}
.pc-cmp-prod{display:grid;gap:4px}.pc-cmp-img{height:96px;border-radius:10px;background:#fff;overflow:hidden}.pc-cmp-img img{width:100%;height:100%;object-fit:contain}
.pc-cmp-price{font-weight:700;font-size:15px}
/* calculator + unit converter */
.pc-calc-expr{width:100%;font-size:18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pc-calc-out{display:block;text-align:right;font-size:26px;font-weight:700;margin:8px 2px 10px;min-height:34px;font-variant-numeric:tabular-nums}.pc-calc-out.pending{color:var(--pc-muted)}
.pc-keypad{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.pc-key{appearance:none;font:inherit;font-size:16px;font-weight:600;padding:10px 0;border-radius:10px;border:1px solid var(--pc-line);background:var(--pc-soft);color:var(--pc-text);cursor:pointer;touch-action:manipulation}
.pc-key:active{transform:scale(.97)}.pc-key.op{color:var(--pc-accent)}.pc-key.eq{grid-column:1/-1;background:var(--pc-accent);border-color:transparent;color:#fff}
.pc-error .pc-actions{margin-top:8px}
.pc-visual-error{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 10px;padding:8px 10px;border:1px dashed var(--prom-danger,#e5484d);border-radius:12px;font-size:13px;color:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)))}
/* inline citation chips */
.pc-cite{display:inline-flex;align-items:center;gap:3px;vertical-align:1px;margin:0 2px;padding:1px 7px;border-radius:999px;background:var(--pc-soft,rgba(127,127,127,.12));color:var(--pc-muted,inherit);font-size:11.5px;font-weight:600;text-decoration:none;white-space:nowrap}
.pc-cite:hover{color:var(--pc-accent,inherit)}.pc-cite img{width:12px;height:12px;border-radius:3px}
/* inline visual expand-to-fullscreen (desktop + mobile; kept out of the ratcheted legacy stylesheets) */
.visual-block{position:relative}
.visual-expand-btn{position:absolute;top:4px;right:4px;z-index:3;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;border:1px solid var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));background:var(--pm-surface,var(--panel,rgba(127,127,127,.1)));color:var(--pm-muted,var(--muted,#8a8a8a));cursor:pointer;opacity:0;transition:opacity .15s ease,color .15s ease;-webkit-tap-highlight-color:transparent}
.visual-block:hover .visual-expand-btn,.visual-expand-btn:focus-visible,.visual-block--expanded .visual-expand-btn{opacity:1}
.visual-expand-btn:hover{color:var(--pm-text,var(--text,currentColor))}
@media (hover:none){.visual-expand-btn{opacity:.85}}
html .visual-block.visual-block--expanded,html .pm-bubble .visual-block.visual-block--expanded,html .pm-msg .pm-bubble .visual-block.visual-block--expanded{position:fixed!important;inset:0;z-index:10050;margin:0!important;padding:calc(env(safe-area-inset-top) + 48px) 14px calc(env(safe-area-inset-bottom) + 16px)!important;max-width:none!important;width:100vw;overflow:auto!important;-webkit-overflow-scrolling:touch;border:0!important;border-radius:0!important;background:var(--pm-bg,var(--bg,#0f1115))!important}
html .visual-block.visual-block--expanded iframe{max-width:1280px;margin:0 auto}
html .visual-block.visual-block--expanded .visual-expand-btn{position:fixed;top:calc(env(safe-area-inset-top) + 10px);right:14px;opacity:1}
html.prom-visual-expanded-open,html.prom-visual-expanded-open body{overflow:hidden}
`;
