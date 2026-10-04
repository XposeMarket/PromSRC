var _=e=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e}</svg>`,C={box:_('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),userPlus:_('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),grid:_('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),gauge:_('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),up:_('<path d="M18 15l-6-6-6 6"/>'),down:_('<path d="M6 9l6 6 6-6"/>'),minus:_('<path d="M5 12h14"/>'),plus:_('<path d="M12 5v14M5 12h14"/>'),mic:_('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),share:_('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),split:_('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),rocket:_('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),download:_('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),check:_('<path d="M5 12l5 5L20 7"/>'),x:_('<path d="M18 6L6 18M6 6l12 12"/>'),pen:_('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),film:_('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),talk:_('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><path d="M17 7a4 4 0 010 6M20 4a8 8 0 010 12"/>'),sparkle:_('<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>'),speaker:_('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>'),copies:_('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),undo:_('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>'),trash:_('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>')},me=null;function De(e){return me||(me=e.vpFetch("/action",{action:"presets"}).then(t=>t?.presets||[]).catch(()=>(me=null,[]))),me}function Ht(e,t,a){let r=t.presets||[],n=e.presetId||"",i=Object.entries({camera:"Camera",vfx:"VFX",look:"Look"}).map(([s,p])=>{let l=r.filter(u=>u.group===s);return l.length?`<optgroup label="${p}">${l.map(u=>`<option value="${a.esc(u.id)}"${u.id===n?" selected":""}>${a.esc(u.label)}</option>`).join("")}</optgroup>`:""}).join(""),c=n&&!r.some(s=>s.id===n)?`<option value="${a.esc(n)}" selected>${a.esc(n)}</option>`:"";return`<select class="vpc-select" data-vpf="presetId" data-s="${a.esc(e.id)}" aria-label="Preset" title="Motion / VFX / look preset"><option value="">No preset</option>${c}${i}</select>`}function Oe(e,t){let a=String(e.modelId||""),r="";return/lipsync/.test(a)?r="lipsync":/omnihuman|ai-avatar/.test(a)?r="talking":e.sourceVideo?r="recast":e.sketch?r="sketch":(t?.kind==="image"||e.kenBurns)&&(r="still"),r?` <span class="vpc-pill is-kind">${r}</span>`:""}function He(e){return`<span class="vpc-ptools" role="toolbar" aria-label="Studio tools">
    ${e.iconBtn("draw",C.pen,"Draw to video (sketch pad)")}
    ${e.iconBtn("recast",C.film,"Recast a video (upload footage)")}
    ${e.iconBtn("talking-photo",C.talk,"Talking photo (upload portrait)")}
    ${e.iconBtn("upscale",C.sparkle,"Upscale selected takes")}
    ${e.iconBtn("foley",C.speaker,"Add foley / sound effects")}
    ${e.iconBtn("batch",C.copies,"Make ad variants (hooks + creators)")}
  </span>`}function Me(e,t="",a=""){return new Promise(r=>{let n=document.createElement("div");n.className="vpc-sketch";let o=s=>String(s).replace(/[&<>"]/g,p=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[p]);n.innerHTML=`<div class="vpc-sketch-box vpc-ask" role="dialog" aria-label="${o(e)}">
      <label class="vpc-ask-title">${o(e)}</label>
      <textarea rows="3" placeholder="${o(t)}">${o(a)}</textarea>
      <div class="vpc-sketch-bar"><span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${C.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Continue" aria-label="Continue">${C.check}</button>
      </div></div>`,document.body.appendChild(n);let i=n.querySelector("textarea");setTimeout(()=>{i.focus(),i.setSelectionRange(i.value.length,i.value.length)},30);let c=s=>{n.remove(),r(s)};i.addEventListener("keydown",s=>{s.key==="Enter"&&(s.metaKey||s.ctrlKey)&&c(i.value.trim()),s.key==="Escape"&&c("")}),n.addEventListener("click",s=>{let p=s.target.closest("button");if(!p){s.target===n&&c("");return}c(p.dataset.k==="ok"?i.value.trim():"")})})}function Wt(){return new Promise(e=>{let t=document.createElement("div");t.className="vpc-sketch",t.innerHTML=`<div class="vpc-sketch-box" role="dialog" aria-label="Sketch pad">
      <canvas width="720" height="720"></canvas>
      <div class="vpc-sketch-bar">
        ${[3,8,18].map((u,x)=>`<button type="button" class="vpc-icon${x===1?" is-on":""}" data-w="${u}" title="Brush ${["S","M","L"][x]}" aria-label="Brush ${["small","medium","large"][x]}"><span class="vpc-dotb" style="width:${u/2+4}px;height:${u/2+4}px"></span></button>`).join("")}
        <button type="button" class="vpc-icon" data-k="undo" title="Undo" aria-label="Undo">${C.undo}</button>
        <button type="button" class="vpc-icon" data-k="clear" title="Clear" aria-label="Clear">${C.trash}</button>
        <span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${C.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Use sketch" aria-label="Use sketch">${C.check}</button>
      </div></div>`,document.body.appendChild(t);let a=t.querySelector("canvas"),r=a.getContext("2d"),n=[],o=8,i=null,c=()=>{r.fillStyle="#fff",r.fillRect(0,0,a.width,a.height),r.strokeStyle="#111",r.lineCap="round",r.lineJoin="round";for(let u of n)r.lineWidth=u.w,r.beginPath(),u.pts.forEach(([x,b],S)=>S?r.lineTo(x,b):r.moveTo(x,b)),u.pts.length===1&&r.lineTo(u.pts[0][0]+.1,u.pts[0][1]),r.stroke()},s=u=>{let x=a.getBoundingClientRect();return[(u.clientX-x.left)*(a.width/x.width),(u.clientY-x.top)*(a.height/x.height)]};a.style.touchAction="none",a.addEventListener("pointerdown",u=>{a.setPointerCapture(u.pointerId),i={w:o,pts:[s(u)]},n.push(i),c()}),a.addEventListener("pointermove",u=>{i&&(i.pts.push(s(u)),c())});let p=()=>{i=null};a.addEventListener("pointerup",p),a.addEventListener("pointercancel",p),c();let l=u=>{t.remove(),e(u)};t.addEventListener("click",u=>{let x=u.target.closest("button");if(!x){u.target===t&&l(null);return}if(x.dataset.w){o=Number(x.dataset.w),t.querySelectorAll("[data-w]").forEach(S=>S.classList.toggle("is-on",S===x));return}let b=x.dataset.k;b==="undo"?(n.pop(),c()):b==="clear"?(n.length=0,c()):b==="cancel"?l(null):b==="ok"&&l(n.length?a.toDataURL("image/png").replace(/^data:[^,]*,/,""):null)})})}var Gt={openai:["alloy","ash","coral","echo","fable","nova","onyx","sage","shimmer"],xai:["ara","rex","sal","eve","leo"]},Yt=["bold","pop","minimal","karaoke"],Jt=["9:16","1:1","16:9"];function We(e,t,a,r){let n="vpc-thumb";if(t?.poster)return`<img class="${n}" src="${r.esc(r.mediaUrl(t.poster))}" alt="" loading="lazy" decoding="async">`;if(t?.path&&r.isVideo(t.path))return`<video class="${n}" src="${r.esc(r.mediaUrl(t.path))}#t=0.1" muted playsinline preload="metadata"></video>`;if(t?.path)return r.thumb(t.path,n);if(e?.storyboard)return r.thumb(e.storyboard,n);let o=(e?.characterIds||[])[0],i=(a?.characters||[]).find(c=>c.id===o)||(a?.characters||[])[0];return r.thumb((i?.anchors||[])[0],n)}function Ge(e){return e?.kind==="product"?'<span class="vpc-pill is-product">Product</span>':""}var ge=null;function Ye(e){return ge||(ge=e.vpFetch("/action",{action:"models"}).then(t=>(t?.models||[]).filter(a=>!a.kind||a.kind==="video")).catch(()=>(ge=null,[]))),ge}function Je(e,t,a,r,n){let o=n.esc(e.id),i=r.models||[],c=e.modelId||"",s=['<option value="">Default model</option>',...i.map(p=>`<option value="${n.esc(p.id)}"${p.id===c?" selected":""}>${n.esc(p.label||p.id)}${p.price!=null?` \xB7 ${n.esc(typeof p.price=="number"?n.usd(p.price):p.price)}`:""}</option>`)];return c&&!i.some(p=>p.id===c)&&s.push(`<option value="${n.esc(c)}" selected>${n.esc(c)}</option>`),`<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${o}">${n.esc(e.prompt||"")}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${o}" placeholder="Spoken line for this shot">${n.esc(e.line||"")}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${n.iconBtn("dur",C.minus,"Shorter",`data-s="${o}" data-d="-1" ${Number(e.durationSec)<=1?"disabled":""}`)}
        <span>${Number(e.durationSec)||0}s</span>
        ${n.iconBtn("dur",C.plus,"Longer",`data-s="${o}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${o}" aria-label="Model">${s.join("")}</select>
      ${Ht(e,r,n)}
      <span class="vpc-grow"></span>
      ${n.iconBtn("move",C.up,"Move up",`data-s="${o}" data-i="${t-1}" ${t===0?"disabled":""}`)}
      ${n.iconBtn("move",C.down,"Move down",`data-s="${o}" data-i="${t+1}" ${t>=a-1?"disabled":""}`)}
      ${(e.takes||[]).length>=2?n.iconBtn("variants",C.split,"Render hook variants (one export per take)",`data-s="${o}"`):""}
    </div>
    ${e.voiceover?.path?`<audio class="vpc-audio" src="${n.esc(n.mediaUrl(e.voiceover.path))}" controls preload="none"></audio>`:""}
  </div>`}function Xe(e,t){let a=e?.qa;if(!a||a.score==null)return"";let r=Number(a.score),n=r>=7?"good":r>=5?"warn":"bad",o=[`QA ${r}/10${a.verdict?` \xB7 ${a.verdict}`:""}${a.model?` \xB7 ${a.model}`:""}`,...a.issues||[]].join(`
`);return`<span class="vpc-qa is-${n}" title="${t.esc(o)}" aria-label="${t.esc(o)}">${r}</span>`}function Ke(e,t){let a=e.shots||[];if(!a.some(o=>o.storyboard||(o.storyboardCandidates||[]).length))return"";let r=a.some(o=>!o.storyboard&&(o.storyboardCandidates||[]).length);return`<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${a.map((o,i)=>{let c=t.esc(o.id),s=(o.storyboardCandidates||[]).find(u=>u!==o.storyboard),p=o.storyboard||s;if(!p)return`<div class="vpc-sb is-empty"><span class="vpc-sb-n">${i+1}</span></div>`;let l=!o.storyboard&&s?`<div class="vpc-tile-actions">
        ${t.iconBtn("sb-approve",C.check,"Approve storyboard",`data-s="${c}" data-path="${t.esc(s)}"`,"is-go")}
        ${t.iconBtn("sb-reject",C.x,"Reject storyboard",`data-s="${c}" data-path="${t.esc(s)}"`)}
      </div>`:`<span class="vpc-badge">${C.check}</span>`;return`<div class="vpc-sb${o.storyboard?" is-approved":""}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${t.esc(p)}" aria-label="View storyboard ${i+1}">${t.thumb(p,"vpc-tile-img")}</button>
      <span class="vpc-sb-n">${i+1}</span>${l}</div>`}).join("")}</div>
    ${r?`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${C.check}<span>Approve all</span></button>`:""}
  </section>`}function Ze(e,t,a){if(!(e.shots||[]).length)return"";let r=e.voice||{},n=r.provider||"openai",o=Object.entries(Gt).map(([b,S])=>`<optgroup label="${b==="xai"?"xAI":"OpenAI"}">${S.map(m=>`<option value="${b}:${m}"${b===n&&m===r.voice?" selected":""}>${m}</option>`).join("")}</optgroup>`).join(""),i=e.captions||{},c=e.music||null,s=c?/chill/i.test(c.label||c.path||"")?"chill":/pulse/i.test(c.label||c.path||"")?"pulse":"custom":"none",p=(e.shots||[]).some(b=>b.line),l=Math.round((c?.volume??.3)*100),u=(e.audioMode||"voiceover")==="native";return`<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    ${`<div class="vpc-row vpc-wrap" role="radiogroup" aria-label="Who speaks the lines">
      <span class="vpc-muted">Speech</span>
      ${[["native","On camera","The creator speaks each line in the clip; captions transcribe the clip audio"],["voiceover","Narrator","TTS voiceover over dialogue-free clips; captions follow the voiceover"]].map(([b,S,m])=>`<button type="button" class="vpc-chip${(u?"native":"voiceover")===b?" is-on":""}" data-vpa="audio-mode" data-v="${b}" role="radio" aria-checked="${(u?"native":"voiceover")===b}" title="${m}">${S}</button>`).join("")}
    </div>`}
    ${u?`<div class="vpc-row vpc-wrap"><button type="button" class="vpc-btn" data-vpa="transcribe" title="Re-read what each clip says for captions">${C.mic}<span>Transcribe clips</span></button></div>`:`<div class="vpc-row vpc-wrap">
      ${C.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${r.voice?"":'<option value="" selected>Pick a voice</option>'}${o}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${p?"":'disabled title="Add voiceover lines to shots first"'}>${C.mic}<span>Voiceover</span></button>
    </div>`}
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${i.enabled?" checked":""}><span>Captions</span></label>
      ${Yt.map(b=>`<button type="button" class="vpc-chip${(i.style||"bold")===b&&i.enabled?" is-on":""}" data-vpa="cap-style" data-v="${b}" aria-pressed="${(i.style||"bold")===b&&!!i.enabled}">${b}</button>`).join("")}
      ${i.cues?.length?`<span class="vpc-muted">${i.cues.length} cues</span>`:""}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[["pulse","Pulse"],["chill","Chill"],["none","None"]].map(([b,S])=>`<button type="button" class="vpc-chip${s===b?" is-on":""}" data-vpa="music" data-v="${b}" aria-pressed="${s===b}">${S}</button>`).join("")}
      ${s==="custom"?`<span class="vpc-chip is-on">${a.esc(c.label||"Custom")}</span>`:""}
      ${c?`<input class="vpc-range" type="range" min="0" max="100" value="${l}" data-vpf="volume" aria-label="Music volume" title="Music volume ${l}%">`:""}
    </div>
  </section>`}function Qe(e,t,a){let r=[],n=e.lastRun;n?.steps?.length&&r.push(`<ol class="vpc-steps">${n.steps.map(i=>`<li class="is-${a.esc(i.state)}" title="${a.esc(i.note||i.state)}"><span class="vpc-dot"></span>${a.esc(i.step)}${i.note?` <small class="vpc-muted">${a.esc(String(i.note).slice(0,80))}</small>`:""}</li>`).join("")}</ol>`);let o=t.actPending||(n?.needsApproval?{action:"run",args:{},usd:n.needsApproval.usd,breakdown:n.needsApproval.breakdown}:null);if(o){let i=(o.breakdown||[]).map(c=>`<li>${a.esc(c.item)} \xB7 ${a.usd(c.usd)}</li>`).join("");r.push(`<div class="vpc-approve">
      <strong>${o.action==="storyboard"?"Storyboard":o.action==="run"?"Autopilot":a.esc(o.action)} needs approval \xB7 ${a.usd(o.usd)}</strong>
      ${i?`<ul>${i}</ul>`:""}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${C.check}<span>Approve ${a.usd(o.usd)}</span></button>
        ${a.iconBtn("act-cancel",C.x,"Cancel")}
      </div></div>`)}return(e.shots||[]).length&&r.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${t.busy?"disabled":""}>${C.rocket}<span>Run all</span></button>`),r.length?`<section class="vpc-sec"><h4>Autopilot</h4>${r.join("")}</section>`:""}function et(e,t,a){let r=(e.exports||[]).slice().reverse(),n=Jt.map(i=>`<button type="button" class="vpc-chip${t.aspects.has(i)?" is-on":""}" data-vpa="aspect" data-v="${i}" aria-pressed="${t.aspects.has(i)}">${i}</button>`).join(""),o=r.slice(0,6).map(i=>{let c=a.mediaUrl(i.path),s=[i.aspect,i.variant?`variant ${i.variant}`:"",`${Number(i.durationSec||0).toFixed(1)}s`].filter(Boolean).join(" \xB7 ");return`<div class="vpc-export">
      <video src="${a.esc(c)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${a.esc(s)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${a.esc(c)}" download="${a.esc(String(i.path).split("/").pop())}" title="Download" aria-label="Download">${C.download}</a>
        ${a.iconBtn("share",C.share,"Share",`data-path="${a.esc(i.path)}"`)}
      </div></div>`}).join("");return`<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${n}</div>
    ${o?`<div class="vpc-exports">${o}</div>`:""}</section>`}function Ee(e="image/*"){return new Promise(t=>{let a=document.createElement("input");a.type="file",a.accept=e,a.style.display="none",a.addEventListener("change",()=>{let r=a.files&&a.files[0];if(a.remove(),!r)return t(null);let n=new FileReader;n.onload=()=>t({filename:r.name,dataBase64:String(n.result||"").replace(/^data:[^,]*,/,"")}),n.onerror=()=>t(null),n.readAsDataURL(r)}),document.body.appendChild(a),a.click()})}async function Xt(e,t){let a=t.mediaUrl(e);try{a=new URL(a,location.href).href}catch{}if(navigator.share)try{return await navigator.share({title:"Video",url:a}),"Shared"}catch{return""}try{return await navigator.clipboard.writeText(a),"Link copied"}catch{return"Copy failed"}}async function tt(e,t){let{st:a,d:r,act:n,ops:o,paint:i,h:c}=t,s=a.project||{},p=l=>(s.shots||[]).find(u=>u.id===l);switch(e){case"upload-product":case"upload-character":{let l=await Ee();return l&&await n("import_asset",{...l,role:e==="upload-product"?"product":"character",name:l.filename.replace(/\.[^.]+$/,"")},"Uploading"),!0}case"storyboard":return await n("storyboard",{},"Storyboarding"),!0;case"sb-approve":return await o([{op:"shot.approveStoryboard",id:r.s,path:r.path}],"Approving storyboard"),!0;case"sb-reject":return await o([{op:"shot.rejectStoryboard",id:r.s,path:r.path}],"Rejecting"),!0;case"sb-approve-all":{let l=(s.shots||[]).filter(u=>!u.storyboard&&(u.storyboardCandidates||[]).length).map(u=>({op:"shot.approveStoryboard",id:u.id,path:u.storyboardCandidates[0]}));return l.length&&await o(l,"Approving storyboard"),!0}case"dur":{let l=p(r.s);if(!l)return!0;let u=Math.max(1,Math.min(30,(Number(l.durationSec)||5)+Number(r.d)));return await o([{op:"shot.update",id:r.s,durationSec:u}],"Saving"),!0}case"move":return await o([{op:"shot.move",id:r.s,index:Number(r.i)}],"Reordering"),!0;case"variants":return await n("render_variants",{shotId:r.s},"Rendering hook variants",900*1e3),!0;case"qa":return await n("qa",{},"Scoring takes",300*1e3),!0;case"voiceover":return await n("voiceover",{},"Recording voiceover",300*1e3),!0;case"audio-mode":return await o([{op:"project.update",audioMode:r.v}],r.v==="native"?"Using on-camera dialogue":"Using a narrator"),!0;case"transcribe":return await n("transcribe",{force:!0},"Transcribing clips",3e5)&&s.captions?.enabled&&await n("captions",{style:s.captions.style},"Rebuilding captions"),!0;case"cap-style":{let l=r.v;return await n("captions",{style:l},"Building captions")&&await o([{op:"captions.set",enabled:!0,style:l}],"Saving captions"),!0}case"music":return r.v==="none"?await o([{op:"music.clear"}],"Removing music"):await n("music",{builtin:r.v},"Adding music"),!0;case"run-all":return await n("run",{},"Running autopilot",1800*1e3),!0;case"act-approve":{let l=a.actPending||(s.lastRun?.needsApproval?{action:"run",args:{}}:null);return a.actPending=null,l&&await n(l.action,{...l.args||{},approved:!0},"Submitting",1800*1e3),!0}case"act-cancel":return a.actPending=null,s.lastRun&&(s.lastRun.needsApproval=void 0),i(),!0;case"aspect":return a.aspects.has(r.v)?a.aspects.delete(r.v):a.aspects.add(r.v),i(),!0;case"draw":{let l=await Wt();if(!l)return!0;let u=await Me("What should this sketch become?","A cinematic scene at golden hour");return u&&await n("draw_to_video",{dataBase64:l,prompt:u},"Sketch to video",900*1e3),!0}case"recast":{let l=await Ee("video/*");if(!l)return!0;let u=await n("import_asset",{...l,role:"footage"},"Uploading footage",300*1e3);if(!u?.assetPath)return!0;let x=await Me("Recast it as\u2026","New character, outfit, world or style");return x&&await n("recast",{sourcePath:u.assetPath,prompt:x,mode:"edit"},"Recasting",900*1e3),!0}case"talking-photo":{let l=await Ee();if(!l)return!0;let u=await n("import_asset",{...l,role:"asset"},"Uploading portrait");if(!u?.assetPath)return!0;let x=await Me("What should they say?","Hey! You have to try this.");return x&&await n("talking_photo",{imagePath:u.assetPath,line:x},"Talking photo",900*1e3),!0}case"upscale":return await n("upscale",{},"Upscaling",900*1e3),!0;case"foley":return await n("foley",{},"Adding sound",900*1e3),!0;case"batch":return await n("batch_variants",{count:3,vary:["hook","creator"]},"Planning variants",300*1e3),!0;case"share":{let l=await Xt(r.path,c);return l&&(a.error="",a.busy="",a.toast=l,i()),!0}default:return!1}}async function rt(e,t){let{d:a,ops:r,value:n,checked:o,st:i}=t;switch(e){case"prompt":case"line":case"modelId":case"presetId":{let c=(i.project?.shots||[]).find(s=>s.id===a.s);if(c&&String(c[e]||"")===n)return;await r([{op:"shot.update",id:a.s,[e]:n}],"Saving");return}case"voice":{let[c,s]=String(n).split(":");s&&await r([{op:"voice.set",provider:c,voice:s}],"Setting voice");return}case"captions":{let c=i.project?.captions?.style||"bold";o&&!(i.project?.captions?.cues||[]).length&&await t.act("captions",{style:c},"Building captions"),await r([{op:"captions.set",enabled:!!o,style:c}],"Saving captions");return}case"volume":{let c=i.project?.music;c?.path&&await r([{op:"music.set",path:c.path,volume:Number(n)/100,duck:c.duck!==!1}],"Saving");return}default:}}var at=`
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
`;var nt="prom-vp-card-style",Kt=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",ot=new Map,D=(e,t="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${t}>${e}</svg>`,I={film:D('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:D('<path d="M5 12l5 5L20 7"/>'),x:D('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:D('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:D('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:D('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:D('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:D('<path d="M7 4v16l13-8z"/>'),seq:D('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:D('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:D('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:D('<path d="M6 9l6 6 6-6"/>'),user:D('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:D('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:D('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function k(e){return String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function ee(e){return`$${(Number(e)||0).toFixed(2)}`}function ve(e){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(e||""))}function ze(e){return String(e||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function se(e){let t=String(e||"").trim();if(!t)return"";if(/^(https?:|data:|blob:)/i.test(t))return t;let a=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof a=="function")try{let r=a(t);if(r)return String(r)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}async function te(e,t,a=2e4){let r={method:t===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:t===void 0?void 0:JSON.stringify(t),timeoutMs:a},n=`/api/video-projects${e}`,o=window.__promVideoProjectFetch||window.api,i;if(typeof o=="function")i=await o(n,r);else{let c=await fetch(n,r);i=await c.json().catch(()=>({success:!1,error:`HTTP ${c.status}`}))}if(i&&i.success===!1)throw new Error(i.error||"Request failed");return i||{}}function it(e){let t=e?.takes||[];return t.length?t.find(a=>a.id===e.selectedTakeId)||t[t.length-1]:null}function Ae(e,t="vpc-thumb"){if(!e)return`<span class="${t} is-empty">${I.film}</span>`;let a=k(se(e));return ve(e)?`<video class="${t}" src="${a}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${t}" src="${a}" alt="" loading="lazy" decoding="async">`}function W(e,t,a,r="",n=""){return`<button type="button" class="vpc-icon${n?` ${n}`:""}" data-vpa="${e}" title="${k(a)}" aria-label="${k(a)}" ${r}>${t}</button>`}function Zt(e){e.dataset.vpMounted="1";let t=String(e.dataset.vpProject||""),a=ot.get(t),r={project:a?.project||null,history:a?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1,actPending:null,models:[],aspects:new Set,toast:""},n={esc:k,usd:ee,isVideo:ve,mediaUrl:se,thumb:Ae,iconBtn:W,vpFetch:te},o=null,i=()=>e.isConnected;function c(f){f?.project&&(r.project=f.project),f?.history&&(r.history=f.history),r.project&&ot.set(t,{project:r.project,history:r.history,at:Date.now()})}async function s(){if(i()){try{c(await te(`/${encodeURIComponent(t)}`)),r.error=""}catch(f){r.error=String(f?.message||f)}await x(),B(),l()}}function p(){return(r.project?.jobs||[]).filter(f=>f.state==="queued"||f.state==="running")}function l(){clearTimeout(o),i()&&(p().length||r.rendering)&&(o=setTimeout(s,3500))}function u(){let f=new Set(p().map(g=>g.target?.shotId).filter(Boolean));return(r.project?.shots||[]).filter(g=>!(g.takes||[]).length&&!f.has(g.id))}async function x(){let f=u(),g=f.map($=>`${$.id}:${$.modelId||""}:${$.durationSec}:${($.characterIds||[]).join(",")}`).join("|")+`#${(r.project?.characters||[]).map($=>($.anchors||[]).length).join(",")}`;if(!f.length){r.estimate=null,r.estimateKey="";return}if(!(g===r.estimateKey&&r.estimate))try{r.estimate=await te(`/${encodeURIComponent(t)}/estimate`,{shotIds:f.map($=>$.id)}),r.estimateKey=g}catch($){r.estimate=null,r.error=String($?.message||$)}}async function b(f,g){r.busy=f,r.error="",B();try{let $=await g();return c($),$}catch($){return r.error=String($?.message||$),null}finally{r.busy="",B()}}async function S(f,g){await b(g,()=>te(`/${encodeURIComponent(t)}/ops`,{ops:f})),await s()}async function m(f,g={},$="Working",E=12e4){let v=await b($,()=>te(`/${encodeURIComponent(t)}/action`,{action:f,...g},E));if(!v)return null;let H=v.needsApproval;if(H){let q=v.lastRun?.needsApproval,F=v.shotId?{...g,pendingShotId:v.shotId}:g;F.pendingShotId&&F.dataBase64&&delete F.dataBase64,r.actPending={action:f,args:F,usd:Number(q?.usd??H?.usd??v.estimateUsd??v.totalUsd??v.estimate?.total??0),breakdown:q?.breakdown||H?.breakdown||v.breakdown||[]}}else r.actPending=null;return r.estimateKey="",await s(),v}async function w(f,g,$){let E=await b($,()=>te(`/${encodeURIComponent(t)}${f}`,g,12e4));if(E){if(E.needsApproval){r.pending={path:f,body:{...g,approved:!0},label:$,reason:E.reason,estimate:E.estimate},B();return}r.pending=null,r.estimateKey="",await s()}}async function h(){let f=r.project;if(!f)return;let g=(f.clips||[]).some($=>$.source&&"shotId"in $.source);if(r.rendering=!0,r.aspects.size){await m("render",{aspects:[...r.aspects]},"Rendering",900*1e3),r.rendering=!1,await s();return}if(!g&&!await b("Assembling",()=>te(`/${encodeURIComponent(t)}/ops`,{ops:[{op:"timeline.assemble"}]}))){r.rendering=!1,B();return}await b("Rendering",()=>te(`/${encodeURIComponent(t)}/render`,{},900*1e3)),r.rendering=!1,await s()}function y(f,g){let $=se(f);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:$,path:f,name:g||f.split("/").pop(),kind:ve(f)?"video":"image"});return}catch{}window.open($,"_blank","noopener")}function z(f){let g=`${W("upload-product",C.box,"Upload product photo")}${W("upload-character",C.userPlus,"Upload character photo")}${He(n)}`;if(!(f.characters||[]).length)return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${g}</h4></section>`;let $=p().filter(v=>v.target?.characterId),E=f.characters.map(v=>{let H=$.some(P=>P.target.characterId===v.id),q=(v.anchors||[])[0],F=v.candidates||[],Y=q?"Anchor approved":F.length?"Pick an anchor":H?"Generating anchor":"No anchor yet",N=[q?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${k(q)}" aria-label="View anchor">${Ae(q,"vpc-tile-img")}</button><span class="vpc-badge">${I.check}</span></div>`:"",...F.map(P=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${k(P)}" aria-label="View candidate">${Ae(P,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${W("approve-anchor",I.check,"Approve as anchor",`data-c="${k(v.id)}" data-path="${k(P)}"`,"is-go")}
            ${W("reject-anchor",I.x,"Reject",`data-c="${k(v.id)}" data-path="${k(P)}"`)}
          </div>
        </div>`),H?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${I.user}<strong>${k(v.name)}</strong>${Ge(v)}</span>
          <span class="vpc-muted">${k(Y)}</span>
          <span class="vpc-grow"></span>
          ${v.anchorPrompt?W("reroll",I.reroll,"Generate another anchor",`data-c="${k(v.id)}"`):""}
        </div>
        ${N?`<div class="vpc-strip">${N}</div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${g}</h4>${E}</section>`}function T(f){let g=f.shots||[];if(!g.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let $=new Set(p().map(v=>v.target?.shotId).filter(Boolean)),E=g.map((v,H)=>{let q=it(v),F=$.has(v.id),Y=r.openShot===v.id,N=(v.takes||[]).length,P=Y?(v.takes||[]).slice().reverse().map(V=>`
        <div class="vpc-take${V.id===q?.id?" is-selected":""}">
          ${ve(V.path)?`<video src="${k(se(V.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${k(se(V.path))}" alt="" loading="lazy">`}
          <div class="vpc-row">
            ${Xe(V,n)}<span class="vpc-muted">${k(ze(V.modelId))} \xB7 ${ee(V.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${V.id===q?.id?`<span class="vpc-inuse">${I.check}In cut</span>`:W("use-take",I.check,"Use this take",`data-s="${k(v.id)}" data-t="${k(V.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${Y?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${k(v.id)}" aria-expanded="${Y}">
          ${F&&!q?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':We(v,q,f,n)}
          <span class="vpc-shot-meta">
            <strong>${H+1}. ${k(v.title||"Shot")}${Oe(v,q)}</strong>
            <small>${k(String(v.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${F?"generating":k(v.status)}">${F?"generating":k(v.status)} \xB7 ${v.durationSec}s \xB7 ${N} take${N===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${I.chevron}</span>
        </button>
        ${Y?`<div class="vpc-shot-body">
          ${Je(v,H,g.length,r,n)}
          ${v.camera?`<p class="vpc-muted">Camera: ${k(v.camera)}</p>`:""}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${k(v.id)}" data-n="1" ${F?"disabled":""}>${I.reroll}<span>${N?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${k(v.id)}" data-n="3" ${F?"disabled":""}>${I.layers}<span>3 variations</span></button>
          </div>
          ${P?`<div class="vpc-takes">${P}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${g.length}</span></h4>${E}</section>`}function re(f){let g=[];if(r.pending){let N=(r.pending.estimate?.shots||[]).map(P=>`<li>${k(P.title||"Item")}: ${P.count}\xD7 ${k(ze(P.modelId))} \xB7 ${ee(P.usd)}</li>`).join("");g.push(`<div class="vpc-approve">
        <strong>Approve ${ee(r.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${k(r.pending.reason||"")}</p>
        ${N?`<ul>${N}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${I.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${I.x}<span>Cancel</span></button>
        </div>
      </div>`)}let $=u(),E=r.estimate;if(!r.pending&&$.length&&E){let N=(E.shots||[]).flatMap(V=>(V.problems||[]).map(Ot=>`${V.title}: ${Ot}`)),P=(f.characters||[]).some(V=>!(V.anchors||[]).length&&(V.candidates||[]).length);g.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${$.length} shot${$.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${ee(E.total)}</strong></div>
        ${P?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${N.length?`<ul class="vpc-warn">${N.map(V=>`<li>${k(V)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${P?"disabled":""}>${I.spark}<span>${E.total>(f.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${ee(E.total)}</span></button>
      </div>`)}let v=p();v.length&&g.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${v.length} job${v.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let H=(f.jobs||[]).filter(N=>N.state==="failed").slice(-2);H.length&&!v.length&&g.push(`<ul class="vpc-warn">${H.map(N=>`<li>${k(ze(N.modelId))} failed: ${k(String(N.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let q=f.shots||[],F=q.length&&q.every(N=>it(N)),Y=(f.exports||[]).slice(-1)[0];return(F||Y)&&g.push(`<div class="vpc-final">
        ${Y?`<video src="${k(se(Y.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(Y.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${W("view",I.download,"Open video",`data-path="${k(Y.path)}"`)}</div>`:""}
        ${F?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${r.rendering||v.length?"disabled":""}>${r.rendering?'<span class="vpc-spin"></span>':I.play}<span>${Y?"Re-render":"Render video"}</span></button>
          ${W("assemble",I.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),g.length?`<section class="vpc-sec vpc-actions">${g.join("")}</section>`:""}function B(){if(!i())return;let f=document.activeElement;if(f&&e.contains(f)&&f.matches?.("textarea[data-vpf]")&&!r.busy)return;let g=r.project;if(!g){e.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${I.film}Video project</span></div>
        <p class="vpc-muted">${r.error?k(r.error):"Loading\u2026"}</p></div>`;return}let $=g.budget||{};e.innerHTML=`<div class="vpc">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${I.film}Video project \xB7 ${k(g.target?.aspect||"")}</span>
          <strong class="vpc-title">${k(g.title||g.id)}</strong>
          <span class="vpc-muted">${ee($.spentUsd)} spent${$.capUsd!=null?` of ${ee($.capUsd)}`:""} \xB7 auto-approve under ${ee($.autoApproveUsd??1)}</span>
        </div>
        <div class="vpc-tools">
          ${W("undo",I.undo,"Undo",r.history?.undo?"":"disabled")}
          ${W("redo",I.redo,"Redo",r.history?.redo?"":"disabled")}
          ${W("storyboard",C.grid,"Generate storyboard")}
          ${W("qa",C.gauge,"QA: score selected takes")}
          ${W("refresh",I.refresh,"Refresh")}
        </div>
      </div>
      ${r.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${k(r.busy)}\u2026</div>`:""}
      ${r.error?`<p class="vpc-err">${k(r.error)}</p>`:""}
      ${r.toast?`<div class="vpc-toast">${k(r.toast)}</div>`:""}
      ${z(g)}
      ${Ke(g,n)}
      ${T(g)}
      ${Ze(g,r,n)}
      ${re(g)}
      ${Qe(g,r,n)}
      ${et(g,r,n)}
    </div>`}e.addEventListener("click",async f=>{let g=f.target.closest("[data-vpa]");if(!g||!e.contains(g)||g.disabled||(f.preventDefault(),f.stopPropagation(),r.busy&&g.dataset.vpa!=="toggle"&&g.dataset.vpa!=="view"))return;let $=g.dataset.vpa,E=g.dataset;switch($){case"toggle":r.openShot=r.openShot===E.s?"":E.s,B(),r.openShot&&!r.models.length&&Ye(n).then(v=>{r.models=v,v.length&&B()}),r.openShot&&!(r.presets||[]).length&&De(n).then(v=>{r.presets=v,v.length&&B()});return;case"view":E.path&&y(E.path);return;case"refresh":r.estimateKey="",await s();return;case"undo":case"redo":await b($==="undo"?"Undoing":"Redoing",()=>te(`/${encodeURIComponent(t)}/${$}`,{})),r.estimateKey="",await s();return;case"approve-anchor":await S([{op:"character.approveAnchor",id:E.c,path:E.path}],"Approving anchor");return;case"reject-anchor":await S([{op:"character.rejectAnchor",id:E.c,path:E.path}],"Removing");return;case"reroll":await w(`/characters/${encodeURIComponent(E.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await S([{op:"take.select",shotId:E.s,takeId:E.t}],"Swapping take");return;case"redo-shot":await w("/generate",{shotIds:[E.s],count:Number(E.n)||1},"Estimating");return;case"gen-all":{let v=u().map(H=>H.id);if(!v.length)return;await w("/generate",{shotIds:v,count:1,approved:!0},"Submitting");return}case"approve-pending":{let v=r.pending;if(!v)return;r.pending=null,await w(v.path,v.body,"Submitting");return}case"cancel-pending":r.pending=null,B();return;case"assemble":await S([{op:"timeline.assemble"}],"Assembling");return;case"render":await h();return;default:r.toast="",await tt($,{st:r,d:E,act:m,ops:S,paint:B,h:n})}}),e.addEventListener("change",async f=>{let g=f.target.closest?.("[data-vpf]");!g||!e.contains(g)||r.busy||await rt(g.dataset.vpf,{st:r,d:g.dataset,ops:S,act:m,value:g.value,checked:g.checked})}),e.addEventListener("click",f=>{f.target.closest?.("[data-vpf]")&&f.stopPropagation()}),B(),a&&Date.now()-a.at<3e3?x().then(()=>{B(),l()}):s()}var je=null,Te=!1;function st(e=document){Te=!1,e.querySelectorAll?.(Kt).forEach(t=>{try{Zt(t)}catch(a){console.warn("[video-project-card] mount failed",a)}})}function ct(){if(!(typeof document>"u")){if(!document.getElementById(nt)){let e=document.createElement("style");e.id=nt,e.textContent=Qt+at,document.head.appendChild(e)}st(),!(je||typeof MutationObserver>"u")&&(je=new MutationObserver(()=>{if(Te)return;Te=!0,(typeof requestAnimationFrame=="function"?requestAnimationFrame:t=>setTimeout(t,16))(()=>st())}),je.observe(document.documentElement,{childList:!0,subtree:!0}))}}var Qt=`
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
`;var pt="prom-gp-card-style",er=".prom-gp-card[data-gp-project]:not([data-gp-mounted])",ce=["design","art","audio","code","playable","published"],O=e=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e}</svg>`,j={pad:O('<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 11h.01M18 13h.01"/>'),check:O('<path d="M5 12l5 5L20 7"/>'),x:O('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:O('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:O('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),play:O('<path d="M7 4v16l13-8z"/>'),stop:O('<rect x="6" y="6" width="12" height="12" rx="2"/>'),ext:O('<path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5"/>'),copy:O('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),refresh:O('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),music:O('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),wand:O('<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>'),code:O('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),rocket:O('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>'),phone:O('<rect x="7" y="2" width="10" height="20" rx="2"/>')};function M(e){return String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function fe(e){return`$${(Number(e)||0).toFixed(2)}`}function dt(e,t,a){let r=String(t||"").trim();if(!r)return"";let n=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof n=="function")try{let o=n(r);if(o)return String(o)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(r)}${a?`&v=${a}`:""}`}function _e(e){return`${typeof window<"u"&&typeof window.__promGatewayBase=="string"?window.__promGatewayBase.replace(/\/$/,""):""}/api/game-projects/${encodeURIComponent(e)}/play/`}async function lt(e,t,a=3e4){let r={method:t===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:t===void 0?void 0:JSON.stringify(t),timeoutMs:a},n=`/api/game-projects${e}`,o=window.__promVideoProjectFetch||window.api,i;if(typeof o=="function")i=await o(n,r);else{let c=await fetch(n,r);i=await c.json().catch(()=>({success:!1,error:`HTTP ${c.status}`}))}if(i&&i.success===!1)throw new Error(i.error||"Request failed");return i}function U(e,t,a,r="",n=""){return`<button type="button" class="gpc-icon${n?` ${n}`:""}" data-gpa="${e}" title="${M(a)}" aria-label="${M(a)}" ${r}>${t}</button>`}function tr(e){e.dataset.gpMounted="1";let t=String(e.dataset.gpProject||""),a={project:null,error:"",busy:"",pending:null,timer:0,playing:null,portrait:!1,showPlay:!0},r=m=>m.kind!=="sfx"&&m.kind!=="music",n=()=>(a.project?.assets||[]).some(m=>m.status==="generating");async function o(){try{let m=await lt(`/${encodeURIComponent(t)}`);a.project=m.project,a.error=""}catch(m){a.error=String(m?.message||m)}b(),i()}function i(){clearTimeout(a.timer),e.isConnected&&(n()||a.busy)&&(a.timer=setTimeout(o,3e3))}async function c(m,w={}){a.busy=m,a.error="",b();try{let h=await lt(`/${encodeURIComponent(t)}/action`,{action:m,...w});h.needsApproval||h.blocked?a.pending={action:m,args:w,usd:h.usd,reason:h.reason,blocked:!!h.blocked,estimate:h.estimate}:a.pending=null,m==="publish"&&h.note&&(a.error=h.note)}catch(h){a.error=String(h?.message||h)}a.busy="",await o()}function s(m){let w=ce.indexOf(m.stage);return`<ol class="gpc-steps">${ce.map((h,y)=>`<li class="${y<w?"is-done":y===w?"is-cur":""}"><span class="gpc-dot"></span><span class="gpc-step-l">${h}</span></li>`).join("")}</ol>`}function p(m){let w=m.design||{},h=[["Setting",w.setting],["Controls",w.controls],["Core loop",w.coreLoop],["Win/lose",w.winLose],["Engine",w.engine]].filter(([,T])=>T).map(([T,re])=>`<div class="gpc-kv"><span>${M(T)}</span><span>${M(re)}</span></div>`).join(""),y=(m.questions||[]).filter(T=>T.answer),z=(m.questions||[]).filter(T=>!T.answer).length;return`<div class="gpc-sec"><h4>${j.wand} Design</h4>${m.pitch?`<p class="gpc-pitch">${M(m.pitch)}</p>`:""}${h}
      ${y.length?`<div class="gpc-answers">${y.map(T=>`<span class="gpc-chip" title="${M(T.q)}">${M(T.answer)}</span>`).join("")}</div>`:""}
      ${z?`<div class="gpc-muted">${z} design question${z>1?"s":""} still open</div>`:""}</div>`}function l(m){let w=(m.assets||[]).filter(r);if(!w.length)return`<div class="gpc-sec"><h4>${j.spark} Art</h4><div class="gpc-row"><span class="gpc-muted gpc-grow">No asset plan yet.</span>${U("plan",j.wand,"Plan assets for this genre",a.busy?"disabled":"","is-go")}</div></div>`;let h=w.filter(A=>["planned","rejected","failed"].includes(A.status)).length,y=w.map(A=>{let f=A.path?`<img src="${M(dt(t,A.path,m.version))}" alt="${M(A.name)}" loading="lazy" class="${A.transparent?"is-alpha":""}">`:`<span class="gpc-ph">${A.status==="generating"?'<span class="gpc-spin"></span>':j.spark}</span>`,g=A.path&&A.status!=="generating";return`<div class="gpc-tile is-${M(A.status)}" title="${M(A.prompt)}">
        <div class="gpc-img">${f}</div>
        <div class="gpc-tile-foot"><span class="gpc-tname">${M(A.name)}</span><span class="gpc-badge">${M(A.status)}</span></div>
        <div class="gpc-tile-acts">
          ${U("approve",j.check,`Approve ${A.name}`,`data-asset="${M(A.id)}" ${g&&A.status!=="approved"?"":"disabled"}`,"is-go")}
          ${U("reject",j.x,`Reject ${A.name}`,`data-asset="${M(A.id)}" ${A.status==="generating"||A.status==="rejected"?"disabled":""}`)}
          ${U("reroll",j.reroll,`Reroll ${A.name} (paid)`,`data-asset="${M(A.id)}" ${A.status==="generating"?"disabled":""}`)}
        </div></div>`}).join(""),z=m.budget?.spentUsd||0,T=m.budget?.capUsd,re=T?Math.min(100,z/T*100):0,B=a.pending;return`<div class="gpc-sec"><h4>${j.spark} Art <span class="gpc-muted">${w.filter(A=>A.status==="approved").length}/${w.length} approved</span></h4>
      <div class="gpc-grid">${y}</div>
      <div class="gpc-cost">
        <div class="gpc-row"><span class="gpc-grow gpc-muted">Spent ${fe(z)}${T?` of ${fe(T)} cap`:""} \xB7 auto-approve ${fe(m.budget?.autoApproveUsd)}</span>
        ${h?U("generate",j.spark,`Generate ${h} asset(s)`,a.busy||n()?"disabled":"","is-go"):""}</div>
        ${T?`<div class="gpc-bar"><span style="width:${re.toFixed(1)}%"></span></div>`:""}
        ${B?`<div class="gpc-approve ${B.blocked?"is-blocked":""}"><span class="gpc-grow">${M(B.reason||"")}</span>
          ${B.blocked?"":`<button type="button" class="gpc-go" data-gpa="approve-cost">${j.check}<span>Approve &amp; generate ${fe(B.usd)}</span></button>`}
          ${U("dismiss",j.x,"Dismiss")}</div>`:""}
      </div></div>`}function u(m){let h=(m.assets||[]).filter(y=>!r(y)).map(y=>`<div class="gpc-aud">${U(a.playing===y.id?"stop":"listen",a.playing===y.id?j.stop:j.play,`${a.playing===y.id?"Stop":"Play"} ${y.name}`,`data-asset="${M(y.id)}" data-src="${M(dt(t,y.path,m.version))}"`)}<span class="gpc-grow">${M(y.name)}</span><span class="gpc-muted">${y.durationSec?`${Number(y.durationSec).toFixed(1)}s`:""}</span></div>`).join("");return`<div class="gpc-sec"><h4>${j.music} Audio</h4>${h||'<div class="gpc-muted">No audio yet (free, generated locally).</div>'}
      <div class="gpc-row gpc-mt">${U("sfx",j.spark,"Generate sound effects (free)",a.busy?"disabled":"")}${U("music",j.music,"Generate music bed (free)",a.busy?"disabled":"")}${U("scaffold",j.code,"Write playable scaffold",a.busy?"disabled":"")}</div></div>`}function x(m){if(ce.indexOf(m.stage)<ce.indexOf("playable"))return"";let w=m.publish?.url||_e(t);return`<div class="gpc-sec"><h4>${j.pad} Play</h4>
      <div class="gpc-row gpc-mb"><span class="gpc-grow gpc-muted gpc-url">${M(w)}</span>
        ${U("orient",j.phone,a.portrait?"Landscape preview":"Portrait preview")}
        ${U("reload",j.refresh,"Reload game")}
        ${U("open",j.ext,"Open in new tab",`data-url="${M(w)}"`)}
        ${U("copy",j.copy,"Copy link",`data-url="${M(w)}"`)}
        ${U("publish",j.rocket,m.publish?.url?"Republish":"Publish",a.busy?"disabled":"","is-go")}</div>
      <div class="gpc-frame ${a.portrait?"is-portrait":""}"><iframe src="${M(_e(t))}" sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen; gamepad" loading="lazy" title="${M(m.title)}"></iframe></div>
      ${m.publish?.note?`<div class="gpc-muted gpc-mt">${M(m.publish.note)}</div>`:""}</div>`}function b(){let m=a.project;if(!m){e.innerHTML=`<div class="gpc"><div class="gpc-head"><span class="gpc-kicker">${j.pad} Game</span><span class="gpc-muted">${M(a.error||"Loading\u2026")}</span></div></div>`;return}let w=m.design||{},h=e.querySelector(".gpc-frame iframe"),y=h&&ce.indexOf(m.stage)>=ce.indexOf("playable")?h:null;if(e.innerHTML=`<div class="gpc">
      <div class="gpc-head"><div class="gpc-headtext">
        <span class="gpc-kicker">${j.pad} Game project${a.busy?` \xB7 ${M(a.busy)}\u2026`:""}</span>
        <strong class="gpc-title">${M(m.title)}</strong>
        <div class="gpc-row"><span class="gpc-chip">${M(w.genre)}</span><span class="gpc-chip">${M(w.style)}</span>${w.multiplayer?'<span class="gpc-chip">multiplayer</span>':""}</div>
      </div>${U("refresh",j.refresh,"Refresh")}</div>
      ${s(m)}
      ${a.error?`<div class="gpc-err">${M(a.error)}</div>`:""}
      ${p(m)}${l(m)}${u(m)}${x(m)}
    </div>`,y){let z=e.querySelector(".gpc-frame iframe");z&&z.replaceWith(y)}}let S=null;e.addEventListener("click",async m=>{let w=m.target.closest("[data-gpa]");if(!w||w.disabled)return;m.preventDefault();let h=w.dataset.gpa,y=w.dataset.asset;if(h==="refresh")return o();if(h==="plan")return c("plan_assets");if(h==="generate")return c("generate_assets");if(h==="approve")return c("approve_asset",{assetId:y});if(h==="reject")return c("reject_asset",{assetId:y});if(h==="reroll")return c("reroll_asset",{assetId:y});if(h==="approve-cost"&&a.pending)return c(a.pending.action,{...a.pending.args,approved:!0});if(h==="dismiss")return a.pending=null,b();if(h==="sfx")return c("sfx",{force:!0});if(h==="music")return c("music",{force:!0});if(h==="scaffold")return c("scaffold");if(h==="publish")return c("publish");if(h==="orient"){a.portrait=!a.portrait;let z=e.querySelector(".gpc-frame");z&&z.classList.toggle("is-portrait",a.portrait),w.title=a.portrait?"Landscape preview":"Portrait preview";return}if(h==="reload"){let z=e.querySelector(".gpc-frame iframe");z&&(z.src=_e(t));return}if(h==="open"){window.open(new URL(w.dataset.url,location.href).href,"_blank","noopener");return}if(h==="copy"){try{await navigator.clipboard.writeText(new URL(w.dataset.url,location.href).href),w.title="Copied"}catch{}return}if(h==="listen"||h==="stop")return S&&(S.pause(),S=null),h==="stop"?(a.playing=null,b()):(S=new Audio(w.dataset.src),a.playing=y,S.onended=()=>{a.playing=null,b()},S.play().catch(()=>{a.playing=null,b()}),b())}),b(),o()}var Ie=null,Le=!1;function ut(){Le=!1,document.querySelectorAll(er).forEach(e=>{try{tr(e)}catch(t){console.warn("[game-project-card]",t)}})}function mt(){if(!(typeof document>"u")){if(!document.getElementById(pt)){let e=document.createElement("style");e.id=pt,e.textContent=rr,document.head.appendChild(e)}ut(),!(Ie||typeof MutationObserver>"u")&&(Ie=new MutationObserver(()=>{if(Le)return;Le=!0,(typeof requestAnimationFrame=="function"?requestAnimationFrame:t=>setTimeout(t,16))(()=>ut())}),Ie.observe(document.documentElement,{childList:!0,subtree:!0}))}}var rr=`
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
`;var ar={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};function d(e){return String(e??"").replace(/[&<>"']/g,t=>ar[t])}function L(e){let t=String(e??"").trim();return t&&(/^https?:\/\//i.test(t)||t.startsWith("/")&&!t.startsWith("//"))?t:""}function ae(e){try{return new URL(e).hostname.replace(/^www\./,"")}catch{return""}}function gt(e){let t=ae(e);return t?`https://www.google.com/s2/favicons?domain=${encodeURIComponent(t)}&sz=64`:""}function de(e){return d(JSON.stringify(e??null))}function he(e){try{return JSON.parse(e?.getAttribute?.("data-card-json")||"null")}catch{return null}}function vt(e){let t=String(e??"").trim();if(!t)return null;try{return JSON.parse(t)}catch{}try{let a=t.replace(/[\u201C\u201D]/g,'"').replace(/[\u2018\u2019]/g,"'").replace(/,\s*([}\]])/g,"$1");return JSON.parse(a)}catch{}return null}function Ne(e,t=2){let a=Number(e);return Number.isFinite(a)?a.toLocaleString(void 0,{maximumFractionDigits:t,minimumFractionDigits:0}):""}function Re(e){let t=Number(e);return!Number.isFinite(t)||t<=0?"":`<span class="pc-stars" aria-label="${d(t.toFixed(1))} out of 5">\u2605 ${d(t.toFixed(1))}</span>`}function be(e){let t=String(e||"").trim();if(!t||typeof window>"u")return!1;try{if(typeof window.__pmMobileSendMessage=="function")return window.__pmMobileSendMessage(t),!0;if(typeof window.sendChat=="function")return window.sendChat(t),!0}catch(a){console.warn("[prom-cards] follow-up send failed",a)}return!1}function R(e,t){return`<div class="pc-card pc-error" role="note"><div class="pc-error-title">Couldn't render ${d(e)} card</div><div class="pc-muted">${d(t||"The card data was malformed.")}</div></div>`}var X={arrowL:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',arrowR:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 012-2h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',pin:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg>',phone:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',globe:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" fill="none" stroke="currentColor" stroke-width="2"/></svg>',route:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 9-9 9-9-9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 13v-2h5l-2-2m2 2l-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',swap:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',bell:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4z M10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'};function ne(e,t,a,r,n=""){return`<div class="pc-card pc-${e} ${n}" data-pc-kind="${e}" data-pc-id="${d(t)}" data-card-json="${de(a)}">${r}</div>`}function pe(e,t){return`<div class="pc-head"><span class="pc-kicker">${d(e)}</span>${t?`<span class="pc-title">${d(t)}</span>`:""}</div>`}function ft(e){let a=(Array.isArray(e)?e:e?.questions||e?.items||[]).map(r=>{let n=(r?.options||r?.choices||r?.answers||[]).map(i=>typeof i=="string"?i:String(i?.text??i?.label??"")),o=r?.answer??r?.correct??r?.correctIndex??r?.correct_answer;if(typeof o=="string"&&!/^\d+$/.test(o)){let i=/^[A-Za-z]$/.test(o.trim())?o.trim().toUpperCase().charCodeAt(0)-65:-1;o=i>=0&&i<n.length?i:n.findIndex(c=>c.trim().toLowerCase()===o.trim().toLowerCase())}return{question:String(r?.question??r?.q??r?.prompt??""),options:n,answer:Number(o),hint:r?.hint?String(r.hint):"",explanation:String(r?.explanation??r?.why??"")}}).filter(r=>r.question&&r.options.length>=2&&Number.isInteger(r.answer)&&r.answer>=0&&r.answer<r.options.length);return{title:String(e?.title||""),questions:a}}function ht(e){let a=(Array.isArray(e)?e:e?.cards||e?.items||[]).map(r=>({front:String(r?.front??r?.term??r?.q??r?.question??""),back:String(r?.back??r?.definition??r?.a??r?.answer??"")})).filter(r=>r.front&&r.back);return{title:String(e?.title||""),cards:a}}function nr(e){return String(e||"").split(`
`).map(t=>t.replace(/^\s*(?:[-*•]|\d+[.)])\s*/,"").trim()).filter(Boolean)}function or(e,t,a){let r=t.questions;if(!r.length)return R("quiz","A quiz needs questions with options and an answer index.");let n=a.picks||{},o=a.locked||{},i=a.hints||{};if(a.done){let h=r.filter((z,T)=>n[T]===z.answer).length,y=r.map((z,T)=>`<li class="${n[T]===z.answer?"ok":"bad"}"><span>${n[T]===z.answer?"\u2713":"\u2717"}</span>${d(z.question)}</li>`).join("");return ne("quiz",e,t,`${pe("Quiz",t.title)}<div class="pc-score"><strong>${h}/${r.length}</strong><span>${h===r.length?"Perfect score":h>=r.length/2?"Nice work":"Keep practicing"}</span></div><ol class="pc-review">${y}</ol><div class="pc-actions"><button type="button" class="pc-btn" data-pc-act="quiz-retry">Retry quiz</button></div>`)}let c=Math.min(a.i||0,r.length-1),s=r[c],p=n[c],l=!!o[c],u=s.options.map((h,y)=>`<button type="button" class="pc-opt ${l?y===s.answer?"correct":y===p?"wrong":"dim":y===p?"picked":""}" data-pc-act="quiz-pick" data-k="${y}" ${l?"disabled":""}><span class="pc-opt-key">${String.fromCharCode(65+y)}</span><span>${d(h)}</span></button>`).join(""),x=l?`<div class="pc-feedback ${p===s.answer?"ok":"bad"}"><strong>${p===s.answer?"Correct!":`Not quite. The answer is ${String.fromCharCode(65+s.answer)}.`}</strong>${s.explanation?`<span>${d(s.explanation)}</span>`:""}</div>`:"",b=i[c]&&s.hint?`<div class="pc-hint">\u{1F4A1} ${d(s.hint)}</div>`:"",S=c===r.length-1,m=l?`<button type="button" class="pc-btn primary" data-pc-act="${S?"quiz-finish":"quiz-next"}">${S?"See results":"Next question"}</button>`:`${s.hint&&!i[c]?'<button type="button" class="pc-btn" data-pc-act="quiz-hint">Hint</button>':""}<button type="button" class="pc-btn primary" data-pc-act="quiz-lock" ${p==null?"disabled":""}>Lock in</button>`,w=r.map((h,y)=>`<span class="${y===c?"on":o[y]?n[y]===r[y].answer?"ok":"bad":""}"></span>`).join("");return ne("quiz",e,t,`${pe("Quiz",t.title)}<div class="pc-progress-row"><span>Question ${c+1} of ${r.length}</span><span class="pc-dots">${w}</span></div><div class="pc-question">${d(s.question)}</div><div class="pc-opts">${u}</div>${b}${x}<div class="pc-actions">${m}</div>`)}function ir(e,t,a){let r=t.cards;if(!r.length)return R("flashcards","Flashcards need cards with a front and a back.");let n=Array.isArray(a.order)&&a.order.length?a.order:r.map((l,u)=>u),o=a.known||[],i=a.missed||[],c=a.pos||0;if(c>=n.length)return ne("flashcards",e,t,`${pe("Flashcards",t.title)}<div class="pc-score"><strong>${o.length}/${n.length}</strong><span>known this round</span></div><div class="pc-actions">${i.length?`<button type="button" class="pc-btn primary" data-pc-act="fc-missed">Review ${i.length} missed</button>`:""}<button type="button" class="pc-btn" data-pc-act="fc-restart">Start over</button></div>`);let s=r[n[c]],p=Math.round(c/n.length*100);return ne("flashcards",e,t,`${pe("Flashcards",t.title)}<div class="pc-bar"><span style="width:${p}%"></span></div><button type="button" class="pc-flip ${a.flipped?"flipped":""}" data-pc-act="fc-flip" aria-label="Flip card"><span class="pc-flip-side">${a.flipped?"Answer":"Term"}</span><span class="pc-flip-text">${d(a.flipped?s.back:s.front)}</span><span class="pc-muted">${a.flipped?"":"Tap to flip"}</span></button><div class="pc-progress-row"><span>${c+1} / ${n.length}</span><span>\u2713 ${o.length} \xB7 \u2717 ${i.length}</span></div><div class="pc-actions split"><button type="button" class="pc-btn bad" data-pc-act="fc-miss">Still learning</button><button type="button" class="pc-btn good" data-pc-act="fc-know">Got it</button></div>`)}function sr(e,t,a){let r=String(t?.question||t?.title||""),n=(t?.options||[]).map(String).filter(Boolean);if(!r||n.length<2)return R("poll","A poll needs a question and at least two options.");let o=a.picks||[],i=!!t.multiple;if(a.sent){let s=n.map((p,l)=>`<div class="pc-poll-row ${o.includes(l)?"mine":""}"><span>${d(p)}</span><span>${o.includes(l)?"Your answer":""}</span></div>`).join("");return ne("poll",e,t,`${pe("Poll","")}<div class="pc-question">${d(r)}</div>${s}<div class="pc-muted">Sent to Prom.</div>`)}let c=n.map((s,p)=>`<button type="button" class="pc-opt ${o.includes(p)?"picked":""}" data-pc-act="poll-pick" data-k="${p}"><span class="pc-check">${o.includes(p)?"\u25CF":"\u25CB"}</span><span>${d(s)}</span></button>`).join("");return ne("poll",e,t,`${pe("Poll",i?"Pick any":"")}<div class="pc-question">${d(r)}</div><div class="pc-opts">${c}</div><div class="pc-actions"><button type="button" class="pc-btn primary" data-pc-act="poll-send" ${o.length?"":"disabled"}>Send answer</button></div>`)}function cr(e,t,a){let r=String(t?.text??t?.body??t?.content??"");if(!r.trim())return R("writing","Nothing to show.");let n=r.trim().split(/\s+/).length,o=String(t?.kind||"Draft"),i=t?.subject?`<div class="pc-writing-subject"><span>Subject</span>${d(t.subject)}</div>`:"";return ne("writing",e,t,`<div class="pc-head"><span class="pc-kicker">${d(o)}</span>${t?.title?`<span class="pc-title">${d(t.title)}</span>`:""}<button type="button" class="pc-icon-btn" data-pc-act="copy" title="Copy">${X.copy}<span>${a.copied?"Copied":"Copy"}</span></button></div>${i}<div class="pc-writing-body">${d(r)}</div><div class="pc-writing-foot"><span class="pc-muted">${n} words \xB7 ${r.length} characters</span><span class="pc-chips"><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${d(o.toLowerCase())} shorter.">Shorter</button><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${d(o.toLowerCase())} more casual.">More casual</button><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${d(o.toLowerCase())} more formal.">More formal</button></span></div>`)}function pr(e,t){let a=(Array.isArray(t)?t:t?.items||[]).map(r=>String(typeof r=="string"?r:r?.prompt||r?.label||"")).filter(Boolean).slice(0,6);return a.length?`<div class="pc-followups" data-pc-id="${d(e)}">${a.map(r=>`<button type="button" class="pc-followup" data-pc-act="send" data-prompt="${d(r)}"><span>${d(r)}</span><span aria-hidden="true">\u2197</span></button>`).join("")}</div>`:""}function dr(e,t,a){let r=String(t?.title||t?.text||""),n=String(t?.when||t?.time||t?.at||"");if(!r)return R("reminder","A reminder needs a title.");let o=a.status==="set"?'<div class="pc-feedback ok"><strong>Asked Prom to set it.</strong></div>':a.status==="dismissed"?'<div class="pc-muted">Dismissed.</div>':"",i=a.status?"":'<div class="pc-actions"><button type="button" class="pc-btn" data-pc-act="rem-dismiss">Not now</button><button type="button" class="pc-btn primary" data-pc-act="rem-set">Set reminder</button></div>';return ne("reminder",e,t,`<div class="pc-rem"><span class="pc-rem-icon">${X.bell}</span><div><div class="pc-title">${d(r)}</div>${n?`<div class="pc-muted">${d(n)}</div>`:""}${t?.details?`<div class="pc-muted">${d(t.details)}</div>`:""}</div></div>${o}${i}`)}var Be=["quiz","flashcards","poll","writing","followups","reminder"];function xe(e,t,a,r={}){let n=vt(a);if(e==="followups"&&!n&&(n={items:nr(a)}),e==="writing"&&!n&&(n={text:String(a||"").trim()}),!n)return R(e,"The card body is not valid JSON.");switch(e){case"quiz":return or(t,ft(n),r);case"flashcards":return ir(t,ht(n),r);case"poll":return sr(t,n,r);case"writing":return cr(t,n,r);case"followups":return pr(t,n);case"reminder":return dr(t,n,r);default:return""}}function bt(e,t,a,r,n={}){let o={...a||{}},i=Number(n.k);if(e==="quiz"){let c=ft(t).questions,s=o.i||0;if(r==="quiz-pick"&&(o.picks={...o.picks||{},[s]:i}),r==="quiz-hint"&&(o.hints={...o.hints||{},[s]:!0}),r==="quiz-lock"&&o.picks?.[s]!=null&&(o.locked={...o.locked||{},[s]:!0}),r==="quiz-next"&&(o.i=Math.min(c.length-1,s+1)),r==="quiz-finish"&&(o.done=!0),r==="quiz-retry")return{}}else if(e==="flashcards"){let c=ht(t).cards.length,s=Array.isArray(o.order)&&o.order.length?o.order:Array.from({length:c},(l,u)=>u),p=s[o.pos||0];if(r==="fc-flip"&&(o.flipped=!o.flipped),r==="fc-know"||r==="fc-miss"){let l=r==="fc-know"?"known":"missed";o[l]=[...o[l]||[],p],o.pos=(o.pos||0)+1,o.flipped=!1,o.order=s}if(r==="fc-missed")return{order:[...o.missed||[]]};if(r==="fc-restart")return{}}else if(e==="poll"){if(r==="poll-pick"){let c=new Set(o.picks||[]);t?.multiple?(c.has(i)?c.delete(i):c.add(i),o.picks=[...c]):o.picks=[i]}r==="poll-send"&&(o.sent=!0)}else e==="writing"?r==="copy"&&(o.copied=!0):e==="reminder"&&(r==="rem-set"&&(o.status="set"),r==="rem-dismiss"&&(o.status="dismissed"));return o}var K=(e,t,a="")=>{let r=L(e);return r?`<img class="${a}" src="${d(r)}" alt="${d(t||"")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:""},we=(e,t="")=>`<div class="pc-scroller-wrap"><button type="button" class="pc-nav prev" data-pc-act="scroll" data-dir="-1" aria-label="Previous">${X.arrowL}</button><div class="pc-scroller ${t}">${e}</div><button type="button" class="pc-nav next" data-pc-act="scroll" data-dir="1" aria-label="Next">${X.arrowR}</button></div>`;function Z(e,t,a,r=""){return`<div class="pc-card pc-${e} ${r}" data-pc-kind="${e}" data-pc-id="${d(t.id||"")}">${a}</div>`}function Q(e,t,a=""){return`<div class="pc-head"><span class="pc-kicker">${d(e)}</span>${t?`<span class="pc-title">${d(t)}</span>`:""}${a}</div>`}function lr(e){let t=e.rates&&typeof e.rates=="object"?e.rates:null;if(!t||!e.base)return R("currency","Exchange rates were unavailable.");let a=[...new Set([e.base,...Object.keys(t)])].sort(),r=e.from||e.base,n=e.to||a.find(c=>c!==r)||r,o=Number(e.amount)||1,i=(c,s)=>`<select class="pc-select" data-pc-fx="${c}">${a.map(p=>`<option value="${d(p)}" ${p===s?"selected":""}>${d(p)}${e.names?.[p]?` \xB7 ${d(e.names[p])}`:""}</option>`).join("")}</select>`;return`<div class="pc-card pc-currency" data-pc-kind="currency" data-pc-id="${d(e.id||"")}" data-card-json="${de({base:e.base,rates:t})}">${Q("Currency",e.date?`Rates as of ${e.date}`:"")}
  <div class="pc-fx-row"><input class="pc-input" type="number" inputmode="decimal" step="any" value="${d(o)}" data-pc-fx="amount" aria-label="Amount">${i("from",r)}</div>
  <button type="button" class="pc-icon-btn pc-fx-swap" data-pc-act="fx-swap" title="Swap">${X.swap}</button>
  <div class="pc-fx-row"><output class="pc-fx-out" data-pc-fx="out">\u2026</output>${i("to",n)}</div>
  <div class="pc-muted" data-pc-fx="rate"></div><div class="pc-source">${d(e.source||"European Central Bank via Frankfurter")}</div></div>`}function ur(e){let t=(e.zones||[]).filter(r=>r?.timeZone).slice(0,8);if(!t.length)return R("clock","No time zones resolved.");let a=t.map(r=>`<div class="pc-clock-cell" data-tz="${d(r.timeZone)}"><div class="pc-clock-label">${d(r.label||r.timeZone)}</div><div class="pc-clock-time" data-pc-clock="time">--:--</div><div class="pc-muted" data-pc-clock="date"></div><div class="pc-muted">${d(r.timeZone)}</div></div>`).join("");return Z("clock",e,`${Q("World clock",e.title||"")}<div class="pc-clock-grid">${a}</div>`)}function mr(e){let t=String(e||"").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);return t?t[1]:""}function Pe(e,t){let a=mr(e.url),r=e.thumbnail||(a?`https://i.ytimg.com/vi/${a}/hqdefault.jpg`:""),n=a?`data-pc-act="video-play" data-yt="${d(a)}"`:`data-pc-act="open" data-url="${d(L(e.url))}"`;return`<div class="pc-video-tile ${t?"big":""}"><button type="button" class="pc-video-thumb" ${n} aria-label="Play ${d(e.title||"video")}">${K(r,e.title)}<span class="pc-play">${X.play}</span>${e.duration?`<span class="pc-badge">${d(e.duration)}</span>`:""}</button><div class="pc-video-meta"><a class="pc-link-title" href="${d(L(e.url))}" target="_blank" rel="noopener noreferrer">${d(e.title||e.url)}</a><div class="pc-muted">${d([e.creator||e.publisher||ae(e.url),e.age].filter(Boolean).join(" \xB7 "))}</div></div></div>`}function gr(e){let t=(e.items||[]).filter(a=>L(a?.url)).slice(0,8);return t.length?t.length===1?Z("video",e,`${e.title?Q("Video",e.title):""}${Pe(t[0],!0)}`):Z("video",e,`${Q("Videos",e.title||"")}${Pe(t[0],!0)}${we(t.slice(1).map(a=>Pe(a,!1)).join(""))}`):R("video","No playable videos were found.")}function vr(e){let t=(e.items||[]).filter(n=>L(n?.thumbnail||n?.url)).slice(0,24);if(!t.length)return R("gallery","No images were found.");let a=t.map((n,o)=>`<button type="button" class="pc-gallery-tile ${o===0?"hero":""}" data-pc-act="lightbox" data-i="${o}" aria-label="${d(n.title||"Image")}">${K(n.thumbnail||n.url,n.title)}</button>`).join(""),r=t.map(n=>({src:L(n.url||n.thumbnail),thumb:L(n.thumbnail||n.url),title:n.title||"",page:L(n.pageUrl||""),source:n.source||ae(n.pageUrl||n.url)}));return`<div class="pc-card pc-gallery" data-pc-kind="gallery" data-pc-id="${d(e.id||"")}" data-card-json="${de(r)}">${Q("Images",e.title||"",`<span class="pc-count">${t.length}</span>`)}<div class="pc-gallery-grid">${a}</div></div>`}function fr(e){let t=(e.items||[]).filter(r=>L(r?.url)).slice(0,12);if(!t.length)return R("news","No stories were found.");let a=r=>`<a class="pc-news-tile" href="${d(L(r.url))}" target="_blank" rel="noopener noreferrer"><div class="pc-news-img">${K(r.imageUrl||r.thumbnail,r.title)}</div><div class="pc-news-body"><div class="pc-news-src">${K(gt(r.url),"","pc-fav")}<span>${d(r.publisher||ae(r.url))}</span>${r.age?`<span>\xB7 ${d(r.age)}</span>`:""}</div><div class="pc-news-title">${d(r.title||r.url)}</div>${r.snippet?`<div class="pc-muted pc-clamp2">${d(r.snippet)}</div>`:""}</div></a>`;return Z("news",e,`${Q("News",e.title||"")}${we(t.map(a).join(""),"news")}`)}function xt(e,t){return`<div class="pc-team ${t}">${K(e.logo,e.name,"pc-logo")}<div class="pc-team-name">${d(e.name||e.abbr||"")}</div>${e.record?`<div class="pc-muted">${d(e.record)}</div>`:""}</div>`}function wt(e){let t=e.away||{},a=e.home||{},r=e.state||"pre",n=r==="pre"?`<div class="pc-game-mid"><div class="pc-game-status">${d(e.statusText||"")}</div></div>`:`<div class="pc-game-mid"><span class="pc-game-score ${Number(t.score)>Number(a.score)?"win":""}">${d(t.score??"")}</span><div class="pc-game-status ${r==="in"?"live":""}">${r==="in"?'<span class="pc-live-dot"></span>':""}${d(e.statusText||"")}</div><span class="pc-game-score ${Number(a.score)>Number(t.score)?"win":""}">${d(a.score??"")}</span></div>`,o=Math.max((t.linescores||[]).length,(a.linescores||[]).length),i=Array.from({length:o},(s,p)=>e.periodLabel==="inning"?p+1:p<4?`Q${p+1}`:`OT${p-3||""}`),c=o?`<table class="pc-table pc-linescore"><thead><tr><th></th>${i.map(s=>`<th>${d(s)}</th>`).join("")}<th>T</th></tr></thead><tbody>${[t,a].map(s=>`<tr><td>${d(s.abbr||s.name||"")}</td>${i.map((p,l)=>`<td>${d(s.linescores?.[l]??"-")}</td>`).join("")}<td><strong>${d(s.score??"")}</strong></td></tr>`).join("")}</tbody></table>`:"";return`<div class="pc-game">${e.venue?`<div class="pc-muted pc-center">${d(e.venue)}</div>`:""}<div class="pc-game-row">${xt(t,"away")}${n}${xt(a,"home")}</div>${c}${e.link?`<a class="pc-more" href="${d(L(e.link))}" target="_blank" rel="noopener noreferrer">Game details \u2197</a>`:""}</div>`}function hr(e){let t=(e.games||[]).slice(0,12);return t.length?t.length===1?Z("sports-game",e,`${Q(e.league||"Game",e.title||"")}${wt(t[0])}`):Z("sports-game",e,`${Q(e.league||"Scores",e.title||"")}${we(t.map(a=>`<div class="pc-game-tile">${wt(a)}</div>`).join(""))}`):R("sports","No games found for that query.")}function br(e){let t=e.player||{};if(!t.name)return R("sports","Player not found.");let a=(t.stats||[]).slice(0,6).map(n=>`<div class="pc-stat"><div class="pc-stat-v">${d(n.value)}</div><div class="pc-stat-k">${d(n.label)}</div>${n.rank?`<div class="pc-muted">${d(n.rank)}</div>`:""}</div>`).join(""),r=[t.team,t.jersey?`#${t.jersey}`:"",t.position].filter(Boolean).map(d).join(" \u2022 ");return Z("sports-player",e,`<div class="pc-player">${K(t.headshot,t.name,"pc-headshot")}<div><div class="pc-title big">${d(t.name)}</div><div class="pc-muted">${r}</div>${t.bio?`<div class="pc-muted">${d(t.bio)}</div>`:""}</div>${K(t.teamLogo,t.team,"pc-logo")}</div>${a?`<div class="pc-subhead">${d(t.statsLabel||"Season stats")}</div><div class="pc-stats">${a}</div>`:""}${t.link?`<a class="pc-more" href="${d(L(t.link))}" target="_blank" rel="noopener noreferrer">Full profile \u2197</a>`:""}`)}function xr(e){let t=(e.groups||[]).filter(o=>(o.rows||[]).length);if(!t.length)return R("sports","Standings unavailable.");let a=e.columns||["W","L","PCT","GB","L10","STRK"],r=t.length>1?`<div class="pc-tabs" role="tablist">${t.map((o,i)=>`<button type="button" role="tab" class="pc-tab ${i===0?"on":""}" data-pc-act="tab" data-i="${i}">${d(o.name)}</button>`).join("")}</div>`:"",n=t.map((o,i)=>`<div class="pc-tabpane" data-i="${i}" ${i?"hidden":""}><div class="pc-table-scroll"><table class="pc-table"><thead><tr><th>#</th><th class="l">Team</th>${a.map(c=>`<th>${d(c)}</th>`).join("")}</tr></thead><tbody>${o.rows.map((c,s)=>`<tr><td>${d(c.seed||s+1)}</td><td class="l"><span class="pc-team-inline">${K(c.logo,"","pc-logo-sm")}${d(c.team)}</span></td>${a.map(p=>`<td>${d(c.stats?.[p]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`).join("");return Z("sports-standings",e,`${Q(e.league||"Standings",e.title||"")}${r}${n}`)}function wr(e,t){let a=L(e.directionsUrl)||`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Number.isFinite(e.lat)?`${e.lat},${e.lng}`:`${e.name} ${e.address||""}`)}`,r=e.openNow===!0?'<span class="pc-open">Open now</span>':e.openNow===!1?'<span class="pc-closed">Closed</span>':"",n=[`<a class="pc-chip" href="${d(a)}" target="_blank" rel="noopener noreferrer">${X.route}Directions</a>`,L(e.website)?`<a class="pc-chip" href="${d(L(e.website))}" target="_blank" rel="noopener noreferrer">${X.globe}Website</a>`:"",e.phone?`<a class="pc-chip" href="tel:${d(String(e.phone).replace(/[^+\d]/g,""))}">${X.phone}Call</a>`:"",L(e.reserveUrl)?`<a class="pc-chip primary" href="${d(L(e.reserveUrl))}" target="_blank" rel="noopener noreferrer">Reserve</a>`:""].join("");return`<div class="pc-place" data-i="${t}">${e.imageUrl?`<div class="pc-place-img">${K(e.imageUrl,e.name)}</div>`:""}<div class="pc-place-body"><div class="pc-place-top"><span class="pc-num">${t+1}</span><strong>${d(e.name)}</strong></div><div class="pc-muted">${[Re(e.rating),e.reviews?`(${d(Ne(e.reviews,0))})`:"",d(e.price||""),d(e.category||"")].filter(Boolean).join(" \xB7 ")}</div>${e.address?`<div class="pc-muted">${X.pin}${d(e.address)}</div>`:""}<div class="pc-place-hours">${r}${e.hours?`<span class="pc-muted">${d(e.hours)}</span>`:""}</div><div class="pc-chips">${n}</div></div></div>`}function yr(e){let t=(e.places||[]).map((r,n)=>({i:n,name:r.name,lat:Number(r.lat),lng:Number(r.lng),rating:r.rating})).filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lng));return t.length?`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css"><style>html,body,#m{margin:0;height:100%;background:#0b141b}.maplibregl-canvas{filter:brightness(.78) saturate(.85)}.pin{display:flex;align-items:center;gap:4px;padding:3px 8px 3px 4px;border-radius:999px;background:#151f27;color:#fff;font:600 12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18);cursor:pointer;white-space:nowrap}.pin b{width:18px;height:18px;border-radius:50%;background:#ff7a1a;display:grid;place-items:center;font-size:11px}.pin span{color:#f5c04a}.maplibregl-ctrl-attrib{font:10px system-ui!important;background:rgba(8,20,28,.7)!important;color:#9eb4bd!important}.maplibregl-ctrl-attrib a{color:#c2d6dc!important}</style></head><body><div id="m"></div><script src="/vendor/maplibre/maplibre-gl.js"><\/script><script>const d=${JSON.stringify({pts:t,zoom:Number(e.zoom)||0,id:String(e.id||"")}).replace(/</g,"\\u003c")};const map=new maplibregl.Map({container:'m',style:{version:8,sources:{c:{type:'raster',tiles:['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],tileSize:256,attribution:'\xA9 OpenStreetMap \xA9 CARTO'}},layers:[{id:'c',type:'raster',source:'c'}]},center:[d.pts[0].lng,d.pts[0].lat],zoom:13,attributionControl:{compact:true},cooperativeGestures:true});const b=new maplibregl.LngLatBounds();d.pts.forEach(p=>{b.extend([p.lng,p.lat]);const el=document.createElement('div');el.className='pin';el.innerHTML='<b>'+(p.i+1)+'</b>'+(p.rating?'<span>\u2605 '+Number(p.rating).toFixed(1)+'</span>':'');el.onclick=()=>parent.postMessage({type:'prom-places-pin',id:d.id,i:p.i},'*');new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map)});if(d.pts.length>1)map.fitBounds(b,{padding:48,maxZoom:15,duration:0});else map.setZoom(d.zoom||14);<\/script></body></html>`:""}function $r(e){let t=yr(e);return t?`<div class="pc-map-slot"><iframe class="pc-map-frame" title="Map of places" srcdoc="${d(t)}" loading="lazy"></iframe></div>`:""}function kr(e,t=""){let a=(e.places||[]).filter(r=>r?.name).slice(0,12);return a.length?Z("places",e,`${Q("Places",e.title||"")}${t}${we(a.map(wr).join(""),"places")}`):R("places","No places found.")}function Sr(e){let t=e.item||(e.items||[])[0];if(!t?.title)return R("product","Product details unavailable.");let a=L(t.productUrl||t.url),r=(t.offers||[]).slice(0,4).map(i=>`<a class="pc-offer" href="${d(L(i.url)||a)}" target="_blank" rel="noopener noreferrer"><span>${d(i.merchant||ae(i.url))}</span><strong>${d(i.price||"")}</strong></a>`).join(""),n=(t.pros||[]).slice(0,4).map(i=>`<li>${d(i)}</li>`).join(""),o=e.variant==="hero";return Z("product",e,`${o?`<div class="pc-head"><span class="pc-kicker pc-badge-pick">${d(e.badge||"Top pick")}</span></div>`:""}<div class="pc-product ${o?"hero":""}"><a class="pc-product-img" href="${d(a)}" target="_blank" rel="noopener noreferrer">${K(t.imageUrl,t.title)}</a><div class="pc-product-body"><a class="pc-link-title" href="${d(a)}" target="_blank" rel="noopener noreferrer">${d(t.title)}</a><div class="pc-product-price"><strong>${d(t.price||"")}</strong>${t.merchant||a?`<span class="pc-muted">${d(t.merchant||ae(a))}</span>`:""}</div><div class="pc-muted">${[Re(t.rating),t.reviewCount?`${d(Ne(t.reviewCount,0))} reviews`:""].filter(Boolean).join(" \xB7 ")}</div>${t.description?`<div class="pc-muted pc-clamp3">${d(t.description)}</div>`:""}${n?`<ul class="pc-pros">${n}</ul>`:""}${r?`<div class="pc-offers">${r}</div>`:""}${a?`<a class="pc-btn primary pc-buy" href="${d(a)}" target="_blank" rel="noopener noreferrer">View at ${d(t.merchant||ae(a))}</a>`:""}</div></div>`)}function ye(e,t={}){try{switch(e?.type){case"currency":return lr(e);case"clock":return ur(e);case"video":return gr(e);case"gallery":return vr(e);case"news":return fr(e);case"sports_game":return hr(e);case"sports_player":return br(e);case"sports_standings":return xr(e);case"places":return kr(e,typeof t.mapHtml=="function"?t.mapHtml(e):$r(e));case"product":return Sr(e);default:return""}}catch(a){return R(String(e?.type||"card"),a?.message||String(a))}}var yt=`
.pc-card,.pc-followups{--pc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--pc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--pc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--pc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--pc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.11))));--pc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));--pc-ok:var(--prom-success,#22a06b);--pc-bad:var(--prom-danger,#e5484d)}
.pc-inline-card{margin:12px 0}.pc-inline-card>.pc-card,.pc-inline-card>*:first-child{margin-top:0}.pc-card{display:block;margin:10px 0;max-width:100%;border:1px solid var(--pc-line);border-radius:16px;background:var(--pc-surface);color:var(--pc-text);padding:14px;font-size:14px;line-height:1.45;overflow:hidden;box-sizing:border-box}
.pc-card *{box-sizing:border-box}
.pc-card svg{width:16px;height:16px;flex:none;vertical-align:-3px}
.pc-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;min-width:0}
.pc-kicker{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--pc-muted)}
.pc-title{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-title.big{font-size:18px;white-space:normal}
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
.pc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:6px}
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
@media (max-width:520px){.pc-product,.pc-product.hero{grid-template-columns:1fr}.pc-product-img{max-height:240px;aspect-ratio:auto;height:220px}.pc-card{padding:12px;border-radius:14px}.pc-game-score{font-size:24px}.pc-logo{width:38px;height:38px}}
/* inline citation chips */
.pc-cite{display:inline-flex;align-items:center;gap:3px;vertical-align:1px;margin:0 2px;padding:1px 7px;border-radius:999px;background:var(--pc-soft,rgba(127,127,127,.12));color:var(--pc-muted,inherit);font-size:11.5px;font-weight:600;text-decoration:none;white-space:nowrap}
.pc-cite:hover{color:var(--pc-accent,inherit)}.pc-cite img{width:12px;height:12px;border-radius:3px}
`;var Et="prom-card-state:",$t="prom-cards-style",kt=!1;function Ve(e){try{return JSON.parse(localStorage.getItem(Et+e)||"{}")||{}}catch{return{}}}function Cr(e,t){try{localStorage.setItem(Et+e,JSON.stringify(t||{}))}catch{}}function Mr(e,t,a,r){let n=e.getAttribute("data-pc-id"),o=document.createElement("template");o.innerHTML=xe(t,n,JSON.stringify(a),r).trim();let i=o.content.firstElementChild;i&&e.replaceWith(i)}function qe(e){let t=he(e);if(!t?.rates)return;let a=u=>e.querySelector(`[data-pc-fx="${u}"]`),r=Number(a("amount")?.value||0),n=a("from")?.value,o=a("to")?.value,i=u=>u===t.base?1:Number(t.rates[u]),c=i(o)/i(n),s=a("out"),p=a("rate");if(!Number.isFinite(c)){s&&(s.textContent="\u2014");return}let l=(u,x)=>{try{return new Intl.NumberFormat(void 0,{style:"currency",currency:x,maximumFractionDigits:u<1?4:2}).format(u)}catch{return`${u.toFixed(2)} ${x}`}};s&&(s.textContent=l(r*c,o)),p&&(p.textContent=`1 ${n} = ${c.toFixed(c<1?4:3)} ${o}`)}var $e=null;function St(){let e=document.querySelectorAll(".pc-clock-cell[data-tz]");if(!e.length){clearInterval($e),$e=null;return}let t=new Date;e.forEach(a=>{let r=a.getAttribute("data-tz");try{a.querySelector('[data-pc-clock="time"]').textContent=t.toLocaleTimeString([],{timeZone:r,hour:"numeric",minute:"2-digit",second:"2-digit"}),a.querySelector('[data-pc-clock="date"]').textContent=t.toLocaleDateString([],{timeZone:r,weekday:"short",month:"short",day:"numeric"})}catch{}})}function Er(e,t){let a=t,r=document.createElement("div");r.className="pc-lightbox";let n=()=>{let s=e[a]||{};r.innerHTML=`<button type="button" class="pc-lb-close" aria-label="Close">\xD7</button><button type="button" class="pc-lb-nav prev" aria-label="Previous">\u2039</button><figure><img src="${d(s.src||s.thumb)}" alt="${d(s.title)}" referrerpolicy="no-referrer"><figcaption>${d(s.title)}${s.page?` \xB7 <a href="${d(s.page)}" target="_blank" rel="noopener noreferrer">${d(s.source||"Source")} \u2197</a>`:""}<span>${a+1} / ${e.length}</span></figcaption></figure><button type="button" class="pc-lb-nav next" aria-label="Next">\u203A</button>`},o=()=>{r.remove(),document.removeEventListener("keydown",c)},i=s=>{a=(a+s+e.length)%e.length,n()},c=s=>{s.key==="Escape"&&o(),s.key==="ArrowLeft"&&i(-1),s.key==="ArrowRight"&&i(1)};r.addEventListener("click",s=>{s.target===r||s.target.closest(".pc-lb-close")?o():s.target.closest(".pc-lb-nav.prev")?i(-1):s.target.closest(".pc-lb-nav.next")&&i(1)}),document.addEventListener("keydown",c),n(),document.body.appendChild(r)}async function zr(e){try{return await navigator.clipboard.writeText(e),!0}catch{}let t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.opacity="0",document.body.appendChild(t),t.select();try{return document.execCommand("copy"),!0}catch{return!1}finally{t.remove()}}function Ar(e){let t=e.target.closest?.("[data-pc-act]");if(!t)return;let a=t.closest("[data-pc-id]"),r=t.getAttribute("data-pc-act");if(r==="send"){e.preventDefault(),be(t.getAttribute("data-prompt")),t.classList.add("sent");return}if(r==="open"){let p=t.getAttribute("data-url");p&&window.open(p,"_blank","noopener");return}if(r==="scroll"){let p=t.parentElement?.querySelector(".pc-scroller");p&&p.scrollBy({left:Number(t.getAttribute("data-dir"))*Math.max(220,p.clientWidth*.85),behavior:"smooth"});return}if(r==="tab"&&a){let p=t.getAttribute("data-i");a.querySelectorAll(".pc-tab").forEach(l=>l.classList.toggle("on",l===t)),a.querySelectorAll(".pc-tabpane").forEach(l=>{l.hidden=l.getAttribute("data-i")!==p});return}if(r==="video-play"){let p=t.getAttribute("data-yt");if(!/^[A-Za-z0-9_-]{11}$/.test(p||""))return;let l=document.createElement("iframe");l.className="pc-video-frame",l.src=`https://www.youtube-nocookie.com/embed/${p}?autoplay=1&rel=0`,l.allow="autoplay; encrypted-media; picture-in-picture; fullscreen",l.allowFullscreen=!0,l.title="Video player",t.replaceWith(l);return}if(r==="lightbox"&&a){let p=he(a)||[];p.length&&Er(p,Number(t.getAttribute("data-i"))||0);return}if(r==="fx-swap"&&a){let p=a.querySelector('[data-pc-fx="from"]'),l=a.querySelector('[data-pc-fx="to"]');if(p&&l){let u=p.value;p.value=l.value,l.value=u,qe(a)}return}if(!a)return;let n=a.getAttribute("data-pc-kind"),o=a.getAttribute("data-pc-id"),i=he(a);if(!n||!o||!i)return;if(r==="copy"){let p=String(i.text??i.body??i.content??"");zr(i.subject?`Subject: ${i.subject}

${p}`:p)}let c=Ve(o),s=bt(n,i,c,r,{k:t.getAttribute("data-k")});if(Cr(o,s),n==="poll"&&r==="poll-send"){let p=(i.options||[]).map(String),l=(s.picks||[]).map(u=>p[u]).filter(Boolean);be(`${i.question}: ${l.join(", ")}`)}n==="reminder"&&r==="rem-set"&&be(`Set a reminder: ${i.title}${i.when?` (${i.when})`:""}`),Mr(a,n,i,s)}function Ct(e){let t=e.target.closest?.("[data-pc-fx]");t&&qe(t.closest(".pc-currency"))}function Mt(e=document){e.querySelectorAll?.(".pc-currency:not([data-pc-ready])").forEach(t=>{t.setAttribute("data-pc-ready","1"),qe(t)}),e.querySelector?.(".pc-clock-cell[data-tz]")&&(St(),$e||($e=setInterval(St,1e3)))}function Fe(){if(kt||typeof document>"u")return;if(kt=!0,!document.getElementById($t)){let t=document.createElement("style");t.id=$t,t.textContent=yt,document.head.appendChild(t)}if(document.addEventListener("click",Ar),window.addEventListener("message",t=>{let a=t?.data;if(!a||a.type!=="prom-places-pin")return;let n=[...document.querySelectorAll(".pc-places[data-pc-id]")].find(o=>o.getAttribute("data-pc-id")===String(a.id))?.querySelector(`.pc-place[data-i="${Number(a.i)}"]`);n&&(n.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}),n.classList.add("flash"),setTimeout(()=>n.classList.remove("flash"),1200))}),document.addEventListener("input",Ct),document.addEventListener("change",Ct),Mt(),typeof MutationObserver>"u")return;let e=!1;new MutationObserver(()=>{e||(e=!0,requestAnimationFrame(()=>{e=!1,Mt()}))}).observe(document.documentElement,{childList:!0,subtree:!0})}var jr=new RegExp("```("+Be.join("|")+")[ \\t]*\\n([\\s\\S]*?)```","g"),Tr=new RegExp("```("+Be.join("|")+")[ \\t]*\\n[\\s\\S]*$");function _r(e,t,a){let r=`${e}\0${a}\0${t}`,n=2166136261;for(let o=0;o<r.length;o+=1)n^=r.charCodeAt(o),n=Math.imul(n,16777619);return`${e}_${(n>>>0).toString(36)}`}function zt(e,t){let a=[],r=0,n=String(e||"").replace(jr,(i,c,s)=>{let p=c.toLowerCase(),l=_r(p,s.trim(),r++),u={};try{u=typeof localStorage<"u"?Ve(l):{}}catch{}return a.push(xe(p,l,s,u)),`

${t}${a.length-1}END

`}),o=n.match(Tr);return o&&(n=n.slice(0,o.index)+`

<div class="pc-card pc-pending"><span class="pc-muted">Building ${o[1]}\u2026</span></div>

`),{text:n,cards:a}}var le=/\{\{\s*card\s*:\s*([A-Za-z0-9_-]{2,48})\s*\}\}/g;function Ir(e){if(!e||typeof e!="object")return"";for(let t of[e.content,e.text,e.body?.text,e.message])if(typeof t=="string"&&t)return t;return""}function Lr(e){let t=new Set;return String(e||"").replace(le,(a,r)=>(t.add(r),"")),t}function Nr(e){let t=Array.isArray(e?.richArtifacts)?e.richArtifacts:[];if(!t.length)return t;let a=Lr(Ir(e));return a.size?t.filter(r=>!(r?.ref&&a.has(r.ref))):t}function At(e,t,a,r){let n=[],o=Array.isArray(a)?a:[];return{text:String(e||"").replace(le,(c,s)=>{let p=o.find(u=>u&&(u.ref===s||u.id===s));if(!p)return"";let l="";try{l=(typeof r=="function"?r(p):"")||ye(p)||""}catch{}return l?(n.push(`<div class="pc-inline-card" data-card-ref="${s}">${l}</div>`),`

${t}${n.length-1}END

`):""}),cards:n}}function jt(e){return/```(quiz|flashcards|poll|writing|followups|reminder)[ \t]*\n/.test(String(e||""))}var Rr=/^(?:\[?\d{1,2}\]?|source|src|ref|link)$/i;function Tt(e){return!e||e.indexOf("<a ")===-1?e:e.replace(/<a ([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>([^<]{1,48})<\/a>/g,(t,a,r,n,o)=>{let i=o.trim(),c="";try{c=new URL(r.replace(/&amp;/g,"&")).hostname.replace(/^www\./,"")}catch{return t}if(!(Rr.test(i)||i.toLowerCase().replace(/^www\./,"")===c))return t;let p=c.split(".").slice(-2).join(".");return`<a class="pc-cite" href="${r}" target="_blank" rel="noopener noreferrer" title="${r}"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(c)}&amp;sz=32" alt="" loading="lazy" referrerpolicy="no-referrer">${p}</a>`})}function J(e){return e?String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var Na=J;function Br(e){let t=Date.now()-e;return t<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?`${Math.floor(t/36e5)}h ago`:`${Math.floor(t/864e5)}d ago`}function Pr(e,t=0){let a=Number(e);return Number.isFinite(a)?`${a.toFixed(t)}%`:"--%"}function Vr(e,t){let a=Number(e),r=Number(t);return!Number.isFinite(a)||!Number.isFinite(r)||r<=0?"-- / -- GB":`${a.toFixed(1)} / ${r.toFixed(1)} GB`}function It(e){let t=Number(e);return Number.isFinite(t)?`${Math.max(0,Math.min(100,t))}%`:"0%"}function qr(e,t){let a=document.getElementById(e);a&&(a.textContent=String(t||""))}function Ra(e){let t=String(e||"").trim(),a=J(t);return`<span class="t-think-sizer" aria-hidden="true">${a}</span><span class="t-think-text" data-text="${a}">${a}</span>`}function Ba(e,t){let a=String(t||"").trim(),r=e?.querySelector?.(".t-think-text");if(!r||!a)return!1;let n=String(r.textContent||"").trim();if(!n||n===a)return!1;e.querySelectorAll?.(".t-think-text").forEach(s=>{s!==r&&s.remove()});let o=r.cloneNode(!0);o.classList.remove("is-enter-start"),o.classList.add("is-exit"),o.textContent=a,o.setAttribute("data-text",a),r.classList.remove("is-exit"),r.classList.add("is-enter-start");let i=e.querySelector?.(".t-think-sizer");i&&a.length>String(i.textContent||"").length&&(i.textContent=a),e.appendChild(o),r.offsetWidth;let c=()=>{r.isConnected!==!1&&r.classList.remove("is-enter-start")};return typeof requestAnimationFrame=="function"?requestAnimationFrame(c):typeof setTimeout=="function"&&setTimeout(c,0),typeof setTimeout=="function"&&setTimeout(()=>{o.isConnected!==!1&&o.remove(),r.isConnected!==!1&&r.classList.remove("is-enter-start")},420),!0}function Fr(e,t){let a=document.getElementById(e);a&&(a.style.width=It(t))}function Lt(e,t,a="info",r=5e3,n={}){let o=typeof n?.key=="string"?n.key.trim():"";if(o)for(let x of document.querySelectorAll(".__sc-toast"))x.dataset.scToastKey===o&&x.remove();let i=a==="warn"?"warning":["info","success","error","warning"].includes(a)?a:"info",c={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},s=document.createElement("div"),l=24+[...document.querySelectorAll(".__sc-toast")].reduce((x,b)=>x+b.offsetHeight+8,0);if(s.className=`__sc-toast __sc-toast--${i}`,o&&(s.dataset.scToastKey=o),s.style.cssText=`position:fixed;bottom:${l}px;right:24px;z-index:99999;`,s.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${c[i]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${J(e)}</div>
      ${t?`<div class="__sc-toast-body">${J(String(t))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let x=document.createElement("style");x.id="__sc-toast-style",x.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(x)}document.body.appendChild(s);let u=Math.max(0,Math.min(5e3,Number.isFinite(Number(r))?Number(r):5e3));setTimeout(()=>{s.style.transition="opacity 0.3s",s.style.opacity="0",setTimeout(()=>s.remove(),300)},u),s.querySelector(".__sc-toast-close")?.addEventListener("click",()=>s.remove())}function Ur(e,t){Lt(e,t,"info")}function Dr(e,t,a,r={}){let{title:n="Confirm",confirmText:o="Confirm",cancelText:i="Cancel",danger:c=!1,details:s=""}=r,p=document.createElement("div");p.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let l=document.createElement("div");l.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",l.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${J(n)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${J(e)}</div>
    ${s?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${J(s)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${J(i)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${c?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${J(o)}</button>
    </div>
  `,p.appendChild(l),document.body.appendChild(p);let u=()=>p.remove();l.querySelector("#__sc-confirm-cancel").onclick=()=>{u(),a&&a()},l.querySelector("#__sc-confirm-ok").onclick=()=>{u(),t&&t()},p.addEventListener("click",x=>{x.target===p&&(u(),a&&a())})}var ke=[];function Or(e,t="log"){let a=new Date().toLocaleTimeString();ke.push({text:`[${a}] ${String(e??"")}`,type:String(t||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),ke.length>100&&ke.shift();let r=document.getElementById("log-panel");r&&(r.replaceChildren(...ke.map(n=>{let o=document.createElement("div");return o.className=`log-line ${n.type}`,o.textContent=n.text,o})),r.scrollTop=r.scrollHeight)}var G=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function Nt(e,t){return String(e||"").replace(/[<>{};\r\n]/g,"").trim()||t}function Rt(){let e=document.documentElement,t=typeof getComputedStyle=="function"?getComputedStyle(e):null,a=(n,o)=>{for(let i of n){let c=t?.getPropertyValue(i)?.trim();if(c)return Nt(c,o)}return o},r={isDark:e.getAttribute("data-theme")==="dark",bg:a(["--bg","--pm-chat-page-bg"],G.bg),bgSoft:a(["--bg-soft"],G.bgSoft),surface:a(["--panel","--composer-panel"],G.surface),surfaceSecondary:a(["--panel-2","--composer-bg"],G.surfaceSecondary),border:a(["--line","--composer-border"],G.border),borderStrong:a(["--line-strong"],G.borderStrong),text:a(["--text","--fg","--composer-text"],G.text),muted:a(["--muted","--composer-muted"],G.muted),accent:a(["--brand","--pm-custom-accent"],G.accent),accentStrong:a(["--brand-2"],G.accentStrong),success:a(["--ok"],G.success),warning:a(["--warn"],G.warning),danger:a(["--err"],G.danger)};return r.series=[r.accent,r.accentStrong,r.success,r.warning,r.danger,r.muted],r.vars={"--prom-bg":r.bg,"--prom-bg-soft":r.bgSoft,"--prom-surface":r.surface,"--prom-surface-secondary":r.surfaceSecondary,"--prom-border":r.border,"--prom-border-strong":r.borderStrong,"--prom-text":r.text,"--prom-muted":r.muted,"--prom-accent":r.accent,"--prom-accent-strong":r.accentStrong,"--prom-success":r.success,"--prom-warning":r.warning,"--prom-danger":r.danger,"--prom-series-1":r.series[0],"--prom-series-2":r.series[1],"--prom-series-3":r.series[2],"--prom-series-4":r.series[3],"--prom-series-5":r.series[4],"--prom-series-6":r.series[5],"--bg":r.bg,"--bg-soft":r.bgSoft,"--panel":r.surface,"--panel-2":r.surfaceSecondary,"--line":r.border,"--line-strong":r.borderStrong,"--text":r.text,"--fg":r.text,"--muted":r.muted,"--brand":r.accent,"--brand-2":r.accentStrong,"--ok":r.success,"--warn":r.warning,"--err":r.danger},r}function Hr(e){if(e&&typeof e=="object"&&e.vars)return e;let t={isDark:typeof e=="boolean"?e:!!e?.isDark,...G};return t.series=[t.accent,t.accentStrong,t.success,t.warning,t.danger,t.muted],t.vars=Object.fromEntries([["--prom-bg",t.bg],["--prom-bg-soft",t.bgSoft],["--prom-surface",t.surface],["--prom-surface-secondary",t.surfaceSecondary],["--prom-border",t.border],["--prom-border-strong",t.borderStrong],["--prom-text",t.text],["--prom-muted",t.muted],["--prom-accent",t.accent],["--prom-accent-strong",t.accentStrong],["--prom-success",t.success],["--prom-warning",t.warning],["--prom-danger",t.danger],...t.series.map((a,r)=>[`--prom-series-${r+1}`,a]),["--bg",t.bg],["--bg-soft",t.bgSoft],["--panel",t.surface],["--panel-2",t.surfaceSecondary],["--line",t.border],["--line-strong",t.borderStrong],["--text",t.text],["--fg",t.text],["--muted",t.muted],["--brand",t.accent],["--brand-2",t.accentStrong],["--ok",t.success],["--warn",t.warning],["--err",t.danger]]),t}function Wr(e){let t=e?.vars&&typeof e.vars=="object"?e.vars:{};return Object.entries(t).map(([a,r])=>`${a}:${Nt(r,"transparent")}`).join(";")}function Bt(e,t,a){let r=Hr(a),n=Ce({background:"transparent",primaryColor:r.surface,primaryTextColor:r.text,primaryBorderColor:r.borderStrong,lineColor:r.muted,secondaryColor:r.surfaceSecondary,secondaryTextColor:r.text,secondaryBorderColor:r.border,tertiaryColor:r.bgSoft,tertiaryTextColor:r.text,tertiaryBorderColor:r.border,textColor:r.text,mainBkg:r.surface,nodeBorder:r.borderStrong,clusterBkg:r.surfaceSecondary,clusterBorder:r.border,edgeLabelBackground:"transparent"}),o=Ce({text:r.text,muted:r.muted,border:r.border,series:r.series}),i=`:root{${Wr(r)}color-scheme:${r.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${r.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return e==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${i}body{display:flex;align-items:center;justify-content:center;min-height:220px;padding:8px}canvas{width:100%!important;max-width:100%;max-height:100%}</style>
</head><body><canvas id="c"></canvas>
<script>try{const visualTheme=${o};Chart.defaults.color=visualTheme.text;Chart.defaults.borderColor=visualTheme.border;const cfg=(${t});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};const datasets=cfg.data&&Array.isArray(cfg.data.datasets)?cfg.data.datasets:[];datasets.forEach((dataset,index)=>{const color=visualTheme.series[index%visualTheme.series.length];if(!dataset.backgroundColor)dataset.backgroundColor=color;if(!dataset.borderColor)dataset.borderColor=color;});const chart=new Chart(document.getElementById('c'),cfg);window.addEventListener('prometheus:visual-theme-change',(event)=>{const next=event.detail||{};if(next.text)Chart.defaults.color=next.text;if(next.border)Chart.defaults.borderColor=next.border;chart.update('none');});}catch(e){document.body.innerHTML='<pre style="color:var(--prom-danger);padding:8px;font-size:11px;white-space:pre-wrap">'+e.message+'<\\/pre>';}<\/script>
</body></html>`:e==="svg"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${i}body{padding:0}.sv-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.sv-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.sv-viewport.dragging{cursor:grabbing}.sv-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.sv-stage svg{max-width:none!important;height:auto;display:block}.sv-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-controls,.sv-shell:focus-within .sv-controls{opacity:1;transform:translateY(0);pointer-events:auto}.sv-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.sv-btn:hover{filter:brightness(1.08)}.sv-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-hint,.sv-shell:focus-within .sv-hint{opacity:.82;transform:translateY(0)}</style>
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
</body></html>`:e==="mermaid"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/mermaid/mermaid.min.js"><\/script>
<style>${i}body{padding:0}.mm-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.mm-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.mm-viewport.dragging{cursor:grabbing}.mm-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.mermaid svg{max-width:none!important;height:auto;background:transparent!important}.mermaid{background:transparent!important}.mm-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-controls{opacity:1;transform:translateY(0);pointer-events:auto}.mm-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.mm-btn:hover{filter:brightness(1.08)}.mm-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-hint{opacity:.82;transform:translateY(0)}</style>
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
<style>${i}body{font-family:inherit;color:var(--prom-text);min-height:0;width:100%;overflow-x:hidden}</style>
</head><body>${t}</body></html>`}function ie(e){return String(e||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function Ce(e){return JSON.stringify(e??null).replace(/</g,"\\u003c")}function Gr(e,t={}){let a=String(t.visualId||""),r=t.state&&typeof t.state=="object"?t.state:{},n=`<script>(function(){
var visualId=${Ce(a)},last=0,state=${Ce(r)}||{};
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
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,o=String(e||"");return/<head\b[^>]*>/i.test(o)?o.replace(/<head\b[^>]*>/i,i=>`${i}${n}`):`${n}${o}`}function Yr(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let e=()=>{let t=Rt();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(a=>{let r=String(a.getAttribute("data-visual-id")||"");if(!(!r||!a.contentWindow))try{a.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:r,theme:t},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(e,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(e,0)),window.addEventListener("message",t=>{let a=t?.data;if(!a||!String(a.type||"").startsWith("prometheus:visual-"))return;let r=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(o=>o.contentWindow===t.source);if(!r)return;let n=String(r.getAttribute("data-visual-id")||"");if(String(a.visualId||"")===n){if(a.type==="prometheus:visual-resize"){let o=Number(a.height);if(!Number.isFinite(o))return;let i=Math.min(1e4,Math.max(120,Math.ceil(o))),c=Math.ceil(r.getBoundingClientRect().height||0);if(Math.abs(c-i)<=1)return;r.style.height=`${i}px`,r.style.minHeight=`${i}px`;return}if(a.type==="prometheus:visual-state"&&a.state&&typeof a.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:n,state:a.state}}));return}a.type==="prometheus:visual-followup"&&a.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:n,prompt:String(a.prompt),title:String(a.title||"")}}))}})}function Ue(e){if(!e?.getAttribute)return"";let t=e.closest?.(".visual-block"),a=String(e.getAttribute("data-visual-id")||"").trim();return a?[a,String(e.getAttribute("data-visual-version")||"1"),String(t?.getAttribute("data-vis-lang")||""),String(t?.getAttribute("data-vis-code")||"")].join("\0"):""}function Se(e){if(!e?.querySelector&&!e?.matches)return"";let t=e.matches?.('iframe[data-prom-visual="true"]')?e:e.querySelector?.('iframe[data-prom-visual="true"]');return Ue(t)}function Jr(e,t){return!e||!t||e.nodeType!==t.nodeType?!1:e.nodeType!==1?!0:String(e.tagName||"").toLowerCase()===String(t.tagName||"").toLowerCase()}function Xr(e,t){let r=e.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(e.attributes||[]).forEach(n=>{r.has(n.name)||t.hasAttribute(n.name)||e.removeAttribute(n.name)}),Array.from(t.attributes||[]).forEach(n=>{r.has(n.name)||e.getAttribute(n.name)!==n.value&&e.setAttribute(n.name,n.value)})}function ue(e,t,a,r=null){let n=Array.from(t||[]),o=Array.from(a||[]),i=Math.min(n.length,o.length),c=0;for(let s=0;s<i;s+=1){let p=n[s],l=o[s],u=Vt(p,l);if(u){c+=u.reused;continue}let x=l.cloneNode(!0);e.replaceChild(x,p)}for(let s=i;s<o.length;s+=1)e.insertBefore(o[s].cloneNode(!0),r);for(let s=i;s<n.length;s+=1)n[s].remove();return c}function Kr(e,t){return e.length===t.length&&e.every((a,r)=>a===t[r])}function Pt(e,t){let a=Array.from(e.childNodes||[]),r=Array.from(t.childNodes||[]),n=a.map(Se).filter(Boolean),o=r.map(Se).filter(Boolean);if(n.length&&Kr(n,o)){let i=0,c=0,s=0;for(let p of o){let l=a.findIndex((b,S)=>S>=i&&Se(b)===p),u=r.findIndex((b,S)=>S>=c&&Se(b)===p);if(l<0||u<0)return ue(e,a,r);s+=ue(e,a.slice(i,l),r.slice(c,u),a[l]);let x=Vt(a[l],r[u]);if(!x)return ue(e,a,r);s+=x.reused,i=l+1,c=u+1}return s+=ue(e,a.slice(i),r.slice(c)),s}return ue(e,a,r)}function Vt(e,t){return Jr(e,t)?e.nodeType===3||e.nodeType===8?(e.nodeValue!==t.nodeValue&&(e.nodeValue=t.nodeValue),{reused:0}):e.matches?.('iframe[data-prom-visual="true"]')?Ue(e)===Ue(t)?{reused:1}:null:(Xr(e,t),{reused:Pt(e,t)}):null}function qt(e,t){return!e?.childNodes||!t?.childNodes?0:Pt(e,t)}function Zr(e,t){if(!e)return 0;let a=String(t||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof e.appendChild!="function")return e.innerHTML=a,0;let r=document.createElement("template");r.innerHTML=a;let n=!!e.querySelector?.('iframe[data-prom-visual="true"]'),o=!!r.content.querySelector?.('iframe[data-prom-visual="true"]');return!n&&!o?(e.innerHTML=a,0):qt(e,r.content)}function Qr(e,t,a=0){let r=`${e}\0${a}\0${t}`,n=2166136261;for(let o=0;o<r.length;o+=1)n^=r.charCodeAt(o),n=Math.imul(n,16777619);return`visual_local_${(n>>>0).toString(36)}`}function Ft(e,t,a={}){Yr();let r=a.artifact&&typeof a.artifact=="object"?a.artifact:null,n=String(r?.id||a.visualId||Qr(e,t,a.ordinal||0)),o=`vis_${n.replace(/[^a-z0-9_-]/gi,"_")}`,i=Rt(),c=Gr(Bt(e,t,i),{visualId:n,state:r?.state||a.state||{}}),s=ie(c),p=e.replace(/"/g,""),l=ie(t),u=e==="chart"?240:e==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${o}-wrap" data-vis-lang="${p}" data-vis-code="${l}" data-vis-surface="inline">
  <iframe
    id="${o}"
    data-prom-visual="true"
    data-visual-id="${ie(n)}"
    data-visual-version="${ie(r?.version||1)}"
    srcdoc="${s}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${u}px;min-height:${u}px;border:none;display:block;background:transparent;color-scheme:${i.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function Ut(e){let t=String(e||""),a=typeof window<"u"?window.DOMPurify:null;return!a||typeof a.sanitize!="function"?J(t):a.sanitize(t,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function ea(e){let t=String(e||"").trim();if(!t)return"";if(/^file:\/\//i.test(t))try{t=decodeURIComponent(t.replace(/^file:\/\/\/?/i,""))}catch{t=t.replace(/^file:\/\/\/?/i,"")}t=t.replace(/^\.\//,"");let a=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof a=="function")try{let r=a(t);if(r)return String(r)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}function ta(e){let t=String(e||"").trim();return!t||t.startsWith("#")?!1:/^file:\/\//i.test(t)||/^[a-z]:[\\/]/i.test(t)?!0:!(/^[a-z][a-z0-9+.-]*:/i.test(t)||t.startsWith("/")||t.startsWith("\\"))}var ra=/\.(mp4|webm|mov|m4v)(?:$|[?#])/i;function aa(e){let t=String(e||"");return t.includes("<img")?t.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/gi,(a,r,n,o)=>{let i=n.replace(/&amp;/g,"&");if(!ta(i))return a;let c=ea(i),s=`${r}${o}`,p=s.match(/\salt="([^"]*)"/i),l=p?p[1]:"",u=ie(i),x=l?`<span class="prom-inline-caption">${l}</span>`:"";return ra.test(i)?`<span class="prom-inline-figure is-video"><video class="prom-inline-media" src="${ie(c)}" controls playsinline preload="metadata" data-workspace-path="${u}"></video>${x}</span>`:`<span class="prom-inline-figure"><img${s.replace(/\s(?:loading|class)="[^"]*"/gi,"")} src="${ie(c)}" class="prom-inline-media" loading="lazy" decoding="async" data-workspace-path="${u}" role="button" tabindex="0">${x}</span>`}):t}function na({src:e,name:t}){document.getElementById("prom-inline-lightbox")?.remove();let a=document.createElement("div");a.id="prom-inline-lightbox",a.className="prom-inline-lightbox",a.setAttribute("role","dialog"),a.setAttribute("aria-modal","true");let r=document.createElement("img");r.src=e,r.alt=t||"";let n=document.createElement("button");n.type="button",n.className="prom-inline-lightbox-close",n.setAttribute("aria-label","Close"),n.textContent="\xD7",a.append(r,n);let o=()=>{a.remove(),document.removeEventListener("keydown",i)},i=c=>{c.key==="Escape"&&o()};a.addEventListener("click",c=>{c.target!==r&&o()}),document.addEventListener("keydown",i),document.body.appendChild(a)}if(typeof document<"u"&&!window.__promInlineMediaWired){window.__promInlineMediaWired=!0;let e=t=>{let a=t.target?.closest?.("img.prom-inline-media");if(!a||t.type==="keydown"&&t.key!=="Enter"&&t.key!==" ")return;t.preventDefault();let r=a.getAttribute("data-workspace-path")||"",n={kind:"image",src:a.currentSrc||a.src,path:r,name:a.getAttribute("alt")||r.split(/[\\/]/).pop()||"Image"},o=window.__promOpenInlineMedia;if(typeof o=="function")try{o(n);return}catch{}na(n)};document.addEventListener("click",e),document.addEventListener("keydown",e)}var oa=600,ia=2e5,oe=new Map;function Dt(e,t={}){if(!e)return"";let a=String(e);if(a.length<=ia&&!/```(chart|svg|html|mermaid)\n/.test(a)&&!jt(a)&&(le.lastIndex=0,!le.test(a))&&!(Array.isArray(t.visualArtifacts)&&t.visualArtifacts.length)){let n=oe.get(a);if(n!==void 0)return oe.delete(a),oe.set(a,n),n;let o=_t(a,t);return oe.set(a,o),oe.size>oa&&oe.delete(oe.keys().next().value),o}return _t(a,t)}var sa=/```video-project[ \t]*\n([\s\S]*?)```/g,ca=/```video-project[ \t]*\n[\s\S]*$/;function pa(e){let t="";try{t=String(JSON.parse(String(e||"").trim())?.projectId||"")}catch{t=(String(e||"").match(/vp_[A-Za-z0-9_-]+/)||[""])[0]}return/^vp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-vp-card" data-vp-project="${t}"></div>`:""}var da=/```game-project[ \t]*\n([\s\S]*?)```/g,la=/```game-project[ \t]*\n[\s\S]*$/;function ua(e){let t="";try{t=String(JSON.parse(String(e||"").trim())?.projectId||"")}catch{t=(String(e||"").match(/gp_[A-Za-z0-9_-]+/)||[""])[0]}return/^gp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-gp-card" data-gp-project="${t}"></div>`:""}function _t(e,t={}){let a=[],r=`PROMVPCARD${Math.random().toString(36).slice(2)}X`;try{let n=[],o=`PROMVISUAL${Math.random().toString(36).slice(2)}X`;e=String(e).replace(sa,(m,w)=>(a.push(pa(w)),`

${r}${a.length-1}END

`)).replace(ca,"").replace(da,(m,w)=>(a.push(ua(w)),`

${r}${a.length-1}END

`)).replace(la,"");let i=zt(e,r+"C");e=i.text,i.cards.forEach((m,w)=>{a.push(m),e=e.replace(`${r}C${w}END`,`${r}${a.length-1}END`)});let c=At(e,r+"I",t.visualArtifacts,t.renderArtifact);e=c.text,c.cards.forEach((m,w)=>{a.push(m),e=e.replace(`${r}I${w}END`,`${r}${a.length-1}END`)});let s=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,p=0,l=Array.isArray(t.visualArtifacts)?t.visualArtifacts.filter(m=>m?.type==="visual"):[],u=String(e).replace(s,(m,w,h)=>{let y=n.length,z=w.toLowerCase(),T=l.find(re=>Number(re.ordinal)===p&&String(re.renderer||"")===z)||null;return n.push({lang:z,code:h.trim(),partial:!1,artifact:T,ordinal:p}),p+=1,`${o}${y}END`}),x=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,b=u.match(x);if(b){let m=n.length;n.push({lang:b[1].toLowerCase(),code:b[2],partial:!0}),u=u.slice(0,b.index)+`${o}${m}END`}let S=Tt(aa(Ut(marked.parse(u,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1}))));if(n.length){let m=new RegExp(`${o}(\\d+)END`,"g");S=S.replace(m,(w,h)=>{let y=n[+h];return y?y.partial?"":Ft(y.lang,y.code,{artifact:y.artifact,ordinal:y.ordinal}):""}),S=S.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}if(a.length){let m=new RegExp(`(?:<p>\\s*)?${r}(\\d+)END(?:\\s*<\\/p>)?`,"g");S=S.replace(m,(w,h)=>a[+h]||"")}return S}catch{return J(e).replace(new RegExp(`${r}(\\d+)END`,"g"),(o,i)=>a[+i]||"")}}window.escHtml=J;window.escapeHtml=J;window.sanitizeHtml=Ut;window.renderMd=Dt;ct();mt();Fe();window.renderPromDataCard=ye;window.timeAgo=Br;window.fmtPercent=Pr;window.fmtMemoryGb=Vr;window.meterWidth=It;window.setText=qr;window.setMeter=Fr;window.showToast=Lt;window.bgtToast=Ur;window.showConfirm=Dr;window.log=Or;window.buildVisualSrcdoc=Bt;window.buildVisualIframe=Ft;window.preserveVisualIframes=qt;window.setInnerHTMLPreservingVisuals=Zr;window.renderMd=Dt;export{Nr as a,J as b,Na as c,Br as d,Pr as e,Vr as f,It as g,qr as h,Ra as i,Ba as j,Fr as k,Lt as l,Ur as m,Dr as n,Or as o,Bt as p,qt as q,Zr as r,Ft as s,Ut as t,ea as u,Dt as v};
