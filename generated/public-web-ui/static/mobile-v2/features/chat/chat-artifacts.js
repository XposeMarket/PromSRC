function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function jsonForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function emailArtifactId(artifact, message, index) {
  return String(artifact?.id || `email_${message?.id || index}`).trim();
}

function renderEmailComposer(artifact, message, index) {
  const id = emailArtifactId(artifact, message, index);
  const status = String(artifact.status || artifact.mode || 'draft').toLowerCase();
  const sent = status === 'sent' || String(artifact.mode || '').toLowerCase() === 'sent';
  const list = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => String(item || '').trim()).filter(Boolean).join(', ');
  const to = list(artifact.to);
  const cc = list(artifact.cc);
  const bcc = list(artifact.bcc);
  const subject = String(artifact.subject || '').trim();
  const body = String(artifact.body || '');
  const attachments = Array.isArray(artifact.attachments) ? artifact.attachments.filter(Boolean) : [];
  const title = sent ? 'Email sent' : (subject || 'New email');
  const sentMeta = [
    artifact.sentAt ? new Date(artifact.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
    artifact.messageId ? `Message ${String(artifact.messageId).slice(0, 18)}` : '',
  ].filter(Boolean).join(' · ');
  const hidden = (name, value) => `<input type="hidden" data-v2-email-field="${name}" value="${escapeHtml(String(value || ''))}">`;
  return `<article class="pm-v2-email-card ${sent ? 'is-sent' : 'is-draft'}" data-v2-email-id="${escapeHtml(id)}">
    ${hidden('to', to)}${hidden('cc', cc)}${hidden('bcc', bcc)}${hidden('subject', subject)}
    <textarea data-v2-email-field="body" hidden>${escapeHtml(body)}</textarea>
    <div class="pm-v2-email-kicker">${escapeHtml(title)}</div>
    <div class="pm-v2-email-preview">${escapeHtml(body || '(empty draft)')}</div>
    ${attachments.length ? `<div class="pm-v2-email-attachments">${attachments.map((item) => `<span>⌁ ${escapeHtml(item.name || item.filename || 'Attachment')}</span>`).join('')}</div>` : ''}
    ${sent
      ? `<div class="pm-v2-email-status">Sent${sentMeta ? ` · ${escapeHtml(sentMeta)}` : ''}</div>`
      : '<div class="pm-v2-email-actions"><button type="button" data-v2-email-action="send">Send email</button><button type="button" data-v2-email-action="discard">Discard</button></div>'}
    <div class="pm-v2-email-notice" role="status" hidden></div>
  </article>`;
}

function chartSrcdoc(artifact) {
  const series = (Array.isArray(artifact?.series) ? artifact.series : []).map((item) => ({
    ...item,
    points: (Array.isArray(item?.points) ? item.points : (Array.isArray(item?.data) ? item.data : []))
      .map((point, index) => ({
        x: point?.x ?? point?.label ?? point?.date ?? point?.time ?? index + 1,
        y: Number(point?.y ?? point?.value),
      }))
      .filter((point) => Number.isFinite(point.y)),
  })).filter((item) => item.points.length);
  const payload = jsonForInlineScript({
    chartType: artifact?.chartType,
    series,
    xLabel: artifact?.xLabel,
    yLabel: artifact?.yLabel,
    unit: artifact?.unit,
    stacked: artifact?.stacked === true,
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101a22;font-family:system-ui,sans-serif}#chart{height:100%;width:100%}</style></head><body><canvas id="chart"></canvas><script src="/vendor/chart/chart.umd.js"><\/script><script>const a=${payload};const palette=['#55a7ff','#42d392','#f6b44d','#fb7185','#b58cff','#2dd4bf','#f472b6','#a3e635'];const labels=[...new Set(a.series.flatMap(s=>s.points.map(p=>String(p.x))))];const rgba=(hex,alpha)=>{const clean=String(hex||'').replace('#','');if(!/^[0-9a-f]{6}$/i.test(clean))return 'rgba(85,167,255,'+alpha+')';const n=parseInt(clean,16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')'};const radial=['pie','doughnut'].includes(a.chartType);const type=a.chartType==='area'?'line':(a.chartType==='scatter'?'scatter':(radial?a.chartType:(a.chartType==='bar'?'bar':'line')));const datasets=a.series.map((s,i)=>{const color=s.color||palette[i%palette.length];const values=radial?s.points.map(p=>p.y):(type==='scatter'?s.points.map(p=>({x:p.x,y:p.y})):labels.map(x=>{const p=s.points.find(point=>String(point.x)===x);return p?p.y:null}));return {label:s.label||'Series '+(i+1),data:values,borderColor:color,backgroundColor:radial?s.points.map((p,j)=>p.color||palette[j%palette.length]):rgba(color,type==='bar'?'.72':(a.chartType==='area'?'.25':'.12')),borderWidth:radial?1:2,fill:a.chartType==='area',tension:.32,pointRadius:type==='line'?2.5:(type==='scatter'?4:0),pointHoverRadius:5,borderRadius:type==='bar'?5:0,stack:a.stacked?'prometheus':undefined};});const tick='#9fb1bd',grid='rgba(173,208,220,.12)';if(typeof Chart==='undefined'){document.body.textContent='Chart renderer unavailable';}else{new Chart(document.getElementById('chart'),{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:!radial&&datasets.length>1,position:'bottom',labels:{color:tick,boxWidth:10,boxHeight:10,padding:12,font:{size:10}}},tooltip:{backgroundColor:'#0b1820',padding:10,callbacks:{label:c=>{const v=c.parsed.y??c.raw;return ' '+c.dataset.label+': '+String(v)+(a.unit||'')}}}},scales:radial?{}:{x:{stacked:a.stacked,ticks:{color:tick,maxRotation:0,autoSkip:true,maxTicksLimit:5,font:{size:9}},title:{display:!!a.xLabel,text:a.xLabel,color:tick,font:{size:9,weight:'600'}},grid:{display:false}},y:{stacked:a.stacked,ticks:{color:tick,font:{size:9},callback:v=>String(v)+(a.unit||'')},title:{display:!!a.yLabel,text:a.yLabel,color:tick,font:{size:9,weight:'600'}},grid:{color:grid}}}}});}</script></body></html>`;
}

function renderChart(artifact, gateway, index) {
  const title = String(artifact?.title || '').trim();
  const source = String(artifact?.source || '').trim();
  const updated = artifact?.updatedAt ? new Date(artifact.updatedAt) : null;
  const freshness = updated && Number.isFinite(updated.getTime()) ? `Updated ${updated.toLocaleString()}` : '';
  const srcdoc = chartSrcdoc(artifact);
  return `<section class="pm-v2-chart-card" data-v2-artifact-index="${index}">${title ? `<strong class="pm-v2-special-title">${escapeHtml(title)}</strong>` : ''}<iframe class="pm-v2-chart-frame" title="${escapeHtml(title || 'Interactive chart')}" srcdoc="${escapeHtml(srcdoc)}" loading="lazy"${gateway?.token ? ' referrerpolicy="no-referrer"' : ''}></iframe>${source || freshness ? `<div class="pm-v2-chart-meta">${source ? `<span>${escapeHtml(source)}</span>` : ''}${freshness ? `<span>${escapeHtml(freshness)}</span>` : ''}</div>` : ''}</section>`;
}

function mapSrcdoc(artifact) {
  const markers = (Array.isArray(artifact?.markers) ? artifact.markers : []).filter((item) => item && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)))
    .map((item) => ({ ...item, lat: Number(item.lat), lng: Number(item.lng) }));
  const fallback = markers[0] || { lat: 0, lng: 0 };
  const center = artifact?.center || {};
  const payload = jsonForInlineScript({
    center: { lat: Number(center.lat) || fallback.lat, lng: Number(center.lng) || fallback.lng },
    zoom: Math.max(2, Math.min(18, Number(artifact?.zoom) || 12)),
    markers,
  });
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#09151d}.maplibregl-canvas{filter:brightness(.72) saturate(.82) contrast(1.06)}.maplibregl-ctrl-group{overflow:hidden!important;border:1px solid rgba(164,205,219,.22)!important;border-radius:10px!important;background:rgba(10,25,34,.86)!important;box-shadow:0 8px 22px rgba(0,0,0,.3)!important}.maplibregl-ctrl-group button{width:30px!important;height:30px!important}.maplibregl-ctrl-group button span{filter:invert(1) hue-rotate(145deg) saturate(.55)}.maplibregl-ctrl-attrib{padding:2px 6px!important;border-radius:8px 0 0 0!important;background:rgba(8,20,28,.74)!important;color:#9eb4bd!important;font:9px/1.25 system-ui!important}.maplibregl-ctrl-attrib a{color:#c2d6da!important}.pm-pin{width:17px;height:17px;border:3px solid #f5fbfc;border-radius:50% 50% 50% 0;background:#31b6cf;box-shadow:0 0 0 4px rgba(49,182,207,.2),0 5px 14px rgba(0,0,0,.45);transform:rotate(-45deg)}.pm-pin:after{content:'';position:absolute;inset:4px;border-radius:50%;background:#073745}.maplibregl-popup-content{padding:8px 10px!important;border:1px solid rgba(166,221,230,.2)!important;border-radius:10px!important;background:#0d202a!important;color:#e9f5f7!important;font:11px/1.3 system-ui!important}.maplibregl-popup-tip{border-top-color:#0d202a!important;border-bottom-color:#0d202a!important}</style></head><body><div id="map"></div><script src="/vendor/maplibre/maplibre-gl.js"><\/script><script>const payload=${payload};if(typeof maplibregl==='undefined'){document.body.textContent='Map renderer unavailable';}else{const map=new maplibregl.Map({container:'map',style:{version:8,sources:{carto:{type:'raster',tiles:['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],tileSize:256,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'}},layers:[{id:'background',type:'background',paint:{'background-color':'#09151d'}},{id:'carto',type:'raster',source:'carto',paint:{'raster-saturation':-.18,'raster-contrast':.08}}]},center:[payload.center.lng,payload.center.lat],zoom:payload.zoom,attributionControl:false});map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.addControl(new maplibregl.AttributionControl({compact:true}));const popup=m=>{const node=document.createElement('div');const title=document.createElement('strong');title.textContent=m.label||'Location';node.append(title);if(m.address){const sub=document.createElement('div');sub.style.opacity='.72';sub.style.marginTop='2px';sub.textContent=m.address;node.append(sub)}return node};map.on('load',()=>{const bounds=new maplibregl.LngLatBounds();payload.markers.forEach(m=>{bounds.extend([m.lng,m.lat]);const pin=document.createElement('div');pin.className='pm-pin';new maplibregl.Marker({element:pin,anchor:'bottom'}).setLngLat([m.lng,m.lat]).setPopup(new maplibregl.Popup({offset:17,closeButton:false}).setDOMContent(popup(m))).addTo(map)});if(payload.markers.length>1)map.fitBounds(bounds,{padding:36,maxZoom:14,duration:0})})}</script></body></html>`;
}

function renderMap(artifact, index) {
  const markers = (Array.isArray(artifact?.markers) ? artifact.markers : []).filter(Boolean);
  if (!markers.length) return '';
  const title = String(artifact.title || '').trim();
  const rows = markers.map((marker, rowIndex) => {
    const name = String(marker.label || `Location ${rowIndex + 1}`);
    const address = String(marker.address || '').trim();
    const category = String(marker.category || '').trim();
    const rating = Number.isFinite(Number(marker.rating)) ? `★ ${Number(marker.rating).toFixed(1)}` : '';
    const query = Number.isFinite(Number(marker.lat)) && Number.isFinite(Number(marker.lng))
      ? `${marker.lat},${marker.lng}`
      : `${name} ${address}`;
    const directions = safeUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
    return `<div class="pm-v2-map-place"><span class="pm-v2-map-number">${rowIndex + 1}</span><span class="pm-v2-map-place-copy"><strong>${escapeHtml(name)}</strong>${rating ? `<em>${escapeHtml(rating)}</em>` : ''}${category || address ? `<small>${escapeHtml([category, address].filter(Boolean).join(' · '))}</small>` : ''}</span>${directions ? `<a href="${escapeHtml(directions)}" target="_blank" rel="noopener noreferrer">Directions ↗</a>` : ''}</div>`;
  }).join('');
  return `<section class="pm-v2-map-card" data-v2-artifact-index="${index}">${title ? `<strong class="pm-v2-special-title">${escapeHtml(title)}</strong>` : ''}<iframe class="pm-v2-map-frame" title="${escapeHtml(title || 'Interactive map')}" srcdoc="${escapeHtml(mapSrcdoc(artifact))}" loading="lazy"></iframe><div class="pm-v2-map-places">${rows}</div></section>`;
}

function renderWeather(artifact, message, index, weatherSelections) {
  const location = String(artifact.location || '').trim();
  const unit = String(artifact.unit || 'F').toUpperCase();
  const current = artifact.current || {};
  const daily = Array.isArray(artifact.daily) ? artifact.daily : [];
  const hourly = Array.isArray(artifact.hourly) ? artifact.hourly : [];
  if (!location && !daily.length) return '';
  const key = `${String(message?.id || message?.messageId || 'message')}:${index}`;
  const selectedDay = Math.max(0, Math.min(daily.length - 1, Number(weatherSelections?.get?.(key)) || 0));
  const days = daily.map((day, dayIndex) => `<button type="button" class="pm-v2-weather-day${dayIndex === selectedDay ? ' is-active' : ''}" data-v2-weather-day="${dayIndex}" aria-pressed="${dayIndex === selectedDay ? 'true' : 'false'}"><span>${escapeHtml(day.day || '')}</span><strong>${escapeHtml(day.icon || '🌡️')}</strong><span>${day.high == null ? '' : `${escapeHtml(day.high)}°`}</span><small>${day.low == null ? '' : `${escapeHtml(day.low)}°`}</small></button>`).join('');
  const panels = daily.map((day, dayIndex) => {
    const date = String(day.date || '');
    const hours = hourly.filter((item) => (date ? String(item.date || '') === date : dayIndex === 0 && !item.date));
    const cells = hours.map((item) => {
      const precipitation = Number(item.precipitationProbability);
      const feels = Number(item.feelsLike);
      const showFeels = Number.isFinite(feels) && Math.abs(feels - Number(item.temp)) >= 2;
      return `<div class="pm-v2-weather-hour"><span>${escapeHtml(item.time || '')}</span><strong>${escapeHtml(item.icon || '🌡️')} ${item.temp == null ? '—' : `${escapeHtml(item.temp)}°`}</strong>${showFeels ? `<small>Feels ${escapeHtml(feels)}°</small>` : ''}${Number.isFinite(precipitation) && precipitation > 0 ? `<small>💧 ${precipitation}%</small>` : ''}</div>`;
    }).join('');
    return `<div class="pm-v2-weather-hourly" data-v2-weather-panel="${dayIndex}"${dayIndex === selectedDay ? '' : ' hidden'}><strong>${escapeHtml(day.day || '')} hourly</strong>${cells ? `<div>${cells}</div>` : '<small>Hourly details are unavailable for this day.</small>'}</div>`;
  }).join('');
  return `<section class="pm-v2-weather-card" data-v2-weather-key="${escapeHtml(key)}" data-v2-artifact-index="${index}"><div class="pm-v2-weather-current"><span>${escapeHtml(location)}</span><strong>${current.temp == null ? '' : `${escapeHtml(current.temp)}°${escapeHtml(unit)}`}</strong><small>${escapeHtml(current.icon || '')} ${escapeHtml(current.condition || '')}</small></div>${days ? `<div class="pm-v2-weather-days">${days}</div>` : ''}${panels ? `<div class="pm-v2-weather-panels">${panels}</div>` : ''}</section>`;
}

export function renderSpecialChatArtifact(artifact, message, index, gateway, options = {}) {
  const type = String(artifact?.type || artifact?.kind || '').toLowerCase();
  if (type === 'email_composer') return renderEmailComposer(artifact, message, index);
  if (type === 'chart') return renderChart(artifact, gateway, index);
  if (type === 'map') return renderMap(artifact, index);
  if (type === 'weather') return renderWeather(artifact, message, index, options.weatherSelections);
  return null;
}

function writeEmailNotice(card, message, kind = 'info') {
  const notice = card?.querySelector('.pm-v2-email-notice');
  if (!notice) return;
  notice.textContent = String(message || '');
  notice.dataset.kind = kind;
  notice.hidden = !message;
}

export function attachChatArtifactHandlers({ thread, gateway, chatStore, gatewayId, sessionId, weatherSelections, showNotice }) {
  if (!thread) return () => {};
  let disposed = false;
  const onClick = async (event) => {
    if (disposed) return;
    const weatherButton = event.target.closest('[data-v2-weather-day]');
    if (weatherButton) {
      const card = weatherButton.closest('.pm-v2-weather-card');
      const day = Number(weatherButton.dataset.v2WeatherDay);
      if (!card || !Number.isFinite(day)) return;
      weatherSelections?.set?.(String(card.dataset.v2WeatherKey || ''), day);
      card.querySelectorAll('[data-v2-weather-day]').forEach((button) => {
        const active = Number(button.dataset.v2WeatherDay) === day;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      card.querySelectorAll('[data-v2-weather-panel]').forEach((panel) => {
        panel.hidden = Number(panel.dataset.v2WeatherPanel) !== day;
      });
      return;
    }
    const button = event.target.closest('[data-v2-email-action]');
    if (!button) return;
    event.preventDefault();
    const card = button.closest('[data-v2-email-id]');
    if (!card) return;
    if (button.dataset.v2EmailAction === 'discard') {
      card.remove();
      return;
    }
    if (button.dataset.v2EmailAction !== 'send') return;
    const value = (name) => String(card.querySelector(`[data-v2-email-field="${name}"]`)?.value || '').trim();
    const payload = {
      artifactId: String(card.dataset.v2EmailId || ''),
      sessionId: String(sessionId || ''),
      to: value('to'),
      cc: value('cc'),
      bcc: value('bcc'),
      subject: value('subject'),
      body: String(card.querySelector('[data-v2-email-field="body"]')?.value || ''),
    };
    if (!payload.to) { writeEmailNotice(card, 'Add at least one recipient.', 'error'); return; }
    if (!payload.subject) { writeEmailNotice(card, 'Add a subject before sending.', 'error'); return; }
    button.disabled = true;
    button.textContent = 'Sending…';
    writeEmailNotice(card, '', 'info');
    try {
      const result = await gateway.request('/api/connectors/gmail/send-composer', {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (!result?.success) throw new Error(result?.error || 'Could not send email.');
      const fallback = { status: 'sent', mode: 'sent', sentAt: Date.now() };
      chatStore.mutate(gatewayId, sessionId, (state) => {
        for (const message of state.messages) {
          for (const listKey of ['richArtifacts', 'artifacts']) {
            const list = Array.isArray(message[listKey]) ? message[listKey] : [];
            const index = list.findIndex((item, artifactIndex) => item?.type === 'email_composer'
              && emailArtifactId(item, message, artifactIndex) === payload.artifactId);
            if (index < 0) continue;
            const artifact = list[index];
            Object.assign(artifact, result.artifact || fallback);
            if (!artifact.status) artifact.status = 'sent';
            if (!artifact.mode) artifact.mode = 'sent';
            return;
          }
        }
      });
      showNotice?.('Email sent.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Send email';
      writeEmailNotice(card, error?.message || 'Could not send email.', 'error');
    }
  };
  thread.addEventListener('click', onClick);
  return () => {
    disposed = true;
    thread.removeEventListener('click', onClick);
  };
}
