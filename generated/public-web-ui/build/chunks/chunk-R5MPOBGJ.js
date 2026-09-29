var E=r=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${r}</svg>`,w={box:E('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),userPlus:E('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),grid:E('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),gauge:E('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),up:E('<path d="M18 15l-6-6-6 6"/>'),down:E('<path d="M6 9l6 6 6-6"/>'),minus:E('<path d="M5 12h14"/>'),plus:E('<path d="M12 5v14M5 12h14"/>'),mic:E('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),share:E('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),split:E('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),rocket:E('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),download:E('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),check:E('<path d="M5 12l5 5L20 7"/>'),x:E('<path d="M18 6L6 18M6 6l12 12"/>')},Be={openai:["alloy","ash","coral","echo","fable","nova","onyx","sage","shimmer"],xai:["ara","rex","sal","eve","leo"]},Ve=["bold","pop","minimal","karaoke"],Re=["9:16","1:1","16:9"];function ae(r,t,a,e){let n="vpc-thumb";if(t?.poster)return`<img class="${n}" src="${e.esc(e.mediaUrl(t.poster))}" alt="" loading="lazy" decoding="async">`;if(t?.path&&e.isVideo(t.path))return`<video class="${n}" src="${e.esc(e.mediaUrl(t.path))}#t=0.1" muted playsinline preload="metadata"></video>`;if(t?.path)return e.thumb(t.path,n);if(r?.storyboard)return e.thumb(r.storyboard,n);let o=(r?.characterIds||[])[0],s=(a?.characters||[]).find(i=>i.id===o)||(a?.characters||[])[0];return e.thumb((s?.anchors||[])[0],n)}function ne(r){return r?.kind==="product"?'<span class="vpc-pill is-product">Product</span>':""}var Y=null;function oe(r){return Y||(Y=r.vpFetch("/action",{action:"models"}).then(t=>(t?.models||[]).filter(a=>!a.kind||a.kind==="video")).catch(()=>(Y=null,[]))),Y}function se(r,t,a,e,n){let o=n.esc(r.id),s=e.models||[],i=r.modelId||"",c=['<option value="">Default model</option>',...s.map(m=>`<option value="${n.esc(m.id)}"${m.id===i?" selected":""}>${n.esc(m.label||m.id)}${m.price!=null?` \xB7 ${n.esc(typeof m.price=="number"?n.usd(m.price):m.price)}`:""}</option>`)];return i&&!s.some(m=>m.id===i)&&c.push(`<option value="${n.esc(i)}" selected>${n.esc(i)}</option>`),`<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${o}">${n.esc(r.prompt||"")}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${o}" placeholder="Spoken line for this shot">${n.esc(r.line||"")}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${n.iconBtn("dur",w.minus,"Shorter",`data-s="${o}" data-d="-1" ${Number(r.durationSec)<=1?"disabled":""}`)}
        <span>${Number(r.durationSec)||0}s</span>
        ${n.iconBtn("dur",w.plus,"Longer",`data-s="${o}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${o}" aria-label="Model">${c.join("")}</select>
      <span class="vpc-grow"></span>
      ${n.iconBtn("move",w.up,"Move up",`data-s="${o}" data-i="${t-1}" ${t===0?"disabled":""}`)}
      ${n.iconBtn("move",w.down,"Move down",`data-s="${o}" data-i="${t+1}" ${t>=a-1?"disabled":""}`)}
      ${(r.takes||[]).length>=2?n.iconBtn("variants",w.split,"Render hook variants (one export per take)",`data-s="${o}"`):""}
    </div>
    ${r.voiceover?.path?`<audio class="vpc-audio" src="${n.esc(n.mediaUrl(r.voiceover.path))}" controls preload="none"></audio>`:""}
  </div>`}function ie(r,t){let a=r?.qa;if(!a||a.score==null)return"";let e=Number(a.score),n=e>=7?"good":e>=5?"warn":"bad",o=[`QA ${e}/10${a.verdict?` \xB7 ${a.verdict}`:""}${a.model?` \xB7 ${a.model}`:""}`,...a.issues||[]].join(`
`);return`<span class="vpc-qa is-${n}" title="${t.esc(o)}" aria-label="${t.esc(o)}">${e}</span>`}function ce(r,t){let a=r.shots||[];if(!a.some(o=>o.storyboard||(o.storyboardCandidates||[]).length))return"";let e=a.some(o=>!o.storyboard&&(o.storyboardCandidates||[]).length);return`<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${a.map((o,s)=>{let i=t.esc(o.id),c=(o.storyboardCandidates||[]).find(u=>u!==o.storyboard),m=o.storyboard||c;if(!m)return`<div class="vpc-sb is-empty"><span class="vpc-sb-n">${s+1}</span></div>`;let v=!o.storyboard&&c?`<div class="vpc-tile-actions">
        ${t.iconBtn("sb-approve",w.check,"Approve storyboard",`data-s="${i}" data-path="${t.esc(c)}"`,"is-go")}
        ${t.iconBtn("sb-reject",w.x,"Reject storyboard",`data-s="${i}" data-path="${t.esc(c)}"`)}
      </div>`:`<span class="vpc-badge">${w.check}</span>`;return`<div class="vpc-sb${o.storyboard?" is-approved":""}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${t.esc(m)}" aria-label="View storyboard ${s+1}">${t.thumb(m,"vpc-tile-img")}</button>
      <span class="vpc-sb-n">${s+1}</span>${v}</div>`}).join("")}</div>
    ${e?`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${w.check}<span>Approve all</span></button>`:""}
  </section>`}function pe(r,t,a){if(!(r.shots||[]).length)return"";let e=r.voice||{},n=e.provider||"openai",o=Object.entries(Be).map(([u,f])=>`<optgroup label="${u==="xai"?"xAI":"OpenAI"}">${f.map(x=>`<option value="${u}:${x}"${u===n&&x===e.voice?" selected":""}>${x}</option>`).join("")}</optgroup>`).join(""),s=r.captions||{},i=r.music||null,c=i?/chill/i.test(i.label||i.path||"")?"chill":/pulse/i.test(i.label||i.path||"")?"pulse":"custom":"none",m=(r.shots||[]).some(u=>u.line),v=Math.round((i?.volume??.3)*100);return`<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    <div class="vpc-row vpc-wrap">
      ${w.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${e.voice?"":'<option value="" selected>Pick a voice</option>'}${o}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${m?"":'disabled title="Add voiceover lines to shots first"'}>${w.mic}<span>Voiceover</span></button>
    </div>
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${s.enabled?" checked":""}><span>Captions</span></label>
      ${Ve.map(u=>`<button type="button" class="vpc-chip${(s.style||"bold")===u&&s.enabled?" is-on":""}" data-vpa="cap-style" data-v="${u}" aria-pressed="${(s.style||"bold")===u&&!!s.enabled}">${u}</button>`).join("")}
      ${s.cues?.length?`<span class="vpc-muted">${s.cues.length} cues</span>`:""}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[["pulse","Pulse"],["chill","Chill"],["none","None"]].map(([u,f])=>`<button type="button" class="vpc-chip${c===u?" is-on":""}" data-vpa="music" data-v="${u}" aria-pressed="${c===u}">${f}</button>`).join("")}
      ${c==="custom"?`<span class="vpc-chip is-on">${a.esc(i.label||"Custom")}</span>`:""}
      ${i?`<input class="vpc-range" type="range" min="0" max="100" value="${v}" data-vpf="volume" aria-label="Music volume" title="Music volume ${v}%">`:""}
    </div>
  </section>`}function de(r,t,a){let e=[],n=r.lastRun;n?.steps?.length&&e.push(`<ol class="vpc-steps">${n.steps.map(s=>`<li class="is-${a.esc(s.state)}" title="${a.esc(s.note||s.state)}"><span class="vpc-dot"></span>${a.esc(s.step)}${s.note?` <small class="vpc-muted">${a.esc(String(s.note).slice(0,80))}</small>`:""}</li>`).join("")}</ol>`);let o=t.actPending||(n?.needsApproval?{action:"run",args:{},usd:n.needsApproval.usd,breakdown:n.needsApproval.breakdown}:null);if(o){let s=(o.breakdown||[]).map(i=>`<li>${a.esc(i.item)} \xB7 ${a.usd(i.usd)}</li>`).join("");e.push(`<div class="vpc-approve">
      <strong>${o.action==="storyboard"?"Storyboard":o.action==="run"?"Autopilot":a.esc(o.action)} needs approval \xB7 ${a.usd(o.usd)}</strong>
      ${s?`<ul>${s}</ul>`:""}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${w.check}<span>Approve ${a.usd(o.usd)}</span></button>
        ${a.iconBtn("act-cancel",w.x,"Cancel")}
      </div></div>`)}return(r.shots||[]).length&&e.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${t.busy?"disabled":""}>${w.rocket}<span>Run all</span></button>`),e.length?`<section class="vpc-sec"><h4>Autopilot</h4>${e.join("")}</section>`:""}function le(r,t,a){let e=(r.exports||[]).slice().reverse(),n=Re.map(s=>`<button type="button" class="vpc-chip${t.aspects.has(s)?" is-on":""}" data-vpa="aspect" data-v="${s}" aria-pressed="${t.aspects.has(s)}">${s}</button>`).join(""),o=e.slice(0,6).map(s=>{let i=a.mediaUrl(s.path),c=[s.aspect,s.variant?`variant ${s.variant}`:"",`${Number(s.durationSec||0).toFixed(1)}s`].filter(Boolean).join(" \xB7 ");return`<div class="vpc-export">
      <video src="${a.esc(i)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${a.esc(c)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${a.esc(i)}" download="${a.esc(String(s.path).split("/").pop())}" title="Download" aria-label="Download">${w.download}</a>
        ${a.iconBtn("share",w.share,"Share",`data-path="${a.esc(s.path)}"`)}
      </div></div>`}).join("");return`<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${n}</div>
    ${o?`<div class="vpc-exports">${o}</div>`:""}</section>`}function Ne(){return new Promise(r=>{let t=document.createElement("input");t.type="file",t.accept="image/*",t.style.display="none",t.addEventListener("change",()=>{let a=t.files&&t.files[0];if(t.remove(),!a)return r(null);let e=new FileReader;e.onload=()=>r({filename:a.name,dataBase64:String(e.result||"").replace(/^data:[^,]*,/,"")}),e.onerror=()=>r(null),e.readAsDataURL(a)}),document.body.appendChild(t),t.click()})}async function Pe(r,t){let a=t.mediaUrl(r);try{a=new URL(a,location.href).href}catch{}if(navigator.share)try{return await navigator.share({title:"Video",url:a}),"Shared"}catch{return""}try{return await navigator.clipboard.writeText(a),"Link copied"}catch{return"Copy failed"}}async function ue(r,t){let{st:a,d:e,act:n,ops:o,paint:s,h:i}=t,c=a.project||{},m=v=>(c.shots||[]).find(u=>u.id===v);switch(r){case"upload-product":case"upload-character":{let v=await Ne();return v&&await n("import_asset",{...v,role:r==="upload-product"?"product":"character",name:v.filename.replace(/\.[^.]+$/,"")},"Uploading"),!0}case"storyboard":return await n("storyboard",{},"Storyboarding"),!0;case"sb-approve":return await o([{op:"shot.approveStoryboard",id:e.s,path:e.path}],"Approving storyboard"),!0;case"sb-reject":return await o([{op:"shot.rejectStoryboard",id:e.s,path:e.path}],"Rejecting"),!0;case"sb-approve-all":{let v=(c.shots||[]).filter(u=>!u.storyboard&&(u.storyboardCandidates||[]).length).map(u=>({op:"shot.approveStoryboard",id:u.id,path:u.storyboardCandidates[0]}));return v.length&&await o(v,"Approving storyboard"),!0}case"dur":{let v=m(e.s);if(!v)return!0;let u=Math.max(1,Math.min(30,(Number(v.durationSec)||5)+Number(e.d)));return await o([{op:"shot.update",id:e.s,durationSec:u}],"Saving"),!0}case"move":return await o([{op:"shot.move",id:e.s,index:Number(e.i)}],"Reordering"),!0;case"variants":return await n("render_variants",{shotId:e.s},"Rendering hook variants",900*1e3),!0;case"qa":return await n("qa",{},"Scoring takes",300*1e3),!0;case"voiceover":return await n("voiceover",{},"Recording voiceover",300*1e3),!0;case"cap-style":{let v=e.v;return await n("captions",{style:v},"Building captions")&&await o([{op:"captions.set",enabled:!0,style:v}],"Saving captions"),!0}case"music":return e.v==="none"?await o([{op:"music.clear"}],"Removing music"):await n("music",{builtin:e.v},"Adding music"),!0;case"run-all":return await n("run",{},"Running autopilot",1800*1e3),!0;case"act-approve":{let v=a.actPending||(c.lastRun?.needsApproval?{action:"run",args:{}}:null);return a.actPending=null,v&&await n(v.action,{...v.args||{},approved:!0},"Submitting",1800*1e3),!0}case"act-cancel":return a.actPending=null,c.lastRun&&(c.lastRun.needsApproval=void 0),s(),!0;case"aspect":return a.aspects.has(e.v)?a.aspects.delete(e.v):a.aspects.add(e.v),s(),!0;case"share":{let v=await Pe(e.path,i);return v&&(a.error="",a.busy="",a.toast=v,s()),!0}default:return!1}}async function ve(r,t){let{d:a,ops:e,value:n,checked:o,st:s}=t;switch(r){case"prompt":case"line":case"modelId":{let i=(s.project?.shots||[]).find(c=>c.id===a.s);if(i&&String(i[r]||"")===n)return;await e([{op:"shot.update",id:a.s,[r]:n}],"Saving");return}case"voice":{let[i,c]=String(n).split(":");c&&await e([{op:"voice.set",provider:i,voice:c}],"Setting voice");return}case"captions":{let i=s.project?.captions?.style||"bold";o&&!(s.project?.captions?.cues||[]).length&&await t.act("captions",{style:i},"Building captions"),await e([{op:"captions.set",enabled:!!o,style:i}],"Saving captions");return}case"volume":{let i=s.project?.music;i?.path&&await e([{op:"music.set",path:i.path,volume:Number(n)/100,duck:i.duck!==!1}],"Saving");return}default:}}var me=`
.prom-vp-card .vpc-icon{min-width:36px;min-height:36px}
.prom-vp-card a.vpc-icon{display:inline-flex;align-items:center;justify-content:center;color:inherit}
.prom-vp-card .vpc-btn{min-height:36px}
.prom-vp-card .vpc-wrap{flex-wrap:wrap}
.prom-vp-card .vpc-pill{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid var(--vpc-line);color:var(--vpc-muted)}
.prom-vp-card .vpc-pill.is-product{color:var(--vpc-accent);border-color:var(--vpc-accent)}
.prom-vp-card .vpc-edit{display:flex;flex-direction:column;gap:8px;margin:6px 0 8px}
.prom-vp-card .vpc-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--vpc-muted)}
.prom-vp-card .vpc-field textarea,.prom-vp-card .vpc-select{width:100%;box-sizing:border-box;font:inherit;font-size:13px;color:var(--vpc-text);background:var(--vpc-soft);border:1px solid var(--vpc-line);border-radius:9px;padding:7px 9px;resize:vertical}
.prom-vp-card .vpc-select{width:auto;max-width:100%;min-height:36px;flex:1 1 140px}
.prom-vp-card .vpc-stepper{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--vpc-line);border-radius:10px;padding:0 2px}
.prom-vp-card .vpc-stepper span{min-width:28px;text-align:center;font-size:13px}
.prom-vp-card .vpc-stepper .vpc-icon{border:0;background:transparent}
.prom-vp-card .vpc-audio{width:100%;height:36px}
.prom-vp-card .vpc-qa{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 6px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;cursor:help}
.prom-vp-card .vpc-qa.is-good{background:var(--prom-success,#2f9e44)}
.prom-vp-card .vpc-qa.is-warn{background:var(--prom-warning,#d9822b)}
.prom-vp-card .vpc-qa.is-bad{background:var(--prom-danger,#e5484d)}
.prom-vp-card .vpc-sbgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.prom-vp-card .vpc-sb{position:relative;aspect-ratio:9/16;max-height:200px;border:1px solid var(--vpc-line);border-radius:9px;overflow:hidden;background:var(--vpc-soft)}
.prom-vp-card .vpc-sb.is-approved{border-color:var(--vpc-accent)}
.prom-vp-card .vpc-sb .vpc-tile-media{display:block;width:100%;height:100%;padding:0;border:0;background:none;cursor:pointer}
.prom-vp-card .vpc-sb .vpc-tile-img{width:100%;height:100%;object-fit:cover;display:block}
.prom-vp-card .vpc-sb-n{position:absolute;top:4px;left:4px;font-size:11px;font-weight:700;padding:0 6px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff}
.prom-vp-card .vpc-sb .vpc-tile-actions{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:4px;padding:4px;background:rgba(0,0,0,.45)}
.prom-vp-card .vpc-sb .vpc-badge{position:absolute;top:4px;right:4px}
.prom-vp-card .vpc-chip{min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--vpc-line);background:transparent;color:var(--vpc-text);font:inherit;font-size:12px;text-transform:capitalize;cursor:pointer}
.prom-vp-card .vpc-chip.is-on{border-color:var(--vpc-accent);color:var(--vpc-accent);font-weight:600}
.prom-vp-card .vpc-switch{display:inline-flex;align-items:center;gap:6px;min-height:36px;font-size:13px;cursor:pointer}
.prom-vp-card .vpc-switch input{width:18px;height:18px;accent-color:var(--vpc-accent)}
.prom-vp-card .vpc-range{flex:1 1 120px;min-height:36px;accent-color:var(--vpc-accent)}
.prom-vp-card .vpc-audio-sec .vpc-row+.vpc-row{margin-top:6px}
.prom-vp-card .vpc-steps{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:3px;font-size:12px}
.prom-vp-card .vpc-steps li{display:flex;gap:6px;align-items:center}
.prom-vp-card .vpc-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--vpc-muted)}
.prom-vp-card .vpc-steps .is-done .vpc-dot{background:var(--prom-success,#2f9e44)}
.prom-vp-card .vpc-steps .is-failed .vpc-dot{background:var(--prom-danger,#e5484d)}
.prom-vp-card .vpc-steps .is-needs_approval .vpc-dot{background:var(--prom-warning,#d9822b)}
.prom-vp-card .vpc-steps .is-skipped{color:var(--vpc-muted)}
.prom-vp-card .vpc-exports{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px}
.prom-vp-card .vpc-export{border:1px solid var(--vpc-line);border-radius:9px;overflow:hidden}
.prom-vp-card .vpc-export video{display:block;width:100%;max-height:260px;background:#000}
.prom-vp-card .vpc-export .vpc-row{padding:2px 6px}
.prom-vp-card .vpc-toast{padding:6px 12px;font-size:12px;color:var(--vpc-accent);border-bottom:1px solid var(--vpc-line)}
@media (max-width:420px){.prom-vp-card .vpc-tools{flex-wrap:wrap;justify-content:flex-end;max-width:50%}}
`;var he="prom-vp-card-style",Ue=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",ge=new Map,A=(r,t="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${t}>${r}</svg>`,y={film:A('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:A('<path d="M5 12l5 5L20 7"/>'),x:A('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:A('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:A('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:A('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:A('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:A('<path d="M7 4v16l13-8z"/>'),seq:A('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:A('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:A('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:A('<path d="M6 9l6 6 6-6"/>'),user:A('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:A('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:A('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function g(r){return String(r??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function N(r){return`$${(Number(r)||0).toFixed(2)}`}function W(r){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(r||""))}function Q(r){return String(r||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function F(r){let t=String(r||"").trim();if(!t)return"";if(/^(https?:|data:|blob:)/i.test(t))return t;let a=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof a=="function")try{let e=a(t);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}async function P(r,t,a=2e4){let e={method:t===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:t===void 0?void 0:JSON.stringify(t),timeoutMs:a},n=`/api/video-projects${r}`,o=window.__promVideoProjectFetch||window.api,s;if(typeof o=="function")s=await o(n,e);else{let i=await fetch(n,e);s=await i.json().catch(()=>({success:!1,error:`HTTP ${i.status}`}))}if(s&&s.success===!1)throw new Error(s.error||"Request failed");return s||{}}function fe(r){let t=r?.takes||[];return t.length?t.find(a=>a.id===r.selectedTakeId)||t[t.length-1]:null}function Z(r,t="vpc-thumb"){if(!r)return`<span class="${t} is-empty">${y.film}</span>`;let a=g(F(r));return W(r)?`<video class="${t}" src="${a}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${t}" src="${a}" alt="" loading="lazy" decoding="async">`}function I(r,t,a,e="",n=""){return`<button type="button" class="vpc-icon${n?` ${n}`:""}" data-vpa="${r}" title="${g(a)}" aria-label="${g(a)}" ${e}>${t}</button>`}function Oe(r){r.dataset.vpMounted="1";let t=String(r.dataset.vpProject||""),a=ge.get(t),e={project:a?.project||null,history:a?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1,actPending:null,models:[],aspects:new Set,toast:""},n={esc:g,usd:N,isVideo:W,mediaUrl:F,thumb:Z,iconBtn:I,vpFetch:P},o=null,s=()=>r.isConnected;function i(d){d?.project&&(e.project=d.project),d?.history&&(e.history=d.history),e.project&&ge.set(t,{project:e.project,history:e.history,at:Date.now()})}async function c(){if(s()){try{i(await P(`/${encodeURIComponent(t)}`)),e.error=""}catch(d){e.error=String(d?.message||d)}await f(),B(),v()}}function m(){return(e.project?.jobs||[]).filter(d=>d.state==="queued"||d.state==="running")}function v(){clearTimeout(o),s()&&(m().length||e.rendering)&&(o=setTimeout(c,3500))}function u(){let d=new Set(m().map(p=>p.target?.shotId).filter(Boolean));return(e.project?.shots||[]).filter(p=>!(p.takes||[]).length&&!d.has(p.id))}async function f(){let d=u(),p=d.map(h=>`${h.id}:${h.modelId||""}:${h.durationSec}:${(h.characterIds||[]).join(",")}`).join("|")+`#${(e.project?.characters||[]).map(h=>(h.anchors||[]).length).join(",")}`;if(!d.length){e.estimate=null,e.estimateKey="";return}if(!(p===e.estimateKey&&e.estimate))try{e.estimate=await P(`/${encodeURIComponent(t)}/estimate`,{shotIds:d.map(h=>h.id)}),e.estimateKey=p}catch(h){e.estimate=null,e.error=String(h?.message||h)}}async function x(d,p){e.busy=d,e.error="",B();try{let h=await p();return i(h),h}catch(h){return e.error=String(h?.message||h),null}finally{e.busy="",B()}}async function C(d,p){await x(p,()=>P(`/${encodeURIComponent(t)}/ops`,{ops:d})),await c()}async function R(d,p={},h="Working",b=12e4){let l=await x(h,()=>P(`/${encodeURIComponent(t)}/action`,{action:d,...p},b));if(!l)return null;let T=l.needsApproval;if(T){let M=l.lastRun?.needsApproval;e.actPending={action:d,args:p,usd:Number(M?.usd??T?.usd??l.estimateUsd??l.totalUsd??l.estimate?.total??0),breakdown:M?.breakdown||T?.breakdown||l.breakdown||[]}}else e.actPending=null;return e.estimateKey="",await c(),l}async function j(d,p,h){let b=await x(h,()=>P(`/${encodeURIComponent(t)}${d}`,p,12e4));if(b){if(b.needsApproval){e.pending={path:d,body:{...p,approved:!0},label:h,reason:b.reason,estimate:b.estimate},B();return}e.pending=null,e.estimateKey="",await c()}}async function D(){let d=e.project;if(!d)return;let p=(d.clips||[]).some(h=>h.source&&"shotId"in h.source);if(e.rendering=!0,e.aspects.size){await R("render",{aspects:[...e.aspects]},"Rendering",900*1e3),e.rendering=!1,await c();return}if(!p&&!await x("Assembling",()=>P(`/${encodeURIComponent(t)}/ops`,{ops:[{op:"timeline.assemble"}]}))){e.rendering=!1,B();return}await x("Rendering",()=>P(`/${encodeURIComponent(t)}/render`,{},900*1e3)),e.rendering=!1,await c()}function J(d,p){let h=F(d);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:h,path:d,name:p||d.split("/").pop(),kind:W(d)?"video":"image"});return}catch{}window.open(h,"_blank","noopener")}function H(d){let p=`${I("upload-product",w.box,"Upload product photo")}${I("upload-character",w.userPlus,"Upload character photo")}`;if(!(d.characters||[]).length)return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${p}</h4></section>`;let h=m().filter(l=>l.target?.characterId),b=d.characters.map(l=>{let T=h.some(S=>S.target.characterId===l.id),M=(l.anchors||[])[0],V=l.candidates||[],_=M?"Anchor approved":V.length?"Pick an anchor":T?"Generating anchor":"No anchor yet",$=[M?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${g(M)}" aria-label="View anchor">${Z(M,"vpc-tile-img")}</button><span class="vpc-badge">${y.check}</span></div>`:"",...V.map(S=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${g(S)}" aria-label="View candidate">${Z(S,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${I("approve-anchor",y.check,"Approve as anchor",`data-c="${g(l.id)}" data-path="${g(S)}"`,"is-go")}
            ${I("reject-anchor",y.x,"Reject",`data-c="${g(l.id)}" data-path="${g(S)}"`)}
          </div>
        </div>`),T?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${y.user}<strong>${g(l.name)}</strong>${ne(l)}</span>
          <span class="vpc-muted">${g(_)}</span>
          <span class="vpc-grow"></span>
          ${l.anchorPrompt?I("reroll",y.reroll,"Generate another anchor",`data-c="${g(l.id)}"`):""}
        </div>
        ${$?`<div class="vpc-strip">${$}</div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${p}</h4>${b}</section>`}function je(d){let p=d.shots||[];if(!p.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let h=new Set(m().map(l=>l.target?.shotId).filter(Boolean)),b=p.map((l,T)=>{let M=fe(l),V=h.has(l.id),_=e.openShot===l.id,$=(l.takes||[]).length,S=_?(l.takes||[]).slice().reverse().map(k=>`
        <div class="vpc-take${k.id===M?.id?" is-selected":""}">
          ${W(k.path)?`<video src="${g(F(k.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${g(F(k.path))}" alt="" loading="lazy">`}
          <div class="vpc-row">
            ${ie(k,n)}<span class="vpc-muted">${g(Q(k.modelId))} \xB7 ${N(k.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${k.id===M?.id?`<span class="vpc-inuse">${y.check}In cut</span>`:I("use-take",y.check,"Use this take",`data-s="${g(l.id)}" data-t="${g(k.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${_?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${g(l.id)}" aria-expanded="${_}">
          ${V&&!M?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':ae(l,M,d,n)}
          <span class="vpc-shot-meta">
            <strong>${T+1}. ${g(l.title||"Shot")}</strong>
            <small>${g(String(l.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${V?"generating":g(l.status)}">${V?"generating":g(l.status)} \xB7 ${l.durationSec}s \xB7 ${$} take${$===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${y.chevron}</span>
        </button>
        ${_?`<div class="vpc-shot-body">
          ${se(l,T,p.length,e,n)}
          ${l.camera?`<p class="vpc-muted">Camera: ${g(l.camera)}</p>`:""}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${g(l.id)}" data-n="1" ${V?"disabled":""}>${y.reroll}<span>${$?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${g(l.id)}" data-n="3" ${V?"disabled":""}>${y.layers}<span>3 variations</span></button>
          </div>
          ${S?`<div class="vpc-takes">${S}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${p.length}</span></h4>${b}</section>`}function _e(d){let p=[];if(e.pending){let $=(e.pending.estimate?.shots||[]).map(S=>`<li>${g(S.title||"Item")}: ${S.count}\xD7 ${g(Q(S.modelId))} \xB7 ${N(S.usd)}</li>`).join("");p.push(`<div class="vpc-approve">
        <strong>Approve ${N(e.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${g(e.pending.reason||"")}</p>
        ${$?`<ul>${$}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${y.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${y.x}<span>Cancel</span></button>
        </div>
      </div>`)}let h=u(),b=e.estimate;if(!e.pending&&h.length&&b){let $=(b.shots||[]).flatMap(k=>(k.problems||[]).map(Le=>`${k.title}: ${Le}`)),S=(d.characters||[]).some(k=>!(k.anchors||[]).length&&(k.candidates||[]).length);p.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${h.length} shot${h.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${N(b.total)}</strong></div>
        ${S?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${$.length?`<ul class="vpc-warn">${$.map(k=>`<li>${g(k)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${S?"disabled":""}>${y.spark}<span>${b.total>(d.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${N(b.total)}</span></button>
      </div>`)}let l=m();l.length&&p.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${l.length} job${l.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let T=(d.jobs||[]).filter($=>$.state==="failed").slice(-2);T.length&&!l.length&&p.push(`<ul class="vpc-warn">${T.map($=>`<li>${g(Q($.modelId))} failed: ${g(String($.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let M=d.shots||[],V=M.length&&M.every($=>fe($)),_=(d.exports||[]).slice(-1)[0];return(V||_)&&p.push(`<div class="vpc-final">
        ${_?`<video src="${g(F(_.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(_.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${I("view",y.download,"Open video",`data-path="${g(_.path)}"`)}</div>`:""}
        ${V?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${e.rendering||l.length?"disabled":""}>${e.rendering?'<span class="vpc-spin"></span>':y.play}<span>${_?"Re-render":"Render video"}</span></button>
          ${I("assemble",y.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),p.length?`<section class="vpc-sec vpc-actions">${p.join("")}</section>`:""}function B(){if(!s())return;let d=document.activeElement;if(d&&r.contains(d)&&d.matches?.("textarea[data-vpf]")&&!e.busy)return;let p=e.project;if(!p){r.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${y.film}Video project</span></div>
        <p class="vpc-muted">${e.error?g(e.error):"Loading\u2026"}</p></div>`;return}let h=p.budget||{};r.innerHTML=`<div class="vpc">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${y.film}Video project \xB7 ${g(p.target?.aspect||"")}</span>
          <strong class="vpc-title">${g(p.title||p.id)}</strong>
          <span class="vpc-muted">${N(h.spentUsd)} spent${h.capUsd!=null?` of ${N(h.capUsd)}`:""} \xB7 auto-approve under ${N(h.autoApproveUsd??1)}</span>
        </div>
        <div class="vpc-tools">
          ${I("undo",y.undo,"Undo",e.history?.undo?"":"disabled")}
          ${I("redo",y.redo,"Redo",e.history?.redo?"":"disabled")}
          ${I("storyboard",w.grid,"Generate storyboard")}
          ${I("qa",w.gauge,"QA: score selected takes")}
          ${I("refresh",y.refresh,"Refresh")}
        </div>
      </div>
      ${e.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${g(e.busy)}\u2026</div>`:""}
      ${e.error?`<p class="vpc-err">${g(e.error)}</p>`:""}
      ${e.toast?`<div class="vpc-toast">${g(e.toast)}</div>`:""}
      ${H(p)}
      ${ce(p,n)}
      ${je(p)}
      ${pe(p,e,n)}
      ${_e(p)}
      ${de(p,e,n)}
      ${le(p,e,n)}
    </div>`}r.addEventListener("click",async d=>{let p=d.target.closest("[data-vpa]");if(!p||!r.contains(p)||p.disabled||(d.preventDefault(),d.stopPropagation(),e.busy&&p.dataset.vpa!=="toggle"&&p.dataset.vpa!=="view"))return;let h=p.dataset.vpa,b=p.dataset;switch(h){case"toggle":e.openShot=e.openShot===b.s?"":b.s,B(),e.openShot&&!e.models.length&&oe(n).then(l=>{e.models=l,l.length&&B()});return;case"view":b.path&&J(b.path);return;case"refresh":e.estimateKey="",await c();return;case"undo":case"redo":await x(h==="undo"?"Undoing":"Redoing",()=>P(`/${encodeURIComponent(t)}/${h}`,{})),e.estimateKey="",await c();return;case"approve-anchor":await C([{op:"character.approveAnchor",id:b.c,path:b.path}],"Approving anchor");return;case"reject-anchor":await C([{op:"character.rejectAnchor",id:b.c,path:b.path}],"Removing");return;case"reroll":await j(`/characters/${encodeURIComponent(b.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await C([{op:"take.select",shotId:b.s,takeId:b.t}],"Swapping take");return;case"redo-shot":await j("/generate",{shotIds:[b.s],count:Number(b.n)||1},"Estimating");return;case"gen-all":{let l=u().map(T=>T.id);if(!l.length)return;await j("/generate",{shotIds:l,count:1,approved:!0},"Submitting");return}case"approve-pending":{let l=e.pending;if(!l)return;e.pending=null,await j(l.path,l.body,"Submitting");return}case"cancel-pending":e.pending=null,B();return;case"assemble":await C([{op:"timeline.assemble"}],"Assembling");return;case"render":await D();return;default:e.toast="",await ue(h,{st:e,d:b,act:R,ops:C,paint:B,h:n})}}),r.addEventListener("change",async d=>{let p=d.target.closest?.("[data-vpf]");!p||!r.contains(p)||e.busy||await ve(p.dataset.vpf,{st:e,d:p.dataset,ops:C,act:R,value:p.value,checked:p.checked})}),r.addEventListener("click",d=>{d.target.closest?.("[data-vpf]")&&d.stopPropagation()}),B(),a&&Date.now()-a.at<3e3?f().then(()=>{B(),v()}):c()}var ee=null,te=!1;function be(r=document){te=!1,r.querySelectorAll?.(Ue).forEach(t=>{try{Oe(t)}catch(a){console.warn("[video-project-card] mount failed",a)}})}function xe(){if(!(typeof document>"u")){if(!document.getElementById(he)){let r=document.createElement("style");r.id=he,r.textContent=Fe+me,document.head.appendChild(r)}be(),!ee&&(ee=new MutationObserver(()=>{te||(te=!0,requestAnimationFrame(()=>be()))}),ee.observe(document.documentElement,{childList:!0,subtree:!0}))}}var Fe=`
.prom-vp-card{--vpc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--vpc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--vpc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--vpc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--vpc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.1))));--vpc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));display:block;margin:10px 0;max-width:100%;color:var(--vpc-text);font-size:14px;line-height:1.4}
.prom-vp-card .vpc{border:1px solid var(--vpc-line);border-radius:14px;background:var(--vpc-surface);overflow:hidden}
.prom-vp-card svg{width:16px;height:16px;flex:none}
.prom-vp-card .vpc-head{display:flex;gap:10px;align-items:flex-start;padding:12px 12px 10px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-headtext{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.prom-vp-card .vpc-kicker{display:inline-flex;gap:6px;align-items:center;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--vpc-muted)}
.prom-vp-card .vpc-kicker svg{width:13px;height:13px}
.prom-vp-card .vpc-title{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-vp-card .vpc-muted{color:var(--vpc-muted);font-size:12px}
.prom-vp-card .vpc-tools{display:flex;gap:2px}
.prom-vp-card .vpc-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:0;background:transparent;color:var(--vpc-text);cursor:pointer;padding:0}
.prom-vp-card .vpc-icon:hover{background:var(--vpc-soft)}
.prom-vp-card .vpc-icon:disabled{opacity:.35;cursor:default}
.prom-vp-card .vpc-icon.is-go{color:var(--vpc-accent)}
.prom-vp-card .vpc-sec{padding:10px 12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-sec:last-child{border-bottom:0}
.prom-vp-card h4{margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--vpc-muted);display:flex;gap:6px}
.prom-vp-card .vpc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.prom-vp-card .vpc-grow{flex:1}
.prom-vp-card .vpc-char+.vpc-char{margin-top:10px}
.prom-vp-card .vpc-char-name{display:inline-flex;gap:6px;align-items:center}
.prom-vp-card .vpc-strip{display:flex;gap:8px;overflow-x:auto;padding:8px 0 2px;scrollbar-width:thin}
.prom-vp-card .vpc-tile{position:relative;flex:none;width:112px;border-radius:10px;overflow:hidden;border:1px solid var(--vpc-line);background:var(--vpc-soft)}
.prom-vp-card .vpc-tile.is-approved{border-color:var(--vpc-accent);box-shadow:0 0 0 1px var(--vpc-accent)}
.prom-vp-card .vpc-tile.is-loading{height:140px;display:flex;align-items:center;justify-content:center}
.prom-vp-card .vpc-tile-media{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in}
.prom-vp-card .vpc-tile-img{display:block;width:100%;height:140px;object-fit:cover}
.prom-vp-card .vpc-tile-actions{display:flex;justify-content:space-around;border-top:1px solid var(--vpc-line)}
.prom-vp-card .vpc-badge{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--vpc-accent);color:#fff}
.prom-vp-card .vpc-badge svg{width:13px;height:13px}
.prom-vp-card .vpc-shot{border:1px solid var(--vpc-line);border-radius:11px;overflow:hidden}
.prom-vp-card .vpc-shot+.vpc-shot{margin-top:8px}
.prom-vp-card .vpc-shot-head{display:flex;gap:10px;align-items:center;width:100%;padding:8px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.prom-vp-card .vpc-thumb{flex:none;width:72px;height:48px;border-radius:7px;object-fit:cover;background:var(--vpc-soft);display:flex;align-items:center;justify-content:center;color:var(--vpc-muted)}
.prom-vp-card .vpc-shot-meta{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.prom-vp-card .vpc-shot-meta small{color:var(--vpc-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-vp-card .vpc-status{font-size:11px;color:var(--vpc-muted)}
.prom-vp-card .vpc-status.is-ready{color:var(--prom-success,#2eaa5c)}
.prom-vp-card .vpc-status.is-failed{color:var(--prom-danger,#e5484d)}
.prom-vp-card .vpc-status.is-generating{color:var(--vpc-accent)}
.prom-vp-card .vpc-chev{color:var(--vpc-muted);transition:transform .15s}
.prom-vp-card .vpc-shot.is-open .vpc-chev{transform:rotate(180deg)}
.prom-vp-card .vpc-shot-body{padding:0 8px 10px}
.prom-vp-card .vpc-prompt{margin:0 0 8px;font-size:13px}
.prom-vp-card .vpc-takes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px}
.prom-vp-card .vpc-take{border:1px solid var(--vpc-line);border-radius:9px;overflow:hidden;padding-bottom:2px}
.prom-vp-card .vpc-take.is-selected{border-color:var(--vpc-accent)}
.prom-vp-card .vpc-take video,.prom-vp-card .vpc-take img{display:block;width:100%;max-height:220px;background:#000;object-fit:contain}
.prom-vp-card .vpc-take .vpc-row{padding:4px 6px 2px}
.prom-vp-card .vpc-inuse{display:inline-flex;gap:4px;align-items:center;font-size:12px;color:var(--vpc-accent)}
.prom-vp-card .vpc-inuse svg{width:13px;height:13px}
.prom-vp-card .vpc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--vpc-line);background:var(--vpc-soft);color:var(--vpc-text);font:inherit;font-size:13px;cursor:pointer}
.prom-vp-card .vpc-btn:disabled{opacity:.45;cursor:default}
.prom-vp-card .vpc-btn.is-primary{background:var(--vpc-accent);border-color:transparent;color:#fff;font-weight:600}
.prom-vp-card .vpc-btn.is-wide{width:100%;margin-top:8px;min-height:40px}
.prom-vp-card .vpc-actions>*+*{margin-top:10px}
.prom-vp-card .vpc-approve{border:1px solid var(--vpc-accent);border-radius:11px;padding:10px}
.prom-vp-card .vpc-approve p{margin:4px 0}
.prom-vp-card ul{margin:6px 0;padding-left:18px;font-size:12px}
.prom-vp-card .vpc-warn{color:var(--prom-warning,#d9822b);font-size:12px;margin:6px 0}
.prom-vp-card .vpc-err{margin:0;padding:8px 12px;color:var(--prom-danger,#e5484d);font-size:12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-busy,.prom-vp-card .vpc-jobs{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--vpc-muted)}
.prom-vp-card .vpc-busy{padding:6px 12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-final video{display:block;width:100%;max-height:420px;border-radius:10px;background:#000}
.prom-vp-card .vpc-final .vpc-row{margin-top:6px}
.prom-vp-card .vpc-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--vpc-line);border-top-color:var(--vpc-accent);animation:vpc-spin .8s linear infinite;flex:none}
@keyframes vpc-spin{to{transform:rotate(360deg)}}
`;function L(r){return r?String(r).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var wt=L;function qe(r){let t=Date.now()-r;return t<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?`${Math.floor(t/36e5)}h ago`:`${Math.floor(t/864e5)}d ago`}function De(r,t=0){let a=Number(r);return Number.isFinite(a)?`${a.toFixed(t)}%`:"--%"}function He(r,t){let a=Number(r),e=Number(t);return!Number.isFinite(a)||!Number.isFinite(e)||e<=0?"-- / -- GB":`${a.toFixed(1)} / ${e.toFixed(1)} GB`}function we(r){let t=Number(r);return Number.isFinite(t)?`${Math.max(0,Math.min(100,t))}%`:"0%"}function Ye(r,t){let a=document.getElementById(r);a&&(a.textContent=String(t||""))}function $t(r){let t=String(r||"").trim(),a=L(t);return`<span class="t-think-sizer" aria-hidden="true">${a}</span><span class="t-think-text" data-text="${a}">${a}</span>`}function St(r,t){let a=String(t||"").trim(),e=r?.querySelector?.(".t-think-text");if(!e||!a)return!1;let n=String(e.textContent||"").trim();if(!n||n===a)return!1;r.querySelectorAll?.(".t-think-text").forEach(c=>{c!==e&&c.remove()});let o=e.cloneNode(!0);o.classList.remove("is-enter-start"),o.classList.add("is-exit"),o.textContent=a,o.setAttribute("data-text",a),e.classList.remove("is-exit"),e.classList.add("is-enter-start");let s=r.querySelector?.(".t-think-sizer");s&&a.length>String(s.textContent||"").length&&(s.textContent=a),r.appendChild(o),e.offsetWidth;let i=()=>{e.isConnected!==!1&&e.classList.remove("is-enter-start")};return typeof requestAnimationFrame=="function"?requestAnimationFrame(i):typeof setTimeout=="function"&&setTimeout(i,0),typeof setTimeout=="function"&&setTimeout(()=>{o.isConnected!==!1&&o.remove(),e.isConnected!==!1&&e.classList.remove("is-enter-start")},420),!0}function We(r,t){let a=document.getElementById(r);a&&(a.style.width=we(t))}function $e(r,t,a="info",e=5e3,n={}){let o=typeof n?.key=="string"?n.key.trim():"";if(o)for(let f of document.querySelectorAll(".__sc-toast"))f.dataset.scToastKey===o&&f.remove();let s=a==="warn"?"warning":["info","success","error","warning"].includes(a)?a:"info",i={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},c=document.createElement("div"),v=24+[...document.querySelectorAll(".__sc-toast")].reduce((f,x)=>f+x.offsetHeight+8,0);if(c.className=`__sc-toast __sc-toast--${s}`,o&&(c.dataset.scToastKey=o),c.style.cssText=`position:fixed;bottom:${v}px;right:24px;z-index:99999;`,c.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${i[s]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${L(r)}</div>
      ${t?`<div class="__sc-toast-body">${L(String(t))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let f=document.createElement("style");f.id="__sc-toast-style",f.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(f)}document.body.appendChild(c);let u=Math.max(0,Math.min(5e3,Number.isFinite(Number(e))?Number(e):5e3));setTimeout(()=>{c.style.transition="opacity 0.3s",c.style.opacity="0",setTimeout(()=>c.remove(),300)},u),c.querySelector(".__sc-toast-close")?.addEventListener("click",()=>c.remove())}function Ge(r,t){$e(r,t,"info")}function Ke(r,t,a,e={}){let{title:n="Confirm",confirmText:o="Confirm",cancelText:s="Cancel",danger:i=!1,details:c=""}=e,m=document.createElement("div");m.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let v=document.createElement("div");v.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",v.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${L(n)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${L(r)}</div>
    ${c?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${L(c)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${L(s)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${i?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${L(o)}</button>
    </div>
  `,m.appendChild(v),document.body.appendChild(m);let u=()=>m.remove();v.querySelector("#__sc-confirm-cancel").onclick=()=>{u(),a&&a()},v.querySelector("#__sc-confirm-ok").onclick=()=>{u(),t&&t()},m.addEventListener("click",f=>{f.target===m&&(u(),a&&a())})}var G=[];function Xe(r,t="log"){let a=new Date().toLocaleTimeString();G.push({text:`[${a}] ${String(r??"")}`,type:String(t||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),G.length>100&&G.shift();let e=document.getElementById("log-panel");e&&(e.replaceChildren(...G.map(n=>{let o=document.createElement("div");return o.className=`log-line ${n.type}`,o.textContent=n.text,o})),e.scrollTop=e.scrollHeight)}var z=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function Se(r,t){return String(r||"").replace(/[<>{};\r\n]/g,"").trim()||t}function ke(){let r=document.documentElement,t=typeof getComputedStyle=="function"?getComputedStyle(r):null,a=(n,o)=>{for(let s of n){let i=t?.getPropertyValue(s)?.trim();if(i)return Se(i,o)}return o},e={isDark:r.getAttribute("data-theme")==="dark",bg:a(["--bg","--pm-chat-page-bg"],z.bg),bgSoft:a(["--bg-soft"],z.bgSoft),surface:a(["--panel","--composer-panel"],z.surface),surfaceSecondary:a(["--panel-2","--composer-bg"],z.surfaceSecondary),border:a(["--line","--composer-border"],z.border),borderStrong:a(["--line-strong"],z.borderStrong),text:a(["--text","--fg","--composer-text"],z.text),muted:a(["--muted","--composer-muted"],z.muted),accent:a(["--brand","--pm-custom-accent"],z.accent),accentStrong:a(["--brand-2"],z.accentStrong),success:a(["--ok"],z.success),warning:a(["--warn"],z.warning),danger:a(["--err"],z.danger)};return e.series=[e.accent,e.accentStrong,e.success,e.warning,e.danger,e.muted],e.vars={"--prom-bg":e.bg,"--prom-bg-soft":e.bgSoft,"--prom-surface":e.surface,"--prom-surface-secondary":e.surfaceSecondary,"--prom-border":e.border,"--prom-border-strong":e.borderStrong,"--prom-text":e.text,"--prom-muted":e.muted,"--prom-accent":e.accent,"--prom-accent-strong":e.accentStrong,"--prom-success":e.success,"--prom-warning":e.warning,"--prom-danger":e.danger,"--prom-series-1":e.series[0],"--prom-series-2":e.series[1],"--prom-series-3":e.series[2],"--prom-series-4":e.series[3],"--prom-series-5":e.series[4],"--prom-series-6":e.series[5],"--bg":e.bg,"--bg-soft":e.bgSoft,"--panel":e.surface,"--panel-2":e.surfaceSecondary,"--line":e.border,"--line-strong":e.borderStrong,"--text":e.text,"--fg":e.text,"--muted":e.muted,"--brand":e.accent,"--brand-2":e.accentStrong,"--ok":e.success,"--warn":e.warning,"--err":e.danger},e}function Je(r){if(r&&typeof r=="object"&&r.vars)return r;let t={isDark:typeof r=="boolean"?r:!!r?.isDark,...z};return t.series=[t.accent,t.accentStrong,t.success,t.warning,t.danger,t.muted],t.vars=Object.fromEntries([["--prom-bg",t.bg],["--prom-bg-soft",t.bgSoft],["--prom-surface",t.surface],["--prom-surface-secondary",t.surfaceSecondary],["--prom-border",t.border],["--prom-border-strong",t.borderStrong],["--prom-text",t.text],["--prom-muted",t.muted],["--prom-accent",t.accent],["--prom-accent-strong",t.accentStrong],["--prom-success",t.success],["--prom-warning",t.warning],["--prom-danger",t.danger],...t.series.map((a,e)=>[`--prom-series-${e+1}`,a]),["--bg",t.bg],["--bg-soft",t.bgSoft],["--panel",t.surface],["--panel-2",t.surfaceSecondary],["--line",t.border],["--line-strong",t.borderStrong],["--text",t.text],["--fg",t.text],["--muted",t.muted],["--brand",t.accent],["--brand-2",t.accentStrong],["--ok",t.success],["--warn",t.warning],["--err",t.danger]]),t}function Qe(r){let t=r?.vars&&typeof r.vars=="object"?r.vars:{};return Object.entries(t).map(([a,e])=>`${a}:${Se(e,"transparent")}`).join(";")}function Ce(r,t,a){let e=Je(a),n=X({background:"transparent",primaryColor:e.surface,primaryTextColor:e.text,primaryBorderColor:e.borderStrong,lineColor:e.muted,secondaryColor:e.surfaceSecondary,secondaryTextColor:e.text,secondaryBorderColor:e.border,tertiaryColor:e.bgSoft,tertiaryTextColor:e.text,tertiaryBorderColor:e.border,textColor:e.text,mainBkg:e.surface,nodeBorder:e.borderStrong,clusterBkg:e.surfaceSecondary,clusterBorder:e.border,edgeLabelBackground:"transparent"}),o=X({text:e.text,muted:e.muted,border:e.border,series:e.series}),s=`:root{${Qe(e)}color-scheme:${e.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${e.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return r==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${s}body{display:flex;align-items:center;justify-content:center;min-height:220px;padding:8px}canvas{width:100%!important;max-width:100%;max-height:100%}</style>
</head><body><canvas id="c"></canvas>
<script>try{const visualTheme=${o};Chart.defaults.color=visualTheme.text;Chart.defaults.borderColor=visualTheme.border;const cfg=(${t});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};const datasets=cfg.data&&Array.isArray(cfg.data.datasets)?cfg.data.datasets:[];datasets.forEach((dataset,index)=>{const color=visualTheme.series[index%visualTheme.series.length];if(!dataset.backgroundColor)dataset.backgroundColor=color;if(!dataset.borderColor)dataset.borderColor=color;});const chart=new Chart(document.getElementById('c'),cfg);window.addEventListener('prometheus:visual-theme-change',(event)=>{const next=event.detail||{};if(next.text)Chart.defaults.color=next.text;if(next.border)Chart.defaults.borderColor=next.border;chart.update('none');});}catch(e){document.body.innerHTML='<pre style="color:var(--prom-danger);padding:8px;font-size:11px;white-space:pre-wrap">'+e.message+'<\\/pre>';}<\/script>
</body></html>`:r==="svg"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${s}body{padding:0}.sv-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.sv-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.sv-viewport.dragging{cursor:grabbing}.sv-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.sv-stage svg{max-width:none!important;height:auto;display:block}.sv-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-controls,.sv-shell:focus-within .sv-controls{opacity:1;transform:translateY(0);pointer-events:auto}.sv-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.sv-btn:hover{filter:brightness(1.08)}.sv-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-hint,.sv-shell:focus-within .sv-hint{opacity:.82;transform:translateY(0)}</style>
</head><body>
<div class="sv-shell">
  <div class="sv-controls">
    <button class="sv-btn" id="sv-out" type="button">-</button>
    <button class="sv-btn" id="sv-in" type="button">+</button>
    <button class="sv-btn" id="sv-reset" type="button">Reset</button>
  </div>
  <div class="sv-viewport" id="sv-vp">
    <div class="sv-stage" id="sv-stage">${t}</div>
  </div>
  <div class="sv-hint">Pinch to zoom \xB7 Drag to pan</div>
</div>
<script>
(function(){
  const viewport=document.getElementById('sv-vp');
  const stage=document.getElementById('sv-stage');
  const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
  let scale=1,tx=0,ty=0,minScale=0.2,maxScale=8;

  function applyTransform(){stage.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';}

  function normalizeSvgSize(){
    const svg=stage.querySelector('svg');if(!svg)return;
    const vb=svg.viewBox&&svg.viewBox.baseVal?svg.viewBox.baseVal:null;
    if(!vb||!vb.width||!vb.height)return;
    const rawW=String(svg.getAttribute('width')||''),rawH=String(svg.getAttribute('height')||'');
    if(!rawW||rawW.includes('%'))svg.setAttribute('width',String(vb.width));
    if(!rawH||rawH.includes('%'))svg.setAttribute('height',String(vb.height));
  }

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
  requestAnimationFrame(()=>{normalizeSvgSize();fitToViewport();setTimeout(fitToViewport,80);});
})();
<\/script>
</body></html>`:r==="mermaid"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/mermaid/mermaid.min.js"><\/script>
<style>${s}body{padding:0}.mm-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.mm-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.mm-viewport.dragging{cursor:grabbing}.mm-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.mermaid svg{max-width:none!important;height:auto;background:transparent!important}.mermaid{background:transparent!important}.mm-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-controls{opacity:1;transform:translateY(0);pointer-events:auto}.mm-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.mm-btn:hover{filter:brightness(1.08)}.mm-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-hint{opacity:.82;transform:translateY(0)}</style>
</head><body>
<div class="mm-shell">
  <div class="mm-controls">
    <button class="mm-btn" id="mm-zoom-out" type="button">-</button>
    <button class="mm-btn" id="mm-zoom-in" type="button">+</button>
    <button class="mm-btn" id="mm-reset" type="button">Reset</button>
  </div>
  <div class="mm-viewport" id="mm-viewport">
    <div class="mm-stage" id="mm-stage">
      <div class="mermaid" id="mm-graph">${t.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    </div>
  </div>
  <div class="mm-hint">Pinch to zoom \xB7 Drag to pan</div>
</div>
<script>
(function(){
  const viewport = document.getElementById('mm-viewport');
  const stage = document.getElementById('mm-stage');
  const graphEl = document.getElementById('mm-graph');
  const mermaidSource = graphEl.textContent || '';
  const baseMermaidThemeVariables = ${n};
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

  function normalizeSvgSize() {
    const svg = stage.querySelector('svg');
    const vb = svg && svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : null;
    if (!svg || !vb || !vb.width || !vb.height) return;
    svg.setAttribute('width', String(vb.width));
    svg.setAttribute('height', String(vb.height));
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
    stage.innerHTML = '<pre style="color:var(--prom-danger);padding:12px;font-size:11px;white-space:pre-wrap">Mermaid render error: ' + msg + '</pre>';
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
      mm.initialize({startOnLoad:false,theme:'base',securityLevel:'strict',htmlLabels:false,themeVariables:baseMermaidThemeVariables});
      const run = mm.run
        ? mm.run({ querySelector: '#mm-graph' })
        : Promise.resolve(mm.init(undefined, graphEl));
      window.addEventListener('prometheus:visual-theme-change',(event)=>{
        const next=event.detail||{};
        graphEl.textContent=mermaidSource;
        mm.initialize({startOnLoad:false,theme:'base',securityLevel:'strict',htmlLabels:false,themeVariables:Object.assign({},baseMermaidThemeVariables,{
          primaryColor:next.surface||baseMermaidThemeVariables.primaryColor,
          primaryTextColor:next.text||baseMermaidThemeVariables.primaryTextColor,
          primaryBorderColor:next.borderStrong||baseMermaidThemeVariables.primaryBorderColor,
          lineColor:next.muted||baseMermaidThemeVariables.lineColor,
          secondaryColor:next.surfaceSecondary||baseMermaidThemeVariables.secondaryColor,
          secondaryTextColor:next.text||baseMermaidThemeVariables.secondaryTextColor,
          secondaryBorderColor:next.border||baseMermaidThemeVariables.secondaryBorderColor,
          tertiaryColor:next.bgSoft||baseMermaidThemeVariables.tertiaryColor,
          tertiaryTextColor:next.text||baseMermaidThemeVariables.tertiaryTextColor,
          tertiaryBorderColor:next.border||baseMermaidThemeVariables.tertiaryBorderColor,
          textColor:next.text||baseMermaidThemeVariables.textColor,
          mainBkg:next.surface||baseMermaidThemeVariables.mainBkg,
          nodeBorder:next.borderStrong||baseMermaidThemeVariables.nodeBorder,
          clusterBkg:next.surfaceSecondary||baseMermaidThemeVariables.clusterBkg,
          clusterBorder:next.border||baseMermaidThemeVariables.clusterBorder,
        })});
        const rerun=mm.run?mm.run({querySelector:'#mm-graph'}):Promise.resolve(mm.init(undefined,graphEl));
        Promise.resolve(rerun).then(()=>{normalizeSvgSize();fitToViewport();}).catch(showRenderError);
      });
      return Promise.resolve(run);
    })
    .then(() => {
      if (!stage.querySelector('svg')) throw new Error('No SVG output');
      requestAnimationFrame(() => {
        normalizeSvgSize();
        fitToViewport();
        setTimeout(fitToViewport, 80);
      });
    })
    .catch(showRenderError);
})();
<\/script>
</body></html>`:`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${s}body{font-family:inherit;color:var(--prom-text);min-height:0;width:100%;overflow-x:hidden}</style>
</head><body>${t}</body></html>`}function O(r){return String(r||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function X(r){return JSON.stringify(r??null).replace(/</g,"\\u003c")}function Ze(r,t={}){let a=String(t.visualId||""),e=t.state&&typeof t.state=="object"?t.state:{},n=`<script>(function(){
var visualId=${X(a)},last=0,state=${X(e)}||{};
function post(type,extra){try{parent.postMessage(Object.assign({type:type,visualId:visualId},extra||{}),'*')}catch(e){}}
function send(){try{var d=document.documentElement,b=document.body;var viewport=Math.max(120,window.innerHeight||0);var measured=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0,d?d.offsetHeight:0,b?b.offsetHeight:0);var h=measured<=viewport+24?viewport:measured;h=Math.min(10000,Math.max(120,h));if(Math.abs(h-last)>1){last=h;post('prometheus:visual-resize',{height:h})}}catch(e){}}
function keyFor(el,index){return el.getAttribute('data-state-key')||el.id||el.name||('control-'+index)}
function captureControls(){var controls={};document.querySelectorAll('input,select,textarea').forEach(function(el,index){var key=keyFor(el,index);controls[key]={value:el.value};if(el.type==='checkbox'||el.type==='radio')controls[key].checked=!!el.checked});var details={};document.querySelectorAll('details').forEach(function(el,index){details[el.id||('details-'+index)]=!!el.open});state=Object.assign({},state,{controls:controls,details:details});if(window.openai)window.openai.widgetState=state;post('prometheus:visual-state',{state:state});return state}
function restoreControls(){var controls=state&&state.controls||{};document.querySelectorAll('input,select,textarea').forEach(function(el,index){var saved=controls[keyFor(el,index)];if(!saved)return;if(Object.prototype.hasOwnProperty.call(saved,'value'))el.value=saved.value;if(Object.prototype.hasOwnProperty.call(saved,'checked'))el.checked=!!saved.checked});var details=state&&state.details||{};document.querySelectorAll('details').forEach(function(el,index){var key=el.id||('details-'+index);if(Object.prototype.hasOwnProperty.call(details,key))el.open=!!details[key]})}
function applyTheme(theme){try{if(!theme||typeof theme!=='object')return;var vars=theme.vars||{};Object.keys(vars).forEach(function(name){if(/^--[a-z0-9-]+$/i.test(name))document.documentElement.style.setProperty(name,String(vars[name]||''))});window.dispatchEvent(new CustomEvent('prometheus:visual-theme-change',{detail:theme}));send()}catch(e){}}
window.addEventListener('message',function(event){var data=event&&event.data;if(!data||data.type!=='prometheus:visual-theme'||String(data.visualId||'')!==String(visualId))return;applyTheme(data.theme)});
window.prometheusVisual={id:visualId,getState:function(){return state},setState:function(next){state=next&&typeof next==='object'?next:{};restoreControls();if(window.openai)window.openai.widgetState=state;post('prometheus:visual-state',{state:state});send()},sendFollowUpMessage:function(input){post('prometheus:visual-followup',{prompt:String(input&&input.prompt||''),title:String(input&&input.title||'')})}};
window.openai=window.openai||{};window.openai.widgetState=state;window.openai.setWidgetState=function(next){window.prometheusVisual.setState(next)};window.openai.sendFollowUpMessage=function(input){window.prometheusVisual.sendFollowUpMessage(input);return Promise.resolve()};
restoreControls();document.addEventListener('input',captureControls,true);document.addEventListener('change',captureControls,true);document.addEventListener('toggle',captureControls,true);
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,o=String(r||"");return/<head\b[^>]*>/i.test(o)?o.replace(/<head\b[^>]*>/i,s=>`${s}${n}`):`${n}${o}`}function et(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let r=()=>{let t=ke();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(a=>{let e=String(a.getAttribute("data-visual-id")||"");if(!(!e||!a.contentWindow))try{a.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:e,theme:t},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(r,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(r,0)),window.addEventListener("message",t=>{let a=t?.data;if(!a||!String(a.type||"").startsWith("prometheus:visual-"))return;let e=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(o=>o.contentWindow===t.source);if(!e)return;let n=String(e.getAttribute("data-visual-id")||"");if(String(a.visualId||"")===n){if(a.type==="prometheus:visual-resize"){let o=Number(a.height);if(!Number.isFinite(o))return;let s=Math.min(1e4,Math.max(120,Math.ceil(o))),i=Math.ceil(e.getBoundingClientRect().height||0);if(Math.abs(i-s)<=1)return;e.style.height=`${s}px`,e.style.minHeight=`${s}px`;return}if(a.type==="prometheus:visual-state"&&a.state&&typeof a.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:n,state:a.state}}));return}a.type==="prometheus:visual-followup"&&a.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:n,prompt:String(a.prompt),title:String(a.title||"")}}))}})}function re(r){if(!r?.getAttribute)return"";let t=r.closest?.(".visual-block"),a=String(r.getAttribute("data-visual-id")||"").trim();return a?[a,String(r.getAttribute("data-visual-version")||"1"),String(t?.getAttribute("data-vis-lang")||""),String(t?.getAttribute("data-vis-code")||"")].join("\0"):""}function K(r){if(!r?.querySelector&&!r?.matches)return"";let t=r.matches?.('iframe[data-prom-visual="true"]')?r:r.querySelector?.('iframe[data-prom-visual="true"]');return re(t)}function tt(r,t){return!r||!t||r.nodeType!==t.nodeType?!1:r.nodeType!==1?!0:String(r.tagName||"").toLowerCase()===String(t.tagName||"").toLowerCase()}function rt(r,t){let e=r.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(r.attributes||[]).forEach(n=>{e.has(n.name)||t.hasAttribute(n.name)||r.removeAttribute(n.name)}),Array.from(t.attributes||[]).forEach(n=>{e.has(n.name)||r.getAttribute(n.name)!==n.value&&r.setAttribute(n.name,n.value)})}function q(r,t,a,e=null){let n=Array.from(t||[]),o=Array.from(a||[]),s=Math.min(n.length,o.length),i=0;for(let c=0;c<s;c+=1){let m=n[c],v=o[c],u=Ee(m,v);if(u){i+=u.reused;continue}let f=v.cloneNode(!0);r.replaceChild(f,m)}for(let c=s;c<o.length;c+=1)r.insertBefore(o[c].cloneNode(!0),e);for(let c=s;c<n.length;c+=1)n[c].remove();return i}function at(r,t){return r.length===t.length&&r.every((a,e)=>a===t[e])}function Me(r,t){let a=Array.from(r.childNodes||[]),e=Array.from(t.childNodes||[]),n=a.map(K).filter(Boolean),o=e.map(K).filter(Boolean);if(n.length&&at(n,o)){let s=0,i=0,c=0;for(let m of o){let v=a.findIndex((x,C)=>C>=s&&K(x)===m),u=e.findIndex((x,C)=>C>=i&&K(x)===m);if(v<0||u<0)return q(r,a,e);c+=q(r,a.slice(s,v),e.slice(i,u),a[v]);let f=Ee(a[v],e[u]);if(!f)return q(r,a,e);c+=f.reused,s=v+1,i=u+1}return c+=q(r,a.slice(s),e.slice(i)),c}return q(r,a,e)}function Ee(r,t){return tt(r,t)?r.nodeType===3||r.nodeType===8?(r.nodeValue!==t.nodeValue&&(r.nodeValue=t.nodeValue),{reused:0}):r.matches?.('iframe[data-prom-visual="true"]')?re(r)===re(t)?{reused:1}:null:(rt(r,t),{reused:Me(r,t)}):null}function Ae(r,t){return!r?.childNodes||!t?.childNodes?0:Me(r,t)}function nt(r,t){if(!r)return 0;let a=String(t||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof r.appendChild!="function")return r.innerHTML=a,0;let e=document.createElement("template");e.innerHTML=a;let n=!!r.querySelector?.('iframe[data-prom-visual="true"]'),o=!!e.content.querySelector?.('iframe[data-prom-visual="true"]');return!n&&!o?(r.innerHTML=a,0):Ae(r,e.content)}function ot(r,t,a=0){let e=`${r}\0${a}\0${t}`,n=2166136261;for(let o=0;o<e.length;o+=1)n^=e.charCodeAt(o),n=Math.imul(n,16777619);return`visual_local_${(n>>>0).toString(36)}`}function Te(r,t,a={}){et();let e=a.artifact&&typeof a.artifact=="object"?a.artifact:null,n=String(e?.id||a.visualId||ot(r,t,a.ordinal||0)),o=`vis_${n.replace(/[^a-z0-9_-]/gi,"_")}`,s=ke(),i=Ze(Ce(r,t,s),{visualId:n,state:e?.state||a.state||{}}),c=O(i),m=r.replace(/"/g,""),v=O(t),u=r==="chart"?240:r==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${o}-wrap" data-vis-lang="${m}" data-vis-code="${v}" data-vis-surface="inline">
  <iframe
    id="${o}"
    data-prom-visual="true"
    data-visual-id="${O(n)}"
    data-visual-version="${O(e?.version||1)}"
    srcdoc="${c}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${u}px;min-height:${u}px;border:none;display:block;background:transparent;color-scheme:${s.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function Ie(r){let t=String(r||""),a=typeof window<"u"?window.DOMPurify:null;return!a||typeof a.sanitize!="function"?L(t):a.sanitize(t,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function st(r){let t=String(r||"").trim();if(!t)return"";if(/^file:\/\//i.test(t))try{t=decodeURIComponent(t.replace(/^file:\/\/\/?/i,""))}catch{t=t.replace(/^file:\/\/\/?/i,"")}t=t.replace(/^\.\//,"");let a=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof a=="function")try{let e=a(t);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}function it(r){let t=String(r||"").trim();return!t||t.startsWith("#")?!1:/^file:\/\//i.test(t)||/^[a-z]:[\\/]/i.test(t)?!0:!(/^[a-z][a-z0-9+.-]*:/i.test(t)||t.startsWith("/")||t.startsWith("\\"))}var ct=/\.(mp4|webm|mov|m4v)(?:$|[?#])/i;function pt(r){let t=String(r||"");return t.includes("<img")?t.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/gi,(a,e,n,o)=>{let s=n.replace(/&amp;/g,"&");if(!it(s))return a;let i=st(s),c=`${e}${o}`,m=c.match(/\salt="([^"]*)"/i),v=m?m[1]:"",u=O(s),f=v?`<span class="prom-inline-caption">${v}</span>`:"";return ct.test(s)?`<span class="prom-inline-figure is-video"><video class="prom-inline-media" src="${O(i)}" controls playsinline preload="metadata" data-workspace-path="${u}"></video>${f}</span>`:`<span class="prom-inline-figure"><img${c.replace(/\s(?:loading|class)="[^"]*"/gi,"")} src="${O(i)}" class="prom-inline-media" loading="lazy" decoding="async" data-workspace-path="${u}" role="button" tabindex="0">${f}</span>`}):t}function dt({src:r,name:t}){document.getElementById("prom-inline-lightbox")?.remove();let a=document.createElement("div");a.id="prom-inline-lightbox",a.className="prom-inline-lightbox",a.setAttribute("role","dialog"),a.setAttribute("aria-modal","true");let e=document.createElement("img");e.src=r,e.alt=t||"";let n=document.createElement("button");n.type="button",n.className="prom-inline-lightbox-close",n.setAttribute("aria-label","Close"),n.textContent="\xD7",a.append(e,n);let o=()=>{a.remove(),document.removeEventListener("keydown",s)},s=i=>{i.key==="Escape"&&o()};a.addEventListener("click",i=>{i.target!==e&&o()}),document.addEventListener("keydown",s),document.body.appendChild(a)}if(typeof document<"u"&&!window.__promInlineMediaWired){window.__promInlineMediaWired=!0;let r=t=>{let a=t.target?.closest?.("img.prom-inline-media");if(!a||t.type==="keydown"&&t.key!=="Enter"&&t.key!==" ")return;t.preventDefault();let e=a.getAttribute("data-workspace-path")||"",n={kind:"image",src:a.currentSrc||a.src,path:e,name:a.getAttribute("alt")||e.split(/[\\/]/).pop()||"Image"},o=window.__promOpenInlineMedia;if(typeof o=="function")try{o(n);return}catch{}dt(n)};document.addEventListener("click",r),document.addEventListener("keydown",r)}var lt=600,ut=2e5,U=new Map;function ze(r,t={}){if(!r)return"";let a=String(r);if(a.length<=ut&&!/```(chart|svg|html|mermaid)\n/.test(a)&&!(Array.isArray(t.visualArtifacts)&&t.visualArtifacts.length)){let n=U.get(a);if(n!==void 0)return U.delete(a),U.set(a,n),n;let o=ye(a,t);return U.set(a,o),U.size>lt&&U.delete(U.keys().next().value),o}return ye(a,t)}var vt=/```video-project[ \t]*\n([\s\S]*?)```/g,mt=/```video-project[ \t]*\n[\s\S]*$/;function ht(r){let t="";try{t=String(JSON.parse(String(r||"").trim())?.projectId||"")}catch{t=(String(r||"").match(/vp_[A-Za-z0-9_-]+/)||[""])[0]}return/^vp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-vp-card" data-vp-project="${t}"></div>`:""}function ye(r,t={}){try{let a=[],e=`PROMVISUAL${Math.random().toString(36).slice(2)}X`,n=[],o=`PROMVPCARD${Math.random().toString(36).slice(2)}X`;r=String(r).replace(vt,(x,C)=>(n.push(ht(C)),`

${o}${n.length-1}END

`)).replace(mt,"");let s=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,i=0,c=Array.isArray(t.visualArtifacts)?t.visualArtifacts.filter(x=>x?.type==="visual"):[],m=String(r).replace(s,(x,C,R)=>{let j=a.length,D=C.toLowerCase(),J=c.find(H=>Number(H.ordinal)===i&&String(H.renderer||"")===D)||null;return a.push({lang:D,code:R.trim(),partial:!1,artifact:J,ordinal:i}),i+=1,`${e}${j}END`}),v=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,u=m.match(v);if(u){let x=a.length;a.push({lang:u[1].toLowerCase(),code:u[2],partial:!0}),m=m.slice(0,u.index)+`${e}${x}END`}let f=pt(Ie(marked.parse(m,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1})));if(a.length){let x=new RegExp(`${e}(\\d+)END`,"g");f=f.replace(x,(C,R)=>{let j=a[+R];return j?j.partial?"":Te(j.lang,j.code,{artifact:j.artifact,ordinal:j.ordinal}):""}),f=f.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}if(n.length){let x=new RegExp(`(?:<p>\\s*)?${o}(\\d+)END(?:\\s*<\\/p>)?`,"g");f=f.replace(x,(C,R)=>n[+R]||"")}return f}catch{return L(r)}}window.escHtml=L;window.escapeHtml=L;window.sanitizeHtml=Ie;window.renderMd=ze;xe();window.timeAgo=qe;window.fmtPercent=De;window.fmtMemoryGb=He;window.meterWidth=we;window.setText=Ye;window.setMeter=We;window.showToast=$e;window.bgtToast=Ge;window.showConfirm=Ke;window.log=Xe;window.buildVisualSrcdoc=Ce;window.buildVisualIframe=Te;window.preserveVisualIframes=Ae;window.setInnerHTMLPreservingVisuals=nt;window.renderMd=ze;export{L as a,wt as b,qe as c,De as d,He as e,we as f,Ye as g,$t as h,St as i,We as j,$e as k,Ge as l,Ke as m,Xe as n,Ce as o,Ae as p,nt as q,Te as r,Ie as s,st as t,ze as u};
