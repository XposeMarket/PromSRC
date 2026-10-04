/**
 * Renderers for gateway-built rich artifacts (show_ui_card live-data types):
 * currency, clock, video, gallery, news, sports_game, sports_player,
 * sports_standings, places, product. Pure string builders; live behaviour
 * (converter math, ticking clocks, carousels) is wired by card-runtime.js.
 */
import { esc, safeUrl, hostOf, faviconFor, encodeCardData, fmtNumber, stars, cardError, ICON } from './card-utils.js';

const img = (src, alt, cls = '') => {
  const url = safeUrl(src);
  return url ? `<img class="${cls}" src="${esc(url)}" alt="${esc(alt || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '';
};

const scroller = (inner, cls = '') => `<div class="pc-scroller-wrap"><button type="button" class="pc-nav prev" data-pc-act="scroll" data-dir="-1" aria-label="Previous">${ICON.arrowL}</button><div class="pc-scroller ${cls}">${inner}</div><button type="button" class="pc-nav next" data-pc-act="scroll" data-dir="1" aria-label="Next">${ICON.arrowR}</button></div>`;

function wrap(kind, a, inner, extra = '') {
  return `<div class="pc-card pc-${kind} ${extra}" data-pc-kind="${kind}" data-pc-id="${esc(a.id || '')}">${inner}</div>`;
}

function head(label, title, right = '') {
  return `<div class="pc-head"><span class="pc-kicker">${esc(label)}</span>${title ? `<span class="pc-title">${esc(title)}</span>` : ''}${right}</div>`;
}

// ── currency ───────────────────────────────────────────────────────────────
function renderCurrency(a) {
  const rates = a.rates && typeof a.rates === 'object' ? a.rates : null;
  if (!rates || !a.base) return cardError('currency', 'Exchange rates were unavailable.');
  // Frankfurter omits the base currency from its own rate table; add it back so
  // the "from" select can actually show it (otherwise it silently falls to AUD).
  const codes = [...new Set([a.base, ...Object.keys(rates)])].sort();
  const from = a.from || a.base; const to = a.to || codes.find((c) => c !== from) || from;
  const amount = Number(a.amount) || 1;
  const sel = (name, cur) => `<select class="pc-select" data-pc-fx="${name}">${codes.map((c) => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(c)}${a.names?.[c] ? ` · ${esc(a.names[c])}` : ''}</option>`).join('')}</select>`;
  return `<div class="pc-card pc-currency" data-pc-kind="currency" data-pc-id="${esc(a.id || '')}" data-card-json="${encodeCardData({ base: a.base, rates })}">${head('Currency', a.date ? `Rates as of ${a.date}` : '')}
  <div class="pc-fx-row"><input class="pc-input" type="number" inputmode="decimal" step="any" value="${esc(amount)}" data-pc-fx="amount" aria-label="Amount">${sel('from', from)}</div>
  <button type="button" class="pc-icon-btn pc-fx-swap" data-pc-act="fx-swap" title="Swap">${ICON.swap}</button>
  <div class="pc-fx-row"><output class="pc-fx-out" data-pc-fx="out">…</output>${sel('to', to)}</div>
  <div class="pc-muted" data-pc-fx="rate"></div><div class="pc-source">${esc(a.source || 'European Central Bank via Frankfurter')}</div></div>`;
}

// ── clock ──────────────────────────────────────────────────────────────────
function renderClock(a) {
  const zones = (a.zones || []).filter((z) => z?.timeZone).slice(0, 8);
  if (!zones.length) return cardError('clock', 'No time zones resolved.');
  const cells = zones.map((z) => `<div class="pc-clock-cell" data-tz="${esc(z.timeZone)}"><div class="pc-clock-label">${esc(z.label || z.timeZone)}</div><div class="pc-clock-time" data-pc-clock="time">--:--</div><div class="pc-muted" data-pc-clock="date"></div><div class="pc-muted">${esc(z.timeZone)}</div></div>`).join('');
  return wrap('clock', a, `${head('World clock', a.title || '')}<div class="pc-clock-grid">${cells}</div>`);
}

// ── video ──────────────────────────────────────────────────────────────────
export function youTubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

function videoTile(v, big) {
  const yt = youTubeId(v.url);
  const thumb = v.thumbnail || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '');
  const play = yt ? `data-pc-act="video-play" data-yt="${esc(yt)}"` : `data-pc-act="open" data-url="${esc(safeUrl(v.url))}"`;
  return `<div class="pc-video-tile ${big ? 'big' : ''}"><button type="button" class="pc-video-thumb" ${play} aria-label="Play ${esc(v.title || 'video')}">${img(thumb, v.title)}<span class="pc-play">${ICON.play}</span>${v.duration ? `<span class="pc-badge">${esc(v.duration)}</span>` : ''}</button><div class="pc-video-meta"><a class="pc-link-title" href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener noreferrer">${esc(v.title || v.url)}</a><div class="pc-muted">${esc([v.creator || v.publisher || hostOf(v.url), v.age].filter(Boolean).join(' · '))}</div></div></div>`;
}

function renderVideo(a) {
  const items = (a.items || []).filter((v) => safeUrl(v?.url)).slice(0, 8);
  if (!items.length) return cardError('video', 'No playable videos were found.');
  if (items.length === 1) return wrap('video', a, `${a.title ? head('Video', a.title) : ''}${videoTile(items[0], true)}`);
  return wrap('video', a, `${head('Videos', a.title || '')}${videoTile(items[0], true)}${scroller(items.slice(1).map((v) => videoTile(v, false)).join(''))}`);
}

// ── gallery ────────────────────────────────────────────────────────────────
function renderGallery(a) {
  const items = (a.items || []).filter((g) => safeUrl(g?.thumbnail || g?.url)).slice(0, 24);
  if (!items.length) return cardError('gallery', 'No images were found.');
  const tiles = items.map((g, i) => `<button type="button" class="pc-gallery-tile ${i === 0 ? 'hero' : ''}" data-pc-act="lightbox" data-i="${i}" aria-label="${esc(g.title || 'Image')}">${img(g.thumbnail || g.url, g.title)}</button>`).join('');
  const data = items.map((g) => ({ src: safeUrl(g.url || g.thumbnail), thumb: safeUrl(g.thumbnail || g.url), title: g.title || '', page: safeUrl(g.pageUrl || ''), source: g.source || hostOf(g.pageUrl || g.url) }));
  return `<div class="pc-card pc-gallery" data-pc-kind="gallery" data-pc-id="${esc(a.id || '')}" data-card-json="${encodeCardData(data)}">${head('Images', a.title || '', `<span class="pc-count">${items.length}</span>`)}<div class="pc-gallery-grid">${tiles}</div></div>`;
}

// ── news ───────────────────────────────────────────────────────────────────
function renderNews(a) {
  const items = (a.items || []).filter((n) => safeUrl(n?.url)).slice(0, 12);
  if (!items.length) return cardError('news', 'No stories were found.');
  const tile = (n) => `<a class="pc-news-tile" href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener noreferrer"><div class="pc-news-img">${img(n.imageUrl || n.thumbnail, n.title)}</div><div class="pc-news-body"><div class="pc-news-src">${img(faviconFor(n.url), '', 'pc-fav')}<span>${esc(n.publisher || hostOf(n.url))}</span>${n.age ? `<span>· ${esc(n.age)}</span>` : ''}</div><div class="pc-news-title">${esc(n.title || n.url)}</div>${n.snippet ? `<div class="pc-muted pc-clamp2">${esc(n.snippet)}</div>` : ''}</div></a>`;
  return wrap('news', a, `${head('News', a.title || '')}${scroller(items.map(tile).join(''), 'news')}`);
}

// ── sports ─────────────────────────────────────────────────────────────────
function teamCell(t, side) {
  return `<div class="pc-team ${side}">${img(t.logo, t.name, 'pc-logo')}<div class="pc-team-name">${esc(t.name || t.abbr || '')}</div>${t.record ? `<div class="pc-muted">${esc(t.record)}</div>` : ''}</div>`;
}

function renderGame(g) {
  const away = g.away || {}; const home = g.home || {};
  const state = g.state || 'pre';
  const score = state === 'pre' ? `<div class="pc-game-mid"><div class="pc-game-status">${esc(g.statusText || '')}</div></div>`
    : `<div class="pc-game-mid"><span class="pc-game-score ${Number(away.score) > Number(home.score) ? 'win' : ''}">${esc(away.score ?? '')}</span><div class="pc-game-status ${state === 'in' ? 'live' : ''}">${state === 'in' ? '<span class="pc-live-dot"></span>' : ''}${esc(g.statusText || '')}</div><span class="pc-game-score ${Number(home.score) > Number(away.score) ? 'win' : ''}">${esc(home.score ?? '')}</span></div>`;
  const periods = Math.max((away.linescores || []).length, (home.linescores || []).length);
  const labels = Array.from({ length: periods }, (_, i) => (g.periodLabel === 'inning' ? i + 1 : (i < 4 ? `Q${i + 1}` : `OT${i - 3 || ''}`)));
  const line = periods ? `<table class="pc-table pc-linescore"><thead><tr><th></th>${labels.map((l) => `<th>${esc(l)}</th>`).join('')}<th>T</th></tr></thead><tbody>${[away, home].map((t) => `<tr><td>${esc(t.abbr || t.name || '')}</td>${labels.map((_, i) => `<td>${esc(t.linescores?.[i] ?? '-')}</td>`).join('')}<td><strong>${esc(t.score ?? '')}</strong></td></tr>`).join('')}</tbody></table>` : '';
  return `<div class="pc-game">${g.venue ? `<div class="pc-muted pc-center">${esc(g.venue)}</div>` : ''}<div class="pc-game-row">${teamCell(away, 'away')}${score}${teamCell(home, 'home')}</div>${line}${g.link ? `<a class="pc-more" href="${esc(safeUrl(g.link))}" target="_blank" rel="noopener noreferrer">Game details ↗</a>` : ''}</div>`;
}

function renderSportsGame(a) {
  const games = (a.games || []).slice(0, 12);
  if (!games.length) return cardError('sports', 'No games found for that query.');
  if (games.length === 1) return wrap('sports-game', a, `${head(a.league || 'Game', a.title || '')}${renderGame(games[0])}`);
  return wrap('sports-game', a, `${head(a.league || 'Scores', a.title || '')}${scroller(games.map((g) => `<div class="pc-game-tile">${renderGame(g)}</div>`).join(''))}`);
}

function renderSportsPlayer(a) {
  const p = a.player || {};
  if (!p.name) return cardError('sports', 'Player not found.');
  const stats = (p.stats || []).slice(0, 6).map((s) => `<div class="pc-stat"><div class="pc-stat-v">${esc(s.value)}</div><div class="pc-stat-k">${esc(s.label)}</div>${s.rank ? `<div class="pc-muted">${esc(s.rank)}</div>` : ''}</div>`).join('');
  const meta = [p.team, p.jersey ? `#${p.jersey}` : '', p.position].filter(Boolean).map(esc).join(' • ');
  return wrap('sports-player', a, `<div class="pc-player">${img(p.headshot, p.name, 'pc-headshot')}<div><div class="pc-title big">${esc(p.name)}</div><div class="pc-muted">${meta}</div>${p.bio ? `<div class="pc-muted">${esc(p.bio)}</div>` : ''}</div>${img(p.teamLogo, p.team, 'pc-logo')}</div>${stats ? `<div class="pc-subhead">${esc(p.statsLabel || 'Season stats')}</div><div class="pc-stats">${stats}</div>` : ''}${p.link ? `<a class="pc-more" href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener noreferrer">Full profile ↗</a>` : ''}`);
}

function renderSportsStandings(a) {
  const groups = (a.groups || []).filter((g) => (g.rows || []).length);
  if (!groups.length) return cardError('sports', 'Standings unavailable.');
  const cols = a.columns || ['W', 'L', 'PCT', 'GB', 'L10', 'STRK'];
  const tabs = groups.length > 1 ? `<div class="pc-tabs" role="tablist">${groups.map((g, i) => `<button type="button" role="tab" class="pc-tab ${i === 0 ? 'on' : ''}" data-pc-act="tab" data-i="${i}">${esc(g.name)}</button>`).join('')}</div>` : '';
  const tables = groups.map((g, i) => `<div class="pc-tabpane" data-i="${i}" ${i ? 'hidden' : ''}><div class="pc-table-scroll"><table class="pc-table"><thead><tr><th>#</th><th class="l">Team</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${g.rows.map((r, k) => `<tr><td>${esc(r.seed || k + 1)}</td><td class="l"><span class="pc-team-inline">${img(r.logo, '', 'pc-logo-sm')}${esc(r.team)}</span></td>${cols.map((c) => `<td>${esc(r.stats?.[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('');
  return wrap('sports-standings', a, `${head(a.league || 'Standings', a.title || '')}${tabs}${tables}`);
}

// ── places ─────────────────────────────────────────────────────────────────
function placeCard(p, i) {
  const dir = safeUrl(p.directionsUrl) || `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Number.isFinite(p.lat) ? `${p.lat},${p.lng}` : `${p.name} ${p.address || ''}`)}`;
  const open = p.openNow === true ? '<span class="pc-open">Open now</span>' : p.openNow === false ? '<span class="pc-closed">Closed</span>' : '';
  const actions = [
    `<a class="pc-chip" href="${esc(dir)}" target="_blank" rel="noopener noreferrer">${ICON.route}Directions</a>`,
    safeUrl(p.website) ? `<a class="pc-chip" href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener noreferrer">${ICON.globe}Website</a>` : '',
    p.phone ? `<a class="pc-chip" href="tel:${esc(String(p.phone).replace(/[^+\d]/g, ''))}">${ICON.phone}Call</a>` : '',
    safeUrl(p.reserveUrl) ? `<a class="pc-chip primary" href="${esc(safeUrl(p.reserveUrl))}" target="_blank" rel="noopener noreferrer">Reserve</a>` : '',
  ].join('');
  return `<div class="pc-place" data-i="${i}">${p.imageUrl ? `<div class="pc-place-img">${img(p.imageUrl, p.name)}</div>` : ''}<div class="pc-place-body"><div class="pc-place-top"><span class="pc-num">${i + 1}</span><strong>${esc(p.name)}</strong></div><div class="pc-muted">${[stars(p.rating), p.reviews ? `(${esc(fmtNumber(p.reviews, 0))})` : '', esc(p.price || ''), esc(p.category || '')].filter(Boolean).join(' · ')}</div>${p.address ? `<div class="pc-muted">${ICON.pin}${esc(p.address)}</div>` : ''}<div class="pc-place-hours">${open}${p.hours ? `<span class="pc-muted">${esc(p.hours)}</span>` : ''}</div><div class="pc-chips">${actions}</div></div></div>`;
}

// Dark MapLibre map with numbered pins; clicking a pin scrolls its card into
// view (postMessage to the host runtime). Lazy iframe so offscreen maps cost nothing.
export function placesMapSrcdoc(a) {
  const pts = (a.places || []).map((p, i) => ({ i, name: p.name, lat: Number(p.lat), lng: Number(p.lng), rating: p.rating })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return '';
  const data = JSON.stringify({ pts, zoom: Number(a.zoom) || 0, id: String(a.id || '') }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css"><style>html,body,#m{margin:0;height:100%;background:#0b141b}.maplibregl-canvas{filter:brightness(.78) saturate(.85)}.pin{display:flex;align-items:center;gap:4px;padding:3px 8px 3px 4px;border-radius:999px;background:#151f27;color:#fff;font:600 12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18);cursor:pointer;white-space:nowrap}.pin b{width:18px;height:18px;border-radius:50%;background:#ff7a1a;display:grid;place-items:center;font-size:11px}.pin span{color:#f5c04a}.maplibregl-ctrl-attrib{font:10px system-ui!important;background:rgba(8,20,28,.7)!important;color:#9eb4bd!important}.maplibregl-ctrl-attrib a{color:#c2d6dc!important}</style></head><body><div id="m"></div><script src="/vendor/maplibre/maplibre-gl.js"><\/script><script>const d=${data};const map=new maplibregl.Map({container:'m',style:{version:8,sources:{c:{type:'raster',tiles:['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap © CARTO'}},layers:[{id:'c',type:'raster',source:'c'}]},center:[d.pts[0].lng,d.pts[0].lat],zoom:13,attributionControl:{compact:true},cooperativeGestures:true});const b=new maplibregl.LngLatBounds();d.pts.forEach(p=>{b.extend([p.lng,p.lat]);const el=document.createElement('div');el.className='pin';el.innerHTML='<b>'+(p.i+1)+'</b>'+(p.rating?'<span>★ '+Number(p.rating).toFixed(1)+'</span>':'');el.onclick=()=>parent.postMessage({type:'prom-places-pin',id:d.id,i:p.i},'*');new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map)});if(d.pts.length>1)map.fitBounds(b,{padding:48,maxZoom:15,duration:0});else map.setZoom(d.zoom||14);<\/script></body></html>`;
}

function placesMap(a) {
  const doc = placesMapSrcdoc(a);
  return doc ? `<div class="pc-map-slot"><iframe class="pc-map-frame" title="Map of places" srcdoc="${esc(doc)}" loading="lazy"></iframe></div>` : '';
}

function renderPlaces(a, mapHtml = '') {
  const places = (a.places || []).filter((p) => p?.name).slice(0, 12);
  if (!places.length) return cardError('places', 'No places found.');
  return wrap('places', a, `${head('Places', a.title || '')}${mapHtml}${scroller(places.map(placeCard).join(''), 'places')}`);
}

// ── product (hero / single) ────────────────────────────────────────────────
function renderProduct(a) {
  const p = a.item || (a.items || [])[0];
  if (!p?.title) return cardError('product', 'Product details unavailable.');
  const url = safeUrl(p.productUrl || p.url);
  const offers = (p.offers || []).slice(0, 4).map((o) => `<a class="pc-offer" href="${esc(safeUrl(o.url) || url)}" target="_blank" rel="noopener noreferrer"><span>${esc(o.merchant || hostOf(o.url))}</span><strong>${esc(o.price || '')}</strong></a>`).join('');
  const pros = (p.pros || []).slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('');
  const hero = a.variant === 'hero';
  return wrap('product', a, `${hero ? `<div class="pc-head"><span class="pc-kicker pc-badge-pick">${esc(a.badge || 'Top pick')}</span></div>` : ''}<div class="pc-product ${hero ? 'hero' : ''}"><a class="pc-product-img" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${img(p.imageUrl, p.title)}</a><div class="pc-product-body"><a class="pc-link-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a><div class="pc-product-price"><strong>${esc(p.price || '')}</strong>${p.merchant || url ? `<span class="pc-muted">${esc(p.merchant || hostOf(url))}</span>` : ''}</div><div class="pc-muted">${[stars(p.rating), p.reviewCount ? `${esc(fmtNumber(p.reviewCount, 0))} reviews` : ''].filter(Boolean).join(' · ')}</div>${p.description ? `<div class="pc-muted pc-clamp3">${esc(p.description)}</div>` : ''}${pros ? `<ul class="pc-pros">${pros}</ul>` : ''}${offers ? `<div class="pc-offers">${offers}</div>` : ''}${url ? `<a class="pc-btn primary pc-buy" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View at ${esc(p.merchant || hostOf(url))}</a>` : ''}</div></div>`);
}

// ── product comparison (products as columns) ──────────────────────────────
function renderProductComparison(a) {
  const products = (a.products || []).filter((p) => p?.title).slice(0, 5);
  if (products.length < 2) return cardError('comparison', 'Need at least two products.');
  const specs = (a.specs || []).slice(0, 20);
  const cell = (v) => (v === true ? '✓' : v === false ? '—' : v == null || v === '' ? '<span class="pc-muted">—</span>' : esc(v));
  const headCells = products.map((p) => {
    const url = safeUrl(p.url);
    const name = url ? `<a class="pc-link-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>` : `<strong>${esc(p.title)}</strong>`;
    return `<th><div class="pc-cmp-prod">${p.badge ? `<span class="pc-badge-pick">${esc(p.badge)}</span>` : ''}${p.imageUrl ? `<div class="pc-cmp-img">${img(p.imageUrl, p.title)}</div>` : ''}${name}${p.price ? `<span class="pc-cmp-price">${esc(p.price)}</span>` : ''}${stars(p.rating)}</div></th>`;
  }).join('');
  const rows = specs.map((k) => `<tr><th scope="row">${esc(k)}</th>${products.map((p) => `<td>${cell(p.specs?.[k])}</td>`).join('')}</tr>`).join('');
  // Wrapper kind must not be 'cmp': .pc-cmp is the table class (min-width:max-content).
  return wrap('compare', a, `${head('Compare', a.title || '')}<div class="pc-cmp-scroll"><table class="pc-cmp"><thead><tr><th></th>${headCells}</tr></thead><tbody>${rows}</tbody></table></div>`);
}

export const DATA_CARD_TYPES = ['currency', 'clock', 'video', 'gallery', 'news', 'sports_game', 'sports_player', 'sports_standings', 'places', 'product', 'product_comparison'];

export function renderDataCard(a, options = {}) {
  try {
    switch (a?.type) {
      case 'currency': return renderCurrency(a);
      case 'clock': return renderClock(a);
      case 'video': return renderVideo(a);
      case 'gallery': return renderGallery(a);
      case 'news': return renderNews(a);
      case 'sports_game': return renderSportsGame(a);
      case 'sports_player': return renderSportsPlayer(a);
      case 'sports_standings': return renderSportsStandings(a);
      case 'places': return renderPlaces(a, typeof options.mapHtml === 'function' ? options.mapHtml(a) : placesMap(a));
      case 'product': return renderProduct(a);
      case 'product_comparison': return renderProductComparison(a);
      default: return '';
    }
  } catch (error) {
    return cardError(String(a?.type || 'card'), error?.message || String(error));
  }
}
