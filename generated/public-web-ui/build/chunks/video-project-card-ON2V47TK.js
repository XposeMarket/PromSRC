var P=t=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t}</svg>`,w={box:P('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),userPlus:P('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),grid:P('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),gauge:P('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),up:P('<path d="M18 15l-6-6-6 6"/>'),down:P('<path d="M6 9l6 6 6-6"/>'),minus:P('<path d="M5 12h14"/>'),plus:P('<path d="M12 5v14M5 12h14"/>'),mic:P('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),share:P('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),split:P('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),rocket:P('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),download:P('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),check:P('<path d="M5 12l5 5L20 7"/>'),x:P('<path d="M18 6L6 18M6 6l12 12"/>'),pen:P('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),film:P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),talk:P('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><path d="M17 7a4 4 0 010 6M20 4a8 8 0 010 12"/>'),sparkle:P('<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>'),speaker:P('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>'),copies:P('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),undo:P('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>'),trash:P('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>')},ct=null;function lt(t){return ct||(ct=t.vpFetch("/action",{action:"presets"}).then(a=>a?.presets||[]).catch(()=>(ct=null,[]))),ct}function le(t,a,o){let e=a.presets||[],s=t.presetId||"",r=Object.entries({camera:"Camera",vfx:"VFX",look:"Look"}).map(([l,m])=>{let v=e.filter(d=>d.group===l);return v.length?`<optgroup label="${m}">${v.map(d=>`<option value="${o.esc(d.id)}"${d.id===s?" selected":""}>${o.esc(d.label)}</option>`).join("")}</optgroup>`:""}).join(""),i=s&&!e.some(l=>l.id===s)?`<option value="${o.esc(s)}" selected>${o.esc(s)}</option>`:"";return`<select class="vpc-select" data-vpf="presetId" data-s="${o.esc(t.id)}" aria-label="Preset" title="Motion / VFX / look preset"><option value="">No preset</option>${i}${r}</select>`}function Ut(t,a){let o=String(t.modelId||""),e="";return/lipsync/.test(o)?e="lipsync":/omnihuman|ai-avatar/.test(o)?e="talking":t.sourceVideo?e="recast":t.sketch?e="sketch":(a?.kind==="image"||t.kenBurns)&&(e="still"),e?` <span class="vpc-pill is-kind">${e}</span>`:""}function Et(t){return`<span class="vpc-ptools" role="toolbar" aria-label="Studio tools">
    ${t.iconBtn("draw",w.pen,"Draw to video (sketch pad)")}
    ${t.iconBtn("recast",w.film,"Recast a video (upload footage)")}
    ${t.iconBtn("talking-photo",w.talk,"Talking photo (upload portrait)")}
    ${t.iconBtn("upscale",w.sparkle,"Upscale selected takes")}
    ${t.iconBtn("foley",w.speaker,"Add foley / sound effects")}
    ${t.iconBtn("batch",w.copies,"Make ad variants (hooks + creators)")}
  </span>`}function gt(t,a="",o=""){return new Promise(e=>{let s=document.createElement("div");s.className="vpc-sketch";let n=l=>String(l).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[m]);s.innerHTML=`<div class="vpc-sketch-box vpc-ask" role="dialog" aria-label="${n(t)}">
      <label class="vpc-ask-title">${n(t)}</label>
      <textarea rows="3" placeholder="${n(a)}">${n(o)}</textarea>
      <div class="vpc-sketch-bar"><span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${w.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Continue" aria-label="Continue">${w.check}</button>
      </div></div>`,document.body.appendChild(s);let r=s.querySelector("textarea");setTimeout(()=>{r.focus(),r.setSelectionRange(r.value.length,r.value.length)},30);let i=l=>{s.remove(),e(l)};r.addEventListener("keydown",l=>{l.key==="Enter"&&(l.metaKey||l.ctrlKey)&&i(r.value.trim()),l.key==="Escape"&&i("")}),s.addEventListener("click",l=>{let m=l.target.closest("button");if(!m){l.target===s&&i("");return}i(m.dataset.k==="ok"?r.value.trim():"")})})}function ve(){return new Promise(t=>{let a=document.createElement("div");a.className="vpc-sketch",a.innerHTML=`<div class="vpc-sketch-box" role="dialog" aria-label="Sketch pad">
      <canvas width="720" height="720"></canvas>
      <div class="vpc-sketch-bar">
        ${[3,8,18].map((d,S)=>`<button type="button" class="vpc-icon${S===1?" is-on":""}" data-w="${d}" title="Brush ${["S","M","L"][S]}" aria-label="Brush ${["small","medium","large"][S]}"><span class="vpc-dotb" style="width:${d/2+4}px;height:${d/2+4}px"></span></button>`).join("")}
        <button type="button" class="vpc-icon" data-k="undo" title="Undo" aria-label="Undo">${w.undo}</button>
        <button type="button" class="vpc-icon" data-k="clear" title="Clear" aria-label="Clear">${w.trash}</button>
        <span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${w.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Use sketch" aria-label="Use sketch">${w.check}</button>
      </div></div>`,document.body.appendChild(a);let o=a.querySelector("canvas"),e=o.getContext("2d"),s=[],n=8,r=null,i=()=>{e.fillStyle="#fff",e.fillRect(0,0,o.width,o.height),e.strokeStyle="#111",e.lineCap="round",e.lineJoin="round";for(let d of s)e.lineWidth=d.w,e.beginPath(),d.pts.forEach(([S,k],x)=>x?e.lineTo(S,k):e.moveTo(S,k)),d.pts.length===1&&e.lineTo(d.pts[0][0]+.1,d.pts[0][1]),e.stroke()},l=d=>{let S=o.getBoundingClientRect();return[(d.clientX-S.left)*(o.width/S.width),(d.clientY-S.top)*(o.height/S.height)]};o.style.touchAction="none",o.addEventListener("pointerdown",d=>{o.setPointerCapture(d.pointerId),r={w:n,pts:[l(d)]},s.push(r),i()}),o.addEventListener("pointermove",d=>{r&&(r.pts.push(l(d)),i())});let m=()=>{r=null};o.addEventListener("pointerup",m),o.addEventListener("pointercancel",m),i();let v=d=>{a.remove(),t(d)};a.addEventListener("click",d=>{let S=d.target.closest("button");if(!S){d.target===a&&v(null);return}if(S.dataset.w){n=Number(S.dataset.w),a.querySelectorAll("[data-w]").forEach(x=>x.classList.toggle("is-on",x===S));return}let k=S.dataset.k;k==="undo"?(s.pop(),i()):k==="clear"?(s.length=0,i()):k==="cancel"?v(null):k==="ok"&&v(s.length?o.toDataURL("image/png").replace(/^data:[^,]*,/,""):null)})})}var ue={openai:["alloy","ash","coral","echo","fable","nova","onyx","sage","shimmer"],xai:["ara","rex","sal","eve","leo"]},he=["bold","pop","minimal","karaoke"],me=["9:16","1:1","16:9"];function $t(t,a,o,e){let s="vpc-thumb";if(a?.poster)return`<img class="${s}" src="${e.esc(e.mediaUrl(a.poster))}" alt="" loading="eager" decoding="async">`;if(a?.path&&e.isVideo(a.path))return`<video class="${s}" src="${e.esc(e.mediaUrl(a.path))}#t=0.1" muted playsinline preload="metadata"></video>`;if(a?.path)return e.thumb(a.path,s);if(t?.storyboard)return e.thumb(t.storyboard,s);let n=(t?.characterIds||[])[0],r=(o?.characters||[]).find(i=>i.id===n)||(o?.characters||[])[0];return e.thumb((r?.anchors||[])[0],s)}function Tt(t){return t?.kind==="product"?'<span class="vpc-pill is-product">Product</span>':""}var dt=null;function vt(t){return dt||(dt=t.vpFetch("/action",{action:"models"}).then(a=>(a?.models||[]).filter(o=>!o.kind||o.kind==="video")).catch(()=>(dt=null,[]))),dt}function Lt(t,a,o,e,s){let n=s.esc(t.id),r=e.models||[],i=t.modelId||"",l=['<option value="">Default model</option>',...r.map(m=>`<option value="${s.esc(m.id)}"${m.id===i?" selected":""}>${s.esc(m.label||m.id)}${m.price!=null?` \xB7 ${s.esc(typeof m.price=="number"?s.usd(m.price):m.price)}`:""}</option>`)];return i&&!r.some(m=>m.id===i)&&l.push(`<option value="${s.esc(i)}" selected>${s.esc(i)}</option>`),`<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${n}">${s.esc(t.prompt||"")}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${n}" placeholder="Spoken line for this shot">${s.esc(t.line||"")}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${s.iconBtn("dur",w.minus,"Shorter",`data-s="${n}" data-d="-1" ${Number(t.durationSec)<=1?"disabled":""}`)}
        <span>${Number(t.durationSec)||0}s</span>
        ${s.iconBtn("dur",w.plus,"Longer",`data-s="${n}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${n}" aria-label="Model">${l.join("")}</select>
      ${le(t,e,s)}
      <span class="vpc-grow"></span>
      ${s.iconBtn("move",w.up,"Move up",`data-s="${n}" data-i="${a-1}" ${a===0?"disabled":""}`)}
      ${s.iconBtn("move",w.down,"Move down",`data-s="${n}" data-i="${a+1}" ${a>=o-1?"disabled":""}`)}
      ${(t.takes||[]).length>=2?s.iconBtn("variants",w.split,"Render hook variants (one export per take)",`data-s="${n}"`):""}
    </div>
    ${t.voiceover?.path?`<audio class="vpc-audio" src="${s.esc(s.mediaUrl(t.voiceover.path))}" controls preload="none"></audio>`:""}
  </div>`}function Nt(t,a){let o=t?.qa;if(!o||o.score==null)return"";let e=Number(o.score),s=e>=7?"good":e>=5?"warn":"bad",n=[`QA ${e}/10${o.verdict?` \xB7 ${o.verdict}`:""}${o.model?` \xB7 ${o.model}`:""}`,...o.issues||[]].join(`
`);return`<span class="vpc-qa is-${s}" title="${a.esc(n)}" aria-label="${a.esc(n)}">${e}</span>`}function _t(t,a){let o=t.shots||[];if(!o.some(n=>n.storyboard||(n.storyboardCandidates||[]).length))return"";let e=o.some(n=>!n.storyboard&&(n.storyboardCandidates||[]).length);return`<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${o.map((n,r)=>{let i=a.esc(n.id),l=(n.storyboardCandidates||[]).find(d=>d!==n.storyboard),m=n.storyboard||l;if(!m)return`<div class="vpc-sb is-empty"><span class="vpc-sb-n">${r+1}</span></div>`;let v=!n.storyboard&&l?`<div class="vpc-tile-actions">
        ${a.iconBtn("sb-approve",w.check,"Approve storyboard",`data-s="${i}" data-path="${a.esc(l)}"`,"is-go")}
        ${a.iconBtn("sb-reject",w.x,"Reject storyboard",`data-s="${i}" data-path="${a.esc(l)}"`)}
      </div>`:`<span class="vpc-badge">${w.check}</span>`;return`<div class="vpc-sb${n.storyboard?" is-approved":""}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${a.esc(m)}" aria-label="View storyboard ${r+1}">${a.thumb(m,"vpc-tile-img")}</button>
      <span class="vpc-sb-n">${r+1}</span>${v}</div>`}).join("")}</div>
    ${e?`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${w.check}<span>Approve all</span></button>`:""}
  </section>`}function Bt(t,a,o){if(!(t.shots||[]).length)return"";let e=t.voice||{},s=e.provider||"openai",n=Object.entries(ue).map(([k,x])=>`<optgroup label="${k==="xai"?"xAI":"OpenAI"}">${x.map(_=>`<option value="${k}:${_}"${k===s&&_===e.voice?" selected":""}>${_}</option>`).join("")}</optgroup>`).join(""),r=t.captions||{},i=t.music||null,l=i?/chill/i.test(i.label||i.path||"")?"chill":/pulse/i.test(i.label||i.path||"")?"pulse":"custom":"none",m=(t.shots||[]).some(k=>k.line),v=Math.round((i?.volume??.3)*100),d=(t.audioMode||"voiceover")==="native";return`<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    ${`<div class="vpc-row vpc-wrap" role="radiogroup" aria-label="Who speaks the lines">
      <span class="vpc-muted">Speech</span>
      ${[["native","On camera","The creator speaks each line in the clip; captions transcribe the clip audio"],["voiceover","Narrator","TTS voiceover over dialogue-free clips; captions follow the voiceover"]].map(([k,x,_])=>`<button type="button" class="vpc-chip${(d?"native":"voiceover")===k?" is-on":""}" data-vpa="audio-mode" data-v="${k}" role="radio" aria-checked="${(d?"native":"voiceover")===k}" title="${_}">${x}</button>`).join("")}
    </div>`}
    ${d?`<div class="vpc-row vpc-wrap"><button type="button" class="vpc-btn" data-vpa="transcribe" title="Re-read what each clip says for captions">${w.mic}<span>Transcribe clips</span></button></div>`:`<div class="vpc-row vpc-wrap">
      ${w.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${e.voice?"":'<option value="" selected>Pick a voice</option>'}${n}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${m?"":'disabled title="Add voiceover lines to shots first"'}>${w.mic}<span>Voiceover</span></button>
    </div>`}
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${r.enabled?" checked":""}><span>Captions</span></label>
      ${he.map(k=>`<button type="button" class="vpc-chip${(r.style||"bold")===k&&r.enabled?" is-on":""}" data-vpa="cap-style" data-v="${k}" aria-pressed="${(r.style||"bold")===k&&!!r.enabled}">${k}</button>`).join("")}
      ${r.cues?.length?`<span class="vpc-muted">${r.cues.length} cues</span>`:""}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[["pulse","Pulse"],["chill","Chill"],["none","None"]].map(([k,x])=>`<button type="button" class="vpc-chip${l===k?" is-on":""}" data-vpa="music" data-v="${k}" aria-pressed="${l===k}">${x}</button>`).join("")}
      ${l==="custom"?`<span class="vpc-chip is-on">${o.esc(i.label||"Custom")}</span>`:""}
      ${i?`<input class="vpc-range" type="range" min="0" max="100" value="${v}" data-vpf="volume" aria-label="Music volume" title="Music volume ${v}%">`:""}
    </div>
  </section>`}function qt(t,a,o){let e=[],s=t.lastRun;s?.steps?.length&&e.push(`<ol class="vpc-steps">${s.steps.map(r=>`<li class="is-${o.esc(r.state)}" title="${o.esc(r.note||r.state)}"><span class="vpc-dot"></span>${o.esc(r.step)}${r.note?` <small class="vpc-muted">${o.esc(String(r.note).slice(0,80))}</small>`:""}</li>`).join("")}</ol>`);let n=a.actPending||(s?.needsApproval?{action:"run",args:{},usd:s.needsApproval.usd,breakdown:s.needsApproval.breakdown}:null);if(n){let r=(n.breakdown||[]).map(i=>`<li>${o.esc(i.item)} \xB7 ${o.usd(i.usd)}</li>`).join("");e.push(`<div class="vpc-approve">
      <strong>${n.action==="storyboard"?"Storyboard":n.action==="run"?"Autopilot":o.esc(n.action)} needs approval \xB7 ${o.usd(n.usd)}</strong>
      ${r?`<ul>${r}</ul>`:""}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${w.check}<span>Approve ${o.usd(n.usd)}</span></button>
        ${o.iconBtn("act-cancel",w.x,"Cancel")}
      </div></div>`)}return(t.shots||[]).length&&e.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${a.busy?"disabled":""}>${w.rocket}<span>Run all</span></button>`),e.length?`<section class="vpc-sec"><h4>Autopilot</h4>${e.join("")}</section>`:""}function Vt(t,a,o){let e=(t.exports||[]).slice().reverse(),s=me.map(r=>`<button type="button" class="vpc-chip${a.aspects.has(r)?" is-on":""}" data-vpa="aspect" data-v="${r}" aria-pressed="${a.aspects.has(r)}">${r}</button>`).join(""),n=e.slice(0,6).map(r=>{let i=o.mediaUrl(r.path),l=[r.aspect,r.variant?`variant ${r.variant}`:"",`${Number(r.durationSec||0).toFixed(1)}s`].filter(Boolean).join(" \xB7 ");return`<div class="vpc-export">
      <video src="${o.esc(i)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${o.esc(l)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${o.esc(i)}" download="${o.esc(String(r.path).split("/").pop())}" title="Download" aria-label="Download">${w.download}</a>
        ${o.iconBtn("share",w.share,"Share",`data-path="${o.esc(r.path)}"`)}
      </div></div>`}).join("");return`<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${s}</div>
    ${n?`<div class="vpc-exports">${n}</div>`:""}</section>`}function xt(t="image/*"){return new Promise(a=>{let o=document.createElement("input");o.type="file",o.accept=t,o.style.display="none",o.addEventListener("change",()=>{let e=o.files&&o.files[0];if(o.remove(),!e)return a(null);let s=new FileReader;s.onload=()=>a({filename:e.name,dataBase64:String(s.result||"").replace(/^data:[^,]*,/,"")}),s.onerror=()=>a(null),s.readAsDataURL(e)}),document.body.appendChild(o),o.click()})}async function fe(t,a){let o=a.mediaUrl(t);try{o=new URL(o,location.href).href}catch{}if(navigator.share)try{return await navigator.share({title:"Video",url:o}),"Shared"}catch{return""}try{return await navigator.clipboard.writeText(o),"Link copied"}catch{return"Copy failed"}}async function Ft(t,a){let{st:o,d:e,act:s,ops:n,paint:r,h:i}=a,l=o.project||{},m=v=>(l.shots||[]).find(d=>d.id===v);switch(t){case"upload-product":case"upload-character":{let v=await xt();return v&&await s("import_asset",{...v,role:t==="upload-product"?"product":"character",name:v.filename.replace(/\.[^.]+$/,"")},"Uploading"),!0}case"storyboard":return await s("storyboard",{},"Storyboarding"),!0;case"sb-approve":return await n([{op:"shot.approveStoryboard",id:e.s,path:e.path}],"Approving storyboard"),!0;case"sb-reject":return await n([{op:"shot.rejectStoryboard",id:e.s,path:e.path}],"Rejecting"),!0;case"sb-approve-all":{let v=(l.shots||[]).filter(d=>!d.storyboard&&(d.storyboardCandidates||[]).length).map(d=>({op:"shot.approveStoryboard",id:d.id,path:d.storyboardCandidates[0]}));return v.length&&await n(v,"Approving storyboard"),!0}case"dur":{let v=m(e.s);if(!v)return!0;let d=Math.max(1,Math.min(30,(Number(v.durationSec)||5)+Number(e.d)));return await n([{op:"shot.update",id:e.s,durationSec:d}],"Saving"),!0}case"move":return await n([{op:"shot.move",id:e.s,index:Number(e.i)}],"Reordering"),!0;case"variants":return await s("render_variants",{shotId:e.s},"Rendering hook variants",900*1e3),!0;case"qa":return await s("qa",{},"Scoring takes",300*1e3),!0;case"voiceover":return await s("voiceover",{},"Recording voiceover",300*1e3),!0;case"audio-mode":return await n([{op:"project.update",audioMode:e.v}],e.v==="native"?"Using on-camera dialogue":"Using a narrator"),!0;case"transcribe":return await s("transcribe",{force:!0},"Transcribing clips",3e5)&&l.captions?.enabled&&await s("captions",{style:l.captions.style},"Rebuilding captions"),!0;case"cap-style":{let v=e.v;return await s("captions",{style:v},"Building captions")&&await n([{op:"captions.set",enabled:!0,style:v}],"Saving captions"),!0}case"music":return e.v==="none"?await n([{op:"music.clear"}],"Removing music"):await s("music",{builtin:e.v},"Adding music"),!0;case"run-all":return await s("run",{},"Running autopilot",1800*1e3),!0;case"act-approve":{let v=o.actPending||(l.lastRun?.needsApproval?{action:"run",args:{}}:null);return o.actPending=null,v&&await s(v.action,{...v.args||{},approved:!0},"Submitting",1800*1e3),!0}case"act-cancel":return o.actPending=null,l.lastRun&&(l.lastRun.needsApproval=void 0),r(),!0;case"aspect":return o.aspects.has(e.v)?o.aspects.delete(e.v):o.aspects.add(e.v),r(),!0;case"draw":{let v=await ve();if(!v)return!0;let d=await gt("What should this sketch become?","A cinematic scene at golden hour");return d&&await s("draw_to_video",{dataBase64:v,prompt:d},"Sketch to video",900*1e3),!0}case"recast":{let v=await xt("video/*");if(!v)return!0;let d=await s("import_asset",{...v,role:"footage"},"Uploading footage",300*1e3);if(!d?.assetPath)return!0;let S=await gt("Recast it as\u2026","New character, outfit, world or style");return S&&await s("recast",{sourcePath:d.assetPath,prompt:S,mode:"edit"},"Recasting",900*1e3),!0}case"talking-photo":{let v=await xt();if(!v)return!0;let d=await s("import_asset",{...v,role:"asset"},"Uploading portrait");if(!d?.assetPath)return!0;let S=await gt("What should they say?","Hey! You have to try this.");return S&&await s("talking_photo",{imagePath:d.assetPath,line:S},"Talking photo",900*1e3),!0}case"upscale":return await s("upscale",{},"Upscaling",900*1e3),!0;case"foley":return await s("foley",{},"Adding sound",900*1e3),!0;case"batch":return await s("batch_variants",{count:3,vary:["hook","creator"]},"Planning variants",300*1e3),!0;case"share":{let v=await fe(e.path,i);return v&&(o.error="",o.busy="",o.toast=v,r()),!0}default:return!1}}async function Ot(t,a){let{d:o,ops:e,value:s,checked:n,st:r}=a;switch(t){case"prompt":case"line":case"modelId":case"presetId":{let i=(r.project?.shots||[]).find(l=>l.id===o.s);if(i&&String(i[t]||"")===s)return;await e([{op:"shot.update",id:o.s,[t]:s}],"Saving");return}case"voice":{let[i,l]=String(s).split(":");l&&await e([{op:"voice.set",provider:i,voice:l}],"Setting voice");return}case"captions":{let i=r.project?.captions?.style||"bold";n&&!(r.project?.captions?.cues||[]).length&&await a.act("captions",{style:i},"Building captions"),await e([{op:"captions.set",enabled:!!n,style:i}],"Saving captions");return}case"volume":{let i=r.project?.music;i?.path&&await e([{op:"music.set",path:i.path,volume:Number(s)/100,duck:i.duck!==!1}],"Saving");return}default:}}var Dt=`
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
`;function be(t){return Array.isArray(t?.takes)?t.takes:[]}function at(t,a,o=[],e=[]){if(!t)return"setup";if(t.approvedAt)return"done";if(be(t).length||t.status==="generating")return"take";let s=!!(t.storyboard||t.startImage),n=!!t.chainFromPrevious&&a>0,r=t.anchorMode==="start"&&(t.characterIds||[]).some(i=>{let l=(e||[]).find(m=>m.id===i);return!!(l&&(l.anchors||[]).length)});return!s&&!n&&!r?"frame":"setup"}function ut(t){let a=t?.shots||[];for(let o=0;o<a.length;o++)if(at(a[o],o,a,t?.characters)!=="done")return o;return-1}function yt(t){let a=t?.shots||[];if(!a.length)return{label:"Add shots to get started",shotIndex:-1};let o=ut(t);if(o>=0){let e=at(a[o],o,a,t?.characters),s=o+1;return e==="frame"?{label:`Pick a start frame for shot ${s}`,shotIndex:o}:e==="take"?{label:`Review shot ${s}`,shotIndex:o}:{label:`Set up shot ${s}`,shotIndex:o}}return(t?.exports||[]).length?{label:"Watch the final cut",shotIndex:-1}:{label:"Render the final cut",shotIndex:-1}}function ot(t){let a=t?.limits||{};if(Array.isArray(a.durations)&&a.durations.length)return a.durations.slice().sort((n,r)=>n-r);if(a.minDurationSec==null&&a.maxDurationSec==null)return[];let o=Math.max(1,Math.ceil(a.minDurationSec??1)),e=Math.floor(a.maxDurationSec??10),s=[];for(let n=o;n<=e&&s.length<15;n++)s.push(n);return s}function Q(t){return t?.mode==="step"||t?.mode==="auto"?t.mode:t?.lastRun?"auto":"step"}var Ht=[["frame","Frame"],["setup","Setup"],["prompt","Prompt"],["take","Take"]],ge="\u2713",xe=new Set(["close","back","shot","cand","mode"]),wt=null,R=null,K=null,h=null,g={index:0,local:{},routed:!1,models:null,presets:null},st=null,Wt="";function W(){return h?.getProject?.()||null}function O(){return!!h?.getState?.().busy}function kt(){let t=h?.getState?.()||{};return t.models?.length?t.models:g.models||[]}function $e(t,a){return String(t?.label||a||"model").replace(/\s+via\s+fal$/i,"").replace(/\s*\(image→video\)$/i,"")}function ye(t,a){let o=t?ot(t):[];return o.length?o.reduce((e,s)=>Math.abs(s-a)<Math.abs(e-a)?s:e,o[0]):Number(a)}function we(t,a){let o=kt().find(n=>n.id===a.modelId),e=ye(o,Number(a.durationSec)),s=a.presetId?(g.presets||[]).find(n=>n.id===a.presetId)?.label||a.presetId:"";return`<span class="vps-chip">${y($e(o,a.modelId||"model"))}</span><span class="vps-chip">${y(e)}s</span>${s?`<span class="vps-chip">${y(s)}</span>`:""}${t.target?.aspect?`<span class="vps-chip">${y(t.target.aspect)}</span>`:""}`}function ke(t){return`price:${t.id}:${t.modelId||""}:${t.durationSec}`}function Se(t){if(typeof h?.h?.vpFetch!="function")return null;let a=ke(t),o=g.local[a];return o===void 0?(g.local[a]="pending",h.h.vpFetch(`/${encodeURIComponent(h.id)}/estimate`,{shotIds:[t.id]}).then(e=>{let s=Number(e?.total??e?.estimate?.total??e?.totalUsd);g.local[a]=Number.isFinite(s)&&s>=0?s:null}).catch(()=>{g.local[a]=null}).finally(()=>{R&&V()}),null):typeof o=="number"?o:null}function Yt(t){let a=Se(t);return a!=null?` \xB7 ${G(a)}`:""}async function Me(){let t=document.activeElement;if(!t||!R?.contains(t)||!t.matches?.("[data-vps-f]"))return;let a=W()?.shots?.[g.index],o=t.dataset.vpsF;!a||o!=="prompt"&&o!=="line"||String(a[o]??"")!==t.value&&await h.ops([{op:"shot.update",id:a.id,[o]:t.value}],"Saving")}async function Kt(){if(wt){let t=wt;wt=null,await t}await Me()}function y(t){return h?.h?.esc?h.h.esc(t):String(t??"").replace(/[&<>"]/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[a])}function G(t){return h?.h?.usd?h.h.usd(t):`$${Number(t||0).toFixed(2)}`}function J(t){return h?.h?.mediaUrl?h.h.mediaUrl(t):t}function Qt(t){return h?.h?.isVideo?h.h.isVideo(t):/\.(mp4|webm|mov)$/i.test(String(t||""))}function Ce(t,a){let o=t.shots[a];return g.local[o.id]==="prompt"&&at(o,a,t.shots,t.characters)!=="done"?"prompt":at(o,a,t.shots,t.characters)}function Ie(t){if(!t.shots.length){g.index=0;return}if(g.index<0||g.index>=t.shots.length){let a=ut(t);g.index=a>=0?a:t.shots.length-1}}function je(t,a){let o=(t.takes||[]).find(s=>s.id===t.selectedTakeId),e=o?.poster||o?.path||t.storyboard||(t.storyboardCandidates||[])[0];return e?Qt(e)&&!o?.poster?`<video class="vps-thumb" src="${y(J(e))}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="vps-thumb" src="${y(J(e))}" alt="" loading="lazy">`:'<span class="vps-thumb is-empty"></span>'}function Ae(t,a){return`<nav class="vps-rail" aria-label="Shot steps">${Ht.map(([o,e],s)=>{let n=o===t,r=a||Ht.findIndex(([i])=>i===t)>s;return`<span class="vps-pill${n?" is-on":""}${r&&!n?" is-done":""}">${r&&!n?ge+" ":""}${e}</span>`}).join("")}</nav>`}function Pe(t,a){return`<div class="vps-shots" role="list">${t.shots.map((o,e)=>{let s=!!o.approvedAt,n=e===a;return`<button type="button" role="listitem" class="vps-shot${n?" is-cur":""}" data-vps="shot" data-i="${e}" aria-label="Shot ${e+1}">
      ${je(o,t)}
      ${s?'<span class="vps-badge is-ok">\u2713</span>':n?'<span class="vps-badge is-cur">\u25CF</span>':""}
      <span class="vps-shot-n">${e+1}</span></button>`}).join("")}</div>`}function Jt(){let t=h.getState(),a=t.pending||t.actPending;if(!a)return"";let o=t.pending?t.pending.estimate?.total:a.usd;return`<div class="vps-approve" role="group" aria-label="Approve cost"><strong>Approve ${G(o)}?</strong>
    <p class="vps-muted">${y(t.pending?.reason||"This run is paid. Nothing is sent until you approve.")}</p>
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="approve-pending" ${O()?"disabled":""}>Approve &amp; run \xB7 ${G(o)}</button>
    <button type="button" class="vps-btn is-wide" data-vps="cancel-pending">Cancel</button></div></div>`}function Re(t,a,o){let e=o.storyboardCandidates||[],s=Math.min(g.local[`cand:${o.id}`]||0,Math.max(0,e.length-1)),n=t.shots[a-1],r=n&&(n.takes||[]).find(v=>v.id===n.selectedTakeId),i=a>0&&r?.kind==="video"?`<button type="button" class="vps-opt" data-vps="chain-frame" data-i="${a}" ${O()?"disabled":""}><span class="vps-opt-main"><span>Continue from last frame</span><small class="vps-muted">Seamless. Picks up exactly where shot ${a} ends</small></span><span class="vps-badge is-accent">Prom pick</span></button>`:"",l=e.length?`<div class="vps-car" data-vps-car="${y(o.id)}">${e.map((v,d)=>`
        <button type="button" class="vps-tile${d===s?" is-active":""}" data-vps="cand" data-k="${d}" data-path="${y(v)}" aria-label="Frame ${"ABCD"[d]||d+1}">
          <img src="${y(J(v))}" alt="" loading="lazy"><span class="vps-tag">${"ABCD"[d]||d+1}</span></button>`).join("")}</div>
       <div class="vps-dots">${e.map((v,d)=>`<span class="vps-dot${d===s?" is-on":""}"></span>`).join("")}</div>`:'<p class="vps-muted">No frames yet. Generate four stills to pick from.</p>',m=e[s]||"";return`<h3 class="vps-h">Pick a start frame</h3>${i?`<div class="vps-list">${i}</div><p class="vps-muted">or pick a new frame</p>`:""}${l}
    <form class="vps-field" data-vps-form="edit-frame"><input class="vps-input" name="instruction" placeholder="Change something in ${"ABCD"[s]||"A"}\u2026 (e.g. cash in hand)" aria-label="Edit frame"><button type="submit" class="vps-btn" aria-label="Apply edit" ${m?"":"disabled"}>\u21B5</button></form>
    <div class="vps-row vps-stack">
      <button type="button" class="vps-btn is-wide" data-vps="more-frames" data-i="${a}" ${O()?"disabled":""}>\u21BB 4 more</button>
      <button type="button" class="vps-btn is-primary is-wide" data-vps="use-frame" data-path="${y(m)}" ${m?"":"disabled"}>Use ${"ABCD"[s]||"A"} \u2192</button>
      ${i}
    </div>`}function ze(t,a,o){let e=h.getState(),s=kt().filter(x=>x.kind==="video"),n=s.find(x=>x.id===o.modelId)||s[0],r=g.routed&&g.pick?g.pick[o.id]:null,i=s.map(x=>`<button type="button" class="vps-opt${x.id===n?.id?" is-on":""}" data-vps="model" data-id="${y(x.id)}">
      <span class="vps-opt-main"><span>${y(x.label||x.id)}</span>
      <small class="vps-muted">${ot(x).join("/")}s${x.pricing?.perSecondUsd?` \xB7 $${x.pricing.perSecondUsd}/s`:""}</small></span>
      ${r===x.id?'<span class="vps-badge is-accent">Prom pick</span>':""}</button>`).join(""),l=ot(n||{}),m=Number(o.durationSec),d=(l.length?l:[m]).map(x=>`<button type="button" class="vps-chip${x===m?" is-on":""}" data-vps="length" data-d="${x}" ${O()?"disabled":""}>${x}s</button>`).join(""),k=(g.presets||[]).filter(x=>x.group==="camera").slice(0,8).map(x=>`<button type="button" class="vps-chip${x.id===o.presetId?" is-on":""}" data-vps="camera" data-id="${y(x.id)}">${y(x.label)}</button>`).join("");return`<h3 class="vps-h">Model <span class="vps-muted">\xB7 Prom pre-picked</span></h3>
    <div class="vps-list">${i||'<p class="vps-muted">Loading models\u2026</p>'}</div>
    <h3 class="vps-h">Length</h3><div class="vps-chips">${d}</div>
    ${k?`<h3 class="vps-h">Camera</h3><div class="vps-chips">${k}</div>`:""}
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="next-step" data-to="prompt">Next \xB7 Prompt \u2192</button></div>`}function Ue(t,a,o){let e=(o.takes||[]).length;return`<h3 class="vps-h">Prompt</h3>
    <textarea class="vps-text" data-vps-f="prompt" data-s="${y(o.id)}" rows="4" aria-label="Shot prompt">${y(o.prompt||"")}</textarea>
    <input class="vps-input" data-vps-f="line" data-s="${y(o.id)}" value="${y(o.line||"")}" placeholder="Spoken line (optional)" aria-label="Spoken line">
    <div class="vps-chips">${we(t,o)}</div>
    ${Jt()}
    ${h.getState().pending||h.getState().actPending?"":`<button type="button" class="vps-btn is-primary is-wide" data-vps="generate" data-s="${y(o.id)}" ${O()?"disabled":""}>Generate${e?" again":""}${Yt(o)}</button>`}`}function Ee(t,a,o){let e=o.takes||[],s=e.find(v=>v.id===o.selectedTakeId)||e[e.length-1],n=o.status==="generating"||(h.running?.()||[]).some(v=>v.target?.shotId===o.id);if(n&&!s)return'<div class="vps-wait"><span class="vps-spin"></span> Generating\u2026 usually 1-3 min</div>';let r=s?.qa?`QA ${Number(s.qa.score).toFixed(1)} \xB7 ${String(s.qa.verdict||"").toUpperCase()}`:"",i=s?Qt(s.path)?`<video class="vps-player" src="${y(J(s.path))}" poster="${y(s.poster?J(s.poster):"")}" controls playsinline preload="metadata"></video>`:`<img class="vps-player" src="${y(J(s.path))}" alt="">`:'<p class="vps-muted">No take yet.</p>',l=e.map((v,d)=>`<button type="button" class="vps-chip${v.id===s?.id?" is-on":""}" data-vps="take" data-s="${y(o.id)}" data-t="${y(v.id)}">Take ${d+1}</button>`).join(""),m=!!o.approvedAt;return`<h3 class="vps-h">Take ${e.indexOf(s)+1||e.length} ${r?`<span class="vps-muted">${y(r)}</span>`:""}</h3>
    ${i}<div class="vps-chips">${l}</div>
    <form class="vps-field" data-vps-form="redo-note"><input class="vps-input" name="note" placeholder="What should change? (e.g. slower hand)" aria-label="Change note"><button type="submit" class="vps-btn" aria-label="Redo with note">\u21B5</button></form>
    ${n?'<div class="vps-wait"><span class="vps-spin"></span> Generating\u2026 usually 1-3 min</div>':""}
    <div class="vps-row vps-stack">
      <button type="button" class="vps-btn is-wide" data-vps="redo" data-s="${y(o.id)}" ${n||O()?"disabled":""}>\u21BB Redo${Yt(o)}</button>
      ${m?`<button type="button" class="vps-btn is-wide" data-vps="unkeep" data-s="${y(o.id)}">Unkeep</button>`:`<button type="button" class="vps-btn is-primary is-wide" data-vps="keep" data-s="${y(o.id)}" ${s?"":"disabled"}>Keep \u2713</button>`}
    </div>
    ${Jt()}`}function Te(t,a){let o=t.shots[a],e=t.shots[a+1];if(!e)return`<div class="vps-after"><h3 class="vps-h">Shot ${a+1} kept \u2713</h3>
      <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="render">Render the final cut</button></div></div>`;let s=!!e.storyboard;return`<div class="vps-after"><h3 class="vps-h">Shot ${a+1} kept \u2713</h3>
    <p class="vps-muted">How should shot ${a+2} start?</p>
    <div class="vps-list">
      <button type="button" class="vps-opt" data-vps="after-start" data-mode="chain" data-i="${a+1}"><span>Continue from last frame</span><span class="vps-badge is-accent">Prom pick</span></button>
      <button type="button" class="vps-opt" data-vps="after-start" data-mode="new" data-i="${a+1}"><span>New start frame</span></button>
      ${s?`<button type="button" class="vps-opt" data-vps="after-start" data-mode="still" data-i="${a+1}"><span>Use storyboard still</span></button>`:""}
    </div>
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="goto" data-i="${a+1}">Go to shot ${a+2} \u2192</button></div></div>`}function Le(t){if(Q(t)==="auto"&&!(t.lastRun&&t.lastRun.state==="running"))return Ne(t);if(!t.shots.length)return'<p class="vps-muted">No shots yet. Ask Prom to plan the shot list, then come back here.</p>';Ie(t);let o=g.index,e=t.shots[o],s=Ce(t,o),n=s==="frame"?Re(t,o,e):s==="setup"?ze(t,o,e):s==="prompt"?Ue(t,o,e):s==="done"?Te(t,o):Ee(t,o,e),r=`${e.id}:${s}`;return`${Ae(s==="done"?"take":s,s==="done")}
    <div class="vps-step" data-vps-step="${y(r)}">${n}</div>`}function Ne(t){let a=g.plan||{},o=t.shots.map((n,r)=>`<div class="vps-sl"><span class="vps-thumb is-empty"></span>
    <span><strong>${r+1}. ${y(n.title||"Shot")}</strong><small class="vps-muted">${y(n.modelId||t.defaults?.videoModel||"model")} \xB7 ${n.durationSec}s</small></span>
    <span class="vps-muted">${G(a.perShot?.[n.id])}</span></div>`).join(""),e=a.total??0,s=t.budget?.capUsd;return`<h3 class="vps-h">Autopilot plan <span class="vps-muted">\xB7 needs your OK</span></h3>
    <div class="vps-list">${o}</div>
    <p class="vps-muted">+ frames, QA rerolls (1 max), music</p>
    <p><strong>Total ${G(e)}</strong>${s!=null?` / ${G(s)} cap`:""}</p>
    <p class="vps-muted">I only stop early if a shot fails QA twice or the run would go over the cap.</p>
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="run-approve" ${O()?"disabled":""}>${e>0?`Approve &amp; run \xB7 ${G(e)}`:"Get quote &amp; run"}</button>
    <button type="button" class="vps-btn is-wide" data-vps="mode" data-to="step">Switch to step-by-step</button></div>`}function _e(t){let a=Q(t),o=t.shots.length,e=Math.min(g.index,Math.max(0,o-1)),s=a==="auto"?'<button type="button" class="vps-chip" data-vps="mode" data-to="step">Step-by-step</button>':'<button type="button" class="vps-chip" data-vps="mode" data-to="auto">\u26A1 Auto</button>';return`<header class="vps-top">
    <button type="button" class="vps-icon-btn" data-vps="back" aria-label="Previous shot" ${e>0?"":"disabled"}>\u2039</button>
    <div class="vps-title"><strong>${y(t.title||"Video project")}</strong><small class="vps-muted">${o?`Shot ${e+1} of ${o}`:"No shots"}</small></div>
    ${s}
    <button type="button" class="vps-icon-btn" data-vps="close" aria-label="Close">\u2715</button>
  </header>`}function V(){if(!R)return;let t=W();if(!t)return;let a=h.getState(),o=a.error?`<p class="vps-err">${y(a.error)}</p>`:"",e=a.busy?`<div class="vps-busy"><span class="vps-spin"></span>${y(a.busy)}\u2026</div>`:"",s=t.shots.length?Pe(t,Math.min(g.index,t.shots.length-1)):"";R.innerHTML=`${_e(t)}${s}${e}${o}<div class="vps-body">${Le(t)}</div>`,R.dataset.vpsFor=h.id}async function Be(){if(g.models||(g.models=await vt(h.h).catch(()=>[]),V()),g.presets||(g.presets=await lt(h.h).catch(()=>[]),V()),!g.routed){g.routed=!0;let t=await h.route?.(),a=t?.picks||t?.routes||[];g.pick={};for(let o of a)o.shotId&&o.modelId&&(g.pick[o.shotId]=o.modelId);V()}if(Q(W())==="auto"&&!g.plan){let t=await h.h.vpFetch(`/${encodeURIComponent(h.id)}/action`,{action:"run_cost"}).catch(()=>null);g.plan={total:Number(t?.totalUsd??t?.total??0),perShot:{}},V()}}function ht(t){g.index=t,V()}async function qe(t){let a=t.dataset,o=W();if(!o)return;let e=o.shots[g.index],s=e?.id;switch(a.vps){case"close":return X();case"back":return ht(Math.max(0,g.index-1));case"shot":return ht(Number(a.i)||0);case"goto":return ht(Number(a.i)||0);case"mode":await h.ops([{op:"project.update",mode:a.to}],"Switching");return;case"cand":return g.local[`cand:${s}`]=Number(a.k)||0,V();case"use-frame":await h.ops([{op:"shot.approveStoryboard",id:s,path:a.path}],"Keeping frame");return;case"chain-frame":{let n=[{op:"shot.update",id:s,chainFromPrevious:!0}];(e.storyboard||e.startImage)&&(n[0]={...n[0],storyboard:"",startImage:""}),await h.ops(n,"Continuing from last frame");return}case"more-frames":return h.act("storyboard",{shotIds:[s],count:4},"Generating frames");case"model":{let n=kt().find(l=>l.id===a.id),r=n?ot(n):[],i=[{op:"shot.update",id:s,modelId:a.id}];return r.length&&!r.includes(Number(e.durationSec))&&(i[0].durationSec=r.reduce((l,m)=>Math.abs(m-e.durationSec)<Math.abs(l-e.durationSec)?m:l,r[0])),h.ops(i,"Setting model")}case"length":return h.ops([{op:"shot.update",id:s,durationSec:Number(a.d)}],"Setting length");case"camera":return h.ops([{op:"shot.update",id:s,presetId:a.id}],"Setting camera");case"next-step":return g.local[s]=a.to,V();case"generate":case"redo":return await Kt(),h.generate("/generate",{shotIds:[s],count:1},"Estimating");case"take":return h.ops([{op:"take.select",shotId:s,takeId:a.t}],"Swapping take");case"keep":return h.ops([{op:"shot.approve",id:s}],"Keeping");case"unkeep":return h.ops([{op:"shot.unapprove",id:s}],"Unkeeping");case"after-start":{let n=Number(a.i)||0,r=o.shots[n];if(!r)return;if(a.mode==="chain"){let i=[{op:"shot.update",id:r.id,chainFromPrevious:!0}];(r.storyboard||r.startImage)&&(i[0]={...i[0],storyboard:"",startImage:""}),await h.ops(i,"Chaining")}else a.mode==="new"&&await h.ops([{op:"shot.update",id:r.id,chainFromPrevious:!1}],"Setting start");return ht(n)}case"render":return h.render();case"approve-pending":return h.approve();case"cancel-pending":return h.cancel();case"run-approve":return await Kt(),h.act("run",{},"Starting autopilot");default:return}}var Gt="prom-vp-studio-style",Ve=`
.vps-scrim{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);opacity:0;transition:opacity .25s ease}
.vps-scrim.is-on{opacity:1}
.vps-sheet{position:fixed;z-index:9999;display:flex;flex-direction:column;gap:10px;overflow:hidden;color:var(--prom-text,currentColor);background:var(--prom-surface,#15161a);font-size:14px;line-height:1.4;box-sizing:border-box;padding:12px;transition:transform .28s cubic-bezier(.2,.8,.2,1)}
.vps-sheet *{box-sizing:border-box}
.vps-sheet[data-vps-open]{transform:none}
@media (max-width:700px){
  .vps-sheet{inset:0;border-radius:0;transform:translateY(100%)}
  .vps-sheet[data-vps-open]{transform:none}
}
@media (min-width:701px){
  .vps-sheet{top:0;right:0;bottom:0;width:min(440px,46vw);border-radius:20px 0 0 20px;transform:translateX(100%);border-left:1px solid var(--prom-border,rgba(127,127,127,.25))}
}
.vps-top{display:flex;align-items:center;gap:8px;min-height:40px}
.vps-title{flex:1;min-width:0;display:flex;flex-direction:column;text-align:center}
.vps-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vps-icon-btn{min-width:40px;min-height:40px;border-radius:999px;border:0;background:var(--prom-surface-secondary,rgba(127,127,127,.12));color:inherit;font:inherit;font-size:18px;cursor:pointer;transition:background .25s ease}
.vps-icon-btn:disabled{opacity:.35;cursor:default}
.vps-muted{color:var(--prom-muted,#8a8a8a);font-size:12px}
.vps-shots{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x proximity;padding:2px 0 6px}
.vps-shot{position:relative;flex:none;width:72px;aspect-ratio:9/12;border-radius:12px;border:1px solid var(--prom-border,rgba(127,127,127,.25));overflow:hidden;background:var(--prom-surface-secondary,rgba(127,127,127,.1));padding:0;scroll-snap-align:start;cursor:pointer;transition:border-color .25s ease}
.vps-shot.is-cur{border-color:var(--prom-accent,#ff7a1a);box-shadow:0 0 0 1px var(--prom-accent,#ff7a1a)}
.vps-thumb{display:block;width:100%;height:100%;object-fit:cover}
.vps-thumb.is-empty{background:var(--prom-surface-secondary,rgba(127,127,127,.1))}
.vps-shot-n{position:absolute;left:4px;bottom:4px;font-size:11px;padding:1px 6px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff}
.vps-shots .vps-badge{position:absolute;top:4px;right:4px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;background:var(--prom-accent,#ff7a1a);color:#fff}
.vps-badge.is-ok{background:var(--prom-success,#2eaa5c)}
.vps-rail{display:flex;gap:6px;flex-wrap:wrap}
.vps-pill{min-height:28px;padding:4px 12px;border-radius:999px;font-size:12px;border:1px solid var(--prom-border,rgba(127,127,127,.25));color:var(--prom-muted,#8a8a8a);transition:all .25s ease}
.vps-pill.is-on{background:var(--prom-accent,#ff7a1a);border-color:transparent;color:#fff;font-weight:600}
.vps-pill.is-done{color:var(--prom-text,currentColor)}
.vps-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.vps-step{animation:vps-in .25s ease both;display:flex;flex-direction:column;gap:10px}
@keyframes vps-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.vps-h{margin:4px 0 0;font-size:15px;font-weight:600}
.vps-car{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 2px;scrollbar-width:none}
.vps-tile{position:relative;flex:0 0 min(62vw,220px);aspect-ratio:9/16;border-radius:16px;overflow:hidden;border:2px solid transparent;padding:0;background:var(--prom-surface-secondary,rgba(127,127,127,.1));scroll-snap-align:center;opacity:.5;transform:scale(.9);transition:transform .25s ease,opacity .25s ease,border-color .25s ease;cursor:pointer}
.vps-tile.is-active{opacity:1;transform:none;border-color:var(--prom-accent,#ff7a1a)}
.vps-tile img{width:100%;height:100%;object-fit:cover}
.vps-tag{position:absolute;left:8px;top:8px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px}
.vps-dots{display:flex;gap:6px;justify-content:center}
.vps-dot{width:6px;height:6px;border-radius:999px;background:var(--prom-border,rgba(127,127,127,.4))}
.vps-dot.is-on{background:var(--prom-accent,#ff7a1a)}
.vps-field{display:flex;gap:8px}
.vps-input,.vps-text{flex:1;min-height:40px;border-radius:12px;border:1px solid var(--prom-border,rgba(127,127,127,.25));background:var(--prom-surface-secondary,rgba(127,127,127,.08));color:inherit;padding:8px 12px;font:inherit}
.vps-text{min-height:96px;resize:vertical}
.vps-btn{min-height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--prom-border,rgba(127,127,127,.25));background:var(--prom-surface-secondary,rgba(127,127,127,.12));color:inherit;font:inherit;cursor:pointer;transition:background .25s ease,opacity .25s ease}
.vps-btn:disabled{opacity:.45;cursor:default}
.vps-btn.is-primary{background:var(--prom-accent,#ff7a1a);border-color:transparent;color:#fff;font-weight:600}
.vps-btn.is-wide{width:100%}
.vps-stack{flex-direction:column;align-items:stretch}
.vps-list{display:flex;flex-direction:column;gap:8px}
.vps-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:40px;padding:10px 12px;border-radius:16px;border:1px solid var(--prom-border,rgba(127,127,127,.25));background:var(--prom-surface,transparent);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .25s ease}
.vps-opt.is-on{border-color:var(--prom-accent,#ff7a1a)}
.vps-opt-main{display:flex;flex-direction:column}
.vps-chips{display:flex;gap:6px;flex-wrap:wrap}
.vps-chip{min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--prom-border,rgba(127,127,127,.25));background:transparent;color:inherit;font:inherit;cursor:pointer;transition:all .25s ease}
.vps-chip.is-on{background:var(--prom-accent,#ff7a1a);border-color:transparent;color:#fff}
.vps-sl{display:flex;gap:10px;align-items:center;padding:8px;border-radius:16px;border:1px solid var(--prom-border,rgba(127,127,127,.25))}
.vps-sl .vps-thumb{width:48px;height:64px;border-radius:10px;flex:none}
.vps-approve{border:1px solid var(--prom-accent,#ff7a1a);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:8px}
.vps-player{display:block;width:100%;aspect-ratio:9/16;max-height:60vh;border-radius:16px;background:var(--prom-surface-secondary,rgba(127,127,127,.1));object-fit:contain}
.vps-wait,.vps-busy{display:flex;gap:8px;align-items:center;color:var(--prom-muted,#8a8a8a);font-size:12px}
.vps-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--prom-border,rgba(127,127,127,.3));border-top-color:var(--prom-accent,#ff7a1a);animation:vps-spin .8s linear infinite;flex:none}
@keyframes vps-spin{to{transform:rotate(360deg)}}
.vps-err{margin:0;color:var(--prom-danger,#e5484d);font-size:12px}
@media (prefers-reduced-motion:reduce){
  .vps-sheet,.vps-scrim,.vps-step,.vps-tile,.vps-shot,.vps-pill,.vps-chip,.vps-btn,.vps-opt,.vps-spin{transition:none!important;animation:none!important}
}
`;function Fe(){if(typeof document>"u"||document.getElementById(Gt))return;let t=document.createElement("style");t.id=Gt,t.textContent=Ve,document.head.appendChild(t)}function Oe(t){t.key==="Escape"&&(t.preventDefault(),X())}function De(t){let a=t.target.closest?.("[data-vps]");!a||!R.contains(a)||a.disabled||O()&&!xe.has(a.dataset.vps)||(t.preventDefault(),qe(a))}function He(t){let a=t.target.closest?.("[data-vps-form]");if(!a||(t.preventDefault(),O()))return;let o=a.dataset.vpsForm,s=W()?.shots?.[g.index];if(!s)return;let n=a.querySelector("input"),r=String(n?.value||"").trim();if(r){if(o==="edit-frame"){let i=s.storyboardCandidates||[],l=Math.min(g.local[`cand:${s.id}`]||0,Math.max(0,i.length-1));h.act("storyboard",{shotIds:[s.id],count:1,editFrom:i[l],instruction:r},"Editing frame")}else if(o==="redo-note"){let i=`${s.prompt||""} ${r}`.trim();h.ops([{op:"shot.update",id:s.id,prompt:i}],"Saving note").then(()=>h.generate("/generate",{shotIds:[s.id],count:1},"Estimating"))}}}function Ke(t){let a=t.target.closest?.("[data-vps-f]");if(!a||!R.contains(a))return;let e=W()?.shots?.[g.index],s=a.dataset.vpsF;!e||s!=="prompt"&&s!=="line"||h.ops([{op:"shot.update",id:e.id,[s]:a.value}],"Saving")}function Xt(){if(!(!R||!h)){if(!h.el?.isConnected){X();return}R.contains(document.activeElement)&&document.activeElement?.matches?.("input,textarea")||V()}}function Zt(t,a={}){if(typeof document>"u")return;Fe(),R&&X(),h=t,g={index:0,local:{},routed:!1,models:null,presets:null,pick:{},plan:null};let o=W();if(a.shotIndex!=null)g.index=Number(a.shotIndex)||0;else if(o){let e=ut(o);g.index=e>=0?e:0}K=document.createElement("div"),K.className="vps-scrim",R=document.createElement("div"),R.className="vps-sheet",R.setAttribute("role","dialog"),R.setAttribute("aria-modal","true"),R.setAttribute("aria-label","Video studio"),document.body.appendChild(K),document.body.appendChild(R),Wt=document.body.style.overflow,document.body.style.overflow="hidden",K.addEventListener("click",X),R.addEventListener("click",De),R.addEventListener("submit",He),R.addEventListener("change",Ke),st=Oe,document.addEventListener("keydown",st),V(),requestAnimationFrame?.(()=>{K?.classList.add("is-on"),R?.setAttribute("data-vps-open","")}),Be()}function X(){st&&document.removeEventListener("keydown",st),st=null;let t=h?.onClose;R?.remove(),K?.remove(),R=null,K=null,typeof document<"u"&&(document.body.style.overflow=Wt),h=null,typeof t=="function"&&t()}function te(){R&&h&&h.el&&!h.el.isConnected&&X()}var ee="prom-vp-card-style",Ge=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",ft=new Map,rt=new Map,nt=typeof IntersectionObserver=="function"?new IntersectionObserver(t=>{for(let a of t){let o=a.target.__vpCard;o&&(o.visible=a.isIntersecting,o.visible&&!o.loaded?(o.loaded=!0,bt(o.id)):o.visible&&!o.wasVisible?bt(o.id):At(o.id),o.wasVisible=o.visible)}},{rootMargin:"120px"}):null;function At(t){let a=rt.get(t);if(!a)return;clearTimeout(a.timer);for(let e of a.cards)e.el.isConnected||(a.cards.delete(e),nt?.unobserve(e.el),delete e.el.__vpCard);if(!a.cards.size){rt.delete(t);return}(ft.get(t)?.project?.jobs||[]).some(e=>e.state==="queued"||e.state==="running")&&[...a.cards].some(e=>e.visible)&&(a.timer=setTimeout(()=>{bt(t)},3500))}async function bt(t){let a=rt.get(t);if(a)return a.request||(a.request=F(`/${encodeURIComponent(t)}`).then(o=>{o.project&&ft.set(t,{project:o.project,history:o.history,at:Date.now()});for(let e of a.cards)e.update(o)}).catch(o=>{for(let e of a.cards)e.update(null,o)}).finally(()=>{a.request=null,At(t)})),a.request}var L=(t,a="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${a}>${t}</svg>`,I={film:L('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:L('<path d="M5 12l5 5L20 7"/>'),x:L('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:L('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:L('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:L('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:L('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:L('<path d="M7 4v16l13-8z"/>'),seq:L('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:L('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:L('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:L('<path d="M6 9l6 6 6-6"/>'),user:L('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:L('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:L('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function b(t){return String(t??"").replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a])}function q(t){return`$${(Number(t)||0).toFixed(2)}`}function mt(t){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(t||""))}function St(t){return String(t||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function Z(t){let a=String(t||"").trim();if(!a)return"";if(/^(https?:|data:|blob:)/i.test(a))return a;let o=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof o=="function")try{let e=o(a);if(e)return String(e)}catch{}if(typeof window<"u"&&document.body?.classList?.contains("pm-mobile-active")){let e=String(window.__pmMobileActiveGatewayOrigin||window.location?.origin||"").replace(/\/+$/,""),s=String(window.__pmMobileActiveGatewayToken||"").trim();if(!s&&e===String(window.location?.origin||""))try{s=String(localStorage.getItem("pm_device_token")||"").trim()}catch{}let n=new URLSearchParams({path:a});return s&&n.set("pt",s),`${e}/api/canvas/inline?${n}`}return`/api/canvas/inline?path=${encodeURIComponent(a)}`}async function F(t,a,o=2e4){let e={method:a===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:a===void 0?void 0:JSON.stringify(a),timeoutMs:o},s=`/api/video-projects${t}`,n=window.__promVideoProjectFetch||window.api,r;if(typeof n=="function")r=await n(s,e);else{let i=await fetch(s,e);r=await i.json().catch(()=>({success:!1,error:`HTTP ${i.status}`}))}if(r&&r.success===!1)throw new Error(r.error||"Request failed");return r||{}}function Mt(t){let a=t?.takes||[];return a.length?a.find(o=>o.id===t.selectedTakeId)||a[a.length-1]:null}function Ct(t,a="vpc-thumb"){if(!t)return`<span class="${a} is-empty">${I.film}</span>`;let o=b(Z(t));return mt(t)?`<video class="${a}" src="${o}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${a}" src="${o}" alt="" loading="eager" decoding="async">`}function N(t,a,o,e="",s=""){return`<button type="button" class="vpc-icon${s?` ${s}`:""}" data-vpa="${t}" title="${b(o)}" aria-label="${b(o)}" ${e}>${a}</button>`}function We(t){t.dataset.vpMounted="1";let a=String(t.dataset.vpProject||""),o=ft.get(a),e={project:o?.project||null,history:o?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1,actPending:null,models:[],aspects:new Set,toast:""},s={esc:b,usd:q,isVideo:mt,mediaUrl:Z,thumb:Ct,iconBtn:N,vpFetch:F},n=()=>t.isConnected,r={el:t,id:a,visible:!nt,wasVisible:!nt,loaded:!nt,update:async(c,p)=>{n()&&(c&&l(c),e.error=p?String(p?.message||p):"",r.visible&&(await k(),B()))}},i=rt.get(a)||{cards:new Set,timer:null,request:null};i.cards.add(r),rt.set(a,i),t.__vpCard=r,nt?.observe(t);function l(c){c?.project&&(e.project=c.project),c?.history&&(e.history=c.history),e.project&&ft.set(a,{project:e.project,history:e.history,at:Date.now()})}async function m(){n()&&await bt(a)}function v(){return(e.project?.jobs||[]).filter(c=>c.state==="queued"||c.state==="running")}function d(){At(a)}function S(){let c=new Set(v().map(p=>p.target?.shotId).filter(Boolean));return(e.project?.shots||[]).filter(p=>!(p.takes||[]).length&&!c.has(p.id))}async function k(){let c=S(),p=c.map(f=>`${f.id}:${f.modelId||""}:${f.durationSec}:${(f.characterIds||[]).join(",")}`).join("|")+`#${(e.project?.characters||[]).map(f=>(f.anchors||[]).length).join(",")}`;if(!c.length){e.estimate=null,e.estimateKey="";return}if(!(p===e.estimateKey&&e.estimate))try{e.estimate=await F(`/${encodeURIComponent(a)}/estimate`,{shotIds:c.map(f=>f.id)}),e.estimateKey=p}catch(f){e.estimate=null,e.error=String(f?.message||f)}}async function x(c,p){e.busy=c,e.error="",B();try{let f=await p();return l(f),f}catch(f){return e.error=String(f?.message||f),null}finally{e.busy="",B()}}async function _(c,p){await x(p,()=>F(`/${encodeURIComponent(a)}/ops`,{ops:c})),await m()}async function tt(c,p={},f="Working",$=12e4){let u=await x(f,()=>F(`/${encodeURIComponent(a)}/action`,{action:c,...p},$));if(!u)return null;let U=u.needsApproval;if(U){let z=u.lastRun?.needsApproval,E=u.shotId?{...p,pendingShotId:u.shotId}:p;E.pendingShotId&&E.dataBase64&&delete E.dataBase64,e.actPending={action:c,args:E,usd:Number(z?.usd??U?.usd??u.estimateUsd??u.totalUsd??u.estimate?.total??0),breakdown:z?.breakdown||U?.breakdown||u.breakdown||[]}}else e.actPending=null;return e.estimateKey="",await m(),u}async function et(c,p,f){let $=await x(f,()=>F(`/${encodeURIComponent(a)}${c}`,p,12e4));if($){if($.needsApproval){e.pending={path:c,body:{...p,approved:!0},label:f,reason:$.reason,estimate:$.estimate},B();return}e.pending=null,e.estimateKey="",await m()}}async function Pt(){let c=e.project;if(!c)return;let p=(c.clips||[]).some(f=>f.source&&"shotId"in f.source);if(e.rendering=!0,e.aspects.size){await tt("render",{aspects:[...e.aspects]},"Rendering",900*1e3),e.rendering=!1,await m();return}if(!p&&!await x("Assembling",()=>F(`/${encodeURIComponent(a)}/ops`,{ops:[{op:"timeline.assemble"}]}))){e.rendering=!1,B();return}await x("Rendering",()=>F(`/${encodeURIComponent(a)}/render`,{},900*1e3)),e.rendering=!1,await m()}function oe(c,p){let f=Z(c);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:f,path:c,name:p||c.split("/").pop(),kind:mt(c)?"video":"image"});return}catch{}window.open(f,"_blank","noopener")}function se(c){let p=`${N("upload-product",w.box,"Upload product photo")}${N("upload-character",w.userPlus,"Upload character photo")}${Et(s)}`;if(!(c.characters||[]).length)return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${p}</h4></section>`;let f=v().filter(u=>u.target?.characterId),$=c.characters.map(u=>{let U=f.some(C=>C.target.characterId===u.id),z=(u.anchors||[])[0],E=u.candidates||[],j=z?"Anchor approved":E.length?"Pick an anchor":U?"Generating anchor":"No anchor yet",A=[z?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${b(z)}" aria-label="View anchor">${Ct(z,"vpc-tile-img")}</button><span class="vpc-badge">${I.check}</span></div>`:"",...E.map(C=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${b(C)}" aria-label="View candidate">${Ct(C,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${N("approve-anchor",I.check,"Approve as anchor",`data-c="${b(u.id)}" data-path="${b(C)}"`,"is-go")}
            ${N("reject-anchor",I.x,"Reject",`data-c="${b(u.id)}" data-path="${b(C)}"`)}
          </div>
        </div>`),U?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${I.user}<strong>${b(u.name)}</strong>${Tt(u)}</span>
          <span class="vpc-muted">${b(j)}</span>
          <span class="vpc-grow"></span>
          ${u.anchorPrompt?N("reroll",I.reroll,"Generate another anchor",`data-c="${b(u.id)}"`):""}
        </div>
        ${A?`<div class="vpc-strip">${A}</div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${p}</h4>${$}</section>`}function ne(c){let p=c.shots||[];if(!p.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let f=new Set(v().map(u=>u.target?.shotId).filter(Boolean)),$=p.map((u,U)=>{let z=Mt(u),E=f.has(u.id),j=e.openShot===u.id,A=(u.takes||[]).length,C=j?(u.takes||[]).slice().reverse().map(M=>`
        <div class="vpc-take${M.id===z?.id?" is-selected":""}">
          ${mt(M.path)?`<video src="${b(Z(M.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${b(Z(M.path))}" alt="" loading="eager">`}
          <div class="vpc-row">
            ${Nt(M,s)}<span class="vpc-muted">${b(St(M.modelId))} \xB7 ${q(M.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${M.id===z?.id?`<span class="vpc-inuse">${I.check}In cut</span>`:N("use-take",I.check,"Use this take",`data-s="${b(u.id)}" data-t="${b(M.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${j?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${b(u.id)}" aria-expanded="${j}">
          ${E&&!z?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':$t(u,z,c,s)}
          <span class="vpc-shot-meta">
            <strong>${U+1}. ${b(u.title||"Shot")}${Ut(u,z)}</strong>
            <small>${b(String(u.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${E?"generating":b(u.status)}">${E?"generating":b(u.status)} \xB7 ${u.durationSec}s \xB7 ${A} take${A===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${I.chevron}</span>
        </button>
        ${j?`<div class="vpc-shot-body">
          ${Lt(u,U,p.length,e,s)}
          ${u.camera?`<p class="vpc-muted">Camera: ${b(u.camera)}</p>`:""}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${b(u.id)}" data-n="1" ${E?"disabled":""}>${I.reroll}<span>${A?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${b(u.id)}" data-n="3" ${E?"disabled":""}>${I.layers}<span>3 variations</span></button>
          </div>
          ${C?`<div class="vpc-takes">${C}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${p.length}</span></h4>${$}</section>`}function re(c){let p=[];if(e.pending){let A=(e.pending.estimate?.shots||[]).map(C=>`<li>${b(C.title||"Item")}: ${C.count}\xD7 ${b(St(C.modelId))} \xB7 ${q(C.usd)}</li>`).join("");p.push(`<div class="vpc-approve">
        <strong>Approve ${q(e.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${b(e.pending.reason||"")}</p>
        ${A?`<ul>${A}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${I.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${I.x}<span>Cancel</span></button>
        </div>
      </div>`)}let f=S(),$=e.estimate;if(!e.pending&&f.length&&$){let A=($.shots||[]).flatMap(M=>(M.problems||[]).map(Y=>`${M.title}: ${Y}`)),C=(c.characters||[]).some(M=>!(M.anchors||[]).length&&(M.candidates||[]).length);p.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${f.length} shot${f.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${q($.total)}</strong></div>
        ${C?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${A.length?`<ul class="vpc-warn">${A.map(M=>`<li>${b(M)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${C?"disabled":""}>${I.spark}<span>${$.total>(c.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${q($.total)}</span></button>
      </div>`)}let u=v();u.length&&p.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${u.length} job${u.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let U=(c.jobs||[]).filter(A=>A.state==="failed").slice(-2);U.length&&!u.length&&p.push(`<ul class="vpc-warn">${U.map(A=>`<li>${b(St(A.modelId))} failed: ${b(String(A.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let z=c.shots||[],E=z.length&&z.every(A=>Mt(A)),j=(c.exports||[]).slice(-1)[0];return(E||j)&&p.push(`<div class="vpc-final">
        ${j?`<video src="${b(Z(j.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(j.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${N("view",I.download,"Open video",`data-path="${b(j.path)}"`)}</div>`:""}
        ${E?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${e.rendering||u.length?"disabled":""}>${e.rendering?'<span class="vpc-spin"></span>':I.play}<span>${j?"Re-render":"Render video"}</span></button>
          ${N("assemble",I.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),p.length?`<section class="vpc-sec vpc-actions">${p.join("")}</section>`:""}function ie(){return{id:a,el:t,h:s,getProject:()=>e.project,getState:()=>e,act:tt,ops:_,generate:et,load:m,running:v,render:Pt,approve:Rt,cancel:zt,route:()=>F(`/${encodeURIComponent(a)}/action`,{action:"route",apply:!1}).catch(()=>null)}}function pe(){let c=e.project?yt(e.project):{shotIndex:-1};Zt(ie(),{shotIndex:c.shotIndex>=0?c.shotIndex:void 0})}async function Rt(){let c=e.pending;if(c){e.pending=null,await et(c.path,c.body,"Submitting");return}let p=e.actPending;p&&(e.actPending=null,await tt(p.action,{...p.args,approved:!0},"Submitting"))}function zt(){e.pending=null,e.actPending=null,B()}function ce(c){let p=c.budget||{},f=Q(c)==="auto",$=yt(c),u=p.capUsd!=null?` of ${q(p.capUsd)}`:"",U=`${f?"Autopilot":"Step-by-step"} \xB7 ${q(p.spentUsd)} spent${u}`,z=(c.shots||[]).map((C,M)=>{let Y=Mt(C),it=!!C.approvedAt,T=M===$.shotIndex,D=it?'<span class="vpc-cbadge is-ok">\u2713</span>':T?'<span class="vpc-cbadge is-cur">\u25CF</span>':"";return`<div class="vpc-ctile${T?" is-cur":""}">${$t(C,Y,c,s)}${D}<span class="vpc-ctag">${M+1} \xB7 ${b(C.title||"Shot")}</span></div>`}).join(""),E=e.pending||e.actPending,j=e.pending?e.pending.estimate?.total:e.actPending?.usd,A=E?`<div class="vpc-approve"><strong>Approve ${q(j)}?</strong>
      <div class="vpc-row"><button type="button" class="vpc-btn is-primary is-wide" data-vpa="approve-pending">${I.check}<span>Approve &amp; run \xB7 ${q(j)}</span></button>
      <button type="button" class="vpc-btn is-wide" data-vpa="cancel-pending">${I.x}<span>Cancel</span></button></div></div>`:"";return`<section class="vpc-compact">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${I.film}Video project \xB7 ${b(c.target?.aspect||"")}</span>
          <strong class="vpc-title">${b(c.title||c.id)}</strong>
          <span class="vpc-muted">${U}</span>
        </div>
        <div class="vpc-tools">${N("all-tools","\u22EF","All tools",`aria-pressed="${!!e.allTools}"`)}</div>
      </div>
      <div class="vpc-ctiles">${z||'<p class="vpc-muted">No shots yet. Ask Prom to plan the shot list.</p>'}</div>
      <p class="vpc-next">Next: <b>${b($.label)}</b></p>
      ${A}
      <button type="button" class="vpc-btn is-primary is-wide vpc-continue" data-vpa="open-studio">Continue \u2192</button>
    </section>`}function B(){if(!n())return;let c=document.activeElement;if(c&&t.contains(c)&&c.matches?.("textarea[data-vpf]")&&!e.busy)return;let p=e.project;if(!p){t.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${I.film}Video project</span></div>
        <p class="vpc-muted">${e.error?b(e.error):"Loading\u2026"}</p></div>`;return}let f=p.budget||{},$=document.body?.classList?.contains("pm-mobile-document-scroll")?document.scrollingElement||document.documentElement:t.closest(".pm-chat-body"),u=$?.getBoundingClientRect?.().top||0,U=t.getBoundingClientRect?.(),z=$?.scrollTop,E=`<div class="vpc">
      ${ce(p)}
      ${e.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${b(e.busy)}\u2026</div>`:""}
      ${e.error?`<p class="vpc-err">${b(e.error)}</p>`:""}
      ${e.toast?`<div class="vpc-toast">${b(e.toast)}</div>`:""}
      ${e.allTools?`
        <div class="vpc-head">
          <div class="vpc-headtext">
            <span class="vpc-kicker">${I.film}Video project \xB7 ${b(p.target?.aspect||"")}</span>
            <strong class="vpc-title">${b(p.title||p.id)}</strong>
            <span class="vpc-muted">${q(f.spentUsd)} spent${f.capUsd!=null?` of ${q(f.capUsd)}`:""} \xB7 auto-approve under ${q(f.autoApproveUsd??1)}</span>
          </div>
          <div class="vpc-tools">
            ${N("undo",I.undo,"Undo",e.history?.undo?"":"disabled")}
            ${N("redo",I.redo,"Redo",e.history?.redo?"":"disabled")}
            ${N("storyboard",w.grid,"Generate storyboard")}
            ${N("qa",w.gauge,"QA: score selected takes")}
            ${N("refresh",I.refresh,"Refresh")}
          </div>
        </div>
        ${se(p)}
        ${_t(p,s)}
        ${ne(p)}
        ${Bt(p,e,s)}
        ${re(p)}
        ${qt(p,e,s)}
        ${Vt(p,e,s)}`:""}
    </div>`,j=t.querySelector(":scope > .vpc"),A=document.createElement("template");A.innerHTML=E;let C=A.content.firstElementChild;if(!j)t.replaceChildren(C);else{let M=[...j.children],Y=[...C.children],it=T=>`${T.tagName}:${T.className?.replace?.(/ is-[\w-]+/g,"")||""}:${T.querySelector?.("h4")?.textContent||""}`;for(let T=0;T<Y.length;T++){let D=Y[T],H=M.find(pt=>it(pt)===it(D)&&!pt.__vpMatched);H?(H.__vpMatched=!0,H.outerHTML!==D.outerHTML?(D.querySelectorAll?.(".vpc-strip").forEach((pt,de)=>{pt.scrollLeft=H.querySelectorAll?.(".vpc-strip")[de]?.scrollLeft||0}),H.replaceWith(D)):j.children[T]!==H&&j.insertBefore(H,j.children[T]||null)):j.insertBefore(D,j.children[T]||null)}M.forEach(T=>{T.__vpMatched||T.remove(),delete T.__vpMatched})}if(Xt(),$&&U&&z!=null&&U.bottom<u){let M=t.getBoundingClientRect().bottom-U.bottom;M&&($.scrollTop=z+M)}}t.addEventListener("click",async c=>{let p=c.target.closest("[data-vpa]");if(!p||!t.contains(p)||p.disabled||(c.preventDefault(),c.stopPropagation(),e.busy&&!["toggle","view","all-tools","open-studio"].includes(p.dataset.vpa)))return;let f=p.dataset.vpa,$=p.dataset;switch(f){case"toggle":e.openShot=e.openShot===$.s?"":$.s,B(),e.openShot&&!e.models.length&&vt(s).then(u=>{e.models=u,u.length&&B()}),e.openShot&&!(e.presets||[]).length&&lt(s).then(u=>{e.presets=u,u.length&&B()});return;case"view":$.path&&oe($.path);return;case"refresh":e.estimateKey="",await m();return;case"undo":case"redo":await x(f==="undo"?"Undoing":"Redoing",()=>F(`/${encodeURIComponent(a)}/${f}`,{})),e.estimateKey="",await m();return;case"approve-anchor":await _([{op:"character.approveAnchor",id:$.c,path:$.path}],"Approving anchor");return;case"reject-anchor":await _([{op:"character.rejectAnchor",id:$.c,path:$.path}],"Removing");return;case"reroll":await et(`/characters/${encodeURIComponent($.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await _([{op:"take.select",shotId:$.s,takeId:$.t}],"Swapping take");return;case"redo-shot":await et("/generate",{shotIds:[$.s],count:Number($.n)||1},"Estimating");return;case"gen-all":{let u=S().map(U=>U.id);if(!u.length)return;await et("/generate",{shotIds:u,count:1,approved:!0},"Submitting");return}case"approve-pending":return Rt();case"cancel-pending":zt();return;case"assemble":await _([{op:"timeline.assemble"}],"Assembling");return;case"render":await Pt();return;case"all-tools":e.allTools=!e.allTools,B();return;case"open-studio":pe();return;default:e.toast="",await Ft(f,{st:e,d:$,act:tt,ops:_,paint:B,h:s})}}),t.addEventListener("change",async c=>{let p=c.target.closest?.("[data-vpf]");!p||!t.contains(p)||e.busy||await Ot(p.dataset.vpf,{st:e,d:p.dataset,ops:_,act:tt,value:p.value,checked:p.checked})}),t.addEventListener("click",c=>{c.target.closest?.("[data-vpf]")&&c.stopPropagation()}),B(),o&&Date.now()-o.at<3e3?k().then(()=>{B(),d()}):r.visible&&m()}var It=null,jt=!1;function ae(t=document){te(),jt=!1,t.querySelectorAll?.(Ge).forEach(a=>{try{We(a)}catch(o){console.warn("[video-project-card] mount failed",o)}})}function ra(){if(!(typeof document>"u")){if(!document.getElementById(ee)){let t=document.createElement("style");t.id=ee,t.textContent=Ye+Dt,document.head.appendChild(t)}ae(),!(It||typeof MutationObserver>"u")&&(It=new MutationObserver(()=>{if(jt)return;jt=!0,(typeof requestAnimationFrame=="function"?requestAnimationFrame:a=>setTimeout(a,16))(()=>ae())}),It.observe(document.documentElement,{childList:!0,subtree:!0}))}}var Ye=`
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
.prom-vp-card .vpc-compact{padding:0 12px 12px}
.prom-vp-card .vpc-ctiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;overflow-x:auto;padding:2px}
.prom-vp-card .vpc-ctile{position:relative;min-width:0;aspect-ratio:9/12;border-radius:12px;overflow:hidden;border:1px solid var(--vpc-line);background:var(--vpc-soft)}
.prom-vp-card .vpc-ctile.is-cur{border-color:var(--vpc-accent);box-shadow:0 0 0 1px var(--vpc-accent)}
.prom-vp-card .vpc-ctile .vpc-thumb,.prom-vp-card .vpc-ctile img,.prom-vp-card .vpc-ctile video{display:block;width:100%;height:100%;object-fit:cover}
.prom-vp-card .vpc-ctag{position:absolute;left:6px;bottom:6px;max-width:calc(100% - 12px);padding:1px 6px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-vp-card .vpc-cbadge{position:absolute;top:6px;right:6px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:11px;background:var(--vpc-accent);color:#fff}
.prom-vp-card .vpc-cbadge.is-ok{background:var(--prom-success,#2eaa5c)}
.prom-vp-card .vpc-next{margin:10px 0 8px;font-size:13px}
.prom-vp-card .vpc-continue{min-height:40px;border-radius:12px;margin-top:4px}
`;export{ra as installVideoProjectCards};
