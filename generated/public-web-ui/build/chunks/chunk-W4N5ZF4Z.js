var N=a=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a}</svg>`,A={box:N('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),userPlus:N('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),grid:N('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),gauge:N('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),up:N('<path d="M18 15l-6-6-6 6"/>'),down:N('<path d="M6 9l6 6 6-6"/>'),minus:N('<path d="M5 12h14"/>'),plus:N('<path d="M12 5v14M5 12h14"/>'),mic:N('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),share:N('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),split:N('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),rocket:N('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),download:N('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),check:N('<path d="M5 12l5 5L20 7"/>'),x:N('<path d="M18 6L6 18M6 6l12 12"/>')},Xe={openai:["alloy","ash","coral","echo","fable","nova","onyx","sage","shimmer"],xai:["ara","rex","sal","eve","leo"]},Je=["bold","pop","minimal","karaoke"],Ze=["9:16","1:1","16:9"];function ge(a,t,r,e){let o="vpc-thumb";if(t?.poster)return`<img class="${o}" src="${e.esc(e.mediaUrl(t.poster))}" alt="" loading="lazy" decoding="async">`;if(t?.path&&e.isVideo(t.path))return`<video class="${o}" src="${e.esc(e.mediaUrl(t.path))}#t=0.1" muted playsinline preload="metadata"></video>`;if(t?.path)return e.thumb(t.path,o);if(a?.storyboard)return e.thumb(a.storyboard,o);let n=(a?.characterIds||[])[0],s=(r?.characters||[]).find(i=>i.id===n)||(r?.characters||[])[0];return e.thumb((s?.anchors||[])[0],o)}function he(a){return a?.kind==="product"?'<span class="vpc-pill is-product">Product</span>':""}var te=null;function fe(a){return te||(te=a.vpFetch("/action",{action:"models"}).then(t=>(t?.models||[]).filter(r=>!r.kind||r.kind==="video")).catch(()=>(te=null,[]))),te}function be(a,t,r,e,o){let n=o.esc(a.id),s=e.models||[],i=a.modelId||"",c=['<option value="">Default model</option>',...s.map(g=>`<option value="${o.esc(g.id)}"${g.id===i?" selected":""}>${o.esc(g.label||g.id)}${g.price!=null?` \xB7 ${o.esc(typeof g.price=="number"?o.usd(g.price):g.price)}`:""}</option>`)];return i&&!s.some(g=>g.id===i)&&c.push(`<option value="${o.esc(i)}" selected>${o.esc(i)}</option>`),`<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${n}">${o.esc(a.prompt||"")}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${n}" placeholder="Spoken line for this shot">${o.esc(a.line||"")}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${o.iconBtn("dur",A.minus,"Shorter",`data-s="${n}" data-d="-1" ${Number(a.durationSec)<=1?"disabled":""}`)}
        <span>${Number(a.durationSec)||0}s</span>
        ${o.iconBtn("dur",A.plus,"Longer",`data-s="${n}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${n}" aria-label="Model">${c.join("")}</select>
      <span class="vpc-grow"></span>
      ${o.iconBtn("move",A.up,"Move up",`data-s="${n}" data-i="${t-1}" ${t===0?"disabled":""}`)}
      ${o.iconBtn("move",A.down,"Move down",`data-s="${n}" data-i="${t+1}" ${t>=r-1?"disabled":""}`)}
      ${(a.takes||[]).length>=2?o.iconBtn("variants",A.split,"Render hook variants (one export per take)",`data-s="${n}"`):""}
    </div>
    ${a.voiceover?.path?`<audio class="vpc-audio" src="${o.esc(o.mediaUrl(a.voiceover.path))}" controls preload="none"></audio>`:""}
  </div>`}function xe(a,t){let r=a?.qa;if(!r||r.score==null)return"";let e=Number(r.score),o=e>=7?"good":e>=5?"warn":"bad",n=[`QA ${e}/10${r.verdict?` \xB7 ${r.verdict}`:""}${r.model?` \xB7 ${r.model}`:""}`,...r.issues||[]].join(`
`);return`<span class="vpc-qa is-${o}" title="${t.esc(n)}" aria-label="${t.esc(n)}">${e}</span>`}function ye(a,t){let r=a.shots||[];if(!r.some(n=>n.storyboard||(n.storyboardCandidates||[]).length))return"";let e=r.some(n=>!n.storyboard&&(n.storyboardCandidates||[]).length);return`<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${r.map((n,s)=>{let i=t.esc(n.id),c=(n.storyboardCandidates||[]).find(b=>b!==n.storyboard),g=n.storyboard||c;if(!g)return`<div class="vpc-sb is-empty"><span class="vpc-sb-n">${s+1}</span></div>`;let m=!n.storyboard&&c?`<div class="vpc-tile-actions">
        ${t.iconBtn("sb-approve",A.check,"Approve storyboard",`data-s="${i}" data-path="${t.esc(c)}"`,"is-go")}
        ${t.iconBtn("sb-reject",A.x,"Reject storyboard",`data-s="${i}" data-path="${t.esc(c)}"`)}
      </div>`:`<span class="vpc-badge">${A.check}</span>`;return`<div class="vpc-sb${n.storyboard?" is-approved":""}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${t.esc(g)}" aria-label="View storyboard ${s+1}">${t.thumb(g,"vpc-tile-img")}</button>
      <span class="vpc-sb-n">${s+1}</span>${m}</div>`}).join("")}</div>
    ${e?`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${A.check}<span>Approve all</span></button>`:""}
  </section>`}function we(a,t,r){if(!(a.shots||[]).length)return"";let e=a.voice||{},o=e.provider||"openai",n=Object.entries(Xe).map(([v,S])=>`<optgroup label="${v==="xai"?"xAI":"OpenAI"}">${S.map(p=>`<option value="${v}:${p}"${v===o&&p===e.voice?" selected":""}>${p}</option>`).join("")}</optgroup>`).join(""),s=a.captions||{},i=a.music||null,c=i?/chill/i.test(i.label||i.path||"")?"chill":/pulse/i.test(i.label||i.path||"")?"pulse":"custom":"none",g=(a.shots||[]).some(v=>v.line),m=Math.round((i?.volume??.3)*100),b=(a.audioMode||"voiceover")==="native";return`<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    ${`<div class="vpc-row vpc-wrap" role="radiogroup" aria-label="Who speaks the lines">
      <span class="vpc-muted">Speech</span>
      ${[["native","On camera","The creator speaks each line in the clip; captions transcribe the clip audio"],["voiceover","Narrator","TTS voiceover over dialogue-free clips; captions follow the voiceover"]].map(([v,S,p])=>`<button type="button" class="vpc-chip${(b?"native":"voiceover")===v?" is-on":""}" data-vpa="audio-mode" data-v="${v}" role="radio" aria-checked="${(b?"native":"voiceover")===v}" title="${p}">${S}</button>`).join("")}
    </div>`}
    ${b?`<div class="vpc-row vpc-wrap"><button type="button" class="vpc-btn" data-vpa="transcribe" title="Re-read what each clip says for captions">${A.mic}<span>Transcribe clips</span></button></div>`:`<div class="vpc-row vpc-wrap">
      ${A.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${e.voice?"":'<option value="" selected>Pick a voice</option>'}${n}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${g?"":'disabled title="Add voiceover lines to shots first"'}>${A.mic}<span>Voiceover</span></button>
    </div>`}
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${s.enabled?" checked":""}><span>Captions</span></label>
      ${Je.map(v=>`<button type="button" class="vpc-chip${(s.style||"bold")===v&&s.enabled?" is-on":""}" data-vpa="cap-style" data-v="${v}" aria-pressed="${(s.style||"bold")===v&&!!s.enabled}">${v}</button>`).join("")}
      ${s.cues?.length?`<span class="vpc-muted">${s.cues.length} cues</span>`:""}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[["pulse","Pulse"],["chill","Chill"],["none","None"]].map(([v,S])=>`<button type="button" class="vpc-chip${c===v?" is-on":""}" data-vpa="music" data-v="${v}" aria-pressed="${c===v}">${S}</button>`).join("")}
      ${c==="custom"?`<span class="vpc-chip is-on">${r.esc(i.label||"Custom")}</span>`:""}
      ${i?`<input class="vpc-range" type="range" min="0" max="100" value="${m}" data-vpf="volume" aria-label="Music volume" title="Music volume ${m}%">`:""}
    </div>
  </section>`}function $e(a,t,r){let e=[],o=a.lastRun;o?.steps?.length&&e.push(`<ol class="vpc-steps">${o.steps.map(s=>`<li class="is-${r.esc(s.state)}" title="${r.esc(s.note||s.state)}"><span class="vpc-dot"></span>${r.esc(s.step)}${s.note?` <small class="vpc-muted">${r.esc(String(s.note).slice(0,80))}</small>`:""}</li>`).join("")}</ol>`);let n=t.actPending||(o?.needsApproval?{action:"run",args:{},usd:o.needsApproval.usd,breakdown:o.needsApproval.breakdown}:null);if(n){let s=(n.breakdown||[]).map(i=>`<li>${r.esc(i.item)} \xB7 ${r.usd(i.usd)}</li>`).join("");e.push(`<div class="vpc-approve">
      <strong>${n.action==="storyboard"?"Storyboard":n.action==="run"?"Autopilot":r.esc(n.action)} needs approval \xB7 ${r.usd(n.usd)}</strong>
      ${s?`<ul>${s}</ul>`:""}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${A.check}<span>Approve ${r.usd(n.usd)}</span></button>
        ${r.iconBtn("act-cancel",A.x,"Cancel")}
      </div></div>`)}return(a.shots||[]).length&&e.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${t.busy?"disabled":""}>${A.rocket}<span>Run all</span></button>`),e.length?`<section class="vpc-sec"><h4>Autopilot</h4>${e.join("")}</section>`:""}function Se(a,t,r){let e=(a.exports||[]).slice().reverse(),o=Ze.map(s=>`<button type="button" class="vpc-chip${t.aspects.has(s)?" is-on":""}" data-vpa="aspect" data-v="${s}" aria-pressed="${t.aspects.has(s)}">${s}</button>`).join(""),n=e.slice(0,6).map(s=>{let i=r.mediaUrl(s.path),c=[s.aspect,s.variant?`variant ${s.variant}`:"",`${Number(s.durationSec||0).toFixed(1)}s`].filter(Boolean).join(" \xB7 ");return`<div class="vpc-export">
      <video src="${r.esc(i)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${r.esc(c)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${r.esc(i)}" download="${r.esc(String(s.path).split("/").pop())}" title="Download" aria-label="Download">${A.download}</a>
        ${r.iconBtn("share",A.share,"Share",`data-path="${r.esc(s.path)}"`)}
      </div></div>`}).join("");return`<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${o}</div>
    ${n?`<div class="vpc-exports">${n}</div>`:""}</section>`}function Qe(){return new Promise(a=>{let t=document.createElement("input");t.type="file",t.accept="image/*",t.style.display="none",t.addEventListener("change",()=>{let r=t.files&&t.files[0];if(t.remove(),!r)return a(null);let e=new FileReader;e.onload=()=>a({filename:r.name,dataBase64:String(e.result||"").replace(/^data:[^,]*,/,"")}),e.onerror=()=>a(null),e.readAsDataURL(r)}),document.body.appendChild(t),t.click()})}async function et(a,t){let r=t.mediaUrl(a);try{r=new URL(r,location.href).href}catch{}if(navigator.share)try{return await navigator.share({title:"Video",url:r}),"Shared"}catch{return""}try{return await navigator.clipboard.writeText(r),"Link copied"}catch{return"Copy failed"}}async function ke(a,t){let{st:r,d:e,act:o,ops:n,paint:s,h:i}=t,c=r.project||{},g=m=>(c.shots||[]).find(b=>b.id===m);switch(a){case"upload-product":case"upload-character":{let m=await Qe();return m&&await o("import_asset",{...m,role:a==="upload-product"?"product":"character",name:m.filename.replace(/\.[^.]+$/,"")},"Uploading"),!0}case"storyboard":return await o("storyboard",{},"Storyboarding"),!0;case"sb-approve":return await n([{op:"shot.approveStoryboard",id:e.s,path:e.path}],"Approving storyboard"),!0;case"sb-reject":return await n([{op:"shot.rejectStoryboard",id:e.s,path:e.path}],"Rejecting"),!0;case"sb-approve-all":{let m=(c.shots||[]).filter(b=>!b.storyboard&&(b.storyboardCandidates||[]).length).map(b=>({op:"shot.approveStoryboard",id:b.id,path:b.storyboardCandidates[0]}));return m.length&&await n(m,"Approving storyboard"),!0}case"dur":{let m=g(e.s);if(!m)return!0;let b=Math.max(1,Math.min(30,(Number(m.durationSec)||5)+Number(e.d)));return await n([{op:"shot.update",id:e.s,durationSec:b}],"Saving"),!0}case"move":return await n([{op:"shot.move",id:e.s,index:Number(e.i)}],"Reordering"),!0;case"variants":return await o("render_variants",{shotId:e.s},"Rendering hook variants",900*1e3),!0;case"qa":return await o("qa",{},"Scoring takes",300*1e3),!0;case"voiceover":return await o("voiceover",{},"Recording voiceover",300*1e3),!0;case"audio-mode":return await n([{op:"project.update",audioMode:e.v}],e.v==="native"?"Using on-camera dialogue":"Using a narrator"),!0;case"transcribe":return await o("transcribe",{force:!0},"Transcribing clips",3e5)&&c.captions?.enabled&&await o("captions",{style:c.captions.style},"Rebuilding captions"),!0;case"cap-style":{let m=e.v;return await o("captions",{style:m},"Building captions")&&await n([{op:"captions.set",enabled:!0,style:m}],"Saving captions"),!0}case"music":return e.v==="none"?await n([{op:"music.clear"}],"Removing music"):await o("music",{builtin:e.v},"Adding music"),!0;case"run-all":return await o("run",{},"Running autopilot",1800*1e3),!0;case"act-approve":{let m=r.actPending||(c.lastRun?.needsApproval?{action:"run",args:{}}:null);return r.actPending=null,m&&await o(m.action,{...m.args||{},approved:!0},"Submitting",1800*1e3),!0}case"act-cancel":return r.actPending=null,c.lastRun&&(c.lastRun.needsApproval=void 0),s(),!0;case"aspect":return r.aspects.has(e.v)?r.aspects.delete(e.v):r.aspects.add(e.v),s(),!0;case"share":{let m=await et(e.path,i);return m&&(r.error="",r.busy="",r.toast=m,s()),!0}default:return!1}}async function Me(a,t){let{d:r,ops:e,value:o,checked:n,st:s}=t;switch(a){case"prompt":case"line":case"modelId":{let i=(s.project?.shots||[]).find(c=>c.id===r.s);if(i&&String(i[a]||"")===o)return;await e([{op:"shot.update",id:r.s,[a]:o}],"Saving");return}case"voice":{let[i,c]=String(o).split(":");c&&await e([{op:"voice.set",provider:i,voice:c}],"Setting voice");return}case"captions":{let i=s.project?.captions?.style||"bold";n&&!(s.project?.captions?.cues||[]).length&&await t.act("captions",{style:i},"Building captions"),await e([{op:"captions.set",enabled:!!n,style:i}],"Saving captions");return}case"volume":{let i=s.project?.music;i?.path&&await e([{op:"music.set",path:i.path,volume:Number(o)/100,duck:i.duck!==!1}],"Saving");return}default:}}var Ce=`
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
`;var Ee="prom-vp-card-style",tt=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",Ae=new Map,P=(a,t="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${t}>${a}</svg>`,T={film:P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:P('<path d="M5 12l5 5L20 7"/>'),x:P('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:P('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:P('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:P('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:P('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:P('<path d="M7 4v16l13-8z"/>'),seq:P('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:P('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:P('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:P('<path d="M6 9l6 6 6-6"/>'),user:P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:P('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:P('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function y(a){return String(a??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function Y(a){return`$${(Number(a)||0).toFixed(2)}`}function re(a){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(a||""))}function ie(a){return String(a||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function J(a){let t=String(a||"").trim();if(!t)return"";if(/^(https?:|data:|blob:)/i.test(t))return t;let r=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof r=="function")try{let e=r(t);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}async function W(a,t,r=2e4){let e={method:t===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:t===void 0?void 0:JSON.stringify(t),timeoutMs:r},o=`/api/video-projects${a}`,n=window.__promVideoProjectFetch||window.api,s;if(typeof n=="function")s=await n(o,e);else{let i=await fetch(o,e);s=await i.json().catch(()=>({success:!1,error:`HTTP ${i.status}`}))}if(s&&s.success===!1)throw new Error(s.error||"Request failed");return s||{}}function Te(a){let t=a?.takes||[];return t.length?t.find(r=>r.id===a.selectedTakeId)||t[t.length-1]:null}function ce(a,t="vpc-thumb"){if(!a)return`<span class="${t} is-empty">${T.film}</span>`;let r=y(J(a));return re(a)?`<video class="${t}" src="${r}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${t}" src="${r}" alt="" loading="lazy" decoding="async">`}function q(a,t,r,e="",o=""){return`<button type="button" class="vpc-icon${o?` ${o}`:""}" data-vpa="${a}" title="${y(r)}" aria-label="${y(r)}" ${e}>${t}</button>`}function rt(a){a.dataset.vpMounted="1";let t=String(a.dataset.vpProject||""),r=Ae.get(t),e={project:r?.project||null,history:r?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1,actPending:null,models:[],aspects:new Set,toast:""},o={esc:y,usd:Y,isVideo:re,mediaUrl:J,thumb:ce,iconBtn:q,vpFetch:W},n=null,s=()=>a.isConnected;function i(l){l?.project&&(e.project=l.project),l?.history&&(e.history=l.history),e.project&&Ae.set(t,{project:e.project,history:e.history,at:Date.now()})}async function c(){if(s()){try{i(await W(`/${encodeURIComponent(t)}`)),e.error=""}catch(l){e.error=String(l?.message||l)}await w(),_(),m()}}function g(){return(e.project?.jobs||[]).filter(l=>l.state==="queued"||l.state==="running")}function m(){clearTimeout(n),s()&&(g().length||e.rendering)&&(n=setTimeout(c,3500))}function b(){let l=new Set(g().map(d=>d.target?.shotId).filter(Boolean));return(e.project?.shots||[]).filter(d=>!(d.takes||[]).length&&!l.has(d.id))}async function w(){let l=b(),d=l.map(x=>`${x.id}:${x.modelId||""}:${x.durationSec}:${(x.characterIds||[]).join(",")}`).join("|")+`#${(e.project?.characters||[]).map(x=>(x.anchors||[]).length).join(",")}`;if(!l.length){e.estimate=null,e.estimateKey="";return}if(!(d===e.estimateKey&&e.estimate))try{e.estimate=await W(`/${encodeURIComponent(t)}/estimate`,{shotIds:l.map(x=>x.id)}),e.estimateKey=d}catch(x){e.estimate=null,e.error=String(x?.message||x)}}async function v(l,d){e.busy=l,e.error="",_();try{let x=await d();return i(x),x}catch(x){return e.error=String(x?.message||x),null}finally{e.busy="",_()}}async function S(l,d){await v(d,()=>W(`/${encodeURIComponent(t)}/ops`,{ops:l})),await c()}async function p(l,d={},x="Working",M=12e4){let u=await v(x,()=>W(`/${encodeURIComponent(t)}/action`,{action:l,...d},M));if(!u)return null;let U=u.needsApproval;if(U){let V=u.lastRun?.needsApproval;e.actPending={action:l,args:d,usd:Number(V?.usd??U?.usd??u.estimateUsd??u.totalUsd??u.estimate?.total??0),breakdown:V?.breakdown||U?.breakdown||u.breakdown||[]}}else e.actPending=null;return e.estimateKey="",await c(),u}async function h(l,d,x){let M=await v(x,()=>W(`/${encodeURIComponent(t)}${l}`,d,12e4));if(M){if(M.needsApproval){e.pending={path:l,body:{...d,approved:!0},label:x,reason:M.reason,estimate:M.estimate},_();return}e.pending=null,e.estimateKey="",await c()}}async function f(){let l=e.project;if(!l)return;let d=(l.clips||[]).some(x=>x.source&&"shotId"in x.source);if(e.rendering=!0,e.aspects.size){await p("render",{aspects:[...e.aspects]},"Rendering",900*1e3),e.rendering=!1,await c();return}if(!d&&!await v("Assembling",()=>W(`/${encodeURIComponent(t)}/ops`,{ops:[{op:"timeline.assemble"}]}))){e.rendering=!1,_();return}await v("Rendering",()=>W(`/${encodeURIComponent(t)}/render`,{},900*1e3)),e.rendering=!1,await c()}function k(l,d){let x=J(l);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:x,path:l,name:d||l.split("/").pop(),kind:re(l)?"video":"image"});return}catch{}window.open(x,"_blank","noopener")}function j(l){let d=`${q("upload-product",A.box,"Upload product photo")}${q("upload-character",A.userPlus,"Upload character photo")}`;if(!(l.characters||[]).length)return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${d}</h4></section>`;let x=g().filter(u=>u.target?.characterId),M=l.characters.map(u=>{let U=x.some(L=>L.target.characterId===u.id),V=(u.anchors||[])[0],G=u.candidates||[],D=V?"Anchor approved":G.length?"Pick an anchor":U?"Generating anchor":"No anchor yet",I=[V?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${y(V)}" aria-label="View anchor">${ce(V,"vpc-tile-img")}</button><span class="vpc-badge">${T.check}</span></div>`:"",...G.map(L=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${y(L)}" aria-label="View candidate">${ce(L,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${q("approve-anchor",T.check,"Approve as anchor",`data-c="${y(u.id)}" data-path="${y(L)}"`,"is-go")}
            ${q("reject-anchor",T.x,"Reject",`data-c="${y(u.id)}" data-path="${y(L)}"`)}
          </div>
        </div>`),U?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${T.user}<strong>${y(u.name)}</strong>${he(u)}</span>
          <span class="vpc-muted">${y(D)}</span>
          <span class="vpc-grow"></span>
          ${u.anchorPrompt?q("reroll",T.reroll,"Generate another anchor",`data-c="${y(u.id)}"`):""}
        </div>
        ${I?`<div class="vpc-strip">${I}</div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${d}</h4>${M}</section>`}function z(l){let d=l.shots||[];if(!d.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let x=new Set(g().map(u=>u.target?.shotId).filter(Boolean)),M=d.map((u,U)=>{let V=Te(u),G=x.has(u.id),D=e.openShot===u.id,I=(u.takes||[]).length,L=D?(u.takes||[]).slice().reverse().map(R=>`
        <div class="vpc-take${R.id===V?.id?" is-selected":""}">
          ${re(R.path)?`<video src="${y(J(R.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${y(J(R.path))}" alt="" loading="lazy">`}
          <div class="vpc-row">
            ${xe(R,o)}<span class="vpc-muted">${y(ie(R.modelId))} \xB7 ${Y(R.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${R.id===V?.id?`<span class="vpc-inuse">${T.check}In cut</span>`:q("use-take",T.check,"Use this take",`data-s="${y(u.id)}" data-t="${y(R.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${D?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${y(u.id)}" aria-expanded="${D}">
          ${G&&!V?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':ge(u,V,l,o)}
          <span class="vpc-shot-meta">
            <strong>${U+1}. ${y(u.title||"Shot")}</strong>
            <small>${y(String(u.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${G?"generating":y(u.status)}">${G?"generating":y(u.status)} \xB7 ${u.durationSec}s \xB7 ${I} take${I===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${T.chevron}</span>
        </button>
        ${D?`<div class="vpc-shot-body">
          ${be(u,U,d.length,e,o)}
          ${u.camera?`<p class="vpc-muted">Camera: ${y(u.camera)}</p>`:""}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${y(u.id)}" data-n="1" ${G?"disabled":""}>${T.reroll}<span>${I?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${y(u.id)}" data-n="3" ${G?"disabled":""}>${T.layers}<span>3 variations</span></button>
          </div>
          ${L?`<div class="vpc-takes">${L}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${d.length}</span></h4>${M}</section>`}function Q(l){let d=[];if(e.pending){let I=(e.pending.estimate?.shots||[]).map(L=>`<li>${y(L.title||"Item")}: ${L.count}\xD7 ${y(ie(L.modelId))} \xB7 ${Y(L.usd)}</li>`).join("");d.push(`<div class="vpc-approve">
        <strong>Approve ${Y(e.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${y(e.pending.reason||"")}</p>
        ${I?`<ul>${I}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${T.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${T.x}<span>Cancel</span></button>
        </div>
      </div>`)}let x=b(),M=e.estimate;if(!e.pending&&x.length&&M){let I=(M.shots||[]).flatMap(R=>(R.problems||[]).map(Ke=>`${R.title}: ${Ke}`)),L=(l.characters||[]).some(R=>!(R.anchors||[]).length&&(R.candidates||[]).length);d.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${x.length} shot${x.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${Y(M.total)}</strong></div>
        ${L?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${I.length?`<ul class="vpc-warn">${I.map(R=>`<li>${y(R)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${L?"disabled":""}>${T.spark}<span>${M.total>(l.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${Y(M.total)}</span></button>
      </div>`)}let u=g();u.length&&d.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${u.length} job${u.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let U=(l.jobs||[]).filter(I=>I.state==="failed").slice(-2);U.length&&!u.length&&d.push(`<ul class="vpc-warn">${U.map(I=>`<li>${y(ie(I.modelId))} failed: ${y(String(I.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let V=l.shots||[],G=V.length&&V.every(I=>Te(I)),D=(l.exports||[]).slice(-1)[0];return(G||D)&&d.push(`<div class="vpc-final">
        ${D?`<video src="${y(J(D.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(D.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${q("view",T.download,"Open video",`data-path="${y(D.path)}"`)}</div>`:""}
        ${G?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${e.rendering||u.length?"disabled":""}>${e.rendering?'<span class="vpc-spin"></span>':T.play}<span>${D?"Re-render":"Render video"}</span></button>
          ${q("assemble",T.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),d.length?`<section class="vpc-sec vpc-actions">${d.join("")}</section>`:""}function _(){if(!s())return;let l=document.activeElement;if(l&&a.contains(l)&&l.matches?.("textarea[data-vpf]")&&!e.busy)return;let d=e.project;if(!d){a.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${T.film}Video project</span></div>
        <p class="vpc-muted">${e.error?y(e.error):"Loading\u2026"}</p></div>`;return}let x=d.budget||{};a.innerHTML=`<div class="vpc">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${T.film}Video project \xB7 ${y(d.target?.aspect||"")}</span>
          <strong class="vpc-title">${y(d.title||d.id)}</strong>
          <span class="vpc-muted">${Y(x.spentUsd)} spent${x.capUsd!=null?` of ${Y(x.capUsd)}`:""} \xB7 auto-approve under ${Y(x.autoApproveUsd??1)}</span>
        </div>
        <div class="vpc-tools">
          ${q("undo",T.undo,"Undo",e.history?.undo?"":"disabled")}
          ${q("redo",T.redo,"Redo",e.history?.redo?"":"disabled")}
          ${q("storyboard",A.grid,"Generate storyboard")}
          ${q("qa",A.gauge,"QA: score selected takes")}
          ${q("refresh",T.refresh,"Refresh")}
        </div>
      </div>
      ${e.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${y(e.busy)}\u2026</div>`:""}
      ${e.error?`<p class="vpc-err">${y(e.error)}</p>`:""}
      ${e.toast?`<div class="vpc-toast">${y(e.toast)}</div>`:""}
      ${j(d)}
      ${ye(d,o)}
      ${z(d)}
      ${we(d,e,o)}
      ${Q(d)}
      ${$e(d,e,o)}
      ${Se(d,e,o)}
    </div>`}a.addEventListener("click",async l=>{let d=l.target.closest("[data-vpa]");if(!d||!a.contains(d)||d.disabled||(l.preventDefault(),l.stopPropagation(),e.busy&&d.dataset.vpa!=="toggle"&&d.dataset.vpa!=="view"))return;let x=d.dataset.vpa,M=d.dataset;switch(x){case"toggle":e.openShot=e.openShot===M.s?"":M.s,_(),e.openShot&&!e.models.length&&fe(o).then(u=>{e.models=u,u.length&&_()});return;case"view":M.path&&k(M.path);return;case"refresh":e.estimateKey="",await c();return;case"undo":case"redo":await v(x==="undo"?"Undoing":"Redoing",()=>W(`/${encodeURIComponent(t)}/${x}`,{})),e.estimateKey="",await c();return;case"approve-anchor":await S([{op:"character.approveAnchor",id:M.c,path:M.path}],"Approving anchor");return;case"reject-anchor":await S([{op:"character.rejectAnchor",id:M.c,path:M.path}],"Removing");return;case"reroll":await h(`/characters/${encodeURIComponent(M.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await S([{op:"take.select",shotId:M.s,takeId:M.t}],"Swapping take");return;case"redo-shot":await h("/generate",{shotIds:[M.s],count:Number(M.n)||1},"Estimating");return;case"gen-all":{let u=b().map(U=>U.id);if(!u.length)return;await h("/generate",{shotIds:u,count:1,approved:!0},"Submitting");return}case"approve-pending":{let u=e.pending;if(!u)return;e.pending=null,await h(u.path,u.body,"Submitting");return}case"cancel-pending":e.pending=null,_();return;case"assemble":await S([{op:"timeline.assemble"}],"Assembling");return;case"render":await f();return;default:e.toast="",await ke(x,{st:e,d:M,act:p,ops:S,paint:_,h:o})}}),a.addEventListener("change",async l=>{let d=l.target.closest?.("[data-vpf]");!d||!a.contains(d)||e.busy||await Me(d.dataset.vpf,{st:e,d:d.dataset,ops:S,act:p,value:d.value,checked:d.checked})}),a.addEventListener("click",l=>{l.target.closest?.("[data-vpf]")&&l.stopPropagation()}),_(),r&&Date.now()-r.at<3e3?w().then(()=>{_(),m()}):c()}var pe=null,de=!1;function je(a=document){de=!1,a.querySelectorAll?.(tt).forEach(t=>{try{rt(t)}catch(r){console.warn("[video-project-card] mount failed",r)}})}function Ie(){if(!(typeof document>"u")){if(!document.getElementById(Ee)){let a=document.createElement("style");a.id=Ee,a.textContent=at+Ce,document.head.appendChild(a)}je(),!pe&&(pe=new MutationObserver(()=>{de||(de=!0,requestAnimationFrame(()=>je()))}),pe.observe(document.documentElement,{childList:!0,subtree:!0}))}}var at=`
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
`;var ze="prom-gp-card-style",ot=".prom-gp-card[data-gp-project]:not([data-gp-mounted])",Z=["design","art","audio","code","playable","published"],O=a=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a}</svg>`,E={pad:O('<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 11h.01M18 13h.01"/>'),check:O('<path d="M5 12l5 5L20 7"/>'),x:O('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:O('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:O('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),play:O('<path d="M7 4v16l13-8z"/>'),stop:O('<rect x="6" y="6" width="12" height="12" rx="2"/>'),ext:O('<path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5"/>'),copy:O('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),refresh:O('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),music:O('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),wand:O('<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>'),code:O('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),rocket:O('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>'),phone:O('<rect x="7" y="2" width="10" height="20" rx="2"/>')};function $(a){return String(a??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function ae(a){return`$${(Number(a)||0).toFixed(2)}`}function _e(a,t,r){let e=String(t||"").trim();if(!e)return"";let o=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof o=="function")try{let n=o(e);if(n)return String(n)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(e)}${r?`&v=${r}`:""}`}function le(a){return`${typeof window<"u"&&typeof window.__promGatewayBase=="string"?window.__promGatewayBase.replace(/\/$/,""):""}/api/game-projects/${encodeURIComponent(a)}/play/`}async function Le(a,t,r=3e4){let e={method:t===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:t===void 0?void 0:JSON.stringify(t),timeoutMs:r},o=`/api/game-projects${a}`,n=window.__promVideoProjectFetch||window.api,s;if(typeof n=="function")s=await n(o,e);else{let i=await fetch(o,e);s=await i.json().catch(()=>({success:!1,error:`HTTP ${i.status}`}))}if(s&&s.success===!1)throw new Error(s.error||"Request failed");return s}function B(a,t,r,e="",o=""){return`<button type="button" class="gpc-icon${o?` ${o}`:""}" data-gpa="${a}" title="${$(r)}" aria-label="${$(r)}" ${e}>${t}</button>`}function nt(a){a.dataset.gpMounted="1";let t=String(a.dataset.gpProject||""),r={project:null,error:"",busy:"",pending:null,timer:0,playing:null,portrait:!1,showPlay:!0},e=p=>p.kind!=="sfx"&&p.kind!=="music",o=()=>(r.project?.assets||[]).some(p=>p.status==="generating");async function n(){try{let p=await Le(`/${encodeURIComponent(t)}`);r.project=p.project,r.error=""}catch(p){r.error=String(p?.message||p)}v(),s()}function s(){clearTimeout(r.timer),a.isConnected&&(o()||r.busy)&&(r.timer=setTimeout(n,3e3))}async function i(p,h={}){r.busy=p,r.error="",v();try{let f=await Le(`/${encodeURIComponent(t)}/action`,{action:p,...h});f.needsApproval||f.blocked?r.pending={action:p,args:h,usd:f.usd,reason:f.reason,blocked:!!f.blocked,estimate:f.estimate}:r.pending=null,p==="publish"&&f.note&&(r.error=f.note)}catch(f){r.error=String(f?.message||f)}r.busy="",await n()}function c(p){let h=Z.indexOf(p.stage);return`<ol class="gpc-steps">${Z.map((f,k)=>`<li class="${k<h?"is-done":k===h?"is-cur":""}"><span class="gpc-dot"></span><span class="gpc-step-l">${f}</span></li>`).join("")}</ol>`}function g(p){let h=p.design||{},f=[["Setting",h.setting],["Controls",h.controls],["Core loop",h.coreLoop],["Win/lose",h.winLose],["Engine",h.engine]].filter(([,z])=>z).map(([z,Q])=>`<div class="gpc-kv"><span>${$(z)}</span><span>${$(Q)}</span></div>`).join(""),k=(p.questions||[]).filter(z=>z.answer),j=(p.questions||[]).filter(z=>!z.answer).length;return`<div class="gpc-sec"><h4>${E.wand} Design</h4>${p.pitch?`<p class="gpc-pitch">${$(p.pitch)}</p>`:""}${f}
      ${k.length?`<div class="gpc-answers">${k.map(z=>`<span class="gpc-chip" title="${$(z.q)}">${$(z.answer)}</span>`).join("")}</div>`:""}
      ${j?`<div class="gpc-muted">${j} design question${j>1?"s":""} still open</div>`:""}</div>`}function m(p){let h=(p.assets||[]).filter(e);if(!h.length)return`<div class="gpc-sec"><h4>${E.spark} Art</h4><div class="gpc-row"><span class="gpc-muted gpc-grow">No asset plan yet.</span>${B("plan",E.wand,"Plan assets for this genre",r.busy?"disabled":"","is-go")}</div></div>`;let f=h.filter(C=>["planned","rejected","failed"].includes(C.status)).length,k=h.map(C=>{let l=C.path?`<img src="${$(_e(t,C.path,p.version))}" alt="${$(C.name)}" loading="lazy" class="${C.transparent?"is-alpha":""}">`:`<span class="gpc-ph">${C.status==="generating"?'<span class="gpc-spin"></span>':E.spark}</span>`,d=C.path&&C.status!=="generating";return`<div class="gpc-tile is-${$(C.status)}" title="${$(C.prompt)}">
        <div class="gpc-img">${l}</div>
        <div class="gpc-tile-foot"><span class="gpc-tname">${$(C.name)}</span><span class="gpc-badge">${$(C.status)}</span></div>
        <div class="gpc-tile-acts">
          ${B("approve",E.check,`Approve ${C.name}`,`data-asset="${$(C.id)}" ${d&&C.status!=="approved"?"":"disabled"}`,"is-go")}
          ${B("reject",E.x,`Reject ${C.name}`,`data-asset="${$(C.id)}" ${C.status==="generating"||C.status==="rejected"?"disabled":""}`)}
          ${B("reroll",E.reroll,`Reroll ${C.name} (paid)`,`data-asset="${$(C.id)}" ${C.status==="generating"?"disabled":""}`)}
        </div></div>`}).join(""),j=p.budget?.spentUsd||0,z=p.budget?.capUsd,Q=z?Math.min(100,j/z*100):0,_=r.pending;return`<div class="gpc-sec"><h4>${E.spark} Art <span class="gpc-muted">${h.filter(C=>C.status==="approved").length}/${h.length} approved</span></h4>
      <div class="gpc-grid">${k}</div>
      <div class="gpc-cost">
        <div class="gpc-row"><span class="gpc-grow gpc-muted">Spent ${ae(j)}${z?` of ${ae(z)} cap`:""} \xB7 auto-approve ${ae(p.budget?.autoApproveUsd)}</span>
        ${f?B("generate",E.spark,`Generate ${f} asset(s)`,r.busy||o()?"disabled":"","is-go"):""}</div>
        ${z?`<div class="gpc-bar"><span style="width:${Q.toFixed(1)}%"></span></div>`:""}
        ${_?`<div class="gpc-approve ${_.blocked?"is-blocked":""}"><span class="gpc-grow">${$(_.reason||"")}</span>
          ${_.blocked?"":`<button type="button" class="gpc-go" data-gpa="approve-cost">${E.check}<span>Approve &amp; generate ${ae(_.usd)}</span></button>`}
          ${B("dismiss",E.x,"Dismiss")}</div>`:""}
      </div></div>`}function b(p){let f=(p.assets||[]).filter(k=>!e(k)).map(k=>`<div class="gpc-aud">${B(r.playing===k.id?"stop":"listen",r.playing===k.id?E.stop:E.play,`${r.playing===k.id?"Stop":"Play"} ${k.name}`,`data-asset="${$(k.id)}" data-src="${$(_e(t,k.path,p.version))}"`)}<span class="gpc-grow">${$(k.name)}</span><span class="gpc-muted">${k.durationSec?`${Number(k.durationSec).toFixed(1)}s`:""}</span></div>`).join("");return`<div class="gpc-sec"><h4>${E.music} Audio</h4>${f||'<div class="gpc-muted">No audio yet (free, generated locally).</div>'}
      <div class="gpc-row gpc-mt">${B("sfx",E.spark,"Generate sound effects (free)",r.busy?"disabled":"")}${B("music",E.music,"Generate music bed (free)",r.busy?"disabled":"")}${B("scaffold",E.code,"Write playable scaffold",r.busy?"disabled":"")}</div></div>`}function w(p){if(Z.indexOf(p.stage)<Z.indexOf("playable"))return"";let h=p.publish?.url||le(t);return`<div class="gpc-sec"><h4>${E.pad} Play</h4>
      <div class="gpc-row gpc-mb"><span class="gpc-grow gpc-muted gpc-url">${$(h)}</span>
        ${B("orient",E.phone,r.portrait?"Landscape preview":"Portrait preview")}
        ${B("reload",E.refresh,"Reload game")}
        ${B("open",E.ext,"Open in new tab",`data-url="${$(h)}"`)}
        ${B("copy",E.copy,"Copy link",`data-url="${$(h)}"`)}
        ${B("publish",E.rocket,p.publish?.url?"Republish":"Publish",r.busy?"disabled":"","is-go")}</div>
      <div class="gpc-frame ${r.portrait?"is-portrait":""}"><iframe src="${$(le(t))}" sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen; gamepad" loading="lazy" title="${$(p.title)}"></iframe></div>
      ${p.publish?.note?`<div class="gpc-muted gpc-mt">${$(p.publish.note)}</div>`:""}</div>`}function v(){let p=r.project;if(!p){a.innerHTML=`<div class="gpc"><div class="gpc-head"><span class="gpc-kicker">${E.pad} Game</span><span class="gpc-muted">${$(r.error||"Loading\u2026")}</span></div></div>`;return}let h=p.design||{},f=a.querySelector(".gpc-frame iframe"),k=f&&Z.indexOf(p.stage)>=Z.indexOf("playable")?f:null;if(a.innerHTML=`<div class="gpc">
      <div class="gpc-head"><div class="gpc-headtext">
        <span class="gpc-kicker">${E.pad} Game project${r.busy?` \xB7 ${$(r.busy)}\u2026`:""}</span>
        <strong class="gpc-title">${$(p.title)}</strong>
        <div class="gpc-row"><span class="gpc-chip">${$(h.genre)}</span><span class="gpc-chip">${$(h.style)}</span>${h.multiplayer?'<span class="gpc-chip">multiplayer</span>':""}</div>
      </div>${B("refresh",E.refresh,"Refresh")}</div>
      ${c(p)}
      ${r.error?`<div class="gpc-err">${$(r.error)}</div>`:""}
      ${g(p)}${m(p)}${b(p)}${w(p)}
    </div>`,k){let j=a.querySelector(".gpc-frame iframe");j&&j.replaceWith(k)}}let S=null;a.addEventListener("click",async p=>{let h=p.target.closest("[data-gpa]");if(!h||h.disabled)return;p.preventDefault();let f=h.dataset.gpa,k=h.dataset.asset;if(f==="refresh")return n();if(f==="plan")return i("plan_assets");if(f==="generate")return i("generate_assets");if(f==="approve")return i("approve_asset",{assetId:k});if(f==="reject")return i("reject_asset",{assetId:k});if(f==="reroll")return i("reroll_asset",{assetId:k});if(f==="approve-cost"&&r.pending)return i(r.pending.action,{...r.pending.args,approved:!0});if(f==="dismiss")return r.pending=null,v();if(f==="sfx")return i("sfx",{force:!0});if(f==="music")return i("music",{force:!0});if(f==="scaffold")return i("scaffold");if(f==="publish")return i("publish");if(f==="orient"){r.portrait=!r.portrait;let j=a.querySelector(".gpc-frame");j&&j.classList.toggle("is-portrait",r.portrait),h.title=r.portrait?"Landscape preview":"Portrait preview";return}if(f==="reload"){let j=a.querySelector(".gpc-frame iframe");j&&(j.src=le(t));return}if(f==="open"){window.open(new URL(h.dataset.url,location.href).href,"_blank","noopener");return}if(f==="copy"){try{await navigator.clipboard.writeText(new URL(h.dataset.url,location.href).href),h.title="Copied"}catch{}return}if(f==="listen"||f==="stop")return S&&(S.pause(),S=null),f==="stop"?(r.playing=null,v()):(S=new Audio(h.dataset.src),r.playing=k,S.onended=()=>{r.playing=null,v()},S.play().catch(()=>{r.playing=null,v()}),v())}),v(),n()}var ue=null,me=!1;function Re(){me=!1,document.querySelectorAll(ot).forEach(a=>{try{nt(a)}catch(t){console.warn("[game-project-card]",t)}})}function Be(){if(!(typeof document>"u")){if(!document.getElementById(ze)){let a=document.createElement("style");a.id=ze,a.textContent=st,document.head.appendChild(a)}Re(),!ue&&(ue=new MutationObserver(()=>{me||(me=!0,requestAnimationFrame(()=>Re()))}),ue.observe(document.documentElement,{childList:!0,subtree:!0}))}}var st=`
.prom-gp-card{--gpc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--gpc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--gpc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--gpc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--gpc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.1))));--gpc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));--gpc-ok:var(--prom-success,#2fa86b);--gpc-bad:var(--prom-danger,#d9534f);display:block;margin:10px 0;max-width:100%;color:var(--gpc-text);font-size:14px;line-height:1.4}
.prom-gp-card .gpc{border:1px solid var(--gpc-line);border-radius:14px;background:var(--gpc-surface);overflow:hidden}
.prom-gp-card svg{width:16px;height:16px;flex:none}
.prom-gp-card .gpc-head{display:flex;gap:10px;align-items:flex-start;padding:12px 12px 10px;border-bottom:1px solid var(--gpc-line)}
.prom-gp-card .gpc-headtext{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.prom-gp-card .gpc-kicker{display:inline-flex;gap:6px;align-items:center;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--gpc-muted)}
.prom-gp-card .gpc-title{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-muted{color:var(--gpc-muted);font-size:12px}
.prom-gp-card .gpc-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.prom-gp-card .gpc-grow{flex:1;min-width:0}
.prom-gp-card .gpc-mt{margin-top:8px}.prom-gp-card .gpc-mb{margin-bottom:8px}
.prom-gp-card .gpc-chip{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--gpc-soft);font-size:11px;text-transform:capitalize}
.prom-gp-card .gpc-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:0;background:transparent;color:var(--gpc-text);cursor:pointer;padding:0}
.prom-gp-card .gpc-icon:hover{background:var(--gpc-soft)}
.prom-gp-card .gpc-icon:disabled{opacity:.35;cursor:default}
.prom-gp-card .gpc-icon.is-go{color:var(--gpc-accent)}
.prom-gp-card .gpc-go{display:inline-flex;gap:6px;align-items:center;border:0;border-radius:9px;padding:6px 10px;background:var(--gpc-accent);color:#fff;cursor:pointer;font-size:13px}
.prom-gp-card .gpc-steps{display:flex;list-style:none;margin:0;padding:10px 12px;gap:4px;border-bottom:1px solid var(--gpc-line);overflow-x:auto}
.prom-gp-card .gpc-steps li{flex:1;min-width:44px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--gpc-muted);position:relative}
.prom-gp-card .gpc-dot{width:10px;height:10px;border-radius:50%;border:2px solid var(--gpc-line);background:transparent}
.prom-gp-card .gpc-steps li.is-done .gpc-dot{background:var(--gpc-ok);border-color:var(--gpc-ok)}
.prom-gp-card .gpc-steps li.is-cur{color:var(--gpc-text)}
.prom-gp-card .gpc-steps li.is-cur .gpc-dot{border-color:var(--gpc-accent);background:var(--gpc-accent)}
.prom-gp-card .gpc-sec{padding:10px 12px;border-bottom:1px solid var(--gpc-line)}
.prom-gp-card .gpc-sec:last-child{border-bottom:0}
.prom-gp-card h4{margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--gpc-muted);display:flex;gap:6px;align-items:center}
.prom-gp-card .gpc-pitch{margin:0 0 6px}
.prom-gp-card .gpc-kv{display:grid;grid-template-columns:80px 1fr;gap:8px;font-size:12px;padding:2px 0}
.prom-gp-card .gpc-kv span:first-child{color:var(--gpc-muted)}
.prom-gp-card .gpc-answers{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.prom-gp-card .gpc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.prom-gp-card .gpc-tile{border:1px solid var(--gpc-line);border-radius:10px;overflow:hidden;background:var(--gpc-soft);display:flex;flex-direction:column}
.prom-gp-card .gpc-tile.is-approved{border-color:var(--gpc-ok)}
.prom-gp-card .gpc-tile.is-rejected{opacity:.55}
.prom-gp-card .gpc-tile.is-failed{border-color:var(--gpc-bad)}
.prom-gp-card .gpc-img{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(rgba(127,127,127,.18) 0% 25%,transparent 0% 50%) 50%/14px 14px}
.prom-gp-card .gpc-img img{width:100%;height:100%;object-fit:contain;image-rendering:auto}
.prom-gp-card .gpc-ph{color:var(--gpc-muted)}
.prom-gp-card .gpc-tile-foot{display:flex;gap:4px;align-items:center;padding:4px 6px;font-size:11px}
.prom-gp-card .gpc-tname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-badge{font-size:10px;color:var(--gpc-muted)}
.prom-gp-card .gpc-tile-acts{display:flex;justify-content:space-around;border-top:1px solid var(--gpc-line)}
.prom-gp-card .gpc-tile-acts .gpc-icon{width:30px;height:28px}
.prom-gp-card .gpc-cost{margin-top:8px}
.prom-gp-card .gpc-bar{height:4px;border-radius:2px;background:var(--gpc-soft);overflow:hidden;margin-top:4px}
.prom-gp-card .gpc-bar span{display:block;height:100%;background:var(--gpc-accent)}
.prom-gp-card .gpc-approve{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;padding:8px;border-radius:10px;border:1px solid var(--gpc-accent);font-size:12px}
.prom-gp-card .gpc-approve.is-blocked{border-color:var(--gpc-bad)}
.prom-gp-card .gpc-aud{display:flex;align-items:center;gap:6px;font-size:13px}
.prom-gp-card .gpc-url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-frame{position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:1px solid var(--gpc-line);background:#000}
.prom-gp-card .gpc-frame.is-portrait{aspect-ratio:9/16;max-width:min(100%,360px);margin:0 auto}
.prom-gp-card .gpc-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.prom-gp-card .gpc-err{margin:8px 12px 0;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,var(--gpc-bad) 14%,transparent);font-size:12px}
.prom-gp-card .gpc-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--gpc-line);border-top-color:var(--gpc-accent);animation:gpc-spin 1s linear infinite}
@keyframes gpc-spin{to{transform:rotate(360deg)}}
@media (max-width:420px){.prom-gp-card .gpc-grid{grid-template-columns:repeat(2,1fr)}.prom-gp-card .gpc-steps .gpc-step-l{font-size:9px}.prom-gp-card .gpc-kv{grid-template-columns:64px 1fr}}
`;function H(a){return a?String(a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var Ft=H;function it(a){let t=Date.now()-a;return t<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?`${Math.floor(t/36e5)}h ago`:`${Math.floor(t/864e5)}d ago`}function ct(a,t=0){let r=Number(a);return Number.isFinite(r)?`${r.toFixed(t)}%`:"--%"}function pt(a,t){let r=Number(a),e=Number(t);return!Number.isFinite(r)||!Number.isFinite(e)||e<=0?"-- / -- GB":`${r.toFixed(1)} / ${e.toFixed(1)} GB`}function Ne(a){let t=Number(a);return Number.isFinite(t)?`${Math.max(0,Math.min(100,t))}%`:"0%"}function dt(a,t){let r=document.getElementById(a);r&&(r.textContent=String(t||""))}function Dt(a){let t=String(a||"").trim(),r=H(t);return`<span class="t-think-sizer" aria-hidden="true">${r}</span><span class="t-think-text" data-text="${r}">${r}</span>`}function Ht(a,t){let r=String(t||"").trim(),e=a?.querySelector?.(".t-think-text");if(!e||!r)return!1;let o=String(e.textContent||"").trim();if(!o||o===r)return!1;a.querySelectorAll?.(".t-think-text").forEach(c=>{c!==e&&c.remove()});let n=e.cloneNode(!0);n.classList.remove("is-enter-start"),n.classList.add("is-exit"),n.textContent=r,n.setAttribute("data-text",r),e.classList.remove("is-exit"),e.classList.add("is-enter-start");let s=a.querySelector?.(".t-think-sizer");s&&r.length>String(s.textContent||"").length&&(s.textContent=r),a.appendChild(n),e.offsetWidth;let i=()=>{e.isConnected!==!1&&e.classList.remove("is-enter-start")};return typeof requestAnimationFrame=="function"?requestAnimationFrame(i):typeof setTimeout=="function"&&setTimeout(i,0),typeof setTimeout=="function"&&setTimeout(()=>{n.isConnected!==!1&&n.remove(),e.isConnected!==!1&&e.classList.remove("is-enter-start")},420),!0}function lt(a,t){let r=document.getElementById(a);r&&(r.style.width=Ne(t))}function Pe(a,t,r="info",e=5e3,o={}){let n=typeof o?.key=="string"?o.key.trim():"";if(n)for(let w of document.querySelectorAll(".__sc-toast"))w.dataset.scToastKey===n&&w.remove();let s=r==="warn"?"warning":["info","success","error","warning"].includes(r)?r:"info",i={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},c=document.createElement("div"),m=24+[...document.querySelectorAll(".__sc-toast")].reduce((w,v)=>w+v.offsetHeight+8,0);if(c.className=`__sc-toast __sc-toast--${s}`,n&&(c.dataset.scToastKey=n),c.style.cssText=`position:fixed;bottom:${m}px;right:24px;z-index:99999;`,c.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${i[s]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${H(a)}</div>
      ${t?`<div class="__sc-toast-body">${H(String(t))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let w=document.createElement("style");w.id="__sc-toast-style",w.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(w)}document.body.appendChild(c);let b=Math.max(0,Math.min(5e3,Number.isFinite(Number(e))?Number(e):5e3));setTimeout(()=>{c.style.transition="opacity 0.3s",c.style.opacity="0",setTimeout(()=>c.remove(),300)},b),c.querySelector(".__sc-toast-close")?.addEventListener("click",()=>c.remove())}function ut(a,t){Pe(a,t,"info")}function mt(a,t,r,e={}){let{title:o="Confirm",confirmText:n="Confirm",cancelText:s="Cancel",danger:i=!1,details:c=""}=e,g=document.createElement("div");g.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let m=document.createElement("div");m.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",m.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${H(o)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${H(a)}</div>
    ${c?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${H(c)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${H(s)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${i?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${H(n)}</button>
    </div>
  `,g.appendChild(m),document.body.appendChild(g);let b=()=>g.remove();m.querySelector("#__sc-confirm-cancel").onclick=()=>{b(),r&&r()},m.querySelector("#__sc-confirm-ok").onclick=()=>{b(),t&&t()},g.addEventListener("click",w=>{w.target===g&&(b(),r&&r())})}var oe=[];function vt(a,t="log"){let r=new Date().toLocaleTimeString();oe.push({text:`[${r}] ${String(a??"")}`,type:String(t||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),oe.length>100&&oe.shift();let e=document.getElementById("log-panel");e&&(e.replaceChildren(...oe.map(o=>{let n=document.createElement("div");return n.className=`log-line ${o.type}`,n.textContent=o.text,n})),e.scrollTop=e.scrollHeight)}var F=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function Oe(a,t){return String(a||"").replace(/[<>{};\r\n]/g,"").trim()||t}function Ue(){let a=document.documentElement,t=typeof getComputedStyle=="function"?getComputedStyle(a):null,r=(o,n)=>{for(let s of o){let i=t?.getPropertyValue(s)?.trim();if(i)return Oe(i,n)}return n},e={isDark:a.getAttribute("data-theme")==="dark",bg:r(["--bg","--pm-chat-page-bg"],F.bg),bgSoft:r(["--bg-soft"],F.bgSoft),surface:r(["--panel","--composer-panel"],F.surface),surfaceSecondary:r(["--panel-2","--composer-bg"],F.surfaceSecondary),border:r(["--line","--composer-border"],F.border),borderStrong:r(["--line-strong"],F.borderStrong),text:r(["--text","--fg","--composer-text"],F.text),muted:r(["--muted","--composer-muted"],F.muted),accent:r(["--brand","--pm-custom-accent"],F.accent),accentStrong:r(["--brand-2"],F.accentStrong),success:r(["--ok"],F.success),warning:r(["--warn"],F.warning),danger:r(["--err"],F.danger)};return e.series=[e.accent,e.accentStrong,e.success,e.warning,e.danger,e.muted],e.vars={"--prom-bg":e.bg,"--prom-bg-soft":e.bgSoft,"--prom-surface":e.surface,"--prom-surface-secondary":e.surfaceSecondary,"--prom-border":e.border,"--prom-border-strong":e.borderStrong,"--prom-text":e.text,"--prom-muted":e.muted,"--prom-accent":e.accent,"--prom-accent-strong":e.accentStrong,"--prom-success":e.success,"--prom-warning":e.warning,"--prom-danger":e.danger,"--prom-series-1":e.series[0],"--prom-series-2":e.series[1],"--prom-series-3":e.series[2],"--prom-series-4":e.series[3],"--prom-series-5":e.series[4],"--prom-series-6":e.series[5],"--bg":e.bg,"--bg-soft":e.bgSoft,"--panel":e.surface,"--panel-2":e.surfaceSecondary,"--line":e.border,"--line-strong":e.borderStrong,"--text":e.text,"--fg":e.text,"--muted":e.muted,"--brand":e.accent,"--brand-2":e.accentStrong,"--ok":e.success,"--warn":e.warning,"--err":e.danger},e}function gt(a){if(a&&typeof a=="object"&&a.vars)return a;let t={isDark:typeof a=="boolean"?a:!!a?.isDark,...F};return t.series=[t.accent,t.accentStrong,t.success,t.warning,t.danger,t.muted],t.vars=Object.fromEntries([["--prom-bg",t.bg],["--prom-bg-soft",t.bgSoft],["--prom-surface",t.surface],["--prom-surface-secondary",t.surfaceSecondary],["--prom-border",t.border],["--prom-border-strong",t.borderStrong],["--prom-text",t.text],["--prom-muted",t.muted],["--prom-accent",t.accent],["--prom-accent-strong",t.accentStrong],["--prom-success",t.success],["--prom-warning",t.warning],["--prom-danger",t.danger],...t.series.map((r,e)=>[`--prom-series-${e+1}`,r]),["--bg",t.bg],["--bg-soft",t.bgSoft],["--panel",t.surface],["--panel-2",t.surfaceSecondary],["--line",t.border],["--line-strong",t.borderStrong],["--text",t.text],["--fg",t.text],["--muted",t.muted],["--brand",t.accent],["--brand-2",t.accentStrong],["--ok",t.success],["--warn",t.warning],["--err",t.danger]]),t}function ht(a){let t=a?.vars&&typeof a.vars=="object"?a.vars:{};return Object.entries(t).map(([r,e])=>`${r}:${Oe(e,"transparent")}`).join(";")}function qe(a,t,r){let e=gt(r),o=se({background:"transparent",primaryColor:e.surface,primaryTextColor:e.text,primaryBorderColor:e.borderStrong,lineColor:e.muted,secondaryColor:e.surfaceSecondary,secondaryTextColor:e.text,secondaryBorderColor:e.border,tertiaryColor:e.bgSoft,tertiaryTextColor:e.text,tertiaryBorderColor:e.border,textColor:e.text,mainBkg:e.surface,nodeBorder:e.borderStrong,clusterBkg:e.surfaceSecondary,clusterBorder:e.border,edgeLabelBackground:"transparent"}),n=se({text:e.text,muted:e.muted,border:e.border,series:e.series}),s=`:root{${ht(e)}color-scheme:${e.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${e.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return a==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${s}body{display:flex;align-items:center;justify-content:center;min-height:220px;padding:8px}canvas{width:100%!important;max-width:100%;max-height:100%}</style>
</head><body><canvas id="c"></canvas>
<script>try{const visualTheme=${n};Chart.defaults.color=visualTheme.text;Chart.defaults.borderColor=visualTheme.border;const cfg=(${t});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};const datasets=cfg.data&&Array.isArray(cfg.data.datasets)?cfg.data.datasets:[];datasets.forEach((dataset,index)=>{const color=visualTheme.series[index%visualTheme.series.length];if(!dataset.backgroundColor)dataset.backgroundColor=color;if(!dataset.borderColor)dataset.borderColor=color;});const chart=new Chart(document.getElementById('c'),cfg);window.addEventListener('prometheus:visual-theme-change',(event)=>{const next=event.detail||{};if(next.text)Chart.defaults.color=next.text;if(next.border)Chart.defaults.borderColor=next.border;chart.update('none');});}catch(e){document.body.innerHTML='<pre style="color:var(--prom-danger);padding:8px;font-size:11px;white-space:pre-wrap">'+e.message+'<\\/pre>';}<\/script>
</body></html>`:a==="svg"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
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
</body></html>`:a==="mermaid"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
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
  const baseMermaidThemeVariables = ${o};
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
</head><body>${t}</body></html>`}function X(a){return String(a||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function se(a){return JSON.stringify(a??null).replace(/</g,"\\u003c")}function ft(a,t={}){let r=String(t.visualId||""),e=t.state&&typeof t.state=="object"?t.state:{},o=`<script>(function(){
var visualId=${se(r)},last=0,state=${se(e)}||{};
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
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,n=String(a||"");return/<head\b[^>]*>/i.test(n)?n.replace(/<head\b[^>]*>/i,s=>`${s}${o}`):`${o}${n}`}function bt(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let a=()=>{let t=Ue();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(r=>{let e=String(r.getAttribute("data-visual-id")||"");if(!(!e||!r.contentWindow))try{r.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:e,theme:t},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(a,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(a,0)),window.addEventListener("message",t=>{let r=t?.data;if(!r||!String(r.type||"").startsWith("prometheus:visual-"))return;let e=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(n=>n.contentWindow===t.source);if(!e)return;let o=String(e.getAttribute("data-visual-id")||"");if(String(r.visualId||"")===o){if(r.type==="prometheus:visual-resize"){let n=Number(r.height);if(!Number.isFinite(n))return;let s=Math.min(1e4,Math.max(120,Math.ceil(n))),i=Math.ceil(e.getBoundingClientRect().height||0);if(Math.abs(i-s)<=1)return;e.style.height=`${s}px`,e.style.minHeight=`${s}px`;return}if(r.type==="prometheus:visual-state"&&r.state&&typeof r.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:o,state:r.state}}));return}r.type==="prometheus:visual-followup"&&r.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:o,prompt:String(r.prompt),title:String(r.title||"")}}))}})}function ve(a){if(!a?.getAttribute)return"";let t=a.closest?.(".visual-block"),r=String(a.getAttribute("data-visual-id")||"").trim();return r?[r,String(a.getAttribute("data-visual-version")||"1"),String(t?.getAttribute("data-vis-lang")||""),String(t?.getAttribute("data-vis-code")||"")].join("\0"):""}function ne(a){if(!a?.querySelector&&!a?.matches)return"";let t=a.matches?.('iframe[data-prom-visual="true"]')?a:a.querySelector?.('iframe[data-prom-visual="true"]');return ve(t)}function xt(a,t){return!a||!t||a.nodeType!==t.nodeType?!1:a.nodeType!==1?!0:String(a.tagName||"").toLowerCase()===String(t.tagName||"").toLowerCase()}function yt(a,t){let e=a.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(a.attributes||[]).forEach(o=>{e.has(o.name)||t.hasAttribute(o.name)||a.removeAttribute(o.name)}),Array.from(t.attributes||[]).forEach(o=>{e.has(o.name)||a.getAttribute(o.name)!==o.value&&a.setAttribute(o.name,o.value)})}function ee(a,t,r,e=null){let o=Array.from(t||[]),n=Array.from(r||[]),s=Math.min(o.length,n.length),i=0;for(let c=0;c<s;c+=1){let g=o[c],m=n[c],b=De(g,m);if(b){i+=b.reused;continue}let w=m.cloneNode(!0);a.replaceChild(w,g)}for(let c=s;c<n.length;c+=1)a.insertBefore(n[c].cloneNode(!0),e);for(let c=s;c<o.length;c+=1)o[c].remove();return i}function wt(a,t){return a.length===t.length&&a.every((r,e)=>r===t[e])}function Fe(a,t){let r=Array.from(a.childNodes||[]),e=Array.from(t.childNodes||[]),o=r.map(ne).filter(Boolean),n=e.map(ne).filter(Boolean);if(o.length&&wt(o,n)){let s=0,i=0,c=0;for(let g of n){let m=r.findIndex((v,S)=>S>=s&&ne(v)===g),b=e.findIndex((v,S)=>S>=i&&ne(v)===g);if(m<0||b<0)return ee(a,r,e);c+=ee(a,r.slice(s,m),e.slice(i,b),r[m]);let w=De(r[m],e[b]);if(!w)return ee(a,r,e);c+=w.reused,s=m+1,i=b+1}return c+=ee(a,r.slice(s),e.slice(i)),c}return ee(a,r,e)}function De(a,t){return xt(a,t)?a.nodeType===3||a.nodeType===8?(a.nodeValue!==t.nodeValue&&(a.nodeValue=t.nodeValue),{reused:0}):a.matches?.('iframe[data-prom-visual="true"]')?ve(a)===ve(t)?{reused:1}:null:(yt(a,t),{reused:Fe(a,t)}):null}function He(a,t){return!a?.childNodes||!t?.childNodes?0:Fe(a,t)}function $t(a,t){if(!a)return 0;let r=String(t||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof a.appendChild!="function")return a.innerHTML=r,0;let e=document.createElement("template");e.innerHTML=r;let o=!!a.querySelector?.('iframe[data-prom-visual="true"]'),n=!!e.content.querySelector?.('iframe[data-prom-visual="true"]');return!o&&!n?(a.innerHTML=r,0):He(a,e.content)}function St(a,t,r=0){let e=`${a}\0${r}\0${t}`,o=2166136261;for(let n=0;n<e.length;n+=1)o^=e.charCodeAt(n),o=Math.imul(o,16777619);return`visual_local_${(o>>>0).toString(36)}`}function Ge(a,t,r={}){bt();let e=r.artifact&&typeof r.artifact=="object"?r.artifact:null,o=String(e?.id||r.visualId||St(a,t,r.ordinal||0)),n=`vis_${o.replace(/[^a-z0-9_-]/gi,"_")}`,s=Ue(),i=ft(qe(a,t,s),{visualId:o,state:e?.state||r.state||{}}),c=X(i),g=a.replace(/"/g,""),m=X(t),b=a==="chart"?240:a==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${n}-wrap" data-vis-lang="${g}" data-vis-code="${m}" data-vis-surface="inline">
  <iframe
    id="${n}"
    data-prom-visual="true"
    data-visual-id="${X(o)}"
    data-visual-version="${X(e?.version||1)}"
    srcdoc="${c}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${b}px;min-height:${b}px;border:none;display:block;background:transparent;color-scheme:${s.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function Ye(a){let t=String(a||""),r=typeof window<"u"?window.DOMPurify:null;return!r||typeof r.sanitize!="function"?H(t):r.sanitize(t,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function kt(a){let t=String(a||"").trim();if(!t)return"";if(/^file:\/\//i.test(t))try{t=decodeURIComponent(t.replace(/^file:\/\/\/?/i,""))}catch{t=t.replace(/^file:\/\/\/?/i,"")}t=t.replace(/^\.\//,"");let r=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof r=="function")try{let e=r(t);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}function Mt(a){let t=String(a||"").trim();return!t||t.startsWith("#")?!1:/^file:\/\//i.test(t)||/^[a-z]:[\\/]/i.test(t)?!0:!(/^[a-z][a-z0-9+.-]*:/i.test(t)||t.startsWith("/")||t.startsWith("\\"))}var Ct=/\.(mp4|webm|mov|m4v)(?:$|[?#])/i;function Et(a){let t=String(a||"");return t.includes("<img")?t.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/gi,(r,e,o,n)=>{let s=o.replace(/&amp;/g,"&");if(!Mt(s))return r;let i=kt(s),c=`${e}${n}`,g=c.match(/\salt="([^"]*)"/i),m=g?g[1]:"",b=X(s),w=m?`<span class="prom-inline-caption">${m}</span>`:"";return Ct.test(s)?`<span class="prom-inline-figure is-video"><video class="prom-inline-media" src="${X(i)}" controls playsinline preload="metadata" data-workspace-path="${b}"></video>${w}</span>`:`<span class="prom-inline-figure"><img${c.replace(/\s(?:loading|class)="[^"]*"/gi,"")} src="${X(i)}" class="prom-inline-media" loading="lazy" decoding="async" data-workspace-path="${b}" role="button" tabindex="0">${w}</span>`}):t}function At({src:a,name:t}){document.getElementById("prom-inline-lightbox")?.remove();let r=document.createElement("div");r.id="prom-inline-lightbox",r.className="prom-inline-lightbox",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true");let e=document.createElement("img");e.src=a,e.alt=t||"";let o=document.createElement("button");o.type="button",o.className="prom-inline-lightbox-close",o.setAttribute("aria-label","Close"),o.textContent="\xD7",r.append(e,o);let n=()=>{r.remove(),document.removeEventListener("keydown",s)},s=i=>{i.key==="Escape"&&n()};r.addEventListener("click",i=>{i.target!==e&&n()}),document.addEventListener("keydown",s),document.body.appendChild(r)}if(typeof document<"u"&&!window.__promInlineMediaWired){window.__promInlineMediaWired=!0;let a=t=>{let r=t.target?.closest?.("img.prom-inline-media");if(!r||t.type==="keydown"&&t.key!=="Enter"&&t.key!==" ")return;t.preventDefault();let e=r.getAttribute("data-workspace-path")||"",o={kind:"image",src:r.currentSrc||r.src,path:e,name:r.getAttribute("alt")||e.split(/[\\/]/).pop()||"Image"},n=window.__promOpenInlineMedia;if(typeof n=="function")try{n(o);return}catch{}At(o)};document.addEventListener("click",a),document.addEventListener("keydown",a)}var Tt=600,jt=2e5,K=new Map;function We(a,t={}){if(!a)return"";let r=String(a);if(r.length<=jt&&!/```(chart|svg|html|mermaid)\n/.test(r)&&!(Array.isArray(t.visualArtifacts)&&t.visualArtifacts.length)){let o=K.get(r);if(o!==void 0)return K.delete(r),K.set(r,o),o;let n=Ve(r,t);return K.set(r,n),K.size>Tt&&K.delete(K.keys().next().value),n}return Ve(r,t)}var It=/```video-project[ \t]*\n([\s\S]*?)```/g,zt=/```video-project[ \t]*\n[\s\S]*$/;function _t(a){let t="";try{t=String(JSON.parse(String(a||"").trim())?.projectId||"")}catch{t=(String(a||"").match(/vp_[A-Za-z0-9_-]+/)||[""])[0]}return/^vp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-vp-card" data-vp-project="${t}"></div>`:""}var Lt=/```game-project[ \t]*\n([\s\S]*?)```/g,Rt=/```game-project[ \t]*\n[\s\S]*$/;function Bt(a){let t="";try{t=String(JSON.parse(String(a||"").trim())?.projectId||"")}catch{t=(String(a||"").match(/gp_[A-Za-z0-9_-]+/)||[""])[0]}return/^gp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-gp-card" data-gp-project="${t}"></div>`:""}function Ve(a,t={}){try{let r=[],e=`PROMVISUAL${Math.random().toString(36).slice(2)}X`,o=[],n=`PROMVPCARD${Math.random().toString(36).slice(2)}X`;a=String(a).replace(It,(v,S)=>(o.push(_t(S)),`

${n}${o.length-1}END

`)).replace(zt,"").replace(Lt,(v,S)=>(o.push(Bt(S)),`

${n}${o.length-1}END

`)).replace(Rt,"");let s=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,i=0,c=Array.isArray(t.visualArtifacts)?t.visualArtifacts.filter(v=>v?.type==="visual"):[],g=String(a).replace(s,(v,S,p)=>{let h=r.length,f=S.toLowerCase(),k=c.find(j=>Number(j.ordinal)===i&&String(j.renderer||"")===f)||null;return r.push({lang:f,code:p.trim(),partial:!1,artifact:k,ordinal:i}),i+=1,`${e}${h}END`}),m=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,b=g.match(m);if(b){let v=r.length;r.push({lang:b[1].toLowerCase(),code:b[2],partial:!0}),g=g.slice(0,b.index)+`${e}${v}END`}let w=Et(Ye(marked.parse(g,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1})));if(r.length){let v=new RegExp(`${e}(\\d+)END`,"g");w=w.replace(v,(S,p)=>{let h=r[+p];return h?h.partial?"":Ge(h.lang,h.code,{artifact:h.artifact,ordinal:h.ordinal}):""}),w=w.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}if(o.length){let v=new RegExp(`(?:<p>\\s*)?${n}(\\d+)END(?:\\s*<\\/p>)?`,"g");w=w.replace(v,(S,p)=>o[+p]||"")}return w}catch{return H(a)}}window.escHtml=H;window.escapeHtml=H;window.sanitizeHtml=Ye;window.renderMd=We;Ie();Be();window.timeAgo=it;window.fmtPercent=ct;window.fmtMemoryGb=pt;window.meterWidth=Ne;window.setText=dt;window.setMeter=lt;window.showToast=Pe;window.bgtToast=ut;window.showConfirm=mt;window.log=vt;window.buildVisualSrcdoc=qe;window.buildVisualIframe=Ge;window.preserveVisualIframes=He;window.setInnerHTMLPreservingVisuals=$t;window.renderMd=We;export{H as a,Ft as b,it as c,ct as d,pt as e,Ne as f,dt as g,Dt as h,Ht as i,lt as j,Pe as k,ut as l,mt as m,vt as n,qe as o,He as p,$t as q,Ge as r,Ye as s,kt as t,We as u};
