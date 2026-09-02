import{b as K}from"./chunk-J5HXEABW.js";import{a as d}from"./chunk-35CAQ6TV.js";import{F as s,G as c,M as z,N as W}from"./chunk-6J45O5GT.js";import"./chunk-5RLMNBA7.js";import"./chunk-IX6O476V.js";import"./chunk-Z5F7FVLI.js";import{Ab as j,C as N,Ja as O,pb as y,rb as v,sb as U,tb as q}from"./chunk-4MLV3F4Z.js";import"./chunk-YMT6MSCC.js";import"./chunk-R2RZ2V66.js";import"./chunk-JF4LWGNM.js";import"./chunk-CP4XDM65.js";import"./chunk-EPSJJCWL.js";var _={image:[{id:"xai",label:"xAI Image",provider:"xai",model:""},{id:"openai",label:"OpenAI Image",provider:"openai",model:""},{id:"hf",label:"HyperFrames",provider:"hf",model:""}],video:[{id:"xai",label:"xAI Video",provider:"xai",model:""},{id:"hf",label:"HyperFrames",provider:"hf",model:""}]},A=[{id:"chibi",title:"Chibi",hint:"Cute & stylized",prompt:"Adorable chibi-style character portrait, soft lighting, vivid colors, big expressive eyes, clean studio background, high-detail illustration."},{id:"headshot",title:"Professional Headshot",hint:"Clean & polished",prompt:"Professional studio headshot, soft natural light, neutral background, sharp focus, photorealistic, business attire, confident expression."},{id:"bg-gen",title:"Background Generator",hint:"Scenic & textures",prompt:"Cinematic background plate with rich textures, depth, no characters, balanced composition for a product hero shot."},{id:"street70s",title:"70s Street Style",hint:"Vintage mood",prompt:"1970s street fashion photograph, grainy film, warm tones, urban backdrop, golden hour, candid pose."}],ne=[{id:"flythrough",title:"Sci-Fi Flythrough",prompt:"Slow cinematic flythrough across a futuristic floating city above the clouds, fighter jets escorting the camera, golden hour, 6 seconds, smooth motion."},{id:"neon",title:"Neon Streets",prompt:"Walking POV down neon-lit night streets, rain-slicked asphalt, blade-runner palette, slow handheld motion, 4 seconds."},{id:"sunrise",title:"Mountain Sunrise",prompt:"Time-lapse sunrise over a mountain lake reflecting pink and amber clouds, drifting mist, 5 seconds."},{id:"cozy",title:"Cozy Interior",prompt:"Slow dolly through a warm cozy living room, fireplace glow, soft sunbeams through window, vintage decor, 3 seconds."}],b={image:[{id:"portrait",label:"2:3",ratio:"portrait"},{id:"square",label:"1:1",ratio:"square"},{id:"landscape",label:"3:2",ratio:"landscape"}],video:[{id:"landscape",label:"16:9",ratio:"landscape"},{id:"square",label:"1:1",ratio:"square"},{id:"portrait",label:"9:16",ratio:"portrait"}]};function ce(){return window.__pmCreative||(window.__pmCreative={mode:"image",provider:"xai",aspect:"portrait",agent:!1,busy:!1,currentResult:null,gallery:{image:[],video:[]},sessionId:O+"_creative",extract:{busy:!1,requestId:"",stage:"",detail:"",stages:[]}}),window.__pmCreative}function L(i){return String(i||"").replace(/\.[a-z0-9]+$/i,"").replace(/[-_]+/g," ").slice(0,32)}async function ue(i,{navigate:X}={}){let r=ce(),J=`<button class="pm-icon-btn" id="pm-creative-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${s.refresh}</button>`;i.innerHTML=`
    ${z({title:"Creative",online:!0,extras:J,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-creative" id="pm-creative-body">
      <h1 class="pm-creative-title">Creative Studio</h1>
      <div class="pm-creative-status"><span class="pm-creative-dot"></span> Online</div>

      <div class="pm-creative-modeswitch" id="pm-creative-mode">
        <button class="${r.mode==="image"?"active":""}" data-mode="image">${s.image} <span>Image</span></button>
        <button class="${r.mode==="video"?"active":""}" data-mode="video">${s.video} <span>Video</span></button>
      </div>

      <div class="pm-creative-providers" id="pm-creative-providers"></div>

      <div class="pm-creative-actions">
        <button class="pm-creative-action" data-action="upload">${s.upload} <span>Upload</span></button>
        <button class="pm-creative-action accent" data-action="secondary">${s.layers} <span data-secondary-label>Extract Layers</span></button>
        <button class="pm-creative-action" data-action="presets">${s.preset} <span>Presets</span> ${s.chev}</button>
      </div>

      <section id="pm-creative-image-stage" class="pm-creative-section" hidden>
        <div class="pm-creative-section-head">
          <h2>Featured Templates</h2>
          <button class="pm-creative-link" data-link="templates">View all</button>
        </div>
        <div class="pm-creative-templates" id="pm-creative-templates"></div>
      </section>

      <section id="pm-creative-video-stage" class="pm-creative-section" hidden>
        <div class="pm-creative-preview" id="pm-creative-video-preview">
          <div class="pm-creative-preview-empty">
            <div class="pm-empty-icon">${s.video}</div>
            <p>Generated video will appear here.</p>
          </div>
        </div>
        <div class="pm-creative-chiprow" id="pm-creative-video-meta" hidden>
          <span class="pm-creative-chip">${s.eye} <span data-meta-res>720p</span></span>
          <span class="pm-creative-chip">${s.clock} <span data-meta-dur>\u2014</span></span>
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
            <span class="pm-creative-quick-icon">${s.spark}</span>
            <div>
              <strong>Create HyperFrame</strong>
              <small>Generate motion with deterministic frames.</small>
            </div>
            ${s.chev}
          </button>
          <button class="pm-creative-quick" data-quick="motion-preset">
            <span class="pm-creative-quick-icon">${s.layers}</span>
            <div>
              <strong>Motion preset</strong>
              <small id="pm-creative-motion-preset-label">Sci-Fi Flythrough \xB7 View & edit preset</small>
            </div>
            ${s.chev}
          </button>
        </div>
      </section>

      <div class="pm-creative-composer" id="pm-creative-composer">
        <span class="pm-glass-lens" aria-hidden="true"></span>
        <div class="pm-creative-composer-row">
          <button class="pm-icon-btn" data-composer="add" aria-label="Attach">${s.plus}</button>
          <input type="text" class="pm-creative-input" id="pm-creative-prompt" placeholder="Type to imagine" autocomplete="off"/>
          <button class="pm-icon-btn" data-composer="voice" aria-label="Voice">${s.micSmall}</button>
          <button class="pm-creative-send" id="pm-creative-send" aria-label="Generate">${s.send}</button>
        </div>
        <div class="pm-creative-composer-meta">
          <button class="pm-creative-meta-chip" data-meta="agent"><span>${s.robot}</span> Agent <small>${r.agent?"On":"Beta"}</small></button>
          <button class="pm-creative-meta-chip accent" data-meta="kind"><span data-kind-icon>${r.mode==="video"?s.video:s.image}</span> <span data-kind-label>${r.mode==="video"?"Video":"Image"}</span></button>
          <button class="pm-creative-meta-chip" data-meta="aspect"><span>${s.monitor}</span> <span data-aspect-label>${r.aspect}</span> ${s.chev}</button>
          <button class="pm-creative-meta-chip" data-meta="outputs"><span>${s.eye}</span> View outputs ${s.chev}</button>
        </div>
      </div>
    </div>

    <div class="pm-creative-extract-modal" id="pm-creative-extract-modal" hidden>
      <div class="pm-creative-extract-card">
        <div class="pm-creative-extract-icon">${s.layers}</div>
        <h3 id="pm-extract-stage">Extracting layers</h3>
        <p id="pm-extract-detail" class="pm-card-body">Preparing layer analysis...</p>
        <div class="pm-creative-extract-bar"><div id="pm-extract-fill"></div></div>
        <ul class="pm-creative-extract-stages" id="pm-extract-stages"></ul>
        <button class="pm-btn ghost" id="pm-extract-close">Hide</button>
      </div>
    </div>
  `,W(i,{});let g=i.querySelector("#pm-creative-mode"),C=i.querySelector("#pm-creative-providers"),S=i.querySelector("#pm-creative-image-stage"),Q=i.querySelector("#pm-creative-video-stage"),Y=i.querySelector("#pm-creative-video-bottom"),I=i.querySelector("#pm-creative-templates"),h=i.querySelector("#pm-creative-gallery"),Z=i.querySelector("#pm-creative-gallery-title"),x=i.querySelector("#pm-creative-video-preview"),m=i.querySelector("#pm-creative-prompt"),u=i.querySelector("#pm-creative-send");function T(){C.innerHTML=_[r.mode].map(e=>`
      <button class="pm-creative-provider ${r.provider===e.id?"active":""}" data-provider="${c(e.id)}">
        ${e.id==="xai"?'<span class="pm-creative-provider-mark xai">\u{1D54F}</span>':e.id==="openai"?'<span class="pm-creative-provider-mark oai">\u25CE</span>':`<span class="pm-creative-provider-mark hf">${s.hf}</span>`}
        <span>${c(e.label)}</span>
      </button>
    `).join(""),C.querySelectorAll("[data-provider]").forEach(e=>{e.addEventListener("click",()=>{r.provider=e.getAttribute("data-provider"),T()})})}function ee(){I.innerHTML=A.map(e=>`
      <button class="pm-creative-template" data-template="${c(e.id)}">
        <span class="pm-creative-template-thumb">${s.image}</span>
        <strong>${c(e.title)}</strong>
        <small>${c(e.hint)}</small>
      </button>
    `).join(""),I.querySelectorAll("[data-template]").forEach(e=>{e.addEventListener("click",()=>{let t=A.find(a=>a.id===e.getAttribute("data-template"));t&&(m.value=t.prompt,m.focus())})})}function M(){Z.textContent=r.mode==="video"?"Recent renders":"Discover";let e=r.gallery[r.mode]||[];if(!e.length){h.innerHTML=`<div class="pm-creative-gallery-empty">${s[r.mode]} <span>No ${r.mode==="video"?"renders":"images"} yet \u2014 generate one below.</span></div>`;return}h.innerHTML=e.slice(0,12).map(t=>`
      <button class="pm-creative-gallery-card" data-gallery-path="${c(t.relPath)}">
        ${r.mode==="video"?`<span class="pm-creative-thumb video">
              <video src="${c(y(t.relPath))}#t=0.1" muted playsinline preload="metadata" crossorigin="use-credentials"></video>
              <span class="pm-creative-thumb-play">${s.play}</span>
            </span>`:`<span class="pm-creative-thumb" data-thumb="${c(t.relPath)}">${s.image}</span>`}
        <strong>${c(L(t.name))}</strong>
        <small>${c(t.name.split(".").pop())} \xB7 ${K(t.mtime)}</small>
      </button>
    `).join(""),r.mode==="image"&&h.querySelectorAll("[data-thumb]").forEach(async t=>{let a=t.getAttribute("data-thumb"),n=await v(a);n&&(t.innerHTML=`<img src="${n}" alt=""/>`)}),h.querySelectorAll("[data-gallery-path]").forEach(t=>{t.addEventListener("click",()=>te(t.getAttribute("data-gallery-path")))})}async function te(e){if(e)if(r.mode==="video")await H(e);else{let t=await v(e);t&&$(t,e)}}function $(e,t){r.currentResult={kind:"image",path:t,dataUrl:e},S.scrollIntoView({behavior:"smooth",block:"start"});let a=i.querySelector("#pm-creative-image-current");a||(a=document.createElement("div"),a.id="pm-creative-image-current",a.className="pm-creative-current-image",S.prepend(a)),a.innerHTML=`
      <div class="pm-creative-current-thumb"><img src="${e}" alt=""/></div>
      <div class="pm-creative-current-meta">
        <strong>${c(L(t.split("/").pop()))}</strong>
        <small>${c(t)}</small>
        <div class="pm-creative-current-actions">
          <button class="pm-btn primary" data-current-action="extract">${s.layers} Extract Layers</button>
          <a class="pm-btn ghost" download href="${e}">${s.download} Save</a>
        </div>
      </div>
    `,a.querySelector('[data-current-action="extract"]').addEventListener("click",()=>R(t))}async function H(e){r.currentResult={kind:"video",path:e};let t=y(e);x.innerHTML=`
      <video
        id="pm-creative-video-el"
        src="${c(t)}"
        controls
        playsinline
        preload="metadata"
        crossorigin="use-credentials"
      ></video>
    `;let a=x.querySelector("#pm-creative-video-el"),n=i.querySelector("#pm-creative-video-meta");n&&(n.hidden=!1),a&&(a.addEventListener("loadedmetadata",()=>{let o=Number.isFinite(a.duration)?Math.round(a.duration):0,l=a.videoWidth||0,p=a.videoHeight||0,oe=p>=1080?"1080p":p>=720?"720p":p>=480?"480p":l&&p?`${l}x${p}`:"\u2014",F=i.querySelector("[data-meta-dur]"),D=i.querySelector("[data-meta-res]");F&&(F.textContent=o?`${o}s`:"\u2014"),D&&(D.textContent=oe)},{once:!0}),a.addEventListener("error",()=>{x.innerHTML=`
          <div class="pm-creative-preview-stub">
            ${s.video}
            <strong>${c(L(e.split("/").pop()))}</strong>
            <small>${c(e)}</small>
            <span class="pm-creative-preview-hint">Couldn't load this render. Tap Refresh and try again.</span>
          </div>
        `}))}function f(){let e=r.mode==="image";S.hidden=!e,Q.hidden=e,Y.hidden=e,_[r.mode].find(l=>l.id===r.provider)||(r.provider=_[r.mode][0].id),r.aspect=b[r.mode][0].id;let t=i.querySelector("[data-kind-label]"),a=i.querySelector("[data-kind-icon]");t&&(t.textContent=e?"Image":"Video"),a&&(a.innerHTML=e?s.image:s.video);let n=i.querySelector("[data-aspect-label]");n&&(n.textContent=b[r.mode][0].label);let o=i.querySelector("[data-secondary-label]");o&&(o.textContent=e?"Extract Layers":"Export"),T(),ee(),M(),m.placeholder=e?"Type to imagine":"Describe the motion you want..."}function ae(){let e=String(m.value||"").trim();if(!e)return"";let t=r.provider,a=b[r.mode].find(o=>o.id===r.aspect)?.ratio||"square";if(r.mode==="video")return t==="hf"?`Use HyperFrames to compose and render a short motion video. Prompt: ${e}
Aspect: ${a}. After rendering, save the MP4 under generated/videos/ and tell me the final path.`:`Use the generate_video tool with provider="xai" to create a short video.
Prompt: ${e}
Aspect ratio: ${a}. Duration: 6 seconds. Resolution: 720p. Save under generated/videos/. Reply with the final file path.`;if(t==="hf")return`Compose a HyperFrames still using web-based motion freeze-frame. Prompt: ${e}
Aspect: ${a}. Save the result PNG under generated/images/ and report the path.`;let n=/\b(transparent|no background|alpha|cutout|sprite)\b/i.test(e)?`
Set background="transparent" and output_format="png" on the tool call for real alpha transparency.`:"";return`Use the generate_image tool with provider="${t}" to create an image.
Prompt: ${e}
Aspect ratio: ${a}.${n} Save under generated/images/. Reply with the final file path.`}let E=null;async function P(){if(r.busy)return;let e=ae();if(!e){d("Enter a prompt first","error"),m.focus();return}r.busy=!0,u.disabled=!0,u.classList.add("busy"),d(r.mode==="video"?"Generating video...":"Generating image...","info");let t="";E=j({message:e,sessionId:r.sessionId},{onToolResult:a=>{try{let n=String(a?.name||a?.tool||""),o=a?.extra||a?.toolResult?.extra||null;if(n==="generate_image"&&o){let l=o.generated_image?.path||o.generated_image||Array.isArray(o.generated_images)&&o.generated_images[0]?.path;l&&(t=String(l))}if(n==="generate_video"&&o){let l=o.generated_video?.path||o.generated_video||Array.isArray(o.generated_videos)&&o.generated_videos[0]?.path;l&&(t=String(l))}}catch{}},onError:a=>{d(a?.message||"Generation failed","error")},onDone:async()=>{if(r.busy=!1,u.disabled=!1,u.classList.remove("busy"),E=null,t)if(d("Saved \xB7 refreshing gallery","success"),r.mode==="image"){let a=await v(t);a&&$(a,t)}else await H(t);await k()}})}async function R(e){if(!e){d("Pick or generate an image first","error");return}if(!r.extract.busy){r.extract={busy:!0,requestId:"mob_"+Date.now(),stage:"Starting",detail:"Submitting request",stages:[]},re();try{let t=await U({sessionId:r.sessionId,source:e,mode:"balanced",requestId:r.extract.requestId});if(t?.success){d(`Extracted ${(t.layers||[]).length} layers \xB7 scene saved`,"success");let a=t.scenePath||"";if(a){let n=i.querySelector("#pm-extract-stages");if(n){let o=document.createElement("li");o.innerHTML=`<strong>Scene saved</strong> <small>${c(a)}</small>`,n.appendChild(o)}}}else d(t?.error||"Extract failed","error")}catch(t){d(t?.message||"Extract failed","error")}finally{r.extract.busy=!1;let t=i.querySelector("#pm-extract-close");t&&(t.textContent="Done")}}}function re(){let e=i.querySelector("#pm-creative-extract-modal");e.hidden=!1,i.querySelector("#pm-extract-stage").textContent="Extracting layers",i.querySelector("#pm-extract-detail").textContent="Preparing layer analysis...",i.querySelector("#pm-extract-stages").innerHTML="",i.querySelector("#pm-extract-fill").style.width="4%",i.querySelector("#pm-extract-close").textContent="Hide"}function V(){let e=i.querySelector("#pm-creative-extract-modal");e&&(e.hidden=!0)}let ie={source_loaded:8,vision_candidates:22,text_candidates:32,proposal_merge:38,foreground_start:44,foreground_mask:56,sam_start:60,sam_masks:74,alpha_cutouts:78,vector_trace:82,inpaint_start:86,clean_plate:94,scene_assembled:96,layer_assets_saved:100},G=e=>{if(!r.extract.busy||e?.requestId&&e.requestId!==r.extract.requestId)return;let t=String(e.stage||"progress"),a=String(e.label||t.replace(/_/g," ")),n=String(e.detail||"");i.querySelector("#pm-extract-stage").textContent=a,n&&(i.querySelector("#pm-extract-detail").textContent=n);let o=ie[t]||Math.min(95,(r.extract.stages.length+1)*10);i.querySelector("#pm-extract-fill").style.width=o+"%";let l=i.querySelector("#pm-extract-stages");if(l){r.extract.stages.push(t);let p=document.createElement("li");p.innerHTML=`<span class="pm-creative-stage-dot"></span> <strong>${c(a)}</strong>${n?` <small>${c(n)}</small>`:""}`,l.appendChild(p),l.scrollTop=l.scrollHeight}};window.wsEventBus&&window.wsEventBus.on("creative_extract_layers_progress",G),i.querySelector("#pm-extract-close").addEventListener("click",V),i.querySelector("#pm-creative-extract-modal").addEventListener("click",e=>{e.target.id==="pm-creative-extract-modal"&&V()});async function B(){let e=document.createElement("input");e.type="file",e.accept=r.mode==="video"?"video/*,image/*":"image/*",e.onchange=async()=>{let t=e.files?.[0];if(t){d("Uploading...","info");try{let a=await t.arrayBuffer(),n=btoa(String.fromCharCode(...new Uint8Array(a))),o=await N({filename:t.name,base64:n,mimeType:t.type});if(o?.success&&o.path){if(d("Uploaded \xB7 ready to use","success"),r.mode==="image"&&/\.(png|jpe?g|webp|gif)$/i.test(t.name)){let l=await v(o.path);l&&$(l,o.path)}}else d(o?.error||"Upload failed","error")}catch(a){d(a?.message||"Upload failed","error")}}},e.click()}function se(){let e=b[r.mode],t=document.createElement("div");t.className="pm-creative-sheet-overlay",t.innerHTML=`
      <div class="pm-creative-sheet">
        <h3>Aspect ratio</h3>
        <div class="pm-creative-sheet-options">
          ${e.map(a=>`<button data-aspect="${c(a.id)}" class="${r.aspect===a.id?"active":""}">${c(a.label)}<small>${c(a.ratio)}</small></button>`).join("")}
        </div>
        <button class="pm-btn ghost" data-close="1">Cancel</button>
      </div>
    `,document.body.appendChild(t),t.addEventListener("click",a=>{(a.target===t||a.target.getAttribute("data-close"))&&t.remove();let n=a.target.closest("[data-aspect]");if(n){r.aspect=n.getAttribute("data-aspect");let o=i.querySelector("[data-aspect-label]"),l=e.find(p=>p.id===r.aspect);o&&l&&(o.textContent=l.label),t.remove()}})}function w(){let e=r.mode==="video"?ne:A,t=document.createElement("div");t.className="pm-creative-sheet-overlay",t.innerHTML=`
      <div class="pm-creative-sheet">
        <h3>${r.mode==="video"?"Motion presets":"Image presets"}</h3>
        <div class="pm-creative-sheet-list">
          ${e.map(a=>`<button data-preset="${c(a.id)}"><strong>${c(a.title)}</strong><small>${c(a.hint||a.prompt.slice(0,80))}</small></button>`).join("")}
        </div>
        <button class="pm-btn ghost" data-close="1">Close</button>
      </div>
    `,document.body.appendChild(t),t.addEventListener("click",a=>{(a.target===t||a.target.getAttribute("data-close"))&&t.remove();let n=a.target.closest("[data-preset]");if(n){let o=e.find(l=>l.id===n.getAttribute("data-preset"));o&&(m.value=o.prompt,m.focus()),t.remove()}})}async function k(){let[e,t]=await Promise.all([q({kind:"image"}),q({kind:"video"})]);r.gallery.image=e,r.gallery.video=t,M()}g.querySelectorAll("[data-mode]").forEach(e=>{e.addEventListener("click",()=>{r.mode=e.getAttribute("data-mode"),g.querySelectorAll("[data-mode]").forEach(t=>t.classList.toggle("active",t===e)),f()})}),i.querySelectorAll("[data-action]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-action");if(t==="upload")return B();if(t==="presets")return w();if(t==="secondary"){if(r.mode==="image"){let n=r.currentResult?.path||r.gallery.image[0]?.relPath||"";if(!n){d("Generate or upload an image first","error");return}return R(n)}let a=r.currentResult?.path||r.gallery.video[0]?.relPath||"";if(!a){d("Generate a video first","error");return}window.open(y(a),"_blank")}})}),i.querySelectorAll("[data-meta]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-meta");if(t==="aspect")return se();t==="kind"&&(r.mode=r.mode==="image"?"video":"image",g.querySelectorAll("[data-mode]").forEach(a=>a.classList.toggle("active",a.getAttribute("data-mode")===r.mode)),f()),t==="agent"&&(r.agent=!r.agent,e.querySelector("small").textContent=r.agent?"On":"Beta"),t==="outputs"&&document.getElementById("pm-creative-gallery")?.scrollIntoView({behavior:"smooth",block:"start"})})}),i.querySelectorAll("[data-quick]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-quick");t==="create-hf"&&(r.mode="video",r.provider="hf",g.querySelectorAll("[data-mode]").forEach(a=>a.classList.toggle("active",a.getAttribute("data-mode")==="video")),f(),m.focus()),t==="motion-preset"&&w()})}),i.querySelectorAll("[data-composer]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-composer");t==="add"&&B(),t==="voice"&&X?.("#mobile/voice")})}),i.querySelectorAll("[data-link]").forEach(e=>{e.addEventListener("click",()=>{let t=e.getAttribute("data-link");t==="templates"&&w(),t==="gallery"&&document.getElementById("pm-creative-gallery")?.scrollIntoView({behavior:"smooth",block:"start"})})}),u.addEventListener("click",P),m.addEventListener("keydown",e=>{e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),P())}),i.querySelector("#pm-creative-refresh").addEventListener("click",k),f(),await k(),i._pmCleanup=()=>{try{window.wsEventBus?.off("creative_extract_layers_progress",G)}catch{}try{E?.abort?.()}catch{}}}export{ue as renderCreativePage};
