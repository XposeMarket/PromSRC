var $=a=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a}</svg>`,x={box:$('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),userPlus:$('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),grid:$('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),gauge:$('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),up:$('<path d="M18 15l-6-6-6 6"/>'),down:$('<path d="M6 9l6 6 6-6"/>'),minus:$('<path d="M5 12h14"/>'),plus:$('<path d="M12 5v14M5 12h14"/>'),mic:$('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),share:$('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),split:$('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),rocket:$('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),download:$('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),check:$('<path d="M5 12l5 5L20 7"/>'),x:$('<path d="M18 6L6 18M6 6l12 12"/>'),pen:$('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),film:$('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),talk:$('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><path d="M17 7a4 4 0 010 6M20 4a8 8 0 010 12"/>'),sparkle:$('<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>'),speaker:$('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>'),copies:$('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),undo:$('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>'),trash:$('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>')},Y=null;function ne(a){return Y||(Y=a.vpFetch("/action",{action:"presets"}).then(t=>t?.presets||[]).catch(()=>(Y=null,[]))),Y}function Ue(a,t,r){let e=t.presets||[],o=a.presetId||"",s=Object.entries({camera:"Camera",vfx:"VFX",look:"Look"}).map(([c,h])=>{let d=e.filter(p=>p.group===c);return d.length?`<optgroup label="${h}">${d.map(p=>`<option value="${r.esc(p.id)}"${p.id===o?" selected":""}>${r.esc(p.label)}</option>`).join("")}</optgroup>`:""}).join(""),i=o&&!e.some(c=>c.id===o)?`<option value="${r.esc(o)}" selected>${r.esc(o)}</option>`:"";return`<select class="vpc-select" data-vpf="presetId" data-s="${r.esc(a.id)}" aria-label="Preset" title="Motion / VFX / look preset"><option value="">No preset</option>${i}${s}</select>`}function se(a,t){let r=String(a.modelId||""),e="";return/lipsync/.test(r)?e="lipsync":/omnihuman|ai-avatar/.test(r)?e="talking":a.sourceVideo?e="recast":a.sketch?e="sketch":(t?.kind==="image"||a.kenBurns)&&(e="still"),e?` <span class="vpc-pill is-kind">${e}</span>`:""}function ie(a){return`<span class="vpc-ptools" role="toolbar" aria-label="Studio tools">
    ${a.iconBtn("draw",x.pen,"Draw to video (sketch pad)")}
    ${a.iconBtn("recast",x.film,"Recast a video (upload footage)")}
    ${a.iconBtn("talking-photo",x.talk,"Talking photo (upload portrait)")}
    ${a.iconBtn("upscale",x.sparkle,"Upscale selected takes")}
    ${a.iconBtn("foley",x.speaker,"Add foley / sound effects")}
    ${a.iconBtn("batch",x.copies,"Make ad variants (hooks + creators)")}
  </span>`}function Oe(){return new Promise(a=>{let t=document.createElement("div");t.className="vpc-sketch",t.innerHTML=`<div class="vpc-sketch-box" role="dialog" aria-label="Sketch pad">
      <canvas width="720" height="720"></canvas>
      <div class="vpc-sketch-bar">
        ${[3,8,18].map((p,m)=>`<button type="button" class="vpc-icon${m===1?" is-on":""}" data-w="${p}" title="Brush ${["S","M","L"][m]}" aria-label="Brush ${["small","medium","large"][m]}"><span class="vpc-dotb" style="width:${p/2+4}px;height:${p/2+4}px"></span></button>`).join("")}
        <button type="button" class="vpc-icon" data-k="undo" title="Undo" aria-label="Undo">${x.undo}</button>
        <button type="button" class="vpc-icon" data-k="clear" title="Clear" aria-label="Clear">${x.trash}</button>
        <span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${x.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Use sketch" aria-label="Use sketch">${x.check}</button>
      </div></div>`,document.body.appendChild(t);let r=t.querySelector("canvas"),e=r.getContext("2d"),o=[],n=8,s=null,i=()=>{e.fillStyle="#fff",e.fillRect(0,0,r.width,r.height),e.strokeStyle="#111",e.lineCap="round",e.lineJoin="round";for(let p of o)e.lineWidth=p.w,e.beginPath(),p.pts.forEach(([m,g],y)=>y?e.lineTo(m,g):e.moveTo(m,g)),p.pts.length===1&&e.lineTo(p.pts[0][0]+.1,p.pts[0][1]),e.stroke()},c=p=>{let m=r.getBoundingClientRect();return[(p.clientX-m.left)*(r.width/m.width),(p.clientY-m.top)*(r.height/m.height)]};r.style.touchAction="none",r.addEventListener("pointerdown",p=>{r.setPointerCapture(p.pointerId),s={w:n,pts:[c(p)]},o.push(s),i()}),r.addEventListener("pointermove",p=>{s&&(s.pts.push(c(p)),i())});let h=()=>{s=null};r.addEventListener("pointerup",h),r.addEventListener("pointercancel",h),i();let d=p=>{t.remove(),a(p)};t.addEventListener("click",p=>{let m=p.target.closest("button");if(!m){p.target===t&&d(null);return}if(m.dataset.w){n=Number(m.dataset.w),t.querySelectorAll("[data-w]").forEach(y=>y.classList.toggle("is-on",y===m));return}let g=m.dataset.k;g==="undo"?(o.pop(),i()):g==="clear"?(o.length=0,i()):g==="cancel"?d(null):g==="ok"&&d(o.length?r.toDataURL("image/png").replace(/^data:[^,]*,/,""):null)})})}var Fe={openai:["alloy","ash","coral","echo","fable","nova","onyx","sage","shimmer"],xai:["ara","rex","sal","eve","leo"]},qe=["bold","pop","minimal","karaoke"],De=["9:16","1:1","16:9"];function ce(a,t,r,e){let o="vpc-thumb";if(t?.poster)return`<img class="${o}" src="${e.esc(e.mediaUrl(t.poster))}" alt="" loading="lazy" decoding="async">`;if(t?.path&&e.isVideo(t.path))return`<video class="${o}" src="${e.esc(e.mediaUrl(t.path))}#t=0.1" muted playsinline preload="metadata"></video>`;if(t?.path)return e.thumb(t.path,o);if(a?.storyboard)return e.thumb(a.storyboard,o);let n=(a?.characterIds||[])[0],s=(r?.characters||[]).find(i=>i.id===n)||(r?.characters||[])[0];return e.thumb((s?.anchors||[])[0],o)}function pe(a){return a?.kind==="product"?'<span class="vpc-pill is-product">Product</span>':""}var W=null;function de(a){return W||(W=a.vpFetch("/action",{action:"models"}).then(t=>(t?.models||[]).filter(r=>!r.kind||r.kind==="video")).catch(()=>(W=null,[]))),W}function le(a,t,r,e,o){let n=o.esc(a.id),s=e.models||[],i=a.modelId||"",c=['<option value="">Default model</option>',...s.map(h=>`<option value="${o.esc(h.id)}"${h.id===i?" selected":""}>${o.esc(h.label||h.id)}${h.price!=null?` \xB7 ${o.esc(typeof h.price=="number"?o.usd(h.price):h.price)}`:""}</option>`)];return i&&!s.some(h=>h.id===i)&&c.push(`<option value="${o.esc(i)}" selected>${o.esc(i)}</option>`),`<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${n}">${o.esc(a.prompt||"")}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${n}" placeholder="Spoken line for this shot">${o.esc(a.line||"")}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${o.iconBtn("dur",x.minus,"Shorter",`data-s="${n}" data-d="-1" ${Number(a.durationSec)<=1?"disabled":""}`)}
        <span>${Number(a.durationSec)||0}s</span>
        ${o.iconBtn("dur",x.plus,"Longer",`data-s="${n}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${n}" aria-label="Model">${c.join("")}</select>
      ${Ue(a,e,o)}
      <span class="vpc-grow"></span>
      ${o.iconBtn("move",x.up,"Move up",`data-s="${n}" data-i="${t-1}" ${t===0?"disabled":""}`)}
      ${o.iconBtn("move",x.down,"Move down",`data-s="${n}" data-i="${t+1}" ${t>=r-1?"disabled":""}`)}
      ${(a.takes||[]).length>=2?o.iconBtn("variants",x.split,"Render hook variants (one export per take)",`data-s="${n}"`):""}
    </div>
    ${a.voiceover?.path?`<audio class="vpc-audio" src="${o.esc(o.mediaUrl(a.voiceover.path))}" controls preload="none"></audio>`:""}
  </div>`}function ue(a,t){let r=a?.qa;if(!r||r.score==null)return"";let e=Number(r.score),o=e>=7?"good":e>=5?"warn":"bad",n=[`QA ${e}/10${r.verdict?` \xB7 ${r.verdict}`:""}${r.model?` \xB7 ${r.model}`:""}`,...r.issues||[]].join(`
`);return`<span class="vpc-qa is-${o}" title="${t.esc(n)}" aria-label="${t.esc(n)}">${e}</span>`}function ve(a,t){let r=a.shots||[];if(!r.some(n=>n.storyboard||(n.storyboardCandidates||[]).length))return"";let e=r.some(n=>!n.storyboard&&(n.storyboardCandidates||[]).length);return`<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${r.map((n,s)=>{let i=t.esc(n.id),c=(n.storyboardCandidates||[]).find(p=>p!==n.storyboard),h=n.storyboard||c;if(!h)return`<div class="vpc-sb is-empty"><span class="vpc-sb-n">${s+1}</span></div>`;let d=!n.storyboard&&c?`<div class="vpc-tile-actions">
        ${t.iconBtn("sb-approve",x.check,"Approve storyboard",`data-s="${i}" data-path="${t.esc(c)}"`,"is-go")}
        ${t.iconBtn("sb-reject",x.x,"Reject storyboard",`data-s="${i}" data-path="${t.esc(c)}"`)}
      </div>`:`<span class="vpc-badge">${x.check}</span>`;return`<div class="vpc-sb${n.storyboard?" is-approved":""}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${t.esc(h)}" aria-label="View storyboard ${s+1}">${t.thumb(h,"vpc-tile-img")}</button>
      <span class="vpc-sb-n">${s+1}</span>${d}</div>`}).join("")}</div>
    ${e?`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${x.check}<span>Approve all</span></button>`:""}
  </section>`}function me(a,t,r){if(!(a.shots||[]).length)return"";let e=a.voice||{},o=e.provider||"openai",n=Object.entries(Fe).map(([g,y])=>`<optgroup label="${g==="xai"?"xAI":"OpenAI"}">${y.map(T=>`<option value="${g}:${T}"${g===o&&T===e.voice?" selected":""}>${T}</option>`).join("")}</optgroup>`).join(""),s=a.captions||{},i=a.music||null,c=i?/chill/i.test(i.label||i.path||"")?"chill":/pulse/i.test(i.label||i.path||"")?"pulse":"custom":"none",h=(a.shots||[]).some(g=>g.line),d=Math.round((i?.volume??.3)*100),p=(a.audioMode||"voiceover")==="native";return`<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    ${`<div class="vpc-row vpc-wrap" role="radiogroup" aria-label="Who speaks the lines">
      <span class="vpc-muted">Speech</span>
      ${[["native","On camera","The creator speaks each line in the clip; captions transcribe the clip audio"],["voiceover","Narrator","TTS voiceover over dialogue-free clips; captions follow the voiceover"]].map(([g,y,T])=>`<button type="button" class="vpc-chip${(p?"native":"voiceover")===g?" is-on":""}" data-vpa="audio-mode" data-v="${g}" role="radio" aria-checked="${(p?"native":"voiceover")===g}" title="${T}">${y}</button>`).join("")}
    </div>`}
    ${p?`<div class="vpc-row vpc-wrap"><button type="button" class="vpc-btn" data-vpa="transcribe" title="Re-read what each clip says for captions">${x.mic}<span>Transcribe clips</span></button></div>`:`<div class="vpc-row vpc-wrap">
      ${x.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${e.voice?"":'<option value="" selected>Pick a voice</option>'}${n}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${h?"":'disabled title="Add voiceover lines to shots first"'}>${x.mic}<span>Voiceover</span></button>
    </div>`}
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${s.enabled?" checked":""}><span>Captions</span></label>
      ${qe.map(g=>`<button type="button" class="vpc-chip${(s.style||"bold")===g&&s.enabled?" is-on":""}" data-vpa="cap-style" data-v="${g}" aria-pressed="${(s.style||"bold")===g&&!!s.enabled}">${g}</button>`).join("")}
      ${s.cues?.length?`<span class="vpc-muted">${s.cues.length} cues</span>`:""}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[["pulse","Pulse"],["chill","Chill"],["none","None"]].map(([g,y])=>`<button type="button" class="vpc-chip${c===g?" is-on":""}" data-vpa="music" data-v="${g}" aria-pressed="${c===g}">${y}</button>`).join("")}
      ${c==="custom"?`<span class="vpc-chip is-on">${r.esc(i.label||"Custom")}</span>`:""}
      ${i?`<input class="vpc-range" type="range" min="0" max="100" value="${d}" data-vpf="volume" aria-label="Music volume" title="Music volume ${d}%">`:""}
    </div>
  </section>`}function he(a,t,r){let e=[],o=a.lastRun;o?.steps?.length&&e.push(`<ol class="vpc-steps">${o.steps.map(s=>`<li class="is-${r.esc(s.state)}" title="${r.esc(s.note||s.state)}"><span class="vpc-dot"></span>${r.esc(s.step)}${s.note?` <small class="vpc-muted">${r.esc(String(s.note).slice(0,80))}</small>`:""}</li>`).join("")}</ol>`);let n=t.actPending||(o?.needsApproval?{action:"run",args:{},usd:o.needsApproval.usd,breakdown:o.needsApproval.breakdown}:null);if(n){let s=(n.breakdown||[]).map(i=>`<li>${r.esc(i.item)} \xB7 ${r.usd(i.usd)}</li>`).join("");e.push(`<div class="vpc-approve">
      <strong>${n.action==="storyboard"?"Storyboard":n.action==="run"?"Autopilot":r.esc(n.action)} needs approval \xB7 ${r.usd(n.usd)}</strong>
      ${s?`<ul>${s}</ul>`:""}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${x.check}<span>Approve ${r.usd(n.usd)}</span></button>
        ${r.iconBtn("act-cancel",x.x,"Cancel")}
      </div></div>`)}return(a.shots||[]).length&&e.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${t.busy?"disabled":""}>${x.rocket}<span>Run all</span></button>`),e.length?`<section class="vpc-sec"><h4>Autopilot</h4>${e.join("")}</section>`:""}function ge(a,t,r){let e=(a.exports||[]).slice().reverse(),o=De.map(s=>`<button type="button" class="vpc-chip${t.aspects.has(s)?" is-on":""}" data-vpa="aspect" data-v="${s}" aria-pressed="${t.aspects.has(s)}">${s}</button>`).join(""),n=e.slice(0,6).map(s=>{let i=r.mediaUrl(s.path),c=[s.aspect,s.variant?`variant ${s.variant}`:"",`${Number(s.durationSec||0).toFixed(1)}s`].filter(Boolean).join(" \xB7 ");return`<div class="vpc-export">
      <video src="${r.esc(i)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${r.esc(c)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${r.esc(i)}" download="${r.esc(String(s.path).split("/").pop())}" title="Download" aria-label="Download">${x.download}</a>
        ${r.iconBtn("share",x.share,"Share",`data-path="${r.esc(s.path)}"`)}
      </div></div>`}).join("");return`<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${o}</div>
    ${n?`<div class="vpc-exports">${n}</div>`:""}</section>`}function Z(a="image/*"){return new Promise(t=>{let r=document.createElement("input");r.type="file",r.accept=a,r.style.display="none",r.addEventListener("change",()=>{let e=r.files&&r.files[0];if(r.remove(),!e)return t(null);let o=new FileReader;o.onload=()=>t({filename:e.name,dataBase64:String(o.result||"").replace(/^data:[^,]*,/,"")}),o.onerror=()=>t(null),o.readAsDataURL(e)}),document.body.appendChild(r),r.click()})}async function He(a,t){let r=t.mediaUrl(a);try{r=new URL(r,location.href).href}catch{}if(navigator.share)try{return await navigator.share({title:"Video",url:r}),"Shared"}catch{return""}try{return await navigator.clipboard.writeText(r),"Link copied"}catch{return"Copy failed"}}async function fe(a,t){let{st:r,d:e,act:o,ops:n,paint:s,h:i}=t,c=r.project||{},h=d=>(c.shots||[]).find(p=>p.id===d);switch(a){case"upload-product":case"upload-character":{let d=await Z();return d&&await o("import_asset",{...d,role:a==="upload-product"?"product":"character",name:d.filename.replace(/\.[^.]+$/,"")},"Uploading"),!0}case"storyboard":return await o("storyboard",{},"Storyboarding"),!0;case"sb-approve":return await n([{op:"shot.approveStoryboard",id:e.s,path:e.path}],"Approving storyboard"),!0;case"sb-reject":return await n([{op:"shot.rejectStoryboard",id:e.s,path:e.path}],"Rejecting"),!0;case"sb-approve-all":{let d=(c.shots||[]).filter(p=>!p.storyboard&&(p.storyboardCandidates||[]).length).map(p=>({op:"shot.approveStoryboard",id:p.id,path:p.storyboardCandidates[0]}));return d.length&&await n(d,"Approving storyboard"),!0}case"dur":{let d=h(e.s);if(!d)return!0;let p=Math.max(1,Math.min(30,(Number(d.durationSec)||5)+Number(e.d)));return await n([{op:"shot.update",id:e.s,durationSec:p}],"Saving"),!0}case"move":return await n([{op:"shot.move",id:e.s,index:Number(e.i)}],"Reordering"),!0;case"variants":return await o("render_variants",{shotId:e.s},"Rendering hook variants",900*1e3),!0;case"qa":return await o("qa",{},"Scoring takes",300*1e3),!0;case"voiceover":return await o("voiceover",{},"Recording voiceover",300*1e3),!0;case"audio-mode":return await n([{op:"project.update",audioMode:e.v}],e.v==="native"?"Using on-camera dialogue":"Using a narrator"),!0;case"transcribe":return await o("transcribe",{force:!0},"Transcribing clips",3e5)&&c.captions?.enabled&&await o("captions",{style:c.captions.style},"Rebuilding captions"),!0;case"cap-style":{let d=e.v;return await o("captions",{style:d},"Building captions")&&await n([{op:"captions.set",enabled:!0,style:d}],"Saving captions"),!0}case"music":return e.v==="none"?await n([{op:"music.clear"}],"Removing music"):await o("music",{builtin:e.v},"Adding music"),!0;case"run-all":return await o("run",{},"Running autopilot",1800*1e3),!0;case"act-approve":{let d=r.actPending||(c.lastRun?.needsApproval?{action:"run",args:{}}:null);return r.actPending=null,d&&await o(d.action,{...d.args||{},approved:!0},"Submitting",1800*1e3),!0}case"act-cancel":return r.actPending=null,c.lastRun&&(c.lastRun.needsApproval=void 0),s(),!0;case"aspect":return r.aspects.has(e.v)?r.aspects.delete(e.v):r.aspects.add(e.v),s(),!0;case"draw":{let d=await Oe();if(!d)return!0;let p=window.prompt("What should this sketch become?","A cinematic scene")||"";return p.trim()&&await o("draw_to_video",{dataBase64:d,prompt:p},"Sketch to video",900*1e3),!0}case"recast":{let d=await Z("video/*");if(!d)return!0;let p=await o("import_asset",{...d,role:"footage"},"Uploading footage",300*1e3);if(!p?.assetPath)return!0;let m=window.prompt("Recast it as\u2026 (new character, outfit, world or style)","")||"";return m.trim()&&await o("recast",{sourcePath:p.assetPath,prompt:m,mode:"edit"},"Recasting",900*1e3),!0}case"talking-photo":{let d=await Z();if(!d)return!0;let p=await o("import_asset",{...d,role:"asset"},"Uploading portrait");if(!p?.assetPath)return!0;let m=window.prompt("What should they say?","")||"";return m.trim()&&await o("talking_photo",{imagePath:p.assetPath,line:m},"Talking photo",900*1e3),!0}case"upscale":return await o("upscale",{},"Upscaling",900*1e3),!0;case"foley":return await o("foley",{},"Adding sound",900*1e3),!0;case"batch":return await o("batch_variants",{count:3,vary:["hook","creator"]},"Planning variants",300*1e3),!0;case"share":{let d=await He(e.path,i);return d&&(r.error="",r.busy="",r.toast=d,s()),!0}default:return!1}}async function be(a,t){let{d:r,ops:e,value:o,checked:n,st:s}=t;switch(a){case"prompt":case"line":case"modelId":case"presetId":{let i=(s.project?.shots||[]).find(c=>c.id===r.s);if(i&&String(i[a]||"")===o)return;await e([{op:"shot.update",id:r.s,[a]:o}],"Saving");return}case"voice":{let[i,c]=String(o).split(":");c&&await e([{op:"voice.set",provider:i,voice:c}],"Setting voice");return}case"captions":{let i=s.project?.captions?.style||"bold";n&&!(s.project?.captions?.cues||[]).length&&await t.act("captions",{style:i},"Building captions"),await e([{op:"captions.set",enabled:!!n,style:i}],"Saving captions");return}case"volume":{let i=s.project?.music;i?.path&&await e([{op:"music.set",path:i.path,volume:Number(o)/100,duck:i.duck!==!1}],"Saving");return}default:}}var xe=`
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
.vpc-sketch .vpc-icon{min-width:40px;min-height:40px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--prom-border,#ccc);border-radius:9px;background:transparent;color:var(--prom-text,#111);cursor:pointer}
.vpc-sketch .vpc-icon svg{width:18px;height:18px}
.vpc-sketch .vpc-icon.is-on,.vpc-sketch .vpc-icon.is-go{border-color:var(--prom-accent,#6c5ce7);color:var(--prom-accent,#6c5ce7)}
.vpc-dotb{display:inline-block;border-radius:50%;background:currentColor}
@media (max-width:420px){.prom-vp-card .vpc-ptools{max-width:100%}}
@media (max-width:420px){.prom-vp-card .vpc-tools{flex-wrap:wrap;justify-content:flex-end;max-width:50%}}
`;var we="prom-vp-card-style",Ye=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",ye=new Map,A=(a,t="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${t}>${a}</svg>`,k={film:A('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:A('<path d="M5 12l5 5L20 7"/>'),x:A('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:A('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:A('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:A('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:A('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:A('<path d="M7 4v16l13-8z"/>'),seq:A('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:A('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:A('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:A('<path d="M6 9l6 6 6-6"/>'),user:A('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:A('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:A('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function b(a){return String(a??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function P(a){return`$${(Number(a)||0).toFixed(2)}`}function G(a){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(a||""))}function ee(a){return String(a||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function F(a){let t=String(a||"").trim();if(!t)return"";if(/^(https?:|data:|blob:)/i.test(t))return t;let r=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof r=="function")try{let e=r(t);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}async function N(a,t,r=2e4){let e={method:t===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:t===void 0?void 0:JSON.stringify(t),timeoutMs:r},o=`/api/video-projects${a}`,n=window.__promVideoProjectFetch||window.api,s;if(typeof n=="function")s=await n(o,e);else{let i=await fetch(o,e);s=await i.json().catch(()=>({success:!1,error:`HTTP ${i.status}`}))}if(s&&s.success===!1)throw new Error(s.error||"Request failed");return s||{}}function $e(a){let t=a?.takes||[];return t.length?t.find(r=>r.id===a.selectedTakeId)||t[t.length-1]:null}function te(a,t="vpc-thumb"){if(!a)return`<span class="${t} is-empty">${k.film}</span>`;let r=b(F(a));return G(a)?`<video class="${t}" src="${r}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${t}" src="${r}" alt="" loading="lazy" decoding="async">`}function z(a,t,r,e="",o=""){return`<button type="button" class="vpc-icon${o?` ${o}`:""}" data-vpa="${a}" title="${b(r)}" aria-label="${b(r)}" ${e}>${t}</button>`}function We(a){a.dataset.vpMounted="1";let t=String(a.dataset.vpProject||""),r=ye.get(t),e={project:r?.project||null,history:r?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1,actPending:null,models:[],aspects:new Set,toast:""},o={esc:b,usd:P,isVideo:G,mediaUrl:F,thumb:te,iconBtn:z,vpFetch:N},n=null,s=()=>a.isConnected;function i(v){v?.project&&(e.project=v.project),v?.history&&(e.history=v.history),e.project&&ye.set(t,{project:e.project,history:e.history,at:Date.now()})}async function c(){if(s()){try{i(await N(`/${encodeURIComponent(t)}`)),e.error=""}catch(v){e.error=String(v?.message||v)}await m(),V(),d()}}function h(){return(e.project?.jobs||[]).filter(v=>v.state==="queued"||v.state==="running")}function d(){clearTimeout(n),s()&&(h().length||e.rendering)&&(n=setTimeout(c,3500))}function p(){let v=new Set(h().map(l=>l.target?.shotId).filter(Boolean));return(e.project?.shots||[]).filter(l=>!(l.takes||[]).length&&!v.has(l.id))}async function m(){let v=p(),l=v.map(f=>`${f.id}:${f.modelId||""}:${f.durationSec}:${(f.characterIds||[]).join(",")}`).join("|")+`#${(e.project?.characters||[]).map(f=>(f.anchors||[]).length).join(",")}`;if(!v.length){e.estimate=null,e.estimateKey="";return}if(!(l===e.estimateKey&&e.estimate))try{e.estimate=await N(`/${encodeURIComponent(t)}/estimate`,{shotIds:v.map(f=>f.id)}),e.estimateKey=l}catch(f){e.estimate=null,e.error=String(f?.message||f)}}async function g(v,l){e.busy=v,e.error="",V();try{let f=await l();return i(f),f}catch(f){return e.error=String(f?.message||f),null}finally{e.busy="",V()}}async function y(v,l){await g(l,()=>N(`/${encodeURIComponent(t)}/ops`,{ops:v})),await c()}async function T(v,l={},f="Working",w=12e4){let u=await g(f,()=>N(`/${encodeURIComponent(t)}/action`,{action:v,...l},w));if(!u)return null;let I=u.needsApproval;if(I){let E=u.lastRun?.needsApproval;e.actPending={action:v,args:l,usd:Number(E?.usd??I?.usd??u.estimateUsd??u.totalUsd??u.estimate?.total??0),breakdown:E?.breakdown||I?.breakdown||u.breakdown||[]}}else e.actPending=null;return e.estimateKey="",await c(),u}async function B(v,l,f){let w=await g(f,()=>N(`/${encodeURIComponent(t)}${v}`,l,12e4));if(w){if(w.needsApproval){e.pending={path:v,body:{...l,approved:!0},label:f,reason:w.reason,estimate:w.estimate},V();return}e.pending=null,e.estimateKey="",await c()}}async function D(){let v=e.project;if(!v)return;let l=(v.clips||[]).some(f=>f.source&&"shotId"in f.source);if(e.rendering=!0,e.aspects.size){await T("render",{aspects:[...e.aspects]},"Rendering",900*1e3),e.rendering=!1,await c();return}if(!l&&!await g("Assembling",()=>N(`/${encodeURIComponent(t)}/ops`,{ops:[{op:"timeline.assemble"}]}))){e.rendering=!1,V();return}await g("Rendering",()=>N(`/${encodeURIComponent(t)}/render`,{},900*1e3)),e.rendering=!1,await c()}function Q(v,l){let f=F(v);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:f,path:v,name:l||v.split("/").pop(),kind:G(v)?"video":"image"});return}catch{}window.open(f,"_blank","noopener")}function H(v){let l=`${z("upload-product",x.box,"Upload product photo")}${z("upload-character",x.userPlus,"Upload character photo")}${ie(o)}`;if(!(v.characters||[]).length)return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${l}</h4></section>`;let f=h().filter(u=>u.target?.characterId),w=v.characters.map(u=>{let I=f.some(M=>M.target.characterId===u.id),E=(u.anchors||[])[0],R=u.candidates||[],j=E?"Anchor approved":R.length?"Pick an anchor":I?"Generating anchor":"No anchor yet",S=[E?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${b(E)}" aria-label="View anchor">${te(E,"vpc-tile-img")}</button><span class="vpc-badge">${k.check}</span></div>`:"",...R.map(M=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${b(M)}" aria-label="View candidate">${te(M,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${z("approve-anchor",k.check,"Approve as anchor",`data-c="${b(u.id)}" data-path="${b(M)}"`,"is-go")}
            ${z("reject-anchor",k.x,"Reject",`data-c="${b(u.id)}" data-path="${b(M)}"`)}
          </div>
        </div>`),I?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${k.user}<strong>${b(u.name)}</strong>${pe(u)}</span>
          <span class="vpc-muted">${b(j)}</span>
          <span class="vpc-grow"></span>
          ${u.anchorPrompt?z("reroll",k.reroll,"Generate another anchor",`data-c="${b(u.id)}"`):""}
        </div>
        ${S?`<div class="vpc-strip">${S}</div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${l}</h4>${w}</section>`}function Re(v){let l=v.shots||[];if(!l.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let f=new Set(h().map(u=>u.target?.shotId).filter(Boolean)),w=l.map((u,I)=>{let E=$e(u),R=f.has(u.id),j=e.openShot===u.id,S=(u.takes||[]).length,M=j?(u.takes||[]).slice().reverse().map(C=>`
        <div class="vpc-take${C.id===E?.id?" is-selected":""}">
          ${G(C.path)?`<video src="${b(F(C.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${b(F(C.path))}" alt="" loading="lazy">`}
          <div class="vpc-row">
            ${ue(C,o)}<span class="vpc-muted">${b(ee(C.modelId))} \xB7 ${P(C.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${C.id===E?.id?`<span class="vpc-inuse">${k.check}In cut</span>`:z("use-take",k.check,"Use this take",`data-s="${b(u.id)}" data-t="${b(C.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${j?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${b(u.id)}" aria-expanded="${j}">
          ${R&&!E?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':ce(u,E,v,o)}
          <span class="vpc-shot-meta">
            <strong>${I+1}. ${b(u.title||"Shot")}${se(u,E)}</strong>
            <small>${b(String(u.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${R?"generating":b(u.status)}">${R?"generating":b(u.status)} \xB7 ${u.durationSec}s \xB7 ${S} take${S===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${k.chevron}</span>
        </button>
        ${j?`<div class="vpc-shot-body">
          ${le(u,I,l.length,e,o)}
          ${u.camera?`<p class="vpc-muted">Camera: ${b(u.camera)}</p>`:""}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${b(u.id)}" data-n="1" ${R?"disabled":""}>${k.reroll}<span>${S?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${b(u.id)}" data-n="3" ${R?"disabled":""}>${k.layers}<span>3 variations</span></button>
          </div>
          ${M?`<div class="vpc-takes">${M}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${l.length}</span></h4>${w}</section>`}function Pe(v){let l=[];if(e.pending){let S=(e.pending.estimate?.shots||[]).map(M=>`<li>${b(M.title||"Item")}: ${M.count}\xD7 ${b(ee(M.modelId))} \xB7 ${P(M.usd)}</li>`).join("");l.push(`<div class="vpc-approve">
        <strong>Approve ${P(e.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${b(e.pending.reason||"")}</p>
        ${S?`<ul>${S}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${k.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${k.x}<span>Cancel</span></button>
        </div>
      </div>`)}let f=p(),w=e.estimate;if(!e.pending&&f.length&&w){let S=(w.shots||[]).flatMap(C=>(C.problems||[]).map(Ne=>`${C.title}: ${Ne}`)),M=(v.characters||[]).some(C=>!(C.anchors||[]).length&&(C.candidates||[]).length);l.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${f.length} shot${f.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${P(w.total)}</strong></div>
        ${M?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${S.length?`<ul class="vpc-warn">${S.map(C=>`<li>${b(C)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${M?"disabled":""}>${k.spark}<span>${w.total>(v.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${P(w.total)}</span></button>
      </div>`)}let u=h();u.length&&l.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${u.length} job${u.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let I=(v.jobs||[]).filter(S=>S.state==="failed").slice(-2);I.length&&!u.length&&l.push(`<ul class="vpc-warn">${I.map(S=>`<li>${b(ee(S.modelId))} failed: ${b(String(S.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let E=v.shots||[],R=E.length&&E.every(S=>$e(S)),j=(v.exports||[]).slice(-1)[0];return(R||j)&&l.push(`<div class="vpc-final">
        ${j?`<video src="${b(F(j.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(j.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${z("view",k.download,"Open video",`data-path="${b(j.path)}"`)}</div>`:""}
        ${R?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${e.rendering||u.length?"disabled":""}>${e.rendering?'<span class="vpc-spin"></span>':k.play}<span>${j?"Re-render":"Render video"}</span></button>
          ${z("assemble",k.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),l.length?`<section class="vpc-sec vpc-actions">${l.join("")}</section>`:""}function V(){if(!s())return;let v=document.activeElement;if(v&&a.contains(v)&&v.matches?.("textarea[data-vpf]")&&!e.busy)return;let l=e.project;if(!l){a.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${k.film}Video project</span></div>
        <p class="vpc-muted">${e.error?b(e.error):"Loading\u2026"}</p></div>`;return}let f=l.budget||{};a.innerHTML=`<div class="vpc">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${k.film}Video project \xB7 ${b(l.target?.aspect||"")}</span>
          <strong class="vpc-title">${b(l.title||l.id)}</strong>
          <span class="vpc-muted">${P(f.spentUsd)} spent${f.capUsd!=null?` of ${P(f.capUsd)}`:""} \xB7 auto-approve under ${P(f.autoApproveUsd??1)}</span>
        </div>
        <div class="vpc-tools">
          ${z("undo",k.undo,"Undo",e.history?.undo?"":"disabled")}
          ${z("redo",k.redo,"Redo",e.history?.redo?"":"disabled")}
          ${z("storyboard",x.grid,"Generate storyboard")}
          ${z("qa",x.gauge,"QA: score selected takes")}
          ${z("refresh",k.refresh,"Refresh")}
        </div>
      </div>
      ${e.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${b(e.busy)}\u2026</div>`:""}
      ${e.error?`<p class="vpc-err">${b(e.error)}</p>`:""}
      ${e.toast?`<div class="vpc-toast">${b(e.toast)}</div>`:""}
      ${H(l)}
      ${ve(l,o)}
      ${Re(l)}
      ${me(l,e,o)}
      ${Pe(l)}
      ${he(l,e,o)}
      ${ge(l,e,o)}
    </div>`}a.addEventListener("click",async v=>{let l=v.target.closest("[data-vpa]");if(!l||!a.contains(l)||l.disabled||(v.preventDefault(),v.stopPropagation(),e.busy&&l.dataset.vpa!=="toggle"&&l.dataset.vpa!=="view"))return;let f=l.dataset.vpa,w=l.dataset;switch(f){case"toggle":e.openShot=e.openShot===w.s?"":w.s,V(),e.openShot&&!e.models.length&&de(o).then(u=>{e.models=u,u.length&&V()}),e.openShot&&!(e.presets||[]).length&&ne(o).then(u=>{e.presets=u,u.length&&V()});return;case"view":w.path&&Q(w.path);return;case"refresh":e.estimateKey="",await c();return;case"undo":case"redo":await g(f==="undo"?"Undoing":"Redoing",()=>N(`/${encodeURIComponent(t)}/${f}`,{})),e.estimateKey="",await c();return;case"approve-anchor":await y([{op:"character.approveAnchor",id:w.c,path:w.path}],"Approving anchor");return;case"reject-anchor":await y([{op:"character.rejectAnchor",id:w.c,path:w.path}],"Removing");return;case"reroll":await B(`/characters/${encodeURIComponent(w.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await y([{op:"take.select",shotId:w.s,takeId:w.t}],"Swapping take");return;case"redo-shot":await B("/generate",{shotIds:[w.s],count:Number(w.n)||1},"Estimating");return;case"gen-all":{let u=p().map(I=>I.id);if(!u.length)return;await B("/generate",{shotIds:u,count:1,approved:!0},"Submitting");return}case"approve-pending":{let u=e.pending;if(!u)return;e.pending=null,await B(u.path,u.body,"Submitting");return}case"cancel-pending":e.pending=null,V();return;case"assemble":await y([{op:"timeline.assemble"}],"Assembling");return;case"render":await D();return;default:e.toast="",await fe(f,{st:e,d:w,act:T,ops:y,paint:V,h:o})}}),a.addEventListener("change",async v=>{let l=v.target.closest?.("[data-vpf]");!l||!a.contains(l)||e.busy||await be(l.dataset.vpf,{st:e,d:l.dataset,ops:y,act:T,value:l.value,checked:l.checked})}),a.addEventListener("click",v=>{v.target.closest?.("[data-vpf]")&&v.stopPropagation()}),V(),r&&Date.now()-r.at<3e3?m().then(()=>{V(),d()}):c()}var re=null,ae=!1;function ke(a=document){ae=!1,a.querySelectorAll?.(Ye).forEach(t=>{try{We(t)}catch(r){console.warn("[video-project-card] mount failed",r)}})}function Se(){if(!(typeof document>"u")){if(!document.getElementById(we)){let a=document.createElement("style");a.id=we,a.textContent=Ge+xe,document.head.appendChild(a)}ke(),!re&&(re=new MutationObserver(()=>{ae||(ae=!0,requestAnimationFrame(()=>ke()))}),re.observe(document.documentElement,{childList:!0,subtree:!0}))}}var Ge=`
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
`;function _(a){return a?String(a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var Et=_;function Xe(a){let t=Date.now()-a;return t<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?`${Math.floor(t/36e5)}h ago`:`${Math.floor(t/864e5)}d ago`}function Ke(a,t=0){let r=Number(a);return Number.isFinite(r)?`${r.toFixed(t)}%`:"--%"}function Je(a,t){let r=Number(a),e=Number(t);return!Number.isFinite(r)||!Number.isFinite(e)||e<=0?"-- / -- GB":`${r.toFixed(1)} / ${e.toFixed(1)} GB`}function Ce(a){let t=Number(a);return Number.isFinite(t)?`${Math.max(0,Math.min(100,t))}%`:"0%"}function Qe(a,t){let r=document.getElementById(a);r&&(r.textContent=String(t||""))}function Tt(a){let t=String(a||"").trim(),r=_(t);return`<span class="t-think-sizer" aria-hidden="true">${r}</span><span class="t-think-text" data-text="${r}">${r}</span>`}function At(a,t){let r=String(t||"").trim(),e=a?.querySelector?.(".t-think-text");if(!e||!r)return!1;let o=String(e.textContent||"").trim();if(!o||o===r)return!1;a.querySelectorAll?.(".t-think-text").forEach(c=>{c!==e&&c.remove()});let n=e.cloneNode(!0);n.classList.remove("is-enter-start"),n.classList.add("is-exit"),n.textContent=r,n.setAttribute("data-text",r),e.classList.remove("is-exit"),e.classList.add("is-enter-start");let s=a.querySelector?.(".t-think-sizer");s&&r.length>String(s.textContent||"").length&&(s.textContent=r),a.appendChild(n),e.offsetWidth;let i=()=>{e.isConnected!==!1&&e.classList.remove("is-enter-start")};return typeof requestAnimationFrame=="function"?requestAnimationFrame(i):typeof setTimeout=="function"&&setTimeout(i,0),typeof setTimeout=="function"&&setTimeout(()=>{n.isConnected!==!1&&n.remove(),e.isConnected!==!1&&e.classList.remove("is-enter-start")},420),!0}function Ze(a,t){let r=document.getElementById(a);r&&(r.style.width=Ce(t))}function Ee(a,t,r="info",e=5e3,o={}){let n=typeof o?.key=="string"?o.key.trim():"";if(n)for(let m of document.querySelectorAll(".__sc-toast"))m.dataset.scToastKey===n&&m.remove();let s=r==="warn"?"warning":["info","success","error","warning"].includes(r)?r:"info",i={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},c=document.createElement("div"),d=24+[...document.querySelectorAll(".__sc-toast")].reduce((m,g)=>m+g.offsetHeight+8,0);if(c.className=`__sc-toast __sc-toast--${s}`,n&&(c.dataset.scToastKey=n),c.style.cssText=`position:fixed;bottom:${d}px;right:24px;z-index:99999;`,c.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${i[s]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${_(a)}</div>
      ${t?`<div class="__sc-toast-body">${_(String(t))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let m=document.createElement("style");m.id="__sc-toast-style",m.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(m)}document.body.appendChild(c);let p=Math.max(0,Math.min(5e3,Number.isFinite(Number(e))?Number(e):5e3));setTimeout(()=>{c.style.transition="opacity 0.3s",c.style.opacity="0",setTimeout(()=>c.remove(),300)},p),c.querySelector(".__sc-toast-close")?.addEventListener("click",()=>c.remove())}function et(a,t){Ee(a,t,"info")}function tt(a,t,r,e={}){let{title:o="Confirm",confirmText:n="Confirm",cancelText:s="Cancel",danger:i=!1,details:c=""}=e,h=document.createElement("div");h.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let d=document.createElement("div");d.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",d.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${_(o)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${_(a)}</div>
    ${c?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${_(c)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${_(s)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${i?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${_(n)}</button>
    </div>
  `,h.appendChild(d),document.body.appendChild(h);let p=()=>h.remove();d.querySelector("#__sc-confirm-cancel").onclick=()=>{p(),r&&r()},d.querySelector("#__sc-confirm-ok").onclick=()=>{p(),t&&t()},h.addEventListener("click",m=>{m.target===h&&(p(),r&&r())})}var X=[];function rt(a,t="log"){let r=new Date().toLocaleTimeString();X.push({text:`[${r}] ${String(a??"")}`,type:String(t||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),X.length>100&&X.shift();let e=document.getElementById("log-panel");e&&(e.replaceChildren(...X.map(o=>{let n=document.createElement("div");return n.className=`log-line ${o.type}`,n.textContent=o.text,n})),e.scrollTop=e.scrollHeight)}var L=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function Te(a,t){return String(a||"").replace(/[<>{};\r\n]/g,"").trim()||t}function Ae(){let a=document.documentElement,t=typeof getComputedStyle=="function"?getComputedStyle(a):null,r=(o,n)=>{for(let s of o){let i=t?.getPropertyValue(s)?.trim();if(i)return Te(i,n)}return n},e={isDark:a.getAttribute("data-theme")==="dark",bg:r(["--bg","--pm-chat-page-bg"],L.bg),bgSoft:r(["--bg-soft"],L.bgSoft),surface:r(["--panel","--composer-panel"],L.surface),surfaceSecondary:r(["--panel-2","--composer-bg"],L.surfaceSecondary),border:r(["--line","--composer-border"],L.border),borderStrong:r(["--line-strong"],L.borderStrong),text:r(["--text","--fg","--composer-text"],L.text),muted:r(["--muted","--composer-muted"],L.muted),accent:r(["--brand","--pm-custom-accent"],L.accent),accentStrong:r(["--brand-2"],L.accentStrong),success:r(["--ok"],L.success),warning:r(["--warn"],L.warning),danger:r(["--err"],L.danger)};return e.series=[e.accent,e.accentStrong,e.success,e.warning,e.danger,e.muted],e.vars={"--prom-bg":e.bg,"--prom-bg-soft":e.bgSoft,"--prom-surface":e.surface,"--prom-surface-secondary":e.surfaceSecondary,"--prom-border":e.border,"--prom-border-strong":e.borderStrong,"--prom-text":e.text,"--prom-muted":e.muted,"--prom-accent":e.accent,"--prom-accent-strong":e.accentStrong,"--prom-success":e.success,"--prom-warning":e.warning,"--prom-danger":e.danger,"--prom-series-1":e.series[0],"--prom-series-2":e.series[1],"--prom-series-3":e.series[2],"--prom-series-4":e.series[3],"--prom-series-5":e.series[4],"--prom-series-6":e.series[5],"--bg":e.bg,"--bg-soft":e.bgSoft,"--panel":e.surface,"--panel-2":e.surfaceSecondary,"--line":e.border,"--line-strong":e.borderStrong,"--text":e.text,"--fg":e.text,"--muted":e.muted,"--brand":e.accent,"--brand-2":e.accentStrong,"--ok":e.success,"--warn":e.warning,"--err":e.danger},e}function at(a){if(a&&typeof a=="object"&&a.vars)return a;let t={isDark:typeof a=="boolean"?a:!!a?.isDark,...L};return t.series=[t.accent,t.accentStrong,t.success,t.warning,t.danger,t.muted],t.vars=Object.fromEntries([["--prom-bg",t.bg],["--prom-bg-soft",t.bgSoft],["--prom-surface",t.surface],["--prom-surface-secondary",t.surfaceSecondary],["--prom-border",t.border],["--prom-border-strong",t.borderStrong],["--prom-text",t.text],["--prom-muted",t.muted],["--prom-accent",t.accent],["--prom-accent-strong",t.accentStrong],["--prom-success",t.success],["--prom-warning",t.warning],["--prom-danger",t.danger],...t.series.map((r,e)=>[`--prom-series-${e+1}`,r]),["--bg",t.bg],["--bg-soft",t.bgSoft],["--panel",t.surface],["--panel-2",t.surfaceSecondary],["--line",t.border],["--line-strong",t.borderStrong],["--text",t.text],["--fg",t.text],["--muted",t.muted],["--brand",t.accent],["--brand-2",t.accentStrong],["--ok",t.success],["--warn",t.warning],["--err",t.danger]]),t}function ot(a){let t=a?.vars&&typeof a.vars=="object"?a.vars:{};return Object.entries(t).map(([r,e])=>`${r}:${Te(e,"transparent")}`).join(";")}function Ie(a,t,r){let e=at(r),o=J({background:"transparent",primaryColor:e.surface,primaryTextColor:e.text,primaryBorderColor:e.borderStrong,lineColor:e.muted,secondaryColor:e.surfaceSecondary,secondaryTextColor:e.text,secondaryBorderColor:e.border,tertiaryColor:e.bgSoft,tertiaryTextColor:e.text,tertiaryBorderColor:e.border,textColor:e.text,mainBkg:e.surface,nodeBorder:e.borderStrong,clusterBkg:e.surfaceSecondary,clusterBorder:e.border,edgeLabelBackground:"transparent"}),n=J({text:e.text,muted:e.muted,border:e.border,series:e.series}),s=`:root{${ot(e)}color-scheme:${e.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${e.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return a==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
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
</head><body>${t}</body></html>`}function O(a){return String(a||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function J(a){return JSON.stringify(a??null).replace(/</g,"\\u003c")}function nt(a,t={}){let r=String(t.visualId||""),e=t.state&&typeof t.state=="object"?t.state:{},o=`<script>(function(){
var visualId=${J(r)},last=0,state=${J(e)}||{};
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
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,n=String(a||"");return/<head\b[^>]*>/i.test(n)?n.replace(/<head\b[^>]*>/i,s=>`${s}${o}`):`${o}${n}`}function st(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let a=()=>{let t=Ae();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(r=>{let e=String(r.getAttribute("data-visual-id")||"");if(!(!e||!r.contentWindow))try{r.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:e,theme:t},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(a,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(a,0)),window.addEventListener("message",t=>{let r=t?.data;if(!r||!String(r.type||"").startsWith("prometheus:visual-"))return;let e=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(n=>n.contentWindow===t.source);if(!e)return;let o=String(e.getAttribute("data-visual-id")||"");if(String(r.visualId||"")===o){if(r.type==="prometheus:visual-resize"){let n=Number(r.height);if(!Number.isFinite(n))return;let s=Math.min(1e4,Math.max(120,Math.ceil(n))),i=Math.ceil(e.getBoundingClientRect().height||0);if(Math.abs(i-s)<=1)return;e.style.height=`${s}px`,e.style.minHeight=`${s}px`;return}if(r.type==="prometheus:visual-state"&&r.state&&typeof r.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:o,state:r.state}}));return}r.type==="prometheus:visual-followup"&&r.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:o,prompt:String(r.prompt),title:String(r.title||"")}}))}})}function oe(a){if(!a?.getAttribute)return"";let t=a.closest?.(".visual-block"),r=String(a.getAttribute("data-visual-id")||"").trim();return r?[r,String(a.getAttribute("data-visual-version")||"1"),String(t?.getAttribute("data-vis-lang")||""),String(t?.getAttribute("data-vis-code")||"")].join("\0"):""}function K(a){if(!a?.querySelector&&!a?.matches)return"";let t=a.matches?.('iframe[data-prom-visual="true"]')?a:a.querySelector?.('iframe[data-prom-visual="true"]');return oe(t)}function it(a,t){return!a||!t||a.nodeType!==t.nodeType?!1:a.nodeType!==1?!0:String(a.tagName||"").toLowerCase()===String(t.tagName||"").toLowerCase()}function ct(a,t){let e=a.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(a.attributes||[]).forEach(o=>{e.has(o.name)||t.hasAttribute(o.name)||a.removeAttribute(o.name)}),Array.from(t.attributes||[]).forEach(o=>{e.has(o.name)||a.getAttribute(o.name)!==o.value&&a.setAttribute(o.name,o.value)})}function q(a,t,r,e=null){let o=Array.from(t||[]),n=Array.from(r||[]),s=Math.min(o.length,n.length),i=0;for(let c=0;c<s;c+=1){let h=o[c],d=n[c],p=Le(h,d);if(p){i+=p.reused;continue}let m=d.cloneNode(!0);a.replaceChild(m,h)}for(let c=s;c<n.length;c+=1)a.insertBefore(n[c].cloneNode(!0),e);for(let c=s;c<o.length;c+=1)o[c].remove();return i}function pt(a,t){return a.length===t.length&&a.every((r,e)=>r===t[e])}function ze(a,t){let r=Array.from(a.childNodes||[]),e=Array.from(t.childNodes||[]),o=r.map(K).filter(Boolean),n=e.map(K).filter(Boolean);if(o.length&&pt(o,n)){let s=0,i=0,c=0;for(let h of n){let d=r.findIndex((g,y)=>y>=s&&K(g)===h),p=e.findIndex((g,y)=>y>=i&&K(g)===h);if(d<0||p<0)return q(a,r,e);c+=q(a,r.slice(s,d),e.slice(i,p),r[d]);let m=Le(r[d],e[p]);if(!m)return q(a,r,e);c+=m.reused,s=d+1,i=p+1}return c+=q(a,r.slice(s),e.slice(i)),c}return q(a,r,e)}function Le(a,t){return it(a,t)?a.nodeType===3||a.nodeType===8?(a.nodeValue!==t.nodeValue&&(a.nodeValue=t.nodeValue),{reused:0}):a.matches?.('iframe[data-prom-visual="true"]')?oe(a)===oe(t)?{reused:1}:null:(ct(a,t),{reused:ze(a,t)}):null}function Be(a,t){return!a?.childNodes||!t?.childNodes?0:ze(a,t)}function dt(a,t){if(!a)return 0;let r=String(t||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof a.appendChild!="function")return a.innerHTML=r,0;let e=document.createElement("template");e.innerHTML=r;let o=!!a.querySelector?.('iframe[data-prom-visual="true"]'),n=!!e.content.querySelector?.('iframe[data-prom-visual="true"]');return!o&&!n?(a.innerHTML=r,0):Be(a,e.content)}function lt(a,t,r=0){let e=`${a}\0${r}\0${t}`,o=2166136261;for(let n=0;n<e.length;n+=1)o^=e.charCodeAt(n),o=Math.imul(o,16777619);return`visual_local_${(o>>>0).toString(36)}`}function je(a,t,r={}){st();let e=r.artifact&&typeof r.artifact=="object"?r.artifact:null,o=String(e?.id||r.visualId||lt(a,t,r.ordinal||0)),n=`vis_${o.replace(/[^a-z0-9_-]/gi,"_")}`,s=Ae(),i=nt(Ie(a,t,s),{visualId:o,state:e?.state||r.state||{}}),c=O(i),h=a.replace(/"/g,""),d=O(t),p=a==="chart"?240:a==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${n}-wrap" data-vis-lang="${h}" data-vis-code="${d}" data-vis-surface="inline">
  <iframe
    id="${n}"
    data-prom-visual="true"
    data-visual-id="${O(o)}"
    data-visual-version="${O(e?.version||1)}"
    srcdoc="${c}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${p}px;min-height:${p}px;border:none;display:block;background:transparent;color-scheme:${s.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function _e(a){let t=String(a||""),r=typeof window<"u"?window.DOMPurify:null;return!r||typeof r.sanitize!="function"?_(t):r.sanitize(t,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function ut(a){let t=String(a||"").trim();if(!t)return"";if(/^file:\/\//i.test(t))try{t=decodeURIComponent(t.replace(/^file:\/\/\/?/i,""))}catch{t=t.replace(/^file:\/\/\/?/i,"")}t=t.replace(/^\.\//,"");let r=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof r=="function")try{let e=r(t);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}function vt(a){let t=String(a||"").trim();return!t||t.startsWith("#")?!1:/^file:\/\//i.test(t)||/^[a-z]:[\\/]/i.test(t)?!0:!(/^[a-z][a-z0-9+.-]*:/i.test(t)||t.startsWith("/")||t.startsWith("\\"))}var mt=/\.(mp4|webm|mov|m4v)(?:$|[?#])/i;function ht(a){let t=String(a||"");return t.includes("<img")?t.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/gi,(r,e,o,n)=>{let s=o.replace(/&amp;/g,"&");if(!vt(s))return r;let i=ut(s),c=`${e}${n}`,h=c.match(/\salt="([^"]*)"/i),d=h?h[1]:"",p=O(s),m=d?`<span class="prom-inline-caption">${d}</span>`:"";return mt.test(s)?`<span class="prom-inline-figure is-video"><video class="prom-inline-media" src="${O(i)}" controls playsinline preload="metadata" data-workspace-path="${p}"></video>${m}</span>`:`<span class="prom-inline-figure"><img${c.replace(/\s(?:loading|class)="[^"]*"/gi,"")} src="${O(i)}" class="prom-inline-media" loading="lazy" decoding="async" data-workspace-path="${p}" role="button" tabindex="0">${m}</span>`}):t}function gt({src:a,name:t}){document.getElementById("prom-inline-lightbox")?.remove();let r=document.createElement("div");r.id="prom-inline-lightbox",r.className="prom-inline-lightbox",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true");let e=document.createElement("img");e.src=a,e.alt=t||"";let o=document.createElement("button");o.type="button",o.className="prom-inline-lightbox-close",o.setAttribute("aria-label","Close"),o.textContent="\xD7",r.append(e,o);let n=()=>{r.remove(),document.removeEventListener("keydown",s)},s=i=>{i.key==="Escape"&&n()};r.addEventListener("click",i=>{i.target!==e&&n()}),document.addEventListener("keydown",s),document.body.appendChild(r)}if(typeof document<"u"&&!window.__promInlineMediaWired){window.__promInlineMediaWired=!0;let a=t=>{let r=t.target?.closest?.("img.prom-inline-media");if(!r||t.type==="keydown"&&t.key!=="Enter"&&t.key!==" ")return;t.preventDefault();let e=r.getAttribute("data-workspace-path")||"",o={kind:"image",src:r.currentSrc||r.src,path:e,name:r.getAttribute("alt")||e.split(/[\\/]/).pop()||"Image"},n=window.__promOpenInlineMedia;if(typeof n=="function")try{n(o);return}catch{}gt(o)};document.addEventListener("click",a),document.addEventListener("keydown",a)}var ft=600,bt=2e5,U=new Map;function Ve(a,t={}){if(!a)return"";let r=String(a);if(r.length<=bt&&!/```(chart|svg|html|mermaid)\n/.test(r)&&!(Array.isArray(t.visualArtifacts)&&t.visualArtifacts.length)){let o=U.get(r);if(o!==void 0)return U.delete(r),U.set(r,o),o;let n=Me(r,t);return U.set(r,n),U.size>ft&&U.delete(U.keys().next().value),n}return Me(r,t)}var xt=/```video-project[ \t]*\n([\s\S]*?)```/g,wt=/```video-project[ \t]*\n[\s\S]*$/;function yt(a){let t="";try{t=String(JSON.parse(String(a||"").trim())?.projectId||"")}catch{t=(String(a||"").match(/vp_[A-Za-z0-9_-]+/)||[""])[0]}return/^vp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-vp-card" data-vp-project="${t}"></div>`:""}function Me(a,t={}){try{let r=[],e=`PROMVISUAL${Math.random().toString(36).slice(2)}X`,o=[],n=`PROMVPCARD${Math.random().toString(36).slice(2)}X`;a=String(a).replace(xt,(g,y)=>(o.push(yt(y)),`

${n}${o.length-1}END

`)).replace(wt,"");let s=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,i=0,c=Array.isArray(t.visualArtifacts)?t.visualArtifacts.filter(g=>g?.type==="visual"):[],h=String(a).replace(s,(g,y,T)=>{let B=r.length,D=y.toLowerCase(),Q=c.find(H=>Number(H.ordinal)===i&&String(H.renderer||"")===D)||null;return r.push({lang:D,code:T.trim(),partial:!1,artifact:Q,ordinal:i}),i+=1,`${e}${B}END`}),d=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,p=h.match(d);if(p){let g=r.length;r.push({lang:p[1].toLowerCase(),code:p[2],partial:!0}),h=h.slice(0,p.index)+`${e}${g}END`}let m=ht(_e(marked.parse(h,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1})));if(r.length){let g=new RegExp(`${e}(\\d+)END`,"g");m=m.replace(g,(y,T)=>{let B=r[+T];return B?B.partial?"":je(B.lang,B.code,{artifact:B.artifact,ordinal:B.ordinal}):""}),m=m.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}if(o.length){let g=new RegExp(`(?:<p>\\s*)?${n}(\\d+)END(?:\\s*<\\/p>)?`,"g");m=m.replace(g,(y,T)=>o[+T]||"")}return m}catch{return _(a)}}window.escHtml=_;window.escapeHtml=_;window.sanitizeHtml=_e;window.renderMd=Ve;Se();window.timeAgo=Xe;window.fmtPercent=Ke;window.fmtMemoryGb=Je;window.meterWidth=Ce;window.setText=Qe;window.setMeter=Ze;window.showToast=Ee;window.bgtToast=et;window.showConfirm=tt;window.log=rt;window.buildVisualSrcdoc=Ie;window.buildVisualIframe=je;window.preserveVisualIframes=Be;window.setInnerHTMLPreservingVisuals=dt;window.renderMd=Ve;export{_ as a,Et as b,Xe as c,Ke as d,Je as e,Ce as f,Qe as g,Tt as h,At as i,Ze as j,Ee as k,et as l,tt as m,rt as n,Ie as o,Be as p,dt as q,je as r,_e as s,ut as t,Ve as u};
