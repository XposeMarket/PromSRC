function Pe(e,{shell:S,library:P,stage:D,props:E,timeline:z,timelineTracks:q,timelineMeta:l,title:a,subtitle:v,mode:r,skipStageRender:t=!1}){e.ensureCreativeAssetsHydrated(r),e.ensureCreativeLibrariesHydrated(r),r==="video"&&e.creativeLibraryNavTab==="blocks"&&e.ensureCreativeHtmlMotionBlocksHydrated(),S.style.display="flex",S.style.position="relative",S.style.zIndex="2",S.dataset.creativeMode=r,a&&(a.textContent=r==="video"?"Prometheus Video Studio":"Prometheus Image Studio"),v&&(v.textContent=r==="video"?"Build HTML Motion, HyperFrames, and Remotion clips with deterministic frame QA.":"Build still compositions on a focused studio canvas with the shared scene graph underneath.");let i=e.getSelectedCreativeElement(),s=i?e.buildSceneSelectionContext(e.creativeSceneDoc,i.id):null,n=i?e.getRenderedCreativeElement(i,r):null,o=r==="video"&&n?{...i,...n}:i,c=e.getCreativeLibraryPackCatalogState(),m=e.getFilteredCreativeLibrarySections(),w=c.filter(d=>e.getActiveCreativeLibraryIds().includes(String(d?.id||"").trim().toLowerCase())).map(d=>({id:String(d.id),label:d.label||d.id,source:d.source||"builtin"})),H=`
    <nav class="creative-lib-nav">
      ${[...r==="video"?[]:[{id:"elements",icon:"solar:layers-minimalistic-bold-duotone",label:"Elements"}],...r==="video"?[{id:"blocks",icon:"solar:widget-add-bold-duotone",label:"Blocks"}]:[],{id:"icons",icon:"solar:sticker-smile-circle-2-bold-duotone",label:"Icons"},{id:"libraries",icon:"solar:widget-add-bold-duotone",label:"Packs"}].map(d=>`
        <button class="creative-lib-nav-btn${e.creativeLibraryNavTab===d.id?" active":""}"
                onclick="canvasSetCreativeLibraryNavTab('${d.id}')"
                title="${d.label}">
          <iconify-icon icon="${d.icon}" width="20" height="20"></iconify-icon>
          <span>${d.label}</span>
        </button>
      `).join("")}
    </nav>
  `,y=[{id:"text",label:"Text",icon:"solar:text-bold-duotone"},{id:"shapes",label:"Shapes",icon:"solar:shapes-bold-duotone"},{id:"icons",label:"Icons",icon:"solar:stars-bold-duotone"},{id:"images",label:"Images",icon:"solar:gallery-wide-bold-duotone"},{id:"components",label:"Components",icon:"solar:widget-4-bold-duotone"},{id:"animations",label:"Lottie",icon:"solar:film-roll-bold-duotone"}],u=m.sections.reduce((d,h)=>(d[h.section.toLowerCase()]=h.items,d),{}),f=e.creativeLibraryActiveCategory,M=f?(()=>{let d=y.find(b=>b.id===f),h=u[f]||[];return`
          <div class="creative-lib-panel-header">
            <button class="creative-lib-cat-back" onclick="canvasSetCreativeLibraryCategory(null)">
              <iconify-icon icon="solar:arrow-left-bold-duotone" width="14" height="14"></iconify-icon>
              ${d?d.label:f}
            </button>
          </div>
          <div class="creative-lib-cat-items">
            ${h.length?h.map(b=>`
              <button onclick="canvasAddCreativeLibraryItem('${e.escHtml(f)}','${e.escHtml(b.kind)}')" class="creative-lib-tile">
                <span class="creative-lib-tile-icon"><iconify-icon icon="${e.escHtml(e.getCreativeLibraryItemIconStudioV3(f,b))}" width="22" height="22"></iconify-icon></span>
                <span class="creative-lib-tile-label">${e.escHtml(b.label)}</span>
              </button>
            `).join(""):'<div class="creative-asset-empty" style="padding:16px">No items in this category. Install a library pack to add more.</div>'}
          </div>
        `})():`
      <div class="creative-lib-panel-header">
        <div class="creative-lib-panel-title">Elements</div>
        <div class="creative-lib-panel-sub">Click a category to add to canvas.</div>
      </div>
      <div class="creative-lib-cat-grid">
        ${y.map(d=>`
          <button class="creative-lib-cat-btn" onclick="canvasSetCreativeLibraryCategory('${d.id}')">
            <iconify-icon icon="${d.icon}" width="24" height="24"></iconify-icon>
            <span>${d.label}</span>
          </button>
        `).join("")}
      </div>
      <div style="padding:10px 12px 0">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#6b7280;margin-bottom:8px">Quick add</div>
        <div class="creative-lib-cat-items" style="grid-template-columns:repeat(2,1fr)">
          ${m.sections.slice(0,1).flatMap(d=>d.items.slice(0,4)).map(d=>`
            <button onclick="canvasAddCreativeLibraryItem('${e.escHtml(m.sections[0]?.section||"text")}','${e.escHtml(d.kind)}')" class="creative-lib-tile">
              <span class="creative-lib-tile-icon"><iconify-icon icon="${e.escHtml(e.getCreativeLibraryItemIconStudioV3(m.sections[0]?.section||"text",d))}" width="18" height="18"></iconify-icon></span>
              <span class="creative-lib-tile-label">${e.escHtml(d.label)}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `,$=`
    <div class="creative-lib-panel-header">
      <div class="creative-lib-panel-title">Icon Search</div>
      <div class="creative-lib-panel-sub">Search 150k+ icons from all sets.</div>
    </div>
    <div style="padding:10px 10px 0">
      <div style="display:flex;gap:6px;align-items:center">
        <input
          class="creative-form-input"
          type="search"
          placeholder="star, arrow, user..."
          value="${e.escHtml(e.creativeIconifySearch.query||"")}"
          oninput="canvasSearchIconify(this.value)"
          style="flex:1;min-width:0"
        />
      </div>
    </div>
    ${e.creativeIconifySearch.loading?'<div class="creative-asset-empty" style="padding:16px">Searching...</div>':""}
    ${e.creativeIconifySearch.error?`<div class="creative-asset-empty" style="padding:16px;color:#fca5a5">${e.escHtml(e.creativeIconifySearch.error)}</div>`:""}
    ${!e.creativeIconifySearch.loading&&e.creativeIconifySearch.results.length?`
      <div class="creative-iconify-grid">
        ${e.creativeIconifySearch.results.map(d=>`
          <button class="creative-iconify-tile" onclick="canvasAddIconifyIcon('${e.escHtml(d)}')" title="${e.escHtml(d)}">
            <iconify-icon icon="${e.escHtml(d)}" width="24" height="24"></iconify-icon>
          </button>
        `).join("")}
      </div>
    `:!e.creativeIconifySearch.loading&&!e.creativeIconifySearch.query?`
      <div style="padding:12px 12px 0">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#6b7280;margin-bottom:8px">Popular sets</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${[["Solar","solar:stars-bold-duotone","solar:"],["Material","mdi:material-design","mdi:"],["Phosphor","ph:star-duotone","ph:"],["Tabler","tabler:star","tabler:"],["Heroicons","heroicons:star-solid","heroicons:"],["Lucide","lucide:star","lucide:"]].map(([d,h,b])=>`
            <button class="creative-lib-cat-back" style="justify-content:flex-start;gap:8px;padding:7px 8px" onclick="canvasSearchIconify('${b}')">
              <iconify-icon icon="${e.escHtml(h)}" width="16" height="16" style="color:#fb923c"></iconify-icon>
              <span style="font-size:11px;font-weight:600;color:#d6d3d1">${e.escHtml(d)}</span>
              <span style="font-size:10px;color:#6b7280;margin-left:auto">${e.escHtml(b)}*</span>
            </button>
          `).join("")}
        </div>
      </div>
    `:""}
  `,I=`
    <div class="creative-lib-panel-header">
      <div class="creative-lib-panel-title">Library Packs</div>
      <div class="creative-lib-panel-sub">Install icon sets, shapes &amp; motion presets.</div>
    </div>
    ${e.renderCreativeLibraryPacksStudioV3()}
  `,L=r==="video"?`
    <div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06)">
      <button type="button" class="creative-chip-btn creative-chip-btn--accent" onclick="canvasOpenHyperframesCatalog()" style="width:100%;justify-content:center">
        <iconify-icon icon="solar:widget-add-bold-duotone" width="14" height="14"></iconify-icon>
        HyperFrames Catalog
      </button>
    </div>
    ${e.renderCreativeHtmlMotionBlocksPanelStudioV3()}
  `:"",T=i&&i.type==="text"?`
    <div class="creative-lib-panel-header">
      <div class="creative-lib-panel-title">Typography</div>
      <div class="creative-lib-panel-sub">Editing the selected text layer.</div>
    </div>
    <div style="padding:12px">
      ${e.renderCreativePropertyTextareaStudioV3("Content","meta.content",i.meta?.content||"")}
      <div class="creative-field-grid" style="margin-top:12px">
        ${e.renderCreativePropertyFieldStudioV3("Font size","meta.fontSize",i.meta?.fontSize||24)}
        ${e.renderCreativePropertyFieldStudioV3("Weight","meta.fontWeight",i.meta?.fontWeight||700)}
        ${e.renderCreativePropertyFieldStudioV3("Font family","meta.fontFamily",i.meta?.fontFamily||"Manrope","text")}
        <label class="creative-form-field">
          <span class="creative-form-label">Align</span>
          <select class="creative-form-select" onchange="canvasUpdateCreativeProperty('meta.textAlign', this.value, 'text')">
            ${["left","center","right"].map(d=>`<option value="${d}" ${String(i.meta?.textAlign||"left")===d?"selected":""}>${d}</option>`).join("")}
          </select>
        </label>
        ${e.renderCreativePropertyFieldStudioV3("Line height","meta.lineHeight",i.meta?.lineHeight||1.2,"number",{step:"0.1"})}
        ${e.renderCreativePropertyFieldStudioV3("Letter spacing","meta.letterSpacing",i.meta?.letterSpacing||0,"number",{step:"0.5"})}
        ${e.renderCreativePropertyFieldStudioV3("Color","meta.color",i.meta?.color||"#111827","color")}
      </div>
    </div>
  `:"",X=!e.creativeLibraryNavTab&&!T;S.classList.toggle("is-library-collapsed",X);let N;T?N=T:e.creativeLibraryNavTab==="icons"?N=$:e.creativeLibraryNavTab==="libraries"?N=I:e.creativeLibraryNavTab==="blocks"?N=L:e.creativeLibraryNavTab==="elements"?N=M:N="",P.innerHTML=`
    ${H}
    ${N?`<div class="creative-lib-panel">${N}</div>`:""}
  `,P.style.minWidth="0";let C=e.getCreativeAudioTrackConfig(),F=e.hasCreativeAudioTrack(),oe=C.label||(C.source?String(C.source).split("/").pop():"No track loaded");D.style.width=`${e.creativeSceneDoc.width}px`,D.style.height=`${e.creativeSceneDoc.height}px`,D.style.background=e.creativeSceneDoc.background||"#ffffff",D.style.maxWidth="none",D.style.flex="0 0 auto",t?e.syncCreativeFabricSelectionFromState({render:!0}):e.renderCreativeStageStudioV3(D,r);let W=document.getElementById("canvas-creative-stage-wrap"),ne=document.getElementById("canvas-creative-stage-caption"),le=document.getElementById("canvas-creative-stage-status"),ce=document.getElementById("canvas-creative-stage-size"),de=document.getElementById("canvas-creative-stage-footer"),ye=document.getElementById("canvas-creative-stage-scroll"),me=document.getElementById("canvas-creative-stage-live-status"),ve=document.getElementById("canvas-creative-stage-zoom"),O=document.getElementById("canvas-creative-export-gif-btn"),G=document.getElementById("canvas-creative-export-mp4-btn"),Q=document.getElementById("canvas-creative-export-webm-btn"),K=document.getElementById("canvas-creative-export-cancel-btn"),V=e.getCreativeActiveExportPercent(),Z=String(e.creativeActiveExport?.status||"").trim().toLowerCase();W&&(W.style.minWidth="0",W.style.position="relative",W.style.isolation="isolate"),ne&&(ne.textContent=e.creativeHtmlMotionClip?"HTML/CSS motion clip preview. Use sampled frame QA before MP4 export.":r==="video"?"Motion-ready frame with timeline-aware editing at the current playhead.":"Framed composition surface for posters, social assets, and export-ready stills."),le&&(le.style.display="none"),ce&&(ce.style.display="none"),me&&(me.textContent=e.isCreativeExportActive()?`${String(e.creativeActiveExport?.format||"export").toUpperCase()} ${V}%`:e.creativeHtmlMotionClip?"HTML motion":r==="video"?"Timeline live":"Live canvas"),ve&&(ve.textContent=`${Math.round(e.clampCreativeStageZoom(e.creativeStageZoom)*100)}%`);let J=(d,h,b)=>`<iconify-icon icon="${d}" width="16" height="16"></iconify-icon><span>${e.escHtml(h)}</span><span class="creative-export-menu-hint">${e.escHtml(b)}</span>`;if(O){let d=r==="video"&&!!e.getCreativeGifExportConfig(),h=e.isCreativeExportActive("gif");O.style.display=d?"grid":"none",O.disabled=e.isCreativeExportActive(),d&&(O.innerHTML=J("solar:gallery-favourite-bold-duotone",h?`GIF ${V}%`:"GIF","Animation"))}if(G){let d=e.getCreativeVideoExportConfig("mp4"),h=r==="video"&&!!d,b=e.isCreativeExportActive("mp4");G.style.display=h?"grid":"none",G.disabled=e.isCreativeExportActive(),h&&(G.innerHTML=J("solar:videocamera-record-bold-duotone",b?`MP4 ${V}%`:"MP4","Video"))}if(Q){let d=r==="video",h=e.isCreativeExportActive("webm");Q.style.display=d?"grid":"none",Q.disabled=e.isCreativeExportActive(),d&&(Q.innerHTML=J("solar:clapperboard-play-bold-duotone",h?`WEBM ${V}%`:"WEBM","Video"))}if(K){let d=r==="video"&&e.isCreativeExportActive();K.style.display=d?"grid":"none",K.disabled=e.creativeActiveExport?.cancelRequested===!0,d&&(K.innerHTML=J("solar:close-circle-bold-duotone",e.creativeActiveExport?.cancelRequested?"Stopping...":"Cancel export",""))}de&&(de.textContent=e.isCreativeExportActive("gif")?e.creativeActiveExport?.cancelRequested?"Stopping the GIF export now. The current frame or encoder step will finish and then your edit state will be restored.":`Rendering the animated GIF now. ${Z==="encoding"?"Encoding frames into GIF.":Z==="capturing"?"Capturing timeline frames.":"Finalizing the file now."} Progress ${V}%.`:e.isCreativeExportActive("webm")?e.creativeActiveExport?.cancelRequested?"Stopping the WebM export now. The current frame pass will finish and then your edit state will be restored.":`${e.creativeActiveExport?.audioEnabled?"Recording audio + video to WebM now.":e.creativeActiveExport?.audioRequested?"Recording video to WebM now. The audio lane could not be attached in this browser, so this export is silent.":"Recording the full video draft to WebM now."} ${Z==="finalizing"?"Finalizing the file now.":`Progress ${V}%.`}`:e.isCreativeExportActive("mp4")?e.creativeActiveExport?.cancelRequested?"Stopping the MP4 export now. The current frame pass will finish and then your edit state will be restored.":`${e.creativeActiveExport?.audioEnabled?"Recording audio + video to MP4 now.":e.creativeActiveExport?.audioRequested?"Recording video to MP4 now. The audio lane could not be attached in this browser, so this export is silent.":"Recording the full video draft to MP4 now."} ${Z==="finalizing"?"Finalizing the file now.":`Progress ${V}%.`}`:i?`${i.type} selected. Drag on the frame or use the corner handle for quick edits.`:r==="video"?F?"Move or resize elements at the playhead to create keyframes while the audio lane stays aligned underneath.":"Move or resize elements at the playhead to create animation keyframes on the frame.":"Select an element to style it or pull new pieces from the studio rail."),E.style.minWidth="0",E.style.overflowX="hidden",E.style.overflowY="auto";let fe=Math.round(Number(o?.x??i?.x??0)||0),ge=Math.round(Number(o?.y??i?.y??0)||0),Ce=Math.round(Number(o?.width??i?.width??0)||0),be=Math.round(Number(o?.height??i?.height??0)||0),x=e.renderCreativeInspectorTabsStudioV3(),pe=r==="video"?`
    <section class="creative-inspector-card">
      <div class="creative-section-heading">
        <div class="creative-card-title">Audio lane</div>
        <div class="creative-card-subtitle">Attach a soundtrack or VO file now so timing lives with the scene document before the full audio engine lands.</div>
      </div>
      ${e.renderCreativePropertyFieldStudioV3("Audio source","audioTrack.source",C.source||"","text",{handler:"canvasUpdateCreativeDocumentProperty"})}
      <div class="creative-field-grid" style="margin-top:12px">
        ${e.renderCreativePropertyFieldStudioV3("Label","audioTrack.label",C.label||"","text",{handler:"canvasUpdateCreativeDocumentProperty"})}
        ${e.renderCreativePropertyFieldStudioV3("Start (ms)","audioTrack.startMs",C.startMs||0,"number",{min:"0",step:"50",handler:"canvasUpdateCreativeDocumentProperty"})}
        ${e.renderCreativePropertyFieldStudioV3("Duration (ms)","audioTrack.durationMs",C.durationMs||0,"number",{min:"0",step:"50",handler:"canvasUpdateCreativeDocumentProperty"})}
        ${e.renderCreativePropertyFieldStudioV3("Volume","audioTrack.volume",C.volume??1,"number",{min:"0",max:"1",step:"0.05",handler:"canvasUpdateCreativeDocumentProperty"})}
        ${e.renderCreativePropertyToggleStudioV3("Muted","audioTrack.muted",C.muted===!0,{handler:"canvasUpdateCreativeDocumentProperty"})}
      </div>
      <div class="creative-section-heading" style="margin-top:16px">
        <div class="creative-card-title">Trim &amp; fade</div>
        <div class="creative-card-subtitle">Clip the source file and shape the volume envelope. These values feed directly into the audio engine timing.</div>
      </div>
      <div class="creative-field-grid">
        ${e.renderCreativePropertyFieldStudioV3("Trim start (ms)","audioTrack.trimStartMs",C.trimStartMs||0,"number",{min:"0",step:"50",handler:"canvasUpdateCreativeDocumentProperty"})}
        ${e.renderCreativePropertyFieldStudioV3("Trim end (ms)","audioTrack.trimEndMs",C.trimEndMs||0,"number",{min:"0",step:"50",handler:"canvasUpdateCreativeDocumentProperty"})}
        ${e.renderCreativePropertyFieldStudioV3("Fade in (ms)","audioTrack.fadeInMs",C.fadeInMs||0,"number",{min:"0",step:"50",handler:"canvasUpdateCreativeDocumentProperty"})}
        ${e.renderCreativePropertyFieldStudioV3("Fade out (ms)","audioTrack.fadeOutMs",C.fadeOutMs||0,"number",{min:"0",step:"50",handler:"canvasUpdateCreativeDocumentProperty"})}
      </div>
      ${C.analysis?.durationMs?`<div class="creative-info-note" style="margin-top:10px">Source duration: ${e.escHtml(e.formatCreativeTimelineTime(C.analysis.durationMs))}${C.analysis?.codec?` \xB7 ${e.escHtml(C.analysis.codec)}`:""}${C.analysis?.sampleRate?` \xB7 ${Math.round(C.analysis.sampleRate/1e3)}kHz`:""}</div>`:""}
      <div class="creative-info-note">${e.escHtml(F?`Current lane: ${oe}`:"Drop in a path or URL now and the lane will show up in the timeline immediately.")}</div>
      <div class="creative-pill-row" style="margin-top:12px">
        <button onclick="canvasClearCreativeAudioTrack()" class="creative-chip-btn">Clear audio</button>
      </div>
    </section>
  `:"";if(e.creativeInspectorTab==="layers")E.innerHTML=`
      ${x}
      ${e.renderCreativeLayersPanelStudioV3(r)}
    `;else if(i){let d=`
      <div class="creative-inspector-summary">
        <span class="creative-summary-pill">x ${fe}</span>
        <span class="creative-summary-pill">y ${ge}</span>
        <span class="creative-summary-pill">${Ce} x ${be}</span>
        <span class="creative-summary-pill">opacity ${Number(o?.opacity??i.opacity??1).toFixed(2)}</span>
        ${e.getCreativeAspectLockEnabled(i)?'<span class="creative-summary-pill">aspect locked</span>':""}
        ${r==="video"?`<span class="creative-summary-pill">${Array.isArray(i.meta?.keyframes)?i.meta.keyframes.length:0} keyframes</span>`:""}
      </div>
    `,h=`
      <section class="creative-inspector-card">
        <div class="creative-section-heading">
          <div class="creative-card-title">Transform</div>
          <div class="creative-card-subtitle">Position, sizing, and layer visibility for the selected element.</div>
        </div>
        <div class="creative-field-grid">
          ${e.renderCreativePropertyFieldStudioV3("X","x",o?.x??i.x)}
          ${e.renderCreativePropertyFieldStudioV3("Y","y",o?.y??i.y)}
          ${e.renderCreativePropertyFieldStudioV3("Width","width",o?.width??i.width)}
          ${e.renderCreativePropertyFieldStudioV3("Height","height",o?.height??i.height)}
          ${e.renderCreativePropertyFieldStudioV3("Rotation","rotation",o?.rotation??i.rotation)}
          ${e.renderCreativePropertyFieldStudioV3("Opacity","opacity",o?.opacity??i.opacity,"number",{step:"0.1",min:"0",max:"1"})}
          ${e.renderCreativePropertyFieldStudioV3("Z index","zIndex",i.zIndex)}
          ${e.renderCreativePropertyToggleStudioV3("Aspect lock","meta.aspectLocked",e.getCreativeAspectLockEnabled(i))}
          ${e.renderCreativePropertyToggleStudioV3("Visible","visible",i.visible!==!1)}
          ${e.renderCreativePropertyToggleStudioV3("Locked","locked",i.locked===!0)}
        </div>
      </section>
    `,b="";i.type==="text"?b=`
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Typography</div>
            <div class="creative-card-subtitle">Content, type settings, and measured layout data for this text layer.</div>
          </div>
          ${e.renderCreativePropertyTextareaStudioV3("Content","meta.content",i.meta?.content||"")}
          <div class="creative-field-grid" style="margin-top:12px">
            ${e.renderCreativePropertyFieldStudioV3("Font size","meta.fontSize",i.meta?.fontSize||24)}
            ${e.renderCreativePropertyFieldStudioV3("Weight","meta.fontWeight",i.meta?.fontWeight||700)}
            ${e.renderCreativePropertyFieldStudioV3("Font family","meta.fontFamily",i.meta?.fontFamily||"Manrope","text")}
            <label class="creative-form-field">
              <span class="creative-form-label">Align</span>
              <select class="creative-form-select" onchange="canvasUpdateCreativeProperty('meta.textAlign', this.value, 'text')">
                ${["left","center","right"].map(_=>`<option value="${_}" ${String(i.meta?.textAlign||"left")===_?"selected":""}>${_}</option>`).join("")}
              </select>
            </label>
            ${e.renderCreativePropertyFieldStudioV3("Line height","meta.lineHeight",i.meta?.lineHeight||1.2,"number",{step:"0.1"})}
            ${e.renderCreativePropertyFieldStudioV3("Letter spacing","meta.letterSpacing",i.meta?.letterSpacing||0,"number",{step:"0.5"})}
            ${e.renderCreativePropertyFieldStudioV3("Color","meta.color",i.meta?.color||"#111827","color")}
          </div>
          <div class="creative-info-note">
            <div><strong>Measurement:</strong> ${e.escHtml(i.meta?.pretextMeasured?"Pretext":i.meta?.measurement?.kind||"fallback")}</div>
            <div><strong>Lines:</strong> ${e.escHtml(String(i.meta?.measurement?.lineCount||1))} | <strong>Height:</strong> ${e.escHtml(String(Math.round(Number(i.meta?.measurement?.height||i.height||0))))} px</div>
          </div>
        </section>
      `:i.type==="shape"?b=`
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Shape styling</div>
            <div class="creative-card-subtitle">Update geometry, fill, stroke, and corner treatment for the selected shape.</div>
          </div>
          <div class="creative-field-grid">
            <label class="creative-form-field">
              <span class="creative-form-label">Shape</span>
              <select class="creative-form-select" onchange="canvasUpdateCreativeProperty('meta.shape', this.value, 'text')">
                ${["rect","circle","triangle","polygon","line","arrow"].map(_=>`<option value="${_}" ${String(i.meta?.shape||"rect")===_?"selected":""}>${_}</option>`).join("")}
              </select>
            </label>
            ${e.renderCreativePropertyFieldStudioV3("Fill","meta.fill",i.meta?.fill||"#111827","color")}
            ${e.renderCreativePropertyFieldStudioV3("Stroke","meta.stroke",i.meta?.stroke||"#111827","color")}
            ${e.renderCreativePropertyFieldStudioV3("Radius","meta.radius",i.meta?.radius||0)}
            ${e.renderCreativePropertyFieldStudioV3("Stroke width","meta.strokeWidth",i.meta?.strokeWidth||0)}
            ${String(i.meta?.shape||"rect")==="polygon"?e.renderCreativePropertyFieldStudioV3("Sides","meta.sides",i.meta?.sides||6,"number",{min:"5",max:"8",step:"1"}):""}
          </div>
        </section>
      `:i.type==="icon"?b=`
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Icon</div>
            <div class="creative-card-subtitle">Swap the icon name or recolor the current glyph.</div>
          </div>
          ${e.renderCreativePropertyFieldStudioV3("Icon name","meta.iconName",i.meta?.iconName||"solar:stars-bold-duotone","text")}
          <div class="creative-field-grid" style="margin-top:12px">
            ${e.renderCreativePropertyFieldStudioV3("Color","meta.color",i.meta?.color||"#111827","color")}
          </div>
        </section>
      `:i.type==="image"||i.type==="video"?b=`
          <section class="creative-inspector-card">
            <div class="creative-section-heading">
              <div class="creative-card-title">${i.type==="video"?"Video layer":"Image layer"}</div>
              <div class="creative-card-subtitle">Control source, fit mode, frame radius, and asset timing for the selected media block.</div>
            </div>
            ${e.renderCreativePropertyFieldStudioV3("Source","meta.source",i.meta?.source||"","text")}
            ${i.type==="image"?`<div class="creative-pill-row" style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="creative-chip-btn creative-chip-btn--accent" onclick="canvasOpenExtractLayersDialog(${e.encodeInlineJsString(i.meta?.source||"")})" ${e.creativeLayerExtractionBusy||!i.meta?.source?"disabled":""}>
                <iconify-icon icon="solar:layers-bold-duotone" width="14" height="14"></iconify-icon>${e.escHtml(e.creativeLayerExtractionBusy?"Extracting...":"Extract layers")}
              </button>
              ${i.meta?.extraction?.samCutout||i.meta?.extraction?.cutoutBbox?`<button type="button" class="creative-chip-btn" onclick="canvasStartRefineSelectedMask()" title="Click in the layer to keep, shift-click to remove, Enter to apply">
                <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="14" height="14"></iconify-icon>Refine mask
              </button>`:""}
            </div>`:""}
            <div class="creative-field-grid" style="margin-top:12px">
              ${e.renderCreativePropertyFieldStudioV3("Fit","meta.fit",i.meta?.fit||"cover","text")}
              ${e.renderCreativePropertyFieldStudioV3("Radius","meta.radius",i.meta?.radius||18)}
            </div>
            ${i.type==="video"?`<div class="creative-field-grid" style="margin-top:12px">
              ${e.renderCreativePropertyFieldStudioV3("Start Ms","meta.timelineStartMs",i.meta?.timelineStartMs||0)}
              ${e.renderCreativePropertyFieldStudioV3("Duration Ms","meta.timelineDurationMs",i.meta?.timelineDurationMs||e.creativeSceneDoc.durationMs)}
              ${e.renderCreativePropertyFieldStudioV3("Trim Start","meta.trimStartMs",i.meta?.trimStartMs||0)}
              ${e.renderCreativePropertyFieldStudioV3("Volume","meta.volume",i.meta?.volume||0,"number",{step:"0.05",min:"0",max:"1"})}
            </div>`:""}
          </section>
        `:i.type==="group"?b=`
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Component</div>
            <div class="creative-card-subtitle">Starter component metadata for the selected grouped element.</div>
          </div>
          <label class="creative-form-field">
            <span class="creative-form-label">Component</span>
            <select class="creative-form-select" onchange="canvasUpdateCreativeProperty('meta.component', this.value, 'text')">
              ${["card","button","badge","divider","stat","quote"].map(_=>`<option value="${_}" ${String(i.meta?.component||"card")===_?"selected":""}>${_}</option>`).join("")}
            </select>
          </label>
          <div class="creative-field-grid" style="margin-top:12px">
            ${e.renderCreativePropertyFieldStudioV3("Background","meta.background",i.meta?.background||"#111827","color")}
            ${e.renderCreativePropertyFieldStudioV3("Text color","meta.textColor",i.meta?.textColor||"#f8fafc","color")}
            ${e.renderCreativePropertyFieldStudioV3("Accent","meta.accent",i.meta?.accent||"#f97316","color")}
            ${e.renderCreativePropertyFieldStudioV3("Radius","meta.radius",i.meta?.radius||18)}
          </div>
          ${["card"].includes(String(i.meta?.component||"card"))?e.renderCreativePropertyFieldStudioV3("Title","meta.title",i.meta?.title||"Feature card","text"):""}
          ${["card"].includes(String(i.meta?.component||"card"))?e.renderCreativePropertyTextareaStudioV3("Body","meta.body",i.meta?.body||"Use starter components to block in polished layouts quickly."):""}
          ${["button","badge","divider","stat"].includes(String(i.meta?.component||"card"))?e.renderCreativePropertyFieldStudioV3("Label","meta.label",i.meta?.label||"Label","text"):""}
          ${String(i.meta?.component||"card")==="stat"?e.renderCreativePropertyFieldStudioV3("Value","meta.value",i.meta?.value||"24%","text"):""}
          ${String(i.meta?.component||"card")==="quote"?e.renderCreativePropertyTextareaStudioV3("Quote","meta.quote",i.meta?.quote||"Design the system, then let it move."):""}
          ${String(i.meta?.component||"card")==="quote"?e.renderCreativePropertyFieldStudioV3("Author","meta.author",i.meta?.author||"Prometheus","text"):""}
        </section>
      `:i.type==="hyperframes"?b=e.renderHyperframesInspector(i):i.type==="lottie"&&(b=`
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Lottie Animation</div>
            <div class="creative-card-subtitle">Paste a LottieFiles URL or any .json animation URL. Find free animations at lottiefiles.com.</div>
          </div>
          ${e.renderCreativePropertyFieldStudioV3("Source URL","meta.source",i.meta?.source||"","text")}
          <div class="creative-field-grid" style="margin-top:12px">
            ${e.renderCreativePropertyFieldStudioV3("Speed","meta.speed",i.meta?.speed??1,"number",{step:"0.1",min:"0.1",max:"4"})}
            ${e.renderCreativePropertyToggleStudioV3("Loop","meta.loop",i.meta?.loop!==!1)}
            ${e.renderCreativePropertyToggleStudioV3("Autoplay","meta.autoplay",i.meta?.autoplay!==!1)}
          </div>
          <div class="creative-info-note">Browse 50,000+ free animations at <strong>lottiefiles.com</strong> \u2014 copy the Lottie JSON URL and paste above.</div>
        </section>
      `);let ee=`
      <section class="creative-inspector-card">
        <div class="creative-section-heading">
          <div class="creative-card-title">Layer actions</div>
          <div class="creative-card-subtitle">Delete the layer or move it forward and backward in the stack.</div>
        </div>
        <div class="creative-pill-row">
          <button onclick="canvasDeleteCreativeSelection()" class="creative-chip-btn creative-chip-btn--danger"><iconify-icon icon="solar:trash-bin-trash-bold-duotone" width="14" height="14"></iconify-icon>Delete</button>
          <button onclick="canvasNudgeCreativeZ(1)" class="creative-chip-btn"><iconify-icon icon="solar:arrow-up-bold-duotone" width="14" height="14"></iconify-icon>Forward</button>
          <button onclick="canvasNudgeCreativeZ(-1)" class="creative-chip-btn"><iconify-icon icon="solar:arrow-down-bold-duotone" width="14" height="14"></iconify-icon>Back</button>
        </div>
      </section>
    `,Y="";E.innerHTML=`
      ${x}
      <div class="creative-inspector-body">
        <section class="creative-inspector-card creative-inspector-card--hero">
          <div class="creative-inspector-card-header">
            <div>
              <div class="creative-inspector-kicker">Selected layer</div>
              <div class="creative-inspector-card-title">${e.escHtml(i.type)}</div>
              <div class="creative-inspector-subtext">${e.escHtml(i.id)}</div>
            </div>
            <div class="creative-inspector-badge">${r==="video"?"Timeline linked":"Live frame"}</div>
          </div>
          ${d}
        </section>
        ${r==="video"?e.renderCreativeHtmlMotionLintCardStudioV3():""}
        ${ee}
        ${i.type==="text"?"":b}
        ${i.type==="text"?"":h}
        ${r==="video"?e.renderCreativeKeyframeSectionStudioV3(i):""}
        ${pe}
        ${e.renderCreativeQuickExportCardStudioV3()}
        ${e.renderCreativeSavedAssetsCardStudioV3()}
        ${Y}
      </div>
    `}else E.innerHTML=`
      ${x}
      <div class="creative-inspector-body">
        <section class="creative-inspector-card creative-inspector-card--hero">
          <div class="creative-inspector-card-header">
            <div>
              <div class="creative-inspector-kicker">Scene</div>
              <div class="creative-inspector-card-title">${e.escHtml(r==="video"?"Motion workspace":"Image workspace")}</div>
              <div class="creative-inspector-subtext">No element is selected yet. Tune the frame, choose a preset, or pull pieces in from the studio rail.</div>
            </div>
            <div class="creative-inspector-badge">${e.creativeSceneDoc.elements.length} elements</div>
          </div>
          <div class="creative-inspector-summary">
            <span class="creative-summary-pill">${e.creativeSceneDoc.width} x ${e.creativeSceneDoc.height}</span>
            <span class="creative-summary-pill">${e.escHtml(r==="video"?"Timeline enabled":"Still frame")}</span>
            <span class="creative-summary-pill">${e.escHtml(e.creativeSceneDoc.background||"#ffffff")}</span>
          </div>
        </section>
        ${r==="video"?e.renderCreativeHtmlMotionLintCardStudioV3():""}
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Canvas setup</div>
            <div class="creative-card-subtitle">Choose a frame size and update the scene document properties directly.</div>
          </div>
          <label class="creative-form-field" style="margin-bottom:12px">
            <span class="creative-form-label">Canvas preset</span>
            <select class="creative-form-select" onchange="canvasApplyCreativeSizePreset(this.value)">
              <option value="">Choose a preset...</option>
              ${Object.entries(e.CREATIVE_SIZE_PRESETS).map(([d,h])=>`
                <option value="${e.escHtml(d)}">${e.escHtml(`${h.label} | ${h.width} x ${h.height}`)}</option>
              `).join("")}
            </select>
          </label>
          <div class="creative-field-grid">
            ${e.renderCreativePropertyFieldStudioV3("Canvas width","width",e.creativeSceneDoc.width,"number",{handler:"canvasUpdateCreativeDocumentProperty"})}
            ${e.renderCreativePropertyFieldStudioV3("Canvas height","height",e.creativeSceneDoc.height,"number",{handler:"canvasUpdateCreativeDocumentProperty"})}
            ${e.renderCreativePropertyFieldStudioV3("Background","background",e.creativeSceneDoc.background||"#ffffff","color",{handler:"canvasUpdateCreativeDocumentProperty"})}
            ${r==="video"?e.renderCreativePropertyFieldStudioV3("Duration (ms)","durationMs",e.creativeSceneDoc.durationMs||12e3,"number",{min:"1000",step:"250",handler:"canvasUpdateCreativeDocumentProperty"}):""}
            ${r==="video"?e.renderCreativePropertyFieldStudioV3("Frame rate","frameRate",e.creativeSceneDoc.frameRate||60,"number",{min:"60",step:"1",handler:"canvasUpdateCreativeDocumentProperty"}):""}
          </div>
        </section>
        ${r==="video"?`
          <section class="creative-inspector-card">
            <div class="creative-section-heading">
              <div class="creative-card-title">Playback</div>
              <div class="creative-card-subtitle">Scrub the current draft and preview the motion timing from the inspector.</div>
            </div>
            <div class="creative-info-note">Playhead ${e.escHtml(e.formatCreativeTimelineTime(e.creativeTimelineMs))} of ${e.escHtml(e.formatCreativeTimelineTime(Math.max(1e3,Number(e.creativeSceneDoc.durationMs)||12e3)))}</div>
          <input type="range" data-creative-timeline-range="true" min="0" max="${Math.max(1e3,Number(e.creativeSceneDoc.durationMs)||12e3)}" step="50" value="${e.creativeTimelineMs}" oninput="canvasSetCreativeTimeline(this.value)" style="width:100%;margin-top:12px">
            <div class="creative-pill-row" style="margin-top:12px">
              <button onclick="toggleCreativePlayback()" class="creative-chip-btn creative-chip-btn--accent">${e.isCreativePlaybackActive()?"Pause":"Play"}</button>
              <button onclick="stopCreativePlayback({ reset: true, persist: true })" class="creative-chip-btn">Reset</button>
            </div>
          </section>
        `:""}
        ${pe}
        ${e.renderCreativeQuickExportCardStudioV3()}
        ${e.renderCreativeSavedAssetsCardStudioV3()}
        <section class="creative-inspector-card">
          <div class="creative-section-heading">
            <div class="creative-card-title">Studio note</div>
            <div class="creative-card-subtitle">Drag elements directly on the frame. In video mode, frame edits at the playhead become keyframes, and timeline diamonds can be retimed in place.</div>
          </div>
          <div class="creative-info-note">The outer app header stays untouched while this canvas shell carries the focused Image and Video studio styling.</div>
        </section>
      </div>
    `;if(z&&q&&l){let d=r==="video";if(z.style.display=d?"flex":"none",d){let h=Math.max(1e3,Number(e.creativeSceneDoc.durationMs)||12e3),b=Math.max(0,Math.min(100,e.creativeTimelineMs/h*100)),ee=e.buildCreativeTimelineTicksStudioV3(h,7),Y=e.creativeSceneDoc.elements.length===0?e.getCreativeHtmlMotionTimelineTracks(h):[],_=e.creativeSceneDoc.elements.length+Y.length,Se=e.creativeComposition?e.summarizeComposition(e.creativeComposition):null,we=_+(Se?.trackCount||0);l.textContent=`${we} tracks | ${e.formatCreativeTimelineTime(h)} | ${Number(e.creativeSceneDoc.frameRate)||60} fps | playhead ${e.formatCreativeTimelineTime(e.creativeTimelineMs)}${F?" | audio armed":""}`;let ie=Math.max(0,Number(C.startMs)||0),Me=Math.max(0,Number(C.durationMs)||0)||Math.max(0,h-ie),te=Math.max(0,Math.min(100,ie/h*100)),ue=F?Math.max(8,Math.min(100-te,Me/h*100)):0;q.innerHTML=`
        <div class="creative-timeline-scroll-inner">
          <div class="creative-timeline-controls">
            <div class="creative-timeline-controls-left">
              <button onclick="toggleCreativePlayback()" class="creative-chip-btn creative-chip-btn--accent">${e.isCreativePlaybackActive()?"Pause":"Play"}</button>
              <button onclick="stopCreativePlayback({ reset: true, persist: true })" class="creative-chip-btn">Reset</button>
            </div>
            <div><input type="range" data-creative-timeline-range="true" min="0" max="${h}" step="50" value="${e.creativeTimelineMs}" oninput="canvasSetCreativeTimeline(this.value)" style="width:100%"></div>
          </div>
          <div class="creative-timeline-ruler">
            ${ee.map(g=>`<div class="creative-timeline-ruler-tick" style="left:${g.left}%">${e.escHtml(g.label)}</div>`).join("")}
          </div>
          ${e.renderCompositionTimelineStrip()}
        `+e.creativeSceneDoc.elements.map((g,B)=>{let ae=e.getCreativeElementDisplayLabelStudioV3(g,B),k=Array.isArray(g.meta?.keyframes)?g.meta.keyframes.slice().sort((j,se)=>(j.atMs||0)-(se.atMs||0)):[],U=k.length>=2,R=k.length?Math.max(0,Number(k[0].atMs)||0):0,ke=U?Math.max(R,Number(k[k.length-1].atMs)||0):h,re=k.length?Math.max(0,Math.min(100,R/h*100)):0,$e=U?Math.max(.5,Math.min(100-re,(ke-R)/h*100)):k.length===1?Math.max(.5,100-re):100,_e=k.length?k[0].id:"",Ae=k.length?k[k.length-1].id:"",he=g.type==="hyperframes"&&Array.isArray(g.meta?.tracks)?g.meta.tracks.length:0,Te=he?`${he} HyperFrames tracks`:k.length?`${k.length} keyframes`:"Static layer";return`
            <div class="creative-timeline-track">
              <button type="button" class="creative-timeline-track-label ${g.id===e.creativeSelectedId?"is-selected":""}" onclick="canvasSelectCreativeElement('${g.id}')">
                <span class="creative-timeline-track-icon"><iconify-icon icon="${e.escHtml(e.getCreativeTimelineElementIconStudioV3(g.type))}" width="16" height="16"></iconify-icon></span>
                <span class="creative-timeline-track-copy">
                  <span class="creative-timeline-track-title">${e.escHtml(String(ae).slice(0,42))}</span>
                  <span class="creative-timeline-track-meta-line">${e.escHtml(Te)}</span>
                </span>
              </button>
              <div class="creative-timeline-track-lane" onmousedown="canvasHandleCreativeTimelineLanePointer(event, '${g.id}', this)">
                <div class="creative-timeline-track-fill ${g.id===e.creativeSelectedId?"is-selected":""}" style="left:${re}%;width:${$e}%">
                  ${U?`
                    <div class="creative-timeline-track-edge creative-timeline-track-edge--start" title="Trim start" onmousedown="canvasBeginCreativeTrimGesture(event, '${g.id}', '${_e}', 'start', this.closest('.creative-timeline-track-lane'))"></div>
                    <div class="creative-timeline-track-edge creative-timeline-track-edge--end" title="Trim end" onmousedown="canvasBeginCreativeTrimGesture(event, '${g.id}', '${Ae}', 'end', this.closest('.creative-timeline-track-lane'))"></div>
                  `:""}
                </div>
                ${k.map(j=>{let se=Math.max(0,Math.min(100,(Number(j.atMs)||0)/h*100));return`<div class="creative-timeline-keyframe ${Number(j.atMs)===Number(e.creativeTimelineMs)?"is-active":""}" title="${e.escHtml(`${e.formatCreativeTimelineTime(j.atMs)} | drag to retime`)}" style="left:${se}%" onmousedown="canvasBeginCreativeKeyframeDrag(event, '${g.id}', '${j.id}', this.parentElement)"></div>`}).join("")}
                <div class="creative-timeline-playhead" style="left:calc(${b}% - 0.5px)"></div>
              </div>
            </div>
          `}).join("")+Y.map(g=>{let B=Math.max(0,Math.min(100,g.startMs/h*100)),ae=(g.endMs-g.startMs)/h*100,k=Math.max(.5,Math.min(100-B,ae)),U=g.isSelected,R=encodeURIComponent(g.selector||"");return`
            <div class="creative-timeline-track" data-html-motion-track="true">
              <button type="button" class="creative-timeline-track-label ${U?"is-selected":""}" onclick="canvasSelectCreativeHtmlMotionBySelector('${R}')">
                <span class="creative-timeline-track-icon"><iconify-icon icon="${e.escHtml(g.icon)}" width="16" height="16"></iconify-icon></span>
                <span class="creative-timeline-track-copy">
                  <span class="creative-timeline-track-title">${e.escHtml(String(g.label).slice(0,42))}</span>
                  <span class="creative-timeline-track-meta-line">${e.escHtml(g.metaLine)}</span>
                </span>
              </button>
              <div class="creative-timeline-track-lane" data-html-motion-selector="${e.escHtml(R)}" onmousedown="canvasHandleCreativeHtmlMotionLanePointer(event, '${R}', this)">
                <div class="creative-timeline-track-fill ${U?"is-selected":""}" style="left:${B}%;width:${k}%"></div>
                <div class="creative-timeline-keyframe" title="${e.escHtml(`Start ${e.formatCreativeTimelineTime(g.startMs)}`)}" style="left:${B}%"></div>
                <div class="creative-timeline-keyframe" title="${e.escHtml(`End ${e.formatCreativeTimelineTime(g.endMs)}`)}" style="left:${Math.max(0,Math.min(100,g.endMs/h*100))}%"></div>
                <div class="creative-timeline-playhead" style="left:calc(${b}% - 0.5px)"></div>
              </div>
            </div>
          `}).join("")+`
          <div class="creative-timeline-track creative-timeline-track--audio">
            <button type="button" class="creative-timeline-track-label ${F?"is-audio":""}" onclick="canvasSelectCreativeInspectorTab('properties')">
              <span class="creative-timeline-track-icon"><iconify-icon icon="solar:music-notes-bold-duotone" width="16" height="16"></iconify-icon></span>
              <span class="creative-timeline-track-copy">
                <span class="creative-timeline-track-title">${e.escHtml(oe)}</span>
                <span class="creative-timeline-track-meta-line">${e.escHtml(F?`starts ${e.formatCreativeTimelineTime(ie)} | volume ${C.volume.toFixed(2)}`:"Add an audio source in the inspector to arm the lane.")}</span>
              </span>
            </button>
            <div class="creative-timeline-track-lane creative-timeline-track-lane--audio" onmousedown="canvasHandleCreativeAudioLanePointer(event, this)">
              ${F?`
                <div class="creative-timeline-track-fill creative-timeline-track-fill--audio" style="left:${te}%;width:${ue}%">
                  <div class="creative-timeline-track-edge creative-timeline-track-edge--start" title="Trim audio start" onmousedown="canvasBeginCreativeAudioTrimGesture(event, 'start', this.closest('.creative-timeline-track-lane'))"></div>
                  <div class="creative-timeline-track-edge creative-timeline-track-edge--end" title="Trim audio end" onmousedown="canvasBeginCreativeAudioTrimGesture(event, 'end', this.closest('.creative-timeline-track-lane'))"></div>
                </div>
                <canvas class="creative-timeline-audio-wave-canvas" data-audio-left="${te}" data-audio-width="${ue}"></canvas>
              `:'<div class="creative-timeline-audio-empty">No audio on the timeline yet \u2014 add a source in the inspector</div>'}
              <div class="creative-timeline-playhead" style="left:calc(${b}% - 0.5px)"></div>
            </div>
          </div>
        </div>
      `}else q.innerHTML="",l.textContent=""}e.ensureCreativeStageResizeObserver(ye),e.canvasInstallCreativeStageWheelZoom(),e.canvasInstallCreativeStageSelectionClear(),e.scheduleCreativeStageViewportSync({center:e.creativeStageZoomMode!=="manual"}),z&&z.style.display!=="none"&&requestAnimationFrame(()=>e.drawCreativeWaveformCanvas(C))}async function Ne(e,S){await e.ensureCreativeFeatureRuntime();let P=String(e.window.activeChatSessionId||"").trim(),D=String(e.window.agentSessionId||"").trim(),E=e.window.currentCreativeMode,z=e.window.__pmSuppressCreativeAutoOpen;if(!await e.ensureCreativeCommandSessionActive(S,{previousActiveSessionId:P})){e.sendCreativeCommandResult(S,{success:!1,error:"Creative command target session is not available in this UI client."});return}let q=P&&String(S?.sessionId||"").trim()!==P;try{let l=String(S?.command||"").trim(),a=S?.payload&&typeof S.payload=="object"?S.payload:{},v=e.normalizeCreativeMode(e.window.currentCreativeMode);if(!e.isStructuredCreativeMode(v)){e.sendCreativeCommandResult(S,{success:!1,error:"No Image or Video creative workspace is active in this UI session."});return}e.ensureCreativeSceneForMode(v);let r=null;if(l==="get_state")r={scene:e.summarizeCreativeSceneForCommand(),selectedElement:e.getCreativeCommandSelectedElement(),selectionContext:e.creativeSelectedId?e.buildSceneSelectionContext(e.creativeSceneDoc,e.creativeSelectedId):null,htmlMotionClip:e.normalizeCreativeHtmlMotionClip(e.creativeHtmlMotionClip),audioTrack:e.getCreativeAudioTrackConfig(),creativeLibraries:e.normalizeCreativeMode(v)==="video"?{videoSurface:"Prometheus Video editor supports editable scene-graph media layers plus HTML Motion, HyperFrames, Remotion, and Pretext clips.",htmlMotionAccess:"Create with creative_create_html_motion_clip or creative_apply_html_motion_template, edit existing clips with creative_read_html_motion_clip plus creative_patch_html_motion_clip, inspect with creative_render_html_motion_snapshot, then export with creative_export_html_motion_clip.",hyperframesAccess:"Use hyperframes_browse_catalog, hyperframes_insert_clip, hyperframes_apply_patch, hyperframes_lint, hyperframes_qa, and hyperframes_export for component-driven video systems. Use creative_* HyperFrames tools only for legacy compatibility.",remotionAccess:"Use creative_list_motion_templates, creative_preview_motion_template, creative_apply_motion_template, and creative_generate_motion_variants for Remotion-backed video systems.",elementTypes:["text","shape","icon","image","video","audio","group","hyperframes"],assetAccess:"Generated and imported Creative assets hydrate into the Prometheus Video editor asset panel. Use creative_add_asset/add_element or generation tools to place durable workspace-backed media layers."}:{iconSystem:"Iconify",iconAccess:"Any valid Iconify icon name is accepted in meta.iconName, such as solar:..., lucide:..., mdi:..., simple-icons:..., tabler:..., ph:..., heroicons:..., logos:..., etc.",elementTypes:["text","shape","icon","image","video","group"],assetAccess:"Uploaded image/video workspace paths can be placed as editable layers with creative_add_asset. Image layers use meta.source/fit/radius. Video layers use meta.source/fit/radius/timelineStartMs/timelineDurationMs/trimStartMs/volume/muted and can still be moved, resized, rotated, faded, layered, and animated.",shapeKinds:["rect","circle","triangle","polygon","line","arrow"],fontAccess:"Use any installed/web-safe font family by setting text meta.fontFamily. Manrope is the default.",commonFonts:["Manrope","Inter","Arial","Helvetica","Georgia","Times New Roman","Courier New","Montserrat","Poppins","Bebas Neue"],animationPresetIds:e.getActiveCreativeAnimationPresetCatalog().map(t=>t.id).slice(0,80),animationAccess:"Use any available built-in or enabled custom animation preset id with creative_apply_animation or add-animation-preset.",stylePresets:e.CREATIVE_STYLE_PRESETS.map(t=>({id:t.id,label:t.label,fonts:t.fonts,colors:t.colors,recommendedMotion:t.motion})),componentPresets:["cta-card","caption-block","feature-card","logo-lockup","lower-third","product-callout"]},assets:{storageRoot:e.creativeAssetsState?.storageRoot||"",exports:Array.isArray(e.creativeAssetsState?.exports)?e.creativeAssetsState.exports.length:0,scenes:Array.isArray(e.creativeAssetsState?.scenes)?e.creativeAssetsState.scenes.length:0,indexedAssets:Array.isArray(e.creativeAssetsState?.indexedAssets)?e.creativeAssetsState.indexedAssets.length:0}};else if(l==="reset_scene"){let t=e.hashCreativeObject(e.creativeSceneDoc);if((!!e.creativeHtmlMotionClip||Array.isArray(e.creativeSceneDoc?.elements)&&e.creativeSceneDoc.elements.length>0||Array.isArray(e.creativeSceneDoc?.motionTemplates)&&e.creativeSceneDoc.motionTemplates.length>0||Array.isArray(e.creativeSceneDoc?.captions)&&e.creativeSceneDoc.captions.length>0)&&a.force!==!0)throw new Error("reset_scene refused because the current scene has work in it. Save a creative_checkpoint first, or call reset_scene with force=true only for an explicit fresh start.");e.commitCreativeHistorySnapshot(e.captureCreativeSnapshot()),e.creativeHistoryFuture=[],e.creativeSceneDoc=e.createBlankCreativeScene(v),e.creativeSelectedId=null,e.creativeTimelineMs=0,e.creativeHtmlMotionClip=null,e.stopCreativeAudioPreview({reset:!0,dispose:!0}),e.setCreativeSceneDoc(e.creativeSceneDoc,{render:!1,persist:!1,allowBlankOverwrite:!0}),e.renderCreativeWorkspace(),e.persistActiveChat(),r={reset:!0,mode:v,previousHash:t,sceneHash:e.hashCreativeObject(e.creativeSceneDoc),scene:e.summarizeCreativeSceneForCommand()}}else if(l==="purge_scene"){let t=Array.isArray(a.targets)&&a.targets.length?a.targets.map(p=>String(p||"").trim().toLowerCase()):["hidden","offscreen","empty_text","duplicate_ids"],i=e.creativeSceneDoc||e.createSceneDocument(),s=Math.max(1,Number(i.width)||1080),n=Math.max(1,Number(i.height)||1080),o=new Set,c=[],m=[];(Array.isArray(i.elements)?i.elements:[]).forEach(p=>{let H=String(p?.id||"").trim(),y={right:(Number(p?.x)||0)+(Number(p?.width)||0),bottom:(Number(p?.y)||0)+(Number(p?.height)||0),left:Number(p?.x)||0,top:Number(p?.y)||0},u=[];t.includes("duplicate_ids")&&H&&o.has(H)&&u.push("duplicate_id"),t.includes("hidden")&&(p.visible===!1||Number(p.opacity)===0)&&u.push("hidden"),t.includes("offscreen")&&(y.right<0||y.bottom<0||y.left>s||y.top>n)&&u.push("offscreen"),t.includes("empty_text")&&p.type==="text"&&!String(p.meta?.content||"").trim()&&u.push("empty_text"),u.length?c.push({id:H,type:p.type,label:p.meta?.content||p.meta?.iconName||p.type,reasons:u}):m.push(p),H&&o.add(H)});let w=e.createSceneDocument({...i,elements:m});e.setCreativeSceneDoc(w,{render:!1,recordHistory:!0}),e.creativeSelectedId&&!m.some(p=>p.id===e.creativeSelectedId)&&(e.creativeSelectedId=m[m.length-1]?.id||null),e.renderCreativeWorkspace(),e.persistActiveChat(),r={targets:t,removedCount:c.length,removed:c,sceneHash:e.hashCreativeObject(e.creativeSceneDoc),scene:e.summarizeCreativeSceneForCommand()}}else if(l==="element_inventory")r={sceneHash:e.hashCreativeObject(e.creativeSceneDoc),inventory:e.getCreativeElementInventory({includeHidden:a.includeHidden!==!1}),motionTemplates:Array.isArray(e.creativeSceneDoc?.motionTemplates)?e.creativeSceneDoc.motionTemplates:[],captions:Array.isArray(e.creativeSceneDoc?.captions)?e.creativeSceneDoc.captions:[],validation:e.validateCreativeSceneLayout(e.creativeSceneDoc,{mode:v})};else if(l==="frame_trace"){let t=Math.max(1e3,Number(e.creativeSceneDoc?.durationMs)||12e3),i=Array.isArray(a.timesMs)&&a.timesMs.length?a.timesMs:[Number.isFinite(Number(a.atMs))?Number(a.atMs):e.creativeTimelineMs];r={sceneHash:e.hashCreativeObject(e.creativeSceneDoc),traces:i.map(s=>Math.max(0,Math.min(t,Number(s)||0))).slice(0,12).map(s=>e.getCreativeFrameTraceAt(s))}}else if(l==="frame_diff"){let t=Math.max(0,Number(a.leftAtMs??a.fromMs)||0),i=Math.max(0,Number(a.rightAtMs??a.toMs)||Math.max(0,t+1e3)),s=e.getCreativeFrameTraceAt(t),n=e.getCreativeFrameTraceAt(i);r={sceneHash:e.hashCreativeObject(e.creativeSceneDoc),leftAtMs:t,rightAtMs:i,changed:e.diffCreativeFrameTraces(s,n),leftActiveIds:s.elements.filter(o=>o.active).map(o=>o.id),rightActiveIds:n.elements.filter(o=>o.active).map(o=>o.id)}}else if(l==="history_status")r={canUndo:e.creativeHistoryPast.length>0,canRedo:e.creativeHistoryFuture.length>0,undoCount:e.creativeHistoryPast.length,redoCount:e.creativeHistoryFuture.length,sceneHash:e.hashCreativeObject(e.creativeSceneDoc),scene:e.summarizeCreativeSceneForCommand(),htmlMotionClip:e.normalizeCreativeHtmlMotionClip(e.creativeHtmlMotionClip)};else if(l==="undo"){if(!e.creativeHistoryPast.length)throw new Error("No creative history entry is available to undo.");e.canvasUndoCreativeChange(),r={undone:!0,canUndo:e.creativeHistoryPast.length>0,canRedo:e.creativeHistoryFuture.length>0,undoCount:e.creativeHistoryPast.length,redoCount:e.creativeHistoryFuture.length,sceneHash:e.hashCreativeObject(e.creativeSceneDoc),scene:e.summarizeCreativeSceneForCommand(),htmlMotionClip:e.normalizeCreativeHtmlMotionClip(e.creativeHtmlMotionClip)}}else if(l==="redo"){if(!e.creativeHistoryFuture.length)throw new Error("No creative history entry is available to redo.");e.canvasRedoCreativeChange(),r={redone:!0,canUndo:e.creativeHistoryPast.length>0,canRedo:e.creativeHistoryFuture.length>0,undoCount:e.creativeHistoryPast.length,redoCount:e.creativeHistoryFuture.length,sceneHash:e.hashCreativeObject(e.creativeSceneDoc),scene:e.summarizeCreativeSceneForCommand(),htmlMotionClip:e.normalizeCreativeHtmlMotionClip(e.creativeHtmlMotionClip)}}else if(l==="checkpoint"){let t=String(a.action||"save").trim().toLowerCase(),i=e.getActiveChatSessionRecord(),s=Array.isArray(i?.creativeCheckpoints)?i.creativeCheckpoints:[];if(t==="restore"){let n=String(a.id||"").trim(),o=s.find(c=>String(c?.id||"")===n)||s[s.length-1];if(!o)throw new Error("No creative checkpoint found to restore.");e.commitCreativeHistorySnapshot(e.captureCreativeSnapshot()),e.restoreCreativeSnapshot(o.snapshot,{render:!0,persist:!0}),r={restored:!0,id:o.id,label:o.label||"",sceneHash:e.hashCreativeObject(e.creativeSceneDoc)}}else{let n={id:`creative_checkpoint_${Date.now().toString(36)}`,label:String(a.label||"").trim()||`Checkpoint ${s.length+1}`,createdAt:new Date().toISOString(),sceneHash:e.hashCreativeObject(e.creativeSceneDoc),snapshot:e.captureCreativeSnapshot()};i&&(i.creativeCheckpoints=[...s,n].slice(-20),e.saveChatSessions()),r={saved:!0,id:n.id,label:n.label,sceneHash:n.sceneHash,checkpointCount:i?.creativeCheckpoints?.length||1}}}else if(l==="export_trace"){let t=Array.isArray(e.creativeAssetsState?.exports)?e.creativeAssetsState.exports.slice(0,10):[];r={sceneHash:e.hashCreativeObject(e.creativeSceneDoc),currentScene:e.summarizeCreativeSceneForCommand(),activeExport:e.creativeActiveExport||null,recentExports:t,renderJobs:Array.isArray(e.creativeAssetsState?.renderJobs)?e.creativeAssetsState.renderJobs.slice(0,10):[],validation:e.validateCreativeSceneLayout(e.creativeSceneDoc,{mode:v})}}else if(l==="quality_report")r=e.buildCreativeQualityReport({sampleTimesMs:a.sampleTimesMs,includeHidden:a.includeHidden!==!1});else if(l==="video_analyze_timeline"){let t=Math.max(1e3,Number(e.creativeSceneDoc?.durationMs)||12e3),s=(Array.isArray(a.sampleTimesMs)&&a.sampleTimesMs.length?a.sampleTimesMs.map(n=>Math.max(0,Math.min(t,Number(n)||0))).slice(0,12):[0,Math.round(t/2),Math.max(0,t-250)]).map(n=>e.getCreativeFrameTraceAt(n));r={sceneHash:e.hashCreativeObject(e.creativeSceneDoc),scene:e.summarizeCreativeSceneForCommand(),inventory:e.getCreativeElementInventory({includeHidden:a.includeHidden!==!1}),validation:e.validateCreativeSceneLayout(e.creativeSceneDoc,{mode:v}),keyframes:e.checkCreativeKeyframes(),captions:e.checkCreativeCaptionTiming(),audioSync:e.checkCreativeAudioSync(),traces:s,diffs:s.slice(1).map((n,o)=>({leftAtMs:s[o].atMs,rightAtMs:n.atMs,changed:e.diffCreativeFrameTraces(s[o],n)}))}}else if(l==="video_check_keyframes")r=e.checkCreativeKeyframes();else if(l==="video_check_caption_timing")r=e.checkCreativeCaptionTiming();else if(l==="video_check_audio_sync")r=e.checkCreativeAudioSync();else if(l==="image_get_element_at_point"){let t=Number(a.x),i=Number(a.y);if(!Number.isFinite(t)||!Number.isFinite(i))throw new Error("image_get_element_at_point requires numeric x and y.");let s=Number.isFinite(Number(a.atMs))?Number(a.atMs):e.creativeTimelineMs,n=(Array.isArray(e.creativeSceneDoc?.elements)?e.creativeSceneDoc.elements:[]).map((o,c)=>{let m=v==="video"&&e.resolveElementAtTime(o,s)||o;return{element:m,index:c,bounds:e.getCreativeElementBounds(m)}}).filter(({element:o,bounds:c})=>o.visible!==!1&&Number(o.opacity??1)>.001&&t>=c.left&&t<=c.right&&i>=c.top&&i<=c.bottom).sort((o,c)=>Number(c.element.zIndex||0)-Number(o.element.zIndex||0)||c.index-o.index).map(({element:o,bounds:c})=>({id:o.id,type:o.type,label:o.meta?.content||o.meta?.iconName||o.meta?.source||o.type,zIndex:o.zIndex,bounds:c}));r={x:t,y:i,atMs:s,topElement:n[0]||null,matches:n}}else if(l==="image_get_overlaps")r={threshold:Math.max(0,Number(a.threshold??.02)||.02),atMs:Number.isFinite(Number(a.atMs))?Number(a.atMs):e.creativeTimelineMs,overlaps:e.getCreativeOverlapDetails(a),validation:e.validateCreativeSceneLayout(e.creativeSceneDoc,{mode:v})};else if(l==="image_get_bounds_summary"){let t=e.creativeSceneDoc||e.createSceneDocument(),i=e.getCreativeElementInventory({includeHidden:a.includeHidden!==!1}).map(n=>({...n,bounds:e.getCreativeElementBounds(n),offCanvas:n.x+n.width<0||n.y+n.height<0||n.x>t.width||n.y>t.height})),s=e.getCreativeElementsBounds(i);r={canvas:{width:t.width,height:t.height},elementCount:i.length,unionBounds:s,offCanvas:i.filter(n=>n.offCanvas),elements:i}}else if(l==="image_check_text_overflow"){let t=e.getCreativeTextOverflowDetails();r={ok:!t.some(i=>i.overflow),issueCount:t.filter(i=>i.overflow).length,textCount:t.length,details:t}}else if(l==="image_check_contrast"){let t=e.getCreativeContrastDetails();r={ok:!t.some(i=>i.passesAA===!1),issueCount:t.filter(i=>i.passesAA===!1).length,textCount:t.length,details:t}}else if(l==="image_detect_empty_regions")r=e.detectCreativeEmptyRegions(a);else if(l==="attach_audio"){if(v!=="video")throw new Error("attach_audio is only available in Video mode.");let t=a?.audioTrack&&typeof a.audioTrack=="object"&&!Array.isArray(a.audioTrack)?a.audioTrack:a,i=e.getCreativeAudioTrackConfig(t||{});if(!i.source)throw new Error("attach_audio requires audioTrack.source.");e.creativeAudioAnalysisRequestToken+=1;let s=e.createSceneDocument({...e.creativeSceneDoc,audioTrack:i});e.setCreativeSceneDoc(s,{render:!1,recordHistory:!0}),e.renderCreativeWorkspace(),e.persistActiveChat(),e.addProcessEntry("info",`${e.getStructuredCreativeModeLabel("video")}: attached audio lane ${i.label||i.source}.`),e.syncCreativeAudioTrackAnalysis(s,{force:!0,silent:!0}),r={audioTrack:i,sourceUrl:a?.sourceUrl||null,asset:a?.asset||null}}else if(l==="apply_ops"){e.clearCreativeHtmlMotionClip({render:!1,persist:!1});let{ops:t,canvasPatch:i}=e.normalizeCreativeCommandOps(a);if(!t.length&&!Object.keys(i).length)throw new Error("apply_ops requires a non-empty ops or operations array.");let s=new Set((e.creativeSceneDoc.elements||[]).map(m=>m.id)),n=Object.keys(i).length?e.createSceneDocument({...e.creativeSceneDoc,...i}):e.creativeSceneDoc,o=t.length?e.executeSceneGraphOps(n,t):n,c=o.elements.find(m=>!s.has(m.id));e.setCreativeSceneDoc(o,{render:!1,recordHistory:!0}),c?.id&&e.setCreativeSelection(c.id,{render:!1}),e.renderCreativeWorkspace(),e.persistActiveChat(),r={appliedOps:t.length,canvasPatch:i}}else if(l==="select_element"){let t=String(a.id||"").trim();if(!t)throw new Error("select_element requires id.");e.setCreativeSelection(t),e.persistActiveChat(),r={selectedId:t}}else if(l==="set_canvas"){let t={};if(["width","height","durationMs","frameRate"].forEach(i=>{Number.isFinite(Number(a[i]))&&(t[i]=Number(a[i]))}),v==="video"&&(t.frameRate=Math.max(60,Number(t.frameRate)||Number(e.creativeSceneDoc?.frameRate)||60)),typeof a.background=="string"&&a.background.trim()&&(t.background=a.background.trim()),!Object.keys(t).length)throw new Error("set_canvas requires at least one canvas property.");e.setCreativeSceneDoc(e.createSceneDocument({...e.creativeSceneDoc,...t}),{recordHistory:!0}),e.renderCreativeWorkspace(),e.persistActiveChat(),r={patch:t}}else if(l==="add_element"){e.clearCreativeHtmlMotionClip({render:!1,persist:!1});let t=String(a.type||"").trim().toLowerCase();if(!["text","shape","icon","image","video","audio","group"].includes(t))throw new Error("add_element requires type text, shape, icon, image, video, audio, or group.");let i=e.executeSceneGraphOps(e.creativeSceneDoc,[{op:"add",type:t,x:Number.isFinite(Number(a.x))?Number(a.x):120,y:Number.isFinite(Number(a.y))?Number(a.y):120,width:Number.isFinite(Number(a.width))?Number(a.width):320,height:Number.isFinite(Number(a.height))?Number(a.height):160,rotation:Number.isFinite(Number(a.rotation))?Number(a.rotation):0,opacity:Number.isFinite(Number(a.opacity))?Number(a.opacity):1,zIndex:Number.isFinite(Number(a.zIndex))?Number(a.zIndex):(e.creativeSceneDoc.elements||[]).length,meta:a.meta&&typeof a.meta=="object"?a.meta:{}}]),s=i.elements[i.elements.length-1]||null;e.setCreativeSceneDoc(i,{render:!1,recordHistory:!0}),s?.id&&e.setCreativeSelection(s.id,{render:!1}),e.renderCreativeWorkspace(),e.persistActiveChat(),r={addedId:s?.id||null}}else if(l==="add_asset")r=e.applyCreativeAddAssetCommand(a);else if(l==="search_icons"){let t=String(a.query||"").trim();if(!t)throw new Error("search_icons requires query.");let i=Math.max(1,Math.min(64,Number(a.limit)||24)),s=["lucide:flame","solar:fire-bold-duotone","mdi:fire","ph:flame-bold","lucide:bot","lucide:sparkles","solar:stars-bold-duotone","tabler:sparkles","lucide:zap","solar:bolt-bold-duotone","mdi:lightning-bolt","ph:lightning-bold","lucide:cpu","lucide:terminal-square","tabler:automation","mdi:robot","simple-icons:openai","logos:openai-icon"],n={};try{let o=new AbortController,c=setTimeout(()=>o.abort(),6500),m=await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(t)}&limit=${i}`,{signal:o.signal});if(clearTimeout(c),n=await m.json().catch(()=>({})),!m.ok)throw new Error(n?.error||`Iconify search failed with HTTP ${m.status}`)}catch(o){n={icons:s.filter(c=>{let m=c.toLowerCase().replace(/[:-]/g," "),w=t.toLowerCase().split(/\s+/).filter(Boolean);return w.some(p=>m.includes(p))||w.some(p=>["ai","operator","automation","tech","logo","prometheus","brand"].includes(p))}).slice(0,i),total:s.length,fallback:!0,error:String(o?.message||o||"Iconify search timed out")}}if(!Array.isArray(n.icons)||n.icons.length===0){let o=t.toLowerCase().split(/\s+/).filter(Boolean),c=s.filter(m=>{let w=m.toLowerCase().replace(/[:-]/g," ");return o.some(p=>w.includes(p))||o.some(p=>["spark","motion","template","caption","video","creative","ai","automation","tech","bold","cta"].includes(p))});n={...n,icons:(c.length?c:s).slice(0,i),total:c.length||s.length,fallback:!0}}r={query:t,limit:i,icons:Array.isArray(n.icons)?n.icons.slice(0,i):[],total:Number(n.total)||0,fallback:n.fallback===!0,error:n.error||null,usage:"Use one returned value as meta.iconName on an icon element."}}else if(l==="search_animations"){let t=String(a.query||"").trim().toLowerCase(),i=String(a.target||"").trim().toLowerCase(),s=Math.max(1,Math.min(64,Number(a.limit)||24)),n=e.getActiveCreativeAnimationPresetCatalog(i).filter(o=>{if(!t)return!0;let c=t.split(/\s+/).filter(Boolean),m=[o.id,o.label,o.libraryId,...Array.isArray(o.targets)?o.targets:[]].join(" ").toLowerCase();return c.some(w=>m.includes(w))}).slice(0,s);r={query:t,target:i||null,limit:s,presets:n,usage:"Use one returned preset id with creative_apply_animation or add-animation-preset."}}else if(l==="update_element"){e.clearCreativeHtmlMotionClip({render:!1,persist:!1});let t=String(a.id||"").trim();if(!t)throw new Error("update_element requires id.");let i=e.normalizeCreativeCommandPatch(a);if(!Object.keys(i).length)throw new Error("update_element requires patch.");let s=e.executeSceneGraphOps(e.creativeSceneDoc,[{op:"set",id:t,patch:i}]);e.setCreativeSceneDoc(s,{render:!1,recordHistory:!0}),e.setCreativeSelection(t,{render:!1}),e.renderCreativeWorkspace(),e.persistActiveChat(),r={updatedId:t,patch:i}}else if(l==="delete_element"){e.clearCreativeHtmlMotionClip({render:!1,persist:!1});let t=String(a.id||"").trim();if(!t)throw new Error("delete_element requires id.");let i=e.executeSceneGraphOps(e.creativeSceneDoc,[{op:"delete",id:t}]);e.setCreativeSceneDoc(i,{render:!1,recordHistory:!0}),e.setCreativeSelection(i.elements[i.elements.length-1]?.id||null,{render:!1}),e.renderCreativeWorkspace(),e.persistActiveChat(),r={deletedId:t}}else if(l==="apply_animation"){e.clearCreativeHtmlMotionClip({render:!1,persist:!1});let t=String(a.id||"").trim(),i=String(a.preset||"").trim();if(!t||!i)throw new Error("apply_animation requires id and preset.");let s=e.executeSceneGraphOps(e.creativeSceneDoc,[{op:"add-animation-preset",id:t,preset:i,startMs:Number.isFinite(Number(a.startMs))?Number(a.startMs):e.creativeTimelineMs,durationMs:Number.isFinite(Number(a.durationMs))?Number(a.durationMs):500}]);e.setCreativeSceneDoc(s,{render:!1,recordHistory:!0}),e.setCreativeSelection(t,{render:!1}),e.renderCreativeWorkspace(),e.persistActiveChat(),r={animatedId:t,preset:i}}else if(l==="arrange")e.clearCreativeHtmlMotionClip({render:!1,persist:!1}),r=e.applyCreativeArrangeCommand(a);else if(l==="apply_style")e.clearCreativeHtmlMotionClip({render:!1,persist:!1}),r=e.applyCreativeStyleCommand(a);else if(l==="fit_asset")e.clearCreativeHtmlMotionClip({render:!1,persist:!1}),r=e.applyCreativeFitAssetCommand(a);else if(l==="apply_template")e.clearCreativeHtmlMotionClip({render:!1,persist:!1}),r=e.applyCreativeTemplateCommand(a);else if(l==="validate_layout"){let t=e.validateCreativeSceneLayout(e.creativeSceneDoc,{mode:v});r={validation:t,ok:t.ok,issueCount:t.issueCount,errorCount:t.errorCount,warnCount:t.warnCount,usage:t.ok?"Layout validation passed. Continue with visual frame QA before export.":"Fix error-level layout issues before export, then run creative_render_snapshot for visual QA."}}else if(l==="create_html_motion_clip"){if(v!=="video")throw new Error("create_html_motion_clip requires the video workspace.");r=await e.createCreativeHtmlMotionClip(a)}else if(l==="list_html_motion_templates"){if(v!=="video")throw new Error("list_html_motion_templates requires the video workspace.");r=await e.listCreativeHtmlMotionTemplates()}else if(l==="apply_html_motion_template"){if(v!=="video")throw new Error("apply_html_motion_template requires the video workspace.");r=await e.applyCreativeHtmlMotionTemplate(a)}else if(l==="read_html_motion_clip"){if(v!=="video")throw new Error("read_html_motion_clip requires the video workspace.");r=await e.readCreativeHtmlMotionClip(a)}else if(l==="patch_html_motion_clip"){if(v!=="video")throw new Error("patch_html_motion_clip requires the video workspace.");r=await e.patchCreativeHtmlMotionClip(a)}else if(l==="restore_html_motion_revision"){if(v!=="video")throw new Error("restore_html_motion_revision requires the video workspace.");r=await e.restoreCreativeHtmlMotionClipRevision(a)}else if(l==="render_html_motion_snapshot"){if(v!=="video")throw new Error("render_html_motion_snapshot requires the video workspace.");let t=await e.renderCreativeHtmlMotionSnapshot({...a,includeDataUrl:!0}),i=(Array.isArray(t.frames)?t.frames:[]).map(s=>({width:s.width,height:s.height,atMs:s.atMs,mimeType:s.mimeType||"image/png",dataUrl:s.dataUrl||""}));r={...t,frames:i.map(({width:s,height:n,atMs:o,mimeType:c})=>({width:s,height:n,atMs:o,mimeType:c}))},e.sendCreativeCommandResult(S,{success:!0,data:r,snapshot:i.length===1?i[0]:null,snapshots:i});return}else if(l==="export_html_motion_clip"){if(v!=="video")throw new Error("export_html_motion_clip requires the video workspace.");r=await e.exportCreativeHtmlMotionClip(a)}else if(l==="apply_motion_template"){e.clearCreativeHtmlMotionClip({render:!1,persist:!1});let t=await e.creativeMotionTemplateClient.prepareCreativeMotionTemplate(a),i=t?.validation||{};if(Array.isArray(i.blockers)&&i.blockers.length)throw new Error(i.blockers.join("; "));let s=t?.instance;if(!s||typeof s!="object")throw new Error("Motion template preparation did not return an instance.");let n=e.buildCreativeMotionTemplateSceneElements(s),o=e.createSceneDocument({...e.creativeSceneDoc,durationMs:Math.max(Number(e.creativeSceneDoc?.durationMs)||0,Number(n.durationMs)||0,Number(s.durationMs)||0,12e3),frameRate:Math.max(Number(e.creativeSceneDoc?.frameRate)||0,Number(s.input?.fps)||0,60),width:Number(n.width)||Number(s.input?.width)||e.creativeSceneDoc?.width,height:Number(n.height)||Number(s.input?.height)||e.creativeSceneDoc?.height,background:n.background||e.creativeSceneDoc?.background,captions:s.input?.captions?[s.input.captions]:e.creativeSceneDoc?.captions,brandKit:s.input?.brand||e.creativeSceneDoc?.brandKit||null}),m=a.replace!==!1?e.createSceneDocument({...o,elements:[],motionTemplates:[]}):o,w=e.executeSceneGraphOps(m,[{op:"add-motion-template",instance:s},...Array.isArray(n.elements)?n.elements:[]]);e.setCreativeSceneDoc(w,{render:!1,recordHistory:!0}),e.setCreativeTimelinePosition(0,{render:!1,persist:!1}),e.renderCreativeWorkspace(),e.persistActiveChat(),e.addProcessEntry("info",`${e.getStructuredCreativeModeLabel(v)}: applied motion template ${t?.template?.name||s.templateId}${n.elements?.length?` with ${n.elements.length} rendered layers`:""}.`),e.showToast("Motion template applied",t?.template?.name||s.templateId,"success"),r={template:t?.template||null,instance:s,validation:i,renderedLayerCount:Array.isArray(n.elements)?n.elements.length:0,motionTemplateCount:Array.isArray(w.motionTemplates)?w.motionTemplates.length:0,elementCount:Array.isArray(w.elements)?w.elements.length:0}}else if(l==="timeline")e.clearCreativeHtmlMotionClip({render:!1,persist:!1}),r=e.applyCreativeTimelineCommand(a);else if(l==="render_snapshot"){if(v==="video"&&e.creativeHtmlMotionClip){let y=await e.renderCreativeHtmlMotionSnapshot({...a,includeDataUrl:!0}),u=(Array.isArray(y.frames)?y.frames:[]).map(f=>({width:f.width,height:f.height,atMs:f.atMs,mimeType:f.mimeType||"image/png",dataUrl:f.dataUrl||""}));r={...y,frames:u.map(({width:f,height:M,atMs:A,mimeType:$})=>({width:f,height:M,atMs:A,mimeType:$}))},e.sendCreativeCommandResult(S,{success:!0,data:r,snapshot:u.length===1?u[0]:null,snapshots:u});return}if(v==="video"){let y=String(a.clipId||a.clip_id||a.elementId||a.element_id||"").trim(),u=y?e.getHyperframesElementById(y):e.getSelectedCreativeElement()?.type==="hyperframes"?e.getSelectedCreativeElement():(e.creativeSceneDoc.elements||[]).find(f=>f?.type==="hyperframes"&&f.visible!==!1);if(u&&(u?.meta?.html||u?.meta?.projectPath)){let f=await e.ensureHyperframesElementSourceHtml(u);if(!f.trim())throw new Error("HyperFrames source HTML is missing.");let M=Math.max(1e3,Number(a.durationMs||a.duration_ms)||Number(u.meta.durationMs)||Number(e.creativeSceneDoc.durationMs)||6e3),A=Array.isArray(a.sampleTimesMs)?a.sampleTimesMs.map(T=>Number(T)).filter(T=>Number.isFinite(T)):[];a.contactSheet===!0&&A.length===0&&(A=[0,Math.round(M/2),Math.max(0,M-50)]),!A.length&&Number.isFinite(Number(a.atMs))&&(A=[Number(a.atMs)]);let $=await e.api("/api/canvas/hyperframes/qa",{method:"POST",body:{html:f,width:Number(a.width)||Number(u.width)||Number(e.creativeSceneDoc.width)||1080,height:Number(a.height)||Number(u.height)||Number(e.creativeSceneDoc.height)||1920,durationMs:M,samplePoints:A,timeoutMs:Number(a.timeoutMs||a.timeout_ms)||void 0}});if(!$?.success)throw new Error($?.error||"HyperFrames snapshot QA failed.");let I=$.report||{},L=(Array.isArray(I.samples)?I.samples:[]).map(T=>({width:Number(a.width)||Number(u.width)||Number(e.creativeSceneDoc.width)||1080,height:Number(a.height)||Number(u.height)||Number(e.creativeSceneDoc.height)||1920,atMs:Number(T.timeMs)||0,mimeType:"image/png",screenshotPath:T.screenshotPath||"",dataUrl:""}));r={success:!0,hyperframes:!0,clipId:u.id,ok:I.ok!==!1,sampleCount:L.length,frames:L.map(({width:T,height:X,atMs:N,mimeType:C,screenshotPath:F})=>({width:T,height:X,atMs:N,mimeType:C,screenshotPath:F})),qa:I},e.sendCreativeCommandResult(S,{success:!0,data:r,snapshot:L.length===1?L[0]:null,snapshots:L});return}}let t=e.creativeTimelineMs,i=!0,s=Math.max(0,Number(e.creativeSceneDoc?.durationMs)||0),n=Math.max(1,Number(e.creativeSceneDoc?.frameRate)||60),o=Math.max(1,Math.min(600,Math.floor(Number(a.maxFrames)||600))),c=v==="video"&&Array.isArray(a.sampleTimesMs)?a.sampleTimesMs.map(y=>Number(y)).filter(y=>Number.isFinite(y)):[];if(v==="video"&&a.contactSheet===!0&&c.length===0&&(c=[0,Math.round(Math.max(1e3,s||8e3)/2),Math.max(0,Math.round((s||8e3)-250))]),v==="video"&&a.sampleEveryFrame===!0){let y=Math.max(1,Math.round(1e3/n)),u=Math.max(0,Number(a.startMs)||0),f=Math.max(u,Math.min(s||u,Number.isFinite(Number(a.endMs))?Number(a.endMs):s));c=[];for(let M=u;M<=f&&c.length<o;M+=y)c.push(Math.min(f,Math.round(M)));s>0&&c.length<o&&c[c.length-1]!==f&&c.push(f)}else if(v==="video"&&c.length===0&&Number.isFinite(Number(a.frameStepMs))&&Number(a.frameStepMs)>0){let y=Math.max(1,Number(a.frameStepMs)),u=Math.max(0,Number(a.startMs)||0),f=Math.max(u,Math.min(s||u,Number.isFinite(Number(a.endMs))?Number(a.endMs):s));c=[];for(let M=u;M<=f&&c.length<o;M+=y)c.push(Math.min(f,Math.round(M)))}v==="video"&&c.length>o&&(c=c.slice(0,o));let m=y=>{let f=Math.max(1,Number(y?.width)||1),M=Math.max(1,Number(y?.height)||1),A=Math.min(1,960/Math.max(f,M));if(A>=.999)return y.toDataURL("image/jpeg",.78);let $=document.createElement("canvas");return $.width=Math.max(1,Math.round(f*A)),$.height=Math.max(1,Math.round(M*A)),$.getContext("2d").drawImage(y,0,0,$.width,$.height),$.toDataURL("image/jpeg",.78)},w=async y=>{v==="video"&&Number.isFinite(Number(y))&&e.setCreativeTimelinePosition(Number(y),{render:!1,persist:!1}),e.renderCreativeWorkspace(),await e.waitForCreativeExportPaint(1),await e.syncCreativeVideoElementsToTimeline({atMs:v==="video"?Number(y??t):e.creativeTimelineMs});let u=await e.renderCreativeExportCanvas("png");return{width:u.width,height:u.height,atMs:v==="video"?Number(y??t):null,mimeType:"image/jpeg",dataUrl:i?m(u):""}},p=c.length?[]:[await w(Number.isFinite(Number(a.atMs))?Number(a.atMs):t)];for(let y of c)p.push(await w(y));v==="video"&&(e.setCreativeTimelinePosition(t,{render:!1,persist:!1}),e.renderCreativeWorkspace());let H=p[0]||{};r={width:H.width||0,height:H.height||0,atMs:H.atMs??null,sampleCount:p.length,sampleEveryFrame:a.sampleEveryFrame===!0,truncated:v==="video"&&(Array.isArray(a.sampleTimesMs)&&a.sampleTimesMs.length>p.length||a.sampleEveryFrame===!0&&s>0&&p.length>=o),maxFrameSamples:o,frames:p.map(({width:y,height:u,atMs:f})=>({width:y,height:u,atMs:f}))},e.sendCreativeCommandResult(S,{success:!0,data:r,snapshot:p.length===1?p[0]:null,snapshots:p});return}else if(l==="export"){let t=String(a.format||"").trim().toLowerCase();if(!t)throw new Error("export requires format.");if(v==="video"&&e.creativeHtmlMotionClip&&t==="mp4"){r=await e.exportCreativeHtmlMotionClip(a),e.sendCreativeCommandResult(S,{success:!0,data:r});return}let i=e.validateCreativeSceneLayout(e.creativeSceneDoc,{mode:v});if(!i.ok&&a.force!==!0)throw new Error(`Creative layout validation blocked export: ${i.issues.slice(0,3).map(n=>n.message).join("; ")}`);let s=await e.canvasExportCreative(t,{skipDownload:a.download!==!0,workspaceOnly:a.workspaceOnly!==!1});r={format:t,activeExport:e.creativeActiveExport||null,export:s||null,preExportValidation:i}}else if(l==="save_scene")r=await e.canvasSaveCreativeSceneSnapshot({filename:a.filename});else if(l==="composition_get"){let t=e.ensureCreativeComposition();r={composition:t,summary:t?e.summarizeComposition(t):null}}else if(l==="composition_add_track"){let t=e.ensureCreativeComposition();if(!t)throw new Error("Composition not available.");let i=String(a.kind||"video").trim().toLowerCase();if(!["video","audio","caption"].includes(i))throw new Error("kind must be video, audio, or caption");let s=e.compositionAddTrack(t,i,a.label);e.persistCompositionState(),e.renderCreativeWorkspace?.(),r={track:s,summary:e.summarizeComposition(t)}}else if(l==="composition_add_clip"){let t=e.ensureCreativeComposition();if(!t)throw new Error("Composition not available.");let i=e.compositionAddClip(t,a||{});e.persistCompositionState(),e.renderCreativeWorkspace?.(),r={clip:i,summary:e.summarizeComposition(t)}}else if(l==="composition_move_clip"){let t=e.ensureCreativeComposition(),i=e.compositionMoveClip(t,a.clipId,a||{});e.persistCompositionState(),e.renderCreativeWorkspace?.(),r={clip:i,summary:e.summarizeComposition(t)}}else if(l==="composition_trim_clip"){let t=e.ensureCreativeComposition(),i=e.compositionTrimClip(t,a.clipId,a.edge,a.toMs);e.persistCompositionState(),e.renderCreativeWorkspace?.(),r={clip:i,summary:e.summarizeComposition(t)}}else if(l==="composition_split_at"){let t=e.ensureCreativeComposition(),i=e.compositionSplitClip(t,a.clipId,Number(a.atMs)||0);e.persistCompositionState(),e.renderCreativeWorkspace?.(),r={left:i.left,right:i.right,summary:e.summarizeComposition(t)}}else if(l==="composition_delete_clip"){let t=e.ensureCreativeComposition(),i=e.compositionDeleteClip(t,a.clipId,{ripple:a.ripple===!0});e.persistCompositionState(),e.renderCreativeWorkspace?.(),r={removed:i,summary:e.summarizeComposition(t)}}else if(l==="composition_set_transition"){let t=e.ensureCreativeComposition(),i=e.compositionSetTransition(t,a.clipId,a.edge,a.transition||null);e.persistCompositionState(),e.renderCreativeWorkspace?.(),r={clip:i}}else if(l==="composition_select_clip"){let t=e.ensureCreativeComposition();if(!t)throw new Error("Composition not available.");let i=a.clipId==null?null:String(a.clipId);if(i!==null&&!t.clips.find(s=>s.id===i))throw new Error(`Unknown clipId: ${i}`);t.selectedClipId=i,e.persistCompositionState(),e.renderCreativeWorkspace?.(),r={selectedClipId:i}}else if(l==="composition_lint"){let t=e.ensureCreativeComposition();r=e.compositionLint(t)}else if(l==="composition_save"){let t=e.ensureCreativeComposition();if(!t)throw new Error("Composition not available.");let i=e.window.currentChatSessionId||"default",s=(e.window.canvasProjectRoot||"").toString(),n=String(a.filename||"").trim(),o=await fetch("/api/canvas/composition",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:i,root:s,mode:v,composition:t,...n?{filename:n}:{}})}),c=await o.json().catch(()=>({}));if(!o.ok||c?.success===!1)throw new Error(c?.error||`HTTP ${o.status}`);r={path:c.path,absPath:c.absPath,summary:c.summary}}else if(l==="composition_render"){let t=e.ensureCreativeComposition();if(!t)throw new Error("Composition not available.");let i=e.window.currentChatSessionId||"default",s=(e.window.canvasProjectRoot||"").toString(),n=String(a.format||"mp4").toLowerCase(),o=String(a.filename||"").trim(),c=await fetch("/api/canvas/composition/render",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:i,root:s,composition:t,format:n,...o?{filename:o}:{}})}),m=await c.json().catch(()=>({}));if(!c.ok||m?.success===!1)throw new Error(m?.error||`HTTP ${c.status}`);r={path:m.path,absPath:m.absPath,format:m.format,durationMs:m.durationMs,width:m.width,height:m.height,frameRate:m.frameRate,clipCount:m.clipCount,audioTrackCount:m.audioTrackCount,elapsedMs:m.elapsedMs}}else throw new Error(`Unknown creative command: ${l}`);e.sendCreativeCommandResult(S,{success:!0,data:r})}finally{e.window.__pmSuppressCreativeAutoOpen=z,q&&P&&e.getChatSessionById(P)&&(e.window.activeChatSessionId=P,D?e.setAgentSessionId(D):e.setAgentSessionId(P),e.window.currentCreativeMode=E,e.syncActiveChat(),typeof e.window.renderSessionsList=="function"&&e.window.renderSessionsList(),typeof e.window.renderChatMessages=="function"&&e.window.renderChatMessages(),e.canvasOpen&&e.toggleCanvas(!1,{force:!0}))}}export{Ne as handleCreativeCommandMessage,Pe as renderCreativeWorkspaceStudioV3};
