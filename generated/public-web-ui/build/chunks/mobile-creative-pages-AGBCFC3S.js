import{b as ce}from"./chunk-J5HXEABW.js";import{a as f}from"./chunk-35CAQ6TV.js";import{H as p,I as c,O as oe,P as ne}from"./chunk-47J67TRJ.js";import"./chunk-CCXQGMAX.js";import"./chunk-H6L7Q4PU.js";import"./chunk-7WQGWU5Y.js";import{Bb as re,C as ae,Ja as se,h as te,qb as C,sb as T,tb as ie,ub as D}from"./chunk-Y3E6FGMQ.js";import"./chunk-YMT6MSCC.js";import"./chunk-GWOZVI24.js";import"./chunk-JF4LWGNM.js";import"./chunk-R5MPOBGJ.js";import"./chunk-EPSJJCWL.js";var z={image:[{id:"xai",label:"xAI Image",provider:"xai",model:""},{id:"openai",label:"OpenAI Image",provider:"openai",model:""},{id:"hf",label:"HyperFrames",provider:"hf",model:""}],video:[{id:"xai",label:"xAI Video",provider:"xai",model:""},{id:"hf",label:"HyperFrames",provider:"hf",model:""}]},K=[{id:"chibi",title:"Chibi",hint:"Cute & stylized",prompt:"Adorable chibi-style character portrait, soft lighting, vivid colors, big expressive eyes, clean studio background, high-detail illustration."},{id:"headshot",title:"Professional Headshot",hint:"Clean & polished",prompt:"Professional studio headshot, soft natural light, neutral background, sharp focus, photorealistic, business attire, confident expression."},{id:"bg-gen",title:"Background Generator",hint:"Scenic & textures",prompt:"Cinematic background plate with rich textures, depth, no characters, balanced composition for a product hero shot."},{id:"street70s",title:"70s Street Style",hint:"Vintage mood",prompt:"1970s street fashion photograph, grainy film, warm tones, urban backdrop, golden hour, candid pose."}],ve=[{id:"flythrough",title:"Sci-Fi Flythrough",prompt:"Slow cinematic flythrough across a futuristic floating city above the clouds, fighter jets escorting the camera, golden hour, 6 seconds, smooth motion."},{id:"neon",title:"Neon Streets",prompt:"Walking POV down neon-lit night streets, rain-slicked asphalt, blade-runner palette, slow handheld motion, 4 seconds."},{id:"sunrise",title:"Mountain Sunrise",prompt:"Time-lapse sunrise over a mountain lake reflecting pink and amber clouds, drifting mist, 5 seconds."},{id:"cozy",title:"Cozy Interior",prompt:"Slow dolly through a warm cozy living room, fireplace glow, soft sunbeams through window, vintage decor, 3 seconds."}],G={image:[{id:"portrait",label:"2:3",ratio:"portrait"},{id:"square",label:"1:1",ratio:"square"},{id:"landscape",label:"3:2",ratio:"landscape"}],video:[{id:"landscape",label:"16:9",ratio:"landscape"},{id:"square",label:"1:1",ratio:"square"},{id:"portrait",label:"9:16",ratio:"portrait"}]};function he(){return window.__pmCreative||(window.__pmCreative={mode:"image",provider:"xai",aspect:"portrait",agent:!1,busy:!1,currentResult:null,gallery:{image:[],video:[]},sessionId:se+"_creative",extract:{busy:!1,requestId:"",stage:"",detail:"",stages:[]}}),window.__pmCreative}function W(i){return String(i||"").replace(/\.[a-z0-9]+$/i,"").replace(/[-_]+/g," ").slice(0,32)}async function Se(i,{navigate:k}={}){let a=he(),o=`<button class="pm-icon-btn" id="pm-creative-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${p.refresh}</button>`;i.innerHTML=`
    ${oe({title:"Creative",leftIcon:"back",onBack:()=>k?.("#mobile/more"),online:!0,extras:o,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-creative" id="pm-creative-body">
      <h1 class="pm-creative-title">Creative Studio</h1>
      <div class="pm-creative-status"><span class="pm-creative-dot"></span> Online</div>

      <div class="pm-creative-modeswitch" id="pm-creative-mode">
        <button class="${a.mode==="image"?"active":""}" data-mode="image">${p.image} <span>Image</span></button>
        <button class="${a.mode==="video"?"active":""}" data-mode="video">${p.video} <span>Video</span></button>
      </div>

      <div class="pm-creative-providers" id="pm-creative-providers"></div>

      <div class="pm-creative-actions">
        <button class="pm-creative-action" data-action="upload">${p.upload} <span>Upload</span></button>
        <button class="pm-creative-action accent" data-action="secondary">${p.layers} <span data-secondary-label>Extract Layers</span></button>
        <button class="pm-creative-action" data-action="presets">${p.preset} <span>Presets</span> ${p.chev}</button>
      </div>

      <section id="pm-creative-image-stage" class="pm-creative-section" hidden>
        <div class="pm-creative-section-head">
          <h2>Featured Templates</h2>
          <button class="pm-creative-link" data-link="templates">View all</button>
        </div>
        <div class="pm-creative-templates" id="pm-creative-templates"></div>
      </section>

      <section id="pm-vstudio" class="pm-creative-section pm-vstudio" hidden></section>

      <section id="pm-creative-video-stage" class="pm-creative-section" hidden>
        <div class="pm-creative-preview" id="pm-creative-video-preview">
          <div class="pm-creative-preview-empty">
            <div class="pm-empty-icon">${p.video}</div>
            <p>Generated video will appear here.</p>
          </div>
        </div>
        <div class="pm-creative-chiprow" id="pm-creative-video-meta" hidden>
          <span class="pm-creative-chip">${p.eye} <span data-meta-res>720p</span></span>
          <span class="pm-creative-chip">${p.clock} <span data-meta-dur>\u2014</span></span>
          <span class="pm-creative-chip ok"><span class="pm-creative-dot"></span> Timeline live</span>
        </div>
      </section>

      <section class="pm-creative-section">
        <div class="pm-creative-section-head">
          <h2 id="pm-creative-gallery-title">Discover</h2>
          <button class="pm-creative-link" data-link="gallery">View all</button>
        </div>
        <div class="pm-creative-gallery" id="pm-creative-gallery"></div>
      </section>

      <section id="pm-creative-video-bottom" class="pm-creative-section" hidden>
        <div class="pm-creative-quickrow">
          <button class="pm-creative-quick" data-quick="create-hf">
            <span class="pm-creative-quick-icon">${p.spark}</span>
            <div>
              <strong>Create HyperFrame</strong>
              <small>Generate motion with deterministic frames.</small>
            </div>
            ${p.chev}
          </button>
          <button class="pm-creative-quick" data-quick="motion-preset">
            <span class="pm-creative-quick-icon">${p.layers}</span>
            <div>
              <strong>Motion preset</strong>
              <small id="pm-creative-motion-preset-label">Sci-Fi Flythrough \xB7 View & edit preset</small>
            </div>
            ${p.chev}
          </button>
        </div>
      </section>

      <div class="pm-creative-composer" id="pm-creative-composer">
        <span class="pm-glass-lens" aria-hidden="true"></span>
        <div class="pm-creative-composer-row">
          <button class="pm-icon-btn" data-composer="add" aria-label="Attach">${p.plus}</button>
          <input type="text" class="pm-creative-input" id="pm-creative-prompt" placeholder="Type to imagine" autocomplete="off"/>
          <button class="pm-icon-btn" data-composer="voice" aria-label="Voice">${p.micSmall}</button>
          <button class="pm-creative-send" id="pm-creative-send" aria-label="Generate">${p.send}</button>
        </div>
        <div class="pm-creative-composer-meta">
          <button class="pm-creative-meta-chip" data-meta="agent"><span>${p.robot}</span> Agent <small>${a.agent?"On":"Beta"}</small></button>
          <button class="pm-creative-meta-chip accent" data-meta="kind"><span data-kind-icon>${a.mode==="video"?p.video:p.image}</span> <span data-kind-label>${a.mode==="video"?"Video":"Image"}</span></button>
          <button class="pm-creative-meta-chip" data-meta="aspect"><span>${p.monitor}</span> <span data-aspect-label>${a.aspect}</span> ${p.chev}</button>
          <button class="pm-creative-meta-chip" data-meta="outputs"><span>${p.eye}</span> View outputs ${p.chev}</button>
        </div>
      </div>
    </div>

    <div class="pm-creative-extract-modal" id="pm-creative-extract-modal" hidden>
      <div class="pm-creative-extract-card">
        <div class="pm-creative-extract-icon">${p.layers}</div>
        <h3 id="pm-extract-stage">Extracting layers</h3>
        <p id="pm-extract-detail" class="pm-card-body">Preparing layer analysis...</p>
        <div class="pm-creative-extract-bar"><div id="pm-extract-fill"></div></div>
        <ul class="pm-creative-extract-stages" id="pm-extract-stages"></ul>
        <button class="pm-btn ghost" id="pm-extract-close">Hide</button>
      </div>
    </div>
  `,ne(i,{onBack:()=>k?.("#mobile/more")});let E=i.querySelector("#pm-creative-mode"),A=i.querySelector("#pm-creative-providers"),y=i.querySelector("#pm-creative-image-stage"),S=i.querySelector("#pm-creative-video-stage"),L=i.querySelector("#pm-creative-video-bottom"),H=i.querySelector("#pm-creative-templates"),q=i.querySelector("#pm-creative-gallery"),M=i.querySelector("#pm-creative-gallery-title"),j=i.querySelector("#pm-creative-video-preview"),w=i.querySelector("#pm-creative-prompt"),_=i.querySelector("#pm-creative-send"),R=ye(i.querySelector("#pm-vstudio"),{navigate:k});function B(){A.innerHTML=z[a.mode].map(e=>`
      <button class="pm-creative-provider ${a.provider===e.id?"active":""}" data-provider="${c(e.id)}">
        ${e.id==="xai"?'<span class="pm-creative-provider-mark xai">\u{1D54F}</span>':e.id==="openai"?'<span class="pm-creative-provider-mark oai">\u25CE</span>':`<span class="pm-creative-provider-mark hf">${p.hf}</span>`}
        <span>${c(e.label)}</span>
      </button>
    `).join(""),A.querySelectorAll("[data-provider]").forEach(e=>{e.addEventListener("click",()=>{a.provider=e.getAttribute("data-provider"),B()})})}function O(){H.innerHTML=K.map(e=>`
      <button class="pm-creative-template" data-template="${c(e.id)}">
        <span class="pm-creative-template-thumb">${p.image}</span>
        <strong>${c(e.title)}</strong>
        <small>${c(e.hint)}</small>
      </button>
    `).join(""),H.querySelectorAll("[data-template]").forEach(e=>{e.addEventListener("click",()=>{let t=K.find(s=>s.id===e.getAttribute("data-template"));t&&(w.value=t.prompt,w.focus())})})}function b(){M.textContent=a.mode==="video"?"Recent renders":"Discover";let e=a.gallery[a.mode]||[];if(!e.length){q.innerHTML=`<div class="pm-creative-gallery-empty">${p[a.mode]} <span>No ${a.mode==="video"?"renders":"images"} yet \u2014 generate one below.</span></div>`;return}q.innerHTML=e.slice(0,12).map(t=>`
      <button class="pm-creative-gallery-card" data-gallery-path="${c(t.relPath)}">
        ${a.mode==="video"?`<span class="pm-creative-thumb video">
              <video src="${c(C(t.relPath))}#t=0.1" muted playsinline preload="metadata" crossorigin="use-credentials"></video>
              <span class="pm-creative-thumb-play">${p.play}</span>
            </span>`:`<span class="pm-creative-thumb" data-thumb="${c(t.relPath)}">${p.image}</span>`}
        <strong>${c(W(t.name))}</strong>
        <small>${c(t.name.split(".").pop())} \xB7 ${ce(t.mtime)}</small>
      </button>
    `).join(""),a.mode==="image"&&q.querySelectorAll("[data-thumb]").forEach(async t=>{let s=t.getAttribute("data-thumb"),u=await T(s);u&&(t.innerHTML=`<img src="${u}" alt=""/>`)}),q.querySelectorAll("[data-gallery-path]").forEach(t=>{t.addEventListener("click",()=>V(t.getAttribute("data-gallery-path")))})}async function V(e){if(e)if(a.mode==="video")await r(e);else{let t=await T(e);t&&I(t,e)}}function I(e,t){a.currentResult={kind:"image",path:t,dataUrl:e},y.scrollIntoView({behavior:"smooth",block:"start"});let s=i.querySelector("#pm-creative-image-current");s||(s=document.createElement("div"),s.id="pm-creative-image-current",s.className="pm-creative-current-image",y.prepend(s)),s.innerHTML=`
      <div class="pm-creative-current-thumb"><img src="${e}" alt=""/></div>
      <div class="pm-creative-current-meta">
        <strong>${c(W(t.split("/").pop()))}</strong>
        <small>${c(t)}</small>
        <div class="pm-creative-current-actions">
          <button class="pm-btn primary" data-current-action="extract">${p.layers} Extract Layers</button>
          <a class="pm-btn ghost" download href="${e}">${p.download} Save</a>
        </div>
      </div>
    `,s.querySelector('[data-current-action="extract"]').addEventListener("click",()=>g(t))}async function r(e){a.currentResult={kind:"video",path:e};let t=C(e);j.innerHTML=`
      <video
        id="pm-creative-video-el"
        src="${c(t)}"
        controls
        playsinline
        preload="metadata"
        crossorigin="use-credentials"
      ></video>
    `;let s=j.querySelector("#pm-creative-video-el"),u=i.querySelector("#pm-creative-video-meta");u&&(u.hidden=!1),s&&(s.addEventListener("loadedmetadata",()=>{let m=Number.isFinite(s.duration)?Math.round(s.duration):0,h=s.videoWidth||0,x=s.videoHeight||0,ue=x>=1080?"1080p":x>=720?"720p":x>=480?"480p":h&&x?`${h}x${x}`:"\u2014",Z=i.querySelector("[data-meta-dur]"),ee=i.querySelector("[data-meta-res]");Z&&(Z.textContent=m?`${m}s`:"\u2014"),ee&&(ee.textContent=ue)},{once:!0}),s.addEventListener("error",()=>{j.innerHTML=`
          <div class="pm-creative-preview-stub">
            ${p.video}
            <strong>${c(W(e.split("/").pop()))}</strong>
            <small>${c(e)}</small>
            <span class="pm-creative-preview-hint">Couldn't load this render. Tap Refresh and try again.</span>
          </div>
        `}))}function l(){let e=a.mode==="image";y.hidden=!e,S.hidden=e,L.hidden=e,R.setVisible(!e),z[a.mode].find(h=>h.id===a.provider)||(a.provider=z[a.mode][0].id),a.aspect=G[a.mode][0].id;let t=i.querySelector("[data-kind-label]"),s=i.querySelector("[data-kind-icon]");t&&(t.textContent=e?"Image":"Video"),s&&(s.innerHTML=e?p.image:p.video);let u=i.querySelector("[data-aspect-label]");u&&(u.textContent=G[a.mode][0].label);let m=i.querySelector("[data-secondary-label]");m&&(m.textContent=e?"Extract Layers":"Export"),B(),O(),b(),w.placeholder=e?"Type to imagine":"Describe the motion you want..."}function d(){let e=String(w.value||"").trim();if(!e)return"";let t=a.provider,s=G[a.mode].find(m=>m.id===a.aspect)?.ratio||"square";if(a.mode==="video")return t==="hf"?`Use HyperFrames to compose and render a short motion video. Prompt: ${e}
Aspect: ${s}. After rendering, save the MP4 under generated/videos/ and tell me the final path.`:`Use the generate_video tool with provider="xai" to create a short video.
Prompt: ${e}
Aspect ratio: ${s}. Duration: 6 seconds. Resolution: 720p. Save under generated/videos/. Reply with the final file path.`;if(t==="hf")return`Compose a HyperFrames still using web-based motion freeze-frame. Prompt: ${e}
Aspect: ${s}. Save the result PNG under generated/images/ and report the path.`;let u=/\b(transparent|no background|alpha|cutout|sprite)\b/i.test(e)?`
Set background="transparent" and output_format="png" on the tool call for real alpha transparency.`:"";return`Use the generate_image tool with provider="${t}" to create an image.
Prompt: ${e}
Aspect ratio: ${s}.${u} Save under generated/images/. Reply with the final file path.`}let n=null;async function v(){if(a.busy)return;let e=d();if(!e){f("Enter a prompt first","error"),w.focus();return}a.busy=!0,_.disabled=!0,_.classList.add("busy"),f(a.mode==="video"?"Generating video...":"Generating image...","info");let t="";n=re({message:e,sessionId:a.sessionId},{onToolResult:s=>{try{let u=String(s?.name||s?.tool||""),m=s?.extra||s?.toolResult?.extra||null;if(u==="generate_image"&&m){let h=m.generated_image?.path||m.generated_image||Array.isArray(m.generated_images)&&m.generated_images[0]?.path;h&&(t=String(h))}if(u==="generate_video"&&m){let h=m.generated_video?.path||m.generated_video||Array.isArray(m.generated_videos)&&m.generated_videos[0]?.path;h&&(t=String(h))}}catch{}},onError:s=>{f(s?.message||"Generation failed","error")},onDone:async()=>{if(a.busy=!1,_.disabled=!1,_.classList.remove("busy"),n=null,t)if(f("Saved \xB7 refreshing gallery","success"),a.mode==="image"){let s=await T(t);s&&I(s,t)}else await r(t);await F()}})}async function g(e){if(!e){f("Pick or generate an image first","error");return}if(!a.extract.busy){a.extract={busy:!0,requestId:"mob_"+Date.now(),stage:"Starting",detail:"Submitting request",stages:[]},J();try{let t=await ie({sessionId:a.sessionId,source:e,mode:"balanced",requestId:a.extract.requestId});if(t?.success){f(`Extracted ${(t.layers||[]).length} layers \xB7 scene saved`,"success");let s=t.scenePath||"";if(s){let u=i.querySelector("#pm-extract-stages");if(u){let m=document.createElement("li");m.innerHTML=`<strong>Scene saved</strong> <small>${c(s)}</small>`,u.appendChild(m)}}}else f(t?.error||"Extract failed","error")}catch(t){f(t?.message||"Extract failed","error")}finally{a.extract.busy=!1;let t=i.querySelector("#pm-extract-close");t&&(t.textContent="Done")}}}function J(){let e=i.querySelector("#pm-creative-extract-modal");e.hidden=!1,i.querySelector("#pm-extract-stage").textContent="Extracting layers",i.querySelector("#pm-extract-detail").textContent="Preparing layer analysis...",i.querySelector("#pm-extract-stages").innerHTML="",i.querySelector("#pm-extract-fill").style.width="4%",i.querySelector("#pm-extract-close").textContent="Hide"}function X(){let e=i.querySelector("#pm-creative-extract-modal");e&&(e.hidden=!0)}let pe={source_loaded:8,vision_candidates:22,text_candidates:32,proposal_merge:38,foreground_start:44,foreground_mask:56,sam_start:60,sam_masks:74,alpha_cutouts:78,vector_trace:82,inpaint_start:86,clean_plate:94,scene_assembled:96,layer_assets_saved:100},Q=e=>{if(!a.extract.busy||e?.requestId&&e.requestId!==a.extract.requestId)return;let t=String(e.stage||"progress"),s=String(e.label||t.replace(/_/g," ")),u=String(e.detail||"");i.querySelector("#pm-extract-stage").textContent=s,u&&(i.querySelector("#pm-extract-detail").textContent=u);let m=pe[t]||Math.min(95,(a.extract.stages.length+1)*10);i.querySelector("#pm-extract-fill").style.width=m+"%";let h=i.querySelector("#pm-extract-stages");if(h){a.extract.stages.push(t);let x=document.createElement("li");x.innerHTML=`<span class="pm-creative-stage-dot"></span> <strong>${c(s)}</strong>${u?` <small>${c(u)}</small>`:""}`,h.appendChild(x),h.scrollTop=h.scrollHeight}};window.wsEventBus&&window.wsEventBus.on("creative_extract_layers_progress",Q),i.querySelector("#pm-extract-close").addEventListener("click",X),i.querySelector("#pm-creative-extract-modal").addEventListener("click",e=>{e.target.id==="pm-creative-extract-modal"&&X()});async function Y(){let e=document.createElement("input");e.type="file",e.accept=a.mode==="video"?"video/*,image/*":"image/*",e.onchange=async()=>{let t=e.files?.[0];if(t){f("Uploading...","info");try{let s=await t.arrayBuffer(),u=btoa(String.fromCharCode(...new Uint8Array(s))),m=await ae({filename:t.name,base64:u,mimeType:t.type});if(m?.success&&m.path){if(f("Uploaded \xB7 ready to use","success"),a.mode==="image"&&/\.(png|jpe?g|webp|gif)$/i.test(t.name)){let h=await T(m.path);h&&I(h,m.path)}}else f(m?.error||"Upload failed","error")}catch(s){f(s?.message||"Upload failed","error")}}},e.click()}function me(){let e=G[a.mode],t=document.createElement("div");t.className="pm-creative-sheet-overlay",t.innerHTML=`
      <div class="pm-creative-sheet">
        <h3>Aspect ratio</h3>
        <div class="pm-creative-sheet-options">
          ${e.map(s=>`<button data-aspect="${c(s.id)}" class="${a.aspect===s.id?"active":""}">${c(s.label)}<small>${c(s.ratio)}</small></button>`).join("")}
        </div>
        <button class="pm-btn ghost" data-close="1">Cancel</button>
      </div>
    `,document.body.appendChild(t),t.addEventListener("click",s=>{(s.target===t||s.target.getAttribute("data-close"))&&t.remove();let u=s.target.closest("[data-aspect]");if(u){a.aspect=u.getAttribute("data-aspect");let m=i.querySelector("[data-aspect-label]"),h=e.find(x=>x.id===a.aspect);m&&h&&(m.textContent=h.label),t.remove()}})}function U(){let e=a.mode==="video"?ve:K,t=document.createElement("div");t.className="pm-creative-sheet-overlay",t.innerHTML=`
      <div class="pm-creative-sheet">
        <h3>${a.mode==="video"?"Motion presets":"Image presets"}</h3>
        <div class="pm-creative-sheet-list">
          ${e.map(s=>`<button data-preset="${c(s.id)}"><strong>${c(s.title)}</strong><small>${c(s.hint||s.prompt.slice(0,80))}</small></button>`).join("")}
        </div>
        <button class="pm-btn ghost" data-close="1">Close</button>
      </div>
    `,document.body.appendChild(t),t.addEventListener("click",s=>{(s.target===t||s.target.getAttribute("data-close"))&&t.remove();let u=s.target.closest("[data-preset]");if(u){let m=e.find(h=>h.id===u.getAttribute("data-preset"));m&&(w.value=m.prompt,w.focus()),t.remove()}})}async function F(){let[e,t]=await Promise.all([D({kind:"image"}),D({kind:"video"})]);a.gallery.image=e,a.gallery.video=t,b()}E.querySelectorAll("[data-mode]").forEach(e=>{e.addEventListener("click",()=>{a.mode=e.getAttribute("data-mode"),E.querySelectorAll("[data-mode]").forEach(t=>t.classList.toggle("active",t===e)),l()})}),i.querySelectorAll("[data-action]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-action");if(t==="upload")return Y();if(t==="presets")return U();if(t==="secondary"){if(a.mode==="image"){let u=a.currentResult?.path||a.gallery.image[0]?.relPath||"";if(!u){f("Generate or upload an image first","error");return}return g(u)}let s=a.currentResult?.path||a.gallery.video[0]?.relPath||"";if(!s){f("Generate a video first","error");return}window.open(C(s),"_blank")}})}),i.querySelectorAll("[data-meta]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-meta");if(t==="aspect")return me();t==="kind"&&(a.mode=a.mode==="image"?"video":"image",E.querySelectorAll("[data-mode]").forEach(s=>s.classList.toggle("active",s.getAttribute("data-mode")===a.mode)),l()),t==="agent"&&(a.agent=!a.agent,e.querySelector("small").textContent=a.agent?"On":"Beta"),t==="outputs"&&document.getElementById("pm-creative-gallery")?.scrollIntoView({behavior:"smooth",block:"start"})})}),i.querySelectorAll("[data-quick]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-quick");t==="create-hf"&&(a.mode="video",a.provider="hf",E.querySelectorAll("[data-mode]").forEach(s=>s.classList.toggle("active",s.getAttribute("data-mode")==="video")),l(),w.focus()),t==="motion-preset"&&U()})}),i.querySelectorAll("[data-composer]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-composer");t==="add"&&Y(),t==="voice"&&k?.("#mobile/voice")})}),i.querySelectorAll("[data-link]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-link");t==="templates"&&U(),t==="gallery"&&document.getElementById("pm-creative-gallery")?.scrollIntoView({behavior:"smooth",block:"start"})})}),_.addEventListener("click",v),w.addEventListener("keydown",e=>{e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),v())}),i.querySelector("#pm-creative-refresh").addEventListener("click",F),l(),await F(),i._pmCleanup=()=>{try{window.wsEventBus?.off("creative_extract_layers_progress",Q)}catch{}try{n?.abort?.()}catch{}try{R.dispose()}catch{}}}var le="prometheus_vp_active_project",ge="/api/video-projects",$={gen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/></svg>',check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',key:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M17 6l3 3M15 8l2 2"/></svg>',seq:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/></svg>',film:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/></svg>',export:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 002 2h10a2 2 0 002-2v-4"/></svg>',undo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>',redo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/></svg>',stop:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/></svg>'};function P(i){return`$${(Number(i)||0).toFixed(2)}`}function de(i){return/\.(mp4|webm|mov|m4v)$/i.test(String(i||""))}function N(i){return i?.takes?.length?i.takes.find(k=>k.id===i.selectedTakeId)||i.takes[i.takes.length-1]:null}function fe(i,k){if(!i)return`<div class="${k} is-empty">${$.film}</div>`;let a=c(C(i));return de(i)?`<video class="${k}" src="${a}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${k}" src="${a}" alt="" loading="lazy">`}function ye(i,{navigate:k}={}){let a={setVisible(){},dispose(){}};if(!i)return a;let o={visible:!1,loaded:!1,projects:[],project:null,history:{undo:0,redo:0},providers:{},openShot:"",busy:"",keysOpen:!1,renderPath:""},E=null,A=!1;async function y(r,l,d=3e4){let n=await te(`${ge}${r}`,{method:l===void 0?"GET":"POST",body:l===void 0?void 0:JSON.stringify(l),timeoutMs:d});if(n&&n.success===!1)throw new Error(n.error||"Request failed");return n||{}}async function S(r,l){o.busy=r,b();try{return await l()}catch(d){return f(String(d?.message||d),"error"),null}finally{o.busy="",b()}}function L(r){r?.project&&(o.project=r.project),r?.history&&(o.history=r.history)}async function H(){try{let[r,l]=await Promise.all([y(""),y("/providers")]);o.projects=r.projects||[],o.providers=l.providers||{};let d="";try{d=localStorage.getItem(le)||""}catch{}let n=o.projects.find(v=>v.id===d)?.id||o.projects[0]?.id||"";n?await q(n):o.project=null}catch(r){f(`Video projects: ${r?.message||r}`,"error")}o.loaded=!0,b()}async function q(r){if(!r){o.project=null,b();return}let l=await y(`/${encodeURIComponent(r)}`);L(l);try{localStorage.setItem(le,r)}catch{}j(),b()}async function M(){if(!(!o.project||A)){try{L(await y(`/${encodeURIComponent(o.project.id)}`)),b()}catch{}j()}}function j(){clearTimeout(E),(o.project?.jobs||[]).some(l=>l.state==="queued"||l.state==="running")&&o.visible&&!A&&(E=setTimeout(M,4e3))}async function w(r,l="Saving"){o.project&&(L(await S(l,()=>y(`/${o.project.id}/ops`,{ops:r}))),b())}async function _(r,l=1){let d=o.project?.id;if(!d)return;let n=await S("Estimating",()=>y(`/${d}/generate`,{shotIds:r,count:l},12e4));if(n){if(n.needsApproval){let v=(n.estimate?.shots||[]).map(g=>`${g.title}: ${g.count}x ${g.modelId} ~ ${P(g.usd)}`).join(`
`);if(!window.confirm(`${n.reason||"Approve this generation?"}

${v}

Total ~ ${P(n.estimate?.total)}`))return;n=await S("Submitting",()=>y(`/${d}/generate`,{shotIds:r,count:l,approved:!0},12e4))}n&&f("Generating. Takes appear here when ready.","success"),await M()}}function R(){let r={xai:"Grok",openai:"OpenAI",fal:"fal",higgsfield:"Higgsfield"};return Object.keys(r).map(l=>{let d=!!o.providers?.[l]?.configured;return`<span class="pm-vs-chip${d?" ok":""}" title="${d?"Ready":"Not configured"}"><i></i>${r[l]}</span>`}).join("")}function B(){return o.keysOpen?`<div class="pm-vs-keys">
      <label>fal API key<input type="password" autocomplete="off" data-vs-key="fal" placeholder="${o.providers?.fal?.configured?"Configured. Paste to replace":"fal.ai key"}"></label>
      <label>Higgsfield key<input type="password" autocomplete="off" data-vs-key="higgsfield" placeholder="${o.providers?.higgsfield?.configured?"Configured. Paste to replace":"id:secret"}"></label>
      <button class="pm-vs-btn primary" data-vs="save-keys">${$.check}<span>Save keys</span></button>
      <p class="pm-vs-hint">Stored encrypted in the vault. Never shown again.</p>
    </div>`:""}function O(r,l){let d=N(r),n=o.openShot===r.id,v=n?(r.takes||[]).slice().reverse().map(g=>`
      <div class="pm-vs-take${g.id===d?.id?" is-selected":""}">
        ${de(g.path)?`<video src="${c(C(g.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${c(C(g.path))}" alt="">`}
        <div class="pm-vs-take-row">
          <small>${c(g.modelId||"")} \xB7 ${P(g.costUsd)}</small>
          ${g.id===d?.id?`<span class="pm-vs-used">${$.check} In cut</span>`:`<button class="pm-vs-btn" data-vs="use-take" data-shot="${c(r.id)}" data-take="${c(g.id)}">${$.check}<span>Use</span></button>`}
        </div>
      </div>`).join(""):"";return`<div class="pm-vs-shot${n?" is-open":""}">
      <button class="pm-vs-shot-head" data-vs="toggle-shot" data-shot="${c(r.id)}">
        ${fe(d?.path,"pm-vs-thumb")}
        <div class="pm-vs-shot-meta">
          <strong>${l+1}. ${c(r.title||"Shot")}</strong>
          <small>${c(String(r.prompt||"").slice(0,90)||"No prompt yet")}</small>
          <span class="pm-vs-status is-${c(r.status)}">${c(r.status)} \xB7 ${r.durationSec}s \xB7 ${(r.takes||[]).length} take${(r.takes||[]).length===1?"":"s"}</span>
        </div>
      </button>
      ${n?`<div class="pm-vs-shot-body">
        <div class="pm-vs-row">
          <button class="pm-vs-btn primary" data-vs="gen" data-shot="${c(r.id)}" data-count="1">${$.gen}<span>Generate</span></button>
          <button class="pm-vs-btn" data-vs="gen" data-shot="${c(r.id)}" data-count="3">${$.gen}<span>3 variations</span></button>
        </div>
        <div class="pm-vs-takes">${v||'<p class="pm-vs-hint">No takes yet.</p>'}</div>
      </div>`:""}
    </div>`}function b(){if(A)return;if(!o.visible){i.hidden=!0;return}i.hidden=!1;let r=o.project,l=(r?.jobs||[]).filter(n=>n.state==="queued"||n.state==="running"),d=(r?.shots||[]).filter(n=>!N(n)).map(n=>n.id);i.innerHTML=`
      <div class="pm-creative-section-head">
        <h2>Video projects</h2>
        <button class="pm-vs-icon" data-vs="keys" aria-label="Provider keys" title="Provider keys">${$.key}</button>
      </div>
      <div class="pm-vs-chips">${R()}</div>
      ${B()}
      ${o.loaded?o.projects.length?`
        <div class="pm-vs-row">
          <select class="pm-vs-select" data-vs-project>${o.projects.map(n=>`<option value="${c(n.id)}"${n.id===r?.id?" selected":""}>${c(n.title)} \xB7 ${n.shots} shots</option>`).join("")}</select>
          <button class="pm-vs-icon" data-vs="new" aria-label="New project" title="New project">${p.plus}</button>
        </div>`:`
        <div class="pm-vs-empty">
          <p>No video projects yet. Describe a video and Prom plans the shots.</p>
          <button class="pm-vs-btn primary" data-vs="new">${$.gen}<span>New project</span></button>
        </div>`:'<p class="pm-vs-hint">Loading projects...</p>'}
      ${r?`
        <div class="pm-vs-toolbar">
          <button class="pm-vs-icon" data-vs="undo" aria-label="Undo" title="Undo"${o.history.undo?"":" disabled"}>${$.undo}</button>
          <button class="pm-vs-icon" data-vs="redo" aria-label="Redo" title="Redo"${o.history.redo?"":" disabled"}>${$.redo}</button>
          <button class="pm-vs-icon" data-vs="plan" aria-label="Plan with Prom" title="Plan with Prom">${$.chat}</button>
          <span class="pm-vs-spacer"></span>
          <span class="pm-vs-spent">${P(r.budget?.spentUsd)}${r.budget?.capUsd?` / ${P(r.budget.capUsd)}`:""}</span>
        </div>
        ${o.busy?`<p class="pm-vs-busy">${c(o.busy)}...</p>`:""}
        ${l.length?`<div class="pm-vs-jobs">${l.map(n=>`<div class="pm-vs-job"><span class="pm-vs-spin"></span><span>${c(n.modelId)} \xB7 ${c(n.state)}</span><button class="pm-vs-icon sm" data-vs="cancel-job" data-job="${c(n.id)}" aria-label="Cancel job" title="Cancel">${$.stop}</button></div>`).join("")}</div>`:""}
        <div class="pm-vs-shots">${r.shots.length?r.shots.map(O).join(""):'<p class="pm-vs-hint">No shots yet. Tap the chat icon to plan them with Prom.</p>'}</div>
        <div class="pm-vs-row wrap">
          ${d.length?`<button class="pm-vs-btn" data-vs="gen-drafts">${$.gen}<span>Generate ${d.length} draft${d.length===1?"":"s"}</span></button>`:""}
          <button class="pm-vs-btn" data-vs="assemble"${r.shots.some(N)?"":" disabled"}>${$.seq}<span>Assemble</span></button>
          <button class="pm-vs-btn primary" data-vs="render"${r.clips?.length?"":" disabled"}>${$.export}<span>Render MP4</span></button>
        </div>
        ${o.renderPath?`<video class="pm-vs-render" src="${c(C(o.renderPath))}" controls playsinline></video>`:""}
      `:""}`}async function V(r){let l=r.target.closest("[data-vs]");if(!l||l.disabled)return;let d=l.dataset.vs,n=o.project;if(d==="keys"){o.keysOpen=!o.keysOpen,b();return}if(d==="save-keys"){for(let v of i.querySelectorAll("[data-vs-key]")){let g=v.value.trim();if(!g)continue;await S("Saving key",()=>y(`/providers/${v.dataset.vsKey}/key`,{key:g}))&&f(`${v.dataset.vsKey} key saved`,"success")}try{o.providers=(await y("/providers")).providers||o.providers}catch{}o.keysOpen=!1,b();return}if(d==="new"){let v=window.prompt("Project name","New video");if(!v)return;let g=await S("Creating",()=>y("",{title:v}));g?.project&&(o.projects=(await y("")).projects||[],await q(g.project.id));return}if(d==="toggle-shot"){o.openShot=o.openShot===l.dataset.shot?"":l.dataset.shot,b();return}if(n){if(d==="plan"){let v=window.prompt("Describe the video (scenes, characters, mood):",n.brief||"");if(!v)return;try{sessionStorage.setItem("pm_mobile_prefill_chat",`Plan my video project "${n.title}" (${n.id}) with video_project: ${v} Target ${n.target?.aspect}. Build characters and a shot list with plan.setShots, show me the estimate, and wait for my approval before generating.`)}catch{}f("Brief ready. Send it in chat.","success"),k?.("#mobile/chat");return}if(d==="gen"){await _([l.dataset.shot],Number(l.dataset.count)||1);return}if(d==="gen-drafts"){await _(n.shots.filter(v=>!N(v)).map(v=>v.id),1);return}if(d==="use-take"){await w([{op:"take.select",shotId:l.dataset.shot,takeId:l.dataset.take}],"Selecting");return}if(d==="assemble"){await w([{op:"timeline.assemble"}],"Assembling"),f("Cut assembled","success");return}if(d==="undo"||d==="redo"){L(await S(d==="undo"?"Undoing":"Redoing",()=>y(`/${n.id}/${d}`,{}))),b();return}if(d==="cancel-job"){await S("Canceling",()=>y(`/${n.id}/jobs/${l.dataset.job}/cancel`,{})),await M();return}if(d==="render"){let v=await S("Rendering",()=>y(`/${n.id}/render`,{},6e5));v?.path&&(o.renderPath=v.path,f("Render ready","success")),b()}}}async function I(r){r.target.matches("[data-vs-project]")&&(o.renderPath="",o.openShot="",await S("Opening",()=>q(r.target.value)))}return i.addEventListener("click",V),i.addEventListener("change",I),{setVisible(r){o.visible=!!r,o.visible&&!o.loaded?H():(b(),j())},dispose(){A=!0,clearTimeout(E),i.removeEventListener("click",V),i.removeEventListener("change",I)}}}export{Se as renderCreativePage};
