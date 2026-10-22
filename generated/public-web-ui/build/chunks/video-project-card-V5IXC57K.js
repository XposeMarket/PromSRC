var A=e=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e}</svg>`,y={box:A('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),userPlus:A('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),grid:A('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),gauge:A('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),up:A('<path d="M18 15l-6-6-6 6"/>'),down:A('<path d="M6 9l6 6 6-6"/>'),minus:A('<path d="M5 12h14"/>'),plus:A('<path d="M12 5v14M5 12h14"/>'),mic:A('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),share:A('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),split:A('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),rocket:A('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),download:A('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),check:A('<path d="M5 12l5 5L20 7"/>'),x:A('<path d="M18 6L6 18M6 6l12 12"/>'),pen:A('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),film:A('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),talk:A('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><path d="M17 7a4 4 0 010 6M20 4a8 8 0 010 12"/>'),sparkle:A('<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>'),speaker:A('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>'),copies:A('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),undo:A('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>'),trash:A('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>')},it=null;function ct(e){return it||(it=e.vpFetch("/action",{action:"presets"}).then(o=>o?.presets||[]).catch(()=>(it=null,[]))),it}function re(e,o,a){let t=o.presets||[],s=e.presetId||"",r=Object.entries({camera:"Camera",vfx:"VFX",look:"Look"}).map(([l,m])=>{let v=t.filter(d=>d.group===l);return v.length?`<optgroup label="${m}">${v.map(d=>`<option value="${a.esc(d.id)}"${d.id===s?" selected":""}>${a.esc(d.label)}</option>`).join("")}</optgroup>`:""}).join(""),i=s&&!t.some(l=>l.id===s)?`<option value="${a.esc(s)}" selected>${a.esc(s)}</option>`:"";return`<select class="vpc-select" data-vpf="presetId" data-s="${a.esc(e.id)}" aria-label="Preset" title="Motion / VFX / look preset"><option value="">No preset</option>${i}${r}</select>`}function Pt(e,o){let a=String(e.modelId||""),t="";return/lipsync/.test(a)?t="lipsync":/omnihuman|ai-avatar/.test(a)?t="talking":e.sourceVideo?t="recast":e.sketch?t="sketch":(o?.kind==="image"||e.kenBurns)&&(t="still"),t?` <span class="vpc-pill is-kind">${t}</span>`:""}function Rt(e){return`<span class="vpc-ptools" role="toolbar" aria-label="Studio tools">
    ${e.iconBtn("draw",y.pen,"Draw to video (sketch pad)")}
    ${e.iconBtn("recast",y.film,"Recast a video (upload footage)")}
    ${e.iconBtn("talking-photo",y.talk,"Talking photo (upload portrait)")}
    ${e.iconBtn("upscale",y.sparkle,"Upscale selected takes")}
    ${e.iconBtn("foley",y.speaker,"Add foley / sound effects")}
    ${e.iconBtn("batch",y.copies,"Make ad variants (hooks + creators)")}
  </span>`}function bt(e,o="",a=""){return new Promise(t=>{let s=document.createElement("div");s.className="vpc-sketch";let n=l=>String(l).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[m]);s.innerHTML=`<div class="vpc-sketch-box vpc-ask" role="dialog" aria-label="${n(e)}">
      <label class="vpc-ask-title">${n(e)}</label>
      <textarea rows="3" placeholder="${n(o)}">${n(a)}</textarea>
      <div class="vpc-sketch-bar"><span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${y.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Continue" aria-label="Continue">${y.check}</button>
      </div></div>`,document.body.appendChild(s);let r=s.querySelector("textarea");setTimeout(()=>{r.focus(),r.setSelectionRange(r.value.length,r.value.length)},30);let i=l=>{s.remove(),t(l)};r.addEventListener("keydown",l=>{l.key==="Enter"&&(l.metaKey||l.ctrlKey)&&i(r.value.trim()),l.key==="Escape"&&i("")}),s.addEventListener("click",l=>{let m=l.target.closest("button");if(!m){l.target===s&&i("");return}i(m.dataset.k==="ok"?r.value.trim():"")})})}function ie(){return new Promise(e=>{let o=document.createElement("div");o.className="vpc-sketch",o.innerHTML=`<div class="vpc-sketch-box" role="dialog" aria-label="Sketch pad">
      <canvas width="720" height="720"></canvas>
      <div class="vpc-sketch-bar">
        ${[3,8,18].map((d,k)=>`<button type="button" class="vpc-icon${k===1?" is-on":""}" data-w="${d}" title="Brush ${["S","M","L"][k]}" aria-label="Brush ${["small","medium","large"][k]}"><span class="vpc-dotb" style="width:${d/2+4}px;height:${d/2+4}px"></span></button>`).join("")}
        <button type="button" class="vpc-icon" data-k="undo" title="Undo" aria-label="Undo">${y.undo}</button>
        <button type="button" class="vpc-icon" data-k="clear" title="Clear" aria-label="Clear">${y.trash}</button>
        <span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${y.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Use sketch" aria-label="Use sketch">${y.check}</button>
      </div></div>`,document.body.appendChild(o);let a=o.querySelector("canvas"),t=a.getContext("2d"),s=[],n=8,r=null,i=()=>{t.fillStyle="#fff",t.fillRect(0,0,a.width,a.height),t.strokeStyle="#111",t.lineCap="round",t.lineJoin="round";for(let d of s)t.lineWidth=d.w,t.beginPath(),d.pts.forEach(([k,h],T)=>T?t.lineTo(k,h):t.moveTo(k,h)),d.pts.length===1&&t.lineTo(d.pts[0][0]+.1,d.pts[0][1]),t.stroke()},l=d=>{let k=a.getBoundingClientRect();return[(d.clientX-k.left)*(a.width/k.width),(d.clientY-k.top)*(a.height/k.height)]};a.style.touchAction="none",a.addEventListener("pointerdown",d=>{a.setPointerCapture(d.pointerId),r={w:n,pts:[l(d)]},s.push(r),i()}),a.addEventListener("pointermove",d=>{r&&(r.pts.push(l(d)),i())});let m=()=>{r=null};a.addEventListener("pointerup",m),a.addEventListener("pointercancel",m),i();let v=d=>{o.remove(),e(d)};o.addEventListener("click",d=>{let k=d.target.closest("button");if(!k){d.target===o&&v(null);return}if(k.dataset.w){n=Number(k.dataset.w),o.querySelectorAll("[data-w]").forEach(T=>T.classList.toggle("is-on",T===k));return}let h=k.dataset.k;h==="undo"?(s.pop(),i()):h==="clear"?(s.length=0,i()):h==="cancel"?v(null):h==="ok"&&v(s.length?a.toDataURL("image/png").replace(/^data:[^,]*,/,""):null)})})}var pe={openai:["alloy","ash","coral","echo","fable","nova","onyx","sage","shimmer"],xai:["ara","rex","sal","eve","leo"]},ce=["bold","pop","minimal","karaoke"],de=["9:16","1:1","16:9"];function xt(e,o,a,t){let s="vpc-thumb";if(o?.poster)return`<img class="${s}" src="${t.esc(t.mediaUrl(o.poster))}" alt="" loading="eager" decoding="async">`;if(o?.path&&t.isVideo(o.path))return`<video class="${s}" src="${t.esc(t.mediaUrl(o.path))}#t=0.1" muted playsinline preload="metadata"></video>`;if(o?.path)return t.thumb(o.path,s);if(e?.storyboard)return t.thumb(e.storyboard,s);let n=(e?.characterIds||[])[0],r=(a?.characters||[]).find(i=>i.id===n)||(a?.characters||[])[0];return t.thumb((r?.anchors||[])[0],s)}function zt(e){return e?.kind==="product"?'<span class="vpc-pill is-product">Product</span>':""}var pt=null;function dt(e){return pt||(pt=e.vpFetch("/action",{action:"models"}).then(o=>(o?.models||[]).filter(a=>!a.kind||a.kind==="video")).catch(()=>(pt=null,[]))),pt}function Et(e,o,a,t,s){let n=s.esc(e.id),r=t.models||[],i=e.modelId||"",l=['<option value="">Default model</option>',...r.map(m=>`<option value="${s.esc(m.id)}"${m.id===i?" selected":""}>${s.esc(m.label||m.id)}${m.price!=null?` \xB7 ${s.esc(typeof m.price=="number"?s.usd(m.price):m.price)}`:""}</option>`)];return i&&!r.some(m=>m.id===i)&&l.push(`<option value="${s.esc(i)}" selected>${s.esc(i)}</option>`),`<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${n}">${s.esc(e.prompt||"")}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${n}" placeholder="Spoken line for this shot">${s.esc(e.line||"")}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${s.iconBtn("dur",y.minus,"Shorter",`data-s="${n}" data-d="-1" ${Number(e.durationSec)<=1?"disabled":""}`)}
        <span>${Number(e.durationSec)||0}s</span>
        ${s.iconBtn("dur",y.plus,"Longer",`data-s="${n}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${n}" aria-label="Model">${l.join("")}</select>
      ${re(e,t,s)}
      <span class="vpc-grow"></span>
      ${s.iconBtn("move",y.up,"Move up",`data-s="${n}" data-i="${o-1}" ${o===0?"disabled":""}`)}
      ${s.iconBtn("move",y.down,"Move down",`data-s="${n}" data-i="${o+1}" ${o>=a-1?"disabled":""}`)}
      ${(e.takes||[]).length>=2?s.iconBtn("variants",y.split,"Render hook variants (one export per take)",`data-s="${n}"`):""}
    </div>
    ${e.voiceover?.path?`<audio class="vpc-audio" src="${s.esc(s.mediaUrl(e.voiceover.path))}" controls preload="none"></audio>`:""}
  </div>`}function Tt(e,o){let a=e?.qa;if(!a||a.score==null)return"";let t=Number(a.score),s=t>=7?"good":t>=5?"warn":"bad",n=[`QA ${t}/10${a.verdict?` \xB7 ${a.verdict}`:""}${a.model?` \xB7 ${a.model}`:""}`,...a.issues||[]].join(`
`);return`<span class="vpc-qa is-${s}" title="${o.esc(n)}" aria-label="${o.esc(n)}">${t}</span>`}function Ut(e,o){let a=e.shots||[];if(!a.some(n=>n.storyboard||(n.storyboardCandidates||[]).length))return"";let t=a.some(n=>!n.storyboard&&(n.storyboardCandidates||[]).length);return`<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${a.map((n,r)=>{let i=o.esc(n.id),l=(n.storyboardCandidates||[]).find(d=>d!==n.storyboard),m=n.storyboard||l;if(!m)return`<div class="vpc-sb is-empty"><span class="vpc-sb-n">${r+1}</span></div>`;let v=!n.storyboard&&l?`<div class="vpc-tile-actions">
        ${o.iconBtn("sb-approve",y.check,"Approve storyboard",`data-s="${i}" data-path="${o.esc(l)}"`,"is-go")}
        ${o.iconBtn("sb-reject",y.x,"Reject storyboard",`data-s="${i}" data-path="${o.esc(l)}"`)}
      </div>`:`<span class="vpc-badge">${y.check}</span>`;return`<div class="vpc-sb${n.storyboard?" is-approved":""}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${o.esc(m)}" aria-label="View storyboard ${r+1}">${o.thumb(m,"vpc-tile-img")}</button>
      <span class="vpc-sb-n">${r+1}</span>${v}</div>`}).join("")}</div>
    ${t?`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${y.check}<span>Approve all</span></button>`:""}
  </section>`}function Lt(e,o,a){if(!(e.shots||[]).length)return"";let t=e.voice||{},s=t.provider||"openai",n=Object.entries(pe).map(([h,T])=>`<optgroup label="${h==="xai"?"xAI":"OpenAI"}">${T.map(_=>`<option value="${h}:${_}"${h===s&&_===t.voice?" selected":""}>${_}</option>`).join("")}</optgroup>`).join(""),r=e.captions||{},i=e.music||null,l=i?/chill/i.test(i.label||i.path||"")?"chill":/pulse/i.test(i.label||i.path||"")?"pulse":"custom":"none",m=(e.shots||[]).some(h=>h.line),v=Math.round((i?.volume??.3)*100),d=(e.audioMode||"voiceover")==="native";return`<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    ${`<div class="vpc-row vpc-wrap" role="radiogroup" aria-label="Who speaks the lines">
      <span class="vpc-muted">Speech</span>
      ${[["native","On camera","The creator speaks each line in the clip; captions transcribe the clip audio"],["voiceover","Narrator","TTS voiceover over dialogue-free clips; captions follow the voiceover"]].map(([h,T,_])=>`<button type="button" class="vpc-chip${(d?"native":"voiceover")===h?" is-on":""}" data-vpa="audio-mode" data-v="${h}" role="radio" aria-checked="${(d?"native":"voiceover")===h}" title="${_}">${T}</button>`).join("")}
    </div>`}
    ${d?`<div class="vpc-row vpc-wrap"><button type="button" class="vpc-btn" data-vpa="transcribe" title="Re-read what each clip says for captions">${y.mic}<span>Transcribe clips</span></button></div>`:`<div class="vpc-row vpc-wrap">
      ${y.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${t.voice?"":'<option value="" selected>Pick a voice</option>'}${n}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${m?"":'disabled title="Add voiceover lines to shots first"'}>${y.mic}<span>Voiceover</span></button>
    </div>`}
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${r.enabled?" checked":""}><span>Captions</span></label>
      ${ce.map(h=>`<button type="button" class="vpc-chip${(r.style||"bold")===h&&r.enabled?" is-on":""}" data-vpa="cap-style" data-v="${h}" aria-pressed="${(r.style||"bold")===h&&!!r.enabled}">${h}</button>`).join("")}
      ${r.cues?.length?`<span class="vpc-muted">${r.cues.length} cues</span>`:""}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[["pulse","Pulse"],["chill","Chill"],["none","None"]].map(([h,T])=>`<button type="button" class="vpc-chip${l===h?" is-on":""}" data-vpa="music" data-v="${h}" aria-pressed="${l===h}">${T}</button>`).join("")}
      ${l==="custom"?`<span class="vpc-chip is-on">${a.esc(i.label||"Custom")}</span>`:""}
      ${i?`<input class="vpc-range" type="range" min="0" max="100" value="${v}" data-vpf="volume" aria-label="Music volume" title="Music volume ${v}%">`:""}
    </div>
  </section>`}function Nt(e,o,a){let t=[],s=e.lastRun;s?.steps?.length&&t.push(`<ol class="vpc-steps">${s.steps.map(r=>`<li class="is-${a.esc(r.state)}" title="${a.esc(r.note||r.state)}"><span class="vpc-dot"></span>${a.esc(r.step)}${r.note?` <small class="vpc-muted">${a.esc(String(r.note).slice(0,80))}</small>`:""}</li>`).join("")}</ol>`);let n=o.actPending||(s?.needsApproval?{action:"run",args:{},usd:s.needsApproval.usd,breakdown:s.needsApproval.breakdown}:null);if(n){let r=(n.breakdown||[]).map(i=>`<li>${a.esc(i.item)} \xB7 ${a.usd(i.usd)}</li>`).join("");t.push(`<div class="vpc-approve">
      <strong>${n.action==="storyboard"?"Storyboard":n.action==="run"?"Autopilot":a.esc(n.action)} needs approval \xB7 ${a.usd(n.usd)}</strong>
      ${r?`<ul>${r}</ul>`:""}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${y.check}<span>Approve ${a.usd(n.usd)}</span></button>
        ${a.iconBtn("act-cancel",y.x,"Cancel")}
      </div></div>`)}return(e.shots||[]).length&&t.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${o.busy?"disabled":""}>${y.rocket}<span>Run all</span></button>`),t.length?`<section class="vpc-sec"><h4>Autopilot</h4>${t.join("")}</section>`:""}function _t(e,o,a){let t=(e.exports||[]).slice().reverse(),s=de.map(r=>`<button type="button" class="vpc-chip${o.aspects.has(r)?" is-on":""}" data-vpa="aspect" data-v="${r}" aria-pressed="${o.aspects.has(r)}">${r}</button>`).join(""),n=t.slice(0,6).map(r=>{let i=a.mediaUrl(r.path),l=[r.aspect,r.variant?`variant ${r.variant}`:"",`${Number(r.durationSec||0).toFixed(1)}s`].filter(Boolean).join(" \xB7 ");return`<div class="vpc-export">
      <video src="${a.esc(i)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${a.esc(l)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${a.esc(i)}" download="${a.esc(String(r.path).split("/").pop())}" title="Download" aria-label="Download">${y.download}</a>
        ${a.iconBtn("share",y.share,"Share",`data-path="${a.esc(r.path)}"`)}
      </div></div>`}).join("");return`<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${s}</div>
    ${n?`<div class="vpc-exports">${n}</div>`:""}</section>`}function gt(e="image/*"){return new Promise(o=>{let a=document.createElement("input");a.type="file",a.accept=e,a.style.display="none",a.addEventListener("change",()=>{let t=a.files&&a.files[0];if(a.remove(),!t)return o(null);let s=new FileReader;s.onload=()=>o({filename:t.name,dataBase64:String(s.result||"").replace(/^data:[^,]*,/,"")}),s.onerror=()=>o(null),s.readAsDataURL(t)}),document.body.appendChild(a),a.click()})}async function le(e,o){let a=o.mediaUrl(e);try{a=new URL(a,location.href).href}catch{}if(navigator.share)try{return await navigator.share({title:"Video",url:a}),"Shared"}catch{return""}try{return await navigator.clipboard.writeText(a),"Link copied"}catch{return"Copy failed"}}async function Bt(e,o){let{st:a,d:t,act:s,ops:n,paint:r,h:i}=o,l=a.project||{},m=v=>(l.shots||[]).find(d=>d.id===v);switch(e){case"upload-product":case"upload-character":{let v=await gt();return v&&await s("import_asset",{...v,role:e==="upload-product"?"product":"character",name:v.filename.replace(/\.[^.]+$/,"")},"Uploading"),!0}case"storyboard":return await s("storyboard",{},"Storyboarding"),!0;case"sb-approve":return await n([{op:"shot.approveStoryboard",id:t.s,path:t.path}],"Approving storyboard"),!0;case"sb-reject":return await n([{op:"shot.rejectStoryboard",id:t.s,path:t.path}],"Rejecting"),!0;case"sb-approve-all":{let v=(l.shots||[]).filter(d=>!d.storyboard&&(d.storyboardCandidates||[]).length).map(d=>({op:"shot.approveStoryboard",id:d.id,path:d.storyboardCandidates[0]}));return v.length&&await n(v,"Approving storyboard"),!0}case"dur":{let v=m(t.s);if(!v)return!0;let d=Math.max(1,Math.min(30,(Number(v.durationSec)||5)+Number(t.d)));return await n([{op:"shot.update",id:t.s,durationSec:d}],"Saving"),!0}case"move":return await n([{op:"shot.move",id:t.s,index:Number(t.i)}],"Reordering"),!0;case"variants":return await s("render_variants",{shotId:t.s},"Rendering hook variants",900*1e3),!0;case"qa":return await s("qa",{},"Scoring takes",300*1e3),!0;case"voiceover":return await s("voiceover",{},"Recording voiceover",300*1e3),!0;case"audio-mode":return await n([{op:"project.update",audioMode:t.v}],t.v==="native"?"Using on-camera dialogue":"Using a narrator"),!0;case"transcribe":return await s("transcribe",{force:!0},"Transcribing clips",3e5)&&l.captions?.enabled&&await s("captions",{style:l.captions.style},"Rebuilding captions"),!0;case"cap-style":{let v=t.v;return await s("captions",{style:v},"Building captions")&&await n([{op:"captions.set",enabled:!0,style:v}],"Saving captions"),!0}case"music":return t.v==="none"?await n([{op:"music.clear"}],"Removing music"):await s("music",{builtin:t.v},"Adding music"),!0;case"run-all":return await s("run",{},"Running autopilot",1800*1e3),!0;case"act-approve":{let v=a.actPending||(l.lastRun?.needsApproval?{action:"run",args:{}}:null);return a.actPending=null,v&&await s(v.action,{...v.args||{},approved:!0},"Submitting",1800*1e3),!0}case"act-cancel":return a.actPending=null,l.lastRun&&(l.lastRun.needsApproval=void 0),r(),!0;case"aspect":return a.aspects.has(t.v)?a.aspects.delete(t.v):a.aspects.add(t.v),r(),!0;case"draw":{let v=await ie();if(!v)return!0;let d=await bt("What should this sketch become?","A cinematic scene at golden hour");return d&&await s("draw_to_video",{dataBase64:v,prompt:d},"Sketch to video",900*1e3),!0}case"recast":{let v=await gt("video/*");if(!v)return!0;let d=await s("import_asset",{...v,role:"footage"},"Uploading footage",300*1e3);if(!d?.assetPath)return!0;let k=await bt("Recast it as\u2026","New character, outfit, world or style");return k&&await s("recast",{sourcePath:d.assetPath,prompt:k,mode:"edit"},"Recasting",900*1e3),!0}case"talking-photo":{let v=await gt();if(!v)return!0;let d=await s("import_asset",{...v,role:"asset"},"Uploading portrait");if(!d?.assetPath)return!0;let k=await bt("What should they say?","Hey! You have to try this.");return k&&await s("talking_photo",{imagePath:d.assetPath,line:k},"Talking photo",900*1e3),!0}case"upscale":return await s("upscale",{},"Upscaling",900*1e3),!0;case"foley":return await s("foley",{},"Adding sound",900*1e3),!0;case"batch":return await s("batch_variants",{count:3,vary:["hook","creator"]},"Planning variants",300*1e3),!0;case"share":{let v=await le(t.path,i);return v&&(a.error="",a.busy="",a.toast=v,r()),!0}default:return!1}}async function qt(e,o){let{d:a,ops:t,value:s,checked:n,st:r}=o;switch(e){case"prompt":case"line":case"modelId":case"presetId":{let i=(r.project?.shots||[]).find(l=>l.id===a.s);if(i&&String(i[e]||"")===s)return;await t([{op:"shot.update",id:a.s,[e]:s}],"Saving");return}case"voice":{let[i,l]=String(s).split(":");l&&await t([{op:"voice.set",provider:i,voice:l}],"Setting voice");return}case"captions":{let i=r.project?.captions?.style||"bold";n&&!(r.project?.captions?.cues||[]).length&&await o.act("captions",{style:i},"Building captions"),await t([{op:"captions.set",enabled:!!n,style:i}],"Saving captions");return}case"volume":{let i=r.project?.music;i?.path&&await t([{op:"music.set",path:i.path,volume:Number(s)/100,duck:i.duck!==!1}],"Saving");return}default:}}var Vt=`
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
`;function ve(e){return Array.isArray(e?.takes)?e.takes:[]}function et(e,o,a=[],t=[]){if(!e)return"setup";if(e.approvedAt)return"done";if(ve(e).length||e.status==="generating")return"take";let s=!!(e.storyboard||e.startImage),n=!!e.chainFromPrevious&&o>0,r=e.anchorMode==="start"&&(e.characterIds||[]).some(i=>{let l=(t||[]).find(m=>m.id===i);return!!(l&&(l.anchors||[]).length)});return!s&&!n&&!r?"frame":"setup"}function lt(e){let o=e?.shots||[];for(let a=0;a<o.length;a++)if(et(o[a],a,o,e?.characters)!=="done")return a;return-1}function $t(e){let o=e?.shots||[];if(!o.length)return{label:"Add shots to get started",shotIndex:-1};let a=lt(e);if(a>=0){let t=et(o[a],a,o,e?.characters),s=a+1;return t==="frame"?{label:`Pick a start frame for shot ${s}`,shotIndex:a}:t==="take"?{label:`Review shot ${s}`,shotIndex:a}:{label:`Set up shot ${s}`,shotIndex:a}}return(e?.exports||[]).length?{label:"Watch the final cut",shotIndex:-1}:{label:"Render the final cut",shotIndex:-1}}function vt(e){let o=e?.limits||{};if(Array.isArray(o.durations)&&o.durations.length)return o.durations.slice().sort((n,r)=>n-r);let a=Math.max(1,Math.ceil(o.minDurationSec??1)),t=Math.floor(o.maxDurationSec??10),s=[];for(let n=a;n<=t&&s.length<15;n++)s.push(n);return s}function G(e){return e?.mode==="step"||e?.mode==="auto"?e.mode:e?.lastRun?"auto":"step"}var Ot=[["frame","Frame"],["setup","Setup"],["prompt","Prompt"],["take","Take"]],ue="\u2713",R=null,D=null,b=null,$={index:0,local:{},routed:!1,models:null,presets:null},at=null,Ht="";function J(){return b?.getProject?.()||null}function w(e){return b?.h?.esc?b.h.esc(e):String(e??"").replace(/[&<>"]/g,o=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[o])}function W(e){return b?.h?.usd?b.h.usd(e):`$${Number(e||0).toFixed(2)}`}function Y(e){return b?.h?.mediaUrl?b.h.mediaUrl(e):e}function Dt(e){return b?.h?.isVideo?b.h.isVideo(e):/\.(mp4|webm|mov)$/i.test(String(e||""))}function he(e,o){let a=e.shots[o];return $.local[a.id]==="prompt"&&et(a,o,e.shots,e.characters)!=="done"?"prompt":et(a,o,e.shots,e.characters)}function me(e){if(!e.shots.length){$.index=0;return}if($.index<0||$.index>=e.shots.length){let o=lt(e);$.index=o>=0?o:e.shots.length-1}}function fe(e,o){let a=(e.takes||[]).find(s=>s.id===e.selectedTakeId),t=a?.poster||a?.path||e.storyboard||(e.storyboardCandidates||[])[0];return t?Dt(t)&&!a?.poster?`<video class="vps-thumb" src="${w(Y(t))}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="vps-thumb" src="${w(Y(t))}" alt="" loading="lazy">`:'<span class="vps-thumb is-empty"></span>'}function be(e,o){return`<nav class="vps-rail" aria-label="Shot steps">${Ot.map(([a,t],s)=>{let n=a===e,r=o||Ot.findIndex(([i])=>i===e)>s;return`<span class="vps-pill${n?" is-on":""}${r&&!n?" is-done":""}">${r&&!n?ue+" ":""}${t}</span>`}).join("")}</nav>`}function ge(e,o){return`<div class="vps-shots" role="list">${e.shots.map((a,t)=>{let s=!!a.approvedAt,n=t===o;return`<button type="button" role="listitem" class="vps-shot${n?" is-cur":""}" data-vps="shot" data-i="${t}" aria-label="Shot ${t+1}">
      ${fe(a,e)}
      ${s?'<span class="vps-badge is-ok">\u2713</span>':n?'<span class="vps-badge is-cur">\u25CF</span>':""}
      <span class="vps-shot-n">${t+1}</span></button>`}).join("")}</div>`}function Kt(){let e=b.getState(),o=e.pending||e.actPending;if(!o)return"";let a=e.pending?e.pending.estimate?.total:o.usd;return`<div class="vps-approve" role="group" aria-label="Approve cost"><strong>Approve ${W(a)}?</strong>
    <p class="vps-muted">${w(e.pending?.reason||"This run is paid. Nothing is sent until you approve.")}</p>
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="approve-pending">Approve &amp; run \xB7 ${W(a)}</button>
    <button type="button" class="vps-btn is-wide" data-vps="cancel-pending">Cancel</button></div></div>`}function xe(e,o,a){let t=a.storyboardCandidates||[],s=Math.min($.local[`cand:${a.id}`]||0,Math.max(0,t.length-1)),n=e.shots[o-1],r=n&&(n.takes||[]).find(v=>v.id===n.selectedTakeId),i=o>0&&r?.kind==="video"?`<button type="button" class="vps-opt" data-vps="chain-frame" data-i="${o}"><span>Continue from last frame</span><span class="vps-badge is-accent">Prom pick</span></button>`:"",l=t.length?`<div class="vps-car" data-vps-car="${w(a.id)}">${t.map((v,d)=>`
        <button type="button" class="vps-tile${d===s?" is-active":""}" data-vps="cand" data-k="${d}" data-path="${w(v)}" aria-label="Frame ${"ABCD"[d]||d+1}">
          <img src="${w(Y(v))}" alt="" loading="lazy"><span class="vps-tag">${"ABCD"[d]||d+1}</span></button>`).join("")}</div>
       <div class="vps-dots">${t.map((v,d)=>`<span class="vps-dot${d===s?" is-on":""}"></span>`).join("")}</div>`:'<p class="vps-muted">No frames yet. Generate four stills to pick from.</p>',m=t[s]||"";return`<h3 class="vps-h">Pick a start frame</h3>${l}
    <form class="vps-field" data-vps-form="edit-frame"><input class="vps-input" name="instruction" placeholder="Change something in ${"ABCD"[s]||"A"}\u2026 (e.g. cash in hand)" aria-label="Edit frame"><button type="submit" class="vps-btn" aria-label="Apply edit" ${m?"":"disabled"}>\u21B5</button></form>
    <div class="vps-row vps-stack">
      <button type="button" class="vps-btn is-wide" data-vps="more-frames" data-i="${o}">\u21BB 4 more</button>
      <button type="button" class="vps-btn is-primary is-wide" data-vps="use-frame" data-path="${w(m)}" ${m?"":"disabled"}>Use ${"ABCD"[s]||"A"} \u2192</button>
      ${i}
    </div>`}function $e(e,o,a){let s=(b.getState().models||$.models||[]).filter(h=>h.kind==="video"),n=s.find(h=>h.id===a.modelId)||s[0],r=$.routed&&$.pick?$.pick[a.id]:null,i=s.map(h=>`<button type="button" class="vps-opt${h.id===n?.id?" is-on":""}" data-vps="model" data-id="${w(h.id)}">
      <span class="vps-opt-main"><span>${w(h.label||h.id)}</span>
      <small class="vps-muted">${vt(h).join("/")}s${h.pricing?.perSecondUsd?` \xB7 $${h.pricing.perSecondUsd}/s`:""}</small></span>
      ${r===h.id?'<span class="vps-badge is-accent">Prom pick</span>':""}</button>`).join(""),l=vt(n||{}),m=Number(a.durationSec),v=l.map(h=>`<button type="button" class="vps-chip${h===m?" is-on":""}" data-vps="length" data-d="${h}">${h}s</button>`).join(""),k=($.presets||[]).filter(h=>h.group==="camera").slice(0,8).map(h=>`<button type="button" class="vps-chip${h.id===a.presetId?" is-on":""}" data-vps="camera" data-id="${w(h.id)}">${w(h.label)}</button>`).join("");return`<h3 class="vps-h">Model <span class="vps-muted">\xB7 Prom pre-picked</span></h3>
    <div class="vps-list">${i||'<p class="vps-muted">Loading models\u2026</p>'}</div>
    <h3 class="vps-h">Length</h3><div class="vps-chips">${v}</div>
    ${k?`<h3 class="vps-h">Camera</h3><div class="vps-chips">${k}</div>`:""}
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="next-step" data-to="prompt">Next \xB7 Prompt \u2192</button></div>`}function ye(e,o,a){let t=(a.takes||[]).length;return`<h3 class="vps-h">Prompt</h3>
    <textarea class="vps-text" data-vps-f="prompt" data-s="${w(a.id)}" rows="4" aria-label="Shot prompt">${w(a.prompt||"")}</textarea>
    <input class="vps-input" data-vps-f="line" data-s="${w(a.id)}" value="${w(a.line||"")}" placeholder="Spoken line (optional)" aria-label="Spoken line">
    <div class="vps-chips"><span class="vps-chip">${w(a.modelId||"model")}</span><span class="vps-chip">${a.durationSec}s</span>${a.presetId?`<span class="vps-chip">${w(a.presetId)}</span>`:""}</div>
    ${Kt()}
    <button type="button" class="vps-btn is-primary is-wide" data-vps="generate" data-s="${w(a.id)}">Generate${t?" again":""}</button>`}function we(e,o,a){let t=a.takes||[],s=t.find(v=>v.id===a.selectedTakeId)||t[t.length-1],n=a.status==="generating"||(b.running?.()||[]).some(v=>v.target?.shotId===a.id);if(n&&!s)return'<div class="vps-wait"><span class="vps-spin"></span> Generating\u2026 usually 1-3 min</div>';let r=s?.qa?`QA ${Number(s.qa.score).toFixed(1)} \xB7 ${String(s.qa.verdict||"").toUpperCase()}`:"",i=s?Dt(s.path)?`<video class="vps-player" src="${w(Y(s.path))}" poster="${w(s.poster?Y(s.poster):"")}" controls playsinline preload="metadata"></video>`:`<img class="vps-player" src="${w(Y(s.path))}" alt="">`:'<p class="vps-muted">No take yet.</p>',l=t.map((v,d)=>`<button type="button" class="vps-chip${v.id===s?.id?" is-on":""}" data-vps="take" data-s="${w(a.id)}" data-t="${w(v.id)}">Take ${d+1}</button>`).join(""),m=!!a.approvedAt;return`<h3 class="vps-h">Take ${t.indexOf(s)+1||t.length} ${r?`<span class="vps-muted">${w(r)}</span>`:""}</h3>
    ${i}<div class="vps-chips">${l}</div>
    <form class="vps-field" data-vps-form="redo-note"><input class="vps-input" name="note" placeholder="What should change? (e.g. slower hand)" aria-label="Change note"><button type="submit" class="vps-btn" aria-label="Redo with note">\u21B5</button></form>
    ${n?'<div class="vps-wait"><span class="vps-spin"></span> Generating\u2026 usually 1-3 min</div>':""}
    <div class="vps-row vps-stack">
      <button type="button" class="vps-btn is-wide" data-vps="redo" data-s="${w(a.id)}" ${n?"disabled":""}>\u21BB Redo</button>
      ${m?`<button type="button" class="vps-btn is-wide" data-vps="unkeep" data-s="${w(a.id)}">Unkeep</button>`:`<button type="button" class="vps-btn is-primary is-wide" data-vps="keep" data-s="${w(a.id)}" ${s?"":"disabled"}>Keep \u2713</button>`}
    </div>
    ${Kt()}`}function ke(e,o){let a=e.shots[o],t=e.shots[o+1];if(!t)return`<div class="vps-after"><h3 class="vps-h">Shot ${o+1} kept \u2713</h3>
      <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="render">Render the final cut</button></div></div>`;let s=!!t.storyboard;return`<div class="vps-after"><h3 class="vps-h">Shot ${o+1} kept \u2713</h3>
    <p class="vps-muted">How should shot ${o+2} start?</p>
    <div class="vps-list">
      <button type="button" class="vps-opt" data-vps="after-start" data-mode="chain" data-i="${o+1}"><span>Continue from last frame</span><span class="vps-badge is-accent">Prom pick</span></button>
      <button type="button" class="vps-opt" data-vps="after-start" data-mode="new" data-i="${o+1}"><span>New start frame</span></button>
      ${s?`<button type="button" class="vps-opt" data-vps="after-start" data-mode="still" data-i="${o+1}"><span>Use storyboard still</span></button>`:""}
    </div>
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="goto" data-i="${o+1}">Go to shot ${o+2} \u2192</button></div></div>`}function Se(e){if(G(e)==="auto"&&!(e.lastRun&&e.lastRun.state==="running"))return Me(e);if(!e.shots.length)return'<p class="vps-muted">No shots yet. Ask Prom to plan the shot list, then come back here.</p>';me(e);let a=$.index,t=e.shots[a],s=he(e,a),n=s==="frame"?xe(e,a,t):s==="setup"?$e(e,a,t):s==="prompt"?ye(e,a,t):s==="done"?ke(e,a):we(e,a,t),r=`${t.id}:${s}`;return`${be(s==="done"?"take":s,s==="done")}
    <div class="vps-step" data-vps-step="${w(r)}">${n}</div>`}function Me(e){let o=$.plan||{},a=e.shots.map((n,r)=>`<div class="vps-sl"><span class="vps-thumb is-empty"></span>
    <span><strong>${r+1}. ${w(n.title||"Shot")}</strong><small class="vps-muted">${w(n.modelId||e.defaults?.videoModel||"model")} \xB7 ${n.durationSec}s</small></span>
    <span class="vps-muted">${W(o.perShot?.[n.id])}</span></div>`).join(""),t=o.total??0,s=e.budget?.capUsd;return`<h3 class="vps-h">Autopilot plan <span class="vps-muted">\xB7 needs your OK</span></h3>
    <div class="vps-list">${a}</div>
    <p class="vps-muted">+ frames, QA rerolls (1 max), music</p>
    <p><strong>Total ${W(t)}</strong>${s!=null?` / ${W(s)} cap`:""}</p>
    <p class="vps-muted">I only stop early if a shot fails QA twice or the run would go over the cap.</p>
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="run-approve">Approve &amp; run \xB7 ${W(t)}</button>
    <button type="button" class="vps-btn is-wide" data-vps="mode" data-to="step">Switch to step-by-step</button></div>`}function Ce(e){let o=G(e),a=e.shots.length,t=Math.min($.index,Math.max(0,a-1)),s=o==="auto"?'<button type="button" class="vps-chip" data-vps="mode" data-to="step">Step-by-step</button>':'<button type="button" class="vps-chip" data-vps="mode" data-to="auto">\u26A1 Auto</button>';return`<header class="vps-top">
    <button type="button" class="vps-icon-btn" data-vps="back" aria-label="Previous shot" ${t>0?"":"disabled"}>\u2039</button>
    <div class="vps-title"><strong>${w(e.title||"Video project")}</strong><small class="vps-muted">${a?`Shot ${t+1} of ${a}`:"No shots"}</small></div>
    ${s}
    <button type="button" class="vps-icon-btn" data-vps="close" aria-label="Close">\u2715</button>
  </header>`}function O(){if(!R)return;let e=J();if(!e)return;let o=b.getState(),a=o.error?`<p class="vps-err">${w(o.error)}</p>`:"",t=o.busy?`<div class="vps-busy"><span class="vps-spin"></span>${w(o.busy)}\u2026</div>`:"",s=e.shots.length?ge(e,Math.min($.index,e.shots.length-1)):"";R.innerHTML=`${Ce(e)}${s}${t}${a}<div class="vps-body">${Se(e)}</div>`,R.dataset.vpsFor=b.id}async function je(){if($.models||($.models=await dt(b.h).catch(()=>[]),O()),$.presets||($.presets=await ct(b.h).catch(()=>[]),O()),!$.routed){$.routed=!0;let e=await b.route?.(),o=e?.picks||e?.routes||[];$.pick={};for(let a of o)a.shotId&&a.modelId&&($.pick[a.shotId]=a.modelId);O()}if(G(J())==="auto"&&!$.plan){let e=await b.h.vpFetch(`/${encodeURIComponent(b.id)}/action`,{action:"run_cost"}).catch(()=>null);$.plan={total:Number(e?.totalUsd??e?.total??0),perShot:{}},O()}}function ut(e){$.index=e,O()}async function Ie(e){let o=e.dataset,a=J();if(!a)return;let t=a.shots[$.index],s=t?.id;switch(o.vps){case"close":return Q();case"back":return ut(Math.max(0,$.index-1));case"shot":return ut(Number(o.i)||0);case"goto":return ut(Number(o.i)||0);case"mode":await b.ops([{op:"project.update",mode:o.to}],"Switching");return;case"cand":return $.local[`cand:${s}`]=Number(o.k)||0,O();case"use-frame":await b.ops([{op:"shot.approveStoryboard",id:s,path:o.path}],"Keeping frame");return;case"chain-frame":{let n=[{op:"shot.update",id:s,chainFromPrevious:!0}];(t.storyboard||t.startImage)&&(n[0]={...n[0],storyboard:"",startImage:""}),await b.ops(n,"Continuing from last frame");return}case"more-frames":return b.act("storyboard",{shotIds:[s],count:4},"Generating frames");case"model":{let n=($.models||[]).find(l=>l.id===o.id),r=n?vt(n):[],i=[{op:"shot.update",id:s,modelId:o.id}];return r.length&&!r.includes(Number(t.durationSec))&&(i[0].durationSec=r.reduce((l,m)=>Math.abs(m-t.durationSec)<Math.abs(l-t.durationSec)?m:l,r[0])),b.ops(i,"Setting model")}case"length":return b.ops([{op:"shot.update",id:s,durationSec:Number(o.d)}],"Setting length");case"camera":return b.ops([{op:"shot.update",id:s,presetId:o.id}],"Setting camera");case"next-step":return $.local[s]=o.to,O();case"generate":return b.generate("/generate",{shotIds:[s],count:1},"Estimating");case"redo":return b.generate("/generate",{shotIds:[s],count:1},"Estimating");case"take":return b.ops([{op:"take.select",shotId:s,takeId:o.t}],"Swapping take");case"keep":return b.ops([{op:"shot.approve",id:s}],"Keeping");case"unkeep":return b.ops([{op:"shot.unapprove",id:s}],"Unkeeping");case"after-start":{let n=Number(o.i)||0,r=a.shots[n];if(!r)return;if(o.mode==="chain"){let i=[{op:"shot.update",id:r.id,chainFromPrevious:!0}];(r.storyboard||r.startImage)&&(i[0]={...i[0],storyboard:"",startImage:""}),await b.ops(i,"Chaining")}else o.mode==="new"&&await b.ops([{op:"shot.update",id:r.id,chainFromPrevious:!1}],"Setting start");return ut(n)}case"render":return b.render();case"approve-pending":return b.approve();case"cancel-pending":return b.cancel();case"run-approve":return b.act("run",{approved:!0},"Starting autopilot");default:return}}var Ft="prom-vp-studio-style",Ae=`
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
.vps-badge{position:absolute;top:4px;right:4px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;background:var(--prom-accent,#ff7a1a);color:#fff}
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
`;function Pe(){if(typeof document>"u"||document.getElementById(Ft))return;let e=document.createElement("style");e.id=Ft,e.textContent=Ae,document.head.appendChild(e)}function Re(e){e.key==="Escape"&&(e.preventDefault(),Q())}function ze(e){let o=e.target.closest?.("[data-vps]");!o||!R.contains(o)||o.disabled||(e.preventDefault(),Ie(o))}function Ee(e){let o=e.target.closest?.("[data-vps-form]");if(!o)return;e.preventDefault();let a=o.dataset.vpsForm,s=J()?.shots?.[$.index];if(!s)return;let n=o.querySelector("input"),r=String(n?.value||"").trim();if(r){if(a==="edit-frame"){let i=s.storyboardCandidates||[],l=Math.min($.local[`cand:${s.id}`]||0,Math.max(0,i.length-1));b.act("storyboard",{shotIds:[s.id],count:1,editFrom:i[l],instruction:r},"Editing frame")}else if(a==="redo-note"){let i=`${s.prompt||""} ${r}`.trim();b.ops([{op:"shot.update",id:s.id,prompt:i}],"Saving note").then(()=>b.generate("/generate",{shotIds:[s.id],count:1},"Estimating"))}}}function Te(e){let o=e.target.closest?.("[data-vps-f]");if(!o||!R.contains(o))return;let t=J()?.shots?.[$.index],s=o.dataset.vpsF;!t||s!=="prompt"&&s!=="line"||b.ops([{op:"shot.update",id:t.id,[s]:o.value}],"Saving")}function Gt(){if(!(!R||!b)){if(!b.el?.isConnected){Q();return}R.contains(document.activeElement)&&document.activeElement?.matches?.("input,textarea")||O()}}function Wt(e,o={}){if(typeof document>"u")return;Pe(),R&&Q(),b=e,$={index:0,local:{},routed:!1,models:null,presets:null,pick:{},plan:null};let a=J();if(o.shotIndex!=null)$.index=Number(o.shotIndex)||0;else if(a){let t=lt(a);$.index=t>=0?t:0}D=document.createElement("div"),D.className="vps-scrim",R=document.createElement("div"),R.className="vps-sheet",R.setAttribute("role","dialog"),R.setAttribute("aria-modal","true"),R.setAttribute("aria-label","Video studio"),document.body.appendChild(D),document.body.appendChild(R),Ht=document.body.style.overflow,document.body.style.overflow="hidden",D.addEventListener("click",Q),R.addEventListener("click",ze),R.addEventListener("submit",Ee),R.addEventListener("change",Te),at=Re,document.addEventListener("keydown",at),O(),requestAnimationFrame?.(()=>{D?.classList.add("is-on"),R?.setAttribute("data-vps-open","")}),je()}function Q(){at&&document.removeEventListener("keydown",at),at=null;let e=b?.onClose;R?.remove(),D?.remove(),R=null,D=null,typeof document<"u"&&(document.body.style.overflow=Ht),b=null,typeof e=="function"&&e()}function Yt(){R&&b&&b.el&&!b.el.isConnected&&Q()}var Qt="prom-vp-card-style",Ue=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",mt=new Map,st=new Map,ot=typeof IntersectionObserver=="function"?new IntersectionObserver(e=>{for(let o of e){let a=o.target.__vpCard;a&&(a.visible=o.isIntersecting,a.visible&&!a.loaded?(a.loaded=!0,ft(a.id)):a.visible&&!a.wasVisible?ft(a.id):Ct(a.id),a.wasVisible=a.visible)}},{rootMargin:"120px"}):null;function Ct(e){let o=st.get(e);if(!o)return;clearTimeout(o.timer);for(let t of o.cards)t.el.isConnected||(o.cards.delete(t),ot?.unobserve(t.el),delete t.el.__vpCard);if(!o.cards.size){st.delete(e);return}(mt.get(e)?.project?.jobs||[]).some(t=>t.state==="queued"||t.state==="running")&&[...o.cards].some(t=>t.visible)&&(o.timer=setTimeout(()=>{ft(e)},3500))}async function ft(e){let o=st.get(e);if(o)return o.request||(o.request=V(`/${encodeURIComponent(e)}`).then(a=>{a.project&&mt.set(e,{project:a.project,history:a.history,at:Date.now()});for(let t of o.cards)t.update(a)}).catch(a=>{for(let t of o.cards)t.update(null,a)}).finally(()=>{o.request=null,Ct(e)})),o.request}var L=(e,o="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${o}>${e}</svg>`,C={film:L('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:L('<path d="M5 12l5 5L20 7"/>'),x:L('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:L('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:L('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:L('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:L('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:L('<path d="M7 4v16l13-8z"/>'),seq:L('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:L('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:L('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:L('<path d="M6 9l6 6 6-6"/>'),user:L('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:L('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:L('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function g(e){return String(e??"").replace(/[&<>"']/g,o=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[o])}function q(e){return`$${(Number(e)||0).toFixed(2)}`}function ht(e){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(e||""))}function yt(e){return String(e||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function X(e){let o=String(e||"").trim();if(!o)return"";if(/^(https?:|data:|blob:)/i.test(o))return o;let a=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof a=="function")try{let t=a(o);if(t)return String(t)}catch{}if(typeof window<"u"&&document.body?.classList?.contains("pm-mobile-active")){let t=String(window.__pmMobileActiveGatewayOrigin||window.location?.origin||"").replace(/\/+$/,""),s=String(window.__pmMobileActiveGatewayToken||"").trim();if(!s&&t===String(window.location?.origin||""))try{s=String(localStorage.getItem("pm_device_token")||"").trim()}catch{}let n=new URLSearchParams({path:o});return s&&n.set("pt",s),`${t}/api/canvas/inline?${n}`}return`/api/canvas/inline?path=${encodeURIComponent(o)}`}async function V(e,o,a=2e4){let t={method:o===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:o===void 0?void 0:JSON.stringify(o),timeoutMs:a},s=`/api/video-projects${e}`,n=window.__promVideoProjectFetch||window.api,r;if(typeof n=="function")r=await n(s,t);else{let i=await fetch(s,t);r=await i.json().catch(()=>({success:!1,error:`HTTP ${i.status}`}))}if(r&&r.success===!1)throw new Error(r.error||"Request failed");return r||{}}function wt(e){let o=e?.takes||[];return o.length?o.find(a=>a.id===e.selectedTakeId)||o[o.length-1]:null}function kt(e,o="vpc-thumb"){if(!e)return`<span class="${o} is-empty">${C.film}</span>`;let a=g(X(e));return ht(e)?`<video class="${o}" src="${a}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${o}" src="${a}" alt="" loading="eager" decoding="async">`}function N(e,o,a,t="",s=""){return`<button type="button" class="vpc-icon${s?` ${s}`:""}" data-vpa="${e}" title="${g(a)}" aria-label="${g(a)}" ${t}>${o}</button>`}function Le(e){e.dataset.vpMounted="1";let o=String(e.dataset.vpProject||""),a=mt.get(o),t={project:a?.project||null,history:a?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1,actPending:null,models:[],aspects:new Set,toast:""},s={esc:g,usd:q,isVideo:ht,mediaUrl:X,thumb:kt,iconBtn:N,vpFetch:V},n=()=>e.isConnected,r={el:e,id:o,visible:!ot,wasVisible:!ot,loaded:!ot,update:async(c,p)=>{n()&&(c&&l(c),t.error=p?String(p?.message||p):"",r.visible&&(await h(),B()))}},i=st.get(o)||{cards:new Set,timer:null,request:null};i.cards.add(r),st.set(o,i),e.__vpCard=r,ot?.observe(e);function l(c){c?.project&&(t.project=c.project),c?.history&&(t.history=c.history),t.project&&mt.set(o,{project:t.project,history:t.history,at:Date.now()})}async function m(){n()&&await ft(o)}function v(){return(t.project?.jobs||[]).filter(c=>c.state==="queued"||c.state==="running")}function d(){Ct(o)}function k(){let c=new Set(v().map(p=>p.target?.shotId).filter(Boolean));return(t.project?.shots||[]).filter(p=>!(p.takes||[]).length&&!c.has(p.id))}async function h(){let c=k(),p=c.map(f=>`${f.id}:${f.modelId||""}:${f.durationSec}:${(f.characterIds||[]).join(",")}`).join("|")+`#${(t.project?.characters||[]).map(f=>(f.anchors||[]).length).join(",")}`;if(!c.length){t.estimate=null,t.estimateKey="";return}if(!(p===t.estimateKey&&t.estimate))try{t.estimate=await V(`/${encodeURIComponent(o)}/estimate`,{shotIds:c.map(f=>f.id)}),t.estimateKey=p}catch(f){t.estimate=null,t.error=String(f?.message||f)}}async function T(c,p){t.busy=c,t.error="",B();try{let f=await p();return l(f),f}catch(f){return t.error=String(f?.message||f),null}finally{t.busy="",B()}}async function _(c,p){await T(p,()=>V(`/${encodeURIComponent(o)}/ops`,{ops:c})),await m()}async function Z(c,p={},f="Working",x=12e4){let u=await T(f,()=>V(`/${encodeURIComponent(o)}/action`,{action:c,...p},x));if(!u)return null;let z=u.needsApproval;if(z){let P=u.lastRun?.needsApproval,E=u.shotId?{...p,pendingShotId:u.shotId}:p;E.pendingShotId&&E.dataBase64&&delete E.dataBase64,t.actPending={action:c,args:E,usd:Number(P?.usd??z?.usd??u.estimateUsd??u.totalUsd??u.estimate?.total??0),breakdown:P?.breakdown||z?.breakdown||u.breakdown||[]}}else t.actPending=null;return t.estimateKey="",await m(),u}async function tt(c,p,f){let x=await T(f,()=>V(`/${encodeURIComponent(o)}${c}`,p,12e4));if(x){if(x.needsApproval){t.pending={path:c,body:{...p,approved:!0},label:f,reason:x.reason,estimate:x.estimate},B();return}t.pending=null,t.estimateKey="",await m()}}async function jt(){let c=t.project;if(!c)return;let p=(c.clips||[]).some(f=>f.source&&"shotId"in f.source);if(t.rendering=!0,t.aspects.size){await Z("render",{aspects:[...t.aspects]},"Rendering",900*1e3),t.rendering=!1,await m();return}if(!p&&!await T("Assembling",()=>V(`/${encodeURIComponent(o)}/ops`,{ops:[{op:"timeline.assemble"}]}))){t.rendering=!1,B();return}await T("Rendering",()=>V(`/${encodeURIComponent(o)}/render`,{},900*1e3)),t.rendering=!1,await m()}function Xt(c,p){let f=X(c);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:f,path:c,name:p||c.split("/").pop(),kind:ht(c)?"video":"image"});return}catch{}window.open(f,"_blank","noopener")}function Zt(c){let p=`${N("upload-product",y.box,"Upload product photo")}${N("upload-character",y.userPlus,"Upload character photo")}${Rt(s)}`;if(!(c.characters||[]).length)return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${p}</h4></section>`;let f=v().filter(u=>u.target?.characterId),x=c.characters.map(u=>{let z=f.some(M=>M.target.characterId===u.id),P=(u.anchors||[])[0],E=u.candidates||[],j=P?"Anchor approved":E.length?"Pick an anchor":z?"Generating anchor":"No anchor yet",I=[P?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${g(P)}" aria-label="View anchor">${kt(P,"vpc-tile-img")}</button><span class="vpc-badge">${C.check}</span></div>`:"",...E.map(M=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${g(M)}" aria-label="View candidate">${kt(M,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${N("approve-anchor",C.check,"Approve as anchor",`data-c="${g(u.id)}" data-path="${g(M)}"`,"is-go")}
            ${N("reject-anchor",C.x,"Reject",`data-c="${g(u.id)}" data-path="${g(M)}"`)}
          </div>
        </div>`),z?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${C.user}<strong>${g(u.name)}</strong>${zt(u)}</span>
          <span class="vpc-muted">${g(j)}</span>
          <span class="vpc-grow"></span>
          ${u.anchorPrompt?N("reroll",C.reroll,"Generate another anchor",`data-c="${g(u.id)}"`):""}
        </div>
        ${I?`<div class="vpc-strip">${I}</div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${p}</h4>${x}</section>`}function te(c){let p=c.shots||[];if(!p.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let f=new Set(v().map(u=>u.target?.shotId).filter(Boolean)),x=p.map((u,z)=>{let P=wt(u),E=f.has(u.id),j=t.openShot===u.id,I=(u.takes||[]).length,M=j?(u.takes||[]).slice().reverse().map(S=>`
        <div class="vpc-take${S.id===P?.id?" is-selected":""}">
          ${ht(S.path)?`<video src="${g(X(S.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${g(X(S.path))}" alt="" loading="eager">`}
          <div class="vpc-row">
            ${Tt(S,s)}<span class="vpc-muted">${g(yt(S.modelId))} \xB7 ${q(S.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${S.id===P?.id?`<span class="vpc-inuse">${C.check}In cut</span>`:N("use-take",C.check,"Use this take",`data-s="${g(u.id)}" data-t="${g(S.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${j?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${g(u.id)}" aria-expanded="${j}">
          ${E&&!P?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':xt(u,P,c,s)}
          <span class="vpc-shot-meta">
            <strong>${z+1}. ${g(u.title||"Shot")}${Pt(u,P)}</strong>
            <small>${g(String(u.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${E?"generating":g(u.status)}">${E?"generating":g(u.status)} \xB7 ${u.durationSec}s \xB7 ${I} take${I===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${C.chevron}</span>
        </button>
        ${j?`<div class="vpc-shot-body">
          ${Et(u,z,p.length,t,s)}
          ${u.camera?`<p class="vpc-muted">Camera: ${g(u.camera)}</p>`:""}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${g(u.id)}" data-n="1" ${E?"disabled":""}>${C.reroll}<span>${I?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${g(u.id)}" data-n="3" ${E?"disabled":""}>${C.layers}<span>3 variations</span></button>
          </div>
          ${M?`<div class="vpc-takes">${M}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${p.length}</span></h4>${x}</section>`}function ee(c){let p=[];if(t.pending){let I=(t.pending.estimate?.shots||[]).map(M=>`<li>${g(M.title||"Item")}: ${M.count}\xD7 ${g(yt(M.modelId))} \xB7 ${q(M.usd)}</li>`).join("");p.push(`<div class="vpc-approve">
        <strong>Approve ${q(t.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${g(t.pending.reason||"")}</p>
        ${I?`<ul>${I}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${C.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${C.x}<span>Cancel</span></button>
        </div>
      </div>`)}let f=k(),x=t.estimate;if(!t.pending&&f.length&&x){let I=(x.shots||[]).flatMap(S=>(S.problems||[]).map(K=>`${S.title}: ${K}`)),M=(c.characters||[]).some(S=>!(S.anchors||[]).length&&(S.candidates||[]).length);p.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${f.length} shot${f.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${q(x.total)}</strong></div>
        ${M?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${I.length?`<ul class="vpc-warn">${I.map(S=>`<li>${g(S)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${M?"disabled":""}>${C.spark}<span>${x.total>(c.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${q(x.total)}</span></button>
      </div>`)}let u=v();u.length&&p.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${u.length} job${u.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let z=(c.jobs||[]).filter(I=>I.state==="failed").slice(-2);z.length&&!u.length&&p.push(`<ul class="vpc-warn">${z.map(I=>`<li>${g(yt(I.modelId))} failed: ${g(String(I.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let P=c.shots||[],E=P.length&&P.every(I=>wt(I)),j=(c.exports||[]).slice(-1)[0];return(E||j)&&p.push(`<div class="vpc-final">
        ${j?`<video src="${g(X(j.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(j.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${N("view",C.download,"Open video",`data-path="${g(j.path)}"`)}</div>`:""}
        ${E?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${t.rendering||u.length?"disabled":""}>${t.rendering?'<span class="vpc-spin"></span>':C.play}<span>${j?"Re-render":"Render video"}</span></button>
          ${N("assemble",C.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),p.length?`<section class="vpc-sec vpc-actions">${p.join("")}</section>`:""}function ae(){return{id:o,el:e,h:s,getProject:()=>t.project,getState:()=>t,act:Z,ops:_,generate:tt,load:m,running:v,render:jt,approve:It,cancel:At,route:()=>V(`/${encodeURIComponent(o)}/action`,{action:"route",apply:!1}).catch(()=>null)}}function oe(){let c=t.project?$t(t.project):{shotIndex:-1};Wt(ae(),{shotIndex:c.shotIndex>=0?c.shotIndex:void 0})}async function It(){let c=t.pending;if(c){t.pending=null,await tt(c.path,c.body,"Submitting");return}let p=t.actPending;p&&(t.actPending=null,await Z(p.action,{...p.args,approved:!0},"Submitting"))}function At(){t.pending=null,t.actPending=null,B()}function se(c){let p=c.budget||{},f=G(c)==="auto",x=$t(c),u=p.capUsd!=null?` of ${q(p.capUsd)}`:"",z=`${f?"Autopilot":"Step-by-step"} \xB7 ${q(p.spentUsd)} spent${u}`,P=(c.shots||[]).map((M,S)=>{let K=wt(M),nt=!!M.approvedAt,U=S===x.shotIndex,F=nt?'<span class="vpc-cbadge is-ok">\u2713</span>':U?'<span class="vpc-cbadge is-cur">\u25CF</span>':"";return`<div class="vpc-ctile${U?" is-cur":""}">${xt(M,K,c,s)}${F}<span class="vpc-ctag">${S+1} \xB7 ${g(M.title||"Shot")}</span></div>`}).join(""),E=t.pending||t.actPending,j=t.pending?t.pending.estimate?.total:t.actPending?.usd,I=E?`<div class="vpc-approve"><strong>Approve ${q(j)}?</strong>
      <div class="vpc-row"><button type="button" class="vpc-btn is-primary is-wide" data-vpa="approve-pending">${C.check}<span>Approve &amp; run \xB7 ${q(j)}</span></button>
      <button type="button" class="vpc-btn is-wide" data-vpa="cancel-pending">${C.x}<span>Cancel</span></button></div></div>`:"";return`<section class="vpc-compact">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${C.film}Video project \xB7 ${g(c.target?.aspect||"")}</span>
          <strong class="vpc-title">${g(c.title||c.id)}</strong>
          <span class="vpc-muted">${z}</span>
        </div>
        <div class="vpc-tools">${N("all-tools","\u22EF","All tools",`aria-pressed="${!!t.allTools}"`)}</div>
      </div>
      <div class="vpc-ctiles">${P||'<p class="vpc-muted">No shots yet. Ask Prom to plan the shot list.</p>'}</div>
      <p class="vpc-next">Next: <b>${g(x.label)}</b></p>
      ${I}
      <button type="button" class="vpc-btn is-primary is-wide vpc-continue" data-vpa="open-studio">Continue \u2192</button>
    </section>`}function B(){if(!n())return;let c=document.activeElement;if(c&&e.contains(c)&&c.matches?.("textarea[data-vpf]")&&!t.busy)return;let p=t.project;if(!p){e.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${C.film}Video project</span></div>
        <p class="vpc-muted">${t.error?g(t.error):"Loading\u2026"}</p></div>`;return}let f=p.budget||{},x=document.body?.classList?.contains("pm-mobile-document-scroll")?document.scrollingElement||document.documentElement:e.closest(".pm-chat-body"),u=x?.getBoundingClientRect?.().top||0,z=e.getBoundingClientRect?.(),P=x?.scrollTop,E=`<div class="vpc">
      ${se(p)}
      ${t.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${g(t.busy)}\u2026</div>`:""}
      ${t.error?`<p class="vpc-err">${g(t.error)}</p>`:""}
      ${t.toast?`<div class="vpc-toast">${g(t.toast)}</div>`:""}
      ${t.allTools?`<div class="vpc-all">
        <div class="vpc-head">
          <div class="vpc-headtext">
            <span class="vpc-kicker">${C.film}Video project \xB7 ${g(p.target?.aspect||"")}</span>
            <strong class="vpc-title">${g(p.title||p.id)}</strong>
            <span class="vpc-muted">${q(f.spentUsd)} spent${f.capUsd!=null?` of ${q(f.capUsd)}`:""} \xB7 auto-approve under ${q(f.autoApproveUsd??1)}</span>
          </div>
          <div class="vpc-tools">
            ${N("undo",C.undo,"Undo",t.history?.undo?"":"disabled")}
            ${N("redo",C.redo,"Redo",t.history?.redo?"":"disabled")}
            ${N("storyboard",y.grid,"Generate storyboard")}
            ${N("qa",y.gauge,"QA: score selected takes")}
            ${N("refresh",C.refresh,"Refresh")}
          </div>
        </div>
        ${Zt(p)}
        ${Ut(p,s)}
        ${te(p)}
        ${Lt(p,t,s)}
        ${ee(p)}
        ${Nt(p,t,s)}
        ${_t(p,t,s)}
      </div>`:""}
    </div>`,j=e.querySelector(":scope > .vpc"),I=document.createElement("template");I.innerHTML=E;let M=I.content.firstElementChild;if(!j)e.replaceChildren(M);else{let S=[...j.children],K=[...M.children],nt=U=>`${U.tagName}:${U.className?.replace?.(/ is-[\w-]+/g,"")||""}:${U.querySelector?.("h4")?.textContent||""}`;for(let U=0;U<K.length;U++){let F=K[U],H=S.find(rt=>nt(rt)===nt(F)&&!rt.__vpMatched);H?(H.__vpMatched=!0,H.outerHTML!==F.outerHTML?(F.querySelectorAll?.(".vpc-strip").forEach((rt,ne)=>{rt.scrollLeft=H.querySelectorAll?.(".vpc-strip")[ne]?.scrollLeft||0}),H.replaceWith(F)):j.children[U]!==H&&j.insertBefore(H,j.children[U]||null)):j.insertBefore(F,j.children[U]||null)}S.forEach(U=>{U.__vpMatched||U.remove(),delete U.__vpMatched})}if(Gt(),x&&z&&P!=null&&z.bottom<u){let S=e.getBoundingClientRect().bottom-z.bottom;S&&(x.scrollTop=P+S)}}e.addEventListener("click",async c=>{let p=c.target.closest("[data-vpa]");if(!p||!e.contains(p)||p.disabled||(c.preventDefault(),c.stopPropagation(),t.busy&&!["toggle","view","all-tools","open-studio"].includes(p.dataset.vpa)))return;let f=p.dataset.vpa,x=p.dataset;switch(f){case"toggle":t.openShot=t.openShot===x.s?"":x.s,B(),t.openShot&&!t.models.length&&dt(s).then(u=>{t.models=u,u.length&&B()}),t.openShot&&!(t.presets||[]).length&&ct(s).then(u=>{t.presets=u,u.length&&B()});return;case"view":x.path&&Xt(x.path);return;case"refresh":t.estimateKey="",await m();return;case"undo":case"redo":await T(f==="undo"?"Undoing":"Redoing",()=>V(`/${encodeURIComponent(o)}/${f}`,{})),t.estimateKey="",await m();return;case"approve-anchor":await _([{op:"character.approveAnchor",id:x.c,path:x.path}],"Approving anchor");return;case"reject-anchor":await _([{op:"character.rejectAnchor",id:x.c,path:x.path}],"Removing");return;case"reroll":await tt(`/characters/${encodeURIComponent(x.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await _([{op:"take.select",shotId:x.s,takeId:x.t}],"Swapping take");return;case"redo-shot":await tt("/generate",{shotIds:[x.s],count:Number(x.n)||1},"Estimating");return;case"gen-all":{let u=k().map(z=>z.id);if(!u.length)return;await tt("/generate",{shotIds:u,count:1,approved:!0},"Submitting");return}case"approve-pending":return It();case"cancel-pending":At();return;case"assemble":await _([{op:"timeline.assemble"}],"Assembling");return;case"render":await jt();return;case"all-tools":t.allTools=!t.allTools,B();return;case"open-studio":oe();return;default:t.toast="",await Bt(f,{st:t,d:x,act:Z,ops:_,paint:B,h:s})}}),e.addEventListener("change",async c=>{let p=c.target.closest?.("[data-vpf]");!p||!e.contains(p)||t.busy||await qt(p.dataset.vpf,{st:t,d:p.dataset,ops:_,act:Z,value:p.value,checked:p.checked})}),e.addEventListener("click",c=>{c.target.closest?.("[data-vpf]")&&c.stopPropagation()}),B(),a&&Date.now()-a.at<3e3?h().then(()=>{B(),d()}):r.visible&&m()}var St=null,Mt=!1;function Jt(e=document){Yt(),Mt=!1,e.querySelectorAll?.(Ue).forEach(o=>{try{Le(o)}catch(a){console.warn("[video-project-card] mount failed",a)}})}function We(){if(!(typeof document>"u")){if(!document.getElementById(Qt)){let e=document.createElement("style");e.id=Qt,e.textContent=Ne+Vt,document.head.appendChild(e)}Jt(),!(St||typeof MutationObserver>"u")&&(St=new MutationObserver(()=>{if(Mt)return;Mt=!0,(typeof requestAnimationFrame=="function"?requestAnimationFrame:o=>setTimeout(o,16))(()=>Jt())}),St.observe(document.documentElement,{childList:!0,subtree:!0}))}}var Ne=`
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
`;export{We as installVideoProjectCards};
