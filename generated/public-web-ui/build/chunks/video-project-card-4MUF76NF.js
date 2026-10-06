var y=a=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a}</svg>`,b={box:y('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),userPlus:y('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),grid:y('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),gauge:y('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),up:y('<path d="M18 15l-6-6-6 6"/>'),down:y('<path d="M6 9l6 6 6-6"/>'),minus:y('<path d="M5 12h14"/>'),plus:y('<path d="M12 5v14M5 12h14"/>'),mic:y('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),share:y('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),split:y('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),rocket:y('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),download:y('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),check:y('<path d="M5 12l5 5L20 7"/>'),x:y('<path d="M18 6L6 18M6 6l12 12"/>'),pen:y('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),film:y('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),talk:y('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><path d="M17 7a4 4 0 010 6M20 4a8 8 0 010 12"/>'),sparkle:y('<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>'),speaker:y('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>'),copies:y('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),undo:y('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>'),trash:y('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>')},H=null;function se(a){return H||(H=a.vpFetch("/action",{action:"presets"}).then(o=>o?.presets||[]).catch(()=>(H=null,[]))),H}function Re(a,o,t){let e=o.presets||[],r=a.presetId||"",n=Object.entries({camera:"Camera",vfx:"VFX",look:"Look"}).map(([v,g])=>{let u=e.filter(l=>l.group===v);return u.length?`<optgroup label="${g}">${u.map(l=>`<option value="${t.esc(l.id)}"${l.id===r?" selected":""}>${t.esc(l.label)}</option>`).join("")}</optgroup>`:""}).join(""),d=r&&!e.some(v=>v.id===r)?`<option value="${t.esc(r)}" selected>${t.esc(r)}</option>`:"";return`<select class="vpc-select" data-vpf="presetId" data-s="${t.esc(a.id)}" aria-label="Preset" title="Motion / VFX / look preset"><option value="">No preset</option>${d}${n}</select>`}function ce(a,o){let t=String(a.modelId||""),e="";return/lipsync/.test(t)?e="lipsync":/omnihuman|ai-avatar/.test(t)?e="talking":a.sourceVideo?e="recast":a.sketch?e="sketch":(o?.kind==="image"||a.kenBurns)&&(e="still"),e?` <span class="vpc-pill is-kind">${e}</span>`:""}function ie(a){return`<span class="vpc-ptools" role="toolbar" aria-label="Studio tools">
    ${a.iconBtn("draw",b.pen,"Draw to video (sketch pad)")}
    ${a.iconBtn("recast",b.film,"Recast a video (upload footage)")}
    ${a.iconBtn("talking-photo",b.talk,"Talking photo (upload portrait)")}
    ${a.iconBtn("upscale",b.sparkle,"Upscale selected takes")}
    ${a.iconBtn("foley",b.speaker,"Add foley / sound effects")}
    ${a.iconBtn("batch",b.copies,"Make ad variants (hooks + creators)")}
  </span>`}function Q(a,o="",t=""){return new Promise(e=>{let r=document.createElement("div");r.className="vpc-sketch";let s=v=>String(v).replace(/[&<>"]/g,g=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[g]);r.innerHTML=`<div class="vpc-sketch-box vpc-ask" role="dialog" aria-label="${s(a)}">
      <label class="vpc-ask-title">${s(a)}</label>
      <textarea rows="3" placeholder="${s(o)}">${s(t)}</textarea>
      <div class="vpc-sketch-bar"><span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${b.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Continue" aria-label="Continue">${b.check}</button>
      </div></div>`,document.body.appendChild(r);let n=r.querySelector("textarea");setTimeout(()=>{n.focus(),n.setSelectionRange(n.value.length,n.value.length)},30);let d=v=>{r.remove(),e(v)};n.addEventListener("keydown",v=>{v.key==="Enter"&&(v.metaKey||v.ctrlKey)&&d(n.value.trim()),v.key==="Escape"&&d("")}),r.addEventListener("click",v=>{let g=v.target.closest("button");if(!g){v.target===r&&d("");return}d(g.dataset.k==="ok"?n.value.trim():"")})})}function Pe(){return new Promise(a=>{let o=document.createElement("div");o.className="vpc-sketch",o.innerHTML=`<div class="vpc-sketch-box" role="dialog" aria-label="Sketch pad">
      <canvas width="720" height="720"></canvas>
      <div class="vpc-sketch-bar">
        ${[3,8,18].map((l,$)=>`<button type="button" class="vpc-icon${$===1?" is-on":""}" data-w="${l}" title="Brush ${["S","M","L"][$]}" aria-label="Brush ${["small","medium","large"][$]}"><span class="vpc-dotb" style="width:${l/2+4}px;height:${l/2+4}px"></span></button>`).join("")}
        <button type="button" class="vpc-icon" data-k="undo" title="Undo" aria-label="Undo">${b.undo}</button>
        <button type="button" class="vpc-icon" data-k="clear" title="Clear" aria-label="Clear">${b.trash}</button>
        <span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${b.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Use sketch" aria-label="Use sketch">${b.check}</button>
      </div></div>`,document.body.appendChild(o);let t=o.querySelector("canvas"),e=t.getContext("2d"),r=[],s=8,n=null,d=()=>{e.fillStyle="#fff",e.fillRect(0,0,t.width,t.height),e.strokeStyle="#111",e.lineCap="round",e.lineJoin="round";for(let l of r)e.lineWidth=l.w,e.beginPath(),l.pts.forEach(([$,x],R)=>R?e.lineTo($,x):e.moveTo($,x)),l.pts.length===1&&e.lineTo(l.pts[0][0]+.1,l.pts[0][1]),e.stroke()},v=l=>{let $=t.getBoundingClientRect();return[(l.clientX-$.left)*(t.width/$.width),(l.clientY-$.top)*(t.height/$.height)]};t.style.touchAction="none",t.addEventListener("pointerdown",l=>{t.setPointerCapture(l.pointerId),n={w:s,pts:[v(l)]},r.push(n),d()}),t.addEventListener("pointermove",l=>{n&&(n.pts.push(v(l)),d())});let g=()=>{n=null};t.addEventListener("pointerup",g),t.addEventListener("pointercancel",g),d();let u=l=>{o.remove(),a(l)};o.addEventListener("click",l=>{let $=l.target.closest("button");if(!$){l.target===o&&u(null);return}if($.dataset.w){s=Number($.dataset.w),o.querySelectorAll("[data-w]").forEach(R=>R.classList.toggle("is-on",R===$));return}let x=$.dataset.k;x==="undo"?(r.pop(),d()):x==="clear"?(r.length=0,d()):x==="cancel"?u(null):x==="ok"&&u(r.length?t.toDataURL("image/png").replace(/^data:[^,]*,/,""):null)})})}var Le={openai:["alloy","ash","coral","echo","fable","nova","onyx","sage","shimmer"],xai:["ara","rex","sal","eve","leo"]},ze=["bold","pop","minimal","karaoke"],Ue=["9:16","1:1","16:9"];function pe(a,o,t,e){let r="vpc-thumb";if(o?.poster)return`<img class="${r}" src="${e.esc(e.mediaUrl(o.poster))}" alt="" loading="eager" decoding="async">`;if(o?.path&&e.isVideo(o.path))return`<video class="${r}" src="${e.esc(e.mediaUrl(o.path))}#t=0.1" muted playsinline preload="metadata"></video>`;if(o?.path)return e.thumb(o.path,r);if(a?.storyboard)return e.thumb(a.storyboard,r);let s=(a?.characterIds||[])[0],n=(t?.characters||[]).find(d=>d.id===s)||(t?.characters||[])[0];return e.thumb((n?.anchors||[])[0],r)}function de(a){return a?.kind==="product"?'<span class="vpc-pill is-product">Product</span>':""}var K=null;function le(a){return K||(K=a.vpFetch("/action",{action:"models"}).then(o=>(o?.models||[]).filter(t=>!t.kind||t.kind==="video")).catch(()=>(K=null,[]))),K}function ve(a,o,t,e,r){let s=r.esc(a.id),n=e.models||[],d=a.modelId||"",v=['<option value="">Default model</option>',...n.map(g=>`<option value="${r.esc(g.id)}"${g.id===d?" selected":""}>${r.esc(g.label||g.id)}${g.price!=null?` \xB7 ${r.esc(typeof g.price=="number"?r.usd(g.price):g.price)}`:""}</option>`)];return d&&!n.some(g=>g.id===d)&&v.push(`<option value="${r.esc(d)}" selected>${r.esc(d)}</option>`),`<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${s}">${r.esc(a.prompt||"")}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${s}" placeholder="Spoken line for this shot">${r.esc(a.line||"")}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${r.iconBtn("dur",b.minus,"Shorter",`data-s="${s}" data-d="-1" ${Number(a.durationSec)<=1?"disabled":""}`)}
        <span>${Number(a.durationSec)||0}s</span>
        ${r.iconBtn("dur",b.plus,"Longer",`data-s="${s}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${s}" aria-label="Model">${v.join("")}</select>
      ${Re(a,e,r)}
      <span class="vpc-grow"></span>
      ${r.iconBtn("move",b.up,"Move up",`data-s="${s}" data-i="${o-1}" ${o===0?"disabled":""}`)}
      ${r.iconBtn("move",b.down,"Move down",`data-s="${s}" data-i="${o+1}" ${o>=t-1?"disabled":""}`)}
      ${(a.takes||[]).length>=2?r.iconBtn("variants",b.split,"Render hook variants (one export per take)",`data-s="${s}"`):""}
    </div>
    ${a.voiceover?.path?`<audio class="vpc-audio" src="${r.esc(r.mediaUrl(a.voiceover.path))}" controls preload="none"></audio>`:""}
  </div>`}function ue(a,o){let t=a?.qa;if(!t||t.score==null)return"";let e=Number(t.score),r=e>=7?"good":e>=5?"warn":"bad",s=[`QA ${e}/10${t.verdict?` \xB7 ${t.verdict}`:""}${t.model?` \xB7 ${t.model}`:""}`,...t.issues||[]].join(`
`);return`<span class="vpc-qa is-${r}" title="${o.esc(s)}" aria-label="${o.esc(s)}">${e}</span>`}function he(a,o){let t=a.shots||[];if(!t.some(s=>s.storyboard||(s.storyboardCandidates||[]).length))return"";let e=t.some(s=>!s.storyboard&&(s.storyboardCandidates||[]).length);return`<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${t.map((s,n)=>{let d=o.esc(s.id),v=(s.storyboardCandidates||[]).find(l=>l!==s.storyboard),g=s.storyboard||v;if(!g)return`<div class="vpc-sb is-empty"><span class="vpc-sb-n">${n+1}</span></div>`;let u=!s.storyboard&&v?`<div class="vpc-tile-actions">
        ${o.iconBtn("sb-approve",b.check,"Approve storyboard",`data-s="${d}" data-path="${o.esc(v)}"`,"is-go")}
        ${o.iconBtn("sb-reject",b.x,"Reject storyboard",`data-s="${d}" data-path="${o.esc(v)}"`)}
      </div>`:`<span class="vpc-badge">${b.check}</span>`;return`<div class="vpc-sb${s.storyboard?" is-approved":""}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${o.esc(g)}" aria-label="View storyboard ${n+1}">${o.thumb(g,"vpc-tile-img")}</button>
      <span class="vpc-sb-n">${n+1}</span>${u}</div>`}).join("")}</div>
    ${e?`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${b.check}<span>Approve all</span></button>`:""}
  </section>`}function me(a,o,t){if(!(a.shots||[]).length)return"";let e=a.voice||{},r=e.provider||"openai",s=Object.entries(Le).map(([x,R])=>`<optgroup label="${x==="xai"?"xAI":"OpenAI"}">${R.map(U=>`<option value="${x}:${U}"${x===r&&U===e.voice?" selected":""}>${U}</option>`).join("")}</optgroup>`).join(""),n=a.captions||{},d=a.music||null,v=d?/chill/i.test(d.label||d.path||"")?"chill":/pulse/i.test(d.label||d.path||"")?"pulse":"custom":"none",g=(a.shots||[]).some(x=>x.line),u=Math.round((d?.volume??.3)*100),l=(a.audioMode||"voiceover")==="native";return`<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    ${`<div class="vpc-row vpc-wrap" role="radiogroup" aria-label="Who speaks the lines">
      <span class="vpc-muted">Speech</span>
      ${[["native","On camera","The creator speaks each line in the clip; captions transcribe the clip audio"],["voiceover","Narrator","TTS voiceover over dialogue-free clips; captions follow the voiceover"]].map(([x,R,U])=>`<button type="button" class="vpc-chip${(l?"native":"voiceover")===x?" is-on":""}" data-vpa="audio-mode" data-v="${x}" role="radio" aria-checked="${(l?"native":"voiceover")===x}" title="${U}">${R}</button>`).join("")}
    </div>`}
    ${l?`<div class="vpc-row vpc-wrap"><button type="button" class="vpc-btn" data-vpa="transcribe" title="Re-read what each clip says for captions">${b.mic}<span>Transcribe clips</span></button></div>`:`<div class="vpc-row vpc-wrap">
      ${b.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${e.voice?"":'<option value="" selected>Pick a voice</option>'}${s}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${g?"":'disabled title="Add voiceover lines to shots first"'}>${b.mic}<span>Voiceover</span></button>
    </div>`}
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${n.enabled?" checked":""}><span>Captions</span></label>
      ${ze.map(x=>`<button type="button" class="vpc-chip${(n.style||"bold")===x&&n.enabled?" is-on":""}" data-vpa="cap-style" data-v="${x}" aria-pressed="${(n.style||"bold")===x&&!!n.enabled}">${x}</button>`).join("")}
      ${n.cues?.length?`<span class="vpc-muted">${n.cues.length} cues</span>`:""}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[["pulse","Pulse"],["chill","Chill"],["none","None"]].map(([x,R])=>`<button type="button" class="vpc-chip${v===x?" is-on":""}" data-vpa="music" data-v="${x}" aria-pressed="${v===x}">${R}</button>`).join("")}
      ${v==="custom"?`<span class="vpc-chip is-on">${t.esc(d.label||"Custom")}</span>`:""}
      ${d?`<input class="vpc-range" type="range" min="0" max="100" value="${u}" data-vpf="volume" aria-label="Music volume" title="Music volume ${u}%">`:""}
    </div>
  </section>`}function ge(a,o,t){let e=[],r=a.lastRun;r?.steps?.length&&e.push(`<ol class="vpc-steps">${r.steps.map(n=>`<li class="is-${t.esc(n.state)}" title="${t.esc(n.note||n.state)}"><span class="vpc-dot"></span>${t.esc(n.step)}${n.note?` <small class="vpc-muted">${t.esc(String(n.note).slice(0,80))}</small>`:""}</li>`).join("")}</ol>`);let s=o.actPending||(r?.needsApproval?{action:"run",args:{},usd:r.needsApproval.usd,breakdown:r.needsApproval.breakdown}:null);if(s){let n=(s.breakdown||[]).map(d=>`<li>${t.esc(d.item)} \xB7 ${t.usd(d.usd)}</li>`).join("");e.push(`<div class="vpc-approve">
      <strong>${s.action==="storyboard"?"Storyboard":s.action==="run"?"Autopilot":t.esc(s.action)} needs approval \xB7 ${t.usd(s.usd)}</strong>
      ${n?`<ul>${n}</ul>`:""}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${b.check}<span>Approve ${t.usd(s.usd)}</span></button>
        ${t.iconBtn("act-cancel",b.x,"Cancel")}
      </div></div>`)}return(a.shots||[]).length&&e.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${o.busy?"disabled":""}>${b.rocket}<span>Run all</span></button>`),e.length?`<section class="vpc-sec"><h4>Autopilot</h4>${e.join("")}</section>`:""}function fe(a,o,t){let e=(a.exports||[]).slice().reverse(),r=Ue.map(n=>`<button type="button" class="vpc-chip${o.aspects.has(n)?" is-on":""}" data-vpa="aspect" data-v="${n}" aria-pressed="${o.aspects.has(n)}">${n}</button>`).join(""),s=e.slice(0,6).map(n=>{let d=t.mediaUrl(n.path),v=[n.aspect,n.variant?`variant ${n.variant}`:"",`${Number(n.durationSec||0).toFixed(1)}s`].filter(Boolean).join(" \xB7 ");return`<div class="vpc-export">
      <video src="${t.esc(d)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${t.esc(v)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${t.esc(d)}" download="${t.esc(String(n.path).split("/").pop())}" title="Download" aria-label="Download">${b.download}</a>
        ${t.iconBtn("share",b.share,"Share",`data-path="${t.esc(n.path)}"`)}
      </div></div>`}).join("");return`<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${r}</div>
    ${s?`<div class="vpc-exports">${s}</div>`:""}</section>`}function Z(a="image/*"){return new Promise(o=>{let t=document.createElement("input");t.type="file",t.accept=a,t.style.display="none",t.addEventListener("change",()=>{let e=t.files&&t.files[0];if(t.remove(),!e)return o(null);let r=new FileReader;r.onload=()=>o({filename:e.name,dataBase64:String(r.result||"").replace(/^data:[^,]*,/,"")}),r.onerror=()=>o(null),r.readAsDataURL(e)}),document.body.appendChild(t),t.click()})}async function Te(a,o){let t=o.mediaUrl(a);try{t=new URL(t,location.href).href}catch{}if(navigator.share)try{return await navigator.share({title:"Video",url:t}),"Shared"}catch{return""}try{return await navigator.clipboard.writeText(t),"Link copied"}catch{return"Copy failed"}}async function be(a,o){let{st:t,d:e,act:r,ops:s,paint:n,h:d}=o,v=t.project||{},g=u=>(v.shots||[]).find(l=>l.id===u);switch(a){case"upload-product":case"upload-character":{let u=await Z();return u&&await r("import_asset",{...u,role:a==="upload-product"?"product":"character",name:u.filename.replace(/\.[^.]+$/,"")},"Uploading"),!0}case"storyboard":return await r("storyboard",{},"Storyboarding"),!0;case"sb-approve":return await s([{op:"shot.approveStoryboard",id:e.s,path:e.path}],"Approving storyboard"),!0;case"sb-reject":return await s([{op:"shot.rejectStoryboard",id:e.s,path:e.path}],"Rejecting"),!0;case"sb-approve-all":{let u=(v.shots||[]).filter(l=>!l.storyboard&&(l.storyboardCandidates||[]).length).map(l=>({op:"shot.approveStoryboard",id:l.id,path:l.storyboardCandidates[0]}));return u.length&&await s(u,"Approving storyboard"),!0}case"dur":{let u=g(e.s);if(!u)return!0;let l=Math.max(1,Math.min(30,(Number(u.durationSec)||5)+Number(e.d)));return await s([{op:"shot.update",id:e.s,durationSec:l}],"Saving"),!0}case"move":return await s([{op:"shot.move",id:e.s,index:Number(e.i)}],"Reordering"),!0;case"variants":return await r("render_variants",{shotId:e.s},"Rendering hook variants",900*1e3),!0;case"qa":return await r("qa",{},"Scoring takes",300*1e3),!0;case"voiceover":return await r("voiceover",{},"Recording voiceover",300*1e3),!0;case"audio-mode":return await s([{op:"project.update",audioMode:e.v}],e.v==="native"?"Using on-camera dialogue":"Using a narrator"),!0;case"transcribe":return await r("transcribe",{force:!0},"Transcribing clips",3e5)&&v.captions?.enabled&&await r("captions",{style:v.captions.style},"Rebuilding captions"),!0;case"cap-style":{let u=e.v;return await r("captions",{style:u},"Building captions")&&await s([{op:"captions.set",enabled:!0,style:u}],"Saving captions"),!0}case"music":return e.v==="none"?await s([{op:"music.clear"}],"Removing music"):await r("music",{builtin:e.v},"Adding music"),!0;case"run-all":return await r("run",{},"Running autopilot",1800*1e3),!0;case"act-approve":{let u=t.actPending||(v.lastRun?.needsApproval?{action:"run",args:{}}:null);return t.actPending=null,u&&await r(u.action,{...u.args||{},approved:!0},"Submitting",1800*1e3),!0}case"act-cancel":return t.actPending=null,v.lastRun&&(v.lastRun.needsApproval=void 0),n(),!0;case"aspect":return t.aspects.has(e.v)?t.aspects.delete(e.v):t.aspects.add(e.v),n(),!0;case"draw":{let u=await Pe();if(!u)return!0;let l=await Q("What should this sketch become?","A cinematic scene at golden hour");return l&&await r("draw_to_video",{dataBase64:u,prompt:l},"Sketch to video",900*1e3),!0}case"recast":{let u=await Z("video/*");if(!u)return!0;let l=await r("import_asset",{...u,role:"footage"},"Uploading footage",300*1e3);if(!l?.assetPath)return!0;let $=await Q("Recast it as\u2026","New character, outfit, world or style");return $&&await r("recast",{sourcePath:l.assetPath,prompt:$,mode:"edit"},"Recasting",900*1e3),!0}case"talking-photo":{let u=await Z();if(!u)return!0;let l=await r("import_asset",{...u,role:"asset"},"Uploading portrait");if(!l?.assetPath)return!0;let $=await Q("What should they say?","Hey! You have to try this.");return $&&await r("talking_photo",{imagePath:l.assetPath,line:$},"Talking photo",900*1e3),!0}case"upscale":return await r("upscale",{},"Upscaling",900*1e3),!0;case"foley":return await r("foley",{},"Adding sound",900*1e3),!0;case"batch":return await r("batch_variants",{count:3,vary:["hook","creator"]},"Planning variants",300*1e3),!0;case"share":{let u=await Te(e.path,d);return u&&(t.error="",t.busy="",t.toast=u,n()),!0}default:return!1}}async function xe(a,o){let{d:t,ops:e,value:r,checked:s,st:n}=o;switch(a){case"prompt":case"line":case"modelId":case"presetId":{let d=(n.project?.shots||[]).find(v=>v.id===t.s);if(d&&String(d[a]||"")===r)return;await e([{op:"shot.update",id:t.s,[a]:r}],"Saving");return}case"voice":{let[d,v]=String(r).split(":");v&&await e([{op:"voice.set",provider:d,voice:v}],"Setting voice");return}case"captions":{let d=n.project?.captions?.style||"bold";s&&!(n.project?.captions?.cues||[]).length&&await o.act("captions",{style:d},"Building captions"),await e([{op:"captions.set",enabled:!!s,style:d}],"Saving captions");return}case"volume":{let d=n.project?.music;d?.path&&await e([{op:"music.set",path:d.path,volume:Number(r)/100,duck:d.duck!==!1}],"Saving");return}default:}}var $e=`
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
.prom-vp-card .vpc-export video{display:block;width:100%;aspect-ratio:16/9;max-height:260px;background:var(--vpc-soft)}
.prom-vp-card .vpc-export .vpc-row{padding:2px 6px}
.prom-vp-card .vpc-toast{padding:6px 12px;font-size:12px;color:var(--vpc-accent);border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-ptools{display:inline-flex;flex-wrap:wrap;gap:2px}
.prom-vp-card .vpc-pill.is-kind{margin-left:6px;text-transform:uppercase;font-size:10px;color:var(--vpc-accent);border-color:var(--vpc-accent)}
.vpc-sketch{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:10px}
.vpc-sketch-box{width:min(94vw,520px);background:var(--prom-surface,#fff);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px}
.vpc-sketch canvas{width:100%;aspect-ratio:1;border-radius:8px;background:#fff;touch-action:none}
.vpc-sketch-bar{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.vpc-ask{padding:12px;gap:8px;color:var(--prom-text,#111)}
.vpc-ask-title{font-weight:600;font-size:14px}
.vpc-ask textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:72px;font:inherit;font-size:16px;padding:8px 10px;border-radius:8px;border:1px solid var(--prom-border,#ccc);background:var(--prom-bg,transparent);color:inherit}
.vpc-sketch .vpc-icon{min-width:40px;min-height:40px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--prom-border,#ccc);border-radius:9px;background:transparent;color:var(--prom-text,#111);cursor:pointer}
.vpc-sketch .vpc-icon svg{width:18px;height:18px}
.vpc-sketch .vpc-icon.is-on,.vpc-sketch .vpc-icon.is-go{border-color:var(--prom-accent,#6c5ce7);color:var(--prom-accent,#6c5ce7)}
.vpc-dotb{display:inline-block;border-radius:50%;background:currentColor}
@media (max-width:420px){.prom-vp-card .vpc-ptools{max-width:100%}}
@media (max-width:420px){.prom-vp-card .vpc-tools{flex-wrap:wrap;justify-content:flex-end;max-width:50%}}
`;var we="prom-vp-card-style",_e=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",J=new Map,O=new Map,N=typeof IntersectionObserver=="function"?new IntersectionObserver(a=>{for(let o of a){let t=o.target.__vpCard;t&&(t.visible=o.isIntersecting,t.visible&&!t.loaded?(t.loaded=!0,Y(t.id)):t.visible&&!t.wasVisible?Y(t.id):re(t.id),t.wasVisible=t.visible)}},{rootMargin:"120px"}):null;function re(a){let o=O.get(a);if(!o)return;clearTimeout(o.timer);for(let e of o.cards)e.el.isConnected||(o.cards.delete(e),N?.unobserve(e.el),delete e.el.__vpCard);if(!o.cards.size){O.delete(a);return}(J.get(a)?.project?.jobs||[]).some(e=>e.state==="queued"||e.state==="running")&&[...o.cards].some(e=>e.visible)&&(o.timer=setTimeout(()=>{Y(a)},3500))}async function Y(a){let o=O.get(a);if(o)return o.request||(o.request=E(`/${encodeURIComponent(a)}`).then(t=>{t.project&&J.set(a,{project:t.project,history:t.history,at:Date.now()});for(let e of o.cards)e.update(t)}).catch(t=>{for(let e of o.cards)e.update(null,t)}).finally(()=>{o.request=null,re(a)})),o.request}var P=(a,o="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${o}>${a}</svg>`,M={film:P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:P('<path d="M5 12l5 5L20 7"/>'),x:P('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:P('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:P('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:P('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:P('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:P('<path d="M7 4v16l13-8z"/>'),seq:P('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:P('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:P('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:P('<path d="M6 9l6 6 6-6"/>'),user:P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:P('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:P('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function m(a){return String(a??"").replace(/[&<>"']/g,o=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[o])}function _(a){return`$${(Number(a)||0).toFixed(2)}`}function W(a){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(a||""))}function ee(a){return String(a||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function q(a){let o=String(a||"").trim();if(!o)return"";if(/^(https?:|data:|blob:)/i.test(o))return o;let t=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof t=="function")try{let e=t(o);if(e)return String(e)}catch{}if(typeof window<"u"&&document.body?.classList?.contains("pm-mobile-active")){let e=String(window.__pmMobileActiveGatewayOrigin||window.location?.origin||"").replace(/\/+$/,""),r=String(window.__pmMobileActiveGatewayToken||"").trim();if(!r&&e===String(window.location?.origin||""))try{r=String(localStorage.getItem("pm_device_token")||"").trim()}catch{}let s=new URLSearchParams({path:o});return r&&s.set("pt",r),`${e}/api/canvas/inline?${s}`}return`/api/canvas/inline?path=${encodeURIComponent(o)}`}async function E(a,o,t=2e4){let e={method:o===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:o===void 0?void 0:JSON.stringify(o),timeoutMs:t},r=`/api/video-projects${a}`,s=window.__promVideoProjectFetch||window.api,n;if(typeof s=="function")n=await s(r,e);else{let d=await fetch(r,e);n=await d.json().catch(()=>({success:!1,error:`HTTP ${d.status}`}))}if(n&&n.success===!1)throw new Error(n.error||"Request failed");return n||{}}function ye(a){let o=a?.takes||[];return o.length?o.find(t=>t.id===a.selectedTakeId)||o[o.length-1]:null}function te(a,o="vpc-thumb"){if(!a)return`<span class="${o} is-empty">${M.film}</span>`;let t=m(q(a));return W(a)?`<video class="${o}" src="${t}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${o}" src="${t}" alt="" loading="eager" decoding="async">`}function z(a,o,t,e="",r=""){return`<button type="button" class="vpc-icon${r?` ${r}`:""}" data-vpa="${a}" title="${m(t)}" aria-label="${m(t)}" ${e}>${o}</button>`}function Ee(a){a.dataset.vpMounted="1";let o=String(a.dataset.vpProject||""),t=J.get(o),e={project:t?.project||null,history:t?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1,actPending:null,models:[],aspects:new Set,toast:""},r={esc:m,usd:_,isVideo:W,mediaUrl:q,thumb:te,iconBtn:z,vpFetch:E},s=()=>a.isConnected,n={el:a,id:o,visible:!N,wasVisible:!N,loaded:!N,update:async(p,c)=>{s()&&(p&&v(p),e.error=c?String(c?.message||c):"",n.visible&&(await x(),T()))}},d=O.get(o)||{cards:new Set,timer:null,request:null};d.cards.add(n),O.set(o,d),a.__vpCard=n,N?.observe(a);function v(p){p?.project&&(e.project=p.project),p?.history&&(e.history=p.history),e.project&&J.set(o,{project:e.project,history:e.history,at:Date.now()})}async function g(){s()&&await Y(o)}function u(){return(e.project?.jobs||[]).filter(p=>p.state==="queued"||p.state==="running")}function l(){re(o)}function $(){let p=new Set(u().map(c=>c.target?.shotId).filter(Boolean));return(e.project?.shots||[]).filter(c=>!(c.takes||[]).length&&!p.has(c.id))}async function x(){let p=$(),c=p.map(h=>`${h.id}:${h.modelId||""}:${h.durationSec}:${(h.characterIds||[]).join(",")}`).join("|")+`#${(e.project?.characters||[]).map(h=>(h.anchors||[]).length).join(",")}`;if(!p.length){e.estimate=null,e.estimateKey="";return}if(!(c===e.estimateKey&&e.estimate))try{e.estimate=await E(`/${encodeURIComponent(o)}/estimate`,{shotIds:p.map(h=>h.id)}),e.estimateKey=c}catch(h){e.estimate=null,e.error=String(h?.message||h)}}async function R(p,c){e.busy=p,e.error="",T();try{let h=await c();return v(h),h}catch(h){return e.error=String(h?.message||h),null}finally{e.busy="",T()}}async function U(p,c){await R(c,()=>E(`/${encodeURIComponent(o)}/ops`,{ops:p})),await g()}async function X(p,c={},h="Working",f=12e4){let i=await R(h,()=>E(`/${encodeURIComponent(o)}/action`,{action:p,...c},f));if(!i)return null;let I=i.needsApproval;if(I){let C=i.lastRun?.needsApproval,A=i.shotId?{...c,pendingShotId:i.shotId}:c;A.pendingShotId&&A.dataBase64&&delete A.dataBase64,e.actPending={action:p,args:A,usd:Number(C?.usd??I?.usd??i.estimateUsd??i.totalUsd??i.estimate?.total??0),breakdown:C?.breakdown||I?.breakdown||i.breakdown||[]}}else e.actPending=null;return e.estimateKey="",await g(),i}async function D(p,c,h){let f=await R(h,()=>E(`/${encodeURIComponent(o)}${p}`,c,12e4));if(f){if(f.needsApproval){e.pending={path:p,body:{...c,approved:!0},label:h,reason:f.reason,estimate:f.estimate},T();return}e.pending=null,e.estimateKey="",await g()}}async function Me(){let p=e.project;if(!p)return;let c=(p.clips||[]).some(h=>h.source&&"shotId"in h.source);if(e.rendering=!0,e.aspects.size){await X("render",{aspects:[...e.aspects]},"Rendering",900*1e3),e.rendering=!1,await g();return}if(!c&&!await R("Assembling",()=>E(`/${encodeURIComponent(o)}/ops`,{ops:[{op:"timeline.assemble"}]}))){e.rendering=!1,T();return}await R("Rendering",()=>E(`/${encodeURIComponent(o)}/render`,{},900*1e3)),e.rendering=!1,await g()}function Se(p,c){let h=q(p);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:h,path:p,name:c||p.split("/").pop(),kind:W(p)?"video":"image"});return}catch{}window.open(h,"_blank","noopener")}function je(p){let c=`${z("upload-product",b.box,"Upload product photo")}${z("upload-character",b.userPlus,"Upload character photo")}${ie(r)}`;if(!(p.characters||[]).length)return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${c}</h4></section>`;let h=u().filter(i=>i.target?.characterId),f=p.characters.map(i=>{let I=h.some(j=>j.target.characterId===i.id),C=(i.anchors||[])[0],A=i.candidates||[],S=C?"Anchor approved":A.length?"Pick an anchor":I?"Generating anchor":"No anchor yet",k=[C?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${m(C)}" aria-label="View anchor">${te(C,"vpc-tile-img")}</button><span class="vpc-badge">${M.check}</span></div>`:"",...A.map(j=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${m(j)}" aria-label="View candidate">${te(j,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${z("approve-anchor",M.check,"Approve as anchor",`data-c="${m(i.id)}" data-path="${m(j)}"`,"is-go")}
            ${z("reject-anchor",M.x,"Reject",`data-c="${m(i.id)}" data-path="${m(j)}"`)}
          </div>
        </div>`),I?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${M.user}<strong>${m(i.name)}</strong>${de(i)}</span>
          <span class="vpc-muted">${m(S)}</span>
          <span class="vpc-grow"></span>
          ${i.anchorPrompt?z("reroll",M.reroll,"Generate another anchor",`data-c="${m(i.id)}"`):""}
        </div>
        ${k?`<div class="vpc-strip">${k}</div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${c}</h4>${f}</section>`}function Ce(p){let c=p.shots||[];if(!c.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let h=new Set(u().map(i=>i.target?.shotId).filter(Boolean)),f=c.map((i,I)=>{let C=ye(i),A=h.has(i.id),S=e.openShot===i.id,k=(i.takes||[]).length,j=S?(i.takes||[]).slice().reverse().map(w=>`
        <div class="vpc-take${w.id===C?.id?" is-selected":""}">
          ${W(w.path)?`<video src="${m(q(w.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${m(q(w.path))}" alt="" loading="eager">`}
          <div class="vpc-row">
            ${ue(w,r)}<span class="vpc-muted">${m(ee(w.modelId))} \xB7 ${_(w.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${w.id===C?.id?`<span class="vpc-inuse">${M.check}In cut</span>`:z("use-take",M.check,"Use this take",`data-s="${m(i.id)}" data-t="${m(w.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${S?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${m(i.id)}" aria-expanded="${S}">
          ${A&&!C?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':pe(i,C,p,r)}
          <span class="vpc-shot-meta">
            <strong>${I+1}. ${m(i.title||"Shot")}${ce(i,C)}</strong>
            <small>${m(String(i.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${A?"generating":m(i.status)}">${A?"generating":m(i.status)} \xB7 ${i.durationSec}s \xB7 ${k} take${k===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${M.chevron}</span>
        </button>
        ${S?`<div class="vpc-shot-body">
          ${ve(i,I,c.length,e,r)}
          ${i.camera?`<p class="vpc-muted">Camera: ${m(i.camera)}</p>`:""}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${m(i.id)}" data-n="1" ${A?"disabled":""}>${M.reroll}<span>${k?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${m(i.id)}" data-n="3" ${A?"disabled":""}>${M.layers}<span>3 variations</span></button>
          </div>
          ${j?`<div class="vpc-takes">${j}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${c.length}</span></h4>${f}</section>`}function Ie(p){let c=[];if(e.pending){let k=(e.pending.estimate?.shots||[]).map(j=>`<li>${m(j.title||"Item")}: ${j.count}\xD7 ${m(ee(j.modelId))} \xB7 ${_(j.usd)}</li>`).join("");c.push(`<div class="vpc-approve">
        <strong>Approve ${_(e.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${m(e.pending.reason||"")}</p>
        ${k?`<ul>${k}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${M.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${M.x}<span>Cancel</span></button>
        </div>
      </div>`)}let h=$(),f=e.estimate;if(!e.pending&&h.length&&f){let k=(f.shots||[]).flatMap(w=>(w.problems||[]).map(F=>`${w.title}: ${F}`)),j=(p.characters||[]).some(w=>!(w.anchors||[]).length&&(w.candidates||[]).length);c.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${h.length} shot${h.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${_(f.total)}</strong></div>
        ${j?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${k.length?`<ul class="vpc-warn">${k.map(w=>`<li>${m(w)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${j?"disabled":""}>${M.spark}<span>${f.total>(p.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${_(f.total)}</span></button>
      </div>`)}let i=u();i.length&&c.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${i.length} job${i.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let I=(p.jobs||[]).filter(k=>k.state==="failed").slice(-2);I.length&&!i.length&&c.push(`<ul class="vpc-warn">${I.map(k=>`<li>${m(ee(k.modelId))} failed: ${m(String(k.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let C=p.shots||[],A=C.length&&C.every(k=>ye(k)),S=(p.exports||[]).slice(-1)[0];return(A||S)&&c.push(`<div class="vpc-final">
        ${S?`<video src="${m(q(S.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(S.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${z("view",M.download,"Open video",`data-path="${m(S.path)}"`)}</div>`:""}
        ${A?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${e.rendering||i.length?"disabled":""}>${e.rendering?'<span class="vpc-spin"></span>':M.play}<span>${S?"Re-render":"Render video"}</span></button>
          ${z("assemble",M.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),c.length?`<section class="vpc-sec vpc-actions">${c.join("")}</section>`:""}function T(){if(!s())return;let p=document.activeElement;if(p&&a.contains(p)&&p.matches?.("textarea[data-vpf]")&&!e.busy)return;let c=e.project;if(!c){a.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${M.film}Video project</span></div>
        <p class="vpc-muted">${e.error?m(e.error):"Loading\u2026"}</p></div>`;return}let h=c.budget||{},f=document.body?.classList?.contains("pm-mobile-document-scroll")?document.scrollingElement||document.documentElement:a.closest(".pm-chat-body"),i=f?.getBoundingClientRect?.().top||0,I=a.getBoundingClientRect?.(),C=f?.scrollTop,A=`<div class="vpc">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${M.film}Video project \xB7 ${m(c.target?.aspect||"")}</span>
          <strong class="vpc-title">${m(c.title||c.id)}</strong>
          <span class="vpc-muted">${_(h.spentUsd)} spent${h.capUsd!=null?` of ${_(h.capUsd)}`:""} \xB7 auto-approve under ${_(h.autoApproveUsd??1)}</span>
        </div>
        <div class="vpc-tools">
          ${z("undo",M.undo,"Undo",e.history?.undo?"":"disabled")}
          ${z("redo",M.redo,"Redo",e.history?.redo?"":"disabled")}
          ${z("storyboard",b.grid,"Generate storyboard")}
          ${z("qa",b.gauge,"QA: score selected takes")}
          ${z("refresh",M.refresh,"Refresh")}
        </div>
      </div>
      ${e.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${m(e.busy)}\u2026</div>`:""}
      ${e.error?`<p class="vpc-err">${m(e.error)}</p>`:""}
      ${e.toast?`<div class="vpc-toast">${m(e.toast)}</div>`:""}
      ${je(c)}
      ${he(c,r)}
      ${Ce(c)}
      ${me(c,e,r)}
      ${Ie(c)}
      ${ge(c,e,r)}
      ${fe(c,e,r)}
    </div>`,S=a.querySelector(":scope > .vpc"),k=document.createElement("template");k.innerHTML=A;let j=k.content.firstElementChild;if(!S)a.replaceChildren(j);else{let w=[...S.children],F=[...j.children],ne=L=>`${L.tagName}:${L.className?.replace?.(/ is-[\w-]+/g,"")||""}:${L.querySelector?.("h4")?.textContent||""}`;for(let L=0;L<F.length;L++){let V=F[L],B=w.find(G=>ne(G)===ne(V)&&!G.__vpMatched);B?(B.__vpMatched=!0,B.outerHTML!==V.outerHTML?(V.querySelectorAll?.(".vpc-strip").forEach((G,Ae)=>{G.scrollLeft=B.querySelectorAll?.(".vpc-strip")[Ae]?.scrollLeft||0}),B.replaceWith(V)):S.children[L]!==B&&S.insertBefore(B,S.children[L]||null)):S.insertBefore(V,S.children[L]||null)}w.forEach(L=>{L.__vpMatched||L.remove(),delete L.__vpMatched})}if(f&&I&&C!=null&&I.bottom<i){let w=a.getBoundingClientRect().bottom-I.bottom;w&&(f.scrollTop=C+w)}}a.addEventListener("click",async p=>{let c=p.target.closest("[data-vpa]");if(!c||!a.contains(c)||c.disabled||(p.preventDefault(),p.stopPropagation(),e.busy&&c.dataset.vpa!=="toggle"&&c.dataset.vpa!=="view"))return;let h=c.dataset.vpa,f=c.dataset;switch(h){case"toggle":e.openShot=e.openShot===f.s?"":f.s,T(),e.openShot&&!e.models.length&&le(r).then(i=>{e.models=i,i.length&&T()}),e.openShot&&!(e.presets||[]).length&&se(r).then(i=>{e.presets=i,i.length&&T()});return;case"view":f.path&&Se(f.path);return;case"refresh":e.estimateKey="",await g();return;case"undo":case"redo":await R(h==="undo"?"Undoing":"Redoing",()=>E(`/${encodeURIComponent(o)}/${h}`,{})),e.estimateKey="",await g();return;case"approve-anchor":await U([{op:"character.approveAnchor",id:f.c,path:f.path}],"Approving anchor");return;case"reject-anchor":await U([{op:"character.rejectAnchor",id:f.c,path:f.path}],"Removing");return;case"reroll":await D(`/characters/${encodeURIComponent(f.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await U([{op:"take.select",shotId:f.s,takeId:f.t}],"Swapping take");return;case"redo-shot":await D("/generate",{shotIds:[f.s],count:Number(f.n)||1},"Estimating");return;case"gen-all":{let i=$().map(I=>I.id);if(!i.length)return;await D("/generate",{shotIds:i,count:1,approved:!0},"Submitting");return}case"approve-pending":{let i=e.pending;if(!i)return;e.pending=null,await D(i.path,i.body,"Submitting");return}case"cancel-pending":e.pending=null,T();return;case"assemble":await U([{op:"timeline.assemble"}],"Assembling");return;case"render":await Me();return;default:e.toast="",await be(h,{st:e,d:f,act:X,ops:U,paint:T,h:r})}}),a.addEventListener("change",async p=>{let c=p.target.closest?.("[data-vpf]");!c||!a.contains(c)||e.busy||await xe(c.dataset.vpf,{st:e,d:c.dataset,ops:U,act:X,value:c.value,checked:c.checked})}),a.addEventListener("click",p=>{p.target.closest?.("[data-vpf]")&&p.stopPropagation()}),T(),t&&Date.now()-t.at<3e3?x().then(()=>{T(),l()}):n.visible&&g()}var ae=null,oe=!1;function ke(a=document){oe=!1,a.querySelectorAll?.(_e).forEach(o=>{try{Ee(o)}catch(t){console.warn("[video-project-card] mount failed",t)}})}function Oe(){if(!(typeof document>"u")){if(!document.getElementById(we)){let a=document.createElement("style");a.id=we,a.textContent=Be+$e,document.head.appendChild(a)}ke(),!(ae||typeof MutationObserver>"u")&&(ae=new MutationObserver(()=>{if(oe)return;oe=!0,(typeof requestAnimationFrame=="function"?requestAnimationFrame:o=>setTimeout(o,16))(()=>ke())}),ae.observe(document.documentElement,{childList:!0,subtree:!0}))}}var Be=`
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
.prom-vp-card .vpc-take video,.prom-vp-card .vpc-take img{display:block;width:100%;aspect-ratio:9/16;max-height:220px;background:var(--vpc-soft);object-fit:contain}
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
.prom-vp-card .vpc-final video{display:block;width:100%;aspect-ratio:16/9;max-height:420px;border-radius:10px;background:var(--vpc-soft)}
.prom-vp-card .vpc-final .vpc-row{margin-top:6px}
.prom-vp-card .vpc-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--vpc-line);border-top-color:var(--vpc-accent);animation:vpc-spin .8s linear infinite;flex:none}
@keyframes vpc-spin{to{transform:rotate(360deg)}}
`;export{Oe as installVideoProjectCards};
