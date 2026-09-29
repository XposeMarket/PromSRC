var A=a=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a}</svg>`,k={box:A('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),userPlus:A('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),grid:A('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),gauge:A('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),up:A('<path d="M18 15l-6-6-6 6"/>'),down:A('<path d="M6 9l6 6 6-6"/>'),minus:A('<path d="M5 12h14"/>'),plus:A('<path d="M12 5v14M5 12h14"/>'),mic:A('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),share:A('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),split:A('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),rocket:A('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),download:A('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),check:A('<path d="M5 12l5 5L20 7"/>'),x:A('<path d="M18 6L6 18M6 6l12 12"/>'),pen:A('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),film:A('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),talk:A('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><path d="M17 7a4 4 0 010 6M20 4a8 8 0 010 12"/>'),sparkle:A('<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>'),speaker:A('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>'),copies:A('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),undo:A('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>'),trash:A('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>')},te=null;function be(a){return te||(te=a.vpFetch("/action",{action:"presets"}).then(r=>r?.presets||[]).catch(()=>(te=null,[]))),te}function rt(a,r,t){let e=r.presets||[],o=a.presetId||"",s=Object.entries({camera:"Camera",vfx:"VFX",look:"Look"}).map(([c,g])=>{let d=e.filter(p=>p.group===c);return d.length?`<optgroup label="${g}">${d.map(p=>`<option value="${t.esc(p.id)}"${p.id===o?" selected":""}>${t.esc(p.label)}</option>`).join("")}</optgroup>`:""}).join(""),i=o&&!e.some(c=>c.id===o)?`<option value="${t.esc(o)}" selected>${t.esc(o)}</option>`:"";return`<select class="vpc-select" data-vpf="presetId" data-s="${t.esc(a.id)}" aria-label="Preset" title="Motion / VFX / look preset"><option value="">No preset</option>${i}${s}</select>`}function xe(a,r){let t=String(a.modelId||""),e="";return/lipsync/.test(t)?e="lipsync":/omnihuman|ai-avatar/.test(t)?e="talking":a.sourceVideo?e="recast":a.sketch?e="sketch":(r?.kind==="image"||a.kenBurns)&&(e="still"),e?` <span class="vpc-pill is-kind">${e}</span>`:""}function ye(a){return`<span class="vpc-ptools" role="toolbar" aria-label="Studio tools">
    ${a.iconBtn("draw",k.pen,"Draw to video (sketch pad)")}
    ${a.iconBtn("recast",k.film,"Recast a video (upload footage)")}
    ${a.iconBtn("talking-photo",k.talk,"Talking photo (upload portrait)")}
    ${a.iconBtn("upscale",k.sparkle,"Upscale selected takes")}
    ${a.iconBtn("foley",k.speaker,"Add foley / sound effects")}
    ${a.iconBtn("batch",k.copies,"Make ad variants (hooks + creators)")}
  </span>`}function ce(a,r="",t=""){return new Promise(e=>{let o=document.createElement("div");o.className="vpc-sketch";let n=c=>String(c).replace(/[&<>"]/g,g=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[g]);o.innerHTML=`<div class="vpc-sketch-box vpc-ask" role="dialog" aria-label="${n(a)}">
      <label class="vpc-ask-title">${n(a)}</label>
      <textarea rows="3" placeholder="${n(r)}">${n(t)}</textarea>
      <div class="vpc-sketch-bar"><span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${k.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Continue" aria-label="Continue">${k.check}</button>
      </div></div>`,document.body.appendChild(o);let s=o.querySelector("textarea");setTimeout(()=>{s.focus(),s.setSelectionRange(s.value.length,s.value.length)},30);let i=c=>{o.remove(),e(c)};s.addEventListener("keydown",c=>{c.key==="Enter"&&(c.metaKey||c.ctrlKey)&&i(s.value.trim()),c.key==="Escape"&&i("")}),o.addEventListener("click",c=>{let g=c.target.closest("button");if(!g){c.target===o&&i("");return}i(g.dataset.k==="ok"?s.value.trim():"")})})}function at(){return new Promise(a=>{let r=document.createElement("div");r.className="vpc-sketch",r.innerHTML=`<div class="vpc-sketch-box" role="dialog" aria-label="Sketch pad">
      <canvas width="720" height="720"></canvas>
      <div class="vpc-sketch-bar">
        ${[3,8,18].map((p,f)=>`<button type="button" class="vpc-icon${f===1?" is-on":""}" data-w="${p}" title="Brush ${["S","M","L"][f]}" aria-label="Brush ${["small","medium","large"][f]}"><span class="vpc-dotb" style="width:${p/2+4}px;height:${p/2+4}px"></span></button>`).join("")}
        <button type="button" class="vpc-icon" data-k="undo" title="Undo" aria-label="Undo">${k.undo}</button>
        <button type="button" class="vpc-icon" data-k="clear" title="Clear" aria-label="Clear">${k.trash}</button>
        <span style="flex:1"></span>
        <button type="button" class="vpc-icon" data-k="cancel" title="Cancel" aria-label="Cancel">${k.x}</button>
        <button type="button" class="vpc-icon is-go" data-k="ok" title="Use sketch" aria-label="Use sketch">${k.check}</button>
      </div></div>`,document.body.appendChild(r);let t=r.querySelector("canvas"),e=t.getContext("2d"),o=[],n=8,s=null,i=()=>{e.fillStyle="#fff",e.fillRect(0,0,t.width,t.height),e.strokeStyle="#111",e.lineCap="round",e.lineJoin="round";for(let p of o)e.lineWidth=p.w,e.beginPath(),p.pts.forEach(([f,h],$)=>$?e.lineTo(f,h):e.moveTo(f,h)),p.pts.length===1&&e.lineTo(p.pts[0][0]+.1,p.pts[0][1]),e.stroke()},c=p=>{let f=t.getBoundingClientRect();return[(p.clientX-f.left)*(t.width/f.width),(p.clientY-f.top)*(t.height/f.height)]};t.style.touchAction="none",t.addEventListener("pointerdown",p=>{t.setPointerCapture(p.pointerId),s={w:n,pts:[c(p)]},o.push(s),i()}),t.addEventListener("pointermove",p=>{s&&(s.pts.push(c(p)),i())});let g=()=>{s=null};t.addEventListener("pointerup",g),t.addEventListener("pointercancel",g),i();let d=p=>{r.remove(),a(p)};r.addEventListener("click",p=>{let f=p.target.closest("button");if(!f){p.target===r&&d(null);return}if(f.dataset.w){n=Number(f.dataset.w),r.querySelectorAll("[data-w]").forEach($=>$.classList.toggle("is-on",$===f));return}let h=f.dataset.k;h==="undo"?(o.pop(),i()):h==="clear"?(o.length=0,i()):h==="cancel"?d(null):h==="ok"&&d(o.length?t.toDataURL("image/png").replace(/^data:[^,]*,/,""):null)})})}var ot={openai:["alloy","ash","coral","echo","fable","nova","onyx","sage","shimmer"],xai:["ara","rex","sal","eve","leo"]},nt=["bold","pop","minimal","karaoke"],st=["9:16","1:1","16:9"];function we(a,r,t,e){let o="vpc-thumb";if(r?.poster)return`<img class="${o}" src="${e.esc(e.mediaUrl(r.poster))}" alt="" loading="lazy" decoding="async">`;if(r?.path&&e.isVideo(r.path))return`<video class="${o}" src="${e.esc(e.mediaUrl(r.path))}#t=0.1" muted playsinline preload="metadata"></video>`;if(r?.path)return e.thumb(r.path,o);if(a?.storyboard)return e.thumb(a.storyboard,o);let n=(a?.characterIds||[])[0],s=(t?.characters||[]).find(i=>i.id===n)||(t?.characters||[])[0];return e.thumb((s?.anchors||[])[0],o)}function $e(a){return a?.kind==="product"?'<span class="vpc-pill is-product">Product</span>':""}var re=null;function ke(a){return re||(re=a.vpFetch("/action",{action:"models"}).then(r=>(r?.models||[]).filter(t=>!t.kind||t.kind==="video")).catch(()=>(re=null,[]))),re}function Se(a,r,t,e,o){let n=o.esc(a.id),s=e.models||[],i=a.modelId||"",c=['<option value="">Default model</option>',...s.map(g=>`<option value="${o.esc(g.id)}"${g.id===i?" selected":""}>${o.esc(g.label||g.id)}${g.price!=null?` \xB7 ${o.esc(typeof g.price=="number"?o.usd(g.price):g.price)}`:""}</option>`)];return i&&!s.some(g=>g.id===i)&&c.push(`<option value="${o.esc(i)}" selected>${o.esc(i)}</option>`),`<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${n}">${o.esc(a.prompt||"")}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${n}" placeholder="Spoken line for this shot">${o.esc(a.line||"")}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${o.iconBtn("dur",k.minus,"Shorter",`data-s="${n}" data-d="-1" ${Number(a.durationSec)<=1?"disabled":""}`)}
        <span>${Number(a.durationSec)||0}s</span>
        ${o.iconBtn("dur",k.plus,"Longer",`data-s="${n}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${n}" aria-label="Model">${c.join("")}</select>
      ${rt(a,e,o)}
      <span class="vpc-grow"></span>
      ${o.iconBtn("move",k.up,"Move up",`data-s="${n}" data-i="${r-1}" ${r===0?"disabled":""}`)}
      ${o.iconBtn("move",k.down,"Move down",`data-s="${n}" data-i="${r+1}" ${r>=t-1?"disabled":""}`)}
      ${(a.takes||[]).length>=2?o.iconBtn("variants",k.split,"Render hook variants (one export per take)",`data-s="${n}"`):""}
    </div>
    ${a.voiceover?.path?`<audio class="vpc-audio" src="${o.esc(o.mediaUrl(a.voiceover.path))}" controls preload="none"></audio>`:""}
  </div>`}function Me(a,r){let t=a?.qa;if(!t||t.score==null)return"";let e=Number(t.score),o=e>=7?"good":e>=5?"warn":"bad",n=[`QA ${e}/10${t.verdict?` \xB7 ${t.verdict}`:""}${t.model?` \xB7 ${t.model}`:""}`,...t.issues||[]].join(`
`);return`<span class="vpc-qa is-${o}" title="${r.esc(n)}" aria-label="${r.esc(n)}">${e}</span>`}function Ce(a,r){let t=a.shots||[];if(!t.some(n=>n.storyboard||(n.storyboardCandidates||[]).length))return"";let e=t.some(n=>!n.storyboard&&(n.storyboardCandidates||[]).length);return`<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${t.map((n,s)=>{let i=r.esc(n.id),c=(n.storyboardCandidates||[]).find(p=>p!==n.storyboard),g=n.storyboard||c;if(!g)return`<div class="vpc-sb is-empty"><span class="vpc-sb-n">${s+1}</span></div>`;let d=!n.storyboard&&c?`<div class="vpc-tile-actions">
        ${r.iconBtn("sb-approve",k.check,"Approve storyboard",`data-s="${i}" data-path="${r.esc(c)}"`,"is-go")}
        ${r.iconBtn("sb-reject",k.x,"Reject storyboard",`data-s="${i}" data-path="${r.esc(c)}"`)}
      </div>`:`<span class="vpc-badge">${k.check}</span>`;return`<div class="vpc-sb${n.storyboard?" is-approved":""}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${r.esc(g)}" aria-label="View storyboard ${s+1}">${r.thumb(g,"vpc-tile-img")}</button>
      <span class="vpc-sb-n">${s+1}</span>${d}</div>`}).join("")}</div>
    ${e?`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${k.check}<span>Approve all</span></button>`:""}
  </section>`}function Ee(a,r,t){if(!(a.shots||[]).length)return"";let e=a.voice||{},o=e.provider||"openai",n=Object.entries(ot).map(([h,$])=>`<optgroup label="${h==="xai"?"xAI":"OpenAI"}">${$.map(l=>`<option value="${h}:${l}"${h===o&&l===e.voice?" selected":""}>${l}</option>`).join("")}</optgroup>`).join(""),s=a.captions||{},i=a.music||null,c=i?/chill/i.test(i.label||i.path||"")?"chill":/pulse/i.test(i.label||i.path||"")?"pulse":"custom":"none",g=(a.shots||[]).some(h=>h.line),d=Math.round((i?.volume??.3)*100),p=(a.audioMode||"voiceover")==="native";return`<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    ${`<div class="vpc-row vpc-wrap" role="radiogroup" aria-label="Who speaks the lines">
      <span class="vpc-muted">Speech</span>
      ${[["native","On camera","The creator speaks each line in the clip; captions transcribe the clip audio"],["voiceover","Narrator","TTS voiceover over dialogue-free clips; captions follow the voiceover"]].map(([h,$,l])=>`<button type="button" class="vpc-chip${(p?"native":"voiceover")===h?" is-on":""}" data-vpa="audio-mode" data-v="${h}" role="radio" aria-checked="${(p?"native":"voiceover")===h}" title="${l}">${$}</button>`).join("")}
    </div>`}
    ${p?`<div class="vpc-row vpc-wrap"><button type="button" class="vpc-btn" data-vpa="transcribe" title="Re-read what each clip says for captions">${k.mic}<span>Transcribe clips</span></button></div>`:`<div class="vpc-row vpc-wrap">
      ${k.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${e.voice?"":'<option value="" selected>Pick a voice</option>'}${n}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${g?"":'disabled title="Add voiceover lines to shots first"'}>${k.mic}<span>Voiceover</span></button>
    </div>`}
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${s.enabled?" checked":""}><span>Captions</span></label>
      ${nt.map(h=>`<button type="button" class="vpc-chip${(s.style||"bold")===h&&s.enabled?" is-on":""}" data-vpa="cap-style" data-v="${h}" aria-pressed="${(s.style||"bold")===h&&!!s.enabled}">${h}</button>`).join("")}
      ${s.cues?.length?`<span class="vpc-muted">${s.cues.length} cues</span>`:""}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[["pulse","Pulse"],["chill","Chill"],["none","None"]].map(([h,$])=>`<button type="button" class="vpc-chip${c===h?" is-on":""}" data-vpa="music" data-v="${h}" aria-pressed="${c===h}">${$}</button>`).join("")}
      ${c==="custom"?`<span class="vpc-chip is-on">${t.esc(i.label||"Custom")}</span>`:""}
      ${i?`<input class="vpc-range" type="range" min="0" max="100" value="${d}" data-vpf="volume" aria-label="Music volume" title="Music volume ${d}%">`:""}
    </div>
  </section>`}function Te(a,r,t){let e=[],o=a.lastRun;o?.steps?.length&&e.push(`<ol class="vpc-steps">${o.steps.map(s=>`<li class="is-${t.esc(s.state)}" title="${t.esc(s.note||s.state)}"><span class="vpc-dot"></span>${t.esc(s.step)}${s.note?` <small class="vpc-muted">${t.esc(String(s.note).slice(0,80))}</small>`:""}</li>`).join("")}</ol>`);let n=r.actPending||(o?.needsApproval?{action:"run",args:{},usd:o.needsApproval.usd,breakdown:o.needsApproval.breakdown}:null);if(n){let s=(n.breakdown||[]).map(i=>`<li>${t.esc(i.item)} \xB7 ${t.usd(i.usd)}</li>`).join("");e.push(`<div class="vpc-approve">
      <strong>${n.action==="storyboard"?"Storyboard":n.action==="run"?"Autopilot":t.esc(n.action)} needs approval \xB7 ${t.usd(n.usd)}</strong>
      ${s?`<ul>${s}</ul>`:""}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${k.check}<span>Approve ${t.usd(n.usd)}</span></button>
        ${t.iconBtn("act-cancel",k.x,"Cancel")}
      </div></div>`)}return(a.shots||[]).length&&e.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${r.busy?"disabled":""}>${k.rocket}<span>Run all</span></button>`),e.length?`<section class="vpc-sec"><h4>Autopilot</h4>${e.join("")}</section>`:""}function Ae(a,r,t){let e=(a.exports||[]).slice().reverse(),o=st.map(s=>`<button type="button" class="vpc-chip${r.aspects.has(s)?" is-on":""}" data-vpa="aspect" data-v="${s}" aria-pressed="${r.aspects.has(s)}">${s}</button>`).join(""),n=e.slice(0,6).map(s=>{let i=t.mediaUrl(s.path),c=[s.aspect,s.variant?`variant ${s.variant}`:"",`${Number(s.durationSec||0).toFixed(1)}s`].filter(Boolean).join(" \xB7 ");return`<div class="vpc-export">
      <video src="${t.esc(i)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${t.esc(c)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${t.esc(i)}" download="${t.esc(String(s.path).split("/").pop())}" title="Download" aria-label="Download">${k.download}</a>
        ${t.iconBtn("share",k.share,"Share",`data-path="${t.esc(s.path)}"`)}
      </div></div>`}).join("");return`<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${o}</div>
    ${n?`<div class="vpc-exports">${n}</div>`:""}</section>`}function pe(a="image/*"){return new Promise(r=>{let t=document.createElement("input");t.type="file",t.accept=a,t.style.display="none",t.addEventListener("change",()=>{let e=t.files&&t.files[0];if(t.remove(),!e)return r(null);let o=new FileReader;o.onload=()=>r({filename:e.name,dataBase64:String(o.result||"").replace(/^data:[^,]*,/,"")}),o.onerror=()=>r(null),o.readAsDataURL(e)}),document.body.appendChild(t),t.click()})}async function it(a,r){let t=r.mediaUrl(a);try{t=new URL(t,location.href).href}catch{}if(navigator.share)try{return await navigator.share({title:"Video",url:t}),"Shared"}catch{return""}try{return await navigator.clipboard.writeText(t),"Link copied"}catch{return"Copy failed"}}async function je(a,r){let{st:t,d:e,act:o,ops:n,paint:s,h:i}=r,c=t.project||{},g=d=>(c.shots||[]).find(p=>p.id===d);switch(a){case"upload-product":case"upload-character":{let d=await pe();return d&&await o("import_asset",{...d,role:a==="upload-product"?"product":"character",name:d.filename.replace(/\.[^.]+$/,"")},"Uploading"),!0}case"storyboard":return await o("storyboard",{},"Storyboarding"),!0;case"sb-approve":return await n([{op:"shot.approveStoryboard",id:e.s,path:e.path}],"Approving storyboard"),!0;case"sb-reject":return await n([{op:"shot.rejectStoryboard",id:e.s,path:e.path}],"Rejecting"),!0;case"sb-approve-all":{let d=(c.shots||[]).filter(p=>!p.storyboard&&(p.storyboardCandidates||[]).length).map(p=>({op:"shot.approveStoryboard",id:p.id,path:p.storyboardCandidates[0]}));return d.length&&await n(d,"Approving storyboard"),!0}case"dur":{let d=g(e.s);if(!d)return!0;let p=Math.max(1,Math.min(30,(Number(d.durationSec)||5)+Number(e.d)));return await n([{op:"shot.update",id:e.s,durationSec:p}],"Saving"),!0}case"move":return await n([{op:"shot.move",id:e.s,index:Number(e.i)}],"Reordering"),!0;case"variants":return await o("render_variants",{shotId:e.s},"Rendering hook variants",900*1e3),!0;case"qa":return await o("qa",{},"Scoring takes",300*1e3),!0;case"voiceover":return await o("voiceover",{},"Recording voiceover",300*1e3),!0;case"audio-mode":return await n([{op:"project.update",audioMode:e.v}],e.v==="native"?"Using on-camera dialogue":"Using a narrator"),!0;case"transcribe":return await o("transcribe",{force:!0},"Transcribing clips",3e5)&&c.captions?.enabled&&await o("captions",{style:c.captions.style},"Rebuilding captions"),!0;case"cap-style":{let d=e.v;return await o("captions",{style:d},"Building captions")&&await n([{op:"captions.set",enabled:!0,style:d}],"Saving captions"),!0}case"music":return e.v==="none"?await n([{op:"music.clear"}],"Removing music"):await o("music",{builtin:e.v},"Adding music"),!0;case"run-all":return await o("run",{},"Running autopilot",1800*1e3),!0;case"act-approve":{let d=t.actPending||(c.lastRun?.needsApproval?{action:"run",args:{}}:null);return t.actPending=null,d&&await o(d.action,{...d.args||{},approved:!0},"Submitting",1800*1e3),!0}case"act-cancel":return t.actPending=null,c.lastRun&&(c.lastRun.needsApproval=void 0),s(),!0;case"aspect":return t.aspects.has(e.v)?t.aspects.delete(e.v):t.aspects.add(e.v),s(),!0;case"draw":{let d=await at();if(!d)return!0;let p=await ce("What should this sketch become?","A cinematic scene at golden hour");return p&&await o("draw_to_video",{dataBase64:d,prompt:p},"Sketch to video",900*1e3),!0}case"recast":{let d=await pe("video/*");if(!d)return!0;let p=await o("import_asset",{...d,role:"footage"},"Uploading footage",300*1e3);if(!p?.assetPath)return!0;let f=await ce("Recast it as\u2026","New character, outfit, world or style");return f&&await o("recast",{sourcePath:p.assetPath,prompt:f,mode:"edit"},"Recasting",900*1e3),!0}case"talking-photo":{let d=await pe();if(!d)return!0;let p=await o("import_asset",{...d,role:"asset"},"Uploading portrait");if(!p?.assetPath)return!0;let f=await ce("What should they say?","Hey! You have to try this.");return f&&await o("talking_photo",{imagePath:p.assetPath,line:f},"Talking photo",900*1e3),!0}case"upscale":return await o("upscale",{},"Upscaling",900*1e3),!0;case"foley":return await o("foley",{},"Adding sound",900*1e3),!0;case"batch":return await o("batch_variants",{count:3,vary:["hook","creator"]},"Planning variants",300*1e3),!0;case"share":{let d=await it(e.path,i);return d&&(t.error="",t.busy="",t.toast=d,s()),!0}default:return!1}}async function ze(a,r){let{d:t,ops:e,value:o,checked:n,st:s}=r;switch(a){case"prompt":case"line":case"modelId":case"presetId":{let i=(s.project?.shots||[]).find(c=>c.id===t.s);if(i&&String(i[a]||"")===o)return;await e([{op:"shot.update",id:t.s,[a]:o}],"Saving");return}case"voice":{let[i,c]=String(o).split(":");c&&await e([{op:"voice.set",provider:i,voice:c}],"Setting voice");return}case"captions":{let i=s.project?.captions?.style||"bold";n&&!(s.project?.captions?.cues||[]).length&&await r.act("captions",{style:i},"Building captions"),await e([{op:"captions.set",enabled:!!n,style:i}],"Saving captions");return}case"volume":{let i=s.project?.music;i?.path&&await e([{op:"music.set",path:i.path,volume:Number(o)/100,duck:i.duck!==!1}],"Saving");return}default:}}var Ie=`
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
`;var Le="prom-vp-card-style",ct=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",_e=new Map,N=(a,r="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${r}>${a}</svg>`,j={film:N('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:N('<path d="M5 12l5 5L20 7"/>'),x:N('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:N('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:N('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:N('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:N('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:N('<path d="M7 4v16l13-8z"/>'),seq:N('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:N('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:N('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:N('<path d="M6 9l6 6 6-6"/>'),user:N('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:N('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:N('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function w(a){return String(a??"").replace(/[&<>"']/g,r=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[r])}function W(a){return`$${(Number(a)||0).toFixed(2)}`}function ae(a){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(a||""))}function de(a){return String(a||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function J(a){let r=String(a||"").trim();if(!r)return"";if(/^(https?:|data:|blob:)/i.test(r))return r;let t=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof t=="function")try{let e=t(r);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(r)}`}async function G(a,r,t=2e4){let e={method:r===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:r===void 0?void 0:JSON.stringify(r),timeoutMs:t},o=`/api/video-projects${a}`,n=window.__promVideoProjectFetch||window.api,s;if(typeof n=="function")s=await n(o,e);else{let i=await fetch(o,e);s=await i.json().catch(()=>({success:!1,error:`HTTP ${i.status}`}))}if(s&&s.success===!1)throw new Error(s.error||"Request failed");return s||{}}function Be(a){let r=a?.takes||[];return r.length?r.find(t=>t.id===a.selectedTakeId)||r[r.length-1]:null}function le(a,r="vpc-thumb"){if(!a)return`<span class="${r} is-empty">${j.film}</span>`;let t=w(J(a));return ae(a)?`<video class="${r}" src="${t}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${r}" src="${t}" alt="" loading="lazy" decoding="async">`}function q(a,r,t,e="",o=""){return`<button type="button" class="vpc-icon${o?` ${o}`:""}" data-vpa="${a}" title="${w(t)}" aria-label="${w(t)}" ${e}>${r}</button>`}function pt(a){a.dataset.vpMounted="1";let r=String(a.dataset.vpProject||""),t=_e.get(r),e={project:t?.project||null,history:t?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1,actPending:null,models:[],aspects:new Set,toast:""},o={esc:w,usd:W,isVideo:ae,mediaUrl:J,thumb:le,iconBtn:q,vpFetch:G},n=null,s=()=>a.isConnected;function i(m){m?.project&&(e.project=m.project),m?.history&&(e.history=m.history),e.project&&_e.set(r,{project:e.project,history:e.history,at:Date.now()})}async function c(){if(s()){try{i(await G(`/${encodeURIComponent(r)}`)),e.error=""}catch(m){e.error=String(m?.message||m)}await f(),_(),d()}}function g(){return(e.project?.jobs||[]).filter(m=>m.state==="queued"||m.state==="running")}function d(){clearTimeout(n),s()&&(g().length||e.rendering)&&(n=setTimeout(c,3500))}function p(){let m=new Set(g().map(u=>u.target?.shotId).filter(Boolean));return(e.project?.shots||[]).filter(u=>!(u.takes||[]).length&&!m.has(u.id))}async function f(){let m=p(),u=m.map(y=>`${y.id}:${y.modelId||""}:${y.durationSec}:${(y.characterIds||[]).join(",")}`).join("|")+`#${(e.project?.characters||[]).map(y=>(y.anchors||[]).length).join(",")}`;if(!m.length){e.estimate=null,e.estimateKey="";return}if(!(u===e.estimateKey&&e.estimate))try{e.estimate=await G(`/${encodeURIComponent(r)}/estimate`,{shotIds:m.map(y=>y.id)}),e.estimateKey=u}catch(y){e.estimate=null,e.error=String(y?.message||y)}}async function h(m,u){e.busy=m,e.error="",_();try{let y=await u();return i(y),y}catch(y){return e.error=String(y?.message||y),null}finally{e.busy="",_()}}async function $(m,u){await h(u,()=>G(`/${encodeURIComponent(r)}/ops`,{ops:m})),await c()}async function l(m,u={},y="Working",C=12e4){let v=await h(y,()=>G(`/${encodeURIComponent(r)}/action`,{action:m,...u},C));if(!v)return null;let O=v.needsApproval;if(O){let V=v.lastRun?.needsApproval;e.actPending={action:m,args:u,usd:Number(V?.usd??O?.usd??v.estimateUsd??v.totalUsd??v.estimate?.total??0),breakdown:V?.breakdown||O?.breakdown||v.breakdown||[]}}else e.actPending=null;return e.estimateKey="",await c(),v}async function b(m,u,y){let C=await h(y,()=>G(`/${encodeURIComponent(r)}${m}`,u,12e4));if(C){if(C.needsApproval){e.pending={path:m,body:{...u,approved:!0},label:y,reason:C.reason,estimate:C.estimate},_();return}e.pending=null,e.estimateKey="",await c()}}async function x(){let m=e.project;if(!m)return;let u=(m.clips||[]).some(y=>y.source&&"shotId"in y.source);if(e.rendering=!0,e.aspects.size){await l("render",{aspects:[...e.aspects]},"Rendering",900*1e3),e.rendering=!1,await c();return}if(!u&&!await h("Assembling",()=>G(`/${encodeURIComponent(r)}/ops`,{ops:[{op:"timeline.assemble"}]}))){e.rendering=!1,_();return}await h("Rendering",()=>G(`/${encodeURIComponent(r)}/render`,{},900*1e3)),e.rendering=!1,await c()}function M(m,u){let y=J(m);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:y,path:m,name:u||m.split("/").pop(),kind:ae(m)?"video":"image"});return}catch{}window.open(y,"_blank","noopener")}function z(m){let u=`${q("upload-product",k.box,"Upload product photo")}${q("upload-character",k.userPlus,"Upload character photo")}${ye(o)}`;if(!(m.characters||[]).length)return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${u}</h4></section>`;let y=g().filter(v=>v.target?.characterId),C=m.characters.map(v=>{let O=y.some(B=>B.target.characterId===v.id),V=(v.anchors||[])[0],Y=v.candidates||[],D=V?"Anchor approved":Y.length?"Pick an anchor":O?"Generating anchor":"No anchor yet",I=[V?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${w(V)}" aria-label="View anchor">${le(V,"vpc-tile-img")}</button><span class="vpc-badge">${j.check}</span></div>`:"",...Y.map(B=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${w(B)}" aria-label="View candidate">${le(B,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${q("approve-anchor",j.check,"Approve as anchor",`data-c="${w(v.id)}" data-path="${w(B)}"`,"is-go")}
            ${q("reject-anchor",j.x,"Reject",`data-c="${w(v.id)}" data-path="${w(B)}"`)}
          </div>
        </div>`),O?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${j.user}<strong>${w(v.name)}</strong>${$e(v)}</span>
          <span class="vpc-muted">${w(D)}</span>
          <span class="vpc-grow"></span>
          ${v.anchorPrompt?q("reroll",j.reroll,"Generate another anchor",`data-c="${w(v.id)}"`):""}
        </div>
        ${I?`<div class="vpc-strip">${I}</div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${u}</h4>${C}</section>`}function L(m){let u=m.shots||[];if(!u.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let y=new Set(g().map(v=>v.target?.shotId).filter(Boolean)),C=u.map((v,O)=>{let V=Be(v),Y=y.has(v.id),D=e.openShot===v.id,I=(v.takes||[]).length,B=D?(v.takes||[]).slice().reverse().map(R=>`
        <div class="vpc-take${R.id===V?.id?" is-selected":""}">
          ${ae(R.path)?`<video src="${w(J(R.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${w(J(R.path))}" alt="" loading="lazy">`}
          <div class="vpc-row">
            ${Me(R,o)}<span class="vpc-muted">${w(de(R.modelId))} \xB7 ${W(R.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${R.id===V?.id?`<span class="vpc-inuse">${j.check}In cut</span>`:q("use-take",j.check,"Use this take",`data-s="${w(v.id)}" data-t="${w(R.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${D?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${w(v.id)}" aria-expanded="${D}">
          ${Y&&!V?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':we(v,V,m,o)}
          <span class="vpc-shot-meta">
            <strong>${O+1}. ${w(v.title||"Shot")}${xe(v,V)}</strong>
            <small>${w(String(v.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${Y?"generating":w(v.status)}">${Y?"generating":w(v.status)} \xB7 ${v.durationSec}s \xB7 ${I} take${I===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${j.chevron}</span>
        </button>
        ${D?`<div class="vpc-shot-body">
          ${Se(v,O,u.length,e,o)}
          ${v.camera?`<p class="vpc-muted">Camera: ${w(v.camera)}</p>`:""}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${w(v.id)}" data-n="1" ${Y?"disabled":""}>${j.reroll}<span>${I?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${w(v.id)}" data-n="3" ${Y?"disabled":""}>${j.layers}<span>3 variations</span></button>
          </div>
          ${B?`<div class="vpc-takes">${B}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${u.length}</span></h4>${C}</section>`}function Q(m){let u=[];if(e.pending){let I=(e.pending.estimate?.shots||[]).map(B=>`<li>${w(B.title||"Item")}: ${B.count}\xD7 ${w(de(B.modelId))} \xB7 ${W(B.usd)}</li>`).join("");u.push(`<div class="vpc-approve">
        <strong>Approve ${W(e.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${w(e.pending.reason||"")}</p>
        ${I?`<ul>${I}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${j.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${j.x}<span>Cancel</span></button>
        </div>
      </div>`)}let y=p(),C=e.estimate;if(!e.pending&&y.length&&C){let I=(C.shots||[]).flatMap(R=>(R.problems||[]).map(tt=>`${R.title}: ${tt}`)),B=(m.characters||[]).some(R=>!(R.anchors||[]).length&&(R.candidates||[]).length);u.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${y.length} shot${y.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${W(C.total)}</strong></div>
        ${B?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${I.length?`<ul class="vpc-warn">${I.map(R=>`<li>${w(R)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${B?"disabled":""}>${j.spark}<span>${C.total>(m.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${W(C.total)}</span></button>
      </div>`)}let v=g();v.length&&u.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${v.length} job${v.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let O=(m.jobs||[]).filter(I=>I.state==="failed").slice(-2);O.length&&!v.length&&u.push(`<ul class="vpc-warn">${O.map(I=>`<li>${w(de(I.modelId))} failed: ${w(String(I.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let V=m.shots||[],Y=V.length&&V.every(I=>Be(I)),D=(m.exports||[]).slice(-1)[0];return(Y||D)&&u.push(`<div class="vpc-final">
        ${D?`<video src="${w(J(D.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(D.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${q("view",j.download,"Open video",`data-path="${w(D.path)}"`)}</div>`:""}
        ${Y?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${e.rendering||v.length?"disabled":""}>${e.rendering?'<span class="vpc-spin"></span>':j.play}<span>${D?"Re-render":"Render video"}</span></button>
          ${q("assemble",j.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),u.length?`<section class="vpc-sec vpc-actions">${u.join("")}</section>`:""}function _(){if(!s())return;let m=document.activeElement;if(m&&a.contains(m)&&m.matches?.("textarea[data-vpf]")&&!e.busy)return;let u=e.project;if(!u){a.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${j.film}Video project</span></div>
        <p class="vpc-muted">${e.error?w(e.error):"Loading\u2026"}</p></div>`;return}let y=u.budget||{};a.innerHTML=`<div class="vpc">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${j.film}Video project \xB7 ${w(u.target?.aspect||"")}</span>
          <strong class="vpc-title">${w(u.title||u.id)}</strong>
          <span class="vpc-muted">${W(y.spentUsd)} spent${y.capUsd!=null?` of ${W(y.capUsd)}`:""} \xB7 auto-approve under ${W(y.autoApproveUsd??1)}</span>
        </div>
        <div class="vpc-tools">
          ${q("undo",j.undo,"Undo",e.history?.undo?"":"disabled")}
          ${q("redo",j.redo,"Redo",e.history?.redo?"":"disabled")}
          ${q("storyboard",k.grid,"Generate storyboard")}
          ${q("qa",k.gauge,"QA: score selected takes")}
          ${q("refresh",j.refresh,"Refresh")}
        </div>
      </div>
      ${e.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${w(e.busy)}\u2026</div>`:""}
      ${e.error?`<p class="vpc-err">${w(e.error)}</p>`:""}
      ${e.toast?`<div class="vpc-toast">${w(e.toast)}</div>`:""}
      ${z(u)}
      ${Ce(u,o)}
      ${L(u)}
      ${Ee(u,e,o)}
      ${Q(u)}
      ${Te(u,e,o)}
      ${Ae(u,e,o)}
    </div>`}a.addEventListener("click",async m=>{let u=m.target.closest("[data-vpa]");if(!u||!a.contains(u)||u.disabled||(m.preventDefault(),m.stopPropagation(),e.busy&&u.dataset.vpa!=="toggle"&&u.dataset.vpa!=="view"))return;let y=u.dataset.vpa,C=u.dataset;switch(y){case"toggle":e.openShot=e.openShot===C.s?"":C.s,_(),e.openShot&&!e.models.length&&ke(o).then(v=>{e.models=v,v.length&&_()}),e.openShot&&!(e.presets||[]).length&&be(o).then(v=>{e.presets=v,v.length&&_()});return;case"view":C.path&&M(C.path);return;case"refresh":e.estimateKey="",await c();return;case"undo":case"redo":await h(y==="undo"?"Undoing":"Redoing",()=>G(`/${encodeURIComponent(r)}/${y}`,{})),e.estimateKey="",await c();return;case"approve-anchor":await $([{op:"character.approveAnchor",id:C.c,path:C.path}],"Approving anchor");return;case"reject-anchor":await $([{op:"character.rejectAnchor",id:C.c,path:C.path}],"Removing");return;case"reroll":await b(`/characters/${encodeURIComponent(C.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await $([{op:"take.select",shotId:C.s,takeId:C.t}],"Swapping take");return;case"redo-shot":await b("/generate",{shotIds:[C.s],count:Number(C.n)||1},"Estimating");return;case"gen-all":{let v=p().map(O=>O.id);if(!v.length)return;await b("/generate",{shotIds:v,count:1,approved:!0},"Submitting");return}case"approve-pending":{let v=e.pending;if(!v)return;e.pending=null,await b(v.path,v.body,"Submitting");return}case"cancel-pending":e.pending=null,_();return;case"assemble":await $([{op:"timeline.assemble"}],"Assembling");return;case"render":await x();return;default:e.toast="",await je(y,{st:e,d:C,act:l,ops:$,paint:_,h:o})}}),a.addEventListener("change",async m=>{let u=m.target.closest?.("[data-vpf]");!u||!a.contains(u)||e.busy||await ze(u.dataset.vpf,{st:e,d:u.dataset,ops:$,act:l,value:u.value,checked:u.checked})}),a.addEventListener("click",m=>{m.target.closest?.("[data-vpf]")&&m.stopPropagation()}),_(),t&&Date.now()-t.at<3e3?f().then(()=>{_(),d()}):c()}var ue=null,me=!1;function Re(a=document){me=!1,a.querySelectorAll?.(ct).forEach(r=>{try{pt(r)}catch(t){console.warn("[video-project-card] mount failed",t)}})}function Ve(){if(!(typeof document>"u")){if(!document.getElementById(Le)){let a=document.createElement("style");a.id=Le,a.textContent=dt+Ie,document.head.appendChild(a)}Re(),!ue&&(ue=new MutationObserver(()=>{me||(me=!0,requestAnimationFrame(()=>Re()))}),ue.observe(document.documentElement,{childList:!0,subtree:!0}))}}var dt=`
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
`;var Pe="prom-gp-card-style",lt=".prom-gp-card[data-gp-project]:not([data-gp-mounted])",Z=["design","art","audio","code","playable","published"],U=a=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a}</svg>`,T={pad:U('<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 11h.01M18 13h.01"/>'),check:U('<path d="M5 12l5 5L20 7"/>'),x:U('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:U('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:U('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),play:U('<path d="M7 4v16l13-8z"/>'),stop:U('<rect x="6" y="6" width="12" height="12" rx="2"/>'),ext:U('<path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5"/>'),copy:U('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),refresh:U('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),music:U('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),wand:U('<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>'),code:U('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),rocket:U('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>'),phone:U('<rect x="7" y="2" width="10" height="20" rx="2"/>')};function S(a){return String(a??"").replace(/[&<>"']/g,r=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[r])}function oe(a){return`$${(Number(a)||0).toFixed(2)}`}function Ne(a,r,t){let e=String(r||"").trim();if(!e)return"";let o=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof o=="function")try{let n=o(e);if(n)return String(n)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(e)}${t?`&v=${t}`:""}`}function ve(a){return`${typeof window<"u"&&typeof window.__promGatewayBase=="string"?window.__promGatewayBase.replace(/\/$/,""):""}/api/game-projects/${encodeURIComponent(a)}/play/`}async function Ue(a,r,t=3e4){let e={method:r===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:r===void 0?void 0:JSON.stringify(r),timeoutMs:t},o=`/api/game-projects${a}`,n=window.__promVideoProjectFetch||window.api,s;if(typeof n=="function")s=await n(o,e);else{let i=await fetch(o,e);s=await i.json().catch(()=>({success:!1,error:`HTTP ${i.status}`}))}if(s&&s.success===!1)throw new Error(s.error||"Request failed");return s}function P(a,r,t,e="",o=""){return`<button type="button" class="gpc-icon${o?` ${o}`:""}" data-gpa="${a}" title="${S(t)}" aria-label="${S(t)}" ${e}>${r}</button>`}function ut(a){a.dataset.gpMounted="1";let r=String(a.dataset.gpProject||""),t={project:null,error:"",busy:"",pending:null,timer:0,playing:null,portrait:!1,showPlay:!0},e=l=>l.kind!=="sfx"&&l.kind!=="music",o=()=>(t.project?.assets||[]).some(l=>l.status==="generating");async function n(){try{let l=await Ue(`/${encodeURIComponent(r)}`);t.project=l.project,t.error=""}catch(l){t.error=String(l?.message||l)}h(),s()}function s(){clearTimeout(t.timer),a.isConnected&&(o()||t.busy)&&(t.timer=setTimeout(n,3e3))}async function i(l,b={}){t.busy=l,t.error="",h();try{let x=await Ue(`/${encodeURIComponent(r)}/action`,{action:l,...b});x.needsApproval||x.blocked?t.pending={action:l,args:b,usd:x.usd,reason:x.reason,blocked:!!x.blocked,estimate:x.estimate}:t.pending=null,l==="publish"&&x.note&&(t.error=x.note)}catch(x){t.error=String(x?.message||x)}t.busy="",await n()}function c(l){let b=Z.indexOf(l.stage);return`<ol class="gpc-steps">${Z.map((x,M)=>`<li class="${M<b?"is-done":M===b?"is-cur":""}"><span class="gpc-dot"></span><span class="gpc-step-l">${x}</span></li>`).join("")}</ol>`}function g(l){let b=l.design||{},x=[["Setting",b.setting],["Controls",b.controls],["Core loop",b.coreLoop],["Win/lose",b.winLose],["Engine",b.engine]].filter(([,L])=>L).map(([L,Q])=>`<div class="gpc-kv"><span>${S(L)}</span><span>${S(Q)}</span></div>`).join(""),M=(l.questions||[]).filter(L=>L.answer),z=(l.questions||[]).filter(L=>!L.answer).length;return`<div class="gpc-sec"><h4>${T.wand} Design</h4>${l.pitch?`<p class="gpc-pitch">${S(l.pitch)}</p>`:""}${x}
      ${M.length?`<div class="gpc-answers">${M.map(L=>`<span class="gpc-chip" title="${S(L.q)}">${S(L.answer)}</span>`).join("")}</div>`:""}
      ${z?`<div class="gpc-muted">${z} design question${z>1?"s":""} still open</div>`:""}</div>`}function d(l){let b=(l.assets||[]).filter(e);if(!b.length)return`<div class="gpc-sec"><h4>${T.spark} Art</h4><div class="gpc-row"><span class="gpc-muted gpc-grow">No asset plan yet.</span>${P("plan",T.wand,"Plan assets for this genre",t.busy?"disabled":"","is-go")}</div></div>`;let x=b.filter(E=>["planned","rejected","failed"].includes(E.status)).length,M=b.map(E=>{let m=E.path?`<img src="${S(Ne(r,E.path,l.version))}" alt="${S(E.name)}" loading="lazy" class="${E.transparent?"is-alpha":""}">`:`<span class="gpc-ph">${E.status==="generating"?'<span class="gpc-spin"></span>':T.spark}</span>`,u=E.path&&E.status!=="generating";return`<div class="gpc-tile is-${S(E.status)}" title="${S(E.prompt)}">
        <div class="gpc-img">${m}</div>
        <div class="gpc-tile-foot"><span class="gpc-tname">${S(E.name)}</span><span class="gpc-badge">${S(E.status)}</span></div>
        <div class="gpc-tile-acts">
          ${P("approve",T.check,`Approve ${E.name}`,`data-asset="${S(E.id)}" ${u&&E.status!=="approved"?"":"disabled"}`,"is-go")}
          ${P("reject",T.x,`Reject ${E.name}`,`data-asset="${S(E.id)}" ${E.status==="generating"||E.status==="rejected"?"disabled":""}`)}
          ${P("reroll",T.reroll,`Reroll ${E.name} (paid)`,`data-asset="${S(E.id)}" ${E.status==="generating"?"disabled":""}`)}
        </div></div>`}).join(""),z=l.budget?.spentUsd||0,L=l.budget?.capUsd,Q=L?Math.min(100,z/L*100):0,_=t.pending;return`<div class="gpc-sec"><h4>${T.spark} Art <span class="gpc-muted">${b.filter(E=>E.status==="approved").length}/${b.length} approved</span></h4>
      <div class="gpc-grid">${M}</div>
      <div class="gpc-cost">
        <div class="gpc-row"><span class="gpc-grow gpc-muted">Spent ${oe(z)}${L?` of ${oe(L)} cap`:""} \xB7 auto-approve ${oe(l.budget?.autoApproveUsd)}</span>
        ${x?P("generate",T.spark,`Generate ${x} asset(s)`,t.busy||o()?"disabled":"","is-go"):""}</div>
        ${L?`<div class="gpc-bar"><span style="width:${Q.toFixed(1)}%"></span></div>`:""}
        ${_?`<div class="gpc-approve ${_.blocked?"is-blocked":""}"><span class="gpc-grow">${S(_.reason||"")}</span>
          ${_.blocked?"":`<button type="button" class="gpc-go" data-gpa="approve-cost">${T.check}<span>Approve &amp; generate ${oe(_.usd)}</span></button>`}
          ${P("dismiss",T.x,"Dismiss")}</div>`:""}
      </div></div>`}function p(l){let x=(l.assets||[]).filter(M=>!e(M)).map(M=>`<div class="gpc-aud">${P(t.playing===M.id?"stop":"listen",t.playing===M.id?T.stop:T.play,`${t.playing===M.id?"Stop":"Play"} ${M.name}`,`data-asset="${S(M.id)}" data-src="${S(Ne(r,M.path,l.version))}"`)}<span class="gpc-grow">${S(M.name)}</span><span class="gpc-muted">${M.durationSec?`${Number(M.durationSec).toFixed(1)}s`:""}</span></div>`).join("");return`<div class="gpc-sec"><h4>${T.music} Audio</h4>${x||'<div class="gpc-muted">No audio yet (free, generated locally).</div>'}
      <div class="gpc-row gpc-mt">${P("sfx",T.spark,"Generate sound effects (free)",t.busy?"disabled":"")}${P("music",T.music,"Generate music bed (free)",t.busy?"disabled":"")}${P("scaffold",T.code,"Write playable scaffold",t.busy?"disabled":"")}</div></div>`}function f(l){if(Z.indexOf(l.stage)<Z.indexOf("playable"))return"";let b=l.publish?.url||ve(r);return`<div class="gpc-sec"><h4>${T.pad} Play</h4>
      <div class="gpc-row gpc-mb"><span class="gpc-grow gpc-muted gpc-url">${S(b)}</span>
        ${P("orient",T.phone,t.portrait?"Landscape preview":"Portrait preview")}
        ${P("reload",T.refresh,"Reload game")}
        ${P("open",T.ext,"Open in new tab",`data-url="${S(b)}"`)}
        ${P("copy",T.copy,"Copy link",`data-url="${S(b)}"`)}
        ${P("publish",T.rocket,l.publish?.url?"Republish":"Publish",t.busy?"disabled":"","is-go")}</div>
      <div class="gpc-frame ${t.portrait?"is-portrait":""}"><iframe src="${S(ve(r))}" sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen; gamepad" loading="lazy" title="${S(l.title)}"></iframe></div>
      ${l.publish?.note?`<div class="gpc-muted gpc-mt">${S(l.publish.note)}</div>`:""}</div>`}function h(){let l=t.project;if(!l){a.innerHTML=`<div class="gpc"><div class="gpc-head"><span class="gpc-kicker">${T.pad} Game</span><span class="gpc-muted">${S(t.error||"Loading\u2026")}</span></div></div>`;return}let b=l.design||{},x=a.querySelector(".gpc-frame iframe"),M=x&&Z.indexOf(l.stage)>=Z.indexOf("playable")?x:null;if(a.innerHTML=`<div class="gpc">
      <div class="gpc-head"><div class="gpc-headtext">
        <span class="gpc-kicker">${T.pad} Game project${t.busy?` \xB7 ${S(t.busy)}\u2026`:""}</span>
        <strong class="gpc-title">${S(l.title)}</strong>
        <div class="gpc-row"><span class="gpc-chip">${S(b.genre)}</span><span class="gpc-chip">${S(b.style)}</span>${b.multiplayer?'<span class="gpc-chip">multiplayer</span>':""}</div>
      </div>${P("refresh",T.refresh,"Refresh")}</div>
      ${c(l)}
      ${t.error?`<div class="gpc-err">${S(t.error)}</div>`:""}
      ${g(l)}${d(l)}${p(l)}${f(l)}
    </div>`,M){let z=a.querySelector(".gpc-frame iframe");z&&z.replaceWith(M)}}let $=null;a.addEventListener("click",async l=>{let b=l.target.closest("[data-gpa]");if(!b||b.disabled)return;l.preventDefault();let x=b.dataset.gpa,M=b.dataset.asset;if(x==="refresh")return n();if(x==="plan")return i("plan_assets");if(x==="generate")return i("generate_assets");if(x==="approve")return i("approve_asset",{assetId:M});if(x==="reject")return i("reject_asset",{assetId:M});if(x==="reroll")return i("reroll_asset",{assetId:M});if(x==="approve-cost"&&t.pending)return i(t.pending.action,{...t.pending.args,approved:!0});if(x==="dismiss")return t.pending=null,h();if(x==="sfx")return i("sfx",{force:!0});if(x==="music")return i("music",{force:!0});if(x==="scaffold")return i("scaffold");if(x==="publish")return i("publish");if(x==="orient"){t.portrait=!t.portrait;let z=a.querySelector(".gpc-frame");z&&z.classList.toggle("is-portrait",t.portrait),b.title=t.portrait?"Landscape preview":"Portrait preview";return}if(x==="reload"){let z=a.querySelector(".gpc-frame iframe");z&&(z.src=ve(r));return}if(x==="open"){window.open(new URL(b.dataset.url,location.href).href,"_blank","noopener");return}if(x==="copy"){try{await navigator.clipboard.writeText(new URL(b.dataset.url,location.href).href),b.title="Copied"}catch{}return}if(x==="listen"||x==="stop")return $&&($.pause(),$=null),x==="stop"?(t.playing=null,h()):($=new Audio(b.dataset.src),t.playing=M,$.onended=()=>{t.playing=null,h()},$.play().catch(()=>{t.playing=null,h()}),h())}),h(),n()}var ge=null,he=!1;function Oe(){he=!1,document.querySelectorAll(lt).forEach(a=>{try{ut(a)}catch(r){console.warn("[game-project-card]",r)}})}function qe(){if(!(typeof document>"u")){if(!document.getElementById(Pe)){let a=document.createElement("style");a.id=Pe,a.textContent=mt,document.head.appendChild(a)}Oe(),!ge&&(ge=new MutationObserver(()=>{he||(he=!0,requestAnimationFrame(()=>Oe()))}),ge.observe(document.documentElement,{childList:!0,subtree:!0}))}}var mt=`
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
`;function H(a){return a?String(a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var Kt=H;function vt(a){let r=Date.now()-a;return r<6e4?"just now":r<36e5?`${Math.floor(r/6e4)}m ago`:r<864e5?`${Math.floor(r/36e5)}h ago`:`${Math.floor(r/864e5)}d ago`}function gt(a,r=0){let t=Number(a);return Number.isFinite(t)?`${t.toFixed(r)}%`:"--%"}function ht(a,r){let t=Number(a),e=Number(r);return!Number.isFinite(t)||!Number.isFinite(e)||e<=0?"-- / -- GB":`${t.toFixed(1)} / ${e.toFixed(1)} GB`}function De(a){let r=Number(a);return Number.isFinite(r)?`${Math.max(0,Math.min(100,r))}%`:"0%"}function ft(a,r){let t=document.getElementById(a);t&&(t.textContent=String(r||""))}function Jt(a){let r=String(a||"").trim(),t=H(r);return`<span class="t-think-sizer" aria-hidden="true">${t}</span><span class="t-think-text" data-text="${t}">${t}</span>`}function Zt(a,r){let t=String(r||"").trim(),e=a?.querySelector?.(".t-think-text");if(!e||!t)return!1;let o=String(e.textContent||"").trim();if(!o||o===t)return!1;a.querySelectorAll?.(".t-think-text").forEach(c=>{c!==e&&c.remove()});let n=e.cloneNode(!0);n.classList.remove("is-enter-start"),n.classList.add("is-exit"),n.textContent=t,n.setAttribute("data-text",t),e.classList.remove("is-exit"),e.classList.add("is-enter-start");let s=a.querySelector?.(".t-think-sizer");s&&t.length>String(s.textContent||"").length&&(s.textContent=t),a.appendChild(n),e.offsetWidth;let i=()=>{e.isConnected!==!1&&e.classList.remove("is-enter-start")};return typeof requestAnimationFrame=="function"?requestAnimationFrame(i):typeof setTimeout=="function"&&setTimeout(i,0),typeof setTimeout=="function"&&setTimeout(()=>{n.isConnected!==!1&&n.remove(),e.isConnected!==!1&&e.classList.remove("is-enter-start")},420),!0}function bt(a,r){let t=document.getElementById(a);t&&(t.style.width=De(r))}function He(a,r,t="info",e=5e3,o={}){let n=typeof o?.key=="string"?o.key.trim():"";if(n)for(let f of document.querySelectorAll(".__sc-toast"))f.dataset.scToastKey===n&&f.remove();let s=t==="warn"?"warning":["info","success","error","warning"].includes(t)?t:"info",i={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},c=document.createElement("div"),d=24+[...document.querySelectorAll(".__sc-toast")].reduce((f,h)=>f+h.offsetHeight+8,0);if(c.className=`__sc-toast __sc-toast--${s}`,n&&(c.dataset.scToastKey=n),c.style.cssText=`position:fixed;bottom:${d}px;right:24px;z-index:99999;`,c.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${i[s]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${H(a)}</div>
      ${r?`<div class="__sc-toast-body">${H(String(r))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let f=document.createElement("style");f.id="__sc-toast-style",f.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(f)}document.body.appendChild(c);let p=Math.max(0,Math.min(5e3,Number.isFinite(Number(e))?Number(e):5e3));setTimeout(()=>{c.style.transition="opacity 0.3s",c.style.opacity="0",setTimeout(()=>c.remove(),300)},p),c.querySelector(".__sc-toast-close")?.addEventListener("click",()=>c.remove())}function xt(a,r){He(a,r,"info")}function yt(a,r,t,e={}){let{title:o="Confirm",confirmText:n="Confirm",cancelText:s="Cancel",danger:i=!1,details:c=""}=e,g=document.createElement("div");g.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let d=document.createElement("div");d.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",d.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${H(o)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${H(a)}</div>
    ${c?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${H(c)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${H(s)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${i?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${H(n)}</button>
    </div>
  `,g.appendChild(d),document.body.appendChild(g);let p=()=>g.remove();d.querySelector("#__sc-confirm-cancel").onclick=()=>{p(),t&&t()},d.querySelector("#__sc-confirm-ok").onclick=()=>{p(),r&&r()},g.addEventListener("click",f=>{f.target===g&&(p(),t&&t())})}var ne=[];function wt(a,r="log"){let t=new Date().toLocaleTimeString();ne.push({text:`[${t}] ${String(a??"")}`,type:String(r||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),ne.length>100&&ne.shift();let e=document.getElementById("log-panel");e&&(e.replaceChildren(...ne.map(o=>{let n=document.createElement("div");return n.className=`log-line ${o.type}`,n.textContent=o.text,n})),e.scrollTop=e.scrollHeight)}var F=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function Ye(a,r){return String(a||"").replace(/[<>{};\r\n]/g,"").trim()||r}function We(){let a=document.documentElement,r=typeof getComputedStyle=="function"?getComputedStyle(a):null,t=(o,n)=>{for(let s of o){let i=r?.getPropertyValue(s)?.trim();if(i)return Ye(i,n)}return n},e={isDark:a.getAttribute("data-theme")==="dark",bg:t(["--bg","--pm-chat-page-bg"],F.bg),bgSoft:t(["--bg-soft"],F.bgSoft),surface:t(["--panel","--composer-panel"],F.surface),surfaceSecondary:t(["--panel-2","--composer-bg"],F.surfaceSecondary),border:t(["--line","--composer-border"],F.border),borderStrong:t(["--line-strong"],F.borderStrong),text:t(["--text","--fg","--composer-text"],F.text),muted:t(["--muted","--composer-muted"],F.muted),accent:t(["--brand","--pm-custom-accent"],F.accent),accentStrong:t(["--brand-2"],F.accentStrong),success:t(["--ok"],F.success),warning:t(["--warn"],F.warning),danger:t(["--err"],F.danger)};return e.series=[e.accent,e.accentStrong,e.success,e.warning,e.danger,e.muted],e.vars={"--prom-bg":e.bg,"--prom-bg-soft":e.bgSoft,"--prom-surface":e.surface,"--prom-surface-secondary":e.surfaceSecondary,"--prom-border":e.border,"--prom-border-strong":e.borderStrong,"--prom-text":e.text,"--prom-muted":e.muted,"--prom-accent":e.accent,"--prom-accent-strong":e.accentStrong,"--prom-success":e.success,"--prom-warning":e.warning,"--prom-danger":e.danger,"--prom-series-1":e.series[0],"--prom-series-2":e.series[1],"--prom-series-3":e.series[2],"--prom-series-4":e.series[3],"--prom-series-5":e.series[4],"--prom-series-6":e.series[5],"--bg":e.bg,"--bg-soft":e.bgSoft,"--panel":e.surface,"--panel-2":e.surfaceSecondary,"--line":e.border,"--line-strong":e.borderStrong,"--text":e.text,"--fg":e.text,"--muted":e.muted,"--brand":e.accent,"--brand-2":e.accentStrong,"--ok":e.success,"--warn":e.warning,"--err":e.danger},e}function $t(a){if(a&&typeof a=="object"&&a.vars)return a;let r={isDark:typeof a=="boolean"?a:!!a?.isDark,...F};return r.series=[r.accent,r.accentStrong,r.success,r.warning,r.danger,r.muted],r.vars=Object.fromEntries([["--prom-bg",r.bg],["--prom-bg-soft",r.bgSoft],["--prom-surface",r.surface],["--prom-surface-secondary",r.surfaceSecondary],["--prom-border",r.border],["--prom-border-strong",r.borderStrong],["--prom-text",r.text],["--prom-muted",r.muted],["--prom-accent",r.accent],["--prom-accent-strong",r.accentStrong],["--prom-success",r.success],["--prom-warning",r.warning],["--prom-danger",r.danger],...r.series.map((t,e)=>[`--prom-series-${e+1}`,t]),["--bg",r.bg],["--bg-soft",r.bgSoft],["--panel",r.surface],["--panel-2",r.surfaceSecondary],["--line",r.border],["--line-strong",r.borderStrong],["--text",r.text],["--fg",r.text],["--muted",r.muted],["--brand",r.accent],["--brand-2",r.accentStrong],["--ok",r.success],["--warn",r.warning],["--err",r.danger]]),r}function kt(a){let r=a?.vars&&typeof a.vars=="object"?a.vars:{};return Object.entries(r).map(([t,e])=>`${t}:${Ye(e,"transparent")}`).join(";")}function Ge(a,r,t){let e=$t(t),o=ie({background:"transparent",primaryColor:e.surface,primaryTextColor:e.text,primaryBorderColor:e.borderStrong,lineColor:e.muted,secondaryColor:e.surfaceSecondary,secondaryTextColor:e.text,secondaryBorderColor:e.border,tertiaryColor:e.bgSoft,tertiaryTextColor:e.text,tertiaryBorderColor:e.border,textColor:e.text,mainBkg:e.surface,nodeBorder:e.borderStrong,clusterBkg:e.surfaceSecondary,clusterBorder:e.border,edgeLabelBackground:"transparent"}),n=ie({text:e.text,muted:e.muted,border:e.border,series:e.series}),s=`:root{${kt(e)}color-scheme:${e.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${e.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return a==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${s}body{display:flex;align-items:center;justify-content:center;min-height:220px;padding:8px}canvas{width:100%!important;max-width:100%;max-height:100%}</style>
</head><body><canvas id="c"></canvas>
<script>try{const visualTheme=${n};Chart.defaults.color=visualTheme.text;Chart.defaults.borderColor=visualTheme.border;const cfg=(${r});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};const datasets=cfg.data&&Array.isArray(cfg.data.datasets)?cfg.data.datasets:[];datasets.forEach((dataset,index)=>{const color=visualTheme.series[index%visualTheme.series.length];if(!dataset.backgroundColor)dataset.backgroundColor=color;if(!dataset.borderColor)dataset.borderColor=color;});const chart=new Chart(document.getElementById('c'),cfg);window.addEventListener('prometheus:visual-theme-change',(event)=>{const next=event.detail||{};if(next.text)Chart.defaults.color=next.text;if(next.border)Chart.defaults.borderColor=next.border;chart.update('none');});}catch(e){document.body.innerHTML='<pre style="color:var(--prom-danger);padding:8px;font-size:11px;white-space:pre-wrap">'+e.message+'<\\/pre>';}<\/script>
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
    <div class="sv-stage" id="sv-stage">${r}</div>
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
      <div class="mermaid" id="mm-graph">${r.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
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
</head><body>${r}</body></html>`}function K(a){return String(a||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function ie(a){return JSON.stringify(a??null).replace(/</g,"\\u003c")}function St(a,r={}){let t=String(r.visualId||""),e=r.state&&typeof r.state=="object"?r.state:{},o=`<script>(function(){
var visualId=${ie(t)},last=0,state=${ie(e)}||{};
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
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,n=String(a||"");return/<head\b[^>]*>/i.test(n)?n.replace(/<head\b[^>]*>/i,s=>`${s}${o}`):`${o}${n}`}function Mt(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let a=()=>{let r=We();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(t=>{let e=String(t.getAttribute("data-visual-id")||"");if(!(!e||!t.contentWindow))try{t.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:e,theme:r},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(a,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(a,0)),window.addEventListener("message",r=>{let t=r?.data;if(!t||!String(t.type||"").startsWith("prometheus:visual-"))return;let e=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(n=>n.contentWindow===r.source);if(!e)return;let o=String(e.getAttribute("data-visual-id")||"");if(String(t.visualId||"")===o){if(t.type==="prometheus:visual-resize"){let n=Number(t.height);if(!Number.isFinite(n))return;let s=Math.min(1e4,Math.max(120,Math.ceil(n))),i=Math.ceil(e.getBoundingClientRect().height||0);if(Math.abs(i-s)<=1)return;e.style.height=`${s}px`,e.style.minHeight=`${s}px`;return}if(t.type==="prometheus:visual-state"&&t.state&&typeof t.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:o,state:t.state}}));return}t.type==="prometheus:visual-followup"&&t.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:o,prompt:String(t.prompt),title:String(t.title||"")}}))}})}function fe(a){if(!a?.getAttribute)return"";let r=a.closest?.(".visual-block"),t=String(a.getAttribute("data-visual-id")||"").trim();return t?[t,String(a.getAttribute("data-visual-version")||"1"),String(r?.getAttribute("data-vis-lang")||""),String(r?.getAttribute("data-vis-code")||"")].join("\0"):""}function se(a){if(!a?.querySelector&&!a?.matches)return"";let r=a.matches?.('iframe[data-prom-visual="true"]')?a:a.querySelector?.('iframe[data-prom-visual="true"]');return fe(r)}function Ct(a,r){return!a||!r||a.nodeType!==r.nodeType?!1:a.nodeType!==1?!0:String(a.tagName||"").toLowerCase()===String(r.tagName||"").toLowerCase()}function Et(a,r){let e=a.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(a.attributes||[]).forEach(o=>{e.has(o.name)||r.hasAttribute(o.name)||a.removeAttribute(o.name)}),Array.from(r.attributes||[]).forEach(o=>{e.has(o.name)||a.getAttribute(o.name)!==o.value&&a.setAttribute(o.name,o.value)})}function ee(a,r,t,e=null){let o=Array.from(r||[]),n=Array.from(t||[]),s=Math.min(o.length,n.length),i=0;for(let c=0;c<s;c+=1){let g=o[c],d=n[c],p=Ke(g,d);if(p){i+=p.reused;continue}let f=d.cloneNode(!0);a.replaceChild(f,g)}for(let c=s;c<n.length;c+=1)a.insertBefore(n[c].cloneNode(!0),e);for(let c=s;c<o.length;c+=1)o[c].remove();return i}function Tt(a,r){return a.length===r.length&&a.every((t,e)=>t===r[e])}function Xe(a,r){let t=Array.from(a.childNodes||[]),e=Array.from(r.childNodes||[]),o=t.map(se).filter(Boolean),n=e.map(se).filter(Boolean);if(o.length&&Tt(o,n)){let s=0,i=0,c=0;for(let g of n){let d=t.findIndex((h,$)=>$>=s&&se(h)===g),p=e.findIndex((h,$)=>$>=i&&se(h)===g);if(d<0||p<0)return ee(a,t,e);c+=ee(a,t.slice(s,d),e.slice(i,p),t[d]);let f=Ke(t[d],e[p]);if(!f)return ee(a,t,e);c+=f.reused,s=d+1,i=p+1}return c+=ee(a,t.slice(s),e.slice(i)),c}return ee(a,t,e)}function Ke(a,r){return Ct(a,r)?a.nodeType===3||a.nodeType===8?(a.nodeValue!==r.nodeValue&&(a.nodeValue=r.nodeValue),{reused:0}):a.matches?.('iframe[data-prom-visual="true"]')?fe(a)===fe(r)?{reused:1}:null:(Et(a,r),{reused:Xe(a,r)}):null}function Je(a,r){return!a?.childNodes||!r?.childNodes?0:Xe(a,r)}function At(a,r){if(!a)return 0;let t=String(r||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof a.appendChild!="function")return a.innerHTML=t,0;let e=document.createElement("template");e.innerHTML=t;let o=!!a.querySelector?.('iframe[data-prom-visual="true"]'),n=!!e.content.querySelector?.('iframe[data-prom-visual="true"]');return!o&&!n?(a.innerHTML=t,0):Je(a,e.content)}function jt(a,r,t=0){let e=`${a}\0${t}\0${r}`,o=2166136261;for(let n=0;n<e.length;n+=1)o^=e.charCodeAt(n),o=Math.imul(o,16777619);return`visual_local_${(o>>>0).toString(36)}`}function Ze(a,r,t={}){Mt();let e=t.artifact&&typeof t.artifact=="object"?t.artifact:null,o=String(e?.id||t.visualId||jt(a,r,t.ordinal||0)),n=`vis_${o.replace(/[^a-z0-9_-]/gi,"_")}`,s=We(),i=St(Ge(a,r,s),{visualId:o,state:e?.state||t.state||{}}),c=K(i),g=a.replace(/"/g,""),d=K(r),p=a==="chart"?240:a==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${n}-wrap" data-vis-lang="${g}" data-vis-code="${d}" data-vis-surface="inline">
  <iframe
    id="${n}"
    data-prom-visual="true"
    data-visual-id="${K(o)}"
    data-visual-version="${K(e?.version||1)}"
    srcdoc="${c}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${p}px;min-height:${p}px;border:none;display:block;background:transparent;color-scheme:${s.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function Qe(a){let r=String(a||""),t=typeof window<"u"?window.DOMPurify:null;return!t||typeof t.sanitize!="function"?H(r):t.sanitize(r,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function zt(a){let r=String(a||"").trim();if(!r)return"";if(/^file:\/\//i.test(r))try{r=decodeURIComponent(r.replace(/^file:\/\/\/?/i,""))}catch{r=r.replace(/^file:\/\/\/?/i,"")}r=r.replace(/^\.\//,"");let t=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof t=="function")try{let e=t(r);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(r)}`}function It(a){let r=String(a||"").trim();return!r||r.startsWith("#")?!1:/^file:\/\//i.test(r)||/^[a-z]:[\\/]/i.test(r)?!0:!(/^[a-z][a-z0-9+.-]*:/i.test(r)||r.startsWith("/")||r.startsWith("\\"))}var Lt=/\.(mp4|webm|mov|m4v)(?:$|[?#])/i;function _t(a){let r=String(a||"");return r.includes("<img")?r.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/gi,(t,e,o,n)=>{let s=o.replace(/&amp;/g,"&");if(!It(s))return t;let i=zt(s),c=`${e}${n}`,g=c.match(/\salt="([^"]*)"/i),d=g?g[1]:"",p=K(s),f=d?`<span class="prom-inline-caption">${d}</span>`:"";return Lt.test(s)?`<span class="prom-inline-figure is-video"><video class="prom-inline-media" src="${K(i)}" controls playsinline preload="metadata" data-workspace-path="${p}"></video>${f}</span>`:`<span class="prom-inline-figure"><img${c.replace(/\s(?:loading|class)="[^"]*"/gi,"")} src="${K(i)}" class="prom-inline-media" loading="lazy" decoding="async" data-workspace-path="${p}" role="button" tabindex="0">${f}</span>`}):r}function Bt({src:a,name:r}){document.getElementById("prom-inline-lightbox")?.remove();let t=document.createElement("div");t.id="prom-inline-lightbox",t.className="prom-inline-lightbox",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true");let e=document.createElement("img");e.src=a,e.alt=r||"";let o=document.createElement("button");o.type="button",o.className="prom-inline-lightbox-close",o.setAttribute("aria-label","Close"),o.textContent="\xD7",t.append(e,o);let n=()=>{t.remove(),document.removeEventListener("keydown",s)},s=i=>{i.key==="Escape"&&n()};t.addEventListener("click",i=>{i.target!==e&&n()}),document.addEventListener("keydown",s),document.body.appendChild(t)}if(typeof document<"u"&&!window.__promInlineMediaWired){window.__promInlineMediaWired=!0;let a=r=>{let t=r.target?.closest?.("img.prom-inline-media");if(!t||r.type==="keydown"&&r.key!=="Enter"&&r.key!==" ")return;r.preventDefault();let e=t.getAttribute("data-workspace-path")||"",o={kind:"image",src:t.currentSrc||t.src,path:e,name:t.getAttribute("alt")||e.split(/[\\/]/).pop()||"Image"},n=window.__promOpenInlineMedia;if(typeof n=="function")try{n(o);return}catch{}Bt(o)};document.addEventListener("click",a),document.addEventListener("keydown",a)}var Rt=600,Vt=2e5,X=new Map;function et(a,r={}){if(!a)return"";let t=String(a);if(t.length<=Vt&&!/```(chart|svg|html|mermaid)\n/.test(t)&&!(Array.isArray(r.visualArtifacts)&&r.visualArtifacts.length)){let o=X.get(t);if(o!==void 0)return X.delete(t),X.set(t,o),o;let n=Fe(t,r);return X.set(t,n),X.size>Rt&&X.delete(X.keys().next().value),n}return Fe(t,r)}var Pt=/```video-project[ \t]*\n([\s\S]*?)```/g,Nt=/```video-project[ \t]*\n[\s\S]*$/;function Ut(a){let r="";try{r=String(JSON.parse(String(a||"").trim())?.projectId||"")}catch{r=(String(a||"").match(/vp_[A-Za-z0-9_-]+/)||[""])[0]}return/^vp_[A-Za-z0-9_-]{3,64}$/.test(r)?`<div class="prom-vp-card" data-vp-project="${r}"></div>`:""}var Ot=/```game-project[ \t]*\n([\s\S]*?)```/g,qt=/```game-project[ \t]*\n[\s\S]*$/;function Ft(a){let r="";try{r=String(JSON.parse(String(a||"").trim())?.projectId||"")}catch{r=(String(a||"").match(/gp_[A-Za-z0-9_-]+/)||[""])[0]}return/^gp_[A-Za-z0-9_-]{3,64}$/.test(r)?`<div class="prom-gp-card" data-gp-project="${r}"></div>`:""}function Fe(a,r={}){try{let t=[],e=`PROMVISUAL${Math.random().toString(36).slice(2)}X`,o=[],n=`PROMVPCARD${Math.random().toString(36).slice(2)}X`;a=String(a).replace(Pt,(h,$)=>(o.push(Ut($)),`

${n}${o.length-1}END

`)).replace(Nt,"").replace(Ot,(h,$)=>(o.push(Ft($)),`

${n}${o.length-1}END

`)).replace(qt,"");let s=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,i=0,c=Array.isArray(r.visualArtifacts)?r.visualArtifacts.filter(h=>h?.type==="visual"):[],g=String(a).replace(s,(h,$,l)=>{let b=t.length,x=$.toLowerCase(),M=c.find(z=>Number(z.ordinal)===i&&String(z.renderer||"")===x)||null;return t.push({lang:x,code:l.trim(),partial:!1,artifact:M,ordinal:i}),i+=1,`${e}${b}END`}),d=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,p=g.match(d);if(p){let h=t.length;t.push({lang:p[1].toLowerCase(),code:p[2],partial:!0}),g=g.slice(0,p.index)+`${e}${h}END`}let f=_t(Qe(marked.parse(g,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1})));if(t.length){let h=new RegExp(`${e}(\\d+)END`,"g");f=f.replace(h,($,l)=>{let b=t[+l];return b?b.partial?"":Ze(b.lang,b.code,{artifact:b.artifact,ordinal:b.ordinal}):""}),f=f.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}if(o.length){let h=new RegExp(`(?:<p>\\s*)?${n}(\\d+)END(?:\\s*<\\/p>)?`,"g");f=f.replace(h,($,l)=>o[+l]||"")}return f}catch{return H(a)}}window.escHtml=H;window.escapeHtml=H;window.sanitizeHtml=Qe;window.renderMd=et;Ve();qe();window.timeAgo=vt;window.fmtPercent=gt;window.fmtMemoryGb=ht;window.meterWidth=De;window.setText=ft;window.setMeter=bt;window.showToast=He;window.bgtToast=xt;window.showConfirm=yt;window.log=wt;window.buildVisualSrcdoc=Ge;window.buildVisualIframe=Ze;window.preserveVisualIframes=Je;window.setInnerHTMLPreservingVisuals=At;window.renderMd=et;export{H as a,Kt as b,vt as c,gt as d,ht as e,De as f,ft as g,Jt as h,Zt as i,bt as j,He as k,xt as l,yt as m,wt as n,Ge as o,Je as p,At as q,Ze as r,Qe as s,zt as t,et as u};
